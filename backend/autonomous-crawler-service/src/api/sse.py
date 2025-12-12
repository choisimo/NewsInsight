"""SSE (Server-Sent Events) Manager for real-time agent status updates."""

import asyncio
import json
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict

import structlog
from pydantic import BaseModel, Field

logger = structlog.get_logger(__name__)


class SSEEventType(str, Enum):
    """SSE 이벤트 타입"""

    CONNECTED = "connected"
    AGENT_START = "agent_start"
    AGENT_STEP = "agent_step"
    AGENT_COMPLETE = "agent_complete"
    AGENT_ERROR = "agent_error"
    URL_DISCOVERED = "url_discovered"
    HEALTH_UPDATE = "health_update"
    CAPTCHA_DETECTED = "captcha_detected"
    CAPTCHA_SOLVED = "captcha_solved"


class SSEEvent(BaseModel):
    """SSE 이벤트 데이터"""

    type: SSEEventType
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    data: Dict[str, Any] = {}


class SSEManager:
    """
    SSE 클라이언트 연결 관리자.

    브라우저 에이전트의 실시간 상태를 구독하는 클라이언트들을 관리합니다.
    """

    def __init__(self, max_queue_size: int = 100):
        self._clients: Dict[str, asyncio.Queue] = {}
        self._lock = asyncio.Lock()
        self._max_queue_size = max_queue_size

    @property
    def client_count(self) -> int:
        """현재 연결된 클라이언트 수"""
        return len(self._clients)

    @property
    def client_ids(self) -> list[str]:
        """연결된 클라이언트 ID 목록"""
        return list(self._clients.keys())

    async def connect(self, client_id: str | None = None) -> tuple[str, asyncio.Queue]:
        """
        새 클라이언트 연결.

        Args:
            client_id: 클라이언트 ID (없으면 자동 생성)

        Returns:
            (client_id, queue) 튜플
        """
        if client_id is None:
            client_id = str(uuid.uuid4())

        queue: asyncio.Queue = asyncio.Queue(maxsize=self._max_queue_size)

        async with self._lock:
            self._clients[client_id] = queue

        logger.info(
            "SSE client connected",
            client_id=client_id,
            total_clients=len(self._clients),
        )

        return client_id, queue

    async def disconnect(self, client_id: str) -> None:
        """클라이언트 연결 해제"""
        async with self._lock:
            if client_id in self._clients:
                del self._clients[client_id]
                logger.info(
                    "SSE client disconnected",
                    client_id=client_id,
                    total_clients=len(self._clients),
                )

    async def broadcast(self, event: SSEEvent) -> None:
        """
        모든 연결된 클라이언트에게 이벤트 브로드캐스트.

        Args:
            event: 전송할 SSE 이벤트
        """
        disconnected = []

        async with self._lock:
            for client_id, queue in self._clients.items():
                try:
                    queue.put_nowait(event)
                except asyncio.QueueFull:
                    logger.warning("SSE queue full", client_id=client_id)
                except Exception as e:
                    logger.warning(
                        "SSE broadcast error",
                        client_id=client_id,
                        error=str(e),
                    )
                    disconnected.append(client_id)

            # 연결 끊긴 클라이언트 제거
            for client_id in disconnected:
                del self._clients[client_id]

    async def send_agent_event(
        self,
        event_type: SSEEventType,
        task_id: str,
        url: str,
        message: str,
        **kwargs,
    ) -> None:
        """
        에이전트 이벤트 전송 헬퍼.

        Args:
            event_type: 이벤트 타입
            task_id: 태스크 ID
            url: 관련 URL
            message: 메시지
            **kwargs: 추가 데이터
        """
        event = SSEEvent(
            type=event_type,
            data={
                "task_id": task_id,
                "url": url,
                "message": message,
                **kwargs,
            },
        )
        await self.broadcast(event)


async def sse_event_generator(
    client_id: str,
    queue: asyncio.Queue,
    manager: SSEManager,
    heartbeat_interval: float = 30.0,
):
    """
    SSE 이벤트 스트림 생성기.

    Args:
        client_id: 클라이언트 ID
        queue: 이벤트 큐
        manager: SSE 매니저
        heartbeat_interval: 하트비트 간격 (초)

    Yields:
        SSE 형식의 이벤트 문자열
    """
    try:
        # 연결 확인 이벤트
        connected_event = SSEEvent(
            type=SSEEventType.CONNECTED,
            data={
                "client_id": client_id,
                "message": "Autonomous Crawler SSE connected",
                "active_clients": manager.client_count,
            },
        )
        yield f"event: {connected_event.type.value}\ndata: {json.dumps(connected_event.model_dump())}\n\n"

        while True:
            try:
                # 하트비트 타임아웃으로 이벤트 대기
                event = await asyncio.wait_for(queue.get(), timeout=heartbeat_interval)
                yield f"event: {event.type.value}\ndata: {json.dumps(event.model_dump())}\n\n"
            except asyncio.TimeoutError:
                # Heartbeat 전송
                yield ": heartbeat\n\n"

    except asyncio.CancelledError:
        logger.info("SSE client stream cancelled", client_id=client_id)
    finally:
        await manager.disconnect(client_id)


# 싱글톤 인스턴스
_sse_manager: SSEManager | None = None


def get_sse_manager() -> SSEManager:
    """싱글톤 SSE 매니저 인스턴스 반환"""
    global _sse_manager
    if _sse_manager is None:
        _sse_manager = SSEManager()
    return _sse_manager
