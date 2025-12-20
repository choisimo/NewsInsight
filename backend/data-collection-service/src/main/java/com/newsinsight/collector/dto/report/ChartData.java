package com.newsinsight.collector.dto.report;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 차트 데이터 DTO - 서버 사이드 차트 생성용
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ChartData {

    /**
     * 차트 유형
     */
    private ChartType chartType;

    /**
     * 차트 제목
     */
    private String title;

    /**
     * X축 라벨
     */
    private String xAxisLabel;

    /**
     * Y축 라벨
     */
    private String yAxisLabel;

    /**
     * 데이터 라벨 목록
     */
    private List<String> labels;

    /**
     * 데이터 값 목록
     */
    private List<Number> values;

    /**
     * 다중 시리즈 데이터
     */
    private List<DataSeries> series;

    /**
     * 색상 팔레트
     */
    private List<String> colors;

    /**
     * 차트 너비 (픽셀)
     */
    @Builder.Default
    private int width = 600;

    /**
     * 차트 높이 (픽셀)
     */
    @Builder.Default
    private int height = 400;

    /**
     * 차트 유형 Enum
     */
    public enum ChartType {
        PIE,            // 파이 차트
        DOUGHNUT,       // 도넛 차트
        BAR,            // 바 차트
        HORIZONTAL_BAR, // 수평 바 차트
        LINE,           // 라인 차트
        AREA,           // 영역 차트
        RADAR,          // 레이더 차트
        GAUGE,          // 게이지 차트
        STACKED_BAR,    // 스택 바 차트
        HISTOGRAM       // 히스토그램
    }

    /**
     * 데이터 시리즈 (다중 라인/바 차트용)
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DataSeries {
        private String name;
        private List<Number> data;
        private String color;
    }

    // ===== 빌더 헬퍼 메서드 =====

    /**
     * 파이 차트 생성 헬퍼
     */
    public static ChartData pie(String title, List<String> labels, List<Number> values, List<String> colors) {
        return ChartData.builder()
                .chartType(ChartType.PIE)
                .title(title)
                .labels(labels)
                .values(values)
                .colors(colors)
                .build();
    }

    /**
     * 바 차트 생성 헬퍼
     */
    public static ChartData bar(String title, String xLabel, String yLabel, List<String> labels, List<Number> values) {
        return ChartData.builder()
                .chartType(ChartType.BAR)
                .title(title)
                .xAxisLabel(xLabel)
                .yAxisLabel(yLabel)
                .labels(labels)
                .values(values)
                .build();
    }

    /**
     * 라인 차트 생성 헬퍼
     */
    public static ChartData line(String title, String xLabel, String yLabel, List<String> labels, List<DataSeries> series) {
        return ChartData.builder()
                .chartType(ChartType.LINE)
                .title(title)
                .xAxisLabel(xLabel)
                .yAxisLabel(yLabel)
                .labels(labels)
                .series(series)
                .build();
    }

    /**
     * 게이지 차트 생성 헬퍼
     */
    public static ChartData gauge(String title, double value, double min, double max) {
        return ChartData.builder()
                .chartType(ChartType.GAUGE)
                .title(title)
                .values(List.of(value, min, max))
                .build();
    }
}
