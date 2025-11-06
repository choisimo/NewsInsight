package com.newsinsight.collector.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.entity.CollectedData;
import com.newsinsight.collector.entity.DataSource;
import com.rometools.rome.feed.synd.SyndEntry;
import com.rometools.rome.feed.synd.SyndFeed;
import com.rometools.rome.io.SyndFeedInput;
import com.rometools.rome.io.XmlReader;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.net.URL;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class RssFeedService {

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
     * Fetch and parse RSS feed
     */
    public List<CollectedData> fetchRssFeed(DataSource source) {
        List<CollectedData> results = new ArrayList<>();
        
        try {
            log.info("Fetching RSS feed from: {}", source.getUrl());
            
            URL feedUrl = new URL(source.getUrl());
            SyndFeedInput input = new SyndFeedInput();
            SyndFeed feed = input.build(new XmlReader(feedUrl));
            
            log.info("Found {} entries in feed: {}", feed.getEntries().size(), source.getName());
            
            for (SyndEntry entry : feed.getEntries()) {
                try {
                    CollectedData data = parseEntry(entry, source);
                    if (data != null) {
                        results.add(data);
                    }
                } catch (Exception e) {
                    log.error("Error parsing RSS entry: {}", e.getMessage(), e);
                }
            }
            
        } catch (Exception e) {
            log.error("Error fetching RSS feed from {}: {}", source.getUrl(), e.getMessage(), e);
        }
        
        return results;
    }

    /**
     * Parse single RSS entry to CollectedData
     */
    private CollectedData parseEntry(SyndEntry entry, DataSource source) {
        String title = entry.getTitle();
        String description = entry.getDescription() != null ? entry.getDescription().getValue() : "";
        String link = entry.getLink();
        
        // Normalize content
        String content = normalizeText(description);
        
        // Skip if content is too short
        if (content.length() < 10) {
            log.debug("Skipping entry with too short content: {}", title);
            return null;
        }
        
        // Parse published date
        LocalDateTime publishedDate = null;
        Date pubDate = entry.getPublishedDate() != null ? entry.getPublishedDate() : entry.getUpdatedDate();
        if (pubDate != null) {
            publishedDate = LocalDateTime.ofInstant(pubDate.toInstant(), ZoneId.systemDefault());
        }
        
        // Compute content hash
        String contentHash = collectedDataService.computeContentHash(link, title, content);
        
        // Check for duplicates
        if (collectedDataService.isDuplicate(contentHash)) {
            log.debug("Duplicate entry detected: {}", title);
            return null;
        }
        
        // Extract tags/categories
        List<String> tags = entry.getCategories() != null 
            ? entry.getCategories().stream()
                .map(cat -> cat.getName())
                .collect(Collectors.toList())
            : List.of();
        
        // Build metadata
        Map<String, Object> metadata = Map.of(
            "adapter", "rss",
            "tags", tags,
            "author", entry.getAuthor() != null ? entry.getAuthor() : "",
            "source_name", source.getName()
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
                .content(content)
                .url(link)
                .publishedDate(publishedDate)
                .contentHash(contentHash)
                .metadataJson(metadataJson)
                .processed(false)
                .hasContent(true)
                .duplicate(false)
                .normalized(true)
                .build();
        
        return data;
    }
}
