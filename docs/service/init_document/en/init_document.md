# Idea Details (News Insight)

## Basic Information

| Item                         | Content                                             |
| ---------------------------- | --------------------------------------------------- |
| **Project**            | News Insight: Real-time opinion analytics dashboard |
| **Submission Date**    | 28 Sep 2025                                         |
| **Estimated Duration** | 3 months (12 weeks)                                 |

---

## 1. Project Overview

### 1.1 Elevator Pitch

Leverage news crawling and NLP to visualize sentiment and key issues for specific keywords (companies, people, topics) in real time.

### 1.2 Problem & Solution

- Problem: Hard to extract actionable insight from overwhelming news volume.
- Solution: Automated collection, processing, and visualization that highlights trend shifts in minutes.

### 1.3 Target Users & Value Proposition

- **Target**: Corporate comms/marketing, analysts, public sector PR.
- **Value**: Consolidated dashboard fed by automated crawling, with sentiment snapshot and keyword ranking.

### 1.4 Success Metrics

| Metric                | Target             |
| --------------------- | ------------------ |
| Daily active analysts | 30+                |
| Avg. time-to-insight  | < 10 min           |
| Keyword coverage      | 200+ active        |
| Sentiment accuracy    | ≥ 80% (pilot set) |

---

## 2. Market & Competitor Scan

- Existing tools (Meltwater, Sprinklr) are expensive, lack Korean sentiment depth, and offer limited customization.
- Opportunity: Lightweight SaaS with localized pipelines priced for SMEs.

---

## 3. Use Cases

1. **Brand monitoring** – track spikes in negative sentiment for corporations.
2. **Campaign measurement** – evaluate earned media impact and trending keywords post-launch.
3. **Policy watch** – monitor public opinion for government agencies on pending legislation.

---

## 4. Feature Scope

### 4.1 Must Have (MVP)

- Keyword-based news crawler (priority: official APIs → compliant fallback crawling).
- Sentiment analysis (lexicon-based first, expand with simple supervised model if needed).
- Keyword extraction (TF-IDF) with visualization.
- Dashboard: search, article list, sentiment ratio, keyword cloud.
- Caching for hot keywords; graceful degradation for API issues.

### 4.2 Nice to Have

- Alerting (Slack/Email) when sentiment crosses threshold.
- Multi-user workspace & saved keyword sets.
- Analyst annotations.

---

## 5. Technology Stack (Recommended)

| Layer    | Tech                                             |
| -------- | ------------------------------------------------ |
| Frontend | React, Chart.js                                  |
| Backend  | Python Flask, Celery                             |
| Storage  | MongoDB (news), PostgreSQL (jobs), Redis (cache) |
| Infra    | Docker, Nginx, AWS EC2/S3                        |

---

## 6. Revenue Model (Future)

- **Subscription SaaS** for enterprises (monthly fee per workspace).
- **Managed reports** (premium concierge service).
- **API access** for partners needing aggregated analytics.

---

## 7. Feasibility Assessment

- Clear technical challenge but achievable with OSS and cloud services.
- Covers full stack (frontend, backend, data/NLP) → strong portfolio piece.

---

## 8. Comparative Evaluation

| Criterion      | Score (1-10) | Notes                            |
| -------------- | ------------ | -------------------------------- |
| Overall appeal | 8            | Practical with solid challenge   |
| Team fit       | TBD          | Need alignment                   |
| Deliverability | 7            | Achievable in 3 months; NLP risk |

---

## 9. Execution Plan (12 Weeks)

| Phase           | Weeks | Key Tasks                                       |
| --------------- | ----- | ----------------------------------------------- |
| Planning        | W1-W2 | Wireframes, finalize API/schema, Docker dev env |
| Data Collection | W3-W4 | Crawler, dedupe, normalization, logging         |
| Analysis        | W5-W7 | Tokenization, sentiment MVP, TF-IDF, caching    |
| Frontend        | W8-W9 | Search, charts, word cloud, loading/error UX    |
| Integration     | W10   | End-to-end tuning (≤10s response)              |
| Deployment      | W11   | EC2 deploy, HTTPS, cron jobs, monitoring        |
| Stabilization   | W12   | Bug fixes, docs, presentation                   |

---

## 10. Architecture Proposal

```
User → React SPA → Flask API → MongoDB
                  ↘ Analyzer jobs (Celery)
                  ↘ Crawler (cron)
```

- Redis for queue/cache, optional S3 for archives.

---

## 11. Data Models (Draft)

### 11.1 MongoDB `articles`

- `_id`, `url`, `title`, `body`, `source`, `published_at`, `fetched_at`, `language`, `dedupe_hash`, `entities?`, `keywords_extracted[]`.

### 11.2 MongoDB `analyses`

- `_id`, `query`, `time_window`, `sentiments{pos,neg,neu}`, `top_keywords[{word,score}]`, `article_count`, `created_at`.

### 11.3 Optional `jobs`

- `_id`, `type` (crawl), `status`, `started_at`, `ended_at`, `error`.

---

## 12. API Sketch (v1)

- `GET /api/v1/analysis?query=Samsung&window=7d`
- `GET /api/v1/articles?query=Samsung&limit=50`
- `POST /api/v1/refresh`
- `GET /healthz`

---

## 13. Deliverables

- **Docs**: API spec, schema, ops guide, test report.
- **Code**: frontend, backend, infra (Docker, Nginx).
- **Demo**: Hosted URL + sample scenario.

---

## 14. QA Strategy

- **Unit**: crawler parser, text preprocessing, sentiment/keyword logic.
- **Integration**: API schema & performance, caching behavior.
- **Frontend**: key components, chart bindings.
- **Performance Targets**: hot keyword within 3s; cold keyword first run ≤10s.

---

## 15. Deployment & Operations

- Docker multi-container (Nginx, Flask, Mongo).
- HTTPS with Let’s Encrypt; secrets via environment or parameter store.
- Cron for crawler refresh, CloudWatch or Grafana for metrics.

---

## 16. Risks & Mitigations

| Risk               | Mitigation                                           |
| ------------------ | ---------------------------------------------------- |
| Crawl blocking     | Prefer official APIs, rate limiting, cache responses |
| Sentiment accuracy | Start with lexicon, iterate with ML                  |
| Latency            | Async jobs, caching, pagination                      |

---

## 17. Acceptance Criteria

- Keyword search returns sentiment + word cloud within 10s.
- Results are reproducible across refreshes.
- 3+ real keyword demos run smoothly (error rate < 2%).

---

## 18. Resource Plan

- Solo developer assumption: 15-20 hrs/week.
- Time split: Backend/Data 50%, Frontend 30%, Infra/Ops 20%.
- Rebalance per sprint as needed.
