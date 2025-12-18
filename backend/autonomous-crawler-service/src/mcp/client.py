"""
MCP Client - MCP 서버 JSON-RPC 호출 클라이언트

MCP 서버들 (bias, factcheck, topic, huggingface 등)에
JSON-RPC 형식으로 tool을 호출하는 클라이언트입니다.
"""

import asyncio
import json
from typing import Any, Dict, List, Optional
from datetime import datetime

import httpx
import structlog

logger = structlog.get_logger(__name__)


class MCPClient:
    """MCP 서버 JSON-RPC 클라이언트"""

    def __init__(
        self,
        base_url: str,
        timeout: float = 60.0,
        health_check_path: str = "/health",
    ):
        """
        Args:
            base_url: MCP 서버 베이스 URL (예: http://bias-mcp:5001)
            timeout: HTTP 요청 타임아웃 (초)
            health_check_path: 헬스체크 엔드포인트 경로
        """
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.health_check_path = health_check_path
        self._mcp_path = "/mcp"

    async def health_check(self) -> Dict[str, Any]:
        """서버 헬스체크"""
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                resp = await client.get(f"{self.base_url}{self.health_check_path}")
                if resp.status_code == 200:
                    return {"status": "healthy", "data": resp.json()}
                return {"status": "unhealthy", "status_code": resp.status_code}
            except Exception as e:
                return {"status": "error", "error": str(e)}

    async def call_tool(
        self,
        tool_name: str,
        arguments: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        MCP 서버의 tool을 호출합니다.

        Args:
            tool_name: 호출할 tool 이름 (예: get_bias_raw)
            arguments: tool 인자

        Returns:
            tool 실행 결과
        """
        # JSON-RPC 2.0 형식의 요청 생성
        request_payload = {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments or {},
            },
            "id": int(datetime.utcnow().timestamp() * 1000),
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                logger.debug(
                    "Calling MCP tool",
                    url=f"{self.base_url}{self._mcp_path}",
                    tool=tool_name,
                    arguments=arguments,
                )

                resp = await client.post(
                    f"{self.base_url}{self._mcp_path}",
                    json=request_payload,
                    headers={"Content-Type": "application/json"},
                )

                if resp.status_code != 200:
                    error_text = resp.text
                    logger.error(
                        "MCP call failed",
                        tool=tool_name,
                        status_code=resp.status_code,
                        error=error_text,
                    )
                    return {
                        "success": False,
                        "error": f"HTTP {resp.status_code}: {error_text}",
                    }

                result = resp.json()

                # JSON-RPC 에러 체크
                if "error" in result:
                    error = result["error"]
                    return {
                        "success": False,
                        "error": error.get("message", str(error)),
                        "code": error.get("code"),
                    }

                # 성공 응답
                return {
                    "success": True,
                    "data": result.get("result"),
                }

            except httpx.TimeoutException:
                logger.error("MCP call timeout", tool=tool_name)
                return {"success": False, "error": "Request timeout"}
            except Exception as e:
                logger.error("MCP call exception", tool=tool_name, error=str(e))
                return {"success": False, "error": str(e)}

    async def list_tools(self) -> Dict[str, Any]:
        """MCP 서버에서 사용 가능한 tool 목록을 조회합니다."""
        request_payload = {
            "jsonrpc": "2.0",
            "method": "tools/list",
            "params": {},
            "id": int(datetime.utcnow().timestamp() * 1000),
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                resp = await client.post(
                    f"{self.base_url}{self._mcp_path}",
                    json=request_payload,
                    headers={"Content-Type": "application/json"},
                )

                if resp.status_code != 200:
                    return {"success": False, "error": f"HTTP {resp.status_code}"}

                result = resp.json()
                return {
                    "success": True,
                    "tools": result.get("result", {}).get("tools", []),
                }
            except Exception as e:
                return {"success": False, "error": str(e)}


# ─────────────────────────────────────────────
# MCP 서버별 특화 클라이언트
# ─────────────────────────────────────────────


class BiasMCPClient(MCPClient):
    """Bias Analysis MCP 클라이언트"""

    async def get_bias_raw(self, keyword: str, days: int = 7) -> Dict[str, Any]:
        """키워드 관련 편향도 분석 데이터 조회"""
        return await self.call_tool("get_bias_raw", {"keyword": keyword, "days": days})

    async def get_bias_report(
        self, keyword: str, days: int = 7, session_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """편향도 분석 자연어 리포트 생성"""
        args = {"keyword": keyword, "days": days}
        if session_id:
            args["session_id"] = session_id
        return await self.call_tool("get_bias_report", args)

    async def get_source_bias_list(self) -> Dict[str, Any]:
        """언론사별 편향 참조 데이터 조회"""
        return await self.call_tool("get_source_bias_list")


class FactcheckMCPClient(MCPClient):
    """Fact Check MCP 클라이언트"""

    async def get_factcheck_raw(self, keyword: str, days: int = 7) -> Dict[str, Any]:
        """키워드 관련 신뢰도/팩트체크 데이터 조회"""
        return await self.call_tool("get_factcheck_raw", {"keyword": keyword, "days": days})

    async def get_factcheck_report(
        self, keyword: str, days: int = 7, session_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """신뢰도 분석 자연어 리포트 생성"""
        args = {"keyword": keyword, "days": days}
        if session_id:
            args["session_id"] = session_id
        return await self.call_tool("get_factcheck_report", args)

    async def get_source_reliability_list(self) -> Dict[str, Any]:
        """언론사별 신뢰도 참조 데이터 조회"""
        return await self.call_tool("get_source_reliability_list")


class TopicMCPClient(MCPClient):
    """Topic Analysis MCP 클라이언트"""

    async def get_topic_raw(self, keyword: Optional[str] = None, days: int = 7) -> Dict[str, Any]:
        """토픽 분석 데이터 조회"""
        return await self.call_tool("get_topic_raw", {"keyword": keyword, "days": days})

    async def get_topic_report(
        self,
        keyword: Optional[str] = None,
        days: int = 7,
        session_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """토픽 분석 자연어 리포트 생성"""
        args = {"keyword": keyword, "days": days}
        if session_id:
            args["session_id"] = session_id
        return await self.call_tool("get_topic_report", args)

    async def get_trending_topics(self, days: int = 1, limit: int = 10) -> Dict[str, Any]:
        """트렌딩 토픽 목록 조회"""
        return await self.call_tool("get_trending_topics", {"days": days, "limit": limit})

    async def get_category_list(self) -> Dict[str, Any]:
        """카테고리 목록 조회"""
        return await self.call_tool("get_category_list")


class HuggingFaceMCPClient(MCPClient):
    """Hugging Face MCP 클라이언트"""

    async def analyze_sentiment(self, text: str, model_id: Optional[str] = None) -> Dict[str, Any]:
        """감성 분석"""
        args = {"text": text}
        if model_id:
            args["model_id"] = model_id
        return await self.call_tool("analyze_sentiment", args)

    async def summarize_article(
        self, text: str, max_length: int = 150, min_length: int = 50
    ) -> Dict[str, Any]:
        """기사 요약"""
        return await self.call_tool(
            "summarize_article",
            {"text": text, "max_length": max_length, "min_length": min_length},
        )

    async def extract_entities(self, text: str) -> Dict[str, Any]:
        """개체명 인식"""
        return await self.call_tool("extract_entities", {"text": text})

    async def extract_keywords(self, text: str, top_k: int = 10) -> Dict[str, Any]:
        """키워드 추출"""
        return await self.call_tool("extract_keywords", {"text": text, "top_k": top_k})

    async def classify_news(
        self, text: str, categories: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """뉴스 분류"""
        args: Dict[str, Any] = {"text": text}
        if categories:
            args["categories"] = categories
        return await self.call_tool("classify_news", args)


class NewsInsightMCPClient(MCPClient):
    """NewsInsight MCP 클라이언트"""

    async def get_sentiment_raw(self, keyword: str, days: int = 7) -> Dict[str, Any]:
        """감성 분석 데이터 조회"""
        return await self.call_tool("get_sentiment_raw", {"keyword": keyword, "days": days})

    async def get_sentiment_report(
        self, keyword: str, days: int = 7, session_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """감성 분석 자연어 리포트 생성"""
        args = {"keyword": keyword, "days": days}
        if session_id:
            args["session_id"] = session_id
        return await self.call_tool("get_sentiment_report", args)

    async def get_article_list(
        self, keyword: str, days: int = 7, limit: int = 50
    ) -> Dict[str, Any]:
        """기사 목록 조회"""
        return await self.call_tool(
            "get_article_list", {"keyword": keyword, "days": days, "limit": limit}
        )

    async def get_discussion_summary(self, keyword: str, days: int = 7) -> Dict[str, Any]:
        """토론 요약 조회"""
        return await self.call_tool("get_discussion_summary", {"keyword": keyword, "days": days})
