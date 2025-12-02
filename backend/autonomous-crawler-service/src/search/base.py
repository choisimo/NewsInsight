"""Base classes for search providers."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class SearchResult:
    """Unified search result structure."""
    
    title: str
    url: str
    snippet: str
    source_provider: str  # brave, tavily, perplexity, browser
    
    # Optional fields
    published_date: str | None = None
    score: float | None = None
    raw_data: dict[str, Any] = field(default_factory=dict)
    
    # Metadata
    fetched_at: datetime = field(default_factory=datetime.now)
    
    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "title": self.title,
            "url": self.url,
            "snippet": self.snippet,
            "source_provider": self.source_provider,
            "published_date": self.published_date,
            "score": self.score,
            "fetched_at": self.fetched_at.isoformat(),
        }


class SearchProvider(ABC):
    """Abstract base class for search providers."""
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Provider name."""
        pass
    
    @abstractmethod
    async def search(
        self,
        query: str,
        max_results: int = 10,
        **kwargs,
    ) -> list[SearchResult]:
        """
        Execute search query.
        
        Args:
            query: Search query string
            max_results: Maximum number of results to return
            **kwargs: Provider-specific options
            
        Returns:
            List of SearchResult objects
        """
        pass
    
    @abstractmethod
    async def health_check(self) -> bool:
        """Check if the provider is healthy and accessible."""
        pass
