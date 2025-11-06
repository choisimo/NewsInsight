package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CollectedDataDTO {
    private Long id;
    private Long sourceId;
    private String title;
    private String content;
    private String url;
    private LocalDateTime publishedDate;
    private LocalDateTime collectedAt;
    private String contentHash;
    private Map<String, Object> metadata;
    private Boolean processed;
}
