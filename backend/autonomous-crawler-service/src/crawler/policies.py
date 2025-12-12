"""Crawling policies and prompt generation."""

from enum import Enum


class CrawlPolicy(Enum):
    """Exploration policies for autonomous crawling."""

    # 기본 정책
    FOCUSED_TOPIC = "focused_topic"
    DOMAIN_WIDE = "domain_wide"
    NEWS_ONLY = "news_only"
    CROSS_DOMAIN = "cross_domain"
    SINGLE_PAGE = "single_page"

    # 뉴스 특화 정책 (신규)
    NEWS_BREAKING = "news_breaking"  # 속보/긴급 뉴스 우선
    NEWS_ARCHIVE = "news_archive"  # 과거 기사 아카이브 수집
    NEWS_OPINION = "news_opinion"  # 오피니언/칼럼 수집
    NEWS_LOCAL = "news_local"  # 지역 뉴스 특화


# Base system prompt for all policies
BASE_SYSTEM_PROMPT = """You are an autonomous web crawler agent specialized in extracting news and article content.
Your goal is to navigate websites, identify valuable content, and extract structured information.

## Core Behaviors:
1. Navigate to the seed URL first
2. Identify and extract article content (title, body text, publication date, author)
3. Find relevant links to other articles/pages based on the policy
4. Avoid non-content pages (login, signup, ads, social media shares)
5. Respect the page budget and depth limits

## Content Extraction Guidelines:
- Extract the main article title (usually h1 or article header)
- Extract the full article body text, preserving paragraphs
- Look for publication date in meta tags, article headers, or bylines
- Skip navigation menus, footers, sidebars, and advertisements
- If a page is not an article, briefly note what type of page it is and move on

## Navigation Rules:
- Prioritize links that appear to be article links (news headlines, blog posts)
- Avoid external links unless specifically allowed by the policy
- Skip links to media files (images, PDFs, videos)
- Skip pagination if you've already seen the content pattern

## Output Format:
For each article extracted, use this format:
---ARTICLE_START---
URL: [article URL]
TITLE: [headline]
AUTHOR: [author name if found]
PUBLISHED_AT: [publication date in ISO format if found]
CATEGORY: [category/section if identified]
CONTENT: [full article text]
---ARTICLE_END---
"""

POLICY_PROMPTS = {
    CrawlPolicy.FOCUSED_TOPIC: """
## Policy: FOCUSED_TOPIC
Focus exclusively on content related to the specified keywords/topics.

### Specific Instructions:
- Only follow links that appear related to the focus keywords: {focus_keywords}
- Prioritize articles with titles containing the keywords
- Skip unrelated content even if it looks interesting
- Extract articles that discuss or mention the focus topics
- Look for related terms and synonyms of the focus keywords
""",
    CrawlPolicy.DOMAIN_WIDE: """
## Policy: DOMAIN_WIDE
Explore the entire domain broadly to discover all available content.

### Specific Instructions:
- Follow links to all content sections of the website
- Prioritize category/section pages that lead to more articles
- Create a broad coverage of the site's content
- Balance between depth and breadth of exploration
- Identify and visit major site sections (news, blog, articles, etc.)
""",
    CrawlPolicy.NEWS_ONLY: """
## Policy: NEWS_ONLY
Focus strictly on news articles and current events content.

### Specific Instructions:
- Only extract content that appears to be news articles
- Look for date indicators showing recent publication
- Prioritize breaking news, current events, and timely content
- Skip evergreen content, guides, and static pages
- Follow links from news sections, headlines, and latest articles
- Identify news patterns: bylines, datelines, news categories
""",
    CrawlPolicy.CROSS_DOMAIN: """
## Policy: CROSS_DOMAIN
Follow links across different domains to discover related content.

### Specific Instructions:
- You may follow external links to other websites
- Prioritize links that appear to lead to related news sources
- Respect the excluded domains list if provided
- Track which domains you've visited to ensure diversity
- Extract content from each domain you visit
- Be cautious of redirect chains and avoid loops
""",
    CrawlPolicy.SINGLE_PAGE: """
## Policy: SINGLE_PAGE
Extract content only from the seed URL without following any links.

### Specific Instructions:
- Do NOT navigate to any other pages
- Focus entirely on extracting content from the current page
- Extract all article content, metadata, and structured data
- Identify any embedded content or data on the page
- This is a single-page extraction task only
""",
    CrawlPolicy.NEWS_BREAKING: """
## Policy: NEWS_BREAKING
Priority collection of breaking news and urgent updates.

### Specific Instructions:
- Look for visual indicators of breaking news:
  - Labels: "속보", "Breaking", "긴급", "단독", "Flash", "Urgent"
  - Red or highlighted text, special formatting
  - Pinned or featured articles at the top
- Prioritize articles published in the last few hours
- Extract the FULL content of breaking news articles
- Note the exact publication time if available
- Skip older news and evergreen content
- Look for live update sections or real-time feeds
- Mark each article as breaking: true in metadata
""",
    CrawlPolicy.NEWS_ARCHIVE: """
## Policy: NEWS_ARCHIVE
Historical article collection from archives.

### Specific Instructions:
- Navigate through pagination and archive pages
- Look for "이전 기사", "더보기", "Load More" buttons
- Accept older publication dates (weeks, months, or years old)
- Follow links to category archives and date-based listings
- Collect articles systematically by date or category
- Note the original publication date accurately
- Skip duplicate or redirected articles
- Be patient with slower-loading archive pages
""",
    CrawlPolicy.NEWS_OPINION: """
## Policy: NEWS_OPINION
Focus on opinion pieces, editorials, and columns.

### Specific Instructions:
- Look for opinion/editorial sections:
  - "오피니언", "칼럼", "사설", "Opinion", "Editorial", "Column"
  - Author-focused pages with byline photos
- Identify opinion content markers:
  - Personal pronouns and subjective language
  - Author bio sections
  - Regular column series
- Extract author information prominently
- Mark content as opinion: true in metadata
- Note if the author is a regular columnist
- Skip straight news reporting
""",
    CrawlPolicy.NEWS_LOCAL: """
## Policy: NEWS_LOCAL
Local and regional news collection.

### Specific Instructions:
- Focus on local news sections:
  - "지역", "Local", geographic region names
  - City or province-specific categories
- Look for location markers in articles:
  - City names, district names
  - Local government references
  - Regional business news
- Prioritize community-focused stories
- Note the geographic focus of each article
- Skip national or international news
- Include local events and announcements
""",
}


