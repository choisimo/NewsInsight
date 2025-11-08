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
     * 공백을 정리하여 텍스트를 정규화
     */
    private String normalizeText(String text) {
        if (text == null || text.isBlank()) {
            return "";
        }
        return text.replaceAll("\\s+", " ").trim();
    }

    /**
     * 웹 페이지를 가져와 스크랩
     */
    public List<CollectedData> scrapeWebPage(DataSource source) {
        List<CollectedData> results = new ArrayList<>();
        
        try {
            log.info("Scraping web page: {}", source.getUrl());
            
            // WebClient로 HTML 가져오기
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
            
            // Jsoup으로 HTML 파싱
            Document doc = Jsoup.parse(html);
            
            // script/style/nav/footer/aside 제거
            doc.select("script, style, nav, footer, aside").remove();
            
            // 본문 텍스트 추출
            String textContent = doc.body().text();
            String normalizedContent = normalizeText(textContent);
            
            // 내용이 너무 짧으면 건너뜀
            if (normalizedContent.length() < 100) {
                log.debug("Skipping page with too short content: {}", source.getUrl());
                return results;
            }
            
            // 제목 추출
            String title = doc.title();
            if (title == null || title.isBlank()) {
                title = source.getName();
            }
            
            // 콘텐츠 해시 계산
            String contentHash = collectedDataService.computeContentHash(
                    source.getUrl(), title, normalizedContent);
            
            // 중복 확인
            if (collectedDataService.isDuplicate(contentHash)) {
                log.debug("Duplicate page detected: {}", source.getUrl());
                return results;
            }
            
            // 메타데이터 구성
            Map<String, Object> metadata = Map.of(
                "adapter", "web",
                "source_name", source.getName(),
                "scrape_method", "jsoup"
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
                    .content(normalizedContent)
                    .url(source.getUrl())
                    .publishedDate(null) // 웹 페이지는 게시일 정보가 없음
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
     * CSS 셀렉터로 특정 콘텐츠 추출 (메타데이터에 제공된 경우)
     */
    public String extractWithSelector(Document doc, String cssSelector) {
        if (cssSelector == null || cssSelector.isBlank()) {
            return doc.body().text();
        }
        
        try {
            return doc.select(cssSelector).text();
        } catch (Exception e) {
            log.warn("CSS 셀렉터 사용 오류 {}: {}", cssSelector, e.getMessage());
            return doc.body().text();
        }
    }
}
