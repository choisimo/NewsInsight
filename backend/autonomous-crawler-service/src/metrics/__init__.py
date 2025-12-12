"""Prometheus metrics for autonomous-crawler-service."""

from prometheus_client import Counter, Gauge, Histogram, Info

# Service info
SERVICE_INFO = Info("crawler_service", "Autonomous crawler service information")

# ========================================
# Task metrics
# ========================================

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

# API-based task metrics (browser-agent compatibility)
API_CRAWL_TASKS = Counter(
    "crawler_api_tasks_total",
    "Total API-based crawl tasks",
    ["status", "llm_provider"],
)

# ========================================
# Article extraction metrics
# ========================================

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

URLS_DISCOVERED = Counter(
    "crawler_urls_discovered_total",
    "Total URLs discovered by agent",
    ["category"],
)

# ========================================
# Performance metrics
# ========================================

TASK_DURATION = Histogram(
    "crawler_task_duration_seconds",
    "Time spent processing a crawl task",
    ["policy"],
    buckets=[10, 30, 60, 120, 300, 600],
)

API_CRAWL_DURATION = Histogram(
    "crawler_api_crawl_duration_seconds",
    "API crawl task duration",
    ["status"],
    buckets=[5.0, 10.0, 30.0, 60.0, 120.0, 300.0, 600.0],
)

EXTRACTION_DURATION = Histogram(
    "crawler_extraction_duration_seconds",
    "Time spent extracting content from a single page",
    buckets=[1, 2, 5, 10, 30],
)

AGENT_STEPS = Histogram(
    "crawler_agent_steps",
    "Number of steps per agent task",
    ["status"],
    buckets=[1, 2, 5, 10, 20, 30, 50],
)

# ========================================
# Browser metrics
# ========================================

BROWSER_SESSIONS_ACTIVE = Gauge(
    "crawler_browser_sessions_active",
    "Number of active browser sessions",
)

BROWSER_ERRORS = Counter(
    "crawler_browser_errors_total",
    "Total number of browser errors",
    ["error_type"],
)

# ========================================
# CAPTCHA metrics
# ========================================

CAPTCHA_DETECTED = Counter(
    "crawler_captcha_detected_total",
    "Total number of CAPTCHAs detected",
    ["type"],
)

CAPTCHA_SOLVED = Counter(
    "crawler_captcha_solved_total",
    "Total number of CAPTCHAs successfully solved",
    ["type", "method"],
)

CAPTCHA_FAILED = Counter(
    "crawler_captcha_failed_total",
    "Total number of CAPTCHA solve failures",
    ["type", "reason"],
)

# ========================================
# Kafka metrics
# ========================================

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

# ========================================
# SSE metrics
# ========================================

SSE_CLIENTS_CONNECTED = Gauge(
    "crawler_sse_clients_connected",
    "Number of connected SSE clients",
)

SSE_EVENTS_SENT = Counter(
    "crawler_sse_events_sent_total",
    "Total number of SSE events sent",
    ["event_type"],
)

# ========================================
# Chat metrics
# ========================================

CHAT_REQUESTS = Counter(
    "crawler_chat_requests_total",
    "Total chat requests",
    ["provider", "streaming"],
)

CHAT_TOKENS_USED = Counter(
    "crawler_chat_tokens_used_total",
    "Total tokens used in chat requests",
    ["provider"],
)


def init_service_info(version: str = "0.1.0", llm_provider: str = "openai") -> None:
    """Initialize service info metrics."""
    SERVICE_INFO.info(
        {
            "version": version,
            "llm_provider": llm_provider,
        }
    )


def track_crawl_task(status: str, llm_provider: str, duration_seconds: float, steps: int = 0):
    """Track an API crawl task completion."""
    API_CRAWL_TASKS.labels(status=status, llm_provider=llm_provider).inc()
    API_CRAWL_DURATION.labels(status=status).observe(duration_seconds)
    if steps > 0:
        AGENT_STEPS.labels(status=status).observe(steps)


def track_url_discovery(category: str, count: int = 1):
    """Track URL discovery."""
    URLS_DISCOVERED.labels(category=category).inc(count)


def track_captcha(captcha_type: str, solved: bool, method: str = "unknown", reason: str = ""):
    """Track CAPTCHA detection and resolution."""
    CAPTCHA_DETECTED.labels(type=captcha_type).inc()
    if solved:
        CAPTCHA_SOLVED.labels(type=captcha_type, method=method).inc()
    else:
        CAPTCHA_FAILED.labels(type=captcha_type, reason=reason).inc()


def track_sse_event(event_type: str):
    """Track SSE event sent."""
    SSE_EVENTS_SENT.labels(event_type=event_type).inc()


def track_chat_request(provider: str, streaming: bool, tokens: int = 0):
    """Track chat request."""
    CHAT_REQUESTS.labels(provider=provider, streaming=str(streaming).lower()).inc()
    if tokens > 0:
        CHAT_TOKENS_USED.labels(provider=provider).inc(tokens)
