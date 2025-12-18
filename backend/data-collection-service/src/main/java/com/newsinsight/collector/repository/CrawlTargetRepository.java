package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.autocrawl.CrawlTarget;
import com.newsinsight.collector.entity.autocrawl.CrawlTargetStatus;
import com.newsinsight.collector.entity.autocrawl.DiscoverySource;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * 자동 크롤링 대상 URL 저장소.
 * 검색, 기사 분석 등에서 발견된 URL의 크롤링 대기열을 관리합니다.
 */
@Repository
public interface CrawlTargetRepository extends JpaRepository<CrawlTarget, Long> {
       

    /**
     * URL 해시로 기존 대상 조회 (중복 체크용)
     */
    Optional<CrawlTarget> findByUrlHash(String urlHash);

    /**
     * URL 해시 존재 여부 (빠른 중복 체크)
     */
    boolean existsByUrlHash(String urlHash);

    /**
     * 상태별 대상 조회
     */
    List<CrawlTarget> findByStatus(CrawlTargetStatus status);

    Page<CrawlTarget> findByStatus(CrawlTargetStatus status, Pageable pageable);

    /**
     * 대기 중인 대상을 우선순위 순으로 조회 (크롤링 큐)
     * 재시도 백오프 시간이 지난 대상만 포함
     */
    @Query("SELECT ct FROM CrawlTarget ct " +
           "WHERE ct.status = :status " +
           "AND (ct.nextAttemptAfter IS NULL OR ct.nextAttemptAfter <= :now) " +
           "ORDER BY ct.priority DESC, ct.discoveredAt ASC")
    List<CrawlTarget> findPendingTargetsOrderByPriority(
            @Param("status") CrawlTargetStatus status,
            @Param("now") LocalDateTime now,
            Pageable pageable);

    /**
     * PENDING 상태의 대상 중 크롤링 가능한 대상 조회 (우선순위 순)
     */
    default List<CrawlTarget> findReadyToCrawl(int limit) {
        return findPendingTargetsOrderByPriority(
                CrawlTargetStatus.PENDING,
                LocalDateTime.now(),
                Pageable.ofSize(limit));
    }

    /**
     * 도메인별 대상 조회
     */
    List<CrawlTarget> findByDomain(String domain);

    /**
     * 발견 출처별 대상 조회
     */
    List<CrawlTarget> findByDiscoverySource(DiscoverySource source);

    Page<CrawlTarget> findByDiscoverySource(DiscoverySource source, Pageable pageable);

    /**
     * 특정 기간 내 발견된 대상 조회
     */
    List<CrawlTarget> findByDiscoveredAtAfter(LocalDateTime since);

    /**
     * 키워드 관련 대상 조회 (LIKE 검색)
     */
    @Query("SELECT ct FROM CrawlTarget ct WHERE ct.relatedKeywords LIKE %:keyword%")
    List<CrawlTarget> findByRelatedKeywordsContaining(@Param("keyword") String keyword);

    /**
     * 상태별 카운트
     */
    long countByStatus(CrawlTargetStatus status);

    /**
     * 발견 출처별 카운트
     */
    long countByDiscoverySource(DiscoverySource source);

    /**
     * 오래된 완료/실패 대상 정리
     */
    @Modifying
    @Query("DELETE FROM CrawlTarget ct WHERE ct.status IN :statuses AND ct.updatedAt < :before")
    int deleteOldTargets(@Param("statuses") List<CrawlTargetStatus> statuses, 
                         @Param("before") LocalDateTime before);

    /**
     * 오래 대기 중인 대상 정리 (7일 이상 PENDING인 경우)
     */
    @Modifying
    @Query("UPDATE CrawlTarget ct SET ct.status = 'EXPIRED' " +
           "WHERE ct.status = 'PENDING' AND ct.discoveredAt < :before")
    int expireOldPendingTargets(@Param("before") LocalDateTime before);

    /**
     * IN_PROGRESS 상태로 오래 멈춘 대상 복구 (타임아웃)
     */
    @Modifying
    @Query("UPDATE CrawlTarget ct SET ct.status = 'PENDING', ct.retryCount = ct.retryCount + 1 " +
           "WHERE ct.status = 'IN_PROGRESS' AND ct.lastAttemptAt < :timeout")
    int recoverStuckTargets(@Param("timeout") LocalDateTime timeout);

    /**
     * 도메인별 대기 중 대상 수 (도메인별 rate limiting용)
     */
    @Query("SELECT ct.domain, COUNT(ct) FROM CrawlTarget ct " +
           "WHERE ct.status = 'PENDING' GROUP BY ct.domain ORDER BY COUNT(ct) DESC")
    List<Object[]> countPendingByDomain();

    /**
     * 최근 N일간 발견된 대상 통계
     */
    @Query("SELECT ct.discoverySource, COUNT(ct) FROM CrawlTarget ct " +
           "WHERE ct.discoveredAt > :since GROUP BY ct.discoverySource")
    List<Object[]> getDiscoveryStatsSince(@Param("since") LocalDateTime since);

    /**
     * 최근 N일간 완료된 대상 통계
     */
    @Query("SELECT DATE(ct.completedAt), COUNT(ct) FROM CrawlTarget ct " +
           "WHERE ct.status = 'COMPLETED' AND ct.completedAt > :since " +
           "GROUP BY DATE(ct.completedAt) ORDER BY DATE(ct.completedAt)")
    List<Object[]> getCompletedStatsByDateSince(@Param("since") LocalDateTime since);
}
