package com.newsinsight.collector.service;

import com.newsinsight.collector.dto.DashboardEventDto;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 대시보드 실시간 이벤트 서비스.
 * SSE를 통해 클라이언트에 이벤트를 푸시하는 기능을 제공합니다.
 */
@Service
@Slf4j
public class DashboardEventService {

    private final Sinks.Many<DashboardEventDto> eventSink;
    
    // 간단한 통계 카운터 (실제 환경에서는 DB나 Redis에서 조회)
    private final AtomicLong totalCollected = new AtomicLong(0);
    private final AtomicLong activeSourceCount = new AtomicLong(0);
    private final AtomicLong todayCollected = new AtomicLong(0);

    public DashboardEventService() {
        this.eventSink = Sinks.many().multicast().onBackpressureBuffer();
    }

    /**
     * 이벤트 스트림을 구독합니다.
     * 
     * @return 이벤트 Flux
     */
    public Flux<DashboardEventDto> getEventStream() {
        return eventSink.asFlux()
                .doOnSubscribe(sub -> log.debug("New subscriber connected to event stream"))
                .doOnCancel(() -> log.debug("Subscriber disconnected from event stream"));
    }

    /**
     * 이벤트를 발행합니다.
     * 
     * @param event 발행할 이벤트
     */
    public void publishEvent(DashboardEventDto event) {
        log.debug("Publishing event: {}", event.getEventType());
        eventSink.tryEmitNext(event);
    }

    /**
     * 새 데이터 수집 이벤트를 발행합니다.
     * 
     * @param sourceId 소스 ID
     * @param count 수집된 항목 수
     */
    public void notifyNewData(String sourceId, int count) {
        totalCollected.addAndGet(count);
        todayCollected.addAndGet(count);
        
        Map<String, Object> data = new HashMap<>();
        data.put("sourceId", sourceId);
        data.put("count", count);
        data.put("totalCollected", totalCollected.get());
        
        publishEvent(DashboardEventDto.newData(
                "Collected " + count + " items from " + sourceId, 
                data
        ));
    }

    /**
     * 소스 상태 변경 이벤트를 발행합니다.
     * 
     * @param sourceId 소스 ID
     * @param status 새 상태
     */
    public void notifySourceUpdated(String sourceId, String status) {
        publishEvent(DashboardEventDto.sourceUpdated(sourceId, status));
    }

    /**
     * 현재 통계를 조회합니다.
     * 
     * @return 통계 이벤트 Mono
     */
    public Mono<DashboardEventDto> getCurrentStats() {
        Map<String, Object> stats = new HashMap<>();
        stats.put("totalCollected", totalCollected.get());
        stats.put("todayCollected", todayCollected.get());
        stats.put("activeSourceCount", activeSourceCount.get());
        stats.put("timestamp", System.currentTimeMillis());
        
        return Mono.just(DashboardEventDto.statsUpdated(stats));
    }

    /**
     * 활성 소스 수를 업데이트합니다.
     * 
     * @param count 활성 소스 수
     */
    public void updateActiveSourceCount(long count) {
        activeSourceCount.set(count);
    }

    /**
     * 일일 통계를 리셋합니다. (스케줄러에서 호출)
     */
    public void resetDailyStats() {
        todayCollected.set(0);
        log.info("Daily stats reset");
    }

    /**
     * 에러 이벤트를 발행합니다.
     * 
     * @param message 에러 메시지
     */
    public void notifyError(String message) {
        publishEvent(DashboardEventDto.error(message));
    }
}
