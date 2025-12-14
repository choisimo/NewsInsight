"""
IP Rotation Proxy Client

Python client for the IP Rotation Go service.
Provides easy integration with crawlers and other services that need proxy rotation.

Usage:
    from shared.proxy_client import ProxyRotationClient

    # Initialize client
    client = ProxyRotationClient(base_url="http://ip-rotation:8050")

    # Get next proxy
    proxy = await client.get_next_proxy()
    if proxy:
        proxy_url = client.get_proxy_url(proxy)
        # Use proxy_url with httpx, aiohttp, etc.

    # Record success/failure
    await client.record_success(proxy.id, latency_ms=150)
    await client.record_failure(proxy.id, reason="Connection refused")
"""

import os
import logging
from typing import Optional, Dict, Any
from dataclasses import dataclass
from urllib.parse import urlparse

log = logging.getLogger(__name__)

# Try to import httpx, fallback to aiohttp if not available
try:
    import httpx

    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False
    log.warning("httpx not available, some features may be limited")


@dataclass
class ProxyInfo:
    """Proxy information returned from the rotation service."""

    id: str
    address: str
    protocol: str
    username: Optional[str] = None
    password: Optional[str] = None
    country: Optional[str] = None
    health_status: Optional[str] = None

    def get_proxy_url(self) -> str:
        """Get the full proxy URL with auth if available."""
        if self.username and self.password:
            parsed = urlparse(self.address)
            return f"{parsed.scheme}://{self.username}:{self.password}@{parsed.netloc}"
        return self.address

    def get_proxy_dict(self) -> Dict[str, str]:
        """Get proxy configuration for httpx/requests."""
        proxy_url = self.get_proxy_url()
        return {
            "http://": proxy_url,
            "https://": proxy_url,
        }


