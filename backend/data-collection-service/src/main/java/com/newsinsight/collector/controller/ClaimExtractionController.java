package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.ClaimExtractionRequest;
import com.newsinsight.collector.dto.ClaimExtractionResponse;
import com.newsinsight.collector.service.ClaimExtractionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Controller for claim extraction operations.
 * Extracts verifiable claims from URLs for fact-checking.
 */
@RestController
@RequestMapping("/api/v1/analysis")
@RequiredArgsConstructor
@Slf4j
public class ClaimExtractionController {

    private final ClaimExtractionService claimExtractionService;

    /**
     * Extract verifiable claims from a URL.
     * 
     * This endpoint:
     * 1. Crawls the given URL to extract page content
     * 2. Analyzes the content using AI to identify verifiable claims
     * 3. Returns structured claims with confidence scores
     * 
     * @param request The extraction request containing the URL
     * @return List of extracted claims with metadata
     */
    @PostMapping("/extract-claims")
    public ResponseEntity<ClaimExtractionResponse> extractClaims(
            @Valid @RequestBody ClaimExtractionRequest request
    ) {
        log.info("Received claim extraction request for URL: {}", request.getUrl());

        try {
            ClaimExtractionResponse response = claimExtractionService.extractClaims(request).block();
            
            if (response == null) {
                return ResponseEntity.internalServerError()
                        .body(ClaimExtractionResponse.builder()
                                .url(request.getUrl())
                                .message("추출 서비스 오류가 발생했습니다.")
                                .build());
            }

            log.info("Extracted {} claims from URL: {}", 
                    response.getClaims() != null ? response.getClaims().size() : 0, 
                    request.getUrl());

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("Claim extraction failed for URL: {}", request.getUrl(), e);
            return ResponseEntity.internalServerError()
                    .body(ClaimExtractionResponse.builder()
                            .url(request.getUrl())
                            .message("주장 추출 실패: " + e.getMessage())
                            .build());
        }
    }

    /**
     * Health check for claim extraction service.
     */
    @GetMapping("/extract-claims/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        return ResponseEntity.ok(Map.of(
                "service", "ClaimExtractionService",
                "status", "READY"
        ));
    }
}
