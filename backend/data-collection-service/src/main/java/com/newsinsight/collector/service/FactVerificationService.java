package com.newsinsight.collector.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.client.PerplexityClient;
import com.newsinsight.collector.config.TrustScoreConfig;
import com.newsinsight.collector.service.factcheck.FactCheckSource;
import com.newsinsight.collector.service.search.AdvancedIntentAnalyzer;
import com.newsinsight.collector.service.search.AdvancedIntentAnalyzer.AnalyzedQuery;
import com.newsinsight.collector.service.search.AdvancedIntentAnalyzer.FallbackStrategy;
import lombok.Builder;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * 심층 분석 신뢰성 검증 서비스
 * 
 * Wikipedia, 학술DB 등 신뢰할 수 있는 출처와 대조하여
 * 주장의 타당성을 검증합니다.
 */
@Service
@Slf4j
public class FactVerificationService {

    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    private final PerplexityClient perplexityClient;
    private final List<FactCheckSource> factCheckSources;
    private final TrustScoreConfig trustScoreConfig;
    private final List<TrustedSource> trustedSources;
    private final AdvancedIntentAnalyzer advancedIntentAnalyzer;

    public FactVerificationService(
            WebClient webClient,
            ObjectMapper objectMapper,
            PerplexityClient perplexityClient,
            List<FactCheckSource> factCheckSources,
            TrustScoreConfig trustScoreConfig,
            AdvancedIntentAnalyzer advancedIntentAnalyzer) {
        this.webClient = webClient;
        this.objectMapper = objectMapper;
        this.perplexityClient = perplexityClient;
        this.factCheckSources = factCheckSources;
        this.trustScoreConfig = trustScoreConfig;
        this.advancedIntentAnalyzer = advancedIntentAnalyzer;
        
        // Initialize trusted sources with externalized scores
        this.trustedSources = initializeTrustedSources();
        
        log.info("FactVerificationService initialized with {} sources: {}", 
                factCheckSources.size(),
                factCheckSources.stream()
                        .map(s -> s.getSourceId() + (s.isAvailable() ? " (active)" : " (disabled)"))
                        .collect(Collectors.joining(", ")));
    }

    private List<TrustedSource> initializeTrustedSources() {
        TrustScoreConfig.TrustedSources ts = trustScoreConfig.getTrusted();
        return List.of(
                new TrustedSource("wikipedia", "위키백과", "https://ko.wikipedia.org/wiki/", ts.getWikipediaKo()),
                new TrustedSource("wikipedia_en", "Wikipedia", "https://en.wikipedia.org/wiki/", ts.getWikipediaEn()),
                new TrustedSource("britannica", "브리태니커", "https://www.britannica.com/search?query=", ts.getBritannica()),
                new TrustedSource("namu", "나무위키", "https://namu.wiki/w/", ts.getNamuWiki()),
                new TrustedSource("kosis", "통계청", "https://kosis.kr/search/search.do?query=", ts.getKosis()),
                new TrustedSource("scholar", "학술 자료", "https://scholar.google.com/scholar?q=", ts.getGoogleScholar())
        );
    }

    @Value("${collector.crawler.base-url:http://web-crawler:11235}")
    private String crawlerBaseUrl;

    @Value("${collector.fact-check.timeout-seconds:30}")
    private int timeoutSeconds;

    // ============================================
    // DTO Classes
    // ============================================

    @Data
    @Builder
    public static class VerificationResult {
        private String claimId;
        private String originalClaim;       // 원본 주장
        private VerificationStatus status;  // 검증 상태
        private Double confidenceScore;     // 신뢰도 점수 (0-1)
        private List<SourceEvidence> supportingEvidence;    // 지지 근거
        private List<SourceEvidence> contradictingEvidence; // 반박 근거
        private String verificationSummary; // 검증 요약
        private List<String> relatedConcepts; // 관련 개념
    }

