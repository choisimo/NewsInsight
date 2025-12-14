"""
Shared Prometheus metrics module for Python microservices.

Usage:
    from shared.prometheus_metrics import setup_metrics, track_request_time, track_request

    # In your FastAPI app setup:
    setup_metrics(app, service_name="my-service")

    # Or manually track requests:
    with track_request_time("my_operation"):
        # do something
"""

import time
import os
from functools import wraps
from typing import Callable, Optional
from contextlib import contextmanager

from prometheus_client import (
    Counter,
    Histogram,
    Gauge,
    Info,
    generate_latest,
    CONTENT_TYPE_LATEST,
    REGISTRY,
    CollectorRegistry,
)
from fastapi import FastAPI, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.routing import Match


# Default labels for all metrics
DEFAULT_LABELS = ["service", "method", "endpoint", "status_code"]

# Service info
SERVICE_INFO = Info("service_info", "Service information")

# Request metrics
REQUEST_COUNT = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["service", "method", "endpoint", "status_code"],
)

REQUEST_LATENCY = Histogram(
    "http_request_duration_seconds",
    "HTTP request latency in seconds",
    ["service", "method", "endpoint"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)

REQUEST_IN_PROGRESS = Gauge(
    "http_requests_in_progress",
    "Number of HTTP requests in progress",
    ["service", "method", "endpoint"],
)

# Error metrics
ERROR_COUNT = Counter(
    "errors_total", "Total errors", ["service", "error_type", "endpoint"]
)

# Business metrics - can be extended per service
OPERATIONS_COUNT = Counter(
    "operations_total", "Total operations performed", ["service", "operation", "status"]
)

OPERATIONS_LATENCY = Histogram(
    "operation_duration_seconds",
    "Operation latency in seconds",
    ["service", "operation"],
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0),
)

# Queue/processing metrics
QUEUE_SIZE = Gauge("queue_size", "Current queue size", ["service", "queue_name"])

ITEMS_PROCESSED = Counter(
    "items_processed_total", "Total items processed", ["service", "processor", "status"]
)


class PrometheusMiddleware(BaseHTTPMiddleware):
    """FastAPI middleware for automatic request metrics collection."""

    def __init__(self, app: FastAPI, service_name: str):
        super().__init__(app)
        self.service_name = service_name

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        method = request.method

        # Get the matched route path (template) instead of actual path
        path = self._get_path_template(request)

        # Skip metrics endpoint itself
        if path == "/metrics":
            return await call_next(request)

        # Track in-progress requests
        REQUEST_IN_PROGRESS.labels(
            service=self.service_name, method=method, endpoint=path
        ).inc()

        start_time = time.time()
        status_code = 500  # Default to 500 in case of unhandled exception

        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        except Exception as e:
            ERROR_COUNT.labels(
                service=self.service_name, error_type=type(e).__name__, endpoint=path
            ).inc()
            raise
        finally:
            duration = time.time() - start_time

            REQUEST_COUNT.labels(
                service=self.service_name,
                method=method,
                endpoint=path,
                status_code=str(status_code),
            ).inc()

            REQUEST_LATENCY.labels(
                service=self.service_name, method=method, endpoint=path
            ).observe(duration)

            REQUEST_IN_PROGRESS.labels(
                service=self.service_name, method=method, endpoint=path
            ).dec()

    def _get_path_template(self, request: Request) -> str:
        """Get the path template from the router instead of the actual path."""
        for route in request.app.routes:
            match, _ = route.matches(request.scope)
            if match == Match.FULL:
                return getattr(route, "path", request.url.path)
        return request.url.path


