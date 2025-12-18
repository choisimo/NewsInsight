package com.newsinsight.collector.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Builder;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Kafka message for browser-based autonomous crawling tasks.
 * Consumed by autonomous-crawler-service (Python/Browser-use).
 */
@Builder
public record BrowserTaskMessage(
        /**
         * Unique job ID for tracking.
         */
        Long jobId,
        
        /**
         * Data source ID.
         */
        Long sourceId,
        
        /**
         * Source name for logging/display.
         */
        String sourceName,
        
        /**
         * Seed URL to start exploration from.
         */
        String seedUrl,
        
        /**
         * Maximum link traversal depth.
         */
        Integer maxDepth,
        
        /**
         * Maximum pages to visit.
         */
        Integer maxPages,
        
        /**
         * Time budget in seconds.
         */
        Integer budgetSeconds,
        
        /**
         * Exploration policy (focused_topic, domain_wide, news_only, etc.)
         */
        String policy,
        
        /**
         * Focus keywords for FOCUSED_TOPIC policy.
         */
        String focusKeywords,
        
        /**
         * Custom prompt/instructions for AI agent.
         */
        String customPrompt,
        
        /**
         * Whether to capture screenshots.
         */
        Boolean captureScreenshots,
        
        /**
         * Whether to extract structured data.
         */
        Boolean extractStructured,
        
        /**
         * Domains to exclude.
         */
        String excludedDomains,
        
        /**
         * Callback URL for session completion notification.
         */
        String callbackUrl,
        
        /**
         * Callback authentication token.
         */
        String callbackToken,
        
        /**
         * Additional metadata.
         */
        Map<String, Object> metadata,
        
        /**
         * Task creation timestamp.
         * Serialized as ISO-8601 string for Python compatibility.
         */
        @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss")
        LocalDateTime createdAt
) {
    public BrowserTaskMessage {
        createdAt = createdAt != null ? createdAt : LocalDateTime.now();
    }
}
