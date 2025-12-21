"""
Fact Check MCP Server - 뉴스 기사 팩트체크 및 신뢰도 분석

실제 프로젝트 스키마(collected_data, article_analysis)를 기반으로
기사의 사실 검증 및 신뢰도를 분석하는 MCP 서버입니다.

Version: 1.0.0
Port: 5002
"""

import os
import json
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any

import requests
from mcp.server import FastMCP
from starlette.responses import JSONResponse
from starlette.requests import Request

# Shared modules
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from shared.db import get_postgres_conn, get_mongo_db, DB_BACKEND, check_db_connection
from shared.health import create_health_response
from shared.aidove import AIDOVE_WEBHOOK_URL, call_aidove

# ─────────────────────────────────────────────
# 1. MCP 서버 기본 설정
# ─────────────────────────────────────────────

# 포트 설정 (shared ports 모듈에서 가져오거나 환경변수)
try:
    from shared.ports import MCP_PORTS
    PORT = MCP_PORTS.get("factcheck_mcp", 5002)
except ImportError:
    PORT = int(os.environ.get("PORT", "5002"))

server = FastMCP(
    "factcheck-mcp",
    host="0.0.0.0",
    port=PORT,
)


# Health check endpoint (using shared module)
@server.custom_route("/health", methods=["GET"])
async def health_endpoint(request: Request) -> JSONResponse:
    db_status = check_db_connection()
    return JSONResponse(
        create_health_response(
            server_name="factcheck-mcp",
            version="1.0.0",
            extra_info=db_status
        )
    )

# DB 설정은 shared.db에서 가져옴 (DB_BACKEND, get_postgres_conn, get_mongo_db)
# AiDove 설정은 shared.aidove에서 가져옴 (AIDOVE_WEBHOOK_URL, call_aidove)


# ─────────────────────────────────────────────
# 2. 신뢰도 관련 상수 및 설정
# ─────────────────────────────────────────────

# 언론사별 신뢰도 기준 (0.0 ~ 1.0)
MEDIA_RELIABILITY = {
    # 통신사/공영방송 (높은 신뢰도)
    "연합뉴스": 0.95,
    "KBS": 0.90,
    "MBC": 0.85,
    "SBS": 0.85,
    "YTN": 0.85,
    # 주요 종합지
    "조선일보": 0.80,
    "중앙일보": 0.80,
    "동아일보": 0.80,
    "한겨레": 0.80,
    "경향신문": 0.80,
    # 경제지
    "한국경제": 0.80,
    "매일경제": 0.80,
    # 케이블/종편
    "JTBC": 0.85,
    "TV조선": 0.75,
    "채널A": 0.75,
    "MBN": 0.75,
    # 인터넷 매체
    "뉴시스": 0.75,
    "뉴스1": 0.75,
    "머니투데이": 0.75,
    "이데일리": 0.75,
}
DEFAULT_RELIABILITY = 0.60

# 신뢰도 레이블
RELIABILITY_LABELS = {
    "very_high": (0.9, 1.0),
    "high": (0.75, 0.9),
    "medium": (0.5, 0.75),
    "low": (0.25, 0.5),
    "very_low": (0.0, 0.25),
}

RELIABILITY_LABEL_KR = {
    "very_high": "매우 높음",
    "high": "높음",
    "medium": "보통",
    "low": "낮음",
    "very_low": "매우 낮음",
}


def get_reliability_label(score: float) -> str:
    """신뢰도 점수를 레이블로 변환"""
    for label, (low, high) in RELIABILITY_LABELS.items():
        if low <= score < high:
            return label
    return "medium"


# 팩트체크 관련 키워드
CLAIM_INDICATORS = [
    "주장",
    "발표",
    "밝혔다",
    "전했다",
    "보도했다",
    "알려졌다",
    "것으로 알려졌다",
    "관계자에 따르면",
    "소식통에 따르면",
]
VERIFIED_INDICATORS = [
    "확인됐다",
    "확인했다",
    "사실로 드러났다",
    "밝혀졌다",
    "공식 발표",
    "공식 확인",
    "정부 발표",
]
UNVERIFIED_INDICATORS = [
    "추정",
    "의혹",
    "논란",
    "루머",
    "소문",
    "미확인",
    "것으로 보인다",
    "가능성",
    "예상",
    "전망",
]


