package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.*;
import com.newsinsight.collector.entity.CrawlJobStatus;
import com.newsinsight.collector.service.DeepAnalysisService;
import com.newsinsight.collector.service.DeepSearchEventService;
import com.newsinsight.collector.service.IntegratedCrawlerService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Flux;

import java.util.List;
import java.util.Map;

/**
 * Controller for deep AI search operations.
 * Provides endpoints for:
 * - Starting a new deep search
 * - Receiving callbacks from internal workers
 * - Retrieving search results
 * - Real-time SSE streaming of search progress
 * 
 * Uses IntegratedCrawlerService for multi-strategy crawling:
 * - Crawl4AI for JS-rendered pages
 * - Browser-Use API for complex interactions
 * - Direct HTTP for simple pages
 * - Search Engines for topic-based searches
 */
@RestController
@RequestMapping("/api/v1/analysis/deep")
@RequiredArgsConstructor
@Slf4j
public class DeepAnalysisController {

    private final DeepAnalysisService deepAnalysisService;
    private final DeepSearchEventService deepSearchEventService;
    private final IntegratedCrawlerService integratedCrawlerService;

    /**
     * Start a new deep AI search job.
     * 
     * @param request The search request containing topic and optional base URL
     * @return 202 Accepted with job details
     */
    @PostMapping
    public ResponseEntity<DeepSearchJobDto> startDeepSearch(
            @Valid @RequestBody DeepSearchRequest request
    ) {
        log.info("Starting deep search for topic: {}", request.getTopic());
        
        if (!integratedCrawlerService.isAvailable()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(DeepSearchJobDto.builder()
                            .status("UNAVAILABLE")
                            .errorMessage("Deep search service is not available. Please check crawler configuration.")
                            .build());
        }

        DeepSearchJobDto job = deepAnalysisService.startDeepSearch(
                request.getTopic(),
                request.getBaseUrl()
        );

        return ResponseEntity.status(HttpStatus.ACCEPTED).body(job);
    }

