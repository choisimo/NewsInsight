# NewsInsight Spring Boot 마이그레이션 계획

## 개요

이 문서는 NewsInsight의 핵심 서비스를 Python (FastAPI)에서 Spring Boot로 마이그레이션하는 종합 계획을 담고 있습니다.

### 마이그레이션 범위

**마이그레이션 대상 (핵심 서비스만)**:
- `api-gateway` → Spring Cloud Gateway
- `collector-service` → Spring Boot REST API
- `web-crawler` → collector-service에 통합 또는 별도 Spring Boot 서비스

**마이그레이션 제외**:
- `analysis-service` (ML/AI 분석)
- `absa-service` (Aspect-Based Sentiment Analysis)
- `alert-service` (알림)
- `osint-*` 관련 모든 서비스

### 기술 스택

| 컴포넌트 | 기술 |
|---------|------|
| Java 버전 | JDK 21 (LTS) |
| Spring Boot | 3.2.x+ |
| Spring Cloud | 2023.0.x (Leyton) |
| 빌드 도구 | Gradle 8.5+ (Kotlin DSL) |
| 설정 관리 | Spring Cloud Consul Config |
| API Gateway | Spring Cloud Gateway |
| 데이터 접근 | Spring Data JPA |
| 비동기 HTTP | WebClient (Spring WebFlux) |
| 모니터링 | Spring Boot Actuator |

---

## Phase 0: 사전 준비 및 표준 환경 구축

### 목표
프로젝트 구조, 빌드 시스템, 공통 의존성을 표준화하여 모든 서비스가 일관된 방식으로 개발되도록 합니다.

### 작업 항목

#### 1. Gradle 멀티 모듈 프로젝트 구성

프로젝트 루트에 다음 구조를 생성합니다:

```
NewsInsight/
├── settings.gradle.kts              # 멀티 모듈 설정
├── build.gradle.kts                 # 루트 빌드 설정
├── gradle.properties                # Gradle 전역 설정
├── api-gateway/                     # Spring Cloud Gateway 모듈
│   ├── build.gradle.kts
│   ├── src/
│   │   ├── main/
│   │   │   ├── java/com/newsinsight/gateway/
│   │   │   └── resources/
│   │   │       ├── application.yml
│   │   │       └── application-development.yml
│   │   └── test/
│   └── Dockerfile
├── collector-service/               # Spring Boot Collector 모듈
│   ├── build.gradle.kts
│   ├── src/
│   │   ├── main/
│   │   │   ├── java/com/newsinsight/collector/
│   │   │   └── resources/
│   │   │       ├── application.yml
│   │   │       └── application-development.yml
│   │   └── test/
│   └── Dockerfile
└── common/                          # 공통 라이브러리 (선택)
    ├── build.gradle.kts
    └── src/main/java/com/newsinsight/common/
```

#### 2. 루트 build.gradle.kts 설정

```kotlin
plugins {
    java
    id("org.springframework.boot") version "3.2.1" apply false
    id("io.spring.dependency-management") version "1.1.4" apply false
    kotlin("jvm") version "1.9.21" apply false
    kotlin("plugin.spring") version "1.9.21" apply false
}

allprojects {
    group = "com.newsinsight"
    version = "1.0.0"
    
    repositories {
        mavenCentral()
    }
}

subprojects {
    apply(plugin = "java")
    apply(plugin = "org.springframework.boot")
    apply(plugin = "io.spring.dependency-management")
    
    java {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
    
    dependencies {
        implementation("org.springframework.boot:spring-boot-starter-actuator")
        implementation("org.springframework.cloud:spring-cloud-starter-consul-config")
        implementation("org.springframework.cloud:spring-cloud-starter-consul-discovery")
        
        // Logging
        implementation("net.logstash.logback:logstash-logback-encoder:7.4")
        
        // Test
        testImplementation("org.springframework.boot:spring-boot-starter-test")
    }
    
    dependencyManagement {
        imports {
            mavenBom("org.springframework.cloud:spring-cloud-dependencies:2023.0.0")
        }
    }
    
    tasks.withType<Test> {
        useJUnitPlatform()
    }
}
```

#### 3. settings.gradle.kts 설정

```kotlin
rootProject.name = "newsinsight"

include(
    "api-gateway",
    "collector-service",
    "common"  // 선택
)
```

