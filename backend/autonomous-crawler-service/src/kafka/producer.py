"""Kafka producer for crawl result messages."""

import json
from typing import Any

import structlog
from aiokafka import AIOKafkaProducer
from aiokafka.errors import KafkaError
from tenacity import retry, stop_after_attempt, wait_exponential

from src.config import Settings
from src.kafka.messages import CrawlResultMessage

logger = structlog.get_logger(__name__)


class CrawlResultProducer:
    """Async Kafka producer for crawl result messages."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._producer: AIOKafkaProducer | None = None

    async def start(self) -> None:
        """Start the Kafka producer."""
        self._producer = AIOKafkaProducer(
            bootstrap_servers=self.settings.kafka.bootstrap_servers,
            value_serializer=lambda v: json.dumps(v, default=str).encode("utf-8"),
            # Reliability settings matching Java producer
            acks="all",
            retries=3,
            retry_backoff_ms=1000,
            enable_idempotence=True,
        )

        await self._producer.start()
        logger.info(
            "Kafka producer started",
            bootstrap_servers=self.settings.kafka.bootstrap_servers,
        )

    async def stop(self) -> None:
        """Stop the Kafka producer."""
        if self._producer:
            await self._producer.stop()
            logger.info("Kafka producer stopped")

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
    )
    async def send_result(self, result: CrawlResultMessage) -> None:
        """
        Send a crawl result to Kafka.

        Args:
            result: CrawlResultMessage to send
        """
        if not self._producer:
            raise RuntimeError("Producer not started. Call start() first.")

        topic = self.settings.kafka.crawl_result_topic
        value = result.to_kafka_dict()

        try:
            # Use job_id as key for partitioning (all results for same job go to same partition)
            key = str(result.job_id).encode("utf-8")

            await self._producer.send_and_wait(
                topic=topic,
                value=value,
                key=key,
            )

            logger.info(
                "Sent crawl result",
                job_id=result.job_id,
                source_id=result.source_id,
                url=result.url,
                title=result.title[:50] if result.title else None,
            )

        except KafkaError as e:
            logger.error(
                "Failed to send crawl result",
                job_id=result.job_id,
                error=str(e),
            )
            raise

    async def send_batch(self, results: list[CrawlResultMessage]) -> tuple[int, int]:
        """
        Send multiple crawl results to Kafka.

        Args:
            results: List of CrawlResultMessage objects

        Returns:
            Tuple of (successful_count, failed_count)
        """
        success_count = 0
        fail_count = 0

        for result in results:
            try:
                await self.send_result(result)
                success_count += 1
            except Exception as e:
                logger.error(
                    "Failed to send result in batch",
                    job_id=result.job_id,
                    url=result.url,
                    error=str(e),
                )
                fail_count += 1

        logger.info(
            "Batch send completed",
            success=success_count,
            failed=fail_count,
            total=len(results),
        )

        return success_count, fail_count
