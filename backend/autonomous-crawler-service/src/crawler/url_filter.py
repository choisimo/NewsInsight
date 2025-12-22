"""URL filtering module for blocking non-content pages.

This module provides programmatic URL filtering to prevent the crawler from
visiting irrelevant pages like login, signup, help, marketing, etc.
"""

import logging
import re
from urllib.parse import urlparse, unquote

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
