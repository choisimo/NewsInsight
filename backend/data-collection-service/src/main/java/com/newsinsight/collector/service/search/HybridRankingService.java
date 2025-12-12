package com.newsinsight.collector.service.search;

import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Reciprocal Rank Fusion (RRF) 기반 하이브리드 랭킹 서비스.
 * 
 * 여러 검색 소스의 결과를 RRF 알고리즘으로 융합하여
 * 사용자 의도에 맞는 최적의 순서로 정렬합니다.
 * 
 * RRF 공식: score(d) = Σ 1/(k + rank_i(d))
 * - k: 상수 (기본값 60, 낮을수록 상위 랭크에 가중치)
 * - rank_i(d): i번째 검색 소스에서 문서 d의 순위
 * 
 * 참고: https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class HybridRankingService {

    // RRF 상수 k - 낮을수록 상위 결과에 더 높은 가중치
    private static final double RRF_K = 60.0;

    // 검색 소스별 기본 가중치
    private static final Map<String, Double> DEFAULT_SOURCE_WEIGHTS = Map.of(
            "keyword", 1.0,      // 키워드 검색
            "semantic", 1.0,    // 시맨틱(벡터) 검색
            "database", 0.9,    // DB 검색 (기존 수집 데이터)
            "web", 0.8,         // 웹 크롤링
            "ai", 0.7           // AI 분석 결과
    );

    /**
     * 여러 소스의 검색 결과를 RRF로 융합합니다.
     *
     * @param rankedLists 소스별 검색 결과 (소스명 → 순위별 결과 리스트)
     * @return RRF 점수로 정렬된 통합 결과
     */
    public List<RankedResult> fuseResults(Map<String, List<SearchCandidate>> rankedLists) {
        return fuseResults(rankedLists, DEFAULT_SOURCE_WEIGHTS, null);
    }

    /**
     * 쿼리 의도에 따라 가중치를 조정하여 결과를 융합합니다.
     *
     * @param rankedLists 소스별 검색 결과
     * @param intent 쿼리 의도 (null이면 기본 가중치 사용)
     * @return RRF 점수로 정렬된 통합 결과
     */
    public List<RankedResult> fuseResults(
            Map<String, List<SearchCandidate>> rankedLists,
            QueryIntent intent) {
        
        Map<String, Double> adjustedWeights = adjustWeightsForIntent(intent);
        return fuseResults(rankedLists, adjustedWeights, intent);
    }

    /**
     * 커스텀 가중치로 결과를 융합합니다.
     *
     * @param rankedLists 소스별 검색 결과
     * @param sourceWeights 소스별 가중치
     * @param intent 쿼리 의도 (후처리용)
     * @return RRF 점수로 정렬된 통합 결과
     */
    public List<RankedResult> fuseResults(
            Map<String, List<SearchCandidate>> rankedLists,
            Map<String, Double> sourceWeights,
            QueryIntent intent) {

        if (rankedLists == null || rankedLists.isEmpty()) {
            return List.of();
        }

        // 문서 ID → RRF 점수 누적
        Map<String, Double> rrfScores = new HashMap<>();
        // 문서 ID → 원본 정보
        Map<String, SearchCandidate> candidateMap = new HashMap<>();
        // 문서 ID → 출처 소스들
        Map<String, Set<String>> documentSources = new HashMap<>();

        for (Map.Entry<String, List<SearchCandidate>> entry : rankedLists.entrySet()) {
            String source = entry.getKey();
            List<SearchCandidate> candidates = entry.getValue();
            double weight = sourceWeights.getOrDefault(source, 1.0);

            for (int rank = 0; rank < candidates.size(); rank++) {
                SearchCandidate candidate = candidates.get(rank);
                String docId = candidate.getId();

                // RRF 점수 계산: weight * 1/(k + rank)
                double rrfScore = weight * (1.0 / (RRF_K + rank + 1));
                rrfScores.merge(docId, rrfScore, Double::sum);

                // 원본 정보 저장 (처음 등장한 정보 유지)
                candidateMap.putIfAbsent(docId, candidate);

                // 출처 추적
                documentSources.computeIfAbsent(docId, k -> new HashSet<>()).add(source);
            }
        }

        // RRF 점수순 정렬
        List<RankedResult> results = rrfScores.entrySet().stream()
                .map(entry -> {
                    String docId = entry.getKey();
                    SearchCandidate candidate = candidateMap.get(docId);
                    return RankedResult.builder()
                            .id(docId)
                            .title(candidate.getTitle())
                            .snippet(candidate.getSnippet())
                            .content(candidate.getContent())
                            .url(candidate.getUrl())
                            .publishedAt(candidate.getPublishedAt())
                            .rrfScore(entry.getValue())
                            .originalScore(candidate.getOriginalScore())
                            .sources(documentSources.get(docId))
                            .metadata(candidate.getMetadata())
                            .build();
                })
                .sorted(Comparator.comparingDouble(RankedResult::getRrfScore).reversed())
                .collect(Collectors.toList());

        // 의도 기반 후처리 (재정렬)
        if (intent != null) {
            results = applyIntentBoost(results, intent);
        }

        log.debug("RRF fusion completed: {} sources → {} unique results", 
                rankedLists.size(), results.size());

        return results;
    }

    /**
     * 쿼리 의도에 따라 소스 가중치를 조정합니다.
     */
    private Map<String, Double> adjustWeightsForIntent(QueryIntent intent) {
        if (intent == null) {
            return DEFAULT_SOURCE_WEIGHTS;
        }

        Map<String, Double> adjusted = new HashMap<>(DEFAULT_SOURCE_WEIGHTS);

        switch (intent.getType()) {
            case FACT_CHECK:
                // 팩트체크: DB(검증된 데이터)와 AI 분석 우선
                adjusted.put("database", 1.2);
                adjusted.put("ai", 1.1);
                adjusted.put("semantic", 1.0);
                adjusted.put("web", 0.7);
                break;

            case LATEST_NEWS:
                // 최신 뉴스: 웹 크롤링과 키워드 검색 우선
                adjusted.put("web", 1.2);
                adjusted.put("keyword", 1.1);
                adjusted.put("database", 0.9);
                adjusted.put("semantic", 0.8);
                break;

            case DEEP_ANALYSIS:
                // 심층 분석: 시맨틱 검색과 AI 분석 우선
                adjusted.put("semantic", 1.2);
                adjusted.put("ai", 1.1);
                adjusted.put("database", 1.0);
                adjusted.put("keyword", 0.8);
                break;

            case OPINION_SEARCH:
                // 여론/의견 검색: 다양한 소스 균형
                adjusted.put("semantic", 1.1);
                adjusted.put("web", 1.0);
                adjusted.put("database", 1.0);
                adjusted.put("ai", 0.9);
                break;

            case GENERAL:
            default:
                // 일반 검색: 기본 가중치 유지
                break;
        }

        return adjusted;
    }

    /**
     * 의도 기반 부스팅을 적용합니다.
     */
    private List<RankedResult> applyIntentBoost(List<RankedResult> results, QueryIntent intent) {
        // 키워드가 포함된 결과 부스팅
        if (intent.getKeywords() != null && !intent.getKeywords().isEmpty()) {
            for (RankedResult result : results) {
                double keywordBoost = calculateKeywordBoost(result, intent.getKeywords());
                result.setRrfScore(result.getRrfScore() * (1 + keywordBoost));
            }
        }

        // 시간 기반 부스팅 (최신 뉴스 의도일 경우)
        if (intent.getType() == QueryIntent.IntentType.LATEST_NEWS) {
            for (RankedResult result : results) {
                double recencyBoost = calculateRecencyBoost(result.getPublishedAt());
                result.setRrfScore(result.getRrfScore() * (1 + recencyBoost));
            }
        }

        // 다중 소스 부스팅 (여러 소스에서 발견된 문서 신뢰도 향상)
        for (RankedResult result : results) {
            int sourceCount = result.getSources() != null ? result.getSources().size() : 1;
            if (sourceCount > 1) {
                double multiSourceBoost = 0.1 * (sourceCount - 1);
                result.setRrfScore(result.getRrfScore() * (1 + multiSourceBoost));
            }
        }

        // 재정렬
        results.sort(Comparator.comparingDouble(RankedResult::getRrfScore).reversed());
        return results;
    }

    /**
     * 키워드 부스트 점수를 계산합니다.
     */
    private double calculateKeywordBoost(RankedResult result, List<String> keywords) {
        String text = (result.getTitle() + " " + 
                      (result.getSnippet() != null ? result.getSnippet() : "")).toLowerCase();
        
        int matchCount = 0;
        for (String keyword : keywords) {
            if (text.contains(keyword.toLowerCase())) {
                matchCount++;
            }
        }
        
        return keywords.isEmpty() ? 0 : (double) matchCount / keywords.size() * 0.2;
    }

    /**
     * 최신성 부스트 점수를 계산합니다.
     */
    private double calculateRecencyBoost(String publishedAt) {
        if (publishedAt == null) return 0;
        
        try {
            // 간단한 최신성 계산 (더 정교한 로직으로 대체 가능)
            // publishedAt이 최근일수록 높은 부스트
            return 0.1; // 기본 부스트
        } catch (Exception e) {
            return 0;
        }
    }

    // ==================== Inner Classes ====================

    /**
     * 검색 후보 문서
     */
    @Data
    @Builder
    public static class SearchCandidate {
        private String id;
        private String title;
        private String snippet;
        private String content;
        private String url;
        private String publishedAt;
        private Double originalScore;  // 원본 검색 점수 (유사도, relevance 등)
        private Map<String, Object> metadata;
    }

    /**
     * RRF 점수가 포함된 최종 결과
     */
    @Data
    @Builder
    public static class RankedResult {
        private String id;
        private String title;
        private String snippet;
        private String content;
        private String url;
        private String publishedAt;
        private double rrfScore;
        private Double originalScore;
        private Set<String> sources;  // 이 문서가 발견된 소스들
        private Map<String, Object> metadata;
    }

    /**
     * 쿼리 의도
     */
    @Data
    @Builder
    public static class QueryIntent {
        private IntentType type;
        private List<String> keywords;
        private String timeRange;
        private Double confidence;

        public enum IntentType {
            GENERAL,        // 일반 검색
            FACT_CHECK,     // 팩트체크/검증
            LATEST_NEWS,    // 최신 뉴스
            DEEP_ANALYSIS,  // 심층 분석
            OPINION_SEARCH  // 여론/의견 검색
        }
    }
}
