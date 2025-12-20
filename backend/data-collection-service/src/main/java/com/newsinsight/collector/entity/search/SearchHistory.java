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
        @Index(name = "idx_search_history_parent_id", columnList = "parent_search_id"),
        @Index(name = "idx_search_history_completion_status", columnList = "completion_status"),
        @Index(name = "idx_search_history_project_id", columnList = "project_id")
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

    // ============ New fields for improved tracking ============

    /**
     * Completion status for "Continue Work" feature
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "completion_status", length = 32)
    @Builder.Default
    private CompletionStatus completionStatus = CompletionStatus.IN_PROGRESS;

    /**
     * Whether the user has viewed the results
     */
    @Column(name = "viewed")
    @Builder.Default
    private Boolean viewed = false;

    /**
     * When the user viewed the results
     */
    @Column(name = "viewed_at")
    private LocalDateTime viewedAt;

    /**
     * Whether a report has been generated for this search
     */
    @Column(name = "report_generated")
    @Builder.Default
    private Boolean reportGenerated = false;

    /**
     * Phase where failure occurred (for debugging)
     * e.g., "db_search", "web_crawl", "ai_analysis"
     */
    @Column(name = "failure_phase", length = 64)
    private String failurePhase;

    /**
     * Detailed failure information
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "failure_details", columnDefinition = "jsonb")
    private Map<String, Object> failureDetails;

    /**
     * Partial results saved before failure
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "partial_results", columnDefinition = "jsonb")
    private List<Map<String, Object>> partialResults;

    /**
     * Progress percentage (0-100) for long-running searches
     */
    @Column(name = "progress")
    @Builder.Default
    private Integer progress = 0;

    /**
     * Current phase description for UI display
     */
    @Column(name = "current_phase", length = 128)
    private String currentPhase;

    /**
     * Project ID for project-based organization
     */
    @Column(name = "project_id")
    private Long projectId;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    // ============ Enums ============

    /**
     * Completion status for tracking search progress
     */
    public enum CompletionStatus {
        /** Search input saved but not executed */
        DRAFT,
        /** Search is currently running */
        IN_PROGRESS,
        /** Some sources succeeded, some failed */
        PARTIAL,
        /** Search completed successfully */
        COMPLETED,
        /** Search failed */
        FAILED,
        /** Search was cancelled by user */
        CANCELLED
    }

    // ============ Helper methods ============

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

    /**
     * Check if this search needs to be continued
     */
    public boolean needsContinuation() {
        if (completionStatus == null) {
            return !Boolean.TRUE.equals(success);
        }
        return completionStatus == CompletionStatus.DRAFT
                || completionStatus == CompletionStatus.IN_PROGRESS
                || completionStatus == CompletionStatus.PARTIAL
                || completionStatus == CompletionStatus.FAILED;
    }

    /**
     * Check if this search is actionable (should show in "Continue Work")
     */
    public boolean isActionable() {
        // Exclude completed searches that have been viewed
        if (completionStatus == CompletionStatus.COMPLETED && Boolean.TRUE.equals(viewed)) {
            return false;
        }
        // Exclude bookmarked or report-generated searches
        if (Boolean.TRUE.equals(bookmarked) || Boolean.TRUE.equals(reportGenerated)) {
            return false;
        }
        return needsContinuation() || (completionStatus == CompletionStatus.COMPLETED && !Boolean.TRUE.equals(viewed));
    }

    /**
     * Mark as viewed
     */
    public void markViewed() {
        this.viewed = true;
        this.viewedAt = LocalDateTime.now();
    }

    /**
     * Mark as completed
     */
    public void markCompleted() {
        this.completionStatus = CompletionStatus.COMPLETED;
        this.success = true;
        this.progress = 100;
    }

    /**
     * Mark as failed with details
     */
    public void markFailed(String phase, String errorMessage, Map<String, Object> details) {
        this.completionStatus = CompletionStatus.FAILED;
        this.success = false;
        this.failurePhase = phase;
        this.errorMessage = errorMessage;
        this.failureDetails = details;
    }

    /**
     * Update progress
     */
    public void updateProgress(int progress, String phase) {
        this.progress = Math.min(100, Math.max(0, progress));
        this.currentPhase = phase;
        if (this.completionStatus == CompletionStatus.DRAFT) {
            this.completionStatus = CompletionStatus.IN_PROGRESS;
        }
    }
}
