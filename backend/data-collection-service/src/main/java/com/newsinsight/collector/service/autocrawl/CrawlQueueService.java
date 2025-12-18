package com.newsinsight.collector.service.autocrawl;

import com.newsinsight.collector.dto.BrowserTaskMessage;
import com.newsinsight.collector.entity.BrowserAgentPolicy;
import com.newsinsight.collector.entity.autocrawl.CrawlTarget;
import com.newsinsight.collector.entity.autocrawl.CrawlTargetStatus;
import com.newsinsight.collector.entity.autocrawl.ContentType;
import com.newsinsight.collector.repository.CrawlTargetRepository;
import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

/**
 * 크롤링 큐 관리 서비스.
 * 
 * CrawlTarget을 우선순위에 따라 관리하고 autonomous-crawler-service로 작업을 분배합니다.
 * 도메인별 rate limiting, 동시성 제어, 실패 처리를 담당합니다.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class CrawlQueueService {

    private final CrawlTargetRepository crawlTargetRepository;
    private final KafkaTemplate<String, BrowserTaskMessage> browserTaskKafkaTemplate;

    @Value("${collector.crawl.topic.browser-task:newsinsight.crawl.browser.tasks}")
    private String browserTaskTopic;

    @Value("${collector.browser-agent.callback-base-url:http://localhost:8081}")
    private String browserAgentCallbackBaseUrl;

    @Value("${collector.browser-agent.callback-token:}")
    private String browserAgentCallbackToken;

    @Value("${autocrawl.max-concurrent-per-domain:3}")
    private int maxConcurrentPerDomain;

    @Value("${autocrawl.batch-size:10}")
    private int defaultBatchSize;

    @Value("${autocrawl.stuck-timeout-minutes:30}")
    private int stuckTimeoutMinutes;

    /**
     * 도메인별 진행 중인 크롤링 수 추적
     */
    private final ConcurrentHashMap<String, AtomicInteger> domainConcurrencyMap = new ConcurrentHashMap<>();

    /**
     * 큐 통계용 카운터
     */
    private final AtomicInteger totalDispatched = new AtomicInteger(0);
    private final AtomicInteger totalCompleted = new AtomicInteger(0);
    private final AtomicInteger totalFailed = new AtomicInteger(0);

    // ========================================
    // 큐 처리 메서드
    // ========================================

    /**
     * 대기 중인 대상을 처리하고 크롤러로 분배
     * 
     * @param batchSize 한 번에 처리할 대상 수
     * @return 분배된 대상 수
     */
    @Transactional
    public int processQueue(int batchSize) {
        log.debug("Processing crawl queue with batch size: {}", batchSize);
        
        // 먼저 멈춘 작업 복구
        recoverStuckTargets();
        
        // 대기 중인 대상 조회 (우선순위 순)
        List<CrawlTarget> pendingTargets = crawlTargetRepository.findReadyToCrawl(batchSize);
        
        if (pendingTargets.isEmpty()) {
            log.debug("No pending targets in queue");
            return 0;
        }
        
        int dispatched = 0;
        
        for (CrawlTarget target : pendingTargets) {
            // 도메인별 동시성 체크
            if (!canDispatchForDomain(target.getDomain())) {
                log.debug("Skipping target due to domain concurrency limit: domain={}, url={}",
                        target.getDomain(), target.getUrl());
                continue;
            }
            
            try {
                dispatchTarget(target);
                dispatched++;
            } catch (Exception e) {
                log.error("Failed to dispatch target: id={}, url={}, error={}",
                        target.getId(), target.getUrl(), e.getMessage());
                target.markFailed("Dispatch error: " + e.getMessage());
                crawlTargetRepository.save(target);
            }
        }
        
        log.info("Processed queue: dispatched {} of {} pending targets", dispatched, pendingTargets.size());
        return dispatched;
    }

    /**
     * 기본 배치 사이즈로 큐 처리
     */
    public int processQueue() {
        return processQueue(defaultBatchSize);
    }

    /**
     * 단일 대상 즉시 분배
     */
    @Transactional
    public boolean dispatchSingle(Long targetId) {
        Optional<CrawlTarget> targetOpt = crawlTargetRepository.findById(targetId);
        if (targetOpt.isEmpty()) {
            log.warn("Target not found: id={}", targetId);
            return false;
        }
        
        CrawlTarget target = targetOpt.get();
        if (target.getStatus() != CrawlTargetStatus.PENDING) {
            log.warn("Target is not in PENDING status: id={}, status={}", targetId, target.getStatus());
            return false;
        }
        
        try {
            dispatchTarget(target);
            return true;
        } catch (Exception e) {
            log.error("Failed to dispatch target: id={}", targetId, e);
            return false;
        }
    }

    /**
     * 특정 키워드 관련 대상 우선 처리
     */
    @Transactional
    public int prioritizeKeyword(String keyword, int boostAmount) {
        List<CrawlTarget> targets = crawlTargetRepository.findByRelatedKeywordsContaining(keyword);
        int boosted = 0;
        
        for (CrawlTarget target : targets) {
            if (target.getStatus() == CrawlTargetStatus.PENDING) {
                target.boostPriority(boostAmount);
                crawlTargetRepository.save(target);
                boosted++;
            }
        }
        
        log.info("Boosted priority for {} targets with keyword: '{}'", boosted, keyword);
        return boosted;
    }

    // ========================================
    // 크롤링 결과 처리
    // ========================================

    /**
     * 크롤링 완료 처리
     * autonomous-crawler-service의 콜백에서 호출됨
     */
    @Transactional
    public void handleCrawlComplete(String urlHash, Long collectedDataId) {
        Optional<CrawlTarget> targetOpt = crawlTargetRepository.findByUrlHash(urlHash);
        if (targetOpt.isEmpty()) {
            log.debug("Target not found for completion: urlHash={}", urlHash);
            return;
        }
        
        CrawlTarget target = targetOpt.get();
        target.markCompleted(collectedDataId);
        crawlTargetRepository.save(target);
        
        // 도메인 동시성 카운터 감소
        decrementDomainConcurrency(target.getDomain());
        
        totalCompleted.incrementAndGet();
        log.info("Crawl completed: id={}, url={}, collectedDataId={}",
                target.getId(), target.getUrl(), collectedDataId);
    }

    /**
     * 크롤링 실패 처리
     */
    @Transactional
    public void handleCrawlFailed(String urlHash, String errorMessage) {
        Optional<CrawlTarget> targetOpt = crawlTargetRepository.findByUrlHash(urlHash);
        if (targetOpt.isEmpty()) {
            log.debug("Target not found for failure: urlHash={}", urlHash);
            return;
        }
        
        CrawlTarget target = targetOpt.get();
        target.markFailed(errorMessage);
        crawlTargetRepository.save(target);
        
        // 도메인 동시성 카운터 감소
        decrementDomainConcurrency(target.getDomain());
        
        totalFailed.incrementAndGet();
        log.info("Crawl failed: id={}, url={}, error={}, retryCount={}",
                target.getId(), target.getUrl(), errorMessage, target.getRetryCount());
    }

    /**
     * URL로 완료/실패 처리 (URL 해시 계산 필요)
     */
    @Transactional
    public void handleCrawlCompleteByUrl(String url, Long collectedDataId) {
        String urlHash = computeUrlHash(url);
        handleCrawlComplete(urlHash, collectedDataId);
    }

    @Transactional
    public void handleCrawlFailedByUrl(String url, String errorMessage) {
        String urlHash = computeUrlHash(url);
        handleCrawlFailed(urlHash, errorMessage);
    }

    // ========================================
    // 큐 관리 메서드
    // ========================================

    /**
     * 멈춘 작업 복구 (IN_PROGRESS 상태로 오래 방치된 경우)
     */
    @Transactional
    public int recoverStuckTargets() {
        LocalDateTime timeout = LocalDateTime.now().minusMinutes(stuckTimeoutMinutes);
        int recovered = crawlTargetRepository.recoverStuckTargets(timeout);
        
        if (recovered > 0) {
            log.warn("Recovered {} stuck targets (timeout: {} minutes)", recovered, stuckTimeoutMinutes);
        }
        
        return recovered;
    }

    /**
     * 오래된 완료/실패 대상 정리
     */
    @Transactional
    public int cleanupOldTargets(int daysOld) {
        LocalDateTime cutoff = LocalDateTime.now().minusDays(daysOld);
        int deleted = crawlTargetRepository.deleteOldTargets(
                List.of(CrawlTargetStatus.COMPLETED, CrawlTargetStatus.FAILED, CrawlTargetStatus.SKIPPED),
                cutoff);
        
        log.info("Cleaned up {} old targets (older than {} days)", deleted, daysOld);
        return deleted;
    }

    /**
     * 오래 대기 중인 대상 만료 처리
     */
    @Transactional
    public int expireOldPendingTargets(int daysOld) {
        LocalDateTime cutoff = LocalDateTime.now().minusDays(daysOld);
        int expired = crawlTargetRepository.expireOldPendingTargets(cutoff);
        
        if (expired > 0) {
            log.info("Expired {} old pending targets (older than {} days)", expired, daysOld);
        }
        
        return expired;
    }

    /**
     * 대상 상태 강제 변경 (관리용)
     */
    @Transactional
    public boolean updateTargetStatus(Long targetId, CrawlTargetStatus newStatus, String reason) {
        Optional<CrawlTarget> targetOpt = crawlTargetRepository.findById(targetId);
        if (targetOpt.isEmpty()) {
            return false;
        }
        
        CrawlTarget target = targetOpt.get();
        CrawlTargetStatus oldStatus = target.getStatus();
        
        target.setStatus(newStatus);
        if (reason != null) {
            target.setLastError(reason);
        }
        
        crawlTargetRepository.save(target);
        log.info("Updated target status: id={}, {} -> {}, reason={}",
                targetId, oldStatus, newStatus, reason);
        
        return true;
    }

    // ========================================
    // 통계 조회
    // ========================================

    /**
     * 큐 상태 통계 조회
     */
    public QueueStats getQueueStats() {
        return QueueStats.builder()
                .pendingCount(crawlTargetRepository.countByStatus(CrawlTargetStatus.PENDING))
                .inProgressCount(crawlTargetRepository.countByStatus(CrawlTargetStatus.IN_PROGRESS))
                .completedCount(crawlTargetRepository.countByStatus(CrawlTargetStatus.COMPLETED))
                .failedCount(crawlTargetRepository.countByStatus(CrawlTargetStatus.FAILED))
                .skippedCount(crawlTargetRepository.countByStatus(CrawlTargetStatus.SKIPPED))
                .totalDispatched(totalDispatched.get())
                .totalCompleted(totalCompleted.get())
                .totalFailed(totalFailed.get())
                .domainConcurrency(getDomainConcurrencySnapshot())
                .build();
    }

    /**
     * 도메인별 대기 중 대상 수 조회
     */
    public Map<String, Long> getPendingCountByDomain() {
        List<Object[]> results = crawlTargetRepository.countPendingByDomain();
        return results.stream()
                .limit(20) // 상위 20개만
                .collect(Collectors.toMap(
                        row -> (String) row[0],
                        row -> (Long) row[1],
                        (a, b) -> a,
                        LinkedHashMap::new
                ));
    }

    @Data
    @Builder
    public static class QueueStats {
        private long pendingCount;
        private long inProgressCount;
        private long completedCount;
        private long failedCount;
        private long skippedCount;
        private int totalDispatched;
        private int totalCompleted;
        private int totalFailed;
        private Map<String, Integer> domainConcurrency;
    }

    // ========================================
    // 내부 헬퍼 메서드
    // ========================================

    /**
     * 대상을 크롤러로 분배
     */
    private void dispatchTarget(CrawlTarget target) {
        // 상태 변경
        target.markInProgress();
        crawlTargetRepository.save(target);
        
        // 도메인 동시성 카운터 증가
        incrementDomainConcurrency(target.getDomain());
        
        // 콜백 URL 생성
        String callbackUrl = browserAgentCallbackBaseUrl.endsWith("/")
                ? browserAgentCallbackBaseUrl + "api/v1/autocrawl/callback"
                : browserAgentCallbackBaseUrl + "/api/v1/autocrawl/callback";
        
        // 정책 결정
        BrowserAgentPolicy policy = determineCrawlPolicy(target);
        
        // Kafka 메시지 생성
        BrowserTaskMessage task = BrowserTaskMessage.builder()
                .jobId(target.getId())
                .sourceId(-1L) // 동적 발견 대상은 sourceId가 없음
                .sourceName("AutoCrawl")
                .seedUrl(target.getUrl())
                .maxDepth(1) // 발견된 단일 페이지만 크롤링
                .maxPages(1)
                .budgetSeconds(60)
                .policy(policy.getValue())
                .focusKeywords(target.getRelatedKeywords())
                .captureScreenshots(false)
                .extractStructured(true)
                .callbackUrl(callbackUrl)
                .callbackToken(browserAgentCallbackToken)
                .metadata(Map.of(
                        "targetId", target.getId().toString(),
                        "urlHash", target.getUrlHash(),
                        "discoverySource", target.getDiscoverySource().name(),
                        "priority", target.getPriority().toString()
                ))
                .createdAt(LocalDateTime.now())
                .build();
        
        // Kafka로 발행
        browserTaskKafkaTemplate.send(browserTaskTopic, target.getId().toString(), task);
        
        totalDispatched.incrementAndGet();
        log.info("Dispatched crawl target: id={}, url={}, policy={}, priority={}",
                target.getId(), target.getUrl(), policy, target.getPriority());
    }

    /**
     * 콘텐츠 타입에 따른 크롤링 정책 결정
     */
    private BrowserAgentPolicy determineCrawlPolicy(CrawlTarget target) {
        ContentType contentType = target.getExpectedContentType();
        
        return switch (contentType) {
            case NEWS -> BrowserAgentPolicy.NEWS_ONLY;
            case BLOG, FORUM -> BrowserAgentPolicy.FOCUSED_TOPIC;
            case OFFICIAL, ACADEMIC -> BrowserAgentPolicy.SINGLE_PAGE;
            default -> BrowserAgentPolicy.SINGLE_PAGE;
        };
    }

    /**
     * 도메인별 동시성 체크
     */
    private boolean canDispatchForDomain(String domain) {
        if (domain == null) return true;
        
        AtomicInteger count = domainConcurrencyMap.get(domain);
        if (count == null) return true;
        
        return count.get() < maxConcurrentPerDomain;
    }

    private void incrementDomainConcurrency(String domain) {
        if (domain == null) return;
        domainConcurrencyMap.computeIfAbsent(domain, k -> new AtomicInteger(0))
                .incrementAndGet();
    }

    private void decrementDomainConcurrency(String domain) {
        if (domain == null) return;
        AtomicInteger count = domainConcurrencyMap.get(domain);
        if (count != null) {
            int newValue = count.decrementAndGet();
            if (newValue <= 0) {
                domainConcurrencyMap.remove(domain);
            }
        }
    }

    private Map<String, Integer> getDomainConcurrencySnapshot() {
        return domainConcurrencyMap.entrySet().stream()
                .filter(e -> e.getValue().get() > 0)
                .collect(Collectors.toMap(
                        Map.Entry::getKey,
                        e -> e.getValue().get()
                ));
    }

    /**
     * URL 해시 생성 (AutoCrawlDiscoveryService와 동일)
     */
    private String computeUrlHash(String url) {
        try {
            java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(url.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder hexString = new StringBuilder();
            for (byte b : hash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) hexString.append('0');
                hexString.append(hex);
            }
            return hexString.toString();
        } catch (Exception e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }
}
