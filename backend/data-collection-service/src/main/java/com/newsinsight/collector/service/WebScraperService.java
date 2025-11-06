package com.newsinsight.collector.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.entity.CollectedData;
import com.newsinsight.collector.entity.DataSource;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class WebScraperService {

    private final WebClient webClient;
    private final CollectedDataService collectedDataService;
    private final ObjectMapper objectMapper;

    /**
     * Normalize text by removing extra whitespace
     */
    private String normalizeText(String text) {
        if (text == null || text.isBlank()) {
            return "";
        }
        return text.replaceAll("\\s+", " ").trim();
    }

    /**
     * Fetch and scrape web page
     */
    public List<CollectedData> scrapeWebPage(DataSource source) {
        List<CollectedData> results = new ArrayList<>();
        
        try {
            log.info("Scraping web page: {}", source.getUrl());
            
            // Fetch HTML content using WebClient
            String html = webClient.get()
                    .uri(source.getUrl())
                    .retrieve()
                    .bodyToMono(String.class)
                    .timeout(Duration.ofSeconds(30))
                    .onErrorResume(e -> {
                        log.error("Error fetching web page {}: {}", source.getUrl(), e.getMessage());
                        return Mono.empty();
                    })
                    .block();
            
            if (html == null || html.isBlank()) {
                log.warn("Empty response from: {}", source.getUrl());
                return results;
            }
            
            // Parse HTML with Jsoup
            Document doc = Jsoup.parse(html);
            
            // Remove script and style tags
            doc.select("script, style, nav, footer, aside").remove();
            
            // Extract text content
            String textContent = doc.body().text();
            String normalizedContent = normalizeText(textContent);
            
            // Skip if content is too short
            if (normalizedContent.length() < 100) {
                log.debug("Skipping page with too short content: {}", source.getUrl());
                return results;
            }
            
            // Extract title
            String title = doc.title();
            if (title == null || title.isBlank()) {
                title = source.getName();
            }
            
            // Compute content hash
            String contentHash = collectedDataService.computeContentHash(
                    source.getUrl(), title, normalizedContent);
            
            // Check for duplicates
            if (collectedDataService.isDuplicate(contentHash)) {
                log.debug("Duplicate page detected: {}", source.getUrl());
                return results;
            }
            
            // Build metadata
            Map<String, Object> metadata = Map.of(
                "adapter", "web",
                "source_name", source.getName(),
                "scrape_method", "jsoup"
            );
            
            // Convert metadata to JSON string
            String metadataJson;
            try {
                metadataJson = objectMapper.writeValueAsString(metadata);
            } catch (Exception e) {
                log.warn("Failed to serialize metadata to JSON: {}", e.getMessage());
                metadataJson = "{}";
            }
            
            // Create CollectedData entity
            CollectedData data = CollectedData.builder()
                    .sourceId(source.getId())
                    .title(title)
                    .content(normalizedContent)
                    .url(source.getUrl())
                    .publishedDate(null) // Web pages don't have published date
                    .contentHash(contentHash)
                    .metadataJson(metadataJson)
                    .processed(false)
                    .hasContent(true)
                    .duplicate(false)
                    .normalized(true)
                    .build();
            
            results.add(data);
            log.info("Successfully scraped web page: {} ({} chars)", source.getName(), normalizedContent.length());
            
        } catch (Exception e) {
            log.error("Error scraping web page {}: {}", source.getUrl(), e.getMessage(), e);
        }
        
        return results;
    }

    /**
     * Extract specific content using CSS selector (if provided in metadata)
     */
    public String extractWithSelector(Document doc, String cssSelector) {
        if (cssSelector == null || cssSelector.isBlank()) {
            return doc.body().text();
        }
        
        try {
            return doc.select(cssSelector).text();
        } catch (Exception e) {
            log.warn("Error using CSS selector {}: {}", cssSelector, e.getMessage());
            return doc.body().text();
        }
    }
}
