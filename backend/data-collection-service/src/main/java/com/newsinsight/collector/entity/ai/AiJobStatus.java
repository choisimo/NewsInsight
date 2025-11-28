package com.newsinsight.collector.entity.ai;

/**
 * Status of an AI orchestration job.
 * Represents the aggregate state across all sub-tasks.
 */
public enum AiJobStatus {
    /**
     * Job has been created but no sub-tasks have started
     */
    PENDING,

    /**
     * At least one sub-task is currently being processed
     */
    IN_PROGRESS,

    /**
     * All sub-tasks completed successfully
     */
    COMPLETED,

    /**
     * Some sub-tasks completed, some failed/timed out
     */
    PARTIAL_SUCCESS,

    /**
     * All sub-tasks failed
     */
    FAILED,

    /**
     * Job was cancelled before completion
     */
    CANCELLED,

    /**
     * Job timed out waiting for sub-task callbacks
     */
    TIMEOUT
}
