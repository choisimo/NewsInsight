package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.workspace.WorkspaceFile;
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

/**
 * Repository for WorkspaceFile entity.
 */
@Repository
public interface WorkspaceFileRepository extends JpaRepository<WorkspaceFile, Long> {

    /**
     * Find by file UUID
     */
    Optional<WorkspaceFile> findByFileUuid(String fileUuid);

    /**
     * Find by file UUID and active status
     */
    @Query("SELECT f FROM WorkspaceFile f WHERE f.fileUuid = :fileUuid AND f.status = 'ACTIVE'")
    Optional<WorkspaceFile> findActiveByFileUuid(@Param("fileUuid") String fileUuid);

    /**
     * Find files by session ID
     */
    Page<WorkspaceFile> findBySessionIdAndStatusOrderByCreatedAtDesc(
            String sessionId, 
            WorkspaceFile.FileStatus status, 
            Pageable pageable
    );

    /**
     * Find files by user ID
     */
    Page<WorkspaceFile> findByUserIdAndStatusOrderByCreatedAtDesc(
            String userId, 
            WorkspaceFile.FileStatus status, 
            Pageable pageable
    );

    /**
     * Find files by project ID
     */
    Page<WorkspaceFile> findByProjectIdAndStatusOrderByCreatedAtDesc(
            Long projectId, 
            WorkspaceFile.FileStatus status, 
            Pageable pageable
    );

    /**
     * Find files by session ID and file type
     */
    Page<WorkspaceFile> findBySessionIdAndFileTypeAndStatus(
            String sessionId,
            WorkspaceFile.FileType fileType,
            WorkspaceFile.FileStatus status,
            Pageable pageable
    );

    /**
     * Find files by user ID and file type
     */
    Page<WorkspaceFile> findByUserIdAndFileTypeAndStatus(
            String userId,
            WorkspaceFile.FileType fileType,
            WorkspaceFile.FileStatus status,
            Pageable pageable
    );

    /**
     * Search files by name for session
     */
    @Query("SELECT f FROM WorkspaceFile f WHERE f.sessionId = :sessionId " +
           "AND f.status = 'ACTIVE' AND LOWER(f.originalName) LIKE LOWER(CONCAT('%', :name, '%'))")
    Page<WorkspaceFile> searchByNameForSession(
            @Param("sessionId") String sessionId,
            @Param("name") String name,
            Pageable pageable
    );

    /**
     * Search files by name for user
     */
    @Query("SELECT f FROM WorkspaceFile f WHERE f.userId = :userId " +
           "AND f.status = 'ACTIVE' AND LOWER(f.originalName) LIKE LOWER(CONCAT('%', :name, '%'))")
    Page<WorkspaceFile> searchByNameForUser(
            @Param("userId") String userId,
            @Param("name") String name,
            Pageable pageable
    );

    /**
     * Find expired files
     */
    @Query("SELECT f FROM WorkspaceFile f WHERE f.status = 'ACTIVE' AND f.expiresAt IS NOT NULL AND f.expiresAt < :now")
    List<WorkspaceFile> findExpiredFiles(@Param("now") LocalDateTime now);

    /**
     * Find files pending deletion
     */
    List<WorkspaceFile> findByStatus(WorkspaceFile.FileStatus status);

    /**
     * Find old session files (for cleanup)
     */
    @Query("SELECT f FROM WorkspaceFile f WHERE f.sessionId IS NOT NULL AND f.userId IS NULL " +
           "AND f.createdAt < :threshold AND f.status = 'ACTIVE'")
    List<WorkspaceFile> findOldSessionFiles(@Param("threshold") LocalDateTime threshold);

    /**
     * Update file status
     */
    @Modifying
    @Query("UPDATE WorkspaceFile f SET f.status = :status, f.updatedAt = :now WHERE f.id = :id")
    void updateStatus(
            @Param("id") Long id,
            @Param("status") WorkspaceFile.FileStatus status,
            @Param("now") LocalDateTime now
    );

    /**
     * Increment download count
     */
    @Modifying
    @Query("UPDATE WorkspaceFile f SET f.downloadCount = f.downloadCount + 1, " +
           "f.lastAccessedAt = :now WHERE f.id = :id")
    void incrementDownloadCount(@Param("id") Long id, @Param("now") LocalDateTime now);

    /**
     * Mark files as deleted for session
     */
    @Modifying
    @Query("UPDATE WorkspaceFile f SET f.status = 'DELETED', f.updatedAt = :now WHERE f.sessionId = :sessionId")
    void markDeletedBySessionId(@Param("sessionId") String sessionId, @Param("now") LocalDateTime now);

    /**
     * Transfer files from session to user (when user logs in)
     */
    @Modifying
    @Query("UPDATE WorkspaceFile f SET f.userId = :userId, f.updatedAt = :now WHERE f.sessionId = :sessionId")
    void transferSessionFilesToUser(
            @Param("sessionId") String sessionId,
            @Param("userId") String userId,
            @Param("now") LocalDateTime now
    );

    /**
     * Count files by session
     */
    long countBySessionIdAndStatus(String sessionId, WorkspaceFile.FileStatus status);

    /**
     * Count files by user
     */
    long countByUserIdAndStatus(String userId, WorkspaceFile.FileStatus status);

    /**
     * Sum file sizes by session
     */
    @Query("SELECT COALESCE(SUM(f.fileSize), 0) FROM WorkspaceFile f WHERE f.sessionId = :sessionId AND f.status = 'ACTIVE'")
    Long sumFileSizeBySessionId(@Param("sessionId") String sessionId);

    /**
     * Sum file sizes by user
     */
    @Query("SELECT COALESCE(SUM(f.fileSize), 0) FROM WorkspaceFile f WHERE f.userId = :userId AND f.status = 'ACTIVE'")
    Long sumFileSizeByUserId(@Param("userId") String userId);

    /**
     * Find by stored name
     */
    Optional<WorkspaceFile> findByStoredName(String storedName);

    /**
     * Check if file exists with same checksum for deduplication
     */
    @Query("SELECT f FROM WorkspaceFile f WHERE f.checksum = :checksum AND f.status = 'ACTIVE' " +
           "AND (f.sessionId = :sessionId OR f.userId = :userId)")
    Optional<WorkspaceFile> findByChecksumAndOwner(
            @Param("checksum") String checksum,
            @Param("sessionId") String sessionId,
            @Param("userId") String userId
    );
}
