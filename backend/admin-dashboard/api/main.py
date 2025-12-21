"""
Admin Dashboard API - FastAPI 메인 애플리케이션
"""

import os
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .models.schemas import HealthCheck
from .routers import (
    auth,
    audit,
    documents,
    environments,
    scripts,
    public_auth,
    llm_providers,
    health_monitor,
    data_sources,
    ml_addons,
    ml_training,
    databases,
    kafka,
)

# 버전 정보
VERSION = "1.0.0"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """애플리케이션 라이프사이클 관리"""
    # 시작 시
    print(f"🚀 Admin Dashboard API v{VERSION} starting...")
    yield
    # 종료 시
    print("👋 Admin Dashboard API shutting down...")


# FastAPI 앱 생성
app = FastAPI(
    title="NewsInsight Admin Dashboard API",
    description="통합 TUI/Web Admin 대시보드 API",
    version=VERSION,
    docs_url="/api/v1/admin/docs",
    redoc_url="/api/v1/admin/redoc",
    openapi_url="/api/v1/admin/openapi.json",
    lifespan=lifespan,
)

# CORS 설정
CORS_ORIGINS = os.environ.get(
    "CORS_ORIGINS", "http://localhost:3000,http://localhost:5173,http://localhost:8080"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 전역 예외 핸들러
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """전역 예외 처리"""
    return JSONResponse(
        status_code=500,
        content={
            "detail": str(exc),
            "type": type(exc).__name__,
        },
    )


# API 라우터 등록
API_PREFIX = "/api/v1/admin"
PUBLIC_API_PREFIX = "/api/v1"

# Admin 전용 라우터 (/api/v1/admin/...)
app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(environments.router, prefix=API_PREFIX)
app.include_router(scripts.router, prefix=API_PREFIX)
app.include_router(documents.router, prefix=API_PREFIX)
app.include_router(audit.router, prefix=API_PREFIX)
app.include_router(llm_providers.router, prefix=API_PREFIX)
app.include_router(health_monitor.router, prefix=API_PREFIX)
app.include_router(data_sources.router, prefix=API_PREFIX)
app.include_router(ml_addons.router, prefix=API_PREFIX)
app.include_router(ml_training.router, prefix=API_PREFIX)
app.include_router(databases.router, prefix=API_PREFIX)
app.include_router(kafka.router, prefix=API_PREFIX)

# 공개 라우터 (/api/v1/auth/...)
app.include_router(public_auth.router, prefix=PUBLIC_API_PREFIX)


# 헬스체크 엔드포인트
@app.get("/health", response_model=HealthCheck, tags=["Health"])
@app.get(f"{API_PREFIX}/health", response_model=HealthCheck, tags=["Health"])
async def health_check():
    """헬스체크"""
    return HealthCheck(
        status="healthy",
        version=VERSION,
        timestamp=datetime.utcnow(),
    )


# 루트 엔드포인트
@app.get("/", tags=["Root"])
async def root():
    """루트 엔드포인트"""
    return {
        "name": "NewsInsight Admin Dashboard API",
        "version": VERSION,
        "docs": "/api/v1/admin/docs",
        "health": "/health",
    }


# 정적 파일 서빙 (Web UI)
WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "web", "dist")
if os.path.exists(WEB_DIR):
    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "api.main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8888)),
        reload=True,
    )
