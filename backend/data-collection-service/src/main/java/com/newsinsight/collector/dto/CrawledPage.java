package com.newsinsight.collector.dto;

import java.util.List;

/**
 * DTO representing a crawled web page
 * Used by IntegratedCrawlerService to pass crawl results
 */
public record CrawledPage(
        String url,
        String title,
        String content,
        String source,  // e.g., "crawl4ai", "browser-use", "direct"
        List<String> links
) {
    /**
     * Create a CrawledPage with no extracted links
     */
    public static CrawledPage of(String url, String title, String content, String source) {
        return new CrawledPage(url, title, content, source, List.of());
    }

    /**
     * Check if this page has valid content
     */
    public boolean hasContent() {
        return content != null && !content.isBlank();
    }

    /**
     * Get a truncated snippet of the content
     */
    public String getSnippet(int maxLength) {
        if (content == null) return "";
        if (content.length() <= maxLength) return content;
        return content.substring(0, maxLength) + "...";
    }
}
