package com.newsinsight.collector.dto.llm;

import com.newsinsight.collector.entity.settings.LlmProviderType;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * LLM Provider 설정 요청 DTO.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LlmProviderSettingsRequest {

    /**
     * Provider 타입 (필수)
     */
    @NotNull(message = "Provider type is required")
    private LlmProviderType providerType;

    /**
     * API 키
     */
    private String apiKey;

    /**
     * 기본 모델명
     */
    private String defaultModel;

    /**
     * Base URL (커스텀 엔드포인트용)
     */
    private String baseUrl;

    /**
     * 활성화 여부
     */
    private Boolean enabled;

    /**
     * 우선순위 (1-999)
     */
    @Min(value = 1, message = "Priority must be at least 1")
    @Max(value = 999, message = "Priority must be at most 999")
    private Integer priority;

    /**
     * 최대 토큰 수
     */
    @Min(value = 1, message = "Max tokens must be positive")
    @Max(value = 128000, message = "Max tokens must be at most 128000")
    private Integer maxTokens;

    /**
     * Temperature (0.0 ~ 2.0)
     */
    @Min(value = 0, message = "Temperature must be at least 0")
    @Max(value = 2, message = "Temperature must be at most 2")
    private Double temperature;

    /**
     * 요청 타임아웃 (밀리초)
     */
    @Min(value = 1000, message = "Timeout must be at least 1000ms")
    @Max(value = 300000, message = "Timeout must be at most 300000ms")
    private Integer timeoutMs;

    /**
     * 분당 최대 요청 수
     */
    @Min(value = 1, message = "Max requests per minute must be positive")
    private Integer maxRequestsPerMinute;

    /**
     * Azure Deployment Name
     */
    private String azureDeploymentName;

    /**
     * Azure API Version
     */
    private String azureApiVersion;
}
