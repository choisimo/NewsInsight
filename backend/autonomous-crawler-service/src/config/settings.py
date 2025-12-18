"""Application settings using Pydantic Settings."""

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class KafkaSettings(BaseSettings):
    """Kafka connection settings."""

    model_config = SettingsConfigDict(env_prefix="KAFKA_")

    bootstrap_servers: str = Field(
        default="localhost:9092",
        description="Kafka bootstrap servers",
    )
    consumer_group_id: str = Field(
        default="autonomous-crawler-group",
        description="Consumer group ID",
    )
    browser_task_topic: str = Field(
        default="newsinsight.crawl.browser.tasks",
        description="Topic for browser task messages",
    )
    crawl_result_topic: str = Field(
        default="newsinsight.crawl.results",
        description="Topic for crawl result messages",
    )
    auto_offset_reset: Literal["earliest", "latest"] = Field(
        default="earliest",
        description="Auto offset reset policy",
    )
    enable_auto_commit: bool = Field(
        default=False,
        description="Enable auto commit (disabled for manual acknowledgment)",
    )
    max_poll_records: int = Field(
        default=1,
        description="Maximum records per poll (1 for sequential processing)",
    )
    session_timeout_ms: int = Field(
        default=30000,
        description="Session timeout in milliseconds",
    )
    heartbeat_interval_ms: int = Field(
        default=10000,
        description="Heartbeat interval in milliseconds",
    )


class BrowserSettings(BaseSettings):
    """Browser and AI agent settings."""

    model_config = SettingsConfigDict(env_prefix="BROWSER_")

    headless: bool = Field(
        default=True,
        description="Run browser in headless mode",
    )
    max_concurrent_sessions: int = Field(
        default=2,
        description="Maximum concurrent browser sessions",
    )
    default_timeout_seconds: int = Field(
        default=300,
        description="Default timeout for browser tasks in seconds",
    )
    max_timeout_seconds: int = Field(
        default=600,
        description="Maximum allowed timeout in seconds",
    )
    screenshot_dir: str = Field(
        default="/tmp/crawler-screenshots",
        description="Directory for storing screenshots",
    )
    user_agent: str = Field(
        default="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        description="User agent string for browser",
    )
    is_docker_env: bool = Field(
        default=False,
        description="Whether running in Docker environment (enables no-sandbox, etc.)",
    )
    # Browser backend selection
    backend: Literal["playwright", "camoufox"] = Field(
        default="playwright",
        description="Browser backend: 'playwright' (Chrome/Chromium) or 'camoufox' (Firefox anti-detect)",
    )


class LLMSettings(BaseSettings):
    """LLM provider settings.

    Supported providers:
    - openai: OpenAI API (default)
    - anthropic: Anthropic Claude API
    - openrouter: OpenRouter (access to multiple models via single API)
    - ollama: Local Ollama server
    - custom: Custom OpenAI-compatible REST API endpoint
    """

    model_config = SettingsConfigDict(env_prefix="LLM_")

    provider: Literal["openai", "anthropic", "openrouter", "ollama", "custom"] = Field(
        default="openai",
        description="LLM provider: openai, anthropic, openrouter, ollama, or custom",
    )

    # OpenAI settings
    openai_api_key: str = Field(
        default="",
        description="OpenAI API key",
    )
    openai_model: str = Field(
        default="gpt-4o",
        description="OpenAI model to use",
    )
    openai_base_url: str = Field(
        default="",
        description="Custom OpenAI API base URL (leave empty for default)",
    )

    # Anthropic settings
    anthropic_api_key: str = Field(
        default="",
        description="Anthropic API key",
    )
    anthropic_model: str = Field(
        default="claude-3-5-sonnet-20241022",
        description="Anthropic model to use",
    )

    # OpenRouter settings (https://openrouter.ai)
    openrouter_api_key: str = Field(
        default="",
        description="OpenRouter API key",
    )
    openrouter_model: str = Field(
        default="anthropic/claude-3.5-sonnet",
        description="OpenRouter model (e.g., anthropic/claude-3.5-sonnet, openai/gpt-4o, google/gemini-pro)",
    )
    openrouter_base_url: str = Field(
        default="https://openrouter.ai/api/v1",
        description="OpenRouter API base URL",
    )

    # Ollama settings (local LLM)
    ollama_base_url: str = Field(
        default="http://localhost:11434",
        description="Ollama server URL",
    )
    ollama_model: str = Field(
        default="llama3.2",
        description="Ollama model name",
    )

    # Azure OpenAI settings
    azure_api_key: str = Field(
        default="",
        description="Azure OpenAI API key",
    )
    azure_endpoint: str = Field(
        default="",
        description="Azure OpenAI endpoint URL (e.g., https://your-resource.openai.azure.com)",
    )
    azure_deployment_name: str = Field(
        default="gpt-4o",
        description="Azure OpenAI deployment name",
    )
    azure_api_version: str = Field(
        default="2024-02-15-preview",
        description="Azure OpenAI API version",
    )

    # Custom REST API settings (supports non-OpenAI-compatible APIs)
    custom_api_key: str = Field(
        default="",
        description="API key for custom endpoint (optional if API doesn't require auth)",
    )
    custom_base_url: str = Field(
        default="",
        description="Custom REST API endpoint URL (e.g., https://workflow.nodove.com/webhook/aidove)",
    )
    custom_model: str = Field(
        default="",
        description="Model name for custom endpoint (used in request if format includes it)",
    )
    custom_request_format: str = Field(
        default="",
        description="""JSON template for custom API request body.
Use placeholders: {prompt} for user message, {session_id} for session ID, {model} for model name.
Example for AI Dove: {"chatInput": "{prompt}", "sessionId": "{session_id}"}
Example for standard: {"message": "{prompt}", "model": "{model}"}
Leave empty for OpenAI-compatible format.""",
    )
    custom_response_path: str = Field(
        default="reply",
        description="""JSON path to extract response text from API response.
Use dot notation for nested fields (e.g., 'choices.0.message.content' for OpenAI format).
For AI Dove API, use 'reply'.""",
    )
    custom_headers: str = Field(
        default="",
        description="""Custom HTTP headers as JSON object.
Example: {"X-Custom-Header": "value", "Authorization": "Bearer {api_key}"}
Use {api_key} placeholder for API key substitution.""",
    )

    # Common settings
    temperature: float = Field(
        default=0.0,
        description="LLM temperature",
    )
    max_tokens: int = Field(
        default=4096,
        description="Maximum tokens for LLM response",
    )


