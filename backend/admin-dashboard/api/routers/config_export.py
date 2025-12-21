"""
Config Export/Import Router - 관리자 설정 Export/Import API 엔드포인트
LLM Provider, ML Addon 등 시스템 설정을 JSON으로 일괄 관리
"""

import os
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse
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

router = APIRouter(prefix="/config-export", tags=["Config Export/Import"])


# ============================================================================
# Configuration
# ============================================================================

COLLECTOR_SERVICE_URL = os.environ.get("COLLECTOR_SERVICE_URL", "http://localhost:8081")
CRAWLER_SERVICE_URL = os.environ.get(
    "CRAWLER_SERVICE_URL", "http://autonomous-crawler:8030"
)


# ============================================================================
# Schemas
# ============================================================================


class LlmProviderExport(BaseModel):
    """LLM Provider 설정 Export 형식"""
    providerType: str
    defaultModel: str
    baseUrl: Optional[str] = None
    enabled: bool = True
    priority: int = 100
    maxTokens: int = 4096
    temperature: float = 0.7
    timeoutMs: int = 60000
    azureDeploymentName: Optional[str] = None
    azureApiVersion: Optional[str] = None
    # API Key는 보안상 마스킹하여 export
    apiKeyMasked: Optional[str] = None


class MlAddonExport(BaseModel):
    """ML Addon 설정 Export 형식"""
    addon_key: str
    name: str
    description: Optional[str] = None
    endpoint_url: str
    version: Optional[str] = None
    status: str = "active"
    config: Optional[Dict[str, Any]] = None


class SystemConfigExport(BaseModel):
    """전체 시스템 설정 Export 형식"""
    version: str = "1.0"
    exportedAt: str
    exportedBy: Optional[str] = None
    llmProviders: List[LlmProviderExport] = []
    mlAddons: List[MlAddonExport] = []
    metadata: Optional[Dict[str, Any]] = None


class LlmProviderImport(BaseModel):
    """LLM Provider Import 형식 (API Key 포함 가능)"""
    providerType: str
    apiKey: Optional[str] = Field(None, description="API 키 (필수)")
    defaultModel: str
    baseUrl: Optional[str] = None
    enabled: bool = True
    priority: int = 100
    maxTokens: int = 4096
    temperature: float = 0.7
    timeoutMs: int = 60000
    azureDeploymentName: Optional[str] = None
    azureApiVersion: Optional[str] = None


class MlAddonImport(BaseModel):
    """ML Addon Import 형식"""
    addon_key: str
    name: str
    description: Optional[str] = None
    endpoint_url: str
    version: Optional[str] = None
    config: Optional[Dict[str, Any]] = None


class SystemConfigImport(BaseModel):
    """전체 시스템 설정 Import 형식"""
    version: str = "1.0"
    llmProviders: List[LlmProviderImport] = []
    mlAddons: List[MlAddonImport] = []
    metadata: Optional[Dict[str, Any]] = None


class ImportResult(BaseModel):
    """Import 결과"""
    success: bool
    message: str
    llmProvidersImported: int = 0
    llmProvidersFailed: int = 0
    mlAddonsImported: int = 0
    mlAddonsFailed: int = 0
    errors: List[str] = []
    warnings: List[str] = []


class ImportOptions(BaseModel):
    """Import 옵션"""
    overwriteExisting: bool = Field(True, description="기존 설정 덮어쓰기 여부")
    skipLlmProviders: bool = Field(False, description="LLM Provider 건너뛰기")
    skipMlAddons: bool = Field(False, description="ML Addon 건너뛰기")
    validateOnly: bool = Field(False, description="검증만 수행 (실제 import 안함)")


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
# Export Endpoints
# ============================================================================


@router.get("/export", response_model=SystemConfigExport)
async def export_all_config(
    include_llm: bool = True,
    include_ml: bool = True,
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """
    전체 시스템 설정을 JSON으로 Export.
    
    LLM Provider, ML Addon 설정을 한 번에 내보냅니다.
    API Key는 마스킹되어 내보내집니다.
    """
    export_data = SystemConfigExport(
        version="1.0",
        exportedAt=datetime.utcnow().isoformat() + "Z",
        exportedBy=current_user.username,
        llmProviders=[],
        mlAddons=[],
        metadata={
            "source": "NewsInsight Admin Dashboard",
            "includesSecrets": False,
        },
    )

    errors = []

    # Export LLM Providers
    if include_llm:
        try:
            llm_settings = await call_collector_service(
                "GET", "/api/v1/admin/llm-providers"
            )
            for setting in llm_settings:
                export_data.llmProviders.append(
                    LlmProviderExport(
                        providerType=setting.get("providerType"),
                        defaultModel=setting.get("defaultModel", ""),
                        baseUrl=setting.get("baseUrl"),
                        enabled=setting.get("enabled", True),
                        priority=setting.get("priority", 100),
                        maxTokens=setting.get("maxTokens", 4096),
                        temperature=setting.get("temperature", 0.7),
                        timeoutMs=setting.get("timeoutMs", 60000),
                        azureDeploymentName=setting.get("azureDeploymentName"),
                        azureApiVersion=setting.get("azureApiVersion"),
                        apiKeyMasked=setting.get("maskedApiKey"),
                    )
                )
        except Exception as e:
            errors.append(f"LLM Provider export failed: {str(e)}")

    # Export ML Addons
    if include_ml:
        try:
            ml_addons = await call_collector_service(
                "GET", "/api/v1/admin/ml-addons"
            )
            for addon in ml_addons:
                export_data.mlAddons.append(
                    MlAddonExport(
                        addon_key=addon.get("addon_key"),
                        name=addon.get("name"),
                        description=addon.get("description"),
                        endpoint_url=addon.get("endpoint_url"),
                        version=addon.get("version"),
                        status=addon.get("status", "active"),
                        config=addon.get("config"),
                    )
                )
        except Exception as e:
            errors.append(f"ML Addon export failed: {str(e)}")

    if errors:
        export_data.metadata["errors"] = errors

    # Audit log
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.VIEW,
        resource_type="system_config",
        resource_id="export",
        resource_name="System Config Export",
        details={
            "llmProviderCount": len(export_data.llmProviders),
            "mlAddonCount": len(export_data.mlAddons),
        },
    )

    return export_data


