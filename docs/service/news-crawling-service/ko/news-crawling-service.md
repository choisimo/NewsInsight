# 뉴스 크롤링 서비스 개발 명세서

## 1. 기본 정보

- 기능 이름: 뉴스 크롤링 서비스
- 버전: v1.0.0
- 작성일: 2025-10-29
- 최종 수정일: 2025-10-29

## 2. 서비스 개요

- **서비스 역할:**
  - 키워드 기반으로 최신 뉴스 기사를 수집하고 정제하여 분석 파이프라인에 전달하는 데이터 수집 서비스
  - 수집된 기사에 대한 메타데이터, 중복 제거 정보, 오류 상태를 관리
  - 주기적 배치와 온디맨드 요청을 모두 지원하여 분석 서비스의 데이터 신선도를 확보
- **해결하고자 하는 비즈니스 문제:**
  - 수동으로 기사 데이터를 수집하는 비효율성과 누락 리스크 해소
  - 특정 키워드에 대한 실시간 여론 분석을 위한 신뢰성 있는 데이터 공급 확보
- **서비스 범위:**
  - 포함: 키워드 기반 기사 수집, 기사 본문/메타데이터 정규화, 중복 제거, 수집 결과 저장, 상태 모니터링 API
  - 제외: 감성 분석, 키워드 분석, UI 제공, 외부 유료 API 결제 처리

> ### 💡 구현 참고 (Implementation Note)
>
> 본 문서는 Scrapy 및 Celery 기반의 아키텍처를 로드맵으로 제시하고 있으나, **현재 구현체(`BACKEND-COLLECTOR-SERVICE`)**는 FastAPI를 기반으로 하는 경량화된 수집 및 연동 관리 API 중심으로 구성되어 있습니다.
>
> * **Current:** FastAPI 기반 API (수집 타겟 관리, 상태 조회)
> * **Roadmap:** Scrapy/Celery 기반의 대규모 분산 크롤링 도입 (향후 정합화 예정)

## 3. 기술 스택

- 프레임워크: Scrapy, Flask (관리 API), Celery
- 언어 버전: Python 3.11
- 데이터베이스: MongoDB 6.0 (수집 기사 저장), PostgreSQL 15 (작업 메타 관리)
- 캐시: Redis 7.2 (작업 큐, 수집 중복 캐시)

## 4. API 명세

### 4.1 프로토콜

- 타입: REST API
- Base URL: https://api.newsinsight.com/v1
- 인증 방식: 내부 서비스 토큰 (JWT, HS256)

### 4.2 엔드포인트 목록

#### 4.2.1 크롤링 작업 생성

- **Method:** POST
- **Path:** /crawler/jobs
- **설명:** 키워드 기반 크롤링 작업 생성 및 즉시 실행 트리거
- **Request**

```json
{
  "headers": {
    "Content-Type": "application/json",
    "Authorization": "Bearer {token}"
  },
  "body": {
    "keywords": ["삼성전자", "AI"],
    "window": "last_24h",
    "source": "NAVER_NEWS",
    "priority": "HIGH"
  }
}
```

- **Response - 성공 (202 Accepted)**

```json
{
  "status": "success",
  "data": {
    "jobId": "string (UUID)",
    "keywords": ["삼성전자", "AI"],
    "queuedAt": "string (ISO 8601)",
    "expectedCompletion": "string (ISO 8601)"
  }
}
```

- **Response - 실패 (409 Conflict)**

```json
{
  "status": "error",
  "code": "DUPLICATE_JOB",
  "message": "A job with identical parameters is already running",
  "details": []
}
```

#### 4.2.2 수집 기사 조회

- **Method:** GET
- **Path:** /crawler/articles
- **설명:** 최근 수집된 뉴스 기사 목록 조회
- **Query Params:**
  - `keyword` (required)
  - `limit` (optional, default 50, max 200)
  - `since` (optional, ISO 8601)
