package com.newsinsight.collector.controller;

import com.newsinsight.collector.service.ChatSyncService;
import com.newsinsight.collector.service.VectorEmbeddingService;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

/**
 * 채팅 서비스 헬스 체크 컨트롤러
 * 
 * 채팅 서비스의 상태와 의존 서비스들의 상태를 확인합니다.
 */
@RestController
@RequestMapping("/api/v1/factcheck-chat/health")
@RequiredArgsConstructor
@Slf4j
public class ChatHealthController {

    private final MongoTemplate mongoTemplate;
    private final RedisConnectionFactory redisConnectionFactory;
    private final VectorEmbeddingService vectorEmbeddingService;
    private final ChatSyncService chatSyncService;
    private final MeterRegistry meterRegistry;

    /**
     * 종합 헬스 체크
     */
    @GetMapping
    public ResponseEntity<HealthResponse> getHealth() {
        HealthResponse response = HealthResponse.builder()
                .status("UP")
                .timestamp(LocalDateTime.now())
                .mongodb(checkMongoHealth())
                .redis(checkRedisHealth())
                .vectorDb(checkVectorDbHealth())
                .sync(getSyncStatus())
                .build();

        // 전체 상태 결정
        if (!response.getMongodb().isHealthy() || !response.getRedis().isHealthy()) {
            response.setStatus("DOWN");
        } else if (!response.getVectorDb().isHealthy()) {
            response.setStatus("DEGRADED");
        }

        return ResponseEntity.ok(response);
    }

    /**
     * MongoDB 상태 확인
     */
    @GetMapping("/mongodb")
    public ResponseEntity<ComponentHealth> getMongoHealth() {
        return ResponseEntity.ok(checkMongoHealth());
    }

    /**
     * Redis 상태 확인
     */
    @GetMapping("/redis")
    public ResponseEntity<ComponentHealth> getRedisHealth() {
        return ResponseEntity.ok(checkRedisHealth());
    }

    /**
     * 벡터 DB 상태 확인
     */
    @GetMapping("/vector")
    public ResponseEntity<ComponentHealth> getVectorHealth() {
        return ResponseEntity.ok(checkVectorDbHealth());
    }

    /**
     * 동기화 상태 확인
     */
    @GetMapping("/sync")
    public ResponseEntity<SyncHealthStatus> getSyncHealth() {
        return ResponseEntity.ok(getSyncStatus());
    }

    /**
     * 메트릭 요약
     */
    @GetMapping("/metrics")
    public ResponseEntity<Map<String, Object>> getMetrics() {
        Map<String, Object> metrics = new HashMap<>();
        
        // 세션 메트릭
        metrics.put("sessions", Map.of(
                "created", getCounterValue("factcheck.chat.sessions.created"),
                "closed", getCounterValue("factcheck.chat.sessions.closed"),
                "active", getGaugeValue("factcheck.chat.sessions.active")
        ));
        
        // 메시지 메트릭
        metrics.put("messages", Map.of(
                "processed", getCounterValue("factcheck.chat.messages.processed")
        ));
        
        // 팩트체크 메트릭
        metrics.put("factcheck", Map.of(
                "success", getCounterValue("factcheck.chat.factcheck.success"),
                "error", getCounterValue("factcheck.chat.factcheck.error")
        ));
        
        // 동기화 메트릭
        metrics.put("sync", Map.of(
                "rdb_success", getCounterValue("chat.sync.rdb.success"),
                "rdb_error", getCounterValue("chat.sync.rdb.error"),
                "embedding_success", getCounterValue("chat.sync.embedding.success"),
                "embedding_error", getCounterValue("chat.sync.embedding.error"),
                "pending_sync", getGaugeValue("chat.sync.rdb.pending"),
                "pending_embedding", getGaugeValue("chat.sync.embedding.pending")
        ));
        
        // 캐시 에러 메트릭
        metrics.put("cache_errors", Map.of(
                "total", getCounterValue("cache.error")
        ));
        
        return ResponseEntity.ok(metrics);
    }

    private ComponentHealth checkMongoHealth() {
        try {
            mongoTemplate.executeCommand("{ ping: 1 }");
            return ComponentHealth.builder()
                    .name("MongoDB")
                    .healthy(true)
                    .message("Connected")
                    .build();
        } catch (Exception e) {
            log.error("MongoDB health check failed: {}", e.getMessage());
            return ComponentHealth.builder()
                    .name("MongoDB")
                    .healthy(false)
                    .message("Connection failed: " + e.getMessage())
                    .build();
        }
    }

