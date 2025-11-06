from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
import json
from collections import defaultdict, Counter
from app.db import TrendAnalysis, SentimentAnalysis
from app.schemas import TrendAnalysisResponse, TrendItem
import re

# Korean NLP for keyword extraction
try:
    from konlpy.tag import Okt
    KONLPY_AVAILABLE = True
except ImportError:
    KONLPY_AVAILABLE = False


class TrendService:
    """
    감성/볼륨 시계열을 바탕으로 트렌드를 계산하고 키워드를 추출하는 서비스.
    """

    def __init__(self, db: Session):
        """
        서비스 인스턴스 초기화.

        Args:
            db: SQLAlchemy 세션
        """
        self.db = db
        # Initialize Korean NLP tokenizer
        self.okt = Okt() if KONLPY_AVAILABLE else None
        # Korean stopwords
        self.stopwords = {
            '이', '그', '저', '것', '수', '등', '및', '중', '때', '년', '월', '일',
            '되', '하', '있', '않', '없', '한', '를', '을', '가', '이', '은', '는',
            '에', '의', '로', '으로', '와', '과', '도', '만', '에서', '까지'
        }
    
    async def analyze_trends(self, period: str, entity: Optional[str] = None, 
                           start_date: Optional[datetime] = None, 
                           end_date: Optional[datetime] = None) -> TrendAnalysisResponse:
        """
        지정 기간/대상에 대한 트렌드를 분석합니다.

        Args:
            period: 'daily'/'weekly'/'monthly' 등 기간 구분
            entity: 특정 엔티티(키워드) 필터
            start_date: 시작 시각(미지정 시 최근 30일)
            end_date: 종료 시각(미지정 시 현재)

        Returns:
            TrendAnalysisResponse: 방향/강도/시계열 포인트/요약 포함
        """
        if not start_date:
            start_date = datetime.now() - timedelta(days=30)
        if not end_date:
            end_date = datetime.now()
        
        query = self.db.query(SentimentAnalysis).filter(
            SentimentAnalysis.created_at >= start_date,
            SentimentAnalysis.created_at <= end_date
        )
        
        if entity:
            query = query.filter(SentimentAnalysis.text.contains(entity))
        
        analyses = query.all()
        
        trend_data = self._calculate_trend(analyses, period)
        
        return TrendAnalysisResponse(
            period=period,
            entity=entity or "all",
            trend_direction=trend_data["direction"],
            trend_strength=trend_data["strength"],
            data_points=trend_data["data_points"],
            summary=trend_data["summary"]
        )
    
    async def get_entity_trends(self, entity: str, period: str = "weekly", limit: int = 30) -> List[Dict[str, Any]]:
        """
        특정 엔티티의 저장된 트렌드 레코드를 조회합니다.

        Args:
            entity: 대상 엔티티 명칭
            period: 집계 기간
            limit: 최대 반환 개수(최신순)

        Returns:
            트렌드 레코드 사전 리스트
        """
        trends = self.db.query(TrendAnalysis).filter(
            TrendAnalysis.entity == entity,
            TrendAnalysis.period == period
        ).order_by(TrendAnalysis.analysis_date.desc()).limit(limit).all()
        
        return [
            {
                "date": trend.analysis_date,
                "sentiment_trend": trend.sentiment_trend,
                "volume_trend": trend.volume_trend,
                "keywords": json.loads(trend.keywords) if trend.keywords else [],
                "confidence": trend.confidence
            }
            for trend in trends
        ]
    
    async def get_popular_trends(self, period: str = "daily", limit: int = 10) -> List[Dict[str, Any]]:
        """
        볼륨 기준 상위 트렌드를 조회합니다.

        Args:
            period: 집계 기간
            limit: 최대 반환 개수

        Returns:
            인기 트렌드 사전 리스트
        """
        trends = self.db.query(TrendAnalysis).filter(
            TrendAnalysis.period == period
        ).order_by(TrendAnalysis.volume_trend.desc()).limit(limit).all()
        
        return [
            {
                "entity": trend.entity,
                "sentiment_trend": trend.sentiment_trend,
                "volume_trend": trend.volume_trend,
                "keywords": json.loads(trend.keywords) if trend.keywords else []
            }
            for trend in trends
        ]
    
    async def get_trending_keywords(self, period: str = "daily", limit: int = 20) -> List[Dict[str, Any]]:
        """
        최근 7일 데이터 기준 트렌딩 키워드를 도출합니다.

        Args:
            period: 집계 기간
            limit: 최대 키워드 수

        Returns:
            {keyword, score} 항목 리스트
        """
        trends = self.db.query(TrendAnalysis).filter(
            TrendAnalysis.period == period,
            TrendAnalysis.analysis_date >= datetime.now() - timedelta(days=7)
        ).all()
        
        keyword_counts = defaultdict(int)
        for trend in trends:
            if trend.keywords:
                keywords = json.loads(trend.keywords)
                for keyword in keywords:
                    keyword_counts[keyword] += trend.volume_trend
        
        sorted_keywords = sorted(keyword_counts.items(), key=lambda x: x[1], reverse=True)[:limit]
        
        return [
            {"keyword": keyword, "score": score}
            for keyword, score in sorted_keywords
        ]
    
    def _calculate_trend(self, analyses: List, period: str) -> Dict[str, Any]:
        """
        감성 점수의 시계열 변화를 계산하여 방향/강도를 추정합니다.

        Args:
            analyses: SentimentAnalysis 레코드 목록
            period: 집계 기간 식별자(표기용)

        Returns:
            direction/strength/data_points/summary를 포함한 사전
        """
        if not analyses:
            return {
                "direction": "stable",
                "strength": 0.0,
                "data_points": [],
                "summary": "No data available"
            }
        
        grouped_data = defaultdict(list)
        for analysis in analyses:
            date_key = analysis.created_at.strftime("%Y-%m-%d")
            grouped_data[date_key].append(analysis)
        
        data_points = []
        sentiment_scores = []
        
        for date_key, day_analyses in grouped_data.items():
            avg_sentiment = sum(a.sentiment_score for a in day_analyses) / len(day_analyses)
            volume = len(day_analyses)
            
            sentiment_scores.append(avg_sentiment)
            data_points.append(TrendItem(
                date=datetime.strptime(date_key, "%Y-%m-%d"),
                sentiment_score=avg_sentiment,
                volume=volume,
                keywords=self._extract_keywords(day_analyses)
            ))
        
        if len(sentiment_scores) < 2:
            direction = "stable"
            strength = 0.0
        else:
            trend_change = sentiment_scores[-1] - sentiment_scores[0]
            if trend_change > 0.1:
                direction = "increasing"
            elif trend_change < -0.1:
                direction = "decreasing"
            else:
                direction = "stable"
            
            strength = abs(trend_change)
        
        avg_sentiment = sum(sentiment_scores) / len(sentiment_scores)
        summary = f"Average sentiment: {avg_sentiment:.2f}, Trend: {direction}"
        
        return {
            "direction": direction,
            "strength": strength,
            "data_points": data_points,
            "summary": summary
        }
    
    def _extract_keywords(self, analyses: List, limit: int = 5) -> List[str]:
        """
        한국어 키워드 추출 (KoNLPy 형태소 분석 사용)
        """
        all_text = " ".join([a.text for a in analyses])
        
        if KONLPY_AVAILABLE and self.okt:
            # 형태소 분석으로 명사 추출
            nouns = self.okt.nouns(all_text)
            # 불용어 제거 및 2글자 이상 필터링
            filtered_nouns = [
                noun for noun in nouns 
                if noun not in self.stopwords and len(noun) >= 2
            ]
            # 빈도수 계산
            noun_counts = Counter(filtered_nouns)
            return [noun for noun, count in noun_counts.most_common(limit)]
        else:
            # Fallback: 간단한 공백 기반 분리
            words = re.findall(r'[가-힣]{2,}', all_text)
            filtered_words = [w for w in words if w not in self.stopwords]
            word_counts = Counter(filtered_words)
            return [word for word, count in word_counts.most_common(limit)]