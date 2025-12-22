package com.newsinsight.collector.service.search;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.client.AIDoveClient;
import com.newsinsight.collector.client.OpenAICompatibleClient;
import com.newsinsight.collector.service.search.HybridRankingService.QueryIntent;
import com.newsinsight.collector.service.search.HybridRankingService.QueryIntent.IntentType;
import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

/**
 * LLM 기반 검색 의도 분석 서비스
 * 
 * 하드코딩된 키워드 매핑 대신 LLM을 활용하여:
 * 1. 쿼리의 의도를 문맥적으로 이해
 * 2. 다국어 쿼리 자동 지원
 * 3. 새로운 의도 유형 자동 인식
 * 4. 동의어/유사어 자동 처리
 * 
 * 예시:
 * - "전기차 배터리 수명이 5년 이상 가지 않는다" → FACT_CHECK (문맥 이해)
 * - "양자컴퓨터 상용화 전망" → DEEP_ANALYSIS (신규 도메인 자동 인식)
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class LlmIntentAnalyzer {

    private final AIDoveClient aiDoveClient;
    private final OpenAICompatibleClient openAICompatibleClient;
    private final ObjectMapper objectMapper;

    @Value("${collector.intent-analysis.llm-enabled:true}")
    private boolean enabled;

    @Value("${collector.intent-analysis.timeout-seconds:10}")
    private int timeoutSeconds;

    // 캐시: 동일 쿼리 반복 분석 방지 (최대 200개, 5분 TTL)
    private final ConcurrentHashMap<String, CachedIntent> intentCache = new ConcurrentHashMap<>();
    private static final int MAX_CACHE_SIZE = 200;
    private static final long CACHE_TTL_MS = 300_000; // 5분

    /**
     * 쿼리의 의도를 LLM으로 분석합니다.
     * 
     * @param query 사용자 쿼리
     * @return 분석된 의도 결과
     */
    public Mono<IntentAnalysisResult> analyzeIntent(String query) {
        if (!enabled) {
            return Mono.empty();
        }

        if (query == null || query.isBlank()) {
            return Mono.just(createDefaultIntent());
        }

        // 캐시 확인
        String cacheKey = query.toLowerCase().trim();
        CachedIntent cached = intentCache.get(cacheKey);
        if (cached != null && System.currentTimeMillis() - cached.timestamp < CACHE_TTL_MS) {
            log.debug("Cache hit for intent analysis: {}", query);
            return Mono.just(cached.result);
        }

        // LLM 분석 수행
        String prompt = buildIntentPrompt(query);
        
        return callLlmWithFallback(prompt)
                .map(this::parseIntentResponse)
                .doOnNext(result -> cacheResult(cacheKey, result))
                .doOnNext(result -> log.info("LLM intent analysis: '{}' → {} (confidence: {:.2f})", 
                        query, result.getIntentType(), result.getConfidence()))
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .onErrorResume(e -> {
                    log.warn("LLM intent analysis failed for '{}': {}", query, e.getMessage());
                    return Mono.empty();
                });
    }

    /**
     * LLM 프롬프트 생성
     */
    private String buildIntentPrompt(String query) {
        return """
                You are a search intent analyzer. Analyze the following query and determine the user's search intent.
                
                Query: "%s"
                
                Available intent types:
                - FACT_CHECK: User wants to verify information or check facts (e.g., "Is this true?", "fact check", "verify")
                - LATEST_NEWS: User wants the most recent news (e.g., "today", "latest", "breaking news")
                - DEEP_ANALYSIS: User wants in-depth analysis or background (e.g., "why", "analysis", "impact", "cause")
                - OPINION_SEARCH: User wants opinions or reactions (e.g., "public opinion", "reactions", "controversy")
                - GENERAL: General information search
                
                Return ONLY a valid JSON object in this exact format (no markdown, no code blocks):
                {
                  "intentType": "FACT_CHECK",
                  "confidence": 0.85,
                  "keywords": ["keyword1", "keyword2"],
                  "suggestedCategories": ["TECH", "FINANCE"],
                  "timeRange": "7d",
                  "reasoning": "The query contains verification language and asks about factual claims"
                }
                
                Rules:
                - intentType must be one of: FACT_CHECK, LATEST_NEWS, DEEP_ANALYSIS, OPINION_SEARCH, GENERAL
                - confidence must be between 0.0 and 1.0
                - keywords should be 2-5 main keywords from the query
                - suggestedCategories can include: TECH, FINANCE, POLITICS, HEALTH, SCIENCE, SPORTS, ENTERTAINMENT
                - timeRange can be: 1d, 7d, 30d, or null
                - reasoning should be brief (1 sentence)
                
                Respond with ONLY the JSON object, nothing else.
                """.formatted(query);
    }

    /**
     * LLM 호출 (폴백 체인)
     */
    private Mono<String> callLlmWithFallback(String prompt) {
        // 1. AI Dove 시도
        if (aiDoveClient.isEnabled()) {
            return aiDoveClient.chat(prompt, null)
                    .map(AIDoveClient.AIDoveResponse::reply)
                    .timeout(Duration.ofSeconds(timeoutSeconds))
                    .onErrorResume(e -> {
                        log.debug("AI Dove failed for intent analysis, trying OpenAI: {}", e.getMessage());
                        return tryOpenAI(prompt);
                    });
        }
        
        // 2. OpenAI 시도
        return tryOpenAI(prompt);
    }

    private Mono<String> tryOpenAI(String prompt) {
        if (openAICompatibleClient.isOpenAIEnabled()) {
            return openAICompatibleClient.streamFromOpenAI(prompt)
                    .collectList()
                    .map(chunks -> String.join("", chunks))
                    .timeout(Duration.ofSeconds(timeoutSeconds))
                    .onErrorResume(e -> {
                        log.warn("All LLM providers failed for intent analysis: {}", e.getMessage());
                        return Mono.error(e);
                    });
        }
        
        return Mono.error(new IllegalStateException("No LLM provider available for intent analysis"));
    }

    /**
     * LLM 응답 파싱
     */
    private IntentAnalysisResult parseIntentResponse(String llmResponse) {
        try {
            // JSON 추출 (마크다운 코드 블록 제거)
            String jsonStr = llmResponse.trim();
            if (jsonStr.startsWith("```")) {
                jsonStr = jsonStr.replaceAll("```json\\s*", "").replaceAll("```\\s*", "").trim();
            }
            
            JsonNode node = objectMapper.readTree(jsonStr);
            
            // intentType 파싱
            String intentTypeStr = node.has("intentType") ? node.get("intentType").asText() : "GENERAL";
            IntentType intentType;
            try {
                intentType = IntentType.valueOf(intentTypeStr);
            } catch (IllegalArgumentException e) {
                log.warn("Unknown intent type from LLM: {}, using GENERAL", intentTypeStr);
                intentType = IntentType.GENERAL;
            }
            
            // confidence 파싱
            double confidence = node.has("confidence") ? node.get("confidence").asDouble() : 0.5;
            confidence = Math.max(0.0, Math.min(1.0, confidence)); // 0-1 범위로 제한
            
            // keywords 파싱
            List<String> keywords = new ArrayList<>();
            if (node.has("keywords") && node.get("keywords").isArray()) {
                node.get("keywords").forEach(k -> keywords.add(k.asText()));
            }
            
            // suggestedCategories 파싱
            List<String> categories = new ArrayList<>();
            if (node.has("suggestedCategories") && node.get("suggestedCategories").isArray()) {
                node.get("suggestedCategories").forEach(c -> categories.add(c.asText()));
            }
            
            // timeRange 파싱
            String timeRange = node.has("timeRange") && !node.get("timeRange").isNull() 
                    ? node.get("timeRange").asText() 
                    : null;
            
            // reasoning 파싱
            String reasoning = node.has("reasoning") ? node.get("reasoning").asText() : "";
            
            return IntentAnalysisResult.builder()
                    .intentType(intentType)
                    .confidence(confidence)
                    .keywords(keywords)
                    .suggestedCategories(categories)
                    .timeRange(timeRange)
                    .reasoning(reasoning)
                    .build();
            
        } catch (Exception e) {
            log.error("Failed to parse LLM intent response: {}", e.getMessage());
            log.debug("Raw LLM response: {}", llmResponse);
            return createDefaultIntent();
        }
    }

    /**
     * 기본 의도 생성 (파싱 실패 시)
     */
    private IntentAnalysisResult createDefaultIntent() {
        return IntentAnalysisResult.builder()
                .intentType(IntentType.GENERAL)
                .confidence(0.5)
                .keywords(List.of())
                .suggestedCategories(List.of())
                .timeRange(null)
                .reasoning("Default intent due to parsing failure")
                .build();
    }

    /**
     * 캐시에 결과 저장
     */
    private void cacheResult(String key, IntentAnalysisResult result) {
        if (intentCache.size() >= MAX_CACHE_SIZE) {
            // 오래된 항목 제거
            long now = System.currentTimeMillis();
            intentCache.entrySet().removeIf(entry -> 
                    now - entry.getValue().timestamp > CACHE_TTL_MS);
        }
        
        intentCache.put(key, new CachedIntent(result, System.currentTimeMillis()));
    }

    /**
     * 서비스 활성화 여부
     */
    public boolean isEnabled() {
        return enabled && (aiDoveClient.isEnabled() || openAICompatibleClient.isOpenAIEnabled());
    }

    /**
     * LLM 분석 결과를 QueryIntent로 변환
     */
    public QueryIntent convertToQueryIntent(IntentAnalysisResult result) {
        return QueryIntent.builder()
                .type(result.getIntentType())
                .confidence(result.getConfidence())
                .keywords(result.getKeywords())
                .timeRange(result.getTimeRange())
                .build();
    }

    // ==================== Inner Classes ====================

    /**
     * LLM 의도 분석 결과
     */
    @Data
    @Builder
    public static class IntentAnalysisResult {
        private IntentType intentType;
        private double confidence;
        private List<String> keywords;
        private List<String> suggestedCategories;
        private String timeRange;
        private String reasoning;
    }

    /**
     * 캐시된 의도 분석 결과
     */
    @Data
    private static class CachedIntent {
        private final IntentAnalysisResult result;
        private final long timestamp;
    }
}
