package com.newsinsight.collector.dto;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Kafka message for AI task requests.
 * Sent to ai.tasks.requests topic for worker/n8n processing.
 */
public record AiTaskRequestMessage(
        /**
         * Parent job ID
         */
        String jobId,

        /**
         * Individual sub-task ID
         */
        String subTaskId,

        /**
         * AI provider identifier (UNIVERSAL_AGENT, DEEP_READER, SCOUT, etc.)
         */
        String providerId,

        /**
         * Type of task to perform
         */
        String taskType,

        /**
         * Search topic/query
         */
        String topic,

        /**
         * Base URL for crawling (optional)
         */
        String baseUrl,

        /**
         * Additional payload data for the provider
         */
        Map<String, Object> payload,

        /**
         * URL for callback after task completion
         */
        String callbackUrl,

        /**
         * Token for callback authentication
         */
        String callbackToken,

        /**
         * Message creation timestamp
         */
        LocalDateTime createdAt
) {
    /**
     * Create a builder for AiTaskRequestMessage
     */
    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private String jobId;
        private String subTaskId;
        private String providerId;
        private String taskType;
        private String topic;
        private String baseUrl;
        private Map<String, Object> payload;
        private String callbackUrl;
        private String callbackToken;
        private LocalDateTime createdAt;

        public Builder jobId(String jobId) {
            this.jobId = jobId;
            return this;
        }

        public Builder subTaskId(String subTaskId) {
            this.subTaskId = subTaskId;
            return this;
        }

        public Builder providerId(String providerId) {
            this.providerId = providerId;
            return this;
        }

        public Builder taskType(String taskType) {
            this.taskType = taskType;
            return this;
        }

        public Builder topic(String topic) {
            this.topic = topic;
            return this;
        }

        public Builder baseUrl(String baseUrl) {
            this.baseUrl = baseUrl;
            return this;
        }

        public Builder payload(Map<String, Object> payload) {
            this.payload = payload;
            return this;
        }

        public Builder callbackUrl(String callbackUrl) {
            this.callbackUrl = callbackUrl;
            return this;
        }

        public Builder callbackToken(String callbackToken) {
            this.callbackToken = callbackToken;
            return this;
        }

        public Builder createdAt(LocalDateTime createdAt) {
            this.createdAt = createdAt;
            return this;
        }

        public AiTaskRequestMessage build() {
            return new AiTaskRequestMessage(
                    jobId, subTaskId, providerId, taskType, topic, baseUrl,
                    payload, callbackUrl, callbackToken,
                    createdAt != null ? createdAt : LocalDateTime.now()
            );
        }
    }
}
