"""
API Gateway Configuration Module

Production-ready configuration using Consul KV as the primary source.
No hardcoded defaults - all values must be provided via Consul or environment.
"""

import os
import logging
from typing import List, Optional, Any
from pydantic import BaseModel, Field

# Import consul_config from same directory
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from consul_config import ConsulConfigLoader  # type: ignore

logger = logging.getLogger(__name__)


class Settings(BaseModel):
    """
    API Gateway Configuration
    
    All settings are loaded from Consul KV (config/api-gateway/) or environment variables.
    No defaults are provided - missing required configuration will cause startup failure.
    """
    
    # Server settings
    PORT: int
    DEBUG: bool
    
    # Microservice URLs
    ANALYSIS_SERVICE_URL: str
    COLLECTOR_SERVICE_URL: str
    ABSA_SERVICE_URL: Optional[str] = None
    ALERT_SERVICE_URL: Optional[str] = None
    OSINT_ORCHESTRATOR_SERVICE_URL: Optional[str] = None
    OSINT_PLANNING_SERVICE_URL: Optional[str] = None
    OSINT_SOURCE_SERVICE_URL: Optional[str] = None
    
    # Timeout settings (seconds)
    DEFAULT_TIMEOUT: int
    HEALTH_CHECK_TIMEOUT: int
    
    # Rate limiting
    RATE_LIMIT_PER_MINUTE: int
    RATE_LIMIT_REDIS_URL: Optional[str] = None
    
    # JWT authentication
    JWT_SECRET_KEY: Optional[str] = None
    JWT_ALGORITHM: str
    JWT_EXPIRATION_HOURS: int
    
    # CORS settings
    ALLOWED_ORIGINS: List[str]
    ALLOWED_METHODS: List[str]
    ALLOWED_HEADERS: List[str]
    
    # Logging and environment
    LOG_LEVEL: str
    ENVIRONMENT: str
    
    class Config:
        """Pydantic configuration"""
        # Allow extra fields for forward compatibility
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
        "ANALYSIS_SERVICE_URL",
        "COLLECTOR_SERVICE_URL",
        "DEFAULT_TIMEOUT",
        "HEALTH_CHECK_TIMEOUT",
        "RATE_LIMIT_PER_MINUTE",
        "JWT_ALGORITHM",
        "JWT_EXPIRATION_HOURS",
        "LOG_LEVEL",
        "ENVIRONMENT"
    ]
    
    # Initialize Consul loader
    loader = ConsulConfigLoader(
        service_name="api-gateway",
        required_keys=required_keys
    )
    
    # Load configuration from Consul/environment
    config = loader.load_config(validate=True)
    
    # Type coercion for complex types
    coerced_config = {
        "PORT": loader.coerce_int(config.get("PORT", "8000")),
        "DEBUG": loader.coerce_bool(config.get("DEBUG", "false")),
        "ANALYSIS_SERVICE_URL": config.get("ANALYSIS_SERVICE_URL"),
        "COLLECTOR_SERVICE_URL": config.get("COLLECTOR_SERVICE_URL"),
        "ABSA_SERVICE_URL": config.get("ABSA_SERVICE_URL"),
        "ALERT_SERVICE_URL": config.get("ALERT_SERVICE_URL"),
        "OSINT_ORCHESTRATOR_SERVICE_URL": config.get("OSINT_ORCHESTRATOR_SERVICE_URL"),
        "OSINT_PLANNING_SERVICE_URL": config.get("OSINT_PLANNING_SERVICE_URL"),
        "OSINT_SOURCE_SERVICE_URL": config.get("OSINT_SOURCE_SERVICE_URL"),
        "DEFAULT_TIMEOUT": loader.coerce_int(config.get("DEFAULT_TIMEOUT", "30")),
        "HEALTH_CHECK_TIMEOUT": loader.coerce_int(config.get("HEALTH_CHECK_TIMEOUT", "5")),
        "RATE_LIMIT_PER_MINUTE": loader.coerce_int(config.get("RATE_LIMIT_PER_MINUTE", "100")),
        "RATE_LIMIT_REDIS_URL": config.get("RATE_LIMIT_REDIS_URL"),
        "JWT_SECRET_KEY": config.get("JWT_SECRET_KEY"),
        "JWT_ALGORITHM": config.get("JWT_ALGORITHM", "HS256"),
        "JWT_EXPIRATION_HOURS": loader.coerce_int(config.get("JWT_EXPIRATION_HOURS", "24")),
        "ALLOWED_ORIGINS": loader.coerce_list(config.get("ALLOWED_ORIGINS", "*")),
        "ALLOWED_METHODS": loader.coerce_list(config.get("ALLOWED_METHODS", "*")),
        "ALLOWED_HEADERS": loader.coerce_list(config.get("ALLOWED_HEADERS", "*")),
        "LOG_LEVEL": config.get("LOG_LEVEL", "INFO"),
        "ENVIRONMENT": config.get("ENVIRONMENT", "production")
    }
    
    # Store loader reference for health checks
    settings_obj = Settings(**coerced_config)
    settings_obj._consul_loader = loader  # type: ignore
    
    logger.info(f"Configuration loaded successfully for api-gateway in {coerced_config['ENVIRONMENT']} mode")
    
    return settings_obj


# Initialize settings (will fail fast if configuration is missing)
settings = load_settings()
