package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.search.SearchType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * Kafka message DTO for search history events.
 * Used for asynchronous search result persistence via Kafka.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchHistoryMessage {

    /**
     * External reference ID (e.g., jobId)
     */
    private String externalId;

    /**
     * Type of search performed
     */
    private SearchType searchType;

    /**
     * The search query or topic
     */
    private String query;

    /**
     * Time window for search (e.g., 1d, 7d, 30d)
     */
    private String timeWindow;

    /**
     * Optional user ID
     */
    private String userId;

    /**
     * Session ID for grouping searches
     */
    private String sessionId;

    /**
     * Parent search ID for derived searches
     */
    private Long parentSearchId;

    /**
     * Depth level for drilldown searches
     */
    @Builder.Default
    private Integer depthLevel = 0;

    /**
     * Total number of results
     */
    @Builder.Default
    private Integer resultCount = 0;

    /**
     * Search results as JSON list
     */
    private List<Map<String, Object>> results;

    /**
     * AI summary/response
     */
    private Map<String, Object> aiSummary;

    /**
     * URLs discovered during search
     */
    private List<String> discoveredUrls;

    /**
     * Fact check results
     */
    private List<Map<String, Object>> factCheckResults;

    /**
     * Overall credibility score (0-100)
     */
    private Double credibilityScore;

    /**
     * Stance distribution
     */
    private Map<String, Object> stanceDistribution;

    /**
     * Additional metadata
     */
    private Map<String, Object> metadata;

    /**
     * Search duration in milliseconds
     */
    private Long durationMs;

    /**
     * Error message if search failed
     */
    private String errorMessage;

    /**
     * Whether the search succeeded
     */
    @Builder.Default
    private Boolean success = true;

    /**
     * Timestamp when search was performed (epoch millis)
     */
    private Long timestamp;
}
