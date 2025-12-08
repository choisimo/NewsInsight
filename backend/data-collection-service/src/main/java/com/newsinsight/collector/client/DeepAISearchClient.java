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
 * DeepAISearchClient SDK for external webhook-based crawling workflows.
 * 
 * @deprecated This client was used for n8n webhook integration which is now deprecated.
 *             DeepSearch now uses IntegratedCrawlerService for all crawling operations.
 *             This class is kept for backward compatibility but is disabled by default.
 *             
 *             Migration notes:
 *             - Set collector.deep-search.enabled=false (default)
 *             - Use IntegratedCrawlerService instead
 *             - This class may be removed in a future version
 * 
 * @see com.newsinsight.collector.service.IntegratedCrawlerService
 */
@Deprecated(since = "2.0.0", forRemoval = true)
@Component
@RequiredArgsConstructor
@Slf4j
public class DeepAISearchClient {

    private final WebClient webClient;
    private final ObjectMapper objectMapper;

    @Value("${collector.deep-search.enabled:false}")
    private boolean enabled;

    @Value("${collector.deep-search.webhook-url:}")
    private String webhookUrl;

    @Value("${collector.deep-search.callback-base-url:http://collector-service:8081}")
    private String callbackBaseUrl;

    @Value("${collector.deep-search.callback-token:}")
    private String callbackToken;

    @Value("${collector.deep-search.timeout-seconds:120}")
    private int timeoutSeconds;

    /**
     * Request payload for deep AI search
     * @deprecated Use IntegratedCrawlerService.CrawlRequest instead
     */
    @Deprecated
    public record DeepSearchRequest(
            String jobId,
            String topic,
            String baseUrl,
            String callbackUrl,
            String callbackToken
    ) {}

    /**
     * Response from webhook trigger
     * @deprecated Use IntegratedCrawlerService.CrawlResult instead
     */
    @Deprecated
    public record DeepSearchTriggerResponse(
            boolean success,
            String jobId,
            String message
    ) {}

    /**
     * Evidence item returned from external workflow
     * @deprecated Use EvidenceDto instead
     */
    @Deprecated
    public record Evidence(
            String url,
            String title,
            String stance,  // pro, con, neutral
            String snippet,
            String source
    ) {}

    /**
     * Callback payload received from external workflow
     * @deprecated Callbacks are now handled internally by IntegratedCrawlerService
     */
    @Deprecated
    public record DeepSearchCallbackPayload(
            String jobId,
            String status,
            String topic,
            String baseUrl,
            java.util.List<Evidence> evidence
    ) {}

    /**
     * Check if external webhook-based deep search is enabled.
     * @deprecated Always returns false as n8n integration is deprecated.
     *             Use IntegratedCrawlerService.isAvailable() instead.
     */
    @Deprecated
    public boolean isEnabled() {
        if (enabled) {
            log.warn("DeepAISearchClient is deprecated. Consider using IntegratedCrawlerService instead.");
        }
        return enabled && webhookUrl != null && !webhookUrl.isBlank();
    }

    /**
     * Trigger a deep AI search for the given topic and base URL.
     * 
     * @deprecated Use IntegratedCrawlerService.crawl() instead.
     * 
     * @param jobId Unique job identifier
     * @param topic Search topic/keyword
     * @param baseUrl Starting URL for crawling (optional)
     * @return Mono containing trigger response
     */
    @Deprecated
    public Mono<DeepSearchTriggerResponse> triggerSearch(String jobId, String topic, String baseUrl) {
        if (!isEnabled()) {
            log.warn("DeepAISearchClient is disabled. Use IntegratedCrawlerService instead.");
            return Mono.just(new DeepSearchTriggerResponse(false, jobId, 
                    "External webhook search is disabled. Use IntegratedCrawlerService."));
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

        log.info("Triggering external webhook search (DEPRECATED): jobId={}, topic={}, baseUrl={}", 
                jobId, topic, effectiveBaseUrl);

        return webClient.post()
                .uri(webhookUrl)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(payload)
                .retrieve()
                .bodyToMono(String.class)
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .map(response -> {
                    log.debug("External webhook response: {}", response);
                    return new DeepSearchTriggerResponse(true, jobId, "Search triggered successfully");
                })
                .onErrorResume(e -> {
                    log.error("Failed to trigger external webhook for jobId={}: {}", jobId, e.getMessage());
                    return Mono.just(new DeepSearchTriggerResponse(false, jobId, "Failed to trigger: " + e.getMessage()));
                });
    }

    /**
     * Synchronous version of triggerSearch
     * @deprecated Use IntegratedCrawlerService.crawl().block() instead.
     */
    @Deprecated
    public DeepSearchTriggerResponse triggerSearchSync(String jobId, String topic, String baseUrl) {
        return triggerSearch(jobId, topic, baseUrl).block();
    }

    /**
     * Parse callback payload from JSON
     * @deprecated Internal callbacks no longer use this format.
     */
    @Deprecated
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
     * @deprecated Internal callbacks no longer use this format.
     */
    @Deprecated
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
     * Build the callback URL
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
     * Get webhook URL (for debugging)
     * @deprecated This configuration is deprecated.
     */
    @Deprecated
    public String getWebhookUrl() {
        return webhookUrl != null ? webhookUrl : "";
    }

    /**
     * Get callback base URL (for debugging)
     */
    public String getCallbackBaseUrl() {
        return callbackBaseUrl;
    }
}
