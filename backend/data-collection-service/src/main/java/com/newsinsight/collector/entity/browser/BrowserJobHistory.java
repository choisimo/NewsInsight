package com.newsinsight.collector.entity.browser;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Entity for storing Browser-Use automation job history.
 * Tracks all browser automation tasks with their results,
 * screenshots, and extracted data.
 */
@Entity
@Table(name = "browser_job_history", indexes = {
        @Index(name = "idx_browser_job_job_id", columnList = "job_id"),
        @Index(name = "idx_browser_job_user_id", columnList = "user_id"),
        @Index(name = "idx_browser_job_status", columnList = "status"),
        @Index(name = "idx_browser_job_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BrowserJobHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Unique job ID from browser-use service
     */
    @Column(name = "job_id", length = 64, unique = true)
    private String jobId;

    /**
     * Task description
     */
    @Column(name = "task", nullable = false, length = 2048)
    private String task;

    /**
     * Target URL if specified
     */
    @Column(name = "target_url", length = 2048)
    private String targetUrl;

    /**
     * User ID
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Session ID
     */
    @Column(name = "session_id", length = 64)
    private String sessionId;

    /**
     * Job status
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 32)
    @Builder.Default
    private BrowserJobStatus status = BrowserJobStatus.PENDING;

    /**
     * Job result/output
     */
    @Column(name = "result", columnDefinition = "text")
    private String result;

    /**
     * Structured result data
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "result_data", columnDefinition = "jsonb")
    private Map<String, Object> resultData;

    /**
     * Extracted data (forms, tables, etc.)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "extracted_data", columnDefinition = "jsonb")
    private List<Map<String, Object>> extractedData;

    /**
     * Screenshot file paths or URLs
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "screenshots", columnDefinition = "jsonb")
    private List<String> screenshots;

    /**
     * Action history/steps taken
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "action_history", columnDefinition = "jsonb")
    private List<Map<String, Object>> actionHistory;

    /**
     * Error message if failed
     */
    @Column(name = "error_message", length = 2048)
    private String errorMessage;

    /**
     * Number of steps executed
     */
    @Column(name = "steps_count")
    @Builder.Default
    private Integer stepsCount = 0;

    /**
     * Execution time in milliseconds
     */
    @Column(name = "duration_ms")
    private Long durationMs;

    /**
     * Browser agent configuration used
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "agent_config", columnDefinition = "jsonb")
    private Map<String, Object> agentConfig;

    /**
     * Related search history ID
     */
    @Column(name = "search_history_id")
    private Long searchHistoryId;

    /**
     * Project ID if associated with a project
     */
    @Column(name = "project_id")
    private Long projectId;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @Column(name = "started_at")
    private LocalDateTime startedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    /**
     * Mark job as started
     */
    public void markStarted() {
        this.status = BrowserJobStatus.RUNNING;
        this.startedAt = LocalDateTime.now();
    }

    /**
     * Mark job as completed
     */
    public void markCompleted(String result, Map<String, Object> resultData) {
        this.status = BrowserJobStatus.COMPLETED;
        this.result = result;
        this.resultData = resultData;
        this.completedAt = LocalDateTime.now();
        if (startedAt != null) {
            this.durationMs = java.time.Duration.between(startedAt, completedAt).toMillis();
        }
    }

    /**
     * Mark job as failed
     */
    public void markFailed(String errorMessage) {
        this.status = BrowserJobStatus.FAILED;
        this.errorMessage = errorMessage;
        this.completedAt = LocalDateTime.now();
        if (startedAt != null) {
            this.durationMs = java.time.Duration.between(startedAt, completedAt).toMillis();
        }
    }

    /**
     * Job status enum
     */
    public enum BrowserJobStatus {
        PENDING,
        RUNNING,
        WAITING_HUMAN,
        COMPLETED,
        FAILED,
        CANCELLED,
        TIMEOUT
    }
}
