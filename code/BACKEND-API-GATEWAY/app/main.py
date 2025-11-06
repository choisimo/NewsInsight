"""
API Gateway 메인 모듈

이 모듈은 모든 마이크로서비스에 대한 단일 진입점 역할을 하는 API Gateway를 구현합니다.
주요 기능:
- 요청 라우팅 및 프록시
- 서비스 헬스 체크
- CORS 처리
- 전역 예외 처리
- 서비스 간 통신 관리
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn
import httpx
from contextlib import asynccontextmanager

from app.config import settings
from app.routers import analysis, collector, absa, alerts, osint_orchestrator, osint_planning, osint_source
from app.middleware.auth import auth_middleware, rbac_middleware
from app.middleware.rate_limit import rate_limit_middleware

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    애플리케이션 생명주기 관리 함수
    
    애플리케이션 시작 시 HTTP 클라이언트를 초기화하고,
    종료 시 리소스를 정리합니다.
    
    Args:
        app: FastAPI 애플리케이션 인스턴스
        
    Yields:
        제어권을 애플리케이션에 반환
    """
    # 애플리케이션 시작 시 - HTTP 클라이언트 초기화
    # 30초 타임아웃으로 설정하여 느린 서비스 응답도 처리 가능
    app.state.http_client = httpx.AsyncClient(timeout=30.0)
    yield
    # 애플리케이션 종료 시 - HTTP 클라이언트 정리
    await app.state.http_client.aclose()

# FastAPI 애플리케이션 인스턴스 생성
# lifespan 파라미터를 통해 생명주기 관리 함수 연결
app = FastAPI(
    title="Pension Sentiment Analysis - API Gateway",  # API 문서 제목
    description="Central API Gateway for all microservices",  # API 설명
    version="1.0.0",  # API 버전
    lifespan=lifespan  # 생명주기 관리 함수
)

# CORS(Cross-Origin Resource Sharing) 미들웨어 추가
# 프론트엔드에서의 API 호출을 허용하기 위한 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 모든 도메인에서의 요청 허용 (프로덕션에서는 특정 도메인만 허용 권장)
    allow_credentials=True,  # 쿠키/인증 정보 포함 허용
    allow_methods=["*"],  # 모든 HTTP 메서드 허용 (GET, POST, PUT, DELETE 등)
    allow_headers=["*"],  # 모든 헤더 허용
)

# Function-based middlewares
# 순서: 인증 → RBAC → Rate Limit (인증 정보를 기반으로 역할별 제한 적용)
app.middleware("http")(auth_middleware)
app.middleware("http")(rbac_middleware)
app.middleware("http")(rate_limit_middleware)