#### 4. 표준 Dockerfile 템플릿

각 서비스 디렉토리에 다음 멀티 스테이지 Dockerfile을 생성합니다:

```dockerfile
# Build stage
FROM gradle:8.5-jdk21-alpine AS build
WORKDIR /app

# 빌드 캐시 최적화: 의존성 먼저 다운로드
COPY settings.gradle.kts build.gradle.kts gradle.properties ./
COPY api-gateway/build.gradle.kts api-gateway/
COPY collector-service/build.gradle.kts collector-service/

RUN gradle dependencies --no-daemon || true

# 소스 코드 복사 및 빌드
COPY . .
RUN gradle :collector-service:bootJar --no-daemon -x test

# Runtime stage
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

# 보안: 비root 사용자 생성
RUN addgroup -S spring && adduser -S spring -G spring
USER spring:spring

COPY --from=build /app/collector-service/build/libs/*.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", \
    "-XX:+UseZGC", \
    "-XX:+UseStringDeduplication", \
    "-Djava.security.egd=file:/dev/./urandom", \
    "-jar", "app.jar"]
```

---

## Phase 1: Spring Cloud Consul Config 연동

### 목표
기존 Consul KV 구조를 최대한 활용하면서 Spring Boot 애플리케이션이 Consul에서 설정을 로드하도록 구성합니다.

### Consul KV 구조 (기존 유지)

```
config/api-gateway/PORT = 8000
config/api-gateway/DEBUG = false
config/api-gateway/JWT_SECRET_KEY = secure-secret
config/api-gateway/COLLECTOR_SERVICE_URL = http://collector-service:8002

config/collector-service/PORT = 8002
config/collector-service/DATABASE_URL = postgresql://...
config/collector-service/REDIS_URL = redis://...
```

### 작업 항목

#### 1. api-gateway 의존성 추가

`api-gateway/build.gradle.kts`:

```kotlin
dependencies {
    implementation("org.springframework.cloud:spring-cloud-starter-gateway")
    implementation("org.springframework.cloud:spring-cloud-starter-consul-config")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    
    // Security (JWT 인증)
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("io.jsonwebtoken:jjwt-api:0.12.3")
    runtimeOnly("io.jsonwebtoken:jjwt-impl:0.12.3")
    runtimeOnly("io.jsonwebtoken:jjwt-jackson:0.12.3")
    
    // Redis for rate limiting
    implementation("org.springframework.boot:spring-boot-starter-data-redis")
    
    testImplementation("org.springframework.security:spring-security-test")
}
```

#### 2. api-gateway/src/main/resources/application.yml

```yaml
spring:
  application:
    name: api-gateway
  
  config:
    # Consul에서 설정 가져오기
    import: "consul:"
  
  cloud:
    consul:
      host: ${CONSUL_HOST:consul}
      port: ${CONSUL_PORT:8500}
      config:
        enabled: true
        # 기존 Consul KV 구조와 일치
        prefix: config
        default-context: ${spring.application.name}
        format: PROPERTIES
        # Fail-Fast: Consul 연결 실패 시 즉시 종료
        fail-fast: true
      discovery:
        enabled: true
        health-check-path: /actuator/health
        health-check-interval: 10s

    gateway:
      routes:
        # Collector 서비스 라우팅
        - id: collector-service
          uri: lb://collector-service  # Consul 서비스 디스커버리 사용
          predicates:
            - Path=/api/v1/collector/**
          filters:
            - StripPrefix=2
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 100
                redis-rate-limiter.burstCapacity: 150

server:
  port: ${PORT:8000}

management:
  endpoints:
    web:
      exposure:
        include: health,info,env,metrics,prometheus
  endpoint:
    health:
      show-details: always

logging:
  level:
    org.springframework.cloud.gateway: INFO
    org.springframework.security: DEBUG
```

#### 3. collector-service 의존성 추가

`collector-service/build.gradle.kts`:

