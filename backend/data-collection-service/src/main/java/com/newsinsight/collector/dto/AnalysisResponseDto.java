package com.newsinsight.collector.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

public record AnalysisResponseDto(
        String query,
        String window,
        @JsonProperty("article_count") long articleCount,
        SentimentDataDto sentiments,
        @JsonProperty("top_keywords") List<KeywordDataDto> topKeywords,
        @JsonProperty("analyzed_at") String analyzedAt
) {}
