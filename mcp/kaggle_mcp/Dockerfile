FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

ENV PORT=5012
ENV KAGGLE_USERNAME=""
ENV KAGGLE_KEY=""

# Shared volume for ML data and datasets
VOLUME ["/app/data", "/root/.kaggle"]

EXPOSE 5012

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5012/health || exit 1

CMD ["python", "server.py"]
