package com.newsinsight.collector.entity.settings;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * LLM Provider 설정 엔티티.
 * 
 * 관리자(전역) 설정과 사용자별 설정을 통합 관리.
 * - userId가 null이면 전역(관리자) 설정
 * - userId가 있으면 해당 사용자의 개인 설정
 * 
 * 사용자 설정이 존재하면 전역 설정보다 우선 적용됨.
 */
@Entity
@Table(name = "llm_provider_settings", 
    uniqueConstraints = {
        @UniqueConstraint(name = "uk_llm_provider_user", columnNames = {"provider_type", "user_id"})
    },
    indexes = {
        @Index(name = "idx_llm_settings_user", columnList = "user_id"),
        @Index(name = "idx_llm_settings_provider", columnList = "provider_type"),
        @Index(name = "idx_llm_settings_enabled", columnList = "enabled")
    }
)
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LlmProviderSettings {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * LLM 제공자 타입
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "provider_type", nullable = false, length = 30)
    private LlmProviderType providerType;

    /**
     * 사용자 ID (null = 전역/관리자 설정)
     */
    @Column(name = "user_id", length = 100)
    private String userId;

    /**
     * API 키 (암호화 저장 권장)
     */
    @Column(name = "api_key", columnDefinition = "TEXT")
    private String apiKey;

    /**
     * 기본 모델명
     * 예: gpt-4o, claude-3-5-sonnet-20241022, gemini-1.5-pro
     */
    @Column(name = "default_model", length = 100)
    private String defaultModel;

    /**
     * API Base URL (커스텀 엔드포인트용)
     */
    @Column(name = "base_url", length = 500)
    private String baseUrl;

    /**
     * 활성화 여부
     */
    @Column(name = "enabled", nullable = false)
    @Builder.Default
    private Boolean enabled = true;

    /**
     * 우선순위 (낮을수록 먼저 사용, fallback 체인용)
     */
    @Column(name = "priority")
    @Builder.Default
    private Integer priority = 100;

    /**
     * 최대 토큰 수
     */
    @Column(name = "max_tokens")
    @Builder.Default
    private Integer maxTokens = 4096;

    /**
     * Temperature (0.0 ~ 2.0)
     */
    @Column(name = "temperature")
    @Builder.Default
    private Double temperature = 0.7;

    /**
     * 요청 타임아웃 (밀리초)
     */
    @Column(name = "timeout_ms")
    @Builder.Default
    private Integer timeoutMs = 60000;

    /**
     * 분당 최대 요청 수 (Rate limiting)
     */
    @Column(name = "max_requests_per_minute")
    @Builder.Default
    private Integer maxRequestsPerMinute = 60;

    /**
     * Azure OpenAI 전용: Deployment Name
     */
    @Column(name = "azure_deployment_name", length = 100)
    private String azureDeploymentName;

    /**
     * Azure OpenAI 전용: API Version
     */
    @Column(name = "azure_api_version", length = 20)
    private String azureApiVersion;

    /**
     * 마지막 테스트 성공 시간
     */
    @Column(name = "last_tested_at")
    private LocalDateTime lastTestedAt;

    /**
     * 마지막 테스트 결과
     */
    @Column(name = "last_test_success")
    private Boolean lastTestSuccess;

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

    // === Helper Methods ===

    /**
     * 전역(관리자) 설정인지 확인
     */
    public boolean isGlobal() {
        return userId == null || userId.isBlank();
    }

    /**
     * 사용자별 설정인지 확인
     */
    public boolean isUserSpecific() {
        return userId != null && !userId.isBlank();
    }

    /**
     * API 키 마스킹 (표시용)
     */
    public String getMaskedApiKey() {
        if (apiKey == null || apiKey.length() < 8) {
            return "****";
        }
        return apiKey.substring(0, 4) + "****" + apiKey.substring(apiKey.length() - 4);
    }
}
