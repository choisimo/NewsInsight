package com.newsinsight.collector.entity.autocrawl;

/**
 * 예상 콘텐츠 타입
 */
public enum ContentType {
    /**
     * 뉴스 기사
     */
    NEWS,
    
    /**
     * 블로그/개인 사이트
     */
    BLOG,
    
    /**
     * 포럼/커뮤니티
     */
    FORUM,
    
    /**
     * 소셜 미디어
     */
    SOCIAL,
    
    /**
     * 공식 문서/보고서
     */
    OFFICIAL,
    
    /**
     * 학술/연구
     */
    ACADEMIC,
    
    /**
     * 미분류
     */
    UNKNOWN
}
