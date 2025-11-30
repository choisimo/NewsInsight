package com.newsinsight.collector.entity.addon;

/**
 * Add-on 인증 타입.
 */
public enum AddonAuthType {
    
    /**
     * 인증 없음
     */
    NONE,
    
    /**
     * API Key 인증 (헤더 또는 쿼리 파라미터)
     */
    API_KEY,
    
    /**
     * Bearer Token
     */
    BEARER_TOKEN,
    
    /**
     * Basic Auth
     */
    BASIC,
    
    /**
     * OAuth 2.0
     */
    OAUTH2
}
