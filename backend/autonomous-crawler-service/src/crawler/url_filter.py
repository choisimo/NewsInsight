"""URL filtering module for blocking non-content pages.

This module provides programmatic URL filtering to prevent the crawler from
visiting irrelevant pages like login, signup, help, marketing, etc.

Also includes URL liveness validation to filter out:
- Dead links (404, 500, etc.)
- Deleted/removed content pages
- LLM hallucination URLs
"""

import asyncio
import logging
import re
from typing import Optional, Tuple
from urllib.parse import urlparse, unquote

import aiohttp

logger = logging.getLogger(__name__)


# URL path patterns to block (regex patterns)
BLOCKED_PATH_PATTERNS = [
    # Authentication & Account
    r"/login",
    r"/signin",
    r"/sign-in",
    r"/signout",
    r"/sign-out",
    r"/logout",
    r"/log-out",
    r"/auth/",
    r"/oauth",
    r"/sso/",
    r"/signup",
    r"/sign-up",
    r"/register",
    r"/create-account",
    r"/join",
    r"/membership",
    r"/account",
    r"/profile",
    r"/settings",
    r"/preferences",
    r"/my-page",
    r"/mypage",
    r"/password",
    r"/forgot",
    r"/reset-password",
    # Help & Support
    r"/help",
    r"/support",
    r"/faq",
    r"/contact",
    r"/feedback",
    r"/report",
    r"/customer-service",
    r"/cs/",
    r"/inquiry",
    # Legal & Policy
    r"/about",
    r"/about-us",
    r"/team",
    r"/careers",
    r"/jobs",
    r"/privacy",
    r"/terms",
    r"/tos",
    r"/legal",
    r"/policy",
    r"/disclaimer",
    r"/copyright",
    # Commerce
    r"/subscribe",
    r"/subscription",
    r"/newsletter",
    r"/cart",
    r"/checkout",
    r"/payment",
    r"/order",
    r"/purchase",
    r"/buy",
    r"/shop",
    r"/store",
    r"/product/",
    r"/pricing",
    # Marketing & Campaigns
    r"/promo",
    r"/campaign",
    r"/landing",
    r"/offer",
    r"/deal",
    r"/coupon",
    r"/discount",
    r"/atrb",  # Attribution tracking
    r"/mkt/",
    r"/marketing/",
    r"/ad/",
    r"/ads/",
    r"/sponsor",
    # Utility Pages
    r"/search\?",  # Search result pages (not article pages)
    r"/tag/",
    r"/tags/",
    r"/category/$",  # Category index pages
    r"/sitemap",
    r"/robots\.txt",
    r"/feed$",
    r"/rss$",
    r"/atom$",
    # Social & Sharing
    r"/share",
    r"/print",
    r"/email",
    r"/bookmark",
    r"/notify",
    r"/notification",
    r"/alert",
    # Media Files
    r"\.(pdf|jpg|jpeg|png|gif|webp|svg|ico|mp4|mp3|avi|mov|zip|rar|exe|dmg)$",
    r"/download",
    r"/file/",
    r"/image/",
    r"/video/",
    r"/audio/",
    # API & Technical
    r"/api/",
    r"/ajax/",
    r"/graphql",
    r"/_next/",
    r"/_nuxt/",
    r"/static/",
    r"/assets/",
    # Language/Region Selectors
    r"/lang/",
    r"/locale/",
    r"/region/",
    # External Tools
    r"/grammar_checker",
    r"/spell_check",
    r"/translate",
    r"/calculator",
    r"/converter",
    r"/tool/",
    r"/widget/",
    # Q&A & Forums (not news articles)
    r"/qna/",
    r"/question",
    r"/answer",
    r"/forum",
    r"/board",
    r"/comment",
    r"/discussion",
    # Korean specific patterns
    r"/가입",
    r"/로그인",
    r"/회원",
    r"/고객센터",
    r"/문의",
]

