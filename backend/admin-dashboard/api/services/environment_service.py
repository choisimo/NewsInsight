"""
Environment Service - 환경/프로필 관리 서비스
"""
import os
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Optional
from uuid import uuid4

import yaml

from ..models.schemas import (
    ContainerInfo,
    Environment,
    EnvironmentCreate,
    EnvironmentStatus,
    EnvironmentType,
    EnvironmentUpdate,
    ServiceStatus,
)


class EnvironmentService:
    """환경 관리 서비스"""

    def __init__(self, project_root: str, config_dir: str):
        self.project_root = Path(project_root)
        self.config_dir = Path(config_dir)
        self.environments: dict[str, Environment] = {}
        self._load_environments()

    def _load_environments(self) -> None:
        """설정 파일에서 환경 정보 로드"""
        config_file = self.config_dir / "environments.yaml"
        if config_file.exists():
            with open(config_file) as f:
                data = yaml.safe_load(f) or {}
                for env_data in data.get("environments", []):
                    env = Environment(**env_data)
                    self.environments[env.id] = env
        else:
            # 기본 환경 설정 생성
            self._create_default_environments()

    def _create_default_environments(self) -> None:
        """기본 환경 설정 생성"""
        docker_dir = self.project_root / "etc" / "docker"
        configs_dir = self.project_root / "etc" / "configs"

        default_envs = [
            {
                "id": "env-zerotrust",
                "name": "zerotrust",
                "env_type": EnvironmentType.ZEROTRUST,
                "description": "Cloudflare Zero Trust 기반 보안 환경",
                "compose_file": str(docker_dir / "docker-compose.zerotrust.yml"),
                "env_file": str(docker_dir / ".env"),
                "is_active": True,
                "priority": 100,
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow(),
            },
            {
                "id": "env-production",
                "name": "production",
                "env_type": EnvironmentType.PRODUCTION,
                "description": "프로덕션 환경",
                "compose_file": str(docker_dir / "docker-compose.production.yml"),
                "env_file": str(configs_dir / "production.env"),
                "is_active": True,
                "priority": 90,
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow(),
            },
            {
                "id": "env-staging",
                "name": "staging",
                "env_type": EnvironmentType.STAGING,
                "description": "스테이징 환경",
                "compose_file": str(docker_dir / "docker-compose.consul.yml"),
                "env_file": str(configs_dir / "staging.env"),
                "is_active": True,
                "priority": 80,
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow(),
            },
            {
                "id": "env-local",
                "name": "local",
                "env_type": EnvironmentType.LOCAL,
                "description": "로컬 개발 환경",
                "compose_file": str(docker_dir / "docker-compose.consul.yml"),
                "env_file": str(configs_dir / "development.env"),
                "is_active": True,
                "priority": 70,
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow(),
            },
        ]

        for env_data in default_envs:
            env = Environment(**env_data)
            self.environments[env.id] = env

        self._save_environments()

    def _save_environments(self) -> None:
        """환경 설정을 파일에 저장"""
        self.config_dir.mkdir(parents=True, exist_ok=True)
        config_file = self.config_dir / "environments.yaml"

        data = {
            "environments": [
                env.model_dump(mode="json") for env in self.environments.values()
            ]
        }

        with open(config_file, "w") as f:
            yaml.dump(data, f, default_flow_style=False, allow_unicode=True)

    def list_environments(self, active_only: bool = False) -> list[Environment]:
        """환경 목록 조회"""
        envs = list(self.environments.values())
        if active_only:
            envs = [e for e in envs if e.is_active]
        return sorted(envs, key=lambda x: -x.priority)

    def get_environment(self, env_id: str) -> Optional[Environment]:
        """환경 상세 조회"""
        return self.environments.get(env_id)

    def get_environment_by_name(self, name: str) -> Optional[Environment]:
        """이름으로 환경 조회"""
        for env in self.environments.values():
            if env.name == name:
                return env
        return None

    def create_environment(self, data: EnvironmentCreate) -> Environment:
        """환경 생성"""
        env_id = f"env-{uuid4().hex[:8]}"
        now = datetime.utcnow()

        env = Environment(
            id=env_id,
            created_at=now,
            updated_at=now,
            **data.model_dump(),
        )

        self.environments[env_id] = env
        self._save_environments()
        return env

    def update_environment(
        self, env_id: str, data: EnvironmentUpdate
    ) -> Optional[Environment]:
        """환경 수정"""
        env = self.environments.get(env_id)
        if not env:
            return None

        update_data = data.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(env, key, value)

        env.updated_at = datetime.utcnow()
        self._save_environments()
        return env

    def delete_environment(self, env_id: str) -> bool:
        """환경 삭제"""
        if env_id in self.environments:
            del self.environments[env_id]
            self._save_environments()
            return True
        return False

    def get_environment_status(self, env_id: str) -> Optional[EnvironmentStatus]:
        """환경의 컨테이너 상태 조회"""
        env = self.environments.get(env_id)
        if not env:
            return None

        containers = self._get_docker_containers(env)

        return EnvironmentStatus(
            environment_id=env.id,
            environment_name=env.name,
            containers=containers,
            total_containers=len(containers),
            running_containers=sum(
                1 for c in containers if c.status == ServiceStatus.UP
            ),
        )

    def _get_docker_containers(self, env: Environment) -> list[ContainerInfo]:
        """Docker 컨테이너 상태 조회"""
        containers = []

        if not Path(env.compose_file).exists():
            return containers

        try:
            # docker compose ps 실행
            result = subprocess.run(
                [
                    "docker",
                    "compose",
                    "-f",
                    env.compose_file,
                    "-p",
                    "newsinsight",
                    "ps",
                    "--format",
                    "json",
                ],
                capture_output=True,
                text=True,
                timeout=30,
            )

            if result.returncode == 0 and result.stdout.strip():
                import json

                # 각 줄이 JSON 객체일 수 있음
                for line in result.stdout.strip().split("\n"):
                    if line.strip():
                        try:
                            container_data = json.loads(line)
                            status = self._parse_container_status(
                                container_data.get("State", "")
                            )
                            containers.append(
                                ContainerInfo(
                                    name=container_data.get("Name", "unknown"),
                                    image=container_data.get("Image", "unknown"),
                                    status=status,
                                    health=container_data.get("Health", None),
                                    ports=self._parse_ports(
                                        container_data.get("Ports", "")
                                    ),
                                )
                            )
                        except json.JSONDecodeError:
                            continue

        except subprocess.TimeoutExpired:
            pass
        except FileNotFoundError:
            pass

        return containers

    def _parse_container_status(self, state: str) -> ServiceStatus:
        """컨테이너 상태 파싱"""
        state_lower = state.lower()
        if "running" in state_lower:
            return ServiceStatus.UP
        elif "exited" in state_lower or "dead" in state_lower:
            return ServiceStatus.DOWN
        elif "starting" in state_lower or "created" in state_lower:
            return ServiceStatus.STARTING
        elif "stopping" in state_lower or "removing" in state_lower:
            return ServiceStatus.STOPPING
        return ServiceStatus.UNKNOWN

    def _parse_ports(self, ports_str: str) -> list[str]:
        """포트 문자열 파싱"""
        if not ports_str:
            return []
        return [p.strip() for p in ports_str.split(",") if p.strip()]

    async def docker_compose_up(
        self, env_id: str, build: bool = True, detach: bool = True
    ) -> tuple[bool, str]:
        """Docker Compose Up 실행"""
        env = self.environments.get(env_id)
        if not env:
            return False, "Environment not found"

        cmd = ["docker", "compose", "-f", env.compose_file, "-p", "newsinsight"]

        if build:
            cmd.extend(["up", "--build"])
        else:
            cmd.extend(["up"])

        if detach:
            cmd.append("-d")

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=600,  # 10분 타임아웃
                cwd=str(self.project_root),
            )
            return result.returncode == 0, result.stdout + result.stderr
        except subprocess.TimeoutExpired:
            return False, "Command timed out"
        except Exception as e:
            return False, str(e)

    async def docker_compose_down(
        self, env_id: str, volumes: bool = False
    ) -> tuple[bool, str]:
        """Docker Compose Down 실행"""
        env = self.environments.get(env_id)
        if not env:
            return False, "Environment not found"

        cmd = ["docker", "compose", "-f", env.compose_file, "-p", "newsinsight", "down"]

        if volumes:
            cmd.append("-v")

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,
                cwd=str(self.project_root),
            )
            return result.returncode == 0, result.stdout + result.stderr
        except subprocess.TimeoutExpired:
            return False, "Command timed out"
        except Exception as e:
            return False, str(e)

    async def docker_compose_restart(
        self, env_id: str, service: Optional[str] = None
    ) -> tuple[bool, str]:
        """Docker Compose Restart 실행"""
        env = self.environments.get(env_id)
        if not env:
            return False, "Environment not found"

        cmd = [
            "docker",
            "compose",
            "-f",
            env.compose_file,
            "-p",
            "newsinsight",
            "restart",
        ]

        if service:
            cmd.append(service)

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,
                cwd=str(self.project_root),
            )
            return result.returncode == 0, result.stdout + result.stderr
        except subprocess.TimeoutExpired:
            return False, "Command timed out"
        except Exception as e:
            return False, str(e)

    async def get_service_logs(
        self, env_id: str, service: str, tail: int = 100
    ) -> tuple[bool, str]:
        """서비스 로그 조회"""
        env = self.environments.get(env_id)
        if not env:
            return False, "Environment not found"

        cmd = [
            "docker",
            "compose",
            "-f",
            env.compose_file,
            "-p",
            "newsinsight",
            "logs",
            "--tail",
            str(tail),
            service,
        ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,
                cwd=str(self.project_root),
            )
            return result.returncode == 0, result.stdout + result.stderr
        except subprocess.TimeoutExpired:
            return False, "Command timed out"
        except Exception as e:
            return False, str(e)
