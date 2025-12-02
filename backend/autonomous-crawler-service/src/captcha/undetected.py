"""
Undetected ChromeDriver Integration for Bot Detection Bypass.

This module provides:
1. Undetected ChromeDriver - Patched ChromeDriver that bypasses detection
2. Advanced Stealth - JavaScript patches to hide automation fingerprints
3. Human-like behavior simulation

Supports:
- Cloudflare
- PerimeterX
- DataDome
- Incapsula
- reCAPTCHA detection
"""

import asyncio
import os
import random
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger(__name__)


@dataclass
class UndetectedConfig:
    """Configuration for undetected browser mode."""
    
    # Driver settings
    driver_executable_path: str | None = None
    browser_executable_path: str | None = None
    
    # Version matching
    version_main: int | None = None  # Chrome major version
    
    # User data
    user_data_dir: str | None = None
    use_subprocess: bool = True
    
    # Stealth options
    enable_cdp_events: bool = True
    suppress_welcome: bool = True
    log_level: int = 0
    
    # Headless mode (use new headless mode)
    headless: bool = False
    use_new_headless: bool = True  # Chrome 109+ new headless mode
    
    # Window size
    window_size: tuple[int, int] = (1920, 1080)
    
    # Proxy
    proxy: str | None = None


def get_undetected_chromedriver():
    """
    Get an undetected ChromeDriver instance.
    
    Uses undetected-chromedriver library if available,
    otherwise falls back to manual patching.
    """
    try:
        import undetected_chromedriver as uc
        return uc
    except ImportError:
        logger.warning("undetected-chromedriver not installed, using manual patches")
        return None


async def create_undetected_driver(
    config: UndetectedConfig | None = None,
) -> Any:
    """
    Create an undetected ChromeDriver instance.
    
    Args:
        config: Configuration options
        
    Returns:
        Undetected ChromeDriver instance or None
    """
    if config is None:
        config = UndetectedConfig()
    
    uc = get_undetected_chromedriver()
    if uc is None:
        return None
    
    options = uc.ChromeOptions()
    
    # Basic options
    options.add_argument(f"--window-size={config.window_size[0]},{config.window_size[1]}")
    
    if config.headless:
        if config.use_new_headless:
            options.add_argument("--headless=new")
        else:
            options.add_argument("--headless")
    
    if config.proxy:
        options.add_argument(f"--proxy-server={config.proxy}")
    
    # Additional stealth arguments
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-infobars")
    
    # Create driver
    try:
        driver = uc.Chrome(
            options=options,
            driver_executable_path=config.driver_executable_path,
            browser_executable_path=config.browser_executable_path,
            version_main=config.version_main,
            user_data_dir=config.user_data_dir,
            use_subprocess=config.use_subprocess,
            enable_cdp_events=config.enable_cdp_events,
            suppress_welcome=config.suppress_welcome,
            log_level=config.log_level,
        )
        
        logger.info("Created undetected ChromeDriver")
        return driver
        
    except Exception as e:
        logger.error("Failed to create undetected ChromeDriver", error=str(e))
        return None


