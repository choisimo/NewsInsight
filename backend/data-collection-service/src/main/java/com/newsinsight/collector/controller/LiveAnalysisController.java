package com.newsinsight.collector.controller;

import com.newsinsight.collector.client.AIDoveClient;
import com.newsinsight.collector.client.OpenAICompatibleClient;
import com.newsinsight.collector.client.PerplexityClient;
import com.newsinsight.collector.service.CrawlSearchService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

@RestController
@RequestMapping("/api/v1/analysis")
@RequiredArgsConstructor
@Slf4j
public class LiveAnalysisController {

    private final PerplexityClient perplexityClient;
    private final OpenAICompatibleClient openAICompatibleClient;
    private final AIDoveClient aiDoveClient;
    private final CrawlSearchService crawlSearchService;

    /**
     * Health check for live analysis service.
     * Returns whether the analysis APIs are configured and available.
     */
    @GetMapping("/live/health")
    public ResponseEntity<Map<String, Object>> liveAnalysisHealth() {
        List<String> availableProviders = getAvailableProviders();
        boolean anyEnabled = !availableProviders.isEmpty();

        String primaryProvider = availableProviders.isEmpty() ? "none" : availableProviders.get(0);
        String message = anyEnabled 
                ? "Live analysis is available (" + String.join(", ", availableProviders) + ")"
                : "Live analysis is disabled. No AI provider is configured.";

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("enabled", anyEnabled);
        response.put("primaryProvider", primaryProvider);
        response.put("availableProviders", availableProviders);
        response.put("providerStatus", Map.of(
                "perplexity", perplexityClient.isEnabled(),
                "openai", openAICompatibleClient.isOpenAIEnabled(),
                "openrouter", openAICompatibleClient.isOpenRouterEnabled(),
                "azure", openAICompatibleClient.isAzureEnabled(),
                "aidove", aiDoveClient.isEnabled(),
                "ollama", true, // Ollama is always potentially available
                "custom", openAICompatibleClient.isCustomEnabled(),
                "crawl", crawlSearchService.isAvailable()
        ));
        response.put("message", message);

        return ResponseEntity.ok(response);
    }

