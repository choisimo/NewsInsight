package com.newsinsight.collector.entity.addon;

/**
 * Add-on 헬스체크 상태.
 */
public enum AddonHealthStatus {
    
    /**
     * 정상
     */
    HEALTHY,
    
    /**
     * 불안정 (간헐적 오류)
     */
    DEGRADED,
    
    /**
     * 장애
     */
    UNHEALTHY,
    
    /**
     * 알 수 없음 (아직 체크 안 됨)
     */
    UNKNOWN
}
