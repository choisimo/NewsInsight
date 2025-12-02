package com.newsinsight.collector.service.factcheck;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
 * OpenAlex API를 통한 학술 연구 검색
 * 
 * OpenAlex는 무료로 사용할 수 있는 오픈 학술 데이터베이스로,
 * 2억 개 이상의 학술 저작물을 검색할 수 있습니다.
 * 
 * API 문서: https://docs.openalex.org/
 * 
 * 특징:
 * - API 키 불필요 (무료)
 * - 빠른 응답 속도
 * - 풍부한 메타데이터
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class OpenAlexSource implements FactCheckSource {

    private final WebClient webClient;
    private final ObjectMapper objectMapper;

    @Value("${collector.fact-check.openalex.enabled:true}")
    private boolean enabled;

    @Value("${collector.fact-check.openalex.mailto:newsinsight@example.com}")
    private String mailto;

    @Value("${collector.fact-check.timeout-seconds:15}")
    private int timeoutSeconds;

    private static final String OPENALEX_API_BASE = "https://api.openalex.org/works";

    @Override
    public String getSourceId() {
        return "openalex";
    }

    @Override
    public String getSourceName() {
        return "OpenAlex (학술 DB)";
    }

    @Override
    public double getTrustScore() {
        return 0.92; // 학술 데이터베이스
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
                
                // OpenAlex는 polite pool을 위해 mailto 파라미터 권장
                String url = String.format(
                        "%s?search=%s&per_page=5&sort=relevance_score:desc&mailto=%s",
                        OPENALEX_API_BASE, encodedQuery, mailto
                );

                log.debug("Fetching OpenAlex evidence for topic: {}", topic);

                String response = webClient.get()
                        .uri(url)
                        .accept(MediaType.APPLICATION_JSON)
                        .retrieve()
                        .bodyToMono(String.class)
                        .timeout(Duration.ofSeconds(timeoutSeconds))
                        .block();

                return Flux.fromIterable(parseResponse(response, topic));
            } catch (Exception e) {
                log.warn("OpenAlex API call failed for topic '{}': {}", topic, e.getMessage());
                return Flux.empty();
            }
        });
    }

    @Override
    public Flux<SourceEvidence> verifyClaimAgainstSource(String claim, String language) {
        // 학술 검색은 주장에서 핵심 키워드만 추출
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

                        String doi = work.path("doi").asText("");
                        int citedByCount = work.path("cited_by_count").asInt(0);
                        int publicationYear = work.path("publication_year").asInt(0);
                        double relevanceScore = work.path("relevance_score").asDouble(0.5);
                        
                        // 초록 추출 (inverted index에서 복원 또는 없으면 생략)
                        String abstractText = extractAbstract(work);
                        
                        // 저자 정보
                        String authors = extractAuthors(work);
                        
                        // 발췌문 구성
                        StringBuilder excerpt = new StringBuilder();
                        excerpt.append("📄 ").append(title);
                        if (publicationYear > 0) {
                            excerpt.append(" (").append(publicationYear).append(")");
                        }
                        excerpt.append("\n");
                        if (!authors.isBlank()) {
                            excerpt.append("저자: ").append(authors).append("\n");
                        }
                        excerpt.append("인용: ").append(citedByCount).append("회");
                        if (!abstractText.isBlank()) {
                            excerpt.append("\n\n").append(abstractText);
                        }

                        String url = doi.isBlank() ? work.path("id").asText("") : doi;

                        // 관련성 점수 정규화
                        double normalizedRelevance = Math.min(1.0, Math.max(0.3, relevanceScore / 100.0));

                        evidenceList.add(SourceEvidence.builder()
                                .sourceType("academic")
                                .sourceName(getSourceName())
                                .url(url)
                                .excerpt(truncate(excerpt.toString(), 500))
                                .relevanceScore(normalizedRelevance)
                                .stance("neutral")
                                .build());
                    } catch (Exception e) {
                        log.debug("Failed to parse OpenAlex work: {}", e.getMessage());
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Failed to parse OpenAlex response: {}", e.getMessage());
        }

        return evidenceList;
    }

    private String extractAbstract(JsonNode work) {
        // OpenAlex는 abstract를 inverted index 형태로 저장
        JsonNode abstractIndex = work.path("abstract_inverted_index");
        if (abstractIndex.isMissingNode() || abstractIndex.isNull()) {
            return "";
        }

        try {
            // inverted index를 원문으로 복원
            java.util.TreeMap<Integer, String> positionToWord = new java.util.TreeMap<>();
            
            abstractIndex.fields().forEachRemaining(entry -> {
                String word = entry.getKey();
                JsonNode positions = entry.getValue();
                if (positions.isArray()) {
                    for (JsonNode pos : positions) {
                        positionToWord.put(pos.asInt(), word);
                    }
                }
            });
            
            StringBuilder sb = new StringBuilder();
            for (String word : positionToWord.values()) {
                if (!sb.isEmpty()) sb.append(" ");
                sb.append(word);
            }
            
            String result = sb.toString();
            return result.length() > 300 ? result.substring(0, 300) + "..." : result;
        } catch (Exception e) {
            log.debug("Failed to extract abstract: {}", e.getMessage());
            return "";
        }
    }

    private String extractAuthors(JsonNode work) {
        JsonNode authorships = work.path("authorships");
        if (!authorships.isArray() || authorships.isEmpty()) {
            return "";
        }

        List<String> authorNames = new ArrayList<>();
        for (JsonNode authorship : authorships) {
            String name = authorship.path("author").path("display_name").asText("");
            if (!name.isBlank()) {
                authorNames.add(name);
                if (authorNames.size() >= 3) break; // 최대 3명까지만
            }
        }

        if (authorNames.isEmpty()) return "";
        if (authorNames.size() < 3) return String.join(", ", authorNames);
        return authorNames.get(0) + " 외 " + (authorships.size() - 1) + "명";
    }

    private String truncate(String text, int maxLength) {
        if (text == null) return "";
        if (text.length() <= maxLength) return text;
        return text.substring(0, maxLength) + "...";
    }
}
