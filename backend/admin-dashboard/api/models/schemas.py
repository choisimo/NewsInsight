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
    USER = "user"  # 일반 사용자 (회원가입)
    VIEWER = "viewer"  # 관리자용 - 읽기 전용
    OPERATOR = "operator"  # 관리자용 - 운영자
    ADMIN = "admin"  # 관리자용 - 최고 관리자


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
    role: UserRole = Field(UserRole.USER)
    is_active: bool = True


class UserCreate(UserBase):
    password: str


class UserRegister(BaseModel):
    """일반 사용자 회원가입용 스키마"""

    username: str = Field(
        ..., min_length=3, max_length=50, description="사용자명 (3-50자)"
    )
    email: str = Field(..., description="이메일 주소")
    password: str = Field(..., min_length=8, description="비밀번호 (8자 이상)")


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


# ============================================================================
# Service Health Monitoring Models
# ============================================================================
class ServiceHealthStatus(str, Enum):
    HEALTHY = "healthy"
    UNHEALTHY = "unhealthy"
    DEGRADED = "degraded"
    UNREACHABLE = "unreachable"
    UNKNOWN = "unknown"


class ServiceHealth(BaseModel):
    service_id: str = Field(..., description="서비스 ID")
    name: str = Field(..., description="서비스 이름")
    status: ServiceHealthStatus = Field(..., description="헬스 상태")
    message: Optional[str] = Field(default=None, description="상태 메시지")
    response_time_ms: Optional[float] = Field(default=None, description="응답 시간(ms)")
    url: Optional[str] = Field(default=None, description="헬스체크 URL")
    checked_at: datetime = Field(..., description="체크 시간")
    details: Optional[dict[str, Any]] = Field(default=None, description="상세 정보")

    class Config:
        from_attributes = True


class InfrastructureHealth(BaseModel):
    service_id: str = Field(..., description="인프라 서비스 ID")
    name: str = Field(..., description="인프라 이름")
    status: ServiceHealthStatus = Field(..., description="헬스 상태")
    message: Optional[str] = Field(default=None, description="상태 메시지")
    port: Optional[int] = Field(default=None, description="포트")
    checked_at: datetime = Field(..., description="체크 시간")
    details: Optional[dict[str, Any]] = Field(default=None, description="상세 정보")

    class Config:
        from_attributes = True


class OverallSystemHealth(BaseModel):
    status: ServiceHealthStatus = Field(..., description="전체 시스템 상태")
    total_services: int = Field(..., description="전체 서비스 수")
    healthy_services: int = Field(..., description="정상 서비스 수")
    unhealthy_services: int = Field(..., description="비정상 서비스 수")
    degraded_services: int = Field(..., description="저하 서비스 수")
    total_infrastructure: int = Field(..., description="전체 인프라 수")
    healthy_infrastructure: int = Field(..., description="정상 인프라 수")
    average_response_time_ms: Optional[float] = Field(
        None, description="평균 응답 시간"
    )
    services: list[ServiceHealth] = Field(
        default_factory=list, description="서비스 헬스 목록"
    )
    infrastructure: list[InfrastructureHealth] = Field(
        default_factory=list, description="인프라 헬스 목록"
    )
    checked_at: datetime = Field(..., description="체크 시간")

    class Config:
        from_attributes = True


class ServiceMetrics(BaseModel):
    service_id: str
    cpu_usage_percent: Optional[float] = None
    memory_usage_mb: Optional[float] = None
    memory_limit_mb: Optional[float] = None
    request_count: Optional[int] = None
    error_count: Optional[int] = None
    avg_response_time_ms: Optional[float] = None
    collected_at: datetime

    class Config:
        from_attributes = True


class ServiceInfo(BaseModel):
    id: str = Field(..., description="서비스 ID")
    name: str = Field(..., description="서비스 이름")
    description: Optional[str] = Field(None, description="설명")
    port: Optional[int] = Field(None, description="포트")
    healthcheck: str = Field("/health", description="헬스체크 경로")
    hostname: str = Field(..., description="호스트명")
    type: str = Field(..., description="서비스 타입")
    tags: list[str] = Field(default_factory=list, description="태그")


# ============================================================================
# Data Source Management Models
# ============================================================================
class DataSourceType(str, Enum):
    RSS = "rss"
    WEB = "web"
    API = "api"
    SOCIAL = "social"


class DataSourceStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    ERROR = "error"
    TESTING = "testing"


