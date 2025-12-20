package com.newsinsight.collector.dto.report;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 생성된 보고서 메타데이터 DTO
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ReportMetadata {

    /**
     * 보고서 고유 ID
     */
    private String reportId;

    /**
     * 보고서 제목
     */
    private String title;

    /**
     * 보고서 유형
     */
    private ReportRequest.ReportType reportType;

    /**
     * 대상 ID (jobId 또는 articleId)
     */
    private String targetId;

    /**
     * 검색 쿼리
     */
    private String query;

    /**
     * 생성 상태: PENDING, GENERATING, COMPLETED, FAILED
     */
    private ReportStatus status;

    /**
     * 파일 크기 (bytes)
     */
    private Long fileSize;

    /**
     * 페이지 수
     */
    private Integer pageCount;

    /**
     * 생성 소요 시간 (ms)
     */
    private Long generationTimeMs;

    /**
     * 생성 일시
     */
    private LocalDateTime createdAt;

    /**
     * 만료 일시 (자동 삭제 예정)
     */
    private LocalDateTime expiresAt;

    /**
     * 다운로드 URL
     */
    private String downloadUrl;

    /**
     * 에러 메시지 (실패 시)
     */
    private String errorMessage;

    /**
     * 보고서 상태 Enum
     */
    public enum ReportStatus {
        PENDING,
        GENERATING,
        COMPLETED,
        FAILED,
        EXPIRED
    }
}
