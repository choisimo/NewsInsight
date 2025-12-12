FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

ENV PORT=5020

# MCP Server URLs
ENV ROBOFLOW_MCP_URL="http://roboflow-mcp:5010"
ENV HUGGINGFACE_MCP_URL="http://huggingface-mcp:5011"
ENV KAGGLE_MCP_URL="http://kaggle-mcp:5012"

# Shared volume for ML data
VOLUME ["/app/data"]

EXPOSE 5020

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5020/health || exit 1

CMD ["python", "server.py"]
