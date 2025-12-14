import asyncio
import os
import sys
import time
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import uuid
import logging

log = logging.getLogger(__name__)

# Add shared module to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
try:
    from shared.prometheus_metrics import (
        setup_metrics,
        track_request_time,
        track_operation,
        track_error,
        track_item_processed,
        ServiceMetrics,
    )

    METRICS_AVAILABLE = True
except ImportError:
    METRICS_AVAILABLE = False

try:
    from shared.proxy_client import ProxyRotationClient, ProxyInfo

    PROXY_CLIENT_AVAILABLE = True
except ImportError:
    PROXY_CLIENT_AVAILABLE = False
    ProxyRotationClient = None
    ProxyInfo = None

try:
    from crawl4ai import AsyncWebCrawler  # type: ignore
except Exception:
    AsyncWebCrawler = None  # fallback for environments without crawl4ai

app = FastAPI(title="Crawl4AI Worker", version="0.3.0")

# Setup Prometheus metrics
SERVICE_NAME = "crawl-worker"
if METRICS_AVAILABLE:
    setup_metrics(app, SERVICE_NAME, version="0.3.0")
    service_metrics = ServiceMetrics(SERVICE_NAME)
    # Create service-specific metrics
    crawl_requests = service_metrics.create_counter(
        "crawl_requests_total",
        "Total crawl requests",
        ["status", "js_render", "proxy_used"],
    )
    crawl_latency = service_metrics.create_histogram(
        "crawl_latency_seconds",
        "Crawl request latency",
        ["status"],
        buckets=(0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0),
    )
    batch_crawls = service_metrics.create_counter(
        "batch_crawls_total", "Total batch crawl operations", ["status"]
    )
    concurrent_crawls_gauge = service_metrics.create_gauge(
        "concurrent_crawls", "Number of concurrent crawl operations"
    )
    proxy_usage = service_metrics.create_counter(
        "proxy_usage_total", "Proxy usage statistics", ["proxy_id", "status"]
    )
else:
    service_metrics = None

# In-memory storage for batch results
batch_results: Dict[str, Dict[str, Any]] = {}

# Semaphore for concurrent crawl limit
MAX_CONCURRENT_CRAWLS = int(os.environ.get("MAX_CONCURRENT_CRAWLS", "5"))
crawl_semaphore = asyncio.Semaphore(MAX_CONCURRENT_CRAWLS)

# Proxy rotation configuration
USE_PROXY_ROTATION = os.environ.get("USE_PROXY_ROTATION", "true").lower() == "true"
PROXY_ROTATION_URL = os.environ.get("PROXY_ROTATION_URL", "http://ip-rotation:8050")

# Initialize proxy client
proxy_client: Optional["ProxyRotationClient"] = None  # type: ignore
if PROXY_CLIENT_AVAILABLE and USE_PROXY_ROTATION:
    proxy_client = ProxyRotationClient(
        base_url=PROXY_ROTATION_URL,
        timeout=5.0,
        enabled=True,
    )
    log.info(f"Proxy rotation enabled, connecting to {PROXY_ROTATION_URL}")


class CrawlRequest(BaseModel):
    url: str
    js_render: bool = False
    wait_for: Optional[str] = None  # CSS selector to wait for (optional)
    use_proxy: bool = True  # Whether to use proxy rotation


class CrawlResponse(BaseModel):
    url: str
    markdown: Optional[str] = None
    html: Optional[str] = None
    status: str
    error: Optional[str] = None
    proxy_used: Optional[str] = None
    latency_ms: Optional[int] = None


class BatchCrawlRequest(BaseModel):
    """배치 크롤링 요청"""

    urls: List[str] = Field(
        ..., min_length=1, max_length=50, description="크롤링할 URL 목록 (최대 50개)"
    )
    js_render: bool = Field(default=False, description="JavaScript 렌더링 여부")
    wait_for: Optional[str] = Field(default=None, description="대기할 CSS 셀렉터")
    extract_links: bool = Field(default=False, description="링크 추출 여부")
    use_proxy: bool = Field(default=True, description="프록시 로테이션 사용 여부")


class BatchCrawlResult(BaseModel):
    """배치 크롤링 결과"""

    batch_id: str
    total: int
    completed: int
    failed: int
    status: str  # "processing", "completed", "partial"
    results: List[CrawlResponse]


