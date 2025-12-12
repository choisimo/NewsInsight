"""
NewsInsight MCP Server - 감성 분석 및 여론 온도 제공

실제 프로젝트 스키마(collected_data, article_analysis, article_discussion)를 기반으로
기사 및 댓글 감성 분석, 여론 온도 계산 기능을 제공하는 MCP 서버입니다.

Version: 2.0.0
Port: 5000
"""

import os
import json
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any
from urllib.parse import urlparse

import requests
from mcp.server import Server

# ─────────────────────────────────────────────
# 1. MCP 서버 기본 설정
# ─────────────────────────────────────────────

server = Server("news-insight-mcp", version="2.0.0")

# DB 백엔드 선택: "postgres" 또는 "mongo"
DB_BACKEND = os.environ.get("DB_BACKEND", "postgres")

# PostgreSQL 접속 정보 (표준: DATABASE_URL)
POSTGRES_DSN = os.environ.get("DATABASE_URL")

# MongoDB 접속 정보 (표준: MONGODB_URI - URI에 DB명 포함)
MONGODB_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/newsinsight")

# AiDove Webhook URL
AIDOVE_WEBHOOK_URL = os.environ.get(
    "AIDOVE_WEBHOOK_URL", "https://workflow.nodove.com/webhook/aidove"
)


# ─────────────────────────────────────────────
# 2. 신뢰 매체 / 가중치 설정
# ─────────────────────────────────────────────

# 참고: 백엔드 TrustScoreConfig와 별도로 MCP 전용 가중치 사용
# 0.8 = 일반, 1.0 = 신뢰, 1.2 = 주요 매체
TRUSTED_SOURCES_WEIGHTS = {
    # 주요 방송
    "KBS": 1.2,
    "MBC": 1.2,
    "SBS": 1.2,
    "YTN": 1.2,
    "JTBC": 1.2,
    # 통신사
    "연합뉴스": 1.2,
    # 경제지
    "한국경제": 1.2,
    "매일경제": 1.2,
    # 종합일간지
    "조선일보": 1.2,
    "중앙일보": 1.0,
    "동아일보": 1.0,
    "한겨레": 1.0,
    "경향신문": 1.0,
    # 인터넷 매체
    "머니투데이": 1.0,
    "뉴시스": 1.0,
    "뉴스1": 1.0,
}
DEFAULT_SOURCE_WEIGHT = 0.8


# ─────────────────────────────────────────────
# 3. DB 연결 헬퍼 (Postgres / Mongo)
# ─────────────────────────────────────────────

_pg_conn = None
_mongo_client = None
_mongo_db = None


def get_postgres_conn():
    """PostgreSQL 연결을 반환합니다."""
    global _pg_conn
    import psycopg2

    if _pg_conn is None or _pg_conn.closed != 0:
        if not POSTGRES_DSN:
            raise RuntimeError("DATABASE_URL (Postgres DSN)이 설정되어 있지 않습니다.")
        _pg_conn = psycopg2.connect(POSTGRES_DSN)
        _pg_conn.autocommit = True  # 읽기 전용이므로 autocommit
    return _pg_conn


def get_mongo_db():
    """MongoDB 데이터베이스 객체를 반환합니다."""
    global _mongo_client, _mongo_db
    from pymongo import MongoClient

    if _mongo_db is None:
        if not MONGODB_URI:
            raise RuntimeError("MONGODB_URI가 설정되어 있지 않습니다.")

        _mongo_client = MongoClient(MONGODB_URI)

        # URI에서 DB명 추출 (예: mongodb://...../newsinsight?...)
        parsed = urlparse(MONGODB_URI)
        db_name = parsed.path.lstrip("/").split("?")[0] or "newsinsight"
        _mongo_db = _mongo_client[db_name]

    return _mongo_db


# ─────────────────────────────────────────────
# 4. 기사 / 댓글 조회 함수 (실제 스키마 기반)
# ─────────────────────────────────────────────


