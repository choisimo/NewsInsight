package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * DTO for AI Sub-Task response.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiSubTaskDto {
    private String subTaskId;
    private String jobId;
    private String providerId;
    private String taskType;
    private String status;
    private String resultJson;
    private String errorMessage;
    private int retryCount;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private LocalDateTime completedAt;
}
