"""Consul KV configuration loader for autonomous-crawler service.

Loads configuration with the following precedence:
1. Consul KV (highest priority) - key path: config/autonomous-crawler/{KEY}
2. Environment Variables - {KEY}
3. Error if required key not found

Usage:
    from src.config.consul import load_config_from_consul

    # Load all config from Consul and apply to environment
    consul_keys, env_keys = load_config_from_consul()
    
    # Then use Settings as normal
    from src.config import get_settings
    settings = get_settings()
"""

import base64
import os
from typing import Any

import httpx
import structlog

logger = structlog.get_logger(__name__)

# Consul configuration
CONSUL_HOST = os.getenv("CONSUL_HOST", "localhost")
CONSUL_PORT = os.getenv("CONSUL_PORT", "8500")
CONSUL_HTTP_TOKEN = os.getenv("CONSUL_HTTP_TOKEN", "")
CONSUL_ENABLED = os.getenv("CONSUL_ENABLED", "true").lower() == "true"
CONSUL_SERVICE_NAME = os.getenv("CONSUL_SERVICE_NAME", "autonomous-crawler")

# Consul KV prefix for this service
CONSUL_KV_PREFIX = f"config/{CONSUL_SERVICE_NAME}/"


def get_consul_url() -> str:
    """Get the Consul HTTP API URL."""
    return f"http://{CONSUL_HOST}:{CONSUL_PORT}"


def get_consul_headers() -> dict[str, str]:
    """Get headers for Consul API requests."""
    headers = {"Accept": "application/json"}
    if CONSUL_HTTP_TOKEN:
        headers["X-Consul-Token"] = CONSUL_HTTP_TOKEN
    return headers


async def fetch_consul_kv_async(key: str) -> str | None:
    """
    Fetch a single key from Consul KV (async version).
    
    Args:
        key: The key name (without prefix)
        
    Returns:
        The value as a string, or None if not found
    """
    url = f"{get_consul_url()}/v1/kv/{CONSUL_KV_PREFIX}{key}"
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=get_consul_headers(), timeout=5.0)
            
            if response.status_code == 404:
                return None
            
            response.raise_for_status()
            data = response.json()
            
            if data and len(data) > 0:
                # Consul returns base64-encoded values
                value_b64 = data[0].get("Value")
                if value_b64:
                    return base64.b64decode(value_b64).decode("utf-8")
            
            return None
            
    except httpx.HTTPError as e:
        logger.warning("Failed to fetch Consul key", key=key, error=str(e))
        return None
    except Exception as e:
        logger.warning("Error fetching Consul key", key=key, error=str(e))
        return None


def fetch_consul_kv_sync(key: str) -> str | None:
    """
    Fetch a single key from Consul KV (sync version).
    
    Args:
        key: The key name (without prefix)
        
    Returns:
        The value as a string, or None if not found
    """
    url = f"{get_consul_url()}/v1/kv/{CONSUL_KV_PREFIX}{key}"
    
    try:
        with httpx.Client() as client:
            response = client.get(url, headers=get_consul_headers(), timeout=5.0)
            
            if response.status_code == 404:
                return None
            
            response.raise_for_status()
            data = response.json()
            
            if data and len(data) > 0:
                value_b64 = data[0].get("Value")
                if value_b64:
                    return base64.b64decode(value_b64).decode("utf-8")
            
            return None
            
    except httpx.HTTPError as e:
        logger.warning("Failed to fetch Consul key", key=key, error=str(e))
        return None
    except Exception as e:
        logger.warning("Error fetching Consul key", key=key, error=str(e))
        return None