def get_articles_from_db(
    keyword: str, days: int = 7, limit: int = 50
) -> List[Dict[str, Any]]:
    """
    keyword와 기간(days)에 해당하는 기사 목록을 DB에서 조회.

    실제 스키마:
    - collected_data: 수집된 기사 원본
    - article_analysis: ML 분석 결과 (감성, 편향도 등)
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
                    aa.sentiment_score,
                    aa.sentiment_label,
                    aa.sentiment_distribution,
                    cd.trust_score,
                    aa.reliability_score,
                    aa.bias_score,
                    aa.bias_label
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
                sentiment_score,
                sentiment_label,
                sentiment_distribution,
                trust_score,
                reliability_score,
                bias_score,
                bias_label,
            ) = row

            # JSONB 파싱
            if isinstance(sentiment_distribution, str):
                try:
                    sentiment_distribution = json.loads(sentiment_distribution)
                except:
                    sentiment_distribution = {}

            articles.append(
                {
                    "id": id_,
                    "title": title,
                    "summary": summary,
                    "source_name": source_name or "기타",
                    "published_at": published_at,
                    "url": url,
                    # ML 분석 결과
                    "sentiment_score": sentiment_score,
                    "sentiment_label": sentiment_label,
                    "sentiment_distribution": sentiment_distribution or {},
                    "trust_score": trust_score,
                    "reliability_score": reliability_score,
                    "bias_score": bias_score,
                    "bias_label": bias_label,
                }
            )
        return articles

    elif DB_BACKEND == "mongo":
        db = get_mongo_db()
        # MongoDB: ai_responses 컬렉션 활용
        cursor = (
            db.ai_responses.find(
                {
                    "$or": [
                        {"text": {"$regex": keyword, "$options": "i"}},
                    ],
                    "createdAt": {"$gte": cutoff},
                },
                {
                    "_id": 1,
                    "text": 1,
                    "providerId": 1,
                    "createdAt": 1,
                },
            )
            .sort("createdAt", -1)
            .limit(limit)
        )

        articles = []
        for doc in cursor:
            text = doc.get("text", "")
            articles.append(
                {
                    "id": str(doc.get("_id")),
                    "title": text[:100] + "..." if len(text) > 100 else text,
                    "summary": text[:500] if text else "",
                    "source_name": doc.get("providerId", "AI"),
                    "published_at": doc.get("createdAt"),
                    "url": None,
                    "sentiment_score": None,
                    "sentiment_label": None,
                    "sentiment_distribution": {},
                    "trust_score": None,
                    "reliability_score": None,
                    "bias_score": None,
                    "bias_label": None,
                }
            )
        return articles

    else:
        raise RuntimeError(f"지원하지 않는 DB_BACKEND: {DB_BACKEND}")


def get_discussions_from_db(
    keyword: str, days: int = 7, limit: int = 30
) -> List[Dict[str, Any]]:
    """
    keyword와 기간(days)에 해당하는 댓글/여론 데이터를 DB에서 조회.

    실제 스키마:
    - article_discussion: 기사별 여론 분석 집계 데이터
      - sample_positive_comments, sample_negative_comments: JSONB 샘플 댓글
      - sentiment_distribution: 감성 분포
      - overall_sentiment: 전체 감성
    """
    cutoff = datetime.utcnow() - timedelta(days=days)

    if DB_BACKEND == "postgres":
        conn = get_postgres_conn()
        with conn.cursor() as cur:
            query = """
                SELECT 
                    ad.article_id,
                    ad.total_comment_count,
                    ad.analyzed_count,
                    ad.overall_sentiment,
                    ad.sentiment_distribution,
                    ad.emotion_distribution,
                    ad.stance_distribution,
                    ad.top_keywords,
                    ad.sample_positive_comments,
                    ad.sample_negative_comments,
                    ad.discussion_quality_score,
                    ad.bot_likelihood_score,
                    ad.toxicity_score,
                    ds.name as source_name,
                    cd.published_date,
                    cd.title as article_title
                FROM article_discussion ad
                JOIN collected_data cd ON ad.article_id = cd.id
                LEFT JOIN data_sources ds ON cd.source_id = ds.id
                WHERE (
                    LOWER(cd.title) LIKE LOWER(%s)
                    OR LOWER(cd.content) LIKE LOWER(%s)
                )
                AND COALESCE(cd.published_date, cd.collected_at) >= %s
                ORDER BY cd.published_date DESC
                LIMIT %s
            """
            like_keyword = f"%{keyword}%"
            cur.execute(query, (like_keyword, like_keyword, cutoff, limit))
            rows = cur.fetchall()

        discussions = []
        for row in rows:
            (
                article_id,
                total_count,
                analyzed_count,
                overall_sentiment,
                sentiment_dist,
                emotion_dist,
                stance_dist,
                top_keywords,
                positive_samples,
                negative_samples,
                quality_score,
                bot_score,
                toxicity_score,
                source_name,
                published_date,
                article_title,
            ) = row

            # JSONB 파싱
            def parse_json(val):
                if val is None:
                    return {}
                if isinstance(val, (dict, list)):
                    return val
                if isinstance(val, str):
                    try:
                        return json.loads(val)
                    except:
                        return {}
                return {}

            discussions.append(
                {
                    "article_id": article_id,
                    "article_title": article_title,
                    "total_comment_count": total_count or 0,
                    "analyzed_count": analyzed_count or 0,
                    "overall_sentiment": overall_sentiment,
                    "sentiment_distribution": parse_json(sentiment_dist),
                    "emotion_distribution": parse_json(emotion_dist),
                    "stance_distribution": parse_json(stance_dist),
                    "top_keywords": parse_json(top_keywords)
                    if isinstance(parse_json(top_keywords), list)
                    else [],
                    "sample_positive_comments": parse_json(positive_samples)
                    if isinstance(parse_json(positive_samples), list)
                    else [],
                    "sample_negative_comments": parse_json(negative_samples)
                    if isinstance(parse_json(negative_samples), list)
                    else [],
                    "discussion_quality_score": quality_score,
                    "bot_likelihood_score": bot_score,
                    "toxicity_score": toxicity_score,
                    "source_name": source_name or "기타",
                    "published_at": published_date,
                }
            )
        return discussions

    elif DB_BACKEND == "mongo":
        # MongoDB에서는 article_discussion에 해당하는 컬렉션이 없을 수 있음
        return []

    else:
        raise RuntimeError(f"지원하지 않는 DB_BACKEND: {DB_BACKEND}")


# ─────────────────────────────────────────────
# 5. 감성 분석 (룰 기반 Fallback)
# ─────────────────────────────────────────────

POSITIVE_WORDS = [
    "호조",
    "호재",
    "강세",
    "성장",
    "최고",
    "회복",
    "긍정",
    "기대",
    "추천",
    "좋은",
    "상승",
    "돌파",
    "성공",
    "환영",
    "지지",
    "호평",
    "개선",
    "발전",
    "혁신",
    "협력",
]
NEGATIVE_WORDS = [
    "우려",
    "불안",
    "논란",
    "폭락",
    "위기",
    "악재",
    "반발",
    "불신",
    "구조조정",
    "부정",
    "반대",
    "화나요",
    "하락",
    "실패",
    "비판",
    "갈등",
    "충돌",
    "파탄",
    "악화",
    "손실",
]


def analyze_sentiment_fallback(text: str) -> float:
    """
    룰 기반 감성 분석 (ML 결과가 없을 때 사용).
    - 긍정 키워드 +1, 부정 키워드 -1
    - 최종 범위: [-1, 1]
    """
    if not text:
        return 0.0

    text = text.lower()
    score = 0

    for w in POSITIVE_WORDS:
        if w in text:
            score += 1
    for w in NEGATIVE_WORDS:
        if w in text:
            score -= 1

    # 정규화: [-1, 1] 범위로
    if score > 0:
        return min(1.0, score / 3)
    elif score < 0:
        return max(-1.0, score / 3)
    return 0.0


# ─────────────────────────────────────────────
# 6. 기사/댓글 여론 온도 계산 로직
# ─────────────────────────────────────────────


def compute_article_temperature(
    keyword: str,
    days: int = 7,
    trusted_only: bool = True,
) -> Dict[str, Any]:
    """
    언론 기사 논조 기반 여론 온도를 계산한다.
    DB에 저장된 ML 분석 결과를 우선 사용하고, 없으면 룰 기반 분석.
    """
    articles = get_articles_from_db(keyword, days)
    now = datetime.utcnow()

    if not articles:
        return {
            "temperature": 50.0,
            "score_raw": 0.0,
            "pos_ratio": 0.0,
            "neg_ratio": 0.0,
            "neu_ratio": 1.0,
            "article_count": 0,
            "ml_analyzed_count": 0,
            "trusted_only": trusted_only,
            "note": "분석할 기사가 없습니다.",
        }

    weighted_sum = 0.0
    weight_total = 0.0
    pos_w = neg_w = neu_w = 0.0
    used_ml_count = 0
    filtered_count = 0

    for a in articles:
        title = a.get("title", "")
        summary = a.get("summary", "")
        source_name = a.get("source_name", "기타")
        published_at = a.get("published_at", now)

        # DB에 저장된 ML 분석 결과
        stored_sentiment_score = a.get("sentiment_score")

        # 1) 신뢰 매체 필터
        if trusted_only and source_name not in TRUSTED_SOURCES_WEIGHTS:
            filtered_count += 1
            continue

        # 2) 출처 가중치
        source_weight = TRUSTED_SOURCES_WEIGHTS.get(source_name, DEFAULT_SOURCE_WEIGHT)

        # 3) 시간 가중치 (최근일수록 가중치 ↑, 최소 0.3)
        if isinstance(published_at, datetime):
            age_days = max(0.0, (now - published_at).total_seconds() / 86400)
        else:
            age_days = 0.0

        if days > 0:
            w_time = max(0.3, 1.0 - age_days / float(days))
        else:
            w_time = 1.0

        w = source_weight * w_time

        # 4) 감성 점수: DB ML 결과 우선, 없으면 룰 기반
        if stored_sentiment_score is not None:
            s = float(stored_sentiment_score)
            used_ml_count += 1
        else:
            text_for_analysis = f"{title} {summary}"
            s = analyze_sentiment_fallback(text_for_analysis)

        weighted_sum += w * s
        weight_total += w

        if s > 0.1:
            pos_w += w
        elif s < -0.1:
            neg_w += w
        else:
            neu_w += w

    if weight_total == 0:
        return {
            "temperature": 50.0,
            "score_raw": 0.0,
            "pos_ratio": 0.0,
            "neg_ratio": 0.0,
            "neu_ratio": 1.0,
            "article_count": len(articles),
            "ml_analyzed_count": 0,
            "trusted_only": trusted_only,
            "note": f"신뢰 매체 기준으로 분석할 기사가 부족합니다. (필터링: {filtered_count}건)",
        }

    score_raw = weighted_sum / weight_total  # [-1,1]
    temperature = 50.0 + 50.0 * score_raw
    temperature = max(0.0, min(100.0, temperature))

    pos_ratio = pos_w / weight_total
    neg_ratio = neg_w / weight_total
    neu_ratio = neu_w / weight_total

    return {
        "temperature": round(temperature, 1),
        "score_raw": round(score_raw, 3),
        "pos_ratio": round(pos_ratio, 3),
        "neg_ratio": round(neg_ratio, 3),
        "neu_ratio": round(neu_ratio, 3),
        "article_count": len(articles) - filtered_count,
        "total_found": len(articles),
        "ml_analyzed_count": used_ml_count,
        "trusted_only": trusted_only,
        "note": f"ML 분석 {used_ml_count}건, 룰 기반 {len(articles) - filtered_count - used_ml_count}건",
    }


def compute_discussion_temperature(
    keyword: str,
    days: int = 7,
) -> Dict[str, Any]:
    """
    댓글/여론 데이터 기반 여론 온도 계산.
    article_discussion 테이블의 집계된 분석 결과 활용.
    """
    discussions = get_discussions_from_db(keyword, days)

    if not discussions:
        return {
            "temperature": 50.0,
            "score_raw": 0.0,
            "pos_ratio": 0.0,
            "neg_ratio": 0.0,
            "neu_ratio": 1.0,
            "comment_count": 0,
            "discussion_count": 0,
            "avg_quality_score": None,
            "avg_bot_likelihood": None,
            "note": "분석할 댓글 데이터가 없습니다.",
        }

    total_comments = 0
    weighted_pos = 0.0
    weighted_neg = 0.0
    weighted_neu = 0.0
    quality_scores = []
    bot_scores = []

    for disc in discussions:
        count = disc.get("total_comment_count", 0)
        if count == 0:
            continue

        total_comments += count
        sentiment_dist = disc.get("sentiment_distribution", {})

        # 가중치 = 댓글 수 (볼륨 기반)
        w = float(count)

        pos = float(sentiment_dist.get("positive", 0.0))
        neg = float(sentiment_dist.get("negative", 0.0))
        neu = float(sentiment_dist.get("neutral", 0.0))

        weighted_pos += w * pos
        weighted_neg += w * neg
        weighted_neu += w * neu

        if disc.get("discussion_quality_score") is not None:
            quality_scores.append(disc["discussion_quality_score"])
        if disc.get("bot_likelihood_score") is not None:
            bot_scores.append(disc["bot_likelihood_score"])

    if total_comments == 0:
        return {
            "temperature": 50.0,
            "score_raw": 0.0,
            "pos_ratio": 0.0,
            "neg_ratio": 0.0,
            "neu_ratio": 1.0,
            "comment_count": 0,
            "discussion_count": len(discussions),
            "avg_quality_score": None,
            "avg_bot_likelihood": None,
            "note": "댓글 데이터가 부족합니다.",
        }

    # 비율 계산
    total_w = weighted_pos + weighted_neg + weighted_neu
    if total_w > 0:
        pos_ratio = weighted_pos / total_w
        neg_ratio = weighted_neg / total_w
        neu_ratio = weighted_neu / total_w
    else:
        pos_ratio = neg_ratio = 0.0
        neu_ratio = 1.0

    # 점수 계산 (긍정 - 부정)
    score_raw = pos_ratio - neg_ratio  # [-1, 1]
    temperature = 50.0 + 50.0 * score_raw
    temperature = max(0.0, min(100.0, temperature))

    # 평균 품질/봇 점수
    avg_quality = sum(quality_scores) / len(quality_scores) if quality_scores else None
    avg_bot = sum(bot_scores) / len(bot_scores) if bot_scores else None

    return {
        "temperature": round(temperature, 1),
        "score_raw": round(score_raw, 3),
        "pos_ratio": round(pos_ratio, 3),
        "neg_ratio": round(neg_ratio, 3),
        "neu_ratio": round(neu_ratio, 3),
        "comment_count": total_comments,
        "discussion_count": len(discussions),
        "avg_quality_score": round(avg_quality, 1) if avg_quality else None,
        "avg_bot_likelihood": round(avg_bot, 3) if avg_bot else None,
        "note": "",
    }


def compute_combined_temperature(
    article_info: Dict[str, Any],
    discussion_info: Dict[str, Any],
    article_weight: float = 0.6,
    discussion_weight: float = 0.4,
) -> Dict[str, Any]:
    """
    기사 기반 + 댓글 기반 여론 온도를 섞어서 종합 온도 계산.
    """
    a_score = article_info.get("score_raw", 0.0)
    d_score = discussion_info.get("score_raw", 0.0)

    # 데이터가 없는 경우 가중치 조정
    has_articles = article_info.get("article_count", 0) > 0
    has_discussions = discussion_info.get("comment_count", 0) > 0

    if not has_articles and not has_discussions:
        return {
            "temperature": 50.0,
            "score_raw": 0.0,
            "article_weight": article_weight,
            "discussion_weight": discussion_weight,
            "data_source": "none",
        }
    elif not has_articles:
        combined_raw = d_score
        data_source = "discussion_only"
    elif not has_discussions:
        combined_raw = a_score
        data_source = "article_only"
    else:
        combined_raw = article_weight * a_score + discussion_weight * d_score
        data_source = "both"

    temperature = 50.0 + 50.0 * combined_raw
    temperature = max(0.0, min(100.0, temperature))

    return {
        "temperature": round(temperature, 1),
        "score_raw": round(combined_raw, 3),
        "article_weight": article_weight,
        "discussion_weight": discussion_weight,
        "data_source": data_source,
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
async def get_sentiment_raw(
    keyword: str,
    days: int = 7,
    trusted_only: bool = True,
    article_weight: float = 0.6,
    discussion_weight: float = 0.4,
) -> Dict[str, Any]:
    """
    기사/댓글/종합 여론 온도를 모두 계산해서 JSON으로 반환합니다.

    Args:
        keyword: 검색할 키워드
        days: 분석 기간 (일)
        trusted_only: 신뢰 매체만 분석할지 여부
        article_weight: 기사 가중치 (0-1)
        discussion_weight: 댓글 가중치 (0-1)

    Returns:
        기사/댓글/종합 여론 온도 데이터
    """
    article_info = compute_article_temperature(keyword, days, trusted_only)
    discussion_info = compute_discussion_temperature(keyword, days)

    # weight 정규화
    total_w = article_weight + discussion_weight
    if total_w <= 0:
        article_weight_n = 0.6
        discussion_weight_n = 0.4
    else:
        article_weight_n = article_weight / total_w
        discussion_weight_n = discussion_weight / total_w

    combined_info = compute_combined_temperature(
        article_info,
        discussion_info,
        article_weight=article_weight_n,
        discussion_weight=discussion_weight_n,
    )

    return {
        "keyword": keyword,
        "days": days,
        "trusted_only": trusted_only,
        "article": article_info,
        "discussion": discussion_info,
        "combined": combined_info,
        "generated_at": datetime.utcnow().isoformat(),
    }


@server.tool()
async def get_sentiment_report(
    keyword: str,
    days: int = 7,
    trusted_only: bool = True,
    article_weight: float = 0.6,
    discussion_weight: float = 0.4,
    session_id: Optional[str] = None,
) -> str:
    """
    여론 온도 데이터를 기반으로 AiDove가 작성한 자연어 한국어 리포트를 반환합니다.

    Args:
        keyword: 검색할 키워드
        days: 분석 기간 (일)
        trusted_only: 신뢰 매체만 분석할지 여부
        article_weight: 기사 가중치 (0-1)
        discussion_weight: 댓글 가중치 (0-1)
        session_id: AiDove 세션 ID (선택)

    Returns:
        자연어 여론 분석 리포트
    """
    raw = await get_sentiment_raw(
        keyword=keyword,
        days=days,
        trusted_only=trusted_only,
        article_weight=article_weight,
        discussion_weight=discussion_weight,
    )

    prompt = f"""