class DataSourceBase(BaseModel):
    name: str = Field(..., description="소스 이름")
    source_type: DataSourceType = Field(..., description="소스 타입")
    url: str = Field(..., description="소스 URL")
    description: Optional[str] = Field(None, description="설명")
    category: Optional[str] = Field(None, description="카테고리")
    language: str = Field("ko", description="언어")
    is_active: bool = Field(True, description="활성화 여부")
    crawl_interval_minutes: int = Field(60, description="수집 주기(분)")
    priority: int = Field(0, description="우선순위")
    config: dict[str, Any] = Field(default_factory=dict, description="추가 설정")


class DataSourceCreate(DataSourceBase):
    pass


class DataSourceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    url: Optional[str] = None
    category: Optional[str] = None
    is_active: Optional[bool] = None
    crawl_interval_minutes: Optional[int] = None
    priority: Optional[int] = None
    config: Optional[dict[str, Any]] = None


class DataSource(DataSourceBase):
    id: str = Field(..., description="소스 ID")
    status: DataSourceStatus = Field(
        default=DataSourceStatus.ACTIVE, description="상태"
    )
    last_crawled_at: Optional[datetime] = Field(
        default=None, description="마지막 수집 시간"
    )
    total_articles: int = Field(default=0, description="총 수집 기사 수")
    success_rate: float = Field(default=100.0, description="성공률")
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class DataSourceStats(BaseModel):
    source_id: str
    total_crawls: int = 0
    successful_crawls: int = 0
    failed_crawls: int = 0
    total_articles: int = 0
    avg_articles_per_crawl: float = 0.0
    last_error: Optional[str] = None
    last_error_at: Optional[datetime] = None


class DataSourceTestResult(BaseModel):
    source_id: str
    success: bool
    message: str
    response_time_ms: Optional[float] = None
    sample_data: Optional[dict[str, Any]] = None
    tested_at: datetime


# ============================================================================
# Database Management Models
# ============================================================================
class DatabaseType(str, Enum):
    POSTGRESQL = "postgresql"
    MONGODB = "mongodb"
    REDIS = "redis"


class DatabaseInfo(BaseModel):
    db_type: DatabaseType
    name: str
    host: str
    port: int
    status: ServiceHealthStatus
    version: Optional[str] = None
    size_bytes: Optional[int] = None
    size_human: Optional[str] = None
    connection_count: Optional[int] = None
    max_connections: Optional[int] = None
    uptime_seconds: Optional[int] = None
    checked_at: datetime


class PostgresTableInfo(BaseModel):
    schema_name: str
    table_name: str
    row_count: int
    size_bytes: int
    size_human: str
    index_size_bytes: Optional[int] = None
    last_vacuum: Optional[datetime] = None
    last_analyze: Optional[datetime] = None


class PostgresDatabaseStats(BaseModel):
    database_name: str
    size_bytes: int
    size_human: str
    tables: list[PostgresTableInfo]
    total_tables: int
    total_rows: int
    connection_count: int
    max_connections: int
    checked_at: datetime


class MongoCollectionInfo(BaseModel):
    collection_name: str
    document_count: int
    size_bytes: int
    size_human: str
    avg_document_size_bytes: Optional[int] = None
    index_count: int
    total_index_size_bytes: Optional[int] = None


class MongoDatabaseStats(BaseModel):
    database_name: str
    size_bytes: int
    size_human: str
    collections: list[MongoCollectionInfo]
    total_collections: int
    total_documents: int
    checked_at: datetime


class RedisStats(BaseModel):
    used_memory_bytes: int
    used_memory_human: str
    max_memory_bytes: Optional[int] = None
    connected_clients: int
    total_keys: int
    expired_keys: int
    keyspace_hits: int
    keyspace_misses: int
    hit_rate: float
    uptime_seconds: int
    checked_at: datetime


# ============================================================================
# Kafka/Redpanda Management Models
# ============================================================================
class KafkaTopicInfo(BaseModel):
    name: str
    partition_count: int
    replication_factor: int
    message_count: Optional[int] = None
    size_bytes: Optional[int] = None
    retention_ms: Optional[int] = None
    is_internal: bool = False


class KafkaConsumerGroupInfo(BaseModel):
    group_id: str
    state: str
    members_count: int
    topics: list[str]
    total_lag: int
    lag_per_partition: dict[str, int]


class KafkaClusterInfo(BaseModel):
    broker_count: int
    controller_id: Optional[int] = None
    cluster_id: Optional[str] = None
    topics: list[KafkaTopicInfo]
    consumer_groups: list[KafkaConsumerGroupInfo]
    total_topics: int
    total_partitions: int
    total_messages: Optional[int] = None
    checked_at: datetime
