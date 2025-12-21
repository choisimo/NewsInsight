"""
Sentiment Analysis MCP Server - 뉴스 감정 분석

실제 프로젝트 스키마(collected_data, article_analysis)와 sentiment-addon을 연동하여
뉴스 기사의 감정 분석을 수행하는 MCP 서버입니다.

Version: 1.0.0
Port: 5004
"""

import os
import json
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any
from urllib.parse import urlparse
from collections import Counter

import requests
from mcp.server import FastMCP
from starlette.responses import JSONResponse
from starlette.requests import Request

# ─────────────────────────────────────────────
# 1. MCP 서버 기본 설정
# ─────────────────────────────────────────────

PORT = int(os.environ.get("PORT", "5004"))

server = FastMCP(
    "sentiment-analysis-mcp",
    host="0.0.0.0",
    port=PORT,
)


@server.custom_route("/health", methods=["GET"])
async def health_endpoint(request: Request) -> JSONResponse:
    return JSONResponse(
        {
            "status": "healthy",
            "server": "sentiment-analysis-mcp",
            "version": "1.0.0",
        }
    )


# DB 백엔드 선택
DB_BACKEND = os.environ.get("DB_BACKEND", "postgres")

# PostgreSQL 접속 정보
POSTGRES_DSN = os.environ.get("DATABASE_URL")

# MongoDB 접속 정보
MONGODB_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/newsinsight")

# Sentiment Addon URL
SENTIMENT_ADDON_URL = os.environ.get(
    "SENTIMENT_ADDON_URL", "http://sentiment-addon:8002"
)

# AiDove Webhook URL
AIDOVE_WEBHOOK_URL = os.environ.get(
    "AIDOVE_WEBHOOK_URL", "https://workflow.nodove.com/webhook/aidove"
)


# ─────────────────────────────────────────────
# 2. 감정 분석 관련 상수
# ─────────────────────────────────────────────

# 감정 레이블 매핑 (한국어)
SENTIMENT_LABELS = {
    "positive": "긍정",
    "negative": "부정",
    "neutral": "중립",
}

# 상세 감정 레이블
EMOTION_LABELS = {
    "joy": "기쁨",
    "sadness": "슬픔",
    "anger": "분노",
    "fear": "두려움",
    "surprise": "놀라움",
    "disgust": "혐오",
    "neutral": "중립",
}

# 불용어
STOPWORDS = {
    "있다",
    "하다",
    "되다",
    "이다",
    "않다",
    "없다",
    "같다",
    "보다",
    "위해",
    "대해",
    "통해",
    "따라",
    "관련",
    "대한",
    "에서",
    "으로",
}


# ─────────────────────────────────────────────
# 3. DB 연결 헬퍼
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
            raise RuntimeError("DATABASE_URL이 설정되어 있지 않습니다.")
        _pg_conn = psycopg2.connect(POSTGRES_DSN)
        _pg_conn.autocommit = True
    return _pg_conn


def get_mongo_db():
    """MongoDB 데이터베이스 객체를 반환합니다."""
    global _mongo_client, _mongo_db
    from pymongo import MongoClient

    if _mongo_db is None:
        if not MONGODB_URI:
            raise RuntimeError("MONGODB_URI가 설정되어 있지 않습니다.")

        _mongo_client = MongoClient(MONGODB_URI)
        parsed = urlparse(MONGODB_URI)
        db_name = parsed.path.lstrip("/").split("?")[0] or "newsinsight"
        _mongo_db = _mongo_client[db_name]

    return _mongo_db


# ─────────────────────────────────────────────
# 4. 기사 데이터 조회
# ─────────────────────────────────────────────


