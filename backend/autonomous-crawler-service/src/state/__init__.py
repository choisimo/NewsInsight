"""
State management module for autonomous-crawler-service.

Provides persistent storage for task results using Redis with in-memory fallback.
"""

from src.state.store import StateStore, get_state_store

__all__ = ["StateStore", "get_state_store"]
