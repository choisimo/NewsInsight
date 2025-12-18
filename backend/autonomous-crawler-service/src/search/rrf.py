"""Reciprocal Rank Fusion (RRF) for multi-strategy search result merging."""

from dataclasses import dataclass, field
from typing import Any, TypeVar, Callable, Optional
from collections import defaultdict

import structlog

from src.search.base import SearchResult

logger = structlog.get_logger(__name__)

T = TypeVar("T")


@dataclass
class RRFConfig:
    """Configuration for RRF algorithm."""

    k: int = 60  # RRF constant (default: 60, higher = more weight to lower ranks)
    min_score_threshold: float = 0.0  # Minimum RRF score to include result
    boost_exact_matches: bool = True  # Boost results that appear in multiple rankings
    multi_appearance_bonus: float = 0.1  # Bonus per additional appearance
    normalize_scores: bool = True  # Normalize final scores to 0-1 range


@dataclass
class RRFResult:
    """Result with RRF scoring information."""

    item: SearchResult
    rrf_score: float
    appearances: int  # Number of rankings this item appeared in
    rank_positions: list[int]  # Original positions in each ranking
    source_strategies: list[str]  # Which strategies found this result

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "item": self.item.to_dict(),
            "rrf_score": self.rrf_score,
            "appearances": self.appearances,
            "rank_positions": self.rank_positions,
            "source_strategies": self.source_strategies,
        }


@dataclass
class RRFMergeResult:
    """Result of RRF merge operation."""

    results: list[RRFResult]
    total_input_results: int
    unique_results: int
    strategies_used: list[str]
    processing_time_ms: float
    config: RRFConfig = field(default_factory=RRFConfig)

    def get_search_results(self) -> list[SearchResult]:
        """Get just the SearchResult items, sorted by RRF score."""
        return [r.item for r in sorted(self.results, key=lambda x: x.rrf_score, reverse=True)]

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "results": [r.to_dict() for r in self.results],
            "total_input_results": self.total_input_results,
            "unique_results": self.unique_results,
            "strategies_used": self.strategies_used,
            "processing_time_ms": self.processing_time_ms,
        }


class ReciprocalRankFusion:
    """
    Implements Reciprocal Rank Fusion (RRF) algorithm for combining
    multiple ranked lists into a single ranking.

    RRF Score = Σ 1 / (k + rank_i) for each ranking list

    Features:
    - Combines results from multiple search strategies
    - Handles duplicates by URL normalization
    - Boosts results that appear in multiple rankings
    - Configurable k parameter and scoring thresholds

    Reference:
    Cormack, G. V., Clarke, C. L., & Buettcher, S. (2009).
    Reciprocal rank fusion outperforms condorcet and individual rank learning methods.
    """

    def __init__(self, config: Optional[RRFConfig] = None):
        """
        Initialize RRF merger.

        Args:
            config: RRF configuration options
        """
        self.config = config or RRFConfig()

    def merge(
        self,
        ranked_lists: list[tuple[str, list[SearchResult]]],
        weights: Optional[dict[str, float]] = None,
        max_results: int = 50,
    ) -> RRFMergeResult:
        """
        Merge multiple ranked lists using RRF.

        Args:
            ranked_lists: List of (strategy_name, results) tuples
            weights: Optional weights per strategy (default: equal weights)
            max_results: Maximum number of results to return

        Returns:
            RRFMergeResult with merged and scored results
        """
        import time

        start_time = time.time()

        if not ranked_lists:
            return RRFMergeResult(
                results=[],
                total_input_results=0,
                unique_results=0,
                strategies_used=[],
                processing_time_ms=0,
                config=self.config,
            )

        # Default equal weights
        if weights is None:
            weights = {name: 1.0 for name, _ in ranked_lists}

        # Track scores and metadata per unique URL
        url_scores: dict[str, float] = defaultdict(float)
        url_items: dict[str, SearchResult] = {}
        url_appearances: dict[str, int] = defaultdict(int)
        url_ranks: dict[str, list[int]] = defaultdict(list)
        url_strategies: dict[str, list[str]] = defaultdict(list)

        total_input = 0
        strategies_used = []

        for strategy_name, results in ranked_lists:
            if not results:
                continue

            strategies_used.append(strategy_name)
            strategy_weight = weights.get(strategy_name, 1.0)

            for rank, result in enumerate(results, start=1):
                total_input += 1

                # Normalize URL for deduplication
                normalized_url = self._normalize_url(result.url)

                # Calculate RRF score for this position
                rrf_score = strategy_weight / (self.config.k + rank)

                url_scores[normalized_url] += rrf_score
                url_appearances[normalized_url] += 1
                url_ranks[normalized_url].append(rank)
                url_strategies[normalized_url].append(strategy_name)

                # Keep the result with most information
                if normalized_url not in url_items:
                    url_items[normalized_url] = result
                else:
                    existing = url_items[normalized_url]
                    # Prefer result with longer snippet or more metadata
                    if len(result.snippet) > len(existing.snippet):
                        url_items[normalized_url] = result

        # Apply multi-appearance bonus
        if self.config.boost_exact_matches:
            for url, appearances in url_appearances.items():
                if appearances > 1:
                    bonus = self.config.multi_appearance_bonus * (appearances - 1)
                    url_scores[url] += bonus

        # Normalize scores if configured
        if self.config.normalize_scores and url_scores:
            max_score = max(url_scores.values())
            if max_score > 0:
                url_scores = {url: score / max_score for url, score in url_scores.items()}

        # Build final results
        rrf_results = []
        for url, score in url_scores.items():
            if score >= self.config.min_score_threshold:
                rrf_results.append(
                    RRFResult(
                        item=url_items[url],
                        rrf_score=score,
                        appearances=url_appearances[url],
                        rank_positions=url_ranks[url],
                        source_strategies=url_strategies[url],
                    )
                )

        # Sort by RRF score (descending)
        rrf_results.sort(key=lambda x: x.rrf_score, reverse=True)

        # Limit results
        rrf_results = rrf_results[:max_results]

        processing_time = (time.time() - start_time) * 1000

        logger.info(
            "RRF merge completed",
            total_input=total_input,
            unique_results=len(rrf_results),
            strategies=strategies_used,
            processing_time_ms=round(processing_time, 2),
        )

        return RRFMergeResult(
            results=rrf_results,
            total_input_results=total_input,
            unique_results=len(rrf_results),
            strategies_used=strategies_used,
            processing_time_ms=processing_time,
            config=self.config,
        )

    def merge_with_reranking(
        self,
        ranked_lists: list[tuple[str, list[SearchResult]]],
        rerank_fn: Callable[[SearchResult], float],
        rerank_weight: float = 0.3,
        **kwargs,
    ) -> RRFMergeResult:
        """
        Merge with additional reranking based on a custom scoring function.

        Args:
            ranked_lists: List of (strategy_name, results) tuples
            rerank_fn: Function that takes a SearchResult and returns a score (0-1)
            rerank_weight: Weight for the reranking score (RRF weight = 1 - rerank_weight)
            **kwargs: Additional arguments passed to merge()

        Returns:
            RRFMergeResult with combined RRF and reranking scores
        """
        # First do standard RRF merge
        rrf_result = self.merge(ranked_lists, **kwargs)

        # Apply reranking
        for result in rrf_result.results:
            try:
                rerank_score = rerank_fn(result.item)
                # Combine RRF score with rerank score
                combined = result.rrf_score * (1 - rerank_weight) + rerank_score * rerank_weight
                result.rrf_score = combined
            except Exception as e:
                logger.debug("Reranking failed for result", url=result.item.url, error=str(e))

        # Re-sort by new scores
        rrf_result.results.sort(key=lambda x: x.rrf_score, reverse=True)

        return rrf_result

    def _normalize_url(self, url: str) -> str:
        """Normalize URL for deduplication."""
        try:
            from urllib.parse import urlparse

            parsed = urlparse(url)
            # Remove www. prefix and trailing slash
            netloc = parsed.netloc.lower().lstrip("www.")
            path = parsed.path.rstrip("/")
            # Remove common tracking parameters
            return f"{netloc}{path}"
        except Exception:
            return url.lower()


