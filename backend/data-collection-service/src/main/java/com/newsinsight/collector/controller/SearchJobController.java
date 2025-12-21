package com.newsinsight.collector.controller;

import com.newsinsight.collector.entity.search.SearchType;
import com.newsinsight.collector.service.SearchJobQueueService;
import com.newsinsight.collector.service.SearchJobQueueService.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Sinks;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * REST Controller for Search Job Queue API.
 * Enables concurrent search execution and real-time job monitoring.
 */
@RestController
@RequestMapping("/api/v1/jobs")
@RequiredArgsConstructor
@Slf4j
public class SearchJobController {

    private final SearchJobQueueService searchJobQueueService;

    // SSE sinks for job-specific streaming
    private final Map<String, Sinks.Many<SearchJobEvent>> jobSinks = new ConcurrentHashMap<>();

    // ============================================
    // Job Creation
    // ============================================

    /**
     * Start a new search job.
     * Supports concurrent execution of multiple job types.
     */
    @PostMapping
    public ResponseEntity<Map<String, Object>> startJob(
            @RequestBody JobStartRequest request,
            @RequestHeader(value = "X-User-Id", required = false) String userId,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId
    ) {
        log.info("Starting new search job: type={}, query='{}', userId={}, sessionId={}", 
                request.type(), request.query(), userId, sessionId);

        if (request.query() == null || request.query().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "Query is required"
            ));
        }

        if (request.type() == null) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "Search type is required"
            ));
        }

        // Use headers if request doesn't specify userId/sessionId
        String effectiveUserId = request.userId() != null ? request.userId() : userId;
        String effectiveSessionId = request.sessionId() != null ? request.sessionId() : sessionId;

        SearchJobRequest jobRequest = SearchJobRequest.builder()
                .type(request.type())
                .query(request.query())
                .timeWindow(request.timeWindow() != null ? request.timeWindow() : "7d")
                .userId(effectiveUserId)
                .sessionId(effectiveSessionId)
                .projectId(request.projectId())
                .options(request.options())
                .build();

        String jobId = searchJobQueueService.startJob(jobRequest);

        return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of(
                "jobId", jobId,
                "type", request.type().name(),
                "query", request.query(),
                "status", "PENDING",
                "message", "검색 작업이 시작되었습니다"
        ));
    }

    /**
     * Start multiple search jobs concurrently.
     * Enables running Unified Search, Deep Search, etc. at the same time.
     */
    @PostMapping("/batch")
    public ResponseEntity<Map<String, Object>> startBatchJobs(@RequestBody List<JobStartRequest> requests) {
        log.info("Starting batch jobs: count={}", requests.size());

        if (requests.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "At least one job request is required"
            ));
        }

        List<Map<String, Object>> startedJobs = requests.stream()
                .map(request -> {
                    SearchJobRequest jobRequest = SearchJobRequest.builder()
                            .type(request.type())
                            .query(request.query())
                            .timeWindow(request.timeWindow() != null ? request.timeWindow() : "7d")
                            .userId(request.userId())
                            .sessionId(request.sessionId())
                            .projectId(request.projectId())
                            .options(request.options())
                            .build();

                    String jobId = searchJobQueueService.startJob(jobRequest);

                    return Map.<String, Object>of(
                            "jobId", jobId,
                            "type", request.type().name(),
                            "query", request.query(),
                            "status", "PENDING"
                    );
                })
                .toList();

        return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of(
                "jobs", startedJobs,
                "count", startedJobs.size(),
                "message", String.format("%d개의 검색 작업이 시작되었습니다", startedJobs.size())
        ));
    }

    // ============================================
    // Job Status & Query
    // ============================================

    /**
     * Get status of a specific job.
     */
    @GetMapping("/{jobId}")
    public ResponseEntity<SearchJob> getJobStatus(@PathVariable String jobId) {
        return searchJobQueueService.getJobStatus(jobId)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Get active jobs for user.
     */
    @GetMapping("/active")
    public ResponseEntity<List<SearchJob>> getActiveJobs(
            @RequestParam(required = false) String userId,
            @RequestHeader(value = "X-User-Id", required = false) String headerUserId
    ) {
        // Use header userId if not provided in query param
        String effectiveUserId = userId != null ? userId : headerUserId;
        List<SearchJob> activeJobs = searchJobQueueService.getActiveJobs(effectiveUserId);
        return ResponseEntity.ok(activeJobs);
    }

    /**
     * Get all jobs for user (with limit).
     */
    @GetMapping
    public ResponseEntity<List<SearchJob>> getAllJobs(
            @RequestParam(required = false) String userId,
            @RequestParam(required = false, defaultValue = "20") int limit,
            @RequestHeader(value = "X-User-Id", required = false) String headerUserId
    ) {
        // Use header userId if not provided in query param
        String effectiveUserId = userId != null ? userId : headerUserId;
        List<SearchJob> jobs = searchJobQueueService.getAllJobs(effectiveUserId, limit);
        return ResponseEntity.ok(jobs);
    }

    // ============================================
    // Job Control
    // ============================================

    /**
     * Cancel a running job.
     */
    @PostMapping("/{jobId}/cancel")
    public ResponseEntity<Map<String, Object>> cancelJob(@PathVariable String jobId) {
        log.info("Cancelling job: jobId={}", jobId);

        boolean cancelled = searchJobQueueService.cancelJob(jobId);

        if (cancelled) {
            return ResponseEntity.ok(Map.of(
                    "jobId", jobId,
                    "status", "CANCELLED",
                    "message", "작업이 취소되었습니다"
            ));
        } else {
            return ResponseEntity.badRequest().body(Map.of(
                    "jobId", jobId,
                    "error", "작업을 취소할 수 없습니다 (이미 완료되었거나 존재하지 않음)"
            ));
        }
    }

    // ============================================
    // SSE Real-time Job Streaming
    // ============================================

    /**
     * SSE endpoint for real-time job updates.
     * Stream updates for a specific job.
     */
    @GetMapping(value = "/{jobId}/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<SearchJobEvent>> streamJobUpdates(@PathVariable String jobId) {
        log.info("New SSE client connected to job stream: jobId={}", jobId);

        // Create or get sink for this job
        Sinks.Many<SearchJobEvent> sink = jobSinks.computeIfAbsent(
                jobId,
                id -> Sinks.many().multicast().onBackpressureBuffer()
        );

        // Register listener with the service
        searchJobQueueService.registerListener(jobId, event -> {
            sink.tryEmitNext(event);

            // Cleanup on completion
            if ("completed".equals(event.getEventType()) ||
                    "failed".equals(event.getEventType()) ||
                    "cancelled".equals(event.getEventType())) {
                // Emit complete signal after a delay
                sink.tryEmitComplete();
                jobSinks.remove(jobId);
            }
        });

        // Add heartbeat to keep connection alive
        Flux<ServerSentEvent<SearchJobEvent>> heartbeat = Flux.interval(Duration.ofSeconds(15))
                .map(i -> ServerSentEvent.<SearchJobEvent>builder()
                        .id(String.valueOf(System.currentTimeMillis()))
                        .event("heartbeat")
                        .data(SearchJobEvent.builder()
                                .jobId(jobId)
                                .eventType("heartbeat")
                                .timestamp(System.currentTimeMillis())
                                .build())
                        .build());

        Flux<ServerSentEvent<SearchJobEvent>> events = sink.asFlux()
                .map(event -> ServerSentEvent.<SearchJobEvent>builder()
                        .id(String.valueOf(event.getTimestamp()))
                        .event(event.getEventType())
                        .data(event)
                        .build())
                .doOnCancel(() -> {
                    searchJobQueueService.unregisterListener(jobId);
                    jobSinks.remove(jobId);
                });

        return Flux.merge(events, heartbeat)
                .doFinally(signal -> {
                    searchJobQueueService.unregisterListener(jobId);
                    jobSinks.remove(jobId);
                });
    }

    /**
     * SSE endpoint for all active jobs of a user.
     * Stream updates for all active jobs.
     */
    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<Map<String, Object>>> streamAllJobs(
            @RequestParam(required = false, defaultValue = "anonymous") String userId
    ) {
        log.info("New SSE client connected to all-jobs stream: userId={}", userId);

        // Poll for job updates every 2 seconds
        return Flux.interval(Duration.ofSeconds(2))
                .map(i -> {
                    List<SearchJob> activeJobs = searchJobQueueService.getActiveJobs(userId);
                    return ServerSentEvent.<Map<String, Object>>builder()
                            .id(String.valueOf(System.currentTimeMillis()))
                            .event("jobs_update")
                            .data(Map.of(
                                    "jobs", activeJobs,
                                    "count", activeJobs.size(),
                                    "timestamp", System.currentTimeMillis()
                            ))
                            .build();
                })
                .takeUntilOther(Flux.never()); // Keep alive until client disconnects
    }

    // ============================================
    // Health & Stats
    // ============================================

    /**
     * Health check endpoint.
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        return ResponseEntity.ok(Map.of(
                "status", "available",
                "features", Map.of(
                        "concurrentJobs", true,
                        "batchStart", true,
                        "jobCancellation", true,
                        "sseStreaming", true
                ),
                "supportedTypes", List.of(
                        SearchType.UNIFIED.name(),
                        SearchType.DEEP_SEARCH.name(),
                        SearchType.FACT_CHECK.name(),
                        SearchType.BROWSER_AGENT.name()
                )
        ));
    }

    // ============================================
    // DTOs
    // ============================================

    /**
     * Request DTO for starting a job.
     */
    public record JobStartRequest(
            SearchType type,
            String query,
            String timeWindow,
            String userId,
            String sessionId,
            Long projectId,
            Map<String, Object> options
    ) {}
}
