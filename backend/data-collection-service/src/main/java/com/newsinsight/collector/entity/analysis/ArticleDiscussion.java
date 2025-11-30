package com.newsinsight.collector.entity.analysis;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 기사 관련 커뮤니티/댓글/여론 분석 결과 엔티티.
 * 
 * 포털 댓글, SNS, 커뮤니티 등에서 수집된 반응 데이터를 분석하여 저장.
 */
@Entity
@Table(name = "article_discussion", indexes = {
    @Index(name = "idx_discussion_article_id", columnList = "article_id"),
    @Index(name = "idx_discussion_sentiment", columnList = "overall_sentiment"),
    @Index(name = "idx_discussion_updated", columnList = "updated_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ArticleDiscussion {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 분석 대상 기사 ID
     */
    @Column(name = "article_id", nullable = false, unique = true)
    private Long articleId;

    // ========== 수집 메타데이터 ==========

    /**
     * 총 댓글/반응 수
     */
    @Column(name = "total_comment_count")
    @Builder.Default
    private Integer totalCommentCount = 0;

    /**
     * 분석된 댓글 수
     */
    @Column(name = "analyzed_count")
    @Builder.Default
    private Integer analyzedCount = 0;

    /**
     * 수집 플랫폼 목록
     * ["portal_comments", "twitter", "community_dcinside", "community_fmkorea"]
     */
    @Column(name = "platforms", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> platforms;

    /**
     * 플랫폼별 댓글 수
     * {"portal_comments": 150, "twitter": 45, "community": 80}
     */
    @Column(name = "platform_counts", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Integer> platformCounts;

    // ========== 전체 감정 분석 ==========

    /**
     * 전체 감정 레이블 (positive, negative, neutral, mixed)
     */
    @Column(name = "overall_sentiment", length = 20)
    private String overallSentiment;

    /**
     * 감정 분포
     * {"positive": 0.2, "negative": 0.6, "neutral": 0.2}
     */
    @Column(name = "sentiment_distribution", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Double> sentimentDistribution;

    /**
     * 세부 감정 분석 (분노, 슬픔, 불안, 기쁨 등)
     * {"anger": 0.4, "anxiety": 0.2, "sadness": 0.15, "joy": 0.1, "surprise": 0.15}
     */
    @Column(name = "emotion_distribution", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Double> emotionDistribution;

    /**
     * 지배적 감정
     */
    @Column(name = "dominant_emotion", length = 30)
    private String dominantEmotion;

    // ========== 스탠스/입장 분석 ==========

    /**
     * 찬반 분포
     * {"agree": 0.3, "disagree": 0.5, "neutral": 0.2}
     */
    @Column(name = "stance_distribution", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Double> stanceDistribution;

    /**
     * 전체적인 여론 방향 (supportive, opposing, divided, neutral)
     */
    @Column(name = "overall_stance", length = 30)
    private String overallStance;

    // ========== 독성/품질 분석 ==========

    /**
     * 전체 독성 점수 (0 ~ 1)
     */
    @Column(name = "toxicity_score")
    private Double toxicityScore;

    /**
     * 혐오발언 비율
     */
    @Column(name = "hate_speech_ratio")
    private Double hateSpeechRatio;

    /**
     * 욕설 비율
     */
    @Column(name = "profanity_ratio")
    private Double profanityRatio;

    /**
     * 여론 건전성 점수 (0 ~ 100)
     */
    @Column(name = "discussion_quality_score")
    private Double discussionQualityScore;

    // ========== 키워드/토픽 ==========

    /**
     * 상위 키워드
     * [{"word": "정부", "count": 45}, {"word": "반대", "count": 32}]
     */
    @Column(name = "top_keywords", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> topKeywords;

    /**
     * 댓글에서만 언급되는 이슈 (기사에 없는 관점)
     * ["언론이 숨기는 진실", "과거 사례 비교"]
     */
    @Column(name = "emerging_topics", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> emergingTopics;

    // ========== 시계열 분석 ==========

    /**
     * 시간대별 여론 변화
     * [{"hour": "2025-01-15T10:00", "sentiment": -0.3, "volume": 25}, ...]
     */
    @Column(name = "time_series", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> timeSeries;

    /**
     * 여론 반전 시점 (있는 경우)
     */
    @Column(name = "sentiment_shift_at")
    private LocalDateTime sentimentShiftAt;

    /**
     * 피크 시점 (가장 많은 반응이 있던 시간)
     */
    @Column(name = "peak_activity_at")
    private LocalDateTime peakActivityAt;

    // ========== 조작/봇 탐지 ==========

    /**
     * 의심스러운 패턴 탐지 여부
     */
    @Column(name = "suspicious_pattern_detected")
    @Builder.Default
    private Boolean suspiciousPatternDetected = false;

    /**
     * 봇/조작 의심 점수 (0 ~ 1)
     */
    @Column(name = "bot_likelihood_score")
    private Double botLikelihoodScore;

    /**
     * 탐지된 의심 패턴 목록
     * ["repeated_text", "coordinated_posting", "new_account_surge"]
     */
    @Column(name = "suspicious_patterns", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> suspiciousPatterns;

    // ========== 대표 댓글 ==========

    /**
     * 대표 긍정 댓글 샘플
     */
    @Column(name = "sample_positive_comments", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> samplePositiveComments;

    /**
     * 대표 부정 댓글 샘플
     */
    @Column(name = "sample_negative_comments", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> sampleNegativeComments;

    /**
     * 가장 많은 공감을 받은 댓글
     */
    @Column(name = "top_engaged_comments", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> topEngagedComments;

    // ========== 플랫폼별 비교 ==========

    /**
     * 플랫폼별 감정 비교
     * {"portal": {"positive": 0.3, "negative": 0.5}, "twitter": {"positive": 0.4, ...}}
     */
    @Column(name = "platform_sentiment_comparison", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Map<String, Double>> platformSentimentComparison;

    // ========== 메타데이터 ==========

    /**
     * 분석에 사용된 Add-on
     */
    @Column(name = "analyzed_by", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> analyzedBy;

    /**
     * 마지막 크롤링 시점
     */
    @Column(name = "last_crawled_at")
    private LocalDateTime lastCrawledAt;

    /**
     * 생성일시
     */
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    /**
     * 마지막 업데이트
     */
    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    // ========== Helper Methods ==========

    public String getSentimentSummary() {
        if (sentimentDistribution == null) return "분석 대기 중";
        
        double negative = sentimentDistribution.getOrDefault("negative", 0.0);
        double positive = sentimentDistribution.getOrDefault("positive", 0.0);
        
        if (negative > 0.6) return "부정적 여론 우세";
        if (positive > 0.6) return "긍정적 여론 우세";
        if (Math.abs(negative - positive) < 0.1) return "여론 분분";
        return "중립적";
    }

    public boolean isControversial() {
        if (stanceDistribution == null) return false;
        double agree = stanceDistribution.getOrDefault("agree", 0.0);
        double disagree = stanceDistribution.getOrDefault("disagree", 0.0);
        return Math.abs(agree - disagree) < 0.2 && (agree + disagree) > 0.6;
    }

    public String getDiscussionHealthGrade() {
        if (discussionQualityScore == null) return "N/A";
        if (discussionQualityScore >= 70) return "양호";
        if (discussionQualityScore >= 40) return "보통";
        return "주의";
    }
}
