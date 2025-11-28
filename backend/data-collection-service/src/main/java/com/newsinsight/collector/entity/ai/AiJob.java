package com.newsinsight.collector.entity.ai;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Entity representing an AI orchestration job.
 * A job consists of multiple sub-tasks that can be processed by different AI providers.
 * Tracks the overall status aggregated from all sub-tasks.
 */
@Entity
@Table(name = "ai_jobs", indexes = {
        @Index(name = "idx_ai_jobs_overall_status", columnList = "overall_status"),
        @Index(name = "idx_ai_jobs_created_at", columnList = "created_at"),
        @Index(name = "idx_ai_jobs_topic", columnList = "topic")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiJob {

    @Id
    @Column(name = "job_id", length = 64)
    private String id;

    @Column(nullable = false, length = 512)
    private String topic;

    @Column(name = "base_url", length = 2048)
    private String baseUrl;

    @Enumerated(EnumType.STRING)
    @Column(name = "overall_status", nullable = false, length = 32)
    @Builder.Default
    private AiJobStatus overallStatus = AiJobStatus.PENDING;

    @OneToMany(mappedBy = "aiJob", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @Builder.Default
    private List<AiSubTask> subTasks = new ArrayList<>();

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    @Column(name = "error_message", length = 1024)
    private String errorMessage;

    /**
     * Add a sub-task to this job (manages bidirectional relationship)
     */
    public void addSubTask(AiSubTask task) {
        subTasks.add(task);
        task.setAiJob(this);
    }

    /**
     * Remove a sub-task from this job
     */
    public void removeSubTask(AiSubTask task) {
        subTasks.remove(task);
        task.setAiJob(null);
    }

    /**
     * Mark the job as in progress
     */
    public void markInProgress() {
        this.overallStatus = AiJobStatus.IN_PROGRESS;
    }

    /**
     * Mark the job as completed successfully
     */
    public void markCompleted() {
        this.overallStatus = AiJobStatus.COMPLETED;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Mark the job as failed
     */
    public void markFailed(String errorMessage) {
        this.overallStatus = AiJobStatus.FAILED;
        this.errorMessage = errorMessage;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Mark the job as partially successful (some tasks completed, some failed)
     */
    public void markPartialSuccess() {
        this.overallStatus = AiJobStatus.PARTIAL_SUCCESS;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Mark the job as cancelled
     */
    public void markCancelled() {
        this.overallStatus = AiJobStatus.CANCELLED;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Mark the job as timed out
     */
    public void markTimeout() {
        this.overallStatus = AiJobStatus.TIMEOUT;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Check if the job is in a terminal state
     */
    public boolean isTerminal() {
        return overallStatus == AiJobStatus.COMPLETED
                || overallStatus == AiJobStatus.FAILED
                || overallStatus == AiJobStatus.PARTIAL_SUCCESS
                || overallStatus == AiJobStatus.CANCELLED
                || overallStatus == AiJobStatus.TIMEOUT;
    }

    /**
     * Get count of sub-tasks by status
     */
    public long countSubTasksByStatus(AiTaskStatus status) {
        return subTasks.stream()
                .filter(task -> task.getStatus() == status)
                .count();
    }

    /**
     * Generate a new job ID
     */
    public static String generateJobId() {
        return "aijob_" + java.util.UUID.randomUUID().toString()
                .replace("-", "").substring(0, 16);
    }
}
