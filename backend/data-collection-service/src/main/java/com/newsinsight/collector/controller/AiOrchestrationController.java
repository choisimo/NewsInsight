package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.AiJobDto;
import com.newsinsight.collector.dto.AiTaskCallbackRequest;
import com.newsinsight.collector.dto.DeepSearchRequest;
import com.newsinsight.collector.entity.ai.AiJobStatus;
import com.newsinsight.collector.entity.ai.AiProvider;
import com.newsinsight.collector.service.DeepOrchestrationService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Controller for AI orchestration operations.
 * Provides endpoints for:
 * - Starting orchestrated AI analysis jobs
 * - Receiving callbacks from AI workers/n8n
 * - Managing job lifecycle
 */
@RestController
@RequestMapping("/api/v1/ai")
@RequiredArgsConstructor
@Slf4j
public class AiOrchestrationController {

    private final DeepOrchestrationService orchestrationService;

    @Value("${collector.ai.orchestration.callback-token:}")
    private String expectedCallbackToken;

    /**
     * Start a new orchestrated AI analysis job.
     * 
     * @param request The analysis request containing topic and optional base URL
     * @return 202 Accepted with job details
     */
    @PostMapping("/jobs")
    public ResponseEntity<AiJobDto> startAnalysis(
            @Valid @RequestBody DeepSearchRequest request,
            @RequestParam(required = false) List<String> providers
    ) {
        log.info("Starting orchestrated AI analysis for topic: {}", request.getTopic());

        List<AiProvider> providerList = null;
        if (providers != null && !providers.isEmpty()) {
            try {
                providerList = providers.stream()
                        .map(AiProvider::valueOf)
                        .collect(Collectors.toList());
            } catch (IllegalArgumentException e) {
                return ResponseEntity.badRequest()
                        .body(AiJobDto.builder()
                                .overallStatus("ERROR")
                                .errorMessage("Invalid provider: " + e.getMessage())
                                .build());
            }
        }

        AiJobDto job = orchestrationService.startDeepAnalysis(
                request.getTopic(),
                request.getBaseUrl(),
                providerList
        );

        return ResponseEntity.status(HttpStatus.ACCEPTED).body(job);
    }

    /**
     * Get the status of an AI job.
     * 
     * @param jobId The job ID
     * @return Job status details including sub-tasks
     */
    @GetMapping("/jobs/{jobId}")
    public ResponseEntity<AiJobDto> getJobStatus(@PathVariable String jobId) {
        try {
            AiJobDto job = orchestrationService.getJobStatus(jobId);
            return ResponseEntity.ok(job);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * List all AI jobs with optional filtering.
     * 
     * @param page Page number (0-based)
     * @param size Page size
     * @param status Optional status filter
     * @return Paginated list of jobs
     */
    @GetMapping("/jobs")
    public ResponseEntity<Page<AiJobDto>> listJobs(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String status
    ) {
        AiJobStatus statusFilter = null;
        if (status != null && !status.isBlank()) {
            try {
                statusFilter = AiJobStatus.valueOf(status.toUpperCase());
            } catch (IllegalArgumentException e) {
                log.warn("Invalid status filter: {}", status);
            }
        }

        Page<AiJobDto> jobs = orchestrationService.listJobs(page, size, statusFilter);
        return ResponseEntity.ok(jobs);
    }

    /**
     * Cancel a pending or in-progress job.
     * 
     * @param jobId The job ID to cancel
     * @return Updated job status
     */
    @PostMapping("/jobs/{jobId}/cancel")
    public ResponseEntity<AiJobDto> cancelJob(@PathVariable String jobId) {
        try {
            AiJobDto job = orchestrationService.cancelJob(jobId);
            return ResponseEntity.ok(job);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * Retry failed sub-tasks for a job.
     * 
     * @param jobId The job ID
     * @return Updated job status
     */
    @PostMapping("/jobs/{jobId}/retry")
    public ResponseEntity<AiJobDto> retryJob(@PathVariable String jobId) {
        try {
            AiJobDto job = orchestrationService.retryFailedTasks(jobId);
            return ResponseEntity.ok(job);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * Callback endpoint for AI workers/n8n to deliver results.
     * 
     * @param callbackToken Token for authentication (from header)
     * @param request The callback payload
     * @return Processing result
     */
    @PostMapping("/callback")
    public ResponseEntity<?> handleCallback(
            @RequestHeader(value = "X-Callback-Token", required = false) String callbackToken,
            @RequestBody AiTaskCallbackRequest request
    ) {
        log.info("Received AI callback: jobId={}, subTaskId={}, status={}", 
                request.jobId(), request.subTaskId(), request.status());

        try {
            // Validate callback token if configured
            if (expectedCallbackToken != null && !expectedCallbackToken.isBlank()) {
                String tokenToValidate = callbackToken != null ? callbackToken : request.callbackToken();
                if (!expectedCallbackToken.equals(tokenToValidate)) {
                    log.warn("Invalid callback token for job: {}", request.jobId());
                    return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                            .body(Map.of("error", "Invalid callback token"));
                }
            }

            orchestrationService.handleCallback(request);

            return ResponseEntity.ok(Map.of(
                    "status", "received",
                    "jobId", request.jobId(),
                    "subTaskId", request.subTaskId()
            ));

        } catch (Exception e) {
            log.error("Error processing AI callback", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Failed to process callback: " + e.getMessage()));
        }
    }

    /**
     * Get available AI providers.
     */
    @GetMapping("/providers")
    public ResponseEntity<List<Map<String, String>>> getProviders() {
        List<Map<String, String>> providers = java.util.Arrays.stream(AiProvider.values())
                .map(p -> Map.of(
                        "id", p.name(),
                        "workflowPath", p.getWorkflowPath(),
                        "description", p.getDescription(),
                        "external", String.valueOf(p.isExternal())
                ))
                .collect(Collectors.toList());
        
        return ResponseEntity.ok(providers);
    }

    /**
     * Health check for AI orchestration service.
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        return ResponseEntity.ok(Map.of(
                "status", "UP",
                "service", "ai-orchestration",
                "providers", AiProvider.values().length
        ));
    }
}
