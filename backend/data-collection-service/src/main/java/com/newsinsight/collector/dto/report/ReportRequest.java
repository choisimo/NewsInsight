package com.newsinsight.collector.dto.report;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * PDF 보고서 생성 요청 DTO
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ReportRequest {

    /**
     * 보고서 유형: UNIFIED_SEARCH, DEEP_SEARCH, ML_ANALYSIS
     */
    private ReportType reportType;

    /**
     * 관련 Job ID 또는 Article ID
     */
    private String targetId;

    /**
     * 검색 쿼리 (통합검색, DeepSearch용)
     */
    private String query;

    /**
     * 시간 범위 (1d, 7d, 30d)
     */
    private String timeWindow;

    /**
     * 포함할 섹션 목록
     */
    @Builder.Default
    private List<ReportSection> includeSections = List.of(ReportSection.values());

    /**
     * 프론트엔드에서 생성한 차트 이미지 (Base64)
     */
    private Map<String, String> chartImages;

    /**
     * 보고서 제목 (커스텀)
     */
    private String customTitle;

    /**
     * 회사 로고 URL 또는 Base64
     */
    private String logoImage;

    /**
     * 워터마크 텍스트
     */
    private String watermark;

    /**
     * 언어 설정 (ko, en)
     */
    @Builder.Default
    private String language = "ko";

    /**
     * 보고서 유형 Enum
     */
    public enum ReportType {
        UNIFIED_SEARCH,
        DEEP_SEARCH,
        ML_ANALYSIS,
        ARTICLE_DETAIL
    }

    /**
     * 보고서 섹션 Enum
     */
    public enum ReportSection {
        COVER,              // 표지
        EXECUTIVE_SUMMARY,  // 요약
        DATA_SOURCE,        // 데이터 소스 분석
        TREND_ANALYSIS,     // 시간별 트렌드
        KEYWORD_ANALYSIS,   // 키워드 분석
        SENTIMENT_ANALYSIS, // 감정 분석
        RELIABILITY,        // 신뢰도 분석
        BIAS_ANALYSIS,      // 편향성 분석
        FACTCHECK,          // 팩트체크
        EVIDENCE_LIST,      // 증거 목록
        DETAILED_RESULTS    // 상세 결과
    }
}
