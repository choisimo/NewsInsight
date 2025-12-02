"""Perplexity API provider."""

import httpx
import structlog
from typing import Any, Literal

from src.search.base import SearchProvider, SearchResult

logger = structlog.get_logger(__name__)


class PerplexitySearchProvider(SearchProvider):
    """
    Perplexity API client (Sonar models for search).
    
    Docs: https://docs.perplexity.ai/api-reference/chat-completions
    """
    
    BASE_URL = "https://api.perplexity.ai"
    
    # Available models
    MODELS = {
        "sonar": "sonar",  # Lightweight, fast
        "sonar-pro": "sonar-pro",  # More comprehensive
        "sonar-reasoning": "sonar-reasoning",  # With reasoning
        "sonar-reasoning-pro": "sonar-reasoning-pro",  # Best quality
    }
    
    def __init__(
        self,
        api_key: str,
        model: str = "sonar",
        timeout: float = 60.0,
    ):
        self.api_key = api_key
        self.model = self.MODELS.get(model, model)
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None
    
    @property
    def name(self) -> str:
        return "perplexity"
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=self.timeout,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
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
        search_recency_filter: Literal["month", "week", "day", "hour"] | None = None,
        search_domain_filter: list[str] | None = None,
        return_citations: bool = True,
        return_related_questions: bool = False,
        **kwargs,
    ) -> list[SearchResult]:
        """
        Execute Perplexity search using Sonar models.
        
        Args:
            query: Search query
            max_results: Not directly used (Perplexity returns variable citations)
            search_recency_filter: Filter by recency (month, week, day, hour)
            search_domain_filter: List of domains to restrict search
            return_citations: Return source citations
            return_related_questions: Return related questions
        """
        client = await self._get_client()
        
        # Build system prompt for search
        system_prompt = (
            "You are a search assistant. Return factual information with sources. "
            "Focus on finding relevant web pages and their content."
        )
        
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": query},
            ],
            "return_citations": return_citations,
            "return_related_questions": return_related_questions,
        }
        
        # Add search filters if specified
        if search_recency_filter:
            payload["search_recency_filter"] = search_recency_filter
        if search_domain_filter:
            payload["search_domain_filter"] = search_domain_filter
        
        try:
            response = await client.post(
                f"{self.BASE_URL}/chat/completions",
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            
            results: list[SearchResult] = []
            
            # Extract citations as search results
            citations = data.get("citations", [])
            content = ""
            
            if data.get("choices"):
                content = data["choices"][0].get("message", {}).get("content", "")
            
            # Parse citations into results
            for i, citation_url in enumerate(citations[:max_results]):
                # Try to extract title from the content that references this citation
                # Citations are referenced as [1], [2], etc. in the content
                results.append(SearchResult(
                    title=f"Source {i + 1}",  # Perplexity doesn't provide titles directly
                    url=citation_url,
                    snippet=content[:500] if i == 0 else "",  # Full answer as snippet for first result
                    source_provider=self.name,
                    score=1.0 - (i * 0.1),  # Assume earlier citations are more relevant
                    raw_data={
                        "full_response": content,
                        "citation_index": i,
                        "model": self.model,
                    },
                ))
            
            logger.info(
                "Perplexity search completed",
                query=query,
                citations_count=len(citations),
                model=self.model,
            )
            
            return results
            
        except httpx.HTTPStatusError as e:
            logger.error(
                "Perplexity search HTTP error",
                query=query,
                status_code=e.response.status_code,
                error=str(e),
            )
            return []
        except Exception as e:
            logger.error(
                "Perplexity search failed",
                query=query,
                error=str(e),
            )
            return []
    
    async def search_with_context(
        self,
        query: str,
        context: str | None = None,
        focus: Literal["internet", "academic", "news"] = "internet",
        **kwargs,
    ) -> tuple[str, list[SearchResult]]:
        """
        Search with context and return both answer and citations.
        
        Args:
            query: Search query
            context: Additional context to consider
            focus: Search focus area
            
        Returns:
            Tuple of (AI answer, list of SearchResult)
        """
        client = await self._get_client()
        
        messages = []
        if context:
            messages.append({
                "role": "system",
                "content": f"Context: {context}\n\nProvide a comprehensive answer with citations.",
            })
        
        messages.append({"role": "user", "content": query})
        
        payload = {
            "model": self.model,
            "messages": messages,
            "return_citations": True,
        }
        
        try:
            response = await client.post(
                f"{self.BASE_URL}/chat/completions",
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            
            answer = ""
            if data.get("choices"):
                answer = data["choices"][0].get("message", {}).get("content", "")
            
            citations = data.get("citations", [])
            results = [
                SearchResult(
                    title=f"Citation {i + 1}",
                    url=url,
                    snippet="",
                    source_provider=self.name,
                    raw_data={"citation_index": i},
                )
                for i, url in enumerate(citations)
            ]
            
            return answer, results
            
        except Exception as e:
            logger.error("Perplexity context search failed", query=query, error=str(e))
            return "", []
    
    async def health_check(self) -> bool:
        """Check API health."""
        try:
            results = await self.search("test", max_results=1)
            return True
        except Exception:
            return False
