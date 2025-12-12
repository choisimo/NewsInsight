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
        "/api/v1/auth/login",
        "/api/v1/auth/register",
        "/api/v1/articles",
        "/api/v1/analysis",
        "/api/v1/config",
        "/api/v1/sources",
        "/api/v1/collections",
        "/api/v1/data",
        "/api/v1/search",
        "/api/v1/events",        // SSE 이벤트 스트림 (EventSource는 헤더 전송 불가)
        "/api/v1/search-history",
        "/api/v1/search-templates",
        "/api/v1/admin",         // Admin Dashboard (자체 인증 처리)
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
        
        // 공개 엔드포인트는 인증 스킵
        if (PUBLIC_PATHS.stream().anyMatch(path::startsWith)) {
            log.debug("Skipping authentication for public path: {}", path);
            return chain.filter(exchange);
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
