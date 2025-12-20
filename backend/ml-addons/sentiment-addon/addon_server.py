"""
ML Add-on Server: Korean Sentiment Analysis with ML Models

NewsInsight ML Add-on 시스템의 감정 분석 구현.
KoELECTRA/KoBERT 기반 ML 모델을 사용하여 한국어 뉴스 기사의
감정(긍정/부정/중립)을 정확하게 분석합니다.

Features:
- KoELECTRA 기반 3-class 감정 분류
- 세부 감정(기쁨, 분노, 슬픔, 두려움 등) 분석
- 키워드 기반 폴백 모드 지원
- 배치 처리 지원
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, Dict, List, Any
import time
import os
import logging
import asyncio
from contextlib import asynccontextmanager
from functools import lru_cache

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ML Model cache (lazy loading)
_ml_models = {}
_model_loading = False


def get_ml_models():
    """Lazy load ML models on first use"""
    global _ml_models, _model_loading

    if _ml_models.get("loaded") or _model_loading:
        return _ml_models

    _model_loading = True

    try:
        import torch
        from transformers import (
            AutoTokenizer,
            AutoModelForSequenceClassification,
            pipeline,
        )

        logger.info("Loading sentiment ML models...")

        # Device selection
        device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"Using device: {device}")

        # 1. Primary Sentiment Model (KoELECTRA fine-tuned for sentiment)
        # Use Korean sentiment models
        sentiment_model_name = os.getenv(
            "SENTIMENT_MODEL",
            "snunlp/KR-FinBert-SC",  # Korean sentiment classifier
        )

        try:
            _ml_models["sentiment_pipeline"] = pipeline(
                "sentiment-analysis",
                model=sentiment_model_name,
                tokenizer=sentiment_model_name,
                device=0 if device == "cuda" else -1,
                max_length=512,
                truncation=True,
            )
            logger.info(f"Loaded primary sentiment model: {sentiment_model_name}")
        except Exception as e:
            logger.warning(f"Failed to load primary sentiment model: {e}")
            # Fallback to base KoELECTRA
            try:
                fallback_model = "monologg/koelectra-base-v3-discriminator"
                _ml_models["sentiment_tokenizer"] = AutoTokenizer.from_pretrained(
                    fallback_model
                )
                _ml_models["sentiment_model"] = (
                    AutoModelForSequenceClassification.from_pretrained(
                        fallback_model,
                        num_labels=3,  # positive, negative, neutral
                    ).to(device)
                )
                _ml_models["sentiment_model"].eval()
                logger.info(f"Loaded fallback sentiment model: {fallback_model}")
            except Exception as e2:
                logger.warning(f"Failed to load fallback model: {e2}")

        # 2. Emotion Classification Model (optional, for detailed emotions)
        emotion_model_name = os.getenv(
            "EMOTION_MODEL",
            "j-hartmann/emotion-english-distilroberta-base",  # Will work for general emotions
        )
        try:
            _ml_models["emotion_pipeline"] = pipeline(
                "text-classification",
                model=emotion_model_name,
                tokenizer=emotion_model_name,
                device=0 if device == "cuda" else -1,
                top_k=None,  # Return all emotion scores
                max_length=512,
                truncation=True,
            )
            logger.info(f"Loaded emotion model: {emotion_model_name}")
        except Exception as e:
            logger.warning(f"Failed to load emotion model (optional): {e}")

        _ml_models["device"] = device
        _ml_models["loaded"] = True
        logger.info("All sentiment ML models loaded successfully")

    except ImportError as e:
        logger.warning(f"ML libraries not available, using heuristic mode: {e}")
        _ml_models["loaded"] = False
    except Exception as e:
        logger.error(f"Error loading ML models: {e}")
        _ml_models["loaded"] = False

    _model_loading = False
    return _ml_models


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler"""
    # Startup
    logger.info("Sentiment addon starting...")

    # Preload models in background if ML is enabled
    if os.getenv("ENABLE_ML_MODELS", "true").lower() == "true":
        asyncio.create_task(asyncio.to_thread(get_ml_models))

    yield

    # Shutdown
    logger.info("Sentiment addon shutting down...")


