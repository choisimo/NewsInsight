package com.newsinsight.collector.service;

import com.newsinsight.collector.dto.SearchHistoryMessage;
import com.newsinsight.collector.client.Crawl4aiClient;
import com.newsinsight.collector.client.PerplexityClient;
import com.newsinsight.collector.client.OpenAICompatibleClient;
import com.newsinsight.collector.client.AIDoveClient;
import com.newsinsight.collector.dto.ArticleDto;
import com.newsinsight.collector.dto.ArticleWithAnalysisDto;
import com.newsinsight.collector.entity.CollectedData;
import com.newsinsight.collector.entity.DataSource;
import com.newsinsight.collector.entity.analysis.ArticleAnalysis;
import com.newsinsight.collector.entity.analysis.ArticleDiscussion;
import com.newsinsight.collector.entity.search.SearchType;
import com.newsinsight.collector.repository.ArticleAnalysisRepository;
import com.newsinsight.collector.repository.ArticleDiscussionRepository;
import com.newsinsight.collector.repository.CollectedDataRepository;
import com.newsinsight.collector.repository.DataSourceRepository;
import com.newsinsight.collector.service.autocrawl.AutoCrawlIntegrationService;
import com.newsinsight.collector.service.search.AdvancedIntentAnalyzer;
import com.newsinsight.collector.service.search.AdvancedIntentAnalyzer.AnalyzedQuery;
import com.newsinsight.collector.service.search.AdvancedIntentAnalyzer.FallbackStrategy;
import com.newsinsight.collector.service.search.AdvancedIntentAnalyzer.RealtimeAnalysisResult;
import com.newsinsight.collector.service.search.HybridSearchService;
import com.newsinsight.collector.service.factcheck.RealtimeSearchSource;
import com.newsinsight.collector.service.FactVerificationService.SourceEvidence;
import com.newsinsight.collector.service.search.HybridRankingService.RankedResult;
import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.jsoup.Jsoup;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Unified Search Service - 병렬 검색 통합 서비스
 * 
 * DB, 웹 크롤링, AI 검색을 병렬로 실행하고 결과가 나오는 대로 스트리밍합니다.
 * 특정 기술/API 이름을 노출하지 않고 통합된 검색 경험을 제공합니다.
 * 
 * AutoCrawl Integration: 검색 결과에서 발견된 URL을 자동 크롤링 큐에 추가합니다.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class UnifiedSearchService {

    private final CollectedDataRepository collectedDataRepository;
    private final DataSourceRepository dataSourceRepository;
    private final ArticleAnalysisRepository articleAnalysisRepository;
    private final ArticleDiscussionRepository articleDiscussionRepository;
    private final PerplexityClient perplexityClient;
    private final OpenAICompatibleClient openAICompatibleClient;
    private final AIDoveClient aiDoveClient;
    private final Crawl4aiClient crawl4aiClient;
    private final CrawlSearchService crawlSearchService;
    private final UnifiedSearchEventService unifiedSearchEventService;
    private final HybridSearchService hybridSearchService;
    private final AutoCrawlIntegrationService autoCrawlIntegrationService;
    private final SearchHistoryService searchHistoryService;
    private final AdvancedIntentAnalyzer advancedIntentAnalyzer;
    private final SearchCacheService searchCacheService;
    private final RealtimeSearchSource realtimeSearchSource;

    @Value("${autocrawl.enabled:true}")
    private boolean autoCrawlEnabled;

    @Value("${search.fallback.max-attempts:3}")
    private int maxFallbackAttempts;

    private static final int SNIPPET_MAX_LENGTH = 200;
    private static final int MAX_DB_RESULTS = 20;
    
    // Deduplication settings
    private static final double TITLE_SIMILARITY_THRESHOLD = 0.85;
    private static final double CONTENT_SIMILARITY_THRESHOLD = 0.90;

    private static final String AI_SUMMARY_KEY_CONTENT = "content";
    private static final String AI_SUMMARY_KEY_SUMMARY = "summary";
    private static final String AI_SUMMARY_KEY_GENERATED_AT = "generatedAt";
    
    // Thread-safe deduplication tracker for streaming results
    private final java.util.concurrent.ConcurrentHashMap<String, SearchResult> seenResults = 
            new java.util.concurrent.ConcurrentHashMap<>();

    // ============================================
    // DTO Classes
    // ============================================

    @Data
    @Builder
    public static class SearchResult {
        private String id;
        private String source;          // "database", "web", "ai"
        private String sourceLabel;     // 사용자에게 보여줄 출처명
        private String title;
        private String snippet;         // UI 표시용 요약 (200자)
        private String content;         // 전체 본문 (export/저장용)
        private String url;
        private String publishedAt;
        private Double relevanceScore;
        private String category;        // 주제 분류
        
        // ========== 분석 결과 (optional) ==========
        private Boolean analyzed;           // 분석 완료 여부
        private String analysisStatus;      // pending, partial, complete
        
        // 신뢰도
        private Double reliabilityScore;    // 0-100
        private String reliabilityGrade;    // high, medium, low
        private String reliabilityColor;    // green, yellow, red
        
        // 감정 분석
        private String sentimentLabel;      // positive, negative, neutral
        private Double sentimentScore;      // -1 ~ 1
        
        // 편향도
        private String biasLabel;           // left, right, center
        private Double biasScore;           // -1 ~ 1
        
        // 팩트체크
        private String factcheckStatus;     // verified, suspicious, unverified
        private String misinfoRisk;         // low, mid, high
        
        // 위험 태그
        private List<String> riskTags;
        
        // 토픽
        private List<String> topics;
        
        // 여론 정보
        private Boolean hasDiscussion;
        private Integer totalCommentCount;
        private String discussionSentiment;
    }

    @Data
    @Builder
    public static class SearchEvent {
        private String eventType;       // "status", "result", "complete", "error"
        private String source;          // 어느 소스에서 온 이벤트인지
        private String message;         // 상태 메시지
        private SearchResult result;    // 검색 결과 (result 타입일 때)
        private Integer totalCount;     // 총 결과 수 (complete 타입일 때)
    }

    @Data
    @Builder
    public static class AISummary {
        private String summary;
        private List<String> keyPoints;
        private String sentiment;
    }

    // ============================================
    // Deduplication Methods
    // ============================================
    
    /**
     * URL 정규화 - 쿼리 파라미터 제거, 프로토콜 통일
     */
    private String normalizeUrl(String url) {
        if (url == null || url.isBlank()) {
            return "";
        }
        try {
            // Remove protocol, www, trailing slash, query params, and fragments
            String normalized = url.toLowerCase()
                    .replaceFirst("^https?://", "")
                    .replaceFirst("^www\\.", "")
                    .replaceAll("\\?.*$", "")
                    .replaceAll("#.*$", "")
                    .replaceAll("/$", "");
            return normalized;
        } catch (Exception e) {
            return url.toLowerCase();
        }
    }
    
    /**
     * 제목 유사도 계산 (Jaccard similarity)
     */
    private double calculateTitleSimilarity(String title1, String title2) {
        if (title1 == null || title2 == null) {
            return 0.0;
        }
        
        // 간단한 토큰화 및 정규화
        java.util.Set<String> tokens1 = java.util.Arrays.stream(
                title1.toLowerCase().replaceAll("[^가-힣a-z0-9\\s]", " ").split("\\s+"))
                .filter(s -> s.length() >= 2)
                .collect(Collectors.toSet());
        
        java.util.Set<String> tokens2 = java.util.Arrays.stream(
                title2.toLowerCase().replaceAll("[^가-힣a-z0-9\\s]", " ").split("\\s+"))
                .filter(s -> s.length() >= 2)
                .collect(Collectors.toSet());
        
        if (tokens1.isEmpty() || tokens2.isEmpty()) {
            return 0.0;
        }
        
        // Jaccard similarity
        java.util.Set<String> intersection = new java.util.HashSet<>(tokens1);
        intersection.retainAll(tokens2);
        
        java.util.Set<String> union = new java.util.HashSet<>(tokens1);
        union.addAll(tokens2);
        
        return (double) intersection.size() / union.size();
    }
    
    /**
     * 중복 검사 - URL 기반 + 제목 유사도 기반
     */
    private boolean isDuplicate(SearchResult newResult, Map<String, SearchResult> existingResults) {
        // 1. URL 기반 중복 체크 (정확한 매칭)
        String normalizedUrl = normalizeUrl(newResult.getUrl());
        if (!normalizedUrl.isEmpty()) {
            for (SearchResult existing : existingResults.values()) {
                if (normalizedUrl.equals(normalizeUrl(existing.getUrl()))) {
                    log.debug("Duplicate detected by URL: {}", normalizedUrl);
                    return true;
                }
            }
        }
        
        // 2. 제목 유사도 기반 중복 체크 (유사한 기사 필터링)
        String newTitle = newResult.getTitle();
        if (newTitle != null && !newTitle.isBlank()) {
            for (SearchResult existing : existingResults.values()) {
                double similarity = calculateTitleSimilarity(newTitle, existing.getTitle());
                if (similarity >= TITLE_SIMILARITY_THRESHOLD) {
                    log.debug("Duplicate detected by title similarity ({:.2f}): '{}' ~ '{}'", 
                            similarity, newTitle, existing.getTitle());
                    return true;
                }
            }
        }
        
        return false;
    }
    
    /**
     * 검색 세션용 중복 제거 트래커 초기화
     */
    private Map<String, SearchResult> createDeduplicationTracker() {
        return new java.util.concurrent.ConcurrentHashMap<>();
    }
    
    /**
     * 중복이 아닌 경우에만 결과 추가하고 true 반환
     */
    private boolean addIfNotDuplicate(SearchResult result, Map<String, SearchResult> tracker) {
        if (isDuplicate(result, tracker)) {
            return false;
        }
        
        // 결과 ID 또는 URL을 키로 사용
        String key = result.getId() != null ? result.getId() : 
                    (result.getUrl() != null ? normalizeUrl(result.getUrl()) : 
                    String.valueOf(System.nanoTime()));
        tracker.put(key, result);
        return true;
    }

    // ============================================
    // Main Search Method - Parallel Execution
    // ============================================

    /**
     * 병렬 통합 검색 - 모든 소스에서 동시에 검색하고 결과를 스트리밍
     *
     * @param query 검색 쿼리
     * @param window 시간 범위 (1d, 7d, 30d)
     * @return 검색 이벤트 스트림
     */
    public Flux<SearchEvent> searchParallel(String query, String window) {
        if (query == null || query.isBlank()) {
            return Flux.just(SearchEvent.builder()
                    .eventType("error")
                    .message("검색어를 입력해주세요.")
                    .build());
        }

        log.info("Starting parallel search for query: '{}', window: {}", query, window);

        // Advanced Intent Analysis
        AnalyzedQuery analyzedQuery = advancedIntentAnalyzer.analyzeQuery(query);
        log.info("Query analyzed: keywords={}, primary='{}', intent={}, confidence={}, strategies={}",
                analyzedQuery.getKeywords().size(),
                analyzedQuery.getPrimaryKeyword(),
                analyzedQuery.getIntentType(),
                analyzedQuery.getConfidence(),
                analyzedQuery.getFallbackStrategies().size());

        // Collect discovered URLs for AutoCrawl integration
        List<String> discoveredUrls = new ArrayList<>();
        
        // Deduplication tracker for this search session
        Map<String, SearchResult> deduplicationTracker = createDeduplicationTracker();
        java.util.concurrent.atomic.AtomicInteger duplicateCount = new java.util.concurrent.atomic.AtomicInteger(0);

        return Flux.merge(
                // 1. 데이터베이스 검색 (가장 빠름)
                searchDatabase(query, window)
                        .subscribeOn(Schedulers.boundedElastic()),

                // 2. 웹 크롤링 검색
                searchWeb(query, window)
                        .subscribeOn(Schedulers.boundedElastic()),

                // 3. AI 기반 실시간 분석
                searchAI(query, window)
                        .subscribeOn(Schedulers.boundedElastic())
        )
        // Filter duplicates before emitting results
        .filter(event -> {
            if (!"result".equals(event.getEventType()) || event.getResult() == null) {
                return true; // Pass through non-result events
            }
            
            SearchResult result = event.getResult();
            if (addIfNotDuplicate(result, deduplicationTracker)) {
                return true; // Unique result, pass through
            } else {
                duplicateCount.incrementAndGet();
                log.debug("Filtered duplicate result: '{}' from {}", 
                        result.getTitle(), result.getSource());
                return false; // Duplicate, filter out
            }
        })
        .doOnNext(event -> {
            // Collect URLs from search results for AutoCrawl
            if ("result".equals(event.getEventType()) && event.getResult() != null 
                    && event.getResult().getUrl() != null) {
                synchronized (discoveredUrls) {
                    discoveredUrls.add(event.getResult().getUrl());
                }
            }
        })
        .doOnComplete(() -> {
            log.info("Parallel search completed for query: '{}', discovered {} URLs, filtered {} duplicates", 
                    query, discoveredUrls.size(), duplicateCount.get());
            
            // Notify AutoCrawl of discovered URLs
            if (autoCrawlEnabled && !discoveredUrls.isEmpty()) {
                autoCrawlIntegrationService.onSearchCompleted(query, discoveredUrls);
            }
        })
        .doOnError(e -> log.error("Parallel search error for query '{}': {}", query, e.getMessage()));
    }

    /**
     * 결과 보장 검색 - 폴백 전략을 사용하여 최소 결과 보장
     * Intent analysis를 사용하여 더 높은 확률로 의도에 맞는 결과 반환
     *
     * @param query 검색 쿼리
     * @param window 시간 범위
     * @return 검색 이벤트 스트림 (결과 보장)
     */
    public Flux<SearchEvent> searchWithGuaranteedResults(String query, String window) {
        if (query == null || query.isBlank()) {
            return Flux.just(SearchEvent.builder()
                    .eventType("error")
                    .message("검색어를 입력해주세요.")
                    .build());
        }

        // Advanced Intent Analysis
        AnalyzedQuery analyzedQuery = advancedIntentAnalyzer.analyzeQuery(query);
        
        return searchWithFallback(analyzedQuery, window, 0, new ArrayList<>());
    }

    /**
     * 폴백 전략을 사용한 검색 (재귀적)
     */
    private Flux<SearchEvent> searchWithFallback(
            AnalyzedQuery analyzedQuery, 
            String window, 
            int attemptIndex,
            List<SearchResult> accumulatedResults) {

        String currentQuery = attemptIndex == 0 
                ? analyzedQuery.getOriginalQuery()
                : analyzedQuery.getFallbackStrategies().size() > attemptIndex - 1
                        ? analyzedQuery.getFallbackStrategies().get(attemptIndex - 1).getQuery()
                        : analyzedQuery.getPrimaryKeyword();

        String strategyDescription = attemptIndex == 0 
                ? "원본 쿼리"
                : attemptIndex <= analyzedQuery.getFallbackStrategies().size()
                        ? analyzedQuery.getFallbackStrategies().get(attemptIndex - 1).getDescription()
                        : "주요 키워드";

        log.info("Search attempt {}/{}: query='{}', strategy='{}'", 
                attemptIndex + 1, maxFallbackAttempts, currentQuery, strategyDescription);

        return Flux.create(sink -> {
            // 현재 시도에 대한 상태 이벤트
            sink.next(SearchEvent.builder()
                    .eventType("status")
                    .source("system")
                    .message("검색 전략 " + (attemptIndex + 1) + ": " + strategyDescription)
                    .build());

            // DB 검색 실행
            List<SearchResult> currentResults = new ArrayList<>();
            
            searchDatabaseSync(currentQuery, window).forEach(result -> {
                currentResults.add(result);
                sink.next(SearchEvent.builder()
                        .eventType("result")
                        .source("database")
                        .result(result)
                        .build());
            });

            // 결과 누적
            accumulatedResults.addAll(currentResults);

            // 충분한 결과가 있거나 최대 시도 횟수에 도달한 경우
            if (accumulatedResults.size() >= 5 || attemptIndex >= maxFallbackAttempts - 1) {
                // 검색 완료
                if (accumulatedResults.isEmpty()) {
                    // 결과가 없을 때 도움말 메시지 생성
                    String noResultMessage = advancedIntentAnalyzer.buildNoResultMessage(analyzedQuery);
                    sink.next(SearchEvent.builder()
                            .eventType("no_result_help")
                            .source("system")
                            .message(noResultMessage)
                            .build());
                }

                sink.next(SearchEvent.builder()
                        .eventType("complete")
                        .source("system")
                        .message("검색 완료 (시도: " + (attemptIndex + 1) + ", 결과: " + accumulatedResults.size() + ")")
                        .totalCount(accumulatedResults.size())
                        .build());

                sink.complete();
            } else if (currentResults.isEmpty() || currentResults.size() < 3) {
                // 결과가 부족하면 다음 폴백 전략 시도
                sink.next(SearchEvent.builder()
                        .eventType("status")
                        .source("system")
                        .message("결과가 부족합니다. 다음 전략을 시도합니다...")
                        .build());

                // 재귀적으로 다음 폴백 시도
                searchWithFallback(analyzedQuery, window, attemptIndex + 1, accumulatedResults)
                        .subscribe(
                                sink::next,
                                sink::error,
                                sink::complete
                        );
            } else {
                sink.next(SearchEvent.builder()
                        .eventType("complete")
                        .source("system")
                        .message("검색 완료")
                        .totalCount(accumulatedResults.size())
                        .build());
                sink.complete();
            }
        });
    }

    /**
     * 동기식 데이터베이스 검색 (폴백용) - with caching
     */
    private List<SearchResult> searchDatabaseSync(String query, String window) {
        // Check cache first
        var cachedResults = searchCacheService.getDbSearchResults(query, window, SearchResult.class);
        if (cachedResults.isPresent()) {
            log.debug("Returning cached DB search results for query: '{}'", query);
            return cachedResults.get();
        }
        
        List<SearchResult> results = new ArrayList<>();
        
        try {
            LocalDateTime since = calculateSinceDate(window);
            PageRequest pageRequest = PageRequest.of(0, MAX_DB_RESULTS,
                    Sort.by(Sort.Direction.DESC, "publishedDate")
                            .and(Sort.by(Sort.Direction.DESC, "collectedAt")));

            Page<CollectedData> page = collectedDataRepository.searchByQueryAndSince(query, since, pageRequest);

            List<Long> articleIds = page.getContent().stream()
                    .map(CollectedData::getId)
                    .filter(id -> id != null)
                    .toList();

            Map<Long, ArticleAnalysis> analysisMap = articleIds.isEmpty()
                    ? Map.of()
                    : articleAnalysisRepository.findByArticleIdIn(articleIds).stream()
                            .collect(Collectors.toMap(ArticleAnalysis::getArticleId, Function.identity()));

            Map<Long, ArticleDiscussion> discussionMap = articleIds.isEmpty()
                    ? Map.of()
                    : articleDiscussionRepository.findByArticleIdIn(articleIds).stream()
                            .collect(Collectors.toMap(ArticleDiscussion::getArticleId, Function.identity()));

            for (CollectedData data : page.getContent()) {
                ArticleAnalysis analysis = data.getId() != null ? analysisMap.get(data.getId()) : null;
                ArticleDiscussion discussion = data.getId() != null ? discussionMap.get(data.getId()) : null;
                results.add(convertToSearchResult(data, analysis, discussion));
            }
            
            // Cache the results
            if (!results.isEmpty()) {
                searchCacheService.cacheDbSearchResults(query, window, results);
            }
        } catch (Exception e) {
            log.error("Database sync search failed: {}", e.getMessage());
        }

        return results;
    }

    // ============================================
    // Database Search (with Hybrid Search integration)
    // ============================================

    private Flux<SearchEvent> searchDatabase(String query, String window) {
        // Use hybrid search if available, otherwise fall back to keyword-only search
        if (hybridSearchService.isEnabled() && hybridSearchService.isSemanticSearchAvailable()) {
            return searchDatabaseHybrid(query, window);
        }
        return searchDatabaseKeywordOnly(query, window);
    }

    /**
     * Hybrid search: combines keyword + semantic search with RRF ranking
     */
    private Flux<SearchEvent> searchDatabaseHybrid(String query, String window) {
        return Flux.create(sink -> {
            try {
                sink.next(SearchEvent.builder()
                        .eventType("status")
                        .source("database")
                        .message("하이브리드 검색 중 (키워드 + 시맨틱)...")
                        .build());

                hybridSearchService.search(query, window)
                        .subscribe(
                                hybridResult -> {
                                    log.info("Hybrid search completed: keyword={}, semantic={}, total={}",
                                            hybridResult.getKeywordResultCount(),
                                            hybridResult.getSemanticResultCount(),
                                            hybridResult.getTotalResultCount());

                                    // Batch load analysis data for hybrid results
                                    List<Long> articleIds = hybridResult.getResults().stream()
                                            .map(r -> {
                                                try {
                                                    return Long.parseLong(r.getId());
                                                } catch (NumberFormatException e) {
                                                    return null;
                                                }
                                            })
                                            .filter(id -> id != null)
                                            .toList();

                                    Map<Long, ArticleAnalysis> analysisMap = articleIds.isEmpty()
                                            ? Map.of()
                                            : articleAnalysisRepository.findByArticleIdIn(articleIds).stream()
                                                    .collect(Collectors.toMap(ArticleAnalysis::getArticleId, Function.identity()));

                                    Map<Long, ArticleDiscussion> discussionMap = articleIds.isEmpty()
                                            ? Map.of()
                                            : articleDiscussionRepository.findByArticleIdIn(articleIds).stream()
                                                    .collect(Collectors.toMap(ArticleDiscussion::getArticleId, Function.identity()));

                                    int count = 0;
                                    for (RankedResult rankedResult : hybridResult.getResults()) {
                                        Long articleId = null;
                                        try {
                                            articleId = Long.parseLong(rankedResult.getId());
                                        } catch (NumberFormatException ignored) {}

                                        ArticleAnalysis analysis = articleId != null ? analysisMap.get(articleId) : null;
                                        ArticleDiscussion discussion = articleId != null ? discussionMap.get(articleId) : null;

                                        SearchResult result = convertRankedResultToSearchResult(rankedResult, analysis, discussion);
                                        sink.next(SearchEvent.builder()
                                                .eventType("result")
                                                .source("database")
                                                .result(result)
                                                .build());
                                        count++;
                                    }

                                    // Include search metadata in complete message
                                    String message = String.format("하이브리드 검색 완료 (키워드: %d, 시맨틱: %d, RRF 융합: %d, %dms)",
                                            hybridResult.getKeywordResultCount(),
                                            hybridResult.getSemanticResultCount(),
                                            hybridResult.getTotalResultCount(),
                                            hybridResult.getSearchTimeMs());

                                    sink.next(SearchEvent.builder()
                                            .eventType("complete")
                                            .source("database")
                                            .message(message)
                                            .totalCount(count)
                                            .build());

                                    sink.complete();
                                },
                                error -> {
                                    log.error("Hybrid search failed, falling back to keyword search: {}", error.getMessage());
                                    // Fall back to keyword-only search on error
                                    searchDatabaseKeywordOnly(query, window)
                                            .subscribe(sink::next, sink::error, sink::complete);
                                }
                        );
            } catch (Exception e) {
                log.error("Hybrid search initialization failed: {}", e.getMessage());
                // Fall back to keyword-only search
                searchDatabaseKeywordOnly(query, window)
                        .subscribe(sink::next, sink::error, sink::complete);
            }
        });
    }

    /**
     * Keyword-only search (original implementation)
     */
    private Flux<SearchEvent> searchDatabaseKeywordOnly(String query, String window) {
        return Flux.create(sink -> {
            try {
                sink.next(SearchEvent.builder()
                        .eventType("status")
                        .source("database")
                        .message("저장된 뉴스에서 검색 중...")
                        .build());

                LocalDateTime since = calculateSinceDate(window);
                PageRequest pageRequest = PageRequest.of(0, MAX_DB_RESULTS,
                        Sort.by(Sort.Direction.DESC, "publishedDate")
                                .and(Sort.by(Sort.Direction.DESC, "collectedAt")));

                Page<CollectedData> page = collectedDataRepository.searchByQueryAndSince(
                        query, since, pageRequest);

                // 분석 결과 일괄 조회 (N+1 방지)
                List<Long> articleIds = page.getContent().stream()
                        .map(CollectedData::getId)
                        .filter(id -> id != null)
                        .toList();
                
                Map<Long, ArticleAnalysis> analysisMap = articleIds.isEmpty() 
                        ? Map.of()
                        : articleAnalysisRepository.findByArticleIdIn(articleIds).stream()
                                .collect(Collectors.toMap(ArticleAnalysis::getArticleId, Function.identity()));
                
                Map<Long, ArticleDiscussion> discussionMap = articleIds.isEmpty()
                        ? Map.of()
                        : articleDiscussionRepository.findByArticleIdIn(articleIds).stream()
                                .collect(Collectors.toMap(ArticleDiscussion::getArticleId, Function.identity()));

                int count = 0;
                for (CollectedData data : page.getContent()) {
                    ArticleAnalysis analysis = data.getId() != null ? analysisMap.get(data.getId()) : null;
                    ArticleDiscussion discussion = data.getId() != null ? discussionMap.get(data.getId()) : null;
                    
                    SearchResult result = convertToSearchResult(data, analysis, discussion);
                    sink.next(SearchEvent.builder()
                            .eventType("result")
                            .source("database")
                            .result(result)
                            .build());
                    count++;
                }

                sink.next(SearchEvent.builder()
                        .eventType("complete")
                        .source("database")
                        .message("저장된 뉴스 검색 완료")
                        .totalCount(count)
                        .build());

                sink.complete();
            } catch (Exception e) {
                log.error("Database search failed: {}", e.getMessage());
                sink.next(SearchEvent.builder()
                        .eventType("error")
                        .source("database")
                        .message("데이터베이스 검색 오류: " + e.getMessage())
                        .build());
                sink.complete();
            }
        });
    }

    private SearchResult convertToSearchResult(CollectedData data, ArticleAnalysis analysis, ArticleDiscussion discussion) {
        DataSource source = data.getSourceId() != null
                ? dataSourceRepository.findById(data.getSourceId()).orElse(null)
                : null;
        String sourceName = source != null ? source.getName() : "뉴스";

        String publishedAt = data.getPublishedDate() != null
                ? data.getPublishedDate().toString()
                : (data.getCollectedAt() != null ? data.getCollectedAt().toString() : null);

        // 원본 콘텐츠를 보존하면서 정제된 텍스트 생성
        String rawContent = data.getContent();
        String cleanedContent = cleanContent(rawContent);
        
        // snippet은 정제된 콘텐츠에서 생성하되, content는 정제된 전체 텍스트 사용
        SearchResult.SearchResultBuilder builder = SearchResult.builder()
                .id(data.getId() != null ? data.getId().toString() : UUID.randomUUID().toString())
                .source("database")
                .sourceLabel(sourceName)
                .title(data.getTitle())
                .snippet(buildSnippetFromCleanText(cleanedContent))
                .content(cleanedContent)  // HTML 제거된 전체 본문 (원본 텍스트 보존)
                .url(data.getUrl())
                .publishedAt(publishedAt)
                .relevanceScore(data.getQualityScore());
        
        // 분석 결과 추가
        if (analysis != null) {
            builder.analyzed(true)
                    .analysisStatus(analysis.getFullyAnalyzed() != null && analysis.getFullyAnalyzed() 
                            ? "complete" : "partial")
                    .reliabilityScore(analysis.getReliabilityScore())
                    .reliabilityGrade(analysis.getReliabilityGrade())
                    .reliabilityColor(analysis.getReliabilityColor())
                    .sentimentLabel(analysis.getSentimentLabel())
                    .sentimentScore(analysis.getSentimentScore())
                    .biasLabel(analysis.getBiasLabel())
                    .biasScore(analysis.getBiasScore())
                    .factcheckStatus(analysis.getFactcheckStatus())
                    .misinfoRisk(analysis.getMisinfoRisk())
                    .riskTags(analysis.getRiskTags())
                    .topics(analysis.getTopics());
        } else {
            builder.analyzed(false)
                    .analysisStatus("pending");
        }
        
        // 여론 분석 결과 추가
        if (discussion != null) {
            builder.hasDiscussion(true)
                    .totalCommentCount(discussion.getTotalCommentCount())
                    .discussionSentiment(discussion.getOverallSentiment());
        } else {
            builder.hasDiscussion(false);
        }
        
        return builder.build();
    }

    /**
     * Convert RankedResult from hybrid search to SearchResult
     */
    private SearchResult convertRankedResultToSearchResult(RankedResult rankedResult, ArticleAnalysis analysis, ArticleDiscussion discussion) {
        // Determine source label based on the sources that found this result
        String sourceLabel = "뉴스";
        if (rankedResult.getSources() != null && !rankedResult.getSources().isEmpty()) {
            if (rankedResult.getSources().contains("semantic") && rankedResult.getSources().contains("keyword")) {
                sourceLabel = "하이브리드 검색";
            } else if (rankedResult.getSources().contains("semantic")) {
                sourceLabel = "시맨틱 검색";
            } else if (rankedResult.getSources().contains("keyword")) {
                sourceLabel = "키워드 검색";
            }
        }

        SearchResult.SearchResultBuilder builder = SearchResult.builder()
                .id(rankedResult.getId())
                .source("database")
                .sourceLabel(sourceLabel)
                .title(rankedResult.getTitle())
                .snippet(rankedResult.getSnippet())
                .content(rankedResult.getContent())
                .url(rankedResult.getUrl())
                .publishedAt(rankedResult.getPublishedAt())
                .relevanceScore(rankedResult.getRrfScore());  // Use RRF score as relevance

        // 분석 결과 추가
        if (analysis != null) {
            builder.analyzed(true)
                    .analysisStatus(analysis.getFullyAnalyzed() != null && analysis.getFullyAnalyzed()
                            ? "complete" : "partial")
                    .reliabilityScore(analysis.getReliabilityScore())
                    .reliabilityGrade(analysis.getReliabilityGrade())
                    .reliabilityColor(analysis.getReliabilityColor())
                    .sentimentLabel(analysis.getSentimentLabel())
                    .sentimentScore(analysis.getSentimentScore())
                    .biasLabel(analysis.getBiasLabel())
                    .biasScore(analysis.getBiasScore())
                    .factcheckStatus(analysis.getFactcheckStatus())
                    .misinfoRisk(analysis.getMisinfoRisk())
                    .riskTags(analysis.getRiskTags())
                    .topics(analysis.getTopics());
        } else {
            builder.analyzed(false)
                    .analysisStatus("pending");
        }

        // 여론 분석 결과 추가
        if (discussion != null) {
            builder.hasDiscussion(true)
                    .totalCommentCount(discussion.getTotalCommentCount())
                    .discussionSentiment(discussion.getOverallSentiment());
        } else {
            builder.hasDiscussion(false);
        }

        return builder.build();
    }

    // ============================================
    // Web Crawling Search
    // ============================================

    private Flux<SearchEvent> searchWeb(String query, String window) {
        return Flux.create(sink -> {
            try {
                sink.next(SearchEvent.builder()
                        .eventType("status")
                        .source("web")
                        .message("웹에서 최신 정보 수집 중...")
                        .build());

                List<String> searchUrls = generateSearchUrls(query, window);
                int successCount = 0;

                for (String url : searchUrls) {
                    try {
                        Crawl4aiClient.CrawlResult crawlResult = crawl4aiClient.crawl(url);
                        if (crawlResult != null && crawlResult.getContent() != null) {
                            String rawContent = crawlResult.getContent();
                            String fullContent = cleanContent(rawContent);  // 전체 본문 정제
                            
                            SearchResult result = SearchResult.builder()
                                    .id(UUID.randomUUID().toString())
                                    .source("web")
                                    .sourceLabel("웹 검색")
                                    .title(crawlResult.getTitle() != null ? crawlResult.getTitle() : extractTitleFromUrl(url))
                                    .snippet(buildSnippet(rawContent))
                                    .content(fullContent)  // 전체 본문 보존
                                    .url(url)
                                    .build();

                            sink.next(SearchEvent.builder()
                                    .eventType("result")
                                    .source("web")
                                    .result(result)
                                    .build());
                            successCount++;
                        }
                    } catch (Exception e) {
                        log.debug("Failed to crawl URL {}: {}", url, e.getMessage());
                    }
                }

                sink.next(SearchEvent.builder()
                        .eventType("complete")
                        .source("web")
                        .message("웹 검색 완료")
                        .totalCount(successCount)
                        .build());

                sink.complete();
            } catch (Exception e) {
                log.error("Web search failed: {}", e.getMessage());
                sink.next(SearchEvent.builder()
                        .eventType("error")
                        .source("web")
                        .message("웹 검색 오류")
                        .build());
                sink.complete();
            }
        });
    }

    private List<String> generateSearchUrls(String query, String window) {
        List<String> urls = new ArrayList<>();
        String encodedQuery = URLEncoder.encode(query, StandardCharsets.UTF_8);

        // 1. 먼저 DB에서 활성화된 웹 검색 소스를 조회
        List<DataSource> webSearchSources = dataSourceRepository.findActiveWebSearchSources();
        
        if (!webSearchSources.isEmpty()) {
            log.info("Found {} active web search sources from database", webSearchSources.size());
            for (DataSource source : webSearchSources) {
                String searchUrl = source.buildSearchUrl(encodedQuery);
                if (searchUrl != null) {
                    urls.add(searchUrl);
                    log.debug("Added search URL from source '{}': {}", source.getName(), searchUrl);
                }
            }
        }
        
        // 2. DB에 등록된 소스가 없으면 기본 포털 사용 (폴백)
        if (urls.isEmpty()) {
            log.info("No web search sources in database, using default portals");
            
            // 네이버 뉴스
            urls.add("https://search.naver.com/search.naver?where=news&query=" + encodedQuery);

            // 다음 뉴스
            urls.add("https://search.daum.net/search?w=news&q=" + encodedQuery);

            // 구글 뉴스 (한국)
            urls.add("https://news.google.com/search?q=" + encodedQuery + "&hl=ko&gl=KR");
        }

        log.info("Generated {} search URLs for query: '{}'", urls.size(), query);
        return urls;
    }

    private String extractTitleFromUrl(String url) {
        if (url.contains("naver")) return "네이버 뉴스";
        if (url.contains("daum")) return "다음 뉴스";
        if (url.contains("google")) return "구글 뉴스";
        return "웹 검색 결과";
    }

    // ============================================
    // AI-Powered Search with Fallback Chain
    // ============================================

    private Flux<SearchEvent> searchAI(String query, String window) {
        // Check if any AI provider is available
        boolean hasAnyProvider = perplexityClient.isEnabled() 
                || openAICompatibleClient.isEnabled() 
                || aiDoveClient.isEnabled()
                || crawlSearchService.isAvailable();

        if (!hasAnyProvider) {
            return Flux.just(SearchEvent.builder()
                    .eventType("status")
                    .source("ai")
                    .message("AI 분석 기능이 비활성화되어 있습니다.")
                    .build());
        }

        return Flux.create(sink -> {
            sink.next(SearchEvent.builder()
                    .eventType("status")
                    .source("ai")
                    .message("AI가 관련 정보를 분석하고 있습니다...")
                    .build());

            String prompt = buildAISearchPrompt(query, window);

            // Build AI stream with fallback chain
            Flux<String> aiStream = getAiStreamWithFallbackForSearch(prompt, query, window);

            StringBuilder fullResponse = new StringBuilder();

            aiStream
                    .doOnNext(chunk -> {
                        fullResponse.append(chunk);
                        // AI 응답을 실시간으로 전송
                        sink.next(SearchEvent.builder()
                                .eventType("ai_chunk")
                                .source("ai")
                                .message(chunk)
                                .build());
                    })
                    .doOnComplete(() -> {
                        // AI 분석 완료 - 전체 텍스트 보존
                        String fullContent = fullResponse.toString();
                        SearchResult aiResult = SearchResult.builder()
                                .id(UUID.randomUUID().toString())
                                .source("ai")
                                .sourceLabel("AI 분석")
                                .title("'" + query + "' AI 분석 결과")
                                .snippet(fullContent.length() > SNIPPET_MAX_LENGTH
                                        ? fullContent.substring(0, SNIPPET_MAX_LENGTH) + "..."
                                        : fullContent)
                                .content(fullContent)  // 전체 AI 분석 결과 보존
                                .build();

                        sink.next(SearchEvent.builder()
                                .eventType("result")
                                .source("ai")
                                .result(aiResult)
                                .build());

                        sink.next(SearchEvent.builder()
                                .eventType("complete")
                                .source("ai")
                                .message("AI 분석 완료")
                                .totalCount(1)
                                .build());

                        sink.complete();
                    })
                    .doOnError(e -> {
                        log.error("AI search failed: {}", e.getMessage());
                        sink.next(SearchEvent.builder()
                                .eventType("error")
                                .source("ai")
                                .message("AI 분석 오류")
                                .build());
                        sink.complete();
                    })
                    .subscribe();
        });
    }

    /**
     * Get AI stream with fallback chain for search.
     * Tries providers in order until one succeeds.
     */
    private Flux<String> getAiStreamWithFallbackForSearch(String prompt, String query, String window) {
        List<AiSearchProviderAttempt> providers = buildAiSearchProviderChain(prompt, query, window);
        
        if (providers.isEmpty()) {
            log.warn("No AI providers available for search");
            return Flux.just("AI 분석을 수행할 수 없습니다.");
        }

        log.info("AI search using fallback chain: {}", 
                providers.stream().map(AiSearchProviderAttempt::name).toList());

        return tryAiSearchProvidersInSequence(providers, 0);
    }

    /**
     * Build AI provider chain for search
     */
    private List<AiSearchProviderAttempt> buildAiSearchProviderChain(String prompt, String query, String window) {
        List<AiSearchProviderAttempt> chain = new ArrayList<>();

        // 1. Perplexity - Best for search with online capabilities
        if (perplexityClient.isEnabled()) {
            chain.add(new AiSearchProviderAttempt("Perplexity", () -> perplexityClient.streamCompletion(prompt)));
        }

        // 2. OpenAI
        if (openAICompatibleClient.isOpenAIEnabled()) {
            chain.add(new AiSearchProviderAttempt("OpenAI", () -> openAICompatibleClient.streamFromOpenAI(prompt)));
        }

        // 3. OpenRouter
        if (openAICompatibleClient.isOpenRouterEnabled()) {
            chain.add(new AiSearchProviderAttempt("OpenRouter", () -> openAICompatibleClient.streamFromOpenRouter(prompt)));
        }

        // 4. Azure OpenAI
        if (openAICompatibleClient.isAzureEnabled()) {
            chain.add(new AiSearchProviderAttempt("Azure", () -> openAICompatibleClient.streamFromAzure(prompt)));
        }

        // 5. AI Dove
        if (aiDoveClient.isEnabled()) {
            chain.add(new AiSearchProviderAttempt("AI Dove", () -> aiDoveClient.chatStream(prompt, null)));
        }

        // 6. CrawlSearchService as fallback
        if (crawlSearchService.isAvailable()) {
            chain.add(new AiSearchProviderAttempt("Crawl Search", () -> crawlSearchService.searchAndAnalyze(query, window)));
        }

        // 7. Ollama - Local LLM
        chain.add(new AiSearchProviderAttempt("Ollama", () -> openAICompatibleClient.streamFromOllama(prompt)));

        // 8. Custom endpoint
        if (openAICompatibleClient.isCustomEnabled()) {
            chain.add(new AiSearchProviderAttempt("Custom", () -> openAICompatibleClient.streamFromCustom(prompt)));
        }

        return chain;
    }

    /**
     * Try AI search providers in sequence
     */
    private Flux<String> tryAiSearchProvidersInSequence(List<AiSearchProviderAttempt> providers, int index) {
        if (index >= providers.size()) {
            log.warn("All AI search providers exhausted");
            return Flux.just("AI 분석 서비스에 연결할 수 없습니다.");
        }

        AiSearchProviderAttempt current = providers.get(index);
        log.info("Trying AI search provider: {} ({}/{})", current.name(), index + 1, providers.size());

        return current.streamSupplier().get()
                .timeout(Duration.ofSeconds(90))
                .onErrorResume(e -> {
                    log.warn("AI search provider {} failed: {}. Trying next...", current.name(), e.getMessage());
                    return tryAiSearchProvidersInSequence(providers, index + 1);
                })
                .switchIfEmpty(Flux.defer(() -> {
                    log.warn("AI search provider {} returned empty. Trying next...", current.name());
                    return tryAiSearchProvidersInSequence(providers, index + 1);
                }));
    }

    /**
     * AI search provider attempt wrapper
     */
    private record AiSearchProviderAttempt(
            String name,
            java.util.function.Supplier<Flux<String>> streamSupplier
    ) {}

    private String buildAISearchPrompt(String query, String window) {
        String timeFrame = switch (window) {
            case "1d" -> "최근 24시간";
            case "30d" -> "최근 한 달";
            default -> "최근 일주일";
        };
        
        // 통화/단위 맥락 분석 힌트 생성
        String currencyContext = buildCurrencyContext(query);

        return """
                [중요: "알겠습니다", "네", "검색하겠습니다" 등의 서두 없이 바로 아래 형식으로 보고서를 작성하세요]
                
                '%s'에 대해 %s 동안의 정보를 철저히 조사하고 분석한 보고서입니다.
                
                ## 분석 원칙
                - **확실한 정보만 보고**: 불확실하거나 추측성 내용은 포함하지 마세요
                - **출처 명시**: 모든 주요 주장에는 반드시 출처를 표기하세요
                - **교차 검증**: 가능한 경우 여러 출처에서 확인된 정보만 포함하세요
                - **객관적 분석**: 특정 입장에 치우치지 않고 균형 있게 분석하세요
                %s
                
                ## 보고서 형식 (이 형식을 정확히 따라주세요)
                
                ### [요약] 핵심 요약
                현재 상황을 4-5문장으로 명확하게 요약해주세요. 핵심 사실만 포함하세요.
                
                ### [검증] 검증된 사실
                여러 출처에서 확인된 사실들을 나열하세요. 각 사실에 출처를 명시하세요.
                
                | 사실 | 출처 | 검증 수준 |
                |------|------|----------|
                | [사실 내용] | [출처명/기관] | 높음/중간/낮음 |
                
                ### [데이터] 주요 수치 및 데이터
                관련된 구체적인 수치, 통계, 날짜 등을 정리하세요.
                - 수치1: [내용] (출처: [출처명])
                - 수치2: [내용] (출처: [출처명])
                
                ### [관점] 다양한 관점
                이 주제에 대한 서로 다른 입장이나 시각을 균형있게 제시하세요.
                
                **입장 A**: [내용] - 출처: [기관/매체명]
                **입장 B**: [내용] - 출처: [기관/매체명]
                
                ### [주의] 주의사항 및 한계
                - 정보의 한계나 불확실한 부분
                - 추가 확인이 필요한 사항
                - 잠재적인 편향이나 이해관계
                
                ### [결론] 결론
                수집된 정보를 바탕으로 한 객관적인 종합 분석을 제공하세요.
                확실하지 않은 내용은 "추가 확인 필요"로 명시하세요.
                
                ---
                * 이 분석은 수집된 자료를 기반으로 작성되었으며, 모든 주장은 출처와 함께 제공됩니다.
                * 최종 판단은 독자의 몫입니다.
                
                한국어로 답변해주세요. 마크다운 형식을 사용하고, "### [요약]"부터 바로 시작하세요.
                """.formatted(query, timeFrame, currencyContext);
    }
    
    /**
     * 쿼리에서 통화/단위 맥락을 분석하여 AI에게 힌트 제공
     * 
     * 예: "비트코인 10억" → 한국어 맥락에서 원화(KRW)일 가능성 높음
     * 예: "Bitcoin $1B" → 달러(USD)로 명시됨
     */
    private String buildCurrencyContext(String query) {
        StringBuilder context = new StringBuilder();
        
        // 숫자 + 억/만/조 패턴 감지 (한국어 숫자 단위)
        boolean hasKoreanNumber = query.matches(".*\\d+\\s*(억|만|조|천).*");
        
        // 명시적 통화 기호 감지
        boolean hasExplicitUsd = query.matches(".*\\$|USD|달러|dollar.*");
        boolean hasExplicitKrw = query.matches(".*₩|KRW|원화|won.*");
        boolean hasExplicitBtc = query.matches(".*BTC|비트코인|bitcoin.*");
        
        // 가격/금액 관련 키워드 감지
        boolean hasPriceKeyword = query.matches(".*(가격|price|도달|목표|전망|예측|forecast).*");
        
        if (hasKoreanNumber && !hasExplicitUsd && hasPriceKeyword) {
            context.append("""
                
                ## 통화/단위 주의사항
                - **중요**: 이 쿼리에 한국어 숫자 단위(억, 만 등)가 포함되어 있습니다
                - 한국어 맥락에서 단위 없는 숫자는 **한국 원화(KRW)**일 가능성이 높습니다
                - 예: "10억" = 10억 원(KRW) ≈ $670,000 USD (환율에 따라 변동)
                - 분석 시 **원화와 달러 양쪽 해석**을 모두 고려하여 작성해주세요
                - 현재 환율 정보도 함께 제공하면 좋습니다
                """);
        } else if (hasExplicitBtc && hasPriceKeyword && !hasExplicitUsd && !hasExplicitKrw) {
            context.append("""
                
                ## 통화/단위 주의사항
                - 암호화폐 가격 분석 시 **USD와 KRW 양쪽 기준**을 모두 언급해주세요
                - 현재 시세와 비교하여 현실적인 분석을 제공해주세요
                - 명시되지 않은 금액은 맥락에 따라 해석하되, 양쪽 가능성을 모두 제시하세요
                """);
        }
        
        return context.toString();
    }

    // ============================================
    // Utility Methods
    // ============================================

    private LocalDateTime calculateSinceDate(String window) {
        return calculateSinceDate(window, null, null);
    }

    /**
     * Calculate the start date for search based on window or custom date range.
     * 
     * @param window Time window (1d, 3d, 7d, 14d, 30d, 90d, 180d, 365d, all)
     * @param startDate Custom start date (ISO 8601 format)
     * @param endDate Custom end date (ISO 8601 format) - currently unused for "since" calculation
     * @return LocalDateTime representing the start date for search
     */
    private LocalDateTime calculateSinceDate(String window, String startDate, String endDate) {
        // If custom startDate is provided, use it
        if (startDate != null && !startDate.isBlank()) {
            try {
                return LocalDateTime.parse(startDate, DateTimeFormatter.ISO_DATE_TIME);
            } catch (DateTimeParseException e) {
                log.warn("Invalid startDate format: '{}', falling back to window: {}", startDate, window);
            }
        }

        LocalDateTime now = LocalDateTime.now();
        return switch (window) {
            case "1h" -> now.minusHours(1);
            case "1d" -> now.minusDays(1);
            case "3d" -> now.minusDays(3);
            case "14d" -> now.minusDays(14);
            case "30d" -> now.minusDays(30);
            case "90d" -> now.minusDays(90);
            case "180d" -> now.minusDays(180);
            case "365d" -> now.minusDays(365);
            case "all" -> LocalDateTime.of(2000, 1, 1, 0, 0);  // Effectively no time limit
            default -> now.minusDays(7);  // Default to 7 days
        };
    }

    /**
     * Calculate the end date for search (for custom date range support).
     * 
     * @param endDate Custom end date (ISO 8601 format)
     * @return LocalDateTime representing the end date for search, or null for "now"
     */
    private LocalDateTime calculateEndDate(String endDate) {
        if (endDate != null && !endDate.isBlank()) {
            try {
                return LocalDateTime.parse(endDate, DateTimeFormatter.ISO_DATE_TIME);
            } catch (DateTimeParseException e) {
                log.warn("Invalid endDate format: '{}', using current time", endDate);
            }
        }
        return null;  // null means "now" (no upper limit)
    }

    /**
     * 이미 정제된 텍스트에서 snippet 생성 (HTML 파싱 불필요)
     */
    private String buildSnippetFromCleanText(String cleanText) {
        if (cleanText == null || cleanText.isBlank()) {
            return null;
        }

        if (cleanText.length() <= SNIPPET_MAX_LENGTH) {
            return cleanText;
        }

        // 단어 경계에서 자르기
        int cut = SNIPPET_MAX_LENGTH;
        for (int i = Math.min(SNIPPET_MAX_LENGTH - 1, cleanText.length() - 1); 
             i > SNIPPET_MAX_LENGTH * 0.6 && i >= 0; i--) {
            if (Character.isWhitespace(cleanText.charAt(i))) {
                cut = i;
                break;
            }
        }

        return cleanText.substring(0, cut).trim() + "...";
    }

    /**
     * 레거시 호환성을 위한 buildSnippet (HTML 파싱 포함)
     * 웹 크롤링 결과 등에서 사용
     */
    private String buildSnippet(String content) {
        if (content == null || content.isBlank()) {
            return null;
        }

        String text;
        try {
            text = Jsoup.parse(content).text();
        } catch (Exception e) {
            text = content;
        }

        text = text.replaceAll("\\s+", " ").trim();
        if (text.isEmpty()) {
            return null;
        }

        if (text.length() <= SNIPPET_MAX_LENGTH) {
            return text;
        }

        int cut = SNIPPET_MAX_LENGTH;
        for (int i = Math.min(SNIPPET_MAX_LENGTH - 1, text.length() - 1); 
             i > SNIPPET_MAX_LENGTH * 0.6 && i >= 0; i--) {
            if (Character.isWhitespace(text.charAt(i))) {
                cut = i;
                break;
            }
        }

        return text.substring(0, cut).trim() + "...";
    }

    /**
     * HTML 태그를 제거하고 정리된 전체 텍스트를 반환합니다.
     * snippet과 달리 길이 제한 없이 전체 내용을 반환합니다.
     * 
     * 중요: 이 메서드는 원본 텍스트 내용을 최대한 보존하며,
     * HTML 태그만 제거하고 실제 텍스트 데이터는 변경하지 않습니다.
     *
     * @param content 원본 콘텐츠 (HTML 포함 가능)
     * @return 정리된 전체 텍스트 (원본 데이터 보존)
     */
    private String cleanContent(String content) {
        if (content == null || content.isBlank()) {
            return null;
        }

        String text;
        try {
            // Jsoup을 사용하여 HTML 태그만 제거, 텍스트 내용은 보존
            text = Jsoup.parse(content).text();
        } catch (Exception e) {
            // HTML 파싱 실패 시 원본 그대로 사용
            text = content;
        }

        // 연속 공백만 정리 (실제 텍스트 내용은 변경하지 않음)
        text = text.replaceAll("\\s+", " ").trim();
        
        return text.isEmpty() ? null : text;
    }

    // ============================================
    // Async Job-based Search (for SSE reconnection support)
    // ============================================

    /**
     * Execute search asynchronously for a job.
     * Results are published to UnifiedSearchEventService.
     * This allows SSE reconnection with the same jobId.
     * 
     * Uses AdvancedIntentAnalyzer for better query understanding and fallback strategies.
     *
     * @param jobId The job ID
     * @param query Search query
     * @param window Time window (1d, 7d, 30d)
     * @param priorityUrls Optional list of URLs to prioritize for web crawling
     * @param startDate Custom start date (ISO 8601 format) - overrides window if provided
     * @param endDate Custom end date (ISO 8601 format)
     */
    @Async
    public void executeSearchAsync(String jobId, String query, String window, List<String> priorityUrls, 
                                   String startDate, String endDate) {
        log.info("Starting async search for job: {}, query: '{}', window: {}, priorityUrls: {}, startDate: {}, endDate: {}", 
                jobId, query, window, priorityUrls != null ? priorityUrls.size() : 0, startDate, endDate);
        
        // Advanced Intent Analysis
        AnalyzedQuery analyzedQuery = advancedIntentAnalyzer.analyzeQuery(query);
        log.info("Async search - Query analyzed: keywords={}, primary='{}', intent={}, strategies={}",
                analyzedQuery.getKeywords().size(),
                analyzedQuery.getPrimaryKeyword(),
                analyzedQuery.getIntentType(),
                analyzedQuery.getFallbackStrategies().size());
        
        unifiedSearchEventService.updateJobStatus(jobId, "IN_PROGRESS");
        
        AtomicInteger totalResults = new AtomicInteger(0);
        AtomicInteger completedSources = new AtomicInteger(0);
        
        // Collect discovered URLs for AutoCrawl integration
        List<String> discoveredUrls = new ArrayList<>();
        
        // Calculate effective date range
        LocalDateTime effectiveStartDate = calculateSinceDate(window, startDate, endDate);
        LocalDateTime effectiveEndDate = calculateEndDate(endDate);
        
        log.info("Effective date range for job {}: {} to {}", jobId, effectiveStartDate, 
                effectiveEndDate != null ? effectiveEndDate : "now");
        
        try {
            // Execute all three searches in parallel
            CompletableFuture<Void> dbFuture = CompletableFuture.runAsync(() -> 
                    executeDbSearchWithFallback(jobId, analyzedQuery, window, startDate, endDate, totalResults, discoveredUrls));
            
            CompletableFuture<Void> webFuture = CompletableFuture.runAsync(() -> 
                    executeWebSearch(jobId, query, window, totalResults, priorityUrls, discoveredUrls));
            
            CompletableFuture<Void> aiFuture = CompletableFuture.runAsync(() -> 
                    executeAiSearch(jobId, query, window, totalResults));
            
            // Wait for all to complete
            CompletableFuture.allOf(dbFuture, webFuture, aiFuture)
                    .thenRun(() -> {
                        log.info("All sources completed for job: {}, total results: {}, discovered URLs: {}", 
                                jobId, totalResults.get(), discoveredUrls.size());
                        
                        // If no results, provide helpful message
                        if (totalResults.get() == 0) {
                            String noResultMessage = advancedIntentAnalyzer.buildNoResultMessage(analyzedQuery);
                            unifiedSearchEventService.publishStatusUpdate(jobId, "system", noResultMessage);
                        }
                        
                        // Save all collected results to search history
                        persistAllResultsToSearchHistory(jobId, query, window, discoveredUrls);
                        
                        unifiedSearchEventService.publishJobComplete(jobId, totalResults.get());
                        
                        // Notify AutoCrawl of discovered URLs
                        if (autoCrawlEnabled && !discoveredUrls.isEmpty()) {
                            autoCrawlIntegrationService.onSearchCompleted(query, discoveredUrls);
                        }
                    })
                    .exceptionally(ex -> {
                        log.error("Error in async search for job: {}", jobId, ex);
                        unifiedSearchEventService.publishJobError(jobId, ex.getMessage());
                        return null;
                    });
                    
        } catch (Exception e) {
            log.error("Failed to start async search for job: {}", jobId, e);
            unifiedSearchEventService.publishJobError(jobId, e.getMessage());
        }
    }

    /**
     * Execute search asynchronously (backward compatible - without custom date range).
     */
    @Async
    public void executeSearchAsync(String jobId, String query, String window, List<String> priorityUrls) {
        executeSearchAsync(jobId, query, window, priorityUrls, null, null);
    }

    /**
     * DB 검색 with 폴백 전략
     */
    private void executeDbSearchWithFallback(
            String jobId, 
            AnalyzedQuery analyzedQuery, 
            String window,
            String startDate,
            String endDate,
            AtomicInteger totalResults,
            List<String> discoveredUrls) {
        
        int attempt = 0;
        int resultsFound = 0;
        
        // 원본 쿼리로 먼저 시도
        String currentQuery = analyzedQuery.getOriginalQuery();
        
        while (attempt < maxFallbackAttempts && resultsFound < 3) {
            String strategyDesc = attempt == 0 
                    ? "원본 쿼리" 
                    : (attempt <= analyzedQuery.getFallbackStrategies().size() 
                            ? analyzedQuery.getFallbackStrategies().get(attempt - 1).getDescription()
                            : "주요 키워드");
            
            unifiedSearchEventService.publishStatusUpdate(jobId, "database", 
                    "검색 전략 " + (attempt + 1) + "/" + maxFallbackAttempts + ": " + strategyDesc);
            
            int found = executeDbSearchForQuery(jobId, currentQuery, window, startDate, endDate, totalResults, discoveredUrls);
            resultsFound += found;
            
            if (resultsFound >= 3) {
                break;  // 충분한 결과 찾음
            }
            
            // 다음 폴백 전략으로
            attempt++;
            if (attempt <= analyzedQuery.getFallbackStrategies().size()) {
                currentQuery = analyzedQuery.getFallbackStrategies().get(attempt - 1).getQuery();
            } else {
                currentQuery = analyzedQuery.getPrimaryKeyword();
            }
        }
        
        String finalMessage = resultsFound > 0 
                ? "데이터베이스 검색 완료 (시도: " + (attempt + 1) + ", 결과: " + resultsFound + ")"
                : "데이터베이스에서 관련 결과를 찾지 못했습니다. 다른 소스를 확인해주세요.";
        
        unifiedSearchEventService.publishSourceComplete(jobId, "database", finalMessage, resultsFound);
    }

    /**
     * 단일 쿼리로 DB 검색 실행
     */
    private int executeDbSearchForQuery(
            String jobId, 
            String query, 
            String window,
            String startDate,
            String endDate,
            AtomicInteger totalResults,
            List<String> discoveredUrls) {
        
        try {
            // Use hybrid search if available
            if (hybridSearchService.isEnabled() && hybridSearchService.isSemanticSearchAvailable()) {
                return executeDbSearchHybridForQuery(jobId, query, window, startDate, endDate, totalResults, discoveredUrls);
            } else {
                return executeDbSearchKeywordForQuery(jobId, query, window, startDate, endDate, totalResults, discoveredUrls);
            }
        } catch (Exception e) {
            log.error("DB search failed for query '{}': {}", query, e.getMessage());
            return 0;
        }
    }

    private int executeDbSearchHybridForQuery(
            String jobId, 
            String query, 
            String window,
            String startDate,
            String endDate,
            AtomicInteger totalResults,
            List<String> discoveredUrls) {
        
        try {
            // Use custom date range if provided, otherwise use window
            String effectiveWindow = (startDate != null && !startDate.isBlank()) ? "custom" : window;
            HybridSearchService.HybridSearchResult hybridResult = hybridSearchService
                    .search(query, effectiveWindow, startDate, endDate).block();
            
            if (hybridResult == null || hybridResult.getResults().isEmpty()) {
                return 0;
            }

            List<Long> articleIds = hybridResult.getResults().stream()
                    .map(r -> {
                        try { return Long.parseLong(r.getId()); } 
                        catch (NumberFormatException e) { return null; }
                    })
                    .filter(id -> id != null)
                    .toList();

            Map<Long, ArticleAnalysis> analysisMap = articleIds.isEmpty()
                    ? Map.of()
                    : articleAnalysisRepository.findByArticleIdIn(articleIds).stream()
                            .collect(Collectors.toMap(ArticleAnalysis::getArticleId, Function.identity()));

            Map<Long, ArticleDiscussion> discussionMap = articleIds.isEmpty()
                    ? Map.of()
                    : articleDiscussionRepository.findByArticleIdIn(articleIds).stream()
                            .collect(Collectors.toMap(ArticleDiscussion::getArticleId, Function.identity()));

            int count = 0;
            for (RankedResult rankedResult : hybridResult.getResults()) {
                Long articleId = null;
                try { articleId = Long.parseLong(rankedResult.getId()); } 
                catch (NumberFormatException ignored) {}

                ArticleAnalysis analysis = articleId != null ? analysisMap.get(articleId) : null;
                ArticleDiscussion discussion = articleId != null ? discussionMap.get(articleId) : null;

                SearchResult result = convertRankedResultToSearchResult(rankedResult, analysis, discussion);
                unifiedSearchEventService.publishResult(jobId, "database", result);
                
                if (result.getUrl() != null && discoveredUrls != null) {
                    synchronized (discoveredUrls) {
                        discoveredUrls.add(result.getUrl());
                    }
                }
                
                count++;
                totalResults.incrementAndGet();
            }
            
            return count;
        } catch (Exception e) {
            log.error("Hybrid search failed: {}", e.getMessage());
            return 0;
        }
    }

    private int executeDbSearchKeywordForQuery(
            String jobId, 
            String query, 
            String window,
            String startDate,
            String endDate,
            AtomicInteger totalResults,
            List<String> discoveredUrls) {
        
        try {
            LocalDateTime since = calculateSinceDate(window, startDate, endDate);
            LocalDateTime until = calculateEndDate(endDate);
            
            PageRequest pageRequest = PageRequest.of(0, MAX_DB_RESULTS,
                    Sort.by(Sort.Direction.DESC, "publishedDate")
                            .and(Sort.by(Sort.Direction.DESC, "collectedAt")));

            // Use date range query if endDate is specified
            Page<CollectedData> page;
            if (until != null) {
                page = collectedDataRepository.searchByQueryAndDateRange(query, since, until, pageRequest);
            } else {
                page = collectedDataRepository.searchByQueryAndSince(query, since, pageRequest);
            }

            List<Long> articleIds = page.getContent().stream()
                    .map(CollectedData::getId)
                    .filter(id -> id != null)
                    .toList();

            Map<Long, ArticleAnalysis> analysisMap = articleIds.isEmpty()
                    ? Map.of()
                    : articleAnalysisRepository.findByArticleIdIn(articleIds).stream()
                            .collect(Collectors.toMap(ArticleAnalysis::getArticleId, Function.identity()));

            Map<Long, ArticleDiscussion> discussionMap = articleIds.isEmpty()
                    ? Map.of()
                    : articleDiscussionRepository.findByArticleIdIn(articleIds).stream()
                            .collect(Collectors.toMap(ArticleDiscussion::getArticleId, Function.identity()));

            int count = 0;
            for (CollectedData data : page.getContent()) {
                ArticleAnalysis analysis = data.getId() != null ? analysisMap.get(data.getId()) : null;
                ArticleDiscussion discussion = data.getId() != null ? discussionMap.get(data.getId()) : null;

                SearchResult result = convertToSearchResult(data, analysis, discussion);
                unifiedSearchEventService.publishResult(jobId, "database", result);

                if (result.getUrl() != null && discoveredUrls != null) {
                    synchronized (discoveredUrls) {
                        discoveredUrls.add(result.getUrl());
                    }
                }

                count++;
                totalResults.incrementAndGet();
            }

            return count;
        } catch (Exception e) {
            log.error("Keyword search failed: {}", e.getMessage());
            return 0;
        }
    }

    private void executeDbSearch(String jobId, String query, String window, AtomicInteger totalResults, List<String> discoveredUrls) {
        // Use hybrid search if available
        if (hybridSearchService.isEnabled() && hybridSearchService.isSemanticSearchAvailable()) {
            executeDbSearchHybrid(jobId, query, window, totalResults, discoveredUrls);
        } else {
            executeDbSearchKeywordOnly(jobId, query, window, totalResults, discoveredUrls);
        }
    }

    private void executeDbSearchHybrid(String jobId, String query, String window, AtomicInteger totalResults, List<String> discoveredUrls) {
        try {
            unifiedSearchEventService.publishStatusUpdate(jobId, "database", "하이브리드 검색 중 (키워드 + 시맨틱)...");

            HybridSearchService.HybridSearchResult hybridResult = hybridSearchService.search(query, window).block();
            
            if (hybridResult == null || hybridResult.getResults().isEmpty()) {
                log.info("Hybrid search returned no results for job: {}, falling back to keyword search", jobId);
                executeDbSearchKeywordOnly(jobId, query, window, totalResults, discoveredUrls);
                return;
            }

            log.info("Hybrid search completed for job {}: keyword={}, semantic={}, fused={}",
                    jobId, hybridResult.getKeywordResultCount(),
                    hybridResult.getSemanticResultCount(),
                    hybridResult.getTotalResultCount());

            // Batch load analysis data for hybrid results
            List<Long> articleIds = hybridResult.getResults().stream()
                    .map(r -> {
                        try {
                            return Long.parseLong(r.getId());
                        } catch (NumberFormatException e) {
                            return null;
                        }
                    })
                    .filter(id -> id != null)
                    .toList();

            Map<Long, ArticleAnalysis> analysisMap = articleIds.isEmpty()
                    ? Map.of()
                    : articleAnalysisRepository.findByArticleIdIn(articleIds).stream()
                            .collect(Collectors.toMap(ArticleAnalysis::getArticleId, Function.identity()));

            Map<Long, ArticleDiscussion> discussionMap = articleIds.isEmpty()
                    ? Map.of()
                    : articleDiscussionRepository.findByArticleIdIn(articleIds).stream()
                            .collect(Collectors.toMap(ArticleDiscussion::getArticleId, Function.identity()));

            int count = 0;
            for (RankedResult rankedResult : hybridResult.getResults()) {
                Long articleId = null;
                try {
                    articleId = Long.parseLong(rankedResult.getId());
                } catch (NumberFormatException ignored) {}

                ArticleAnalysis analysis = articleId != null ? analysisMap.get(articleId) : null;
                ArticleDiscussion discussion = articleId != null ? discussionMap.get(articleId) : null;

                SearchResult result = convertRankedResultToSearchResult(rankedResult, analysis, discussion);
                unifiedSearchEventService.publishResult(jobId, "database", result);
                
                // Collect URL for AutoCrawl
                if (result.getUrl() != null && discoveredUrls != null) {
                    synchronized (discoveredUrls) {
                        discoveredUrls.add(result.getUrl());
                    }
                }
                
                count++;
                totalResults.incrementAndGet();
            }

            String message = String.format("하이브리드 검색 완료 (키워드: %d, 시맨틱: %d, RRF 융합: %d, %dms)",
                    hybridResult.getKeywordResultCount(),
                    hybridResult.getSemanticResultCount(),
                    hybridResult.getTotalResultCount(),
                    hybridResult.getSearchTimeMs());

            unifiedSearchEventService.publishSourceComplete(jobId, "database", message, count);

        } catch (Exception e) {
            log.error("Hybrid search failed for job: {}, falling back to keyword search: {}", jobId, e.getMessage());
            executeDbSearchKeywordOnly(jobId, query, window, totalResults, discoveredUrls);
        }
    }

    private void executeDbSearchKeywordOnly(String jobId, String query, String window, AtomicInteger totalResults, List<String> discoveredUrls) {
        try {
            unifiedSearchEventService.publishStatusUpdate(jobId, "database", "저장된 뉴스에서 검색 중...");
            
            LocalDateTime since = calculateSinceDate(window);
            PageRequest pageRequest = PageRequest.of(0, MAX_DB_RESULTS,
                    Sort.by(Sort.Direction.DESC, "publishedDate")
                            .and(Sort.by(Sort.Direction.DESC, "collectedAt")));

            Page<CollectedData> page = collectedDataRepository.searchByQueryAndSince(
                    query, since, pageRequest);

            // Batch load analysis data
            List<Long> articleIds = page.getContent().stream()
                    .map(CollectedData::getId)
                    .filter(id -> id != null)
                    .toList();
            
            Map<Long, ArticleAnalysis> analysisMap = articleIds.isEmpty() 
                    ? Map.of()
                    : articleAnalysisRepository.findByArticleIdIn(articleIds).stream()
                            .collect(Collectors.toMap(ArticleAnalysis::getArticleId, Function.identity()));
            
            Map<Long, ArticleDiscussion> discussionMap = articleIds.isEmpty()
                    ? Map.of()
                    : articleDiscussionRepository.findByArticleIdIn(articleIds).stream()
                            .collect(Collectors.toMap(ArticleDiscussion::getArticleId, Function.identity()));

            int count = 0;
            for (CollectedData data : page.getContent()) {
                ArticleAnalysis analysis = data.getId() != null ? analysisMap.get(data.getId()) : null;
                ArticleDiscussion discussion = data.getId() != null ? discussionMap.get(data.getId()) : null;
                
                SearchResult result = convertToSearchResult(data, analysis, discussion);
                unifiedSearchEventService.publishResult(jobId, "database", result);
                
                // Collect URL for AutoCrawl
                if (result.getUrl() != null && discoveredUrls != null) {
                    synchronized (discoveredUrls) {
                        discoveredUrls.add(result.getUrl());
                    }
                }
                
                count++;
                totalResults.incrementAndGet();
            }

            unifiedSearchEventService.publishSourceComplete(jobId, "database", "저장된 뉴스 검색 완료", count);
            
        } catch (Exception e) {
            log.error("Database search failed for job: {}", jobId, e);
            unifiedSearchEventService.publishSourceError(jobId, "database", "데이터베이스 검색 오류: " + e.getMessage());
        }
    }

    private void executeWebSearch(String jobId, String query, String window, AtomicInteger totalResults, List<String> priorityUrls, List<String> discoveredUrls) {
        try {
            unifiedSearchEventService.publishStatusUpdate(jobId, "web", "웹에서 최신 정보 수집 중...");
            
            // Use priorityUrls if provided, otherwise fall back to generated URLs
            List<String> searchUrls;
            if (priorityUrls != null && !priorityUrls.isEmpty()) {
                searchUrls = priorityUrls;
                log.info("Using {} priority URLs for web search in job: {}", priorityUrls.size(), jobId);
            } else {
                searchUrls = generateSearchUrls(query, window);
                log.info("Using {} generated search URLs for web search in job: {}", searchUrls.size(), jobId);
            }
            
            int successCount = 0;

            for (String url : searchUrls) {
                try {
                    Crawl4aiClient.CrawlResult crawlResult = crawl4aiClient.crawl(url);
                    if (crawlResult != null && crawlResult.getContent() != null) {
                        String fullContent = cleanContent(crawlResult.getContent());
                        SearchResult result = SearchResult.builder()
                                .id(UUID.randomUUID().toString())
                                .source("web")
                                .sourceLabel("웹 검색")
                                .title(crawlResult.getTitle() != null ? crawlResult.getTitle() : extractTitleFromUrl(url))
                                .snippet(buildSnippet(crawlResult.getContent()))
                                .content(fullContent)  // 전체 본문 추가
                                .url(url)
                                .build();

                        unifiedSearchEventService.publishResult(jobId, "web", result);
                        
                        // Collect URL for AutoCrawl
                        if (discoveredUrls != null) {
                            synchronized (discoveredUrls) {
                                discoveredUrls.add(url);
                            }
                        }
                        
                        successCount++;
                        totalResults.incrementAndGet();
                    }
                } catch (Exception e) {
                    log.debug("Failed to crawl URL {} for job {}: {}", url, jobId, e.getMessage());
                }
            }

            unifiedSearchEventService.publishSourceComplete(jobId, "web", "웹 검색 완료", successCount);
            
        } catch (Exception e) {
            log.error("Web search failed for job: {}", jobId, e);
            unifiedSearchEventService.publishSourceError(jobId, "web", "웹 검색 오류");
        }
    }

    private void executeAiSearch(String jobId, String query, String window, AtomicInteger totalResults) {
        // Check if any AI provider is available
        boolean hasAnyProvider = perplexityClient.isEnabled() 
                || openAICompatibleClient.isEnabled() 
                || aiDoveClient.isEnabled()
                || crawlSearchService.isAvailable();

        if (!hasAnyProvider) {
            unifiedSearchEventService.publishStatusUpdate(jobId, "ai", "AI 분석 기능이 비활성화되어 있습니다.");
            unifiedSearchEventService.publishSourceComplete(jobId, "ai", "AI 분석 비활성화", 0);
            return;
        }

        try {
            unifiedSearchEventService.publishStatusUpdate(jobId, "ai", "AI가 관련 정보를 분석하고 있습니다...");
            
            // ===== 실시간 데이터 필요 여부 분석 =====
            String realtimeContext = collectRealtimeDataIfNeeded(jobId, query);
            
            // 프롬프트 생성 (실시간 데이터 포함)
            String prompt = buildAISearchPromptWithRealtimeData(query, window, realtimeContext);
            
            // Use fallback chain
            Flux<String> aiStream = getAiStreamWithFallbackForSearch(prompt, query, window);

            StringBuilder fullResponse = new StringBuilder();
            
            // Block and collect all AI response (since we're in async context)
            aiStream
                    .doOnNext(chunk -> {
                        fullResponse.append(chunk);
                        unifiedSearchEventService.publishAiChunk(jobId, chunk);
                    })
                    .blockLast(Duration.ofMinutes(2));

            // Publish final AI result - 전체 텍스트 보존
            String fullContent = fullResponse.toString();
            SearchResult aiResult = SearchResult.builder()
                    .id(UUID.randomUUID().toString())
                    .source("ai")
                    .sourceLabel("AI 분석")
                    .title("'" + query + "' AI 분석 결과")
                    .snippet(fullContent.length() > SNIPPET_MAX_LENGTH
                            ? fullContent.substring(0, SNIPPET_MAX_LENGTH) + "..."
                            : fullContent)
                    .content(fullContent)  // 전체 AI 분석 결과 보존
                    .build();

            unifiedSearchEventService.publishResult(jobId, "ai", aiResult);
            totalResults.incrementAndGet();
            unifiedSearchEventService.publishSourceComplete(jobId, "ai", "AI 분석 완료", 1);

            persistAiReportToSearchHistory(jobId, query, window, fullContent);
            
        } catch (Exception e) {
            log.error("AI search failed for job: {}", jobId, e);
            unifiedSearchEventService.publishSourceError(jobId, "ai", "AI 분석 오류");
        }
    }

    /**
     * 실시간 데이터 필요 여부를 분석하고, 필요시 Perplexity Online으로 데이터를 수집합니다.
     * 
     * @param jobId 검색 작업 ID
     * @param query 사용자 쿼리
     * @return 실시간 데이터 컨텍스트 문자열 (필요 없는 경우 빈 문자열)
     */
    private String collectRealtimeDataIfNeeded(String jobId, String query) {
        try {
            // 실시간 데이터 필요 여부 분석
            RealtimeAnalysisResult realtimeAnalysis = advancedIntentAnalyzer.analyzeRealtimeDataNeed(query);
            
            if (!realtimeAnalysis.isNeedsRealtimeData()) {
                log.debug("Query '{}' does not require realtime data (confidence: {})", 
                        query, realtimeAnalysis.getConfidence());
                return "";
            }
            
            if (!realtimeSearchSource.isAvailable()) {
                log.debug("Realtime search source is not available for query: '{}'", query);
                return "";
            }
            
            log.info("Query '{}' requires realtime data (type: {}, confidence: {}, reason: {})", 
                    query, realtimeAnalysis.getDataType(), realtimeAnalysis.getConfidence(), 
                    realtimeAnalysis.getReason());
            
            unifiedSearchEventService.publishStatusUpdate(jobId, "ai", "실시간 데이터 수집 중...");
            
            // Perplexity Online으로 실시간 데이터 수집
            List<SourceEvidence> realtimeEvidence = realtimeSearchSource
                    .fetchEvidence(query, "ko")
                    .collectList()
                    .block(Duration.ofSeconds(30));
            
            if (realtimeEvidence == null || realtimeEvidence.isEmpty()) {
                log.info("No realtime evidence collected for query: '{}'", query);
                return "";
            }
            
            // 실시간 데이터를 컨텍스트 문자열로 변환
            StringBuilder contextBuilder = new StringBuilder();
            contextBuilder.append("\n\n## 실시간 검색 결과 (반드시 이 데이터를 우선 참조하세요)\n\n");
            
            for (SourceEvidence evidence : realtimeEvidence) {
                contextBuilder.append("### 출처: ").append(evidence.getSourceName()).append("\n");
                contextBuilder.append(evidence.getExcerpt()).append("\n");
                if (evidence.getUrl() != null) {
                    contextBuilder.append("URL: ").append(evidence.getUrl()).append("\n");
                }
                contextBuilder.append("\n");
            }
            
            log.info("Collected {} realtime evidence items for query: '{}'", 
                    realtimeEvidence.size(), query);
            
            return contextBuilder.toString();
            
        } catch (Exception e) {
            log.warn("Failed to collect realtime data for query '{}': {}", query, e.getMessage());
            return "";
        }
    }

    /**
     * 실시간 데이터를 포함한 AI 검색 프롬프트를 생성합니다.
     * 
     * @param query 사용자 쿼리
     * @param window 시간 범위
     * @param realtimeContext 실시간 데이터 컨텍스트 (빈 문자열 가능)
     * @return AI 프롬프트
     */
    private String buildAISearchPromptWithRealtimeData(String query, String window, String realtimeContext) {
        String basePrompt = buildAISearchPrompt(query, window);
        
        if (realtimeContext == null || realtimeContext.isBlank()) {
            return basePrompt;
        }
        
        // 실시간 데이터를 프롬프트에 삽입
        // "한국어로 답변해주세요" 또는 프롬프트 끝에 추가
        String realtimeInstructions = realtimeContext + 
                "\n\n**중요**: 위의 실시간 검색 결과에 포함된 가격, 시세, 통계 데이터를 반드시 사용하세요. " +
                "추정하거나 과거 데이터를 사용하지 마세요. 실시간 데이터의 출처도 명시해주세요.\n\n";
        
        // 프롬프트에 "한국어로 답변해주세요"가 있으면 그 앞에 삽입
        if (basePrompt.contains("한국어로 답변해주세요")) {
            return basePrompt.replace(
                    "한국어로 답변해주세요.",
                    realtimeInstructions + "한국어로 답변해주세요."
            );
        }
        
        // 없으면 프롬프트 끝에 추가
        return basePrompt + realtimeInstructions;
    }

    private void persistAiReportToSearchHistory(String jobId, String query, String window, String fullMarkdown) {
        try {
            Map<String, Object> aiSummary = new HashMap<>();
            aiSummary.put(AI_SUMMARY_KEY_CONTENT, fullMarkdown);
            aiSummary.put(AI_SUMMARY_KEY_SUMMARY, extractSummarySection(fullMarkdown));
            aiSummary.put(AI_SUMMARY_KEY_GENERATED_AT, System.currentTimeMillis());

            SearchHistoryMessage message = SearchHistoryMessage.builder()
                    .externalId(jobId)
                    .searchType(SearchType.UNIFIED)
                    .query(query)
                    .timeWindow(window)
                    .resultCount(0)
                    .results(List.of())
                    .aiSummary(aiSummary)
                    .success(true)
                    .timestamp(System.currentTimeMillis())
                    .build();

            searchHistoryService.saveFromMessage(message);
            log.info("Saved unified AI report to search history: jobId={}", jobId);
        } catch (Exception e) {
            log.warn("Failed to save unified AI report to search history: jobId={}, error={}", jobId, e.getMessage());
        }
    }

    /**
     * Save all collected search results to search history.
     * This includes DB results, web crawl results, and discovered URLs.
     */
    private void persistAllResultsToSearchHistory(String jobId, String query, String window, List<String> discoveredUrls) {
        try {
            // Get all collected results from the event service
            List<Map<String, Object>> collectedResults = unifiedSearchEventService.getCollectedResults(jobId);
            
            if (collectedResults.isEmpty()) {
                log.debug("No results to persist for job: {}", jobId);
                return;
            }

            SearchHistoryMessage message = SearchHistoryMessage.builder()
                    .externalId(jobId + "-results")
                    .searchType(SearchType.UNIFIED)
                    .query(query)
                    .timeWindow(window)
                    .resultCount(collectedResults.size())
                    .results(collectedResults)
                    .discoveredUrls(discoveredUrls)
                    .success(true)
                    .timestamp(System.currentTimeMillis())
                    .build();

            searchHistoryService.saveFromMessage(message);
            log.info("Saved {} unified search results to search history: jobId={}", collectedResults.size(), jobId);
        } catch (Exception e) {
            log.warn("Failed to save unified search results to search history: jobId={}, error={}", jobId, e.getMessage());
        }
    }

    private String extractSummarySection(String markdown) {
        if (markdown == null || markdown.isBlank()) {
            return null;
        }

        int start = markdown.indexOf("### [요약]");
        if (start < 0) {
            start = markdown.indexOf("## [요약]");
        }
        if (start < 0) {
            return null;
        }

        int next = markdown.indexOf("\n### ", start + 1);
        if (next < 0) {
            next = markdown.length();
        }

        String section = markdown.substring(start, next).trim();
        return section.isEmpty() ? null : section;
    }
}
