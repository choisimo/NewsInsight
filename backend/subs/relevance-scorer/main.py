"""
Relevance Scoring Service - BERT 기반 콘텐츠 관련성 분류 서비스

기능:
1. 뉴스/문서 관련성 점수 계산 (0.0-1.0)
2. 키워드 기반 관련성 판단
3. 불확실성 계산 (Active Learning용)
4. 배치 처리 지원
"""

import os
import sys
import time
import hashlib
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
from contextlib import asynccontextmanager

import structlog
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings
from fastapi import FastAPI, HTTPException
from cachetools import TTLCache

# Add shared module to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
try:
    from shared.prometheus_metrics import (
        setup_metrics,
        ServiceMetrics,
    )

    METRICS_AVAILABLE = True
except ImportError:
    METRICS_AVAILABLE = False

log = structlog.get_logger()

# ============================================
# Configuration
# ============================================


class Settings(BaseSettings):
    """Application settings"""

    # Model configuration
    model_name: str = Field(
        default="sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    )
    # Alternative models:
    # - "klue/bert-base" (Korean BERT)
    # - "sentence-transformers/all-MiniLM-L6-v2" (Fast, English)
    # - "jhgan/ko-sroberta-multitask" (Korean sentence transformer)

    # Scoring thresholds
    relevance_threshold: float = Field(default=0.5)
    uncertainty_threshold: float = Field(default=0.4)

    # Cache settings
    cache_ttl: int = Field(default=300)
    cache_max_size: int = Field(default=10000)

    # Performance
    max_text_length: int = Field(default=512)
    batch_size: int = Field(default=32)

    class Config:
        env_prefix = "RELEVANCE_SCORER_"


settings = Settings()

# ============================================
# Request/Response Models
# ============================================


class RelevancePredictionRequest(BaseModel):
    """단일 관련성 예측 요청"""

    id: str = Field(..., description="Content unique identifier")
    title: str = Field(..., description="Content title")
    content: str = Field(default="", description="Content body text")
    keywords: List[str] = Field(default=[], description="Target keywords for relevance")


class RelevancePredictionResponse(BaseModel):
    """관련성 예측 결과"""

    content_id: str
    score: float = Field(..., ge=0.0, le=1.0, description="Relevance score (0.0-1.0)")
    uncertainty: float = Field(
        ..., ge=0.0, le=1.0, description="Model uncertainty (0.0-1.0)"
    )
    is_relevant: bool = Field(..., description="Whether content is relevant")
    model_version: str = Field(..., description="Model version used")
    keyword_matches: Dict[str, bool] = Field(
        default={}, description="Keyword match results"
    )


class BatchPredictionRequest(BaseModel):
    """배치 관련성 예측 요청"""

    items: List[RelevancePredictionRequest]


class BatchPredictionResponse(BaseModel):
    """배치 관련성 예측 결과"""

    predictions: List[RelevancePredictionResponse]
    model_version: str
    processing_time_ms: int
    total_count: int
    relevant_count: int


class ModelStatus(BaseModel):
    """모델 상태"""

    loaded: bool
    model_name: str
    device: str
    cache_size: int
    cache_hit_rate: float


# ============================================
# Relevance Scoring Service
# ============================================


class RelevanceScoringService:
    """BERT 기반 관련성 점수 계산 서비스"""

    MODEL_VERSION = "1.0.0"

    def __init__(self):
        self._model = None
        self._tokenizer = None
        self._model_loaded = False
        self._device = "cpu"
        self._cache = TTLCache(maxsize=settings.cache_max_size, ttl=settings.cache_ttl)
        self._cache_hits = 0
        self._cache_misses = 0

    def _load_model(self):
        """모델 lazy loading"""
        if self._model_loaded:
            return

        try:
            from sentence_transformers import SentenceTransformer
            import torch

            log.info("Loading relevance scoring model", model=settings.model_name)

            # GPU 사용 가능하면 사용
            self._device = "cuda" if torch.cuda.is_available() else "cpu"

            self._model = SentenceTransformer(settings.model_name, device=self._device)
            self._model_loaded = True

            log.info("Relevance scoring model loaded successfully", device=self._device)

        except Exception as e:
            log.error("Failed to load relevance scoring model", error=str(e))
            self._model_loaded = False

    def _compute_cache_key(self, title: str, content: str, keywords: List[str]) -> str:
        """캐시 키 생성"""
        key_str = f"{title}|{content[:200]}|{','.join(sorted(keywords))}"
        return hashlib.sha256(key_str.encode()).hexdigest()[:16]

    def _calculate_keyword_relevance(
        self, text: str, keywords: List[str]
    ) -> tuple[float, Dict[str, bool]]:
        """키워드 기반 관련성 점수 계산"""
        if not keywords:
            return 0.5, {}  # 키워드 없으면 중립 점수

        text_lower = text.lower()
        matches = {}
        match_count = 0

        for keyword in keywords:
            keyword_lower = keyword.lower()
            is_match = keyword_lower in text_lower
            matches[keyword] = is_match
            if is_match:
                match_count += 1

        # 키워드 매칭 비율을 점수로 변환
        keyword_score = match_count / len(keywords)
        return keyword_score, matches

    def _calculate_semantic_similarity(
        self, title: str, content: str, keywords: List[str]
    ) -> float:
        """의미론적 유사도 계산 (Sentence Transformer 사용)"""
        if not self._model_loaded or not keywords:
            return 0.5

        try:
            import numpy as np

            # 문서 텍스트 준비
            doc_text = f"{title}. {content[: settings.max_text_length]}"

            # 키워드 쿼리 텍스트
            keyword_text = " ".join(keywords)

            # 임베딩 생성
            embeddings = self._model.encode(
                [doc_text, keyword_text], convert_to_numpy=True
            )

            # 코사인 유사도 계산
            doc_emb = embeddings[0]
            kw_emb = embeddings[1]

            similarity = np.dot(doc_emb, kw_emb) / (
                np.linalg.norm(doc_emb) * np.linalg.norm(kw_emb)
            )

            # 0-1 범위로 정규화 (코사인 유사도는 -1~1)
            normalized_score = (similarity + 1) / 2

            return float(normalized_score)

        except Exception as e:
            log.warning("Semantic similarity calculation failed", error=str(e))
            return 0.5

    def _calculate_uncertainty(
        self, keyword_score: float, semantic_score: float
    ) -> float:
        """불확실성 계산 (두 점수의 불일치 정도)"""
        # 두 점수의 차이가 클수록 불확실성 높음
        score_diff = abs(keyword_score - semantic_score)

        # 중간 점수일수록 불확실성 높음
        avg_score = (keyword_score + semantic_score) / 2
        mid_uncertainty = 1 - abs(avg_score - 0.5) * 2  # 0.5에 가까울수록 높음

        # 종합 불확실성
        uncertainty = (score_diff * 0.6) + (mid_uncertainty * 0.4)
        return min(max(uncertainty, 0.0), 1.0)

    def predict(
        self, request: RelevancePredictionRequest
    ) -> RelevancePredictionResponse:
        """단일 콘텐츠 관련성 예측"""

        # 캐시 확인
        cache_key = self._compute_cache_key(
            request.title, request.content, request.keywords
        )
        if cache_key in self._cache:
            self._cache_hits += 1
            return self._cache[cache_key]

        self._cache_misses += 1

        # 텍스트 준비
        full_text = f"{request.title} {request.content}"

        # 키워드 기반 점수
        keyword_score, keyword_matches = self._calculate_keyword_relevance(
            full_text, request.keywords
        )

        # 의미론적 점수 (모델 로드 후)
        self._load_model()
        semantic_score = self._calculate_semantic_similarity(
            request.title, request.content, request.keywords
        )

        # 앙상블 점수 (키워드 40% + 의미론적 60%)
        if self._model_loaded:
            final_score = (keyword_score * 0.4) + (semantic_score * 0.6)
        else:
            final_score = keyword_score

        # 불확실성 계산
        uncertainty = self._calculate_uncertainty(keyword_score, semantic_score)

        # 관련성 판단
        is_relevant = final_score >= settings.relevance_threshold

        result = RelevancePredictionResponse(
            content_id=request.id,
            score=round(final_score, 4),
            uncertainty=round(uncertainty, 4),
            is_relevant=is_relevant,
            model_version=self.MODEL_VERSION,
            keyword_matches=keyword_matches,
        )

        # 캐시 저장
        self._cache[cache_key] = result

        return result

    def predict_batch(
        self, requests: List[RelevancePredictionRequest]
    ) -> tuple[List[RelevancePredictionResponse], int]:
        """배치 관련성 예측"""
        start_time = time.time()

        # 모델 사전 로드
        self._load_model()

        results = []
        for request in requests:
            result = self.predict(request)
            results.append(result)

        processing_time_ms = int((time.time() - start_time) * 1000)
        return results, processing_time_ms

    def get_status(self) -> ModelStatus:
        """모델 상태 조회"""
        total_requests = self._cache_hits + self._cache_misses
        hit_rate = self._cache_hits / total_requests if total_requests > 0 else 0.0

        return ModelStatus(
            loaded=self._model_loaded,
            model_name=settings.model_name,
            device=self._device,
            cache_size=len(self._cache),
            cache_hit_rate=round(hit_rate, 4),
        )


# ============================================
# FastAPI Application
# ============================================

# Service instance
relevance_service = RelevanceScoringService()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    # Startup: 모델 사전 로드 (선택적)
    log.info("Starting Relevance Scoring Service")
    # Optionally preload model here
    # relevance_service._load_model()
    yield
    # Shutdown
    log.info("Shutting down Relevance Scoring Service")


app = FastAPI(
    title="Relevance Scoring Service",
    description="BERT 기반 콘텐츠 관련성 분류 서비스",
    version="1.0.0",
    lifespan=lifespan,
)

# Setup Prometheus metrics
SERVICE_NAME = "relevance-scorer"
if METRICS_AVAILABLE:
    setup_metrics(app, SERVICE_NAME, version="1.0.0")
    service_metrics = ServiceMetrics(SERVICE_NAME)
    predictions_total = service_metrics.create_counter(
        "predictions_total", "Total relevance predictions", ["result"]
    )
    prediction_latency = service_metrics.create_histogram(
        "prediction_latency_seconds",
        "Prediction latency in seconds",
        [],
        buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0),
    )
    batch_size_histogram = service_metrics.create_histogram(
        "batch_size",
        "Batch prediction sizes",
        [],
        buckets=(1, 5, 10, 25, 50, 100, 250, 500),
    )
    log.info("Prometheus metrics enabled for relevance-scorer service")
