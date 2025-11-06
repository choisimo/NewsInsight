"""
감성 분석 서비스 모듈

텍스트 감성 분석의 핵심 비즈니스 로직을 구현합니다.
Transformers 라이브러리를 사용하여 사전 학습된 모델로 분석을 수행합니다.
"""

from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
import uuid
from transformers import pipeline
import asyncio
from app.db import SentimentAnalysis
from app.schemas import SentimentAnalysisRequest, SentimentAnalysisResponse


class SentimentService:
    """
    감성 분석 서비스 클래스
    
    텍스트의 감성을 분석하고 결과를 데이터베이스에 저장합니다.
    개별 분석, 배치 처리, 통계 조회 등의 기능을 제공합니다.
    """
    
    def __init__(self, db: Session):
        """
        서비스 초기화
        
        Args:
            db: 데이터베이스 세션
        """
        self.db = db  # 데이터베이스 세션 저장
        # Hugging Face의 RoBERTa 기반 감성 분석 모델 로드
        # Twitter 데이터로 학습된 모델로 SNS 텍스트에 효과적
        self.sentiment_analyzer = pipeline("sentiment-analysis", 
                                          model="cardiffnlp/twitter-roberta-base-sentiment-latest")
    
    async def analyze_sentiment(self, text: str, content_id: Optional[str] = None) -> SentimentAnalysisResponse:
        """
        단일 텍스트 감성 분석
        
        주어진 텍스트의 감성을 분석하고 데이터베이스에 저장합니다.
        
        Args:
            text: 분석할 텍스트
            content_id: 컨텐츠 ID (없으면 자동 생성)
            
        Returns:
            SentimentAnalysisResponse: 분석 결과
        """
        # 컨텐츠 ID가 없으면 UUID로 생성
        if not content_id:
            content_id = str(uuid.uuid4())
        
        # ML 모델을 사용하여 감성 분석 수행
        result = self.sentiment_analyzer(text)[0]
        
        # 모델 출력을 표준 형식으로 변환
        sentiment_score = self._convert_to_numeric_score(result['label'], result['score'])
        sentiment_label = self._normalize_label(result['label'])
        
        # 데이터베이스에 분석 결과 저장
        analysis = SentimentAnalysis(
            content_id=content_id,
            text=text,
            sentiment_score=sentiment_score,
            sentiment_label=sentiment_label,
            confidence=result['score'],
            model_version="twitter-roberta-base-sentiment-latest-v1"
        )
        
        # 데이터베이스 트랜잭션 커밋
        self.db.add(analysis)
        self.db.commit()
        self.db.refresh(analysis)  # ID 할당을 위해 새로고침
        
        # 응답 객체 생성 및 반환
        return SentimentAnalysisResponse(
            content_id=content_id,
            sentiment_score=sentiment_score,
            sentiment_label=sentiment_label,
            confidence=result['score'],
            model_version="twitter-roberta-base-sentiment-latest-v1",
            analysis_id=analysis.id
        )
    
    async def batch_analyze_sentiment(self, requests: List[SentimentAnalysisRequest], background_tasks) -> Dict[str, Any]:
        """
        배치 감성 분석
        
        여러 텍스트를 동시에 분석하고 결과를 반환합니다.
        
        Args:
            requests: 분석 요청 목록
            background_tasks: 백그라운드 작업 큐 (현재 미사용)
            
        Returns:
            Dict: 배치 처리 결과 및 통계
        """
        results = []  # 분석 결과 저장 리스트
        success_count = 0  # 성공 카운트
        error_count = 0  # 실패 카운트
        
        # 각 요청에 대해 감성 분석 수행
        for request in requests:
            try:
                # 개별 텍스트 분석
                result = await self.analyze_sentiment(request.text, request.content_id)
                results.append(result)
                success_count += 1
            except Exception as e:
                # 오류 발생시 처리
                error_count += 1
                print(f"Error processing sentiment analysis: {e}")
        
        # 배치 처리 결과 반환
        return {
            "results": results,  # 분석 결과 리스트
            "total_processed": len(requests),  # 처리된 총 개수
            "success_count": success_count,  # 성공 개수
            "error_count": error_count  # 실패 개수
        }
    
    async def get_sentiment_history(self, content_id: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        감성 분석 히스토리 조회
        
        특정 컨텐츠의 과거 감성 분석 기록을 조회합니다.
        
        Args:
            content_id: 컨텐츠 ID
            limit: 조회할 최대 개수
            
        Returns:
            List[Dict]: 감성 분석 히스토리
        """
        # 데이터베이스에서 해당 컨텐츠의 분석 기록 조회
        analyses = self.db.query(SentimentAnalysis).filter(
            SentimentAnalysis.content_id == content_id
        ).order_by(SentimentAnalysis.created_at.desc()).limit(limit).all()  # 최신 순으로 정렬
        
        # 결과를 딕셔너리 리스트로 변환
        return [
            {
                "id": analysis.id,
                "sentiment_score": analysis.sentiment_score,
                "sentiment_label": analysis.sentiment_label,
                "confidence": analysis.confidence,
                "created_at": analysis.created_at
            }
            for analysis in analyses
        ]
    
    async def get_sentiment_statistics(self, start_date: Optional[str] = None, end_date: Optional[str] = None) -> Dict[str, Any]:
        """
        감성 분석 통계 조회
        
        지정된 기간의 감성 분석 통계를 계산합니다.
        
        Args:
            start_date: 시작 날짜 (ISO 형식)
            end_date: 종료 날짜 (ISO 형식)
            
        Returns:
            Dict: 통계 정보 (total, average_sentiment, distribution)
        """
        # 기본 쿼리 생성
        query = self.db.query(SentimentAnalysis)
        
        # 날짜 필터 적용
        if start_date:
            query = query.filter(SentimentAnalysis.created_at >= datetime.fromisoformat(start_date))
        if end_date:
            query = query.filter(SentimentAnalysis.created_at <= datetime.fromisoformat(end_date))
        
        # 모든 분석 결과 조회
        analyses = query.all()
        
        # 데이터가 없으면 빈 통계 반환
        if not analyses:
            return {"total": 0, "average_sentiment": 0, "distribution": {}}
        
        # 통계 계산
        total = len(analyses)
        avg_sentiment = sum(a.sentiment_score for a in analyses) / total
        
        # 감성 분포 계산
        distribution = {}
        for analysis in analyses:
            label = analysis.sentiment_label
            distribution[label] = distribution.get(label, 0) + 1
        
        # 통계 결과 반환
        return {
            "total": total,  # 총 분석 개수
            "average_sentiment": avg_sentiment,  # 평균 감성 점수
            "distribution": distribution,  # 감성 분포 (positive/negative/neutral)
            "period": {"start": start_date, "end": end_date}  # 조회 기간
        }
    
    def _convert_to_numeric_score(self, label: str, confidence: float) -> float:
        """
        감성 레이블을 숫자 점수로 변환
        
        Args:
            label: 감성 레이블 (POSITIVE/NEGATIVE/NEUTRAL)
            confidence: 신뢰도 (0~1)
            
        Returns:
            float: 감성 점수 (-1~1)
        """
        if "POSITIVE" in label.upper():
            return confidence  # 긍정: 신뢰도를 그대로 사용
        elif "NEGATIVE" in label.upper():
            return -confidence  # 부정: 신뢰도를 음수로 변환
        else:
            return 0.0  # 중립: 0으로 설정
    
    def _normalize_label(self, label: str) -> str:
        """
        감성 레이블 정규화
        
        모델의 출력 레이블을 표준 형식으로 변환합니다.
        
        Args:
            label: 모델 출력 레이블
            
        Returns:
            str: 표준화된 레이블 (positive/negative/neutral)
        """
        if "POSITIVE" in label.upper():
            return "positive"
        elif "NEGATIVE" in label.upper():
            return "negative"
        else:
            return "neutral"