```kotlin
dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    implementation("org.springframework.boot:spring-boot-starter-data-redis")
    implementation("org.springframework.cloud:spring-cloud-starter-consul-config")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    
    // WebClient for HTTP calls (web-crawler 통합)
    implementation("org.springframework.boot:spring-boot-starter-webflux")
    
    // Database
    runtimeOnly("org.postgresql:postgresql")
    
    // Validation
    implementation("org.springframework.boot:spring-boot-starter-validation")
    
    // JSON processing
    implementation("com.fasterxml.jackson.dataformat:jackson-dataformat-xml")
    
    testImplementation("com.h2database:h2")
}
```

#### 4. collector-service/src/main/resources/application.yml

```yaml
spring:
  application:
    name: collector-service
  
  config:
    import: "consul:"
  
  cloud:
    consul:
      host: ${CONSUL_HOST:consul}
      port: ${CONSUL_PORT:8500}
      config:
        enabled: true
        prefix: config
        default-context: ${spring.application.name}
        format: PROPERTIES
        fail-fast: true
      discovery:
        enabled: true
        health-check-path: /actuator/health
        health-check-interval: 10s
  
  datasource:
    url: ${DATABASE_URL:jdbc:postgresql://localhost:5432/newsinsight}
    driver-class-name: org.postgresql.Driver
    hikari:
      maximum-pool-size: 10
      minimum-idle: 2
      connection-timeout: 30000
  
  jpa:
    hibernate:
      ddl-auto: validate  # Flyway/Liquibase 사용 권장
    properties:
      hibernate:
        dialect: org.hibernate.dialect.PostgreSQLDialect
        format_sql: true
    show-sql: false
  
  data:
    redis:
      url: ${REDIS_URL:redis://localhost:6379}

server:
  port: ${PORT:8002}

# WebClient 설정
webclient:
  max-memory-size: 16MB
  connect-timeout: 5000
  read-timeout: 30000

management:
  endpoints:
    web:
      exposure:
        include: health,info,env,metrics,prometheus
  endpoint:
    health:
      show-details: always

logging:
  level:
    com.newsinsight.collector: DEBUG
    org.springframework.web: INFO
    org.hibernate.SQL: DEBUG
    org.hibernate.type.descriptor.sql.BasicBinder: TRACE
```

#### 5. 설정 값 주입 예제

**Java Config 클래스 방식**:

```java
package com.newsinsight.collector.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConfigurationProperties(prefix = "collector")
public class CollectorProperties {
    private int maxConcurrentRequests = 10;
    private String[] rssFeeds;
    private String analysisServiceUrl;
    
    // Getters and setters
    public int getMaxConcurrentRequests() {
        return maxConcurrentRequests;
    }
    
    public void setMaxConcurrentRequests(int maxConcurrentRequests) {
        this.maxConcurrentRequests = maxConcurrentRequests;
    }
    
    // ... 기타 getter/setter
}
```

**@Value 어노테이션 방식**:

```java
@Service
public class CollectionService {
    @Value("${ANALYSIS_SERVICE_URL}")
    private String analysisServiceUrl;
    
    @Value("${MAX_CONCURRENT_REQUESTS:10}")
    private int maxConcurrentRequests;
}
```

---

## Phase 2: 핵심 서비스 마이그레이션

### 2.1 API Gateway 마이그레이션

#### 목표
FastAPI 기반 API Gateway를 Spring Cloud Gateway로 전환하여 collector-service로의 라우팅, 인증, Rate Limiting을 구현합니다.

#### Python (FastAPI) vs Spring (Spring Cloud Gateway) 매핑

| Python/FastAPI | Spring Boot/Gateway | 설명 |
|---------------|---------------------|------|
| `app.middleware("http")` | `GlobalFilter` | 전역 필터 |
| `auth_middleware` | `JwtAuthenticationFilter` | JWT 인증 |
| `rbac_middleware` | `@PreAuthorize` | 역할 기반 접근 제어 |
| `rate_limit_middleware` | `RequestRateLimiter` | Rate Limiting |
| `app.include_router()` | `RouteLocator` | 라우팅 |
| `httpx.AsyncClient` | `WebClient` | 비동기 HTTP 클라이언트 |

#### 구현 작업

##### 1. JWT 인증 필터 구현

`api-gateway/src/main/java/com/newsinsight/gateway/filter/JwtAuthenticationFilter.java`:

