package com.newsinsight.collector.dto.llm;

import com.newsinsight.collector.entity.settings.LlmProviderType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * LLM Provider 연결 테스트 결과 DTO.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LlmTestResult {

    /**
     * 테스트 성공 여부
     */
    private boolean success;

    /**
     * Provider 타입
     */
    private LlmProviderType providerType;

    /**
     * 결과 메시지
     */
    private String message;

    /**
     * 에러 메시지 (실패 시)
     */
    private String error;

    /**
     * 응답 시간 (밀리초)
     */
    private Long responseTime;

    /**
     * 사용 가능한 모델 목록 (성공 시)
     */
    private java.util.List<String> availableModels;
}
