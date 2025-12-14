# Crawl4AI FastAPI sidecar
# Build with context from backend/subs directory:
# docker build -f crawl-worker/Dockerfile -t crawl-worker .
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# System deps for playwright - install required libraries manually
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl wget ca-certificates \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libatspi2.0-0 \
    libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements from crawl-worker directory
COPY crawl-worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && python -m playwright install chromium

# Copy shared module
COPY shared /app/shared

# Copy application code
COPY crawl-worker/main.py .

# Environment configuration
ENV PORT=8040
ENV MAX_CONCURRENT_CRAWLS=5
ENV USE_PROXY_ROTATION=true
ENV PROXY_ROTATION_URL=http://ip-rotation:8050

EXPOSE 8040
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8040"]
