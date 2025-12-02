"""
NopeCHA CAPTCHA Solver Integration.

NopeCHA is a free/open-source CAPTCHA solving extension that supports:
- reCAPTCHA v2/v3
- hCaptcha
- FunCAPTCHA
- AWS WAF
- Turnstile
- Text CAPTCHA

Usage:
1. Browser extension (Chrome/Firefox)
2. API integration for headless automation
"""

import asyncio
import base64
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import aiohttp
import structlog

logger = structlog.get_logger(__name__)

# NopeCHA Chrome Extension ID
NOPECHA_EXTENSION_ID = "dknlfmjaanfblgfdfebhijalfmhmjjjo"
NOPECHA_CRX_URL = f"https://clients2.google.com/service/update2/crx?response=redirect&prodversion=133&acceptformat=crx3&x=id%3D{NOPECHA_EXTENSION_ID}%26uc"


@dataclass
class NopeCHAConfig:
    """NopeCHA configuration."""
    
    # API key (optional, for faster solving via API)
    api_key: str = ""
    
    # Extension settings
    enabled: bool = True
    auto_solve: bool = True
    
    # Solve settings
    solve_delay_ms: int = 500
    max_retries: int = 3
    
    # Supported CAPTCHA types
    solve_recaptcha: bool = True
    solve_hcaptcha: bool = True
    solve_funcaptcha: bool = True
    solve_turnstile: bool = True
    solve_text: bool = True
    
    # Audio solving for accessibility (free reCAPTCHA bypass)
    use_audio_challenge: bool = True
    
    # Extension cache directory
    cache_dir: Path = field(default_factory=lambda: Path("/tmp/nopecha-extension"))


class NopeCHAExtensionManager:
    """Manage NopeCHA extension installation and configuration."""
    
    def __init__(self, config: NopeCHAConfig | None = None):
        self.config = config or NopeCHAConfig()
    
    async def download_extension(self) -> Path:
        """Download NopeCHA extension CRX file."""
        cache_dir = self.config.cache_dir
        cache_dir.mkdir(parents=True, exist_ok=True)
        
        crx_path = cache_dir / f"{NOPECHA_EXTENSION_ID}.crx"
        ext_dir = cache_dir / NOPECHA_EXTENSION_ID
        
        # Check if already downloaded and extracted
        if ext_dir.exists() and (ext_dir / "manifest.json").exists():
            logger.debug("NopeCHA extension already cached", path=str(ext_dir))
            return ext_dir
        
        # Download CRX
        logger.info("Downloading NopeCHA extension...")
        async with aiohttp.ClientSession() as session:
            async with session.get(NOPECHA_CRX_URL, allow_redirects=True) as resp:
                if resp.status == 200:
                    content = await resp.read()
                    with open(crx_path, 'wb') as f:
                        f.write(content)
                    logger.info("NopeCHA extension downloaded", path=str(crx_path))
                else:
                    raise Exception(f"Failed to download NopeCHA: HTTP {resp.status}")
        
        # Extract CRX
        await self._extract_crx(crx_path, ext_dir)
        
        # Apply configuration
        await self._configure_extension(ext_dir)
        
        return ext_dir
    
    async def _extract_crx(self, crx_path: Path, extract_dir: Path) -> None:
        """Extract CRX file to directory."""
        import zipfile
        import shutil
        
        if extract_dir.exists():
            shutil.rmtree(extract_dir)
        extract_dir.mkdir(parents=True, exist_ok=True)
        
        try:
            with zipfile.ZipFile(crx_path, 'r') as zip_ref:
                zip_ref.extractall(extract_dir)
        except zipfile.BadZipFile:
            # CRX has a header, skip it
            with open(crx_path, 'rb') as f:
                magic = f.read(4)
                if magic != b'Cr24':
                    raise Exception("Invalid CRX format")
                
                version = int.from_bytes(f.read(4), 'little')
                if version == 2:
                    pubkey_len = int.from_bytes(f.read(4), 'little')
                    sig_len = int.from_bytes(f.read(4), 'little')
                    f.seek(16 + pubkey_len + sig_len)
                elif version == 3:
                    header_len = int.from_bytes(f.read(4), 'little')
                    f.seek(12 + header_len)
                
                zip_data = f.read()
            
            import tempfile
            with tempfile.NamedTemporaryFile(suffix='.zip', delete=False) as tmp:
                tmp.write(zip_data)
                tmp.flush()
                with zipfile.ZipFile(tmp.name, 'r') as zip_ref:
                    zip_ref.extractall(extract_dir)
                Path(tmp.name).unlink()
        
        logger.info("NopeCHA extension extracted", path=str(extract_dir))
    
    async def _configure_extension(self, ext_dir: Path) -> None:
        """Configure NopeCHA extension settings."""
        # Create settings file for extension
        settings = {
            "key": self.config.api_key,
            "enabled": self.config.enabled,
            "auto_solve": self.config.auto_solve,
            "delay": self.config.solve_delay_ms,
            "recaptcha": self.config.solve_recaptcha,
            "hcaptcha": self.config.solve_hcaptcha,
            "funcaptcha": self.config.solve_funcaptcha,
            "turnstile": self.config.solve_turnstile,
            "textcaptcha": self.config.solve_text,
            "audio": self.config.use_audio_challenge,
        }
        
        settings_path = ext_dir / "settings.json"
        with open(settings_path, 'w') as f:
            json.dump(settings, f)
        
        logger.debug("NopeCHA settings configured", settings=settings)
    
    def get_extension_path(self) -> str:
        """Get the path to the extracted extension directory."""
        ext_dir = self.config.cache_dir / NOPECHA_EXTENSION_ID
        if ext_dir.exists():
            return str(ext_dir)
        return ""


