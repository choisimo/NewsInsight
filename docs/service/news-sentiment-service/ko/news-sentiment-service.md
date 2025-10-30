# 뉴스 감성 분석 서비스 개발 명세서

## 1. 기본 정보

- 기능 이름: 뉴스 감성 분석 서비스
- 버전: v1.0.0
- 작성일: 2025-10-29
- 최종 수정일: 2025-10-29

## 2. 서비스 개요

- **서비스 역할:**
  - 수집된 뉴스 기사에 대해 한국어 감성(긍정, 부정, 중립)을 분류하고 신뢰도 점수를 산출
  - 분석 결과를 정규화된 형태로 저장하여 대시보드 서비스에 제공
  - 사전 기반 모델과 머신러닝 모델을 단계적으로 운영하는 하이브리드 구조 지원
- **해결하고자 하는 비즈니스 문제:**
  - 기사별 감성 판단에 인력과 시간이 소요되는 문제를 자동화
  - 투자자, 마케터 등이 이슈에 대한 여론 흐름을 빠르게 파악하도록 지원
- **서비스 범위:**
  - 포함: 감성 분류 파이프라인, 모델 관리, 결과 저장, 분석 재처리 API, 품질 모니터링
  - 제외: 기사 수집, 키워드 추출, 프론트엔드 시각화, 대시보드 권한 관리

## 3. 기술 스택

- 프레임워크: FastAPI, Celery, MLflow
- 언어 버전: Python 3.11
- 데이터베이스: MongoDB 6.0 (분석 결과), PostgreSQL 15 (모델/실험 메타)
- 캐시: Redis 7.2 (결과 캐시 및 작업 큐)

## 4. API 명세

### 4.1 프로토콜

- 타입: REST API
- Base URL: https://api.newsinsight.com/v1
- 인증 방식: JWT (RS256, 서비스 간 mTLS)

### 4.2 엔드포인트 목록

#### 4.2.1 감성 분석 실행

- **Method:** POST
- **Path:** /sentiment/analyze
- **설명:** 기사 ID 목록에 대해 감성 분석을 수행하고 결과를 저장
- **Request**

```json
{
  "headers": {
    "Content-Type": "application/json",
    "Authorization": "Bearer {token}"
  },
  "body": {
    "articleIds": ["652f2c0b8f1c"],
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
    "queuedAt": "string (ISO 8601)",
    "articleCount": 120
  }
}
```

- **Response - 실패 (404 Not Found)**

```json
{
  "status": "error",
  "code": "ARTICLE_NOT_FOUND",
  "message": "One or more articleIds were not found",
  "details": ["652f2c0b8f1c"]
}
```

#### 4.2.2 감성 결과 조회

- **Method:** GET
- **Path:** /sentiment/results
- **설명:** 특정 키워드 및 기간에 대한 감성 결과 조회
- **Query Params:** `keyword`, `from`, `to`, `granularity` (`hour`, `day`)
- **Response - 성공 (200 OK)**

```json
{
  "status": "success",
  "data": [
    {
      "timestamp": "2025-10-28T10:00:00Z",
      "sentiments": {
        "positive": 45,
        "negative": 30,
        "neutral": 25
      },
      "confidence": 0.82
    }
  ]
}
```

#### 4.2.3 모델 상태 조회

- **Method:** GET
- **Path:** /sentiment/models/active
- **설명:** 현재 배포된 감성 모델 정보와 성능 지표 반환
- **Response - 성공 (200 OK)**

```json
{
  "status": "success",
  "data": {
    "modelVersion": "sentiment-ko-v3",
    "deployedAt": "2025-09-01T00:00:00Z",
    "metrics": {
      "accuracy": 0.81,
      "precision": 0.78,
      "recall": 0.76,
      "f1Score": 0.77
    }
  }
}
```

## 5. 데이터 모델

### 5.1 Request DTO

| 필드명         | 타입     | 필수 여부 | 제약 조건                 | 설명                        |
| -------------- | -------- | --------- | ------------------------- | --------------------------- |
| articleIds     | String[] | Required  | 최대 500개, ObjectId 형식 | 감성 분석 대상 기사 ID 목록 |
| forceReprocess | Boolean  | Optional  | default false             | 기존 결과 무시 여부         |

### 5.2 Response DTO

| 필드명       | 타입      | Nullable | 설명                                    |
| ------------ | --------- | -------- | --------------------------------------- |
| articleId    | String    | No       | 분석 대상 기사 ID                       |
| sentiment    | String    | No       | `positive`, `negative`, `neutral` |
| confidence   | Float     | No       | 0-1 사이 확률                           |
| analyzedAt   | Timestamp | No       | 분석 완료 시각                          |
| modelVersion | String    | No       | 사용된 모델 버전                        |

## 6. 연동 서비스

### 6.1 메시지 브로커 (Kafka)

- Topic: articles.fetched (Consumer), sentiment.completed (Producer)
- Event Type: SENTIMENT_COMPLETED
- Message Format:

