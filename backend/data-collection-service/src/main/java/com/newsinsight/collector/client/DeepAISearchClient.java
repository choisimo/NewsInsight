package com.newsinsight.collector.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.Map;

/**
 * DeepAISearchClient SDK for n8n Crawl Agent Workflow.
 * 
 * This client triggers an AI-powered web crawling workflow that:
 * 1. Discovers relevant pages from a base URL
 * 2. Extracts and analyzes content
 * 3. Classifies evidence as pro/con/neutral
 * 4. Returns structured results via callback
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class DeepAISearchClient {

    private final WebClient webClient;
    private final ObjectMapper objectMapper;

    @Value("${collector.deep-search.enabled:true}")
    private boolean enabled;

    @Value("${collector.deep-search.webhook-url:${COLLECTOR_DEEP_SEARCH_WEBHOOK_URL:https://n8n.nodove.com/webhook/crawl-agent}}")
    private String webhookUrl;

    @Value("${collector.deep-search.callback-base-url:${COLLECTOR_CALLBACK_BASE_URL:http://collector-service:8081}}")
    private String callbackBaseUrl;

    @Value("${collector.deep-search.callback-token:}")
    private String callbackToken;

    @Value("${collector.deep-search.timeout-seconds:120}")
    private int timeoutSeconds;

    /**
     * Request payload for deep AI search
     */
    public record DeepSearchRequest(
            String jobId,
            String topic,
            String baseUrl,
            String callbackUrl,
            String callbackToken
    ) {}

    /**
     * Response from webhook trigger
     */
    public record DeepSearchTriggerResponse(
            boolean success,
            String jobId,
            String message
    ) {}

    /**
     * Evidence item returned from n8n workflow
     */
    public record Evidence(
            String url,
            String title,
            String stance,  // pro, con, neutral
            String snippet,
            String source
    ) {}

    /**
     * Callback payload received from n8n workflow
     */
    public record DeepSearchCallbackPayload(
            String jobId,
            String status,
            String topic,
            String baseUrl,
            java.util.List<Evidence> evidence
    ) {}

    /**
     * Check if deep search is enabled
     */
    public boolean isEnabled() {
        return enabled;
    }

    /**
     * Trigger a deep AI search for the given topic and base URL.
     * 
     * @param jobId Unique job identifier
     * @param topic Search topic/keyword
     * @param baseUrl Starting URL for crawling (optional, defaults to news aggregator)
     * @return Mono containing trigger response
     */
    public Mono<DeepSearchTriggerResponse> triggerSearch(String jobId, String topic, String baseUrl) {
        if (!enabled) {
            log.warn("DeepAISearchClient is disabled");
            return Mono.just(new DeepSearchTriggerResponse(false, jobId, "Deep search is disabled"));
        }

        if (topic == null || topic.isBlank()) {
            return Mono.just(new DeepSearchTriggerResponse(false, jobId, "Topic is required"));
        }

        // Default base URL for Korean news if not provided
        String effectiveBaseUrl = (baseUrl != null && !baseUrl.isBlank()) 
                ? baseUrl 
                : "https://news.google.com/search?q=" + encodeUrl(topic) + "&hl=ko&gl=KR";

        String callbackUrl = buildCallbackUrl();

        Map<String, Object> payload = Map.of(
                "job_id", jobId,
                "topic", topic,
                "base_url", effectiveBaseUrl,
                "callback_url", callbackUrl,
                "callback_token", callbackToken != null ? callbackToken : ""
        );

        log.info("Triggering deep AI search: jobId={}, topic={}, baseUrl={}", jobId, topic, effectiveBaseUrl);

        return webClient.post()
                .uri(webhookUrl)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(payload)
                .retrieve()
                .bodyToMono(String.class)
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .map(response -> {
                    log.debug("Deep search webhook response: {}", response);
                    return new DeepSearchTriggerResponse(true, jobId, "Search triggered successfully");
                })
                .onErrorResume(e -> {
                    log.error("Failed to trigger deep search for jobId={}: {}", jobId, e.getMessage());
                    return Mono.just(new DeepSearchTriggerResponse(false, jobId, "Failed to trigger: " + e.getMessage()));
                });
    }

    /**
     * Synchronous version of triggerSearch
     */
    public DeepSearchTriggerResponse triggerSearchSync(String jobId, String topic, String baseUrl) {
        return triggerSearch(jobId, topic, baseUrl).block();
    }

    /**
     * Parse callback payload from n8n webhook response
     */
    public DeepSearchCallbackPayload parseCallback(String json) {
        try {
            return objectMapper.readValue(json, DeepSearchCallbackPayload.class);
        } catch (Exception e) {
            log.error("Failed to parse callback payload: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Parse callback payload from Map
     */
    public DeepSearchCallbackPayload parseCallback(Map<String, Object> payload) {
        try {
            String json = objectMapper.writeValueAsString(payload);
            return parseCallback(json);
        } catch (Exception e) {
            log.error("Failed to convert callback payload: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Build the callback URL for n8n to call back
     */
    private String buildCallbackUrl() {
        String base = callbackBaseUrl.endsWith("/") 
                ? callbackBaseUrl.substring(0, callbackBaseUrl.length() - 1) 
                : callbackBaseUrl;
        return base + "/api/v1/analysis/deep/callback";
    }

    /**
     * URL encode a string
     */
    private String encodeUrl(String value) {
        try {
            return java.net.URLEncoder.encode(value, java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception e) {
            return value;
        }
    }

    /**
     * Get webhook URL (for testing/debugging)
     */
    public String getWebhookUrl() {
        return webhookUrl;
    }

    /**
     * Get callback base URL (for testing/debugging)
     */
    public String getCallbackBaseUrl() {
        return callbackBaseUrl;
    }
}
