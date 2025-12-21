package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.report.ReportMetadata;
import com.newsinsight.collector.dto.report.ReportRequest;
import com.newsinsight.collector.service.report.ReportGenerationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/**
 * 보고서 생성 및 다운로드 REST API 컨트롤러
 */
@RestController
@RequestMapping("/api/v1/reports")
@RequiredArgsConstructor
@Slf4j
@Tag(name = "Reports", description = "PDF 보고서 생성 및 다운로드 API")
public class ReportController {

    private final ReportGenerationService reportGenerationService;

    /**
     * 통합 검색 보고서 생성 요청 (비동기)
     * 
     * @param jobId 통합 검색 Job ID
     * @param request 보고서 생성 요청
     * @return 보고서 메타데이터
     */
    @PostMapping("/unified-search/{jobId}")
    @Operation(summary = "통합 검색 보고서 생성 요청", description = "비동기로 PDF 보고서를 생성합니다.")
    public ResponseEntity<ReportMetadata> requestUnifiedSearchReport(
            @PathVariable String jobId,
            @RequestBody ReportRequest request) {
        
        log.info("Report generation requested: jobId={}, query={}", jobId, request.getQuery());
        
        ReportMetadata metadata = reportGenerationService.requestUnifiedSearchReport(jobId, request);
        
        return ResponseEntity.accepted().body(metadata);
    }

