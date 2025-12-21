package com.newsinsight.collector.dto.llm;

import com.newsinsight.collector.entity.settings.LlmProviderType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * LLM Provider 설정 응답 DTO.
 * API 키는 마스킹되어 반환됨.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LlmProviderSettingsDto {

    private Long id;

    /**
     * Provider 타입
     */
    private LlmProviderType providerType;

    /**
     * Provider 표시명
     */
    private String providerDisplayName;

    /**
     * 사용자 ID (null이면 전역 설정)
     */
    private String userId;

    /**
     * 전역 설정 여부
     */
    private Boolean isGlobal;

    /**
     * 마스킹된 API 키 (예: sk-a***...xyz)
     */
    private String apiKeyMasked;

    /**
     * API 키 존재 여부
     */
    private Boolean hasApiKey;

    /**
     * 기본 모델
     */
    private String defaultModel;

    /**
     * Base URL
     */
    private String baseUrl;

    /**
     * 활성화 여부
     */
    private Boolean enabled;

    /**
     * 우선순위
     */
    private Integer priority;

    /**
     * 최대 토큰
     */
    private Integer maxTokens;

    /**
     * Temperature
     */
    private Double temperature;

    /**
     * 타임아웃 (ms)
     */
    private Integer timeoutMs;

    /**
     * 분당 최대 요청 수
     */
    private Integer maxRequestsPerMinute;

    /**
     * Azure Deployment Name
     */
    private String azureDeploymentName;

    /**
     * Azure API Version
     */
    private String azureApiVersion;

    /**
     * 마지막 테스트 시간
     */
    private LocalDateTime lastTestedAt;

    /**
     * 마지막 테스트 성공 여부
     */
    private Boolean lastTestSuccess;

    /**
     * 생성일시
     */
    private LocalDateTime createdAt;

    /**
     * 수정일시
     */
    private LocalDateTime updatedAt;
}
