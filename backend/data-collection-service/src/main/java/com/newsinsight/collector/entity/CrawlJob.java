package com.newsinsight.collector.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * Entity representing a deep AI search job.
 * Tracks the status and metadata of asynchronous crawl agent requests.
 */
@Entity
@Table(name = "crawl_jobs", indexes = {
        @Index(name = "idx_crawl_jobs_status", columnList = "status"),
        @Index(name = "idx_crawl_jobs_topic", columnList = "topic"),
        @Index(name = "idx_crawl_jobs_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CrawlJob {

    @Id
    @Column(length = 64)
    private String id;

    @Column(nullable = false, length = 512)
    private String topic;

    @Column(name = "base_url", length = 2048)
    private String baseUrl;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    @Builder.Default
    private CrawlJobStatus status = CrawlJobStatus.PENDING;

    @Column(name = "evidence_count")
    @Builder.Default
    private Integer evidenceCount = 0;

    @Column(name = "error_message", length = 1024)
    private String errorMessage;

    @Enumerated(EnumType.STRING)
    @Column(name = "failure_reason", length = 64)
    private CrawlFailureReason failureReason;

    @Column(name = "callback_received")
    @Builder.Default
    private Boolean callbackReceived = false;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    /**
     * Mark the job as completed successfully
     */
    public void markCompleted(int evidenceCount) {
        this.status = CrawlJobStatus.COMPLETED;
        this.evidenceCount = evidenceCount;
        this.completedAt = LocalDateTime.now();
        this.callbackReceived = true;
    }

    /**
     * Mark the job as failed
     */
    public void markFailed(String errorMessage) {
        markFailed(errorMessage, CrawlFailureReason.fromErrorMessage(errorMessage));
    }

    /**
     * Mark the job as failed with a specific failure reason
     */
    public void markFailed(String errorMessage, CrawlFailureReason failureReason) {
        this.status = CrawlJobStatus.FAILED;
        this.errorMessage = errorMessage;
        this.failureReason = failureReason;
        this.completedAt = LocalDateTime.now();
        this.callbackReceived = true;
    }

    /**
     * Mark the job as failed from an exception
     */
    public void markFailedFromException(Throwable e) {
        CrawlFailureReason reason = CrawlFailureReason.fromException(e);
        String message = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
        markFailed(message, reason);
    }

    /**
     * Mark the job as timed out with a specific reason
     */
    public void markTimedOut(CrawlFailureReason timeoutReason) {
        this.status = CrawlJobStatus.TIMEOUT;
        this.errorMessage = timeoutReason.getDescription();
        this.failureReason = timeoutReason;
        this.completedAt = LocalDateTime.now();
        this.callbackReceived = true;
    }

    /**
     * Mark the job as in progress
     */
    public void markInProgress() {
        this.status = CrawlJobStatus.IN_PROGRESS;
    }
}
