package com.newsinsight.collector.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;

import java.util.List;
import java.util.Map;

@Component
@RequiredArgsConstructor
@Slf4j
public class PerplexityClient {

    private final WebClient webClient;
    private final ObjectMapper objectMapper;

    @Value("${PERPLEXITY_API_KEY:}")
    private String apiKey;

    @Value("${PERPLEXITY_BASE_URL:https://api.perplexity.ai}")
    private String baseUrl;

    @Value("${PERPLEXITY_MODEL:llama-3.1-sonar-large-128k-online}")
    private String model;

    public Flux<String> streamCompletion(String prompt) {
        if (apiKey == null || apiKey.isBlank()) {
            return Flux.error(new IllegalStateException("Perplexity API key is not configured"));
        }

        String url = baseUrl.endsWith("/") ? baseUrl + "chat/completions" : baseUrl + "/chat/completions";

        Map<String, Object> body = Map.of(
                "model", model,
                "stream", true,
                "messages", List.of(Map.of("role", "user", "content", prompt))
        );

        return webClient.post()
                .uri(url)
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.TEXT_EVENT_STREAM)
                .bodyValue(body)
                .retrieve()
                .bodyToFlux(String.class)
                .doOnNext(chunk -> log.debug("Perplexity raw chunk: {}", chunk))
                .flatMap(this::extractTextFromChunk);
    }

    private Flux<String> extractTextFromChunk(String chunk) {
        if (chunk == null || chunk.isBlank()) {
            return Flux.empty();
        }

        String trimmed = chunk.trim();
        if ("[DONE]".equalsIgnoreCase(trimmed) || "data: [DONE]".equalsIgnoreCase(trimmed)) {
            return Flux.empty();
        }

        String json;
        if (trimmed.startsWith("data:")) {
            json = trimmed.substring(5).trim();
        } else {
            json = trimmed;
        }

        if (json.isEmpty()) {
            return Flux.empty();
        }

        try {
            JsonNode root = objectMapper.readTree(json);
            JsonNode choices = root.get("choices");
            if (choices == null || !choices.isArray() || choices.isEmpty()) {
                return Flux.empty();
            }

            JsonNode choice = choices.get(0);
            JsonNode delta = choice.get("delta");
            if (delta != null && delta.has("content")) {
                String text = delta.get("content").asText();
                if (text != null && !text.isEmpty()) {
                    return Flux.just(text);
                }
            }

            JsonNode message = choice.get("message");
            if (message != null && message.has("content")) {
                String text = message.get("content").asText();
                if (text != null && !text.isEmpty()) {
                    return Flux.just(text);
                }
            }
        } catch (Exception e) {
            log.warn("Failed to parse Perplexity chunk: {}", chunk, e);
        }

        return Flux.empty();
    }
}
