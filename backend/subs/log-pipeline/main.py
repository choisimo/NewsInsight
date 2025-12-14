"""
Unified Log Pipeline Service

This service consumes logs from Kafka and writes to:
- MongoDB (raw logs with TTL)
- PostgreSQL (structured logs for analytics)
- Redis (recent logs cache)

Also provides REST API for log queries.
"""

import asyncio
import json
import logging
import os
import signal
import uuid
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager

import asyncpg
import httpx
from aiokafka import AIOKafkaConsumer
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import redis.asyncio as aioredis

# =============================================
# Configuration
# =============================================

class Config:
    # Kafka
    KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "redpanda:9092")
    KAFKA_TOPIC = os.getenv("KAFKA_TOPIC", "system-logs")
    KAFKA_GROUP_ID = os.getenv("KAFKA_GROUP_ID", "log-consumer-group")
    KAFKA_AUTO_OFFSET_RESET = os.getenv("KAFKA_AUTO_OFFSET_RESET", "earliest")
    
    # PostgreSQL
    PG_HOST = os.getenv("POSTGRES_HOST", "postgres")
    PG_PORT = int(os.getenv("POSTGRES_PORT", "5432"))
    PG_DB = os.getenv("POSTGRES_DB", "osint_db")
    PG_USER = os.getenv("POSTGRES_USER", "osint_user")
    PG_PASSWORD = os.getenv("POSTGRES_PASSWORD", "osint_password")
    
    # MongoDB
    MONGO_URL = os.getenv("MONGO_URL", "mongodb://mongo:27017")
    MONGO_DB = os.getenv("MONGO_DB", "logs_db")
    MONGO_COLLECTION = os.getenv("MONGO_COLLECTION", "raw_logs")
    
    # Redis
    REDIS_HOST = os.getenv("REDIS_HOST", "redis")
    REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
    REDIS_RECENT_KEY = "logs:recent"
    REDIS_ERRORS_KEY = "logs:errors"
    REDIS_MAX_RECENT = 1000
    REDIS_MAX_ERRORS = 500
    
    # Service
    PORT = int(os.getenv("PORT", "8030"))
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
    BATCH_SIZE = int(os.getenv("BATCH_SIZE", "100"))
    BATCH_TIMEOUT_MS = int(os.getenv("BATCH_TIMEOUT_MS", "5000"))


config = Config()