else:
    service_metrics = None
    log.warning("Prometheus metrics not available - shared module not found")


@app.get("/health")
async def health_check():
    """헬스 체크 - MlRelevanceAdapter가 호출"""
    return "ok"


@app.get("/status", response_model=ModelStatus)
async def get_status():
    """상세 상태 조회"""
    return relevance_service.get_status()


@app.post("/predict", response_model=RelevancePredictionResponse)
async def predict(request: RelevancePredictionRequest):
    """단일 콘텐츠 관련성 예측

    MlRelevanceAdapter에서 호출하는 엔드포인트
    """
    try:
        start_time = time.time()
        result = relevance_service.predict(request)

        # Metrics tracking
        if METRICS_AVAILABLE and service_metrics:
            latency = time.time() - start_time
            prediction_latency.observe(latency)
            predictions_total.labels(
                result="relevant" if result.is_relevant else "not_relevant"
            ).inc()

        return result

    except Exception as e:
        log.error("Prediction failed", error=str(e), content_id=request.id)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/predict/batch", response_model=BatchPredictionResponse)
async def predict_batch(request: BatchPredictionRequest):
    """배치 관련성 예측

    MlRelevanceAdapter.calculateBatch()에서 호출
    """
    try:
        if not request.items:
            return BatchPredictionResponse(
                predictions=[],
                model_version=RelevanceScoringService.MODEL_VERSION,
                processing_time_ms=0,
                total_count=0,
                relevant_count=0,
            )

        # Metrics tracking
        if METRICS_AVAILABLE and service_metrics:
            batch_size_histogram.observe(len(request.items))

        predictions, processing_time_ms = relevance_service.predict_batch(request.items)
        relevant_count = sum(1 for p in predictions if p.is_relevant)

        # Track individual results
        if METRICS_AVAILABLE and service_metrics:
            for pred in predictions:
                predictions_total.labels(
                    result="relevant" if pred.is_relevant else "not_relevant"
                ).inc()

        return BatchPredictionResponse(
            predictions=predictions,
            model_version=RelevanceScoringService.MODEL_VERSION,
            processing_time_ms=processing_time_ms,
            total_count=len(predictions),
            relevant_count=relevant_count,
        )

    except Exception as e:
        log.error(
            "Batch prediction failed", error=str(e), batch_size=len(request.items)
        )
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/preload-model")
async def preload_model():
    """ML 모델 사전 로딩"""
    try:
        relevance_service._load_model()
        status = relevance_service.get_status()
        return {
            "status": "success" if status.loaded else "failed",
            "model_name": status.model_name,
            "device": status.device,
        }
    except Exception as e:
        log.error("Model preload failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# Main
# ============================================

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
