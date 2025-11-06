package com.newsinsight.collector.service;

import com.newsinsight.collector.dto.CollectionStatsDTO;
import com.newsinsight.collector.entity.CollectedData;
import com.newsinsight.collector.entity.CollectionJob;
import com.newsinsight.collector.entity.CollectionJob.JobStatus;
import com.newsinsight.collector.entity.DataSource;
import com.newsinsight.collector.entity.SourceType;
import com.newsinsight.collector.repository.CollectionJobRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

@Service
@RequiredArgsConstructor
@Slf4j
public class CollectionService {

    private final CollectionJobRepository collectionJobRepository;
    private final DataSourceService dataSourceService;
    private final RssFeedService rssFeedService;
    private final WebScraperService webScraperService;
    private final CollectedDataService collectedDataService;

    /**
     * Start collection job for a specific source
     */
    @Transactional
    public CollectionJob startCollection(Long sourceId) {
        Optional<DataSource> sourceOpt = dataSourceService.findById(sourceId);
        
        if (sourceOpt.isEmpty()) {
            throw new IllegalArgumentException("Data source not found: " + sourceId);
        }
        
        DataSource source = sourceOpt.get();
        
        if (!source.getIsActive()) {
            throw new IllegalStateException("Data source is not active: " + sourceId);
        }
        
        // Create collection job
        CollectionJob job = CollectionJob.builder()
                .sourceId(sourceId)
                .status(JobStatus.PENDING)
                .itemsCollected(0)
                .build();
        
        job = collectionJobRepository.save(job);
        
        // Execute collection asynchronously
        final Long jobId = job.getId();
        executeCollectionAsync(jobId, source);
        
        return job;
    }

    /**
     * Start collection for multiple sources
     */
    @Transactional
    public List<CollectionJob> startCollectionForSources(List<Long> sourceIds) {
        return sourceIds.stream()
                .map(this::startCollection)
                .toList();
    }

    /**
     * Start collection for all active sources
     */
    @Transactional
    public List<CollectionJob> startCollectionForAllActive() {
        List<DataSource> activeSources = dataSourceService.findActiveSources();
        return activeSources.stream()
                .map(source -> startCollection(source.getId()))
                .toList();
    }

    /**
     * Execute collection job asynchronously
     */
    @Async("taskExecutor")
    public CompletableFuture<Void> executeCollectionAsync(Long jobId, DataSource source) {
        return CompletableFuture.runAsync(() -> {
            executeCollection(jobId, source);
        });
    }

    /**
     * Execute actual collection logic
     */
    @Transactional
    protected void executeCollection(Long jobId, DataSource source) {
        Optional<CollectionJob> jobOpt = collectionJobRepository.findById(jobId);
        
        if (jobOpt.isEmpty()) {
            log.error("Collection job not found: {}", jobId);
            return;
        }
        
        CollectionJob job = jobOpt.get();
        
        try {
            log.info("Starting collection job {} for source: {} ({})", 
                    jobId, source.getName(), source.getSourceType());
            
            // Update job status to RUNNING
            job.setStatus(JobStatus.RUNNING);
            job.setStartedAt(LocalDateTime.now());
            collectionJobRepository.save(job);
            
            // Collect data based on source type
            List<CollectedData> collectedItems = collectFromSource(source);
            
            // Save collected data
            int savedCount = 0;
            for (CollectedData data : collectedItems) {
                try {
                    collectedDataService.save(data);
                    savedCount++;
                } catch (Exception e) {
                    log.error("Error saving collected data: {}", e.getMessage(), e);
                }
            }
            
            // Update source last collected timestamp
            dataSourceService.updateLastCollected(source.getId(), LocalDateTime.now());
            
            // Update job status to COMPLETED
            job.setStatus(JobStatus.COMPLETED);
            job.setCompletedAt(LocalDateTime.now());
            job.setItemsCollected(savedCount);
            collectionJobRepository.save(job);
            
            log.info("Completed collection job {} for source: {} - collected {} items", 
                    jobId, source.getName(), savedCount);
            
        } catch (Exception e) {
            log.error("Error executing collection job {}: {}", jobId, e.getMessage(), e);
            
            // Update job status to FAILED
            job.setStatus(JobStatus.FAILED);
            job.setCompletedAt(LocalDateTime.now());
            job.setErrorMessage(e.getMessage());
            collectionJobRepository.save(job);
        }
    }

