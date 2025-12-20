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
import java.util.List;
import java.util.Map;

/**
 * Entity for project notifications.
 * Manages alerts for project events like new articles, trend spikes, etc.
 */
@Entity
@Table(name = "project_notifications", indexes = {
        @Index(name = "idx_pn_project_id", columnList = "project_id"),
        @Index(name = "idx_pn_type", columnList = "notification_type"),
        @Index(name = "idx_pn_priority", columnList = "priority"),
        @Index(name = "idx_pn_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProjectNotification {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Project ID
     */
    @Column(name = "project_id", nullable = false)
    private Long projectId;

    /**
     * Notification type
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "notification_type", nullable = false, length = 64)
    private NotificationType notificationType;

    /**
     * Priority level
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "priority", length = 32)
    @Builder.Default
    private NotificationPriority priority = NotificationPriority.MEDIUM;

    /**
     * Notification title
     */
    @Column(name = "title", nullable = false, length = 255)
    private String title;

    /**
     * Notification message
     */
    @Column(name = "message", length = 2048)
    private String message;

    /**
     * Action URL (click to navigate)
     */
    @Column(name = "action_url", length = 1024)
    private String actionUrl;

    /**
     * Action button label
     */
    @Column(name = "action_label", length = 64)
    private String actionLabel;

    /**
     * Recipients (user IDs)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "recipients", columnDefinition = "jsonb")
    private List<String> recipients;

    /**
     * Delivery channels
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "channels", columnDefinition = "jsonb")
    private List<String> channels;

    /**
     * Users who have read this notification
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "read_by", columnDefinition = "jsonb")
    private List<String> readBy;

    /**
     * Delivery status per channel
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "delivery_status", columnDefinition = "jsonb")
    private Map<String, Object> deliveryStatus;

    /**
     * Additional data
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * Whether notification has been dismissed by all
     */
    @Column(name = "dismissed")
    @Builder.Default
    private Boolean dismissed = false;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "sent_at")
    private LocalDateTime sentAt;

    @Column(name = "expires_at")
    private LocalDateTime expiresAt;

    // ============ Enums ============

    public enum NotificationType {
        /** New articles collected */
        NEW_ARTICLES,
        /** Significant trend change */
        TREND_SPIKE,
        /** Important news alert */
        IMPORTANT_UPDATE,
        /** Team member activity */
        MEMBER_ACTIVITY,
        /** Report ready for download */
        REPORT_READY,
        /** Collection completed */
        COLLECTION_COMPLETE,
        /** Collection failed */
        COLLECTION_FAILED,
        /** System notification */
        SYSTEM_ALERT,
        /** Weekly/monthly digest */
        DIGEST,
        /** Keyword match alert */
        KEYWORD_MATCH
    }

    public enum NotificationPriority {
        LOW,
        MEDIUM,
        HIGH,
        URGENT
    }

    public static class Channel {
        public static final String IN_APP = "in_app";
        public static final String EMAIL = "email";
        public static final String SLACK = "slack";
        public static final String WEBHOOK = "webhook";
        public static final String PUSH = "push";
    }

    // ============ Helper methods ============

    /**
     * Mark as read by user
     */
    public void markReadBy(String userId) {
        if (readBy == null) {
            readBy = new java.util.ArrayList<>();
        }
        if (!readBy.contains(userId)) {
            readBy.add(userId);
        }
    }

    /**
     * Check if read by user
     */
    public boolean isReadBy(String userId) {
        return readBy != null && readBy.contains(userId);
    }

    /**
     * Check if expired
     */
    public boolean isExpired() {
        return expiresAt != null && LocalDateTime.now().isAfter(expiresAt);
    }

    /**
     * Mark as sent
     */
    public void markSent() {
        this.sentAt = LocalDateTime.now();
    }

    // ============ Static factory methods ============

    public static ProjectNotification newArticles(Long projectId, int count, List<String> recipients) {
        return ProjectNotification.builder()
                .projectId(projectId)
                .notificationType(NotificationType.NEW_ARTICLES)
                .priority(NotificationPriority.MEDIUM)
                .title("새로운 기사 수집")
                .message(count + "개의 새로운 기사가 수집되었습니다")
                .recipients(recipients)
                .channels(List.of(Channel.IN_APP))
                .actionLabel("보기")
                .metadata(Map.of("articleCount", count))
                .build();
    }

    public static ProjectNotification trendSpike(Long projectId, String keyword, double changePercent, List<String> recipients) {
        return ProjectNotification.builder()
                .projectId(projectId)
                .notificationType(NotificationType.TREND_SPIKE)
                .priority(NotificationPriority.HIGH)
                .title("트렌드 급등 감지")
                .message("'" + keyword + "' 키워드가 " + String.format("%.1f", changePercent) + "% 증가했습니다")
                .recipients(recipients)
                .channels(List.of(Channel.IN_APP, Channel.EMAIL))
                .actionLabel("분석 보기")
                .metadata(Map.of("keyword", keyword, "changePercent", changePercent))
                .build();
    }

    public static ProjectNotification reportReady(Long projectId, Long reportId, String reportTitle, List<String> recipients) {
        return ProjectNotification.builder()
                .projectId(projectId)
                .notificationType(NotificationType.REPORT_READY)
                .priority(NotificationPriority.MEDIUM)
                .title("보고서 생성 완료")
                .message("'" + reportTitle + "' 보고서가 준비되었습니다")
                .recipients(recipients)
                .channels(List.of(Channel.IN_APP))
                .actionLabel("다운로드")
                .actionUrl("/reports/" + reportId)
                .metadata(Map.of("reportId", reportId, "reportTitle", reportTitle))
                .build();
    }
}
