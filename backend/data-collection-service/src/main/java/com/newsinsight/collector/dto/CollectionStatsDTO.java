package com.newsinsight.collector.dto;

import java.time.LocalDateTime;

public record CollectionStatsDTO(
        Long totalSources,
        Long activeSources,
        Long totalItemsCollected,
        Long itemsCollectedToday,
        LocalDateTime lastCollection
) {}
