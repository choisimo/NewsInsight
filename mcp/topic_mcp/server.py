"""
Topic Analysis MCP Server - 뉴스 토픽/트렌드 분석

실제 프로젝트 스키마(collected_data, article_analysis)를 기반으로
뉴스 토픽, 키워드 트렌드, 관련 이슈를 분석하는 MCP 서버입니다.

Version: 1.0.0
Port: 5003
"""

import os
import json
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any
from urllib.parse import urlparse
from collections import Counter

import requests
from mcp.server import Server

# ─────────────────────────────────────────────
# 1. MCP 서버 기본 설정
# ─────────────────────────────────────────────

server = Server("topic-analysis-mcp", version="1.0.0")

# DB 백엔드 선택: "postgres" 또는 "mongo"
DB_BACKEND = os.environ.get("DB_BACKEND", "postgres")

# PostgreSQL 접속 정보
POSTGRES_DSN = os.environ.get("DATABASE_URL")

# MongoDB 접속 정보
MONGODB_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/newsinsight")

# AiDove Webhook URL
AIDOVE_WEBHOOK_URL = os.environ.get(
    "AIDOVE_WEBHOOK_URL", "https://workflow.nodove.com/webhook/aidove"
)


# ─────────────────────────────────────────────
# 2. 토픽 분석 관련 상수
# ─────────────────────────────────────────────

# 카테고리 매핑
CATEGORY_KEYWORDS = {
    "정치": [
        "대통령",
        "국회",
        "여당",
        "야당",
        "정부",
        "선거",
        "의원",
        "장관",
        "청와대",
        "총리",
    ],
    "경제": [
        "주식",
        "코스피",
        "환율",
        "금리",
        "물가",
        "GDP",
        "수출",
        "투자",
        "기업",
        "은행",
    ],
    "사회": [
        "사건",
        "사고",
        "범죄",
        "재판",
        "경찰",
        "검찰",
        "법원",
        "시민",
        "단체",
        "복지",
    ],
    "국제": [
        "미국",
        "중국",
        "일본",
        "러시아",
        "북한",
        "유럽",
        "UN",
        "외교",
        "정상회담",
        "무역",
    ],
    "문화": [
        "영화",
        "드라마",
        "음악",
        "공연",
        "전시",
        "예술",
        "연예",
        "방송",
        "K-POP",
        "한류",
    ],
    "IT/과학": [
        "AI",
        "인공지능",
        "반도체",
        "스마트폰",
        "IT",
        "테크",
        "우주",
        "로봇",
        "디지털",
        "플랫폼",
    ],
    "스포츠": [
        "축구",
        "야구",
        "농구",
        "올림픽",
        "월드컵",
        "선수",
        "감독",
        "경기",
        "리그",
        "승리",
    ],
}

# 불용어 (분석에서 제외할 일반적인 단어)
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
    "에게",
    "까지",
    "부터",
    "처럼",
    "오늘",
    "내일",
    "어제",
    "올해",
    "지난",
    "이번",
    "다음",
    "최근",
    "현재",
    "앞으로",
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
# 4. 토픽 데이터 조회
# ─────────────────────────────────────────────


