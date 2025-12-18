package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.addon.AddonResponse;
import com.newsinsight.collector.entity.addon.*;
import com.newsinsight.collector.repository.MlAddonExecutionRepository;
import com.newsinsight.collector.repository.MlAddonRepository;
import com.newsinsight.collector.service.AddonOrchestratorService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * ML Add-on 관리 및 분석 실행 API.
 */
@RestController
@RequestMapping("/api/v1/ml")
@RequiredArgsConstructor
@Slf4j
public class MlAddonController {

    private final MlAddonRepository addonRepository;
    private final MlAddonExecutionRepository executionRepository;
    private final AddonOrchestratorService orchestratorService;

    // ========== Add-on Registry 관리 ==========

    /**
     * 모든 Add-on 목록 조회
     */
    @GetMapping("/addons")
    public ResponseEntity<List<MlAddon>> listAddons(
            @RequestParam(required = false) AddonCategory category,
            @RequestParam(required = false) Boolean enabled
    ) {
        List<MlAddon> addons;
        if (category != null && enabled != null && enabled) {
            addons = addonRepository.findByCategoryAndEnabledTrue(category);
        } else if (category != null) {
            addons = addonRepository.findByCategory(category);
        } else if (enabled != null && enabled) {
            addons = addonRepository.findByEnabledTrue();
        } else {
            addons = addonRepository.findAll();
        }
        return ResponseEntity.ok(addons);
    }

    /**
     * 특정 Add-on 조회
     */
    @GetMapping("/addons/{addonKey}")
    public ResponseEntity<MlAddon> getAddon(@PathVariable String addonKey) {
        return addonRepository.findByAddonKey(addonKey)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Add-on 등록
     */
    @PostMapping("/addons")
    public ResponseEntity<?> createAddon(@Valid @RequestBody MlAddon addon) {
        if (addonRepository.existsByAddonKey(addon.getAddonKey())) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Addon key already exists: " + addon.getAddonKey()));
        }

        MlAddon saved = addonRepository.save(addon);
        log.info("Created new addon: {}", addon.getAddonKey());
        return ResponseEntity.status(HttpStatus.CREATED).body(saved);
    }

