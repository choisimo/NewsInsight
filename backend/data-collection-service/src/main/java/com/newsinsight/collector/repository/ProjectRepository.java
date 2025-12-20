package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.project.Project;
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
 * Repository for Project entity.
 */
@Repository
public interface ProjectRepository extends JpaRepository<Project, Long> {

    /**
     * Find by owner ID
     */
    Page<Project> findByOwnerIdOrderByLastActivityAtDesc(String ownerId, Pageable pageable);

    /**
     * Find by owner ID and status
     */
    Page<Project> findByOwnerIdAndStatus(String ownerId, Project.ProjectStatus status, Pageable pageable);

    /**
     * Find by owner ID and category
     */
    Page<Project> findByOwnerIdAndCategory(String ownerId, Project.ProjectCategory category, Pageable pageable);

    /**
     * Find default project for user
     */
    Optional<Project> findByOwnerIdAndIsDefaultTrue(String ownerId);

    /**
     * Find active projects with auto-collect enabled
     */
    @Query(value = "SELECT * FROM projects p WHERE p.status = 'ACTIVE' AND p.settings IS NOT NULL AND p.settings->>'autoCollect' = 'true'", nativeQuery = true)
    List<Project> findAutoCollectEnabledProjects();

    /**
     * Find projects needing collection (based on interval)
     */
    @Query(value = """
            SELECT * FROM projects p 
            WHERE p.status = 'ACTIVE' 
            AND p.settings->>'autoCollect' = 'true'
            AND (
                p.last_collected_at IS NULL 
                OR (
                    (p.settings->>'collectInterval' = 'hourly' AND p.last_collected_at < :hourAgo)
                    OR (p.settings->>'collectInterval' = 'daily' AND p.last_collected_at < :dayAgo)
                    OR (p.settings->>'collectInterval' = 'weekly' AND p.last_collected_at < :weekAgo)
                )
            )
            """, nativeQuery = true)
    List<Project> findProjectsNeedingCollection(
            @Param("hourAgo") LocalDateTime hourAgo,
            @Param("dayAgo") LocalDateTime dayAgo,
            @Param("weekAgo") LocalDateTime weekAgo
    );

    /**
     * Find public projects
     */
    Page<Project> findByVisibility(Project.ProjectVisibility visibility, Pageable pageable);

    /**
     * Search projects by name
     */
    @Query("SELECT p FROM Project p WHERE LOWER(p.name) LIKE LOWER(CONCAT('%', :name, '%'))")
    Page<Project> searchByName(@Param("name") String name, Pageable pageable);

    /**
     * Search projects by keyword
     */
    @Query(value = """
            SELECT * FROM projects p 
            WHERE p.keywords @> :keyword::jsonb
            """, nativeQuery = true)
    List<Project> findByKeyword(@Param("keyword") String keywordJson);

    /**
     * Update last activity
     */
    @Modifying
    @Query("UPDATE Project p SET p.lastActivityAt = :activityAt WHERE p.id = :id")
    void updateLastActivity(@Param("id") Long id, @Param("activityAt") LocalDateTime activityAt);

    /**
     * Update last collected
     */
    @Modifying
    @Query("UPDATE Project p SET p.lastCollectedAt = :collectedAt WHERE p.id = :id")
    void updateLastCollected(@Param("id") Long id, @Param("collectedAt") LocalDateTime collectedAt);

    /**
     * Update status
     */
    @Modifying
    @Query("UPDATE Project p SET p.status = :status, p.updatedAt = :updatedAt WHERE p.id = :id")
    void updateStatus(
            @Param("id") Long id,
            @Param("status") Project.ProjectStatus status,
            @Param("updatedAt") LocalDateTime updatedAt
    );

    /**
     * Count by owner
     */
    long countByOwnerId(String ownerId);

    /**
     * Count by status
     */
    long countByStatus(Project.ProjectStatus status);

    /**
     * Count active projects by owner
     */
    long countByOwnerIdAndStatus(String ownerId, Project.ProjectStatus status);

    /**
     * Find inactive projects (for cleanup suggestions)
     */
    @Query("SELECT p FROM Project p WHERE p.status = com.newsinsight.collector.entity.project.Project$ProjectStatus.ACTIVE AND p.lastActivityAt < :inactiveSince ORDER BY p.lastActivityAt ASC")
    List<Project> findInactiveProjects(@Param("inactiveSince") LocalDateTime inactiveSince, Pageable pageable);
}
