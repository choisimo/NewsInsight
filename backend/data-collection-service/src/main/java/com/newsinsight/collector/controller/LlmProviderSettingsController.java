package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.llm.LlmProviderSettingsDto;
import com.newsinsight.collector.dto.llm.LlmProviderSettingsRequest;
import com.newsinsight.collector.dto.llm.LlmTestResult;
import com.newsinsight.collector.entity.settings.LlmProviderType;
import com.newsinsight.collector.service.LlmProviderSettingsService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * LLM Provider 설정 API 컨트롤러.
 * 
 * 관리자(전역) 설정과 사용자별 설정을 분리하여 관리.
 * - /api/v1/admin/llm-providers: 관리자 전역 설정
 * - /api/v1/llm-providers: 사용자별 설정
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
@Slf4j
public class LlmProviderSettingsController {

    private final LlmProviderSettingsService settingsService;

    // ========== 공통: Provider 타입 목록 ==========

    /**
     * 지원하는 LLM Provider 타입 목록
     */
    @GetMapping("/llm-providers/types")
    public ResponseEntity<List<Map<String, String>>> getProviderTypes() {
        List<Map<String, String>> types = Arrays.stream(LlmProviderType.values())
                .map(type -> Map.of(
                        "value", type.name(),
                        "displayName", type.getDisplayName(),
                        "defaultBaseUrl", type.getDefaultBaseUrl() != null ? type.getDefaultBaseUrl() : ""
                ))
                .collect(Collectors.toList());
        return ResponseEntity.ok(types);
    }

    // ========== 관리자 전역 설정 API ==========

    /**
     * 모든 전역 설정 조회
     */
    @GetMapping("/admin/llm-providers")
    public ResponseEntity<List<LlmProviderSettingsDto>> getAllGlobalSettings() {
        return ResponseEntity.ok(settingsService.getAllGlobalSettings());
    }

