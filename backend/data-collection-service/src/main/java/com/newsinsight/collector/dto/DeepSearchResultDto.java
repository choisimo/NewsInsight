package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;

/**
 * DTO for deep search result including evidence
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DeepSearchResultDto {
    private String jobId;
    private String topic;
    private String baseUrl;
    private String status;
    private Integer evidenceCount;
    private List<EvidenceDto> evidence;
    private StanceDistributionDto stanceDistribution;
    private LocalDateTime createdAt;
    private LocalDateTime completedAt;
    private String errorMessage;
    private String failureReason;      // Code like "timeout_job_overall"
    private String failureCategory;     // High-level category like "timeout", "network", "service"
}