# ─────────────────────────────────────────────
# 3. DB 연결 헬퍼 (shared.db 모듈 사용)
# ─────────────────────────────────────────────
# get_postgres_conn(), get_mongo_db()는 shared.db에서 import됨


# ─────────────────────────────────────────────
# 4. 팩트체크 데이터 조회
# ─────────────────────────────────────────────


def get_factcheck_data_from_db(
    keyword: str, days: int = 7, limit: int = 100
) -> List[Dict[str, Any]]:
    """
    키워드에 해당하는 기사의 신뢰도/팩트체크 데이터를 DB에서 조회.
    """
    cutoff = datetime.utcnow() - timedelta(days=days)

    if DB_BACKEND == "postgres":
        conn = get_postgres_conn()
        with conn.cursor() as cur:
            query = """
                SELECT 
                    cd.id,
                    cd.title,
                    COALESCE(aa.summary, LEFT(cd.content, 500)) as summary,
                    cd.content,
                    ds.name as source_name,
                    COALESCE(cd.published_date, cd.collected_at) as published_at,
                    cd.url,
                    cd.trust_score,
                    aa.reliability_score,
                    aa.fact_check_status,
                    aa.claim_count,
                    aa.verified_claim_count,
                    aa.source_count,
                    aa.citation_quality_score,
                    aa.consistency_score
                FROM collected_data cd
                LEFT JOIN data_sources ds ON cd.source_id = ds.id
                LEFT JOIN article_analysis aa ON cd.id = aa.article_id
                WHERE (
                    LOWER(cd.title) LIKE LOWER(%s)
                    OR LOWER(cd.content) LIKE LOWER(%s)
                )
                AND COALESCE(cd.published_date, cd.collected_at) >= %s
                ORDER BY COALESCE(cd.published_date, cd.collected_at) DESC
                LIMIT %s
            """
            like_keyword = f"%{keyword}%"
            cur.execute(query, (like_keyword, like_keyword, cutoff, limit))
            rows = cur.fetchall()

        articles = []
        for row in rows:
            (
                id_,
                title,
                summary,
                content,
                source_name,
                published_at,
                url,
                trust_score,
                reliability_score,
                fact_check_status,
                claim_count,
                verified_claim_count,
                source_count,
                citation_quality_score,
                consistency_score,
            ) = row

            articles.append(
                {
                    "id": id_,
                    "title": title,
                    "summary": summary,
                    "content": content,
                    "source_name": source_name or "기타",
                    "published_at": published_at,
                    "url": url,
                    "trust_score": trust_score,
                    "reliability_score": reliability_score,
                    "fact_check_status": fact_check_status,
                    "claim_count": claim_count,
                    "verified_claim_count": verified_claim_count,
                    "source_count": source_count,
                    "citation_quality_score": citation_quality_score,
                    "consistency_score": consistency_score,
                }
            )
        return articles

    elif DB_BACKEND == "mongo":
        db = get_mongo_db()
        cursor = (
            db.collected_data.find(
                {
                    "$or": [
                        {"title": {"$regex": keyword, "$options": "i"}},
                        {"content": {"$regex": keyword, "$options": "i"}},
                    ],
                    "collected_at": {"$gte": cutoff},
                }
            )
            .sort("collected_at", -1)
            .limit(limit)
        )

        articles = []
        for doc in cursor:
            articles.append(
                {
                    "id": str(doc.get("_id")),
                    "title": doc.get("title", ""),
                    "summary": doc.get("content", "")[:500],
                    "content": doc.get("content", ""),
                    "source_name": doc.get("source_name", "기타"),
                    "published_at": doc.get("published_date")
                    or doc.get("collected_at"),
                    "url": doc.get("url"),
                    "trust_score": doc.get("trust_score"),
                    "reliability_score": doc.get("reliability_score"),
                    "fact_check_status": doc.get("fact_check_status"),
                    "claim_count": doc.get("claim_count"),
                    "verified_claim_count": doc.get("verified_claim_count"),
                    "source_count": doc.get("source_count"),
                    "citation_quality_score": doc.get("citation_quality_score"),
                    "consistency_score": doc.get("consistency_score"),
                }
            )
        return articles

    else:
        raise RuntimeError(f"지원하지 않는 DB_BACKEND: {DB_BACKEND}")