class NopeCHAAPI:
    """NopeCHA API client for programmatic CAPTCHA solving."""
    
    API_BASE = "https://api.nopecha.com"
    
    def __init__(self, api_key: str = ""):
        self.api_key = api_key
    
    async def solve_recaptcha(
        self,
        site_key: str,
        site_url: str,
        version: Literal["v2", "v3"] = "v2",
        action: str = "",
        invisible: bool = False,
    ) -> str | None:
        """
        Solve reCAPTCHA using NopeCHA API.
        
        Args:
            site_key: reCAPTCHA site key
            site_url: URL of the page with CAPTCHA
            version: reCAPTCHA version (v2 or v3)
            action: Action for v3 scoring
            invisible: Whether CAPTCHA is invisible
            
        Returns:
            Solution token or None if failed
        """
        if not self.api_key:
            logger.warning("NopeCHA API key not configured, using extension mode")
            return None
        
        payload = {
            "key": self.api_key,
            "type": "recaptcha2" if version == "v2" else "recaptcha3",
            "sitekey": site_key,
            "url": site_url,
        }
        
        if version == "v3" and action:
            payload["action"] = action
        if invisible:
            payload["invisible"] = True
        
        return await self._solve(payload)
    
    async def solve_hcaptcha(
        self,
        site_key: str,
        site_url: str,
    ) -> str | None:
        """Solve hCaptcha using NopeCHA API."""
        if not self.api_key:
            return None
        
        payload = {
            "key": self.api_key,
            "type": "hcaptcha",
            "sitekey": site_key,
            "url": site_url,
        }
        
        return await self._solve(payload)
    
    async def solve_turnstile(
        self,
        site_key: str,
        site_url: str,
    ) -> str | None:
        """Solve Cloudflare Turnstile using NopeCHA API."""
        if not self.api_key:
            return None
        
        payload = {
            "key": self.api_key,
            "type": "turnstile",
            "sitekey": site_key,
            "url": site_url,
        }
        
        return await self._solve(payload)
    
    async def solve_image_captcha(
        self,
        image_base64: str,
        captcha_type: str = "text",
    ) -> str | None:
        """Solve image-based CAPTCHA."""
        if not self.api_key:
            return None
        
        payload = {
            "key": self.api_key,
            "type": captcha_type,
            "image": image_base64,
        }
        
        return await self._solve(payload)
    
    async def _solve(self, payload: dict[str, Any]) -> str | None:
        """Send solve request to NopeCHA API."""
        try:
            async with aiohttp.ClientSession() as session:
                # Create task
                async with session.post(
                    f"{self.API_BASE}/",
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as resp:
                    result = await resp.json()
                    
                    if "error" in result:
                        logger.error("NopeCHA API error", error=result.get("error"))
                        return None
                    
                    task_id = result.get("data")
                    if not task_id:
                        return None
                
                # Poll for result
                for _ in range(60):  # Max 60 seconds
                    await asyncio.sleep(1)
                    
                    async with session.get(
                        f"{self.API_BASE}/?key={self.api_key}&id={task_id}",
                        timeout=aiohttp.ClientTimeout(total=10),
                    ) as poll_resp:
                        poll_result = await poll_resp.json()
                        
                        if "error" in poll_result:
                            error = poll_result.get("error")
                            if error == "Incomplete job":
                                continue
                            logger.error("NopeCHA polling error", error=error)
                            return None
                        
                        if "data" in poll_result:
                            return poll_result["data"]
                
                logger.warning("NopeCHA solve timeout")
                return None
                
        except Exception as e:
            logger.error("NopeCHA API request failed", error=str(e))
            return None


# Helper function for quick CAPTCHA solving
async def solve_captcha_with_nopecha(
    captcha_type: Literal["recaptcha2", "recaptcha3", "hcaptcha", "turnstile"],
    site_key: str,
    site_url: str,
    api_key: str = "",
) -> str | None:
    """
    Quick helper to solve CAPTCHA using NopeCHA.
    
    Args:
        captcha_type: Type of CAPTCHA
        site_key: CAPTCHA site key
        site_url: URL of the page
        api_key: NopeCHA API key (optional)
        
    Returns:
        Solution token or None
    """
    client = NopeCHAAPI(api_key)
    
    if captcha_type == "recaptcha2":
        return await client.solve_recaptcha(site_key, site_url, "v2")
    elif captcha_type == "recaptcha3":
        return await client.solve_recaptcha(site_key, site_url, "v3")
    elif captcha_type == "hcaptcha":
        return await client.solve_hcaptcha(site_key, site_url)
    elif captcha_type == "turnstile":
        return await client.solve_turnstile(site_key, site_url)
    
    return None
