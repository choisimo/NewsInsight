"""
ML Analysis API Router for autonomous-crawler-service.

ML Addon 분석 기능을 REST API로 노출합니다.
크롤링된 기사에 대해 sentiment, factcheck, bias 분석을 수행합니다.
"""

import os
from typing import Any, Dict, List, Optional

import structlog
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field, HttpUrl

from src.ml.orchestrator import (
    MLOrchestrator,
    MLAddonType,
    MLAddonConfig,
    MLAnalysisResult,
    BatchAnalysisResult,
    ArticleInput,
    get_ml_orchestrator,
    init_ml_orchestrator,
)

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/ml", tags=["ML Analysis"])


# ─────────────────────────────────────────────
# Request/Response Models
# ─────────────────────────────────────────────


class MLAnalyzeRequest(BaseModel):
    """ML 분석 요청"""

    article_id: int = Field(..., description="기사 ID")
    title: str = Field(..., description="기사 제목", min_length=1)
    content: str = Field(..., description="기사 본문", min_length=10)
    source: Optional[str] = Field(default=None, description="언론사명")
    url: Optional[str] = Field(default=None, description="기사 URL")
    published_at: Optional[str] = Field(default=None, description="발행일")

    # 분석 옵션
    addons: Optional[List[str]] = Field(
        default=None,
        description="실행할 애드온 목록 (sentiment, factcheck, bias). None이면 모두 실행",
    )
    save_to_db: bool = Field(default=True, description="결과를 DB에 저장할지 여부")


class MLBatchAnalyzeRequest(BaseModel):
    """ML 배치 분석 요청"""

    articles: List[MLAnalyzeRequest] = Field(..., min_length=1, max_length=50)
    addons: Optional[List[str]] = None
    save_to_db: bool = True
    max_concurrent: int = Field(default=5, ge=1, le=20)


class MLSimpleAnalyzeRequest(BaseModel):
    """간단한 ML 분석 요청 (텍스트만)"""

    text: str = Field(..., description="분석할 텍스트", min_length=10)
    source: Optional[str] = Field(default=None, description="출처/언론사명")
    addons: Optional[List[str]] = Field(default=None, description="실행할 애드온 목록")


class MLAddonInfo(BaseModel):
    """ML Addon 정보"""

    type: str
    url: str
    healthy: bool
    status: str


class MLStatusResponse(BaseModel):
    """ML 시스템 상태"""

    auto_analysis_enabled: bool
    parallel_analysis: bool
    addons: Dict[str, MLAddonInfo]


# ─────────────────────────────────────────────
# Helper Functions
# ─────────────────────────────────────────────


def parse_addon_types(addons: Optional[List[str]]) -> Optional[List[MLAddonType]]:
    """문자열 애드온 목록을 MLAddonType 리스트로 변환"""
    if addons is None:
        return None

    addon_map = {
        "sentiment": MLAddonType.SENTIMENT,
        "factcheck": MLAddonType.FACTCHECK,
        "bias": MLAddonType.BIAS,
    }

    result = []
    for addon in addons:
        addon_type = addon_map.get(addon.lower())
        if addon_type:
            result.append(addon_type)

    return result if result else None


# ─────────────────────────────────────────────
# API Endpoints
# ─────────────────────────────────────────────


@router.get("/health")
async def ml_health_check(request: Request):
    """
    ML 시스템 헬스체크.

    모든 ML Addon의 상태를 확인합니다.
    """
    orchestrator = get_ml_orchestrator()
    health_results = await orchestrator.check_all_health()

    all_healthy = all(r.get("status") in ["healthy", "warming_up"] for r in health_results.values())

    return {
        "status": "healthy" if all_healthy else "degraded",
        "auto_analysis_enabled": MLAddonConfig.AUTO_ANALYSIS_ENABLED,
        "addons": health_results,
    }


@router.get("/status", response_model=MLStatusResponse)
async def ml_status(request: Request):
    """
    ML 시스템 상태 조회.

    현재 설정 및 Addon 연결 상태를 반환합니다.
    """
    orchestrator = get_ml_orchestrator()
    status = orchestrator.get_addon_status()

    return MLStatusResponse(
        auto_analysis_enabled=status["auto_analysis_enabled"],
        parallel_analysis=status["parallel_analysis"],
        addons={
            k: MLAddonInfo(
                type=k,
                url=v["url"],
                healthy=v["healthy"],
                status=v["status"],
            )
            for k, v in status["addons"].items()
        },
    )


