"""
Admin Dashboard - Pydantic Schemas
환경, 스크립트, 문서, 감사 로그 등의 데이터 모델 정의
"""

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ============================================================================
# Enums
# ============================================================================
class EnvironmentType(str, Enum):
    ZEROTRUST = "zerotrust"
    LOCAL = "local"
    GCP = "gcp"
    AWS = "aws"
    PRODUCTION = "production"
    STAGING = "staging"


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    CANCELLED = "cancelled"


class UserRole(str, Enum):
    VIEWER = "viewer"
    OPERATOR = "operator"
    ADMIN = "admin"


class ServiceStatus(str, Enum):
    UP = "up"
    DOWN = "down"
    STARTING = "starting"
    STOPPING = "stopping"
    UNKNOWN = "unknown"


# ============================================================================
# Environment / Profile Models
# ============================================================================
class EnvironmentBase(BaseModel):
    name: str = Field(..., description="환경 이름 (예: zerotrust, local)")
    env_type: EnvironmentType = Field(..., description="환경 타입")
    description: Optional[str] = Field(None, description="환경 설명")
    compose_file: str = Field(..., description="Docker Compose 파일 경로")
    env_file: Optional[str] = Field(None, description="환경 변수 파일 경로")
    is_active: bool = Field(True, description="활성화 여부")
    priority: int = Field(0, description="우선순위 (높을수록 먼저 표시)")


class EnvironmentCreate(EnvironmentBase):
    pass


class EnvironmentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    compose_file: Optional[str] = None
    env_file: Optional[str] = None
    is_active: Optional[bool] = None
    priority: Optional[int] = None


class Environment(EnvironmentBase):
    id: str = Field(..., description="환경 ID")
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ============================================================================
# Environment Variable Models
# ============================================================================
class EnvVariableBase(BaseModel):
    key: str = Field(..., description="환경 변수 키")
    value: str = Field(..., description="환경 변수 값")
    is_secret: bool = Field(False, description="민감 정보 여부")
    description: Optional[str] = Field(None, description="변수 설명")


class EnvVariableCreate(EnvVariableBase):
    environment_id: str


class EnvVariableUpdate(BaseModel):
    value: Optional[str] = None
    is_secret: Optional[bool] = None
    description: Optional[str] = None
    comment: Optional[str] = Field(None, description="변경 사유")


class EnvVariable(EnvVariableBase):
    id: str
    environment_id: str
    masked_value: str = Field(..., description="마스킹된 값")
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class EnvVariableHistory(BaseModel):
    id: str
    variable_id: str
    old_value: str
    new_value: str
    changed_by: str
    comment: Optional[str]
    changed_at: datetime


# ============================================================================
# Script / Task Models
# ============================================================================
class ScriptParameter(BaseModel):
    name: str = Field(..., description="파라미터 이름")
    param_type: str = Field(
        "string", description="파라미터 타입 (string, boolean, number)"
    )
    required: bool = Field(False, description="필수 여부")
    default: Optional[Any] = Field(None, description="기본값")
    description: Optional[str] = Field(None, description="파라미터 설명")


class ScriptBase(BaseModel):
    name: str = Field(..., description="스크립트 이름")
    description: Optional[str] = Field(None, description="스크립트 설명")
    command: str = Field(..., description="실행할 명령어")
    working_dir: Optional[str] = Field(None, description="작업 디렉토리")
    risk_level: RiskLevel = Field(RiskLevel.LOW, description="위험도")
    estimated_duration: Optional[int] = Field(None, description="예상 소요 시간(초)")
    allowed_environments: list[str] = Field(
        default_factory=list, description="허용된 환경 목록"
    )
    required_role: UserRole = Field(UserRole.OPERATOR, description="필요 권한")
    parameters: list[ScriptParameter] = Field(
        default_factory=list, description="파라미터 스키마"
    )
    pre_hooks: list[str] = Field(default_factory=list, description="실행 전 후크")
    post_hooks: list[str] = Field(default_factory=list, description="실행 후 후크")
    tags: list[str] = Field(default_factory=list, description="태그")


class ScriptCreate(ScriptBase):
    pass


class ScriptUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    command: Optional[str] = None
    working_dir: Optional[str] = None
    risk_level: Optional[RiskLevel] = None
    estimated_duration: Optional[int] = None
    allowed_environments: Optional[list[str]] = None
    required_role: Optional[UserRole] = None
    parameters: Optional[list[ScriptParameter]] = None
    pre_hooks: Optional[list[str]] = None
    post_hooks: Optional[list[str]] = None
    tags: Optional[list[str]] = None


