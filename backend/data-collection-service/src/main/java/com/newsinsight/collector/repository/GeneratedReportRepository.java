package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.report.GeneratedReport;
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
 * Repository for GeneratedReport entity.
 * Manages report persistence and retrieval.
 */
@Repository
public interface GeneratedReportRepository extends JpaRepository<GeneratedReport, Long> {

    /**
     * Find by search history ID
     */
    List<GeneratedReport> findBySearchHistoryIdOrderByCreatedAtDesc(Long searchHistoryId);

    /**
     * Find by user ID
     */
    Page<GeneratedReport> findByUserIdOrderByCreatedAtDesc(String userId, Pageable pageable);

    /**
     * Find by project ID
     */
    Page<GeneratedReport> findByProjectIdOrderByCreatedAtDesc(Long projectId, Pageable pageable);

    /**
     * Find by report type
     */
    Page<GeneratedReport> findByReportType(GeneratedReport.ReportType reportType, Pageable pageable);

    /**
     * Find by status
     */
    Page<GeneratedReport> findByStatus(GeneratedReport.ReportStatus status, Pageable pageable);

    /**
     * Find public reports
     */
    Page<GeneratedReport> findByIsPublicTrue(Pageable pageable);

    /**
     * Find by public URL
     */
    Optional<GeneratedReport> findByPublicUrl(String publicUrl);

    /**
     * Find pending reports
     */
    @Query("SELECT r FROM GeneratedReport r WHERE r.status IN ('PENDING', 'GENERATING') ORDER BY r.createdAt")
    List<GeneratedReport> findPendingReports();

    /**
     * Find expired public reports
     */
    @Query("""
            SELECT r FROM GeneratedReport r 
            WHERE r.isPublic = true 
            AND r.shareExpiresAt < :now
            """)
    List<GeneratedReport> findExpiredPublicReports(@Param("now") LocalDateTime now);

    /**
     * Update download count
     */
    @Modifying
    @Query("""
            UPDATE GeneratedReport r 
            SET r.downloadCount = r.downloadCount + 1, r.lastDownloadedAt = :downloadedAt 
            WHERE r.id = :id
            """)
    void incrementDownloadCount(@Param("id") Long id, @Param("downloadedAt") LocalDateTime downloadedAt);

    /**
     * Update status
     */
    @Modifying
    @Query("UPDATE GeneratedReport r SET r.status = :status WHERE r.id = :id")
    void updateStatus(@Param("id") Long id, @Param("status") GeneratedReport.ReportStatus status);

    /**
     * Mark as public
     */
    @Modifying
    @Query("""
            UPDATE GeneratedReport r 
            SET r.isPublic = true, r.publicUrl = :publicUrl, r.shareExpiresAt = :expiresAt 
            WHERE r.id = :id
            """)
    void makePublic(
            @Param("id") Long id,
            @Param("publicUrl") String publicUrl,
            @Param("expiresAt") LocalDateTime expiresAt
    );

    /**
     * Revoke public access
     */
    @Modifying
    @Query("UPDATE GeneratedReport r SET r.isPublic = false, r.publicUrl = null, r.shareExpiresAt = null WHERE r.id = :id")
    void revokePublicAccess(@Param("id") Long id);

    /**
     * Count by user
     */
    long countByUserId(String userId);

    /**
     * Count by project
     */
    long countByProjectId(Long projectId);

    /**
     * Delete old reports
     */
    @Modifying
    @Query("DELETE FROM GeneratedReport r WHERE r.createdAt < :before AND r.status IN ('COMPLETED', 'FAILED', 'EXPIRED')")
    void deleteOldReports(@Param("before") LocalDateTime before);

    /**
     * Get report statistics
     */
    @Query("""
            SELECT r.reportType as reportType, COUNT(r) as count, SUM(r.downloadCount) as totalDownloads
            FROM GeneratedReport r
            WHERE r.createdAt > :after
            GROUP BY r.reportType
            """)
    List<ReportStats> getStatsByType(@Param("after") LocalDateTime after);

    interface ReportStats {
        GeneratedReport.ReportType getReportType();
        Long getCount();
        Long getTotalDownloads();
    }
}
