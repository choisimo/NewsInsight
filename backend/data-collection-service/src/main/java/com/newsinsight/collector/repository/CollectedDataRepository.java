package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.CollectedData;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface CollectedDataRepository extends JpaRepository<CollectedData, Long> {

    Optional<CollectedData> findByContentHash(String contentHash);

    List<CollectedData> findBySourceIdOrderByCollectedAtDesc(Long sourceId);

    Page<CollectedData> findBySourceId(Long sourceId, Pageable pageable);

    List<CollectedData> findByProcessedFalse();

    Page<CollectedData> findByProcessedFalse(Pageable pageable);

    Page<CollectedData> findByProcessed(Boolean processed, Pageable pageable);

    long countByProcessedFalse();

    @Query("SELECT COUNT(cd) FROM CollectedData cd WHERE cd.collectedAt >= :startDate")
    long countCollectedSince(@Param("startDate") LocalDateTime startDate);

    @Query("SELECT COUNT(cd) FROM CollectedData cd WHERE cd.sourceId = :sourceId")
    long countBySourceId(@Param("sourceId") Long sourceId);

    /**
     * Full-Text Search with date filter using PostgreSQL tsvector.
     * Uses plainto_tsquery for natural language queries (handles Korean well).
     * Falls back to LIKE for very short queries (1-2 chars).
     * Results are ranked by FTS relevance, then by date.
     */
    @Query(value = """
        SELECT * FROM collected_data cd
        WHERE (
            :query IS NULL OR :query = '' OR
            CASE 
                WHEN LENGTH(:query) <= 2 THEN 
                    LOWER(cd.title) LIKE LOWER(CONCAT('%', :query, '%')) 
                    OR LOWER(cd.content) LIKE LOWER(CONCAT('%', :query, '%'))
                ELSE 
                    cd.search_vector @@ plainto_tsquery('simple', :query)
            END
        )
        AND ((cd.published_date IS NOT NULL AND cd.published_date >= :since)
          OR (cd.published_date IS NULL AND cd.collected_at >= :since))
        ORDER BY 
            CASE WHEN :query IS NOT NULL AND :query != '' AND LENGTH(:query) > 2 
                 THEN ts_rank(cd.search_vector, plainto_tsquery('simple', :query)) 
                 ELSE 0 END DESC,
            COALESCE(cd.published_date, cd.collected_at) DESC
        """,
        countQuery = """
        SELECT COUNT(*) FROM collected_data cd
        WHERE (
            :query IS NULL OR :query = '' OR
            CASE 
                WHEN LENGTH(:query) <= 2 THEN 
                    LOWER(cd.title) LIKE LOWER(CONCAT('%', :query, '%')) 
                    OR LOWER(cd.content) LIKE LOWER(CONCAT('%', :query, '%'))
                ELSE 
                    cd.search_vector @@ plainto_tsquery('simple', :query)
            END
        )
        AND ((cd.published_date IS NOT NULL AND cd.published_date >= :since)
          OR (cd.published_date IS NULL AND cd.collected_at >= :since))
        """,
        nativeQuery = true)
    Page<CollectedData> searchByQueryAndSince(@Param("query") String query,
                                              @Param("since") LocalDateTime since,
                                              Pageable pageable);

    /**
     * Full-Text Search without date filter.
     * Uses plainto_tsquery for natural language queries.
     * Falls back to LIKE for very short queries (1-2 chars).
     */
    @Query(value = """
        SELECT * FROM collected_data cd
        WHERE (
            :query IS NULL OR :query = '' OR
            CASE 
                WHEN LENGTH(:query) <= 2 THEN 
                    LOWER(cd.title) LIKE LOWER(CONCAT('%', :query, '%')) 
                    OR LOWER(cd.content) LIKE LOWER(CONCAT('%', :query, '%'))
                ELSE 
                    cd.search_vector @@ plainto_tsquery('simple', :query)
            END
        )
        ORDER BY 
            CASE WHEN :query IS NOT NULL AND :query != '' AND LENGTH(:query) > 2 
                 THEN ts_rank(cd.search_vector, plainto_tsquery('simple', :query)) 
                 ELSE 0 END DESC,
            COALESCE(cd.published_date, cd.collected_at) DESC
        """,
        countQuery = """
        SELECT COUNT(*) FROM collected_data cd
        WHERE (
            :query IS NULL OR :query = '' OR
            CASE 
                WHEN LENGTH(:query) <= 2 THEN 
                    LOWER(cd.title) LIKE LOWER(CONCAT('%', :query, '%')) 
                    OR LOWER(cd.content) LIKE LOWER(CONCAT('%', :query, '%'))
                ELSE 
                    cd.search_vector @@ plainto_tsquery('simple', :query)
            END
        )
        """,
        nativeQuery = true)
    Page<CollectedData> searchByQuery(@Param("query") String query,
                                      Pageable pageable);

    /**
     * Full-Text Search with custom date range (start and end date).
     * Uses plainto_tsquery for natural language queries (handles Korean well).
     * Falls back to LIKE for very short queries (1-2 chars).
     * Results are ranked by FTS relevance, then by date.
     * 
     * @param query Search query
     * @param since Start date (inclusive)
     * @param until End date (inclusive)
     * @param pageable Pagination info
     * @return Page of matching articles within the date range
     */
    @Query(value = """
        SELECT * FROM collected_data cd
        WHERE (
            :query IS NULL OR :query = '' OR
            CASE 
                WHEN LENGTH(:query) <= 2 THEN 
                    LOWER(cd.title) LIKE LOWER(CONCAT('%', :query, '%')) 
                    OR LOWER(cd.content) LIKE LOWER(CONCAT('%', :query, '%'))
                ELSE 
                    cd.search_vector @@ plainto_tsquery('simple', :query)
            END
        )
        AND ((cd.published_date IS NOT NULL AND cd.published_date >= :since AND cd.published_date <= :until)
          OR (cd.published_date IS NULL AND cd.collected_at >= :since AND cd.collected_at <= :until))
        ORDER BY 
            CASE WHEN :query IS NOT NULL AND :query != '' AND LENGTH(:query) > 2 
                 THEN ts_rank(cd.search_vector, plainto_tsquery('simple', :query)) 
                 ELSE 0 END DESC,
            COALESCE(cd.published_date, cd.collected_at) DESC
        """,
        countQuery = """
        SELECT COUNT(*) FROM collected_data cd
        WHERE (
            :query IS NULL OR :query = '' OR
            CASE 
                WHEN LENGTH(:query) <= 2 THEN 
                    LOWER(cd.title) LIKE LOWER(CONCAT('%', :query, '%')) 
                    OR LOWER(cd.content) LIKE LOWER(CONCAT('%', :query, '%'))
                ELSE 
                    cd.search_vector @@ plainto_tsquery('simple', :query)
            END
        )
        AND ((cd.published_date IS NOT NULL AND cd.published_date >= :since AND cd.published_date <= :until)
          OR (cd.published_date IS NULL AND cd.collected_at >= :since AND cd.collected_at <= :until))
        """,
        nativeQuery = true)
    Page<CollectedData> searchByQueryAndDateRange(@Param("query") String query,
                                                  @Param("since") LocalDateTime since,
                                                  @Param("until") LocalDateTime until,
                                                  Pageable pageable);

    boolean existsByContentHash(String contentHash);
}