def setup_metrics(
    app: FastAPI,
    service_name: str,
    version: str = "1.0.0",
    expose_endpoint: bool = True,
) -> None:
    """
    Set up Prometheus metrics for a FastAPI application.

    Args:
        app: FastAPI application instance
        service_name: Name of the service for metric labels
        version: Service version
        expose_endpoint: Whether to expose /metrics endpoint
    """
    # Set service info
    SERVICE_INFO.info(
        {
            "service": service_name,
            "version": version,
            "environment": os.getenv("ENVIRONMENT", "development"),
        }
    )

    # Add middleware
    app.add_middleware(PrometheusMiddleware, service_name=service_name)

    # Add metrics endpoint
    if expose_endpoint:

        @app.get("/metrics", include_in_schema=False)
        async def metrics():
            return Response(
                content=generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST
            )


@contextmanager
def track_request_time(service_name: str, operation: str):
    """
    Context manager to track operation duration.

    Usage:
        with track_request_time("my-service", "database_query"):
            result = db.query(...)
    """
    start_time = time.time()
    status = "success"
    try:
        yield
    except Exception:
        status = "error"
        raise
    finally:
        duration = time.time() - start_time
        OPERATIONS_LATENCY.labels(service=service_name, operation=operation).observe(
            duration
        )
        OPERATIONS_COUNT.labels(
            service=service_name, operation=operation, status=status
        ).inc()


def track_operation(service_name: str, operation: str):
    """
    Decorator to track function execution.

    Usage:
        @track_operation("my-service", "process_data")
        def process_data():
            ...
    """

    def decorator(func: Callable):
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            with track_request_time(service_name, operation):
                return await func(*args, **kwargs)

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            with track_request_time(service_name, operation):
                return func(*args, **kwargs)

        # Return appropriate wrapper based on function type
        import asyncio

        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper

    return decorator


def track_error(service_name: str, error_type: str, endpoint: str = "unknown") -> None:
    """Track an error occurrence."""
    ERROR_COUNT.labels(
        service=service_name, error_type=error_type, endpoint=endpoint
    ).inc()


def set_queue_size(service_name: str, queue_name: str, size: int) -> None:
    """Set current queue size gauge."""
    QUEUE_SIZE.labels(service=service_name, queue_name=queue_name).set(size)


def track_item_processed(
    service_name: str, processor: str, status: str = "success"
) -> None:
    """Track processed item."""
    ITEMS_PROCESSED.labels(
        service=service_name, processor=processor, status=status
    ).inc()


# Custom metrics factory for service-specific metrics
class ServiceMetrics:
    """
    Factory for creating service-specific metrics.

    Usage:
        metrics = ServiceMetrics("bot-detector")
        metrics.track_detection("ai_text", is_bot=True)
    """

    def __init__(self, service_name: str):
        self.service_name = service_name
        self._custom_counters = {}
        self._custom_histograms = {}
        self._custom_gauges = {}

    def create_counter(
        self, name: str, description: str, labels: Optional[list] = None
    ) -> Counter:
        """Create a custom counter metric."""
        full_name = f"{self.service_name.replace('-', '_')}_{name}"
        if full_name not in self._custom_counters:
            self._custom_counters[full_name] = Counter(
                full_name, description, labels or []
            )
        return self._custom_counters[full_name]

    def create_histogram(
        self,
        name: str,
        description: str,
        labels: Optional[list] = None,
        buckets: Optional[tuple] = None,
    ) -> Histogram:
        """Create a custom histogram metric."""
        full_name = f"{self.service_name.replace('-', '_')}_{name}"
        if full_name not in self._custom_histograms:
            self._custom_histograms[full_name] = Histogram(
                full_name,
                description,
                labels or [],
                buckets=buckets or (0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0),
            )
        return self._custom_histograms[full_name]

    def create_gauge(
        self, name: str, description: str, labels: Optional[list] = None
    ) -> Gauge:
        """Create a custom gauge metric."""
        full_name = f"{self.service_name.replace('-', '_')}_{name}"
        if full_name not in self._custom_gauges:
            self._custom_gauges[full_name] = Gauge(full_name, description, labels or [])
        return self._custom_gauges[full_name]
