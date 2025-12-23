package com.newsinsight.collector.service.factcheck;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.config.TrustScoreConfig;
import com.newsinsight.collector.service.FactVerificationService.SourceEvidence;
import com.newsinsight.collector.service.RateLimitRetryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Flux;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * Semantic Scholar API를 통한 학술 논문 검색
 * 
 * Semantic Scholar는 AI 기반의 학술 검색 엔진으로,
 * 논문 간의 인용 관계와 영향력을 분석하여 더 관련성 높은 결과를 제공합니다.
 * 
 * API 문서: https://api.semanticscholar.org/api-docs/
 * 
 * 특징:
 * - API 키 없이 분당 100회 요청 가능
 * - 인용 관계 분석
 * - 영향력 있는 인용(influential citations) 제공
 * - 초록 및 TLDR 요약 제공
 * - 429 Too Many Requests 시 IP rotation을 통해 재시도
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class SemanticScholarSource implements FactCheckSource {

    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    private final TrustScoreConfig trustScoreConfig;
    private final RateLimitRetryService rateLimitRetryService;

    @Value("${collector.fact-check.semantic-scholar.enabled:true}")
    private boolean enabled;

    @Value("${collector.fact-check.semantic-scholar.api-key:}")
    private String apiKey;

    @Value("${collector.fact-check.timeout-seconds:15}")
    private int timeoutSeconds;

    private static final String API_BASE = "https://api.semanticscholar.org/graph/v1/paper/search";
    private static final String FIELDS = "title,abstract,year,citationCount,influentialCitationCount,authors,url,tldr";

    @Override
    public String getSourceId() {
        return "semantic_scholar";
    }

    @Override
    public String getSourceName() {
        return "Semantic Scholar (학술 논문)";
    }

    @Override
    public double getTrustScore() {
        // TrustScoreConfig에 semantic scholar 설정이 없으면 기본값 사용
        try {
            return trustScoreConfig.getFactCheck().getOpenalex(); // OpenAlex와 동일한 수준
        } catch (Exception e) {
            return 0.85; // 기본 학술 신뢰도
        }
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
                        "%s?query=%s&limit=5&fields=%s",
                        API_BASE, encodedQuery, FIELDS
                );

                log.debug("Fetching Semantic Scholar evidence for topic: {}", topic);

                // 먼저 일반 요청 시도, 429 에러 시 프록시를 통해 재시도
                String response = executeRequestWithRetry(url);

                if (response == null || response.isBlank()) {
                    log.debug("No response from Semantic Scholar for topic: {}", topic);
                    return Flux.empty();
                }

                return Flux.fromIterable(parseResponse(response, topic));
            } catch (Exception e) {
                log.warn("Semantic Scholar API call failed for topic '{}': {}", topic, e.getMessage());
                return Flux.empty();
            }
        });
    }

    /**
     * 요청 실행 - 429 에러 시 IP rotation을 통해 재시도
     */
    private String executeRequestWithRetry(String url) {
        try {
            // 1차 시도: 일반 요청
            WebClient.RequestHeadersSpec<?> request = webClient.get()
                    .uri(url)
                    .accept(MediaType.APPLICATION_JSON);

            // API 키가 있으면 헤더에 추가 (더 높은 rate limit)
            if (apiKey != null && !apiKey.isBlank()) {
                request = webClient.get()
                        .uri(url)
                        .accept(MediaType.APPLICATION_JSON)
                        .header("x-api-key", apiKey);
            }

            return request
                    .retrieve()
                    .bodyToMono(String.class)
                    .timeout(Duration.ofSeconds(timeoutSeconds))
                    .block();
                    
        } catch (Exception e) {
            // 429 또는 403 에러인 경우 프록시를 통해 재시도
            if (isRateLimitError(e)) {
                log.info("Rate limit hit for Semantic Scholar, attempting proxy retry for: {}", url);
                return retryWithProxy(url);
            }
            throw e;
        }
    }

    /**
     * 프록시를 통한 재시도
     */
    private String retryWithProxy(String url) {
        try {
            String[] headers = apiKey != null && !apiKey.isBlank() 
                    ? new String[]{"x-api-key", apiKey, "Accept", "application/json"}
                    : new String[]{"Accept", "application/json"};
            
            String response = rateLimitRetryService.executeWithRetryBlocking(url, headers);
            
            if (response != null) {
                log.info("Semantic Scholar proxy retry succeeded for: {}", url);
            }
            return response;
        } catch (Exception e) {
            log.warn("Semantic Scholar proxy retry failed: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Rate limit 에러인지 확인
     */
    private boolean isRateLimitError(Throwable e) {
        if (e instanceof WebClientResponseException wce) {
            int statusCode = wce.getStatusCode().value();
            return statusCode == 429 || statusCode == 403;
        }
        String message = e.getMessage();
        if (message != null) {
            message = message.toLowerCase();
            return message.contains("429") || 
                   message.contains("403") || 
                   message.contains("too many requests") ||
                   message.contains("rate limit");
        }
        return false;
    }

    @Override
    public Flux<SourceEvidence> verifyClaimAgainstSource(String claim, String language) {
        // 학술 검색에 적합하도록 키워드 추출
        String[] words = claim.split("[\\s,\\.!?]+");
        String searchQuery = String.join(" ", 
                java.util.Arrays.stream(words)
                        .filter(w -> w.length() > 3)
                        .filter(w -> !isCommonWord(w))
                        .limit(6)
                        .toList());
        
        if (searchQuery.isBlank()) {
            searchQuery = claim.length() > 60 ? claim.substring(0, 60) : claim;
        }
        
        return fetchEvidence(searchQuery, language);
    }

    private boolean isCommonWord(String word) {
        return List.of("that", "this", "with", "from", "have", "been", "were", "will",
                "이것", "저것", "그것", "있는", "없는", "하는", "되는").contains(word.toLowerCase());
    }

    private List<SourceEvidence> parseResponse(String response, String query) {
        List<SourceEvidence> evidenceList = new ArrayList<>();
        
        if (response == null || response.isBlank()) {
            return evidenceList;
        }

        try {
            JsonNode root = objectMapper.readTree(response);
            JsonNode data = root.path("data");

            if (data.isArray()) {
                for (JsonNode paper : data) {
                    try {
                        String title = paper.path("title").asText("");
                        if (title.isBlank()) continue;

                        String paperAbstract = paper.path("abstract").asText("");
                        String tldr = paper.path("tldr").path("text").asText("");
                        int year = paper.path("year").asInt(0);
                        int citationCount = paper.path("citationCount").asInt(0);
                        int influentialCount = paper.path("influentialCitationCount").asInt(0);
                        String paperUrl = paper.path("url").asText("");

                        // 저자 추출
                        String authors = extractAuthors(paper.path("authors"));

                        // 발췌문 구성 - TLDR이 있으면 우선 사용
                        StringBuilder excerpt = new StringBuilder();
                        excerpt.append("📄 ").append(title);
                        if (year > 0) {
                            excerpt.append(" (").append(year).append(")");
                        }
                        excerpt.append("\n");
                        
                        if (!authors.isBlank()) {
                            excerpt.append("저자: ").append(authors).append("\n");
                        }
                        
                        excerpt.append("인용: ").append(citationCount).append("회");
                        if (influentialCount > 0) {
                            excerpt.append(" (영향력 있는 인용: ").append(influentialCount).append("회)");
                        }
                        
                        // TLDR이 있으면 추가 (간결한 요약)
                        if (!tldr.isBlank()) {
                            excerpt.append("\n\n📝 요약: ").append(tldr);
                        } else if (!paperAbstract.isBlank()) {
                            // 초록 추가 (최대 300자)
                            String shortAbstract = paperAbstract.length() > 300 
                                    ? paperAbstract.substring(0, 300) + "..." 
                                    : paperAbstract;
                            excerpt.append("\n\n").append(shortAbstract);
                        }

                        // 관련성 점수 계산 (인용 수 및 영향력 기반)
                        double relevance = calculateRelevance(query, title, paperAbstract, citationCount, influentialCount);

                        evidenceList.add(SourceEvidence.builder()
                                .sourceType("academic")
                                .sourceName(getSourceName())
                                .url(paperUrl)
                                .excerpt(truncate(excerpt.toString(), 600))
                                .relevanceScore(relevance)
                                .stance("neutral")
                                .build());
                    } catch (Exception e) {
                        log.debug("Failed to parse Semantic Scholar paper: {}", e.getMessage());
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Failed to parse Semantic Scholar response: {}", e.getMessage());
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

    private double calculateRelevance(String query, String title, String abstractText, 
                                      int citationCount, int influentialCount) {
        double score = 0.5; // 기본 점수

        // 제목/초록과 쿼리 매칭
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
        score += Math.min(0.3, matches * 0.05);

        // 인용 수 기반 보너스 (많이 인용된 논문은 더 신뢰할 수 있음)
        if (citationCount > 100) score += 0.1;
        else if (citationCount > 50) score += 0.07;
        else if (citationCount > 10) score += 0.05;

        // 영향력 있는 인용 보너스
        if (influentialCount > 10) score += 0.1;
        else if (influentialCount > 5) score += 0.05;

        return Math.min(1.0, Math.max(0.3, score));
    }

    private String truncate(String text, int maxLength) {
        if (text == null) return "";
        if (text.length() <= maxLength) return text;
        return text.substring(0, maxLength) + "...";
    }
}