# ─────────────────────────────────────────────
# 5. 신뢰도 분석 (룰 기반 Fallback)
# ─────────────────────────────────────────────


def analyze_reliability_fallback(
    title: str, content: str, source_name: str
) -> Dict[str, Any]:
    """
    룰 기반 신뢰도 분석 (ML 결과가 없을 때 사용).
    """
    text = f"{title} {content}".lower()

    # 주장/검증 지표 분석
    claim_count = sum(1 for w in CLAIM_INDICATORS if w in text)
    verified_count = sum(1 for w in VERIFIED_INDICATORS if w in text)
    unverified_count = sum(1 for w in UNVERIFIED_INDICATORS if w in text)

    # 언론사 기본 신뢰도
    base_reliability = MEDIA_RELIABILITY.get(source_name, DEFAULT_RELIABILITY)

    # 검증 비율에 따른 조정
    total_indicators = claim_count + verified_count + unverified_count
    if total_indicators > 0:
        verification_ratio = (
            verified_count - unverified_count * 0.5
        ) / total_indicators
        adjustment = verification_ratio * 0.2  # 최대 ±0.2 조정
    else:
        adjustment = 0.0

    reliability_score = max(0.0, min(1.0, base_reliability + adjustment))

    # 인용 품질 (간단한 휴리스틱)
    has_quotes = '"' in content or "'" in content
    has_source_attribution = any(
        indicator in text for indicator in ["에 따르면", "관계자는", "대변인은"]
    )
    citation_quality = 0.5
    if has_quotes:
        citation_quality += 0.2
    if has_source_attribution:
        citation_quality += 0.3

    return {
        "reliability_score": round(reliability_score, 3),
        "reliability_label": get_reliability_label(reliability_score),
        "claim_count": claim_count,
        "verified_indicators": verified_count,
        "unverified_indicators": unverified_count,
        "citation_quality_score": round(citation_quality, 3),
        "analysis_method": "rule_based",
    }


# ─────────────────────────────────────────────
# 6. 팩트체크 분석 로직
# ─────────────────────────────────────────────


