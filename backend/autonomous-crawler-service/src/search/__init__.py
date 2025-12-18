"""Search providers package with RRF-based multi-strategy search."""

from src.search.base import SearchResult, SearchProvider
from src.search.brave import BraveSearchProvider
from src.search.tavily import TavilySearchProvider
from src.search.perplexity import PerplexitySearchProvider
from src.search.orchestrator import (
    ParallelSearchOrchestrator,
    RRFSearchOrchestrator,
    RRFSearchResult,
    AggregatedSearchResult,
    create_rrf_orchestrator,
)
from src.search.rrf import (
    ReciprocalRankFusion,
    SemanticRRF,
    RRFConfig,
    RRFResult,
    RRFMergeResult,
    create_rrf_merger,
    create_semantic_rrf_merger,
)
from src.search.query_analyzer import (
    QueryAnalyzer,
    QueryAnalysis,
    MultiStrategyQueryExpander,
)

__all__ = [
    # Base classes
    "SearchResult",
    "SearchProvider",
    # Providers
    "BraveSearchProvider",
    "TavilySearchProvider",
    "PerplexitySearchProvider",
    # Orchestrators
    "ParallelSearchOrchestrator",
    "RRFSearchOrchestrator",
    "RRFSearchResult",
    "AggregatedSearchResult",
    "create_rrf_orchestrator",
    # RRF algorithm
    "ReciprocalRankFusion",
    "SemanticRRF",
    "RRFConfig",
    "RRFResult",
    "RRFMergeResult",
    "create_rrf_merger",
    "create_semantic_rrf_merger",
    # Query analysis
    "QueryAnalyzer",
    "QueryAnalysis",
    "MultiStrategyQueryExpander",
]
