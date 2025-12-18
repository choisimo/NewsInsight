import asyncio
import json
import logging
import os
import subprocess
import tempfile
import uuid
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from contextlib import asynccontextmanager
import sys

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Add shared module to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Try to import proxy client
try:
    from shared.proxy_client import ProxyRotationClient, ProxyInfo

    PROXY_CLIENT_AVAILABLE = True
except ImportError:
    PROXY_CLIENT_AVAILABLE = False
    ProxyRotationClient = None
    ProxyInfo = None

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


# --- Configuration ---
class AppConfig:
    """Application configuration from environment variables."""

    PORT = int(os.getenv("PORT", "8020"))
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

    # Maigret configuration
    MAX_CONCURRENT_SCANS = int(os.getenv("MAX_CONCURRENT_SCANS", "3"))
    SCAN_TIMEOUT_SEC = int(os.getenv("SCAN_TIMEOUT_SEC", "300"))  # 5 minutes default
    REQUEST_DELAY_MS = int(os.getenv("REQUEST_DELAY_MS", "100"))

    # Output directory for reports
    REPORTS_DIR = Path(os.getenv("REPORTS_DIR", "/app/reports"))

    # Proxy configuration (optional)
    PROXY_URL = os.getenv("PROXY_URL", None)
    USE_TOR = os.getenv("USE_TOR", "false").lower() == "true"

    # Site filtering
    TOP_SITES_ONLY = os.getenv("TOP_SITES_ONLY", "false").lower() == "true"
    MAX_SITES = int(os.getenv("MAX_SITES", "500"))


config = AppConfig()

# Ensure reports directory exists
config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)

# Semaphore for concurrent scan control
scan_semaphore = asyncio.Semaphore(config.MAX_CONCURRENT_SCANS)

# Proxy rotation configuration
USE_PROXY_ROTATION = os.getenv("USE_PROXY_ROTATION", "true").lower() == "true"
PROXY_ROTATION_URL = os.getenv("PROXY_ROTATION_URL", "http://ip-rotation:8050")

# Initialize proxy client (if available)
proxy_client = None
if PROXY_CLIENT_AVAILABLE and USE_PROXY_ROTATION:
    proxy_client = ProxyRotationClient(
        base_url=PROXY_ROTATION_URL,
        timeout=5.0,
        enabled=True,
    )
    logger.info(f"Proxy rotation enabled, connecting to {PROXY_ROTATION_URL}")

# Proxy rotation configuration
USE_PROXY_ROTATION = os.getenv("USE_PROXY_ROTATION", "true").lower() == "true"
PROXY_ROTATION_URL = os.getenv("PROXY_ROTATION_URL", "http://ip-rotation:8050")

# Initialize proxy client (if available)
proxy_client: "ProxyRotationClient | None" = None
if PROXY_CLIENT_AVAILABLE and USE_PROXY_ROTATION:
    proxy_client = ProxyRotationClient(
        base_url=PROXY_ROTATION_URL,
        timeout=5.0,
        enabled=True,
    )
    logger.info(f"Proxy rotation enabled, connecting to {PROXY_ROTATION_URL}")


# --- Enums and Models ---
class ScanStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    TIMEOUT = "TIMEOUT"


class ScanRequest(BaseModel):
    """Request model for username scan."""

    username: str = Field(
        ..., min_length=1, max_length=100, description="Username to scan"
    )
    options: Optional[Dict[str, Any]] = Field(
        default=None, description="Additional Maigret options"
    )
    timeout_sec: Optional[int] = Field(
        default=None, ge=30, le=600, description="Scan timeout in seconds (30-600)"
    )
    top_sites_only: Optional[bool] = Field(
        default=None, description="Only scan top/popular sites for faster results"
    )


class AccountInfo(BaseModel):
    """Information about a discovered account."""

    site_name: str
    url: str
    username: str
    status: str = "claimed"
    tags: List[str] = Field(default_factory=list)


class ScanSummary(BaseModel):
    """Summary of scan results."""

    total_sites_checked: int
    accounts_found: int
    accounts_claimed: int
    accounts_available: int
    accounts_error: int
    scan_duration_ms: int


class ScanResult(BaseModel):
    """Complete scan result."""

    scan_id: str
    username: str
    status: ScanStatus
    summary: Optional[ScanSummary] = None
    accounts: List[AccountInfo] = Field(default_factory=list)
    raw_json_path: Optional[str] = None
    error_message: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


class ScanResponse(BaseModel):
    """Response model for scan endpoint."""

    status: str = "ok"
    scan_id: str
    message: str
    result: Optional[ScanResult] = None


