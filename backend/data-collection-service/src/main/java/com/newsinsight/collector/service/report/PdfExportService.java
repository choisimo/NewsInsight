package com.newsinsight.collector.service.report;

import com.itextpdf.io.font.PdfEncodings;
import com.itextpdf.io.image.ImageDataFactory;
import com.itextpdf.kernel.colors.ColorConstants;
import com.itextpdf.kernel.colors.DeviceRgb;
import com.itextpdf.kernel.font.PdfFont;
import com.itextpdf.kernel.font.PdfFontFactory;
import com.itextpdf.kernel.geom.PageSize;
import com.itextpdf.kernel.geom.Rectangle;
import com.itextpdf.kernel.pdf.PdfDocument;
import com.itextpdf.kernel.pdf.PdfPage;
import com.itextpdf.kernel.pdf.PdfWriter;
import com.itextpdf.layout.Document;
import com.itextpdf.layout.borders.Border;
import com.itextpdf.layout.borders.SolidBorder;
import com.itextpdf.layout.element.*;
import com.itextpdf.layout.properties.HorizontalAlignment;
import com.itextpdf.layout.properties.TextAlignment;
import com.itextpdf.layout.properties.UnitValue;
import com.itextpdf.layout.properties.VerticalAlignment;
import com.newsinsight.collector.dto.report.ChartData;
import com.newsinsight.collector.dto.report.ReportRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Base64;
import java.util.List;
import java.util.Map;

