FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for PostgreSQL client and health check
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY topic_mcp/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Note: Build context should be mcp/ folder
COPY topic_mcp/server.py .
COPY shared ./shared

ENV PORT=5003
ENV DB_BACKEND=postgres

EXPOSE 5003

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5003/health || exit 1

CMD ["python", "server.py"]
