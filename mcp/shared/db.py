"""
NewsInsight MCP Shared - Database Connection Module

PostgreSQL과 MongoDB 연결을 관리하는 공유 모듈입니다.
모든 MCP 서버에서 동일한 DB 연결 로직을 사용합니다.
"""

import os
from typing import Optional, Any
from urllib.parse import urlparse

# DB 백엔드 선택: "postgres" 또는 "mongo"
DB_BACKEND = os.environ.get("DB_BACKEND", "postgres")

# PostgreSQL 접속 정보 (표준: DATABASE_URL)
POSTGRES_DSN = os.environ.get("DATABASE_URL")

# MongoDB 접속 정보 (표준: MONGODB_URI - URI에 DB명 포함)
MONGODB_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/newsinsight")

# Connection pool
_pg_conn = None
_mongo_client = None
_mongo_db = None


def get_postgres_conn():
    """
    PostgreSQL 연결을 반환합니다.
    
    싱글톤 패턴으로 연결을 재사용합니다.
    연결이 끊어진 경우 자동으로 재연결합니다.
    
    Returns:
        psycopg2 connection object
        
    Raises:
        RuntimeError: DATABASE_URL이 설정되지 않은 경우
    """
    global _pg_conn
    import psycopg2

    if _pg_conn is None or _pg_conn.closed != 0:
        if not POSTGRES_DSN:
            raise RuntimeError("DATABASE_URL (Postgres DSN)이 설정되어 있지 않습니다.")
        _pg_conn = psycopg2.connect(POSTGRES_DSN)
        _pg_conn.autocommit = True  # 읽기 전용이므로 autocommit
    return _pg_conn


def get_mongo_db():
    """
    MongoDB 데이터베이스 객체를 반환합니다.
    
    싱글톤 패턴으로 연결을 재사용합니다.
    URI에서 데이터베이스 이름을 자동으로 추출합니다.
    
    Returns:
        pymongo Database object
        
    Raises:
        RuntimeError: MONGODB_URI가 설정되지 않은 경우
    """
    global _mongo_client, _mongo_db
    from pymongo import MongoClient

    if _mongo_db is None:
        if not MONGODB_URI:
            raise RuntimeError("MONGODB_URI가 설정되어 있지 않습니다.")

        _mongo_client = MongoClient(MONGODB_URI)

        # URI에서 DB명 추출 (예: mongodb://...../newsinsight?...)
        parsed = urlparse(MONGODB_URI)
        db_name = parsed.path.lstrip("/").split("?")[0] or "newsinsight"
        _mongo_db = _mongo_client[db_name]

    return _mongo_db


def check_db_connection() -> dict:
    """
    DB 연결 상태를 확인합니다.
    
    Returns:
        dict: DB 연결 상태 정보
    """
    status = {"db_backend": DB_BACKEND}
    
    try:
        if DB_BACKEND == "postgres":
            conn = get_postgres_conn()
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
            status["postgres"] = "connected"
        elif DB_BACKEND == "mongo":
            db = get_mongo_db()
            db.command("ping")
            status["mongo"] = "connected"
    except Exception as e:
        status["db_error"] = str(e)
        status["status"] = "degraded"
    
    return status


def close_connections():
    """
    모든 DB 연결을 닫습니다.
    서버 종료 시 호출합니다.
    """
    global _pg_conn, _mongo_client, _mongo_db
    
    if _pg_conn is not None:
        try:
            _pg_conn.close()
        except:
            pass
        _pg_conn = None
    
    if _mongo_client is not None:
        try:
            _mongo_client.close()
        except:
            pass
        _mongo_client = None
        _mongo_db = None
