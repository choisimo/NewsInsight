package com.newsinsight.collector.entity.autocrawl;

/**
 * 크롤링 대상 URL 발견 출처
 */
public enum DiscoverySource {
    /**
     * 사용자 검색 결과에서 발견
     */
    SEARCH,
    
    /**
     * 기사 본문 내 외부 링크에서 발견
     */
    ARTICLE_LINK,
    
    /**
     * 트렌딩 토픽/급상승 검색어에서 발견
     */
    TRENDING,
    
    /**
     * RSS 피드 본문 내 언급에서 발견
     */
    RSS_MENTION,
    
    /**
     * Deep Search 결과에서 발견
     */
    DEEP_SEARCH,
    
    /**
     * AI 분석 추천 URL
     */
    AI_RECOMMENDATION,
    
    /**
     * 관리자 수동 등록
     */
    MANUAL,
    
    /**
     * 외부 API에서 수신
     */
    EXTERNAL_API
}
