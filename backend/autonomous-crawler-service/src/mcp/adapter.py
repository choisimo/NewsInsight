"""
MCP Adapter - MCP 서버들을 ML Add-on으로 래핑하는 어댑터

MCP 서버의 tool들을 REST API 형태로 노출하고,
ML Add-on 인터페이스와 호환되는 응답을 생성합니다.
"""

import os
from typing import Any, Dict, List, Optional
from datetime import datetime
from enum import Enum

import structlog
from pydantic import BaseModel, Field

from .client import (
    BiasMCPClient,
    FactcheckMCPClient,
    TopicMCPClient,
    HuggingFaceMCPClient,
    NewsInsightMCPClient,
    MCPClient,
)

logger = structlog.get_logger(__name__)


# ─────────────────────────────────────────────
# MCP 서버 설정
# ─────────────────────────────────────────────


class MCPServerConfig:
    """MCP 서버 연결 설정"""

    BIAS_MCP_URL = os.environ.get("BIAS_MCP_URL", "http://bias-mcp:5001")
    FACTCHECK_MCP_URL = os.environ.get("FACTCHECK_MCP_URL", "http://factcheck-mcp:5002")
    TOPIC_MCP_URL = os.environ.get("TOPIC_MCP_URL", "http://topic-mcp:5003")
    NEWSINSIGHT_MCP_URL = os.environ.get("NEWSINSIGHT_MCP_URL", "http://newsinsight-mcp:5000")
    HUGGINGFACE_MCP_URL = os.environ.get("HUGGINGFACE_MCP_URL", "http://huggingface-mcp:5011")


# ─────────────────────────────────────────────
# 응답 모델 (ML Add-on 호환)
# ─────────────────────────────────────────────


class MCPAddonCategory(str, Enum):
    """MCP Add-on 카테고리"""

    BIAS = "BIAS_ANALYSIS"
    FACTCHECK = "FACTCHECK"
    TOPIC = "TOPIC_CLASSIFICATION"
    SENTIMENT = "SENTIMENT"
    SUMMARIZATION = "SUMMARIZATION"
    ENTITY = "ENTITY_EXTRACTION"


class MCPAddonResponse(BaseModel):
    """MCP Add-on 표준 응답"""

    addon_key: str
    category: MCPAddonCategory
    success: bool
    data: Optional[Dict[str, Any]] = None
    report: Optional[str] = None
    error: Optional[str] = None
    latency_ms: int = 0
    generated_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class MCPAddonInfo(BaseModel):
    """MCP Add-on 정보"""

    addon_key: str
    name: str
    description: str
    category: MCPAddonCategory
    endpoint_url: str
    tools: List[str] = []
    enabled: bool = True
    health_status: str = "unknown"


# ─────────────────────────────────────────────
# MCP 어댑터 클래스
# ─────────────────────────────────────────────