- **Response - 성공 (200 OK)**

```json
{
  "status": "success",
  "data": [
    {
      "articleId": "string",
      "title": "string",
      "url": "string",
      "source": "NAVER_NEWS",
      "publishedAt": "string (ISO 8601)",
      "fetchedAt": "string (ISO 8601)",
      "language": "ko",
      "dedupeHash": "string"
    }
  ]
}
```

#### 4.2.3 크롤링 작업 상태 조회

- **Method:** GET
- **Path:** /crawler/jobs/{jobId}
- **설명:** 작업 진행 상황 및 오류 정보를 반환
- **Response - 성공 (200 OK)**

```json
{
  "status": "success",
  "data": {
    "jobId": "string",
    "status": "RUNNING | COMPLETED | FAILED",
    "progress": 0.65,
    "startedAt": "string (ISO 8601)",
    "finishedAt": "string (ISO 8601)",
    "articlesFetched": 120,
    "errors": []
  }
}
```

## 5. 데이터 모델

### 5.1 Request DTO

| 필드명   | 타입     | 필수 여부 | 제약 조건                              | 설명                  |
| -------- | -------- | --------- | -------------------------------------- | --------------------- |
| keywords | String[] | Required  | 1-5개, 각 2-30자                       | 수집 대상 키워드 목록 |
| window   | String   | Optional  | `last_3h`, `last_24h`, `last_7d` | 수집 기간 프리셋      |
| source   | String   | Required  | `NAVER_NEWS`, `DAUM_NEWS`          | 뉴스 데이터 소스      |
| priority | String   | Optional  | `LOW`, `NORMAL`, `HIGH`          | 큐 우선순위           |

### 5.2 Response DTO

| 필드명      | 타입              | Nullable | 설명                  |
| ----------- | ----------------- | -------- | --------------------- |
| articleId   | String (ObjectId) | No       | MongoDB 문서 ID       |
| title       | String            | No       | 기사 제목             |
| url         | String            | No       | 기사 원문 URL         |
| source      | String            | No       | 데이터 출처           |
| publishedAt | Timestamp         | Yes      | 기사 발행 시각        |
| fetchedAt   | Timestamp         | No       | 수집 완료 시각        |
| dedupeHash  | String            | No       | 중복 제거를 위한 해시 |

## 6. 연동 서비스

### 6.1 메시지 브로커 (Kafka)

- Topic: articles.fetched
- Event Type: ARTICLE_FETCHED
- Producer/Consumer: Producer
- Message Format:

```json
{
  "eventId": "string (UUID)",
  "eventType": "ARTICLE_FETCHED",
  "timestamp": "ISO 8601",
  "payload": {
    "articleId": "string",
    "keywords": ["string"],
    "source": "string",
    "publishedAt": "string",
    "fetchedAt": "string"
  }
}
```

### 6.2 실시간 통신 (WebSocket)

- 프로토콜: WebSocket (관리 콘솔용)
- Endpoint: /ws/crawler/stream
- Event Types: job.updated, job.failed

### 6.3 외부 API 호출

- 서비스명: 뉴스 공급자 API (NAVER News API)
- Type: REST API
- Endpoint: GET /news
- Timeout: 3초
- Retry 정책: 5회, 지수 백오프 (최대 30초)

## 7. 에러 코드 정의

| 에러 코드      | HTTP Status | 설명                         | 처리 방법                     |
| -------------- | ----------- | ---------------------------- | ----------------------------- |
| DUPLICATE_JOB  | 409         | 동일 파라미터 작업이 진행 중 | 기존 작업 모니터링 후 재시도  |
| INVALID_SOURCE | 400         | 미지원 뉴스 소스 요청        | 지원 소스 목록 확인           |
| FETCH_TIMEOUT  | 504         | 외부 API 응답 지연           | 재시도 정책 적용 및 슬랙 알림 |
| RATE_LIMITED   | 429         | 외부 API Rate Limit 초과     | 백오프 및 대체 소스 전환      |
| INTERNAL_ERROR | 500         | 서버 내부 오류               | 로그 분석 및 재배포           |

