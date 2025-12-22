package com.newsinsight.collector.service.factcheck;

import com.newsinsight.collector.service.FactVerificationService.SourceEvidence;
import com.newsinsight.collector.service.search.AdvancedIntentAnalyzer;
import com.newsinsight.collector.service.search.AdvancedIntentAnalyzer.AnalyzedQuery;
import com.newsinsight.collector.service.search.AdvancedIntentAnalyzer.FallbackStrategy;
import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.time.Duration;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

/**
 * RRF(Reciprocal Rank Fusion) 기반 증거 검색 및 융합 서비스
 * 
 * 의도 분석을 통해 생성된 여러 검색 쿼리를 병렬로 실행하고,
 * RRF 알고리즘을 사용하여 결과를 융합합니다.
 * 
 * 주요 기능:
 * 1. 다중 쿼리 병렬 실행
 * 2. 다중 소스 병렬 검색
 * 3. RRF 기반 결과 융합 및 랭킹
 * 4. 중복 제거 및 품질 필터링
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class RRFEvidenceFusionService {

    private final List<FactCheckSource> factCheckSources;
    private final AdvancedIntentAnalyzer intentAnalyzer;

    @Value("${collector.fact-check.timeout-seconds:15}")
    private int timeoutSeconds;

    @Value("${collector.fact-check.rrf.k:60}")
    private int rrfK; // RRF 상수 k (기본값 60)

    @Value("${collector.fact-check.rrf.max-queries:5}")
    private int maxQueries; // 최대 병렬 쿼리 수

    @Value("${collector.fact-check.rrf.max-results:50}")
    private int maxResults; // 최대 결과 수

    @Value("${collector.fact-check.rrf.min-relevance:0.1}")
    private double minRelevance; // 최소 관련성 점수 (이하 결과는 제외)

    /**
     * 주어진 주제에 대해 다중 쿼리 병렬 검색 및 RRF 융합 수행
     *
     * @param topic 검색 주제
     * @param language 언어 코드 (ko, en)
     * @return 융합된 증거 목록
     */
    public Mono<FusionResult> searchAndFuse(String topic, String language) {
        log.info("Starting RRF-based multi-query search for topic: {}", topic);
        
        // 1. 의도 분석 및 쿼리 확장
        AnalyzedQuery analyzedQuery = intentAnalyzer.analyzeQuery(topic);
        
        // 2. 검색 쿼리 목록 생성
        List<SearchQuery> searchQueries = buildSearchQueries(analyzedQuery, topic);
        
        log.info("Generated {} search queries for parallel execution", searchQueries.size());
        
        // 3. 활성화된 소스 목록
        List<FactCheckSource> activeSources = factCheckSources.stream()
                .filter(FactCheckSource::isAvailable)
                .toList();
        
        if (activeSources.isEmpty()) {
            log.warn("No active fact-check sources available");
            return Mono.just(FusionResult.builder()
                    .topic(topic)
                    .evidences(List.of())
                    .queryCount(0)
                    .sourceCount(0)
                    .fusionMethod("RRF")
                    .build());
        }

        // 4. 병렬 검색 실행
        return executeParallelSearch(searchQueries, activeSources, language)
                .collectList()
                .map(allResults -> {
                    // 5. RRF 융합
                    List<SourceEvidence> fused = fuseWithRRF(allResults, searchQueries.size());
                    
                    log.info("RRF fusion completed: {} queries × {} sources → {} unique evidences",
                            searchQueries.size(), activeSources.size(), fused.size());
                    
                    return FusionResult.builder()
                            .topic(topic)
                            .analyzedQuery(analyzedQuery)
                            .evidences(fused)
                            .queryCount(searchQueries.size())
                            .sourceCount(activeSources.size())
                            .fusionMethod("RRF (k=" + rrfK + ")")
                            .build();
                });
    }

    /**
     * 검색 쿼리 목록 생성
     */
    private List<SearchQuery> buildSearchQueries(AnalyzedQuery analyzed, String originalTopic) {
        List<SearchQuery> queries = new ArrayList<>();
        Set<String> seenQueries = new HashSet<>();
        
        // 1. 원본 쿼리 (최고 우선순위)
        queries.add(SearchQuery.builder()
                .query(originalTopic)
                .weight(1.0)
                .strategyType("ORIGINAL")
                .build());
        seenQueries.add(originalTopic.toLowerCase().trim());
        
        // 2. 한국어 → 영어 학술 쿼리 변환 (학술 DB 검색용)
        String academicQuery = convertToAcademicQuery(originalTopic, analyzed.getKeywords());
        if (academicQuery != null && !seenQueries.contains(academicQuery.toLowerCase().trim())) {
            queries.add(SearchQuery.builder()
                    .query(academicQuery)
                    .weight(0.95)
                    .strategyType("ACADEMIC_ENGLISH")
                    .build());
            seenQueries.add(academicQuery.toLowerCase().trim());
            log.info("Generated English academic query from Korean: '{}' -> '{}'", originalTopic, academicQuery);
        }
        
        // 3. 폴백 전략에서 쿼리 추출
        if (analyzed.getFallbackStrategies() != null) {
            for (FallbackStrategy strategy : analyzed.getFallbackStrategies()) {
                String query = strategy.getQuery();
                String normalizedQuery = query.toLowerCase().trim();
                
                if (!seenQueries.contains(normalizedQuery) && !query.isBlank()) {
                    // 우선순위에 따른 가중치 계산
                    double weight = Math.max(0.5, 1.0 - (strategy.getPriority() - 1) * 0.1);
                    
                    queries.add(SearchQuery.builder()
                            .query(query)
                            .weight(weight)
                            .strategyType(strategy.getStrategyType())
                            .build());
                    seenQueries.add(normalizedQuery);
                }
                
                if (queries.size() >= maxQueries) break;
            }
        }
        
        // 4. 확장 쿼리 추가
        if (queries.size() < maxQueries && analyzed.getExpandedQueries() != null) {
            for (String expanded : analyzed.getExpandedQueries()) {
                String normalizedQuery = expanded.toLowerCase().trim();
                
                if (!seenQueries.contains(normalizedQuery) && !expanded.isBlank()) {
                    queries.add(SearchQuery.builder()
                            .query(expanded)
                            .weight(0.6)
                            .strategyType("EXPANDED")
                            .build());
                    seenQueries.add(normalizedQuery);
                }
                
                if (queries.size() >= maxQueries) break;
            }
        }
        
        // 5. 주요 키워드 단독 검색 추가 (없는 경우)
        if (analyzed.getPrimaryKeyword() != null && 
            !seenQueries.contains(analyzed.getPrimaryKeyword().toLowerCase().trim())) {
            queries.add(SearchQuery.builder()
                    .query(analyzed.getPrimaryKeyword())
                    .weight(0.7)
                    .strategyType("PRIMARY_KEYWORD")
                    .build());
        }

        return queries;
    }

    /**
     * 한국어 질문을 학술 DB 검색에 적합한 영어 쿼리로 변환
     */
    private String convertToAcademicQuery(String koreanQuery, List<String> keywords) {
        // 한국어 → 영어 키워드 매핑 (동물, 과학 관련)
        Map<String, String> korToEngMap = new LinkedHashMap<>();
        
        // 동물
        korToEngMap.put("코끼리", "elephant");
        korToEngMap.put("두더지", "mole");
        korToEngMap.put("쥐", "mouse");
        korToEngMap.put("생쥐", "mouse");
        korToEngMap.put("뱀", "snake");
        korToEngMap.put("개", "dog");
        korToEngMap.put("고양이", "cat");
        korToEngMap.put("사자", "lion");
        korToEngMap.put("호랑이", "tiger");
        korToEngMap.put("곰", "bear");
        korToEngMap.put("원숭이", "monkey");
        korToEngMap.put("새", "bird");
        korToEngMap.put("물고기", "fish");
        korToEngMap.put("상어", "shark");
        korToEngMap.put("고래", "whale");
        korToEngMap.put("돌고래", "dolphin");
        korToEngMap.put("박쥐", "bat");
        korToEngMap.put("거미", "spider");
        korToEngMap.put("벌", "bee");
        korToEngMap.put("개미", "ant");
        korToEngMap.put("나비", "butterfly");
        
        // 행동/감정
        korToEngMap.put("무서워하", "fear");
        korToEngMap.put("무서워한다", "fear");
        korToEngMap.put("두려워하", "fear");
        korToEngMap.put("두려워한다", "fear");
        korToEngMap.put("좋아하", "like");
        korToEngMap.put("싫어하", "dislike");
        korToEngMap.put("공격하", "attack");
        korToEngMap.put("피하", "avoid");
        korToEngMap.put("도망가", "flee");
        korToEngMap.put("도망친다", "flee");
        
        // 과학 용어
        korToEngMap.put("행동", "behavior");
        korToEngMap.put("습성", "behavior");
        korToEngMap.put("본능", "instinct");
        korToEngMap.put("진화", "evolution");
        korToEngMap.put("유전자", "gene");
        korToEngMap.put("뇌", "brain");
        korToEngMap.put("신경", "nerve");
        korToEngMap.put("연구", "study");
        korToEngMap.put("실험", "experiment");
        
        // 건강/의학
        korToEngMap.put("암", "cancer");
        korToEngMap.put("당뇨", "diabetes");
        korToEngMap.put("고혈압", "hypertension");
        korToEngMap.put("비만", "obesity");
        korToEngMap.put("바이러스", "virus");
        korToEngMap.put("세균", "bacteria");
        korToEngMap.put("면역", "immunity");
        korToEngMap.put("백신", "vaccine");
        korToEngMap.put("치료", "treatment");
        korToEngMap.put("약", "drug");
        korToEngMap.put("부작용", "side effect");
        
        // 환경/지구과학
        korToEngMap.put("지구온난화", "global warming");
        korToEngMap.put("기후변화", "climate change");
        korToEngMap.put("오존층", "ozone layer");
        korToEngMap.put("미세먼지", "fine dust PM2.5");
        korToEngMap.put("환경오염", "environmental pollution");
        korToEngMap.put("방사능", "radiation");
        korToEngMap.put("핵", "nuclear");
        korToEngMap.put("지진", "earthquake");
        korToEngMap.put("화산", "volcano");
        korToEngMap.put("태풍", "typhoon");
        korToEngMap.put("홍수", "flood");
        
        // 음식/영양
        korToEngMap.put("커피", "coffee");
        korToEngMap.put("차", "tea");
        korToEngMap.put("술", "alcohol");
        korToEngMap.put("설탕", "sugar");
        korToEngMap.put("소금", "salt");
        korToEngMap.put("비타민", "vitamin");
        korToEngMap.put("단백질", "protein");
        korToEngMap.put("지방", "fat");
        korToEngMap.put("탄수화물", "carbohydrate");
        
        // 변환 실행
        List<String> englishTerms = new ArrayList<>();
        String lowerQuery = koreanQuery.toLowerCase();
        
        for (Map.Entry<String, String> entry : korToEngMap.entrySet()) {
            if (lowerQuery.contains(entry.getKey())) {
                if (!englishTerms.contains(entry.getValue())) {
                    englishTerms.add(entry.getValue());
                }
            }
        }
        
        // 키워드에서도 변환 시도
        for (String keyword : keywords) {
            String lowerKeyword = keyword.toLowerCase();
            for (Map.Entry<String, String> entry : korToEngMap.entrySet()) {
                if (lowerKeyword.contains(entry.getKey())) {
                    if (!englishTerms.contains(entry.getValue())) {
                        englishTerms.add(entry.getValue());
                    }
                }
            }
        }
        
        if (englishTerms.isEmpty()) {
            return null;
        }
        
        // 학술 검색용 쿼리 생성
        return String.join(" ", englishTerms);
    }

    /**
     * 병렬 검색 실행
     */
    private Flux<RankedResultSet> executeParallelSearch(
            List<SearchQuery> queries,
            List<FactCheckSource> sources,
            String language) {
        
        // 각 (쿼리, 소스) 조합에 대해 병렬 검색
        List<Mono<RankedResultSet>> searchTasks = new ArrayList<>();
        AtomicInteger queryIndex = new AtomicInteger(0);
        
        for (SearchQuery searchQuery : queries) {
            int qIdx = queryIndex.getAndIncrement();
            
            for (FactCheckSource source : sources) {
                Mono<RankedResultSet> task = source.fetchEvidence(searchQuery.getQuery(), language)
                        .filter(evidence -> evidence.getRelevanceScore() >= minRelevance) // 관련성 필터
                        .collectList()
                        .timeout(Duration.ofSeconds(timeoutSeconds))
                        .map(evidences -> {
                            // 각 증거에 순위 부여
                            List<RankedEvidence> ranked = new ArrayList<>();
                            for (int i = 0; i < evidences.size(); i++) {
                                ranked.add(RankedEvidence.builder()
                                        .evidence(evidences.get(i))
                                        .rank(i + 1)
                                        .queryIndex(qIdx)
                                        .queryWeight(searchQuery.getWeight())
                                        .sourceId(source.getSourceId())
                                        .build());
                            }
                            return RankedResultSet.builder()
                                    .queryIndex(qIdx)
                                    .sourceId(source.getSourceId())
                                    .results(ranked)
                                    .build();
                        })
                        .onErrorResume(e -> {
                            log.debug("Search failed for query '{}' on source '{}': {}",
                                    searchQuery.getQuery(), source.getSourceId(), e.getMessage());
                            return Mono.just(RankedResultSet.builder()
                                    .queryIndex(qIdx)
                                    .sourceId(source.getSourceId())
                                    .results(List.of())
                                    .build());
                        })
                        .subscribeOn(Schedulers.boundedElastic());
                
                searchTasks.add(task);
            }
        }
        
        log.debug("Executing {} parallel search tasks", searchTasks.size());
        
        // 모든 검색 동시 실행
        return Flux.merge(searchTasks);
    }

    /**
     * RRF(Reciprocal Rank Fusion) 알고리즘으로 결과 융합
     * 
     * RRF Score = Σ (query_weight / (k + rank))
     */
    private List<SourceEvidence> fuseWithRRF(List<RankedResultSet> allResults, int queryCount) {
        // URL 또는 제목 기반으로 증거 그룹화
        Map<String, EvidenceScore> evidenceScores = new ConcurrentHashMap<>();
        
        for (RankedResultSet resultSet : allResults) {
            for (RankedEvidence ranked : resultSet.getResults()) {
                SourceEvidence evidence = ranked.getEvidence();
                
                // 고유 키 생성 (URL 우선, 없으면 제목 해시)
                String key = generateEvidenceKey(evidence);
                
                // RRF 점수 계산: weight / (k + rank)
                double rrfScore = ranked.getQueryWeight() / (rrfK + ranked.getRank());
                
                evidenceScores.compute(key, (k, existing) -> {
                    if (existing == null) {
                        return EvidenceScore.builder()
                                .evidence(evidence)
                                .rrfScore(rrfScore)
                                .appearanceCount(1)
                                .sources(new HashSet<>(Set.of(ranked.getSourceId())))
                                .queries(new HashSet<>(Set.of(ranked.getQueryIndex())))
                                .build();
                    } else {
                        // 점수 누적 및 메타데이터 업데이트
                        existing.setRrfScore(existing.getRrfScore() + rrfScore);
                        existing.setAppearanceCount(existing.getAppearanceCount() + 1);
                        existing.getSources().add(ranked.getSourceId());
                        existing.getQueries().add(ranked.getQueryIndex());
                        
                        // 더 상세한 정보가 있으면 업데이트
                        if (evidence.getExcerpt() != null && 
                            evidence.getExcerpt().length() > existing.getEvidence().getExcerpt().length()) {
                            existing.setEvidence(evidence);
                        }
                        return existing;
                    }
                });
            }
        }
        
        // RRF 점수로 정렬 및 상위 결과 추출
        return evidenceScores.values().stream()
                .sorted((a, b) -> Double.compare(b.getRrfScore(), a.getRrfScore()))
                .limit(maxResults)
                .map(scored -> {
                    SourceEvidence evidence = scored.getEvidence();
                    
                    // 융합 점수를 relevanceScore에 반영 (0-1 정규화)
                    double normalizedScore = Math.min(1.0, scored.getRrfScore() * 10);
                    evidence.setRelevanceScore(normalizedScore);
                    
                    // 다중 소스에서 발견된 경우 신뢰도 보너스
                    if (scored.getSources().size() > 1) {
                        double bonus = Math.min(0.2, scored.getSources().size() * 0.05);
                        evidence.setRelevanceScore(Math.min(1.0, normalizedScore + bonus));
                    }
                    
                    return evidence;
                })
                .toList();
    }

    /**
     * 증거의 고유 키 생성
     */
    private String generateEvidenceKey(SourceEvidence evidence) {
        // URL이 있으면 URL 사용
        if (evidence.getUrl() != null && !evidence.getUrl().isBlank()) {
            return evidence.getUrl().toLowerCase()
                    .replaceAll("https?://", "")
                    .replaceAll("www\\.", "")
                    .replaceAll("/$", "");
        }
        
        // 없으면 소스 + 발췌문 해시
        String content = evidence.getSourceName() + ":" + 
                (evidence.getExcerpt() != null ? evidence.getExcerpt().substring(0, Math.min(100, evidence.getExcerpt().length())) : "");
        return String.valueOf(content.hashCode());
    }

    // ============================================
    // DTO Classes
    // ============================================

    @Data
    @Builder
    public static class SearchQuery {
        private String query;
        private double weight;
        private String strategyType;
    }

    @Data
    @Builder
    public static class RankedEvidence {
        private SourceEvidence evidence;
        private int rank;
        private int queryIndex;
        private double queryWeight;
        private String sourceId;
    }

    @Data
    @Builder
    public static class RankedResultSet {
        private int queryIndex;
        private String sourceId;
        private List<RankedEvidence> results;
    }

    @Data
    @Builder
    public static class EvidenceScore {
        private SourceEvidence evidence;
        private double rrfScore;
        private int appearanceCount;
        private Set<String> sources;
        private Set<Integer> queries;
    }

    @Data
    @Builder
    public static class FusionResult {
        private String topic;
        private AnalyzedQuery analyzedQuery;
        private List<SourceEvidence> evidences;
        private int queryCount;
        private int sourceCount;
        private String fusionMethod;
    }
}
