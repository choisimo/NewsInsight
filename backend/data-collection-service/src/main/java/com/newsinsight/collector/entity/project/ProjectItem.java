package com.newsinsight.collector.entity.project;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Entity representing an item within a project.
 * Can be a collected article, search result, report, or note.
 */
@Entity
@Table(name = "project_items", indexes = {
        @Index(name = "idx_pi_project_id", columnList = "project_id"),
        @Index(name = "idx_pi_type", columnList = "item_type"),
        @Index(name = "idx_pi_source_id", columnList = "source_id"),
        @Index(name = "idx_pi_added_at", columnList = "added_at"),
        @Index(name = "idx_pi_published_at", columnList = "published_at"),
        @Index(name = "idx_pi_bookmarked", columnList = "bookmarked")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProjectItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Project ID
     */
    @Column(name = "project_id", nullable = false)
    private Long projectId;

    /**
     * Item type
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "item_type", nullable = false, length = 32)
    private ItemType itemType;

    /**
     * Source reference ID (SearchHistory ID, Article ID, etc.)
     */
    @Column(name = "source_id", length = 255)
    private String sourceId;

    /**
     * Source type identifier
     */
    @Column(name = "source_type", length = 64)
    private String sourceType;

    /**
     * Item title
     */
    @Column(name = "title", length = 512)
    private String title;

    /**
     * Item summary/excerpt
     */
    @Column(name = "summary", length = 4096)
    private String summary;

    /**
     * Full content (for notes, etc.)
     */
    @Column(name = "content", columnDefinition = "text")
    private String content;

    /**
     * Original URL
     */
    @Column(name = "url", length = 2048)
    private String url;

    /**
     * Thumbnail/image URL
     */
    @Column(name = "thumbnail_url", length = 1024)
    private String thumbnailUrl;

    /**
     * Original publish date
     */
    @Column(name = "published_at")
    private LocalDateTime publishedAt;

    /**
     * Source name (news outlet, etc.)
     */
    @Column(name = "source_name", length = 255)
    private String sourceName;

    /**
     * Author name
     */
    @Column(name = "author", length = 255)
    private String author;

    /**
     * User-defined tags
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "tags", columnDefinition = "jsonb")
    private List<String> tags;

    /**
     * Category within project
     */
    @Column(name = "category", length = 128)
    private String category;

    /**
     * Whether bookmarked/starred
     */
    @Column(name = "bookmarked")
    @Builder.Default
    private Boolean bookmarked = false;

    /**
     * Importance level (1-5)
     */
    @Column(name = "importance")
    private Integer importance;

    /**
     * User notes about this item
     */
    @Column(name = "notes", columnDefinition = "text")
    private String notes;

    /**
     * Read status
     */
    @Column(name = "is_read")
    @Builder.Default
    private Boolean isRead = false;

    /**
     * Sentiment score (-1 to 1)
     */
    @Column(name = "sentiment_score")
    private Double sentimentScore;

    /**
     * Sentiment label
     */
    @Column(name = "sentiment_label", length = 32)
    private String sentimentLabel;

    /**
     * Relevance score (0-100)
     */
    @Column(name = "relevance_score")
    private Double relevanceScore;

    /**
     * AI-generated analysis
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "ai_analysis", columnDefinition = "jsonb")
    private Map<String, Object> aiAnalysis;

    /**
     * Additional metadata
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * User who added this item
     */
    @Column(name = "added_by", length = 64)
    private String addedBy;

    @CreationTimestamp
    @Column(name = "added_at", updatable = false)
    private LocalDateTime addedAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    // ============ Enums ============

    public enum ItemType {
        /** News article */
        ARTICLE,
        /** Search result reference */
        SEARCH_RESULT,
        /** Generated report */
        REPORT,
        /** User note */
        NOTE,
        /** External URL/link */
        LINK,
        /** File attachment */
        FILE,
        /** Social media post */
        SOCIAL_POST
    }

    // ============ Helper methods ============

    /**
     * Mark as read
     */
    public void markRead() {
        this.isRead = true;
    }

    /**
     * Toggle bookmark
     */
    public void toggleBookmark() {
        this.bookmarked = !Boolean.TRUE.equals(this.bookmarked);
    }

    /**
     * Update importance
     */
    public void setImportanceLevel(int level) {
        this.importance = Math.max(1, Math.min(5, level));
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}