@router.post("/analyze", response_model=BatchAnalysisResult)
async def analyze_article(
    request: MLAnalyzeRequest,
    req: Request,
):
    """
    단일 기사 ML 분석.

    기사에 대해 sentiment, factcheck, bias 분석을 수행합니다.

    **사용 예시:**
    ```json
    {
        "article_id": 12345,
        "title": "뉴스 제목",
        "content": "뉴스 본문 내용...",
        "source": "조선일보",
        "addons": ["sentiment", "bias"]
    }
    ```
    """
    orchestrator = get_ml_orchestrator()
    addon_types = parse_addon_types(request.addons)

    result = await orchestrator.analyze_article(
        article_id=request.article_id,
        title=request.title,
        content=request.content,
        source=request.source,
        url=request.url,
        published_at=request.published_at,
        addon_types=addon_types,
        save_to_db=request.save_to_db,
    )

    return result


@router.post("/analyze/simple")
async def analyze_text_simple(
    request: MLSimpleAnalyzeRequest,
    req: Request,
):
    """
    간단한 텍스트 ML 분석.

    기사 ID 없이 텍스트만으로 분석을 수행합니다.
    결과는 DB에 저장되지 않습니다.

    **사용 예시:**
    ```json
    {
        "text": "분석할 뉴스 텍스트...",
        "source": "한겨레",
        "addons": ["sentiment"]
    }
    ```
    """
    orchestrator = get_ml_orchestrator()
    addon_types = parse_addon_types(request.addons)

    # 임시 article_id 사용 (DB 저장 안함)
    result = await orchestrator.analyze_article(
        article_id=0,
        title="",
        content=request.text,
        source=request.source,
        addon_types=addon_types,
        save_to_db=False,
    )

    # 응답에서 불필요한 필드 제거
    return {
        "sentiment": result.sentiment.model_dump() if result.sentiment else None,
        "factcheck": result.factcheck.model_dump() if result.factcheck else None,
        "bias": result.bias.model_dump() if result.bias else None,
        "total_latency_ms": result.total_latency_ms,
        "success_count": result.success_count,
        "failure_count": result.failure_count,
    }


@router.post("/analyze/batch")
async def analyze_batch(
    request: MLBatchAnalyzeRequest,
    req: Request,
):
    """
    배치 기사 ML 분석.

    여러 기사를 한 번에 분석합니다.

    **사용 예시:**
    ```json
    {
        "articles": [
            {"article_id": 1, "title": "제목1", "content": "내용1"},
            {"article_id": 2, "title": "제목2", "content": "내용2"}
        ],
        "addons": ["sentiment", "factcheck", "bias"],
        "max_concurrent": 5
    }
    ```
    """
    orchestrator = get_ml_orchestrator()
    addon_types = parse_addon_types(request.addons)

    # 요청을 dict 리스트로 변환
    articles = [
        {
            "id": a.article_id,
            "title": a.title,
            "content": a.content,
            "source": a.source,
            "url": a.url,
            "published_at": a.published_at,
        }
        for a in request.articles
    ]

    results = await orchestrator.analyze_batch(
        articles=articles,
        addon_types=addon_types,
        save_to_db=request.save_to_db,
        max_concurrent=request.max_concurrent,
    )

    # 통계 계산
    total_success = sum(r.success_count for r in results)
    total_failure = sum(r.failure_count for r in results)

    return {
        "total_articles": len(results),
        "total_success": total_success,
        "total_failure": total_failure,
        "results": [
            {
                "article_id": r.article_id,
                "success_count": r.success_count,
                "failure_count": r.failure_count,
                "total_latency_ms": r.total_latency_ms,
            }
            for r in results
        ],
    }


