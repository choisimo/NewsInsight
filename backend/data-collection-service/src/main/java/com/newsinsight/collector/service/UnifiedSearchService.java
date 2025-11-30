package com.newsinsight.collector.service;

import com.newsinsight.collector.client.Crawl4aiClient;
import com.newsinsight.collector.client.PerplexityClient;
import com.newsinsight.collector.dto.ArticleDto;
import com.newsinsight.collector.dto.ArticleWithAnalysisDto;
import com.newsinsight.collector.entity.CollectedData;
import com.newsinsight.collector.entity.DataSource;
import com.newsinsight.collector.entity.analysis.ArticleAnalysis;
import com.newsinsight.collector.entity.analysis.ArticleDiscussion;
import com.newsinsight.collector.repository.ArticleAnalysisRepository;
import com.newsinsight.collector.repository.ArticleDiscussionRepository;
import com.newsinsight.collector.repository.CollectedDataRepository;
import com.newsinsight.collector.repository.DataSourceRepository;
import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.jsoup.Jsoup;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Unified Search Service - 병렬 검색 통합 서비스
 * 
 * DB, 웹 크롤링, AI 검색을 병렬로 실행하고 결과가 나오는 대로 스트리밍합니다.
 * 특정 기술/API 이름을 노출하지 않고 통합된 검색 경험을 제공합니다.
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
    private final Crawl4aiClient crawl4aiClient;
    private final CrawlSearchService crawlSearchService;

    private static final int SNIPPET_MAX_LENGTH = 200;
    private static final int MAX_DB_RESULTS = 20;

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
        private String snippet;
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
        .doOnComplete(() -> log.info("Parallel search completed for query: '{}'", query))
        .doOnError(e -> log.error("Parallel search error for query '{}': {}", query, e.getMessage()));
    }

    // ============================================
    // Database Search
    // ============================================

    private Flux<SearchEvent> searchDatabase(String query, String window) {
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

        SearchResult.SearchResultBuilder builder = SearchResult.builder()
                .id(data.getId() != null ? data.getId().toString() : UUID.randomUUID().toString())
                .source("database")
                .sourceLabel(sourceName)
                .title(data.getTitle())
                .snippet(buildSnippet(data.getContent()))
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
                            SearchResult result = SearchResult.builder()
                                    .id(UUID.randomUUID().toString())
                                    .source("web")
                                    .sourceLabel("웹 검색")
                                    .title(crawlResult.getTitle() != null ? crawlResult.getTitle() : extractTitleFromUrl(url))
                                    .snippet(buildSnippet(crawlResult.getContent()))
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

        // 네이버 뉴스
        urls.add("https://search.naver.com/search.naver?where=news&query=" + encodedQuery);

        // 다음 뉴스
        urls.add("https://search.daum.net/search?w=news&q=" + encodedQuery);

        // 구글 뉴스 (한국)
        urls.add("https://news.google.com/search?q=" + encodedQuery + "&hl=ko&gl=KR");

        return urls;
    }

    private String extractTitleFromUrl(String url) {
        if (url.contains("naver")) return "네이버 뉴스";
        if (url.contains("daum")) return "다음 뉴스";
        if (url.contains("google")) return "구글 뉴스";
        return "웹 검색 결과";
    }

    // ============================================
    // AI-Powered Search
    // ============================================

    private Flux<SearchEvent> searchAI(String query, String window) {
        // AI 검색 기능이 비활성화된 경우
        if (!perplexityClient.isEnabled() && !crawlSearchService.isAvailable()) {
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

            Flux<String> aiStream;
            if (perplexityClient.isEnabled()) {
                aiStream = perplexityClient.streamCompletion(prompt);
            } else {
                aiStream = crawlSearchService.searchAndAnalyze(query, window);
            }

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
                        // AI 분석 완료
                        SearchResult aiResult = SearchResult.builder()
                                .id(UUID.randomUUID().toString())
                                .source("ai")
                                .sourceLabel("AI 분석")
                                .title("'" + query + "' AI 분석 결과")
                                .snippet(fullResponse.length() > SNIPPET_MAX_LENGTH
                                        ? fullResponse.substring(0, SNIPPET_MAX_LENGTH) + "..."
                                        : fullResponse.toString())
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

    private String buildAISearchPrompt(String query, String window) {
        String timeFrame = switch (window) {
            case "1d" -> "최근 24시간";
            case "30d" -> "최근 한 달";
            default -> "최근 일주일";
        };

        return """
                '%s'에 대해 %s 동안의 주요 뉴스와 정보를 분석해주세요.
                
                다음 형식으로 답변해주세요:
                
                ## 핵심 요약
                3-4문장으로 현재 상황을 요약
                
                ## 주요 사실
                - 확인된 사실 1
                - 확인된 사실 2
                - 확인된 사실 3
                
                ## 다양한 관점
                서로 다른 입장이나 시각이 있다면 균형있게 제시
                
                ## 결론
                객관적인 종합 의견
                
                한국어로 답변해주세요.
                """.formatted(query, timeFrame);
    }

    // ============================================
    // Utility Methods
    // ============================================

    private LocalDateTime calculateSinceDate(String window) {
        LocalDateTime now = LocalDateTime.now();
        return switch (window) {
            case "1d" -> now.minusDays(1);
            case "30d" -> now.minusDays(30);
            default -> now.minusDays(7);
        };
    }

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
}
