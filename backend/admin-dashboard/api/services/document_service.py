"""
Document Service - Markdown 문서 관리 서비스
"""
import os
from datetime import datetime
from pathlib import Path
from typing import Optional
from uuid import uuid4

import yaml

from ..models.schemas import Document, DocumentBase, DocumentCategory


class DocumentService:
    """문서 관리 서비스"""

    def __init__(self, project_root: str, config_dir: str):
        self.project_root = Path(project_root)
        self.config_dir = Path(config_dir)
        self.docs_dirs = [
            self.project_root / "docs",
            self.project_root / "etc" / "infra-guides",
        ]
        self.documents: dict[str, Document] = {}
        self._scan_documents()

    def _scan_documents(self) -> None:
        """문서 디렉토리 스캔"""
        config_file = self.config_dir / "documents.yaml"

        # 기존 설정 로드
        existing_config = {}
        if config_file.exists():
            with open(config_file) as f:
                data = yaml.safe_load(f) or {}
                for doc_data in data.get("documents", []):
                    existing_config[doc_data.get("file_path")] = doc_data

        # 문서 스캔
        for docs_dir in self.docs_dirs:
            if not docs_dir.exists():
                continue

            for md_file in docs_dir.rglob("*.md"):
                file_path = str(md_file.relative_to(self.project_root))
                abs_path = str(md_file)

                # 기존 설정이 있으면 사용
                if abs_path in existing_config:
                    doc_data = existing_config[abs_path]
                    doc = Document(**doc_data)
                else:
                    # 새 문서 생성
                    doc = self._create_document_from_file(md_file)

                self.documents[doc.id] = doc

        self._save_documents()

    def _create_document_from_file(self, file_path: Path) -> Document:
        """파일에서 문서 정보 생성"""
        doc_id = f"doc-{uuid4().hex[:8]}"
        rel_path = str(file_path.relative_to(self.project_root))

        # 파일명에서 제목 추출
        title = file_path.stem.replace("_", " ").replace("-", " ").title()

        # 카테고리 추론
        category = self._infer_category(file_path)

        # 태그 추론
        tags = self._infer_tags(file_path)

        # 관련 환경 추론
        related_envs = self._infer_environments(file_path)

        # 수정 시간
        stat = file_path.stat()
        last_modified = datetime.fromtimestamp(stat.st_mtime)

        return Document(
            id=doc_id,
            title=title,
            file_path=str(file_path),
            category=category,
            tags=tags,
            related_environments=related_envs,
            related_scripts=[],
            last_modified=last_modified,
        )

    def _infer_category(self, file_path: Path) -> DocumentCategory:
        """파일 경로에서 카테고리 추론"""
        path_str = str(file_path).lower()

        if "deploy" in path_str or "deployment" in path_str:
            return DocumentCategory.DEPLOYMENT
        elif "troubleshoot" in path_str or "debug" in path_str:
            return DocumentCategory.TROUBLESHOOTING
        elif "architecture" in path_str or "overview" in path_str:
            return DocumentCategory.ARCHITECTURE
        elif "runbook" in path_str or "guide" in path_str:
            return DocumentCategory.RUNBOOK
        else:
            return DocumentCategory.GENERAL

    def _infer_tags(self, file_path: Path) -> list[str]:
        """파일 경로에서 태그 추론"""
        tags = []
        path_str = str(file_path).lower()

        tag_keywords = [
            "docker",
            "kubernetes",
            "k8s",
            "consul",
            "cloudflare",
            "gcp",
            "aws",
            "api",
            "frontend",
            "backend",
            "database",
            "redis",
            "postgres",
            "mongo",
            "kafka",
        ]

        for keyword in tag_keywords:
            if keyword in path_str:
                tags.append(keyword)

        return tags

    def _infer_environments(self, file_path: Path) -> list[str]:
        """파일 경로에서 관련 환경 추론"""
        envs = []
        path_str = str(file_path).lower()

        env_keywords = {
            "zerotrust": "zerotrust",
            "local": "local",
            "gcp": "gcp",
            "aws": "aws",
            "production": "production",
            "staging": "staging",
            "pmx": "production",
        }

        for keyword, env in env_keywords.items():
            if keyword in path_str and env not in envs:
                envs.append(env)

        return envs

    def _save_documents(self) -> None:
        """문서 설정을 파일에 저장"""
        self.config_dir.mkdir(parents=True, exist_ok=True)
        config_file = self.config_dir / "documents.yaml"

        data = {
            "documents": [doc.model_dump(mode="json") for doc in self.documents.values()]
        }

        # content 필드는 저장하지 않음
        for doc_data in data["documents"]:
            doc_data.pop("content", None)

        with open(config_file, "w") as f:
            yaml.dump(data, f, default_flow_style=False, allow_unicode=True)

    def list_documents(
        self,
        category: Optional[DocumentCategory] = None,
        tag: Optional[str] = None,
        environment: Optional[str] = None,
        search: Optional[str] = None,
    ) -> list[Document]:
        """문서 목록 조회"""
        docs = list(self.documents.values())

        if category:
            docs = [d for d in docs if d.category == category]

        if tag:
            docs = [d for d in docs if tag in d.tags]

        if environment:
            docs = [d for d in docs if environment in d.related_environments]

        if search:
            search_lower = search.lower()
            docs = [
                d
                for d in docs
                if search_lower in d.title.lower()
                or any(search_lower in t.lower() for t in d.tags)
            ]

        return sorted(docs, key=lambda x: x.title)

    def get_document(self, doc_id: str) -> Optional[Document]:
        """문서 상세 조회 (내용 포함)"""
        doc = self.documents.get(doc_id)
        if not doc:
            return None

        # 파일 내용 읽기
        file_path = Path(doc.file_path)
        if file_path.exists():
            try:
                with open(file_path, encoding="utf-8") as f:
                    doc.content = f.read()
            except Exception:
                doc.content = "Error reading file content"

        return doc

    def get_document_by_path(self, file_path: str) -> Optional[Document]:
        """파일 경로로 문서 조회"""
        for doc in self.documents.values():
            if doc.file_path == file_path:
                return self.get_document(doc.id)
        return None

    def update_document_metadata(
        self,
        doc_id: str,
        title: Optional[str] = None,
        category: Optional[DocumentCategory] = None,
        tags: Optional[list[str]] = None,
        related_environments: Optional[list[str]] = None,
        related_scripts: Optional[list[str]] = None,
    ) -> Optional[Document]:
        """문서 메타데이터 수정"""
        doc = self.documents.get(doc_id)
        if not doc:
            return None

        if title is not None:
            doc.title = title
        if category is not None:
            doc.category = category
        if tags is not None:
            doc.tags = tags
        if related_environments is not None:
            doc.related_environments = related_environments
        if related_scripts is not None:
            doc.related_scripts = related_scripts

        self._save_documents()
        return doc

    def refresh_documents(self) -> int:
        """문서 목록 새로고침"""
        old_count = len(self.documents)
        self.documents.clear()
        self._scan_documents()
        return len(self.documents) - old_count

    def get_related_documents(
        self, environment: Optional[str] = None, script_id: Optional[str] = None
    ) -> list[Document]:
        """관련 문서 조회"""
        docs = []

        if environment:
            docs.extend(
                [d for d in self.documents.values() if environment in d.related_environments]
            )

        if script_id:
            docs.extend(
                [d for d in self.documents.values() if script_id in d.related_scripts]
            )

        # 중복 제거
        seen = set()
        unique_docs = []
        for doc in docs:
            if doc.id not in seen:
                seen.add(doc.id)
                unique_docs.append(doc)

        return unique_docs

    def get_categories_summary(self) -> dict[str, int]:
        """카테고리별 문서 수 요약"""
        summary = {}
        for doc in self.documents.values():
            cat = doc.category.value
            summary[cat] = summary.get(cat, 0) + 1
        return summary

    def get_tags_summary(self) -> dict[str, int]:
        """태그별 문서 수 요약"""
        summary = {}
        for doc in self.documents.values():
            for tag in doc.tags:
                summary[tag] = summary.get(tag, 0) + 1
        return summary
