# Bot Detection Service Dockerfile
FROM python:3.11-slim

WORKDIR /app/bot-detector

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for layer caching
COPY backend/browser-use/bot-detector/requirements.txt ./requirements.txt

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

RUN python -c "import nltk; nltk.download('punkt'); nltk.download('stopwords')"

COPY backend/shared /app/shared

COPY backend/browser-use/bot-detector/main.py ./main.py

# Create non-root user
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

# Default port (can be overridden via PORT env var)
ENV PORT=8041

# Expose port
EXPOSE 8041

# Health check - uses PORT env var
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8041}/health || exit 1

# Run the application - uses PORT env var via shell
CMD ["sh", "-c", "python -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-8041}"]
