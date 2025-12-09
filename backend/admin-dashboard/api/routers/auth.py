"""
Auth Router - 인증/권한 API 엔드포인트
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel

from ..models.schemas import AuditAction, Token, User, UserCreate, UserRole
from ..dependencies import (
    get_audit_service,
    get_auth_service,
    get_current_user,
    require_role,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class ResetPasswordRequest(BaseModel):
    new_password: str


class UpdateUserRequest(BaseModel):
    email: Optional[str] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None


@router.post("/login", response_model=Token)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    auth_service=Depends(get_auth_service),
    audit_service=Depends(get_audit_service),
):
    """로그인"""
    user = auth_service.authenticate(form_data.username, form_data.password)

    if not user:
        # 실패 로그
        audit_service.log(
            user_id="unknown",
            username=form_data.username,
            action=AuditAction.LOGIN,
            resource_type="auth",
            success=False,
            error_message="Invalid credentials",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = auth_service.create_access_token(user)

    # 성공 로그
    audit_service.log(
        user_id=user.id,
        username=user.username,
        action=AuditAction.LOGIN,
        resource_type="auth",
        success=True,
    )

    return token


@router.post("/token", response_model=Token)
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    auth_service=Depends(get_auth_service),
    audit_service=Depends(get_audit_service),
):
    """OAuth2 호환 토큰 엔드포인트"""
    return await login(form_data, auth_service, audit_service)


@router.get("/me", response_model=User)
async def get_current_user_info(
    current_user=Depends(get_current_user),
):
    """현재 로그인한 사용자 정보"""
    return current_user


@router.post("/logout")
async def logout(
    current_user=Depends(get_current_user),
    audit_service=Depends(get_audit_service),
):
    """로그아웃"""
    # 감사 로그
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.LOGOUT,
        resource_type="auth",
    )

    return {"success": True, "message": "Logged out successfully"}


@router.post("/change-password")
async def change_password(
    request: ChangePasswordRequest,
    current_user=Depends(get_current_user),
    auth_service=Depends(get_auth_service),
    audit_service=Depends(get_audit_service),
):
    """비밀번호 변경"""
    success = auth_service.change_password(
        user_id=current_user.id,
        old_password=request.old_password,
        new_password=request.new_password,
    )

    if not success:
        audit_service.log(
            user_id=current_user.id,
            username=current_user.username,
            action=AuditAction.UPDATE,
            resource_type="password",
            success=False,
            error_message="Invalid old password",
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid old password",
        )

    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.UPDATE,
        resource_type="password",
        success=True,
    )

    return {"success": True, "message": "Password changed successfully"}


# ============================================================================
# User Management (Admin only)
# ============================================================================
@router.get("/users", response_model=list[User])
async def list_users(
    active_only: bool = False,
    auth_service=Depends(get_auth_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """사용자 목록 조회 (Admin 권한 필요)"""
    return auth_service.list_users(active_only=active_only)


@router.get("/users/{user_id}", response_model=User)
async def get_user(
    user_id: str,
    auth_service=Depends(get_auth_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """사용자 조회 (Admin 권한 필요)"""
    user = auth_service.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post("/users", response_model=User, status_code=status.HTTP_201_CREATED)
async def create_user(
    data: UserCreate,
    auth_service=Depends(get_auth_service),
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """사용자 생성 (Admin 권한 필요)"""
    try:
        user = auth_service.create_user(data)

        audit_service.log(
            user_id=current_user.id,
            username=current_user.username,
            action=AuditAction.CREATE,
            resource_type="user",
            resource_id=user.id,
            resource_name=user.username,
            details={"role": data.role.value},
        )

        return user
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/users/{user_id}", response_model=User)
async def update_user(
    user_id: str,
    data: UpdateUserRequest,
    auth_service=Depends(get_auth_service),
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """사용자 정보 수정 (Admin 권한 필요)"""
    user = auth_service.update_user(
        user_id=user_id,
        email=data.email,
        role=data.role,
        is_active=data.is_active,
    )

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.UPDATE,
        resource_type="user",
        resource_id=user_id,
        resource_name=user.username,
        details=data.model_dump(exclude_unset=True),
    )

    return user


@router.post("/users/{user_id}/reset-password")
async def reset_user_password(
    user_id: str,
    request: ResetPasswordRequest,
    auth_service=Depends(get_auth_service),
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """사용자 비밀번호 초기화 (Admin 권한 필요)"""
    user = auth_service.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    success = auth_service.reset_password(user_id, request.new_password)

    if not success:
        raise HTTPException(status_code=500, detail="Failed to reset password")

    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.UPDATE,
        resource_type="user",
        resource_id=user_id,
        resource_name=user.username,
        details={"action": "password_reset"},
    )

    return {"success": True, "message": "Password reset successfully"}


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    auth_service=Depends(get_auth_service),
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """사용자 삭제 (Admin 권한 필요)"""
    # 자기 자신은 삭제 불가
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    user = auth_service.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not auth_service.delete_user(user_id):
        raise HTTPException(status_code=500, detail="Failed to delete user")

    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.DELETE,
        resource_type="user",
        resource_id=user_id,
        resource_name=user.username,
    )
