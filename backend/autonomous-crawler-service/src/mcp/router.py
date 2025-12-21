"""
MCP API Router - MCP Add-on REST API 라우터

MCP 어댑터를 통해 MCP 서버들의 기능을 REST API로 노출합니다.
"""

from typing import Any, Dict, List, Optional

import structlog
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .adapter import MCPAdapter, MCPAddonResponse, MCPAddonInfo, get_mcp_adapter

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/mcp", tags=["MCP Add-ons"])


# ─────────────────────────────────────────────
# Request Models
# ─────────────────────────────────────────────


class KeywordAnalysisRequest(BaseModel):
    """키워드 기반 분석 요청"""

    keyword: str = Field(..., description="분석할 키워드", min_length=1, max_length=100)
    days: int = Field(default=7, ge=1, le=90, description="분석 기간 (일)")
    include_report: bool = Field(default=False, description="자연어 리포트 포함 여부")


class TextAnalysisRequest(BaseModel):
    """텍스트 기반 분석 요청"""

    text: str = Field(..., description="분석할 텍스트", min_length=10, max_length=50000)
    max_length: int = Field(default=150, ge=50, le=500, description="요약 최대 길이")
    min_length: int = Field(default=50, ge=20, le=200, description="요약 최소 길이")


# ─────────────────────────────────────────────
# Add-on 관리 엔드포인트
# ─────────────────────────────────────────────


@router.get("/addons", response_model=List[MCPAddonInfo])
async def list_mcp_addons():
    """
    등록된 MCP Add-on 목록을 조회합니다.
    """
    adapter = get_mcp_adapter()
    return await adapter.list_addons()


@router.get("/health")
async def check_mcp_health():
    """
    모든 MCP 서버의 헬스 상태를 확인합니다.
    """
    adapter = get_mcp_adapter()
    results = await adapter.check_all_health()

    # 전체 상태 요약
    healthy_count = sum(1 for r in results.values() if r.get("status") == "healthy")
    total_count = len(results)

    return {
        "status": "healthy" if healthy_count == total_count else "degraded",
        "healthy": healthy_count,
        "total": total_count,
        "servers": results,
    }


# ─────────────────────────────────────────────
# Bias Analysis 엔드포인트
# ─────────────────────────────────────────────


@router.post("/bias/analyze", response_model=MCPAddonResponse)
async def analyze_bias(request: KeywordAnalysisRequest):
    """
    키워드 관련 뉴스의 편향도를 분석합니다.

    - 정치적/이념적 편향 스펙트럼 분석
    - 언론사별 편향 분포
    - 객관성 점수
    """
    adapter = get_mcp_adapter()
    return await adapter.analyze_bias(
        keyword=request.keyword,
        days=request.days,
        include_report=request.include_report,
    )


@router.get("/bias/sources")
async def get_source_bias_list():
    """
    언론사별 일반적인 편향 성향 참조 데이터를 조회합니다.
    """
    adapter = get_mcp_adapter()
    result = await adapter.bias_client.get_source_bias_list()
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error"))
    return result.get("data")


# ─────────────────────────────────────────────
# Factcheck Analysis 엔드포인트
# ─────────────────────────────────────────────


@router.post("/factcheck/analyze", response_model=MCPAddonResponse)
async def analyze_factcheck(request: KeywordAnalysisRequest):
    """
    키워드 관련 뉴스의 신뢰도 및 팩트체크 상태를 분석합니다.

    - 전체 신뢰도 점수
    - 언론사별 신뢰도
    - 주장/검증 비율
    - 인용 품질 점수
    """
    adapter = get_mcp_adapter()
    return await adapter.analyze_factcheck(
        keyword=request.keyword,
        days=request.days,
        include_report=request.include_report,
    )


@router.get("/factcheck/sources")
async def get_source_reliability_list():
    """
    언론사별 기본 신뢰도 참조 데이터를 조회합니다.
    """
    adapter = get_mcp_adapter()
    result = await adapter.factcheck_client.get_source_reliability_list()
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error"))
    return result.get("data")


# ─────────────────────────────────────────────
# Topic Analysis 엔드포인트
# ─────────────────────────────────────────────


