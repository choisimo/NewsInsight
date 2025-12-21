"""
Bias Analysis MCP Server - 뉴스 기사 편향도 분석

실제 프로젝트 스키마(collected_data, article_analysis)를 기반으로
기사의 정치적/이념적 편향도를 분석하는 MCP 서버입니다.

Version: 1.0.0
Port: 5001
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
    PORT = MCP_PORTS.get("bias_mcp", 5001)
except ImportError:
    PORT = int(os.environ.get("PORT", "5001"))

server = FastMCP(
    "bias-analysis-mcp",
    host="0.0.0.0",
    port=PORT,
)


# Health check endpoint (using shared module)
@server.custom_route("/health", methods=["GET"])
async def health_endpoint(request: Request) -> JSONResponse:
    db_status = check_db_connection()
    return JSONResponse(
        create_health_response(
            server_name="bias-analysis-mcp",
            version="1.0.0",
            extra_info=db_status
        )
    )


# DB 설정은 shared.db에서 가져옴 (DB_BACKEND, get_postgres_conn, get_mongo_db)
# AiDove 설정은 shared.aidove에서 가져옴 (AIDOVE_WEBHOOK_URL, call_aidove)


# ─────────────────────────────────────────────
# 2. 편향도 관련 상수 및 설정
# ─────────────────────────────────────────────

# 언론사별 일반적인 편향 성향 (참고용, 실제 분석에는 ML 결과 사용)
# -1.0 = 진보, 0.0 = 중도, 1.0 = 보수
MEDIA_BIAS_REFERENCE = {
    # 보수 성향
    "조선일보": 0.7,
    "동아일보": 0.6,
    "중앙일보": 0.4,
    "매일경제": 0.3,
    "한국경제": 0.4,
    # 중도
    "연합뉴스": 0.0,
    "KBS": 0.0,
    "MBC": -0.1,
    "SBS": 0.1,
    "YTN": 0.0,
    "JTBC": -0.2,
    # 진보 성향
    "한겨레": -0.7,
    "경향신문": -0.6,
    "오마이뉴스": -0.8,
    "프레시안": -0.8,
}

# 편향 레이블 정의
BIAS_LABELS = {
    "far_left": (-1.0, -0.6),
    "left": (-0.6, -0.2),
    "center_left": (-0.2, -0.05),
    "center": (-0.05, 0.05),
    "center_right": (0.05, 0.2),
    "right": (0.2, 0.6),
    "far_right": (0.6, 1.0),
}

BIAS_LABEL_KR = {
    "far_left": "극진보",
    "left": "진보",
    "center_left": "중도진보",
    "center": "중도",
    "center_right": "중도보수",
    "right": "보수",
    "far_right": "극보수",
}


def get_bias_label(score: float) -> str:
    """편향 점수를 레이블로 변환"""
    for label, (low, high) in BIAS_LABELS.items():
        if low <= score < high:
            return label
    return "center"


# ─────────────────────────────────────────────
# 3. DB 연결 헬퍼 (shared.db 모듈 사용)
# ─────────────────────────────────────────────
# get_postgres_conn(), get_mongo_db()는 shared.db에서 import됨


# ─────────────────────────────────────────────
# 4. 편향도 데이터 조회
# ─────────────────────────────────────────────


def get_bias_data_from_db(
    keyword: str, days: int = 7, limit: int = 100
) -> List[Dict[str, Any]]:
    """
    키워드에 해당하는 기사의 편향도 데이터를 DB에서 조회.

    실제 스키마:
    - collected_data: 수집된 기사 원본
    - article_analysis: ML 분석 결과 (bias_score, bias_label 등)
    - data_sources: 언론사 정보
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
                    ds.name as source_name,
                    COALESCE(cd.published_date, cd.collected_at) as published_at,
                    cd.url,
                    aa.bias_score,
                    aa.bias_label,
                    aa.bias_indicators,
                    aa.political_leaning,
                    aa.objectivity_score,
                    aa.emotional_language_score,
                    aa.source_diversity_score
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
                source_name,
                published_at,
                url,
                bias_score,
                bias_label,
                bias_indicators,
                political_leaning,
                objectivity_score,
                emotional_language_score,
                source_diversity_score,
            ) = row

            # JSONB 파싱
            if isinstance(bias_indicators, str):
                try:
                    bias_indicators = json.loads(bias_indicators)
                except:
                    bias_indicators = {}

            articles.append(
                {
                    "id": id_,
                    "title": title,
                    "summary": summary,
                    "source_name": source_name or "기타",
                    "published_at": published_at,
                    "url": url,
                    "bias_score": bias_score,
                    "bias_label": bias_label,
                    "bias_indicators": bias_indicators or {},
                    "political_leaning": political_leaning,
                    "objectivity_score": objectivity_score,
                    "emotional_language_score": emotional_language_score,
                    "source_diversity_score": source_diversity_score,
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
                    "source_name": doc.get("source_name", "기타"),
                    "published_at": doc.get("published_date")
                    or doc.get("collected_at"),
                    "url": doc.get("url"),
                    "bias_score": doc.get("bias_score"),
                    "bias_label": doc.get("bias_label"),
                    "bias_indicators": doc.get("bias_indicators", {}),
                    "political_leaning": doc.get("political_leaning"),
                    "objectivity_score": doc.get("objectivity_score"),
                    "emotional_language_score": doc.get("emotional_language_score"),
                    "source_diversity_score": doc.get("source_diversity_score"),
                }
            )
        return articles

    else:
        raise RuntimeError(f"지원하지 않는 DB_BACKEND: {DB_BACKEND}")


