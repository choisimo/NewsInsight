package com.newsinsight.collector.service;

import com.newsinsight.collector.dto.DeepSearchJobDto;
import com.newsinsight.collector.dto.EvidenceDto;
import com.newsinsight.collector.entity.CrawlFailureReason;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Sinks;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Service for managing SSE streams for deep search jobs.
 * Each job has its own event sink that clients can subscribe to.
 */
@Service
@Slf4j
public class DeepSearchEventService {

    // Map of jobId -> Sinks for that job
    private final Map<String, Sinks.Many<ServerSentEvent<Object>>> jobSinks = new ConcurrentHashMap<>();
    
    // Timeout for inactive sinks (30 minutes)
    // @CHECK 싱크 타임아웃 설정이 필요할 것 같음
    private static final Duration SINK_TIMEOUT = Duration.ofMinutes(30);

    /**
     * Get or create a sink for a job.
     * 
     * @param jobId The job ID
     * @return The event sink for this job
     */
    private Sinks.Many<ServerSentEvent<Object>> getOrCreateSink(String jobId) {
        return jobSinks.computeIfAbsent(jobId, id -> {
            log.info("Creating new SSE sink for job: {}", id);
            return Sinks.many().multicast().onBackpressureBuffer(100);
        });
    }

    /**
     * Get the event stream for a specific job.
     * Includes heartbeats every 15 seconds to keep connection alive.
     * 
     * @param jobId The job ID to subscribe to
     * @return SSE event stream
     */
    public Flux<ServerSentEvent<Object>> getJobEventStream(String jobId) {
        Sinks.Many<ServerSentEvent<Object>> sink = getOrCreateSink(jobId);
        
        // Heartbeat stream
        Flux<ServerSentEvent<Object>> heartbeat = Flux.interval(Duration.ofSeconds(15))
                .map(tick -> ServerSentEvent.builder()
                        .event("heartbeat")
                        .data(Map.of(
                                "eventType", "heartbeat",
                                "jobId", jobId,
                                "timestamp", System.currentTimeMillis()
                        ))
                        .build());

        // Main event stream from sink
        Flux<ServerSentEvent<Object>> events = sink.asFlux();

        return Flux.merge(heartbeat, events)
                .doOnSubscribe(sub -> log.info("New SSE subscriber for job: {}", jobId))
                .doOnCancel(() -> log.info("SSE subscriber disconnected for job: {}", jobId))
                .doOnError(e -> log.error("SSE stream error for job: {}", jobId, e));
    }

    /**
     * Publish a status update event.
     * 
     * @param jobId The job ID
     * @param status Current status
     * @param message Optional message
     */
    public void publishStatusUpdate(String jobId, String status, String message) {
        Sinks.Many<ServerSentEvent<Object>> sink = jobSinks.get(jobId);
        if (sink == null) {
            log.debug("No sink found for job: {}, creating new one", jobId);
            sink = getOrCreateSink(jobId);
        }

        ServerSentEvent<Object> event = ServerSentEvent.builder()
                .event("status")
                .data(Map.of(
                        "eventType", "status",
                        "jobId", jobId,
                        "status", status,
                        "message", message != null ? message : "",
                        "timestamp", System.currentTimeMillis()
                ))
                .build();

        sink.tryEmitNext(event);
        log.debug("Published status event for job: {}, status: {}", jobId, status);
    }

    /**
     * Publish a progress update event.
     * 
     * @param jobId The job ID
     * @param progress Progress percentage (0-100)
     * @param currentStep Current step description
     */
    public void publishProgressUpdate(String jobId, int progress, String currentStep) {
        Sinks.Many<ServerSentEvent<Object>> sink = jobSinks.get(jobId);
        if (sink == null) return;

        ServerSentEvent<Object> event = ServerSentEvent.builder()
                .event("progress")
                .data(Map.of(
                        "eventType", "progress",
                        "jobId", jobId,
                        "progress", progress,
                        "progressMessage", currentStep,
                        "timestamp", System.currentTimeMillis()
                ))
                .build();

        sink.tryEmitNext(event);
        log.debug("Published progress event for job: {}, progress: {}%", jobId, progress);
    }

    /**
     * Publish an evidence discovered event.
     * 
     * @param jobId The job ID
     * @param evidence The evidence DTO
     */
    public void publishEvidence(String jobId, EvidenceDto evidence) {
        Sinks.Many<ServerSentEvent<Object>> sink = jobSinks.get(jobId);
        if (sink == null) return;

        // Get current evidence count from the sink's context or use a simple counter
        int evidenceCount = evidence.getId() != null ? evidence.getId().intValue() : 1;

        ServerSentEvent<Object> event = ServerSentEvent.builder()
                .event("evidence")
                .data(Map.of(
                        "eventType", "evidence",
                        "jobId", jobId,
                        "evidence", evidence,
                        "evidenceCount", evidenceCount,
                        "timestamp", System.currentTimeMillis()
                ))
                .build();

        sink.tryEmitNext(event);
        log.debug("Published evidence event for job: {}, url: {}", jobId, evidence.getUrl());
    }

