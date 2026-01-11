# NewsInsight 엔드포인트 연결 상태 보고서

**작성일**: 2026년 1월 11일  
**프로젝트**: NewsInsight Platform  
**경로**: `/home/nodove/workspace/NewsInsight`

---

## 1. 개요

이 보고서는 NewsInsight 플랫폼의 프론트엔드-백엔드 API 엔드포인트 연결 상태를 분석한 결과입니다.

### 분석 범위
- 프로젝트 아키텍처 및 구조 파악
- 백엔드 API 엔드포인트 목록 확인
- 프론트엔드 API 호출 코드 분석
- 서비스 실행 상태 확인
- 엔드포인트 연결 테스트

---

## 2. 시스템 아키텍처

### 2.1 마이크로서비스 구성

| 서비스 | 포트 | 기술 스택 | 역할 |
|--------|------|-----------|------|
| **API Gateway** | 8000 | Java/Spring Boot | 단일 진입점, JWT 인증, 라우팅 |
| **Data Collection Service** | 8081 | Java/Spring Boot | 핵심 비즈니스 로직, 검색, 팩트체크 |
| **Autonomous Crawler** | 8030/9090 | Python/FastAPI | 자율 크롤링, 검색 API 연동 |
| **Admin Dashboard** | 8888 | Python/FastAPI | 관리자 API |
| **Browser-Use API** | 8500 | Python | AI 브라우저 자동화 |
| **ML Addons** | 8100-8102 | Python/Flask | 감성분석, 팩트체크, 편향탐지 |
| **MCP Servers** | 5000-5020 | Python | 모델 제어 프로토콜 |
| **Frontend** | 8080 | React/TypeScript/Vite | 사용자 인터페이스 |

### 2.2 네트워크 구성 (Docker)
- **네트워크**: `newsinsight-prod` (172.20.0.0/16)
- **프로덕션 도메인**: `newsinsight.nodove.com` (Cloudflare Tunnel)

---

## 3. API Gateway 라우팅 규칙

**설정 파일**: `backend/api-gateway-service/src/main/resources/application.yml`

| 경로 패턴 | 대상 서비스 | 포트 |
|-----------|-------------|------|
| `/api/v1/data/**` | collector-service | 8081 |
| `/api/v1/sources/**` | collector-service | 8081 |
| `/api/v1/collections/**` | collector-service | 8081 |
| `/api/v1/analysis/**` | collector-service | 8081 |
| `/api/v1/search/**` | collector-service | 8081 |
| `/api/v1/articles/**` | collector-service | 8081 |
| `/api/v1/admin/**` | admin-dashboard | 8888 |
| `/api/v1/auth/**` | admin-dashboard | 8888 |
| `/api/v1/crawler/**` | autonomous-crawler | 8030 |
| `/api/browser-use/**` | browser-use-api | 8500 |
| `/api/ml-addons/sentiment/**` | ml-sentiment | 8100 |
| `/api/ml-addons/factcheck/**` | ml-factcheck | 8101 |
| `/api/ml-addons/bias/**` | ml-bias | 8102 |

---

## 4. 프론트엔드 API 클라이언트 분석

### 4.1 주요 API 모듈

| 파일 | 역할 | 주요 엔드포인트 |
|------|------|-----------------|
| `frontend/src/lib/api.ts` | 메인 API 클라이언트 (axios) | 기본 설정, 인터셉터 |
| `frontend/src/lib/api/ai.ts` | AI 작업 API | `/api/v1/ai/*` |
| `frontend/src/lib/api/ml.ts` | ML Add-on API | `/api/v1/ml/*` |
| `frontend/src/lib/api/collection.ts` | 데이터 수집 API | `/api/v1/collections/*` |
| `frontend/src/lib/api/mcp.ts` | MCP 서버 API | `/api/v1/mcp/*` |
| `frontend/src/lib/api/events.ts` | SSE 이벤트 API | `/api/v1/events/*` |
| `frontend/src/lib/api/data.ts` | 데이터 관리 API | `/api/v1/data/*` |

### 4.2 API 호출 패턴

```typescript
// Base URL 설정
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

// Axios 인스턴스
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' }
});
```

---

## 5. 서비스 실행 상태

### 5.1 테스트 시점 상태

| 환경 | 상태 | 비고 |
|------|------|------|
| **프로덕션** (`newsinsight.nodove.com`) | ❌ 접속 불가 | Cloudflare Tunnel 비활성화 상태 |
| **로컬 개발** (localhost) | ❌ 미실행 | Docker 컨테이너 미구동 |
| **Docker 환경** | ⚠️ 다른 프로젝트 실행 중 | FilamAI 프로젝트가 포트 사용 중 |

