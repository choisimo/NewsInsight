package com.newsinsight.collector.entity;

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

@Entity
@Table(name = "data_sources", indexes = {
    @Index(name = "idx_source_type", columnList = "source_type"),
    @Index(name = "idx_is_active", columnList = "is_active")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DataSource {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "name", nullable = false, length = 255)
    private String name;

    @Column(name = "url", nullable = false, columnDefinition = "TEXT")
    private String url;

    @Enumerated(EnumType.STRING)
    @Column(name = "source_type", nullable = false, length = 50)
    private SourceType sourceType;

    @Column(name = "is_active", nullable = false)
    @Builder.Default
    private Boolean isActive = true;

    @Column(name = "last_collected")
    private LocalDateTime lastCollected;

    @Column(name = "collection_frequency", nullable = false)
    @Builder.Default
    private Integer collectionFrequency = 3600; // seconds

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata_json", columnDefinition = "jsonb")
    private String metadataJson;

    /**
     * Search URL template for web search sources.
     * Use {query} as placeholder for the encoded search query.
     * Example: "https://search.naver.com/search.naver?where=news&query={query}"
     * Only applicable when sourceType = WEB_SEARCH.
     */
    @Column(name = "search_url_template", columnDefinition = "TEXT")
    private String searchUrlTemplate;

    /**
     * Priority for web search sources (lower = higher priority).
     * Used for ordering when selecting search sources.
     */
    @Column(name = "search_priority")
    @Builder.Default
    private Integer searchPriority = 100;

    /**
     * Browser agent configuration.
     * Only applicable when sourceType = BROWSER_AGENT.
     */
    @Embedded
    private BrowserAgentConfig browserAgentConfig;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    /**
     * Check if this source requires browser-based collection.
     */
    public boolean requiresBrowserAgent() {
        return sourceType != null && sourceType.requiresBrowser();
    }

    /**
     * Get browser agent config, creating default if null and source type requires it.
     */
    public BrowserAgentConfig getEffectiveBrowserAgentConfig() {
        if (browserAgentConfig != null) {
            return browserAgentConfig;
        }
        if (requiresBrowserAgent()) {
            return BrowserAgentConfig.forNewsExploration();
        }
        return null;
    }

    /**
     * Check if this source supports web search.
     */
    public boolean supportsWebSearch() {
        return sourceType == SourceType.WEB_SEARCH && searchUrlTemplate != null && !searchUrlTemplate.isBlank();
    }

    /**
     * Generate search URL from template with the given query.
     * 
     * @param encodedQuery URL-encoded search query
     * @return Generated search URL or null if template is not set
     */
    public String buildSearchUrl(String encodedQuery) {
        if (searchUrlTemplate == null || searchUrlTemplate.isBlank()) {
            return null;
        }
        return searchUrlTemplate.replace("{query}", encodedQuery);
    }
}
