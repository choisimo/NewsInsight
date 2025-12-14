"""
Newspaper4k News Article Scraper Service

A FastAPI microservice that extracts clean article content from news URLs
using the newspaper4k library. Designed to be called from Java services
with fallback support.
"""

import asyncio
import hashlib
import logging
import os
import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager
from enum import Enum

from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import newspaper
from newspaper import Article, Config

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


# --- Configuration ---
class AppConfig:
    """Application configuration from environment variables."""

    DEFAULT_LANGUAGE = os.getenv("NEWS_SCRAPER_DEFAULT_LANGUAGE", "ko")
    DEFAULT_TIMEOUT = int(os.getenv("NEWS_SCRAPER_DEFAULT_TIMEOUT", "10"))
    MAX_TIMEOUT = int(os.getenv("NEWS_SCRAPER_MAX_TIMEOUT", "30"))
    USER_AGENT = os.getenv(
        "NEWS_SCRAPER_USER_AGENT",
        "Mozilla/5.0 (compatible; NewsInsight-Scraper/1.0; +https://newsinsight.ai)",
    )
    ALLOWED_SCHEMES = {"http", "https"}
    # Batch processing settings
    BATCH_MAX_URLS = int(os.getenv("NEWS_SCRAPER_BATCH_MAX_URLS", "100"))
    BATCH_CONCURRENCY = int(os.getenv("NEWS_SCRAPER_BATCH_CONCURRENCY", "5"))
    BATCH_JOB_TTL_HOURS = int(os.getenv("NEWS_SCRAPER_BATCH_JOB_TTL_HOURS", "24"))


config = AppConfig()


# --- Request/Response Models ---
class ScrapeRequest(BaseModel):
    """Request model for article scraping."""

    url: str = Field(..., description="The URL of the news article to scrape")
    language: Optional[str] = Field(
        default=None,
        description="Language code (e.g., 'ko', 'en'). Auto-detected if not specified.",
    )
    timeout_sec: Optional[int] = Field(
        default=None, ge=1, le=30, description="Request timeout in seconds (1-30)"
    )
    extract_html: Optional[bool] = Field(
        default=False, description="Whether to include raw HTML in response"
    )


class ScrapeResponse(BaseModel):
    """Response model for successful article extraction."""

    status: str = Field(default="ok", description="Response status")
    url: str = Field(..., description="Original URL")
    title: Optional[str] = Field(default=None, description="Article title")
    text: str = Field(..., description="Extracted article text content")
    html: Optional[str] = Field(default=None, description="Raw article HTML")
    top_image: Optional[str] = Field(default=None, description="Main article image URL")
    authors: List[str] = Field(default_factory=list, description="List of authors")
    publish_date: Optional[str] = Field(
        default=None, description="Publication date in ISO8601 format"
    )
    keywords: List[str] = Field(default_factory=list, description="Extracted keywords")
    summary: Optional[str] = Field(
        default=None, description="Article summary/description"
    )
    content_hash: Optional[str] = Field(
        default=None, description="SHA-256 hash of extracted text for deduplication"
    )
    extraction_time_ms: Optional[int] = Field(
        default=None, description="Time taken for extraction in milliseconds"
    )


class ErrorResponse(BaseModel):
    """Response model for errors."""

    status: str = Field(default="error")
    url: str
    error_code: str
    error_message: str


class HealthResponse(BaseModel):
    """Health check response."""

    status: str
    version: str
    library_version: str


# --- Batch Processing Enums and Models ---
class JobStatus(str, Enum):
    """Batch job status enum."""

    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class UrlStatus(str, Enum):
    """Individual URL processing status."""

    PENDING = "pending"
    PROCESSING = "processing"
    SUCCESS = "success"
    FAILED = "failed"


class BatchUrlItem(BaseModel):
    """Individual URL item in batch request."""

    url: str = Field(..., description="URL to scrape")
    language: Optional[str] = Field(
        default=None, description="Language override for this URL"
    )


