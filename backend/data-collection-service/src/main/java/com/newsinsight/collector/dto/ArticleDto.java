package com.newsinsight.collector.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public record ArticleDto(
        String id,
        String title,
        String source,
        @JsonProperty("published_at") String publishedAt,
        String url,
        String snippet
) {}
