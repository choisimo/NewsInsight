package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CollectionStatsDTO {
    private Long totalSources;
    private Long activeSources;
    private Long totalItemsCollected;
    private Long itemsCollectedToday;
    private LocalDateTime lastCollection;
}
