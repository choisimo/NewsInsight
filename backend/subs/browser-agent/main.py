"""
Browser-Use Agent Service
=========================
AI 기반 자율 브라우저 에이전트 서비스.
LLM(두뇌) + Playwright(손발) + Browser Context(작업대) 패턴으로 동작.

사용 시나리오:
1. 사용자가 URL과 자연어 태스크를 제공
2. AI 에이전트가 페이지를 탐색하며 데이터 추출
3. 추출된 데이터를 구조화하여 반환 + URL 자동 저장
"""

import asyncio
import hashlib
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

import httpx
import structlog
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, HttpUrl

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

# browser-use imports (optional fallback)
try:
    from browser_use import Agent, Browser
    from langchain_openai import ChatOpenAI
    from langchain_anthropic import ChatAnthropic
    from langchain_google_genai import ChatGoogleGenerativeAI

    BROWSER_USE_AVAILABLE = True
except ImportError as e:
    print(f"browser-use import failed: {e}")
    BROWSER_USE_AVAILABLE = False
    Agent = None
    Browser = None

load_dotenv()

# Structured logging
log = structlog.get_logger()

app = FastAPI(
    title="Browser-Use Agent Service",
    description="AI 기반 자율 브라우저 에이전트 - 자연어 명령으로 웹 데이터 수집",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Setup Prometheus metrics
SERVICE_NAME = "browser-agent"
if METRICS_AVAILABLE:
    setup_metrics(app, SERVICE_NAME, version="0.1.0")
    service_metrics = ServiceMetrics(SERVICE_NAME)
    # Create service-specific metrics
    crawl_tasks = service_metrics.create_counter(
        "crawl_tasks_total",
        "Total browser agent crawl tasks",
        ["status", "llm_provider"],
    )
    crawl_duration = service_metrics.create_histogram(
        "crawl_duration_seconds",
        "Crawl task duration",
        ["status"],
        buckets=(5.0, 10.0, 30.0, 60.0, 120.0, 300.0, 600.0),
    )
    urls_discovered = service_metrics.create_counter(
        "urls_discovered_total", "Total URLs discovered by agent", ["category"]
    )
    agent_steps = service_metrics.create_histogram(
        "agent_steps",
        "Number of steps per agent task",
        ["status"],
        buckets=(1, 2, 5, 10, 20, 30, 50),
    )
    sse_clients_gauge = service_metrics.create_gauge(
        "sse_clients_connected", "Number of connected SSE clients"
    )
    log.info("Prometheus metrics enabled for browser-agent service")
else:
    service_metrics = None
    log.warning("Prometheus metrics not available - shared module not found")

# ========================================
# Configuration
# ========================================


class LLMProvider(str, Enum):
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GOOGLE = "google"
    OPENROUTER = "openrouter"
    OLLAMA = "ollama"
    CUSTOM = "custom"
    AIDOVE = "aidove"


class Config:
    """서비스 설정"""

    # Legacy environment-based API keys (fallback)
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")

    DEFAULT_LLM_PROVIDER: str = os.getenv("DEFAULT_LLM_PROVIDER", "openai")
    DEFAULT_MODEL: str = os.getenv("DEFAULT_MODEL", "gpt-4o")

    HEADLESS: bool = os.getenv("HEADLESS", "true").lower() == "true"
    MAX_CONCURRENT_SESSIONS: int = int(os.getenv("MAX_CONCURRENT_SESSIONS", "3"))
    DEFAULT_TIMEOUT_SEC: int = int(os.getenv("DEFAULT_TIMEOUT_SEC", "120"))

    # Internal service URLs
    COLLECTOR_SERVICE_URL: str = os.getenv("COLLECTOR_SERVICE_URL")

    # DB-based LLM Provider API
    LLM_PROVIDER_API_URL: str = os.getenv(
        "LLM_PROVIDER_API_URL",
        (os.getenv("COLLECTOR_SERVICE_URL") or "") + "/api/v1/llm-providers",
    )

    # Whether to use DB-based providers (set to false to use legacy env vars)
    USE_DB_PROVIDERS: bool = os.getenv("USE_DB_PROVIDERS", "true").lower() == "true"


config = Config()

# Provider config cache (simple in-memory cache)
_provider_config_cache: Dict[str, dict] = {}
_provider_cache_ttl: Dict[str, datetime] = {}
PROVIDER_CACHE_TTL_SECONDS = 300  # 5 minutes

# ========================================
# Request/Response Models (Pydantic)
# ========================================


class CrawlMethod(str, Enum):
    """크롤링 방식"""

    BROWSER_AGENT = "browser_agent"  # AI 에이전트 (browser-use)
    SIMPLE_FETCH = "simple_fetch"  # 단순 HTTP GET
    JS_RENDER = "js_render"  # JavaScript 렌더링만


class AgentTask(BaseModel):
    """브라우저 에이전트 태스크 요청"""

    url: HttpUrl = Field(..., description="크롤링 대상 URL")
    task: str = Field(
        ...,
        description="자연어 태스크 (예: '이 페이지에서 뉴스 제목과 본문을 추출해줘')",
        min_length=5,
        max_length=2000,
    )

    # LLM 설정
    llm_provider: LLMProvider = Field(default=LLMProvider.OPENAI)
    model: Optional[str] = Field(default=None, description="모델명 (기본: gpt-4o)")

    # 크롤링 옵션
    screenshot: bool = Field(default=False, description="스크린샷 캡처 여부")
    extract_links: bool = Field(default=True, description="페이지 내 링크 추출")
    max_steps: int = Field(default=10, ge=1, le=50, description="최대 에이전트 스텝")
    timeout_sec: int = Field(default=120, ge=30, le=600)

    # URL 저장 옵션
    auto_save_url: bool = Field(default=True, description="추출된 URL 자동 저장")
    source_category: str = Field(default="news", description="소스 카테고리")


class ExtractedLink(BaseModel):
    """추출된 링크"""

    url: str
    text: Optional[str] = None
    context: Optional[str] = None  # 주변 텍스트


class AgentAction(BaseModel):
    """에이전트가 수행한 액션"""

    step: int
    action_type: str  # click, type, scroll, extract, etc.
    target: Optional[str] = None
    value: Optional[str] = None
    timestamp: datetime


class AgentTaskResult(BaseModel):
    """에이전트 태스크 결과"""

    task_id: str
    url: str
    status: str  # success, failed, timeout

    # 추출 결과
    extracted_data: Optional[Dict[str, Any]] = None
    extracted_text: Optional[str] = None
    extracted_links: List[ExtractedLink] = []

    # 메타데이터
    content_hash: Optional[str] = None
    page_title: Optional[str] = None

    # 에이전트 메트릭
    steps_taken: int = 0
    actions: List[AgentAction] = []
    tokens_used: Optional[int] = None
    duration_ms: int = 0

    # 스크린샷 (Base64)
    screenshot_base64: Optional[str] = None

    # 에러 정보
    error_message: Optional[str] = None


class BatchCrawlRequest(BaseModel):
    """배치 크롤링 요청"""

    urls: List[HttpUrl] = Field(..., min_length=1, max_length=20)
    task: str = Field(..., description="공통 태스크")
    llm_provider: LLMProvider = Field(default=LLMProvider.OPENAI)
    model: Optional[str] = None
    auto_save_url: bool = True


class SaveUrlRequest(BaseModel):
    """URL 저장 요청 (Collector 서비스 연동)"""

    url: str
    category: str = "news"
    trust_score: float = Field(default=0.5, ge=0, le=1)
    metadata: Dict[str, Any] = {}


class SessionInfo(BaseModel):
    """브라우저 세션 정보"""

    session_id: str
    status: str
    current_url: Optional[str]
    started_at: datetime
    last_activity_at: datetime


# ========================================
# In-Memory Storage (Production: Redis/DB 사용 권장)
# ========================================

active_sessions: Dict[str, dict] = {}
task_results: Dict[str, AgentTaskResult] = {}
session_semaphore = asyncio.Semaphore(config.MAX_CONCURRENT_SESSIONS)


# ========================================
# SSE Event Broadcasting
# ========================================


class SSEEventType(str, Enum):
    """SSE 이벤트 타입"""

    CONNECTED = "connected"
    AGENT_START = "agent_start"
    AGENT_STEP = "agent_step"
    AGENT_COMPLETE = "agent_complete"
    AGENT_ERROR = "agent_error"
    URL_DISCOVERED = "url_discovered"
    HEALTH_UPDATE = "health_update"


class SSEEvent(BaseModel):
    """SSE 이벤트 데이터"""

    type: SSEEventType
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    data: Dict[str, Any] = {}


# SSE 연결 관리 (클라이언트별 큐)
sse_clients: Dict[str, asyncio.Queue] = {}
sse_clients_lock = asyncio.Lock()


async def broadcast_sse_event(event: SSEEvent):
    """모든 SSE 클라이언트에게 이벤트 브로드캐스트"""
    async with sse_clients_lock:
        disconnected = []
        for client_id, queue in sse_clients.items():
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                log.warning("sse_queue_full", client_id=client_id)
            except Exception as e:
                log.warning("sse_broadcast_error", client_id=client_id, error=str(e))
                disconnected.append(client_id)

        # 연결 끊긴 클라이언트 제거
        for client_id in disconnected:
            del sse_clients[client_id]


async def send_agent_event(
    event_type: SSEEventType, task_id: str, url: str, message: str, **kwargs
):
    """에이전트 이벤트 전송 헬퍼"""
    event = SSEEvent(
        type=event_type,
        data={"task_id": task_id, "url": url, "message": message, **kwargs},
    )
    await broadcast_sse_event(event)


async def sse_event_generator(client_id: str, queue: asyncio.Queue):
    """SSE 이벤트 스트림 생성기"""
    try:
        # 연결 확인 이벤트
        connected_event = SSEEvent(
            type=SSEEventType.CONNECTED,
            data={
                "client_id": client_id,
                "message": "Browser Agent SSE connected",
                "active_sessions": len(active_sessions),
            },
        )
        yield f"event: {connected_event.type.value}\ndata: {json.dumps(connected_event.model_dump())}\n\n"

        while True:
            try:
                # 30초 타임아웃으로 이벤트 대기
                event = await asyncio.wait_for(queue.get(), timeout=30.0)
                yield f"event: {event.type.value}\ndata: {json.dumps(event.model_dump())}\n\n"
            except asyncio.TimeoutError:
                # Heartbeat 전송
                yield f": heartbeat\n\n"
    except asyncio.CancelledError:
        log.info("sse_client_disconnected", client_id=client_id)
    finally:
        async with sse_clients_lock:
            if client_id in sse_clients:
                del sse_clients[client_id]


# ========================================
# LLM Provider Config Fetching (DB-based)
# ========================================


async def fetch_provider_config(provider_name: str) -> Optional[Dict[str, Any]]:
    """
    Fetch LLM provider config from Collector service database.
    Uses caching to reduce API calls.
    """
    # Check cache first
    cache_key = provider_name.lower()
    now = datetime.now(timezone.utc)

    if cache_key in _provider_config_cache:
        cache_time = _provider_cache_ttl.get(cache_key)
        if (
            cache_time
            and (now - cache_time).total_seconds() < PROVIDER_CACHE_TTL_SECONDS
        ):
            log.debug("provider_config_cache_hit", provider=provider_name)
            return _provider_config_cache[cache_key]

    # Fetch from API
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{config.LLM_PROVIDER_API_URL}/config/{provider_name}"
            )
            if response.status_code == 200:
                provider_config = response.json()
                # Cache the result
                _provider_config_cache[cache_key] = provider_config
                _provider_cache_ttl[cache_key] = now
                log.info("provider_config_fetched", provider=provider_name)
                return provider_config
            else:
                log.warning(
                    "provider_config_not_found",
                    provider=provider_name,
                    status=response.status_code,
                )
    except Exception as e:
        log.warning(
            "failed_to_fetch_provider_config", provider=provider_name, error=str(e)
        )

    return None


