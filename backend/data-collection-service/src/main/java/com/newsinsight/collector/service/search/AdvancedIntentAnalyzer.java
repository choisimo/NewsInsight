package com.newsinsight.collector.service.search;

import com.newsinsight.collector.client.AIDoveClient;
import com.newsinsight.collector.service.search.HybridRankingService.QueryIntent;
import com.newsinsight.collector.service.search.HybridRankingService.QueryIntent.IntentType;
import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * 고급 의도 분석 서비스
 * 
 * 사용자 쿼리에서 키워드 추출, 문맥 분석, 쿼리 확장, 폴백 전략 생성을 수행하여
 * 검색 결과의 품질과 적중률을 보장합니다.
 * 
 * 주요 기능:
 * 1. 한국어/영어 키워드 추출
 * 2. 의도 유형 분석 (팩트체크, 최신뉴스, 심층분석 등)
 * 3. 쿼리 확장 및 변형 생성
 * 4. 폴백 검색 전략 생성
 * 5. 결과 보장 로직
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AdvancedIntentAnalyzer {

    private final AIDoveClient aiDoveClient;
    
    // LLM 분석 결과 캐시 (메모리 절약을 위해 최대 1000개, 5분 TTL 개념으로 관리)
    private final Map<String, RealtimeAnalysisResult> realtimeAnalysisCache = new ConcurrentHashMap<>();
    private static final int MAX_CACHE_SIZE = 1000;

    // ============================================
    // 상수 및 패턴 정의
    // ============================================

    // 한국어 불용어
    private static final Set<String> KOREAN_STOPWORDS = Set.of(
            "은", "는", "이", "가", "을", "를", "의", "에", "에서", "로", "으로",
            "와", "과", "도", "만", "부터", "까지", "에게", "한테", "께",
            "이다", "하다", "있다", "없다", "되다", "않다",
            "그", "저", "이것", "그것", "저것", "여기", "거기", "저기",
            "뭐", "어디", "언제", "어떻게", "왜", "누구",
            "아주", "매우", "정말", "너무", "조금", "약간",
            "그리고", "그러나", "하지만", "그래서", "때문에",
            "것", "수", "등", "들", "및", "더", "덜",
            "대해", "대한", "관련", "관한"
    );

    // 영어 불용어
    private static final Set<String> ENGLISH_STOPWORDS = Set.of(
            "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
            "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
            "being", "have", "has", "had", "do", "does", "did", "will", "would",
            "could", "should", "may", "might", "must", "shall", "can",
            "this", "that", "these", "those", "it", "its",
            "i", "you", "he", "she", "we", "they", "me", "him", "her", "us", "them",
            "what", "which", "who", "whom", "where", "when", "why", "how",
            "all", "each", "every", "both", "few", "more", "most", "other", "some",
            "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too",
            "very", "just", "also", "now", "here", "there", "then", "about"
    );

    // 의도별 키워드 패턴 (확장)
    private static final Map<IntentType, List<String>> INTENT_PATTERNS = Map.of(
            IntentType.FACT_CHECK, List.of(
                    "사실", "진짜", "가짜", "팩트체크", "팩트 체크", "검증",
                    "진위", "확인", "루머", "허위", "오보", "실제로",
                    "정말", "맞는", "틀린", "fact", "check", "verify",
                    "true", "false", "fake", "hoax", "myth", "믿을 수",
                    "신뢰", "거짓", "조작", "왜곡"
            ),
            IntentType.LATEST_NEWS, List.of(
                    "오늘", "최근", "속보", "긴급", "방금", "지금",
                    "현재", "실시간", "최신", "breaking", "today",
                    "어제", "이번주", "금일", "latest", "recent",
                    "새로운", "발표", "업데이트"
            ),
            IntentType.DEEP_ANALYSIS, List.of(
                    "분석", "원인", "배경", "이유", "왜", "어떻게",
                    "영향", "전망", "예측", "해설", "설명", "의미",
                    "history", "analysis", "impact", "결과", "심층",
                    "상세", "깊이", "인사이트", "근본", "핵심"
            ),
            IntentType.OPINION_SEARCH, List.of(
                    "여론", "반응", "논란", "비판", "지지", "반대",
                    "찬성", "의견", "댓글", "네티즌", "SNS", "트위터",
                    "opinion", "reaction", "controversy", "debate",
                    "토론", "갑론을박", "시각"
            )
    );

    // 질문 패턴
    private static final Pattern QUESTION_PATTERN = Pattern.compile(
            "(\\?|인가요|인가|입니까|일까|일까요|나요|습니까|은가요|는가요|맞나요|아닌가요|뭔가요|무엇|어떤)$"
    );

    // 비교 패턴
    private static final Pattern COMPARISON_PATTERN = Pattern.compile(
            "(vs|versus|비교|차이|다른|어느|어떤 것이|보다)"
    );

    // 시간 표현 패턴
    private static final Pattern TIME_PATTERN = Pattern.compile(
            "(오늘|어제|이번주|지난주|최근|\\d+일|\\d+시간|\\d+분|\\d{4}년)"
    );

    // 한글 패턴
    private static final Pattern KOREAN_PATTERN = Pattern.compile("[가-힣]");

    // ============================================
    // DTO 클래스
    // ============================================

    @Data
    @Builder
    public static class AnalyzedQuery {
        private String originalQuery;
        private List<String> keywords;
        private String primaryKeyword;
        private IntentType intentType;
        private double confidence;
        private String language;
        private List<String> expandedQueries;
        private List<FallbackStrategy> fallbackStrategies;
        private String timeRange;
        private Map<String, Object> metadata;
    }

    @Data
    @Builder
    public static class FallbackStrategy {
        private String strategyType;
        private String query;
        private int priority;
        private String description;
    }

    public enum StrategyType {
        FULL_QUERY,
        KEYWORDS_AND,
        KEYWORDS_OR,
        PRIMARY_KEYWORD,
        SEMANTIC_VARIANT,
        RELATED_TOPIC,
        PARTIAL_MATCH,
        SYNONYM_SEARCH
    }

    /**
     * 실시간 데이터 필요성 분석 결과
     */
    @Data
    @Builder
    public static class RealtimeAnalysisResult {
        private boolean needsRealtimeData;
        private String dataType;          // price, statistics, news, event, weather 등
        private String reason;            // 판단 이유
        private double confidence;        // 0.0 ~ 1.0
        private List<String> entities;    // 관련 엔티티 (비트코인, 삼성전자 등)
        private long timestamp;           // 분석 시점
    }

    // ============================================
    // 메인 분석 메서드
    // ============================================

    /**
     * 쿼리를 종합적으로 분석합니다.
     *
     * @param query 사용자 쿼리
     * @return 분석된 쿼리 정보
     */
    public AnalyzedQuery analyzeQuery(String query) {
        if (query == null || query.isBlank()) {
            return buildEmptyResult();
        }

        String normalizedQuery = query.trim();
        
        // 1. 언어 감지
        String language = detectLanguage(normalizedQuery);
        
        // 2. 키워드 추출
        List<String> keywords = extractKeywords(normalizedQuery, language);
        
        // 3. 주요 키워드 식별
        String primaryKeyword = identifyPrimaryKeyword(keywords, normalizedQuery);
        
        // 4. 의도 분석
        IntentType intentType = detectIntentType(normalizedQuery);
        double confidence = calculateConfidence(normalizedQuery, intentType);
        
        // 5. 시간 범위 추출
        String timeRange = extractTimeRange(normalizedQuery);
        
        // 6. 쿼리 확장
        List<String> expandedQueries = generateExpandedQueries(keywords, primaryKeyword, normalizedQuery, language);
        
        // 7. 폴백 전략 생성
        List<FallbackStrategy> fallbackStrategies = generateFallbackStrategies(
                normalizedQuery, keywords, primaryKeyword, expandedQueries, language
        );

        AnalyzedQuery result = AnalyzedQuery.builder()
                .originalQuery(normalizedQuery)
                .keywords(keywords)
                .primaryKeyword(primaryKeyword)
                .intentType(intentType)
                .confidence(confidence)
                .language(language)
                .expandedQueries(expandedQueries)
                .fallbackStrategies(fallbackStrategies)
                .timeRange(timeRange)
                .metadata(Map.of(
                        "keywordCount", keywords.size(),
                        "strategyCount", fallbackStrategies.size(),
                        "isQuestion", QUESTION_PATTERN.matcher(normalizedQuery).find(),
                        "isComparison", COMPARISON_PATTERN.matcher(normalizedQuery.toLowerCase()).find()
                ))
                .build();

        log.info("Query analyzed: keywords={}, primary='{}', intent={}, confidence={}, strategies={}",
                keywords.size(), primaryKeyword, intentType, String.format("%.2f", confidence), fallbackStrategies.size());

        return result;
    }

    /**
     * 기존 QueryIntent 형태로 변환합니다 (호환성 유지).
     */
    public QueryIntent toQueryIntent(AnalyzedQuery analyzed) {
        return QueryIntent.builder()
                .type(analyzed.getIntentType())
                .keywords(analyzed.getKeywords())
                .timeRange(analyzed.getTimeRange())
                .confidence(analyzed.getConfidence())
                .build();
    }

    // ============================================
    // 언어 감지
    // ============================================

    private String detectLanguage(String text) {
        if (text == null || text.isEmpty()) return "ko";
        
        int koreanCount = 0;
        int englishCount = 0;
        
        for (char c : text.toCharArray()) {
            if (c >= '가' && c <= '힣') {
                koreanCount++;
            } else if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
                englishCount++;
            }
        }
        
        int total = koreanCount + englishCount;
        if (total == 0) return "ko";
        
        return (double) koreanCount / total > 0.3 ? "ko" : "en";
    }

    // ============================================
    // 키워드 추출
    // ============================================

    private List<String> extractKeywords(String text, String language) {
        Set<String> stopwords = "ko".equals(language) ? KOREAN_STOPWORDS : ENGLISH_STOPWORDS;
        
        // 토큰화
        String[] tokens = text.toLowerCase()
                .replaceAll("[^가-힣a-zA-Z0-9\\s]", " ")
                .split("\\s+");
        
        List<String> keywords = new ArrayList<>();
        
        for (String token : tokens) {
            String trimmed = token.trim();
            
            // 불용어 제외
            if (stopwords.contains(trimmed)) continue;
            
            // 너무 짧은 토큰 제외 (한글은 1자도 의미있을 수 있음)
            if ("ko".equals(language) && trimmed.length() < 1) continue;
            if ("en".equals(language) && trimmed.length() < 2) continue;
            
            // 순수 숫자 제외
            if (trimmed.matches("\\d+")) continue;
            
            keywords.add(trimmed);
        }
        
        // 인용구 내 구문 추출
        Pattern quotedPattern = Pattern.compile("[\"']([^\"']+)[\"']");
        Matcher matcher = quotedPattern.matcher(text);
        while (matcher.find()) {
            String phrase = matcher.group(1).trim();
            if (!phrase.isEmpty() && !keywords.contains(phrase.toLowerCase())) {
                keywords.add(phrase.toLowerCase());
            }
        }
        
        // 복합명사 추출 (한국어)
        if ("ko".equals(language)) {
            Pattern compoundPattern = Pattern.compile("[가-힣]+(?:기업|회사|뉴스|정보|서비스|시스템|데이터|분석|결과|사건|사고|정책|발표)");
            Matcher compoundMatcher = compoundPattern.matcher(text);
            while (compoundMatcher.find()) {
                String compound = compoundMatcher.group().toLowerCase();
                if (!keywords.contains(compound)) {
                    keywords.add(compound);
                }
            }
        }
        
        // 중복 제거 및 최대 10개 제한
        return keywords.stream()
                .distinct()
                .limit(10)
                .collect(Collectors.toList());
    }

    // ============================================
    // 주요 키워드 식별
    // ============================================

    private String identifyPrimaryKeyword(List<String> keywords, String originalQuery) {
        if (keywords.isEmpty()) {
            String[] words = originalQuery.split("\\s+");
            return words.length > 0 ? words[0] : originalQuery;
        }
        
        // 점수 기반 주요 키워드 선정
        Map<String, Double> scores = new HashMap<>();
        
        for (String keyword : keywords) {
            double score = 0.0;
            
            // 길이 가중치 (더 긴 키워드가 더 구체적)
            score += Math.min(keyword.length() / 10.0, 1.0) * 0.3;
            
            // 위치 가중치 (앞에 있을수록 중요)
            int pos = originalQuery.toLowerCase().indexOf(keyword.toLowerCase());
            if (pos >= 0) {
                score += (1.0 - (double) pos / originalQuery.length()) * 0.3;
            }
            
            // 대문자 시작 (고유명사 가능성)
            if (Character.isUpperCase(keyword.charAt(0))) {
                score += 0.2;
            }
            
            // 숫자 포함 (구체적 식별자 가능성)
            if (keyword.matches(".*\\d+.*")) {
                score += 0.1;
            }
            
            // 복합어 (한국어)
            if (keyword.matches(".*[가-힣]+(기업|회사|사건|정책)$")) {
                score += 0.3;
            }
            
            scores.put(keyword, score);
        }
        
        return scores.entrySet().stream()
                .max(Map.Entry.comparingByValue())
                .map(Map.Entry::getKey)
                .orElse(keywords.get(0));
    }

    // ============================================
    // 의도 분석
    // ============================================

    private IntentType detectIntentType(String query) {
        String lowerQuery = query.toLowerCase();
        
        Map<IntentType, Double> scores = new EnumMap<>(IntentType.class);
        for (IntentType type : IntentType.values()) {
            scores.put(type, 0.0);
        }
        
        // 패턴 매칭
        for (Map.Entry<IntentType, List<String>> entry : INTENT_PATTERNS.entrySet()) {
            for (String pattern : entry.getValue()) {
                if (lowerQuery.contains(pattern.toLowerCase())) {
                    scores.merge(entry.getKey(), 1.0, Double::sum);
                }
            }
        }
        
        // 질문 형태 → 팩트체크 가능성
        if (QUESTION_PATTERN.matcher(lowerQuery).find()) {
            scores.merge(IntentType.FACT_CHECK, 0.5, Double::sum);
        }
        
        // 시간 표현 → 최신 뉴스 가능성
        if (TIME_PATTERN.matcher(lowerQuery).find()) {
            scores.merge(IntentType.LATEST_NEWS, 0.5, Double::sum);
        }
        
        // 비교 표현 → 심층 분석 가능성
        if (COMPARISON_PATTERN.matcher(lowerQuery).find()) {
            scores.merge(IntentType.DEEP_ANALYSIS, 0.3, Double::sum);
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
        
        // 최소 임계값
        if (maxScore < 0.5) {
            bestIntent = IntentType.GENERAL;
        }
        
        return bestIntent;
    }

    private double calculateConfidence(String query, IntentType intentType) {
        if (intentType == IntentType.GENERAL) {
            return 0.7;
        }
        
        String lowerQuery = query.toLowerCase();
        List<String> patterns = INTENT_PATTERNS.getOrDefault(intentType, List.of());
        
        long matchCount = patterns.stream()
                .filter(p -> lowerQuery.contains(p.toLowerCase()))
                .count();
        
        double baseConfidence = Math.min(0.5 + matchCount * 0.15, 0.95);
        
        // 질문 형태 보너스
        if (QUESTION_PATTERN.matcher(lowerQuery).find()) {
            baseConfidence = Math.min(baseConfidence + 0.1, 0.95);
        }
        
        return baseConfidence;
    }

    // ============================================
    // 시간 범위 추출
    // ============================================

    private String extractTimeRange(String query) {
        String lowerQuery = query.toLowerCase();
        
        if (lowerQuery.contains("오늘") || lowerQuery.contains("금일") || lowerQuery.contains("today")) {
            return "1d";
        } else if (lowerQuery.contains("어제") || lowerQuery.contains("yesterday")) {
            return "2d";
        } else if (lowerQuery.contains("이번주") || lowerQuery.contains("this week")) {
            return "7d";
        } else if (lowerQuery.contains("지난주") || lowerQuery.contains("last week")) {
            return "14d";
        } else if (lowerQuery.contains("최근") || lowerQuery.contains("recent")) {
            return "7d";
        } else if (lowerQuery.contains("이번달") || lowerQuery.contains("한달") || lowerQuery.contains("this month")) {
            return "30d";
        }
        
        return null;
    }

    // ============================================
    // 쿼리 확장
    // ============================================

    private List<String> generateExpandedQueries(
            List<String> keywords,
            String primaryKeyword,
            String originalQuery,
            String language) {
        
        List<String> variants = new ArrayList<>();
        
        // 1. 원본 쿼리
        variants.add(originalQuery);
        
        // 2. 키워드 조합
        if (keywords.size() > 1) {
            variants.add(String.join(" ", keywords));
        }
        
        // 3. 주요 키워드만
        variants.add(primaryKeyword);
        
        // 4. 상위 2-3개 키워드
        if (keywords.size() >= 2) {
            variants.add(keywords.get(0) + " " + keywords.get(1));
        }
        if (keywords.size() >= 3) {
            variants.add(keywords.get(0) + " " + keywords.get(1) + " " + keywords.get(2));
        }
        
        // 5. 언어별 검색 접미사 추가
        if ("ko".equals(language)) {
            for (String keyword : keywords.subList(0, Math.min(3, keywords.size()))) {
                variants.add(keyword + " 뉴스");
                variants.add(keyword + " 정보");
                variants.add(keyword + " 최신");
            }
        } else {
            for (String keyword : keywords.subList(0, Math.min(3, keywords.size()))) {
                variants.add(keyword + " news");
                variants.add(keyword + " information");
                variants.add("about " + keyword);
            }
        }
        
        // 중복 제거
        return variants.stream()
                .distinct()
                .filter(v -> !v.isBlank())
                .collect(Collectors.toList());
    }

    // ============================================
    // 폴백 전략 생성
    // ============================================

    private List<FallbackStrategy> generateFallbackStrategies(
            String originalQuery,
            List<String> keywords,
            String primaryKeyword,
            List<String> expandedQueries,
            String language) {
        
        List<FallbackStrategy> strategies = new ArrayList<>();
        
        // 전략 1: 전체 쿼리
        strategies.add(FallbackStrategy.builder()
                .strategyType(StrategyType.FULL_QUERY.name())
                .query(originalQuery)
                .priority(1)
                .description("원본 쿼리로 검색")
                .build());
        
        // 전략 2: 키워드 AND
        if (keywords.size() > 1) {
            strategies.add(FallbackStrategy.builder()
                    .strategyType(StrategyType.KEYWORDS_AND.name())
                    .query(String.join(" ", keywords))
                    .priority(2)
                    .description("모든 키워드로 검색")
                    .build());
        }
        
        // 전략 3: 주요 키워드
        strategies.add(FallbackStrategy.builder()
                .strategyType(StrategyType.PRIMARY_KEYWORD.name())
                .query(primaryKeyword)
                .priority(3)
                .description("주요 키워드만으로 검색")
                .build());
        
        // 전략 4: 확장 쿼리들
        int priority = 4;
        for (String expanded : expandedQueries.subList(0, Math.min(3, expandedQueries.size()))) {
            if (!expanded.equals(originalQuery) && !expanded.equals(primaryKeyword)) {
                strategies.add(FallbackStrategy.builder()
                        .strategyType(StrategyType.SEMANTIC_VARIANT.name())
                        .query(expanded)
                        .priority(priority++)
                        .description("변형 쿼리: " + expanded)
                        .build());
            }
        }
        
        // 전략 5: 키워드 OR (넓은 검색)
        if (keywords.size() > 1) {
            strategies.add(FallbackStrategy.builder()
                    .strategyType(StrategyType.KEYWORDS_OR.name())
                    .query(String.join(" OR ", keywords.subList(0, Math.min(5, keywords.size()))))
                    .priority(priority++)
                    .description("키워드 OR 검색 (넓은 검색)")
                    .build());
        }
        
        // 전략 6: 부분 매칭
        if (keywords.size() >= 2) {
            strategies.add(FallbackStrategy.builder()
                    .strategyType(StrategyType.PARTIAL_MATCH.name())
                    .query(keywords.get(0) + " " + keywords.get(1))
                    .priority(priority++)
                    .description("상위 키워드 부분 매칭")
                    .build());
        }
        
        // 정렬
        strategies.sort(Comparator.comparingInt(FallbackStrategy::getPriority));
        
        return strategies;
    }

    // ============================================
    // 결과 보장 메서드
    // ============================================

    /**
     * 검색 결과가 없을 때 사용할 대체 메시지를 생성합니다.
     */
    public String buildNoResultMessage(AnalyzedQuery analyzed) {
        StringBuilder message = new StringBuilder();
        
        if ("ko".equals(analyzed.getLanguage())) {
            message.append("검색 결과를 찾기 어려웠습니다. 다음을 시도해 보세요:\n\n");
            message.append("시도한 검색어:\n");
            message.append("- ").append(analyzed.getOriginalQuery()).append("\n");
            message.append("- ").append(analyzed.getPrimaryKeyword()).append("\n");
            
            message.append("\n추천 검색 방법:\n");
            message.append("1. 검색어를 더 구체적으로 변경해 보세요\n");
            message.append("2. 다른 키워드를 사용해 보세요: ")
                    .append(String.join(", ", analyzed.getKeywords().subList(0, Math.min(3, analyzed.getKeywords().size()))))
                    .append("\n");
            message.append("3. 시간 범위를 조정해 보세요\n");
            
            message.append("\n분석된 의도: ").append(getIntentDescription(analyzed.getIntentType()));
        } else {
            message.append("Search results were difficult to find. Try the following:\n\n");
            message.append("Queries attempted:\n");
            message.append("- ").append(analyzed.getOriginalQuery()).append("\n");
            message.append("- ").append(analyzed.getPrimaryKeyword()).append("\n");
            
            message.append("\nRecommended approaches:\n");
            message.append("1. Try more specific keywords\n");
            message.append("2. Use alternative keywords: ")
                    .append(String.join(", ", analyzed.getKeywords().subList(0, Math.min(3, analyzed.getKeywords().size()))))
                    .append("\n");
            message.append("3. Adjust the time range\n");
            
            message.append("\nDetected intent: ").append(getIntentDescription(analyzed.getIntentType()));
        }
        
        return message.toString();
    }

    /**
     * 향상된 검색 태스크를 생성합니다.
     */
    public String buildEnhancedSearchTask(AnalyzedQuery analyzed, String originalTask) {
        StringBuilder task = new StringBuilder(originalTask);
        
        task.append("\n\n");
        
        if ("ko".equals(analyzed.getLanguage())) {
            task.append("검색 전략 (결과가 없으면 순서대로 시도하세요):\n");
            int num = 1;
            for (FallbackStrategy strategy : analyzed.getFallbackStrategies().subList(0, Math.min(5, analyzed.getFallbackStrategies().size()))) {
                task.append(num++).append(". ").append(strategy.getDescription())
                        .append(": \"").append(strategy.getQuery()).append("\"\n");
            }
            task.append("\n중요: 검색 결과가 없다고 말하지 마세요. 위의 전략을 모두 시도하고,\n");
            task.append("관련된 정보라도 찾아서 제공하세요. 완전히 일치하지 않더라도\n");
            task.append("가장 관련성 있는 정보를 제공하는 것이 중요합니다.");
        } else {
            task.append("Search strategies (try in order if no results):\n");
            int num = 1;
            for (FallbackStrategy strategy : analyzed.getFallbackStrategies().subList(0, Math.min(5, analyzed.getFallbackStrategies().size()))) {
                task.append(num++).append(". ").append(strategy.getDescription())
                        .append(": \"").append(strategy.getQuery()).append("\"\n");
            }
            task.append("\nIMPORTANT: Never say \"not found\" or \"no results\". Try ALL strategies above,\n");
            task.append("and provide whatever relevant information you can find. Even if not an exact match,\n");
            task.append("providing the most relevant information is important.");
        }
        
        return task.toString();
    }

    private String getIntentDescription(IntentType type) {
        return switch (type) {
            case FACT_CHECK -> "팩트체크/Fact Check - 정보의 진위 여부 검증";
            case LATEST_NEWS -> "최신 뉴스/Latest News - 최근 소식 우선";
            case DEEP_ANALYSIS -> "심층 분석/Deep Analysis - 배경과 맥락 포함";
            case OPINION_SEARCH -> "여론 검색/Opinion Search - 다양한 의견 수집";
            case GENERAL -> "일반 검색/General Search - 관련성 높은 정보";
        };
    }

    private AnalyzedQuery buildEmptyResult() {
        return AnalyzedQuery.builder()
                .originalQuery("")
                .keywords(List.of())
                .primaryKeyword("")
                .intentType(IntentType.GENERAL)
                .confidence(1.0)
                .language("ko")
                .expandedQueries(List.of())
                .fallbackStrategies(List.of())
                .metadata(Map.of())
                .build();
    }

    // ============================================
    // 실시간 데이터 필요성 분석 (LLM + 휴리스틱 하이브리드)
    // ============================================

    /**
     * 쿼리가 실시간 데이터를 필요로 하는지 분석합니다.
     * 
     * 키워드 매칭의 한계를 극복하기 위해:
     * 1. 빠른 휴리스틱 체크 (키워드 기반)
     * 2. 의미 기반 패턴 매칭
     * 3. 필요시 LLM 분석 (새로운 개념, 알려지지 않은 엔티티)
     * 
     * @param query 분석할 쿼리
     * @return 실시간 데이터 필요성 분석 결과
     */
    public RealtimeAnalysisResult analyzeRealtimeDataNeed(String query) {
        if (query == null || query.isBlank()) {
            return buildDefaultRealtimeResult(false, "empty_query");
        }

        String cacheKey = query.toLowerCase().trim();
        
        // 1. 캐시 확인
        RealtimeAnalysisResult cached = realtimeAnalysisCache.get(cacheKey);
        if (cached != null && System.currentTimeMillis() - cached.getTimestamp() < 300_000) { // 5분 TTL
            log.debug("Realtime analysis cache hit for: {}", query);
            return cached;
        }

        // 2. 빠른 휴리스틱 체크
        RealtimeAnalysisResult heuristicResult = analyzeWithHeuristics(query);
        if (heuristicResult.getConfidence() >= 0.8) {
            cacheResult(cacheKey, heuristicResult);
            return heuristicResult;
        }

        // 3. 의미 기반 패턴 분석
        RealtimeAnalysisResult semanticResult = analyzeWithSemanticPatterns(query);
        if (semanticResult.getConfidence() >= 0.7) {
            cacheResult(cacheKey, semanticResult);
            return semanticResult;
        }

        // 4. LLM 분석 (알 수 없는 엔티티나 새로운 개념의 경우)
        if (aiDoveClient != null && aiDoveClient.isEnabled() && heuristicResult.getConfidence() < 0.5) {
            try {
                RealtimeAnalysisResult llmResult = analyzeWithLLM(query);
                if (llmResult != null) {
                    cacheResult(cacheKey, llmResult);
                    return llmResult;
                }
            } catch (Exception e) {
                log.warn("LLM analysis failed for realtime check: {}", e.getMessage());
            }
        }

        // 5. 휴리스틱 + 의미 분석 결과 결합
        RealtimeAnalysisResult combined = combineResults(heuristicResult, semanticResult);
        cacheResult(cacheKey, combined);
        return combined;
    }

    /**
     * 휴리스틱 기반 빠른 분석
     */
    private RealtimeAnalysisResult analyzeWithHeuristics(String query) {
        String lower = query.toLowerCase();
        double confidence = 0.0;
        String dataType = "unknown";
        List<String> entities = new ArrayList<>();
        StringBuilder reason = new StringBuilder();

        // 시간 민감 키워드
        Map<String, Double> timeKeywords = Map.ofEntries(
                Map.entry("현재", 0.9), Map.entry("지금", 0.9), Map.entry("오늘", 0.85),
                Map.entry("실시간", 0.95), Map.entry("최신", 0.8), Map.entry("방금", 0.9),
                Map.entry("current", 0.9), Map.entry("now", 0.85), Map.entry("today", 0.8),
                Map.entry("latest", 0.8), Map.entry("live", 0.9), Map.entry("real-time", 0.95)
        );

        // 가격/시세 키워드
        Map<String, Double> priceKeywords = Map.ofEntries(
                Map.entry("가격", 0.85), Map.entry("시세", 0.9), Map.entry("시가", 0.85),
                Map.entry("종가", 0.85), Map.entry("환율", 0.9), Map.entry("얼마", 0.7),
                Map.entry("price", 0.85), Map.entry("rate", 0.8), Map.entry("cost", 0.7),
                Map.entry("worth", 0.75), Map.entry("value", 0.7)
        );

        // 금융 자산 키워드
        Map<String, String> assetKeywords = Map.ofEntries(
                // 암호화폐
                Map.entry("비트코인", "crypto"), Map.entry("이더리움", "crypto"),
                Map.entry("리플", "crypto"), Map.entry("도지코인", "crypto"),
                Map.entry("bitcoin", "crypto"), Map.entry("btc", "crypto"),
                Map.entry("ethereum", "crypto"), Map.entry("eth", "crypto"),
                Map.entry("암호화폐", "crypto"), Map.entry("코인", "crypto"),
                Map.entry("crypto", "crypto"), Map.entry("cryptocurrency", "crypto"),
                // 주식
                Map.entry("주가", "stock"), Map.entry("주식", "stock"),
                Map.entry("코스피", "stock"), Map.entry("코스닥", "stock"),
                Map.entry("나스닥", "stock"), Map.entry("다우", "stock"),
                Map.entry("s&p", "stock"), Map.entry("stock", "stock"),
                Map.entry("nasdaq", "stock"), Map.entry("dow", "stock"),
                // 환율
                Map.entry("달러", "forex"), Map.entry("엔화", "forex"),
                Map.entry("유로", "forex"), Map.entry("원화", "forex"),
                Map.entry("dollar", "forex"), Map.entry("yen", "forex"),
                Map.entry("euro", "forex"), Map.entry("usd", "forex"),
                Map.entry("krw", "forex"), Map.entry("jpy", "forex")
        );

        // 통계/지표 키워드
        Map<String, Double> statsKeywords = Map.ofEntries(
                Map.entry("통계", 0.7), Map.entry("지표", 0.75), Map.entry("수치", 0.7),
                Map.entry("데이터", 0.6), Map.entry("지수", 0.75), Map.entry("률", 0.7),
                Map.entry("statistics", 0.7), Map.entry("index", 0.75), Map.entry("rate", 0.7)
        );

        // 시간 키워드 체크
        for (Map.Entry<String, Double> entry : timeKeywords.entrySet()) {
            if (lower.contains(entry.getKey())) {
                confidence = Math.max(confidence, entry.getValue());
                reason.append("time_keyword:").append(entry.getKey()).append(" ");
            }
        }

        // 가격 키워드 체크
        for (Map.Entry<String, Double> entry : priceKeywords.entrySet()) {
            if (lower.contains(entry.getKey())) {
                confidence = Math.max(confidence, entry.getValue());
                dataType = "price";
                reason.append("price_keyword:").append(entry.getKey()).append(" ");
            }
        }

        // 자산 키워드 체크
        for (Map.Entry<String, String> entry : assetKeywords.entrySet()) {
            if (lower.contains(entry.getKey())) {
                confidence = Math.max(confidence, 0.8);
                dataType = entry.getValue();
                entities.add(entry.getKey());
                reason.append("asset:").append(entry.getKey()).append(" ");
            }
        }

        // 통계 키워드 체크
        for (Map.Entry<String, Double> entry : statsKeywords.entrySet()) {
            if (lower.contains(entry.getKey())) {
                confidence = Math.max(confidence, entry.getValue());
                if ("unknown".equals(dataType)) dataType = "statistics";
                reason.append("stats:").append(entry.getKey()).append(" ");
            }
        }

        return RealtimeAnalysisResult.builder()
                .needsRealtimeData(confidence >= 0.6)
                .dataType(dataType)
                .reason(reason.toString().trim())
                .confidence(confidence)
                .entities(entities)
                .timestamp(System.currentTimeMillis())
                .build();
    }

    /**
     * 의미 기반 패턴 분석
     * 키워드가 없어도 문맥에서 실시간 데이터 필요성 감지
     */
    private RealtimeAnalysisResult analyzeWithSemanticPatterns(String query) {
        String lower = query.toLowerCase();
        double confidence = 0.0;
        String dataType = "unknown";
        List<String> entities = new ArrayList<>();
        StringBuilder reason = new StringBuilder();

        // 패턴 1: "X가 얼마야?", "X 몇이야?" 등의 가격 질문 패턴
        Pattern priceQuestionPattern = Pattern.compile(
                "(.+?)(?:가|이|은|는)?\\s*(?:얼마|몇|어느정도|어느 정도|how much|what.*price)"
        );
        Matcher priceMatch = priceQuestionPattern.matcher(lower);
        if (priceMatch.find()) {
            confidence = Math.max(confidence, 0.75);
            dataType = "price";
            entities.add(priceMatch.group(1).trim());
            reason.append("price_question_pattern ");
        }

        // 패턴 2: "X 전망", "X 예측" 등 미래 관련 패턴 (현재 데이터 필요)
        Pattern forecastPattern = Pattern.compile(
                "(.+?)\\s*(?:전망|예측|예상|향후|미래|forecast|prediction|outlook)"
        );
        Matcher forecastMatch = forecastPattern.matcher(lower);
        if (forecastMatch.find()) {
            confidence = Math.max(confidence, 0.7);
            if ("unknown".equals(dataType)) dataType = "forecast";
            entities.add(forecastMatch.group(1).trim());
            reason.append("forecast_pattern ");
        }

        // 패턴 3: 숫자 + 단위 질문 (현재 값 확인)
        Pattern numericQuestionPattern = Pattern.compile(
                "(.+?)\\s*(?:달러|원|엔|유로|\\$|₩|¥|€|%|퍼센트).*(?:인가요?|일까요?|입니까|야\\??|인지)"
        );
        Matcher numericMatch = numericQuestionPattern.matcher(lower);
        if (numericMatch.find()) {
            confidence = Math.max(confidence, 0.8);
            dataType = "price";
            reason.append("numeric_question_pattern ");
        }

        // 패턴 4: 비교 질문 (두 시점 비교 = 현재 데이터 필요)
        Pattern comparisonPattern = Pattern.compile(
                "(?:어제|지난주|지난달|작년|전|ago).*(?:비교|대비|vs|versus|compared)"
        );
        if (comparisonPattern.matcher(lower).find()) {
            confidence = Math.max(confidence, 0.7);
            if ("unknown".equals(dataType)) dataType = "comparison";
            reason.append("comparison_pattern ");
        }

        // 패턴 5: 급등/급락, 상승/하락 등 시장 동향
        Pattern marketTrendPattern = Pattern.compile(
                "(?:급등|급락|폭등|폭락|상승|하락|오르|내리|surge|crash|rise|fall|up|down)"
        );
        if (marketTrendPattern.matcher(lower).find()) {
            confidence = Math.max(confidence, 0.75);
            if ("unknown".equals(dataType)) dataType = "market_trend";
            reason.append("market_trend_pattern ");
        }

        return RealtimeAnalysisResult.builder()
                .needsRealtimeData(confidence >= 0.6)
                .dataType(dataType)
                .reason(reason.toString().trim())
                .confidence(confidence)
                .entities(entities)
                .timestamp(System.currentTimeMillis())
                .build();
    }

    /**
     * LLM 기반 의미 분석 (새로운 개념이나 알려지지 않은 엔티티용)
     */
    private RealtimeAnalysisResult analyzeWithLLM(String query) {
        String prompt = """
                다음 질문이 실시간/최신 데이터를 필요로 하는지 분석해주세요.
                
                질문: "%s"
                
                다음 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
                {
                    "needs_realtime": true/false,
                    "data_type": "price|statistics|news|event|weather|sports|unknown",
                    "reason": "판단 이유 (한 문장)",
                    "confidence": 0.0~1.0,
                    "entities": ["관련 엔티티1", "엔티티2"]
                }
                
                실시간 데이터가 필요한 경우:
                - 현재 가격, 시세, 환율 등 시간에 따라 변하는 수치
                - 오늘/현재/지금의 상태를 묻는 질문
                - 실시간 뉴스, 속보, 이벤트
                - 날씨, 스포츠 경기 결과 등 시시각각 변하는 정보
                - 새로운 암호화폐, 주식, 자산의 현재 가치
                """.formatted(query);

        try {
            String response = aiDoveClient.chat(prompt, null)
                    .map(r -> r.reply())
                    .block(java.time.Duration.ofSeconds(10));

            if (response != null && response.contains("{")) {
                // JSON 파싱
                int start = response.indexOf("{");
                int end = response.lastIndexOf("}") + 1;
                String json = response.substring(start, end);
                
                // 간단한 파싱 (ObjectMapper 없이)
                boolean needsRealtime = json.contains("\"needs_realtime\": true") || 
                                        json.contains("\"needs_realtime\":true");
                
                String dataType = extractJsonValue(json, "data_type");
                String reason = extractJsonValue(json, "reason");
                double confidence = parseConfidence(extractJsonValue(json, "confidence"));
                List<String> entities = parseEntities(json);

                return RealtimeAnalysisResult.builder()
                        .needsRealtimeData(needsRealtime)
                        .dataType(dataType != null ? dataType : "unknown")
                        .reason("LLM: " + (reason != null ? reason : "analyzed"))
                        .confidence(confidence)
                        .entities(entities)
                        .timestamp(System.currentTimeMillis())
                        .build();
            }
        } catch (Exception e) {
            log.debug("LLM realtime analysis failed: {}", e.getMessage());
        }

        return null;
    }

    private String extractJsonValue(String json, String key) {
        Pattern pattern = Pattern.compile("\"" + key + "\"\\s*:\\s*\"([^\"]+)\"");
        Matcher matcher = pattern.matcher(json);
        if (matcher.find()) {
            return matcher.group(1);
        }
        return null;
    }

    private double parseConfidence(String value) {
        if (value == null) return 0.5;
        try {
            return Double.parseDouble(value);
        } catch (NumberFormatException e) {
            return 0.5;
        }
    }

    private List<String> parseEntities(String json) {
        List<String> entities = new ArrayList<>();
        Pattern pattern = Pattern.compile("\"entities\"\\s*:\\s*\\[([^\\]]+)\\]");
        Matcher matcher = pattern.matcher(json);
        if (matcher.find()) {
            String entitiesStr = matcher.group(1);
            Pattern entityPattern = Pattern.compile("\"([^\"]+)\"");
            Matcher entityMatcher = entityPattern.matcher(entitiesStr);
            while (entityMatcher.find()) {
                entities.add(entityMatcher.group(1));
            }
        }
        return entities;
    }

    private RealtimeAnalysisResult combineResults(
            RealtimeAnalysisResult heuristic, 
            RealtimeAnalysisResult semantic) {
        
        double combinedConfidence = Math.max(heuristic.getConfidence(), semantic.getConfidence());
        boolean needsRealtime = combinedConfidence >= 0.6;
        
        String dataType = !"unknown".equals(heuristic.getDataType()) 
                ? heuristic.getDataType() 
                : semantic.getDataType();
        
        List<String> allEntities = new ArrayList<>(heuristic.getEntities());
        for (String entity : semantic.getEntities()) {
            if (!allEntities.contains(entity)) {
                allEntities.add(entity);
            }
        }
        
        String reason = (heuristic.getReason() + " " + semantic.getReason()).trim();

        return RealtimeAnalysisResult.builder()
                .needsRealtimeData(needsRealtime)
                .dataType(dataType)
                .reason(reason)
                .confidence(combinedConfidence)
                .entities(allEntities)
                .timestamp(System.currentTimeMillis())
                .build();
    }

    private RealtimeAnalysisResult buildDefaultRealtimeResult(boolean needsRealtime, String reason) {
        return RealtimeAnalysisResult.builder()
                .needsRealtimeData(needsRealtime)
                .dataType("unknown")
                .reason(reason)
                .confidence(needsRealtime ? 0.5 : 0.0)
                .entities(List.of())
                .timestamp(System.currentTimeMillis())
                .build();
    }

    private void cacheResult(String key, RealtimeAnalysisResult result) {
        // 캐시 크기 제한
        if (realtimeAnalysisCache.size() >= MAX_CACHE_SIZE) {
            // 가장 오래된 항목 제거 (간단한 구현)
            realtimeAnalysisCache.entrySet().stream()
                    .min(Comparator.comparingLong(e -> e.getValue().getTimestamp()))
                    .ifPresent(oldest -> realtimeAnalysisCache.remove(oldest.getKey()));
        }
        realtimeAnalysisCache.put(key, result);
    }
}
