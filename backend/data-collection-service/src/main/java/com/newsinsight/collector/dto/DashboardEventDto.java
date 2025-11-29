package com.newsinsight.collector.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.Map;

/**
 * 대시보드 실시간 이벤트 DTO.
 * SSE를 통해 클라이언트에 전송되는 이벤트 데이터를 담습니다.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class DashboardEventDto {

    /**
     * 이벤트 타입
     */
    private EventType eventType;

    /**
     * 이벤트 발생 시각
     */
    @Builder.Default
    private Instant timestamp = Instant.now();

    /**
     * 이벤트 메시지
     */
    private String message;

    /**
     * 추가 데이터 (이벤트 타입에 따라 다름)
     */
    private Map<String, Object> data;

    /**
     * 이벤트 타입 열거형
     */
    public enum EventType {
        HEARTBEAT,      // 연결 유지용 하트비트
        NEW_DATA,       // 새로운 데이터 수집됨
        SOURCE_UPDATED, // 소스 상태 변경
        STATS_UPDATED,  // 통계 갱신
        COLLECTION_STARTED,  // 수집 시작
        COLLECTION_COMPLETED, // 수집 완료
        ERROR           // 에러 발생
    }

    /**
     * 하트비트 이벤트 생성
     */
    public static DashboardEventDto heartbeat() {
        return DashboardEventDto.builder()
                .eventType(EventType.HEARTBEAT)
                .message("Connection alive")
                .build();
    }

    /**
     * 새 데이터 수집 이벤트 생성
     */
    public static DashboardEventDto newData(String message, Map<String, Object> data) {
        return DashboardEventDto.builder()
                .eventType(EventType.NEW_DATA)
                .message(message)
                .data(data)
                .build();
    }

    /**
     * 통계 갱신 이벤트 생성
     */
    public static DashboardEventDto statsUpdated(Map<String, Object> stats) {
        return DashboardEventDto.builder()
                .eventType(EventType.STATS_UPDATED)
                .message("Statistics updated")
                .data(stats)
                .build();
    }

    /**
     * 소스 업데이트 이벤트 생성
     */
    public static DashboardEventDto sourceUpdated(String sourceId, String status) {
        return DashboardEventDto.builder()
                .eventType(EventType.SOURCE_UPDATED)
                .message("Source " + sourceId + " status changed to " + status)
                .data(Map.of("sourceId", sourceId, "status", status))
                .build();
    }

    /**
     * 에러 이벤트 생성
     */
    public static DashboardEventDto error(String message) {
        return DashboardEventDto.builder()
                .eventType(EventType.ERROR)
                .message(message)
                .build();
    }
}