class SemanticRRF(ReciprocalRankFusion):
    """
    Extended RRF with semantic similarity scoring.

    Combines RRF with semantic similarity between query and results
    for better relevance ranking.
    """

    def __init__(
        self,
        config: Optional[RRFConfig] = None,
        similarity_weight: float = 0.2,
    ):
        """
        Initialize Semantic RRF.

        Args:
            config: RRF configuration
            similarity_weight: Weight for semantic similarity score (0-1)
        """
        super().__init__(config)
        self.similarity_weight = similarity_weight

    def merge_with_query_relevance(
        self,
        query: str,
        ranked_lists: list[tuple[str, list[SearchResult]]],
        query_keywords: Optional[list[str]] = None,
        **kwargs,
    ) -> RRFMergeResult:
        """
        Merge with query relevance scoring.

        Args:
            query: Original search query
            ranked_lists: List of (strategy_name, results) tuples
            query_keywords: Pre-extracted keywords for matching
            **kwargs: Additional arguments passed to merge()
        """
        keywords = query_keywords or self._extract_keywords(query)

        def relevance_scorer(result: SearchResult) -> float:
            """Score result based on keyword presence."""
            text = f"{result.title} {result.snippet}".lower()

            if not keywords:
                return 0.5

            matches = sum(1 for kw in keywords if kw.lower() in text)
            return min(matches / len(keywords), 1.0)

        return self.merge_with_reranking(
            ranked_lists=ranked_lists,
            rerank_fn=relevance_scorer,
            rerank_weight=self.similarity_weight,
            **kwargs,
        )

    def _extract_keywords(self, query: str) -> list[str]:
        """Simple keyword extraction."""
        import re

        # Basic tokenization
        words = re.findall(r"[\w가-힣]+", query.lower())
        # Filter short words
        return [w for w in words if len(w) > 1]


def create_rrf_merger(
    k: int = 60,
    boost_duplicates: bool = True,
    normalize: bool = True,
) -> ReciprocalRankFusion:
    """
    Factory function to create an RRF merger with common configurations.

    Args:
        k: RRF constant (higher = more weight to lower ranks)
        boost_duplicates: Boost results appearing in multiple rankings
        normalize: Normalize final scores to 0-1

    Returns:
        Configured ReciprocalRankFusion instance
    """
    config = RRFConfig(
        k=k,
        boost_exact_matches=boost_duplicates,
        normalize_scores=normalize,
    )
    return ReciprocalRankFusion(config)


def create_semantic_rrf_merger(
    similarity_weight: float = 0.2,
    **kwargs,
) -> SemanticRRF:
    """
    Factory function to create a Semantic RRF merger.

    Args:
        similarity_weight: Weight for semantic similarity (0-1)
        **kwargs: Additional RRFConfig arguments

    Returns:
        Configured SemanticRRF instance
    """
    config = RRFConfig(**kwargs) if kwargs else None
    return SemanticRRF(config, similarity_weight=similarity_weight)
