package com.newsinsight.collector.service.factcheck;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.config.TrustScoreConfig;
import com.newsinsight.collector.service.FactVerificationService.SourceEvidence;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * CrossRef API를 통한 학술 논문 검색 소스
 * 
 * CrossRef는 학술 논문의 메타데이터를 제공하는 무료 API입니다.
 * DOI를 기반으로 논문 정보를 검색할 수 있습니다.
 * 
 * API 문서: https://api.crossref.org/swagger-ui/index.html
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class CrossRefSource implements FactCheckSource {

    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    private final TrustScoreConfig trustScoreConfig;

    @Value("${collector.fact-check.crossref.enabled:true}")
    private boolean enabled;

    @Value("${collector.fact-check.crossref.mailto:newsinsight@example.com}")
    private String mailto;

    @Value("${collector.fact-check.timeout-seconds:15}")
    private int timeoutSeconds;

    private static final String CROSSREF_API_BASE = "https://api.crossref.org/works";

    @Override
    public String getSourceId() {
        return "crossref";
    }

    @Override
    public String getSourceName() {
        return "CrossRef (학술 논문)";
    }

    @Override
    public double getTrustScore() {
        return trustScoreConfig.getFactCheck().getCrossref();
    }

    @Override
    public SourceType getSourceType() {
        return SourceType.ACADEMIC;
    }

    @Override
    public boolean isAvailable() {
        return enabled;
    }

    @Override
    public Flux<SourceEvidence> fetchEvidence(String topic, String language) {
        if (!enabled) {
            return Flux.empty();
        }

        return Flux.defer(() -> {
            try {
                String encodedQuery = URLEncoder.encode(topic, StandardCharsets.UTF_8);
                String url = String.format(
                        "%s?query=%s&rows=5&sort=relevance&order=desc&mailto=%s",
                        CROSSREF_API_BASE, encodedQuery, mailto
                );

                log.debug("Fetching CrossRef evidence for topic: {}", topic);

                String response = webClient.get()
                        .uri(url)
                        .accept(MediaType.APPLICATION_JSON)
                        .retrieve()
                        .bodyToMono(String.class)
                        .timeout(Duration.ofSeconds(timeoutSeconds))
                        .block();

                return Flux.fromIterable(parseResponse(response, topic));
            } catch (Exception e) {
                log.warn("CrossRef API call failed for topic '{}': {}", topic, e.getMessage());
                return Flux.empty();
            }
        });
    }

    @Override
    public Flux<SourceEvidence> verifyClaimAgainstSource(String claim, String language) {
        // 학술 검색은 주장 전체보다 키워드 추출 후 검색이 효과적
        String[] keywords = claim.split("[\\s,\\.]+");
        String searchQuery = String.join(" ", 
                java.util.Arrays.stream(keywords)
                        .filter(w -> w.length() > 3)
                        .limit(5)
                        .toList());
        
        if (searchQuery.isBlank()) {
            searchQuery = claim.substring(0, Math.min(50, claim.length()));
        }
        
        return fetchEvidence(searchQuery, language);
    }

    private List<SourceEvidence> parseResponse(String response, String query) {
        List<SourceEvidence> evidenceList = new ArrayList<>();
        
        if (response == null || response.isBlank()) {
            return evidenceList;
        }

        try {
            JsonNode root = objectMapper.readTree(response);
            JsonNode items = root.path("message").path("items");

            if (items.isArray()) {
                for (JsonNode item : items) {
                    try {
                        String title = extractTitle(item);
                        String doi = item.path("DOI").asText("");
                        String abstractText = item.path("abstract").asText("");
                        String publisher = item.path("publisher").asText("Unknown Publisher");
                        int citationCount = item.path("is-referenced-by-count").asInt(0);

                        // 초록이 없으면 제목 + 출판사 정보 사용
                        String excerpt;
                        if (!abstractText.isBlank()) {
                            // HTML 태그 제거
                            excerpt = abstractText.replaceAll("<[^>]+>", "").trim();
                            if (excerpt.length() > 400) {
                                excerpt = excerpt.substring(0, 400) + "...";
                            }
                        } else {
                            excerpt = String.format("제목: %s (출판: %s, 인용: %d회)", 
                                    title, publisher, citationCount);
                        }

                        String url = doi.isEmpty() ? "" : "https://doi.org/" + doi;

                        // 제목과 쿼리의 관련성 점수 계산
                        double relevance = calculateRelevance(query, title, abstractText);

                        evidenceList.add(SourceEvidence.builder()
                                .sourceType("academic")
                                .sourceName(getSourceName())
                                .url(url)
                                .excerpt(excerpt)
                                .relevanceScore(relevance)
                                .stance("neutral") // 학술 자료는 기본적으로 중립
                                .build());
                    } catch (Exception e) {
                        log.debug("Failed to parse CrossRef item: {}", e.getMessage());
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Failed to parse CrossRef response: {}", e.getMessage());
        }

        return evidenceList;
    }

    private String extractTitle(JsonNode item) {
        JsonNode titleNode = item.path("title");
        if (titleNode.isArray() && !titleNode.isEmpty()) {
            return titleNode.get(0).asText("");
        }
        return titleNode.asText("Unknown Title");
    }

    private double calculateRelevance(String query, String title, String abstractText) {
        if (query == null || query.isBlank()) return 0.5;
        
        String lowerQuery = query.toLowerCase();
        String lowerTitle = title.toLowerCase();
        String lowerAbstract = abstractText.toLowerCase();
        
        String[] queryWords = lowerQuery.split("\\s+");
        int matches = 0;
        
        for (String word : queryWords) {
            if (word.length() > 2) {
                if (lowerTitle.contains(word)) matches += 2;
                if (lowerAbstract.contains(word)) matches++;
            }
        }
        
        double score = Math.min(1.0, matches / (double)(queryWords.length * 3));
        return Math.max(0.3, score); // 최소 0.3
    }
}
