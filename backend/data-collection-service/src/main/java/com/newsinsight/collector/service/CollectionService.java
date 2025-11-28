package com.newsinsight.collector.service;

import com.newsinsight.collector.dto.BrowserTaskMessage;
import com.newsinsight.collector.dto.CollectionStatsDTO;
import com.newsinsight.collector.dto.CrawlCommandMessage;
import com.newsinsight.collector.dto.CrawlResultMessage;
import com.newsinsight.collector.entity.BrowserAgentConfig;
import com.newsinsight.collector.entity.CollectedData;
import com.newsinsight.collector.entity.CollectionJob;
import com.newsinsight.collector.entity.CollectionJob.JobStatus;
import com.newsinsight.collector.entity.DataSource;
import com.newsinsight.collector.entity.SourceType;
import com.newsinsight.collector.repository.CollectionJobRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
@Slf4j
public class CollectionService {

    private final CollectionJobRepository collectionJobRepository;
    private final DataSourceService dataSourceService;
    private final RssFeedService rssFeedService;
    private final WebScraperService webScraperService;
    private final CollectedDataService collectedDataService;

    private final KafkaTemplate<String, CrawlCommandMessage> crawlCommandKafkaTemplate;
    private final KafkaTemplate<String, CrawlResultMessage> crawlResultKafkaTemplate;
    private final KafkaTemplate<String, BrowserTaskMessage> browserTaskKafkaTemplate;

    @Value("${collector.crawl.topic.command:newsinsight.crawl.commands}")
    private String crawlCommandTopic;

    @Value("${collector.crawl.topic.result:newsinsight.crawl.results}")
    private String crawlResultTopic;

    @Value("${collector.crawl.topic.browser-task:newsinsight.crawl.browser.tasks}")
    private String browserTaskTopic;

    @Value("${collector.browser-agent.callback-base-url:http://localhost:8081}")
    private String browserAgentCallbackBaseUrl;

    @Value("${collector.browser-agent.callback-token:}")
    private String browserAgentCallbackToken;

    /**
     * 특정 소스에 대한 수집 작업 시작
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
        
        // 수집 작업 엔티티 생성
        CollectionJob job = CollectionJob.builder()
                .sourceId(sourceId)
                .status(JobStatus.PENDING)
                .itemsCollected(0)
                .build();
        
        job = collectionJobRepository.save(job);
        
        // 수집 작업을 비동기로 실행
        final Long jobId = job.getId();

        CrawlCommandMessage command = new CrawlCommandMessage(
                jobId,
                sourceId,
                source.getSourceType().name(),
                source.getUrl(),
                source.getName()
        );

        crawlCommandKafkaTemplate.send(crawlCommandTopic, jobId.toString(), command);
        
        return job;
    }

    /**
     * 여러 소스에 대한 수집 작업 시작
     */
    @Transactional
    public List<CollectionJob> startCollectionForSources(List<Long> sourceIds) {
        return sourceIds.stream()
                .map(this::startCollection)
                .toList();
    }

    /**
     * 활성 소스 전체에 대한 수집 작업 시작
     */
    @Transactional
    public List<CollectionJob> startCollectionForAllActive() {
        List<DataSource> activeSources = dataSourceService.findActiveSources();
        return activeSources.stream()
                .map(source -> startCollection(source.getId()))
                .toList();
    }

