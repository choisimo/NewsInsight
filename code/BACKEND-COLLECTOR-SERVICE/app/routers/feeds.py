"""
피드 수집 라우터

RSS 피드 및 웹 피드 수집 관련 API 엔드포인트입니다.
"""

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from typing import List, Dict, Any
from app.db import get_db
from datetime import datetime
import feedparser
import requests

router = APIRouter()


@router.get("/")
async def list_feeds(
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    등록된 피드 목록 조회
    
    Returns:
        피드 목록
    """
    # 데모용 피드 목록
    feeds = [
        {
            "id": "feed-1",
            "name": "국민연금 공단 뉴스",
            "url": "https://www.nps.or.kr/jsppage/cyber_pr/news/rss.jsp",
            "type": "rss",
            "is_active": True,
            "last_fetched": datetime.now().isoformat()
        },
        {
            "id": "feed-2",
            "name": "보건복지부 보도자료",
            "url": "https://www.mohw.go.kr/rss/news.xml",
            "type": "rss",
            "is_active": True,
            "last_fetched": None
        }
    ]
    
    return {
        "feeds": feeds,
        "total": len(feeds)
    }


@router.post("/fetch/{feed_id}")
async def fetch_feed(
    feed_id: str,
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    특정 피드 수집 실행
    
    Args:
        feed_id: 피드 ID
        db: 데이터베이스 세션
        
    Returns:
        수집 결과
    """
    # 피드 URL 가져오기 (데모)
    feed_urls = {
        "feed-1": "https://www.nps.or.kr/jsppage/cyber_pr/news/rss.jsp",
        "feed-2": "https://www.mohw.go.kr/rss/news.xml"
    }
    
    feed_url = feed_urls.get(feed_id)
    if not feed_url:
        raise HTTPException(status_code=404, detail="Feed not found")
    
    try:
        # RSS 피드 파싱
        feed = feedparser.parse(feed_url)
        
        # 피드 항목 수집
        items = []
        for entry in feed.entries[:10]:  # 최근 10개만
            items.append({
                "title": entry.get("title", ""),
                "link": entry.get("link", ""),
                "description": entry.get("description", "")[:200],
                "published": entry.get("published", ""),
                "guid": entry.get("id", "")
            })
        
        return {
            "feed_id": feed_id,
            "feed_title": feed.feed.get("title", "Unknown"),
            "items_collected": len(items),
            "items": items,
            "fetched_at": datetime.now().isoformat()
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch feed: {str(e)}")


@router.post("/fetch-all")
async def fetch_all_feeds(
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    모든 활성 피드 수집
    
    Returns:
        수집 결과 요약
    """
    # 활성 피드 목록 가져오기
    feeds_response = await list_feeds(db)
    active_feeds = [f for f in feeds_response["feeds"] if f["is_active"]]
    
    results = []
    success_count = 0
    error_count = 0
    
    for feed in active_feeds:
        try:
            result = await fetch_feed(feed["id"], db)
            results.append({
                "feed_id": feed["id"],
                "status": "success",
                "items_collected": result["items_collected"]
            })
            success_count += 1
        except Exception as e:
            results.append({
                "feed_id": feed["id"],
                "status": "error",
                "error": str(e)
            })
            error_count += 1
    
    return {
        "total_feeds": len(active_feeds),
        "success_count": success_count,
        "error_count": error_count,
        "results": results,
        "executed_at": datetime.now().isoformat()
    }


@router.post("/parse-url")
async def parse_feed_url(
    request: Dict[str, str]
) -> Dict[str, Any]:
    """
    URL에서 피드 파싱 테스트
    
    Args:
        request: {"url": "피드 URL"}
        
    Returns:
        파싱된 피드 정보
    """
    url = request.get("url")
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
    
    try:
        # 피드 파싱
        feed = feedparser.parse(url)
        
        if not feed.entries:
            return {
                "valid": False,
                "message": "No entries found in feed"
            }
        
        return {
            "valid": True,
            "feed_info": {
                "title": feed.feed.get("title", ""),
                "link": feed.feed.get("link", ""),
                "description": feed.feed.get("description", ""),
                "language": feed.feed.get("language", "")
            },
            "entry_count": len(feed.entries),
            "sample_entries": [
                {
                    "title": entry.get("title", ""),
                    "published": entry.get("published", "")
                }
                for entry in feed.entries[:3]
            ]
        }
    
    except Exception as e:
        return {
            "valid": False,
            "message": str(e)
        }
