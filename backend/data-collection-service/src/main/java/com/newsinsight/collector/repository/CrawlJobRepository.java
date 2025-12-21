package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.CrawlJob;
import com.newsinsight.collector.entity.CrawlJobStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface CrawlJobRepository extends JpaRepository<CrawlJob, String> {

    /**
     * Find jobs by status
     */
    Page<CrawlJob> findByStatus(CrawlJobStatus status, Pageable pageable);

    /**
     * Find jobs by topic containing the search term
     */
    Page<CrawlJob> findByTopicContainingIgnoreCase(String topic, Pageable pageable);

    /**
     * Find pending jobs older than a given time (for timeout handling)
     */
    @Query("SELECT j FROM CrawlJob j WHERE j.status IN :statuses AND j.createdAt < :before")
    List<CrawlJob> findByStatusInAndCreatedAtBefore(
            @Param("statuses") List<CrawlJobStatus> statuses,
            @Param("before") LocalDateTime before
    );

    /**
     * Find recent jobs by topic
     */
    @Query("SELECT j FROM CrawlJob j WHERE LOWER(j.topic) = LOWER(:topic) ORDER BY j.createdAt DESC")
    List<CrawlJob> findRecentByTopic(@Param("topic") String topic, Pageable pageable);

    /**
     * Count jobs by status
     */
    long countByStatus(CrawlJobStatus status);

    /**
     * Mark timed out jobs
     */
    @Modifying
    @Query("UPDATE CrawlJob j SET j.status = 'TIMEOUT', j.completedAt = CURRENT_TIMESTAMP " +
            "WHERE j.status IN ('PENDING', 'IN_PROGRESS') AND j.createdAt < :before")
    int markTimedOutJobs(@Param("before") LocalDateTime before);

    /**
     * Delete old completed/failed jobs
     */
    @Modifying
    @Query("DELETE FROM CrawlJob j WHERE j.status IN ('COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED') " +
            "AND j.completedAt < :before")
    int deleteOldJobs(@Param("before") LocalDateTime before);

    /**
     * Find jobs created within a time range
     */
    Page<CrawlJob> findByCreatedAtBetween(LocalDateTime start, LocalDateTime end, Pageable pageable);
}
