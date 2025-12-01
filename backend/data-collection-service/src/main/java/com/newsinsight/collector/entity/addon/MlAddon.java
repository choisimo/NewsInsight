package com.newsinsight.collector.entity.addon;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * ML Add-on Registry Entity.
 * 
 * 각 ML 분석 기능(감정분석, 팩트체크, 편향도 분석 등)을 플러그인 형태로 등록/관리.
 * 내부 서비스(Spring/Python), 외부 Colab, 또는 서드파티 API 모두 동일한 방식으로 연결 가능.
 */
@Entity
@Table(name = "ml_addon", indexes = {
    @Index(name = "idx_addon_category", columnList = "category"),
    @Index(name = "idx_addon_enabled", columnList = "enabled"),
    @Index(name = "idx_addon_invoke_type", columnList = "invoke_type")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MlAddon {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Add-on 고유 식별자 (예: "sentiment-v1", "factcheck-korean-v2")
     */
    @Column(name = "addon_key", nullable = false, unique = true, length = 100)
    private String addonKey;

    /**
     * 표시용 이름
     */
    @Column(name = "name", nullable = false, length = 200)
    private String name;

    /**
     * Add-on 설명
     */
    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    /**
     * 분류 카테고리
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "category", nullable = false, length = 50)
    private AddonCategory category;

    /**
     * 호출 타입
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "invoke_type", nullable = false, length = 30)
    private AddonInvokeType invokeType;

    /**
     * HTTP 호출 시 엔드포인트 URL
     */
    @Column(name = "endpoint_url", length = 500)
    private String endpointUrl;

    /**
     * 큐 기반 호출 시 토픽명
     */
    @Column(name = "queue_topic", length = 200)
    private String queueTopic;

    /**
     * 파일 폴링 시 스토리지 경로
     */
    @Column(name = "storage_path", length = 500)
    private String storagePath;

    /**
     * 인증 타입
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "auth_type", length = 30)
    @Builder.Default
    private AddonAuthType authType = AddonAuthType.NONE;

    /**
     * 인증 정보 (암호화 저장 권장)
     * API Key, OAuth credentials 등
     */
    @Column(name = "auth_credentials", columnDefinition = "TEXT")
    private String authCredentials;

    /**
     * Input 스키마 버전 (호환성 체크용)
     */
    @Column(name = "input_schema_version", length = 20)
    @Builder.Default
    private String inputSchemaVersion = "1.0";

    /**
     * Output 스키마 버전
     */
    @Column(name = "output_schema_version", length = 20)
    @Builder.Default
    private String outputSchemaVersion = "1.0";

    /**
     * 타임아웃 (밀리초)
     */
    @Column(name = "timeout_ms")
    @Builder.Default
    private Integer timeoutMs = 30000;

    /**
     * 초당 최대 요청 수 (Rate limiting)
     */
    @Column(name = "max_qps")
    @Builder.Default
    private Integer maxQps = 10;

    /**
     * 재시도 횟수
     */
    @Column(name = "max_retries")
    @Builder.Default
    private Integer maxRetries = 3;

    /**
     * 의존하는 다른 Add-on들의 addonKey 목록 (DAG 구성용)
     * 예: ["entity_extractor_v1", "topic_classifier_v1"]
     */
    @Column(name = "depends_on", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> dependsOn;

    /**
     * 활성화 여부
     */
    @Column(name = "enabled", nullable = false)
    @Builder.Default
    private Boolean enabled = true;

    /**
     * 우선순위 (낮을수록 먼저 실행)
     */
    @Column(name = "priority")
    @Builder.Default
    private Integer priority = 100;

    /**
     * 추가 설정 (JSON)
     * - 모델 파라미터
     * - 언어 설정
     * - 임계값 등
     */
    @Column(name = "config", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Object> config;

    /**
     * 헬스체크 엔드포인트 (옵션)
     */
    @Column(name = "health_check_url", length = 500)
    private String healthCheckUrl;

    /**
     * 마지막 헬스체크 상태
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "health_status", length = 20)
    @Builder.Default
    private AddonHealthStatus healthStatus = AddonHealthStatus.UNKNOWN;

    /**
     * 마지막 헬스체크 시간
     */
    @Column(name = "last_health_check")
    private LocalDateTime lastHealthCheck;

    /**
     * 관리자/소유자
     */
    @Column(name = "owner", length = 100)
    private String owner;

    /**
     * 생성일시
     */
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    /**
     * 수정일시
     */
    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    // === 운영 통계 (캐시용, 주기적 업데이트) ===

    /**
     * 총 실행 횟수
     */
    @Column(name = "total_executions")
    @Builder.Default
    private Long totalExecutions = 0L;

    /**
     * 성공 횟수
     */
    @Column(name = "success_count")
    @Builder.Default
    private Long successCount = 0L;

    /**
     * 실패 횟수
     */
    @Column(name = "failure_count")
    @Builder.Default
    private Long failureCount = 0L;

    /**
     * 평균 응답 시간 (ms)
     */
    @Column(name = "avg_latency_ms")
    private Double avgLatencyMs;

    /**
     * 통계 마지막 갱신 시간
     */
    @Column(name = "stats_updated_at")
    private LocalDateTime statsUpdatedAt;

    // === Helper Methods ===

    public boolean isHttpBased() {
        return invokeType == AddonInvokeType.HTTP_SYNC || invokeType == AddonInvokeType.HTTP_ASYNC;
    }

    public boolean isQueueBased() {
        return invokeType == AddonInvokeType.QUEUE;
    }

    public double getSuccessRate() {
        if (totalExecutions == null || totalExecutions == 0) return 0.0;
        return (successCount != null ? successCount : 0) / (double) totalExecutions;
    }

    public void incrementSuccess(long latencyMs) {
        this.totalExecutions = (this.totalExecutions != null ? this.totalExecutions : 0) + 1;
        this.successCount = (this.successCount != null ? this.successCount : 0) + 1;
        // Simple moving average for latency
        if (this.avgLatencyMs == null) {
            this.avgLatencyMs = (double) latencyMs;
        } else {
            this.avgLatencyMs = (this.avgLatencyMs * 0.9) + (latencyMs * 0.1);
        }
        this.statsUpdatedAt = LocalDateTime.now();
    }

    public void incrementFailure() {
        this.totalExecutions = (this.totalExecutions != null ? this.totalExecutions : 0) + 1;
        this.failureCount = (this.failureCount != null ? this.failureCount : 0) + 1;
        this.statsUpdatedAt = LocalDateTime.now();
    }
}
