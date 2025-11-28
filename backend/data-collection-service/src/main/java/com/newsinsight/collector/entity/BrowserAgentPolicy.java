package com.newsinsight.collector.entity;

/**
 * Policy for browser agent autonomous exploration behavior.
 */
public enum BrowserAgentPolicy {
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
    SINGLE_PAGE("single_page");

    private final String value;

    BrowserAgentPolicy(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    public static BrowserAgentPolicy fromValue(String value) {
        for (BrowserAgentPolicy policy : BrowserAgentPolicy.values()) {
            if (policy.value.equalsIgnoreCase(value)) {
                return policy;
            }
        }
        throw new IllegalArgumentException("Unknown browser agent policy: " + value);
    }
}
