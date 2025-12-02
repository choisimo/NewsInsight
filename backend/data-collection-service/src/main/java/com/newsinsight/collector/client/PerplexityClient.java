package com.newsinsight.collector.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.netty.channel.ChannelOption;
import io.netty.handler.timeout.ReadTimeoutHandler;
import io.netty.handler.timeout.WriteTimeoutHandler;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.netty.http.client.HttpClient;

import jakarta.annotation.PostConstruct;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

@Component
@Slf4j
public class PerplexityClient {

    private final ObjectMapper objectMapper;
    private WebClient perplexityWebClient;

    @Value("${PERPLEXITY_API_KEY:}")
    private String apiKey;

    @Value("${PERPLEXITY_BASE_URL:https://api.perplexity.ai}")
    private String baseUrl;

    @Value("${PERPLEXITY_MODEL:llama-3.1-sonar-large-128k-online}")
    private String model;

    @Value("${collector.perplexity.timeout-seconds:120}")
    private int timeoutSeconds;

    public PerplexityClient(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @PostConstruct
    public void init() {
        // Create dedicated WebClient with longer timeout for AI streaming
        HttpClient httpClient = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 30000)
                .responseTimeout(Duration.ofSeconds(timeoutSeconds))
                .doOnConnected(conn ->
                        conn.addHandlerLast(new ReadTimeoutHandler(timeoutSeconds, TimeUnit.SECONDS))
                            .addHandlerLast(new WriteTimeoutHandler(timeoutSeconds, TimeUnit.SECONDS))
                )
                .followRedirect(true);

        this.perplexityWebClient = WebClient.builder()
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .defaultHeader("User-Agent", "NewsInsight-Collector/1.0")
                .codecs(configurer -> configurer.defaultCodecs().maxInMemorySize(10 * 1024 * 1024))
                .build();

        log.info("PerplexityClient initialized with timeout: {}s, enabled: {}", timeoutSeconds, isEnabled());
    }

    /**
     * Check if Perplexity API is enabled (API key is configured)
     */
    public boolean isEnabled() {
        return apiKey != null && !apiKey.isBlank();
    }

    public Flux<String> streamCompletion(String prompt) {
        if (!isEnabled()) {
            return Flux.error(new IllegalStateException("Perplexity API key is not configured"));
        }

        String url = baseUrl.endsWith("/") ? baseUrl + "chat/completions" : baseUrl + "/chat/completions";

        Map<String, Object> body = Map.of(
                "model", model,
                "stream", true,
                "messages", List.of(Map.of("role", "user", "content", prompt))
        );

        log.debug("Calling Perplexity API: {} with timeout {}s", url, timeoutSeconds);

        return perplexityWebClient.post()
                .uri(url)
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.TEXT_EVENT_STREAM)
                .bodyValue(body)
                .retrieve()
                .bodyToFlux(String.class)
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .doOnSubscribe(s -> log.debug("Starting Perplexity stream request"))
                .doOnNext(chunk -> log.debug("Perplexity raw chunk: {}", chunk))
                .doOnError(e -> log.error("Perplexity API error: {}", e.getMessage()))
                .doOnComplete(() -> log.debug("Perplexity stream completed"))
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
