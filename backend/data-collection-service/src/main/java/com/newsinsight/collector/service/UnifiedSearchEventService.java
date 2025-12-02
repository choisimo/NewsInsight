package com.newsinsight.collector.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Sinks;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Service for managing SSE streams for unified search jobs.
 * Each job has its own event sink that clients can subscribe to.
 * 
 * This follows the same pattern as DeepSearchEventService to enable:
 * - Job-based async search execution
 * - SSE stream reconnection with same jobId
 * - Page navigation without losing search results
 */
@Service
@Slf4j
public class UnifiedSearchEventService {

    // Map of jobId -> Sinks for that job
    private final Map<String, Sinks.Many<ServerSentEvent<Object>>> jobSinks = new ConcurrentHashMap<>();
    
    // Map of jobId -> Job metadata (status, query, etc.)
    private final Map<String, JobMetadata> jobMetadataMap = new ConcurrentHashMap<>();

    /**
     * Metadata for a search job.
     */
    public record JobMetadata(
            String jobId,
            String query,
            String window,
            String status, // PENDING, IN_PROGRESS, COMPLETED, FAILED
            long createdAt,
            Long completedAt
    ) {
        public JobMetadata withStatus(String newStatus) {
            return new JobMetadata(jobId, query, window, newStatus, createdAt, 
                    "COMPLETED".equals(newStatus) || "FAILED".equals(newStatus) 
                            ? Long.valueOf(System.currentTimeMillis()) : completedAt);
        }
    }

    /**
     * Create a new job and return its metadata.
     */
    public JobMetadata createJob(String jobId, String query, String window) {
        JobMetadata metadata = new JobMetadata(jobId, query, window, "PENDING", System.currentTimeMillis(), null);
        jobMetadataMap.put(jobId, metadata);
        getOrCreateSink(jobId); // Ensure sink is created
        log.info("Created unified search job: {} for query: '{}'", jobId, query);
        return metadata;
    }

    /**
     * Get job metadata.
     */
    public JobMetadata getJobMetadata(String jobId) {
        return jobMetadataMap.get(jobId);
    }

    /**
     * Update job status.
     */
    public void updateJobStatus(String jobId, String status) {
        JobMetadata existing = jobMetadataMap.get(jobId);
        if (existing != null) {
            jobMetadataMap.put(jobId, existing.withStatus(status));
        }
    }

    /**
     * Get or create a sink for a job.
     */
    private Sinks.Many<ServerSentEvent<Object>> getOrCreateSink(String jobId) {
        return jobSinks.computeIfAbsent(jobId, id -> {
            log.info("Creating new SSE sink for unified search job: {}", id);
            return Sinks.many().multicast().onBackpressureBuffer(200);
        });
    }

    /**
     * Get the event stream for a specific job.
     * Includes heartbeats every 15 seconds to keep connection alive.
     */
    public Flux<ServerSentEvent<Object>> getJobEventStream(String jobId) {
        Sinks.Many<ServerSentEvent<Object>> sink = getOrCreateSink(jobId);
        
        // Heartbeat stream
        Flux<ServerSentEvent<Object>> heartbeat = Flux.interval(Duration.ofSeconds(15))
                .map(tick -> ServerSentEvent.builder()
                        .event("heartbeat")
                        .data(Map.of("timestamp", System.currentTimeMillis(), "jobId", jobId))
                        .build());

        // Main event stream from sink
        Flux<ServerSentEvent<Object>> events = sink.asFlux();

        // Check if job is already completed - send initial status
        JobMetadata metadata = jobMetadataMap.get(jobId);
        Flux<ServerSentEvent<Object>> initialStatus = Flux.empty();
        if (metadata != null) {
            initialStatus = Flux.just(ServerSentEvent.builder()
                    .event("job_status")
                    .data(Map.of(
                            "jobId", jobId,
                            "query", metadata.query(),
                            "window", metadata.window(),
                            "status", metadata.status(),
                            "createdAt", metadata.createdAt()
                    ))
                    .build());
        }

        return Flux.concat(initialStatus, Flux.merge(heartbeat, events))
                .doOnSubscribe(sub -> log.info("New SSE subscriber for unified search job: {}", jobId))
                .doOnCancel(() -> log.info("SSE subscriber disconnected for unified search job: {}", jobId))
                .doOnError(e -> log.error("SSE stream error for unified search job: {}", jobId, e));
    }

    /**
     * Publish a status update event.
     */
    public void publishStatusUpdate(String jobId, String source, String message) {
        Sinks.Many<ServerSentEvent<Object>> sink = jobSinks.get(jobId);
        if (sink == null) {
            log.debug("No sink found for job: {}, creating new one", jobId);
            sink = getOrCreateSink(jobId);
        }

        ServerSentEvent<Object> event = ServerSentEvent.builder()
                .event("status")
                .data(Map.of(
                        "jobId", jobId,
                        "eventType", "status",
                        "source", source,
                        "message", message != null ? message : "",
                        "timestamp", System.currentTimeMillis()
                ))
                .build();

        sink.tryEmitNext(event);
        log.debug("Published status event for job: {}, source: {}", jobId, source);
    }

