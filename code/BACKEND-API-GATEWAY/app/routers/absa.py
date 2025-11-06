from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
import httpx
from app.config import settings

router = APIRouter()

async def proxy_request(request: Request, path: str = ""):
    """
    ABSA 서비스로 요청을 프록시합니다.

    Args:
        request: 클라이언트에서 들어온 FastAPI Request 객체
        path: ABSA 서비스로 전달할 하위 경로

    Returns:
        FastAPI JSONResponse: 대상 서비스의 응답을 그대로 전달

    Raises:
        HTTPException: 타임아웃·연결 오류·지원하지 않는 메서드 등 실패 상황
    """
    # Personas endpoints are mounted under /api/v1/personas in backend
    if not path:
        target_path = ""
    elif path.startswith("personas"):
        target_path = f"api/v1/{path}"
    else:
        target_path = path

    target_url = f"{settings.ABSA_SERVICE_URL}/{target_path}"

    method = request.method
    headers = dict(request.headers)

    # Remove host header to avoid conflicts
    headers.pop("host", None)

    try:
        async with httpx.AsyncClient(timeout=settings.DEFAULT_TIMEOUT) as client:
            if method == "GET":
                response = await client.get(
                    target_url,
                    headers=headers,
                    params=request.query_params
                )
            elif method == "POST":
                body = await request.body()
                response = await client.post(
                    target_url,
                    headers=headers,
                    params=request.query_params,
                    content=body
                )
            elif method == "PUT":
                body = await request.body()
                response = await client.put(
                    target_url,
                    headers=headers,
                    params=request.query_params,
                    content=body
                )
            elif method == "DELETE":
                response = await client.delete(
                    target_url,
                    headers=headers,
                    params=request.query_params
                )
            elif method == "PATCH":
                body = await request.body()
                response = await client.patch(
                    target_url,
                    headers=headers,
                    params=request.query_params,
                    content=body
                )
            else:
                raise HTTPException(status_code=405, detail="Method not allowed")

            return JSONResponse(
                content=response.json() if response.headers.get("content-type", "").startswith("application/json") else response.text,
                status_code=response.status_code,
                headers=dict(response.headers)
            )

    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="ABSA service timeout")
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="ABSA service unavailable")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

# ABSA Service Endpoints

@router.get("/health")
async def health_check(request: Request):
    """ABSA 서비스 헬스 체크 결과를 반환합니다."""
    return await proxy_request(request, "health")

@router.get("/")
async def root(request: Request):
    """ABSA 서비스 루트 엔드포인트 응답을 프록시합니다."""
    return await proxy_request(request, "")

# Aspect routes (backend provides extract/list/create)
@router.post("/aspects/extract")
async def extract_aspects(request: Request):
    """텍스트에서 Aspect 정보를 추출합니다."""
    return await proxy_request(request, "aspects/extract")

@router.get("/aspects")
async def list_aspects(request: Request):
    """사용 가능한 Aspect 모델 목록을 조회합니다."""
    return await proxy_request(request, "aspects/list")

@router.post("/aspects/create")
async def create_aspect(request: Request):
    """새로운 Aspect 모델을 생성합니다."""
    return await proxy_request(request, "aspects/create")

# Analysis routes (align with backend: analyze, batch, history/{content_id})
@router.post("/analysis/analyze")
async def analyze_text(request: Request):
    """지정된 텍스트에 대해 ABSA 분석을 수행합니다."""
    return await proxy_request(request, "analysis/analyze")

# Backward-compat: map previous 'full' to 'analyze'
@router.post("/analysis/full")
async def full_analysis(request: Request):
    """ABSA 분석을 수행하는 별칭 엔드포인트입니다."""
    return await proxy_request(request, "analysis/analyze")

@router.post("/analysis/batch")
async def batch_analysis(request: Request):
    """다수 텍스트에 대한 일괄 ABSA 분석을 실행합니다."""
    return await proxy_request(request, "analysis/batch")

@router.get("/analysis/history/{content_id}")
async def get_analysis_history(content_id: str, request: Request):
    """특정 content_id에 대한 ABSA 분석 이력을 조회합니다."""
    return await proxy_request(request, f"analysis/history/{content_id}")

# Catch-all route for any other endpoints
@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def catch_all(path: str, request: Request):
    """명시되지 않은 ABSA 서비스 경로를 모두 프록시합니다."""
    return await proxy_request(request, path)
