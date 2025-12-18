"""
FastAPI REST Server for autonomous-crawler-service.

browser-agent의 REST API + SSE 기능을 autonomous-crawler-service에 통합.
기존 Kafka 기반 아키텍처와 병행 운영됩니다.
"""

import asyncio
import hashlib
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

import httpx
import structlog
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, HttpUrl

from src.api.sse import (
    SSEEvent,
    SSEEventType,
    SSEManager,
    get_sse_manager,
    sse_event_generator,
)
from src.config import Settings, get_settings
from src.crawler import AutonomousCrawlerAgent
from src.state.store import StateStore, get_state_store, close_state_store

logger = structlog.get_logger(__name__)


# ========================================
# Configuration
# ========================================


class LLMProvider(str, Enum):
    """지원하는 LLM Provider"""

    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GOOGLE = "google"
    OPENROUTER = "openrouter"
    OLLAMA = "ollama"
    AZURE = "azure"
    CUSTOM = "custom"


class APIConfig:
    """API 서버 설정"""

    # 환경변수에서 LLM API 키 로드 (fallback)
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")

    DEFAULT_LLM_PROVIDER: str = os.getenv("DEFAULT_LLM_PROVIDER", "openai")
    DEFAULT_MODEL: str = os.getenv("DEFAULT_MODEL", "gpt-4o")

    MAX_CONCURRENT_SESSIONS: int = int(os.getenv("MAX_CONCURRENT_SESSIONS", "3"))
    DEFAULT_TIMEOUT_SEC: int = int(os.getenv("DEFAULT_TIMEOUT_SEC", "120"))

    # DB 기반 LLM Provider 사용 여부
    USE_DB_PROVIDERS: bool = os.getenv("USE_DB_PROVIDERS", "true").lower() == "true"
    COLLECTOR_SERVICE_URL: str = os.getenv("COLLECTOR_SERVICE_URL", "http://collector:8002")
    WEB_CRAWLER_URL: str = os.getenv("WEB_CRAWLER_URL", "http://web-crawler:11235")
    WEB_CRAWLER_API_TOKEN: str = os.getenv(
        "WEB_CRAWLER_API_TOKEN", os.getenv("CRAWL4AI_API_TOKEN", "")
    )


api_config = APIConfig()


# ========================================
# Request/Response Models (Pydantic)
# ========================================


class CrawlMethod(str, Enum):
    """크롤링 방식"""

    BROWSER_AGENT = "browser_agent"
    SIMPLE_FETCH = "simple_fetch"
    JS_RENDER = "js_render"


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
    context: Optional[str] = None


class AgentAction(BaseModel):
    """에이전트가 수행한 액션"""

    step: int
    action_type: str
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
    context_url: Optional[str] = Field(default=None, description="컨텍스트로 사용할 URL")


class ChatResponse(BaseModel):
    """채팅 응답"""

    message: str
    provider: str
    model: str
    tokens_used: Optional[int] = None


# ========================================
# In-Memory Storage (deprecated - kept for backward compat, StateStore is primary)
# ========================================

# Note: task_results dict is now managed by StateStore with Redis persistence
# This variable is kept for quick reference but StateStore should be used
session_semaphore: Optional[asyncio.Semaphore] = None


# ========================================
# Provider Config Fetching (DB-based)
# ========================================

_provider_config_cache: Dict[str, dict] = {}
_provider_cache_ttl: Dict[str, datetime] = {}
PROVIDER_CACHE_TTL_SECONDS = 300


async def fetch_provider_config(provider_name: str) -> Optional[Dict[str, Any]]:
    """DB에서 LLM provider 설정 가져오기 (캐시 적용)"""
    cache_key = provider_name.lower()
    now = datetime.now(timezone.utc)

    if cache_key in _provider_config_cache:
        cache_time = _provider_cache_ttl.get(cache_key)
        if cache_time and (now - cache_time).total_seconds() < PROVIDER_CACHE_TTL_SECONDS:
            return _provider_config_cache[cache_key]

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{api_config.COLLECTOR_SERVICE_URL}/api/v1/llm-providers/config/{provider_name}"
            )
            if response.status_code == 200:
                provider_config = response.json()
                _provider_config_cache[cache_key] = provider_config
                _provider_cache_ttl[cache_key] = now
                return provider_config
    except Exception as e:
        logger.warning("Failed to fetch provider config", provider=provider_name, error=str(e))

    return None


def clear_provider_cache():
    """Provider 캐시 삭제"""
    _provider_config_cache.clear()
    _provider_cache_ttl.clear()


# ========================================
# LLM Factory
# ========================================