```java
package com.newsinsight.gateway.filter;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
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

@Component
public class JwtAuthenticationFilter implements GlobalFilter, Ordered {
    
    private static final List<String> PUBLIC_PATHS = List.of(
        "/health",
        "/actuator",
        "/api/v1/auth/login",
        "/api/v1/auth/register"
    );
    
    @Value("${JWT_SECRET_KEY}")
    private String jwtSecretKey;
    
    @Value("${JWT_ALGORITHM:HS256}")
    private String jwtAlgorithm;
    
    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getPath().value();
        
        // 공개 엔드포인트는 인증 스킵
        if (PUBLIC_PATHS.stream().anyMatch(path::startsWith)) {
            return chain.filter(exchange);
        }
        
        String authHeader = exchange.getRequest().getHeaders().getFirst("Authorization");
        
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }
        
        String token = authHeader.substring(7);
        
        try {
            SecretKey key = Keys.hmacShaKeyFor(jwtSecretKey.getBytes(StandardCharsets.UTF_8));
            Claims claims = Jwts.parserBuilder()
                    .setSigningKey(key)
                    .build()
                    .parseClaimsJws(token)
                    .getBody();
            
            // 사용자 정보를 헤더에 추가 (다운스트림 서비스에서 사용)
            ServerHttpRequest mutatedRequest = exchange.getRequest().mutate()
                    .header("X-User-Id", claims.getSubject())
                    .header("X-User-Role", claims.get("role", String.class))
                    .header("X-Username", claims.get("username", String.class))
                    .build();
            
            return chain.filter(exchange.mutate().request(mutatedRequest).build());
            
        } catch (Exception e) {
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }
    }
    
    @Override
    public int getOrder() {
        return -100; // 높은 우선순위 (먼저 실행)
    }
}
```

##### 2. RBAC 필터 구현

`api-gateway/src/main/java/com/newsinsight/gateway/filter/RbacFilter.java`:

```java
package com.newsinsight.gateway.filter;

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
            return chain.filter(exchange);
        }
        
        HttpMethod method = exchange.getRequest().getMethod();
        String requiredPermission = METHOD_PERMISSIONS.get(method);
        List<String> userPermissions = ROLE_PERMISSIONS.getOrDefault(userRole, List.of());
        
        if (!userPermissions.contains(requiredPermission)) {
            exchange.getResponse().setStatusCode(HttpStatus.FORBIDDEN);
            return exchange.getResponse().setComplete();
        }
        
        return chain.filter(exchange);
    }
    
    @Override
    public int getOrder() {
        return -90; // JWT 필터 다음 실행
    }
}
```

##### 3. Rate Limiting 설정

`application.yml`에 이미 포함되어 있습니다. Redis 기반 Rate Limiter를 사용합니다.

##### 4. 라우팅 설정 (application.yml)

```yaml
spring:
  cloud:
    gateway:
      routes:
        # Collector 서비스 - 소스 관리
        - id: collector-sources
          uri: lb://collector-service
          predicates:
            - Path=/api/v1/collector/sources/**
          filters:
            - StripPrefix=2

        # Collector 서비스 - 수집 작업
        - id: collector-collections
          uri: lb://collector-service
          predicates:
            - Path=/api/v1/collector/collections/**
          filters:
            - StripPrefix=2

        # Collector 서비스 - RSS 피드
        - id: collector-feeds
          uri: lb://collector-service
          predicates:
            - Path=/api/v1/collector/feeds/**
          filters:
            - StripPrefix=2
      
      # 전역 CORS 설정
      globalcors:
        cors-configurations:
          '[/**]':
            allowedOrigins: "*"
            allowedMethods:
              - GET
              - POST
              - PUT
              - DELETE
              - PATCH
            allowedHeaders: "*"
            allowCredentials: true
            maxAge: 3600
```

---

### 2.2 Collector Service 마이그레이션

#### 목표
FastAPI 기반 Collector 서비스를 Spring Boot로 전환하고, web-crawler의 크롤링 로직을 통합합니다.

#### Python vs Spring 매핑

| Python/FastAPI | Spring Boot | 설명 |
|---------------|-------------|------|
| `@router.post()` | `@PostMapping` | POST 엔드포인트 |
| `@router.get()` | `@GetMapping` | GET 엔드포인트 |
| `Session = Depends(get_db)` | `@Autowired` Repository | DB 접근 |
| `BackgroundTasks` | `@Async` / `CompletableFuture` | 비동기 작업 |
| `httpx.AsyncClient` | `WebClient` | HTTP 클라이언트 |
| Pydantic model | `@Entity` / DTO | 데이터 모델 |
| SQLAlchemy | JPA/Hibernate | ORM |