@app.get("/health")
@app.head("/health")
async def health():
    proxy_healthy = False
    if proxy_client:
        proxy_healthy = await proxy_client.health_check()

    return {
        "status": "ok",
        "service": "crawl-worker",
        "version": "0.3.0",
        "crawl4ai_available": AsyncWebCrawler is not None,
        "max_concurrent": MAX_CONCURRENT_CRAWLS,
        "proxy_rotation_enabled": USE_PROXY_ROTATION,
        "proxy_service_healthy": proxy_healthy,
    }


async def get_proxy_for_crawl(
    use_proxy: bool = True,
) -> tuple[Optional[str], Optional[str]]:
    """
    Get a proxy URL for crawling.

    Returns:
        Tuple of (proxy_url, proxy_id) or (None, None) if no proxy is used
    """
    if not use_proxy or not proxy_client:
        return None, None

    try:
        proxy_info = await proxy_client.get_next_proxy()
        if proxy_info:
            return proxy_info.get_proxy_url(), proxy_info.id
    except Exception as e:
        log.warning(f"Failed to get proxy: {e}")

    return None, None


async def record_proxy_result(
    proxy_id: Optional[str], success: bool, latency_ms: int = 0, error: str = ""
):
    """Record the result of a proxy-enabled request."""
    if not proxy_id or not proxy_client:
        return

    try:
        if success:
            await proxy_client.record_success(proxy_id, latency_ms)
        else:
            await proxy_client.record_failure(proxy_id, error)
    except Exception as e:
        log.debug(f"Failed to record proxy result: {e}")


async def crawl_single_url(
    url: str,
    js_render: bool = False,
    wait_for: Optional[str] = None,
    use_proxy: bool = True,
) -> CrawlResponse:
    """단일 URL 크롤링 (세마포어로 동시 실행 제한, 프록시 로테이션 지원)"""
    start_time = time.time()
    proxy_url, proxy_id = await get_proxy_for_crawl(use_proxy)

    async with crawl_semaphore:
        try:
            # Prepare crawler configuration
            crawler_kwargs = {"verbose": False}
            if proxy_url:
                crawler_kwargs["proxy"] = proxy_url
                log.debug(f"Using proxy {proxy_id} for {url}")

            async with AsyncWebCrawler(**crawler_kwargs) as crawler:
                result = await crawler.arun(
                    url=url,
                    js_code=wait_for if js_render else None,
                )

                latency_ms = int((time.time() - start_time) * 1000)

                if not getattr(result, "success", False):
                    error_msg = getattr(result, "error_message", "Unknown error")
                    # Record proxy failure
                    await record_proxy_result(proxy_id, False, latency_ms, error_msg)

                    return CrawlResponse(
                        url=url,
                        status="FAILED",
                        error=error_msg,
                        proxy_used=proxy_id,
                        latency_ms=latency_ms,
                    )

                # Record proxy success
                await record_proxy_result(proxy_id, True, latency_ms)

                return CrawlResponse(
                    url=getattr(result, "url", url),
                    markdown=getattr(result, "markdown", None),
                    html=getattr(result, "html", None),
                    status="SUCCESS",
                    proxy_used=proxy_id,
                    latency_ms=latency_ms,
                )
        except Exception as e:
            latency_ms = int((time.time() - start_time) * 1000)
            # Record proxy failure
            await record_proxy_result(proxy_id, False, latency_ms, str(e))

            return CrawlResponse(
                url=url,
                status="FAILED",
                error=str(e),
                proxy_used=proxy_id,
                latency_ms=latency_ms,
            )


@app.post("/crawl", response_model=CrawlResponse)
async def crawl_url(request: CrawlRequest):
    """단일 URL 크롤링"""
    if AsyncWebCrawler is None:
        raise HTTPException(
            status_code=500, detail="crawl4ai not available in this environment"
        )

    result = await crawl_single_url(
        request.url,
        request.js_render,
        request.wait_for,
        request.use_proxy,
    )

    if result.status == "FAILED":
        raise HTTPException(status_code=400, detail=result.error or "Crawl failed")

    return result


