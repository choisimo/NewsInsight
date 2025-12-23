FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Note: Build context should be mcp/ folder
COPY huggingface_mcp/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY huggingface_mcp/server.py .
COPY shared ./shared

ENV PORT=5011
ENV HF_TOKEN=""

# Shared volume for ML data and model cache
VOLUME ["/app/data", "/root/.cache/huggingface"]

EXPOSE 5011

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5011/health || exit 1

CMD ["python", "server.py"]
