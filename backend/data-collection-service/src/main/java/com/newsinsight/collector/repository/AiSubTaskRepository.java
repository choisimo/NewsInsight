package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.ai.AiProvider;
import com.newsinsight.collector.entity.ai.AiSubTask;
import com.newsinsight.collector.entity.ai.AiTaskStatus;
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
public interface AiSubTaskRepository extends JpaRepository<AiSubTask, String> {

    /**
     * Find all sub-tasks for a job
     */
    List<AiSubTask> findByAiJobId(String jobId);

    /**
     * Find sub-tasks by job ID and status
     */
    List<AiSubTask> findByAiJobIdAndStatus(String jobId, AiTaskStatus status);

    /**
     * Find sub-tasks by provider
     */
    List<AiSubTask> findByProviderId(AiProvider providerId);

    /**
     * Find sub-tasks by status
     */
    Page<AiSubTask> findByStatus(AiTaskStatus status, Pageable pageable);

    /**
     * Find sub-task by job ID and provider ID
     */
    Optional<AiSubTask> findByAiJobIdAndProviderId(String jobId, AiProvider providerId);

    /**
     * Count sub-tasks by job ID and status
     */
    long countByAiJobIdAndStatus(String jobId, AiTaskStatus status);

    /**
     * Count sub-tasks by job ID
     */
    long countByAiJobId(String jobId);

    /**
     * Get status distribution for a job
     */
    @Query("SELECT t.status, COUNT(t) FROM AiSubTask t WHERE t.aiJob.id = :jobId GROUP BY t.status")
    List<Object[]> getStatusDistributionByJobId(@Param("jobId") String jobId);

    /**
     * Find pending tasks older than cutoff (for timeout)
     */
    @Query("SELECT t FROM AiSubTask t WHERE t.status IN ('PENDING', 'IN_PROGRESS') AND t.createdAt < :before")
    List<AiSubTask> findPendingTasksOlderThan(@Param("before") LocalDateTime before);

    /**
     * Mark timed out sub-tasks
     */
    @Modifying
    @Query("UPDATE AiSubTask t SET t.status = 'TIMEOUT', t.completedAt = CURRENT_TIMESTAMP " +
            "WHERE t.status IN ('PENDING', 'IN_PROGRESS') AND t.createdAt < :before")
    int markTimedOutTasks(@Param("before") LocalDateTime before);

    /**
     * Delete sub-tasks by job IDs
     */
    @Modifying
    @Query("DELETE FROM AiSubTask t WHERE t.aiJob.id IN :jobIds")
    int deleteByJobIds(@Param("jobIds") List<String> jobIds);

    /**
     * Check if all sub-tasks for a job are in terminal state
     */
    @Query("SELECT COUNT(t) = 0 FROM AiSubTask t WHERE t.aiJob.id = :jobId AND t.status IN ('PENDING', 'IN_PROGRESS')")
    boolean areAllTasksTerminal(@Param("jobId") String jobId);

    /**
     * Check if any sub-task for a job completed successfully
     */
    @Query("SELECT COUNT(t) > 0 FROM AiSubTask t WHERE t.aiJob.id = :jobId AND t.status = 'COMPLETED'")
    boolean hasCompletedTask(@Param("jobId") String jobId);

    /**
     * Check if all sub-tasks for a job completed successfully
     */
    @Query("SELECT COUNT(t) = (SELECT COUNT(t2) FROM AiSubTask t2 WHERE t2.aiJob.id = :jobId) " +
            "FROM AiSubTask t WHERE t.aiJob.id = :jobId AND t.status = 'COMPLETED'")
    boolean areAllTasksCompleted(@Param("jobId") String jobId);
}
