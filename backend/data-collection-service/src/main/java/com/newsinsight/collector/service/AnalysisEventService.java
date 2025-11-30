package com.newsinsight.collector.service;

import com.newsinsight.collector.entity.analysis.ArticleAnalysis;
import com.newsinsight.collector.entity.analysis.ArticleDiscussion;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Sinks;

import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * SSE 서비스 - 분석 결과 실시간 업데이트 알림
 * 
 * 프론트엔드가 특정 기사 ID들을 구독하면, 해당 기사의 분석이 완료될 때 알림을 받습니다.
 * 검색 결과 페이지에서 분석 중인 기사들의 상태를 실시간으로 업데이트할 때 사용합니다.
 */
@Service
@Slf4j
public class AnalysisEventService {

    // Global sink for all analysis updates (clients filter by articleId)
    private final Sinks.Many<ServerSentEvent<Object>> globalSink;
    
    // Track which article IDs are being watched
    private final Set<Long> watchedArticleIds = ConcurrentHashMap.newKeySet();
    
    // Subscriber count for cleanup
    private int subscriberCount = 0;

    public AnalysisEventService() {
        this.globalSink = Sinks.many().multicast().onBackpressureBuffer(500);
    }

    /**
     * Subscribe to analysis updates for specific article IDs.
     * 
     * @param articleIds Set of article IDs to watch
     * @return SSE event stream
     */
    public Flux<ServerSentEvent<Object>> subscribeToAnalysisUpdates(Set<Long> articleIds) {
        if (articleIds != null && !articleIds.isEmpty()) {
            watchedArticleIds.addAll(articleIds);
        }

        // Heartbeat stream
        Flux<ServerSentEvent<Object>> heartbeat = Flux.interval(Duration.ofSeconds(20))
                .map(tick -> ServerSentEvent.builder()
                        .event("heartbeat")
                        .data(Map.of("timestamp", System.currentTimeMillis()))
                        .build());

        // Filter events by article IDs if provided
        Flux<ServerSentEvent<Object>> events = globalSink.asFlux()
                .filter(event -> {
                    if (articleIds == null || articleIds.isEmpty()) {
                        return true; // No filter, receive all
                    }
                    Object data = event.data();
                    if (data instanceof Map<?, ?> dataMap) {
                        Object articleId = dataMap.get("articleId");
                        if (articleId instanceof Long id) {
                            return articleIds.contains(id);
                        }
                    }
                    return false;
                });

        return Flux.merge(heartbeat, events)
                .doOnSubscribe(sub -> {
                    subscriberCount++;
                    log.debug("New analysis updates subscriber, total: {}", subscriberCount);
                })
                .doOnCancel(() -> {
                    subscriberCount--;
                    log.debug("Analysis updates subscriber disconnected, total: {}", subscriberCount);
                    // Clean up watched IDs if no more subscribers
                    if (subscriberCount <= 0) {
                        watchedArticleIds.clear();
                    }
                });
    }

    /**
     * Publish analysis started event.
     * 
     * @param articleId The article ID
     * @param addonKey The addon that started analysis
     */
    public void publishAnalysisStarted(Long articleId, String addonKey) {
        if (!watchedArticleIds.contains(articleId)) return;

        ServerSentEvent<Object> event = ServerSentEvent.builder()
                .event("analysis_started")
                .data(Map.of(
                        "articleId", articleId,
                        "addonKey", addonKey,
                        "timestamp", System.currentTimeMillis()
                ))
                .build();

        globalSink.tryEmitNext(event);
        log.debug("Published analysis_started for article: {}, addon: {}", articleId, addonKey);
    }

    /**
     * Publish analysis progress event.
     * 
     * @param articleId The article ID
     * @param addonKey The addon processing
     * @param progress Progress percentage (0-100)
     */
    public void publishAnalysisProgress(Long articleId, String addonKey, int progress) {
        if (!watchedArticleIds.contains(articleId)) return;

        ServerSentEvent<Object> event = ServerSentEvent.builder()
                .event("analysis_progress")
                .data(Map.of(
                        "articleId", articleId,
                        "addonKey", addonKey,
                        "progress", progress,
                        "timestamp", System.currentTimeMillis()
                ))
                .build();

        globalSink.tryEmitNext(event);
    }

    /**
     * Publish partial analysis result (single addon completed).
     * 
     * @param articleId The article ID
     * @param addonKey The addon that completed
     * @param result The partial result data
     */
    public void publishPartialResult(Long articleId, String addonKey, Map<String, Object> result) {
        if (!watchedArticleIds.contains(articleId)) return;

        ServerSentEvent<Object> event = ServerSentEvent.builder()
                .event("analysis_partial")
                .data(Map.of(
                        "articleId", articleId,
                        "addonKey", addonKey,
                        "result", result,
                        "timestamp", System.currentTimeMillis()
                ))
                .build();

        globalSink.tryEmitNext(event);
        log.debug("Published partial analysis for article: {}, addon: {}", articleId, addonKey);
    }

