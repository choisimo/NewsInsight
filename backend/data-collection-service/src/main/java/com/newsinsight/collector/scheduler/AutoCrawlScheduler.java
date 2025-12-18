package com.newsinsight.collector.scheduler;

import com.newsinsight.collector.entity.autocrawl.DiscoverySource;
import com.newsinsight.collector.service.autocrawl.AutoCrawlDiscoveryService;
import com.newsinsight.collector.service.autocrawl.CrawlQueueService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * 자동 크롤링 스케줄러.
 * 
 * 크롤링 큐를 주기적으로 처리하고, URL 발견/정리 작업을 자동화합니다.
 * 백그라운드에서 지속적으로 실행되어 실시간 크롤링을 지원합니다.
 */
@Component
@RequiredArgsConstructor
@Slf4j
@ConditionalOnProperty(name = "autocrawl.enabled", havingValue = "true", matchIfMissing = false)
public class AutoCrawlScheduler {

    private final CrawlQueueService crawlQueueService;
    private final AutoCrawlDiscoveryService autoCrawlDiscoveryService;

    @Value("${autocrawl.batch-size:10}")
    private int batchSize;

    @Value("${autocrawl.cleanup-days:7}")
    private int cleanupDays;

    @Value("${autocrawl.expire-pending-days:7}")
    private int expirePendingDays;

    // ========================================
    // 크롤링 큐 처리
    // ========================================

    /**
     * 크롤링 큐 처리 (30초마다)
     * 대기 중인 대상을 우선순위에 따라 크롤러로 분배
     */
    @Scheduled(fixedDelayString = "${autocrawl.queue-interval-ms:30000}")
    public void processQueue() {
        try {
            int dispatched = crawlQueueService.processQueue(batchSize);
            if (dispatched > 0) {
                log.info("[AutoCrawl] Dispatched {} targets for crawling", dispatched);
            }
        } catch (Exception e) {
            log.error("[AutoCrawl] Error processing queue: {}", e.getMessage(), e);
        }
    }

    /**
     * 멈춘 작업 복구 (5분마다)
     * IN_PROGRESS 상태로 오래 방치된 대상을 PENDING으로 복구
     */
    @Scheduled(fixedDelayString = "${autocrawl.recovery-interval-ms:300000}")
    public void recoverStuckTargets() {
        try {
            int recovered = crawlQueueService.recoverStuckTargets();
            if (recovered > 0) {
                log.warn("[AutoCrawl] Recovered {} stuck targets", recovered);
            }
        } catch (Exception e) {
            log.error("[AutoCrawl] Error recovering stuck targets: {}", e.getMessage(), e);
        }
    }

    // ========================================
    // 정리 작업
    // ========================================

    /**
     * 오래된 완료/실패 대상 정리 (매일 새벽 3시)
     */
    @Scheduled(cron = "${autocrawl.cleanup-cron:0 0 3 * * *}")
    public void cleanupOldTargets() {
        try {
            log.info("[AutoCrawl] Starting daily cleanup...");
            
            // 완료/실패 대상 정리
            int cleaned = crawlQueueService.cleanupOldTargets(cleanupDays);
            
            // 오래 대기 중인 대상 만료
            int expired = crawlQueueService.expireOldPendingTargets(expirePendingDays);
            
            log.info("[AutoCrawl] Daily cleanup complete: cleaned={}, expired={}", cleaned, expired);
        } catch (Exception e) {
            log.error("[AutoCrawl] Error during cleanup: {}", e.getMessage(), e);
        }
    }

    // ========================================
    // 통계 로깅
    // ========================================

    /**
     * 큐 상태 로깅 (10분마다)
     */
    @Scheduled(fixedDelayString = "${autocrawl.stats-interval-ms:600000}")
    public void logQueueStats() {
        try {
            CrawlQueueService.QueueStats stats = crawlQueueService.getQueueStats();
            
            log.info("[AutoCrawl Stats] pending={}, inProgress={}, completed={}, failed={}, " +
                     "sessionDispatched={}, sessionCompleted={}, sessionFailed={}",
                    stats.getPendingCount(),
                    stats.getInProgressCount(),
                    stats.getCompletedCount(),
                    stats.getFailedCount(),
                    stats.getTotalDispatched(),
                    stats.getTotalCompleted(),
                    stats.getTotalFailed());
            
            // 발견 출처별 통계
            Map<DiscoverySource, Long> discoveryStats = autoCrawlDiscoveryService.getDiscoveryStats();
            if (!discoveryStats.isEmpty()) {
                log.info("[AutoCrawl Stats] Discovery sources (last 7 days): {}", discoveryStats);
            }
            
        } catch (Exception e) {
            log.error("[AutoCrawl] Error logging stats: {}", e.getMessage(), e);
        }
    }

    // ========================================
    // 수동 제어용 메서드
    // ========================================

    /**
     * 수동으로 큐 처리 트리거
     */
    public int triggerQueueProcessing(int customBatchSize) {
        log.info("[AutoCrawl] Manual queue processing triggered with batch size: {}", customBatchSize);
        return crawlQueueService.processQueue(customBatchSize);
    }

    /**
     * 수동으로 정리 트리거
     */
    public void triggerCleanup() {
        log.info("[AutoCrawl] Manual cleanup triggered");
        cleanupOldTargets();
    }
}