async def fetch_available_providers() -> Dict[str, Any]:
    """
    Fetch available LLM providers for browser-agent service.
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{config.LLM_PROVIDER_API_URL}/for-service/browser-agent"
            )
            if response.status_code == 200:
                return response.json()
    except Exception as e:
        log.warning("failed_to_fetch_available_providers", error=str(e))

    # Fallback to hardcoded list
    return {"providers": [], "defaultProvider": None}


def clear_provider_cache():
    """Clear the provider config cache."""
    _provider_config_cache.clear()
    _provider_cache_ttl.clear()
    log.info("provider_config_cache_cleared")


# ========================================
# LLM Factory
# ========================================


def get_llm_from_env(provider: LLMProvider, model: Optional[str] = None):
    """
    Create LLM instance from environment variables (legacy fallback).
    """
    if provider == LLMProvider.OPENAI:
        return ChatOpenAI(
            model=model or "gpt-4o", api_key=config.OPENAI_API_KEY, temperature=0.1
        )
    elif provider == LLMProvider.ANTHROPIC:
        return ChatAnthropic(
            model=model or "claude-3-5-sonnet-20241022",
            api_key=config.ANTHROPIC_API_KEY,
            temperature=0.1,
        )
    elif provider == LLMProvider.GOOGLE:
        return ChatGoogleGenerativeAI(
            model=model or "gemini-1.5-pro",
            google_api_key=config.GOOGLE_API_KEY,
            temperature=0.1,
        )
    else:
        raise ValueError(f"Unsupported LLM provider for env-based config: {provider}")


def get_llm_from_config(
    provider_config: Dict[str, Any], model_override: Optional[str] = None
):
    """
    Create LLM instance from database provider config.

    Supports: OPENAI, ANTHROPIC, GOOGLE, OPENROUTER, OLLAMA, CUSTOM
    """
    provider_type = provider_config.get("providerType", "").upper()
    api_key = provider_config.get("apiKey", "")
    base_url = provider_config.get("baseUrl")
    default_model = model_override or provider_config.get("defaultModel", "")
    extra_config = provider_config.get("config", {})

    temperature = extra_config.get("temperature", 0.1)

    log.debug(
        "creating_llm_from_config",
        provider_type=provider_type,
        model=default_model,
        has_api_key=bool(api_key),
    )

    if provider_type == "OPENAI":
        kwargs = {
            "model": default_model or "gpt-4o",
            "api_key": api_key,
            "temperature": temperature,
        }
        if base_url and base_url != "https://api.openai.com/v1":
            kwargs["base_url"] = base_url
        return ChatOpenAI(**kwargs)

    elif provider_type == "ANTHROPIC":
        return ChatAnthropic(
            model=default_model or "claude-3-5-sonnet-20241022",
            api_key=api_key,
            temperature=temperature,
        )

    elif provider_type == "GOOGLE":
        return ChatGoogleGenerativeAI(
            model=default_model or "gemini-1.5-pro",
            google_api_key=api_key,
            temperature=temperature,
        )

    elif provider_type == "OPENROUTER":
        # OpenRouter uses OpenAI-compatible API
        return ChatOpenAI(
            model=default_model or "openai/gpt-4o",
            api_key=api_key,
            base_url=base_url or "https://openrouter.ai/api/v1",
            temperature=temperature,
            default_headers={
                "HTTP-Referer": "https://capstone.nodove.com",
                "X-Title": "Echo Metrix Platform",
            },
        )

    elif provider_type == "OLLAMA":
        # Ollama local LLM - requires langchain-ollama package
        try:
            from langchain_ollama import ChatOllama

            return ChatOllama(
                model=default_model or "llama3.1",
                base_url=base_url,
                temperature=temperature,
            )
        except ImportError:
            log.error("langchain_ollama_not_installed")
            raise ValueError("Ollama support requires langchain-ollama package")

    elif provider_type == "CUSTOM":
        # Custom webhook using OpenAI-compatible format
        if not base_url:
            raise ValueError("Custom provider requires base_url")
        return ChatOpenAI(
            model=default_model or "default",
            api_key=api_key or "none",
            base_url=base_url,
            temperature=temperature,
        )

    else:
        raise ValueError(f"Unsupported provider type: {provider_type}")


async def get_llm(provider: LLMProvider, model: Optional[str] = None):
    """
    Get LLM instance - tries DB config first, falls back to env vars.

    Args:
        provider: LLM provider enum
        model: Optional model override

    Returns:
        LangChain chat model instance
    """
    provider_name = provider.value

    # Try DB-based config first (if enabled)
    if config.USE_DB_PROVIDERS:
        provider_config = await fetch_provider_config(provider_name)
        if provider_config:
            try:
                return get_llm_from_config(provider_config, model)
            except Exception as e:
                log.warning(
                    "db_provider_failed_using_fallback",
                    provider=provider_name,
                    error=str(e),
                )

    # Fallback to environment-based config
    log.debug("using_env_based_provider", provider=provider_name)
    return get_llm_from_env(provider, model)


# ========================================
# Core Agent Logic
# ========================================


async def run_browser_agent(request: AgentTask) -> AgentTaskResult:
    """
    browser-use 에이전트 실행

    핵심 패턴: [LLM(두뇌) + Playwright(손발) + Browser Context(작업대)]
    """
    task_id = str(uuid.uuid4())
    start_time = datetime.now(timezone.utc)
    actions_log: List[AgentAction] = []
    actual_steps = 0
    total_tokens_used = 0

    log.info(
        "agent_task_started",
        task_id=task_id,
        url=str(request.url),
        task=request.task[:100],
    )

    # SSE: 에이전트 시작 이벤트
    await send_agent_event(
        SSEEventType.AGENT_START,
        task_id=task_id,
        url=str(request.url),
        message=f"크롤링 시작: {request.task[:50]}...",
        provider=request.llm_provider.value,
    )

    if not BROWSER_USE_AVAILABLE:
        return AgentTaskResult(
            task_id=task_id,
            url=str(request.url),
            status="failed",
            error_message="browser-use 라이브러리가 설치되지 않았습니다. Docker 환경에서 실행해주세요.",
            duration_ms=0,
        )

    try:
        async with session_semaphore:
            # 1. LLM (두뇌) 설정 - DB 기반 또는 환경변수 기반
            llm = await get_llm(request.llm_provider, request.model)

            # 2. Browser 설정 (browser-use 0.10.x API)
            browser = Browser(headless=config.HEADLESS)

            # 3. 에이전트 인스턴스 생성
            # 자연어 태스크를 URL 컨텍스트와 결합
            full_task = f"""
            URL: {request.url}
            
            태스크: {request.task}
            
            추가 지침:
            - 페이지가 완전히 로드될 때까지 기다려주세요
            - 추출한 데이터는 구조화된 형태로 정리해주세요
            - 에러가 발생하면 가능한 대안을 시도해주세요
            """

            agent = Agent(
                task=full_task,
                llm=llm,
                browser=browser,
            )

            # 4. 에이전트 실행 및 액션 추적
            # browser-use Agent.run()은 AgentHistoryList를 반환
            result = await asyncio.wait_for(
                agent.run(max_steps=request.max_steps), timeout=request.timeout_sec
            )

            # 5. 에이전트 히스토리에서 실제 액션 추출
            try:
                if hasattr(agent, "history") and agent.history:
                    history_list = agent.history
                    for idx, history_item in enumerate(history_list):
                        actual_steps += 1

                        # 액션 정보 추출
                        action_type = "unknown"
                        target = None
                        value = None

                        # browser-use의 history item 구조 파싱
                        if (
                            hasattr(history_item, "model_output")
                            and history_item.model_output
                        ):
                            model_output = history_item.model_output
                            if (
                                hasattr(model_output, "current_state")
                                and model_output.current_state
                            ):
                                action_type = getattr(
                                    model_output.current_state, "action_type", "step"
                                )
                            if hasattr(model_output, "action") and model_output.action:
                                action = model_output.action
                                action_type = (
                                    type(action).__name__.lower().replace("action", "")
                                )
                                # 공통 액션 속성 추출
                                if hasattr(action, "selector"):
                                    target = (
                                        str(action.selector)[:200]
                                        if action.selector
                                        else None
                                    )
                                if hasattr(action, "text"):
                                    value = (
                                        str(action.text)[:500] if action.text else None
                                    )
                                elif hasattr(action, "url"):
                                    value = (
                                        str(action.url)[:500] if action.url else None
                                    )

                        # 토큰 사용량 추적
                        if hasattr(history_item, "metadata") and history_item.metadata:
                            tokens = getattr(history_item.metadata, "tokens_used", 0)
                            if tokens:
                                total_tokens_used += tokens

                        actions_log.append(
                            AgentAction(
                                step=idx + 1,
                                action_type=action_type,
                                target=target,
                                value=value,
                                timestamp=datetime.now(timezone.utc),
                            )
                        )

                        # SSE: 스텝 진행 이벤트 (실시간)
                        await send_agent_event(
                            SSEEventType.AGENT_STEP,
                            task_id=task_id,
                            url=str(request.url),
                            message=f"Step {idx + 1}: {action_type}",
                            step=idx + 1,
                            action_type=action_type,
                            target=target[:50] if target else None,
                        )

            except Exception as e:
                log.warning("action_tracking_failed", error=str(e))
                # 폴백: 기본 스텝 수 사용
                if actual_steps == 0:
                    actual_steps = request.max_steps

            # 6. 결과 파싱
            extracted_text = str(result) if result else None
            content_hash = (
                hashlib.sha256((extracted_text or "").encode()).hexdigest()
                if extracted_text
                else None
            )

            # 7. 링크 추출 (옵션)
            extracted_links: List[ExtractedLink] = []
            if request.extract_links and hasattr(agent, "browser") and agent.browser:
                try:
                    page = await agent.browser.get_current_page()
                    if page:
                        links = await page.eval_on_selector_all(
                            "a[href]",
                            """elements => elements.slice(0, 50).map(el => ({
                                url: el.href,
                                text: el.innerText?.trim()?.substring(0, 200)
                            }))""",
                        )
                        extracted_links = [
                            ExtractedLink(url=l["url"], text=l.get("text"))
                            for l in links
                            if l.get("url", "").startswith("http")
                        ]
                except Exception as e:
                    log.warning("link_extraction_failed", error=str(e))

            # 8. 스크린샷 (옵션)
            screenshot_base64 = None
            if request.screenshot and hasattr(agent, "browser") and agent.browser:
                try:
                    page = await agent.browser.get_current_page()
                    if page:
                        screenshot_bytes = await page.screenshot(type="png")
                        import base64

                        screenshot_base64 = base64.b64encode(screenshot_bytes).decode()
                except Exception as e:
                    log.warning("screenshot_failed", error=str(e))

            # 9. 브라우저 정리
            await browser.close()

            duration_ms = int(
                (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
            )

            task_result = AgentTaskResult(
                task_id=task_id,
                url=str(request.url),
                status="success",
                extracted_text=extracted_text,
                extracted_links=extracted_links,
                content_hash=content_hash,
                steps_taken=actual_steps if actual_steps > 0 else len(actions_log),
                actions=actions_log,
                tokens_used=total_tokens_used if total_tokens_used > 0 else None,
                duration_ms=duration_ms,
                screenshot_base64=screenshot_base64,
            )

            log.info(
                "agent_task_completed",
                task_id=task_id,
                duration_ms=duration_ms,
                steps_taken=task_result.steps_taken,
                tokens_used=task_result.tokens_used,
                actions_count=len(actions_log),
            )

            # SSE: 에이전트 완료 이벤트
            await send_agent_event(
                SSEEventType.AGENT_COMPLETE,
                task_id=task_id,
                url=str(request.url),
                message=f"크롤링 완료: {len(extracted_links)}개 링크 발견, {task_result.steps_taken}개 스텝 수행",
                duration_ms=duration_ms,
                links_count=len(extracted_links),
                has_content=bool(extracted_text),
                steps_taken=task_result.steps_taken,
                tokens_used=task_result.tokens_used,
            )

            # 10. URL 자동 저장 (옵션) - 배치 저장 우선, 실패 시 개별 저장
            if request.auto_save_url and extracted_links:
                asyncio.create_task(
                    save_discovered_urls_batch(extracted_links, request.source_category)
                )
                # SSE: URL 발견 이벤트
                await send_agent_event(
                    SSEEventType.URL_DISCOVERED,
                    task_id=task_id,
                    url=str(request.url),
                    message=f"{len(extracted_links)}개 URL 저장 시작",
                    urls_count=len(extracted_links),
                )

            return task_result

    except asyncio.TimeoutError:
        duration_ms = int(
            (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
        )
        log.error("agent_task_timeout", task_id=task_id, timeout=request.timeout_sec)

        # SSE: 타임아웃 에러 이벤트
        await send_agent_event(
            SSEEventType.AGENT_ERROR,
            task_id=task_id,
            url=str(request.url),
            message=f"타임아웃: {request.timeout_sec}초 초과",
            error_type="timeout",
            duration_ms=duration_ms,
        )

        return AgentTaskResult(
            task_id=task_id,
            url=str(request.url),
            status="timeout",
            error_message=f"태스크가 {request.timeout_sec}초 내에 완료되지 않았습니다.",
            steps_taken=actual_steps,
            actions=actions_log,
            tokens_used=total_tokens_used if total_tokens_used > 0 else None,
            duration_ms=duration_ms,
        )
    except Exception as e:
        duration_ms = int(
            (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
        )
        log.error("agent_task_failed", task_id=task_id, error=str(e))

        # SSE: 에러 이벤트
        await send_agent_event(
            SSEEventType.AGENT_ERROR,
            task_id=task_id,
            url=str(request.url),
            message=f"에러: {str(e)[:100]}",
            error_type="exception",
            error_detail=str(e),
            duration_ms=duration_ms,
        )

        return AgentTaskResult(
            task_id=task_id,
            url=str(request.url),
            status="failed",
            error_message=str(e),
            steps_taken=actual_steps,
            actions=actions_log,
            tokens_used=total_tokens_used if total_tokens_used > 0 else None,
            duration_ms=duration_ms,
        )


async def save_discovered_urls(
    links: List[ExtractedLink], category: str, max_retries: int = 3
):
    """
    발견된 URL을 Collector 서비스로 전송하여 저장
    자연스러운 URL 저장 방식 구현 + 재시도 로직

    Args:
        links: 발견된 링크 목록
        category: URL 카테고리
        max_retries: 실패 시 재시도 횟수
    """
    if not links:
        return

    saved_count = 0
    failed_urls: List[ExtractedLink] = []

    async with httpx.AsyncClient(timeout=15.0) as client:
        for link in links[:20]:  # 최대 20개
            success = False
            last_error = None

            for attempt in range(max_retries):
                try:
                    response = await client.post(
                        f"{config.COLLECTOR_SERVICE_URL}/api/v1/sources/discover",
                        json={
                            "url": link.url,
                            "category": category,
                            "discovered_from": "browser_agent",
                            "context": link.text,
                            "auto_discovered": True,
                        },
                    )

                    if response.status_code in [200, 201]:
                        saved_count += 1
                        log.debug("url_saved", url=link.url, attempt=attempt + 1)
                        success = True
                        break
                    elif response.status_code == 409:
                        # 중복 URL - 성공으로 간주
                        log.debug("url_already_exists", url=link.url)
                        success = True
                        break
                    else:
                        last_error = f"HTTP {response.status_code}"

                except httpx.TimeoutException:
                    last_error = "timeout"
                    await asyncio.sleep(1 * (attempt + 1))  # 백오프
                except Exception as e:
                    last_error = str(e)
                    await asyncio.sleep(0.5 * (attempt + 1))

            if not success:
                failed_urls.append(link)
                log.warning(
                    "url_save_failed",
                    url=link.url,
                    error=last_error,
                    attempts=max_retries,
                )

    log.info(
        "url_discovery_completed",
        saved=saved_count,
        failed=len(failed_urls),
        total=min(len(links), 20),
    )


async def save_discovered_urls_batch(links: List[ExtractedLink], category: str):
    """
    배치로 URL 저장 (Collector 서비스의 배치 API 활용)
    더 효율적인 URL 저장 방식
    """
    if not links:
        return

    try:
        batch_request = {
            "urls": [
                {
                    "url": link.url,
                    "category": category,
                    "discovered_from": "browser_agent",
                    "context": link.text,
                    "auto_discovered": True,
                }
                for link in links[:20]
            ]
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{config.COLLECTOR_SERVICE_URL}/api/v1/sources/discover/batch",
                json=batch_request,
            )

            if response.status_code == 200:
                result = response.json()
                log.info(
                    "batch_url_discovery_completed",
                    created=result.get("created", 0),
                    duplicates=result.get("duplicates", 0),
                    failed=result.get("failed", 0),
                )
            else:
                # 배치 실패 시 개별 저장으로 폴백
                log.warning(
                    "batch_save_failed_fallback_to_individual",
                    status=response.status_code,
                )
                await save_discovered_urls(links, category)

    except Exception as e:
        log.warning("batch_save_error_fallback_to_individual", error=str(e))
        await save_discovered_urls(links, category)


# ========================================
# API Endpoints
# ========================================


@app.get("/events")
async def sse_events(request: Request):
    """
    SSE 이벤트 스트림 엔드포인트

    브라우저 에이전트의 실시간 상태를 구독합니다.

    이벤트 타입:
    - connected: 연결 성공
    - agent_start: 에이전트 태스크 시작
    - agent_step: 에이전트 스텝 진행
    - agent_complete: 에이전트 태스크 완료
    - agent_error: 에이전트 에러
    - url_discovered: 새 URL 발견
    - health_update: 헬스 상태 업데이트
    """
    client_id = str(uuid.uuid4())
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)

    async with sse_clients_lock:
        sse_clients[client_id] = queue

    log.info(
        "sse_client_connected", client_id=client_id, total_clients=len(sse_clients)
    )

    return StreamingResponse(
        sse_event_generator(client_id, queue),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        },
    )


@app.get("/events/clients")
async def get_sse_clients():
    """현재 연결된 SSE 클라이언트 수 조회"""
    async with sse_clients_lock:
        return {
            "connected_clients": len(sse_clients),
            "client_ids": list(sse_clients.keys()),
        }


@app.get("/health")
@app.head("/health")
async def health():
    """헬스체크 엔드포인트"""
    return {
        "status": "ok",
        "service": "browser-agent",
        "browser_use_available": BROWSER_USE_AVAILABLE,
        "active_sessions": len(active_sessions),
        "max_sessions": config.MAX_CONCURRENT_SESSIONS,
        "use_db_providers": config.USE_DB_PROVIDERS,
    }


@app.get("/providers")
async def get_available_providers():
    """
    사용 가능한 LLM Provider 목록 조회

    DB 기반 provider 설정을 사용하는 경우 Collector 서비스에서 가져오고,
    그렇지 않으면 환경변수 기반 목록을 반환합니다.
    """
    if config.USE_DB_PROVIDERS:
        result = await fetch_available_providers()
        if result.get("providers"):
            return result

    # Fallback to environment-based providers
    providers = []

    if config.OPENAI_API_KEY:
        providers.append(
            {
                "name": "openai",
                "providerType": "OPENAI",
                "defaultModel": "gpt-4o",
                "available": True,
            }
        )

    if config.ANTHROPIC_API_KEY:
        providers.append(
            {
                "name": "anthropic",
                "providerType": "ANTHROPIC",
                "defaultModel": "claude-3-5-sonnet-20241022",
                "available": True,
            }
        )

    if config.GOOGLE_API_KEY:
        providers.append(
            {
                "name": "google",
                "providerType": "GOOGLE",
                "defaultModel": "gemini-1.5-pro",
                "available": True,
            }
        )

    return {
        "providers": providers,
        "defaultProvider": providers[0] if providers else None,
        "source": "environment",
    }


@app.get("/providers/default")
async def get_default_provider():
    """
    기본 LLM Provider 조회

    프론트엔드에서 기본 provider 정보를 가져올 때 사용
    """
    result = await get_available_providers()
    default_provider = result.get("defaultProvider")

    if default_provider:
        return {
            "name": default_provider.get("name", "openai"),
            "providerType": default_provider.get("providerType", "OPENAI"),
            "defaultModel": default_provider.get("defaultModel", "gpt-4o"),
            "available": default_provider.get("available", True),
        }

    # 기본값 반환
    return {
        "name": "openai",
        "providerType": "OPENAI",
        "defaultModel": "gpt-4o",
        "available": False,
        "message": "No provider configured",
    }


class ChatMessage(BaseModel):
    """채팅 메시지"""

    role: str = Field(..., description="메시지 역할: user, assistant, system")
    content: str = Field(..., description="메시지 내용")


class ChatRequest(BaseModel):
    """채팅 요청"""

    messages: List[ChatMessage] = Field(..., description="대화 이력")
    llm_provider: LLMProvider = Field(default=LLMProvider.OPENAI)
    model: Optional[str] = Field(default=None, description="사용할 모델")
    stream: bool = Field(default=False, description="스트리밍 응답 여부")
    context_url: Optional[str] = Field(
        default=None, description="컨텍스트로 사용할 URL"
    )


class ChatResponse(BaseModel):
    """채팅 응답"""

    message: str
    provider: str
    model: str
    tokens_used: Optional[int] = None


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    AI 채팅 엔드포인트

    LLM과 직접 대화하는 인터페이스.
    URL 컨텍스트가 제공되면 해당 페이지 내용을 참조하여 응답.

    사용 예시:
    ```json
    {
        "messages": [
            {"role": "user", "content": "뉴스 기사의 핵심 내용을 요약해줘"}
        ],
        "context_url": "https://news.example.com/article/123"
    }
    ```
    """
    try:
        llm = await get_llm(request.llm_provider, request.model)

        # 메시지 변환
        from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

        langchain_messages = []
        for msg in request.messages:
            if msg.role == "user":
                langchain_messages.append(HumanMessage(content=msg.content))
            elif msg.role == "assistant":
                langchain_messages.append(AIMessage(content=msg.content))
            elif msg.role == "system":
                langchain_messages.append(SystemMessage(content=msg.content))

        # URL 컨텍스트가 있으면 페이지 내용 추가
        if request.context_url:
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    # crawl-worker를 통해 페이지 내용 가져오기
                    crawl_response = await client.post(
                        "http://crawl4ai:8001/crawl",
                        json={"url": request.context_url, "js_render": False},
                    )
                    if crawl_response.status_code == 200:
                        crawl_data = crawl_response.json()
                        page_content = crawl_data.get("markdown", "")[
                            :8000
                        ]  # 토큰 제한
                        context_msg = SystemMessage(
                            content=f"다음은 참조할 웹페이지 내용입니다:\n\n{page_content}"
                        )
                        langchain_messages.insert(0, context_msg)
            except Exception as e:
                log.warning(
                    "context_fetch_failed", url=request.context_url, error=str(e)
                )

        # LLM 호출
        response = await llm.ainvoke(langchain_messages)

        return ChatResponse(
            message=response.content,
            provider=request.llm_provider.value,
            model=request.model or config.DEFAULT_MODEL,
            tokens_used=getattr(response, "usage_metadata", {}).get("total_tokens"),
        )

    except Exception as e:
        log.error("chat_failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"채팅 처리 실패: {str(e)}")


@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    """
    AI 채팅 스트리밍 엔드포인트 (SSE)

    LLM 응답을 실시간으로 스트리밍합니다.

    사용 예시:
    ```json
    {
        "messages": [
            {"role": "user", "content": "파이썬의 장점을 설명해줘"}
        ],
        "stream": true
    }
    ```
    """

    async def generate_stream():
        try:
            llm = await get_llm(request.llm_provider, request.model)

            # 메시지 변환
            from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

            langchain_messages = []
            for msg in request.messages:
                if msg.role == "user":
                    langchain_messages.append(HumanMessage(content=msg.content))
                elif msg.role == "assistant":
                    langchain_messages.append(AIMessage(content=msg.content))
                elif msg.role == "system":
                    langchain_messages.append(SystemMessage(content=msg.content))

            # URL 컨텍스트가 있으면 페이지 내용 추가
            if request.context_url:
                try:
                    async with httpx.AsyncClient(timeout=30.0) as client:
                        crawl_response = await client.post(
                            "http://crawl4ai:8001/crawl",
                            json={"url": request.context_url, "js_render": False},
                        )
                        if crawl_response.status_code == 200:
                            crawl_data = crawl_response.json()
                            page_content = crawl_data.get("markdown", "")[:8000]
                            context_msg = SystemMessage(
                                content=f"다음은 참조할 웹페이지 내용입니다:\n\n{page_content}"
                            )
                            langchain_messages.insert(0, context_msg)
                except Exception as e:
                    log.warning(
                        "context_fetch_failed", url=request.context_url, error=str(e)
                    )

            # 스트리밍 LLM 호출
            full_response = ""
            async for chunk in llm.astream(langchain_messages):
                if hasattr(chunk, "content") and chunk.content:
                    content = chunk.content
                    full_response += content
                    yield f"data: {json.dumps({'content': content, 'type': 'chunk'})}\n\n"

            # 완료 이벤트
            yield f"data: {json.dumps({'type': 'done', 'provider': request.llm_provider.value, 'model': request.model or config.DEFAULT_MODEL, 'full_response': full_response})}\n\n"

        except Exception as e:
            log.error("chat_stream_failed", error=str(e))
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        },
    )


