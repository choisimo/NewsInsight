package com.newsinsight.collector.config;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.crypto.SecretKey;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * Security Configuration for Data Collection Service
 * 
 * 엔드포인트별 인증/인가 정책:
 * - Public: 헬스체크, Swagger, actuator
 * - Authenticated: 일반 API (search, data, analysis, reports 등)
 * - Admin Only: workspace/admin/*, 관리 엔드포인트
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity(prePostEnabled = true)
public class SecurityConfig {

    private static final Logger log = LoggerFactory.getLogger(SecurityConfig.class);

    @Value("${security.jwt.secret:${ADMIN_SECRET_KEY:your-secret-key-change-in-production}}")
    private String jwtSecret;

    @Value("${security.enabled:true}")
    private boolean securityEnabled;

    @Value("${security.cors.enabled:true}")
    private boolean corsEnabled;

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http, JwtAuthenticationFilter jwtFilter) throws Exception {
        if (!securityEnabled) {
            log.warn("Security is DISABLED. All endpoints are publicly accessible. DO NOT USE IN PRODUCTION!");
            var httpConfig = http
                    .csrf(AbstractHttpConfigurer::disable);
            
            // Only add CORS if enabled (disable when behind API Gateway to avoid duplicate headers)
            if (corsEnabled) {
                httpConfig.cors(cors -> cors.configurationSource(corsConfigurationSource()));
            } else {
                log.info("CORS is DISABLED on this service (handled by API Gateway)");
                httpConfig.cors(AbstractHttpConfigurer::disable);
            }
            
            return httpConfig
                    .authorizeHttpRequests(auth -> auth.anyRequest().permitAll())
                    .build();
        }

        var httpConfig = http
                .csrf(AbstractHttpConfigurer::disable);
        
        // Only add CORS if enabled (disable when behind API Gateway to avoid duplicate headers)
        if (corsEnabled) {
            httpConfig.cors(cors -> cors.configurationSource(corsConfigurationSource()));
        } else {
            log.info("CORS is DISABLED on this service (handled by API Gateway)");
            httpConfig.cors(AbstractHttpConfigurer::disable);
        }

        return httpConfig
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        // ========================================
                        // Public Endpoints (인증 불필요)
                        // ========================================
                        .requestMatchers("/actuator/**").permitAll()
                        .requestMatchers("/swagger-ui/**", "/v3/api-docs/**", "/swagger-resources/**").permitAll()
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        
                        // Health Check Endpoints (각 서비스별)
                        .requestMatchers("/api/v1/search/health").permitAll()
                        .requestMatchers("/api/v1/jobs/health").permitAll()
                        .requestMatchers("/api/v1/search-history/health").permitAll()
                        .requestMatchers("/api/v1/search-templates/health").permitAll()
                        .requestMatchers("/api/v1/projects/health").permitAll()
                        .requestMatchers("/api/v1/ai/health").permitAll()
                        .requestMatchers("/api/v1/analysis/deep/health").permitAll()
                        .requestMatchers("/api/v1/analysis/live/health").permitAll()
                        .requestMatchers("/api/v1/analysis/extract-claims/health").permitAll()
                        .requestMatchers("/api/v1/factcheck-chat/health").permitAll()
                        .requestMatchers("/api/v1/factcheck-chat/health/**").permitAll()
                        .requestMatchers("/api/v1/workspace/files/health").permitAll()
                        .requestMatchers("/api/v1/ml/status").permitAll()
                        
                        // ========================================
                        // SSE Endpoints (EventSource는 Authorization 헤더 미지원)
                        // 실시간 스트림은 별도 인증 없이 허용
                        // ========================================
                        .requestMatchers("/api/v1/jobs/stream").permitAll()
                        .requestMatchers("/api/v1/jobs/*/stream").permitAll()
                        .requestMatchers("/api/v1/events/stream").permitAll()
                        .requestMatchers("/api/v1/events/stats/stream").permitAll()
                        .requestMatchers("/api/v1/search/stream").permitAll()
                        .requestMatchers("/api/v1/search/deep/stream").permitAll()
                        .requestMatchers("/api/v1/search/jobs/*/stream").permitAll()
                        .requestMatchers("/api/v1/search/analysis/stream").permitAll()
                        .requestMatchers("/api/v1/search/analysis/stream/status").permitAll()
                        .requestMatchers("/api/v1/analysis/deep/*/stream").permitAll()
                        .requestMatchers("/api/v1/analysis/live").permitAll()
                        .requestMatchers("/api/v1/search-history/stream").permitAll()
                        .requestMatchers("/api/v1/factcheck-chat/session/*/message").permitAll()
                        .requestMatchers("/api/v1/factcheck-chat/session").permitAll()
                        .requestMatchers("/api/v1/factcheck-chat/session/**").permitAll()
                        
                        // ========================================
                        // Public Report Export (익명 세션에서도 PDF 다운로드 허용)
                        // ========================================
                        .requestMatchers("/api/v1/reports/*/export").permitAll()
                        .requestMatchers("/api/v1/reports/unified-search/*/export").permitAll()
                        .requestMatchers("/api/v1/reports/deep-search/*/export").permitAll()
                        .requestMatchers("/api/v1/reports/ml-analysis/*/export").permitAll()
                        
                        // ========================================
                        // Admin Only Endpoints (ADMIN 권한 필요)
                        // ========================================
                        .requestMatchers("/api/v1/workspace/admin/**").hasRole("ADMIN")
                        .requestMatchers("/api/v1/workspace/files/admin/**").hasRole("ADMIN")
                        .requestMatchers("/api/v1/admin/llm-providers/**").hasRole("ADMIN")
                        .requestMatchers("/api/v1/llm-providers/**").hasAnyRole("ADMIN", "OPERATOR")
                        
                        // ========================================
                        // Authenticated Endpoints (로그인 필요)
                        // ========================================
                        // Search API
                        .requestMatchers("/api/v1/search/**").authenticated()
                        .requestMatchers("/api/v1/search-history/**").authenticated()
                        .requestMatchers("/api/v1/search-templates/**").authenticated()
                        
                        // Data & Collections
                        .requestMatchers("/api/v1/data/**").authenticated()
                        .requestMatchers("/api/v1/collections/**").authenticated()
                        .requestMatchers("/api/v1/sources/**").authenticated()
                        
                        // Analysis & AI
                        .requestMatchers("/api/v1/analysis/**").authenticated()
                        .requestMatchers("/api/v1/ai/**").authenticated()
                        .requestMatchers("/api/v1/ml/**").authenticated()
                        
                        // Reports
                        .requestMatchers("/api/v1/reports/**").authenticated()
                        
                        // Projects & Workspace (일반)
                        .requestMatchers("/api/v1/projects/**").authenticated()
                        .requestMatchers("/api/v1/workspace/**").authenticated()
                        
                        // Articles
                        .requestMatchers("/api/v1/articles/**").authenticated()
                        
                        // Jobs & AutoCrawl
                        .requestMatchers("/api/v1/jobs/**").authenticated()
                        .requestMatchers("/api/v1/autocrawl/**").authenticated()
                        
                        // Events (SSE)
                        .requestMatchers("/api/v1/events/**").authenticated()
                        
                        // Factcheck Chat
                        .requestMatchers("/api/v1/factcheck-chat/**").authenticated()
                        
                        // Config (read-only for authenticated users)
                        .requestMatchers(HttpMethod.GET, "/api/v1/config/**").authenticated()
                        .requestMatchers("/api/v1/config/**").hasAnyRole("ADMIN", "OPERATOR")
                        
                        // Default: require authentication
                        .anyRequest().authenticated()
                )
                .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class)
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
     * JWT Authentication Filter
     * Authorization 헤더에서 Bearer 토큰을 추출하고 검증합니다.
     */
    @Component
    public static class JwtAuthenticationFilter extends OncePerRequestFilter {

        private static final Logger log = LoggerFactory.getLogger(JwtAuthenticationFilter.class);

        @Value("${security.jwt.secret:${ADMIN_SECRET_KEY:your-secret-key-change-in-production}}")
        private String jwtSecret;

        @Value("${security.enabled:true}")
        private boolean securityEnabled;

        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
                throws ServletException, IOException {

            if (!securityEnabled) {
                filterChain.doFilter(request, response);
                return;
            }

            String authHeader = request.getHeader("Authorization");

            if (authHeader == null || !authHeader.startsWith("Bearer ")) {
                filterChain.doFilter(request, response);
                return;
            }

            try {
                String token = authHeader.substring(7);
                SecretKey key = Keys.hmacShaKeyFor(jwtSecret.getBytes(StandardCharsets.UTF_8));

                Claims claims = Jwts.parser()
                        .verifyWith(key)
                        .build()
                        .parseSignedClaims(token)
                        .getPayload();

                String userId = claims.getSubject();
                String username = claims.get("username", String.class);
                String role = claims.get("role", String.class);

                if (userId != null && SecurityContextHolder.getContext().getAuthentication() == null) {
                    List<SimpleGrantedAuthority> authorities;
                    
                    if (role != null) {
                        // role이 "admin", "operator", "user" 형태로 올 수 있음
                        String normalizedRole = role.toUpperCase();
                        authorities = List.of(new SimpleGrantedAuthority("ROLE_" + normalizedRole));
                    } else {
                        authorities = List.of(new SimpleGrantedAuthority("ROLE_USER"));
                    }

                    UsernamePasswordAuthenticationToken authentication = new UsernamePasswordAuthenticationToken(
                            userId,
                            null,
                            authorities
                    );
                    authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));

                    SecurityContextHolder.getContext().setAuthentication(authentication);
                    
                    log.debug("JWT authenticated: user={}, role={}", username, role);
                }

            } catch (Exception e) {
                log.warn("JWT authentication failed: {}", e.getMessage());
                // 인증 실패 시 SecurityContext를 비워두고 계속 진행
                // Spring Security가 인증되지 않은 요청으로 처리함
            }

            filterChain.doFilter(request, response);
        }

        @Override
        protected boolean shouldNotFilter(HttpServletRequest request) {
            String path = request.getServletPath();
            // Public 엔드포인트는 필터 스킵
            return path.startsWith("/actuator") ||
                   path.startsWith("/swagger-ui") ||
                   path.startsWith("/v3/api-docs") ||
                   path.endsWith("/health") ||
                   path.contains("/health/") ||
                   path.endsWith("/stream") ||
                   path.contains("/stream/");
        }
    }
}
