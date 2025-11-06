"""
Collection Service: Minimal in-memory implementation to satisfy routes in app/routers/collections.py
This service simulates collection jobs and stores collected data in memory.
"""
from __future__ import annotations

import os
import threading
from typing import List, Optional, Dict, Any, Type
from dataclasses import dataclass
from datetime import datetime, timezone
import time
import hashlib
from urllib.parse import urlparse
import logging
import uuid
import requests
import numpy as np
import re
from abc import ABC, abstractmethod

import feedparser

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from app.schemas import (
    CollectionRequest,
    CollectionJob,
    CollectionStats,
    CollectedData,
    RawEvent,
    RawEventPayload,
    WebhookEventRequest,
)
from app.config import settings
from app.services.source_service import SourceService
from app.db import SessionLocal


logger = logging.getLogger(__name__)


def normalize_text(text: Optional[str]) -> str:
    """
    텍스트 내 연속된 공백/개행을 단일 공백으로 치환하여 정규화합니다.

    Args:
        text: 원본 텍스트(없으면 None)

    Returns:
        공백이 정리된 단일 라인 문자열
    """
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip()


def compute_content_hash(url: Optional[str], title: Optional[str], content: Optional[str]) -> str:
    """
    URL/제목/본문을 결합하여 SHA-256 해시를 생성합니다.

    Args:
        url: 원문 URL
        title: 문서 제목
        content: 본문 텍스트

    Returns:
        64자리 16진수 해시 문자열
    """
    hasher = hashlib.sha256()
    hasher.update((url or "").encode("utf-8"))
    hasher.update((title or "").encode("utf-8"))
    hasher.update((content or "").encode("utf-8"))
    return hasher.hexdigest()


def semantic_consistency_score(text: str) -> float:
    """
    사전 정의된 기대 키워드 대비 포함 비율로 의미 일관성 점수를 계산합니다.

    Args:
        text: 평가할 텍스트

    Returns:
        0~1 범위의 일관성 점수(키워드가 없으면 0.5)
    """
    if not text:
        return 0.0
    expected = getattr(settings, "qa_expected_keywords", []) or []
    total = len(expected)
    if total == 0:
        return 0.5
    present = sum(1 for kw in expected if kw in text)
    return round(present / total, 3)


def http_check(url: Optional[str]) -> bool:
    """
    URL에 대한 HEAD/GET 요청으로 접근 가능 여부를 점검합니다.

    주의: 화이트리스트 도메인만 허용합니다.

    Args:
        url: 확인할 URL

    Returns:
        접근 가능하면 True, 아니면 False
    """
    if not url:
        return False
    try:
        parsed = urlparse(url)
        whitelist = set(getattr(settings, "qa_domain_whitelist", []))
        if parsed.hostname not in whitelist:
            return False
        resp = requests.head(url, timeout=settings.request_timeout, allow_redirects=True, headers={"User-Agent": settings.user_agent})
        if 200 <= resp.status_code < 400:
            return True
        resp = requests.get(url, timeout=settings.request_timeout, allow_redirects=True, headers={"User-Agent": settings.user_agent})
        return 200 <= resp.status_code < 400
    except Exception:
        return False


def trust_score(url: str, http_ok: Optional[bool]) -> float:
    """
    도메인 화이트리스트 및 HTTP 접근 성공 여부를 기반으로 신뢰 점수 산출.

    Args:
        url: 평가할 URL
        http_ok: HTTP 체크 성공 여부(None은 미실행 의미)

    Returns:
        0.0~1.0 범위의 신뢰 점수
    """
    parsed = urlparse(url) if url else None
    hostname = parsed.hostname if parsed else None
    whitelist = set(getattr(settings, "qa_domain_whitelist", []))
    base = 0.9 if hostname in whitelist else 0.5
    if http_ok is True:
        base += 0.1
    return max(0.0, min(1.0, base))


