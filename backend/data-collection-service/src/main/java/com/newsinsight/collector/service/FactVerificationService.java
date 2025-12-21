package com.newsinsight.collector.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.client.PerplexityClient;
import com.newsinsight.collector.client.OpenAICompatibleClient;
import com.newsinsight.collector.client.AIDoveClient;
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
    private final OpenAICompatibleClient openAICompatibleClient;
    private final AIDoveClient aiDoveClient;
    private final List<FactCheckSource> factCheckSources;
    private final TrustScoreConfig trustScoreConfig;
    private final List<TrustedSource> trustedSources;
    private final AdvancedIntentAnalyzer advancedIntentAnalyzer;

    public FactVerificationService(
            WebClient webClient,
            ObjectMapper objectMapper,
            PerplexityClient perplexityClient,
            OpenAICompatibleClient openAICompatibleClient,
            AIDoveClient aiDoveClient,
            List<FactCheckSource> factCheckSources,
            TrustScoreConfig trustScoreConfig,
            AdvancedIntentAnalyzer advancedIntentAnalyzer) {
        this.webClient = webClient;
        this.objectMapper = objectMapper;
        this.perplexityClient = perplexityClient;
        this.openAICompatibleClient = openAICompatibleClient;
        this.aiDoveClient = aiDoveClient;
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
            prompt.append("## 수집된 정보 (").append(evidenceCount).append("개):\n");
            for (SourceEvidence e : evidence) {
                String url = (e.getUrl() != null && !e.getUrl().isBlank()) ? " - " + e.getUrl() : "";
                prompt.append("- [").append(e.getSourceName()).append("]").append(url).append("\n");
                prompt.append("  내용: ").append(truncateContent(e.getExcerpt(), 500)).append("\n\n");
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
