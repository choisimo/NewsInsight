# Project Code Snapshot

Generated at 2025-12-22T11:56:45.049Z

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/config/SecurityConfig.java

```java
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
                        // Factcheck Chat - 익명 세션도 사용 가능하도록 전체 허용
                        .requestMatchers(HttpMethod.POST, "/api/v1/factcheck-chat/session").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/factcheck-chat/session/**").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/v1/factcheck-chat/session/**").permitAll()
                        .requestMatchers("/api/v1/factcheck-chat/**").permitAll()
                        
                        // ========================================
                        // Public Report Export (익명 세션에서도 PDF 다운로드 허용)
                        // Note: Spring Security 6에서 ** 뒤에 추가 패턴 불가
                        // ========================================
                        .requestMatchers("/api/v1/reports/**").permitAll()
                        
                        // ========================================
                        // Admin Only Endpoints (ADMIN 권한 필요)
                        // ========================================
                        .requestMatchers("/api/v1/workspace/admin/**").hasRole("ADMIN")
                        .requestMatchers("/api/v1/workspace/files/admin/**").hasRole("ADMIN")
                        .requestMatchers("/api/v1/admin/llm-providers/**").hasRole("ADMIN")
                        // LLM Provider 설정 - 읽기 엔드포인트는 공개
                        .requestMatchers("/api/v1/llm-providers/types").permitAll()
                        .requestMatchers("/api/v1/llm-providers/effective").permitAll()
                        .requestMatchers("/api/v1/llm-providers/enabled").permitAll()
                        .requestMatchers("/api/v1/llm-providers/config/**").permitAll()
                        .requestMatchers("/api/v1/llm-providers/user").permitAll()
                        .requestMatchers("/api/v1/llm-providers/user/**").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/llm-providers/**").permitAll()
                        .requestMatchers("/api/v1/llm-providers/**").hasAnyRole("ADMIN", "OPERATOR")
                        
                        // ========================================
                        // Authenticated Endpoints (로그인 필요 X)
                        // ========================================
                        // Search API - 루트 경로와 하위 경로 모두 허용
                        .requestMatchers("/api/v1/search").permitAll()
                        .requestMatchers("/api/v1/search/**").permitAll()
                        // Search History & Templates - 익명 사용자도 허용 (프론트엔드 대시보드)
                        .requestMatchers("/api/v1/search-history/**").permitAll()
                        .requestMatchers("/api/v1/search-templates/**").permitAll()
                        
                        // Data & Collections
                        .requestMatchers("/api/v1/data/**").permitAll()
                        .requestMatchers("/api/v1/collections/**").permitAll()
                        .requestMatchers("/api/v1/sources/**").permitAll()
                        
                        // Analysis & AI
                        .requestMatchers("/api/v1/analysis/**").permitAll()
                        .requestMatchers("/api/v1/ai/**").permitAll()
                        .requestMatchers("/api/v1/ml/**").permitAll()
                        
                        // Projects & Workspace (일반)
                        .requestMatchers("/api/v1/projects/**").permitAll()
                        .requestMatchers("/api/v1/workspace/**").permitAll()
                        
                        // Articles
                        .requestMatchers("/api/v1/articles/**").permitAll()
                        
                        // Jobs & AutoCrawl
                        .requestMatchers("/api/v1/jobs/**").permitAll()
                        .requestMatchers("/api/v1/autocrawl/**").permitAll()
                        
                        // Events (SSE)
                        .requestMatchers("/api/v1/events/**").permitAll()
                        
                        // Config (read-only for authenticated users)
                        .requestMatchers(HttpMethod.GET, "/api/v1/config/**").permitAll()
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

            // Try to extract token from multiple sources
            String token = extractToken(request);

            if (token == null) {
                filterChain.doFilter(request, response);
                return;
            }

            try {
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

        /**
         * Extract JWT token from multiple sources:
         * 1. Authorization header (Bearer token)
         * 2. Query parameter (token)
         * 3. Cookie (access_token)
         * 
         * This allows SSE/EventSource connections to be authenticated
         * since EventSource doesn't support custom headers.
         */
        private String extractToken(HttpServletRequest request) {
            // 1. Check Authorization header first (standard method)
            String authHeader = request.getHeader("Authorization");
            if (authHeader != null && authHeader.startsWith("Bearer ")) {
                return authHeader.substring(7);
            }

            // 2. Check query parameter (for SSE/EventSource)
            String tokenParam = request.getParameter("token");
            if (tokenParam != null && !tokenParam.isBlank()) {
                return tokenParam;
            }

            // 3. Check cookie (for SSE/EventSource)
            if (request.getCookies() != null) {
                for (jakarta.servlet.http.Cookie cookie : request.getCookies()) {
                    if ("access_token".equals(cookie.getName())) {
                        String cookieValue = cookie.getValue();
                        if (cookieValue != null && !cookieValue.isBlank()) {
                            return cookieValue;
                        }
                    }
                }
            }

            return null;
        }

        @Override
        protected boolean shouldNotFilter(HttpServletRequest request) {
            String path = request.getServletPath();
            // Public 엔드포인트는 필터 스킵 (SSE 스트림은 토큰 인증을 위해 필터 통과)
            return path.startsWith("/actuator") ||
                   path.startsWith("/swagger-ui") ||
                   path.startsWith("/v3/api-docs") ||
                   path.endsWith("/health") ||
                   path.contains("/health/") ||
                   // Reports 엔드포인트는 public (PDF export 등)
                   path.startsWith("/api/v1/reports/");
            // SSE 스트림 엔드포인트는 이제 필터를 통과하여 토큰 인증 가능
        }
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/config/TrustScoreConfig.java

```java
package com.newsinsight.collector.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

import java.util.HashMap;
import java.util.Map;

/**
 * Configuration for externalized trust scores.
 * 
 * Trust scores range from 0.0 to 1.0 where:
 * - 0.95+ : Very high trust (academic papers, official statistics)
 * - 0.90-0.94: High trust (encyclopedias, established fact-checkers)
 * - 0.80-0.89: Good trust (reputable news fact-check)
 * - 0.60-0.79: Moderate trust (community wikis, user-generated)
 * - 0.50 : Base trust (unknown sources)
 * - < 0.50: Low trust (unverified, suspicious)
 * 
 * Hierarchy: Academic > Official Statistics > Encyclopedia > News Fact Check
 */
@Configuration
@ConfigurationProperties(prefix = "collector.trust-scores")
@Data
public class TrustScoreConfig {

    /**
     * Trust scores for fact-check sources
     */
    private FactCheckSources factCheck = new FactCheckSources();

    /**
     * Trust scores for trusted reference sources (FactVerificationService)
     */
    private TrustedSources trusted = new TrustedSources();

    /**
     * Trust scores for collected data quality assessment
     */
    private DataQuality dataQuality = new DataQuality();

    /**
     * Additional custom source scores (can be configured dynamically)
     */
    private Map<String, Double> custom = new HashMap<>();

    @Data
    public static class FactCheckSources {
        /** CrossRef academic papers - highest trust */
        private double crossref = 0.95;
        
        /** OpenAlex academic database */
        private double openalex = 0.92;
        
        /** Wikipedia encyclopedia */
        private double wikipedia = 0.90;
        
        /** Google Fact Check verified results */
        private double googleFactCheck = 0.85;
        
        /** Realtime web search (Perplexity) - good for current prices/data */
        private double realtimeSearch = 0.80;
    }

    @Data
    public static class TrustedSources {
        /** Korean Wikipedia */
        private double wikipediaKo = 0.90;
        
        /** English Wikipedia */
        private double wikipediaEn = 0.90;
        
        /** Britannica encyclopedia - very high trust */
        private double britannica = 0.95;
        
        /** Namu Wiki (community wiki - moderate trust) */
        private double namuWiki = 0.60;
        
        /** KOSIS Korean Statistics - official government data */
        private double kosis = 0.95;
        
        /** Google Scholar - academic search */
        private double googleScholar = 0.85;
    }

    @Data
    public static class DataQuality {
        /** Base score for unknown/unverified sources */
        private double baseScore = 0.50;
        
        /** Score for sources in domain whitelist */
        private double whitelistScore = 0.90;
        
        /** Bonus for successful HTTP connection */
        private double httpOkBonus = 0.10;
    }

    /**
     * Get trust score for a source by its key.
     * Falls back to custom map, then to base score.
     */
    public double getScoreForSource(String sourceKey) {
        if (sourceKey == null) return dataQuality.baseScore;
        
        String key = sourceKey.toLowerCase().replace("-", "_").replace(" ", "_");
        
        // Check fact-check sources
        if (key.contains("crossref")) return factCheck.crossref;
        if (key.contains("openalex")) return factCheck.openalex;
        if (key.contains("wikipedia")) {
            if (key.contains("en")) return trusted.wikipediaEn;
            if (key.contains("ko")) return trusted.wikipediaKo;
            return factCheck.wikipedia;
        }
        if (key.contains("google") && key.contains("fact")) return factCheck.googleFactCheck;
        if (key.contains("realtime") || key.contains("perplexity")) return factCheck.realtimeSearch;
        
        // Check trusted sources
        if (key.contains("britannica")) return trusted.britannica;
        if (key.contains("namu")) return trusted.namuWiki;
        if (key.contains("kosis")) return trusted.kosis;
        if (key.contains("scholar")) return trusted.googleScholar;
        
        // Check custom sources
        if (custom.containsKey(key)) return custom.get(key);
        
        // Default
        return dataQuality.baseScore;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/config/WebClientConfig.java

```java
package com.newsinsight.collector.config;

import io.netty.channel.ChannelOption;
import io.netty.handler.timeout.ReadTimeoutHandler;
import io.netty.handler.timeout.WriteTimeoutHandler;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;

import java.time.Duration;
import java.util.concurrent.TimeUnit;

@Configuration
public class WebClientConfig {

    @Value("${collector.http.user-agent:NewsInsight-Collector/1.0}")
    private String userAgent;

    @Value("${collector.http.timeout.connect:10000}")
    private int connectTimeout;

    @Value("${collector.http.timeout.read:30000}")
    private int readTimeout;

    @Bean
    public WebClient webClient() {
        HttpClient httpClient = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, connectTimeout)
                .responseTimeout(Duration.ofMillis(readTimeout))
                .doOnConnected(conn -> 
                    conn.addHandlerLast(new ReadTimeoutHandler(readTimeout, TimeUnit.MILLISECONDS))
                        .addHandlerLast(new WriteTimeoutHandler(readTimeout, TimeUnit.MILLISECONDS))
                )
                .followRedirect(true);

        return WebClient.builder()
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .defaultHeader("User-Agent", userAgent)
                .build();
    }

    @Bean
    public RestTemplate restTemplate() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(connectTimeout);
        factory.setReadTimeout(readTimeout);
        return new RestTemplate(factory);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/AiOrchestrationController.java

```java
package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.AiJobDto;
import com.newsinsight.collector.dto.AiTaskCallbackRequest;
import com.newsinsight.collector.dto.DeepSearchRequest;
import com.newsinsight.collector.entity.ai.AiJobStatus;
import com.newsinsight.collector.entity.ai.AiProvider;
import com.newsinsight.collector.service.DeepOrchestrationService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Controller for AI orchestration operations.
 * Provides endpoints for:
 * - Starting orchestrated AI analysis jobs
 * - Receiving callbacks from AI workers/n8n
 * - Managing job lifecycle
 */
@RestController
@RequestMapping("/api/v1/ai")
@RequiredArgsConstructor
@Slf4j
public class AiOrchestrationController {

    private final DeepOrchestrationService orchestrationService;

    @Value("${collector.ai.orchestration.callback-token:}")
    private String expectedCallbackToken;

    /**
     * Start a new orchestrated AI analysis job.
     * 
     * @param request The analysis request containing topic and optional base URL
     * @return 202 Accepted with job details
     */
    @PostMapping("/jobs")
    public ResponseEntity<AiJobDto> startAnalysis(
            @Valid @RequestBody DeepSearchRequest request,
            @RequestParam(required = false) List<String> providers
    ) {
        log.info("Starting orchestrated AI analysis for topic: {}", request.getTopic());

        List<AiProvider> providerList = null;
        if (providers != null && !providers.isEmpty()) {
            try {
                providerList = providers.stream()
                        .map(AiProvider::valueOf)
                        .collect(Collectors.toList());
            } catch (IllegalArgumentException e) {
                return ResponseEntity.badRequest()
                        .body(AiJobDto.builder()
                                .overallStatus("ERROR")
                                .errorMessage("Invalid provider: " + e.getMessage())
                                .build());
            }
        }

        AiJobDto job = orchestrationService.startDeepAnalysis(
                request.getTopic(),
                request.getBaseUrl(),
                providerList
        );

        return ResponseEntity.status(HttpStatus.ACCEPTED).body(job);
    }

    /**
     * Get the status of an AI job.
     * 
     * @param jobId The job ID
     * @return Job status details including sub-tasks
     */
    @GetMapping("/jobs/{jobId}")
    public ResponseEntity<AiJobDto> getJobStatus(@PathVariable String jobId) {
        try {
            AiJobDto job = orchestrationService.getJobStatus(jobId);
            return ResponseEntity.ok(job);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * List all AI jobs with optional filtering.
     * 
     * @param page Page number (0-based)
     * @param size Page size
     * @param status Optional status filter
     * @return Paginated list of jobs
     */
    @GetMapping("/jobs")
    public ResponseEntity<Page<AiJobDto>> listJobs(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String status
    ) {
        AiJobStatus statusFilter = null;
        if (status != null && !status.isBlank()) {
            try {
                statusFilter = AiJobStatus.valueOf(status.toUpperCase());
            } catch (IllegalArgumentException e) {
                log.warn("Invalid status filter: {}", status);
            }
        }

        Page<AiJobDto> jobs = orchestrationService.listJobs(page, size, statusFilter);
        return ResponseEntity.ok(jobs);
    }

    /**
     * Cancel a pending or in-progress job.
     * 
     * @param jobId The job ID to cancel
     * @return Updated job status
     */
    @PostMapping("/jobs/{jobId}/cancel")
    public ResponseEntity<AiJobDto> cancelJob(@PathVariable String jobId) {
        try {
            AiJobDto job = orchestrationService.cancelJob(jobId);
            return ResponseEntity.ok(job);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * Retry failed sub-tasks for a job.
     * 
     * @param jobId The job ID
     * @return Updated job status
     */
    @PostMapping("/jobs/{jobId}/retry")
    public ResponseEntity<AiJobDto> retryJob(@PathVariable String jobId) {
        try {
            AiJobDto job = orchestrationService.retryFailedTasks(jobId);
            return ResponseEntity.ok(job);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * Callback endpoint for AI workers/n8n to deliver results.
     * 
     * @param callbackToken Token for authentication (from header)
     * @param request The callback payload
     * @return Processing result
     */
    @PostMapping("/callback")
    public ResponseEntity<?> handleCallback(
            @RequestHeader(value = "X-Callback-Token", required = false) String callbackToken,
            @RequestBody AiTaskCallbackRequest request
    ) {
        log.info("Received AI callback: jobId={}, subTaskId={}, status={}", 
                request.jobId(), request.subTaskId(), request.status());

        try {
            // Validate callback token if configured
            if (expectedCallbackToken != null && !expectedCallbackToken.isBlank()) {
                String tokenToValidate = callbackToken != null ? callbackToken : request.callbackToken();
                if (!expectedCallbackToken.equals(tokenToValidate)) {
                    log.warn("Invalid callback token for job: {}", request.jobId());
                    return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                            .body(Map.of("error", "Invalid callback token"));
                }
            }

            orchestrationService.handleCallback(request);

            return ResponseEntity.ok(Map.of(
                    "status", "received",
                    "jobId", request.jobId(),
                    "subTaskId", request.subTaskId()
            ));

        } catch (Exception e) {
            log.error("Error processing AI callback", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Failed to process callback: " + e.getMessage()));
        }
    }

    /**
     * Get available AI providers.
     */
    @GetMapping("/providers")
    public ResponseEntity<List<Map<String, String>>> getProviders() {
        List<Map<String, String>> providers = java.util.Arrays.stream(AiProvider.values())
                .map(p -> Map.of(
                        "id", p.name(),
                        "workflowPath", p.getWorkflowPath(),
                        "description", p.getDescription(),
                        "external", String.valueOf(p.isExternal())
                ))
                .collect(Collectors.toList());
        
        return ResponseEntity.ok(providers);
    }

    /**
     * Health check for AI orchestration service.
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        return ResponseEntity.ok(Map.of(
                "status", "UP",
                "service", "ai-orchestration",
                "providers", AiProvider.values().length
        ));
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/AnalysisController.java

```java
package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.AnalysisResponseDto;
import com.newsinsight.collector.dto.ArticlesResponseDto;
import com.newsinsight.collector.service.AnalysisService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class AnalysisController {

    private final AnalysisService analysisService;

    @GetMapping("/analysis")
    public ResponseEntity<AnalysisResponseDto> getAnalysis(
            @RequestParam String query,
            @RequestParam(defaultValue = "7d") String window
    ) {
        return ResponseEntity.ok(analysisService.analyze(query, window));
    }

    @GetMapping("/articles")
    public ResponseEntity<ArticlesResponseDto> getArticles(
            @RequestParam String query,
            @RequestParam(defaultValue = "50") int limit
    ) {
        return ResponseEntity.ok(analysisService.searchArticles(query, limit));
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/AutoCrawlController.java

```java
package com.newsinsight.collector.controller;

import com.newsinsight.collector.entity.autocrawl.CrawlTarget;
import com.newsinsight.collector.entity.autocrawl.CrawlTargetStatus;
import com.newsinsight.collector.entity.autocrawl.DiscoverySource;
import com.newsinsight.collector.repository.CrawlTargetRepository;
import com.newsinsight.collector.service.autocrawl.AutoCrawlDiscoveryService;
import com.newsinsight.collector.service.autocrawl.CrawlQueueService;
import com.newsinsight.collector.scheduler.AutoCrawlScheduler;
import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 자동 크롤링 관리 REST API.
 * 
 * URL 발견, 큐 관리, 상태 조회, 수동 제어 기능을 제공합니다.
 */
@RestController
@RequestMapping("/api/v1/autocrawl")
@RequiredArgsConstructor
@Slf4j
public class AutoCrawlController {

    private final AutoCrawlDiscoveryService discoveryService;
    private final CrawlQueueService queueService;
    private final CrawlTargetRepository targetRepository;
    private final AutoCrawlScheduler autoCrawlScheduler;

    // ========================================
    // 상태 조회
    // ========================================

    /**
     * 큐 상태 및 통계 조회
     */
    @GetMapping("/status")
    public ResponseEntity<AutoCrawlStatusResponse> getStatus() {
        CrawlQueueService.QueueStats stats = queueService.getQueueStats();
        Map<DiscoverySource, Long> discoveryStats = discoveryService.getDiscoveryStats();
        Map<String, Long> domainStats = queueService.getPendingCountByDomain();

        AutoCrawlStatusResponse response = AutoCrawlStatusResponse.builder()
                .pendingCount(stats.getPendingCount())
                .inProgressCount(stats.getInProgressCount())
                .completedCount(stats.getCompletedCount())
                .failedCount(stats.getFailedCount())
                .skippedCount(stats.getSkippedCount())
                .sessionDispatched(stats.getTotalDispatched())
                .sessionCompleted(stats.getTotalCompleted())
                .sessionFailed(stats.getTotalFailed())
                .discoveryStats(discoveryStats)
                .domainPendingStats(domainStats)
                .domainConcurrency(stats.getDomainConcurrency())
                .build();

        return ResponseEntity.ok(response);
    }

    /**
     * 대기 중인 대상 목록 조회 (페이지네이션)
     */
    @GetMapping("/targets")
    public ResponseEntity<Page<CrawlTargetDto>> getTargets(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) CrawlTargetStatus status,
            @RequestParam(required = false) DiscoverySource source) {

        PageRequest pageRequest = PageRequest.of(page, size, 
                Sort.by(Sort.Direction.DESC, "priority").and(Sort.by(Sort.Direction.ASC, "discoveredAt")));

        Page<CrawlTarget> targets;
        if (status != null) {
            targets = targetRepository.findByStatus(status, pageRequest);
        } else if (source != null) {
            targets = targetRepository.findByDiscoverySource(source, pageRequest);
        } else {
            targets = targetRepository.findAll(pageRequest);
        }

        Page<CrawlTargetDto> dtoPage = targets.map(this::toDto);
        return ResponseEntity.ok(dtoPage);
    }

    /**
     * 단일 대상 조회
     */
    @GetMapping("/targets/{id}")
    public ResponseEntity<CrawlTargetDto> getTarget(@PathVariable Long id) {
        return targetRepository.findById(id)
                .map(this::toDto)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    // ========================================
    // URL 발견 (수동)
    // ========================================

    /**
     * 수동으로 URL 추가
     */
    @PostMapping("/targets")
    public ResponseEntity<CrawlTargetDto> addTarget(@RequestBody AddTargetRequest request) {
        try {
            CrawlTarget target = discoveryService.addManualTarget(
                    request.getUrl(),
                    request.getKeywords(),
                    request.getPriority() != null ? request.getPriority() : 50
            );
            
            if (target == null) {
                return ResponseEntity.badRequest().build();
            }
            
            log.info("Manually added crawl target: url={}, priority={}", request.getUrl(), request.getPriority());
            return ResponseEntity.ok(toDto(target));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * 여러 URL 일괄 추가
     */
    @PostMapping("/targets/batch")
    public ResponseEntity<BatchAddResponse> addTargetsBatch(@RequestBody BatchAddRequest request) {
        List<CrawlTarget> targets = discoveryService.addManualTargets(
                request.getUrls(),
                request.getKeywords(),
                request.getPriority() != null ? request.getPriority() : 50
        );

        BatchAddResponse response = BatchAddResponse.builder()
                .addedCount(targets.size())
                .requestedCount(request.getUrls().size())
                .build();

        log.info("Batch added {} crawl targets", targets.size());
        return ResponseEntity.ok(response);
    }

    /**
     * 검색 결과 URL에서 발견
     */
    @PostMapping("/discover/search")
    public ResponseEntity<DiscoverResponse> discoverFromSearch(@RequestBody DiscoverSearchRequest request) {
        List<CrawlTarget> targets = discoveryService.discoverFromSearchUrls(
                request.getQuery(),
                request.getUrls()
        );

        DiscoverResponse response = DiscoverResponse.builder()
                .discoveredCount(targets.size())
                .source(DiscoverySource.SEARCH)
                .build();

        log.info("Discovered {} targets from search query: '{}'", targets.size(), request.getQuery());
        return ResponseEntity.ok(response);
    }

    // ========================================
    // 큐 제어
    // ========================================

    /**
     * 수동으로 큐 처리 트리거
     */
    @PostMapping("/queue/process")
    public ResponseEntity<ProcessQueueResponse> processQueue(
            @RequestParam(defaultValue = "10") int batchSize) {
        int dispatched = autoCrawlScheduler.triggerQueueProcessing(batchSize);

        ProcessQueueResponse response = ProcessQueueResponse.builder()
                .dispatchedCount(dispatched)
                .batchSize(batchSize)
                .build();

        return ResponseEntity.ok(response);
    }

    /**
     * 특정 대상 즉시 분배
     */
    @PostMapping("/targets/{id}/dispatch")
    public ResponseEntity<Void> dispatchTarget(@PathVariable Long id) {
        boolean success = queueService.dispatchSingle(id);
        if (success) {
            log.info("Manually dispatched target: id={}", id);
            return ResponseEntity.ok().build();
        } else {
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * 특정 키워드 관련 대상 우선순위 부스트
     */
    @PostMapping("/queue/boost")
    public ResponseEntity<BoostResponse> boostKeyword(@RequestBody BoostRequest request) {
        int boosted = queueService.prioritizeKeyword(
                request.getKeyword(),
                request.getBoostAmount() != null ? request.getBoostAmount() : 20
        );

        BoostResponse response = BoostResponse.builder()
                .boostedCount(boosted)
                .keyword(request.getKeyword())
                .build();

        return ResponseEntity.ok(response);
    }

    /**
     * 대상 상태 변경
     */
    @PutMapping("/targets/{id}/status")
    public ResponseEntity<Void> updateTargetStatus(
            @PathVariable Long id,
            @RequestBody UpdateStatusRequest request) {
        boolean success = queueService.updateTargetStatus(id, request.getStatus(), request.getReason());
        if (success) {
            log.info("Updated target status: id={}, newStatus={}", id, request.getStatus());
            return ResponseEntity.ok().build();
        } else {
            return ResponseEntity.notFound().build();
        }
    }

    // ========================================
    // 정리 작업
    // ========================================

    /**
     * 수동으로 정리 트리거
     */
    @PostMapping("/cleanup")
    public ResponseEntity<CleanupResponse> triggerCleanup(
            @RequestParam(defaultValue = "7") int daysOld) {
        int cleaned = queueService.cleanupOldTargets(daysOld);
        int expired = queueService.expireOldPendingTargets(daysOld);

        CleanupResponse response = CleanupResponse.builder()
                .cleanedCount(cleaned)
                .expiredCount(expired)
                .daysOld(daysOld)
                .build();

        log.info("Manual cleanup completed: cleaned={}, expired={}", cleaned, expired);
        return ResponseEntity.ok(response);
    }

    /**
     * 멈춘 작업 복구
     */
    @PostMapping("/queue/recover")
    public ResponseEntity<RecoverResponse> recoverStuck() {
        int recovered = queueService.recoverStuckTargets();

        RecoverResponse response = RecoverResponse.builder()
                .recoveredCount(recovered)
                .build();

        return ResponseEntity.ok(response);
    }

    // ========================================
    // 크롤러 콜백 (autonomous-crawler-service에서 호출)
    // ========================================

    /**
     * 크롤링 완료 콜백
     */
    @PostMapping("/callback")
    public ResponseEntity<Void> handleCrawlerCallback(@RequestBody CrawlerCallbackRequest request) {
        log.debug("Received crawler callback: targetId={}, success={}", 
                request.getTargetId(), request.isSuccess());

        if (request.isSuccess()) {
            queueService.handleCrawlComplete(request.getUrlHash(), request.getCollectedDataId());
        } else {
            queueService.handleCrawlFailed(request.getUrlHash(), request.getError());
        }

        return ResponseEntity.ok().build();
    }

    // ========================================
    // DTO 변환
    // ========================================

    private CrawlTargetDto toDto(CrawlTarget target) {
        return CrawlTargetDto.builder()
                .id(target.getId())
                .url(target.getUrl())
                .urlHash(target.getUrlHash().substring(0, 8) + "...") // 축약
                .discoverySource(target.getDiscoverySource())
                .discoveryContext(target.getDiscoveryContext())
                .priority(target.getPriority())
                .status(target.getStatus())
                .domain(target.getDomain())
                .expectedContentType(target.getExpectedContentType())
                .relatedKeywords(target.getRelatedKeywords())
                .retryCount(target.getRetryCount())
                .maxRetries(target.getMaxRetries())
                .lastError(target.getLastError())
                .discoveredAt(target.getDiscoveredAt() != null ? target.getDiscoveredAt().toString() : null)
                .lastAttemptAt(target.getLastAttemptAt() != null ? target.getLastAttemptAt().toString() : null)
                .completedAt(target.getCompletedAt() != null ? target.getCompletedAt().toString() : null)
                .collectedDataId(target.getCollectedDataId())
                .build();
    }

    // ========================================
    // Request/Response DTOs
    // ========================================

    @Data
    @Builder
    public static class AutoCrawlStatusResponse {
        private long pendingCount;
        private long inProgressCount;
        private long completedCount;
        private long failedCount;
        private long skippedCount;
        private int sessionDispatched;
        private int sessionCompleted;
        private int sessionFailed;
        private Map<DiscoverySource, Long> discoveryStats;
        private Map<String, Long> domainPendingStats;
        private Map<String, Integer> domainConcurrency;
    }

    @Data
    @Builder
    public static class CrawlTargetDto {
        private Long id;
        private String url;
        private String urlHash;
        private DiscoverySource discoverySource;
        private String discoveryContext;
        private Integer priority;
        private CrawlTargetStatus status;
        private String domain;
        private com.newsinsight.collector.entity.autocrawl.ContentType expectedContentType;
        private String relatedKeywords;
        private Integer retryCount;
        private Integer maxRetries;
        private String lastError;
        private String discoveredAt;
        private String lastAttemptAt;
        private String completedAt;
        private Long collectedDataId;
    }

    @Data
    public static class AddTargetRequest {
        private String url;
        private String keywords;
        private Integer priority;
    }

    @Data
    public static class BatchAddRequest {
        private List<String> urls;
        private String keywords;
        private Integer priority;
    }

    @Data
    @Builder
    public static class BatchAddResponse {
        private int addedCount;
        private int requestedCount;
    }

    @Data
    public static class DiscoverSearchRequest {
        private String query;
        private List<String> urls;
    }

    @Data
    @Builder
    public static class DiscoverResponse {
        private int discoveredCount;
        private DiscoverySource source;
    }

    @Data
    @Builder
    public static class ProcessQueueResponse {
        private int dispatchedCount;
        private int batchSize;
    }

    @Data
    public static class BoostRequest {
        private String keyword;
        private Integer boostAmount;
    }

    @Data
    @Builder
    public static class BoostResponse {
        private int boostedCount;
        private String keyword;
    }

    @Data
    public static class UpdateStatusRequest {
        private CrawlTargetStatus status;
        private String reason;
    }

    @Data
    @Builder
    public static class CleanupResponse {
        private int cleanedCount;
        private int expiredCount;
        private int daysOld;
    }

    @Data
    @Builder
    public static class RecoverResponse {
        private int recoveredCount;
    }

    @Data
    public static class CrawlerCallbackRequest {
        private Long targetId;
        private String urlHash;
        private boolean success;
        private Long collectedDataId;
        private String error;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/ChatHealthController.java

```java
package com.newsinsight.collector.controller;

import com.newsinsight.collector.service.ChatSyncService;
import com.newsinsight.collector.service.VectorEmbeddingService;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

/**
 * 채팅 서비스 헬스 체크 컨트롤러
 * 
 * 채팅 서비스의 상태와 의존 서비스들의 상태를 확인합니다.
 */
@RestController
@RequestMapping("/api/v1/factcheck-chat/health")
@RequiredArgsConstructor
@Slf4j
public class ChatHealthController {

    private final MongoTemplate mongoTemplate;
    private final RedisConnectionFactory redisConnectionFactory;
    private final VectorEmbeddingService vectorEmbeddingService;
    private final ChatSyncService chatSyncService;
    private final MeterRegistry meterRegistry;

    /**
     * 종합 헬스 체크
     */
    @GetMapping
    public ResponseEntity<HealthResponse> getHealth() {
        HealthResponse response = HealthResponse.builder()
                .status("UP")
                .timestamp(LocalDateTime.now())
                .mongodb(checkMongoHealth())
                .redis(checkRedisHealth())
                .vectorDb(checkVectorDbHealth())
                .sync(getSyncStatus())
                .build();

        // 전체 상태 결정
        if (!response.getMongodb().isHealthy() || !response.getRedis().isHealthy()) {
            response.setStatus("DOWN");
        } else if (!response.getVectorDb().isHealthy()) {
            response.setStatus("DEGRADED");
        }

        return ResponseEntity.ok(response);
    }

    /**
     * MongoDB 상태 확인
     */
    @GetMapping("/mongodb")
    public ResponseEntity<ComponentHealth> getMongoHealth() {
        return ResponseEntity.ok(checkMongoHealth());
    }

    /**
     * Redis 상태 확인
     */
    @GetMapping("/redis")
    public ResponseEntity<ComponentHealth> getRedisHealth() {
        return ResponseEntity.ok(checkRedisHealth());
    }

    /**
     * 벡터 DB 상태 확인
     */
    @GetMapping("/vector")
    public ResponseEntity<ComponentHealth> getVectorHealth() {
        return ResponseEntity.ok(checkVectorDbHealth());
    }

    /**
     * 동기화 상태 확인
     */
    @GetMapping("/sync")
    public ResponseEntity<SyncHealthStatus> getSyncHealth() {
        return ResponseEntity.ok(getSyncStatus());
    }

    /**
     * 메트릭 요약
     */
    @GetMapping("/metrics")
    public ResponseEntity<Map<String, Object>> getMetrics() {
        Map<String, Object> metrics = new HashMap<>();
        
        // 세션 메트릭
        metrics.put("sessions", Map.of(
                "created", getCounterValue("factcheck.chat.sessions.created"),
                "closed", getCounterValue("factcheck.chat.sessions.closed"),
                "active", getGaugeValue("factcheck.chat.sessions.active")
        ));
        
        // 메시지 메트릭
        metrics.put("messages", Map.of(
                "processed", getCounterValue("factcheck.chat.messages.processed")
        ));
        
        // 팩트체크 메트릭
        metrics.put("factcheck", Map.of(
                "success", getCounterValue("factcheck.chat.factcheck.success"),
                "error", getCounterValue("factcheck.chat.factcheck.error")
        ));
        
        // 동기화 메트릭
        metrics.put("sync", Map.of(
                "rdb_success", getCounterValue("chat.sync.rdb.success"),
                "rdb_error", getCounterValue("chat.sync.rdb.error"),
                "embedding_success", getCounterValue("chat.sync.embedding.success"),
                "embedding_error", getCounterValue("chat.sync.embedding.error"),
                "pending_sync", getGaugeValue("chat.sync.rdb.pending"),
                "pending_embedding", getGaugeValue("chat.sync.embedding.pending")
        ));
        
        // 캐시 에러 메트릭
        metrics.put("cache_errors", Map.of(
                "total", getCounterValue("cache.error")
        ));
        
        return ResponseEntity.ok(metrics);
    }

    private ComponentHealth checkMongoHealth() {
        try {
            mongoTemplate.executeCommand("{ ping: 1 }");
            return ComponentHealth.builder()
                    .name("MongoDB")
                    .healthy(true)
                    .message("Connected")
                    .build();
        } catch (Exception e) {
            log.error("MongoDB health check failed: {}", e.getMessage());
            return ComponentHealth.builder()
                    .name("MongoDB")
                    .healthy(false)
                    .message("Connection failed: " + e.getMessage())
                    .build();
        }
    }

    private ComponentHealth checkRedisHealth() {
        try {
            redisConnectionFactory.getConnection().ping();
            return ComponentHealth.builder()
                    .name("Redis")
                    .healthy(true)
                    .message("Connected")
                    .build();
        } catch (Exception e) {
            log.error("Redis health check failed: {}", e.getMessage());
            return ComponentHealth.builder()
                    .name("Redis")
                    .healthy(false)
                    .message("Connection failed: " + e.getMessage())
                    .build();
        }
    }

    private ComponentHealth checkVectorDbHealth() {
        VectorEmbeddingService.VectorServiceStatus status = vectorEmbeddingService.getStatus();
        
        if (!status.isEnabled()) {
            return ComponentHealth.builder()
                    .name("VectorDB")
                    .healthy(true) // disabled는 에러가 아님
                    .message("Disabled")
                    .build();
        }
        
        return ComponentHealth.builder()
                .name("VectorDB")
                .healthy(status.isVectorDbHealthy())
                .message(status.isVectorDbHealthy() ? "Connected" : "Connection failed")
                .details(Map.of(
                        "url", status.getVectorDbUrl(),
                        "collection", status.getCollectionName(),
                        "embeddingServiceHealthy", status.isEmbeddingServiceHealthy(),
                        "queueSize", status.getQueueSize()
                ))
                .build();
    }

    private SyncHealthStatus getSyncStatus() {
        ChatSyncService.SyncStats stats = chatSyncService.getSyncStats();
        
        return SyncHealthStatus.builder()
                .healthy(stats.getActiveSyncCount() < 10) // 동시 동기화 10개 미만이면 정상
                .pendingSyncCount(stats.getPendingSyncCount())
                .pendingEmbeddingCount(stats.getPendingEmbeddingCount())
                .activeSyncCount(stats.getActiveSyncCount())
                .build();
    }

    private double getCounterValue(String name) {
        try {
            var counter = meterRegistry.find(name).counter();
            return counter != null ? counter.count() : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    private double getGaugeValue(String name) {
        try {
            var gauge = meterRegistry.find(name).gauge();
            return gauge != null ? gauge.value() : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    @Data
    @Builder
    public static class HealthResponse {
        private String status;
        private LocalDateTime timestamp;
        private ComponentHealth mongodb;
        private ComponentHealth redis;
        private ComponentHealth vectorDb;
        private SyncHealthStatus sync;
    }

    @Data
    @Builder
    public static class ComponentHealth {
        private String name;
        private boolean healthy;
        private String message;
        private Map<String, Object> details;
    }

    @Data
    @Builder
    public static class SyncHealthStatus {
        private boolean healthy;
        private long pendingSyncCount;
        private long pendingEmbeddingCount;
        private int activeSyncCount;
    }
}

/**
 * Spring Boot Actuator Health Indicator
 */
@Component
@RequiredArgsConstructor
@Slf4j
class ChatServiceHealthIndicator implements HealthIndicator {

    private final MongoTemplate mongoTemplate;
    private final RedisConnectionFactory redisConnectionFactory;
    private final VectorEmbeddingService vectorEmbeddingService;

    @Override
    public Health health() {
        Health.Builder builder = Health.up();
        
        // MongoDB 체크
        try {
            mongoTemplate.executeCommand("{ ping: 1 }");
            builder.withDetail("mongodb", "UP");
        } catch (Exception e) {
            builder.down().withDetail("mongodb", "DOWN: " + e.getMessage());
            return builder.build();
        }
        
        // Redis 체크
        try {
            redisConnectionFactory.getConnection().ping();
            builder.withDetail("redis", "UP");
        } catch (Exception e) {
            builder.down().withDetail("redis", "DOWN: " + e.getMessage());
            return builder.build();
        }
        
        // Vector DB 체크 (optional)
        VectorEmbeddingService.VectorServiceStatus vectorStatus = vectorEmbeddingService.getStatus();
        if (vectorStatus.isEnabled()) {
            if (vectorStatus.isVectorDbHealthy()) {
                builder.withDetail("vectorDb", "UP");
            } else {
                builder.withDetail("vectorDb", "DOWN");
                // Vector DB는 optional이므로 degraded 상태로
            }
        } else {
            builder.withDetail("vectorDb", "DISABLED");
        }
        
        return builder.build();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/ClaimExtractionController.java

```java
package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.ClaimExtractionRequest;
import com.newsinsight.collector.dto.ClaimExtractionResponse;
import com.newsinsight.collector.service.ClaimExtractionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;

import java.util.Map;

/**
 * Controller for claim extraction operations.
 * Extracts verifiable claims from URLs for fact-checking.
 */
@RestController
@RequestMapping("/api/v1/analysis")
@RequiredArgsConstructor
@Slf4j
public class ClaimExtractionController {

    private final ClaimExtractionService claimExtractionService;

    /**
     * Extract verifiable claims from a URL.
     * 
     * This endpoint:
     * 1. Crawls the given URL to extract page content
     * 2. Analyzes the content using AI to identify verifiable claims
     * 3. Returns structured claims with confidence scores
     * 
     * @param request The extraction request containing the URL
     * @return List of extracted claims with metadata
     */
    @PostMapping("/extract-claims")
    public Mono<ResponseEntity<ClaimExtractionResponse>> extractClaims(
            @Valid @RequestBody ClaimExtractionRequest request
    ) {
        log.info("Received claim extraction request for URL: {}", request.getUrl());

        return claimExtractionService.extractClaims(request)
                .map(response -> {
                    if (response == null) {
                        return ResponseEntity.internalServerError()
                                .body(ClaimExtractionResponse.builder()
                                        .url(request.getUrl())
                                        .message("추출 서비스 오류가 발생했습니다.")
                                        .build());
                    }

                    log.info("Extracted {} claims from URL: {}",
                            response.getClaims() != null ? response.getClaims().size() : 0,
                            request.getUrl());

                    return ResponseEntity.ok(response);
                })
                .onErrorResume(e -> {
                    log.error("Claim extraction failed for URL: {}", request.getUrl(), e);
                    return Mono.just(ResponseEntity.internalServerError()
                            .body(ClaimExtractionResponse.builder()
                                    .url(request.getUrl())
                                    .message("주장 추출 실패: " + e.getMessage())
                                    .build()));
                });
    }

    /**
     * Health check for claim extraction service.
     */
    @GetMapping("/extract-claims/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        return ResponseEntity.ok(Map.of(
                "service", "ClaimExtractionService",
                "status", "READY"
        ));
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/CollectionController.java

```java
package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.CollectionJobDTO;
import com.newsinsight.collector.dto.CollectionRequest;
import com.newsinsight.collector.dto.CollectionResponse;
import com.newsinsight.collector.dto.CollectionStatsDTO;
import com.newsinsight.collector.dto.PageResponse;
import com.newsinsight.collector.entity.CollectionJob;
import com.newsinsight.collector.entity.CollectionJob.JobStatus;
import com.newsinsight.collector.mapper.EntityMapper;
import com.newsinsight.collector.service.CollectionService;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;

@RestController
@RequestMapping("/api/v1/collections")
public class CollectionController {

    private final CollectionService collectionService;
    private final EntityMapper entityMapper;

    public CollectionController(CollectionService collectionService, EntityMapper entityMapper) {
        this.collectionService = collectionService;
        this.entityMapper = entityMapper;
    }

    /**
     * POST /api/v1/collections/start - 수집 작업 시작 (전체 또는 특정 소스)
     */
    @PostMapping("/start")
    public ResponseEntity<CollectionResponse> startCollection(
            @Valid @RequestBody CollectionRequest request) {

        List<CollectionJob> jobs;

        if (request.sourceIds().isEmpty()) {
            // 활성화된 모든 소스 대상으로 수집
            jobs = collectionService.startCollectionForAllActive();
        } else {
            // 지정된 소스들만 수집
            jobs = collectionService.startCollectionForSources(request.sourceIds());
        }

        List<CollectionJobDTO> jobDTOs = jobs.stream()
                .map(entityMapper::toCollectionJobDTO)
                .toList();

        CollectionResponse response = new CollectionResponse(
                "Collection started for " + jobs.size() + " source(s)",
                jobDTOs,
                jobs.size(),
                LocalDateTime.now()
        );

        return ResponseEntity.status(HttpStatus.ACCEPTED).body(response);
    }

    /**
     * GET /api/v1/collections/jobs - 수집 작업 목록 조회 (상태별 필터링)
     */
    @GetMapping("/jobs")
    public ResponseEntity<PageResponse<CollectionJobDTO>> listJobs(
            Pageable pageable,
            @RequestParam(required = false) JobStatus status) {

        Page<CollectionJob> jobs = (status != null)
                ? collectionService.getJobsByStatus(status, pageable)
                : collectionService.getAllJobs(pageable);

        Page<CollectionJobDTO> jobDTOs = jobs.map(entityMapper::toCollectionJobDTO);

        return ResponseEntity.ok(PageResponse.from(jobDTOs));
    }

    /**
     * GET /api/v1/collections/jobs/{id} - 특정 작업 상세 조회
     */
    @GetMapping("/jobs/{id}")
    public ResponseEntity<CollectionJobDTO> getJob(@PathVariable Long id) {
        return collectionService.getJobById(id)
                .map(entityMapper::toCollectionJobDTO)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * POST /api/v1/collections/jobs/{id}/cancel - 수집 작업 취소
     */
    @PostMapping("/jobs/{id}/cancel")
    public ResponseEntity<Void> cancelJob(@PathVariable Long id) {
        boolean cancelled = collectionService.cancelJob(id);
        return cancelled ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }

    /**
     * GET /api/v1/collections/stats - 수집 통계 조회
     */
    @GetMapping("/stats")
    public ResponseEntity<CollectionStatsDTO> getStats() {
        CollectionStatsDTO stats = collectionService.getStatistics();
        return ResponseEntity.ok(stats);
    }

    /**
     * DELETE /api/v1/collections/jobs/cleanup - 오래된 작업 정리
     */
    @DeleteMapping("/jobs/cleanup")
    public ResponseEntity<String> cleanupOldJobs(
            @RequestParam(defaultValue = "30") int daysOld) {
        
        int cleaned = collectionService.cleanupOldJobs(daysOld);
        return ResponseEntity.ok("Cleaned up " + cleaned + " old jobs");
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/DashboardEventController.java

```java
package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.DashboardEventDto;
import com.newsinsight.collector.service.DashboardEventService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;

import java.time.Duration;

/**
 * 대시보드 실시간 이벤트 스트리밍 컨트롤러.
 * SSE(Server-Sent Events)를 통해 클라이언트에 실시간 업데이트를 푸시합니다.
 */
@RestController
@RequestMapping("/api/v1/events")
@RequiredArgsConstructor
@Slf4j
public class DashboardEventController {

    private final DashboardEventService dashboardEventService;

    /**
     * 대시보드 이벤트 스트림.
     * 클라이언트는 이 엔드포인트에 연결하여 실시간 이벤트를 수신합니다.
     * 
     * 이벤트 타입:
     * - HEARTBEAT: 연결 유지용 (30초마다)
     * - NEW_DATA: 새로운 데이터 수집됨
     * - SOURCE_UPDATED: 소스 상태 변경
     * - STATS_UPDATED: 통계 갱신
     * 
     * @return SSE 스트림
     */
    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<DashboardEventDto>> streamEvents() {
        log.info("New SSE client connected to dashboard event stream");

        // 연결 확인 이벤트 (즉시 전송)
        Flux<ServerSentEvent<DashboardEventDto>> connected = Flux.just(
                ServerSentEvent.<DashboardEventDto>builder()
                        .event("connected")
                        .data(DashboardEventDto.heartbeat())
                        .build()
        );

        // 하트비트 스트림 (즉시 시작, 30초마다)
        Flux<ServerSentEvent<DashboardEventDto>> heartbeat = Flux.interval(Duration.ZERO, Duration.ofSeconds(30))
                .skip(1) // 첫 번째는 connected 이벤트로 대체
                .map(tick -> ServerSentEvent.<DashboardEventDto>builder()
                        .event("heartbeat")
                        .data(DashboardEventDto.heartbeat())
                        .build());

        // 이벤트 스트림
        Flux<ServerSentEvent<DashboardEventDto>> events = dashboardEventService.getEventStream()
                .map(event -> ServerSentEvent.<DashboardEventDto>builder()
                        .event(event.getEventType().name().toLowerCase())
                        .data(event)
                        .build());

        // 세 스트림 병합 (connected 먼저, 그 다음 heartbeat + events)
        return Flux.concat(connected, Flux.merge(heartbeat, events))
                .doOnCancel(() -> log.info("SSE client disconnected from dashboard event stream"))
                .doOnError(e -> log.error("SSE stream error", e));
    }

    /**
     * 데이터 통계 스트림.
     * 5초마다 최신 통계를 전송합니다.
     * 
     * @return SSE 스트림
     */
    @GetMapping(value = "/stats/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<DashboardEventDto>> streamStats() {
        log.debug("New SSE client connected to stats stream");

        return Flux.interval(Duration.ZERO, Duration.ofSeconds(5))
                .flatMap(tick -> dashboardEventService.getCurrentStats())
                .map(stats -> ServerSentEvent.<DashboardEventDto>builder()
                        .event("stats")
                        .data(stats)
                        .build())
                .doOnCancel(() -> log.debug("SSE client disconnected from stats stream"));
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/DataController.java

```java
package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.CollectedDataDTO;
import com.newsinsight.collector.entity.CollectedData;
import com.newsinsight.collector.mapper.EntityMapper;
import com.newsinsight.collector.service.CollectedDataService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/data")
@RequiredArgsConstructor
public class DataController {

    private final CollectedDataService collectedDataService;
    private final EntityMapper entityMapper;

    /**
     * GET /api/v1/data - 수집된 데이터 목록 조회 (소스/처리상태/검색 필터링 지원)
     */
    @GetMapping
    public ResponseEntity<Page<CollectedDataDTO>> listData(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) Long sourceId,
            @RequestParam(required = false) Boolean processed,
            @RequestParam(required = false) String query) {
        
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "collectedAt"));
        
        Page<CollectedData> data;
        
        // 검색어가 있는 경우
        if (query != null && !query.isBlank()) {
            data = collectedDataService.searchWithFilter(query, processed, pageable);
        } else if (sourceId != null && processed != null) {
            // 소스 + 처리상태 동시 필터링은 별도의 커스텀 쿼리 필요 (현재는 소스 기준 필터만 수행)
            data = collectedDataService.findBySourceId(sourceId, pageable);
        } else if (sourceId != null) {
            data = collectedDataService.findBySourceId(sourceId, pageable);
        } else if (Boolean.FALSE.equals(processed)) {
            data = collectedDataService.findUnprocessed(pageable);
        } else {
            data = collectedDataService.findAll(pageable);
        }
        
        Page<CollectedDataDTO> dataDTOs = data.map(entityMapper::toCollectedDataDTO);
        
        return ResponseEntity.ok(dataDTOs);
    }

    /**
     * GET /api/v1/data/unprocessed - 미처리 데이터 목록 조회
     */
    @GetMapping("/unprocessed")
    public ResponseEntity<Page<CollectedDataDTO>> listUnprocessedData(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "collectedAt"));
        Page<CollectedData> data = collectedDataService.findUnprocessed(pageable);
        Page<CollectedDataDTO> dataDTOs = data.map(entityMapper::toCollectedDataDTO);
        
        return ResponseEntity.ok(dataDTOs);
    }

    /**
     * GET /api/v1/data/{id} - 수집된 데이터 단건 조회 (ID)
     */
    @GetMapping("/{id}")
    public ResponseEntity<CollectedDataDTO> getData(@PathVariable Long id) {
        return collectedDataService.findById(id)
                .map(entityMapper::toCollectedDataDTO)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * POST /api/v1/data/{id}/processed - 데이터 처리 완료 마킹
     */
    @PostMapping("/{id}/processed")
    public ResponseEntity<Void> markAsProcessed(@PathVariable Long id) {
        boolean marked = collectedDataService.markAsProcessed(id);
        return marked ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }

    /**
     * GET /api/v1/data/stats - 데이터 통계 조회 (전체/미처리/처리완료)
     */
    @GetMapping("/stats")
    public ResponseEntity<DataStatsResponse> getDataStats() {
        long total = collectedDataService.countTotal();
        long unprocessed = collectedDataService.countUnprocessed();
        
        DataStatsResponse stats = new DataStatsResponse(total, unprocessed, total - unprocessed);
        return ResponseEntity.ok(stats);
    }

    /**
     * 간단한 통계 응답 구조체
     */
    public record DataStatsResponse(long total, long unprocessed, long processed) {}
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/DeepAnalysisController.java

```java
package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.*;
import com.newsinsight.collector.entity.CrawlJobStatus;
import com.newsinsight.collector.service.DeepAnalysisService;
import com.newsinsight.collector.service.DeepSearchEventService;
import com.newsinsight.collector.service.IntegratedCrawlerService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Flux;

import java.util.List;
import java.util.Map;

/**
 * Controller for deep AI search operations.
 * Provides endpoints for:
 * - Starting a new deep search
 * - Receiving callbacks from internal workers
 * - Retrieving search results
 * - Real-time SSE streaming of search progress
 * 
 * Uses IntegratedCrawlerService for multi-strategy crawling:
 * - Crawl4AI for JS-rendered pages
 * - Browser-Use API for complex interactions
 * - Direct HTTP for simple pages
 * - Search Engines for topic-based searches
 */
@RestController
@RequestMapping("/api/v1/analysis/deep")
@RequiredArgsConstructor
@Slf4j
public class DeepAnalysisController {

    private final DeepAnalysisService deepAnalysisService;
    private final DeepSearchEventService deepSearchEventService;
    private final IntegratedCrawlerService integratedCrawlerService;

    /**
     * Start a new deep AI search job.
     * 
     * @param request The search request containing topic and optional base URL
     * @return 202 Accepted with job details
     */
    @PostMapping
    public ResponseEntity<DeepSearchJobDto> startDeepSearch(
            @Valid @RequestBody DeepSearchRequest request
    ) {
        log.info("Starting deep search for topic: {}", request.getTopic());
        
        if (!integratedCrawlerService.isAvailable()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(DeepSearchJobDto.builder()
                            .status("UNAVAILABLE")
                            .errorMessage("Deep search service is not available. Please check crawler configuration.")
                            .build());
        }

        DeepSearchJobDto job = deepAnalysisService.startDeepSearch(
                request.getTopic(),
                request.getBaseUrl()
        );

        return ResponseEntity.status(HttpStatus.ACCEPTED).body(job);
    }

    /**
     * Get the status of a deep search job.
     * 
     * @param jobId The job ID
     * @return Job status details
     */
    @GetMapping("/{jobId}")
    public ResponseEntity<DeepSearchJobDto> getJobStatus(@PathVariable String jobId) {
        try {
            DeepSearchJobDto job = deepAnalysisService.getJobStatus(jobId);
            return ResponseEntity.ok(job);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * Get the full results of a completed deep search.
     * 
     * @param jobId The job ID
     * @return Full search results including evidence
     */
    @GetMapping("/{jobId}/result")
    public ResponseEntity<DeepSearchResultDto> getSearchResult(@PathVariable String jobId) {
        try {
            DeepSearchResultDto result = deepAnalysisService.getSearchResult(jobId);
            return ResponseEntity.ok(result);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * SSE stream for real-time job updates.
     * Clients can subscribe to this endpoint to receive live updates for a job.
     * 
     * Events:
     * - status: Job status changes (PENDING, IN_PROGRESS, COMPLETED, FAILED)
     * - progress: Progress updates (0-100%)
     * - evidence: New evidence found during the search
     * - complete: Job completed successfully
     * - error: Job failed with error
     * - heartbeat: Keep-alive ping every 15 seconds
     * 
     * @param jobId The job ID to subscribe to
     * @return SSE event stream
     */
    @GetMapping(value = "/{jobId}/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<Object>> streamJobUpdates(@PathVariable String jobId) {
        log.info("New SSE client subscribed to job: {}", jobId);
        
        // Validate job exists
        try {
            DeepSearchJobDto job = deepAnalysisService.getJobStatus(jobId);
            
            // If job is already completed or failed, send immediate result and close
            if ("COMPLETED".equals(job.getStatus()) || "FAILED".equals(job.getStatus()) 
                    || "CANCELLED".equals(job.getStatus()) || "TIMEOUT".equals(job.getStatus())) {
                log.info("Job {} already finished with status: {}, sending immediate result", jobId, job.getStatus());
                return Flux.just(ServerSentEvent.builder()
                        .event("complete")
                        .data(Map.of(
                                "jobId", jobId,
                                "job", job,
                                "timestamp", System.currentTimeMillis()
                        ))
                        .build());
            }
        } catch (IllegalArgumentException e) {
            log.warn("SSE subscription for unknown job: {}", jobId);
            return Flux.just(ServerSentEvent.builder()
                    .event("error")
                    .data(Map.of(
                            "jobId", jobId,
                            "error", "Job not found: " + jobId,
                            "timestamp", System.currentTimeMillis()
                    ))
                    .build());
        }

        return deepSearchEventService.getJobEventStream(jobId);
    }

    /**
     * List all deep search jobs with optional filtering.
     * 
     * @param page Page number (0-based)
     * @param size Page size
     * @param status Optional status filter
     * @return Paginated list of jobs
     */
    @GetMapping
    public ResponseEntity<Page<DeepSearchJobDto>> listJobs(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String status
    ) {
        CrawlJobStatus statusFilter = null;
        if (status != null && !status.isBlank()) {
            try {
                statusFilter = CrawlJobStatus.valueOf(status.toUpperCase());
            } catch (IllegalArgumentException e) {
                log.warn("Invalid status filter: {}", status);
            }
        }

        Page<DeepSearchJobDto> jobs = deepAnalysisService.listJobs(page, size, statusFilter);
        return ResponseEntity.ok(jobs);
    }

    /**
     * Cancel a pending or in-progress job.
     * 
     * @param jobId The job ID to cancel
     * @return Updated job status
     */
    @PostMapping("/{jobId}/cancel")
    public ResponseEntity<DeepSearchJobDto> cancelJob(@PathVariable String jobId) {
        try {
            DeepSearchJobDto job = deepAnalysisService.cancelJob(jobId);
            return ResponseEntity.ok(job);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * Callback endpoint for internal async workers to deliver results.
     * This can be used by future Kafka-based workers or other internal services.
     * 
     * @param callbackToken Token for authentication (from header)
     * @param payload The callback payload
     * @return Processing result
     */
    @PostMapping("/callback")
    public ResponseEntity<?> handleCallback(
            @RequestHeader(value = "X-Crawl-Callback-Token", required = false) String callbackToken,
            @RequestBody DeepSearchCallbackDto payload
    ) {
        log.info("Received internal callback for job: {}, status: {}", payload.getJobId(), payload.getStatus());

        try {
            // Convert DTO evidence to service format
            List<EvidenceDto> evidenceList = payload.getEvidence() != null 
                    ? payload.getEvidence().stream()
                            .map(e -> EvidenceDto.builder()
                                    .url(e.getUrl())
                                    .title(e.getTitle())
                                    .stance(e.getStance())
                                    .snippet(e.getSnippet())
                                    .source(e.getSource())
                                    .build())
                            .toList()
                    : List.of();

            DeepSearchResultDto result = deepAnalysisService.processInternalCallback(
                    callbackToken, 
                    payload.getJobId(),
                    payload.getStatus(),
                    evidenceList
            );
            
            return ResponseEntity.ok(Map.of(
                    "status", "received",
                    "jobId", result.getJobId(),
                    "evidenceCount", result.getEvidenceCount()
            ));

        } catch (SecurityException e) {
            log.warn("Callback authentication failed: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Invalid callback token"));

        } catch (IllegalArgumentException e) {
            log.warn("Callback for unknown job: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", e.getMessage()));

        } catch (Exception e) {
            log.error("Error processing callback", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Failed to process callback: " + e.getMessage()));
        }
    }

    /**
     * Health check for deep search service.
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        boolean isAvailable = integratedCrawlerService.isAvailable();
        return ResponseEntity.ok(Map.of(
                "available", isAvailable,
                "service", "IntegratedCrawlerService",
                "status", isAvailable ? "READY" : "UNAVAILABLE"
        ));
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/FactCheckChatController.java

```java
package com.newsinsight.collector.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.service.FactCheckChatService;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Flux;

import java.time.Duration;
import java.util.List;
import java.util.UUID;

/**
 * 팩트체크 챗봇 컨트롤러
 * 
 * 사용자와 대화하며 실시간으로 팩트체크 결과를 제공합니다.
 * SSE를 통해 스트리밍 방식으로 응답을 전송합니다.
 * 
 * NOTE: CORS is handled by API Gateway - do not add @CrossOrigin here
 */
@RestController
@RequestMapping("/api/v1/factcheck-chat")
@RequiredArgsConstructor
@Slf4j
public class FactCheckChatController {

    private final FactCheckChatService factCheckChatService;
    private final ObjectMapper objectMapper;

    /**
     * 팩트체크 챗봇 세션 시작
     * 
     * @param request 초기 메시지 요청
     * @return 세션 ID
     */
    @PostMapping("/session")
    public SessionResponse createSession(@RequestBody ChatRequest request) {
        String sessionId = UUID.randomUUID().toString();
        log.info("Created fact-check chat session: {}", sessionId);
        
        return SessionResponse.builder()
                .sessionId(sessionId)
                .message("팩트체크 챗봇 세션이 시작되었습니다.")
                .build();
    }

    /**
     * 팩트체크 챗봇 메시지 전송 및 SSE 스트리밍 응답
     * 
     * @param sessionId 세션 ID
     * @param request 사용자 메시지
     * @return SSE 이벤트 스트림
     */
    @PostMapping(value = "/session/{sessionId}/message", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> sendMessage(
            @PathVariable String sessionId,
            @RequestBody ChatRequest request
    ) {
        log.info("Received message for session {}: {}", sessionId, request.getMessage());

        return factCheckChatService.processMessage(sessionId, request.getMessage(), request.getClaims())
                .map(event -> {
                    try {
                        String data = objectMapper.writeValueAsString(event);
                        return ServerSentEvent.<String>builder()
                                .id(UUID.randomUUID().toString())
                                .event(event.getType())
                                .data(data)
                                .build();
                    } catch (Exception e) {
                        log.error("Failed to serialize chat event: {}", e.getMessage());
                        return ServerSentEvent.<String>builder()
                                .event("error")
                                .data("{\"error\": \"Serialization failed\"}")
                                .build();
                    }
                })
                .concatWith(Flux.just(
                        ServerSentEvent.<String>builder()
                                .event("done")
                                .data("{\"message\": \"Response completed\"}")
                                .build()
                ))
                .timeout(Duration.ofMinutes(3))
                .onErrorResume(e -> {
                    log.error("Error in chat stream for session {}: {}", sessionId, e.getMessage());
                    return Flux.just(
                            ServerSentEvent.<String>builder()
                                    .event("error")
                                    .data("{\"error\": \"" + e.getMessage() + "\"}")
                                    .build()
                    );
                });
    }

    /**
     * 세션 종료
     * 
     * @param sessionId 세션 ID
     */
    @DeleteMapping("/session/{sessionId}")
    public void closeSession(@PathVariable String sessionId) {
        log.info("Closing fact-check chat session: {}", sessionId);
        factCheckChatService.closeSession(sessionId);
    }

    /**
     * 세션 이력 조회
     * 
     * @param sessionId 세션 ID
     * @return 대화 이력
     */
    @GetMapping("/session/{sessionId}/history")
    public ChatHistoryResponse getHistory(@PathVariable String sessionId) {
        List<ChatMessage> history = factCheckChatService.getHistory(sessionId);
        return ChatHistoryResponse.builder()
                .sessionId(sessionId)
                .messages(history)
                .build();
    }

    // DTO Classes
    
    @Data
    public static class ChatRequest {
        private String message;
        private List<String> claims;
    }

    @Data
    @lombok.Builder
    public static class SessionResponse {
        private String sessionId;
        private String message;
    }

    @Data
    @lombok.Builder
    public static class ChatHistoryResponse {
        private String sessionId;
        private List<ChatMessage> messages;
    }

    @Data
    @lombok.Builder
    public static class ChatMessage {
        private String role; // user, assistant, system
        private String content;
        private Long timestamp;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/LiveAnalysisController.java

```java
package com.newsinsight.collector.controller;

import com.newsinsight.collector.client.AIDoveClient;
import com.newsinsight.collector.client.OpenAICompatibleClient;
import com.newsinsight.collector.client.PerplexityClient;
import com.newsinsight.collector.service.CrawlSearchService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

@RestController
@RequestMapping("/api/v1/analysis")
@RequiredArgsConstructor
@Slf4j
public class LiveAnalysisController {

    private final PerplexityClient perplexityClient;
    private final OpenAICompatibleClient openAICompatibleClient;
    private final AIDoveClient aiDoveClient;
    private final CrawlSearchService crawlSearchService;

    /**
     * Health check for live analysis service.
     * Returns whether the analysis APIs are configured and available.
     */
    @GetMapping("/live/health")
    public ResponseEntity<Map<String, Object>> liveAnalysisHealth() {
        List<String> availableProviders = getAvailableProviders();
        boolean anyEnabled = !availableProviders.isEmpty();

        String primaryProvider = availableProviders.isEmpty() ? "none" : availableProviders.get(0);
        String message = anyEnabled 
                ? "Live analysis is available (" + String.join(", ", availableProviders) + ")"
                : "Live analysis is disabled. No AI provider is configured.";

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("enabled", anyEnabled);
        response.put("primaryProvider", primaryProvider);
        response.put("availableProviders", availableProviders);
        response.put("providerStatus", Map.of(
                "perplexity", perplexityClient.isEnabled(),
                "openai", openAICompatibleClient.isOpenAIEnabled(),
                "openrouter", openAICompatibleClient.isOpenRouterEnabled(),
                "azure", openAICompatibleClient.isAzureEnabled(),
                "aidove", aiDoveClient.isEnabled(),
                "ollama", true, // Ollama is always potentially available
                "custom", openAICompatibleClient.isCustomEnabled(),
                "crawl", crawlSearchService.isAvailable()
        ));
        response.put("message", message);

        return ResponseEntity.ok(response);
    }

    @GetMapping(value = "/live", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<String> streamLiveAnalysis(
            @RequestParam String query,
            @RequestParam(defaultValue = "7d") String window
    ) {
        String prompt = buildPrompt(query, window);
        log.info("Starting live analysis for query='{}', window='{}'", query, window);

        // Build provider chain and try with fallback
        List<ProviderAttempt> providers = buildProviderChain(prompt, query, window);
        
        if (providers.isEmpty()) {
            log.warn("Live analysis requested but no provider is available");
            return Flux.just(
                    "실시간 분석 기능이 현재 사용할 수 없습니다.\n\n" +
                    "설정된 AI 제공자가 없습니다.\n" +
                    "관리자에게 문의하세요.\n\n" +
                    "대안: Deep AI Search 또는 Browser AI Agent를 사용해 보세요."
            );
        }

        log.info("Live analysis using fallback chain: {}", 
                providers.stream().map(ProviderAttempt::name).toList());

        return tryProvidersInSequence(providers, 0);
    }

    /**
     * Get list of available providers
     */
    private List<String> getAvailableProviders() {
        List<String> available = new ArrayList<>();
        
        if (perplexityClient.isEnabled()) available.add("Perplexity");
        if (openAICompatibleClient.isOpenAIEnabled()) available.add("OpenAI");
        if (openAICompatibleClient.isOpenRouterEnabled()) available.add("OpenRouter");
        if (openAICompatibleClient.isAzureEnabled()) available.add("Azure");
        if (aiDoveClient.isEnabled()) available.add("AI Dove");
        available.add("Ollama"); // Always potentially available
        if (openAICompatibleClient.isCustomEnabled()) available.add("Custom");
        if (crawlSearchService.isAvailable()) available.add("Crawl+AIDove");
        
        return available;
    }

    /**
     * Build provider chain for live analysis
     */
    private List<ProviderAttempt> buildProviderChain(String prompt, String query, String window) {
        List<ProviderAttempt> chain = new ArrayList<>();

        // 1. Perplexity - Best for news analysis with online search
        if (perplexityClient.isEnabled()) {
            chain.add(new ProviderAttempt("Perplexity", () -> perplexityClient.streamCompletion(prompt)));
        }

        // 2. OpenAI
        if (openAICompatibleClient.isOpenAIEnabled()) {
            chain.add(new ProviderAttempt("OpenAI", () -> openAICompatibleClient.streamFromOpenAI(prompt)));
        }

        // 3. OpenRouter
        if (openAICompatibleClient.isOpenRouterEnabled()) {
            chain.add(new ProviderAttempt("OpenRouter", () -> openAICompatibleClient.streamFromOpenRouter(prompt)));
        }

        // 4. Azure OpenAI
        if (openAICompatibleClient.isAzureEnabled()) {
            chain.add(new ProviderAttempt("Azure", () -> openAICompatibleClient.streamFromAzure(prompt)));
        }

        // 5. AI Dove
        if (aiDoveClient.isEnabled()) {
            chain.add(new ProviderAttempt("AI Dove", () -> aiDoveClient.chatStream(prompt, null)));
        }

        // 6. CrawlSearchService (Crawl4AI + AI Dove)
        if (crawlSearchService.isAvailable()) {
            chain.add(new ProviderAttempt("Crawl+AIDove", () -> crawlSearchService.searchAndAnalyze(query, window)));
        }

        // 7. Ollama - Local LLM
        chain.add(new ProviderAttempt("Ollama", () -> openAICompatibleClient.streamFromOllama(prompt)));

        // 8. Custom endpoint
        if (openAICompatibleClient.isCustomEnabled()) {
            chain.add(new ProviderAttempt("Custom", () -> openAICompatibleClient.streamFromCustom(prompt)));
        }

        return chain;
    }

    /**
     * Try providers in sequence until one succeeds
     */
    private Flux<String> tryProvidersInSequence(List<ProviderAttempt> providers, int index) {
        if (index >= providers.size()) {
            log.error("All AI providers failed for live analysis");
            return Flux.just("모든 AI 제공자 연결에 실패했습니다. 나중에 다시 시도해주세요.");
        }

        ProviderAttempt current = providers.get(index);
        log.info("Trying AI provider: {} ({}/{})", current.name(), index + 1, providers.size());

        return current.streamSupplier().get()
                .timeout(Duration.ofSeconds(90))
                .onErrorResume(e -> {
                    log.warn("AI provider {} failed: {}. Trying next...", current.name(), e.getMessage());
                    return tryProvidersInSequence(providers, index + 1);
                })
                .switchIfEmpty(Flux.defer(() -> {
                    log.warn("AI provider {} returned empty. Trying next...", current.name());
                    return tryProvidersInSequence(providers, index + 1);
                }));
    }

    private String buildPrompt(String query, String window) {
        String normalizedQuery = (query == null || query.isBlank()) ? "지정된 키워드 없음" : query;

        String windowDescription;
        if ("1d".equals(window)) {
            windowDescription = "최근 1일";
        } else if ("30d".equals(window)) {
            windowDescription = "최근 30일";
        } else {
            windowDescription = "최근 7일";
        }

        return "다음 키워드 '" + normalizedQuery + "' 에 대해 " + windowDescription +
                " 동안의 주요 뉴스 흐름과 핵심 인사이트를 한국어로 자세히 요약해 주세요. " +
                "가능하면 bullet 형식으로 정리하고, 마지막에 전반적인 의미를 한 문단으로 정리해 주세요.";
    }

    /**
     * Provider attempt wrapper
     */
    private record ProviderAttempt(
            String name,
            Supplier<Flux<String>> streamSupplier
    ) {}
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/LlmProviderSettingsController.java

```java
package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.llm.LlmProviderSettingsDto;
import com.newsinsight.collector.dto.llm.LlmProviderSettingsRequest;
import com.newsinsight.collector.dto.llm.LlmTestResult;
import com.newsinsight.collector.entity.settings.LlmProviderType;
import com.newsinsight.collector.service.LlmProviderSettingsService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * LLM Provider 설정 API 컨트롤러.
 * 
 * 관리자(전역) 설정과 사용자별 설정을 분리하여 관리.
 * - /api/v1/admin/llm-providers: 관리자 전역 설정
 * - /api/v1/llm-providers: 사용자별 설정
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
@Slf4j
public class LlmProviderSettingsController {

    private final LlmProviderSettingsService settingsService;

    // ========== 공통: Provider 타입 목록 ==========

    /**
     * 지원하는 LLM Provider 타입 목록
     */
    @GetMapping("/llm-providers/types")
    public ResponseEntity<List<Map<String, String>>> getProviderTypes() {
        List<Map<String, String>> types = Arrays.stream(LlmProviderType.values())
                .map(type -> Map.of(
                        "value", type.name(),
                        "displayName", type.getDisplayName(),
                        "defaultBaseUrl", type.getDefaultBaseUrl() != null ? type.getDefaultBaseUrl() : ""
                ))
                .collect(Collectors.toList());
        return ResponseEntity.ok(types);
    }

    // ========== 관리자 전역 설정 API ==========

    /**
     * 모든 전역 설정 조회
     */
    @GetMapping("/admin/llm-providers")
    public ResponseEntity<List<LlmProviderSettingsDto>> getAllGlobalSettings() {
        return ResponseEntity.ok(settingsService.getAllGlobalSettings());
    }

    /**
     * 특정 Provider의 전역 설정 조회
     */
    @GetMapping("/admin/llm-providers/{providerType}")
    public ResponseEntity<LlmProviderSettingsDto> getGlobalSetting(@PathVariable LlmProviderType providerType) {
        return settingsService.getGlobalSetting(providerType)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * 전역 설정 생성/업데이트
     */
    @PutMapping("/admin/llm-providers")
    public ResponseEntity<LlmProviderSettingsDto> saveGlobalSetting(
            @Valid @RequestBody LlmProviderSettingsRequest request
    ) {
        LlmProviderSettingsDto saved = settingsService.saveGlobalSetting(request);
        return ResponseEntity.ok(saved);
    }

    /**
     * 전역 설정 삭제
     */
    @DeleteMapping("/admin/llm-providers/{providerType}")
    public ResponseEntity<Map<String, String>> deleteGlobalSetting(@PathVariable LlmProviderType providerType) {
        settingsService.deleteGlobalSetting(providerType);
        return ResponseEntity.ok(Map.of(
                "status", "deleted",
                "provider", providerType.name()
        ));
    }

    /**
     * 전역 설정 연결 테스트
     */
    @PostMapping("/admin/llm-providers/{id}/test")
    public ResponseEntity<LlmTestResult> testGlobalConnection(@PathVariable Long id) {
        LlmTestResult result = settingsService.testConnection(id);
        return ResponseEntity.ok(result);
    }

    /**
     * 전역 설정 활성화/비활성화
     */
    @PostMapping("/admin/llm-providers/{id}/toggle")
    public ResponseEntity<Map<String, Object>> toggleGlobalSetting(
            @PathVariable Long id,
            @RequestParam boolean enabled
    ) {
        settingsService.setEnabled(id, enabled);
        return ResponseEntity.ok(Map.of(
                "id", id,
                "enabled", enabled
        ));
    }

    // ========== 사용자별 설정 API ==========

    /**
     * 사용자의 유효 설정 조회 (사용자 설정 > 전역 설정)
     */
    @GetMapping("/llm-providers/effective")
    public ResponseEntity<List<LlmProviderSettingsDto>> getEffectiveSettings(
            @RequestHeader(value = "X-User-Id", required = false) String userId
    ) {
        return ResponseEntity.ok(settingsService.getEffectiveSettings(userId));
    }

    /**
     * 사용자의 활성화된 Provider 목록 (Fallback 체인용)
     */
    @GetMapping("/llm-providers/enabled")
    public ResponseEntity<List<LlmProviderSettingsDto>> getEnabledProviders(
            @RequestHeader(value = "X-User-Id", required = false) String userId
    ) {
        return ResponseEntity.ok(settingsService.getEnabledProviders(userId));
    }

    /**
     * 특정 Provider의 유효 설정 조회
     */
    @GetMapping("/llm-providers/config/{providerType}")
    public ResponseEntity<LlmProviderSettingsDto> getEffectiveSetting(
            @PathVariable LlmProviderType providerType,
            @RequestHeader(value = "X-User-Id", required = false) String userId
    ) {
        return settingsService.getEffectiveSetting(userId, providerType)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * 사용자의 개인 설정만 조회
     */
    @GetMapping("/llm-providers/user")
    public ResponseEntity<List<LlmProviderSettingsDto>> getUserSettings(
            @RequestHeader("X-User-Id") String userId
    ) {
        return ResponseEntity.ok(settingsService.getUserSettings(userId));
    }

    /**
     * 사용자 설정 생성/업데이트
     */
    @PutMapping("/llm-providers/user")
    public ResponseEntity<LlmProviderSettingsDto> saveUserSetting(
            @RequestHeader("X-User-Id") String userId,
            @Valid @RequestBody LlmProviderSettingsRequest request
    ) {
        LlmProviderSettingsDto saved = settingsService.saveUserSetting(userId, request);
        return ResponseEntity.ok(saved);
    }

    /**
     * 사용자 설정 삭제 (전역 설정으로 폴백)
     */
    @DeleteMapping("/llm-providers/user/{providerType}")
    public ResponseEntity<Map<String, String>> deleteUserSetting(
            @RequestHeader("X-User-Id") String userId,
            @PathVariable LlmProviderType providerType
    ) {
        settingsService.deleteUserSetting(userId, providerType);
        return ResponseEntity.ok(Map.of(
                "status", "deleted",
                "provider", providerType.name(),
                "message", "Falling back to global settings"
        ));
    }

    /**
     * 사용자의 모든 개인 설정 삭제
     */
    @DeleteMapping("/llm-providers/user")
    public ResponseEntity<Map<String, String>> deleteAllUserSettings(
            @RequestHeader("X-User-Id") String userId
    ) {
        settingsService.deleteAllUserSettings(userId);
        return ResponseEntity.ok(Map.of(
                "status", "deleted",
                "message", "All user settings deleted, falling back to global settings"
        ));
    }

    /**
     * 사용자 설정 연결 테스트
     */
    @PostMapping("/llm-providers/user/{id}/test")
    public ResponseEntity<LlmTestResult> testUserConnection(@PathVariable Long id) {
        LlmTestResult result = settingsService.testConnection(id);
        return ResponseEntity.ok(result);
    }

    /**
     * 새 설정으로 연결 테스트 (저장 전)
     */
    @PostMapping("/llm-providers/test")
    public ResponseEntity<LlmTestResult> testNewConnection(
            @Valid @RequestBody LlmProviderSettingsRequest request
    ) {
        LlmTestResult result = settingsService.testConnection(request);
        return ResponseEntity.ok(result);
    }

    // ========== 예외 처리 ==========

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> handleIllegalArgument(IllegalArgumentException e) {
        return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> handleException(Exception e) {
        log.error("Unexpected error in LlmProviderSettingsController", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "Internal server error: " + e.getMessage()));
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/MlAddonController.java

```java
package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.addon.AddonResponse;
import com.newsinsight.collector.entity.addon.*;
import com.newsinsight.collector.repository.MlAddonExecutionRepository;
import com.newsinsight.collector.repository.MlAddonRepository;
import com.newsinsight.collector.service.AddonOrchestratorService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * ML Add-on 관리 및 분석 실행 API.
 */
@RestController
@RequestMapping("/api/v1/ml")
@RequiredArgsConstructor
@Slf4j
public class MlAddonController {

    private final MlAddonRepository addonRepository;
    private final MlAddonExecutionRepository executionRepository;
    private final AddonOrchestratorService orchestratorService;

    // ========== Add-on Registry 관리 ==========

    /**
     * 모든 Add-on 목록 조회
     */
    @GetMapping("/addons")
    public ResponseEntity<List<MlAddon>> listAddons(
            @RequestParam(required = false) AddonCategory category,
            @RequestParam(required = false) Boolean enabled
    ) {
        List<MlAddon> addons;
        if (category != null && enabled != null && enabled) {
            addons = addonRepository.findByCategoryAndEnabledTrue(category);
        } else if (category != null) {
            addons = addonRepository.findByCategory(category);
        } else if (enabled != null && enabled) {
            addons = addonRepository.findByEnabledTrue();
        } else {
            addons = addonRepository.findAll();
        }
        return ResponseEntity.ok(addons);
    }

    /**
     * 특정 Add-on 조회
     */
    @GetMapping("/addons/{addonKey}")
    public ResponseEntity<MlAddon> getAddon(@PathVariable String addonKey) {
        return addonRepository.findByAddonKey(addonKey)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Add-on 등록
     */
    @PostMapping("/addons")
    public ResponseEntity<?> createAddon(@Valid @RequestBody MlAddon addon) {
        if (addonRepository.existsByAddonKey(addon.getAddonKey())) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Addon key already exists: " + addon.getAddonKey()));
        }

        MlAddon saved = addonRepository.save(addon);
        log.info("Created new addon: {}", addon.getAddonKey());
        return ResponseEntity.status(HttpStatus.CREATED).body(saved);
    }

    /**
     * Add-on 수정
     */
    @PutMapping("/addons/{addonKey}")
    public ResponseEntity<?> updateAddon(
            @PathVariable String addonKey,
            @RequestBody MlAddon updates
    ) {
        return addonRepository.findByAddonKey(addonKey)
                .map(existing -> {
                    // 수정 가능한 필드만 업데이트
                    if (updates.getName() != null) existing.setName(updates.getName());
                    if (updates.getDescription() != null) existing.setDescription(updates.getDescription());
                    if (updates.getEndpointUrl() != null) existing.setEndpointUrl(updates.getEndpointUrl());
                    if (updates.getTimeoutMs() != null) existing.setTimeoutMs(updates.getTimeoutMs());
                    if (updates.getMaxQps() != null) existing.setMaxQps(updates.getMaxQps());
                    if (updates.getMaxRetries() != null) existing.setMaxRetries(updates.getMaxRetries());
                    if (updates.getEnabled() != null) existing.setEnabled(updates.getEnabled());
                    if (updates.getPriority() != null) existing.setPriority(updates.getPriority());
                    if (updates.getConfig() != null) existing.setConfig(updates.getConfig());
                    if (updates.getDependsOn() != null) existing.setDependsOn(updates.getDependsOn());
                    if (updates.getAuthType() != null) existing.setAuthType(updates.getAuthType());
                    if (updates.getAuthCredentials() != null) existing.setAuthCredentials(updates.getAuthCredentials());
                    if (updates.getHealthCheckUrl() != null) existing.setHealthCheckUrl(updates.getHealthCheckUrl());

                    MlAddon saved = addonRepository.save(existing);
                    log.info("Updated addon: {}", addonKey);
                    return ResponseEntity.ok(saved);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Add-on 활성화/비활성화
     */
    @PostMapping("/addons/{addonKey}/toggle")
    public ResponseEntity<?> toggleAddon(@PathVariable String addonKey) {
        return addonRepository.findByAddonKey(addonKey)
                .map(addon -> {
                    addon.setEnabled(!addon.getEnabled());
                    MlAddon saved = addonRepository.save(addon);
                    log.info("Toggled addon {}: enabled={}", addonKey, saved.getEnabled());
                    return ResponseEntity.ok(Map.of(
                            "addonKey", addonKey,
                            "enabled", saved.getEnabled()
                    ));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Add-on 삭제
     */
    @DeleteMapping("/addons/{addonKey}")
    public ResponseEntity<?> deleteAddon(@PathVariable String addonKey) {
        return addonRepository.findByAddonKey(addonKey)
                .map(addon -> {
                    addonRepository.delete(addon);
                    log.info("Deleted addon: {}", addonKey);
                    return ResponseEntity.ok(Map.of("deleted", addonKey));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    // ========== 분석 실행 ==========

    /**
     * 특정 Add-on으로 직접 분석 실행 (커스텀 입력)
     * POST /api/v1/ml/addons/{addonKey}/analyze
     * 
     * 프론트엔드에서 직접 특정 Add-on을 호출하여 분석을 실행할 때 사용.
     * 기사 ID 없이 커스텀 데이터로 분석 가능.
     */
    @PostMapping("/addons/{addonKey}/analyze")
    public ResponseEntity<?> analyzeWithAddon(
            @PathVariable String addonKey,
            @RequestBody Map<String, Object> request
    ) {
        return addonRepository.findByAddonKey(addonKey)
                .map(addon -> {
                    if (!addon.getEnabled()) {
                        return ResponseEntity.badRequest()
                                .body(Map.of("error", "Addon is disabled: " + addonKey));
                    }
                    
                    try {
                        // 요청에서 article 정보 추출
                        @SuppressWarnings("unchecked")
                        Map<String, Object> articleData = (Map<String, Object>) request.getOrDefault("article", Map.of());
                        
                        String requestId = java.util.UUID.randomUUID().toString();
                        String importance = (String) request.getOrDefault("importance", "batch");
                        
                        // Add-on 직접 호출
                        AddonResponse response = orchestratorService.executeAddonDirect(addon, articleData, requestId, importance);
                        
                        if (response == null) {
                            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                                    .body(Map.of("error", "Addon did not return a response"));
                        }
                        
                        return ResponseEntity.ok(response);
                    } catch (Exception e) {
                        log.error("Failed to execute addon {}: {}", addonKey, e.getMessage(), e);
                        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                                .body(Map.of(
                                        "error", "Addon execution failed",
                                        "message", e.getMessage()
                                ));
                    }
                })
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * 단일 기사 분석 실행
     */
    @PostMapping("/analyze/{articleId}")
    public ResponseEntity<?> analyzeArticle(
            @PathVariable Long articleId,
            @RequestParam(defaultValue = "batch") String importance
    ) {
        try {
            CompletableFuture<String> future = orchestratorService.analyzeArticle(articleId, importance);
            String batchId = future.get();
            return ResponseEntity.accepted().body(Map.of(
                    "status", "accepted",
                    "articleId", articleId,
                    "batchId", batchId
            ));
        } catch (Exception e) {
            log.error("Failed to start analysis for article: {}", articleId, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * 여러 기사 일괄 분석
     */
    @PostMapping("/analyze/batch")
    public ResponseEntity<?> analyzeArticles(
            @RequestBody List<Long> articleIds,
            @RequestParam(defaultValue = "batch") String importance
    ) {
        CompletableFuture<String> future = orchestratorService.analyzeArticles(articleIds, importance);
        return ResponseEntity.accepted().body(Map.of(
                "status", "accepted",
                "articleCount", articleIds.size(),
                "batchId", future.join()
        ));
    }

    /**
     * 특정 카테고리 Add-on만 실행
     */
    @PostMapping("/analyze/{articleId}/category/{category}")
    public ResponseEntity<?> analyzeByCategory(
            @PathVariable Long articleId,
            @PathVariable AddonCategory category
    ) {
        try {
            CompletableFuture<AddonResponse> future = orchestratorService.executeCategory(articleId, category);
            AddonResponse response = future.get();
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("Failed to analyze article {} with category {}", articleId, category, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", e.getMessage()));
        }
    }

    // ========== 실행 이력 ==========

    /**
     * 실행 이력 조회 (status 필터 지원)
     */
    @GetMapping("/executions")
    public ResponseEntity<Page<MlAddonExecution>> listExecutions(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) ExecutionStatus status
    ) {
        PageRequest pageRequest = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
        Page<MlAddonExecution> executions;
        if (status != null) {
            executions = executionRepository.findByStatus(status, pageRequest);
        } else {
            executions = executionRepository.findAll(pageRequest);
        }
        return ResponseEntity.ok(executions);
    }

    /**
     * 특정 기사의 실행 이력
     */
    @GetMapping("/executions/article/{articleId}")
    public ResponseEntity<List<MlAddonExecution>> getArticleExecutions(@PathVariable Long articleId) {
        return ResponseEntity.ok(executionRepository.findByArticleId(articleId));
    }

    // ========== 모니터링 ==========

    /**
     * Add-on 상태 요약
     * 프론트엔드 MlAddonStatusSummary 형식에 맞춰 반환
     */
    @GetMapping("/status")
    public ResponseEntity<?> getStatus() {
        List<MlAddon> allAddons = addonRepository.findAll();
        long enabled = allAddons.stream().filter(MlAddon::getEnabled).count();
        long healthy = allAddons.stream()
                .filter(a -> a.getHealthStatus() == AddonHealthStatus.HEALTHY)
                .count();
        long unhealthy = allAddons.stream()
                .filter(a -> a.getHealthStatus() != AddonHealthStatus.HEALTHY && a.getHealthStatus() != AddonHealthStatus.UNKNOWN)
                .count();

        // 오늘의 실행 통계 계산
        LocalDateTime todayStart = LocalDateTime.now().toLocalDate().atStartOfDay();
        List<MlAddonExecution> todayExecutions = executionRepository.findByCreatedAtAfter(todayStart);
        long totalExecutionsToday = todayExecutions.size();
        long successCount = todayExecutions.stream()
                .filter(e -> e.getStatus() == ExecutionStatus.SUCCESS)
                .count();
        double successRate = totalExecutionsToday > 0 
                ? (double) successCount / totalExecutionsToday * 100 
                : 0.0;
        
        // 평균 지연시간 계산
        double avgLatencyMs = todayExecutions.stream()
                .filter(e -> e.getLatencyMs() != null)
                .mapToLong(MlAddonExecution::getLatencyMs)
                .average()
                .orElse(0.0);
        
        // 카테고리별 addon 수
        Map<String, Long> byCategory = allAddons.stream()
                .collect(java.util.stream.Collectors.groupingBy(
                        a -> a.getCategory().name(),
                        java.util.stream.Collectors.counting()
                ));
        
        return ResponseEntity.ok(Map.of(
                "totalAddons", allAddons.size(),
                "enabledAddons", enabled,
                "healthyAddons", healthy,
                "unhealthyAddons", unhealthy,
                "totalExecutionsToday", totalExecutionsToday,
                "successRate", Math.round(successRate * 100.0) / 100.0,
                "avgLatencyMs", Math.round(avgLatencyMs * 100.0) / 100.0,
                "byCategory", byCategory
        ));
    }

    /**
     * 헬스체크 수동 실행
     */
    @PostMapping("/health-check")
    public ResponseEntity<?> runHealthCheck() {
        orchestratorService.runHealthChecks();
        return ResponseEntity.ok(Map.of("status", "Health check started"));
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/ProjectController.java

```java
package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.PageResponse;
import com.newsinsight.collector.entity.project.*;
import com.newsinsight.collector.service.ProjectService;
import com.newsinsight.collector.service.ProjectService.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * REST Controller for Project API.
 * Provides endpoints for project CRUD, members, items, and activities.
 */
@RestController
@RequestMapping("/api/v1/projects")
@RequiredArgsConstructor
@Slf4j
public class ProjectController {

    private final ProjectService projectService;

    // ============================================
    // Project CRUD
    // ============================================

    /**
     * Create a new project.
     */
    @PostMapping
    public ResponseEntity<Project> createProject(@RequestBody CreateProjectRequest request) {
        log.info("Creating project: name='{}', owner={}", request.getName(), request.getOwnerId());

        if (request.getName() == null || request.getName().isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        if (request.getOwnerId() == null || request.getOwnerId().isBlank()) {
            return ResponseEntity.badRequest().build();
        }

        Project project = projectService.createProject(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(project);
    }

    /**
     * Get project by ID.
     */
    @GetMapping("/{id}")
    public ResponseEntity<Project> getProject(
            @PathVariable Long id,
            @RequestParam(required = false) String userId
    ) {
        if (userId != null) {
            return projectService.getProjectWithAccess(id, userId)
                    .map(ResponseEntity::ok)
                    .orElse(ResponseEntity.notFound().build());
        }
        return projectService.getProject(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Update project.
     */
    @PutMapping("/{id}")
    public ResponseEntity<Project> updateProject(
            @PathVariable Long id,
            @RequestBody UpdateProjectRequest request,
            @RequestParam String userId
    ) {
        try {
            Project updated = projectService.updateProject(id, request, userId);
            return ResponseEntity.ok(updated);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
    }

    /**
     * Update project status.
     */
    @PutMapping("/{id}/status")
    public ResponseEntity<Project> updateProjectStatus(
            @PathVariable Long id,
            @RequestBody Map<String, String> body,
            @RequestParam String userId
    ) {
        String statusStr = body.get("status");
        if (statusStr == null) {
            return ResponseEntity.badRequest().build();
        }

        try {
            Project.ProjectStatus status = Project.ProjectStatus.valueOf(statusStr.toUpperCase());
            Project updated = projectService.updateProjectStatus(id, status, userId);
            return ResponseEntity.ok(updated);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
    }

    /**
     * Delete project.
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteProject(
            @PathVariable Long id,
            @RequestParam String userId
    ) {
        try {
            projectService.deleteProject(id, userId);
            return ResponseEntity.noContent().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
    }

    /**
     * Get projects by owner.
     */
    @GetMapping
    public ResponseEntity<PageResponse<Project>> getProjects(
            @RequestParam String ownerId,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        Page<Project> result;

        if (status != null) {
            Project.ProjectStatus projectStatus = Project.ProjectStatus.valueOf(status.toUpperCase());
            result = projectService.getProjectsByOwnerAndStatus(ownerId, projectStatus, page, size);
        } else {
            result = projectService.getProjectsByOwner(ownerId, page, size);
        }

        PageResponse<Project> response = new PageResponse<>(
                result.getContent(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages(),
                result.isFirst(),
                result.isLast(),
                result.hasNext(),
                result.hasPrevious()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Search projects.
     */
    @GetMapping("/search")
    public ResponseEntity<PageResponse<Project>> searchProjects(
            @RequestParam String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        Page<Project> result = projectService.searchProjects(q, page, size);

        PageResponse<Project> response = new PageResponse<>(
                result.getContent(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages(),
                result.isFirst(),
                result.isLast(),
                result.hasNext(),
                result.hasPrevious()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Get or create default project.
     */
    @GetMapping("/default")
    public ResponseEntity<Project> getDefaultProject(@RequestParam String userId) {
        Project project = projectService.getOrCreateDefaultProject(userId);
        return ResponseEntity.ok(project);
    }

    /**
     * Get project statistics.
     */
    @GetMapping("/{id}/stats")
    public ResponseEntity<Map<String, Object>> getProjectStats(@PathVariable Long id) {
        try {
            Map<String, Object> stats = projectService.getProjectStats(id);
            return ResponseEntity.ok(stats);
        } catch (Exception e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ============================================
    // Member Management
    // ============================================

    /**
     * Get project members.
     */
    @GetMapping("/{id}/members")
    public ResponseEntity<List<ProjectMember>> getMembers(@PathVariable Long id) {
        List<ProjectMember> members = projectService.getMembers(id);
        return ResponseEntity.ok(members);
    }

    /**
     * Get active members.
     */
    @GetMapping("/{id}/members/active")
    public ResponseEntity<List<ProjectMember>> getActiveMembers(@PathVariable Long id) {
        List<ProjectMember> members = projectService.getActiveMembers(id);
        return ResponseEntity.ok(members);
    }

    /**
     * Invite member.
     */
    @PostMapping("/{id}/members/invite")
    public ResponseEntity<ProjectMember> inviteMember(
            @PathVariable Long id,
            @RequestBody Map<String, String> body,
            @RequestParam String invitedBy
    ) {
        String userId = body.get("userId");
        String roleStr = body.get("role");

        if (userId == null || userId.isBlank()) {
            return ResponseEntity.badRequest().build();
        }

        ProjectMember.MemberRole role = roleStr != null 
                ? ProjectMember.MemberRole.valueOf(roleStr.toUpperCase())
                : ProjectMember.MemberRole.VIEWER;

        try {
            ProjectMember member = projectService.inviteMember(id, userId, role, invitedBy);
            return ResponseEntity.status(HttpStatus.CREATED).body(member);
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).build();
        }
    }

    /**
     * Accept invitation.
     */
    @PostMapping("/invitations/{token}/accept")
    public ResponseEntity<ProjectMember> acceptInvitation(
            @PathVariable String token,
            @RequestParam String userId
    ) {
        try {
            ProjectMember member = projectService.acceptInvitation(token, userId);
            return ResponseEntity.ok(member);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
    }

    /**
     * Remove member.
     */
    @DeleteMapping("/{id}/members/{userId}")
    public ResponseEntity<Void> removeMember(
            @PathVariable Long id,
            @PathVariable String userId,
            @RequestParam String removedBy
    ) {
        try {
            projectService.removeMember(id, userId, removedBy);
            return ResponseEntity.noContent().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
    }

    /**
     * Update member role.
     */
    @PutMapping("/{id}/members/{userId}/role")
    public ResponseEntity<ProjectMember> updateMemberRole(
            @PathVariable Long id,
            @PathVariable String userId,
            @RequestBody Map<String, String> body,
            @RequestParam String updatedBy
    ) {
        String roleStr = body.get("role");
        if (roleStr == null) {
            return ResponseEntity.badRequest().build();
        }

        try {
            ProjectMember.MemberRole role = ProjectMember.MemberRole.valueOf(roleStr.toUpperCase());
            ProjectMember member = projectService.updateMemberRole(id, userId, role, updatedBy);
            return ResponseEntity.ok(member);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
    }

    // ============================================
    // Item Management
    // ============================================

    /**
     * Add item to project.
     */
    @PostMapping("/{id}/items")
    public ResponseEntity<ProjectItem> addItem(
            @PathVariable Long id,
            @RequestBody AddItemRequest request,
            @RequestParam String userId
    ) {
        try {
            ProjectItem item = projectService.addItem(id, request, userId);
            return ResponseEntity.status(HttpStatus.CREATED).body(item);
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
    }

    /**
     * Get project items.
     */
    @GetMapping("/{id}/items")
    public ResponseEntity<PageResponse<ProjectItem>> getItems(
            @PathVariable Long id,
            @RequestParam(required = false) String type,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        Page<ProjectItem> result;

        if (type != null) {
            ProjectItem.ItemType itemType = ProjectItem.ItemType.valueOf(type.toUpperCase());
            result = projectService.getItemsByType(id, itemType, page, size);
        } else {
            result = projectService.getItems(id, page, size);
        }

        PageResponse<ProjectItem> response = new PageResponse<>(
                result.getContent(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages(),
                result.isFirst(),
                result.isLast(),
                result.hasNext(),
                result.hasPrevious()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Search items.
     */
    @GetMapping("/{id}/items/search")
    public ResponseEntity<PageResponse<ProjectItem>> searchItems(
            @PathVariable Long id,
            @RequestParam String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        Page<ProjectItem> result = projectService.searchItems(id, q, page, size);

        PageResponse<ProjectItem> response = new PageResponse<>(
                result.getContent(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages(),
                result.isFirst(),
                result.isLast(),
                result.hasNext(),
                result.hasPrevious()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Mark item as read.
     */
    @PostMapping("/{projectId}/items/{itemId}/read")
    public ResponseEntity<Void> markItemAsRead(
            @PathVariable Long projectId,
            @PathVariable Long itemId,
            @RequestParam String userId
    ) {
        projectService.markItemAsRead(itemId, userId);
        return ResponseEntity.ok().build();
    }

    /**
     * Toggle item bookmark.
     */
    @PostMapping("/{projectId}/items/{itemId}/bookmark")
    public ResponseEntity<Void> toggleItemBookmark(
            @PathVariable Long projectId,
            @PathVariable Long itemId,
            @RequestParam String userId
    ) {
        projectService.toggleItemBookmark(itemId, userId);
        return ResponseEntity.ok().build();
    }

    /**
     * Delete item.
     */
    @DeleteMapping("/{projectId}/items/{itemId}")
    public ResponseEntity<Void> deleteItem(
            @PathVariable Long projectId,
            @PathVariable Long itemId,
            @RequestParam String userId
    ) {
        try {
            projectService.deleteItem(projectId, itemId, userId);
            return ResponseEntity.noContent().build();
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
    }

    // ============================================
    // Activity Log
    // ============================================

    /**
     * Get project activity log.
     */
    @GetMapping("/{id}/activities")
    public ResponseEntity<PageResponse<ProjectActivityLog>> getActivityLog(
            @PathVariable Long id,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        Page<ProjectActivityLog> result = projectService.getActivityLog(id, page, size);

        PageResponse<ProjectActivityLog> response = new PageResponse<>(
                result.getContent(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages(),
                result.isFirst(),
                result.isLast(),
                result.hasNext(),
                result.hasPrevious()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Get recent activity.
     */
    @GetMapping("/{id}/activities/recent")
    public ResponseEntity<List<ProjectActivityLog>> getRecentActivity(@PathVariable Long id) {
        List<ProjectActivityLog> activities = projectService.getRecentActivity(id);
        return ResponseEntity.ok(activities);
    }

    // ============================================
    // Notifications
    // ============================================

    /**
     * Get user notifications.
     */
    @GetMapping("/notifications")
    public ResponseEntity<PageResponse<ProjectNotification>> getUserNotifications(
            @RequestParam String userId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        Page<ProjectNotification> result = projectService.getUserNotifications(userId, page, size);

        PageResponse<ProjectNotification> response = new PageResponse<>(
                result.getContent(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages(),
                result.isFirst(),
                result.isLast(),
                result.hasNext(),
                result.hasPrevious()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Get unread notifications.
     */
    @GetMapping("/notifications/unread")
    public ResponseEntity<List<ProjectNotification>> getUnreadNotifications(@RequestParam String userId) {
        List<ProjectNotification> notifications = projectService.getUnreadNotifications(userId);
        return ResponseEntity.ok(notifications);
    }

    /**
     * Mark notification as read.
     */
    @PostMapping("/notifications/{notificationId}/read")
    public ResponseEntity<Void> markNotificationAsRead(@PathVariable Long notificationId) {
        projectService.markNotificationAsRead(notificationId);
        return ResponseEntity.ok().build();
    }

    /**
     * Mark all notifications as read.
     */
    @PostMapping("/notifications/read-all")
    public ResponseEntity<Void> markAllNotificationsAsRead(@RequestParam String userId) {
        projectService.markAllNotificationsAsRead(userId);
        return ResponseEntity.ok().build();
    }

    // ============================================
    // Health
    // ============================================

    /**
     * Health check.
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        return ResponseEntity.ok(Map.of(
                "status", "available",
                "features", Map.of(
                        "projects", true,
                        "members", true,
                        "items", true,
                        "activities", true,
                        "notifications", true
                )
        ));
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/ReportController.java

```java
package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.report.ReportMetadata;
import com.newsinsight.collector.dto.report.ReportRequest;
import com.newsinsight.collector.service.report.ReportGenerationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/**
 * 보고서 생성 및 다운로드 REST API 컨트롤러
 */
@RestController
@RequestMapping("/api/v1/reports")
@RequiredArgsConstructor
@Slf4j
@Tag(name = "Reports", description = "PDF 보고서 생성 및 다운로드 API")
public class ReportController {

    private final ReportGenerationService reportGenerationService;

    /**
     * 통합 검색 보고서 생성 요청 (비동기)
     * 
     * @param jobId 통합 검색 Job ID
     * @param request 보고서 생성 요청
     * @return 보고서 메타데이터
     */
    @PostMapping("/unified-search/{jobId}")
    @Operation(summary = "통합 검색 보고서 생성 요청", description = "비동기로 PDF 보고서를 생성합니다.")
    public ResponseEntity<ReportMetadata> requestUnifiedSearchReport(
            @PathVariable String jobId,
            @RequestBody ReportRequest request) {
        
        log.info("Report generation requested: jobId={}, query={}", jobId, request.getQuery());
        
        ReportMetadata metadata = reportGenerationService.requestUnifiedSearchReport(jobId, request);
        
        return ResponseEntity.accepted().body(metadata);
    }

    /**
     * 통합 검색 보고서 즉시 다운로드 (동기)
     * 
     * @param jobId 통합 검색 Job ID
     * @param request 보고서 생성 요청
     * @return PDF 파일
     */
    @PostMapping("/unified-search/{jobId}/export")
    @Operation(summary = "통합 검색 보고서 즉시 다운로드", description = "동기로 PDF 보고서를 생성하고 즉시 다운로드합니다.")
    public ResponseEntity<byte[]> exportUnifiedSearchReport(
            @PathVariable String jobId,
            @RequestBody ReportRequest request) {
        
        log.info("Report export requested: jobId={}, query={}", jobId, request.getQuery());
        
        try {
            byte[] pdfBytes = reportGenerationService.generateReportSync(jobId, request);
            
            String filename = generateFilename(request.getQuery(), "통합검색");
            
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_PDF);
            headers.setContentDispositionFormData("attachment", filename);
            headers.setContentLength(pdfBytes.length);
            
            return ResponseEntity.ok()
                    .headers(headers)
                    .body(pdfBytes);
                    
        } catch (IllegalArgumentException e) {
            log.warn("Report export failed - not found: jobId={}, error={}", jobId, e.getMessage());
            return ResponseEntity.notFound().build();
        } catch (IOException e) {
            log.error("Report export failed - IO error: jobId={}, error={}", jobId, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * 보고서 상태 조회
     * 
     * @param reportId 보고서 ID
     * @return 보고서 메타데이터
     */
    @GetMapping("/{reportId}")
    @Operation(summary = "보고서 상태 조회", description = "생성 중이거나 완료된 보고서의 상태를 조회합니다.")
    public ResponseEntity<ReportMetadata> getReportStatus(@PathVariable String reportId) {
        ReportMetadata metadata = reportGenerationService.getReportMetadata(reportId);
        
        if (metadata == null) {
            return ResponseEntity.notFound().build();
        }
        
        return ResponseEntity.ok(metadata);
    }

    /**
     * 생성된 보고서 다운로드
     * 
     * @param reportId 보고서 ID
     * @return PDF 파일
     */
    @GetMapping("/{reportId}/download")
    @Operation(summary = "보고서 다운로드", description = "생성된 PDF 보고서를 다운로드합니다.")
    public ResponseEntity<byte[]> downloadReport(@PathVariable String reportId) {
        ReportMetadata metadata = reportGenerationService.getReportMetadata(reportId);
        
        if (metadata == null) {
            return ResponseEntity.notFound().build();
        }
        
        if (metadata.getStatus() != ReportMetadata.ReportStatus.COMPLETED) {
            return ResponseEntity.status(HttpStatus.ACCEPTED)
                    .header("X-Report-Status", metadata.getStatus().name())
                    .build();
        }
        
        try {
            byte[] pdfBytes = reportGenerationService.downloadReport(reportId);
            
            String filename = generateFilename(metadata.getQuery(), "보고서");
            
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_PDF);
            headers.setContentDispositionFormData("attachment", filename);
            headers.setContentLength(pdfBytes.length);
            
            return ResponseEntity.ok()
                    .headers(headers)
                    .body(pdfBytes);
                    
        } catch (IllegalArgumentException e) {
            log.warn("Report download failed - not found: reportId={}", reportId);
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * DeepSearch 보고서 즉시 다운로드 (동기)
     * 
     * @param jobId DeepSearch Job ID
     * @param request 보고서 생성 요청
     * @return PDF 파일
     */
    @PostMapping("/deep-search/{jobId}/export")
    @Operation(summary = "DeepSearch 보고서 즉시 다운로드", description = "DeepSearch 결과를 PDF 보고서로 내보냅니다.")
    public ResponseEntity<byte[]> exportDeepSearchReport(
            @PathVariable String jobId,
            @RequestBody ReportRequest request) {
        
        log.info("DeepSearch report export requested: jobId={}", jobId);
        
        // TODO: DeepSearch 전용 보고서 생성 로직 구현 필요
        // 현재는 통합 검색 보고서로 대체
        
        try {
            request = ReportRequest.builder()
                    .reportType(ReportRequest.ReportType.DEEP_SEARCH)
                    .targetId(jobId)
                    .query(request.getQuery())
                    .timeWindow(request.getTimeWindow())
                    .includeSections(request.getIncludeSections())
                    .chartImages(request.getChartImages())
                    .build();
            
            byte[] pdfBytes = reportGenerationService.generateReportSync(jobId, request);
            
            String filename = generateFilename(request.getQuery(), "DeepSearch");
            
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_PDF);
            headers.setContentDispositionFormData("attachment", filename);
            headers.setContentLength(pdfBytes.length);
            
            return ResponseEntity.ok()
                    .headers(headers)
                    .body(pdfBytes);
                    
        } catch (IllegalArgumentException e) {
            log.warn("DeepSearch report export failed - not found: jobId={}", jobId);
            return ResponseEntity.notFound().build();
        } catch (IOException e) {
            log.error("DeepSearch report export failed: jobId={}, error={}", jobId, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * ML 분석 보고서 즉시 다운로드 (동기)
     * 
     * @param articleId 기사 ID
     * @param request 보고서 생성 요청
     * @return PDF 파일
     */
    @PostMapping("/ml-analysis/{articleId}/export")
    @Operation(summary = "ML 분석 보고서 즉시 다운로드", description = "기사의 ML 분석 결과를 PDF 보고서로 내보냅니다.")
    public ResponseEntity<byte[]> exportMlAnalysisReport(
            @PathVariable Long articleId,
            @RequestBody ReportRequest request) {
        
        log.info("ML analysis report export requested: articleId={}", articleId);
        
        // TODO: ML 분석 전용 보고서 생성 로직 구현
        
        return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED)
                .header("X-Message", "ML analysis report is not yet implemented")
                .build();
    }

    // ===== 헬퍼 메서드 =====

    /**
     * PDF 파일명 생성
     */
    private String generateFilename(String query, String type) {
        String dateStr = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmm"));
        String safeQuery = query != null ? query.replaceAll("[^가-힣a-zA-Z0-9]", "_") : "report";
        if (safeQuery.length() > 30) {
            safeQuery = safeQuery.substring(0, 30);
        }
        
        String filename = String.format("NewsInsight_%s_%s_%s.pdf", type, safeQuery, dateStr);
        
        // URL 인코딩 (한글 파일명 지원)
        return URLEncoder.encode(filename, StandardCharsets.UTF_8)
                .replace("+", "%20");
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/SearchHistoryController.java

```java
package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.PageResponse;
import com.newsinsight.collector.dto.SearchHistoryDto;
import com.newsinsight.collector.dto.SearchHistoryMessage;
import com.newsinsight.collector.entity.search.SearchHistory;
import com.newsinsight.collector.entity.search.SearchType;
import com.newsinsight.collector.service.SearchHistoryEventService;
import com.newsinsight.collector.service.SearchHistoryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Flux;

import java.util.List;
import java.util.Map;

/**
 * REST Controller for Search History API.
 * Provides endpoints for saving, querying, and managing search history.
 */
@RestController
@RequestMapping("/api/v1/search-history")
@RequiredArgsConstructor
@Slf4j
public class SearchHistoryController {

    private final SearchHistoryService searchHistoryService;
    private final SearchHistoryEventService searchHistoryEventService;

    // ============================================
    // Create / Save
    // ============================================

    /**
     * Save search result asynchronously via Kafka.
     * This is the primary endpoint for saving search results.
     */
    @PostMapping
    public ResponseEntity<Map<String, Object>> saveSearchHistory(@RequestBody SearchHistoryDto request) {
        log.info("Saving search history: type={}, query='{}'", request.getSearchType(), request.getQuery());
        
        if (request.getQuery() == null || request.getQuery().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "Query is required"
            ));
        }
        
        if (request.getSearchType() == null) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "Search type is required"
            ));
        }

        // Convert to message and send to Kafka
        SearchHistoryMessage message = request.toMessage();
        searchHistoryService.sendToKafka(message);

        return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of(
                "message", "Search history queued for saving",
                "externalId", message.getExternalId() != null ? message.getExternalId() : "",
                "searchType", message.getSearchType().name(),
                "query", message.getQuery()
        ));
    }

    /**
     * Save search result synchronously (for immediate persistence).
     */
    @PostMapping("/sync")
    public ResponseEntity<SearchHistoryDto> saveSearchHistorySync(@RequestBody SearchHistoryDto request) {
        log.info("Saving search history synchronously: type={}, query='{}'", 
                request.getSearchType(), request.getQuery());
        
        SearchHistoryMessage message = request.toMessage();
        SearchHistory saved = searchHistoryService.saveFromMessage(message);
        
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(SearchHistoryDto.fromEntity(saved));
    }

    // ============================================
    // Read / Query
    // ============================================

    /**
     * Get search history by ID.
     */
    @GetMapping("/{id}")
    public ResponseEntity<SearchHistoryDto> getById(@PathVariable Long id) {
        return searchHistoryService.findById(id)
                .map(SearchHistoryDto::fromEntity)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Get search history by external ID (e.g., jobId).
     */
    @GetMapping("/external/{externalId}")
    public ResponseEntity<SearchHistoryDto> getByExternalId(@PathVariable String externalId) {
        return searchHistoryService.findByExternalId(externalId)
                .map(SearchHistoryDto::fromEntity)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Get paginated search history.
     */
    @GetMapping
    public ResponseEntity<PageResponse<SearchHistoryDto>> getAll(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(defaultValue = "createdAt") String sortBy,
            @RequestParam(defaultValue = "DESC") String sortDirection,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String userId,
            @RequestHeader(value = "X-User-Id", required = false) String headerUserId,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId
    ) {
        // Use header userId if not provided in query param
        String effectiveUserId = userId != null ? userId : headerUserId;
        
        Page<SearchHistory> result;
        
        if (type != null && effectiveUserId != null) {
            SearchType searchType = SearchType.valueOf(type.toUpperCase());
            result = searchHistoryService.findByUserAndType(effectiveUserId, searchType, page, size);
        } else if (type != null) {
            SearchType searchType = SearchType.valueOf(type.toUpperCase());
            result = searchHistoryService.findByType(searchType, page, size);
        } else if (effectiveUserId != null) {
            result = searchHistoryService.findByUser(effectiveUserId, page, size);
        } else {
            result = searchHistoryService.findAll(page, size, sortBy, sortDirection);
        }

        PageResponse<SearchHistoryDto> response = new PageResponse<>(
                result.getContent().stream()
                        .map(SearchHistoryDto::fromEntity)
                        .toList(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages(),
                result.isFirst(),
                result.isLast(),
                result.hasNext(),
                result.hasPrevious()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Search history by query text.
     */
    @GetMapping("/search")
    public ResponseEntity<PageResponse<SearchHistoryDto>> searchByQuery(
            @RequestParam String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        Page<SearchHistory> result = searchHistoryService.searchByQuery(q, page, size);
        
        PageResponse<SearchHistoryDto> response = new PageResponse<>(
                result.getContent().stream()
                        .map(SearchHistoryDto::fromEntity)
                        .toList(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages(),
                result.isFirst(),
                result.isLast(),
                result.hasNext(),
                result.hasPrevious()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Get bookmarked searches.
     */
    @GetMapping("/bookmarked")
    public ResponseEntity<PageResponse<SearchHistoryDto>> getBookmarked(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        Page<SearchHistory> result = searchHistoryService.findBookmarked(page, size);
        
        PageResponse<SearchHistoryDto> response = new PageResponse<>(
                result.getContent().stream()
                        .map(SearchHistoryDto::fromEntity)
                        .toList(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages(),
                result.isFirst(),
                result.isLast(),
                result.hasNext(),
                result.hasPrevious()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Get derived searches from a parent.
     */
    @GetMapping("/{id}/derived")
    public ResponseEntity<List<SearchHistoryDto>> getDerivedSearches(@PathVariable Long id) {
        List<SearchHistory> derived = searchHistoryService.findDerivedSearches(id);
        List<SearchHistoryDto> response = derived.stream()
                .map(SearchHistoryDto::fromEntity)
                .toList();
        return ResponseEntity.ok(response);
    }

    /**
     * Get searches by session.
     */
    @GetMapping("/session/{sessionId}")
    public ResponseEntity<List<SearchHistoryDto>> getBySession(@PathVariable String sessionId) {
        List<SearchHistory> searches = searchHistoryService.findBySession(sessionId);
        List<SearchHistoryDto> response = searches.stream()
                .map(SearchHistoryDto::fromEntity)
                .toList();
        return ResponseEntity.ok(response);
    }

    // ============================================
    // Update
    // ============================================

    /**
     * Toggle bookmark status.
     */
    @PostMapping("/{id}/bookmark")
    public ResponseEntity<SearchHistoryDto> toggleBookmark(@PathVariable Long id) {
        try {
            SearchHistory updated = searchHistoryService.toggleBookmark(id);
            return ResponseEntity.ok(SearchHistoryDto.fromEntity(updated));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * Update tags.
     */
    @PutMapping("/{id}/tags")
    public ResponseEntity<SearchHistoryDto> updateTags(
            @PathVariable Long id,
            @RequestBody List<String> tags
    ) {
        try {
            SearchHistory updated = searchHistoryService.updateTags(id, tags);
            return ResponseEntity.ok(SearchHistoryDto.fromEntity(updated));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * Update notes.
     */
    @PutMapping("/{id}/notes")
    public ResponseEntity<SearchHistoryDto> updateNotes(
            @PathVariable Long id,
            @RequestBody Map<String, String> body
    ) {
        String notes = body.get("notes");
        try {
            SearchHistory updated = searchHistoryService.updateNotes(id, notes);
            return ResponseEntity.ok(SearchHistoryDto.fromEntity(updated));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ============================================
    // Delete
    // ============================================

    /**
     * Delete search history by ID.
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        if (searchHistoryService.findById(id).isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        searchHistoryService.delete(id);
        return ResponseEntity.noContent().build();
    }

    // ============================================
    // Derived Search (Drill-down)
    // ============================================

    /**
     * Create a derived search from a parent.
     * Used for drill-down functionality.
     */
    @PostMapping("/{parentId}/derive")
    public ResponseEntity<Map<String, Object>> createDerivedSearch(
            @PathVariable Long parentId,
            @RequestBody SearchHistoryDto request
    ) {
        log.info("Creating derived search from parent={}, query='{}'", parentId, request.getQuery());
        
        if (request.getQuery() == null || request.getQuery().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "Query is required"
            ));
        }

        try {
            SearchHistoryMessage message = request.toMessage();
            SearchHistory derived = searchHistoryService.createDerivedSearch(parentId, message);
            
            return ResponseEntity.status(HttpStatus.CREATED).body(Map.of(
                    "id", derived.getId(),
                    "parentSearchId", parentId,
                    "depthLevel", derived.getDepthLevel(),
                    "query", derived.getQuery(),
                    "message", "Derived search created"
            ));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ============================================
    // Statistics & Utilities
    // ============================================

    /**
     * Get search statistics.
     */
    @GetMapping("/stats")
    public ResponseEntity<Map<String, Object>> getStatistics(
            @RequestParam(defaultValue = "30") int days
    ) {
        return ResponseEntity.ok(searchHistoryService.getStatistics(days));
    }

    /**
     * Get recently discovered URLs.
     */
    @GetMapping("/discovered-urls")
    public ResponseEntity<List<String>> getDiscoveredUrls(
            @RequestParam(defaultValue = "7") int days,
            @RequestParam(defaultValue = "100") int limit
    ) {
        return ResponseEntity.ok(searchHistoryService.getRecentDiscoveredUrls(days, limit));
    }

    /**
     * Health check.
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        return ResponseEntity.ok(Map.of(
                "status", "available",
                "features", Map.of(
                        "asyncSave", true,
                        "syncSave", true,
                        "derivedSearch", true,
                        "bookmarks", true,
                        "tags", true,
                        "statistics", true,
                        "sse", true
                ),
                "kafkaTopic", SearchHistoryService.SEARCH_HISTORY_TOPIC,
                "sseSubscribers", searchHistoryEventService.getSubscriberCount()
        ));
    }

    // ============================================
    // Continue Work Feature
    // ============================================

    /**
     * Get items for "Continue Work" feature.
     * Returns actionable searches: in-progress, failed, partial, draft, or unviewed completed.
     */
    @GetMapping("/continue-work")
    public ResponseEntity<Map<String, Object>> getContinueWorkItems(
            @RequestParam(required = false) String userId,
            @RequestParam(required = false) String sessionId,
            @RequestParam(required = false, defaultValue = "10") int limit,
            @RequestHeader(value = "X-User-Id", required = false) String headerUserId,
            @RequestHeader(value = "X-Session-Id", required = false) String headerSessionId
    ) {
        // Use headers if not provided in query params
        String effectiveUserId = userId != null ? userId : headerUserId;
        String effectiveSessionId = sessionId != null ? sessionId : headerSessionId;
        
        log.debug("Continue work request: userId={}, sessionId={}", effectiveUserId, effectiveSessionId);
        
        List<SearchHistory> items = searchHistoryService.findContinueWorkItems(
                effectiveUserId != null ? effectiveUserId : "", 
                effectiveSessionId != null ? effectiveSessionId : "", 
                limit
        );
        
        List<SearchHistoryDto> dtos = items.stream()
                .map(SearchHistoryDto::fromEntity)
                .toList();

        Map<String, Object> stats = searchHistoryService.getContinueWorkStats(
                effectiveUserId != null ? effectiveUserId : "", 
                effectiveSessionId != null ? effectiveSessionId : ""
        );

        return ResponseEntity.ok(Map.of(
                "items", dtos,
                "count", dtos.size(),
                "stats", stats
        ));
    }

    /**
     * Mark search as viewed.
     */
    @PostMapping("/{id}/viewed")
    public ResponseEntity<SearchHistoryDto> markAsViewed(@PathVariable Long id) {
        try {
            SearchHistory updated = searchHistoryService.markAsViewed(id);
            return ResponseEntity.ok(SearchHistoryDto.fromEntity(updated));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * Mark search as viewed by external ID.
     */
    @PostMapping("/external/{externalId}/viewed")
    public ResponseEntity<SearchHistoryDto> markAsViewedByExternalId(@PathVariable String externalId) {
        try {
            SearchHistory updated = searchHistoryService.markAsViewedByExternalId(externalId);
            return ResponseEntity.ok(SearchHistoryDto.fromEntity(updated));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * Update completion status.
     */
    @PutMapping("/{id}/status")
    public ResponseEntity<SearchHistoryDto> updateCompletionStatus(
            @PathVariable Long id,
            @RequestBody Map<String, String> body
    ) {
        String statusStr = body.get("status");
        if (statusStr == null || statusStr.isBlank()) {
            return ResponseEntity.badRequest().build();
        }

        try {
            SearchHistory.CompletionStatus status = SearchHistory.CompletionStatus.valueOf(statusStr.toUpperCase());
            SearchHistory updated = searchHistoryService.updateCompletionStatus(id, status);
            return ResponseEntity.ok(SearchHistoryDto.fromEntity(updated));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * Get searches by completion status.
     */
    @GetMapping("/status/{status}")
    public ResponseEntity<PageResponse<SearchHistoryDto>> getByCompletionStatus(
            @PathVariable String status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        try {
            SearchHistory.CompletionStatus completionStatus = 
                    SearchHistory.CompletionStatus.valueOf(status.toUpperCase());
            
            Page<SearchHistory> result = searchHistoryService.findByCompletionStatus(completionStatus, page, size);
            
            PageResponse<SearchHistoryDto> response = new PageResponse<>(
                    result.getContent().stream()
                            .map(SearchHistoryDto::fromEntity)
                            .toList(),
                    result.getNumber(),
                    result.getSize(),
                    result.getTotalElements(),
                    result.getTotalPages(),
                    result.isFirst(),
                    result.isLast(),
                    result.hasNext(),
                    result.hasPrevious()
            );

            return ResponseEntity.ok(response);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * Get searches by project ID.
     */
    @GetMapping("/project/{projectId}")
    public ResponseEntity<PageResponse<SearchHistoryDto>> getByProjectId(
            @PathVariable Long projectId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        Page<SearchHistory> result = searchHistoryService.findByProjectId(projectId, page, size);
        
        PageResponse<SearchHistoryDto> response = new PageResponse<>(
                result.getContent().stream()
                        .map(SearchHistoryDto::fromEntity)
                        .toList(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages(),
                result.isFirst(),
                result.isLast(),
                result.hasNext(),
                result.hasPrevious()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Get failed searches for potential retry.
     */
    @GetMapping("/failed")
    public ResponseEntity<List<SearchHistoryDto>> getFailedSearches(
            @RequestParam(defaultValue = "7") int daysBack,
            @RequestParam(defaultValue = "20") int limit
    ) {
        List<SearchHistory> failed = searchHistoryService.findFailedSearches(daysBack, limit);
        List<SearchHistoryDto> response = failed.stream()
                .map(SearchHistoryDto::fromEntity)
                .toList();
        return ResponseEntity.ok(response);
    }

    // ============================================
    // SSE Real-time Stream
    // ============================================

    /**
     * SSE endpoint for real-time search history updates.
     * Clients can subscribe to receive notifications when:
     * - new_search: A new search was saved
     * - updated_search: An existing search was updated
     * - deleted_search: A search was deleted
     * - heartbeat: Keep-alive signal (every 30 seconds)
     */
    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<SearchHistoryEventService.SearchHistoryEventDto>> streamSearchHistory() {
        log.info("New SSE client connected to search history stream");
        
        return searchHistoryEventService.getEventStream()
                .map(event -> ServerSentEvent.<SearchHistoryEventService.SearchHistoryEventDto>builder()
                        .id(String.valueOf(event.timestamp()))
                        .event(event.eventType())
                        .data(event)
                        .build());
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/SearchJobController.java

```java
package com.newsinsight.collector.controller;

import com.newsinsight.collector.entity.search.SearchType;
import com.newsinsight.collector.service.SearchJobQueueService;
import com.newsinsight.collector.service.SearchJobQueueService.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Sinks;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * REST Controller for Search Job Queue API.
 * Enables concurrent search execution and real-time job monitoring.
 */
@RestController
@RequestMapping("/api/v1/jobs")
@RequiredArgsConstructor
@Slf4j
public class SearchJobController {

    private final SearchJobQueueService searchJobQueueService;

    // SSE sinks for job-specific streaming
    private final Map<String, Sinks.Many<SearchJobEvent>> jobSinks = new ConcurrentHashMap<>();

    // ============================================
    // Job Creation
    // ============================================

    /**
     * Start a new search job.
     * Supports concurrent execution of multiple job types.
     */
    @PostMapping
    public ResponseEntity<Map<String, Object>> startJob(
            @RequestBody JobStartRequest request,
            @RequestHeader(value = "X-User-Id", required = false) String userId,
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId
    ) {
        log.info("Starting new search job: type={}, query='{}', userId={}, sessionId={}", 
                request.type(), request.query(), userId, sessionId);

        if (request.query() == null || request.query().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "Query is required"
            ));
        }

        if (request.type() == null) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "Search type is required"
            ));
        }

        // Use headers if request doesn't specify userId/sessionId
        String effectiveUserId = request.userId() != null ? request.userId() : userId;
        String effectiveSessionId = request.sessionId() != null ? request.sessionId() : sessionId;

        SearchJobRequest jobRequest = SearchJobRequest.builder()
                .type(request.type())
                .query(request.query())
                .timeWindow(request.timeWindow() != null ? request.timeWindow() : "7d")
                .userId(effectiveUserId)
                .sessionId(effectiveSessionId)
                .projectId(request.projectId())
                .options(request.options())
                .build();

        String jobId = searchJobQueueService.startJob(jobRequest);

        return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of(
                "jobId", jobId,
                "type", request.type().name(),
                "query", request.query(),
                "status", "PENDING",
                "message", "검색 작업이 시작되었습니다"
        ));
    }

    /**
     * Start multiple search jobs concurrently.
     * Enables running Unified Search, Deep Search, etc. at the same time.
     */
    @PostMapping("/batch")
    public ResponseEntity<Map<String, Object>> startBatchJobs(@RequestBody List<JobStartRequest> requests) {
        log.info("Starting batch jobs: count={}", requests.size());

        if (requests.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "At least one job request is required"
            ));
        }

        List<Map<String, Object>> startedJobs = requests.stream()
                .map(request -> {
                    SearchJobRequest jobRequest = SearchJobRequest.builder()
                            .type(request.type())
                            .query(request.query())
                            .timeWindow(request.timeWindow() != null ? request.timeWindow() : "7d")
                            .userId(request.userId())
                            .sessionId(request.sessionId())
                            .projectId(request.projectId())
                            .options(request.options())
                            .build();

                    String jobId = searchJobQueueService.startJob(jobRequest);

                    return Map.<String, Object>of(
                            "jobId", jobId,
                            "type", request.type().name(),
                            "query", request.query(),
                            "status", "PENDING"
                    );
                })
                .toList();

        return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of(
                "jobs", startedJobs,
                "count", startedJobs.size(),
                "message", String.format("%d개의 검색 작업이 시작되었습니다", startedJobs.size())
        ));
    }

    // ============================================
    // Job Status & Query
    // ============================================

    /**
     * Get status of a specific job.
     */
    @GetMapping("/{jobId}")
    public ResponseEntity<SearchJob> getJobStatus(@PathVariable String jobId) {
        return searchJobQueueService.getJobStatus(jobId)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Get active jobs for user.
     */
    @GetMapping("/active")
    public ResponseEntity<List<SearchJob>> getActiveJobs(
            @RequestParam(required = false) String userId,
            @RequestHeader(value = "X-User-Id", required = false) String headerUserId
    ) {
        // Use header userId if not provided in query param
        String effectiveUserId = userId != null ? userId : headerUserId;
        List<SearchJob> activeJobs = searchJobQueueService.getActiveJobs(effectiveUserId);
        return ResponseEntity.ok(activeJobs);
    }

    /**
     * Get all jobs for user (with limit).
     */
    @GetMapping
    public ResponseEntity<List<SearchJob>> getAllJobs(
            @RequestParam(required = false) String userId,
            @RequestParam(required = false, defaultValue = "20") int limit,
            @RequestHeader(value = "X-User-Id", required = false) String headerUserId
    ) {
        // Use header userId if not provided in query param
        String effectiveUserId = userId != null ? userId : headerUserId;
        List<SearchJob> jobs = searchJobQueueService.getAllJobs(effectiveUserId, limit);
        return ResponseEntity.ok(jobs);
    }

    // ============================================
    // Job Control
    // ============================================

    /**
     * Cancel a running job.
     */
    @PostMapping("/{jobId}/cancel")
    public ResponseEntity<Map<String, Object>> cancelJob(@PathVariable String jobId) {
        log.info("Cancelling job: jobId={}", jobId);

        boolean cancelled = searchJobQueueService.cancelJob(jobId);

        if (cancelled) {
            return ResponseEntity.ok(Map.of(
                    "jobId", jobId,
                    "status", "CANCELLED",
                    "message", "작업이 취소되었습니다"
            ));
        } else {
            return ResponseEntity.badRequest().body(Map.of(
                    "jobId", jobId,
                    "error", "작업을 취소할 수 없습니다 (이미 완료되었거나 존재하지 않음)"
            ));
        }
    }

    // ============================================
    // SSE Real-time Job Streaming
    // ============================================

    /**
     * SSE endpoint for real-time job updates.
     * Stream updates for a specific job.
     */
    @GetMapping(value = "/{jobId}/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<SearchJobEvent>> streamJobUpdates(@PathVariable String jobId) {
        log.info("New SSE client connected to job stream: jobId={}", jobId);

        // Create or get sink for this job
        Sinks.Many<SearchJobEvent> sink = jobSinks.computeIfAbsent(
                jobId,
                id -> Sinks.many().multicast().onBackpressureBuffer()
        );

        // Register listener with the service
        searchJobQueueService.registerListener(jobId, event -> {
            sink.tryEmitNext(event);

            // Cleanup on completion
            if ("completed".equals(event.getEventType()) ||
                    "failed".equals(event.getEventType()) ||
                    "cancelled".equals(event.getEventType())) {
                // Emit complete signal after a delay
                sink.tryEmitComplete();
                jobSinks.remove(jobId);
            }
        });

        // Add heartbeat to keep connection alive
        Flux<ServerSentEvent<SearchJobEvent>> heartbeat = Flux.interval(Duration.ofSeconds(15))
                .map(i -> ServerSentEvent.<SearchJobEvent>builder()
                        .id(String.valueOf(System.currentTimeMillis()))
                        .event("heartbeat")
                        .data(SearchJobEvent.builder()
                                .jobId(jobId)
                                .eventType("heartbeat")
                                .timestamp(System.currentTimeMillis())
                                .build())
                        .build());

        Flux<ServerSentEvent<SearchJobEvent>> events = sink.asFlux()
                .map(event -> ServerSentEvent.<SearchJobEvent>builder()
                        .id(String.valueOf(event.getTimestamp()))
                        .event(event.getEventType())
                        .data(event)
                        .build())
                .doOnCancel(() -> {
                    searchJobQueueService.unregisterListener(jobId);
                    jobSinks.remove(jobId);
                });

        return Flux.merge(events, heartbeat)
                .doFinally(signal -> {
                    searchJobQueueService.unregisterListener(jobId);
                    jobSinks.remove(jobId);
                });
    }

    /**
     * SSE endpoint for all active jobs of a user.
     * Stream updates for all active jobs.
     */
    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<Map<String, Object>>> streamAllJobs(
            @RequestParam(required = false, defaultValue = "anonymous") String userId
    ) {
        log.info("New SSE client connected to all-jobs stream: userId={}", userId);

        // Poll for job updates every 2 seconds
        return Flux.interval(Duration.ofSeconds(2))
                .map(i -> {
                    List<SearchJob> activeJobs = searchJobQueueService.getActiveJobs(userId);
                    return ServerSentEvent.<Map<String, Object>>builder()
                            .id(String.valueOf(System.currentTimeMillis()))
                            .event("jobs_update")
                            .data(Map.of(
                                    "jobs", activeJobs,
                                    "count", activeJobs.size(),
                                    "timestamp", System.currentTimeMillis()
                            ))
                            .build();
                })
                .takeUntilOther(Flux.never()); // Keep alive until client disconnects
    }

    // ============================================
    // Health & Stats
    // ============================================

    /**
     * Health check endpoint.
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        return ResponseEntity.ok(Map.of(
                "status", "available",
                "features", Map.of(
                        "concurrentJobs", true,
                        "batchStart", true,
                        "jobCancellation", true,
                        "sseStreaming", true
                ),
                "supportedTypes", List.of(
                        SearchType.UNIFIED.name(),
                        SearchType.DEEP_SEARCH.name(),
                        SearchType.FACT_CHECK.name(),
                        SearchType.BROWSER_AGENT.name()
                )
        ));
    }

    // ============================================
    // DTOs
    // ============================================

    /**
     * Request DTO for starting a job.
     */
    public record JobStartRequest(
            SearchType type,
            String query,
            String timeWindow,
            String userId,
            String sessionId,
            Long projectId,
            Map<String, Object> options
    ) {}
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/SearchTemplateController.java

```java
package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.PageResponse;
import com.newsinsight.collector.dto.SearchTemplateDto;
import com.newsinsight.collector.entity.search.SearchTemplate;
import com.newsinsight.collector.service.SearchTemplateService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * REST Controller for Search Template API.
 * Provides endpoints for managing search templates (SmartSearch feature).
 */
@RestController
@RequestMapping("/api/v1/search-templates")
@RequiredArgsConstructor
@Slf4j
public class SearchTemplateController {

    private final SearchTemplateService searchTemplateService;

    // ============================================
    // Create
    // ============================================

    /**
     * Create a new search template
     */
    @PostMapping
    public ResponseEntity<?> createTemplate(@RequestBody SearchTemplateDto request) {
        log.info("Creating template: name='{}', mode={}, userId={}", 
                request.getName(), request.getMode(), request.getUserId());

        try {
            SearchTemplate created = searchTemplateService.create(request);
            return ResponseEntity.status(HttpStatus.CREATED)
                    .body(SearchTemplateDto.fromEntity(created));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    // ============================================
    // Read
    // ============================================

    /**
     * Get template by ID
     */
    @GetMapping("/{id}")
    public ResponseEntity<SearchTemplateDto> getById(@PathVariable Long id) {
        return searchTemplateService.findById(id)
                .map(SearchTemplateDto::fromEntity)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Get paginated templates with optional filtering
     */
    @GetMapping
    public ResponseEntity<PageResponse<SearchTemplateDto>> getAll(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(defaultValue = "createdAt") String sortBy,
            @RequestParam(defaultValue = "DESC") String sortDirection,
            @RequestParam(required = false) String userId,
            @RequestParam(required = false) String mode
    ) {
        Page<SearchTemplate> result;

        if (userId != null && mode != null) {
            result = searchTemplateService.findByUserAndMode(userId, mode, page, size);
        } else if (userId != null) {
            result = searchTemplateService.findByUser(userId, page, size);
        } else {
            result = searchTemplateService.findAll(page, size, sortBy, sortDirection);
        }

        PageResponse<SearchTemplateDto> response = new PageResponse<>(
                result.getContent().stream()
                        .map(SearchTemplateDto::fromEntity)
                        .toList(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages(),
                result.isFirst(),
                result.isLast(),
                result.hasNext(),
                result.hasPrevious()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Get all templates for a user (list format, no pagination)
     */
    @GetMapping("/user/{userId}")
    public ResponseEntity<List<SearchTemplateDto>> getAllByUser(@PathVariable String userId) {
        List<SearchTemplate> templates = searchTemplateService.findAllByUser(userId);
        List<SearchTemplateDto> response = templates.stream()
                .map(SearchTemplateDto::fromEntity)
                .toList();
        return ResponseEntity.ok(response);
    }

    /**
     * Get favorite templates for a user
     */
    @GetMapping("/user/{userId}/favorites")
    public ResponseEntity<List<SearchTemplateDto>> getFavorites(@PathVariable String userId) {
        List<SearchTemplate> templates = searchTemplateService.findFavoritesByUser(userId);
        List<SearchTemplateDto> response = templates.stream()
                .map(SearchTemplateDto::fromEntity)
                .toList();
        return ResponseEntity.ok(response);
    }

    /**
     * Get most used templates for a user
     */
    @GetMapping("/user/{userId}/most-used")
    public ResponseEntity<List<SearchTemplateDto>> getMostUsed(
            @PathVariable String userId,
            @RequestParam(defaultValue = "10") int limit
    ) {
        List<SearchTemplate> templates = searchTemplateService.findMostUsed(userId, limit);
        List<SearchTemplateDto> response = templates.stream()
                .map(SearchTemplateDto::fromEntity)
                .toList();
        return ResponseEntity.ok(response);
    }

    /**
     * Get recently used templates for a user
     */
    @GetMapping("/user/{userId}/recent")
    public ResponseEntity<List<SearchTemplateDto>> getRecentlyUsed(
            @PathVariable String userId,
            @RequestParam(defaultValue = "10") int limit
    ) {
        List<SearchTemplate> templates = searchTemplateService.findRecentlyUsed(userId, limit);
        List<SearchTemplateDto> response = templates.stream()
                .map(SearchTemplateDto::fromEntity)
                .toList();
        return ResponseEntity.ok(response);
    }

    /**
     * Search templates by name
     */
    @GetMapping("/search")
    public ResponseEntity<PageResponse<SearchTemplateDto>> searchByName(
            @RequestParam String q,
            @RequestParam(required = false) String userId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        Page<SearchTemplate> result = searchTemplateService.searchByName(q, userId, page, size);

        PageResponse<SearchTemplateDto> response = new PageResponse<>(
                result.getContent().stream()
                        .map(SearchTemplateDto::fromEntity)
                        .toList(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages(),
                result.isFirst(),
                result.isLast(),
                result.hasNext(),
                result.hasPrevious()
        );

        return ResponseEntity.ok(response);
    }

    // ============================================
    // Update
    // ============================================

    /**
     * Update a template
     */
    @PutMapping("/{id}")
    public ResponseEntity<?> updateTemplate(
            @PathVariable Long id,
            @RequestBody SearchTemplateDto request
    ) {
        try {
            SearchTemplate updated = searchTemplateService.update(id, request);
            return ResponseEntity.ok(SearchTemplateDto.fromEntity(updated));
        } catch (IllegalArgumentException e) {
            if (e.getMessage().contains("not found")) {
                return ResponseEntity.notFound().build();
            }
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Toggle favorite status
     */
    @PostMapping("/{id}/favorite")
    public ResponseEntity<?> toggleFavorite(@PathVariable Long id) {
        try {
            SearchTemplate updated = searchTemplateService.toggleFavorite(id);
            return ResponseEntity.ok(SearchTemplateDto.fromEntity(updated));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * Record template usage (when user loads a template)
     */
    @PostMapping("/{id}/use")
    public ResponseEntity<Map<String, Object>> recordUsage(@PathVariable Long id) {
        if (searchTemplateService.findById(id).isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        searchTemplateService.recordUsage(id);
        return ResponseEntity.ok(Map.of(
                "message", "Usage recorded",
                "templateId", id
        ));
    }

    /**
     * Duplicate a template
     */
    @PostMapping("/{id}/duplicate")
    public ResponseEntity<?> duplicateTemplate(
            @PathVariable Long id,
            @RequestParam(required = false) String newName,
            @RequestParam(required = false) String userId
    ) {
        try {
            SearchTemplate duplicated = searchTemplateService.duplicate(id, newName, userId);
            return ResponseEntity.status(HttpStatus.CREATED)
                    .body(SearchTemplateDto.fromEntity(duplicated));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ============================================
    // Delete
    // ============================================

    /**
     * Delete a template
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteTemplate(@PathVariable Long id) {
        try {
            searchTemplateService.delete(id);
            return ResponseEntity.noContent().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ============================================
    // Statistics
    // ============================================

    /**
     * Get template statistics
     */
    @GetMapping("/stats")
    public ResponseEntity<Map<String, Object>> getStatistics(
            @RequestParam(required = false) String userId
    ) {
        return ResponseEntity.ok(searchTemplateService.getStatistics(userId));
    }

    /**
     * Health check
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        return ResponseEntity.ok(Map.of(
                "service", "SearchTemplateService",
                "status", "available",
                "features", Map.of(
                        "create", true,
                        "favorites", true,
                        "duplicate", true,
                        "usageTracking", true
                )
        ));
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/SourceController.java

```java
package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.*;
import com.newsinsight.collector.entity.DataSource;
import com.newsinsight.collector.mapper.EntityMapper;
import com.newsinsight.collector.service.DataSourceService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/sources")
@RequiredArgsConstructor
public class SourceController {

    private final DataSourceService dataSourceService;
    private final EntityMapper entityMapper;

    /**
     * GET /api/v1/sources - 모든 데이터 소스 목록 조회 (페이징/정렬 지원)
     */
    @GetMapping
    public ResponseEntity<Page<DataSourceDTO>> listSources(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(defaultValue = "id") String sortBy,
            @RequestParam(defaultValue = "DESC") String sortDirection) {
        
        Sort.Direction direction = Sort.Direction.fromString(sortDirection);
        Pageable pageable = PageRequest.of(page, size, Sort.by(direction, sortBy));
        
        Page<DataSource> sources = dataSourceService.findAll(pageable);
        Page<DataSourceDTO> sourceDTOs = sources.map(entityMapper::toDataSourceDTO);
        
        return ResponseEntity.ok(sourceDTOs);
    }

    /**
     * GET /api/v1/sources/active - 활성 데이터 소스 목록 조회
     */
    @GetMapping("/active")
    public ResponseEntity<Page<DataSourceDTO>> listActiveSources(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "id"));
        Page<DataSource> sources = dataSourceService.findAllActive(pageable);
        Page<DataSourceDTO> sourceDTOs = sources.map(entityMapper::toDataSourceDTO);
        
        return ResponseEntity.ok(sourceDTOs);
    }

    /**
     * GET /api/v1/sources/{id} - ID로 데이터 소스 조회
     */
    @GetMapping("/{id}")
    public ResponseEntity<DataSourceDTO> getSource(@PathVariable Long id) {
        return dataSourceService.findById(id)
                .map(entityMapper::toDataSourceDTO)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * POST /api/v1/sources - 새로운 데이터 소스 등록
     */
    @PostMapping
    public ResponseEntity<DataSourceDTO> createSource(@Valid @RequestBody DataSourceCreateRequest request) {
        DataSource source = entityMapper.toDataSource(request);
        DataSource savedSource = dataSourceService.create(source);
        DataSourceDTO dto = entityMapper.toDataSourceDTO(savedSource);
        
        return ResponseEntity.status(HttpStatus.CREATED).body(dto);
    }

    /**
     * PUT /api/v1/sources/{id} - 데이터 소스 수정
     */
    @PutMapping("/{id}")
    public ResponseEntity<DataSourceDTO> updateSource(
            @PathVariable Long id,
            @Valid @RequestBody DataSourceUpdateRequest request) {
        
        return dataSourceService.findById(id)
                .map(existingSource -> {
                    entityMapper.updateDataSourceFromRequest(request, existingSource);
                    DataSource updated = dataSourceService.save(existingSource);
                    return ResponseEntity.ok(entityMapper.toDataSourceDTO(updated));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * DELETE /api/v1/sources/{id} - 데이터 소스 삭제
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteSource(@PathVariable Long id) {
        boolean deleted = dataSourceService.delete(id);
        return deleted ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }

    /**
     * POST /api/v1/sources/{id}/activate - 데이터 소스 활성화
     */
    @PostMapping("/{id}/activate")
    public ResponseEntity<DataSourceDTO> activateSource(@PathVariable Long id) {
        return dataSourceService.findById(id)
                .map(source -> {
                    source.setIsActive(true);
                    DataSource updated = dataSourceService.save(source);
                    return ResponseEntity.ok(entityMapper.toDataSourceDTO(updated));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * POST /api/v1/sources/{id}/deactivate - 데이터 소스 비활성화
     */
    @PostMapping("/{id}/deactivate")
    public ResponseEntity<DataSourceDTO> deactivateSource(@PathVariable Long id) {
        return dataSourceService.findById(id)
                .map(source -> {
                    source.setIsActive(false);
                    DataSource updated = dataSourceService.save(source);
                    return ResponseEntity.ok(entityMapper.toDataSourceDTO(updated));
                })
                .orElse(ResponseEntity.notFound().build());
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/UnifiedSearchController.java

```java
package com.newsinsight.collector.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.service.AnalysisEventService;
import com.newsinsight.collector.service.FactVerificationService;
import com.newsinsight.collector.service.UnifiedSearchEventService;
import com.newsinsight.collector.service.UnifiedSearchService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Flux;

import java.time.Duration;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 통합 검색 컨트롤러
 * 
 * 병렬 검색 및 심층 분석 기능을 SSE 스트리밍으로 제공합니다.
 * 특정 기술/API 이름을 노출하지 않고 통합된 경험을 제공합니다.
 */
@RestController
@RequestMapping("/api/v1/search")
@RequiredArgsConstructor
@Slf4j
public class UnifiedSearchController {

    private final UnifiedSearchService unifiedSearchService;
    private final UnifiedSearchEventService unifiedSearchEventService;
    private final FactVerificationService factVerificationService;
    private final AnalysisEventService analysisEventService;
    private final ObjectMapper objectMapper;

    /**
     * 통합 병렬 검색 (SSE 스트리밍)
     * 
     * DB, 웹, AI 검색을 병렬로 실행하고 결과가 나오는 대로 스트리밍합니다.
     * 
     * @param query 검색어
     * @param window 시간 범위 (1d, 7d, 30d)
     * @return SSE 이벤트 스트림
     */
    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> streamSearch(
            @RequestParam String query,
            @RequestParam(defaultValue = "7d") String window
    ) {
        log.info("Starting streaming search for query: '{}', window: {}", query, window);

        // 즉시 연결 확인 이벤트 전송 (클라이언트가 연결 성공을 확인할 수 있도록)
        Flux<ServerSentEvent<String>> initialEvent = Flux.just(
                ServerSentEvent.<String>builder()
                        .id("init")
                        .event("connected")
                        .data("{\"message\": \"검색 시스템에 연결되었습니다. 병렬 검색을 시작합니다...\", \"query\": \"" + query + "\"}")
                        .build()
        );

        Flux<ServerSentEvent<String>> searchEvents = unifiedSearchService.searchParallel(query, window)
                .map(event -> {
                    try {
                        String data = objectMapper.writeValueAsString(event);
                        return ServerSentEvent.<String>builder()
                                .id(java.util.UUID.randomUUID().toString())
                                .event(event.getEventType())
                                .data(data)
                                .build();
                    } catch (Exception e) {
                        log.error("Failed to serialize search event: {}", e.getMessage());
                        return ServerSentEvent.<String>builder()
                                .event("error")
                                .data("{\"error\": \"Serialization failed\"}")
                                .build();
                    }
                });

        Flux<ServerSentEvent<String>> doneEvent = Flux.just(
                ServerSentEvent.<String>builder()
                        .event("done")
                        .data("{\"message\": \"Search completed\"}")
                        .build()
        );

        return Flux.concat(initialEvent, searchEvents, doneEvent)
                .doOnError(e -> log.error("Stream search error: {}", e.getMessage()))
                .timeout(Duration.ofMinutes(2))
                .onErrorResume(e -> Flux.just(
                        ServerSentEvent.<String>builder()
                                .event("error")
                                .data("{\"error\": \"" + e.getMessage() + "\"}")
                                .build()
                ));
    }

    /**
     * 심층 분석 및 팩트 검증 (SSE 스트리밍)
     * 
     * 주어진 주제에 대해 Wikipedia 등 신뢰할 수 있는 출처와 대조하여
     * 타당성을 검증하고 심층 분석을 수행합니다.
     * 
     * @param request 분석 요청 (topic, claims)
     * @return SSE 이벤트 스트림
     */
    @PostMapping(value = "/deep/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> streamDeepAnalysis(
            @RequestBody DeepAnalysisRequest request
    ) {
        log.info("Starting deep analysis for topic: '{}'", request.getTopic());

        return factVerificationService.analyzeAndVerify(request.getTopic(), request.getClaims())
                .map(event -> {
                    try {
                        String data = objectMapper.writeValueAsString(event);
                        return ServerSentEvent.<String>builder()
                                .id(java.util.UUID.randomUUID().toString())
                                .event(event.getEventType())
                                .data(data)
                                .build();
                    } catch (Exception e) {
                        log.error("Failed to serialize deep analysis event: {}", e.getMessage());
                        return ServerSentEvent.<String>builder()
                                .event("error")
                                .data("{\"error\": \"Serialization failed\"}")
                                .build();
                    }
                })
                .concatWith(Flux.just(
                        ServerSentEvent.<String>builder()
                                .event("done")
                                .data("{\"message\": \"Analysis completed\"}")
                                .build()
                ))
                .timeout(Duration.ofMinutes(3))
                .onErrorResume(e -> Flux.just(
                        ServerSentEvent.<String>builder()
                                .event("error")
                                .data("{\"error\": \"" + e.getMessage() + "\"}")
                                .build()
                ));
    }

    // ============================================
    // Job-based Search API (supports SSE reconnection)
    // ============================================

    /**
     * Start a new search job.
     * Returns immediately with jobId. Results are streamed via SSE.
     * 
     * @param request Search request with query and window
     * @return 202 Accepted with job details
     */
    @PostMapping("/jobs")
    public ResponseEntity<Map<String, Object>> startSearchJob(@RequestBody SearchJobRequest request) {
        if (request.getQuery() == null || request.getQuery().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "Query is required"
            ));
        }

        String jobId = UUID.randomUUID().toString();
        String window = request.getWindow() != null ? request.getWindow() : "7d";
        List<String> priorityUrls = request.getPriorityUrls();
        String startDate = request.getStartDate();
        String endDate = request.getEndDate();
        
        log.info("Starting search job: {} for query: '{}', window: {}, priorityUrls: {}, startDate: {}, endDate: {}", 
                jobId, request.getQuery(), window, 
                priorityUrls != null ? priorityUrls.size() : 0,
                startDate, endDate);

        // Create job in event service
        var metadata = unifiedSearchEventService.createJob(jobId, request.getQuery(), window);
        
        // Start async search execution with priorityUrls and custom date range
        unifiedSearchService.executeSearchAsync(jobId, request.getQuery(), window, priorityUrls, startDate, endDate);

        return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of(
                "jobId", jobId,
                "query", request.getQuery(),
                "window", window,
                "status", metadata.status(),
                "createdAt", metadata.createdAt(),
                "streamUrl", "/api/v1/search/jobs/" + jobId + "/stream"
        ));
    }

    /**
     * Get job status.
     * 
     * @param jobId The job ID
     * @return Job status
     */
    @GetMapping("/jobs/{jobId}")
    public ResponseEntity<Map<String, Object>> getJobStatus(@PathVariable String jobId) {
        var metadata = unifiedSearchEventService.getJobMetadata(jobId);
        
        if (metadata == null) {
            return ResponseEntity.notFound().build();
        }

        return ResponseEntity.ok(Map.of(
                "jobId", metadata.jobId(),
                "query", metadata.query(),
                "window", metadata.window(),
                "status", metadata.status(),
                "createdAt", metadata.createdAt(),
                "completedAt", metadata.completedAt() != null ? metadata.completedAt() : ""
        ));
    }

    /**
     * Stream search job results via SSE.
     * Supports reconnection - client can reconnect with same jobId.
     * 
     * @param jobId The job ID
     * @return SSE event stream
     */
    @GetMapping(value = "/jobs/{jobId}/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<Object>> streamJobResults(@PathVariable String jobId) {
        log.info("SSE connection request for search job: {}", jobId);

        if (!unifiedSearchEventService.hasJob(jobId)) {
            return Flux.just(ServerSentEvent.builder()
                    .event("error")
                    .data(Map.of("error", "Job not found: " + jobId))
                    .build());
        }

        return unifiedSearchEventService.getJobEventStream(jobId)
                .timeout(Duration.ofMinutes(5))
                .onErrorResume(e -> {
                    log.error("SSE stream error for job: {}", jobId, e);
                    return Flux.just(ServerSentEvent.builder()
                            .event("error")
                            .data(Map.of("error", e.getMessage()))
                            .build());
                });
    }

    /**
     * 검색 서비스 상태 확인
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        return ResponseEntity.ok(Map.of(
                "status", "available",
                "features", Map.of(
                        "parallelSearch", true,
                        "deepAnalysis", true,
                        "factVerification", true,
                        "analysisStreaming", true
                ),
                "description", "통합 검색 및 심층 분석 서비스"
        ));
    }

    /**
     * 분석 결과 실시간 업데이트 스트림 (SSE)
     * 
     * 특정 기사 ID들의 분석 완료 이벤트를 실시간으로 구독합니다.
     * 검색 결과 페이지에서 분석 중인 기사들의 상태를 실시간으로 업데이트할 때 사용합니다.
     * 
     * @param articleIds 구독할 기사 ID 목록 (comma-separated)
     * @return SSE 이벤트 스트림
     */
    @GetMapping(value = "/analysis/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<Object>> streamAnalysisUpdates(
            @RequestParam(required = false) String articleIds
    ) {
        Set<Long> ids = new HashSet<>();
        if (articleIds != null && !articleIds.isBlank()) {
            try {
                for (String idStr : articleIds.split(",")) {
                    ids.add(Long.parseLong(idStr.trim()));
                }
            } catch (NumberFormatException e) {
                log.warn("Invalid article IDs format: {}", articleIds);
            }
        }

        log.info("Starting analysis stream for {} article IDs", ids.size());

        return analysisEventService.subscribeToAnalysisUpdates(ids)
                .timeout(Duration.ofMinutes(30))
                .onErrorResume(e -> {
                    log.error("Analysis stream error: {}", e.getMessage());
                    return Flux.just(
                            ServerSentEvent.builder()
                                    .event("error")
                                    .data(Map.of("error", e.getMessage()))
                                    .build()
                    );
                });
    }

    /**
     * 분석 구독 기사 추가
     * 
     * @param articleIds 추가할 기사 ID 목록
     */
    @PostMapping("/analysis/watch")
    public ResponseEntity<Map<String, Object>> watchArticles(@RequestBody List<Long> articleIds) {
        if (articleIds != null && !articleIds.isEmpty()) {
            analysisEventService.watchArticles(new HashSet<>(articleIds));
        }
        return ResponseEntity.ok(Map.of(
                "message", "Articles added to watch list",
                "watchedCount", analysisEventService.getWatchedCount()
        ));
    }

    /**
     * 분석 스트리밍 상태 확인
     */
    @GetMapping("/analysis/stream/status")
    public ResponseEntity<Map<String, Object>> analysisStreamStatus() {
        return ResponseEntity.ok(Map.of(
                "subscriberCount", analysisEventService.getSubscriberCount(),
                "watchedArticleCount", analysisEventService.getWatchedCount()
        ));
    }

    // ============================================
    // Request DTOs
    // ============================================

    public static class DeepAnalysisRequest {
        private String topic;
        private List<String> claims;

        public String getTopic() {
            return topic;
        }

        public void setTopic(String topic) {
            this.topic = topic;
        }

        public List<String> getClaims() {
            return claims;
        }

        public void setClaims(List<String> claims) {
            this.claims = claims;
        }
    }

    public static class SearchJobRequest {
        private String query;
        private String window;
        private List<String> priorityUrls;
        private String startDate;  // ISO 8601 format (e.g., "2024-01-01T00:00:00")
        private String endDate;    // ISO 8601 format (e.g., "2024-01-31T23:59:59")

        public String getQuery() {
            return query;
        }

        public void setQuery(String query) {
            this.query = query;
        }

        public String getWindow() {
            return window;
        }

        public void setWindow(String window) {
            this.window = window;
        }

        public List<String> getPriorityUrls() {
            return priorityUrls;
        }

        public void setPriorityUrls(List<String> priorityUrls) {
            this.priorityUrls = priorityUrls;
        }

        public String getStartDate() {
            return startDate;
        }

        public void setStartDate(String startDate) {
            this.startDate = startDate;
        }

        public String getEndDate() {
            return endDate;
        }

        public void setEndDate(String endDate) {
            this.endDate = endDate;
        }
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/WorkspaceController.java

```java
package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.PageResponse;
import com.newsinsight.collector.entity.workspace.WorkspaceFile;
import com.newsinsight.collector.service.WorkspaceFileService;
import com.newsinsight.collector.service.WorkspaceFileService.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.Resource;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * REST Controller for Workspace File API.
 * Provides endpoints for file upload, download, listing, and deletion.
 */
@RestController
@RequestMapping("/api/v1/workspace/files")
@RequiredArgsConstructor
@Slf4j
public class WorkspaceController {

    private final WorkspaceFileService fileService;

    // ============================================
    // File Upload
    // ============================================

    /**
     * Upload a file.
     * Supports both session-based (anonymous) and user-based uploads.
     */
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<WorkspaceFile> uploadFile(
            @RequestParam("file") MultipartFile file,
            @RequestHeader(value = "X-Session-ID", required = false) String sessionId,
            @RequestParam(value = "userId", required = false) String userId,
            @RequestParam(value = "projectId", required = false) Long projectId,
            @RequestParam(value = "description", required = false) String description
    ) {
        log.info("File upload request: name='{}', size={}, sessionId={}, userId={}",
                file.getOriginalFilename(), file.getSize(), sessionId, userId);

        if (sessionId == null && userId == null) {
            log.warn("Neither sessionId nor userId provided for file upload");
            return ResponseEntity.badRequest().build();
        }

        try {
            UploadRequest request = UploadRequest.builder()
                    .projectId(projectId)
                    .description(description)
                    .build();

            WorkspaceFile uploaded;
            if (userId != null) {
                uploaded = fileService.uploadFileForUser(file, userId, request);
            } else {
                uploaded = fileService.uploadFile(file, sessionId, request);
            }

            return ResponseEntity.status(HttpStatus.CREATED).body(uploaded);

        } catch (IllegalArgumentException e) {
            log.warn("Invalid upload request: {}", e.getMessage());
            return ResponseEntity.badRequest().build();
        } catch (IllegalStateException e) {
            log.warn("Upload denied: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        } catch (Exception e) {
            log.error("File upload failed", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * Upload multiple files.
     */
    @PostMapping(value = "/batch", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<List<WorkspaceFile>> uploadFiles(
            @RequestParam("files") MultipartFile[] files,
            @RequestHeader(value = "X-Session-ID", required = false) String sessionId,
            @RequestParam(value = "userId", required = false) String userId,
            @RequestParam(value = "projectId", required = false) Long projectId
    ) {
        log.info("Batch upload request: {} files, sessionId={}, userId={}", files.length, sessionId, userId);

        if (sessionId == null && userId == null) {
            return ResponseEntity.badRequest().build();
        }

        try {
            UploadRequest request = UploadRequest.builder()
                    .projectId(projectId)
                    .build();

            List<WorkspaceFile> uploaded = java.util.Arrays.stream(files)
                    .map(file -> {
                        if (userId != null) {
                            return fileService.uploadFileForUser(file, userId, request);
                        } else {
                            return fileService.uploadFile(file, sessionId, request);
                        }
                    })
                    .toList();

            return ResponseEntity.status(HttpStatus.CREATED).body(uploaded);

        } catch (Exception e) {
            log.error("Batch upload failed", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    // ============================================
    // File Download
    // ============================================

    /**
     * Download a file by UUID.
     */
    @GetMapping("/{fileUuid}/download")
    public ResponseEntity<Resource> downloadFile(
            @PathVariable String fileUuid,
            @RequestHeader(value = "X-Session-ID", required = false) String sessionId,
            @RequestParam(value = "userId", required = false) String userId
    ) {
        log.info("File download request: uuid={}, sessionId={}, userId={}", fileUuid, sessionId, userId);

        try {
            FileDownloadResponse download = fileService.getFileForDownload(fileUuid, sessionId, userId);

            String encodedFilename = URLEncoder.encode(download.getFilename(), StandardCharsets.UTF_8)
                    .replace("+", "%20");

            return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType(
                            download.getContentType() != null ? download.getContentType() : "application/octet-stream"))
                    .contentLength(download.getFileSize())
                    .header(HttpHeaders.CONTENT_DISPOSITION, 
                            "attachment; filename=\"" + encodedFilename + "\"; filename*=UTF-8''" + encodedFilename)
                    .body(download.getResource());

        } catch (IllegalArgumentException e) {
            log.warn("File not found: {}", fileUuid);
            return ResponseEntity.notFound().build();
        } catch (IllegalStateException e) {
            log.warn("Access denied to file: {}", fileUuid);
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        } catch (Exception e) {
            log.error("File download failed", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * Get file metadata by UUID.
     */
    @GetMapping("/{fileUuid}")
    public ResponseEntity<WorkspaceFile> getFile(
            @PathVariable String fileUuid,
            @RequestHeader(value = "X-Session-ID", required = false) String sessionId,
            @RequestParam(value = "userId", required = false) String userId
    ) {
        return fileService.getFileWithAccess(fileUuid, sessionId, userId)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    // ============================================
    // File Listing
    // ============================================

    /**
     * List files for current session/user.
     */
    @GetMapping
    public ResponseEntity<PageResponse<WorkspaceFile>> listFiles(
            @RequestHeader(value = "X-Session-ID", required = false) String sessionId,
            @RequestParam(value = "userId", required = false) String userId,
            @RequestParam(value = "projectId", required = false) Long projectId,
            @RequestParam(value = "type", required = false) String fileType,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        log.debug("List files request: sessionId={}, userId={}, projectId={}, type={}", 
                sessionId, userId, projectId, fileType);

        Page<WorkspaceFile> result;

        if (projectId != null) {
            result = fileService.listFilesForProject(projectId, page, size);
        } else if (userId != null) {
            if (fileType != null) {
                WorkspaceFile.FileType type = WorkspaceFile.FileType.valueOf(fileType.toUpperCase());
                result = fileService.listFilesByTypeForSession(userId, type, page, size);
            } else {
                result = fileService.listFilesForUser(userId, page, size);
            }
        } else if (sessionId != null) {
            if (fileType != null) {
                WorkspaceFile.FileType type = WorkspaceFile.FileType.valueOf(fileType.toUpperCase());
                result = fileService.listFilesByTypeForSession(sessionId, type, page, size);
            } else {
                result = fileService.listFilesForSession(sessionId, page, size);
            }
        } else {
            return ResponseEntity.badRequest().build();
        }

        return ResponseEntity.ok(PageResponse.from(result));
    }

    /**
     * Search files by name.
     */
    @GetMapping("/search")
    public ResponseEntity<PageResponse<WorkspaceFile>> searchFiles(
            @RequestParam String q,
            @RequestHeader(value = "X-Session-ID", required = false) String sessionId,
            @RequestParam(value = "userId", required = false) String userId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        Page<WorkspaceFile> result;

        if (userId != null) {
            result = fileService.searchFilesForUser(userId, q, page, size);
        } else if (sessionId != null) {
            result = fileService.searchFilesForSession(sessionId, q, page, size);
        } else {
            return ResponseEntity.badRequest().build();
        }

        return ResponseEntity.ok(PageResponse.from(result));
    }

    // ============================================
    // File Deletion
    // ============================================

    /**
     * Delete a file.
     */
    @DeleteMapping("/{fileUuid}")
    public ResponseEntity<Void> deleteFile(
            @PathVariable String fileUuid,
            @RequestHeader(value = "X-Session-ID", required = false) String sessionId,
            @RequestParam(value = "userId", required = false) String userId
    ) {
        log.info("File delete request: uuid={}, sessionId={}, userId={}", fileUuid, sessionId, userId);

        try {
            fileService.deleteFile(fileUuid, sessionId, userId);
            return ResponseEntity.noContent().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
    }

    /**
     * Delete all files for session (for cleanup).
     */
    @DeleteMapping("/session/{sessionId}")
    public ResponseEntity<Void> deleteAllSessionFiles(@PathVariable String sessionId) {
        log.info("Delete all files for session: {}", sessionId);
        fileService.deleteAllFilesForSession(sessionId);
        return ResponseEntity.noContent().build();
    }

    // ============================================
    // File Migration
    // ============================================

    /**
     * Transfer session files to user (when anonymous user logs in).
     */
    @PostMapping("/transfer")
    public ResponseEntity<Map<String, Object>> transferFiles(
            @RequestParam String sessionId,
            @RequestParam String userId
    ) {
        log.info("Transfer files from session {} to user {}", sessionId, userId);

        int count = fileService.transferSessionFilesToUser(sessionId, userId);
        
        return ResponseEntity.ok(Map.of(
                "transferred", count,
                "sessionId", sessionId,
                "userId", userId
        ));
    }

    // ============================================
    // Storage Statistics
    // ============================================

    /**
     * Get storage statistics.
     */
    @GetMapping("/stats")
    public ResponseEntity<StorageStats> getStorageStats(
            @RequestHeader(value = "X-Session-ID", required = false) String sessionId,
            @RequestParam(value = "userId", required = false) String userId
    ) {
        StorageStats stats;

        if (userId != null) {
            stats = fileService.getStorageStatsForUser(userId);
        } else if (sessionId != null) {
            stats = fileService.getStorageStatsForSession(sessionId);
        } else {
            return ResponseEntity.badRequest().build();
        }

        return ResponseEntity.ok(stats);
    }

    // ============================================
    // Admin Operations (Internal)
    // ============================================

    /**
     * Cleanup expired files (should be called by scheduler).
     */
    @PostMapping("/admin/cleanup/expired")
    public ResponseEntity<Map<String, Object>> cleanupExpiredFiles() {
        int count = fileService.cleanupExpiredFiles();
        return ResponseEntity.ok(Map.of("markedForDeletion", count));
    }

    /**
     * Cleanup old session files.
     */
    @PostMapping("/admin/cleanup/sessions")
    public ResponseEntity<Map<String, Object>> cleanupOldSessionFiles(
            @RequestParam(defaultValue = "48") int olderThanHours
    ) {
        int count = fileService.cleanupOldSessionFiles(olderThanHours);
        return ResponseEntity.ok(Map.of("markedForDeletion", count));
    }

    /**
     * Purge deleted files permanently.
     */
    @PostMapping("/admin/purge")
    public ResponseEntity<Map<String, Object>> purgeDeletedFiles() {
        int count = fileService.purgeDeletedFiles();
        return ResponseEntity.ok(Map.of("purged", count));
    }

    // ============================================
    // Health Check
    // ============================================

    /**
     * Health check endpoint.
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        return ResponseEntity.ok(Map.of(
                "status", "available",
                "features", Map.of(
                        "upload", true,
                        "download", true,
                        "delete", true,
                        "search", true,
                        "transfer", true
                )
        ));
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/AiJobDto.java

```java
package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;

/**
 * DTO for AI Job response (includes sub-tasks status).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiJobDto {
    private String jobId;
    private String topic;
    private String baseUrl;
    private String overallStatus;
    private List<AiSubTaskDto> subTasks;
    private int totalTasks;
    private int completedTasks;
    private int failedTasks;
    private String errorMessage;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private LocalDateTime completedAt;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/AiRequestMessage.java

```java
package com.newsinsight.collector.dto;

import java.util.Map;

public record AiRequestMessage(
        String requestId,
        String type,
        String query,
        String window,
        String message,
        Map<String, Object> context,
        String providerId,
        String modelId,
        String agentRole,
        String outputSchema,
        String source
) {
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/AiResponseMessage.java

```java
package com.newsinsight.collector.dto;

import java.util.Map;

public record AiResponseMessage(
        String requestId,
        String status,
        String completedAt,
        String providerId,
        String modelId,
        String text,
        Map<String, Object> raw
) {
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/AiSubTaskDto.java

```java
package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * DTO for AI Sub-Task response.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiSubTaskDto {
    private String subTaskId;
    private String jobId;
    private String providerId;
    private String taskType;
    private String status;
    private String resultJson;
    private String errorMessage;
    private int retryCount;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private LocalDateTime completedAt;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/AiTaskCallbackRequest.java

```java
package com.newsinsight.collector.dto;

import java.util.List;

/**
 * Callback request payload from AI worker/n8n.
 * Received at /api/v1/ai/callback endpoint.
 */
public record AiTaskCallbackRequest(
        /**
         * Parent job ID
         */
        String jobId,

        /**
         * Individual sub-task ID
         */
        String subTaskId,

        /**
         * AI provider identifier
         */
        String providerId,

        /**
         * Task completion status (COMPLETED, FAILED, etc.)
         */
        String status,

        /**
         * JSON result data from the AI task
         */
        String resultJson,

        /**
         * Error message if task failed
         */
        String errorMessage,

        /**
         * Callback authentication token
         */
        String callbackToken,

        /**
         * Evidence list (for DEEP_READER provider)
         */
        List<EvidenceDto> evidence
) {
    /**
     * Check if the callback indicates success
     */
    public boolean isSuccess() {
        return "COMPLETED".equalsIgnoreCase(status) || "completed".equalsIgnoreCase(status);
    }

    /**
     * Check if the callback indicates failure
     */
    public boolean isFailed() {
        return "FAILED".equalsIgnoreCase(status) || "failed".equalsIgnoreCase(status);
    }

    /**
     * Create a builder for AiTaskCallbackRequest
     */
    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private String jobId;
        private String subTaskId;
        private String providerId;
        private String status;
        private String resultJson;
        private String errorMessage;
        private String callbackToken;
        private List<EvidenceDto> evidence;

        public Builder jobId(String jobId) {
            this.jobId = jobId;
            return this;
        }

        public Builder subTaskId(String subTaskId) {
            this.subTaskId = subTaskId;
            return this;
        }

        public Builder providerId(String providerId) {
            this.providerId = providerId;
            return this;
        }

        public Builder status(String status) {
            this.status = status;
            return this;
        }

        public Builder resultJson(String resultJson) {
            this.resultJson = resultJson;
            return this;
        }

        public Builder errorMessage(String errorMessage) {
            this.errorMessage = errorMessage;
            return this;
        }

        public Builder callbackToken(String callbackToken) {
            this.callbackToken = callbackToken;
            return this;
        }

        public Builder evidence(List<EvidenceDto> evidence) {
            this.evidence = evidence;
            return this;
        }

        public AiTaskCallbackRequest build() {
            return new AiTaskCallbackRequest(
                    jobId, subTaskId, providerId, status,
                    resultJson, errorMessage, callbackToken, evidence
            );
        }
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/AiTaskRequestMessage.java

```java
package com.newsinsight.collector.dto;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Kafka message for AI task requests.
 * Sent to ai.tasks.requests topic for worker/n8n processing.
 */
public record AiTaskRequestMessage(
        /**
         * Parent job ID
         */
        String jobId,

        /**
         * Individual sub-task ID
         */
        String subTaskId,

        /**
         * AI provider identifier (UNIVERSAL_AGENT, DEEP_READER, SCOUT, etc.)
         */
        String providerId,

        /**
         * Type of task to perform
         */
        String taskType,

        /**
         * Search topic/query
         */
        String topic,

        /**
         * Base URL for crawling (optional)
         */
        String baseUrl,

        /**
         * Additional payload data for the provider
         */
        Map<String, Object> payload,

        /**
         * URL for callback after task completion
         */
        String callbackUrl,

        /**
         * Token for callback authentication
         */
        String callbackToken,

        /**
         * Message creation timestamp
         */
        LocalDateTime createdAt
) {
    /**
     * Create a builder for AiTaskRequestMessage
     */
    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private String jobId;
        private String subTaskId;
        private String providerId;
        private String taskType;
        private String topic;
        private String baseUrl;
        private Map<String, Object> payload;
        private String callbackUrl;
        private String callbackToken;
        private LocalDateTime createdAt;

        public Builder jobId(String jobId) {
            this.jobId = jobId;
            return this;
        }

        public Builder subTaskId(String subTaskId) {
            this.subTaskId = subTaskId;
            return this;
        }

        public Builder providerId(String providerId) {
            this.providerId = providerId;
            return this;
        }

        public Builder taskType(String taskType) {
            this.taskType = taskType;
            return this;
        }

        public Builder topic(String topic) {
            this.topic = topic;
            return this;
        }

        public Builder baseUrl(String baseUrl) {
            this.baseUrl = baseUrl;
            return this;
        }

        public Builder payload(Map<String, Object> payload) {
            this.payload = payload;
            return this;
        }

        public Builder callbackUrl(String callbackUrl) {
            this.callbackUrl = callbackUrl;
            return this;
        }

        public Builder callbackToken(String callbackToken) {
            this.callbackToken = callbackToken;
            return this;
        }

        public Builder createdAt(LocalDateTime createdAt) {
            this.createdAt = createdAt;
            return this;
        }

        public AiTaskRequestMessage build() {
            return new AiTaskRequestMessage(
                    jobId, subTaskId, providerId, taskType, topic, baseUrl,
                    payload, callbackUrl, callbackToken,
                    createdAt != null ? createdAt : LocalDateTime.now()
            );
        }
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/AnalysisResponseDto.java

```java
package com.newsinsight.collector.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

public record AnalysisResponseDto(
        String query,
        String window,
        @JsonProperty("article_count") long articleCount,
        SentimentDataDto sentiments,
        @JsonProperty("top_keywords") List<KeywordDataDto> topKeywords,
        @JsonProperty("analyzed_at") String analyzedAt
) {}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/ArticleDto.java

```java
package com.newsinsight.collector.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public record ArticleDto(
        String id,
        String title,
        String source,
        @JsonProperty("published_at") String publishedAt,
        String url,
        String snippet,
        String content  // 전체 본문 (export/저장용)
) {}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/ArticleWithAnalysisDto.java

```java
package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.analysis.ArticleAnalysis;
import com.newsinsight.collector.entity.analysis.ArticleDiscussion;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 검색 결과에 분석 정보를 포함한 DTO.
 * 
 * 프론트엔드가 검색 결과를 표시할 때 사용.
 * 분석이 완료되지 않은 경우 null로 표시하여 skeleton UI 렌더링 유도.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ArticleWithAnalysisDto {

    // ========== 기본 기사 정보 ==========
    private Long id;
    private String title;
    private String content;
    private String url;
    private String source;
    private LocalDateTime publishedDate;
    private LocalDateTime collectedAt;

    // ========== 분석 상태 ==========
    /**
     * 분석 완료 여부 (true면 analysis 필드 사용 가능)
     */
    private Boolean analyzed;
    
    /**
     * 분석 진행 상태 (pending, partial, complete)
     */
    private String analysisStatus;

    // ========== 요약 정보 (간략 표시용) ==========
    /**
     * AI 생성 요약 (1-2문장)
     */
    private String summary;

    // ========== 신뢰도 배지 ==========
    /**
     * 신뢰도 점수 (0-100)
     */
    private Double reliabilityScore;
    
    /**
     * 신뢰도 등급 (high, medium, low)
     */
    private String reliabilityGrade;
    
    /**
     * 신뢰도 색상 코드 (green, yellow, red)
     */
    private String reliabilityColor;

    // ========== 감정 분석 ==========
    /**
     * 감정 레이블 (positive, negative, neutral)
     */
    private String sentimentLabel;
    
    /**
     * 감정 점수 (-1 ~ 1)
     */
    private Double sentimentScore;
    
    /**
     * 감정 분포 (긍정/부정/중립 비율)
     */
    private Map<String, Double> sentimentDistribution;

    // ========== 편향도 ==========
    /**
     * 편향 레이블 (left, right, center 등)
     */
    private String biasLabel;
    
    /**
     * 편향 점수 (-1 ~ 1)
     */
    private Double biasScore;

    // ========== 팩트체크 ==========
    /**
     * 팩트체크 상태 (verified, suspicious, conflicting, unverified)
     */
    private String factcheckStatus;
    
    /**
     * 허위정보 위험도 (low, mid, high)
     */
    private String misinfoRisk;

    // ========== 위험 태그 ==========
    /**
     * 경고 태그 목록 (clickbait, sensational 등)
     */
    private List<String> riskTags;

    // ========== 토픽/키워드 ==========
    /**
     * 주요 토픽
     */
    private List<String> topics;

    // ========== 커뮤니티 여론 요약 ==========
    /**
     * 여론 있음 여부
     */
    private Boolean hasDiscussion;
    
    /**
     * 전체 댓글 수
     */
    private Integer totalCommentCount;
    
    /**
     * 전체 여론 감정 (positive, negative, neutral, mixed)
     */
    private String discussionSentiment;
    
    /**
     * 여론 감정 분포
     */
    private Map<String, Double> discussionSentimentDistribution;
    
    /**
     * 여론 요약 문장
     */
    private String discussionSummary;

    // ========== 정적 팩토리 메서드 ==========

    /**
     * 분석 결과가 없는 기사용
     */
    public static ArticleWithAnalysisDto fromArticleOnly(
            Long id, String title, String content, String url, 
            String source, LocalDateTime publishedDate, LocalDateTime collectedAt
    ) {
        return ArticleWithAnalysisDto.builder()
                .id(id)
                .title(title)
                .content(content)
                .url(url)
                .source(source)
                .publishedDate(publishedDate)
                .collectedAt(collectedAt)
                .analyzed(false)
                .analysisStatus("pending")
                .build();
    }

    /**
     * 분석 결과 포함
     */
    public static ArticleWithAnalysisDto fromArticleWithAnalysis(
            Long id, String title, String content, String url,
            String source, LocalDateTime publishedDate, LocalDateTime collectedAt,
            ArticleAnalysis analysis, ArticleDiscussion discussion
    ) {
        ArticleWithAnalysisDtoBuilder builder = ArticleWithAnalysisDto.builder()
                .id(id)
                .title(title)
                .content(content)
                .url(url)
                .source(source)
                .publishedDate(publishedDate)
                .collectedAt(collectedAt);

        if (analysis != null) {
            builder.analyzed(true)
                    .analysisStatus(analysis.getFullyAnalyzed() ? "complete" : "partial")
                    .summary(analysis.getSummary())
                    .reliabilityScore(analysis.getReliabilityScore())
                    .reliabilityGrade(analysis.getReliabilityGrade())
                    .reliabilityColor(analysis.getReliabilityColor())
                    .sentimentLabel(analysis.getSentimentLabel())
                    .sentimentScore(analysis.getSentimentScore())
                    .sentimentDistribution(analysis.getSentimentDistribution())
                    .biasLabel(analysis.getBiasLabel())
                    .biasScore(analysis.getBiasScore())
                    .factcheckStatus(analysis.getFactcheckStatus())
                    .misinfoRisk(analysis.getMisinfoRisk())
                    .riskTags(analysis.getRiskTags())
                    .topics(analysis.getTopics());
        } else {
            builder.analyzed(false)
                    .analysisStatus("pending");
        }

        if (discussion != null) {
            builder.hasDiscussion(true)
                    .totalCommentCount(discussion.getTotalCommentCount())
                    .discussionSentiment(discussion.getOverallSentiment())
                    .discussionSentimentDistribution(discussion.getSentimentDistribution())
                    .discussionSummary(discussion.getSentimentSummary());
        } else {
            builder.hasDiscussion(false);
        }

        return builder.build();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/ArticlesResponseDto.java

```java
package com.newsinsight.collector.dto;

import java.util.List;

public record ArticlesResponseDto(
        String query,
        List<ArticleDto> articles,
        long total
) {}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/BrowserAgentConfigDto.java

```java
package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.BrowserAgentConfig;
import com.newsinsight.collector.entity.BrowserAgentPolicy;

/**
 * DTO for browser agent configuration in API requests/responses.
 */
public record BrowserAgentConfigDto(
        Integer maxDepth,
        Integer maxPages,
        Integer budgetSeconds,
        String policy,
        String focusKeywords,
        String customPrompt,
        Boolean captureScreenshots,
        Boolean extractStructured,
        String excludedDomains
) {
    /**
     * Convert to entity.
     */
    public BrowserAgentConfig toEntity() {
        return BrowserAgentConfig.builder()
                .maxDepth(maxDepth != null ? maxDepth : 2)
                .maxPages(maxPages != null ? maxPages : 50)
                .budgetSeconds(budgetSeconds != null ? budgetSeconds : 300)
                .policy(policy != null ? BrowserAgentPolicy.fromValue(policy) : BrowserAgentPolicy.FOCUSED_TOPIC)
                .focusKeywords(focusKeywords)
                .customPrompt(customPrompt)
                .captureScreenshots(captureScreenshots != null ? captureScreenshots : false)
                .extractStructured(extractStructured != null ? extractStructured : true)
                .excludedDomains(excludedDomains)
                .build();
    }

    /**
     * Create from entity.
     */
    public static BrowserAgentConfigDto fromEntity(BrowserAgentConfig config) {
        if (config == null) {
            return null;
        }
        return new BrowserAgentConfigDto(
                config.getMaxDepth(),
                config.getMaxPages(),
                config.getBudgetSeconds(),
                config.getPolicy() != null ? config.getPolicy().getValue() : null,
                config.getFocusKeywords(),
                config.getCustomPrompt(),
                config.getCaptureScreenshots(),
                config.getExtractStructured(),
                config.getExcludedDomains()
        );
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/BrowserTaskMessage.java

```java
package com.newsinsight.collector.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Builder;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Kafka message for browser-based autonomous crawling tasks.
 * Consumed by autonomous-crawler-service (Python/Browser-use).
 */
@Builder
public record BrowserTaskMessage(
        /**
         * Unique job ID for tracking.
         */
        Long jobId,
        
        /**
         * Data source ID.
         */
        Long sourceId,
        
        /**
         * Source name for logging/display.
         */
        String sourceName,
        
        /**
         * Seed URL to start exploration from.
         */
        String seedUrl,
        
        /**
         * Maximum link traversal depth.
         */
        Integer maxDepth,
        
        /**
         * Maximum pages to visit.
         */
        Integer maxPages,
        
        /**
         * Time budget in seconds.
         */
        Integer budgetSeconds,
        
        /**
         * Exploration policy (focused_topic, domain_wide, news_only, etc.)
         */
        String policy,
        
        /**
         * Focus keywords for FOCUSED_TOPIC policy.
         */
        String focusKeywords,
        
        /**
         * Custom prompt/instructions for AI agent.
         */
        String customPrompt,
        
        /**
         * Whether to capture screenshots.
         */
        Boolean captureScreenshots,
        
        /**
         * Whether to extract structured data.
         */
        Boolean extractStructured,
        
        /**
         * Domains to exclude.
         */
        String excludedDomains,
        
        /**
         * Callback URL for session completion notification.
         */
        String callbackUrl,
        
        /**
         * Callback authentication token.
         */
        String callbackToken,
        
        /**
         * Additional metadata.
         */
        Map<String, Object> metadata,
        
        /**
         * Task creation timestamp.
         * Serialized as ISO-8601 string for Python compatibility.
         */
        @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss")
        LocalDateTime createdAt
) {
    public BrowserTaskMessage {
        createdAt = createdAt != null ? createdAt : LocalDateTime.now();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/ClaimExtractionRequest.java

```java
package com.newsinsight.collector.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for extracting claims from a URL
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ClaimExtractionRequest {
    
    @NotBlank(message = "URL is required")
    private String url;
    
    /** Optional: Maximum number of claims to extract */
    private Integer maxClaims;
    
    /** Optional: Minimum confidence threshold (0.0 - 1.0) */
    private Double minConfidence;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/ClaimExtractionResponse.java

```java
package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Response DTO for claim extraction
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ClaimExtractionResponse {
    
    /** The URL that was analyzed */
    private String url;
    
    /** Title of the page */
    private String pageTitle;
    
    /** List of extracted claims */
    private List<ExtractedClaim> claims;
    
    /** Processing time in milliseconds */
    private Long processingTimeMs;
    
    /** Source of extraction (e.g., "crawl4ai", "direct", "browser-use") */
    private String extractionSource;
    
    /** Any warning or info messages */
    private String message;
    
    /**
     * Individual claim extracted from the content
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ExtractedClaim {
        /** Unique identifier for the claim */
        private String id;
        
        /** The claim text */
        private String text;
        
        /** Confidence score (0.0 - 1.0) */
        private Double confidence;
        
        /** Context where the claim was found */
        private String context;
        
        /** Type of claim: factual, opinion, prediction, etc. */
        private String claimType;
        
        /** Whether this claim is verifiable */
        private Boolean verifiable;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/CollectedDataDTO.java

```java
package com.newsinsight.collector.dto;

import java.time.LocalDateTime;
import java.util.Map;

public record CollectedDataDTO(
        Long id,
        Long sourceId,
        String title,
        String content,
        String url,
        LocalDateTime publishedDate,
        LocalDateTime collectedAt,
        String contentHash,
        Map<String, Object> metadata,
        Boolean processed
) {
    public CollectedDataDTO {
        /**
         * Map.copyOf()는 원본 맵의 '읽기 전용 복사본'을 만듭니다.
         * 이로써 이 record는 외부의 어떤 변경에도 영향을 받지 않는
         * 완전한 불변 객체로써 동작합니다.
         */
        metadata = metadata == null ? Map.of() : Map.copyOf(metadata);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/CollectionJobDTO.java

```java
package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.CollectionJob.JobStatus;

import java.time.LocalDateTime;

public record CollectionJobDTO(
        Long id,
        Long sourceId,
        JobStatus status,
        LocalDateTime startedAt,
        LocalDateTime completedAt,
        Integer itemsCollected,
        String errorMessage,
        LocalDateTime createdAt
) {}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/CollectionRequest.java

```java
package com.newsinsight.collector.dto;

import java.util.List;

public record CollectionRequest(List<Long> sourceIds, boolean force) {
    public CollectionRequest {
        sourceIds = sourceIds == null ? List.of() : List.copyOf(sourceIds);
    }

    public CollectionRequest(List<Long> sourceIds) {
        this(sourceIds, false);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/CollectionResponse.java

```java
package com.newsinsight.collector.dto;

import java.time.LocalDateTime;
import java.util.List;

public record CollectionResponse(
        String message,
        List<CollectionJobDTO> jobs,
        Integer totalJobsStarted,
        LocalDateTime timestamp
) {
    public CollectionResponse {
        jobs = jobs == null ? List.of() : List.copyOf(jobs);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/CollectionStatsDTO.java

```java
package com.newsinsight.collector.dto;

import java.time.LocalDateTime;

public record CollectionStatsDTO(
        Long totalSources,
        Long activeSources,
        Long totalItemsCollected,
        Long itemsCollectedToday,
        LocalDateTime lastCollection
) {}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/CrawlCommandMessage.java

```java
package com.newsinsight.collector.dto;

public record CrawlCommandMessage(
        Long jobId,
        Long sourceId,
        String sourceType,
        String url,
        String sourceName
) {
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/CrawlResultMessage.java

```java
package com.newsinsight.collector.dto;

public record CrawlResultMessage(
        Long jobId,
        Long sourceId,
        String title,
        String content,
        String url,
        String publishedAt,
        String metadataJson
) {
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/CrawledPage.java

```java
package com.newsinsight.collector.dto;

import java.util.List;

/**
 * DTO representing a crawled web page
 * Used by IntegratedCrawlerService to pass crawl results
 */
public record CrawledPage(
        String url,
        String title,
        String content,
        String source,  // e.g., "crawl4ai", "browser-use", "direct"
        List<String> links
) {
    /**
     * Create a CrawledPage with no extracted links
     */
    public static CrawledPage of(String url, String title, String content, String source) {
        return new CrawledPage(url, title, content, source, List.of());
    }

    /**
     * Check if this page has valid content
     */
    public boolean hasContent() {
        return content != null && !content.isBlank();
    }

    /**
     * Get a truncated snippet of the content
     */
    public String getSnippet(int maxLength) {
        if (content == null) return "";
        if (content.length() <= maxLength) return content;
        return content.substring(0, maxLength) + "...";
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/DashboardEventDto.java

```java
package com.newsinsight.collector.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.Map;

/**
 * 대시보드 실시간 이벤트 DTO.
 * SSE를 통해 클라이언트에 전송되는 이벤트 데이터를 담습니다.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class DashboardEventDto {

    /**
     * 이벤트 타입
     */
    private EventType eventType;

    /**
     * 이벤트 발생 시각
     */
    @Builder.Default
    private Instant timestamp = Instant.now();

    /**
     * 이벤트 메시지
     */
    private String message;

    /**
     * 추가 데이터 (이벤트 타입에 따라 다름)
     */
    private Map<String, Object> data;

    /**
     * 이벤트 타입 열거형
     */
    public enum EventType {
        HEARTBEAT,      // 연결 유지용 하트비트
        NEW_DATA,       // 새로운 데이터 수집됨
        SOURCE_UPDATED, // 소스 상태 변경
        STATS_UPDATED,  // 통계 갱신
        COLLECTION_STARTED,  // 수집 시작
        COLLECTION_COMPLETED, // 수집 완료
        ERROR           // 에러 발생
    }

    /**
     * 하트비트 이벤트 생성
     */
    public static DashboardEventDto heartbeat() {
        return DashboardEventDto.builder()
                .eventType(EventType.HEARTBEAT)
                .message("Connection alive")
                .build();
    }

    /**
     * 새 데이터 수집 이벤트 생성
     */
    public static DashboardEventDto newData(String message, Map<String, Object> data) {
        return DashboardEventDto.builder()
                .eventType(EventType.NEW_DATA)
                .message(message)
                .data(data)
                .build();
    }

    /**
     * 통계 갱신 이벤트 생성
     */
    public static DashboardEventDto statsUpdated(Map<String, Object> stats) {
        return DashboardEventDto.builder()
                .eventType(EventType.STATS_UPDATED)
                .message("Statistics updated")
                .data(stats)
                .build();
    }

    /**
     * 소스 업데이트 이벤트 생성
     */
    public static DashboardEventDto sourceUpdated(String sourceId, String status) {
        return DashboardEventDto.builder()
                .eventType(EventType.SOURCE_UPDATED)
                .message("Source " + sourceId + " status changed to " + status)
                .data(Map.of("sourceId", sourceId, "status", status))
                .build();
    }

    /**
     * 에러 이벤트 생성
     */
    public static DashboardEventDto error(String message) {
        return DashboardEventDto.builder()
                .eventType(EventType.ERROR)
                .message(message)
                .build();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/DataSourceCreateRequest.java

```java
package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.SourceType;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.Map;

public record DataSourceCreateRequest(
        @NotBlank(message = "Name is required") String name,
        @NotBlank(message = "URL is required") String url,
        @NotNull(message = "Source type is required") SourceType sourceType,
        @Min(value = 60, message = "Collection frequency must be at least 60 seconds") Integer collectionFrequency,
        Map<String, Object> metadata,
        BrowserAgentConfigDto browserAgentConfig
) {
    public DataSourceCreateRequest {
        collectionFrequency = collectionFrequency == null ? 3600 : collectionFrequency;
        metadata = metadata == null ? Map.of() : Map.copyOf(metadata);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/DataSourceDTO.java

```java
package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.SourceType;

import java.time.LocalDateTime;
import java.util.Map;

public record DataSourceDTO(
        Long id,
        String name,
        String url,
        SourceType sourceType,
        Boolean isActive,
        LocalDateTime lastCollected,
        Integer collectionFrequency,
        Map<String, Object> metadata,
        LocalDateTime createdAt,
        LocalDateTime updatedAt,
        BrowserAgentConfigDto browserAgentConfig
) {
    public DataSourceDTO {
        metadata = metadata == null ? Map.of() : Map.copyOf(metadata);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/DataSourceUpdateRequest.java

```java
package com.newsinsight.collector.dto;

import jakarta.validation.constraints.Min;

import java.util.Map;

public record DataSourceUpdateRequest(
        String name,
        String url,
        Boolean isActive,
        @Min(value = 60, message = "Collection frequency must be at least 60 seconds") Integer collectionFrequency,
        Map<String, Object> metadata,
        BrowserAgentConfigDto browserAgentConfig
) {
    public DataSourceUpdateRequest {
        metadata = metadata == null ? Map.of() : Map.copyOf(metadata);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/DeepSearchCallbackDto.java

```java
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

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/DeepSearchJobDto.java

```java
package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * DTO for deep search job status
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DeepSearchJobDto {
    private String jobId;
    private String topic;
    private String baseUrl;
    private String status;
    private Integer evidenceCount;
    private String errorMessage;
    private String failureReason;      // Code like "timeout_job_overall"
    private String failureCategory;     // High-level category like "timeout", "network", "service"
    private LocalDateTime createdAt;
    private LocalDateTime completedAt;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/DeepSearchRequest.java

```java
package com.newsinsight.collector.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for starting a deep search
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DeepSearchRequest {
    
    @NotBlank(message = "Topic is required")
    private String topic;
    
    /**
     * Optional base URL to start crawling from.
     * If not provided, a default news aggregator will be used.
     */
    private String baseUrl;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/DeepSearchResultDto.java

```java
package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;

/**
 * DTO for deep search result including evidence
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DeepSearchResultDto {
    private String jobId;
    private String topic;
    private String baseUrl;
    private String status;
    private Integer evidenceCount;
    private List<EvidenceDto> evidence;
    private StanceDistributionDto stanceDistribution;
    private LocalDateTime createdAt;
    private LocalDateTime completedAt;
    private String errorMessage;
    private String failureReason;      // Code like "timeout_job_overall"
    private String failureCategory;     // High-level category like "timeout", "network", "service"
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/EvidenceDto.java

```java
package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * DTO for evidence item from deep search
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EvidenceDto {
    private Long id;
    private String url;
    private String title;
    private String stance;  // pro, con, neutral
    private String snippet;
    private String source;
    private String sourceCategory;  // news, community, blog, official, academic
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/KeywordDataDto.java

```java
package com.newsinsight.collector.dto;

public record KeywordDataDto(String word, double score) {}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/PageResponse.java

```java
package com.newsinsight.collector.dto;

import java.util.List;
import java.util.Objects;

import org.springframework.data.domain.Page;

public record PageResponse<T>(
        List<T> content,
        int page,
        int size,
        long totalElements,
        int totalPages,
        boolean first,
        boolean last,
        boolean hasNext,
        boolean hasPrevious
) {
    public PageResponse {
        content = content == null ? List.of() : List.copyOf(content);
    }

    public static <T> PageResponse<T> from(Page<T> page) {
        Objects.requireNonNull(page, "page must not be null");
        return new PageResponse<>(
                page.getContent(),
                page.getNumber(),
                page.getSize(),
                page.getTotalElements(),
                page.getTotalPages(),
                page.isFirst(),
                page.isLast(),
                page.hasNext(),
                page.hasPrevious()
        );
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/SearchHistoryDto.java

```java
package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.search.SearchHistory;
import com.newsinsight.collector.entity.search.SearchType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * DTO for SearchHistory API responses.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchHistoryDto {

    private Long id;
    private String externalId;
    private SearchType searchType;
    private String query;
    private String timeWindow;
    private String userId;
    private String sessionId;
    private Long parentSearchId;
    private Integer depthLevel;
    private Integer resultCount;
    private List<Map<String, Object>> results;
    private Map<String, Object> aiSummary;
    private List<String> discoveredUrls;
    private List<Map<String, Object>> factCheckResults;
    private Double credibilityScore;
    private Map<String, Object> stanceDistribution;
    private Map<String, Object> metadata;
    private Boolean bookmarked;
    private List<String> tags;
    private String notes;
    private Long durationMs;
    private String errorMessage;
    private Boolean success;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    /**
     * Convert entity to DTO.
     */
    public static SearchHistoryDto fromEntity(SearchHistory entity) {
        return SearchHistoryDto.builder()
                .id(entity.getId())
                .externalId(entity.getExternalId())
                .searchType(entity.getSearchType())
                .query(entity.getQuery())
                .timeWindow(entity.getTimeWindow())
                .userId(entity.getUserId())
                .sessionId(entity.getSessionId())
                .parentSearchId(entity.getParentSearchId())
                .depthLevel(entity.getDepthLevel())
                .resultCount(entity.getResultCountSafe())
                .results(entity.getResults())
                .aiSummary(entity.getAiSummary())
                .discoveredUrls(entity.getDiscoveredUrls())
                .factCheckResults(entity.getFactCheckResults())
                .credibilityScore(entity.getCredibilityScore())
                .stanceDistribution(entity.getStanceDistribution())
                .metadata(entity.getMetadata())
                .bookmarked(entity.getBookmarked())
                .tags(entity.getTags())
                .notes(entity.getNotes())
                .durationMs(entity.getDurationMs())
                .errorMessage(entity.getErrorMessage())
                .success(entity.getSuccess())
                .createdAt(entity.getCreatedAt())
                .updatedAt(entity.getUpdatedAt())
                .build();
    }

    /**
     * Convert DTO to message for Kafka.
     */
    public SearchHistoryMessage toMessage() {
        return SearchHistoryMessage.builder()
                .externalId(this.externalId)
                .searchType(this.searchType)
                .query(this.query)
                .timeWindow(this.timeWindow)
                .userId(this.userId)
                .sessionId(this.sessionId)
                .parentSearchId(this.parentSearchId)
                .depthLevel(this.depthLevel)
                .resultCount(this.resultCount)
                .results(this.results)
                .aiSummary(this.aiSummary)
                .discoveredUrls(this.discoveredUrls)
                .factCheckResults(this.factCheckResults)
                .credibilityScore(this.credibilityScore)
                .stanceDistribution(this.stanceDistribution)
                .metadata(this.metadata)
                .durationMs(this.durationMs)
                .errorMessage(this.errorMessage)
                .success(this.success)
                .timestamp(System.currentTimeMillis())
                .build();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/SearchHistoryMessage.java

```java
package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.search.SearchType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * Kafka message DTO for search history events.
 * Used for asynchronous search result persistence via Kafka.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchHistoryMessage {

    /**
     * External reference ID (e.g., jobId)
     */
    private String externalId;

    /**
     * Type of search performed
     */
    private SearchType searchType;

    /**
     * The search query or topic
     */
    private String query;

    /**
     * Time window for search (e.g., 1d, 7d, 30d)
     */
    private String timeWindow;

    /**
     * Optional user ID
     */
    private String userId;

    /**
     * Session ID for grouping searches
     */
    private String sessionId;

    /**
     * Parent search ID for derived searches
     */
    private Long parentSearchId;

    /**
     * Depth level for drilldown searches
     */
    @Builder.Default
    private Integer depthLevel = 0;

    /**
     * Total number of results
     */
    @Builder.Default
    private Integer resultCount = 0;

    /**
     * Search results as JSON list
     */
    private List<Map<String, Object>> results;

    /**
     * AI summary/response
     */
    private Map<String, Object> aiSummary;

    /**
     * URLs discovered during search
     */
    private List<String> discoveredUrls;

    /**
     * Fact check results
     */
    private List<Map<String, Object>> factCheckResults;

    /**
     * Overall credibility score (0-100)
     */
    private Double credibilityScore;

    /**
     * Stance distribution
     */
    private Map<String, Object> stanceDistribution;

    /**
     * Additional metadata
     */
    private Map<String, Object> metadata;

    /**
     * Search duration in milliseconds
     */
    private Long durationMs;

    /**
     * Error message if search failed
     */
    private String errorMessage;

    /**
     * Whether the search succeeded
     */
    @Builder.Default
    private Boolean success = true;

    /**
     * Timestamp when search was performed (epoch millis)
     */
    private Long timestamp;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/SearchResultSummaryDto.java

```java
package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * 검색 결과 페이지 전체 요약 DTO.
 * 
 * 검색 결과 상단에 표시되는 종합 분석 정보.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchResultSummaryDto {

    /**
     * 총 검색 결과 수
     */
    private Integer totalResults;

    /**
     * 분석 완료된 결과 수
     */
    private Integer analyzedResults;

    // ========== 주제 요약 ==========
    
    /**
     * 주요 키워드/토픽 (상위 5개)
     */
    private List<String> mainTopics;

    /**
     * AI 생성 이슈 요약 (1-2문장)
     */
    private String issueSummary;

    /**
     * 상반된 관점 요약
     * [{"view": "찬성측", "summary": "..."}, {"view": "반대측", "summary": "..."}]
     */
    private List<Map<String, String>> contrastingViews;

    // ========== 신뢰도/편향 요약 ==========

    /**
     * 신뢰도 분포
     * {"high": 0.3, "medium": 0.5, "low": 0.2}
     */
    private Map<String, Double> reliabilityDistribution;

    /**
     * 편향도 분포
     * {"left": 0.2, "center": 0.6, "right": 0.2}
     */
    private Map<String, Double> biasDistribution;

    /**
     * 허위정보 위험 기사 비율
     */
    private Double misinfoRiskRatio;

    // ========== 감정 요약 ==========

    /**
     * 전체 기사 감정 분포
     */
    private Map<String, Double> overallSentiment;

    // ========== 여론 요약 ==========

    /**
     * 전체 댓글 수 합계
     */
    private Integer totalCommentCount;

    /**
     * 전체 여론 감정 분포
     */
    private Map<String, Double> overallDiscussionSentiment;

    /**
     * 여론 요약 문장
     */
    private String discussionSummary;

    /**
     * 시간대별 여론 변화 (그래프용)
     */
    private List<Map<String, Object>> discussionTimeSeries;

    // ========== 경고/주의 ==========

    /**
     * 검색 결과 관련 경고 메시지
     */
    private List<String> warnings;

    /**
     * 팩트체크 필요 기사 수
     */
    private Integer factcheckNeededCount;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/SearchTemplateDto.java

```java
package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.search.SearchTemplate;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * DTO for SearchTemplate API requests and responses.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchTemplateDto {

    private Long id;
    private String name;
    private String query;
    private String mode;
    private String userId;
    private List<Map<String, Object>> items;
    private String description;
    private Boolean favorite;
    private List<String> tags;
    private Map<String, Object> metadata;
    private Long sourceSearchId;
    private Integer useCount;
    private LocalDateTime lastUsedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    
    // Computed field
    private Integer itemCount;

    /**
     * Convert entity to DTO
     */
    public static SearchTemplateDto fromEntity(SearchTemplate entity) {
        return SearchTemplateDto.builder()
                .id(entity.getId())
                .name(entity.getName())
                .query(entity.getQuery())
                .mode(entity.getMode())
                .userId(entity.getUserId())
                .items(entity.getItems())
                .description(entity.getDescription())
                .favorite(entity.getFavorite())
                .tags(entity.getTags())
                .metadata(entity.getMetadata())
                .sourceSearchId(entity.getSourceSearchId())
                .useCount(entity.getUseCount())
                .lastUsedAt(entity.getLastUsedAt())
                .createdAt(entity.getCreatedAt())
                .updatedAt(entity.getUpdatedAt())
                .itemCount(entity.getItemCount())
                .build();
    }

    /**
     * Convert DTO to entity for creation
     */
    public SearchTemplate toEntity() {
        return SearchTemplate.builder()
                .name(this.name)
                .query(this.query)
                .mode(this.mode)
                .userId(this.userId)
                .items(this.items)
                .description(this.description)
                .favorite(this.favorite != null ? this.favorite : false)
                .tags(this.tags)
                .metadata(this.metadata)
                .sourceSearchId(this.sourceSearchId)
                .build();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/SentimentDataDto.java

```java
package com.newsinsight.collector.dto;

public record SentimentDataDto(double pos, double neg, double neu) {}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/StanceDistributionDto.java

```java
package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * DTO for stance distribution statistics
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class StanceDistributionDto {
    private Long pro;
    private Long con;
    private Long neutral;
    private Double proRatio;
    private Double conRatio;
    private Double neutralRatio;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/addon/AddonRequest.java

```java
package com.newsinsight.collector.dto.addon;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/**
 * Add-on으로 보내는 분석 요청 DTO.
 * 
 * 모든 Add-on은 이 형식의 요청을 받아서 처리.
 * 내부 서비스, 외부 Colab, 서드파티 API 모두 동일한 스펙 사용.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AddonRequest {

    /**
     * 요청 고유 ID (추적용)
     */
    @JsonProperty("request_id")
    private String requestId;

    /**
     * Add-on 식별자
     */
    @JsonProperty("addon_id")
    private String addonId;

    /**
     * 작업 유형 (article_analysis, comment_analysis, batch_analysis 등)
     */
    @JsonProperty("task")
    private String task;

    /**
     * 입력 스키마 버전
     */
    @JsonProperty("input_schema_version")
    @Builder.Default
    private String inputSchemaVersion = "1.0";

    /**
     * 분석 대상 기사 정보
     */
    @JsonProperty("article")
    private ArticleInput article;

    /**
     * 분석 대상 댓글/커뮤니티 (해당되는 경우)
     */
    @JsonProperty("comments")
    private CommentsInput comments;

    /**
     * 추가 컨텍스트 (언어, 국가, 이전 분석 결과 등)
     */
    @JsonProperty("context")
    private AnalysisContext context;

    /**
     * 실행 옵션
     */
    @JsonProperty("options")
    private ExecutionOptions options;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ArticleInput {
        /**
         * 기사 ID
         */
        private Long id;

        /**
         * 기사 제목
         */
        private String title;

        /**
         * 기사 본문
         */
        private String content;

        /**
         * 기사 URL
         */
        private String url;

        /**
         * 출처/언론사
         */
        private String source;

        /**
         * 발행일시 (ISO 8601)
         */
        @JsonProperty("published_at")
        private String publishedAt;

        /**
         * 추가 메타데이터
         */
        private Map<String, Object> metadata;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class CommentsInput {
        /**
         * 대상 기사 ID
         */
        @JsonProperty("article_id")
        private Long articleId;

        /**
         * 댓글 목록
         */
        private java.util.List<CommentItem> items;

        /**
         * 수집 플랫폼
         */
        private String platform;

        @Data
        @Builder
        @NoArgsConstructor
        @AllArgsConstructor
        public static class CommentItem {
            private String id;
            private String content;
            @JsonProperty("created_at")
            private String createdAt;
            private Integer likes;
            private Integer replies;
            @JsonProperty("author_id")
            private String authorId;
        }
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AnalysisContext {
        /**
         * 언어 코드 (ko, en, ja 등)
         */
        private String language;

        /**
         * 국가 코드
         */
        private String country;

        /**
         * 이전 Add-on들의 분석 결과 (의존성 체인에서 사용)
         */
        @JsonProperty("previous_results")
        private Map<String, Object> previousResults;

        /**
         * 관련 기사 ID들 (교차 검증용)
         */
        @JsonProperty("related_article_ids")
        private java.util.List<Long> relatedArticleIds;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ExecutionOptions {
        /**
         * 중요도 (realtime: 즉시 처리, batch: 배치 처리)
         */
        @Builder.Default
        private String importance = "batch";

        /**
         * 디버그 모드 (상세 로그 포함)
         */
        @Builder.Default
        private Boolean debug = false;

        /**
         * 타임아웃 (ms)
         */
        @JsonProperty("timeout_ms")
        private Integer timeoutMs;

        /**
         * 추가 파라미터
         */
        private Map<String, Object> params;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/addon/AddonResponse.java

```java
package com.newsinsight.collector.dto.addon;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * Add-on이 반환하는 분석 결과 DTO.
 * 
 * 모든 Add-on은 이 형식으로 결과를 반환.
 * Orchestrator가 이를 파싱하여 ArticleAnalysis/ArticleDiscussion에 저장.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AddonResponse {

    /**
     * 요청 ID (추적용)
     */
    @JsonProperty("request_id")
    private String requestId;

    /**
     * Add-on 식별자
     */
    @JsonProperty("addon_id")
    private String addonId;

    /**
     * 처리 상태 (success, error, partial)
     */
    private String status;

    /**
     * 출력 스키마 버전
     */
    @JsonProperty("output_schema_version")
    @Builder.Default
    private String outputSchemaVersion = "1.0";

    /**
     * 분석 결과 (Add-on 카테고리별로 다른 구조)
     */
    private AnalysisResults results;

    /**
     * 에러 정보 (실패 시)
     */
    private ErrorInfo error;

    /**
     * 메타데이터
     */
    private ResponseMeta meta;

    // ========== 결과 구조 ==========

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AnalysisResults {

        // === 감정 분석 (SENTIMENT) ===
        @JsonProperty("sentiment")
        private SentimentResult sentiment;

        // === 신뢰도 분석 (SOURCE_QUALITY) ===
        @JsonProperty("reliability")
        private ReliabilityResult reliability;

        // === 편향도 분석 ===
        @JsonProperty("bias")
        private BiasResult bias;

        // === 팩트체크 (FACTCHECK) ===
        @JsonProperty("factcheck")
        private FactcheckResult factcheck;

        // === 개체명 인식 (ENTITY_EXTRACTION) ===
        @JsonProperty("entities")
        private EntitiesResult entities;

        // === 요약 (SUMMARIZATION) ===
        @JsonProperty("summary")
        private SummaryResult summary;

        // === 주제 분류 (TOPIC_CLASSIFICATION) ===
        @JsonProperty("topics")
        private TopicsResult topics;

        // === 커뮤니티 분석 (COMMUNITY) ===
        @JsonProperty("discussion")
        private DiscussionResult discussion;

        // === 독성 분석 (TOXICITY) ===
        @JsonProperty("toxicity")
        private ToxicityResult toxicity;

        // === 허위정보 탐지 (MISINFORMATION) ===
        @JsonProperty("misinformation")
        private MisinfoResult misinformation;

        // === 원시 결과 (구조화되지 않은 추가 데이터) ===
        @JsonProperty("raw")
        private Map<String, Object> raw;
    }

    // ========== 개별 결과 타입들 ==========

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SentimentResult {
        private Double score; // -1 ~ 1 or 0 ~ 100
        private String label; // positive, negative, neutral
        private Map<String, Double> distribution;
        private Map<String, Double> emotions; // anger, joy, sadness, etc.
        private List<String> explanations;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ReliabilityResult {
        private Double score; // 0 ~ 100
        private String grade; // high, medium, low
        private Map<String, Double> factors;
        private List<String> warnings;
        private List<String> explanations;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class BiasResult {
        private String label; // left, right, center
        private Double score; // -1 ~ 1
        private Map<String, Double> details;
        private List<String> explanations;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class FactcheckResult {
        private String status; // verified, suspicious, conflicting, unverified
        private Double confidence;
        private List<ClaimVerification> claims;
        private List<String> sources;
        private String notes;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ClaimVerification {
        private String claim;
        private Boolean verified;
        private Double confidence;
        private List<String> supportingSources;
        private List<String> conflictingSources;
        private String verdict;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class EntitiesResult {
        private List<Entity> persons;
        private List<Entity> organizations;
        private List<Entity> locations;
        private List<Entity> misc;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Entity {
        private String text;
        private String type;
        private Integer startPos;
        private Integer endPos;
        private Double confidence;
        private Map<String, Object> metadata;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SummaryResult {
        @JsonProperty("abstractive")
        private String abstractiveSummary;
        @JsonProperty("extractive")
        private List<String> extractiveSentences;
        private List<String> keyPoints;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TopicsResult {
        private List<String> labels;
        private Map<String, Double> scores;
        private String primaryTopic;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DiscussionResult {
        @JsonProperty("overall_sentiment")
        private String overallSentiment;
        @JsonProperty("sentiment_distribution")
        private Map<String, Double> sentimentDistribution;
        @JsonProperty("stance_distribution")
        private Map<String, Double> stanceDistribution;
        @JsonProperty("toxicity_score")
        private Double toxicityScore;
        @JsonProperty("top_keywords")
        private List<Map<String, Object>> topKeywords;
        @JsonProperty("time_series")
        private List<Map<String, Object>> timeSeries;
        @JsonProperty("bot_likelihood")
        private Double botLikelihood;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ToxicityResult {
        private Double score;
        private Map<String, Double> categories; // hate, threat, insult, etc.
        private List<String> flaggedPhrases;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class MisinfoResult {
        @JsonProperty("risk_level")
        private String riskLevel; // low, mid, high
        private Double score;
        private List<String> indicators;
        private List<String> explanations;
    }

    // ========== 에러/메타 ==========

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ErrorInfo {
        private String code;
        private String message;
        private String details;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ResponseMeta {
        @JsonProperty("model_version")
        private String modelVersion;

        @JsonProperty("latency_ms")
        private Long latencyMs;

        @JsonProperty("processed_at")
        private String processedAt;

        @JsonProperty("token_usage")
        private Map<String, Integer> tokenUsage;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/llm/LlmProviderSettingsDto.java

```java
package com.newsinsight.collector.dto.llm;

import com.newsinsight.collector.entity.settings.LlmProviderType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * LLM Provider 설정 응답 DTO.
 * API 키는 마스킹되어 반환됨.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LlmProviderSettingsDto {

    private Long id;

    /**
     * Provider 타입
     */
    private LlmProviderType providerType;

    /**
     * Provider 표시명
     */
    private String providerDisplayName;

    /**
     * 사용자 ID (null이면 전역 설정)
     */
    private String userId;

    /**
     * 전역 설정 여부
     */
    private Boolean isGlobal;

    /**
     * 마스킹된 API 키 (예: sk-a***...xyz)
     */
    private String apiKeyMasked;

    /**
     * API 키 존재 여부
     */
    private Boolean hasApiKey;

    /**
     * 기본 모델
     */
    private String defaultModel;

    /**
     * Base URL
     */
    private String baseUrl;

    /**
     * 활성화 여부
     */
    private Boolean enabled;

    /**
     * 우선순위
     */
    private Integer priority;

    /**
     * 최대 토큰
     */
    private Integer maxTokens;

    /**
     * Temperature
     */
    private Double temperature;

    /**
     * 타임아웃 (ms)
     */
    private Integer timeoutMs;

    /**
     * 분당 최대 요청 수
     */
    private Integer maxRequestsPerMinute;

    /**
     * Azure Deployment Name
     */
    private String azureDeploymentName;

    /**
     * Azure API Version
     */
    private String azureApiVersion;

    /**
     * 마지막 테스트 시간
     */
    private LocalDateTime lastTestedAt;

    /**
     * 마지막 테스트 성공 여부
     */
    private Boolean lastTestSuccess;

    /**
     * 생성일시
     */
    private LocalDateTime createdAt;

    /**
     * 수정일시
     */
    private LocalDateTime updatedAt;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/llm/LlmProviderSettingsRequest.java

```java
package com.newsinsight.collector.dto.llm;

import com.newsinsight.collector.entity.settings.LlmProviderType;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * LLM Provider 설정 요청 DTO.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LlmProviderSettingsRequest {

    /**
     * Provider 타입 (필수)
     */
    @NotNull(message = "Provider type is required")
    private LlmProviderType providerType;

    /**
     * API 키
     */
    private String apiKey;

    /**
     * 기본 모델명
     */
    private String defaultModel;

    /**
     * Base URL (커스텀 엔드포인트용)
     */
    private String baseUrl;

    /**
     * 활성화 여부
     */
    private Boolean enabled;

    /**
     * 우선순위 (1-999)
     */
    @Min(value = 1, message = "Priority must be at least 1")
    @Max(value = 999, message = "Priority must be at most 999")
    private Integer priority;

    /**
     * 최대 토큰 수
     */
    @Min(value = 1, message = "Max tokens must be positive")
    @Max(value = 128000, message = "Max tokens must be at most 128000")
    private Integer maxTokens;

    /**
     * Temperature (0.0 ~ 2.0)
     */
    @Min(value = 0, message = "Temperature must be at least 0")
    @Max(value = 2, message = "Temperature must be at most 2")
    private Double temperature;

    /**
     * 요청 타임아웃 (밀리초)
     */
    @Min(value = 1000, message = "Timeout must be at least 1000ms")
    @Max(value = 300000, message = "Timeout must be at most 300000ms")
    private Integer timeoutMs;

    /**
     * 분당 최대 요청 수
     */
    @Min(value = 1, message = "Max requests per minute must be positive")
    private Integer maxRequestsPerMinute;

    /**
     * Azure Deployment Name
     */
    private String azureDeploymentName;

    /**
     * Azure API Version
     */
    private String azureApiVersion;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/llm/LlmTestResult.java

```java
package com.newsinsight.collector.dto.llm;

import com.newsinsight.collector.entity.settings.LlmProviderType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * LLM Provider 연결 테스트 결과 DTO.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LlmTestResult {

    /**
     * 테스트 성공 여부
     */
    private boolean success;

    /**
     * Provider 타입
     */
    private LlmProviderType providerType;

    /**
     * 결과 메시지
     */
    private String message;

    /**
     * 에러 메시지 (실패 시)
     */
    private String error;

    /**
     * 응답 시간 (밀리초)
     */
    private Long responseTime;

    /**
     * 사용 가능한 모델 목록 (성공 시)
     */
    private java.util.List<String> availableModels;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/report/ChartData.java

```java
package com.newsinsight.collector.dto.report;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 차트 데이터 DTO - 서버 사이드 차트 생성용
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ChartData {

    /**
     * 차트 유형
     */
    private ChartType chartType;

    /**
     * 차트 제목
     */
    private String title;

    /**
     * X축 라벨
     */
    private String xAxisLabel;

    /**
     * Y축 라벨
     */
    private String yAxisLabel;

    /**
     * 데이터 라벨 목록
     */
    private List<String> labels;

    /**
     * 데이터 값 목록
     */
    private List<Number> values;

    /**
     * 다중 시리즈 데이터
     */
    private List<DataSeries> series;

    /**
     * 색상 팔레트
     */
    private List<String> colors;

    /**
     * 차트 너비 (픽셀)
     */
    @Builder.Default
    private int width = 600;

    /**
     * 차트 높이 (픽셀)
     */
    @Builder.Default
    private int height = 400;

    /**
     * 차트 유형 Enum
     */
    public enum ChartType {
        PIE,            // 파이 차트
        DOUGHNUT,       // 도넛 차트
        BAR,            // 바 차트
        HORIZONTAL_BAR, // 수평 바 차트
        LINE,           // 라인 차트
        AREA,           // 영역 차트
        RADAR,          // 레이더 차트
        GAUGE,          // 게이지 차트
        STACKED_BAR,    // 스택 바 차트
        HISTOGRAM       // 히스토그램
    }

    /**
     * 데이터 시리즈 (다중 라인/바 차트용)
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DataSeries {
        private String name;
        private List<Number> data;
        private String color;
    }

    // ===== 빌더 헬퍼 메서드 =====

    /**
     * 파이 차트 생성 헬퍼
     */
    public static ChartData pie(String title, List<String> labels, List<Number> values, List<String> colors) {
        return ChartData.builder()
                .chartType(ChartType.PIE)
                .title(title)
                .labels(labels)
                .values(values)
                .colors(colors)
                .build();
    }

    /**
     * 바 차트 생성 헬퍼
     */
    public static ChartData bar(String title, String xLabel, String yLabel, List<String> labels, List<Number> values) {
        return ChartData.builder()
                .chartType(ChartType.BAR)
                .title(title)
                .xAxisLabel(xLabel)
                .yAxisLabel(yLabel)
                .labels(labels)
                .values(values)
                .build();
    }

    /**
     * 라인 차트 생성 헬퍼
     */
    public static ChartData line(String title, String xLabel, String yLabel, List<String> labels, List<DataSeries> series) {
        return ChartData.builder()
                .chartType(ChartType.LINE)
                .title(title)
                .xAxisLabel(xLabel)
                .yAxisLabel(yLabel)
                .labels(labels)
                .series(series)
                .build();
    }

    /**
     * 게이지 차트 생성 헬퍼
     */
    public static ChartData gauge(String title, double value, double min, double max) {
        return ChartData.builder()
                .chartType(ChartType.GAUGE)
                .title(title)
                .values(List.of(value, min, max))
                .build();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/report/ReportMetadata.java

```java
package com.newsinsight.collector.dto.report;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 생성된 보고서 메타데이터 DTO
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ReportMetadata {

    /**
     * 보고서 고유 ID
     */
    private String reportId;

    /**
     * 보고서 제목
     */
    private String title;

    /**
     * 보고서 유형
     */
    private ReportRequest.ReportType reportType;

    /**
     * 대상 ID (jobId 또는 articleId)
     */
    private String targetId;

    /**
     * 검색 쿼리
     */
    private String query;

    /**
     * 생성 상태: PENDING, GENERATING, COMPLETED, FAILED
     */
    private ReportStatus status;

    /**
     * 파일 크기 (bytes)
     */
    private Long fileSize;

    /**
     * 페이지 수
     */
    private Integer pageCount;

    /**
     * 생성 소요 시간 (ms)
     */
    private Long generationTimeMs;

    /**
     * 생성 일시
     */
    private LocalDateTime createdAt;

    /**
     * 만료 일시 (자동 삭제 예정)
     */
    private LocalDateTime expiresAt;

    /**
     * 다운로드 URL
     */
    private String downloadUrl;

    /**
     * 에러 메시지 (실패 시)
     */
    private String errorMessage;

    /**
     * 보고서 상태 Enum
     */
    public enum ReportStatus {
        PENDING,
        GENERATING,
        COMPLETED,
        FAILED,
        EXPIRED
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/report/ReportRequest.java

```java
package com.newsinsight.collector.dto.report;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * PDF 보고서 생성 요청 DTO
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ReportRequest {

    /**
     * 보고서 유형: UNIFIED_SEARCH, DEEP_SEARCH, ML_ANALYSIS
     */
    private ReportType reportType;

    /**
     * 관련 Job ID 또는 Article ID
     */
    private String targetId;

    /**
     * 검색 쿼리 (통합검색, DeepSearch용)
     */
    private String query;

    /**
     * 시간 범위 (1d, 7d, 30d)
     */
    private String timeWindow;

    /**
     * 포함할 섹션 목록
     */
    @Builder.Default
    private List<ReportSection> includeSections = List.of(ReportSection.values());

    /**
     * 프론트엔드에서 생성한 차트 이미지 (Base64)
     */
    private Map<String, String> chartImages;

    /**
     * 보고서 제목 (커스텀)
     */
    private String customTitle;

    /**
     * 회사 로고 URL 또는 Base64
     */
    private String logoImage;

    /**
     * 워터마크 텍스트
     */
    private String watermark;

    /**
     * 언어 설정 (ko, en)
     */
    @Builder.Default
    private String language = "ko";

    /**
     * 보고서 유형 Enum
     */
    public enum ReportType {
        UNIFIED_SEARCH,
        DEEP_SEARCH,
        ML_ANALYSIS,
        ARTICLE_DETAIL
    }

    /**
     * 보고서 섹션 Enum
     */
    public enum ReportSection {
        COVER,              // 표지
        EXECUTIVE_SUMMARY,  // 요약
        DATA_SOURCE,        // 데이터 소스 분석
        TREND_ANALYSIS,     // 시간별 트렌드
        KEYWORD_ANALYSIS,   // 키워드 분석
        SENTIMENT_ANALYSIS, // 감정 분석
        RELIABILITY,        // 신뢰도 분석
        BIAS_ANALYSIS,      // 편향성 분석
        FACTCHECK,          // 팩트체크
        EVIDENCE_LIST,      // 증거 목록
        DETAILED_RESULTS    // 상세 결과
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/BrowserAgentConfig.java

```java
package com.newsinsight.collector.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Configuration for browser-based AI agent exploration.
 * Embedded in DataSource for BROWSER_AGENT source type.
 * 
 * autonomous-crawler-service의 BrowserTaskMessage와 매핑됩니다.
 */
@Embeddable
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BrowserAgentConfig {

    /**
     * Maximum depth of link traversal from seed URL.
     * 0 = seed page only, 1 = seed + direct links, etc.
     */
    @Column(name = "agent_max_depth")
    @Builder.Default
    private Integer maxDepth = 2;

    /**
     * Maximum number of pages to visit in a single session.
     */
    @Column(name = "agent_max_pages")
    @Builder.Default
    private Integer maxPages = 50;

    /**
     * Maximum time budget for exploration in seconds.
     */
    @Column(name = "agent_budget_seconds")
    @Builder.Default
    private Integer budgetSeconds = 300; // 5 minutes

    /**
     * Exploration behavior policy.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "agent_policy", length = 50)
    @Builder.Default
    private BrowserAgentPolicy policy = BrowserAgentPolicy.FOCUSED_TOPIC;

    /**
     * Keywords or topics for focused exploration.
     * Comma-separated list.
     */
    @Column(name = "agent_focus_keywords", columnDefinition = "TEXT")
    private String focusKeywords;

    /**
     * Custom prompt/instructions for the AI agent.
     */
    @Column(name = "agent_custom_prompt", columnDefinition = "TEXT")
    private String customPrompt;

    /**
     * Whether to capture screenshots during exploration.
     */
    @Column(name = "agent_capture_screenshots")
    @Builder.Default
    private Boolean captureScreenshots = false;

    /**
     * Whether to extract structured data (tables, lists).
     */
    @Column(name = "agent_extract_structured")
    @Builder.Default
    private Boolean extractStructured = true;

    /**
     * Domains to exclude from exploration.
     * Comma-separated list.
     */
    @Column(name = "agent_excluded_domains", columnDefinition = "TEXT")
    private String excludedDomains;

    // ========================================
    // 기본 프리셋 팩토리 메서드
    // ========================================

    /**
     * Create default config for news exploration.
     * 일반적인 뉴스 기사 수집에 적합한 설정.
     */
    public static BrowserAgentConfig forNewsExploration() {
        return BrowserAgentConfig.builder()
                .maxDepth(2)
                .maxPages(30)
                .budgetSeconds(180)
                .policy(BrowserAgentPolicy.NEWS_ONLY)
                .extractStructured(true)
                .captureScreenshots(false)
                .build();
    }

    /**
     * Create config for deep single-page extraction.
     * 단일 페이지에서 상세 정보 추출에 적합한 설정.
     */
    public static BrowserAgentConfig forSinglePageExtraction() {
        return BrowserAgentConfig.builder()
                .maxDepth(0)
                .maxPages(1)
                .budgetSeconds(60)
                .policy(BrowserAgentPolicy.SINGLE_PAGE)
                .extractStructured(true)
                .captureScreenshots(false)
                .build();
    }

    // ========================================
    // 뉴스 특화 프리셋 팩토리 메서드 (신규)
    // ========================================

    /**
     * Create config for breaking news monitoring.
     * 속보/긴급 뉴스 우선 수집에 적합한 설정.
     */
    public static BrowserAgentConfig forBreakingNews() {
        return BrowserAgentConfig.builder()
                .maxDepth(1)
                .maxPages(20)
                .budgetSeconds(120)
                .policy(BrowserAgentPolicy.NEWS_BREAKING)
                .extractStructured(true)
                .captureScreenshots(false)
                .build();
    }

    /**
     * Create config for news archive exploration.
     * 과거 기사 아카이브 수집에 적합한 설정.
     */
    public static BrowserAgentConfig forNewsArchive() {
        return BrowserAgentConfig.builder()
                .maxDepth(3)
                .maxPages(100)
                .budgetSeconds(600) // 10분
                .policy(BrowserAgentPolicy.NEWS_ARCHIVE)
                .extractStructured(true)
                .captureScreenshots(false)
                .build();
    }

    /**
     * Create config for opinion/editorial collection.
     * 오피니언/칼럼/사설 수집에 적합한 설정.
     */
    public static BrowserAgentConfig forOpinionContent() {
        return BrowserAgentConfig.builder()
                .maxDepth(2)
                .maxPages(30)
                .budgetSeconds(180)
                .policy(BrowserAgentPolicy.NEWS_OPINION)
                .extractStructured(true)
                .captureScreenshots(false)
                .build();
    }

    /**
     * Create config for local news collection.
     * 지역 뉴스 수집에 적합한 설정.
     */
    public static BrowserAgentConfig forLocalNews() {
        return BrowserAgentConfig.builder()
                .maxDepth(2)
                .maxPages(40)
                .budgetSeconds(240)
                .policy(BrowserAgentPolicy.NEWS_LOCAL)
                .extractStructured(true)
                .captureScreenshots(false)
                .build();
    }

    /**
     * Create config for topic-focused news collection.
     * 특정 키워드/토픽 중심 수집에 적합한 설정.
     * 
     * @param keywords Comma-separated focus keywords
     */
    public static BrowserAgentConfig forFocusedTopic(String keywords) {
        return BrowserAgentConfig.builder()
                .maxDepth(2)
                .maxPages(50)
                .budgetSeconds(300)
                .policy(BrowserAgentPolicy.FOCUSED_TOPIC)
                .focusKeywords(keywords)
                .extractStructured(true)
                .captureScreenshots(false)
                .build();
    }

    /**
     * Create config for domain-wide exploration.
     * 전체 도메인 탐색에 적합한 설정.
     */
    public static BrowserAgentConfig forDomainExploration() {
        return BrowserAgentConfig.builder()
                .maxDepth(3)
                .maxPages(100)
                .budgetSeconds(600)
                .policy(BrowserAgentPolicy.DOMAIN_WIDE)
                .extractStructured(true)
                .captureScreenshots(false)
                .build();
    }

    // ========================================
    // 유틸리티 메서드
    // ========================================

    /**
     * Create a copy of this config with a different policy.
     * 
     * @param newPolicy The new policy to use
     * @return A new BrowserAgentConfig with the updated policy
     */
    public BrowserAgentConfig withPolicy(BrowserAgentPolicy newPolicy) {
        return BrowserAgentConfig.builder()
                .maxDepth(this.maxDepth)
                .maxPages(this.maxPages)
                .budgetSeconds(this.budgetSeconds)
                .policy(newPolicy)
                .focusKeywords(this.focusKeywords)
                .customPrompt(this.customPrompt)
                .captureScreenshots(this.captureScreenshots)
                .extractStructured(this.extractStructured)
                .excludedDomains(this.excludedDomains)
                .build();
    }

    /**
     * Check if this config uses a news-focused policy.
     * 
     * @return true if the policy is news-focused
     */
    public boolean isNewsFocused() {
        return policy != null && policy.isNewsFocused();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/BrowserAgentPolicy.java

```java
package com.newsinsight.collector.entity;

/**
 * Policy for browser agent autonomous exploration behavior.
 * 
 * 이 enum은 autonomous-crawler-service의 CrawlPolicy와 1:1 매핑됩니다.
 * Python: src/crawler/policies.py의 CrawlPolicy enum
 */
public enum BrowserAgentPolicy {
    // ========================================
    // 기본 정책
    // ========================================
    
    /**
     * Focus on specific topic/keywords only.
     * Agent will prioritize links containing relevant keywords.
     */
    FOCUSED_TOPIC("focused_topic"),
    
    /**
     * Explore within the same domain broadly.
     * Agent will visit multiple pages within the seed domain.
     */
    DOMAIN_WIDE("domain_wide"),
    
    /**
     * Focus on news articles only.
     * Agent will identify and prioritize news content patterns.
     */
    NEWS_ONLY("news_only"),
    
    /**
     * Follow links to external domains as well.
     * Agent can navigate to linked external sites.
     */
    CROSS_DOMAIN("cross_domain"),
    
    /**
     * Minimal exploration - only the seed URL.
     * Useful for single-page deep extraction.
     */
    SINGLE_PAGE("single_page"),
    
    // ========================================
    // 뉴스 특화 정책 (신규)
    // ========================================
    
    /**
     * Priority collection of breaking news and urgent updates.
     * Agent focuses on articles marked as 속보, Breaking, 긴급, 단독.
     */
    NEWS_BREAKING("news_breaking"),
    
    /**
     * Historical article collection from archives.
     * Agent navigates through pagination and older content.
     */
    NEWS_ARCHIVE("news_archive"),
    
    /**
     * Focus on opinion pieces, editorials, and columns.
     * Agent targets 오피니언, 칼럼, 사설 sections.
     */
    NEWS_OPINION("news_opinion"),
    
    /**
     * Local and regional news collection.
     * Agent focuses on geographically specific news content.
     */
    NEWS_LOCAL("news_local");

    private final String value;

    BrowserAgentPolicy(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    /**
     * Convert string value to enum.
     * 
     * @param value The policy value string (e.g., "news_only", "news_breaking")
     * @return The corresponding BrowserAgentPolicy
     * @throws IllegalArgumentException if the value is not recognized
     */
    public static BrowserAgentPolicy fromValue(String value) {
        if (value == null || value.isBlank()) {
            return NEWS_ONLY; // Default fallback
        }
        for (BrowserAgentPolicy policy : BrowserAgentPolicy.values()) {
            if (policy.value.equalsIgnoreCase(value)) {
                return policy;
            }
        }
        throw new IllegalArgumentException("Unknown browser agent policy: " + value);
    }
    
    /**
     * Check if this policy is a news-specific policy.
     * 
     * @return true if this is a news-focused policy
     */
    public boolean isNewsFocused() {
        return this == NEWS_ONLY || this == NEWS_BREAKING || 
               this == NEWS_ARCHIVE || this == NEWS_OPINION || this == NEWS_LOCAL;
    }
    
    /**
     * Check if this policy supports multi-page crawling.
     * 
     * @return true if the policy allows visiting multiple pages
     */
    public boolean supportsMultiPage() {
        return this != SINGLE_PAGE;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/CollectedData.java

```java
package com.newsinsight.collector.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

@Entity
@Table(name = "collected_data", indexes = {
    @Index(name = "idx_source_id", columnList = "source_id"),
    @Index(name = "idx_content_hash", columnList = "content_hash"),
    @Index(name = "idx_processed", columnList = "processed"),
    @Index(name = "idx_collected_at", columnList = "collected_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CollectedData {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "source_id", nullable = false)
    private Long sourceId;

    @Column(name = "title", columnDefinition = "TEXT")
    private String title;

    @Column(name = "content", columnDefinition = "TEXT")
    private String content;

    @Column(name = "url", columnDefinition = "TEXT")
    private String url;

    @Column(name = "published_date")
    private LocalDateTime publishedDate;

    @CreationTimestamp
    @Column(name = "collected_at", nullable = false, updatable = false)
    private LocalDateTime collectedAt;

    @Column(name = "content_hash", length = 64)
    private String contentHash;

    @Column(name = "metadata_json", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private String metadataJson;

    @Column(name = "processed", nullable = false)
    @Builder.Default
    private Boolean processed = false;

    // QA pipeline results
    @Column(name = "http_ok")
    private Boolean httpOk;

    @Column(name = "has_content")
    private Boolean hasContent;

    @Column(name = "duplicate")
    private Boolean duplicate;

    @Column(name = "normalized")
    private Boolean normalized;

    @Column(name = "quality_score")
    private Double qualityScore;

    @Column(name = "semantic_consistency")
    private Double semanticConsistency;

    @Column(name = "outlier_score")
    private Double outlierScore;

    @Column(name = "trust_score")
    private Double trustScore;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/CollectionJob.java

```java
package com.newsinsight.collector.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "collection_jobs", indexes = {
    @Index(name = "idx_source_id", columnList = "source_id"),
    @Index(name = "idx_status", columnList = "status"),
    @Index(name = "idx_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CollectionJob {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "source_id", nullable = false)
    private Long sourceId;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 50)
    @Builder.Default
    private JobStatus status = JobStatus.PENDING;

    @Column(name = "started_at")
    private LocalDateTime startedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    @Column(name = "items_collected", nullable = false)
    @Builder.Default
    private Integer itemsCollected = 0;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    public enum JobStatus {
        PENDING,
        RUNNING,
        COMPLETED,
        FAILED,
        CANCELLED
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/CrawlEvidence.java

```java
package com.newsinsight.collector.entity;

import com.newsinsight.collector.dto.EvidenceDto;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * Entity representing a piece of evidence collected by the deep AI search.
 * Each evidence item contains a URL, stance classification, and content snippet.
 */
@Entity
@Table(name = "crawl_evidence", indexes = {
        @Index(name = "idx_crawl_evidence_job_id", columnList = "job_id"),
        @Index(name = "idx_crawl_evidence_stance", columnList = "stance")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CrawlEvidence {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "job_id", nullable = false, length = 64)
    private String jobId;

    @Column(length = 2048)
    private String url;

    @Column(length = 512)
    private String title;

    /**
     * Stance classification: pro, con, or neutral
     */
    @Enumerated(EnumType.STRING)
    @Column(length = 16)
    private EvidenceStance stance;

    @Column(columnDefinition = "TEXT")
    private String snippet;

    @Column(length = 255)
    private String source;

    /**
     * Source category: news, community, blog, official, academic
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "source_category", length = 32)
    private SourceCategory sourceCategory;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    /**
     * Create evidence from EvidenceDto
     */
    public static CrawlEvidence fromEvidenceDto(String jobId, EvidenceDto evidence) {
        EvidenceStance stance = EvidenceStance.NEUTRAL;
        if (evidence.getStance() != null) {
            try {
                stance = EvidenceStance.valueOf(evidence.getStance().toUpperCase());
            } catch (IllegalArgumentException ignored) {
                // Keep default NEUTRAL
            }
        }

        // Infer source category from URL domain
        SourceCategory category = SourceCategory.NEWS;
        if (evidence.getUrl() != null) {
            try {
                java.net.URI uri = java.net.URI.create(evidence.getUrl());
                category = SourceCategory.inferFromDomain(uri.getHost());
            } catch (Exception ignored) {
                // Keep default NEWS
            }
        }

        return CrawlEvidence.builder()
                .jobId(jobId)
                .url(evidence.getUrl())
                .title(evidence.getTitle())
                .stance(stance)
                .snippet(evidence.getSnippet())
                .source(evidence.getSource())
                .sourceCategory(category)
                .build();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/CrawlFailureReason.java

```java
package com.newsinsight.collector.entity;

/**
 * Enum representing specific timeout/failure reasons for deep search jobs.
 * Used for diagnostic logging and monitoring dashboards.
 */
public enum CrawlFailureReason {
    // Timeout reasons
    TIMEOUT_INTEGRATED_CRAWLER("timeout_integrated_crawler", "Integrated crawler exceeded time limit"),
    TIMEOUT_CRAWL4AI("timeout_crawl4ai", "Crawl4AI service timeout"),
    TIMEOUT_BROWSER_USE("timeout_browser_use", "Browser-Use API timeout"),
    TIMEOUT_AIDOVE("timeout_aidove", "AI Dove analysis timeout"),
    TIMEOUT_JOB_OVERALL("timeout_job_overall", "Overall job timeout exceeded"),
    TIMEOUT_HTTP_REQUEST("timeout_http_request", "HTTP request timeout"),
    TIMEOUT_POLLING("timeout_polling", "Polling timeout for async result"),

    // Connection/Network errors
    CONNECTION_REFUSED("connection_refused", "Connection refused by remote service"),
    CONNECTION_TIMEOUT("connection_timeout", "Connection establishment timeout"),
    DNS_RESOLUTION_FAILED("dns_resolution_failed", "DNS resolution failed"),
    NETWORK_UNREACHABLE("network_unreachable", "Network unreachable"),
    SSL_HANDSHAKE_FAILED("ssl_handshake_failed", "SSL handshake failed"),

    // Service errors
    SERVICE_UNAVAILABLE("service_unavailable", "External service unavailable"),
    SERVICE_OVERLOADED("service_overloaded", "Service overloaded, rate limited"),
    SERVICE_ERROR("service_error", "External service returned error"),
    CRAWL4AI_UNAVAILABLE("crawl4ai_unavailable", "Crawl4AI service not available"),
    BROWSER_USE_UNAVAILABLE("browser_use_unavailable", "Browser-Use service not available"),
    AIDOVE_UNAVAILABLE("aidove_unavailable", "AI Dove service not available"),

    // Content/Parsing errors
    EMPTY_CONTENT("empty_content", "No content extracted from pages"),
    PARSE_ERROR("parse_error", "Failed to parse response"),
    INVALID_URL("invalid_url", "Invalid URL provided"),
    BLOCKED_BY_ROBOTS("blocked_by_robots", "Blocked by robots.txt"),
    BLOCKED_BY_CAPTCHA("blocked_by_captcha", "Blocked by CAPTCHA"),
    CONTENT_TOO_LARGE("content_too_large", "Content too large to process"),

    // Processing errors
    AI_ANALYSIS_FAILED("ai_analysis_failed", "AI analysis/extraction failed"),
    EVIDENCE_EXTRACTION_FAILED("evidence_extraction_failed", "Evidence extraction failed"),
    STANCE_ANALYSIS_FAILED("stance_analysis_failed", "Stance analysis failed"),
    
    // Job management errors
    JOB_CANCELLED("job_cancelled", "Job was cancelled"),
    DUPLICATE_CALLBACK("duplicate_callback", "Duplicate callback received"),
    INVALID_CALLBACK_TOKEN("invalid_callback_token", "Invalid callback token"),

    // Unknown/Other
    UNKNOWN("unknown", "Unknown error occurred");

    private final String code;
    private final String description;

    CrawlFailureReason(String code, String description) {
        this.code = code;
        this.description = description;
    }

    public String getCode() {
        return code;
    }

    public String getDescription() {
        return description;
    }

    /**
     * Get failure reason from exception message
     */
    public static CrawlFailureReason fromException(Throwable e) {
        if (e == null) return UNKNOWN;
        
        String message = e.getMessage() != null ? e.getMessage().toLowerCase() : "";
        String className = e.getClass().getSimpleName().toLowerCase();
        
        // Timeout detection
        if (className.contains("timeout") || message.contains("timeout") || message.contains("timed out")) {
            if (message.contains("crawl4ai")) return TIMEOUT_CRAWL4AI;
            if (message.contains("browser") || message.contains("browser-use")) return TIMEOUT_BROWSER_USE;
            if (message.contains("aidove") || message.contains("ai dove") || message.contains("dove")) return TIMEOUT_AIDOVE;
            if (message.contains("connect")) return CONNECTION_TIMEOUT;
            if (message.contains("poll")) return TIMEOUT_POLLING;
            return TIMEOUT_HTTP_REQUEST;
        }
        
        // Connection errors
        if (message.contains("connection refused") || className.contains("connectexception")) {
            return CONNECTION_REFUSED;
        }
        if (message.contains("dns") || message.contains("unknown host") || message.contains("unresolved")) {
            return DNS_RESOLUTION_FAILED;
        }
        if (message.contains("ssl") || message.contains("certificate") || message.contains("tls")) {
            return SSL_HANDSHAKE_FAILED;
        }
        if (message.contains("network") || message.contains("unreachable")) {
            return NETWORK_UNREACHABLE;
        }
        
        // Service errors
        if (message.contains("503") || message.contains("service unavailable")) {
            return SERVICE_UNAVAILABLE;
        }
        if (message.contains("429") || message.contains("rate limit") || message.contains("too many requests")) {
            return SERVICE_OVERLOADED;
        }
        if (message.contains("500") || message.contains("internal server error")) {
            return SERVICE_ERROR;
        }
        
        // Content errors
        if (message.contains("empty") && (message.contains("content") || message.contains("response"))) {
            return EMPTY_CONTENT;
        }
        if (message.contains("parse") || message.contains("json") || message.contains("malformed")) {
            return PARSE_ERROR;
        }
        if (message.contains("captcha")) {
            return BLOCKED_BY_CAPTCHA;
        }
        if (message.contains("robots")) {
            return BLOCKED_BY_ROBOTS;
        }
        
        return UNKNOWN;
    }

    /**
     * Get failure reason from error message string
     */
    public static CrawlFailureReason fromErrorMessage(String errorMessage) {
        if (errorMessage == null || errorMessage.isBlank()) return UNKNOWN;
        
        String message = errorMessage.toLowerCase();
        
        // Match specific codes first
        for (CrawlFailureReason reason : values()) {
            if (message.contains(reason.code)) {
                return reason;
            }
        }
        
        // Fallback to pattern matching
        if (message.contains("timeout")) {
            if (message.contains("crawl4ai")) return TIMEOUT_CRAWL4AI;
            if (message.contains("browser")) return TIMEOUT_BROWSER_USE;
            if (message.contains("aidove") || message.contains("dove")) return TIMEOUT_AIDOVE;
            if (message.contains("overall") || message.contains("job")) return TIMEOUT_JOB_OVERALL;
            return TIMEOUT_HTTP_REQUEST;
        }
        
        if (message.contains("cancelled") || message.contains("canceled")) {
            return JOB_CANCELLED;
        }
        
        if (message.contains("unavailable")) {
            if (message.contains("crawl4ai")) return CRAWL4AI_UNAVAILABLE;
            if (message.contains("browser")) return BROWSER_USE_UNAVAILABLE;
            if (message.contains("aidove")) return AIDOVE_UNAVAILABLE;
            return SERVICE_UNAVAILABLE;
        }
        
        return UNKNOWN;
    }

    @Override
    public String toString() {
        return code;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/CrawlJob.java

```java
package com.newsinsight.collector.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * Entity representing a deep AI search job.
 * Tracks the status and metadata of asynchronous crawl agent requests.
 */
@Entity
@Table(name = "crawl_jobs", indexes = {
        @Index(name = "idx_crawl_jobs_status", columnList = "status"),
        @Index(name = "idx_crawl_jobs_topic", columnList = "topic"),
        @Index(name = "idx_crawl_jobs_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CrawlJob {

    @Id
    @Column(length = 64)
    private String id;

    @Column(nullable = false, length = 512)
    private String topic;

    @Column(name = "base_url", length = 2048)
    private String baseUrl;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    @Builder.Default
    private CrawlJobStatus status = CrawlJobStatus.PENDING;

    @Column(name = "evidence_count")
    @Builder.Default
    private Integer evidenceCount = 0;

    @Column(name = "error_message", length = 1024)
    private String errorMessage;

    @Enumerated(EnumType.STRING)
    @Column(name = "failure_reason", length = 64)
    private CrawlFailureReason failureReason;

    @Column(name = "callback_received")
    @Builder.Default
    private Boolean callbackReceived = false;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    /**
     * Mark the job as completed successfully
     */
    public void markCompleted(int evidenceCount) {
        this.status = CrawlJobStatus.COMPLETED;
        this.evidenceCount = evidenceCount;
        this.completedAt = LocalDateTime.now();
        this.callbackReceived = true;
    }

    /**
     * Mark the job as failed
     */
    public void markFailed(String errorMessage) {
        markFailed(errorMessage, CrawlFailureReason.fromErrorMessage(errorMessage));
    }

    /**
     * Mark the job as failed with a specific failure reason
     */
    public void markFailed(String errorMessage, CrawlFailureReason failureReason) {
        this.status = CrawlJobStatus.FAILED;
        this.errorMessage = errorMessage;
        this.failureReason = failureReason;
        this.completedAt = LocalDateTime.now();
        this.callbackReceived = true;
    }

    /**
     * Mark the job as failed from an exception
     */
    public void markFailedFromException(Throwable e) {
        CrawlFailureReason reason = CrawlFailureReason.fromException(e);
        String message = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
        markFailed(message, reason);
    }

    /**
     * Mark the job as timed out with a specific reason
     */
    public void markTimedOut(CrawlFailureReason timeoutReason) {
        this.status = CrawlJobStatus.TIMEOUT;
        this.errorMessage = timeoutReason.getDescription();
        this.failureReason = timeoutReason;
        this.completedAt = LocalDateTime.now();
        this.callbackReceived = true;
    }

    /**
     * Mark the job as in progress
     */
    public void markInProgress() {
        this.status = CrawlJobStatus.IN_PROGRESS;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/CrawlJobStatus.java

```java
package com.newsinsight.collector.entity;

/**
 * Status of a deep AI search crawl job
 */
public enum CrawlJobStatus {
    /**
     * Job has been created but not yet started
     */
    PENDING,

    /**
     * Job is currently being processed by n8n workflow
     */
    IN_PROGRESS,

    /**
     * Job completed successfully with evidence
     */
    COMPLETED,

    /**
     * Job failed due to an error
     */
    FAILED,

    /**
     * Job was cancelled before completion
     */
    CANCELLED,

    /**
     * Job timed out waiting for callback
     */
    TIMEOUT
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/DataSource.java

```java
package com.newsinsight.collector.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

@Entity
@Table(name = "data_sources", indexes = {
    @Index(name = "idx_source_type", columnList = "source_type"),
    @Index(name = "idx_is_active", columnList = "is_active")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DataSource {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "name", nullable = false, length = 255)
    private String name;

    @Column(name = "url", nullable = false, columnDefinition = "TEXT")
    private String url;

    @Enumerated(EnumType.STRING)
    @Column(name = "source_type", nullable = false, length = 50)
    private SourceType sourceType;

    @Column(name = "is_active", nullable = false)
    @Builder.Default
    private Boolean isActive = true;

    @Column(name = "last_collected")
    private LocalDateTime lastCollected;

    @Column(name = "collection_frequency", nullable = false)
    @Builder.Default
    private Integer collectionFrequency = 3600; // seconds

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata_json", columnDefinition = "jsonb")
    private String metadataJson;

    /**
     * Search URL template for web search sources.
     * Use {query} as placeholder for the encoded search query.
     * Example: "https://search.naver.com/search.naver?where=news&query={query}"
     * Only applicable when sourceType = WEB_SEARCH.
     */
    @Column(name = "search_url_template", columnDefinition = "TEXT")
    private String searchUrlTemplate;

    /**
     * Priority for web search sources (lower = higher priority).
     * Used for ordering when selecting search sources.
     */
    @Column(name = "search_priority")
    @Builder.Default
    private Integer searchPriority = 100;

    /**
     * Browser agent configuration.
     * Only applicable when sourceType = BROWSER_AGENT.
     */
    @Embedded
    private BrowserAgentConfig browserAgentConfig;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    /**
     * Check if this source requires browser-based collection.
     */
    public boolean requiresBrowserAgent() {
        return sourceType != null && sourceType.requiresBrowser();
    }

    /**
     * Get browser agent config, creating default if null and source type requires it.
     */
    public BrowserAgentConfig getEffectiveBrowserAgentConfig() {
        if (browserAgentConfig != null) {
            return browserAgentConfig;
        }
        if (requiresBrowserAgent()) {
            return BrowserAgentConfig.forNewsExploration();
        }
        return null;
    }

    /**
     * Check if this source supports web search.
     */
    public boolean supportsWebSearch() {
        return sourceType == SourceType.WEB_SEARCH && searchUrlTemplate != null && !searchUrlTemplate.isBlank();
    }

    /**
     * Generate search URL from template with the given query.
     * 
     * @param encodedQuery URL-encoded search query
     * @return Generated search URL or null if template is not set
     */
    public String buildSearchUrl(String encodedQuery) {
        if (searchUrlTemplate == null || searchUrlTemplate.isBlank()) {
            return null;
        }
        return searchUrlTemplate.replace("{query}", encodedQuery);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/EvidenceStance.java

```java
package com.newsinsight.collector.entity;

/**
 * Stance classification for evidence items.
 * Represents the position of the evidence relative to the search topic.
 */
public enum EvidenceStance {
    /**
     * Evidence supports or is favorable to the topic
     */
    PRO,

    /**
     * Evidence opposes or is unfavorable to the topic
     */
    CON,

    /**
     * Evidence is neutral or balanced
     */
    NEUTRAL
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/SourceCategory.java

```java
package com.newsinsight.collector.entity;

/**
 * Category of data source for distinguishing content origin.
 * 
 * - NEWS: Official news media sources (newspapers, broadcasters, news agencies)
 * - COMMUNITY: Community/forum sources (Reddit, DCInside, Clien, Twitter, etc.)
 * - BLOG: Personal blogs and opinion pieces
 * - OFFICIAL: Official government/organization sources
 * - ACADEMIC: Academic papers and research
 */
public enum SourceCategory {
    NEWS("news", "뉴스"),
    COMMUNITY("community", "커뮤니티"),
    BLOG("blog", "블로그"),
    OFFICIAL("official", "공식"),
    ACADEMIC("academic", "학술");

    private final String value;
    private final String label;

    SourceCategory(String value, String label) {
        this.value = value;
        this.label = label;
    }

    public String getValue() {
        return value;
    }

    public String getLabel() {
        return label;
    }

    /**
     * Check if this category is a primary news source.
     */
    public boolean isPrimarySource() {
        return this == NEWS || this == OFFICIAL || this == ACADEMIC;
    }

    /**
     * Check if this category represents user-generated content.
     */
    public boolean isUserGenerated() {
        return this == COMMUNITY || this == BLOG;
    }

    public static SourceCategory fromValue(String value) {
        if (value == null) return NEWS;
        for (SourceCategory category : SourceCategory.values()) {
            if (category.value.equalsIgnoreCase(value)) {
                return category;
            }
        }
        return NEWS; // Default to NEWS
    }

    /**
     * Infer category from source domain name.
     */
    public static SourceCategory inferFromDomain(String domain) {
        if (domain == null) return NEWS;
        String lowerDomain = domain.toLowerCase();
        
        // Community sites
        if (lowerDomain.contains("reddit.com") ||
            lowerDomain.contains("dcinside.com") ||
            lowerDomain.contains("clien.net") ||
            lowerDomain.contains("ruliweb.com") ||
            lowerDomain.contains("ppomppu.co.kr") ||
            lowerDomain.contains("fmkorea.com") ||
            lowerDomain.contains("mlbpark.donga.com") ||
            lowerDomain.contains("bobaedream.co.kr") ||
            lowerDomain.contains("theqoo.net") ||
            lowerDomain.contains("instiz.net") ||
            lowerDomain.contains("twitter.com") ||
            lowerDomain.contains("x.com") ||
            lowerDomain.contains("threads.net") ||
            lowerDomain.contains("quora.com") ||
            lowerDomain.contains("cafe.naver.com") ||
            lowerDomain.contains("cafe.daum.net")) {
            return COMMUNITY;
        }
        
        // Blog platforms
        if (lowerDomain.contains("blog.naver.com") ||
            lowerDomain.contains("tistory.com") ||
            lowerDomain.contains("brunch.co.kr") ||
            lowerDomain.contains("medium.com") ||
            lowerDomain.contains("velog.io") ||
            lowerDomain.contains("wordpress.com") ||
            lowerDomain.contains("substack.com")) {
            return BLOG;
        }
        
        // Official sources
        if (lowerDomain.contains(".go.kr") ||
            lowerDomain.contains(".gov") ||
            lowerDomain.contains(".mil")) {
            return OFFICIAL;
        }
        
        // Academic sources
        if (lowerDomain.contains("scholar.google") ||
            lowerDomain.contains("arxiv.org") ||
            lowerDomain.contains("pubmed") ||
            lowerDomain.contains("sciencedirect") ||
            lowerDomain.contains("springer.com") ||
            lowerDomain.contains("nature.com") ||
            lowerDomain.contains("ieee.org") ||
            lowerDomain.contains(".edu") ||
            lowerDomain.contains(".ac.kr")) {
            return ACADEMIC;
        }
        
        return NEWS;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/SourceType.java

```java
package com.newsinsight.collector.entity;

/**
 * Types of data sources for collection.
 * 
 * - RSS: RSS/Atom feed parsing (Rome library)
 * - WEB: Static HTML scraping (Crawl4AI/Jsoup)
 * - WEB_SEARCH: Web search portal integration (Naver, Daum, Google, etc.)
 * - API: External API integration (future)
 * - WEBHOOK: Passive event reception (future)
 * - BROWSER_AGENT: AI-driven autonomous browser exploration (Browser-use/Puppeteer)
 */
public enum SourceType {
    RSS("rss"),
    WEB("web"),
    WEB_SEARCH("web_search"),
    API("api"),
    WEBHOOK("webhook"),
    BROWSER_AGENT("browser_agent");

    private final String value;

    SourceType(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    /**
     * Check if this source type requires browser-based collection.
     */
    public boolean requiresBrowser() {
        return this == BROWSER_AGENT;
    }

    /**
     * Check if this source type supports autonomous exploration.
     */
    public boolean supportsAutonomousExploration() {
        return this == BROWSER_AGENT;
    }

    /**
     * Check if this source type is for web search portals.
     */
    public boolean isWebSearch() {
        return this == WEB_SEARCH;
    }

    public static SourceType fromValue(String value) {
        for (SourceType type : SourceType.values()) {
            if (type.value.equalsIgnoreCase(value)) {
                return type;
            }
        }
        throw new IllegalArgumentException("Unknown source type: " + value);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/addon/AddonAuthType.java

```java
package com.newsinsight.collector.entity.addon;

/**
 * Add-on 인증 타입.
 */
public enum AddonAuthType {
    
    /**
     * 인증 없음
     */
    NONE,
    
    /**
     * API Key 인증 (헤더 또는 쿼리 파라미터)
     */
    API_KEY,
    
    /**
     * Bearer Token
     */
    BEARER_TOKEN,
    
    /**
     * Basic Auth
     */
    BASIC,
    
    /**
     * OAuth 2.0
     */
    OAUTH2
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/addon/AddonCategory.java

```java
package com.newsinsight.collector.entity.addon;

/**
 * Add-on 카테고리 분류.
 * 각 카테고리는 분석 기능의 유형을 나타냄.
 */
public enum AddonCategory {
    
    /**
     * 감정 분석 (긍정/부정/중립)
     */
    SENTIMENT,
    
    /**
     * 문맥/의도 분석 (주제 분류, 스탠스 분석)
     */
    CONTEXT,
    
    /**
     * 팩트체크 (주장 검증, 교차 출처 비교)
     */
    FACTCHECK,
    
    /**
     * 커뮤니티/여론 분석 (댓글, SNS)
     */
    COMMUNITY,
    
    /**
     * 출처 신뢰도/편향도 분석
     */
    SOURCE_QUALITY,

    BIAS,
    
    /**
     * 개체명 인식 (NER)
     */
    ENTITY_EXTRACTION,
    
    /**
     * 요약 생성
     */
    SUMMARIZATION,
    
    /**
     * 주제 분류
     */
    TOPIC_CLASSIFICATION,
    
    /**
     * 독성 댓글 탐지
     */
    TOXICITY,
    
    BOT_DETECTION,
    
    NER,
    
    /**
     * 허위정보 탐지
     */
    MISINFORMATION,
    
    /**
     * 기타 범주
     */
    OTHER
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/addon/AddonHealthStatus.java

```java
package com.newsinsight.collector.entity.addon;

/**
 * Add-on 헬스체크 상태.
 */
public enum AddonHealthStatus {
    
    /**
     * 정상
     */
    HEALTHY,
    
    /**
     * 불안정 (간헐적 오류)
     */
    DEGRADED,
    
    /**
     * 장애
     */
    UNHEALTHY,
    
    /**
     * 알 수 없음 (아직 체크 안 됨)
     */
    UNKNOWN
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/addon/AddonInvokeType.java

```java
package com.newsinsight.collector.entity.addon;

/**
 * Add-on 호출 타입.
 */
public enum AddonInvokeType {
    
    /**
     * HTTP 동기 호출 (응답 대기)
     */
    HTTP_SYNC,
    
    /**
     * HTTP 비동기 호출 (웹훅 콜백)
     */
    HTTP_ASYNC,
    
    /**
     * 메시지 큐 기반 (Kafka, RabbitMQ 등)
     */
    QUEUE,
    
    /**
     * 파일/스토리지 폴링 (S3, GCS 등)
     */
    FILE_POLL
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/addon/ExecutionStatus.java

```java
package com.newsinsight.collector.entity.addon;

/**
 * Add-on 실행 상태.
 */
public enum ExecutionStatus {
    
    /**
     * 대기 중 (큐에 있음)
     */
    PENDING,
    
    /**
     * 실행 중
     */
    RUNNING,
    
    /**
     * 성공
     */
    SUCCESS,
    
    /**
     * 실패
     */
    FAILED,
    
    /**
     * 타임아웃
     */
    TIMEOUT,
    
    /**
     * 취소됨
     */
    CANCELLED,
    
    /**
     * 건너뜀 (의존성 실패 등)
     */
    SKIPPED
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/addon/MlAddon.java

```java
package com.newsinsight.collector.entity.addon;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * ML Add-on Registry Entity.
 * 
 * 각 ML 분석 기능(감정분석, 팩트체크, 편향도 분석 등)을 플러그인 형태로 등록/관리.
 * 내부 서비스(Spring/Python), 외부 Colab, 또는 서드파티 API 모두 동일한 방식으로 연결 가능.
 */
@Entity
@Table(name = "ml_addon", indexes = {
    @Index(name = "idx_addon_category", columnList = "category"),
    @Index(name = "idx_addon_enabled", columnList = "enabled"),
    @Index(name = "idx_addon_invoke_type", columnList = "invoke_type")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MlAddon {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Add-on 고유 식별자 (예: "sentiment-v1", "factcheck-korean-v2")
     */
    @Column(name = "addon_key", nullable = false, unique = true, length = 100)
    private String addonKey;

    /**
     * 표시용 이름
     */
    @Column(name = "name", nullable = false, length = 200)
    private String name;

    /**
     * Add-on 설명
     */
    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    /**
     * 분류 카테고리
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "category", nullable = false, length = 50)
    private AddonCategory category;

    /**
     * 호출 타입
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "invoke_type", nullable = false, length = 30)
    private AddonInvokeType invokeType;

    /**
     * HTTP 호출 시 엔드포인트 URL
     */
    @Column(name = "endpoint_url", length = 500)
    private String endpointUrl;

    /**
     * 큐 기반 호출 시 토픽명
     */
    @Column(name = "queue_topic", length = 200)
    private String queueTopic;

    /**
     * 파일 폴링 시 스토리지 경로
     */
    @Column(name = "storage_path", length = 500)
    private String storagePath;

    /**
     * 인증 타입
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "auth_type", length = 30)
    @Builder.Default
    private AddonAuthType authType = AddonAuthType.NONE;

    /**
     * 인증 정보 (암호화 저장 권장)
     * API Key, OAuth credentials 등
     */
    @Column(name = "auth_credentials", columnDefinition = "TEXT")
    private String authCredentials;

    /**
     * Input 스키마 버전 (호환성 체크용)
     */
    @Column(name = "input_schema_version", length = 20)
    @Builder.Default
    private String inputSchemaVersion = "1.0";

    /**
     * Output 스키마 버전
     */
    @Column(name = "output_schema_version", length = 20)
    @Builder.Default
    private String outputSchemaVersion = "1.0";

    /**
     * 타임아웃 (밀리초)
     */
    @Column(name = "timeout_ms")
    @Builder.Default
    private Integer timeoutMs = 30000;

    /**
     * 초당 최대 요청 수 (Rate limiting)
     */
    @Column(name = "max_qps")
    @Builder.Default
    private Integer maxQps = 10;

    /**
     * 재시도 횟수
     */
    @Column(name = "max_retries")
    @Builder.Default
    private Integer maxRetries = 3;

    /**
     * 의존하는 다른 Add-on들의 addonKey 목록 (DAG 구성용)
     * 예: ["entity_extractor_v1", "topic_classifier_v1"]
     */
    @Column(name = "depends_on", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> dependsOn;

    /**
     * 활성화 여부
     */
    @Column(name = "enabled", nullable = false)
    @Builder.Default
    private Boolean enabled = true;

    /**
     * 우선순위 (낮을수록 먼저 실행)
     */
    @Column(name = "priority")
    @Builder.Default
    private Integer priority = 100;

    /**
     * 추가 설정 (JSON)
     * - 모델 파라미터
     * - 언어 설정
     * - 임계값 등
     */
    @Column(name = "config", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Object> config;

    /**
     * 헬스체크 엔드포인트 (옵션)
     */
    @Column(name = "health_check_url", length = 500)
    private String healthCheckUrl;

    /**
     * 마지막 헬스체크 상태
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "health_status", length = 20)
    @Builder.Default
    private AddonHealthStatus healthStatus = AddonHealthStatus.UNKNOWN;

    /**
     * 마지막 헬스체크 시간
     */
    @Column(name = "last_health_check")
    private LocalDateTime lastHealthCheck;

    /**
     * 관리자/소유자
     */
    @Column(name = "owner", length = 100)
    private String owner;

    /**
     * 생성일시
     */
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    /**
     * 수정일시
     */
    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    // === 운영 통계 (캐시용, 주기적 업데이트) ===

    /**
     * 총 실행 횟수
     */
    @Column(name = "total_executions")
    @Builder.Default
    private Long totalExecutions = 0L;

    /**
     * 성공 횟수
     */
    @Column(name = "success_count")
    @Builder.Default
    private Long successCount = 0L;

    /**
     * 실패 횟수
     */
    @Column(name = "failure_count")
    @Builder.Default
    private Long failureCount = 0L;

    /**
     * 평균 응답 시간 (ms)
     */
    @Column(name = "avg_latency_ms")
    private Double avgLatencyMs;

    /**
     * 통계 마지막 갱신 시간
     */
    @Column(name = "stats_updated_at")
    private LocalDateTime statsUpdatedAt;

    // === Helper Methods ===

    public boolean isHttpBased() {
        return invokeType == AddonInvokeType.HTTP_SYNC || invokeType == AddonInvokeType.HTTP_ASYNC;
    }

    public boolean isQueueBased() {
        return invokeType == AddonInvokeType.QUEUE;
    }

    public double getSuccessRate() {
        if (totalExecutions == null || totalExecutions == 0) return 0.0;
        return (successCount != null ? successCount : 0) / (double) totalExecutions;
    }

    public void incrementSuccess(long latencyMs) {
        this.totalExecutions = (this.totalExecutions != null ? this.totalExecutions : 0) + 1;
        this.successCount = (this.successCount != null ? this.successCount : 0) + 1;
        // Simple moving average for latency
        if (this.avgLatencyMs == null) {
            this.avgLatencyMs = (double) latencyMs;
        } else {
            this.avgLatencyMs = (this.avgLatencyMs * 0.9) + (latencyMs * 0.1);
        }
        this.statsUpdatedAt = LocalDateTime.now();
    }

    public void incrementFailure() {
        this.totalExecutions = (this.totalExecutions != null ? this.totalExecutions : 0) + 1;
        this.failureCount = (this.failureCount != null ? this.failureCount : 0) + 1;
        this.statsUpdatedAt = LocalDateTime.now();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/addon/MlAddonExecution.java

```java
package com.newsinsight.collector.entity.addon;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Add-on 실행 이력 엔티티.
 * 
 * 각 분석 작업의 요청/응답/상태를 기록.
 * 디버깅, 모니터링, 감사 추적에 활용.
 */
@Entity
@Table(name = "ml_addon_execution", indexes = {
    @Index(name = "idx_exec_addon_id", columnList = "addon_id"),
    @Index(name = "idx_exec_article_id", columnList = "article_id"),
    @Index(name = "idx_exec_status", columnList = "status"),
    @Index(name = "idx_exec_created", columnList = "created_at"),
    @Index(name = "idx_exec_batch_id", columnList = "batch_id")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MlAddonExecution {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 요청 고유 ID (UUID)
     */
    @Column(name = "request_id", nullable = false, unique = true, length = 50)
    private String requestId;

    /**
     * 배치 ID (여러 기사를 한 번에 처리할 때)
     */
    @Column(name = "batch_id", length = 50)
    private String batchId;

    /**
     * 대상 Add-on
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "addon_id", nullable = false)
    private MlAddon addon;

    /**
     * 분석 대상 기사 ID
     */
    @Column(name = "article_id")
    private Long articleId;

    /**
     * 분석 대상 URL (기사가 아닌 경우)
     */
    @Column(name = "target_url", length = 1000)
    private String targetUrl;

    /**
     * 실행 상태
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 20)
    @Builder.Default
    private ExecutionStatus status = ExecutionStatus.PENDING;

    /**
     * 요청 페이로드 (디버깅용, 민감정보 주의)
     */
    @Column(name = "request_payload", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Object> requestPayload;

    /**
     * 응답 결과 (분석 결과 전체)
     */
    @Column(name = "response_payload", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Object> responsePayload;

    /**
     * 에러 메시지 (실패 시)
     */
    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    /**
     * 에러 코드
     */
    @Column(name = "error_code", length = 50)
    private String errorCode;

    /**
     * 재시도 횟수
     */
    @Column(name = "retry_count")
    @Builder.Default
    private Integer retryCount = 0;

    /**
     * 요청 시작 시간
     */
    @Column(name = "started_at")
    private LocalDateTime startedAt;

    /**
     * 요청 완료 시간
     */
    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    /**
     * 실행 소요 시간 (ms)
     */
    @Column(name = "latency_ms")
    private Long latencyMs;

    /**
     * 모델 버전 (Add-on이 반환)
     */
    @Column(name = "model_version", length = 100)
    private String modelVersion;

    /**
     * 생성 시간
     */
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    /**
     * 중요도/우선순위 (realtime, batch)
     */
    @Column(name = "importance", length = 20)
    @Builder.Default
    private String importance = "batch";

    // === Helper Methods ===

    public void markStarted() {
        this.status = ExecutionStatus.RUNNING;
        this.startedAt = LocalDateTime.now();
    }

    public void markSuccess(Map<String, Object> response, String modelVersion) {
        this.status = ExecutionStatus.SUCCESS;
        this.completedAt = LocalDateTime.now();
        this.responsePayload = response;
        this.modelVersion = modelVersion;
        if (this.startedAt != null) {
            this.latencyMs = java.time.Duration.between(startedAt, completedAt).toMillis();
        }
    }

    public void markFailed(String errorCode, String errorMessage) {
        this.status = ExecutionStatus.FAILED;
        this.completedAt = LocalDateTime.now();
        this.errorCode = errorCode;
        this.errorMessage = errorMessage;
        if (this.startedAt != null) {
            this.latencyMs = java.time.Duration.between(startedAt, completedAt).toMillis();
        }
    }

    public void incrementRetry() {
        this.retryCount = (this.retryCount != null ? this.retryCount : 0) + 1;
        this.status = ExecutionStatus.PENDING;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/ai/AiJob.java

```java
package com.newsinsight.collector.entity.ai;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Entity representing an AI orchestration job.
 * A job consists of multiple sub-tasks that can be processed by different AI providers.
 * Tracks the overall status aggregated from all sub-tasks.
 */
@Entity
@Table(name = "ai_jobs", indexes = {
        @Index(name = "idx_ai_jobs_overall_status", columnList = "overall_status"),
        @Index(name = "idx_ai_jobs_created_at", columnList = "created_at"),
        @Index(name = "idx_ai_jobs_topic", columnList = "topic")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiJob {

    @Id
    @Column(name = "job_id", length = 64)
    private String id;

    @Column(nullable = false, length = 512)
    private String topic;

    @Column(name = "base_url", length = 2048)
    private String baseUrl;

    @Enumerated(EnumType.STRING)
    @Column(name = "overall_status", nullable = false, length = 32)
    @Builder.Default
    private AiJobStatus overallStatus = AiJobStatus.PENDING;

    @OneToMany(mappedBy = "aiJob", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @Builder.Default
    private List<AiSubTask> subTasks = new ArrayList<>();

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    @Column(name = "error_message", length = 1024)
    private String errorMessage;

    /**
     * Add a sub-task to this job (manages bidirectional relationship)
     */
    public void addSubTask(AiSubTask task) {
        subTasks.add(task);
        task.setAiJob(this);
    }

    /**
     * Remove a sub-task from this job
     */
    public void removeSubTask(AiSubTask task) {
        subTasks.remove(task);
        task.setAiJob(null);
    }

    /**
     * Mark the job as in progress
     */
    public void markInProgress() {
        this.overallStatus = AiJobStatus.IN_PROGRESS;
    }

    /**
     * Mark the job as completed successfully
     */
    public void markCompleted() {
        this.overallStatus = AiJobStatus.COMPLETED;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Mark the job as failed
     */
    public void markFailed(String errorMessage) {
        this.overallStatus = AiJobStatus.FAILED;
        this.errorMessage = errorMessage;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Mark the job as partially successful (some tasks completed, some failed)
     */
    public void markPartialSuccess() {
        this.overallStatus = AiJobStatus.PARTIAL_SUCCESS;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Mark the job as cancelled
     */
    public void markCancelled() {
        this.overallStatus = AiJobStatus.CANCELLED;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Mark the job as timed out
     */
    public void markTimeout() {
        this.overallStatus = AiJobStatus.TIMEOUT;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Check if the job is in a terminal state
     */
    public boolean isTerminal() {
        return overallStatus == AiJobStatus.COMPLETED
                || overallStatus == AiJobStatus.FAILED
                || overallStatus == AiJobStatus.PARTIAL_SUCCESS
                || overallStatus == AiJobStatus.CANCELLED
                || overallStatus == AiJobStatus.TIMEOUT;
    }

    /**
     * Get count of sub-tasks by status
     */
    public long countSubTasksByStatus(AiTaskStatus status) {
        return subTasks.stream()
                .filter(task -> task.getStatus() == status)
                .count();
    }

    /**
     * Generate a new job ID
     */
    public static String generateJobId() {
        return "aijob_" + java.util.UUID.randomUUID().toString()
                .replace("-", "").substring(0, 16);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/ai/AiJobStatus.java

```java
package com.newsinsight.collector.entity.ai;

/**
 * Status of an AI orchestration job.
 * Represents the aggregate state across all sub-tasks.
 */
public enum AiJobStatus {
    /**
     * Job has been created but no sub-tasks have started
     */
    PENDING,

    /**
     * At least one sub-task is currently being processed
     */
    IN_PROGRESS,

    /**
     * All sub-tasks completed successfully
     */
    COMPLETED,

    /**
     * Some sub-tasks completed, some failed/timed out
     */
    PARTIAL_SUCCESS,

    /**
     * All sub-tasks failed
     */
    FAILED,

    /**
     * Job was cancelled before completion
     */
    CANCELLED,

    /**
     * Job timed out waiting for sub-task callbacks
     */
    TIMEOUT
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/ai/AiProvider.java

```java
package com.newsinsight.collector.entity.ai;

/**
 * AI provider/workflow types for task routing.
 * Each provider represents a different n8n workflow or external AI service.
 */
public enum AiProvider {
    /**
     * Universal agent for general-purpose AI tasks.
     * n8n workflow: /webhook/universal-agent
     */
    UNIVERSAL_AGENT("universal-agent", "General-purpose AI agent"),

    /**
     * Deep reader for in-depth content analysis.
     * n8n workflow: /webhook/deep-reader (crawl-agent)
     */
    DEEP_READER("deep-reader", "Deep content analysis and evidence extraction"),

    /**
     * Scout agent for quick reconnaissance and URL discovery.
     * n8n workflow: /webhook/scout-agent
     */
    SCOUT("scout-agent", "Quick reconnaissance and URL discovery"),

    /**
     * Local quick processing for simple tasks without external calls.
     * Processed internally without n8n.
     */
    LOCAL_QUICK("local-quick", "Local quick processing");

    private final String workflowPath;
    private final String description;

    AiProvider(String workflowPath, String description) {
        this.workflowPath = workflowPath;
        this.description = description;
    }

    public String getWorkflowPath() {
        return workflowPath;
    }

    public String getDescription() {
        return description;
    }

    /**
     * Check if this provider requires external n8n workflow
     */
    public boolean isExternal() {
        return this != LOCAL_QUICK;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/ai/AiSubTask.java

```java
package com.newsinsight.collector.entity.ai;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * Entity representing an individual AI sub-task within a job.
 * Each sub-task is processed by a specific AI provider (n8n workflow).
 */
@Entity
@Table(name = "ai_sub_tasks", indexes = {
        @Index(name = "idx_ai_sub_tasks_job_id", columnList = "job_id"),
        @Index(name = "idx_ai_sub_tasks_status", columnList = "status"),
        @Index(name = "idx_ai_sub_tasks_provider_id", columnList = "provider_id"),
        @Index(name = "idx_ai_sub_tasks_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiSubTask {

    @Id
    @Column(name = "sub_task_id", length = 64)
    private String id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "job_id", nullable = false)
    private AiJob aiJob;

    @Enumerated(EnumType.STRING)
    @Column(name = "provider_id", nullable = false, length = 32)
    private AiProvider providerId;

    @Column(name = "task_type", nullable = false, length = 64)
    private String taskType;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 32)
    @Builder.Default
    private AiTaskStatus status = AiTaskStatus.PENDING;

    @Lob
    @Column(name = "result_json", columnDefinition = "TEXT")
    private String resultJson;

    @Column(name = "error_message", length = 1024)
    private String errorMessage;

    @Column(name = "retry_count")
    @Builder.Default
    private Integer retryCount = 0;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    /**
     * Mark the task as in progress
     */
    public void markInProgress() {
        this.status = AiTaskStatus.IN_PROGRESS;
    }

    /**
     * Mark the task as completed with result
     */
    public void markCompleted(String resultJson) {
        this.status = AiTaskStatus.COMPLETED;
        this.resultJson = resultJson;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Mark the task as failed
     */
    public void markFailed(String errorMessage) {
        this.status = AiTaskStatus.FAILED;
        this.errorMessage = errorMessage;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Mark the task as cancelled
     */
    public void markCancelled() {
        this.status = AiTaskStatus.CANCELLED;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Mark the task as timed out
     */
    public void markTimeout() {
        this.status = AiTaskStatus.TIMEOUT;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Increment retry count
     */
    public void incrementRetry() {
        this.retryCount++;
    }

    /**
     * Check if the task is in a terminal state
     */
    public boolean isTerminal() {
        return status == AiTaskStatus.COMPLETED
                || status == AiTaskStatus.FAILED
                || status == AiTaskStatus.CANCELLED
                || status == AiTaskStatus.TIMEOUT;
    }

    /**
     * Check if the task can be retried
     */
    public boolean canRetry(int maxRetries) {
        return retryCount < maxRetries && !isTerminal();
    }

    /**
     * Get the job ID (helper for when job is lazy loaded)
     */
    public String getJobId() {
        return aiJob != null ? aiJob.getId() : null;
    }

    /**
     * Create a new sub-task for a job
     */
    public static AiSubTask create(AiJob job, AiProvider provider, String taskType) {
        AiSubTask task = AiSubTask.builder()
                .id(generateSubTaskId())
                .providerId(provider)
                .taskType(taskType)
                .status(AiTaskStatus.PENDING)
                .retryCount(0)
                .build();
        job.addSubTask(task);
        return task;
    }

    /**
     * Generate a new sub-task ID
     */
    public static String generateSubTaskId() {
        return "subtask_" + UUID.randomUUID().toString()
                .replace("-", "").substring(0, 16);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/ai/AiTaskStatus.java

```java
package com.newsinsight.collector.entity.ai;

/**
 * Status of an individual AI sub-task.
 */
public enum AiTaskStatus {
    /**
     * Task has been created but not yet started
     */
    PENDING,

    /**
     * Task is currently being processed by a worker/n8n
     */
    IN_PROGRESS,

    /**
     * Task completed successfully
     */
    COMPLETED,

    /**
     * Task failed due to an error
     */
    FAILED,

    /**
     * Task was cancelled before completion
     */
    CANCELLED,

    /**
     * Task timed out waiting for callback
     */
    TIMEOUT
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/analysis/ArticleAnalysis.java

```java
package com.newsinsight.collector.entity.analysis;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 기사 분석 결과 엔티티.
 * 
 * 각종 ML Add-on의 분석 결과를 통합 저장.
 * 감정 분석, 신뢰도, 편향도, 팩트체크 결과 등을 한 곳에서 조회 가능.
 */
@Entity
@Table(name = "article_analysis", indexes = {
    @Index(name = "idx_analysis_article_id", columnList = "article_id"),
    @Index(name = "idx_analysis_reliability", columnList = "reliability_score"),
    @Index(name = "idx_analysis_sentiment", columnList = "sentiment_label"),
    @Index(name = "idx_analysis_bias", columnList = "bias_label"),
    @Index(name = "idx_analysis_misinfo", columnList = "misinfo_risk"),
    @Index(name = "idx_analysis_updated", columnList = "updated_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ArticleAnalysis {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 분석 대상 기사 ID (collected_data.id와 연결)
     */
    @Column(name = "article_id", nullable = false, unique = true)
    private Long articleId;

    // ========== 요약 ==========

    /**
     * AI 생성 요약
     */
    @Column(name = "summary", columnDefinition = "TEXT")
    private String summary;

    /**
     * 핵심 문장 (추출 요약)
     */
    @Column(name = "key_sentences", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> keySentences;

    // ========== 감정 분석 ==========

    /**
     * 감정 점수 (-1.0 ~ 1.0 또는 0 ~ 100)
     * -1 = 매우 부정, 0 = 중립, 1 = 매우 긍정
     */
    @Column(name = "sentiment_score")
    private Double sentimentScore;

    /**
     * 감정 레이블 (positive, negative, neutral)
     */
    @Column(name = "sentiment_label", length = 20)
    private String sentimentLabel;

    /**
     * 감정 분포 (긍정/부정/중립 비율)
     * {"positive": 0.2, "negative": 0.7, "neutral": 0.1}
     */
    @Column(name = "sentiment_distribution", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Double> sentimentDistribution;

    /**
     * 톤 분석 (보도형 vs 의견형)
     * {"factual": 0.8, "opinion": 0.2}
     */
    @Column(name = "tone_analysis", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Double> toneAnalysis;

    // ========== 편향도 분석 ==========

    /**
     * 편향 레이블 (left, right, center, pro_government, pro_corporate 등)
     */
    @Column(name = "bias_label", length = 50)
    private String biasLabel;

    /**
     * 편향 점수 (-1.0 ~ 1.0)
     * -1 = 극좌, 0 = 중립, 1 = 극우 (정치적 스펙트럼)
     */
    @Column(name = "bias_score")
    private Double biasScore;

    /**
     * 편향 세부 분석
     * {"political_left": 0.3, "pro_government": 0.2, ...}
     */
    @Column(name = "bias_details", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Double> biasDetails;

    // ========== 신뢰도 분석 ==========

    /**
     * 신뢰도 점수 (0 ~ 100)
     */
    @Column(name = "reliability_score")
    private Double reliabilityScore;

    /**
     * 신뢰도 등급 (high, medium, low)
     */
    @Column(name = "reliability_grade", length = 20)
    private String reliabilityGrade;

    /**
     * 신뢰도 요인 분석
     * {"source_reputation": 0.8, "citation_quality": 0.6, "consistency": 0.7}
     */
    @Column(name = "reliability_factors", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Double> reliabilityFactors;

    // ========== 허위정보/팩트체크 ==========

    /**
     * 허위정보 위험도 (low, mid, high)
     */
    @Column(name = "misinfo_risk", length = 20)
    private String misinfoRisk;

    /**
     * 허위정보 점수 (0 ~ 1)
     */
    @Column(name = "misinfo_score")
    private Double misinfoScore;

    /**
     * 팩트체크 상태 (verified, suspicious, conflicting, unverified)
     */
    @Column(name = "factcheck_status", length = 30)
    private String factcheckStatus;

    /**
     * 팩트체크 상세 노트/근거
     */
    @Column(name = "factcheck_notes", columnDefinition = "TEXT")
    private String factcheckNotes;

    /**
     * 검증된 주장들
     * [{"claim": "...", "verified": true, "sources": [...]}]
     */
    @Column(name = "verified_claims", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> verifiedClaims;

    // ========== 주제/토픽 ==========

    /**
     * 주요 토픽/카테고리
     * ["정치", "외교", "북한"]
     */
    @Column(name = "topics", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> topics;

    /**
     * 토픽별 연관도
     * {"정치": 0.9, "외교": 0.7, "북한": 0.5}
     */
    @Column(name = "topic_scores", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Double> topicScores;

    // ========== 개체명 인식 (NER) ==========

    /**
     * 추출된 인물
     * [{"name": "홍길동", "role": "장관", "sentiment": "neutral"}]
     */
    @Column(name = "entities_person", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> entitiesPerson;

    /**
     * 추출된 기관/조직
     */
    @Column(name = "entities_org", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> entitiesOrg;

    /**
     * 추출된 장소/지역
     */
    @Column(name = "entities_location", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> entitiesLocation;

    /**
     * 기타 개체 (날짜, 금액, 수치 등)
     */
    @Column(name = "entities_misc", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> entitiesMisc;

    // ========== 위험 태그 ==========

    /**
     * 위험 태그 목록
     * ["clickbait", "sensational", "unverified_source"]
     */
    @Column(name = "risk_tags", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> riskTags;

    /**
     * 독성/혐오 점수 (0 ~ 1)
     */
    @Column(name = "toxicity_score")
    private Double toxicityScore;

    /**
     * 선정성 점수 (0 ~ 1)
     */
    @Column(name = "sensationalism_score")
    private Double sensationalismScore;

    // ========== 분석 메타데이터 ==========

    /**
     * 분석에 사용된 Add-on 목록
     * ["sentiment-v1", "factcheck-v2", "ner-korean-v1"]
     */
    @Column(name = "analyzed_by", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> analyzedBy;

    /**
     * 분석 완료 상태
     * {"sentiment": true, "factcheck": false, "ner": true}
     */
    @Column(name = "analysis_status", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Boolean> analysisStatus;

    /**
     * 전체 분석 완료 여부
     */
    @Column(name = "fully_analyzed")
    @Builder.Default
    private Boolean fullyAnalyzed = false;

    /**
     * 생성일시
     */
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    /**
     * 마지막 업데이트
     */
    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    // ========== Helper Methods ==========

    public String getReliabilityColor() {
        if (reliabilityScore == null) return "gray";
        if (reliabilityScore >= 70) return "green";
        if (reliabilityScore >= 40) return "yellow";
        return "red";
    }

    public String getSentimentEmoji() {
        if (sentimentLabel == null) return "⚪";
        return switch (sentimentLabel.toLowerCase()) {
            case "positive" -> "😊";
            case "negative" -> "😠";
            default -> "😐";
        };
    }

    public boolean needsFactCheck() {
        return misinfoRisk != null && 
               (misinfoRisk.equals("high") || misinfoRisk.equals("mid"));
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/analysis/ArticleDiscussion.java

```java
package com.newsinsight.collector.entity.analysis;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 기사 관련 커뮤니티/댓글/여론 분석 결과 엔티티.
 * 
 * 포털 댓글, SNS, 커뮤니티 등에서 수집된 반응 데이터를 분석하여 저장.
 */
@Entity
@Table(name = "article_discussion", indexes = {
    @Index(name = "idx_discussion_article_id", columnList = "article_id"),
    @Index(name = "idx_discussion_sentiment", columnList = "overall_sentiment"),
    @Index(name = "idx_discussion_updated", columnList = "updated_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ArticleDiscussion {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 분석 대상 기사 ID
     */
    @Column(name = "article_id", nullable = false, unique = true)
    private Long articleId;

    // ========== 수집 메타데이터 ==========

    /**
     * 총 댓글/반응 수
     */
    @Column(name = "total_comment_count")
    @Builder.Default
    private Integer totalCommentCount = 0;

    /**
     * 분석된 댓글 수
     */
    @Column(name = "analyzed_count")
    @Builder.Default
    private Integer analyzedCount = 0;

    /**
     * 수집 플랫폼 목록
     * ["portal_comments", "twitter", "community_dcinside", "community_fmkorea"]
     */
    @Column(name = "platforms", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> platforms;

    /**
     * 플랫폼별 댓글 수
     * {"portal_comments": 150, "twitter": 45, "community": 80}
     */
    @Column(name = "platform_counts", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Integer> platformCounts;

    // ========== 전체 감정 분석 ==========

    /**
     * 전체 감정 레이블 (positive, negative, neutral, mixed)
     */
    @Column(name = "overall_sentiment", length = 20)
    private String overallSentiment;

    /**
     * 감정 분포
     * {"positive": 0.2, "negative": 0.6, "neutral": 0.2}
     */
    @Column(name = "sentiment_distribution", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Double> sentimentDistribution;

    /**
     * 세부 감정 분석 (분노, 슬픔, 불안, 기쁨 등)
     * {"anger": 0.4, "anxiety": 0.2, "sadness": 0.15, "joy": 0.1, "surprise": 0.15}
     */
    @Column(name = "emotion_distribution", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Double> emotionDistribution;

    /**
     * 지배적 감정
     */
    @Column(name = "dominant_emotion", length = 30)
    private String dominantEmotion;

    // ========== 스탠스/입장 분석 ==========

    /**
     * 찬반 분포
     * {"agree": 0.3, "disagree": 0.5, "neutral": 0.2}
     */
    @Column(name = "stance_distribution", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Double> stanceDistribution;

    /**
     * 전체적인 여론 방향 (supportive, opposing, divided, neutral)
     */
    @Column(name = "overall_stance", length = 30)
    private String overallStance;

    // ========== 독성/품질 분석 ==========

    /**
     * 전체 독성 점수 (0 ~ 1)
     */
    @Column(name = "toxicity_score")
    private Double toxicityScore;

    /**
     * 혐오발언 비율
     */
    @Column(name = "hate_speech_ratio")
    private Double hateSpeechRatio;

    /**
     * 욕설 비율
     */
    @Column(name = "profanity_ratio")
    private Double profanityRatio;

    /**
     * 여론 건전성 점수 (0 ~ 100)
     */
    @Column(name = "discussion_quality_score")
    private Double discussionQualityScore;

    // ========== 키워드/토픽 ==========

    /**
     * 상위 키워드
     * [{"word": "정부", "count": 45}, {"word": "반대", "count": 32}]
     */
    @Column(name = "top_keywords", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> topKeywords;

    /**
     * 댓글에서만 언급되는 이슈 (기사에 없는 관점)
     * ["언론이 숨기는 진실", "과거 사례 비교"]
     */
    @Column(name = "emerging_topics", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> emergingTopics;

    // ========== 시계열 분석 ==========

    /**
     * 시간대별 여론 변화
     * [{"hour": "2025-01-15T10:00", "sentiment": -0.3, "volume": 25}, ...]
     */
    @Column(name = "time_series", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> timeSeries;

    /**
     * 여론 반전 시점 (있는 경우)
     */
    @Column(name = "sentiment_shift_at")
    private LocalDateTime sentimentShiftAt;

    /**
     * 피크 시점 (가장 많은 반응이 있던 시간)
     */
    @Column(name = "peak_activity_at")
    private LocalDateTime peakActivityAt;

    // ========== 조작/봇 탐지 ==========

    /**
     * 의심스러운 패턴 탐지 여부
     */
    @Column(name = "suspicious_pattern_detected")
    @Builder.Default
    private Boolean suspiciousPatternDetected = false;

    /**
     * 봇/조작 의심 점수 (0 ~ 1)
     */
    @Column(name = "bot_likelihood_score")
    private Double botLikelihoodScore;

    /**
     * 탐지된 의심 패턴 목록
     * ["repeated_text", "coordinated_posting", "new_account_surge"]
     */
    @Column(name = "suspicious_patterns", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> suspiciousPatterns;

    // ========== 대표 댓글 ==========

    /**
     * 대표 긍정 댓글 샘플
     */
    @Column(name = "sample_positive_comments", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> samplePositiveComments;

    /**
     * 대표 부정 댓글 샘플
     */
    @Column(name = "sample_negative_comments", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> sampleNegativeComments;

    /**
     * 가장 많은 공감을 받은 댓글
     */
    @Column(name = "top_engaged_comments", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> topEngagedComments;

    // ========== 플랫폼별 비교 ==========

    /**
     * 플랫폼별 감정 비교
     * {"portal": {"positive": 0.3, "negative": 0.5}, "twitter": {"positive": 0.4, ...}}
     */
    @Column(name = "platform_sentiment_comparison", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Map<String, Double>> platformSentimentComparison;

    // ========== 메타데이터 ==========

    /**
     * 분석에 사용된 Add-on
     */
    @Column(name = "analyzed_by", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> analyzedBy;

    /**
     * 마지막 크롤링 시점
     */
    @Column(name = "last_crawled_at")
    private LocalDateTime lastCrawledAt;

    /**
     * 생성일시
     */
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    /**
     * 마지막 업데이트
     */
    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    // ========== Helper Methods ==========

    public String getSentimentSummary() {
        if (sentimentDistribution == null) return "분석 대기 중";
        
        double negative = sentimentDistribution.getOrDefault("negative", 0.0);
        double positive = sentimentDistribution.getOrDefault("positive", 0.0);
        
        if (negative > 0.6) return "부정적 여론 우세";
        if (positive > 0.6) return "긍정적 여론 우세";
        if (Math.abs(negative - positive) < 0.1) return "여론 분분";
        return "중립적";
    }

    public boolean isControversial() {
        if (stanceDistribution == null) return false;
        double agree = stanceDistribution.getOrDefault("agree", 0.0);
        double disagree = stanceDistribution.getOrDefault("disagree", 0.0);
        return Math.abs(agree - disagree) < 0.2 && (agree + disagree) > 0.6;
    }

    public String getDiscussionHealthGrade() {
        if (discussionQualityScore == null) return "N/A";
        if (discussionQualityScore >= 70) return "양호";
        if (discussionQualityScore >= 40) return "보통";
        return "주의";
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/autocrawl/ContentType.java

```java
package com.newsinsight.collector.entity.autocrawl;

/**
 * 예상 콘텐츠 타입
 */
public enum ContentType {
    /**
     * 뉴스 기사
     */
    NEWS,
    
    /**
     * 블로그/개인 사이트
     */
    BLOG,
    
    /**
     * 포럼/커뮤니티
     */
    FORUM,
    
    /**
     * 소셜 미디어
     */
    SOCIAL,
    
    /**
     * 공식 문서/보고서
     */
    OFFICIAL,
    
    /**
     * 학술/연구
     */
    ACADEMIC,
    
    /**
     * 미분류
     */
    UNKNOWN
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/autocrawl/CrawlTarget.java

```java
package com.newsinsight.collector.entity.autocrawl;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * 자동 크롤링 대상 URL 엔티티.
 * 검색, 기사 분석, 외부 링크 등에서 자동으로 발견된 URL을 관리합니다.
 */
@Entity
@Table(name = "crawl_targets", indexes = {
        @Index(name = "idx_crawl_target_url_hash", columnList = "urlHash"),
        @Index(name = "idx_crawl_target_status", columnList = "status"),
        @Index(name = "idx_crawl_target_priority", columnList = "priority DESC"),
        @Index(name = "idx_crawl_target_discovered", columnList = "discoveredAt DESC")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CrawlTarget {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 크롤링 대상 URL
     */
    @Column(nullable = false, columnDefinition = "TEXT")
    private String url;

    /**
     * URL 해시 (중복 체크용)
     */
    @Column(nullable = false, length = 64)
    private String urlHash;

    /**
     * 발견 출처 (SEARCH, ARTICLE_LINK, TRENDING, RSS_MENTION, MANUAL, DEEP_SEARCH)
     */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private DiscoverySource discoverySource;

    /**
     * 발견 컨텍스트 (검색어, 원본 기사 ID 등)
     */
    @Column(columnDefinition = "TEXT")
    private String discoveryContext;

    /**
     * 크롤링 우선순위 (0-100, 높을수록 우선)
     */
    @Column(nullable = false)
    @Builder.Default
    private Integer priority = 50;

    /**
     * 상태
     */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private CrawlTargetStatus status = CrawlTargetStatus.PENDING;

    /**
     * 도메인 (파싱된 호스트)
     */
    @Column(length = 255)
    private String domain;

    /**
     * 예상 콘텐츠 타입 (NEWS, BLOG, FORUM, SOCIAL, UNKNOWN)
     */
    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    @Builder.Default
    private ContentType expectedContentType = ContentType.UNKNOWN;

    /**
     * 관련 키워드 (쉼표 구분)
     */
    @Column(columnDefinition = "TEXT")
    private String relatedKeywords;

    /**
     * 재시도 횟수
     */
    @Column(nullable = false)
    @Builder.Default
    private Integer retryCount = 0;

    /**
     * 최대 재시도 횟수
     */
    @Column(nullable = false)
    @Builder.Default
    private Integer maxRetries = 3;

    /**
     * 마지막 시도 시각
     */
    private LocalDateTime lastAttemptAt;

    /**
     * 다음 시도 가능 시각 (재시도 백오프용)
     */
    private LocalDateTime nextAttemptAfter;

    /**
     * 마지막 오류 메시지
     */
    @Column(columnDefinition = "TEXT")
    private String lastError;

    /**
     * 크롤링 성공 시 저장된 CollectedData ID
     */
    private Long collectedDataId;

    /**
     * 발견 시각
     */
    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private LocalDateTime discoveredAt;

    /**
     * 마지막 수정 시각
     */
    @UpdateTimestamp
    private LocalDateTime updatedAt;

    /**
     * 처리 완료 시각
     */
    private LocalDateTime completedAt;

    // ========================================
    // 유틸리티 메서드
    // ========================================

    public void markInProgress() {
        this.status = CrawlTargetStatus.IN_PROGRESS;
        this.lastAttemptAt = LocalDateTime.now();
    }

    public void markCompleted(Long collectedDataId) {
        this.status = CrawlTargetStatus.COMPLETED;
        this.completedAt = LocalDateTime.now();
        this.collectedDataId = collectedDataId;
    }

    public void markFailed(String error) {
        this.retryCount++;
        this.lastError = error;
        this.lastAttemptAt = LocalDateTime.now();

        if (this.retryCount >= this.maxRetries) {
            this.status = CrawlTargetStatus.FAILED;
        } else {
            this.status = CrawlTargetStatus.PENDING;
            // 지수 백오프: 2^retry * 5분
            int delayMinutes = (int) Math.pow(2, this.retryCount) * 5;
            this.nextAttemptAfter = LocalDateTime.now().plusMinutes(delayMinutes);
        }
    }

    public void markSkipped(String reason) {
        this.status = CrawlTargetStatus.SKIPPED;
        this.lastError = reason;
        this.completedAt = LocalDateTime.now();
    }

    public boolean isRetryable() {
        if (status != CrawlTargetStatus.PENDING) return false;
        if (retryCount >= maxRetries) return false;
        if (nextAttemptAfter != null && LocalDateTime.now().isBefore(nextAttemptAfter)) return false;
        return true;
    }

    /**
     * 우선순위 부스트 (특정 조건에서 우선순위 상승)
     */
    public void boostPriority(int amount) {
        this.priority = Math.min(100, this.priority + amount);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/autocrawl/CrawlTargetStatus.java

```java
package com.newsinsight.collector.entity.autocrawl;

/**
 * 크롤링 대상 URL 상태
 */
public enum CrawlTargetStatus {
    /**
     * 대기 중 (처리 가능)
     */
    PENDING,
    
    /**
     * 처리 중
     */
    IN_PROGRESS,
    
    /**
     * 완료
     */
    COMPLETED,
    
    /**
     * 실패 (재시도 횟수 초과)
     */
    FAILED,
    
    /**
     * 건너뜀 (중복, 블랙리스트 등)
     */
    SKIPPED,
    
    /**
     * 취소됨
     */
    CANCELLED,
    
    /**
     * 만료됨 (오래 대기 중인 상태로 방치됨)
     */
    EXPIRED
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/autocrawl/DiscoverySource.java

```java
package com.newsinsight.collector.entity.autocrawl;

/**
 * 크롤링 대상 URL 발견 출처
 */
public enum DiscoverySource {
    /**
     * 사용자 검색 결과에서 발견
     */
    SEARCH,
    
    /**
     * 기사 본문 내 외부 링크에서 발견
     */
    ARTICLE_LINK,
    
    /**
     * 트렌딩 토픽/급상승 검색어에서 발견
     */
    TRENDING,
    
    /**
     * RSS 피드 본문 내 언급에서 발견
     */
    RSS_MENTION,
    
    /**
     * Deep Search 결과에서 발견
     */
    DEEP_SEARCH,
    
    /**
     * AI 분석 추천 URL
     */
    AI_RECOMMENDATION,
    
    /**
     * 관리자 수동 등록
     */
    MANUAL,
    
    /**
     * 외부 API에서 수신
     */
    EXTERNAL_API
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/browser/BrowserJobHistory.java

```java
package com.newsinsight.collector.entity.browser;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Entity for storing Browser-Use automation job history.
 * Tracks all browser automation tasks with their results,
 * screenshots, and extracted data.
 */
@Entity
@Table(name = "browser_job_history", indexes = {
        @Index(name = "idx_browser_job_job_id", columnList = "job_id"),
        @Index(name = "idx_browser_job_user_id", columnList = "user_id"),
        @Index(name = "idx_browser_job_status", columnList = "status"),
        @Index(name = "idx_browser_job_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BrowserJobHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Unique job ID from browser-use service
     */
    @Column(name = "job_id", length = 64, unique = true)
    private String jobId;

    /**
     * Task description
     */
    @Column(name = "task", nullable = false, length = 2048)
    private String task;

    /**
     * Target URL if specified
     */
    @Column(name = "target_url", length = 2048)
    private String targetUrl;

    /**
     * User ID
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Session ID
     */
    @Column(name = "session_id", length = 64)
    private String sessionId;

    /**
     * Job status
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 32)
    @Builder.Default
    private BrowserJobStatus status = BrowserJobStatus.PENDING;

    /**
     * Job result/output
     */
    @Column(name = "result", columnDefinition = "text")
    private String result;

    /**
     * Structured result data
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "result_data", columnDefinition = "jsonb")
    private Map<String, Object> resultData;

    /**
     * Extracted data (forms, tables, etc.)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "extracted_data", columnDefinition = "jsonb")
    private List<Map<String, Object>> extractedData;

    /**
     * Screenshot file paths or URLs
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "screenshots", columnDefinition = "jsonb")
    private List<String> screenshots;

    /**
     * Action history/steps taken
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "action_history", columnDefinition = "jsonb")
    private List<Map<String, Object>> actionHistory;

    /**
     * Error message if failed
     */
    @Column(name = "error_message", length = 2048)
    private String errorMessage;

    /**
     * Number of steps executed
     */
    @Column(name = "steps_count")
    @Builder.Default
    private Integer stepsCount = 0;

    /**
     * Execution time in milliseconds
     */
    @Column(name = "duration_ms")
    private Long durationMs;

    /**
     * Browser agent configuration used
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "agent_config", columnDefinition = "jsonb")
    private Map<String, Object> agentConfig;

    /**
     * Related search history ID
     */
    @Column(name = "search_history_id")
    private Long searchHistoryId;

    /**
     * Project ID if associated with a project
     */
    @Column(name = "project_id")
    private Long projectId;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @Column(name = "started_at")
    private LocalDateTime startedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    /**
     * Mark job as started
     */
    public void markStarted() {
        this.status = BrowserJobStatus.RUNNING;
        this.startedAt = LocalDateTime.now();
    }

    /**
     * Mark job as completed
     */
    public void markCompleted(String result, Map<String, Object> resultData) {
        this.status = BrowserJobStatus.COMPLETED;
        this.result = result;
        this.resultData = resultData;
        this.completedAt = LocalDateTime.now();
        if (startedAt != null) {
            this.durationMs = java.time.Duration.between(startedAt, completedAt).toMillis();
        }
    }

    /**
     * Mark job as failed
     */
    public void markFailed(String errorMessage) {
        this.status = BrowserJobStatus.FAILED;
        this.errorMessage = errorMessage;
        this.completedAt = LocalDateTime.now();
        if (startedAt != null) {
            this.durationMs = java.time.Duration.between(startedAt, completedAt).toMillis();
        }
    }

    /**
     * Job status enum
     */
    public enum BrowserJobStatus {
        PENDING,
        RUNNING,
        WAITING_HUMAN,
        COMPLETED,
        FAILED,
        CANCELLED,
        TIMEOUT
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/chat/ChatHistory.java

```java
package com.newsinsight.collector.entity.chat;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * 채팅 이력 (PostgreSQL)
 * 
 * MongoDB에서 동기화된 채팅 메시지를 RDB에 저장합니다.
 * 검색, 분석, 보고서 생성 등에 활용됩니다.
 */
@Entity
@Table(name = "chat_history", indexes = {
        @Index(name = "idx_chat_session_id", columnList = "session_id"),
        @Index(name = "idx_chat_user_id", columnList = "user_id"),
        @Index(name = "idx_chat_role", columnList = "role"),
        @Index(name = "idx_chat_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ChatHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * MongoDB 세션 ID
     */
    @Column(name = "session_id", nullable = false, length = 64)
    private String sessionId;

    /**
     * MongoDB 메시지 ID
     */
    @Column(name = "message_id", nullable = false, length = 64)
    private String messageId;

    /**
     * 사용자 ID
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * 메시지 역할
     */
    @Column(nullable = false, length = 32)
    private String role; // user, assistant, system

    /**
     * 메시지 내용
     */
    @Column(columnDefinition = "TEXT")
    private String content;

    /**
     * 메시지 타입
     */
    @Column(name = "message_type", length = 32)
    private String messageType;

    /**
     * 메시지 메타데이터 (JSON)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * 메시지 생성 시간
     */
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    /**
     * 벡터 임베딩 ID (참조용)
     */
    @Column(name = "embedding_id", length = 64)
    private String embeddingId;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/chat/FactCheckChatSession.java

```java
package com.newsinsight.collector.entity.chat;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.Id;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.annotation.Version;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.CompoundIndexes;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.io.Serializable;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 팩트체크 챗봇 세션 (MongoDB)
 * 
 * 채팅 세션 정보와 대화 이력을 저장합니다.
 * 
 * 개선사항:
 * - 복합 인덱스 추가
 * - 버전 관리 (낙관적 락)
 * - Audit 필드 추가
 * - 메시지 타입 세분화
 * - 직렬화 지원
 */
@Document(collection = "factcheck_chat_sessions")
@CompoundIndexes({
    @CompoundIndex(name = "idx_user_status", def = "{'userId': 1, 'status': 1}"),
    @CompoundIndex(name = "idx_status_sync", def = "{'status': 1, 'syncedToRdb': 1}"),
    @CompoundIndex(name = "idx_status_embed", def = "{'status': 1, 'embeddedToVectorDb': 1}"),
    @CompoundIndex(name = "idx_activity_status", def = "{'lastActivityAt': 1, 'status': 1}")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FactCheckChatSession implements Serializable {

    private static final long serialVersionUID = 1L;

    @Id
    private String id; // MongoDB ObjectId

    /**
     * 세션 ID (UUID)
     */
    @Indexed(unique = true)
    private String sessionId;

    /**
     * 사용자 ID (선택)
     */
    @Indexed
    private String userId;

    /**
     * 세션 시작 시간
     */
    @CreatedDate
    @Indexed
    private LocalDateTime startedAt;

    /**
     * 마지막 활동 시간
     */
    @LastModifiedDate
    @Indexed
    private LocalDateTime lastActivityAt;

    /**
     * 세션 종료 시간
     */
    private LocalDateTime endedAt;

    /**
     * 세션 상태
     */
    @Indexed
    @Builder.Default
    private SessionStatus status = SessionStatus.ACTIVE;

    /**
     * 대화 메시지 목록
     */
    @Builder.Default
    private List<ChatMessage> messages = new ArrayList<>();

    /**
     * 세션 메타데이터
     */
    private SessionMetadata metadata;

    /**
     * RDB 동기화 여부
     */
    @Indexed
    @Builder.Default
    private boolean syncedToRdb = false;

    /**
     * 벡터 DB 임베딩 여부
     */
    @Indexed
    @Builder.Default
    private boolean embeddedToVectorDb = false;

    /**
     * 마지막 RDB 동기화 시간
     */
    private LocalDateTime lastSyncedAt;

    /**
     * 마지막 임베딩 시간
     */
    private LocalDateTime lastEmbeddedAt;

    /**
     * 동기화된 메시지 수
     */
    @Builder.Default
    private int syncedMessageCount = 0;

    /**
     * 임베딩된 메시지 수
     */
    @Builder.Default
    private int embeddedMessageCount = 0;

    /**
     * 버전 (낙관적 락용)
     */
    @Version
    private Long version;

    /**
     * 세션 상태
     */
    public enum SessionStatus {
        ACTIVE,      // 활성 - 대화 진행 중
        COMPLETED,   // 완료 - 사용자가 종료
        EXPIRED,     // 만료 - 비활성으로 인한 자동 만료
        ARCHIVED,    // 아카이브 - 장기 보관
        ERROR        // 에러 - 처리 중 오류 발생
    }

    /**
     * 채팅 메시지
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ChatMessage implements Serializable {
        private static final long serialVersionUID = 1L;
        
        private String messageId;
        private String role; // user, assistant, system
        private String content;
        private Long timestamp;
        private MessageType type;
        private Map<String, Object> metadata; // 추가 데이터 (증거, 검증 결과 등)
        
        // 추가 필드
        private Integer tokenCount; // 토큰 수 (비용 추적용)
        private Long processingTimeMs; // 처리 시간
        private String parentMessageId; // 부모 메시지 (스레드 지원)
        private Boolean synced; // RDB 동기화 여부
        private Boolean embedded; // 벡터 DB 임베딩 여부
    }

    /**
     * 메시지 타입
     */
    public enum MessageType {
        // 기본 메시지 타입
        MESSAGE,           // 일반 메시지
        SYSTEM,            // 시스템 메시지
        
        // 상태 관련
        STATUS,            // 상태 업데이트
        PROGRESS,          // 진행 상황
        
        // 팩트체크 관련
        CLAIM,             // 추출된 주장
        EVIDENCE,          // 수집된 증거
        VERIFICATION,      // 검증 결과
        ASSESSMENT,        // 신뢰도 평가
        
        // AI 관련
        AI_SYNTHESIS,      // AI 종합 분석
        AI_SUMMARY,        // AI 요약
        
        // 결과 관련
        COMPLETE,          // 완료
        ERROR,             // 에러
        WARNING,           // 경고
        
        // 피드백 관련
        FEEDBACK,          // 사용자 피드백
        RATING             // 평가
    }

    /**
     * 세션 메타데이터
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SessionMetadata implements Serializable {
        private static final long serialVersionUID = 1L;
        
        // 클라이언트 정보
        private String userAgent;
        private String ipAddress;
        private String language;
        private String timezone;
        private String platform; // web, mobile, api
        
        // 세션 통계
        private Integer messageCount;
        private Integer factCheckCount;
        private Integer errorCount;
        private Double averageResponseTime;
        private Long totalTokensUsed;
        
        // 첫 번째/마지막 주제
        private String firstTopic;
        private String lastTopic;
        
        // 세션 품질 지표
        private Double satisfactionScore; // 사용자 만족도 (1-5)
        private Boolean feedbackProvided; // 피드백 제공 여부
        
        // 기타
        private Map<String, Object> customData; // 커스텀 데이터
    }

    // =====================
    // 편의 메서드
    // =====================

    /**
     * 메시지 추가
     */
    public void addMessage(ChatMessage message) {
        if (messages == null) {
            messages = new ArrayList<>();
        }
        messages.add(message);
        updateMetadataOnMessage();
    }

    /**
     * 메시지 추가 후 메타데이터 업데이트
     */
    private void updateMetadataOnMessage() {
        if (metadata == null) {
            metadata = SessionMetadata.builder()
                    .messageCount(0)
                    .factCheckCount(0)
                    .errorCount(0)
                    .build();
        }
        metadata.setMessageCount(messages.size());
    }

    /**
     * 세션 종료
     */
    public void close() {
        this.status = SessionStatus.COMPLETED;
        this.endedAt = LocalDateTime.now();
    }

    /**
     * 세션 만료
     */
    public void expire() {
        this.status = SessionStatus.EXPIRED;
        this.endedAt = LocalDateTime.now();
    }

    /**
     * 활성 세션인지 확인
     */
    public boolean isActive() {
        return status == SessionStatus.ACTIVE;
    }

    /**
     * 동기화 필요 여부 확인
     */
    public boolean needsSync() {
        return !syncedToRdb && (status == SessionStatus.COMPLETED || status == SessionStatus.EXPIRED);
    }

    /**
     * 임베딩 필요 여부 확인
     */
    public boolean needsEmbedding() {
        return syncedToRdb && !embeddedToVectorDb;
    }

    /**
     * 마지막 사용자 메시지 조회
     */
    public ChatMessage getLastUserMessage() {
        if (messages == null || messages.isEmpty()) {
            return null;
        }
        for (int i = messages.size() - 1; i >= 0; i--) {
            if ("user".equals(messages.get(i).getRole())) {
                return messages.get(i);
            }
        }
        return null;
    }

    /**
     * 마지막 어시스턴트 메시지 조회
     */
    public ChatMessage getLastAssistantMessage() {
        if (messages == null || messages.isEmpty()) {
            return null;
        }
        for (int i = messages.size() - 1; i >= 0; i--) {
            if ("assistant".equals(messages.get(i).getRole())) {
                return messages.get(i);
            }
        }
        return null;
    }

    /**
     * 특정 타입의 메시지 수 조회
     */
    public long countMessagesByType(MessageType type) {
        if (messages == null) {
            return 0;
        }
        return messages.stream()
                .filter(m -> m.getType() == type)
                .count();
    }

    /**
     * 동기화되지 않은 메시지 조회
     */
    public List<ChatMessage> getUnsyncedMessages() {
        if (messages == null) {
            return new ArrayList<>();
        }
        return messages.stream()
                .filter(m -> m.getSynced() == null || !m.getSynced())
                .toList();
    }

    /**
     * 세션 지속 시간 (초)
     */
    public long getDurationSeconds() {
        if (startedAt == null) {
            return 0;
        }
        LocalDateTime end = endedAt != null ? endedAt : LocalDateTime.now();
        return java.time.Duration.between(startedAt, end).getSeconds();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/feedback/SearchFeedback.java

```java
package com.newsinsight.collector.entity.feedback;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Entity for storing user feedback on search results.
 * Enables quality improvement through user ratings and comments.
 */
@Entity
@Table(name = "search_feedback", indexes = {
        @Index(name = "idx_feedback_search_history_id", columnList = "search_history_id"),
        @Index(name = "idx_feedback_user_id", columnList = "user_id"),
        @Index(name = "idx_feedback_rating", columnList = "rating"),
        @Index(name = "idx_feedback_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchFeedback {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Related search history ID
     */
    @Column(name = "search_history_id", nullable = false)
    private Long searchHistoryId;

    /**
     * User who provided feedback
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Session ID for anonymous feedback
     */
    @Column(name = "session_id", length = 64)
    private String sessionId;

    /**
     * Overall rating (1-5 stars)
     */
    @Column(name = "rating")
    private Integer rating;

    /**
     * Usefulness rating (1-5)
     */
    @Column(name = "usefulness_rating")
    private Integer usefulnessRating;

    /**
     * Accuracy rating (1-5)
     */
    @Column(name = "accuracy_rating")
    private Integer accuracyRating;

    /**
     * Relevance rating (1-5)
     */
    @Column(name = "relevance_rating")
    private Integer relevanceRating;

    /**
     * User's comment/feedback text
     */
    @Column(name = "comment", length = 2048)
    private String comment;

    /**
     * Improvement suggestions
     */
    @Column(name = "suggestions", length = 2048)
    private String suggestions;

    /**
     * Feedback type
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "feedback_type", length = 32)
    @Builder.Default
    private FeedbackType feedbackType = FeedbackType.GENERAL;

    /**
     * Specific result index being rated (for individual result feedback)
     */
    @Column(name = "result_index")
    private Integer resultIndex;

    /**
     * Specific result URL being rated
     */
    @Column(name = "result_url", length = 2048)
    private String resultUrl;

    /**
     * Quick feedback (thumbs up/down)
     */
    @Column(name = "thumbs_up")
    private Boolean thumbsUp;

    /**
     * Issue categories selected
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "issue_categories", columnDefinition = "jsonb")
    private java.util.List<String> issueCategories;

    /**
     * Additional metadata
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * Whether feedback has been reviewed by admin
     */
    @Column(name = "reviewed")
    @Builder.Default
    private Boolean reviewed = false;

    /**
     * Review notes by admin
     */
    @Column(name = "review_notes", length = 1024)
    private String reviewNotes;

    /**
     * Whether this feedback was used for model improvement
     */
    @Column(name = "used_for_training")
    @Builder.Default
    private Boolean usedForTraining = false;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    /**
     * Feedback type enum
     */
    public enum FeedbackType {
        /** General search feedback */
        GENERAL,
        /** Feedback on specific result */
        RESULT_SPECIFIC,
        /** AI summary feedback */
        AI_SUMMARY,
        /** Fact-check accuracy feedback */
        FACT_CHECK,
        /** Report quality feedback */
        REPORT,
        /** Bug report */
        BUG_REPORT,
        /** Feature request */
        FEATURE_REQUEST
    }

    /**
     * Calculate average rating
     */
    public Double getAverageRating() {
        int count = 0;
        int sum = 0;
        
        if (usefulnessRating != null) { sum += usefulnessRating; count++; }
        if (accuracyRating != null) { sum += accuracyRating; count++; }
        if (relevanceRating != null) { sum += relevanceRating; count++; }
        
        // @CHECK 
        // 평균 평가점수 계산 - 평가점수가 하나라도 있는 경우 평균 평가점수를 반환, 그렇지 않으면 0을 반환
        return count > 0 ? (double) sum / count : (rating != null ? rating.doubleValue() : (double) 0);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/project/Project.java

```java
package com.newsinsight.collector.entity.project;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Entity representing a user's project workspace.
 * Projects allow users to organize searches, collect news,
 * and collaborate on specific topics over time.
 */
@Entity
@Table(name = "projects", indexes = {
        @Index(name = "idx_project_owner_id", columnList = "owner_id"),
        @Index(name = "idx_project_status", columnList = "status"),
        @Index(name = "idx_project_category", columnList = "category"),
        @Index(name = "idx_project_created_at", columnList = "created_at"),
        @Index(name = "idx_project_last_activity", columnList = "last_activity_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Project {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Project name
     */
    @Column(name = "name", nullable = false, length = 255)
    private String name;

    /**
     * Project description
     */
    @Column(name = "description", length = 2048)
    private String description;

    /**
     * Keywords for automatic collection
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "keywords", columnDefinition = "jsonb")
    private List<String> keywords;

    /**
     * Project category
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "category", length = 32)
    @Builder.Default
    private ProjectCategory category = ProjectCategory.CUSTOM;

    /**
     * Project status
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 32)
    @Builder.Default
    private ProjectStatus status = ProjectStatus.ACTIVE;

    /**
     * Project visibility
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "visibility", length = 32)
    @Builder.Default
    private ProjectVisibility visibility = ProjectVisibility.PRIVATE;

    /**
     * Project owner ID
     */
    @Column(name = "owner_id", nullable = false, length = 64)
    private String ownerId;

    /**
     * Project color for UI
     */
    @Column(name = "color", length = 16)
    private String color;

    /**
     * Project icon name
     */
    @Column(name = "icon", length = 32)
    private String icon;

    /**
     * Whether this is the default project for the user
     */
    @Column(name = "is_default")
    @Builder.Default
    private Boolean isDefault = false;

    /**
     * Project settings
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "settings", columnDefinition = "jsonb")
    private ProjectSettings settings;

    /**
     * Project statistics (cached)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "stats", columnDefinition = "jsonb")
    private Map<String, Object> stats;

    /**
     * Tags for organization
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "tags", columnDefinition = "jsonb")
    private List<String> tags;

    /**
     * Custom metadata
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @Column(name = "last_activity_at")
    private LocalDateTime lastActivityAt;

    /**
     * When auto-collection last ran
     */
    @Column(name = "last_collected_at")
    private LocalDateTime lastCollectedAt;

    // ============ Enums ============

    public enum ProjectCategory {
        /** Research/Investigation project */
        RESEARCH,
        /** Continuous monitoring project */
        MONITORING,
        /** Fact-checking project */
        FACT_CHECK,
        /** Trend analysis project */
        TREND_ANALYSIS,
        /** Custom/other project */
        CUSTOM
    }

    public enum ProjectStatus {
        /** Active project */
        ACTIVE,
        /** Temporarily paused */
        PAUSED,
        /** Completed project */
        COMPLETED,
        /** Archived project */
        ARCHIVED
    }

    public enum ProjectVisibility {
        /** Only owner can see */
        PRIVATE,
        /** Team members can see */
        TEAM,
        /** Anyone with link can see */
        PUBLIC
    }

    // ============ Embedded classes ============

    /**
     * Project settings configuration
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ProjectSettings {
        /** Enable automatic news collection */
        @Builder.Default
        private Boolean autoCollect = false;
        
        /** Collection interval */
        @Builder.Default
        private String collectInterval = "daily"; // hourly, daily, weekly
        
        /** News sources to collect from */
        private List<String> collectSources;
        
        /** Time window for collection */
        @Builder.Default
        private String timeWindow = "7d";
        
        /** Notification settings */
        private NotificationSettings notifications;
        
        /** AI analysis settings */
        private AiAnalysisSettings aiAnalysis;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class NotificationSettings {
        @Builder.Default
        private Boolean newArticles = true;
        @Builder.Default
        private Boolean importantUpdates = true;
        @Builder.Default
        private Boolean weeklyDigest = false;
        @Builder.Default
        private Boolean emailEnabled = false;
        private String slackWebhook;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AiAnalysisSettings {
        @Builder.Default
        private Boolean enabled = true;
        @Builder.Default
        private Boolean autoSummarize = true;
        @Builder.Default
        private Boolean sentimentTracking = true;
        @Builder.Default
        private Boolean trendDetection = true;
        @Builder.Default
        private Boolean factCheck = false;
    }

    // ============ Helper methods ============

    /**
     * Update last activity timestamp
     */
    public void touchActivity() {
        this.lastActivityAt = LocalDateTime.now();
    }

    /**
     * Check if auto-collection is enabled
     */
    public boolean isAutoCollectEnabled() {
        return settings != null && Boolean.TRUE.equals(settings.getAutoCollect());
    }

    /**
     * Archive the project
     */
    public void archive() {
        this.status = ProjectStatus.ARCHIVED;
    }

    /**
     * Pause the project
     */
    public void pause() {
        this.status = ProjectStatus.PAUSED;
    }

    /**
     * Activate the project
     */
    public void activate() {
        this.status = ProjectStatus.ACTIVE;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/project/ProjectActivityLog.java

```java
package com.newsinsight.collector.entity.project;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Entity for tracking project activity.
 * Provides audit trail and activity feed for collaborative projects.
 */
@Entity
@Table(name = "project_activity_log", indexes = {
        @Index(name = "idx_pal_project_id", columnList = "project_id"),
        @Index(name = "idx_pal_user_id", columnList = "user_id"),
        @Index(name = "idx_pal_type", columnList = "activity_type"),
        @Index(name = "idx_pal_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProjectActivityLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Project ID
     */
    @Column(name = "project_id", nullable = false)
    private Long projectId;

    /**
     * User who performed the action
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Activity type
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "activity_type", nullable = false, length = 64)
    private ActivityType activityType;

    /**
     * Human-readable description
     */
    @Column(name = "description", length = 1024)
    private String description;

    /**
     * Related entity type (e.g., "item", "member", "search")
     */
    @Column(name = "entity_type", length = 64)
    private String entityType;

    /**
     * Related entity ID
     */
    @Column(name = "entity_id", length = 255)
    private String entityId;

    /**
     * Additional metadata/context
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * Changes made (for updates)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "changes", columnDefinition = "jsonb")
    private Map<String, Object> changes;

    /**
     * IP address for audit
     */
    @Column(name = "ip_address", length = 64)
    private String ipAddress;

    /**
     * User agent for audit
     */
    @Column(name = "user_agent", length = 512)
    private String userAgent;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    // ============ Enums ============

    public enum ActivityType {
        // Project lifecycle
        PROJECT_CREATED,
        PROJECT_UPDATED,
        PROJECT_ARCHIVED,
        PROJECT_DELETED,
        PROJECT_RESTORED,
        PROJECT_STATUS_CHANGED,
        
        // Member management
        MEMBER_ADDED,
        MEMBER_INVITED,
        MEMBER_JOINED,
        MEMBER_ROLE_CHANGED,
        MEMBER_REMOVED,
        MEMBER_LEFT,
        
        // Item management
        ITEM_ADDED,
        ITEM_UPDATED,
        ITEM_DELETED,
        ITEM_BOOKMARKED,
        ITEM_TAGGED,
        
        // Search activities
        SEARCH_EXECUTED,
        SEARCH_SAVED,
        SEARCH_SHARED,
        
        // Report activities
        REPORT_GENERATED,
        REPORT_DOWNLOADED,
        REPORT_SHARED,
        
        // Collection activities
        AUTO_COLLECT_RAN,
        AUTO_COLLECTION,
        MANUAL_COLLECTION,
        ITEMS_COLLECTED,
        COLLECTION_FAILED,
        
        // Settings
        SETTINGS_CHANGED,
        KEYWORDS_UPDATED,
        NOTIFICATIONS_CHANGED,
        
        // Comments
        COMMENT_ADDED,
        COMMENT_EDITED,
        COMMENT_DELETED
    }

    // ============ Static factory methods ============

    public static ProjectActivityLog projectCreated(Long projectId, String userId, String projectName) {
        return ProjectActivityLog.builder()
                .projectId(projectId)
                .userId(userId)
                .activityType(ActivityType.PROJECT_CREATED)
                .description("프로젝트 '" + projectName + "'이(가) 생성되었습니다")
                .build();
    }

    public static ProjectActivityLog memberInvited(Long projectId, String userId, String invitedUserId, String role) {
        return ProjectActivityLog.builder()
                .projectId(projectId)
                .userId(userId)
                .activityType(ActivityType.MEMBER_INVITED)
                .description("새 멤버가 " + role + " 역할로 초대되었습니다")
                .entityType("member")
                .entityId(invitedUserId)
                .metadata(Map.of("invitedUserId", invitedUserId, "role", role))
                .build();
    }

    public static ProjectActivityLog itemAdded(Long projectId, String userId, Long itemId, String itemTitle) {
        return ProjectActivityLog.builder()
                .projectId(projectId)
                .userId(userId)
                .activityType(ActivityType.ITEM_ADDED)
                .description("새 항목이 추가되었습니다: " + itemTitle)
                .entityType("item")
                .entityId(String.valueOf(itemId))
                .build();
    }

    public static ProjectActivityLog searchExecuted(Long projectId, String userId, String query, int resultCount) {
        return ProjectActivityLog.builder()
                .projectId(projectId)
                .userId(userId)
                .activityType(ActivityType.SEARCH_EXECUTED)
                .description("검색 실행: '" + query + "' (" + resultCount + "개 결과)")
                .metadata(Map.of("query", query, "resultCount", resultCount))
                .build();
    }

    public static ProjectActivityLog autoCollectRan(Long projectId, int itemsCollected) {
        return ProjectActivityLog.builder()
                .projectId(projectId)
                .activityType(ActivityType.AUTO_COLLECT_RAN)
                .description("자동 수집 완료: " + itemsCollected + "개 항목 수집")
                .metadata(Map.of("itemsCollected", itemsCollected))
                .build();
    }

    public static ProjectActivityLog reportGenerated(Long projectId, String userId, Long reportId, String reportTitle) {
        return ProjectActivityLog.builder()
                .projectId(projectId)
                .userId(userId)
                .activityType(ActivityType.REPORT_GENERATED)
                .description("보고서 생성: " + reportTitle)
                .entityType("report")
                .entityId(String.valueOf(reportId))
                .build();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/project/ProjectItem.java

```java
package com.newsinsight.collector.entity.project;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Entity representing an item within a project.
 * Can be a collected article, search result, report, or note.
 */
@Entity
@Table(name = "project_items", indexes = {
        @Index(name = "idx_pi_project_id", columnList = "project_id"),
        @Index(name = "idx_pi_type", columnList = "item_type"),
        @Index(name = "idx_pi_source_id", columnList = "source_id"),
        @Index(name = "idx_pi_added_at", columnList = "added_at"),
        @Index(name = "idx_pi_published_at", columnList = "published_at"),
        @Index(name = "idx_pi_bookmarked", columnList = "bookmarked")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProjectItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Project ID
     */
    @Column(name = "project_id", nullable = false)
    private Long projectId;

    /**
     * Item type
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "item_type", nullable = false, length = 32)
    private ItemType itemType;

    /**
     * Source reference ID (SearchHistory ID, Article ID, etc.)
     */
    @Column(name = "source_id", length = 255)
    private String sourceId;

    /**
     * Source type identifier
     */
    @Column(name = "source_type", length = 64)
    private String sourceType;

    /**
     * Item title
     */
    @Column(name = "title", length = 512)
    private String title;

    /**
     * Item summary/excerpt
     */
    @Column(name = "summary", length = 4096)
    private String summary;

    /**
     * Full content (for notes, etc.)
     */
    @Column(name = "content", columnDefinition = "text")
    private String content;

    /**
     * Original URL
     */
    @Column(name = "url", length = 2048)
    private String url;

    /**
     * Thumbnail/image URL
     */
    @Column(name = "thumbnail_url", length = 1024)
    private String thumbnailUrl;

    /**
     * Original publish date
     */
    @Column(name = "published_at")
    private LocalDateTime publishedAt;

    /**
     * Source name (news outlet, etc.)
     */
    @Column(name = "source_name", length = 255)
    private String sourceName;

    /**
     * Author name
     */
    @Column(name = "author", length = 255)
    private String author;

    /**
     * User-defined tags
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "tags", columnDefinition = "jsonb")
    private List<String> tags;

    /**
     * Category within project
     */
    @Column(name = "category", length = 128)
    private String category;

    /**
     * Whether bookmarked/starred
     */
    @Column(name = "bookmarked")
    @Builder.Default
    private Boolean bookmarked = false;

    /**
     * Importance level (1-5)
     */
    @Column(name = "importance")
    private Integer importance;

    /**
     * User notes about this item
     */
    @Column(name = "notes", columnDefinition = "text")
    private String notes;

    /**
     * Read status
     */
    @Column(name = "is_read")
    @Builder.Default
    private Boolean isRead = false;

    /**
     * Sentiment score (-1 to 1)
     */
    @Column(name = "sentiment_score")
    private Double sentimentScore;

    /**
     * Sentiment label
     */
    @Column(name = "sentiment_label", length = 32)
    private String sentimentLabel;

    /**
     * Relevance score (0-100)
     */
    @Column(name = "relevance_score")
    private Double relevanceScore;

    /**
     * AI-generated analysis
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "ai_analysis", columnDefinition = "jsonb")
    private Map<String, Object> aiAnalysis;

    /**
     * Additional metadata
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * User who added this item
     */
    @Column(name = "added_by", length = 64)
    private String addedBy;

    @CreationTimestamp
    @Column(name = "added_at", updatable = false)
    private LocalDateTime addedAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    // ============ Enums ============

    public enum ItemType {
        /** News article */
        ARTICLE,
        /** Search result reference */
        SEARCH_RESULT,
        /** Generated report */
        REPORT,
        /** User note */
        NOTE,
        /** External URL/link */
        LINK,
        /** File attachment */
        FILE,
        /** Social media post */
        SOCIAL_POST
    }

    // ============ Helper methods ============

    /**
     * Mark as read
     */
    public void markRead() {
        this.isRead = true;
    }

    /**
     * Toggle bookmark
     */
    public void toggleBookmark() {
        this.bookmarked = !Boolean.TRUE.equals(this.bookmarked);
    }

    /**
     * Update importance
     */
    public void setImportanceLevel(int level) {
        this.importance = Math.max(1, Math.min(5, level));
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/project/ProjectMember.java

```java
package com.newsinsight.collector.entity.project;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Entity representing a project member.
 * Manages team access and permissions for collaborative projects.
 */
@Entity
@Table(name = "project_members", indexes = {
        @Index(name = "idx_pm_project_id", columnList = "project_id"),
        @Index(name = "idx_pm_user_id", columnList = "user_id"),
        @Index(name = "idx_pm_role", columnList = "role")
}, uniqueConstraints = {
        @UniqueConstraint(name = "uk_project_member", columnNames = {"project_id", "user_id"})
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProjectMember {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Project ID
     */
    @Column(name = "project_id", nullable = false)
    private Long projectId;

    /**
     * User ID
     */
    @Column(name = "user_id", nullable = false, length = 64)
    private String userId;

    /**
     * Member role
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "role", length = 32)
    @Builder.Default
    private MemberRole role = MemberRole.VIEWER;

    /**
     * Specific permissions (optional, overrides role defaults)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "permissions", columnDefinition = "jsonb")
    private List<String> permissions;

    /**
     * User who invited this member
     */
    @Column(name = "invited_by", length = 64)
    private String invitedBy;

    /**
     * Invitation status
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 32)
    @Builder.Default
    private MemberStatus status = MemberStatus.PENDING;

    /**
     * Invitation token (for email invites)
     */
    @Column(name = "invite_token", length = 128)
    private String inviteToken;

    /**
     * When the invitation expires
     */
    @Column(name = "invite_expires_at")
    private LocalDateTime inviteExpiresAt;

    @CreationTimestamp
    @Column(name = "joined_at", updatable = false)
    private LocalDateTime joinedAt;

    @Column(name = "last_active_at")
    private LocalDateTime lastActiveAt;

    // ============ Enums ============

    public enum MemberRole {
        /** Full control including delete */
        OWNER,
        /** Can manage members and settings */
        ADMIN,
        /** Can add/edit items */
        EDITOR,
        /** Read-only access */
        VIEWER
    }

    public enum MemberStatus {
        /** Invitation pending acceptance */
        PENDING,
        /** Active member */
        ACTIVE,
        /** Membership revoked */
        REVOKED,
        /** User left the project */
        LEFT
    }

    // ============ Permission constants ============

    public static class Permission {
        public static final String MANAGE_PROJECT = "manage_project";
        public static final String DELETE_PROJECT = "delete_project";
        public static final String INVITE_MEMBERS = "invite_members";
        public static final String REMOVE_MEMBERS = "remove_members";
        public static final String CHANGE_ROLES = "change_roles";
        public static final String ADD_ITEMS = "add_items";
        public static final String EDIT_ITEMS = "edit_items";
        public static final String DELETE_ITEMS = "delete_items";
        public static final String RUN_SEARCH = "run_search";
        public static final String GENERATE_REPORT = "generate_report";
        public static final String CHANGE_SETTINGS = "change_settings";
        public static final String VIEW_ANALYTICS = "view_analytics";
    }

    // ============ Helper methods ============

    /**
     * Check if member has a specific permission
     */
    public boolean hasPermission(String permission) {
        // Owner has all permissions
        if (role == MemberRole.OWNER) return true;
        
        // Check explicit permissions first
        if (permissions != null && permissions.contains(permission)) {
            return true;
        }
        
        // Check role-based permissions
        return switch (role) {
            case ADMIN -> !permission.equals(Permission.DELETE_PROJECT);
            case EDITOR -> permission.equals(Permission.ADD_ITEMS) 
                    || permission.equals(Permission.EDIT_ITEMS)
                    || permission.equals(Permission.RUN_SEARCH)
                    || permission.equals(Permission.GENERATE_REPORT)
                    || permission.equals(Permission.VIEW_ANALYTICS);
            case VIEWER -> permission.equals(Permission.VIEW_ANALYTICS);
            default -> false;
        };
    }

    /**
     * Accept invitation
     */
    public void accept() {
        this.status = MemberStatus.ACTIVE;
        this.inviteToken = null;
        this.inviteExpiresAt = null;
    }

    /**
     * Touch last active timestamp
     */
    public void touchActive() {
        this.lastActiveAt = LocalDateTime.now();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/project/ProjectNotification.java

```java
package com.newsinsight.collector.entity.project;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Entity for project notifications.
 * Manages alerts for project events like new articles, trend spikes, etc.
 */
@Entity
@Table(name = "project_notifications", indexes = {
        @Index(name = "idx_pn_project_id", columnList = "project_id"),
        @Index(name = "idx_pn_type", columnList = "notification_type"),
        @Index(name = "idx_pn_priority", columnList = "priority"),
        @Index(name = "idx_pn_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProjectNotification {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Project ID
     */
    @Column(name = "project_id", nullable = false)
    private Long projectId;

    /**
     * Target user ID (single recipient for simple notifications)
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Whether this notification has been read
     */
    @Column(name = "is_read")
    @Builder.Default
    private Boolean isRead = false;

    /**
     * Notification type
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "notification_type", nullable = false, length = 64)
    private NotificationType notificationType;

    /**
     * Priority level
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "priority", length = 32)
    @Builder.Default
    private NotificationPriority priority = NotificationPriority.MEDIUM;

    /**
     * Notification title
     */
    @Column(name = "title", nullable = false, length = 255)
    private String title;

    /**
     * Notification message
     */
    @Column(name = "message", length = 2048)
    private String message;

    /**
     * Action URL (click to navigate)
     */
    @Column(name = "action_url", length = 1024)
    private String actionUrl;

    /**
     * Action button label
     */
    @Column(name = "action_label", length = 64)
    private String actionLabel;

    /**
     * Recipients (user IDs)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "recipients", columnDefinition = "jsonb")
    private List<String> recipients;

    /**
     * Delivery channels
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "channels", columnDefinition = "jsonb")
    private List<String> channels;

    /**
     * Users who have read this notification
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "read_by", columnDefinition = "jsonb")
    private List<String> readBy;

    /**
     * Delivery status per channel
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "delivery_status", columnDefinition = "jsonb")
    private Map<String, Object> deliveryStatus;

    /**
     * Additional data
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * Whether notification has been dismissed by all
     */
    @Column(name = "dismissed")
    @Builder.Default
    private Boolean dismissed = false;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "sent_at")
    private LocalDateTime sentAt;

    @Column(name = "expires_at")
    private LocalDateTime expiresAt;

    // ============ Enums ============

    public enum NotificationType {
        /** New articles collected */
        NEW_ARTICLES,
        /** Significant trend change */
        TREND_SPIKE,
        /** Important news alert */
        IMPORTANT_UPDATE,
        /** Team member activity */
        MEMBER_ACTIVITY,
        /** Member invited to project */
        MEMBER_INVITED,
        /** Report ready for download */
        REPORT_READY,
        /** Collection completed */
        COLLECTION_COMPLETE,
        /** Collection failed */
        COLLECTION_FAILED,
        /** System notification */
        SYSTEM_ALERT,
        /** Weekly/monthly digest */
        DIGEST,
        /** Keyword match alert */
        KEYWORD_MATCH
    }

    public enum NotificationPriority {
        LOW,
        MEDIUM,
        HIGH,
        URGENT
    }

    public static class Channel {
        public static final String IN_APP = "in_app";
        public static final String EMAIL = "email";
        public static final String SLACK = "slack";
        public static final String WEBHOOK = "webhook";
        public static final String PUSH = "push";
    }

    // ============ Helper methods ============

    /**
     * Mark as read by user
     */
    public void markReadBy(String userId) {
        if (readBy == null) {
            readBy = new java.util.ArrayList<>();
        }
        if (!readBy.contains(userId)) {
            readBy.add(userId);
        }
    }

    /**
     * Check if read by user
     */
    public boolean isReadBy(String userId) {
        return readBy != null && readBy.contains(userId);
    }

    /**
     * Check if expired
     */
    public boolean isExpired() {
        return expiresAt != null && LocalDateTime.now().isAfter(expiresAt);
    }

    /**
     * Mark as sent
     */
    public void markSent() {
        this.sentAt = LocalDateTime.now();
    }

    // ============ Static factory methods ============

    public static ProjectNotification newArticles(Long projectId, int count, List<String> recipients) {
        return ProjectNotification.builder()
                .projectId(projectId)
                .notificationType(NotificationType.NEW_ARTICLES)
                .priority(NotificationPriority.MEDIUM)
                .title("새로운 기사 수집")
                .message(count + "개의 새로운 기사가 수집되었습니다")
                .recipients(recipients)
                .channels(List.of(Channel.IN_APP))
                .actionLabel("보기")
                .metadata(Map.of("articleCount", count))
                .build();
    }

    public static ProjectNotification trendSpike(Long projectId, String keyword, double changePercent, List<String> recipients) {
        return ProjectNotification.builder()
                .projectId(projectId)
                .notificationType(NotificationType.TREND_SPIKE)
                .priority(NotificationPriority.HIGH)
                .title("트렌드 급등 감지")
                .message("'" + keyword + "' 키워드가 " + String.format("%.1f", changePercent) + "% 증가했습니다")
                .recipients(recipients)
                .channels(List.of(Channel.IN_APP, Channel.EMAIL))
                .actionLabel("분석 보기")
                .metadata(Map.of("keyword", keyword, "changePercent", changePercent))
                .build();
    }

    public static ProjectNotification reportReady(Long projectId, Long reportId, String reportTitle, List<String> recipients) {
        return ProjectNotification.builder()
                .projectId(projectId)
                .notificationType(NotificationType.REPORT_READY)
                .priority(NotificationPriority.MEDIUM)
                .title("보고서 생성 완료")
                .message("'" + reportTitle + "' 보고서가 준비되었습니다")
                .recipients(recipients)
                .channels(List.of(Channel.IN_APP))
                .actionLabel("다운로드")
                .actionUrl("/reports/" + reportId)
                .metadata(Map.of("reportId", reportId, "reportTitle", reportTitle))
                .build();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/report/GeneratedReport.java

```java
package com.newsinsight.collector.entity.report;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Entity for storing generated reports.
 * Tracks PDF/document generation from search results
 * enabling re-download and sharing features.
 */
@Entity
@Table(name = "generated_reports", indexes = {
        @Index(name = "idx_report_search_history_id", columnList = "search_history_id"),
        @Index(name = "idx_report_user_id", columnList = "user_id"),
        @Index(name = "idx_report_project_id", columnList = "project_id"),
        @Index(name = "idx_report_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class GeneratedReport {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Related search history ID
     */
    @Column(name = "search_history_id")
    private Long searchHistoryId;

    /**
     * Project ID if part of a project
     */
    @Column(name = "project_id")
    private Long projectId;

    /**
     * User who generated the report
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Report title
     */
    @Column(name = "title", length = 512)
    private String title;

    /**
     * Report type (PDF, MARKDOWN, HTML, JSON)
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "report_type", length = 32)
    @Builder.Default
    private ReportType reportType = ReportType.PDF;

    /**
     * Report format/template used
     */
    @Column(name = "template_name", length = 64)
    private String templateName;

    /**
     * File storage path or URL
     */
    @Column(name = "file_path", length = 1024)
    private String filePath;

    /**
     * Public URL for sharing (if enabled)
     */
    @Column(name = "public_url", length = 1024)
    private String publicUrl;

    /**
     * File size in bytes
     */
    @Column(name = "file_size")
    private Long fileSize;

    /**
     * MIME type
     */
    @Column(name = "mime_type", length = 64)
    private String mimeType;

    /**
     * Generation status
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 32)
    @Builder.Default
    private ReportStatus status = ReportStatus.PENDING;

    /**
     * Error message if generation failed
     */
    @Column(name = "error_message", length = 1024)
    private String errorMessage;

    /**
     * Report metadata (sections, charts included, etc.)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * Report configuration/options used
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "config", columnDefinition = "jsonb")
    private Map<String, Object> config;

    /**
     * Number of times downloaded
     */
    @Column(name = "download_count")
    @Builder.Default
    private Integer downloadCount = 0;

    /**
     * Last download time
     */
    @Column(name = "last_downloaded_at")
    private LocalDateTime lastDownloadedAt;

    /**
     * Whether report is shared publicly
     */
    @Column(name = "is_public")
    @Builder.Default
    private Boolean isPublic = false;

    /**
     * Share link expiry time
     */
    @Column(name = "share_expires_at")
    private LocalDateTime shareExpiresAt;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "generated_at")
    private LocalDateTime generatedAt;

    /**
     * Report type enum
     */
    public enum ReportType {
        PDF,
        MARKDOWN,
        HTML,
        JSON,
        DOCX,
        XLSX
    }

    /**
     * Report status enum
     */
    public enum ReportStatus {
        PENDING,
        GENERATING,
        COMPLETED,
        FAILED,
        EXPIRED
    }

    /**
     * Mark report as generated
     */
    public void markGenerated(String filePath, Long fileSize) {
        this.status = ReportStatus.COMPLETED;
        this.filePath = filePath;
        this.fileSize = fileSize;
        this.generatedAt = LocalDateTime.now();
    }

    /**
     * Mark report as failed
     */
    public void markFailed(String errorMessage) {
        this.status = ReportStatus.FAILED;
        this.errorMessage = errorMessage;
    }

    /**
     * Increment download count
     */
    public void incrementDownload() {
        this.downloadCount++;
        this.lastDownloadedAt = LocalDateTime.now();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/search/DraftSearch.java

```java
package com.newsinsight.collector.entity.search;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Entity for storing user's draft/unsaved searches.
 * Captures search inputs that haven't been executed yet,
 * enabling "Continue Work" feature for incomplete searches.
 */
@Entity
@Table(name = "draft_searches", indexes = {
        @Index(name = "idx_draft_search_user_id", columnList = "user_id"),
        @Index(name = "idx_draft_search_session_id", columnList = "session_id"),
        @Index(name = "idx_draft_search_created_at", columnList = "created_at"),
        @Index(name = "idx_draft_search_executed", columnList = "executed")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DraftSearch {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Search query entered by user
     */
    @Column(nullable = false, length = 1024)
    private String query;

    /**
     * Type of search intended
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "search_type", length = 32)
    @Builder.Default
    private SearchType searchType = SearchType.UNIFIED;

    /**
     * User ID
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Session ID for anonymous users
     */
    @Column(name = "session_id", length = 64)
    private String sessionId;

    /**
     * Time window selected (1d, 7d, 30d, etc.)
     */
    @Column(name = "time_window", length = 16)
    private String timeWindow;

    /**
     * Search mode (standard, deep, fact-check, etc.)
     */
    @Column(name = "search_mode", length = 32)
    private String searchMode;

    /**
     * Additional options/parameters
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "options", columnDefinition = "jsonb")
    private Map<String, Object> options;

    /**
     * Whether this draft has been executed
     */
    @Column(name = "executed")
    @Builder.Default
    private Boolean executed = false;

    /**
     * When the draft was executed
     */
    @Column(name = "executed_at")
    private LocalDateTime executedAt;

    /**
     * Reference to the executed search history
     */
    @Column(name = "search_history_id")
    private Long searchHistoryId;

    /**
     * Project ID if associated with a project
     */
    @Column(name = "project_id")
    private Long projectId;

    /**
     * Source page/context where the draft was created
     */
    @Column(name = "source_context", length = 128)
    private String sourceContext;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    /**
     * Mark draft as executed
     */
    public void markExecuted(Long searchHistoryId) {
        this.executed = true;
        this.executedAt = LocalDateTime.now();
        this.searchHistoryId = searchHistoryId;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/search/SearchHistory.java

```java
package com.newsinsight.collector.entity.search;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Entity representing a search history record.
 * Stores the search query, results, and metadata for all search types
 * (unified search, deep search, fact check, browser agent).
 */
@Entity
@Table(name = "search_history", indexes = {
        @Index(name = "idx_search_history_type", columnList = "search_type"),
        @Index(name = "idx_search_history_query", columnList = "query"),
        @Index(name = "idx_search_history_created_at", columnList = "created_at"),
        @Index(name = "idx_search_history_user_id", columnList = "user_id"),
        @Index(name = "idx_search_history_parent_id", columnList = "parent_search_id"),
        @Index(name = "idx_search_history_completion_status", columnList = "completion_status"),
        @Index(name = "idx_search_history_project_id", columnList = "project_id")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * External reference ID (e.g., jobId from search job)
     */
    @Column(name = "external_id", length = 64, unique = true)
    private String externalId;

    /**
     * Type of search performed
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "search_type", nullable = false, length = 32)
    private SearchType searchType;

    /**
     * The search query or topic
     */
    @Column(nullable = false, length = 1024)
    private String query;

    /**
     * Time window for search (e.g., 1d, 7d, 30d)
     */
    @Column(length = 16)
    private String timeWindow;

    /**
     * Optional user ID for multi-user scenarios
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Session ID for grouping searches
     */
    @Column(name = "session_id", length = 64)
    private String sessionId;

    /**
     * Parent search ID for derived/drilldown searches
     */
    @Column(name = "parent_search_id")
    private Long parentSearchId;

    /**
     * Depth level for drilldown searches (0 = original, 1+ = drilldown)
     */
    @Column(name = "depth_level")
    @Builder.Default
    private Integer depthLevel = 0;

    /**
     * Total number of results found
     */
    @Column(name = "result_count")
    @Builder.Default
    private Integer resultCount = 0;

    /**
     * Search results stored as JSON
     * Contains list of search result items with their analysis data
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "results", columnDefinition = "jsonb")
    private List<Map<String, Object>> results;

    /**
     * AI summary/response stored as JSON
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "ai_summary", columnDefinition = "jsonb")
    private Map<String, Object> aiSummary;

    /**
     * URLs discovered during search (for auto-collection)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "discovered_urls", columnDefinition = "jsonb")
    private List<String> discoveredUrls;

    /**
     * Fact check results (for FACT_CHECK type)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "fact_check_results", columnDefinition = "jsonb")
    private List<Map<String, Object>> factCheckResults;

    /**
     * Overall credibility score (0-100)
     */
    @Column(name = "credibility_score")
    private Double credibilityScore;

    /**
     * Stance distribution (pro, con, neutral counts)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "stance_distribution", columnDefinition = "jsonb")
    private Map<String, Object> stanceDistribution;

    /**
     * Additional metadata
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * Whether this search has been bookmarked/starred
     */
    @Column
    @Builder.Default
    private Boolean bookmarked = false;

    /**
     * User-provided tags for organization
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private List<String> tags;

    /**
     * User notes about this search
     */
    @Column(columnDefinition = "text")
    private String notes;

    /**
     * Search duration in milliseconds
     */
    @Column(name = "duration_ms")
    private Long durationMs;

    /**
     * Error message if search failed
     */
    @Column(name = "error_message", length = 2048)
    private String errorMessage;

    /**
     * Whether the search completed successfully
     */
    @Column
    @Builder.Default
    private Boolean success = true;

    // ============ New fields for improved tracking ============

    /**
     * Completion status for "Continue Work" feature
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "completion_status", length = 32)
    @Builder.Default
    private CompletionStatus completionStatus = CompletionStatus.IN_PROGRESS;

    /**
     * Whether the user has viewed the results
     */
    @Column(name = "viewed")
    @Builder.Default
    private Boolean viewed = false;

    /**
     * When the user viewed the results
     */
    @Column(name = "viewed_at")
    private LocalDateTime viewedAt;

    /**
     * Whether a report has been generated for this search
     */
    @Column(name = "report_generated")
    @Builder.Default
    private Boolean reportGenerated = false;

    /**
     * Phase where failure occurred (for debugging)
     * e.g., "db_search", "web_crawl", "ai_analysis"
     */
    @Column(name = "failure_phase", length = 64)
    private String failurePhase;

    /**
     * Detailed failure information
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "failure_details", columnDefinition = "jsonb")
    private Map<String, Object> failureDetails;

    /**
     * Partial results saved before failure
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "partial_results", columnDefinition = "jsonb")
    private List<Map<String, Object>> partialResults;

    /**
     * Progress percentage (0-100) for long-running searches
     */
    @Column(name = "progress")
    @Builder.Default
    private Integer progress = 0;

    /**
     * Current phase description for UI display
     */
    @Column(name = "current_phase", length = 128)
    private String currentPhase;

    /**
     * Project ID for project-based organization
     */
    @Column(name = "project_id")
    private Long projectId;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    // ============ Enums ============

    /**
     * Completion status for tracking search progress
     */
    public enum CompletionStatus {
        /** Search input saved but not executed */
        DRAFT,
        /** Search is currently running */
        IN_PROGRESS,
        /** Some sources succeeded, some failed */
        PARTIAL,
        /** Search completed successfully */
        COMPLETED,
        /** Search failed */
        FAILED,
        /** Search was cancelled by user */
        CANCELLED
    }

    // ============ Helper methods ============

    /**
     * Convenience method to check if this is a derived search
     */
    public boolean isDerivedSearch() {
        return parentSearchId != null && parentSearchId > 0;
    }

    /**
     * Get result count safely
     */
    public int getResultCountSafe() {
        if (results != null) {
            return results.size();
        }
        return resultCount != null ? resultCount : 0;
    }

    /**
     * Check if this search needs to be continued
     */
    public boolean needsContinuation() {
        if (completionStatus == null) {
            return !Boolean.TRUE.equals(success);
        }
        return completionStatus == CompletionStatus.DRAFT
                || completionStatus == CompletionStatus.IN_PROGRESS
                || completionStatus == CompletionStatus.PARTIAL
                || completionStatus == CompletionStatus.FAILED;
    }

    /**
     * Check if this search is actionable (should show in "Continue Work")
     */
    public boolean isActionable() {
        // Exclude completed searches that have been viewed
        if (completionStatus == CompletionStatus.COMPLETED && Boolean.TRUE.equals(viewed)) {
            return false;
        }
        // Exclude bookmarked or report-generated searches
        if (Boolean.TRUE.equals(bookmarked) || Boolean.TRUE.equals(reportGenerated)) {
            return false;
        }
        return needsContinuation() || (completionStatus == CompletionStatus.COMPLETED && !Boolean.TRUE.equals(viewed));
    }

    /**
     * Mark as viewed
     */
    public void markViewed() {
        this.viewed = true;
        this.viewedAt = LocalDateTime.now();
    }

    /**
     * Mark as completed
     */
    public void markCompleted() {
        this.completionStatus = CompletionStatus.COMPLETED;
        this.success = true;
        this.progress = 100;
    }

    /**
     * Mark as failed with details
     */
    public void markFailed(String phase, String errorMessage, Map<String, Object> details) {
        this.completionStatus = CompletionStatus.FAILED;
        this.success = false;
        this.failurePhase = phase;
        this.errorMessage = errorMessage;
        this.failureDetails = details;
    }

    /**
     * Update progress
     */
    public void updateProgress(int progress, String phase) {
        this.progress = Math.min(100, Math.max(0, progress));
        this.currentPhase = phase;
        if (this.completionStatus == CompletionStatus.DRAFT) {
            this.completionStatus = CompletionStatus.IN_PROGRESS;
        }
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/search/SearchTemplate.java

```java
package com.newsinsight.collector.entity.search;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Entity representing a saved search template.
 * Templates allow users to save search configurations with selected items
 * for reuse in SmartSearch.
 */
@Entity
@Table(name = "search_template", indexes = {
        @Index(name = "idx_search_template_user_id", columnList = "user_id"),
        @Index(name = "idx_search_template_mode", columnList = "mode"),
        @Index(name = "idx_search_template_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchTemplate {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Template name (user-defined)
     */
    @Column(nullable = false, length = 256)
    private String name;

    /**
     * Search query associated with this template
     */
    @Column(nullable = false, length = 1024)
    private String query;

    /**
     * Search mode (unified, deep, factcheck)
     */
    @Column(nullable = false, length = 32)
    private String mode;

    /**
     * User ID who created this template
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Selected items stored as JSON array
     * Each item contains: id, type, title, url, snippet, source, stance, verificationStatus
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "items", columnDefinition = "jsonb")
    private List<Map<String, Object>> items;

    /**
     * Optional description for the template
     */
    @Column(columnDefinition = "text")
    private String description;

    /**
     * Whether this template is marked as favorite
     */
    @Column
    @Builder.Default
    private Boolean favorite = false;

    /**
     * Tags for categorization
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private List<String> tags;

    /**
     * Additional metadata
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * Reference to original search history (if created from a search)
     */
    @Column(name = "source_search_id")
    private Long sourceSearchId;

    /**
     * Number of times this template has been used
     */
    @Column(name = "use_count")
    @Builder.Default
    private Integer useCount = 0;

    /**
     * Last time this template was used
     */
    @Column(name = "last_used_at")
    private LocalDateTime lastUsedAt;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    /**
     * Increment use count and update last used timestamp
     */
    public void recordUsage() {
        this.useCount = (this.useCount != null ? this.useCount : 0) + 1;
        this.lastUsedAt = LocalDateTime.now();
    }

    /**
     * Get item count safely
     */
    public int getItemCount() {
        return items != null ? items.size() : 0;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/search/SearchType.java

```java
package com.newsinsight.collector.entity.search;

/**
 * Types of searches that can be performed and stored.
 */
public enum SearchType {
    /** Unified parallel search (DB + Web + AI) */
    UNIFIED,
    
    /** Deep AI search with crawl agents */
    DEEP_SEARCH,
    
    /** Fact verification search */
    FACT_CHECK,
    
    /** Browser agent research */
    BROWSER_AGENT
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/settings/LlmProviderSettings.java

```java
package com.newsinsight.collector.entity.settings;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * LLM Provider 설정 엔티티.
 * 
 * 관리자(전역) 설정과 사용자별 설정을 통합 관리.
 * - userId가 null이면 전역(관리자) 설정
 * - userId가 있으면 해당 사용자의 개인 설정
 * 
 * 사용자 설정이 존재하면 전역 설정보다 우선 적용됨.
 */
@Entity
@Table(name = "llm_provider_settings", 
    uniqueConstraints = {
        @UniqueConstraint(name = "uk_llm_provider_user", columnNames = {"provider_type", "user_id"})
    },
    indexes = {
        @Index(name = "idx_llm_settings_user", columnList = "user_id"),
        @Index(name = "idx_llm_settings_provider", columnList = "provider_type"),
        @Index(name = "idx_llm_settings_enabled", columnList = "enabled")
    }
)
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LlmProviderSettings {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * LLM 제공자 타입
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "provider_type", nullable = false, length = 30)
    private LlmProviderType providerType;

    /**
     * 사용자 ID (null = 전역/관리자 설정)
     */
    @Column(name = "user_id", length = 100)
    private String userId;

    /**
     * API 키 (암호화 저장 권장)
     */
    @Column(name = "api_key", columnDefinition = "TEXT")
    private String apiKey;

    /**
     * 기본 모델명
     * 예: gpt-4o, claude-3-5-sonnet-20241022, gemini-1.5-pro
     */
    @Column(name = "default_model", length = 100)
    private String defaultModel;

    /**
     * API Base URL (커스텀 엔드포인트용)
     */
    @Column(name = "base_url", length = 500)
    private String baseUrl;

    /**
     * 활성화 여부
     */
    @Column(name = "enabled", nullable = false)
    @Builder.Default
    private Boolean enabled = true;

    /**
     * 우선순위 (낮을수록 먼저 사용, fallback 체인용)
     */
    @Column(name = "priority")
    @Builder.Default
    private Integer priority = 100;

    /**
     * 최대 토큰 수
     */
    @Column(name = "max_tokens")
    @Builder.Default
    private Integer maxTokens = 4096;

    /**
     * Temperature (0.0 ~ 2.0)
     */
    @Column(name = "temperature")
    @Builder.Default
    private Double temperature = 0.7;

    /**
     * 요청 타임아웃 (밀리초)
     */
    @Column(name = "timeout_ms")
    @Builder.Default
    private Integer timeoutMs = 60000;

    /**
     * 분당 최대 요청 수 (Rate limiting)
     */
    @Column(name = "max_requests_per_minute")
    @Builder.Default
    private Integer maxRequestsPerMinute = 60;

    /**
     * Azure OpenAI 전용: Deployment Name
     */
    @Column(name = "azure_deployment_name", length = 100)
    private String azureDeploymentName;

    /**
     * Azure OpenAI 전용: API Version
     */
    @Column(name = "azure_api_version", length = 20)
    private String azureApiVersion;

    /**
     * 마지막 테스트 성공 시간
     */
    @Column(name = "last_tested_at")
    private LocalDateTime lastTestedAt;

    /**
     * 마지막 테스트 결과
     */
    @Column(name = "last_test_success")
    private Boolean lastTestSuccess;

    /**
     * 생성일시
     */
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    /**
     * 수정일시
     */
    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    // === Helper Methods ===

    /**
     * 전역(관리자) 설정인지 확인
     */
    public boolean isGlobal() {
        return userId == null || userId.isBlank();
    }

    /**
     * 사용자별 설정인지 확인
     */
    public boolean isUserSpecific() {
        return userId != null && !userId.isBlank();
    }

    /**
     * API 키 마스킹 (표시용)
     */
    public String getMaskedApiKey() {
        if (apiKey == null || apiKey.length() < 8) {
            return "****";
        }
        return apiKey.substring(0, 4) + "****" + apiKey.substring(apiKey.length() - 4);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/settings/LlmProviderType.java

```java
package com.newsinsight.collector.entity.settings;

/**
 * LLM Provider 종류
 */
public enum LlmProviderType {
    OPENAI("OpenAI", "https://api.openai.com/v1"),
    ANTHROPIC("Anthropic", "https://api.anthropic.com"),
    GOOGLE("Google AI", "https://generativelanguage.googleapis.com/v1beta"),
    OPENROUTER("OpenRouter", "https://openrouter.ai/api/v1"),
    OLLAMA("Ollama", "http://localhost:11434"),
    AZURE_OPENAI("Azure OpenAI", null),
    TOGETHER_AI("Together AI", "https://api.together.xyz/v1"),
    // Search API Providers (실시간 검색용)
    PERPLEXITY("Perplexity", "https://api.perplexity.ai"),
    BRAVE_SEARCH("Brave Search", "https://api.search.brave.com/res/v1"),
    TAVILY("Tavily", "https://api.tavily.com"),
    CUSTOM("Custom", null);

    private final String displayName;
    private final String defaultBaseUrl;

    LlmProviderType(String displayName, String defaultBaseUrl) {
        this.displayName = displayName;
        this.defaultBaseUrl = defaultBaseUrl;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getDefaultBaseUrl() {
        return defaultBaseUrl;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/workspace/WorkspaceFile.java

```java
package com.newsinsight.collector.entity.workspace;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.UUID;

/**
 * Entity representing a file stored in user's workspace.
 * File metadata is stored in PostgreSQL, actual file content on local disk/S3.
 */
@Entity
@Table(name = "workspace_files", indexes = {
        @Index(name = "idx_workspace_file_session_id", columnList = "session_id"),
        @Index(name = "idx_workspace_file_user_id", columnList = "user_id"),
        @Index(name = "idx_workspace_file_project_id", columnList = "project_id"),
        @Index(name = "idx_workspace_file_file_type", columnList = "file_type"),
        @Index(name = "idx_workspace_file_status", columnList = "status"),
        @Index(name = "idx_workspace_file_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class WorkspaceFile {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Unique file identifier (UUID for secure access)
     */
    @Column(name = "file_uuid", nullable = false, unique = true, length = 36)
    @Builder.Default
    private String fileUuid = UUID.randomUUID().toString();

    /**
     * Session ID for anonymous users
     */
    @Column(name = "session_id", length = 64)
    private String sessionId;

    /**
     * User ID for authenticated users (optional)
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Associated project ID (optional)
     */
    @Column(name = "project_id")
    private Long projectId;

    /**
     * Original file name
     */
    @Column(name = "original_name", nullable = false, length = 512)
    private String originalName;

    /**
     * Stored file name (UUID-based for uniqueness)
     */
    @Column(name = "stored_name", nullable = false, length = 128)
    private String storedName;

    /**
     * File extension (e.g., pdf, xlsx, csv)
     */
    @Column(name = "extension", length = 32)
    private String extension;

    /**
     * MIME type
     */
    @Column(name = "mime_type", length = 128)
    private String mimeType;

    /**
     * File size in bytes
     */
    @Column(name = "file_size", nullable = false)
    private Long fileSize;

    /**
     * File type category
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "file_type", length = 32)
    @Builder.Default
    private FileType fileType = FileType.OTHER;

    /**
     * Storage location type
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "storage_type", length = 32)
    @Builder.Default
    private StorageType storageType = StorageType.LOCAL;

    /**
     * Storage path (relative path for local, key for S3)
     */
    @Column(name = "storage_path", nullable = false, length = 1024)
    private String storagePath;

    /**
     * File status
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 32)
    @Builder.Default
    private FileStatus status = FileStatus.ACTIVE;

    /**
     * File description
     */
    @Column(name = "description", length = 1024)
    private String description;

    /**
     * File checksum (SHA-256)
     */
    @Column(name = "checksum", length = 64)
    private String checksum;

    /**
     * Download count
     */
    @Column(name = "download_count")
    @Builder.Default
    private Integer downloadCount = 0;

    /**
     * Last accessed time
     */
    @Column(name = "last_accessed_at")
    private LocalDateTime lastAccessedAt;

    /**
     * Expiration time (for temporary files)
     */
    @Column(name = "expires_at")
    private LocalDateTime expiresAt;

    /**
     * Additional metadata
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    // ============ Enums ============

    public enum FileType {
        /** Document files (PDF, DOC, TXT) */
        DOCUMENT,
        /** Spreadsheet files (XLSX, CSV) */
        SPREADSHEET,
        /** Image files (PNG, JPG, GIF) */
        IMAGE,
        /** Data files (JSON, XML) */
        DATA,
        /** Archive files (ZIP, TAR) */
        ARCHIVE,
        /** Report files (generated reports) */
        REPORT,
        /** Other files */
        OTHER
    }

    public enum StorageType {
        /** Local file system storage */
        LOCAL,
        /** AWS S3 storage */
        S3,
        /** Google Cloud Storage */
        GCS
    }

    public enum FileStatus {
        /** File is active and accessible */
        ACTIVE,
        /** File is being uploaded */
        UPLOADING,
        /** File is being processed */
        PROCESSING,
        /** File has been archived */
        ARCHIVED,
        /** File is scheduled for deletion */
        PENDING_DELETE,
        /** File has been deleted */
        DELETED
    }

    // ============ Helper methods ============

    /**
     * Check if file is owned by session
     */
    public boolean isOwnedBySession(String sessionId) {
        return this.sessionId != null && this.sessionId.equals(sessionId);
    }

    /**
     * Check if file is owned by user
     */
    public boolean isOwnedByUser(String userId) {
        return this.userId != null && this.userId.equals(userId);
    }

    /**
     * Check if file is accessible by session or user
     */
    public boolean isAccessibleBy(String sessionId, String userId) {
        if (sessionId != null && isOwnedBySession(sessionId)) {
            return true;
        }
        if (userId != null && isOwnedByUser(userId)) {
            return true;
        }
        return false;
    }

    /**
     * Increment download count
     */
    public void incrementDownloadCount() {
        this.downloadCount = (this.downloadCount == null ? 0 : this.downloadCount) + 1;
        this.lastAccessedAt = LocalDateTime.now();
    }

    /**
     * Mark as deleted
     */
    public void markDeleted() {
        this.status = FileStatus.DELETED;
    }

    /**
     * Check if file is expired
     */
    public boolean isExpired() {
        return this.expiresAt != null && LocalDateTime.now().isAfter(this.expiresAt);
    }

    /**
     * Get human-readable file size
     */
    public String getHumanReadableSize() {
        if (fileSize == null) return "0 B";
        
        long bytes = fileSize;
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return String.format("%.1f KB", bytes / 1024.0);
        if (bytes < 1024 * 1024 * 1024) return String.format("%.1f MB", bytes / (1024.0 * 1024));
        return String.format("%.1f GB", bytes / (1024.0 * 1024 * 1024));
    }

    /**
     * Determine file type from extension
     */
    public static FileType determineFileType(String extension) {
        if (extension == null) return FileType.OTHER;
        
        String ext = extension.toLowerCase();
        return switch (ext) {
            case "pdf", "doc", "docx", "txt", "rtf", "odt" -> FileType.DOCUMENT;
            case "xls", "xlsx", "csv", "ods" -> FileType.SPREADSHEET;
            case "png", "jpg", "jpeg", "gif", "bmp", "svg", "webp" -> FileType.IMAGE;
            case "json", "xml", "yaml", "yml" -> FileType.DATA;
            case "zip", "tar", "gz", "rar", "7z" -> FileType.ARCHIVE;
            default -> FileType.OTHER;
        };
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/exception/ChatExceptionHandler.java

```java
package com.newsinsight.collector.exception;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

/**
 * 채팅 서비스 전역 예외 핸들러
 */
@RestControllerAdvice(basePackages = "com.newsinsight.collector.controller")
@Slf4j
public class ChatExceptionHandler {

    @ExceptionHandler(SessionException.class)
    public ResponseEntity<Map<String, Object>> handleSessionException(SessionException ex) {
        log.error("Session error: {}", ex.getMessage(), ex);
        
        Map<String, Object> response = createErrorResponse(
                ex.getErrorCode(),
                ex.getMessage(),
                ex.getSessionId(),
                HttpStatus.BAD_REQUEST.value()
        );
        
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(response);
    }

    @ExceptionHandler(SyncException.class)
    public ResponseEntity<Map<String, Object>> handleSyncException(SyncException ex) {
        log.error("Sync error: {}", ex.getMessage(), ex);
        
        Map<String, Object> response = createErrorResponse(
                ex.getErrorCode(),
                ex.getMessage(),
                ex.getSessionId(),
                HttpStatus.INTERNAL_SERVER_ERROR.value()
        );
        
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
    }

    @ExceptionHandler(VectorEmbeddingException.class)
    public ResponseEntity<Map<String, Object>> handleVectorEmbeddingException(VectorEmbeddingException ex) {
        log.error("Vector embedding error: {}", ex.getMessage(), ex);
        
        Map<String, Object> response = createErrorResponse(
                ex.getErrorCode(),
                ex.getMessage(),
                ex.getSessionId(),
                HttpStatus.SERVICE_UNAVAILABLE.value()
        );
        
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(response);
    }

    @ExceptionHandler(ChatServiceException.class)
    public ResponseEntity<Map<String, Object>> handleChatServiceException(ChatServiceException ex) {
        log.error("Chat service error: {}", ex.getMessage(), ex);
        
        Map<String, Object> response = createErrorResponse(
                ex.getErrorCode(),
                ex.getMessage(),
                ex.getSessionId(),
                HttpStatus.INTERNAL_SERVER_ERROR.value()
        );
        
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGenericException(Exception ex) {
        log.error("Unexpected error: {}", ex.getMessage(), ex);
        
        Map<String, Object> response = createErrorResponse(
                "INTERNAL_ERROR",
                "An unexpected error occurred",
                null,
                HttpStatus.INTERNAL_SERVER_ERROR.value()
        );
        
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
    }

    private Map<String, Object> createErrorResponse(String errorCode, String message, String sessionId, int status) {
        Map<String, Object> response = new HashMap<>();
        response.put("success", false);
        response.put("error", errorCode);
        response.put("message", message);
        response.put("status", status);
        response.put("timestamp", LocalDateTime.now().toString());
        
        if (sessionId != null) {
            response.put("sessionId", sessionId);
        }
        
        return response;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/exception/ChatServiceException.java

```java
package com.newsinsight.collector.exception;

/**
 * 채팅 서비스 관련 예외 기본 클래스
 */
public class ChatServiceException extends RuntimeException {
    
    private final String errorCode;
    private final String sessionId;

    public ChatServiceException(String message) {
        super(message);
        this.errorCode = "CHAT_ERROR";
        this.sessionId = null;
    }

    public ChatServiceException(String message, Throwable cause) {
        super(message, cause);
        this.errorCode = "CHAT_ERROR";
        this.sessionId = null;
    }

    public ChatServiceException(String errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
        this.sessionId = null;
    }

    public ChatServiceException(String errorCode, String message, String sessionId) {
        super(message);
        this.errorCode = errorCode;
        this.sessionId = sessionId;
    }

    public ChatServiceException(String errorCode, String message, String sessionId, Throwable cause) {
        super(message, cause);
        this.errorCode = errorCode;
        this.sessionId = sessionId;
    }

    public String getErrorCode() {
        return errorCode;
    }

    public String getSessionId() {
        return sessionId;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/exception/SessionException.java

```java
package com.newsinsight.collector.exception;

/**
 * 세션 관련 예외
 */
public class SessionException extends ChatServiceException {

    public SessionException(String message) {
        super("SESSION_ERROR", message);
    }

    public SessionException(String message, String sessionId) {
        super("SESSION_ERROR", message, sessionId);
    }

    public SessionException(String message, String sessionId, Throwable cause) {
        super("SESSION_ERROR", message, sessionId, cause);
    }

    /**
     * 세션을 찾을 수 없을 때
     */
    public static SessionException notFound(String sessionId) {
        return new SessionException("Session not found: " + sessionId, sessionId);
    }

    /**
     * 세션이 만료되었을 때
     */
    public static SessionException expired(String sessionId) {
        return new SessionException("Session has expired: " + sessionId, sessionId);
    }

    /**
     * 세션이 이미 종료되었을 때
     */
    public static SessionException alreadyClosed(String sessionId) {
        return new SessionException("Session is already closed: " + sessionId, sessionId);
    }

    /**
     * 세션 생성 실패
     */
    public static SessionException creationFailed(String sessionId, Throwable cause) {
        return new SessionException("Failed to create session: " + sessionId, sessionId, cause);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/exception/SyncException.java

```java
package com.newsinsight.collector.exception;

/**
 * 동기화 관련 예외
 */
public class SyncException extends ChatServiceException {

    public SyncException(String message) {
        super("SYNC_ERROR", message);
    }

    public SyncException(String message, String sessionId) {
        super("SYNC_ERROR", message, sessionId);
    }

    public SyncException(String message, String sessionId, Throwable cause) {
        super("SYNC_ERROR", message, sessionId, cause);
    }

    /**
     * RDB 동기화 실패
     */
    public static SyncException rdbSyncFailed(String sessionId, Throwable cause) {
        return new SyncException("Failed to sync session to RDB: " + sessionId, sessionId, cause);
    }

    /**
     * 벡터 DB 임베딩 실패
     */
    public static SyncException embeddingFailed(String sessionId, Throwable cause) {
        return new SyncException("Failed to embed session to vector DB: " + sessionId, sessionId, cause);
    }

    /**
     * 동기화 타임아웃
     */
    public static SyncException timeout(String sessionId) {
        return new SyncException("Sync operation timed out for session: " + sessionId, sessionId);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/exception/VectorEmbeddingException.java

```java
package com.newsinsight.collector.exception;

/**
 * 벡터 임베딩 관련 예외
 */
public class VectorEmbeddingException extends ChatServiceException {

    public VectorEmbeddingException(String message) {
        super("VECTOR_ERROR", message);
    }

    public VectorEmbeddingException(String message, Throwable cause) {
        super("VECTOR_ERROR", message, null, cause);
    }

    public VectorEmbeddingException(String message, String sessionId, Throwable cause) {
        super("VECTOR_ERROR", message, sessionId, cause);
    }

    /**
     * 벡터 DB 연결 실패
     */
    public static VectorEmbeddingException connectionFailed(Throwable cause) {
        return new VectorEmbeddingException("Failed to connect to vector DB", cause);
    }

    /**
     * 임베딩 생성 실패
     */
    public static VectorEmbeddingException embeddingGenerationFailed(String messageId, Throwable cause) {
        return new VectorEmbeddingException("Failed to generate embedding for message: " + messageId, cause);
    }

    /**
     * 벡터 저장 실패
     */
    public static VectorEmbeddingException storageFailed(String embeddingId, Throwable cause) {
        return new VectorEmbeddingException("Failed to store embedding: " + embeddingId, cause);
    }

    /**
     * 검색 실패
     */
    public static VectorEmbeddingException searchFailed(Throwable cause) {
        return new VectorEmbeddingException("Vector search failed", cause);
    }

    /**
     * 벡터 DB 비활성화
     */
    public static VectorEmbeddingException disabled() {
        return new VectorEmbeddingException("Vector DB is disabled");
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/mapper/EntityMapper.java

```java
package com.newsinsight.collector.mapper;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.dto.*;
import com.newsinsight.collector.entity.CollectedData;
import com.newsinsight.collector.entity.CollectionJob;
import com.newsinsight.collector.entity.DataSource;
import com.newsinsight.collector.entity.SourceType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.Map;

@Component
public class EntityMapper {

    private static final Logger log = LoggerFactory.getLogger(EntityMapper.class);
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};

    private final ObjectMapper objectMapper;

    public EntityMapper(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public DataSourceDTO toDTO(DataSource source) {
        return new DataSourceDTO(
                source.getId(),
                source.getName(),
                source.getUrl(),
                source.getSourceType(),
                source.getIsActive(),
                source.getLastCollected(),
                source.getCollectionFrequency(),
                parseJson(source.getMetadataJson()),
                source.getCreatedAt(),
                source.getUpdatedAt(),
                BrowserAgentConfigDto.fromEntity(source.getBrowserAgentConfig())
        );
    }

    // Alias method for DataSource
    public DataSourceDTO toDataSourceDTO(DataSource source) {
        return toDTO(source);
    }

    public CollectionJobDTO toDTO(CollectionJob job) {
        return new CollectionJobDTO(
                job.getId(),
                job.getSourceId(),
                job.getStatus(),
                job.getStartedAt(),
                job.getCompletedAt(),
                job.getItemsCollected(),
                job.getErrorMessage(),
                job.getCreatedAt()
        );
    }

    // Alias method for CollectionJob
    public CollectionJobDTO toCollectionJobDTO(CollectionJob job) {
        return toDTO(job);
    }

    public CollectedDataDTO toDTO(CollectedData data) {
        return new CollectedDataDTO(
                data.getId(),
                data.getSourceId(),
                data.getTitle(),
                data.getContent(),
                data.getUrl(),
                data.getPublishedDate(),
                data.getCollectedAt(),
                data.getContentHash(),
                parseJson(data.getMetadataJson()),
                data.getProcessed()
        );
    }

    // Alias method for CollectedData
    public CollectedDataDTO toCollectedDataDTO(CollectedData data) {
        return toDTO(data);
    }

    public DataSource toEntity(DataSourceCreateRequest request) {
        DataSource.DataSourceBuilder builder = DataSource.builder()
                .name(request.name())
                .url(request.url())
                .sourceType(request.sourceType())
                .collectionFrequency(request.collectionFrequency())
                .metadataJson(toJson(request.metadata()))
                .isActive(true);

        // Set browser agent config if applicable
        if (request.sourceType() == SourceType.BROWSER_AGENT && request.browserAgentConfig() != null) {
            builder.browserAgentConfig(request.browserAgentConfig().toEntity());
        }

        return builder.build();
    }

    // Alias method for DataSourceCreateRequest
    public DataSource toDataSource(DataSourceCreateRequest request) {
        return toEntity(request);
    }

    public void updateEntity(DataSource source, DataSourceUpdateRequest request) {
        if (request.name() != null) {
            source.setName(request.name());
        }
        if (request.url() != null) {
            source.setUrl(request.url());
        }
        if (request.isActive() != null) {
            source.setIsActive(request.isActive());
        }
        if (request.collectionFrequency() != null) {
            source.setCollectionFrequency(request.collectionFrequency());
        }
        if (request.metadata() != null) {
            source.setMetadataJson(toJson(request.metadata()));
        }
        // Update browser agent config if provided
        if (request.browserAgentConfig() != null) {
            source.setBrowserAgentConfig(request.browserAgentConfig().toEntity());
        }
    }

    // Alias method for updating DataSource from request
    public void updateDataSourceFromRequest(DataSourceUpdateRequest request, DataSource source) {
        updateEntity(source, request);
    }

    private Map<String, Object> parseJson(String json) {
        if (json == null || json.isBlank()) {
            return Collections.emptyMap();
        }
        try {
            return objectMapper.readValue(json, MAP_TYPE);
        } catch (JsonProcessingException e) {
            log.warn("Failed to parse metadata JSON. Returning empty map. Data: {}", json, e);
            return Collections.emptyMap();
        }
    }

    private String toJson(Map<String, Object> map) {
        if (map == null || map.isEmpty()) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(map);
        } catch (JsonProcessingException e) {
            log.warn("Failed to serialize metadata map. Returning null. Data: {}", map, e);
            return null;
        }
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/mongo/AiResponseDocument.java

```java
package com.newsinsight.collector.mongo;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.Map;

@Document(collection = "ai_responses")
public class AiResponseDocument {

    @Id
    private String id; // requestId

    private String status;
    private String completedAt;
    private String providerId;
    private String modelId;
    private String text;
    private Map<String, Object> raw;

    @Indexed(expireAfterSeconds = 604800) // 7 days
    private Instant createdAt;

    public AiResponseDocument() {
    }

    public AiResponseDocument(String id,
                              String status,
                              String completedAt,
                              String providerId,
                              String modelId,
                              String text,
                              Map<String, Object> raw,
                              Instant createdAt) {
        this.id = id;
        this.status = status;
        this.completedAt = completedAt;
        this.providerId = providerId;
        this.modelId = modelId;
        this.text = text;
        this.raw = raw;
        this.createdAt = createdAt;
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getCompletedAt() {
        return completedAt;
    }

    public void setCompletedAt(String completedAt) {
        this.completedAt = completedAt;
    }

    public String getProviderId() {
        return providerId;
    }

    public void setProviderId(String providerId) {
        this.providerId = providerId;
    }

    public String getModelId() {
        return modelId;
    }

    public void setModelId(String modelId) {
        this.modelId = modelId;
    }

    public String getText() {
        return text;
    }

    public void setText(String text) {
        this.text = text;
    }

    public Map<String, Object> getRaw() {
        return raw;
    }

    public void setRaw(Map<String, Object> raw) {
        this.raw = raw;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/mongo/AiResponseRepository.java

```java
package com.newsinsight.collector.mongo;

import org.springframework.data.mongodb.repository.MongoRepository;

public interface AiResponseRepository extends MongoRepository<AiResponseDocument, String> {
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/repository/AiJobRepository.java

```java
package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.ai.AiJob;
import com.newsinsight.collector.entity.ai.AiJobStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface AiJobRepository extends JpaRepository<AiJob, String> {

    /**
     * Find jobs by overall status
     */
    Page<AiJob> findByOverallStatus(AiJobStatus status, Pageable pageable);

    /**
     * Find jobs by topic containing the search term
     */
    Page<AiJob> findByTopicContainingIgnoreCase(String topic, Pageable pageable);

    /**
     * Find jobs by status list
     */
    List<AiJob> findByOverallStatusIn(List<AiJobStatus> statuses);

    /**
     * Find jobs by status and created before a given time (for timeout/cleanup)
     */
    @Query("SELECT j FROM AiJob j WHERE j.overallStatus IN :statuses AND j.createdAt < :before")
    List<AiJob> findByStatusInAndCreatedAtBefore(
            @Param("statuses") List<AiJobStatus> statuses,
            @Param("before") LocalDateTime before
    );

    /**
     * Find job with sub-tasks eagerly loaded
     */
    @Query("SELECT j FROM AiJob j LEFT JOIN FETCH j.subTasks WHERE j.id = :jobId")
    Optional<AiJob> findByIdWithSubTasks(@Param("jobId") String jobId);

    /**
     * Find recent jobs by topic
     */
    @Query("SELECT j FROM AiJob j WHERE LOWER(j.topic) = LOWER(:topic) ORDER BY j.createdAt DESC")
    List<AiJob> findRecentByTopic(@Param("topic") String topic, Pageable pageable);

    /**
     * Count jobs by status
     */
    long countByOverallStatus(AiJobStatus status);

    /**
     * Mark timed out jobs (PENDING or IN_PROGRESS older than cutoff)
     */
    @Modifying
    @Query("UPDATE AiJob j SET j.overallStatus = 'TIMEOUT', j.completedAt = CURRENT_TIMESTAMP " +
            "WHERE j.overallStatus IN ('PENDING', 'IN_PROGRESS') AND j.createdAt < :before")
    int markTimedOutJobs(@Param("before") LocalDateTime before);

    /**
     * Delete old completed/failed/cancelled jobs
     */
    @Modifying
    @Query("DELETE FROM AiJob j WHERE j.overallStatus IN ('COMPLETED', 'FAILED', 'PARTIAL_SUCCESS', 'TIMEOUT', 'CANCELLED') " +
            "AND j.completedAt < :before")
    int deleteOldJobs(@Param("before") LocalDateTime before);

    /**
     * Find jobs created within a time range
     */
    Page<AiJob> findByCreatedAtBetween(LocalDateTime start, LocalDateTime end, Pageable pageable);

    /**
     * Get statistics: count by status
     */
    @Query("SELECT j.overallStatus, COUNT(j) FROM AiJob j GROUP BY j.overallStatus")
    List<Object[]> getStatusCounts();

    /**
     * Find active (non-terminal) jobs
     */
    @Query("SELECT j FROM AiJob j WHERE j.overallStatus IN ('PENDING', 'IN_PROGRESS')")
    List<AiJob> findActiveJobs();
}

```