    public enum VerificationStatus {
        VERIFIED,           // 검증됨 (신뢰할 수 있는 출처에서 확인)
        PARTIALLY_VERIFIED, // 부분 검증됨
        UNVERIFIED,         // 검증 불가 (정보 부족)
        DISPUTED,           // 논쟁 중 (상반된 정보 존재)
        FALSE               // 거짓으로 판명
    }

    @Data
    @Builder
    public static class SourceEvidence {
        private String sourceType;      // wikipedia, scholar, news 등
        private String sourceName;      // 출처 이름
        private String url;             // URL
        private String excerpt;         // 관련 발췌문
        private Double relevanceScore;  // 관련성 점수
        private String stance;          // support, contradict, neutral
    }

    @Data
    @Builder
    public static class DeepAnalysisResult {
        private String topic;
        private List<VerificationResult> verifiedClaims;
        private ConceptMap conceptMap;          // 개념 관계도
        private List<String> keyInsights;       // 핵심 인사이트
        private CredibilityAssessment credibility; // 전체 신뢰도 평가
        private String finalConclusion;         // 최종 결론
    }

    @Data
    @Builder
    public static class ConceptMap {
        private String mainTopic;
        private List<RelatedConcept> relatedConcepts;
        private List<ConceptLink> links;
    }

    @Data
    @Builder
    public static class RelatedConcept {
        private String name;
        private String description;
        private String wikiUrl;
        private Double relevance;
    }

    @Data
    @Builder
    public static class ConceptLink {
        private String from;
        private String to;
        private String relationship;
    }

    @Data
    @Builder
    public static class CredibilityAssessment {
        private Double overallScore;        // 전체 신뢰도 (0-1)
        private Integer verifiedCount;      // 검증된 주장 수
        private Integer totalClaims;        // 전체 주장 수
        private String riskLevel;           // low, medium, high
        private List<String> warnings;      // 주의사항
    }

    private record TrustedSource(String id, String name, String searchUrl, double trustScore) {}

    // ============================================
    // Main Verification Methods
    // ============================================

