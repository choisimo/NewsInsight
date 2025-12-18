from __future__ import annotations

import time
from contextlib import contextmanager
from typing import Any, Callable, Iterable, Optional

from fastapi import FastAPI
from fastapi.responses import Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest


def setup_metrics(app: FastAPI, service_name: str, version: str = "") -> None:
    def metrics_endpoint() -> Response:
        payload = generate_latest()
        return Response(content=payload, media_type=CONTENT_TYPE_LATEST)

    app.add_api_route("/metrics", metrics_endpoint, methods=["GET"])


class ServiceMetrics:
    def __init__(self, service_name: str) -> None:
        self._service_name = service_name.replace("-", "_")

    def _full_name(self, metric_name: str) -> str:
        metric = metric_name.strip()
        if metric.startswith(f"{self._service_name}_"):
            return metric
        return f"{self._service_name}_{metric}"

    def create_counter(self, name: str, documentation: str, labelnames: Optional[Iterable[str]] = None) -> Counter:
        return Counter(self._full_name(name), documentation, labelnames=list(labelnames or []))

    def create_histogram(
        self,
        name: str,
        documentation: str,
        labelnames: Optional[Iterable[str]] = None,
        buckets: Optional[tuple[float, ...]] = None,
    ) -> Histogram:
        return Histogram(
            self._full_name(name),
            documentation,
            labelnames=list(labelnames or []),
            buckets=buckets,
        )

    def create_gauge(self, name: str, documentation: str, labelnames: Optional[Iterable[str]] = None) -> Gauge:
        return Gauge(self._full_name(name), documentation, labelnames=list(labelnames or []))


@contextmanager
def track_request_time(metric: Any, *label_values: Any, **label_kwargs: Any):
    start = time.time()
    try:
        yield
    finally:
        duration = time.time() - start
        try:
            if hasattr(metric, "labels"):
                metric.labels(*label_values, **label_kwargs).observe(duration)
            else:
                metric.observe(duration)
        except Exception:
            pass


def track_operation(counter: Any, *label_values: Any, **label_kwargs: Any) -> None:
    try:
        if hasattr(counter, "labels"):
            counter.labels(*label_values, **label_kwargs).inc()
        else:
            counter.inc()
    except Exception:
        pass


def track_error(counter: Any, *label_values: Any, **label_kwargs: Any) -> None:
    track_operation(counter, *label_values, **label_kwargs)


def track_item_processed(counter: Any, count: int = 1, *label_values: Any, **label_kwargs: Any) -> None:
    try:
        if hasattr(counter, "labels"):
            counter.labels(*label_values, **label_kwargs).inc(count)
        else:
            counter.inc(count)
    except Exception:
        pass
