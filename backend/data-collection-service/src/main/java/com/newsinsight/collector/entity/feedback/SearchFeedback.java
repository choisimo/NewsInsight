package com.newsinsight.collector.entity.feedback;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Entity for storing user feedback on search results.
 * Enables quality improvement through user ratings and comments.
 */
@Entity
@Table(name = "search_feedback", indexes = {
        @Index(name = "idx_feedback_search_history_id", columnList = "search_history_id"),
        @Index(name = "idx_feedback_user_id", columnList = "user_id"),
        @Index(name = "idx_feedback_rating", columnList = "rating"),
        @Index(name = "idx_feedback_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchFeedback {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Related search history ID
     */
    @Column(name = "search_history_id", nullable = false)
    private Long searchHistoryId;

    /**
     * User who provided feedback
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Session ID for anonymous feedback
     */
    @Column(name = "session_id", length = 64)
    private String sessionId;

    /**
     * Overall rating (1-5 stars)
     */
    @Column(name = "rating")
    private Integer rating;

    /**
     * Usefulness rating (1-5)
     */
    @Column(name = "usefulness_rating")
    private Integer usefulnessRating;

    /**
     * Accuracy rating (1-5)
     */
    @Column(name = "accuracy_rating")
    private Integer accuracyRating;

    /**
     * Relevance rating (1-5)
     */
    @Column(name = "relevance_rating")
    private Integer relevanceRating;

    /**
     * User's comment/feedback text
     */
    @Column(name = "comment", length = 2048)
    private String comment;

    /**
     * Improvement suggestions
     */
    @Column(name = "suggestions", length = 2048)
    private String suggestions;

    /**
     * Feedback type
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "feedback_type", length = 32)
    @Builder.Default
    private FeedbackType feedbackType = FeedbackType.GENERAL;

    /**
     * Specific result index being rated (for individual result feedback)
     */
    @Column(name = "result_index")
    private Integer resultIndex;

    /**
     * Specific result URL being rated
     */
    @Column(name = "result_url", length = 2048)
    private String resultUrl;

    /**
     * Quick feedback (thumbs up/down)
     */
    @Column(name = "thumbs_up")
    private Boolean thumbsUp;

    /**
     * Issue categories selected
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "issue_categories", columnDefinition = "jsonb")
    private java.util.List<String> issueCategories;

    /**
     * Additional metadata
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * Whether feedback has been reviewed by admin
     */
    @Column(name = "reviewed")
    @Builder.Default
    private Boolean reviewed = false;

    /**
     * Review notes by admin
     */
    @Column(name = "review_notes", length = 1024)
    private String reviewNotes;

    /**
     * Whether this feedback was used for model improvement
     */
    @Column(name = "used_for_training")
    @Builder.Default
    private Boolean usedForTraining = false;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    /**
     * Feedback type enum
     */
    public enum FeedbackType {
        /** General search feedback */
        GENERAL,
        /** Feedback on specific result */
        RESULT_SPECIFIC,
        /** AI summary feedback */
        AI_SUMMARY,
        /** Fact-check accuracy feedback */
        FACT_CHECK,
        /** Report quality feedback */
        REPORT,
        /** Bug report */
        BUG_REPORT,
        /** Feature request */
        FEATURE_REQUEST
    }

    /**
     * Calculate average rating
     */
    public Double getAverageRating() {
        int count = 0;
        int sum = 0;
        
        if (usefulnessRating != null) { sum += usefulnessRating; count++; }
        if (accuracyRating != null) { sum += accuracyRating; count++; }
        if (relevanceRating != null) { sum += relevanceRating; count++; }
        
        // @CHECK 
        // 평균 평가점수 계산 - 평가점수가 하나라도 있는 경우 평균 평가점수를 반환, 그렇지 않으면 0을 반환
        return count > 0 ? (double) sum / count : (rating != null ? rating.doubleValue() : (double) 0);
    }
}
