"""
Audit Router - 감사 로그 API 엔드포인트
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from ..models.schemas import AuditAction, AuditLog, AuditLogFilter, UserRole
from ..dependencies import get_audit_service, get_current_user, require_role

router = APIRouter(prefix="/audit", tags=["Audit Logs"])


@router.get("/logs", response_model=list[AuditLog])
async def list_audit_logs(
    user_id: Optional[str] = Query(None, description="사용자 ID 필터"),
    action: Optional[AuditAction] = Query(None, description="액션 필터"),
    resource_type: Optional[str] = Query(None, description="리소스 타입 필터"),
    environment_id: Optional[str] = Query(None, description="환경 ID 필터"),
    start_date: Optional[datetime] = Query(None, description="시작 날짜"),
    end_date: Optional[datetime] = Query(None, description="종료 날짜"),
    success: Optional[bool] = Query(None, description="성공/실패 필터"),
    page: int = Query(1, ge=1, description="페이지 번호"),
    page_size: int = Query(50, ge=1, le=200, description="페이지 크기"),
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.OPERATOR)),
):
    """감사 로그 조회 (Operator 이상 권한 필요)"""
    filter_params = AuditLogFilter(
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        environment_id=environment_id,
        start_date=start_date,
        end_date=end_date,
        success=success,
    )

    logs, total = audit_service.get_logs(
        filter_params=filter_params,
        page=page,
        page_size=page_size,
    )

    return logs


@router.get("/logs/count")
async def get_audit_logs_count(
    user_id: Optional[str] = Query(None),
    action: Optional[AuditAction] = Query(None),
    resource_type: Optional[str] = Query(None),
    environment_id: Optional[str] = Query(None),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    success: Optional[bool] = Query(None),
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.OPERATOR)),
):
    """감사 로그 총 개수 조회"""
    filter_params = AuditLogFilter(
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        environment_id=environment_id,
        start_date=start_date,
        end_date=end_date,
        success=success,
    )

    _, total = audit_service.get_logs(
        filter_params=filter_params,
        page=1,
        page_size=1,
    )

    return {"total": total}


@router.get("/logs/{log_id}", response_model=AuditLog)
async def get_audit_log(
    log_id: str,
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.OPERATOR)),
):
    """감사 로그 상세 조회"""
    log = audit_service.get_log_by_id(log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Audit log not found")
    return log


@router.get("/users/{user_id}/activity", response_model=list[AuditLog])
async def get_user_activity(
    user_id: str,
    limit: int = Query(100, ge=1, le=500),
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """특정 사용자 활동 이력 조회 (Admin 권한 필요)"""
    return audit_service.get_user_activity(user_id, limit=limit)


@router.get("/resources/{resource_type}/{resource_id}/history", response_model=list[AuditLog])
async def get_resource_history(
    resource_type: str,
    resource_id: str,
    limit: int = Query(100, ge=1, le=500),
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.OPERATOR)),
):
    """리소스 변경 이력 조회"""
    return audit_service.get_resource_history(resource_type, resource_id, limit=limit)


@router.get("/statistics")
async def get_audit_statistics(
    start_date: Optional[datetime] = Query(None, description="시작 날짜"),
    end_date: Optional[datetime] = Query(None, description="종료 날짜"),
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """감사 로그 통계 (Admin 권한 필요)"""
    return audit_service.get_statistics(start_date=start_date, end_date=end_date)


@router.delete("/logs/cleanup")
async def cleanup_old_logs(
    days: int = Query(90, ge=30, le=365, description="보관 기간 (일)"),
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """오래된 로그 정리 (Admin 권한 필요)"""
    deleted_count = audit_service.clear_old_logs(days=days)
    return {
        "success": True,
        "message": f"Deleted {deleted_count} old logs (older than {days} days)",
        "deleted_count": deleted_count,
    }
