package com.newsinsight.collector.dto;

import jakarta.validation.constraints.Min;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DataSourceUpdateRequest {
    private String name;
    private String url;
    private Boolean isActive;
    
    @Min(value = 60, message = "Collection frequency must be at least 60 seconds")
    private Integer collectionFrequency;
    
    private Map<String, Object> metadata;
}
