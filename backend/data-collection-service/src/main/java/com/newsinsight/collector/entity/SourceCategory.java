package com.newsinsight.collector.entity;

/**
 * Category of data source for distinguishing content origin.
 * 
 * - NEWS: Official news media sources (newspapers, broadcasters, news agencies)
 * - COMMUNITY: Community/forum sources (Reddit, DCInside, Clien, Twitter, etc.)
 * - BLOG: Personal blogs and opinion pieces
 * - OFFICIAL: Official government/organization sources
 * - ACADEMIC: Academic papers and research
 */
public enum SourceCategory {
    NEWS("news", "뉴스"),
    COMMUNITY("community", "커뮤니티"),
    BLOG("blog", "블로그"),
    OFFICIAL("official", "공식"),
    ACADEMIC("academic", "학술");

    private final String value;
    private final String label;

    SourceCategory(String value, String label) {
        this.value = value;
        this.label = label;
    }

    public String getValue() {
        return value;
    }

    public String getLabel() {
        return label;
    }

    /**
     * Check if this category is a primary news source.
     */
    public boolean isPrimarySource() {
        return this == NEWS || this == OFFICIAL || this == ACADEMIC;
    }

    /**
     * Check if this category represents user-generated content.
     */
    public boolean isUserGenerated() {
        return this == COMMUNITY || this == BLOG;
    }

    public static SourceCategory fromValue(String value) {
        if (value == null) return NEWS;
        for (SourceCategory category : SourceCategory.values()) {
            if (category.value.equalsIgnoreCase(value)) {
                return category;
            }
        }
        return NEWS; // Default to NEWS
    }

    /**
     * Infer category from source domain name.
     */
    public static SourceCategory inferFromDomain(String domain) {
        if (domain == null) return NEWS;
        String lowerDomain = domain.toLowerCase();
        
        // Community sites
        if (lowerDomain.contains("reddit.com") ||
            lowerDomain.contains("dcinside.com") ||
            lowerDomain.contains("clien.net") ||
            lowerDomain.contains("ruliweb.com") ||
            lowerDomain.contains("ppomppu.co.kr") ||
            lowerDomain.contains("fmkorea.com") ||
            lowerDomain.contains("mlbpark.donga.com") ||
            lowerDomain.contains("bobaedream.co.kr") ||
            lowerDomain.contains("theqoo.net") ||
            lowerDomain.contains("instiz.net") ||
            lowerDomain.contains("twitter.com") ||
            lowerDomain.contains("x.com") ||
            lowerDomain.contains("threads.net") ||
            lowerDomain.contains("quora.com") ||
            lowerDomain.contains("cafe.naver.com") ||
            lowerDomain.contains("cafe.daum.net")) {
            return COMMUNITY;
        }
        
        // Blog platforms
        if (lowerDomain.contains("blog.naver.com") ||
            lowerDomain.contains("tistory.com") ||
            lowerDomain.contains("brunch.co.kr") ||
            lowerDomain.contains("medium.com") ||
            lowerDomain.contains("velog.io") ||
            lowerDomain.contains("wordpress.com") ||
            lowerDomain.contains("substack.com")) {
            return BLOG;
        }
        
        // Official sources
        if (lowerDomain.contains(".go.kr") ||
            lowerDomain.contains(".gov") ||
            lowerDomain.contains(".mil")) {
            return OFFICIAL;
        }
        
        // Academic sources
        if (lowerDomain.contains("scholar.google") ||
            lowerDomain.contains("arxiv.org") ||
            lowerDomain.contains("pubmed") ||
            lowerDomain.contains("sciencedirect") ||
            lowerDomain.contains("springer.com") ||
            lowerDomain.contains("nature.com") ||
            lowerDomain.contains("ieee.org") ||
            lowerDomain.contains(".edu") ||
            lowerDomain.contains(".ac.kr")) {
            return ACADEMIC;
        }
        
        return NEWS;
    }
}
