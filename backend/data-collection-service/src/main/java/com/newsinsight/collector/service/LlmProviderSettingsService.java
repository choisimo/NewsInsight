package com.newsinsight.collector.service;

import com.newsinsight.collector.dto.llm.LlmProviderSettingsDto;
import com.newsinsight.collector.dto.llm.LlmProviderSettingsRequest;
import com.newsinsight.collector.dto.llm.LlmTestResult;
import com.newsinsight.collector.entity.settings.LlmProviderSettings;
import com.newsinsight.collector.entity.settings.LlmProviderType;
import com.newsinsight.collector.repository.LlmProviderSettingsRepository;
import com.newsinsight.collector.util.ApiKeyEncryptor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

/**
 * LLM Provider 설정 관리 서비스.
 * 
 * 관리자 전역 설정과 사용자별 설정을 관리하며,
 * 사용자 요청 시 유효한 설정(사용자 > 전역 우선순위)을 반환.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class LlmProviderSettingsService {

    private final LlmProviderSettingsRepository repository;
    private final RestTemplate restTemplate;
    private final ApiKeyEncryptor apiKeyEncryptor;

    // ========== 전역(관리자) 설정 관리 ==========

    /**
     * 모든 전역 설정 조회
     */
    @Transactional(readOnly = true)
    public List<LlmProviderSettingsDto> getAllGlobalSettings() {
        return repository.findAllGlobalSettings().stream()
                .map(this::toDto)
                .collect(Collectors.toList());
    }

    /**
     * 특정 Provider의 전역 설정 조회
     */
    @Transactional(readOnly = true)
    public Optional<LlmProviderSettingsDto> getGlobalSetting(LlmProviderType providerType) {
        return repository.findGlobalByProviderType(providerType)
                .map(this::toDto);
    }

    /**
     * 전역 설정 생성/업데이트
     */
    @Transactional
    public LlmProviderSettingsDto saveGlobalSetting(LlmProviderSettingsRequest request) {
        LlmProviderSettings settings = repository.findGlobalByProviderType(request.getProviderType())
                .orElse(LlmProviderSettings.builder()
                        .providerType(request.getProviderType())
                        .userId(null) // 전역 설정
                        .build());

        updateSettingsFromRequest(settings, request);
        LlmProviderSettings saved = repository.save(settings);
        log.info("Saved global LLM setting for provider: {}", request.getProviderType());
        return toDto(saved);
    }

    /**
     * 전역 설정 삭제
     */
    @Transactional
    public void deleteGlobalSetting(LlmProviderType providerType) {
        repository.deleteGlobalByProviderType(providerType);
        log.info("Deleted global LLM setting for provider: {}", providerType);
    }

    // ========== 사용자별 설정 관리 ==========

    /**
     * 사용자의 모든 개인 설정 조회
     */
    @Transactional(readOnly = true)
    public List<LlmProviderSettingsDto> getUserSettings(String userId) {
        return repository.findByUserIdOrderByPriorityAsc(userId).stream()
                .map(this::toDto)
                .collect(Collectors.toList());
    }

    /**
     * 사용자의 특정 Provider 설정 조회
     */
    @Transactional(readOnly = true)
    public Optional<LlmProviderSettingsDto> getUserSetting(String userId, LlmProviderType providerType) {
        return repository.findByProviderTypeAndUserId(providerType, userId)
                .map(this::toDto);
    }

    /**
     * 사용자 설정 생성/업데이트
     */
    @Transactional
    public LlmProviderSettingsDto saveUserSetting(String userId, LlmProviderSettingsRequest request) {
        LlmProviderSettings settings = repository.findByProviderTypeAndUserId(request.getProviderType(), userId)
                .orElse(LlmProviderSettings.builder()
                        .providerType(request.getProviderType())
                        .userId(userId)
                        .build());

        updateSettingsFromRequest(settings, request);
        LlmProviderSettings saved = repository.save(settings);
        log.info("Saved user LLM setting for user: {}, provider: {}", userId, request.getProviderType());
        return toDto(saved);
    }

    /**
     * 사용자 설정 삭제 (전역 설정으로 폴백)
     */
    @Transactional
    public void deleteUserSetting(String userId, LlmProviderType providerType) {
        repository.deleteByProviderTypeAndUserId(providerType, userId);
        log.info("Deleted user LLM setting for user: {}, provider: {}", userId, providerType);
    }

    /**
     * 사용자의 모든 설정 삭제
     */
    @Transactional
    public void deleteAllUserSettings(String userId) {
        repository.deleteByUserId(userId);
        log.info("Deleted all LLM settings for user: {}", userId);
    }

    // ========== 유효(Effective) 설정 조회 ==========

    /**
     * 사용자에게 유효한 모든 설정 조회
     * - 사용자 설정이 있으면 사용자 설정 반환
     * - 없으면 전역 설정 반환
     */
    @Transactional(readOnly = true)
    public List<LlmProviderSettingsDto> getEffectiveSettings(String userId) {
        // 전역 설정 가져오기
        Map<LlmProviderType, LlmProviderSettings> effectiveMap = new LinkedHashMap<>();
        for (LlmProviderSettings global : repository.findAllGlobalSettings()) {
            effectiveMap.put(global.getProviderType(), global);
        }

        // 사용자 설정으로 오버라이드
        if (userId != null && !userId.isBlank()) {
            for (LlmProviderSettings userSetting : repository.findByUserIdOrderByPriorityAsc(userId)) {
                effectiveMap.put(userSetting.getProviderType(), userSetting);
            }
        }

        return effectiveMap.values().stream()
                .sorted(Comparator.comparing(LlmProviderSettings::getPriority))
                .map(this::toDto)
                .collect(Collectors.toList());
    }

    /**
     * 특정 Provider의 유효 설정 조회
     */
    @Transactional(readOnly = true)
    public Optional<LlmProviderSettingsDto> getEffectiveSetting(String userId, LlmProviderType providerType) {
        // 사용자 설정 먼저 확인
        if (userId != null && !userId.isBlank()) {
            Optional<LlmProviderSettings> userSetting = repository.findByProviderTypeAndUserId(providerType, userId);
            if (userSetting.isPresent()) {
                return userSetting.map(this::toDto);
            }
        }
        // 없으면 전역 설정 반환
        return repository.findGlobalByProviderType(providerType).map(this::toDto);
    }

    /**
     * 활성화된 Provider 목록 (Fallback 체인용)
     */
    @Transactional(readOnly = true)
    public List<LlmProviderSettingsDto> getEnabledProviders(String userId) {
        return getEffectiveSettings(userId).stream()
                .filter(LlmProviderSettingsDto::getEnabled)
                .sorted(Comparator.comparing(LlmProviderSettingsDto::getPriority))
                .collect(Collectors.toList());
    }

    // ========== API 키 직접 조회 (내부 서비스용) ==========

    /**
     * 전역 설정에서 API 키 직접 조회 (실시간 검색 등 내부 서비스용)
     * API 키는 복호화하여 반환합니다.
     */
    @Transactional(readOnly = true)
    public Optional<String> getGlobalApiKey(LlmProviderType providerType) {
        return repository.findGlobalByProviderType(providerType)
                .filter(LlmProviderSettings::getEnabled)
                .map(LlmProviderSettings::getApiKey)
                .map(apiKeyEncryptor::decrypt);
    }

    /**
     * 전역 설정에서 Base URL 직접 조회
     */
    @Transactional(readOnly = true)
    public Optional<String> getGlobalBaseUrl(LlmProviderType providerType) {
        return repository.findGlobalByProviderType(providerType)
                .filter(LlmProviderSettings::getEnabled)
                .map(LlmProviderSettings::getBaseUrl);
    }

    // ========== 연결 테스트 ==========

    /**
     * Provider 연결 테스트
     */
    @Transactional
    public LlmTestResult testConnection(Long settingsId) {
        LlmProviderSettings settings = repository.findById(settingsId)
                .orElseThrow(() -> new IllegalArgumentException("Settings not found: " + settingsId));

        LlmTestResult result = performConnectionTest(settings);

        // 테스트 결과 업데이트
        repository.updateTestResult(settingsId, LocalDateTime.now(), result.isSuccess());

        return result;
    }

    /**
     * Provider 연결 테스트 (설정 객체로 직접)
     */
    public LlmTestResult testConnection(LlmProviderSettingsRequest request) {
        LlmProviderSettings settings = LlmProviderSettings.builder()
                .providerType(request.getProviderType())
                .apiKey(request.getApiKey())
                .baseUrl(request.getBaseUrl())
                .defaultModel(request.getDefaultModel())
                .azureDeploymentName(request.getAzureDeploymentName())
                .azureApiVersion(request.getAzureApiVersion())
                .build();

        return performConnectionTest(settings);
    }

    private LlmTestResult performConnectionTest(LlmProviderSettings settings) {
        try {
            String testUrl = buildTestUrl(settings);
            HttpHeaders headers = buildHeaders(settings);

            HttpEntity<String> entity = new HttpEntity<>(headers);
            ResponseEntity<String> response = restTemplate.exchange(
                    testUrl, HttpMethod.GET, entity, String.class
            );

            boolean success = response.getStatusCode().is2xxSuccessful();
            return LlmTestResult.builder()
                    .success(success)
                    .providerType(settings.getProviderType())
                    .message(success ? "Connection successful" : "Connection failed")
                    .responseTime(System.currentTimeMillis())
                    .build();

        } catch (Exception e) {
            log.warn("LLM connection test failed for {}: {}", settings.getProviderType(), e.getMessage());
            return LlmTestResult.builder()
                    .success(false)
                    .providerType(settings.getProviderType())
                    .message("Connection failed: " + e.getMessage())
                    .error(e.getMessage())
                    .build();
        }
    }

    private String buildTestUrl(LlmProviderSettings settings) {
        String baseUrl = settings.getBaseUrl() != null ? settings.getBaseUrl() 
                : settings.getProviderType().getDefaultBaseUrl();

        return switch (settings.getProviderType()) {
            case OPENAI, OPENROUTER, TOGETHER_AI -> baseUrl + "/models";
            case ANTHROPIC -> baseUrl + "/v1/messages"; // Will return 405 but proves connectivity
            case GOOGLE -> baseUrl + "/v1/models";
            case OLLAMA -> baseUrl + "/api/tags";
            case AZURE_OPENAI -> baseUrl + "/openai/deployments?api-version=" + 
                    (settings.getAzureApiVersion() != null ? settings.getAzureApiVersion() : "2024-02-01");
            case PERPLEXITY -> baseUrl + "/chat/completions";
            case BRAVE_SEARCH -> baseUrl + "/web/search";
            case TAVILY -> baseUrl + "/search";
            case CUSTOM -> baseUrl + "/health";
        };
    }

    private HttpHeaders buildHeaders(LlmProviderSettings settings) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        if (settings.getApiKey() != null && !settings.getApiKey().isBlank()) {
            // Decrypt the API key before using it in headers
            String decryptedApiKey = apiKeyEncryptor.decrypt(settings.getApiKey());
            switch (settings.getProviderType()) {
                case OPENAI, OPENROUTER -> headers.setBearerAuth(decryptedApiKey);
                case ANTHROPIC -> {
                    headers.set("x-api-key", decryptedApiKey);
                    headers.set("anthropic-version", "2023-06-01");
                }
                case GOOGLE -> headers.set("x-goog-api-key", decryptedApiKey);
                case AZURE_OPENAI -> headers.set("api-key", decryptedApiKey);
                default -> headers.setBearerAuth(decryptedApiKey);
            }
        }

        return headers;
    }

    // ========== 활성화/비활성화 ==========

    @Transactional
    public void setEnabled(Long settingsId, boolean enabled) {
        repository.updateEnabled(settingsId, enabled);
        log.info("Updated LLM settings {} enabled status to: {}", settingsId, enabled);
    }

    // ========== DTO 변환 ==========

    private LlmProviderSettingsDto toDto(LlmProviderSettings entity) {
        return LlmProviderSettingsDto.builder()
                .id(entity.getId())
                .providerType(entity.getProviderType())
                .providerDisplayName(entity.getProviderType().getDisplayName())
                .userId(entity.getUserId())
                .isGlobal(entity.isGlobal())
                .apiKeyMasked(apiKeyEncryptor.getMaskedKey(entity.getApiKey()))
                .hasApiKey(entity.getApiKey() != null && !entity.getApiKey().isBlank())
                .defaultModel(entity.getDefaultModel())
                .baseUrl(entity.getBaseUrl())
                .enabled(entity.getEnabled())
                .priority(entity.getPriority())
                .maxTokens(entity.getMaxTokens())
                .temperature(entity.getTemperature())
                .timeoutMs(entity.getTimeoutMs())
                .maxRequestsPerMinute(entity.getMaxRequestsPerMinute())
                .azureDeploymentName(entity.getAzureDeploymentName())
                .azureApiVersion(entity.getAzureApiVersion())
                .lastTestedAt(entity.getLastTestedAt())
                .lastTestSuccess(entity.getLastTestSuccess())
                .createdAt(entity.getCreatedAt())
                .updatedAt(entity.getUpdatedAt())
                .build();
    }

    private void updateSettingsFromRequest(LlmProviderSettings settings, LlmProviderSettingsRequest request) {
        // API Key: only update if provided and not blank
        if (request.getApiKey() != null && !request.getApiKey().isBlank()) {
            // Encrypt the API key before storing
            String encryptedApiKey = apiKeyEncryptor.encrypt(request.getApiKey());
            settings.setApiKey(encryptedApiKey);
            log.debug("API key encrypted and stored for provider: {}", settings.getProviderType());
        }
        
        // Default Model: always required, update if provided and not blank
        if (request.getDefaultModel() != null && !request.getDefaultModel().isBlank()) {
            settings.setDefaultModel(request.getDefaultModel());
        }
        
        // Base URL: update if provided (can be blank for some providers)
        if (request.getBaseUrl() != null) {
            settings.setBaseUrl(request.getBaseUrl().isBlank() ? null : request.getBaseUrl());
        }
        
        // Boolean and numeric fields: always update if provided
        if (request.getEnabled() != null) {
            settings.setEnabled(request.getEnabled());
        }
        if (request.getPriority() != null) {
            settings.setPriority(request.getPriority());
        }
        if (request.getMaxTokens() != null) {
            settings.setMaxTokens(request.getMaxTokens());
        }
        if (request.getTemperature() != null) {
            settings.setTemperature(request.getTemperature());
        }
        if (request.getTimeoutMs() != null) {
            settings.setTimeoutMs(request.getTimeoutMs());
        }
        if (request.getMaxRequestsPerMinute() != null) {
            settings.setMaxRequestsPerMinute(request.getMaxRequestsPerMinute());
        }
        
        // Azure specific fields: update if provided and not blank
        if (request.getAzureDeploymentName() != null) {
            settings.setAzureDeploymentName(request.getAzureDeploymentName().isBlank() ? null : request.getAzureDeploymentName());
        }
        if (request.getAzureApiVersion() != null) {
            settings.setAzureApiVersion(request.getAzureApiVersion().isBlank() ? null : request.getAzureApiVersion());
        }
    }
}
