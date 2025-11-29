"""Autonomous crawler agent using browser-use."""

import asyncio
import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

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
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._browser_session: BrowserSession | None = None
        self._llm = self._create_llm()

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

    async def _get_browser_session(self) -> BrowserSession:
        """Get or create the browser session."""
        if self._browser_session is None:
            profile = BrowserProfile(
                headless=self.settings.browser.headless,
                disable_security=True,  # Required for some sites
            )
            self._browser_session = BrowserSession(browser_profile=profile)
        return self._browser_session

    async def close(self) -> None:
        """Close the browser and cleanup resources."""
        if self._browser_session:
            await self._browser_session.stop()
            self._browser_session = None

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
