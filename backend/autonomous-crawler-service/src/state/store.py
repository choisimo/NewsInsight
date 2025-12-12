"""
State Storage Module for autonomous-crawler-service.

Provides persistent storage for task results using Redis.
Falls back to in-memory storage if Redis is unavailable.

Features:
- Redis backend with configurable TTL
- In-memory fallback for resilience
- Automatic state restoration on startup
- Async-safe with lock protection
"""

import asyncio
import json
from dataclasses import asdict
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

import structlog

from src.config import get_settings

logger = structlog.get_logger(__name__)


class EnhancedJSONEncoder(json.JSONEncoder):
    """JSON encoder that handles dataclasses, enums, and datetime objects."""

    def default(self, o: Any) -> Any:
        if hasattr(o, "__dataclass_fields__"):
            return asdict(o)
        if hasattr(o, "model_dump"):
            # Pydantic v2 models
            return o.model_dump()
        if hasattr(o, "dict"):
            # Pydantic v1 models
            return o.dict()
        if isinstance(o, Enum):
            return o.value
        if isinstance(o, datetime):
            return o.isoformat()
        return super().default(o)


class StateStore:
    """
    Persistent state storage with Redis backend and in-memory fallback.

    Usage:
        store = StateStore()
        await store.connect()

        # Save task result
        await store.save_task("task-123", task_result)

        # Load task result
        result = await store.load_task("task-123")

        # List recent tasks
        tasks = await store.list_tasks(status="success", limit=10)

        # Cleanup
        await store.disconnect()
    """

    def __init__(self):
        self._redis = None
        self._memory_store: Dict[str, Any] = {}
        self._using_redis = False
        self._lock = asyncio.Lock()
        self._settings = get_settings().redis

    async def connect(self) -> bool:
        """
        Connect to Redis.

        Returns:
            True if Redis connection successful, False if falling back to memory.
        """
        if not self._settings.enabled:
            logger.info("Redis disabled in settings, using in-memory storage")
            return False

        try:
            import redis.asyncio as redis

            self._redis = redis.from_url(
                self._settings.url,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=self._settings.connection_timeout,
                socket_timeout=self._settings.socket_timeout,
                max_connections=self._settings.max_connections,
                retry_on_timeout=self._settings.retry_on_timeout,
            )

            # Test connection
            await self._redis.ping()
            self._using_redis = True

            logger.info(
                "Connected to Redis",
                url=self._settings.url.split("@")[-1],  # Hide password if present
                prefix=self._settings.prefix,
            )

            # Load existing results from Redis into memory cache
            await self._load_existing_results()

            return True

        except ImportError:
            logger.warning(
                "redis package not installed, falling back to in-memory storage",
                hint="Install with: pip install redis>=5.0.0",
            )
            self._using_redis = False
            return False

        except Exception as e:
            logger.warning(
                "Failed to connect to Redis, falling back to in-memory storage",
                error=str(e),
                url=self._settings.url.split("@")[-1],
            )
            self._using_redis = False
            return False

    async def _load_existing_results(self):
        """Load existing results from Redis into memory on startup."""
        if not self._using_redis or not self._redis:
            return

        try:
            pattern = f"{self._settings.prefix}:task:*"
            cursor = 0
            loaded_count = 0

            while True:
                cursor, keys = await self._redis.scan(cursor, match=pattern, count=100)
                for key in keys:
                    task_id = key.split(":")[-1]
                    task_data = await self._redis.get(key)
                    if task_data:
                        self._memory_store[task_id] = json.loads(task_data)
                        loaded_count += 1

                if cursor == 0:
                    break

            if loaded_count > 0:
                logger.info(
                    "Restored tasks from Redis",
                    count=loaded_count,
                )

        except Exception as e:
            logger.warning(
                "Failed to load existing results from Redis",
                error=str(e),
            )

    async def disconnect(self):
        """Close Redis connection."""
        if self._redis:
            try:
                await self._redis.close()
                logger.info("Disconnected from Redis")
            except Exception as e:
                logger.warning("Error closing Redis connection", error=str(e))
            finally:
                self._redis = None
                self._using_redis = False

    def _key(self, task_id: str) -> str:
        """Generate Redis key for a task."""
        return f"{self._settings.prefix}:task:{task_id}"

    async def save_task(self, task_id: str, task_result: Any) -> bool:
        """
        Save task result to storage.

        Args:
            task_id: Unique task identifier
            task_result: Task result object (dict, dataclass, or Pydantic model)

        Returns:
            True if save successful
        """
        async with self._lock:
            try:
                # Convert to dict if needed
                if hasattr(task_result, "__dataclass_fields__"):
                    data = asdict(task_result)
                elif hasattr(task_result, "model_dump"):
                    data = task_result.model_dump()
                elif hasattr(task_result, "dict"):
                    data = task_result.dict()
                elif isinstance(task_result, dict):
                    data = task_result
                else:
                    data = task_result

                # Serialize to JSON
                data_json = json.dumps(data, cls=EnhancedJSONEncoder)

                # Store in memory cache (for fast reads)
                self._memory_store[task_id] = json.loads(data_json)

                # Store in Redis (for persistence)
                if self._using_redis and self._redis:
                    ttl_seconds = self._settings.result_ttl_hours * 60 * 60
                    await self._redis.set(self._key(task_id), data_json, ex=ttl_seconds)

                logger.debug(
                    "Task saved",
                    task_id=task_id,
                    redis=self._using_redis,
                )
                return True

            except Exception as e:
                logger.error(
                    "Failed to save task",
                    task_id=task_id,
                    error=str(e),
                )
                return False

    async def load_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """
        Load task result from storage.

        Args:
            task_id: Unique task identifier

        Returns:
            Task result dict or None if not found
        """
        # Check memory cache first (fast path)
        if task_id in self._memory_store:
            return self._memory_store[task_id]

        # Try Redis if available
        if self._using_redis and self._redis:
            try:
                data_json = await self._redis.get(self._key(task_id))
                if data_json:
                    data = json.loads(data_json)
                    # Cache in memory for faster subsequent access
                    self._memory_store[task_id] = data
                    return data
            except Exception as e:
                logger.warning(
                    "Failed to load task from Redis",
                    task_id=task_id,
                    error=str(e),
                )

        return None

    async def delete_task(self, task_id: str) -> bool:
        """
        Delete task result from storage.

        Args:
            task_id: Unique task identifier

        Returns:
            True if deletion successful
        """
        async with self._lock:
            # Remove from memory
            self._memory_store.pop(task_id, None)

            # Remove from Redis
            if self._using_redis and self._redis:
                try:
                    await self._redis.delete(self._key(task_id))
                except Exception as e:
                    logger.warning(
                        "Failed to delete task from Redis",
                        task_id=task_id,
                        error=str(e),
                    )

            logger.debug("Task deleted", task_id=task_id)
            return True

    async def list_tasks(
        self,
        status: Optional[str] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """
        List tasks with optional filtering.

        Args:
            status: Filter by status (e.g., "success", "failed", "timeout")
            limit: Maximum number of tasks to return

        Returns:
            List of task result dicts
        """
        tasks = []
        for task_id, task_data in list(self._memory_store.items())[-limit * 2 :]:
            if status and task_data.get("status", "").lower() != status.lower():
                continue
            tasks.append(task_data)
            if len(tasks) >= limit:
                break

        return tasks

    async def get_stats(self) -> Dict[str, Any]:
        """
        Get storage statistics.

        Returns:
            Dict with storage stats
        """
        stats = {
            "using_redis": self._using_redis,
            "memory_count": len(self._memory_store),
            "redis_url": self._settings.url.split("@")[-1] if self._using_redis else None,
            "ttl_hours": self._settings.result_ttl_hours,
        }

        if self._using_redis and self._redis:
            try:
                pattern = f"{self._settings.prefix}:task:*"
                cursor = 0
                redis_count = 0
                while True:
                    cursor, keys = await self._redis.scan(cursor, match=pattern, count=100)
                    redis_count += len(keys)
                    if cursor == 0:
                        break
                stats["redis_count"] = redis_count
            except Exception:
                stats["redis_count"] = "unknown"

        return stats

    @property
    def is_redis_connected(self) -> bool:
        """Check if Redis is connected."""
        return self._using_redis

    @property
    def task_count(self) -> int:
        """Get number of tasks in memory cache."""
        return len(self._memory_store)

    def get_memory_store(self) -> Dict[str, Any]:
        """Get direct access to memory store (for backward compatibility)."""
        return self._memory_store


# Singleton instance
_store: Optional[StateStore] = None


async def get_state_store() -> StateStore:
    """
    Get or create the singleton StateStore instance.

    This ensures only one StateStore exists throughout the application lifecycle.

    Returns:
        Initialized StateStore instance
    """
    global _store
    if _store is None:
        _store = StateStore()
        await _store.connect()
    return _store


async def close_state_store():
    """Close the singleton StateStore instance."""
    global _store
    if _store is not None:
        await _store.disconnect()
        _store = None
