package com.newsinsight.collector.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.service.AnalysisEventService;
import com.newsinsight.collector.service.FactVerificationService;
import com.newsinsight.collector.service.UnifiedSearchService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Flux;

import java.time.Duration;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 통합 검색 컨트롤러
 * 
 * 병렬 검색 및 심층 분석 기능을 SSE 스트리밍으로 제공합니다.
 * 특정 기술/API 이름을 노출하지 않고 통합된 경험을 제공합니다.
 */
@RestController
@RequestMapping("/api/v1/search")
@RequiredArgsConstructor
@Slf4j
public class UnifiedSearchController {

    private final UnifiedSearchService unifiedSearchService;
    private final FactVerificationService factVerificationService;
    private final AnalysisEventService analysisEventService;
    private final ObjectMapper objectMapper;

    /**
     * 통합 병렬 검색 (SSE 스트리밍)
     * 
     * DB, 웹, AI 검색을 병렬로 실행하고 결과가 나오는 대로 스트리밍합니다.
     * 
     * @param query 검색어
     * @param window 시간 범위 (1d, 7d, 30d)
     * @return SSE 이벤트 스트림
     */
    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> streamSearch(
            @RequestParam String query,
            @RequestParam(defaultValue = "7d") String window
    ) {
        log.info("Starting streaming search for query: '{}', window: {}", query, window);

        // 즉시 연결 확인 이벤트 전송 (클라이언트가 연결 성공을 확인할 수 있도록)
        Flux<ServerSentEvent<String>> initialEvent = Flux.just(
                ServerSentEvent.<String>builder()
                        .id("init")
                        .event("connected")
                        .data("{\"message\": \"검색 시스템에 연결되었습니다. 병렬 검색을 시작합니다...\", \"query\": \"" + query + "\"}")
                        .build()
        );

        Flux<ServerSentEvent<String>> searchEvents = unifiedSearchService.searchParallel(query, window)
                .map(event -> {
                    try {
                        String data = objectMapper.writeValueAsString(event);
                        return ServerSentEvent.<String>builder()
                                .id(java.util.UUID.randomUUID().toString())
                                .event(event.getEventType())
                                .data(data)
                                .build();
                    } catch (Exception e) {
                        log.error("Failed to serialize search event: {}", e.getMessage());
                        return ServerSentEvent.<String>builder()
                                .event("error")
                                .data("{\"error\": \"Serialization failed\"}")
                                .build();
                    }
                });

        Flux<ServerSentEvent<String>> doneEvent = Flux.just(
                ServerSentEvent.<String>builder()
                        .event("done")
                        .data("{\"message\": \"Search completed\"}")
                        .build()
        );

        return Flux.concat(initialEvent, searchEvents, doneEvent)
                .doOnError(e -> log.error("Stream search error: {}", e.getMessage()))
                .timeout(Duration.ofMinutes(2))
                .onErrorResume(e -> Flux.just(
                        ServerSentEvent.<String>builder()
                                .event("error")
                                .data("{\"error\": \"" + e.getMessage() + "\"}")
                                .build()
                ));
    }

    /**
     * 심층 분석 및 팩트 검증 (SSE 스트리밍)
     * 
     * 주어진 주제에 대해 Wikipedia 등 신뢰할 수 있는 출처와 대조하여
     * 타당성을 검증하고 심층 분석을 수행합니다.
     * 
     * @param request 분석 요청 (topic, claims)
     * @return SSE 이벤트 스트림
     */
    @PostMapping(value = "/deep/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> streamDeepAnalysis(
            @RequestBody DeepAnalysisRequest request
    ) {
        log.info("Starting deep analysis for topic: '{}'", request.getTopic());

        return factVerificationService.analyzeAndVerify(request.getTopic(), request.getClaims())
                .map(event -> {
                    try {
                        String data = objectMapper.writeValueAsString(event);
                        return ServerSentEvent.<String>builder()
                                .id(java.util.UUID.randomUUID().toString())
                                .event(event.getEventType())
                                .data(data)
                                .build();
                    } catch (Exception e) {
                        log.error("Failed to serialize deep analysis event: {}", e.getMessage());
                        return ServerSentEvent.<String>builder()
                                .event("error")
                                .data("{\"error\": \"Serialization failed\"}")
                                .build();
                    }
                })
                .concatWith(Flux.just(
                        ServerSentEvent.<String>builder()
                                .event("done")
                                .data("{\"message\": \"Analysis completed\"}")
                                .build()
                ))
                .timeout(Duration.ofMinutes(3))
                .onErrorResume(e -> Flux.just(
                        ServerSentEvent.<String>builder()
                                .event("error")
                                .data("{\"error\": \"" + e.getMessage() + "\"}")
                                .build()
                ));
    }

