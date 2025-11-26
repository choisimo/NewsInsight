package com.newsinsight.collector.entity;

/**
 * Status of a deep AI search crawl job
 */
public enum CrawlJobStatus {
    /**
     * Job has been created but not yet started
     */
    PENDING,

    /**
     * Job is currently being processed by n8n workflow
     */
    IN_PROGRESS,

    /**
     * Job completed successfully with evidence
     */
    COMPLETED,

    /**
     * Job failed due to an error
     */
    FAILED,

    /**
     * Job was cancelled before completion
     */
    CANCELLED,

    /**
     * Job timed out waiting for callback
     */
    TIMEOUT
}
