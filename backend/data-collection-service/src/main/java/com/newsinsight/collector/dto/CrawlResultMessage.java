package com.newsinsight.collector.dto;

public record CrawlResultMessage(
        Long jobId,
        Long sourceId,
        String title,
        String content,
        String url,
        String publishedAt,
        String metadataJson
) {
}
