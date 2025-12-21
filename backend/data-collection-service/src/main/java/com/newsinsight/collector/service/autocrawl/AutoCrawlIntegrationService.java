package com.newsinsight.collector.service.autocrawl;

import com.newsinsight.collector.entity.CollectedData;
import com.newsinsight.collector.entity.autocrawl.CrawlTarget;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * 자동 크롤링 통합 서비스.
 * 
 * 기존 시스템의 이벤트를 수신하여 자동으로 URL을 발견합니다:
 * - 검색 이벤트: 검색 결과에서 URL 발견
 * - 기사 수집 이벤트: 기사 내 링크에서 URL 발견
 * - Deep Search 이벤트: 심층 검색 결과에서 URL 발견
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AutoCrawlIntegrationService {

    private final AutoCrawlDiscoveryService discoveryService;
    private final CrawlQueueService queueService;

    @Value("${autocrawl.enabled:true}")
    private boolean autoCrawlEnabled;

    @Value("${autocrawl.discover-from-search:true}")
    private boolean discoverFromSearch;

    @Value("${autocrawl.discover-from-articles:true}")
    private boolean discoverFromArticles;

    @Value("${autocrawl.discover-from-deep-search:true}")
    private boolean discoverFromDeepSearch;

    @Value("${autocrawl.min-content-length:200}")
    private int minContentLength;

    // URL 추출 패턴
    private static final Pattern URL_PATTERN = Pattern.compile(
            "https?://[\\w\\-._~:/?#\\[\\]@!$&'()*+,;=%]+",
            Pattern.CASE_INSENSITIVE
    );

    // ========================================
    // 검색 결과에서 URL 발견
    // ========================================

    /**
     * 검색 완료 시 URL 발견
     * UnifiedSearchService의 검색 완료 이벤트에서 호출
     */
    @Async
    public void onSearchCompleted(String query, List<String> resultUrls) {
        if (!autoCrawlEnabled || !discoverFromSearch) {
            return;
        }

        if (resultUrls == null || resultUrls.isEmpty()) {
            return;
        }

        try {
            log.debug("Discovering URLs from search: query='{}', urlCount={}", query, resultUrls.size());
            List<CrawlTarget> targets = discoveryService.discoverFromSearchUrls(query, resultUrls);
            
            if (!targets.isEmpty()) {
                log.info("AutoCrawl: Discovered {} URLs from search query '{}'", targets.size(), query);
            }
        } catch (Exception e) {
            log.warn("Failed to discover URLs from search: query='{}', error={}", query, e.getMessage());
        }
    }

    /**
     * 검색 결과 HTML에서 URL 발견 (더 상세한 발견)
     */
    @Async
    public void onSearchHtmlReceived(String query, String htmlContent, String baseUrl) {
        if (!autoCrawlEnabled || !discoverFromSearch) {
            return;
        }

        if (htmlContent == null || htmlContent.length() < minContentLength) {
            return;
        }

        try {
            List<CrawlTarget> targets = discoveryService.discoverFromSearchResult(query, htmlContent, baseUrl);
            
            if (!targets.isEmpty()) {
                log.info("AutoCrawl: Discovered {} URLs from search HTML for query '{}'", targets.size(), query);
            }
        } catch (Exception e) {
            log.warn("Failed to discover URLs from search HTML: query='{}', error={}", query, e.getMessage());
        }
    }

    // ========================================
    // 수집된 기사에서 URL 발견
    // ========================================

    /**
     * 기사 수집 완료 시 내부 링크 발견
     * CrawlResultConsumerService에서 호출 가능
     */
    @Async
    public void onArticleCollected(CollectedData article) {
        if (!autoCrawlEnabled || !discoverFromArticles) {
            return;
        }

        if (article == null || article.getContent() == null || 
            article.getContent().length() < minContentLength) {
            return;
        }

        try {
            List<CrawlTarget> targets = discoveryService.discoverFromArticle(article);
            
            if (!targets.isEmpty()) {
                log.debug("AutoCrawl: Discovered {} URLs from article id={}", targets.size(), article.getId());
            }
        } catch (Exception e) {
            log.warn("Failed to discover URLs from article: id={}, error={}", 
                    article.getId(), e.getMessage());
        }
    }

    /**
     * 기사 일괄 수집 완료 시 URL 발견
     */
    @Async
    public void onArticlesBatchCollected(List<CollectedData> articles) {
        if (!autoCrawlEnabled || !discoverFromArticles) {
            return;
        }

        if (articles == null || articles.isEmpty()) {
            return;
        }

        int totalDiscovered = 0;
        for (CollectedData article : articles) {
            try {
                if (article.getContent() != null && article.getContent().length() >= minContentLength) {
                    List<CrawlTarget> targets = discoveryService.discoverFromArticle(article);
                    totalDiscovered += targets.size();
                }
            } catch (Exception e) {
                log.warn("Failed to discover URLs from article: id={}, error={}", 
                        article.getId(), e.getMessage());
            }
        }

        if (totalDiscovered > 0) {
            log.info("AutoCrawl: Discovered {} URLs from {} articles", totalDiscovered, articles.size());
        }
    }

    // ========================================
    // Deep Search에서 URL 발견
    // ========================================

    /**
     * Deep Search 완료 시 URL 발견
     */
    @Async
    public void onDeepSearchCompleted(String searchId, String query, List<String> urls) {
        if (!autoCrawlEnabled || !discoverFromDeepSearch) {
            return;
        }

        if (urls == null || urls.isEmpty()) {
            return;
        }

        try {
            List<CrawlTarget> targets = discoveryService.discoverFromDeepSearch(searchId, query, urls);
            
            if (!targets.isEmpty()) {
                log.info("AutoCrawl: Discovered {} URLs from deep search id={}", targets.size(), searchId);
            }
        } catch (Exception e) {
            log.warn("Failed to discover URLs from deep search: id={}, error={}", searchId, e.getMessage());
        }
    }

    /**
     * AI 분석 결과에서 URL 추출 및 발견
     */
    @Async
    public void onAiAnalysisCompleted(String context, String aiResponse, String keywords) {
        if (!autoCrawlEnabled) {
            return;
        }

        if (aiResponse == null || aiResponse.isBlank()) {
            return;
        }

        try {
            // AI 응답에서 URL 추출
            List<String> extractedUrls = extractUrlsFromText(aiResponse);
            
            if (!extractedUrls.isEmpty()) {
                List<CrawlTarget> targets = discoveryService.discoverFromAiRecommendation(
                        context, extractedUrls, keywords);
                
                if (!targets.isEmpty()) {
                    log.info("AutoCrawl: Discovered {} URLs from AI analysis", targets.size());
                }
            }
        } catch (Exception e) {
            log.warn("Failed to discover URLs from AI analysis: error={}", e.getMessage());
        }
    }

    // ========================================
    // 트렌딩 토픽에서 URL 발견
    // ========================================

    /**
     * 트렌딩 토픽 감지 시 URL 발견
     */
    @Async
    public void onTrendingTopicDetected(String topic, List<String> relatedUrls) {
        if (!autoCrawlEnabled) {
            return;
        }

        if (relatedUrls == null || relatedUrls.isEmpty()) {
            return;
        }

        try {
            List<CrawlTarget> targets = discoveryService.discoverFromTrendingTopic(topic, relatedUrls);
            
            if (!targets.isEmpty()) {
                log.info("AutoCrawl: Discovered {} URLs from trending topic '{}'", targets.size(), topic);
                
                // 트렌딩 토픽은 높은 우선순위로 즉시 처리 트리거
                queueService.prioritizeKeyword(topic, 30);
            }
        } catch (Exception e) {
            log.warn("Failed to discover URLs from trending topic: topic='{}', error={}", 
                    topic, e.getMessage());
        }
    }

    // ========================================
    // 크롤링 완료 콜백 처리
    // ========================================

    /**
     * 크롤링 완료 시 결과 처리
     */
    public void onCrawlCompleted(String url, Long collectedDataId) {
        if (!autoCrawlEnabled) {
            return;
        }

        try {
            queueService.handleCrawlCompleteByUrl(url, collectedDataId);
        } catch (Exception e) {
            log.warn("Failed to handle crawl completion: url={}, error={}", url, e.getMessage());
        }
    }

    /**
     * 크롤링 실패 시 결과 처리
     */
    public void onCrawlFailed(String url, String errorMessage) {
        if (!autoCrawlEnabled) {
            return;
        }

        try {
            queueService.handleCrawlFailedByUrl(url, errorMessage);
        } catch (Exception e) {
            log.warn("Failed to handle crawl failure: url={}, error={}", url, e.getMessage());
        }
    }

    // ========================================
    // 유틸리티
    // ========================================

    /**
     * 텍스트에서 URL 추출
     */
    private List<String> extractUrlsFromText(String text) {
        Matcher matcher = URL_PATTERN.matcher(text);
        return matcher.results()
                .map(m -> m.group())
                .distinct()
                .collect(Collectors.toList());
    }

    /**
     * AutoCrawl 활성화 여부 확인
     */
    public boolean isEnabled() {
        return autoCrawlEnabled;
    }
}
