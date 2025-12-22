"""
LLM Provider Settings Router - 관리자 전역 LLM 설정 API 엔드포인트
"""

import os
from enum import Enum
from typing import Optional
from datetime import datetime

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
    get_current_user_optional,
    require_role,
)

router = APIRouter(prefix="/llm-providers", tags=["LLM Providers"])


# ============================================================================
# Schemas
# ============================================================================


class LlmProviderType(str, Enum):
    OPENAI = "OPENAI"
    ANTHROPIC = "ANTHROPIC"
    GOOGLE = "GOOGLE"
    OPENROUTER = "OPENROUTER"
    OLLAMA = "OLLAMA"
    AZURE_OPENAI = "AZURE_OPENAI"
    TOGETHER_AI = "TOGETHER_AI"
    CUSTOM = "CUSTOM"


class LlmProviderTypeInfo(BaseModel):
    value: LlmProviderType
    displayName: str
    description: str
    requiresApiKey: bool
    defaultBaseUrl: Optional[str] = None


class LlmProviderSettingsRequest(BaseModel):
    providerType: LlmProviderType
    apiKey: Optional[str] = Field(None, description="API 키 (비우면 기존 값 유지)")
    defaultModel: str = Field(..., description="기본 모델")
    baseUrl: Optional[str] = Field(None, description="Base URL (Ollama/Custom용)")
    enabled: bool = Field(True, description="활성화 여부")
    priority: int = Field(100, ge=1, le=999, description="우선순위")
    maxTokens: int = Field(4096, ge=1, le=128000, description="최대 토큰")
    temperature: float = Field(0.7, ge=0, le=2, description="Temperature")
    timeoutMs: int = Field(60000, ge=1000, le=300000, description="타임아웃 (ms)")
    azureDeploymentName: Optional[str] = Field(
        None, description="Azure deployment name"
    )
    azureApiVersion: Optional[str] = Field(None, description="Azure API version")


class LlmProviderSettings(BaseModel):
    id: int
    providerType: LlmProviderType
    userId: Optional[str] = None  # null = global setting
    hasApiKey: bool
    maskedApiKey: Optional[str] = None
    defaultModel: str
    baseUrl: Optional[str] = None
    enabled: bool
    priority: int
    maxTokens: int
    temperature: float
    timeoutMs: int
    azureDeploymentName: Optional[str] = None
    azureApiVersion: Optional[str] = None
    lastTestedAt: Optional[datetime] = None
    lastTestSuccess: Optional[bool] = None
    createdAt: datetime
    updatedAt: datetime


class LlmTestResult(BaseModel):
    providerType: LlmProviderType
    success: bool
    message: str
    latencyMs: Optional[int] = None
    testedAt: datetime


# Provider metadata (2025년 12월 최신)
LLM_PROVIDER_TYPES = [
    LlmProviderTypeInfo(
        value=LlmProviderType.OPENAI,
        displayName="OpenAI",
        description="GPT-5, GPT-4.1, o3/o4 추론 모델",
        requiresApiKey=True,
    ),
    LlmProviderTypeInfo(
        value=LlmProviderType.ANTHROPIC,
        displayName="Anthropic",
        description="Claude 4 Sonnet/Opus/Haiku",
        requiresApiKey=True,
    ),
    LlmProviderTypeInfo(
        value=LlmProviderType.GOOGLE,
        displayName="Google AI",
        description="Gemini 3 Pro, Gemini 2.5 Pro/Flash",
        requiresApiKey=True,
    ),
    LlmProviderTypeInfo(
        value=LlmProviderType.OPENROUTER,
        displayName="OpenRouter",
        description="125+ 모델 통합 API (무료 모델 포함)",
        requiresApiKey=True,
    ),
    LlmProviderTypeInfo(
        value=LlmProviderType.OLLAMA,
        displayName="Ollama",
        description="로컬 LLM 실행 (Llama 3.2, DeepSeek R1)",
        requiresApiKey=False,
        defaultBaseUrl="http://localhost:11434",
    ),
    LlmProviderTypeInfo(
        value=LlmProviderType.AZURE_OPENAI,
        displayName="Azure OpenAI",
        description="Azure에서 호스팅하는 OpenAI 모델",
        requiresApiKey=True,
    ),
    LlmProviderTypeInfo(
        value=LlmProviderType.TOGETHER_AI,
        displayName="Together AI",
        description="DeepSeek R1, Llama 405B 등 오픈소스 모델",
        requiresApiKey=True,
        defaultBaseUrl="https://api.together.xyz/v1",
    ),
    LlmProviderTypeInfo(
        value=LlmProviderType.CUSTOM,
        displayName="Custom API",
        description="OpenAI 호환 커스텀 API",
        requiresApiKey=False,
    ),
]