class HealthResponse(BaseModel):
    """Health check response."""

    status: str
    version: str
    maigret_available: bool
    active_scans: int
    max_concurrent_scans: int
    proxy_rotation_enabled: bool = False
    proxy_service_healthy: bool = False


# --- In-memory scan tracking ---
# In production, this should be replaced with Redis or a database
active_scans: Dict[str, ScanResult] = {}


# --- Helper Functions ---
def sanitize_username(username: str) -> str:
    """Sanitize username to prevent command injection."""
    # Remove any shell-dangerous characters
    import re

    # Only allow alphanumeric, underscore, dash, dot
    sanitized = re.sub(r"[^a-zA-Z0-9_\-.]", "", username)
    if not sanitized:
        raise ValueError("Invalid username after sanitization")
    return sanitized


def build_maigret_command(
    username: str,
    output_dir: Path,
    options: Optional[Dict] = None,
    proxy_url: Optional[str] = None,
) -> List[str]:
    """Build Maigret CLI command with options.

    Args:
        username: Username to scan
        output_dir: Directory for output files
        options: Additional scan options
        proxy_url: Optional proxy URL from rotation service (takes priority)
    """
    cmd = [
        "maigret",
        username,
        "--json",
        "simple",
        "--folderoutput",
        str(output_dir),
    ]

    # Add timeout per site
    cmd.extend(["--timeout", "10"])

    # Proxy configuration (rotation proxy takes priority)
    if proxy_url:
        # Determine proxy type from URL
        if proxy_url.startswith("socks"):
            cmd.extend(["--tor-proxy", proxy_url])
        else:
            cmd.extend(["--proxy", proxy_url])
    elif config.PROXY_URL:
        cmd.extend(["--proxy", config.PROXY_URL])
    elif config.USE_TOR:
        cmd.extend(["--tor-proxy", "socks5://127.0.0.1:9050"])

    # Top sites only for faster scanning
    top_sites = (
        options.get("top_sites_only", config.TOP_SITES_ONLY)
        if options
        else config.TOP_SITES_ONLY
    )
    if top_sites:
        cmd.extend(["--top-sites", "50"])

    # Limit number of sites
    max_sites = (
        options.get("max_sites", config.MAX_SITES) if options else config.MAX_SITES
    )
    if max_sites and max_sites < 500:
        cmd.extend(["--top-sites", str(max_sites)])

    # No recursive search for basic scans
    cmd.append("--no-recursion")

    # Suppress color output and progress bar for cleaner parsing
    cmd.append("--no-color")
    cmd.append("--no-progressbar")

    return cmd


async def get_proxy_for_scan() -> tuple:
    """
    Get a proxy from the rotation service for scanning.

    Returns:
        Tuple of (proxy_url, proxy_id) or (None, None) if unavailable
    """
    if not proxy_client:
        return None, None

    try:
        proxy_info = await proxy_client.get_next_proxy()
        if proxy_info:
            return proxy_info.get_proxy_url(), proxy_info.id
    except Exception as e:
        logger.warning(f"Failed to get proxy from rotation service: {e}")

    return None, None


async def record_proxy_result(
    proxy_id: Optional[str], success: bool, latency_ms: int = 0, error: str = ""
):
    """Record the result of a proxy-enabled scan."""
    if not proxy_id or not proxy_client:
        return

    try:
        if success:
            await proxy_client.record_success(proxy_id, latency_ms)
        else:
            await proxy_client.record_failure(proxy_id, error[:200])
    except Exception as e:
        logger.debug(f"Failed to record proxy result: {e}")


def parse_maigret_json(json_path: Path) -> Dict[str, Any]:
    """Parse Maigret JSON output file."""
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse Maigret JSON: {e}")
        return {}
    except FileNotFoundError:
        logger.error(f"Maigret output file not found: {json_path}")
        return {}