    /**
     * Collect data from source based on type
     */
    private List<CollectedData> collectFromSource(DataSource source) {
        SourceType sourceType = source.getSourceType();
        
        return switch (sourceType) {
            case RSS -> rssFeedService.fetchRssFeed(source);
            case WEB -> webScraperService.scrapeWebPage(source);
            case API -> {
                log.warn("API source type not yet implemented for: {}", source.getName());
                yield List.of();
            }
            case WEBHOOK -> {
                log.warn("WEBHOOK source type is passive and cannot be actively collected: {}", source.getName());
                yield List.of();
            }
        };
    }

    /**
     * Get collection job by ID
     */
    public Optional<CollectionJob> getJobById(Long jobId) {
        return collectionJobRepository.findById(jobId);
    }

    /**
     * Get all collection jobs with pagination
     */
    public Page<CollectionJob> getAllJobs(Pageable pageable) {
        return collectionJobRepository.findAll(pageable);
    }

    /**
     * Get collection jobs by status
     */
    public Page<CollectionJob> getJobsByStatus(String status, Pageable pageable) {
        JobStatus jobStatus = JobStatus.valueOf(status.toUpperCase());
        return collectionJobRepository.findByStatus(jobStatus, pageable);
    }

    /**
     * Get collection statistics
     */
    public CollectionStatsDTO getStatistics() {
        long totalSources = dataSourceService.countAll();
        long activeSources = dataSourceService.countActive();
        long totalItemsCollected = collectedDataService.countTotal();
        long unprocessedItems = collectedDataService.countUnprocessed();
        
        // Get last collection time
        LocalDateTime lastCollection = dataSourceService.findAll(Pageable.unpaged())
                .stream()
                .map(DataSource::getLastCollected)
                .filter(java.util.Objects::nonNull)
                .max(LocalDateTime::compareTo)
                .orElse(null);
        
        return CollectionStatsDTO.builder()
                .totalSources(totalSources)
                .activeSources(activeSources)
                .totalItemsCollected(totalItemsCollected)
                .itemsCollectedToday(unprocessedItems)  // Using unprocessed as proxy for today's count
                .lastCollection(lastCollection)
                .build();
    }

    /**
     * Cancel a running collection job
     */
    @Transactional
    public boolean cancelJob(Long jobId) {
        Optional<CollectionJob> jobOpt = collectionJobRepository.findById(jobId);
        
        if (jobOpt.isEmpty()) {
            return false;
        }
        
        CollectionJob job = jobOpt.get();
        
        if (job.getStatus() != JobStatus.RUNNING && job.getStatus() != JobStatus.PENDING) {
            return false;
        }
        
        job.setStatus(JobStatus.CANCELLED);
        job.setCompletedAt(LocalDateTime.now());
        collectionJobRepository.save(job);
        
        log.info("Cancelled collection job: {}", jobId);
        return true;
    }

    /**
     * Clean up old completed jobs
     */
    @Transactional
    public int cleanupOldJobs(int daysOld) {
        LocalDateTime cutoffDate = LocalDateTime.now().minusDays(daysOld);
        List<CollectionJob> oldJobs = collectionJobRepository.findByStatusAndCompletedAtBefore(
                JobStatus.COMPLETED, cutoffDate);
        
        collectionJobRepository.deleteAll(oldJobs);
        log.info("Cleaned up {} old collection jobs", oldJobs.size());
        
        return oldJobs.size();
    }
}
