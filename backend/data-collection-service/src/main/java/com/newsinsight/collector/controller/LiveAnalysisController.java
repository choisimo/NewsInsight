package com.newsinsight.collector.controller;

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

import java.util.Map;

@RestController
@RequestMapping("/api/v1/analysis")
@RequiredArgsConstructor
@Slf4j
public class LiveAnalysisController {

    private final PerplexityClient perplexityClient;
    private final CrawlSearchService crawlSearchService;

    /**
     * Health check for live analysis service.
     * Returns whether the analysis APIs are configured and available.
     * 
     * Providers:
     * - perplexity: Primary provider (requires API key)
     * - crawl+aidove: Fallback provider (Crawl4AI + AI Dove)
     */
    @GetMapping("/live/health")
    public ResponseEntity<Map<String, Object>> liveAnalysisHealth() {
        boolean perplexityEnabled = perplexityClient.isEnabled();
        boolean crawlEnabled = crawlSearchService.isAvailable();
        boolean anyEnabled = perplexityEnabled || crawlEnabled;

        String provider;
        String message;

        if (perplexityEnabled) {
            provider = "perplexity";
            message = "Live analysis is available (Perplexity)";
        } else if (crawlEnabled) {
            provider = "crawl+aidove";
            message = "Live analysis is available (Crawl4AI + AI Dove fallback)";
        } else {
            provider = "none";
            message = "Live analysis is disabled. No AI provider is configured.";
        }

        return ResponseEntity.ok(Map.of(
                "enabled", anyEnabled,
                "provider", provider,
                "perplexityEnabled", perplexityEnabled,
                "crawlEnabled", crawlEnabled,
                "message", message
        ));
    }

    @GetMapping(value = "/live", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<String> streamLiveAnalysis(
            @RequestParam String query,
            @RequestParam(defaultValue = "7d") String window
    ) {
        // Try Perplexity first (primary provider)
        if (perplexityClient.isEnabled()) {
            String prompt = buildPrompt(query, window);
            log.info("Starting live analysis with Perplexity for query='{}', window='{}'", query, window);
            return perplexityClient.streamCompletion(prompt)
                    .onErrorResume(e -> {
                        log.error("Perplexity streaming failed, falling back to Crawl+AIDove", e);
                        // Fallback to CrawlSearchService if Perplexity fails
                        if (crawlSearchService.isAvailable()) {
                            return crawlSearchService.searchAndAnalyze(query, window);
                        }
                        return Flux.just("실시간 분석 중 오류가 발생했습니다: " + e.getMessage());
                    });
        }

        // Fallback to CrawlSearchService (Crawl4AI + AI Dove)
        if (crawlSearchService.isAvailable()) {
            log.info("Starting live analysis with Crawl+AIDove for query='{}', window='{}'", query, window);
            return crawlSearchService.searchAndAnalyze(query, window);
        }

        // No provider available
        log.warn("Live analysis requested but no provider is available");
        return Flux.just(
                "실시간 분석 기능이 현재 사용할 수 없습니다.\n\n" +
                "설정된 AI 제공자가 없습니다 (Perplexity API 키 또는 AI Dove 서비스).\n" +
                "관리자에게 문의하세요.\n\n" +
                "대안: Deep AI Search 또는 Browser AI Agent를 사용해 보세요."
        );
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
}

