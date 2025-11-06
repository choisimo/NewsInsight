package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CollectionResponse {
    private String message;
    private List<CollectionJobDTO> jobs;
    private Integer totalJobsStarted;
    private LocalDateTime timestamp;
}