# ─────────────────────────────────────────────
# 5. 편향도 분석 (룰 기반 Fallback)
# ─────────────────────────────────────────────

# 편향 키워드 사전
PROGRESSIVE_KEYWORDS = [
    "민주",
    "진보",
    "개혁",
    "평등",
    "복지",
    "인권",
    "노동",
    "환경",
    "시민",
    "연대",
    "공정",
    "정의",
    "평화",
    "다양성",
    "포용",
]
CONSERVATIVE_KEYWORDS = [
    "보수",
    "전통",
    "안보",
    "자유시장",
    "규제완화",
    "국익",
    "경쟁",
    "성장",
    "기업",
    "세금인하",
    "강력",
    "질서",
    "애국",
    "국가",
]
EMOTIONAL_KEYWORDS = [
    "충격",
    "경악",
    "분노",
    "폭로",
    "긴급",
    "속보",
    "단독",
    "파문",
    "논란",
    "폭풍",
    "대란",
    "갈등",
    "비난",
    "공격",
    "반박",
]


def analyze_bias_fallback(title: str, content: str, source_name: str) -> Dict[str, Any]:
    """
    룰 기반 편향도 분석 (ML 결과가 없을 때 사용).
    """
    text = f"{title} {content}".lower()

    # 키워드 기반 분석
    prog_count = sum(1 for w in PROGRESSIVE_KEYWORDS if w in text)
    cons_count = sum(1 for w in CONSERVATIVE_KEYWORDS if w in text)
    emotional_count = sum(1 for w in EMOTIONAL_KEYWORDS if w in text)

    # 언론사 기반 참조
    media_bias = MEDIA_BIAS_REFERENCE.get(source_name, 0.0)

    # 키워드 기반 점수 계산
    keyword_bias = 0.0
    total_keywords = prog_count + cons_count
    if total_keywords > 0:
        keyword_bias = (cons_count - prog_count) / total_keywords * 0.5

    # 종합 점수 (언론사 50%, 키워드 50%)
    bias_score = media_bias * 0.5 + keyword_bias * 0.5
    bias_score = max(-1.0, min(1.0, bias_score))

    # 객관성 점수 (감정적 표현이 적을수록 높음)
    objectivity_score = max(0.0, 1.0 - emotional_count * 0.1)

    return {
        "bias_score": round(bias_score, 3),
        "bias_label": get_bias_label(bias_score),
        "objectivity_score": round(objectivity_score, 3),
        "emotional_language_score": round(min(1.0, emotional_count * 0.15), 3),
        "analysis_method": "rule_based",
    }