# Domain patterns to block entirely
BLOCKED_DOMAINS = [
    # Authentication domains
    r"^nid\.",  # Naver ID
    r"^accounts\.",
    r"^auth\.",
    r"^login\.",
    r"^sso\.",
    r"^oauth\.",
    # Marketing & Tracking
    r"^mkt\.",  # Marketing
    r"^ads\.",
    r"^ad\.",
    r"^track\.",
    r"^analytics\.",
    r"^pixel\.",
    # Notification & Messaging
    r"^notify\.",
    r"^notification\.",
    r"^mail\.",
    r"^email\.",
    r"^message\.",
    # Help & Support subdomains
    r"^help\.",
    r"^support\.",
    r"^faq\.",
    r"^cs\.",
    # Social Media (unless explicitly allowed)
    r"^facebook\.com$",
    r"^twitter\.com$",
    r"^x\.com$",
    r"^instagram\.com$",
    r"^linkedin\.com$",
    r"^tiktok\.com$",
    r"^youtube\.com$",
    # Tools & Utilities
    r"^dic\.",  # Dictionary
    r"^translate\.",
    r"^map\.",
    r"^maps\.",
    # CDN & Static
    r"^cdn\.",
    r"^static\.",
    r"^img\.",
    r"^images\.",
    r"^assets\.",
]

# URL patterns that indicate article-like content (positive signals)
ARTICLE_URL_PATTERNS = [
    r"/news/",
    r"/article/",
    r"/story/",
    r"/post/",
    r"/blog/",
    r"/\d{4}/\d{2}/\d{2}/",  # Date-based URLs like /2024/01/15/
    r"/\d{4}/\d{2}/",  # Year-month URLs
    r"/entry/",
    r"/view/",
    r"/read/",
    r"/detail/",
    r"/content/",
    r"aid=\d+",  # Article ID parameter
    r"article_id=",
    r"newsId=",
]

# Compiled regex patterns for performance
_compiled_blocked_paths: list[re.Pattern] | None = None
_compiled_blocked_domains: list[re.Pattern] | None = None
_compiled_article_patterns: list[re.Pattern] | None = None


def _compile_patterns() -> None:
    """Compile regex patterns for performance."""
    global _compiled_blocked_paths, _compiled_blocked_domains, _compiled_article_patterns

    if _compiled_blocked_paths is None:
        _compiled_blocked_paths = [
            re.compile(pattern, re.IGNORECASE) for pattern in BLOCKED_PATH_PATTERNS
        ]
    if _compiled_blocked_domains is None:
        _compiled_blocked_domains = [
            re.compile(pattern, re.IGNORECASE) for pattern in BLOCKED_DOMAINS
        ]
    if _compiled_article_patterns is None:
        _compiled_article_patterns = [
            re.compile(pattern, re.IGNORECASE) for pattern in ARTICLE_URL_PATTERNS
        ]


def clean_url(url: str) -> str:
    """Clean and normalize URL for filtering.

    Args:
        url: Raw URL string

    Returns:
        Cleaned URL string
    """
    # Remove trailing punctuation that might be attached from text parsing
    url = url.rstrip(")")
    url = url.rstrip("]")
    url = url.rstrip("*")
    url = url.rstrip(".")
    url = url.rstrip(",")

    # Decode URL-encoded characters for pattern matching
    try:
        url = unquote(url)
    except Exception:
        pass

    return url


def should_block_url(url: str, log_reason: bool = True) -> bool:
    """Check if a URL should be blocked from crawling.

    Args:
        url: The URL to check
        log_reason: Whether to log the reason for blocking

    Returns:
        True if the URL should be blocked, False otherwise
    """
    _compile_patterns()

    url = clean_url(url)

    try:
        parsed = urlparse(url)
    except Exception:
        if log_reason:
            logger.debug("URL blocked: invalid URL format - %s", url[:100])
        return True

    hostname = parsed.netloc.lower()
    path = parsed.path.lower()
    full_url_lower = url.lower()

    # Check domain patterns
    if _compiled_blocked_domains:
        for pattern in _compiled_blocked_domains:
            if pattern.search(hostname):
                if log_reason:
                    logger.debug(
                        "URL blocked: domain pattern match - %s (pattern: %s)",
                        url[:100],
                        pattern.pattern,
                    )
                return True

    # Check path patterns
    if _compiled_blocked_paths:
        for pattern in _compiled_blocked_paths:
            if pattern.search(path) or pattern.search(full_url_lower):
                if log_reason:
                    logger.debug(
                        "URL blocked: path pattern match - %s (pattern: %s)",
                        url[:100],
                        pattern.pattern,
                    )
                return True

    return False