@app.post("/providers/cache/clear")
async def clear_providers_cache():
    """Provider 설정 캐시 삭제"""
    clear_provider_cache()
    return {"status": "ok", "message": "Provider cache cleared"}


@app.post("/agent/crawl", response_model=AgentTaskResult)
async def agent_crawl(request: AgentTask):
    """
    AI 에이전트 크롤링 실행 (동기)

    사용 예시:
    ```json
    {
        "url": "https://news.example.com/article/123",
        "task": "이 기사의 제목, 작성자, 본문을 추출해줘",
        "extract_links": true,
        "auto_save_url": true
    }
    ```
    """
    if not BROWSER_USE_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="browser-use 라이브러리가 사용 불가능합니다. Docker 환경에서 실행하세요.",
        )

    result = await run_browser_agent(request)
    task_results[result.task_id] = result
    return result


@app.post("/agent/crawl/async")
async def agent_crawl_async(request: AgentTask, background_tasks: BackgroundTasks):
    """
    AI 에이전트 크롤링 비동기 실행

    Returns:
        task_id: 태스크 ID (상태 조회용)
    """
    if not BROWSER_USE_AVAILABLE:
        raise HTTPException(
            status_code=503, detail="browser-use 라이브러리가 사용 불가능합니다."
        )

    task_id = str(uuid.uuid4())

    async def run_task():
        result = await run_browser_agent(request)
        result.task_id = task_id
        task_results[task_id] = result

    background_tasks.add_task(asyncio.create_task, run_task())

    return {
        "task_id": task_id,
        "status": "queued",
        "message": "태스크가 큐에 추가되었습니다. GET /agent/task/{task_id}로 상태를 확인하세요.",
    }


