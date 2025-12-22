package com.newsinsight.collector.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.client.AIDoveClient;
import com.newsinsight.collector.client.Crawl4aiClient;
import com.newsinsight.collector.dto.CrawledPage;
import com.newsinsight.collector.dto.EvidenceDto;
import com.newsinsight.collector.entity.EvidenceStance;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Integrated Crawler Service
 * 
 * Combines multiple crawling strategies for deep, comprehensive web crawling:
 * 1. Crawl4AI - Fast, efficient web scraping
 * 2. Browser-Use API - JavaScript-rendered content with AI agent
 * 3. Direct HTTP - Lightweight fallback
 * 4. Search Engines - Google, Naver, Daum news aggregation
 * 
 * Features:
 * - Multi-depth recursive crawling
 * - Link extraction and following
 * - AI-powered stance analysis
 * - Evidence collection and classification
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class IntegratedCrawlerService {

    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    private final Crawl4aiClient crawl4aiClient;
    private final AIDoveClient aiDoveClient;

    @Value("${collector.crawler.base-url:http://web-crawler:11235}")
    private String crawl4aiBaseUrl;

    @Value("${collector.browser-use.base-url:http://browser-use-api:8500}")
    private String browserUseBaseUrl;

    @Value("${collector.integrated-crawler.max-depth:2}")
    private int maxDepth;

    @Value("${collector.integrated-crawler.max-pages:20}")
    private int maxPages;

    @Value("${collector.integrated-crawler.timeout-seconds:30}")
    private int timeoutSeconds;

    @Value("${collector.integrated-crawler.concurrent-crawls:5}")
    private int concurrentCrawls;

    /**
     * Crawling strategy enum
     */
    public enum CrawlStrategy {
        CRAWL4AI,       // Use Crawl4AI service
        BROWSER_USE,    // Use Browser-Use API for JS rendering
        DIRECT_HTTP,    // Direct HTTP fetch with Jsoup
        SEARCH_ENGINE   // Search engine aggregation
    }

    /**
     * Crawl request with options
     */
    public record CrawlRequest(
            String topic,
            String baseUrl,
            int maxDepth,
            int maxPages,
            Set<CrawlStrategy> strategies,
            boolean extractEvidence
    ) {
        public static CrawlRequest forTopic(String topic) {
            return new CrawlRequest(topic, null, 2, 20, 
                    EnumSet.of(CrawlStrategy.CRAWL4AI, CrawlStrategy.SEARCH_ENGINE), true);
        }

        public static CrawlRequest forUrl(String topic, String baseUrl) {
            return new CrawlRequest(topic, baseUrl, 2, 15, 
                    EnumSet.of(CrawlStrategy.CRAWL4AI, CrawlStrategy.DIRECT_HTTP), true);
        }
    }

    /**
     * Crawl result containing all collected pages and evidence
     */
    public record CrawlResult(
            String topic,
            List<CrawledPage> pages,
            List<EvidenceDto> evidence,
            Map<String, Object> metadata
    ) {}

    /**
     * Progress callback interface
     */
    public interface CrawlProgressCallback {
        void onProgress(int current, int total, String message);
        void onPageCrawled(CrawledPage page);
        void onEvidenceFound(EvidenceDto evidence);
        void onError(String url, String error);
    }

    /**
     * Perform integrated deep crawling for a topic
     */
    public Mono<CrawlResult> crawl(CrawlRequest request, CrawlProgressCallback callback) {
        log.info("Starting integrated crawl: topic={}, strategies={}", request.topic(), request.strategies());

        Set<String> visitedUrls = ConcurrentHashMap.newKeySet();
        List<CrawledPage> allPages = Collections.synchronizedList(new ArrayList<>());
        List<EvidenceDto> allEvidence = Collections.synchronizedList(new ArrayList<>());

        // Generate initial URLs based on strategies
        List<String> seedUrls = generateSeedUrls(request);
        
        if (callback != null) {
            callback.onProgress(0, seedUrls.size(), "Starting crawl with " + seedUrls.size() + " seed URLs");
        }

        return Flux.fromIterable(seedUrls)
                .flatMap(url -> crawlWithStrategies(url, request.topic(), request.strategies(), visitedUrls, 0, request.maxDepth()),
                        concurrentCrawls)
                .doOnNext(page -> {
                    allPages.add(page);
                    if (callback != null) {
                        callback.onPageCrawled(page);
                        callback.onProgress(allPages.size(), request.maxPages(), "Crawled: " + page.url());
                    }
                })
                .takeUntil(page -> allPages.size() >= request.maxPages())
                .collectList()
                .flatMap(pages -> {
                    // 크롤링 결과가 없을 경우 기본 evidence 생성
                    if (pages.isEmpty()) {
                        log.warn("No pages crawled, generating fallback evidence for topic: {}", request.topic());
                        List<EvidenceDto> fallbackEvidence = generateFallbackEvidence(request.topic(), callback);
                        allEvidence.addAll(fallbackEvidence);
                        return Mono.just(createResult(request.topic(), allPages, allEvidence));
                    }
                    
                    if (request.extractEvidence()) {
                        return extractEvidence(pages, request.topic(), callback)
                                .collectList()
                                .flatMap(evidence -> {
                                    allEvidence.addAll(evidence);
                                    // 크롤링은 했지만 evidence가 없을 경우에도 fallback 생성
                                    if (allEvidence.isEmpty()) {
                                        log.warn("Pages crawled but no evidence extracted, generating fallback for topic: {}", request.topic());
                                        List<EvidenceDto> fallbackEvidence = generateFallbackEvidence(request.topic(), callback);
                                        allEvidence.addAll(fallbackEvidence);
                                    }
                                    return Mono.just(createResult(request.topic(), allPages, allEvidence));
                                });
                    }
                    return Mono.just(createResult(request.topic(), allPages, allEvidence));
                })
                .doOnSuccess(result -> log.info("Crawl completed: topic={}, pages={}, evidence={}", 
                        request.topic(), result.pages().size(), result.evidence().size()));
    }

    /**
     * Generate fallback evidence when crawling fails
     * Uses AI Dove to generate topic analysis without external crawling
     */
    private List<EvidenceDto> generateFallbackEvidence(String topic, CrawlProgressCallback callback) {
        if (callback != null) {
            callback.onProgress(50, 100, "외부 크롤링 실패 - AI 분석으로 대체");
        }
        
        // AI Dove를 사용하여 주제 분석 시도
        if (aiDoveClient.isEnabled()) {
            try {
                String prompt = """
                    주제 '%s'에 대해 분석해주세요. 
                    다음 형식으로 JSON 배열을 반환해주세요:
                    [
                      {"title": "관점 제목", "snippet": "해당 관점에 대한 설명 (2-3문장)", "stance": "pro" 또는 "con" 또는 "neutral", "source": "AI 분석"}
                    ]
                    최소 3개, 최대 5개의 다양한 관점을 포함해주세요.
                    JSON 배열만 반환하세요.
                    """.formatted(topic);
                
                var response = aiDoveClient.chat(prompt, null).block();
                if (response != null && response.reply() != null) {
                    String json = extractJsonArray(response.reply());
                    if (json != null) {
                        JsonNode evidenceArray = objectMapper.readTree(json);
                        List<EvidenceDto> evidence = new ArrayList<>();
                        int id = 1;
                        for (JsonNode node : evidenceArray) {
                            EvidenceDto e = EvidenceDto.builder()
                                    .id((long) id++)
                                    .url("https://ai-analysis/" + topic.hashCode() + "/" + id)
                                    .title(node.has("title") ? node.get("title").asText() : "AI 분석 결과")
                                    .stance(node.has("stance") ? node.get("stance").asText().toLowerCase() : "neutral")
                                    .snippet(node.has("snippet") ? node.get("snippet").asText() : "")
                                    .source("AI 분석")
                                    .build();
                            evidence.add(e);
                            if (callback != null) {
                                callback.onEvidenceFound(e);
                            }
                        }
                        log.info("Generated {} AI fallback evidence items for topic: {}", evidence.size(), topic);
                        return evidence;
                    }
                }
            } catch (Exception e) {
                log.warn("AI fallback evidence generation failed: {}", e.getMessage());
            }
        }
        
        // AI도 실패할 경우 기본 메시지 반환
        log.warn("All evidence generation methods failed for topic: {}", topic);
        EvidenceDto defaultEvidence = EvidenceDto.builder()
                .id(1L)
                .url("https://newsinsight.local/analysis")
                .title("분석 결과 없음")
                .stance("neutral")
                .snippet("'" + topic + "'에 대한 외부 자료를 수집하지 못했습니다. 인터넷 연결 또는 외부 서비스 상태를 확인해주세요.")
                .source("시스템")
                .build();
        
        if (callback != null) {
            callback.onEvidenceFound(defaultEvidence);
        }
        
        return List.of(defaultEvidence);
    }

    /**
     * Generate seed URLs for crawling based on topic and strategies
     */
    private List<String> generateSeedUrls(CrawlRequest request) {
        List<String> urls = new ArrayList<>();
        String encodedTopic = URLEncoder.encode(request.topic(), StandardCharsets.UTF_8);

        // If base URL provided, use it
        if (request.baseUrl() != null && !request.baseUrl().isBlank()) {
            urls.add(request.baseUrl());
        }

        // Add search engine URLs
        if (request.strategies().contains(CrawlStrategy.SEARCH_ENGINE)) {
            // Google News Korea
            urls.add("https://news.google.com/search?q=" + encodedTopic + "&hl=ko&gl=KR&ceid=KR:ko");
            
            // Naver News
            urls.add("https://search.naver.com/search.naver?where=news&query=" + encodedTopic);
            
            // Daum News
            urls.add("https://search.daum.net/search?w=news&q=" + encodedTopic);
            
            // Google News English (for broader coverage)
            urls.add("https://news.google.com/search?q=" + encodedTopic + "&hl=en&gl=US&ceid=US:en");
        }

        return urls;
    }

    /**
     * Crawl URL using multiple strategies with fallback
     */
    private Flux<CrawledPage> crawlWithStrategies(String url, String topic, Set<CrawlStrategy> strategies,
                                                   Set<String> visitedUrls, int currentDepth, int maxDepth) {
        if (visitedUrls.contains(url) || currentDepth > maxDepth) {
            return Flux.empty();
        }
        visitedUrls.add(url);

        // Try strategies in order of preference
        Mono<CrawledPage> crawlMono = Mono.empty();

        if (strategies.contains(CrawlStrategy.CRAWL4AI)) {
            crawlMono = crawlMono.switchIfEmpty(crawlWithCrawl4AI(url));
        }
        if (strategies.contains(CrawlStrategy.BROWSER_USE)) {
            crawlMono = crawlMono.switchIfEmpty(crawlWithBrowserUse(url, topic));
        }
        if (strategies.contains(CrawlStrategy.DIRECT_HTTP)) {
            crawlMono = crawlMono.switchIfEmpty(crawlDirect(url));
        }

        return crawlMono
                .flux()
                .flatMap(page -> {
                    // Extract links for recursive crawling
                    if (currentDepth < maxDepth && page.content() != null) {
                        List<String> links = extractLinks(page.content(), url, topic);
                        return Flux.concat(
                                Flux.just(page),
                                Flux.fromIterable(links)
                                        .filter(link -> !visitedUrls.contains(link))
                                        .take(15) // Limit links per page (increased from 5)
                                        .flatMap(link -> crawlWithStrategies(link, topic, strategies, visitedUrls, currentDepth + 1, maxDepth))
                        );
                    }
                    return Flux.just(page);
                })
                .onErrorResume(e -> {
                    log.warn("Failed to crawl {}: {}", url, e.getMessage());
                    return Flux.empty();
                });
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
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .map(response -> parseCrawl4AIResponse(url, response))
                .filter(page -> page.content() != null && !page.content().isBlank())
                .doOnSuccess(page -> log.debug("Crawl4AI success: {}", url))
                .onErrorResume(e -> {
                    log.debug("Crawl4AI failed for {}: {}", url, e.getMessage());
                    return Mono.empty();
                });
    }

    /**
     * Crawl using Browser-Use API for JavaScript-rendered content
     */
    private Mono<CrawledPage> crawlWithBrowserUse(String url, String topic) {
        String endpoint = browserUseBaseUrl + "/browse";

        Map<String, Object> payload = Map.of(
                "task", "Navigate to the URL and extract all news content related to: " + topic,
                "url", url,
                "max_steps", 5,
                "timeout_seconds", timeoutSeconds,
                "headless", true
        );

        return webClient.post()
                .uri(endpoint)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(payload)
                .retrieve()
                .bodyToMono(String.class)
                .timeout(Duration.ofSeconds(timeoutSeconds + 10))
                .flatMap(response -> pollBrowserUseResult(response, url))
                .doOnSuccess(page -> log.debug("Browser-Use success: {}", url))
                .onErrorResume(e -> {
                    log.debug("Browser-Use failed for {}: {}", url, e.getMessage());
                    return Mono.empty();
                });
    }

    /**
     * Poll Browser-Use job for result
     */
    private Mono<CrawledPage> pollBrowserUseResult(String initialResponse, String url) {
        try {
            JsonNode node = objectMapper.readTree(initialResponse);
            String jobId = node.has("job_id") ? node.get("job_id").asText() : null;
            
            if (jobId == null) {
                // Immediate result
                String result = node.has("result") ? node.get("result").asText() : null;
                return Mono.justOrEmpty(result)
                        .map(r -> new CrawledPage(url, "Browser-Use Result", r, "browser-use", new ArrayList<>()));
            }

            // Poll for result
            return Flux.interval(Duration.ofSeconds(2))
                    .take(15) // Max 30 seconds of polling
                    .flatMap(i -> checkBrowserUseJob(jobId))
                    .filter(status -> "completed".equals(status.status()) || "failed".equals(status.status()))
                    .next()
                    .filter(status -> "completed".equals(status.status()))
                    .map(status -> new CrawledPage(url, "Browser-Use Result", status.result(), "browser-use", new ArrayList<>()));
        } catch (Exception e) {
            return Mono.empty();
        }
    }

    private record BrowserUseJobStatus(String status, String result) {}

    private Mono<BrowserUseJobStatus> checkBrowserUseJob(String jobId) {
        return webClient.get()
                .uri(browserUseBaseUrl + "/jobs/" + jobId)
                .retrieve()
                .bodyToMono(String.class)
                .map(response -> {
                    try {
                        JsonNode node = objectMapper.readTree(response);
                        return new BrowserUseJobStatus(
                                node.has("status") ? node.get("status").asText() : "unknown",
                                node.has("result") ? node.get("result").asText() : null
                        );
                    } catch (Exception e) {
                        return new BrowserUseJobStatus("error", null);
                    }
                })
                .onErrorReturn(new BrowserUseJobStatus("error", null));
    }

    /**
     * Direct HTTP crawl using Jsoup
     */
    private Mono<CrawledPage> crawlDirect(String url) {
        return Mono.fromCallable(() -> {
                    Document doc = Jsoup.connect(url)
                            .userAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                            .timeout(timeoutSeconds * 1000)
                            .followRedirects(true)
                            .get();

                    String title = doc.title();
                    String content = extractMainContent(doc);
                    List<String> links = extractDocumentLinks(doc, url);

                    return new CrawledPage(url, title, content, "direct", links);
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
            List<String> links = new ArrayList<>();

            if (node.has("result")) {
                JsonNode result = node.get("result");
                if (result.has("markdown")) {
                    content = result.get("markdown").asText();
                }
                if (result.has("metadata") && result.get("metadata").has("title")) {
                    title = result.get("metadata").get("title").asText();
                }
                if (result.has("links")) {
                    result.get("links").forEach(link -> {
                        if (link.has("href")) {
                            links.add(link.get("href").asText());
                        }
                    });
                }
            } else if (node.has("markdown")) {
                content = node.get("markdown").asText();
            }

            // Truncate very long content
            if (content != null && content.length() > 15000) {
                content = content.substring(0, 15000) + "\n...[truncated]";
            }

            return new CrawledPage(url, title, content, "crawl4ai", links);
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
        doc.select("script, style, nav, header, footer, aside, .advertisement, .ads, .sidebar").remove();

        // Try to find article content
        Element article = doc.selectFirst("article, .article, .content, .post-content, main, .main-content");
        if (article != null) {
            return article.text();
        }

        // Fallback to body
        Element body = doc.body();
        return body != null ? body.text() : doc.text();
    }

    /**
     * Extract links from document
     */
    private List<String> extractDocumentLinks(Document doc, String baseUrl) {
        List<String> links = new ArrayList<>();
        Elements anchors = doc.select("a[href]");

        for (Element anchor : anchors) {
            String href = anchor.absUrl("href");
            if (isValidNewsLink(href, baseUrl)) {
                links.add(href);
            }
        }

        return links.stream().distinct().limit(30).collect(Collectors.toList());
    }

    /**
     * Extract links from markdown/text content
     */
    private List<String> extractLinks(String content, String baseUrl, String topic) {
        List<String> links = new ArrayList<>();
        
        // URL pattern
        Pattern urlPattern = Pattern.compile("https?://[\\w\\-._~:/?#\\[\\]@!$&'()*+,;=%]+", Pattern.CASE_INSENSITIVE);
        Matcher matcher = urlPattern.matcher(content);

        while (matcher.find()) {
            String url = matcher.group();
            if (isValidNewsLink(url, baseUrl)) {
                links.add(url);
            }
        }

        return links.stream().distinct().limit(30).collect(Collectors.toList());
    }

    /**
     * Check if link is a valid news article link
     */
    private boolean isValidNewsLink(String url, String baseUrl) {
        if (url == null || url.isBlank()) return false;
        
        try {
            URI uri = URI.create(url);
            String host = uri.getHost();
            if (host == null) return false;

            // Skip common non-news domains
            if (host.contains("facebook.com") || host.contains("twitter.com") ||
                host.contains("instagram.com") || host.contains("youtube.com") ||
                host.contains("linkedin.com") || host.contains("tiktok.com")) {
                return false;
            }

            // Skip non-http URLs
            String scheme = uri.getScheme();
            if (!"http".equals(scheme) && !"https".equals(scheme)) {
                return false;
            }

            // Skip media files
            String path = uri.getPath();
            if (path != null && (path.endsWith(".jpg") || path.endsWith(".png") ||
                path.endsWith(".gif") || path.endsWith(".pdf") || path.endsWith(".mp4"))) {
                return false;
            }

            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Extract evidence from crawled pages using AI
     */
    private Flux<EvidenceDto> extractEvidence(List<CrawledPage> pages, String topic, CrawlProgressCallback callback) {
        if (!aiDoveClient.isEnabled()) {
            log.warn("AI Dove is disabled, using simple extraction");
            return Flux.fromIterable(pages)
                    .map(page -> createSimpleEvidence(page, topic));
        }

        String aggregatedContent = aggregateContent(pages, topic);
        String prompt = buildEvidenceExtractionPrompt(aggregatedContent, topic);

        return aiDoveClient.chat(prompt, null)
                .flatMapMany(response -> parseEvidenceFromAI(response.reply(), pages, topic))
                .doOnNext(evidence -> {
                    if (callback != null) {
                        callback.onEvidenceFound(evidence);
                    }
                })
                .onErrorResume(e -> {
                    log.error("AI evidence extraction failed: {}", e.getMessage());
                    // Fallback to simple extraction
                    return Flux.fromIterable(pages)
                            .map(page -> createSimpleEvidence(page, topic));
                });
    }

    /**
     * Aggregate content from multiple pages for AI analysis
     */
    private String aggregateContent(List<CrawledPage> pages, String topic) {
        StringBuilder sb = new StringBuilder();
        sb.append("Topic: ").append(topic).append("\n\n");

        int index = 1;
        for (CrawledPage page : pages) {
            if (page.content() == null || page.content().isBlank()) continue;

            sb.append("=== Source ").append(index++).append(" ===\n");
            sb.append("URL: ").append(page.url()).append("\n");
            if (page.title() != null) {
                sb.append("Title: ").append(page.title()).append("\n");
            }
            
            // Limit content per page
            String content = page.content();
            if (content.length() > 3000) {
                content = content.substring(0, 3000) + "...[truncated]";
            }
            sb.append("Content:\n").append(content).append("\n\n");

            if (sb.length() > 20000) {
                sb.append("\n...[additional sources truncated]\n");
                break;
            }
        }

        return sb.toString();
    }

    /**
     * Build prompt for evidence extraction
     */
    private String buildEvidenceExtractionPrompt(String content, String topic) {
        return """
                You are an expert fact-checker and evidence analyst. Analyze the following news content about "%s" and extract evidence.

                For each piece of evidence, determine:
                1. The stance (pro/con/neutral) - whether it supports, opposes, or is neutral to the topic
                2. A brief snippet summarizing the key point
                3. The source URL and title

                Return your analysis as a JSON array with the following structure:
                [
                  {
                    "url": "source URL",
                    "title": "article title",
                    "stance": "pro" | "con" | "neutral",
                    "snippet": "key evidence snippet (1-2 sentences)",
                    "source": "publication name"
                  }
                ]

                Only include factual evidence, not opinions. Maximum 10 pieces of evidence.
                Respond ONLY with the JSON array, no other text.

                --- CONTENT ---
                %s
                """.formatted(topic, content);
    }

    /**
     * Parse evidence from AI response
     */
    private Flux<EvidenceDto> parseEvidenceFromAI(String aiResponse, List<CrawledPage> pages, String topic) {
        try {
            // Extract JSON array from response
            String json = extractJsonArray(aiResponse);
            if (json == null) {
                return Flux.fromIterable(pages).map(page -> createSimpleEvidence(page, topic));
            }

            JsonNode evidenceArray = objectMapper.readTree(json);
            List<EvidenceDto> evidenceList = new ArrayList<>();

            for (JsonNode node : evidenceArray) {
                EvidenceDto evidence = EvidenceDto.builder()
                        .url(node.has("url") ? node.get("url").asText() : "")
                        .title(node.has("title") ? node.get("title").asText() : "")
                        .stance(node.has("stance") ? node.get("stance").asText().toLowerCase() : "neutral")
                        .snippet(node.has("snippet") ? node.get("snippet").asText() : "")
                        .source(node.has("source") ? node.get("source").asText() : "")
                        .build();
                evidenceList.add(evidence);
            }

            return Flux.fromIterable(evidenceList);
        } catch (Exception e) {
            log.warn("Failed to parse AI evidence response: {}", e.getMessage());
            return Flux.fromIterable(pages).map(page -> createSimpleEvidence(page, topic));
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

    /**
     * Create simple evidence from page without AI
     */
    private EvidenceDto createSimpleEvidence(CrawledPage page, String topic) {
        String snippet = page.content();
        if (snippet != null && snippet.length() > 300) {
            snippet = snippet.substring(0, 300) + "...";
        }

        return EvidenceDto.builder()
                .url(page.url())
                .title(page.title() != null ? page.title() : "Untitled")
                .stance("neutral")
                .snippet(snippet != null ? snippet : "")
                .source(extractDomain(page.url()))
                .build();
    }

    /**
     * Extract domain from URL
     */
    private String extractDomain(String url) {
        try {
            URI uri = URI.create(url);
            return uri.getHost();
        } catch (Exception e) {
            return url;
        }
    }

    /**
     * Create final result
     */
    private CrawlResult createResult(String topic, List<CrawledPage> pages, List<EvidenceDto> evidence) {
        Map<String, Object> metadata = new HashMap<>();
        metadata.put("totalPages", pages.size());
        metadata.put("totalEvidence", evidence.size());
        metadata.put("sources", pages.stream().map(CrawledPage::source).distinct().collect(Collectors.toList()));

        // Calculate stance distribution
        Map<String, Long> stanceCount = evidence.stream()
                .collect(Collectors.groupingBy(EvidenceDto::getStance, Collectors.counting()));
        metadata.put("stanceDistribution", stanceCount);

        return new CrawlResult(topic, pages, evidence, metadata);
    }

    /**
     * Check if service is available
     */
    public boolean isAvailable() {
        return true; // At least direct HTTP is always available
    }

    /**
     * Get available strategies
     */
    public Set<CrawlStrategy> getAvailableStrategies() {
        Set<CrawlStrategy> strategies = EnumSet.of(CrawlStrategy.DIRECT_HTTP, CrawlStrategy.SEARCH_ENGINE);
        
        // Check Crawl4AI
        try {
            webClient.get()
                    .uri(crawl4aiBaseUrl + "/health")
                    .retrieve()
                    .bodyToMono(String.class)
                    .timeout(Duration.ofSeconds(5))
                    .block();
            strategies.add(CrawlStrategy.CRAWL4AI);
        } catch (Exception e) {
            log.debug("Crawl4AI not available: {}", e.getMessage());
        }

        // Check Browser-Use
        try {
            webClient.get()
                    .uri(browserUseBaseUrl + "/health")
                    .retrieve()
                    .bodyToMono(String.class)
                    .timeout(Duration.ofSeconds(5))
                    .block();
            strategies.add(CrawlStrategy.BROWSER_USE);
        } catch (Exception e) {
            log.debug("Browser-Use not available: {}", e.getMessage());
        }

        return strategies;
    }
}