def is_likely_article_url(url: str) -> float:
    """Calculate confidence score that URL is an article.

    Args:
        url: The URL to check

    Returns:
        Confidence score between 0.0 and 1.0
    """
    _compile_patterns()

    url = clean_url(url)
    url_lower = url.lower()

    # Start with neutral score
    score = 0.5

    # Check for article-like patterns (positive signals)
    if _compiled_article_patterns:
        for pattern in _compiled_article_patterns:
            if pattern.search(url_lower):
                score += 0.15
                break  # Only count once

    # Penalize if it matches blocked patterns
    if should_block_url(url, log_reason=False):
        score -= 0.6

    # URLs with very long query strings are often not articles
    try:
        parsed = urlparse(url)
        if len(parsed.query) > 200:
            score -= 0.2
    except Exception:
        pass

    # Clamp to 0-1 range
    return max(0.0, min(1.0, score))


def filter_urls(urls: list[str], min_article_score: float = 0.3) -> list[str]:
    """Filter a list of URLs, removing blocked ones.

    Args:
        urls: List of URLs to filter
        min_article_score: Minimum article score to include

    Returns:
        List of URLs that passed filtering
    """
    filtered = []
    for url in urls:
        if not should_block_url(url):
            if is_likely_article_url(url) >= min_article_score:
                filtered.append(url)
    return filtered


def get_url_filter_stats(urls: list[str]) -> dict:
    """Get statistics about URL filtering for a list of URLs.

    Args:
        urls: List of URLs to analyze

    Returns:
        Dictionary with filtering statistics
    """
    stats = {
        "total": len(urls),
        "blocked": 0,
        "passed": 0,
        "blocked_by_domain": 0,
        "blocked_by_path": 0,
        "high_article_score": 0,
    }

    for url in urls:
        url = clean_url(url)
        try:
            parsed = urlparse(url)
            hostname = parsed.netloc.lower()

            # Check domain
            domain_blocked = False
            for pattern in _compiled_blocked_domains or []:
                if pattern.search(hostname):
                    domain_blocked = True
                    break

            if domain_blocked:
                stats["blocked"] += 1
                stats["blocked_by_domain"] += 1
                continue

            # Check path
            if should_block_url(url, log_reason=False):
                stats["blocked"] += 1
                stats["blocked_by_path"] += 1
                continue

            stats["passed"] += 1

            if is_likely_article_url(url) >= 0.6:
                stats["high_article_score"] += 1

        except Exception:
            stats["blocked"] += 1

    return stats


# ============================================
# URL Liveness Validation (HTTP HEAD/GET Check)
# ============================================

# Patterns indicating deleted/error pages (Korean & English)
DELETED_PAGE_PATTERNS = [
    # Korean patterns
    re.compile(r"삭제된\s*게시[글물]", re.IGNORECASE),
    re.compile(r"삭제되었습니다", re.IGNORECASE),
    re.compile(r"존재하지\s*않는\s*페이지", re.IGNORECASE),
    re.compile(r"페이지를\s*찾을\s*수\s*없", re.IGNORECASE),
    re.compile(r"접근\s*권한이\s*없", re.IGNORECASE),
    re.compile(r"비공개\s*게시", re.IGNORECASE),
    re.compile(r"회원만\s*열람", re.IGNORECASE),
    re.compile(r"로그인이\s*필요", re.IGNORECASE),
    re.compile(r"게시글이\s*없습니다", re.IGNORECASE),
    re.compile(r"이\s*글은\s*삭제", re.IGNORECASE),
    # English patterns
    re.compile(r"page\s*not\s*found", re.IGNORECASE),
    re.compile(r"404\s*error", re.IGNORECASE),
    re.compile(r"not\s*found", re.IGNORECASE),
    re.compile(r"this\s*page\s*does\s*not\s*exist", re.IGNORECASE),
    re.compile(r"content\s*has\s*been\s*removed", re.IGNORECASE),
    re.compile(r"content\s*is\s*no\s*longer\s*available", re.IGNORECASE),
    re.compile(r"access\s*denied", re.IGNORECASE),
    re.compile(r"article\s*not\s*found", re.IGNORECASE),
    re.compile(r"post\s*has\s*been\s*deleted", re.IGNORECASE),
    re.compile(r"this\s*content\s*is\s*unavailable", re.IGNORECASE),
    re.compile(r"sorry.*couldn't find", re.IGNORECASE),
]

# LLM hallucination URL patterns
HALLUCINATION_PATTERNS = [
    re.compile(r"example\.com", re.IGNORECASE),
    re.compile(r"sample\.com", re.IGNORECASE),
    re.compile(r"test\.com", re.IGNORECASE),
    re.compile(r"fake\.(com|org|net)", re.IGNORECASE),
    re.compile(r"placeholder\.(com|org|net)", re.IGNORECASE),
    re.compile(r"/article/\d{10,}", re.IGNORECASE),  # Abnormally long article IDs
    re.compile(r"www\d+\.", re.IGNORECASE),  # www1., www2. etc.
]

