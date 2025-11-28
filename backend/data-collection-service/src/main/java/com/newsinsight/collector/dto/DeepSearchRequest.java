package com.newsinsight.collector.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for starting a deep search
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DeepSearchRequest {
    
    @NotBlank(message = "Topic is required")
    private String topic;
    
    /**
     * Optional base URL to start crawling from.
     * If not provided, a default news aggregator will be used.
     */
    private String baseUrl;
}