    /**
     * Get the status of a deep search job.
     * 
     * @param jobId The job ID
     * @return Job status details
     */
    @GetMapping("/{jobId}")
    public ResponseEntity<DeepSearchJobDto> getJobStatus(@PathVariable String jobId) {
        try {
            DeepSearchJobDto job = deepAnalysisService.getJobStatus(jobId);
            return ResponseEntity.ok(job);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * Get the full results of a completed deep search.
     * 
     * @param jobId The job ID
     * @return Full search results including evidence
     */
    @GetMapping("/{jobId}/result")
    public ResponseEntity<DeepSearchResultDto> getSearchResult(@PathVariable String jobId) {
        try {
            DeepSearchResultDto result = deepAnalysisService.getSearchResult(jobId);
            return ResponseEntity.ok(result);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * SSE stream for real-time job updates.
     * Clients can subscribe to this endpoint to receive live updates for a job.
     * 
     * Events:
     * - status: Job status changes (PENDING, IN_PROGRESS, COMPLETED, FAILED)
     * - progress: Progress updates (0-100%)
     * - evidence: New evidence found during the search
     * - complete: Job completed successfully
     * - error: Job failed with error
     * - heartbeat: Keep-alive ping every 15 seconds
     * 
     * @param jobId The job ID to subscribe to
     * @return SSE event stream
     */
    @GetMapping(value = "/{jobId}/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<Object>> streamJobUpdates(@PathVariable String jobId) {
        log.info("New SSE client subscribed to job: {}", jobId);
        
        // Validate job exists
        try {
            DeepSearchJobDto job = deepAnalysisService.getJobStatus(jobId);
            
            // If job is already completed or failed, send immediate result and close
            if ("COMPLETED".equals(job.getStatus()) || "FAILED".equals(job.getStatus()) 
                    || "CANCELLED".equals(job.getStatus()) || "TIMEOUT".equals(job.getStatus())) {
                log.info("Job {} already finished with status: {}, sending immediate result", jobId, job.getStatus());
                return Flux.just(ServerSentEvent.builder()
                        .event("complete")
                        .data(Map.of(
                                "jobId", jobId,
                                "job", job,
                                "timestamp", System.currentTimeMillis()
                        ))
                        .build());
            }
        } catch (IllegalArgumentException e) {
            log.warn("SSE subscription for unknown job: {}", jobId);
            return Flux.just(ServerSentEvent.builder()
                    .event("error")
                    .data(Map.of(
                            "jobId", jobId,
                            "error", "Job not found: " + jobId,
                            "timestamp", System.currentTimeMillis()
                    ))
                    .build());
        }

        return deepSearchEventService.getJobEventStream(jobId);
    }

    /**
     * List all deep search jobs with optional filtering.
     * 
     * @param page Page number (0-based)
     * @param size Page size
     * @param status Optional status filter
     * @return Paginated list of jobs
     */
    @GetMapping
    public ResponseEntity<Page<DeepSearchJobDto>> listJobs(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String status
    ) {
        CrawlJobStatus statusFilter = null;
        if (status != null && !status.isBlank()) {
            try {
                statusFilter = CrawlJobStatus.valueOf(status.toUpperCase());
            } catch (IllegalArgumentException e) {
                log.warn("Invalid status filter: {}", status);
            }
        }

        Page<DeepSearchJobDto> jobs = deepAnalysisService.listJobs(page, size, statusFilter);
        return ResponseEntity.ok(jobs);
    }

    /**
     * Cancel a pending or in-progress job.
     * 
     * @param jobId The job ID to cancel
     * @return Updated job status
     */
    @PostMapping("/{jobId}/cancel")
    public ResponseEntity<DeepSearchJobDto> cancelJob(@PathVariable String jobId) {
        try {
            DeepSearchJobDto job = deepAnalysisService.cancelJob(jobId);
            return ResponseEntity.ok(job);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * Callback endpoint for internal async workers to deliver results.
     * This can be used by future Kafka-based workers or other internal services.
     * 
     * @param callbackToken Token for authentication (from header)
     * @param payload The callback payload
     * @return Processing result
     */
    @PostMapping("/callback")
    public ResponseEntity<?> handleCallback(
            @RequestHeader(value = "X-Crawl-Callback-Token", required = false) String callbackToken,
            @RequestBody DeepSearchCallbackDto payload
    ) {
        log.info("Received internal callback for job: {}, status: {}", payload.getJobId(), payload.getStatus());

        try {
            // Convert DTO evidence to service format
            List<EvidenceDto> evidenceList = payload.getEvidence() != null 
                    ? payload.getEvidence().stream()
                            .map(e -> EvidenceDto.builder()
                                    .url(e.getUrl())
                                    .title(e.getTitle())
                                    .stance(e.getStance())
                                    .snippet(e.getSnippet())
                                    .source(e.getSource())
                                    .build())
                            .toList()
                    : List.of();

            DeepSearchResultDto result = deepAnalysisService.processInternalCallback(
                    callbackToken, 
                    payload.getJobId(),
                    payload.getStatus(),
                    evidenceList
            );
            
            return ResponseEntity.ok(Map.of(
                    "status", "received",
                    "jobId", result.getJobId(),
                    "evidenceCount", result.getEvidenceCount()
            ));

        } catch (SecurityException e) {
            log.warn("Callback authentication failed: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Invalid callback token"));

        } catch (IllegalArgumentException e) {
            log.warn("Callback for unknown job: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", e.getMessage()));

        } catch (Exception e) {
            log.error("Error processing callback", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Failed to process callback: " + e.getMessage()));
        }
    }

    /**
     * Health check for deep search service.
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        boolean isAvailable = integratedCrawlerService.isAvailable();
        return ResponseEntity.ok(Map.of(
                "available", isAvailable,
                "service", "IntegratedCrawlerService",
                "status", isAvailable ? "READY" : "UNAVAILABLE"
        ));
    }
}
