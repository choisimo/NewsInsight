"""
Rate Limiting Middleware

Rate Limiting 미들웨어:
- IP별 요청 제한
- 사용자별 요청 제한
- Redis 기반 카운팅
- 429 응답 처리
- Sliding window 알고리즘
"""

from fastapi import Request, HTTPException, status
from typing import Optional, Dict, Tuple
from datetime import datetime, timedelta
import time
import hashlib
import logging
from app.config import settings

logger = logging.getLogger(__name__)

# Redis 클라이언트 (선택적 의존성)
try:
    import redis
    from redis import Redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False


class RateLimiter:
    """Rate Limiter 클래스"""
    
    # 기본 제한 (IP 기반)
    DEFAULT_RATE_LIMIT = 100  # 요청 수
    DEFAULT_WINDOW_SECONDS = 60  # 시간 윈도우 (초)
    
    # 사용자별 제한 (인증된 사용자)
    USER_RATE_LIMIT = 200
    USER_WINDOW_SECONDS = 60
    
    # 역할별 제한
    ROLE_LIMITS = {
        "admin": {"requests": 500, "window": 60},
        "analyst": {"requests": 300, "window": 60},
        "viewer": {"requests": 150, "window": 60},
        "system": {"requests": 1000, "window": 60}
    }
    
    def __init__(self, redis_url: Optional[str] = None):
        """
        RateLimiter 인스턴스를 초기화합니다.

        Args:
            redis_url: Redis 연결 URL (선택, 미입력 시 인메모리 폴백 사용)
        """
        self.redis_client: Optional[Redis] = None
        
        if REDIS_AVAILABLE and redis_url:
            try:
                self.redis_client = redis.from_url(redis_url)
                self.redis_client.ping()
                logger.info("Redis connected for rate limiting")
            except Exception as e:
                logger.warning(f"Failed to connect to Redis: {e}. Using in-memory fallback.")
                self.redis_client = None
        
        # Fallback: 메모리 기반 저장소
        self.memory_store: Dict[str, list] = {}
    
    def _get_key(self, request: Request) -> str:
        """
        요청별 Rate limit 키를 생성합니다.

        우선순위:
            1. 인증된 사용자 ID
            2. IP 주소 (X-Forwarded-For 우선)

        Args:
            request: FastAPI Request 객체

        Returns:
            Rate limit 식별 키 문자열
        """
        # 인증된 사용자
        if hasattr(request.state, "user"):
            user_id = request.state.user.get("user_id")
            if user_id:
                return f"user:{user_id}"
        
        # IP 주소
        client_ip = request.client.host if request.client else "unknown"
        
        # X-Forwarded-For 헤더 확인 (프록시 뒤에 있을 경우)
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            client_ip = forwarded_for.split(",")[0].strip()
        
        return f"ip:{client_ip}"
    
    def _get_limits(self, request: Request) -> Tuple[int, int]:
        """
        현재 요청에 적용할 제한(요청 수, 윈도우)을 계산합니다.

        Args:
            request: FastAPI Request 객체

        Returns:
            (허용 요청 수, 윈도우 초) 튜플
        """
        # 인증된 사용자의 역할 확인
        if hasattr(request.state, "user"):
            role = request.state.user.get("role")
            if role and role in self.ROLE_LIMITS:
                limits = self.ROLE_LIMITS[role]
                return limits["requests"], limits["window"]
            
            # 기본 인증 사용자
            return self.USER_RATE_LIMIT, self.USER_WINDOW_SECONDS
        
        # 미인증 사용자 (IP 기반)
        return self.DEFAULT_RATE_LIMIT, self.DEFAULT_WINDOW_SECONDS
    
    async def check_rate_limit(self, request: Request) -> bool:
        """
        Rate limit 위반 여부를 확인합니다.

        Args:
            request: FastAPI Request 객체

        Returns:
            허용 시 True

        Raises:
            HTTPException: Rate limit 초과 시 429 응답
        """
        key = self._get_key(request)
        max_requests, window_seconds = self._get_limits(request)
        
        current_time = time.time()
        
        if self.redis_client:
            # Redis 기반 체크
            allowed, remaining, reset_time = await self._check_redis(
                key, max_requests, window_seconds, current_time
            )
        else:
            # 메모리 기반 체크
            allowed, remaining, reset_time = self._check_memory(
                key, max_requests, window_seconds, current_time
            )
        
        # 응답 헤더에 Rate limit 정보 추가
        request.state.rate_limit_headers = {
            "X-RateLimit-Limit": str(max_requests),
            "X-RateLimit-Remaining": str(remaining),
            "X-RateLimit-Reset": str(int(reset_time))
        }
        
        if not allowed:
            retry_after = int(reset_time - current_time)
            logger.warning(
                f"Rate limit exceeded for {key}: "
                f"{max_requests} requests per {window_seconds}s"
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded. Try again in {retry_after} seconds.",
                headers={
                    "Retry-After": str(retry_after),
                    **request.state.rate_limit_headers
                }
            )
        
        return True
    
    async def _check_redis(
        self,
        key: str,
        max_requests: int,
        window_seconds: int,
        current_time: float
    ) -> Tuple[bool, int, float]:
        """
        Redis 기반 Sliding window 알고리즘으로 Rate limit을 판정합니다.

        Args:
            key: Rate limit 키
            max_requests: 허용 요청 수
            window_seconds: 윈도우 길이(초)
            current_time: 현재 시각(epoch seconds)

        Returns:
            (허용 여부, 남은 요청 수, 리셋 시간 epoch)
        """
        window_key = f"ratelimit:{key}"
        
        # 현재 윈도우 시작 시간
        window_start = current_time - window_seconds
        
        # 만료된 요청 제거
        self.redis_client.zremrangebyscore(window_key, 0, window_start)
        
        # 현재 요청 수 확인
        current_requests = self.redis_client.zcard(window_key)
        
        if current_requests >= max_requests:
            # Rate limit 초과
            # 가장 오래된 요청 시간 가져오기
            oldest = self.redis_client.zrange(window_key, 0, 0, withscores=True)
            reset_time = oldest[0][1] + window_seconds if oldest else current_time + window_seconds
            
            return False, 0, reset_time
        
        # 현재 요청 추가
        self.redis_client.zadd(window_key, {str(current_time): current_time})
        
        # 키 만료 시간 설정 (윈도우 크기 + 여유)
        self.redis_client.expire(window_key, window_seconds + 10)
        
        remaining = max_requests - current_requests - 1
        reset_time = current_time + window_seconds
        
        return True, remaining, reset_time
    
    def _check_memory(
        self,
        key: str,
        max_requests: int,
        window_seconds: int,
        current_time: float
    ) -> Tuple[bool, int, float]:
        """
        인메모리 리스트를 활용한 Rate limit 판정(폴백)입니다.

        Args:
            key: Rate limit 키
            max_requests: 허용 요청 수
            window_seconds: 윈도우 길이(초)
            current_time: 현재 시각(epoch seconds)

        Returns:
            (허용 여부, 남은 요청 수, 리셋 시간 epoch)
        """
        if key not in self.memory_store:
            self.memory_store[key] = []
        
        requests = self.memory_store[key]
        
        # 만료된 요청 제거
        window_start = current_time - window_seconds
        requests = [r for r in requests if r > window_start]
        self.memory_store[key] = requests
        
        if len(requests) >= max_requests:
            # Rate limit 초과
            reset_time = requests[0] + window_seconds
            return False, 0, reset_time
        
        # 현재 요청 추가
        requests.append(current_time)
        
        remaining = max_requests - len(requests)
        reset_time = current_time + window_seconds
        
        return True, remaining, reset_time
    
    def cleanup_memory(self):
        """
        메모리 저장소에서 만료된 Rate limit 기록을 제거합니다.

        1시간 이상 지난 엔트리를 제거하여 메모리 누수를 방지합니다.
        주기적으로 호출하는 것을 권장합니다.
        """
        current_time = time.time()
        cutoff = current_time - 3600  # 1시간 이전 데이터 제거
        
        cleaned = 0
        for key in list(self.memory_store.keys()):
            requests = self.memory_store[key]
            requests = [r for r in requests if r > cutoff]
            
            if not requests:
                del self.memory_store[key]
                cleaned += 1
            else:
                self.memory_store[key] = requests
        
        if cleaned > 0:
            logger.info(f"Cleaned {cleaned} expired rate limit entries from memory")


# 전역 Rate Limiter 인스턴스 (환경 변수 기반 Redis URL 사용)
rate_limiter = RateLimiter(redis_url=settings.RATE_LIMIT_REDIS_URL)


async def rate_limit_middleware(request: Request, call_next):
    """
    Rate Limiting 미들웨어
    
    요청 수를 제한하고 초과 시 429 응답 반환
    """
    # 공개 엔드포인트는 Rate limit 제외
    public_endpoints = ["/health", "/docs", "/openapi.json"]
    
    if any(request.url.path.startswith(endpoint) for endpoint in public_endpoints):
        return await call_next(request)
    
    # Rate limit 체크
    try:
        await rate_limiter.check_rate_limit(request)
    except HTTPException:
        raise
    
    # 요청 처리
    response = await call_next(request)
    
    # Rate limit 헤더 추가
    if hasattr(request.state, "rate_limit_headers"):
        for header, value in request.state.rate_limit_headers.items():
            response.headers[header] = value
    
    return response