def get_articles_for_sentiment_analysis(
    keyword: Optional[str] = None, days: int = 7, limit: int = 100
) -> List[Dict[str, Any]]:
    """
    감정 분석을 위한 기사 데이터를 DB에서 조회.
    """
    cutoff = datetime.utcnow() - timedelta(days=days)

    if DB_BACKEND == "postgres":
        conn = get_postgres_conn()
        with conn.cursor() as cur:
            if keyword:
                query = """
                    SELECT 
                        cd.id,
                        cd.title,
                        LEFT(cd.content, 2000) as content,
                        ds.name as source_name,
                        COALESCE(cd.published_date, cd.collected_at) as published_at,
                        cd.url,
                        aa.sentiment,
                        aa.sentiment_score,
                        aa.emotions
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
            else:
                query = """
                    SELECT 
                        cd.id,
                        cd.title,
                        LEFT(cd.content, 2000) as content,
                        ds.name as source_name,
                        COALESCE(cd.published_date, cd.collected_at) as published_at,
                        cd.url,
                        aa.sentiment,
                        aa.sentiment_score,
                        aa.emotions
                    FROM collected_data cd
                    LEFT JOIN data_sources ds ON cd.source_id = ds.id
                    LEFT JOIN article_analysis aa ON cd.id = aa.article_id
                    WHERE COALESCE(cd.published_date, cd.collected_at) >= %s
                    ORDER BY COALESCE(cd.published_date, cd.collected_at) DESC
                    LIMIT %s
                """
                cur.execute(query, (cutoff, limit))

            rows = cur.fetchall()

        articles = []
        for row in rows:
            (
                id_,
                title,
                content,
                source_name,
                published_at,
                url,
                sentiment,
                sentiment_score,
                emotions,
            ) = row

            def parse_json(val):
                if val is None:
                    return None
                if isinstance(val, (dict, list)):
                    return val
                if isinstance(val, str):
                    try:
                        return json.loads(val)
                    except:
                        return val
                return val

            articles.append(
                {
                    "id": id_,
                    "title": title,
                    "content": content,
                    "source_name": source_name or "기타",
                    "published_at": published_at,
                    "url": url,
                    "sentiment": sentiment,
                    "sentiment_score": sentiment_score,
                    "emotions": parse_json(emotions),
                }
            )
        return articles

    elif DB_BACKEND == "mongo":
        db = get_mongo_db()
        query_filter = {"collected_at": {"$gte": cutoff}}
        if keyword:
            query_filter["$or"] = [
                {"title": {"$regex": keyword, "$options": "i"}},
                {"content": {"$regex": keyword, "$options": "i"}},
            ]

        cursor = (
            db.collected_data.find(query_filter).sort("collected_at", -1).limit(limit)
        )

        articles = []
        for doc in cursor:
            articles.append(
                {
                    "id": str(doc.get("_id")),
                    "title": doc.get("title", ""),
                    "content": doc.get("content", "")[:2000],
                    "source_name": doc.get("source_name", "기타"),
                    "published_at": doc.get("published_date")
                    or doc.get("collected_at"),
                    "url": doc.get("url"),
                    "sentiment": doc.get("sentiment"),
                    "sentiment_score": doc.get("sentiment_score"),
                    "emotions": doc.get("emotions"),
                }
            )
        return articles

    else:
        raise RuntimeError(f"지원하지 않는 DB_BACKEND: {DB_BACKEND}")


# ─────────────────────────────────────────────
# 5. 감정 분석 로직
# ─────────────────────────────────────────────


def call_sentiment_addon(text: str) -> Dict[str, Any]:
    """
    Sentiment addon API를 호출하여 감정 분석을 수행합니다.
    """
    try:
        response = requests.post(
            f"{SENTIMENT_ADDON_URL}/analyze",
            json={
                "article": {
                    "title": "",
                    "content": text[:2000],
                    "source": "",
                    "url": "",
                },
                "options": {
                    "detailed_emotions": True,
                },
            },
            timeout=30,
        )
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        return {"error": str(e)}


def analyze_sentiment_heuristic(text: str) -> Dict[str, Any]:
    """
    ML addon이 불가능할 때 사용하는 키워드 기반 감정 분석.
    """
    # 감정 키워드
    positive_keywords = {
        "좋다",
        "훌륭하다",
        "성공",
        "발전",
        "희망",
        "기쁨",
        "긍정",
        "최고",
        "향상",
        "개선",
        "성장",
        "달성",
        "혁신",
        "승리",
        "만족",
        "행복",
        "축하",
        "기대",
    }
    negative_keywords = {
        "나쁘다",
        "실패",
        "위기",
        "우려",
        "걱정",
        "문제",
        "손실",
        "하락",
        "감소",
        "비판",
        "논란",
        "갈등",
        "사고",
        "피해",
        "충격",
        "실망",
        "불안",
        "위험",
    }

    text_lower = text.lower()
    positive_count = sum(1 for kw in positive_keywords if kw in text_lower)
    negative_count = sum(1 for kw in negative_keywords if kw in text_lower)

    total = positive_count + negative_count
    if total == 0:
        return {
            "sentiment": "neutral",
            "sentiment_kr": "중립",
            "confidence": 0.5,
            "positive_score": 0.33,
            "negative_score": 0.33,
            "neutral_score": 0.34,
        }

    positive_ratio = positive_count / total
    negative_ratio = negative_count / total

    if positive_ratio > 0.6:
        sentiment = "positive"
    elif negative_ratio > 0.6:
        sentiment = "negative"
    else:
        sentiment = "neutral"

    return {
        "sentiment": sentiment,
        "sentiment_kr": SENTIMENT_LABELS.get(sentiment, "중립"),
        "confidence": max(positive_ratio, negative_ratio, 0.4),
        "positive_score": positive_ratio,
        "negative_score": negative_ratio,
        "neutral_score": 1 - positive_ratio - negative_ratio
        if positive_ratio + negative_ratio < 1
        else 0,
    }


def compute_sentiment_analysis(
    keyword: Optional[str] = None,
    days: int = 7,
    use_addon: bool = True,
) -> Dict[str, Any]:
    """
    키워드 관련(또는 전체) 기사들의 감정 분석을 수행합니다.
    """
    articles = get_articles_for_sentiment_analysis(keyword, days)

    if not articles:
        return {
            "keyword": keyword,
            "days": days,
            "article_count": 0,
            "sentiment_distribution": {},
            "average_sentiment_score": None,
            "timeline": {},
            "source_sentiment": {},
            "note": "분석할 기사가 없습니다.",
        }

    sentiment_counts = Counter()
    sentiment_scores = []
    timeline: Dict[str, Dict[str, int]] = {}
    source_sentiments: Dict[str, List[float]] = {}
    analyzed_count = 0
    addon_used = 0

    for article in articles:
        source = article.get("source_name", "기타")

        # 이미 분석된 결과가 있으면 사용
        if article.get("sentiment"):
            sentiment = article["sentiment"]
            score = article.get("sentiment_score", 0.5)
            analyzed_count += 1
        elif use_addon:
            # Sentiment addon 호출
            text = f"{article.get('title', '')} {article.get('content', '')}"
            result = call_sentiment_addon(text)
            if "error" not in result and result.get("data"):
                data = result["data"]
                sentiment = data.get("sentiment", {}).get("label", "neutral")
                score = data.get("sentiment", {}).get("confidence", 0.5)
                addon_used += 1
            else:
                # Fallback to heuristic
                heuristic = analyze_sentiment_heuristic(text)
                sentiment = heuristic["sentiment"]
                score = heuristic["confidence"]
        else:
            # Heuristic only
            text = f"{article.get('title', '')} {article.get('content', '')}"
            heuristic = analyze_sentiment_heuristic(text)
            sentiment = heuristic["sentiment"]
            score = heuristic["confidence"]

        sentiment_counts[sentiment] += 1
        sentiment_scores.append(
            score
            if sentiment == "positive"
            else (1 - score if sentiment == "negative" else 0.5)
        )

        # 날짜별 감정 분포
        pub_date = article.get("published_at")
        if isinstance(pub_date, datetime):
            date_key = pub_date.strftime("%Y-%m-%d")
            if date_key not in timeline:
                timeline[date_key] = {"positive": 0, "negative": 0, "neutral": 0}
            timeline[date_key][sentiment] = timeline[date_key].get(sentiment, 0) + 1

        # 출처별 감정 점수
        if source not in source_sentiments:
            source_sentiments[source] = []
        source_sentiments[source].append(
            score
            if sentiment == "positive"
            else (1 - score if sentiment == "negative" else 0.5)
        )

    # 결과 집계
    total = len(articles)
    sentiment_distribution = {
        SENTIMENT_LABELS.get(s, s): {
            "count": count,
            "ratio": round(count / total, 3),
        }
        for s, count in sentiment_counts.most_common()
    }

    # 출처별 평균 감정
    source_sentiment_avg = {
        source: {
            "avg_score": round(sum(scores) / len(scores), 3),
            "article_count": len(scores),
        }
        for source, scores in sorted(
            source_sentiments.items(), key=lambda x: len(x[1]), reverse=True
        )[:10]
    }

    # 타임라인 정렬
    sorted_timeline = {
        date: {SENTIMENT_LABELS.get(s, s): count for s, count in counts.items()}
        for date, counts in sorted(timeline.items())
    }

    # 전체 감정 추세
    avg_sentiment = (
        sum(sentiment_scores) / len(sentiment_scores) if sentiment_scores else 0.5
    )
    if avg_sentiment > 0.55:
        overall_sentiment = "긍정적"
    elif avg_sentiment < 0.45:
        overall_sentiment = "부정적"
    else:
        overall_sentiment = "중립적"

    return {
        "keyword": keyword,
        "days": days,
        "article_count": len(articles),
        "analyzed_from_db": analyzed_count,
        "addon_analyzed": addon_used,
        "sentiment_distribution": sentiment_distribution,
        "average_sentiment_score": round(avg_sentiment, 3),
        "overall_sentiment": overall_sentiment,
        "timeline": sorted_timeline,
        "source_sentiment": source_sentiment_avg,
        "generated_at": datetime.utcnow().isoformat(),
    }


# ─────────────────────────────────────────────
# 6. AiDove 호출 헬퍼
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
# 7. MCP Tools
# ─────────────────────────────────────────────


@server.tool()
async def get_sentiment_raw(
    keyword: Optional[str] = None,
    days: int = 7,
) -> Dict[str, Any]:
    """
    키워드 관련(또는 전체) 뉴스의 감정 분석 데이터를 JSON으로 반환합니다.

    Args:
        keyword: 검색할 키워드 (None이면 전체 분석)
        days: 분석 기간 (일)

    Returns:
        감정 분석 데이터 (감정 분포, 점수, 트렌드 등)
    """
    return compute_sentiment_analysis(keyword, days)


@server.tool()
async def get_sentiment_report(
    keyword: Optional[str] = None,
    days: int = 7,
    session_id: Optional[str] = None,
) -> str:
    """
    키워드 관련(또는 전체) 뉴스의 감정을 분석하여 AiDove가 작성한 자연어 리포트를 반환합니다.

    Args:
        keyword: 검색할 키워드 (None이면 전체 분석)
        days: 분석 기간 (일)
        session_id: AiDove 세션 ID (선택)

    Returns:
        자연어 감정 분석 리포트
    """
    raw = await get_sentiment_raw(keyword=keyword, days=days)

    keyword_desc = f"'{keyword}'" if keyword else "전체 뉴스"

    prompt = f"""
