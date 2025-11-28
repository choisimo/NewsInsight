package com.newsinsight.collector.entity.ai;

/**
 * Status of an individual AI sub-task.
 */
public enum AiTaskStatus {
    /**
     * Task has been created but not yet started
     */
    PENDING,

    /**
     * Task is currently being processed by a worker/n8n
     */
    IN_PROGRESS,

    /**
     * Task completed successfully
     */
    COMPLETED,

    /**
     * Task failed due to an error
     */
    FAILED,

    /**
     * Task was cancelled before completion
     */
    CANCELLED,

    /**
     * Task timed out waiting for callback
     */
    TIMEOUT
}
