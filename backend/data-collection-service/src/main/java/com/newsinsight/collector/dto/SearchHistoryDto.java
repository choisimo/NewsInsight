package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.search.SearchHistory;
import com.newsinsight.collector.entity.search.SearchType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * DTO for SearchHistory API responses.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchHistoryDto {

    private Long id;
    private String externalId;
    private SearchType searchType;
    private String query;
    private String timeWindow;
    private String userId;
    private String sessionId;
    private Long parentSearchId;
    private Integer depthLevel;
    private Integer resultCount;
    private List<Map<String, Object>> results;
    private Map<String, Object> aiSummary;
    private List<String> discoveredUrls;
    private List<Map<String, Object>> factCheckResults;
    private Double credibilityScore;
    private Map<String, Object> stanceDistribution;
    private Map<String, Object> metadata;
    private Boolean bookmarked;
    private List<String> tags;
    private String notes;
    private Long durationMs;
    private String errorMessage;
    private Boolean success;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    /**
     * Convert entity to DTO.
     */
    public static SearchHistoryDto fromEntity(SearchHistory entity) {
        return SearchHistoryDto.builder()
                .id(entity.getId())
                .externalId(entity.getExternalId())
                .searchType(entity.getSearchType())
                .query(entity.getQuery())
                .timeWindow(entity.getTimeWindow())
                .userId(entity.getUserId())
                .sessionId(entity.getSessionId())
                .parentSearchId(entity.getParentSearchId())
                .depthLevel(entity.getDepthLevel())
                .resultCount(entity.getResultCountSafe())
                .results(entity.getResults())
                .aiSummary(entity.getAiSummary())
                .discoveredUrls(entity.getDiscoveredUrls())
                .factCheckResults(entity.getFactCheckResults())
                .credibilityScore(entity.getCredibilityScore())
                .stanceDistribution(entity.getStanceDistribution())
                .metadata(entity.getMetadata())
                .bookmarked(entity.getBookmarked())
                .tags(entity.getTags())
                .notes(entity.getNotes())
                .durationMs(entity.getDurationMs())
                .errorMessage(entity.getErrorMessage())
                .success(entity.getSuccess())
                .createdAt(entity.getCreatedAt())
                .updatedAt(entity.getUpdatedAt())
                .build();
    }

    /**
     * Convert DTO to message for Kafka.
     */
    public SearchHistoryMessage toMessage() {
        return SearchHistoryMessage.builder()
                .externalId(this.externalId)
                .searchType(this.searchType)
                .query(this.query)
                .timeWindow(this.timeWindow)
                .userId(this.userId)
                .sessionId(this.sessionId)
                .parentSearchId(this.parentSearchId)
                .depthLevel(this.depthLevel)
                .resultCount(this.resultCount)
                .results(this.results)
                .aiSummary(this.aiSummary)
                .discoveredUrls(this.discoveredUrls)
                .factCheckResults(this.factCheckResults)
                .credibilityScore(this.credibilityScore)
                .stanceDistribution(this.stanceDistribution)
                .metadata(this.metadata)
                .durationMs(this.durationMs)
                .errorMessage(this.errorMessage)
                .success(this.success)
                .timestamp(System.currentTimeMillis())
                .build();
    }
}
