# Maigret OSINT Username Scanner Worker
# Build with context from backend/subs directory:
# docker build -f maigret-worker/Dockerfile -t maigret-worker .
FROM python:3.11-slim

WORKDIR /app/maigret-worker

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY backend/data-collection-service/maigret-worker/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --timeout=120 -r requirements.txt || \
    pip install --no-cache-dir --timeout=120 -r requirements.txt

# Copy shared module
COPY backend/shared /app/shared

# Copy application code
COPY backend/data-collection-service/maigret-worker/main.py ./main.py
COPY backend/data-collection-service/maigret-worker/state_store.py ./state_store.py

# Create reports directory
RUN mkdir -p /app/reports

# Create non-root user for security
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

# Environment configuration
ENV PORT=8020
ENV LOG_LEVEL=INFO
ENV MAX_CONCURRENT_SCANS=3
ENV SCAN_TIMEOUT_SEC=300
ENV REPORTS_DIR=/app/reports
ENV USE_PROXY_ROTATION=true
ENV PROXY_ROTATION_URL=http://ip-rotation:8050

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

EXPOSE 8020

# Use shell form to allow environment variable substitution
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT}
