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

import java.net.HttpURLConnection;
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
     * 공백을 정리하여 텍스트를 정규화
     */
    private String normalizeText(String text) {
        if (text == null || text.isBlank()) {
            return "";
        }
        return text.replaceAll("\\s+", " ").trim();
    }

    /**
     * RSS 피드를 조회하고 파싱
     */
    public List<CollectedData> fetchRssFeed(DataSource source) {
        List<CollectedData> results = new ArrayList<>();
        
        try {
            log.info("Fetching RSS feed from: {}", source.getUrl());
            
            URL feedUrl = new URL(source.getUrl());
            
            // User-Agent를 설정하여 봇 차단 우회
            HttpURLConnection connection = (HttpURLConnection) feedUrl.openConnection();
            connection.setRequestProperty("User-Agent", 
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
            connection.setRequestProperty("Accept", "application/rss+xml, application/xml, text/xml, */*");
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(30000);
            connection.setInstanceFollowRedirects(true);
            
            SyndFeedInput input = new SyndFeedInput();
            SyndFeed feed = input.build(new XmlReader(connection.getInputStream()));
            
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
     * RSS 엔트리 1건을 CollectedData로 변환
     */
    private CollectedData parseEntry(SyndEntry entry, DataSource source) {
        String title = entry.getTitle();
        String description = entry.getDescription() != null ? entry.getDescription().getValue() : "";
        String link = entry.getLink();
        
        // 콘텐츠 정규화
        String content = normalizeText(description);
        
        // 콘텐츠가 너무 짧으면 스킵
        if (content.length() < 10) {
            log.debug("Skipping entry with too short content: {}", title);
            return null;
        }
        
        // 게시일 파싱
        LocalDateTime publishedDate = null;
        Date pubDate = entry.getPublishedDate() != null ? entry.getPublishedDate() : entry.getUpdatedDate();
        if (pubDate != null) {
            publishedDate = LocalDateTime.ofInstant(pubDate.toInstant(), ZoneId.systemDefault());
        }
        
        // 콘텐츠 해시 계산
        String contentHash = collectedDataService.computeContentHash(link, title, content);
        
        // 중복 여부 확인
        if (collectedDataService.isDuplicate(contentHash)) {
            log.debug("Duplicate entry detected: {}", title);
            return null;
        }
        
        // 태그/카테고리 추출
        List<String> tags = entry.getCategories() != null 
            ? entry.getCategories().stream()
                .map(cat -> cat.getName())
                .collect(Collectors.toList())
            : List.of();
        
        // 메타데이터 구성
        Map<String, Object> metadata = Map.of(
            "adapter", "rss",
            "tags", tags,
            "author", entry.getAuthor() != null ? entry.getAuthor() : "",
            "source_name", source.getName()
        );
        
        // 메타데이터를 JSON 문자열로 변환
        String metadataJson;
        try {
            metadataJson = objectMapper.writeValueAsString(metadata);
        } catch (Exception e) {
            log.warn("Failed to serialize metadata to JSON: {}", e.getMessage());
            metadataJson = "{}";
        }
        
        // CollectedData 엔티티 생성
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
