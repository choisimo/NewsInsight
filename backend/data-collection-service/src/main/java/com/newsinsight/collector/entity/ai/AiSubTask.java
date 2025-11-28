package com.newsinsight.collector.entity.ai;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * Entity representing an individual AI sub-task within a job.
 * Each sub-task is processed by a specific AI provider (n8n workflow).
 */
@Entity
@Table(name = "ai_sub_tasks", indexes = {
        @Index(name = "idx_ai_sub_tasks_job_id", columnList = "job_id"),
        @Index(name = "idx_ai_sub_tasks_status", columnList = "status"),
        @Index(name = "idx_ai_sub_tasks_provider_id", columnList = "provider_id"),
        @Index(name = "idx_ai_sub_tasks_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiSubTask {

    @Id
    @Column(name = "sub_task_id", length = 64)
    private String id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "job_id", nullable = false)
    private AiJob aiJob;

    @Enumerated(EnumType.STRING)
    @Column(name = "provider_id", nullable = false, length = 32)
    private AiProvider providerId;

    @Column(name = "task_type", nullable = false, length = 64)
    private String taskType;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 32)
    @Builder.Default
    private AiTaskStatus status = AiTaskStatus.PENDING;

    @Lob
    @Column(name = "result_json", columnDefinition = "TEXT")
    private String resultJson;

    @Column(name = "error_message", length = 1024)
    private String errorMessage;

    @Column(name = "retry_count")
    @Builder.Default
    private Integer retryCount = 0;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    /**
     * Mark the task as in progress
     */
    public void markInProgress() {
        this.status = AiTaskStatus.IN_PROGRESS;
    }

    /**
     * Mark the task as completed with result
     */
    public void markCompleted(String resultJson) {
        this.status = AiTaskStatus.COMPLETED;
        this.resultJson = resultJson;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Mark the task as failed
     */
    public void markFailed(String errorMessage) {
        this.status = AiTaskStatus.FAILED;
        this.errorMessage = errorMessage;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Mark the task as cancelled
     */
    public void markCancelled() {
        this.status = AiTaskStatus.CANCELLED;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Mark the task as timed out
     */
    public void markTimeout() {
        this.status = AiTaskStatus.TIMEOUT;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Increment retry count
     */
    public void incrementRetry() {
        this.retryCount++;
    }

    /**
     * Check if the task is in a terminal state
     */
    public boolean isTerminal() {
        return status == AiTaskStatus.COMPLETED
                || status == AiTaskStatus.FAILED
                || status == AiTaskStatus.CANCELLED
                || status == AiTaskStatus.TIMEOUT;
    }

    /**
     * Check if the task can be retried
     */
    public boolean canRetry(int maxRetries) {
        return retryCount < maxRetries && !isTerminal();
    }

    /**
     * Get the job ID (helper for when job is lazy loaded)
     */
    public String getJobId() {
        return aiJob != null ? aiJob.getId() : null;
    }

    /**
     * Create a new sub-task for a job
     */
    public static AiSubTask create(AiJob job, AiProvider provider, String taskType) {
        AiSubTask task = AiSubTask.builder()
                .id(generateSubTaskId())
                .providerId(provider)
                .taskType(taskType)
                .status(AiTaskStatus.PENDING)
                .retryCount(0)
                .build();
        job.addSubTask(task);
        return task;
    }

    /**
     * Generate a new sub-task ID
     */
    public static String generateSubTaskId() {
        return "subtask_" + UUID.randomUUID().toString()
                .replace("-", "").substring(0, 16);
    }
}
