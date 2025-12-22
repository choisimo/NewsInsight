package com.newsinsight.collector.service.factcheck;

import com.newsinsight.collector.service.FactVerificationService.SourceEvidence;
import com.newsinsight.collector.service.search.AdvancedIntentAnalyzer;
import com.newsinsight.collector.service.search.AdvancedIntentAnalyzer.AnalyzedQuery;
import com.newsinsight.collector.service.search.AdvancedIntentAnalyzer.FallbackStrategy;
import com.newsinsight.collector.service.search.VectorSearchService;
import com.newsinsight.collector.service.validation.EvidenceValidator;
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
    private final StatisticalWeightCalculator weightCalculator;
    private final EvidenceValidator evidenceValidator;
    private final LlmQueryExpansionService llmQueryExpansionService;
    private final VectorSearchService vectorSearchService;
    private final SemanticRelevanceFilter semanticRelevanceFilter;

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

    @Value("${collector.fact-check.rrf.url-validation-enabled:true}")
    private boolean urlValidationEnabled; // URL 실존 여부 검증 활성화

    @Value("${collector.fact-check.rrf.llm-expansion-enabled:true}")
    private boolean llmExpansionEnabled; // LLM 기반 쿼리 확장 활성화
    
    @Value("${collector.fact-check.rrf.semantic-filter-enabled:true}")
    private boolean semanticFilterEnabled; // 시맨틱 필터링 활성화

    /**
     * 주어진 주제에 대해 다중 쿼리 병렬 검색 및 RRF 융합 수행
     *
     * @param topic 검색 주제
     * @param language 언어 코드 (ko, en)
     * @return 융합된 증거 목록
     */
    public Mono<FusionResult> searchAndFuse(String topic, String language) {
        log.info("Starting RRF-based multi-query search for topic: {}", topic);
        
        // 1. 의도 분석 및 쿼리 확장 (동기 - 빠름)
        AnalyzedQuery analyzedQuery = intentAnalyzer.analyzeQuery(topic);
        
        // 2. 활성화된 소스 목록 (동기 - 빠름)
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
        
        // 3. 검색 쿼리 목록 생성 (비동기 - LLM 호출 포함)
        return buildSearchQueriesAsync(analyzedQuery, topic)
                .timeout(Duration.ofSeconds(35)) // LLM timeout + margin
                .onErrorResume(e -> {
                    log.warn("Async query building failed, using fallback: {}", e.getMessage());
                    return Mono.just(buildSearchQueriesFallback(analyzedQuery, topic));
                })
                .flatMap(searchQueries -> {
                    log.info("Generated {} search queries for parallel execution", searchQueries.size());
                    
                    // 4. 병렬 검색 실행
                    return executeParallelSearch(searchQueries, activeSources, language)
                            .collectList()
                            .flatMap(allResults -> {
                    // 5. RRF 융합
                    List<SourceEvidence> fused = fuseWithRRF(allResults, searchQueries.size());
                    
                    log.info("RRF fusion completed: {} queries × {} sources → {} unique evidences",
                            searchQueries.size(), activeSources.size(), fused.size());
                    
                    // 6. 시맨틱 필터링 (의미적으로 관련 없는 결과 제거)
                    Mono<List<SourceEvidence>> filteredMono;
                    if (semanticFilterEnabled && semanticRelevanceFilter != null && semanticRelevanceFilter.isEnabled()) {
                        filteredMono = semanticRelevanceFilter.filterBySemanticRelevance(topic, fused)
                                .doOnNext(filtered -> {
                                    int removed = fused.size() - filtered.size();
                                    if (removed > 0) {
                                        log.info("Semantic filter removed {} irrelevant evidences", removed);
                                    }
                                });
                    } else {
                        filteredMono = Mono.just(fused);
                    }
                    
                    // 7. URL 실존 여부 검증 및 필터링
                    return filteredMono.flatMap(semanticFiltered -> {
                        if (urlValidationEnabled && evidenceValidator != null) {
                            return evidenceValidator.filterValidEvidences(semanticFiltered)
                                    .map(validatedEvidences -> {
                                        int filtered = semanticFiltered.size() - validatedEvidences.size();
                                        if (filtered > 0) {
                                            log.info("URL validation filtered out {} invalid evidences (hallucinations, dead links, etc.)",
                                                    filtered);
                                        }
                                        return FusionResult.builder()
                                                .topic(topic)
                                                .analyzedQuery(analyzedQuery)
                                                .evidences(validatedEvidences)
                                                .queryCount(searchQueries.size())
                                                .sourceCount(activeSources.size())
                                                .fusionMethod("RRF (k=" + rrfK + ") + Semantic Filter + URL Validation")
                                                .build();
                                    });
                        }
                        
                        String method = semanticFilterEnabled && semanticRelevanceFilter != null && semanticRelevanceFilter.isEnabled()
                                ? "RRF (k=" + rrfK + ") + Semantic Filter"
                                : "RRF (k=" + rrfK + ")";
                        
                        return Mono.just(FusionResult.builder()
                                .topic(topic)
                                .analyzedQuery(analyzedQuery)
                                .evidences(semanticFiltered)
                                .queryCount(searchQueries.size())
                                .sourceCount(activeSources.size())
                                .fusionMethod(method)
                                .build());
                    });
                });
                });
    }
    
    /**
     * 비동기 검색 쿼리 목록 생성 (LLM 기반 동적 확장)
     * .block() 호출을 피하고 완전한 리액티브 체인을 사용합니다.
     */
    private Mono<List<SearchQuery>> buildSearchQueriesAsync(AnalyzedQuery analyzed, String originalTopic) {
        List<SearchQuery> queries = new ArrayList<>();
        Set<String> seenQueries = new HashSet<>();
        
        // 1. 원본 쿼리 (최고 우선순위)
        queries.add(SearchQuery.builder()
                .query(originalTopic)
                .weight(1.0)
                .strategyType("ORIGINAL")
                .build());
        seenQueries.add(originalTopic.toLowerCase().trim());
        
        // 2. LLM 기반 학술 쿼리 확장 (비동기)
        if (llmExpansionEnabled && llmQueryExpansionService != null) {
            return llmQueryExpansionService
                    .expandForAcademicSearch(originalTopic, analyzed.getKeywords(), analyzed.getLanguage())
                    .map(academicQueries -> {
                        if (academicQueries != null && !academicQueries.isEmpty()) {
                            log.info("LLM expanded '{}' into {} academic queries", originalTopic, academicQueries.size());
                            
                            double weight = 0.95;
                            for (String academicQuery : academicQueries) {
                                String normalized = academicQuery.toLowerCase().trim();
                                if (!seenQueries.contains(normalized) && !academicQuery.isBlank()) {
                                    queries.add(SearchQuery.builder()
                                            .query(academicQuery)
                                            .weight(weight)
                                            .strategyType("LLM_ACADEMIC")
                                            .build());
                                    seenQueries.add(normalized);
                                    weight -= 0.05;
                                }
                                if (queries.size() >= maxQueries) break;
                            }
                        }
                        // 폴백 전략 추가
                        addFallbackQueries(analyzed, queries, seenQueries);
                        return queries;
                    })
                    .onErrorResume(e -> {
                        log.warn("LLM query expansion failed, using fallback: {}", e.getMessage());
                        return Mono.just(buildSearchQueriesFallback(analyzed, originalTopic));
                    });
        }
        
        // LLM 비활성화 시 폴백 전략만 사용
        addFallbackQueries(analyzed, queries, seenQueries);
        return Mono.just(queries);
    }
    
    /**
     * 폴백 검색 쿼리 목록 생성 (동기 - LLM 없이)
     */
    private List<SearchQuery> buildSearchQueriesFallback(AnalyzedQuery analyzed, String originalTopic) {
        List<SearchQuery> queries = new ArrayList<>();
        Set<String> seenQueries = new HashSet<>();
        
        // 원본 쿼리
        queries.add(SearchQuery.builder()
                .query(originalTopic)
                .weight(1.0)
                .strategyType("ORIGINAL")
                .build());
        seenQueries.add(originalTopic.toLowerCase().trim());
        
        // 폴백 전략 추가
        addFallbackQueries(analyzed, queries, seenQueries);
        return queries;
    }
    
    /**
     * 폴백 전략에서 쿼리 추출하여 추가
     */
    private void addFallbackQueries(AnalyzedQuery analyzed, List<SearchQuery> queries, Set<String> seenQueries) {
        if (analyzed.getFallbackStrategies() != null && queries.size() < maxQueries) {
            for (FallbackStrategy strategy : analyzed.getFallbackStrategies()) {
                String query = strategy.getQuery();
                String normalizedQuery = query.toLowerCase().trim();
                
                if (!seenQueries.contains(normalizedQuery) && !query.isBlank()) {
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
        
        // 확장 쿼리 추가
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
        
        // 주요 키워드 단독 검색 추가
        if (analyzed.getPrimaryKeyword() != null && 
            !seenQueries.contains(analyzed.getPrimaryKeyword().toLowerCase().trim()) &&
            queries.size() < maxQueries) {
            queries.add(SearchQuery.builder()
                    .query(analyzed.getPrimaryKeyword())
                    .weight(0.7)
                    .strategyType("PRIMARY_KEYWORD")
                    .build());
        }
    }

    /**
     * @deprecated Use buildSearchQueriesAsync instead - this method has blocking calls.
     * Kept for reference only.
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
        
        // 2. LLM 기반 학술 쿼리 확장 (하드코딩 사전 대체)
        if (llmExpansionEnabled && llmQueryExpansionService != null) {
            try {
                List<String> academicQueries = llmQueryExpansionService
                        .expandForAcademicSearch(originalTopic, analyzed.getKeywords(), analyzed.getLanguage())
                        .block(Duration.ofSeconds(30));
                
                if (academicQueries != null && !academicQueries.isEmpty()) {
                    log.info("LLM expanded '{}' into {} academic queries", originalTopic, academicQueries.size());
                    
                    double weight = 0.95;
                    for (String academicQuery : academicQueries) {
                        String normalized = academicQuery.toLowerCase().trim();
                        if (!seenQueries.contains(normalized) && !academicQuery.isBlank()) {
                            queries.add(SearchQuery.builder()
                                    .query(academicQuery)
                                    .weight(weight)
                                    .strategyType("LLM_ACADEMIC")
                                    .build());
                            seenQueries.add(normalized);
                            weight -= 0.05; // 점진적 가중치 감소
                        }
                        
                        if (queries.size() >= maxQueries) break;
                    }
                }
            } catch (Exception e) {
                log.warn("LLM query expansion failed, falling back to rule-based: {}", e.getMessage());
                // LLM 실패 시 폴백 전략 사용
            }
        }
        
        // 3. 폴백 전략에서 쿼리 추출 (LLM 실패 시 또는 추가 쿼리)
        if (analyzed.getFallbackStrategies() != null && queries.size() < maxQueries) {
            for (FallbackStrategy strategy : analyzed.getFallbackStrategies()) {
                String query = strategy.getQuery();
                String normalizedQuery = query.toLowerCase().trim();
                
                if (!seenQueries.contains(normalizedQuery) && !query.isBlank()) {
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
        
        // 5. 주요 키워드 단독 검색 추가
        if (analyzed.getPrimaryKeyword() != null && 
            !seenQueries.contains(analyzed.getPrimaryKeyword().toLowerCase().trim()) &&
            queries.size() < maxQueries) {
            queries.add(SearchQuery.builder()
                    .query(analyzed.getPrimaryKeyword())
                    .weight(0.7)
                    .strategyType("PRIMARY_KEYWORD")
                    .build());
        }

        return queries;
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
     * 통계적 가중치 기반 RRF Score = Σ (query_weight × source_weight / (k + rank))
     * + 시맨틱 필터링으로 의미적으로 관련 없는 결과 제거
     */
    private List<SourceEvidence> fuseWithRRF(List<RankedResultSet> allResults, int queryCount) {
        // 1. 소스별 증거 그룹화 (통계적 가중치 계산용)
        Map<String, List<SourceEvidence>> evidencesBySource = new HashMap<>();
        for (RankedResultSet resultSet : allResults) {
            String sourceId = resultSet.getSourceId();
            List<SourceEvidence> sourceEvidences = resultSet.getResults().stream()
                    .map(RankedEvidence::getEvidence)
                    .toList();
            
            evidencesBySource.computeIfAbsent(sourceId, k -> new ArrayList<>())
                    .addAll(sourceEvidences);
        }
        
        // 2. 통계적 가중치 계산 (동적 가중치)
        Map<String, Double> sourceWeights = weightCalculator.calculateSourceWeights(evidencesBySource);
        
        log.info("Applied statistical weights for {} sources", sourceWeights.size());
        
        // 3. URL 또는 제목 기반으로 증거 그룹화 및 RRF 점수 계산
        Map<String, EvidenceScore> evidenceScores = new ConcurrentHashMap<>();
        
        for (RankedResultSet resultSet : allResults) {
            String sourceId = resultSet.getSourceId();
            double sourceWeight = sourceWeights.getOrDefault(sourceId, 1.0);
            
            for (RankedEvidence ranked : resultSet.getResults()) {
                SourceEvidence evidence = ranked.getEvidence();
                
                // 고유 키 생성 (URL 우선, 없으면 제목 해시)
                String key = generateEvidenceKey(evidence);
                
                // 통계적 가중치 기반 RRF 점수 계산: query_weight × source_weight / (k + rank)
                double rrfScore = ranked.getQueryWeight() * sourceWeight / (rrfK + ranked.getRank());
                
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
