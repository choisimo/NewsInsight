package com.newsinsight.gateway.filter;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.HttpCookie;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.util.MultiValueMap;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * JWT 인증 필터
 * 
 * Python FastAPI의 auth_middleware와 동일한 기능 구현
 * - Authorization 헤더에서 Bearer 토큰 추출
 * - Cookie에서 access_token 추출 (SSE/EventSource 지원)
 * - 쿼리 파라미터에서 token 추출 (fallback)
 * - JWT 토큰 검증 (서명, 만료 시간 등)
 * - 사용자 정보를 헤더에 추가하여 다운스트림 서비스로 전달
 */
@Slf4j
@Component
public class JwtAuthenticationFilter implements GlobalFilter, Ordered {
    
    // 인증 불필요한 공개 경로
    private static final List<String> PUBLIC_PATHS = List.of(
        "/health",
        "/actuator",
        "/api/v1/auth",          // Public Auth API (register, login, check-username, check-email)
        "/api/v1/articles",
        "/api/v1/analysis",
        "/api/v1/ai",
        "/api/v1/config",
        "/api/v1/sources",
        "/api/v1/collections",
        "/api/v1/data",
        "/api/v1/search",
        "/api/v1/events",        // SSE 이벤트 스트림 (EventSource는 헤더 전송 불가)
        "/api/v1/search-history",
        "/api/v1/search-templates",
        "/api/v1/jobs",          // Search Jobs API (SSE 스트림 포함)
        "/api/v1/projects",      // Projects API (익명 사용자 지원)
        "/api/v1/ai",
        "/api/v1/ml",
        "/api/v1/llm-providers", // LLM Provider Settings (사용자별 설정 지원)
        "/api/v1/admin",         // Admin Dashboard (자체 인증 처리)
        "/api/v1/crawler",       // Autonomous Crawler API
        "/api/v1/autocrawl",     // AutoCrawl API (자동 크롤링 관리)
        "/api/v1/factcheck-chat", // Fact Check Chat API (익명 세션 지원)
        "/api/v1/reports",       // PDF Report Export (익명 세션에서도 다운로드 허용)
        "/api/v1/ai",
        "/api/v1/*",
        "/api/browser-use",      // Browser-Use API (gateway path)
        "/api/ml-addons",        // ML Add-ons API (sentiment, factcheck, bias)
        "/browse",               // Browser-Use API (direct path - legacy)
        "/jobs",                 // Browser-Use Jobs (direct path - legacy)
        "/ws"                    // WebSocket (direct path - legacy)
    );
    
    @Value("${JWT_SECRET_KEY:default-secret-key-please-change-in-consul}")
    private String jwtSecretKey;
    
    @Value("${JWT_ALGORITHM:HS256}")
    private String jwtAlgorithm;
    
    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getPath().value();
        
        // 공개 엔드포인트는 인증 스킵하지만 익명 사용자 헤더는 추가
        if (PUBLIC_PATHS.stream().anyMatch(path::startsWith)) {
            log.debug("Public path: {}, adding anonymous user headers", path);
            return handleAnonymousUser(exchange, chain);
        }
        
        // 토큰 추출 (우선순위: Authorization 헤더 > Cookie > Query Parameter)
        String token = extractToken(exchange);
        
        if (token == null) {
            log.warn("No valid token found for path: {}", path);
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }
        
        try {
            // JWT 토큰 파싱 및 검증
            SecretKey key = Keys.hmacShaKeyFor(jwtSecretKey.getBytes(StandardCharsets.UTF_8));
            Claims claims = Jwts.parser()
                    .verifyWith(key)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
            
            // 사용자 정보를 헤더에 추가 (다운스트림 서비스에서 사용)
            ServerHttpRequest mutatedRequest = exchange.getRequest().mutate()
                    .header("X-User-Id", claims.getSubject())
                    .header("X-User-Role", claims.get("role", String.class))
                    .header("X-Username", claims.get("username", String.class))
                    .build();
            
            log.debug("Authenticated user: {} with role: {}", 
                    claims.get("username", String.class), 
                    claims.get("role", String.class));
            
            return chain.filter(exchange.mutate().request(mutatedRequest).build());
            
        } catch (Exception e) {
            log.error("JWT authentication failed: {}", e.getMessage());
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }
    }
    
    /**
     * Handle anonymous user by generating unique user ID based on session
     * This prevents data leakage between different anonymous users
     */
    private Mono<Void> handleAnonymousUser(ServerWebExchange exchange, GatewayFilterChain chain) {
        // Extract session ID from headers (sent by frontend)
        String sessionId = exchange.getRequest().getHeaders().getFirst("X-Session-Id");
        String deviceId = exchange.getRequest().getHeaders().getFirst("X-Device-Id");
        
        // Generate unique anonymous user ID based on session
        String anonymousUserId;
        if (sessionId != null && !sessionId.isBlank()) {
            anonymousUserId = "user_anon_" + sessionId;
        } else {
            // Fallback: use device ID or generate random ID
            if (deviceId != null && !deviceId.isBlank()) {
                anonymousUserId = "user_anon_" + deviceId;
            } else {
                // Last resort: generate random ID (not ideal, but prevents null)
                anonymousUserId = "user_anon_" + System.currentTimeMillis();
            }
            log.warn("No session ID provided, using fallback anonymous user ID: {}", anonymousUserId);
        }
        
        // Add anonymous user headers for downstream services
        ServerHttpRequest mutatedRequest = exchange.getRequest().mutate()
                .header("X-User-Id", anonymousUserId)
                .header("X-User-Role", "anonymous")
                .header("X-Session-Id", sessionId != null ? sessionId : "")
                .header("X-Device-Id", deviceId != null ? deviceId : "")
                .build();
        
        log.debug("Anonymous user: userId={}, sessionId={}", anonymousUserId, sessionId);
        
        return chain.filter(exchange.mutate().request(mutatedRequest).build());
    }
    
    /**
     * 여러 소스에서 JWT 토큰 추출
     * 우선순위:
     * 1. Authorization 헤더 (Bearer token)
     * 2. Cookie (access_token)
     * 3. Query Parameter (token)
     */
    private String extractToken(ServerWebExchange exchange) {
        // 1. Authorization 헤더에서 추출
        String authHeader = exchange.getRequest().getHeaders().getFirst("Authorization");
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            log.debug("Token extracted from Authorization header");
            return authHeader.substring(7);
        }
        
        // 2. Cookie에서 추출 (SSE/EventSource 지원)
        MultiValueMap<String, HttpCookie> cookies = exchange.getRequest().getCookies();
        HttpCookie accessTokenCookie = cookies.getFirst("access_token");
        if (accessTokenCookie != null && !accessTokenCookie.getValue().isEmpty()) {
            log.debug("Token extracted from access_token cookie");
            return accessTokenCookie.getValue();
        }
        
        // 3. Query Parameter에서 추출 (fallback)
        String queryToken = exchange.getRequest().getQueryParams().getFirst("token");
        if (queryToken != null && !queryToken.isEmpty()) {
            log.debug("Token extracted from query parameter");
            return queryToken;
        }
        
        return null;
    }
    
    @Override
    public int getOrder() {
        return -100; // 높은 우선순위 (먼저 실행)
    }
}