class MCPAdapter:
    """MCP 서버들을 ML Add-on으로 래핑하는 어댑터"""

    def __init__(self):
        self.bias_client = BiasMCPClient(MCPServerConfig.BIAS_MCP_URL)
        self.factcheck_client = FactcheckMCPClient(MCPServerConfig.FACTCHECK_MCP_URL)
        self.topic_client = TopicMCPClient(MCPServerConfig.TOPIC_MCP_URL)
        self.newsinsight_client = NewsInsightMCPClient(MCPServerConfig.NEWSINSIGHT_MCP_URL)
        self.huggingface_client = HuggingFaceMCPClient(MCPServerConfig.HUGGINGFACE_MCP_URL)

        self._clients: Dict[str, MCPClient] = {
            "bias": self.bias_client,
            "factcheck": self.factcheck_client,
            "topic": self.topic_client,
            "newsinsight": self.newsinsight_client,
            "huggingface": self.huggingface_client,
        }

    # ─────────────────────────────────────────────
    # Add-on 목록 및 상태 조회
    # ─────────────────────────────────────────────

    async def list_addons(self) -> List[MCPAddonInfo]:
        """등록된 MCP Add-on 목록 반환"""
        addons = [
            MCPAddonInfo(
                addon_key="mcp-bias",
                name="편향도 분석 (MCP)",
                description="뉴스 기사의 정치적/이념적 편향도를 분석합니다",
                category=MCPAddonCategory.BIAS,
                endpoint_url=MCPServerConfig.BIAS_MCP_URL,
                tools=["get_bias_raw", "get_bias_report", "get_source_bias_list"],
            ),
            MCPAddonInfo(
                addon_key="mcp-factcheck",
                name="팩트체크/신뢰도 (MCP)",
                description="뉴스 기사의 신뢰도와 팩트체크 상태를 분석합니다",
                category=MCPAddonCategory.FACTCHECK,
                endpoint_url=MCPServerConfig.FACTCHECK_MCP_URL,
                tools=[
                    "get_factcheck_raw",
                    "get_factcheck_report",
                    "get_source_reliability_list",
                ],
            ),
            MCPAddonInfo(
                addon_key="mcp-topic",
                name="토픽 분석 (MCP)",
                description="뉴스 토픽, 키워드 트렌드를 분석합니다",
                category=MCPAddonCategory.TOPIC,
                endpoint_url=MCPServerConfig.TOPIC_MCP_URL,
                tools=[
                    "get_topic_raw",
                    "get_topic_report",
                    "get_trending_topics",
                    "get_category_list",
                ],
            ),
            MCPAddonInfo(
                addon_key="mcp-sentiment",
                name="감성 분석 (MCP)",
                description="뉴스 기사의 감성(긍정/부정/중립)을 분석합니다",
                category=MCPAddonCategory.SENTIMENT,
                endpoint_url=MCPServerConfig.NEWSINSIGHT_MCP_URL,
                tools=[
                    "get_sentiment_raw",
                    "get_sentiment_report",
                    "get_article_list",
                ],
            ),
            MCPAddonInfo(
                addon_key="mcp-huggingface",
                name="HuggingFace NLP (MCP)",
                description="HuggingFace 모델을 활용한 NLP 분석",
                category=MCPAddonCategory.SUMMARIZATION,
                endpoint_url=MCPServerConfig.HUGGINGFACE_MCP_URL,
                tools=[
                    "analyze_sentiment",
                    "summarize_article",
                    "extract_entities",
                    "extract_keywords",
                    "classify_news",
                ],
            ),
        ]
        return addons

    async def check_all_health(self) -> Dict[str, Dict[str, Any]]:
        """모든 MCP 서버 헬스체크"""
        results = {}
        for name, client in self._clients.items():
            results[name] = await client.health_check()
        return results

    # ─────────────────────────────────────────────
    # Bias Analysis
    # ─────────────────────────────────────────────

    async def analyze_bias(
        self,
        keyword: str,
        days: int = 7,
        include_report: bool = False,
    ) -> MCPAddonResponse:
        """편향도 분석 실행"""
        start_time = datetime.utcnow()

        try:
            result = await self.bias_client.get_bias_raw(keyword, days)

            if not result.get("success"):
                return MCPAddonResponse(
                    addon_key="mcp-bias",
                    category=MCPAddonCategory.BIAS,
                    success=False,
                    error=result.get("error", "Unknown error"),
                    latency_ms=int((datetime.utcnow() - start_time).total_seconds() * 1000),
                )

            response = MCPAddonResponse(
                addon_key="mcp-bias",
                category=MCPAddonCategory.BIAS,
                success=True,
                data=result.get("data"),
                latency_ms=int((datetime.utcnow() - start_time).total_seconds() * 1000),
            )

            # 리포트도 함께 요청된 경우
            if include_report:
                report_result = await self.bias_client.get_bias_report(keyword, days)
                if report_result.get("success"):
                    response.report = report_result.get("data")

            return response

        except Exception as e:
            logger.error("Bias analysis failed", error=str(e))
            return MCPAddonResponse(
                addon_key="mcp-bias",
                category=MCPAddonCategory.BIAS,
                success=False,
                error=str(e),
                latency_ms=int((datetime.utcnow() - start_time).total_seconds() * 1000),
            )

    # ─────────────────────────────────────────────
    # Factcheck Analysis
    # ─────────────────────────────────────────────

    async def analyze_factcheck(
        self,
        keyword: str,
        days: int = 7,
        include_report: bool = False,
    ) -> MCPAddonResponse:
        """팩트체크/신뢰도 분석 실행"""
        start_time = datetime.utcnow()

        try:
            result = await self.factcheck_client.get_factcheck_raw(keyword, days)

            if not result.get("success"):
                return MCPAddonResponse(
                    addon_key="mcp-factcheck",
                    category=MCPAddonCategory.FACTCHECK,
                    success=False,
                    error=result.get("error", "Unknown error"),
                    latency_ms=int((datetime.utcnow() - start_time).total_seconds() * 1000),
                )

            response = MCPAddonResponse(
                addon_key="mcp-factcheck",
                category=MCPAddonCategory.FACTCHECK,
                success=True,
                data=result.get("data"),
                latency_ms=int((datetime.utcnow() - start_time).total_seconds() * 1000),
            )

            if include_report:
                report_result = await self.factcheck_client.get_factcheck_report(keyword, days)
                if report_result.get("success"):
                    response.report = report_result.get("data")

            return response

        except Exception as e:
            logger.error("Factcheck analysis failed", error=str(e))
            return MCPAddonResponse(
                addon_key="mcp-factcheck",
                category=MCPAddonCategory.FACTCHECK,
                success=False,
                error=str(e),
                latency_ms=int((datetime.utcnow() - start_time).total_seconds() * 1000),
            )

    # ─────────────────────────────────────────────
    # Topic Analysis
    # ─────────────────────────────────────────────

    async def analyze_topic(
        self,
        keyword: Optional[str] = None,
        days: int = 7,
        include_report: bool = False,
    ) -> MCPAddonResponse:
        """토픽 분석 실행"""
        start_time = datetime.utcnow()

        try:
            result = await self.topic_client.get_topic_raw(keyword, days)

            if not result.get("success"):
                return MCPAddonResponse(
                    addon_key="mcp-topic",
                    category=MCPAddonCategory.TOPIC,
                    success=False,
                    error=result.get("error", "Unknown error"),
                    latency_ms=int((datetime.utcnow() - start_time).total_seconds() * 1000),
                )

            response = MCPAddonResponse(
                addon_key="mcp-topic",
                category=MCPAddonCategory.TOPIC,
                success=True,
                data=result.get("data"),
                latency_ms=int((datetime.utcnow() - start_time).total_seconds() * 1000),
            )

            if include_report:
                report_result = await self.topic_client.get_topic_report(keyword, days)
                if report_result.get("success"):
                    response.report = report_result.get("data")

            return response

        except Exception as e:
            logger.error("Topic analysis failed", error=str(e))
            return MCPAddonResponse(
                addon_key="mcp-topic",
                category=MCPAddonCategory.TOPIC,
                success=False,
                error=str(e),
                latency_ms=int((datetime.utcnow() - start_time).total_seconds() * 1000),
            )

    async def get_trending_topics(self, days: int = 1, limit: int = 10) -> MCPAddonResponse:
        """트렌딩 토픽 조회"""
        start_time = datetime.utcnow()

        try:
            result = await self.topic_client.get_trending_topics(days, limit)

            return MCPAddonResponse(
                addon_key="mcp-topic",
                category=MCPAddonCategory.TOPIC,
                success=result.get("success", False),
                data=result.get("data"),
                error=result.get("error"),
                latency_ms=int((datetime.utcnow() - start_time).total_seconds() * 1000),
            )

        except Exception as e:
            logger.error("Get trending topics failed", error=str(e))
            return MCPAddonResponse(
                addon_key="mcp-topic",
                category=MCPAddonCategory.TOPIC,
                success=False,
                error=str(e),
                latency_ms=int((datetime.utcnow() - start_time).total_seconds() * 1000),
            )

    # ─────────────────────────────────────────────
    # Sentiment Analysis
    # ─────────────────────────────────────────────

    async def analyze_sentiment(
        self,
        keyword: str,
        days: int = 7,
        include_report: bool = False,
    ) -> MCPAddonResponse:
        """감성 분석 실행"""
        start_time = datetime.utcnow()

        try:
            result = await self.newsinsight_client.get_sentiment_raw(keyword, days)

            if not result.get("success"):
                return MCPAddonResponse(
                    addon_key="mcp-sentiment",
                    category=MCPAddonCategory.SENTIMENT,
                    success=False,
                    error=result.get("error", "Unknown error"),
                    latency_ms=int((datetime.utcnow() - start_time).total_seconds() * 1000),
                )

            response = MCPAddonResponse(
                addon_key="mcp-sentiment",
                category=MCPAddonCategory.SENTIMENT,
                success=True,
                data=result.get("data"),
                latency_ms=int((datetime.utcnow() - start_time).total_seconds() * 1000),
            )

            if include_report:
                report_result = await self.newsinsight_client.get_sentiment_report(keyword, days)
                if report_result.get("success"):
                    response.report = report_result.get("data")

            return response

        except Exception as e:
            logger.error("Sentiment analysis failed", error=str(e))
            return MCPAddonResponse(
                addon_key="mcp-sentiment",
                category=MCPAddonCategory.SENTIMENT,
                success=False,
                error=str(e),
                latency_ms=int((datetime.utcnow() - start_time).total_seconds() * 1000),
            )

    # ─────────────────────────────────────────────
    # HuggingFace NLP
    # ─────────────────────────────────────────────

    async def summarize_article(
        self,
        text: str,
        max_length: int = 150,
        min_length: int = 50,
    ) -> MCPAddonResponse:
        """기사 요약"""
        start_time = datetime.utcnow()

        try:
            result = await self.huggingface_client.summarize_article(text, max_length, min_length)

            return MCPAddonResponse(
                addon_key="mcp-huggingface",
                category=MCPAddonCategory.SUMMARIZATION,
                success=result.get("success", False),
                data=result.get("data"),
                error=result.get("error"),
                latency_ms=int((datetime.utcnow() - start_time).total_seconds() * 1000),
            )

        except Exception as e:
            logger.error("Summarization failed", error=str(e))
            return MCPAddonResponse(
                addon_key="mcp-huggingface",
                category=MCPAddonCategory.SUMMARIZATION,
                success=False,
                error=str(e),
                latency_ms=int((datetime.utcnow() - start_time).total_seconds() * 1000),
            )

    async def extract_entities(self, text: str) -> MCPAddonResponse:
        """개체명 인식"""
        start_time = datetime.utcnow()

        try:
            result = await self.huggingface_client.extract_entities(text)

            return MCPAddonResponse(
                addon_key="mcp-huggingface",
                category=MCPAddonCategory.ENTITY,
                success=result.get("success", False),
                data=result.get("data"),
                error=result.get("error"),
                latency_ms=int((datetime.utcnow() - start_time).total_seconds() * 1000),
            )

        except Exception as e:
            logger.error("Entity extraction failed", error=str(e))
            return MCPAddonResponse(
                addon_key="mcp-huggingface",
                category=MCPAddonCategory.ENTITY,
                success=False,
                error=str(e),
                latency_ms=int((datetime.utcnow() - start_time).total_seconds() * 1000),
            )


# ─────────────────────────────────────────────
# 싱글톤 인스턴스
# ─────────────────────────────────────────────

_mcp_adapter: Optional[MCPAdapter] = None


def get_mcp_adapter() -> MCPAdapter:
    """MCP 어댑터 싱글톤 인스턴스 반환"""
    global _mcp_adapter
    if _mcp_adapter is None:
        _mcp_adapter = MCPAdapter()
    return _mcp_adapter
