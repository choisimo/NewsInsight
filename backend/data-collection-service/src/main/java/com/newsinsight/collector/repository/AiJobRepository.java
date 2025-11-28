package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.ai.AiJob;
import com.newsinsight.collector.entity.ai.AiJobStatus;
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

@Repository
public interface AiJobRepository extends JpaRepository<AiJob, String> {

    /**
     * Find jobs by overall status
     */
    Page<AiJob> findByOverallStatus(AiJobStatus status, Pageable pageable);

    /**
     * Find jobs by topic containing the search term
     */
    Page<AiJob> findByTopicContainingIgnoreCase(String topic, Pageable pageable);

    /**
     * Find jobs by status list
     */
    List<AiJob> findByOverallStatusIn(List<AiJobStatus> statuses);

    /**
     * Find jobs by status and created before a given time (for timeout/cleanup)
     */
    @Query("SELECT j FROM AiJob j WHERE j.overallStatus IN :statuses AND j.createdAt < :before")
    List<AiJob> findByStatusInAndCreatedAtBefore(
            @Param("statuses") List<AiJobStatus> statuses,
            @Param("before") LocalDateTime before
    );

    /**
     * Find job with sub-tasks eagerly loaded
     */
    @Query("SELECT j FROM AiJob j LEFT JOIN FETCH j.subTasks WHERE j.id = :jobId")
    Optional<AiJob> findByIdWithSubTasks(@Param("jobId") String jobId);

    /**
     * Find recent jobs by topic
     */
    @Query("SELECT j FROM AiJob j WHERE LOWER(j.topic) = LOWER(:topic) ORDER BY j.createdAt DESC")
    List<AiJob> findRecentByTopic(@Param("topic") String topic, Pageable pageable);

    /**
     * Count jobs by status
     */
    long countByOverallStatus(AiJobStatus status);

    /**
     * Mark timed out jobs (PENDING or IN_PROGRESS older than cutoff)
     */
    @Modifying
    @Query("UPDATE AiJob j SET j.overallStatus = 'TIMEOUT', j.completedAt = CURRENT_TIMESTAMP " +
            "WHERE j.overallStatus IN ('PENDING', 'IN_PROGRESS') AND j.createdAt < :before")
    int markTimedOutJobs(@Param("before") LocalDateTime before);

    /**
     * Delete old completed/failed/cancelled jobs
     */
    @Modifying
    @Query("DELETE FROM AiJob j WHERE j.overallStatus IN ('COMPLETED', 'FAILED', 'PARTIAL_SUCCESS', 'TIMEOUT', 'CANCELLED') " +
            "AND j.completedAt < :before")
    int deleteOldJobs(@Param("before") LocalDateTime before);

    /**
     * Find jobs created within a time range
     */
    Page<AiJob> findByCreatedAtBetween(LocalDateTime start, LocalDateTime end, Pageable pageable);

    /**
     * Get statistics: count by status
     */
    @Query("SELECT j.overallStatus, COUNT(j) FROM AiJob j GROUP BY j.overallStatus")
    List<Object[]> getStatusCounts();

    /**
     * Find active (non-terminal) jobs
     */
    @Query("SELECT j FROM AiJob j WHERE j.overallStatus IN ('PENDING', 'IN_PROGRESS')")
    List<AiJob> findActiveJobs();
}