@app.get("/health")
async def health_check():
    """
    헬스 체크 엔드포인트
    
    API Gateway와 연결된 모든 마이크로서비스의 상태를 확인합니다.
    각 서비스의 헬스 체크 엔드포인트를 호출하여 전체 시스템 상태를 반환합니다.
    
    Returns:
        dict: 전체 시스템 상태 정보
            - status: 전체 상태 (healthy/degraded)
            - services: 각 서비스별 상태 정보
            - gateway_version: API Gateway 버전
            - config_source: 설정 소스 정보 (Consul/환경변수)
    """
    services_status = {}  # 각 서비스의 상태를 저장할 딕셔너리
    
    # 모든 마이크로서비스 URL 정의
    services = {
        "analysis": settings.ANALYSIS_SERVICE_URL,  # 분석 서비스
        "collector": settings.COLLECTOR_SERVICE_URL,  # 수집 서비스
        "absa": settings.ABSA_SERVICE_URL,  # ABSA 서비스
        "alert": settings.ALERT_SERVICE_URL,  # 알림 서비스
        "osint-orchestrator": settings.OSINT_ORCHESTRATOR_SERVICE_URL,  # OSINT 오케스트레이터 서비스
        "osint-planning": settings.OSINT_PLANNING_SERVICE_URL,  # OSINT 계획 서비스
        "osint-source": settings.OSINT_SOURCE_SERVICE_URL  # OSINT 소스 서비스
    }
    
    # 5초 타임아웃으로 HTTP 클라이언트 생성 (헬스 체크는 빠르게 응답해야 함)
    async with httpx.AsyncClient(timeout=5.0) as client:
        # 각 서비스의 헬스 체크 엔드포인트 호출
        for service, url in services.items():
            if url:  # URL이 설정된 경우만 체크
                try:
                    # 서비스의 /health 엔드포인트 호출
                    response = await client.get(f"{url}/health")
                    
                    # 응답 상태와 응답 시간 기록
                    services_status[service] = {
                        "status": "healthy" if response.status_code == 200 else "unhealthy",
                        "response_time": response.elapsed.total_seconds()  # 응답 시간 (초)
                    }
                except Exception as e:
                    # 오류 발생 시 unhealthy로 표시하고 오류 메시지 저장
                    services_status[service] = {
                        "status": "unhealthy",
                        "error": str(e)  # 오류 메시지
                    }
            else:
                services_status[service] = {
                    "status": "not_configured",
                    "message": "Service URL not configured"
                }
    
    # 전체 시스템 상태 판단
    # 모든 서비스가 healthy일 때만 전체를 healthy로 판단
    overall_status = "healthy" if all(
        s.get("status") == "healthy" for s in services_status.values() if s.get("status") not in ["not_configured"]
    ) else "degraded"  # 하나라도 unhealthy면 degraded 상태
    
    # Get config source info
    config_source = {}
    if hasattr(settings, '_consul_loader'):
        config_source = settings._consul_loader.get_config_source_info()  # type: ignore
    
    # 헬스 체크 결과 반환
    return {
        "status": overall_status,  # 전체 시스템 상태
        "services": services_status,  # 각 서비스별 상태 정보
        "gateway_version": "1.0.0",  # API Gateway 버전
        "config_source": config_source,  # 설정 소스 정보
        "environment": settings.ENVIRONMENT  # 실행 환경
    }

@app.get("/")
async def root():
    """
    루트 엔드포인트
    
    API Gateway의 기본 정보와 사용 가능한 서비스 엔드포인트를 제공합니다.
    API 사용자가 처음 접속했을 때 시스템 정보를 파악할 수 있도록 합니다.
    
    Returns:
        dict: API Gateway 정보
            - message: 시스템 설명
            - version: API 버전
            - services: 사용 가능한 서비스 엔드포인트
            - docs: API 문서 경로
            - health: 헬스 체크 경로
    """
    return {
        "message": "Pension Sentiment Analysis API Gateway",  # 시스템 이름
        "version": "1.0.0",  # API 버전
        "services": {  # 각 마이크로서비스 엔드포인트
            "analysis": "/api/v1/analysis",  # 분석 서비스
            "collector": "/api/v1/collector",  # 수집 서비스
            "absa": "/api/v1/absa",  # ABSA 서비스
            "alerts": "/api/v1/alerts",  # 알림 서비스
            "osint-orchestrator": "/api/v1/osint-orchestrator",  # OSINT 오케스트레이터 서비스
            "osint-planning": "/api/v1/osint-planning",  # OSINT 계획 서비스
            "osint-source": "/api/v1/osint-source"  # OSINT 소스 서비스
        },
        "docs": "/docs",  # Swagger UI 문서 경로
        "health": "/health"  # 헬스 체크 경로
    }

# 각 마이크로서비스 라우터 등록
# 각 라우터는 해당 서비스로의 프록시 역할을 수행

# 분석 서비스 라우터 등록
app.include_router(
    analysis.router,
    prefix="/api/v1/analysis",  # URL 접두사
    tags=["Analysis Service"]  # Swagger UI에서의 그룹 태그
)

# 수집 서비스 라우터 등록
app.include_router(
    collector.router,
    prefix="/api/v1/collector",  # URL 접두사
    tags=["Collector Service"]  # Swagger UI에서의 그룹 태그
)

# ABSA(Aspect-Based Sentiment Analysis) 서비스 라우터 등록
app.include_router(
    absa.router,
    prefix="/api/v1/absa",  # URL 접두사
    tags=["ABSA Service"]  # Swagger UI에서의 그룹 태그
)

