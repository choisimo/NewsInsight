FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for PostgreSQL client and health check
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY aiagent_mcp/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Note: Build context should be mcp/ folder
COPY aiagent_mcp/server.py .
COPY shared ./shared

ENV PORT=5010
ENV DB_BACKEND=postgres

EXPOSE 5010

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5010/health || exit 1

CMD ["python", "server.py"]
