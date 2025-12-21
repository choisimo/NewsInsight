"""
Paid CAPTCHA Solver Integrations.

Integrates with reliable paid CAPTCHA solving services:
- CapSolver (https://capsolver.com) - Recommended, supports Turnstile
- 2Captcha (https://2captcha.com) - Widely used, reliable

These services are more reliable than free solutions for:
- reCAPTCHA v2/v3
- hCaptcha
- Cloudflare Turnstile
- FunCAPTCHA
- Image CAPTCHAs
"""

import asyncio
import time
from dataclasses import dataclass
from typing import Any, Literal

import httpx
import structlog

from src.captcha import CaptchaType, CaptchaSolution, CaptchaSolver

logger = structlog.get_logger(__name__)


# ─────────────────────────────────────────────
# CapSolver Integration
# ─────────────────────────────────────────────


@dataclass
class CapSolverConfig:
    """CapSolver configuration."""

    api_key: str = ""
    base_url: str = "https://api.capsolver.com"
    timeout: float = 120.0
    poll_interval: float = 3.0


class CapSolverClient(CaptchaSolver):
    """
    CapSolver CAPTCHA solving service client.

    Supports:
    - reCAPTCHA v2/v3
    - hCaptcha
    - Cloudflare Turnstile
    - FunCAPTCHA
    - Image CAPTCHA

    Docs: https://docs.capsolver.com/
    """

    def __init__(self, config: CapSolverConfig | None = None):
        self.config = config or CapSolverConfig()
        self._client: httpx.AsyncClient | None = None

    @property
    def name(self) -> str:
        return "capsolver"

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.config.base_url,
                timeout=self.config.timeout,
            )
        return self._client

    async def health_check(self) -> bool:
        """Check if CapSolver API is available and key is valid."""
        if not self.config.api_key:
            return False

        try:
            client = await self._get_client()
            resp = await client.post(
                "/getBalance",
                json={"clientKey": self.config.api_key},
            )
            data = resp.json()
            if data.get("errorId") == 0:
                balance = data.get("balance", 0)
                logger.debug("CapSolver balance check", balance=balance)
                return balance > 0
            return False
        except Exception as e:
            logger.debug("CapSolver health check failed", error=str(e))
            return False

    async def solve(
        self,
        captcha_type: CaptchaType,
        site_key: str | None = None,
        site_url: str | None = None,
        page: Any = None,
        **kwargs,
    ) -> CaptchaSolution:
        """
        Solve CAPTCHA using CapSolver API.

        Args:
            captcha_type: Type of CAPTCHA
            site_key: Site key for reCAPTCHA/hCaptcha
            site_url: URL of the page with CAPTCHA
            page: Playwright page (for extracting site_key if not provided)
        """
        start_time = time.time()

        if not self.config.api_key:
            return CaptchaSolution(
                success=False,
                error="CapSolver API key not configured",
                solver_used=self.name,
            )

        try:
            # Extract site_key from page if not provided
            if not site_key and page:
                site_key = await self._extract_site_key(page, captcha_type)
                site_url = page.url

            if not site_key:
                return CaptchaSolution(
                    success=False,
                    error="Site key not provided or could not be extracted",
                    solver_used=self.name,
                )

            # Map CAPTCHA type to CapSolver task type
            task_type = self._get_task_type(captcha_type)
            if not task_type:
                return CaptchaSolution(
                    success=False,
                    error=f"Unsupported CAPTCHA type: {captcha_type}",
                    solver_used=self.name,
                )

            # Create task
            task_data = {
                "type": task_type,
                "websiteURL": site_url,
                "websiteKey": site_key,
            }

            # Add type-specific parameters
            if captcha_type == CaptchaType.RECAPTCHA_V3:
                task_data["pageAction"] = kwargs.get("action", "verify")
                task_data["minScore"] = kwargs.get("min_score", 0.7)

            client = await self._get_client()

            # Create task
            create_resp = await client.post(
                "/createTask",
                json={
                    "clientKey": self.config.api_key,
                    "task": task_data,
                },
            )
            create_data = create_resp.json()

            if create_data.get("errorId") != 0:
                return CaptchaSolution(
                    success=False,
                    error=create_data.get("errorDescription", "Unknown error"),
                    solver_used=self.name,
                    time_ms=(time.time() - start_time) * 1000,
                )

            task_id = create_data.get("taskId")
            if not task_id:
                return CaptchaSolution(
                    success=False,
                    error="No task ID returned",
                    solver_used=self.name,
                    time_ms=(time.time() - start_time) * 1000,
                )

            # Poll for result
            token = await self._poll_result(task_id)

            if token:
                return CaptchaSolution(
                    success=True,
                    token=token,
                    solver_used=self.name,
                    time_ms=(time.time() - start_time) * 1000,
                )
            else:
                return CaptchaSolution(
                    success=False,
                    error="Failed to get solution within timeout",
                    solver_used=self.name,
                    time_ms=(time.time() - start_time) * 1000,
                )

        except Exception as e:
            logger.error("CapSolver error", error=str(e))
            return CaptchaSolution(
                success=False,
                error=str(e),
                solver_used=self.name,
                time_ms=(time.time() - start_time) * 1000,
            )

    async def _poll_result(self, task_id: str) -> str | None:
        """Poll for task result."""
        client = await self._get_client()
        max_attempts = int(self.config.timeout / self.config.poll_interval)

        for _ in range(max_attempts):
            await asyncio.sleep(self.config.poll_interval)

            resp = await client.post(
                "/getTaskResult",
                json={
                    "clientKey": self.config.api_key,
                    "taskId": task_id,
                },
            )
            data = resp.json()

            if data.get("errorId") != 0:
                logger.warning("CapSolver poll error", error=data.get("errorDescription"))
                return None

            status = data.get("status")
            if status == "ready":
                solution = data.get("solution", {})
                # Different CAPTCHA types return token in different fields
                return (
                    solution.get("gRecaptchaResponse")
                    or solution.get("token")
                    or solution.get("text")
                )
            elif status == "failed":
                logger.warning("CapSolver task failed", data=data)
                return None

        return None

    def _get_task_type(self, captcha_type: CaptchaType) -> str | None:
        """Map CaptchaType to CapSolver task type."""
        mapping = {
            CaptchaType.RECAPTCHA_V2: "ReCaptchaV2TaskProxyLess",
            CaptchaType.RECAPTCHA_V3: "ReCaptchaV3TaskProxyLess",
            CaptchaType.HCAPTCHA: "HCaptchaTaskProxyLess",
            CaptchaType.CLOUDFLARE: "AntiTurnstileTaskProxyLess",
        }
        return mapping.get(captcha_type)

    async def _extract_site_key(self, page: Any, captcha_type: CaptchaType) -> str | None:
        """Extract site key from page."""
        try:
            if captcha_type in (CaptchaType.RECAPTCHA_V2, CaptchaType.RECAPTCHA_V3):
                # reCAPTCHA site key extraction
                selectors = [
                    '[data-sitekey]',
                    '.g-recaptcha[data-sitekey]',
                    '#recaptcha[data-sitekey]',
                ]
                for selector in selectors:
                    element = await page.query_selector(selector)
                    if element:
                        return await element.get_attribute("data-sitekey")

                # Try script-based extraction
                site_key = await page.evaluate("""
                    () => {
                        const scripts = document.querySelectorAll('script');
                        for (const script of scripts) {
                            const match = script.src?.match(/render=([^&]+)/);
                            if (match) return match[1];
                        }
                        return window.___grecaptcha_cfg?.clients?.[0]?.N?.sitekey || null;
                    }
                """)
                if site_key:
                    return site_key

            elif captcha_type == CaptchaType.HCAPTCHA:
                element = await page.query_selector('[data-sitekey], .h-captcha[data-sitekey]')
                if element:
                    return await element.get_attribute("data-sitekey")

            elif captcha_type == CaptchaType.CLOUDFLARE:
                # Turnstile site key
                element = await page.query_selector('[data-sitekey], .cf-turnstile[data-sitekey]')
                if element:
                    return await element.get_attribute("data-sitekey")

        except Exception as e:
            logger.debug("Failed to extract site key", error=str(e))

        return None


