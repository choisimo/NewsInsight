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
 * CORE API를 통한 오픈 액세스 학술 논문 검색
 * 
 * CORE(COnnecting REpositories)는 세계 최대의 오픈 액세스 연구 논문 수집 서비스로,
 * 2억 개 이상의 학술 자료를 무료로 검색할 수 있습니다.
 * 
 * API 문서: https://core.ac.uk/documentation/api
 * 
 * 특징:
 * - 오픈 액세스 전문 (전문 텍스트 접근 가능)
 * - 무료 API 키 제공
 * - 다양한 기관/저장소의 논문 통합 검색
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class CORESource implements FactCheckSource {

    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    private final TrustScoreConfig trustScoreConfig;

    @Value("${collector.fact-check.core.enabled:true}")
    private boolean enabled;

    @Value("${collector.fact-check.core.api-key:}")
    private String apiKey;

    @Value("${collector.fact-check.timeout-seconds:15}")
    private int timeoutSeconds;

    private static final String API_BASE = "https://api.core.ac.uk/v3/search/works";

    @Override
    public String getSourceId() {
        return "core";
    }

    @Override
    public String getSourceName() {
        return "CORE (오픈 액세스)";
    }

    @Override
    public double getTrustScore() {
        try {
            return trustScoreConfig.getFactCheck().getOpenalex();
        } catch (Exception e) {
            return 0.80; // 오픈 액세스 기본 신뢰도
        }
    }

    @Override
    public SourceType getSourceType() {
        return SourceType.ACADEMIC;
    }

    @Override
    public boolean isAvailable() {
        // API 키가 있어야 사용 가능
        return enabled && apiKey != null && !apiKey.isBlank();
    }

    @Override
    public Flux<SourceEvidence> fetchEvidence(String topic, String language) {
        if (!isAvailable()) {
            return Flux.empty();
        }

        return Flux.defer(() -> {
            try {
                String encodedQuery = URLEncoder.encode(topic, StandardCharsets.UTF_8);
                String url = String.format("%s?q=%s&limit=5", API_BASE, encodedQuery);

                log.debug("Fetching CORE evidence for topic: {}", topic);

                String response = webClient.get()
                        .uri(url)
                        .accept(MediaType.APPLICATION_JSON)
                        .header("Authorization", "Bearer " + apiKey)
                        .retrieve()
                        .bodyToMono(String.class)
                        .timeout(Duration.ofSeconds(timeoutSeconds))
                        .block();

                return Flux.fromIterable(parseResponse(response, topic));
            } catch (Exception e) {
                log.warn("CORE API call failed for topic '{}': {}", topic, e.getMessage());
                return Flux.empty();
            }
        });
    }

    @Override
    public Flux<SourceEvidence> verifyClaimAgainstSource(String claim, String language) {
        String[] words = claim.split("[\\s,\\.!?]+");
        String searchQuery = String.join(" ", 
                java.util.Arrays.stream(words)
                        .filter(w -> w.length() > 3)
                        .limit(6)
                        .toList());
        
        if (searchQuery.isBlank()) {
            searchQuery = claim.length() > 60 ? claim.substring(0, 60) : claim;
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
            JsonNode results = root.path("results");

            if (results.isArray()) {
                for (JsonNode work : results) {
                    try {
                        String title = work.path("title").asText("");
                        if (title.isBlank()) continue;

                        String abstractText = work.path("abstract").asText("");
                        int year = work.path("yearPublished").asInt(0);
                        String doi = work.path("doi").asText("");
                        String downloadUrl = work.path("downloadUrl").asText("");
                        
                        // 저자 추출
                        String authors = extractAuthors(work.path("authors"));
                        
                        // 출판사/저널
                        String publisher = work.path("publisher").asText("");

                        // 발췌문 구성
                        StringBuilder excerpt = new StringBuilder();
                        excerpt.append("📄 ").append(title);
                        if (year > 0) {
                            excerpt.append(" (").append(year).append(")");
                        }
                        excerpt.append("\n");
                        
                        if (!authors.isBlank()) {
                            excerpt.append("저자: ").append(authors).append("\n");
                        }
                        if (!publisher.isBlank()) {
                            excerpt.append("출판: ").append(publisher).append("\n");
                        }
                        
                        // 오픈 액세스 표시
                        if (!downloadUrl.isBlank()) {
                            excerpt.append("🔓 오픈 액세스 - 전문 열람 가능\n");
                        }
                        
                        if (!abstractText.isBlank()) {
                            String shortAbstract = abstractText.length() > 250 
                                    ? abstractText.substring(0, 250) + "..." 
                                    : abstractText;
                            excerpt.append("\n").append(shortAbstract);
                        }

                        // URL 결정 (DOI > downloadUrl > CORE URL)
                        String url;
                        if (!doi.isBlank()) {
                            url = doi.startsWith("http") ? doi : "https://doi.org/" + doi;
                        } else if (!downloadUrl.isBlank()) {
                            url = downloadUrl;
                        } else {
                            String coreId = work.path("id").asText("");
                            url = coreId.isBlank() ? "" : "https://core.ac.uk/works/" + coreId;
                        }

                        // 관련성 점수 계산
                        double relevance = calculateRelevance(query, title, abstractText);

                        evidenceList.add(SourceEvidence.builder()
                                .sourceType("academic")
                                .sourceName(getSourceName())
                                .url(url)
                                .excerpt(truncate(excerpt.toString(), 550))
                                .relevanceScore(relevance)
                                .stance("neutral")
                                .build());
                    } catch (Exception e) {
                        log.debug("Failed to parse CORE work: {}", e.getMessage());
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Failed to parse CORE response: {}", e.getMessage());
        }

        return evidenceList;
    }

    private String extractAuthors(JsonNode authorsNode) {
        if (!authorsNode.isArray() || authorsNode.isEmpty()) {
            return "";
        }

        List<String> authorNames = new ArrayList<>();
        for (JsonNode author : authorsNode) {
            String name = author.path("name").asText("");
            if (!name.isBlank()) {
                authorNames.add(name);
                if (authorNames.size() >= 3) break;
            }
        }

        if (authorNames.isEmpty()) return "";
        if (authorNames.size() < 3) return String.join(", ", authorNames);
        return authorNames.get(0) + " 외 " + (authorsNode.size() - 1) + "명";
    }

    private double calculateRelevance(String query, String title, String abstractText) {
        double score = 0.5;

        String lowerQuery = query.toLowerCase();
        String lowerTitle = title.toLowerCase();
        String lowerAbstract = abstractText != null ? abstractText.toLowerCase() : "";

        String[] queryWords = lowerQuery.split("\\s+");
        int matches = 0;
        for (String word : queryWords) {
            if (word.length() > 2) {
                if (lowerTitle.contains(word)) matches += 2;
                if (lowerAbstract.contains(word)) matches++;
            }
        }
        score += Math.min(0.4, matches * 0.08);

        return Math.min(1.0, Math.max(0.3, score));
    }

    private String truncate(String text, int maxLength) {
        if (text == null) return "";
        if (text.length() <= maxLength) return text;
        return text.substring(0, maxLength) + "...";
    }
}
