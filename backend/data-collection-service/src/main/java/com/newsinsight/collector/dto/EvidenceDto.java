package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * DTO for evidence item from deep search
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EvidenceDto {
    private Long id;
    private String url;
    private String title;
    private String stance;  // pro, con, neutral
    private String snippet;
    private String source;
    private String sourceCategory;  // news, community, blog, official, academic
}