# Backend service URL for data-collection-service
COLLECTOR_SERVICE_URL = os.environ.get("COLLECTOR_SERVICE_URL", "http://localhost:8081")


# ============================================================================
# Helper functions
# ============================================================================


async def call_collector_service(
    method: str,
    path: str,
    params: Optional[dict] = None,
    json_data: Optional[dict] = None,
) -> dict:
    """Call the data-collection-service API"""
    url = f"{COLLECTOR_SERVICE_URL}{path}"

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


# ============================================================================
# Endpoints
# ============================================================================


@router.get("/types", response_model=list[LlmProviderTypeInfo])
async def list_provider_types(
    current_user=Depends(get_current_user_optional),
):
    """LLM Provider 타입 목록 조회 - 인증 선택적"""
    return LLM_PROVIDER_TYPES


@router.get("/global", response_model=list[LlmProviderSettings])
async def list_global_settings(
    current_user=Depends(get_current_user_optional),
):
    """전역 LLM 설정 목록 조회 - 비인증 사용자는 빈 목록 반환"""
    # 비인증 사용자 또는 ADMIN이 아닌 경우 빈 목록 반환
    if current_user.id == "anonymous" or current_user.role != UserRole.ADMIN:
        return []
    result = await call_collector_service("GET", "/api/v1/admin/llm-providers")
    return result


@router.get("/global/{provider_type}", response_model=LlmProviderSettings)
async def get_global_setting(
    provider_type: LlmProviderType,
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """특정 Provider의 전역 설정 조회 (Admin 권한 필요)"""
    result = await call_collector_service(
        "GET", f"/api/v1/admin/llm-providers/{provider_type.value}"
    )
    return result


@router.put("/global/{provider_type}", response_model=LlmProviderSettings)
async def save_global_setting(
    provider_type: LlmProviderType,
    data: LlmProviderSettingsRequest,
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """전역 LLM 설정 저장/수정 (Admin 권한 필요)"""
    # Ensure provider type matches
    if data.providerType != provider_type:
        raise HTTPException(
            status_code=400,
            detail="Provider type in path must match request body",
        )

    result = await call_collector_service(
        "PUT",
        f"/api/v1/admin/llm-providers/{provider_type.value}",
        json_data=data.model_dump(exclude_none=True),
    )

    # Audit log
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.UPDATE,
        resource_type="llm_provider",
        resource_id=provider_type.value,
        resource_name=f"Global {provider_type.value} Settings",
        details={
            "provider": provider_type.value,
            "enabled": data.enabled,
            "model": data.defaultModel,
        },
    )

    return result


@router.delete("/global/{provider_type}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_global_setting(
    provider_type: LlmProviderType,
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """전역 LLM 설정 삭제 (Admin 권한 필요)"""
    await call_collector_service(
        "DELETE", f"/api/v1/admin/llm-providers/{provider_type.value}"
    )

    # Audit log
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.DELETE,
        resource_type="llm_provider",
        resource_id=provider_type.value,
        resource_name=f"Global {provider_type.value} Settings",
    )


@router.post("/test", response_model=LlmTestResult)
async def test_connection(
    provider_type: LlmProviderType = Query(..., description="Provider 타입"),
    model: Optional[str] = Query(None, description="테스트할 모델"),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """LLM Provider 연결 테스트 (Admin 권한 필요)"""
    params = {"providerType": provider_type.value}
    if model:
        params["model"] = model

    result = await call_collector_service(
        "POST", "/api/v1/llm-providers/test", params=params
    )
    return result


@router.get("/effective", response_model=list[LlmProviderSettings])
async def get_effective_settings(
    user_id: Optional[str] = Query(None, description="사용자 ID (없으면 전역만)"),
    current_user=Depends(get_current_user_optional),
):
    """유효 LLM 설정 조회 (사용자 설정 + 전역 fallback) - 인증 선택적"""
    params = {}
    if user_id:
        params["userId"] = user_id

    result = await call_collector_service(
        "GET", "/api/v1/llm-providers/effective", params=params
    )
    return result


@router.get("/enabled", response_model=list[LlmProviderSettings])
async def get_enabled_providers(
    user_id: Optional[str] = Query(None, description="사용자 ID"),
    current_user=Depends(get_current_user_optional),
):
    """활성화된 LLM Provider 목록 조회 - 인증 선택적"""
    params = {}
    if user_id:
        params["userId"] = user_id

    result = await call_collector_service(
        "GET", "/api/v1/llm-providers/enabled", params=params
    )
    return result
