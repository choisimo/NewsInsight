package com.newsinsight.collector.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.client.AIDoveClient;
import com.newsinsight.collector.dto.ClaimExtractionRequest;
import com.newsinsight.collector.dto.ClaimExtractionResponse;
import com.newsinsight.collector.dto.ClaimExtractionResponse.ExtractedClaim;
import com.newsinsight.collector.dto.CrawledPage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.net.URI;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Service for extracting verifiable claims from URLs.
 * 
 * Uses IntegratedCrawler for content extraction and AI Dove for claim analysis.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ClaimExtractionService {

    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    private final AIDoveClient aiDoveClient;

    @Value("${collector.crawler.base-url:http://web-crawler:11235}")
    private String crawl4aiBaseUrl;

    @Value("${collector.claim-extraction.timeout-seconds:60}")
    private int timeoutSeconds;

    @Value("${collector.claim-extraction.max-claims:10}")
    private int defaultMaxClaims;

    @Value("${collector.claim-extraction.min-confidence:0.5}")
    private double defaultMinConfidence;

    /**
     * Extract claims from a URL.
     * 
     * Pipeline:
     * 1. Crawl the URL to get page content
     * 2. Send content to AI Dove with claim extraction prompt
     * 3. Parse and return structured claims
     */
    public Mono<ClaimExtractionResponse> extractClaims(ClaimExtractionRequest request) {
        long startTime = System.currentTimeMillis();
        String url = request.getUrl();
        int maxClaims = request.getMaxClaims() != null ? request.getMaxClaims() : defaultMaxClaims;
        double minConfidence = request.getMinConfidence() != null ? request.getMinConfidence() : defaultMinConfidence;

        log.info("Starting claim extraction for URL: {}", url);

        return crawlUrl(url)
                .flatMap(page -> {
                    if (page.content() == null || page.content().isBlank()) {
                        return Mono.just(ClaimExtractionResponse.builder()
                                .url(url)
                                .pageTitle(page.title())
                                .claims(Collections.emptyList())
                                .processingTimeMs(System.currentTimeMillis() - startTime)
                                .extractionSource(page.source())
                                .message("페이지에서 분석할 수 있는 콘텐츠를 찾지 못했습니다.")
                                .build());
                    }

                    return extractClaimsFromContent(page.content(), page.title(), maxClaims)
                            .map(claims -> {
                                // Filter by minimum confidence
                                List<ExtractedClaim> filteredClaims = claims.stream()
                                        .filter(c -> c.getConfidence() >= minConfidence)
                                        .toList();

                                return ClaimExtractionResponse.builder()
                                        .url(url)
                                        .pageTitle(page.title())
                                        .claims(filteredClaims)
                                        .processingTimeMs(System.currentTimeMillis() - startTime)
                                        .extractionSource(page.source())
                                        .message(filteredClaims.isEmpty() 
                                                ? "검증 가능한 주장을 찾지 못했습니다." 
                                                : null)
                                        .build();
                            });
                })
                .onErrorResume(e -> {
                    log.error("Claim extraction failed for URL {}: {}", url, e.getMessage());
                    return Mono.just(ClaimExtractionResponse.builder()
                            .url(url)
                            .claims(Collections.emptyList())
                            .processingTimeMs(System.currentTimeMillis() - startTime)
                            .message("주장 추출 실패: " + e.getMessage())
                            .build());
                });
    }

    /**
     * Crawl URL using multiple strategies with fallback
     */
    private Mono<CrawledPage> crawlUrl(String url) {
        // Try Crawl4AI first
        return crawlWithCrawl4AI(url)
                .switchIfEmpty(crawlDirect(url))
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .doOnSuccess(page -> log.debug("Successfully crawled: {} using {}", url, page.source()));
    }

    /**
     * Crawl using Crawl4AI service
     */
    private Mono<CrawledPage> crawlWithCrawl4AI(String url) {
        String endpoint = crawl4aiBaseUrl + "/md";

        Map<String, Object> payload = Map.of(
                "url", url,
                "bypass_cache", true,
                "word_count_threshold", 50,
                "remove_overlay_elements", true,
                "process_iframes", true
        );

        return webClient.post()
                .uri(endpoint)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(payload)
                .retrieve()
                .bodyToMono(String.class)
                .timeout(Duration.ofSeconds(30))
                .map(response -> parseCrawl4AIResponse(url, response))
                .filter(page -> page.content() != null && !page.content().isBlank())
                .doOnSuccess(page -> log.debug("Crawl4AI success: {}", url))
                .onErrorResume(e -> {
                    log.debug("Crawl4AI failed for {}: {}", url, e.getMessage());
                    return Mono.empty();
                });
    }

    /**
     * Direct HTTP crawl using Jsoup
     */
    private Mono<CrawledPage> crawlDirect(String url) {
        return Mono.fromCallable(() -> {
                    Document doc = Jsoup.connect(url)
                            .userAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
                            .timeout(30000)
                            .followRedirects(true)
                            .get();

                    String title = doc.title();
                    String content = extractMainContent(doc);

                    return new CrawledPage(url, title, content, "direct", new ArrayList<>());
                })
                .subscribeOn(Schedulers.boundedElastic())
                .filter(page -> page.content() != null && page.content().length() > 100)
                .doOnSuccess(page -> log.debug("Direct crawl success: {}", url))
                .onErrorResume(e -> {
                    log.debug("Direct crawl failed for {}: {}", url, e.getMessage());
                    return Mono.empty();
                });
    }

    /**
     * Parse Crawl4AI response
     */
    private CrawledPage parseCrawl4AIResponse(String url, String response) {
        try {
            JsonNode node = objectMapper.readTree(response);
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
            }

            // Truncate very long content
            if (content != null && content.length() > 15000) {
                content = content.substring(0, 15000) + "\n...[truncated]";
            }

            return new CrawledPage(url, title, content, "crawl4ai", new ArrayList<>());
        } catch (Exception e) {
            log.warn("Failed to parse Crawl4AI response for {}: {}", url, e.getMessage());
            return new CrawledPage(url, null, null, "crawl4ai", new ArrayList<>());
        }
    }

    /**
     * Extract main content from HTML document
     */
    private String extractMainContent(Document doc) {
        // Remove unwanted elements
        doc.select("script, style, nav, header, footer, aside, .advertisement, .ads, .sidebar, .comment, .comments").remove();

        // Try to find article content
        Element article = doc.selectFirst("article, .article, .content, .post-content, main, .main-content, .article-body, .entry-content");
        if (article != null) {
            return article.text();
        }

        // Fallback to body
        Element body = doc.body();
        return body != null ? body.text() : doc.text();
    }

    /**
     * Extract claims from content using AI Dove
     */
    private Mono<List<ExtractedClaim>> extractClaimsFromContent(String content, String title, int maxClaims) {
        if (!aiDoveClient.isEnabled()) {
            log.warn("AI Dove is disabled, cannot extract claims");
            return Mono.just(Collections.emptyList());
        }

        String prompt = buildClaimExtractionPrompt(content, title, maxClaims);

        return aiDoveClient.chat(prompt, null)
                .map(response -> parseClaimsFromAI(response.reply()))
                .onErrorResume(e -> {
                    log.error("AI claim extraction failed: {}", e.getMessage());
                    return Mono.just(Collections.emptyList());
                });
    }

    /**
     * Build prompt for claim extraction
     */
    private String buildClaimExtractionPrompt(String content, String title, int maxClaims) {
        // Truncate content if too long
        String truncatedContent = content;
        if (content.length() > 10000) {
            truncatedContent = content.substring(0, 10000) + "\n...[truncated]";
        }

        return """
                You are an expert fact-checker. Analyze the following news article and extract verifiable claims.
                
                A "verifiable claim" is a factual statement that can be confirmed or refuted through evidence.
                Do NOT include opinions, predictions, or subjective statements.
                
                For each claim, provide:
                1. The exact claim text (1-2 sentences)
                2. A confidence score (0.0-1.0) indicating how clearly stated the claim is
                3. The context where it was found (e.g., "headline", "first paragraph", "statistics section")
                4. The type of claim: "statistical" (numbers/data), "event" (something happened), "quote" (attributed statement), "general" (other factual claims)
                5. Whether it's verifiable (true/false)
                
                Return ONLY a JSON array with this structure (no other text):
                [
                  {
                    "text": "The claim text",
                    "confidence": 0.85,
                    "context": "Found in the opening paragraph",
                    "claimType": "statistical",
                    "verifiable": true
                  }
                ]
                
                Extract up to %d claims. Prioritize:
                1. Statistical claims (numbers, percentages, data)
                2. Event claims (specific things that happened)
                3. Attributed quotes (statements from named sources)
                
                Title: %s
                
                Content:
                %s
                """.formatted(maxClaims, title != null ? title : "Unknown", truncatedContent);
    }

    /**
     * Parse claims from AI response
     */
    private List<ExtractedClaim> parseClaimsFromAI(String aiResponse) {
        if (aiResponse == null || aiResponse.isBlank()) {
            return Collections.emptyList();
        }

        try {
            // Extract JSON array from response
            String json = extractJsonArray(aiResponse);
            if (json == null) {
                log.warn("No JSON array found in AI response");
                return Collections.emptyList();
            }

            JsonNode claimsArray = objectMapper.readTree(json);
            List<ExtractedClaim> claims = new ArrayList<>();
            AtomicInteger idCounter = new AtomicInteger(1);

            for (JsonNode node : claimsArray) {
                ExtractedClaim claim = ExtractedClaim.builder()
                        .id("claim-" + idCounter.getAndIncrement())
                        .text(node.has("text") ? node.get("text").asText() : "")
                        .confidence(node.has("confidence") ? node.get("confidence").asDouble() : 0.7)
                        .context(node.has("context") ? node.get("context").asText() : null)
                        .claimType(node.has("claimType") ? node.get("claimType").asText() : "general")
                        .verifiable(node.has("verifiable") ? node.get("verifiable").asBoolean() : true)
                        .build();

                // Only add claims with actual text
                if (claim.getText() != null && !claim.getText().isBlank()) {
                    claims.add(claim);
                }
            }

            log.info("Extracted {} claims from AI response", claims.size());
            return claims;
        } catch (Exception e) {
            log.warn("Failed to parse AI claims response: {}", e.getMessage());
            return Collections.emptyList();
        }
    }

    /**
     * Extract JSON array from text that may contain other content
     */
    private String extractJsonArray(String text) {
        if (text == null) return null;

        int start = text.indexOf('[');
        int end = text.lastIndexOf(']');

        if (start >= 0 && end > start) {
            return text.substring(start, end + 1);
        }
        return null;
    }
}
