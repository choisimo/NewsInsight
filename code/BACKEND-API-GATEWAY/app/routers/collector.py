from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
import httpx
from app.config import settings

router = APIRouter()

async def proxy_request(request: Request, path: str = ""):
    """
    Collector 서비스로 요청을 프록시합니다.

    Args:
        request: 클라이언트에서 들어온 FastAPI Request 객체
        path: Collector 서비스에 전달할 하위 경로

    Returns:
        FastAPI JSONResponse: Collector 서비스의 응답

    Raises:
        HTTPException: 타임아웃, 연결 실패, 미지원 메서드 등 예외 상황 발생 시
    """
    # Remove the /api/v1/collector prefix from the path
    target_path = path if path else ""
    
    # Build the target URL
    target_url = f"{settings.COLLECTOR_SERVICE_URL}/{target_path}"
    
    # Get the request method and prepare headers
    method = request.method
    headers = dict(request.headers)
    
    # Remove host header to avoid conflicts
    headers.pop("host", None)
    
    try:
        async with httpx.AsyncClient(timeout=settings.DEFAULT_TIMEOUT) as client:
            # Handle different HTTP methods
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
            
            # Return the response from the target service
            return JSONResponse(
                content=response.json() if response.headers.get("content-type", "").startswith("application/json") else response.text,
                status_code=response.status_code,
                headers=dict(response.headers)
            )
            
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Collector service timeout")
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Collector service unavailable")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

# Collector Service Endpoints

@router.get("/health")
async def health_check(request: Request):
    """Collector 서비스 헬스 체크 결과를 반환합니다."""
    return await proxy_request(request, "health")

@router.get("/")
async def root(request: Request):
    """Collector 서비스 루트 엔드포인트 응답을 프록시합니다."""
    return await proxy_request(request, "")

# Data Source Management Routes
@router.post("/sources")
async def create_source(request: Request):
    """새로운 데이터 소스 생성 요청을 전달합니다."""
    return await proxy_request(request, "sources")

@router.get("/sources")
async def list_sources(request: Request):
    """모든 데이터 소스 목록을 조회합니다."""
    return await proxy_request(request, "sources")

@router.get("/sources/{source_id}")
async def get_source(source_id: str, request: Request):
    """지정한 ID의 데이터 소스 정보를 조회합니다."""
    return await proxy_request(request, f"sources/{source_id}")

@router.put("/sources/{source_id}")
async def update_source(source_id: str, request: Request):
    """특정 데이터 소스 정보를 업데이트합니다."""
    return await proxy_request(request, f"sources/{source_id}")

@router.delete("/sources/{source_id}")
async def delete_source(source_id: str, request: Request):
    """지정한 데이터 소스를 삭제합니다."""
    return await proxy_request(request, f"sources/{source_id}")

@router.post("/sources/{source_id}/test")
async def test_source(source_id: str, request: Request):
    """특정 데이터 소스 연결을 테스트합니다."""
    return await proxy_request(request, f"sources/{source_id}/test")

@router.post("/sources/{source_id}/enable")
async def enable_source(source_id: str, request: Request):
    """특정 데이터 소스를 활성화합니다."""
    return await proxy_request(request, f"sources/{source_id}/enable")

@router.post("/sources/{source_id}/disable")
async def disable_source(source_id: str, request: Request):
    """특정 데이터 소스를 비활성화합니다."""
    return await proxy_request(request, f"sources/{source_id}/disable")

# Collection Management Routes
@router.post("/collections/start")
async def start_collection(request: Request):
    """데이터 수집 작업을 시작합니다."""
    return await proxy_request(request, "collections/start")

@router.post("/collections/stop")
async def stop_collection(request: Request):
    """데이터 수집 작업을 중단합니다."""
    return await proxy_request(request, "collections/stop")

@router.get("/collections/status")
async def get_collection_status(request: Request):
    """데이터 수집 상태를 조회합니다."""
    return await proxy_request(request, "collections/status")

@router.get("/collections/stats")
async def get_collection_stats(request: Request):
    """데이터 수집 통계를 조회합니다."""
    return await proxy_request(request, "collections/stats")

@router.get("/collections/history")
async def get_collection_history(request: Request):
    """데이터 수집 이력을 조회합니다."""
    return await proxy_request(request, "collections/history")

@router.get("/collections/jobs")
async def list_collection_jobs(request: Request):
    """수집 잡 목록을 반환합니다."""
    return await proxy_request(request, "collections/jobs")

@router.get("/collections/jobs/{job_id}")
async def get_collection_job(job_id: str, request: Request):
    """지정한 수집 잡 상세 정보를 조회합니다."""
    return await proxy_request(request, f"collections/jobs/{job_id}")

@router.delete("/collections/jobs/{job_id}")
async def cancel_collection_job(job_id: str, request: Request):
    """특정 수집 잡을 취소합니다."""
    return await proxy_request(request, f"collections/jobs/{job_id}")

# Data Feed Management Routes
@router.get("/feeds")
async def list_feeds(request: Request):
    """모든 데이터 피드 목록을 조회합니다."""
    return await proxy_request(request, "feeds")

@router.get("/feeds/{feed_id}")
async def get_feed(feed_id: str, request: Request):
    """지정한 데이터 피드 정보를 조회합니다."""
    return await proxy_request(request, f"feeds/{feed_id}")

@router.get("/feeds/{feed_id}/data")
async def get_feed_data(feed_id: str, request: Request):
    """특정 데이터 피드의 수집 데이터를 반환합니다."""
    return await proxy_request(request, f"feeds/{feed_id}/data")

@router.post("/feeds/{feed_id}/refresh")
async def refresh_feed(feed_id: str, request: Request):
    """특정 데이터 피드를 새로 고칩니다."""
    return await proxy_request(request, f"feeds/{feed_id}/refresh")

# Catch-all route for any other endpoints
@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def catch_all(path: str, request: Request):
    """명시되지 않은 Collector 서비스 경로를 모두 프록시합니다."""
    return await proxy_request(request, path)