class SearchSettings(BaseSettings):
    """Search provider settings."""

    model_config = SettingsConfigDict(env_prefix="SEARCH_")

    # API Keys
    brave_api_key: str = Field(
        default="",
        description="Brave Search API key",
    )
    tavily_api_key: str = Field(
        default="",
        description="Tavily Search API key",
    )
    perplexity_api_key: str = Field(
        default="",
        description="Perplexity API key",
    )

    # Configuration
    timeout: float = Field(
        default=30.0,
        description="Timeout for search requests in seconds",
    )
    max_results_per_provider: int = Field(
        default=10,
        description="Maximum results per search provider",
    )
    max_total_results: int = Field(
        default=30,
        description="Maximum total aggregated results",
    )
    enable_parallel: bool = Field(
        default=True,
        description="Enable parallel search across providers",
    )

    # RRF (Reciprocal Rank Fusion) Settings
    enable_rrf: bool = Field(
        default=True,
        description="Enable RRF-based multi-strategy search for improved accuracy",
    )
    rrf_k: int = Field(
        default=60,
        ge=1,
        le=1000,
        description="RRF constant k (higher = more weight to lower ranks, default: 60)",
    )
    enable_semantic_rrf: bool = Field(
        default=True,
        description="Enable semantic similarity scoring in RRF",
    )
    enable_query_expansion: bool = Field(
        default=True,
        description="Enable LLM-based query expansion for better search accuracy",
    )
    max_expanded_queries: int = Field(
        default=5,
        ge=1,
        le=10,
        description="Maximum number of expanded queries for multi-strategy search",
    )
    cache_query_analysis: bool = Field(
        default=True,
        description="Cache query analysis results to reduce LLM calls",
    )


class StealthSettings(BaseSettings):
    """Stealth/anti-detection settings."""

    model_config = SettingsConfigDict(env_prefix="STEALTH_")

    enabled: bool = Field(
        default=True,
        description="Enable stealth mode for browser",
    )
    hide_webdriver: bool = Field(
        default=True,
        description="Hide webdriver detection flags",
    )
    hide_automation: bool = Field(
        default=True,
        description="Hide automation flags",
    )
    mask_webgl: bool = Field(
        default=True,
        description="Mask WebGL vendor/renderer",
    )
    random_user_agent: bool = Field(
        default=False,
        description="Use random user agent on each session",
    )
    # NopeCHA CAPTCHA solver extension
    use_nopecha: bool = Field(
        default=True,
        description="Enable NopeCHA extension for automatic CAPTCHA solving",
    )
    nopecha_api_key: str = Field(
        default="",
        description="NopeCHA API key (optional, for faster solving)",
    )
    # Advanced stealth patches
    use_advanced_patches: bool = Field(
        default=True,
        description="Apply advanced JavaScript patches for bot detection bypass",
    )
    # Human behavior simulation
    simulate_human_behavior: bool = Field(
        default=True,
        description="Simulate human-like mouse movements and scrolling",
    )


