"""
State Storage Module for ML Trainer Service

Provides persistent storage for training jobs using Redis.
Falls back to in-memory storage if Redis is unavailable.

Usage:
    store = StateStore()
    await store.connect()
    await store.save_job(job_id, job_data)
    job = await store.load_job(job_id)
"""

import os
import json
import asyncio
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from dataclasses import asdict
from enum import Enum

import structlog

log = structlog.get_logger()

# Redis configuration from environment
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
REDIS_PREFIX = os.getenv("REDIS_PREFIX", "ml_trainer")
JOB_TTL_DAYS = int(os.getenv("JOB_TTL_DAYS", "30"))  # Jobs expire after 30 days


class EnhancedJSONEncoder(json.JSONEncoder):
    """JSON encoder that handles dataclasses, enums, and datetime."""
    
    def default(self, o: Any) -> Any:
        if hasattr(o, '__dataclass_fields__'):
            return asdict(o)
        if isinstance(o, Enum):
            return o.value
        if isinstance(o, datetime):
            return o.isoformat()
        if hasattr(o, 'maxlen'):  # deque
            return list(o)
        return super().default(o)


class StateStore:
    """
    Persistent state storage with Redis backend.
    Falls back to in-memory storage if Redis is unavailable.
    """
    
    def __init__(self):
        self._redis = None
        self._memory_store: Dict[str, Any] = {}
        self._using_redis = False
        self._lock = asyncio.Lock()
    
    async def connect(self) -> bool:
        """
        Connect to Redis. Returns True if connected, False if falling back to memory.
        """
        try:
            import redis.asyncio as redis
            
            self._redis = redis.from_url(
                REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5,
            )
            
            # Test connection
            await self._redis.ping()
            self._using_redis = True
            log.info("Connected to Redis", url=REDIS_URL, prefix=REDIS_PREFIX)
            
            # Load existing jobs from Redis into memory cache
            await self._load_existing_jobs()
            
            return True
            
        except ImportError:
            log.warning("redis package not installed, using in-memory storage")
            self._using_redis = False
            return False
            
        except Exception as e:
            log.warning("Failed to connect to Redis, using in-memory storage", error=str(e))
            self._using_redis = False
            return False
    
    async def disconnect(self):
        """Close Redis connection."""
        if self._redis:
            await self._redis.close()
            self._redis = None
            self._using_redis = False
            log.info("Disconnected from Redis")
    
    async def _load_existing_jobs(self):
        """Load existing jobs from Redis into memory on startup."""
        if not self._using_redis:
            return
        
        try:
            pattern = f"{REDIS_PREFIX}:job:*"
            cursor = 0
            count = 0
            
            while True:
                if self._redis is None:
                    break
                cursor, keys = await self._redis.scan(cursor, match=pattern, count=100)
                for key in keys:
                    job_id = key.split(":")[-1]
                    job_data = await self._redis.get(key)
                    if job_data:
                        self._memory_store[job_id] = json.loads(job_data)
                        count += 1
                
                if cursor == 0:
                    break
            
            log.info("Loaded existing jobs from Redis", count=count)
            
        except Exception as e:
            log.error("Failed to load existing jobs from Redis", error=str(e))
    
    def _key(self, job_id: str) -> str:
        """Generate Redis key for a job."""
        return f"{REDIS_PREFIX}:job:{job_id}"
    
    async def save_job(self, job_id: str, job: Any) -> bool:
        """
        Save a training job to storage.
        
        Args:
            job_id: Unique job identifier
            job: TrainingJob dataclass or dict
            
        Returns:
            True if saved successfully
        """
        async with self._lock:
            try:
                # Convert to dict if needed
                if hasattr(job, '__dataclass_fields__'):
                    job_data = asdict(job)
                    # Handle non-serializable fields
                    job_data.pop('event_queue', None)  # Remove deque
                elif isinstance(job, dict):
                    job_data = job.copy()
                    job_data.pop('event_queue', None)
                else:
                    job_data = job
                
                job_json = json.dumps(job_data, cls=EnhancedJSONEncoder)
                
                # Save to memory (always)
                self._memory_store[job_id] = json.loads(job_json)
                
                # Save to Redis if available
                if self._using_redis and self._redis:
                    ttl_seconds = JOB_TTL_DAYS * 24 * 60 * 60
                    await self._redis.set(self._key(job_id), job_json, ex=ttl_seconds)
                
                return True
                
            except Exception as e:
                log.error("Failed to save job", job_id=job_id, error=str(e))
                return False
    
    async def load_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        """
        Load a training job from storage.
        
        Args:
            job_id: Unique job identifier
            
        Returns:
            Job data as dict, or None if not found
        """
        # Check memory first
        if job_id in self._memory_store:
            return self._memory_store[job_id]
        
        # Try Redis
        if self._using_redis and self._redis:
            try:
                job_json = await self._redis.get(self._key(job_id))
                if job_json:
                    job_data = json.loads(job_json)
                    self._memory_store[job_id] = job_data
                    return job_data
            except Exception as e:
                log.error("Failed to load job from Redis", job_id=job_id, error=str(e))
        
        return None
    
    async def delete_job(self, job_id: str) -> bool:
        """
        Delete a training job from storage.
        
        Args:
            job_id: Unique job identifier
            
        Returns:
            True if deleted successfully
        """
        async with self._lock:
            try:
                # Remove from memory
                self._memory_store.pop(job_id, None)
                
                # Remove from Redis
                if self._using_redis and self._redis:
                    await self._redis.delete(self._key(job_id))
                
                return True
                
            except Exception as e:
                log.error("Failed to delete job", job_id=job_id, error=str(e))
                return False
    
    async def list_jobs(
        self,
        state: Optional[str] = None,
        model_type: Optional[str] = None,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """
        List jobs with optional filtering.
        
        Args:
            state: Filter by job state
            model_type: Filter by model type
            limit: Maximum number of jobs to return
            
        Returns:
            List of job data dicts
        """
        jobs = []
        
        for job_id, job_data in list(self._memory_store.items())[-limit:]:
            if state and job_data.get('state', '').lower() != state.lower():
                continue
            if model_type and job_data.get('model_type', '').lower() != model_type.lower():
                continue
            jobs.append(job_data)
        
        return jobs
    
    async def update_job_status(
        self,
        job_id: str,
        state: str,
        progress: Optional[float] = None,
        error_message: Optional[str] = None,
        completed_at: Optional[str] = None,
        **kwargs: Any
    ) -> bool:
        """
        Update specific fields of a job.
        
        Args:
            job_id: Unique job identifier
            state: New job state
            progress: Current progress percentage
            error_message: Error message if failed
            completed_at: Completion timestamp
            **kwargs: Additional fields to update
            
        Returns:
            True if updated successfully
        """
        job_data = await self.load_job(job_id)
        if not job_data:
            return False
        
        job_data['state'] = state
        if progress is not None:
            job_data['progress'] = progress
        if error_message is not None:
            job_data['error_message'] = error_message
        if completed_at is not None:
            job_data['completed_at'] = completed_at
        
        # Update additional fields
        for key, value in kwargs.items():
            if value is not None:
                job_data[key] = value
        
        return await self.save_job(job_id, job_data)
    
    async def get_active_job_count(self) -> int:
        """Get count of active (pending, running, initializing) jobs."""
        count = 0
        active_states = {'PENDING', 'RUNNING', 'INITIALIZING'}
        
        for job_data in self._memory_store.values():
            if job_data.get('state', '').upper() in active_states:
                count += 1
        
        return count
    
    async def get_completed_models(self) -> List[Dict[str, Any]]:
        """Get list of completed jobs with model paths."""
        models = []
        
        for job_data in self._memory_store.values():
            if job_data.get('state') == 'COMPLETED' and job_data.get('model_path'):
                models.append({
                    'job_id': job_data.get('job_id'),
                    'model_name': job_data.get('model_name'),
                    'model_type': job_data.get('model_type'),
                    'model_path': job_data.get('model_path'),
                    'metrics': job_data.get('metrics', {}),
                    'completed_at': job_data.get('completed_at'),
                })
        
        return models
    
    @property
    def is_redis_connected(self) -> bool:
        """Check if Redis is connected."""
        return self._using_redis
    
    def get_memory_store(self) -> Dict[str, Any]:
        """Get reference to memory store for direct access (e.g., for event_queue)."""
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
