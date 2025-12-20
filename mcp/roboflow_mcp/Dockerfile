FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for image processing and health check
# Note: libgl1-mesa-glx replaced with libgl1 in Debian bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxrender1 \
    libxext6 \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

ENV PORT=5010
ENV ROBOFLOW_API_KEY=""

# Shared volume for ML data
VOLUME ["/app/data"]

EXPOSE 5010

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5010/health || exit 1

CMD ["python", "server.py"]
