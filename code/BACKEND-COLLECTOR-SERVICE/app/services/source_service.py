"""
소스 관리 서비스

데이터 수집 소스를 관리하는 서비스입니다.
"""

from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from datetime import datetime
import uuid
import hashlib


class SourceService:
    """
    데이터 소스 관리 서비스 클래스

    주의: 현재 구현은 데모 목적의 하드코딩된 소스 목록을 반환합니다.
    실제 환경에서는 DB 모델과 연동하여 CRUD를 수행하도록 확장해야 합니다.
    """
    
    def __init__(self, db: Session):
        self.db = db
    
    def list_sources(self, source_type: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        등록된 데이터 소스 목록을 조회합니다.

        Args:
            source_type: 소스 타입 필터 (예: 'rss', 'web', 'api')

        Returns:
            소스 사전의 리스트
        """
        # 실제 국민연금 관련 소스
        sources = [
            {
                "id": 1,
                "name": "국민연금공단 공식",
                "source_type": "web",
                "url": "https://www.nps.or.kr",
                "is_active": True,
                "collection_frequency": 3600,  # 1시간마다
                "created_at": datetime.now(),
                "last_collected": None,
                "updated_at": None,
                "metadata_json": {"official": True}
            },
            {
                "id": 2,
                "name": "보건복지부",
                "source_type": "web",
                "url": "https://www.mohw.go.kr",
                "is_active": True,
                "collection_frequency": 3600,
                "created_at": datetime.now(),
                "last_collected": None,
                "updated_at": None,
                "metadata_json": {"official": True}
            },
            {
                "id": 3,
                "name": "국민연금공단 RSS",
                "source_type": "rss",
                "url": "https://www.nps.or.kr/jsppage/cyber_pr/news/rss.jsp",
                "is_active": True,
                "collection_frequency": 1800,  # 30분마다
                "created_at": datetime.now(),
                "last_collected": None,
                "updated_at": None,
                "metadata_json": {"feed_type": "rss"}
            },
            {
                "id": 4,
                "name": "보건복지부 RSS",
                "source_type": "rss",
                "url": "https://www.mohw.go.kr/rss/news.xml",
                "is_active": True,
                "collection_frequency": 1800,
                "created_at": datetime.now(),
                "last_collected": None,
                "updated_at": None,
                "metadata_json": {"feed_type": "rss"}
            },
            {
                "id": 5,
                "name": "네이버 뉴스 검색",
                "source_type": "web",
                "url": "https://search.naver.com/search.naver?where=news&query=국민연금",
                "is_active": True,
                "collection_frequency": 7200,  # 2시간마다
                "created_at": datetime.now(),
                "last_collected": None,
                "updated_at": None,
                "metadata_json": {"search_query": "국민연금"}
            },
            {
                "id": 6,
                "name": "다음 뉴스 검색",
                "source_type": "web",
                "url": "https://search.daum.net/search?w=news&q=국민연금",
                "is_active": True,
                "collection_frequency": 7200,
                "created_at": datetime.now(),
                "last_collected": None,
                "updated_at": None,
                "metadata_json": {"search_query": "국민연금"}
            }
        ]
        
        if source_type:
            sources = [s for s in sources if s["source_type"] == source_type]
        
        return sources
    
    def get_sources(self, skip: int = 0, limit: int = 100, active_only: bool = None) -> List[Dict[str, Any]]:
        """
        데이터 소스 목록을 페이지네이션과 활성 여부 필터로 조회합니다.

        Args:
            skip: 건너뛸 항목 수
            limit: 최대 반환 항목 수
            active_only: True이면 활성 소스만, False이면 비활성 소스만, None이면 전체

        Returns:
            소스 목록 리스트
        """
        sources = self.list_sources()
        
        if active_only is not None:
            sources = [s for s in sources if s["is_active"] == active_only]
        
        return sources[skip:skip + limit]
    
    def get_source(self, source_id: str) -> Optional[Dict[str, Any]]:
        """
        주어진 ID에 해당하는 소스 상세 정보를 조회합니다.

        Args:
            source_id: 소스 ID

        Returns:
            소스 사전 또는 None
        """
        sources = self.list_sources()
        for source in sources:
            if source["id"] == source_id:
                return source
        return None
    
    def create_source(self, source_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        새 데이터 소스를 등록합니다. (데모: 인메모리 시뮬레이션)

        Args:
            source_data: 생성할 소스 정보(dict)

        Returns:
            생성된 소스 사전
        """
        new_source = {
            "id": source_data.get("id", str(uuid.uuid4())),
            "name": source_data.get("name"),
            "type": source_data.get("type", "web"),
            "url": source_data.get("url"),
            "config": source_data.get("config", {}),
            "is_active": source_data.get("is_active", True),
            "created_at": datetime.now().isoformat()
        }
        
        # 실제로는 DB에 저장
        # self.db.add(...)
        # self.db.commit()
        
        return new_source
    
    def update_source(self, source_id: str, update_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        기존 소스 정보를 업데이트합니다. (데모: 인메모리 시뮬레이션)

        Args:
            source_id: 소스 ID
            update_data: 변경할 필드 값들

        Returns:
            업데이트된 소스 사전 또는 None
        """
        source = self.get_source(source_id)
        if source:
            source.update(update_data)
            source["updated_at"] = datetime.now().isoformat()
            return source
        return None
    
    def delete_source(self, source_id: str) -> bool:
        """
        소스를 삭제합니다. (데모: 인메모리 시뮬레이션)

        Args:
            source_id: 소스 ID

        Returns:
            삭제 성공 여부
        """
        source = self.get_source(source_id)
        if source:
            # 실제로는 DB에서 삭제
            # self.db.delete(...)
            # self.db.commit()
            return True
        return False
    
    def test_source(self, source_id: str) -> Dict[str, Any]:
        """
        소스 URL에 대한 연결 테스트를 수행합니다.

        Args:
            source_id: 소스 ID

        Returns:
            연결 테스트 결과 사전(성공 여부, 상태 코드 등)
        """
        source = self.get_source(source_id)
        if not source:
            return {"success": False, "message": "Source not found"}
        
        # 실제로는 URL 연결 테스트 수행
        import requests
        try:
            response = requests.head(source["url"], timeout=5)
            return {
                "success": response.status_code < 400,
                "status_code": response.status_code,
                "message": "Connection successful" if response.status_code < 400 else f"HTTP {response.status_code}"
            }
        except Exception as e:
            return {
                "success": False,
                "message": str(e)
            }
