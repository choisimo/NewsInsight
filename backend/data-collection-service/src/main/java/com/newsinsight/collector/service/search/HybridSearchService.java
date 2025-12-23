package com.newsinsight.collector.service.search;

import com.newsinsight.collector.entity.CollectedData;
import com.newsinsight.collector.repository.CollectedDataRepository;
import com.newsinsight.collector.service.search.HybridRankingService.QueryIntent;
import com.newsinsight.collector.service.search.HybridRankingService.RankedResult;
import com.newsinsight.collector.service.search.HybridRankingService.SearchCandidate;
import com.newsinsight.collector.service.search.VectorSearchService.ScoredDocument;
import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * 하이브리드 검색 서비스 - 키워드 + 시맨틱 + RRF 통합 검색
 * 
 * 검색 흐름:
 * 1. QueryIntentAnalyzer로 사용자 의도 분석
 * 2. 병렬로 키워드 검색(DB) + 시맨틱 검색(pgvector) 실행
 * 3. HybridRankingService의 RRF 알고리즘으로 결과 융합
 * 4. 의도 기반 부스팅 적용 후 최종 결과 반환
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class HybridSearchService {

    private final CollectedDataRepository collectedDataRepository;
    private final VectorSearchService vectorSearchService;
    private final EmbeddingService embeddingService;
    private final HybridRankingService hybridRankingService;
    private final QueryIntentAnalyzer queryIntentAnalyzer;

    @Value("${collector.hybrid-search.enabled:true}")
    private boolean enabled;

    @Value("${collector.hybrid-search.keyword-top-k:30}")
    private int keywordTopK;

    @Value("${collector.hybrid-search.semantic-top-k:20}")
    private int semanticTopK;

    @Value("${collector.hybrid-search.final-top-k:20}")
    private int finalTopK;

    @Value("${collector.hybrid-search.semantic-weight:1.0}")
    private double semanticWeight;

    @Value("${collector.hybrid-search.keyword-weight:1.0}")
    private double keywordWeight;

    /**
     * 하이브리드 검색을 실행합니다.
     * 키워드 검색과 시맨틱 검색을 병렬로 실행하고 RRF로 융합합니다.
     *
     * @param query 검색 쿼리
     * @param window 시간 범위 (1d, 7d, 30d)
     * @return RRF 점수순 정렬된 검색 결과
     */
    public Mono<HybridSearchResult> search(String query, String window) {
        return search(query, window, null, null);
    }

    /**
     * 하이브리드 검색을 실행합니다 (커스텀 날짜 범위 지원).
     * 키워드 검색과 시맨틱 검색을 병렬로 실행하고 RRF로 융합합니다.
     *
     * @param query 검색 쿼리
     * @param window 시간 범위 (1d, 7d, 30d) - startDate가 지정되면 무시됨
     * @param startDate 커스텀 시작 날짜 (ISO 8601 형식)
     * @param endDate 커스텀 종료 날짜 (ISO 8601 형식)
     * @return RRF 점수순 정렬된 검색 결과
     */
    public Mono<HybridSearchResult> search(String query, String window, String startDate, String endDate) {
        if (query == null || query.isBlank()) {
            return Mono.just(HybridSearchResult.empty());
        }

        log.info("Starting hybrid search: query='{}', window={}, startDate={}, endDate={}", 
                query, window, startDate, endDate);
        long startTime = System.currentTimeMillis();

        // 1. 의도 분석
        QueryIntent intent = queryIntentAnalyzer.analyzeIntent(query);
        log.debug("Query intent: type={}, confidence={}, keywords={}", 
                intent.getType(), intent.getConfidence(), intent.getKeywords());

        // Calculate date range
        LocalDateTime since = calculateSinceDate(window, intent, startDate);
        LocalDateTime until = calculateEndDate(endDate);
        
        log.debug("Effective date range: {} to {}", since, until != null ? until : "now");

        // 2. 병렬 검색 실행
        Mono<List<SearchCandidate>> keywordResults = searchKeyword(query, since, until)
                .subscribeOn(Schedulers.boundedElastic());
        
        Mono<List<SearchCandidate>> semanticResults = searchSemantic(query, since, until)
                .subscribeOn(Schedulers.boundedElastic());

        // 3. 결과 융합
        return Mono.zip(keywordResults, semanticResults)
                .map(tuple -> {
                    Map<String, List<SearchCandidate>> rankedLists = new HashMap<>();
                    
                    if (!tuple.getT1().isEmpty()) {
                        rankedLists.put("keyword", tuple.getT1());
                    }
                    if (!tuple.getT2().isEmpty()) {
                        rankedLists.put("semantic", tuple.getT2());
                    }

                    if (rankedLists.isEmpty()) {
                        log.info("Hybrid search found no results for query: '{}'", query);
                        return HybridSearchResult.empty();
                    }

                    // RRF 융합
                    List<RankedResult> fusedResults = hybridRankingService.fuseResults(rankedLists, intent);
                    
                    // 상위 N개만 반환
                    List<RankedResult> topResults = fusedResults.stream()
                            .limit(finalTopK)
                            .toList();

                    long elapsed = System.currentTimeMillis() - startTime;
                    log.info("Hybrid search completed: query='{}', keyword={}, semantic={}, fused={}, time={}ms",
                            query, tuple.getT1().size(), tuple.getT2().size(), topResults.size(), elapsed);

                    return HybridSearchResult.builder()
                            .query(query)
                            .intent(intent)
                            .results(topResults)
                            .keywordResultCount(tuple.getT1().size())
                            .semanticResultCount(tuple.getT2().size())
                            .totalResultCount(topResults.size())
                            .searchTimeMs(elapsed)
                            .build();
                })
                .onErrorResume(e -> {
                    log.error("Hybrid search failed for query '{}': {}", query, e.getMessage());
                    return Mono.just(HybridSearchResult.empty());
                });
    }

    /**
     * 키워드 기반 검색 (PostgreSQL LIKE/Full-text)
     */
    private Mono<List<SearchCandidate>> searchKeyword(String query, LocalDateTime since, LocalDateTime until) {
        return Mono.fromCallable(() -> {
            try {
                // Note: Native query already has ORDER BY clause, so use unsorted PageRequest
                PageRequest pageRequest = PageRequest.of(0, keywordTopK, Sort.unsorted());

                Page<CollectedData> page;
                if (until != null) {
                    // Use date range query
                    page = collectedDataRepository.searchByQueryAndDateRange(
                            query, since, until, pageRequest);
                } else {
                    // Use since-only query
                    page = collectedDataRepository.searchByQueryAndSince(
                            query, since, pageRequest);
                }

                return page.getContent().stream()
                        .map(data -> SearchCandidate.builder()
                                .id(data.getId() != null ? data.getId().toString() : UUID.randomUUID().toString())
                                .title(data.getTitle())
                                .snippet(buildSnippet(data.getContent(), 200))
                                .content(data.getContent())
                                .url(data.getUrl())
                                .publishedAt(data.getPublishedDate() != null 
                                        ? data.getPublishedDate().toString() 
                                        : null)
                                .originalScore(data.getQualityScore())
                                .metadata(Map.of(
                                        "sourceId", data.getSourceId() != null ? data.getSourceId() : 0L,
                                        "collectedAt", data.getCollectedAt() != null ? data.getCollectedAt().toString() : ""
                                ))
                                .build())
                        .collect(Collectors.toList());
            } catch (Exception e) {
                log.error("Keyword search failed: {}", e.getMessage());
                return List.of();
            }
        });
    }

    /**
     * 시맨틱(벡터) 검색 (pgvector)
     */
    private Mono<List<SearchCandidate>> searchSemantic(String query, LocalDateTime since, LocalDateTime until) {
        if (!vectorSearchService.isAvailable()) {
            log.debug("Vector search not available, skipping semantic search");
            return Mono.just(List.of());
        }

        return vectorSearchService.searchSimilar(query, semanticTopK)
                .map(scoredDocs -> {
                    if (scoredDocs == null || scoredDocs.isEmpty()) {
                        return List.<SearchCandidate>of();
                    }

                    // ID로 전체 데이터 조회
                    List<Long> docIds = scoredDocs.stream()
                            .map(ScoredDocument::id)
                            .filter(Objects::nonNull)
                            .toList();

                    if (docIds.isEmpty()) {
                        return List.<SearchCandidate>of();
                    }

                    Map<Long, CollectedData> dataMap = collectedDataRepository.findAllById(docIds)
                            .stream()
                            .collect(Collectors.toMap(CollectedData::getId, d -> d));

                    // 유사도 점수 매핑
                    Map<Long, Double> similarityMap = scoredDocs.stream()
                            .collect(Collectors.toMap(ScoredDocument::id, ScoredDocument::similarity));

                    return scoredDocs.stream()
                            .filter(doc -> dataMap.containsKey(doc.id()))
                            .filter(doc -> {
                                // 시간 필터링 적용 (since ~ until)
                                CollectedData data = dataMap.get(doc.id());
                                LocalDateTime publishedDate = data.getPublishedDate();
                                if (publishedDate == null) {
                                    publishedDate = data.getCollectedAt();
                                }
                                if (publishedDate == null) {
                                    return true;  // No date info, include by default
                                }
                                // Check since
                                if (publishedDate.isBefore(since)) {
                                    return false;
                                }
                                // Check until (if specified)
                                if (until != null && publishedDate.isAfter(until)) {
                                    return false;
                                }
                                return true;
                            })
                            .map(doc -> {
                                CollectedData data = dataMap.get(doc.id());
                                return SearchCandidate.builder()
                                        .id(data.getId().toString())
                                        .title(data.getTitle())
                                        .snippet(buildSnippet(data.getContent(), 200))
                                        .content(data.getContent())
                                        .url(data.getUrl())
                                        .publishedAt(data.getPublishedDate() != null 
                                                ? data.getPublishedDate().toString() 
                                                : null)
                                        .originalScore(similarityMap.get(doc.id()))
                                        .metadata(Map.of(
                                                "similarity", similarityMap.get(doc.id()),
                                                "sourceId", data.getSourceId() != null ? data.getSourceId() : 0L
                                        ))
                                        .build();
                            })
                            .collect(Collectors.toList());
                })
                .onErrorResume(e -> {
                    log.error("Semantic search failed: {}", e.getMessage());
                    return Mono.just(List.of());
                });
    }

    /**
     * 실시간 스트리밍 하이브리드 검색
     * UnifiedSearchService와 통합하여 실시간 결과 스트리밍에 사용됩니다.
     *
     * @param query 검색 쿼리
     * @param window 시간 범위
     * @return 검색 결과 스트림
     */
    public Flux<RankedResult> searchStream(String query, String window) {
        return search(query, window)
                .flatMapMany(result -> Flux.fromIterable(result.getResults()));
    }

    /**
     * 하이브리드 검색이 활성화되어 있는지 확인합니다.
     */
    public boolean isEnabled() {
        return enabled;
    }

    /**
     * 시맨틱 검색이 가능한지 확인합니다.
     */
    public boolean isSemanticSearchAvailable() {
        return vectorSearchService.isAvailable() && embeddingService.isEnabled();
    }

    /**
     * 의도를 고려한 시간 범위 계산 (커스텀 날짜 지원)
     */
    private LocalDateTime calculateSinceDate(String window, QueryIntent intent, String startDate) {
        // Custom startDate takes priority
        if (startDate != null && !startDate.isBlank()) {
            try {
                return LocalDateTime.parse(startDate, DateTimeFormatter.ISO_DATE_TIME);
            } catch (DateTimeParseException e) {
                log.warn("Invalid startDate format: '{}', falling back to window", startDate);
            }
        }
        
        return calculateSinceDate(window, intent);
    }

    /**
     * 의도를 고려한 시간 범위 계산
     */
    private LocalDateTime calculateSinceDate(String window, QueryIntent intent) {
        LocalDateTime now = LocalDateTime.now();
        
        // 의도에서 추출된 시간 범위가 있으면 우선 사용
        if (intent != null && intent.getTimeRange() != null) {
            return switch (intent.getTimeRange()) {
                case "1d" -> now.minusDays(1);
                case "2d" -> now.minusDays(2);
                case "7d" -> now.minusDays(7);
                case "14d" -> now.minusDays(14);
                case "30d" -> now.minusDays(30);
                default -> calculateFromWindow(window, now);
            };
        }
        
        return calculateFromWindow(window, now);
    }

    /**
     * Calculate end date from custom endDate string
     */
    private LocalDateTime calculateEndDate(String endDate) {
        if (endDate != null && !endDate.isBlank()) {
            try {
                return LocalDateTime.parse(endDate, DateTimeFormatter.ISO_DATE_TIME);
            } catch (DateTimeParseException e) {
                log.warn("Invalid endDate format: '{}', using current time", endDate);
            }
        }
        return null;  // null means no upper limit (i.e., "now")
    }

    private LocalDateTime calculateFromWindow(String window, LocalDateTime now) {
        return switch (window != null ? window : "7d") {
            case "1h" -> now.minusHours(1);
            case "1d" -> now.minusDays(1);
            case "3d" -> now.minusDays(3);
            case "14d" -> now.minusDays(14);
            case "30d" -> now.minusDays(30);
            case "90d" -> now.minusDays(90);
            case "180d" -> now.minusDays(180);
            case "365d" -> now.minusDays(365);
            case "all" -> LocalDateTime.of(2000, 1, 1, 0, 0);
            default -> now.minusDays(7);
        };
    }

    /**
     * 텍스트에서 스니펫 생성
     */
    private String buildSnippet(String content, int maxLength) {
        if (content == null || content.isBlank()) {
            return null;
        }

        // HTML 태그 제거
        String text = content.replaceAll("<[^>]*>", " ")
                .replaceAll("\\s+", " ")
                .trim();

        if (text.length() <= maxLength) {
            return text;
        }

        // 단어 경계에서 자르기
        int cut = maxLength;
        for (int i = maxLength - 1; i > maxLength * 0.6; i--) {
            if (Character.isWhitespace(text.charAt(i))) {
                cut = i;
                break;
            }
        }

        return text.substring(0, cut).trim() + "...";
    }

    // ==================== Inner Classes ====================

    /**
     * 하이브리드 검색 결과
     */
    @Data
    @Builder
    public static class HybridSearchResult {
        private String query;
        private QueryIntent intent;
        private List<RankedResult> results;
        private int keywordResultCount;
        private int semanticResultCount;
        private int totalResultCount;
        private long searchTimeMs;

        public static HybridSearchResult empty() {
            return HybridSearchResult.builder()
                    .results(List.of())
                    .keywordResultCount(0)
                    .semanticResultCount(0)
                    .totalResultCount(0)
                    .searchTimeMs(0)
                    .build();
        }
    }
}
