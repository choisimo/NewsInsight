package com.newsinsight.gateway.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/config")
public class FrontendConfigController {

    @Value("${FRONTEND_API_BASE_URL:${API_GATEWAY_FRONTEND_API_BASE_URL:http://localhost:8112}}")
    private String frontendApiBaseUrl;

    @CrossOrigin(origins = "*")
    @GetMapping("/frontend")
    public ResponseEntity<Map<String, String>> getFrontendConfig() {
        Map<String, String> body = new HashMap<>();
        body.put("apiBaseUrl", frontendApiBaseUrl);
        return ResponseEntity.ok(body);
    }
}
