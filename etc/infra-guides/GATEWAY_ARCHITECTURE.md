# API Gateway 아키텍처: Nginx 대안 전략

## 현재 상황 분석

### 기존 아키텍처의 문제점

1. **Nginx L7 프록시 방식의 한계**
   - L3/L4/L7 레이어 분리로 인한 복잡성 증가
   - 설정 파일 기반 관리로 동적 라우팅 어려움
   - 서비스 디스커버리와의 통합 복잡
   - CORS/인증 로직 중복 (Nginx + Backend)

2. **현재 통신 이슈**
   - 프론트엔드 개발 서버와 백엔드 간 CORS 문제
   - 다중 서비스 포트 관리 복잡성
   - WebSocket 프록시 설정 어려움

---

## 권장 아키텍처: Spring Cloud Gateway 중심

### 왜 Spring Cloud Gateway인가?

| 기능 | Nginx | Spring Cloud Gateway |
|------|-------|----------------------|
| 서비스 디스커버리 | 외부 도구 필요 | Consul/Eureka 네이티브 통합 |
| 동적 라우팅 | 재시작 필요 | 런타임 변경 가능 |
| CORS 설정 | 정적 설정 | Java 코드로 동적 제어 |
| Rate Limiting | 외부 모듈 | Redis 연동 내장 |
| Circuit Breaker | 불가 | Resilience4j 통합 |
| JWT 검증 | Lua 스크립트 | Spring Security 통합 |
| 모니터링 | 별도 구성 | Actuator/Prometheus 내장 |
| WebSocket | 설정 복잡 | 네이티브 지원 |

---

