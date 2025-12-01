package com.newsinsight.collector.entity.addon;

/**
 * Add-on 실행 상태.
 */
public enum ExecutionStatus {
    
    /**
     * 대기 중 (큐에 있음)
     */
    PENDING,
    
    /**
     * 실행 중
     */
    RUNNING,
    
    /**
     * 성공
     */
    SUCCESS,
    
    /**
     * 실패
     */
    FAILED,
    
    /**
     * 타임아웃
     */
    TIMEOUT,
    
    /**
     * 취소됨
     */
    CANCELLED,
    
    /**
     * 건너뜀 (의존성 실패 등)
     */
    SKIPPED
}
