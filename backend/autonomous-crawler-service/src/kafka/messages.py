"""Kafka message schemas matching Java DTOs."""

import json
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class BrowserTaskMessage(BaseModel):
    """
    Kafka message for browser-based autonomous crawling tasks.
    Matches: com.newsinsight.collector.dto.BrowserTaskMessage
    """

    job_id: int = Field(..., alias="jobId", description="Unique job ID for tracking")
    source_id: int = Field(..., alias="sourceId", description="Data source ID")
    source_name: str | None = Field(
        default=None, alias="sourceName", description="Source name for logging/display"
    )
    seed_url: str = Field(..., alias="seedUrl", description="Seed URL to start exploration from")
    max_depth: int | None = Field(
        default=2, alias="maxDepth", description="Maximum link traversal depth"
    )
    max_pages: int | None = Field(
        default=10, alias="maxPages", description="Maximum pages to visit"
    )
    budget_seconds: int | None = Field(
        default=300, alias="budgetSeconds", description="Time budget in seconds"
    )
    policy: str | None = Field(
        default="NEWS_ONLY",
        description="Exploration policy (focused_topic, domain_wide, news_only, etc.)",
    )
    focus_keywords: str | None = Field(
        default=None, alias="focusKeywords", description="Focus keywords for FOCUSED_TOPIC policy"
    )
    custom_prompt: str | None = Field(
        default=None, alias="customPrompt", description="Custom prompt/instructions for AI agent"
    )
    capture_screenshots: bool | None = Field(
        default=False, alias="captureScreenshots", description="Whether to capture screenshots"
    )
    extract_structured: bool | None = Field(
        default=True, alias="extractStructured", description="Whether to extract structured data"
    )
    excluded_domains: str | None = Field(
        default=None, alias="excludedDomains", description="Domains to exclude"
    )
    callback_url: str | None = Field(
        default=None, alias="callbackUrl", description="Callback URL for session completion"
    )
    callback_token: str | None = Field(
        default=None, alias="callbackToken", description="Callback authentication token"
    )
    metadata: dict[str, Any] | None = Field(default=None, description="Additional metadata")
    created_at: datetime | None = Field(
        default=None, alias="createdAt", description="Task creation timestamp"
    )

    class Config:
        populate_by_name = True

    def get_excluded_domains_list(self) -> list[str]:
        """Parse excluded domains string into list."""
        if not self.excluded_domains:
            return []
        return [d.strip() for d in self.excluded_domains.split(",") if d.strip()]

    def get_focus_keywords_list(self) -> list[str]:
        """Parse focus keywords string into list."""
        if not self.focus_keywords:
            return []
        return [k.strip() for k in self.focus_keywords.split(",") if k.strip()]


class CrawlResultMessage(BaseModel):
    """
    Kafka message for crawl results.
    Matches: com.newsinsight.collector.dto.CrawlResultMessage

    기본 필드는 Java DTO와 호환되며, 추가 뉴스 메타데이터는 metadata_json에 JSON으로 저장됩니다.
    """

    job_id: int = Field(..., alias="jobId", description="Job ID this result belongs to")
    source_id: int = Field(..., alias="sourceId", description="Data source ID")
    title: str = Field(..., description="Article/page title")
    content: str = Field(..., description="Extracted content")
    url: str = Field(..., description="Page URL")
    published_at: str | None = Field(
        default=None, alias="publishedAt", description="Publication date as ISO string"
    )
    metadata_json: str | None = Field(
        default=None, alias="metadataJson", description="Additional metadata as JSON string"
    )

    class Config:
        populate_by_name = True

    def to_kafka_dict(self) -> dict[str, Any]:
        """Convert to Kafka-compatible dict with Java-style camelCase keys."""
        return {
            "jobId": self.job_id,
            "sourceId": self.source_id,
            "title": self.title,
            "content": self.content,
            "url": self.url,
            "publishedAt": self.published_at,
            "metadataJson": self.metadata_json,
        }


class NewsArticleMetadata(BaseModel):
    """
    뉴스 기사 전용 메타데이터.

    CrawlResultMessage.metadata_json에 JSON으로 직렬화되어 저장됩니다.
    Java 측에서는 이 JSON을 파싱하여 활용할 수 있습니다.
    """

    # 기자/작성자 정보
    authors: list[str] | None = Field(default=None, description="기사 작성자/기자 목록")
    author_email: str | None = Field(default=None, description="기자 이메일")

    # 분류 정보
    category: str | None = Field(default=None, description="뉴스 카테고리 (정치, 경제, 사회 등)")
    subcategory: str | None = Field(default=None, description="세부 카테고리")
    tags: list[str] | None = Field(default=None, description="기사 태그/키워드")

    # 콘텐츠 특성
    word_count: int | None = Field(default=None, description="본문 단어 수")
    reading_time_minutes: float | None = Field(default=None, description="예상 읽기 시간 (분)")
    language: str | None = Field(default="ko", description="기사 언어 코드")

    # 뉴스 특성
    is_breaking: bool = Field(default=False, description="속보 여부")
    is_exclusive: bool = Field(default=False, description="단독 기사 여부")
    is_opinion: bool = Field(default=False, description="오피니언/칼럼 여부")
    has_paywall: bool = Field(default=False, description="유료 구독 필요 여부")

    # 미디어 정보
    thumbnail_url: str | None = Field(default=None, description="대표 이미지 URL")
    image_urls: list[str] | None = Field(default=None, description="본문 이미지 URL 목록")
    video_urls: list[str] | None = Field(default=None, description="관련 동영상 URL 목록")

    # 관련 콘텐츠
    related_article_urls: list[str] | None = Field(default=None, description="관련 기사 URL 목록")

    # 소스 정보
    source_name: str | None = Field(default=None, description="언론사/매체명")
    source_bias: str | None = Field(default=None, description="정치 성향 (알려진 경우)")

    # 추출 품질
    extraction_confidence: float | None = Field(default=None, description="추출 신뢰도 (0.0-1.0)")
    missing_fields: list[str] | None = Field(default=None, description="추출 실패한 필드 목록")

    # 수집 정보
    crawled_at: str | None = Field(default=None, description="수집 시간 (ISO 형식)")
    crawl_method: str | None = Field(default=None, description="수집 방법 (ai_agent, rss, api)")

    def to_json(self) -> str:
        """JSON 문자열로 직렬화"""
        return self.model_dump_json(exclude_none=True)

    @classmethod
    def from_json(cls, json_str: str) -> "NewsArticleMetadata":
        """JSON 문자열에서 복원"""
        return cls.model_validate_json(json_str)


