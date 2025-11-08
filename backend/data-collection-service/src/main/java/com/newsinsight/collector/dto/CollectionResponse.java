package com.newsinsight.collector.dto;

import java.time.LocalDateTime;
import java.util.List;

public record CollectionResponse(
        String message,
        List<CollectionJobDTO> jobs,
        Integer totalJobsStarted,
        LocalDateTime timestamp
) {
    public CollectionResponse {
        jobs = jobs == null ? List.of() : List.copyOf(jobs);
    }
}