너는 'News Insight'라는 뉴스 분석 서비스의 감정 분석 리포트 작성 어시스턴트야.

아래 JSON은 {keyword_desc}에 대한 감정 분석 결과야.

분석 대상: {keyword_desc}
기간: 최근 {days}일

JSON 데이터:
{json.dumps(raw, ensure_ascii=False, indent=2, default=str)}

요청사항:
1. 전체적인 감정 분포를 요약해줘. 긍정/부정/중립 비율이 어떻게 되는지 설명해줘.
2. 평균 감정 점수와 전체적인 감정 추세를 해석해줘.
3. 타임라인(일별 감정 분포)을 분석하여 감정의 변화 추이를 설명해줘. 특정 날짜에 부정적/긍정적 기사가 많았다면 그 의미를 추정해봐.
4. 출처별 감정 차이가 있다면 분석해줘. 어떤 언론사가 더 긍정적/부정적으로 보도하는지 설명해줘.
5. 이 분석 결과가 독자에게 어떤 시사점을 주는지 간단히 설명해줘.
6. 마지막에는 '감정 분석의 한계'에 대한 짧은 주의 문장을 적어줘.

전체 리포트는 3~5 단락 정도의 자연스러운 한국어로 작성해줘.
"""
    report = call_aidove(prompt, session_id=session_id)
    return report


@server.tool()
async def analyze_text_sentiment(
    text: str,
) -> Dict[str, Any]:
    """
    주어진 텍스트의 감정을 분석합니다.

    Args:
        text: 분석할 텍스트

    Returns:
        감정 분석 결과 (감정 레이블, 점수, 상세 감정)
    """
    # Try addon first
    result = call_sentiment_addon(text)

    if "error" not in result and result.get("data"):
        data = result["data"]
        return {
            "text": text[:200] + "..." if len(text) > 200 else text,
            "sentiment": data.get("sentiment", {}),
            "emotions": data.get("emotions", {}),
            "analysis_method": "ml_addon",
            "generated_at": datetime.utcnow().isoformat(),
        }
    else:
        # Fallback to heuristic
        heuristic = analyze_sentiment_heuristic(text)
        return {
            "text": text[:200] + "..." if len(text) > 200 else text,
            "sentiment": {
                "label": heuristic["sentiment"],
                "label_kr": heuristic["sentiment_kr"],
                "confidence": heuristic["confidence"],
                "scores": {
                    "positive": heuristic["positive_score"],
                    "negative": heuristic["negative_score"],
                    "neutral": heuristic["neutral_score"],
                },
            },
            "emotions": None,
            "analysis_method": "heuristic",
            "note": "ML 모델을 사용할 수 없어 키워드 기반 분석을 수행했습니다.",
            "generated_at": datetime.utcnow().isoformat(),
        }


@server.tool()
async def compare_sentiment(
    keywords: List[str],
    days: int = 7,
) -> Dict[str, Any]:
    """
    여러 키워드의 감정 분석 결과를 비교합니다.

    Args:
        keywords: 비교할 키워드 목록
        days: 분석 기간 (일)

    Returns:
        키워드별 감정 비교 데이터
    """
    comparisons = []

    for keyword in keywords[:5]:  # 최대 5개까지
        result = compute_sentiment_analysis(keyword, days, use_addon=False)
        comparisons.append(
            {
                "keyword": keyword,
                "article_count": result["article_count"],
                "sentiment_distribution": result["sentiment_distribution"],
                "average_sentiment_score": result["average_sentiment_score"],
                "overall_sentiment": result["overall_sentiment"],
            }
        )

    return {
        "keywords": keywords[:5],
        "days": days,
        "comparisons": comparisons,
        "generated_at": datetime.utcnow().isoformat(),
    }


@server.tool()
async def health_check() -> Dict[str, Any]:
    """
    서버 상태 및 DB 연결 상태를 확인합니다.

    Returns:
        서버 상태 정보
    """
    status = {
        "server": "Sentiment Analysis MCP",
        "version": "1.0.0",
        "db_backend": DB_BACKEND,
        "sentiment_addon_url": SENTIMENT_ADDON_URL,
        "status": "running",
        "timestamp": datetime.utcnow().isoformat(),
    }

    # DB 연결 확인
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

    # Sentiment addon 연결 확인
    try:
        resp = requests.get(f"{SENTIMENT_ADDON_URL}/health", timeout=5)
        if resp.status_code == 200:
            status["sentiment_addon"] = "connected"
        else:
            status["sentiment_addon"] = "unavailable"
    except Exception as e:
        status["sentiment_addon"] = f"error: {str(e)}"

    return status


# ─────────────────────────────────────────────
# 8. 메인 실행
# ─────────────────────────────────────────────

if __name__ == "__main__":
    print(f"Starting Sentiment Analysis MCP Server v1.0.0 on port {PORT}")
    print(f"DB Backend: {DB_BACKEND}")
    print(f"Sentiment Addon: {SENTIMENT_ADDON_URL}")
    server.run(transport="streamable-http")
