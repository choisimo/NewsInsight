# 뉴스 키워드 추출 서비스 개발 명세서

## 1. 기본 정보

- 기능 이름: 뉴스 키워드 추출 서비스
- 버전: v1.0.0
- 작성일: 2025-10-29
- 최종 수정일: 2025-10-29

## 2. 서비스 개요

- **서비스 역할:**
  - 수집된 뉴스 본문에서 핵심 키워드를 추출하고 중요도 점수를 산출
  - 키워드 워드클라우드 및 연관도 분석을 위한 정규화된 데이터를 제공
  - 기간별/키워드별 집계를 담당하여 대시보드와 외부 리포팅에 활용
- **해결하고자 하는 비즈니스 문제:**
  - 방대한 기사 데이터에서 핵심 이슈를 빠르게 도출하기 어려운 문제 해소
  - 사용자에게 주제별 핵심 키워드를 직관적으로 전달해 의사결정 속도 향상
- **서비스 범위:**
  - 포함: 텍스트 전처리, TF-IDF/RAKE 기반 키워드 추출, 동의어 병합, 결과 저장 및 조회 API
  - 제외: 기사 수집, 감성 분석, 프론트엔드 렌더링, 복잡한 토픽 모델링 (LDA 등)

## 3. 기술 스택

- 프레임워크: FastAPI, Celery
- 언어 버전: Python 3.11
- 데이터베이스: MongoDB 6.0 (키워드 결과 저장), PostgreSQL 15 (사전/시소러스 관리)
- 캐시: Redis 7.2 (결과 캐싱, 분산 락)

## 4. API 명세

### 4.1 프로토콜

- 타입: REST API
- Base URL: https://api.newsinsight.com/v1
- 인증 방식: JWT (RS256)

### 4.2 엔드포인트 목록

#### 4.2.1 키워드 추출 실행

- **Method:** POST
- **Path:** /keywords/extract
- **설명:** 기사 ID 목록에 대해 키워드 추출 작업 생성
- **Request**

```json
{
  "headers": {
    "Content-Type": "application/json",
    "Authorization": "Bearer {token}"
  },
  "body": {
    "articleIds": ["652f2c0b8f1c"],
    "window": "last_24h",
    "forceReprocess": false
  }
}
```

- **Response - 성공 (202 Accepted)**

```json
{
  "status": "success",
  "data": {
    "jobId": "string (UUID)",
    "articleCount": 200,
    "queuedAt": "string (ISO 8601)"
  }
}
```

- **Response - 실패 (400 Bad Request)**

```json
{
  "status": "error",
  "code": "INVALID_WINDOW",
  "message": "Unsupported extraction window",
  "details": []
}
```

#### 4.2.2 키워드 결과 조회

- **Method:** GET
- **Path:** /keywords/results
- **설명:** 특정 키워드/기간에 대한 상위 키워드와 점수 목록 반환
- **Query Params:** `topic`, `from`, `to`, `limit` (default 20)
- **Response - 성공 (200 OK)**

```json
{
  "status": "success",
  "data": [
    {
      "keyword": "반도체",
      "score": 0.87,
      "trend": {
        "delta": 0.12,
        "direction": "up"
      }
    }
  ]
}
```

#### 4.2.3 키워드 사전 관리

- **Method:** PUT
- **Path:** /keywords/thesaurus
- **설명:** 동의어/유사어 매핑을 관리 (운영자용)
- **Request**

```json
{
  "headers": {
    "Content-Type": "application/json",
    "Authorization": "Bearer {token}"
  },
  "body": {
    "canonical": "인공지능",
    "synonyms": ["AI", "머신러닝"]
  }
}
```

## 5. 데이터 모델

### 5.1 Request DTO

| 필드명         | 타입     | 필수 여부 | 제약 조건                              | 설명                       |
| -------------- | -------- | --------- | -------------------------------------- | -------------------------- |
| articleIds     | String[] | Required  | 최대 500개, ObjectId 형식              | 키워드 추출 대상 기사 목록 |
| window         | String   | Optional  | `last_6h`, `last_24h`, `last_7d` | 분석 기간 프리셋           |
| forceReprocess | Boolean  | Optional  | default false                          | 기존 결과 무시 여부        |

### 5.2 Response DTO

| 필드명          | 타입   | Nullable | 설명                       |
| --------------- | ------ | -------- | -------------------------- |
| keyword         | String | No       | 추출된 키워드              |
| score           | Float  | No       | 가중치 (0-1 정규화)        |
| trend.delta     | Float  | Yes      | 이전 기간 대비 변화율      |
| trend.direction | String | Yes      | `up`, `down`, `flat` |

## 6. 연동 서비스

### 6.1 메시지 브로커 (Kafka)

- Topic: sentiment.completed (Consumer), keywords.ready (Producer)
- Event Type: KEYWORDS_READY
- Message Format:

