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
 * 
 * autonomous-crawler-service의 BrowserTaskMessage와 매핑됩니다.
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

    // ========================================
    // 기본 프리셋 팩토리 메서드
    // ========================================

    /**
     * Create default config for news exploration.
     * 일반적인 뉴스 기사 수집에 적합한 설정.
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
     * 단일 페이지에서 상세 정보 추출에 적합한 설정.
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

    // ========================================
    // 뉴스 특화 프리셋 팩토리 메서드 (신규)
    // ========================================

    /**
     * Create config for breaking news monitoring.
     * 속보/긴급 뉴스 우선 수집에 적합한 설정.
     */
    public static BrowserAgentConfig forBreakingNews() {
        return BrowserAgentConfig.builder()
                .maxDepth(1)
                .maxPages(20)
                .budgetSeconds(120)
                .policy(BrowserAgentPolicy.NEWS_BREAKING)
                .extractStructured(true)
                .captureScreenshots(false)
                .build();
    }

    /**
     * Create config for news archive exploration.
     * 과거 기사 아카이브 수집에 적합한 설정.
     */
    public static BrowserAgentConfig forNewsArchive() {
        return BrowserAgentConfig.builder()
                .maxDepth(3)
                .maxPages(100)
                .budgetSeconds(600) // 10분
                .policy(BrowserAgentPolicy.NEWS_ARCHIVE)
                .extractStructured(true)
                .captureScreenshots(false)
                .build();
    }

    /**
     * Create config for opinion/editorial collection.
     * 오피니언/칼럼/사설 수집에 적합한 설정.
     */
    public static BrowserAgentConfig forOpinionContent() {
        return BrowserAgentConfig.builder()
                .maxDepth(2)
                .maxPages(30)
                .budgetSeconds(180)
                .policy(BrowserAgentPolicy.NEWS_OPINION)
                .extractStructured(true)
                .captureScreenshots(false)
                .build();
    }

    /**
     * Create config for local news collection.
     * 지역 뉴스 수집에 적합한 설정.
     */
    public static BrowserAgentConfig forLocalNews() {
        return BrowserAgentConfig.builder()
                .maxDepth(2)
                .maxPages(40)
                .budgetSeconds(240)
                .policy(BrowserAgentPolicy.NEWS_LOCAL)
                .extractStructured(true)
                .captureScreenshots(false)
                .build();
    }

    /**
     * Create config for topic-focused news collection.
     * 특정 키워드/토픽 중심 수집에 적합한 설정.
     * 
     * @param keywords Comma-separated focus keywords
     */
    public static BrowserAgentConfig forFocusedTopic(String keywords) {
        return BrowserAgentConfig.builder()
                .maxDepth(2)
                .maxPages(50)
                .budgetSeconds(300)
                .policy(BrowserAgentPolicy.FOCUSED_TOPIC)
                .focusKeywords(keywords)
                .extractStructured(true)
                .captureScreenshots(false)
                .build();
    }

    /**
     * Create config for domain-wide exploration.
     * 전체 도메인 탐색에 적합한 설정.
     */
    public static BrowserAgentConfig forDomainExploration() {
        return BrowserAgentConfig.builder()
                .maxDepth(3)
                .maxPages(100)
                .budgetSeconds(600)
                .policy(BrowserAgentPolicy.DOMAIN_WIDE)
                .extractStructured(true)
                .captureScreenshots(false)
                .build();
    }

    // ========================================
    // 유틸리티 메서드
    // ========================================

    /**
     * Create a copy of this config with a different policy.
     * 
     * @param newPolicy The new policy to use
     * @return A new BrowserAgentConfig with the updated policy
     */
    public BrowserAgentConfig withPolicy(BrowserAgentPolicy newPolicy) {
        return BrowserAgentConfig.builder()
                .maxDepth(this.maxDepth)
                .maxPages(this.maxPages)
                .budgetSeconds(this.budgetSeconds)
                .policy(newPolicy)
                .focusKeywords(this.focusKeywords)
                .customPrompt(this.customPrompt)
                .captureScreenshots(this.captureScreenshots)
                .extractStructured(this.extractStructured)
                .excludedDomains(this.excludedDomains)
                .build();
    }

    /**
     * Check if this config uses a news-focused policy.
     * 
     * @return true if the policy is news-focused
     */
    public boolean isNewsFocused() {
        return policy != null && policy.isNewsFocused();
    }
}