def compute_factcheck_analysis(
    keyword: str,
    days: int = 7,
) -> Dict[str, Any]:
    """
    키워드 관련 기사들의 신뢰도 및 팩트체크 상태를 종합 분석합니다.
    """
    articles = get_factcheck_data_from_db(keyword, days)

    if not articles:
        return {
            "keyword": keyword,
            "days": days,
            "article_count": 0,
            "avg_reliability_score": 0.0,
            "reliability_label": "medium",
            "reliability_distribution": {},
            "source_reliability": {},
            "ml_analyzed_count": 0,
            "note": "분석할 기사가 없습니다.",
        }

    reliability_scores = []
    source_reliability = {}
    reliability_counts = {}
    ml_count = 0
    citation_scores = []
    consistency_scores = []
    total_claims = 0
    total_verified = 0

    for article in articles:
        source = article.get("source_name", "기타")

        # ML 분석 결과가 있으면 사용, 없으면 룰 기반 분석
        if article.get("reliability_score") is not None:
            reliability_score = float(article["reliability_score"])
            citation_quality = article.get("citation_quality_score")
            consistency = article.get("consistency_score")
            claims = article.get("claim_count") or 0
            verified = article.get("verified_claim_count") or 0
            ml_count += 1
        else:
            fallback = analyze_reliability_fallback(
                article.get("title", ""), article.get("content", ""), source
            )
            reliability_score = fallback["reliability_score"]
            citation_quality = fallback["citation_quality_score"]
            consistency = None
            claims = fallback["claim_count"]
            verified = fallback["verified_indicators"]

        reliability_scores.append(reliability_score)
        total_claims += claims
        total_verified += verified

        if citation_quality is not None:
            citation_scores.append(citation_quality)
        if consistency is not None:
            consistency_scores.append(consistency)

        # 출처별 신뢰도 집계
        if source not in source_reliability:
            source_reliability[source] = {"scores": [], "count": 0}
        source_reliability[source]["scores"].append(reliability_score)
        source_reliability[source]["count"] += 1

        # 레이블별 카운트
        label = get_reliability_label(reliability_score)
        label_kr = RELIABILITY_LABEL_KR.get(label, label)
        reliability_counts[label_kr] = reliability_counts.get(label_kr, 0) + 1

    # 평균 계산
    avg_reliability = (
        sum(reliability_scores) / len(reliability_scores) if reliability_scores else 0.0
    )
    avg_citation = (
        sum(citation_scores) / len(citation_scores) if citation_scores else None
    )
    avg_consistency = (
        sum(consistency_scores) / len(consistency_scores)
        if consistency_scores
        else None
    )

    # 출처별 평균 신뢰도
    source_breakdown = {}
    for source, data in source_reliability.items():
        avg = sum(data["scores"]) / len(data["scores"])
        source_breakdown[source] = {
            "avg_reliability_score": round(avg, 3),
            "reliability_label": RELIABILITY_LABEL_KR.get(
                get_reliability_label(avg), get_reliability_label(avg)
            ),
            "article_count": data["count"],
        }

    # 신뢰도 분포 비율
    total = len(articles)
    reliability_distribution = {
        label: round(count / total, 3) for label, count in reliability_counts.items()
    }

    # 검증 비율
    verification_ratio = total_verified / total_claims if total_claims > 0 else None

    return {
        "keyword": keyword,
        "days": days,
        "article_count": len(articles),
        "ml_analyzed_count": ml_count,
        "avg_reliability_score": round(avg_reliability, 3),
        "reliability_label": RELIABILITY_LABEL_KR.get(
            get_reliability_label(avg_reliability),
            get_reliability_label(avg_reliability),
        ),
        "avg_citation_quality": round(avg_citation, 3) if avg_citation else None,
        "avg_consistency_score": round(avg_consistency, 3) if avg_consistency else None,
        "reliability_distribution": reliability_distribution,
        "source_reliability": source_breakdown,
        "claim_statistics": {
            "total_claims": total_claims,
            "verified_claims": total_verified,
            "verification_ratio": round(verification_ratio, 3)
            if verification_ratio
            else None,
        },
        "reliability_spectrum": {
            "min": round(min(reliability_scores), 3),
            "max": round(max(reliability_scores), 3),
            "std": round(
                (
                    sum((x - avg_reliability) ** 2 for x in reliability_scores)
                    / len(reliability_scores)
                )
                ** 0.5,
                3,
            )
            if len(reliability_scores) > 1
            else 0.0,
        },
        "note": f"ML 분석 {ml_count}건, 룰 기반 {len(articles) - ml_count}건",
    }


# ─────────────────────────────────────────────
# 7. AiDove 호출 헬퍼
# ─────────────────────────────────────────────


