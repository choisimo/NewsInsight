"""
Analysis Service 메인 모듈

감성 분석, 트렌드 분석, 리포트 생성 등을 담당하는
핵심 분석 마이크로서비스입니다.

주요 기능:
- 텍스트 감성 분석 (긍정/부정/중립)
- 시계열 트렌드 분석
- 자동 리포트 생성
- ML 모델 관리
"""

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import logging
import uvicorn

# 데이터베이스 및 라우터 모듈 import
from app.db import get_db, engine, Base
from app.routers import sentiment, trends, reports, models as ml_models
from app.config import settings

# 로깅 설정 - INFO 레벨로 설정하여 중요 이벤트만 기록
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)  # 현재 모듈명으로 로거 생성


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    애플리케이션 생명주기 관리 함수
    
    애플리케이션 시작 시 데이터베이스 테이블을 생성하고,
    종료 시 정리 작업을 수행합니다.
    
    Args:
        app: FastAPI 애플리케이션 인스턴스
        
    Yields:
        제어권을 애플리케이션에 반환
    """
    # 애플리케이션 시작 시 - 데이터베이스 테이블 생성
    Base.metadata.create_all(bind=engine)  # SQLAlchemy 모델 기반 테이블 생성
    logger.info("Analysis Service starting up...")  # 시작 로그
    yield  # 애플리케이션 실행
    # 애플리케이션 종료 시
    logger.info("Analysis Service shutting down...")  # 종료 로그


# FastAPI 애플리케이션 인스턴스 생성
app = FastAPI(
    title="Analysis Service",  # API 문서 제목
    description="Microservice for sentiment analysis, trend analysis, and reporting",  # 서비스 설명
    version="1.0.0",  # API 버전
    lifespan=lifespan  # 생명주기 관리 함수
)

# CORS 미들웨어 추가 - 크로스 오리진 요청 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_HOSTS,  # 허용된 도메인 목록
    allow_credentials=True,  # 쿠키/인증 정보 포함 허용
    allow_methods=["*"],  # 모든 HTTP 메서드 허용
    allow_headers=["*"],  # 모든 헤더 허용
)

# 신뢰할 수 있는 호스트 미들웨어 추가 - Host 헤더 검증
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.ALLOWED_HOSTS)

# 각 기능별 라우터 등록
# 감성 분석 라우터
app.include_router(
    sentiment.router,
    prefix="/api/v1/sentiment",  # URL 접두사
    tags=["sentiment"]  # Swagger UI 태그
)

# 트렌드 분석 라우터
app.include_router(
    trends.router,
    prefix="/api/v1/trends",  # URL 접두사
    tags=["trends"]  # Swagger UI 태그
)

# 리포트 생성 라우터
app.include_router(
    reports.router,
    prefix="/api/v1/reports",  # URL 접두사
    tags=["reports"]  # Swagger UI 태그
)

# ML 모델 관리 라우터
app.include_router(
    ml_models.router,
    prefix="/api/v1/models",  # URL 접두사
    tags=["ml-models"]  # Swagger UI 태그
)


@app.get("/health")
async def health_check():
    """
    헬스 체크 엔드포인트
    
    서비스의 상태를 확인하기 위한 엔드포인트입니다.
    API Gateway에서 주기적으로 호출합니다.
    
    Returns:
        dict: 서비스 상태 정보
    """
    # Get config source info
    config_source = {}
    if hasattr(settings, '_consul_loader'):
        config_source = settings._consul_loader.get_config_source_info()  # type: ignore
    
    return {
        "status": "healthy",  # 서비스 상태
        "service": "analysis-service",  # 서비스 이름
        "config_source": config_source  # 설정 소스 정보
    }


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """
    전역 예외 처리기
    
    처리되지 않은 모든 예외를 잡아서 처리합니다.
    예외 정보를 로깅하고 클라이언트에게 일관된 응답을 반환합니다.
    
    Args:
        request: HTTP 요청 객체
        exc: 발생한 예외
        
    Returns:
        JSONResponse: 500 에러 응답
    """
    logger.error(f"Global exception: {exc}")  # 예외 로깅
    return JSONResponse(
        status_code=500,  # Internal Server Error
        content={"detail": "Internal server error"}  # 에러 메시지
    )


if __name__ == "__main__":
    """
    애플리케이션 직접 실행 시 진입점
    
    개발 환경에서 python main.py로 직접 실행할 때 사용됩니다.
    프로덕션에서는 Docker 컨테이너나 gunicorn 등을 사용합니다.
    """
    uvicorn.run(
        "main:app",  # 실행할 애플리케이션 경로
        host="0.0.0.0",  # 모든 네트워크 인터페이스에서 접속 허용
        port=8001,  # Analysis Service 포트 (8001)
        reload=settings.DEBUG  # DEBUG 모드에서만 자동 재시작 활성화
    )