package com.newsinsight.collector.controller;

import com.newsinsight.collector.entity.autocrawl.CrawlTarget;
import com.newsinsight.collector.entity.autocrawl.CrawlTargetStatus;
import com.newsinsight.collector.entity.autocrawl.DiscoverySource;
import com.newsinsight.collector.repository.CrawlTargetRepository;
import com.newsinsight.collector.service.autocrawl.AutoCrawlDiscoveryService;
import com.newsinsight.collector.service.autocrawl.CrawlQueueService;
import com.newsinsight.collector.scheduler.AutoCrawlScheduler;
import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 자동 크롤링 관리 REST API.
 * 
 * URL 발견, 큐 관리, 상태 조회, 수동 제어 기능을 제공합니다.
 */
@RestController
@RequestMapping("/api/v1/autocrawl")
@RequiredArgsConstructor
@Slf4j
public class AutoCrawlController {

    private final AutoCrawlDiscoveryService discoveryService;
    private final CrawlQueueService queueService;
    private final CrawlTargetRepository targetRepository;
    private final AutoCrawlScheduler autoCrawlScheduler;

    // ========================================
    // 상태 조회
    // ========================================

    /**
     * 큐 상태 및 통계 조회
     */
    @GetMapping("/status")
    public ResponseEntity<AutoCrawlStatusResponse> getStatus() {
        CrawlQueueService.QueueStats stats = queueService.getQueueStats();
        Map<DiscoverySource, Long> discoveryStats = discoveryService.getDiscoveryStats();
        Map<String, Long> domainStats = queueService.getPendingCountByDomain();

        AutoCrawlStatusResponse response = AutoCrawlStatusResponse.builder()
                .pendingCount(stats.getPendingCount())
                .inProgressCount(stats.getInProgressCount())
                .completedCount(stats.getCompletedCount())
                .failedCount(stats.getFailedCount())
                .skippedCount(stats.getSkippedCount())
                .sessionDispatched(stats.getTotalDispatched())
                .sessionCompleted(stats.getTotalCompleted())
                .sessionFailed(stats.getTotalFailed())
                .discoveryStats(discoveryStats)
                .domainPendingStats(domainStats)
                .domainConcurrency(stats.getDomainConcurrency())
                .build();

        return ResponseEntity.ok(response);
    }

