"""
트렌드 분석 API 라우터

시간에 따른 감성 및 볼륨 트렌드를 분석하는 API 엔드포인트입니다.
일별, 주별, 월별 트렌드 분석과 인기 키워드 추출 기능을 제공합니다.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from app.db import get_db
from app.schemas import TrendAnalysisRequest, TrendAnalysisResponse, TrendItem
from app.services.trend_service import TrendService

# API 라우터 인스턴스 생성
router = APIRouter()


@router.post("/analyze", response_model=TrendAnalysisResponse)
async def analyze_trends(
    request: TrendAnalysisRequest,
    db: Session = Depends(get_db)
):
    """
    트렌드 분석 수행
    
    지정된 기간과 대상에 대한 트렌드를 분석합니다.
    감성 변화 추이, 볼륨 트렌드, 주요 키워드를 추출합니다.
    
    Args:
        request: 트렌드 분석 요청 데이터 (기간, 대상, 날짜 범위)
        db: 데이터베이스 세션
    
    Returns:
        TrendAnalysisResponse: 트렌드 분석 결과
    """
    # 트렌드 분석 서비스 인스턴스 생성
    service = TrendService(db)
    # 트렌드 분석 수행
    result = await service.analyze_trends(
        period=request.period,  # 분석 기간 (daily/weekly/monthly)
        entity=request.entity,  # 분석 대상
        start_date=request.start_date,  # 시작 날짜
        end_date=request.end_date  # 종료 날짜
    )
    return result


@router.get("/entity/{entity}")
async def get_entity_trends(
    entity: str,
    period: str = "weekly",
    limit: Optional[int] = 30,
    db: Session = Depends(get_db)
):
    """
    특정 엔티티의 트렌드 조회
    
    특정 대상(연금펌드, 주제 등)에 대한 트렌드 데이터를 조회합니다.
    
    Args:
        entity: 대상 엔티티 이름
        period: 분석 기간 (기본: weekly)
        limit: 조회할 최대 개수 (기본: 30)
        db: 데이터베이스 세션
    
    Returns:
        List: 트렌드 데이터 목록
    """
    # 트렌드 분석 서비스 인스턴스 생성
    service = TrendService(db)
    # 엔티티별 트렌드 조회
    trends = await service.get_entity_trends(entity, period, limit)
    return trends


@router.get("/popular")
async def get_popular_trends(
    period: str = "daily",
    limit: Optional[int] = 10,
    db: Session = Depends(get_db)
):
    """
    인기 트렌드 조회
    
    현재 가장 인기 있는 트렌드를 조회합니다.
    볼륨과 감성 변화를 기준으로 정렬됩니다.
    
    Args:
        period: 분석 기간 (기본: daily)
        limit: 조회할 최대 개수 (기본: 10)
        db: 데이터베이스 세션
    
    Returns:
        List: 인기 트렌드 목록
    """
    # 트렌드 분석 서비스 인스턴스 생성
    service = TrendService(db)
    # 인기 트렌드 조회
    trends = await service.get_popular_trends(period, limit)
    return trends


@router.get("/keywords")
async def get_trending_keywords(
    period: str = "daily",
    limit: Optional[int] = 20,
    db: Session = Depends(get_db)
):
    """
    트렌딩 키워드 조회
    
    현재 트렌딩중인 주요 키워드를 추출합니다.
    빈도수와 중요도를 기준으로 순위가 매겨집니다.
    
    Args:
        period: 분석 기간 (기본: daily)
        limit: 조회할 최대 개수 (기본: 20)
        db: 데이터베이스 세션
    
    Returns:
        List: 트렌딩 키워드 목록
    """
    # 트렌드 분석 서비스 인스턴스 생성
    service = TrendService(db)
    # 트렌딩 키워드 조회
    keywords = await service.get_trending_keywords(period, limit)
    return keywords