class ProxyRotationClient:
    """
    Client for the IP Rotation service.

    Provides methods to get rotating proxies and record their success/failure
    for adaptive load balancing.
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        timeout: float = 5.0,
        fallback_proxy: Optional[str] = None,
        enabled: bool = True,
    ):
        """
        Initialize the proxy rotation client.

        Args:
            base_url: Base URL of the IP rotation service (default: from env or http://ip-rotation:8050)
            timeout: Request timeout in seconds
            fallback_proxy: Fallback proxy URL if rotation service is unavailable
            enabled: Whether proxy rotation is enabled (can be disabled via env)
        """
        self.base_url = (
            base_url or os.getenv("PROXY_ROTATION_URL", "http://ip-rotation:8050")
        ).rstrip("/")
        self.timeout = timeout
        self.fallback_proxy = fallback_proxy or os.getenv("FALLBACK_PROXY_URL")
        self.enabled = (
            enabled and os.getenv("USE_PROXY_ROTATION", "true").lower() == "true"
        )
        self._client: Optional["httpx.AsyncClient"] = None

    async def _get_client(self) -> "httpx.AsyncClient":
        """Get or create the HTTP client."""
        if not HTTPX_AVAILABLE:
            raise ImportError("httpx is required for ProxyRotationClient")

        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client

    async def get_next_proxy(self) -> Optional[ProxyInfo]:
        """
        Get the next proxy from the rotation service.

        Returns:
            ProxyInfo object or None if no proxy is available
        """
        if not self.enabled:
            return None

        try:
            client = await self._get_client()
            resp = await client.get(f"{self.base_url}/proxy/next")

            if resp.status_code == 200:
                data = resp.json()
                if "error" not in data:
                    return ProxyInfo(
                        id=data.get("proxyId", ""),
                        address=data.get("address", ""),
                        protocol=data.get("protocol", "http"),
                        username=data.get("username"),
                        password=data.get("password"),
                        country=data.get("country"),
                        health_status=data.get("healthStatus"),
                    )
            elif resp.status_code == 503:
                log.warning("No proxies available from rotation service")

        except Exception as e:
            log.warning(f"Failed to get proxy from rotation service: {e}")

        # Fallback
        if self.fallback_proxy:
            return ProxyInfo(
                id="fallback",
                address=self.fallback_proxy,
                protocol="http",
            )
        return None

    async def record_success(self, proxy_id: str, latency_ms: int = 0) -> bool:
        """
        Record a successful request for a proxy.

        Args:
            proxy_id: The proxy ID
            latency_ms: Request latency in milliseconds

        Returns:
            True if recorded successfully
        """
        if not self.enabled or proxy_id == "fallback":
            return True

        try:
            client = await self._get_client()
            resp = await client.post(
                f"{self.base_url}/proxy/record",
                json={
                    "proxyId": proxy_id,
                    "success": True,
                    "latencyMs": latency_ms,
                },
            )
            return resp.status_code == 200
        except Exception as e:
            log.debug(f"Failed to record success: {e}")
            return False

    async def record_failure(self, proxy_id: str, reason: str = "") -> bool:
        """
        Record a failed request for a proxy.

        Args:
            proxy_id: The proxy ID
            reason: Failure reason

        Returns:
            True if recorded successfully
        """
        if not self.enabled or proxy_id == "fallback":
            return True

        try:
            client = await self._get_client()
            resp = await client.post(
                f"{self.base_url}/proxy/record",
                json={
                    "proxyId": proxy_id,
                    "success": False,
                    "reason": reason[:200],  # Truncate reason
                },
            )
            return resp.status_code == 200
        except Exception as e:
            log.debug(f"Failed to record failure: {e}")
            return False

    async def get_pool_stats(self) -> Optional[Dict[str, Any]]:
        """Get statistics about the proxy pool."""
        if not self.enabled:
            return None

        try:
            client = await self._get_client()
            resp = await client.get(f"{self.base_url}/admin/proxy-pool")
            if resp.status_code == 200:
                return resp.json()
        except Exception as e:
            log.debug(f"Failed to get pool stats: {e}")
        return None

    async def add_proxy(
        self,
        address: str,
        protocol: str = "http",
        username: Optional[str] = None,
        password: Optional[str] = None,
        country: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Add a new proxy to the pool.

        Args:
            address: Proxy address (e.g., "http://proxy.example.com:8080")
            protocol: Protocol (http, https, socks4, socks5)
            username: Optional authentication username
            password: Optional authentication password
            country: Optional country code

        Returns:
            Created proxy data or None on failure
        """
        if not self.enabled:
            return None

        try:
            client = await self._get_client()
            resp = await client.post(
                f"{self.base_url}/admin/proxy-pool",
                json={
                    "address": address,
                    "protocol": protocol,
                    "username": username or "",
                    "password": password or "",
                    "country": country or "",
                },
            )
            if resp.status_code == 201:
                return resp.json()
        except Exception as e:
            log.error(f"Failed to add proxy: {e}")
        return None

    async def health_check(self) -> bool:
        """Check if the rotation service is healthy."""
        try:
            client = await self._get_client()
            resp = await client.get(f"{self.base_url}/health", timeout=3.0)
            return resp.status_code == 200
        except Exception:
            return False

    async def close(self):
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()


# Synchronous wrapper for non-async code
class SyncProxyRotationClient:
    """
    Synchronous wrapper for ProxyRotationClient.

    For use in synchronous code that can't use async/await.
    Uses requests library instead of httpx.
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        timeout: float = 5.0,
        fallback_proxy: Optional[str] = None,
        enabled: bool = True,
    ):
        self.base_url = (
            base_url or os.getenv("PROXY_ROTATION_URL", "http://ip-rotation:8050")
        ).rstrip("/")
        self.timeout = timeout
        self.fallback_proxy = fallback_proxy or os.getenv("FALLBACK_PROXY_URL")
        self.enabled = (
            enabled and os.getenv("USE_PROXY_ROTATION", "true").lower() == "true"
        )

    def get_next_proxy(self) -> Optional[ProxyInfo]:
        """Get the next proxy from the rotation service."""
        if not self.enabled:
            return None

        try:
            import requests

            resp = requests.get(f"{self.base_url}/proxy/next", timeout=self.timeout)

            if resp.status_code == 200:
                data = resp.json()
                if "error" not in data:
                    return ProxyInfo(
                        id=data.get("proxyId", ""),
                        address=data.get("address", ""),
                        protocol=data.get("protocol", "http"),
                        username=data.get("username"),
                        password=data.get("password"),
                        country=data.get("country"),
                        health_status=data.get("healthStatus"),
                    )
        except Exception as e:
            log.warning(f"Failed to get proxy: {e}")

        if self.fallback_proxy:
            return ProxyInfo(
                id="fallback", address=self.fallback_proxy, protocol="http"
            )
        return None

    def record_success(self, proxy_id: str, latency_ms: int = 0) -> bool:
        """Record a successful request."""
        if not self.enabled or proxy_id == "fallback":
            return True

        try:
            import requests

            resp = requests.post(
                f"{self.base_url}/proxy/record",
                json={"proxyId": proxy_id, "success": True, "latencyMs": latency_ms},
                timeout=self.timeout,
            )
            return resp.status_code == 200
        except Exception:
            return False

    def record_failure(self, proxy_id: str, reason: str = "") -> bool:
        """Record a failed request."""
        if not self.enabled or proxy_id == "fallback":
            return True

        try:
            import requests

            resp = requests.post(
                f"{self.base_url}/proxy/record",
                json={"proxyId": proxy_id, "success": False, "reason": reason[:200]},
                timeout=self.timeout,
            )
            return resp.status_code == 200
        except Exception:
            return False


# Convenience function for one-off proxy fetching
async def get_rotating_proxy(
    base_url: Optional[str] = None,
) -> Optional[ProxyInfo]:
    """
    Convenience function to get a single rotating proxy.

    Usage:
        proxy = await get_rotating_proxy()
        if proxy:
            async with httpx.AsyncClient(proxy=proxy.get_proxy_url()) as client:
                resp = await client.get("https://example.com")
    """
    async with ProxyRotationClient(base_url=base_url) as client:
        return await client.get_next_proxy()
