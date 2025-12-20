package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.browser.BrowserJobHistory;
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
 * Repository for BrowserJobHistory entity.
 * Manages browser automation job history persistence.
 */
@Repository
public interface BrowserJobHistoryRepository extends JpaRepository<BrowserJobHistory, Long> {

    /**
     * Find by job ID
     */
    Optional<BrowserJobHistory> findByJobId(String jobId);

    /**
     * Find by user ID
     */
    Page<BrowserJobHistory> findByUserIdOrderByCreatedAtDesc(String userId, Pageable pageable);

    /**
     * Find by session ID
     */
    Page<BrowserJobHistory> findBySessionIdOrderByCreatedAtDesc(String sessionId, Pageable pageable);

    /**
     * Find by status
     */
    Page<BrowserJobHistory> findByStatus(BrowserJobHistory.BrowserJobStatus status, Pageable pageable);

    /**
     * Find by user and status
     */
    Page<BrowserJobHistory> findByUserIdAndStatus(
            String userId,
            BrowserJobHistory.BrowserJobStatus status,
            Pageable pageable
    );

    /**
     * Find active jobs (PENDING, RUNNING, WAITING_HUMAN)
     */
    @Query("""
            SELECT b FROM BrowserJobHistory b 
            WHERE b.status IN ('PENDING', 'RUNNING', 'WAITING_HUMAN')
            ORDER BY b.createdAt DESC
            """)
    List<BrowserJobHistory> findActiveJobs();

    /**
     * Find active jobs by user
     */
    @Query("""
            SELECT b FROM BrowserJobHistory b 
            WHERE b.userId = :userId 
            AND b.status IN ('PENDING', 'RUNNING', 'WAITING_HUMAN')
            ORDER BY b.createdAt DESC
            """)
    List<BrowserJobHistory> findActiveJobsByUser(@Param("userId") String userId);

    /**
     * Find by project ID
     */
    Page<BrowserJobHistory> findByProjectIdOrderByCreatedAtDesc(Long projectId, Pageable pageable);

    /**
     * Find by related search history ID
     */
    List<BrowserJobHistory> findBySearchHistoryIdOrderByCreatedAtDesc(Long searchHistoryId);

    /**
     * Update job status
     */
    @Modifying
    @Query("""
            UPDATE BrowserJobHistory b 
            SET b.status = :status, b.updatedAt = :updatedAt 
            WHERE b.jobId = :jobId
            """)
    void updateStatus(
            @Param("jobId") String jobId,
            @Param("status") BrowserJobHistory.BrowserJobStatus status,
            @Param("updatedAt") LocalDateTime updatedAt
    );

    /**
     * Count jobs by status
     */
    long countByStatus(BrowserJobHistory.BrowserJobStatus status);

    /**
     * Count jobs by user and status
     */
    long countByUserIdAndStatus(String userId, BrowserJobHistory.BrowserJobStatus status);

    /**
     * Find jobs completed within time range
     */
    Page<BrowserJobHistory> findByStatusAndCompletedAtAfter(
            BrowserJobHistory.BrowserJobStatus status,
            LocalDateTime after,
            Pageable pageable
    );

    /**
     * Delete old completed jobs (cleanup)
     */
    @Modifying
    @Query("""
            DELETE FROM BrowserJobHistory b 
            WHERE b.status IN ('COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT') 
            AND b.completedAt < :before
            """)
    void deleteOldCompletedJobs(@Param("before") LocalDateTime before);

    /**
     * Get statistics by status
     */
    @Query("""
            SELECT b.status as status, COUNT(b) as count, AVG(b.durationMs) as avgDuration
            FROM BrowserJobHistory b
            WHERE b.createdAt > :after
            GROUP BY b.status
            """)
    List<BrowserJobStats> getStatsByStatus(@Param("after") LocalDateTime after);

    interface BrowserJobStats {
        BrowserJobHistory.BrowserJobStatus getStatus();
        Long getCount();
        Double getAvgDuration();
    }
}
