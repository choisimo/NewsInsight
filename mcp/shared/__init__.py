"""
NewsInsight MCP Shared Module

공통 기능을 제공하는 공유 모듈:
- DB 연결 (PostgreSQL, MongoDB)
- Health check 엔드포인트
- AiDove 호출 헬퍼
- 공통 유틸리티
"""

from .db import (
    get_postgres_conn,
    get_mongo_db,
    DB_BACKEND,
    POSTGRES_DSN,
    MONGODB_URI,
)
from .health import create_health_endpoint, HealthCheckHandler
from .aidove import call_aidove, AIDOVE_WEBHOOK_URL
from .utils import parse_json

__all__ = [
    # DB
    "get_postgres_conn",
    "get_mongo_db",
    "DB_BACKEND",
    "POSTGRES_DSN",
    "MONGODB_URI",
    # Health
    "create_health_endpoint",
    "HealthCheckHandler",
    # AiDove
    "call_aidove",
    "AIDOVE_WEBHOOK_URL",
    # Utils
    "parse_json",
]
