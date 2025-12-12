package com.newsinsight.collector.scheduler;

import com.newsinsight.collector.entity.CollectionJob;
import com.newsinsight.collector.entity.CollectionJob.JobStatus;
import com.newsinsight.collector.repository.CollectionJobRepository;
import com.newsinsight.collector.service.CollectionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 자동 크롤링 스케줄러.
 * 설정된 cron 주기에 따라 활성화된 모든 데이터 소스에 대해 자동으로 수집 작업을 시작합니다.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class CollectionScheduler {

    private final CollectionService collectionService;
    private final CollectionJobRepository collectionJobRepository;

    @Value("${collector.scheduling.enabled:true}")
    private boolean schedulingEnabled;

    @Value("${collector.scheduling.skip-if-running:true}")
    private boolean skipIfRunning;

    /**
     * 정기 수집 스케줄러.
     * 기본값: 매 시 정각 (0 0 * * * ?)
     * 환경변수 COLLECTION_CRON으로 조정 가능.
     */
    @Scheduled(cron = "${collector.scheduling.cron:0 0 * * * ?}")
    public void scheduledCollection() {
        if (!schedulingEnabled) {
            log.debug("Scheduled collection is disabled");
            return;
        }

        // 이미 실행 중인 작업이 있으면 스킵 (중복 실행 방지)
        if (skipIfRunning && hasRunningJobs()) {
            log.info("Skipping scheduled collection: jobs already running");
            return;
        }

        log.info("Starting scheduled collection for all active sources");
        try {
            List<CollectionJob> jobs = collectionService.startCollectionForAllActive();
            log.info("Scheduled collection started {} jobs", jobs.size());
            
            if (jobs.isEmpty()) {
                log.warn("No active data sources found for scheduled collection");
            }
        } catch (Exception e) {
            log.error("Scheduled collection failed: {}", e.getMessage(), e);
        }
    }

    /**
     * 실행 중인 수집 작업이 있는지 확인.
     */
    private boolean hasRunningJobs() {
        long runningCount = collectionJobRepository.countByStatus(JobStatus.RUNNING);
        long pendingCount = collectionJobRepository.countByStatus(JobStatus.PENDING);
        return (runningCount + pendingCount) > 0;
    }
}