def get_llm_from_env(provider: LLMProvider, model: Optional[str] = None):
    """환경변수/Settings 기반으로 LLM 인스턴스 생성

    Note: Settings는 Consul에서 로드된 설정을 포함합니다.
    """
    from langchain_openai import ChatOpenAI
    from langchain_anthropic import ChatAnthropic
    from langchain_google_genai import ChatGoogleGenerativeAI

    # Get settings (includes Consul-loaded config)
    settings = get_settings()

    if provider == LLMProvider.OPENAI:
        return ChatOpenAI(
            model=model or settings.llm.openai_model or "gpt-4o",
            api_key=settings.llm.openai_api_key or api_config.OPENAI_API_KEY,
            temperature=0.1,
        )
    elif provider == LLMProvider.ANTHROPIC:
        return ChatAnthropic(
            model=model or settings.llm.anthropic_model or "claude-3-5-sonnet-20241022",
            api_key=settings.llm.anthropic_api_key or api_config.ANTHROPIC_API_KEY,
            temperature=0.1,
        )
    elif provider == LLMProvider.GOOGLE:
        return ChatGoogleGenerativeAI(
            model=model or "gemini-1.5-pro",
            google_api_key=api_config.GOOGLE_API_KEY,
            temperature=0.1,
        )
    elif provider == LLMProvider.OPENROUTER:
        return ChatOpenAI(
            model=model or settings.llm.openrouter_model or "openai/gpt-4o",
            api_key=settings.llm.openrouter_api_key,
            base_url=settings.llm.openrouter_base_url or "https://openrouter.ai/api/v1",
            temperature=0.1,
        )
    elif provider == LLMProvider.OLLAMA:
        try:
            from langchain_ollama import ChatOllama

            return ChatOllama(
                model=model or settings.llm.ollama_model or "llama3.1",
                base_url=settings.llm.ollama_base_url or "http://localhost:11434",
                temperature=0.1,
            )
        except ImportError:
            raise ValueError("Ollama support requires langchain-ollama package")
    elif provider == LLMProvider.AZURE:
        try:
            from langchain_openai import AzureChatOpenAI

            azure_endpoint = settings.llm.azure_endpoint or os.getenv("AZURE_OPENAI_ENDPOINT", "")
            azure_api_key = settings.llm.azure_api_key or os.getenv("AZURE_OPENAI_API_KEY", "")
            azure_deployment = (
                model
                or settings.llm.azure_deployment_name
                or os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-4o")
            )
            azure_api_version = settings.llm.azure_api_version or os.getenv(
                "AZURE_OPENAI_API_VERSION", "2024-02-15-preview"
            )

            if not azure_endpoint:
                raise ValueError(
                    "Azure OpenAI requires LLM_AZURE_ENDPOINT or AZURE_OPENAI_ENDPOINT"
                )
            if not azure_api_key:
                raise ValueError("Azure OpenAI requires LLM_AZURE_API_KEY or AZURE_OPENAI_API_KEY")

            return AzureChatOpenAI(
                azure_endpoint=azure_endpoint,
                azure_deployment=azure_deployment,
                api_key=azure_api_key,
                api_version=azure_api_version,
                temperature=0.1,
            )
        except ImportError:
            raise ValueError("Azure OpenAI support requires langchain-openai package")
    elif provider == LLMProvider.CUSTOM:
        custom_base_url = settings.llm.custom_base_url or os.getenv("CUSTOM_LLM_BASE_URL", "")
        if not custom_base_url:
            raise ValueError("Custom provider requires CUSTOM_LLM_BASE_URL or LLM_CUSTOM_BASE_URL")

        custom_request_format = settings.llm.custom_request_format
        custom_response_path = settings.llm.custom_response_path

        # If custom request format is provided, use CustomRESTAPIClient for non-OpenAI-compatible APIs
        if custom_request_format:
            from src.crawler.agent import CustomRESTAPIClient

            return CustomRESTAPIClient(
                base_url=custom_base_url,
                api_key=settings.llm.custom_api_key or os.getenv("CUSTOM_LLM_API_KEY", ""),
                model=model or settings.llm.custom_model or "default",
                request_format=custom_request_format,
                response_path=custom_response_path or "reply",
                custom_headers=settings.llm.custom_headers or "{}",
                temperature=0.1,
            )

        # Fallback to OpenAI-compatible format
        return ChatOpenAI(
            model=model or settings.llm.custom_model or "default",
            api_key=settings.llm.custom_api_key or os.getenv("CUSTOM_LLM_API_KEY", "none"),
            base_url=custom_base_url,
            temperature=0.1,
        )
    else:
        raise ValueError(f"Unsupported LLM provider: {provider}")


def get_llm_from_config(provider_config: Dict[str, Any], model_override: Optional[str] = None):
    """DB 설정 기반으로 LLM 인스턴스 생성"""
    from langchain_openai import ChatOpenAI
    from langchain_anthropic import ChatAnthropic
    from langchain_google_genai import ChatGoogleGenerativeAI

    provider_type = provider_config.get("providerType", "").upper()
    api_key = provider_config.get("apiKey", "")
    base_url = provider_config.get("baseUrl")
    default_model = model_override or provider_config.get("defaultModel", "")
    extra_config = provider_config.get("config", {})
    temperature = extra_config.get("temperature", 0.1)

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
        return ChatOpenAI(
            model=default_model or "openai/gpt-4o",
            api_key=api_key,
            base_url=base_url or "https://openrouter.ai/api/v1",
            temperature=temperature,
        )

    elif provider_type == "OLLAMA":
        try:
            from langchain_ollama import ChatOllama

            return ChatOllama(
                model=default_model or "llama3.1",
                base_url=base_url or "http://localhost:11434",
                temperature=temperature,
            )
        except ImportError:
            raise ValueError("Ollama support requires langchain-ollama package")

    elif provider_type == "AZURE":
        try:
            from langchain_openai import AzureChatOpenAI

            azure_endpoint = extra_config.get("endpoint") or base_url
            deployment_name = extra_config.get("deployment_name") or default_model
            api_version = extra_config.get("api_version", "2024-02-15-preview")

            if not azure_endpoint:
                raise ValueError("Azure provider requires endpoint")
            if not deployment_name:
                raise ValueError("Azure provider requires deployment_name")

            return AzureChatOpenAI(
                azure_endpoint=azure_endpoint,
                azure_deployment=deployment_name,
                api_key=api_key,
                api_version=api_version,
                temperature=temperature,
            )
        except ImportError:
            raise ValueError("Azure OpenAI support requires langchain-openai package")

    elif provider_type == "CUSTOM":
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
    """LLM 인스턴스 가져오기 - DB 우선, 환경변수 fallback"""
    provider_name = provider.value

    if api_config.USE_DB_PROVIDERS:
        provider_config = await fetch_provider_config(provider_name)
        if provider_config:
            try:
                return get_llm_from_config(provider_config, model)
            except Exception as e:
                logger.warning(
                    "DB provider failed, using fallback",
                    provider=provider_name,
                    error=str(e),
                )

    return get_llm_from_env(provider, model)


# ========================================
# Core Agent Logic
# ========================================


