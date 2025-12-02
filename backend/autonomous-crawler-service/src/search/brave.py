"""Brave Search API provider."""

import httpx
import structlog
from typing import Any

from src.search.base import SearchProvider, SearchResult

logger = structlog.get_logger(__name__)


class BraveSearchProvider(SearchProvider):
    """
    Brave Search API client.
    
    Docs: https://api.search.brave.com/app/documentation/web-search/get-started
    """
    
    BASE_URL = "https://api.search.brave.com/res/v1"
    
    def __init__(self, api_key: str, timeout: float = 30.0):
        self.api_key = api_key
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None
    
    @property
    def name(self) -> str:
        return "brave"
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=self.timeout,
                headers={
                    "Accept": "application/json",
                    "Accept-Encoding": "gzip",
                    "X-Subscription-Token": self.api_key,
                },
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
        country: str = "kr",
        search_lang: str = "ko",
        ui_lang: str = "ko-KR",
        freshness: str | None = None,  # pd (past day), pw (past week), pm (past month)
        **kwargs,
    ) -> list[SearchResult]:
        """
        Execute Brave web search.
        
        Args:
            query: Search query
            max_results: Max results (1-20 for free tier)
            country: Country code
            search_lang: Search language
            ui_lang: UI language
            freshness: Time filter (pd, pw, pm, py)
        """
        client = await self._get_client()
        
        params: dict[str, Any] = {
            "q": query,
            "count": min(max_results, 20),  # Brave max is 20
            "country": country,
            "search_lang": search_lang,
            "ui_lang": ui_lang,
        }
        
        if freshness:
            params["freshness"] = freshness
        
        try:
            response = await client.get(
                f"{self.BASE_URL}/web/search",
                params=params,
            )
            response.raise_for_status()
            data = response.json()
            
            results: list[SearchResult] = []
            
            # Parse web results
            web_results = data.get("web", {}).get("results", [])
            for item in web_results[:max_results]:
                results.append(SearchResult(
                    title=item.get("title", ""),
                    url=item.get("url", ""),
                    snippet=item.get("description", ""),
                    source_provider=self.name,
                    published_date=item.get("age"),  # e.g., "2 hours ago"
                    score=item.get("relevancy_score"),
                    raw_data=item,
                ))
            
            logger.info(
                "Brave search completed",
                query=query,
                results_count=len(results),
            )
            
            return results
            
        except httpx.HTTPStatusError as e:
            logger.error(
                "Brave search HTTP error",
                query=query,
                status_code=e.response.status_code,
                error=str(e),
            )
            return []
        except Exception as e:
            logger.error(
                "Brave search failed",
                query=query,
                error=str(e),
            )
            return []
    
    async def search_news(
        self,
        query: str,
        max_results: int = 10,
        country: str = "kr",
        **kwargs,
    ) -> list[SearchResult]:
        """Search news specifically."""
        client = await self._get_client()
        
        params = {
            "q": query,
            "count": min(max_results, 20),
            "country": country,
            "freshness": "pw",  # Past week for news
        }
        
        try:
            response = await client.get(
                f"{self.BASE_URL}/news/search",
                params=params,
            )
            response.raise_for_status()
            data = response.json()
            
            results: list[SearchResult] = []
            news_results = data.get("results", [])
            
            for item in news_results[:max_results]:
                results.append(SearchResult(
                    title=item.get("title", ""),
                    url=item.get("url", ""),
                    snippet=item.get("description", ""),
                    source_provider=f"{self.name}_news",
                    published_date=item.get("age"),
                    raw_data=item,
                ))
            
            return results
            
        except Exception as e:
            logger.error("Brave news search failed", query=query, error=str(e))
            return []
    
    async def health_check(self) -> bool:
        """Check API health."""
        try:
            results = await self.search("test", max_results=1)
            return len(results) > 0
        except Exception:
            return False
