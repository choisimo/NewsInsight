package com.newsinsight.collector.entity.autocrawl;

/**
 * 크롤링 대상 URL 상태
 */
public enum CrawlTargetStatus {
    /**
     * 대기 중 (처리 가능)
     */
    PENDING,
    
    /**
     * 처리 중
     */
    IN_PROGRESS,
    
    /**
     * 완료
     */
    COMPLETED,
    
    /**
     * 실패 (재시도 횟수 초과)
     */
    FAILED,
    
    /**
     * 건너뜀 (중복, 블랙리스트 등)
     */
    SKIPPED,
    
    /**
     * 취소됨
     */
    CANCELLED,
    
    /**
     * 만료됨 (오래 대기 중인 상태로 방치됨)
     */
    EXPIRED
}
