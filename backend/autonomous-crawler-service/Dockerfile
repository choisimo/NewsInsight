# Multi-stage build for autonomous-crawler-service
# Stage 1: Base with Python and system dependencies
FROM python:3.11-slim as base

# Install system dependencies for Playwright
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libwayland-client0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    libu2f-udev \
    libvulkan1 \
    && rm -rf /var/lib/apt/lists/*

# Stage 2: Builder - install Python dependencies
FROM base as builder

WORKDIR /app

# Install pip dependencies
COPY backend/autonomous-crawler-service/requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Install Playwright browsers
RUN python -m playwright install chromium

# Stage 3: Final image
FROM base as final

# Create non-root user
RUN useradd -m -u 1000 crawler

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /root/.local /home/crawler/.local
COPY --from=builder /root/.cache/ms-playwright /home/crawler/.cache/ms-playwright

# Copy application code
COPY backend/autonomous-crawler-service/src/ ./src/
COPY backend/autonomous-crawler-service/pyproject.toml .

# Set ownership
RUN chown -R crawler:crawler /app /home/crawler

# Switch to non-root user
USER crawler

# Add local bin to PATH
ENV PATH=/home/crawler/.local/bin:$PATH
ENV PYTHONPATH=/app

# Playwright environment
ENV PLAYWRIGHT_BROWSERS_PATH=/home/crawler/.cache/ms-playwright

# Default environment variables
ENV KAFKA_BOOTSTRAP_SERVERS=localhost:9092 \
    KAFKA_CONSUMER_GROUP_ID=autonomous-crawler-group \
    KAFKA_BROWSER_TASK_TOPIC=newsinsight.crawl.browser.tasks \
    KAFKA_CRAWL_RESULT_TOPIC=newsinsight.crawl.results \
    BROWSER_HEADLESS=true \
    BROWSER_MAX_CONCURRENT_SESSIONS=2 \
    LLM_PROVIDER=openai \
    LLM_OPENAI_MODEL=gpt-4o \
    METRICS_ENABLED=true \
    METRICS_PORT=9090 \
    LOG_LEVEL=INFO \
    LOG_FORMAT=json \
    # New environment variables for hybrid mode
    SERVICE_MODE=kafka \
    API_PORT=8030 \
    USE_DB_PROVIDERS=true \
    COLLECTOR_SERVICE_URL=http://collector:8002

# Expose ports: metrics (9090) + REST API (8030)
EXPOSE 9090 8030

# Health check - check both metrics and API based on mode
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD python -c "import socket; s=socket.socket(); s.connect(('localhost', 9090)); s.close()" || \
        python -c "import socket; s=socket.socket(); s.connect(('localhost', 8030)); s.close()" || exit 1

# Run the service (mode controlled by SERVICE_MODE env var)
# Use --mode argument or SERVICE_MODE env var:
#   kafka  - Kafka consumer only (default)
#   api    - REST API only  
#   hybrid - Both Kafka + REST API
CMD ["python", "-m", "src.main"]
