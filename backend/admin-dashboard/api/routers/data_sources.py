"""
Data Sources Router
데이터 소스 관리 API
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query

from ..models.schemas import (
    DataSource,
    DataSourceCreate,
    DataSourceUpdate,
    DataSourceType,
    DataSourceStatus,
    DataSourceTestResult,
    UserRole,
    AuditAction,
)
from ..dependencies import (
    get_current_user,
    require_role,
    get_data_source_service,
    get_audit_service,
)
from ..services.data_source_service import DataSourceService
from ..services.audit_service import AuditService

router = APIRouter(prefix="/data-sources", tags=["Data Sources"])


@router.get("", response_model=list[DataSource])
async def list_data_sources(
    source_type: Optional[str] = Query(None, description="소스 타입 필터"),
    status: Optional[str] = Query(None, description="상태 필터"),
    category: Optional[str] = Query(None, description="카테고리 필터"),
    is_active: Optional[bool] = Query(None, description="활성화 상태 필터"),
    service: DataSourceService = Depends(get_data_source_service),
    current_user=Depends(get_current_user),
):
    """데이터 소스 목록 조회"""
    type_filter = DataSourceType(source_type) if source_type else None
    status_filter = DataSourceStatus(status) if status else None

    return service.list_sources(
        source_type=type_filter,
        status=status_filter,
        category=category,
        is_active=is_active,
    )


@router.get("/categories", response_model=list[str])
async def get_categories(
    service: DataSourceService = Depends(get_data_source_service),
    current_user=Depends(get_current_user),
):
    """모든 카테고리 목록 조회"""
    return service.get_categories()


@router.get("/stats", response_model=dict)
async def get_stats(
    service: DataSourceService = Depends(get_data_source_service),
    current_user=Depends(get_current_user),
):
    """데이터 소스 통계 조회"""
    return service.get_stats()


@router.get("/{source_id}", response_model=DataSource)
async def get_data_source(
    source_id: str,
    service: DataSourceService = Depends(get_data_source_service),
    current_user=Depends(get_current_user),
):
    """특정 데이터 소스 조회"""
    source = service.get_source(source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Data source not found")
    return source


@router.post("", response_model=DataSource, status_code=201)
async def create_data_source(
    data: DataSourceCreate,
    service: DataSourceService = Depends(get_data_source_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.OPERATOR)),
):
    """새 데이터 소스 생성"""
    source = service.create_source(data)

    # 감사 로그
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.CREATE,
        resource_type="data_source",
        resource_id=source.id,
        resource_name=source.name,
        details={"url": source.url, "type": source.source_type.value},
    )

    return source


@router.patch("/{source_id}", response_model=DataSource)
async def update_data_source(
    source_id: str,
    data: DataSourceUpdate,
    service: DataSourceService = Depends(get_data_source_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.OPERATOR)),
):
    """데이터 소스 수정"""
    source = service.update_source(source_id, data)
    if not source:
        raise HTTPException(status_code=404, detail="Data source not found")

    # 감사 로그
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.UPDATE,
        resource_type="data_source",
        resource_id=source.id,
        resource_name=source.name,
        details=data.model_dump(exclude_unset=True),
    )

    return source


@router.delete("/{source_id}", status_code=204)
async def delete_data_source(
    source_id: str,
    service: DataSourceService = Depends(get_data_source_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """데이터 소스 삭제"""
    source = service.get_source(source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Data source not found")

    service.delete_source(source_id)

    # 감사 로그
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.DELETE,
        resource_type="data_source",
        resource_id=source_id,
        resource_name=source.name,
        details={},
    )


@router.post("/{source_id}/test", response_model=DataSourceTestResult)
async def test_data_source(
    source_id: str,
    service: DataSourceService = Depends(get_data_source_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user=Depends(get_current_user),
):
    """데이터 소스 연결 테스트"""
    result = await service.test_source(source_id)

    # 감사 로그
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.EXECUTE,
        resource_type="data_source",
        resource_id=source_id,
        details={"action": "test", "success": result.success},
        success=result.success,
        error_message=None if result.success else result.message,
    )

    return result


@router.post("/{source_id}/crawl")
async def trigger_crawl(
    source_id: str,
    service: DataSourceService = Depends(get_data_source_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.OPERATOR)),
):
    """데이터 수집 트리거"""
    result = await service.trigger_crawl(source_id)

    # 감사 로그
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.EXECUTE,
        resource_type="data_source",
        resource_id=source_id,
        details={"action": "crawl", "success": result["success"]},
        success=result["success"],
        error_message=result.get("message") if not result["success"] else None,
    )

    return result


@router.post("/bulk/toggle-active")
async def bulk_toggle_active(
    source_ids: list[str],
    is_active: bool = Query(..., description="활성화 여부"),
    service: DataSourceService = Depends(get_data_source_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.OPERATOR)),
):
    """여러 데이터 소스 일괄 활성화/비활성화"""
    updated = service.bulk_toggle_active(source_ids, is_active)

    # 감사 로그
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.UPDATE,
        resource_type="data_source",
        details={
            "action": "bulk_toggle_active",
            "source_ids": source_ids,
            "is_active": is_active,
            "updated_count": updated,
        },
    )

    return {"updated": updated}
