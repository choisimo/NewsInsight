package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.project.ProjectNotification;
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
 * Repository for ProjectNotification entity.
 */
@Repository
public interface ProjectNotificationRepository extends JpaRepository<ProjectNotification, Long> {

    /**
     * Find by user ID ordered by created at desc
     */
    Page<ProjectNotification> findByUserIdOrderByCreatedAtDesc(String userId, Pageable pageable);

    /**
     * Find unread notifications by user ID
     */
    List<ProjectNotification> findByUserIdAndIsReadFalseOrderByCreatedAtDesc(String userId);

    /**
     * Mark notification as read
     */
    @Modifying
    @Query("UPDATE ProjectNotification n SET n.isRead = true WHERE n.id = :id")
    void markAsRead(@Param("id") Long id);

    /**
     * Mark all notifications as read for a user
     */
    @Modifying
    @Query("UPDATE ProjectNotification n SET n.isRead = true WHERE n.userId = :userId AND n.isRead = false")
    void markAllAsRead(@Param("userId") String userId);

    /**
     * Find by project ID
     */
    Page<ProjectNotification> findByProjectIdOrderByCreatedAtDesc(Long projectId, Pageable pageable);

    /**
     * Find by notification type
     */
    Page<ProjectNotification> findByProjectIdAndNotificationType(
            Long projectId,
            ProjectNotification.NotificationType notificationType,
            Pageable pageable
    );

    /**
     * Find by priority
     */
    Page<ProjectNotification> findByProjectIdAndPriority(
            Long projectId,
            ProjectNotification.NotificationPriority priority,
            Pageable pageable
    );

    /**
     * Find unread notifications for user
     */
    @Query(value = """
            SELECT * FROM project_notifications 
            WHERE project_id = :projectId 
            AND recipients @> :userIdJson::jsonb
            AND (read_by IS NULL OR NOT read_by @> :userIdJson::jsonb)
            AND (expires_at IS NULL OR expires_at > :now)
            ORDER BY created_at DESC
            """, nativeQuery = true)
    List<ProjectNotification> findUnreadForUser(
            @Param("projectId") Long projectId,
            @Param("userIdJson") String userIdJson,
            @Param("now") LocalDateTime now
    );

    /**
     * Find notifications for user across all projects
     */
    @Query(value = """
            SELECT * FROM project_notifications 
            WHERE recipients @> :userIdJson::jsonb
            AND (expires_at IS NULL OR expires_at > :now)
            ORDER BY created_at DESC
            LIMIT :limit
            """, nativeQuery = true)
    List<ProjectNotification> findForUser(
            @Param("userIdJson") String userIdJson,
            @Param("now") LocalDateTime now,
            @Param("limit") int limit
    );

    /**
     * Find unsent notifications
     */
    @Query("SELECT n FROM ProjectNotification n WHERE n.sentAt IS NULL AND n.dismissed = false ORDER BY n.createdAt")
    List<ProjectNotification> findUnsent(Pageable pageable);

    /**
     * Find expired notifications
     */
    @Query("SELECT n FROM ProjectNotification n WHERE n.expiresAt < :now")
    List<ProjectNotification> findExpired(@Param("now") LocalDateTime now);

    /**
     * Mark as sent
     */
    @Modifying
    @Query("UPDATE ProjectNotification n SET n.sentAt = :sentAt WHERE n.id = :id")
    void markAsSent(@Param("id") Long id, @Param("sentAt") LocalDateTime sentAt);

    /**
     * Dismiss notification
     */
    @Modifying
    @Query("UPDATE ProjectNotification n SET n.dismissed = true WHERE n.id = :id")
    void dismiss(@Param("id") Long id);

    /**
     * Count unread for user in project
     */
    @Query(value = """
            SELECT COUNT(*) FROM project_notifications 
            WHERE project_id = :projectId 
            AND recipients @> :userIdJson::jsonb
            AND (read_by IS NULL OR NOT read_by @> :userIdJson::jsonb)
            AND (expires_at IS NULL OR expires_at > :now)
            """, nativeQuery = true)
    long countUnreadForUser(
            @Param("projectId") Long projectId,
            @Param("userIdJson") String userIdJson,
            @Param("now") LocalDateTime now
    );

    /**
     * Delete old notifications
     */
    @Modifying
    @Query("DELETE FROM ProjectNotification n WHERE n.createdAt < :before")
    void deleteOldNotifications(@Param("before") LocalDateTime before);

    /**
     * Delete expired notifications
     */
    @Modifying
    @Query("DELETE FROM ProjectNotification n WHERE n.expiresAt < :now")
    void deleteExpiredNotifications(@Param("now") LocalDateTime now);

    /**
     * Delete by project
     */
    @Modifying
    @Query("DELETE FROM ProjectNotification n WHERE n.projectId = :projectId")
    void deleteByProjectId(@Param("projectId") Long projectId);
}
