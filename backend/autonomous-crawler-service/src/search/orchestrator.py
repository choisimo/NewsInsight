"""Parallel search orchestrator for multiple providers."""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

import structlog

from src.search.base import SearchProvider, SearchResult

logger = structlog.get_logger(__name__)


@dataclass
class AggregatedSearchResult:
    """Aggregated results from multiple search providers."""
    
    query: str
    results: list[SearchResult]
    providers_used: list[str]
    providers_failed: list[str]
    total_results: int
    unique_urls: int
    search_time_ms: float
    timestamp: datetime = field(default_factory=datetime.now)
    
    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "query": self.query,
            "results": [r.to_dict() for r in self.results],
            "providers_used": self.providers_used,
            "providers_failed": self.providers_failed,
            "total_results": self.total_results,
            "unique_urls": self.unique_urls,
            "search_time_ms": self.search_time_ms,
            "timestamp": self.timestamp.isoformat(),
        }


class ParallelSearchOrchestrator:
    """
    Orchestrates parallel searches across multiple providers.
    
    Features:
    - Parallel execution for speed
    - Deduplication by URL
    - Result ranking and merging
    - Provider health tracking
    - Fallback strategies
    """
    
    def __init__(
        self,
        providers: list[SearchProvider],
        timeout: float = 30.0,
        deduplicate: bool = True,
    ):
        """
        Initialize orchestrator.
        
        Args:
            providers: List of search providers to use
            timeout: Timeout for each provider search
            deduplicate: Whether to deduplicate results by URL
        """
        self.providers = providers
        self.timeout = timeout
        self.deduplicate = deduplicate
        self._provider_health: dict[str, bool] = {}
    
    async def search(
        self,
        query: str,
        max_results_per_provider: int = 10,
        max_total_results: int = 30,
        **kwargs,
    ) -> AggregatedSearchResult:
        """
        Execute parallel search across all providers.
        
        Args:
            query: Search query
            max_results_per_provider: Max results from each provider
            max_total_results: Max total results after aggregation
            **kwargs: Provider-specific options
            
        Returns:
            AggregatedSearchResult with merged, deduplicated results
        """
        start_time = datetime.now()
        
        # Create tasks for all providers
        tasks = []
        provider_names = []
        
        for provider in self.providers:
            task = asyncio.create_task(
                self._search_with_timeout(
                    provider,
                    query,
                    max_results_per_provider,
                    **kwargs,
                )
            )
            tasks.append(task)
            provider_names.append(provider.name)
        
        # Wait for all tasks to complete
        results_by_provider = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Process results
        all_results: list[SearchResult] = []
        providers_used: list[str] = []
        providers_failed: list[str] = []
        
        for provider_name, result in zip(provider_names, results_by_provider):
            if isinstance(result, Exception):
                logger.error(
                    "Provider search failed",
                    provider=provider_name,
                    error=str(result),
                )
                providers_failed.append(provider_name)
                self._provider_health[provider_name] = False
            elif isinstance(result, list):
                all_results.extend(result)
                if result:
                    providers_used.append(provider_name)
                    self._provider_health[provider_name] = True
                else:
                    # Empty results but no error
                    providers_used.append(provider_name)
        
        # Deduplicate by URL
        if self.deduplicate:
            all_results = self._deduplicate_results(all_results)
        
        # Rank and limit results
        all_results = self._rank_results(all_results)[:max_total_results]
        
        # Calculate search time
        search_time_ms = (datetime.now() - start_time).total_seconds() * 1000
        
        logger.info(
            "Parallel search completed",
            query=query,
            total_results=len(all_results),
            providers_used=providers_used,
            providers_failed=providers_failed,
            search_time_ms=search_time_ms,
        )
        
        return AggregatedSearchResult(
            query=query,
            results=all_results,
            providers_used=providers_used,
            providers_failed=providers_failed,
            total_results=len(all_results),
            unique_urls=len(set(r.url for r in all_results)),
            search_time_ms=search_time_ms,
        )
    
    async def _search_with_timeout(
        self,
        provider: SearchProvider,
        query: str,
        max_results: int,
        **kwargs,
    ) -> list[SearchResult]:
        """Execute provider search with timeout."""
        try:
            return await asyncio.wait_for(
                provider.search(query, max_results, **kwargs),
                timeout=self.timeout,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "Provider search timed out",
                provider=provider.name,
                timeout=self.timeout,
            )
            raise
    
    def _deduplicate_results(
        self,
        results: list[SearchResult],
    ) -> list[SearchResult]:
        """
        Deduplicate results by URL, keeping the first occurrence.
        
        Also merges information from duplicate entries.
        """
        seen_urls: dict[str, SearchResult] = {}
        
        for result in results:
            # Normalize URL for comparison
            normalized_url = self._normalize_url(result.url)
            
            if normalized_url not in seen_urls:
                seen_urls[normalized_url] = result
            else:
                # Merge: keep the one with more information
                existing = seen_urls[normalized_url]
                if len(result.snippet) > len(existing.snippet):
                    # Keep longer snippet
                    result.raw_data["merged_from"] = existing.source_provider
                    seen_urls[normalized_url] = result
        
        return list(seen_urls.values())
    
    def _normalize_url(self, url: str) -> str:
        """Normalize URL for deduplication."""
        try:
            parsed = urlparse(url)
            # Remove www. prefix and trailing slash
            netloc = parsed.netloc.lower().lstrip("www.")
            path = parsed.path.rstrip("/")
            return f"{netloc}{path}"
        except Exception:
            return url.lower()
    
    def _rank_results(self, results: list[SearchResult]) -> list[SearchResult]:
        """
        Rank results by relevance.
        
        Scoring factors:
        - Provider reliability
        - Relevance score (if available)
        - Content length
        - Recency (if date available)
        """
        def score_result(result: SearchResult) -> float:
            score = 0.0
            
            # Provider weight
            provider_weights = {
                "tavily": 1.0,
                "brave": 0.9,
                "perplexity": 0.85,
                "brave_news": 0.95,
            }
            score += provider_weights.get(result.source_provider, 0.5) * 10
            
            # Relevance score if available
            if result.score:
                score += result.score * 5
            
            # Content length (prefer informative snippets)
            score += min(len(result.snippet) / 100, 5)
            
            # Title quality
            if result.title and len(result.title) > 10:
                score += 2
            
            return score
        
        return sorted(results, key=score_result, reverse=True)
    
    async def search_news(
        self,
        query: str,
        max_results_per_provider: int = 10,
        days: int = 7,
        **kwargs,
    ) -> AggregatedSearchResult:
        """Search for news specifically."""
        # Add news-specific parameters
        kwargs["topic"] = "news"
        kwargs["days"] = days
        kwargs["freshness"] = "pw"  # Past week for Brave
        kwargs["search_recency_filter"] = "week"  # For Perplexity
        
        return await self.search(
            query=query,
            max_results_per_provider=max_results_per_provider,
            **kwargs,
        )
    
    async def health_check_all(self) -> dict[str, bool]:
        """Check health of all providers."""
        tasks = [
            (provider.name, provider.health_check())
            for provider in self.providers
        ]
        
        results = {}
        for name, task in tasks:
            try:
                results[name] = await asyncio.wait_for(task, timeout=10.0)
            except Exception:
                results[name] = False
        
        self._provider_health = results
        return results
    
    def get_healthy_providers(self) -> list[str]:
        """Get list of healthy provider names."""
        return [name for name, healthy in self._provider_health.items() if healthy]
    
    async def close_all(self) -> None:
        """Close all provider connections."""
        for provider in self.providers:
            if hasattr(provider, "close"):
                await provider.close()
