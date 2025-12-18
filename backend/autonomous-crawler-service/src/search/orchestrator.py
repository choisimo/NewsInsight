"""Parallel search orchestrator for multiple providers."""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional
from urllib.parse import urlparse

import structlog

from src.search.base import SearchProvider, SearchResult
from src.search.rrf import (
    ReciprocalRankFusion,
    SemanticRRF,
    RRFConfig,
    RRFMergeResult,
)

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
        tasks = [(provider.name, provider.health_check()) for provider in self.providers]

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


@dataclass
class RRFSearchResult:
    """Result from RRF-based multi-strategy search."""

    original_query: str
    results: list[SearchResult]
    strategies_used: list[str]
    providers_used: list[str]
    total_results: int
    unique_urls: int
    search_time_ms: float
    rrf_merge_result: Optional[RRFMergeResult] = None
    query_analysis: Optional[dict[str, Any]] = None
    timestamp: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "original_query": self.original_query,
            "results": [r.to_dict() for r in self.results],
            "strategies_used": self.strategies_used,
            "providers_used": self.providers_used,
            "total_results": self.total_results,
            "unique_urls": self.unique_urls,
            "search_time_ms": self.search_time_ms,
            "query_analysis": self.query_analysis,
            "timestamp": self.timestamp.isoformat(),
        }


