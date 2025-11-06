from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware  
from fastapi.responses import JSONResponse
import asyncio
import uvicorn
from app.db import engine, Base, get_db
from app.routers import sources, collections, feeds
from app.config import settings
import httpx
import redis

app = FastAPI(
    title="Pension Sentiment Collector Service",
    description="Web scraping and RSS feed collection for pension sentiment data",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sources.router, prefix="/sources", tags=["Data Sources"])
app.include_router(collections.router, prefix="/collections", tags=["Data Collection"])
app.include_router(feeds.router, prefix="/feeds", tags=["RSS Feeds"])

@app.on_event("startup")
async def startup_event():
    # Readiness flag: becomes True only after dependencies are reachable
    app.state.ready = False
    app.state.dependencies = {"db": False, "redis": False, "analysis": False}
    app.state.startup_attempts = {"db": 0, "redis": 0, "analysis": 0}
    
    import logging
    logger = logging.getLogger(__name__)
    logger.setLevel(logging.INFO)

    # Deterministic jitter generator (no randomness)
    def jitter_ms(seed: str) -> float:
        return (sum(ord(c) for c in seed) % 250) / 1000.0  # up to 0.249s

    # Exponential backoff with cap and deterministic jitter
    async def backoff_sleep(attempt: int, seed: str):
        base = min(8, 2 ** min(attempt, 5))  # 1,2,4,8,8,8...
        await asyncio.sleep(base + jitter_ms(seed))

    # 1) Wait for PostgreSQL (40 attempts)
    logger.info("Waiting for PostgreSQL...")
    for attempt in range(1, 41):
        app.state.startup_attempts["db"] = attempt
        try:
            logger.info(f"PostgreSQL connection attempt {attempt}/40")
            with engine.connect() as conn:
                pass
            # Ensure tables exist
            Base.metadata.create_all(bind=engine)
            app.state.dependencies["db"] = True
            logger.info("PostgreSQL connected successfully")
            break
        except Exception as e:
            logger.warning(f"PostgreSQL connection failed (attempt {attempt}/40): {str(e)}")
            if attempt == 40:
                logger.error("PostgreSQL connection failed after 40 attempts")
                return
            await backoff_sleep(attempt, "postgres")

    # 2) Wait for Redis (40 attempts)
    logger.info("Waiting for Redis...")
    for attempt in range(1, 41):
        app.state.startup_attempts["redis"] = attempt
        try:
            logger.info(f"Redis connection attempt {attempt}/40")
            r = redis.from_url(settings.redis_url, socket_connect_timeout=3, socket_timeout=3)
            r.ping()
            app.state.dependencies["redis"] = True
            logger.info("Redis connected successfully")
            break
        except Exception as e:
            logger.warning(f"Redis connection failed (attempt {attempt}/40): {str(e)}")
            if attempt == 40:
                logger.error("Redis connection failed after 40 attempts")
                return
            await backoff_sleep(attempt, "redis")

    # 3) Wait for Analysis Service health (40 attempts)
    logger.info("Waiting for Analysis Service...")
    for attempt in range(1, 41):
        app.state.startup_attempts["analysis"] = attempt
        try:
            logger.info(f"Analysis Service health check attempt {attempt}/40")
            url = f"{settings.analysis_service_url}/health"
            timeout = httpx.Timeout(connect=3.0, read=5.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    app.state.dependencies["analysis"] = True
                    logger.info("Analysis Service is healthy")
                    break
                raise RuntimeError(f"analysis-service not ready: {resp.status_code}")
        except Exception as e:
            logger.warning(f"Analysis Service health check failed (attempt {attempt}/40): {str(e)}")
            if attempt == 40:
                logger.error("Analysis Service health check failed after 40 attempts")
                return
            await backoff_sleep(attempt, "analysis")

    # All dependencies ready
    if all(app.state.dependencies.values()):
        app.state.ready = True
        logger.info("All dependencies ready - Collector Service is ready to serve requests")
    else:
        logger.error(f"Some dependencies are not ready: {app.state.dependencies}")

@app.get("/health")
async def health_check():
    """
    Basic health check with config source observability.
    """
    response = {
        "status": "healthy",
        "service": "collector-service"
    }
    
    # Add config source info if available
    if hasattr(settings, "_consul_loader"):
        loader = settings._consul_loader
        response["config_source"] = {
            "consul_keys": loader.consul_loaded_keys,
            "env_keys": loader.env_loaded_keys,
            "total_keys": len(loader.consul_loaded_keys) + len(loader.env_loaded_keys)
        }
    
    return response

@app.get("/ready")
async def readiness_check():
    """Readiness reflects external dependencies status."""
    is_ready = bool(getattr(app.state, "ready", False))
    dependencies = getattr(app.state, "dependencies", {})
    attempts = getattr(app.state, "startup_attempts", {})
    
    response = {
        "ready": is_ready,
        "dependencies": dependencies,
        "attempts": attempts
    }
    
    if not is_ready:
        # Return 503 to signal not ready for Docker healthcheck
        raise HTTPException(status_code=503, detail=response)
    return response

@app.get("/")
async def root():
    return {
        "service": "Pension Sentiment Collector Service",
        "version": "1.0.0",
        "status": "running",
        "endpoints": {
            "sources": "/sources - Manage data sources",
            "collections": "/collections - Data collection operations",
            "feeds": "/feeds - RSS feed management",
            "health": "/health - Health check",
            "ready": "/ready - Readiness check",
            "docs": "/docs - API documentation"
        }
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8002)