package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * DTO for stance distribution statistics
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class StanceDistributionDto {
    private Long pro;
    private Long con;
    private Long neutral;
    private Double proRatio;
    private Double conRatio;
    private Double neutralRatio;
}
