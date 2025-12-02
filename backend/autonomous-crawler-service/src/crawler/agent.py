"""Autonomous crawler agent using browser-use."""

import asyncio
import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx
import structlog
from browser_use.agent.service import Agent
from browser_use.browser.session import BrowserSession
from browser_use.browser.profile import BrowserProfile
from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI
from pydantic import BaseModel

from src.config import Settings
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
from src.search.orchestrator import ParallelSearchOrchestrator
from src.search.brave import BraveSearchProvider
from src.search.tavily import TavilySearchProvider
from src.search.perplexity import PerplexitySearchProvider

logger = structlog.get_logger(__name__)


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
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._browser_session: BrowserSession | None = None
        self._camoufox_browser: Any = None  # Camoufox browser instance
        self._llm = self._create_llm()
        self._search_orchestrator: ParallelSearchOrchestrator | None = None
        self._captcha_solver: CaptchaSolverOrchestrator | None = None
        self._stealth_config = EnhancedStealthConfig(
            use_nopecha=getattr(settings.stealth, 'use_nopecha', True),
            nopecha_api_key=getattr(settings.stealth, 'nopecha_api_key', ""),
            use_camoufox=getattr(settings.browser, 'backend', 'playwright') == 'camoufox',
            enable_human_simulation=getattr(settings.stealth, 'simulate_human_behavior', True),
        )
        
        # Determine browser backend
        self._use_camoufox = getattr(settings.browser, 'backend', 'playwright') == 'camoufox'
        if self._use_camoufox and not is_camoufox_available():
            logger.warning("Camoufox requested but not available, falling back to Playwright")
            self._use_camoufox = False

    def _create_llm(self) -> ChatOpenAI | ChatAnthropic:
        """Create the LLM instance based on settings."""
        llm_settings = self.settings.llm

        if llm_settings.provider == "anthropic":
            return ChatAnthropic(
                model=llm_settings.anthropic_model,
                api_key=llm_settings.anthropic_api_key,
                temperature=llm_settings.temperature,
                max_tokens=llm_settings.max_tokens,
            )
        else:
            return ChatOpenAI(
                model=llm_settings.openai_model,
                api_key=llm_settings.openai_api_key,
                temperature=llm_settings.temperature,
                max_tokens=llm_settings.max_tokens,
            )

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

    def _get_captcha_solver(self) -> CaptchaSolverOrchestrator:
        """Get or create the CAPTCHA solver orchestrator."""
        if self._captcha_solver is None:
            self._captcha_solver = CaptchaSolverOrchestrator()
        return self._captcha_solver

    async def _get_browser_session(self) -> BrowserSession:
        """Get or create the browser session with enhanced stealth configuration."""
        # Use Camoufox if configured
        if self._use_camoufox:
            return await self._get_camoufox_session()
        
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
                        include_docker=getattr(self.settings.browser, 'is_docker_env', False)
                    )
                else:
                    extra_args = get_undetected_browser_args()
                logger.info("Stealth mode enabled for browser session", 
                           extensions_loaded=len(self._stealth_config.extension_paths))
            
            profile = BrowserProfile(
                headless=self.settings.browser.headless,
                disable_security=True,  # Required for some sites
                extra_chromium_args=extra_args,
            )
            self._browser_session = BrowserSession(browser_profile=profile)
        return self._browser_session
    
    async def _get_camoufox_session(self) -> Any:
        """Get or create Camoufox browser session."""
        if self._camoufox_browser is None:
            camoufox_settings = getattr(self.settings, 'camoufox', None)
            
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
                logger.info("Camoufox browser created",
                           headless=config.headless,
                           humanize=config.humanize,
                           humanize_level=config.humanize_level)
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
    ) -> list[str]:
        """
        Perform API-based search before browser crawling.
        
        Returns list of URLs to visit based on search results.
        Useful for bypassing search engine CAPTCHAs.
        """
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
                                logger.info("CAPTCHA detected", 
                                           type=captcha_type.value, 
                                           selector=selector)
                                break
                    except Exception:
                        continue
                if detected_type:
                    break
            
            if not detected_type:
                return True  # No CAPTCHA detected
            
            # Try to solve the CAPTCHA
            solver = self._get_captcha_solver()
            result = await solver.solve(detected_type, page=page)
            
            if result.success:
                logger.info("CAPTCHA solved successfully", 
                           type=detected_type.value,
                           solver=result.solver_used,
                           time_ms=result.time_ms)
                # Wait for page to update after CAPTCHA solve
                await asyncio.sleep(2)
                return True
            else:
                logger.warning("CAPTCHA solve failed", 
                              type=detected_type.value,
                              error=result.error)
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

        # Create session
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
        )

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

            # Get browser session and create agent
            browser_session = await self._get_browser_session()

            agent = Agent(
                task=task_prompt,
                llm=self._llm,
                browser_session=browser_session,
                max_actions_per_step=5,
            )

            # Run the agent with timeout
            try:
                result = await asyncio.wait_for(
                    agent.run(max_steps=session.max_pages * 3),  # Allow multiple steps per page
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

            # Send callback if configured
            if task.callback_url:
                await self._send_callback(task, session)

        elapsed = (session.end_time - session.start_time).total_seconds()
        logger.info(
            "Crawl session completed",
            job_id=session.job_id,
            articles_extracted=len(session.extracted_articles),
            elapsed_seconds=elapsed,
            error=session.error,
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
            output_text = str(result.final_result)
        elif hasattr(result, "history") and result.history:
            # Get the last message content
            for item in reversed(result.history):
                if hasattr(item, "result") and item.result:
                    output_text = str(item.result)
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
        """Send completion callback to the configured URL."""
        if not task.callback_url:
            return

        callback_data = {
            "jobId": session.job_id,
            "sourceId": session.source_id,
            "status": "FAILED" if session.error else "COMPLETED",
            "articlesExtracted": len(session.extracted_articles),
            "pagesVisited": len(session.visited_urls),
            "elapsedSeconds": (
                (session.end_time - session.start_time).total_seconds()
                if session.end_time and session.start_time
                else 0
            ),
            "error": session.error,
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
