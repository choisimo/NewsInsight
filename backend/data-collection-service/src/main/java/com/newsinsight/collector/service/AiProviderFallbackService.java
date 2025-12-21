package com.newsinsight.collector.service;

import com.newsinsight.collector.client.AIDoveClient;
import com.newsinsight.collector.client.OpenAICompatibleClient;
import com.newsinsight.collector.client.PerplexityClient;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

/**
 * AI Provider Fallback Chain Service.
 * Provides resilient AI completion by trying multiple providers in sequence.
 * 
 * Fallback order:
 * 1. Perplexity (if enabled) - Best for fact-checking with online search
 * 2. OpenAI (if enabled)
 * 3. OpenRouter (if enabled)
 * 4. Azure OpenAI (if enabled)
 * 5. AI Dove (if enabled) - n8n webhook
 * 6. Ollama (local) - Last resort
 * 7. Custom endpoint (if enabled)
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AiProviderFallbackService {

    private final PerplexityClient perplexityClient;
    private final OpenAICompatibleClient openAICompatibleClient;
    private final AIDoveClient aiDoveClient;

    /**
     * Stream completion using fallback chain.
     * Tries each available provider in order until one succeeds.
     * 
     * @param prompt The prompt to send
     * @return Flux of response chunks
     */
    public Flux<String> streamCompletionWithFallback(String prompt) {
        List<ProviderAttempt> providers = buildProviderChain(prompt);
        
        if (providers.isEmpty()) {
            log.error("No AI providers are available");
            return Flux.just("AI 분석을 수행할 수 없습니다. 설정된 AI 제공자가 없습니다.");
        }

        log.info("AI fallback chain initialized with {} providers: {}", 
                providers.size(), 
                providers.stream().map(ProviderAttempt::name).toList());

        return tryProvidersInSequence(providers, 0);
    }

    /**
     * Get completion (non-streaming) using fallback chain.
     * Collects all chunks into a single string.
     * 
     * @param prompt The prompt to send
     * @return Mono of complete response
     */
    public Mono<String> getCompletionWithFallback(String prompt) {
        return streamCompletionWithFallback(prompt)
                .collectList()
                .map(chunks -> String.join("", chunks));
    }

    /**
     * Check which providers are currently available
     */
    public List<String> getAvailableProviders() {
        List<String> available = new ArrayList<>();
        
        if (perplexityClient.isEnabled()) {
            available.add("Perplexity");
        }
        if (openAICompatibleClient.isOpenAIEnabled()) {
            available.add("OpenAI");
        }
        if (openAICompatibleClient.isOpenRouterEnabled()) {
            available.add("OpenRouter");
        }
        if (openAICompatibleClient.isAzureEnabled()) {
            available.add("Azure OpenAI");
        }
        if (aiDoveClient.isEnabled()) {
            available.add("AI Dove");
        }
        if (openAICompatibleClient.isOllamaEnabled()) {
            available.add("Ollama");
        }
        if (openAICompatibleClient.isCustomEnabled()) {
            available.add("Custom");
        }
        
        return available;
    }

    /**
     * Check if any AI provider is available
     */
    public boolean isAnyProviderAvailable() {
        return perplexityClient.isEnabled() 
                || openAICompatibleClient.isEnabled()
                || aiDoveClient.isEnabled();
    }

    /**
     * Build the provider chain based on availability
     */
    private List<ProviderAttempt> buildProviderChain(String prompt) {
        List<ProviderAttempt> chain = new ArrayList<>();

        // 1. Perplexity - Best for fact-checking with online search capabilities
        if (perplexityClient.isEnabled()) {
            chain.add(new ProviderAttempt(
                    "Perplexity",
                    () -> perplexityClient.streamCompletion(prompt)
            ));
        }

        // 2. OpenAI
        if (openAICompatibleClient.isOpenAIEnabled()) {
            chain.add(new ProviderAttempt(
                    "OpenAI",
                    () -> openAICompatibleClient.streamFromOpenAI(prompt)
            ));
        }

        // 3. OpenRouter - Access to multiple models
        if (openAICompatibleClient.isOpenRouterEnabled()) {
            chain.add(new ProviderAttempt(
                    "OpenRouter",
                    () -> openAICompatibleClient.streamFromOpenRouter(prompt)
            ));
        }

        // 4. Azure OpenAI
        if (openAICompatibleClient.isAzureEnabled()) {
            chain.add(new ProviderAttempt(
                    "Azure OpenAI",
                    () -> openAICompatibleClient.streamFromAzure(prompt)
            ));
        }

        // 5. AI Dove (n8n webhook) - Simulated streaming
        if (aiDoveClient.isEnabled()) {
            chain.add(new ProviderAttempt(
                    "AI Dove",
                    () -> aiDoveClient.chatStream(prompt, null)
            ));
        }

        // 6. Ollama - Local LLM (always available but may not be running)
        chain.add(new ProviderAttempt(
                "Ollama",
                () -> openAICompatibleClient.streamFromOllama(prompt)
        ));

        // 7. Custom endpoint
        if (openAICompatibleClient.isCustomEnabled()) {
            chain.add(new ProviderAttempt(
                    "Custom",
                    () -> openAICompatibleClient.streamFromCustom(prompt)
            ));
        }

        return chain;
    }

    /**
     * Try providers in sequence until one succeeds
     */
    private Flux<String> tryProvidersInSequence(List<ProviderAttempt> providers, int index) {
        if (index >= providers.size()) {
            log.error("All AI providers failed");
            return Flux.just("모든 AI 제공자 연결에 실패했습니다. 나중에 다시 시도해주세요.");
        }

        ProviderAttempt current = providers.get(index);
        log.info("Attempting AI provider: {} (attempt {}/{})", current.name(), index + 1, providers.size());

        AtomicInteger chunkCount = new AtomicInteger(0);

        return current.streamSupplier().get()
                .timeout(Duration.ofSeconds(90))
                .doOnNext(chunk -> chunkCount.incrementAndGet())
                .doOnComplete(() -> {
                    if (chunkCount.get() > 0) {
                        log.info("AI provider {} completed successfully with {} chunks", 
                                current.name(), chunkCount.get());
                    }
                })
                .onErrorResume(e -> {
                    log.warn("AI provider {} failed: {}. Trying next provider...", 
                            current.name(), e.getMessage());
                    return tryProvidersInSequence(providers, index + 1);
                })
                .switchIfEmpty(Flux.defer(() -> {
                    log.warn("AI provider {} returned empty response. Trying next provider...", 
                            current.name());
                    return tryProvidersInSequence(providers, index + 1);
                }));
    }

    /**
     * Provider attempt wrapper
     */
    private record ProviderAttempt(
            String name,
            Supplier<Flux<String>> streamSupplier
    ) {}
}
