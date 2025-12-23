package com.newsinsight.collector.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.client.PerplexityClient;
import com.newsinsight.collector.client.OpenAICompatibleClient;
import com.newsinsight.collector.client.AIDoveClient;
import com.newsinsight.collector.config.TrustScoreConfig;
import com.newsinsight.collector.service.factcheck.FactCheckSource;
import com.newsinsight.collector.service.factcheck.RRFEvidenceFusionService;
import com.newsinsight.collector.service.factcheck.RRFEvidenceFusionService.FusionResult;
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
import java.util.Set;
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
    private final OpenAICompatibleClient openAICompatibleClient;
    private final AIDoveClient aiDoveClient;
    private final List<FactCheckSource> factCheckSources;
    private final TrustScoreConfig trustScoreConfig;
    private final List<TrustedSource> trustedSources;
    private final AdvancedIntentAnalyzer advancedIntentAnalyzer;
    private final RRFEvidenceFusionService rrfFusionService;
    
    @Value("${collector.fact-check.rrf.enabled:true}")
    private boolean rrfEnabled;

    public FactVerificationService(
            WebClient webClient,
            ObjectMapper objectMapper,
            PerplexityClient perplexityClient,
            OpenAICompatibleClient openAICompatibleClient,
            AIDoveClient aiDoveClient,
            List<FactCheckSource> factCheckSources,
            TrustScoreConfig trustScoreConfig,
            AdvancedIntentAnalyzer advancedIntentAnalyzer,
            RRFEvidenceFusionService rrfFusionService) {
        this.webClient = webClient;
        this.objectMapper = objectMapper;
        this.perplexityClient = perplexityClient;
        this.openAICompatibleClient = openAICompatibleClient;
        this.aiDoveClient = aiDoveClient;
        this.factCheckSources = factCheckSources;
        this.trustScoreConfig = trustScoreConfig;
        this.advancedIntentAnalyzer = advancedIntentAnalyzer;
        this.rrfFusionService = rrfFusionService;
        
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
     * evidence.excerpt 와의 향상된 유사도를 이용해 의미 있는 근거만 남긴다.
     * 
     * 개선사항:
     * - 더 낮은 임계값으로 더 많은 근거 수집
     * - 학술 소스에 대해서는 더 관대한 필터링
     * - 키워드 매칭 기반의 추가 필터링
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

        // 주장에서 핵심 키워드 추출
        List<String> claimKeywords = extractKeywords(combinedClaims);

        List<SourceEvidence> filtered = new ArrayList<>();
        for (SourceEvidence evidence : allEvidence) {
            if (evidence == null || evidence.getExcerpt() == null || evidence.getExcerpt().isBlank()) {
                continue;
            }
            
            // 자카드 유사도 계산
            double sim = calculateSimilarity(combinedClaims, evidence.getExcerpt());
            
            // 키워드 매칭 점수 계산
            double keywordScore = calculateKeywordMatchScore(claimKeywords, evidence.getExcerpt());
            
            // 학술 소스는 더 관대하게 필터링 (학술 DB는 기본적으로 신뢰할 수 있음)
            double threshold = "academic".equals(evidence.getSourceType()) ? 0.05 : 0.08;
            
            // 유사도 또는 키워드 매칭 중 하나라도 임계값 이상이면 포함
            if (sim >= threshold || keywordScore >= 0.2) {
                // 종합 점수로 relevanceScore 업데이트
                double combinedScore = Math.max(sim, keywordScore);
                if (evidence.getRelevanceScore() == null || evidence.getRelevanceScore() < combinedScore) {
                    evidence.setRelevanceScore(combinedScore);
                }
                filtered.add(evidence);
            }
        }

        // 관련성 점수로 정렬
        filtered.sort((a, b) -> Double.compare(
                b.getRelevanceScore() != null ? b.getRelevanceScore() : 0,
                a.getRelevanceScore() != null ? a.getRelevanceScore() : 0
        ));

        // 상위 결과만 사용 (최대 60개)
        if (filtered.size() > 60) {
            return filtered.subList(0, 60);
        }
        return filtered;
    }
    
    /**
     * 키워드 매칭 점수 계산
     */
    private double calculateKeywordMatchScore(List<String> keywords, String text) {
        if (keywords == null || keywords.isEmpty() || text == null || text.isBlank()) {
            return 0.0;
        }
        
        String lowerText = text.toLowerCase();
        int matchCount = 0;
        
        for (String keyword : keywords) {
            if (lowerText.contains(keyword.toLowerCase())) {
                matchCount++;
            }
        }
        
        return (double) matchCount / keywords.size();
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
            // Run on bounded elastic scheduler to avoid blocking the reactive stream
            Mono.fromCallable(() -> fetchAllSourceEvidenceWithFallback(analyzedTopic, language))
                    .subscribeOn(Schedulers.boundedElastic())
                    .doOnNext(allEvidence -> {
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
                        final List<VerificationResult> verificationResults = new ArrayList<>();
                        final CredibilityAssessment[] credibilityHolder = new CredibilityAssessment[1];
                        
                        if (claims != null && !claims.isEmpty()) {
                            sink.next(DeepAnalysisEvent.builder()
                                    .eventType("status")
                                    .phase("verification")
                                    .message(claims.size() + "개의 주장을 검증하고 있습니다...")
                                    .build());
                            
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
                            credibilityHolder[0] = assessCredibility(verificationResults);
                            
                            sink.next(DeepAnalysisEvent.builder()
                                    .eventType("assessment")
                                    .phase("assessment")
                                    .message("신뢰도 평가 완료")
                                    .credibility(credibilityHolder[0])
                                    .build());
                        }

                        // 5. AI 기반 종합 분석 (Fallback Chain)
                        int evidenceCount = filteredEvidence.size();
                        
                        // 증거 수에 따른 경고 메시지 생성
                        String synthesisStatusMessage;
                        if (evidenceCount == 0) {
                            synthesisStatusMessage = "⚠️ 신뢰할 수 있는 출처에서 관련 정보를 찾지 못했습니다. 제한된 분석을 진행합니다...";
                            log.warn("No evidence found for topic: {}. AI may refuse to generate content.", topic);
                        } else if (evidenceCount < 3) {
                            synthesisStatusMessage = "⚠️ 수집된 정보가 제한적입니다 (" + evidenceCount + "개). 제한된 분석을 진행합니다...";
                            log.info("Limited evidence ({}) found for topic: {}", evidenceCount, topic);
                        } else {
                            synthesisStatusMessage = "AI가 수집된 " + evidenceCount + "개의 정보를 종합 분석하고 있습니다...";
                        }
                        
                        sink.next(DeepAnalysisEvent.builder()
                                .eventType("status")
                                .phase("synthesis")
                                .message(synthesisStatusMessage)
                                .build());

                        // Build provider chain and try each in sequence
                        String synthesisPrompt = buildSynthesisPrompt(topic, filteredEvidence, claims);
                        StringBuilder aiResponse = new StringBuilder();

                        // Try AI providers in order of preference
                        Flux<String> aiStream = getAiStreamWithFallback(synthesisPrompt);
                        
                        aiStream
                                .doOnNext(chunk -> {
                                    aiResponse.append(chunk);
                                    sink.next(DeepAnalysisEvent.builder()
                                            .eventType("ai_synthesis")
                                            .phase("synthesis")
                                            .message(chunk)
                                            .build());
                                })
                                .doOnComplete(() -> {
                                    String conclusion = aiResponse.toString();
                                    if (conclusion.isBlank()) {
                                        conclusion = buildFallbackConclusion(topic, verificationResults, credibilityHolder[0]);
                                    }
                                    sink.next(DeepAnalysisEvent.builder()
                                            .eventType("complete")
                                            .phase("complete")
                                            .message("심층 분석이 완료되었습니다.")
                                            .finalConclusion(conclusion)
                                            .build());
                                    sink.complete();
                                })
                                .doOnError(e -> {
                                    log.error("All AI providers failed: {}", e.getMessage());
                                    // Generate fallback conclusion without AI
                                    String fallbackConclusion = buildFallbackConclusion(topic, verificationResults, credibilityHolder[0]);
                                    sink.next(DeepAnalysisEvent.builder()
                                            .eventType("complete")
                                            .phase("complete")
                                            .message("분석이 완료되었습니다.")
                                            .finalConclusion(fallbackConclusion)
                                            .build());
                                    sink.complete();
                                })
                                .subscribe();
                    })
                    .doOnError(e -> {
                        log.error("Evidence collection failed: {}", e.getMessage());
                        sink.next(DeepAnalysisEvent.builder()
                                .eventType("error")
                                .phase("concepts")
                                .message("증거 수집 중 오류가 발생했습니다: " + e.getMessage())
                                .build());
                        sink.error(e);
                    })
                    .subscribe();
        });
    }

    /**
     * Get AI stream with fallback chain.
     * Tries providers in order: Perplexity -> OpenAI -> OpenRouter -> Azure -> AI Dove -> Ollama
     */
    private Flux<String> getAiStreamWithFallback(String prompt) {
        List<AiProviderAttempt> providers = buildAiProviderChain(prompt);
        
        if (providers.isEmpty()) {
            log.warn("No AI providers available, returning empty stream");
            return Flux.empty();
        }

        log.info("AI synthesis using fallback chain: {}", 
                providers.stream().map(AiProviderAttempt::name).toList());

        return tryAiProvidersInSequence(providers, 0);
    }

    /**
     * Build the AI provider chain based on availability
     */
    private List<AiProviderAttempt> buildAiProviderChain(String prompt) {
        List<AiProviderAttempt> chain = new ArrayList<>();

        // 1. Perplexity - Best for fact-checking with online search
        if (perplexityClient.isEnabled()) {
            chain.add(new AiProviderAttempt("Perplexity", () -> perplexityClient.streamCompletion(prompt)));
        }

        // 2. OpenAI
        if (openAICompatibleClient.isOpenAIEnabled()) {
            chain.add(new AiProviderAttempt("OpenAI", () -> openAICompatibleClient.streamFromOpenAI(prompt)));
        }

        // 3. OpenRouter - Access to multiple models
        if (openAICompatibleClient.isOpenRouterEnabled()) {
            chain.add(new AiProviderAttempt("OpenRouter", () -> openAICompatibleClient.streamFromOpenRouter(prompt)));
        }

        // 4. Azure OpenAI
        if (openAICompatibleClient.isAzureEnabled()) {
            chain.add(new AiProviderAttempt("Azure", () -> openAICompatibleClient.streamFromAzure(prompt)));
        }

        // 5. AI Dove (n8n webhook) - Simulated streaming
        if (aiDoveClient.isEnabled()) {
            chain.add(new AiProviderAttempt("AI Dove", () -> aiDoveClient.chatStream(prompt, null)));
        }

        // 6. Ollama - Local LLM (always in chain, may fail if not running)
        chain.add(new AiProviderAttempt("Ollama", () -> openAICompatibleClient.streamFromOllama(prompt)));

        // 7. Custom endpoint
        if (openAICompatibleClient.isCustomEnabled()) {
            chain.add(new AiProviderAttempt("Custom", () -> openAICompatibleClient.streamFromCustom(prompt)));
        }

        return chain;
    }

    /**
     * Try AI providers in sequence until one succeeds
     */
    private Flux<String> tryAiProvidersInSequence(List<AiProviderAttempt> providers, int index) {
        if (index >= providers.size()) {
            log.warn("All AI providers exhausted");
            return Flux.empty();
        }

        AiProviderAttempt current = providers.get(index);
        log.info("Trying AI provider: {} ({}/{})", current.name(), index + 1, providers.size());

        return current.streamSupplier().get()
                .timeout(Duration.ofSeconds(90))
                .onErrorResume(e -> {
                    log.warn("AI provider {} failed: {}. Trying next...", current.name(), e.getMessage());
                    return tryAiProvidersInSequence(providers, index + 1);
                })
                .switchIfEmpty(Flux.defer(() -> {
                    log.warn("AI provider {} returned empty. Trying next...", current.name());
                    return tryAiProvidersInSequence(providers, index + 1);
                }));
    }

    /**
     * Build a fallback conclusion when AI is not available
     */
    private String buildFallbackConclusion(String topic, List<VerificationResult> results, CredibilityAssessment credibility) {
        StringBuilder sb = new StringBuilder();
        sb.append("## ").append(topic).append(" 분석 결과\n\n");
        
        if (results == null || results.isEmpty()) {
            // 증거가 전혀 없는 경우 - 명확한 "정보 없음" 메시지
            sb.append("""
                ### ⚠️ 검색 결과 없음
                
                죄송합니다. 이 주제에 대해 신뢰할 수 있는 출처에서 관련 정보를 찾을 수 없었습니다.
                
                **가능한 이유:**
                - 해당 주제가 존재하지 않거나 잘못된 정보일 수 있습니다
                - 아직 널리 알려지지 않은 주제일 수 있습니다
                - 검색어를 다르게 입력해 보시기 바랍니다
                
                **주의**: 확인되지 않은 정보는 제공하지 않습니다.
                """);
        } else {
            sb.append("### 검증 결과 요약\n\n");
            int verified = 0, unverified = 0, contradicted = 0;
            for (VerificationResult r : results) {
                if (r.getStatus() == null) continue;
                switch (r.getStatus()) {
                    case VERIFIED, PARTIALLY_VERIFIED -> verified++;
                    case UNVERIFIED -> unverified++;
                    case DISPUTED, FALSE -> contradicted++;
                }
            }
            sb.append(String.format("- ✅ 검증됨: %d건\n", verified));
            sb.append(String.format("- ❓ 미확인: %d건\n", unverified));
            sb.append(String.format("- ❌ 반박됨: %d건\n\n", contradicted));
            
            // 미확인 비율이 높을 경우 경고
            int total = verified + unverified + contradicted;
            if (total > 0 && (double) unverified / total > 0.5) {
                sb.append("⚠️ **주의**: 대부분의 주장이 확인되지 않았습니다. 추가 검증이 필요합니다.\n\n");
            }
        }

        if (credibility != null) {
            sb.append("### 신뢰도 평가\n");
            sb.append(String.format("- 전체 신뢰도: %.0f%%\n", credibility.getOverallScore() * 100));
            sb.append(String.format("- 위험 수준: %s\n", credibility.getRiskLevel()));
            
            if (credibility.getWarnings() != null && !credibility.getWarnings().isEmpty()) {
                sb.append("\n### ⚠️ 주의사항\n");
                for (String warning : credibility.getWarnings()) {
                    sb.append("- ").append(warning).append("\n");
                }
            }
        }

        sb.append("\n---\n*이 결과는 수집된 정보에만 기반합니다. 추가 검증을 권장합니다.*");
        return sb.toString();
    }

    /**
     * AI provider attempt wrapper
     */
    private record AiProviderAttempt(
            String name,
            java.util.function.Supplier<Flux<String>> streamSupplier
    ) {}

    // ============================================
    // Enhanced Evidence Collection with Fallback
    // ============================================

    /**
     * RRF 기반 다중 쿼리 병렬 검색으로 근거 수집
     * 
     * 의도 분석을 통해 생성된 여러 검색 쿼리를 병렬로 실행하고,
     * RRF 알고리즘을 사용하여 결과를 융합합니다.
     */
    private List<SourceEvidence> fetchAllSourceEvidenceWithFallback(AnalyzedQuery analyzedQuery, String language) {
        List<SourceEvidence> allEvidence = new CopyOnWriteArrayList<>();
        
        // RRF 기반 다중 쿼리 병렬 검색 사용
        if (rrfEnabled && rrfFusionService != null) {
            try {
                log.info("Using RRF-based multi-query parallel search for: {}", analyzedQuery.getOriginalQuery());
                
                FusionResult fusionResult = rrfFusionService
                        .searchAndFuse(analyzedQuery.getOriginalQuery(), language)
                        .block(Duration.ofSeconds(timeoutSeconds * 2));
                
                if (fusionResult != null && fusionResult.getEvidences() != null) {
                    allEvidence.addAll(fusionResult.getEvidences());
                    log.info("RRF search completed: {} queries × {} sources → {} evidences (method: {})",
                            fusionResult.getQueryCount(),
                            fusionResult.getSourceCount(),
                            fusionResult.getEvidences().size(),
                            fusionResult.getFusionMethod());
                }
            } catch (Exception e) {
                log.warn("RRF search failed, falling back to sequential search: {}", e.getMessage());
                // RRF 실패 시 기존 방식으로 폴백
                allEvidence.addAll(fetchAllSourceEvidenceSequential(analyzedQuery, language));
            }
        } else {
            // RRF 비활성화 시 기존 방식 사용
            allEvidence.addAll(fetchAllSourceEvidenceSequential(analyzedQuery, language));
        }
        
        // Wikipedia 정보 추가 (항상 포함)
        List<SourceEvidence> wikiEvidence = fetchWikipediaInfo(analyzedQuery.getOriginalQuery());
        for (SourceEvidence wiki : wikiEvidence) {
            boolean isDuplicate = allEvidence.stream()
                    .anyMatch(e -> e.getUrl() != null && e.getUrl().equals(wiki.getUrl()));
            if (!isDuplicate) {
                allEvidence.add(wiki);
            }
        }
        
        log.info("Total evidence collected: {} items", allEvidence.size());
        return new ArrayList<>(allEvidence);
    }
    
    /**
     * 기존 순차적 폴백 검색 방식 (RRF 비활성화 시 또는 폴백용)
     */
    private List<SourceEvidence> fetchAllSourceEvidenceSequential(AnalyzedQuery analyzedQuery, String language) {
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
     * 실시간 데이터가 필요한 쿼리의 경우 RealtimeSearchSource와 뉴스를 우선 처리합니다.
     */
    private List<SourceEvidence> fetchAllSourceEvidence(String topic, String language) {
        List<SourceEvidence> allEvidence = new CopyOnWriteArrayList<>();
        
        // 0. 실시간 검색이 필요한지 판단하고 우선 처리
        boolean needsRealtime = isRealtimeDataRequired(topic);
        if (needsRealtime) {
            log.info("Topic '{}' requires realtime data, prioritizing realtime search and news", topic);
            
            // 실시간 검색 우선 처리
            List<SourceEvidence> realtimeEvidence = fetchRealtimeEvidence(topic, language);
            if (!realtimeEvidence.isEmpty()) {
                allEvidence.addAll(realtimeEvidence);
                log.info("Fetched {} realtime evidence items", realtimeEvidence.size());
            }
            
            // 뉴스 소스 우선 처리 (최신 정보)
            List<SourceEvidence> newsEvidence = fetchNewsEvidence(topic, language);
            if (!newsEvidence.isEmpty()) {
                allEvidence.addAll(newsEvidence);
                log.info("Fetched {} news evidence items", newsEvidence.size());
            }
        }
        
        // 1. Wikipedia 정보 수집 (실시간 데이터가 아닌 경우 우선, 실시간인 경우 나중에)
        if (!needsRealtime) {
            List<SourceEvidence> wikiEvidence = fetchWikipediaInfo(topic);
            allEvidence.addAll(wikiEvidence);
        }
        
        // 2. 추가 팩트체크 소스에서 병렬 수집 (실시간 소스와 뉴스 제외 - 이미 처리됨)
        if (factCheckSources != null && !factCheckSources.isEmpty()) {
            List<Mono<List<SourceEvidence>>> sourceFetches = factCheckSources.stream()
                    .filter(FactCheckSource::isAvailable)
                    .filter(source -> {
                        String sourceId = source.getSourceId();
                        // 실시간 데이터 필요 시 이미 처리한 소스 제외
                        if (needsRealtime && ("realtime_search".equals(sourceId) || "naver_news".equals(sourceId))) {
                            return false;
                        }
                        return true;
                    })
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
        
        // 3. Wikipedia 정보 추가 (실시간 데이터인 경우 마지막에 추가)
        if (needsRealtime) {
            List<SourceEvidence> wikiEvidence = fetchWikipediaInfo(topic);
            allEvidence.addAll(wikiEvidence);
        }
        
        log.info("Collected total {} evidence items for topic: {}", allEvidence.size(), topic);
        return new ArrayList<>(allEvidence);
    }
    
    /**
     * 실시간 데이터가 필요한 주제인지 판단
     * 
     * 기존 키워드 매칭의 한계를 극복하기 위해 AdvancedIntentAnalyzer의
     * 의미 기반 분석을 사용합니다. (LLM + 휴리스틱 + 의미 패턴)
     * 
     * 이를 통해:
     * - 새로운 암호화폐/자산 이름도 감지
     * - "X가 얼마야?" 같은 패턴 인식
     * - 문맥에서 시간 민감성 추론
     */
    private boolean isRealtimeDataRequired(String topic) {
        if (topic == null) return false;
        
        // AdvancedIntentAnalyzer의 의미 기반 분석 사용
        var realtimeAnalysis = advancedIntentAnalyzer.analyzeRealtimeDataNeed(topic);
        
        if (realtimeAnalysis.isNeedsRealtimeData()) {
            log.info("Realtime data required for '{}': type={}, confidence={}, reason={}",
                    topic, 
                    realtimeAnalysis.getDataType(),
                    String.format("%.2f", realtimeAnalysis.getConfidence()),
                    realtimeAnalysis.getReason());
            return true;
        }
        
        return false;
    }
    
    /**
     * 실시간 검색 소스에서 증거 수집
     */
    private List<SourceEvidence> fetchRealtimeEvidence(String topic, String language) {
        if (factCheckSources == null) return List.of();
        
        return factCheckSources.stream()
                .filter(source -> "realtime_search".equals(source.getSourceId()))
                .filter(FactCheckSource::isAvailable)
                .findFirst()
                .map(source -> {
                    try {
                        return source.fetchEvidence(topic, language)
                                .collectList()
                                .timeout(Duration.ofSeconds(timeoutSeconds))
                                .block();
                    } catch (Exception e) {
                        log.warn("Failed to fetch realtime evidence: {}", e.getMessage());
                        return List.<SourceEvidence>of();
                    }
                })
                .orElse(List.of());
    }
    
    /**
     * 뉴스 소스에서 증거 수집
     */
    private List<SourceEvidence> fetchNewsEvidence(String topic, String language) {
        if (factCheckSources == null) return List.of();
        
        return factCheckSources.stream()
                .filter(source -> "naver_news".equals(source.getSourceId()))
                .filter(FactCheckSource::isAvailable)
                .findFirst()
                .map(source -> {
                    try {
                        return source.fetchEvidence(topic, language)
                                .collectList()
                                .timeout(Duration.ofSeconds(timeoutSeconds))
                                .block();
                    } catch (Exception e) {
                        log.warn("Failed to fetch news evidence: {}", e.getMessage());
                        return List.<SourceEvidence>of();
                    }
                })
                .orElse(List.of());
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
        // 개선된 키워드 추출 - 명사 및 중요 단어 추출
        List<String> keywords = new ArrayList<>();
        String[] words = text.split("[\\s,\\.\\?!\\(\\)\\[\\]\"']+");
        
        for (String word : words) {
            String cleaned = word.trim().toLowerCase();
            // 최소 2글자 이상, 불용어 제외, 숫자만 있는 것 제외
            if (cleaned.length() >= 2 && !isStopWord(cleaned) && !cleaned.matches("^\\d+$")) {
                keywords.add(cleaned);
            }
        }
        
        // 중복 제거 및 우선순위 정렬 (긴 단어가 더 의미있을 가능성)
        return keywords.stream()
                .distinct()
                .sorted((a, b) -> Integer.compare(b.length(), a.length()))
                .limit(8)
                .toList();
    }

    private boolean isStopWord(String word) {
        return STOPWORDS.contains(word.toLowerCase());
    }
    
    // 확장된 불용어 목록
    private static final Set<String> STOPWORDS = Set.of(
            // 영어 불용어
            "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
            "have", "has", "had", "do", "does", "did", "will", "would", "could",
            "should", "may", "might", "must", "shall", "can", "need", "dare",
            "ought", "used", "to", "of", "in", "for", "on", "with", "at", "by",
            "from", "as", "into", "through", "during", "before", "after", "above",
            "below", "between", "under", "again", "further", "then", "once",
            "here", "there", "when", "where", "why", "how", "all", "each", "few",
            "more", "most", "other", "some", "such", "no", "nor", "not", "only",
            "own", "same", "so", "than", "too", "very", "just", "also", "now",
            "and", "but", "or", "if", "because", "until", "while", "about",
            "this", "that", "these", "those", "what", "which", "who", "whom",
            "it", "its", "they", "them", "their", "we", "us", "our", "you", "your",
            "he", "him", "his", "she", "her", "i", "me", "my",
            // 한국어 불용어
            "이", "그", "저", "는", "은", "가", "를", "을", "에", "의", "와", "과",
            "도", "만", "로", "으로", "에서", "까지", "부터", "에게", "한테",
            "것", "수", "등", "들", "및", "더", "덜", "뭐", "어디", "언제",
            "어떻게", "왜", "누구", "있다", "없다", "하다", "되다", "이다",
            "그리고", "그러나", "하지만", "그래서", "때문에", "대해", "대한",
            "관련", "관한", "통해", "위해", "따라", "인해", "있는", "없는",
            "하는", "되는", "아주", "매우", "정말", "너무", "조금", "약간",
            "진짜", "가짜", "사실", "인가요", "인가", "입니까", "일까", "나요"
    );

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
        
        // 강력한 할루시네이션 방지 지침
        prompt.append("""
                당신은 팩트체커이자 심층 분석 전문가입니다.
                
                ## ⚠️ 절대 규칙 (반드시 준수)
                1. **아래 '수집된 정보' 섹션에 있는 내용만 사용하세요**
                2. **수집된 정보에 없는 내용은 절대 만들어내지 마세요 (할루시네이션 금지)**
                3. **정보가 부족하면 "관련 정보를 찾을 수 없습니다"라고 명확히 말하세요**
                4. **각 사실에는 반드시 출처를 [출처명] 형식으로 표기하세요**
                5. **수집된 정보에 없는 통계, 날짜, 수치, 순위 등을 절대 만들어내지 마세요**
                6. **존재하지 않는 출처나 URL을 만들어내지 마세요**
                7. **불확실한 정보는 "~로 추정됩니다", "~일 가능성이 있습니다"로 표현하세요**
                
                """);
        
        prompt.append("## 분석 주제\n").append(topic).append("\n\n");
        
        // 통화/단위 맥락 분석
        String currencyHint = buildCurrencyHint(topic);
        if (!currencyHint.isEmpty()) {
            prompt.append(currencyHint).append("\n");
        }

        // 수집된 증거 수에 따른 분기
        int evidenceCount = (evidence != null) ? evidence.size() : 0;
        
        if (evidenceCount == 0) {
            // 증거가 전혀 없는 경우 - 분석 거부 지시
            prompt.append("""
                ## ⚠️ 주의: 수집된 정보 없음
                신뢰할 수 있는 출처에서 이 주제에 관한 정보를 찾지 못했습니다.
                
                **이 경우 반드시 다음과 같이만 응답하세요:**
                
                ---
                ## 검색 결과
                
                죄송합니다. **"[주제]"**에 대해 신뢰할 수 있는 출처에서 관련 정보를 찾을 수 없었습니다.
                
                가능한 이유:
                - 해당 주제가 존재하지 않거나 잘못된 정보일 수 있습니다
                - 아직 널리 알려지지 않은 주제일 수 있습니다
                - 검색어를 다르게 입력해 보시기 바랍니다
                
                **주의**: 확인되지 않은 정보를 제공하지 않습니다.
                ---
                
                위 형식 외의 다른 내용을 생성하지 마세요.
                """);
        } else if (evidenceCount < 3) {
            // 증거가 부족한 경우 - 제한적 분석 지시
            prompt.append("## ⚠️ 주의: 수집된 정보 부족 (").append(evidenceCount).append("개)\n");
            prompt.append("정보가 매우 제한적이므로, **반드시 수집된 정보의 범위 내에서만** 답변하세요.\n");
            prompt.append("정보가 부족하다는 점을 응답 시작 부분에 명확히 밝히세요.\n\n");
            
            prompt.append("## 수집된 정보 (").append(evidenceCount).append("개):\n");
            for (SourceEvidence e : evidence) {
                String url = (e.getUrl() != null && !e.getUrl().isBlank()) ? " - " + e.getUrl() : "";
                prompt.append("- [").append(e.getSourceName()).append("]").append(url).append("\n");
                prompt.append("  내용: ").append(truncateContent(e.getExcerpt(), 500)).append("\n\n");
            }
        } else {
            // 충분한 증거가 있는 경우
            prompt.append("## 수집된 정보 (").append(evidenceCount).append("개):\n\n");
            
            // 실시간 검색 결과를 먼저 표시 (우선순위 높음)
            boolean hasRealtimeData = false;
            for (SourceEvidence e : evidence) {
                if ("realtime_search".equals(e.getSourceType()) || 
                    "realtime_search_citation".equals(e.getSourceType())) {
                    if (!hasRealtimeData) {
                        prompt.append("### 🔴 실시간 검색 결과 (최신 데이터 - 우선 참고)\n");
                        hasRealtimeData = true;
                    }
                    String url = (e.getUrl() != null && !e.getUrl().isBlank()) ? " - " + e.getUrl() : "";
                    prompt.append("- [").append(e.getSourceName()).append("]").append(url).append("\n");
                    prompt.append("  내용: ").append(truncateContent(e.getExcerpt(), 600)).append("\n\n");
                }
            }
            if (hasRealtimeData) {
                prompt.append("⚠️ **위 실시간 검색 결과의 가격/시세 데이터를 최우선으로 사용하세요.**\n\n");
            }
            
            // 나머지 증거 표시
            prompt.append("### 참고 자료\n");
            for (SourceEvidence e : evidence) {
                if (!"realtime_search".equals(e.getSourceType()) && 
                    !"realtime_search_citation".equals(e.getSourceType())) {
                    String url = (e.getUrl() != null && !e.getUrl().isBlank()) ? " - " + e.getUrl() : "";
                    prompt.append("- [").append(e.getSourceName()).append("]").append(url).append("\n");
                    prompt.append("  내용: ").append(truncateContent(e.getExcerpt(), 500)).append("\n\n");
                }
            }
        }

        if (claims != null && !claims.isEmpty()) {
            prompt.append("## 검증이 필요한 주장들:\n");
            for (String claim : claims) {
                prompt.append("- ").append(claim).append("\n");
            }
            prompt.append("\n");
        }

        // 증거가 충분할 때만 상세 분석 요청
        if (evidenceCount >= 3) {
            prompt.append("""
                ## 응답 형식
                위 **수집된 정보만을** 바탕으로 다음을 제공해주세요:
                
                ### 📋 사실 확인 결과
                각 주장에 대해 수집된 정보에서 확인 가능한 내용만 제시
                - ✅ 확인됨: 수집된 정보에서 직접 확인된 사실
                - ⚠️ 부분 확인: 일부만 확인되거나 추가 검증 필요
                - ❓ 확인 불가: 수집된 정보에서 확인할 수 없음
                
                ### 📚 배경 지식
                수집된 정보에서 추출한 맥락과 배경 (출처 명시 필수)
                
                ### 🔍 다양한 관점
                수집된 정보에서 발견된 서로 다른 시각 (있는 경우만)
                
                ### 📌 결론
                수집된 정보 기반의 객관적 종합 판단
                - 정보가 부족한 부분은 "추가 확인 필요"라고 명시
                
                ### ⚠️ 주의사항
                - 이 분석은 수집된 정보에 기반합니다
                - 수집되지 않은 최신 정보가 있을 수 있습니다
                
                한국어로 답변해주세요.
                """);
        } else if (evidenceCount > 0) {
            // 증거가 적을 때는 간략한 분석만 요청
            prompt.append("""
                ## 응답 형식
                **수집된 정보가 제한적입니다.** 다음 형식으로 응답하세요:
                
                ### ⚠️ 정보 부족 안내
                이 주제에 대해 신뢰할 수 있는 출처에서 제한된 정보만 수집되었습니다.
                
                ### 📋 확인된 정보
                수집된 정보에서 확인 가능한 내용만 간략히 제시 (출처 명시 필수)
                
                ### ❓ 확인 불가 사항
                현재 수집된 정보로는 확인할 수 없는 내용 목록
                
                **중요**: 수집된 정보에 없는 내용은 절대 추가하지 마세요.
                
                한국어로 답변해주세요.
                """);
        }

        return prompt.toString();
    }
    
    /**
     * 토픽에서 통화/단위 맥락을 분석하여 힌트 생성
     */
    private String buildCurrencyHint(String topic) {
        if (topic == null) return "";
        
        // 한국어 숫자 단위 + 가격 관련 키워드 감지
        boolean hasKoreanNumber = topic.matches(".*\\d+\\s*(억|만|조|천).*");
        boolean hasPriceKeyword = topic.matches(".*(가격|price|도달|목표|전망|예측).*");
        boolean hasExplicitCurrency = topic.matches(".*\\$|USD|달러|₩|KRW|원화.*");
        
        if (hasKoreanNumber && hasPriceKeyword && !hasExplicitCurrency) {
            return """
                ## 통화 단위 주의
                - 이 주제에 한국어 숫자 단위가 포함되어 있습니다
                - 단위가 명시되지 않은 금액은 **한국 원화(KRW)**일 가능성을 고려하세요
                - 예: "10억" = 10억 원 ≈ $670,000 USD
                - 가능하면 원화와 달러 양쪽 기준을 모두 분석해주세요
                """;
        }
        return "";
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
