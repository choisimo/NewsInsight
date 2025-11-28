package com.newsinsight.collector.mapper;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.dto.*;
import com.newsinsight.collector.entity.CollectedData;
import com.newsinsight.collector.entity.CollectionJob;
import com.newsinsight.collector.entity.DataSource;
import com.newsinsight.collector.entity.SourceType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.Map;

@Component
public class EntityMapper {

    private static final Logger log = LoggerFactory.getLogger(EntityMapper.class);
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};

    private final ObjectMapper objectMapper;

    public EntityMapper(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public DataSourceDTO toDTO(DataSource source) {
        return new DataSourceDTO(
                source.getId(),
                source.getName(),
                source.getUrl(),
                source.getSourceType(),
                source.getIsActive(),
                source.getLastCollected(),
                source.getCollectionFrequency(),
                parseJson(source.getMetadataJson()),
                source.getCreatedAt(),
                source.getUpdatedAt(),
                BrowserAgentConfigDto.fromEntity(source.getBrowserAgentConfig())
        );
    }

    // Alias method for DataSource
    public DataSourceDTO toDataSourceDTO(DataSource source) {
        return toDTO(source);
    }

    public CollectionJobDTO toDTO(CollectionJob job) {
        return new CollectionJobDTO(
                job.getId(),
                job.getSourceId(),
                job.getStatus(),
                job.getStartedAt(),
                job.getCompletedAt(),
                job.getItemsCollected(),
                job.getErrorMessage(),
                job.getCreatedAt()
        );
    }

    // Alias method for CollectionJob
    public CollectionJobDTO toCollectionJobDTO(CollectionJob job) {
        return toDTO(job);
    }

    public CollectedDataDTO toDTO(CollectedData data) {
        return new CollectedDataDTO(
                data.getId(),
                data.getSourceId(),
                data.getTitle(),
                data.getContent(),
                data.getUrl(),
                data.getPublishedDate(),
                data.getCollectedAt(),
                data.getContentHash(),
                parseJson(data.getMetadataJson()),
                data.getProcessed()
        );
    }

    // Alias method for CollectedData
    public CollectedDataDTO toCollectedDataDTO(CollectedData data) {
        return toDTO(data);
    }

    public DataSource toEntity(DataSourceCreateRequest request) {
        DataSource.DataSourceBuilder builder = DataSource.builder()
                .name(request.name())
                .url(request.url())
                .sourceType(request.sourceType())
                .collectionFrequency(request.collectionFrequency())
                .metadataJson(toJson(request.metadata()))
                .isActive(true);

        // Set browser agent config if applicable
        if (request.sourceType() == SourceType.BROWSER_AGENT && request.browserAgentConfig() != null) {
            builder.browserAgentConfig(request.browserAgentConfig().toEntity());
        }

        return builder.build();
    }

    // Alias method for DataSourceCreateRequest
    public DataSource toDataSource(DataSourceCreateRequest request) {
        return toEntity(request);
    }

    public void updateEntity(DataSource source, DataSourceUpdateRequest request) {
        if (request.name() != null) {
            source.setName(request.name());
        }
        if (request.url() != null) {
            source.setUrl(request.url());
        }
        if (request.isActive() != null) {
            source.setIsActive(request.isActive());
        }
        if (request.collectionFrequency() != null) {
            source.setCollectionFrequency(request.collectionFrequency());
        }
        if (request.metadata() != null) {
            source.setMetadataJson(toJson(request.metadata()));
        }
        // Update browser agent config if provided
        if (request.browserAgentConfig() != null) {
            source.setBrowserAgentConfig(request.browserAgentConfig().toEntity());
        }
    }

    // Alias method for updating DataSource from request
    public void updateDataSourceFromRequest(DataSourceUpdateRequest request, DataSource source) {
        updateEntity(source, request);
    }

    private Map<String, Object> parseJson(String json) {
        if (json == null || json.isBlank()) {
            return Collections.emptyMap();
        }
        try {
            return objectMapper.readValue(json, MAP_TYPE);
        } catch (JsonProcessingException e) {
            log.warn("Failed to parse metadata JSON. Returning empty map. Data: {}", json, e);
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
            log.warn("Failed to serialize metadata map. Returning null. Data: {}", map, e);
            return null;
        }
    }
}
