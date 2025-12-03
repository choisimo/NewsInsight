package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.search.SearchHistory;
import com.newsinsight.collector.entity.search.SearchType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * Repository for SearchHistory entity.
 * Provides search history persistence and query operations.
 */
@Repository
public interface SearchHistoryRepository extends JpaRepository<SearchHistory, Long> {

    /**
     * Find by external ID (e.g., jobId)
     */
    Optional<SearchHistory> findByExternalId(String externalId);

    /**
     * Find all searches by type
     */
    Page<SearchHistory> findBySearchType(SearchType searchType, Pageable pageable);

    /**
     * Find all searches by user
     */
    Page<SearchHistory> findByUserId(String userId, Pageable pageable);

    /**
     * Find searches by user and type
     */
    Page<SearchHistory> findByUserIdAndSearchType(String userId, SearchType searchType, Pageable pageable);

    /**
     * Find bookmarked searches
     */
    Page<SearchHistory> findByBookmarkedTrue(Pageable pageable);

    /**
     * Find bookmarked searches by user
     */
    Page<SearchHistory> findByUserIdAndBookmarkedTrue(String userId, Pageable pageable);

    /**
     * Find derived searches from a parent
     */
    List<SearchHistory> findByParentSearchIdOrderByCreatedAtDesc(Long parentSearchId);

    /**
     * Find searches by session
     */
    List<SearchHistory> findBySessionIdOrderByCreatedAtDesc(String sessionId);

    /**
     * Search by query text (case-insensitive, partial match)
     */
    @Query("SELECT sh FROM SearchHistory sh WHERE LOWER(sh.query) LIKE LOWER(CONCAT('%', :query, '%'))")
    Page<SearchHistory> searchByQuery(@Param("query") String query, Pageable pageable);

    /**
     * Search by query text and type
     */
    @Query("SELECT sh FROM SearchHistory sh WHERE LOWER(sh.query) LIKE LOWER(CONCAT('%', :query, '%')) AND sh.searchType = :searchType")
    Page<SearchHistory> searchByQueryAndType(
            @Param("query") String query,
            @Param("searchType") SearchType searchType,
            Pageable pageable
    );

    /**
     * Find recent searches within time range
     */
    Page<SearchHistory> findByCreatedAtAfter(LocalDateTime after, Pageable pageable);

    /**
     * Find recent searches by user within time range
     */
    Page<SearchHistory> findByUserIdAndCreatedAtAfter(String userId, LocalDateTime after, Pageable pageable);

    /**
     * Get search count by type
     */
    long countBySearchType(SearchType searchType);

    /**
     * Get search count by user
     */
    long countByUserId(String userId);

    /**
     * Find searches with specific tag
     */
    @Query(value = "SELECT * FROM search_history WHERE tags @> :tag::jsonb", nativeQuery = true)
    List<SearchHistory> findByTag(@Param("tag") String tagJson);

    /**
     * Delete old searches (for cleanup)
     */
    @Query("DELETE FROM SearchHistory sh WHERE sh.createdAt < :before AND sh.bookmarked = false")
    void deleteOldSearches(@Param("before") LocalDateTime before);

    /**
     * Get unique discovered URLs from recent searches
     */
    @Query(value = """
            SELECT DISTINCT jsonb_array_elements_text(discovered_urls) as url
            FROM search_history 
            WHERE discovered_urls IS NOT NULL 
            AND created_at > :after
            LIMIT :limit
            """, nativeQuery = true)
    List<String> findRecentDiscoveredUrls(@Param("after") LocalDateTime after, @Param("limit") int limit);

    /**
     * Find similar searches (by query similarity)
     */
    @Query(value = """
            SELECT * FROM search_history 
            WHERE search_type = :searchType
            AND similarity(query, :query) > 0.3
            ORDER BY similarity(query, :query) DESC
            LIMIT :limit
            """, nativeQuery = true)
    List<SearchHistory> findSimilarSearches(
            @Param("query") String query,
            @Param("searchType") String searchType,
            @Param("limit") int limit
    );

    /**
     * Get search statistics summary
     */
    @Query("""
            SELECT sh.searchType as searchType, COUNT(sh) as count, AVG(sh.resultCount) as avgResults
            FROM SearchHistory sh
            WHERE sh.createdAt > :after
            GROUP BY sh.searchType
            """)
    List<SearchStatsSummary> getSearchStatsSummary(@Param("after") LocalDateTime after);

    /**
     * Projection for search statistics
     */
    interface SearchStatsSummary {
        SearchType getSearchType();
        Long getCount();
        Double getAvgResults();
    }
}
