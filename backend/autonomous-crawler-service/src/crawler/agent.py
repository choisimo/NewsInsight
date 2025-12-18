"""Autonomous crawler agent using browser-use with CAPTCHA bypass and proxy rotation."""

import asyncio
import json
import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional, TYPE_CHECKING

import httpx
import structlog
from browser_use.agent.service import Agent
from browser_use.browser.session import BrowserSession
from browser_use.browser.profile import BrowserProfile, ProxySettings
from browser_use.llm.openai.chat import ChatOpenAI
from browser_use.llm.anthropic.chat import ChatAnthropic
from pydantic import BaseModel

from src.config import Settings

# Proxy rotation client
try:
    import sys

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    from shared.proxy_client import ProxyRotationClient, ProxyInfo

    PROXY_CLIENT_AVAILABLE = True
except ImportError:
    PROXY_CLIENT_AVAILABLE = False
    ProxyRotationClient = None  # type: ignore
    ProxyInfo = None  # type: ignore
from src.crawler.policies import CrawlPolicy, get_policy_prompt
from src.kafka.messages import BrowserTaskMessage, CrawlResultMessage
from src.captcha.stealth import (
    StealthConfig,
    EnhancedStealthConfig,
    apply_stealth_to_playwright_async,
    get_undetected_browser_args,
    get_stealth_browser_args_with_extensions,
)
from src.captcha import (
    CaptchaSolverOrchestrator,
    CaptchaType,
    AdvancedStealthPatcher,
    HumanBehaviorSimulator,
    # Camoufox
    CamoufoxConfig,
    CamoufoxHelper,
    create_camoufox_browser,
    get_recommended_camoufox_config,
    is_camoufox_available,
)
from src.search.orchestrator import (
    ParallelSearchOrchestrator,
    RRFSearchOrchestrator,
    create_rrf_orchestrator,
)
from src.search.brave import BraveSearchProvider
from src.search.tavily import TavilySearchProvider
from src.search.perplexity import PerplexitySearchProvider
from src.search.query_analyzer import QueryAnalyzer

if TYPE_CHECKING:
    from browser_use.agent.service import Agent as BrowserUseAgent

logger = structlog.get_logger(__name__)


# =============================================================================
# Custom REST API Adapter for non-OpenAI-compatible APIs
# =============================================================================


class CustomRESTAPIClient:
    """
    Adapter for custom REST APIs with configurable request/response formats.

    Supports APIs like AI Dove that use non-standard request formats.
    Implements a minimal interface compatible with browser-use's LLM requirements.
    """

    def __init__(
        self,
        base_url: str,
        api_key: str = "",
        model: str = "",
        request_format: str = "",
        response_path: str = "reply",
        custom_headers: str = "",
        temperature: float = 0.0,
        timeout: float = 120.0,
    ):
        """
        Initialize the custom REST API client.

        Args:
            base_url: The API endpoint URL
            api_key: Optional API key for authentication
            model: Model name (used in request if format includes it)
            request_format: JSON template for request body with placeholders
            response_path: Dot-notation path to extract response from JSON
            custom_headers: JSON string of custom headers
            temperature: Temperature parameter (passed to API if supported)
            timeout: Request timeout in seconds
        """
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.request_format = request_format
        self.response_path = response_path
        self.custom_headers = custom_headers
        self.temperature = temperature
        self.timeout = timeout
        self._session_id = f"crawler_{int(time.time())}"

        # For browser-use compatibility
        self.provider = "custom"

    def _build_headers(self) -> dict[str, str]:
        """Build HTTP headers for the request."""
        headers = {"Content-Type": "application/json"}

        # Parse custom headers if provided
        if self.custom_headers:
            try:
                custom = json.loads(self.custom_headers)
                for key, value in custom.items():
                    # Replace {api_key} placeholder
                    if isinstance(value, str):
                        value = value.replace("{api_key}", self.api_key)
                    headers[key] = value
            except json.JSONDecodeError:
                logger.warning("Failed to parse custom_headers JSON", headers=self.custom_headers)

        # Add default Authorization header if API key is provided and not in custom headers
        if self.api_key and "Authorization" not in headers:
            headers["Authorization"] = f"Bearer {self.api_key}"

        return headers

    def _build_request_body(self, prompt: str) -> dict[str, Any]:
        """Build request body from template or default format."""
        if self.request_format:
            try:
                # Parse the template and substitute placeholders
                template = self.request_format
                template = template.replace("{prompt}", prompt)
                template = template.replace("{session_id}", self._session_id)
                template = template.replace("{model}", self.model)
                template = template.replace("{temperature}", str(self.temperature))
                return json.loads(template)
            except json.JSONDecodeError as e:
                logger.error(
                    "Failed to parse request_format JSON",
                    error=str(e),
                    template=self.request_format,
                )
                raise ValueError(f"Invalid custom_request_format JSON: {e}")

        # Default OpenAI-compatible format
        return {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": self.temperature,
        }

    def _extract_response(self, response_json: dict[str, Any]) -> str:
        """Extract response text using the configured path."""
        if not self.response_path:
            # Return full response as string
            return json.dumps(response_json)

        # Navigate the JSON path (supports dot notation and array indices)
        current = response_json
        for part in self.response_path.split("."):
            if part.isdigit():
                # Array index
                idx = int(part)
                if isinstance(current, list) and len(current) > idx:
                    current = current[idx]
                else:
                    raise KeyError(f"Array index {idx} not found in response")
            elif isinstance(current, dict):
                if part in current:
                    current = current[part]
                else:
                    raise KeyError(f"Key '{part}' not found in response: {list(current.keys())}")
            else:
                raise KeyError(f"Cannot navigate '{part}' in non-dict/list value")

        return str(current) if current is not None else ""

    async def ainvoke(self, messages: list[dict[str, Any]], **kwargs) -> Any:
        """
        Async invoke the custom API (compatible with LangChain interface).

        Args:
            messages: List of message dicts with 'role' and 'content' keys
            **kwargs: Additional arguments (ignored for custom API)

        Returns:
            Response object with 'content' attribute
        """
        # Extract the last user message as the prompt
        prompt = ""
        for msg in reversed(messages):
            if isinstance(msg, dict) and msg.get("role") == "user":
                prompt = msg.get("content", "")
                break
            elif hasattr(msg, "content"):
                prompt = msg.content
                break

        if not prompt:
            # Fallback: concatenate all messages
            prompt = "\n".join(
                msg.get("content", str(msg)) if isinstance(msg, dict) else str(msg)
                for msg in messages
            )

        headers = self._build_headers()
        body = self._build_request_body(prompt)

        logger.debug(
            "Custom API request",
            url=self.base_url,
            body_keys=list(body.keys()) if isinstance(body, dict) else "raw",
        )

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                self.base_url,
                headers=headers,
                json=body,
            )

            if response.status_code != 200:
                error_text = response.text[:500]
                logger.error(
                    "Custom API error",
                    status=response.status_code,
                    error=error_text,
                )
                raise RuntimeError(f"Custom API error {response.status_code}: {error_text}")

            response_json = response.json()
            content = self._extract_response(response_json)

            logger.debug(
                "Custom API response",
                response_keys=list(response_json.keys())
                if isinstance(response_json, dict)
                else "raw",
                content_length=len(content),
            )

        # Return an object with 'content' attribute for browser-use compatibility
        class Response:
            def __init__(self, text: str):
                self.content = text

        return Response(content)

    def invoke(self, messages: list[dict[str, Any]], **kwargs) -> Any:
        """Sync invoke - runs async version in event loop."""
        return asyncio.run(self.ainvoke(messages, **kwargs))


