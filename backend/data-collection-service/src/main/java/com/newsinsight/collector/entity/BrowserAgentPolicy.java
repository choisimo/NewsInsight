package com.newsinsight.collector.entity;

/**
 * Policy for browser agent autonomous exploration behavior.
 * 
 * 이 enum은 autonomous-crawler-service의 CrawlPolicy와 1:1 매핑됩니다.
 * Python: src/crawler/policies.py의 CrawlPolicy enum
 */
public enum BrowserAgentPolicy {
    // ========================================
    // 기본 정책
    // ========================================
    
    /**
     * Focus on specific topic/keywords only.
     * Agent will prioritize links containing relevant keywords.
     */
    FOCUSED_TOPIC("focused_topic"),
    
    /**
     * Explore within the same domain broadly.
     * Agent will visit multiple pages within the seed domain.
     */
    DOMAIN_WIDE("domain_wide"),
    
    /**
     * Focus on news articles only.
     * Agent will identify and prioritize news content patterns.
     */
    NEWS_ONLY("news_only"),
    
    /**
     * Follow links to external domains as well.
     * Agent can navigate to linked external sites.
     */
    CROSS_DOMAIN("cross_domain"),
    
    /**
     * Minimal exploration - only the seed URL.
     * Useful for single-page deep extraction.
     */
    SINGLE_PAGE("single_page"),
    
    // ========================================
    // 뉴스 특화 정책 (신규)
    // ========================================
    
    /**
     * Priority collection of breaking news and urgent updates.
     * Agent focuses on articles marked as 속보, Breaking, 긴급, 단독.
     */
    NEWS_BREAKING("news_breaking"),
    
    /**
     * Historical article collection from archives.
     * Agent navigates through pagination and older content.
     */
    NEWS_ARCHIVE("news_archive"),
    
    /**
     * Focus on opinion pieces, editorials, and columns.
     * Agent targets 오피니언, 칼럼, 사설 sections.
     */
    NEWS_OPINION("news_opinion"),
    
    /**
     * Local and regional news collection.
     * Agent focuses on geographically specific news content.
     */
    NEWS_LOCAL("news_local");

    private final String value;

    BrowserAgentPolicy(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    /**
     * Convert string value to enum.
     * 
     * @param value The policy value string (e.g., "news_only", "news_breaking")
     * @return The corresponding BrowserAgentPolicy
     * @throws IllegalArgumentException if the value is not recognized
     */
    public static BrowserAgentPolicy fromValue(String value) {
        if (value == null || value.isBlank()) {
            return NEWS_ONLY; // Default fallback
        }
        for (BrowserAgentPolicy policy : BrowserAgentPolicy.values()) {
            if (policy.value.equalsIgnoreCase(value)) {
                return policy;
            }
        }
        throw new IllegalArgumentException("Unknown browser agent policy: " + value);
    }
    
    /**
     * Check if this policy is a news-specific policy.
     * 
     * @return true if this is a news-focused policy
     */
    public boolean isNewsFocused() {
        return this == NEWS_ONLY || this == NEWS_BREAKING || 
               this == NEWS_ARCHIVE || this == NEWS_OPINION || this == NEWS_LOCAL;
    }
    
    /**
     * Check if this policy supports multi-page crawling.
     * 
     * @return true if the policy allows visiting multiple pages
     */
    public boolean supportsMultiPage() {
        return this != SINGLE_PAGE;
    }
}