def get_policy_prompt(
    policy: CrawlPolicy | str,
    focus_keywords: list[str] | None = None,
    custom_prompt: str | None = None,
    excluded_domains: list[str] | None = None,
) -> str:
    """
    Generate the full system prompt for the crawler agent.

    Args:
        policy: The crawling policy to use
        focus_keywords: Keywords for FOCUSED_TOPIC policy
        custom_prompt: Optional custom instructions to append
        excluded_domains: Domains to exclude from crawling

    Returns:
        Complete system prompt for the browser-use agent
    """
    # Convert string to enum if needed
    if isinstance(policy, str):
        try:
            policy = CrawlPolicy(policy.lower())
        except ValueError:
            policy = CrawlPolicy.NEWS_ONLY  # Default fallback

    # Build the prompt
    prompt_parts = [BASE_SYSTEM_PROMPT]

    # Add policy-specific instructions
    policy_prompt = POLICY_PROMPTS.get(policy, POLICY_PROMPTS[CrawlPolicy.NEWS_ONLY])

    # Format with focus keywords if applicable
    if policy == CrawlPolicy.FOCUSED_TOPIC and focus_keywords:
        policy_prompt = policy_prompt.format(focus_keywords=", ".join(focus_keywords))
    else:
        policy_prompt = policy_prompt.replace("{focus_keywords}", "")

    prompt_parts.append(policy_prompt)

    # Add excluded domains if any
    if excluded_domains:
        prompt_parts.append(f"""
## Excluded Domains:
Do NOT visit or follow links to these domains:
{chr(10).join(f"- {d}" for d in excluded_domains)}
""")

    # Add custom instructions if provided
    if custom_prompt:
        prompt_parts.append(f"""
## Custom Instructions:
{custom_prompt}
""")

    return "\n".join(prompt_parts)


def get_extraction_prompt(url: str) -> str:
    """
    Generate the task prompt for extracting content from a specific page.

    Args:
        url: The URL to extract content from

    Returns:
        Task prompt for content extraction
    """
    return f"""
Extract the article content from this page: {url}

Return the extracted content in the following format:
1. TITLE: The main article headline
2. CONTENT: The full article text (preserve paragraph breaks)
3. PUBLISHED_AT: The publication date if found (ISO format preferred)
4. AUTHOR: The author name if found
5. SUMMARY: A brief 2-3 sentence summary of the article

If this is not an article page, indicate what type of page it is.
"""


def get_news_list_extraction_prompt(url: str, max_articles: int = 20) -> str:
    """
    Generate prompt for extracting article list from a news section page.

    Args:
        url: The news section/category URL
        max_articles: Maximum number of articles to extract

    Returns:
        Task prompt for list extraction
    """
    return f"""
Extract the list of news articles from this page: {url}

Find up to {max_articles} news articles and return each in this format:
---ARTICLE_LINK---
TITLE: [article headline]
URL: [full article URL]
SUMMARY: [brief description or lead text if visible]
PUBLISHED_AT: [date if shown]
THUMBNAIL: [image URL if present]
---END_LINK---

Focus on:
- Main content area article links
- Skip navigation, ads, and sidebar widgets
- Include only actual news article links
- Preserve the order as shown on the page
"""


def get_rss_discovery_prompt(url: str) -> str:
    """
    Generate prompt for discovering RSS/Atom feeds.

    Args:
        url: The website URL to search for feeds

    Returns:
        Task prompt for RSS discovery
    """
    return f"""
Find all RSS and Atom feeds available on this website: {url}

Search in these locations:
1. HTML head section:
   - <link rel="alternate" type="application/rss+xml" ...>
   - <link rel="alternate" type="application/atom+xml" ...>
2. Common feed paths:
   - /feed, /rss, /atom, /feeds
   - /rss.xml, /feed.xml, /atom.xml
   - /news/rss, /blog/feed
3. Page footer or sidebar RSS icons/links
4. sitemap.xml references

Return found feeds in JSON format:
{{
    "feeds": [
        {{
            "url": "feed URL",
            "type": "rss|atom",
            "title": "feed title if known",
            "category": "category if specified"
        }}
    ],
    "sitemap_url": "sitemap URL if found",
    "robots_txt_checked": true|false
}}
"""