class Script(ScriptBase):
    id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ============================================================================
# Task Execution Models
# ============================================================================
class TaskExecutionRequest(BaseModel):
    script_id: str = Field(..., description="실행할 스크립트 ID")
    environment_id: str = Field(..., description="대상 환경 ID")
    parameters: dict[str, Any] = Field(
        default_factory=dict, description="실행 파라미터"
    )


class TaskExecution(BaseModel):
    id: str = Field(..., description="실행 ID")
    script_id: str
    script_name: str
    environment_id: str
    environment_name: str
    status: TaskStatus
    parameters: dict[str, Any]
    started_at: datetime
    finished_at: Optional[datetime] = None
    executed_by: str
    exit_code: Optional[int] = None
    error_message: Optional[str] = None


class TaskLog(BaseModel):
    execution_id: str
    timestamp: datetime
    level: str  # INFO, WARN, ERROR
    message: str


# ============================================================================
# Service Status Models
# ============================================================================
class ContainerInfo(BaseModel):
    name: str
    image: str
    status: ServiceStatus
    health: Optional[str] = None
    ports: list[str] = Field(default_factory=list)
    created_at: Optional[datetime] = None
    started_at: Optional[datetime] = None


class EnvironmentStatus(BaseModel):
    environment_id: str
    environment_name: str
    containers: list[ContainerInfo]
    total_containers: int
    running_containers: int
    last_deployment: Optional[datetime] = None
    deployed_by: Optional[str] = None


# ============================================================================
# Document Models
# ============================================================================
class DocumentCategory(str, Enum):
    DEPLOYMENT = "deployment"
    TROUBLESHOOTING = "troubleshooting"
    ARCHITECTURE = "architecture"
    RUNBOOK = "runbook"
    GENERAL = "general"


class DocumentBase(BaseModel):
    title: str = Field(..., description="문서 제목")
    file_path: str = Field(..., description="파일 경로")
    category: DocumentCategory = Field(DocumentCategory.GENERAL, description="카테고리")
    tags: list[str] = Field(default_factory=list, description="태그")
    related_environments: list[str] = Field(
        default_factory=list, description="관련 환경"
    )
    related_scripts: list[str] = Field(
        default_factory=list, description="관련 스크립트"
    )


class Document(DocumentBase):
    id: str
    content: Optional[str] = Field(None, description="Markdown 내용")
    last_modified: datetime

    class Config:
        from_attributes = True


# ============================================================================
# Audit Log Models
# ============================================================================
class AuditAction(str, Enum):
    LOGIN = "login"
    LOGOUT = "logout"
    VIEW = "view"
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    EXECUTE = "execute"
    DEPLOY = "deploy"
    ROLLBACK = "rollback"


class AuditLog(BaseModel):
    id: str
    user_id: str
    username: str
    action: AuditAction
    resource_type: str  # environment, script, variable, etc.
    resource_id: Optional[str] = None
    resource_name: Optional[str] = None
    environment_id: Optional[str] = None
    environment_name: Optional[str] = None
    details: dict[str, Any] = Field(default_factory=dict)
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    timestamp: datetime
    success: bool = True
    error_message: Optional[str] = None


class AuditLogFilter(BaseModel):
    user_id: Optional[str] = None
    action: Optional[AuditAction] = None
    resource_type: Optional[str] = None
    environment_id: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    success: Optional[bool] = None


# ============================================================================
# User / Auth Models
# ============================================================================
class UserBase(BaseModel):
    username: str
    email: Optional[str] = None
    role: UserRole = Field(UserRole.VIEWER)
    is_active: bool = True


class UserCreate(UserBase):
    password: str


class User(UserBase):
    id: str
    created_at: datetime
    last_login: Optional[datetime] = None
    password_change_required: bool = Field(False, description="비밀번호 변경 필요 여부")

    class Config:
        from_attributes = True


class SetupStatus(BaseModel):
    """초기 설정 상태"""

    setup_required: bool = Field(..., description="초기 설정 필요 여부")
    has_users: bool = Field(..., description="사용자 존재 여부")
    is_default_admin: bool = Field(False, description="기본 관리자 계정 사용 여부")


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class TokenData(BaseModel):
    user_id: str
    username: str
    role: UserRole
    exp: datetime


# ============================================================================
# Response Models
# ============================================================================
class PaginatedResponse(BaseModel):
    items: list[Any]
    total: int
    page: int
    page_size: int
    total_pages: int


class HealthCheck(BaseModel):
    status: str = "healthy"
    version: str
    timestamp: datetime
