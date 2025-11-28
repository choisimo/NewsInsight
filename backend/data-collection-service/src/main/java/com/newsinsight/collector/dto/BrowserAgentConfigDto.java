package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.BrowserAgentConfig;
import com.newsinsight.collector.entity.BrowserAgentPolicy;

/**
 * DTO for browser agent configuration in API requests/responses.
 */
public record BrowserAgentConfigDto(
        Integer maxDepth,
        Integer maxPages,
        Integer budgetSeconds,
        String policy,
        String focusKeywords,
        String customPrompt,
        Boolean captureScreenshots,
        Boolean extractStructured,
        String excludedDomains
) {
    /**
     * Convert to entity.
     */
    public BrowserAgentConfig toEntity() {
        return BrowserAgentConfig.builder()
                .maxDepth(maxDepth != null ? maxDepth : 2)
                .maxPages(maxPages != null ? maxPages : 50)
                .budgetSeconds(budgetSeconds != null ? budgetSeconds : 300)
                .policy(policy != null ? BrowserAgentPolicy.fromValue(policy) : BrowserAgentPolicy.FOCUSED_TOPIC)
                .focusKeywords(focusKeywords)
                .customPrompt(customPrompt)
                .captureScreenshots(captureScreenshots != null ? captureScreenshots : false)
                .extractStructured(extractStructured != null ? extractStructured : true)
                .excludedDomains(excludedDomains)
                .build();
    }

    /**
     * Create from entity.
     */
    public static BrowserAgentConfigDto fromEntity(BrowserAgentConfig config) {
        if (config == null) {
            return null;
        }
        return new BrowserAgentConfigDto(
                config.getMaxDepth(),
                config.getMaxPages(),
                config.getBudgetSeconds(),
                config.getPolicy() != null ? config.getPolicy().getValue() : null,
                config.getFocusKeywords(),
                config.getCustomPrompt(),
                config.getCaptureScreenshots(),
                config.getExtractStructured(),
                config.getExcludedDomains()
        );
    }
}
