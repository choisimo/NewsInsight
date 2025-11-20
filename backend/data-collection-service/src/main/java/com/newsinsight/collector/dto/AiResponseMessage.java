package com.newsinsight.collector.dto;

import java.util.Map;

public record AiResponseMessage(
        String requestId,
        String status,
        String completedAt,
        String providerId,
        String modelId,
        String text,
        Map<String, Object> raw
) {
}