def call_aidove(prompt: str, session_id: Optional[str] = None) -> str:
    """AiDove API를 호출하여 자연어 리포트를 생성합니다."""
    payload = {"chatInput": prompt}
    if session_id:
        payload["sessionId"] = session_id

    try:
        resp = requests.post(AIDOVE_WEBHOOK_URL, json=payload, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        return data.get("reply", data.get("output", "리포트 생성에 실패했습니다."))
    except requests.RequestException as e:
        return f"AiDove 호출 실패: {str(e)}"


# ─────────────────────────────────────────────
# 8. MCP Tools
# ─────────────────────────────────────────────


@server.tool()
async def get_factcheck_raw(
    keyword: str,
    days: int = 7,
) -> Dict[str, Any]:
    """
    키워드 관련 기사들의 신뢰도 및 팩트체크 분석 데이터를 JSON으로 반환합니다.

    Args:
        keyword: 검색할 키워드
        days: 분석 기간 (일)

    Returns:
        신뢰도/팩트체크 분석 데이터
    """
    result = compute_factcheck_analysis(keyword, days)
    result["generated_at"] = datetime.utcnow().isoformat()
    return result


@server.tool()
async def get_factcheck_report(
    keyword: str,
    days: int = 7,
    session_id: Optional[str] = None,
) -> str:
    """
    키워드 관련 기사들의 신뢰도를 분석하여 AiDove가 작성한 자연어 리포트를 반환합니다.

    Args:
        keyword: 검색할 키워드
        days: 분석 기간 (일)
        session_id: AiDove 세션 ID (선택)

    Returns:
        자연어 신뢰도/팩트체크 분석 리포트
    """
    raw = await get_factcheck_raw(keyword=keyword, days=days)

    prompt = f"""
너는 'News Insight'라는 뉴스 분석 서비스의 팩트체크 리포트 작성 어시스턴트야.

아래 JSON은 특정 키워드에 대한 뉴스 기사들의 신뢰도 및 팩트체크 분석 결과야.

키워드: {keyword}
기간: 최근 {days}일

JSON 데이터:
{json.dumps(raw, ensure_ascii=False, indent=2, default=str)}

요청사항:
1. 전체 기사의 평균 신뢰도를 설명하고, 이 키워드에 대한 보도가 전반적으로 신뢰할 만한지 평가해줘.
2. 언론사별 신뢰도 차이가 있다면 주요 차이점을 설명해줘.
3. 주장(claim) 대비 검증된 주장의 비율을 분석하고, 이 키워드 관련 보도의 검증 수준을 평가해줘.
4. 인용 품질(citation quality)과 일관성(consistency) 점수를 기반으로 기사들의 저널리즘 품질을 평가해줘.
5. 독자가 이 키워드에 대한 뉴스를 읽을 때 특히 주의해야 할 점이나 추가로 확인해야 할 사항을 조언해줘.
6. 마지막에는 '자동화된 팩트체크의 한계'에 대한 짧은 주의 문장을 적어줘.

전체 리포트는 3~6 단락 정도의 자연스러운 한국어로 작성해줘.
"""
    report = call_aidove(prompt, session_id=session_id)
    return report


@server.tool()
async def get_source_reliability_list() -> Dict[str, Any]:
    """
    참조용 언론사별 기본 신뢰도 목록을 반환합니다.

    Returns:
        언론사별 신뢰도 참조 데이터
    """
    result = []
    for source, score in sorted(MEDIA_RELIABILITY.items(), key=lambda x: -x[1]):
        result.append(
            {
                "source": source,
                "reliability_score": score,
                "reliability_label": RELIABILITY_LABEL_KR.get(
                    get_reliability_label(score), get_reliability_label(score)
                ),
            }
        )

    return {
        "description": "언론사별 기본 신뢰도 참조 자료 (실제 기사별 분석과 다를 수 있음)",
        "scale": "0.0(매우 낮음) ~ 1.0(매우 높음)",
        "sources": result,
    }


@server.tool()
async def health_check() -> Dict[str, Any]:
    """
    서버 상태 및 DB 연결 상태를 확인합니다.

    Returns:
        서버 상태 정보
    """
    status = {
        "server": "Fact Check MCP",
        "version": "1.0.0",
        "db_backend": DB_BACKEND,
        "status": "running",
        "timestamp": datetime.utcnow().isoformat(),
    }

    try:
        if DB_BACKEND == "postgres":
            conn = get_postgres_conn()
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
            status["postgres"] = "connected"
        elif DB_BACKEND == "mongo":
            db = get_mongo_db()
            db.command("ping")
            status["mongo"] = "connected"
    except Exception as e:
        status["db_error"] = str(e)
        status["status"] = "degraded"

    return status


# ─────────────────────────────────────────────
# 9. HTTP 헬스체크 핸들러
# ─────────────────────────────────────────────

from http.server import HTTPServer, BaseHTTPRequestHandler
import threading


class HealthCheckHandler(BaseHTTPRequestHandler):
    """간단한 헬스체크 엔드포인트 핸들러"""

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            response = {
                "status": "healthy",
                "server": "factcheck-mcp",
                "version": "1.0.0",
            }
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    print(f"Starting Fact Check MCP Server v1.0.0 on port {PORT}")
    print(f"DB Backend: {DB_BACKEND}")
    server.run(transport="streamable-http")
