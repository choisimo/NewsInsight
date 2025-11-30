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
 * 기사 분석 결과 엔티티.
 * 
 * 각종 ML Add-on의 분석 결과를 통합 저장.
 * 감정 분석, 신뢰도, 편향도, 팩트체크 결과 등을 한 곳에서 조회 가능.
 */
@Entity
@Table(name = "article_analysis", indexes = {
    @Index(name = "idx_analysis_article_id", columnList = "article_id"),
    @Index(name = "idx_analysis_reliability", columnList = "reliability_score"),
    @Index(name = "idx_analysis_sentiment", columnList = "sentiment_label"),
    @Index(name = "idx_analysis_bias", columnList = "bias_label"),
    @Index(name = "idx_analysis_misinfo", columnList = "misinfo_risk"),
    @Index(name = "idx_analysis_updated", columnList = "updated_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ArticleAnalysis {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 분석 대상 기사 ID (collected_data.id와 연결)
     */
    @Column(name = "article_id", nullable = false, unique = true)
    private Long articleId;

    // ========== 요약 ==========

    /**
     * AI 생성 요약
     */
    @Column(name = "summary", columnDefinition = "TEXT")
    private String summary;

    /**
     * 핵심 문장 (추출 요약)
     */
    @Column(name = "key_sentences", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> keySentences;

    // ========== 감정 분석 ==========

    /**
     * 감정 점수 (-1.0 ~ 1.0 또는 0 ~ 100)
     * -1 = 매우 부정, 0 = 중립, 1 = 매우 긍정
     */
    @Column(name = "sentiment_score")
    private Double sentimentScore;

    /**
     * 감정 레이블 (positive, negative, neutral)
     */
    @Column(name = "sentiment_label", length = 20)
    private String sentimentLabel;

    /**
     * 감정 분포 (긍정/부정/중립 비율)
     * {"positive": 0.2, "negative": 0.7, "neutral": 0.1}
     */
    @Column(name = "sentiment_distribution", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Double> sentimentDistribution;

    /**
     * 톤 분석 (보도형 vs 의견형)
     * {"factual": 0.8, "opinion": 0.2}
     */
    @Column(name = "tone_analysis", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Double> toneAnalysis;

    // ========== 편향도 분석 ==========

    /**
     * 편향 레이블 (left, right, center, pro_government, pro_corporate 등)
     */
    @Column(name = "bias_label", length = 50)
    private String biasLabel;

    /**
     * 편향 점수 (-1.0 ~ 1.0)
     * -1 = 극좌, 0 = 중립, 1 = 극우 (정치적 스펙트럼)
     */
    @Column(name = "bias_score")
    private Double biasScore;

    /**
     * 편향 세부 분석
     * {"political_left": 0.3, "pro_government": 0.2, ...}
     */
    @Column(name = "bias_details", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Double> biasDetails;

    // ========== 신뢰도 분석 ==========

    /**
     * 신뢰도 점수 (0 ~ 100)
     */
    @Column(name = "reliability_score")
    private Double reliabilityScore;

    /**
     * 신뢰도 등급 (high, medium, low)
     */
    @Column(name = "reliability_grade", length = 20)
    private String reliabilityGrade;

    /**
     * 신뢰도 요인 분석
     * {"source_reputation": 0.8, "citation_quality": 0.6, "consistency": 0.7}
     */
    @Column(name = "reliability_factors", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Double> reliabilityFactors;

    // ========== 허위정보/팩트체크 ==========

    /**
     * 허위정보 위험도 (low, mid, high)
     */
    @Column(name = "misinfo_risk", length = 20)
    private String misinfoRisk;

    /**
     * 허위정보 점수 (0 ~ 1)
     */
    @Column(name = "misinfo_score")
    private Double misinfoScore;

    /**
     * 팩트체크 상태 (verified, suspicious, conflicting, unverified)
     */
    @Column(name = "factcheck_status", length = 30)
    private String factcheckStatus;

    /**
     * 팩트체크 상세 노트/근거
     */
    @Column(name = "factcheck_notes", columnDefinition = "TEXT")
    private String factcheckNotes;

    /**
     * 검증된 주장들
     * [{"claim": "...", "verified": true, "sources": [...]}]
     */
    @Column(name = "verified_claims", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> verifiedClaims;

    // ========== 주제/토픽 ==========

    /**
     * 주요 토픽/카테고리
     * ["정치", "외교", "북한"]
     */
    @Column(name = "topics", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> topics;

    /**
     * 토픽별 연관도
     * {"정치": 0.9, "외교": 0.7, "북한": 0.5}
     */
    @Column(name = "topic_scores", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Double> topicScores;

    // ========== 개체명 인식 (NER) ==========

    /**
     * 추출된 인물
     * [{"name": "홍길동", "role": "장관", "sentiment": "neutral"}]
     */
    @Column(name = "entities_person", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> entitiesPerson;

    /**
     * 추출된 기관/조직
     */
    @Column(name = "entities_org", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> entitiesOrg;

    /**
     * 추출된 장소/지역
     */
    @Column(name = "entities_location", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> entitiesLocation;

    /**
     * 기타 개체 (날짜, 금액, 수치 등)
     */
    @Column(name = "entities_misc", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> entitiesMisc;

    // ========== 위험 태그 ==========

    /**
     * 위험 태그 목록
     * ["clickbait", "sensational", "unverified_source"]
     */
    @Column(name = "risk_tags", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> riskTags;

    /**
     * 독성/혐오 점수 (0 ~ 1)
     */
    @Column(name = "toxicity_score")
    private Double toxicityScore;

    /**
     * 선정성 점수 (0 ~ 1)
     */
    @Column(name = "sensationalism_score")
    private Double sensationalismScore;

    // ========== 분석 메타데이터 ==========

    /**
     * 분석에 사용된 Add-on 목록
     * ["sentiment-v1", "factcheck-v2", "ner-korean-v1"]
     */
    @Column(name = "analyzed_by", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> analyzedBy;

    /**
     * 분석 완료 상태
     * {"sentiment": true, "factcheck": false, "ner": true}
     */
    @Column(name = "analysis_status", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Boolean> analysisStatus;

    /**
     * 전체 분석 완료 여부
     */
    @Column(name = "fully_analyzed")
    @Builder.Default
    private Boolean fullyAnalyzed = false;

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

    public String getReliabilityColor() {
        if (reliabilityScore == null) return "gray";
        if (reliabilityScore >= 70) return "green";
        if (reliabilityScore >= 40) return "yellow";
        return "red";
    }

    public String getSentimentEmoji() {
        if (sentimentLabel == null) return "⚪";
        return switch (sentimentLabel.toLowerCase()) {
            case "positive" -> "😊";
            case "negative" -> "😠";
            default -> "😐";
        };
    }

    public boolean needsFactCheck() {
        return misinfoRisk != null && 
               (misinfoRisk.equals("high") || misinfoRisk.equals("mid"));
    }
}
