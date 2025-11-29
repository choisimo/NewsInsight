package com.newsinsight.collector.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.client.AIDoveClient;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Service for crawling web content based on keyword search and analyzing with AI Dove.
 * This serves as a fallback when Perplexity API is not available.
 * 
 * Flow:
 * 1. Generate search URLs based on keywords (Google News, Naver News)
 * 2. Crawl URLs using Crawl4AI service
 * 3. Aggregate crawled content
 * 4. Analyze aggregated content with AI Dove
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class CrawlSearchService {

    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    private final AIDoveClient aiDoveClient;

    @Value("${collector.crawler.base-url:http://web-crawler:11235}")
    private String crawlerBaseUrl;

    @Value("${collector.crawler.timeout-seconds:60}")
    private int crawlerTimeoutSeconds;

    @Value("${collector.crawler.max-urls:5}")
    private int maxUrls;

    /**
     * Result of a crawl operation
     */
    public record CrawlResult(
            String url,
            String title,
            String content,
            boolean success,
            String error
    ) {
        public static CrawlResult success(String url, String title, String content) {
            return new CrawlResult(url, title, content, true, null);
        }

        public static CrawlResult failure(String url, String error) {
            return new CrawlResult(url, null, null, false, error);
        }
    }

    /**
     * Search and analyze news for a given keyword.
     * Returns a streaming response of the analysis.
     *
     * @param keyword The search keyword
     * @param window Time window (1d, 7d, 30d)
     * @return Flux of analysis text chunks
     */
    public Flux<String> searchAndAnalyze(String keyword, String window) {
        if (!aiDoveClient.isEnabled()) {
            return Flux.just("AI Dove 서비스가 비활성화되어 있습니다. 관리자에게 문의하세요.");
        }

        return Flux.concat(
                Flux.just("🔍 '" + keyword + "' 관련 뉴스를 검색하고 있습니다...\n\n"),
                performSearchAndAnalysis(keyword, window)
        );
    }

    private Flux<String> performSearchAndAnalysis(String keyword, String window) {
        List<String> searchUrls = generateSearchUrls(keyword, window);

        return Flux.fromIterable(searchUrls)
                .flatMap(this::crawlUrl, 3) // Parallel crawling with concurrency 3
                .collectList()
                .flatMapMany(results -> {
                    List<CrawlResult> successfulResults = results.stream()
                            .filter(CrawlResult::success)
                            .toList();

                    if (successfulResults.isEmpty()) {
                        return Flux.just(
                                "⚠️ 뉴스 크롤링에 실패했습니다.\n\n" +
                                "검색된 URL에서 콘텐츠를 가져올 수 없습니다.\n" +
                                "잠시 후 다시 시도하거나, Browser AI Agent를 사용해 보세요."
                        );
                    }

                    String aggregatedContent = aggregateContent(successfulResults, keyword, window);

                    return Flux.concat(
                            Flux.just("📰 " + successfulResults.size() + "개의 뉴스 소스를 분석 중...\n\n"),
                            analyzeWithAIDove(aggregatedContent, keyword)
                    );
                })
                .onErrorResume(e -> {
                    log.error("Search and analyze failed for keyword '{}': {}", keyword, e.getMessage());
                    return Flux.just(
                            "❌ 분석 중 오류가 발생했습니다: " + e.getMessage() + "\n\n" +
                            "Browser AI Agent 또는 Deep AI Search를 사용해 보세요."
                    );
                });
    }

    /**
     * Generate search URLs for the given keyword.
     */
    private List<String> generateSearchUrls(String keyword, String window) {
        List<String> urls = new ArrayList<>();
        String encodedKeyword = URLEncoder.encode(keyword, StandardCharsets.UTF_8);

        // Google News search
        String googleNewsUrl = "https://news.google.com/search?q=" + encodedKeyword + "&hl=ko&gl=KR&ceid=KR:ko";
        urls.add(googleNewsUrl);

        // Naver News search
        String naverNewsUrl = "https://search.naver.com/search.naver?where=news&query=" + encodedKeyword;
        urls.add(naverNewsUrl);

        // Daum News search
        String daumNewsUrl = "https://search.daum.net/search?w=news&q=" + encodedKeyword;
        urls.add(daumNewsUrl);

        // Add time-specific search if needed
        if ("1d".equals(window)) {
            // Google News sorted by date (last 24 hours)
            String recentGoogleUrl = "https://www.google.com/search?q=" + encodedKeyword + 
                    "+site:news.google.com&tbs=qdr:d&tbm=nws";
            urls.add(recentGoogleUrl);
        } else if ("30d".equals(window)) {
            // Google News last month
            String monthlyGoogleUrl = "https://www.google.com/search?q=" + encodedKeyword + 
                    "+site:news.google.com&tbs=qdr:m&tbm=nws";
            urls.add(monthlyGoogleUrl);
        }

        return urls.stream().limit(maxUrls).toList();
    }

    /**
     * Crawl a single URL using Crawl4AI.
     */
    private Mono<CrawlResult> crawlUrl(String url) {
        log.debug("Crawling URL: {}", url);

        String crawlEndpoint = crawlerBaseUrl.endsWith("/") 
                ? crawlerBaseUrl + "md" 
                : crawlerBaseUrl + "/md";

        Map<String, Object> payload = Map.of(
                "url", url,
                "bypass_cache", true,
                "word_count_threshold", 50
        );

        return webClient.post()
                .uri(crawlEndpoint)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(payload)
                .retrieve()
                .bodyToMono(String.class)
                .timeout(Duration.ofSeconds(crawlerTimeoutSeconds))
                .map(response -> parseCrawlResponse(url, response))
                .onErrorResume(e -> {
                    log.warn("Failed to crawl {}: {}", url, e.getMessage());
                    return Mono.just(CrawlResult.failure(url, e.getMessage()));
                });
    }

    private CrawlResult parseCrawlResponse(String url, String response) {
        try {
            JsonNode node = objectMapper.readTree(response);

            // Try to extract markdown or content
            String content = null;
            String title = null;

            if (node.has("result")) {
                JsonNode result = node.get("result");
                if (result.has("markdown")) {
                    content = result.get("markdown").asText();
                }
                if (result.has("metadata") && result.get("metadata").has("title")) {
                    title = result.get("metadata").get("title").asText();
                }
            } else if (node.has("markdown")) {
                content = node.get("markdown").asText();
            } else if (node.has("content")) {
                content = node.get("content").asText();
            } else {
                // Fallback: use raw response if it looks like text
                content = response;
            }

            if (content == null || content.isBlank()) {
                return CrawlResult.failure(url, "No content extracted");
            }

            // Truncate very long content
            if (content.length() > 10000) {
                content = content.substring(0, 10000) + "...[truncated]";
            }

            return CrawlResult.success(url, title, content);
        } catch (Exception e) {
            log.warn("Failed to parse crawl response for {}: {}", url, e.getMessage());
            return CrawlResult.failure(url, "Failed to parse response: " + e.getMessage());
        }
    }

    /**
     * Aggregate crawled content into a single prompt for AI analysis.
     */
    private String aggregateContent(List<CrawlResult> results, String keyword, String window) {
        StringBuilder sb = new StringBuilder();
        sb.append("다음은 '").append(keyword).append("' 키워드로 검색한 뉴스 콘텐츠입니다:\n\n");

        int index = 1;
        for (CrawlResult result : results) {
            sb.append("--- 뉴스 소스 ").append(index++).append(" ---\n");
            if (result.title() != null) {
                sb.append("제목: ").append(result.title()).append("\n");
            }
            sb.append("URL: ").append(result.url()).append("\n");
            sb.append("내용:\n").append(result.content()).append("\n\n");
        }

        return sb.toString();
    }

    /**
     * Analyze aggregated content with AI Dove.
     */
    private Flux<String> analyzeWithAIDove(String aggregatedContent, String keyword) {
        String analysisPrompt = buildAnalysisPrompt(aggregatedContent, keyword);

        return aiDoveClient.chatStream(analysisPrompt, null)
                .onErrorResume(e -> {
                    log.error("AI Dove analysis failed: {}", e.getMessage());
                    return Flux.just("AI 분석 중 오류가 발생했습니다: " + e.getMessage());
                });
    }

    private String buildAnalysisPrompt(String aggregatedContent, String keyword) {
        return """
                당신은 뉴스 분석 전문가입니다. 아래 크롤링된 뉴스 콘텐츠를 분석하고 다음을 제공해 주세요:
                
                1. **핵심 요약**: '%s' 관련 주요 뉴스 흐름을 2-3문장으로 요약
                2. **주요 이슈**: bullet point로 3-5개의 핵심 이슈 정리
                3. **시장/산업 영향**: 관련 분야에 미치는 영향 분석
                4. **향후 전망**: 향후 예상되는 발전 방향
                5. **종합 의견**: 전체적인 분석 의견을 한 문단으로 정리
                
                반드시 한국어로 답변해 주세요.
                
                ---
                
                %s
                """.formatted(keyword, aggregatedContent);
    }

    /**
     * Check if the service is available.
     */
    public boolean isAvailable() {
        return aiDoveClient.isEnabled();
    }
}
