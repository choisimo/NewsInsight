package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.search.SearchTemplate;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Repository for SearchTemplate entity.
 * Provides template persistence and query operations.
 */
@Repository
public interface SearchTemplateRepository extends JpaRepository<SearchTemplate, Long> {

    /**
     * Find all templates by user
     */
    Page<SearchTemplate> findByUserId(String userId, Pageable pageable);

    /**
     * Find all templates by user (list)
     */
    List<SearchTemplate> findByUserIdOrderByCreatedAtDesc(String userId);

    /**
     * Find templates by mode
     */
    Page<SearchTemplate> findByMode(String mode, Pageable pageable);

    /**
     * Find templates by user and mode
     */
    Page<SearchTemplate> findByUserIdAndMode(String userId, String mode, Pageable pageable);

    /**
     * Find favorite templates by user
     */
    List<SearchTemplate> findByUserIdAndFavoriteTrueOrderByLastUsedAtDesc(String userId);

    /**
     * Find all favorites
     */
    Page<SearchTemplate> findByFavoriteTrue(Pageable pageable);

    /**
     * Search templates by name (case-insensitive)
     */
    @Query("SELECT st FROM SearchTemplate st WHERE LOWER(st.name) LIKE LOWER(CONCAT('%', :name, '%'))")
    Page<SearchTemplate> searchByName(@Param("name") String name, Pageable pageable);

    /**
     * Search templates by name for a specific user
     */
    @Query("SELECT st FROM SearchTemplate st WHERE st.userId = :userId AND LOWER(st.name) LIKE LOWER(CONCAT('%', :name, '%'))")
    Page<SearchTemplate> searchByNameAndUserId(@Param("name") String name, @Param("userId") String userId, Pageable pageable);

    /**
     * Search templates by query text
     */
    @Query("SELECT st FROM SearchTemplate st WHERE LOWER(st.query) LIKE LOWER(CONCAT('%', :query, '%'))")
    Page<SearchTemplate> searchByQuery(@Param("query") String query, Pageable pageable);

    /**
     * Find most used templates
     */
    @Query("SELECT st FROM SearchTemplate st WHERE st.userId = :userId ORDER BY st.useCount DESC")
    List<SearchTemplate> findMostUsedByUser(@Param("userId") String userId, Pageable pageable);

    /**
     * Find recently used templates
     */
    @Query("SELECT st FROM SearchTemplate st WHERE st.userId = :userId AND st.lastUsedAt IS NOT NULL ORDER BY st.lastUsedAt DESC")
    List<SearchTemplate> findRecentlyUsedByUser(@Param("userId") String userId, Pageable pageable);

    /**
     * Find templates created from a specific search
     */
    List<SearchTemplate> findBySourceSearchId(Long sourceSearchId);

    /**
     * Count templates by user
     */
    long countByUserId(String userId);

    /**
     * Count templates by mode
     */
    long countByMode(String mode);

    /**
     * Increment use count
     */
    @Modifying
    @Query("UPDATE SearchTemplate st SET st.useCount = st.useCount + 1, st.lastUsedAt = CURRENT_TIMESTAMP WHERE st.id = :id")
    void incrementUseCount(@Param("id") Long id);

    /**
     * Check if template with name exists for user
     */
    boolean existsByUserIdAndName(String userId, String name);
}