    private ComponentHealth checkRedisHealth() {
        try {
            redisConnectionFactory.getConnection().ping();
            return ComponentHealth.builder()
                    .name("Redis")
                    .healthy(true)
                    .message("Connected")
                    .build();
        } catch (Exception e) {
            log.error("Redis health check failed: {}", e.getMessage());
            return ComponentHealth.builder()
                    .name("Redis")
                    .healthy(false)
                    .message("Connection failed: " + e.getMessage())
                    .build();
        }
    }

    private ComponentHealth checkVectorDbHealth() {
        VectorEmbeddingService.VectorServiceStatus status = vectorEmbeddingService.getStatus();
        
        if (!status.isEnabled()) {
            return ComponentHealth.builder()
                    .name("VectorDB")
                    .healthy(true) // disabled는 에러가 아님
                    .message("Disabled")
                    .build();
        }
        
        return ComponentHealth.builder()
                .name("VectorDB")
                .healthy(status.isVectorDbHealthy())
                .message(status.isVectorDbHealthy() ? "Connected" : "Connection failed")
                .details(Map.of(
                        "url", status.getVectorDbUrl(),
                        "collection", status.getCollectionName(),
                        "embeddingServiceHealthy", status.isEmbeddingServiceHealthy(),
                        "queueSize", status.getQueueSize()
                ))
                .build();
    }

    private SyncHealthStatus getSyncStatus() {
        ChatSyncService.SyncStats stats = chatSyncService.getSyncStats();
        
        return SyncHealthStatus.builder()
                .healthy(stats.getActiveSyncCount() < 10) // 동시 동기화 10개 미만이면 정상
                .pendingSyncCount(stats.getPendingSyncCount())
                .pendingEmbeddingCount(stats.getPendingEmbeddingCount())
                .activeSyncCount(stats.getActiveSyncCount())
                .build();
    }

    private double getCounterValue(String name) {
        try {
            var counter = meterRegistry.find(name).counter();
            return counter != null ? counter.count() : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    private double getGaugeValue(String name) {
        try {
            var gauge = meterRegistry.find(name).gauge();
            return gauge != null ? gauge.value() : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    @Data
    @Builder
    public static class HealthResponse {
        private String status;
        private LocalDateTime timestamp;
        private ComponentHealth mongodb;
        private ComponentHealth redis;
        private ComponentHealth vectorDb;
        private SyncHealthStatus sync;
    }

    @Data
    @Builder
    public static class ComponentHealth {
        private String name;
        private boolean healthy;
        private String message;
        private Map<String, Object> details;
    }

    @Data
    @Builder
    public static class SyncHealthStatus {
        private boolean healthy;
        private long pendingSyncCount;
        private long pendingEmbeddingCount;
        private int activeSyncCount;
    }
}

/**
 * Spring Boot Actuator Health Indicator
 */
@Component
@RequiredArgsConstructor
@Slf4j
class ChatServiceHealthIndicator implements HealthIndicator {

    private final MongoTemplate mongoTemplate;
    private final RedisConnectionFactory redisConnectionFactory;
    private final VectorEmbeddingService vectorEmbeddingService;

    @Override
    public Health health() {
        Health.Builder builder = Health.up();
        
        // MongoDB 체크
        try {
            mongoTemplate.executeCommand("{ ping: 1 }");
            builder.withDetail("mongodb", "UP");
        } catch (Exception e) {
            builder.down().withDetail("mongodb", "DOWN: " + e.getMessage());
            return builder.build();
        }
        
        // Redis 체크
        try {
            redisConnectionFactory.getConnection().ping();
            builder.withDetail("redis", "UP");
        } catch (Exception e) {
            builder.down().withDetail("redis", "DOWN: " + e.getMessage());
            return builder.build();
        }
        
        // Vector DB 체크 (optional)
        VectorEmbeddingService.VectorServiceStatus vectorStatus = vectorEmbeddingService.getStatus();
        if (vectorStatus.isEnabled()) {
            if (vectorStatus.isVectorDbHealthy()) {
                builder.withDetail("vectorDb", "UP");
            } else {
                builder.withDetail("vectorDb", "DOWN");
                // Vector DB는 optional이므로 degraded 상태로
            }
        } else {
            builder.withDetail("vectorDb", "DISABLED");
        }
        
        return builder.build();
    }
}
