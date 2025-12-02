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
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Service for managing deep AI search operations.
 * Handles job creation, callback processing, and result retrieval.
 * Publishes SSE events via DeepSearchEventService for real-time updates.
 * 
 * Supports two crawling modes:
 * 1. Webhook mode: Uses n8n webhook for AI-powered crawling
 * 2. Integrated mode: Uses IntegratedCrawlerService with multiple strategies
 *    (Crawl4AI, Browser-Use, Direct HTTP, Search Engines)
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class DeepAnalysisService {

    private final DeepAISearchClient deepAISearchClient;
    private final CrawlJobRepository crawlJobRepository;
    private final CrawlEvidenceRepository crawlEvidenceRepository;
    private final DeepSearchEventService deepSearchEventService;
    private final IntegratedCrawlerService integratedCrawlerService;

    @Value("${collector.deep-search.timeout-minutes:30}")
    private int timeoutMinutes;

    @Value("${collector.deep-search.cleanup-days:7}")
    private int cleanupDays;

    @Value("${collector.deep-search.callback-token:}")
    private String expectedCallbackToken;

    @Value("${collector.deep-search.use-integrated-crawler:true}")
    private boolean useIntegratedCrawler;

    @Value("${collector.deep-search.fallback-to-integrated:true}")
    private boolean fallbackToIntegrated;

    /**
     * Start a new deep search job
     */
    @Transactional
    public DeepSearchJobDto startDeepSearch(String topic, String baseUrl) {
        // Check if any crawling method is available
        boolean webhookEnabled = deepAISearchClient.isEnabled();
        boolean integratedEnabled = useIntegratedCrawler && integratedCrawlerService.isAvailable();
        
        if (!webhookEnabled && !integratedEnabled) {
            throw new IllegalStateException("No deep search method available. Both webhook and integrated crawler are disabled.");
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
        log.info("Created deep search job: id={}, topic={}, webhookEnabled={}, integratedEnabled={}", 
                jobId, topic, webhookEnabled, integratedEnabled);

        // Publish initial status via SSE
        deepSearchEventService.publishStatusUpdate(jobId, "PENDING", "Job created, starting search...");

        // Choose crawling method
        if (useIntegratedCrawler && integratedEnabled) {
            // Prefer integrated crawler when enabled
            triggerIntegratedSearchAsync(jobId, topic, baseUrl, webhookEnabled && fallbackToIntegrated);
        } else if (webhookEnabled) {
            // Use webhook if integrated is disabled
            triggerSearchAsync(jobId, topic, baseUrl);
        }

        return toJobDto(job);
    }

    /**
     * Async method to trigger the search via webhook
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
     * Async method to trigger search using IntegratedCrawlerService
     */
    @Async
    public void triggerIntegratedSearchAsync(String jobId, String topic, String baseUrl, boolean fallbackToWebhook) {
        try {
            log.info("Starting integrated crawl: jobId={}, topic={}", jobId, topic);
            
            // Publish progress update
            deepSearchEventService.publishProgressUpdate(jobId, 10, "Starting integrated crawler...");
            updateJobStatus(jobId, CrawlJobStatus.IN_PROGRESS);
            deepSearchEventService.publishStatusUpdate(jobId, "IN_PROGRESS", "Integrated crawl in progress...");

            // Build crawl request
            IntegratedCrawlerService.CrawlRequest request;
            if (baseUrl != null && !baseUrl.isBlank()) {
                request = IntegratedCrawlerService.CrawlRequest.forUrl(topic, baseUrl);
            } else {
                request = IntegratedCrawlerService.CrawlRequest.forTopic(topic);
            }

            // Create progress callback
            IntegratedCrawlerService.CrawlProgressCallback callback = new IntegratedCrawlerService.CrawlProgressCallback() {
                @Override
                public void onProgress(int current, int total, String message) {
                    // Scale progress from 10-90%
                    int scaledProgress = 10 + (int)((current / (double) Math.max(total, 1)) * 80);
                    deepSearchEventService.publishProgressUpdate(jobId, scaledProgress, message);
                }

                @Override
                public void onPageCrawled(com.newsinsight.collector.dto.CrawledPage page) {
                    log.debug("Page crawled for job {}: {}", jobId, page.url());
                }

                @Override
                public void onEvidenceFound(EvidenceDto evidence) {
                    deepSearchEventService.publishEvidence(jobId, evidence);
                }

                @Override
                public void onError(String url, String error) {
                    log.warn("Crawl error for job {} at {}: {}", jobId, url, error);
                }
            };

            // Execute crawl
            IntegratedCrawlerService.CrawlResult result = integratedCrawlerService
                    .crawl(request, callback)
                    .block();

            if (result != null && !result.evidence().isEmpty()) {
                // Save evidence to database
                List<CrawlEvidence> evidenceEntities = result.evidence().stream()
                        .map(e -> CrawlEvidence.builder()
                                .jobId(jobId)
                                .url(e.getUrl())
                                .title(e.getTitle())
                                .stance(parseStance(e.getStance()))
                                .snippet(e.getSnippet())
                                .source(e.getSource())
                                .build())
                        .toList();
                crawlEvidenceRepository.saveAll(evidenceEntities);

                // Update job as completed
                CrawlJob job = crawlJobRepository.findById(jobId).orElse(null);
                if (job != null) {
                    job.markCompleted(evidenceEntities.size());
                    crawlJobRepository.save(job);
                }

                // Publish completion
                deepSearchEventService.publishProgressUpdate(jobId, 100, "Completed");
                deepSearchEventService.publishComplete(jobId, toJobDto(job));
                
                log.info("Integrated crawl completed: jobId={}, evidence={}", jobId, evidenceEntities.size());
            } else {
                // No evidence found - try fallback if enabled
                if (fallbackToWebhook && deepAISearchClient.isEnabled()) {
                    log.info("No evidence from integrated crawler, falling back to webhook: jobId={}", jobId);
                    deepSearchEventService.publishProgressUpdate(jobId, 50, "Fallback to webhook crawler...");
                    triggerWebhookFallback(jobId, topic, baseUrl);
                } else {
                    // Mark as completed with no evidence
                    CrawlJob job = crawlJobRepository.findById(jobId).orElse(null);
                    if (job != null) {
                        job.markCompleted(0);
                        crawlJobRepository.save(job);
                    }
                    deepSearchEventService.publishProgressUpdate(jobId, 100, "Completed (no evidence found)");
                    deepSearchEventService.publishComplete(jobId, toJobDto(job));
                    log.info("Integrated crawl completed with no evidence: jobId={}", jobId);
                }
            }
        } catch (Exception e) {
            log.error("Integrated crawl failed: jobId={}, error={}", jobId, e.getMessage(), e);
            
            // Try fallback to webhook if enabled
            if (fallbackToWebhook && deepAISearchClient.isEnabled()) {
                log.info("Integrated crawler failed, falling back to webhook: jobId={}", jobId);
                deepSearchEventService.publishProgressUpdate(jobId, 50, "Fallback to webhook crawler...");
                triggerWebhookFallback(jobId, topic, baseUrl);
            } else {
                updateJobStatus(jobId, CrawlJobStatus.FAILED, "Integrated crawler failed: " + e.getMessage());
                deepSearchEventService.publishError(jobId, "Crawl failed: " + e.getMessage());
            }
        }
    }

    /**
     * Fallback to webhook-based crawling when integrated crawler fails
     */
    private void triggerWebhookFallback(String jobId, String topic, String baseUrl) {
        try {
            var response = deepAISearchClient.triggerSearchSync(jobId, topic, baseUrl);
            if (response.success()) {
                deepSearchEventService.publishStatusUpdate(jobId, "IN_PROGRESS", "Webhook crawl in progress...");
                log.info("Webhook fallback triggered: jobId={}", jobId);
            } else {
                updateJobStatus(jobId, CrawlJobStatus.FAILED, response.message());
                deepSearchEventService.publishError(jobId, response.message());
            }
        } catch (Exception e) {
            updateJobStatus(jobId, CrawlJobStatus.FAILED, "Webhook fallback failed: " + e.getMessage());
            deepSearchEventService.publishError(jobId, "Webhook fallback failed: " + e.getMessage());
        }
    }

    /**
     * Parse stance string to EvidenceStance enum
     */
    private EvidenceStance parseStance(String stance) {
        if (stance == null) return EvidenceStance.NEUTRAL;
        return switch (stance.toLowerCase()) {
            case "pro" -> EvidenceStance.PRO;
            case "con" -> EvidenceStance.CON;
            default -> EvidenceStance.NEUTRAL;
        };
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
