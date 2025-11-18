package com.newsinsight.gateway.filter;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
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
        "/api/v1/config"
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
        
        String authHeader = exchange.getRequest().getHeaders().getFirst("Authorization");
        
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            log.warn("Missing or invalid Authorization header for path: {}", path);
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }
        
        String token = authHeader.substring(7);
        
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
    
    @Override
    public int getOrder() {
        return -100; // 높은 우선순위 (먼저 실행)
    }
}