# =============================================================================
# CAPTCHA Detection Hook for browser-use Agent
# =============================================================================


async def create_captcha_detection_hook(
    crawler_agent: "AutonomousCrawlerAgent",
    on_captcha_detected: callable = None,
) -> callable:
    """
    Create a hook function for browser-use Agent that detects CAPTCHAs.

    This hook is called at the start of each step to check for CAPTCHAs
    and attempt to solve them before the agent takes action.

    Args:
        crawler_agent: The AutonomousCrawlerAgent instance
        on_captcha_detected: Optional callback when CAPTCHA is detected

    Returns:
        Async hook function compatible with browser-use Agent
    """

    async def on_step_start_hook(agent: "BrowserUseAgent") -> None:
        """Hook called at the start of each browser-use step."""
        try:
            # Get the current page from browser session
            browser_session = agent.browser_session
            if not browser_session:
                return

            # Access the current page
            page = None
            try:
                # browser-use stores pages internally
                if hasattr(browser_session, "_context") and browser_session._context:
                    pages = browser_session._context.pages
                    if pages:
                        page = pages[-1]  # Get the most recent page
            except Exception:
                pass

            if not page:
                return

            # Check for CAPTCHA indicators
            captcha_detected = await _quick_captcha_check(page)

            if captcha_detected:
                logger.info("CAPTCHA detected in browser-use step, attempting to solve...")

                if on_captcha_detected:
                    await on_captcha_detected(captcha_detected)

                # Try to solve the CAPTCHA
                solved = await crawler_agent._detect_and_handle_captcha(page)

                if solved:
                    logger.info("CAPTCHA solved successfully, continuing agent step")
                else:
                    logger.warning("CAPTCHA could not be solved, agent may fail on this step")

                    # Simulate human behavior to appear more legitimate
                    if crawler_agent._stealth_config.enable_human_simulation:
                        await crawler_agent._simulate_human_behavior(page)

        except Exception as e:
            logger.debug("Error in CAPTCHA detection hook", error=str(e))

    return on_step_start_hook


async def create_stealth_hook(crawler_agent: "AutonomousCrawlerAgent") -> callable:
    """
    Create a hook function that applies stealth patches after navigation.

    This hook is called at the end of each step to re-apply stealth patches
    if the page has navigated to a new URL.
    """
    _last_url = {"value": None}

    async def on_step_end_hook(agent: "BrowserUseAgent") -> None:
        """Hook called at the end of each browser-use step."""
        try:
            browser_session = agent.browser_session
            if not browser_session:
                return

            page = None
            try:
                if hasattr(browser_session, "_context") and browser_session._context:
                    pages = browser_session._context.pages
                    if pages:
                        page = pages[-1]
            except Exception:
                pass

            if not page:
                return

            current_url = page.url

            # Only apply patches if we navigated to a new URL
            if current_url != _last_url["value"]:
                _last_url["value"] = current_url

                # Re-apply stealth patches to the new page
                await AdvancedStealthPatcher.apply_to_page(page)

                # Brief human-like delay after navigation
                if crawler_agent._stealth_config.enable_human_simulation:
                    await asyncio.sleep(0.5)

        except Exception as e:
            logger.debug("Error in stealth hook", error=str(e))

    return on_step_end_hook


async def _quick_captcha_check(page) -> str | None:
    """
    Quick check for common CAPTCHA indicators on a page.

    Returns the CAPTCHA type if detected, None otherwise.
    """
    captcha_indicators = [
        # Cloudflare
        (
            "cloudflare",
            [
                "#challenge-running",
                ".cf-browser-verification",
                "iframe[src*='turnstile']",
                "#cf-turnstile",
                "div[class*='challenge']",
            ],
        ),
        # reCAPTCHA
        (
            "recaptcha",
            [
                "iframe[src*='recaptcha']",
                ".g-recaptcha",
                "#recaptcha",
                "div[class*='recaptcha']",
            ],
        ),
        # hCaptcha
        (
            "hcaptcha",
            [
                "iframe[src*='hcaptcha']",
                ".h-captcha",
                "div[class*='hcaptcha']",
            ],
        ),
        # Generic bot detection
        (
            "bot_detection",
            [
                "text=checking your browser",
                "text=please verify you are human",
                "text=access denied",
                "text=blocked",
            ],
        ),
    ]

    for captcha_type, selectors in captcha_indicators:
        for selector in selectors:
            try:
                if selector.startswith("text="):
                    # Text-based detection
                    text = selector[5:].lower()
                    page_text = await page.inner_text("body")
                    if text in page_text.lower():
                        return captcha_type
                else:
                    # Selector-based detection
                    element = await page.query_selector(selector)
                    if element:
                        is_visible = await element.is_visible()
                        if is_visible:
                            return captcha_type
            except Exception:
                continue

    return None


class ExtractedArticle(BaseModel):
    """Extracted article content from a page."""

    url: str
    title: str
    content: str
    published_at: str | None = None
    author: str | None = None
    summary: str | None = None
    extraction_time: datetime = field(default_factory=datetime.now)


@dataclass
class CrawlSession:
    """Tracks the state of a crawling session."""

    job_id: int
    source_id: int
    seed_url: str
    max_depth: int
    max_pages: int
    budget_seconds: int
    policy: CrawlPolicy
    focus_keywords: list[str]
    excluded_domains: list[str]

    # Runtime state
    visited_urls: set[str] = field(default_factory=set)
    extracted_articles: list[CrawlResultMessage] = field(default_factory=list)
    start_time: datetime | None = None
    end_time: datetime | None = None
    error: str | None = None

    # AutoCrawl metadata (passed from BrowserTaskMessage.metadata)
    metadata: dict[str, Any] | None = None

    def is_budget_exceeded(self) -> bool:
        """Check if time budget has been exceeded."""
        if not self.start_time:
            return False
        elapsed = (datetime.now() - self.start_time).total_seconds()
        return elapsed >= self.budget_seconds

    def is_page_limit_reached(self) -> bool:
        """Check if page limit has been reached."""
        return len(self.visited_urls) >= self.max_pages

    def can_continue(self) -> bool:
        """Check if crawling can continue."""
        return not self.is_budget_exceeded() and not self.is_page_limit_reached()


