package com.newsinsight.collector.dto;

public record CrawlCommandMessage(
        Long jobId,
        Long sourceId,
        String sourceType,
        String url,
        String sourceName
) {
}
