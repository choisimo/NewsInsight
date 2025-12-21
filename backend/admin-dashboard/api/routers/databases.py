"""
Database Management Router
PostgreSQL, MongoDB, Redis 데이터베이스 관리 API
"""

from fastapi import APIRouter, Depends, HTTPException

from ..models.schemas import (
    DatabaseType,
    DatabaseInfo,
    PostgresDatabaseStats,
    MongoDatabaseStats,
    RedisStats,
    UserRole,
)
from ..dependencies import get_current_user, require_role, get_database_service
from ..services.database_service import DatabaseService

router = APIRouter(prefix="/databases", tags=["Database Management"])


@router.get("", response_model=list[DatabaseInfo])
async def list_databases(
    service: DatabaseService = Depends(get_database_service),
    current_user=Depends(get_current_user),
):
    """모든 데이터베이스 정보 조회"""
    return await service.get_all_databases()


@router.get("/postgres/health", response_model=DatabaseInfo)
async def check_postgres_health(
    service: DatabaseService = Depends(get_database_service),
    current_user=Depends(get_current_user),
):
    """PostgreSQL 헬스 체크"""
    return await service.get_postgres_health()


@router.get("/mongo/health", response_model=DatabaseInfo)
async def check_mongo_health(
    service: DatabaseService = Depends(get_database_service),
    current_user=Depends(get_current_user),
):
    """MongoDB 헬스 체크"""
    return await service.get_mongo_health()


@router.get("/redis/health", response_model=DatabaseInfo)
async def check_redis_health(
    service: DatabaseService = Depends(get_database_service),
    current_user=Depends(get_current_user),
):
    """Redis 헬스 체크"""
    return await service.get_redis_health()


@router.get("/{db_type}/health", response_model=DatabaseInfo)
async def check_database_health(
    db_type: str,
    service: DatabaseService = Depends(get_database_service),
    current_user=Depends(get_current_user),
):
    """특정 데이터베이스 헬스 체크"""
    db_type_lower = db_type.lower()

    if db_type_lower in ("postgres", "postgresql"):
        return await service.get_postgres_health()
    elif db_type_lower in ("mongo", "mongodb"):
        return await service.get_mongo_health()
    elif db_type_lower == "redis":
        return await service.get_redis_health()
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown database type: {db_type}. Supported: postgres, mongo, redis",
        )


@router.get("/postgres/stats", response_model=PostgresDatabaseStats)
async def get_postgres_stats(
    service: DatabaseService = Depends(get_database_service),
    current_user=Depends(get_current_user),
):
    """PostgreSQL 상세 통계"""
    return await service.get_postgres_stats()


@router.get("/mongo/stats", response_model=MongoDatabaseStats)
async def get_mongo_stats(
    service: DatabaseService = Depends(get_database_service),
    current_user=Depends(get_current_user),
):
    """MongoDB 상세 통계"""
    return await service.get_mongo_stats()


@router.get("/redis/stats", response_model=RedisStats)
async def get_redis_stats(
    service: DatabaseService = Depends(get_database_service),
    current_user=Depends(get_current_user),
):
    """Redis 상세 통계"""
    return await service.get_redis_stats()
