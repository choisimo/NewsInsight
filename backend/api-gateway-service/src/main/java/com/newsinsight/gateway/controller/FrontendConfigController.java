package com.newsinsight.gateway.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.util.HashMap;
import java.util.Map;
import java.util.Base64;

@RestController
@RequestMapping("/api/v1/config")
public class FrontendConfigController {

    @Value("${FRONTEND_API_BASE_URL:${API_GATEWAY_FRONTEND_API_BASE_URL:http://localhost:8112}}")
    private String frontendApiBaseUrl;

    @Value("${spring.cloud.consul.host:consul}")
    private String consulHost;

    @Value("${spring.cloud.consul.port:8500}")
    private int consulPort;

    private final WebClient webClient;

    public FrontendConfigController(WebClient.Builder webClientBuilder) {
        this.webClient = webClientBuilder.build();
    }

    @CrossOrigin(origins = "*")
    @GetMapping("/frontend")
    public ResponseEntity<Map<String, String>> getFrontendConfig() {
        Map<String, String> body = new HashMap<>();
        body.put("apiBaseUrl", frontendApiBaseUrl);
        return ResponseEntity.ok(body);
    }

    /**
     * Save AI/LLM settings to Consul KV store
     * PUT /api/v1/config/ai-settings
     */
    @CrossOrigin(origins = "*")
    @PutMapping("/ai-settings")
    public Mono<ResponseEntity<Map<String, Object>>> saveAISettings(@RequestBody Map<String, String> settings) {
        String consulUrl = "http://" + consulHost + ":" + consulPort;
        
        // Save each setting to Consul KV under config/autonomous-crawler/ prefix
        return Mono.when(
            settings.entrySet().stream()
                .map(entry -> {
                    String key = "config/autonomous-crawler/" + entry.getKey();
                    Object value = entry.getValue();
                    // Consul expects base64 encoded value for PUT
                    return webClient.put()
                        .uri(consulUrl + "/v1/kv/" + key)
                        .bodyValue(value.toString().isEmpty() ? "" : value)
                        .retrieve()
                        .bodyToMono(Boolean.class)
                        .onErrorReturn(false);
                })
                .toArray(Mono[]::new)
        ).then(Mono.fromCallable(() -> {
            Map<String, Object> response = new HashMap<>();
            response.put("success", true);
            response.put("message", "AI settings saved to Consul");
            response.put("keysCount", settings.size());
            return ResponseEntity.ok(response);
        }));
    }

    /**
     * Get AI/LLM settings from Consul KV store
     * GET /api/v1/config/ai-settings
     */
    @CrossOrigin(origins = "*")
    @GetMapping("/ai-settings")
    public Mono<ResponseEntity<Map<String, String>>> getAISettings() {
        String consulUrl = "http://" + consulHost + ":" + consulPort;
        
        return webClient.get()
            .uri(consulUrl + "/v1/kv/config/autonomous-crawler/?recurse=true")
            .retrieve()
            .bodyToMono(Object[].class)
            .map(entries -> {
                Map<String, String> settings = new HashMap<>();
                if (entries != null) {
                    for (Object entry : entries) {
                        if (entry instanceof Map) {
                            @SuppressWarnings("unchecked")
                            Map<String, Object> kvEntry = (Map<String, Object>) entry;
                            String fullKey = (String) kvEntry.get("Key");
                            String encodedValue = (String) kvEntry.get("Value");
                            
                            if (fullKey != null && encodedValue != null) {
                                // Remove prefix and decode value
                                String key = fullKey.replace("config/autonomous-crawler/", "");
                                String value = new String(Base64.getDecoder().decode(encodedValue));
                                settings.put(key, value);
                            }
                        }
                    }
                }
                return ResponseEntity.ok(settings);
            })
            .onErrorReturn(ResponseEntity.ok(new HashMap<>()));
    }
}
