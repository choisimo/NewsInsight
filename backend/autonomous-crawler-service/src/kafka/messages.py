"""Kafka message schemas matching Java DTOs."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class BrowserTaskMessage(BaseModel):
    """
    Kafka message for browser-based autonomous crawling tasks.
    Matches: com.newsinsight.collector.dto.BrowserTaskMessage
    """

    job_id: int = Field(..., alias="jobId", description="Unique job ID for tracking")
    source_id: int = Field(..., alias="sourceId", description="Data source ID")
    source_name: str | None = Field(
        default=None, alias="sourceName", description="Source name for logging/display"
    )
    seed_url: str = Field(..., alias="seedUrl", description="Seed URL to start exploration from")
    max_depth: int | None = Field(
        default=2, alias="maxDepth", description="Maximum link traversal depth"
    )
    max_pages: int | None = Field(
        default=10, alias="maxPages", description="Maximum pages to visit"
    )
    budget_seconds: int | None = Field(
        default=300, alias="budgetSeconds", description="Time budget in seconds"
    )
    policy: str | None = Field(
        default="NEWS_ONLY",
        description="Exploration policy (focused_topic, domain_wide, news_only, etc.)",
    )
    focus_keywords: str | None = Field(
        default=None, alias="focusKeywords", description="Focus keywords for FOCUSED_TOPIC policy"
    )
    custom_prompt: str | None = Field(
        default=None, alias="customPrompt", description="Custom prompt/instructions for AI agent"
    )
    capture_screenshots: bool | None = Field(
        default=False, alias="captureScreenshots", description="Whether to capture screenshots"
    )
    extract_structured: bool | None = Field(
        default=True, alias="extractStructured", description="Whether to extract structured data"
    )
    excluded_domains: str | None = Field(
        default=None, alias="excludedDomains", description="Domains to exclude"
    )
    callback_url: str | None = Field(
        default=None, alias="callbackUrl", description="Callback URL for session completion"
    )
    callback_token: str | None = Field(
        default=None, alias="callbackToken", description="Callback authentication token"
    )
    metadata: dict[str, Any] | None = Field(default=None, description="Additional metadata")
    created_at: datetime | None = Field(
        default=None, alias="createdAt", description="Task creation timestamp"
    )

    class Config:
        populate_by_name = True

    def get_excluded_domains_list(self) -> list[str]:
        """Parse excluded domains string into list."""
        if not self.excluded_domains:
            return []
        return [d.strip() for d in self.excluded_domains.split(",") if d.strip()]

    def get_focus_keywords_list(self) -> list[str]:
        """Parse focus keywords string into list."""
        if not self.focus_keywords:
            return []
        return [k.strip() for k in self.focus_keywords.split(",") if k.strip()]


class CrawlResultMessage(BaseModel):
    """
    Kafka message for crawl results.
    Matches: com.newsinsight.collector.dto.CrawlResultMessage
    """

    job_id: int = Field(..., alias="jobId", description="Job ID this result belongs to")
    source_id: int = Field(..., alias="sourceId", description="Data source ID")
    title: str = Field(..., description="Article/page title")
    content: str = Field(..., description="Extracted content")
    url: str = Field(..., description="Page URL")
    published_at: str | None = Field(
        default=None, alias="publishedAt", description="Publication date as ISO string"
    )
    metadata_json: str | None = Field(
        default=None, alias="metadataJson", description="Additional metadata as JSON string"
    )

    class Config:
        populate_by_name = True

    def to_kafka_dict(self) -> dict[str, Any]:
        """Convert to Kafka-compatible dict with Java-style camelCase keys."""
        return {
            "jobId": self.job_id,
            "sourceId": self.source_id,
            "title": self.title,
            "content": self.content,
            "url": self.url,
            "publishedAt": self.published_at,
            "metadataJson": self.metadata_json,
        }
