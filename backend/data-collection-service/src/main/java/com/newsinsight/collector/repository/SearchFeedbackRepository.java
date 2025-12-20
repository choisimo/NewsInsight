package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.feedback.SearchFeedback;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Repository for SearchFeedback entity.
 * Manages user feedback on search results.
 */
@Repository
public interface SearchFeedbackRepository extends JpaRepository<SearchFeedback, Long> {

    /**
     * Find by search history ID
     */
    List<SearchFeedback> findBySearchHistoryIdOrderByCreatedAtDesc(Long searchHistoryId);

    /**
     * Find by user ID
     */
    Page<SearchFeedback> findByUserIdOrderByCreatedAtDesc(String userId, Pageable pageable);

    /**
     * Find by feedback type
     */
    Page<SearchFeedback> findByFeedbackType(SearchFeedback.FeedbackType feedbackType, Pageable pageable);

    /**
     * Find unreviewed feedback
     */
    Page<SearchFeedback> findByReviewedFalseOrderByCreatedAtDesc(Pageable pageable);

    /**
     * Find feedback with low ratings
     */
    @Query("SELECT f FROM SearchFeedback f WHERE f.rating <= :maxRating ORDER BY f.createdAt DESC")
    Page<SearchFeedback> findLowRatedFeedback(@Param("maxRating") int maxRating, Pageable pageable);

    /**
     * Find positive feedback (thumbs up)
     */
    Page<SearchFeedback> findByThumbsUpTrueOrderByCreatedAtDesc(Pageable pageable);

    /**
     * Find negative feedback (thumbs down)
     */
    Page<SearchFeedback> findByThumbsUpFalseOrderByCreatedAtDesc(Pageable pageable);

    /**
     * Count feedback by search history
     */
    long countBySearchHistoryId(Long searchHistoryId);

    /**
     * Average rating by search history
     */
    @Query("SELECT AVG(f.rating) FROM SearchFeedback f WHERE f.searchHistoryId = :searchHistoryId AND f.rating IS NOT NULL")
    Double getAverageRatingBySearchHistory(@Param("searchHistoryId") Long searchHistoryId);

    /**
     * Get overall feedback statistics
     */
    @Query("""
            SELECT 
                COUNT(f) as totalCount,
                AVG(f.rating) as avgRating,
                AVG(f.usefulnessRating) as avgUsefulness,
                AVG(f.accuracyRating) as avgAccuracy,
                AVG(f.relevanceRating) as avgRelevance,
                SUM(CASE WHEN f.thumbsUp = true THEN 1 ELSE 0 END) as thumbsUpCount,
                SUM(CASE WHEN f.thumbsUp = false THEN 1 ELSE 0 END) as thumbsDownCount
            FROM SearchFeedback f
            WHERE f.createdAt > :after
            """)
    FeedbackStats getOverallStats(@Param("after") LocalDateTime after);

    /**
     * Get feedback stats by type
     */
    @Query("""
            SELECT f.feedbackType as feedbackType, COUNT(f) as count, AVG(f.rating) as avgRating
            FROM SearchFeedback f
            WHERE f.createdAt > :after
            GROUP BY f.feedbackType
            """)
    List<FeedbackTypeStats> getStatsByType(@Param("after") LocalDateTime after);

    /**
     * Find feedback not used for training
     */
    @Query("""
            SELECT f FROM SearchFeedback f 
            WHERE f.usedForTraining = false 
            AND f.reviewed = true
            ORDER BY f.createdAt
            """)
    List<SearchFeedback> findUnusedForTraining(Pageable pageable);

    interface FeedbackStats {
        Long getTotalCount();
        Double getAvgRating();
        Double getAvgUsefulness();
        Double getAvgAccuracy();
        Double getAvgRelevance();
        Long getThumbsUpCount();
        Long getThumbsDownCount();
    }

    interface FeedbackTypeStats {
        SearchFeedback.FeedbackType getFeedbackType();
        Long getCount();
        Double getAvgRating();
    }
}
