"""
Service Health Monitoring Service
마이크로서비스 헬스 체크 및 상태 모니터링
"""

import asyncio
import os
from datetime import datetime
from pathlib import Path
from typing import Optional
import json

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore

from ..models.schemas import (
    ServiceHealthStatus,
    ServiceHealth,
    InfrastructureHealth,
    OverallSystemHealth,
)


class HealthService:
    """서비스 헬스 모니터링 서비스"""

    def __init__(self, project_root: str, config_dir: str):
        self.project_root = Path(project_root)
        self.config_dir = Path(config_dir)
        self.services_config_path = (
            self.project_root / "etc" / "configs" / "services.json"
        )
        self._services_config: Optional[dict] = None
        self._last_check: dict[str, ServiceHealth] = {}
        self.timeout = 5.0  # 헬스체크 타임아웃 (초)

    def _load_services_config(self) -> dict:
        """서비스 설정 로드"""
        if self._services_config is None:
            if self.services_config_path.exists():
                with open(self.services_config_path, "r") as f:
                    self._services_config = json.load(f)
            else:
                self._services_config = {
                    "services": {},
                    "infrastructure": {},
                    "service_urls": {},
                }
        return self._services_config or {}

    def get_all_services(self) -> list[dict]:
        """모든 서비스 목록 조회"""
        config = self._load_services_config()
        services = []

        # 메인 서비스
        for service_id, service_info in config.get("services", {}).items():
            services.append(
                {
                    "id": service_id,
                    "name": service_info.get("name", service_id),
                    "description": service_info.get("description", ""),
                    "port": service_info.get("port"),
                    "healthcheck": service_info.get("healthcheck", "/health"),
                    "hostname": service_info.get("hostname", service_id),
                    "type": "service",
                    "tags": service_info.get("consul", {}).get("tags", []),
                }
            )

        # ML 애드온
        for addon_id, addon_info in config.get("ml-addons", {}).items():
            services.append(
                {
                    "id": addon_id,
                    "name": addon_info.get("name", addon_id),
                    "description": f"ML Addon - {addon_info.get('name', addon_id)}",
                    "port": addon_info.get("port"),
                    "healthcheck": addon_info.get("healthcheck", "/health"),
                    "hostname": addon_id,
                    "type": "ml-addon",
                    "tags": ["ml", "addon"],
                }
            )

        return services

    def get_infrastructure_services(self) -> list[dict]:
        """인프라 서비스 목록 조회"""
        config = self._load_services_config()
        infra_services = []

        for infra_id, infra_info in config.get("infrastructure", {}).items():
            infra_services.append(
                {
                    "id": infra_id,
                    "name": infra_id.capitalize(),
                    "port": infra_info.get("port"),
                    "image": infra_info.get("image"),
                    "healthcheck": infra_info.get("healthcheck"),
                    "type": "infrastructure",
                }
            )

        return infra_services

    async def check_service_health(self, service_id: str) -> ServiceHealth:
        """단일 서비스 헬스 체크"""
        config = self._load_services_config()
        service_urls = config.get("service_urls", {})

        # 서비스 정보 찾기
        service_info = None
        for services_dict in [config.get("services", {}), config.get("ml-addons", {})]:
            if service_id in services_dict:
                service_info = services_dict[service_id]
                break

        if not service_info:
            return ServiceHealth(
                service_id=service_id,
                name=service_id,
                status=ServiceHealthStatus.UNKNOWN,
                message="Service not found in configuration",
                checked_at=datetime.utcnow(),
            )

        # 서비스 URL 결정
        base_url = service_urls.get(service_id)
        if not base_url:
            hostname = service_info.get("hostname", service_id)
            port = service_info.get("port", service_info.get("api_port"))
            base_url = f"http://{hostname}:{port}"

        healthcheck_path = service_info.get("healthcheck", "/health")
        health_url = f"{base_url}{healthcheck_path}"

        if httpx is None:
            return ServiceHealth(
                service_id=service_id,
                name=service_info.get("name", service_id),
                status=ServiceHealthStatus.UNKNOWN,
                message="httpx not installed",
                url=health_url,
                checked_at=datetime.utcnow(),
            )

        # 헬스 체크 수행
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                start_time = datetime.utcnow()
                response = await client.get(health_url)
                response_time_ms = (
                    datetime.utcnow() - start_time
                ).total_seconds() * 1000

                if response.status_code == 200:
                    status = ServiceHealthStatus.HEALTHY
                    message = "Service is healthy"
                    try:
                        health_data = response.json()
                    except Exception:
                        health_data = None
                elif response.status_code >= 500:
                    status = ServiceHealthStatus.UNHEALTHY
                    message = f"Server error: {response.status_code}"
                    health_data = None
                else:
                    status = ServiceHealthStatus.DEGRADED
                    message = f"Unexpected status: {response.status_code}"
                    health_data = None

                health = ServiceHealth(
                    service_id=service_id,
                    name=service_info.get("name", service_id),
                    status=status,
                    message=message,
                    response_time_ms=response_time_ms,
                    url=health_url,
                    checked_at=datetime.utcnow(),
                    details=health_data,
                )

        except Exception as e:
            error_type = type(e).__name__
            if "Timeout" in error_type:
                status = ServiceHealthStatus.UNHEALTHY
                message = "Connection timeout"
            elif "Connect" in error_type:
                status = ServiceHealthStatus.UNREACHABLE
                message = "Connection refused - service may be down"
            else:
                status = ServiceHealthStatus.UNKNOWN
                message = f"Error: {str(e)}"

            health = ServiceHealth(
                service_id=service_id,
                name=service_info.get("name", service_id),
                status=status,
                message=message,
                url=health_url,
                checked_at=datetime.utcnow(),
            )

        self._last_check[service_id] = health
        return health

    async def check_all_services_health(self) -> list[ServiceHealth]:
        """모든 서비스 헬스 체크 (병렬)"""
        services = self.get_all_services()

        # 병렬로 헬스 체크 수행
        tasks = [self.check_service_health(service["id"]) for service in services]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        health_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                health_results.append(
                    ServiceHealth(
                        service_id=services[i]["id"],
                        name=services[i]["name"],
                        status=ServiceHealthStatus.UNKNOWN,
                        message=f"Error: {str(result)}",
                        checked_at=datetime.utcnow(),
                    )
                )
            else:
                health_results.append(result)

        return health_results

    async def check_infrastructure_health(self) -> list[InfrastructureHealth]:
        """인프라 서비스 헬스 체크"""
        infra_services = self.get_infrastructure_services()
        results = []

        for infra in infra_services:
            infra_id = infra["id"]
            port = infra["port"]

            # 인프라별 헬스체크 수행
            if infra_id == "postgres":
                health = await self._check_postgres(port)
            elif infra_id == "mongo":
                health = await self._check_mongo(port)
            elif infra_id == "redis":
                health = await self._check_redis(port)
            elif infra_id == "consul":
                health = await self._check_consul(port)
            elif infra_id == "redpanda":
                health = await self._check_redpanda(port)
            else:
                health = InfrastructureHealth(
                    service_id=infra_id,
                    name=infra["name"],
                    status=ServiceHealthStatus.UNKNOWN,
                    message="Unknown infrastructure type",
                    checked_at=datetime.utcnow(),
                )

            results.append(health)

        return results

    async def _check_postgres(self, port: int) -> InfrastructureHealth:
        """PostgreSQL 헬스 체크"""
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection("postgres", port), timeout=self.timeout
            )
            writer.close()
            await writer.wait_closed()

            return InfrastructureHealth(
                service_id="postgres",
                name="PostgreSQL",
                status=ServiceHealthStatus.HEALTHY,
                message="PostgreSQL is accepting connections",
                port=port,
                checked_at=datetime.utcnow(),
            )
        except asyncio.TimeoutError:
            return InfrastructureHealth(
                service_id="postgres",
                name="PostgreSQL",
                status=ServiceHealthStatus.UNHEALTHY,
                message="Connection timeout",
                port=port,
                checked_at=datetime.utcnow(),
            )
        except Exception as e:
            return InfrastructureHealth(
                service_id="postgres",
                name="PostgreSQL",
                status=ServiceHealthStatus.UNREACHABLE,
                message=f"Connection failed: {str(e)}",
                port=port,
                checked_at=datetime.utcnow(),
            )

    async def _check_mongo(self, port: int) -> InfrastructureHealth:
        """MongoDB 헬스 체크"""
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection("mongo", port), timeout=self.timeout
            )
            writer.close()
            await writer.wait_closed()

            return InfrastructureHealth(
                service_id="mongo",
                name="MongoDB",
                status=ServiceHealthStatus.HEALTHY,
                message="MongoDB is accepting connections",
                port=port,
                checked_at=datetime.utcnow(),
            )
        except Exception as e:
            return InfrastructureHealth(
                service_id="mongo",
                name="MongoDB",
                status=ServiceHealthStatus.UNREACHABLE,
                message=f"Connection failed: {str(e)}",
                port=port,
                checked_at=datetime.utcnow(),
            )

    async def _check_redis(self, port: int) -> InfrastructureHealth:
        """Redis 헬스 체크"""
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection("redis", port), timeout=self.timeout
            )
            # Redis PING 명령
            writer.write(b"PING\r\n")
            await writer.drain()
            response = await asyncio.wait_for(reader.readline(), timeout=2.0)
            writer.close()
            await writer.wait_closed()

            if b"+PONG" in response:
                return InfrastructureHealth(
                    service_id="redis",
                    name="Redis",
                    status=ServiceHealthStatus.HEALTHY,
                    message="Redis is responding to PING",
                    port=port,
                    checked_at=datetime.utcnow(),
                )
            else:
                return InfrastructureHealth(
                    service_id="redis",
                    name="Redis",
                    status=ServiceHealthStatus.DEGRADED,
                    message="Redis connected but unexpected response",
                    port=port,
                    checked_at=datetime.utcnow(),
                )
        except Exception as e:
            return InfrastructureHealth(
                service_id="redis",
                name="Redis",
                status=ServiceHealthStatus.UNREACHABLE,
                message=f"Connection failed: {str(e)}",
                port=port,
                checked_at=datetime.utcnow(),
            )

    async def _check_consul(self, port: int) -> InfrastructureHealth:
        """Consul 헬스 체크"""
        if httpx is None:
            return InfrastructureHealth(
                service_id="consul",
                name="Consul",
                status=ServiceHealthStatus.UNKNOWN,
                message="httpx not installed",
                port=port,
                checked_at=datetime.utcnow(),
            )

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(f"http://consul:{port}/v1/status/leader")

                if response.status_code == 200:
                    leader = response.text.strip('"')
                    return InfrastructureHealth(
                        service_id="consul",
                        name="Consul",
                        status=ServiceHealthStatus.HEALTHY,
                        message=f"Consul leader: {leader}",
                        port=port,
                        checked_at=datetime.utcnow(),
                        details={"leader": leader},
                    )
                else:
                    return InfrastructureHealth(
                        service_id="consul",
                        name="Consul",
                        status=ServiceHealthStatus.DEGRADED,
                        message=f"Consul returned {response.status_code}",
                        port=port,
                        checked_at=datetime.utcnow(),
                    )
        except Exception as e:
            return InfrastructureHealth(
                service_id="consul",
                name="Consul",
                status=ServiceHealthStatus.UNREACHABLE,
                message=f"Connection failed: {str(e)}",
                port=port,
                checked_at=datetime.utcnow(),
            )

    async def _check_redpanda(self, port: int) -> InfrastructureHealth:
        """Redpanda/Kafka 헬스 체크"""
        if httpx is None:
            return InfrastructureHealth(
                service_id="redpanda",
                name="Redpanda",
                status=ServiceHealthStatus.UNKNOWN,
                message="httpx not installed",
                port=port,
                checked_at=datetime.utcnow(),
            )

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get("http://redpanda:9644/v1/status/ready")

                if response.status_code == 200:
                    return InfrastructureHealth(
                        service_id="redpanda",
                        name="Redpanda",
                        status=ServiceHealthStatus.HEALTHY,
                        message="Redpanda is ready",
                        port=port,
                        checked_at=datetime.utcnow(),
                    )
                else:
                    return InfrastructureHealth(
                        service_id="redpanda",
                        name="Redpanda",
                        status=ServiceHealthStatus.DEGRADED,
                        message=f"Redpanda returned {response.status_code}",
                        port=port,
                        checked_at=datetime.utcnow(),
                    )
        except Exception as e:
            return InfrastructureHealth(
                service_id="redpanda",
                name="Redpanda",
                status=ServiceHealthStatus.UNREACHABLE,
                message=f"Connection failed: {str(e)}",
                port=port,
                checked_at=datetime.utcnow(),
            )

    async def get_overall_health(self) -> OverallSystemHealth:
        """전체 시스템 헬스 상태 요약"""
        services_health = await self.check_all_services_health()
        infra_health = await self.check_infrastructure_health()

        # 통계 계산
        total_services = len(services_health)
        healthy_services = sum(
            1 for s in services_health if s.status == ServiceHealthStatus.HEALTHY
        )
        unhealthy_services = sum(
            1
            for s in services_health
            if s.status
            in [ServiceHealthStatus.UNHEALTHY, ServiceHealthStatus.UNREACHABLE]
        )
        degraded_services = sum(
            1 for s in services_health if s.status == ServiceHealthStatus.DEGRADED
        )

        total_infra = len(infra_health)
        healthy_infra = sum(
            1 for i in infra_health if i.status == ServiceHealthStatus.HEALTHY
        )

        # 전체 상태 결정
        if unhealthy_services > 0 or healthy_infra < total_infra:
            if healthy_services == 0:
                overall_status = ServiceHealthStatus.UNHEALTHY
            else:
                overall_status = ServiceHealthStatus.DEGRADED
        elif degraded_services > 0:
            overall_status = ServiceHealthStatus.DEGRADED
        else:
            overall_status = ServiceHealthStatus.HEALTHY

        # 평균 응답 시간 계산
        response_times = [
            s.response_time_ms
            for s in services_health
            if s.response_time_ms is not None
        ]
        avg_response_time = (
            sum(response_times) / len(response_times) if response_times else None
        )

        return OverallSystemHealth(
            status=overall_status,
            total_services=total_services,
            healthy_services=healthy_services,
            unhealthy_services=unhealthy_services,
            degraded_services=degraded_services,
            total_infrastructure=total_infra,
            healthy_infrastructure=healthy_infra,
            average_response_time_ms=avg_response_time,
            services=services_health,
            infrastructure=infra_health,
            checked_at=datetime.utcnow(),
        )

    def get_last_check(self, service_id: str) -> Optional[ServiceHealth]:
        """마지막 헬스 체크 결과 조회"""
        return self._last_check.get(service_id)