class CamoufoxSettings(BaseSettings):
    """Camoufox Firefox-based anti-detect browser settings."""

    model_config = SettingsConfigDict(env_prefix="CAMOUFOX_")

    enabled: bool = Field(
        default=True,
        description="Enable Camoufox as alternative browser (when BROWSER_BACKEND=camoufox)",
    )
    humanize: bool = Field(
        default=True,
        description="Enable human-like behavior simulation",
    )
    humanize_level: int = Field(
        default=2,
        ge=1,
        le=3,
        description="Humanization level (1=low, 2=medium, 3=high)",
    )
    geoip: bool = Field(
        default=True,
        description="Enable GeoIP-based fingerprint matching",
    )
    block_webrtc: bool = Field(
        default=True,
        description="Block WebRTC to prevent IP leaks",
    )
    block_images: bool = Field(
        default=False,
        description="Block images for faster loading",
    )
    locale: str = Field(
        default="ko-KR",
        description="Browser locale",
    )
    timezone: str = Field(
        default="Asia/Seoul",
        description="Browser timezone",
    )
    os_type: Literal["windows", "macos", "linux", "random"] = Field(
        default="random",
        description="OS fingerprint type",
    )


class CaptchaSettings(BaseSettings):
    """CAPTCHA solving settings."""

    model_config = SettingsConfigDict(env_prefix="CAPTCHA_")

    enabled: bool = Field(
        default=True,
        description="Enable CAPTCHA solving",
    )
    prefer_audio: bool = Field(
        default=True,
        description="Prefer audio challenges for reCAPTCHA",
    )
    cloudflare_delay: int = Field(
        default=10,
        description="Delay for Cloudflare challenge (seconds)",
    )
    max_attempts: int = Field(
        default=3,
        description="Maximum CAPTCHA solve attempts",
    )


class RedisSettings(BaseSettings):
    """Redis connection settings for task state persistence."""

    model_config = SettingsConfigDict(env_prefix="REDIS_")

    enabled: bool = Field(
        default=True,
        description="Enable Redis for task state persistence",
    )
    url: str = Field(
        default="redis://localhost:6379/4",
        description="Redis connection URL",
    )
    prefix: str = Field(
        default="autonomous_crawler",
        description="Key prefix for Redis entries",
    )
    result_ttl_hours: int = Field(
        default=48,
        description="Task result TTL in hours",
    )
    socket_timeout: float = Field(
        default=5.0,
        description="Socket timeout in seconds",
    )
    connection_timeout: float = Field(
        default=5.0,
        description="Connection timeout in seconds",
    )
    max_connections: int = Field(
        default=10,
        description="Maximum Redis connections in pool",
    )
    retry_on_timeout: bool = Field(
        default=True,
        description="Retry operations on timeout",
    )


class MetricsSettings(BaseSettings):
    """Prometheus metrics settings."""

    model_config = SettingsConfigDict(env_prefix="METRICS_")

    enabled: bool = Field(
        default=True,
        description="Enable Prometheus metrics",
    )
    port: int = Field(
        default=9090,
        description="Metrics server port",
    )
    path: str = Field(
        default="/metrics",
        description="Metrics endpoint path",
    )


class Settings(BaseSettings):
    """Main application settings."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Service settings
    service_name: str = Field(
        default="autonomous-crawler-service",
        description="Service name",
    )
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = Field(
        default="INFO",
        description="Logging level",
    )
    log_format: Literal["json", "console"] = Field(
        default="json",
        description="Log output format",
    )

    # Nested settings
    kafka: KafkaSettings = Field(default_factory=KafkaSettings)
    browser: BrowserSettings = Field(default_factory=BrowserSettings)
    llm: LLMSettings = Field(default_factory=LLMSettings)
    search: SearchSettings = Field(default_factory=SearchSettings)
    stealth: StealthSettings = Field(default_factory=StealthSettings)
    captcha: CaptchaSettings = Field(default_factory=CaptchaSettings)
    camoufox: CamoufoxSettings = Field(default_factory=CamoufoxSettings)
    redis: RedisSettings = Field(default_factory=RedisSettings)
    metrics: MetricsSettings = Field(default_factory=MetricsSettings)


@lru_cache
def get_settings() -> Settings:
    """Get cached application settings."""
    return Settings()