class AutonomousCrawlerAgent:
    """
    AI-driven autonomous web crawler using browser-use.

    Consumes BrowserTaskMessage from Kafka and produces CrawlResultMessage
    for each extracted article.

    Supports two browser backends:
    - Playwright (Chrome/Chromium) with stealth patches and NopeCHA extension
    - Camoufox (Firefox-based) anti-detect browser with built-in fingerprint spoofing

    Integrates with IP Rotation service to:
    - Automatically rotate proxies for each crawl session
    - Report CAPTCHA encounters to help weighted proxy selection
    - Retry with different proxies when CAPTCHA solving fails
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._browser_session: BrowserSession | None = None
        self._camoufox_browser: Any = None  # Camoufox browser instance
        self._llm = self._create_llm()
        self._search_orchestrator: ParallelSearchOrchestrator | None = None
        self._rrf_search_orchestrator: RRFSearchOrchestrator | None = None
        self._query_analyzer: QueryAnalyzer | None = None
        self._captcha_solver: CaptchaSolverOrchestrator | None = None
        self._stealth_config = EnhancedStealthConfig(
            use_nopecha=getattr(settings.stealth, "use_nopecha", True),
            nopecha_api_key=getattr(settings.stealth, "nopecha_api_key", ""),
            use_camoufox=getattr(settings.browser, "backend", "playwright") == "camoufox",
            enable_human_simulation=getattr(settings.stealth, "simulate_human_behavior", True),
        )

        # Determine browser backend
        self._use_camoufox = getattr(settings.browser, "backend", "playwright") == "camoufox"
        if self._use_camoufox and not is_camoufox_available():
            logger.warning("Camoufox requested but not available, falling back to Playwright")
            self._use_camoufox = False

        # Proxy rotation integration
        self._proxy_client: Optional[Any] = None
        self._current_proxy: Optional[Any] = None  # Current ProxyInfo
        self._use_proxy_rotation = getattr(settings, "use_proxy_rotation", True)
        self._proxy_rotation_url = getattr(
            settings,
            "proxy_rotation_url",
            os.environ.get("PROXY_ROTATION_URL", "http://ip-rotation:8050"),
        )

        # Initialize proxy client if available
        if PROXY_CLIENT_AVAILABLE and self._use_proxy_rotation:
            self._proxy_client = ProxyRotationClient(
                base_url=self._proxy_rotation_url,
                timeout=5.0,
                enabled=True,
            )
            logger.info("Proxy rotation enabled", url=self._proxy_rotation_url)

    def _create_llm(self) -> ChatOpenAI | ChatAnthropic:
        """Create the LLM instance based on settings.

        Uses browser-use's LLM classes which implement the BaseChatModel protocol
        with the required .provider property.

        Supported providers:
        - openai: OpenAI API
        - anthropic: Anthropic Claude API
        - openrouter: OpenRouter (multiple models via single API)
        - ollama: Local Ollama server
        - custom: Custom OpenAI-compatible REST API
        """
        llm_settings = self.settings.llm
        provider = llm_settings.provider.lower()

        if provider == "anthropic":
            logger.info("Using Anthropic provider", model=llm_settings.anthropic_model)
            return ChatAnthropic(
                model=llm_settings.anthropic_model,
                api_key=llm_settings.anthropic_api_key,
                temperature=llm_settings.temperature,
                max_tokens=llm_settings.max_tokens,
            )

        elif provider == "openrouter":
            # OpenRouter uses OpenAI-compatible API
            logger.info("Using OpenRouter provider", model=llm_settings.openrouter_model)
            return ChatOpenAI(
                model=llm_settings.openrouter_model,
                api_key=llm_settings.openrouter_api_key,
                base_url=llm_settings.openrouter_base_url,
                temperature=llm_settings.temperature,
                max_completion_tokens=llm_settings.max_tokens,
                default_headers={
                    "HTTP-Referer": "https://newsinsight.app",
                    "X-Title": "NewsInsight Crawler",
                },
            )

        elif provider == "ollama":
            # Ollama uses OpenAI-compatible API
            logger.info(
                "Using Ollama provider",
                model=llm_settings.ollama_model,
                base_url=llm_settings.ollama_base_url,
            )
            return ChatOpenAI(
                model=llm_settings.ollama_model,
                api_key="ollama",  # Ollama doesn't require API key but field is required
                base_url=f"{llm_settings.ollama_base_url}/v1",
                temperature=llm_settings.temperature,
                max_completion_tokens=llm_settings.max_tokens,
            )

        elif provider == "custom":
            # Custom REST API endpoint (supports non-OpenAI-compatible APIs)
            if not llm_settings.custom_base_url:
                raise ValueError("LLM_CUSTOM_BASE_URL is required when using custom provider")

            # Check if custom request format is provided (non-OpenAI-compatible API)
            if llm_settings.custom_request_format:
                logger.info(
                    "Using custom REST API provider with custom format",
                    base_url=llm_settings.custom_base_url,
                    response_path=llm_settings.custom_response_path,
                )
                return CustomRESTAPIClient(
                    base_url=llm_settings.custom_base_url,
                    api_key=llm_settings.custom_api_key,
                    model=llm_settings.custom_model,
                    request_format=llm_settings.custom_request_format,
                    response_path=llm_settings.custom_response_path,
                    custom_headers=llm_settings.custom_headers,
                    temperature=llm_settings.temperature,
                )
            else:
                # Fallback to OpenAI-compatible format
                logger.info(
                    "Using custom provider (OpenAI-compatible)",
                    model=llm_settings.custom_model,
                    base_url=llm_settings.custom_base_url,
                )
                return ChatOpenAI(
                    model=llm_settings.custom_model,
                    api_key=llm_settings.custom_api_key or "not-required",
                    base_url=llm_settings.custom_base_url,
                    temperature=llm_settings.temperature,
                    max_completion_tokens=llm_settings.max_tokens,
                )

        else:
            # Default: OpenAI
            base_url = llm_settings.openai_base_url or None
            logger.info("Using OpenAI provider", model=llm_settings.openai_model, base_url=base_url)
            kwargs = {
                "model": llm_settings.openai_model,
                "api_key": llm_settings.openai_api_key,
                "temperature": llm_settings.temperature,
                "max_completion_tokens": llm_settings.max_tokens,
            }
            if base_url:
                kwargs["base_url"] = base_url
            return ChatOpenAI(**kwargs)

    def _get_search_orchestrator(self) -> ParallelSearchOrchestrator:
        """Get or create the search orchestrator with configured providers."""
        if self._search_orchestrator is None:
            providers = []
            search_settings = self.settings.search

            # Add Brave Search if API key is configured
            if search_settings.brave_api_key:
                providers.append(BraveSearchProvider(search_settings.brave_api_key))
                logger.info("Brave Search provider enabled")

            # Add Tavily if API key is configured
            if search_settings.tavily_api_key:
                providers.append(TavilySearchProvider(search_settings.tavily_api_key))
                logger.info("Tavily Search provider enabled")

            # Add Perplexity if API key is configured
            if search_settings.perplexity_api_key:
                providers.append(PerplexitySearchProvider(search_settings.perplexity_api_key))
                logger.info("Perplexity Search provider enabled")

            if not providers:
                logger.warning("No search providers configured - API search disabled")

            self._search_orchestrator = ParallelSearchOrchestrator(
                providers=providers,
                timeout=search_settings.timeout,
                deduplicate=True,
            )

        return self._search_orchestrator

    def _get_rrf_search_orchestrator(self) -> RRFSearchOrchestrator:
        """Get or create the RRF search orchestrator with query analysis."""
        if self._rrf_search_orchestrator is None:
            providers = []
            search_settings = self.settings.search

            # Add Brave Search if API key is configured
            if search_settings.brave_api_key:
                providers.append(BraveSearchProvider(search_settings.brave_api_key))

            # Add Tavily if API key is configured
            if search_settings.tavily_api_key:
                providers.append(TavilySearchProvider(search_settings.tavily_api_key))

            # Add Perplexity if API key is configured
            if search_settings.perplexity_api_key:
                providers.append(PerplexitySearchProvider(search_settings.perplexity_api_key))

            if not providers:
                logger.warning("No search providers configured - RRF search disabled")

            # Create query analyzer with the LLM
            self._query_analyzer = QueryAnalyzer(
                llm=self._llm,
                enable_expansion=True,
                max_expanded_queries=5,
                cache_results=True,
            )

            # Get RRF settings
            rrf_k = getattr(search_settings, "rrf_k", 60)
            enable_semantic = getattr(search_settings, "enable_semantic_rrf", True)

            self._rrf_search_orchestrator = create_rrf_orchestrator(
                providers=providers,
                llm=self._llm,
                timeout=search_settings.timeout,
                rrf_k=rrf_k,
                enable_semantic=enable_semantic,
            )

            logger.info(
                "RRF Search orchestrator initialized",
                providers=len(providers),
                rrf_k=rrf_k,
                semantic_enabled=enable_semantic,
            )

        return self._rrf_search_orchestrator

    def _get_captcha_solver(self) -> CaptchaSolverOrchestrator:
        """Get or create the CAPTCHA solver orchestrator."""
        if self._captcha_solver is None:
            self._captcha_solver = CaptchaSolverOrchestrator()
        return self._captcha_solver

    async def _get_browser_session(self, force_new: bool = False) -> BrowserSession:
        """Get or create the browser session with enhanced stealth configuration.

        Args:
            force_new: If True, always create a new browser session (recommended for task isolation)
        """
        # Use Camoufox if configured
        if self._use_camoufox:
            return await self._get_camoufox_session()

        # Close existing session if force_new or if session is not healthy
        if force_new and self._browser_session is not None:
            try:
                await self._browser_session.stop()
            except Exception as e:
                logger.debug("Error closing existing browser session", error=str(e))
            self._browser_session = None

        # Use Playwright with stealth
        if self._browser_session is None:
            stealth_settings = self.settings.stealth

            # Setup extensions if NopeCHA is enabled
            if self._stealth_config.use_nopecha:
                await self._stealth_config.setup_extensions()
                logger.info("NopeCHA extension configured for CAPTCHA bypass")

            # Build browser args for stealth mode
            extra_args = []
            if stealth_settings.enabled:
                if self._stealth_config.extension_paths:
                    # Use enhanced args with extension support
                    extra_args = self._stealth_config.get_browser_args(
                        include_docker=getattr(self.settings.browser, "is_docker_env", False)
                    )
                else:
                    extra_args = get_undetected_browser_args()
                logger.info(
                    "Stealth mode enabled for browser session",
                    extensions_loaded=len(self._stealth_config.extension_paths),
                )

            # Get proxy from rotation service if available
            proxy_settings = None
            if self._proxy_client:
                try:
                    self._current_proxy = await self._proxy_client.get_next_proxy()
                    if self._current_proxy:
                        proxy_settings = ProxySettings(
                            server=self._current_proxy.address,
                            username=self._current_proxy.username,
                            password=self._current_proxy.password,
                        )
                        logger.info(
                            "Proxy assigned for browser session",
                            proxy_id=self._current_proxy.id,
                            proxy_address=self._current_proxy.address,
                        )
                except Exception as e:
                    logger.warning("Failed to get proxy from rotation service", error=str(e))

            # Detect Playwright browser path in Docker environment
            executable_path = None
            if getattr(self.settings.browser, "is_docker_env", False):
                # Look for installed Chromium in Playwright's cache
                playwright_path = os.environ.get(
                    "PLAYWRIGHT_BROWSERS_PATH", os.path.expanduser("~/.cache/ms-playwright")
                )
                # Find chromium executable
                import glob

                chromium_patterns = [
                    f"{playwright_path}/chromium-*/chrome-linux64/chrome",
                    f"{playwright_path}/chromium-*/chrome-linux/chrome",
                    f"{playwright_path}/chromium_headless_shell-*/chrome-linux64/headless_shell",
                    f"{playwright_path}/chromium_headless_shell-*/chrome-linux/headless_shell",
                ]
                for pattern in chromium_patterns:
                    matches = glob.glob(pattern)
                    if matches:
                        executable_path = sorted(matches)[-1]  # Use latest version
                        logger.debug("Found Playwright browser", executable_path=executable_path)
                        break
                if not executable_path:
                    logger.warning("No Playwright browser found, browser-use will try to install")

            profile = BrowserProfile(
                headless=self.settings.browser.headless,
                disable_security=True,  # Required for some sites
                extra_chromium_args=extra_args,
                proxy=proxy_settings,  # Apply proxy from rotation service
                executable_path=executable_path,  # Use pre-installed Playwright browser
            )
            self._browser_session = BrowserSession(browser_profile=profile)
        return self._browser_session

    async def _get_camoufox_session(self) -> Any:
        """Get or create Camoufox browser session."""
        if self._camoufox_browser is None:
            camoufox_settings = getattr(self.settings, "camoufox", None)

            # Build Camoufox config
            if camoufox_settings:
                config = CamoufoxConfig(
                    headless=self.settings.browser.headless,
                    humanize=camoufox_settings.humanize,
                    humanize_level=camoufox_settings.humanize_level,
                    locale=camoufox_settings.locale,
                    timezone=camoufox_settings.timezone,
                    geoip=camoufox_settings.geoip,
                    block_webrtc=camoufox_settings.block_webrtc,
                    block_images=camoufox_settings.block_images,
                    os=camoufox_settings.os_type if camoufox_settings.os_type != "random" else None,
                )
            else:
                # Use recommended config for Cloudflare bypass
                config = get_recommended_camoufox_config(
                    purpose="cloudflare",
                    headless=self.settings.browser.headless,
                )

            self._camoufox_browser = await create_camoufox_browser(config)

            if self._camoufox_browser:
                logger.info(
                    "Camoufox browser created",
                    headless=config.headless,
                    humanize=config.humanize,
                    humanize_level=config.humanize_level,
                )
            else:
                logger.error("Failed to create Camoufox browser, falling back to Playwright")
                self._use_camoufox = False
                return await self._get_browser_session()

        return self._camoufox_browser

    async def _get_camoufox_page(self) -> Any:
        """Get a new page from Camoufox browser."""
        browser = await self._get_camoufox_session()
        if browser:
            try:
                page = await browser.new_page()
                logger.debug("Created new Camoufox page")
                return page
            except Exception as e:
                logger.error("Failed to create Camoufox page", error=str(e))
        return None

    async def _apply_page_stealth(self, page) -> None:
        """Apply advanced stealth patches to a page."""
        # Apply playwright_stealth or manual patches
        await apply_stealth_to_playwright_async(page, self._stealth_config)

        # Apply advanced stealth patches from undetected module
        await AdvancedStealthPatcher.apply_to_page(page)

        logger.debug("Applied advanced stealth patches to page")

    async def search_before_crawl(
        self,
        query: str,
        max_results: int = 20,
        use_rrf: bool = True,
    ) -> list[str]:
        """
        Perform API-based search before browser crawling.

        Returns list of URLs to visit based on search results.
        Useful for bypassing search engine CAPTCHAs.

        Args:
            query: Search query
            max_results: Maximum number of URLs to return
            use_rrf: Use RRF-based multi-strategy search for better accuracy
        """
        if use_rrf:
            return await self._search_with_rrf(query, max_results)

        # Fallback to simple parallel search
        orchestrator = self._get_search_orchestrator()

        if not orchestrator.providers:
            logger.warning("No search providers available")
            return []

        try:
            result = await orchestrator.search_news(
                query=query,
                max_results_per_provider=self.settings.search.max_results_per_provider,
            )

            urls = [r.url for r in result.results[:max_results]]

            logger.info(
                "Search completed",
                query=query,
                results_count=len(urls),
                providers_used=result.providers_used,
            )

            return urls

        except Exception as e:
            logger.error("Search failed", query=query, error=str(e))
            return []

    async def _search_with_rrf(
        self,
        query: str,
        max_results: int = 20,
    ) -> list[str]:
        """
        Perform RRF-based multi-strategy search.

        This method:
        1. Analyzes the query to understand intent and extract keywords
        2. Expands the query into multiple semantically related queries
        3. Executes parallel searches across all providers for each query variant
        4. Merges results using Reciprocal Rank Fusion algorithm
        5. Returns URLs ranked by combined relevance
        """
        orchestrator = self._get_rrf_search_orchestrator()

        if not orchestrator.providers:
            logger.warning("No search providers available for RRF search")
            return []

        try:
            result = await orchestrator.search_news_with_rrf(
                query=query,
                max_results_per_strategy=self.settings.search.max_results_per_provider,
            )

            urls = [r.url for r in result.results[:max_results]]

            logger.info(
                "RRF search completed",
                query=query,
                results_count=len(urls),
                strategies_used=result.strategies_used,
                providers_used=result.providers_used,
                query_analysis=result.query_analysis,
            )

            return urls

        except Exception as e:
            logger.error(
                "RRF search failed, falling back to simple search", query=query, error=str(e)
            )
            # Fallback to simple search
            return await self.search_before_crawl(query, max_results, use_rrf=False)

    async def close(self) -> None:
        """Close the browser and cleanup resources."""
        if self._browser_session:
            await self._browser_session.stop()
            self._browser_session = None

        if self._camoufox_browser:
            try:
                await self._camoufox_browser.close()
            except Exception as e:
                logger.debug("Error closing Camoufox browser", error=str(e))
            self._camoufox_browser = None

        if self._search_orchestrator:
            await self._search_orchestrator.close_all()
            self._search_orchestrator = None

        # Close proxy client
        if self._proxy_client:
            try:
                await self._proxy_client.close()
            except Exception as e:
                logger.debug("Error closing proxy client", error=str(e))
            self._proxy_client = None
            self._current_proxy = None

    async def crawl_with_camoufox(
        self,
        url: str,
        extract_content: bool = True,
        wait_for_cloudflare: bool = True,
    ) -> dict[str, Any]:
        """
        Crawl a URL using Camoufox browser for maximum anti-detection.

        Args:
            url: URL to crawl
            extract_content: Whether to extract page content
            wait_for_cloudflare: Whether to wait for Cloudflare challenge

        Returns:
            Dictionary with page content and metadata
        """
        page = await self._get_camoufox_page()
        if not page:
            return {"error": "Failed to create Camoufox page"}

        try:
            # Navigate to URL
            await page.goto(url, wait_until="domcontentloaded")

            # Wait for Cloudflare challenge if needed
            if wait_for_cloudflare:
                passed = await CamoufoxHelper.wait_for_cloudflare(page, timeout=30)
                if not passed:
                    logger.warning("Cloudflare challenge may not have completed", url=url)

            # Simulate human behavior
            if self._stealth_config.enable_human_simulation:
                await asyncio.sleep(1)  # Brief pause

            # Extract content
            if extract_content:
                content = await CamoufoxHelper.extract_page_content(page)
                content["success"] = True
                return content

            return {
                "success": True,
                "url": url,
                "title": await page.title(),
            }

        except Exception as e:
            logger.error("Camoufox crawl failed", url=url, error=str(e))
            return {"error": str(e), "success": False}
        finally:
            try:
                await page.close()
            except Exception:
                pass

    async def _detect_and_handle_captcha(self, page) -> bool:
        """
        Detect and attempt to handle CAPTCHAs on a page.

        Args:
            page: Playwright page object

        Returns:
            True if CAPTCHA was detected and handled (or not detected),
            False if CAPTCHA was detected but could not be handled
        """
        try:
            # Check for common CAPTCHA indicators
            captcha_selectors = {
                CaptchaType.RECAPTCHA_V2: [
                    "iframe[src*='recaptcha']",
                    ".g-recaptcha",
                    "#recaptcha",
                ],
                CaptchaType.HCAPTCHA: [
                    "iframe[src*='hcaptcha']",
                    ".h-captcha",
                ],
                CaptchaType.CLOUDFLARE: [
                    "#challenge-running",
                    ".cf-browser-verification",
                    "iframe[src*='turnstile']",
                    "#cf-turnstile",
                ],
            }

            detected_type = None
            for captcha_type, selectors in captcha_selectors.items():
                for selector in selectors:
                    try:
                        element = await page.query_selector(selector)
                        if element:
                            is_visible = await element.is_visible()
                            if is_visible:
                                detected_type = captcha_type
                                logger.info(
                                    "CAPTCHA detected", type=captcha_type.value, selector=selector
                                )
                                break
                    except Exception:
                        continue
                if detected_type:
                    break

            if not detected_type:
                return True  # No CAPTCHA detected

            # Report CAPTCHA to IP rotation service for weighted proxy selection
            if self._proxy_client and self._current_proxy:
                try:
                    await self._proxy_client.record_captcha(
                        proxy_id=self._current_proxy.id,
                        captcha_type=detected_type.value,
                    )
                    logger.info(
                        "CAPTCHA reported to IP rotation service",
                        proxy_id=self._current_proxy.id,
                        captcha_type=detected_type.value,
                    )
                except Exception as e:
                    logger.debug("Failed to report CAPTCHA to IP rotation service", error=str(e))

            # Try to solve the CAPTCHA
            solver = self._get_captcha_solver()
            result = await solver.solve(detected_type, page=page)

            if result.success:
                logger.info(
                    "CAPTCHA solved successfully",
                    type=detected_type.value,
                    solver=result.solver_used,
                    time_ms=result.time_ms,
                )
                # Wait for page to update after CAPTCHA solve
                await asyncio.sleep(2)
                return True
            else:
                logger.warning("CAPTCHA solve failed", type=detected_type.value, error=result.error)
                return False

        except Exception as e:
            logger.error("Error in CAPTCHA detection/handling", error=str(e))
            return False

    async def _simulate_human_behavior(self, page) -> None:
        """Simulate human-like behavior on a page to avoid detection."""
        try:
            # Random mouse movements
            await HumanBehaviorSimulator.random_mouse_movements(page, count=2)

            # Random scroll
            await HumanBehaviorSimulator.human_scroll(page, "down", 200)
            await asyncio.sleep(HumanBehaviorSimulator.random_delay(500, 1000))

        except Exception as e:
            logger.debug("Human behavior simulation failed", error=str(e))

    async def smart_search(
        self,
        query: str,
        max_results: int = 20,
        use_browser_fallback: bool = True,
        use_rrf: bool = True,
    ) -> list[dict[str, Any]]:
        """
        Smart search with API-first strategy and browser fallback.

        Tries API-based search first to avoid CAPTCHA, then falls back
        to browser-based search with Camoufox if APIs fail.

        Now uses RRF (Reciprocal Rank Fusion) for improved accuracy by:
        1. Analyzing query intent and extracting semantic meaning
        2. Expanding query into multiple search strategies
        3. Merging results from multiple providers and strategies

        Args:
            query: Search query
            max_results: Maximum number of results
            use_browser_fallback: Whether to try browser search if API fails
            use_rrf: Use RRF-based multi-strategy search

        Returns:
            List of search results with url, title, snippet
        """
        results = []

        # Step 1: Try API-based search (no CAPTCHA)
        if use_rrf:
            logger.info("Attempting RRF-based API search", query=query)
            try:
                orchestrator = self._get_rrf_search_orchestrator()
                if orchestrator.providers:
                    rrf_result = await orchestrator.search_news_with_rrf(
                        query=query,
                        max_results_per_strategy=self.settings.search.max_results_per_provider,
                    )

                    if rrf_result.results:
                        logger.info(
                            "RRF API search successful",
                            query=query,
                            results_count=len(rrf_result.results),
                            strategies=rrf_result.strategies_used,
                            query_analysis=rrf_result.query_analysis,
                        )
                        return [
                            {
                                "url": r.url,
                                "title": r.title,
                                "snippet": r.snippet,
                                "source": f"rrf_{r.source_provider}",
                            }
                            for r in rrf_result.results[:max_results]
                        ]
            except Exception as e:
                logger.warning("RRF search failed", error=str(e))

        # Fallback to simple API search
        logger.info("Attempting simple API-based search", query=query)
        api_urls = await self.search_before_crawl(query, max_results, use_rrf=False)

        if api_urls:
            logger.info("API search successful", query=query, results_count=len(api_urls))
            results = [{"url": url, "source": "api"} for url in api_urls]
            return results

        if not use_browser_fallback:
            logger.warning("API search failed and browser fallback disabled")
            return results

        # Step 2: Try browser search with Camoufox (best anti-detection)
        if is_camoufox_available():
            logger.info("Trying Camoufox browser search", query=query)
            camoufox_results = await self._browser_search_with_camoufox(query, max_results)
            if camoufox_results:
                return camoufox_results

        # Step 3: Try browser search with enhanced Playwright stealth
        logger.info("Trying Playwright stealth browser search", query=query)
        playwright_results = await self._browser_search_with_stealth(query, max_results)

        return playwright_results

    async def _browser_search_with_camoufox(
        self,
        query: str,
        max_results: int = 20,
    ) -> list[dict[str, Any]]:
        """
        Perform browser search using Camoufox anti-detect browser.

        Uses DuckDuckGo HTML version which is less likely to show CAPTCHA.
        """
        results = []

        try:
            page = await self._get_camoufox_page()
            if not page:
                return results

            # Use DuckDuckGo HTML version (lighter, less detection)
            search_url = f"https://html.duckduckgo.com/html/?q={query.replace(' ', '+')}"

            await page.goto(search_url, wait_until="domcontentloaded")

            # Wait for Cloudflare if present
            await CamoufoxHelper.wait_for_cloudflare(page, timeout=15)

            # Simulate human behavior
            await asyncio.sleep(1)

            # Extract search results
            result_elements = await page.query_selector_all(".result")

            for element in result_elements[:max_results]:
                try:
                    link = await element.query_selector(".result__a")
                    snippet_el = await element.query_selector(".result__snippet")

                    if link:
                        url = await link.get_attribute("href")
                        title = await link.inner_text()
                        snippet = ""
                        if snippet_el:
                            snippet = await snippet_el.inner_text()

                        if url and title:
                            results.append(
                                {
                                    "url": url,
                                    "title": title.strip(),
                                    "snippet": snippet.strip(),
                                    "source": "camoufox_duckduckgo",
                                }
                            )
                except Exception:
                    continue

            await page.close()

            if results:
                logger.info("Camoufox search successful", query=query, results_count=len(results))

        except Exception as e:
            logger.error("Camoufox search failed", query=query, error=str(e))

        return results

    async def _browser_search_with_stealth(
        self,
        query: str,
        max_results: int = 20,
    ) -> list[dict[str, Any]]:
        """
        Perform browser search using Playwright with stealth patches.

        Tries multiple search engines with different strategies.
        Prioritizes engines that are less likely to show CAPTCHAs.
        """
        results = []

        # Search engines to try (in order of CAPTCHA likelihood - least likely first)
        search_engines = [
            {
                "name": "duckduckgo_html",
                "url": f"https://html.duckduckgo.com/html/?q={query.replace(' ', '+')}",
                "result_selector": ".result",
                "link_selector": ".result__a",
                "snippet_selector": ".result__snippet",
                "wait_selector": ".result",
            },
            {
                "name": "startpage",
                "url": f"https://www.startpage.com/do/search?q={query.replace(' ', '+')}",
                "result_selector": ".w-gl__result",
                "link_selector": "a.w-gl__result-title",
                "snippet_selector": ".w-gl__description",
                "wait_selector": ".w-gl__result",
            },
            {
                "name": "ecosia",
                "url": f"https://www.ecosia.org/search?q={query.replace(' ', '+')}",
                "result_selector": "[data-test-id='mainline-result-web']",
                "link_selector": "a[data-test-id='result-link']",
                "snippet_selector": "[data-test-id='result-snippet']",
                "wait_selector": "[data-test-id='mainline-result-web']",
            },
            {
                "name": "mojeek",  # Privacy-focused, rarely uses CAPTCHA
                "url": f"https://www.mojeek.com/search?q={query.replace(' ', '+')}",
                "result_selector": ".results-standard li",
                "link_selector": "a.title",
                "snippet_selector": ".s",
                "wait_selector": ".results-standard",
            },
        ]

        browser_session = None
        context = None
        page = None

        try:
            browser_session = await self._get_browser_session()

            # Get the underlying playwright browser to create isolated context
            if hasattr(browser_session, "_browser") and browser_session._browser:
                browser = browser_session._browser

                # Create isolated context with stealth args
                context = await browser.new_context(
                    user_agent=self._stealth_config.get_random_user_agent()
                    if hasattr(self._stealth_config, "get_random_user_agent")
                    else None,
                    locale="en-US",
                    timezone_id="America/New_York",
                )
                page = await context.new_page()

                # Apply stealth patches
                await self._apply_page_stealth(page)
            else:
                logger.warning("Could not access underlying browser for stealth search")
                return results

            for engine in search_engines:
                try:
                    logger.info("Trying search engine", engine=engine["name"], query=query)

                    # Navigate to search engine
                    await page.goto(engine["url"], wait_until="domcontentloaded", timeout=15000)

                    # Wait for results to load
                    try:
                        await page.wait_for_selector(
                            engine["wait_selector"], timeout=10000, state="visible"
                        )
                    except Exception:
                        # Check if we hit a CAPTCHA
                        captcha_type = await _quick_captcha_check(page)
                        if captcha_type:
                            logger.warning(
                                "CAPTCHA detected on search engine",
                                engine=engine["name"],
                                captcha_type=captcha_type,
                            )
                            # Try to solve it
                            solved = await self._detect_and_handle_captcha(page)
                            if not solved:
                                continue  # Try next engine
                            # Wait again for results after solving
                            try:
                                await page.wait_for_selector(engine["wait_selector"], timeout=5000)
                            except Exception:
                                continue
                        else:
                            logger.debug(
                                "Results not found, trying next engine", engine=engine["name"]
                            )
                            continue

                    # Simulate human behavior
                    if self._stealth_config.enable_human_simulation:
                        await HumanBehaviorSimulator.random_mouse_movements(page, count=1)
                        await asyncio.sleep(0.3)

                    # Extract search results
                    result_elements = await page.query_selector_all(engine["result_selector"])

                    for element in result_elements[:max_results]:
                        try:
                            link = await element.query_selector(engine["link_selector"])
                            snippet_el = await element.query_selector(engine["snippet_selector"])

                            if link:
                                url = await link.get_attribute("href")
                                title = await link.inner_text()
                                snippet = ""
                                if snippet_el:
                                    snippet = await snippet_el.inner_text()

                                # Clean up URL (some engines use redirect URLs)
                                if url and title:
                                    # Skip ad/sponsored results
                                    if "ad" in url.lower() or "sponsor" in title.lower():
                                        continue

                                    results.append(
                                        {
                                            "url": url,
                                            "title": title.strip(),
                                            "snippet": snippet.strip() if snippet else "",
                                            "source": f"stealth_{engine['name']}",
                                        }
                                    )
                        except Exception as e:
                            logger.debug("Failed to extract result", error=str(e))
                            continue

                    if results:
                        logger.info(
                            "Stealth search successful",
                            engine=engine["name"],
                            query=query,
                            results_count=len(results),
                        )
                        break  # Got results, stop trying other engines

                except Exception as e:
                    logger.debug("Search engine failed", engine=engine["name"], error=str(e))
                    continue

        except Exception as e:
            logger.error("Stealth browser search failed", query=query, error=str(e))
        finally:
            # Clean up
            if page:
                try:
                    await page.close()
                except Exception:
                    pass
            if context:
                try:
                    await context.close()
                except Exception:
                    pass

        return results

    async def handle_captcha_and_retry(
        self,
        page,
        action_func,
        max_retries: int = 3,
        switch_backend_on_failure: bool = True,
        rotate_proxy_on_failure: bool = True,
    ) -> Any:
        """
        Execute an action with CAPTCHA detection and retry logic.

        If CAPTCHA is detected and cannot be solved, optionally switches
        to a different browser backend or rotates to a new proxy and retries.

        Args:
            page: Current page object
            action_func: Async function to execute
            max_retries: Maximum retry attempts
            switch_backend_on_failure: Try different browser if CAPTCHA persists
            rotate_proxy_on_failure: Get a new proxy from rotation service on failure

        Returns:
            Result of action_func or None if all retries fail
        """
        for attempt in range(max_retries):
            try:
                # Check for CAPTCHA before action
                captcha_handled = await self._detect_and_handle_captcha(page)

                if not captcha_handled:
                    logger.warning(
                        "CAPTCHA detected but not solved",
                        attempt=attempt + 1,
                        max_retries=max_retries,
                    )

                    # Try rotating to a new proxy first
                    if rotate_proxy_on_failure and self._proxy_client:
                        try:
                            new_proxy = await self._proxy_client.get_next_proxy()
                            if new_proxy and (
                                not self._current_proxy or new_proxy.id != self._current_proxy.id
                            ):
                                self._current_proxy = new_proxy
                                logger.info(
                                    "Rotating to new proxy after CAPTCHA failure",
                                    proxy_id=new_proxy.id,
                                    proxy_address=new_proxy.address,
                                    attempt=attempt + 1,
                                )
                                # Recreate browser session with new proxy
                                if self._browser_session:
                                    await self._browser_session.stop()
                                    self._browser_session = None
                                # Get new session with new proxy
                                browser_session = await self._get_browser_session()
                                if (
                                    hasattr(browser_session, "_context")
                                    and browser_session._context
                                ):
                                    pages = browser_session._context.pages
                                    if pages:
                                        page = pages[-1]
                                        continue
                        except Exception as e:
                            logger.debug("Failed to rotate proxy", error=str(e))

                    # If Camoufox available and we're not already using it, switch
                    if (
                        switch_backend_on_failure
                        and not self._use_camoufox
                        and is_camoufox_available()
                    ):
                        logger.info("Switching to Camoufox browser for better CAPTCHA bypass")
                        self._use_camoufox = True

                        # Get new page from Camoufox
                        new_page = await self._get_camoufox_page()
                        if new_page:
                            page = new_page
                            continue

                    await asyncio.sleep(2**attempt)  # Exponential backoff
                    continue

                # Execute the action
                result = await action_func(page)

                # Check for CAPTCHA after action (might have triggered one)
                await self._detect_and_handle_captcha(page)

                return result

            except Exception as e:
                logger.error("Action failed", attempt=attempt + 1, error=str(e))
                await asyncio.sleep(2**attempt)

        logger.error("All retry attempts failed")
        return None

    async def execute_task(self, task: BrowserTaskMessage) -> list[CrawlResultMessage]:
        """
        Execute a browser crawling task.

        Args:
            task: The browser task message from Kafka

        Returns:
            List of extracted crawl results
        """
        # Parse policy
        try:
            policy = CrawlPolicy(task.policy.lower()) if task.policy else CrawlPolicy.NEWS_ONLY
        except ValueError:
            policy = CrawlPolicy.NEWS_ONLY

        # Create session with metadata from task (for AutoCrawl callback)
        session = CrawlSession(
            job_id=task.job_id,
            source_id=task.source_id,
            seed_url=task.seed_url,
            max_depth=task.max_depth or 2,
            max_pages=task.max_pages or 10,
            budget_seconds=min(
                task.budget_seconds or self.settings.browser.default_timeout_seconds,
                self.settings.browser.max_timeout_seconds,
            ),
            policy=policy,
            focus_keywords=task.get_focus_keywords_list(),
            excluded_domains=task.get_excluded_domains_list(),
            metadata=task.metadata,  # Pass metadata for AutoCrawl callback
        )

        # Track proxy used for this task
        task_proxy_id = None

        logger.info(
            "Starting crawl session",
            job_id=session.job_id,
            source_id=session.source_id,
            seed_url=session.seed_url,
            policy=policy.value,
            max_pages=session.max_pages,
            budget_seconds=session.budget_seconds,
        )

        session.start_time = datetime.now()

        try:
            # Generate the system prompt based on policy
            system_prompt = get_policy_prompt(
                policy=policy,
                focus_keywords=session.focus_keywords,
                custom_prompt=task.custom_prompt,
                excluded_domains=session.excluded_domains,
            )

            # Create the task prompt
            task_prompt = self._build_task_prompt(session)

            # Get browser session and create agent (this will also get proxy)
            # Use force_new=True to ensure a fresh browser for each task (avoids CDP issues)
            browser_session = await self._get_browser_session(force_new=True)

            # Track the proxy being used for this task
            if self._current_proxy:
                task_proxy_id = self._current_proxy.id
                logger.info(
                    "Task using proxy",
                    job_id=session.job_id,
                    proxy_id=task_proxy_id,
                )

            # Create CAPTCHA detection and stealth hooks for the agent
            captcha_hook = await create_captcha_detection_hook(
                crawler_agent=self,
                on_captcha_detected=lambda ct: logger.info(
                    "CAPTCHA detected during crawl",
                    captcha_type=ct,
                    job_id=session.job_id,
                ),
            )
            stealth_hook = await create_stealth_hook(self)

            agent = Agent(
                task=task_prompt,
                llm=self._llm,
                browser_session=browser_session,
                max_actions_per_step=5,
                extend_system_message=system_prompt,  # Add crawl policy to system prompt
            )

            # Run the agent with timeout and CAPTCHA/stealth hooks
            try:
                result = await asyncio.wait_for(
                    agent.run(
                        max_steps=session.max_pages * 3,  # Allow multiple steps per page
                        on_step_start=captcha_hook,  # CAPTCHA detection before each step
                        on_step_end=stealth_hook,  # Re-apply stealth after navigation
                    ),
                    timeout=session.budget_seconds,
                )

                # Parse the agent's output to extract articles
                session.extracted_articles = self._parse_agent_output(
                    result, session.job_id, session.source_id
                )

            except asyncio.TimeoutError:
                logger.warning(
                    "Crawl session timed out",
                    job_id=session.job_id,
                    elapsed_seconds=session.budget_seconds,
                )

        except Exception as e:
            session.error = str(e)
            logger.error(
                "Crawl session failed",
                job_id=session.job_id,
                error=str(e),
                exc_info=True,
            )

        finally:
            session.end_time = datetime.now()
            elapsed = (session.end_time - session.start_time).total_seconds()

            # Clean up browser session to prevent CDP issues on next task
            # Use kill() instead of stop() for more aggressive cleanup
            if self._browser_session:
                try:
                    await self._browser_session.kill()
                    logger.debug("Browser session killed successfully")
                except Exception as e:
                    logger.debug("Error killing browser session", error=str(e))
                self._browser_session = None

            # Small delay to ensure browser process fully terminates before next task
            await asyncio.sleep(0.5)

            # Record proxy usage result to IP rotation service
            if self._proxy_client and task_proxy_id:
                try:
                    if session.error:
                        await self._proxy_client.record_failure(
                            proxy_id=task_proxy_id,
                            reason=session.error[:200],  # Truncate error message
                        )
                    else:
                        await self._proxy_client.record_success(
                            proxy_id=task_proxy_id,
                            latency_ms=int(elapsed * 1000),
                        )
                    logger.debug(
                        "Proxy usage recorded",
                        proxy_id=task_proxy_id,
                        success=session.error is None,
                    )
                except Exception as e:
                    logger.debug("Failed to record proxy usage", error=str(e))

            # Send callback if configured
            if task.callback_url:
                await self._send_callback(task, session)

        logger.info(
            "Crawl session completed",
            job_id=session.job_id,
            articles_extracted=len(session.extracted_articles),
            elapsed_seconds=elapsed,
            error=session.error,
            proxy_id=task_proxy_id,
        )

        return session.extracted_articles

    def _build_task_prompt(self, session: CrawlSession) -> str:
        """Build the task prompt for the browser-use agent."""
        prompt_parts = [
            f"Navigate to {session.seed_url} and extract article content.",
            f"",
            f"## Constraints:",
            f"- Maximum pages to visit: {session.max_pages}",
            f"- Maximum link depth: {session.max_depth}",
            f"- Time budget: {session.budget_seconds} seconds",
            f"",
            f"## Output Format:",
            f"For each article you extract, output in this exact format:",
            f"---ARTICLE_START---",
            f"URL: [the page URL]",
            f"TITLE: [the article title]",
            f"PUBLISHED_AT: [publication date in ISO format, or 'unknown']",
            f"CONTENT: [the full article text]",
            f"---ARTICLE_END---",
            f"",
            f"Extract as many relevant articles as possible within the constraints.",
        ]

        if session.focus_keywords:
            prompt_parts.append(f"Focus on articles about: {', '.join(session.focus_keywords)}")

        return "\n".join(prompt_parts)

    def _parse_agent_output(
        self, result: Any, job_id: int, source_id: int
    ) -> list[CrawlResultMessage]:
        """Parse the agent's output to extract article data."""
        articles = []

        # Get the final output from the agent
        output_text = ""
        if hasattr(result, "final_result"):
            try:
                final_result = result.final_result
                value = final_result() if callable(final_result) else final_result
                if isinstance(value, str) and value.strip():
                    output_text = value
            except Exception:
                output_text = ""

        if not output_text and hasattr(result, "history") and result.history:
            # Get the last message content
            for item in reversed(result.history):
                if hasattr(item, "result") and item.result:
                    for r in reversed(item.result):
                        extracted_content = getattr(r, "extracted_content", None)
                        if isinstance(extracted_content, str) and extracted_content.strip():
                            output_text = extracted_content
                            break
                    if output_text:
                        break

        if not output_text:
            logger.warning("No output from agent", job_id=job_id)
            return articles

        # Parse articles from the output
        article_pattern = r"---ARTICLE_START---(.+?)---ARTICLE_END---"
        matches = re.findall(article_pattern, output_text, re.DOTALL)

        for match in matches:
            try:
                article = self._parse_article_block(match, job_id, source_id)
                if article:
                    articles.append(article)
            except Exception as e:
                logger.warning("Failed to parse article block", error=str(e))

        # If no structured output, try to extract from unstructured text
        if not articles:
            articles = self._extract_from_unstructured(output_text, job_id, source_id)

        return articles

    def _parse_article_block(
        self, block: str, job_id: int, source_id: int
    ) -> CrawlResultMessage | None:
        """Parse a single article block from agent output."""
        lines = block.strip().split("\n")
        data: dict[str, str] = {}

        current_key = None
        current_value = []

        for line in lines:
            if line.startswith("URL:"):
                if current_key:
                    data[current_key] = "\n".join(current_value).strip()
                current_key = "url"
                current_value = [line[4:].strip()]
            elif line.startswith("TITLE:"):
                if current_key:
                    data[current_key] = "\n".join(current_value).strip()
                current_key = "title"
                current_value = [line[6:].strip()]
            elif line.startswith("PUBLISHED_AT:"):
                if current_key:
                    data[current_key] = "\n".join(current_value).strip()
                current_key = "published_at"
                current_value = [line[13:].strip()]
            elif line.startswith("CONTENT:"):
                if current_key:
                    data[current_key] = "\n".join(current_value).strip()
                current_key = "content"
                current_value = [line[8:].strip()]
            elif current_key:
                current_value.append(line)

        # Don't forget the last field
        if current_key:
            data[current_key] = "\n".join(current_value).strip()

        # Validate required fields
        if not data.get("url") or not data.get("title") or not data.get("content"):
            return None

        # Handle "unknown" published_at
        published_at = data.get("published_at")
        if published_at and published_at.lower() == "unknown":
            published_at = None

        return CrawlResultMessage(
            job_id=job_id,
            source_id=source_id,
            url=data["url"],
            title=data["title"],
            content=data["content"],
            published_at=published_at,
            metadata_json=json.dumps({"source": "browser-agent"}),
        )

    def _extract_from_unstructured(
        self, text: str, job_id: int, source_id: int
    ) -> list[CrawlResultMessage]:
        """Try to extract articles from unstructured agent output."""
        # This is a fallback for when the agent doesn't follow the exact format
        # Look for URL patterns and try to associate content
        articles = []

        # Simple heuristic: split by URL patterns
        url_pattern = r"(https?://[^\s]+)"
        parts = re.split(url_pattern, text)

        current_url = None
        current_content = []

        for part in parts:
            if re.match(url_pattern, part):
                # Save previous article if exists
                if current_url and current_content:
                    content = " ".join(current_content).strip()
                    if len(content) > 100:  # Minimum content length
                        articles.append(
                            CrawlResultMessage(
                                job_id=job_id,
                                source_id=source_id,
                                url=current_url,
                                title=content[:100] + "...",  # Use first 100 chars as title
                                content=content,
                                published_at=None,
                                metadata_json=json.dumps(
                                    {"source": "browser-agent", "extraction": "unstructured"}
                                ),
                            )
                        )
                current_url = part
                current_content = []
            else:
                current_content.append(part)

        return articles

    async def _send_callback(self, task: BrowserTaskMessage, session: CrawlSession) -> None:
        """Send completion callback to the configured URL.

        The callback payload matches the schema expected by
        AutoCrawlController.handleCrawlerCallback() in data-collection-service:
        - targetId: CrawlTarget ID from metadata
        - urlHash: URL hash from metadata
        - success: boolean indicating success/failure
        - collectedDataId: (optional) ID of saved CollectedData
        - error: error message if failed
        """
        if not task.callback_url:
            return

        # Extract AutoCrawl metadata if available
        target_id = None
        url_hash = None
        if session.metadata:
            target_id = session.metadata.get("targetId")
            url_hash = session.metadata.get("urlHash")

        # Build callback payload matching Java's CrawlerCallbackRequest
        callback_data = {
            "targetId": int(target_id) if target_id else session.job_id,
            "urlHash": url_hash,
            "success": session.error is None,
            "collectedDataId": None,  # Will be set by CrawlResultConsumer
            "error": session.error,
            # Include additional stats for debugging/monitoring
            "articlesExtracted": len(session.extracted_articles),
            "pagesVisited": len(session.visited_urls),
            "elapsedSeconds": (
                (session.end_time - session.start_time).total_seconds()
                if session.end_time and session.start_time
                else 0
            ),
        }

        headers = {"Content-Type": "application/json"}
        if task.callback_token:
            headers["Authorization"] = f"Bearer {task.callback_token}"

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    task.callback_url,
                    json=callback_data,
                    headers=headers,
                    timeout=30.0,
                )
                logger.info(
                    "Callback sent",
                    job_id=session.job_id,
                    target_id=target_id,
                    url_hash=url_hash[:16] if url_hash else None,
                    success=callback_data["success"],
                    callback_url=task.callback_url,
                    status_code=response.status_code,
                )
        except Exception as e:
            logger.error(
                "Failed to send callback",
                job_id=session.job_id,
                callback_url=task.callback_url,
                error=str(e),
            )