    /**
     * 대기 중인 대상 목록 조회 (페이지네이션)
     */
    @GetMapping("/targets")
    public ResponseEntity<Page<CrawlTargetDto>> getTargets(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) CrawlTargetStatus status,
            @RequestParam(required = false) DiscoverySource source) {

        PageRequest pageRequest = PageRequest.of(page, size, 
                Sort.by(Sort.Direction.DESC, "priority").and(Sort.by(Sort.Direction.ASC, "discoveredAt")));

        Page<CrawlTarget> targets;
        if (status != null) {
            targets = targetRepository.findByStatus(status, pageRequest);
        } else if (source != null) {
            targets = targetRepository.findByDiscoverySource(source, pageRequest);
        } else {
            targets = targetRepository.findAll(pageRequest);
        }

        Page<CrawlTargetDto> dtoPage = targets.map(this::toDto);
        return ResponseEntity.ok(dtoPage);
    }

    /**
     * 단일 대상 조회
     */
    @GetMapping("/targets/{id}")
    public ResponseEntity<CrawlTargetDto> getTarget(@PathVariable Long id) {
        return targetRepository.findById(id)
                .map(this::toDto)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    // ========================================
    // URL 발견 (수동)
    // ========================================

    /**
     * 수동으로 URL 추가
     */
    @PostMapping("/targets")
    public ResponseEntity<CrawlTargetDto> addTarget(@RequestBody AddTargetRequest request) {
        try {
            CrawlTarget target = discoveryService.addManualTarget(
                    request.getUrl(),
                    request.getKeywords(),
                    request.getPriority() != null ? request.getPriority() : 50
            );
            
            if (target == null) {
                return ResponseEntity.badRequest().build();
            }
            
            log.info("Manually added crawl target: url={}, priority={}", request.getUrl(), request.getPriority());
            return ResponseEntity.ok(toDto(target));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * 여러 URL 일괄 추가
     */
    @PostMapping("/targets/batch")
    public ResponseEntity<BatchAddResponse> addTargetsBatch(@RequestBody BatchAddRequest request) {
        List<CrawlTarget> targets = discoveryService.addManualTargets(
                request.getUrls(),
                request.getKeywords(),
                request.getPriority() != null ? request.getPriority() : 50
        );

        BatchAddResponse response = BatchAddResponse.builder()
                .addedCount(targets.size())
                .requestedCount(request.getUrls().size())
                .build();

        log.info("Batch added {} crawl targets", targets.size());
        return ResponseEntity.ok(response);
    }

    /**
     * 검색 결과 URL에서 발견
     */
    @PostMapping("/discover/search")
    public ResponseEntity<DiscoverResponse> discoverFromSearch(@RequestBody DiscoverSearchRequest request) {
        List<CrawlTarget> targets = discoveryService.discoverFromSearchUrls(
                request.getQuery(),
                request.getUrls()
        );

        DiscoverResponse response = DiscoverResponse.builder()
                .discoveredCount(targets.size())
                .source(DiscoverySource.SEARCH)
                .build();

        log.info("Discovered {} targets from search query: '{}'", targets.size(), request.getQuery());
        return ResponseEntity.ok(response);
    }

    // ========================================
    // 큐 제어
    // ========================================

    /**
     * 수동으로 큐 처리 트리거
     */
    @PostMapping("/queue/process")
    public ResponseEntity<ProcessQueueResponse> processQueue(
            @RequestParam(defaultValue = "10") int batchSize) {
        int dispatched = autoCrawlScheduler.triggerQueueProcessing(batchSize);

        ProcessQueueResponse response = ProcessQueueResponse.builder()
                .dispatchedCount(dispatched)
                .batchSize(batchSize)
                .build();

        return ResponseEntity.ok(response);
    }

    /**
     * 특정 대상 즉시 분배
     */
    @PostMapping("/targets/{id}/dispatch")
    public ResponseEntity<Void> dispatchTarget(@PathVariable Long id) {
        boolean success = queueService.dispatchSingle(id);
        if (success) {
            log.info("Manually dispatched target: id={}", id);
            return ResponseEntity.ok().build();
        } else {
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * 특정 키워드 관련 대상 우선순위 부스트
     */
    @PostMapping("/queue/boost")
    public ResponseEntity<BoostResponse> boostKeyword(@RequestBody BoostRequest request) {
        int boosted = queueService.prioritizeKeyword(
                request.getKeyword(),
                request.getBoostAmount() != null ? request.getBoostAmount() : 20
        );

        BoostResponse response = BoostResponse.builder()
                .boostedCount(boosted)
                .keyword(request.getKeyword())
                .build();

        return ResponseEntity.ok(response);
    }

    /**
     * 대상 상태 변경
     */
    @PutMapping("/targets/{id}/status")
    public ResponseEntity<Void> updateTargetStatus(
            @PathVariable Long id,
            @RequestBody UpdateStatusRequest request) {
        boolean success = queueService.updateTargetStatus(id, request.getStatus(), request.getReason());
        if (success) {
            log.info("Updated target status: id={}, newStatus={}", id, request.getStatus());
            return ResponseEntity.ok().build();
        } else {
            return ResponseEntity.notFound().build();
        }
    }

    // ========================================
    // 정리 작업
    // ========================================

    /**
     * 수동으로 정리 트리거
     */
    @PostMapping("/cleanup")
    public ResponseEntity<CleanupResponse> triggerCleanup(
            @RequestParam(defaultValue = "7") int daysOld) {
        int cleaned = queueService.cleanupOldTargets(daysOld);
        int expired = queueService.expireOldPendingTargets(daysOld);

        CleanupResponse response = CleanupResponse.builder()
                .cleanedCount(cleaned)
                .expiredCount(expired)
                .daysOld(daysOld)
                .build();

        log.info("Manual cleanup completed: cleaned={}, expired={}", cleaned, expired);
        return ResponseEntity.ok(response);
    }

    /**
     * 멈춘 작업 복구
     */
    @PostMapping("/queue/recover")
    public ResponseEntity<RecoverResponse> recoverStuck() {
        int recovered = queueService.recoverStuckTargets();

        RecoverResponse response = RecoverResponse.builder()
                .recoveredCount(recovered)
                .build();

        return ResponseEntity.ok(response);
    }

    // ========================================
    // 크롤러 콜백 (autonomous-crawler-service에서 호출)
    // ========================================

    /**
     * 크롤링 완료 콜백
     */
    @PostMapping("/callback")
    public ResponseEntity<Void> handleCrawlerCallback(@RequestBody CrawlerCallbackRequest request) {
        log.debug("Received crawler callback: targetId={}, success={}", 
                request.getTargetId(), request.isSuccess());

        if (request.isSuccess()) {
            queueService.handleCrawlComplete(request.getUrlHash(), request.getCollectedDataId());
        } else {
            queueService.handleCrawlFailed(request.getUrlHash(), request.getError());
        }

        return ResponseEntity.ok().build();
    }

    // ========================================
    // DTO 변환
    // ========================================

    private CrawlTargetDto toDto(CrawlTarget target) {
        return CrawlTargetDto.builder()
                .id(target.getId())
                .url(target.getUrl())
                .urlHash(target.getUrlHash().substring(0, 8) + "...") // 축약
                .discoverySource(target.getDiscoverySource())
                .discoveryContext(target.getDiscoveryContext())
                .priority(target.getPriority())
                .status(target.getStatus())
                .domain(target.getDomain())
                .expectedContentType(target.getExpectedContentType())
                .relatedKeywords(target.getRelatedKeywords())
                .retryCount(target.getRetryCount())
                .maxRetries(target.getMaxRetries())
                .lastError(target.getLastError())
                .discoveredAt(target.getDiscoveredAt() != null ? target.getDiscoveredAt().toString() : null)
                .lastAttemptAt(target.getLastAttemptAt() != null ? target.getLastAttemptAt().toString() : null)
                .completedAt(target.getCompletedAt() != null ? target.getCompletedAt().toString() : null)
                .collectedDataId(target.getCollectedDataId())
                .build();
    }

    // ========================================
    // Request/Response DTOs
    // ========================================

    @Data
    @Builder
    public static class AutoCrawlStatusResponse {
        private long pendingCount;
        private long inProgressCount;
        private long completedCount;
        private long failedCount;
        private long skippedCount;
        private int sessionDispatched;
        private int sessionCompleted;
        private int sessionFailed;
        private Map<DiscoverySource, Long> discoveryStats;
        private Map<String, Long> domainPendingStats;
        private Map<String, Integer> domainConcurrency;
    }

    @Data
    @Builder
    public static class CrawlTargetDto {
        private Long id;
        private String url;
        private String urlHash;
        private DiscoverySource discoverySource;
        private String discoveryContext;
        private Integer priority;
        private CrawlTargetStatus status;
        private String domain;
        private com.newsinsight.collector.entity.autocrawl.ContentType expectedContentType;
        private String relatedKeywords;
        private Integer retryCount;
        private Integer maxRetries;
        private String lastError;
        private String discoveredAt;
        private String lastAttemptAt;
        private String completedAt;
        private Long collectedDataId;
    }

    @Data
    public static class AddTargetRequest {
        private String url;
        private String keywords;
        private Integer priority;
    }

    @Data
    public static class BatchAddRequest {
        private List<String> urls;
        private String keywords;
        private Integer priority;
    }

    @Data
    @Builder
    public static class BatchAddResponse {
        private int addedCount;
        private int requestedCount;
    }

    @Data
    public static class DiscoverSearchRequest {
        private String query;
        private List<String> urls;
    }

    @Data
    @Builder
    public static class DiscoverResponse {
        private int discoveredCount;
        private DiscoverySource source;
    }

    @Data
    @Builder
    public static class ProcessQueueResponse {
        private int dispatchedCount;
        private int batchSize;
    }

    @Data
    public static class BoostRequest {
        private String keyword;
        private Integer boostAmount;
    }

    @Data
    @Builder
    public static class BoostResponse {
        private int boostedCount;
        private String keyword;
    }

    @Data
    public static class UpdateStatusRequest {
        private CrawlTargetStatus status;
        private String reason;
    }

    @Data
    @Builder
    public static class CleanupResponse {
        private int cleanedCount;
        private int expiredCount;
        private int daysOld;
    }

    @Data
    @Builder
    public static class RecoverResponse {
        private int recoveredCount;
    }

    @Data
    public static class CrawlerCallbackRequest {
        private Long targetId;
        private String urlHash;
        private boolean success;
        private Long collectedDataId;
        private String error;
    }
}
