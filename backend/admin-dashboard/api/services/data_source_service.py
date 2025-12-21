"""
Data Source Management Service
데이터 소스 CRUD 및 관리 서비스
"""

import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional
import json
import yaml

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore

from ..models.schemas import (
    DataSource,
    DataSourceCreate,
    DataSourceUpdate,
    DataSourceType,
    DataSourceStatus,
    DataSourceStats,
    DataSourceTestResult,
)


class DataSourceService:
    """데이터 소스 관리 서비스"""

    def __init__(
        self,
        project_root: str,
        config_dir: str,
        collector_service_url: Optional[str] = None,
    ):
        self.project_root = Path(project_root)
        self.config_dir = Path(config_dir)
        self.config_file = self.config_dir / "data_sources.yaml"
        self._sources: dict[str, DataSource] = {}
        self.collector_service_url = collector_service_url or os.environ.get(
            "COLLECTOR_SERVICE_URL", "http://collector-service:8081"
        )
        self._load_sources()

    def _load_sources(self) -> None:
        """설정 파일에서 데이터 소스 로드"""
        if self.config_file.exists():
            with open(self.config_file, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
                for source_id, source_data in data.get("sources", {}).items():
                    try:
                        # Enum 변환
                        source_data["source_type"] = DataSourceType(
                            source_data.get("source_type", "rss")
                        )
                        source_data["status"] = DataSourceStatus(
                            source_data.get("status", "active")
                        )
                        # datetime 변환
                        for dt_field in ["created_at", "updated_at", "last_crawled_at"]:
                            if source_data.get(dt_field) and isinstance(
                                source_data[dt_field], str
                            ):
                                source_data[dt_field] = datetime.fromisoformat(
                                    source_data[dt_field]
                                )

                        self._sources[source_id] = DataSource(
                            id=source_id, **source_data
                        )
                    except Exception as e:
                        print(f"Error loading source {source_id}: {e}")

    def _save_sources(self) -> None:
        """데이터 소스를 설정 파일에 저장"""
        self.config_dir.mkdir(parents=True, exist_ok=True)

        data = {"sources": {}}
        for source_id, source in self._sources.items():
            source_dict = source.model_dump()
            # Enum을 문자열로 변환
            source_dict["source_type"] = (
                source_dict["source_type"].value
                if hasattr(source_dict["source_type"], "value")
                else source_dict["source_type"]
            )
            source_dict["status"] = (
                source_dict["status"].value
                if hasattr(source_dict["status"], "value")
                else source_dict["status"]
            )
            # datetime을 ISO 문자열로 변환
            for dt_field in ["created_at", "updated_at", "last_crawled_at"]:
                if source_dict.get(dt_field):
                    source_dict[dt_field] = (
                        source_dict[dt_field].isoformat()
                        if hasattr(source_dict[dt_field], "isoformat")
                        else source_dict[dt_field]
                    )
            # ID는 키로 사용하므로 제거
            del source_dict["id"]
            data["sources"][source_id] = source_dict

        with open(self.config_file, "w", encoding="utf-8") as f:
            yaml.dump(data, f, allow_unicode=True, default_flow_style=False)

    def list_sources(
        self,
        source_type: Optional[DataSourceType] = None,
        status: Optional[DataSourceStatus] = None,
        category: Optional[str] = None,
        is_active: Optional[bool] = None,
    ) -> list[DataSource]:
        """데이터 소스 목록 조회"""
        sources = list(self._sources.values())

        if source_type:
            sources = [s for s in sources if s.source_type == source_type]
        if status:
            sources = [s for s in sources if s.status == status]
        if category:
            sources = [s for s in sources if s.category == category]
        if is_active is not None:
            sources = [s for s in sources if s.is_active == is_active]

        return sorted(sources, key=lambda x: (-x.priority, x.name))

    def get_source(self, source_id: str) -> Optional[DataSource]:
        """특정 데이터 소스 조회"""
        return self._sources.get(source_id)

    def create_source(self, data: DataSourceCreate) -> DataSource:
        """새 데이터 소스 생성"""
        source_id = str(uuid.uuid4())[:8]
        now = datetime.utcnow()

        source = DataSource(
            id=source_id,
            name=data.name,
            source_type=data.source_type,
            url=data.url,
            description=data.description,
            category=data.category,
            language=data.language,
            is_active=data.is_active,
            crawl_interval_minutes=data.crawl_interval_minutes,
            priority=data.priority,
            config=data.config,
            status=DataSourceStatus.ACTIVE
            if data.is_active
            else DataSourceStatus.INACTIVE,
            created_at=now,
            updated_at=now,
        )

        self._sources[source_id] = source
        self._save_sources()
        return source

    def update_source(
        self, source_id: str, data: DataSourceUpdate
    ) -> Optional[DataSource]:
        """데이터 소스 수정"""
        source = self._sources.get(source_id)
        if not source:
            return None

        update_data = data.model_dump(exclude_unset=True)
        update_data["updated_at"] = datetime.utcnow()

        # is_active 변경 시 status도 업데이트
        if "is_active" in update_data:
            if update_data["is_active"]:
                update_data["status"] = DataSourceStatus.ACTIVE
            else:
                update_data["status"] = DataSourceStatus.INACTIVE

        for key, value in update_data.items():
            if hasattr(source, key):
                setattr(source, key, value)

        self._save_sources()
        return source

    def delete_source(self, source_id: str) -> bool:
        """데이터 소스 삭제"""
        if source_id in self._sources:
            del self._sources[source_id]
            self._save_sources()
            return True
        return False

    async def test_source(self, source_id: str) -> DataSourceTestResult:
        """데이터 소스 연결 테스트"""
        source = self._sources.get(source_id)
        if not source:
            return DataSourceTestResult(
                source_id=source_id,
                success=False,
                message="Source not found",
                tested_at=datetime.utcnow(),
            )

        if httpx is None:
            return DataSourceTestResult(
                source_id=source_id,
                success=False,
                message="httpx not installed",
                tested_at=datetime.utcnow(),
            )

        # 소스 URL에 직접 요청
        try:
            start_time = datetime.utcnow()
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(source.url)
                response_time = (datetime.utcnow() - start_time).total_seconds() * 1000

                if response.status_code == 200:
                    # 소스 타입에 따른 샘플 데이터 파싱
                    sample_data = None
                    if source.source_type == DataSourceType.RSS:
                        sample_data = {
                            "content_type": response.headers.get(
                                "content-type", "unknown"
                            )
                        }
                    elif source.source_type == DataSourceType.API:
                        try:
                            sample_data = response.json()
                        except Exception:
                            sample_data = {"raw_length": len(response.text)}

                    # 테스트 성공 시 상태 업데이트
                    source.status = DataSourceStatus.ACTIVE
                    self._save_sources()

                    return DataSourceTestResult(
                        source_id=source_id,
                        success=True,
                        message="Connection successful",
                        response_time_ms=response_time,
                        sample_data=sample_data,
                        tested_at=datetime.utcnow(),
                    )
                else:
                    return DataSourceTestResult(
                        source_id=source_id,
                        success=False,
                        message=f"HTTP {response.status_code}",
                        response_time_ms=response_time,
                        tested_at=datetime.utcnow(),
                    )
        except Exception as e:
            # 테스트 실패 시 상태 업데이트
            source.status = DataSourceStatus.ERROR
            self._save_sources()

            return DataSourceTestResult(
                source_id=source_id,
                success=False,
                message=f"Error: {str(e)}",
                tested_at=datetime.utcnow(),
            )

    async def trigger_crawl(self, source_id: str) -> dict:
        """데이터 수집 트리거"""
        source = self._sources.get(source_id)
        if not source:
            return {"success": False, "message": "Source not found"}

        if not source.is_active:
            return {"success": False, "message": "Source is not active"}

        if httpx is None:
            return {"success": False, "message": "httpx not installed"}

        # Collector Service에 수집 요청
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.collector_service_url}/api/v1/crawl/trigger",
                    json={
                        "source_id": source_id,
                        "source_url": source.url,
                        "source_type": source.source_type.value,
                    },
                )

                if response.status_code in [200, 202]:
                    source.last_crawled_at = datetime.utcnow()
                    self._save_sources()
                    return {"success": True, "message": "Crawl triggered successfully"}
                else:
                    return {
                        "success": False,
                        "message": f"Failed: HTTP {response.status_code}",
                    }
        except Exception as e:
            return {"success": False, "message": f"Error: {str(e)}"}

    def get_categories(self) -> list[str]:
        """모든 카테고리 목록 조회"""
        categories = set()
        for source in self._sources.values():
            if source.category:
                categories.add(source.category)
        return sorted(categories)

    def get_stats(self) -> dict:
        """데이터 소스 통계"""
        total = len(self._sources)
        active = sum(1 for s in self._sources.values() if s.is_active)
        by_type = {}
        by_status = {}

        for source in self._sources.values():
            type_key = source.source_type.value
            by_type[type_key] = by_type.get(type_key, 0) + 1

            status_key = source.status.value
            by_status[status_key] = by_status.get(status_key, 0) + 1

        total_articles = sum(s.total_articles for s in self._sources.values())

        return {
            "total_sources": total,
            "active_sources": active,
            "inactive_sources": total - active,
            "by_type": by_type,
            "by_status": by_status,
            "total_articles": total_articles,
        }

    def bulk_toggle_active(self, source_ids: list[str], is_active: bool) -> int:
        """여러 소스 활성화/비활성화"""
        updated = 0
        for source_id in source_ids:
            source = self._sources.get(source_id)
            if source:
                source.is_active = is_active
                source.status = (
                    DataSourceStatus.ACTIVE if is_active else DataSourceStatus.INACTIVE
                )
                source.updated_at = datetime.utcnow()
                updated += 1

        if updated > 0:
            self._save_sources()

        return updated
