package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.SourceType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DataSourceDTO {
    private Long id;
    private String name;
    private String url;
    private SourceType sourceType;
    private Boolean isActive;
    private LocalDateTime lastCollected;
    private Integer collectionFrequency;
    private Map<String, Object> metadata;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
