package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * 검색 결과 페이지 전체 요약 DTO.
 * 
 * 검색 결과 상단에 표시되는 종합 분석 정보.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchResultSummaryDto {

    /**
     * 총 검색 결과 수
     */
    private Integer totalResults;

    /**
     * 분석 완료된 결과 수
     */
    private Integer analyzedResults;

    // ========== 주제 요약 ==========
    
    /**
     * 주요 키워드/토픽 (상위 5개)
     */
    private List<String> mainTopics;

    /**
     * AI 생성 이슈 요약 (1-2문장)
     */
    private String issueSummary;

    /**
     * 상반된 관점 요약
     * [{"view": "찬성측", "summary": "..."}, {"view": "반대측", "summary": "..."}]
     */
    private List<Map<String, String>> contrastingViews;

    // ========== 신뢰도/편향 요약 ==========

    /**
     * 신뢰도 분포
     * {"high": 0.3, "medium": 0.5, "low": 0.2}
     */
    private Map<String, Double> reliabilityDistribution;

    /**
     * 편향도 분포
     * {"left": 0.2, "center": 0.6, "right": 0.2}
     */
    private Map<String, Double> biasDistribution;

    /**
     * 허위정보 위험 기사 비율
     */
    private Double misinfoRiskRatio;

    // ========== 감정 요약 ==========

    /**
     * 전체 기사 감정 분포
     */
    private Map<String, Double> overallSentiment;

    // ========== 여론 요약 ==========

    /**
     * 전체 댓글 수 합계
     */
    private Integer totalCommentCount;

    /**
     * 전체 여론 감정 분포
     */
    private Map<String, Double> overallDiscussionSentiment;

    /**
     * 여론 요약 문장
     */
    private String discussionSummary;

    /**
     * 시간대별 여론 변화 (그래프용)
     */
    private List<Map<String, Object>> discussionTimeSeries;

    // ========== 경고/주의 ==========

    /**
     * 검색 결과 관련 경고 메시지
     */
    private List<String> warnings;

    /**
     * 팩트체크 필요 기사 수
     */
    private Integer factcheckNeededCount;
}