@app.get("/agent/task/{task_id}", response_model=AgentTaskResult)
async def get_task_result(task_id: str):
    """태스크 결과 조회"""
    if task_id not in task_results:
        raise HTTPException(status_code=404, detail="태스크를 찾을 수 없습니다.")
    return task_results[task_id]


@app.post("/agent/batch")
async def batch_crawl(request: BatchCrawlRequest, background_tasks: BackgroundTasks):
    """
    여러 URL 배치 크롤링

    동일한 태스크를 여러 URL에 병렬 적용
    세마포어로 동시 실행 제한 (MAX_CONCURRENT_SESSIONS)
    """
    if not BROWSER_USE_AVAILABLE:
        raise HTTPException(status_code=503, detail="browser-use 사용 불가")

    batch_id = str(uuid.uuid4())
    task_ids = []

    # 각 URL에 대한 태스크 생성
    tasks_to_run: List[tuple] = []  # (AgentTask, task_id) 쌍

    for url in request.urls:
        agent_task = AgentTask(
            url=url,
            task=request.task,
            llm_provider=request.llm_provider,
            model=request.model,
            auto_save_url=request.auto_save_url,
        )
        task_id = str(uuid.uuid4())
        task_ids.append(task_id)
        tasks_to_run.append((agent_task, task_id))

    # 백그라운드에서 병렬 실행
    async def run_batch():
        """모든 태스크를 병렬로 실행 (세마포어로 동시 실행 제한)"""

        async def run_single_task(agent_task: AgentTask, tid: str):
            """단일 태스크 실행 래퍼 - 클로저 변수 캡처 문제 해결"""
            try:
                result = await run_browser_agent(agent_task)
                result.task_id = tid
                task_results[tid] = result
                log.info("batch_task_completed", task_id=tid, url=str(agent_task.url))
            except Exception as e:
                log.error("batch_task_failed", task_id=tid, error=str(e))
                # 실패한 경우에도 결과 저장
                task_results[tid] = AgentTaskResult(
                    task_id=tid,
                    url=str(agent_task.url),
                    status="failed",
                    error_message=str(e),
                    duration_ms=0,
                )

        # asyncio.gather로 병렬 실행 (세마포어가 run_browser_agent 내부에서 제한)
        coroutines = [
            run_single_task(agent_task, tid) for agent_task, tid in tasks_to_run
        ]
        await asyncio.gather(*coroutines, return_exceptions=True)
        log.info("batch_crawl_completed", batch_id=batch_id, total=len(task_ids))

    # 백그라운드 태스크로 실행
    background_tasks.add_task(run_batch)

    return {
        "batch_id": batch_id,
        "task_ids": task_ids,
        "total": len(task_ids),
        "message": "배치 크롤링이 시작되었습니다. GET /agent/task/{task_id}로 각 태스크 상태를 확인하세요.",
    }


