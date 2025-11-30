package com.newsinsight.collector.service;

import com.newsinsight.collector.client.DeepAISearchClient;
import com.newsinsight.collector.dto.DeepSearchJobDto;
import com.newsinsight.collector.dto.DeepSearchResultDto;
import com.newsinsight.collector.dto.EvidenceDto;
import com.newsinsight.collector.dto.StanceDistributionDto;
import com.newsinsight.collector.entity.CrawlEvidence;
import com.newsinsight.collector.entity.CrawlJob;
import com.newsinsight.collector.entity.CrawlJobStatus;
import com.newsinsight.collector.entity.EvidenceStance;
import com.newsinsight.collector.repository.CrawlEvidenceRepository;
import com.newsinsight.collector.repository.CrawlJobRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Service for managing deep AI search operations.
 * Handles job creation, callback processing, and result retrieval.
 * Publishes SSE events via DeepSearchEventService for real-time updates.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class DeepAnalysisService {

    private final DeepAISearchClient deepAISearchClient;
    private final CrawlJobRepository crawlJobRepository;
    private final CrawlEvidenceRepository crawlEvidenceRepository;
    private final DeepSearchEventService deepSearchEventService;

    @Value("${collector.deep-search.timeout-minutes:30}")
    private int timeoutMinutes;

    @Value("${collector.deep-search.cleanup-days:7}")
    private int cleanupDays;

    @Value("${collector.deep-search.callback-token:}")
    private String expectedCallbackToken;

    /**
     * Start a new deep search job
     */
    @Transactional
    public DeepSearchJobDto startDeepSearch(String topic, String baseUrl) {
        if (!deepAISearchClient.isEnabled()) {
            throw new IllegalStateException("Deep AI search is disabled");
        }

        String jobId = generateJobId();

        // Create job record
        CrawlJob job = CrawlJob.builder()
                .id(jobId)
                .topic(topic)
                .baseUrl(baseUrl)
                .status(CrawlJobStatus.PENDING)
                .build();

        crawlJobRepository.save(job);
        log.info("Created deep search job: id={}, topic={}", jobId, topic);

        // Publish initial status via SSE
        deepSearchEventService.publishStatusUpdate(jobId, "PENDING", "Job created, starting search...");

        // Trigger n8n workflow asynchronously
        triggerSearchAsync(jobId, topic, baseUrl);

        return toJobDto(job);
    }

    /**
     * Async method to trigger the search
     */
    @Async
    public void triggerSearchAsync(String jobId, String topic, String baseUrl) {
        try {
            // Publish progress update
            deepSearchEventService.publishProgressUpdate(jobId, 10, "Triggering AI search workflow...");
            
            var response = deepAISearchClient.triggerSearchSync(jobId, topic, baseUrl);
            
            if (response.success()) {
                updateJobStatus(jobId, CrawlJobStatus.IN_PROGRESS);
                // Publish SSE status update
                deepSearchEventService.publishStatusUpdate(jobId, "IN_PROGRESS", "Search in progress...");
                deepSearchEventService.publishProgressUpdate(jobId, 20, "AI search started, gathering evidence...");
                log.info("Deep search triggered successfully: jobId={}", jobId);
            } else {
                updateJobStatus(jobId, CrawlJobStatus.FAILED, response.message());
                // Publish SSE error
                deepSearchEventService.publishError(jobId, response.message());
                log.error("Failed to trigger deep search: jobId={}, message={}", jobId, response.message());
            }
        } catch (Exception e) {
            updateJobStatus(jobId, CrawlJobStatus.FAILED, e.getMessage());
            // Publish SSE error
            deepSearchEventService.publishError(jobId, e.getMessage());
            log.error("Exception triggering deep search: jobId={}", jobId, e);
        }
    }

    /**
     * Process callback from n8n workflow
     */
    @Transactional
    public DeepSearchResultDto processCallback(
            String callbackToken,
            DeepAISearchClient.DeepSearchCallbackPayload payload
    ) {
        // Validate callback token if configured
        if (expectedCallbackToken != null && !expectedCallbackToken.isBlank()) {
            if (!expectedCallbackToken.equals(callbackToken)) {
                log.warn("Invalid callback token received for job: {}", payload.jobId());
                throw new SecurityException("Invalid callback token");
            }
        }

        String jobId = payload.jobId();
        CrawlJob job = crawlJobRepository.findById(jobId)
                .orElseThrow(() -> new IllegalArgumentException("Job not found: " + jobId));

        // Check if already processed
        if (job.getCallbackReceived()) {
            log.warn("Duplicate callback received for job: {}", jobId);
            return getSearchResult(jobId);
        }

        // Publish progress update
        deepSearchEventService.publishProgressUpdate(jobId, 70, "Processing callback, saving evidence...");

        // Process evidence
        List<CrawlEvidence> evidenceList = List.of();
        if (payload.evidence() != null && !payload.evidence().isEmpty()) {
            evidenceList = payload.evidence().stream()
                    .map(e -> CrawlEvidence.fromClientEvidence(jobId, e))
                    .collect(Collectors.toList());
            crawlEvidenceRepository.saveAll(evidenceList);
            
            // Publish each evidence via SSE
            int evidenceCount = 0;
            for (CrawlEvidence evidence : evidenceList) {
                evidenceCount++;
                EvidenceDto evidenceDto = toEvidenceDto(evidence);
                deepSearchEventService.publishEvidence(jobId, evidenceDto);
                
                // Update progress as evidence is processed
                int progress = 70 + (int) ((evidenceCount / (double) evidenceList.size()) * 25);
                deepSearchEventService.publishProgressUpdate(jobId, progress, 
                        String.format("Processing evidence %d/%d", evidenceCount, evidenceList.size()));
            }
        }

        // Update job status
        if ("completed".equalsIgnoreCase(payload.status())) {
            job.markCompleted(evidenceList.size());
            // Publish completion event
            deepSearchEventService.publishProgressUpdate(jobId, 100, "Completed");
            deepSearchEventService.publishComplete(jobId, toJobDto(job));
        } else {
            job.markFailed("Workflow returned status: " + payload.status());
            // Publish error event
            deepSearchEventService.publishError(jobId, "Workflow returned status: " + payload.status());
        }
        crawlJobRepository.save(job);

        log.info("Processed callback for job: id={}, evidenceCount={}, status={}", 
                jobId, evidenceList.size(), job.getStatus());

        return getSearchResult(jobId);
    }

    /**
     * Get job status
     */
    @Transactional(readOnly = true)
    public DeepSearchJobDto getJobStatus(String jobId) {
        CrawlJob job = crawlJobRepository.findById(jobId)
                .orElseThrow(() -> new IllegalArgumentException("Job not found: " + jobId));
        return toJobDto(job);
    }

    /**
     * Get full search result including evidence
     */
    @Transactional(readOnly = true)
    public DeepSearchResultDto getSearchResult(String jobId) {
        CrawlJob job = crawlJobRepository.findById(jobId)
                .orElseThrow(() -> new IllegalArgumentException("Job not found: " + jobId));

        List<CrawlEvidence> evidenceList = crawlEvidenceRepository.findByJobId(jobId);
        List<EvidenceDto> evidenceDtos = evidenceList.stream()
                .map(this::toEvidenceDto)
                .collect(Collectors.toList());

        // Calculate stance distribution
        StanceDistributionDto stanceDistribution = calculateStanceDistribution(jobId);

        return DeepSearchResultDto.builder()
                .jobId(job.getId())
                .topic(job.getTopic())
                .baseUrl(job.getBaseUrl())
                .status(job.getStatus().name())
                .evidenceCount(evidenceList.size())
                .evidence(evidenceDtos)
                .stanceDistribution(stanceDistribution)
                .createdAt(job.getCreatedAt())
                .completedAt(job.getCompletedAt())
                .errorMessage(job.getErrorMessage())
                .build();
    }

    /**
     * List recent jobs
     */
    @Transactional(readOnly = true)
    public Page<DeepSearchJobDto> listJobs(int page, int size, CrawlJobStatus status) {
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));

        Page<CrawlJob> jobs;
        if (status != null) {
            jobs = crawlJobRepository.findByStatus(status, pageable);
        } else {
            jobs = crawlJobRepository.findAll(pageable);
        }

        return jobs.map(this::toJobDto);
    }

    /**
     * Cancel a pending or in-progress job
     */
    @Transactional
    public DeepSearchJobDto cancelJob(String jobId) {
        CrawlJob job = crawlJobRepository.findById(jobId)
                .orElseThrow(() -> new IllegalArgumentException("Job not found: " + jobId));

        if (job.getStatus() == CrawlJobStatus.PENDING || job.getStatus() == CrawlJobStatus.IN_PROGRESS) {
            job.setStatus(CrawlJobStatus.CANCELLED);
            job.setCompletedAt(LocalDateTime.now());
            crawlJobRepository.save(job);
            log.info("Cancelled job: {}", jobId);
            
            // Publish cancellation via SSE
            deepSearchEventService.publishStatusUpdate(jobId, "CANCELLED", "Job was cancelled by user");
            deepSearchEventService.publishComplete(jobId, toJobDto(job));
        }

        return toJobDto(job);
    }

    /**
     * Scheduled task to timeout old pending jobs
     */
    @Scheduled(fixedDelayString = "${collector.deep-search.timeout-check-interval:300000}")
    @Transactional
    public void timeoutOldJobs() {
        LocalDateTime cutoff = LocalDateTime.now().minusMinutes(timeoutMinutes);
        
        // Find jobs that will be timed out before marking them
        List<CrawlJob> jobsToTimeout = crawlJobRepository.findByStatusInAndCreatedAtBefore(
                List.of(CrawlJobStatus.PENDING, CrawlJobStatus.IN_PROGRESS),
                cutoff
        );
        
        int count = crawlJobRepository.markTimedOutJobs(cutoff);
        if (count > 0) {
            log.info("Marked {} jobs as timed out", count);
            
            // Publish timeout events for each job
            for (CrawlJob job : jobsToTimeout) {
                deepSearchEventService.publishError(job.getId(), "Job timed out after " + timeoutMinutes + " minutes");
            }
        }
    }

    /**
     * Scheduled task to cleanup old jobs
     */
    @Scheduled(cron = "${collector.deep-search.cleanup-cron:0 0 3 * * ?}")
    @Transactional
    public void cleanupOldJobs() {
        LocalDateTime cutoff = LocalDateTime.now().minusDays(cleanupDays);
        
        // Get job IDs to delete
        List<CrawlJob> oldJobs = crawlJobRepository.findByStatusInAndCreatedAtBefore(
                List.of(CrawlJobStatus.COMPLETED, CrawlJobStatus.FAILED, 
                        CrawlJobStatus.TIMEOUT, CrawlJobStatus.CANCELLED),
                cutoff
        );

        if (!oldJobs.isEmpty()) {
            List<String> jobIds = oldJobs.stream().map(CrawlJob::getId).collect(Collectors.toList());
            
            // Delete evidence first
            int evidenceDeleted = crawlEvidenceRepository.deleteByJobIdIn(jobIds);
            
            // Delete jobs
            int jobsDeleted = crawlJobRepository.deleteOldJobs(cutoff);
            
            log.info("Cleanup completed: {} jobs deleted, {} evidence records deleted", 
                    jobsDeleted, evidenceDeleted);
        }
    }

    // Helper methods

    private String generateJobId() {
        return "crawl_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
    }

    private void updateJobStatus(String jobId, CrawlJobStatus status) {
        updateJobStatus(jobId, status, null);
    }

    private void updateJobStatus(String jobId, CrawlJobStatus status, String errorMessage) {
        crawlJobRepository.findById(jobId).ifPresent(job -> {
            job.setStatus(status);
            if (errorMessage != null) {
                job.setErrorMessage(errorMessage);
            }
            if (status == CrawlJobStatus.FAILED) {
                job.setCompletedAt(LocalDateTime.now());
            }
            crawlJobRepository.save(job);
        });
    }

    private StanceDistributionDto calculateStanceDistribution(String jobId) {
        List<Object[]> distribution = crawlEvidenceRepository.getStanceDistribution(jobId);
        
        Map<EvidenceStance, Long> counts = distribution.stream()
                .collect(Collectors.toMap(
                        arr -> (EvidenceStance) arr[0],
                        arr -> (Long) arr[1]
                ));

        long total = counts.values().stream().mapToLong(Long::longValue).sum();
        if (total == 0) total = 1; // Avoid division by zero

        long finalTotal = total;
        return StanceDistributionDto.builder()
                .pro(counts.getOrDefault(EvidenceStance.PRO, 0L))
                .con(counts.getOrDefault(EvidenceStance.CON, 0L))
                .neutral(counts.getOrDefault(EvidenceStance.NEUTRAL, 0L))
                .proRatio(counts.getOrDefault(EvidenceStance.PRO, 0L) / (double) finalTotal)
                .conRatio(counts.getOrDefault(EvidenceStance.CON, 0L) / (double) finalTotal)
                .neutralRatio(counts.getOrDefault(EvidenceStance.NEUTRAL, 0L) / (double) finalTotal)
                .build();
    }

    private DeepSearchJobDto toJobDto(CrawlJob job) {
        return DeepSearchJobDto.builder()
                .jobId(job.getId())
                .topic(job.getTopic())
                .baseUrl(job.getBaseUrl())
                .status(job.getStatus().name())
                .evidenceCount(job.getEvidenceCount())
                .errorMessage(job.getErrorMessage())
                .createdAt(job.getCreatedAt())
                .completedAt(job.getCompletedAt())
                .build();
    }

    private EvidenceDto toEvidenceDto(CrawlEvidence evidence) {
        return EvidenceDto.builder()
                .id(evidence.getId())
                .url(evidence.getUrl())
                .title(evidence.getTitle())
                .stance(evidence.getStance() != null ? evidence.getStance().name().toLowerCase() : "neutral")
                .snippet(evidence.getSnippet())
                .source(evidence.getSource())
                .build();
    }
}
