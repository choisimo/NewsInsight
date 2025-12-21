"""
FastAPI Dependencies - 의존성 주입
"""

import os
from functools import lru_cache
from typing import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from .models.schemas import User, UserRole
from .services.audit_service import AuditService
from .services.auth_service import AuthService
from .services.document_service import DocumentService
from .services.environment_service import EnvironmentService
from .services.script_service import ScriptService
from .services.health_service import HealthService
from .services.data_source_service import DataSourceService
from .services.database_service import DatabaseService
from .services.kafka_service import KafkaService

# OAuth2 스킴
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/admin/auth/token")

# 프로젝트 경로 설정
PROJECT_ROOT = os.environ.get(
    "PROJECT_ROOT",
    os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    ),
)
CONFIG_DIR = os.environ.get(
    "ADMIN_CONFIG_DIR",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "config"),
)
# SECRET_KEY는 반드시 환경변수로 설정해야 합니다
# 프로덕션 환경에서는 강력한 랜덤 키를 사용하세요 (예: openssl rand -hex 32)
_default_secret = "your-secret-key-change-in-production"
SECRET_KEY = os.environ.get("ADMIN_SECRET_KEY", _default_secret)

# 프로덕션 환경에서 기본 시크릿 키 사용 시 경고
if SECRET_KEY == _default_secret:
    import warnings
    warnings.warn(
        "🔴 SECURITY WARNING: Using default SECRET_KEY! "
        "Set ADMIN_SECRET_KEY environment variable in production. "
        "Generate a secure key with: openssl rand -hex 32",
        UserWarning,
    )


@lru_cache()
def get_auth_service() -> AuthService:
    """인증 서비스 인스턴스"""
    return AuthService(
        config_dir=CONFIG_DIR,
        secret_key=SECRET_KEY,
    )


@lru_cache()
def get_environment_service() -> EnvironmentService:
    """환경 서비스 인스턴스"""
    return EnvironmentService(
        project_root=PROJECT_ROOT,
        config_dir=CONFIG_DIR,
    )


@lru_cache()
def get_script_service() -> ScriptService:
    """스크립트 서비스 인스턴스"""
    return ScriptService(
        project_root=PROJECT_ROOT,
        config_dir=CONFIG_DIR,
    )


@lru_cache()
def get_document_service() -> DocumentService:
    """문서 서비스 인스턴스"""
    return DocumentService(
        project_root=PROJECT_ROOT,
        config_dir=CONFIG_DIR,
    )


@lru_cache()
def get_audit_service() -> AuditService:
    """감사 서비스 인스턴스"""
    return AuditService(config_dir=CONFIG_DIR)


@lru_cache()
def get_health_service() -> HealthService:
    """헬스 모니터링 서비스 인스턴스"""
    return HealthService(
        project_root=PROJECT_ROOT,
        config_dir=CONFIG_DIR,
    )


@lru_cache()
def get_data_source_service() -> DataSourceService:
    """데이터 소스 서비스 인스턴스"""
    return DataSourceService(
        project_root=PROJECT_ROOT,
        config_dir=CONFIG_DIR,
    )


@lru_cache()
def get_database_service() -> DatabaseService:
    """데이터베이스 관리 서비스 인스턴스"""
    return DatabaseService(
        project_root=PROJECT_ROOT,
        config_dir=CONFIG_DIR,
    )


@lru_cache()
def get_kafka_service() -> KafkaService:
    """Kafka/Redpanda 모니터링 서비스 인스턴스"""
    return KafkaService(
        project_root=PROJECT_ROOT,
        config_dir=CONFIG_DIR,
    )


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    auth_service: AuthService = Depends(get_auth_service),
) -> User:
    """현재 인증된 사용자 조회"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    token_data = auth_service.verify_token(token)
    if not token_data:
        raise credentials_exception

    user = auth_service.get_user(token_data.user_id)
    if not user:
        raise credentials_exception

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is disabled",
        )

    return user


def require_role(required_role: UserRole) -> Callable:
    """특정 역할 이상 권한 요구"""

    async def role_checker(
        current_user: User = Depends(get_current_user),
        auth_service: AuthService = Depends(get_auth_service),
    ) -> User:
        if not auth_service.check_permission(current_user.role, required_role):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires {required_role.value} permission or higher",
            )
        return current_user

    return role_checker