@app.get("/agent/tasks")
async def list_tasks(
    limit: int = Query(default=20, le=100), status: Optional[str] = Query(default=None)
):
    """최근 태스크 목록 조회"""
    results = list(task_results.values())

    if status:
        results = [r for r in results if r.status == status]

    # 최신순 정렬 (duration_ms 기준 - 간접적 시간 정렬)
    results = sorted(results, key=lambda x: x.duration_ms, reverse=True)[:limit]

    return {"total": len(results), "tasks": results}


@app.delete("/agent/task/{task_id}")
async def delete_task(task_id: str):
    """태스크 결과 삭제"""
    if task_id in task_results:
        del task_results[task_id]
        return {"status": "deleted", "task_id": task_id}
    raise HTTPException(status_code=404, detail="태스크를 찾을 수 없습니다.")


# ========================================
# URL 관리 엔드포인트
# ========================================


@app.post("/urls/save")
async def save_url(request: SaveUrlRequest):
    """
    URL 수동 저장

    사용자가 관심있는 URL을 직접 저장할 때 사용
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{config.COLLECTOR_SERVICE_URL}/api/v1/sources",
                json={
                    "url": request.url,
                    "category": request.category,
                    "trust_score": request.trust_score,
                    "metadata": request.metadata,
                    "source": "browser_agent_manual",
                },
            )

            if response.status_code in [200, 201]:
                return {"status": "saved", "url": request.url}
            else:
                return {"status": "failed", "url": request.url, "reason": response.text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/urls/discovered")
async def get_discovered_urls(
    limit: int = Query(default=50, le=200), category: Optional[str] = None
):
    """
    에이전트가 발견한 URL 목록 조회
    (Collector 서비스와 연동)
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            params = {"limit": limit, "source": "browser_agent"}
            if category:
                params["category"] = category

            response = await client.get(
                f"{config.COLLECTOR_SERVICE_URL}/api/v1/sources", params=params
            )

            if response.status_code == 200:
                return response.json()
            else:
                return {"sources": [], "error": "Collector 서비스 연결 실패"}
    except Exception as e:
        return {"sources": [], "error": str(e)}


