package com.newsinsight.collector.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.Map;

/**
 * Client for AI Dove Agent API.
 * Provides AI-powered text analysis using the self-healing AI service at workflow.nodove.com.
 * 
 * API Endpoint: POST https://workflow.nodove.com/webhook/aidove
 * 
 * Request:
 *   - chatInput: string (required) - The message/prompt
 *   - sessionId: string (optional) - Session ID for context continuity
 * 
 * Response:
 *   - reply: string - AI response
 *   - tokens_used: integer - Tokens consumed
 *   - model: string - Model used for generation
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class AIDoveClient {

    private final WebClient webClient;
    private final ObjectMapper objectMapper;

    @Value("${collector.aidove.base-url:https://workflow.nodove.com/webhook/aidove}")
    private String baseUrl;

    @Value("${collector.aidove.timeout-seconds:120}")
    private int timeoutSeconds;

    @Value("${collector.aidove.enabled:true}")
    private boolean enabled;

    /**
     * Check if AI Dove client is enabled
     */
    public boolean isEnabled() {
        return enabled;
    }

    /**
     * Send a prompt to AI Dove and get a response.
     * 
     * @param prompt The prompt to send
     * @param sessionId Optional session ID for context continuity
     * @return The AI response
     */
    public Mono<AIDoveResponse> chat(String prompt, String sessionId) {
        if (!enabled) {
            return Mono.error(new IllegalStateException("AI Dove client is disabled"));
        }

        Map<String, Object> payload = sessionId != null
                ? Map.of("chatInput", prompt, "sessionId", sessionId)
                : Map.of("chatInput", prompt);

        return webClient.post()
                .uri(baseUrl)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(payload)
                .retrieve()
                .bodyToMono(String.class)
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .map(this::parseResponse)
                .doOnError(e -> log.error("AI Dove request failed: {}", e.getMessage()));
    }

    /**
     * Stream a response from AI Dove (simulated streaming by splitting response).
     * Note: AI Dove API doesn't support true streaming, so we simulate it.
     */
    public Flux<String> chatStream(String prompt, String sessionId) {
        return chat(prompt, sessionId)
                .flatMapMany(response -> {
                    if (response.reply() == null) {
                        return Flux.empty();
                    }
                    // Split response into chunks for simulated streaming
                    String[] sentences = response.reply().split("(?<=[.!?\\n])\\s*");
                    return Flux.fromArray(sentences)
                            .delayElements(Duration.ofMillis(50));
                })
                .onErrorResume(e -> {
                    log.error("AI Dove stream failed: {}", e.getMessage());
                    return Flux.just("AI 분석 중 오류가 발생했습니다: " + e.getMessage());
                });
    }

    private AIDoveResponse parseResponse(String json) {
        try {
            JsonNode node = objectMapper.readTree(json);
            return new AIDoveResponse(
                    node.has("reply") ? node.get("reply").asText() : null,
                    node.has("tokens_used") ? node.get("tokens_used").asInt() : 0,
                    node.has("model") ? node.get("model").asText() : "unknown"
            );
        } catch (Exception e) {
            log.error("Failed to parse AI Dove response: {}", e.getMessage());
            return new AIDoveResponse(json, 0, "unknown");
        }
    }

    /**
     * AI Dove API response
     */
    public record AIDoveResponse(
            String reply,
            int tokensUsed,
            String model
    ) {}
}
