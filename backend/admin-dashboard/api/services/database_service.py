"""
Database Management Service
PostgreSQL, MongoDB, Redis 데이터베이스 관리 서비스
"""

import os
from datetime import datetime
from pathlib import Path
from typing import Optional
import json

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore

from ..models.schemas import (
    DatabaseType,
    DatabaseInfo,
    PostgresDatabaseStats,
    PostgresTableInfo,
    MongoDatabaseStats,
    MongoCollectionInfo,
    RedisStats,
    ServiceHealthStatus,
)


def format_bytes(size_bytes: int) -> str:
    """바이트를 사람이 읽기 쉬운 형식으로 변환"""
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if size_bytes < 1024.0:
            return f"{size_bytes:.2f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.2f} PB"


class DatabaseService:
    """데이터베이스 관리 서비스"""

    def __init__(self, project_root: str, config_dir: str):
        self.project_root = Path(project_root)
        self.config_dir = Path(config_dir)

        # 데이터베이스 연결 정보
        self.postgres_host = os.environ.get("POSTGRES_HOST", "postgres")
        self.postgres_port = int(os.environ.get("POSTGRES_PORT", "5432"))
        self.postgres_db = os.environ.get("POSTGRES_DB", "newsinsight")
        self.postgres_user = os.environ.get("POSTGRES_USER", "postgres")
        self.postgres_password = os.environ.get("POSTGRES_PASSWORD", "postgres")

        self.mongo_host = os.environ.get("MONGO_HOST", "mongo")
        self.mongo_port = int(os.environ.get("MONGO_PORT", "27017"))
        self.mongo_db = os.environ.get("MONGO_DB", "newsinsight")

        self.redis_host = os.environ.get("REDIS_HOST", "redis")
        self.redis_port = int(os.environ.get("REDIS_PORT", "6379"))

        self.timeout = 5.0

    async def get_all_databases(self) -> list[DatabaseInfo]:
        """모든 데이터베이스 정보 조회"""
        databases = []

        # PostgreSQL
        postgres_info = await self.get_postgres_health()
        databases.append(postgres_info)

        # MongoDB
        mongo_info = await self.get_mongo_health()
        databases.append(mongo_info)

        # Redis
        redis_info = await self.get_redis_health()
        databases.append(redis_info)

        return databases

    async def get_postgres_health(self) -> DatabaseInfo:
        """PostgreSQL 헬스 정보"""
        try:
            # psycopg2 없이 TCP 연결로만 체크
            import asyncio

            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(self.postgres_host, self.postgres_port),
                timeout=self.timeout,
            )
            writer.close()
            await writer.wait_closed()

            return DatabaseInfo(
                db_type=DatabaseType.POSTGRESQL,
                name=self.postgres_db,
                host=self.postgres_host,
                port=self.postgres_port,
                status=ServiceHealthStatus.HEALTHY,
                version="15.x",  # 실제로는 쿼리로 확인 필요
                checked_at=datetime.utcnow(),
            )
        except Exception as e:
            return DatabaseInfo(
                db_type=DatabaseType.POSTGRESQL,
                name=self.postgres_db,
                host=self.postgres_host,
                port=self.postgres_port,
                status=ServiceHealthStatus.UNREACHABLE,
                checked_at=datetime.utcnow(),
            )

    async def get_mongo_health(self) -> DatabaseInfo:
        """MongoDB 헬스 정보"""
        try:
            import asyncio

            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(self.mongo_host, self.mongo_port),
                timeout=self.timeout,
            )
            writer.close()
            await writer.wait_closed()

            return DatabaseInfo(
                db_type=DatabaseType.MONGODB,
                name=self.mongo_db,
                host=self.mongo_host,
                port=self.mongo_port,
                status=ServiceHealthStatus.HEALTHY,
                version="7.x",
                checked_at=datetime.utcnow(),
            )
        except Exception as e:
            return DatabaseInfo(
                db_type=DatabaseType.MONGODB,
                name=self.mongo_db,
                host=self.mongo_host,
                port=self.mongo_port,
                status=ServiceHealthStatus.UNREACHABLE,
                checked_at=datetime.utcnow(),
            )

    async def get_redis_health(self) -> DatabaseInfo:
        """Redis 헬스 정보"""
        try:
            import asyncio

            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(self.redis_host, self.redis_port),
                timeout=self.timeout,
            )

            # PING 명령
            writer.write(b"PING\r\n")
            await writer.drain()
            response = await asyncio.wait_for(reader.readline(), timeout=2.0)
            writer.close()
            await writer.wait_closed()

            is_healthy = b"+PONG" in response

            return DatabaseInfo(
                db_type=DatabaseType.REDIS,
                name="redis",
                host=self.redis_host,
                port=self.redis_port,
                status=ServiceHealthStatus.HEALTHY
                if is_healthy
                else ServiceHealthStatus.DEGRADED,
                version="7.x",
                checked_at=datetime.utcnow(),
            )
        except Exception as e:
            return DatabaseInfo(
                db_type=DatabaseType.REDIS,
                name="redis",
                host=self.redis_host,
                port=self.redis_port,
                status=ServiceHealthStatus.UNREACHABLE,
                checked_at=datetime.utcnow(),
            )

    async def get_postgres_stats(self) -> PostgresDatabaseStats:
        """PostgreSQL 상세 통계 (실제 연결 필요)"""
        # 실제 구현에서는 psycopg2 또는 asyncpg 사용
        # 여기서는 샘플 데이터 반환
        return PostgresDatabaseStats(
            database_name=self.postgres_db,
            size_bytes=0,
            size_human="N/A",
            tables=[
                PostgresTableInfo(
                    schema_name="public",
                    table_name="news_articles",
                    row_count=0,
                    size_bytes=0,
                    size_human="N/A",
                ),
                PostgresTableInfo(
                    schema_name="public",
                    table_name="news_sources",
                    row_count=0,
                    size_bytes=0,
                    size_human="N/A",
                ),
            ],
            total_tables=0,
            total_rows=0,
            connection_count=0,
            max_connections=100,
            checked_at=datetime.utcnow(),
        )

    async def get_mongo_stats(self) -> MongoDatabaseStats:
        """MongoDB 상세 통계"""
        # 실제 구현에서는 pymongo 사용
        return MongoDatabaseStats(
            database_name=self.mongo_db,
            size_bytes=0,
            size_human="N/A",
            collections=[
                MongoCollectionInfo(
                    collection_name="ai_responses",
                    document_count=0,
                    size_bytes=0,
                    size_human="N/A",
                    index_count=1,
                ),
            ],
            total_collections=0,
            total_documents=0,
            checked_at=datetime.utcnow(),
        )

    async def get_redis_stats(self) -> RedisStats:
        """Redis 상세 통계"""
        try:
            import asyncio

            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(self.redis_host, self.redis_port),
                timeout=self.timeout,
            )

            # INFO 명령
            writer.write(b"INFO\r\n")
            await writer.drain()

            # 응답 읽기 (bulk string)
            response_lines = []
            while True:
                line = await asyncio.wait_for(reader.readline(), timeout=2.0)
                if not line or line == b"\r\n":
                    break
                response_lines.append(line.decode("utf-8", errors="ignore").strip())

            writer.close()
            await writer.wait_closed()

            # 파싱
            info = {}
            for line in response_lines:
                if ":" in line and not line.startswith("#"):
                    key, value = line.split(":", 1)
                    info[key] = value

            used_memory = int(info.get("used_memory", 0))
            keyspace_hits = int(info.get("keyspace_hits", 0))
            keyspace_misses = int(info.get("keyspace_misses", 0))
            total_requests = keyspace_hits + keyspace_misses
            hit_rate = (
                (keyspace_hits / total_requests * 100) if total_requests > 0 else 0.0
            )

            # DB0에서 키 수 추출
            db0_info = info.get("db0", "")
            total_keys = 0
            if db0_info:
                for part in db0_info.split(","):
                    if part.startswith("keys="):
                        total_keys = int(part.split("=")[1])
                        break

            return RedisStats(
                used_memory_bytes=used_memory,
                used_memory_human=format_bytes(used_memory),
                max_memory_bytes=int(info.get("maxmemory", 0)) or None,
                connected_clients=int(info.get("connected_clients", 0)),
                total_keys=total_keys,
                expired_keys=int(info.get("expired_keys", 0)),
                keyspace_hits=keyspace_hits,
                keyspace_misses=keyspace_misses,
                hit_rate=hit_rate,
                uptime_seconds=int(info.get("uptime_in_seconds", 0)),
                checked_at=datetime.utcnow(),
            )
        except Exception as e:
            return RedisStats(
                used_memory_bytes=0,
                used_memory_human="N/A",
                connected_clients=0,
                total_keys=0,
                expired_keys=0,
                keyspace_hits=0,
                keyspace_misses=0,
                hit_rate=0.0,
                uptime_seconds=0,
                checked_at=datetime.utcnow(),
            )
