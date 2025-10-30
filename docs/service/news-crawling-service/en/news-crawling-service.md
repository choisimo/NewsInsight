# News Crawling Service Specification

## 1. Overview
- **Function Name:** News Crawling Service
- **Version:** v1.0.0
- **Created:** 2025-10-29
- **Last Updated:** 2025-10-29

## 2. Service Summary
- **Role:**
  - Collects and normalizes the latest news articles based on submitted keywords, then hands structured data to the analytics pipeline.
  - Manages metadata for each article, including deduplication fingerprint and error status.
  - Supports both scheduled batch jobs and on-demand requests to keep downstream analytics data fresh.
- **Business Problems Addressed:**
  - Eliminates manual, error-prone article sourcing.
  - Provides reliable, near-real-time data feeds for sentiment and insight dashboards.
- **In Scope:** Keyword-driven article fetch, normalization, deduplication, result storage, monitoring APIs.
- **Out of Scope:** Sentiment analysis, keyword ranking, UI delivery, paid API billing management.

## 3. Technology Stack
- Frameworks: Scrapy, Flask (admin API), Celery
- Language: Python 3.11
- Datastores: MongoDB 6.0 (articles), PostgreSQL 15 (job metadata)
- Cache/Queue: Redis 7.2 (task queue, dedupe cache)

## 4. API Specification
### 4.1 Protocol
- Type: REST
- Base URL: `https://api.newsinsight.com/v1`
- Auth: Internal service token (JWT, HS256)

### 4.2 Endpoints
#### 4.2.1 Create Crawl Job
- **Method:** POST
- **Path:** `/crawler/jobs`
- **Description:** Enqueue a keyword-based crawl job and trigger immediate execution.
- **Request**
  ```json
  {
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer {token}"
    },
    "body": {
      "keywords": ["Samsung", "AI"],
      "window": "last_24h",
      "source": "NAVER_NEWS",
      "priority": "HIGH"
    }
  }
  ```
- **Response – 202 Accepted**
  ```json
  {
    "status": "success",
    "data": {
      "jobId": "string (UUID)",
      "keywords": ["Samsung", "AI"],
      "queuedAt": "string (ISO 8601)",
      "expectedCompletion": "string (ISO 8601)"
    }
  }
  ```
- **Response – 409 Conflict**
  ```json
  {
    "status": "error",
    "code": "DUPLICATE_JOB",
    "message": "A job with identical parameters is already running",
    "details": []
  }
  ```

#### 4.2.2 List Collected Articles
- **Method:** GET
- **Path:** `/crawler/articles`
- **Description:** Return recently collected articles.
- **Query Params:**
  - `keyword` (required)
  - `limit` (optional, default 50, max 200)
  - `since` (optional, ISO 8601)
- **Response – 200 OK**
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

#### 4.2.3 Crawl Job Status
- **Method:** GET
- **Path:** `/crawler/jobs/{jobId}`
- **Description:** Retrieve status and errors for a crawl job.
- **Response – 200 OK**
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

## 5. Data Model
### 5.1 Request DTO
| Field | Type | Required | Constraints | Description |
| --- | --- | --- | --- | --- |
| keywords | `String[]` | Yes | 1-5 entries, each 2-30 chars | Keywords to crawl |
| window | `String` | No | `last_3h`, `last_24h`, `last_7d` | Crawl time preset |
| source | `String` | Yes | `NAVER_NEWS`, `DAUM_NEWS` | Source identifier |
| priority | `String` | No | `LOW`, `NORMAL`, `HIGH` | Queue priority |

### 5.2 Response DTO
| Field | Type | Nullable | Description |
| --- | --- | --- | --- |
| articleId | `String (ObjectId)` | No | MongoDB document ID |
| title | `String` | No | Article headline |
| url | `String` | No | Article URL |
| source | `String` | No | Data source |
| publishedAt | `Timestamp` | Yes | Publication time |
| fetchedAt | `Timestamp` | No | Crawl completion time |
| dedupeHash | `String` | No | Deduplication hash |

## 6. Integrations
### 6.1 Kafka
- Topic: `articles.fetched`
- Event Type: `ARTICLE_FETCHED`
- Role: Producer
- Payload:
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

### 6.2 WebSocket (Console)
- Protocol: WebSocket
- Endpoint: `/ws/crawler/stream`
- Events: `job.updated`, `job.failed`

### 6.3 External API Calls
- Provider: Naver News API
- Type: REST
- Endpoint: `GET /news`
- Timeout: 3s
- Retry: up to 5 attempts, exponential backoff (max 30s)

## 7. Error Codes
| Code | HTTP Status | Description | Handling |
| --- | --- | --- | --- |
| DUPLICATE_JOB | 409 | Identical job already running | Monitor existing job |
| INVALID_SOURCE | 400 | Unsupported source | Check supported list |
| FETCH_TIMEOUT | 504 | External API timeout | Retry + alert |
| RATE_LIMITED | 429 | Provider rate limit hit | Backoff and switch source |
| INTERNAL_ERROR | 500 | Internal server error | Analyze logs, redeploy |

## 8. Performance Targets
- Response: P50 < 150 ms, P95 < 400 ms, P99 < 800 ms (management API)
- Throughput: 5,000 articles per minute
- Concurrent jobs: up to 50
- SLA: `last_24h` jobs complete within 5 minutes

## 9. Security
- Auth: Internal JWT + IP allowlist
- Encryption: TLS 1.3 in transit, optional AES-256 at rest
- Rate Limit: 60 req/min per client (management API)
- Input Validation: Keyword sanitization, URL validation
- Secrets Management: AWS Secrets Manager

## 10. Monitoring & Logging
### 10.1 Logging
- Levels: INFO, WARN, ERROR
- Required fields: `requestId`, `jobId`, `keyword`, `source`, `timestamp`, `latency`, `retryCount`

### 10.2 Metrics
- Crawl success rate
- External API failure rate
- Job queue latency
- Article dedupe ratio

### 10.3 Alerts
- External API failure > 10% → Slack `#crawler-alert`
- Average queue wait > 2 min → PagerDuty on-call

## 11. Databases
### 11.1 MongoDB `articles`
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
- Indexes: `{ keyword: 1, fetchedAt: -1 }`, `{ dedupeHash: 1 } (unique)`

### 11.2 PostgreSQL `crawler_jobs`
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
- Isolation Level: READ COMMITTED

## 12. Testing Strategy
- Unit: crawler parsers, dedupe hash, external adapters (≥80% coverage)
- Integration: end-to-end crawl pipeline, MongoDB persistence
- Performance: Locust with 50 concurrent job scenarios
- Load: 150% of expected TPS (7,500 articles/min)

## 13. Deployment Strategy
- Blue-green for API; rolling for workers
- Rollback: redeploy previous Docker image
- Health check: `GET /crawler/health` (includes external dependency check)

## 14. Dependencies
| Library | Version | Purpose |
| --- | --- | --- |
| Scrapy | 2.11 | Crawling framework |
| Requests | 2.32 | External API client |
| Celery | 5.4 | Async task processing |
| pymongo | 4.7 | MongoDB client |
| SQLAlchemy | 2.0 | PostgreSQL ORM |

## 15. Change Log
| Version | Date | Description | Author |
| --- | --- | --- | --- |
| 1.0.0 | 2025-10-29 | Initial draft | Su-bin Yang |
