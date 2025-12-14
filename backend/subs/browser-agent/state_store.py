"""
State Storage Module for browser-agent Service

Provides persistent storage for task results using Redis.
Falls back to in-memory storage if Redis is unavailable.
"""

import os
import json
import asyncio
from datetime import datetime
from typing import Optional, Dict, Any, List
from dataclasses import asdict
from enum import Enum

# Redis configuration from environment
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/4")
REDIS_PREFIX = os.getenv("REDIS_PREFIX", "browser_agent")
RESULT_TTL_HOURS = int(os.getenv("RESULT_TTL_HOURS", "48"))  # Results expire after 48 hours


class EnhancedJSONEncoder(json.JSONEncoder):
    """JSON encoder that handles dataclasses and enums."""
    
    def default(self, o: Any) -> Any:
        if hasattr(o, '__dataclass_fields__'):
            return asdict(o)
        if isinstance(o, Enum):
            return o.value
        if isinstance(o, datetime):
            return o.isoformat()
        return super().default(o)


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
            
            # Load existing results from Redis
            await self._load_existing_results()
            
            return True
            
        except ImportError:
            self._using_redis = False
            return False
        except Exception:
            self._using_redis = False
            return False
    
    async def _load_existing_results(self):
        """Load existing results from Redis into memory on startup."""
        if not self._using_redis or not self._redis:
            return
        
        try:
            pattern = f"{REDIS_PREFIX}:task:*"
            cursor = 0
            
            while True:
                cursor, keys = await self._redis.scan(cursor, match=pattern, count=100)
                for key in keys:
                    task_id = key.split(":")[-1]
                    task_data = await self._redis.get(key)
                    if task_data:
                        self._memory_store[task_id] = json.loads(task_data)
                
                if cursor == 0:
                    break
        except Exception:
            pass
    
    async def disconnect(self):
        """Close Redis connection."""
        if self._redis:
            await self._redis.close()
            self._redis = None
            self._using_redis = False
    
    def _key(self, task_id: str) -> str:
        """Generate Redis key."""
        return f"{REDIS_PREFIX}:task:{task_id}"
    
    async def save_task(self, task_id: str, task_result: Any) -> bool:
        """Save task result."""
        async with self._lock:
            try:
                # Convert to dict if needed
                if hasattr(task_result, '__dataclass_fields__'):
                    data = asdict(task_result)
                elif hasattr(task_result, 'model_dump'):
                    data = task_result.model_dump()
                elif hasattr(task_result, 'dict'):
                    data = task_result.dict()
                elif isinstance(task_result, dict):
                    data = task_result
                else:
                    data = task_result
                
                data_json = json.dumps(data, cls=EnhancedJSONEncoder)
                self._memory_store[task_id] = json.loads(data_json)
                
                if self._using_redis and self._redis:
                    ttl_seconds = RESULT_TTL_HOURS * 60 * 60
                    await self._redis.set(self._key(task_id), data_json, ex=ttl_seconds)
                
                return True
            except Exception:
                return False
    
    async def load_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Load task result."""
        if task_id in self._memory_store:
            return self._memory_store[task_id]
        
        if self._using_redis and self._redis:
            try:
                data_json = await self._redis.get(self._key(task_id))
                if data_json:
                    data = json.loads(data_json)
                    self._memory_store[task_id] = data
                    return data
            except Exception:
                pass
        
        return None
    
    async def delete_task(self, task_id: str) -> bool:
        """Delete task result."""
        async with self._lock:
            self._memory_store.pop(task_id, None)
            if self._using_redis and self._redis:
                try:
                    await self._redis.delete(self._key(task_id))
                except Exception:
                    pass
            return True
    
    async def list_tasks(self, status: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
        """List tasks with optional filtering."""
        tasks = []
        for task_id, task_data in list(self._memory_store.items())[-limit:]:
            if status and task_data.get('status', '').lower() != status.lower():
                continue
            tasks.append(task_data)
        return tasks
    
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
