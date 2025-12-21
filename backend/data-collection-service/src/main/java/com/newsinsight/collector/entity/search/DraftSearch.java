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
import java.util.Map;

/**
 * Entity for storing user's draft/unsaved searches.
 * Captures search inputs that haven't been executed yet,
 * enabling "Continue Work" feature for incomplete searches.
 */
@Entity
@Table(name = "draft_searches", indexes = {
        @Index(name = "idx_draft_search_user_id", columnList = "user_id"),
        @Index(name = "idx_draft_search_session_id", columnList = "session_id"),
        @Index(name = "idx_draft_search_created_at", columnList = "created_at"),
        @Index(name = "idx_draft_search_executed", columnList = "executed")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DraftSearch {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Search query entered by user
     */
    @Column(nullable = false, length = 1024)
    private String query;

    /**
     * Type of search intended
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "search_type", length = 32)
    @Builder.Default
    private SearchType searchType = SearchType.UNIFIED;

    /**
     * User ID
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Session ID for anonymous users
     */
    @Column(name = "session_id", length = 64)
    private String sessionId;

    /**
     * Time window selected (1d, 7d, 30d, etc.)
     */
    @Column(name = "time_window", length = 16)
    private String timeWindow;

    /**
     * Search mode (standard, deep, fact-check, etc.)
     */
    @Column(name = "search_mode", length = 32)
    private String searchMode;

    /**
     * Additional options/parameters
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "options", columnDefinition = "jsonb")
    private Map<String, Object> options;

    /**
     * Whether this draft has been executed
     */
    @Column(name = "executed")
    @Builder.Default
    private Boolean executed = false;

    /**
     * When the draft was executed
     */
    @Column(name = "executed_at")
    private LocalDateTime executedAt;

    /**
     * Reference to the executed search history
     */
    @Column(name = "search_history_id")
    private Long searchHistoryId;

    /**
     * Project ID if associated with a project
     */
    @Column(name = "project_id")
    private Long projectId;

    /**
     * Source page/context where the draft was created
     */
    @Column(name = "source_context", length = 128)
    private String sourceContext;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    /**
     * Mark draft as executed
     */
    public void markExecuted(Long searchHistoryId) {
        this.executed = true;
        this.executedAt = LocalDateTime.now();
        this.searchHistoryId = searchHistoryId;
    }
}
