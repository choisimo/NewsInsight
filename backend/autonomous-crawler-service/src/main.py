"""Main entry point for autonomous-crawler-service."""

import asyncio
import logging
import os
import signal
import sys
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import structlog
from prometheus_client import start_http_server

from src.config import Settings, get_settings
from src.config.consul import load_config_from_consul, wait_for_consul, CONSUL_ENABLED
from src.crawler import AutonomousCrawlerAgent
from src.kafka import BrowserTaskConsumer, CrawlResultProducer
from src.kafka.messages import BrowserTaskMessage
from src.metrics import (
    ARTICLES_EXTRACTED,
    BROWSER_SESSIONS_ACTIVE,
    KAFKA_MESSAGES_CONSUMED,
    KAFKA_MESSAGES_PRODUCED,
    TASK_DURATION,
    TASKS_COMPLETED,
    TASKS_IN_PROGRESS,
    TASKS_RECEIVED,
    init_service_info,
)


def configure_logging(settings: Settings) -> None:
    """Configure structured logging."""
    processors = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
    ]

    if settings.log_format == "json":
        processors.append(structlog.processors.JSONRenderer())
    else:
        processors.append(structlog.dev.ConsoleRenderer(colors=True))

    # Map log level string to logging module level
    log_level = getattr(logging, settings.log_level.upper(), logging.INFO)

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


class CrawlerService:
    """Main service class orchestrating the crawler components."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.logger = structlog.get_logger(__name__)
        self.consumer = BrowserTaskConsumer(settings)
        self.producer = CrawlResultProducer(settings)
        self.agent = AutonomousCrawlerAgent(settings)
        self._shutdown_event = asyncio.Event()

    async def start(self) -> None:
        """Start all service components."""
        self.logger.info("Starting autonomous-crawler-service")

        # Start metrics server
        if self.settings.metrics.enabled:
            start_http_server(self.settings.metrics.port)
            self.logger.info(
                "Metrics server started",
                port=self.settings.metrics.port,
            )

        # Initialize service info metrics
        init_service_info(
            version="0.1.0",
            llm_provider=self.settings.llm.provider,
        )

        # Start Kafka components
        await self.consumer.start()
        await self.producer.start()

        BROWSER_SESSIONS_ACTIVE.set(0)

        self.logger.info("Service started successfully")

    async def stop(self) -> None:
        """Stop all service components."""
        self.logger.info("Stopping autonomous-crawler-service")

        self._shutdown_event.set()

        await self.agent.close()
        await self.consumer.stop()
        await self.producer.stop()

        self.logger.info("Service stopped")

    async def handle_task(self, task: BrowserTaskMessage) -> None:
        """
        Handle a single browser task.

        Args:
            task: The browser task to process
        """
        import time

        start_time = time.time()
        policy = task.policy or "news_only"

        TASKS_RECEIVED.labels(policy=policy).inc()
        TASKS_IN_PROGRESS.inc()
        BROWSER_SESSIONS_ACTIVE.inc()
        KAFKA_MESSAGES_CONSUMED.labels(topic=self.settings.kafka.browser_task_topic).inc()

        self.logger.info(
            "Processing browser task",
            job_id=task.job_id,
            source_id=task.source_id,
            seed_url=task.seed_url,
            policy=policy,
        )

        status = "success"
        try:
            # Execute the crawl task
            results = await self.agent.execute_task(task)

            # Send results to Kafka
            for result in results:
                await self.producer.send_result(result)
                KAFKA_MESSAGES_PRODUCED.labels(
                    topic=self.settings.kafka.crawl_result_topic
                ).inc()
                ARTICLES_EXTRACTED.labels(source_id=str(task.source_id)).inc()

            self.logger.info(
                "Task completed",
                job_id=task.job_id,
                articles_extracted=len(results),
            )

        except Exception as e:
            status = "error"
            self.logger.error(
                "Task failed",
                job_id=task.job_id,
                error=str(e),
                exc_info=True,
            )

        finally:
            duration = time.time() - start_time
            TASK_DURATION.labels(policy=policy).observe(duration)
            TASKS_COMPLETED.labels(policy=policy, status=status).inc()
            TASKS_IN_PROGRESS.dec()
            BROWSER_SESSIONS_ACTIVE.dec()

    async def run(self) -> None:
        """Main run loop - consume and process tasks."""
        await self.start()

        try:
            await self.consumer.run_with_handler(self.handle_task)
        except asyncio.CancelledError:
            self.logger.info("Run loop cancelled")
        finally:
            await self.stop()


async def main_async() -> None:
    """Async main function."""
    # Load configuration from Consul (if enabled)
    consul_keys, env_keys = [], []
    if CONSUL_ENABLED:
        # Wait for Consul to be available
        if wait_for_consul(max_attempts=30, delay=2.0):
            consul_keys, env_keys = load_config_from_consul()
        else:
            print("WARNING: Consul not available, using environment variables only", file=sys.stderr)
    
    settings = get_settings()
    configure_logging(settings)

    logger = structlog.get_logger(__name__)
    logger.info(
        "Initializing autonomous-crawler-service",
        kafka_servers=settings.kafka.bootstrap_servers,
        llm_provider=settings.llm.provider,
        consul_enabled=CONSUL_ENABLED,
        consul_keys_loaded=len(consul_keys),
    )

    service = CrawlerService(settings)

    # Setup signal handlers
    loop = asyncio.get_running_loop()

    def signal_handler() -> None:
        logger.info("Received shutdown signal")
        asyncio.create_task(service.stop())

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, signal_handler)

    await service.run()


def main() -> None:
    """Main entry point."""
    try:
        asyncio.run(main_async())
    except KeyboardInterrupt:
        print("Interrupted")
        sys.exit(0)


if __name__ == "__main__":
    main()
