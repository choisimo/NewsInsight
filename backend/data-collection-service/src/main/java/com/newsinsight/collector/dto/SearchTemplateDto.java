package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.search.SearchTemplate;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * DTO for SearchTemplate API requests and responses.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchTemplateDto {

    private Long id;
    private String name;
    private String query;
    private String mode;
    private String userId;
    private List<Map<String, Object>> items;
    private String description;
    private Boolean favorite;
    private List<String> tags;
    private Map<String, Object> metadata;
    private Long sourceSearchId;
    private Integer useCount;
    private LocalDateTime lastUsedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    
    // Computed field
    private Integer itemCount;

    /**
     * Convert entity to DTO
     */
    public static SearchTemplateDto fromEntity(SearchTemplate entity) {
        return SearchTemplateDto.builder()
                .id(entity.getId())
                .name(entity.getName())
                .query(entity.getQuery())
                .mode(entity.getMode())
                .userId(entity.getUserId())
                .items(entity.getItems())
                .description(entity.getDescription())
                .favorite(entity.getFavorite())
                .tags(entity.getTags())
                .metadata(entity.getMetadata())
                .sourceSearchId(entity.getSourceSearchId())
                .useCount(entity.getUseCount())
                .lastUsedAt(entity.getLastUsedAt())
                .createdAt(entity.getCreatedAt())
                .updatedAt(entity.getUpdatedAt())
                .itemCount(entity.getItemCount())
                .build();
    }

    /**
     * Convert DTO to entity for creation
     */
    public SearchTemplate toEntity() {
        return SearchTemplate.builder()
                .name(this.name)
                .query(this.query)
                .mode(this.mode)
                .userId(this.userId)
                .items(this.items)
                .description(this.description)
                .favorite(this.favorite != null ? this.favorite : false)
                .tags(this.tags)
                .metadata(this.metadata)
                .sourceSearchId(this.sourceSearchId)
                .build();
    }
}
