package com.newsinsight.collector.service;

import com.newsinsight.collector.dto.AiRequestMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class AiMessagingService {

    private final KafkaTemplate<String, AiRequestMessage> aiRequestKafkaTemplate;

    @Value("${collector.ai.topic.request:newsinsight.ai.requests}")
    private String requestTopic;

    @Value("${collector.ai.default-provider-id:openai}")
    private String defaultProviderId;

    @Value("${collector.ai.default-model-id:gpt-4.1}")
    private String defaultModelId;

    public String sendAnalysisRequest(String query, String window, String message, Map<String, Object> context) {
        String requestId = UUID.randomUUID().toString();
        String type = "ARTICLE_ANALYSIS";
        String effectiveWindow = (window == null || window.isBlank()) ? "7d" : window;
        AiRequestMessage payload = new AiRequestMessage(
                requestId,
                type,
                query,
                effectiveWindow,
                message,
                context,
                defaultProviderId,
                defaultModelId
        );
        aiRequestKafkaTemplate.send(requestTopic, requestId, payload);
        log.info("Sent AI analysis request {} to topic {} at {}", requestId, requestTopic, OffsetDateTime.now());
        return requestId;
    }
}
