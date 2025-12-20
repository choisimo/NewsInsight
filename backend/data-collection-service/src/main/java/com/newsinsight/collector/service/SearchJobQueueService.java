package com.newsinsight.collector.service;

import com.newsinsight.collector.dto.SearchHistoryMessage;
import com.newsinsight.collector.entity.search.SearchHistory;
import com.newsinsight.collector.entity.search.SearchType;
import com.newsinsight.collector.repository.SearchHistoryRepository;
import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/**
 * Service for managing concurrent search jobs.
 * Enables users to run multiple searches simultaneously
 * (Unified Search, Deep Search, Fact Check, etc.)
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SearchJobQueueService {

    private final SearchHistoryRepository searchHistoryRepository;
    private final SearchHistoryService searchHistoryService;
    private final UnifiedSearchService unifiedSearchService;
    private final DeepAnalysisService deepAnalysisService;

    // Active jobs tracked in memory
    private final Map<String, SearchJob> activeJobs = new ConcurrentHashMap<>();
    
    // Job listeners for SSE notifications
    private final Map<String, Consumer<SearchJobEvent>> jobListeners = new ConcurrentHashMap<>();

    // Executor for async job execution
    private final ExecutorService executorService = Executors.newFixedThreadPool(10);

    /**
     * Start a new search job
     */
    public String startJob(SearchJobRequest request) {
        String jobId = UUID.randomUUID().toString();
        
        SearchJob job = SearchJob.builder()
                .jobId(jobId)
                .type(request.getType())
                .query(request.getQuery())
                .timeWindow(request.getTimeWindow())
                .userId(request.getUserId())
                .sessionId(request.getSessionId())
                .projectId(request.getProjectId())
                .status(JobStatus.PENDING)
                .progress(0)
                .startedAt(LocalDateTime.now())
                .build();
        
        activeJobs.put(jobId, job);
        
        // Create initial SearchHistory entry
        SearchHistory history = SearchHistory.builder()
                .externalId(jobId)
                .searchType(request.getType())
                .query(request.getQuery())
                .timeWindow(request.getTimeWindow())
                .userId(request.getUserId())
                .sessionId(request.getSessionId())
                .projectId(request.getProjectId())
                .completionStatus(SearchHistory.CompletionStatus.IN_PROGRESS)
                .progress(0)
                .currentPhase("초기화 중...")
                .build();
        
        searchHistoryRepository.save(history);
        
        // Execute job asynchronously
        executeJobAsync(job);
        
        log.info("Started search job: id={}, type={}, query='{}'", jobId, request.getType(), request.getQuery());
        
        return jobId;
    }

    /**
     * Execute job asynchronously
     */
    @Async
    protected void executeJobAsync(SearchJob job) {
        try {
            job.setStatus(JobStatus.RUNNING);
            notifyJobUpdate(job, "started", "검색을 시작합니다");
            
            switch (job.getType()) {
                case UNIFIED -> executeUnifiedSearch(job);
                case DEEP_SEARCH -> executeDeepSearch(job);
                case FACT_CHECK -> executeFactCheck(job);
                case BROWSER_AGENT -> executeBrowserAgent(job);
                default -> throw new IllegalArgumentException("Unknown job type: " + job.getType());
            }
            
        } catch (Exception e) {
            log.error("Job execution failed: jobId={}, error={}", job.getJobId(), e.getMessage(), e);
            markJobFailed(job, e.getMessage());
        }
    }

    /**
     * Execute unified search
     */
    private void executeUnifiedSearch(SearchJob job) {
        updateJobProgress(job, 10, "데이터베이스 검색 중...");
        
        // Delegate to UnifiedSearchService
        // The service will handle SSE streaming and updates
        unifiedSearchService.executeSearchAsync(
                job.getJobId(),
                job.getQuery(),
                job.getTimeWindow(),
                null // priority URLs
        );
        
        // Note: Job completion is handled by the callback from UnifiedSearchService
    }

    /**
     * Execute deep search
     */
    private void executeDeepSearch(SearchJob job) {
        updateJobProgress(job, 10, "Deep Search 시작...");
        
        // Delegate to DeepAnalysisService
        deepAnalysisService.startDeepSearch(job.getQuery(), null);
        
        // Note: Job completion is handled by the callback from DeepAnalysisService
    }

    /**
     * Execute fact check (placeholder)
     */
    private void executeFactCheck(SearchJob job) {
        updateJobProgress(job, 10, "팩트체크 시작...");
        // TODO: Implement fact check execution
        markJobCompleted(job, Map.of("status", "not_implemented"));
    }

    /**
     * Execute browser agent (placeholder)
     */
    private void executeBrowserAgent(SearchJob job) {
        updateJobProgress(job, 10, "브라우저 에이전트 시작...");
        // TODO: Implement browser agent execution
        markJobCompleted(job, Map.of("status", "not_implemented"));
    }

    /**
     * Update job progress
     */
    public void updateJobProgress(String jobId, int progress, String phase) {
        SearchJob job = activeJobs.get(jobId);
        if (job != null) {
            updateJobProgress(job, progress, phase);
        }
    }

    private void updateJobProgress(SearchJob job, int progress, String phase) {
        job.setProgress(progress);
        job.setCurrentPhase(phase);
        
        // Update SearchHistory
        searchHistoryRepository.findByExternalId(job.getJobId()).ifPresent(history -> {
            history.updateProgress(progress, phase);
            searchHistoryRepository.save(history);
        });
        
        notifyJobUpdate(job, "progress", phase);
    }

    /**
     * Mark job as completed
     */
    public void markJobCompleted(String jobId, Map<String, Object> result) {
        SearchJob job = activeJobs.get(jobId);
        if (job != null) {
            markJobCompleted(job, result);
        }
    }

    private void markJobCompleted(SearchJob job, Map<String, Object> result) {
        job.setStatus(JobStatus.COMPLETED);
        job.setProgress(100);
        job.setCompletedAt(LocalDateTime.now());
        job.setResult(result);
        
        // Update SearchHistory
        searchHistoryRepository.findByExternalId(job.getJobId()).ifPresent(history -> {
            history.markCompleted();
            searchHistoryRepository.save(history);
        });
        
        notifyJobUpdate(job, "completed", "검색이 완료되었습니다");
        
        // Keep in active jobs for a while for status queries
        // Will be cleaned up by scheduled task
        
        log.info("Job completed: jobId={}, duration={}ms", 
                job.getJobId(), 
                java.time.Duration.between(job.getStartedAt(), job.getCompletedAt()).toMillis());
    }

    /**
     * Mark job as failed
     */
    public void markJobFailed(String jobId, String errorMessage) {
        SearchJob job = activeJobs.get(jobId);
        if (job != null) {
            markJobFailed(job, errorMessage);
        }
    }

    private void markJobFailed(SearchJob job, String errorMessage) {
        job.setStatus(JobStatus.FAILED);
        job.setErrorMessage(errorMessage);
        job.setCompletedAt(LocalDateTime.now());
        
        // Update SearchHistory
        searchHistoryRepository.findByExternalId(job.getJobId()).ifPresent(history -> {
            history.markFailed(job.getCurrentPhase(), errorMessage, null);
            searchHistoryRepository.save(history);
        });
        
        notifyJobUpdate(job, "failed", errorMessage);
        
        log.error("Job failed: jobId={}, error={}", job.getJobId(), errorMessage);
    }

    /**
     * Cancel a job
     */
    public boolean cancelJob(String jobId) {
        SearchJob job = activeJobs.get(jobId);
        if (job == null || job.getStatus() != JobStatus.RUNNING) {
            return false;
        }
        
        job.setStatus(JobStatus.CANCELLED);
        job.setCompletedAt(LocalDateTime.now());
        
        // Update SearchHistory
        searchHistoryRepository.findByExternalId(jobId).ifPresent(history -> {
            history.setCompletionStatus(SearchHistory.CompletionStatus.CANCELLED);
            searchHistoryRepository.save(history);
        });
        
        notifyJobUpdate(job, "cancelled", "작업이 취소되었습니다");
        
        log.info("Job cancelled: jobId={}", jobId);
        return true;
    }

    /**
     * Get job status
     */
    public Optional<SearchJob> getJobStatus(String jobId) {
        return Optional.ofNullable(activeJobs.get(jobId));
    }

    /**
     * Get active jobs for user
     */
    public List<SearchJob> getActiveJobs(String userId) {
        return activeJobs.values().stream()
                .filter(job -> userId.equals(job.getUserId()))
                .filter(job -> job.getStatus() == JobStatus.PENDING || job.getStatus() == JobStatus.RUNNING)
                .toList();
    }

    /**
     * Get all jobs for user (including completed)
     */
    public List<SearchJob> getAllJobs(String userId, int limit) {
        return activeJobs.values().stream()
                .filter(job -> userId.equals(job.getUserId()))
                .sorted((a, b) -> b.getStartedAt().compareTo(a.getStartedAt()))
                .limit(limit)
                .toList();
    }

    /**
     * Register job listener for SSE
     */
    public void registerListener(String jobId, Consumer<SearchJobEvent> listener) {
        jobListeners.put(jobId, listener);
    }

    /**
     * Unregister job listener
     */
    public void unregisterListener(String jobId) {
        jobListeners.remove(jobId);
    }

    /**
     * Notify job update to listeners
     */
    private void notifyJobUpdate(SearchJob job, String eventType, String message) {
        Consumer<SearchJobEvent> listener = jobListeners.get(job.getJobId());
        if (listener != null) {
            SearchJobEvent event = SearchJobEvent.builder()
                    .jobId(job.getJobId())
                    .eventType(eventType)
                    .status(job.getStatus())
                    .progress(job.getProgress())
                    .currentPhase(job.getCurrentPhase())
                    .message(message)
                    .timestamp(System.currentTimeMillis())
                    .build();
            
            try {
                listener.accept(event);
            } catch (Exception e) {
                log.warn("Failed to notify job listener: jobId={}, error={}", job.getJobId(), e.getMessage());
            }
        }
    }

    /**
     * Cleanup completed jobs (called by scheduler)
     */
    public void cleanupCompletedJobs() {
        LocalDateTime cutoff = LocalDateTime.now().minusHours(1);
        
        activeJobs.entrySet().removeIf(entry -> {
            SearchJob job = entry.getValue();
            return (job.getStatus() == JobStatus.COMPLETED 
                    || job.getStatus() == JobStatus.FAILED 
                    || job.getStatus() == JobStatus.CANCELLED)
                    && job.getCompletedAt() != null 
                    && job.getCompletedAt().isBefore(cutoff);
        });
    }

    // ============ DTOs ============

    @Data
    @Builder
    public static class SearchJobRequest {
        private SearchType type;
        private String query;
        private String timeWindow;
        private String userId;
        private String sessionId;
        private Long projectId;
        private Map<String, Object> options;
    }

    @Data
    @Builder
    public static class SearchJob {
        private String jobId;
        private SearchType type;
        private String query;
        private String timeWindow;
        private String userId;
        private String sessionId;
        private Long projectId;
        private JobStatus status;
        private int progress;
        private String currentPhase;
        private String errorMessage;
        private LocalDateTime startedAt;
        private LocalDateTime completedAt;
        private Map<String, Object> result;
    }

    @Data
    @Builder
    public static class SearchJobEvent {
        private String jobId;
        private String eventType;
        private JobStatus status;
        private int progress;
        private String currentPhase;
        private String message;
        private long timestamp;
    }

    public enum JobStatus {
        PENDING,
        RUNNING,
        COMPLETED,
        FAILED,
        CANCELLED
    }
}