class EnhancedCrawlResultMessage(CrawlResultMessage):
    """
    확장된 크롤링 결과 메시지.

    기본 CrawlResultMessage와 호환되면서 뉴스 메타데이터를 편리하게 다룰 수 있습니다.
    """

    def set_news_metadata(self, metadata: NewsArticleMetadata) -> None:
        """뉴스 메타데이터 설정"""
        self.metadata_json = metadata.to_json()

    def get_news_metadata(self) -> Optional[NewsArticleMetadata]:
        """뉴스 메타데이터 조회"""
        if not self.metadata_json:
            return None
        try:
            return NewsArticleMetadata.from_json(self.metadata_json)
        except Exception:
            return None

    @classmethod
    def create_news_result(
        cls,
        job_id: int,
        source_id: int,
        url: str,
        title: str,
        content: str,
        published_at: str | None = None,
        authors: list[str] | None = None,
        category: str | None = None,
        is_breaking: bool = False,
        thumbnail_url: str | None = None,
        source_name: str | None = None,
        word_count: int | None = None,
        **extra_metadata,
    ) -> "EnhancedCrawlResultMessage":
        """
        뉴스 기사 결과 메시지를 편리하게 생성.

        Args:
            job_id: 작업 ID
            source_id: 소스 ID
            url: 기사 URL
            title: 기사 제목
            content: 기사 본문
            published_at: 발행일 (ISO 형식)
            authors: 기자 목록
            category: 카테고리
            is_breaking: 속보 여부
            thumbnail_url: 썸네일 URL
            source_name: 언론사명
            word_count: 단어 수
            **extra_metadata: 추가 메타데이터

        Returns:
            EnhancedCrawlResultMessage 인스턴스
        """
        # 단어 수 자동 계산
        if word_count is None and content:
            word_count = len(content.split())

        # 메타데이터 생성
        metadata = NewsArticleMetadata(
            authors=authors,
            category=category,
            is_breaking=is_breaking,
            thumbnail_url=thumbnail_url,
            source_name=source_name,
            word_count=word_count,
            crawled_at=datetime.utcnow().isoformat() + "Z",
            crawl_method="ai_agent",
            **extra_metadata,
        )

        # 결과 메시지 생성
        result = cls(
            job_id=job_id,
            source_id=source_id,
            url=url,
            title=title,
            content=content,
            published_at=published_at,
        )
        result.set_news_metadata(metadata)

        return result


class CrawlSessionCallback(BaseModel):
    """
    크롤링 세션 완료 콜백 메시지.

    autonomous-crawler-service가 크롤링 완료 후 data-collection-service에 알림.
    """

    job_id: int = Field(..., alias="jobId", description="작업 ID")
    source_id: int = Field(..., alias="sourceId", description="소스 ID")
    status: str = Field(..., description="완료 상태 (COMPLETED, FAILED, TIMEOUT)")
    articles_extracted: int = Field(
        default=0, alias="articlesExtracted", description="추출된 기사 수"
    )
    pages_visited: int = Field(default=0, alias="pagesVisited", description="방문한 페이지 수")
    elapsed_seconds: float = Field(default=0, alias="elapsedSeconds", description="소요 시간 (초)")
    error: str | None = Field(default=None, description="에러 메시지 (실패 시)")
    captcha_encountered: bool = Field(
        default=False, alias="captchaEncountered", description="CAPTCHA 발견 여부"
    )
    captcha_solved: bool = Field(
        default=False, alias="captchaSolved", description="CAPTCHA 해결 여부"
    )

    class Config:
        populate_by_name = True

    def to_callback_dict(self) -> dict[str, Any]:
        """콜백 API 호출용 딕셔너리로 변환"""
        return {
            "jobId": self.job_id,
            "sourceId": self.source_id,
            "status": self.status,
            "articlesExtracted": self.articles_extracted,
            "pagesVisited": self.pages_visited,
            "elapsedSeconds": self.elapsed_seconds,
            "error": self.error,
            "captchaEncountered": self.captcha_encountered,
            "captchaSolved": self.captcha_solved,
        }
