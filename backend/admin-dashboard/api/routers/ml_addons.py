"""
ML Addons Router - ML 애드온 관리 API 엔드포인트
"""

import os
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from ..models.schemas import (
    AuditAction,
    UserRole,
)
from ..dependencies import (
    get_audit_service,
    get_current_user,
    require_role,
)

router = APIRouter(prefix="/ml-addons", tags=["ML Addons"])


# ============================================================================
# Configuration
# ============================================================================

CRAWLER_SERVICE_URL = os.environ.get(
    "CRAWLER_SERVICE_URL", "http://autonomous-crawler:8030"
)


# ============================================================================
# Schemas
# ============================================================================


class MLAddonType(str, Enum):
    """ML Addon 타입"""

    SENTIMENT = "sentiment"
    FACTCHECK = "factcheck"
    BIAS = "bias"


class MLAddonStatus(str, Enum):
    """ML Addon 상태"""

    HEALTHY = "healthy"
    UNHEALTHY = "unhealthy"
    UNKNOWN = "unknown"
    WARMING_UP = "warming_up"


class MLAddonInfo(BaseModel):
    """ML Addon 정보"""

    key: str
    name: str
    description: str
    endpoint: str
    status: MLAddonStatus
    features: List[str]


class MLAddonHealthResponse(BaseModel):
    """ML Addon 헬스 응답"""

    status: str
    auto_analysis_enabled: bool
    addons: Dict[str, Dict[str, Any]]


class MLAddonStatusResponse(BaseModel):
    """ML Addon 상태 응답"""

    auto_analysis_enabled: bool
    parallel_analysis: bool
    addons: Dict[str, Any]


class MLAnalyzeRequest(BaseModel):
    """ML 분석 요청"""

    article_id: int = Field(..., description="기사 ID")
    title: str = Field(..., description="기사 제목", min_length=1)
    content: str = Field(..., description="기사 본문", min_length=10)
    source: Optional[str] = Field(default=None, description="언론사명")
    url: Optional[str] = Field(default=None, description="기사 URL")
    published_at: Optional[str] = Field(default=None, description="발행일")
    addons: Optional[List[str]] = Field(
        default=None,
        description="실행할 애드온 목록 (sentiment, factcheck, bias). None이면 모두 실행",
    )
    save_to_db: bool = Field(default=True, description="결과를 DB에 저장할지 여부")


class MLBatchAnalyzeRequest(BaseModel):
    """ML 배치 분석 요청"""

    articles: List[MLAnalyzeRequest] = Field(..., min_length=1, max_length=50)
    addons: Optional[List[str]] = None
    save_to_db: bool = True
    max_concurrent: int = Field(default=5, ge=1, le=20)


class MLAnalysisResult(BaseModel):
    """ML 분석 결과"""

    addon_type: str
    success: bool
    request_id: str
    results: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    latency_ms: int = 0
    analyzed_at: str


class BatchAnalysisResult(BaseModel):
    """배치 분석 결과"""

    article_id: int
    sentiment: Optional[MLAnalysisResult] = None
    factcheck: Optional[MLAnalysisResult] = None
    bias: Optional[MLAnalysisResult] = None
    total_latency_ms: int = 0
    success_count: int = 0
    failure_count: int = 0