@router.post("/analyze/url")
async def analyze_url(
    url: HttpUrl = Query(..., description="분석할 URL"),
    req: Request = None,
):
    """
    URL에서 기사를 크롤링하고 ML 분석 수행.

    URL의 콘텐츠를 추출한 후 sentiment, factcheck, bias 분석을 수행합니다.
    """
    import httpx
    from bs4 import BeautifulSoup

    try:
        # 간단한 URL 페치
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(str(url), follow_redirects=True)
            response.raise_for_status()

        # HTML 파싱
        soup = BeautifulSoup(response.text, "html.parser")

        # 불필요한 태그 제거
        for tag in soup(["script", "style", "nav", "footer", "header", "aside", "ad"]):
            tag.decompose()

        # 제목과 본문 추출
        title = soup.title.string if soup.title else ""
        content = soup.get_text(separator="\n", strip=True)

        # 본문이 너무 짧으면 에러
        if len(content) < 100:
            raise HTTPException(
                status_code=400,
                detail="페이지에서 충분한 콘텐츠를 추출할 수 없습니다.",
            )

        # ML 분석 수행
        orchestrator = get_ml_orchestrator()
        result = await orchestrator.analyze_article(
            article_id=0,
            title=title[:500] if title else "",
            content=content[:10000],  # 최대 10000자
            url=str(url),
            save_to_db=False,
        )

        return {
            "url": str(url),
            "title": title[:200] if title else None,
            "content_length": len(content),
            "sentiment": result.sentiment.model_dump() if result.sentiment else None,
            "factcheck": result.factcheck.model_dump() if result.factcheck else None,
            "bias": result.bias.model_dump() if result.bias else None,
            "total_latency_ms": result.total_latency_ms,
        }

    except httpx.HTTPError as e:
        raise HTTPException(status_code=400, detail=f"URL 접근 실패: {str(e)}")
    except Exception as e:
        logger.error("URL analysis failed", url=str(url), error=str(e))
        raise HTTPException(status_code=500, detail=f"분석 실패: {str(e)}")


@router.get("/addons")
async def list_addons():
    """
    사용 가능한 ML Addon 목록.

    각 애드온의 기능과 현재 상태를 반환합니다.
    """
    orchestrator = get_ml_orchestrator()
    health_results = await orchestrator.check_all_health()

    addons = [
        {
            "key": "sentiment",
            "name": "감성 분석 (Sentiment Analysis)",
            "description": "뉴스 기사의 감정(긍정/부정/중립)을 분석합니다. KoELECTRA 기반 ML 모델 사용.",
            "endpoint": MLAddonConfig.SENTIMENT_ADDON_URL,
            "status": health_results.get("sentiment", {}).get("status", "unknown"),
            "features": ["sentiment_score", "emotion_detection", "tone_analysis"],
        },
        {
            "key": "factcheck",
            "name": "팩트체크 (Fact-Check Analysis)",
            "description": "뉴스 기사의 사실성과 신뢰도를 분석합니다. 주장 추출, 클릭베이트 탐지, 허위정보 위험도 평가.",
            "endpoint": MLAddonConfig.FACTCHECK_ADDON_URL,
            "status": health_results.get("factcheck", {}).get("status", "unknown"),
            "features": [
                "claim_extraction",
                "credibility_score",
                "clickbait_detection",
                "misinformation_risk",
            ],
        },
        {
            "key": "bias",
            "name": "편향 분석 (Bias Analysis)",
            "description": "뉴스 기사의 정치적/이념적 편향성을 분석합니다. 언론사 성향, 키워드 기반, 프레이밍 분석.",
            "endpoint": MLAddonConfig.BIAS_ADDON_URL,
            "status": health_results.get("bias", {}).get("status", "unknown"),
            "features": [
                "political_lean",
                "source_bias",
                "framing_analysis",
                "objectivity_score",
            ],
        },
    ]

    return {
        "addons": addons,
        "total": len(addons),
        "auto_analysis_enabled": MLAddonConfig.AUTO_ANALYSIS_ENABLED,
    }


@router.post("/config/toggle")
async def toggle_auto_analysis(
    enabled: bool = Query(..., description="자동 분석 활성화 여부"),
):
    """
    자동 ML 분석 토글.

    크롤링 후 자동 ML 분석 기능을 활성화/비활성화합니다.
    (런타임에만 적용, 환경변수 설정은 변경되지 않음)
    """
    # Note: 이 설정은 런타임에만 적용됨
    # 영구적인 변경을 위해서는 환경변수 ML_AUTO_ANALYSIS_ENABLED 수정 필요
    MLAddonConfig.AUTO_ANALYSIS_ENABLED = enabled

    logger.info(f"ML auto-analysis toggled", enabled=enabled)

    return {
        "status": "ok",
        "auto_analysis_enabled": MLAddonConfig.AUTO_ANALYSIS_ENABLED,
        "message": f"자동 ML 분석이 {'활성화' if enabled else '비활성화'}되었습니다.",
    }
