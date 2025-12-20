package com.newsinsight.collector.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.dto.*;
import com.newsinsight.collector.entity.ai.*;
import com.newsinsight.collector.repository.AiJobRepository;
import com.newsinsight.collector.repository.AiSubTaskRepository;
import com.newsinsight.collector.service.autocrawl.AutoCrawlIntegrationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Orchestration service for multi-provider AI analysis.
 * Manages job lifecycle, sub-task distribution, and result aggregation.
 * 
 * AutoCrawl Integration: Notifies AutoCrawl of discovered URLs when deep analysis completes.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class DeepOrchestrationService {

    private final AiJobRepository aiJobRepository;
    private final AiSubTaskRepository aiSubTaskRepository;
    private final KafkaTemplate<String, AiTaskRequestMessage> aiTaskRequestKafkaTemplate;
    private final ObjectMapper objectMapper;
    private final AutoCrawlIntegrationService autoCrawlIntegrationService;

    @Value("${collector.ai.orchestration.topic:ai.tasks.requests}")
    private String aiTaskRequestTopic;

    @Value("${collector.ai.orchestration.callback-base-url:${collector.deep-search.callback-base-url:http://localhost:8081}}")
    private String callbackBaseUrl;

    @Value("${collector.ai.orchestration.callback-token:${collector.deep-search.callback-token:}}")
    private String callbackToken;

    @Value("${collector.ai.orchestration.timeout-minutes:30}")
    private int timeoutMinutes;

    @Value("${collector.ai.orchestration.cleanup-days:7}")
    private int cleanupDays;

    @Value("${autocrawl.enabled:true}")
    private boolean autoCrawlEnabled;

    // URL extraction pattern for discovering URLs in AI results
    private static final Pattern URL_PATTERN = Pattern.compile(
            "https?://[\\w\\-._~:/?#\\[\\]@!$&'()*+,;=%]+",
            Pattern.CASE_INSENSITIVE
    );

    /**
     * Start a new deep analysis job with multiple AI providers.
     * 
     * @param topic The search topic
     * @param baseUrl Optional base URL for crawling
     * @param providers List of providers to use (null = default set)
     * @return Created job DTO
     */
    @Transactional
    public AiJobDto startDeepAnalysis(String topic, String baseUrl, List<AiProvider> providers) {
        // Generate job ID
        String jobId = AiJob.generateJobId();
        
        // Create job entity
        AiJob job = AiJob.builder()
                .id(jobId)
                .topic(topic)
                .baseUrl(baseUrl)
                .overallStatus(AiJobStatus.PENDING)
                .build();

        // Determine which providers to use
        List<AiProvider> targetProviders = providers != null && !providers.isEmpty()
                ? providers
                : getDefaultProviders();

        // Create sub-tasks for each provider
        for (AiProvider provider : targetProviders) {
            AiSubTask subTask = AiSubTask.create(job, provider, getTaskTypeForProvider(provider));
            log.debug("Created sub-task: {} for provider: {}", subTask.getId(), provider);
        }

        // Save job with sub-tasks
        aiJobRepository.save(job);
        log.info("Created AI job: id={}, topic={}, providers={}", jobId, topic, targetProviders);

        // Publish tasks to Kafka
        publishTasksToKafka(job);

        // Update job status to IN_PROGRESS
        job.markInProgress();
        aiJobRepository.save(job);

        return toJobDto(job);
    }

    /**
     * Start analysis with default providers
     */
    @Transactional
    public AiJobDto startDeepAnalysis(String topic, String baseUrl) {
        return startDeepAnalysis(topic, baseUrl, null);
    }

    /**
     * Handle callback from AI worker/n8n
     */
    @Transactional
    public void handleCallback(AiTaskCallbackRequest request) {
        log.info("Processing callback: jobId={}, subTaskId={}, status={}", 
                request.jobId(), request.subTaskId(), request.status());

        // Find sub-task
        AiSubTask subTask = findSubTask(request);
        if (subTask == null) {
            log.warn("Sub-task not found for callback: jobId={}, subTaskId={}, providerId={}", 
                    request.jobId(), request.subTaskId(), request.providerId());
            return;
        }

        // Check if already processed
        if (subTask.isTerminal()) {
            log.warn("Sub-task already in terminal state: {}", subTask.getId());
            return;
        }

        // Update sub-task status
        if (request.isSuccess()) {
            String resultJson = buildResultJson(request);
            subTask.markCompleted(resultJson);
            log.info("Sub-task completed: {}", subTask.getId());
        } else {
            subTask.markFailed(request.errorMessage());
            log.warn("Sub-task failed: {} - {}", subTask.getId(), request.errorMessage());
        }
        aiSubTaskRepository.save(subTask);

        // Update job overall status
        AiJob job = subTask.getAiJob();
        updateJobOverallStatus(job);
    }

    /**
     * Get job status
     */
    @Transactional(readOnly = true)
    public AiJobDto getJobStatus(String jobId) {
        AiJob job = aiJobRepository.findByIdWithSubTasks(jobId)
                .orElseThrow(() -> new IllegalArgumentException("Job not found: " + jobId));
        return toJobDto(job);
    }

    /**
     * List jobs with pagination
     */
    @Transactional(readOnly = true)
    public Page<AiJobDto> listJobs(int page, int size, AiJobStatus status) {
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
        
        Page<AiJob> jobs = status != null
                ? aiJobRepository.findByOverallStatus(status, pageable)
                : aiJobRepository.findAll(pageable);

        return jobs.map(this::toJobDtoWithoutSubTasks);
    }

    /**
     * Cancel a job
     */
    @Transactional
    public AiJobDto cancelJob(String jobId) {
        AiJob job = aiJobRepository.findByIdWithSubTasks(jobId)
                .orElseThrow(() -> new IllegalArgumentException("Job not found: " + jobId));

        if (!job.isTerminal()) {
            job.markCancelled();
            
            // Cancel all pending sub-tasks
            for (AiSubTask subTask : job.getSubTasks()) {
                if (!subTask.isTerminal()) {
                    subTask.markCancelled();
                }
            }
            
            aiJobRepository.save(job);
            log.info("Cancelled job: {}", jobId);
        }

        return toJobDto(job);
    }

    /**
     * Retry failed sub-tasks for a job
     */
    @Transactional
    public AiJobDto retryFailedTasks(String jobId) {
        AiJob job = aiJobRepository.findByIdWithSubTasks(jobId)
                .orElseThrow(() -> new IllegalArgumentException("Job not found: " + jobId));

        List<AiSubTask> failedTasks = job.getSubTasks().stream()
                .filter(t -> t.getStatus() == AiTaskStatus.FAILED || t.getStatus() == AiTaskStatus.TIMEOUT)
                .collect(Collectors.toList());

        if (failedTasks.isEmpty()) {
            log.info("No failed tasks to retry for job: {}", jobId);
            return toJobDto(job);
        }

        // Reset failed tasks and re-publish
        for (AiSubTask task : failedTasks) {
            task.setStatus(AiTaskStatus.PENDING);
            task.setErrorMessage(null);
            task.setResultJson(null);
            task.setCompletedAt(null);
            task.incrementRetry();
            
            publishTaskToKafka(job, task);
        }

        job.setOverallStatus(AiJobStatus.IN_PROGRESS);
        job.setCompletedAt(null);
        aiJobRepository.save(job);

        log.info("Retrying {} failed tasks for job: {}", failedTasks.size(), jobId);
        return toJobDto(job);
    }

    /**
     * Scheduled task to timeout old pending jobs
     */
    @Scheduled(fixedDelayString = "${collector.ai.orchestration.timeout-check-interval:300000}")
    @Transactional
    public void timeoutOldJobs() {
        LocalDateTime cutoff = LocalDateTime.now().minusMinutes(timeoutMinutes);
        
        // Mark timed out sub-tasks
        int tasksTimedOut = aiSubTaskRepository.markTimedOutTasks(cutoff);
        
        // Mark timed out jobs
        int jobsTimedOut = aiJobRepository.markTimedOutJobs(cutoff);
        
        if (tasksTimedOut > 0 || jobsTimedOut > 0) {
            log.info("Timeout check: {} tasks, {} jobs marked as timed out", tasksTimedOut, jobsTimedOut);
        }
    }

    /**
     * Scheduled cleanup of old jobs
     */
    @Scheduled(cron = "${collector.ai.orchestration.cleanup-cron:0 0 3 * * ?}")
    @Transactional
    public void cleanupOldJobs() {
        LocalDateTime cutoff = LocalDateTime.now().minusDays(cleanupDays);
        
        // Get job IDs to delete
        List<AiJob> oldJobs = aiJobRepository.findByStatusInAndCreatedAtBefore(
                List.of(AiJobStatus.COMPLETED, AiJobStatus.FAILED, 
                        AiJobStatus.PARTIAL_SUCCESS, AiJobStatus.TIMEOUT, AiJobStatus.CANCELLED),
                cutoff
        );

        if (!oldJobs.isEmpty()) {
            List<String> jobIds = oldJobs.stream().map(AiJob::getId).collect(Collectors.toList());
            
            // Delete sub-tasks first
            int tasksDeleted = aiSubTaskRepository.deleteByJobIds(jobIds);
            
            // Delete jobs
            int jobsDeleted = aiJobRepository.deleteOldJobs(cutoff);
            
            log.info("Cleanup: {} jobs deleted, {} sub-tasks deleted", jobsDeleted, tasksDeleted);
        }
    }

    // ========== Helper Methods ==========

    private List<AiProvider> getDefaultProviders() {
        // Default set of providers for deep analysis
        return List.of(
                AiProvider.SCOUT,           // Quick reconnaissance
                AiProvider.DEEP_READER,     // In-depth analysis
                AiProvider.UNIVERSAL_AGENT  // General AI processing
        );
    }

    private String getTaskTypeForProvider(AiProvider provider) {
        return switch (provider) {
            case SCOUT -> "reconnaissance";
            case DEEP_READER -> "deep_analysis";
            case UNIVERSAL_AGENT -> "general_analysis";
            case LOCAL_QUICK -> "quick_process";
        };
    }

    private void publishTasksToKafka(AiJob job) {
        for (AiSubTask subTask : job.getSubTasks()) {
            publishTaskToKafka(job, subTask);
        }
    }

    private void publishTaskToKafka(AiJob job, AiSubTask subTask) {
        if (!subTask.getProviderId().isExternal()) {
            // LOCAL_QUICK doesn't need Kafka
            log.debug("Skipping Kafka publish for local provider: {}", subTask.getProviderId());
            return;
        }

        String callbackUrl = buildCallbackUrl();
        
        AiTaskRequestMessage message = AiTaskRequestMessage.builder()
                .jobId(job.getId())
                .subTaskId(subTask.getId())
                .providerId(subTask.getProviderId().name())
                .taskType(subTask.getTaskType())
                .topic(job.getTopic())
                .baseUrl(job.getBaseUrl())
                .payload(buildPayload(job, subTask))
                .callbackUrl(callbackUrl)
                .callbackToken(callbackToken)
                .createdAt(LocalDateTime.now())
                .build();

        try {
            aiTaskRequestKafkaTemplate.send(aiTaskRequestTopic, job.getId(), message);
            log.debug("Published task to Kafka: topic={}, jobId={}, subTaskId={}", 
                    aiTaskRequestTopic, job.getId(), subTask.getId());
        } catch (Exception e) {
            log.error("Failed to publish task to Kafka: {}", e.getMessage(), e);
            subTask.markFailed("Failed to publish to Kafka: " + e.getMessage());
            aiSubTaskRepository.save(subTask);
        }
    }

    private Map<String, Object> buildPayload(AiJob job, AiSubTask subTask) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("topic", job.getTopic());
        payload.put("baseUrl", job.getBaseUrl());
        payload.put("taskType", subTask.getTaskType());
        payload.put("retryCount", subTask.getRetryCount());
        return payload;
    }

    private String buildCallbackUrl() {
        String base = callbackBaseUrl.endsWith("/") 
                ? callbackBaseUrl.substring(0, callbackBaseUrl.length() - 1) 
                : callbackBaseUrl;
        return base + "/api/v1/ai/callback";
    }

    private AiSubTask findSubTask(AiTaskCallbackRequest request) {
        // Try to find by subTaskId first
        if (request.subTaskId() != null && !request.subTaskId().isBlank()) {
            return aiSubTaskRepository.findById(request.subTaskId()).orElse(null);
        }
        
        // Fallback: find by jobId + providerId
        if (request.jobId() != null && request.providerId() != null) {
            try {
                AiProvider provider = AiProvider.valueOf(request.providerId());
                return aiSubTaskRepository.findByAiJobIdAndProviderId(request.jobId(), provider).orElse(null);
            } catch (IllegalArgumentException e) {
                log.warn("Invalid provider ID: {}", request.providerId());
            }
        }
        
        return null;
    }

    private String buildResultJson(AiTaskCallbackRequest request) {
        // If evidence is provided, include it in result
        if (request.evidence() != null && !request.evidence().isEmpty()) {
            try {
                Map<String, Object> result = new HashMap<>();
                result.put("evidence", request.evidence());
                result.put("resultJson", request.resultJson());
                return objectMapper.writeValueAsString(result);
            } catch (JsonProcessingException e) {
                log.warn("Failed to serialize evidence: {}", e.getMessage());
            }
        }
        return request.resultJson();
    }

    private void updateJobOverallStatus(AiJob job) {
        List<AiSubTask> subTasks = aiSubTaskRepository.findByAiJobId(job.getId());
        
        long total = subTasks.size();
        long completed = subTasks.stream().filter(t -> t.getStatus() == AiTaskStatus.COMPLETED).count();
        // long failed = subTasks.stream().filter(t -> t.getStatus() == AiTaskStatus.FAILED).count();
        long timeout = subTasks.stream().filter(t -> t.getStatus() == AiTaskStatus.TIMEOUT).count();
        long pending = subTasks.stream().filter(t -> 
                t.getStatus() == AiTaskStatus.PENDING || t.getStatus() == AiTaskStatus.IN_PROGRESS).count();

        AiJobStatus previousStatus = job.getOverallStatus();
        
        if (pending > 0) {
            // Still processing
            job.setOverallStatus(AiJobStatus.IN_PROGRESS);
        } else if (completed == total) {
            // All completed
            job.markCompleted();
        } else if (completed > 0) {
            // Some completed, some failed
            job.markPartialSuccess();
        } else if (timeout == total) {
            // All timed out
            job.markTimeout();
        } else {
            // All failed
            job.markFailed("All sub-tasks failed");
        }

        aiJobRepository.save(job);
        log.info("Updated job status: id={}, status={}, completed={}/{}", 
                job.getId(), job.getOverallStatus(), completed, total);

        // Notify AutoCrawl of discovered URLs when job completes (fully or partially)
        if (autoCrawlEnabled && previousStatus == AiJobStatus.IN_PROGRESS 
                && (job.getOverallStatus() == AiJobStatus.COMPLETED 
                    || job.getOverallStatus() == AiJobStatus.PARTIAL_SUCCESS)) {
            notifyAutoCrawlOfDiscoveredUrls(job, subTasks);
        }
    }

    /**
     * Extract URLs from completed sub-task results and notify AutoCrawl.
     */
    private void notifyAutoCrawlOfDiscoveredUrls(AiJob job, List<AiSubTask> subTasks) {
        try {
            Set<String> discoveredUrls = new HashSet<>();
            
            for (AiSubTask subTask : subTasks) {
                if (subTask.getStatus() == AiTaskStatus.COMPLETED && subTask.getResultJson() != null) {
                    // Extract URLs from result JSON
                    List<String> urls = extractUrlsFromText(subTask.getResultJson());
                    discoveredUrls.addAll(urls);
                }
            }

            if (!discoveredUrls.isEmpty()) {
                log.info("Deep search job {} discovered {} unique URLs, notifying AutoCrawl", 
                        job.getId(), discoveredUrls.size());
                autoCrawlIntegrationService.onDeepSearchCompleted(
                        job.getId(), 
                        job.getTopic(), 
                        new ArrayList<>(discoveredUrls)
                );
            }
        } catch (Exception e) {
            log.warn("Failed to notify AutoCrawl of discovered URLs: jobId={}, error={}", 
                    job.getId(), e.getMessage());
        }
    }

    /**
     * Extract URLs from text content.
     */
    private List<String> extractUrlsFromText(String text) {
        if (text == null || text.isBlank()) {
            return List.of();
        }
        
        Matcher matcher = URL_PATTERN.matcher(text);
        List<String> urls = new ArrayList<>();
        while (matcher.find()) {
            urls.add(matcher.group());
        }
        return urls;
    }

    private AiJobDto toJobDto(AiJob job) {
        List<AiSubTaskDto> subTaskDtos = job.getSubTasks().stream()
                .map(this::toSubTaskDto)
                .collect(Collectors.toList());

        long completed = subTaskDtos.stream()
                .filter(t -> "COMPLETED".equals(t.getStatus())).count();
        long failed = subTaskDtos.stream()
                .filter(t -> "FAILED".equals(t.getStatus()) || "TIMEOUT".equals(t.getStatus())).count();

        return AiJobDto.builder()
                .jobId(job.getId())
                .topic(job.getTopic())
                .baseUrl(job.getBaseUrl())
                .overallStatus(job.getOverallStatus().name())
                .subTasks(subTaskDtos)
                .totalTasks(subTaskDtos.size())
                .completedTasks((int) completed)
                .failedTasks((int) failed)
                .errorMessage(job.getErrorMessage())
                .createdAt(job.getCreatedAt())
                .updatedAt(job.getUpdatedAt())
                .completedAt(job.getCompletedAt())
                .build();
    }

    private AiJobDto toJobDtoWithoutSubTasks(AiJob job) {
        return AiJobDto.builder()
                .jobId(job.getId())
                .topic(job.getTopic())
                .baseUrl(job.getBaseUrl())
                .overallStatus(job.getOverallStatus().name())
                .subTasks(List.of())
                .errorMessage(job.getErrorMessage())
                .createdAt(job.getCreatedAt())
                .updatedAt(job.getUpdatedAt())
                .completedAt(job.getCompletedAt())
                .build();
    }

    private AiSubTaskDto toSubTaskDto(AiSubTask subTask) {
        return AiSubTaskDto.builder()
                .subTaskId(subTask.getId())
                .jobId(subTask.getAiJob() != null ? subTask.getAiJob().getId() : null)
                .providerId(subTask.getProviderId().name())
                .taskType(subTask.getTaskType())
                .status(subTask.getStatus().name())
                .resultJson(subTask.getResultJson())
                .errorMessage(subTask.getErrorMessage())
                .retryCount(subTask.getRetryCount())
                .createdAt(subTask.getCreatedAt())
                .updatedAt(subTask.getUpdatedAt())
                .completedAt(subTask.getCompletedAt())
                .build();
    }
}