    /**
     * 통합 검색 보고서 즉시 다운로드 (동기)
     * 
     * @param jobId 통합 검색 Job ID
     * @param request 보고서 생성 요청
     * @return PDF 파일
     */
    @PostMapping("/unified-search/{jobId}/export")
    @Operation(summary = "통합 검색 보고서 즉시 다운로드", description = "동기로 PDF 보고서를 생성하고 즉시 다운로드합니다.")
    public ResponseEntity<byte[]> exportUnifiedSearchReport(
            @PathVariable String jobId,
            @RequestBody ReportRequest request) {
        
        log.info("Report export requested: jobId={}, query={}", jobId, request.getQuery());
        
        try {
            byte[] pdfBytes = reportGenerationService.generateReportSync(jobId, request);
            
            String filename = generateFilename(request.getQuery(), "통합검색");
            
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_PDF);
            headers.setContentDispositionFormData("attachment", filename);
            headers.setContentLength(pdfBytes.length);
            
            return ResponseEntity.ok()
                    .headers(headers)
                    .body(pdfBytes);
                    
        } catch (IllegalArgumentException e) {
            log.warn("Report export failed - not found: jobId={}, error={}", jobId, e.getMessage());
            return ResponseEntity.notFound().build();
        } catch (IOException e) {
            log.error("Report export failed - IO error: jobId={}, error={}", jobId, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * 보고서 상태 조회
     * 
     * @param reportId 보고서 ID
     * @return 보고서 메타데이터
     */
    @GetMapping("/{reportId}")
    @Operation(summary = "보고서 상태 조회", description = "생성 중이거나 완료된 보고서의 상태를 조회합니다.")
    public ResponseEntity<ReportMetadata> getReportStatus(@PathVariable String reportId) {
        ReportMetadata metadata = reportGenerationService.getReportMetadata(reportId);
        
        if (metadata == null) {
            return ResponseEntity.notFound().build();
        }
        
        return ResponseEntity.ok(metadata);
    }

    /**
     * 생성된 보고서 다운로드
     * 
     * @param reportId 보고서 ID
     * @return PDF 파일
     */
    @GetMapping("/{reportId}/download")
    @Operation(summary = "보고서 다운로드", description = "생성된 PDF 보고서를 다운로드합니다.")
    public ResponseEntity<byte[]> downloadReport(@PathVariable String reportId) {
        ReportMetadata metadata = reportGenerationService.getReportMetadata(reportId);
        
        if (metadata == null) {
            return ResponseEntity.notFound().build();
        }
        
        if (metadata.getStatus() != ReportMetadata.ReportStatus.COMPLETED) {
            return ResponseEntity.status(HttpStatus.ACCEPTED)
                    .header("X-Report-Status", metadata.getStatus().name())
                    .build();
        }
        
        try {
            byte[] pdfBytes = reportGenerationService.downloadReport(reportId);
            
            String filename = generateFilename(metadata.getQuery(), "보고서");
            
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_PDF);
            headers.setContentDispositionFormData("attachment", filename);
            headers.setContentLength(pdfBytes.length);
            
            return ResponseEntity.ok()
                    .headers(headers)
                    .body(pdfBytes);
                    
        } catch (IllegalArgumentException e) {
            log.warn("Report download failed - not found: reportId={}", reportId);
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * DeepSearch 보고서 즉시 다운로드 (동기)
     * 
     * @param jobId DeepSearch Job ID
     * @param request 보고서 생성 요청
     * @return PDF 파일
     */
    @PostMapping("/deep-search/{jobId}/export")
    @Operation(summary = "DeepSearch 보고서 즉시 다운로드", description = "DeepSearch 결과를 PDF 보고서로 내보냅니다.")
    public ResponseEntity<byte[]> exportDeepSearchReport(
            @PathVariable String jobId,
            @RequestBody ReportRequest request) {
        
        log.info("DeepSearch report export requested: jobId={}", jobId);
        
        // TODO: DeepSearch 전용 보고서 생성 로직 구현 필요
        // 현재는 통합 검색 보고서로 대체
        
        try {
            request = ReportRequest.builder()
                    .reportType(ReportRequest.ReportType.DEEP_SEARCH)
                    .targetId(jobId)
                    .query(request.getQuery())
                    .timeWindow(request.getTimeWindow())
                    .includeSections(request.getIncludeSections())
                    .chartImages(request.getChartImages())
                    .build();
            
            byte[] pdfBytes = reportGenerationService.generateReportSync(jobId, request);
            
            String filename = generateFilename(request.getQuery(), "DeepSearch");
            
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_PDF);
            headers.setContentDispositionFormData("attachment", filename);
            headers.setContentLength(pdfBytes.length);
            
            return ResponseEntity.ok()
                    .headers(headers)
                    .body(pdfBytes);
                    
        } catch (IllegalArgumentException e) {
            log.warn("DeepSearch report export failed - not found: jobId={}", jobId);
            return ResponseEntity.notFound().build();
        } catch (IOException e) {
            log.error("DeepSearch report export failed: jobId={}, error={}", jobId, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * ML 분석 보고서 즉시 다운로드 (동기)
     * 
     * @param articleId 기사 ID
     * @param request 보고서 생성 요청
     * @return PDF 파일
     */
    @PostMapping("/ml-analysis/{articleId}/export")
    @Operation(summary = "ML 분석 보고서 즉시 다운로드", description = "기사의 ML 분석 결과를 PDF 보고서로 내보냅니다.")
    public ResponseEntity<byte[]> exportMlAnalysisReport(
            @PathVariable Long articleId,
            @RequestBody ReportRequest request) {
        
        log.info("ML analysis report export requested: articleId={}", articleId);
        
        // TODO: ML 분석 전용 보고서 생성 로직 구현
        
        return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED)
                .header("X-Message", "ML analysis report is not yet implemented")
                .build();
    }

    // ===== 헬퍼 메서드 =====

    /**
     * PDF 파일명 생성
     */
    private String generateFilename(String query, String type) {
        String dateStr = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmm"));
        String safeQuery = query != null ? query.replaceAll("[^가-힣a-zA-Z0-9]", "_") : "report";
        if (safeQuery.length() > 30) {
            safeQuery = safeQuery.substring(0, 30);
        }
        
        String filename = String.format("NewsInsight_%s_%s_%s.pdf", type, safeQuery, dateStr);
        
        // URL 인코딩 (한글 파일명 지원)
        return URLEncoder.encode(filename, StandardCharsets.UTF_8)
                .replace("+", "%20");
    }
}
