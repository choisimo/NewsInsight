"""
Environment Router - 환경 관리 API 엔드포인트
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from ..models.schemas import (
    AuditAction,
    Environment,
    EnvironmentCreate,
    EnvironmentStatus,
    EnvironmentUpdate,
    UserRole,
)
from ..dependencies import (
    get_audit_service,
    get_current_user,
    get_environment_service,
    require_role,
)

router = APIRouter(prefix="/environments", tags=["Environments"])


@router.get("", response_model=list[Environment])
async def list_environments(
    active_only: bool = Query(False, description="활성 환경만 조회"),
    env_service=Depends(get_environment_service),
    current_user=Depends(get_current_user),
):
    """환경 목록 조회"""
    return env_service.list_environments(active_only=active_only)


@router.get("/{env_id}", response_model=Environment)
async def get_environment(
    env_id: str,
    env_service=Depends(get_environment_service),
    current_user=Depends(get_current_user),
):
    """환경 상세 조회"""
    env = env_service.get_environment(env_id)
    if not env:
        raise HTTPException(status_code=404, detail="Environment not found")
    return env


@router.post("", response_model=Environment, status_code=status.HTTP_201_CREATED)
async def create_environment(
    data: EnvironmentCreate,
    env_service=Depends(get_environment_service),
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """환경 생성 (Admin 권한 필요)"""
    env = env_service.create_environment(data)

    # 감사 로그
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.CREATE,
        resource_type="environment",
        resource_id=env.id,
        resource_name=env.name,
        details={"data": data.model_dump()},
    )

    return env


@router.patch("/{env_id}", response_model=Environment)
async def update_environment(
    env_id: str,
    data: EnvironmentUpdate,
    env_service=Depends(get_environment_service),
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """환경 수정 (Admin 권한 필요)"""
    env = env_service.update_environment(env_id, data)
    if not env:
        raise HTTPException(status_code=404, detail="Environment not found")

    # 감사 로그
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.UPDATE,
        resource_type="environment",
        resource_id=env.id,
        resource_name=env.name,
        details={"changes": data.model_dump(exclude_unset=True)},
    )

    return env


@router.delete("/{env_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_environment(
    env_id: str,
    env_service=Depends(get_environment_service),
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """환경 삭제 (Admin 권한 필요)"""
    env = env_service.get_environment(env_id)
    if not env:
        raise HTTPException(status_code=404, detail="Environment not found")

    if not env_service.delete_environment(env_id):
        raise HTTPException(status_code=500, detail="Failed to delete environment")

    # 감사 로그
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.DELETE,
        resource_type="environment",
        resource_id=env_id,
        resource_name=env.name,
    )


@router.get("/{env_id}/status", response_model=EnvironmentStatus)
async def get_environment_status(
    env_id: str,
    env_service=Depends(get_environment_service),
    current_user=Depends(get_current_user),
):
    """환경 상태 조회 (컨테이너 상태)"""
    status = env_service.get_environment_status(env_id)
    if not status:
        raise HTTPException(status_code=404, detail="Environment not found")
    return status


@router.post("/{env_id}/up")
async def docker_compose_up(
    env_id: str,
    build: bool = Query(True, description="이미지 빌드 여부"),
    env_service=Depends(get_environment_service),
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.OPERATOR)),
):
    """Docker Compose Up 실행"""
    env = env_service.get_environment(env_id)
    if not env:
        raise HTTPException(status_code=404, detail="Environment not found")

    success, output = await env_service.docker_compose_up(env_id, build=build)

    # 감사 로그
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.DEPLOY,
        resource_type="environment",
        resource_id=env_id,
        resource_name=env.name,
        environment_id=env_id,
        environment_name=env.name,
        details={"build": build},
        success=success,
        error_message=output if not success else None,
    )

    if not success:
        raise HTTPException(status_code=500, detail=output)

    return {"success": True, "message": "Services started successfully", "output": output}


@router.post("/{env_id}/down")
async def docker_compose_down(
    env_id: str,
    volumes: bool = Query(False, description="볼륨도 삭제할지 여부"),
    env_service=Depends(get_environment_service),
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.OPERATOR)),
):
    """Docker Compose Down 실행"""
    env = env_service.get_environment(env_id)
    if not env:
        raise HTTPException(status_code=404, detail="Environment not found")

    # 볼륨 삭제는 Admin 권한 필요
    if volumes and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=403,
            detail="Admin permission required to delete volumes",
        )

    success, output = await env_service.docker_compose_down(env_id, volumes=volumes)

    # 감사 로그
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.EXECUTE,
        resource_type="environment",
        resource_id=env_id,
        resource_name=env.name,
        environment_id=env_id,
        environment_name=env.name,
        details={"action": "down", "volumes": volumes},
        success=success,
        error_message=output if not success else None,
    )

    if not success:
        raise HTTPException(status_code=500, detail=output)

    return {"success": True, "message": "Services stopped successfully", "output": output}


@router.post("/{env_id}/restart")
async def docker_compose_restart(
    env_id: str,
    service: Optional[str] = Query(None, description="재시작할 서비스 이름"),
    env_service=Depends(get_environment_service),
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.OPERATOR)),
):
    """Docker Compose Restart 실행"""
    env = env_service.get_environment(env_id)
    if not env:
        raise HTTPException(status_code=404, detail="Environment not found")

    success, output = await env_service.docker_compose_restart(env_id, service=service)

    # 감사 로그
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.EXECUTE,
        resource_type="environment",
        resource_id=env_id,
        resource_name=env.name,
        environment_id=env_id,
        environment_name=env.name,
        details={"action": "restart", "service": service},
        success=success,
        error_message=output if not success else None,
    )

    if not success:
        raise HTTPException(status_code=500, detail=output)

    return {"success": True, "message": "Services restarted successfully", "output": output}


@router.get("/{env_id}/logs/{service}")
async def get_service_logs(
    env_id: str,
    service: str,
    tail: int = Query(100, ge=1, le=1000, description="출력할 로그 줄 수"),
    env_service=Depends(get_environment_service),
    current_user=Depends(get_current_user),
):
    """서비스 로그 조회"""
    env = env_service.get_environment(env_id)
    if not env:
        raise HTTPException(status_code=404, detail="Environment not found")

    success, output = await env_service.get_service_logs(env_id, service, tail=tail)

    if not success:
        raise HTTPException(status_code=500, detail=output)

    return {"service": service, "logs": output}