    /**
     * 특정 Provider의 전역 설정 조회
     */
    @GetMapping("/admin/llm-providers/{providerType}")
    public ResponseEntity<LlmProviderSettingsDto> getGlobalSetting(@PathVariable LlmProviderType providerType) {
        return settingsService.getGlobalSetting(providerType)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * 전역 설정 생성/업데이트
     */
    @PutMapping("/admin/llm-providers")
    public ResponseEntity<LlmProviderSettingsDto> saveGlobalSetting(
            @Valid @RequestBody LlmProviderSettingsRequest request
    ) {
        LlmProviderSettingsDto saved = settingsService.saveGlobalSetting(request);
        return ResponseEntity.ok(saved);
    }

    /**
     * 전역 설정 삭제
     */
    @DeleteMapping("/admin/llm-providers/{providerType}")
    public ResponseEntity<Map<String, String>> deleteGlobalSetting(@PathVariable LlmProviderType providerType) {
        settingsService.deleteGlobalSetting(providerType);
        return ResponseEntity.ok(Map.of(
                "status", "deleted",
                "provider", providerType.name()
        ));
    }

    /**
     * 전역 설정 연결 테스트
     */
    @PostMapping("/admin/llm-providers/{id}/test")
    public ResponseEntity<LlmTestResult> testGlobalConnection(@PathVariable Long id) {
        LlmTestResult result = settingsService.testConnection(id);
        return ResponseEntity.ok(result);
    }

    /**
     * 전역 설정 활성화/비활성화
     */
    @PostMapping("/admin/llm-providers/{id}/toggle")
    public ResponseEntity<Map<String, Object>> toggleGlobalSetting(
            @PathVariable Long id,
            @RequestParam boolean enabled
    ) {
        settingsService.setEnabled(id, enabled);
        return ResponseEntity.ok(Map.of(
                "id", id,
                "enabled", enabled
        ));
    }

    // ========== 사용자별 설정 API ==========

    /**
     * 사용자의 유효 설정 조회 (사용자 설정 > 전역 설정)
     */
    @GetMapping("/llm-providers/effective")
    public ResponseEntity<List<LlmProviderSettingsDto>> getEffectiveSettings(
            @RequestHeader(value = "X-User-Id", required = false) String userId
    ) {
        return ResponseEntity.ok(settingsService.getEffectiveSettings(userId));
    }

    /**
     * 사용자의 활성화된 Provider 목록 (Fallback 체인용)
     */
    @GetMapping("/llm-providers/enabled")
    public ResponseEntity<List<LlmProviderSettingsDto>> getEnabledProviders(
            @RequestHeader(value = "X-User-Id", required = false) String userId
    ) {
        return ResponseEntity.ok(settingsService.getEnabledProviders(userId));
    }

    /**
     * 특정 Provider의 유효 설정 조회
     */
    @GetMapping("/llm-providers/config/{providerType}")
    public ResponseEntity<LlmProviderSettingsDto> getEffectiveSetting(
            @PathVariable LlmProviderType providerType,
            @RequestHeader(value = "X-User-Id", required = false) String userId
    ) {
        return settingsService.getEffectiveSetting(userId, providerType)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * 사용자의 개인 설정만 조회
     */
    @GetMapping("/llm-providers/user")
    public ResponseEntity<List<LlmProviderSettingsDto>> getUserSettings(
            @RequestHeader("X-User-Id") String userId
    ) {
        return ResponseEntity.ok(settingsService.getUserSettings(userId));
    }

    /**
     * 사용자 설정 생성/업데이트
     */
    @PutMapping("/llm-providers/user")
    public ResponseEntity<LlmProviderSettingsDto> saveUserSetting(
            @RequestHeader("X-User-Id") String userId,
            @Valid @RequestBody LlmProviderSettingsRequest request
    ) {
        LlmProviderSettingsDto saved = settingsService.saveUserSetting(userId, request);
        return ResponseEntity.ok(saved);
    }

    /**
     * 사용자 설정 삭제 (전역 설정으로 폴백)
     */
    @DeleteMapping("/llm-providers/user/{providerType}")
    public ResponseEntity<Map<String, String>> deleteUserSetting(
            @RequestHeader("X-User-Id") String userId,
            @PathVariable LlmProviderType providerType
    ) {
        settingsService.deleteUserSetting(userId, providerType);
        return ResponseEntity.ok(Map.of(
                "status", "deleted",
                "provider", providerType.name(),
                "message", "Falling back to global settings"
        ));
    }

    /**
     * 사용자의 모든 개인 설정 삭제
     */
    @DeleteMapping("/llm-providers/user")
    public ResponseEntity<Map<String, String>> deleteAllUserSettings(
            @RequestHeader("X-User-Id") String userId
    ) {
        settingsService.deleteAllUserSettings(userId);
        return ResponseEntity.ok(Map.of(
                "status", "deleted",
                "message", "All user settings deleted, falling back to global settings"
        ));
    }

    /**
     * 사용자 설정 연결 테스트
     */
    @PostMapping("/llm-providers/user/{id}/test")
    public ResponseEntity<LlmTestResult> testUserConnection(@PathVariable Long id) {
        LlmTestResult result = settingsService.testConnection(id);
        return ResponseEntity.ok(result);
    }

    /**
     * 새 설정으로 연결 테스트 (저장 전)
     */
    @PostMapping("/llm-providers/test")
    public ResponseEntity<LlmTestResult> testNewConnection(
            @Valid @RequestBody LlmProviderSettingsRequest request
    ) {
        LlmTestResult result = settingsService.testConnection(request);
        return ResponseEntity.ok(result);
    }

    // ========== 예외 처리 ==========

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> handleIllegalArgument(IllegalArgumentException e) {
        return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> handleException(Exception e) {
        log.error("Unexpected error in LlmProviderSettingsController", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "Internal server error: " + e.getMessage()));
    }
}