    /**
     * Publish a job completion event.
     * 
     * @param jobId The job ID
     * @param jobDto The final job DTO
     */
    public void publishComplete(String jobId, DeepSearchJobDto jobDto) {
        Sinks.Many<ServerSentEvent<Object>> sink = jobSinks.get(jobId);
        if (sink == null) return;

        ServerSentEvent<Object> event = ServerSentEvent.builder()
                .event("complete")
                .data(Map.of(
                        "eventType", "complete",
                        "jobId", jobId,
                        "result", jobDto,
                        "timestamp", System.currentTimeMillis()
                ))
                .build();

        sink.tryEmitNext(event);
        log.info("Published complete event for job: {}", jobId);

        // Complete the sink and schedule cleanup
        sink.tryEmitComplete();
        scheduleCleanup(jobId);
    }

    /**
     * Publish an error event.
     * 
     * @param jobId The job ID
     * @param errorMessage Error message
     */
    public void publishError(String jobId, String errorMessage) {
        publishError(jobId, errorMessage, null);
    }

    /**
     * Publish an error event with a failure reason.
     * 
     * @param jobId The job ID
     * @param errorMessage Error message
     * @param failureReason The categorized failure reason for diagnostics
     */
    public void publishError(String jobId, String errorMessage, CrawlFailureReason failureReason) {
        Sinks.Many<ServerSentEvent<Object>> sink = jobSinks.get(jobId);
        if (sink == null) return;

        // Build error data map with optional failure reason
        java.util.Map<String, Object> errorData = new java.util.HashMap<>();
        errorData.put("eventType", "error");
        errorData.put("jobId", jobId);
        errorData.put("error", errorMessage);
        errorData.put("timestamp", System.currentTimeMillis());
        
        if (failureReason != null) {
            errorData.put("failureReason", failureReason.getCode());
            errorData.put("failureCategory", categorizeFailureReason(failureReason));
            errorData.put("failureDescription", failureReason.getDescription());
        }

        ServerSentEvent<Object> event = ServerSentEvent.builder()
                .event("error")
                .data(errorData)
                .build();

        sink.tryEmitNext(event);
        log.info("Published error event for job: {}, error: {}, reason: {}", 
                jobId, errorMessage, failureReason != null ? failureReason.getCode() : "unknown");

        // Complete the sink and schedule cleanup
        sink.tryEmitComplete();
        scheduleCleanup(jobId);
    }

    /**
     * Categorize failure reason into high-level categories for frontend display
     */
    private String categorizeFailureReason(CrawlFailureReason reason) {
        if (reason == null) return "unknown";
        
        String code = reason.getCode();
        if (code.startsWith("timeout")) return "timeout";
        if (code.contains("connection") || code.contains("dns") || code.contains("network") || code.contains("ssl")) return "network";
        if (code.contains("service") || code.contains("unavailable") || code.contains("overloaded")) return "service";
        if (code.contains("content") || code.contains("parse") || code.contains("blocked")) return "content";
        if (code.contains("ai") || code.contains("evidence") || code.contains("stance")) return "processing";
        if (code.contains("cancelled") || code.contains("callback") || code.contains("token")) return "job";
        return "unknown";
    }

    /**
     * Schedule cleanup of a job's sink after a delay.
     * 
     * @param jobId The job ID to clean up
     */
    private void scheduleCleanup(String jobId) {
        // Use virtual thread or executor for delayed cleanup
        Thread.startVirtualThread(() -> {
            try {
                Thread.sleep(Duration.ofMinutes(5));
                jobSinks.remove(jobId);
                log.debug("Cleaned up sink for job: {}", jobId);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });
    }

    /**
     * Remove a job's sink immediately.
     * 
     * @param jobId The job ID
     */
    public void removeSink(String jobId) {
        Sinks.Many<ServerSentEvent<Object>> sink = jobSinks.remove(jobId);
        if (sink != null) {
            sink.tryEmitComplete();
            log.debug("Removed sink for job: {}", jobId);
        }
    }

    /**
     * Check if a job has an active sink.
     * 
     * @param jobId The job ID
     * @return true if there's an active sink
     */
    public boolean hasSink(String jobId) {
        return jobSinks.containsKey(jobId);
    }

    /**
     * Get the number of active sinks.
     * 
     * @return Count of active sinks
     */
    public int getActiveSinkCount() {
        return jobSinks.size();
    }
}