@router.get("/export/download")
async def download_config(
    include_llm: bool = True,
    include_ml: bool = True,
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """
    설정을 JSON 파일로 다운로드.
    
    Content-Disposition 헤더를 포함하여 파일 다운로드를 트리거합니다.
    """
    export_data = await export_all_config(
        include_llm=include_llm,
        include_ml=include_ml,
        audit_service=audit_service,
        current_user=current_user,
    )

    filename = f"newsinsight-config-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.json"

    return JSONResponse(
        content=export_data.model_dump(),
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Type": "application/json",
        },
    )


# ============================================================================
# Import Endpoints
# ============================================================================


@router.post("/import", response_model=ImportResult)
async def import_config(
    config: SystemConfigImport,
    options: Optional[ImportOptions] = None,
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """
    JSON 설정을 시스템에 Import.
    
    LLM Provider, ML Addon 설정을 한 번에 가져옵니다.
    옵션에 따라 기존 설정을 덮어쓰거나 건너뜁니다.
    """
    if options is None:
        options = ImportOptions()

    result = ImportResult(
        success=True,
        message="Import completed",
        errors=[],
        warnings=[],
    )

    # Validate version
    if config.version not in ["1.0"]:
        result.warnings.append(f"Unknown config version: {config.version}")

    # Validate only mode
    if options.validateOnly:
        result.message = "Validation completed (dry run)"
        result.llmProvidersImported = len(config.llmProviders)
        result.mlAddonsImported = len(config.mlAddons)
        return result

    # Import LLM Providers
    if not options.skipLlmProviders:
        for provider in config.llmProviders:
            try:
                if not provider.apiKey:
                    result.warnings.append(
                        f"LLM Provider {provider.providerType}: API Key가 없어 건너뜁니다."
                    )
                    result.llmProvidersFailed += 1
                    continue

                await call_collector_service(
                    "PUT",
                    f"/api/v1/admin/llm-providers/{provider.providerType}",
                    json_data={
                        "providerType": provider.providerType,
                        "apiKey": provider.apiKey,
                        "defaultModel": provider.defaultModel,
                        "baseUrl": provider.baseUrl,
                        "enabled": provider.enabled,
                        "priority": provider.priority,
                        "maxTokens": provider.maxTokens,
                        "temperature": provider.temperature,
                        "timeoutMs": provider.timeoutMs,
                        "azureDeploymentName": provider.azureDeploymentName,
                        "azureApiVersion": provider.azureApiVersion,
                    },
                )
                result.llmProvidersImported += 1
            except Exception as e:
                result.errors.append(
                    f"LLM Provider {provider.providerType} import failed: {str(e)}"
                )
                result.llmProvidersFailed += 1

    # Import ML Addons
    if not options.skipMlAddons:
        # Get existing addons to check for duplicates
        existing_addons = {}
        try:
            existing = await call_collector_service(
                "GET", "/api/v1/admin/ml-addons"
            )
            existing_addons = {a.get("addon_key"): a.get("id") for a in existing}
        except Exception:
            pass

        for addon in config.mlAddons:
            try:
                if addon.addon_key in existing_addons:
                    if options.overwriteExisting:
                        # Update existing
                        addon_id = existing_addons[addon.addon_key]
                        await call_collector_service(
                            "PUT",
                            f"/api/v1/admin/ml-addons/{addon_id}",
                            json_data={
                                "name": addon.name,
                                "description": addon.description,
                                "endpoint_url": addon.endpoint_url,
                                "version": addon.version,
                                "config": addon.config,
                            },
                        )
                        result.mlAddonsImported += 1
                    else:
                        result.warnings.append(
                            f"ML Addon {addon.addon_key}: 이미 존재하여 건너뜁니다."
                        )
                        result.mlAddonsFailed += 1
                else:
                    # Create new
                    await call_collector_service(
                        "POST",
                        "/api/v1/admin/ml-addons",
                        json_data={
                            "addon_key": addon.addon_key,
                            "name": addon.name,
                            "description": addon.description,
                            "endpoint_url": addon.endpoint_url,
                            "version": addon.version,
                            "config": addon.config,
                        },
                    )
                    result.mlAddonsImported += 1
            except Exception as e:
                result.errors.append(
                    f"ML Addon {addon.addon_key} import failed: {str(e)}"
                )
                result.mlAddonsFailed += 1

    # Determine overall success
    total_failed = result.llmProvidersFailed + result.mlAddonsFailed
    total_imported = result.llmProvidersImported + result.mlAddonsImported

    if total_failed > 0 and total_imported == 0:
        result.success = False
        result.message = "Import failed"
    elif total_failed > 0:
        result.message = f"Import completed with {total_failed} errors"
    else:
        result.message = f"Import completed successfully ({total_imported} items)"

    # Audit log
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.CREATE,
        resource_type="system_config",
        resource_id="import",
        resource_name="System Config Import",
        details={
            "llmProvidersImported": result.llmProvidersImported,
            "llmProvidersFailed": result.llmProvidersFailed,
            "mlAddonsImported": result.mlAddonsImported,
            "mlAddonsFailed": result.mlAddonsFailed,
            "overwriteExisting": options.overwriteExisting,
        },
    )

    return result


