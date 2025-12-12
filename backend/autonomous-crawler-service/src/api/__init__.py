"""REST API module for autonomous-crawler-service."""

# Lazy imports to avoid circular dependencies
__all__ = ["app", "create_app", "SSEManager", "SSEEventType"]


def __getattr__(name):
    """Lazy import for circular dependency prevention."""
    if name == "app":
        from src.api.server import app

        return app
    elif name == "create_app":
        from src.api.server import create_app

        return create_app
    elif name == "SSEManager":
        from src.api.sse import SSEManager

        return SSEManager
    elif name == "SSEEventType":
        from src.api.sse import SSEEventType

        return SSEEventType
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