#### 구현 작업

##### 1. 엔티티 정의

`collector-service/src/main/java/com/newsinsight/collector/entity/DataSource.java`:

```java
package com.newsinsight.collector.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Entity
@Table(name = "data_sources")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class DataSource {
    
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(nullable = false, length = 200)
    private String name;
    
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private SourceType type;  // RSS, WEB_SCRAPING, API
    
    @Column(nullable = false, length = 500)
    private String url;
    
    @Column(nullable = false)
    private Boolean active = true;
    
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;
    
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
    
    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }
    
    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
```

##### 2. Repository 정의

`collector-service/src/main/java/com/newsinsight/collector/repository/DataSourceRepository.java`:

```java
package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.DataSource;
import com.newsinsight.collector.entity.SourceType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface DataSourceRepository extends JpaRepository<DataSource, Long> {
    
    List<DataSource> findByActive(Boolean active);
    
    List<DataSource> findByType(SourceType type);
    
    @Query("SELECT ds FROM DataSource ds WHERE ds.active = true AND ds.type = :type")
    List<DataSource> findActiveSourcesByType(SourceType type);
}
```

##### 3. DTO 정의

`collector-service/src/main/java/com/newsinsight/collector/dto/CollectionRequest.java`:

```java
package com.newsinsight.collector.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.util.List;

@Data
public class CollectionRequest {
    
    @NotNull(message = "Source IDs are required")
    private List<Long> sourceIds;
    
    private Boolean immediate = false;
}
```

##### 4. Service 계층 구현

`collector-service/src/main/java/com/newsinsight/collector/service/CollectionService.java`:

```java
package com.newsinsight.collector.service;

import com.newsinsight.collector.dto.CollectionJob;
import com.newsinsight.collector.dto.CollectionRequest;
import com.newsinsight.collector.entity.DataSource;
import com.newsinsight.collector.repository.DataSourceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class CollectionService {
    
    private final DataSourceRepository dataSourceRepository;
    private final WebClient.Builder webClientBuilder;
    
    @Transactional
    public List<CollectionJob> startCollection(CollectionRequest request) {
        List<DataSource> sources = dataSourceRepository.findAllById(request.getSourceIds());
        
        return sources.stream()
                .map(source -> {
                    CollectionJob job = new CollectionJob();
                    job.setSourceId(source.getId());
                    job.setSourceName(source.getName());
                    job.setStatus("PENDING");
                    
                    // 비동기로 수집 시작
                    if (request.getImmediate()) {
                        collectDataAsync(source);
                    }
                    
                    return job;
                })
                .collect(Collectors.toList());
    }
    
    @Async
    public CompletableFuture<Void> collectDataAsync(DataSource source) {
        log.info("Starting collection for source: {}", source.getName());
        
        try {
            WebClient webClient = webClientBuilder
                    .baseUrl(source.getUrl())
                    .build();
            
            String response = webClient.get()
                    .retrieve()
                    .bodyToMono(String.class)
                    .block();
            
            log.info("Successfully collected data from: {}", source.getName());
            // 수집된 데이터 처리 로직...
            
        } catch (Exception e) {
            log.error("Failed to collect data from {}: {}", source.getName(), e.getMessage());
        }
        
        return CompletableFuture.completedFuture(null);
    }
}
```

##### 5. Controller 구현

`collector-service/src/main/java/com/newsinsight/collector/controller/CollectionController.java`:

```java
package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.CollectionJob;
import com.newsinsight.collector.dto.CollectionRequest;
import com.newsinsight.collector.service.CollectionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/collections")
@RequiredArgsConstructor
public class CollectionController {
    
    private final CollectionService collectionService;
    
    @PostMapping("/start")
    public ResponseEntity<List<CollectionJob>> startCollection(
            @Valid @RequestBody CollectionRequest request) {
        List<CollectionJob> jobs = collectionService.startCollection(request);
        return ResponseEntity.ok(jobs);
    }
    
    @GetMapping("/stats")
    public ResponseEntity<?> getCollectionStats() {
        // 통계 조회 로직
        return ResponseEntity.ok().build();
    }
}
```