    @GetMapping(value = "/live", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<String> streamLiveAnalysis(
            @RequestParam String query,
            @RequestParam(defaultValue = "7d") String window
    ) {
        String prompt = buildPrompt(query, window);
        log.info("Starting live analysis for query='{}', window='{}'", query, window);

        // Build provider chain and try with fallback
        List<ProviderAttempt> providers = buildProviderChain(prompt, query, window);
        
        if (providers.isEmpty()) {
            log.warn("Live analysis requested but no provider is available");
            return Flux.just(
                    "실시간 분석 기능이 현재 사용할 수 없습니다.\n\n" +
                    "설정된 AI 제공자가 없습니다.\n" +
                    "관리자에게 문의하세요.\n\n" +
                    "대안: Deep AI Search 또는 Browser AI Agent를 사용해 보세요."
            );
        }

        log.info("Live analysis using fallback chain: {}", 
                providers.stream().map(ProviderAttempt::name).toList());

        return tryProvidersInSequence(providers, 0);
    }

    /**
     * Get list of available providers
     */
    private List<String> getAvailableProviders() {
        List<String> available = new ArrayList<>();
        
        if (perplexityClient.isEnabled()) available.add("Perplexity");
        if (openAICompatibleClient.isOpenAIEnabled()) available.add("OpenAI");
        if (openAICompatibleClient.isOpenRouterEnabled()) available.add("OpenRouter");
        if (openAICompatibleClient.isAzureEnabled()) available.add("Azure");
        if (aiDoveClient.isEnabled()) available.add("AI Dove");
        available.add("Ollama"); // Always potentially available
        if (openAICompatibleClient.isCustomEnabled()) available.add("Custom");
        if (crawlSearchService.isAvailable()) available.add("Crawl+AIDove");
        
        return available;
    }

    /**
     * Build provider chain for live analysis
     */
    private List<ProviderAttempt> buildProviderChain(String prompt, String query, String window) {
        List<ProviderAttempt> chain = new ArrayList<>();

        // 1. Perplexity - Best for news analysis with online search
        if (perplexityClient.isEnabled()) {
            chain.add(new ProviderAttempt("Perplexity", () -> perplexityClient.streamCompletion(prompt)));
        }

        // 2. OpenAI
        if (openAICompatibleClient.isOpenAIEnabled()) {
            chain.add(new ProviderAttempt("OpenAI", () -> openAICompatibleClient.streamFromOpenAI(prompt)));
        }

        // 3. OpenRouter
        if (openAICompatibleClient.isOpenRouterEnabled()) {
            chain.add(new ProviderAttempt("OpenRouter", () -> openAICompatibleClient.streamFromOpenRouter(prompt)));
        }

        // 4. Azure OpenAI
        if (openAICompatibleClient.isAzureEnabled()) {
            chain.add(new ProviderAttempt("Azure", () -> openAICompatibleClient.streamFromAzure(prompt)));
        }

        // 5. AI Dove
        if (aiDoveClient.isEnabled()) {
            chain.add(new ProviderAttempt("AI Dove", () -> aiDoveClient.chatStream(prompt, null)));
        }

        // 6. CrawlSearchService (Crawl4AI + AI Dove)
        if (crawlSearchService.isAvailable()) {
            chain.add(new ProviderAttempt("Crawl+AIDove", () -> crawlSearchService.searchAndAnalyze(query, window)));
        }

        // 7. Ollama - Local LLM
        chain.add(new ProviderAttempt("Ollama", () -> openAICompatibleClient.streamFromOllama(prompt)));

        // 8. Custom endpoint
        if (openAICompatibleClient.isCustomEnabled()) {
            chain.add(new ProviderAttempt("Custom", () -> openAICompatibleClient.streamFromCustom(prompt)));
        }

        return chain;
    }

    /**
     * Try providers in sequence until one succeeds
     */
    private Flux<String> tryProvidersInSequence(List<ProviderAttempt> providers, int index) {
        if (index >= providers.size()) {
            log.error("All AI providers failed for live analysis");
            return Flux.just("모든 AI 제공자 연결에 실패했습니다. 나중에 다시 시도해주세요.");
        }

        ProviderAttempt current = providers.get(index);
        log.info("Trying AI provider: {} ({}/{})", current.name(), index + 1, providers.size());

        return current.streamSupplier().get()
                .timeout(Duration.ofSeconds(90))
                .onErrorResume(e -> {
                    log.warn("AI provider {} failed: {}. Trying next...", current.name(), e.getMessage());
                    return tryProvidersInSequence(providers, index + 1);
                })
                .switchIfEmpty(Flux.defer(() -> {
                    log.warn("AI provider {} returned empty. Trying next...", current.name());
                    return tryProvidersInSequence(providers, index + 1);
                }));
    }

    private String buildPrompt(String query, String window) {
        String normalizedQuery = (query == null || query.isBlank()) ? "지정된 키워드 없음" : query;

        String windowDescription;
        if ("1d".equals(window)) {
            windowDescription = "최근 1일";
        } else if ("30d".equals(window)) {
            windowDescription = "최근 30일";
        } else {
            windowDescription = "최근 7일";
        }

        return "다음 키워드 '" + normalizedQuery + "' 에 대해 " + windowDescription +
                " 동안의 주요 뉴스 흐름과 핵심 인사이트를 한국어로 자세히 요약해 주세요. " +
                "가능하면 bullet 형식으로 정리하고, 마지막에 전반적인 의미를 한 문단으로 정리해 주세요.";
    }

    /**
     * Provider attempt wrapper
     */
    private record ProviderAttempt(
            String name,
            Supplier<Flux<String>> streamSupplier
    ) {}
}
