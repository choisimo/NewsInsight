"""
데이터베이스 모듈

SQLAlchemy ORM을 사용한 데이터베이스 레이어입니다.
데이터베이스 연결, 세션 관리, 그리고 ORM 모델을 정의합니다.
"""

from sqlalchemy import create_engine, Column, Integer, String, DateTime, Float, Text, Boolean, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
from sqlalchemy.sql import func
from app.config import settings

# 데이터베이스 엔진 생성
# settings.DATABASE_URL에 설정된 PostgreSQL 연결 문자열 사용
engine = create_engine(settings.DATABASE_URL)

# 세션 팩토리 생성
# autocommit=False: 명시적으로 commit 호출 필요
# autoflush=False: 자동 flush 비활성화로 성능 향상
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# SQLAlchemy Base 클래스 - 모든 모델의 부모 클래스
Base = declarative_base()


def get_db() -> Session:
    """
    데이터베이스 세션 의존성 주입 함수
    
    FastAPI의 Depends와 함께 사용하여 요청마다 새로운 세션을 생성하고,
    요청 처리 후 자동으로 세션을 닫습니다.
    
    Yields:
        Session: 데이터베이스 세션 인스턴스
    """
    db = SessionLocal()  # 새 세션 생성
    try:
        yield db  # 세션 반환
    finally:
        db.close()  # 요청 종료 시 세션 닫기


class SentimentAnalysis(Base):
    """
    감성 분석 결과 테이블
    
    텍스트에 대한 감성 분석 결과를 저장합니다.
    각 분석은 감성 점수, 레이블, 신뢰도를 포함합니다.
    """
    __tablename__ = "sentiment_analyses"  # 테이블명
    
    id = Column(Integer, primary_key=True, index=True)  # 기본 키
    content_id = Column(String, index=True, nullable=False)  # 컨텐츠 ID (외부 참조)
    text = Column(Text, nullable=False)  # 분석대상 텍스트
    sentiment_score = Column(Float, nullable=False)  # 감성 점수 (-1.0 ~ 1.0)
    sentiment_label = Column(String, nullable=False)  # 감성 레이블 (positive/negative/neutral)
    confidence = Column(Float, nullable=False)  # 분석 신뢰도 (0.0 ~ 1.0)
    model_version = Column(String, nullable=False)  # 사용된 모델 버전
    created_at = Column(DateTime(timezone=True), server_default=func.now())  # 생성 시간
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())  # 수정 시간


class TrendAnalysis(Base):
    """
    트렌드 분석 결과 테이블
    
    시간에 따른 감성 및 볼륨 트렌드를 추적합니다.
    일별, 주별, 월별 트렌드를 저장할 수 있습니다.
    """
    __tablename__ = "trend_analyses"  # 테이블명
    
    id = Column(Integer, primary_key=True, index=True)  # 기본 키
    period = Column(String, nullable=False)  # 분석 기간 (daily, weekly, monthly)
    entity = Column(String, nullable=False)  # 분석 대상 (연금펌드, 주제 등)
    sentiment_trend = Column(Float, nullable=False)  # 감성 트렌드 값
    volume_trend = Column(Integer, nullable=False)  # 볼륨 트렌드 (언급 횟수)
    keywords = Column(Text)  # 주요 키워드 (JSON 문자열)
    confidence = Column(Float, nullable=False)  # 분석 신뢰도
    analysis_date = Column(DateTime(timezone=True), server_default=func.now())  # 분석 일시


class Report(Base):
    """
    분석 리포트 테이블
    
    자동 생성된 분석 리포트를 저장합니다.
    감성, 트렌드, 요약 등 다양한 타입의 리포트를 지원합니다.
    """
    __tablename__ = "reports"  # 테이블명
    
    id = Column(Integer, primary_key=True, index=True)  # 기본 키
    title = Column(String, nullable=False)  # 리포트 제목
    report_type = Column(String, nullable=False)  # 리포트 타입 (sentiment, trend, summary)
    content = Column(Text, nullable=False)  # 리포트 내용 (JSON 형식)
    parameters = Column(Text)  # 리포트 생성 파라미터 (JSON 형식)
    created_by = Column(String)  # 생성자 (사용자 ID 또는 시스템)
    created_at = Column(DateTime(timezone=True), server_default=func.now())  # 생성 시간
    is_active = Column(Boolean, default=True)  # 활성 상태 (삭제 대신 비활성화)


class MLModel(Base):
    """
    ML 모델 메타데이터 테이블
    
    학습된 ML 모델의 정보와 성능 지표를 관리합니다.
    모델 버전 관리 및 A/B 테스트를 지원합니다.
    """
    __tablename__ = "ml_models"  # 테이블명
    
    id = Column(Integer, primary_key=True, index=True)  # 기본 키
    name = Column(String, unique=True, nullable=False)  # 모델 이름 (고유값)
    version = Column(String, nullable=False)  # 모델 버전 (1.0.0 형식)
    model_type = Column(String, nullable=False)  # 모델 타입 (sentiment, classification 등)
    file_path = Column(String, nullable=False)  # 모델 파일 경로
    metrics = Column(Text)  # 성능 지표 (JSON 형식 - accuracy, f1-score 등)
    is_active = Column(Boolean, default=False)  # 활성 상태 (현재 사용 중인 모델 표시)
    created_at = Column(DateTime(timezone=True), server_default=func.now())  # 생성 시간
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())  # 수정 시간