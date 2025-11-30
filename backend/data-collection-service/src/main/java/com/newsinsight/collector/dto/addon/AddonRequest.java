package com.newsinsight.collector.dto.addon;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/**
 * Add-on으로 보내는 분석 요청 DTO.
 * 
 * 모든 Add-on은 이 형식의 요청을 받아서 처리.
 * 내부 서비스, 외부 Colab, 서드파티 API 모두 동일한 스펙 사용.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AddonRequest {

    /**
     * 요청 고유 ID (추적용)
     */
    @JsonProperty("request_id")
    private String requestId;

    /**
     * Add-on 식별자
     */
    @JsonProperty("addon_id")
    private String addonId;

    /**
     * 작업 유형 (article_analysis, comment_analysis, batch_analysis 등)
     */
    @JsonProperty("task")
    private String task;

    /**
     * 입력 스키마 버전
     */
    @JsonProperty("input_schema_version")
    @Builder.Default
    private String inputSchemaVersion = "1.0";

    /**
     * 분석 대상 기사 정보
     */
    @JsonProperty("article")
    private ArticleInput article;

    /**
     * 분석 대상 댓글/커뮤니티 (해당되는 경우)
     */
    @JsonProperty("comments")
    private CommentsInput comments;

    /**
     * 추가 컨텍스트 (언어, 국가, 이전 분석 결과 등)
     */
    @JsonProperty("context")
    private AnalysisContext context;

    /**
     * 실행 옵션
     */
    @JsonProperty("options")
    private ExecutionOptions options;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ArticleInput {
        /**
         * 기사 ID
         */
        private Long id;

        /**
         * 기사 제목
         */
        private String title;

        /**
         * 기사 본문
         */
        private String content;

        /**
         * 기사 URL
         */
        private String url;

        /**
         * 출처/언론사
         */
        private String source;

        /**
         * 발행일시 (ISO 8601)
         */
        @JsonProperty("published_at")
        private String publishedAt;

        /**
         * 추가 메타데이터
         */
        private Map<String, Object> metadata;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class CommentsInput {
        /**
         * 대상 기사 ID
         */
        @JsonProperty("article_id")
        private Long articleId;

        /**
         * 댓글 목록
         */
        private java.util.List<CommentItem> items;

        /**
         * 수집 플랫폼
         */
        private String platform;

        @Data
        @Builder
        @NoArgsConstructor
        @AllArgsConstructor
        public static class CommentItem {
            private String id;
            private String content;
            @JsonProperty("created_at")
            private String createdAt;
            private Integer likes;
            private Integer replies;
            @JsonProperty("author_id")
            private String authorId;
        }
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AnalysisContext {
        /**
         * 언어 코드 (ko, en, ja 등)
         */
        private String language;

        /**
         * 국가 코드
         */
        private String country;

        /**
         * 이전 Add-on들의 분석 결과 (의존성 체인에서 사용)
         */
        @JsonProperty("previous_results")
        private Map<String, Object> previousResults;

        /**
         * 관련 기사 ID들 (교차 검증용)
         */
        @JsonProperty("related_article_ids")
        private java.util.List<Long> relatedArticleIds;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ExecutionOptions {
        /**
         * 중요도 (realtime: 즉시 처리, batch: 배치 처리)
         */
        @Builder.Default
        private String importance = "batch";

        /**
         * 디버그 모드 (상세 로그 포함)
         */
        @Builder.Default
        private Boolean debug = false;

        /**
         * 타임아웃 (ms)
         */
        @JsonProperty("timeout_ms")
        private Integer timeoutMs;

        /**
         * 추가 파라미터
         */
        private Map<String, Object> params;
    }
}
