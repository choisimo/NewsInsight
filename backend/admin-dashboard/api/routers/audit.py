"""
Audit Router - 감사 로그 API 엔드포인트
"""

import asyncio
import json
from datetime import datetime
from typing import AsyncGenerator, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..models.schemas import AuditAction, AuditLog, AuditLogFilter, UserRole
from ..dependencies import get_audit_service, get_current_user, require_role

router = APIRouter(prefix="/audit", tags=["Audit Logs"])


# ============================================
# SSE Event Stream for Real-time Activity
# ============================================


async def activity_event_generator(
    audit_service,
    last_timestamp: Optional[datetime] = None,
) -> AsyncGenerator[str, None]:
    """
    Server-Sent Events generator for real-time activity stream.
    Polls for new audit logs and sends them as events.
    """
    poll_interval = 5  # seconds
    seen_ids = set()

    # Initialize with recent logs if no timestamp provided
    if last_timestamp is None:
        recent_logs, _ = audit_service.get_logs(page=1, page_size=20)
        for log in recent_logs:
            seen_ids.add(log.id)

    while True:
        try:
            # Get recent logs
            logs, _ = audit_service.get_logs(page=1, page_size=50)

            # Find new logs
            new_logs = []
            for log in logs:
                if log.id not in seen_ids:
                    new_logs.append(log)
                    seen_ids.add(log.id)

            # Send new logs as events
            for log in reversed(new_logs):  # Send oldest first
                event_data = {
                    "eventType": "activity",
                    "timestamp": log.timestamp.isoformat(),
                    "data": {
                        "id": log.id,
                        "userId": log.user_id,
                        "username": log.username,
                        "action": log.action.value,
                        "resourceType": log.resource_type,
                        "resourceId": log.resource_id,
                        "resourceName": log.resource_name,
                        "environmentId": log.environment_id,
                        "environmentName": log.environment_name,
                        "success": log.success,
                        "errorMessage": log.error_message,
                        "timestamp": log.timestamp.isoformat(),
                    },
                }
                yield f"event: activity\ndata: {json.dumps(event_data, ensure_ascii=False)}\n\n"

            # Send heartbeat
            heartbeat_data = {
                "eventType": "heartbeat",
                "timestamp": datetime.utcnow().isoformat(),
            }
            yield f"event: heartbeat\ndata: {json.dumps(heartbeat_data)}\n\n"

            # Limit seen_ids to prevent memory growth
            if len(seen_ids) > 1000:
                seen_ids = set(list(seen_ids)[-500:])

            await asyncio.sleep(poll_interval)

        except asyncio.CancelledError:
            break
        except Exception as e:
            error_data = {"eventType": "error", "message": str(e)}
            yield f"event: error\ndata: {json.dumps(error_data)}\n\n"
            await asyncio.sleep(poll_interval)


@router.get("/activity/stream")
async def stream_activity_events(
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.OPERATOR)),
):
    """
    SSE endpoint for real-time activity events.

    Returns a Server-Sent Events stream with:
    - activity: New audit log entries
    - heartbeat: Keep-alive signal (every 5 seconds)
    - error: Error notifications

    Requires: OPERATOR role or higher
    """
    return StreamingResponse(
        activity_event_generator(audit_service),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )


@router.get("/activity/recent")
async def get_recent_activity(
    limit: int = Query(20, ge=1, le=100, description="최근 활동 개수"),
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.OPERATOR)),
):
    """
    최근 활동 목록 조회 (SSE 대안).
    폴링 방식으로 사용할 수 있습니다.
    
    Requires: OPERATOR role or higher
    """
    logs, total = audit_service.get_logs(page=1, page_size=limit)

    return {
        "activities": [
            {
                "id": log.id,
                "userId": log.user_id,
                "username": log.username,
                "action": log.action.value,
                "resourceType": log.resource_type,
                "resourceId": log.resource_id,
                "resourceName": log.resource_name,
                "environmentId": log.environment_id,
                "environmentName": log.environment_name,
                "success": log.success,
                "errorMessage": log.error_message,
                "timestamp": log.timestamp.isoformat(),
            }
            for log in logs
        ],
        "total": total,
    }


# ============================================
# Original Audit Endpoints
# ============================================


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


@router.get(
    "/resources/{resource_type}/{resource_id}/history", response_model=list[AuditLog]
)
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
