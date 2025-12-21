package com.newsinsight.gateway.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.filter.ratelimit.KeyResolver;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.reactive.EnableWebFluxSecurity;
import org.springframework.security.config.web.server.ServerHttpSecurity;
import org.springframework.security.web.server.SecurityWebFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.reactive.CorsConfigurationSource;
import org.springframework.web.cors.reactive.UrlBasedCorsConfigurationSource;
import reactor.core.publisher.Mono;

import java.util.Arrays;
import java.util.List;

/**
 * API Gateway Security Configuration
 * 
 * 경로별 인증 정책:
 * - Public: 헬스체크, 인증 엔드포인트 (/api/v1/auth/**)
 * - Protected: 대부분의 API 엔드포인트 (JWT 검증은 downstream 서비스에서 처리)
 * 
 * NOTE: Gateway는 JWT 토큰을 downstream 서비스로 전달만 하고,
 * 실제 인증/인가는 각 서비스의 SecurityConfig에서 처리합니다.
 * Gateway에서는 기본적인 경로 기반 접근 제어만 수행합니다.
 */
@Configuration
@EnableWebFluxSecurity
public class SecurityConfig {

    @Value("${security.gateway.enabled:true}")
    private boolean securityEnabled;

    @Bean
    public SecurityWebFilterChain securityWebFilterChain(ServerHttpSecurity http) {
        if (!securityEnabled) {
            // 개발 환경에서만 사용 - 프로덕션에서는 절대 비활성화하지 마세요!
            return http
                    .csrf(ServerHttpSecurity.CsrfSpec::disable)
                    .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                    .httpBasic(ServerHttpSecurity.HttpBasicSpec::disable)
                    .formLogin(ServerHttpSecurity.FormLoginSpec::disable)
                    .authorizeExchange(exchange -> exchange.anyExchange().permitAll())
                    .build();
        }

        return http
                .csrf(ServerHttpSecurity.CsrfSpec::disable)
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                .httpBasic(ServerHttpSecurity.HttpBasicSpec::disable)
                .formLogin(ServerHttpSecurity.FormLoginSpec::disable)
                .authorizeExchange(exchange -> exchange
                        // ========================================
                        // Public Endpoints (인증 불필요)
                        // ========================================
                        // Health checks & Actuator
                        .pathMatchers("/actuator/**").permitAll()
                        .pathMatchers("/api/actuator/**").permitAll()
                        
                        // Authentication endpoints (login, register, token)
                        .pathMatchers("/api/v1/auth/login").permitAll()
                        .pathMatchers("/api/v1/auth/register").permitAll()
                        .pathMatchers("/api/v1/auth/token").permitAll()
                        .pathMatchers("/api/v1/auth/send-verification").permitAll()
                        .pathMatchers("/api/v1/auth/verify-email").permitAll()
                        .pathMatchers("/api/v1/auth/resend-verification").permitAll()
                        .pathMatchers("/api/v1/auth/check-username/**").permitAll()
                        .pathMatchers("/api/v1/auth/check-email/**").permitAll()
                        
                        // CORS preflight
                        .pathMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        
                        // ========================================
                        // Protected Endpoints (인증 필요 - downstream에서 검증)
                        // Gateway는 토큰을 전달만 하고, 실제 검증은 각 서비스에서 수행
                        // ========================================
                        // 모든 다른 요청은 통과시키되, downstream 서비스가 인증을 처리
                        .anyExchange().permitAll()
                )
                .build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOriginPatterns(List.of("*"));
        configuration.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"));
        configuration.setAllowedHeaders(List.of("*"));
        configuration.setAllowCredentials(true);
        configuration.setMaxAge(3600L);
        
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }

    /**
     * Rate Limiter용 KeyResolver
     * IP 주소 기반으로 Rate Limit 적용
     */
    @Bean
    public KeyResolver ipKeyResolver() {
        return exchange -> {
            var remoteAddress = exchange.getRequest().getRemoteAddress();
            String ip = remoteAddress != null
                    ? remoteAddress.getAddress().getHostAddress()
                    : "unknown";
            return Mono.just(ip);
        };
    }
}
