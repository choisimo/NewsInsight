package com.newsinsight.collector.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.netty.channel.ChannelOption;
import io.netty.handler.timeout.ReadTimeoutHandler;
import io.netty.handler.timeout.WriteTimeoutHandler;
import jakarta.annotation.PostConstruct;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.netty.http.client.HttpClient;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * OpenAI-compatible client that can connect to various LLM providers.
 * Supports: OpenAI, OpenRouter, Ollama, Azure OpenAI, and custom endpoints.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class OpenAICompatibleClient {

    private final ObjectMapper objectMapper;
    private WebClient webClient;

    // OpenAI settings
    @Value("${LLM_OPENAI_API_KEY:${OPENAI_API_KEY:}}")
    private String openaiApiKey;

    @Value("${LLM_OPENAI_BASE_URL:https://api.openai.com/v1}")
    private String openaiBaseUrl;

    @Value("${LLM_OPENAI_MODEL:gpt-4o-mini}")
    private String openaiModel;

    // OpenRouter settings
    @Value("${LLM_OPENROUTER_API_KEY:${OPENROUTER_API_KEY:}}")
    private String openrouterApiKey;

    @Value("${LLM_OPENROUTER_BASE_URL:https://openrouter.ai/api/v1}")
    private String openrouterBaseUrl;

    @Value("${LLM_OPENROUTER_MODEL:anthropic/claude-3.5-sonnet}")
    private String openrouterModel;

    // Ollama settings
    @Value("${LLM_OLLAMA_BASE_URL:http://localhost:11434/v1}")
    private String ollamaBaseUrl;

    @Value("${LLM_OLLAMA_MODEL:llama3.2}")
    private String ollamaModel;

    // Azure OpenAI settings
    @Value("${LLM_AZURE_API_KEY:${AZURE_OPENAI_API_KEY:}}")
    private String azureApiKey;

    @Value("${LLM_AZURE_ENDPOINT:}")
    private String azureEndpoint;

    @Value("${LLM_AZURE_DEPLOYMENT:gpt-4o}")
    private String azureDeployment;

    @Value("${LLM_AZURE_API_VERSION:2024-02-15-preview}")
    private String azureApiVersion;

    // Custom endpoint settings
    @Value("${LLM_CUSTOM_BASE_URL:}")
    private String customBaseUrl;

    @Value("${LLM_CUSTOM_API_KEY:}")
    private String customApiKey;

    @Value("${LLM_CUSTOM_MODEL:}")
    private String customModel;

    @Value("${collector.openai.timeout-seconds:120}")
    private int timeoutSeconds;

    @Getter
    private ProviderStatus providerStatus;

    @PostConstruct
    public void init() {
        HttpClient httpClient = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 30000)
                .responseTimeout(Duration.ofSeconds(timeoutSeconds))
                .doOnConnected(conn ->
                        conn.addHandlerLast(new ReadTimeoutHandler(timeoutSeconds, TimeUnit.SECONDS))
                            .addHandlerLast(new WriteTimeoutHandler(timeoutSeconds, TimeUnit.SECONDS))
                )
                .followRedirect(true);

        this.webClient = WebClient.builder()
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .defaultHeader("User-Agent", "NewsInsight-OpenAI/1.0")
                .codecs(configurer -> configurer.defaultCodecs().maxInMemorySize(10 * 1024 * 1024))
                .build();

        this.providerStatus = checkProviderStatus();
        log.info("OpenAICompatibleClient initialized - Available providers: {}", providerStatus);
    }

    /**
     * Check which providers are available
     */
    public ProviderStatus checkProviderStatus() {
        return new ProviderStatus(
                isNotBlank(openaiApiKey),
                isNotBlank(openrouterApiKey),
                true, // Ollama is always potentially available (local)
                isNotBlank(azureApiKey) && isNotBlank(azureEndpoint),
                isNotBlank(customBaseUrl)
        );
    }

    /**
     * Check if any OpenAI-compatible provider is enabled
     */
    public boolean isEnabled() {
        return providerStatus.openai() || providerStatus.openrouter() 
                || providerStatus.ollama() || providerStatus.azure() 
                || providerStatus.custom();
    }

    /**
     * Check if OpenAI is enabled
     */
    public boolean isOpenAIEnabled() {
        return isNotBlank(openaiApiKey);
    }

    /**
     * Check if OpenRouter is enabled
     */
    public boolean isOpenRouterEnabled() {
        return isNotBlank(openrouterApiKey);
    }

    /**
     * Check if Ollama is enabled (always returns true as it's local)
     */
    public boolean isOllamaEnabled() {
        return true;
    }

    /**
     * Check if Azure OpenAI is enabled
     */
    public boolean isAzureEnabled() {
        return isNotBlank(azureApiKey) && isNotBlank(azureEndpoint);
    }

    /**
     * Check if Custom endpoint is enabled
     */
    public boolean isCustomEnabled() {
        return isNotBlank(customBaseUrl);
    }

    /**
     * Stream completion from OpenAI
     */
    public Flux<String> streamFromOpenAI(String prompt) {
        if (!isOpenAIEnabled()) {
            return Flux.error(new IllegalStateException("OpenAI API key is not configured"));
        }
        return streamCompletion(openaiBaseUrl, openaiApiKey, openaiModel, prompt, "OpenAI");
    }

    /**
     * Stream completion from OpenRouter
     */
    public Flux<String> streamFromOpenRouter(String prompt) {
        if (!isOpenRouterEnabled()) {
            return Flux.error(new IllegalStateException("OpenRouter API key is not configured"));
        }
        return streamCompletion(openrouterBaseUrl, openrouterApiKey, openrouterModel, prompt, "OpenRouter");
    }

    /**
     * Stream completion from Ollama
     */
    public Flux<String> streamFromOllama(String prompt) {
        return streamCompletion(ollamaBaseUrl, null, ollamaModel, prompt, "Ollama");
    }

    /**
     * Stream completion from Azure OpenAI
     */
    public Flux<String> streamFromAzure(String prompt) {
        if (!isAzureEnabled()) {
            return Flux.error(new IllegalStateException("Azure OpenAI is not configured"));
        }
        String url = String.format("%s/openai/deployments/%s/chat/completions?api-version=%s",
                azureEndpoint, azureDeployment, azureApiVersion);
        return streamCompletionAzure(url, azureApiKey, prompt);
    }

    /**
     * Stream completion from Custom endpoint
     */
    public Flux<String> streamFromCustom(String prompt) {
        if (!isCustomEnabled()) {
            return Flux.error(new IllegalStateException("Custom endpoint is not configured"));
        }
        return streamCompletion(customBaseUrl, customApiKey, customModel, prompt, "Custom");
    }

    /**
     * Generic OpenAI-compatible streaming completion
     */
    private Flux<String> streamCompletion(String baseUrl, String apiKey, String model, String prompt, String providerName) {
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

        log.debug("Calling {} API: {} with model {}", providerName, url, model);

        WebClient.RequestBodySpec request = webClient.post()
                .uri(url)
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.TEXT_EVENT_STREAM);

        if (apiKey != null && !apiKey.isBlank()) {
            request = request.header(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey);
        }

        return request
                .bodyValue(body)
                .retrieve()
                .bodyToFlux(String.class)
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .doOnSubscribe(s -> log.debug("Starting {} stream request", providerName))
                .filter(chunk -> chunk != null && !chunk.isBlank() && !chunk.equals("[DONE]"))
                .mapNotNull(this::extractContent)
                .doOnComplete(() -> log.debug("{} stream completed", providerName))
                .doOnError(e -> log.error("{} stream failed: {}", providerName, e.getMessage()));
    }

    /**
     * Azure-specific streaming (uses api-key header instead of Authorization)
     */
    private Flux<String> streamCompletionAzure(String url, String apiKey, String prompt) {
        // System message to guide the AI to respond directly in report format
        String systemMessage = """
                당신은 뉴스 분석 전문가입니다. 사용자의 요청에 대해 직접 보고서 형식으로 답변해주세요.
                "알겠습니다", "네", "검색하겠습니다" 등의 서두 없이 바로 분석 결과를 작성하세요.
                요청받은 형식(마크다운 등)을 정확히 따르세요.
                """;

        Map<String, Object> body = Map.of(
                "stream", true,
                "messages", List.of(
                        Map.of("role", "system", "content", systemMessage),
                        Map.of("role", "user", "content", prompt)
                )
        );

        log.debug("Calling Azure OpenAI API: {}", url);

        return webClient.post()
                .uri(url)
                .header("api-key", apiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.TEXT_EVENT_STREAM)
                .bodyValue(body)
                .retrieve()
                .bodyToFlux(String.class)
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .doOnSubscribe(s -> log.debug("Starting Azure stream request"))
                .filter(chunk -> chunk != null && !chunk.isBlank() && !chunk.equals("[DONE]"))
                .mapNotNull(this::extractContent)
                .doOnComplete(() -> log.debug("Azure stream completed"))
                .doOnError(e -> log.error("Azure stream failed: {}", e.getMessage()));
    }

    /**
     * Extract content from SSE chunk
     */
    private String extractContent(String chunk) {
        try {
            // Handle SSE format: data: {...}
            String json = chunk.startsWith("data:") ? chunk.substring(5).trim() : chunk;
            if (json.isBlank() || json.equals("[DONE]")) {
                return null;
            }

            JsonNode node = objectMapper.readTree(json);
            JsonNode choices = node.get("choices");
            if (choices != null && choices.isArray() && !choices.isEmpty()) {
                JsonNode delta = choices.get(0).get("delta");
                if (delta != null && delta.has("content")) {
                    return delta.get("content").asText();
                }
            }
            return null;
        } catch (Exception e) {
            log.trace("Failed to parse chunk: {}", chunk);
            return null;
        }
    }

    private boolean isNotBlank(String str) {
        return str != null && !str.isBlank();
    }

    /**
     * Provider availability status
     */
    public record ProviderStatus(
            boolean openai,
            boolean openrouter,
            boolean ollama,
            boolean azure,
            boolean custom
    ) {
        @Override
        public String toString() {
            StringBuilder sb = new StringBuilder("[");
            if (openai) sb.append("OpenAI, ");
            if (openrouter) sb.append("OpenRouter, ");
            if (ollama) sb.append("Ollama, ");
            if (azure) sb.append("Azure, ");
            if (custom) sb.append("Custom, ");
            if (sb.length() > 1) {
                sb.setLength(sb.length() - 2);
            }
            sb.append("]");
            return sb.toString();
        }
    }
}