def quality_score(
    *,
    http_ok: Optional[bool],
    has_content: bool,
    duplicate: bool,
    semantic_consistency: float,
    outlier_score: float,
) -> float:
    """
    수집 항목의 품질 지표를 종합하여 0~1 사이의 품질 점수로 환산합니다.

    Args:
        http_ok: HTTP 점검 성공 여부(None은 미실행)
        has_content: 본문 존재 여부
        duplicate: 중복 여부
        semantic_consistency: 의미 일관성(0~1)
        outlier_score: 이상치 점수(0~1, 높을수록 이상치)

    Returns:
        0.0~1.0 범위의 품질 점수
    """
    http_score = 1.0 if http_ok is True else (0.5 if http_ok is None else 0.0)
    content_score = 1.0 if has_content else 0.0
    duplicate_penalty = 1.0 if duplicate else 0.0
    outlier_penalty = max(0.0, min(1.0, outlier_score))
    sem = max(0.0, min(1.0, semantic_consistency))
    score = 0.25 * http_score + 0.25 * content_score + 0.3 * sem + 0.2 * (1.0 - outlier_penalty) - 0.2 * duplicate_penalty
    return max(0.0, min(1.0, round(score, 3)))


def parse_datetime(value: Any) -> Optional[datetime]:
    """
    문자열/naive datetime을 UTC 인지 시간으로 변환합니다.

    지원 형식: ISO-8601(끝이 'Z'인 경우 UTC로 변환)

    Args:
        value: datetime 또는 문자열 값

    Returns:
        변환된 timezone-aware datetime 또는 None
    """
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        candidate = value.strip()
        if candidate.endswith("Z"):
            candidate = candidate[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(candidate)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def navigate_path(data: Any, path: Optional[str]) -> Any:
    """
    중첩 dict/list에서 dot 표기 경로로 값을 탐색합니다.

    Args:
        data: 원본 데이터(dict 또는 list)
        path: 'a.b.0.c' 형태의 경로(없으면 전체 반환)

    Returns:
        탐색된 값(없으면 빈 리스트 또는 None에 준하는 값)
    """
    if not path:
        return data
    current = data
    for key in path.split('.'):
        if isinstance(current, list):
            try:
                index = int(key)
                current = current[index]
                continue
            except (ValueError, IndexError):
                return []
        if not isinstance(current, dict):
            return []
        current = current.get(key)
        if current is None:
            return []
    return current


class AdapterRegistry:
    """수집 소스 타입별 어댑터 클래스를 등록/해석하는 레지스트리."""
    def __init__(self) -> None:
        self._registry: Dict[str, Type["BaseAdapter"]] = {}

    def register(self, source_type: str, adapter_cls: Type["BaseAdapter"]) -> None:
        """
        어댑터 클래스를 소스 타입 키로 등록합니다.

        Args:
            source_type: 예) 'rss', 'api', 'web', 'webhook'
            adapter_cls: BaseAdapter를 상속한 구현 클래스
        """
        self._registry[source_type] = adapter_cls

    def resolve(self, source_type: Optional[str]) -> Optional[Type["BaseAdapter"]]:
        """
        소스 타입으로 등록된 어댑터 클래스를 조회합니다.

        Args:
            source_type: 소스 타입 문자열

        Returns:
            등록된 어댑터 클래스 또는 None
        """
        if not source_type:
            return None
        return self._registry.get(source_type)


class DeterministicJitter:
    @staticmethod
    def compute(key: str, attempt: int, scale: float) -> float:
        """
        키와 시도 횟수에 기반한 결정적 지터 값을 계산합니다.

        Args:
            key: 지터 계산에 사용될 문자열 키
            attempt: 재시도 횟수(0부터)
            scale: 지터 스케일 상한

        Returns:
            0~scale 범위의 부동소수 지터 값
        """
        digest = hashlib.sha256(f"{key}:{attempt}".encode("utf-8")).digest()
        value = int.from_bytes(digest[:2], "big") / 65535.0
        return scale * value


class BackoffPolicy:
    def __init__(
        self,
        *,
        base_delay: float = 0.5,
        max_delay: float = 8.0,
        max_attempts: int = 4,
    ) -> None:
        """
        지수 백오프 정책 초기화.

        Args:
            base_delay: 최초 지연(초)
            max_delay: 최대 지연 상한(초)
            max_attempts: 최대 재시도 횟수
        """
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.max_attempts = max_attempts

    def compute_delay(self, attempt: int, key: str) -> float:
        """
        현재 시도에 대한 지연 시간을 계산합니다(지터 포함).

        Args:
            attempt: 시도 횟수(0부터)
            key: 지터 계산용 키

        Returns:
            지연 시간(초)
        """
        base = min(self.max_delay, self.base_delay * (2 ** attempt))
        jitter = DeterministicJitter.compute(key, attempt, base * 0.5)
        return base + jitter

    def run(self, func, *, key: str):
        """
        지정 함수 실행을 실패 시 백오프 정책으로 재시도합니다.

        Args:
            func: 실행할 콜러블
            key: 지터 계산용 키

        Returns:
            func의 반환값

        Raises:
            마지막 예외(모든 재시도 실패 시)
        """
        last_exc: Optional[Exception] = None
        for attempt in range(self.max_attempts):
            try:
                return func()
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if attempt == self.max_attempts - 1:
                    break
                delay = self.compute_delay(attempt, key)
                time.sleep(delay)
        if last_exc:
            raise last_exc


class TokenBucketRateLimiter:
    def __init__(self, *, capacity: int, refill_rate_per_sec: float) -> None:
        """
        토큰 버킷 기반 레이트 리미터.

        Args:
            capacity: 버킷 최대 토큰 수
            refill_rate_per_sec: 초당 보충되는 토큰 수
        """
        self.capacity = max(1, capacity)
        self.refill_rate = max(0.1, refill_rate_per_sec)
        self._buckets: Dict[str, Dict[str, float]] = {}
        self._lock = threading.Lock()

    def _refill(self, bucket: Dict[str, float], now: float) -> None:
        """
        경과 시간에 따라 버킷에 토큰을 보충합니다.

        Args:
            bucket: 버킷 상태(dict)
            now: 현재 시각(monotonic)
        """
        elapsed = now - bucket["last"]
        if elapsed <= 0:
            return
        bucket["tokens"] = min(self.capacity, bucket["tokens"] + elapsed * self.refill_rate)
        bucket["last"] = now

    def try_acquire(self, key: str, tokens: float = 1.0) -> bool:
        """
        지정 키 버킷에서 토큰을 소모하여 처리 가능 여부를 판단합니다.

        Args:
            key: 버킷 식별 키
            tokens: 소모할 토큰 수(기본 1)

        Returns:
            토큰 확보 시 True, 부족 시 False
        """
        now = time.monotonic()
        with self._lock:
            bucket = self._buckets.setdefault(key, {"tokens": float(self.capacity), "last": now})
            self._refill(bucket, now)
            if bucket["tokens"] < tokens:
                return False
            bucket["tokens"] -= tokens
            return True


class SecretResolver:
    def resolve(self, secret_name: str) -> Optional[str]:
        """
        환경 변수에서 시크릿 값을 조회합니다.

        Args:
            secret_name: 환경 변수 이름

        Returns:
            조회된 시크릿 값 또는 None
        """
        if not secret_name:
            return None
        return os.getenv(secret_name)

    def inject_headers(self, config: Dict[str, Any], headers: Dict[str, str]) -> Dict[str, str]:
        """
        설정에 명시된 헤더-시크릿 매핑을 실제 헤더로 주입합니다.

        Args:
            config: 소스 메타데이터/설정
            headers: 기존 헤더

        Returns:
            시크릿이 주입된 헤더 사전
        """
        secret_headers = config.get("header_secrets", {}) if isinstance(config, dict) else {}
        for header, secret_name in secret_headers.items():
            value = self.resolve(secret_name)
            if value:
                headers[header] = value
        return headers


class SourceConfigLoader:
    def __init__(self, defaults: Optional[Dict[str, Any]] = None) -> None:
        """소스 메타데이터에서 어댑터 동작 설정을 로드하기 위한 로더."""
        self.defaults = defaults or {}

    def load(self, source: Dict[str, Any]) -> Dict[str, Any]:
        """
        소스의 metadata_json을 읽어 기본값과 병합한 구성 값을 반환합니다.

        Args:
            source: 소스 사전

        Returns:
            병합된 설정 값(dict)
        """
        metadata = source.get("metadata_json") or {}
        config = dict(self.defaults)
        if isinstance(metadata, dict):
            config.update(metadata)
        return config


@dataclass
class AdapterContext:
    rate_limiter: TokenBucketRateLimiter
    backoff: BackoffPolicy
    secret_resolver: SecretResolver
    config_loader: SourceConfigLoader


class BaseAdapter(ABC):
    """수집 소스 타입별 공통 인터페이스를 제공하는 어댑터 베이스 클래스."""
    adapter_name: str = "base"

    def __init__(self, source: Dict[str, Any], context: AdapterContext):
        """
        공통 초기화 로직: 소스/컨텍스트/설정 로드.

        Args:
            source: 소스 정의(dict)
            context: 어댑터 컨텍스트(레이트리미터/백오프/시크릿 등)
        """
        self.source = source
        self.context = context
        self.config = context.config_loader.load(source)

    @abstractmethod
    def fetch(self) -> List[RawEvent]:
        """
        소스에서 원시 이벤트를 수집하여 표준 `RawEvent` 목록으로 반환합니다.

        Returns:
            수집된 RawEvent 목록
        """
        ...


class RSSAdapter(BaseAdapter):
    adapter_name = "rss"

    def fetch(self) -> List[RawEvent]:
        """
        RSS 피드를 파싱하여 항목을 RawEvent로 변환합니다.

        Returns:
            변환된 RawEvent 목록(토큰 제한/요청 실패 시 빈 목록)
        """
        url = self.source.get("url")
        if not url:
            return []

        key = str(self.source.get("id"))
        if not self.context.rate_limiter.try_acquire(key):
            logger.info("RSS adapter throttled", extra={"source_id": key})
            return []

        def _parse():
            return feedparser.parse(url, request_headers={"User-Agent": settings.user_agent})

        parsed = self.context.backoff.run(_parse, key=url)
        events: List[RawEvent] = []
        for entry in getattr(parsed, "entries", []):
            title = entry.get("title") or ""
            summary = entry.get("summary") or entry.get("description") or ""
            body = normalize_text(summary)
            published_struct = entry.get("published_parsed") or entry.get("updated_parsed")
            published_at = None
            if published_struct:
                published_at = datetime.fromtimestamp(time.mktime(published_struct), tz=timezone.utc)

            payload = RawEventPayload(
                title=title,
                summary=summary,
                url=entry.get("link") or url,
                published_at=published_at,
                body=body,
                metadata={
                    "tags": [t.get("term") for t in entry.get("tags", []) if isinstance(t, dict) and t.get("term")],
                    "language": entry.get("language"),
                },
            )
            content_hash = compute_content_hash(payload.url, payload.title, payload.body)
            event = RawEvent(
                id=entry.get("id") or entry.get("guid") or str(uuid.uuid4()),
                source_id=self.source.get("id"),
                source_name=self.source.get("name", ""),
                collected_at=datetime.utcnow().replace(tzinfo=timezone.utc),
                payload=payload,
                content_hash=content_hash,
                adapter=self.adapter_name,
            )
            events.append(event)
        return events


class RESTPollingAdapter(BaseAdapter):
    adapter_name = "api"

    def fetch(self) -> List[RawEvent]:
        """
        REST API를 폴링하여 JSON 응답을 경로 기반으로 추출하고 RawEvent로 변환합니다.

        Returns:
            변환된 RawEvent 목록(토큰 제한/요청 실패/경로 불일치 시 빈 목록)
        """
        url = self.source.get("url")
        if not url:
            return []

        key = str(self.source.get("id"))
        if not self.context.rate_limiter.try_acquire(key):
            logger.info("REST adapter throttled", extra={"source_id": key})
            return []

        headers = {"User-Agent": settings.user_agent}
        headers = self.context.secret_resolver.inject_headers(self.config, headers)

        def _fetch():
            response = requests.get(url, timeout=settings.request_timeout, headers=headers)
            response.raise_for_status()
            return response.json()

        try:
            payload = self.context.backoff.run(_fetch, key=url)
        except Exception as exc:  # noqa: BLE001
            logger.warning("REST adapter request failed", extra={"url": url, "error": str(exc)})
            return []

        metadata = self.config
        items = navigate_path(payload, metadata.get("items_path"))
        if isinstance(items, dict):
            items = [items]
        if not isinstance(items, list):
            return []

        title_field = metadata.get("title_field", "title")
        summary_field = metadata.get("summary_field", "summary")
        body_field = metadata.get("body_field", "content")
        published_field = metadata.get("published_field", "published_at")
        url_field = metadata.get("url_field", "url")
        id_field = metadata.get("id_field", "id")

        events: List[RawEvent] = []
        for entry in items:
            if not isinstance(entry, dict):
                continue
            title = entry.get(title_field) or ""
            summary = entry.get(summary_field) or ""
            body = normalize_text(entry.get(body_field) or summary)
            published_at = parse_datetime(entry.get(published_field))
            payload = RawEventPayload(
                title=title,
                summary=summary,
                url=entry.get(url_field) or url,
                published_at=published_at,
                body=body,
                metadata={"raw": entry},
            )
            content_hash = compute_content_hash(payload.url, payload.title, payload.body)
            events.append(
                RawEvent(
                    id=str(entry.get(id_field) or uuid.uuid4()),
                    source_id=self.source.get("id"),
                    source_name=self.source.get("name", ""),
                    collected_at=datetime.utcnow().replace(tzinfo=timezone.utc),
                    payload=payload,
                    content_hash=content_hash,
                    adapter=self.adapter_name,
                )
            )
        return events


class WebPageAdapter(BaseAdapter):
    adapter_name = "web"

    def fetch(self) -> List[RawEvent]:
        """
        웹 페이지 HTML을 요청해 텍스트를 추출/정규화한 후 RawEvent로 반환합니다.

        Returns:
            변환된 RawEvent 단일 항목 리스트(실패 시 빈 목록)
        """
        url = self.source.get("url")
        if not url:
            return []

        key = str(self.source.get("id"))
        if not self.context.rate_limiter.try_acquire(key):
            logger.info("Web adapter throttled", extra={"source_id": key})
            return []

        headers = {"User-Agent": settings.user_agent}
        headers = self.context.secret_resolver.inject_headers(self.config, headers)

        def _fetch_html():
            response = requests.get(url, timeout=settings.request_timeout, headers=headers)
            response.raise_for_status()
            return response.text

        try:
            html = self.context.backoff.run(_fetch_html, key=url)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Web adapter request failed", extra={"url": url, "error": str(exc)})
            return []

        # 아주 간단한 태그 제거 (BS4 없이)
        text = re.sub(r"<script.*?>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<style.*?>.*?</style>", "", text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<[^>]+>", " ", text)
        body = normalize_text(text)

        payload = RawEventPayload(
            title=self.source.get("name", ""),
            summary=self.config.get("summary"),
            url=url,
            published_at=None,
            body=body,
            metadata={"source": "web_page"},
        )
        content_hash = compute_content_hash(url, payload.title, payload.body)
        return [
            RawEvent(
                id=str(uuid.uuid4()),
                source_id=self.source.get("id"),
                source_name=self.source.get("name", ""),
                collected_at=datetime.utcnow().replace(tzinfo=timezone.utc),
                payload=payload,
                content_hash=content_hash,
                adapter=self.adapter_name,
            )
        ]


class WebhookAdapter(BaseAdapter):
    adapter_name = "webhook"

    def __init__(self, source: Dict[str, Any], context: AdapterContext, raw_payload: Optional[Dict[str, Any]] = None):
        """
        외부에서 전달된 웹훅 페이로드를 바인딩하여 사용합니다.

        Args:
            source: 소스 정의(dict)
            context: 어댑터 컨텍스트
            raw_payload: 초기 웹훅 페이로드(옵션)
        """
        super().__init__(source, context)
        self.raw_payload = raw_payload or {}

    def bind_payload(self, payload: Dict[str, Any]) -> None:
        """
        런타임에 웹훅 페이로드를 교체/설정합니다.

        Args:
            payload: 원시 웹훅 데이터
        """
        self.raw_payload = payload

    def fetch(self) -> List[RawEvent]:
        """
        바인딩된 웹훅 이벤트를 표준 RawEvent 목록으로 변환합니다.

        Returns:
            변환된 RawEvent 목록(페이로드 없으면 빈 목록)
        """
        if not self.raw_payload:
            return []

        request_model = WebhookEventRequest(**self.raw_payload)
        events: List[RawEvent] = []
        extracted_source_name = request_model.source_name or self.source.get("name", "")

        for event in request_model.events:
            payload_body = event.body or event.summary or ""
            normalized_body = normalize_text(payload_body)
            published_at = event.published_at
            content_hash = compute_content_hash(event.url, event.title, normalized_body)

            raw_event = RawEvent(
                id=event.id or str(uuid.uuid4()),
                source_id=self.source.get("id"),
                source_name=extracted_source_name,
                collected_at=datetime.utcnow().replace(tzinfo=timezone.utc),
                payload=RawEventPayload(
                    title=event.title,
                    summary=event.summary,
                    url=event.url,
                    published_at=published_at,
                    body=normalized_body,
                    metadata=event.metadata,
                ),
                content_hash=content_hash,
                adapter=self.adapter_name,
            )
            events.append(raw_event)

        return events


class CollectionService:
    """
    수집 작업 관리 및 원시 이벤트→정규화 데이터 저장을 담당하는 서비스.

    주의: 현재 구현은 데모용 인메모리 저장소를 사용합니다.
    """
    # In-memory stores (class-level for simplicity)
    _jobs: List[CollectionJob] = []
    _data: List[CollectedData] = []
    _job_id_seq: int = 1
    _data_id_seq: int = 1
    _raw_events: List[RawEvent] = []
    _adapter_registry = AdapterRegistry()
    _adapter_registry.register("rss", RSSAdapter)
    _adapter_registry.register("api", RESTPollingAdapter)
    _adapter_registry.register("web", WebPageAdapter)
    _adapter_registry.register("webhook", WebhookAdapter)
    _backoff_policy = BackoffPolicy()
    _secret_resolver = SecretResolver()
    _config_loader = SourceConfigLoader()
    _rate_limiter = TokenBucketRateLimiter(
        capacity=max(1, settings.max_concurrent_requests),
        refill_rate_per_sec=max(0.5, settings.max_concurrent_requests / max(1, settings.collection_interval / 60)),
    )

    def __init__(self, db: Session):
        """
        서비스 인스턴스 초기화.

        Args:
            db: SQLAlchemy 세션(현재 인메모리 구현에서 제한적으로 사용)
        """
        self.db = db

    @classmethod
    def _resolve_source(cls, source_id: int) -> Optional[Dict[str, Any]]:
        """
        소스 서비스에서 주어진 ID의 소스 정의를 조회합니다.

        Args:
            source_id: 소스 ID

        Returns:
            소스 dict 또는 None
        """
        with SessionLocal() as db:
            service = SourceService(db)
            for src in service.list_sources():
                if src.get("id") == source_id:
                    return src
        return None

    @classmethod
    def _store_raw_events(cls, raw_events: List[RawEvent]) -> int:
        """
        RawEvent 목록을 정규화하여 중복/품질 검증을 거친 후 인메모리 데이터 저장소에 적재합니다.

        Args:
            raw_events: 수집된 원시 이벤트 목록

        Returns:
            저장된 항목 개수
        """
        if not raw_events:
            return 0

        existing_hashes = {d.content_hash for d in cls._data if d.content_hash}
        batch_hashes: set[str] = set()
        batch_items: List[CollectedData] = []

        for raw_event in raw_events:
            payload = raw_event.payload
            body = normalize_text(payload.body or payload.summary or "")
            content_hash = raw_event.content_hash or compute_content_hash(payload.url, payload.title, body)

            if content_hash in existing_hashes or content_hash in batch_hashes:
                continue

            if not body or len(body) < settings.qa_min_content_length:
                continue

            batch_hashes.add(content_hash)

            http_ok = http_check(payload.url) if settings.qa_enable_network_checks else None
            semantic_score = semantic_consistency_score(body)

            collected_at = raw_event.collected_at
            if collected_at.tzinfo:
                collected_at = collected_at.astimezone(timezone.utc).replace(tzinfo=None)

            published_at = payload.published_at
            if published_at and published_at.tzinfo:
                published_at = published_at.astimezone(timezone.utc).replace(tzinfo=None)

            item = CollectedData(
                id=cls._data_id_seq,
                source_id=raw_event.source_id,
                title=payload.title,
                content=body,
                url=payload.url,
                published_date=published_at,
                collected_at=collected_at,
                content_hash=content_hash,
                metadata_json={
                    "adapter": raw_event.adapter,
                    "raw_event_version": raw_event.version,
                    "raw_event_id": raw_event.id,
                    "source_name": raw_event.source_name,
                    "payload_metadata": payload.metadata,
                },
                processed=False,
                http_ok=http_ok,
                has_content=True,
                duplicate=False,
                normalized=True,
                semantic_consistency=semantic_score,
            )

            cls._data_id_seq += 1
            batch_items.append(item)

        if not batch_items:
            return 0

        lengths = np.array([len(it.content or "") for it in batch_items], dtype=float)
        mean = float(np.mean(lengths)) if len(lengths) else 0.0
        std = float(np.std(lengths)) if len(lengths) > 1 else 0.0

        for item in batch_items:
            z = abs(((len(item.content or "")) - mean) / std) if std > 1e-9 else 0.0
            item.outlier_score = min(1.0, z / 3.0)
            item.trust_score = trust_score(item.url, item.http_ok)
            item.quality_score = quality_score(
                http_ok=item.http_ok,
                has_content=item.has_content,
                duplicate=item.duplicate,
                semantic_consistency=item.semantic_consistency or 0.0,
                outlier_score=item.outlier_score or 0.0,
            )

        cls._data.extend(batch_items)
        return len(batch_items)

    async def start_collection(self, request: CollectionRequest, background_tasks: BackgroundTasks) -> List[CollectionJob]:
        """
        주어진 소스 ID 목록에 대해 비동기 수집 잡을 생성하고 백그라운드로 실행합니다.

        Args:
            request: 수집 요청(소스 ID 목록 포함)
            background_tasks: FastAPI 백그라운드 태스크 큐

        Returns:
            생성된 수집 잡 목록
        """
        source_ids = request.source_ids
        if not source_ids:
            # 기본값: 활성화된 모든 소스 대상
            try:
                source_ids = [src["id"] for src in SourceService(self.db).list_sources() if src.get("is_active", True)]
            except Exception:
                source_ids = [1]
        if not source_ids:
            return []

        jobs: List[CollectionJob] = []
        for sid in source_ids:
            job = CollectionJob(
                id=CollectionService._job_id_seq,
                source_id=sid,
                status="queued",
                started_at=None,
                completed_at=None,
                items_collected=0,
                error_message=None,
                created_at=datetime.utcnow(),
            )
            CollectionService._job_id_seq += 1
            CollectionService._jobs.append(job)
            background_tasks.add_task(self._run_collection_sync, job.id, sid)
            jobs.append(job)
        return jobs

    @classmethod
    def _run_collection_sync(cls, job_id: int, source_id: int) -> None:
        """
        실제 어댑터 실행과 저장을 수행하는 동기 작업(백그라운드에서 호출).

        Args:
            job_id: 실행할 잡 ID
            source_id: 대상 소스 ID
        """
        job = cls._get_job_internal(job_id)
        if not job:
            return
        job.status = "running"
        job.started_at = datetime.utcnow()

        try:
            source = cls._resolve_source(source_id)
        except Exception as exc:
            job.status = "failed"
            job.error_message = f"Source lookup failed: {exc}"
            job.completed_at = datetime.utcnow()
            return

        if not source:
            job.status = "failed"
            job.error_message = "Source not found"
            job.completed_at = datetime.utcnow()
            return

        adapter_cls = cls._adapter_registry.resolve(source.get("source_type"))
        if not adapter_cls:
            job.status = "failed"
            job.error_message = f"Adapter not registered for source_type={source.get('source_type')}"
            job.completed_at = datetime.utcnow()
            return

        context = AdapterContext(
            rate_limiter=cls._rate_limiter,
            backoff=cls._backoff_policy,
            secret_resolver=cls._secret_resolver,
            config_loader=cls._config_loader,
        )

        adapter = adapter_cls(source, context)
        raw_events = adapter.fetch()
        job.items_collected = cls._store_raw_events(raw_events)
        job.status = "completed"
        job.completed_at = datetime.utcnow()

    @classmethod
    def _get_job_internal(cls, job_id: int) -> Optional[CollectionJob]:
        """
        인메모리 잡 목록에서 ID로 잡을 조회합니다.

        Args:
            job_id: 잡 ID

        Returns:
            CollectionJob 또는 None
        """
        for j in cls._jobs:
            if j.id == job_id:
                return j
        return None

    def get_stats(self) -> CollectionStats:
        """
        현재 인메모리 데이터 기준 수집 통계를 계산합니다.

        Returns:
            CollectionStats 데이터 클래스
        """
        total_sources = len({d.source_id for d in CollectionService._data})
        active_sources = total_sources  # In-memory demo
        total_items_collected = len(CollectionService._data)
        today = datetime.utcnow().date()
        items_collected_today = sum(1 for d in CollectionService._data if d.collected_at.date() == today)
        last_collection = max((d.collected_at for d in CollectionService._data), default=None)
        return CollectionStats(
            total_sources=total_sources,
            active_sources=active_sources,
            total_items_collected=total_items_collected,
            items_collected_today=items_collected_today,
            last_collection=last_collection,
        )

    def get_jobs(self, skip: int = 0, limit: int = 100, status_filter: Optional[str] = None) -> List[CollectionJob]:
        """
        수집 잡 목록을 페이지네이션/상태 필터와 함께 조회합니다.

        Args:
            skip: 시작 오프셋
            limit: 최대 개수
            status_filter: 상태 필터(queued/running/completed/failed)

        Returns:
            CollectionJob 리스트
        """
        jobs = CollectionService._jobs
        if status_filter:
            jobs = [j for j in jobs if j.status == status_filter]
        return jobs[skip: skip + limit]

    def get_job(self, job_id: int) -> Optional[CollectionJob]:
        """
        단일 잡 상세 조회.

        Args:
            job_id: 잡 ID

        Returns:
            CollectionJob 또는 None
        """
        return CollectionService._get_job_internal(job_id)

    def get_collected_data(
        self,
        skip: int = 0,
        limit: int = 100,
        source_id: Optional[int] = None,
        processed: Optional[bool] = None,
    ) -> List[CollectedData]:
        """
        수집된 데이터 목록을 조건에 따라 반환합니다.

        Args:
            skip: 시작 오프셋
            limit: 최대 개수
            source_id: 소스 ID 필터
            processed: 처리 여부 필터

        Returns:
            CollectedData 리스트
        """
        data = CollectionService._data
        if source_id is not None:
            data = [d for d in data if d.source_id == source_id]
        if processed is not None:
            data = [d for d in data if d.processed == processed]
        return data[skip: skip + limit]

    def mark_processed(self, data_id: int) -> bool:
        """
        수집 데이터 항목을 처리 완료 상태로 표시합니다.

        Args:
            data_id: 데이터 ID

        Returns:
            성공 시 True, 미존재 시 False
        """
        for d in CollectionService._data:
            if d.id == data_id:
                d.processed = True
                return True
        return False

    def get_raw_events(self, limit: int = 100) -> List[RawEvent]:
        """
        최근 저장된 RawEvent를 조회합니다.

        Args:
            limit: 최대 반환 개수

        Returns:
            RawEvent 리스트(최신순 일부)
        """
        return CollectionService._raw_events[-limit:]
