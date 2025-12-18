FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for PyTorch and KoNLPy
RUN apt-get update && apt-get install -y \
    build-essential \
    default-jdk \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set Java environment for KoNLPy
ENV JAVA_HOME=/usr/lib/jvm/default-java

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY main.py .
COPY state_store.py .

# Create directories for models and datasets
RUN mkdir -p /app/models /app/datasets /app/logs

# Expose port
EXPOSE 8090

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8090/health || exit 1

# Run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8090"]
