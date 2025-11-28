"""Kafka module for autonomous-crawler-service."""

from .consumer import BrowserTaskConsumer
from .producer import CrawlResultProducer
from .messages import BrowserTaskMessage, CrawlResultMessage

__all__ = [
    "BrowserTaskConsumer",
    "CrawlResultProducer",
    "BrowserTaskMessage",
    "CrawlResultMessage",
]