class BatchScrapeRequest(BaseModel):
    """Request model for batch scraping."""

    urls: List[str] = Field(
        ...,
        min_length=1,
        max_length=100,
        description="List of URLs to scrape (max 100)",
    )
    language: Optional[str] = Field(
        default=None, description="Default language for all URLs"
    )
    timeout_sec: Optional[int] = Field(
        default=10, ge=1, le=30, description="Timeout per URL in seconds"
    )
    concurrency: Optional[int] = Field(
        default=5, ge=1, le=10, description="Number of concurrent scraping tasks"
    )
    callback_url: Optional[str] = Field(
        default=None, description="Webhook URL to notify when job completes"
    )


class UrlResult(BaseModel):
    """Result for a single URL in batch processing."""

    url: str
    status: UrlStatus
    title: Optional[str] = None
    text: Optional[str] = None
    top_image: Optional[str] = None
    authors: List[str] = Field(default_factory=list)
    publish_date: Optional[str] = None
    keywords: List[str] = Field(default_factory=list)
    summary: Optional[str] = None
    content_hash: Optional[str] = None
    extraction_time_ms: Optional[int] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None


class BatchJobResponse(BaseModel):
    """Response for batch job submission."""

    job_id: str = Field(..., description="Unique job identifier")
    status: JobStatus
    total_urls: int
    message: str


class BatchJobStatusResponse(BaseModel):
    """Response for batch job status query."""

    job_id: str
    status: JobStatus
    total_urls: int
    completed: int
    failed: int
    pending: int
    progress_percent: float
    created_at: str
    updated_at: str
    completed_at: Optional[str] = None
    results: Optional[List[UrlResult]] = None


class BatchJob:
    """Internal batch job tracking class."""

    def __init__(
        self,
        job_id: str,
        urls: List[str],
        language: Optional[str],
        timeout_sec: int,
        concurrency: int,
        callback_url: Optional[str] = None,
    ):
        self.job_id = job_id
        self.urls = urls
        self.language = language
        self.timeout_sec = timeout_sec
        self.concurrency = concurrency
        self.callback_url = callback_url
        self.status = JobStatus.PENDING
        self.results: Dict[str, UrlResult] = {}
        self.created_at = datetime.utcnow()
        self.updated_at = datetime.utcnow()
        self.completed_at: Optional[datetime] = None

        # Initialize all URLs as pending
        for url in urls:
            self.results[url] = UrlResult(url=url, status=UrlStatus.PENDING)

    @property
    def total_urls(self) -> int:
        return len(self.urls)

    @property
    def completed_count(self) -> int:
        return sum(1 for r in self.results.values() if r.status == UrlStatus.SUCCESS)

    @property
    def failed_count(self) -> int:
        return sum(1 for r in self.results.values() if r.status == UrlStatus.FAILED)

    @property
    def pending_count(self) -> int:
        return sum(
            1
            for r in self.results.values()
            if r.status in (UrlStatus.PENDING, UrlStatus.PROCESSING)
        )

    @property
    def progress_percent(self) -> float:
        processed = self.completed_count + self.failed_count
        return (
            round((processed / self.total_urls) * 100, 2)
            if self.total_urls > 0
            else 0.0
        )

    def to_status_response(
        self, include_results: bool = True
    ) -> BatchJobStatusResponse:
        return BatchJobStatusResponse(
            job_id=self.job_id,
            status=self.status,
            total_urls=self.total_urls,
            completed=self.completed_count,
            failed=self.failed_count,
            pending=self.pending_count,
            progress_percent=self.progress_percent,
            created_at=self.created_at.isoformat(),
            updated_at=self.updated_at.isoformat(),
            completed_at=self.completed_at.isoformat() if self.completed_at else None,
            results=list(self.results.values()) if include_results else None,
        )