##### 6. Web Crawler 통합 (WebClient 사용)

Python의 `httpx` 라이브러리를 Spring의 `WebClient`로 대체합니다:

`collector-service/src/main/java/com/newsinsight/collector/service/WebScraperService.java`:

```java
package com.newsinsight.collector.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletableFuture;

@Service
@RequiredArgsConstructor
@Slf4j
public class WebScraperService {
    
    private final WebClient.Builder webClientBuilder;
    
    public CompletableFuture<String> scrapeUrl(String url) {
        WebClient webClient = webClientBuilder
                .baseUrl(url)
                .build();
        
        return webClient.get()
                .retrieve()
                .bodyToMono(String.class)
                .timeout(Duration.ofSeconds(30))
                .subscribeOn(Schedulers.boundedElastic())
                .toFuture();
    }
    
    public CompletableFuture<List<String>> scrapeMultipleUrls(List<String> urls) {
        List<Mono<String>> requests = urls.stream()
                .map(this::scrapeUrlMono)
                .toList();
        
        return Mono.zip(requests, results -> 
                        List.of(results).stream()
                                .map(Object::toString)
                                .toList()
                )
                .subscribeOn(Schedulers.parallel())
                .toFuture();
    }
    
    private Mono<String> scrapeUrlMono(String url) {
        return webClientBuilder.build()
                .get()
                .uri(url)
                .retrieve()
                .bodyToMono(String.class)
                .timeout(Duration.ofSeconds(30))
                .onErrorResume(e -> {
                    log.error("Failed to scrape {}: {}", url, e.getMessage());
                    return Mono.just("");
                });
    }
}
```

---

## Phase 3: Docker 및 배포 환경 통합

### 목표
기존 Consul 인프라를 유지하면서 Spring Boot 서비스를 Docker Compose로 배포합니다.

### 작업 항목

#### 1. 간소화된 docker-compose.yml

프로젝트 루트에 `docker-compose.spring.yml` 생성:

```yaml
version: '3.9'

services:
  # Consul 서버
  consul:
    image: hashicorp/consul:1.18
    command: ["agent", "-dev", "-client", "0.0.0.0", "-ui"]
    ports:
      - "8500:8500"
    environment:
      - CONSUL_BIND_INTERFACE=eth0
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8500/v1/status/leader"]
      interval: 5s
      timeout: 3s
      retries: 20
    networks:
      - newsinsight-net

  # Consul 설정 시드
  consul-seed:
    image: alpine:3.18
    depends_on:
      consul:
        condition: service_healthy
    volumes:
      - ./scripts:/scripts:ro
      - ./configs:/configs:ro
    environment:
      - CONSUL_HTTP_ADDR=http://consul:8500
    command: >
      sh -c "
        apk add --no-cache curl bash jq &&
        /scripts/consul_seed.sh ${ENVIRONMENT:-development}
      "
    restart: "no"
    networks:
      - newsinsight-net

  # PostgreSQL 데이터베이스
  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=newsinsight
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 10
    networks:
      - newsinsight-net

  # Redis
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
    networks:
      - newsinsight-net

  # Spring Cloud Gateway
  api-gateway:
    build:
      context: .
      dockerfile: api-gateway/Dockerfile
    image: newsinsight/api-gateway:latest
    depends_on:
      consul-seed:
        condition: service_completed_successfully
      redis:
        condition: service_healthy
    environment:
      - SPRING_PROFILES_ACTIVE=${ENVIRONMENT:-development}
      - CONSUL_HOST=consul
      - CONSUL_PORT=8500
      # Consul KV에서 대부분의 설정 로드
    ports:
      - "8000:8000"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8000/actuator/health"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - newsinsight-net

  # Spring Boot Collector Service
  collector-service:
    build:
      context: .
      dockerfile: collector-service/Dockerfile
    image: newsinsight/collector-service:latest
    depends_on:
      consul-seed:
        condition: service_completed_successfully
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      - SPRING_PROFILES_ACTIVE=${ENVIRONMENT:-development}
      - CONSUL_HOST=consul
      - CONSUL_PORT=8500
    ports:
      - "8002:8002"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8002/actuator/health"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - newsinsight-net

networks:
  newsinsight-net:
    name: newsinsight-net
    driver: bridge

volumes:
  postgres-data:
```