# ─────────────────────────────────────────────
# 2Captcha Integration
# ─────────────────────────────────────────────


@dataclass
class TwoCaptchaConfig:
    """2Captcha configuration."""

    api_key: str = ""
    base_url: str = "https://2captcha.com"
    timeout: float = 120.0
    poll_interval: float = 5.0


class TwoCaptchaClient(CaptchaSolver):
    """
    2Captcha CAPTCHA solving service client.

    Supports:
    - reCAPTCHA v2/v3
    - hCaptcha
    - Cloudflare Turnstile
    - FunCAPTCHA
    - Image CAPTCHA

    Docs: https://2captcha.com/api-docs
    """

    def __init__(self, config: TwoCaptchaConfig | None = None):
        self.config = config or TwoCaptchaConfig()

    @property
    def name(self) -> str:
        return "2captcha"

    async def health_check(self) -> bool:
        """Check if 2Captcha API is available and key is valid."""
        if not self.config.api_key:
            return False

        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{self.config.base_url}/res.php",
                    params={
                        "key": self.config.api_key,
                        "action": "getbalance",
                        "json": 1,
                    },
                )
                data = resp.json()
                if data.get("status") == 1:
                    balance = float(data.get("request", 0))
                    logger.debug("2Captcha balance check", balance=balance)
                    return balance > 0
                return False
        except Exception as e:
            logger.debug("2Captcha health check failed", error=str(e))
            return False

    async def solve(
        self,
        captcha_type: CaptchaType,
        site_key: str | None = None,
        site_url: str | None = None,
        page: Any = None,
        **kwargs,
    ) -> CaptchaSolution:
        """
        Solve CAPTCHA using 2Captcha API.

        Args:
            captcha_type: Type of CAPTCHA
            site_key: Site key for reCAPTCHA/hCaptcha
            site_url: URL of the page with CAPTCHA
            page: Playwright page (for extracting site_key if not provided)
        """
        start_time = time.time()

        if not self.config.api_key:
            return CaptchaSolution(
                success=False,
                error="2Captcha API key not configured",
                solver_used=self.name,
            )

        try:
            # Extract site_key from page if not provided
            if not site_key and page:
                site_key = await self._extract_site_key(page, captcha_type)
                site_url = page.url

            if not site_key:
                return CaptchaSolution(
                    success=False,
                    error="Site key not provided or could not be extracted",
                    solver_used=self.name,
                )

            # Build request parameters
            params = {
                "key": self.config.api_key,
                "json": 1,
                "pageurl": site_url,
            }

            # Add type-specific parameters
            if captcha_type in (CaptchaType.RECAPTCHA_V2, CaptchaType.RECAPTCHA_V3):
                params["method"] = "userrecaptcha"
                params["googlekey"] = site_key
                if captcha_type == CaptchaType.RECAPTCHA_V3:
                    params["version"] = "v3"
                    params["action"] = kwargs.get("action", "verify")
                    params["min_score"] = kwargs.get("min_score", 0.7)

            elif captcha_type == CaptchaType.HCAPTCHA:
                params["method"] = "hcaptcha"
                params["sitekey"] = site_key

            elif captcha_type == CaptchaType.CLOUDFLARE:
                params["method"] = "turnstile"
                params["sitekey"] = site_key

            else:
                return CaptchaSolution(
                    success=False,
                    error=f"Unsupported CAPTCHA type: {captcha_type}",
                    solver_used=self.name,
                )

            async with httpx.AsyncClient(timeout=self.config.timeout) as client:
                # Submit task
                submit_resp = await client.get(
                    f"{self.config.base_url}/in.php",
                    params=params,
                )
                submit_data = submit_resp.json()

                if submit_data.get("status") != 1:
                    return CaptchaSolution(
                        success=False,
                        error=submit_data.get("request", "Unknown error"),
                        solver_used=self.name,
                        time_ms=(time.time() - start_time) * 1000,
                    )

                task_id = submit_data.get("request")

                # Poll for result
                token = await self._poll_result(client, task_id)

                if token:
                    return CaptchaSolution(
                        success=True,
                        token=token,
                        solver_used=self.name,
                        time_ms=(time.time() - start_time) * 1000,
                    )
                else:
                    return CaptchaSolution(
                        success=False,
                        error="Failed to get solution within timeout",
                        solver_used=self.name,
                        time_ms=(time.time() - start_time) * 1000,
                    )

        except Exception as e:
            logger.error("2Captcha error", error=str(e))
            return CaptchaSolution(
                success=False,
                error=str(e),
                solver_used=self.name,
                time_ms=(time.time() - start_time) * 1000,
            )

    async def _poll_result(self, client: httpx.AsyncClient, task_id: str) -> str | None:
        """Poll for task result."""
        max_attempts = int(self.config.timeout / self.config.poll_interval)

        for _ in range(max_attempts):
            await asyncio.sleep(self.config.poll_interval)

            resp = await client.get(
                f"{self.config.base_url}/res.php",
                params={
                    "key": self.config.api_key,
                    "action": "get",
                    "id": task_id,
                    "json": 1,
                },
            )
            data = resp.json()

            if data.get("status") == 1:
                return data.get("request")
            elif data.get("request") == "CAPCHA_NOT_READY":
                continue
            else:
                logger.warning("2Captcha poll error", error=data.get("request"))
                return None

        return None

    async def _extract_site_key(self, page: Any, captcha_type: CaptchaType) -> str | None:
        """Extract site key from page (same logic as CapSolver)."""
        try:
            if captcha_type in (CaptchaType.RECAPTCHA_V2, CaptchaType.RECAPTCHA_V3):
                selectors = [
                    '[data-sitekey]',
                    '.g-recaptcha[data-sitekey]',
                    '#recaptcha[data-sitekey]',
                ]
                for selector in selectors:
                    element = await page.query_selector(selector)
                    if element:
                        return await element.get_attribute("data-sitekey")

            elif captcha_type == CaptchaType.HCAPTCHA:
                element = await page.query_selector('[data-sitekey], .h-captcha[data-sitekey]')
                if element:
                    return await element.get_attribute("data-sitekey")

            elif captcha_type == CaptchaType.CLOUDFLARE:
                element = await page.query_selector('[data-sitekey], .cf-turnstile[data-sitekey]')
                if element:
                    return await element.get_attribute("data-sitekey")

        except Exception as e:
            logger.debug("Failed to extract site key", error=str(e))

        return None


# ─────────────────────────────────────────────
# Factory function
# ─────────────────────────────────────────────


def create_paid_solver(
    provider: Literal["capsolver", "2captcha"] = "capsolver",
    api_key: str = "",
) -> CaptchaSolver:
    """
    Create a paid CAPTCHA solver instance.

    Args:
        provider: Which service to use
        api_key: API key for the service

    Returns:
        CaptchaSolver instance
    """
    if provider == "capsolver":
        return CapSolverClient(CapSolverConfig(api_key=api_key))
    elif provider == "2captcha":
        return TwoCaptchaClient(TwoCaptchaConfig(api_key=api_key))
    else:
        raise ValueError(f"Unknown CAPTCHA solver provider: {provider}")
