"""Stealth browser configuration for bot detection bypass."""

from dataclasses import dataclass, field
from typing import Any

import structlog

logger = structlog.get_logger(__name__)


@dataclass
class StealthConfig:
    """Configuration for stealth browser mode."""
    
    # User agent rotation
    user_agents: list[str] = field(default_factory=lambda: [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
    ])
    
    # Viewport sizes (common resolutions)
    viewports: list[dict[str, int]] = field(default_factory=lambda: [
        {"width": 1920, "height": 1080},
        {"width": 1366, "height": 768},
        {"width": 1536, "height": 864},
        {"width": 1440, "height": 900},
    ])
    
    # Timezone/locale
    timezone: str = "Asia/Seoul"
    locale: str = "ko-KR"
    
    # Extra args for Chromium
    extra_args: list[str] = field(default_factory=lambda: [
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
        "--hide-scrollbars",
        "--mute-audio",
    ])
    
    # Webdriver navigator override
    hide_webdriver: bool = True
    
    # Random delays (ms)
    min_delay: int = 100
    max_delay: int = 500


def apply_stealth_to_playwright(page: Any, config: StealthConfig | None = None) -> None:
    """
    Apply stealth settings to a Playwright page.
    
    Uses playwright_stealth if available, otherwise applies manual patches.
    """
    if config is None:
        config = StealthConfig()
    
    try:
        from playwright_stealth import stealth_sync
        stealth_sync(page)
        logger.debug("Applied playwright_stealth")
    except ImportError:
        logger.warning("playwright_stealth not available, using manual patches")
        _apply_manual_stealth(page, config)


async def apply_stealth_to_playwright_async(page: Any, config: StealthConfig | None = None) -> None:
    """Async version of stealth application."""
    if config is None:
        config = StealthConfig()
    
    try:
        from playwright_stealth import stealth_async
        await stealth_async(page)
        logger.debug("Applied playwright_stealth (async)")
    except ImportError:
        logger.warning("playwright_stealth not available, using manual patches")
        await _apply_manual_stealth_async(page, config)


def _apply_manual_stealth(page: Any, config: StealthConfig) -> None:
    """Apply manual stealth patches."""
    # Hide webdriver
    if config.hide_webdriver:
        page.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
        """)
    
    # Override navigator properties
    page.add_init_script("""
        // Override plugins
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5]
        });
        
        // Override languages
        Object.defineProperty(navigator, 'languages', {
            get: () => ['ko-KR', 'ko', 'en-US', 'en']
        });
        
        // Override platform
        Object.defineProperty(navigator, 'platform', {
            get: () => 'Win32'
        });
        
        // Chrome runtime
        window.chrome = {
            runtime: {}
        };
        
        // Permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
                Promise.resolve({ state: Notification.permission }) :
                originalQuery(parameters)
        );
    """)


async def _apply_manual_stealth_async(page: Any, config: StealthConfig) -> None:
    """Apply manual stealth patches (async)."""
    # Same as sync but using await
    if config.hide_webdriver:
        await page.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
        """)
    
    await page.add_init_script("""
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5]
        });
        
        Object.defineProperty(navigator, 'languages', {
            get: () => ['ko-KR', 'ko', 'en-US', 'en']
        });
        
        Object.defineProperty(navigator, 'platform', {
            get: () => 'Win32'
        });
        
        window.chrome = { runtime: {} };
        
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
                Promise.resolve({ state: Notification.permission }) :
                originalQuery(parameters)
        );
    """)


def get_undetected_browser_args() -> list[str]:
    """Get Chrome args for undetected browsing."""
    return [
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
        "--disable-infobars",
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-breakpad",
        "--disable-component-extensions-with-background-pages",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-extensions",
        "--disable-hang-monitor",
        "--disable-ipc-flooding-protection",
        "--disable-popup-blocking",
        "--disable-prompt-on-repost",
        "--disable-renderer-backgrounding",
        "--disable-sync",
        "--enable-features=NetworkService,NetworkServiceInProcess",
        "--force-color-profile=srgb",
        "--metrics-recording-only",
        "--no-first-run",
        "--password-store=basic",
        "--use-mock-keychain",
        "--ignore-certificate-errors",
    ]