    /**
     * 검색 서비스 상태 확인
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        return ResponseEntity.ok(Map.of(
                "status", "available",
                "features", Map.of(
                        "parallelSearch", true,
                        "deepAnalysis", true,
                        "factVerification", true,
                        "analysisStreaming", true
                ),
                "description", "통합 검색 및 심층 분석 서비스"
        ));
    }

    /**
     * 분석 결과 실시간 업데이트 스트림 (SSE)
     * 
     * 특정 기사 ID들의 분석 완료 이벤트를 실시간으로 구독합니다.
     * 검색 결과 페이지에서 분석 중인 기사들의 상태를 실시간으로 업데이트할 때 사용합니다.
     * 
     * @param articleIds 구독할 기사 ID 목록 (comma-separated)
     * @return SSE 이벤트 스트림
     */
    @GetMapping(value = "/analysis/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<Object>> streamAnalysisUpdates(
            @RequestParam(required = false) String articleIds
    ) {
        Set<Long> ids = new HashSet<>();
        if (articleIds != null && !articleIds.isBlank()) {
            try {
                for (String idStr : articleIds.split(",")) {
                    ids.add(Long.parseLong(idStr.trim()));
                }
            } catch (NumberFormatException e) {
                log.warn("Invalid article IDs format: {}", articleIds);
            }
        }

        log.info("Starting analysis stream for {} article IDs", ids.size());

        return analysisEventService.subscribeToAnalysisUpdates(ids)
                .timeout(Duration.ofMinutes(30))
                .onErrorResume(e -> {
                    log.error("Analysis stream error: {}", e.getMessage());
                    return Flux.just(
                            ServerSentEvent.builder()
                                    .event("error")
                                    .data(Map.of("error", e.getMessage()))
                                    .build()
                    );
                });
    }

    /**
     * 분석 구독 기사 추가
     * 
     * @param articleIds 추가할 기사 ID 목록
     */
    @PostMapping("/analysis/watch")
    public ResponseEntity<Map<String, Object>> watchArticles(@RequestBody List<Long> articleIds) {
        if (articleIds != null && !articleIds.isEmpty()) {
            analysisEventService.watchArticles(new HashSet<>(articleIds));
        }
        return ResponseEntity.ok(Map.of(
                "message", "Articles added to watch list",
                "watchedCount", analysisEventService.getWatchedCount()
        ));
    }

    /**
     * 분석 스트리밍 상태 확인
     */
    @GetMapping("/analysis/stream/status")
    public ResponseEntity<Map<String, Object>> analysisStreamStatus() {
        return ResponseEntity.ok(Map.of(
                "subscriberCount", analysisEventService.getSubscriberCount(),
                "watchedArticleCount", analysisEventService.getWatchedCount()
        ));
    }

    // ============================================
    // Request DTOs
    // ============================================

    public static class DeepAnalysisRequest {
        private String topic;
        private List<String> claims;

        public String getTopic() {
            return topic;
        }

        public void setTopic(String topic) {
            this.topic = topic;
        }

        public List<String> getClaims() {
            return claims;
        }

        public void setClaims(List<String> claims) {
            this.claims = claims;
        }
    }
}
