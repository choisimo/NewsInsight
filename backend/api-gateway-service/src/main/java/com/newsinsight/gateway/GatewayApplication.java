package com.newsinsight.gateway;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;

/**
 * NewsInsight API Gateway Application
 * 
 * Spring Cloud Gateway 기반의 API Gateway 서비스
 * - JWT 인증/인가
 * - RBAC (Role-Based Access Control)
 * - Rate Limiting (Redis 기반)
 * - Service Discovery (Consul)
 * - Dynamic Configuration (Consul KV)
 */
@SpringBootApplication
@EnableDiscoveryClient
public class GatewayApplication {

    public static void main(String[] args) {
        SpringApplication.run(GatewayApplication.class, args);
    }
}
