package com.newsinsight.collector.entity.search;

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
 * Entity representing a search history record.
 * Stores the search query, results, and metadata for all search types
 * (unified search, deep search, fact check, browser agent).
 */
@Entity
@Table(name = "search_history", indexes = {
        @Index(name = "idx_search_history_type", columnList = "search_type"),
        @Index(name = "idx_search_history_query", columnList = "query"),
        @Index(name = "idx_search_history_created_at", columnList = "created_at"),
        @Index(name = "idx_search_history_user_id", columnList = "user_id"),
        @Index(name = "idx_search_history_parent_id", columnList = "parent_search_id")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * External reference ID (e.g., jobId from search job)
     */
    @Column(name = "external_id", length = 64, unique = true)
    private String externalId;

    /**
     * Type of search performed
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "search_type", nullable = false, length = 32)
    private SearchType searchType;

    /**
     * The search query or topic
     */
    @Column(nullable = false, length = 1024)
    private String query;

    /**
     * Time window for search (e.g., 1d, 7d, 30d)
     */
    @Column(length = 16)
    private String timeWindow;

    /**
     * Optional user ID for multi-user scenarios
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Session ID for grouping searches
     */
    @Column(name = "session_id", length = 64)
    private String sessionId;

    /**
     * Parent search ID for derived/drilldown searches
     */
    @Column(name = "parent_search_id")
    private Long parentSearchId;

    /**
     * Depth level for drilldown searches (0 = original, 1+ = drilldown)
     */
    @Column(name = "depth_level")
    @Builder.Default
    private Integer depthLevel = 0;

    /**
     * Total number of results found
     */
    @Column(name = "result_count")
    @Builder.Default
    private Integer resultCount = 0;

    /**
     * Search results stored as JSON
     * Contains list of search result items with their analysis data
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "results", columnDefinition = "jsonb")
    private List<Map<String, Object>> results;

    /**
     * AI summary/response stored as JSON
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "ai_summary", columnDefinition = "jsonb")
    private Map<String, Object> aiSummary;

    /**
     * URLs discovered during search (for auto-collection)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "discovered_urls", columnDefinition = "jsonb")
    private List<String> discoveredUrls;

    /**
     * Fact check results (for FACT_CHECK type)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "fact_check_results", columnDefinition = "jsonb")
    private List<Map<String, Object>> factCheckResults;

    /**
     * Overall credibility score (0-100)
     */
    @Column(name = "credibility_score")
    private Double credibilityScore;

    /**
     * Stance distribution (pro, con, neutral counts)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "stance_distribution", columnDefinition = "jsonb")
    private Map<String, Object> stanceDistribution;

    /**
     * Additional metadata
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * Whether this search has been bookmarked/starred
     */
    @Column
    @Builder.Default
    private Boolean bookmarked = false;

    /**
     * User-provided tags for organization
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private List<String> tags;

    /**
     * User notes about this search
     */
    @Column(columnDefinition = "text")
    private String notes;

    /**
     * Search duration in milliseconds
     */
    @Column(name = "duration_ms")
    private Long durationMs;

    /**
     * Error message if search failed
     */
    @Column(name = "error_message", length = 2048)
    private String errorMessage;

    /**
     * Whether the search completed successfully
     */
    @Column
    @Builder.Default
    private Boolean success = true;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    /**
     * Convenience method to check if this is a derived search
     */
    public boolean isDerivedSearch() {
        return parentSearchId != null && parentSearchId > 0;
    }

    /**
     * Get result count safely
     */
    public int getResultCountSafe() {
        if (results != null) {
            return results.size();
        }
        return resultCount != null ? resultCount : 0;
    }
}
