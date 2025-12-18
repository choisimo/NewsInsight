package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.DashboardEventDto;
import com.newsinsight.collector.service.DashboardEventService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;

import java.time.Duration;

/**
 * 대시보드 실시간 이벤트 스트리밍 컨트롤러.
 * SSE(Server-Sent Events)를 통해 클라이언트에 실시간 업데이트를 푸시합니다.
 */
@RestController
@RequestMapping("/api/v1/events")
@RequiredArgsConstructor
@Slf4j
public class DashboardEventController {

    private final DashboardEventService dashboardEventService;

    /**
     * 대시보드 이벤트 스트림.
     * 클라이언트는 이 엔드포인트에 연결하여 실시간 이벤트를 수신합니다.
     * 
     * 이벤트 타입:
     * - HEARTBEAT: 연결 유지용 (30초마다)
     * - NEW_DATA: 새로운 데이터 수집됨
     * - SOURCE_UPDATED: 소스 상태 변경
     * - STATS_UPDATED: 통계 갱신
     * 
     * @return SSE 스트림
     */
    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<DashboardEventDto>> streamEvents() {
        log.info("New SSE client connected to dashboard event stream");

        // 연결 확인 이벤트 (즉시 전송)
        Flux<ServerSentEvent<DashboardEventDto>> connected = Flux.just(
                ServerSentEvent.<DashboardEventDto>builder()
                        .event("connected")
                        .data(DashboardEventDto.heartbeat())
                        .build()
        );

        // 하트비트 스트림 (즉시 시작, 30초마다)
        Flux<ServerSentEvent<DashboardEventDto>> heartbeat = Flux.interval(Duration.ZERO, Duration.ofSeconds(30))
                .skip(1) // 첫 번째는 connected 이벤트로 대체
                .map(tick -> ServerSentEvent.<DashboardEventDto>builder()
                        .event("heartbeat")
                        .data(DashboardEventDto.heartbeat())
                        .build());

        // 이벤트 스트림
        Flux<ServerSentEvent<DashboardEventDto>> events = dashboardEventService.getEventStream()
                .map(event -> ServerSentEvent.<DashboardEventDto>builder()
                        .event(event.getEventType().name().toLowerCase())
                        .data(event)
                        .build());

        // 세 스트림 병합 (connected 먼저, 그 다음 heartbeat + events)
        return Flux.concat(connected, Flux.merge(heartbeat, events))
                .doOnCancel(() -> log.info("SSE client disconnected from dashboard event stream"))
                .doOnError(e -> log.error("SSE stream error", e));
    }

    /**
     * 데이터 통계 스트림.
     * 5초마다 최신 통계를 전송합니다.
     * 
     * @return SSE 스트림
     */
    @GetMapping(value = "/stats/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<DashboardEventDto>> streamStats() {
        log.debug("New SSE client connected to stats stream");

        return Flux.interval(Duration.ZERO, Duration.ofSeconds(5))
                .flatMap(tick -> dashboardEventService.getCurrentStats())
                .map(stats -> ServerSentEvent.<DashboardEventDto>builder()
                        .event("stats")
                        .data(stats)
                        .build())
                .doOnCancel(() -> log.debug("SSE client disconnected from stats stream"));
    }
}