class MLAddonDBEntry(BaseModel):
    """DB에 저장된 ML Addon 정보"""

    id: int
    addon_key: str
    name: str
    description: Optional[str] = None
    endpoint_url: str
    version: Optional[str] = None
    status: str
    config: Optional[Dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime


class MLAddonCreateRequest(BaseModel):
    """ML Addon 생성 요청"""

    addon_key: str = Field(..., description="고유 키 (예: sentiment-addon)")
    name: str = Field(..., description="표시 이름")
    description: Optional[str] = Field(None, description="설명")
    endpoint_url: str = Field(..., description="서비스 URL")
    version: Optional[str] = Field(None, description="버전")
    config: Optional[Dict[str, Any]] = Field(None, description="추가 설정")


class MLAddonUpdateRequest(BaseModel):
    """ML Addon 수정 요청"""

    name: Optional[str] = None
    description: Optional[str] = None
    endpoint_url: Optional[str] = None
    version: Optional[str] = None
    status: Optional[str] = None
    config: Optional[Dict[str, Any]] = None


# ============================================================================
# Helper functions
# ============================================================================


async def call_crawler_service(
    method: str,
    path: str,
    params: Optional[dict] = None,
    json_data: Optional[dict] = None,
    timeout: float = 60.0,
) -> dict:
    """Call the autonomous-crawler-service API"""
    url = f"{CRAWLER_SERVICE_URL}{path}"

    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.request(
                method=method,
                url=url,
                params=params,
                json=json_data,
            )

            if response.status_code >= 400:
                detail = (
                    response.json().get("detail", response.text)
                    if response.text
                    else "Unknown error"
                )
                raise HTTPException(
                    status_code=response.status_code,
                    detail=detail,
                )

            if response.status_code == 204:
                return {}

            return response.json()
        except httpx.RequestError as e:
            raise HTTPException(
                status_code=503,
                detail=f"Crawler service unavailable: {str(e)}",
            )


# ============================================================================
# Endpoints - Health & Status
# ============================================================================


@router.get("/health", response_model=MLAddonHealthResponse)
async def ml_health_check(
    current_user=Depends(get_current_user),
):
    """
    ML 시스템 헬스체크.

    모든 ML Addon의 상태를 확인합니다.
    """
    result = await call_crawler_service("GET", "/ml/health")
    return result


@router.get("/status", response_model=MLAddonStatusResponse)
async def ml_status(
    current_user=Depends(get_current_user),
):
    """
    ML 시스템 상태 조회.

    현재 설정 및 Addon 연결 상태를 반환합니다.
    """
    result = await call_crawler_service("GET", "/ml/status")
    return result


@router.get("/list", response_model=Dict[str, Any])
async def list_addons(
    current_user=Depends(get_current_user),
):
    """
    사용 가능한 ML Addon 목록.

    각 애드온의 기능과 현재 상태를 반환합니다.
    """
    result = await call_crawler_service("GET", "/ml/addons")
    return result


# ============================================================================
# Endpoints - Analysis
# ============================================================================


@router.post("/analyze", response_model=BatchAnalysisResult)
async def analyze_article(
    request: MLAnalyzeRequest,
    current_user=Depends(get_current_user),
):
    """
    단일 기사 ML 분석.

    기사에 대해 sentiment, factcheck, bias 분석을 수행합니다.
    """
    result = await call_crawler_service(
        "POST",
        "/ml/analyze",
        json_data=request.model_dump(exclude_none=True),
        timeout=120.0,
    )
    return result


@router.post("/analyze/simple")
async def analyze_text_simple(
    text: str = Query(..., min_length=10, description="분석할 텍스트"),
    source: Optional[str] = Query(None, description="출처"),
    addons: Optional[str] = Query(None, description="애드온 (쉼표 구분)"),
    current_user=Depends(get_current_user),
):
    """
    간단한 텍스트 ML 분석.

    기사 ID 없이 텍스트만으로 분석을 수행합니다.
    결과는 DB에 저장되지 않습니다.
    """
    addon_list = addons.split(",") if addons else None

    result = await call_crawler_service(
        "POST",
        "/ml/analyze/simple",
        json_data={
            "text": text,
            "source": source,
            "addons": addon_list,
        },
        timeout=120.0,
    )
    return result


@router.post("/analyze/batch")
async def analyze_batch(
    request: MLBatchAnalyzeRequest,
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """
    배치 기사 ML 분석.

    여러 기사를 한 번에 분석합니다. (Admin 권한 필요)
    """
    result = await call_crawler_service(
        "POST",
        "/ml/analyze/batch",
        json_data=request.model_dump(exclude_none=True),
        timeout=300.0,
    )
    return result


@router.post("/analyze/url")
async def analyze_url(
    url: str = Query(..., description="분석할 URL"),
    current_user=Depends(get_current_user),
):
    """
    URL에서 기사를 크롤링하고 ML 분석 수행.

    URL의 콘텐츠를 추출한 후 sentiment, factcheck, bias 분석을 수행합니다.
    """
    result = await call_crawler_service(
        "POST",
        "/ml/analyze/url",
        params={"url": url},
        timeout=120.0,
    )
    return result


# ============================================================================
# Endpoints - Configuration
# ============================================================================


@router.post("/config/toggle")
async def toggle_auto_analysis(
    enabled: bool = Query(..., description="자동 분석 활성화 여부"),
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """
    자동 ML 분석 토글.

    크롤링 후 자동 ML 분석 기능을 활성화/비활성화합니다. (Admin 권한 필요)
    """
    result = await call_crawler_service(
        "POST",
        "/ml/config/toggle",
        params={"enabled": enabled},
    )

    # Audit log
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.UPDATE,
        resource_type="ml_config",
        resource_id="auto_analysis",
        resource_name="ML Auto Analysis",
        details={"enabled": enabled},
    )

    return result


# ============================================================================
# Endpoints - CRUD for ml_addon table (via collector service)
# ============================================================================

COLLECTOR_SERVICE_URL_DB = os.environ.get(
    "COLLECTOR_SERVICE_URL", "http://localhost:8081"
)


async def call_collector_service_db(
    method: str,
    path: str,
    params: Optional[dict] = None,
    json_data: Optional[dict] = None,
) -> dict:
    """Call the data-collection-service API for DB operations"""
    url = f"{COLLECTOR_SERVICE_URL_DB}{path}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.request(
                method=method,
                url=url,
                params=params,
                json=json_data,
            )

            if response.status_code >= 400:
                detail = (
                    response.json().get("message", response.text)
                    if response.text
                    else "Unknown error"
                )
                raise HTTPException(
                    status_code=response.status_code,
                    detail=detail,
                )

            if response.status_code == 204:
                return {}

            return response.json()
        except httpx.RequestError as e:
            raise HTTPException(
                status_code=503,
                detail=f"Collector service unavailable: {str(e)}",
            )


@router.get("/registered", response_model=List[MLAddonDBEntry])
async def list_registered_addons(
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """
    DB에 등록된 ML Addon 목록 조회 (Admin 권한 필요)
    """
    result = await call_collector_service_db("GET", "/api/v1/admin/ml-addons")
    return result


@router.get("/registered/{addon_id}", response_model=MLAddonDBEntry)
async def get_registered_addon(
    addon_id: int,
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """
    특정 ML Addon 조회 (Admin 권한 필요)
    """
    result = await call_collector_service_db(
        "GET", f"/api/v1/admin/ml-addons/{addon_id}"
    )
    return result


@router.post(
    "/registered", response_model=MLAddonDBEntry, status_code=status.HTTP_201_CREATED
)
async def create_addon(
    request: MLAddonCreateRequest,
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """
    새 ML Addon 등록 (Admin 권한 필요)
    """
    result = await call_collector_service_db(
        "POST",
        "/api/v1/admin/ml-addons",
        json_data=request.model_dump(exclude_none=True),
    )

    # Audit log
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.CREATE,
        resource_type="ml_addon",
        resource_id=request.addon_key,
        resource_name=request.name,
        details={"endpoint": request.endpoint_url},
    )

    return result


@router.put("/registered/{addon_id}", response_model=MLAddonDBEntry)
async def update_addon(
    addon_id: int,
    request: MLAddonUpdateRequest,
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """
    ML Addon 수정 (Admin 권한 필요)
    """
    result = await call_collector_service_db(
        "PUT",
        f"/api/v1/admin/ml-addons/{addon_id}",
        json_data=request.model_dump(exclude_none=True),
    )

    # Audit log
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.UPDATE,
        resource_type="ml_addon",
        resource_id=str(addon_id),
        resource_name=result.get("name", f"Addon {addon_id}"),
        details=request.model_dump(exclude_none=True),
    )

    return result


@router.delete("/registered/{addon_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_addon(
    addon_id: int,
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """
    ML Addon 삭제 (Admin 권한 필요)
    """
    await call_collector_service_db("DELETE", f"/api/v1/admin/ml-addons/{addon_id}")

    # Audit log
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.DELETE,
        resource_type="ml_addon",
        resource_id=str(addon_id),
        resource_name=f"Addon {addon_id}",
    )


@router.post("/registered/{addon_id}/test")
async def test_addon(
    addon_id: int,
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """
    ML Addon 연결 테스트 (Admin 권한 필요)
    """
    result = await call_collector_service_db(
        "POST", f"/api/v1/admin/ml-addons/{addon_id}/test"
    )
    return result