### 5.2 현재 Docker 컨테이너 상태

```
filamai-flutter-web    80    (healthy)
filamai-react-web      8080  (healthy)
filamai-backend        3000  (healthy)
filamai-postgres       5434  (healthy)
filamai-redis          6379  (healthy)
filamai-litellm        4000  (unhealthy)
```

**참고**: NewsInsight 컨테이너는 현재 실행되고 있지 않습니다.

---

## 6. 엔드포인트 연결 테스트 결과

### 6.1 프로덕션 환경 테스트

| 엔드포인트 | HTTP 상태 | 결과 |
|------------|-----------|------|
| `https://newsinsight.nodove.com/` | N/A | ❌ 연결 실패 (타임아웃) |
| `/api/actuator/health` | N/A | ❌ 연결 실패 |
| `/api/v1/config/frontend` | N/A | ❌ 연결 실패 |
| `/api/v1/sources` | N/A | ❌ 연결 실패 |

### 6.2 로컬 환경 테스트

| 포트 | 서비스 | HTTP 상태 | 결과 |
|------|--------|-----------|------|
| 8000 | API Gateway | N/A | ❌ 서비스 미실행 |
| 8081 | Data Collection | N/A | ❌ 서비스 미실행 |
| 8888 | Admin Dashboard | N/A | ❌ 서비스 미실행 |
| 8030 | Autonomous Crawler | N/A | ❌ 서비스 미실행 |

---

## 7. 권장 사항

### 7.1 서비스 시작 방법

#### 옵션 A: Docker Compose 사용 (권장)
```bash
cd /home/nodove/workspace/NewsInsight/etc/docker
docker-compose -f docker-compose.production.yml up -d
```

#### 옵션 B: 개별 서비스 시작
```bash
# 1. Frontend
cd frontend && bun dev

# 2. API Gateway
cd backend/api-gateway-service && ./gradlew bootRun

# 3. Data Collection Service
cd backend/data-collection-service && ./gradlew bootRun

# 4. Admin Dashboard
cd backend/admin-dashboard && poetry run uvicorn api.main:app --port 8888

# 5. Autonomous Crawler
cd backend/autonomous-crawler-service && poetry run python src/main.py
```

### 7.2 사전 요구사항

서비스 시작 전 필요한 인프라:
- **PostgreSQL** (포트 5432)
- **MongoDB** (포트 27017)
- **Redis** (포트 6379)
- **Consul** (포트 8500 - 서비스 디스커버리)
- **Kafka** (포트 9092 - 메시지 큐)

### 7.3 환경 변수 설정

```bash
# 필수 환경 변수 예시
POSTGRES_PASSWORD=<password>
MONGO_PASSWORD=<password>
REDIS_PASSWORD=<password>
CLOUDFLARE_TUNNEL_TOKEN_PROD=<token>
```

---

## 8. 주요 설정 파일 위치

| 파일 | 경로 | 용도 |
|------|------|------|
| API Gateway 라우팅 | `backend/api-gateway-service/src/main/resources/application.yml` | 라우팅 규칙, 보안 설정 |
| Docker Compose (프로덕션) | `etc/docker/docker-compose.production.yml` | 전체 서비스 배포 |
| 프론트엔드 API | `frontend/src/lib/api.ts` | API 클라이언트 설정 |
| Admin Dashboard | `backend/admin-dashboard/api/main.py` | FastAPI 앱 진입점 |
| Crawler API | `backend/autonomous-crawler-service/src/api/server.py` | 크롤러 API 서버 |

---

## 9. 결론

### 9.1 현재 상태 요약

- ✅ **프로젝트 구조 분석 완료**: 마이크로서비스 아키텍처 확인
- ✅ **API 엔드포인트 매핑 완료**: 15+ 라우팅 규칙 확인
- ✅ **프론트엔드-백엔드 연결 설계 확인**: API Gateway 패턴 사용
- ❌ **실제 연결 테스트 불가**: 서비스 미실행 상태

### 9.2 다음 단계

1. **인프라 서비스 시작**: PostgreSQL, MongoDB, Redis, Consul, Kafka
2. **백엔드 서비스 시작**: API Gateway → Data Collection → Admin Dashboard → Crawler
3. **프론트엔드 시작**: React 개발 서버 또는 빌드된 정적 파일
4. **엔드포인트 재테스트**: 각 서비스별 Health 체크 및 기능 테스트
5. **프로덕션 배포 확인**: Cloudflare Tunnel 설정 확인

---

**보고서 작성자**: Claude (AI Assistant)  
**보고서 버전**: 1.0
