package com.newsinsight.collector.service.report;

import com.newsinsight.collector.dto.report.ReportMetadata;
import com.newsinsight.collector.dto.report.ReportRequest;
import com.newsinsight.collector.entity.search.SearchHistory;
import com.newsinsight.collector.repository.SearchHistoryRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 보고서 생성 오케스트레이터 서비스
 * 
 * 보고서 생성 요청을 관리하고, PDF 생성을 조정합니다.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ReportGenerationService {

    private final PdfExportService pdfExportService;
    private final SearchHistoryRepository searchHistoryRepository;
    
    // 생성된 보고서 캐시 (실제 운영에서는 Redis나 파일 시스템 사용)
    private final Map<String, byte[]> reportCache = new ConcurrentHashMap<>();
    private final Map<String, ReportMetadata> metadataCache = new ConcurrentHashMap<>();

    /**
     * 통합 검색 보고서 생성 요청
     */
    public ReportMetadata requestUnifiedSearchReport(String jobId, ReportRequest request) {
        String reportId = UUID.randomUUID().toString();
        
        ReportMetadata metadata = ReportMetadata.builder()
                .reportId(reportId)
                .reportType(ReportRequest.ReportType.UNIFIED_SEARCH)
                .targetId(jobId)
                .query(request.getQuery())
                .status(ReportMetadata.ReportStatus.PENDING)
                .createdAt(LocalDateTime.now())
                .expiresAt(LocalDateTime.now().plusDays(7))
                .build();
        
        metadataCache.put(reportId, metadata);
        
        // 비동기로 보고서 생성 시작
        generateReportAsync(reportId, jobId, request);
        
        return metadata;
    }

    /**
     * 비동기 보고서 생성
     */
    @Async
    public CompletableFuture<ReportMetadata> generateReportAsync(String reportId, String jobId, ReportRequest request) {
        long startTime = System.currentTimeMillis();
        
        try {
            // 상태 업데이트: 생성 중
            updateMetadataStatus(reportId, ReportMetadata.ReportStatus.GENERATING);
            
            // 검색 이력 조회
            List<SearchHistory> histories = searchHistoryRepository.findByExternalIdContaining(jobId);
            
            if (histories.isEmpty()) {
                throw new IllegalArgumentException("Search history not found for job: " + jobId);
            }
            
            // 데이터 집계
            Map<String, Object> summaryData = aggregateSummaryData(histories);
            List<Map<String, Object>> results = aggregateResults(histories);
            
            // 보고서 제목 생성
            String title = request.getCustomTitle() != null 
                    ? request.getCustomTitle()
                    : "'" + request.getQuery() + "' 통합 검색 분석 보고서";
            
            // PDF 생성
            byte[] pdfBytes = pdfExportService.generateUnifiedSearchReport(
                    title,
                    request.getQuery(),
                    request.getTimeWindow(),
                    summaryData,
                    results,
                    request.getChartImages(),
                    request.getIncludeSections()
            );
            
            // 캐시에 저장
            reportCache.put(reportId, pdfBytes);
            
            // 메타데이터 업데이트
            long duration = System.currentTimeMillis() - startTime;
            ReportMetadata metadata = metadataCache.get(reportId);
            ReportMetadata updatedMetadata = ReportMetadata.builder()
                    .reportId(reportId)
                    .title(title)
                    .reportType(ReportRequest.ReportType.UNIFIED_SEARCH)
                    .targetId(jobId)
                    .query(request.getQuery())
                    .status(ReportMetadata.ReportStatus.COMPLETED)
                    .fileSize((long) pdfBytes.length)
                    .generationTimeMs(duration)
                    .createdAt(metadata.getCreatedAt())
                    .expiresAt(metadata.getExpiresAt())
                    .downloadUrl("/api/v1/reports/" + reportId + "/download")
                    .build();
            
            metadataCache.put(reportId, updatedMetadata);
            
            log.info("Report generated successfully: reportId={}, size={}KB, duration={}ms",
                    reportId, pdfBytes.length / 1024, duration);
            
            return CompletableFuture.completedFuture(updatedMetadata);
            
        } catch (Exception e) {
            log.error("Failed to generate report: reportId={}, error={}", reportId, e.getMessage(), e);
            
            ReportMetadata metadata = metadataCache.get(reportId);
            ReportMetadata failedMetadata = ReportMetadata.builder()
                    .reportId(reportId)
                    .reportType(ReportRequest.ReportType.UNIFIED_SEARCH)
                    .targetId(jobId)
                    .query(request.getQuery())
                    .status(ReportMetadata.ReportStatus.FAILED)
                    .createdAt(metadata != null ? metadata.getCreatedAt() : LocalDateTime.now())
                    .errorMessage(e.getMessage())
                    .build();
            
            metadataCache.put(reportId, failedMetadata);
            
            return CompletableFuture.completedFuture(failedMetadata);
        }
    }

    /**
     * 동기 보고서 생성 (즉시 다운로드용)
     */
    public byte[] generateReportSync(String jobId, ReportRequest request) throws IOException {
        // 검색 이력 조회
        List<SearchHistory> histories = searchHistoryRepository.findByExternalIdContaining(jobId);
        
        if (histories.isEmpty()) {
            throw new IllegalArgumentException("Search history not found for job: " + jobId);
        }
        
        // 데이터 집계
        Map<String, Object> summaryData = aggregateSummaryData(histories);
        List<Map<String, Object>> results = aggregateResults(histories);
        
        // 보고서 제목 생성
        String title = request.getCustomTitle() != null 
                ? request.getCustomTitle()
                : "'" + request.getQuery() + "' 통합 검색 분석 보고서";
        
        // PDF 생성 및 반환
        return pdfExportService.generateUnifiedSearchReport(
                title,
                request.getQuery(),
                request.getTimeWindow(),
                summaryData,
                results,
                request.getChartImages(),
                request.getIncludeSections()
        );
    }

    /**
     * 보고서 다운로드
     */
    public byte[] downloadReport(String reportId) {
        byte[] pdfBytes = reportCache.get(reportId);
        if (pdfBytes == null) {
            throw new IllegalArgumentException("Report not found or expired: " + reportId);
        }
        return pdfBytes;
    }

    /**
     * 보고서 메타데이터 조회
     */
    public ReportMetadata getReportMetadata(String reportId) {
        return metadataCache.get(reportId);
    }

    /**
     * 보고서 존재 여부 확인
     */
    public boolean reportExists(String reportId) {
        return reportCache.containsKey(reportId);
    }

    // ===== 헬퍼 메서드 =====

    private void updateMetadataStatus(String reportId, ReportMetadata.ReportStatus status) {
        ReportMetadata existing = metadataCache.get(reportId);
        if (existing != null) {
            ReportMetadata updated = ReportMetadata.builder()
                    .reportId(existing.getReportId())
                    .title(existing.getTitle())
                    .reportType(existing.getReportType())
                    .targetId(existing.getTargetId())
                    .query(existing.getQuery())
                    .status(status)
                    .fileSize(existing.getFileSize())
                    .pageCount(existing.getPageCount())
                    .generationTimeMs(existing.getGenerationTimeMs())
                    .createdAt(existing.getCreatedAt())
                    .expiresAt(existing.getExpiresAt())
                    .downloadUrl(existing.getDownloadUrl())
                    .errorMessage(existing.getErrorMessage())
                    .build();
            metadataCache.put(reportId, updated);
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> aggregateSummaryData(List<SearchHistory> histories) {
        Map<String, Object> summary = new HashMap<>();
        
        int totalResults = 0;
        int dbResults = 0;
        int webResults = 0;
        int aiResults = 0;
        String aiSummary = null;
        Map<String, Object> sentiment = new HashMap<>();
        Map<String, Object> reliability = new HashMap<>();
        List<Map<String, Object>> keywords = new ArrayList<>();
        
        for (SearchHistory history : histories) {
            // 결과 수 집계
            if (history.getResults() != null) {
                List<Map<String, Object>> results = history.getResults();
                totalResults += results.size();
                
                for (Map<String, Object> result : results) {
                    String source = (String) result.getOrDefault("_source", 
                            result.getOrDefault("source", "unknown"));
                    switch (source.toLowerCase()) {
                        case "database" -> dbResults++;
                        case "web" -> webResults++;
                        case "ai" -> aiResults++;
                    }
                }
            }
            
            // AI 요약 추출
            if (history.getAiSummary() != null && aiSummary == null) {
                Map<String, Object> aiSummaryMap = history.getAiSummary();
                aiSummary = (String) aiSummaryMap.get("summary");
                if (aiSummary == null) {
                    aiSummary = (String) aiSummaryMap.get("content");
                }
            }
        }
        
        summary.put("totalResults", totalResults);
        summary.put("dbResults", dbResults);
        summary.put("webResults", webResults);
        summary.put("aiResults", aiResults);
        summary.put("aiSummary", aiSummary);
        summary.put("sentiment", sentiment);
        summary.put("reliability", reliability);
        summary.put("keywords", keywords);
        
        return summary;
    }

    private List<Map<String, Object>> aggregateResults(List<SearchHistory> histories) {
        List<Map<String, Object>> allResults = new ArrayList<>();
        
        for (SearchHistory history : histories) {
            if (history.getResults() != null) {
                allResults.addAll(history.getResults());
            }
        }
        
        // 중복 제거 (URL 기준)
        Set<String> seenUrls = new HashSet<>();
        List<Map<String, Object>> uniqueResults = new ArrayList<>();
        
        for (Map<String, Object> result : allResults) {
            String url = (String) result.get("url");
            if (url == null || !seenUrls.contains(url)) {
                uniqueResults.add(result);
                if (url != null) {
                    seenUrls.add(url);
                }
            }
        }
        
        return uniqueResults;
    }
}