# Trusted domains (skip liveness check)
TRUSTED_DOMAINS = {
    "wikipedia.org",
    "en.wikipedia.org",
    "ko.wikipedia.org",
    "scholar.google.com",
    "pubmed.ncbi.nlm.nih.gov",
    "doi.org",
    "arxiv.org",
    "nature.com",
    "science.org",
    "sciencedirect.com",
    "springer.com",
    "ncbi.nlm.nih.gov",
    "britannica.com",
    "namu.wiki",
    "kosis.kr",
}

# URL validation result cache
_url_validation_cache: dict[str, Tuple[bool, str]] = {}
_cache_max_size = 1000


def is_hallucination_url(url: str) -> bool:
    """Check if URL matches LLM hallucination patterns.
    
    Args:
        url: URL to check
        
    Returns:
        True if URL is likely a hallucination
    """
    for pattern in HALLUCINATION_PATTERNS:
        if pattern.search(url):
            logger.debug("URL matches hallucination pattern: %s", url[:100])
            return True
    return False


def is_trusted_domain(url: str) -> bool:
    """Check if URL belongs to a trusted domain.
    
    Args:
        url: URL to check
        
    Returns:
        True if URL is from a trusted domain
    """
    try:
        parsed = urlparse(url)
        hostname = parsed.netloc.lower()
        
        for trusted in TRUSTED_DOMAINS:
            if hostname == trusted or hostname.endswith("." + trusted):
                return True
    except Exception:
        pass
    return False


def is_deleted_page_content(content: str, min_length: int = 100) -> bool:
    """Check if content indicates a deleted/error page.
    
    Args:
        content: Page content to check
        min_length: Minimum content length to consider valid
        
    Returns:
        True if content appears to be from a deleted/error page
    """
    if not content or len(content.strip()) < min_length:
        # Very short content - check for error patterns
        for pattern in DELETED_PAGE_PATTERNS:
            if pattern.search(content or ""):
                return True
        # Empty or too short
        if not content or len(content.strip()) < 50:
            return True
            
    # Check for error patterns in longer content
    for pattern in DELETED_PAGE_PATTERNS:
        if pattern.search(content):
            # If content is substantial, might be false positive
            if len(content) > 500:
                continue
            return True
    
    return False


async def check_url_liveness(
    url: str,
    timeout: float = 5.0,
    use_cache: bool = True,
) -> Tuple[bool, int, Optional[str]]:
    """Check if URL is accessible via HTTP HEAD/GET request.
    
    Args:
        url: URL to check
        timeout: Request timeout in seconds
        use_cache: Whether to use cached results
        
    Returns:
        Tuple of (is_accessible, http_status_code, error_message)
    """
    # Check cache
    if use_cache and url in _url_validation_cache:
        is_valid, reason = _url_validation_cache[url]
        status = 200 if is_valid else 404
        return (is_valid, status, None if is_valid else reason)
    
    # Check for hallucination patterns first
    if is_hallucination_url(url):
        _cache_result(url, False, "Hallucination URL pattern")
        return (False, 0, "Hallucination URL pattern")
    
    # Skip liveness check for trusted domains
    if is_trusted_domain(url):
        _cache_result(url, True, None)
        return (True, 200, None)
    
    # Validate URL format
    try:
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            _cache_result(url, False, "Invalid URL format")
            return (False, 0, "Invalid URL format")
    except Exception:
        _cache_result(url, False, "URL parse error")
        return (False, 0, "URL parse error")
    
    # Perform HTTP HEAD request
    try:
        async with aiohttp.ClientSession() as session:
            # Try HEAD first (faster)
            try:
                async with session.head(
                    url,
                    timeout=aiohttp.ClientTimeout(total=timeout),
                    allow_redirects=True,
                    headers={"User-Agent": "NewsInsight-Validator/1.0"},
                ) as response:
                    is_valid = 200 <= response.status < 400
                    _cache_result(url, is_valid, None if is_valid else f"HTTP {response.status}")
                    return (is_valid, response.status, None if is_valid else f"HTTP {response.status}")
            except aiohttp.ClientError:
                # HEAD failed, try GET
                async with session.get(
                    url,
                    timeout=aiohttp.ClientTimeout(total=timeout),
                    allow_redirects=True,
                    headers={"User-Agent": "NewsInsight-Validator/1.0"},
                ) as response:
                    is_valid = 200 <= response.status < 400
                    _cache_result(url, is_valid, None if is_valid else f"HTTP {response.status}")
                    return (is_valid, response.status, None if is_valid else f"HTTP {response.status}")
                    
    except asyncio.TimeoutError:
        _cache_result(url, False, "Timeout")
        return (False, 0, "Timeout")
    except aiohttp.ClientError as e:
        error_msg = str(e)[:100]
        _cache_result(url, False, error_msg)
        return (False, 0, error_msg)
    except Exception as e:
        error_msg = str(e)[:100]
        _cache_result(url, False, error_msg)
        return (False, 0, error_msg)


