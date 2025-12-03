package com.newsinsight.collector.entity.search;

/**
 * Types of searches that can be performed and stored.
 */
public enum SearchType {
    /** Unified parallel search (DB + Web + AI) */
    UNIFIED,
    
    /** Deep AI search with crawl agents */
    DEEP_SEARCH,
    
    /** Fact verification search */
    FACT_CHECK,
    
    /** Browser agent research */
    BROWSER_AGENT
}
