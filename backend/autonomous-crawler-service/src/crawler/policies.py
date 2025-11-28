"""Crawling policies and prompt generation."""

from enum import Enum


class CrawlPolicy(Enum):
    """Exploration policies for autonomous crawling."""

    FOCUSED_TOPIC = "focused_topic"
    DOMAIN_WIDE = "domain_wide"
    NEWS_ONLY = "news_only"
    CROSS_DOMAIN = "cross_domain"
    SINGLE_PAGE = "single_page"


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
{chr(10).join(f'- {d}' for d in excluded_domains)}
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
