FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for lxml and newspaper4k
RUN apt-get update && apt-get install -y --no-install-recommends \
    libxml2-dev \
    libxslt1-dev \
    libjpeg-dev \
    zlib1g-dev \
    libpng-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download NLTK data for NLP processing (punkt tokenizer)
RUN python -c "import nltk; nltk.download('punkt', quiet=True); nltk.download('punkt_tab', quiet=True)"

# Copy application code
COPY main.py .

# Create non-root user for security
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

# Environment configuration
ENV PORT=8010
ENV NEWS_SCRAPER_DEFAULT_LANGUAGE=ko
ENV NEWS_SCRAPER_DEFAULT_TIMEOUT=10

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

EXPOSE 8010

# Use shell form to allow environment variable substitution
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT}