@router.post("/import/validate", response_model=ImportResult)
async def validate_import_config(
    config: SystemConfigImport,
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """
    Import할 설정의 유효성만 검증 (실제 import 안함).
    """
    result = ImportResult(
        success=True,
        message="Validation completed",
        errors=[],
        warnings=[],
    )

    # Validate version
    if config.version not in ["1.0"]:
        result.warnings.append(f"Unknown config version: {config.version}")

    # Validate LLM Providers
    valid_provider_types = [
        "OPENAI", "ANTHROPIC", "GOOGLE", "OPENROUTER",
        "OLLAMA", "AZURE_OPENAI", "TOGETHER_AI", "CUSTOM"
    ]

    for i, provider in enumerate(config.llmProviders):
        if provider.providerType not in valid_provider_types:
            result.errors.append(
                f"LLM Provider [{i}]: 유효하지 않은 providerType '{provider.providerType}'"
            )
        if not provider.defaultModel:
            result.warnings.append(
                f"LLM Provider [{i}] {provider.providerType}: defaultModel이 비어있습니다."
            )
        if not provider.apiKey:
            result.warnings.append(
                f"LLM Provider [{i}] {provider.providerType}: apiKey가 비어있어 import 시 건너뜁니다."
            )
        else:
            result.llmProvidersImported += 1

    # Validate ML Addons
    for i, addon in enumerate(config.mlAddons):
        if not addon.addon_key:
            result.errors.append(f"ML Addon [{i}]: addon_key가 비어있습니다.")
        elif not addon.name:
            result.errors.append(f"ML Addon [{i}] {addon.addon_key}: name이 비어있습니다.")
        elif not addon.endpoint_url:
            result.errors.append(
                f"ML Addon [{i}] {addon.addon_key}: endpoint_url이 비어있습니다."
            )
        else:
            result.mlAddonsImported += 1

    if result.errors:
        result.success = False
        result.message = f"Validation failed with {len(result.errors)} errors"

    return result


# ============================================================================
# Template Endpoint
# ============================================================================


@router.get("/template", response_model=SystemConfigImport)
async def get_config_template(
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """
    Import용 설정 템플릿 제공.
    
    빈 템플릿 또는 예시 데이터가 포함된 템플릿을 반환합니다.
    """
    return SystemConfigImport(
        version="1.0",
        llmProviders=[
            LlmProviderImport(
                providerType="OPENAI",
                apiKey="sk-your-api-key-here",
                defaultModel="gpt-4o",
                enabled=True,
                priority=100,
                maxTokens=4096,
                temperature=0.7,
                timeoutMs=60000,
            ),
            LlmProviderImport(
                providerType="ANTHROPIC",
                apiKey="sk-ant-your-api-key-here",
                defaultModel="claude-sonnet-4-20250514",
                enabled=True,
                priority=90,
            ),
        ],
        mlAddons=[
            MlAddonImport(
                addon_key="sentiment-addon",
                name="Sentiment Analyzer",
                description="뉴스 기사 감성 분석",
                endpoint_url="http://sentiment-mcp:8000",
                version="1.0.0",
            ),
            MlAddonImport(
                addon_key="factcheck-addon",
                name="Fact Checker",
                description="뉴스 기사 팩트체크",
                endpoint_url="http://factcheck-mcp:8000",
                version="1.0.0",
            ),
        ],
        metadata={
            "description": "예시 설정 템플릿",
            "instructions": "API Key를 실제 값으로 교체하세요.",
        },
    )
