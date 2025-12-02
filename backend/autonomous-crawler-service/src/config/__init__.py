"""Configuration module for autonomous-crawler-service."""

from .settings import Settings, get_settings
from .consul import (
    load_config_from_consul,
    wait_for_consul,
    check_consul_health,
    CONSUL_ENABLED,
)

__all__ = [
    "Settings",
    "get_settings",
    "load_config_from_consul",
    "wait_for_consul",
    "check_consul_health",
    "CONSUL_ENABLED",
]