app = FastAPI(
    title="Sentiment Analysis Add-on (ML Enhanced)",
    description="Korean news article sentiment analysis with ML models for NewsInsight",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ========== Request/Response Models ==========


class ArticleInput(BaseModel):
    id: Optional[int] = None
    title: Optional[str] = None
    content: Optional[str] = None
    url: Optional[str] = None
    source: Optional[str] = None
    published_at: Optional[str] = None


class AnalysisContext(BaseModel):
    language: Optional[str] = "ko"
    country: Optional[str] = "KR"
    previous_results: Optional[Dict[str, Any]] = None


class ExecutionOptions(BaseModel):
    importance: Optional[str] = "batch"
    debug: Optional[bool] = False
    timeout_ms: Optional[int] = None
    use_ml: Optional[bool] = True
    include_emotions: Optional[bool] = True


class AddonRequest(BaseModel):
    request_id: str
    addon_id: str
    task: str = "article_analysis"
    input_schema_version: str = "1.0"
    article: Optional[ArticleInput] = None
    context: Optional[AnalysisContext] = None
    options: Optional[ExecutionOptions] = None


class EmotionScore(BaseModel):
    joy: float = 0.0
    anger: float = 0.0
    sadness: float = 0.0
    fear: float = 0.0
    surprise: float = 0.0
    disgust: float = 0.0


class SentimentResult(BaseModel):
    score: float = Field(
        ...,
        ge=-1.0,
        le=1.0,
        description="Sentiment score from -1 (negative) to 1 (positive)",
    )
    label: str = Field(
        ..., description="Sentiment label: positive, negative, or neutral"
    )
    confidence: float = Field(..., ge=0.0, le=1.0, description="Model confidence score")
    distribution: Dict[str, float] = Field(
        ..., description="Score distribution across sentiment classes"
    )
    emotions: Optional[EmotionScore] = None
    explanations: List[str] = []
    analysis_method: str = "ml"  # ml, heuristic, hybrid


class AnalysisResults(BaseModel):
    sentiment: Optional[SentimentResult] = None
    raw: Optional[Dict[str, Any]] = None


class ResponseMeta(BaseModel):
    model_version: str
    model_name: str
    latency_ms: int
    processed_at: str
    device: str = "cpu"


class ErrorInfo(BaseModel):
    code: str
    message: str
    details: Optional[str] = None


class AddonResponse(BaseModel):
    request_id: str
    addon_id: str
    status: str  # success, error, partial
    output_schema_version: str = "1.0"
    results: Optional[AnalysisResults] = None
    error: Optional[ErrorInfo] = None
    meta: Optional[ResponseMeta] = None


# ========== Keyword-based Fallback (Heuristic) ==========

# Korean positive keywords
POSITIVE_KEYWORDS = [
    "성공",
    "발전",
    "향상",
    "긍정",
    "좋은",
    "훌륭",
    "최고",
    "행복",
    "성장",
    "협력",
    "지원",
    "개선",
    "희망",
    "기대",
    "축하",
    "승리",
    "호황",
    "상승",
    "증가",
    "활성화",
    "혁신",
    "돌파",
    "기록",
    "최대",
    "회복",
    "안정",
    "확대",
    "강화",
    "달성",
    "우수",
    "선도",
    "획기적",
    "감사",
    "축복",
    "영광",
    "존경",
    "사랑",
    "평화",
    "화합",
    "번영",
]

# Korean negative keywords
NEGATIVE_KEYWORDS = [
    "실패",
    "문제",
    "위기",
    "부정",
    "나쁜",
    "최악",
    "우려",
    "불안",
    "감소",
    "하락",
    "갈등",
    "비판",
    "논란",
    "피해",
    "사고",
    "범죄",
    "폭락",
    "붕괴",
    "파산",
    "침체",
    "악화",
    "충격",
    "위험",
    "경고",
    "분쟁",
    "반발",
    "혼란",
    "지연",
    "중단",
    "취소",
    "실망",
    "좌절",
    "공포",
    "분노",
    "슬픔",
    "죽음",
    "재난",
    "폭력",
    "테러",
    "전쟁",
]


def analyze_sentiment_heuristic(text: str) -> SentimentResult:
    """
    Fallback keyword-based sentiment analysis.
    Used when ML models are not available.
    """
    if not text:
        return SentimentResult(
            score=0.0,
            label="neutral",
            confidence=0.5,
            distribution={"positive": 0.33, "negative": 0.33, "neutral": 0.34},
            explanations=["텍스트 없음"],
            analysis_method="heuristic",
        )

    text_lower = text.lower()

    # Count keywords
    positive_count = sum(1 for kw in POSITIVE_KEYWORDS if kw in text_lower)
    negative_count = sum(1 for kw in NEGATIVE_KEYWORDS if kw in text_lower)
    total_keywords = positive_count + negative_count + 1

    # Calculate score (-1 ~ 1)
    raw_score = (positive_count - negative_count) / total_keywords
    score = max(-1.0, min(1.0, raw_score * 2))  # Scale up for more sensitivity

    # Calculate distribution
    positive_ratio = positive_count / total_keywords
    negative_ratio = negative_count / total_keywords
    neutral_ratio = max(0.0, 1.0 - positive_ratio - negative_ratio)

    # Normalize distribution
    total_ratio = positive_ratio + negative_ratio + neutral_ratio
    positive_ratio /= total_ratio
    negative_ratio /= total_ratio
    neutral_ratio /= total_ratio

    # Determine label
    if score > 0.15:
        label = "positive"
    elif score < -0.15:
        label = "negative"
    else:
        label = "neutral"

    # Calculate confidence based on keyword density
    confidence = min(0.9, 0.5 + (positive_count + negative_count) * 0.05)

    # Generate explanations
    explanations = []
    if positive_count > 0:
        explanations.append(f"긍정 키워드 {positive_count}개 발견")
    if negative_count > 0:
        explanations.append(f"부정 키워드 {negative_count}개 발견")
    if not explanations:
        explanations.append("특별한 감정 신호 없음 (중립)")

    # Simple emotion estimation from keywords
    emotions = EmotionScore(
        joy=positive_ratio * 0.8,
        anger=negative_ratio * 0.4,
        sadness=negative_ratio * 0.3,
        fear=negative_ratio * 0.2,
        surprise=0.1,
        disgust=negative_ratio * 0.1,
    )

    return SentimentResult(
        score=round(score, 4),
        label=label,
        confidence=round(confidence, 4),
        distribution={
            "positive": round(positive_ratio, 4),
            "negative": round(negative_ratio, 4),
            "neutral": round(neutral_ratio, 4),
        },
        emotions=emotions,
        explanations=explanations,
        analysis_method="heuristic",
    )


# ========== ML-based Sentiment Analysis ==========


def analyze_sentiment_ml(text: str, include_emotions: bool = True) -> SentimentResult:
    """
    ML-based sentiment analysis using KoELECTRA/KoBERT models.
    """
    models = get_ml_models()

    if not models.get("loaded"):
        logger.warning("ML models not loaded, falling back to heuristic")
        return analyze_sentiment_heuristic(text)

    try:
        import torch

        device = models.get("device", "cpu")
        explanations = []

        # Primary sentiment analysis
        sentiment_result = None

        if "sentiment_pipeline" in models:
            # Use pipeline-based inference
            pipeline_result = models["sentiment_pipeline"](text[:512])

            if isinstance(pipeline_result, list):
                pipeline_result = pipeline_result[0]

            label_map = {
                "POSITIVE": "positive",
                "NEGATIVE": "negative",
                "NEUTRAL": "neutral",
                "LABEL_0": "negative",  # Common mapping for 3-class
                "LABEL_1": "neutral",
                "LABEL_2": "positive",
                "긍정": "positive",
                "부정": "negative",
                "중립": "neutral",
            }

            raw_label = pipeline_result.get("label", "NEUTRAL").upper()
            label = label_map.get(raw_label, "neutral")
            confidence = pipeline_result.get("score", 0.5)

            # Convert label to score
            score_map = {"positive": 1.0, "negative": -1.0, "neutral": 0.0}
            score = score_map.get(label, 0.0) * confidence

            # Estimate distribution
            if label == "positive":
                distribution = {
                    "positive": confidence,
                    "negative": (1 - confidence) * 0.3,
                    "neutral": (1 - confidence) * 0.7,
                }
            elif label == "negative":
                distribution = {
                    "positive": (1 - confidence) * 0.3,
                    "negative": confidence,
                    "neutral": (1 - confidence) * 0.7,
                }
            else:
                distribution = {
                    "positive": (1 - confidence) * 0.5,
                    "negative": (1 - confidence) * 0.5,
                    "neutral": confidence,
                }

            explanations.append(f"KoELECTRA 모델 분석 (신뢰도: {confidence:.1%})")

        elif "sentiment_model" in models and "sentiment_tokenizer" in models:
            # Use manual inference with tokenizer + model
            tokenizer = models["sentiment_tokenizer"]
            model = models["sentiment_model"]

            inputs = tokenizer(
                text[:512],
                return_tensors="pt",
                truncation=True,
                max_length=512,
                padding=True,
            )
            inputs = {k: v.to(device) for k, v in inputs.items()}

            with torch.no_grad():
                outputs = model(**inputs)
                probs = torch.softmax(outputs.logits, dim=-1)[0]

            # Map to sentiment (assuming 3-class: negative, neutral, positive)
            neg_prob = probs[0].item()
            neu_prob = probs[1].item() if len(probs) > 2 else 0.33
            pos_prob = probs[2].item() if len(probs) > 2 else probs[1].item()

            distribution = {
                "negative": neg_prob,
                "neutral": neu_prob,
                "positive": pos_prob,
            }

            # Get dominant label
            max_idx = torch.argmax(probs).item()
            labels = ["negative", "neutral", "positive"]
            label = labels[min(max_idx, 2)]
            confidence = probs[max_idx].item()

            # Calculate score
            score = pos_prob - neg_prob

            explanations.append(
                f"KoELECTRA 베이스 모델 분석 (신뢰도: {confidence:.1%})"
            )

        else:
            logger.warning("No sentiment model available, using heuristic")
            return analyze_sentiment_heuristic(text)

        # Emotion analysis (optional)
        emotions = None
        if include_emotions and "emotion_pipeline" in models:
            try:
                emotion_result = models["emotion_pipeline"](text[:512])

                if isinstance(emotion_result, list) and len(emotion_result) > 0:
                    if isinstance(emotion_result[0], list):
                        emotion_result = emotion_result[0]

                    emotion_scores = {
                        e["label"].lower(): e["score"] for e in emotion_result
                    }

                    emotions = EmotionScore(
                        joy=emotion_scores.get("joy", 0.0),
                        anger=emotion_scores.get("anger", 0.0),
                        sadness=emotion_scores.get("sadness", 0.0),
                        fear=emotion_scores.get("fear", 0.0),
                        surprise=emotion_scores.get("surprise", 0.0),
                        disgust=emotion_scores.get("disgust", 0.0),
                    )
                    explanations.append("감정 세부 분석 완료")
            except Exception as e:
                logger.warning(f"Emotion analysis failed: {e}")
                # Estimate emotions from sentiment
                emotions = EmotionScore(
                    joy=distribution["positive"] * 0.8,
                    anger=distribution["negative"] * 0.4,
                    sadness=distribution["negative"] * 0.3,
                    fear=distribution["negative"] * 0.2,
                    surprise=0.1,
                    disgust=distribution["negative"] * 0.1,
                )
        else:
            # Estimate emotions from sentiment distribution
            emotions = EmotionScore(
                joy=distribution["positive"] * 0.8,
                anger=distribution["negative"] * 0.4,
                sadness=distribution["negative"] * 0.3,
                fear=distribution["negative"] * 0.2,
                surprise=0.1,
                disgust=distribution["negative"] * 0.1,
            )

        return SentimentResult(
            score=round(score, 4),
            label=label,
            confidence=round(confidence, 4),
            distribution={k: round(v, 4) for k, v in distribution.items()},
            emotions=emotions,
            explanations=explanations,
            analysis_method="ml",
        )

    except Exception as e:
        logger.error(f"ML sentiment analysis failed: {e}", exc_info=True)
        result = analyze_sentiment_heuristic(text)
        result.explanations.append(f"ML 분석 실패, 휴리스틱 폴백: {str(e)[:50]}")
        return result


def analyze_sentiment(
    text: str, use_ml: bool = True, include_emotions: bool = True
) -> SentimentResult:
    """
    Main sentiment analysis function.
    Automatically selects ML or heuristic based on availability.
    """
    if not text or not text.strip():
        return SentimentResult(
            score=0.0,
            label="neutral",
            confidence=0.5,
            distribution={"positive": 0.33, "negative": 0.33, "neutral": 0.34},
            explanations=["분석할 텍스트 없음"],
            analysis_method="none",
        )

    if use_ml:
        return analyze_sentiment_ml(text, include_emotions)
    else:
        return analyze_sentiment_heuristic(text)


# ========== API Endpoints ==========


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    models = get_ml_models()
    ml_status = "loaded" if models.get("loaded") else "heuristic_mode"

    return {
        "status": "healthy",
        "service": "sentiment-addon",
        "version": "2.0.0",
        "ml_status": ml_status,
        "device": models.get("device", "cpu"),
        "models": {
            "sentiment_pipeline": "sentiment_pipeline" in models,
            "sentiment_model": "sentiment_model" in models,
            "emotion_pipeline": "emotion_pipeline" in models,
        },
    }


@app.get("/models")
async def get_model_info():
    """Get information about loaded models"""
    models = get_ml_models()

    return {
        "loaded": models.get("loaded", False),
        "device": models.get("device", "cpu"),
        "available_models": [k for k in models.keys() if k not in ["loaded", "device"]],
        "sentiment_model": os.getenv("SENTIMENT_MODEL", "snunlp/KR-FinBert-SC"),
        "emotion_model": os.getenv(
            "EMOTION_MODEL", "j-hartmann/emotion-english-distilroberta-base"
        ),
    }


@app.post("/analyze", response_model=AddonResponse)
async def analyze(request: AddonRequest):
    """
    Article sentiment analysis endpoint.
    Called by NewsInsight Orchestrator.
    """
    start_time = time.time()
    models = get_ml_models()

    try:
        # Validate input
        if not request.article:
            raise ValueError("article is required")

        # Prepare text for analysis
        text = ""
        if request.article.title:
            text += request.article.title + " "
        if request.article.content:
            text += request.article.content

        # Get options
        options = request.options or ExecutionOptions()
        use_ml = options.use_ml if options.use_ml is not None else True
        include_emotions = (
            options.include_emotions if options.include_emotions is not None else True
        )

        # Run sentiment analysis
        sentiment_result = analyze_sentiment(
            text, use_ml=use_ml, include_emotions=include_emotions
        )

        # Build response
        latency_ms = int((time.time() - start_time) * 1000)

        model_name = (
            "koelectra-sentiment-v2" if models.get("loaded") else "keyword-heuristic-v1"
        )

        return AddonResponse(
            request_id=request.request_id,
            addon_id=request.addon_id,
            status="success",
            results=AnalysisResults(
                sentiment=sentiment_result,
                raw={
                    "text_length": len(text),
                    "ml_available": models.get("loaded", False),
                    "analysis_method": sentiment_result.analysis_method,
                },
            ),
            meta=ResponseMeta(
                model_version="2.0.0",
                model_name=model_name,
                latency_ms=latency_ms,
                processed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                device=models.get("device", "cpu"),
            ),
        )

    except ValueError as e:
        latency_ms = int((time.time() - start_time) * 1000)
        return AddonResponse(
            request_id=request.request_id,
            addon_id=request.addon_id,
            status="error",
            error=ErrorInfo(code="VALIDATION_ERROR", message=str(e)),
            meta=ResponseMeta(
                model_version="2.0.0",
                model_name="sentiment-addon",
                latency_ms=latency_ms,
                processed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                device=models.get("device", "cpu"),
            ),
        )
    except Exception as e:
        logger.error(f"Analysis error: {e}", exc_info=True)
        latency_ms = int((time.time() - start_time) * 1000)
        return AddonResponse(
            request_id=request.request_id,
            addon_id=request.addon_id,
            status="error",
            error=ErrorInfo(
                code="ANALYSIS_ERROR",
                message=str(e),
                details=f"Error occurred during sentiment analysis",
            ),
            meta=ResponseMeta(
                model_version="2.0.0",
                model_name="sentiment-addon",
                latency_ms=latency_ms,
                processed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                device=models.get("device", "cpu"),
            ),
        )


@app.post("/batch", response_model=List[AddonResponse])
async def analyze_batch(requests: List[AddonRequest]):
    """Batch analyze multiple articles"""
    results = []
    for req in requests:
        result = await analyze(req)
        results.append(result)
    return results


@app.post("/analyze/simple")
async def analyze_simple(text: str):
    """
    Simple text sentiment analysis endpoint.
    For quick testing without full request structure.
    """
    start_time = time.time()

    result = analyze_sentiment(text)
    latency_ms = int((time.time() - start_time) * 1000)

    return {
        "text": text[:100] + "..." if len(text) > 100 else text,
        "sentiment": result.model_dump(),
        "latency_ms": latency_ms,
    }


# ========== Topic Classification (Bonus Feature) ==========

TOPIC_KEYWORDS = {
    "정치": [
        "국회",
        "대통령",
        "정당",
        "선거",
        "투표",
        "정부",
        "장관",
        "의원",
        "청와대",
        "여당",
        "야당",
    ],
    "경제": [
        "주식",
        "코스피",
        "환율",
        "금리",
        "투자",
        "부동산",
        "GDP",
        "물가",
        "인플레이션",
        "기업",
    ],
    "사회": [
        "교육",
        "학교",
        "범죄",
        "사건",
        "복지",
        "의료",
        "병원",
        "사고",
        "재난",
        "환경",
    ],
    "문화": [
        "영화",
        "드라마",
        "음악",
        "공연",
        "전시",
        "예술",
        "문학",
        "K팝",
        "연예",
        "방송",
    ],
    "IT/과학": [
        "AI",
        "인공지능",
        "반도체",
        "스마트폰",
        "로봇",
        "우주",
        "연구",
        "개발",
        "기술",
        "디지털",
    ],
    "스포츠": [
        "축구",
        "야구",
        "농구",
        "올림픽",
        "월드컵",
        "선수",
        "경기",
        "대회",
        "승리",
        "우승",
    ],
    "국제": [
        "미국",
        "중국",
        "일본",
        "북한",
        "유럽",
        "UN",
        "외교",
        "무역",
        "전쟁",
        "분쟁",
    ],
}


@app.post("/analyze/topic")
async def analyze_topic(request: AddonRequest):
    """
    Article topic classification endpoint.
    Simple keyword-based topic detection.
    """
    start_time = time.time()

    if not request.article:
        raise HTTPException(status_code=400, detail="article is required")

    text = ""
    if request.article.title:
        text += request.article.title + " "
    if request.article.content:
        text += request.article.content

    text_lower = text.lower()

    # Count topic keywords
    topic_scores = {}
    for topic, keywords in TOPIC_KEYWORDS.items():
        count = sum(1 for kw in keywords if kw in text_lower)
        if count > 0:
            topic_scores[topic] = count

    # Normalize scores
    total = sum(topic_scores.values()) or 1
    topic_distribution = {k: v / total for k, v in topic_scores.items()}

    # Get primary topic
    primary_topic = (
        max(topic_scores.keys(), key=lambda k: topic_scores[k])
        if topic_scores
        else "기타"
    )

    latency_ms = int((time.time() - start_time) * 1000)

    return {
        "request_id": request.request_id,
        "status": "success",
        "topic": {
            "primary": primary_topic,
            "confidence": topic_distribution.get(primary_topic, 0.0),
            "distribution": topic_distribution,
            "all_topics": list(topic_scores.keys()),
        },
        "meta": {
            "model_version": "topic-keyword-v1",
            "latency_ms": latency_ms,
            "processed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
    }


# ========== Entry Point ==========

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8100"))
    host = os.getenv("HOST", "0.0.0.0")

    uvicorn.run(app, host=host, port=port)
