"""
Camoufox Firefox-based Anti-Detect Browser Integration.

Camoufox is a Firefox-based anti-detect browser that provides:
- Advanced fingerprint spoofing
- Human-like behavior simulation
- Cloudflare Turnstile bypass
- Compatible with Playwright API

Installation:
    pip install camoufox[geoip]
    python -m camoufox fetch
"""

import asyncio
from dataclasses import dataclass, field
from typing import Any

import structlog

logger = structlog.get_logger(__name__)


@dataclass
class CamoufoxConfig:
    """Configuration for Camoufox browser."""
    
    # Display mode
    headless: bool = True
    
    # Human-like behavior simulation
    humanize: bool = True
    humanize_level: int = 2  # 1-3, higher = more human-like
    
    # Fingerprint options
    os: str | None = None  # "windows", "macos", "linux" or None for random
    screen_width: int | None = None
    screen_height: int | None = None
    
    # Locale/timezone
    locale: str = "ko-KR"
    timezone: str = "Asia/Seoul"
    
    # Geolocation (requires geoip addon)
    geoip: bool = True
    
    # Proxy
    proxy: str | None = None
    
    # Browser settings
    block_images: bool = False
    block_webrtc: bool = True
    
    # Extra Firefox preferences
    firefox_prefs: dict[str, Any] = field(default_factory=dict)


def is_camoufox_available() -> bool:
    """Check if Camoufox is installed and available."""
    try:
        import camoufox
        return True
    except ImportError:
        return False


async def create_camoufox_browser(
    config: CamoufoxConfig | None = None,
) -> Any:
    """
    Create a Camoufox browser instance using async API.
    
    Args:
        config: Camoufox configuration
        
    Returns:
        Browser context or None if not available
    """
    if config is None:
        config = CamoufoxConfig()
    
    if not is_camoufox_available():
        logger.warning("Camoufox not installed. Install with: pip install camoufox[geoip]")
        return None
    
    try:
        from camoufox.async_api import AsyncCamoufox
        
        # Build kwargs
        kwargs = {
            "headless": config.headless,
            "humanize": config.humanize,
        }
        
        if config.os:
            kwargs["os"] = config.os
        
        if config.screen_width and config.screen_height:
            kwargs["screen"] = {"width": config.screen_width, "height": config.screen_height}
        
        if config.locale:
            kwargs["locale"] = config.locale
            
        if config.timezone:
            kwargs["timezone"] = config.timezone
        
        if config.geoip:
            kwargs["geoip"] = True
        
        if config.proxy:
            kwargs["proxy"] = {"server": config.proxy}
        
        if config.block_webrtc:
            kwargs["block_webrtc"] = True
        
        if config.block_images:
            kwargs["block_images"] = True
        
        # Apply extra Firefox preferences
        if config.firefox_prefs:
            kwargs["firefox_prefs"] = config.firefox_prefs
        
        # Create browser
        camoufox = AsyncCamoufox(**kwargs)
        browser = await camoufox.__aenter__()
        
        logger.info("Created Camoufox browser", headless=config.headless, humanize=config.humanize)
        return browser
        
    except Exception as e:
        logger.error("Failed to create Camoufox browser", error=str(e))
        return None


def create_camoufox_browser_sync(
    config: CamoufoxConfig | None = None,
) -> Any:
    """
    Create a Camoufox browser instance using sync API.
    
    Args:
        config: Camoufox configuration
        
    Returns:
        Browser context or None if not available
    """
    if config is None:
        config = CamoufoxConfig()
    
    if not is_camoufox_available():
        logger.warning("Camoufox not installed")
        return None
    
    try:
        from camoufox.sync_api import Camoufox
        
        kwargs = {
            "headless": config.headless,
            "humanize": config.humanize,
        }
        
        if config.os:
            kwargs["os"] = config.os
        
        if config.locale:
            kwargs["locale"] = config.locale
            
        if config.timezone:
            kwargs["timezone"] = config.timezone
        
        if config.geoip:
            kwargs["geoip"] = True
        
        if config.proxy:
            kwargs["proxy"] = {"server": config.proxy}
        
        if config.block_webrtc:
            kwargs["block_webrtc"] = True
        
        camoufox = Camoufox(**kwargs)
        browser = camoufox.__enter__()
        
        logger.info("Created Camoufox browser (sync)", headless=config.headless)
        return browser
        
    except Exception as e:
        logger.error("Failed to create Camoufox browser", error=str(e))
        return None