    /**
     * Publish a search result event.
     */
    public void publishResult(String jobId, String source, Object result) {
        Sinks.Many<ServerSentEvent<Object>> sink = jobSinks.get(jobId);
        if (sink == null) return;

        ServerSentEvent<Object> event = ServerSentEvent.builder()
                .event("result")
                .data(Map.of(
                        "jobId", jobId,
                        "eventType", "result",
                        "source", source,
                        "result", result,
                        "timestamp", System.currentTimeMillis()
                ))
                .build();

        sink.tryEmitNext(event);
        log.debug("Published result event for job: {}, source: {}", jobId, source);
    }

    /**
     * Publish an AI chunk event.
     */
    public void publishAiChunk(String jobId, String chunk) {
        Sinks.Many<ServerSentEvent<Object>> sink = jobSinks.get(jobId);
        if (sink == null) return;

        ServerSentEvent<Object> event = ServerSentEvent.builder()
                .event("ai_chunk")
                .data(Map.of(
                        "jobId", jobId,
                        "eventType", "ai_chunk",
                        "source", "ai",
                        "message", chunk,
                        "timestamp", System.currentTimeMillis()
                ))
                .build();

        sink.tryEmitNext(event);
    }

    /**
     * Publish a source complete event.
     */
    public void publishSourceComplete(String jobId, String source, String message, int totalCount) {
        Sinks.Many<ServerSentEvent<Object>> sink = jobSinks.get(jobId);
        if (sink == null) return;

        ServerSentEvent<Object> event = ServerSentEvent.builder()
                .event("source_complete")
                .data(Map.of(
                        "jobId", jobId,
                        "eventType", "complete",
                        "source", source,
                        "message", message != null ? message : "",
                        "totalCount", totalCount,
                        "timestamp", System.currentTimeMillis()
                ))
                .build();

        sink.tryEmitNext(event);
        log.debug("Published source complete event for job: {}, source: {}, count: {}", jobId, source, totalCount);
    }

    /**
     * Publish an error event for a source.
     */
    public void publishSourceError(String jobId, String source, String errorMessage) {
        Sinks.Many<ServerSentEvent<Object>> sink = jobSinks.get(jobId);
        if (sink == null) return;

        ServerSentEvent<Object> event = ServerSentEvent.builder()
                .event("source_error")
                .data(Map.of(
                        "jobId", jobId,
                        "eventType", "error",
                        "source", source,
                        "message", errorMessage,
                        "timestamp", System.currentTimeMillis()
                ))
                .build();

        sink.tryEmitNext(event);
        log.warn("Published source error event for job: {}, source: {}, error: {}", jobId, source, errorMessage);
    }

    /**
     * Publish a job completion event (all sources done).
     */
    public void publishJobComplete(String jobId, int totalResults) {
        updateJobStatus(jobId, "COMPLETED");
        
        Sinks.Many<ServerSentEvent<Object>> sink = jobSinks.get(jobId);
        if (sink == null) return;

        ServerSentEvent<Object> event = ServerSentEvent.builder()
                .event("done")
                .data(Map.of(
                        "jobId", jobId,
                        "totalResults", totalResults,
                        "message", "Search completed",
                        "timestamp", System.currentTimeMillis()
                ))
                .build();

        sink.tryEmitNext(event);
        log.info("Published job complete event for job: {}, total results: {}", jobId, totalResults);

        // Complete the sink and schedule cleanup
        sink.tryEmitComplete();
        scheduleCleanup(jobId);
    }

    /**
     * Publish a job error event.
     */
    public void publishJobError(String jobId, String errorMessage) {
        updateJobStatus(jobId, "FAILED");
        
        Sinks.Many<ServerSentEvent<Object>> sink = jobSinks.get(jobId);
        if (sink == null) return;

        ServerSentEvent<Object> event = ServerSentEvent.builder()
                .event("job_error")
                .data(Map.of(
                        "jobId", jobId,
                        "error", errorMessage,
                        "timestamp", System.currentTimeMillis()
                ))
                .build();

        sink.tryEmitNext(event);
        log.error("Published job error event for job: {}, error: {}", jobId, errorMessage);

        sink.tryEmitComplete();
        scheduleCleanup(jobId);
    }

    /**
     * Schedule cleanup of a job's sink after a delay.
     */
    private void scheduleCleanup(String jobId) {
        Thread.startVirtualThread(() -> {
            try {
                Thread.sleep(Duration.ofMinutes(10)); // Keep completed jobs for 10 minutes
                jobSinks.remove(jobId);
                jobMetadataMap.remove(jobId);
                log.debug("Cleaned up sink and metadata for job: {}", jobId);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });
    }

    /**
     * Remove a job's sink immediately.
     */
    public void removeSink(String jobId) {
        Sinks.Many<ServerSentEvent<Object>> sink = jobSinks.remove(jobId);
        if (sink != null) {
            sink.tryEmitComplete();
            log.debug("Removed sink for job: {}", jobId);
        }
        jobMetadataMap.remove(jobId);
    }

    /**
     * Check if a job exists.
     */
    public boolean hasJob(String jobId) {
        return jobMetadataMap.containsKey(jobId);
    }

    /**
     * Get the number of active jobs.
     */
    public int getActiveJobCount() {
        return jobSinks.size();
    }
}
