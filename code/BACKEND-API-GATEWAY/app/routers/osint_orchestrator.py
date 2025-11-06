"""
OSINT Orchestrator Service 프록시 라우터

OSINT 오케스트레이터 서비스로의 요청을 프록시하는 라우터 모듈입니다.
OSINT 작업 관리, 계획 실행, 결과 수집 등의 요청을 처리합니다.
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
import httpx
from app.config import settings

# 라우터 인스턴스 생성
router = APIRouter()
tasks_alias_router = APIRouter()
dashboard_alias_router = APIRouter()

TASKS_BASE_PATH = "api/v1/osint/tasks"
DASHBOARD_OVERVIEW_PATH = "dashboard/overview"
ISSUES_TOP_PATH = "issues/top"

async def proxy_request(request: Request, path: str = ""):
    """
    OSINT Orchestrator Service로 요청을 프록시하는 핵심 함수
    
    들어온 요청을 그대로 OSINT Orchestrator Service로 전달하고,
    응답을 클라이언트에게 반환합니다.
    
    Args:
        request: FastAPI Request 객체
        path: 요청 경로 (API Gateway 프리픽스 제외)
        
    Returns:
        JSONResponse: OSINT Orchestrator Service의 응답
        
    Raises:
        HTTPException: 프록시 요청 실패 시
    """
    # /api/v1/osint-orchestrator 프리픽스 제거 (이미 라우터에서 처리됨)
    target_path = path if path else ""
    
    # 목적지 URL 구성
    target_url = f"{settings.OSINT_ORCHESTRATOR_SERVICE_URL}/{target_path}"
    
    # HTTP 메서드 및 헤더 준비
    method = request.method
    headers = dict(request.headers)
    
    # host 헤더 제거 (충돌 방지)
    headers.pop("host", None)
    
    try:
        # HTTP 클라이언트 생성 (타임아웃 설정 포함)
        async with httpx.AsyncClient(timeout=settings.DEFAULT_TIMEOUT) as client:
            # HTTP 메서드별 처리
            if method == "GET":
                # GET 요청 처리
                response = await client.get(
                    target_url,
                    headers=headers,
                    params=request.query_params  # 쿼리 파라미터 전달
                )
            elif method == "POST":
                # POST 요청 처리
                body = await request.body()  # 요청 바디 읽기
                response = await client.post(
                    target_url,
                    headers=headers,
                    params=request.query_params,
                    content=body  # 바디 데이터 전달
                )
            elif method == "PUT":
                # PUT 요청 처리
                body = await request.body()  # 요청 바디 읽기
                response = await client.put(
                    target_url,
                    headers=headers,
                    params=request.query_params,
                    content=body  # 바디 데이터 전달
                )
            elif method == "DELETE":
                # DELETE 요청 처리
                response = await client.delete(
                    target_url,
                    headers=headers,
                    params=request.query_params
                )
            elif method == "PATCH":
                # PATCH 요청 처리
                body = await request.body()  # 요청 바디 읽기
                response = await client.patch(
                    target_url,
                    headers=headers,
                    params=request.query_params,
                    content=body  # 바디 데이터 전달
                )
            else:
                # 지원하지 않는 HTTP 메서드
                raise HTTPException(status_code=405, detail="Method not allowed")
            
            # 대상 서비스의 응답을 클라이언트에게 반환
            # Content-Type에 따라 JSON 또는 텍스트로 처리
            return JSONResponse(
                content=response.json() if response.headers.get("content-type", "").startswith("application/json") else response.text,
                status_code=response.status_code,  # 원본 상태 코드 유지
                headers=dict(response.headers)  # 원본 헤더 전달
            )
            
    except httpx.TimeoutException:
        # 타임아웃 발생 시 504 Gateway Timeout 반환
        raise HTTPException(status_code=504, detail="OSINT Orchestrator service timeout")
    except httpx.ConnectError:
        # 연결 실패 시 503 Service Unavailable 반환
        raise HTTPException(status_code=503, detail="OSINT Orchestrator service unavailable")
    except Exception as e:
        # 기타 예외 발생 시 500 Internal Server Error 반환
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

# =============================================================================
# OSINT Orchestrator Service 엔드포인트 정의
# =============================================================================

@router.get("/health")
async def health_check(request: Request):
    """
    OSINT Orchestrator Service 헬스 체크
    
    서비스의 상태를 확인합니다.
    """
    return await proxy_request(request, "health")

@router.get("/")
async def root(request: Request):
    """
    OSINT Orchestrator Service 루트 엔드포인트
    
    서비스 정보를 반환합니다.
    """
    return await proxy_request(request, "")

# -----------------------------------------------------------------------------
# Catch-all 라우트 (기타 모든 엔드포인트 처리)
# -----------------------------------------------------------------------------

@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def catch_all(path: str, request: Request):
    """
    Catch-all 라우트
    
    명시적으로 정의되지 않은 OSINT Orchestrator Service의 엔드포인트를
    동적으로 프록시합니다. 이를 통해 새로운 엔드포인트가 추가되어도
    Gateway 코드 수정 없이 사용할 수 있습니다.
    
    Args:
        request: HTTP 요청 객체
    
    Returns:
        OSINT Orchestrator Service의 응답
    """
    return await proxy_request(request, path)


@tasks_alias_router.api_route("/tasks", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def tasks_root_alias(request: Request):
    """
    /api/v1/osint/tasks 루트 경로를 오케스트레이터 서비스 표준 엔드포인트로 프록시합니다.

    Args:
        request: 현재 요청 객체

    Returns:
        OSINT Orchestrator Service 응답
    """
    # Ensure trailing slash to match FastAPI route registered at "/api/v1/osint/tasks/"
    return await proxy_request(request, f"{TASKS_BASE_PATH}/")

@tasks_alias_router.api_route("/tasks/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def tasks_alias_catch_all(path: str, request: Request):
    """
    /api/v1/osint/tasks/* 경로를 오케스트레이터 서비스로 전달하는 alias입니다.

    Args:
        path: tasks 이하 세부 경로
        request: 현재 요청 객체

    Returns:
        OSINT Orchestrator Service 응답
    """
    target = f"{TASKS_BASE_PATH}/{path}" if path else TASKS_BASE_PATH
    return await proxy_request(request, target)


@dashboard_alias_router.get("/overview")
async def dashboard_overview_alias(request: Request):
    """
    /api/v1/dashboard/overview 경로를 오케스트레이터 서비스 /dashboard/overview로 프록시합니다.

    Args:
        request: 현재 요청 객체

    Returns:
        OSINT Orchestrator Service 응답
    """
    return await proxy_request(request, DASHBOARD_OVERVIEW_PATH)


@dashboard_alias_router.get("/issues/top")
async def issues_top_alias(request: Request):
    """
    /api/v1/osint/issues/top 요청을 오케스트레이터 서비스 /issues/top으로 전달합니다.

    Args:
        request: 현재 요청 객체

    Returns:
        OSINT Orchestrator Service 응답
    """
    return await proxy_request(request, ISSUES_TOP_PATH)