class CamoufoxHelper:
    """Helper utilities for Camoufox browser automation."""
    
    @staticmethod
    async def wait_for_cloudflare(page: Any, timeout: int = 30) -> bool:
        """
        Wait for Cloudflare challenge to complete.
        
        Camoufox handles Cloudflare automatically in most cases,
        but this provides explicit waiting if needed.
        
        Args:
            page: Camoufox page object
            timeout: Maximum wait time in seconds
            
        Returns:
            True if challenge passed, False if timeout
        """
        try:
            # Common Cloudflare challenge indicators
            challenge_selectors = [
                "#challenge-running",
                "#challenge-stage",
                ".cf-browser-verification",
                "#trk_jschal_js",
            ]
            
            start_time = asyncio.get_event_loop().time()
            
            while asyncio.get_event_loop().time() - start_time < timeout:
                # Check if any challenge elements are visible
                is_challenging = False
                
                for selector in challenge_selectors:
                    try:
                        element = await page.query_selector(selector)
                        if element:
                            is_visible = await element.is_visible()
                            if is_visible:
                                is_challenging = True
                                break
                    except Exception:
                        continue
                
                if not is_challenging:
                    # No challenge visible, likely passed
                    logger.debug("Cloudflare challenge completed")
                    return True
                
                await asyncio.sleep(0.5)
            
            logger.warning("Cloudflare challenge timeout")
            return False
            
        except Exception as e:
            logger.error("Error waiting for Cloudflare", error=str(e))
            return False
    
    @staticmethod
    async def solve_turnstile(page: Any, timeout: int = 30) -> bool:
        """
        Wait for Cloudflare Turnstile CAPTCHA to complete.
        
        Camoufox with humanize=True should handle most Turnstile
        challenges automatically.
        
        Args:
            page: Camoufox page object
            timeout: Maximum wait time in seconds
            
        Returns:
            True if solved, False if timeout
        """
        try:
            turnstile_selectors = [
                "iframe[src*='turnstile']",
                "#cf-turnstile",
                ".cf-turnstile",
            ]
            
            start_time = asyncio.get_event_loop().time()
            
            # First, wait for turnstile to appear
            turnstile_frame = None
            while asyncio.get_event_loop().time() - start_time < timeout / 2:
                for selector in turnstile_selectors:
                    try:
                        element = await page.query_selector(selector)
                        if element:
                            turnstile_frame = element
                            break
                    except Exception:
                        continue
                
                if turnstile_frame:
                    break
                    
                await asyncio.sleep(0.3)
            
            if not turnstile_frame:
                # No turnstile found, may not be needed
                logger.debug("No Turnstile CAPTCHA found")
                return True
            
            logger.debug("Turnstile CAPTCHA detected, waiting for auto-solve...")
            
            # Wait for turnstile to complete (it should auto-solve with humanize)
            # Check for success indicator or turnstile disappearing
            while asyncio.get_event_loop().time() - start_time < timeout:
                # Check if turnstile is still visible
                try:
                    is_visible = await turnstile_frame.is_visible()
                    if not is_visible:
                        logger.info("Turnstile CAPTCHA solved")
                        return True
                except Exception:
                    # Element may have been removed
                    return True
                
                # Check for success response in page
                try:
                    response = await page.evaluate("""
                        () => {
                            const input = document.querySelector('[name="cf-turnstile-response"]');
                            return input ? input.value : null;
                        }
                    """)
                    if response:
                        logger.info("Turnstile response received")
                        return True
                except Exception:
                    pass
                
                await asyncio.sleep(0.5)
            
            logger.warning("Turnstile solve timeout")
            return False
            
        except Exception as e:
            logger.error("Error solving Turnstile", error=str(e))
            return False
    
    @staticmethod
    async def extract_page_content(page: Any) -> dict[str, Any]:
        """
        Extract main content from a page.
        
        Args:
            page: Camoufox page object
            
        Returns:
            Dictionary with extracted content
        """
        try:
            content = await page.evaluate("""
                () => {
                    const result = {
                        title: document.title,
                        url: window.location.href,
                        text: '',
                        links: [],
                        images: [],
                    };
                    
                    // Get main text content
                    const article = document.querySelector('article') || 
                                   document.querySelector('main') || 
                                   document.body;
                    
                    if (article) {
                        result.text = article.innerText;
                    }
                    
                    // Get links
                    const links = document.querySelectorAll('a[href]');
                    links.forEach(link => {
                        if (link.href && link.href.startsWith('http')) {
                            result.links.push({
                                href: link.href,
                                text: link.innerText.trim().substring(0, 200)
                            });
                        }
                    });
                    
                    // Get images
                    const images = document.querySelectorAll('img[src]');
                    images.forEach(img => {
                        if (img.src && img.src.startsWith('http')) {
                            result.images.push({
                                src: img.src,
                                alt: img.alt || ''
                            });
                        }
                    });
                    
                    return result;
                }
            """)
            
            return content
            
        except Exception as e:
            logger.error("Failed to extract page content", error=str(e))
            return {"error": str(e)}


