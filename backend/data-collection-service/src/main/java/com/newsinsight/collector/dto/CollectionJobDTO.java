package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.CollectionJob.JobStatus;

import java.time.LocalDateTime;

public record CollectionJobDTO(
        Long id,
        Long sourceId,
        JobStatus status,
        LocalDateTime startedAt,
        LocalDateTime completedAt,
        Integer itemsCollected,
        String errorMessage,
        LocalDateTime createdAt
) {}