```json
{
  "eventId": "string (UUID)",
  "eventType": "SENTIMENT_COMPLETED",
  "timestamp": "ISO 8601",
  "payload": {
    "articleId": "string",
    "sentiment": "positive",
    "confidence": 0.88,
    "modelVersion": "sentiment-ko-v3"
  }
}
```

### 6.2 실시간 통신 (SSE)

- 프로토콜: Server-Sent Events
- Endpoint: /sentiment/stream
- Event Types: sentiment.updated, sentiment.alert

### 6.3 외부 API 호출

- 서비스명: 감성 사전 관리 서비스 (내부)
- Type: REST API
- Endpoint: GET /lexicon/{language}
- Timeout: 2초
- Retry 정책: 3회, 지수 백오프

## 7. 에러 코드 정의

| 에러 코드         | HTTP Status | 설명               | 처리 방법             |
| ----------------- | ----------- | ------------------ | --------------------- |
| ARTICLE_NOT_FOUND | 404         | 기사 ID 미존재     | 크롤링 서비스 재확인  |
| MODEL_UNAVAILABLE | 503         | 활성 모델 없음     | 모델 재배포 또는 롤백 |
| ANALYSIS_TIMEOUT  | 504         | 분석 작업 지연     | Celery 작업 재시도    |
| INVALID_INPUT     | 400         | 요청 파라미터 오류 | DTO 검증 강화         |
| INTERNAL_ERROR    | 500         | 서버 내부 오류     | 로그 분석 및 알림     |

## 8. 성능 요구사항

- 응답 시간: P50 < 180ms, P95 < 450ms, P99 < 900ms (동기 조회 API)
- 처리량: 분당 3,000 기사 분석
- 동시 작업: 30개 Celery 워커
- 배치 SLA: 1,000 기사/배치 90초 이내

## 9. 보안 요구사항

- 인증/인가: 서비스 계층 JWT + 역할 기반 접근 제어 (RBAC)
- 데이터 암호화: TLS 1.3 전송, 민감 키워드 해시 처리
- Rate Limiting: 120 req/min per service token
- 입력 검증: articleIds 포맷, forceReprocess boolean 검증
- 모델 아티팩트는 S3 + KMS로 암호화 저장

## 10. 모니터링 & 로깅

### 10.1 로깅

- 로그 레벨: INFO, WARN, ERROR
- 필수 포함 정보: requestId, articleId, modelVersion, latency, confidence, errorCode

### 10.2 메트릭

- 모델 정확도 추이
- 분석 지연 시간
- 재처리율
- 감성 분포 불균형 지표

### 10.3 알림

- 모델 정확도 < 0.75 → Slack #ml-alert
- 분석 대기열 > 5분 → PagerDuty on-call

## 11. 데이터베이스

### 11.1 MongoDB 컬렉션 (sentiment_results)

```json
{
  "_id": "ObjectId",
  "articleId": "ObjectId",
  "keyword": "string",
  "sentiment": "string",
  "confidence": "double",
  "modelVersion": "string",
  "analyzedAt": "date",
  "expiresAt": "date"
}
```

- 인덱스: `{ articleId: 1 } (unique)`, `{ keyword: 1, analyzedAt: -1 }`

### 11.2 PostgreSQL 테이블 (sentiment_models)

```sql
CREATE TABLE sentiment_models (
  model_version VARCHAR(50) PRIMARY KEY,
  artifact_uri TEXT NOT NULL,
  accuracy NUMERIC(5, 4),
  precision NUMERIC(5, 4),
  recall NUMERIC(5, 4),
  f1_score NUMERIC(5, 4),
  deployed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

- 트랜잭션 격리 수준: READ_COMMITTED (모델 메타 업데이트 충돌 방지)

## 12. 테스트 전략

- 단위 테스트: 텍스트 전처리, 모델 inference wrapper, DTO 검증 (커버리지 85%)
- 통합 테스트: 기사→분석→저장 end-to-end, 에러 처리 플로우
- 성능 테스트: Locust 기반 30 동시 분석 작업
- 부하 테스트: 목표 TPS 150% (4,500 기사/분)

## 13. 배포 전략

- 방식: Canary (10% → 50% → 100%)
- 롤백 계획: 이전 모델 버전 즉시 활성화
- 헬스체크: GET /sentiment/health (모델 로딩 상태 포함)

## 14. 의존성 관리

| 라이브러리   | 버전  | 용도                    |
| ------------ | ----- | ----------------------- |
| FastAPI      | 0.111 | REST API 서버           |
| Transformers | 4.45  | 사전학습 모델 서빙      |
| scikit-learn | 1.5   | 전처리 및 휴리스틱 모델 |
| konlpy       | 0.6.0 | 한국어 형태소 분석      |
| mlflow       | 2.16  | 모델 버전 관리          |

## 15. 변경 이력

| 버전  | 날짜       | 변경 내용 | 작성자 |
| ----- | ---------- | --------- | ------ |
| 1.0.0 | 2025-10-29 | 초기 작성 | 관리자 |
