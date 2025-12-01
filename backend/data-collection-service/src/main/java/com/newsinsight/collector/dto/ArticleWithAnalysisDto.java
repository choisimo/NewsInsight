package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.analysis.ArticleAnalysis;
import com.newsinsight.collector.entity.analysis.ArticleDiscussion;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 검색 결과에 분석 정보를 포함한 DTO.
 * 
 * 프론트엔드가 검색 결과를 표시할 때 사용.
 * 분석이 완료되지 않은 경우 null로 표시하여 skeleton UI 렌더링 유도.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ArticleWithAnalysisDto {

    // ========== 기본 기사 정보 ==========
    private Long id;
    private String title;
    private String content;
    private String url;
    private String source;
    private LocalDateTime publishedDate;
    private LocalDateTime collectedAt;

    // ========== 분석 상태 ==========
    /**
     * 분석 완료 여부 (true면 analysis 필드 사용 가능)
     */
    private Boolean analyzed;
    
    /**
     * 분석 진행 상태 (pending, partial, complete)
     */
    private String analysisStatus;

    // ========== 요약 정보 (간략 표시용) ==========
    /**
     * AI 생성 요약 (1-2문장)
     */
    private String summary;

    // ========== 신뢰도 배지 ==========
    /**
     * 신뢰도 점수 (0-100)
     */
    private Double reliabilityScore;
    
    /**
     * 신뢰도 등급 (high, medium, low)
     */
    private String reliabilityGrade;
    
    /**
     * 신뢰도 색상 코드 (green, yellow, red)
     */
    private String reliabilityColor;

    // ========== 감정 분석 ==========
    /**
     * 감정 레이블 (positive, negative, neutral)
     */
    private String sentimentLabel;
    
    /**
     * 감정 점수 (-1 ~ 1)
     */
    private Double sentimentScore;
    
    /**
     * 감정 분포 (긍정/부정/중립 비율)
     */
    private Map<String, Double> sentimentDistribution;

    // ========== 편향도 ==========
    /**
     * 편향 레이블 (left, right, center 등)
     */
    private String biasLabel;
    
    /**
     * 편향 점수 (-1 ~ 1)
     */
    private Double biasScore;

    // ========== 팩트체크 ==========
    /**
     * 팩트체크 상태 (verified, suspicious, conflicting, unverified)
     */
    private String factcheckStatus;
    
    /**
     * 허위정보 위험도 (low, mid, high)
     */
    private String misinfoRisk;

    // ========== 위험 태그 ==========
    /**
     * 경고 태그 목록 (clickbait, sensational 등)
     */
    private List<String> riskTags;

    // ========== 토픽/키워드 ==========
    /**
     * 주요 토픽
     */
    private List<String> topics;

    // ========== 커뮤니티 여론 요약 ==========
    /**
     * 여론 있음 여부
     */
    private Boolean hasDiscussion;
    
    /**
     * 전체 댓글 수
     */
    private Integer totalCommentCount;
    
    /**
     * 전체 여론 감정 (positive, negative, neutral, mixed)
     */
    private String discussionSentiment;
    
    /**
     * 여론 감정 분포
     */
    private Map<String, Double> discussionSentimentDistribution;
    
    /**
     * 여론 요약 문장
     */
    private String discussionSummary;

    // ========== 정적 팩토리 메서드 ==========

    /**
     * 분석 결과가 없는 기사용
     */
    public static ArticleWithAnalysisDto fromArticleOnly(
            Long id, String title, String content, String url, 
            String source, LocalDateTime publishedDate, LocalDateTime collectedAt
    ) {
        return ArticleWithAnalysisDto.builder()
                .id(id)
                .title(title)
                .content(content)
                .url(url)
                .source(source)
                .publishedDate(publishedDate)
                .collectedAt(collectedAt)
                .analyzed(false)
                .analysisStatus("pending")
                .build();
    }

    /**
     * 분석 결과 포함
     */
    public static ArticleWithAnalysisDto fromArticleWithAnalysis(
            Long id, String title, String content, String url,
            String source, LocalDateTime publishedDate, LocalDateTime collectedAt,
            ArticleAnalysis analysis, ArticleDiscussion discussion
    ) {
        ArticleWithAnalysisDtoBuilder builder = ArticleWithAnalysisDto.builder()
                .id(id)
                .title(title)
                .content(content)
                .url(url)
                .source(source)
                .publishedDate(publishedDate)
                .collectedAt(collectedAt);

        if (analysis != null) {
            builder.analyzed(true)
                    .analysisStatus(analysis.getFullyAnalyzed() ? "complete" : "partial")
                    .summary(analysis.getSummary())
                    .reliabilityScore(analysis.getReliabilityScore())
                    .reliabilityGrade(analysis.getReliabilityGrade())
                    .reliabilityColor(analysis.getReliabilityColor())
                    .sentimentLabel(analysis.getSentimentLabel())
                    .sentimentScore(analysis.getSentimentScore())
                    .sentimentDistribution(analysis.getSentimentDistribution())
                    .biasLabel(analysis.getBiasLabel())
                    .biasScore(analysis.getBiasScore())
                    .factcheckStatus(analysis.getFactcheckStatus())
                    .misinfoRisk(analysis.getMisinfoRisk())
                    .riskTags(analysis.getRiskTags())
                    .topics(analysis.getTopics());
        } else {
            builder.analyzed(false)
                    .analysisStatus("pending");
        }

        if (discussion != null) {
            builder.hasDiscussion(true)
                    .totalCommentCount(discussion.getTotalCommentCount())
                    .discussionSentiment(discussion.getOverallSentiment())
                    .discussionSentimentDistribution(discussion.getSentimentDistribution())
                    .discussionSummary(discussion.getSentimentSummary());
        } else {
            builder.hasDiscussion(false);
        }

        return builder.build();
    }
}
