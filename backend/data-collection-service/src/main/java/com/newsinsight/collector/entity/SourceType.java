package com.newsinsight.collector.entity;

/**
 * Types of data sources for collection.
 * 
 * - RSS: RSS/Atom feed parsing (Rome library)
 * - WEB: Static HTML scraping (Crawl4AI/Jsoup)
 * - API: External API integration (future)
 * - WEBHOOK: Passive event reception (future)
 * - BROWSER_AGENT: AI-driven autonomous browser exploration (Browser-use/Puppeteer)
 */
public enum SourceType {
    RSS("rss"),
    WEB("web"),
    API("api"),
    WEBHOOK("webhook"),
    BROWSER_AGENT("browser_agent");

    private final String value;

    SourceType(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    /**
     * Check if this source type requires browser-based collection.
     */
    public boolean requiresBrowser() {
        return this == BROWSER_AGENT;
    }

    /**
     * Check if this source type supports autonomous exploration.
     */
    public boolean supportsAutonomousExploration() {
        return this == BROWSER_AGENT;
    }

    public static SourceType fromValue(String value) {
        for (SourceType type : SourceType.values()) {
            if (type.value.equalsIgnoreCase(value)) {
                return type;
            }
        }
        throw new IllegalArgumentException("Unknown source type: " + value);
    }
}
