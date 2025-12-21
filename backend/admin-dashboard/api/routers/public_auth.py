"""
Public Auth Router - 일반 사용자용 인증 API (공개 엔드포인트)

- 회원가입: 인증 불필요
- 로그인: 인증 불필요
- 내 정보: 인증 필요
- 로그아웃: 인증 필요
- 비밀번호 변경: 인증 필요
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, Field

from ..models.schemas import AuditAction, Token, User, UserRegister, UserRole
from ..dependencies import (
    get_audit_service,
    get_auth_service,
    get_current_user,
)

router = APIRouter(prefix="/auth", tags=["Public Authentication"])


class RegisterRequest(BaseModel):
    """회원가입 요청"""

    username: str = Field(..., min_length=3, max_length=50, description="사용자명")
    email: EmailStr = Field(..., description="이메일 주소")
    password: str = Field(..., min_length=8, description="비밀번호 (8자 이상)")


class ChangePasswordRequest(BaseModel):
    """비밀번호 변경 요청"""

    old_password: str
    new_password: str = Field(..., min_length=8, description="새 비밀번호 (8자 이상)")


class UserPublicResponse(BaseModel):
    """일반 사용자 응답 (민감 정보 제외)"""

    id: str
    username: str
    email: str | None
    role: UserRole
    created_at: str


# ============================================================================
# Public Endpoints (No Auth Required)
# ============================================================================
@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
async def register(
    request: RegisterRequest,
    auth_service=Depends(get_auth_service),
    audit_service=Depends(get_audit_service),
):
    """
    회원가입 (공개 API)

    - 사용자명은 3-50자
    - 비밀번호는 8자 이상
    - 이메일은 유효한 형식이어야 함
    - 가입 즉시 로그인 토큰 반환
    """
    try:
        # 일반 사용자로 가입 (role: USER)
        user = auth_service.register_user(
            username=request.username,
            email=request.email,
            password=request.password,
        )

        # 가입 성공 시 바로 토큰 발급
        token = auth_service.create_access_token(user)

        # 감사 로그
        audit_service.log(
            user_id=user.id,
            username=user.username,
            action=AuditAction.CREATE,
            resource_type="user_registration",
            resource_id=user.id,
            success=True,
            details={"email": request.email},
        )

        return token

    except ValueError as e:
        # 중복 사용자명/이메일 등
        audit_service.log(
            user_id="unknown",
            username=request.username,
            action=AuditAction.CREATE,
            resource_type="user_registration",
            success=False,
            error_message=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post("/login", response_model=Token)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    auth_service=Depends(get_auth_service),
    audit_service=Depends(get_audit_service),
):
    """
    로그인 (공개 API)

    일반 사용자와 관리자 모두 사용 가능
    """
    user = auth_service.authenticate(form_data.username, form_data.password)

    if not user:
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
            detail="아이디 또는 비밀번호가 올바르지 않습니다",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = auth_service.create_access_token(user)

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


# ============================================================================
# Protected Endpoints (Auth Required)
# ============================================================================
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
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.LOGOUT,
        resource_type="auth",
    )

    return {"success": True, "message": "로그아웃되었습니다"}


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
            detail="현재 비밀번호가 올바르지 않습니다",
        )

    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.UPDATE,
        resource_type="password",
        success=True,
    )

    return {"success": True, "message": "비밀번호가 변경되었습니다"}


@router.delete("/me")
async def delete_my_account(
    current_user=Depends(get_current_user),
    auth_service=Depends(get_auth_service),
    audit_service=Depends(get_audit_service),
):
    """
    내 계정 삭제 (회원탈퇴)

    주의: 이 작업은 되돌릴 수 없습니다.
    """
    # 관리자 계정은 자기 삭제 불가
    if current_user.role == UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="관리자 계정은 직접 삭제할 수 없습니다",
        )

    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.DELETE,
        resource_type="user_account",
        resource_id=current_user.id,
        success=True,
    )

    auth_service.delete_user(current_user.id)

    return {"success": True, "message": "계정이 삭제되었습니다"}


# ============================================================================
# Username/Email Availability Check (Public)
# ============================================================================
@router.get("/check-username/{username}")
async def check_username_availability(
    username: str,
    auth_service=Depends(get_auth_service),
):
    """사용자명 사용 가능 여부 확인"""
    exists = auth_service.get_user_by_username(username) is not None
    return {
        "username": username,
        "available": not exists,
    }


@router.get("/check-email/{email}")
async def check_email_availability(
    email: str,
    auth_service=Depends(get_auth_service),
):
    """이메일 사용 가능 여부 확인"""
    exists = auth_service.get_user_by_email(email) is not None
    return {
        "email": email,
        "available": not exists,
    }


# ============================================================================
# Email Verification Endpoints (for Registration)
# ============================================================================
class SendVerificationRequest(BaseModel):
    """이메일 인증 요청"""
    username: str = Field(..., min_length=3, max_length=50, description="사용자명")
    email: EmailStr = Field(..., description="이메일 주소")
    password: str = Field(..., min_length=8, description="비밀번호 (8자 이상)")


class VerifyEmailRequest(BaseModel):
    """이메일 인증 코드 검증 요청"""
    email: EmailStr = Field(..., description="이메일 주소")
    code: str = Field(..., min_length=6, max_length=6, description="6자리 인증 코드")


class ResendVerificationRequest(BaseModel):
    """인증 코드 재발송 요청"""
    email: EmailStr = Field(..., description="이메일 주소")


@router.post("/send-verification")
async def send_verification_code(
    request: SendVerificationRequest,
    auth_service=Depends(get_auth_service),
    audit_service=Depends(get_audit_service),
):
    """
    이메일 인증 코드 발송 (회원가입 1단계)
    
    - 사용자명, 이메일, 비밀번호를 저장하고 인증 코드 생성
    - 실제 이메일 발송은 별도 서비스 연동 필요
    - 10분간 유효한 6자리 인증 코드 반환
    """
    try:
        code = auth_service.create_email_verification(
            email=request.email,
            username=request.username,
            password=request.password,
        )
        
        # TODO: 실제 이메일 발송 로직 (SMTP, SendGrid, AWS SES 등)
        # await send_email(
        #     to=request.email,
        #     subject="[NewsInsight] 이메일 인증 코드",
        #     body=f"인증 코드: {code}\n\n10분 이내에 입력해주세요."
        # )
        
        audit_service.log(
            user_id="unknown",
            username=request.username,
            action=AuditAction.CREATE,
            resource_type="email_verification",
            success=True,
            details={"email": request.email},
        )
        
        # NOTE: 인증 코드는 보안상 응답에 포함하지 않음
        # 개발/테스트 환경에서는 로그로 확인하거나 DEBUG_EMAIL_CODE 환경변수 사용
        import os
        response = {
            "success": True,
            "message": "인증 코드가 이메일로 발송되었습니다.",
            "email": request.email,
            "expires_in": 600,  # 10분
        }
        
        # 개발 환경에서만 코드 반환 (DEBUG_EMAIL_CODE=true 설정 필요)
        if os.getenv("DEBUG_EMAIL_CODE", "false").lower() == "true":
            response["code"] = code
            
        return response
        
    except ValueError as e:
        audit_service.log(
            user_id="unknown",
            username=request.username,
            action=AuditAction.CREATE,
            resource_type="email_verification",
            success=False,
            error_message=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post("/verify-email", response_model=Token)
async def verify_email_code(
    request: VerifyEmailRequest,
    auth_service=Depends(get_auth_service),
    audit_service=Depends(get_audit_service),
):
    """
    이메일 인증 코드 검증 및 회원가입 완료 (회원가입 2단계)
    
    - 올바른 인증 코드 입력 시 회원가입 완료
    - 가입 성공 시 로그인 토큰 반환
    - 최대 5회 시도 가능
    """
    try:
        user = auth_service.verify_email_code(
            email=request.email,
            code=request.code,
        )
        
        # 토큰 발급
        token = auth_service.create_access_token(user)
        
        audit_service.log(
            user_id=user.id,
            username=user.username,
            action=AuditAction.CREATE,
            resource_type="user_registration",
            resource_id=user.id,
            success=True,
            details={"email": request.email, "verified": True},
        )
        
        return token
        
    except ValueError as e:
        audit_service.log(
            user_id="unknown",
            username="unknown",
            action=AuditAction.UPDATE,
            resource_type="email_verification",
            success=False,
            error_message=str(e),
            details={"email": request.email},
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post("/resend-verification")
async def resend_verification_code(
    request: ResendVerificationRequest,
    auth_service=Depends(get_auth_service),
    audit_service=Depends(get_audit_service),
):
    """
    인증 코드 재발송
    
    - 기존 인증 요청이 있는 경우에만 가능
    - 새로운 6자리 코드 생성 및 유효 시간 초기화
    """
    try:
        code = auth_service.resend_verification_code(request.email)
        
        # TODO: 실제 이메일 발송 로직
        
        audit_service.log(
            user_id="unknown",
            username="unknown",
            action=AuditAction.UPDATE,
            resource_type="email_verification",
            success=True,
            details={"email": request.email, "action": "resend"},
        )
        
        # NOTE: 인증 코드는 보안상 응답에 포함하지 않음
        import os
        response = {
            "success": True,
            "message": "인증 코드가 재발송되었습니다.",
            "email": request.email,
            "expires_in": 600,
        }
        
        # 개발 환경에서만 코드 반환 (DEBUG_EMAIL_CODE=true 설정 필요)
        if os.getenv("DEBUG_EMAIL_CODE", "false").lower() == "true":
            response["code"] = code
            
        return response
        
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
