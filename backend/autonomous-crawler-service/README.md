# Autonomous Crawler Service

AI-driven autonomous web crawler using [browser-use](https://github.com/browser-use/browser-use) for NewsInsight.

## Overview

This service consumes `BrowserTaskMessage` from Kafka, executes AI-driven browser exploration, and produces `CrawlResultMessage` for each extracted article.

### Architecture

```
[newsinsight.crawl.browser.tasks] → Consumer → AutonomousCrawlerAgent
                                                     ↓
                                              browser-use + LLM
                                                     ↓
                                              CrawlResultProducer → [newsinsight.crawl.results]
```

## Features

- **AI-Powered Navigation**: Uses LLM (OpenAI/Anthropic) to intelligently navigate websites
- **Multiple Crawl Policies**:
  - `FOCUSED_TOPIC`: Focus on specific keywords/topics
  - `DOMAIN_WIDE`: Broad exploration of entire domain
  - `NEWS_ONLY`: Strictly news articles
  - `CROSS_DOMAIN`: Follow links across domains
  - `SINGLE_PAGE`: Extract from single URL only
- **Configurable Limits**: Max depth, max pages, time budget
- **Prometheus Metrics**: Built-in observability
- **Kafka Integration**: Reliable message processing with manual commits

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KAFKA_BOOTSTRAP_SERVERS` | `localhost:9092` | Kafka bootstrap servers |
| `KAFKA_CONSUMER_GROUP_ID` | `autonomous-crawler-group` | Consumer group ID |
| `KAFKA_BROWSER_TASK_TOPIC` | `newsinsight.crawl.browser.tasks` | Input topic |
| `KAFKA_CRAWL_RESULT_TOPIC` | `newsinsight.crawl.results` | Output topic |
| `BROWSER_HEADLESS` | `true` | Run browser in headless mode |
| `BROWSER_MAX_CONCURRENT_SESSIONS` | `2` | Max concurrent browser sessions |
| `LLM_PROVIDER` | `openai` | LLM provider (openai/anthropic) |
| `LLM_OPENAI_API_KEY` | - | OpenAI API key |
| `LLM_OPENAI_MODEL` | `gpt-4o` | OpenAI model |
| `LLM_ANTHROPIC_API_KEY` | - | Anthropic API key |
| `LLM_ANTHROPIC_MODEL` | `claude-3-5-sonnet-20241022` | Anthropic model |
| `METRICS_ENABLED` | `true` | Enable Prometheus metrics |
| `METRICS_PORT` | `9090` | Metrics server port |
| `LOG_LEVEL` | `INFO` | Logging level |
| `LOG_FORMAT` | `json` | Log format (json/console) |

## Development

### Prerequisites

- Python 3.11+
- Docker (for Playwright browsers)

### Local Setup

```bash
# Create virtual environment
python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Install Playwright browsers
playwright install chromium

# Run the service
python -m src.main
```

### Docker Build

```bash
docker build -t newsinsight/autonomous-crawler:local .
```

## Message Formats

### Input: BrowserTaskMessage

```json
{
  "jobId": 123,
  "sourceId": 456,
  "sourceName": "Example News",
  "seedUrl": "https://example.com/news",
  "maxDepth": 2,
  "maxPages": 10,
  "budgetSeconds": 300,
  "policy": "NEWS_ONLY",
  "focusKeywords": "technology,AI",
  "customPrompt": "Focus on articles about artificial intelligence",
  "captureScreenshots": false,
  "extractStructured": true,
  "excludedDomains": "ads.example.com,tracker.example.com",
  "callbackUrl": "http://collector:8081/api/browser-agent/callback",
  "callbackToken": "secret-token",
  "metadata": {},
  "createdAt": "2024-01-15T10:30:00"
}
```

### Output: CrawlResultMessage

```json
{
  "jobId": 123,
  "sourceId": 456,
  "title": "AI Revolution in 2024",
  "content": "Full article text...",
  "url": "https://example.com/news/ai-revolution",
  "publishedAt": "2024-01-15T09:00:00Z",
  "metadataJson": "{\"source\": \"browser-agent\"}"
}
```

## Metrics

Available at `http://localhost:9090/metrics`:

- `crawler_tasks_received_total` - Total tasks received
- `crawler_tasks_completed_total` - Total tasks completed (by status)
- `crawler_tasks_in_progress` - Current tasks in progress
- `crawler_articles_extracted_total` - Total articles extracted
- `crawler_task_duration_seconds` - Task processing duration histogram
- `crawler_browser_sessions_active` - Active browser sessions
- `crawler_kafka_messages_consumed_total` - Kafka messages consumed
- `crawler_kafka_messages_produced_total` - Kafka messages produced

## Integration with data-collection-service

The Java `data-collection-service` publishes `BrowserTaskMessage` when a data source with `sourceType=BROWSER_AGENT` is triggered:

1. API creates DataSource with `sourceType=BROWSER_AGENT` and `browserAgentConfig`
2. Collection starts → `CollectionService.executeBrowserAgentCollection()`
3. Message published to `newsinsight.crawl.browser.tasks`
4. This service consumes and processes the task
5. Results published to `newsinsight.crawl.results`
6. `CrawlResultConsumerService` persists results to PostgreSQL