@app.post("/crawl/batch", response_model=BatchCrawlResult)
async def crawl_batch(request: BatchCrawlRequest):
    """
    배치 URL 크롤링 (동기)

    여러 URL을 병렬로 크롤링하고 모든 결과를 반환합니다.
    세마포어로 동시 크롤링 수를 제한합니다.
    각 요청에 대해 프록시 로테이션이 적용됩니다.
    """
    if AsyncWebCrawler is None:
        raise HTTPException(
            status_code=500, detail="crawl4ai not available in this environment"
        )

    batch_id = str(uuid.uuid4())

    # 병렬 크롤링 실행
    tasks = [
        crawl_single_url(url, request.js_render, request.wait_for, request.use_proxy)
        for url in request.urls
    ]

    results = await asyncio.gather(*tasks, return_exceptions=True)

    # 결과 정리
    crawl_results: List[CrawlResponse] = []
    completed = 0
    failed = 0

    for i, result in enumerate(results):
        if isinstance(result, Exception):
            crawl_results.append(
                CrawlResponse(url=request.urls[i], status="FAILED", error=str(result))
            )
            failed += 1
        elif isinstance(result, CrawlResponse):
            crawl_results.append(result)
            if result.status == "SUCCESS":
                completed += 1
            else:
                failed += 1
        else:
            crawl_results.append(
                CrawlResponse(
                    url=request.urls[i], status="FAILED", error="Unknown error"
                )
            )
            failed += 1

    status = "completed" if failed == 0 else ("partial" if completed > 0 else "failed")

    return BatchCrawlResult(
        batch_id=batch_id,
        total=len(request.urls),
        completed=completed,
        failed=failed,
        status=status,
        results=crawl_results,
    )


@app.post("/crawl/batch/async")
async def crawl_batch_async(
    request: BatchCrawlRequest, background_tasks: BackgroundTasks
):
    """
    비동기 배치 크롤링

    즉시 batch_id를 반환하고 백그라운드에서 크롤링을 수행합니다.
    결과는 GET /crawl/batch/{batch_id}로 조회합니다.
    """
    if AsyncWebCrawler is None:
        raise HTTPException(
            status_code=500, detail="crawl4ai not available in this environment"
        )

    batch_id = str(uuid.uuid4())

    # 초기 상태 저장
    batch_results[batch_id] = {
        "batch_id": batch_id,
        "total": len(request.urls),
        "completed": 0,
        "failed": 0,
        "status": "processing",
        "results": [],
    }

    async def run_batch():
        tasks = [
            crawl_single_url(
                url, request.js_render, request.wait_for, request.use_proxy
            )
            for url in request.urls
        ]

        results = await asyncio.gather(*tasks, return_exceptions=True)

        crawl_results = []
        completed = 0
        failed = 0

        for i, result in enumerate(results):
            if isinstance(result, Exception):
                crawl_results.append(
                    {"url": request.urls[i], "status": "FAILED", "error": str(result)}
                )
                failed += 1
            elif isinstance(result, CrawlResponse):
                crawl_results.append(result.model_dump())
                if result.status == "SUCCESS":
                    completed += 1
                else:
                    failed += 1

        status = (
            "completed" if failed == 0 else ("partial" if completed > 0 else "failed")
        )

        batch_results[batch_id] = {
            "batch_id": batch_id,
            "total": len(request.urls),
            "completed": completed,
            "failed": failed,
            "status": status,
            "results": crawl_results,
        }

    background_tasks.add_task(run_batch)

    return {
        "batch_id": batch_id,
        "total": len(request.urls),
        "status": "processing",
        "message": "배치 크롤링이 시작되었습니다. GET /crawl/batch/{batch_id}로 결과를 조회하세요.",
    }


@app.get("/crawl/batch/{batch_id}")
async def get_batch_result(batch_id: str):
    """배치 크롤링 결과 조회"""
    if batch_id not in batch_results:
        raise HTTPException(status_code=404, detail="Batch not found")

    return batch_results[batch_id]


@app.delete("/crawl/batch/{batch_id}")
async def delete_batch_result(batch_id: str):
    """배치 크롤링 결과 삭제"""
    if batch_id in batch_results:
        del batch_results[batch_id]
        return {"status": "deleted", "batch_id": batch_id}
    raise HTTPException(status_code=404, detail="Batch not found")


@app.get("/proxy/stats")
async def get_proxy_stats():
    """프록시 풀 통계 조회"""
    if not proxy_client:
        return {"error": "Proxy rotation not enabled"}

    stats = await proxy_client.get_pool_stats()
    return stats or {"error": "Failed to get stats"}


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    if proxy_client:
        await proxy_client.close()
