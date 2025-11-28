package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;

/**
 * DTO for AI Job response (includes sub-tasks status).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiJobDto {
    private String jobId;
    private String topic;
    private String baseUrl;
    private String overallStatus;
    private List<AiSubTaskDto> subTasks;
    private int totalTasks;
    private int completedTasks;
    private int failedTasks;
    private String errorMessage;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private LocalDateTime completedAt;
}
