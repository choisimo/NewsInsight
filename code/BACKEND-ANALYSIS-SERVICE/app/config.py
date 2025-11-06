"""
Analysis Service Configuration Module

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
    Analysis Service Configuration
    
    All settings are loaded from Consul KV (config/analysis-service/) or environment variables.
    No defaults are provided - missing required configuration will cause startup failure.
    """
    
    # Database settings
    DATABASE_URL: str
    REDIS_URL: str
    
    # Application settings
    DEBUG: bool
    SECRET_KEY: str
    ALLOWED_HOSTS: List[str]
    
    # Microservice URLs
    API_GATEWAY_URL: str
    COLLECTOR_SERVICE_URL: str
    ABSA_SERVICE_URL: Optional[str] = None
    ALERT_SERVICE_URL: Optional[str] = None
    
    # ML model and caching settings
    ML_MODEL_PATH: str
    CACHE_TTL: int
    
    # Logging settings
    LOG_LEVEL: str
    
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
        "DATABASE_URL",
        "REDIS_URL",
        "DEBUG",
        "SECRET_KEY",
        "ALLOWED_HOSTS",
        "API_GATEWAY_URL",
        "COLLECTOR_SERVICE_URL",
        "ML_MODEL_PATH",
        "CACHE_TTL",
        "LOG_LEVEL"
    ]
    
    # Initialize Consul loader
    loader = ConsulConfigLoader(
        service_name="analysis-service",
        required_keys=required_keys
    )
    
    # Load configuration from Consul/environment
    config = loader.load_config(validate=True)
    
    # Type coercion for complex types
    coerced_config = {
        "DATABASE_URL": config.get("DATABASE_URL"),
        "REDIS_URL": config.get("REDIS_URL"),
        "DEBUG": loader.coerce_bool(config.get("DEBUG", "false")),
        "SECRET_KEY": config.get("SECRET_KEY"),
        "ALLOWED_HOSTS": loader.coerce_list(config.get("ALLOWED_HOSTS", "*")),
        "API_GATEWAY_URL": config.get("API_GATEWAY_URL"),
        "COLLECTOR_SERVICE_URL": config.get("COLLECTOR_SERVICE_URL"),
        "ABSA_SERVICE_URL": config.get("ABSA_SERVICE_URL"),
        "ALERT_SERVICE_URL": config.get("ALERT_SERVICE_URL"),
        "ML_MODEL_PATH": config.get("ML_MODEL_PATH", "/app/models"),
        "CACHE_TTL": loader.coerce_int(config.get("CACHE_TTL", "300")),
        "LOG_LEVEL": config.get("LOG_LEVEL", "INFO")
    }
    
    # Store loader reference for health checks
    settings_obj = Settings(**coerced_config)
    settings_obj._consul_loader = loader  # type: ignore
    
    logger.info(f"Configuration loaded successfully for analysis-service")
    
    return settings_obj


# Initialize settings (will fail fast if configuration is missing)
settings = load_settings()