#### 2. Consul 설정 업데이트

`configs/development.env`에 Spring Boot용 설정 추가:

```properties
# API Gateway (Spring Boot)
API_GATEWAY_PORT=8000
API_GATEWAY_DEBUG=true
API_GATEWAY_JWT_SECRET_KEY=dev-secret-key-change-in-production
API_GATEWAY_JWT_ALGORITHM=HS256
API_GATEWAY_JWT_EXPIRATION_HOURS=24
API_GATEWAY_COLLECTOR_SERVICE_URL=http://collector-service:8002
API_GATEWAY_RATE_LIMIT_REDIS_URL=redis://redis:6379

# Collector Service (Spring Boot)
COLLECTOR_SERVICE_PORT=8002
COLLECTOR_SERVICE_DATABASE_URL=jdbc:postgresql://postgres:5432/newsinsight
COLLECTOR_SERVICE_REDIS_URL=redis://redis:6379
COLLECTOR_SERVICE_MAX_CONCURRENT_REQUESTS=10
```

#### 3. 빌드 및 배포 스크립트

`scripts/build-and-deploy.sh`:

```bash
#!/bin/bash

set -e

ENVIRONMENT=${1:-development}

echo "Building Spring Boot services..."
./gradlew clean build -x test

echo "Building Docker images..."
docker compose -f docker-compose.spring.yml build

echo "Starting services with $ENVIRONMENT environment..."
ENVIRONMENT=$ENVIRONMENT docker compose -f docker-compose.spring.yml up -d

echo "Waiting for services to be healthy..."
sleep 10

echo "Checking service health..."
curl -f http://localhost:8000/actuator/health || echo "API Gateway not ready"
curl -f http://localhost:8002/actuator/health || echo "Collector Service not ready"

echo "Deployment complete!"
echo "API Gateway: http://localhost:8000"
echo "Collector Service: http://localhost:8002"
echo "Consul UI: http://localhost:8500"
```

---

## Phase 4: 테스트 및 검증

### 목표
마이그레이션된 서비스가 정상적으로 동작하는지 검증합니다.

### 테스트 항목

#### 1. Health Check 테스트

```bash
# API Gateway 헬스 체크
curl http://localhost:8000/actuator/health

# 예상 응답:
# {
#   "status": "UP",
#   "components": {
#     "consul": {"status": "UP"},
#     "diskSpace": {"status": "UP"},
#     "ping": {"status": "UP"}
#   }
# }

# Collector Service 헬스 체크
curl http://localhost:8002/actuator/health
```

#### 2. Consul 설정 확인

```bash
# /actuator/env 엔드포인트로 Consul에서 로드된 설정 확인
curl http://localhost:8000/actuator/env | jq '.propertySources[] | select(.name | contains("consul"))'

# Consul UI에서 직접 확인
open http://localhost:8500/ui/dc1/kv/config/api-gateway/
```

#### 3. Fail-Fast 테스트

```bash
# Consul 중지
docker compose -f docker-compose.spring.yml stop consul

# 서비스 재시작 시도 (실패해야 함)
docker compose -f docker-compose.spring.yml restart api-gateway

# 로그 확인
docker compose -f docker-compose.spring.yml logs api-gateway

# 예상 로그:
# Error creating bean with name 'consulConfigDataLoader'
# Unable to load config data from 'consul:...'
```

#### 4. 통합 테스트 (API Gateway → Collector Service)

```bash
# 1. 데이터 소스 목록 조회
curl http://localhost:8000/api/v1/collector/sources

# 2. 새 데이터 소스 생성
curl -X POST http://localhost:8000/api/v1/collector/sources \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -d '{
    "name": "Test News Site",
    "type": "RSS",
    "url": "https://example.com/rss",
    "active": true
  }'

# 3. 수집 작업 시작
curl -X POST http://localhost:8000/api/v1/collector/collections/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -d '{
    "sourceIds": [1],
    "immediate": true
  }'
```

#### 5. Rate Limiting 테스트

```bash
# 연속으로 요청 보내기 (100번 초과 시 429 응답)
for i in {1..150}; do
  curl -w "\n%{http_code}\n" http://localhost:8000/api/v1/collector/sources
done

# 예상: 처음 100개는 200, 이후는 429 Too Many Requests
```

