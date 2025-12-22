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
 * Wikipedia 기반 팩트체크 소스.
 *
 * 간단한 제목/주제 검색으로 ko/en 위키백과 요약을 가져와
 * SourceEvidence 형태로 반환합니다.
 * 
 * 403/429 에러 발생 시 IP rotation을 통해 재시도합니다.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class WikipediaSource implements FactCheckSource {

    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    private final TrustScoreConfig trustScoreConfig;
    private final RateLimitRetryService rateLimitRetryService;

    @Value("${collector.fact-check.wikipedia.enabled:true}")
    private boolean enabled;

    @Value("${collector.fact-check.timeout-seconds:15}")
    private int timeoutSeconds;

    @Override
    public String getSourceId() {
        return "wikipedia_api";
    }

    @Override
    public String getSourceName() {
        return "Wikipedia";
    }

    @Override
    public double getTrustScore() {
        return trustScoreConfig.getFactCheck().getWikipedia();
    }

    @Override
    public SourceType getSourceType() {
        return SourceType.ENCYCLOPEDIA;
    }

    @Override
    public boolean isAvailable() {
        return enabled;
    }

    @Override
    public Flux<SourceEvidence> fetchEvidence(String topic, String language) {
        if (!enabled || topic == null || topic.isBlank()) {
            return Flux.empty();
        }

        return Flux.defer(() -> {
            List<SourceEvidence> evidenceList = new ArrayList<>();

            // 언어 코드에 따라 우선순위 결정 (ko 우선, 그 다음 en)
            String primaryLang = mapLanguage(language);

            try {
                String summary = fetchWikipediaSummary(topic, primaryLang);
                if (summary != null && !summary.isBlank()) {
                    evidenceList.add(SourceEvidence.builder()
                            .sourceType("wikipedia")
                            .sourceName(primaryLang.equals("ko") ? "위키백과" : "Wikipedia")
                            .url(String.format("https://%s.wikipedia.org/wiki/%s", primaryLang,
                                    URLEncoder.encode(topic.replace(" ", "_"), StandardCharsets.UTF_8)))
                            .excerpt(truncate(summary, 500))
                            .relevanceScore(0.9)
                            .stance("neutral")
                            .build());
                }
            } catch (Exception e) {
                log.debug("Failed to fetch Wikipedia summary for topic '{}' ({}): {}", topic, primaryLang, e.getMessage());
            }

            // 보조 언어(en)도 시도 (primary가 ko인 경우)
            if ("ko".equals(primaryLang)) {
                try {
                    String enSummary = fetchWikipediaSummary(topic, "en");
                    if (enSummary != null && !enSummary.isBlank()) {
                        evidenceList.add(SourceEvidence.builder()
                                .sourceType("wikipedia")
                                .sourceName("Wikipedia (EN)")
                                .url(String.format("https://en.wikipedia.org/wiki/%s",
                                        URLEncoder.encode(topic.replace(" ", "_"), StandardCharsets.UTF_8)))
                                .excerpt(truncate(enSummary, 500))
                                .relevanceScore(0.9)
                                .stance("neutral")
                                .build());
                    }
                } catch (Exception e) {
                    log.debug("Failed to fetch English Wikipedia summary for topic '{}': {}", topic, e.getMessage());
                }
            }

            return Flux.fromIterable(evidenceList);
        });
    }

    @Override
    public Flux<SourceEvidence> verifyClaimAgainstSource(String claim, String language) {
        // 간단히 claim 전체를 주제로 보고 fetchEvidence 재사용
        return fetchEvidence(claim, language);
    }

    private String mapLanguage(String language) {
        if (language == null || language.isBlank()) {
            return "ko";
        }
        String lower = language.toLowerCase();
        if (lower.startsWith("en")) return "en";
        if (lower.startsWith("ko")) return "ko";
        return "ko";
    }

    private String fetchWikipediaSummary(String topic, String lang) {
        String apiUrl = String.format(
                "https://%s.wikipedia.org/api/rest_v1/page/summary/%s",
                lang,
                URLEncoder.encode(topic.replace(" ", "_"), StandardCharsets.UTF_8)
        );

        try {
            // 1차 시도: 일반 요청
            String response = webClient.get()
                    .uri(apiUrl)
                    .accept(MediaType.APPLICATION_JSON)
                    .retrieve()
                    .bodyToMono(String.class)
                    .timeout(Duration.ofSeconds(timeoutSeconds))
                    .block();

            return extractSummary(response);
        } catch (Exception e) {
            // 403 또는 429 에러인 경우 프록시를 통해 재시도
            if (isRateLimitError(e)) {
                log.info("Rate limit/forbidden hit for Wikipedia ({}), attempting proxy retry", lang);
                return retryWithProxy(apiUrl, topic, lang);
            }
            log.debug("Wikipedia API call failed for topic '{}' ({}): {}", topic, lang, e.getMessage());
            return null;
        }
    }

    /**
     * 프록시를 통한 재시도
     */
    private String retryWithProxy(String apiUrl, String topic, String lang) {
        try {
            String response = rateLimitRetryService.executeWithRetryBlocking(
                    apiUrl, 
                    "Accept", "application/json",
                    "User-Agent", "NewsInsight/1.0 (https://newsinsight.com; contact@newsinsight.com)"
            );
            
            if (response != null) {
                log.info("Wikipedia proxy retry succeeded for topic '{}' ({})", topic, lang);
                return extractSummary(response);
            }
        } catch (Exception e) {
            log.warn("Wikipedia proxy retry failed for topic '{}' ({}): {}", topic, lang, e.getMessage());
        }
        return null;
    }

    /**
     * 응답에서 요약 추출
     */
    private String extractSummary(String response) {
        if (response == null || response.isBlank()) {
            return null;
        }
        try {
            JsonNode node = objectMapper.readTree(response);
            if (node.has("extract")) {
                return node.get("extract").asText();
            }
        } catch (Exception e) {
            log.debug("Failed to parse Wikipedia response: {}", e.getMessage());
        }
        return null;
    }

    /**
     * Rate limit 또는 forbidden 에러인지 확인
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
                   message.contains("forbidden") ||
                   message.contains("rate limit");
        }
        return false;
    }

    private String truncate(String text, int maxLength) {
        if (text == null) return "";
        if (text.length() <= maxLength) return text;
        return text.substring(0, maxLength) + "...";
    }
}