# ─────────────────────────────────────────────
# 6. 편향도 분석 로직
# ─────────────────────────────────────────────


def compute_bias_analysis(
    keyword: str,
    days: int = 7,
) -> Dict[str, Any]:
    """
    키워드 관련 기사들의 편향도를 종합 분석합니다.
    """
    articles = get_bias_data_from_db(keyword, days)

    if not articles:
        return {
            "keyword": keyword,
            "days": days,
            "article_count": 0,
            "avg_bias_score": 0.0,
            "avg_bias_label": "center",
            "bias_distribution": {},
            "source_bias_breakdown": {},
            "ml_analyzed_count": 0,
            "note": "분석할 기사가 없습니다.",
        }

    bias_scores = []
    source_bias = {}
    bias_label_counts = {}
    ml_count = 0
    objectivity_scores = []
    emotional_scores = []

    for article in articles:
        source = article.get("source_name", "기타")

        # ML 분석 결과가 있으면 사용, 없으면 룰 기반 분석
        if article.get("bias_score") is not None:
            bias_score = float(article["bias_score"])
            bias_label = article.get("bias_label") or get_bias_label(bias_score)
            objectivity = article.get("objectivity_score")
            emotional = article.get("emotional_language_score")
            ml_count += 1
        else:
            fallback = analyze_bias_fallback(
                article.get("title", ""), article.get("summary", ""), source
            )
            bias_score = fallback["bias_score"]
            bias_label = fallback["bias_label"]
            objectivity = fallback["objectivity_score"]
            emotional = fallback["emotional_language_score"]

        bias_scores.append(bias_score)

        if objectivity is not None:
            objectivity_scores.append(objectivity)
        if emotional is not None:
            emotional_scores.append(emotional)

        # 출처별 편향 집계
        if source not in source_bias:
            source_bias[source] = {"scores": [], "count": 0}
        source_bias[source]["scores"].append(bias_score)
        source_bias[source]["count"] += 1

        # 레이블별 카운트
        label_kr = BIAS_LABEL_KR.get(bias_label, bias_label)
        bias_label_counts[label_kr] = bias_label_counts.get(label_kr, 0) + 1

    # 평균 계산
    avg_bias = sum(bias_scores) / len(bias_scores) if bias_scores else 0.0
    avg_objectivity = (
        sum(objectivity_scores) / len(objectivity_scores)
        if objectivity_scores
        else None
    )
    avg_emotional = (
        sum(emotional_scores) / len(emotional_scores) if emotional_scores else None
    )

    # 출처별 평균 편향
    source_breakdown = {}
    for source, data in source_bias.items():
        avg = sum(data["scores"]) / len(data["scores"])
        source_breakdown[source] = {
            "avg_bias_score": round(avg, 3),
            "bias_label": BIAS_LABEL_KR.get(get_bias_label(avg), get_bias_label(avg)),
            "article_count": data["count"],
        }

    # 편향 분포 비율
    total = len(articles)
    bias_distribution = {
        label: round(count / total, 3) for label, count in bias_label_counts.items()
    }

    return {
        "keyword": keyword,
        "days": days,
        "article_count": len(articles),
        "ml_analyzed_count": ml_count,
        "avg_bias_score": round(avg_bias, 3),
        "avg_bias_label": BIAS_LABEL_KR.get(
            get_bias_label(avg_bias), get_bias_label(avg_bias)
        ),
        "avg_objectivity_score": round(avg_objectivity, 3) if avg_objectivity else None,
        "avg_emotional_language_score": round(avg_emotional, 3)
        if avg_emotional
        else None,
        "bias_distribution": bias_distribution,
        "source_bias_breakdown": source_breakdown,
        "bias_spectrum": {
            "min": round(min(bias_scores), 3),
            "max": round(max(bias_scores), 3),
            "std": round(
                (sum((x - avg_bias) ** 2 for x in bias_scores) / len(bias_scores))
                ** 0.5,
                3,
            )
            if len(bias_scores) > 1
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
async def get_bias_raw(
    keyword: str,
    days: int = 7,
) -> Dict[str, Any]:
    """
    키워드 관련 기사들의 편향도 분석 데이터를 JSON으로 반환합니다.

    Args:
        keyword: 검색할 키워드
        days: 분석 기간 (일)

    Returns:
        편향도 분석 데이터 (평균 편향, 출처별 편향, 분포 등)
    """
    result = compute_bias_analysis(keyword, days)
    result["generated_at"] = datetime.utcnow().isoformat()
    return result


@server.tool()
async def get_bias_report(
    keyword: str,
    days: int = 7,
    session_id: Optional[str] = None,
) -> str:
    """
    키워드 관련 기사들의 편향도를 분석하여 AiDove가 작성한 자연어 리포트를 반환합니다.

    Args:
        keyword: 검색할 키워드
        days: 분석 기간 (일)
        session_id: AiDove 세션 ID (선택)

    Returns:
        자연어 편향도 분석 리포트
    """
    raw = await get_bias_raw(keyword=keyword, days=days)

    prompt = f"""
너는 'News Insight'라는 뉴스 분석 서비스의 편향도 분석 리포트 작성 어시스턴트야.

아래 JSON은 특정 키워드에 대한 뉴스 기사들의 편향도 분석 결과야.

키워드: {keyword}
기간: 최근 {days}일

JSON 데이터:
{json.dumps(raw, ensure_ascii=False, indent=2, default=str)}

요청사항:
1. 전체 기사의 평균 편향 성향을 설명해줘 (진보/중도/보수 스펙트럼에서 어디에 위치하는지).
2. 언론사별 편향 차이가 있다면 주요 차이점을 설명해줘.
3. 편향 분포(진보~보수 비율)를 기반으로 해당 키워드에 대한 언론 보도의 다양성을 평가해줘.
4. 객관성 점수와 감정적 표현 사용 정도를 분석해줘.
5. 독자가 이 키워드에 대한 뉴스를 읽을 때 주의해야 할 점을 조언해줘.
6. 마지막에는 '편향도 분석의 한계'에 대한 짧은 주의 문장을 적어줘.

전체 리포트는 3~6 단락 정도의 자연스러운 한국어로 작성해줘.
"""
    report = call_aidove(prompt, session_id=session_id)
    return report


@server.tool()
async def get_source_bias_list() -> Dict[str, Any]:
    """
    참조용 언론사별 일반적인 편향 성향 목록을 반환합니다.

    Note: 이는 일반적인 참조 자료이며, 실제 기사별 편향은 ML 분석으로 판단합니다.

    Returns:
        언론사별 편향 참조 데이터
    """
    result = []
    for source, score in sorted(MEDIA_BIAS_REFERENCE.items(), key=lambda x: x[1]):
        result.append(
            {
                "source": source,
                "bias_score": score,
                "bias_label": BIAS_LABEL_KR.get(
                    get_bias_label(score), get_bias_label(score)
                ),
            }
        )

    return {
        "description": "언론사별 일반적인 편향 성향 참조 자료 (실제 기사별 분석과 다를 수 있음)",
        "scale": "−1.0(진보) ~ 0.0(중도) ~ +1.0(보수)",
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
        "server": "Bias Analysis MCP",
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
                "server": "bias-analysis-mcp",
                "version": "1.0.0",
            }
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    print(f"Starting Bias Analysis MCP Server v1.0.0 on port {PORT}")
    print(f"DB Backend: {DB_BACKEND}")
    server.run(transport="streamable-http")
