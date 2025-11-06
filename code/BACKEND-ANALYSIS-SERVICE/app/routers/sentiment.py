"""
감성 분석 API 라우터

텍스트의 감성(긍정/부정/중립)을 분석하는 API 엔드포인트입니다.
개별 분석, 배치 처리, 히스토리 조회, 통계 제공 기능을 포함합니다.
"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List, Optional
from app.db import get_db
from app.schemas import (
    SentimentAnalysisRequest, 
    SentimentAnalysisResponse, 
    BatchSentimentRequest, 
    BatchSentimentResponse
)
from app.services.sentiment_service import SentimentService

# API 라우터 인스턴스 생성
router = APIRouter()


@router.post("/analyze", response_model=SentimentAnalysisResponse)
async def analyze_sentiment(
    request: SentimentAnalysisRequest,
    db: Session = Depends(get_db)
):
    """
    단일 텍스트 감성 분석
    
    입력된 텍스트의 감성을 분석하여 긍정/부정/중립으로 분류합니다.
    감성 점수(-1~1)와 신뢰도를 함께 반환합니다.
    
    Args:
        request: 분석 요청 데이터 (텍스트, 컨텐츠 ID)
        db: 데이터베이스 세션
    
    Returns:
        SentimentAnalysisResponse: 분석 결과
    """
    # 감성 분석 서비스 인스턴스 생성
    service = SentimentService(db)
    # 텍스트 분석 수행 및 결과 반환
    result = await service.analyze_sentiment(request.text, request.content_id)
    return result


@router.post("/batch", response_model=BatchSentimentResponse)
async def batch_analyze_sentiment(
    request: BatchSentimentRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    배치 감성 분석
    
    여러 텍스트를 동시에 분석합니다.
    대량의 텍스트 처리시 효율적이며, 백그라운드 작업으로 수행됩니다.
    
    Args:
        request: 배치 분석 요청 데이터 (텍스트 목록)
        background_tasks: FastAPI 백그라운드 작업 큐
        db: 데이터베이스 세션
    
    Returns:
        BatchSentimentResponse: 배치 처리 결과 및 통계
    """
    # 감성 분석 서비스 인스턴스 생성
    service = SentimentService(db)
    # 배치 분석 수행 및 결과 반환
    result = await service.batch_analyze_sentiment(request.texts, background_tasks)
    return result


@router.get("/history/{content_id}")
async def get_sentiment_history(
    content_id: str,
    limit: Optional[int] = 10,
    db: Session = Depends(get_db)
):
    """
    감성 분석 히스토리 조회
    
    특정 컨텐츠에 대한 과거 감성 분석 기록을 조회합니다.
    시간 순으로 정렬되어 반환됩니다.
    
    Args:
        content_id: 컨텐츠 ID
        limit: 조회할 최대 개수 (기본: 10)
        db: 데이터베이스 세션
    
    Returns:
        List: 감성 분석 히스토리 목록
    """
    # 감성 분석 서비스 인스턴스 생성
    service = SentimentService(db)
    # 히스토리 조회 및 반환
    history = await service.get_sentiment_history(content_id, limit)
    return history


@router.get("/stats")
async def get_sentiment_stats(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    감성 분석 통계 조회
    
    지정된 기간 동안의 감성 분석 통계를 제공합니다.
    전체 긍정/부정/중립 비율, 평균 신뢰도 등의 정보를 포함합니다.
    
    Args:
        start_date: 시작 날짜 (YYYY-MM-DD 형식)
        end_date: 종료 날짜 (YYYY-MM-DD 형식)
        db: 데이터베이스 세션
    
    Returns:
        Dict: 감성 분석 통계 데이터
    """
    # 감성 분석 서비스 인스턴스 생성
    service = SentimentService(db)
    # 통계 조회 및 반환
    stats = await service.get_sentiment_statistics(start_date, end_date)
    return stats