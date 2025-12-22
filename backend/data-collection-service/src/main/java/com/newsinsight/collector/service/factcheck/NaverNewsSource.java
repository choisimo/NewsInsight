package com.newsinsight.collector.service.factcheck;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.config.TrustScoreConfig;
import com.newsinsight.collector.service.FactVerificationService.SourceEvidence;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.UriComponentsBuilder;
import reactor.core.publisher.Flux;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * 네이버 뉴스 검색 API를 통한 팩트체크 소스
 * 
 * 한국어 뉴스 기사 검색에 최적화되어 있습니다.
 * 반도체, 경제, 정치 등 시사 관련 팩트체크에 유용합니다.
 * 
 * API 키 발급: https://developers.naver.com/
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class NaverNewsSource implements FactCheckSource {

    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    private final TrustScoreConfig trustScoreConfig;

    @Value("${NAVER_CLIENT_ID:}")
    private String clientId;

    @Value("${NAVER_CLIENT_SECRET:}")
    private String clientSecret;

    @Value("${collector.naver-news.enabled:true}")
    private boolean enabled;

    @Value("${collector.naver-news.display:10}")
    private int displayCount;

    private static final String NAVER_NEWS_API_URL = "https://openapi.naver.com/v1/search/news.json";
    private static final double NEWS_TRUST_SCORE = 0.75; // 뉴스 소스 기본 신뢰도

    @Override
    public String getSourceId() {
        return "naver_news";
    }

    @Override
    public String getSourceName() {
        return "네이버 뉴스";
    }

    @Override
    public double getTrustScore() {
        return NEWS_TRUST_SCORE;
    }

    @Override
    public boolean isAvailable() {
        return enabled && clientId != null && !clientId.isEmpty() 
               && clientSecret != null && !clientSecret.isEmpty();
    }

    @Override
    public Flux<SourceEvidence> verifyClaimAgainstSource(String claim, String language) {
        return fetchEvidence(claim, language);
    }

    @Override
    public SourceType getSourceType() {
        return SourceType.REFERENCE;
    }

    @Override
    public Flux<SourceEvidence> fetchEvidence(String topic, String language) {
        if (!isAvailable()) {
            log.debug("Naver News source is disabled or API keys not configured");
            return Flux.empty();
        }

        // 한국어 검색에 최적화
        if (!"ko".equalsIgnoreCase(language) && !"kr".equalsIgnoreCase(language)) {
            log.debug("Naver News is optimized for Korean language, skipping for: {}", language);
            return Flux.empty();
        }

        return Flux.defer(() -> {
            try {
                String encodedQuery = URLEncoder.encode(topic, StandardCharsets.UTF_8);
                String url = UriComponentsBuilder.fromUriString(NAVER_NEWS_API_URL)
                        .queryParam("query", encodedQuery)
                        .queryParam("display", displayCount)
                        .queryParam("sort", "date")
                        .build()
                        .toUriString();

                return webClient.get()
                        .uri(url)
                        .header("X-Naver-Client-Id", clientId)
                        .header("X-Naver-Client-Secret", clientSecret)
                        .retrieve()
                        .bodyToMono(String.class)
                        .timeout(Duration.ofSeconds(10))
                        .flatMapMany(response -> {
                            List<SourceEvidence> evidenceList = parseNaverNewsResponse(response, topic);
                            return Flux.fromIterable(evidenceList);
                        })
                        .onErrorResume(e -> {
                            log.warn("Failed to fetch from Naver News: {}", e.getMessage());
                            return Flux.empty();
                        });
            } catch (Exception e) {
                log.error("Error preparing Naver News request: {}", e.getMessage());
                return Flux.empty();
            }
        });
    }

    private List<SourceEvidence> parseNaverNewsResponse(String response, String topic) {
        List<SourceEvidence> evidenceList = new ArrayList<>();

        try {
            JsonNode root = objectMapper.readTree(response);
            JsonNode items = root.path("items");

            if (items.isArray()) {
                for (JsonNode item : items) {
                    String title = cleanHtml(item.path("title").asText(""));
                    String description = cleanHtml(item.path("description").asText(""));
                    String link = item.path("originallink").asText(item.path("link").asText(""));

                    if (title.isEmpty() || link.isEmpty()) {
                        continue;
                    }

                    // 관련성 점수 계산
                    double relevance = calculateRelevance(topic, title, description);
                    
                    // excerpt 생성: 제목 + 설명
                    String excerpt = String.format("%s - %s", title, 
                            description.length() > 200 ? description.substring(0, 200) + "..." : description);

                    SourceEvidence evidence = SourceEvidence.builder()
                            .sourceType("news")
                            .sourceName(getSourceName())
                            .url(link)
                            .excerpt(excerpt)
                            .relevanceScore(relevance)
                            .stance("neutral")
                            .build();

                    evidenceList.add(evidence);
                    
                    if (evidenceList.size() >= 5) {
                        break;
                    }
                }
            }

            log.info("Fetched {} news articles from Naver for topic: {}", evidenceList.size(), topic);

        } catch (Exception e) {
            log.error("Failed to parse Naver News response: {}", e.getMessage());
        }

        return evidenceList;
    }

    private String cleanHtml(String text) {
        if (text == null) return "";
        return text.replaceAll("<[^>]*>", "")
                   .replaceAll("&quot;", "\"")
                   .replaceAll("&amp;", "&")
                   .replaceAll("&lt;", "<")
                   .replaceAll("&gt;", ">")
                   .replaceAll("&nbsp;", " ")
                   .trim();
    }

    private double calculateRelevance(String topic, String title, String description) {
        String topicLower = topic.toLowerCase();
        String titleLower = title.toLowerCase();
        String descLower = description.toLowerCase();
        
        String[] keywords = topicLower.split("\\s+");
        int matchCount = 0;
        
        for (String keyword : keywords) {
            if (keyword.length() < 2) continue;
            if (titleLower.contains(keyword)) matchCount += 2;
            if (descLower.contains(keyword)) matchCount += 1;
        }
        
        double score = 0.3 + (Math.min(matchCount, 10) / 10.0) * 0.6;
        return Math.round(score * 100) / 100.0;
    }
}