## 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────────────┐
│                         프로덕션 환경                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐                                                    │
│  │   Client    │                                                    │
│  │  (Browser)  │                                                    │
│  └──────┬──────┘                                                    │
│         │                                                           │
│         ▼                                                           │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              Spring Cloud Gateway (Port 8000)                 │   │
│  │  ┌─────────────────────────────────────────────────────────┐ │   │
│  │  │  Pre-Filters                                            │ │   │
│  │  │  - CORS Filter                                          │ │   │
│  │  │  - JWT Authentication Filter                            │ │   │
│  │  │  - Rate Limiting Filter (Redis)                         │ │   │
│  │  │  - Request Logging Filter                               │ │   │
│  │  └─────────────────────────────────────────────────────────┘ │   │
│  │                                                              │   │
│  │  ┌─────────────────────────────────────────────────────────┐ │   │
│  │  │  Route Predicates (Consul Service Discovery)            │ │   │
│  │  │  - /api/v1/data/**      → lb://collector-service        │ │   │
│  │  │  - /api/v1/sources/**   → lb://collector-service        │ │   │
│  │  │  - /api/v1/articles/**  → lb://collector-service        │ │   │
│  │  │  - /api/v1/analysis/**  → lb://collector-service        │ │   │
│  │  │  - /browse/**           → lb://browser-use-api          │ │   │
│  │  │  - /ws/**               → lb://browser-use-api (WS)     │ │   │
│  │  │  - /jobs/**             → lb://browser-use-api          │ │   │
│  │  │  - /**                  → Static Files (SPA)            │ │   │
│  │  └─────────────────────────────────────────────────────────┘ │   │
│  │                                                              │   │
│  │  ┌─────────────────────────────────────────────────────────┐ │   │
│  │  │  Post-Filters                                           │ │   │
│  │  │  - Response Logging                                     │ │   │
│  │  │  - Error Handling                                       │ │   │
│  │  │  - Metrics Collection                                   │ │   │
│  │  └─────────────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────────┘   │
│         │                    │                    │                 │
│         ▼                    ▼                    ▼                 │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────────────┐        │
│  │  Collector  │    │ Browser-Use  │    │  Other Services  │        │
│  │   Service   │    │     API      │    │   (Future)       │        │
│  │  (Port 8081)│    │  (Port 8500) │    │                  │        │
│  └─────────────┘    └──────────────┘    └──────────────────┘        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 구현 전략

### Phase 1: 현재 Gateway 강화 (이미 완료된 부분)

현재 `api-gateway-service`에 이미 구현되어 있음:
- Spring Cloud Gateway 기반
- Consul 서비스 디스커버리 연동
- Redis Rate Limiting
- CORS 설정

### Phase 2: Browser-Use 라우팅 추가

`application.yml`에 Browser-Use 라우트 추가:

```yaml
spring:
  cloud:
    gateway:
      routes:
        # 기존 라우트...
        
        # Browser-Use API
        - id: browser-use-api
          uri: ${BROWSER_USE_URL:http://localhost:8500}
          predicates:
            - Path=/browse/**,/jobs/**,/health
          filters:
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 10
                redis-rate-limiter.burstCapacity: 20

        # Browser-Use WebSocket
        - id: browser-use-websocket
          uri: ${BROWSER_USE_WS_URL:ws://localhost:8500}
          predicates:
            - Path=/ws/**
          filters:
            - name: WebSocket

        # SPA Fallback (프론트엔드 정적 파일)
        - id: frontend-spa
          uri: ${FRONTEND_URL:http://localhost:8080}
          predicates:
            - Path=/**
          filters:
            - name: RewritePath
              args:
                regexp: "^/(?!api|browse|jobs|ws|health).*"
                replacement: "/"
```

### Phase 3: JWT 인증 통합 (선택)

```java
@Component
public class JwtAuthenticationFilter implements GlobalFilter, Ordered {
    
    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getPath().value();
        
        // 인증 제외 경로
        if (isPublicPath(path)) {
            return chain.filter(exchange);
        }
        
        String token = extractToken(exchange.getRequest());
        if (token == null || !validateToken(token)) {
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }
        
        return chain.filter(exchange);
    }
    
    private boolean isPublicPath(String path) {
        return path.startsWith("/api/v1/config") 
            || path.startsWith("/health")
            || path.startsWith("/actuator");
    }
    
    @Override
    public int getOrder() {
        return -100; // 높은 우선순위
    }
}
```

### Phase 4: 프로덕션 배포 구성

#### Docker Compose 통합 (단일 진입점)

```yaml
services:
  api-gateway:
    build: ./backend/api-gateway-service
    ports:
      - "80:8000"      # HTTP
      - "443:8443"     # HTTPS (optional)
    environment:
      - BROWSER_USE_URL=http://browser-use-api:8500
      - COLLECTOR_SERVICE_URL=http://collector-service:8081
      - CONSUL_HOST=consul
      - REDIS_HOST=redis
    depends_on:
      - consul
      - redis
      - collector-service
      - browser-use-api
```

#### SSL/TLS 설정 (Spring Boot)

```yaml
server:
  port: 8443
  ssl:
    enabled: true
    key-store: classpath:keystore.p12
    key-store-type: PKCS12
    key-store-password: ${SSL_KEYSTORE_PASSWORD}
```

---

## 개발 환경 구성

### Vite Proxy (개발용)

개발 환경에서는 Vite 개발 서버가 프록시 역할:

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Browser    │────▶│   Vite Dev       │────▶│  API Gateway    │
│              │     │   (Port 8080)    │     │  (Port 8112)    │
│              │     │                  │     │                 │
│              │     │  Proxy: /api/*   │     └────────┬────────┘
│              │     │  Proxy: /ws/*    │              │
│              │     │  Proxy: /browse/*│              ▼
│              │     │  Proxy: /jobs/*  │     ┌─────────────────┐
│              │     │                  │     │ collector-svc   │
└──────────────┘     └──────────────────┘     │ browser-use     │
                                              └─────────────────┘
```

---

## 장점 요약

### 1. 단일 진입점
- 모든 트래픽이 Gateway를 통과
- 클라이언트는 단일 호스트/포트만 알면 됨
- CORS 문제 원천 해결

### 2. 동적 서비스 디스커버리
- Consul과 네이티브 통합
- 서비스 추가/제거 시 자동 반영
- 로드 밸런싱 내장 (`lb://service-name`)

### 3. 중앙 집중식 보안
- JWT 검증 한 곳에서 처리
- Rate Limiting 통합 관리
- 감사 로그 중앙화

### 4. 운영 효율성
- Spring Boot Actuator로 헬스체크/메트릭스
- Prometheus/Grafana 연동 용이
- 설정 변경 시 재시작 최소화

### 5. 확장성
- 마이크로서비스 추가 용이
- A/B 테스팅, Canary 배포 지원
- Circuit Breaker로 장애 격리

---

## 마이그레이션 체크리스트

- [x] Spring Cloud Gateway 기본 구성
- [x] Consul 서비스 디스커버리 연동
- [x] Redis Rate Limiting 설정
- [x] CORS 전역 설정
- [ ] Browser-Use 라우트 추가
- [ ] WebSocket 프록시 설정
- [ ] JWT 인증 필터 구현 (선택)
- [ ] SSL/TLS 설정 (프로덕션)
- [ ] SPA 정적 파일 서빙 설정
- [ ] Prometheus 메트릭스 노출
- [ ] Docker Compose 통합 테스트

---

## 참고 자료

- [Spring Cloud Gateway 공식 문서](https://docs.spring.io/spring-cloud-gateway/docs/current/reference/html/)
- [Spring Cloud Consul](https://docs.spring.io/spring-cloud-consul/docs/current/reference/html/)
- [Resilience4j Circuit Breaker](https://resilience4j.readme.io/docs/circuitbreaker)
