package com.newsinsight.collector.service.search;

import com.newsinsight.collector.service.search.HybridRankingService.QueryIntent;
import com.newsinsight.collector.service.search.HybridRankingService.QueryIntent.IntentType;
import com.newsinsight.collector.service.search.LlmIntentAnalyzer.IntentAnalysisResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.*;
import java.util.regex.Pattern;

/**
 * 쿼리 의도 분석 서비스.
 * 
 * 사용자 쿼리를 분석하여 검색 의도를 파악하고,
 * 하이브리드 검색의 가중치 조정에 활용합니다.
 * 
 * 지원 의도:
 * - FACT_CHECK: 팩트체크/검증 ("사실인가", "진짜", "팩트체크")
 * - LATEST_NEWS: 최신 뉴스 ("오늘", "최근", "속보")
 * - DEEP_ANALYSIS: 심층 분석 ("분석", "원인", "배경")
 * - OPINION_SEARCH: 여론 검색 ("여론", "반응", "논란")
 * - GENERAL: 일반 검색
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class QueryIntentAnalyzer {

    private final LlmIntentAnalyzer llmIntentAnalyzer;

    @Value("${collector.intent-analysis.use-llm:true}")
    private boolean useLlm;

    @Value("${collector.intent-analysis.llm-timeout-seconds:10}")
    private int llmTimeoutSeconds;

    // 의도별 키워드 패턴 (폴백용 - LLM 실패 시 사용)
    private static final Map<IntentType, List<String>> INTENT_KEYWORDS = Map.of(
            IntentType.FACT_CHECK, List.of(
                    "사실", "진짜", "가짜", "팩트체크", "팩트 체크", "검증",
                    "진위", "확인", "루머", "허위", "오보", "실제로",
                    "정말", "맞는", "틀린", "fact", "check", "verify"
            ),
            IntentType.LATEST_NEWS, List.of(
                    "오늘", "최근", "속보", "긴급", "방금", "지금",
                    "현재", "실시간", "최신", "breaking", "today",
                    "어제", "이번주", "금일"
            ),
            IntentType.DEEP_ANALYSIS, List.of(
                    "분석", "원인", "배경", "이유", "왜", "어떻게",
                    "영향", "전망", "예측", "해설", "설명", "의미",
                    "history", "analysis", "impact", "결과"
            ),
            IntentType.OPINION_SEARCH, List.of(
                    "여론", "반응", "논란", "비판", "지지", "반대",
                    "찬성", "의견", "댓글", "네티즌", "SNS", "트위터",
                    "opinion", "reaction", "controversy"
            )
    );

    // 질문 패턴
    private static final Pattern QUESTION_PATTERN = Pattern.compile(
            "(\\?|인가요|인가|입니까|일까|일까요|나요|습니까|은가요|는가요|맞나요|아닌가요)$"
    );

    // 시간 표현 패턴
    private static final Pattern TIME_PATTERN = Pattern.compile(
            "(오늘|어제|이번주|지난주|최근|\\d+일|\\d+시간|\\d+분)"
    );

    /**
     * 쿼리를 분석하여 의도를 파악합니다.
     * LLM 기반 분석을 우선 시도하고, 실패 시 규칙 기반 분석으로 폴백합니다.
     *
     * @param query 사용자 쿼리
     * @return 분석된 쿼리 의도
     */
    public QueryIntent analyzeIntent(String query) {
        if (query == null || query.isBlank()) {
            return QueryIntent.builder()
                    .type(IntentType.GENERAL)
                    .confidence(1.0)
                    .keywords(List.of())
                    .build();
        }

        // LLM 기반 분석 시도
        if (useLlm && llmIntentAnalyzer != null && llmIntentAnalyzer.isEnabled()) {
            try {
                IntentAnalysisResult llmResult = llmIntentAnalyzer
                        .analyzeIntent(query)
                        .block(Duration.ofSeconds(llmTimeoutSeconds));
                
                if (llmResult != null && llmResult.getConfidence() >= 0.5) {
                    QueryIntent intent = llmIntentAnalyzer.convertToQueryIntent(llmResult);
                    log.info("LLM intent analysis succeeded: query='{}', type={}, confidence={:.2f}", 
                            query, intent.getType(), intent.getConfidence());
                    return intent;
                } else if (llmResult != null) {
                    log.debug("LLM confidence too low ({:.2f}), using rule-based fallback", 
                            llmResult.getConfidence());
                }
            } catch (Exception e) {
                log.warn("LLM intent analysis failed for '{}', using rule-based fallback: {}", 
                        query, e.getMessage());
            }
        }

        // 폴백: 규칙 기반 분석
        return analyzeIntentRuleBased(query);
    }

    /**
     * 규칙 기반 의도 분석 (폴백용)
     * 
     * @param query 사용자 쿼리
     * @return 분석된 쿼리 의도
     */
    private QueryIntent analyzeIntentRuleBased(String query) {
        String normalizedQuery = query.toLowerCase().trim();
        
        // 각 의도 유형별 점수 계산
        Map<IntentType, Double> scores = new EnumMap<>(IntentType.class);
        for (IntentType type : IntentType.values()) {
            scores.put(type, 0.0);
        }

        // 키워드 매칭 점수
        List<String> matchedKeywords = new ArrayList<>();
        for (Map.Entry<IntentType, List<String>> entry : INTENT_KEYWORDS.entrySet()) {
            IntentType type = entry.getKey();
            for (String keyword : entry.getValue()) {
                if (normalizedQuery.contains(keyword.toLowerCase())) {
                    scores.merge(type, 1.0, Double::sum);
                    matchedKeywords.add(keyword);
                }
            }
        }

        // 질문 형태 분석 - 팩트체크 의도 가능성 증가
        if (QUESTION_PATTERN.matcher(normalizedQuery).find()) {
            scores.merge(IntentType.FACT_CHECK, 0.5, Double::sum);
        }

        // 시간 표현 분석 - 최신 뉴스 의도 가능성 증가
        if (TIME_PATTERN.matcher(normalizedQuery).find()) {
            scores.merge(IntentType.LATEST_NEWS, 0.5, Double::sum);
        }

        // 최고 점수 의도 선택
        IntentType bestIntent = IntentType.GENERAL;
        double maxScore = 0.0;
        for (Map.Entry<IntentType, Double> entry : scores.entrySet()) {
            if (entry.getValue() > maxScore) {
                maxScore = entry.getValue();
                bestIntent = entry.getKey();
            }
        }

        // 신뢰도 계산 (0~1)
        double confidence = calculateConfidence(maxScore, scores);

        // 최소 점수 미달 시 일반 검색으로
        if (maxScore < 0.5) {
            bestIntent = IntentType.GENERAL;
            confidence = 1.0 - (maxScore * 0.5);
        }

        // 시간 범위 추출
        String timeRange = extractTimeRange(normalizedQuery);

        // 핵심 키워드 추출
        List<String> keywords = extractKeywords(query);

        QueryIntent intent = QueryIntent.builder()
                .type(bestIntent)
                .confidence(confidence)
                .keywords(keywords)
                .timeRange(timeRange)
                .build();

        log.debug("Rule-based intent analysis: query='{}', type={}, confidence={}, keywords={}", 
                query, bestIntent, String.format("%.2f", confidence), keywords);

        return intent;
    }

    /**
     * 신뢰도를 계산합니다.
     */
    private double calculateConfidence(double maxScore, Map<IntentType, Double> scores) {
        if (maxScore == 0) return 0.5;

        // 최고 점수와 다른 점수들의 차이로 신뢰도 계산
        double totalScore = scores.values().stream().mapToDouble(Double::doubleValue).sum();
        if (totalScore == 0) return 0.5;

        double confidence = maxScore / totalScore;
        return Math.min(1.0, Math.max(0.5, confidence));
    }

    /**
     * 시간 범위를 추출합니다.
     */
    private String extractTimeRange(String query) {
        if (query.contains("오늘") || query.contains("금일")) {
            return "1d";
        } else if (query.contains("어제")) {
            return "2d";
        } else if (query.contains("이번주") || query.contains("최근")) {
            return "7d";
        } else if (query.contains("지난주")) {
            return "14d";
        } else if (query.contains("이번달") || query.contains("한달")) {
            return "30d";
        }
        return null; // 기본값 사용
    }

    /**
     * 쿼리에서 핵심 키워드를 추출합니다.
     */
    private List<String> extractKeywords(String query) {
        // 불용어 목록
        Set<String> stopwords = Set.of(
                "은", "는", "이", "가", "을", "를", "의", "에", "와", "과",
                "로", "으로", "에서", "부터", "까지", "도", "만", "뿐",
                "대해", "대한", "관련", "관한", "에게", "한테",
                "그", "저", "이것", "그것", "저것",
                "어떤", "무슨", "어느", "무엇", "뭐",
                "the", "a", "an", "is", "are", "was", "were", "be",
                "to", "of", "in", "for", "on", "with", "at", "by"
        );

        // 의도 키워드 제외
        Set<String> intentKeywords = new HashSet<>();
        INTENT_KEYWORDS.values().forEach(intentKeywords::addAll);

        // 키워드 추출
        String[] tokens = query.toLowerCase()
                .replaceAll("[^가-힣a-z0-9\\s]", " ")
                .split("\\s+");

        List<String> keywords = new ArrayList<>();
        for (String token : tokens) {
            if (token.length() >= 2 
                    && !stopwords.contains(token)
                    && !intentKeywords.contains(token)) {
                keywords.add(token);
            }
        }

        // 최대 5개 키워드
        return keywords.size() > 5 ? keywords.subList(0, 5) : keywords;
    }

    /**
     * 의도에 대한 설명을 반환합니다.
     */
    public String getIntentDescription(IntentType type) {
        return switch (type) {
            case FACT_CHECK -> "팩트체크 - 정보의 진위 여부를 검증합니다";
            case LATEST_NEWS -> "최신 뉴스 - 가장 최근 소식을 우선합니다";
            case DEEP_ANALYSIS -> "심층 분석 - 배경과 맥락을 포함한 분석을 제공합니다";
            case OPINION_SEARCH -> "여론 검색 - 다양한 의견과 반응을 수집합니다";
            case GENERAL -> "일반 검색 - 관련성 높은 정보를 제공합니다";
        };
    }
}
