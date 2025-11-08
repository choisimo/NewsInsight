package com.newsinsight.collector.dto;

import java.util.List;

public record CollectionRequest(List<Long> sourceIds, boolean force) {
    public CollectionRequest {
        sourceIds = sourceIds == null ? List.of() : List.copyOf(sourceIds);
    }

    public CollectionRequest(List<Long> sourceIds) {
        this(sourceIds, false);
    }
}