# ========================================
# 프리셋 태스크 (자주 사용하는 작업)
# ========================================


@app.post("/agent/presets/extract-article")
async def extract_article(url: HttpUrl, auto_save: bool = True):
    """
    뉴스 기사 추출 프리셋

    URL에서 제목, 작성자, 날짜, 본문을 자동 추출
    """
    request = AgentTask(
        url=url,
        task="""
        이 뉴스 기사 페이지에서 다음 정보를 추출해주세요:
        1. 기사 제목
        2. 작성자/기자명
        3. 발행일
        4. 본문 전체 텍스트
        5. 관련 기사 링크들
        
        JSON 형식으로 정리해주세요.
        """,
        extract_links=True,
        auto_save_url=auto_save,
        source_category="news",
    )
    return await agent_crawl(request)


@app.post("/agent/presets/extract-comments")
async def extract_comments(url: HttpUrl, max_scroll: int = 5):
    """
    댓글/여론 추출 프리셋

    게시글의 댓글들을 수집
    """
    request = AgentTask(
        url=url,
        task=f"""
        이 페이지에서 댓글들을 수집해주세요:
        1. 페이지를 {max_scroll}번 스크롤하면서 댓글을 로드해주세요
        2. 각 댓글의 작성자, 내용, 작성시간, 좋아요 수를 추출해주세요
        3. "더보기" 버튼이 있으면 클릭해서 더 많은 댓글을 로드해주세요
        
        JSON 배열 형식으로 정리해주세요.
        """,
        max_steps=20,
        auto_save_url=False,
        source_category="forum",
    )
    return await agent_crawl(request)


@app.post("/agent/presets/site-structure")
async def analyze_site_structure(url: HttpUrl):
    """
    사이트 구조 분석 프리셋

    사이트의 주요 섹션과 링크 구조 파악
    """
    request = AgentTask(
        url=url,
        task="""
        이 웹사이트의 구조를 분석해주세요:
        1. 메인 네비게이션 메뉴 항목들
        2. 주요 섹션/카테고리
        3. RSS 피드 링크가 있는지
        4. API 엔드포인트 힌트가 있는지
        5. 사이트맵 링크
        
        크롤링 전략 수립에 도움이 되도록 정리해주세요.
        """,
        extract_links=True,
        auto_save_url=True,
        source_category="general",
    )
    return await agent_crawl(request)


# ========================================
# Main Entry Point
# ========================================

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8030,
        reload=os.getenv("ENV", "development") == "development",
    )
