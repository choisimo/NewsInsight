package com.newsinsight.collector.service.factcheck;

import com.newsinsight.collector.client.AIDoveClient;
import com.newsinsight.collector.client.OpenAICompatibleClient;
import com.newsinsight.collector.client.PerplexityClient;
import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * LLM 기반 동적 쿼리 확장 서비스
 * 
 * 하드코딩된 키워드 사전 대신 LLM을 활용하여:
 * 1. 쿼리의 의도와 문맥을 이해
 * 2. 관련 동의어 및 영문 학술 키워드 자동 생성
 * 3. 다국어 쿼리를 학술 DB 검색에 적합한 형태로 변환
 * 
 * 예시:
 * - 입력: "전기차 배터리 수명"
 * - 출력: ["electric vehicle battery lifespan", "EV battery durability", 
 *          "lithium-ion battery degradation", "charging cycle longevity"]
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class LlmQueryExpansionService {

    private final AIDoveClient aiDoveClient;
    private final OpenAICompatibleClient openAICompatibleClient;
    private final PerplexityClient perplexityClient;
    
    // 캐시: 동일한 쿼리에 대한 반복 LLM 호출 방지 (최대 500개, 10분 TTL)
    private final ConcurrentHashMap<String, CachedExpansion> expansionCache = new ConcurrentHashMap<>();
    private static final int MAX_CACHE_SIZE = 500;
    private static final long CACHE_TTL_MS = 600_000; // 10분

    /**
     * 쿼리를 학술 검색에 적합한 영문 키워드로 확장합니다.
     * 
     * @param originalQuery 원본 쿼리 (한국어 또는 영어)
     * @param keywords 추출된 키워드 목록
     * @param language 언어 코드 (ko, en)
     * @return 확장된 학술 검색 쿼리 목록
     */
    public Mono<List<String>> expandForAcademicSearch(String originalQuery, List<String> keywords, String language) {
        if (originalQuery == null || originalQuery.isBlank()) {
            return Mono.just(List.of());
        }

        // 캐시 확인
        String cacheKey = originalQuery.toLowerCase().trim();
        CachedExpansion cached = expansionCache.get(cacheKey);
        if (cached != null && System.currentTimeMillis() - cached.timestamp < CACHE_TTL_MS) {
            log.debug("Cache hit for query expansion: {}", originalQuery);
            return Mono.just(cached.expandedQueries);
        }

        // 영어 쿼리는 확장만 수행
        if ("en".equals(language)) {
            return expandEnglishQuery(originalQuery, keywords)
                    .doOnNext(expanded -> cacheResult(cacheKey, expanded));
        }

        // 한국어 쿼리는 번역 + 확장
        return translateAndExpandKoreanQuery(originalQuery, keywords)
                .doOnNext(expanded -> cacheResult(cacheKey, expanded));
    }

    /**
     * 한국어 쿼리를 영문 학술 키워드로 번역 및 확장
     */
    private Mono<List<String>> translateAndExpandKoreanQuery(String koreanQuery, List<String> keywords) {
        String prompt = buildTranslationPrompt(koreanQuery, keywords);
        
        return callLlmWithFallback(prompt)
                .map(this::parseExpandedQueries)
                .doOnNext(queries -> log.info("Korean query '{}' expanded to {} academic queries", 
                        koreanQuery, queries.size()))
                .onErrorResume(e -> {
                    log.warn("LLM expansion failed for '{}', using fallback: {}", koreanQuery, e.getMessage());
                    return Mono.just(buildFallbackExpansion(koreanQuery, keywords));
                });
    }

    /**
     * 영어 쿼리를 학술 검색에 적합하게 확장
     */
    private Mono<List<String>> expandEnglishQuery(String englishQuery, List<String> keywords) {
        String prompt = buildExpansionPrompt(englishQuery, keywords);
        
        return callLlmWithFallback(prompt)
                .map(this::parseExpandedQueries)
                .doOnNext(queries -> log.info("English query '{}' expanded to {} variants", 
                        englishQuery, queries.size()))
                .onErrorResume(e -> {
                    log.warn("LLM expansion failed for '{}', using original: {}", englishQuery, e.getMessage());
                    return Mono.just(List.of(englishQuery));
                });
    }

    /**
     * LLM 프롬프트 생성 - 한국어 → 영문 학술 키워드 변환
     */
    private String buildTranslationPrompt(String koreanQuery, List<String> keywords) {
        return String.format("""
                You are an academic research assistant. Convert the following Korean query into English academic search terms suitable for scholarly databases (PubMed, OpenAlex, CrossRef, etc.).
                
                Korean Query: "%s"
                Extracted Keywords: %s
                
                Requirements:
                1. Generate 3-5 English academic search queries
                2. Use formal academic terminology
                3. Include technical synonyms and related concepts
                4. Focus on research-oriented language
                5. Each query should be on a new line
                
                Output format (one query per line):
                [English academic query 1]
                [English academic query 2]
                [English academic query 3]
                ...
                
                Do NOT include explanations, just the queries.
                """, koreanQuery, keywords);
    }

    /**
     * LLM 프롬프트 생성 - 영어 쿼리 확장
     */
    private String buildExpansionPrompt(String englishQuery, List<String> keywords) {
        return String.format("""
                You are an academic research assistant. Expand the following query into multiple academic search variants for scholarly databases.
                
                Query: "%s"
                Keywords: %s
                
                Requirements:
                1. Generate 3-5 search query variants
                2. Include technical synonyms and related terms
                3. Use formal academic language
                4. Each variant should be on a new line
                
                Output format (one query per line):
                [Query variant 1]
                [Query variant 2]
                [Query variant 3]
                ...
                
                Do NOT include explanations, just the queries.
                """, englishQuery, keywords);
    }

    /**
     * LLM 호출 (폴백 체인 사용)
     */
    private Mono<String> callLlmWithFallback(String prompt) {
        // 1. AI Dove 시도
        if (aiDoveClient.isEnabled()) {
            return aiDoveClient.chat(prompt, null)
                    .map(AIDoveClient.AIDoveResponse::reply)
                    .timeout(Duration.ofSeconds(30))
                    .onErrorResume(e -> {
                        log.debug("AI Dove failed, trying OpenAI: {}", e.getMessage());
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
                    .timeout(Duration.ofSeconds(30))
                    .onErrorResume(e -> {
                        log.debug("OpenAI failed, trying Perplexity: {}", e.getMessage());
                        return tryPerplexity(prompt);
                    });
        }
        
        return tryPerplexity(prompt);
    }

    private Mono<String> tryPerplexity(String prompt) {
        if (perplexityClient.isEnabled()) {
            return perplexityClient.search(prompt)
                    .timeout(Duration.ofSeconds(30))
                    .onErrorResume(e -> {
                        log.warn("All LLM providers failed: {}", e.getMessage());
                        return Mono.error(e);
                    });
        }
        
        return Mono.error(new IllegalStateException("No LLM provider available"));
    }

    /**
     * LLM 응답에서 쿼리 목록 파싱
     */
    private List<String> parseExpandedQueries(String llmResponse) {
        if (llmResponse == null || llmResponse.isBlank()) {
            return List.of();
        }

        List<String> queries = new ArrayList<>();
        String[] lines = llmResponse.split("\n");
        
        for (String line : lines) {
            String cleaned = line.trim()
                    .replaceAll("^[-*•\\d]+\\.?\\s*", "") // 리스트 마커 제거
                    .replaceAll("^[\"']|[\"']$", "")      // 따옴표 제거
                    .trim();
            
            if (!cleaned.isBlank() && cleaned.length() > 3 && !cleaned.contains(":")) {
                queries.add(cleaned);
            }
        }

        // 최대 5개로 제한
        return queries.stream().limit(5).toList();
    }

    /**
     * LLM 실패 시 폴백: 간단한 규칙 기반 확장
     */
    private List<String> buildFallbackExpansion(String query, List<String> keywords) {
        List<String> fallback = new ArrayList<>();
        
        // 원본 쿼리
        fallback.add(query);
        
        // 키워드 조합
        if (keywords != null && !keywords.isEmpty()) {
            fallback.add(String.join(" ", keywords));
            
            // 상위 2-3개 키워드
            if (keywords.size() >= 2) {
                fallback.add(keywords.get(0) + " " + keywords.get(1));
            }
        }
        
        return fallback;
    }

    /**
     * 캐시에 결과 저장
     */
    private void cacheResult(String key, List<String> expandedQueries) {
        if (expansionCache.size() >= MAX_CACHE_SIZE) {
            // 오래된 항목 제거
            long now = System.currentTimeMillis();
            expansionCache.entrySet().removeIf(entry -> 
                    now - entry.getValue().timestamp > CACHE_TTL_MS);
        }
        
        expansionCache.put(key, new CachedExpansion(expandedQueries, System.currentTimeMillis()));
    }

    /**
     * 캐시된 확장 결과
     */
    @Data
    @Builder
    private static class CachedExpansion {
        private final List<String> expandedQueries;
        private final long timestamp;
    }
}