# --- In-Memory Job Store ---
class JobStore:
    """Simple in-memory job store with TTL-based cleanup."""

    def __init__(self, ttl_hours: int = 24):
        self._jobs: Dict[str, BatchJob] = {}
        self._ttl_hours = ttl_hours
        self._lock = asyncio.Lock()

    async def create_job(
        self,
        urls: List[str],
        language: Optional[str],
        timeout_sec: int,
        concurrency: int,
        callback_url: Optional[str] = None,
    ) -> BatchJob:
        """Create a new batch job."""
        job_id = str(uuid.uuid4())
        job = BatchJob(
            job_id=job_id,
            urls=urls,
            language=language,
            timeout_sec=timeout_sec,
            concurrency=concurrency,
            callback_url=callback_url,
        )
        async with self._lock:
            self._jobs[job_id] = job
        return job

    async def get_job(self, job_id: str) -> Optional[BatchJob]:
        """Get job by ID."""
        async with self._lock:
            return self._jobs.get(job_id)

    async def update_job(self, job: BatchJob) -> None:
        """Update job in store."""
        job.updated_at = datetime.utcnow()
        async with self._lock:
            self._jobs[job.job_id] = job

    async def cleanup_old_jobs(self) -> int:
        """Remove jobs older than TTL."""
        cutoff = datetime.utcnow()
        removed = 0
        async with self._lock:
            to_remove = []
            for job_id, job in self._jobs.items():
                age_hours = (cutoff - job.created_at).total_seconds() / 3600
                if age_hours > self._ttl_hours:
                    to_remove.append(job_id)
            for job_id in to_remove:
                del self._jobs[job_id]
                removed += 1
        return removed

    async def list_jobs(self, limit: int = 50) -> List[BatchJob]:
        """List recent jobs."""
        async with self._lock:
            jobs = sorted(self._jobs.values(), key=lambda j: j.created_at, reverse=True)
            return jobs[:limit]


# Global job store
job_store = JobStore(ttl_hours=config.BATCH_JOB_TTL_HOURS)


# --- Lifespan Management ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup/shutdown."""
    logger.info("News Scraper service starting up...")
    logger.info(f"Default language: {config.DEFAULT_LANGUAGE}")
    logger.info(f"Default timeout: {config.DEFAULT_TIMEOUT}s")
    yield
    logger.info("News Scraper service shutting down...")


