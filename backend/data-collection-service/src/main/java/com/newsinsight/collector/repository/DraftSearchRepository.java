package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.search.DraftSearch;
import com.newsinsight.collector.entity.search.SearchType;
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
 * Repository for DraftSearch entity.
 * Manages draft/unsaved search persistence.
 */
@Repository
public interface DraftSearchRepository extends JpaRepository<DraftSearch, Long> {

    /**
     * Find unexecuted drafts by user
     */
    List<DraftSearch> findByUserIdAndExecutedFalseOrderByCreatedAtDesc(String userId);

    /**
     * Find unexecuted drafts by session
     */
    List<DraftSearch> findBySessionIdAndExecutedFalseOrderByCreatedAtDesc(String sessionId);

    /**
     * Find drafts by user or session (for anonymous users)
     */
    @Query("""
            SELECT d FROM DraftSearch d 
            WHERE (d.userId = :userId OR d.sessionId = :sessionId)
            AND d.executed = false
            ORDER BY d.createdAt DESC
            """)
    List<DraftSearch> findUnexecutedDrafts(
            @Param("userId") String userId,
            @Param("sessionId") String sessionId,
            Pageable pageable
    );

    /**
     * Find drafts by search type
     */
    Page<DraftSearch> findBySearchTypeAndExecutedFalse(SearchType searchType, Pageable pageable);

    /**
     * Find drafts for a project
     */
    List<DraftSearch> findByProjectIdAndExecutedFalseOrderByCreatedAtDesc(Long projectId);

    /**
     * Mark draft as executed
     */
    @Modifying
    @Query("""
            UPDATE DraftSearch d 
            SET d.executed = true, d.executedAt = :executedAt, d.searchHistoryId = :searchHistoryId 
            WHERE d.id = :id
            """)
    void markExecuted(
            @Param("id") Long id,
            @Param("executedAt") LocalDateTime executedAt,
            @Param("searchHistoryId") Long searchHistoryId
    );

    /**
     * Delete old executed drafts (cleanup)
     */
    @Modifying
    @Query("DELETE FROM DraftSearch d WHERE d.executed = true AND d.executedAt < :before")
    void deleteOldExecutedDrafts(@Param("before") LocalDateTime before);

    /**
     * Delete old unexecuted drafts (cleanup)
     */
    @Modifying
    @Query("DELETE FROM DraftSearch d WHERE d.executed = false AND d.createdAt < :before")
    void deleteOldUnexecutedDrafts(@Param("before") LocalDateTime before);

    /**
     * Count unexecuted drafts by user
     */
    long countByUserIdAndExecutedFalse(String userId);

    /**
     * Find recent drafts with similar query
     */
    @Query("""
            SELECT d FROM DraftSearch d 
            WHERE d.userId = :userId 
            AND LOWER(d.query) LIKE LOWER(CONCAT('%', :query, '%'))
            AND d.executed = false
            ORDER BY d.createdAt DESC
            """)
    List<DraftSearch> findSimilarDrafts(
            @Param("userId") String userId,
            @Param("query") String query,
            Pageable pageable
    );
}
