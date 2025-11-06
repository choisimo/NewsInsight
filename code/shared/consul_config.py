"""
Consul KV Configuration Loader

Production-ready configuration loader that integrates with HashiCorp Consul KV.
Provides fallback to environment variables with proper error handling.

Usage:
    from consul_config import ConsulConfigLoader
    
    loader = ConsulConfigLoader(
        service_name="api-gateway",
        consul_addr=os.getenv("CONSUL_HTTP_ADDR", "http://consul:8500"),
        consul_token=os.getenv("CONSUL_HTTP_TOKEN")
    )
    
    config = loader.load_config()
"""

import os
import logging
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field
import json

try:
    import consul  # type: ignore
except ImportError:
    consul = None  # type: ignore

logger = logging.getLogger(__name__)


@dataclass
class ConfigSource:
    """Track configuration value source for observability"""
    consul: int = 0
    environment: int = 0
    required_missing: List[str] = field(default_factory=list)


class ConsulConfigLoader:
    """
    Load configuration from Consul KV with fallback to environment variables.
    
    Precedence order:
    1. Consul KV (config/{service_name}/{KEY})
    2. Environment variables
    3. No defaults - all values must be provided
    """
    
    def __init__(
        self,
        service_name: str,
        consul_addr: Optional[str] = None,
        consul_token: Optional[str] = None,
        timeout: float = 5.0,
        required_keys: Optional[List[str]] = None
    ):
        """
        Initialize Consul config loader.
        
        Args:
            service_name: Service identifier for KV prefix (e.g., "api-gateway")
            consul_addr: Consul HTTP address (e.g., "http://consul:8500")
            consul_token: Consul ACL token for authentication
            timeout: Timeout for Consul operations in seconds
            required_keys: List of keys that must be present
        """
        self.service_name = service_name
        self.consul_addr = consul_addr or os.getenv("CONSUL_HTTP_ADDR")
        self.consul_token = consul_token or os.getenv("CONSUL_HTTP_TOKEN")
        self.timeout = timeout
        self.required_keys = required_keys or []
        
        self.kv_prefix = f"config/{service_name}/"
        self.consul_client = None
        self.config_cache: Dict[str, str] = {}
        self.source_tracker = ConfigSource()
        
        self._init_consul_client()
    
    def _init_consul_client(self):
        """Initialize Consul client with error handling"""
        if not consul:
            logger.warning(
                "python-consul2 not installed. Falling back to environment variables only."
            )
            return
        
        if not self.consul_addr:
            logger.warning(
                "CONSUL_HTTP_ADDR not set. Falling back to environment variables only."
            )
            return
        
        try:
            # Parse Consul address
            if self.consul_addr.startswith("http://"):
                host_port = self.consul_addr.replace("http://", "")
            elif self.consul_addr.startswith("https://"):
                host_port = self.consul_addr.replace("https://", "")
            else:
                host_port = self.consul_addr
            
            parts = host_port.split(":")
            host = parts[0]
            port = int(parts[1]) if len(parts) > 1 else 8500
            
            self.consul_client = consul.Consul(
                host=host,
                port=port,
                token=self.consul_token,
                timeout=self.timeout
            )
            
            # Test connection
            self.consul_client.agent.self()
            logger.info(f"Successfully connected to Consul at {self.consul_addr}")
            
        except Exception as e:
            logger.error(f"Failed to initialize Consul client: {e}")
            logger.warning("Falling back to environment variables only")
            self.consul_client = None
    
    def _load_from_consul(self) -> Dict[str, str]:
        """Load all keys from Consul KV with the service prefix"""
        if not self.consul_client:
            return {}
        
        config = {}
        
        try:
            # Get all keys under the service prefix
            index, data = self.consul_client.kv.get(self.kv_prefix, recurse=True)
            
            if not data:
                logger.warning(
                    f"No configuration found in Consul at prefix: {self.kv_prefix}"
                )
                return {}
            
            for item in data:
                key = item['Key']
                value = item['Value']
                
                # Extract the config key name (remove prefix)
                if key.startswith(self.kv_prefix):
                    config_key = key[len(self.kv_prefix):]
                    
                    # Decode value
                    if value is not None:
                        decoded_value = value.decode('utf-8')
                        config[config_key] = decoded_value
                        self.source_tracker.consul += 1
                        logger.debug(f"Loaded from Consul: {config_key}")
            
            logger.info(
                f"Loaded {len(config)} configuration values from Consul KV"
            )
            
        except Exception as e:
            logger.error(f"Error loading configuration from Consul: {e}")
        
        return config
    
    def _load_from_environment(self, consul_config: Dict[str, str]) -> Dict[str, str]:
        """
        Load configuration from environment variables.
        Only loads keys not already present in Consul config.
        """
        config = {}
        
        for key in self.required_keys:
            if key not in consul_config and key in os.environ:
                config[key] = os.environ[key]
                self.source_tracker.environment += 1
                logger.debug(f"Loaded from environment: {key}")
        
        # Also check for any additional environment variables
        # that match common patterns (all caps with underscores)
        for env_key, env_value in os.environ.items():
            if env_key.isupper() and '_' in env_key:
                if env_key not in consul_config and env_key not in config:
                    config[env_key] = env_value
                    self.source_tracker.environment += 1
        
        return config
    
    def load_config(self, validate: bool = True) -> Dict[str, str]:
        """
        Load configuration from all sources with proper precedence.
        
        Args:
            validate: Whether to validate required keys are present
            
        Returns:
            Dictionary of configuration key-value pairs
            
        Raises:
            ValueError: If required keys are missing and validate=True
        """
        # Load from Consul first
        consul_config = self._load_from_consul()
        
        # Load from environment (only for keys not in Consul)
        env_config = self._load_from_environment(consul_config)
        
        # Merge configurations (Consul takes precedence)
        final_config = {**env_config, **consul_config}
        
        # Cache the configuration
        self.config_cache = final_config
        
        # Validate required keys
        if validate:
            self._validate_config(final_config)
        
        # Log configuration summary
        self._log_config_summary()
        
        return final_config
    
    def _validate_config(self, config: Dict[str, str]):
        """Validate that all required keys are present"""
        missing_keys = []
        
        for key in self.required_keys:
            if key not in config or not config[key]:
                missing_keys.append(key)
                self.source_tracker.required_missing.append(key)
        
        if missing_keys:
            error_msg = (
                f"Missing required configuration keys for {self.service_name}: "
                f"{', '.join(missing_keys)}\n"
                f"These must be set in Consul KV at {self.kv_prefix}{{KEY}} "
                f"or as environment variables."
            )
            logger.error(error_msg)
            raise ValueError(error_msg)
    
    def _log_config_summary(self):
        """Log configuration loading summary"""
        logger.info(
            f"Configuration loaded for {self.service_name}: "
            f"{self.source_tracker.consul} from Consul, "
            f"{self.source_tracker.environment} from environment"
        )
        
        if self.source_tracker.required_missing:
            logger.error(
                f"Missing required keys: {', '.join(self.source_tracker.required_missing)}"
            )
    
    def get_config_source_info(self) -> Dict[str, Any]:
        """
        Get information about configuration sources for observability.
        
        Returns:
            Dictionary with source statistics
        """
        return {
            "service": self.service_name,
            "consul_connected": self.consul_client is not None,
            "consul_addr": self.consul_addr,
            "sources": {
                "consul": self.source_tracker.consul,
                "environment": self.source_tracker.environment,
            },
            "total_keys": len(self.config_cache),
            "missing_required": self.source_tracker.required_missing,
            "has_missing": len(self.source_tracker.required_missing) > 0
        }
    
    @staticmethod
    def coerce_bool(value: Any) -> bool:
        """Convert string value to boolean"""
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.lower() in ('true', '1', 'yes', 'on')
        return bool(value)
    
    @staticmethod
    def coerce_int(value: Any) -> int:
        """Convert string value to integer"""
        return int(value)
    
    @staticmethod
    def coerce_list(value: Any, separator: str = ",") -> List[str]:
        """Convert comma-separated string to list"""
        if isinstance(value, list):
            return value
        if isinstance(value, str):
            return [item.strip() for item in value.split(separator) if item.strip()]
        return []
    
    @staticmethod
    def coerce_json(value: Any) -> Any:
        """Parse JSON string"""
        if isinstance(value, str):
            return json.loads(value)
        return value


def create_loader(
    service_name: str,
    required_keys: Optional[List[str]] = None
) -> ConsulConfigLoader:
    """
    Convenience factory function to create a configured loader.
    
    Args:
        service_name: Service identifier
        required_keys: List of required configuration keys
        
    Returns:
        Configured ConsulConfigLoader instance
    """
    return ConsulConfigLoader(
        service_name=service_name,
        required_keys=required_keys or []
    )