def extract_accounts_from_result(
    raw_result: Dict[str, Any], username: str
) -> List[AccountInfo]:
    """Extract account information from Maigret JSON result."""
    accounts = []

    # Maigret JSON structure: { "SiteName": { "status": { "status": "Claimed" }, "url_user": "..." } }
    if isinstance(raw_result, dict):
        for site_name, site_data in raw_result.items():
            if isinstance(site_data, dict):
                # Get status from nested structure
                status_obj = site_data.get("status", {})
                if isinstance(status_obj, dict):
                    status = status_obj.get("status", "Unknown")
                    tags = status_obj.get("tags", [])
                else:
                    status = str(status_obj)
                    tags = []

                url = site_data.get("url_user", site_data.get("url", ""))

                # Only include claimed/found accounts
                if isinstance(status, str) and status.lower() in [
                    "claimed",
                    "found",
                    "detected",
                ]:
                    accounts.append(
                        AccountInfo(
                            site_name=site_name,
                            url=url or f"https://{site_name.lower()}.com/{username}",
                            username=username,
                            status="claimed",
                            tags=tags if isinstance(tags, list) else [],
                        )
                    )

    # Format 2: Array of results (fallback)
    elif isinstance(raw_result, list):
        for item in raw_result:
            if isinstance(item, dict):
                status_obj = item.get("status", {})
                if isinstance(status_obj, dict):
                    status = status_obj.get("status", "Unknown")
                else:
                    status = str(status_obj)

                if isinstance(status, str) and status.lower() in ["claimed", "found"]:
                    accounts.append(
                        AccountInfo(
                            site_name=item.get("site", item.get("name", "Unknown")),
                            url=item.get("url", ""),
                            username=username,
                            status="claimed",
                            tags=item.get("tags", []),
                        )
                    )

    return accounts


async def run_maigret_scan(
    scan_id: str, username: str, options: Optional[Dict], timeout: int
) -> ScanResult:
    """Execute Maigret scan as subprocess with proxy rotation support."""
    start_time = datetime.now()
    result = active_scans[scan_id]
    result.status = ScanStatus.RUNNING
    result.started_at = start_time.isoformat()

    # Create output directory for this scan
    scan_output_dir = config.REPORTS_DIR / f"scan_{scan_id}"
    scan_output_dir.mkdir(parents=True, exist_ok=True)

    # Get proxy from rotation service
    proxy_url, proxy_id = await get_proxy_for_scan()
    if proxy_id:
        logger.info(f"[{scan_id}] Using rotating proxy: {proxy_id}")

    try:
        # Sanitize username
        safe_username = sanitize_username(username)

        # Build command with optional proxy
        cmd = build_maigret_command(safe_username, scan_output_dir, options, proxy_url)
        logger.info(f"[{scan_id}] Running Maigret: {' '.join(cmd)}")

        # Run Maigret with timeout
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(scan_output_dir),
        )

        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(), timeout=timeout
            )
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            # Record proxy failure on timeout
            duration_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            await record_proxy_result(proxy_id, False, duration_ms, "Scan timeout")
            result.status = ScanStatus.TIMEOUT
            result.error_message = f"Scan timed out after {timeout} seconds"
            result.completed_at = datetime.now().isoformat()
            return result

        # Log output for debugging
        stdout_text = stdout.decode("utf-8", errors="replace")
        stderr_text = stderr.decode("utf-8", errors="replace")
        if stdout_text:
            logger.info(f"[{scan_id}] Maigret stdout: {stdout_text[:500]}")
        if stderr_text:
            logger.warning(f"[{scan_id}] Maigret stderr: {stderr_text[:500]}")

        # Check for errors (but Maigret may exit non-zero even on partial success)
        if process.returncode != 0 and not any(scan_output_dir.glob("*.json")):
            logger.error(f"[{scan_id}] Maigret failed with no output: {stderr_text}")
            duration_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            await record_proxy_result(proxy_id, False, duration_ms, stderr_text[:100])
            result.status = ScanStatus.FAILED
            result.error_message = (
                f"Maigret exited with code {process.returncode}: {stderr_text[:500]}"
            )
            result.completed_at = datetime.now().isoformat()
            return result

        # Find JSON output file - Maigret creates files like report_<username>_simple.json
        json_files = list(scan_output_dir.glob("*.json"))

        if json_files:
            output_path = json_files[0]  # Take the first JSON file
            logger.info(f"[{scan_id}] Found output file: {output_path}")

            raw_result = parse_maigret_json(output_path)
            accounts = extract_accounts_from_result(raw_result, safe_username)

            # Calculate summary
            end_time = datetime.now()
            duration_ms = int((end_time - start_time).total_seconds() * 1000)

            # Record proxy success
            await record_proxy_result(proxy_id, True, duration_ms)

            # Count stats from raw result
            total_checked = len(raw_result) if isinstance(raw_result, dict) else 0
            claimed = len(accounts)

            result.summary = ScanSummary(
                total_sites_checked=total_checked,
                accounts_found=claimed,
                accounts_claimed=claimed,
                accounts_available=0,
                accounts_error=0,
                scan_duration_ms=duration_ms,
            )
            result.accounts = accounts
            result.raw_json_path = str(output_path)
            result.status = ScanStatus.COMPLETED
            result.completed_at = end_time.isoformat()

            logger.info(
                f"[{scan_id}] Scan completed: {claimed} accounts found in {duration_ms}ms"
            )
        else:
            duration_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            await record_proxy_result(proxy_id, False, duration_ms, "No output file")
            result.status = ScanStatus.FAILED
            result.error_message = "Maigret did not produce output file"
            result.completed_at = datetime.now().isoformat()

    except ValueError as e:
        duration_ms = int((datetime.now() - start_time).total_seconds() * 1000)
        await record_proxy_result(proxy_id, False, duration_ms, str(e))
        result.status = ScanStatus.FAILED
        result.error_message = f"Invalid input: {str(e)}"
        result.completed_at = datetime.now().isoformat()
    except Exception as e:
        logger.exception(f"[{scan_id}] Unexpected error during scan")
        duration_ms = int((datetime.now() - start_time).total_seconds() * 1000)
        await record_proxy_result(proxy_id, False, duration_ms, str(e)[:100])
        result.status = ScanStatus.FAILED
        result.error_message = f"Unexpected error: {str(e)}"
        result.completed_at = datetime.now().isoformat()

    return result