def _cache_result(url: str, is_valid: bool, reason: Optional[str]) -> None:
    """Cache URL validation result with size limit."""
    global _url_validation_cache
    
    # Clean cache if too large
    if len(_url_validation_cache) >= _cache_max_size:
        # Remove oldest entries (simple FIFO)
        keys_to_remove = list(_url_validation_cache.keys())[:_cache_max_size // 2]
        for key in keys_to_remove:
            del _url_validation_cache[key]
    
    _url_validation_cache[url] = (is_valid, reason or "")


async def validate_urls_batch(
    urls: list[str],
    timeout: float = 5.0,
    max_concurrent: int = 10,
) -> dict[str, Tuple[bool, int, Optional[str]]]:
    """Validate multiple URLs concurrently.
    
    Args:
        urls: List of URLs to validate
        timeout: Request timeout per URL
        max_concurrent: Maximum concurrent requests
        
    Returns:
        Dictionary mapping URL to (is_valid, status_code, error_message)
    """
    semaphore = asyncio.Semaphore(max_concurrent)
    
    async def check_with_semaphore(url: str) -> Tuple[str, Tuple[bool, int, Optional[str]]]:
        async with semaphore:
            result = await check_url_liveness(url, timeout)
            return (url, result)
    
    tasks = [check_with_semaphore(url) for url in urls]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    result_dict = {}
    for item in results:
        if isinstance(item, Exception):
            continue
        url, validation_result = item
        result_dict[url] = validation_result
    
    return result_dict


async def filter_valid_urls(
    urls: list[str],
    timeout: float = 5.0,
    max_concurrent: int = 10,
) -> list[str]:
    """Filter list of URLs to keep only valid, accessible ones.
    
    Args:
        urls: List of URLs to filter
        timeout: Request timeout per URL
        max_concurrent: Maximum concurrent requests
        
    Returns:
        List of valid, accessible URLs
    """
    results = await validate_urls_batch(urls, timeout, max_concurrent)
    
    valid_urls = []
    for url in urls:
        if url in results:
            is_valid, status, error = results[url]
            if is_valid:
                valid_urls.append(url)
            else:
                logger.debug("URL filtered out: %s (status=%d, error=%s)", url[:100], status, error)
    
    logger.info("URL validation: %d valid out of %d total", len(valid_urls), len(urls))
    return valid_urls


def validate_content_quality(
    url: str,
    content: str,
    min_length: int = 100,
) -> Tuple[bool, str]:
    """Validate content quality for a given URL.
    
    Args:
        url: Source URL
        content: Page content
        min_length: Minimum acceptable content length
        
    Returns:
        Tuple of (is_valid, reason)
    """
    if not content:
        return (False, "Empty content")
    
    content_length = len(content.strip())
    
    if content_length < 50:
        return (False, f"Content too short: {content_length} chars")
    
    if is_deleted_page_content(content, min_length):
        return (False, "Deleted/error page content detected")
    
    if content_length < min_length:
        return (False, f"Content below minimum length: {content_length} < {min_length}")
    
    return (True, "Valid")


def get_cache_stats() -> dict:
    """Get URL validation cache statistics.
    
    Returns:
        Dictionary with cache statistics
    """
    valid_count = sum(1 for is_valid, _ in _url_validation_cache.values() if is_valid)
    return {
        "total_entries": len(_url_validation_cache),
        "valid_urls": valid_count,
        "invalid_urls": len(_url_validation_cache) - valid_count,
        "max_size": _cache_max_size,
    }


def clear_cache() -> None:
    """Clear URL validation cache."""
    global _url_validation_cache
    _url_validation_cache = {}
    logger.info("URL validation cache cleared")
