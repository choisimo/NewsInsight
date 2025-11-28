"""Prometheus metrics for autonomous-crawler-service."""

from prometheus_client import Counter, Gauge, Histogram, Info

# Service info
SERVICE_INFO = Info("crawler_service", "Autonomous crawler service information")

# Task metrics
TASKS_RECEIVED = Counter(
    "crawler_tasks_received_total",
    "Total number of crawl tasks received from Kafka",
    ["policy"],
)

TASKS_COMPLETED = Counter(
    "crawler_tasks_completed_total",
    "Total number of crawl tasks completed",
    ["policy", "status"],
)

TASKS_IN_PROGRESS = Gauge(
    "crawler_tasks_in_progress",
    "Number of crawl tasks currently in progress",
)

# Article extraction metrics
ARTICLES_EXTRACTED = Counter(
    "crawler_articles_extracted_total",
    "Total number of articles extracted",
    ["source_id"],
)

PAGES_VISITED = Counter(
    "crawler_pages_visited_total",
    "Total number of pages visited",
    ["domain"],
)

# Performance metrics
TASK_DURATION = Histogram(
    "crawler_task_duration_seconds",
    "Time spent processing a crawl task",
    ["policy"],
    buckets=[10, 30, 60, 120, 300, 600],
)

EXTRACTION_DURATION = Histogram(
    "crawler_extraction_duration_seconds",
    "Time spent extracting content from a single page",
    buckets=[1, 2, 5, 10, 30],
)

# Browser metrics
BROWSER_SESSIONS_ACTIVE = Gauge(
    "crawler_browser_sessions_active",
    "Number of active browser sessions",
)

BROWSER_ERRORS = Counter(
    "crawler_browser_errors_total",
    "Total number of browser errors",
    ["error_type"],
)

# Kafka metrics
KAFKA_MESSAGES_CONSUMED = Counter(
    "crawler_kafka_messages_consumed_total",
    "Total number of Kafka messages consumed",
    ["topic"],
)

KAFKA_MESSAGES_PRODUCED = Counter(
    "crawler_kafka_messages_produced_total",
    "Total number of Kafka messages produced",
    ["topic"],
)

KAFKA_CONSUMER_LAG = Gauge(
    "crawler_kafka_consumer_lag",
    "Kafka consumer lag (messages behind)",
    ["topic", "partition"],
)


def init_service_info(version: str = "0.1.0", llm_provider: str = "openai") -> None:
    """Initialize service info metrics."""
    SERVICE_INFO.info({
        "version": version,
        "llm_provider": llm_provider,
    })
