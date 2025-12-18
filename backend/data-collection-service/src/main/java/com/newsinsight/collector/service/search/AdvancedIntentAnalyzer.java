package com.newsinsight.collector.service.search;

import com.newsinsight.collector.service.search.HybridRankingService.QueryIntent;
import com.newsinsight.collector.service.search.HybridRankingService.QueryIntent.IntentType;
import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;
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
}