# Firefox-specific preferences for anti-detection
FIREFOX_ANTI_DETECT_PREFS = {
    # Disable WebRTC IP leak
    "media.peerconnection.enabled": False,
    "media.peerconnection.ice.no_host": True,
    "media.peerconnection.ice.default_address_only": True,
    
    # Disable tracking
    "privacy.trackingprotection.enabled": True,
    "privacy.trackingprotection.socialtracking.enabled": True,
    
    # Fingerprint resistance
    "privacy.resistFingerprinting": False,  # Camoufox handles this
    
    # Disable telemetry
    "toolkit.telemetry.enabled": False,
    "toolkit.telemetry.unified": False,
    "toolkit.telemetry.archive.enabled": False,
    
    # Disable crash reporter
    "breakpad.reportURL": "",
    "browser.crashReports.unsubmittedCheck.autoSubmit2": False,
    
    # Disable prefetch
    "network.prefetch-next": False,
    "network.dns.disablePrefetch": True,
    
    # Disable speculative connections
    "network.http.speculative-parallel-limit": 0,
    
    # Improve privacy
    "dom.battery.enabled": False,
    "geo.enabled": False,
    "media.navigator.enabled": False,
    
    # Performance
    "browser.cache.disk.enable": False,
    "browser.cache.memory.enable": True,
}


def get_recommended_camoufox_config(
    purpose: str = "general",
    headless: bool = True,
) -> CamoufoxConfig:
    """
    Get recommended Camoufox configuration for different purposes.
    
    Args:
        purpose: "general", "scraping", "turnstile", "cloudflare"
        headless: Whether to run headless
        
    Returns:
        Optimized CamoufoxConfig
    """
    base_config = CamoufoxConfig(
        headless=headless,
        humanize=True,
        humanize_level=2,
        locale="ko-KR",
        timezone="Asia/Seoul",
        geoip=True,
        block_webrtc=True,
    )
    
    if purpose == "scraping":
        base_config.block_images = True
        base_config.humanize_level = 1
    
    elif purpose == "turnstile":
        base_config.humanize_level = 3
        base_config.block_images = False
    
    elif purpose == "cloudflare":
        base_config.humanize_level = 3
        base_config.block_images = False
        base_config.firefox_prefs = FIREFOX_ANTI_DETECT_PREFS
    
    return base_config
