package com.newsinsight.collector.mapper;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.dto.*;
import com.newsinsight.collector.entity.CollectedData;
import com.newsinsight.collector.entity.CollectionJob;
import com.newsinsight.collector.entity.DataSource;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.Map;

@Component
@RequiredArgsConstructor
public class EntityMapper {

    private final ObjectMapper objectMapper;

    public DataSourceDTO toDTO(DataSource source) {
        return DataSourceDTO.builder()
                .id(source.getId())
                .name(source.getName())
                .url(source.getUrl())
                .sourceType(source.getSourceType())
                .isActive(source.getIsActive())
                .lastCollected(source.getLastCollected())
                .collectionFrequency(source.getCollectionFrequency())
                .metadata(parseJson(source.getMetadataJson()))
                .createdAt(source.getCreatedAt())
                .updatedAt(source.getUpdatedAt())
                .build();
    }

    // Alias method for DataSource
    public DataSourceDTO toDataSourceDTO(DataSource source) {
        return toDTO(source);
    }

    public CollectionJobDTO toDTO(CollectionJob job) {
        return CollectionJobDTO.builder()
                .id(job.getId())
                .sourceId(job.getSourceId())
                .status(job.getStatus())
                .startedAt(job.getStartedAt())
                .completedAt(job.getCompletedAt())
                .itemsCollected(job.getItemsCollected())
                .errorMessage(job.getErrorMessage())
                .createdAt(job.getCreatedAt())
                .build();
    }

    // Alias method for CollectionJob
    public CollectionJobDTO toCollectionJobDTO(CollectionJob job) {
        return toDTO(job);
    }

    public CollectedDataDTO toDTO(CollectedData data) {
        return CollectedDataDTO.builder()
                .id(data.getId())
                .sourceId(data.getSourceId())
                .title(data.getTitle())
                .content(data.getContent())
                .url(data.getUrl())
                .publishedDate(data.getPublishedDate())
                .collectedAt(data.getCollectedAt())
                .contentHash(data.getContentHash())
                .metadata(parseJson(data.getMetadataJson()))
                .processed(data.getProcessed())
                .build();
    }

    // Alias method for CollectedData
    public CollectedDataDTO toCollectedDataDTO(CollectedData data) {
        return toDTO(data);
    }

    public DataSource toEntity(DataSourceCreateRequest request) {
        return DataSource.builder()
                .name(request.getName())
                .url(request.getUrl())
                .sourceType(request.getSourceType())
                .collectionFrequency(request.getCollectionFrequency())
                .metadataJson(toJson(request.getMetadata()))
                .isActive(true)
                .build();
    }

    // Alias method for DataSourceCreateRequest
    public DataSource toDataSource(DataSourceCreateRequest request) {
        return toEntity(request);
    }

    public void updateEntity(DataSource source, DataSourceUpdateRequest request) {
        if (request.getName() != null) {
            source.setName(request.getName());
        }
        if (request.getUrl() != null) {
            source.setUrl(request.getUrl());
        }
        if (request.getIsActive() != null) {
            source.setIsActive(request.getIsActive());
        }
        if (request.getCollectionFrequency() != null) {
            source.setCollectionFrequency(request.getCollectionFrequency());
        }
        if (request.getMetadata() != null) {
            source.setMetadataJson(toJson(request.getMetadata()));
        }
    }

    // Alias method for updating DataSource from request
    public void updateDataSourceFromRequest(DataSourceUpdateRequest request, DataSource source) {
        updateEntity(source, request);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseJson(String json) {
        if (json == null || json.isBlank()) {
            return Collections.emptyMap();
        }
        try {
            return objectMapper.readValue(json, Map.class);
        } catch (JsonProcessingException e) {
            return Collections.emptyMap();
        }
    }

    private String toJson(Map<String, Object> map) {
        if (map == null || map.isEmpty()) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(map);
        } catch (JsonProcessingException e) {
            return null;
        }
    }
}
