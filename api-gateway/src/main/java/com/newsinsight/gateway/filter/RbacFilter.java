package com.newsinsight.gateway.filter;

import lombok.extern.slf4j.Slf4j;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.util.List;
import java.util.Map;

/**
 * RBAC (Role-Based Access Control) 필터
 * 
 * Python FastAPI의 rbac_middleware와 동일한 기능 구현
 * - HTTP 메서드에 따라 필요한 권한 확인
 * - 사용자 역할에 따라 접근 제어
 */
@Slf4j
@Component
public class RbacFilter implements GlobalFilter, Ordered {
    
    // 역할별 권한 매핑 (Python의 ROLE_PERMISSIONS와 동일)
    private static final Map<String, List<String>> ROLE_PERMISSIONS = Map.of(
        "admin", List.of("READ", "WRITE", "DELETE", "ADMIN"),
        "analyst", List.of("READ", "WRITE"),
        "viewer", List.of("READ"),
        "system", List.of("READ", "WRITE", "DELETE")
    );
    
    // HTTP 메서드별 필요 권한
    private static final Map<HttpMethod, String> METHOD_PERMISSIONS = Map.of(
        HttpMethod.GET, "READ",
        HttpMethod.POST, "WRITE",
        HttpMethod.PUT, "WRITE",
        HttpMethod.PATCH, "WRITE",
        HttpMethod.DELETE, "DELETE"
    );
    
    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String userRole = exchange.getRequest().getHeaders().getFirst("X-User-Role");
        
        if (userRole == null) {
            // 인증되지 않은 요청 (public endpoint)
            log.debug("No user role found, allowing request to proceed");
            return chain.filter(exchange);
        }
        
        HttpMethod method = exchange.getRequest().getMethod();
        String requiredPermission = METHOD_PERMISSIONS.get(method);
        List<String> userPermissions = ROLE_PERMISSIONS.getOrDefault(userRole, List.of());
        
        if (requiredPermission != null && !userPermissions.contains(requiredPermission)) {
            log.warn("Access denied for role: {} on method: {}. Required permission: {}", 
                    userRole, method, requiredPermission);
            exchange.getResponse().setStatusCode(HttpStatus.FORBIDDEN);
            return exchange.getResponse().setComplete();
        }
        
        log.debug("Access granted for role: {} on method: {}", userRole, method);
        return chain.filter(exchange);
    }
    
    @Override
    public int getOrder() {
        return -90; // JWT 필터 다음 실행
    }
}