# Logging setup
logging.basicConfig(
    level=getattr(logging, config.LOG_LEVEL),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# =============================================
# Pydantic Models
# =============================================

class LogEntry(BaseModel):
    """Standard log entry schema from producers."""
    trace_id: Optional[str] = None
    span_id: Optional[str] = None
    parent_span_id: Optional[str] = None
    timestamp: str
    service: str
    level: str = "INFO"
    type: Optional[str] = None  # INBOUND / OUTBOUND / INTERNAL
    method: Optional[str] = None
    path: Optional[str] = None
    status: Optional[int] = None
    latency_ms: Optional[int] = None
    error_msg: Optional[str] = None
    error_code: Optional[str] = None
    user_id: Optional[str] = None
    client_ip: Optional[str] = None
    user_agent: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None


class LogSearchRequest(BaseModel):
    """Search request parameters."""
    service: Optional[str] = None
    level: Optional[str] = None
    status_min: Optional[int] = None
    status_max: Optional[int] = None
    path: Optional[str] = None
    from_ts: Optional[str] = None
    to_ts: Optional[str] = None
    keyword: Optional[str] = None
    limit: int = Field(default=50, le=500)
    offset: int = Field(default=0, ge=0)


class LogSearchResult(BaseModel):
    """Search result item."""
    id: int
    trace_id: Optional[str]
    timestamp: str
    service: str
    level: str
    type: Optional[str]
    method: Optional[str]
    path: Optional[str]
    status: Optional[int]
    latency_ms: Optional[int]
    error_msg: Optional[str]
    has_payload: bool


class LogSearchResponse(BaseModel):
    """Search response."""
    total: int
    results: List[LogSearchResult]
    query: LogSearchRequest


class LogStatsResponse(BaseModel):
    """Log statistics response."""
    total_logs: int
    error_count: int
    error_rate: float
    avg_latency_ms: Optional[float]
    p95_latency_ms: Optional[float]
    services: List[Dict[str, Any]]


# =============================================
# Database Clients
# =============================================

class DatabaseClients:
    """Manages all database connections."""
    
    def __init__(self):
        self.pg_pool: Optional[asyncpg.Pool] = None
        self.redis: Optional[aioredis.Redis] = None
        self.mongo_client = None
        self.mongo_db = None
        
    async def init_postgres(self):
        """Initialize PostgreSQL connection pool."""
        try:
            self.pg_pool = await asyncpg.create_pool(
                host=config.PG_HOST,
                port=config.PG_PORT,
                database=config.PG_DB,
                user=config.PG_USER,
                password=config.PG_PASSWORD,
                min_size=5,
                max_size=20
            )
            logger.info("PostgreSQL connection pool initialized")
        except Exception as e:
            logger.error(f"Failed to connect to PostgreSQL: {e}")
            raise
    
    async def init_redis(self):
        """Initialize Redis connection."""
        try:
            self.redis = aioredis.Redis(
                host=config.REDIS_HOST,
                port=config.REDIS_PORT,
                decode_responses=True
            )
            await self.redis.ping()
            logger.info("Redis connection initialized")
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
            raise
    
    async def init_mongo(self):
        """Initialize MongoDB connection."""
        try:
            from motor.motor_asyncio import AsyncIOMotorClient
            self.mongo_client = AsyncIOMotorClient(config.MONGO_URL)
            self.mongo_db = self.mongo_client[config.MONGO_DB]
            
            # Create TTL index for 7-day retention
            collection = self.mongo_db[config.MONGO_COLLECTION]
            await collection.create_index(
                "timestamp",
                expireAfterSeconds=60 * 60 * 24 * 7  # 7 days
            )
            logger.info("MongoDB connection initialized with TTL index")
        except Exception as e:
            logger.error(f"Failed to connect to MongoDB: {e}")
            # MongoDB is optional, continue without it
            logger.warning("Continuing without MongoDB - raw payloads will not be stored")
    
    async def close(self):
        """Close all connections."""
        if self.pg_pool:
            await self.pg_pool.close()
        if self.redis:
            await self.redis.close()
        if self.mongo_client:
            self.mongo_client.close()


db = DatabaseClients()

# =============================================
# Log Writer
# =============================================

class LogWriter:
    """Writes logs to all storage backends."""
    
    @staticmethod
    async def write_to_postgres(logs: List[LogEntry]) -> int:
        """Batch insert logs to PostgreSQL."""
        if not db.pg_pool or not logs:
            return 0
        
        query = """
            INSERT INTO service_logs (
                trace_id, span_id, parent_span_id, timestamp, service, level,
                type, method, path, status, latency_ms, error_msg, error_code,
                user_id, client_ip, user_agent, has_payload, mongo_ref, metadata
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
            )
        """
        
        try:
            async with db.pg_pool.acquire() as conn:
                records = []
                for log in logs:
                    # Parse trace_id as UUID if valid
                    trace_id = None
                    if log.trace_id:
                        try:
                            trace_id = uuid.UUID(log.trace_id)
                        except ValueError:
                            trace_id = None
                    
                    # Parse timestamp
                    try:
                        ts = datetime.fromisoformat(log.timestamp.replace('Z', '+00:00'))
                    except:
                        ts = datetime.now(timezone.utc)
                    
                    # Generate mongo_ref if payload exists
                    mongo_ref = str(uuid.uuid4()) if log.payload else None
                    
                    records.append((
                        trace_id,
                        log.span_id,
                        log.parent_span_id,
                        ts,
                        log.service,
                        log.level,
                        log.type,
                        log.method,
                        log.path,
                        log.status,
                        log.latency_ms,
                        log.error_msg,
                        log.error_code,
                        log.user_id,
                        log.client_ip,
                        log.user_agent,
                        log.payload is not None,
                        mongo_ref,
                        json.dumps(log.metadata) if log.metadata else None
                    ))
                
                await conn.executemany(query, records)
                return len(records)
        except Exception as e:
            logger.error(f"Failed to write to PostgreSQL: {e}")
            return 0
    
    @staticmethod
    async def write_to_redis(logs: List[LogEntry]):
        """Push logs to Redis lists."""
        if not db.redis or not logs:
            return
        
        try:
            pipe = db.redis.pipeline()
            
            for log in logs:
                log_json = log.model_dump_json()
                
                # Push to recent logs
                pipe.lpush(config.REDIS_RECENT_KEY, log_json)
                
                # Push errors to separate list
                if log.level == "ERROR" or (log.status and log.status >= 500):
                    pipe.lpush(config.REDIS_ERRORS_KEY, log_json)
            
            # Trim lists to max size
            pipe.ltrim(config.REDIS_RECENT_KEY, 0, config.REDIS_MAX_RECENT - 1)
            pipe.ltrim(config.REDIS_ERRORS_KEY, 0, config.REDIS_MAX_ERRORS - 1)
            
            await pipe.execute()
        except Exception as e:
            logger.error(f"Failed to write to Redis: {e}")
    
    @staticmethod
    async def write_to_mongo(logs: List[LogEntry]):
        """Insert raw logs with payload to MongoDB."""
        if not db.mongo_db or not logs:
            return
        
        try:
            collection = db.mongo_db[config.MONGO_COLLECTION]
            
            documents = []
            for log in logs:
                if log.payload:  # Only store if has payload
                    doc = log.model_dump()
                    doc["_id"] = str(uuid.uuid4())
                    doc["timestamp"] = datetime.fromisoformat(
                        log.timestamp.replace('Z', '+00:00')
                    )
                    documents.append(doc)
            
            if documents:
                await collection.insert_many(documents)
        except Exception as e:
            logger.error(f"Failed to write to MongoDB: {e}")


# =============================================
# Kafka Consumer
# =============================================

class KafkaLogConsumer:
    """Consumes logs from Kafka and writes to storage."""
    
    def __init__(self):
        self.consumer: Optional[AIOKafkaConsumer] = None
        self.running = False
        self.batch: List[LogEntry] = []
        self.last_flush = datetime.now()
    
    async def start(self):
        """Start the Kafka consumer."""
        self.consumer = AIOKafkaConsumer(
            config.KAFKA_TOPIC,
            bootstrap_servers=config.KAFKA_BOOTSTRAP_SERVERS,
            group_id=config.KAFKA_GROUP_ID,
            auto_offset_reset=config.KAFKA_AUTO_OFFSET_RESET,
            enable_auto_commit=True,
            value_deserializer=lambda m: json.loads(m.decode('utf-8'))
        )
        
        await self.consumer.start()
        self.running = True
        logger.info(f"Kafka consumer started, listening to topic: {config.KAFKA_TOPIC}")
        
        # Start consume loop
        asyncio.create_task(self._consume_loop())
    
    async def stop(self):
        """Stop the Kafka consumer."""
        self.running = False
        if self.consumer:
            await self.consumer.stop()
        logger.info("Kafka consumer stopped")
    
    async def _consume_loop(self):
        """Main consume loop with batching."""
        while self.running:
            try:
                # Poll for messages with timeout
                msg_batch = await self.consumer.getmany(
                    timeout_ms=config.BATCH_TIMEOUT_MS,
                    max_records=config.BATCH_SIZE
                )
                
                for tp, messages in msg_batch.items():
                    for msg in messages:
                        try:
                            log_entry = LogEntry(**msg.value)
                            self.batch.append(log_entry)
                        except Exception as e:
                            logger.warning(f"Failed to parse log message: {e}")
                
                # Check if we should flush
                should_flush = (
                    len(self.batch) >= config.BATCH_SIZE or
                    (datetime.now() - self.last_flush).total_seconds() * 1000 >= config.BATCH_TIMEOUT_MS
                )
                
                if should_flush and self.batch:
                    await self._flush_batch()
                    
            except Exception as e:
                logger.error(f"Error in consume loop: {e}")
                await asyncio.sleep(1)
    
    async def _flush_batch(self):
        """Flush the current batch to all storage backends."""
        if not self.batch:
            return
        
        batch = self.batch
        self.batch = []
        self.last_flush = datetime.now()
        
        logger.debug(f"Flushing batch of {len(batch)} logs")
        
        # Write to all backends concurrently
        await asyncio.gather(
            LogWriter.write_to_postgres(batch),
            LogWriter.write_to_redis(batch),
            LogWriter.write_to_mongo(batch),
            return_exceptions=True
        )


kafka_consumer = KafkaLogConsumer()

# =============================================
# FastAPI Application
# =============================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    logger.info("Starting Log Pipeline Service...")
    
    # Initialize database connections
    await db.init_postgres()
    await db.init_redis()
    await db.init_mongo()
    
    # Start Kafka consumer (if Kafka is available)
    try:
        await kafka_consumer.start()
    except Exception as e:
        logger.warning(f"Kafka consumer not started (may not be available): {e}")
    
    yield
    
    # Cleanup
    logger.info("Shutting down Log Pipeline Service...")
    await kafka_consumer.stop()
    await db.close()


app = FastAPI(
    title="Log Pipeline Service",
    description="Unified log ingestion and query service",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =============================================
# API Endpoints
# =============================================

@app.get("/health")
@app.head("/health")
async def health():
    """Health check endpoint."""
    pg_ok = db.pg_pool is not None
    redis_ok = db.redis is not None
    
    return {
        "status": "healthy" if pg_ok and redis_ok else "degraded",
        "postgres": "connected" if pg_ok else "disconnected",
        "redis": "connected" if redis_ok else "disconnected",
        "mongo": "connected" if db.mongo_db is not None else "disconnected",
        "kafka_consumer": "running" if kafka_consumer.running else "stopped"
    }


@app.get("/api/logs/recent")
async def get_recent_logs(
    limit: int = Query(default=50, le=100),
    level: Optional[str] = Query(default=None)
):
    """Get recent logs from Redis cache."""
    if not db.redis:
        raise HTTPException(status_code=503, detail="Redis not available")
    
    try:
        key = config.REDIS_ERRORS_KEY if level == "ERROR" else config.REDIS_RECENT_KEY
        logs_json = await db.redis.lrange(key, 0, limit - 1)
        
        logs = [json.loads(log) for log in logs_json]
        return {"count": len(logs), "logs": logs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/logs/search", response_model=LogSearchResponse)
async def search_logs(request: LogSearchRequest):
    """Search logs in PostgreSQL."""
    if not db.pg_pool:
        raise HTTPException(status_code=503, detail="PostgreSQL not available")
    
    try:
        # Build query dynamically
        conditions = []
        params = []
        param_idx = 1
        
        if request.service:
            conditions.append(f"service = ${param_idx}")
            params.append(request.service)
            param_idx += 1
        
        if request.level:
            conditions.append(f"level = ${param_idx}")
            params.append(request.level)
            param_idx += 1
        
        if request.status_min:
            conditions.append(f"status >= ${param_idx}")
            params.append(request.status_min)
            param_idx += 1
        
        if request.status_max:
            conditions.append(f"status <= ${param_idx}")
            params.append(request.status_max)
            param_idx += 1
        
        if request.path:
            conditions.append(f"path LIKE ${param_idx}")
            params.append(f"%{request.path}%")
            param_idx += 1
        
        if request.from_ts:
            conditions.append(f"timestamp >= ${param_idx}::timestamptz")
            params.append(request.from_ts)
            param_idx += 1
        
        if request.to_ts:
            conditions.append(f"timestamp <= ${param_idx}::timestamptz")
            params.append(request.to_ts)
            param_idx += 1
        
        if request.keyword:
            conditions.append(f"(error_msg ILIKE ${param_idx} OR path ILIKE ${param_idx})")
            params.append(f"%{request.keyword}%")
            param_idx += 1
        
        where_clause = " AND ".join(conditions) if conditions else "1=1"
        
        # Count query
        count_query = f"SELECT COUNT(*) FROM service_logs WHERE {where_clause}"
        
        # Data query
        data_query = f"""
            SELECT id, trace_id, timestamp, service, level, type, method, path,
                   status, latency_ms, error_msg, has_payload
            FROM service_logs
            WHERE {where_clause}
            ORDER BY timestamp DESC
            LIMIT ${param_idx} OFFSET ${param_idx + 1}
        """
        params.extend([request.limit, request.offset])
        
        async with db.pg_pool.acquire() as conn:
            total = await conn.fetchval(count_query, *params[:-2])
            rows = await conn.fetch(data_query, *params)
        
        results = [
            LogSearchResult(
                id=row["id"],
                trace_id=str(row["trace_id"]) if row["trace_id"] else None,
                timestamp=row["timestamp"].isoformat(),
                service=row["service"],
                level=row["level"],
                type=row["type"],
                method=row["method"],
                path=row["path"],
                status=row["status"],
                latency_ms=row["latency_ms"],
                error_msg=row["error_msg"],
                has_payload=row["has_payload"]
            )
            for row in rows
        ]
        
        return LogSearchResponse(
            total=total,
            results=results,
            query=request
        )
    except Exception as e:
        logger.error(f"Search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/logs/{trace_id}")
async def get_logs_by_trace(trace_id: str):
    """Get all logs for a specific trace ID."""
    if not db.pg_pool:
        raise HTTPException(status_code=503, detail="PostgreSQL not available")
    
    try:
        trace_uuid = uuid.UUID(trace_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid trace ID format")
    
    try:
        query = """
            SELECT id, trace_id, span_id, parent_span_id, timestamp, service,
                   level, type, method, path, status, latency_ms, error_msg,
                   error_code, user_id, has_payload, mongo_ref, metadata
            FROM service_logs
            WHERE trace_id = $1
            ORDER BY timestamp ASC
        """
        
        async with db.pg_pool.acquire() as conn:
            rows = await conn.fetch(query, trace_uuid)
        
        logs = []
        for row in rows:
            log = dict(row)
            log["trace_id"] = str(log["trace_id"]) if log["trace_id"] else None
            log["timestamp"] = log["timestamp"].isoformat()
            log["metadata"] = json.loads(log["metadata"]) if log["metadata"] else None
            logs.append(log)
        
        return {"trace_id": trace_id, "logs": logs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/logs/stats/overview", response_model=LogStatsResponse)
async def get_log_stats(
    from_ts: Optional[str] = Query(default=None),
    to_ts: Optional[str] = Query(default=None)
):
    """Get log statistics overview."""
    if not db.pg_pool:
        raise HTTPException(status_code=503, detail="PostgreSQL not available")
    
    try:
        time_filter = ""
        params = []
        
        if from_ts:
            time_filter += " AND timestamp >= $1::timestamptz"
            params.append(from_ts)
        if to_ts:
            time_filter += f" AND timestamp <= ${len(params) + 1}::timestamptz"
            params.append(to_ts)
        
        # Overall stats
        overall_query = f"""
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE level = 'ERROR' OR status >= 500) as errors,
                ROUND(AVG(latency_ms)::numeric, 2) as avg_latency,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) as p95_latency
            FROM service_logs
            WHERE 1=1 {time_filter}
        """
        
        # Per-service stats
        service_query = f"""
            SELECT 
                service,
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE level = 'ERROR' OR status >= 500) as errors,
                ROUND(AVG(latency_ms)::numeric, 2) as avg_latency
            FROM service_logs
            WHERE 1=1 {time_filter}
            GROUP BY service
            ORDER BY total DESC
        """
        
        async with db.pg_pool.acquire() as conn:
            overall = await conn.fetchrow(overall_query, *params)
            services = await conn.fetch(service_query, *params)
        
        total = overall["total"] or 0
        errors = overall["errors"] or 0
        error_rate = (errors / total * 100) if total > 0 else 0.0
        
        return LogStatsResponse(
            total_logs=total,
            error_count=errors,
            error_rate=round(error_rate, 2),
            avg_latency_ms=float(overall["avg_latency"]) if overall["avg_latency"] else None,
            p95_latency_ms=float(overall["p95_latency"]) if overall["p95_latency"] else None,
            services=[dict(row) for row in services]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/logs/ingest")
async def ingest_log(log: LogEntry):
    """Direct HTTP log ingestion (alternative to Kafka)."""
    try:
        await asyncio.gather(
            LogWriter.write_to_postgres([log]),
            LogWriter.write_to_redis([log]),
            LogWriter.write_to_mongo([log])
        )
        return {"status": "ok", "message": "Log ingested successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/logs/ingest/batch")
async def ingest_logs_batch(logs: List[LogEntry]):
    """Batch HTTP log ingestion."""
    try:
        await asyncio.gather(
            LogWriter.write_to_postgres(logs),
            LogWriter.write_to_redis(logs),
            LogWriter.write_to_mongo(logs)
        )
        return {"status": "ok", "count": len(logs)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================
# Grafana JSON API Endpoints
# (For Grafana JSON API Data Source plugin)
# =============================================

@app.post("/api/grafana/search")
async def grafana_search():
    """Grafana JSON API: Return available metrics."""
    return [
        {"text": "Recent Logs", "value": "recent_logs"},
        {"text": "Error Logs", "value": "error_logs"},
        {"text": "Log Stats", "value": "log_stats"},
        {"text": "Service Logs", "value": "service_logs"}
    ]


@app.post("/api/grafana/query")
async def grafana_query(request: dict):
    """Grafana JSON API: Query endpoint."""
    targets = request.get("targets", [])
    results = []
    
    for target in targets:
        target_type = target.get("target", "recent_logs")
        
        if target_type == "recent_logs":
            logs = await get_recent_logs(limit=50)
            results.append({
                "target": "recent_logs",
                "datapoints": [
                    [1, int(datetime.fromisoformat(log["timestamp"].replace('Z', '+00:00')).timestamp() * 1000)]
                    for log in logs["logs"]
                ]
            })
        elif target_type == "error_logs":
            logs = await get_recent_logs(limit=50, level="ERROR")
            results.append({
                "target": "error_logs",
                "datapoints": [
                    [1, int(datetime.fromisoformat(log["timestamp"].replace('Z', '+00:00')).timestamp() * 1000)]
                    for log in logs["logs"]
                ]
            })
    
    return results


# =============================================
# Main Entry Point
# =============================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=config.PORT,
        reload=os.getenv("ENV", "production") == "development"
    )