    /**
     * Publish full analysis complete event.
     * 
     * @param articleId The article ID
     * @param analysis The complete analysis result
     */
    public void publishAnalysisComplete(Long articleId, ArticleAnalysis analysis) {
        ServerSentEvent<Object> event = ServerSentEvent.builder()
                .event("analysis_complete")
                .data(Map.of(
                        "articleId", articleId,
                        "analysis", Map.of(
                                "reliabilityScore", analysis.getReliabilityScore() != null ? analysis.getReliabilityScore() : 0,
                                "reliabilityGrade", analysis.getReliabilityGrade() != null ? analysis.getReliabilityGrade() : "unknown",
                                "reliabilityColor", analysis.getReliabilityColor(),
                                "sentimentLabel", analysis.getSentimentLabel() != null ? analysis.getSentimentLabel() : "neutral",
                                "sentimentScore", analysis.getSentimentScore() != null ? analysis.getSentimentScore() : 0,
                                "biasLabel", analysis.getBiasLabel(),
                                "biasScore", analysis.getBiasScore(),
                                "factcheckStatus", analysis.getFactcheckStatus(),
                                "misinfoRisk", analysis.getMisinfoRisk(),
                                "riskTags", analysis.getRiskTags(),
                                "topics", analysis.getTopics(),
                                "summary", analysis.getSummary(),
                                "fullyAnalyzed", analysis.getFullyAnalyzed()
                        ),
                        "timestamp", System.currentTimeMillis()
                ))
                .build();

        globalSink.tryEmitNext(event);
        log.info("Published analysis_complete for article: {}", articleId);
        
        // Remove from watched list
        watchedArticleIds.remove(articleId);
    }

    /**
     * Publish discussion analysis complete event.
     * 
     * @param articleId The article ID
     * @param discussion The discussion analysis result
     */
    public void publishDiscussionComplete(Long articleId, ArticleDiscussion discussion) {
        ServerSentEvent<Object> event = ServerSentEvent.builder()
                .event("discussion_complete")
                .data(Map.of(
                        "articleId", articleId,
                        "discussion", Map.of(
                                "totalCommentCount", discussion.getTotalCommentCount() != null ? discussion.getTotalCommentCount() : 0,
                                "overallSentiment", discussion.getOverallSentiment() != null ? discussion.getOverallSentiment() : "unknown",
                                "sentimentDistribution", discussion.getSentimentDistribution() != null ? discussion.getSentimentDistribution() : Map.of(),
                                "discussionQualityScore", discussion.getDiscussionQualityScore(),
                                "stanceDistribution", discussion.getStanceDistribution(),
                                "suspiciousPatternDetected", discussion.getSuspiciousPatternDetected()
                        ),
                        "timestamp", System.currentTimeMillis()
                ))
                .build();

        globalSink.tryEmitNext(event);
        log.info("Published discussion_complete for article: {}", articleId);
    }

    /**
     * Publish analysis error event.
     * 
     * @param articleId The article ID
     * @param addonKey The addon that failed
     * @param errorMessage Error description
     */
    public void publishAnalysisError(Long articleId, String addonKey, String errorMessage) {
        if (!watchedArticleIds.contains(articleId)) return;

        ServerSentEvent<Object> event = ServerSentEvent.builder()
                .event("analysis_error")
                .data(Map.of(
                        "articleId", articleId,
                        "addonKey", addonKey != null ? addonKey : "unknown",
                        "error", errorMessage,
                        "timestamp", System.currentTimeMillis()
                ))
                .build();

        globalSink.tryEmitNext(event);
        log.warn("Published analysis_error for article: {}, addon: {}", articleId, addonKey);
    }

    /**
     * Add article IDs to watch list.
     * 
     * @param articleIds Article IDs to watch
     */
    public void watchArticles(Set<Long> articleIds) {
        if (articleIds != null) {
            watchedArticleIds.addAll(articleIds);
        }
    }

    /**
     * Remove article ID from watch list.
     * 
     * @param articleId Article ID to stop watching
     */
    public void unwatchArticle(Long articleId) {
        watchedArticleIds.remove(articleId);
    }

    /**
     * Check if an article is being watched.
     * 
     * @param articleId The article ID
     * @return true if being watched
     */
    public boolean isWatched(Long articleId) {
        return watchedArticleIds.contains(articleId);
    }

    /**
     * Get count of watched articles.
     * 
     * @return Count of watched article IDs
     */
    public int getWatchedCount() {
        return watchedArticleIds.size();
    }

    /**
     * Get subscriber count.
     * 
     * @return Number of active subscribers
     */
    public int getSubscriberCount() {
        return subscriberCount;
    }
}
