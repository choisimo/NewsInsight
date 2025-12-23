"""
Auth Router - 인증/권한 API 엔드포인트
"""

import os
from typing import Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel

from ..models.schemas import (
    AuditAction,
    Token,
    TokenResponse,
    User,
    UserCreate,
    UserRole,
    SetupStatus,
)
from ..dependencies import (
    get_audit_service,
    get_auth_service,
    get_current_user,
    require_role,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])

# Cookie settings
REFRESH_TOKEN_COOKIE_NAME = "refresh_token"
# In production, set SECURE_COOKIES=true in environment
SECURE_COOKIES = os.getenv("SECURE_COOKIES", "false").lower() == "true"
# Cookie max age: 7 days in seconds
REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60


def set_refresh_token_cookie(response: Response, refresh_token: str) -> None:
    """Set refresh token as HTTP-Only cookie"""
    response.set_cookie(
        key=REFRESH_TOKEN_COOKIE_NAME,
        value=refresh_token,
        httponly=True,
        secure=SECURE_COOKIES,  # HTTPS only in production
        samesite="lax",  # CSRF protection
        max_age=REFRESH_TOKEN_MAX_AGE,
        path="/api/v1/admin/auth",  # Restrict to auth endpoints only
    )


def clear_refresh_token_cookie(response: Response) -> None:
    """Clear the refresh token cookie"""
    response.delete_cookie(
        key=REFRESH_TOKEN_COOKIE_NAME,
        path="/api/v1/admin/auth",
        httponly=True,
        secure=SECURE_COOKIES,
        samesite="lax",
    )


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


class RefreshTokenRequest(BaseModel):
    """Optional body for refresh - prefer using HTTP-Only cookie"""

    refresh_token: Optional[str] = None


@router.post("/login", response_model=TokenResponse)
async def login(
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    auth_service=Depends(get_auth_service),
    audit_service=Depends(get_audit_service),
):
    """로그인 - 리프레시 토큰은 HTTP-Only 쿠키로 전송됩니다"""
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

    # Set refresh token as HTTP-Only cookie
    set_refresh_token_cookie(response, token.refresh_token)

    # 성공 로그
    audit_service.log(
        user_id=user.id,
        username=user.username,
        action=AuditAction.LOGIN,
        resource_type="auth",
        success=True,
    )

    # Return only access token in body (refresh token is in cookie)
    return TokenResponse(
        access_token=token.access_token,
        token_type=token.token_type,
        expires_in=token.expires_in,
    )


@router.post("/token", response_model=TokenResponse)
async def login_for_access_token(
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    auth_service=Depends(get_auth_service),
    audit_service=Depends(get_audit_service),
):
    """OAuth2 호환 토큰 엔드포인트 - 리프레시 토큰은 HTTP-Only 쿠키로 전송됩니다"""
    return await login(response, form_data, auth_service, audit_service)


@router.get("/me", response_model=User)
async def get_current_user_info(
    current_user=Depends(get_current_user),
):
    """현재 로그인한 사용자 정보"""
    return current_user


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    response: Response,
    request: Optional[RefreshTokenRequest] = None,
    refresh_token_cookie: Optional[str] = Cookie(None, alias="refresh_token"),
    auth_service=Depends(get_auth_service),
):
    """리프레시 토큰으로 새 액세스 토큰 발급

    리프레시 토큰은 HTTP-Only 쿠키에서 자동으로 읽습니다.
    쿠키가 없는 경우 요청 본문의 refresh_token을 사용합니다 (하위 호환성).

    - 새 리프레시 토큰은 HTTP-Only 쿠키로 설정됩니다
    - 기존 리프레시 토큰은 사용 후 폐기됩니다 (Rotation)
    """
    # Prefer cookie over body
    token_to_use = refresh_token_cookie
    if not token_to_use and request and request.refresh_token:
        token_to_use = request.refresh_token

    if not token_to_use:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token not provided",
            headers={"WWW-Authenticate": "Bearer"},
        )

    new_token = auth_service.refresh_access_token(token_to_use)

    if not new_token:
        # Clear invalid cookie
        clear_refresh_token_cookie(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Set new refresh token as HTTP-Only cookie
    set_refresh_token_cookie(response, new_token.refresh_token)

    # Return only access token in body
    return TokenResponse(
        access_token=new_token.access_token,
        token_type=new_token.token_type,
        expires_in=new_token.expires_in,
    )


@router.post("/logout")
async def logout(
    response: Response,
    current_user=Depends(get_current_user),
    auth_service=Depends(get_auth_service),
    audit_service=Depends(get_audit_service),
):
    """로그아웃 - 사용자의 모든 리프레시 토큰 폐기 및 쿠키 삭제"""
    # 모든 리프레시 토큰 폐기 (Redis에서)
    auth_service.revoke_all_user_tokens(current_user.id)

    # HTTP-Only 쿠키 삭제
    clear_refresh_token_cookie(response)

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


# ============================================================================
# Setup Status (Public - no auth required)
# ============================================================================
@router.get("/setup-status", response_model=SetupStatus)
async def get_setup_status(
    auth_service=Depends(get_auth_service),
):
    """초기 설정 상태 확인 (인증 불필요)

    시스템이 초기 설정이 필요한 상태인지 확인합니다.
    - setup_required: 초기 설정이 필요한지 여부
    - has_users: 사용자가 존재하는지 여부
    - is_default_admin: 기본 관리자 계정(admin/admin123)을 사용 중인지 여부
    """
    return auth_service.get_setup_status()
