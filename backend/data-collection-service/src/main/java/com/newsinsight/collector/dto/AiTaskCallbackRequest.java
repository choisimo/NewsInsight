package com.newsinsight.collector.dto;

import java.util.List;

/**
 * Callback request payload from AI worker/n8n.
 * Received at /api/v1/ai/callback endpoint.
 */
public record AiTaskCallbackRequest(
        /**
         * Parent job ID
         */
        String jobId,

        /**
         * Individual sub-task ID
         */
        String subTaskId,

        /**
         * AI provider identifier
         */
        String providerId,

        /**
         * Task completion status (COMPLETED, FAILED, etc.)
         */
        String status,

        /**
         * JSON result data from the AI task
         */
        String resultJson,

        /**
         * Error message if task failed
         */
        String errorMessage,

        /**
         * Callback authentication token
         */
        String callbackToken,

        /**
         * Evidence list (for DEEP_READER provider)
         */
        List<EvidenceDto> evidence
) {
    /**
     * Check if the callback indicates success
     */
    public boolean isSuccess() {
        return "COMPLETED".equalsIgnoreCase(status) || "completed".equalsIgnoreCase(status);
    }

    /**
     * Check if the callback indicates failure
     */
    public boolean isFailed() {
        return "FAILED".equalsIgnoreCase(status) || "failed".equalsIgnoreCase(status);
    }

    /**
     * Create a builder for AiTaskCallbackRequest
     */
    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private String jobId;
        private String subTaskId;
        private String providerId;
        private String status;
        private String resultJson;
        private String errorMessage;
        private String callbackToken;
        private List<EvidenceDto> evidence;

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

        public Builder status(String status) {
            this.status = status;
            return this;
        }

        public Builder resultJson(String resultJson) {
            this.resultJson = resultJson;
            return this;
        }

        public Builder errorMessage(String errorMessage) {
            this.errorMessage = errorMessage;
            return this;
        }

        public Builder callbackToken(String callbackToken) {
            this.callbackToken = callbackToken;
            return this;
        }

        public Builder evidence(List<EvidenceDto> evidence) {
            this.evidence = evidence;
            return this;
        }

        public AiTaskCallbackRequest build() {
            return new AiTaskCallbackRequest(
                    jobId, subTaskId, providerId, status,
                    resultJson, errorMessage, callbackToken, evidence
            );
        }
    }
}
