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

import com.newsinsight.collector.service.LlmProviderSettingsService;
import jakarta.annotation.PostConstruct;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

@Component
@Slf4j
public class PerplexityClient {

    private final ObjectMapper objectMapper;
    private final LlmProviderSettingsService llmProviderSettingsService;
    private WebClient perplexityWebClient;

    @Value("${PERPLEXITY_API_KEY:}")
    private String envApiKey;

    @Value("${PERPLEXITY_BASE_URL:https://api.perplexity.ai}")
    private String envBaseUrl;

    @Value("${PERPLEXITY_MODEL:llama-3.1-sonar-large-128k-online}")
    private String model;

    @Value("${collector.perplexity.timeout-seconds:120}")
    private int timeoutSeconds;

    public PerplexityClient(ObjectMapper objectMapper, LlmProviderSettingsService llmProviderSettingsService) {
        this.objectMapper = objectMapper;
        this.llmProviderSettingsService = llmProviderSettingsService;
    }
    
    /**
     * Get API key from LLM Provider Settings or fall back to environment variable
     */
    private String getApiKey() {
        // Try to get from LLM Provider Settings first
        try {
            var apiKey = llmProviderSettingsService.getGlobalApiKey(
                com.newsinsight.collector.entity.settings.LlmProviderType.PERPLEXITY);
            if (apiKey.isPresent() && !apiKey.get().isBlank()) {
                return apiKey.get();
            }
        } catch (Exception e) {
            log.debug("Failed to get Perplexity settings from database, falling back to env: {}", e.getMessage());
        }
        // Fall back to environment variable
        return envApiKey;
    }
    
    /**
     * Get base URL from LLM Provider Settings or fall back to environment variable
     */
    private String getBaseUrl() {
        try {
            var baseUrl = llmProviderSettingsService.getGlobalBaseUrl(
                com.newsinsight.collector.entity.settings.LlmProviderType.PERPLEXITY);
            if (baseUrl.isPresent() && !baseUrl.get().isBlank()) {
                return baseUrl.get();
            }
        } catch (Exception e) {
            log.debug("Failed to get Perplexity base URL from database: {}", e.getMessage());
        }
        return envBaseUrl;
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
        String apiKey = getApiKey();
        return apiKey != null && !apiKey.isBlank();
    }

    public Flux<String> streamCompletion(String prompt) {
        String apiKey = getApiKey();
        if (apiKey == null || apiKey.isBlank()) {
            return Flux.error(new IllegalStateException("Perplexity API key is not configured"));
        }

        String baseUrl = getBaseUrl();
        String url = baseUrl.endsWith("/") ? baseUrl + "chat/completions" : baseUrl + "/chat/completions";

        // System message to guide the AI to respond directly in report format
        String systemMessage = """
                당신은 뉴스 분석 전문가입니다. 사용자의 요청에 대해 직접 보고서 형식으로 답변해주세요.
                "알겠습니다", "네", "검색하겠습니다" 등의 서두 없이 바로 분석 결과를 작성하세요.
                요청받은 형식(마크다운 등)을 정확히 따르세요.
                """;

        Map<String, Object> body = Map.of(
                "model", model,
                "stream", true,
                "messages", List.of(
                        Map.of("role", "system", "content", systemMessage),
                        Map.of("role", "user", "content", prompt)
                )
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
