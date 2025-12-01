package com.newsinsight.collector.entity.addon;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Add-on 실행 이력 엔티티.
 * 
 * 각 분석 작업의 요청/응답/상태를 기록.
 * 디버깅, 모니터링, 감사 추적에 활용.
 */
@Entity
@Table(name = "ml_addon_execution", indexes = {
    @Index(name = "idx_exec_addon_id", columnList = "addon_id"),
    @Index(name = "idx_exec_article_id", columnList = "article_id"),
    @Index(name = "idx_exec_status", columnList = "status"),
    @Index(name = "idx_exec_created", columnList = "created_at"),
    @Index(name = "idx_exec_batch_id", columnList = "batch_id")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MlAddonExecution {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 요청 고유 ID (UUID)
     */
    @Column(name = "request_id", nullable = false, unique = true, length = 50)
    private String requestId;

    /**
     * 배치 ID (여러 기사를 한 번에 처리할 때)
     */
    @Column(name = "batch_id", length = 50)
    private String batchId;

    /**
     * 대상 Add-on
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "addon_id", nullable = false)
    private MlAddon addon;

    /**
     * 분석 대상 기사 ID
     */
    @Column(name = "article_id")
    private Long articleId;

    /**
     * 분석 대상 URL (기사가 아닌 경우)
     */
    @Column(name = "target_url", length = 1000)
    private String targetUrl;

    /**
     * 실행 상태
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 20)
    @Builder.Default
    private ExecutionStatus status = ExecutionStatus.PENDING;

    /**
     * 요청 페이로드 (디버깅용, 민감정보 주의)
     */
    @Column(name = "request_payload", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Object> requestPayload;

    /**
     * 응답 결과 (분석 결과 전체)
     */
    @Column(name = "response_payload", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Object> responsePayload;

    /**
     * 에러 메시지 (실패 시)
     */
    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    /**
     * 에러 코드
     */
    @Column(name = "error_code", length = 50)
    private String errorCode;

    /**
     * 재시도 횟수
     */
    @Column(name = "retry_count")
    @Builder.Default
    private Integer retryCount = 0;

    /**
     * 요청 시작 시간
     */
    @Column(name = "started_at")
    private LocalDateTime startedAt;

    /**
     * 요청 완료 시간
     */
    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    /**
     * 실행 소요 시간 (ms)
     */
    @Column(name = "latency_ms")
    private Long latencyMs;

    /**
     * 모델 버전 (Add-on이 반환)
     */
    @Column(name = "model_version", length = 100)
    private String modelVersion;

    /**
     * 생성 시간
     */
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    /**
     * 중요도/우선순위 (realtime, batch)
     */
    @Column(name = "importance", length = 20)
    @Builder.Default
    private String importance = "batch";

    // === Helper Methods ===

    public void markStarted() {
        this.status = ExecutionStatus.RUNNING;
        this.startedAt = LocalDateTime.now();
    }

    public void markSuccess(Map<String, Object> response, String modelVersion) {
        this.status = ExecutionStatus.SUCCESS;
        this.completedAt = LocalDateTime.now();
        this.responsePayload = response;
        this.modelVersion = modelVersion;
        if (this.startedAt != null) {
            this.latencyMs = java.time.Duration.between(startedAt, completedAt).toMillis();
        }
    }

    public void markFailed(String errorCode, String errorMessage) {
        this.status = ExecutionStatus.FAILED;
        this.completedAt = LocalDateTime.now();
        this.errorCode = errorCode;
        this.errorMessage = errorMessage;
        if (this.startedAt != null) {
            this.latencyMs = java.time.Duration.between(startedAt, completedAt).toMillis();
        }
    }

    public void incrementRetry() {
        this.retryCount = (this.retryCount != null ? this.retryCount : 0) + 1;
        this.status = ExecutionStatus.PENDING;
    }
}