async def run_browser_agent(
    request: AgentTask,
    settings: Settings,
    sse_manager: SSEManager,
) -> AgentTaskResult:
    """
    browser-use 에이전트 실행.

    기존 autonomous-crawler-service의 AutonomousCrawlerAgent를 활용하면서
    browser-agent의 API 인터페이스와 SSE 이벤트를 제공합니다.
    """
    global session_semaphore

    task_id = str(uuid.uuid4())
    start_time = datetime.now(timezone.utc)
    actions_log: List[AgentAction] = []

    logger.info(
        "Agent task started",
        task_id=task_id,
        url=str(request.url),
        task=request.task[:100],
    )

    # SSE: 에이전트 시작 이벤트
    await sse_manager.send_agent_event(
        SSEEventType.AGENT_START,
        task_id=task_id,
        url=str(request.url),
        message=f"크롤링 시작: {request.task[:50]}...",
        provider=request.llm_provider.value,
    )

    try:
        if session_semaphore is None:
            session_semaphore = asyncio.Semaphore(api_config.MAX_CONCURRENT_SESSIONS)

        async with session_semaphore:
            # AutonomousCrawlerAgent 사용
            agent = AutonomousCrawlerAgent(settings)

            # 단순 URL 크롤링 + AI 분석
            # smart_search 메서드 활용
            crawl_result = await agent.crawl_with_camoufox(
                url=str(request.url),
                extract_content=True,
                wait_for_cloudflare=True,
            )

            if crawl_result.get("error"):
                raise Exception(crawl_result["error"])

            extracted_text = crawl_result.get("text", "")
            page_title = crawl_result.get("title", "")
            extracted_links: List[ExtractedLink] = []

            # 링크 추출 (옵션)
            if request.extract_links:
                links = crawl_result.get("links", [])
                extracted_links = [
                    ExtractedLink(url=link.get("url", ""), text=link.get("text", ""))
                    for link in links[:50]
                    if link.get("url", "").startswith("http")
                ]

            content_hash = (
                hashlib.sha256((extracted_text or "").encode()).hexdigest()
                if extracted_text
                else None
            )

            duration_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)

            task_result = AgentTaskResult(
                task_id=task_id,
                url=str(request.url),
                status="success",
                extracted_text=extracted_text,
                extracted_links=extracted_links,
                content_hash=content_hash,
                page_title=page_title,
                steps_taken=1,
                actions=actions_log,
                duration_ms=duration_ms,
            )

            # 브라우저 정리
            await agent.close()

            logger.info(
                "Agent task completed",
                task_id=task_id,
                duration_ms=duration_ms,
                links_count=len(extracted_links),
            )

            # SSE: 에이전트 완료 이벤트
            await sse_manager.send_agent_event(
                SSEEventType.AGENT_COMPLETE,
                task_id=task_id,
                url=str(request.url),
                message=f"크롤링 완료: {len(extracted_links)}개 링크 발견",
                duration_ms=duration_ms,
                links_count=len(extracted_links),
                has_content=bool(extracted_text),
            )

            return task_result

    except asyncio.TimeoutError:
        duration_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        logger.error("Agent task timeout", task_id=task_id, timeout=request.timeout_sec)

        await sse_manager.send_agent_event(
            SSEEventType.AGENT_ERROR,
            task_id=task_id,
            url=str(request.url),
            message=f"타임아웃: {request.timeout_sec}초 초과",
            error_type="timeout",
        )

        return AgentTaskResult(
            task_id=task_id,
            url=str(request.url),
            status="timeout",
            error_message=f"태스크가 {request.timeout_sec}초 내에 완료되지 않았습니다.",
            duration_ms=duration_ms,
        )

    except Exception as e:
        duration_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        logger.error("Agent task failed", task_id=task_id, error=str(e))

        await sse_manager.send_agent_event(
            SSEEventType.AGENT_ERROR,
            task_id=task_id,
            url=str(request.url),
            message=f"에러: {str(e)[:100]}",
            error_type="exception",
            error_detail=str(e),
        )

        return AgentTaskResult(
            task_id=task_id,
            url=str(request.url),
            status="failed",
            error_message=str(e),
            duration_ms=duration_ms,
        )


# ========================================
# FastAPI App
# ========================================


@asynccontextmanager
async def lifespan(app: FastAPI):
    """애플리케이션 수명 주기 관리"""
    logger.info("Starting autonomous-crawler REST API server")

    # Initialize StateStore (connects to Redis)
    state_store = await get_state_store()
    app.state.state_store = state_store
    logger.info(
        "StateStore initialized",
        using_redis=state_store.is_redis_connected,
        task_count=state_store.task_count,
    )

    yield

    # Cleanup StateStore
    logger.info("Shutting down autonomous-crawler REST API server")
    await close_state_store()


