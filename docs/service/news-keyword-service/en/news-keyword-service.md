# News Keyword Extraction Service Specification

## 1. Basics
- **Function**: News Keyword Extraction Service
- **Version**: v1.0.0
- **Created**: 2025-10-29
- **Last Updated**: 2025-10-29

## 2. Service Overview
- **Role**
  - Extract core keywords and importance scores from collected news articles.
  - Deliver normalized data for word clouds and relationship analysis.
  - Aggregate results by period and keyword to feed dashboards and external reports.
- **Business Problems Solved**
  - Reduces time spent manually identifying key issues from massive article volume.
  - Gives users intuitive keyword insights for faster decision making.
- **Scope**
  - Includes: text preprocessing, TF-IDF/RAKE extraction, synonym merging, result storage & query APIs.
  - Excludes: article collection, sentiment analysis, frontend rendering, advanced topic modeling (e.g., LDA).

## 3. Technology Stack
- Framework: FastAPI, Celery
- Language: Python 3.11
- Databases: MongoDB 6.0 (results), PostgreSQL 15 (thesaurus)
- Cache: Redis 7.2 (result cache, distributed locks)

## 4. API Specification
### 4.1 Protocol
- Type: REST API
- Base URL: `https://api.newsinsight.com/v1`
- Authentication: JWT (RS256)

### 4.2 Endpoints
#### 4.2.1 Trigger Keyword Extraction
- **Method:** POST
- **Path:** `/keywords/extract`
- **Description:** Create extraction job for a list of article IDs.
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
- **Response – 202 Accepted**
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
- **Response – 400 Bad Request**
  ```json
  {
    "status": "error",
    "code": "INVALID_WINDOW",
    "message": "Unsupported extraction window",
    "details": []
  }
  ```

#### 4.2.2 Query Keyword Results
- **Method:** GET
- **Path:** `/keywords/results`
- **Description:** Return top keywords and scores for a topic/period.
- **Query Params:** `topic`, `from`, `to`, `limit` (default 20)
- **Response – 200 OK**
  ```json
  {
    "status": "success",
    "data": [
      {
        "keyword": "semiconductor",
        "score": 0.87,
        "trend": {
          "delta": 0.12,
          "direction": "up"
        }
      }
    ]
  }
  ```

#### 4.2.3 Manage Keyword Thesaurus
- **Method:** PUT
- **Path:** `/keywords/thesaurus`
- **Description:** Maintain synonym mappings (admin only).
- **Request**
  ```json
  {
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer {token}"
    },
    "body": {
      "canonical": "artificial intelligence",
      "synonyms": ["AI", "machine learning"]
    }
  }
  ```

## 5. Data Models
### 5.1 Request DTO
| Field | Type | Required | Constraints | Description |
| --- | --- | --- | --- | --- |
| articleIds | `String[]` | Yes | up to 500, ObjectId format | Target articles |
| window | `String` | No | `last_6h`, `last_24h`, `last_7d` | Analysis window |
| forceReprocess | `Boolean` | No | default `false` | Ignore cached results |

### 5.2 Response DTO
| Field | Type | Nullable | Description |
| --- | --- | --- | --- |
| keyword | `String` | No | Extracted keyword |
| score | `Number` | No | Importance score |
| trend.delta | `Number` | No | Change amount |
| trend.direction | `String` | No | `up`, `down`, `flat` |

## 6. Thesaurus Storage
- MongoDB collection `keyword_thesaurus`
- Fields: `_id`, `canonical`, `synonyms[]`, `createdAt`, `updatedAt`
- Index: `{ canonical: 1 }`, `{ synonyms: 1 }`

## 7. Error Codes
| Code | HTTP Status | Description | Mitigation |
| --- | --- | --- | --- |
| INVALID_WINDOW | 400 | Unsupported time window | Validate allowed presets |
| DUPLICATE_REQUEST | 409 | Similar job in progress | Monitor existing job |
| AUTH_FAILED | 401 | Invalid token | Refresh credentials |
| RATE_LIMITED | 429 | Exceeded quota | Backoff |

## 8. Performance Targets
- Extraction latency: P95 ≤ 2 minutes for 200 articles.
- Result query latency: P95 ≤ 150 ms (cached).
- Throughput: 10 concurrent extraction jobs.

## 9. Monitoring & Alerting
- Metrics: job success rate, average extraction duration, cache hit ratio.
- Alerts: failure rate > 10% → Slack `#keyword-alert`.

## 10. Change Log
| Version | Date | Change | Author |
| --- | --- | --- | --- |
| 1.0.0 | 2025-10-29 | Initial draft | Su-bin Yang |