def get_articles_for_topic_analysis(
    keyword: Optional[str] = None, days: int = 7, limit: int = 200
) -> List[Dict[str, Any]]:
    """
    토픽 분석을 위한 기사 데이터를 DB에서 조회.
    keyword가 None이면 전체 최신 기사를 조회.
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
                        COALESCE(aa.summary, LEFT(cd.content, 1000)) as content,
                        ds.name as source_name,
                        COALESCE(cd.published_date, cd.collected_at) as published_at,
                        cd.url,
                        aa.keywords,
                        aa.entities,
                        aa.topics,
                        aa.category
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
                        COALESCE(aa.summary, LEFT(cd.content, 1000)) as content,
                        ds.name as source_name,
                        COALESCE(cd.published_date, cd.collected_at) as published_at,
                        cd.url,
                        aa.keywords,
                        aa.entities,
                        aa.topics,
                        aa.category
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
                keywords,
                entities,
                topics,
                category,
            ) = row

            # JSONB 파싱
            def parse_json(val):
                if val is None:
                    return []
                if isinstance(val, list):
                    return val
                if isinstance(val, str):
                    try:
                        return json.loads(val)
                    except:
                        return []
                return []

            articles.append(
                {
                    "id": id_,
                    "title": title,
                    "content": content,
                    "source_name": source_name or "기타",
                    "published_at": published_at,
                    "url": url,
                    "keywords": parse_json(keywords),
                    "entities": parse_json(entities),
                    "topics": parse_json(topics),
                    "category": category,
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
                    "content": doc.get("content", "")[:1000],
                    "source_name": doc.get("source_name", "기타"),
                    "published_at": doc.get("published_date")
                    or doc.get("collected_at"),
                    "url": doc.get("url"),
                    "keywords": doc.get("keywords", []),
                    "entities": doc.get("entities", []),
                    "topics": doc.get("topics", []),
                    "category": doc.get("category"),
                }
            )
        return articles

    else:
        raise RuntimeError(f"지원하지 않는 DB_BACKEND: {DB_BACKEND}")


# ─────────────────────────────────────────────
# 5. 키워드 추출 (룰 기반 Fallback)
# ─────────────────────────────────────────────


def extract_keywords_simple(text: str, top_n: int = 20) -> List[Dict[str, Any]]:
    """
    간단한 룰 기반 키워드 추출 (ML 결과가 없을 때 사용).
    한글 명사 추출 휴리스틱 사용.
    """
    import re

    # 한글 단어 추출 (2글자 이상)
    words = re.findall(r"[가-힣]{2,}", text)

    # 불용어 제거
    words = [w for w in words if w not in STOPWORDS and len(w) >= 2]

    # 빈도 계산
    counter = Counter(words)

    # 상위 N개 반환
    result = []
    for word, count in counter.most_common(top_n):
        result.append({"word": word, "count": count})

    return result


def detect_category(text: str, keywords: List[str]) -> str:
    """
    텍스트와 키워드를 기반으로 카테고리를 추정합니다.
    """
    category_scores = {}
    combined_text = f"{text} {' '.join(keywords)}".lower()

    for category, cat_keywords in CATEGORY_KEYWORDS.items():
        score = sum(1 for kw in cat_keywords if kw in combined_text)
        if score > 0:
            category_scores[category] = score

    if category_scores:
        return max(category_scores.items(), key=lambda x: x[1])[0]
    return "기타"


# ─────────────────────────────────────────────
# 6. 토픽 분석 로직
# ─────────────────────────────────────────────


def compute_topic_analysis(
    keyword: Optional[str] = None,
    days: int = 7,
) -> Dict[str, Any]:
    """
    키워드 관련(또는 전체) 기사들의 토픽을 종합 분석합니다.
    """
    articles = get_articles_for_topic_analysis(keyword, days)

    if not articles:
        return {
            "keyword": keyword,
            "days": days,
            "article_count": 0,
            "top_keywords": [],
            "category_distribution": {},
            "source_distribution": {},
            "timeline": {},
            "related_topics": [],
            "ml_analyzed_count": 0,
            "note": "분석할 기사가 없습니다.",
        }

    # 전체 키워드 집계
    all_keywords: Counter = Counter()
    category_counts: Counter = Counter()
    source_counts: Counter = Counter()
    timeline: Dict[str, int] = {}
    ml_count = 0
    all_entities: Counter = Counter()

    for article in articles:
        source = article.get("source_name", "기타")
        source_counts[source] += 1

        # 날짜별 기사 수
        pub_date = article.get("published_at")
        if isinstance(pub_date, datetime):
            date_key = pub_date.strftime("%Y-%m-%d")
            timeline[date_key] = timeline.get(date_key, 0) + 1

        # ML 키워드가 있으면 사용, 없으면 룰 기반 추출
        if article.get("keywords") and len(article["keywords"]) > 0:
            for kw in article["keywords"]:
                if isinstance(kw, dict):
                    word = kw.get("word") or kw.get("keyword", "")
                    count = kw.get("count", 1)
                else:
                    word = str(kw)
                    count = 1
                if word and word not in STOPWORDS:
                    all_keywords[word] += count
            ml_count += 1
        else:
            text = f"{article.get('title', '')} {article.get('content', '')}"
            extracted = extract_keywords_simple(text, 10)
            for kw in extracted:
                all_keywords[kw["word"]] += kw["count"]

        # 엔티티 집계
        for entity in article.get("entities", []):
            if isinstance(entity, dict):
                name = entity.get("name") or entity.get("entity", "")
            else:
                name = str(entity)
            if name:
                all_entities[name] += 1

        # 카테고리 집계
        category = article.get("category")
        if category:
            category_counts[category] += 1
        else:
            # 카테고리가 없으면 추정
            keywords_list = [
                kw.get("word", kw) if isinstance(kw, dict) else str(kw)
                for kw in article.get("keywords", [])
            ]
            detected = detect_category(article.get("title", ""), keywords_list)
            category_counts[detected] += 1

    # 상위 키워드
    top_keywords = [
        {"word": word, "count": count} for word, count in all_keywords.most_common(30)
    ]

    # 상위 엔티티 (인물, 기관 등)
    top_entities = [
        {"name": name, "count": count} for name, count in all_entities.most_common(20)
    ]

    # 카테고리 분포
    total = len(articles)
    category_distribution = {
        cat: {"count": count, "ratio": round(count / total, 3)}
        for cat, count in category_counts.most_common()
    }

    # 출처 분포
    source_distribution = {
        source: {"count": count, "ratio": round(count / total, 3)}
        for source, count in source_counts.most_common(10)
    }

    # 타임라인 정렬
    sorted_timeline = dict(sorted(timeline.items()))

    # 관련 토픽 (상위 키워드 기반)
    related_topics = [kw["word"] for kw in top_keywords[:10]]

    return {
        "keyword": keyword,
        "days": days,
        "article_count": len(articles),
        "ml_analyzed_count": ml_count,
        "top_keywords": top_keywords,
        "top_entities": top_entities,
        "category_distribution": category_distribution,
        "source_distribution": source_distribution,
        "timeline": sorted_timeline,
        "related_topics": related_topics,
        "trend_summary": {
            "peak_date": max(timeline.items(), key=lambda x: x[1])[0]
            if timeline
            else None,
            "peak_count": max(timeline.values()) if timeline else 0,
            "avg_daily_articles": round(len(articles) / max(days, 1), 1),
        },
        "note": f"ML 분석 {ml_count}건, 룰 기반 {len(articles) - ml_count}건",
    }


def compute_trending_topics(days: int = 1, limit: int = 10) -> Dict[str, Any]:
    """
    최근 N일간 트렌딩 토픽을 분석합니다.
    """
    articles = get_articles_for_topic_analysis(keyword=None, days=days, limit=500)

    if not articles:
        return {
            "days": days,
            "article_count": 0,
            "trending_topics": [],
            "note": "분석할 기사가 없습니다.",
        }

    # 키워드 빈도 집계
    keyword_freq: Counter = Counter()
    keyword_sources: Dict[str, set] = {}  # 키워드별 출처 다양성

    for article in articles:
        source = article.get("source_name", "기타")

        # 키워드 추출
        if article.get("keywords") and len(article["keywords"]) > 0:
            keywords = []
            for kw in article["keywords"]:
                if isinstance(kw, dict):
                    keywords.append(kw.get("word") or kw.get("keyword", ""))
                else:
                    keywords.append(str(kw))
        else:
            text = f"{article.get('title', '')} {article.get('content', '')}"
            extracted = extract_keywords_simple(text, 5)
            keywords = [kw["word"] for kw in extracted]

        for word in keywords:
            if word and word not in STOPWORDS:
                keyword_freq[word] += 1
                if word not in keyword_sources:
                    keyword_sources[word] = set()
                keyword_sources[word].add(source)

    # 트렌딩 점수 계산 (빈도 × 출처 다양성)
    trending_scores = []
    for word, freq in keyword_freq.most_common(50):
        source_diversity = len(keyword_sources.get(word, set()))
        score = freq * (1 + source_diversity * 0.2)  # 다양한 출처일수록 가중치
        trending_scores.append(
            {
                "topic": word,
                "frequency": freq,
                "source_count": source_diversity,
                "trending_score": round(score, 1),
            }
        )

    # 점수 기준 정렬
    trending_scores.sort(key=lambda x: x["trending_score"], reverse=True)

    return {
        "days": days,
        "article_count": len(articles),
        "trending_topics": trending_scores[:limit],
        "generated_at": datetime.utcnow().isoformat(),
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
async def get_topic_raw(
    keyword: Optional[str] = None,
    days: int = 7,
) -> Dict[str, Any]:
    """
    키워드 관련(또는 전체) 뉴스의 토픽 분석 데이터를 JSON으로 반환합니다.

    Args:
        keyword: 검색할 키워드 (None이면 전체 분석)
        days: 분석 기간 (일)

    Returns:
        토픽 분석 데이터 (키워드, 카테고리, 트렌드 등)
    """
    result = compute_topic_analysis(keyword, days)
    result["generated_at"] = datetime.utcnow().isoformat()
    return result


@server.tool()
async def get_topic_report(
    keyword: Optional[str] = None,
    days: int = 7,
    session_id: Optional[str] = None,
) -> str:
    """
    키워드 관련(또는 전체) 뉴스의 토픽을 분석하여 AiDove가 작성한 자연어 리포트를 반환합니다.

    Args:
        keyword: 검색할 키워드 (None이면 전체 분석)
        days: 분석 기간 (일)
        session_id: AiDove 세션 ID (선택)

    Returns:
        자연어 토픽 분석 리포트
    """
    raw = await get_topic_raw(keyword=keyword, days=days)

    keyword_desc = f"'{keyword}'" if keyword else "전체 뉴스"

    prompt = f"""
