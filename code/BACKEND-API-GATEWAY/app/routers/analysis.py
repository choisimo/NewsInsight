"""
Analysis Service 프록시 라우터

분석 서비스로의 요청을 프록시하는 라우터 모듈입니다.
감성 분석, 트렌드 분석, 리포트 생성 등의 요청을 처리합니다.
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
import httpx
from app.config import settings

# 라우터 인스턴스 생성
router = APIRouter()

async def proxy_request(request: Request, path: str = ""):
    """
    Analysis Service로 요청을 프록시하는 핵심 함수
    
    들어온 요청을 그대로 Analysis Service로 전달하고,
    응답을 클라이언트에게 반환합니다.
    
    Args:
        request: FastAPI Request 객체
        path: 요청 경로 (API Gateway 프리픽스 제외)
        
    Returns:
        JSONResponse: Analysis Service의 응답
        
    Raises:
        HTTPException: 프록시 요청 실패 시
    """
    # /api/v1/analysis 프리픽스 제거 (이미 라우터에서 처리됨)
    # Backend expects /api/v1 prefix for all analysis routes except root/health
    if not path:
        target_path = ""
    elif path == "health":
        target_path = "health"
    elif path.startswith("api/"):
        target_path = path
    else:
        target_path = f"api/v1/{path}"
    
    # 목적지 URL 구성
    target_url = f"{settings.ANALYSIS_SERVICE_URL}/{target_path}"
    
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
        raise HTTPException(status_code=504, detail="Analysis service timeout")
    except httpx.ConnectError:
        # 연결 실패 시 503 Service Unavailable 반환
        raise HTTPException(status_code=503, detail="Analysis service unavailable")
    except Exception as e:
        # 기타 예외 발생 시 500 Internal Server Error 반환
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

# =============================================================================
# Analysis Service 엔드포인트 정의
# =============================================================================

@router.get("/health")
async def health_check(request: Request):
    """
    Analysis Service 헬스 체크
    
    서비스의 상태를 확인합니다.
    """
    return await proxy_request(request, "health")

@router.get("/")
async def root(request: Request):
    """
    Analysis Service 루트 엔드포인트
    
    서비스 정보를 반환합니다.
    """
    return await proxy_request(request, "")

# -----------------------------------------------------------------------------
# 감성 분석 관련 라우트
# -----------------------------------------------------------------------------

@router.post("/sentiment/analyze")
async def analyze_sentiment(request: Request):
    """
    텍스트 감성 분석
    
    입력된 텍스트의 감성(긍정/부정/중립)을 분석합니다.
    """
    return await proxy_request(request, "sentiment/analyze")

@router.get("/sentiment/history")
async def get_sentiment_history(request: Request):
    """
    감성 분석 히스토리 조회
    
    과거에 수행된 감성 분석 결과를 조회합니다.
    """
    return await proxy_request(request, "sentiment/history")

@router.get("/sentiment/stats")
async def get_sentiment_stats(request: Request):
    """
    감성 통계 조회
    
    전체 감성 분석에 대한 통계 정보를 제공합니다.
    """
    return await proxy_request(request, "sentiment/stats")

# -----------------------------------------------------------------------------
# 트렌드 분석 관련 라우트
# -----------------------------------------------------------------------------

@router.post("/trends/analyze")
async def analyze_trends(request: Request):
    """
    데이터 트렌드 분석
    
    시계열 데이터의 트렌드를 분석합니다.
    """
    return await proxy_request(request, "trends/analyze")

@router.get("/trends/history")
async def get_trend_history(request: Request):
    """
    트렌드 분석 히스토리 조회
    
    과거 트렌드 분석 결과를 조회합니다.
    """
    return await proxy_request(request, "trends/history")

@router.get("/trends/current")
async def get_current_trends(request: Request):
    """
    현재 트렌드 조회
    
    현재 트렌듩중인 주제들을 조회합니다.
    """
    return await proxy_request(request, "trends/current")

# -----------------------------------------------------------------------------
# 리포트 관련 라우트
# -----------------------------------------------------------------------------

@router.post("/reports/generate")
async def generate_report(request: Request):
    """
    분석 리포트 생성
    
    분석 결과를 기반으로 종합 리포트를 생성합니다.
    """
    return await proxy_request(request, "reports/generate")

@router.get("/reports/{report_id}")
async def get_report(report_id: str, request: Request):
    """
    특정 리포트 조회
    
    Args:
        report_id: 리포트 ID
        request: HTTP 요청 객체
    
    Returns:
        지정된 리포트의 상세 정보
    """
    return await proxy_request(request, f"reports/{report_id}")

@router.get("/reports")
async def list_reports(request: Request):
    """
    리포트 목록 조회
    
    생성된 모든 리포트의 목록을 조회합니다.
    """
    return await proxy_request(request, "reports")

@router.delete("/reports/{report_id}")
async def delete_report(report_id: str, request: Request):
    """
    리포트 삭제
    
    Args:
        report_id: 삭제할 리포트 ID
        request: HTTP 요청 객체
    
    Returns:
        삭제 결과
    """
    return await proxy_request(request, f"reports/{report_id}")

# -----------------------------------------------------------------------------
# ML 모델 관련 라우트
# -----------------------------------------------------------------------------

@router.post("/models/train")
async def train_model(request: Request):
    """
    ML 모델 학습
    
    새로운 데이터로 ML 모델을 학습시킵니다.
    """
    return await proxy_request(request, "models/train")

@router.get("/models/status")
async def get_model_status(request: Request):
    """
    모델 학습 상태 확인
    
    현재 진행 중인 모델 학습의 상태를 확인합니다.
    """
    return await proxy_request(request, "models/status")

@router.get("/models")
async def list_models(request: Request):
    """
    사용 가능한 모델 목록
    
    현재 사용 가능한 모든 ML 모델의 목록을 조회합니다.
    """
    return await proxy_request(request, "models")

@router.post("/models/{model_id}/predict")
async def predict_with_model(model_id: str, request: Request):
    """
    특정 모델로 예측
    
    Args:
        model_id: 사용할 모델 ID
        request: HTTP 요청 객체 (예측할 데이터 포함)
    
    Returns:
        예측 결과
    """
    return await proxy_request(request, f"models/{model_id}/predict")

# -----------------------------------------------------------------------------
# Catch-all 라우트 (기타 모든 엔드포인트 처리)
# -----------------------------------------------------------------------------

@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def catch_all(path: str, request: Request):
    """
    Catch-all 라우트
    
    명시적으로 정의되지 않은 Analysis Service의 엔드포인트를
    동적으로 프록시합니다. 이를 통해 새로운 엔드포인트가 추가되어도
    Gateway 코드 수정 없이 사용할 수 있습니다.
    
    Args:
        path: 요청 경로
        request: HTTP 요청 객체
    
    Returns:
        Analysis Service의 응답
    """
    return await proxy_request(request, path)