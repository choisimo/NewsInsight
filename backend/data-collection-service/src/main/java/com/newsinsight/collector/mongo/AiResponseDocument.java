package com.newsinsight.collector.mongo;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.Map;

@Document(collection = "ai_responses")
public class AiResponseDocument {

    @Id
    private String id; // requestId

    private String status;
    private String completedAt;
    private String providerId;
    private String modelId;
    private String text;
    private Map<String, Object> raw;

    @Indexed(expireAfterSeconds = 604800) // 7 days
    private Instant createdAt;

    public AiResponseDocument() {
    }

    public AiResponseDocument(String id,
                              String status,
                              String completedAt,
                              String providerId,
                              String modelId,
                              String text,
                              Map<String, Object> raw,
                              Instant createdAt) {
        this.id = id;
        this.status = status;
        this.completedAt = completedAt;
        this.providerId = providerId;
        this.modelId = modelId;
        this.text = text;
        this.raw = raw;
        this.createdAt = createdAt;
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getCompletedAt() {
        return completedAt;
    }

    public void setCompletedAt(String completedAt) {
        this.completedAt = completedAt;
    }

    public String getProviderId() {
        return providerId;
    }

    public void setProviderId(String providerId) {
        this.providerId = providerId;
    }

    public String getModelId() {
        return modelId;
    }

    public void setModelId(String modelId) {
        this.modelId = modelId;
    }

    public String getText() {
        return text;
    }

    public void setText(String text) {
        this.text = text;
    }

    public Map<String, Object> getRaw() {
        return raw;
    }

    public void setRaw(Map<String, Object> raw) {
        this.raw = raw;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}