# --- FastAPI App ---
app = FastAPI(
    title="Newspaper4k News Scraper",
    description="Extracts clean article content from news URLs using newspaper4k",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Helper Functions ---
def validate_url(url: str) -> None:
    """Validate URL scheme and format."""
    from urllib.parse import urlparse

    try:
        parsed = urlparse(url)
        if parsed.scheme not in config.ALLOWED_SCHEMES:
            raise ValueError(f"Unsupported URL scheme: {parsed.scheme}")
        if not parsed.netloc:
            raise ValueError("Invalid URL: missing domain")
    except Exception as e:
        raise ValueError(f"Invalid URL format: {str(e)}")


def compute_content_hash(text: str) -> str:
    """Compute SHA-256 hash of content for deduplication."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def create_newspaper_config(
    language: Optional[str] = None, timeout: int = 10
) -> Config:
    """Create newspaper4k configuration."""
    cfg = Config()
    cfg.browser_user_agent = config.USER_AGENT
    cfg.request_timeout = timeout
    cfg.fetch_images = True
    cfg.memoize_articles = False
    cfg.language = language or config.DEFAULT_LANGUAGE
    cfg.keep_article_html = True
    return cfg


async def extract_article(
    url: str,
    language: Optional[str] = None,
    timeout: int = 10,
    extract_html: bool = False,
) -> dict:
    """
    Extract article content from URL using newspaper4k.

    Runs in thread pool to avoid blocking the event loop.
    """

    def _extract():
        start_time = datetime.now()

        cfg = create_newspaper_config(language, timeout)
        article = Article(url, config=cfg)

        # Download and parse
        article.download()
        article.parse()

        # NLP processing for keywords/summary (optional, may fail)
        try:
            article.nlp()
        except Exception as nlp_error:
            logger.warning(f"NLP processing failed for {url}: {nlp_error}")

        # Calculate extraction time
        extraction_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)

        # Format publish date
        publish_date = None
        if article.publish_date:
            try:
                publish_date = article.publish_date.isoformat()
            except Exception:
                publish_date = str(article.publish_date)

        # Get text content
        text = article.text or ""

        return {
            "title": article.title,
            "text": text,
            "html": article.article_html if extract_html else None,
            "top_image": article.top_image,
            "authors": list(article.authors) if article.authors else [],
            "publish_date": publish_date,
            "keywords": list(article.keywords) if article.keywords else [],
            "summary": article.summary if hasattr(article, "summary") else None,
            "content_hash": compute_content_hash(text) if text else None,
            "extraction_time_ms": extraction_time_ms,
        }

    # Run in thread pool to avoid blocking
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _extract)


# --- Batch Processing Functions ---
async def process_single_url(
    job: BatchJob, url: str, semaphore: asyncio.Semaphore
) -> UrlResult:
    """Process a single URL within a batch job with semaphore-controlled concurrency."""
    async with semaphore:
        # Mark as processing
        job.results[url].status = UrlStatus.PROCESSING

        try:
            # Validate URL first
            validate_url(url)

            # Extract article
            result = await asyncio.wait_for(
                extract_article(
                    url=url,
                    language=job.language,
                    timeout=job.timeout_sec,
                    extract_html=False,
                ),
                timeout=job.timeout_sec + 2,
            )

            # Check content quality
            if not result["text"] or len(result["text"].strip()) < 50:
                job.results[url] = UrlResult(
                    url=url,
                    status=UrlStatus.FAILED,
                    error_code="CONTENT_TOO_SHORT",
                    error_message="Extracted content is too short or empty",
                )
            else:
                job.results[url] = UrlResult(
                    url=url,
                    status=UrlStatus.SUCCESS,
                    title=result.get("title"),
                    text=result.get("text"),
                    top_image=result.get("top_image"),
                    authors=result.get("authors", []),
                    publish_date=result.get("publish_date"),
                    keywords=result.get("keywords", []),
                    summary=result.get("summary"),
                    content_hash=result.get("content_hash"),
                    extraction_time_ms=result.get("extraction_time_ms"),
                )
                logger.info(f"[Batch:{job.job_id}] Successfully scraped: {url}")

        except asyncio.TimeoutError:
            job.results[url] = UrlResult(
                url=url,
                status=UrlStatus.FAILED,
                error_code="TIMEOUT",
                error_message=f"Extraction timed out after {job.timeout_sec}s",
            )
            logger.warning(f"[Batch:{job.job_id}] Timeout: {url}")
        except ValueError as e:
            job.results[url] = UrlResult(
                url=url,
                status=UrlStatus.FAILED,
                error_code="INVALID_URL",
                error_message=str(e),
            )
            logger.warning(f"[Batch:{job.job_id}] Invalid URL: {url} - {e}")
        except Exception as e:
            job.results[url] = UrlResult(
                url=url,
                status=UrlStatus.FAILED,
                error_code="EXTRACTION_FAILED",
                error_message=str(e),
            )
            logger.error(f"[Batch:{job.job_id}] Error scraping {url}: {e}")

        return job.results[url]


async def process_batch_job(job: BatchJob) -> None:
    """Process all URLs in a batch job with controlled concurrency."""
    logger.info(
        f"[Batch:{job.job_id}] Starting batch processing of {len(job.urls)} URLs "
        f"with concurrency={job.concurrency}"
    )

    job.status = JobStatus.PROCESSING
    await job_store.update_job(job)

    # Create semaphore for concurrency control
    semaphore = asyncio.Semaphore(job.concurrency)

    # Process all URLs concurrently (limited by semaphore)
    tasks = [process_single_url(job, url, semaphore) for url in job.urls]

    try:
        await asyncio.gather(*tasks, return_exceptions=True)

        # Determine final job status
        if job.failed_count == job.total_urls:
            job.status = JobStatus.FAILED
        else:
            job.status = JobStatus.COMPLETED

    except Exception as e:
        logger.exception(f"[Batch:{job.job_id}] Batch processing error: {e}")
        job.status = JobStatus.FAILED

    job.completed_at = datetime.utcnow()
    await job_store.update_job(job)

    logger.info(
        f"[Batch:{job.job_id}] Batch completed: "
        f"{job.completed_count}/{job.total_urls} success, "
        f"{job.failed_count} failed"
    )

    # Optional: Send webhook callback
    if job.callback_url:
        await send_webhook_callback(job)


async def send_webhook_callback(job: BatchJob) -> None:
    """Send webhook notification when job completes."""
    try:
        import aiohttp

        async with aiohttp.ClientSession() as session:
            payload = {
                "job_id": job.job_id,
                "status": job.status.value,
                "total_urls": job.total_urls,
                "completed": job.completed_count,
                "failed": job.failed_count,
            }
            async with session.post(
                job.callback_url, json=payload, timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                logger.info(
                    f"[Batch:{job.job_id}] Webhook callback sent to {job.callback_url}: "
                    f"status={response.status}"
                )
    except Exception as e:
        logger.warning(f"[Batch:{job.job_id}] Webhook callback failed: {e}")


# --- API Endpoints ---
@app.get("/health", response_model=HealthResponse)
@app.head("/health")
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="ok",
        version="1.0.0",
        library_version=newspaper.__version__
        if hasattr(newspaper, "__version__")
        else "unknown",
    )


@app.post(
    "/v1/scrape/article",
    response_model=ScrapeResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid request"},
        500: {"model": ErrorResponse, "description": "Extraction failed"},
    },
)
async def scrape_article(request: ScrapeRequest, req: Request):
    """
    Extract article content from a news URL.

    Uses newspaper4k to extract:
    - Title
    - Main text content (cleaned)
    - Authors
    - Publication date
    - Top image
    - Keywords (via NLP)
    - Summary

    Returns content hash for deduplication support.
    """
    # Get trace ID from header if available
    trace_id = req.headers.get("X-Trace-Id", req.headers.get("X-Request-Id", "unknown"))

    logger.info(f"[{trace_id}] Scraping article: {request.url}")

    # Validate URL
    try:
        validate_url(request.url)
    except ValueError as e:
        logger.warning(f"[{trace_id}] Invalid URL: {request.url} - {e}")
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(
                url=request.url, error_code="INVALID_URL", error_message=str(e)
            ).model_dump(),
        )

    # Determine timeout
    timeout = request.timeout_sec or config.DEFAULT_TIMEOUT
    timeout = min(timeout, config.MAX_TIMEOUT)

    try:
        # Extract article with asyncio timeout
        result = await asyncio.wait_for(
            extract_article(
                url=request.url,
                language=request.language,
                timeout=timeout,
                extract_html=request.extract_html or False,
            ),
            timeout=timeout + 2,  # Add buffer for processing
        )

        # Check if we got meaningful content
        if not result["text"] or len(result["text"].strip()) < 50:
            logger.warning(
                f"[{trace_id}] Extracted content too short for {request.url}: "
                f"{len(result['text'] or '')} chars"
            )
            raise HTTPException(
                status_code=400,
                detail=ErrorResponse(
                    url=request.url,
                    error_code="CONTENT_TOO_SHORT",
                    error_message="Extracted article content is too short or empty",
                ).model_dump(),
            )

        logger.info(
            f"[{trace_id}] Successfully extracted {len(result['text'])} chars "
            f"from {request.url} in {result['extraction_time_ms']}ms"
        )

        return ScrapeResponse(status="ok", url=request.url, **result)

    except asyncio.TimeoutError:
        logger.error(f"[{trace_id}] Timeout extracting article: {request.url}")
        raise HTTPException(
            status_code=500,
            detail=ErrorResponse(
                url=request.url,
                error_code="TIMEOUT",
                error_message=f"Article extraction timed out after {timeout}s",
            ).model_dump(),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[{trace_id}] Error extracting article: {request.url}")
        raise HTTPException(
            status_code=500,
            detail=ErrorResponse(
                url=request.url, error_code="EXTRACTION_FAILED", error_message=str(e)
            ).model_dump(),
        )


# --- Batch Processing Endpoints ---
@app.post(
    "/v1/scrape/batch",
    response_model=BatchJobResponse,
    responses={
        400: {"description": "Invalid request"},
        503: {"description": "Service overloaded"},
    },
)
async def submit_batch_job(
    request: BatchScrapeRequest, background_tasks: BackgroundTasks, req: Request
):
    """
    Submit a batch scraping job for multiple URLs.

    The job runs asynchronously in the background. Use the returned job_id
    to poll for status and results via GET /v1/scrape/batch/{job_id}.

    Features:
    - Processes up to 100 URLs per batch
    - Configurable concurrency (1-10 parallel requests)
    - Per-URL timeout with graceful error handling
    - Optional webhook callback on completion
    """
    trace_id = req.headers.get("X-Trace-Id", req.headers.get("X-Request-Id", "unknown"))

    # Validate URL count
    if len(request.urls) > config.BATCH_MAX_URLS:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum {config.BATCH_MAX_URLS} URLs allowed per batch",
        )

    # Remove duplicates while preserving order
    unique_urls = list(dict.fromkeys(request.urls))

    logger.info(
        f"[{trace_id}] Batch job submitted: {len(unique_urls)} URLs "
        f"(concurrency={request.concurrency})"
    )

    # Create job
    job = await job_store.create_job(
        urls=unique_urls,
        language=request.language,
        timeout_sec=request.timeout_sec or config.DEFAULT_TIMEOUT,
        concurrency=min(request.concurrency or config.BATCH_CONCURRENCY, 10),
        callback_url=request.callback_url,
    )

    # Start background processing
    background_tasks.add_task(process_batch_job, job)

    return BatchJobResponse(
        job_id=job.job_id,
        status=job.status,
        total_urls=job.total_urls,
        message=f"Batch job created. Poll GET /v1/scrape/batch/{job.job_id} for status.",
    )


@app.get(
    "/v1/scrape/batch/{job_id}",
    response_model=BatchJobStatusResponse,
    responses={404: {"description": "Job not found"}},
)
async def get_batch_job_status(job_id: str, include_results: bool = True):
    """
    Get the status and results of a batch scraping job.

    Parameters:
    - job_id: The unique job identifier from the POST response
    - include_results: Whether to include individual URL results (default: true)

    Returns progress information and, when complete, the results for each URL.
    """
    job = await job_store.get_job(job_id)

    if not job:
        raise HTTPException(
            status_code=404, detail=f"Job {job_id} not found or has expired"
        )

    return job.to_status_response(include_results=include_results)


@app.delete(
    "/v1/scrape/batch/{job_id}",
    responses={
        404: {"description": "Job not found"},
        409: {"description": "Job cannot be cancelled"},
    },
)
async def cancel_batch_job(job_id: str):
    """
    Cancel a pending or processing batch job.

    Note: URLs that are already being processed may still complete.
    """
    job = await job_store.get_job(job_id)

    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    if job.status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
        raise HTTPException(
            status_code=409,
            detail=f"Job {job_id} is already {job.status.value} and cannot be cancelled",
        )

    job.status = JobStatus.CANCELLED
    job.completed_at = datetime.utcnow()
    await job_store.update_job(job)

    logger.info(f"[Batch:{job_id}] Job cancelled by user")

    return {"status": "cancelled", "job_id": job_id}


@app.get("/v1/scrape/batch")
async def list_batch_jobs(limit: int = 20):
    """
    List recent batch jobs.

    Returns summary information for up to `limit` most recent jobs.
    """
    jobs = await job_store.list_jobs(limit=min(limit, 50))

    return {
        "jobs": [
            {
                "job_id": job.job_id,
                "status": job.status.value,
                "total_urls": job.total_urls,
                "completed": job.completed_count,
                "failed": job.failed_count,
                "progress_percent": job.progress_percent,
                "created_at": job.created_at.isoformat(),
            }
            for job in jobs
        ],
        "count": len(jobs),
    }


@app.get("/v1/scrape/batch/status")
async def batch_service_status():
    """Get batch processing service status and configuration."""
    jobs = await job_store.list_jobs(limit=100)
    active_jobs = [
        j for j in jobs if j.status in (JobStatus.PENDING, JobStatus.PROCESSING)
    ]

    return {
        "status": "ok",
        "config": {
            "max_urls_per_batch": config.BATCH_MAX_URLS,
            "default_concurrency": config.BATCH_CONCURRENCY,
            "job_ttl_hours": config.BATCH_JOB_TTL_HOURS,
        },
        "stats": {"active_jobs": len(active_jobs), "total_jobs_in_memory": len(jobs)},
    }


# --- Main Entry Point ---
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("ENV", "production") == "development",
    )