def fetch_all_consul_keys_sync() -> dict[str, str]:
    """
    Fetch all keys under the service prefix from Consul KV.
    
    Returns:
        Dictionary of key-value pairs
    """
    url = f"{get_consul_url()}/v1/kv/{CONSUL_KV_PREFIX}?recurse=true"
    
    try:
        with httpx.Client() as client:
            response = client.get(url, headers=get_consul_headers(), timeout=10.0)
            
            if response.status_code == 404:
                logger.info("No keys found in Consul", prefix=CONSUL_KV_PREFIX)
                return {}
            
            response.raise_for_status()
            data = response.json()
            
            result = {}
            for item in data or []:
                full_key = item.get("Key", "")
                value_b64 = item.get("Value")
                
                # Extract key name (remove prefix)
                if full_key.startswith(CONSUL_KV_PREFIX):
                    key_name = full_key[len(CONSUL_KV_PREFIX):]
                    if value_b64 and key_name:
                        result[key_name] = base64.b64decode(value_b64).decode("utf-8")
            
            return result
            
    except httpx.HTTPError as e:
        logger.warning("Failed to fetch Consul keys", prefix=CONSUL_KV_PREFIX, error=str(e))
        return {}
    except Exception as e:
        logger.warning("Error fetching Consul keys", prefix=CONSUL_KV_PREFIX, error=str(e))
        return {}


def load_config_from_consul() -> tuple[list[str], list[str]]:
    """
    Load configuration from Consul KV and inject into environment variables.
    
    This should be called at application startup, before Settings are loaded.
    
    Returns:
        Tuple of (consul_loaded_keys, env_loaded_keys)
    """
    if not CONSUL_ENABLED:
        logger.info("Consul configuration disabled, using environment variables only")
        return [], []
    
    logger.info(
        "Loading configuration from Consul",
        consul_url=get_consul_url(),
        service_name=CONSUL_SERVICE_NAME,
        prefix=CONSUL_KV_PREFIX,
    )
    
    # Fetch all keys from Consul
    consul_config = fetch_all_consul_keys_sync()
    
    consul_loaded_keys = []
    env_loaded_keys = []
    
    # Inject Consul values into environment (they take precedence)
    for key, value in consul_config.items():
        os.environ[key] = value
        consul_loaded_keys.append(key)
        logger.debug("Loaded from Consul", key=key)
    
    # Track which keys came from existing environment variables
    # (These are keys that weren't in Consul but exist in env)
    # Note: We only track this for logging purposes
    env_only_keys = set(os.environ.keys()) - set(consul_loaded_keys)
    
    logger.info(
        "Configuration loaded",
        consul_keys_count=len(consul_loaded_keys),
        consul_keys=consul_loaded_keys,
    )
    
    return consul_loaded_keys, list(env_only_keys)


def check_consul_health() -> bool:
    """Check if Consul is reachable and healthy."""
    url = f"{get_consul_url()}/v1/status/leader"
    
    try:
        with httpx.Client() as client:
            response = client.get(url, headers=get_consul_headers(), timeout=5.0)
            return response.status_code == 200
    except Exception:
        return False


def wait_for_consul(max_attempts: int = 30, delay: float = 2.0) -> bool:
    """
    Wait for Consul to become available.
    
    Args:
        max_attempts: Maximum number of connection attempts
        delay: Delay between attempts in seconds
        
    Returns:
        True if Consul became available, False otherwise
    """
    import time
    
    logger.info("Waiting for Consul to be ready", consul_url=get_consul_url())
    
    for attempt in range(1, max_attempts + 1):
        if check_consul_health():
            logger.info("Consul is ready", attempts=attempt)
            return True
        
        logger.info(
            "Consul not ready, retrying",
            attempt=attempt,
            max_attempts=max_attempts,
        )
        time.sleep(delay)
    
    logger.error(
        "Consul did not become ready",
        max_attempts=max_attempts,
    )
    return False


# Type coercion utilities (matching ConsulConfigLoader pattern)
def coerce_bool(value: str | bool | None) -> bool:
    """Convert string value to boolean."""
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return value.lower() in ("true", "1", "yes", "on")


def coerce_int(value: str | int | None, default: int = 0) -> int:
    """Convert string value to integer."""
    if isinstance(value, int):
        return value
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def coerce_float(value: str | float | None, default: float = 0.0) -> float:
    """Convert string value to float."""
    if isinstance(value, float):
        return value
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def coerce_list(value: str | list | None, separator: str = ",") -> list[str]:
    """Convert comma-separated string to list."""
    if isinstance(value, list):
        return value
    if value is None or value == "":
        return []
    return [item.strip() for item in value.split(separator) if item.strip()]