async def execute_scan_with_semaphore(
    scan_id: str, username: str, options: Optional[Dict], timeout: int
):
    """Execute scan with concurrency control."""
    async with scan_semaphore:
        await run_maigret_scan(scan_id, username, options, timeout)


# --- Lifespan Management ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    logger.info("Maigret Worker service starting up...")
    logger.info(f"Max concurrent scans: {config.MAX_CONCURRENT_SCANS}")
    logger.info(f"Default timeout: {config.SCAN_TIMEOUT_SEC}s")
    logger.info(f"Reports directory: {config.REPORTS_DIR}")
    logger.info(f"Proxy rotation enabled: {USE_PROXY_ROTATION}")

    # Verify Maigret is installed
    try:
        result = subprocess.run(
            ["maigret", "--version"], capture_output=True, text=True, timeout=10
        )
        logger.info(f"Maigret version: {result.stdout.strip()}")
    except Exception as e:
        logger.warning(f"Could not verify Maigret installation: {e}")

    yield

    # Cleanup proxy client on shutdown
    if proxy_client:
        await proxy_client.close()
    logger.info("Maigret Worker service shutting down...")


# --- FastAPI App ---
app = FastAPI(
    title="Maigret OSINT Username Scanner",
    description="Performs username OSINT scanning using Maigret for social media account discovery",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- API Endpoints ---
@app.get("/health", response_model=HealthResponse)
@app.head("/health")
async def health_check():
    """Health check endpoint."""
    # Check if Maigret is available
    maigret_available = False
    try:
        result = subprocess.run(
            ["maigret", "--version"], capture_output=True, timeout=5
        )
        maigret_available = result.returncode == 0
    except Exception:
        pass

    # Count active scans
    active_count = sum(
        1
        for s in active_scans.values()
        if s.status in [ScanStatus.PENDING, ScanStatus.RUNNING]
    )

    # Check proxy service health
    proxy_healthy = False
    if proxy_client:
        proxy_healthy = await proxy_client.health_check()

    return HealthResponse(
        status="ok" if maigret_available else "degraded",
        version="1.1.0",
        maigret_available=maigret_available,
        active_scans=active_count,
        max_concurrent_scans=config.MAX_CONCURRENT_SCANS,
        proxy_rotation_enabled=USE_PROXY_ROTATION,
        proxy_service_healthy=proxy_healthy,
    )


@app.post("/scan", response_model=ScanResponse)
async def start_scan(
    request: ScanRequest, background_tasks: BackgroundTasks, req: Request
):
    """
    Start a username OSINT scan using Maigret.

    The scan runs asynchronously. Use GET /scan/{scan_id} to check status and results.
    """
    trace_id = req.headers.get("X-Trace-Id", req.headers.get("X-Request-Id", "unknown"))

    # Generate scan ID
    scan_id = str(uuid.uuid4())

    logger.info(
        f"[{trace_id}] Starting scan {scan_id} for username: {request.username}"
    )

    # Validate username early
    try:
        sanitize_username(request.username)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Determine timeout
    timeout = request.timeout_sec or config.SCAN_TIMEOUT_SEC

    # Build options
    options = request.options or {}
    if request.top_sites_only is not None:
        options["top_sites_only"] = request.top_sites_only

    # Create initial scan result
    result = ScanResult(
        scan_id=scan_id, username=request.username, status=ScanStatus.PENDING
    )
    active_scans[scan_id] = result

    # Start scan in background
    background_tasks.add_task(
        execute_scan_with_semaphore, scan_id, request.username, options, timeout
    )

    return ScanResponse(
        status="ok",
        scan_id=scan_id,
        message=f"Scan started for username '{request.username}'. Use GET /scan/{scan_id} to check status.",
        result=result,
    )


@app.post("/scan/sync", response_model=ScanResponse)
async def run_scan_sync(request: ScanRequest, req: Request):
    """
    Run a username scan synchronously and wait for results.

    This endpoint blocks until the scan completes or times out.
    Recommended for shorter scans (use top_sites_only=true for faster results).
    """
    trace_id = req.headers.get("X-Trace-Id", req.headers.get("X-Request-Id", "unknown"))

    scan_id = str(uuid.uuid4())
    logger.info(
        f"[{trace_id}] Starting sync scan {scan_id} for username: {request.username}"
    )

    # Validate username
    try:
        sanitize_username(request.username)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Determine timeout
    timeout = request.timeout_sec or config.SCAN_TIMEOUT_SEC

    # Build options - default to top_sites for sync
    options = request.options or {}
    if request.top_sites_only is not None:
        options["top_sites_only"] = request.top_sites_only
    else:
        options["top_sites_only"] = True  # Default to top sites for sync requests

    # Create scan result
    result = ScanResult(
        scan_id=scan_id, username=request.username, status=ScanStatus.PENDING
    )
    active_scans[scan_id] = result

    # Run scan with semaphore
    async with scan_semaphore:
        result = await run_maigret_scan(scan_id, request.username, options, timeout)

    if result.status == ScanStatus.COMPLETED:
        return ScanResponse(
            status="ok",
            scan_id=scan_id,
            message=f"Scan completed. Found {len(result.accounts)} accounts.",
            result=result,
        )
    else:
        return ScanResponse(
            status="error",
            scan_id=scan_id,
            message=result.error_message or "Scan failed",
            result=result,
        )


@app.get("/scan/{scan_id}", response_model=ScanResponse)
async def get_scan_status(scan_id: str):
    """Get the status and results of a scan."""
    result = active_scans.get(scan_id)

    if not result:
        raise HTTPException(status_code=404, detail=f"Scan not found: {scan_id}")

    return ScanResponse(
        status="ok",
        scan_id=scan_id,
        message=f"Scan status: {result.status.value}",
        result=result,
    )


@app.get("/scans", response_model=Dict[str, Any])
async def list_scans(status: Optional[ScanStatus] = None, limit: int = 50):
    """List recent scans, optionally filtered by status."""
    scans = list(active_scans.values())

    if status:
        scans = [s for s in scans if s.status == status]

    # Sort by started_at descending
    scans.sort(key=lambda x: x.started_at or "", reverse=True)

    return {"total": len(scans), "scans": scans[:limit]}


@app.delete("/scan/{scan_id}")
async def delete_scan(scan_id: str):
    """Delete a completed scan and its report file."""
    result = active_scans.get(scan_id)

    if not result:
        raise HTTPException(status_code=404, detail=f"Scan not found: {scan_id}")

    if result.status in [ScanStatus.PENDING, ScanStatus.RUNNING]:
        raise HTTPException(status_code=400, detail="Cannot delete a running scan")

    # Delete report file if exists
    if result.raw_json_path:
        try:
            Path(result.raw_json_path).unlink(missing_ok=True)
        except Exception as e:
            logger.warning(f"Failed to delete report file: {e}")

    del active_scans[scan_id]

    return {"status": "ok", "message": f"Scan {scan_id} deleted"}


@app.get("/report/{scan_id}")
async def get_raw_report(scan_id: str):
    """Get the raw JSON report for a completed scan."""
    result = active_scans.get(scan_id)

    if not result:
        raise HTTPException(status_code=404, detail=f"Scan not found: {scan_id}")

    if result.status != ScanStatus.COMPLETED:
        raise HTTPException(
            status_code=400, detail=f"Scan not completed: {result.status}"
        )

    if not result.raw_json_path or not Path(result.raw_json_path).exists():
        raise HTTPException(status_code=404, detail="Report file not found")

    with open(result.raw_json_path, "r", encoding="utf-8") as f:
        return json.load(f)


@app.get("/proxy/stats")
async def get_proxy_stats():
    """Get proxy pool statistics."""
    if not proxy_client:
        return {"error": "Proxy rotation not enabled", "enabled": False}

    stats = await proxy_client.get_pool_stats()
    return stats or {"error": "Failed to get stats", "enabled": True}


# --- Main Entry Point ---
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=config.PORT,
        reload=os.getenv("ENV", "production") == "development",
    )