/**
 * PDF 생성 엔진 서비스
 * 
 * iText 7을 사용하여 PDF 문서를 생성합니다.
 * 한글 폰트 지원 및 차트 이미지 삽입 기능을 제공합니다.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class PdfExportService {

    private final ChartGenerationService chartGenerationService;

    // 색상 상수
    private static final DeviceRgb PRIMARY_COLOR = new DeviceRgb(59, 130, 246);    // Blue
    private static final DeviceRgb SUCCESS_COLOR = new DeviceRgb(16, 185, 129);    // Green
    private static final DeviceRgb WARNING_COLOR = new DeviceRgb(245, 158, 11);    // Yellow
    private static final DeviceRgb DANGER_COLOR = new DeviceRgb(239, 68, 68);      // Red
    private static final DeviceRgb NEUTRAL_COLOR = new DeviceRgb(107, 114, 128);   // Gray
    private static final DeviceRgb LIGHT_BG = new DeviceRgb(248, 250, 252);        // Light Gray BG

    // 폰트 경로 (클래스패스 또는 시스템)
    private static final String FONT_REGULAR = "fonts/NotoSansKR-Regular.ttf";
    private static final String FONT_BOLD = "fonts/NotoSansKR-Bold.ttf";

    /**
     * 통합 검색 보고서 PDF 생성
     */
    public byte[] generateUnifiedSearchReport(
            String title,
            String query,
            String timeWindow,
            Map<String, Object> summaryData,
            List<Map<String, Object>> results,
            Map<String, String> chartImages,
            List<ReportRequest.ReportSection> sections
    ) throws IOException {
        
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        PdfWriter writer = new PdfWriter(baos);
        PdfDocument pdf = new PdfDocument(writer);
        Document document = new Document(pdf, PageSize.A4);
        
        try {
            // 폰트 설정
            PdfFont regularFont = loadFont(FONT_REGULAR);
            PdfFont boldFont = loadFont(FONT_BOLD);
            document.setFont(regularFont);
            
            // 여백 설정
            document.setMargins(50, 50, 50, 50);
            
            // 1. 표지
            if (sections.contains(ReportRequest.ReportSection.COVER)) {
                addCoverPage(document, boldFont, title, query, timeWindow);
            }
            
            // 2. 요약
            if (sections.contains(ReportRequest.ReportSection.EXECUTIVE_SUMMARY)) {
                addExecutiveSummary(document, boldFont, regularFont, summaryData);
            }
            
            // 3. 데이터 소스 분석
            if (sections.contains(ReportRequest.ReportSection.DATA_SOURCE)) {
                addDataSourceAnalysis(document, boldFont, regularFont, results, chartImages);
            }
            
            // 4. 키워드 분석
            if (sections.contains(ReportRequest.ReportSection.KEYWORD_ANALYSIS)) {
                addKeywordAnalysis(document, boldFont, regularFont, summaryData, chartImages);
            }
            
            // 5. 감정 분석
            if (sections.contains(ReportRequest.ReportSection.SENTIMENT_ANALYSIS)) {
                addSentimentAnalysis(document, boldFont, regularFont, summaryData, chartImages);
            }
            
            // 6. 신뢰도 분석
            if (sections.contains(ReportRequest.ReportSection.RELIABILITY)) {
                addReliabilityAnalysis(document, boldFont, regularFont, summaryData, chartImages);
            }
            
            // 7. 상세 결과
            if (sections.contains(ReportRequest.ReportSection.DETAILED_RESULTS)) {
                addDetailedResults(document, boldFont, regularFont, results);
            }
            
            // 페이지 번호 추가
            addPageNumbers(pdf, regularFont);
            
        } finally {
            document.close();
        }
        
        return baos.toByteArray();
    }

    /**
     * 표지 페이지 추가
     */
    private void addCoverPage(Document document, PdfFont boldFont, String title, String query, String timeWindow) {
        // 상단 여백
        document.add(new Paragraph("\n\n\n\n\n\n"));
        
        // 로고 영역 (텍스트로 대체)
        Paragraph logo = new Paragraph("NewsInsight")
                .setFont(boldFont)
                .setFontSize(36)
                .setFontColor(PRIMARY_COLOR)
                .setTextAlignment(TextAlignment.CENTER);
        document.add(logo);
        
        // 부제목
        Paragraph subtitle = new Paragraph("뉴스 분석 플랫폼")
                .setFontSize(14)
                .setFontColor(NEUTRAL_COLOR)
                .setTextAlignment(TextAlignment.CENTER)
                .setMarginBottom(60);
        document.add(subtitle);
        
        // 구분선
        document.add(createDivider());
        
        // 보고서 제목
        Paragraph reportTitle = new Paragraph(title)
                .setFont(boldFont)
                .setFontSize(24)
                .setTextAlignment(TextAlignment.CENTER)
                .setMarginTop(40)
                .setMarginBottom(20);
        document.add(reportTitle);
        
        // 검색 쿼리
        Paragraph queryPara = new Paragraph("검색어: " + query)
                .setFontSize(16)
                .setFontColor(NEUTRAL_COLOR)
                .setTextAlignment(TextAlignment.CENTER)
                .setMarginBottom(10);
        document.add(queryPara);
        
        // 기간
        Paragraph periodPara = new Paragraph("분석 기간: " + formatTimeWindow(timeWindow))
                .setFontSize(14)
                .setFontColor(NEUTRAL_COLOR)
                .setTextAlignment(TextAlignment.CENTER)
                .setMarginBottom(60);
        document.add(periodPara);
        
        // 구분선
        document.add(createDivider());
        
        // 생성 일시
        String dateStr = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy년 MM월 dd일 HH:mm"));
        Paragraph datePara = new Paragraph("생성 일시: " + dateStr)
                .setFontSize(12)
                .setFontColor(NEUTRAL_COLOR)
                .setTextAlignment(TextAlignment.CENTER)
                .setMarginTop(40);
        document.add(datePara);
        
        // 페이지 나누기
        document.add(new AreaBreak());
    }

    /**
     * 요약 섹션 추가
     */
    @SuppressWarnings("unchecked")
    private void addExecutiveSummary(Document document, PdfFont boldFont, PdfFont regularFont, 
                                     Map<String, Object> summaryData) {
        // 섹션 제목
        document.add(createSectionTitle("요약 (Executive Summary)", boldFont));
        
        // 주요 통계 테이블
        Table statsTable = new Table(UnitValue.createPercentArray(new float[]{1, 1, 1, 1}))
                .useAllAvailableWidth()
                .setMarginBottom(20);
        
        int totalResults = getIntValue(summaryData, "totalResults", 0);
        int dbResults = getIntValue(summaryData, "dbResults", 0);
        int webResults = getIntValue(summaryData, "webResults", 0);
        int aiResults = getIntValue(summaryData, "aiResults", 0);
        
        statsTable.addCell(createStatCell("총 결과", String.valueOf(totalResults), boldFont, regularFont, PRIMARY_COLOR));
        statsTable.addCell(createStatCell("DB 검색", String.valueOf(dbResults), boldFont, regularFont, SUCCESS_COLOR));
        statsTable.addCell(createStatCell("웹 크롤링", String.valueOf(webResults), boldFont, regularFont, WARNING_COLOR));
        statsTable.addCell(createStatCell("AI 분석", String.valueOf(aiResults), boldFont, regularFont, DANGER_COLOR));
        
        document.add(statsTable);
        
        // AI 요약
        String aiSummary = (String) summaryData.get("aiSummary");
        if (aiSummary != null && !aiSummary.isBlank()) {
            document.add(new Paragraph("AI 분석 요약")
                    .setFont(boldFont)
                    .setFontSize(14)
                    .setMarginTop(20)
                    .setMarginBottom(10));
            
            // 요약 박스
            Div summaryBox = new Div()
                    .setBackgroundColor(LIGHT_BG)
                    .setPadding(15)
                    .setBorder(new SolidBorder(new DeviceRgb(226, 232, 240), 1))
                    .setMarginBottom(20);
            
            summaryBox.add(new Paragraph(truncateText(aiSummary, 5000))
                    .setFontSize(11)
                    .setFontColor(new DeviceRgb(51, 65, 85)));
            
            document.add(summaryBox);
        }
        
        // 주요 발견 사항
        List<String> keyFindings = (List<String>) summaryData.get("keyFindings");
        if (keyFindings != null && !keyFindings.isEmpty()) {
            document.add(new Paragraph("주요 발견 사항")
                    .setFont(boldFont)
                    .setFontSize(14)
                    .setMarginTop(10)
                    .setMarginBottom(10));
            
            com.itextpdf.layout.element.List findingsList = new com.itextpdf.layout.element.List()
                    .setSymbolIndent(12)
                    .setListSymbol("•");
            
            for (String finding : keyFindings) {
                ListItem item = new ListItem(finding);
                item.setFontSize(11);
                findingsList.add(item);
            }
            
            document.add(findingsList);
        }
        
        document.add(new AreaBreak());
    }

    /**
     * 데이터 소스 분석 섹션 추가
     */
    private void addDataSourceAnalysis(Document document, PdfFont boldFont, PdfFont regularFont,
                                       List<Map<String, Object>> results, Map<String, String> chartImages) {
        document.add(createSectionTitle("데이터 소스 분석", boldFont));
        
        // 소스별 분포 계산
        Map<String, Long> sourceDistribution = calculateSourceDistribution(results);
        
        // 통계 테이블
        Table table = new Table(UnitValue.createPercentArray(new float[]{2, 1, 1}))
                .useAllAvailableWidth()
                .setMarginBottom(20);
        
        table.addHeaderCell(createHeaderCell("소스", boldFont));
        table.addHeaderCell(createHeaderCell("결과 수", boldFont));
        table.addHeaderCell(createHeaderCell("비율", boldFont));
        
        long total = sourceDistribution.values().stream().mapToLong(Long::longValue).sum();
        
        sourceDistribution.forEach((source, count) -> {
            double percentage = total > 0 ? (count * 100.0 / total) : 0;
            table.addCell(createDataCell(formatSourceName(source), regularFont));
            table.addCell(createDataCell(String.valueOf(count), regularFont));
            table.addCell(createDataCell(String.format("%.1f%%", percentage), regularFont));
        });
        
        document.add(table);
        
        // 차트 이미지 삽입
        if (chartImages != null && chartImages.containsKey("sourceDistribution")) {
            addChartImage(document, chartImages.get("sourceDistribution"), "소스별 결과 분포");
        } else {
            // 서버 사이드 차트 생성
            try {
                byte[] chartBytes = chartGenerationService.generatePieChart(
                        ChartData.pie("소스별 결과 분포",
                                sourceDistribution.keySet().stream().map(this::formatSourceName).toList(),
                                sourceDistribution.values().stream().map(v -> (Number) v).toList(),
                                List.of("#3b82f6", "#10b981", "#f59e0b", "#ef4444"))
                );
                addChartImage(document, chartBytes, null);
            } catch (Exception e) {
                log.warn("Failed to generate source distribution chart: {}", e.getMessage());
            }
        }
    }

    /**
     * 키워드 분석 섹션 추가
     */
    @SuppressWarnings("unchecked")
    private void addKeywordAnalysis(Document document, PdfFont boldFont, PdfFont regularFont,
                                    Map<String, Object> summaryData, Map<String, String> chartImages) {
        document.add(createSectionTitle("키워드 분석", boldFont));
        
        List<Map<String, Object>> keywords = (List<Map<String, Object>>) summaryData.get("keywords");
        
        if (keywords != null && !keywords.isEmpty()) {
            // 키워드 테이블
            Table table = new Table(UnitValue.createPercentArray(new float[]{1, 3, 1}))
                    .useAllAvailableWidth()
                    .setMarginBottom(20);
            
            table.addHeaderCell(createHeaderCell("순위", boldFont));
            table.addHeaderCell(createHeaderCell("키워드", boldFont));
            table.addHeaderCell(createHeaderCell("빈도", boldFont));
            
            int rank = 1;
            for (Map<String, Object> kw : keywords.subList(0, Math.min(15, keywords.size()))) {
                table.addCell(createDataCell(String.valueOf(rank++), regularFont));
                table.addCell(createDataCell((String) kw.get("word"), regularFont));
                table.addCell(createDataCell(String.valueOf(kw.get("count")), regularFont));
            }
            
            document.add(table);
        }
        
        // 차트 이미지 삽입
        if (chartImages != null && chartImages.containsKey("keywords")) {
            addChartImage(document, chartImages.get("keywords"), "상위 키워드 분포");
        }
        
        document.add(new AreaBreak());
    }

    /**
     * 감정 분석 섹션 추가
     */
    @SuppressWarnings("unchecked")
    private void addSentimentAnalysis(Document document, PdfFont boldFont, PdfFont regularFont,
                                      Map<String, Object> summaryData, Map<String, String> chartImages) {
        document.add(createSectionTitle("감정 분석", boldFont));
        
        Map<String, Object> sentiment = (Map<String, Object>) summaryData.get("sentiment");
        
        if (sentiment != null) {
            double positive = getDoubleValue(sentiment, "positive", 0);
            double neutral = getDoubleValue(sentiment, "neutral", 0);
            double negative = getDoubleValue(sentiment, "negative", 0);
            
            // 감정 통계 테이블
            Table statsTable = new Table(UnitValue.createPercentArray(new float[]{1, 1, 1}))
                    .useAllAvailableWidth()
                    .setMarginBottom(20);
            
            statsTable.addCell(createStatCell("긍정", String.format("%.1f%%", positive * 100), 
                    boldFont, regularFont, SUCCESS_COLOR));
            statsTable.addCell(createStatCell("중립", String.format("%.1f%%", neutral * 100), 
                    boldFont, regularFont, NEUTRAL_COLOR));
            statsTable.addCell(createStatCell("부정", String.format("%.1f%%", negative * 100), 
                    boldFont, regularFont, DANGER_COLOR));
            
            document.add(statsTable);
            
            // 분석 설명
            String dominantSentiment = positive > negative ? 
                    (positive > neutral ? "긍정적" : "중립적") : 
                    (negative > neutral ? "부정적" : "중립적");
            
            document.add(new Paragraph("분석 결과, 전체적으로 " + dominantSentiment + "인 톤이 우세합니다.")
                    .setFontSize(11)
                    .setFontColor(NEUTRAL_COLOR)
                    .setMarginBottom(20));
        }
        
        // 차트 이미지 삽입
        if (chartImages != null && chartImages.containsKey("sentiment")) {
            addChartImage(document, chartImages.get("sentiment"), "감정 분석 결과");
        }
    }

    /**
     * 신뢰도 분석 섹션 추가
     */
    @SuppressWarnings("unchecked")
    private void addReliabilityAnalysis(Document document, PdfFont boldFont, PdfFont regularFont,
                                        Map<String, Object> summaryData, Map<String, String> chartImages) {
        document.add(createSectionTitle("신뢰도 분석", boldFont));
        
        Map<String, Object> reliability = (Map<String, Object>) summaryData.get("reliability");
        
        if (reliability != null) {
            double avgScore = getDoubleValue(reliability, "averageScore", 0);
            String grade = (String) reliability.getOrDefault("grade", "N/A");
            
            // 신뢰도 점수 표시
            Div scoreBox = new Div()
                    .setBackgroundColor(getGradeColor(grade))
                    .setPadding(20)
                    .setMarginBottom(20)
                    .setTextAlignment(TextAlignment.CENTER);
            
            scoreBox.add(new Paragraph("평균 신뢰도 점수")
                    .setFont(boldFont)
                    .setFontSize(14)
                    .setFontColor(ColorConstants.WHITE));
            
            scoreBox.add(new Paragraph(String.format("%.0f / 100", avgScore))
                    .setFont(boldFont)
                    .setFontSize(36)
                    .setFontColor(ColorConstants.WHITE));
            
            scoreBox.add(new Paragraph("등급: " + grade)
                    .setFontSize(14)
                    .setFontColor(ColorConstants.WHITE));
            
            document.add(scoreBox);
        }
        
        // 차트 이미지 삽입
        if (chartImages != null && chartImages.containsKey("reliability")) {
            addChartImage(document, chartImages.get("reliability"), "신뢰도 분포");
        }
        
        document.add(new AreaBreak());
    }

    /**
     * 상세 결과 섹션 추가
     */
    private void addDetailedResults(Document document, PdfFont boldFont, PdfFont regularFont,
                                    List<Map<String, Object>> results) {
        document.add(createSectionTitle("상세 검색 결과", boldFont));
        
        if (results == null || results.isEmpty()) {
            document.add(new Paragraph("검색 결과가 없습니다.")
                    .setFontSize(11)
                    .setFontColor(NEUTRAL_COLOR));
            return;
        }
        
        int count = 0;
        for (Map<String, Object> result : results) {
            if (count >= 30) {  // 최대 30개 결과만 표시
                document.add(new Paragraph("... 외 " + (results.size() - 30) + "개 결과")
                        .setFontSize(11)
                        .setFontColor(NEUTRAL_COLOR)
                        .setMarginTop(10));
                break;
            }
            
            // 결과 박스
            Div resultBox = new Div()
                    .setBackgroundColor(LIGHT_BG)
                    .setPadding(12)
                    .setBorder(new SolidBorder(new DeviceRgb(226, 232, 240), 1))
                    .setMarginBottom(10);
            
            // 제목
            String title = (String) result.getOrDefault("title", "제목 없음");
            resultBox.add(new Paragraph(truncateText(title, 100))
                    .setFont(boldFont)
                    .setFontSize(12)
                    .setFontColor(PRIMARY_COLOR)
                    .setMarginBottom(5));
            
            // 출처 및 날짜
            String source = (String) result.getOrDefault("source", "");
            String publishedAt = (String) result.getOrDefault("publishedAt", "");
            resultBox.add(new Paragraph(source + " | " + publishedAt)
                    .setFontSize(10)
                    .setFontColor(NEUTRAL_COLOR)
                    .setMarginBottom(5));
            
            // 본문 내용 (content가 있으면 전체 사용, 없으면 snippet 사용)
            String content = (String) result.get("content");
            String snippet = (String) result.get("snippet");
            String displayContent = (content != null && !content.isBlank()) ? content : snippet;
            if (displayContent != null && !displayContent.isBlank()) {
                // PDF에서는 너무 긴 내용은 적절히 잘라서 표시 (최대 10000자)
                String truncatedContent = displayContent.length() > 10000 
                    ? displayContent.substring(0, 10000) + "..." 
                    : displayContent;
                resultBox.add(new Paragraph(truncatedContent)
                        .setFontSize(10)
                        .setFontColor(new DeviceRgb(71, 85, 105)));
            }
            
            // URL (출처 링크)
            String url = (String) result.get("url");
            if (url != null && !url.isBlank()) {
                resultBox.add(new Paragraph("출처: " + url)
                        .setFontSize(9)
                        .setFontColor(PRIMARY_COLOR)
                        .setMarginTop(5));
            }
            
            document.add(resultBox);
            count++;
        }
    }

    // ===== 헬퍼 메서드 =====

    private PdfFont loadFont(String fontPath) throws IOException {
        try {
            // 클래스패스에서 리소스 로드
            var resource = getClass().getClassLoader().getResourceAsStream(fontPath);
            if (resource == null) {
                log.warn("Font resource not found: {}, using default font", fontPath);
                return PdfFontFactory.createFont();
            }
            
            byte[] fontBytes = resource.readAllBytes();
            return PdfFontFactory.createFont(fontBytes, PdfEncodings.IDENTITY_H);
        } catch (Exception e) {
            log.error("Failed to load font from {}: {}", fontPath, e.getMessage(), e);
            // 기본 폰트 사용
            return PdfFontFactory.createFont();
        }
    }

    private Paragraph createSectionTitle(String title, PdfFont boldFont) {
        return new Paragraph(title)
                .setFont(boldFont)
                .setFontSize(18)
                .setFontColor(new DeviceRgb(30, 41, 59))
                .setMarginTop(20)
                .setMarginBottom(15)
                .setBorderBottom(new SolidBorder(PRIMARY_COLOR, 2))
                .setPaddingBottom(10);
    }

    private Div createDivider() {
        return new Div()
                .setHeight(1)
                .setBackgroundColor(new DeviceRgb(226, 232, 240))
                .setMarginTop(10)
                .setMarginBottom(10);
    }

    private Cell createStatCell(String label, String value, PdfFont boldFont, PdfFont regularFont, DeviceRgb color) {
        Cell cell = new Cell()
                .setBorder(Border.NO_BORDER)
                .setBackgroundColor(LIGHT_BG)
                .setPadding(15)
                .setTextAlignment(TextAlignment.CENTER);
        
        cell.add(new Paragraph(value)
                .setFont(boldFont)
                .setFontSize(24)
                .setFontColor(color));
        
        cell.add(new Paragraph(label)
                .setFont(regularFont)
                .setFontSize(11)
                .setFontColor(NEUTRAL_COLOR));
        
        return cell;
    }

    private Cell createHeaderCell(String text, PdfFont boldFont) {
        return new Cell()
                .add(new Paragraph(text).setFont(boldFont).setFontSize(11))
                .setBackgroundColor(new DeviceRgb(241, 245, 249))
                .setPadding(8)
                .setTextAlignment(TextAlignment.CENTER);
    }

    private Cell createDataCell(String text, PdfFont regularFont) {
        return new Cell()
                .add(new Paragraph(text != null ? text : "-").setFont(regularFont).setFontSize(10))
                .setPadding(8)
                .setTextAlignment(TextAlignment.CENTER);
    }

    private void addChartImage(Document document, String base64Image, String caption) {
        try {
            byte[] imageBytes = Base64.getDecoder().decode(
                    base64Image.contains(",") ? base64Image.split(",")[1] : base64Image
            );
            addChartImage(document, imageBytes, caption);
        } catch (Exception e) {
            log.warn("Failed to add chart image: {}", e.getMessage());
        }
    }

    private void addChartImage(Document document, byte[] imageBytes, String caption) {
        try {
            Image image = new Image(ImageDataFactory.create(imageBytes))
                    .setMaxWidth(450)
                    .setHorizontalAlignment(HorizontalAlignment.CENTER)
                    .setMarginTop(10)
                    .setMarginBottom(10);
            
            document.add(image);
            
            if (caption != null && !caption.isBlank()) {
                document.add(new Paragraph(caption)
                        .setFontSize(10)
                        .setFontColor(NEUTRAL_COLOR)
                        .setTextAlignment(TextAlignment.CENTER)
                        .setMarginBottom(15));
            }
        } catch (Exception e) {
            log.warn("Failed to add chart image: {}", e.getMessage());
        }
    }

    private void addPageNumbers(PdfDocument pdf, PdfFont font) {
        int numberOfPages = pdf.getNumberOfPages();
        if (numberOfPages <= 0) {
            log.warn("No pages in PDF document, skipping page numbers");
            return;
        }
        
        for (int i = 1; i <= numberOfPages; i++) {
            // 페이지 번호는 표지를 제외하고 시작
            if (i == 1) continue;
            
            try {
                PdfPage page = pdf.getPage(i);
                if (page == null) {
                    log.warn("Page {} is null, skipping page number", i);
                    continue;
                }
                
                // Get page size with null safety
                Rectangle pageSize = page.getPageSize();
                if (pageSize == null) {
                    log.warn("Page {} has no size defined, skipping page number", i);
                    continue;
                }
                
                Document doc = new Document(pdf);
                Paragraph pageNumber = new Paragraph(String.format("%d / %d", i, numberOfPages))
                        .setFont(font)
                        .setFontSize(10)
                        .setFontColor(NEUTRAL_COLOR);
                
                // 하단 중앙에 추가
                doc.showTextAligned(pageNumber,
                        pageSize.getWidth() / 2,
                        30,
                        i,
                        TextAlignment.CENTER,
                        VerticalAlignment.BOTTOM,
                        0);
            } catch (Exception e) {
                log.warn("Failed to add page number to page {}: {}", i, e.getMessage());
            }
        }
    }

    private Map<String, Long> calculateSourceDistribution(List<Map<String, Object>> results) {
        if (results == null) return Map.of();
        
        return results.stream()
                .map(r -> (String) r.getOrDefault("_source", r.getOrDefault("source", "unknown")))
                .collect(java.util.stream.Collectors.groupingBy(
                        s -> s,
                        java.util.stream.Collectors.counting()
                ));
    }

    private String formatSourceName(String source) {
        return switch (source.toLowerCase()) {
            case "database" -> "데이터베이스";
            case "web" -> "웹 크롤링";
            case "ai" -> "AI 분석";
            default -> source;
        };
    }

    private String formatTimeWindow(String window) {
        return switch (window) {
            case "1d" -> "최근 1일";
            case "7d" -> "최근 7일";
            case "30d" -> "최근 30일";
            case "90d" -> "최근 90일";
            case "1y" -> "최근 1년";
            default -> window;
        };
    }

    private DeviceRgb getGradeColor(String grade) {
        return switch (grade.toUpperCase()) {
            case "A", "HIGH" -> SUCCESS_COLOR;
            case "B", "MEDIUM" -> new DeviceRgb(34, 197, 94);
            case "C" -> WARNING_COLOR;
            case "D", "LOW" -> new DeviceRgb(249, 115, 22);
            case "F" -> DANGER_COLOR;
            default -> NEUTRAL_COLOR;
        };
    }

    private String truncateText(String text, int maxLength) {
        if (text == null) return "";
        return text.length() > maxLength ? text.substring(0, maxLength) + "..." : text;
    }

    private int getIntValue(Map<String, Object> map, String key, int defaultValue) {
        Object value = map.get(key);
        if (value instanceof Number) {
            return ((Number) value).intValue();
        }
        return defaultValue;
    }

    private double getDoubleValue(Map<String, Object> map, String key, double defaultValue) {
        Object value = map.get(key);
        if (value instanceof Number) {
            return ((Number) value).doubleValue();
        }
        return defaultValue;
    }
}
