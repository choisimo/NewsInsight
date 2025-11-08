package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.SourceType;

import java.time.LocalDateTime;
import java.util.Map;

public record DataSourceDTO(
        Long id,
        String name,
        String url,
        SourceType sourceType,
        Boolean isActive,
        LocalDateTime lastCollected,
        Integer collectionFrequency,
        Map<String, Object> metadata,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
    public DataSourceDTO {
        metadata = metadata == null ? Map.of() : Map.copyOf(metadata);
    }
}