@router.post("/topics/analyze", response_model=MCPAddonResponse)
async def analyze_topic(request: KeywordAnalysisRequest):
    """
    키워드 관련(또는 전체) 뉴스의 토픽을 분석합니다.

    - 주요 키워드/토픽 트렌드
    - 카테고리 분포
    - 타임라인 분석
    - 관련 엔티티
    """
    adapter = get_mcp_adapter()
    return await adapter.analyze_topic(
        keyword=request.keyword,
        days=request.days,
        include_report=request.include_report,
    )


@router.get("/topics/trending", response_model=MCPAddonResponse)
async def get_trending_topics(
    days: int = Query(default=1, ge=1, le=7, description="분석 기간 (일)"),
    limit: int = Query(default=10, ge=1, le=50, description="반환할 토픽 수"),
):
    """
    최근 N일간 트렌딩 토픽 목록을 조회합니다.

    대시보드 위젯용 API입니다.
    """
    adapter = get_mcp_adapter()
    return await adapter.get_trending_topics(days=days, limit=limit)


@router.get("/topics/categories")
async def get_category_list():
    """
    지원하는 뉴스 카테고리 목록을 조회합니다.
    """
    adapter = get_mcp_adapter()
    result = await adapter.topic_client.get_category_list()
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error"))
    return result.get("data")


# ─────────────────────────────────────────────
# Sentiment Analysis 엔드포인트
# ─────────────────────────────────────────────


@router.post("/sentiment/analyze", response_model=MCPAddonResponse)
async def analyze_sentiment(request: KeywordAnalysisRequest):
    """
    키워드 관련 뉴스의 감성을 분석합니다.

    - 긍정/부정/중립 분포
    - 감성 트렌드
    - 언론사별 감성 차이
    """
    adapter = get_mcp_adapter()
    return await adapter.analyze_sentiment(
        keyword=request.keyword,
        days=request.days,
        include_report=request.include_report,
    )


# ─────────────────────────────────────────────
# HuggingFace NLP 엔드포인트
# ─────────────────────────────────────────────


@router.post("/nlp/summarize", response_model=MCPAddonResponse)
async def summarize_article(request: TextAnalysisRequest):
    """
    텍스트를 요약합니다.

    HuggingFace 모델을 사용한 abstractive summarization입니다.
    """
    adapter = get_mcp_adapter()
    return await adapter.summarize_article(
        text=request.text,
        max_length=request.max_length,
        min_length=request.min_length,
    )


@router.post("/nlp/entities", response_model=MCPAddonResponse)
async def extract_entities(text: str = Query(..., description="분석할 텍스트", min_length=10)):
    """
    텍스트에서 개체명(인물, 기관, 장소 등)을 추출합니다.
    """
    adapter = get_mcp_adapter()
    return await adapter.extract_entities(text)


# ─────────────────────────────────────────────
# 통합 분석 엔드포인트
# ─────────────────────────────────────────────


@router.post("/analyze/comprehensive")
async def comprehensive_analysis(request: KeywordAnalysisRequest):
    """
    키워드에 대한 종합 분석을 수행합니다.

    편향도, 신뢰도, 토픽, 감성 분석을 모두 실행하고 결과를 통합합니다.
    """
    adapter = get_mcp_adapter()

    # 병렬로 모든 분석 실행
    import asyncio

    results = await asyncio.gather(
        adapter.analyze_bias(request.keyword, request.days),
        adapter.analyze_factcheck(request.keyword, request.days),
        adapter.analyze_topic(request.keyword, request.days),
        adapter.analyze_sentiment(request.keyword, request.days),
        return_exceptions=True,
    )

    # 결과 통합
    analysis_results = {
        "keyword": request.keyword,
        "days": request.days,
        "bias": (
            results[0].model_dump()
            if not isinstance(results[0], Exception)
            else {"error": str(results[0])}
        ),
        "factcheck": (
            results[1].model_dump()
            if not isinstance(results[1], Exception)
            else {"error": str(results[1])}
        ),
        "topic": (
            results[2].model_dump()
            if not isinstance(results[2], Exception)
            else {"error": str(results[2])}
        ),
        "sentiment": (
            results[3].model_dump()
            if not isinstance(results[3], Exception)
            else {"error": str(results[3])}
        ),
    }

    # 성공률 계산
    success_count = sum(1 for r in results if not isinstance(r, Exception) and r.success)

    return {
        "success": success_count > 0,
        "success_rate": success_count / 4,
        "results": analysis_results,
    }
