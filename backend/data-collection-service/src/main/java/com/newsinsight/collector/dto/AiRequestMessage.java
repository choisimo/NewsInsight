package com.newsinsight.collector.dto;

import java.util.Map;

public record AiRequestMessage(
        String requestId,
        String type,
        String query,
        String window,
        String message,
        Map<String, Object> context,
        String providerId,
        String modelId
) {
}
