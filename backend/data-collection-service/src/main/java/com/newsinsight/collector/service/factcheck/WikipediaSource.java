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
 * Wikipedia 기반 팩트체크 소스.
 *
 * 간단한 제목/주제 검색으로 ko/en 위키백과 요약을 가져와
 * SourceEvidence 형태로 반환합니다.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class WikipediaSource implements FactCheckSource {

    private final WebClient webClient;
    private final ObjectMapper objectMapper;

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
        return 0.9;
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
        try {
            String apiUrl = String.format(
                    "https://%s.wikipedia.org/api/rest_v1/page/summary/%s",
                    lang,
                    URLEncoder.encode(topic.replace(" ", "_"), StandardCharsets.UTF_8)
            );

            String response = webClient.get()
                    .uri(apiUrl)
                    .accept(MediaType.APPLICATION_JSON)
                    .retrieve()
                    .bodyToMono(String.class)
                    .timeout(Duration.ofSeconds(timeoutSeconds))
                    .block();

            if (response != null) {
                JsonNode node = objectMapper.readTree(response);
                if (node.has("extract")) {
                    return node.get("extract").asText();
                }
            }
        } catch (Exception e) {
            log.debug("Wikipedia API call failed for topic '{}' ({}): {}", topic, lang, e.getMessage());
        }
        return null;
    }

    private String truncate(String text, int maxLength) {
        if (text == null) return "";
        if (text.length() <= maxLength) return text;
        return text.substring(0, maxLength) + "...";
    }
}
