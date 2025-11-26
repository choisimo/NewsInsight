package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * DTO for deep search job status
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DeepSearchJobDto {
    private String jobId;
    private String topic;
    private String baseUrl;
    private String status;
    private Integer evidenceCount;
    private String errorMessage;
    private LocalDateTime createdAt;
    private LocalDateTime completedAt;
}
