"""
State Storage Module for crawl-worker Service

Provides persistent storage for batch crawl results using Redis.
Falls back to in-memory storage if Redis is unavailable.
"""

import os
import json
import asyncio
from datetime import datetime
from typing import Optional, Dict, Any, List

# Redis configuration from environment
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/2")
REDIS_PREFIX = os.getenv("REDIS_PREFIX", "crawl_worker")
RESULT_TTL_HOURS = int(os.getenv("RESULT_TTL_HOURS", "24"))  # Results expire after 24 hours


class StateStore:
    """Persistent state storage with Redis backend."""
    
    def __init__(self):
        self._redis = None
        self._memory_store: Dict[str, Any] = {}
        self._using_redis = False
        self._lock = asyncio.Lock()
    
    async def connect(self) -> bool:
        """Connect to Redis."""
        try:
            import redis.asyncio as redis
            
            self._redis = redis.from_url(
                REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5,
            )
            
            await self._redis.ping()
            self._using_redis = True
            return True
            
        except ImportError:
            self._using_redis = False
            return False
        except Exception:
            self._using_redis = False
            return False
    
    async def disconnect(self):
        """Close Redis connection."""
        if self._redis:
            await self._redis.close()
            self._redis = None
            self._using_redis = False
    
    def _key(self, batch_id: str) -> str:
        """Generate Redis key."""
        return f"{REDIS_PREFIX}:batch:{batch_id}"
    
    async def save_batch(self, batch_id: str, data: Dict[str, Any]) -> bool:
        """Save batch result."""
        async with self._lock:
            try:
                data_json = json.dumps(data, default=str)
                self._memory_store[batch_id] = json.loads(data_json)
                
                if self._using_redis and self._redis:
                    ttl_seconds = RESULT_TTL_HOURS * 60 * 60
                    await self._redis.set(self._key(batch_id), data_json, ex=ttl_seconds)
                
                return True
            except Exception:
                return False
    
    async def load_batch(self, batch_id: str) -> Optional[Dict[str, Any]]:
        """Load batch result."""
        if batch_id in self._memory_store:
            return self._memory_store[batch_id]
        
        if self._using_redis and self._redis:
            try:
                data_json = await self._redis.get(self._key(batch_id))
                if data_json:
                    data = json.loads(data_json)
                    self._memory_store[batch_id] = data
                    return data
            except Exception:
                pass
        
        return None
    
    async def delete_batch(self, batch_id: str) -> bool:
        """Delete batch result."""
        async with self._lock:
            self._memory_store.pop(batch_id, None)
            if self._using_redis and self._redis:
                try:
                    await self._redis.delete(self._key(batch_id))
                except Exception:
                    pass
            return True
    
    @property
    def is_redis_connected(self) -> bool:
        return self._using_redis
    
    def get_memory_store(self) -> Dict[str, Any]:
        return self._memory_store


# Singleton instance
_store: Optional[StateStore] = None


async def get_state_store() -> StateStore:
    """Get or create the singleton StateStore instance."""
    global _store
    if _store is None:
        _store = StateStore()
        await _store.connect()
    return _store