    /**
     * Add-on 수정
     */
    @PutMapping("/addons/{addonKey}")
    public ResponseEntity<?> updateAddon(
            @PathVariable String addonKey,
            @RequestBody MlAddon updates
    ) {
        return addonRepository.findByAddonKey(addonKey)
                .map(existing -> {
                    // 수정 가능한 필드만 업데이트
                    if (updates.getName() != null) existing.setName(updates.getName());
                    if (updates.getDescription() != null) existing.setDescription(updates.getDescription());
                    if (updates.getEndpointUrl() != null) existing.setEndpointUrl(updates.getEndpointUrl());
                    if (updates.getTimeoutMs() != null) existing.setTimeoutMs(updates.getTimeoutMs());
                    if (updates.getMaxQps() != null) existing.setMaxQps(updates.getMaxQps());
                    if (updates.getMaxRetries() != null) existing.setMaxRetries(updates.getMaxRetries());
                    if (updates.getEnabled() != null) existing.setEnabled(updates.getEnabled());
                    if (updates.getPriority() != null) existing.setPriority(updates.getPriority());
                    if (updates.getConfig() != null) existing.setConfig(updates.getConfig());
                    if (updates.getDependsOn() != null) existing.setDependsOn(updates.getDependsOn());
                    if (updates.getAuthType() != null) existing.setAuthType(updates.getAuthType());
                    if (updates.getAuthCredentials() != null) existing.setAuthCredentials(updates.getAuthCredentials());
                    if (updates.getHealthCheckUrl() != null) existing.setHealthCheckUrl(updates.getHealthCheckUrl());

                    MlAddon saved = addonRepository.save(existing);
                    log.info("Updated addon: {}", addonKey);
                    return ResponseEntity.ok(saved);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Add-on 활성화/비활성화
     */
    @PostMapping("/addons/{addonKey}/toggle")
    public ResponseEntity<?> toggleAddon(@PathVariable String addonKey) {
        return addonRepository.findByAddonKey(addonKey)
                .map(addon -> {
                    addon.setEnabled(!addon.getEnabled());
                    MlAddon saved = addonRepository.save(addon);
                    log.info("Toggled addon {}: enabled={}", addonKey, saved.getEnabled());
                    return ResponseEntity.ok(Map.of(
                            "addonKey", addonKey,
                            "enabled", saved.getEnabled()
                    ));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Add-on 삭제
     */
    @DeleteMapping("/addons/{addonKey}")
    public ResponseEntity<?> deleteAddon(@PathVariable String addonKey) {
        return addonRepository.findByAddonKey(addonKey)
                .map(addon -> {
                    addonRepository.delete(addon);
                    log.info("Deleted addon: {}", addonKey);
                    return ResponseEntity.ok(Map.of("deleted", addonKey));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    // ========== 분석 실행 ==========

    /**
     * 특정 Add-on으로 직접 분석 실행 (커스텀 입력)
     * POST /api/v1/ml/addons/{addonKey}/analyze
     * 
     * 프론트엔드에서 직접 특정 Add-on을 호출하여 분석을 실행할 때 사용.
     * 기사 ID 없이 커스텀 데이터로 분석 가능.
     */
    @PostMapping("/addons/{addonKey}/analyze")
    public ResponseEntity<?> analyzeWithAddon(
            @PathVariable String addonKey,
            @RequestBody Map<String, Object> request
    ) {
        return addonRepository.findByAddonKey(addonKey)
                .map(addon -> {
                    if (!addon.getEnabled()) {
                        return ResponseEntity.badRequest()
                                .body(Map.of("error", "Addon is disabled: " + addonKey));
                    }
                    
                    try {
                        // 요청에서 article 정보 추출
                        @SuppressWarnings("unchecked")
                        Map<String, Object> articleData = (Map<String, Object>) request.getOrDefault("article", Map.of());
                        
                        String requestId = java.util.UUID.randomUUID().toString();
                        String importance = (String) request.getOrDefault("importance", "batch");
                        
                        // Add-on 직접 호출
                        AddonResponse response = orchestratorService.executeAddonDirect(addon, articleData, requestId, importance);
                        
                        if (response == null) {
                            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                                    .body(Map.of("error", "Addon did not return a response"));
                        }
                        
                        return ResponseEntity.ok(response);
                    } catch (Exception e) {
                        log.error("Failed to execute addon {}: {}", addonKey, e.getMessage(), e);
                        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                                .body(Map.of(
                                        "error", "Addon execution failed",
                                        "message", e.getMessage()
                                ));
                    }
                })
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * 단일 기사 분석 실행
     */
    @PostMapping("/analyze/{articleId}")
    public ResponseEntity<?> analyzeArticle(
            @PathVariable Long articleId,
            @RequestParam(defaultValue = "batch") String importance
    ) {
        try {
            CompletableFuture<String> future = orchestratorService.analyzeArticle(articleId, importance);
            String batchId = future.get();
            return ResponseEntity.accepted().body(Map.of(
                    "status", "accepted",
                    "articleId", articleId,
                    "batchId", batchId
            ));
        } catch (Exception e) {
            log.error("Failed to start analysis for article: {}", articleId, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * 여러 기사 일괄 분석
     */
    @PostMapping("/analyze/batch")
    public ResponseEntity<?> analyzeArticles(
            @RequestBody List<Long> articleIds,
            @RequestParam(defaultValue = "batch") String importance
    ) {
        CompletableFuture<String> future = orchestratorService.analyzeArticles(articleIds, importance);
        return ResponseEntity.accepted().body(Map.of(
                "status", "accepted",
                "articleCount", articleIds.size(),
                "batchId", future.join()
        ));
    }

    /**
     * 특정 카테고리 Add-on만 실행
     */
    @PostMapping("/analyze/{articleId}/category/{category}")
    public ResponseEntity<?> analyzeByCategory(
            @PathVariable Long articleId,
            @PathVariable AddonCategory category
    ) {
        try {
            CompletableFuture<AddonResponse> future = orchestratorService.executeCategory(articleId, category);
            AddonResponse response = future.get();
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("Failed to analyze article {} with category {}", articleId, category, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", e.getMessage()));
        }
    }

    // ========== 실행 이력 ==========

    /**
     * 실행 이력 조회 (status 필터 지원)
     */
    @GetMapping("/executions")
    public ResponseEntity<Page<MlAddonExecution>> listExecutions(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) ExecutionStatus status
    ) {
        PageRequest pageRequest = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
        Page<MlAddonExecution> executions;
        if (status != null) {
            executions = executionRepository.findByStatus(status, pageRequest);
        } else {
            executions = executionRepository.findAll(pageRequest);
        }
        return ResponseEntity.ok(executions);
    }

    /**
     * 특정 기사의 실행 이력
     */
    @GetMapping("/executions/article/{articleId}")
    public ResponseEntity<List<MlAddonExecution>> getArticleExecutions(@PathVariable Long articleId) {
        return ResponseEntity.ok(executionRepository.findByArticleId(articleId));
    }

    // ========== 모니터링 ==========

    /**
     * Add-on 상태 요약
     * 프론트엔드 MlAddonStatusSummary 형식에 맞춰 반환
     */
    @GetMapping("/status")
    public ResponseEntity<?> getStatus() {
        List<MlAddon> allAddons = addonRepository.findAll();
        long enabled = allAddons.stream().filter(MlAddon::getEnabled).count();
        long healthy = allAddons.stream()
                .filter(a -> a.getHealthStatus() == AddonHealthStatus.HEALTHY)
                .count();
        long unhealthy = allAddons.stream()
                .filter(a -> a.getHealthStatus() != AddonHealthStatus.HEALTHY && a.getHealthStatus() != AddonHealthStatus.UNKNOWN)
                .count();

        // 오늘의 실행 통계 계산
        LocalDateTime todayStart = LocalDateTime.now().toLocalDate().atStartOfDay();
        List<MlAddonExecution> todayExecutions = executionRepository.findByCreatedAtAfter(todayStart);
        long totalExecutionsToday = todayExecutions.size();
        long successCount = todayExecutions.stream()
                .filter(e -> e.getStatus() == ExecutionStatus.SUCCESS)
                .count();
        double successRate = totalExecutionsToday > 0 
                ? (double) successCount / totalExecutionsToday * 100 
                : 0.0;
        
        // 평균 지연시간 계산
        double avgLatencyMs = todayExecutions.stream()
                .filter(e -> e.getLatencyMs() != null)
                .mapToLong(MlAddonExecution::getLatencyMs)
                .average()
                .orElse(0.0);
        
        // 카테고리별 addon 수
        Map<String, Long> byCategory = allAddons.stream()
                .collect(java.util.stream.Collectors.groupingBy(
                        a -> a.getCategory().name(),
                        java.util.stream.Collectors.counting()
                ));
        
        return ResponseEntity.ok(Map.of(
                "totalAddons", allAddons.size(),
                "enabledAddons", enabled,
                "healthyAddons", healthy,
                "unhealthyAddons", unhealthy,
                "totalExecutionsToday", totalExecutionsToday,
                "successRate", Math.round(successRate * 100.0) / 100.0,
                "avgLatencyMs", Math.round(avgLatencyMs * 100.0) / 100.0,
                "byCategory", byCategory
        ));
    }

    /**
     * 헬스체크 수동 실행
     */
    @PostMapping("/health-check")
    public ResponseEntity<?> runHealthCheck() {
        orchestratorService.runHealthChecks();
        return ResponseEntity.ok(Map.of("status", "Health check started"));
    }
}