    /**
     * 매우 단순한 언어 감지: 영문 알파벳이 포함되어 있으면 영어(en),
     * 그렇지 않으면 기본적으로 한국어(ko)로 간주.
     */
    private String detectLanguage(String text) {
        if (text == null || text.isBlank()) {
            return "ko";
        }
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
                return "en";
            }
        }
        return "ko";
    }

    /**
     * Claim 목록을 하나로 합쳐서 기준 텍스트를 만들고,
     * evidence.excerpt 와의 자카드 유사도를 이용해 의미 있는 근거만 남긴다.
     */
    private List<SourceEvidence> filterEvidenceForClaims(List<SourceEvidence> allEvidence, List<String> claims) {
        if (allEvidence == null || allEvidence.isEmpty()) {
            return List.of();
        }
        if (claims == null || claims.isEmpty()) {
            // Claim 정보가 없으면 필터링 없이 그대로 사용
            return new ArrayList<>(allEvidence);
        }

        String combinedClaims = claims.stream()
                .filter(c -> c != null && !c.isBlank())
                .collect(Collectors.joining(" "));
        if (combinedClaims.isBlank()) {
            return new ArrayList<>(allEvidence);
        }

        List<SourceEvidence> filtered = new ArrayList<>();
        for (SourceEvidence evidence : allEvidence) {
            if (evidence == null || evidence.getExcerpt() == null || evidence.getExcerpt().isBlank()) {
                continue;
            }
            double sim = calculateSimilarity(combinedClaims, evidence.getExcerpt());
            // 너무 낮은 유사도는 제거 (기본 0.1 기준)
            if (sim >= 0.1) {
                filtered.add(evidence);
            }
        }

        // 너무 많을 경우 상위 N개만 사용 (기본 50개)
        if (filtered.size() > 50) {
            return filtered.subList(0, 50);
        }
        return filtered;
    }

    /**
     * 주어진 주제에 대해 심층 분석 및 검증 수행
     */
    public Flux<DeepAnalysisEvent> analyzeAndVerify(String topic, List<String> claims) {
        log.info("Starting deep analysis and verification for topic: {}", topic);

        // Advanced Intent Analysis for better search strategies
        AnalyzedQuery analyzedTopic = advancedIntentAnalyzer.analyzeQuery(topic);
        log.info("Topic analyzed: keywords={}, primary='{}', intent={}, strategies={}",
                analyzedTopic.getKeywords().size(),
                analyzedTopic.getPrimaryKeyword(),
                analyzedTopic.getIntentType(),
                analyzedTopic.getFallbackStrategies().size());

        // 간단한 언어 감지 (영문 알파벳 포함 여부 기준)
        String language = analyzedTopic.getLanguage();

        return Flux.create(sink -> {
            // 1. 시작 이벤트
            sink.next(DeepAnalysisEvent.builder()
                    .eventType("status")
                    .phase("init")
                    .message("심층 분석을 시작합니다: " + topic)
                    .build());

            // 2. 관련 개념 수집
            sink.next(DeepAnalysisEvent.builder()
                    .eventType("status")
                    .phase("concepts")
                    .message("관련 개념을 수집하고 있습니다...")
                    .build());

            // 병렬로 모든 신뢰할 수 있는 소스에서 정보 수집 (폴백 전략 포함)
            List<SourceEvidence> allEvidence = fetchAllSourceEvidenceWithFallback(analyzedTopic, language);

            // Claim 정보가 있다면, claim과의 유사도 기반으로 근거를 1차 필터링
            List<SourceEvidence> filteredEvidence = filterEvidenceForClaims(allEvidence, claims);

            if (!filteredEvidence.isEmpty()) {
                // 소스별 통계 생성
                var sourceStats = filteredEvidence.stream()
                        .collect(Collectors.groupingBy(
                                SourceEvidence::getSourceType,
                                Collectors.counting()));
                String statsMessage = sourceStats.entrySet().stream()
                        .map(e -> e.getKey() + ": " + e.getValue() + "개")
                        .collect(Collectors.joining(", "));
                
                sink.next(DeepAnalysisEvent.builder()
                        .eventType("evidence")
                        .phase("concepts")
                        .message("신뢰할 수 있는 출처에서 " + filteredEvidence.size() + "개의 유의미한 근거를 수집했습니다. (" + statsMessage + ")")
                        .evidence(filteredEvidence)
                        .build());
            } else {
                // 결과가 없을 때 도움말 메시지
                String noResultMessage = advancedIntentAnalyzer.buildNoResultMessage(analyzedTopic);
                sink.next(DeepAnalysisEvent.builder()
                        .eventType("status")
                        .phase("concepts")
                        .message("관련 근거를 찾기 어려웠습니다.\n" + noResultMessage)
                        .build());
            }

            // 3. 각 주장에 대한 검증 (향상된 키워드 매칭)
            if (claims != null && !claims.isEmpty()) {
                sink.next(DeepAnalysisEvent.builder()
                        .eventType("status")
                        .phase("verification")
                        .message(claims.size() + "개의 주장을 검증하고 있습니다...")
                        .build());

                List<VerificationResult> verificationResults = new ArrayList<>();
                
                for (int i = 0; i < claims.size(); i++) {
                    String claim = claims.get(i);
                    // 향상된 claim 검증
                    VerificationResult result = verifyClaimWithIntentAnalysis(claim, filteredEvidence);
                    verificationResults.add(result);

                    sink.next(DeepAnalysisEvent.builder()
                            .eventType("verification")
                            .phase("verification")
                            .message("주장 " + (i + 1) + "/" + claims.size() + " 검증 완료")
                            .verificationResult(result)
                            .build());
                }

                // 4. 신뢰도 평가
                CredibilityAssessment credibility = assessCredibility(verificationResults);
                
                sink.next(DeepAnalysisEvent.builder()
                        .eventType("assessment")
                        .phase("assessment")
                        .message("신뢰도 평가 완료")
                        .credibility(credibility)
                        .build());
            }

            // 5. AI 기반 종합 분석
            sink.next(DeepAnalysisEvent.builder()
                    .eventType("status")
                    .phase("synthesis")
                    .message("AI가 수집된 정보를 종합 분석하고 있습니다...")
                    .build());

            if (perplexityClient.isEnabled()) {
                String synthesisPrompt = buildSynthesisPrompt(topic, filteredEvidence, claims);
                StringBuilder aiResponse = new StringBuilder();

                perplexityClient.streamCompletion(synthesisPrompt)
                        .doOnNext(chunk -> {
                            aiResponse.append(chunk);
                            sink.next(DeepAnalysisEvent.builder()
                                    .eventType("ai_synthesis")
                                    .phase("synthesis")
                                    .message(chunk)
                                    .build());
                        })
                        .doOnComplete(() -> {
                            sink.next(DeepAnalysisEvent.builder()
                                    .eventType("complete")
                                    .phase("complete")
                                    .message("심층 분석이 완료되었습니다.")
                                    .finalConclusion(aiResponse.toString())
                                    .build());
                            sink.complete();
                        })
                        .doOnError(e -> {
                            log.error("AI synthesis failed: {}", e.getMessage());
                            sink.next(DeepAnalysisEvent.builder()
                                    .eventType("complete")
                                    .phase("complete")
                                    .message("분석이 완료되었습니다. (AI 종합 분석 생략)")
                                    .build());
                            sink.complete();
                        })
                        .subscribe();
            } else {
                sink.next(DeepAnalysisEvent.builder()
                        .eventType("complete")
                        .phase("complete")
                        .message("심층 분석이 완료되었습니다.")
                        .build());
                sink.complete();
            }
        });
    }

    // ============================================
    // Enhanced Evidence Collection with Fallback
    // ============================================

    /**
     * 폴백 전략을 사용하여 모든 소스에서 근거 수집
     */
    private List<SourceEvidence> fetchAllSourceEvidenceWithFallback(AnalyzedQuery analyzedQuery, String language) {
        List<SourceEvidence> allEvidence = new CopyOnWriteArrayList<>();
        
        // 원본 쿼리로 먼저 시도
        String currentQuery = analyzedQuery.getOriginalQuery();
        allEvidence.addAll(fetchAllSourceEvidence(currentQuery, language));
        
        // 결과가 부족하면 폴백 전략 사용
        if (allEvidence.size() < 3 && analyzedQuery.getFallbackStrategies() != null) {
            int maxAttempts = Math.min(3, analyzedQuery.getFallbackStrategies().size());
            
            for (int i = 0; i < maxAttempts && allEvidence.size() < 5; i++) {
                FallbackStrategy strategy = analyzedQuery.getFallbackStrategies().get(i);
                log.info("Fact verification fallback attempt {}: strategy='{}', query='{}'", 
                        i + 1, strategy.getStrategyType(), strategy.getQuery());
                
                List<SourceEvidence> fallbackEvidence = fetchAllSourceEvidence(strategy.getQuery(), language);
                
                // 중복 제거하며 추가
                for (SourceEvidence evidence : fallbackEvidence) {
                    boolean isDuplicate = allEvidence.stream()
                            .anyMatch(e -> e.getUrl() != null && e.getUrl().equals(evidence.getUrl()));
                    if (!isDuplicate) {
                        allEvidence.add(evidence);
                    }
                }
            }
        }
        
        log.info("Total evidence collected with fallback: {} items", allEvidence.size());
        return new ArrayList<>(allEvidence);
    }

    /**
     * 향상된 Claim 검증 - Intent Analysis 사용
     */
    private VerificationResult verifyClaimWithIntentAnalysis(String claim, List<SourceEvidence> backgroundEvidence) {
        // Claim에 대한 의도 분석
        AnalyzedQuery analyzedClaim = advancedIntentAnalyzer.analyzeQuery(claim);
        List<String> keywords = analyzedClaim.getKeywords();
        String primaryKeyword = analyzedClaim.getPrimaryKeyword();

        // 배경 증거와 대조
        List<SourceEvidence> supporting = new ArrayList<>();
        List<SourceEvidence> contradicting = new ArrayList<>();

        for (SourceEvidence evidence : backgroundEvidence) {
            // 향상된 유사도 계산 - 키워드 매칭 포함
            double similarity = calculateEnhancedSimilarity(claim, evidence.getExcerpt(), keywords, primaryKeyword);
            
            if (similarity > 0.25) {  // 낮은 임계값으로 더 많은 매칭
                evidence.setRelevanceScore(similarity);
                
                // 감성 분석으로 지지/반박 구분
                if (containsContradiction(claim, evidence.getExcerpt())) {
                    evidence.setStance("contradict");
                    contradicting.add(evidence);
                } else {
                    evidence.setStance("support");
                    supporting.add(evidence);
                }
            }
        }

        // 검증 상태 결정
        VerificationStatus status;
        double confidence;

        if (!supporting.isEmpty() && contradicting.isEmpty()) {
            status = VerificationStatus.VERIFIED;
            confidence = Math.min(0.6 + supporting.size() * 0.1, 0.95);
        } else if (!supporting.isEmpty() && !contradicting.isEmpty()) {
            status = VerificationStatus.DISPUTED;
            confidence = 0.5;
        } else if (supporting.isEmpty() && !contradicting.isEmpty()) {
            status = VerificationStatus.FALSE;
            confidence = 0.3;
        } else {
            status = VerificationStatus.UNVERIFIED;
            confidence = 0.4;
        }

        String summary = generateVerificationSummary(status, supporting.size(), contradicting.size());

        return VerificationResult.builder()
                .claimId(UUID.randomUUID().toString())
                .originalClaim(claim)
                .status(status)
                .confidenceScore(confidence)
                .supportingEvidence(supporting)
                .contradictingEvidence(contradicting)
                .verificationSummary(summary)
                .relatedConcepts(keywords)
                .build();
    }

    /**
     * 향상된 유사도 계산 - 키워드 매칭 + 자카드 유사도 결합
     */
    private double calculateEnhancedSimilarity(
            String claim, 
            String evidence, 
            List<String> keywords, 
            String primaryKeyword) {
        
        if (claim == null || evidence == null) return 0;
        
        String lowerClaim = claim.toLowerCase();
        String lowerEvidence = evidence.toLowerCase();
        
        double score = 0;
        
        // 1. 기본 자카드 유사도
        double jaccardScore = calculateSimilarity(claim, evidence);
        score += jaccardScore * 0.4;
        
        // 2. 주요 키워드 매칭 (높은 가중치)
        if (primaryKeyword != null && !primaryKeyword.isBlank() && 
                lowerEvidence.contains(primaryKeyword.toLowerCase())) {
            score += 0.3;
        }
        
        // 3. 기타 키워드 매칭
        if (keywords != null && !keywords.isEmpty()) {
            int matchCount = 0;
            for (String keyword : keywords) {
                if (lowerEvidence.contains(keyword.toLowerCase())) {
                    matchCount++;
                }
            }
            score += (double) matchCount / keywords.size() * 0.3;
        }
        
        return Math.min(score, 1.0);
    }

    // ============================================
    // Wikipedia & Trusted Source Fetching
    // ============================================

    /**
     * 모든 등록된 팩트체크 소스에서 병렬로 근거를 수집합니다.
     */
    private List<SourceEvidence> fetchAllSourceEvidence(String topic, String language) {
        List<SourceEvidence> allEvidence = new CopyOnWriteArrayList<>();
        
        // 1. 기본 Wikipedia 정보 수집 (기존 로직 유지)
        List<SourceEvidence> wikiEvidence = fetchWikipediaInfo(topic);
        allEvidence.addAll(wikiEvidence);
        
        // 2. 추가 팩트체크 소스에서 병렬 수집
        if (factCheckSources != null && !factCheckSources.isEmpty()) {
            List<Mono<List<SourceEvidence>>> sourceFetches = factCheckSources.stream()
                    .filter(FactCheckSource::isAvailable)
                    .map(source -> {
                        log.debug("Fetching evidence from source: {}", source.getSourceId());
                        return source.fetchEvidence(topic, language)
                                .collectList()
                                .timeout(Duration.ofSeconds(timeoutSeconds))
                                .doOnNext(evidences -> 
                                    log.debug("Source {} returned {} evidences", 
                                            source.getSourceId(), evidences.size()))
                                .onErrorResume(e -> {
                                    log.warn("Failed to fetch from {}: {}", 
                                            source.getSourceId(), e.getMessage());
                                    return Mono.just(List.of());
                                });
                    })
                    .toList();
            
            if (!sourceFetches.isEmpty()) {
                try {
                    List<List<SourceEvidence>> results = Flux.merge(sourceFetches)
                            .collectList()
                            .block(Duration.ofSeconds(timeoutSeconds * 2));
                    
                    if (results != null) {
                        for (List<SourceEvidence> evidences : results) {
                            allEvidence.addAll(evidences);
                        }
                    }
                } catch (Exception e) {
                    log.warn("Error during parallel evidence fetch: {}", e.getMessage());
                }
            }
        }
        
        log.info("Collected total {} evidence items for topic: {}", allEvidence.size(), topic);
        return new ArrayList<>(allEvidence);
    }

    private List<SourceEvidence> fetchWikipediaInfo(String topic) {
        List<SourceEvidence> evidenceList = new ArrayList<>();

        // 한국어 위키백과
        try {
            String koWikiContent = fetchWikipediaContent(topic, "ko");
            if (koWikiContent != null && !koWikiContent.isBlank()) {
                evidenceList.add(SourceEvidence.builder()
                        .sourceType("wikipedia")
                        .sourceName("위키백과")
                        .url("https://ko.wikipedia.org/wiki/" + URLEncoder.encode(topic, StandardCharsets.UTF_8))
                        .excerpt(truncateContent(koWikiContent, 500))
                        .relevanceScore(0.9)
                        .stance("neutral")
                        .build());
            }
        } catch (Exception e) {
            log.debug("Failed to fetch Korean Wikipedia: {}", e.getMessage());
        }

        // 영어 위키백과
        try {
            String enWikiContent = fetchWikipediaContent(topic, "en");
            if (enWikiContent != null && !enWikiContent.isBlank()) {
                evidenceList.add(SourceEvidence.builder()
                        .sourceType("wikipedia")
                        .sourceName("Wikipedia (EN)")
                        .url("https://en.wikipedia.org/wiki/" + URLEncoder.encode(topic, StandardCharsets.UTF_8))
                        .excerpt(truncateContent(enWikiContent, 500))
                        .relevanceScore(0.9)
                        .stance("neutral")
                        .build());
            }
        } catch (Exception e) {
            log.debug("Failed to fetch English Wikipedia: {}", e.getMessage());
        }

        return evidenceList;
    }

    private String fetchWikipediaContent(String topic, String lang) {
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

    // ============================================
    // Claim Verification
    // ============================================

    private VerificationResult verifyClaim(String claim, List<SourceEvidence> backgroundEvidence) {
        // 주장에서 핵심 키워드 추출
        List<String> keywords = extractKeywords(claim);

        // 배경 증거와 대조
        List<SourceEvidence> supporting = new ArrayList<>();
        List<SourceEvidence> contradicting = new ArrayList<>();

        for (SourceEvidence evidence : backgroundEvidence) {
            double similarity = calculateSimilarity(claim, evidence.getExcerpt());
            if (similarity > 0.3) {
                evidence.setRelevanceScore(similarity);
                // 간단한 감성 분석으로 지지/반박 구분 (실제로는 더 정교한 분석 필요)
                if (containsContradiction(claim, evidence.getExcerpt())) {
                    evidence.setStance("contradict");
                    contradicting.add(evidence);
                } else {
                    evidence.setStance("support");
                    supporting.add(evidence);
                }
            }
        }

        // 검증 상태 결정
        VerificationStatus status;
        double confidence;

        if (!supporting.isEmpty() && contradicting.isEmpty()) {
            status = VerificationStatus.VERIFIED;
            confidence = 0.8;
        } else if (!supporting.isEmpty() && !contradicting.isEmpty()) {
            status = VerificationStatus.DISPUTED;
            confidence = 0.5;
        } else if (supporting.isEmpty() && !contradicting.isEmpty()) {
            status = VerificationStatus.FALSE;
            confidence = 0.3;
        } else {
            status = VerificationStatus.UNVERIFIED;
            confidence = 0.4;
        }

        String summary = generateVerificationSummary(status, supporting.size(), contradicting.size());

        return VerificationResult.builder()
                .claimId(UUID.randomUUID().toString())
                .originalClaim(claim)
                .status(status)
                .confidenceScore(confidence)
                .supportingEvidence(supporting)
                .contradictingEvidence(contradicting)
                .verificationSummary(summary)
                .relatedConcepts(keywords)
                .build();
    }

    private List<String> extractKeywords(String text) {
        // 간단한 키워드 추출 (명사 추출)
        List<String> keywords = new ArrayList<>();
        String[] words = text.split("[\\s,\\.\\?!]+");
        for (String word : words) {
            if (word.length() > 2 && !isStopWord(word)) {
                keywords.add(word.toLowerCase());
            }
        }
        return keywords.stream().distinct().limit(5).toList();
    }

    private boolean isStopWord(String word) {
        return List.of("the", "a", "an", "is", "are", "was", "were", "이", "그", "저", 
                "는", "은", "가", "이", "를", "을", "에", "의").contains(word.toLowerCase());
    }

    private double calculateSimilarity(String text1, String text2) {
        if (text1 == null || text2 == null) return 0;
        
        // 간단한 자카드 유사도
        String[] words1 = text1.toLowerCase().split("\\s+");
        String[] words2 = text2.toLowerCase().split("\\s+");
        
        java.util.Set<String> set1 = new java.util.HashSet<>(List.of(words1));
        java.util.Set<String> set2 = new java.util.HashSet<>(List.of(words2));
        
        java.util.Set<String> intersection = new java.util.HashSet<>(set1);
        intersection.retainAll(set2);
        
        java.util.Set<String> union = new java.util.HashSet<>(set1);
        union.addAll(set2);
        
        return union.isEmpty() ? 0 : (double) intersection.size() / union.size();
    }

    private boolean containsContradiction(String claim, String evidence) {
        // 간단한 부정 표현 감지
        String lowerEvidence = evidence.toLowerCase();
        String lowerClaim = claim.toLowerCase();
        
        List<String> negativePatterns = List.of(
                "not true", "false", "incorrect", "wrong", "disputed", "controversy",
                "사실이 아", "거짓", "논쟁", "오류", "틀린", "잘못"
        );
        
        for (String pattern : negativePatterns) {
            if (lowerEvidence.contains(pattern)) {
                return true;
            }
        }
        return false;
    }

    private String generateVerificationSummary(VerificationStatus status, int supportCount, int contradictCount) {
        return switch (status) {
            case VERIFIED -> String.format("✅ 신뢰할 수 있는 %d개의 출처에서 확인되었습니다.", supportCount);
            case PARTIALLY_VERIFIED -> String.format("⚠️ 부분적으로 확인되었습니다. (지지: %d, 반박: %d)", supportCount, contradictCount);
            case UNVERIFIED -> "❓ 신뢰할 수 있는 출처에서 관련 정보를 찾을 수 없습니다.";
            case DISPUTED -> String.format("⚖️ 논쟁 중인 주장입니다. (지지: %d, 반박: %d)", supportCount, contradictCount);
            case FALSE -> String.format("❌ 신뢰할 수 있는 출처에서 반박되었습니다. (반박: %d)", contradictCount);
        };
    }

    // ============================================
    // Credibility Assessment
    // ============================================

    private CredibilityAssessment assessCredibility(List<VerificationResult> results) {
        int verified = 0;
        int disputed = 0;
        int falseClaims = 0;
        List<String> warnings = new ArrayList<>();

        for (VerificationResult result : results) {
            switch (result.getStatus()) {
                case VERIFIED, PARTIALLY_VERIFIED -> verified++;
                case DISPUTED -> {
                    disputed++;
                    warnings.add("논쟁 중: " + truncateContent(result.getOriginalClaim(), 50));
                }
                case FALSE -> {
                    falseClaims++;
                    warnings.add("주의 필요: " + truncateContent(result.getOriginalClaim(), 50));
                }
                default -> {}
            }
        }

        double score = results.isEmpty() ? 0.5 : 
                (double) verified / results.size() * 0.7 + 
                (1 - (double) falseClaims / Math.max(1, results.size())) * 0.3;

        String riskLevel;
        if (falseClaims > 0 || disputed > verified) {
            riskLevel = "high";
        } else if (disputed > 0) {
            riskLevel = "medium";
        } else {
            riskLevel = "low";
        }

        return CredibilityAssessment.builder()
                .overallScore(score)
                .verifiedCount(verified)
                .totalClaims(results.size())
                .riskLevel(riskLevel)
                .warnings(warnings)
                .build();
    }

    // ============================================
    // AI Synthesis
    // ============================================

    private String buildSynthesisPrompt(String topic, List<SourceEvidence> evidence, List<String> claims) {
        StringBuilder prompt = new StringBuilder();
        prompt.append("당신은 팩트체커이자 심층 분석 전문가입니다.\n\n");
        prompt.append("주제: ").append(topic).append("\n\n");

        if (!evidence.isEmpty()) {
            prompt.append("## 신뢰할 수 있는 출처에서 수집된 정보:\n");
            for (SourceEvidence e : evidence) {
                prompt.append("- [").append(e.getSourceName()).append("] ").append(e.getExcerpt()).append("\n");
            }
            prompt.append("\n");
        }

        if (claims != null && !claims.isEmpty()) {
            prompt.append("## 검증이 필요한 주장들:\n");
            for (String claim : claims) {
                prompt.append("- ").append(claim).append("\n");
            }
            prompt.append("\n");
        }

        prompt.append("""
                위 정보를 바탕으로 다음을 제공해주세요:
                
                ## 사실 확인 결과
                각 주장에 대한 팩트체크 결과를 제시
                
                ## 배경 지식
                이 주제를 이해하는 데 필요한 핵심 개념 설명
                
                ## 다양한 관점
                서로 다른 시각이나 해석이 있다면 균형있게 제시
                
                ## 결론
                객관적인 종합 판단
                
                한국어로 답변해주세요. 불확실한 정보는 명확히 표시해주세요.
                """);

        return prompt.toString();
    }

    // ============================================
    // Utility Methods
    // ============================================

    private String truncateContent(String content, int maxLength) {
        if (content == null) return "";
        if (content.length() <= maxLength) return content;
        return content.substring(0, maxLength) + "...";
    }

    // ============================================
    // Event DTO
    // ============================================

    @Data
    @Builder
    public static class DeepAnalysisEvent {
        private String eventType;       // status, evidence, verification, assessment, ai_synthesis, complete
        private String phase;           // init, concepts, verification, assessment, synthesis, complete
        private String message;
        private List<SourceEvidence> evidence;
        private VerificationResult verificationResult;
        private CredibilityAssessment credibility;
        private String finalConclusion;
    }
}
