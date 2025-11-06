"""
Collector Service Configuration Module

Production-ready configuration using Consul KV as the primary source.
No hardcoded defaults - all values must be provided via Consul or environment.
"""

import os
import logging
from typing import List, Optional, Any
from pydantic import BaseModel

# Import consul_config from same directory
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from consul_config import ConsulConfigLoader  # type: ignore

logger = logging.getLogger(__name__)


class Settings(BaseModel):
    """
    Collector Service Configuration
    
    All settings are loaded from Consul KV (config/collector-service/) or environment variables.
    No defaults are provided - missing required configuration will cause startup failure.
    """
    
    # Server settings
    port: int
    debug: bool
    
    # Database settings
    database_url: str
    redis_url: str
    analysis_service_url: str
    
    # Collection settings
    max_concurrent_requests: int
    request_timeout: int
    collection_interval: int
    
    # Scraping settings
    user_agent: str
    rss_feeds: List[str]
    scraping_targets: List[str]
    
    # QA pipeline settings
    qa_enable_network_checks: bool
    qa_domain_whitelist: List[str]
    qa_min_content_length: int
    
    class Config:
        """Pydantic configuration"""
        extra = "allow"


def load_settings() -> Settings:
    """
    Load settings from Consul KV with fallback to environment variables.
    
    Returns:
        Settings: Validated configuration object
        
    Raises:
        ValueError: If required configuration is missing
    """
    
    # Required configuration keys
    required_keys = [
        "PORT",
        "DEBUG",
        "DATABASE_URL",
        "REDIS_URL",
        "ANALYSIS_SERVICE_URL",
        "MAX_CONCURRENT_REQUESTS",
        "REQUEST_TIMEOUT",
        "COLLECTION_INTERVAL",
        "USER_AGENT",
        "RSS_FEEDS",
        "SCRAPING_TARGETS",
        "QA_ENABLE_NETWORK_CHECKS",
        "QA_DOMAIN_WHITELIST",
        "QA_MIN_CONTENT_LENGTH"
    ]
    
    # Initialize Consul loader
    loader = ConsulConfigLoader(
        service_name="collector-service",
        required_keys=required_keys
    )
    
    # Load configuration from Consul/environment
    config = loader.load_config(validate=True)
    
    # Type coercion for complex types
    coerced_config = {
        "port": loader.coerce_int(config.get("PORT", "8002")),
        "debug": loader.coerce_bool(config.get("DEBUG", "false")),
        "database_url": config.get("DATABASE_URL"),
        "redis_url": config.get("REDIS_URL"),
        "analysis_service_url": config.get("ANALYSIS_SERVICE_URL"),
        "max_concurrent_requests": loader.coerce_int(config.get("MAX_CONCURRENT_REQUESTS", "10")),
        "request_timeout": loader.coerce_int(config.get("REQUEST_TIMEOUT", "30")),
        "collection_interval": loader.coerce_int(config.get("COLLECTION_INTERVAL", "3600")),
        "user_agent": config.get("USER_AGENT"),
        "rss_feeds": loader.coerce_list(config.get("RSS_FEEDS", "")),
        "scraping_targets": loader.coerce_list(config.get("SCRAPING_TARGETS", "")),
        "qa_enable_network_checks": loader.coerce_bool(config.get("QA_ENABLE_NETWORK_CHECKS", "false")),
        "qa_domain_whitelist": loader.coerce_list(config.get("QA_DOMAIN_WHITELIST", "")),
        "qa_min_content_length": loader.coerce_int(config.get("QA_MIN_CONTENT_LENGTH", "40"))
    }
    
    # Store loader reference for health checks
    settings_obj = Settings(**coerced_config)
    settings_obj._consul_loader = loader  # type: ignore
    
    logger.info(f"Configuration loaded successfully for collector-service")
    
    return settings_obj


# Initialize settings (will fail fast if configuration is missing)
settings = load_settings()
