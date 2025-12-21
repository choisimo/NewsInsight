package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.project.ProjectActivityLog;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Repository for ProjectActivityLog entity.
 */
@Repository
public interface ProjectActivityLogRepository extends JpaRepository<ProjectActivityLog, Long> {

    /**
     * Find by project ID
     */
    Page<ProjectActivityLog> findByProjectIdOrderByCreatedAtDesc(Long projectId, Pageable pageable);

    /**
     * Find by project ID and activity type
     */
    Page<ProjectActivityLog> findByProjectIdAndActivityType(
            Long projectId,
            ProjectActivityLog.ActivityType activityType,
            Pageable pageable
    );

    /**
     * Find by user ID
     */
    Page<ProjectActivityLog> findByUserIdOrderByCreatedAtDesc(String userId, Pageable pageable);

    /**
     * Find by project and user
     */
    Page<ProjectActivityLog> findByProjectIdAndUserId(Long projectId, String userId, Pageable pageable);

    /**
     * Find recent activities for project
     */
    List<ProjectActivityLog> findTop20ByProjectIdOrderByCreatedAtDesc(Long projectId);

    /**
     * Find activities within date range
     */
    Page<ProjectActivityLog> findByProjectIdAndCreatedAtBetween(
            Long projectId,
            LocalDateTime from,
            LocalDateTime to,
            Pageable pageable
    );

    /**
     * Find by entity
     */
    List<ProjectActivityLog> findByEntityTypeAndEntityIdOrderByCreatedAtDesc(String entityType, String entityId);

    /**
     * Get activity count by type
     */
    @Query("""
            SELECT a.activityType as activityType, COUNT(a) as count
            FROM ProjectActivityLog a
            WHERE a.projectId = :projectId
            AND a.createdAt > :after
            GROUP BY a.activityType
            """)
    List<ActivityTypeCount> getActivityCountByType(@Param("projectId") Long projectId, @Param("after") LocalDateTime after);

    /**
     * Get activity count by user
     */
    @Query("""
            SELECT a.userId as userId, COUNT(a) as count
            FROM ProjectActivityLog a
            WHERE a.projectId = :projectId
            AND a.createdAt > :after
            GROUP BY a.userId
            """)
    List<UserActivityCount> getActivityCountByUser(@Param("projectId") Long projectId, @Param("after") LocalDateTime after);

    /**
     * Delete old activities
     */
    @Modifying
    @Query("DELETE FROM ProjectActivityLog a WHERE a.createdAt < :before")
    void deleteOldActivities(@Param("before") LocalDateTime before);

    /**
     * Delete by project
     */
    void deleteByProjectId(Long projectId);

    interface ActivityTypeCount {
        ProjectActivityLog.ActivityType getActivityType();
        Long getCount();
    }

    interface UserActivityCount {
        String getUserId();
        Long getCount();
    }
}
