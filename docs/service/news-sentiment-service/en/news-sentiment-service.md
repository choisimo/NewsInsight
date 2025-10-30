# News Sentiment Analysis Service Specification

## 1. Basics
- **Function Name:** News Sentiment Analysis Service
- **Version:** v1.0.0
- **Created:** 2025-10-29
- **Last Updated:** 2025-10-29

## 2. Service Overview
- **Role**
  - Classify collected news articles into positive, negative, and neutral labels and produce confidence scores.
  - Persist normalized results for dashboards and reporting.
  - Operate a hybrid pipeline combining lexicon-based and machine learning models.
- **Business Problems Solved**
  - Automates manual sentiment tagging work.
  - Enables analysts and marketers to detect public perception shifts quickly.
- **Scope**
  - Includes: sentiment pipeline, model management, result storage, reprocessing API, quality monitoring.
  - Excludes: article collection, keyword extraction, frontend visualization, dashboard permissions.

## 3. Technology Stack
- Frameworks: FastAPI (API), Celery (async jobs)
- Models: KcBERT (supervised), SO-PMI lexicon (baseline)
- Language: Python 3.11
- Databases: MongoDB 6.0 (`sentiment_results`), PostgreSQL 15 (`model_registry`)
- Cache: Redis 7.2 (inference cache, distributed locks)

## 4. API Specification
### 4.1 Protocol
- Type: REST API
- Base URL: `https://api.newsinsight.com/v1`
- Auth: JWT (RS256)

### 4.2 Endpoints
#### 4.2.1 Submit Sentiment Jobs
- **Method:** POST
- **Path:** `/sentiment/jobs`
- **Description:** Enqueue articles for sentiment scoring.
- **Request**
  ```json
  {
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer {token}"
    },
    "body": {
      "articleIds": ["652f2c0b8f1c"],
      "priority": "NORMAL",
      "force": false
    }
  }
  ```
- **Response – 202 Accepted**
  ```json
  {
    "status": "accepted",
    "data": {
      "jobId": "string (UUID)",
      "articleCount": 150,
      "queuedAt": "string (ISO 8601)"
    }
  }
  ```

#### 4.2.2 Fetch Sentiment Results
- **Method:** GET
- **Path:** `/sentiment/results`
- **Description:** Retrieve sentiment summaries for a keyword or article list.
- **Query Params:** `keyword`, `articleIds[]`, `from`, `to`, `aggregate`
- **Response – 200 OK**
  ```json
  {
    "status": "success",
    "data": {
      "summary": {
        "positive": 420,
        "negative": 310,
        "neutral": 270
      },
      "confidence": 0.82,
      "details": [
        {
          "articleId": "string",
          "label": "positive",
          "score": 0.91,
          "model": "kbert-v2",
          "classifiedAt": "string (ISO 8601)"
        }
      ]
    }
  }
  ```

#### 4.2.3 Reprocess Articles
- **Method:** POST
- **Path:** `/sentiment/reprocess`
- **Description:** Force re-evaluation of stored articles (e.g., after model update).
- **Request**
  ```json
  {
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer {token}"
    },
    "body": {
      "articleIds": ["string"],
      "modelVersion": "kbert-v2"
    }
  }
  ```

## 5. Data Models
### 5.1 Request DTO (Jobs)
| Field | Type | Required | Constraints | Description |
| --- | --- | --- | --- | --- |
| articleIds | `String[]` | Yes | up to 1,000, ObjectId format | Articles to score |
| priority | `String` | No | `LOW`, `NORMAL`, `HIGH` | Queue priority |
| force | `Boolean` | No | default `false` | Ignore cached inferences |

### 5.2 Result DTO
| Field | Type | Nullable | Description |
| --- | --- | --- | --- |
| articleId | `String` | No | MongoDB `_id` |
| label | `String` | No | `positive`, `negative`, `neutral` |
| score | `Number` | No | Confidence (0-1) |
| model | `String` | No | Model identifier |
| classifiedAt | `Timestamp` | No | Completion time |

## 6. Model Management
- PostgreSQL `sentiment_models` table tracks version, status, accuracy metrics.
- Workflow supports AB testing and gradual rollout of new models.

## 7. Monitoring
- Metrics: job success rate, average inference latency, model drift.
- Alerts: failure rate > 5% or latency P95 > 1.5s → on-call notification.
- Logs: include `requestId`, `jobId`, `modelVersion`, `latency`, `fallbackUsed`.

## 8. Performance Targets
- Batch throughput: 2,000 articles/minute (Celery workers with GPU optional).
- Online query latency: P95 < 500 ms for aggregated results.

## 9. Security
- Auth via JWT + IP allowlist.
- TLS 1.3 enforced; sensitive data (e.g., model secrets) stored in AWS Secrets Manager.
- Input sanitization for keywords/article IDs.

## 10. Change Log
| Version | Date | Change | Author |
| --- | --- | --- | --- |
| 1.0.0 | 2025-10-29 | Initial draft | Su-bin Yang |
