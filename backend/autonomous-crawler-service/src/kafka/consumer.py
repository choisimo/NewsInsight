"""Kafka consumer for browser task messages."""

import asyncio
import json
from typing import AsyncGenerator, Callable, Awaitable

import structlog
from aiokafka import AIOKafkaConsumer
from aiokafka.errors import KafkaError

from src.config import Settings
from src.kafka.messages import BrowserTaskMessage

logger = structlog.get_logger(__name__)


class BrowserTaskConsumer:
    """Async Kafka consumer for browser task messages."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._consumer: AIOKafkaConsumer | None = None
        self._running = False

    async def start(self) -> None:
        """Start the Kafka consumer with retry logic."""
        kafka_settings = self.settings.kafka

        self._consumer = AIOKafkaConsumer(
            kafka_settings.browser_task_topic,
            bootstrap_servers=kafka_settings.bootstrap_servers,
            group_id=kafka_settings.consumer_group_id,
            auto_offset_reset=kafka_settings.auto_offset_reset,
            enable_auto_commit=kafka_settings.enable_auto_commit,
            max_poll_records=kafka_settings.max_poll_records,
            session_timeout_ms=kafka_settings.session_timeout_ms,
            heartbeat_interval_ms=kafka_settings.heartbeat_interval_ms,
            value_deserializer=lambda m: json.loads(m.decode("utf-8")),
        )

        # Retry connection with exponential backoff
        max_retries = 10
        retry_delay = 2
        for attempt in range(max_retries):
            try:
                await self._consumer.start()
                self._running = True
                logger.info(
                    "Kafka consumer started",
                    topic=kafka_settings.browser_task_topic,
                    group_id=kafka_settings.consumer_group_id,
                )
                return
            except Exception as e:
                if attempt < max_retries - 1:
                    logger.warning(
                        "Failed to connect to Kafka, retrying...",
                        attempt=attempt + 1,
                        max_retries=max_retries,
                        retry_delay=retry_delay,
                        error=str(e),
                    )
                    await asyncio.sleep(retry_delay)
                    retry_delay = min(retry_delay * 2, 30)  # Max 30 seconds
                else:
                    logger.error(
                        "Failed to connect to Kafka after all retries",
                        error=str(e),
                    )
                    raise

    async def stop(self) -> None:
        """Stop the Kafka consumer."""
        self._running = False
        if self._consumer:
            await self._consumer.stop()
            logger.info("Kafka consumer stopped")

    async def consume(self) -> AsyncGenerator[BrowserTaskMessage, None]:
        """
        Consume messages from Kafka topic.

        Yields BrowserTaskMessage objects. Caller is responsible for
        committing offsets after successful processing.
        """
        if not self._consumer:
            raise RuntimeError("Consumer not started. Call start() first.")

        while self._running:
            try:
                # Get batch of messages (max_poll_records=1 means one at a time)
                result = await self._consumer.getmany(timeout_ms=1000)

                for topic_partition, messages in result.items():
                    for msg in messages:
                        try:
                            task = BrowserTaskMessage.model_validate(msg.value)
                            logger.info(
                                "Received browser task",
                                job_id=task.job_id,
                                source_id=task.source_id,
                                seed_url=task.seed_url,
                                offset=msg.offset,
                            )
                            yield task

                            # Commit after successful processing
                            await self._consumer.commit()
                            logger.debug(
                                "Committed offset",
                                offset=msg.offset,
                                partition=topic_partition.partition,
                            )

                        except Exception as e:
                            logger.error(
                                "Failed to parse browser task message",
                                error=str(e),
                                raw_value=msg.value,
                            )
                            # Still commit to avoid infinite retry on malformed messages
                            await self._consumer.commit()

            except KafkaError as e:
                logger.error("Kafka consumer error", error=str(e))
                await asyncio.sleep(1)  # Back off on errors

    async def run_with_handler(
        self,
        handler: Callable[[BrowserTaskMessage], Awaitable[None]],
    ) -> None:
        """
        Run consumer with a message handler callback.

        Args:
            handler: Async function to process each message
        """
        async for task in self.consume():
            try:
                await handler(task)
            except Exception as e:
                logger.error(
                    "Handler failed for task",
                    job_id=task.job_id,
                    error=str(e),
                    exc_info=True,
                )
                # Continue processing next messages
