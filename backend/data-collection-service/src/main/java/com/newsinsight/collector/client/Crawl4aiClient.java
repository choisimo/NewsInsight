package com.newsinsight.collector.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.jsoup.Jsoup;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.net.URI;
import java.time.Duration;

/**
 * Lightweight client for the Crawl4AI service.
 * Tries to call /crawl at the configured base URL and extract text content.
 * If the API responds with JSON, attempts to read common fields like
 * "content", "markdown", "text", or "html". Falls back to plain text.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class Crawl4aiClient {

    private final WebClient webClient;
    private final ObjectMapper objectMapper;

    @Value("${collector.crawler.base-url:http://web-crawler:11235}")
    private String baseUrl;

    @Value("${collector.http.timeout.read:30000}")
    private int readTimeoutMs;

    @Data
    @Builder
    @AllArgsConstructor
    public static class CrawlResult {
        private String title;
        private String content; // normalized text content
    }

    /**
     * Attempts to crawl the given URL via Crawl4AI. Returns null on failure.
     */
    public CrawlResult crawl(String targetUrl) {
        try {
            String endpoint = baseUrl.endsWith("/") ? baseUrl + "crawl" : baseUrl + "/crawl";

            Mono<CrawlResult> mono = webClient
                    .get()
                    .uri(uriBuilder -> {
                        URI uri = URI.create(endpoint);
                        return uriBuilder
                                .scheme(uri.getScheme())
                                .host(uri.getHost())
                                .port(uri.getPort())
                                .path(uri.getPath())
                                .queryParam("url", targetUrl)
                                .build();
                    })
                    .accept(MediaType.APPLICATION_JSON, MediaType.TEXT_PLAIN, MediaType.ALL)
                    .exchangeToMono(response -> handleResponse(response))
                    .timeout(Duration.ofMillis(Math.max(1000, readTimeoutMs)));

            return mono.onErrorResume(e -> {
                        log.warn("Crawl4AI request failed for {}: {}", targetUrl, e.toString());
                        return Mono.empty();
                    })
                    .block();
        } catch (Exception e) {
            log.warn("Crawl4AI client error for {}: {}", targetUrl, e.toString());
            return null;
        }
    }

    private Mono<CrawlResult> handleResponse(ClientResponse response) {
        MediaType ct = response.headers().contentType().orElse(MediaType.APPLICATION_JSON);
        if (ct.isCompatibleWith(MediaType.APPLICATION_JSON) || ct.getSubtype().contains("json")) {
            return response.bodyToMono(String.class).flatMap(body -> {
                try {
                    JsonNode node = objectMapper.readTree(body);
                    String title = textOf(node, "title");
                    String content = firstNonBlank(
                            textOf(node, "content"),
                            textOf(node, "markdown"),
                            textOf(node, "text"),
                            stripHtml(textOf(node, "html"))
                    );
                    if (isBlank(content)) return Mono.empty();
                    return Mono.just(CrawlResult.builder()
                            .title(title)
                            .content(normalize(content))
                            .build());
                } catch (Exception ex) {
                    log.debug("Failed to parse JSON from Crawl4AI: {}", ex.toString());
                    return Mono.empty();
                }
            });
        } else {
            return response.bodyToMono(String.class).map(body ->
                    CrawlResult.builder()
                            .title(null)
                            .content(normalize(stripHtml(body)))
                            .build()
            );
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.trim().isEmpty();
    }

    private static String firstNonBlank(String... values) {
        if (values == null) return null;
        for (String v : values) {
            if (!isBlank(v)) return v;
        }
        return null;
    }

    private static String normalize(String s) {
        if (s == null) return null;
        return s.replaceAll("\\s+", " ").trim();
    }

    private static String textOf(JsonNode node, String field) {
        if (node == null || node.isNull()) return null;
        JsonNode v = node.get(field);
        if (v == null || v.isNull()) return null;
        if (v.isTextual()) return v.asText();
        return v.toString();
    }

    private static String stripHtml(String html) {
        if (html == null) return null;
        try {
            return Jsoup.parse(html).text();
        } catch (Exception ignored) {
            return html;
        }
    }
}
