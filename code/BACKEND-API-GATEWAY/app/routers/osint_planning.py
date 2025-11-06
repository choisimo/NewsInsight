"""
OSINT Planning Service 프록시 라우터

OSINT 계획 서비스로의 요청을 프록시하는 라우터 모듈입니다.
OSINT 작업 계획 생성, 관리, 실행 등의 요청을 처리합니다.
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
import httpx
from app.config import settings

# 라우터 인스턴스 생성
router = APIRouter()
plans_alias_router = APIRouter()

PLANNING_BASE_PATH = "api/v1/plans"

async def proxy_request(request: Request, path: str = ""):
    """
    OSINT Planning Service로 요청을 프록시하는 핵심 함수
    
    들어온 요청을 그대로 OSINT Planning Service로 전달하고,
    응답을 클라이언트에게 반환합니다.

    규칙:
        - "health" 는 그대로 전달
        - 경로가 "api/" 로 시작하면 그대로 전달
        - 그 외에는 "api/v1/plans" 접두사를 붙여 전달

    Args:
        request: 현재 요청 객체
        path: 게이트웨이 기준 하위 경로

    Returns:
        FastAPI JSONResponse: Planning 서비스에서 돌려준 응답

    Raises:
        HTTPException: 타임아웃, 연결 실패, 미지원 메서드 등 오류 발생 시
    """
    if not path:
        # Mount root → backend plans root
        target_path = PLANNING_BASE_PATH
    elif path == "health":
        target_path = "health"
    elif path.startswith("api/"):
        target_path = path
    elif path == "plans":
        target_path = PLANNING_BASE_PATH
    elif path.startswith("plans/"):
        # Avoid double 'plans' segment
        target_path = f"{PLANNING_BASE_PATH}/{path[len('plans/'):]}"
    else:
        target_path = f"{PLANNING_BASE_PATH}/{path}"
    target_url = f"{settings.OSINT_PLANNING_SERVICE_URL}/{target_path}"
    
    method = request.method
    headers = dict(request.headers)
    headers.pop("host", None)
    
    try:
        async with httpx.AsyncClient(timeout=settings.DEFAULT_TIMEOUT) as client:
            if method == "GET":
                response = await client.get(target_url, headers=headers, params=request.query_params)
            elif method == "POST":
                body = await request.body()
                response = await client.post(target_url, headers=headers, params=request.query_params, content=body)
            elif method == "PUT":
                body = await request.body()
                response = await client.put(target_url, headers=headers, params=request.query_params, content=body)
            elif method == "DELETE":
                response = await client.delete(target_url, headers=headers, params=request.query_params)
            elif method == "PATCH":
                body = await request.body()
                response = await client.patch(target_url, headers=headers, params=request.query_params, content=body)
            else:
                raise HTTPException(status_code=405, detail="Method not allowed")
            
            return JSONResponse(
                content=response.json() if response.headers.get("content-type", "").startswith("application/json") else response.text,
                status_code=response.status_code,
                headers=dict(response.headers)
            )
            
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="OSINT Planning service timeout")
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="OSINT Planning service unavailable")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.get("/health")
async def health_check(request: Request):
    """OSINT Planning Service 헬스 체크 결과를 반환합니다."""
    return await proxy_request(request, "health")

@router.get("/")
async def root(request: Request):
    """Planning 서비스의 루트(plans 루트)를 프록시합니다."""
    return await proxy_request(request, PLANNING_BASE_PATH)

@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def catch_all(path: str, request: Request):
    """
    명시되지 않은 OSINT Planning 서비스 경로를 모두 프록시합니다.

    Args:
        path: 전달할 세부 경로
        request: 현재 요청 객체

    Returns:
        FastAPI JSONResponse: Planning 서비스 응답
    """
    return await proxy_request(request, path)


@plans_alias_router.api_route("/planning", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def planning_root_alias(request: Request):
    """
    /api/v1/osint/planning 루트 요청을 실제 Planning 서비스 표준 경로로 전달합니다.

    Args:
        request: 현재 요청 객체

    Returns:
        FastAPI JSONResponse: Planning 서비스 응답
    """
    return await proxy_request(request, PLANNING_BASE_PATH)


@plans_alias_router.api_route("/planning/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def planning_alias_catch_all(path: str, request: Request):
    """
    /api/v1/osint/planning/* 하위 경로를 Planning 서비스 api/v1/plans/* 경로로 매핑합니다.

    Args:
        path: planning 이하 세부 경로
        request: 현재 요청 객체

    Returns:
        FastAPI JSONResponse: Planning 서비스 응답
    """
    forward_path = f"{PLANNING_BASE_PATH}/{path}" if path else PLANNING_BASE_PATH
    return await proxy_request(request, forward_path)