class AdvancedStealthPatcher:
    """
    Advanced JavaScript stealth patches for bot detection bypass.
    
    These patches are applied via CDP or page.evaluate to hide
    automation fingerprints that bot detection systems look for.
    """
    
    # Chrome properties patch
    CHROME_RUNTIME_PATCH = """
    (() => {
        // Add chrome.runtime if missing
        if (!window.chrome) {
            window.chrome = {};
        }
        if (!window.chrome.runtime) {
            window.chrome.runtime = {
                PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
                PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
                PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
                RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
                OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
                OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' }
            };
        }
        
        // Add chrome.csi if missing
        if (!window.chrome.csi) {
            window.chrome.csi = function() { return {}; };
        }
        
        // Add chrome.loadTimes if missing
        if (!window.chrome.loadTimes) {
            window.chrome.loadTimes = function() {
                return {
                    commitLoadTime: Date.now() / 1000,
                    connectionInfo: 'http/1.1',
                    finishDocumentLoadTime: Date.now() / 1000,
                    finishLoadTime: Date.now() / 1000,
                    firstPaintAfterLoadTime: 0,
                    firstPaintTime: Date.now() / 1000,
                    navigationType: 'Other',
                    npnNegotiatedProtocol: 'unknown',
                    requestTime: Date.now() / 1000,
                    startLoadTime: Date.now() / 1000,
                    wasAlternateProtocolAvailable: false,
                    wasFetchedViaSpdy: false,
                    wasNpnNegotiated: false
                };
            };
        }
    })();
    """
    
    # WebDriver property patch
    WEBDRIVER_PATCH = """
    (() => {
        // Remove webdriver property
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
            configurable: true
        });
        
        // Also patch the prototype
        const originalQuery = window.Navigator.prototype.hasOwnProperty;
        Object.defineProperty(Navigator.prototype, 'webdriver', {
            get: () => undefined,
            configurable: true
        });
        
        // Delete if exists
        delete navigator.webdriver;
    })();
    """
    
    # Plugins patch
    PLUGINS_PATCH = """
    (() => {
        // Mock plugins array
        const mockPlugins = [
            {
                name: 'Chrome PDF Plugin',
                filename: 'internal-pdf-viewer',
                description: 'Portable Document Format',
                length: 1,
                0: { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' }
            },
            {
                name: 'Chrome PDF Viewer',
                filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
                description: '',
                length: 1,
                0: { type: 'application/pdf', suffixes: 'pdf', description: '' }
            },
            {
                name: 'Native Client',
                filename: 'internal-nacl-plugin',
                description: '',
                length: 2,
                0: { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable' },
                1: { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client Executable' }
            }
        ];
        
        // Create a proper PluginArray
        const pluginArray = Object.create(PluginArray.prototype);
        mockPlugins.forEach((plugin, i) => {
            pluginArray[i] = plugin;
        });
        pluginArray.length = mockPlugins.length;
        
        // Patch namedItem and item methods
        pluginArray.item = function(index) { return this[index]; };
        pluginArray.namedItem = function(name) {
            return mockPlugins.find(p => p.name === name) || null;
        };
        pluginArray.refresh = function() {};
        
        Object.defineProperty(navigator, 'plugins', {
            get: () => pluginArray,
            configurable: true
        });
    })();
    """
    
    # Languages patch
    LANGUAGES_PATCH = """
    (() => {
        Object.defineProperty(navigator, 'languages', {
            get: () => ['ko-KR', 'ko', 'en-US', 'en'],
            configurable: true
        });
        
        Object.defineProperty(navigator, 'language', {
            get: () => 'ko-KR',
            configurable: true
        });
    })();
    """
    
    # Hardware concurrency patch
    HARDWARE_PATCH = """
    (() => {
        Object.defineProperty(navigator, 'hardwareConcurrency', {
            get: () => 8,
            configurable: true
        });
        
        Object.defineProperty(navigator, 'deviceMemory', {
            get: () => 8,
            configurable: true
        });
    })();
    """
    
    # Permissions patch
    PERMISSIONS_PATCH = """
    (() => {
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => {
            if (parameters.name === 'notifications') {
                return Promise.resolve({ state: Notification.permission });
            }
            return originalQuery.call(window.navigator.permissions, parameters);
        };
    })();
    """
    
    # WebGL vendor/renderer patch
    WEBGL_PATCH = """
    (() => {
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter) {
            // UNMASKED_VENDOR_WEBGL
            if (parameter === 37445) {
                return 'Intel Inc.';
            }
            // UNMASKED_RENDERER_WEBGL
            if (parameter === 37446) {
                return 'Intel Iris OpenGL Engine';
            }
            return getParameter.call(this, parameter);
        };
        
        // Also patch WebGL2
        if (typeof WebGL2RenderingContext !== 'undefined') {
            const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
            WebGL2RenderingContext.prototype.getParameter = function(parameter) {
                if (parameter === 37445) {
                    return 'Intel Inc.';
                }
                if (parameter === 37446) {
                    return 'Intel Iris OpenGL Engine';
                }
                return getParameter2.call(this, parameter);
            };
        }
    })();
    """
    
    # Iframe contentWindow patch
    IFRAME_PATCH = """
    (() => {
        // Prevent iframe detection
        try {
            if (window.top === window.self) {
                Object.defineProperty(window, 'frameElement', {
                    get: () => null,
                    configurable: true
                });
            }
        } catch (e) {}
    })();
    """
    
    # Console debug patch (hide console.debug modifications)
    CONSOLE_PATCH = """
    (() => {
        // Preserve original console methods
        const originalDebug = console.debug;
        console.debug = function(...args) {
            // Filter out automation-related debug messages
            const filtered = args.filter(arg => {
                if (typeof arg === 'string') {
                    const lower = arg.toLowerCase();
                    return !lower.includes('webdriver') && 
                           !lower.includes('automation') &&
                           !lower.includes('puppeteer') &&
                           !lower.includes('playwright');
                }
                return true;
            });
            if (filtered.length > 0) {
                originalDebug.apply(console, filtered);
            }
        };
    })();
    """
    
    @classmethod
    def get_all_patches(cls) -> str:
        """Get all stealth patches combined."""
        return "\n".join([
            cls.CHROME_RUNTIME_PATCH,
            cls.WEBDRIVER_PATCH,
            cls.PLUGINS_PATCH,
            cls.LANGUAGES_PATCH,
            cls.HARDWARE_PATCH,
            cls.PERMISSIONS_PATCH,
            cls.WEBGL_PATCH,
            cls.IFRAME_PATCH,
            cls.CONSOLE_PATCH,
        ])
    
    @classmethod
    async def apply_to_page(cls, page: Any) -> None:
        """Apply all stealth patches to a Playwright page."""
        try:
            await page.add_init_script(cls.get_all_patches())
            logger.debug("Applied advanced stealth patches to page")
        except Exception as e:
            logger.error("Failed to apply stealth patches", error=str(e))


