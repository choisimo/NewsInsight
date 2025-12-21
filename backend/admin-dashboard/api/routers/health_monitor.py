"""
Service Health Monitoring Router
서비스 헬스 체크 및 시스템 상태 모니터링 API
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
import asyncio
import json
from datetime import datetime

from ..models.schemas import (
    ServiceHealth,
    InfrastructureHealth,
    OverallSystemHealth,
    ServiceInfo,
    UserRole,
)
from ..dependencies import get_current_user, require_role, get_health_service
from ..services.health_service import HealthService

router = APIRouter(prefix="/health-monitor", tags=["Health Monitor"])


@router.get("/services", response_model=list[ServiceInfo])
async def list_services(
    service: HealthService = Depends(get_health_service),
    current_user=Depends(get_current_user),
):
    """등록된 모든 서비스 목록 조회"""
    services = service.get_all_services()
    return [
        ServiceInfo(
            id=s["id"],
            name=s["name"],
            description=s.get("description"),
            port=s.get("port"),
            healthcheck=s.get("healthcheck", "/health"),
            hostname=s["hostname"],
            type=s["type"],
            tags=s.get("tags", []),
        )
        for s in services
    ]


@router.get("/infrastructure", response_model=list[dict])
async def list_infrastructure(
    service: HealthService = Depends(get_health_service),
    current_user=Depends(get_current_user),
):
    """인프라 서비스 목록 조회"""
    return service.get_infrastructure_services()


@router.get("/check/{service_id}", response_model=ServiceHealth)
async def check_service(
    service_id: str,
    service: HealthService = Depends(get_health_service),
    current_user=Depends(get_current_user),
):
    """특정 서비스 헬스 체크"""
    health = await service.check_service_health(service_id)
    return health


@router.get("/check-all", response_model=list[ServiceHealth])
async def check_all_services(
    service: HealthService = Depends(get_health_service),
    current_user=Depends(get_current_user),
):
    """모든 서비스 헬스 체크 (병렬 실행)"""
    return await service.check_all_services_health()


@router.get("/check-infrastructure", response_model=list[InfrastructureHealth])
async def check_infrastructure(
    service: HealthService = Depends(get_health_service),
    current_user=Depends(get_current_user),
):
    """모든 인프라 서비스 헬스 체크"""
    return await service.check_infrastructure_health()


@router.get("/overall", response_model=OverallSystemHealth)
async def get_overall_health(
    service: HealthService = Depends(get_health_service),
    current_user=Depends(get_current_user),
):
    """전체 시스템 헬스 상태 요약"""
    return await service.get_overall_health()


@router.get("/stream")
async def stream_health_updates(
    interval: int = 10,
    service: HealthService = Depends(get_health_service),
    current_user=Depends(get_current_user),
):
    """실시간 헬스 상태 스트리밍 (SSE)

    Args:
        interval: 업데이트 간격 (초, 기본 10초, 최소 5초)
    """
    interval = max(5, min(interval, 60))  # 5-60초 범위 제한

    async def generate():
        while True:
            try:
                health = await service.get_overall_health()
                data = health.model_dump_json()
                yield f"data: {data}\n\n"
                await asyncio.sleep(interval)
            except Exception as e:
                error_data = json.dumps(
                    {"error": str(e), "timestamp": datetime.utcnow().isoformat()}
                )
                yield f"data: {error_data}\n\n"
                await asyncio.sleep(interval)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/last-check/{service_id}", response_model=ServiceHealth)
async def get_last_check(
    service_id: str,
    service: HealthService = Depends(get_health_service),
    current_user=Depends(get_current_user),
):
    """마지막 헬스 체크 결과 조회 (캐시된 결과)"""
    result = service.get_last_check(service_id)
    if not result:
        raise HTTPException(
            status_code=404,
            detail=f"No health check result found for service: {service_id}",
        )
    return result
