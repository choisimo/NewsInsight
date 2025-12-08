package com.newsinsight.collector.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for extracting claims from a URL
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ClaimExtractionRequest {
    
    @NotBlank(message = "URL is required")
    private String url;
    
    /** Optional: Maximum number of claims to extract */
    private Integer maxClaims;
    
    /** Optional: Minimum confidence threshold (0.0 - 1.0) */
    private Double minConfidence;
}
