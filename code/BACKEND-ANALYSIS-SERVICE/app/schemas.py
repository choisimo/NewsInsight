"""
스키마 정의 모듈

Pydantic을 사용한 API 요청/응답 스키마 정의입니다.
자동 검증, 직렬화, API 문서 생성을 지원합니다.
"""

from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field


# =============================================================================
# 감성 분석 관련 스키마
# =============================================================================

class SentimentAnalysisRequest(BaseModel):
    """
    감성 분석 요청 스키마
    
    분석할 텍스트와 컨텐츠 ID를 포함합니다.
    """
    text: str = Field(..., description="분석할 텍스트")  # 필수: 분석 대상 텍스트
    content_id: Optional[str] = Field(None, description="컨텐츠 고유 식별자")  # 선택: 컨텐츠 ID


class SentimentAnalysisResponse(BaseModel):
    """
    감성 분석 응답 스키마
    
    분석 결과를 포함한 응답 데이터입니다.
    """
    content_id: str  # 컨텐츠 ID
    sentiment_score: float = Field(..., ge=-1.0, le=1.0, description="감성 점수 (-1: 부정, 0: 중립, 1: 긍정)")
    sentiment_label: str = Field(..., description="감성 레이블: positive, negative, neutral")
    confidence: float = Field(..., ge=0.0, le=1.0, description="신뢰도 점수 (0~1)")
    model_version: str  # 사용된 모델 버전
    analysis_id: int  # 분석 결과 ID


class BatchSentimentRequest(BaseModel):
    """
    배치 감성 분석 요청 스키마
    
    여러 텍스트를 동시에 분석할 때 사용합니다.
    """
    texts: List[SentimentAnalysisRequest]  # 분석할 텍스트 목록


class BatchSentimentResponse(BaseModel):
    """
    배치 감성 분석 응답 스키마
    
    배치 처리 결과와 통계 정보를 포함합니다.
    """
    results: List[SentimentAnalysisResponse]  # 각 텍스트의 분석 결과
    total_processed: int  # 처리된 총 개수
    success_count: int  # 성공한 개수
    error_count: int  # 실패한 개수


# =============================================================================
# 트렌드 분석 관련 스키마
# =============================================================================

class TrendAnalysisRequest(BaseModel):
    """
    트렌드 분석 요청 스키마
    
    분석 기간과 대상을 지정하여 트렌드를 분석합니다.
    """
    period: str = Field(..., description="분석 기간: daily, weekly, monthly")  # 필수: 분석 주기
    entity: Optional[str] = Field(None, description="분석 대상 엔티티")  # 선택: 특정 대상
    start_date: Optional[datetime] = None  # 선택: 시작 날짜
    end_date: Optional[datetime] = None  # 선택: 종료 날짜


class TrendItem(BaseModel):
    """
    개별 트렌드 데이터 포인트
    
    특정 시점의 트렌드 데이터를 나타냅니다.
    """
    date: datetime  # 날짜
    sentiment_score: float  # 감성 점수
    volume: int  # 데이터 볼륨 (언급 횟수)
    keywords: List[str]  # 주요 키워드 목록


class TrendAnalysisResponse(BaseModel):
    """
    트렌드 분석 응답 스키마
    
    트렌드 분석 결과와 시계열 데이터를 포함합니다.
    """
    period: str  # 분석 기간
    entity: str  # 분석 대상
    trend_direction: str  # 트렌드 방향 (increasing: 상승, decreasing: 하강, stable: 안정)
    trend_strength: float  # 트렌드 강도 (0~1)
    data_points: List[TrendItem]  # 시계열 데이터 포인트
    summary: str  # 트렌드 요약


# =============================================================================
# 리포트 생성 관련 스키마
# =============================================================================

class ReportRequest(BaseModel):
    """
    리포트 생성 요청 스키마
    
    리포트 타입과 파라미터를 지정하여 자동 리포트를 생성합니다.
    """
    report_type: str = Field(..., description="리포트 타입: sentiment, trend, summary")  # 필수: 리포트 종류
    title: str  # 리포트 제목
    parameters: Dict[str, Any] = Field(default_factory=dict)  # 리포트 생성 파라미터
    start_date: Optional[datetime] = None  # 선택: 분석 시작 날짜
    end_date: Optional[datetime] = None  # 선택: 분석 종료 날짜


class ReportResponse(BaseModel):
    """
    리포트 생성 응답 스키마
    
    생성된 리포트의 정보와 내용을 포함합니다.
    """
    report_id: int  # 리포트 ID
    title: str  # 리포트 제목
    report_type: str  # 리포트 타입
    content: Dict[str, Any]  # 리포트 내용 (JSON 형식)
    created_at: datetime  # 생성 시간
    download_url: Optional[str] = None  # 선택: 다운로드 URL


# =============================================================================
# ML 모델 관리 관련 스키마
# =============================================================================

class MLModelRequest(BaseModel):
    """
    ML 모델 등록 요청 스키마
    
    새로운 ML 모델을 등록할 때 사용합니다.
    """
    name: str  # 모델 이름
    model_type: str = Field(..., description="모델 타입: sentiment, classification")  # 필수: 모델 종류
    file_path: str  # 모델 파일 경로
    metrics: Dict[str, Any] = Field(default_factory=dict)  # 성능 지표


class MLModelResponse(BaseModel):
    """
    ML 모델 정보 응답 스키마
    
    등록된 모델의 상세 정보를 포함합니다.
    """
    model_id: int  # 모델 ID
    name: str  # 모델 이름
    version: str  # 모델 버전
    model_type: str  # 모델 타입
    is_active: bool  # 활성 상태
    metrics: Dict[str, Any]  # 성능 지표
    created_at: datetime  # 생성 시간


class ModelTrainingRequest(BaseModel):
    """
    모델 학습 요청 스키마
    
    새로운 모델을 학습시킬 때 사용합니다.
    """
    model_name: str  # 모델 이름
    training_data_path: str  # 학습 데이터 경로
    hyperparameters: Dict[str, Any] = Field(default_factory=dict)  # 하이퍼파라미터
    validation_split: float = Field(0.2, ge=0.1, le=0.5)  # 검증 데이터 비율 (10%~50%)


class ModelTrainingResponse(BaseModel):
    """
    모델 학습 응답 스키마
    
    학습 작업의 상태 정보를 포함합니다.
    """
    job_id: str  # 학습 작업 ID
    status: str  # 상태 (pending, running, completed, failed)
    estimated_completion: Optional[datetime] = None  # 예상 완료 시간

# =============================================================================
# 기타 공통 스키마
# =============================================================================

class HealthResponse(BaseModel):
    """
    헬스 체크 응답 스키마
    
    서비스 상태 정보를 포함합니다.
    """
    status: str  # 서비스 상태 (healthy/unhealthy)
    service: str  # 서비스 이름
    timestamp: datetime  # 체크 시간
    database_connected: bool  # 데이터베이스 연결 상태
    models_loaded: int  # 로드된 모델 개수