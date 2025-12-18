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
 * Google Fact Check Tools API를 통한 팩트체크 결과 조회
 * 
 * Google Fact Check Tools API는 전 세계 팩트체커들이 검증한
 * 주장들의 데이터베이스를 제공합니다.
 * 
 * API 키 필요: https://developers.google.com/fact-check/tools/api/reference/rest
 * 
 * 무료 할당량: 10,000 요청/일
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class GoogleFactCheckSource implements FactCheckSource {

    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    private final TrustScoreConfig trustScoreConfig;

    @Value("${collector.fact-check.google.api-key:}")
    private String apiKey;

    @Value("${collector.fact-check.google.enabled:true}")
    private boolean enabled;

    @Value("${collector.fact-check.timeout-seconds:15}")
    private int timeoutSeconds;

    private static final String FACT_CHECK_API_BASE = "https://factchecktools.googleapis.com/v1alpha1/claims:search";

    @Override
    public String getSourceId() {
        return "google_factcheck";
    }

    @Override
    public String getSourceName() {
        return "Google Fact Check";
    }

    @Override
    public double getTrustScore() {
        return trustScoreConfig.getFactCheck().getGoogleFactCheck();
    }

    @Override
    public SourceType getSourceType() {
        return SourceType.FACT_CHECK;
    }

    @Override
    public boolean isAvailable() {
        return enabled && apiKey != null && !apiKey.isBlank();
    }

    @Override
    public Flux<SourceEvidence> fetchEvidence(String topic, String language) {
        if (!isAvailable()) {
            log.debug("Google Fact Check API is not available (enabled={}, hasKey={})", 
                    enabled, apiKey != null && !apiKey.isBlank());
            return Flux.empty();
        }

        return Flux.defer(() -> {
            try {
                String encodedQuery = URLEncoder.encode(topic, StandardCharsets.UTF_8);
                String languageCode = mapLanguageCode(language);
                
                String url = String.format(
                        "%s?query=%s&languageCode=%s&pageSize=10&key=%s",
                        FACT_CHECK_API_BASE, encodedQuery, languageCode, apiKey
                );

                log.debug("Fetching Google Fact Check evidence for topic: {}", topic);

                String response = webClient.get()
                        .uri(url)
                        .accept(MediaType.APPLICATION_JSON)
                        .retrieve()
                        .bodyToMono(String.class)
                        .timeout(Duration.ofSeconds(timeoutSeconds))
                        .block();

                return Flux.fromIterable(parseResponse(response));
            } catch (Exception e) {
                log.warn("Google Fact Check API call failed for topic '{}': {}", topic, e.getMessage());
                return Flux.empty();
            }
        });
    }

    @Override
    public Flux<SourceEvidence> verifyClaimAgainstSource(String claim, String language) {
        return fetchEvidence(claim, language);
    }

    private String mapLanguageCode(String language) {
        if (language == null) return "ko";
        return switch (language.toLowerCase()) {
            case "ko", "kor", "korean" -> "ko";
            case "en", "eng", "english" -> "en";
            case "ja", "jpn", "japanese" -> "ja";
            case "zh", "chi", "chinese" -> "zh";
            default -> language;
        };
    }

    private List<SourceEvidence> parseResponse(String response) {
        List<SourceEvidence> evidenceList = new ArrayList<>();
        
        if (response == null || response.isBlank()) {
            return evidenceList;
        }

        try {
            JsonNode root = objectMapper.readTree(response);
            JsonNode claims = root.path("claims");

            if (claims.isArray()) {
                for (JsonNode claimNode : claims) {
                    try {
                        String claimText = claimNode.path("text").asText("");
                        String claimant = claimNode.path("claimant").asText("");
                        
                        // 팩트체크 리뷰 정보 추출
                        JsonNode reviews = claimNode.path("claimReview");
                        if (reviews.isArray() && !reviews.isEmpty()) {
                            JsonNode review = reviews.get(0);
                            
                            String publisher = review.path("publisher").path("name").asText("Unknown");
                            String reviewUrl = review.path("url").asText("");
                            String rating = review.path("textualRating").asText("");
                            String title = review.path("title").asText("");
                            String languageCode = review.path("languageCode").asText("");

                            // stance 결정 (rating 기반)
                            String stance = determineStance(rating);
                            
                            // 발췌문 구성
                            StringBuilder excerpt = new StringBuilder();
                            if (!claimText.isBlank()) {
                                excerpt.append("주장: ").append(claimText);
                                if (!claimant.isBlank()) {
                                    excerpt.append(" (").append(claimant).append(")");
                                }
                                excerpt.append("\n");
                            }
                            excerpt.append("판정: ").append(rating);
                            if (!title.isBlank()) {
                                excerpt.append("\n").append(title);
                            }

                            evidenceList.add(SourceEvidence.builder()
                                    .sourceType("factcheck")
                                    .sourceName(publisher + " (Fact Check)")
                                    .url(reviewUrl)
                                    .excerpt(truncate(excerpt.toString(), 500))
                                    .relevanceScore(0.85)
                                    .stance(stance)
                                    .build());
                        }
                    } catch (Exception e) {
                        log.debug("Failed to parse Google Fact Check claim: {}", e.getMessage());
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Failed to parse Google Fact Check response: {}", e.getMessage());
        }

        return evidenceList;
    }

    /**
     * 팩트체크 판정을 stance로 변환
     */
    private String determineStance(String rating) {
        if (rating == null) return "neutral";
        
        String lower = rating.toLowerCase();
        
        // 거짓 판정 패턴
        if (lower.contains("false") || lower.contains("거짓") || lower.contains("허위") ||
            lower.contains("wrong") || lower.contains("incorrect") || lower.contains("틀") ||
            lower.contains("fake") || lower.contains("misleading") || lower.contains("오해")) {
            return "contradict";
        }
        
        // 진실 판정 패턴
        if (lower.contains("true") || lower.contains("사실") || lower.contains("correct") ||
            lower.contains("accurate") || lower.contains("정확") || lower.contains("맞")) {
            return "support";
        }
        
        // 부분적/혼합 판정
        if (lower.contains("partly") || lower.contains("partially") || lower.contains("mixed") ||
            lower.contains("부분") || lower.contains("일부") || lower.contains("반")) {
            return "neutral";
        }
        
        return "neutral";
    }

    private String truncate(String text, int maxLength) {
        if (text == null) return "";
        if (text.length() <= maxLength) return text;
        return text.substring(0, maxLength) + "...";
    }
}