class RRFSearchOrchestrator:
    """
    Advanced search orchestrator using RRF (Reciprocal Rank Fusion)
    to combine results from multiple search strategies.

    Features:
    - Query analysis and expansion using LLM
    - Multi-strategy parallel search
    - RRF-based result fusion
    - Semantic relevance scoring
    - Provider failover and health tracking

    Strategies:
    1. Original query search
    2. Keyword-extracted search
    3. Semantically expanded queries
    4. Cross-lingual search (for non-English queries)
    """

    def __init__(
        self,
        providers: list[SearchProvider],
        query_analyzer: Optional[Any] = None,  # QueryAnalyzer
        timeout: float = 30.0,
        rrf_config: Optional[RRFConfig] = None,
        enable_semantic_rrf: bool = True,
    ):
        """
        Initialize RRF Search Orchestrator.

        Args:
            providers: List of search providers
            query_analyzer: Optional QueryAnalyzer for query expansion
            timeout: Timeout per provider search
            rrf_config: RRF algorithm configuration
            enable_semantic_rrf: Use semantic similarity in RRF scoring
        """
        self.providers = providers
        self.query_analyzer = query_analyzer
        self.timeout = timeout
        self.rrf_config = rrf_config or RRFConfig()
        self._provider_health: dict[str, bool] = {}

        # Initialize RRF merger
        if enable_semantic_rrf:
            self._rrf_merger = SemanticRRF(self.rrf_config)
        else:
            self._rrf_merger = ReciprocalRankFusion(self.rrf_config)

    async def search_with_rrf(
        self,
        query: str,
        max_results_per_strategy: int = 10,
        max_total_results: int = 30,
        enable_query_expansion: bool = True,
        context: Optional[str] = None,
        **kwargs,
    ) -> RRFSearchResult:
        """
        Execute multi-strategy search with RRF fusion.

        Args:
            query: Original search query
            max_results_per_strategy: Max results per search strategy
            max_total_results: Max final results after RRF fusion
            enable_query_expansion: Whether to expand query using analyzer
            context: Optional context for query analysis
            **kwargs: Additional provider-specific options

        Returns:
            RRFSearchResult with fused results
        """
        start_time = datetime.now()

        # Step 1: Analyze and expand query
        search_queries = [query]  # Always include original
        query_analysis_dict = None

        if enable_query_expansion and self.query_analyzer:
            try:
                analysis = await self.query_analyzer.analyze(query, context)
                search_queries = analysis.get_all_search_queries()[:5]  # Limit strategies
                query_analysis_dict = {
                    "intent": analysis.intent,
                    "language": analysis.language,
                    "keywords": analysis.keywords,
                    "expanded_queries": analysis.expanded_queries,
                    "confidence": analysis.confidence,
                }
                logger.info(
                    "Query expanded for RRF search",
                    original=query,
                    expanded_count=len(search_queries),
                    intent=analysis.intent,
                )
            except Exception as e:
                logger.warning("Query expansion failed, using original", error=str(e))

        # Step 2: Execute parallel searches for each strategy
        ranked_lists: list[tuple[str, list[SearchResult]]] = []
        all_providers_used: set[str] = set()

        # Create search tasks for each query variant
        async def search_single_query(q: str, strategy_name: str) -> tuple[str, list[SearchResult]]:
            """Execute search for a single query across all providers."""
            results: list[SearchResult] = []

            tasks = [
                self._search_provider_with_timeout(provider, q, max_results_per_strategy, **kwargs)
                for provider in self.providers
            ]

            provider_results = await asyncio.gather(*tasks, return_exceptions=True)

            for provider, result in zip(self.providers, provider_results):
                if isinstance(result, Exception):
                    logger.debug(
                        "Provider search failed for strategy",
                        provider=provider.name,
                        strategy=strategy_name,
                        error=str(result),
                    )
                elif isinstance(result, list) and result:
                    results.extend(result)
                    all_providers_used.add(provider.name)

            return (strategy_name, results)

        # Execute all strategy searches in parallel
        strategy_tasks = [
            search_single_query(q, f"strategy_{i}" if i > 0 else "original")
            for i, q in enumerate(search_queries)
        ]

        ranked_lists = await asyncio.gather(*strategy_tasks)

        # Step 3: Apply RRF fusion
        strategy_weights = self._calculate_strategy_weights(search_queries)

        if isinstance(self._rrf_merger, SemanticRRF):
            # Use semantic RRF with query relevance
            keywords = query_analysis_dict.get("keywords", []) if query_analysis_dict else None
            rrf_result = self._rrf_merger.merge_with_query_relevance(
                query=query,
                ranked_lists=list(ranked_lists),
                query_keywords=keywords,
                weights=strategy_weights,
                max_results=max_total_results,
            )
        else:
            rrf_result = self._rrf_merger.merge(
                ranked_lists=list(ranked_lists),
                weights=strategy_weights,
                max_results=max_total_results,
            )

        # Extract final results
        final_results = rrf_result.get_search_results()

        search_time_ms = (datetime.now() - start_time).total_seconds() * 1000

        logger.info(
            "RRF search completed",
            query=query,
            strategies_used=len(search_queries),
            providers_used=list(all_providers_used),
            input_results=rrf_result.total_input_results,
            final_results=len(final_results),
            search_time_ms=round(search_time_ms, 2),
        )

        return RRFSearchResult(
            original_query=query,
            results=final_results,
            strategies_used=rrf_result.strategies_used,
            providers_used=list(all_providers_used),
            total_results=len(final_results),
            unique_urls=rrf_result.unique_results,
            search_time_ms=search_time_ms,
            rrf_merge_result=rrf_result,
            query_analysis=query_analysis_dict,
        )

    async def search_news_with_rrf(
        self,
        query: str,
        max_results_per_strategy: int = 10,
        days: int = 7,
        **kwargs,
    ) -> RRFSearchResult:
        """Search for news with RRF fusion."""
        kwargs["topic"] = "news"
        kwargs["days"] = days
        kwargs["freshness"] = "pw"
        kwargs["search_recency_filter"] = "week"

        return await self.search_with_rrf(
            query=query,
            max_results_per_strategy=max_results_per_strategy,
            **kwargs,
        )

    async def _search_provider_with_timeout(
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
            logger.debug(
                "Provider search timed out",
                provider=provider.name,
                timeout=self.timeout,
            )
            raise
        except Exception as e:
            logger.debug(
                "Provider search failed",
                provider=provider.name,
                error=str(e),
            )
            raise

    def _calculate_strategy_weights(
        self,
        queries: list[str],
    ) -> dict[str, float]:
        """
        Calculate weights for each search strategy.

        Original query gets highest weight, expanded queries get decreasing weights.
        """
        weights = {}
        for i, _ in enumerate(queries):
            strategy_name = f"strategy_{i}" if i > 0 else "original"
            # Original: 1.0, then decreasing: 0.9, 0.8, 0.7...
            weight = max(1.0 - (i * 0.1), 0.5)
            weights[strategy_name] = weight
        return weights

    async def health_check_all(self) -> dict[str, bool]:
        """Check health of all providers."""
        results = {}
        for provider in self.providers:
            try:
                results[provider.name] = await asyncio.wait_for(
                    provider.health_check(),
                    timeout=10.0,
                )
            except Exception:
                results[provider.name] = False

        self._provider_health = results
        return results

    async def close_all(self) -> None:
        """Close all provider connections."""
        for provider in self.providers:
            if hasattr(provider, "close"):
                await provider.close()


def create_rrf_orchestrator(
    providers: list[SearchProvider],
    llm: Optional[Any] = None,
    timeout: float = 30.0,
    rrf_k: int = 60,
    enable_semantic: bool = True,
) -> RRFSearchOrchestrator:
    """
    Factory function to create an RRF Search Orchestrator.

    Args:
        providers: List of search providers
        llm: Optional LLM for query analysis
        timeout: Timeout per provider
        rrf_k: RRF constant
        enable_semantic: Enable semantic similarity in scoring

    Returns:
        Configured RRFSearchOrchestrator
    """
    from src.search.query_analyzer import QueryAnalyzer

    query_analyzer = None
    if llm:
        query_analyzer = QueryAnalyzer(llm)

    rrf_config = RRFConfig(
        k=rrf_k,
        boost_exact_matches=True,
        normalize_scores=True,
    )

    return RRFSearchOrchestrator(
        providers=providers,
        query_analyzer=query_analyzer,
        timeout=timeout,
        rrf_config=rrf_config,
        enable_semantic_rrf=enable_semantic,
    )