    /**
     * 실제 수집 로직 실행
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
            
            // 작업 상태를 RUNNING으로 변경
            job.setStatus(JobStatus.RUNNING);
            job.setStartedAt(LocalDateTime.now());
            collectionJobRepository.save(job);
            
            // BROWSER_AGENT 타입인 경우 별도 처리
            if (source.getSourceType() == SourceType.BROWSER_AGENT) {
                executeBrowserAgentCollection(jobId, source, job);
                return;
            }
            
            // 소스 타입에 따라 데이터 수집
            List<CollectedData> collectedItems = collectFromSource(source);

            // 수집된 데이터 이벤트 발행
            int eventCount = 0;
            for (CollectedData data : collectedItems) {
                try {
                    String publishedAt = data.getPublishedDate() != null
                            ? data.getPublishedDate().toString()
                            : null;

                    CrawlResultMessage message = new CrawlResultMessage(
                            jobId,
                            data.getSourceId(),
                            data.getTitle(),
                            data.getContent(),
                            data.getUrl(),
                            publishedAt,
                            data.getMetadataJson()
                    );

                    crawlResultKafkaTemplate.send(crawlResultTopic, jobId.toString(), message);
                    eventCount++;
                } catch (Exception e) {
                    log.error("Error publishing crawl result event: {}", e.getMessage(), e);
                }
            }
            
            // 소스의 마지막 수집 시각 업데이트
            dataSourceService.updateLastCollected(source.getId(), LocalDateTime.now());
            
            // 작업 상태를 COMPLETED로 변경
            job.setStatus(JobStatus.COMPLETED);
            job.setCompletedAt(LocalDateTime.now());
            job.setItemsCollected(eventCount);
            collectionJobRepository.save(job);
            
            log.info("Completed collection job {} for source: {} - published {} crawl result events", 
                    jobId, source.getName(), eventCount);
            
        } catch (Exception e) {
            log.error("Error executing collection job {}: {}", jobId, e.getMessage(), e);
            
            // 작업 상태를 FAILED로 변경
            job.setStatus(JobStatus.FAILED);
            job.setCompletedAt(LocalDateTime.now());
            job.setErrorMessage(e.getMessage());
            collectionJobRepository.save(job);
        }
    }

    /**
     * BROWSER_AGENT 소스에 대한 비동기 수집 시작.
     * BrowserTaskMessage를 Kafka로 발행하고, 결과는 autonomous-crawler-service에서 
     * crawl.results 토픽으로 비동기 전송됨.
     */
    private void executeBrowserAgentCollection(Long jobId, DataSource source, CollectionJob job) {
        BrowserAgentConfig config = source.getEffectiveBrowserAgentConfig();
        
        String callbackUrl = browserAgentCallbackBaseUrl.endsWith("/") 
                ? browserAgentCallbackBaseUrl + "api/v1/browser-agent/callback"
                : browserAgentCallbackBaseUrl + "/api/v1/browser-agent/callback";

        BrowserTaskMessage task = BrowserTaskMessage.builder()
                .jobId(jobId)
                .sourceId(source.getId())
                .sourceName(source.getName())
                .seedUrl(source.getUrl())
                .maxDepth(config.getMaxDepth())
                .maxPages(config.getMaxPages())
                .budgetSeconds(config.getBudgetSeconds())
                .policy(config.getPolicy() != null ? config.getPolicy().getValue() : "focused_topic")
                .focusKeywords(config.getFocusKeywords())
                .customPrompt(config.getCustomPrompt())
                .captureScreenshots(config.getCaptureScreenshots())
                .extractStructured(config.getExtractStructured())
                .excludedDomains(config.getExcludedDomains())
                .callbackUrl(callbackUrl)
                .callbackToken(browserAgentCallbackToken)
                .createdAt(LocalDateTime.now())
                .build();

        browserTaskKafkaTemplate.send(browserTaskTopic, jobId.toString(), task);
        
        log.info("Published browser task for job {}: source={}, seedUrl={}, policy={}, maxDepth={}, maxPages={}",
                jobId, source.getName(), source.getUrl(), 
                config.getPolicy(), config.getMaxDepth(), config.getMaxPages());
        
        // Job은 RUNNING 상태로 유지 - 결과는 비동기로 들어옴
        // autonomous-crawler-service가 세션 완료 시 callback을 호출하거나,
        // 개별 결과를 crawl.results 토픽으로 발행
    }

    /**
     * 소스 타입에 따른 데이터 수집
     */
    private List<CollectedData> collectFromSource(DataSource source) {
        SourceType sourceType = source.getSourceType();
        
        return switch (sourceType) {
            case RSS -> rssFeedService.fetchRssFeed(source);
            case WEB -> webScraperService.scrapeWebPage(source);
            case API -> {
                log.warn("API 소스 타입은 아직 미구현: {}", source.getName());
                yield List.of();
            }
            case WEBHOOK -> {
                log.warn("WEBHOOK 소스 타입은 수동 이벤트 기반으로, 능동 수집이 불가: {}", source.getName());
                yield List.of();
            }
            case BROWSER_AGENT -> {
                // BROWSER_AGENT는 executeBrowserAgentCollection에서 별도 처리
                log.warn("BROWSER_AGENT should be handled by executeBrowserAgentCollection: {}", source.getName());
                yield List.of();
            }
        };
    }

    /**
     * 수집 작업 단건 조회 (ID)
     */
    public Optional<CollectionJob> getJobById(Long jobId) {
        return collectionJobRepository.findById(jobId);
    }

    /**
     * 수집 작업 전체 조회 (페이지네이션)
     */
    public Page<CollectionJob> getAllJobs(Pageable pageable) {
        return collectionJobRepository.findAll(pageable);
    }

    /**
     * 상태별 수집 작업 조회
     */
    public Page<CollectionJob> getJobsByStatus(JobStatus status, Pageable pageable) {
        return collectionJobRepository.findByStatus(status, pageable);
    }

    /**
     * 수집 통계 조회
     */
    public CollectionStatsDTO getStatistics() {
        long totalSources = dataSourceService.countAll();
        long activeSources = dataSourceService.countActive();
        long totalItemsCollected = collectedDataService.countTotal();
        long unprocessedItems = collectedDataService.countUnprocessed();
        
        // 최근 수집 시각 계산
        LocalDateTime lastCollection = dataSourceService.findAll(Pageable.unpaged())
                .stream()
                .map(DataSource::getLastCollected)
                .filter(java.util.Objects::nonNull)
                .max(LocalDateTime::compareTo)
                .orElse(null);
        
        return new CollectionStatsDTO(
                totalSources,
                activeSources,
                totalItemsCollected,
                unprocessedItems, // Using unprocessed as proxy for today's count
                lastCollection
        );
    }

    /**
     * 실행 중인 수집 작업 취소
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
     * 오래된 완료 작업 정리
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
