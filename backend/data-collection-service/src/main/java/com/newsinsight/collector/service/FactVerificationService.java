package com.newsinsight.collector.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.client.PerplexityClient;
import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
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
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 심층 분석 신뢰성 검증 서비스
 * 
 * Wikipedia, 학술DB 등 신뢰할 수 있는 출처와 대조하여
 * 주장의 타당성을 검증합니다.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class FactVerificationService {

    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    private final PerplexityClient perplexityClient;

    @Value("${collector.crawler.base-url:http://web-crawler:11235}")
    private String crawlerBaseUrl;

    @Value("${collector.fact-check.timeout-seconds:30}")
    private int timeoutSeconds;

    // 신뢰할 수 있는 출처 목록
    private static final List<TrustedSource> TRUSTED_SOURCES = List.of(
            new TrustedSource("wikipedia", "위키백과", "https://ko.wikipedia.org/wiki/", 0.9),
            new TrustedSource("wikipedia_en", "Wikipedia", "https://en.wikipedia.org/wiki/", 0.9),
            new TrustedSource("britannica", "브리태니커", "https://www.britannica.com/search?query=", 0.95),
            new TrustedSource("namu", "나무위키", "https://namu.wiki/w/", 0.6),
            new TrustedSource("kosis", "통계청", "https://kosis.kr/search/search.do?query=", 0.95),
            new TrustedSource("scholar", "학술 자료", "https://scholar.google.com/scholar?q=", 0.85)
    );

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
     * 주어진 주제에 대해 심층 분석 및 검증 수행
     */
    public Flux<DeepAnalysisEvent> analyzeAndVerify(String topic, List<String> claims) {
        log.info("Starting deep analysis and verification for topic: {}", topic);

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

            // 병렬로 Wikipedia 등에서 관련 정보 수집
            List<SourceEvidence> wikiEvidence = fetchWikipediaInfo(topic);
            
            if (!wikiEvidence.isEmpty()) {
                sink.next(DeepAnalysisEvent.builder()
                        .eventType("evidence")
                        .phase("concepts")
                        .message("신뢰할 수 있는 출처에서 " + wikiEvidence.size() + "개의 정보를 수집했습니다.")
                        .evidence(wikiEvidence)
                        .build());
            }

            // 3. 각 주장에 대한 검증
            if (claims != null && !claims.isEmpty()) {
                sink.next(DeepAnalysisEvent.builder()
                        .eventType("status")
                        .phase("verification")
                        .message(claims.size() + "개의 주장을 검증하고 있습니다...")
                        .build());

                List<VerificationResult> verificationResults = new ArrayList<>();
                
                for (int i = 0; i < claims.size(); i++) {
                    String claim = claims.get(i);
                    VerificationResult result = verifyClaim(claim, wikiEvidence);
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
                String synthesisPrompt = buildSynthesisPrompt(topic, wikiEvidence, claims);
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
    // Wikipedia & Trusted Source Fetching
    // ============================================

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
