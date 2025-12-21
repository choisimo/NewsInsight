"""
Kafka/Redpanda Monitoring Router
Kafka/Redpanda 클러스터 모니터링 API
"""

from fastapi import APIRouter, Depends, HTTPException

from ..models.schemas import (
    KafkaTopicInfo,
    KafkaConsumerGroupInfo,
    KafkaClusterInfo,
    UserRole,
)
from ..dependencies import get_current_user, require_role, get_kafka_service
from ..services.kafka_service import KafkaService

router = APIRouter(prefix="/kafka", tags=["Kafka/Redpanda Monitoring"])


@router.get("/cluster", response_model=KafkaClusterInfo)
async def get_cluster_info(
    service: KafkaService = Depends(get_kafka_service),
    current_user=Depends(get_current_user),
):
    """Kafka/Redpanda 클러스터 전체 정보 조회"""
    return await service.get_cluster_info()


@router.get("/topics", response_model=list[KafkaTopicInfo])
async def list_topics(
    service: KafkaService = Depends(get_kafka_service),
    current_user=Depends(get_current_user),
):
    """모든 토픽 목록 조회"""
    return await service.list_topics()


@router.get("/topics/{topic_name}", response_model=KafkaTopicInfo)
async def get_topic(
    topic_name: str,
    service: KafkaService = Depends(get_kafka_service),
    current_user=Depends(get_current_user),
):
    """특정 토픽 상세 정보"""
    topic = await service.get_topic_detail(topic_name)
    if not topic:
        raise HTTPException(status_code=404, detail=f"Topic not found: {topic_name}")
    return topic


@router.get("/consumer-groups", response_model=list[KafkaConsumerGroupInfo])
async def list_consumer_groups(
    service: KafkaService = Depends(get_kafka_service),
    current_user=Depends(get_current_user),
):
    """모든 컨슈머 그룹 조회"""
    return await service.list_consumer_groups()


@router.get("/consumer-groups/{group_id}", response_model=KafkaConsumerGroupInfo)
async def get_consumer_group(
    group_id: str,
    service: KafkaService = Depends(get_kafka_service),
    current_user=Depends(get_current_user),
):
    """특정 컨슈머 그룹 상세 정보"""
    group = await service.get_consumer_group_detail(group_id)
    if not group:
        raise HTTPException(
            status_code=404, detail=f"Consumer group not found: {group_id}"
        )
    return group


@router.get("/health")
async def check_health(
    service: KafkaService = Depends(get_kafka_service),
    current_user=Depends(get_current_user),
):
    """Kafka/Redpanda 헬스 체크"""
    return await service.check_health()
