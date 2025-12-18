"""
State Storage Module for maigret-worker Service

Provides persistent storage for OSINT scan results using Redis.
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
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/3")
REDIS_PREFIX = os.getenv("REDIS_PREFIX", "maigret_worker")
SCAN_TTL_DAYS = int(os.getenv("SCAN_TTL_DAYS", "7"))  # Scans expire after 7 days


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
            
            # Load existing scans from Redis
            await self._load_existing_scans()
            
            return True
            
        except ImportError:
            self._using_redis = False
            return False
        except Exception:
            self._using_redis = False
            return False
    
    async def _load_existing_scans(self):
        """Load existing scans from Redis into memory on startup."""
        if not self._using_redis or not self._redis:
            return
        
        try:
            pattern = f"{REDIS_PREFIX}:scan:*"
            cursor = 0
            
            while True:
                cursor, keys = await self._redis.scan(cursor, match=pattern, count=100)
                for key in keys:
                    scan_id = key.split(":")[-1]
                    scan_data = await self._redis.get(key)
                    if scan_data:
                        self._memory_store[scan_id] = json.loads(scan_data)
                
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
    
    def _key(self, scan_id: str) -> str:
        """Generate Redis key."""
        return f"{REDIS_PREFIX}:scan:{scan_id}"
    
    async def save_scan(self, scan_id: str, scan_result: Any) -> bool:
        """Save scan result."""
        async with self._lock:
            try:
                # Convert to dict if needed
                if hasattr(scan_result, '__dataclass_fields__'):
                    data = asdict(scan_result)
                elif hasattr(scan_result, 'model_dump'):
                    data = scan_result.model_dump()
                elif hasattr(scan_result, 'dict'):
                    data = scan_result.dict()
                elif isinstance(scan_result, dict):
                    data = scan_result
                else:
                    data = scan_result
                
                data_json = json.dumps(data, cls=EnhancedJSONEncoder)
                self._memory_store[scan_id] = json.loads(data_json)
                
                if self._using_redis and self._redis:
                    ttl_seconds = SCAN_TTL_DAYS * 24 * 60 * 60
                    await self._redis.set(self._key(scan_id), data_json, ex=ttl_seconds)
                
                return True
            except Exception:
                return False
    
    async def load_scan(self, scan_id: str) -> Optional[Dict[str, Any]]:
        """Load scan result."""
        if scan_id in self._memory_store:
            return self._memory_store[scan_id]
        
        if self._using_redis and self._redis:
            try:
                data_json = await self._redis.get(self._key(scan_id))
                if data_json:
                    data = json.loads(data_json)
                    self._memory_store[scan_id] = data
                    return data
            except Exception:
                pass
        
        return None
    
    async def delete_scan(self, scan_id: str) -> bool:
        """Delete scan result."""
        async with self._lock:
            self._memory_store.pop(scan_id, None)
            if self._using_redis and self._redis:
                try:
                    await self._redis.delete(self._key(scan_id))
                except Exception:
                    pass
            return True
    
    async def list_scans(self, status: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
        """List scans with optional filtering."""
        scans = []
        for scan_id, scan_data in list(self._memory_store.items())[-limit:]:
            if status and scan_data.get('status', '').lower() != status.lower():
                continue
            scans.append(scan_data)
        return scans
    
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
