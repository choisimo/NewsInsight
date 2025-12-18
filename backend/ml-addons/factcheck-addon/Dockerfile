# ML-Enhanced Factcheck Add-on Dockerfile
# Supports both CPU and GPU modes via build args

ARG BASE_IMAGE=python:3.11-slim

FROM ${BASE_IMAGE}

WORKDIR /app

# Build arguments
ARG ENABLE_GPU=false
ARG PRELOAD_MODELS=false

# Environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # ML Configuration
    ENABLE_ML_MODELS=true \
    CLAIM_MODEL=monologg/koelectra-base-v3-discriminator \
    EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2 \
    NER_MODEL=klue/bert-base \
    SENTIMENT_MODEL=klue/roberta-base \
    # Cache directories
    HF_HOME=/app/.cache/huggingface \
    TRANSFORMERS_CACHE=/app/.cache/huggingface/transformers \
    TORCH_HOME=/app/.cache/torch

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create cache directories
RUN mkdir -p /app/.cache/huggingface/transformers /app/.cache/torch

# Install Python dependencies
COPY requirements.txt .

# Install PyTorch based on GPU availability
RUN if [ "$ENABLE_GPU" = "true" ]; then \
        pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121; \
    else \
        pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu; \
    fi

# Install remaining dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY addon_server.py .

# Preload models during build (optional, makes image larger but startup faster)
RUN if [ "$PRELOAD_MODELS" = "true" ]; then \
        python -c "from transformers import AutoTokenizer, AutoModelForSequenceClassification; \
            AutoTokenizer.from_pretrained('monologg/koelectra-base-v3-discriminator'); \
            AutoModelForSequenceClassification.from_pretrained('monologg/koelectra-base-v3-discriminator', num_labels=3)" && \
        python -c "from sentence_transformers import SentenceTransformer; \
            SentenceTransformer('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')" && \
        echo "Models preloaded successfully"; \
    fi

# Expose port
EXPOSE 8101

# Health check with longer timeout for ML model loading
HEALTHCHECK --interval=30s --timeout=30s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:8101/health || exit 1

# Run server with workers based on CPU count
CMD ["uvicorn", "addon_server:app", "--host", "0.0.0.0", "--port", "8101", "--workers", "1"]
