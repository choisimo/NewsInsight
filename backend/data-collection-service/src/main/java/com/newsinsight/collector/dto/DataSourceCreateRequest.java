package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.SourceType;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DataSourceCreateRequest {
    
    @NotBlank(message = "Name is required")
    private String name;
    
    @NotBlank(message = "URL is required")
    private String url;
    
    @NotNull(message = "Source type is required")
    private SourceType sourceType;
    
    @Min(value = 60, message = "Collection frequency must be at least 60 seconds")
    @Builder.Default
    private Integer collectionFrequency = 3600;
    
    private Map<String, Object> metadata;
}