```json
{
  "eventId": "string (UUID)",
  "eventType": "KEYWORDS_READY",
  "timestamp": "ISO 8601",
  "payload": {
    "topic": "삼성전자",
    "window": "last_24h",
    "topKeywords": [
      { "keyword": "반도체", "score": 0.87 }
    ]
  }
}
```

### 6.2 실시간 통신 (SSE)

- 프로토콜: Server-Sent Events
- Endpoint: /keywords/stream
- Event Types: keywords.updated, keywords.alert

### 6.3 외부 API 호출

- 서비스명: 형태소 분석 서비스 (내부)
- Type: gRPC
- Endpoint: Analyzer.AnalyzeText
- Timeout: 1.5초
- Retry 정책: 3회, 지수 백오프

## 7. 에러 코드 정의

| 에러 코드          | HTTP Status | 설명                    | 처리 방법           |
| ------------------ | ----------- | ----------------------- | ------------------- |
| ARTICLE_NOT_FOUND  | 404         | 기사 ID 미존재          | 크롤링 서비스 확인  |
| INVALID_WINDOW     | 400         | 지원하지 않는 기간 요청 | 허용 범위 안내      |
| ANALYSIS_FAILED    | 500         | 키워드 추출 실패        | 재시도 및 로그 분석 |
| THESAURUS_CONFLICT | 409         | 동의어 충돌             | 매핑 리뷰 후 재요청 |
| RATE_LIMITED       | 429         | 과도한 요청             | 백오프 적용         |

## 8. 성능 요구사항

- 응답 시간: P50 < 160ms, P95 < 420ms, P99 < 850ms (조회 API)
- 처리량: 분당 2,500 기사 키워드 추출
- 동시 작업: 25개 Celery 워커
- 배치 SLA: 1,000 기사/배치 80초 이내

## 9. 보안 요구사항

- 인증/인가: JWT + 서비스 역할 기반 권한
- 데이터 암호화: TLS 1.3 전송, 사전 데이터는 KMS 암호화 저장
- Rate Limiting: 100 req/min per service token
- 입력 검증: articleIds, window 값 유효성 검사
- 운영자 API는 IP allowlist 적용

## 10. 모니터링 & 로깅

### 10.1 로깅

- 로그 레벨: INFO, WARN, ERROR
- 필수 포함 정보: requestId, topic, window, latency, workerId, errorCode

### 10.2 메트릭

- 키워드 추출 성공률
- 평균 추출 시간
- 동의어 적용률
- 트렌드 변동성 지표

### 10.3 알림

- 추출 성공률 < 90% → Slack #analysis-alert
- 평균 추출 시간 > 2초 → PagerDuty on-call

## 11. 데이터베이스

### 11.1 MongoDB 컬렉션 (keyword_results)

```json
{
  "_id": "ObjectId",
  "topic": "string",
  "window": "string",
  "keywords": [
    {
      "keyword": "string",
      "score": "double",
      "trend": {
        "delta": "double",
        "direction": "string"
      }
    }
  ],
  "generatedAt": "date",
  "expiresAt": "date"
}
```

- 인덱스: `{ topic: 1, window: 1, generatedAt: -1 }`

### 11.2 PostgreSQL 테이블 (keyword_thesaurus)

```sql
CREATE TABLE keyword_thesaurus (
  canonical VARCHAR(100) PRIMARY KEY,
  synonyms TEXT[] NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

- 트랜잭션 격리 수준: READ_COMMITTED

## 12. 테스트 전략

- 단위 테스트: 형태소 분석 파이프, TF-IDF 계산, 동의어 병합 (커버리지 80%)
- 통합 테스트: 기사→키워드 추출→저장→알림 end-to-end
- 성능 테스트: Locust 기반 동시 25 워커 시나리오
- 부하 테스트: 목표 TPS 150% (3,750 기사/분)

## 13. 배포 전략

- 방식: Blue-Green
- 롤백 계획: 이전 Docker 이미지 및 동의어 스냅샷 복원
- 헬스체크: GET /keywords/health (형태소 분석 서비스 연결 포함)

## 14. 의존성 관리

| 라이브러리   | 버전  | 용도                      |
| ------------ | ----- | ------------------------- |
| FastAPI      | 0.111 | REST API 서버             |
| scikit-learn | 1.5   | TF-IDF 계산               |
| nltk         | 3.9   | Stopword 처리             |
| konlpy       | 0.6.0 | 한국어 형태소 분석        |
| networkx     | 3.3   | RAKE 알고리즘 그래프 처리 |

## 15. 변경 이력

| 버전  | 날짜       | 변경 내용 | 작성자 |
| ----- | ---------- | --------- | ------ |
| 1.0.0 | 2025-10-29 | 초기 작성 | 관리자 |
