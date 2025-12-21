package com.newsinsight.collector.service.factcheck;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.config.TrustScoreConfig;
import com.newsinsight.collector.service.FactVerificationService.SourceEvidence;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 실시간 웹 검색을 통한 최신 데이터 수집 소스
 * 
 * Perplexity Sonar Online 모델을 사용하여 실시간 웹 검색 결과를 가져옵니다.
 * 암호화폐 시세, 주식 가격, 최신 뉴스 등 실시간 데이터 검증에 사용됩니다.
 * 
 * 특징:
 * - 실시간 웹 검색 (Perplexity Online Search)
 * - citations 추출을 통한 출처 제공
 * - 숫자/가격 데이터 추출 및 검증
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class RealtimeSearchSource implements FactCheckSource {

    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    private final TrustScoreConfig trustScoreConfig;

    @Value("${PERPLEXITY_API_KEY:}")
    private String apiKey;

    @Value("${PERPLEXITY_BASE_URL:https://api.perplexity.ai}")
    private String baseUrl;

    @Value("${collector.realtime-search.enabled:true}")
    private boolean enabled;

    @Value("${collector.realtime-search.timeout-seconds:30}")
    private int timeoutSeconds;

    // 실시간 검색이 필요한 키워드 패턴
    private static final List<String> REALTIME_KEYWORDS = List.of(
            "현재", "오늘", "지금", "최신", "실시간", "시세", "가격",
            "current", "today", "now", "latest", "price", "rate",
            "비트코인", "이더리움", "암호화폐", "주가", "환율", "코스피", "코스닥",
            "bitcoin", "ethereum", "crypto", "stock", "exchange rate"
    );

    // 가격/숫자 추출 패턴
    private static final Pattern PRICE_PATTERN = Pattern.compile(
            "\\$?([0-9]{1,3}(?:,?[0-9]{3})*(?:\\.[0-9]+)?)"
    );
    
    private static final Pattern KRW_PATTERN = Pattern.compile(
            "([0-9]{1,3}(?:,?[0-9]{3})*(?:\\.[0-9]+)?)[\\s]*(?:원|KRW|₩)"
    );

    @Override
    public String getSourceId() {
        return "realtime_search";
    }

    @Override
    public String getSourceName() {
        return "Realtime Web Search (Perplexity)";
    }

    @Override
    public double getTrustScore() {
        // 실시간 검색은 신뢰도를 중간 정도로 설정 (출처에 따라 달라질 수 있음)
        return 0.80;
    }

    @Override
    public SourceType getSourceType() {
        return SourceType.REFERENCE;
    }

    @Override
    public boolean isAvailable() {
        return enabled && apiKey != null && !apiKey.isBlank();
    }

    /**
     * 주어진 주제가 실시간 검색이 필요한지 판단
     */
    public boolean needsRealtimeSearch(String topic) {
        if (topic == null) return false;
        String lower = topic.toLowerCase();
        return REALTIME_KEYWORDS.stream().anyMatch(lower::contains);
    }

    @Override
    public Flux<SourceEvidence> fetchEvidence(String topic, String language) {
        if (!isAvailable()) {
            log.debug("Realtime Search is not available (enabled={}, hasKey={})", 
                    enabled, apiKey != null && !apiKey.isBlank());
            return Flux.empty();
        }

        return Flux.defer(() -> {
            try {
                String url = baseUrl.endsWith("/") ? baseUrl + "chat/completions" : baseUrl + "/chat/completions";
                
                // 현재 날짜/시간 포함한 프롬프트 생성
                String currentDateTime = LocalDateTime.now()
                        .format(DateTimeFormatter.ofPattern("yyyy년 MM월 dd일 HH:mm"));
                
                String systemPrompt = """
                        당신은 실시간 정보 검색 전문가입니다. 
                        사용자의 질문에 대해 최신 정보를 검색하고 정확한 데이터를 제공합니다.
                        
                        규칙:
                        1. 가격, 시세 등 숫자 데이터는 반드시 출처와 함께 제공
                        2. 검색된 정보의 날짜/시간을 명시
                        3. 여러 출처에서 교차 검증
                        4. 확인되지 않은 정보는 명시적으로 표시
                        
                        현재 시각: %s
                        """.formatted(currentDateTime);
                
                String userPrompt = """
                        다음 주제에 대한 최신 실시간 정보를 검색해주세요:
                        
                        주제: %s
                        
                        다음 형식으로 응답해주세요:
                        
                        ## 검색 결과
                        - 핵심 정보: [최신 데이터]
                        - 출처: [URL 또는 출처명]
                        - 확인 시점: [날짜/시간]
                        
                        ## 상세 정보
                        [관련 세부 정보]
                        
                        ## 추가 출처
                        [다른 출처에서 확인된 정보]
                        """.formatted(topic);

                log.debug("Fetching realtime evidence for topic: {}", topic);

                Map<String, Object> body = Map.of(
                        "model", "llama-3.1-sonar-large-128k-online",  // 실시간 검색 지원 모델
                        "stream", false,
                        "messages", List.of(
                                Map.of("role", "system", "content", systemPrompt),
                                Map.of("role", "user", "content", userPrompt)
                        ),
                        "return_citations", true  // 출처 URL 반환 요청
                );

                String response = webClient.post()
                        .uri(url)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .accept(MediaType.APPLICATION_JSON)
                        .bodyValue(body)
                        .retrieve()
                        .bodyToMono(String.class)
                        .timeout(Duration.ofSeconds(timeoutSeconds))
                        .block();

                return Flux.fromIterable(parseResponse(response, topic));
            } catch (Exception e) {
                log.warn("Realtime search failed for topic '{}': {}", topic, e.getMessage());
                return Flux.empty();
            }
        });
    }

    @Override
    public Flux<SourceEvidence> verifyClaimAgainstSource(String claim, String language) {
        // 주장에서 핵심 키워드 추출 후 검색
        return fetchEvidence(claim, language);
    }

    private List<SourceEvidence> parseResponse(String response, String originalTopic) {
        List<SourceEvidence> evidenceList = new ArrayList<>();
        
        if (response == null || response.isBlank()) {
            return evidenceList;
        }

        try {
            JsonNode root = objectMapper.readTree(response);
            
            // 응답 내용 추출
            String content = "";
            JsonNode choices = root.path("choices");
            if (choices.isArray() && !choices.isEmpty()) {
                content = choices.get(0).path("message").path("content").asText("");
            }
            
            // Citations (출처) 추출
            List<String> citations = new ArrayList<>();
            JsonNode citationsNode = root.path("citations");
            if (citationsNode.isArray()) {
                for (JsonNode citation : citationsNode) {
                    citations.add(citation.asText());
                }
            }
            
            // 메인 증거 생성
            if (!content.isBlank()) {
                String currentTime = LocalDateTime.now()
                        .format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
                
                // 가격 정보 추출
                String extractedPrices = extractPrices(content);
                
                StringBuilder excerpt = new StringBuilder();
                excerpt.append("[실시간 검색 결과 - ").append(currentTime).append("]\n\n");
                excerpt.append(truncate(content, 800));
                
                if (!extractedPrices.isEmpty()) {
                    excerpt.append("\n\n[추출된 가격 정보]\n").append(extractedPrices);
                }

                // 메인 증거
                SourceEvidence mainEvidence = SourceEvidence.builder()
                        .sourceType("realtime_search")
                        .sourceName("Perplexity Realtime Search")
                        .url(citations.isEmpty() ? null : citations.get(0))
                        .excerpt(excerpt.toString())
                        .relevanceScore(0.85)
                        .stance("neutral")  // 실시간 검색은 중립적 정보 제공
                        .build();
                evidenceList.add(mainEvidence);
                
                // 추가 출처들을 개별 증거로 추가
                for (int i = 1; i < Math.min(citations.size(), 5); i++) {
                    String citationUrl = citations.get(i);
                    SourceEvidence citationEvidence = SourceEvidence.builder()
                            .sourceType("realtime_search_citation")
                            .sourceName(extractDomain(citationUrl))
                            .url(citationUrl)
                            .excerpt("[출처 " + (i + 1) + "] " + citationUrl)
                            .relevanceScore(0.75)
                            .stance("neutral")
                            .build();
                    evidenceList.add(citationEvidence);
                }
            }
            
        } catch (Exception e) {
            log.warn("Failed to parse realtime search response: {}", e.getMessage());
        }

        return evidenceList;
    }

    /**
     * 텍스트에서 가격 정보 추출
     */
    private String extractPrices(String text) {
        StringBuilder prices = new StringBuilder();
        
        // USD 가격 추출
        Matcher usdMatcher = PRICE_PATTERN.matcher(text);
        int usdCount = 0;
        while (usdMatcher.find() && usdCount < 5) {
            String price = usdMatcher.group(1);
            // 의미있는 가격만 추출 (1000 이상)
            try {
                double value = Double.parseDouble(price.replace(",", ""));
                if (value >= 100) {
                    if (prices.length() > 0) prices.append("\n");
                    prices.append("- $").append(price);
                    usdCount++;
                }
            } catch (NumberFormatException ignored) {}
        }
        
        // KRW 가격 추출
        Matcher krwMatcher = KRW_PATTERN.matcher(text);
        int krwCount = 0;
        while (krwMatcher.find() && krwCount < 5) {
            String price = krwMatcher.group(1);
            try {
                double value = Double.parseDouble(price.replace(",", ""));
                if (value >= 1000) {
                    if (prices.length() > 0) prices.append("\n");
                    prices.append("- ₩").append(price);
                    krwCount++;
                }
            } catch (NumberFormatException ignored) {}
        }
        
        return prices.toString();
    }

    /**
     * URL에서 도메인 추출
     */
    private String extractDomain(String url) {
        if (url == null || url.isBlank()) return "Unknown Source";
        try {
            String domain = url.replaceFirst("https?://", "")
                    .replaceFirst("www\\.", "")
                    .split("/")[0];
            return domain;
        } catch (Exception e) {
            return "Unknown Source";
        }
    }

    private String truncate(String text, int maxLength) {
        if (text == null) return "";
        if (text.length() <= maxLength) return text;
        return text.substring(0, maxLength) + "...";
    }
}
