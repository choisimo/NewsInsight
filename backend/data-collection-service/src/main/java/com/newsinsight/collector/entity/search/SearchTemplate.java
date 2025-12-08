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
 * Entity representing a saved search template.
 * Templates allow users to save search configurations with selected items
 * for reuse in SmartSearch.
 */
@Entity
@Table(name = "search_template", indexes = {
        @Index(name = "idx_search_template_user_id", columnList = "user_id"),
        @Index(name = "idx_search_template_mode", columnList = "mode"),
        @Index(name = "idx_search_template_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchTemplate {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Template name (user-defined)
     */
    @Column(nullable = false, length = 256)
    private String name;

    /**
     * Search query associated with this template
     */
    @Column(nullable = false, length = 1024)
    private String query;

    /**
     * Search mode (unified, deep, factcheck)
     */
    @Column(nullable = false, length = 32)
    private String mode;

    /**
     * User ID who created this template
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Selected items stored as JSON array
     * Each item contains: id, type, title, url, snippet, source, stance, verificationStatus
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "items", columnDefinition = "jsonb")
    private List<Map<String, Object>> items;

    /**
     * Optional description for the template
     */
    @Column(columnDefinition = "text")
    private String description;

    /**
     * Whether this template is marked as favorite
     */
    @Column
    @Builder.Default
    private Boolean favorite = false;

    /**
     * Tags for categorization
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private List<String> tags;

    /**
     * Additional metadata
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * Reference to original search history (if created from a search)
     */
    @Column(name = "source_search_id")
    private Long sourceSearchId;

    /**
     * Number of times this template has been used
     */
    @Column(name = "use_count")
    @Builder.Default
    private Integer useCount = 0;

    /**
     * Last time this template was used
     */
    @Column(name = "last_used_at")
    private LocalDateTime lastUsedAt;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    /**
     * Increment use count and update last used timestamp
     */
    public void recordUsage() {
        this.useCount = (this.useCount != null ? this.useCount : 0) + 1;
        this.lastUsedAt = LocalDateTime.now();
    }

    /**
     * Get item count safely
     */
    public int getItemCount() {
        return items != null ? items.size() : 0;
    }
}
