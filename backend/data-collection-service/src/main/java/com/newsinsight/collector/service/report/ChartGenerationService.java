package com.newsinsight.collector.service.report;

import com.newsinsight.collector.dto.report.ChartData;
import lombok.extern.slf4j.Slf4j;
import org.jfree.chart.ChartFactory;
import org.jfree.chart.ChartUtils;
import org.jfree.chart.JFreeChart;
import org.jfree.chart.plot.CategoryPlot;
import org.jfree.chart.plot.PiePlot;
import org.jfree.chart.plot.PlotOrientation;
import org.jfree.chart.plot.XYPlot;
import org.jfree.chart.renderer.category.BarRenderer;
import org.jfree.chart.renderer.xy.XYLineAndShapeRenderer;
import org.jfree.chart.title.TextTitle;
import org.jfree.data.category.DefaultCategoryDataset;
import org.jfree.data.general.DefaultPieDataset;
import org.jfree.data.xy.XYSeries;
import org.jfree.data.xy.XYSeriesCollection;
import org.springframework.stereotype.Service;

import java.awt.*;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.List;

/**
 * 서버 사이드 차트 생성 서비스
 * 
 * JFreeChart를 사용하여 PDF에 삽입할 차트 이미지를 생성합니다.
 */
@Service
@Slf4j
public class ChartGenerationService {

    // 색상 팔레트
    private static final Color[] DEFAULT_COLORS = {
            new Color(59, 130, 246),   // Blue
            new Color(16, 185, 129),   // Green
            new Color(245, 158, 11),   // Yellow/Orange
            new Color(239, 68, 68),    // Red
            new Color(139, 92, 246),   // Purple
            new Color(236, 72, 153),   // Pink
            new Color(20, 184, 166),   // Teal
            new Color(249, 115, 22),   // Orange
    };

    private static final Color BACKGROUND_COLOR = Color.WHITE;
    private static final Color TEXT_COLOR = new Color(30, 41, 59);
    private static final Color GRID_COLOR = new Color(226, 232, 240);

    /**
     * 파이 차트 생성
     */
    public byte[] generatePieChart(ChartData chartData) throws IOException {
        DefaultPieDataset<String> dataset = new DefaultPieDataset<>();
        
        List<String> labels = chartData.getLabels();
        List<Number> values = chartData.getValues();
        
        for (int i = 0; i < labels.size(); i++) {
            dataset.setValue(labels.get(i), values.get(i));
        }
        
        JFreeChart chart = ChartFactory.createPieChart(
                chartData.getTitle(),
                dataset,
                true,   // legend
                true,   // tooltips
                false   // urls
        );
        
        // 스타일링
        chart.setBackgroundPaint(BACKGROUND_COLOR);
        chart.getTitle().setPaint(TEXT_COLOR);
        chart.getTitle().setFont(new Font("SansSerif", Font.BOLD, 16));
        
        PiePlot plot = (PiePlot) chart.getPlot();
        plot.setBackgroundPaint(BACKGROUND_COLOR);
        plot.setOutlineVisible(false);
        plot.setShadowPaint(null);
        plot.setLabelFont(new Font("SansSerif", Font.PLAIN, 12));
        plot.setLabelPaint(TEXT_COLOR);
        
        // 색상 적용
        List<String> colors = chartData.getColors();
        for (int i = 0; i < labels.size(); i++) {
            Color color = colors != null && i < colors.size() 
                    ? Color.decode(colors.get(i)) 
                    : DEFAULT_COLORS[i % DEFAULT_COLORS.length];
            plot.setSectionPaint(labels.get(i), color);
        }
        
        return chartToBytes(chart, chartData.getWidth(), chartData.getHeight());
    }

    /**
     * 도넛 차트 생성
     */
    public byte[] generateDoughnutChart(ChartData chartData) throws IOException {
        // JFreeChart에서 도넛 차트는 RingPlot 사용 (파이 차트와 유사하게 처리)
        return generatePieChart(chartData);  // 간단히 파이 차트로 대체
    }

