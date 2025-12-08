package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Response DTO for claim extraction
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ClaimExtractionResponse {
    
    /** The URL that was analyzed */
    private String url;
    
    /** Title of the page */
    private String pageTitle;
    
    /** List of extracted claims */
    private List<ExtractedClaim> claims;
    
    /** Processing time in milliseconds */
    private Long processingTimeMs;
    
    /** Source of extraction (e.g., "crawl4ai", "direct", "browser-use") */
    private String extractionSource;
    
    /** Any warning or info messages */
    private String message;
    
    /**
     * Individual claim extracted from the content
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ExtractedClaim {
        /** Unique identifier for the claim */
        private String id;
        
        /** The claim text */
        private String text;
        
        /** Confidence score (0.0 - 1.0) */
        private Double confidence;
        
        /** Context where the claim was found */
        private String context;
        
        /** Type of claim: factual, opinion, prediction, etc. */
        private String claimType;
        
        /** Whether this claim is verifiable */
        private Boolean verifiable;
    }
}
