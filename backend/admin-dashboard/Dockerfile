# Admin Dashboard API Dockerfile
FROM python:3.11-slim

WORKDIR /app

# 시스템 의존성 설치
RUN apt-get update && apt-get install -y --no-install-recommends \
    docker.io \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Python 의존성 설치
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 소스 코드 복사
COPY api/ ./api/

# config 디렉토리 생성 (런타임에 볼륨으로 마운트됨)
RUN mkdir -p ./config

# 환경 변수
ENV PYTHONUNBUFFERED=1
ENV PORT=8888
ENV PROJECT_ROOT=/workspace
ENV ADMIN_CONFIG_DIR=/app/config

# 헬스체크
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# 실행
EXPOSE ${PORT}
CMD ["python", "-m", "uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8888"]
