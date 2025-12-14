# Browser-Use Agent Service
# AI 기반 자율 브라우저 에이전트 - Python 3.11 + Playwright
FROM python:3.11-slim-bookworm

# 환경 변수 설정
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    HEADLESS=true

WORKDIR /app

# 시스템 의존성 설치 (Playwright용)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    libatspi2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# 의존성 설치 (타임아웃 증가 및 재시도 설정)
COPY requirements.txt .
RUN pip install --no-cache-dir --timeout=120 --retries=5 -r requirements.txt

# Playwright 브라우저 설치
RUN playwright install chromium --with-deps

# 애플리케이션 코드 복사
COPY main.py .

# 비루트 사용자 생성 (보안)
RUN useradd --create-home --shell /bin/bash appuser && \
    chown -R appuser:appuser /app && \
    chown -R appuser:appuser /ms-playwright
USER appuser

# 포트 노출
EXPOSE 8030

# 헬스체크
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8030/health || exit 1

# 실행
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8030"]