## 8. 성능 요구사항

- 응답 시간: P50 < 150ms, P95 < 400ms, P99 < 800ms (관리 API 기준)
- 처리량: 분당 5,000 기사 처리
- 동시 크롤링 작업: 최대 50개
- 작업 SLA: `last_24h` 작업 5분 내 완료

## 9. 보안 요구사항

- 인증/인가: 내부 서비스 JWT + IP allowlist
- 데이터 암호화: 전송 TLS 1.3, 저장 시 민감 키워드 AES-256 암호화 (옵션)
- Rate Limiting: 관리 API 60 req/min per client
- 입력 검증: 키워드 sanitize 및 외부 링크 validation
- 비밀 정보는 AWS Secrets Manager로 관리

## 10. 모니터링 & 로깅

### 10.1 로깅

- 로그 레벨: INFO, WARN, ERROR
- 필수 포함 정보: requestId, jobId, keyword, source, timestamp, latency, retryCount

### 10.2 메트릭

- 크롤링 성공률
- 외부 API 실패율
- 작업 대기 시간
- 기사 중복 비율

### 10.3 알림

- 외부 API 실패율 > 10% → Slack #crawler-alert
- 작업 평균 대기 시간 > 2분 → PagerDuty on-call

## 11. 데이터베이스

### 11.1 MongoDB 컬렉션 스키마 (articles)

```json
{
  "_id": "ObjectId",
  "keyword": "string",
  "title": "string",
  "body": "string",
  "url": "string",
  "source": "string",
  "language": "string",
  "publishedAt": "date",
  "fetchedAt": "date",
  "dedupeHash": "string",
  "entities": ["string"],
  "ingestedAt": { "$type": "date", "$default": "NOW" }
}
```

- 인덱스: `{ keyword: 1, fetchedAt: -1 }`, `{ dedupeHash: 1 } (unique)`

### 11.2 PostgreSQL 테이블 (crawler_jobs)

```sql
CREATE TABLE crawler_jobs (
  job_id UUID PRIMARY KEY,
  keywords TEXT[] NOT NULL,
  window VARCHAR(20) NOT NULL,
  source VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL,
  priority VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
  articles_fetched INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_crawler_jobs_status ON crawler_jobs(status);
```

- 트랜잭션 격리 수준: READ_COMMITTED (중복 업데이트 최소화)

## 12. 테스트 전략

- 단위 테스트: 크롤링 파서, 중복 해시 생성, 외부 API 어댑터 (커버리지 80% 이상)
- 통합 테스트: 크롤링 작업 end-to-end, MongoDB 적재 검증
- 성능 테스트: Locust 기반 50 동시 작업 시나리오
- 부하 테스트: 예상 TPS의 150% (7,500 기사/분) 검증

## 13. 배포 전략

- 방식: Blue-Green (작업자는 Rolling)
- 롤백 계획: 이전 버전 Docker 이미지 재배포로 즉시 롤백
- 헬스체크: GET /crawler/health (외부 API 연결 상태 포함)

## 14. 의존성 관리

| 라이브러리 | 버전 | 용도                 |
| ---------- | ---- | -------------------- |
| Scrapy     | 2.11 | 뉴스 수집 프레임워크 |
| Requests   | 2.32 | 외부 API 호출        |
| Celery     | 5.4  | 비동기 작업 처리     |
| pymongo    | 4.7  | MongoDB 연동         |
| SQLAlchemy | 2.0  | PostgreSQL ORM       |

## 15. 변경 이력

| 버전  | 날짜       | 변경 내용 | 작성자 |
| ----- | ---------- | --------- | ------ |
| 1.0.0 | 2025-10-29 | 초기 작성 | 관리자 |