#### 6. JWT 인증 테스트

```bash
# 인증 없이 요청 (401 예상)
curl -w "\n%{http_code}\n" http://localhost:8000/api/v1/collector/sources

# 잘못된 토큰 (401 예상)
curl -H "Authorization: Bearer invalid-token" \
  -w "\n%{http_code}\n" \
  http://localhost:8000/api/v1/collector/sources

# 유효한 토큰 (200 예상)
TOKEN="eyJhbGc..."  # 실제 JWT 토큰
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/v1/collector/sources
```

#### 7. 서비스 디스커버리 테스트

```bash
# Consul에 등록된 서비스 확인
curl http://localhost:8500/v1/catalog/services | jq

# 예상 출력:
# {
#   "api-gateway": [],
#   "collector-service": [],
#   "consul": []
# }

# 특정 서비스의 인스턴스 확인
curl http://localhost:8500/v1/health/service/collector-service | jq
```

---

## 마이그레이션 체크리스트

### Phase 0: 사전 준비
- [ ] Gradle 멀티 모듈 프로젝트 구조 생성
- [ ] 루트 build.gradle.kts 설정
- [ ] settings.gradle.kts 설정
- [ ] 각 서비스별 Dockerfile 생성
- [ ] 공통 의존성 정의

### Phase 1: Consul Config 연동
- [ ] api-gateway 모듈에 spring-cloud-consul-config 의존성 추가
- [ ] collector-service 모듈에 spring-cloud-consul-config 의존성 추가
- [ ] api-gateway application.yml 설정
- [ ] collector-service application.yml 설정
- [ ] Consul KV 구조 확인 및 업데이트
- [ ] @ConfigurationProperties 클래스 작성

### Phase 2: 서비스 마이그레이션
- [ ] API Gateway
  - [ ] JwtAuthenticationFilter 구현
  - [ ] RbacFilter 구현
  - [ ] Rate Limiting 설정
  - [ ] 라우팅 설정 (collector-service)
- [ ] Collector Service
  - [ ] Entity 정의 (DataSource, CollectionJob 등)
  - [ ] Repository 구현
  - [ ] Service 계층 구현
  - [ ] Controller 구현
  - [ ] WebScraperService 구현 (web-crawler 통합)
  - [ ] 비동기 작업 (@Async) 구현

### Phase 3: Docker 및 배포
- [ ] docker-compose.spring.yml 작성
- [ ] Consul 설정 파일 업데이트 (development.env)
- [ ] 빌드 스크립트 작성
- [ ] 로컬 환경에서 Docker Compose로 실행 테스트

### Phase 4: 테스트 및 검증
- [ ] Health Check 테스트
- [ ] Consul 설정 로드 확인 (/actuator/env)
- [ ] Fail-Fast 동작 확인
- [ ] API Gateway → Collector Service 통합 테스트
- [ ] Rate Limiting 테스트
- [ ] JWT 인증/인가 테스트
- [ ] 서비스 디스커버리 테스트

---

## 참고 자료

### Spring Boot 공식 문서
- [Spring Boot Reference Documentation](https://docs.spring.io/spring-boot/docs/current/reference/html/)
- [Spring Cloud Gateway](https://docs.spring.io/spring-cloud-gateway/docs/current/reference/html/)
- [Spring Cloud Consul](https://docs.spring.io/spring-cloud-consul/docs/current/reference/html/)

### 추가 리소스
- [Gradle Kotlin DSL Primer](https://docs.gradle.org/current/userguide/kotlin_dsl.html)
- [JPA Best Practices](https://vladmihalcea.com/tutorials/hibernate/)
- [WebClient Documentation](https://docs.spring.io/spring-framework/reference/web/webflux-webclient.html)

---

## 문의 및 지원

마이그레이션 중 문제가 발생하면:
1. 서비스 로그 확인: `docker compose -f docker-compose.spring.yml logs <service-name>`
2. Consul UI 확인: `http://localhost:8500/ui/`
3. Actuator 엔드포인트 확인: `http://localhost:8000/actuator/health`

**Last Updated**: November 6, 2025  
**Version**: 1.0.0  
**Migration Status**: Planning Phase
