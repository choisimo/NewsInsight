package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.CollectionJob.JobStatus;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CollectionJobDTO {
    private Long id;
    private Long sourceId;
    private JobStatus status;
    private LocalDateTime startedAt;
    private LocalDateTime completedAt;
    private Integer itemsCollected;
    private String errorMessage;
    private LocalDateTime createdAt;
}
