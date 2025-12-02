"""Tavily Search API provider."""

import httpx
import structlog
from typing import Any, Literal

from src.search.base import SearchProvider, SearchResult

logger = structlog.get_logger(__name__)


class TavilySearchProvider(SearchProvider):
    """
    Tavily Search API client.
    
    Docs: https://docs.tavily.com/docs/tavily-api/rest_api
    """
    
    BASE_URL = "https://api.tavily.com"
    
    def __init__(self, api_key: str, timeout: float = 60.0):
        self.api_key = api_key
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None
    
    @property
    def name(self) -> str:
        return "tavily"
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=self.timeout,
                headers={"Content-Type": "application/json"},
            )
        return self._client
    
    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None
    
    async def search(
        self,
        query: str,
        max_results: int = 10,
        search_depth: Literal["basic", "advanced"] = "basic",
        include_domains: list[str] | None = None,
        exclude_domains: list[str] | None = None,
        include_answer: bool = False,
        include_raw_content: bool = False,
        topic: Literal["general", "news"] = "general",
        days: int | None = None,  # For news topic, limit to N days
        **kwargs,
    ) -> list[SearchResult]:
        """
        Execute Tavily search.
        
        Args:
            query: Search query
            max_results: Maximum results (up to 10 for basic, 20 for advanced)
            search_depth: basic (faster) or advanced (more comprehensive)
            include_domains: List of domains to include
            exclude_domains: List of domains to exclude
            include_answer: Include AI-generated answer
            include_raw_content: Include raw HTML content
            topic: general or news
            days: For news, limit to past N days
        """
        client = await self._get_client()
        
        payload: dict[str, Any] = {
            "api_key": self.api_key,
            "query": query,
            "max_results": max_results,
            "search_depth": search_depth,
            "include_answer": include_answer,
            "include_raw_content": include_raw_content,
            "topic": topic,
        }
        
        if include_domains:
            payload["include_domains"] = include_domains
        if exclude_domains:
            payload["exclude_domains"] = exclude_domains
        if days and topic == "news":
            payload["days"] = days
        
        try:
            response = await client.post(
                f"{self.BASE_URL}/search",
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            
            results: list[SearchResult] = []
            
            for item in data.get("results", []):
                results.append(SearchResult(
                    title=item.get("title", ""),
                    url=item.get("url", ""),
                    snippet=item.get("content", ""),
                    source_provider=self.name,
                    published_date=item.get("published_date"),
                    score=item.get("score"),
                    raw_data={
                        "raw_content": item.get("raw_content"),
                        **item,
                    },
                ))
            
            # Add AI answer if available
            if include_answer and data.get("answer"):
                logger.info(
                    "Tavily AI answer generated",
                    query=query,
                    answer_preview=data["answer"][:100],
                )
            
            logger.info(
                "Tavily search completed",
                query=query,
                results_count=len(results),
                search_depth=search_depth,
            )
            
            return results
            
        except httpx.HTTPStatusError as e:
            logger.error(
                "Tavily search HTTP error",
                query=query,
                status_code=e.response.status_code,
                error=str(e),
            )
            return []
        except Exception as e:
            logger.error(
                "Tavily search failed",
                query=query,
                error=str(e),
            )
            return []
    
    async def search_news(
        self,
        query: str,
        max_results: int = 10,
        days: int = 7,
        **kwargs,
    ) -> list[SearchResult]:
        """Search news specifically."""
        return await self.search(
            query=query,
            max_results=max_results,
            topic="news",
            days=days,
            **kwargs,
        )
    
    async def extract_content(
        self,
        urls: list[str],
    ) -> list[dict[str, Any]]:
        """
        Extract content from URLs using Tavily Extract API.
        
        Args:
            urls: List of URLs to extract content from
            
        Returns:
            List of extracted content dictionaries
        """
        client = await self._get_client()
        
        try:
            response = await client.post(
                f"{self.BASE_URL}/extract",
                json={
                    "api_key": self.api_key,
                    "urls": urls,
                },
            )
            response.raise_for_status()
            data = response.json()
            
            return data.get("results", [])
            
        except Exception as e:
            logger.error("Tavily extract failed", urls=urls, error=str(e))
            return []
    
    async def health_check(self) -> bool:
        """Check API health."""
        try:
            results = await self.search("test", max_results=1)
            return True  # Tavily returns empty for simple queries but API works
        except Exception:
            return False
