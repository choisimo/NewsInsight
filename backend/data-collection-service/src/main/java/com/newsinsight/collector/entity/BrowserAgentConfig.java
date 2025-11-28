package com.newsinsight.collector.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Configuration for browser-based AI agent exploration.
 * Embedded in DataSource for BROWSER_AGENT source type.
 */
@Embeddable
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BrowserAgentConfig {

    /**
     * Maximum depth of link traversal from seed URL.
     * 0 = seed page only, 1 = seed + direct links, etc.
     */
    @Column(name = "agent_max_depth")
    @Builder.Default
    private Integer maxDepth = 2;

    /**
     * Maximum number of pages to visit in a single session.
     */
    @Column(name = "agent_max_pages")
    @Builder.Default
    private Integer maxPages = 50;

    /**
     * Maximum time budget for exploration in seconds.
     */
    @Column(name = "agent_budget_seconds")
    @Builder.Default
    private Integer budgetSeconds = 300; // 5 minutes

    /**
     * Exploration behavior policy.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "agent_policy", length = 50)
    @Builder.Default
    private BrowserAgentPolicy policy = BrowserAgentPolicy.FOCUSED_TOPIC;

    /**
     * Keywords or topics for focused exploration.
     * Comma-separated list.
     */
    @Column(name = "agent_focus_keywords", columnDefinition = "TEXT")
    private String focusKeywords;

    /**
     * Custom prompt/instructions for the AI agent.
     */
    @Column(name = "agent_custom_prompt", columnDefinition = "TEXT")
    private String customPrompt;

    /**
     * Whether to capture screenshots during exploration.
     */
    @Column(name = "agent_capture_screenshots")
    @Builder.Default
    private Boolean captureScreenshots = false;

    /**
     * Whether to extract structured data (tables, lists).
     */
    @Column(name = "agent_extract_structured")
    @Builder.Default
    private Boolean extractStructured = true;

    /**
     * Domains to exclude from exploration.
     * Comma-separated list.
     */
    @Column(name = "agent_excluded_domains", columnDefinition = "TEXT")
    private String excludedDomains;

    /**
     * Create default config for news exploration.
     */
    public static BrowserAgentConfig forNewsExploration() {
        return BrowserAgentConfig.builder()
                .maxDepth(2)
                .maxPages(30)
                .budgetSeconds(180)
                .policy(BrowserAgentPolicy.NEWS_ONLY)
                .extractStructured(true)
                .captureScreenshots(false)
                .build();
    }

    /**
     * Create config for deep single-page extraction.
     */
    public static BrowserAgentConfig forSinglePageExtraction() {
        return BrowserAgentConfig.builder()
                .maxDepth(0)
                .maxPages(1)
                .budgetSeconds(60)
                .policy(BrowserAgentPolicy.SINGLE_PAGE)
                .extractStructured(true)
                .captureScreenshots(false)
                .build();
    }
}