    /**
     * 바 차트 생성
     */
    public byte[] generateBarChart(ChartData chartData) throws IOException {
        DefaultCategoryDataset dataset = new DefaultCategoryDataset();
        
        List<String> labels = chartData.getLabels();
        List<Number> values = chartData.getValues();
        
        for (int i = 0; i < labels.size(); i++) {
            dataset.addValue(values.get(i), "데이터", labels.get(i));
        }
        
        JFreeChart chart = ChartFactory.createBarChart(
                chartData.getTitle(),
                chartData.getXAxisLabel(),
                chartData.getYAxisLabel(),
                dataset,
                PlotOrientation.VERTICAL,
                false,  // legend
                true,   // tooltips
                false   // urls
        );
        
        // 스타일링
        chart.setBackgroundPaint(BACKGROUND_COLOR);
        chart.getTitle().setPaint(TEXT_COLOR);
        chart.getTitle().setFont(new Font("SansSerif", Font.BOLD, 16));
        
        CategoryPlot plot = chart.getCategoryPlot();
        plot.setBackgroundPaint(BACKGROUND_COLOR);
        plot.setRangeGridlinePaint(GRID_COLOR);
        plot.setOutlineVisible(false);
        
        BarRenderer renderer = (BarRenderer) plot.getRenderer();
        renderer.setSeriesPaint(0, DEFAULT_COLORS[0]);
        renderer.setDrawBarOutline(false);
        renderer.setShadowVisible(false);
        
        return chartToBytes(chart, chartData.getWidth(), chartData.getHeight());
    }

    /**
     * 수평 바 차트 생성
     */
    public byte[] generateHorizontalBarChart(ChartData chartData) throws IOException {
        DefaultCategoryDataset dataset = new DefaultCategoryDataset();
        
        List<String> labels = chartData.getLabels();
        List<Number> values = chartData.getValues();
        
        for (int i = 0; i < labels.size(); i++) {
            dataset.addValue(values.get(i), "데이터", labels.get(i));
        }
        
        JFreeChart chart = ChartFactory.createBarChart(
                chartData.getTitle(),
                chartData.getXAxisLabel(),
                chartData.getYAxisLabel(),
                dataset,
                PlotOrientation.HORIZONTAL,
                false,
                true,
                false
        );
        
        // 스타일링
        chart.setBackgroundPaint(BACKGROUND_COLOR);
        chart.getTitle().setPaint(TEXT_COLOR);
        
        CategoryPlot plot = chart.getCategoryPlot();
        plot.setBackgroundPaint(BACKGROUND_COLOR);
        plot.setRangeGridlinePaint(GRID_COLOR);
        
        BarRenderer renderer = (BarRenderer) plot.getRenderer();
        renderer.setSeriesPaint(0, DEFAULT_COLORS[0]);
        renderer.setDrawBarOutline(false);
        
        return chartToBytes(chart, chartData.getWidth(), chartData.getHeight());
    }

    /**
     * 라인 차트 생성
     */
    public byte[] generateLineChart(ChartData chartData) throws IOException {
        XYSeriesCollection dataset = new XYSeriesCollection();
        
        List<ChartData.DataSeries> seriesList = chartData.getSeries();
        if (seriesList != null) {
            for (ChartData.DataSeries seriesData : seriesList) {
                XYSeries series = new XYSeries(seriesData.getName());
                List<Number> data = seriesData.getData();
                for (int i = 0; i < data.size(); i++) {
                    series.add(i, data.get(i));
                }
                dataset.addSeries(series);
            }
        } else if (chartData.getValues() != null) {
            XYSeries series = new XYSeries("데이터");
            List<Number> values = chartData.getValues();
            for (int i = 0; i < values.size(); i++) {
                series.add(i, values.get(i));
            }
            dataset.addSeries(series);
        }
        
        JFreeChart chart = ChartFactory.createXYLineChart(
                chartData.getTitle(),
                chartData.getXAxisLabel(),
                chartData.getYAxisLabel(),
                dataset,
                PlotOrientation.VERTICAL,
                true,
                true,
                false
        );
        
        // 스타일링
        chart.setBackgroundPaint(BACKGROUND_COLOR);
        chart.getTitle().setPaint(TEXT_COLOR);
        chart.getTitle().setFont(new Font("SansSerif", Font.BOLD, 16));
        
        XYPlot plot = chart.getXYPlot();
        plot.setBackgroundPaint(BACKGROUND_COLOR);
        plot.setRangeGridlinePaint(GRID_COLOR);
        plot.setDomainGridlinePaint(GRID_COLOR);
        plot.setOutlineVisible(false);
        
        XYLineAndShapeRenderer renderer = new XYLineAndShapeRenderer();
        for (int i = 0; i < dataset.getSeriesCount(); i++) {
            renderer.setSeriesPaint(i, DEFAULT_COLORS[i % DEFAULT_COLORS.length]);
            renderer.setSeriesStroke(i, new BasicStroke(2.0f));
            renderer.setSeriesShapesVisible(i, true);
        }
        plot.setRenderer(renderer);
        
        return chartToBytes(chart, chartData.getWidth(), chartData.getHeight());
    }