너는 'News Insight'라는 뉴스 여론 분석 서비스의 리포트 작성 어시스턴트야.

아래 JSON은 특정 키워드에 대해 기사/댓글/종합 관점에서 계산한 여론 온도 데이터야.

키워드: {keyword}
기간: 최근 {days}일
신뢰매체 필터: {trusted_only}

JSON 데이터:
{json.dumps(raw, ensure_ascii=False, indent=2, default=str)}

요청사항:
1. 기사 기반 여론 온도와 댓글 기반 여론 온도의 차이를 설명해줘.
2. 종합 여론 온도(기사 {article_weight:.0%}, 댓글 {discussion_weight:.0%} 비율)를 기준으로
   지금 여론이 '전반적으로 긍정/부정/중립' 중 어디에 가까운지 분석해줘.
3. 기사와 댓글이 서로 반대되는 경우(예: 기사 긍정, 댓글 부정)라면,
   그 이유를 추정해서 설명해줘. (추정일 경우 '추정'이라고 명시)
4. 신뢰 매체 필터(trusted_only)의 의미를 한 줄 정도로 설명해줘.
5. 마지막에는 '데이터 수집 범위와 분석 방식에 따른 한계'에 대한 짧은 주의 문장을 적어줘.

전체 리포트는 3~6 단락 정도의 자연스러운 한국어로 작성해줘.
"""
    report = call_aidove(prompt, session_id=session_id)
    return report


@server.tool()
async def get_article_list(
    keyword: str,
    days: int = 7,
    limit: int = 20,
) -> Dict[str, Any]:
    """
    키워드로 검색한 기사 목록을 반환합니다 (ML 분석 결과 포함).

    Args:
        keyword: 검색할 키워드
        days: 검색 기간 (일)
        limit: 최대 결과 수

    Returns:
        기사 목록 및 메타데이터
    """
    articles = get_articles_from_db(keyword, days, limit)

    result = []
    for a in articles:
        published_at = a.get("published_at")
        result.append(
            {
                "id": a.get("id"),
                "title": a.get("title"),
                "source": a.get("source_name"),
                "published_at": published_at.isoformat()
                if isinstance(published_at, datetime)
                else str(published_at)
                if published_at
                else None,
                "url": a.get("url"),
                "summary": (a.get("summary") or "")[:200],
                "sentiment": {
                    "score": a.get("sentiment_score"),
                    "label": a.get("sentiment_label"),
                },
                "reliability_score": a.get("reliability_score"),
                "bias": {
                    "score": a.get("bias_score"),
                    "label": a.get("bias_label"),
                },
            }
        )

    return {
        "keyword": keyword,
        "days": days,
        "count": len(result),
        "articles": result,
    }


@server.tool()
async def get_discussion_summary(
    keyword: str,
    days: int = 7,
) -> Dict[str, Any]:
    """
    키워드 관련 여론/댓글 요약 정보를 반환합니다.

    Args:
        keyword: 검색할 키워드
        days: 검색 기간 (일)

    Returns:
        여론/댓글 요약 통계
    """
    discussions = get_discussions_from_db(keyword, days)

    if not discussions:
        return {
            "keyword": keyword,
            "days": days,
            "has_data": False,
            "message": "관련 여론 데이터가 없습니다.",
        }

    # 집계
    total_comments = sum(d.get("total_comment_count", 0) for d in discussions)

    # 주요 키워드 집계
    all_keywords: Dict[str, int] = {}
    for d in discussions:
        for kw in d.get("top_keywords", []):
            if isinstance(kw, dict):
                word = kw.get("word", "")
                count = kw.get("count", 0)
                all_keywords[word] = all_keywords.get(word, 0) + count

    top_keywords = sorted(all_keywords.items(), key=lambda x: x[1], reverse=True)[:10]

    # 감성 분포 평균
    total_sentiment = {"positive": 0.0, "negative": 0.0, "neutral": 0.0}
    sentiment_count = 0
    for d in discussions:
        dist = d.get("sentiment_distribution", {})
        if dist:
            sentiment_count += 1
            for k in total_sentiment:
                total_sentiment[k] += float(dist.get(k, 0.0))

    if sentiment_count > 0:
        for k in total_sentiment:
            total_sentiment[k] = round(total_sentiment[k] / sentiment_count, 3)

    # 품질/봇 점수 평균
    quality_scores = [
        d["discussion_quality_score"]
        for d in discussions
        if d.get("discussion_quality_score") is not None
    ]
    bot_scores = [
        d["bot_likelihood_score"]
        for d in discussions
        if d.get("bot_likelihood_score") is not None
    ]

    return {
        "keyword": keyword,
        "days": days,
        "has_data": True,
        "total_comments": total_comments,
        "article_count": len(discussions),
        "avg_sentiment": total_sentiment,
        "top_keywords": [{"word": w, "count": c} for w, c in top_keywords],
        "avg_quality_score": round(sum(quality_scores) / len(quality_scores), 1)
        if quality_scores
        else None,
        "avg_bot_likelihood": round(sum(bot_scores) / len(bot_scores), 3)
        if bot_scores
        else None,
    }


@server.tool()
async def health_check() -> Dict[str, Any]:
    """
    서버 상태 및 DB 연결 상태를 확인합니다.

    Returns:
        서버 상태 정보
    """
    status = {
        "server": "News Insight MCP",
        "version": "2.0.0",
        "db_backend": DB_BACKEND,
        "status": "running",
        "timestamp": datetime.utcnow().isoformat(),
    }

    # DB 연결 테스트
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
# 9. HTTP 서버 및 헬스체크 엔드포인트
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
                "server": "news-insight-mcp",
                "version": "2.0.0",
            }
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # 로그 출력 억제


def start_health_server(port: int):
    """헬스체크용 HTTP 서버를 별도 스레드에서 시작"""
    health_port = port  # 동일 포트에서 /health 제공
    # MCP 서버가 HTTP를 처리하므로 별도 헬스 서버는 필요 없을 수 있음
    pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    print(f"Starting News Insight MCP Server v2.0.0 on port {port}")
    print(f"DB Backend: {DB_BACKEND}")
    server.run_http(host="0.0.0.0", port=port, path="/mcp")
