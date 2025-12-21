package com.newsinsight.collector.entity.project;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Entity representing a user's project workspace.
 * Projects allow users to organize searches, collect news,
 * and collaborate on specific topics over time.
 */
@Entity
@Table(name = "projects", indexes = {
        @Index(name = "idx_project_owner_id", columnList = "owner_id"),
        @Index(name = "idx_project_status", columnList = "status"),
        @Index(name = "idx_project_category", columnList = "category"),
        @Index(name = "idx_project_created_at", columnList = "created_at"),
        @Index(name = "idx_project_last_activity", columnList = "last_activity_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Project {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Project name
     */
    @Column(name = "name", nullable = false, length = 255)
    private String name;

    /**
     * Project description
     */
    @Column(name = "description", length = 2048)
    private String description;

    /**
     * Keywords for automatic collection
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "keywords", columnDefinition = "jsonb")
    private List<String> keywords;

    /**
     * Project category
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "category", length = 32)
    @Builder.Default
    private ProjectCategory category = ProjectCategory.CUSTOM;

    /**
     * Project status
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 32)
    @Builder.Default
    private ProjectStatus status = ProjectStatus.ACTIVE;

    /**
     * Project visibility
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "visibility", length = 32)
    @Builder.Default
    private ProjectVisibility visibility = ProjectVisibility.PRIVATE;

    /**
     * Project owner ID
     */
    @Column(name = "owner_id", nullable = false, length = 64)
    private String ownerId;

    /**
     * Project color for UI
     */
    @Column(name = "color", length = 16)
    private String color;

    /**
     * Project icon name
     */
    @Column(name = "icon", length = 32)
    private String icon;

    /**
     * Whether this is the default project for the user
     */
    @Column(name = "is_default")
    @Builder.Default
    private Boolean isDefault = false;

    /**
     * Project settings
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "settings", columnDefinition = "jsonb")
    private ProjectSettings settings;

    /**
     * Project statistics (cached)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "stats", columnDefinition = "jsonb")
    private Map<String, Object> stats;

    /**
     * Tags for organization
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "tags", columnDefinition = "jsonb")
    private List<String> tags;

    /**
     * Custom metadata
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @Column(name = "last_activity_at")
    private LocalDateTime lastActivityAt;

    /**
     * When auto-collection last ran
     */
    @Column(name = "last_collected_at")
    private LocalDateTime lastCollectedAt;

    // ============ Enums ============

    public enum ProjectCategory {
        /** Research/Investigation project */
        RESEARCH,
        /** Continuous monitoring project */
        MONITORING,
        /** Fact-checking project */
        FACT_CHECK,
        /** Trend analysis project */
        TREND_ANALYSIS,
        /** Custom/other project */
        CUSTOM
    }

    public enum ProjectStatus {
        /** Active project */
        ACTIVE,
        /** Temporarily paused */
        PAUSED,
        /** Completed project */
        COMPLETED,
        /** Archived project */
        ARCHIVED
    }

    public enum ProjectVisibility {
        /** Only owner can see */
        PRIVATE,
        /** Team members can see */
        TEAM,
        /** Anyone with link can see */
        PUBLIC
    }

    // ============ Embedded classes ============

    /**
     * Project settings configuration
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ProjectSettings {
        /** Enable automatic news collection */
        @Builder.Default
        private Boolean autoCollect = false;
        
        /** Collection interval */
        @Builder.Default
        private String collectInterval = "daily"; // hourly, daily, weekly
        
        /** News sources to collect from */
        private List<String> collectSources;
        
        /** Time window for collection */
        @Builder.Default
        private String timeWindow = "7d";
        
        /** Notification settings */
        private NotificationSettings notifications;
        
        /** AI analysis settings */
        private AiAnalysisSettings aiAnalysis;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class NotificationSettings {
        @Builder.Default
        private Boolean newArticles = true;
        @Builder.Default
        private Boolean importantUpdates = true;
        @Builder.Default
        private Boolean weeklyDigest = false;
        @Builder.Default
        private Boolean emailEnabled = false;
        private String slackWebhook;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AiAnalysisSettings {
        @Builder.Default
        private Boolean enabled = true;
        @Builder.Default
        private Boolean autoSummarize = true;
        @Builder.Default
        private Boolean sentimentTracking = true;
        @Builder.Default
        private Boolean trendDetection = true;
        @Builder.Default
        private Boolean factCheck = false;
    }

    // ============ Helper methods ============

    /**
     * Update last activity timestamp
     */
    public void touchActivity() {
        this.lastActivityAt = LocalDateTime.now();
    }

    /**
     * Check if auto-collection is enabled
     */
    public boolean isAutoCollectEnabled() {
        return settings != null && Boolean.TRUE.equals(settings.getAutoCollect());
    }

    /**
     * Archive the project
     */
    public void archive() {
        this.status = ProjectStatus.ARCHIVED;
    }

    /**
     * Pause the project
     */
    public void pause() {
        this.status = ProjectStatus.PAUSED;
    }

    /**
     * Activate the project
     */
    public void activate() {
        this.status = ProjectStatus.ACTIVE;
    }
}