def create_app(settings: Settings | None = None) -> FastAPI:
    """FastAPI 앱 생성"""
    if settings is None:
        settings = get_settings()

    app = FastAPI(
        title="Autonomous Crawler Service API",
        description="AI 기반 자율 브라우저 크롤러 - browser-agent 통합 REST API",
        version="0.2.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Store settings in app state
    app.state.settings = settings
    app.state.sse_manager = get_sse_manager()

    # Register routes
    register_routes(app)

    return app


def register_routes(app: FastAPI):
    """API 라우트 등록"""

    @app.get("/health")
    @app.head("/health")
    async def health(req: Request):
        """헬스체크 엔드포인트"""
        state_store: StateStore = req.app.state.state_store
        store_stats = await state_store.get_stats()

        return {
            "status": "ok",
            "service": "autonomous-crawler-service",
            "api_version": "0.2.0",
            "features": {
                "rest_api": True,
                "sse_events": True,
                "kafka_consumer": True,
                "camoufox": True,
                "captcha_bypass": True,
                "redis_persistence": state_store.is_redis_connected,
            },
            "storage": store_stats,
            "active_sessions": state_store.task_count,
            "max_sessions": api_config.MAX_CONCURRENT_SESSIONS,
        }

    @app.get("/events")
    async def sse_events(request: Request):
        """
        SSE 이벤트 스트림 엔드포인트.

        브라우저 에이전트의 실시간 상태를 구독합니다.
        """
        sse_manager: SSEManager = request.app.state.sse_manager
        client_id, queue = await sse_manager.connect()

        return StreamingResponse(
            sse_event_generator(client_id, queue, sse_manager),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
                "Access-Control-Allow-Origin": "*",
            },
        )

    @app.get("/events/clients")
    async def get_sse_clients(request: Request):
        """현재 연결된 SSE 클라이언트 수 조회"""
        sse_manager: SSEManager = request.app.state.sse_manager
        return {
            "connected_clients": sse_manager.client_count,
            "client_ids": sse_manager.client_ids,
        }

    @app.get("/providers")
    async def get_available_providers():
        """사용 가능한 LLM Provider 목록 조회"""
        providers = []
        settings = get_settings()

        if settings.llm.openai_api_key or api_config.OPENAI_API_KEY:
            providers.append(
                {
                    "name": "openai",
                    "providerType": "OPENAI",
                    "defaultModel": settings.llm.openai_model or "gpt-4o",
                    "available": True,
                }
            )

        if settings.llm.anthropic_api_key or api_config.ANTHROPIC_API_KEY:
            providers.append(
                {
                    "name": "anthropic",
                    "providerType": "ANTHROPIC",
                    "defaultModel": settings.llm.anthropic_model or "claude-3-5-sonnet-20241022",
                    "available": True,
                }
            )

        if api_config.GOOGLE_API_KEY:
            providers.append(
                {
                    "name": "google",
                    "providerType": "GOOGLE",
                    "defaultModel": "gemini-1.5-pro",
                    "available": True,
                }
            )

        # OpenRouter (Settings 우선)
        if settings.llm.openrouter_api_key or os.getenv("OPENROUTER_API_KEY"):
            providers.append(
                {
                    "name": "openrouter",
                    "providerType": "OPENROUTER",
                    "defaultModel": settings.llm.openrouter_model or "openai/gpt-4o",
                    "available": True,
                }
            )

        # Ollama (항상 표시, 로컬에서 실행 가능)
        providers.append(
            {
                "name": "ollama",
                "providerType": "OLLAMA",
                "defaultModel": settings.llm.ollama_model or "llama3.1",
                "available": True,
                "local": True,
            }
        )

        # Azure OpenAI (Settings 우선)
        if (settings.llm.azure_api_key and settings.llm.azure_endpoint) or (
            os.getenv("AZURE_OPENAI_API_KEY") and os.getenv("AZURE_OPENAI_ENDPOINT")
        ):
            providers.append(
                {
                    "name": "azure",
                    "providerType": "AZURE",
                    "defaultModel": settings.llm.azure_deployment_name
                    or os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-4o"),
                    "available": True,
                }
            )

        # Custom (Settings 우선)
        if settings.llm.custom_base_url or os.getenv("CUSTOM_LLM_BASE_URL"):
            providers.append(
                {
                    "name": "custom",
                    "providerType": "CUSTOM",
                    "defaultModel": settings.llm.custom_model or "default",
                    "available": True,
                }
            )

        return {
            "providers": providers,
            "defaultProvider": providers[0] if providers else None,
            "source": "environment",
            "supportedProviders": [p.value for p in LLMProvider],
        }

    @app.post("/providers/cache/clear")
    async def clear_providers_cache_endpoint():
        """Provider 설정 캐시 삭제"""
        clear_provider_cache()
        return {"status": "ok", "message": "Provider cache cleared"}

    @app.post("/providers/test")
    async def test_provider_connection(
        provider: LLMProvider = Query(..., description="테스트할 Provider"),
        model: Optional[str] = Query(default=None, description="테스트할 모델"),
    ):
        """
        LLM Provider 연결 테스트.

        간단한 프롬프트를 보내 Provider가 정상 작동하는지 확인합니다.
        """
        import time

        start_time = time.time()

        try:
            llm = await get_llm(provider, model)

            # 간단한 테스트 프롬프트
            from langchain_core.messages import HumanMessage

            test_message = HumanMessage(content="Say 'Connection successful!' in one line.")
            response = await llm.ainvoke([test_message])

            elapsed_ms = int((time.time() - start_time) * 1000)

            return {
                "status": "success",
                "provider": provider.value,
                "model": model or "default",
                "response": response.content[:100] if response.content else "No response",
                "latency_ms": elapsed_ms,
                "message": "연결 성공",
            }

        except Exception as e:
            elapsed_ms = int((time.time() - start_time) * 1000)
            logger.error("Provider test failed", provider=provider.value, error=str(e))
            return {
                "status": "failed",
                "provider": provider.value,
                "model": model or "default",
                "error": str(e),
                "latency_ms": elapsed_ms,
                "message": f"연결 실패: {str(e)[:100]}",
            }

    @app.get("/providers/{provider}/models")
    async def get_provider_models(
        provider: LLMProvider,
        api_key: Optional[str] = Query(
            default=None, description="API 키 (옵션, 없으면 환경변수 사용)"
        ),
        base_url: Optional[str] = Query(default=None, description="Base URL (Ollama, Custom용)"),
    ):
        """
        특정 LLM Provider에서 사용 가능한 모델 목록을 동적으로 조회합니다.

        - OpenAI: /v1/models API 호출
        - OpenRouter: /api/v1/models API 호출
        - Ollama: /api/tags API 호출
        - Anthropic, Google, Azure: 정적 목록 반환 (공식 API 없음)
        - Custom: /v1/models 또는 정적 목록
        """
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                if provider == LLMProvider.OPENAI:
                    key = api_key or os.getenv("OPENAI_API_KEY", "")
                    if not key:
                        return {
                            "provider": provider.value,
                            "models": _get_static_models("openai"),
                            "source": "static",
                            "message": "API 키가 없어 정적 목록 반환",
                        }

                    resp = await client.get(
                        "https://api.openai.com/v1/models",
                        headers={"Authorization": f"Bearer {key}"},
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        # GPT 모델만 필터링 (chat 모델)
                        models = [
                            {"id": m["id"], "name": m["id"], "owned_by": m.get("owned_by", "")}
                            for m in data.get("data", [])
                            if any(prefix in m["id"] for prefix in ["gpt-", "o1-", "chatgpt-"])
                        ]
                        # 정렬: gpt-4o 우선
                        models.sort(key=lambda x: (0 if "gpt-4o" in x["id"] else 1, x["id"]))
                        return {
                            "provider": provider.value,
                            "models": models[:20],  # 최대 20개
                            "source": "api",
                            "total": len(models),
                        }
                    else:
                        return {
                            "provider": provider.value,
                            "models": _get_static_models("openai"),
                            "source": "static",
                            "error": f"API 호출 실패: {resp.status_code}",
                        }

                elif provider == LLMProvider.OPENROUTER:
                    key = api_key or os.getenv("OPENROUTER_API_KEY", "")
                    headers = {}
                    if key:
                        headers["Authorization"] = f"Bearer {key}"

                    resp = await client.get(
                        "https://openrouter.ai/api/v1/models",
                        headers=headers,
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        models = [
                            {
                                "id": m["id"],
                                "name": m.get("name", m["id"]),
                                "context_length": m.get("context_length"),
                                "pricing": m.get("pricing"),
                            }
                            for m in data.get("data", [])[:50]  # 상위 50개
                        ]
                        return {
                            "provider": provider.value,
                            "models": models,
                            "source": "api",
                            "total": len(data.get("data", [])),
                        }
                    else:
                        return {
                            "provider": provider.value,
                            "models": _get_static_models("openrouter"),
                            "source": "static",
                            "error": f"API 호출 실패: {resp.status_code}",
                        }

                elif provider == LLMProvider.OLLAMA:
                    ollama_url = base_url or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
                    try:
                        resp = await client.get(f"{ollama_url}/api/tags")
                        if resp.status_code == 200:
                            data = resp.json()
                            models = [
                                {
                                    "id": m["name"],
                                    "name": m["name"],
                                    "size": m.get("size"),
                                    "modified_at": m.get("modified_at"),
                                }
                                for m in data.get("models", [])
                            ]
                            return {
                                "provider": provider.value,
                                "models": models,
                                "source": "api",
                                "ollama_url": ollama_url,
                            }
                        else:
                            return {
                                "provider": provider.value,
                                "models": _get_static_models("ollama"),
                                "source": "static",
                                "error": f"Ollama 연결 실패: {resp.status_code}",
                            }
                    except httpx.ConnectError:
                        return {
                            "provider": provider.value,
                            "models": _get_static_models("ollama"),
                            "source": "static",
                            "error": f"Ollama 서버에 연결할 수 없음: {ollama_url}",
                        }

                elif provider == LLMProvider.ANTHROPIC:
                    # Anthropic은 공식 모델 목록 API가 없음
                    return {
                        "provider": provider.value,
                        "models": _get_static_models("anthropic"),
                        "source": "static",
                        "message": "Anthropic은 모델 목록 API를 제공하지 않음",
                    }

                elif provider == LLMProvider.GOOGLE:
                    # Google AI도 정적 목록 사용
                    return {
                        "provider": provider.value,
                        "models": _get_static_models("google"),
                        "source": "static",
                        "message": "Google AI는 정적 모델 목록 사용",
                    }

                elif provider == LLMProvider.AZURE:
                    # Azure는 배포 기반이라 동적 조회 불가
                    return {
                        "provider": provider.value,
                        "models": _get_static_models("azure"),
                        "source": "static",
                        "message": "Azure OpenAI는 배포 기반으로 동적 조회 불가",
                    }

                elif provider == LLMProvider.CUSTOM:
                    custom_url = base_url or os.getenv("CUSTOM_LLM_BASE_URL", "")
                    if custom_url:
                        try:
                            resp = await client.get(f"{custom_url}/v1/models")
                            if resp.status_code == 200:
                                data = resp.json()
                                models = [
                                    {"id": m["id"], "name": m.get("id", "")}
                                    for m in data.get("data", [])
                                ]
                                return {
                                    "provider": provider.value,
                                    "models": models,
                                    "source": "api",
                                    "base_url": custom_url,
                                }
                        except Exception:
                            pass

                    return {
                        "provider": provider.value,
                        "models": [{"id": "default", "name": "기본 모델"}],
                        "source": "static",
                    }

                else:
                    return {
                        "provider": provider.value,
                        "models": [],
                        "source": "unknown",
                        "error": "알 수 없는 Provider",
                    }

        except Exception as e:
            logger.error("Failed to fetch models", provider=provider.value, error=str(e))
            return {
                "provider": provider.value,
                "models": _get_static_models(provider.value),
                "source": "static",
                "error": str(e),
            }

    def _get_static_models(provider: str) -> List[Dict[str, Any]]:
        """정적 모델 목록 반환 (fallback)"""
        static_models = {
            "openai": [
                {"id": "gpt-4o", "name": "GPT-4o (추천)"},
                {"id": "gpt-4o-mini", "name": "GPT-4o Mini (빠름)"},
                {"id": "gpt-4-turbo", "name": "GPT-4 Turbo"},
                {"id": "gpt-3.5-turbo", "name": "GPT-3.5 Turbo (저렴)"},
                {"id": "o1-preview", "name": "o1-preview (추론)"},
                {"id": "o1-mini", "name": "o1-mini (추론, 빠름)"},
            ],
            "anthropic": [
                {"id": "claude-3-5-sonnet-20241022", "name": "Claude 3.5 Sonnet (추천)"},
                {"id": "claude-3-5-haiku-20241022", "name": "Claude 3.5 Haiku (빠름)"},
                {"id": "claude-3-opus-20240229", "name": "Claude 3 Opus (강력)"},
            ],
            "google": [
                {"id": "gemini-1.5-pro", "name": "Gemini 1.5 Pro (추천)"},
                {"id": "gemini-1.5-flash", "name": "Gemini 1.5 Flash (빠름)"},
                {"id": "gemini-2.0-flash-exp", "name": "Gemini 2.0 Flash (실험)"},
            ],
            "openrouter": [
                {"id": "openai/gpt-4o", "name": "GPT-4o (OpenAI)"},
                {"id": "anthropic/claude-3.5-sonnet", "name": "Claude 3.5 Sonnet"},
                {"id": "google/gemini-pro-1.5", "name": "Gemini 1.5 Pro"},
                {"id": "meta-llama/llama-3.1-405b-instruct", "name": "Llama 3.1 405B"},
                {"id": "meta-llama/llama-3.1-70b-instruct", "name": "Llama 3.1 70B"},
                {"id": "mistralai/mixtral-8x22b-instruct", "name": "Mixtral 8x22B"},
                {"id": "deepseek/deepseek-chat", "name": "DeepSeek Chat"},
                {"id": "qwen/qwen-2.5-72b-instruct", "name": "Qwen 2.5 72B"},
            ],
            "ollama": [
                {"id": "llama3.1", "name": "Llama 3.1 (추천)"},
                {"id": "llama3.1:70b", "name": "Llama 3.1 70B"},
                {"id": "mistral", "name": "Mistral"},
                {"id": "mixtral", "name": "Mixtral"},
                {"id": "codellama", "name": "Code Llama"},
                {"id": "qwen2.5", "name": "Qwen 2.5"},
                {"id": "gemma2", "name": "Gemma 2"},
            ],
            "azure": [
                {"id": "gpt-4o", "name": "GPT-4o"},
                {"id": "gpt-4-turbo", "name": "GPT-4 Turbo"},
                {"id": "gpt-35-turbo", "name": "GPT-3.5 Turbo"},
            ],
            "custom": [
                {"id": "default", "name": "기본 모델"},
            ],
        }
        return static_models.get(provider, [])

    @app.post("/agent/crawl", response_model=AgentTaskResult)
    async def agent_crawl(request: AgentTask, req: Request):
        """
        AI 에이전트 크롤링 실행 (동기).

        CAPTCHA 우회 및 스텔스 모드 지원.
        """
        settings: Settings = req.app.state.settings
        sse_manager: SSEManager = req.app.state.sse_manager
        state_store: StateStore = req.app.state.state_store

        result = await run_browser_agent(request, settings, sse_manager)
        await state_store.save_task(result.task_id, result)
        return result

    @app.post("/agent/crawl/async")
    async def agent_crawl_async(
        request: AgentTask,
        req: Request,
        background_tasks: BackgroundTasks,
    ):
        """AI 에이전트 크롤링 비동기 실행"""
        settings: Settings = req.app.state.settings
        sse_manager: SSEManager = req.app.state.sse_manager
        state_store: StateStore = req.app.state.state_store
        task_id = str(uuid.uuid4())

        async def run_task():
            result = await run_browser_agent(request, settings, sse_manager)
            result.task_id = task_id
            await state_store.save_task(task_id, result)

        background_tasks.add_task(asyncio.create_task, run_task())

        return {
            "task_id": task_id,
            "status": "queued",
            "message": "태스크가 큐에 추가되었습니다. GET /agent/task/{task_id}로 상태를 확인하세요.",
        }

    @app.get("/agent/task/{task_id}", response_model=AgentTaskResult)
    async def get_task_result(task_id: str, req: Request):
        """태스크 결과 조회"""
        state_store: StateStore = req.app.state.state_store
        result = await state_store.load_task(task_id)
        if result is None:
            raise HTTPException(status_code=404, detail="태스크를 찾을 수 없습니다.")
        return result

    @app.delete("/agent/task/{task_id}")
    async def delete_task(task_id: str, req: Request):
        """태스크 결과 삭제"""
        state_store: StateStore = req.app.state.state_store
        result = await state_store.load_task(task_id)
        if result is not None:
            await state_store.delete_task(task_id)
            return {"status": "deleted", "task_id": task_id}
        raise HTTPException(status_code=404, detail="태스크를 찾을 수 없습니다.")

    @app.get("/agent/tasks")
    async def list_tasks(
        req: Request,
        limit: int = Query(default=20, le=100),
        status: Optional[str] = Query(default=None),
    ):
        """최근 태스크 목록 조회"""
        state_store: StateStore = req.app.state.state_store
        results = await state_store.list_tasks(status=status, limit=limit)

        # Sort by duration_ms (stored tasks are dicts, not Pydantic models)
        results = sorted(results, key=lambda x: x.get("duration_ms", 0), reverse=True)[:limit]

        return {"total": len(results), "tasks": results}

    @app.post("/agent/batch")
    async def batch_crawl(
        request: BatchCrawlRequest,
        req: Request,
        background_tasks: BackgroundTasks,
    ):
        """여러 URL 배치 크롤링"""
        settings: Settings = req.app.state.settings
        sse_manager: SSEManager = req.app.state.sse_manager
        state_store: StateStore = req.app.state.state_store
        batch_id = str(uuid.uuid4())
        task_ids = []

        tasks_to_run = []
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

        async def run_batch():
            for agent_task, tid in tasks_to_run:
                try:
                    result = await run_browser_agent(agent_task, settings, sse_manager)
                    result.task_id = tid
                    await state_store.save_task(tid, result)
                except Exception as e:
                    error_result = AgentTaskResult(
                        task_id=tid,
                        url=str(agent_task.url),
                        status="failed",
                        error_message=str(e),
                        duration_ms=0,
                    )
                    await state_store.save_task(tid, error_result)

        background_tasks.add_task(run_batch)

        return {
            "batch_id": batch_id,
            "task_ids": task_ids,
            "total": len(task_ids),
            "message": "배치 크롤링이 시작되었습니다.",
        }

    # ========================================
    # 뉴스 프리셋 엔드포인트
    # ========================================

    @app.post("/agent/presets/extract-article")
    async def extract_article(url: HttpUrl, req: Request, auto_save: bool = True):
        """
        뉴스 기사 추출 프리셋.

        URL에서 제목, 작성자, 날짜, 본문을 자동 추출.
        """
        settings: Settings = req.app.state.settings
        sse_manager: SSEManager = req.app.state.sse_manager
        state_store: StateStore = req.app.state.state_store

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
        result = await run_browser_agent(request, settings, sse_manager)
        await state_store.save_task(result.task_id, result)
        return result

    @app.post("/agent/presets/extract-comments")
    async def extract_comments(
        url: HttpUrl,
        req: Request,
        max_scroll: int = 5,
    ):
        """
        댓글/여론 추출 프리셋.

        게시글의 댓글들을 수집.
        """
        settings: Settings = req.app.state.settings
        sse_manager: SSEManager = req.app.state.sse_manager
        state_store: StateStore = req.app.state.state_store

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
        result = await run_browser_agent(request, settings, sse_manager)
        await state_store.save_task(result.task_id, result)
        return result

    @app.post("/agent/presets/site-structure")
    async def analyze_site_structure(url: HttpUrl, req: Request):
        """
        사이트 구조 분석 프리셋.

        사이트의 주요 섹션과 링크 구조 파악.
        """
        settings: Settings = req.app.state.settings
        sse_manager: SSEManager = req.app.state.sse_manager
        state_store: StateStore = req.app.state.state_store

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
        result = await run_browser_agent(request, settings, sse_manager)
        await state_store.save_task(result.task_id, result)
        return result

    @app.post("/agent/presets/news-domain-crawl")
    async def news_domain_crawl(
        url: HttpUrl,
        req: Request,
        max_pages: int = Query(default=30, ge=1, le=100, description="최대 방문 페이지 수"),
        max_depth: int = Query(default=2, ge=1, le=5, description="최대 탐색 깊이"),
        focus_keywords: Optional[str] = Query(default=None, description="집중 키워드 (쉼표 구분)"),
    ):
        """
        뉴스 도메인 전체 크롤링 프리셋.

        뉴스 사이트의 기사들을 자동으로 탐색하고 수집합니다.
        NEWS_ONLY 정책을 사용하여 뉴스 기사만 추출합니다.

        Args:
            url: 시작 URL (뉴스 사이트 메인 또는 섹션 페이지)
            max_pages: 최대 방문할 페이지 수
            max_depth: 링크 탐색 최대 깊이
            focus_keywords: 특정 키워드에 집중할 경우 쉼표로 구분하여 입력
        """
        settings: Settings = req.app.state.settings
        sse_manager: SSEManager = req.app.state.sse_manager
        state_store: StateStore = req.app.state.state_store

        keyword_instruction = ""
        if focus_keywords:
            keyword_instruction = (
                f"\n특히 다음 키워드와 관련된 기사에 집중해주세요: {focus_keywords}"
            )

        request = AgentTask(
            url=url,
            task=f"""
            이 뉴스 사이트에서 기사들을 수집해주세요:
            
            1. 메인 페이지에서 뉴스 기사 링크들을 찾아주세요
            2. 각 기사 페이지에서 제목, 기자명, 발행일, 본문을 추출해주세요
            3. 최대 {max_pages}개 페이지를 방문하면서 기사를 수집해주세요
            4. 최근 기사를 우선으로 수집해주세요
            5. 광고, 로그인 페이지, 비기사 콘텐츠는 건너뛰세요
            {keyword_instruction}
            
            각 기사는 다음 형식으로 정리해주세요:
            ---ARTICLE_START---
            URL: [기사 URL]
            TITLE: [제목]
            AUTHOR: [기자명]
            PUBLISHED_AT: [발행일]
            CONTENT: [본문]
            ---ARTICLE_END---
            """,
            max_steps=max_pages + 10,
            timeout_sec=min(max_pages * 15, 600),
            extract_links=True,
            auto_save_url=True,
            source_category="news",
        )
        result = await run_browser_agent(request, settings, sse_manager)
        await state_store.save_task(result.task_id, result)
        return result

    @app.post("/agent/presets/discover-rss")
    async def discover_rss(url: HttpUrl, req: Request):
        """
        RSS 피드 발견 프리셋.

        웹사이트에서 RSS/Atom 피드 URL을 찾아냅니다.
        뉴스 수집 자동화를 위한 피드 URL 발견에 사용합니다.
        """
        settings: Settings = req.app.state.settings
        sse_manager: SSEManager = req.app.state.sse_manager
        state_store: StateStore = req.app.state.state_store

        request = AgentTask(
            url=url,
            task="""
            이 웹사이트에서 RSS 또는 Atom 피드를 찾아주세요:
            
            1. 페이지 소스에서 RSS/Atom 링크 태그 확인
               - <link rel="alternate" type="application/rss+xml" ...>
               - <link rel="alternate" type="application/atom+xml" ...>
            2. 일반적인 RSS 경로 확인:
               - /feed, /rss, /feeds, /rss.xml, /feed.xml, /atom.xml
               - /news/rss, /blog/feed 등
            3. 페이지 푸터나 사이드바의 RSS 아이콘/링크 확인
            4. sitemap.xml에서 피드 정보 확인
            
            발견된 모든 피드를 다음 JSON 형식으로 정리해주세요:
            {
                "feeds": [
                    {
                        "url": "피드 URL",
                        "type": "rss" 또는 "atom",
                        "title": "피드 제목 (있는 경우)",
                        "category": "카테고리 (있는 경우)"
                    }
                ],
                "sitemap_url": "사이트맵 URL (발견된 경우)",
                "has_api_hints": true/false
            }
            """,
            max_steps=15,
            extract_links=True,
            auto_save_url=False,
            source_category="general",
        )
        result = await run_browser_agent(request, settings, sse_manager)
        await state_store.save_task(result.task_id, result)
        return result

    @app.post("/agent/presets/extract-news-list")
    async def extract_news_list(
        url: HttpUrl,
        req: Request,
        max_articles: int = Query(default=20, ge=1, le=50, description="추출할 최대 기사 수"),
    ):
        """
        뉴스 목록 페이지 추출 프리셋.

        뉴스 섹션/카테고리 페이지에서 기사 목록을 추출합니다.
        각 기사의 제목, URL, 요약, 발행일을 수집합니다.
        """
        settings: Settings = req.app.state.settings
        sse_manager: SSEManager = req.app.state.sse_manager
        state_store: StateStore = req.app.state.state_store

        request = AgentTask(
            url=url,
            task=f"""
            이 페이지에서 뉴스 기사 목록을 추출해주세요:
            
            1. 최대 {max_articles}개의 기사 정보를 수집해주세요
            2. 각 기사에 대해 다음 정보를 추출:
               - 기사 제목
               - 기사 URL (전체 링크)
               - 요약/리드 문구 (있는 경우)
               - 발행일/시간 (있는 경우)
               - 썸네일 이미지 URL (있는 경우)
               - 카테고리/섹션 (있는 경우)
            3. 광고나 프로모션 콘텐츠는 제외해주세요
            4. 최신 기사 순으로 정렬해주세요
            
            JSON 배열 형식으로 정리해주세요:
            [
                {{
                    "title": "기사 제목",
                    "url": "기사 URL",
                    "summary": "요약",
                    "published_at": "발행일",
                    "thumbnail": "썸네일 URL",
                    "category": "카테고리"
                }}
            ]
            """,
            max_steps=10,
            extract_links=True,
            auto_save_url=True,
            source_category="news",
        )
        result = await run_browser_agent(request, settings, sse_manager)
        await state_store.save_task(result.task_id, result)
        return result

    @app.post("/agent/presets/monitor-breaking-news")
    async def monitor_breaking_news(
        url: HttpUrl,
        req: Request,
        keywords: Optional[str] = Query(default=None, description="모니터링 키워드 (쉼표 구분)"),
    ):
        """
        속보/긴급 뉴스 모니터링 프리셋.

        뉴스 사이트에서 속보나 긴급 뉴스를 탐지합니다.
        '속보', '긴급', 'Breaking' 등의 라벨이 붙은 기사를 우선 수집합니다.
        """
        settings: Settings = req.app.state.settings
        sse_manager: SSEManager = req.app.state.sse_manager
        state_store: StateStore = req.app.state.state_store

        keyword_filter = ""
        if keywords:
            keyword_filter = f"\n특히 다음 키워드가 포함된 속보에 주목해주세요: {keywords}"

        request = AgentTask(
            url=url,
            task=f"""
            이 뉴스 사이트에서 속보/긴급 뉴스를 찾아주세요:
            
            1. 다음 표시가 있는 기사를 우선 탐지:
               - "속보", "Breaking", "긴급", "단독", "flash"
               - 빨간색 또는 강조된 라벨
               - 상단 고정 또는 특별 섹션의 기사
            2. 최근 1시간 이내 발행된 기사 우선
            3. 각 속보 기사의 전체 내용 추출
            {keyword_filter}
            
            결과를 다음 형식으로 정리해주세요:
            {{
                "breaking_news": [
                    {{
                        "title": "기사 제목",
                        "url": "기사 URL",
                        "published_at": "발행 시간",
                        "label": "속보/긴급/단독 등",
                        "summary": "핵심 내용 요약",
                        "full_content": "전체 본문"
                    }}
                ],
                "latest_update": "마지막 확인 시간",
                "total_found": 발견된 속보 수
            }}
            """,
            max_steps=15,
            timeout_sec=180,
            extract_links=True,
            auto_save_url=True,
            source_category="news",
        )
        result = await run_browser_agent(request, settings, sse_manager)
        await state_store.save_task(result.task_id, result)
        return result

    # ========================================
    # 채팅 엔드포인트
    # ========================================

    async def fetch_page_content_for_context(url: str, max_chars: int = 8000) -> Optional[str]:
        """
        URL에서 페이지 내용을 가져와 컨텍스트로 사용.

        crawl4ai 또는 내부 크롤러를 통해 페이지 내용을 마크다운으로 변환.
        """
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                # 1차: crawl4ai 서비스 시도
                try:

                    def extract_content(payload: Any) -> Optional[str]:
                        if isinstance(payload, dict):
                            results = payload.get("results")
                            if isinstance(results, list) and results:
                                return extract_content(results[0])
                            result = payload.get("result")
                            if result is not None:
                                return extract_content(result)
                            for key in ("markdown", "text", "content"):
                                value = payload.get(key)
                                if isinstance(value, str) and value.strip():
                                    return value
                            return None
                        if isinstance(payload, str) and payload.strip():
                            return payload
                        return None

                    headers: dict[str, str] = {}
                    if api_config.WEB_CRAWLER_API_TOKEN:
                        headers["Authorization"] = f"Bearer {api_config.WEB_CRAWLER_API_TOKEN}"

                    base_url = api_config.WEB_CRAWLER_URL.rstrip("/")
                    endpoint = f"{base_url}/crawl"

                    crawl_response = await client.get(
                        endpoint, params={"url": url}, headers=headers
                    )
                    if crawl_response.status_code == 200:
                        try:
                            crawl_data = crawl_response.json()
                        except Exception:
                            crawl_data = crawl_response.text
                        content = extract_content(crawl_data)
                        if content:
                            return content[:max_chars]

                    crawl_response = await client.post(
                        endpoint,
                        json={"urls": [url], "priority": 10},
                        headers=headers,
                    )
                    if crawl_response.status_code == 200:
                        crawl_data = crawl_response.json()
                        content = extract_content(crawl_data)
                        if content:
                            return content[:max_chars]

                        task_id = crawl_data.get("task_id")
                        if task_id:
                            for status_path in (
                                f"{base_url}/task/{task_id}",
                                f"{base_url}/job/{task_id}",
                            ):
                                try:
                                    status_response = await client.get(status_path, headers=headers)
                                    if status_response.status_code == 200:
                                        status_data = status_response.json()
                                        status_content = extract_content(status_data)
                                        if status_content:
                                            return status_content[:max_chars]
                                except Exception:
                                    continue
                except Exception:
                    pass

                # 2차: 직접 HTTP 요청 fallback
                try:
                    response = await client.get(url, follow_redirects=True)
                    if response.status_code == 200:
                        from bs4 import BeautifulSoup

                        soup = BeautifulSoup(response.text, "html.parser")

                        # 불필요한 요소 제거
                        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
                            tag.decompose()

                        # 본문 텍스트 추출
                        text = soup.get_text(separator="\n", strip=True)
                        return text[:max_chars] if text else None
                except Exception:
                    pass

        except Exception as e:
            logger.warning("Failed to fetch context URL", url=url, error=str(e))

        return None

    def convert_to_langchain_messages(messages: List[ChatMessage]):
        """ChatMessage 리스트를 LangChain 메시지로 변환"""
        from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

        langchain_messages = []
        for msg in messages:
            if msg.role == "user":
                langchain_messages.append(HumanMessage(content=msg.content))
            elif msg.role == "assistant":
                langchain_messages.append(AIMessage(content=msg.content))
            elif msg.role == "system":
                langchain_messages.append(SystemMessage(content=msg.content))
        return langchain_messages

    @app.post("/chat", response_model=ChatResponse)
    async def chat(request: ChatRequest):
        """
        AI 채팅 엔드포인트.

        LLM과 직접 대화하는 인터페이스.
        URL 컨텍스트가 제공되면 해당 페이지 내용을 참조하여 응답.

        사용 예시:
        ```json
        {
            "messages": [
                {"role": "user", "content": "이 기사의 핵심 내용을 요약해줘"}
            ],
            "context_url": "https://news.example.com/article/123"
        }
        ```
        """
        try:
            llm = await get_llm(request.llm_provider, request.model)
            langchain_messages = convert_to_langchain_messages(request.messages)

            # URL 컨텍스트가 있으면 페이지 내용 추가
            if request.context_url:
                page_content = await fetch_page_content_for_context(request.context_url)
                if page_content:
                    from langchain_core.messages import SystemMessage

                    context_msg = SystemMessage(
                        content=f"다음은 참조할 웹페이지 내용입니다:\n\n{page_content}"
                    )
                    langchain_messages.insert(0, context_msg)
                    logger.debug(
                        "Context URL content added",
                        url=request.context_url,
                        content_length=len(page_content),
                    )

            response = await llm.ainvoke(langchain_messages)

            return ChatResponse(
                message=response.content,
                provider=request.llm_provider.value,
                model=request.model or api_config.DEFAULT_MODEL,
                tokens_used=getattr(response, "usage_metadata", {}).get("total_tokens"),
            )

        except Exception as e:
            logger.error("Chat failed", error=str(e))
            raise HTTPException(status_code=500, detail=f"채팅 처리 실패: {str(e)}")

    @app.post("/chat/stream")
    async def chat_stream(request: ChatRequest):
        """
        AI 채팅 스트리밍 엔드포인트 (SSE).

        LLM 응답을 실시간으로 스트리밍합니다.
        URL 컨텍스트가 제공되면 해당 페이지 내용을 참조하여 응답.

        사용 예시:
        ```json
        {
            "messages": [
                {"role": "user", "content": "파이썬의 장점을 설명해줘"}
            ],
            "stream": true,
            "context_url": "https://docs.python.org/3/"
        }
        ```

        이벤트 타입:
        - chunk: 스트리밍 텍스트 조각
        - done: 스트리밍 완료
        - error: 에러 발생
        """
        import json

        async def generate_stream():
            try:
                llm = await get_llm(request.llm_provider, request.model)
                langchain_messages = convert_to_langchain_messages(request.messages)

                # URL 컨텍스트가 있으면 페이지 내용 추가
                if request.context_url:
                    page_content = await fetch_page_content_for_context(request.context_url)
                    if page_content:
                        from langchain_core.messages import SystemMessage

                        context_msg = SystemMessage(
                            content=f"다음은 참조할 웹페이지 내용입니다:\n\n{page_content}"
                        )
                        langchain_messages.insert(0, context_msg)
                        logger.debug(
                            "Context URL content added for streaming",
                            url=request.context_url,
                            content_length=len(page_content),
                        )

                # 스트리밍 LLM 호출
                full_response = ""
                async for chunk in llm.astream(langchain_messages):
                    if hasattr(chunk, "content") and chunk.content:
                        content = chunk.content
                        full_response += content
                        yield f"data: {json.dumps({'content': content, 'type': 'chunk'})}\n\n"

                # 완료 이벤트
                yield f"data: {json.dumps({'type': 'done', 'provider': request.llm_provider.value, 'model': request.model or api_config.DEFAULT_MODEL, 'full_response': full_response})}\n\n"

                logger.info(
                    "Chat stream completed",
                    provider=request.llm_provider.value,
                    response_length=len(full_response),
                )

            except Exception as e:
                logger.error("Chat stream failed", error=str(e))
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


# Default app instance
app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "src.api.server:app",
        host="0.0.0.0",
        port=8030,
        reload=os.getenv("ENV", "development") == "development",
    )