너는 'News Insight'라는 뉴스 분석 서비스의 토픽 분석 리포트 작성 어시스턴트야.

아래 JSON은 {keyword_desc}에 대한 토픽 분석 결과야.

분석 대상: {keyword_desc}
기간: 최근 {days}일

JSON 데이터:
{json.dumps(raw, ensure_ascii=False, indent=2, default=str)}

요청사항:
1. 주요 토픽/키워드 트렌드를 요약해줘. 어떤 주제가 가장 많이 다뤄졌는지 설명해줘.
2. 카테고리 분포를 분석하고, 이 키워드가 주로 어떤 분야에서 다뤄지는지 설명해줘.
3. 타임라인(일별 기사 수)을 분석하여 보도량의 추이를 설명해줘. 특정 날짜에 급증했다면 그 이유를 추정해봐.
4. 주요 엔티티(인물, 기관 등)가 있다면 어떤 주체들이 연관되어 있는지 설명해줘.
5. 관련 토픽을 기반으로 독자가 함께 살펴볼 만한 연관 주제를 추천해줘.
6. 마지막에는 '토픽 분석의 한계'에 대한 짧은 주의 문장을 적어줘.

전체 리포트는 3~6 단락 정도의 자연스러운 한국어로 작성해줘.
"""
    report = call_aidove(prompt, session_id=session_id)
    return report


@server.tool()
async def get_trending_topics(
    days: int = 1,
    limit: int = 10,
) -> Dict[str, Any]:
    """
    최근 N일간 트렌딩 토픽 목록을 반환합니다.

    Args:
        days: 분석 기간 (일, 기본 1일)
        limit: 반환할 토픽 수 (기본 10개)

    Returns:
        트렌딩 토픽 목록
    """
    return compute_trending_topics(days, limit)


@server.tool()
async def get_category_list() -> Dict[str, Any]:
    """
    지원하는 뉴스 카테고리 목록과 관련 키워드를 반환합니다.

    Returns:
        카테고리 목록 및 키워드
    """
    return {
        "description": "뉴스 분류에 사용되는 카테고리 목록",
        "categories": [
            {
                "name": category,
                "keywords": keywords,
            }
            for category, keywords in CATEGORY_KEYWORDS.items()
        ],
    }


@server.tool()
async def health_check() -> Dict[str, Any]:
    """
    서버 상태 및 DB 연결 상태를 확인합니다.

    Returns:
        서버 상태 정보
    """
    status = {
        "server": "Topic Analysis MCP",
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
                "server": "topic-analysis-mcp",
                "version": "1.0.0",
            }
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5003"))
    print(f"Starting Topic Analysis MCP Server v1.0.0 on port {port}")
    print(f"DB Backend: {DB_BACKEND}")
    server.run_http(host="0.0.0.0", port=port, path="/mcp")
