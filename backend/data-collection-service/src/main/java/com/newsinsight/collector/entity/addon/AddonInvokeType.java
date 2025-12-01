package com.newsinsight.collector.entity.addon;

/**
 * Add-on 호출 타입.
 */
public enum AddonInvokeType {
    
    /**
     * HTTP 동기 호출 (응답 대기)
     */
    HTTP_SYNC,
    
    /**
     * HTTP 비동기 호출 (웹훅 콜백)
     */
    HTTP_ASYNC,
    
    /**
     * 메시지 큐 기반 (Kafka, RabbitMQ 등)
     */
    QUEUE,
    
    /**
     * 파일/스토리지 폴링 (S3, GCS 등)
     */
    FILE_POLL
}
