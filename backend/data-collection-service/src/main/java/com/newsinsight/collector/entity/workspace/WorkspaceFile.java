package com.newsinsight.collector.entity.workspace;

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
import java.util.Map;
import java.util.UUID;

/**
 * Entity representing a file stored in user's workspace.
 * File metadata is stored in PostgreSQL, actual file content on local disk/S3.
 */
@Entity
@Table(name = "workspace_files", indexes = {
        @Index(name = "idx_workspace_file_session_id", columnList = "session_id"),
        @Index(name = "idx_workspace_file_user_id", columnList = "user_id"),
        @Index(name = "idx_workspace_file_project_id", columnList = "project_id"),
        @Index(name = "idx_workspace_file_file_type", columnList = "file_type"),
        @Index(name = "idx_workspace_file_status", columnList = "status"),
        @Index(name = "idx_workspace_file_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class WorkspaceFile {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Unique file identifier (UUID for secure access)
     */
    @Column(name = "file_uuid", nullable = false, unique = true, length = 36)
    @Builder.Default
    private String fileUuid = UUID.randomUUID().toString();

    /**
     * Session ID for anonymous users
     */
    @Column(name = "session_id", length = 64)
    private String sessionId;

    /**
     * User ID for authenticated users (optional)
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Associated project ID (optional)
     */
    @Column(name = "project_id")
    private Long projectId;

    /**
     * Original file name
     */
    @Column(name = "original_name", nullable = false, length = 512)
    private String originalName;

    /**
     * Stored file name (UUID-based for uniqueness)
     */
    @Column(name = "stored_name", nullable = false, length = 128)
    private String storedName;

    /**
     * File extension (e.g., pdf, xlsx, csv)
     */
    @Column(name = "extension", length = 32)
    private String extension;

    /**
     * MIME type
     */
    @Column(name = "mime_type", length = 128)
    private String mimeType;

    /**
     * File size in bytes
     */
    @Column(name = "file_size", nullable = false)
    private Long fileSize;

    /**
     * File type category
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "file_type", length = 32)
    @Builder.Default
    private FileType fileType = FileType.OTHER;

    /**
     * Storage location type
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "storage_type", length = 32)
    @Builder.Default
    private StorageType storageType = StorageType.LOCAL;

    /**
     * Storage path (relative path for local, key for S3)
     */
    @Column(name = "storage_path", nullable = false, length = 1024)
    private String storagePath;

    /**
     * File status
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 32)
    @Builder.Default
    private FileStatus status = FileStatus.ACTIVE;

    /**
     * File description
     */
    @Column(name = "description", length = 1024)
    private String description;

    /**
     * File checksum (SHA-256)
     */
    @Column(name = "checksum", length = 64)
    private String checksum;

    /**
     * Download count
     */
    @Column(name = "download_count")
    @Builder.Default
    private Integer downloadCount = 0;

    /**
     * Last accessed time
     */
    @Column(name = "last_accessed_at")
    private LocalDateTime lastAccessedAt;

    /**
     * Expiration time (for temporary files)
     */
    @Column(name = "expires_at")
    private LocalDateTime expiresAt;

    /**
     * Additional metadata
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

    // ============ Enums ============

    public enum FileType {
        /** Document files (PDF, DOC, TXT) */
        DOCUMENT,
        /** Spreadsheet files (XLSX, CSV) */
        SPREADSHEET,
        /** Image files (PNG, JPG, GIF) */
        IMAGE,
        /** Data files (JSON, XML) */
        DATA,
        /** Archive files (ZIP, TAR) */
        ARCHIVE,
        /** Report files (generated reports) */
        REPORT,
        /** Other files */
        OTHER
    }

    public enum StorageType {
        /** Local file system storage */
        LOCAL,
        /** AWS S3 storage */
        S3,
        /** Google Cloud Storage */
        GCS
    }

    public enum FileStatus {
        /** File is active and accessible */
        ACTIVE,
        /** File is being uploaded */
        UPLOADING,
        /** File is being processed */
        PROCESSING,
        /** File has been archived */
        ARCHIVED,
        /** File is scheduled for deletion */
        PENDING_DELETE,
        /** File has been deleted */
        DELETED
    }

    // ============ Helper methods ============

    /**
     * Check if file is owned by session
     */
    public boolean isOwnedBySession(String sessionId) {
        return this.sessionId != null && this.sessionId.equals(sessionId);
    }

    /**
     * Check if file is owned by user
     */
    public boolean isOwnedByUser(String userId) {
        return this.userId != null && this.userId.equals(userId);
    }

    /**
     * Check if file is accessible by session or user
     */
    public boolean isAccessibleBy(String sessionId, String userId) {
        if (sessionId != null && isOwnedBySession(sessionId)) {
            return true;
        }
        if (userId != null && isOwnedByUser(userId)) {
            return true;
        }
        return false;
    }

    /**
     * Increment download count
     */
    public void incrementDownloadCount() {
        this.downloadCount = (this.downloadCount == null ? 0 : this.downloadCount) + 1;
        this.lastAccessedAt = LocalDateTime.now();
    }

    /**
     * Mark as deleted
     */
    public void markDeleted() {
        this.status = FileStatus.DELETED;
    }

    /**
     * Check if file is expired
     */
    public boolean isExpired() {
        return this.expiresAt != null && LocalDateTime.now().isAfter(this.expiresAt);
    }

    /**
     * Get human-readable file size
     */
    public String getHumanReadableSize() {
        if (fileSize == null) return "0 B";
        
        long bytes = fileSize;
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return String.format("%.1f KB", bytes / 1024.0);
        if (bytes < 1024 * 1024 * 1024) return String.format("%.1f MB", bytes / (1024.0 * 1024));
        return String.format("%.1f GB", bytes / (1024.0 * 1024 * 1024));
    }

    /**
     * Determine file type from extension
     */
    public static FileType determineFileType(String extension) {
        if (extension == null) return FileType.OTHER;
        
        String ext = extension.toLowerCase();
        return switch (ext) {
            case "pdf", "doc", "docx", "txt", "rtf", "odt" -> FileType.DOCUMENT;
            case "xls", "xlsx", "csv", "ods" -> FileType.SPREADSHEET;
            case "png", "jpg", "jpeg", "gif", "bmp", "svg", "webp" -> FileType.IMAGE;
            case "json", "xml", "yaml", "yml" -> FileType.DATA;
            case "zip", "tar", "gz", "rar", "7z" -> FileType.ARCHIVE;
            default -> FileType.OTHER;
        };
    }
}
