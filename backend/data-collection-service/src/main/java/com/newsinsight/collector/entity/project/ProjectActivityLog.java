package com.newsinsight.collector.entity.project;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Entity for tracking project activity.
 * Provides audit trail and activity feed for collaborative projects.
 */
@Entity
@Table(name = "project_activity_log", indexes = {
        @Index(name = "idx_pal_project_id", columnList = "project_id"),
        @Index(name = "idx_pal_user_id", columnList = "user_id"),
        @Index(name = "idx_pal_type", columnList = "activity_type"),
        @Index(name = "idx_pal_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProjectActivityLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Project ID
     */
    @Column(name = "project_id", nullable = false)
    private Long projectId;

    /**
     * User who performed the action
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Activity type
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "activity_type", nullable = false, length = 64)
    private ActivityType activityType;

    /**
     * Human-readable description
     */
    @Column(name = "description", length = 1024)
    private String description;

    /**
     * Related entity type (e.g., "item", "member", "search")
     */
    @Column(name = "entity_type", length = 64)
    private String entityType;

    /**
     * Related entity ID
     */
    @Column(name = "entity_id", length = 255)
    private String entityId;

    /**
     * Additional metadata/context
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * Changes made (for updates)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "changes", columnDefinition = "jsonb")
    private Map<String, Object> changes;

    /**
     * IP address for audit
     */
    @Column(name = "ip_address", length = 64)
    private String ipAddress;

    /**
     * User agent for audit
     */
    @Column(name = "user_agent", length = 512)
    private String userAgent;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    // ============ Enums ============

    public enum ActivityType {
        // Project lifecycle
        PROJECT_CREATED,
        PROJECT_UPDATED,
        PROJECT_ARCHIVED,
        PROJECT_DELETED,
        PROJECT_RESTORED,
        PROJECT_STATUS_CHANGED,
        
        // Member management
        MEMBER_ADDED,
        MEMBER_INVITED,
        MEMBER_JOINED,
        MEMBER_ROLE_CHANGED,
        MEMBER_REMOVED,
        MEMBER_LEFT,
        
        // Item management
        ITEM_ADDED,
        ITEM_UPDATED,
        ITEM_DELETED,
        ITEM_BOOKMARKED,
        ITEM_TAGGED,
        
        // Search activities
        SEARCH_EXECUTED,
        SEARCH_SAVED,
        SEARCH_SHARED,
        
        // Report activities
        REPORT_GENERATED,
        REPORT_DOWNLOADED,
        REPORT_SHARED,
        
        // Collection activities
        AUTO_COLLECT_RAN,
        AUTO_COLLECTION,
        MANUAL_COLLECTION,
        ITEMS_COLLECTED,
        COLLECTION_FAILED,
        
        // Settings
        SETTINGS_CHANGED,
        KEYWORDS_UPDATED,
        NOTIFICATIONS_CHANGED,
        
        // Comments
        COMMENT_ADDED,
        COMMENT_EDITED,
        COMMENT_DELETED
    }

    // ============ Static factory methods ============

    public static ProjectActivityLog projectCreated(Long projectId, String userId, String projectName) {
        return ProjectActivityLog.builder()
                .projectId(projectId)
                .userId(userId)
                .activityType(ActivityType.PROJECT_CREATED)
                .description("프로젝트 '" + projectName + "'이(가) 생성되었습니다")
                .build();
    }

    public static ProjectActivityLog memberInvited(Long projectId, String userId, String invitedUserId, String role) {
        return ProjectActivityLog.builder()
                .projectId(projectId)
                .userId(userId)
                .activityType(ActivityType.MEMBER_INVITED)
                .description("새 멤버가 " + role + " 역할로 초대되었습니다")
                .entityType("member")
                .entityId(invitedUserId)
                .metadata(Map.of("invitedUserId", invitedUserId, "role", role))
                .build();
    }

    public static ProjectActivityLog itemAdded(Long projectId, String userId, Long itemId, String itemTitle) {
        return ProjectActivityLog.builder()
                .projectId(projectId)
                .userId(userId)
                .activityType(ActivityType.ITEM_ADDED)
                .description("새 항목이 추가되었습니다: " + itemTitle)
                .entityType("item")
                .entityId(String.valueOf(itemId))
                .build();
    }

    public static ProjectActivityLog searchExecuted(Long projectId, String userId, String query, int resultCount) {
        return ProjectActivityLog.builder()
                .projectId(projectId)
                .userId(userId)
                .activityType(ActivityType.SEARCH_EXECUTED)
                .description("검색 실행: '" + query + "' (" + resultCount + "개 결과)")
                .metadata(Map.of("query", query, "resultCount", resultCount))
                .build();
    }

    public static ProjectActivityLog autoCollectRan(Long projectId, int itemsCollected) {
        return ProjectActivityLog.builder()
                .projectId(projectId)
                .activityType(ActivityType.AUTO_COLLECT_RAN)
                .description("자동 수집 완료: " + itemsCollected + "개 항목 수집")
                .metadata(Map.of("itemsCollected", itemsCollected))
                .build();
    }

    public static ProjectActivityLog reportGenerated(Long projectId, String userId, Long reportId, String reportTitle) {
        return ProjectActivityLog.builder()
                .projectId(projectId)
                .userId(userId)
                .activityType(ActivityType.REPORT_GENERATED)
                .description("보고서 생성: " + reportTitle)
                .entityType("report")
                .entityId(String.valueOf(reportId))
                .build();
    }
}
