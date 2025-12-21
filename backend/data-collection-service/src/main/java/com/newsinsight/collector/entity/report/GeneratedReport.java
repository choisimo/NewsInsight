package com.newsinsight.collector.entity.report;

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
 * Entity for storing generated reports.
 * Tracks PDF/document generation from search results
 * enabling re-download and sharing features.
 */
@Entity
@Table(name = "generated_reports", indexes = {
        @Index(name = "idx_report_search_history_id", columnList = "search_history_id"),
        @Index(name = "idx_report_user_id", columnList = "user_id"),
        @Index(name = "idx_report_project_id", columnList = "project_id"),
        @Index(name = "idx_report_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class GeneratedReport {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Related search history ID
     */
    @Column(name = "search_history_id")
    private Long searchHistoryId;

    /**
     * Project ID if part of a project
     */
    @Column(name = "project_id")
    private Long projectId;

    /**
     * User who generated the report
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Report title
     */
    @Column(name = "title", length = 512)
    private String title;

    /**
     * Report type (PDF, MARKDOWN, HTML, JSON)
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "report_type", length = 32)
    @Builder.Default
    private ReportType reportType = ReportType.PDF;

    /**
     * Report format/template used
     */
    @Column(name = "template_name", length = 64)
    private String templateName;

    /**
     * File storage path or URL
     */
    @Column(name = "file_path", length = 1024)
    private String filePath;

    /**
     * Public URL for sharing (if enabled)
     */
    @Column(name = "public_url", length = 1024)
    private String publicUrl;

    /**
     * File size in bytes
     */
    @Column(name = "file_size")
    private Long fileSize;

    /**
     * MIME type
     */
    @Column(name = "mime_type", length = 64)
    private String mimeType;

    /**
     * Generation status
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 32)
    @Builder.Default
    private ReportStatus status = ReportStatus.PENDING;

    /**
     * Error message if generation failed
     */
    @Column(name = "error_message", length = 1024)
    private String errorMessage;

    /**
     * Report metadata (sections, charts included, etc.)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * Report configuration/options used
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "config", columnDefinition = "jsonb")
    private Map<String, Object> config;

    /**
     * Number of times downloaded
     */
    @Column(name = "download_count")
    @Builder.Default
    private Integer downloadCount = 0;

    /**
     * Last download time
     */
    @Column(name = "last_downloaded_at")
    private LocalDateTime lastDownloadedAt;

    /**
     * Whether report is shared publicly
     */
    @Column(name = "is_public")
    @Builder.Default
    private Boolean isPublic = false;

    /**
     * Share link expiry time
     */
    @Column(name = "share_expires_at")
    private LocalDateTime shareExpiresAt;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "generated_at")
    private LocalDateTime generatedAt;

    /**
     * Report type enum
     */
    public enum ReportType {
        PDF,
        MARKDOWN,
        HTML,
        JSON,
        DOCX,
        XLSX
    }

    /**
     * Report status enum
     */
    public enum ReportStatus {
        PENDING,
        GENERATING,
        COMPLETED,
        FAILED,
        EXPIRED
    }

    /**
     * Mark report as generated
     */
    public void markGenerated(String filePath, Long fileSize) {
        this.status = ReportStatus.COMPLETED;
        this.filePath = filePath;
        this.fileSize = fileSize;
        this.generatedAt = LocalDateTime.now();
    }

    /**
     * Mark report as failed
     */
    public void markFailed(String errorMessage) {
        this.status = ReportStatus.FAILED;
        this.errorMessage = errorMessage;
    }

    /**
     * Increment download count
     */
    public void incrementDownload() {
        this.downloadCount++;
        this.lastDownloadedAt = LocalDateTime.now();
    }
}
