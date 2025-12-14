FROM python:3.12-slim

WORKDIR /app

# Install system dependencies for HDBSCAN and other ML libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download the embedding model during build
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')"

# Copy application code
COPY main.py .

# Create non-root user and model directory
RUN useradd -m -u 1000 appuser \
    && mkdir -p /app/models \
    && chown -R appuser:appuser /app
USER appuser

# Environment variables
ENV BERTOPIC_MODEL_PATH=/app/models/bertopic_model
ENV EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
ENV MIN_TOPIC_SIZE=10
ENV LOG_LEVEL=INFO

# Database connection
ENV DB_HOST=postgres
ENV DB_PORT=5432
ENV DB_NAME=osint
ENV DB_USER=osint
ENV DB_PASSWORD=osint123

EXPOSE 8020

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8020/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8020"]
