package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.SourceType;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.Map;

public record DataSourceCreateRequest(
        @NotBlank(message = "Name is required") String name,
        @NotBlank(message = "URL is required") String url,
        @NotNull(message = "Source type is required") SourceType sourceType,
        @Min(value = 60, message = "Collection frequency must be at least 60 seconds") Integer collectionFrequency,
        Map<String, Object> metadata,
        BrowserAgentConfigDto browserAgentConfig
) {
    public DataSourceCreateRequest {
        collectionFrequency = collectionFrequency == null ? 3600 : collectionFrequency;
        metadata = metadata == null ? Map.of() : Map.copyOf(metadata);
    }
}
