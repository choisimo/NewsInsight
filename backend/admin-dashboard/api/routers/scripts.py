"""
Script Router - 스크립트/작업 관리 API 엔드포인트
"""
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from ..models.schemas import (
    AuditAction,
    Script,
    ScriptCreate,
    ScriptUpdate,
    TaskExecution,
    TaskExecutionRequest,
    TaskStatus,
    UserRole,
)
from ..dependencies import (
    get_audit_service,
    get_current_user,
    get_environment_service,
    get_script_service,
    require_role,
)

router = APIRouter(prefix="/scripts", tags=["Scripts"])


@router.get("", response_model=list[Script])
async def list_scripts(
    environment: Optional[str] = Query(None, description="환경 이름으로 필터"),
    tag: Optional[str] = Query(None, description="태그로 필터"),
    script_service=Depends(get_script_service),
    current_user=Depends(get_current_user),
):
    """스크립트 목록 조회 (사용자 권한에 따라 필터링)"""
    return script_service.list_scripts(
        environment=environment,
        tag=tag,
        role=current_user.role,
    )


@router.get("/{script_id}", response_model=Script)
async def get_script(
    script_id: str,
    script_service=Depends(get_script_service),
    current_user=Depends(get_current_user),
):
    """스크립트 상세 조회"""
    script = script_service.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    return script


@router.post("", response_model=Script, status_code=status.HTTP_201_CREATED)
async def create_script(
    data: ScriptCreate,
    script_service=Depends(get_script_service),
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """스크립트 생성 (Admin 권한 필요)"""
    script = script_service.create_script(data)

    # 감사 로그
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.CREATE,
        resource_type="script",
        resource_id=script.id,
        resource_name=script.name,
        details={"data": data.model_dump()},
    )

    return script


@router.patch("/{script_id}", response_model=Script)
async def update_script(
    script_id: str,
    data: ScriptUpdate,
    script_service=Depends(get_script_service),
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """스크립트 수정 (Admin 권한 필요)"""
    script = script_service.update_script(script_id, data)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")

    # 감사 로그
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.UPDATE,
        resource_type="script",
        resource_id=script.id,
        resource_name=script.name,
        details={"changes": data.model_dump(exclude_unset=True)},
    )

    return script


@router.delete("/{script_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_script(
    script_id: str,
    script_service=Depends(get_script_service),
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """스크립트 삭제 (Admin 권한 필요)"""
    script = script_service.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")

    if not script_service.delete_script(script_id):
        raise HTTPException(status_code=500, detail="Failed to delete script")

    # 감사 로그
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.DELETE,
        resource_type="script",
        resource_id=script_id,
        resource_name=script.name,
    )


@router.post("/execute", response_model=TaskExecution)
async def execute_script(
    request: TaskExecutionRequest,
    script_service=Depends(get_script_service),
    env_service=Depends(get_environment_service),
    audit_service=Depends(get_audit_service),
    current_user=Depends(get_current_user),
):
    """스크립트 실행"""
    # 스크립트 조회
    script = script_service.get_script(request.script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")

    # 환경 조회
    env = env_service.get_environment(request.environment_id)
    if not env:
        raise HTTPException(status_code=404, detail="Environment not found")

    # 권한 확인
    from ..services.auth_service import AuthService

    if not AuthService.check_permission(
        AuthService, current_user.role, script.required_role
    ):
        raise HTTPException(
            status_code=403,
            detail=f"Requires {script.required_role.value} permission",
        )

    # 환경 허용 확인
    if script.allowed_environments and env.name not in script.allowed_environments:
        raise HTTPException(
            status_code=400,
            detail=f"Script not allowed for environment: {env.name}",
        )

    try:
        execution = await script_service.execute_script(
            script_id=request.script_id,
            environment_name=env.name,
            compose_file=env.compose_file,
            parameters=request.parameters,
            executed_by=current_user.username,
        )

        # 감사 로그
        audit_service.log(
            user_id=current_user.id,
            username=current_user.username,
            action=AuditAction.EXECUTE,
            resource_type="script",
            resource_id=script.id,
            resource_name=script.name,
            environment_id=env.id,
            environment_name=env.name,
            details={
                "execution_id": execution.id,
                "parameters": request.parameters,
            },
        )

        return execution

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/execute/stream")
async def execute_script_stream(
    request: TaskExecutionRequest,
    script_service=Depends(get_script_service),
    env_service=Depends(get_environment_service),
    audit_service=Depends(get_audit_service),
    current_user=Depends(get_current_user),
):
    """스크립트 실행 (실시간 출력 스트리밍)"""
    # 스크립트 조회
    script = script_service.get_script(request.script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")

    # 환경 조회
    env = env_service.get_environment(request.environment_id)
    if not env:
        raise HTTPException(status_code=404, detail="Environment not found")

    # 권한 확인
    role_priority = {UserRole.VIEWER: 0, UserRole.OPERATOR: 1, UserRole.ADMIN: 2}
    if role_priority.get(current_user.role, 0) < role_priority.get(
        script.required_role, 0
    ):
        raise HTTPException(
            status_code=403,
            detail=f"Requires {script.required_role.value} permission",
        )

    # 환경 허용 확인
    if script.allowed_environments and env.name not in script.allowed_environments:
        raise HTTPException(
            status_code=400,
            detail=f"Script not allowed for environment: {env.name}",
        )

    # 감사 로그
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.EXECUTE,
        resource_type="script",
        resource_id=script.id,
        resource_name=script.name,
        environment_id=env.id,
        environment_name=env.name,
        details={"parameters": request.parameters, "streaming": True},
    )

    async def generate():
        async for line in script_service.stream_execution_output(
            script_id=request.script_id,
            environment_name=env.name,
            compose_file=env.compose_file,
            parameters=request.parameters,
            executed_by=current_user.username,
        ):
            yield line

    return StreamingResponse(
        generate(),
        media_type="text/plain",
        headers={"X-Content-Type-Options": "nosniff"},
    )


@router.get("/executions", response_model=list[TaskExecution])
async def list_executions(
    script_id: Optional[str] = Query(None, description="스크립트 ID로 필터"),
    environment_id: Optional[str] = Query(None, description="환경 ID로 필터"),
    status: Optional[TaskStatus] = Query(None, description="상태로 필터"),
    limit: int = Query(50, ge=1, le=200, description="조회 개수"),
    script_service=Depends(get_script_service),
    current_user=Depends(get_current_user),
):
    """실행 이력 조회"""
    return script_service.list_executions(
        script_id=script_id,
        environment_id=environment_id,
        status=status,
        limit=limit,
    )


@router.get("/executions/{execution_id}", response_model=TaskExecution)
async def get_execution(
    execution_id: str,
    script_service=Depends(get_script_service),
    current_user=Depends(get_current_user),
):
    """실행 상세 조회"""
    execution = script_service.get_execution(execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")
    return execution


@router.post("/executions/{execution_id}/cancel")
async def cancel_execution(
    execution_id: str,
    script_service=Depends(get_script_service),
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.OPERATOR)),
):
    """실행 중인 작업 취소"""
    execution = script_service.get_execution(execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")

    if execution.status != TaskStatus.RUNNING:
        raise HTTPException(status_code=400, detail="Execution is not running")

    if not script_service.cancel_execution(execution_id):
        raise HTTPException(status_code=500, detail="Failed to cancel execution")

    # 감사 로그
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.EXECUTE,
        resource_type="execution",
        resource_id=execution_id,
        details={"action": "cancel"},
    )

    return {"success": True, "message": "Execution cancelled"}
