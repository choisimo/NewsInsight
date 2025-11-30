package com.newsinsight.collector.dto.addon;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * Add-on이 반환하는 분석 결과 DTO.
 * 
 * 모든 Add-on은 이 형식으로 결과를 반환.
 * Orchestrator가 이를 파싱하여 ArticleAnalysis/ArticleDiscussion에 저장.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AddonResponse {

    /**
     * 요청 ID (추적용)
     */
    @JsonProperty("request_id")
    private String requestId;

    /**
     * Add-on 식별자
     */
    @JsonProperty("addon_id")
    private String addonId;

    /**
     * 처리 상태 (success, error, partial)
     */
    private String status;

    /**
     * 출력 스키마 버전
     */
    @JsonProperty("output_schema_version")
    @Builder.Default
    private String outputSchemaVersion = "1.0";

    /**
     * 분석 결과 (Add-on 카테고리별로 다른 구조)
     */
    private AnalysisResults results;

    /**
     * 에러 정보 (실패 시)
     */
    private ErrorInfo error;

    /**
     * 메타데이터
     */
    private ResponseMeta meta;

    // ========== 결과 구조 ==========

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AnalysisResults {

        // === 감정 분석 (SENTIMENT) ===
        @JsonProperty("sentiment")
        private SentimentResult sentiment;

        // === 신뢰도 분석 (SOURCE_QUALITY) ===
        @JsonProperty("reliability")
        private ReliabilityResult reliability;

        // === 편향도 분석 ===
        @JsonProperty("bias")
        private BiasResult bias;

        // === 팩트체크 (FACTCHECK) ===
        @JsonProperty("factcheck")
        private FactcheckResult factcheck;

        // === 개체명 인식 (ENTITY_EXTRACTION) ===
        @JsonProperty("entities")
        private EntitiesResult entities;

        // === 요약 (SUMMARIZATION) ===
        @JsonProperty("summary")
        private SummaryResult summary;

        // === 주제 분류 (TOPIC_CLASSIFICATION) ===
        @JsonProperty("topics")
        private TopicsResult topics;

        // === 커뮤니티 분석 (COMMUNITY) ===
        @JsonProperty("discussion")
        private DiscussionResult discussion;

        // === 독성 분석 (TOXICITY) ===
        @JsonProperty("toxicity")
        private ToxicityResult toxicity;

        // === 허위정보 탐지 (MISINFORMATION) ===
        @JsonProperty("misinformation")
        private MisinfoResult misinformation;

        // === 원시 결과 (구조화되지 않은 추가 데이터) ===
        @JsonProperty("raw")
        private Map<String, Object> raw;
    }

    // ========== 개별 결과 타입들 ==========

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SentimentResult {
        private Double score; // -1 ~ 1 or 0 ~ 100
        private String label; // positive, negative, neutral
        private Map<String, Double> distribution;
        private Map<String, Double> emotions; // anger, joy, sadness, etc.
        private List<String> explanations;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ReliabilityResult {
        private Double score; // 0 ~ 100
        private String grade; // high, medium, low
        private Map<String, Double> factors;
        private List<String> warnings;
        private List<String> explanations;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class BiasResult {
        private String label; // left, right, center
        private Double score; // -1 ~ 1
        private Map<String, Double> details;
        private List<String> explanations;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class FactcheckResult {
        private String status; // verified, suspicious, conflicting, unverified
        private Double confidence;
        private List<ClaimVerification> claims;
        private List<String> sources;
        private String notes;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ClaimVerification {
        private String claim;
        private Boolean verified;
        private Double confidence;
        private List<String> supportingSources;
        private List<String> conflictingSources;
        private String verdict;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class EntitiesResult {
        private List<Entity> persons;
        private List<Entity> organizations;
        private List<Entity> locations;
        private List<Entity> misc;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Entity {
        private String text;
        private String type;
        private Integer startPos;
        private Integer endPos;
        private Double confidence;
        private Map<String, Object> metadata;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SummaryResult {
        @JsonProperty("abstractive")
        private String abstractiveSummary;
        @JsonProperty("extractive")
        private List<String> extractiveSentences;
        private List<String> keyPoints;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TopicsResult {
        private List<String> labels;
        private Map<String, Double> scores;
        private String primaryTopic;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DiscussionResult {
        @JsonProperty("overall_sentiment")
        private String overallSentiment;
        @JsonProperty("sentiment_distribution")
        private Map<String, Double> sentimentDistribution;
        @JsonProperty("stance_distribution")
        private Map<String, Double> stanceDistribution;
        @JsonProperty("toxicity_score")
        private Double toxicityScore;
        @JsonProperty("top_keywords")
        private List<Map<String, Object>> topKeywords;
        @JsonProperty("time_series")
        private List<Map<String, Object>> timeSeries;
        @JsonProperty("bot_likelihood")
        private Double botLikelihood;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ToxicityResult {
        private Double score;
        private Map<String, Double> categories; // hate, threat, insult, etc.
        private List<String> flaggedPhrases;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class MisinfoResult {
        @JsonProperty("risk_level")
        private String riskLevel; // low, mid, high
        private Double score;
        private List<String> indicators;
        private List<String> explanations;
    }

    // ========== 에러/메타 ==========

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ErrorInfo {
        private String code;
        private String message;
        private String details;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ResponseMeta {
        @JsonProperty("model_version")
        private String modelVersion;

        @JsonProperty("latency_ms")
        private Long latencyMs;

        @JsonProperty("processed_at")
        private String processedAt;

        @JsonProperty("token_usage")
        private Map<String, Integer> tokenUsage;
    }
}
