package com.newsinsight.collector.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public record ArticleDto(
        String id,
        String title,
        String source,
        @JsonProperty("published_at") String publishedAt,
        String url,
        String snippet,
        String content  // 전체 본문 (export/저장용)
) {}
