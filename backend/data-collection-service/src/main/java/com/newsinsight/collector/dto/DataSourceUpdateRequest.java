package com.newsinsight.collector.dto;

import jakarta.validation.constraints.Min;

import java.util.Map;

public record DataSourceUpdateRequest(
        String name,
        String url,
        Boolean isActive,
        @Min(value = 60, message = "Collection frequency must be at least 60 seconds") Integer collectionFrequency,
        Map<String, Object> metadata,
        BrowserAgentConfigDto browserAgentConfig
) {
    public DataSourceUpdateRequest {
        metadata = metadata == null ? Map.of() : Map.copyOf(metadata);
    }
}
