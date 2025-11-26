package com.newsinsight.collector.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * DTO for n8n callback payload
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DeepSearchCallbackDto {
    
    @JsonProperty("job_id")
    private String jobId;
    
    private String status;
    
    private String topic;
    
    @JsonProperty("base_url")
    private String baseUrl;
    
    private List<CallbackEvidence> evidence;
    
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class CallbackEvidence {
        private String url;
        private String title;
        private String stance;
        private String snippet;
        private String source;
    }
}