class HumanBehaviorSimulator:
    """
    Simulate human-like behavior to avoid bot detection.
    
    Includes:
    - Random delays
    - Mouse movements
    - Scroll patterns
    - Typing patterns
    """
    
    @staticmethod
    def random_delay(min_ms: int = 100, max_ms: int = 500) -> float:
        """Get random delay in seconds."""
        return random.randint(min_ms, max_ms) / 1000
    
    @staticmethod
    async def human_type(page: Any, selector: str, text: str) -> None:
        """Type text with human-like delays."""
        element = await page.query_selector(selector)
        if not element:
            return
        
        await element.click()
        await asyncio.sleep(HumanBehaviorSimulator.random_delay(50, 150))
        
        for char in text:
            await page.keyboard.type(char)
            # Variable delay between keystrokes
            delay = random.uniform(0.05, 0.15)
            if char in " .,!?":
                delay += random.uniform(0.1, 0.2)
            await asyncio.sleep(delay)
    
    @staticmethod
    async def human_click(page: Any, selector: str) -> None:
        """Click with human-like behavior."""
        element = await page.query_selector(selector)
        if not element:
            return
        
        box = await element.bounding_box()
        if not box:
            await element.click()
            return
        
        # Click at random position within element
        x = box["x"] + random.uniform(5, box["width"] - 5)
        y = box["y"] + random.uniform(5, box["height"] - 5)
        
        # Move mouse first
        await page.mouse.move(x, y)
        await asyncio.sleep(HumanBehaviorSimulator.random_delay(50, 150))
        await page.mouse.click(x, y)
    
    @staticmethod
    async def human_scroll(page: Any, direction: str = "down", amount: int = 300) -> None:
        """Scroll with human-like patterns."""
        if direction == "down":
            delta = random.randint(amount - 50, amount + 50)
        else:
            delta = -random.randint(amount - 50, amount + 50)
        
        await page.mouse.wheel(0, delta)
        await asyncio.sleep(HumanBehaviorSimulator.random_delay(200, 400))
    
    @staticmethod
    async def random_mouse_movements(page: Any, count: int = 3) -> None:
        """Make random mouse movements."""
        viewport = page.viewport_size
        if not viewport:
            return
        
        for _ in range(count):
            x = random.randint(100, viewport["width"] - 100)
            y = random.randint(100, viewport["height"] - 100)
            await page.mouse.move(x, y)
            await asyncio.sleep(HumanBehaviorSimulator.random_delay(100, 300))


def get_enhanced_browser_args(
    include_docker: bool = False,
    include_stealth: bool = True,
) -> list[str]:
    """
    Get enhanced Chrome arguments for maximum undetectability.
    
    Args:
        include_docker: Include Docker-specific args
        include_stealth: Include stealth-related args
        
    Returns:
        List of Chrome arguments
    """
    args = [
        # Core anti-detection
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process,AutomationControlled",
        
        # Disable infobars and popups
        "--disable-infobars",
        "--disable-popup-blocking",
        "--disable-notifications",
        
        # Disable extensions welcome
        "--no-first-run",
        "--no-default-browser-check",
        "--no-service-autorun",
        
        # Performance
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-breakpad",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-hang-monitor",
        "--disable-ipc-flooding-protection",
        "--disable-renderer-backgrounding",
        "--disable-sync",
        
        # Privacy/security that helps with detection
        "--disable-client-side-phishing-detection",
        "--disable-domain-reliability",
        "--metrics-recording-only",
        "--safebrowsing-disable-auto-update",
        
        # WebRTC IP leak prevention
        "--disable-webrtc-apm-in-audio-service",
        "--disable-webrtc-encryption",
        "--disable-webrtc-hw-decoding",
        "--disable-webrtc-hw-encoding",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        
        # GPU (often checked by detection systems)
        "--enable-webgl",
        "--enable-accelerated-2d-canvas",
        "--enable-features=NetworkService,NetworkServiceInProcess",
        
        # Misc
        "--ignore-certificate-errors",
        "--ignore-ssl-errors",
        "--allow-running-insecure-content",
        "--password-store=basic",
        "--use-mock-keychain",
        "--log-level=3",
    ]
    
    if include_docker:
        args.extend([
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu-sandbox",
            "--disable-setuid-sandbox",
            "--no-zygote",
            "--single-process",
        ])
    
    return args
