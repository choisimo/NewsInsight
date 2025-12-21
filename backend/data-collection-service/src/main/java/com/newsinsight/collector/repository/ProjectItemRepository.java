package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.project.ProjectItem;
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
 * Repository for ProjectItem entity.
 */
@Repository
public interface ProjectItemRepository extends JpaRepository<ProjectItem, Long> {

    /**
     * Find by project ID
     */
    Page<ProjectItem> findByProjectIdOrderByAddedAtDesc(Long projectId, Pageable pageable);

    /**
     * Find by project ID and type
     */
    Page<ProjectItem> findByProjectIdAndItemType(Long projectId, ProjectItem.ItemType itemType, Pageable pageable);

    /**
     * Find bookmarked items
     */
    Page<ProjectItem> findByProjectIdAndBookmarkedTrue(Long projectId, Pageable pageable);

    /**
     * Find unread items
     */
    Page<ProjectItem> findByProjectIdAndIsReadFalse(Long projectId, Pageable pageable);

    /**
     * Find by importance
     */
    Page<ProjectItem> findByProjectIdAndImportanceGreaterThanEqual(Long projectId, Integer minImportance, Pageable pageable);

    /**
     * Find by category
     */
    Page<ProjectItem> findByProjectIdAndCategory(Long projectId, String category, Pageable pageable);

    /**
     * Find by source ID
     */
    List<ProjectItem> findBySourceIdAndSourceType(String sourceId, String sourceType);

    /**
     * Find by URL
     */
    List<ProjectItem> findByProjectIdAndUrl(Long projectId, String url);

    /**
     * Search by title
     */
    @Query("""
            SELECT i FROM ProjectItem i 
            WHERE i.projectId = :projectId 
            AND LOWER(i.title) LIKE LOWER(CONCAT('%', :query, '%'))
            ORDER BY i.addedAt DESC
            """)
    Page<ProjectItem> searchByTitle(@Param("projectId") Long projectId, @Param("query") String query, Pageable pageable);

    /**
     * Search by content
     */
    @Query("""
            SELECT i FROM ProjectItem i 
            WHERE i.projectId = :projectId 
            AND (LOWER(i.title) LIKE LOWER(CONCAT('%', :query, '%')) 
                 OR LOWER(i.summary) LIKE LOWER(CONCAT('%', :query, '%')))
            ORDER BY i.addedAt DESC
            """)
    Page<ProjectItem> searchByContent(@Param("projectId") Long projectId, @Param("query") String query, Pageable pageable);

    /**
     * Find by tag
     */
    @Query(value = """
            SELECT * FROM project_items 
            WHERE project_id = :projectId 
            AND tags @> :tag::jsonb
            ORDER BY added_at DESC
            """, nativeQuery = true)
    Page<ProjectItem> findByTag(@Param("projectId") Long projectId, @Param("tag") String tagJson, Pageable pageable);

    /**
     * Find items within date range
     */
    Page<ProjectItem> findByProjectIdAndPublishedAtBetween(
            Long projectId,
            LocalDateTime from,
            LocalDateTime to,
            Pageable pageable
    );

    /**
     * Find recent items added
     */
    Page<ProjectItem> findByProjectIdAndAddedAtAfter(Long projectId, LocalDateTime after, Pageable pageable);

    /**
     * Mark as read
     */
    @Modifying
    @Query("UPDATE ProjectItem i SET i.isRead = true WHERE i.id = :id")
    void markAsRead(@Param("id") Long id);

    /**
     * Mark all as read for project
     */
    @Modifying
    @Query("UPDATE ProjectItem i SET i.isRead = true WHERE i.projectId = :projectId")
    void markAllAsRead(@Param("projectId") Long projectId);

    /**
     * Toggle bookmark
     */
    @Modifying
    @Query("UPDATE ProjectItem i SET i.bookmarked = NOT i.bookmarked WHERE i.id = :id")
    void toggleBookmark(@Param("id") Long id);

    /**
     * Update importance
     */
    @Modifying
    @Query("UPDATE ProjectItem i SET i.importance = :importance WHERE i.id = :id")
    void updateImportance(@Param("id") Long id, @Param("importance") Integer importance);

    /**
     * Count by project
     */
    long countByProjectId(Long projectId);

    /**
     * Count by project and type
     */
    long countByProjectIdAndItemType(Long projectId, ProjectItem.ItemType itemType);

    /**
     * Count unread by project
     */
    long countByProjectIdAndIsReadFalse(Long projectId);

    /**
     * Get distinct categories for project
     */
    @Query("SELECT DISTINCT i.category FROM ProjectItem i WHERE i.projectId = :projectId AND i.category IS NOT NULL")
    List<String> findDistinctCategories(@Param("projectId") Long projectId);

    /**
     * Get item count by date
     */
    @Query("""
            SELECT CAST(i.addedAt AS date) as date, COUNT(i) as count
            FROM ProjectItem i
            WHERE i.projectId = :projectId
            AND i.addedAt > :after
            GROUP BY CAST(i.addedAt AS date)
            ORDER BY date DESC
            """)
    List<ItemCountByDate> getItemCountByDate(@Param("projectId") Long projectId, @Param("after") LocalDateTime after);

    /**
     * Delete by project
     */
    void deleteByProjectId(Long projectId);

    interface ItemCountByDate {
        java.sql.Date getDate();
        Long getCount();
    }
}
