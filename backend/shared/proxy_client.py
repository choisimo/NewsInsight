from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Optional

import httpx


@dataclass
class ProxyInfo:
    id: str
    address: str
    protocol: str = "http"
    username: Optional[str] = None
    password: Optional[str] = None
    country: Optional[str] = None
    health_status: Optional[str] = None

    def get_proxy_url(self) -> str:
        if self.username and self.password and "://" in self.address:
            scheme, rest = self.address.split("://", 1)
            return f"{scheme}://{self.username}:{self.password}@{rest}"
        return self.address


class ProxyRotationClient:
    def __init__(
        self,
        base_url: str,
        timeout: float = 5.0,
        enabled: bool = True,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._enabled = enabled
        self._client: Optional[httpx.AsyncClient] = None
        self._lock = asyncio.Lock()

    async def _get_client(self) -> httpx.AsyncClient:
        async with self._lock:
            if self._client is None:
                self._client = httpx.AsyncClient(timeout=self._timeout)
            return self._client

    async def close(self) -> None:
        async with self._lock:
            if self._client is not None:
                await self._client.aclose()
                self._client = None

    async def health_check(self) -> bool:
        if not self._enabled:
            return False
        client = await self._get_client()
        try:
            resp = await client.get(f"{self._base_url}/health")
            return resp.status_code == 200
        except Exception:
            return False

    async def get_next_proxy(self) -> Optional[ProxyInfo]:
        if not self._enabled:
            return None
        client = await self._get_client()
        try:
            resp = await client.get(f"{self._base_url}/proxy/next")
            if resp.status_code != 200:
                return None
            data: Any = resp.json()
            if not isinstance(data, dict):
                return None

            proxy_id = data.get("proxyId") or data.get("proxy_id") or data.get("id")
            address = data.get("address")
            if not proxy_id or not address:
                return None

            return ProxyInfo(
                id=str(proxy_id),
                address=str(address),
                protocol=str(data.get("protocol") or "http"),
                username=data.get("username"),
                password=data.get("password"),
                country=data.get("country"),
                health_status=data.get("healthStatus") or data.get("health_status"),
            )
        except Exception:
            return None

    async def record_success(self, proxy_id: str, latency_ms: int = 0) -> bool:
        return await self._record(proxy_id=proxy_id, success=True, latency_ms=latency_ms)

    async def record_failure(self, proxy_id: str, reason: str = "") -> bool:
        return await self._record(proxy_id=proxy_id, success=False, reason=reason)

    async def record_captcha(self, proxy_id: str, captcha_type: str = "") -> bool:
        if not self._enabled:
            return False
        client = await self._get_client()
        payload = {
            "proxyId": proxy_id,
            "type": captcha_type,
        }
        try:
            resp = await client.post(f"{self._base_url}/proxy/captcha", json=payload)
            return resp.status_code == 200
        except Exception:
            return False

    async def _record(
        self,
        proxy_id: str,
        success: bool,
        latency_ms: int = 0,
        reason: str = "",
    ) -> bool:
        if not self._enabled:
            return False
        client = await self._get_client()
        payload = {
            "proxyId": proxy_id,
            "success": bool(success),
            "latencyMs": int(latency_ms),
            "reason": reason,
        }
        try:
            resp = await client.post(f"{self._base_url}/proxy/record", json=payload)
            return resp.status_code == 200
        except Exception:
            return False

    async def get_pool_stats(self) -> Optional[dict[str, Any]]:
        if not self._enabled:
            return None
        client = await self._get_client()
        try:
            resp = await client.get(f"{self._base_url}/health")
            if resp.status_code != 200:
                return None
            data: Any = resp.json()
            if isinstance(data, dict):
                stats = data.get("stats")
                return stats if isinstance(stats, dict) else data
            return None
        except Exception:
            return None