# 알림 서비스 라우터 등록
app.include_router(
    alerts.router,
    prefix="/api/v1/alerts",  # URL 접두사
    tags=["Alert Service"]  # Swagger UI에서의 그룹 태그
)

# OSINT 오케스트레이터 서비스 라우터 등록
app.include_router(
    osint_orchestrator.router,
    prefix="/api/v1/osint-orchestrator",  # URL 접두사
    tags=["OSINT Orchestrator Service"]  # Swagger UI에서의 그룹 태그
)

app.include_router(
    osint_orchestrator.tasks_alias_router,
    prefix="/api/v1/osint",
    tags=["OSINT Orchestrator Service"]
)

# Legacy alias for /api/v1/tasks
app.include_router(
    osint_orchestrator.tasks_alias_router,
    prefix="/api/v1",
    tags=["OSINT Orchestrator Service"]
)

# Dashboard alias (overview, issues top)
app.include_router(
    osint_orchestrator.dashboard_alias_router,
    prefix="/api/v1/dashboard",
    tags=["OSINT Orchestrator Service"]
)

app.include_router(
    osint_orchestrator.dashboard_alias_router,
    prefix="/api/v1/osint",
    tags=["OSINT Orchestrator Service"]
)

# OSINT 계획 서비스 라우터 등록
app.include_router(
    osint_planning.router,
    prefix="/api/v1/osint-planning",  # URL 접두사
    tags=["OSINT Planning Service"]  # Swagger UI에서의 그룹 태그
)

app.include_router(
    osint_planning.plans_alias_router,
    prefix="/api/v1/osint",
    tags=["OSINT Planning Service"]
)

# OSINT 소스 서비스 라우터 등록
app.include_router(
    osint_source.router,
    prefix="/api/v1/osint-source",  # URL 접두사
    tags=["OSINT Source Service"]  # Swagger UI에서의 그룹 태그
)

app.include_router(
    osint_source.sources_alias_router,
    prefix="/api/v1/osint",
    tags=["OSINT Source Service"]
)

# 전역 예외 처리기
# 마이크로서비스 통신 중 발생할 수 있는 예외를 처리

@app.exception_handler(httpx.TimeoutException)
async def timeout_handler(request, exc):
    """
    타임아웃 예외 처리기
    
    마이크로서비스 응답이 지정된 시간 내에 오지 않을 때 발생하는 예외를 처리합니다.
    
    Args:
        request: HTTP 요청 객체
        exc: 발생한 TimeoutException
        
    Returns:
        JSONResponse: 504 Gateway Timeout 응답
    """
    return JSONResponse(
        status_code=504,  # Gateway Timeout
        content={"detail": "Service timeout - please try again later"}  # 오류 메시지
    )

@app.exception_handler(httpx.ConnectError)
async def connect_error_handler(request, exc):
    """
    연결 오류 처리기
    
    마이크로서비스에 연결할 수 없을 때 발생하는 예외를 처리합니다.
    
    Args:
        request: HTTP 요청 객체
        exc: 발생한 ConnectError
        
    Returns:
        JSONResponse: 503 Service Unavailable 응답
    """
    return JSONResponse(
        status_code=503,  # Service Unavailable
        content={"detail": "Service temporarily unavailable"}  # 오류 메시지
    )

if __name__ == "__main__":
    """
    애플리케이션 직접 실행 시 진입점
    
    개발 환경에서 직접 실행할 때 사용됩니다.
    프로덕션에서는 Docker 컨테이너나 별도의 프로세스 매니저를 사용합니다.
    """
    uvicorn.run(
        "app.main:app",  # 실행할 애플리케이션 경로
        host="0.0.0.0",  # 모든 네트워크 인터페이스에서 접속 허용
        port=settings.PORT,  # 포트 번호 (기본: 8000)
        reload=settings.DEBUG,  # DEBUG 모드에서만 자동 재시작 활성화
        log_level="info"  # 로그 레벨 설정
    )