    /**
     * 영역 차트 생성
     */
    public byte[] generateAreaChart(ChartData chartData) throws IOException {
        XYSeriesCollection dataset = new XYSeriesCollection();
        
        if (chartData.getValues() != null) {
            XYSeries series = new XYSeries("데이터");
            List<Number> values = chartData.getValues();
            for (int i = 0; i < values.size(); i++) {
                series.add(i, values.get(i));
            }
            dataset.addSeries(series);
        }
        
        JFreeChart chart = ChartFactory.createXYAreaChart(
                chartData.getTitle(),
                chartData.getXAxisLabel(),
                chartData.getYAxisLabel(),
                dataset,
                PlotOrientation.VERTICAL,
                false,
                true,
                false
        );
        
        // 스타일링
        chart.setBackgroundPaint(BACKGROUND_COLOR);
        chart.getTitle().setPaint(TEXT_COLOR);
        
        XYPlot plot = chart.getXYPlot();
        plot.setBackgroundPaint(BACKGROUND_COLOR);
        plot.setForegroundAlpha(0.65f);
        plot.getRenderer().setSeriesPaint(0, DEFAULT_COLORS[0]);
        
        return chartToBytes(chart, chartData.getWidth(), chartData.getHeight());
    }

    /**
     * 게이지 차트 생성 (간단한 미터 형태)
     */
    public byte[] generateGaugeChart(ChartData chartData) throws IOException {
        // JFreeChart에는 기본 게이지 차트가 없으므로 파이 차트로 시뮬레이션
        List<Number> values = chartData.getValues();
        double value = values.get(0).doubleValue();
        double min = values.size() > 1 ? values.get(1).doubleValue() : 0;
        double max = values.size() > 2 ? values.get(2).doubleValue() : 100;
        
        double percentage = ((value - min) / (max - min)) * 100;
        double remaining = 100 - percentage;
        
        DefaultPieDataset<String> dataset = new DefaultPieDataset<>();
        dataset.setValue("값", percentage);
        dataset.setValue("남은", remaining);
        
        JFreeChart chart = ChartFactory.createPieChart(
                chartData.getTitle(),
                dataset,
                false,
                true,
                false
        );
        
        // 스타일링
        chart.setBackgroundPaint(BACKGROUND_COLOR);
        chart.getTitle().setPaint(TEXT_COLOR);
        
        // 값 표시 추가
        TextTitle valueTitle = new TextTitle(String.format("%.0f", value));
        valueTitle.setFont(new Font("SansSerif", Font.BOLD, 24));
        valueTitle.setPaint(DEFAULT_COLORS[0]);
        chart.addSubtitle(valueTitle);
        
        PiePlot plot = (PiePlot) chart.getPlot();
        plot.setBackgroundPaint(BACKGROUND_COLOR);
        plot.setOutlineVisible(false);
        plot.setShadowPaint(null);
        plot.setLabelGenerator(null);  // 라벨 숨김
        
        // 색상: 값은 파란색, 남은 부분은 연한 회색
        Color gaugeColor = percentage >= 70 ? new Color(16, 185, 129) :
                           percentage >= 40 ? new Color(245, 158, 11) :
                           new Color(239, 68, 68);
        plot.setSectionPaint("값", gaugeColor);
        plot.setSectionPaint("남은", new Color(226, 232, 240));
        
        return chartToBytes(chart, chartData.getWidth(), chartData.getHeight());
    }

    /**
     * ChartData 타입에 따라 적절한 차트 생성
     */
    public byte[] generateChart(ChartData chartData) throws IOException {
        return switch (chartData.getChartType()) {
            case PIE -> generatePieChart(chartData);
            case DOUGHNUT -> generateDoughnutChart(chartData);
            case BAR -> generateBarChart(chartData);
            case HORIZONTAL_BAR -> generateHorizontalBarChart(chartData);
            case LINE -> generateLineChart(chartData);
            case AREA -> generateAreaChart(chartData);
            case GAUGE -> generateGaugeChart(chartData);
            case STACKED_BAR -> generateBarChart(chartData);  // 간단히 바 차트로 대체
            case HISTOGRAM -> generateBarChart(chartData);    // 간단히 바 차트로 대체
            case RADAR -> generatePieChart(chartData);        // 레이더는 파이로 대체
        };
    }

    /**
     * JFreeChart를 PNG 바이트 배열로 변환
     */
    private byte[] chartToBytes(JFreeChart chart, int width, int height) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        ChartUtils.writeChartAsPNG(baos, chart, width, height);
        return baos.toByteArray();
    }
}
