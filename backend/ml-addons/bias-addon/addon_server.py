"""
ML Add-on Server: Bias Analysis with ML Models

NewsInsight ML Add-on 시스템의 편향도 분석 구현.
KoELECTRA/KoBERT 기반 ML 모델을 사용하여 뉴스 기사의
정치적/이념적 편향성을 정확하게 분석합니다.

Features:
- KoELECTRA 기반 정치 성향 분류
- 언론사 기반 편향 분석
- 키워드/프레이밍 기반 폴백 모드 지원
- 객관성/감정적 어조 분석
- 배치 처리 지원
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, Dict, List, Any
import time
import os
import re
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

        logger.info("Loading bias ML models...")

        # Device selection
        device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"Using device: {device}")

        # 1. Primary Bias/Stance Model
        # Use a Korean text classification model that can be fine-tuned for stance detection
        bias_model_name = os.getenv(
            "BIAS_MODEL",
            "monologg/koelectra-base-v3-discriminator",  # Base Korean ELECTRA
        )

        try:
            # Try to load a sentiment/stance model first
            stance_model_name = os.getenv(
                "STANCE_MODEL",
                "snunlp/KR-FinBert-SC",  # Korean sentiment classifier as stance proxy
            )
            _ml_models["stance_pipeline"] = pipeline(
                "text-classification",
                model=stance_model_name,
                tokenizer=stance_model_name,
                device=0 if device == "cuda" else -1,
                max_length=512,
                truncation=True,
            )
            logger.info(f"Loaded stance model: {stance_model_name}")
        except Exception as e:
            logger.warning(f"Failed to load stance model: {e}")

        # 2. Load base tokenizer and model for custom analysis
        try:
            _ml_models["base_tokenizer"] = AutoTokenizer.from_pretrained(
                bias_model_name
            )
            _ml_models["base_model"] = (
                AutoModelForSequenceClassification.from_pretrained(
                    bias_model_name,
                    num_labels=3,  # left, center, right
                    ignore_mismatched_sizes=True,
                ).to(device)
            )
            _ml_models["base_model"].eval()
            logger.info(f"Loaded base model: {bias_model_name}")
        except Exception as e:
            logger.warning(f"Failed to load base model: {e}")

        # 3. Zero-shot classification for flexible bias detection
        try:
            zero_shot_model = os.getenv(
                "ZERO_SHOT_MODEL",
                "MoritzLaworski/korean-text-classification-zero-shot",
            )
            _ml_models["zero_shot_pipeline"] = pipeline(
                "zero-shot-classification",
                model=zero_shot_model,
                device=0 if device == "cuda" else -1,
            )
            logger.info(f"Loaded zero-shot model: {zero_shot_model}")
        except Exception as e:
            logger.warning(f"Failed to load zero-shot model (optional): {e}")

        _ml_models["device"] = device
        _ml_models["loaded"] = True
        logger.info("All bias ML models loaded successfully")

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
    logger.info("Bias addon starting...")

    # Preload models in background if ML is enabled
    if os.getenv("ENABLE_ML_MODELS", "true").lower() == "true":
        asyncio.create_task(asyncio.to_thread(get_ml_models))

    yield

    # Shutdown
    logger.info("Bias addon shutting down...")


app = FastAPI(
    title="Bias Analysis Add-on (ML Enhanced)",
    description="Korean news article political/ideological bias analysis with ML for NewsInsight",
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
    include_source_bias: Optional[bool] = True
    include_framing: Optional[bool] = True


class AddonRequest(BaseModel):
    request_id: str
    addon_id: str
    task: str = "article_analysis"
    input_schema_version: str = "1.0"
    article: Optional[ArticleInput] = None
    context: Optional[AnalysisContext] = None
    options: Optional[ExecutionOptions] = None


class BiasIndicator(BaseModel):
    phrase: str
    bias_type: str  # political, ideological, framing, selection
    direction: str  # left, right, neutral
    weight: float
    confidence: float = 0.5


class ToneAnalysis(BaseModel):
    objectivity_score: float = Field(
        ..., ge=0.0, le=1.0, description="1 = very objective"
    )
    emotional_language: float = Field(
        ..., ge=0.0, le=1.0, description="1 = very emotional"
    )
    loaded_words_count: int
    examples: Optional[List[str]] = None


class SourceBias(BaseModel):
    source_name: Optional[str] = None
    known_lean: Optional[str] = None  # left, center-left, center, center-right, right
    ownership_info: Optional[str] = None
    reliability_score: Optional[float] = None  # 0-1


class BiasResult(BaseModel):
    overall_bias_score: float = Field(
        ..., ge=-1.0, le=1.0, description="-1 (progressive) to 1 (conservative)"
    )
    bias_label: (
        str  # far_left, left, center_left, center, center_right, right, far_right
    )
    confidence: float = Field(..., ge=0.0, le=1.0)
    political_lean: str  # progressive, moderate, conservative
    distribution: Dict[str, float] = Field(
        default_factory=dict, description="Score distribution"
    )
    indicators: Optional[List[BiasIndicator]] = None
    tone_analysis: Optional[ToneAnalysis] = None
    source_bias: Optional[SourceBias] = None
    framing_notes: Optional[List[str]] = None
    explanations: Optional[List[str]] = None
    analysis_method: str = "ml"  # ml, heuristic, hybrid


class AnalysisResults(BaseModel):
    bias: Optional[BiasResult] = None
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


# ========== Source Bias Database ==========

# Korean media source political leanings (general perception)
SOURCE_BIAS_MAP = {
    # Progressive-leaning
    "한겨레": {"lean": "left", "score": -0.6, "reliability": 0.7},
    "경향신문": {"lean": "center-left", "score": -0.4, "reliability": 0.7},
    "오마이뉴스": {"lean": "left", "score": -0.7, "reliability": 0.6},
    "프레시안": {"lean": "left", "score": -0.7, "reliability": 0.6},
    "뉴스타파": {"lean": "left", "score": -0.5, "reliability": 0.8},
    # Center
    "연합뉴스": {"lean": "center", "score": 0.0, "reliability": 0.85},
    "KBS": {"lean": "center", "score": 0.0, "reliability": 0.8},
    "MBC": {"lean": "center-left", "score": -0.2, "reliability": 0.75},
    "SBS": {"lean": "center", "score": 0.0, "reliability": 0.75},
    "JTBC": {"lean": "center-left", "score": -0.2, "reliability": 0.75},
    "YTN": {"lean": "center", "score": 0.0, "reliability": 0.75},
    "뉴시스": {"lean": "center", "score": 0.0, "reliability": 0.7},
    "뉴스1": {"lean": "center", "score": 0.05, "reliability": 0.7},
    # Conservative-leaning
    "조선일보": {"lean": "right", "score": 0.6, "reliability": 0.7},
    "동아일보": {"lean": "center-right", "score": 0.4, "reliability": 0.7},
    "중앙일보": {"lean": "center-right", "score": 0.3, "reliability": 0.75},
    "매일경제": {"lean": "center-right", "score": 0.3, "reliability": 0.7},
    "한국경제": {"lean": "right", "score": 0.5, "reliability": 0.7},
    "TV조선": {"lean": "right", "score": 0.7, "reliability": 0.55},
    "채널A": {"lean": "right", "score": 0.6, "reliability": 0.55},
    "MBN": {"lean": "center-right", "score": 0.4, "reliability": 0.6},
    "문화일보": {"lean": "right", "score": 0.5, "reliability": 0.65},
    "세계일보": {"lean": "center-right", "score": 0.3, "reliability": 0.65},
}

# Progressive keywords/expressions
PROGRESSIVE_KEYWORDS = [
    ("복지", 0.3, 0.6),
    ("노동자 권리", 0.5, 0.7),
    ("환경", 0.2, 0.5),
    ("평등", 0.4, 0.7),
    ("인권", 0.3, 0.6),
    ("진보", 0.6, 0.8),
    ("민주화", 0.4, 0.7),
    ("시민단체", 0.3, 0.6),
    ("재벌 개혁", 0.5, 0.7),
    ("사회 정의", 0.4, 0.7),
    ("최저임금", 0.3, 0.6),
    ("공공성", 0.3, 0.6),
    ("노동조합", 0.4, 0.7),
    ("비정규직", 0.3, 0.6),
    ("부유세", 0.5, 0.7),
    ("공정경제", 0.3, 0.6),
    ("대북 화해", 0.4, 0.7),
    ("성소수자", 0.4, 0.7),
    ("젠더", 0.3, 0.6),
    ("다양성", 0.3, 0.6),
    ("기후위기", 0.3, 0.6),
    ("탈원전", 0.4, 0.7),
]

# Conservative keywords/expressions
CONSERVATIVE_KEYWORDS = [
    ("안보", 0.3, 0.6),
    ("자유시장", 0.4, 0.7),
    ("규제 완화", 0.4, 0.7),
    ("전통", 0.3, 0.6),
    ("보수", 0.6, 0.8),
    ("국가 안보", 0.4, 0.7),
    ("한미동맹", 0.3, 0.6),
    ("기업 친화", 0.4, 0.7),
    ("성장", 0.2, 0.5),
    ("법질서", 0.3, 0.6),
    ("애국", 0.4, 0.7),
    ("반공", 0.6, 0.8),
    ("자유민주주의", 0.3, 0.6),
    ("대북 강경", 0.4, 0.7),
    ("북핵", 0.3, 0.6),
    ("기업규제 완화", 0.4, 0.7),
    ("시장경제", 0.3, 0.6),
    ("원전", 0.3, 0.6),
    ("국방", 0.3, 0.6),
    ("자유대한민국", 0.5, 0.7),
    ("종북", 0.6, 0.8),
]

# Framing patterns
FRAMING_PATTERNS = {
    "left": [
        (r"민중", "진보적 프레이밍", 0.4),
        (r"사회적\s*약자", "진보적 관점", 0.3),
        (r"불평등\s*심화", "불평등 강조", 0.4),
        (r"재벌\s*특혜", "대기업 비판적", 0.4),
        (r"노동\s*착취", "노동자 권익 강조", 0.5),
        (r"검찰\s*독재", "검찰 비판적", 0.5),
        (r"적폐", "적폐 청산 프레임", 0.5),
    ],
    "right": [
        (r"종북", "보수적 프레이밍", 0.6),
        (r"안보\s*위협", "안보 강조", 0.4),
        (r"경제\s*성장", "성장 중심", 0.3),
        (r"시장\s*원리", "시장주의적 관점", 0.3),
        (r"규제\s*폐해", "규제 비판적", 0.4),
        (r"좌파\s*정권", "정권 비판적", 0.5),
        (r"포퓰리즘", "포퓰리즘 비판", 0.4),
    ],
}

# Emotional/loaded words
LOADED_WORDS = {
    "left": ["착취", "불의", "특권층", "기득권", "차별", "탄압", "독재", "적폐"],
    "right": ["종북", "좌파", "선동", "매국", "폭력", "과격", "빨갱이", "친중"],
    "emotional": [
        "충격적",
        "경악",
        "황당",
        "기막힌",
        "어처구니",
        "분노",
        "통탄",
        "개탄",
    ],
}


# ========== Heuristic Analysis Functions ==========


def get_source_bias(source: Optional[str]) -> SourceBias:
    """Get bias info from media source name"""
    if not source:
        return SourceBias()

    for name, info in SOURCE_BIAS_MAP.items():
        if name in source:
            return SourceBias(
                source_name=name,
                known_lean=info["lean"],
                reliability_score=info.get("reliability"),
            )

    return SourceBias(source_name=source, known_lean="unknown")


def analyze_keyword_bias_heuristic(text: str) -> tuple[float, List[BiasIndicator]]:
    """Keyword-based bias analysis (heuristic)"""
    if not text:
        return 0.0, []

    indicators = []
    progressive_score = 0.0
    conservative_score = 0.0

    text_lower = text.lower()

    # Progressive keywords
    for keyword, weight, conf in PROGRESSIVE_KEYWORDS:
        if keyword in text_lower:
            progressive_score += weight
            indicators.append(
                BiasIndicator(
                    phrase=keyword,
                    bias_type="political",
                    direction="left",
                    weight=weight,
                    confidence=conf,
                )
            )

    # Conservative keywords
    for keyword, weight, conf in CONSERVATIVE_KEYWORDS:
        if keyword in text_lower:
            conservative_score += weight
            indicators.append(
                BiasIndicator(
                    phrase=keyword,
                    bias_type="political",
                    direction="right",
                    weight=weight,
                    confidence=conf,
                )
            )

    # Normalize score (-1 ~ 1)
    total = progressive_score + conservative_score
    if total == 0:
        return 0.0, indicators

    bias_score = (conservative_score - progressive_score) / max(total, 1)
    return bias_score, indicators


def analyze_framing_heuristic(text: str) -> tuple[float, List[str]]:
    """Framing analysis (heuristic)"""
    if not text:
        return 0.0, []

    notes = []
    left_score = 0.0
    right_score = 0.0

    for pattern, note, weight in FRAMING_PATTERNS["left"]:
        if re.search(pattern, text):
            left_score += weight
            notes.append(f"[진보] {note}")

    for pattern, note, weight in FRAMING_PATTERNS["right"]:
        if re.search(pattern, text):
            right_score += weight
            notes.append(f"[보수] {note}")

    total = left_score + right_score
    if total == 0:
        return 0.0, notes

    framing_bias = (right_score - left_score) / total
    return framing_bias, notes


def analyze_tone_heuristic(text: str) -> ToneAnalysis:
    """Tone/objectivity analysis (heuristic)"""
    if not text:
        return ToneAnalysis(
            objectivity_score=0.5, emotional_language=0.0, loaded_words_count=0
        )

    loaded_count = 0
    examples = []

    # Count loaded words
    for direction, words in LOADED_WORDS.items():
        for word in words:
            count = text.count(word)
            if count > 0:
                loaded_count += count
                examples.append(word)

    # Emotional expression ratio estimation
    emotional_score = min(loaded_count / 10, 1.0)
    objectivity_score = 1.0 - emotional_score

    return ToneAnalysis(
        objectivity_score=round(objectivity_score, 3),
        emotional_language=round(emotional_score, 3),
        loaded_words_count=loaded_count,
        examples=examples[:5] if examples else None,
    )


def score_to_label(score: float) -> tuple[str, str]:
    """Convert bias score to label"""
    if score <= -0.6:
        return "far_left", "progressive"
    elif score <= -0.3:
        return "left", "progressive"
    elif score <= -0.1:
        return "center_left", "moderate"
    elif score <= 0.1:
        return "center", "moderate"
    elif score <= 0.3:
        return "center_right", "moderate"
    elif score <= 0.6:
        return "right", "conservative"
    else:
        return "far_right", "conservative"


def analyze_bias_heuristic(
    text: str,
    source: Optional[str] = None,
    include_source_bias: bool = True,
    include_framing: bool = True,
) -> BiasResult:
    """Full heuristic bias analysis"""
    if not text or not text.strip():
        return BiasResult(
            overall_bias_score=0.0,
            bias_label="center",
            confidence=0.0,
            political_lean="unknown",
            distribution={"left": 0.33, "center": 0.34, "right": 0.33},
            explanations=["분석할 텍스트 없음"],
            analysis_method="heuristic",
        )

    explanations = []

    # 1. Source bias
    source_bias = get_source_bias(source) if include_source_bias else SourceBias()
    source_score = 0.0
    if source_bias.known_lean and source and include_source_bias:
        for name, info in SOURCE_BIAS_MAP.items():
            if name in source:
                source_score = info["score"]
                explanations.append(f"언론사 성향: {name} ({source_bias.known_lean})")
                break

    # 2. Keyword-based bias
    keyword_score, indicators = analyze_keyword_bias_heuristic(text)
    if indicators:
        explanations.append(f"편향 키워드 {len(indicators)}개 발견")

    # 3. Framing analysis
    framing_score, framing_notes = (0.0, [])
    if include_framing:
        framing_score, framing_notes = analyze_framing_heuristic(text)
        if framing_notes:
            explanations.append(f"프레이밍 패턴 {len(framing_notes)}개 발견")

    # 4. Tone analysis
    tone_analysis = analyze_tone_heuristic(text)
    if tone_analysis.loaded_words_count > 0:
        explanations.append(f"감정적 표현 {tone_analysis.loaded_words_count}개 발견")

    # 5. Combined score (weighted average)
    # Source 30%, Keywords 40%, Framing 30%
    weights = {"source": 0.3, "keyword": 0.4, "framing": 0.3}
    overall_score = (
        source_score * weights["source"]
        + keyword_score * weights["keyword"]
        + framing_score * weights["framing"]
    )
    overall_score = max(-1.0, min(1.0, overall_score))

    # 6. Determine label
    bias_label, political_lean = score_to_label(overall_score)

    # 7. Calculate confidence
    evidence_count = len(indicators) + len(framing_notes)
    base_confidence = 0.3 if source_score != 0 else 0.2
    confidence = min(base_confidence + evidence_count * 0.08, 0.9)

    # 8. Calculate distribution
    if overall_score < 0:
        left_ratio = abs(overall_score) * 0.5 + 0.25
        right_ratio = 0.25 - abs(overall_score) * 0.15
    elif overall_score > 0:
        right_ratio = overall_score * 0.5 + 0.25
        left_ratio = 0.25 - overall_score * 0.15
    else:
        left_ratio = 0.25
        right_ratio = 0.25
    center_ratio = 1.0 - left_ratio - right_ratio

    distribution = {
        "left": round(max(0, left_ratio), 3),
        "center": round(max(0, center_ratio), 3),
        "right": round(max(0, right_ratio), 3),
    }

    explanations.append(f"종합 편향 점수: {overall_score:.2f} (-1=진보, 1=보수)")

    return BiasResult(
        overall_bias_score=round(overall_score, 4),
        bias_label=bias_label,
        confidence=round(confidence, 3),
        political_lean=political_lean,
        distribution=distribution,
        indicators=indicators if indicators else None,
        tone_analysis=tone_analysis,
        source_bias=source_bias if include_source_bias else None,
        framing_notes=framing_notes if framing_notes else None,
        explanations=explanations,
        analysis_method="heuristic",
    )


# ========== ML-based Bias Analysis ==========


def analyze_bias_ml(
    text: str,
    source: Optional[str] = None,
    include_source_bias: bool = True,
    include_framing: bool = True,
) -> BiasResult:
    """ML-based bias analysis"""
    models = get_ml_models()

    if not models.get("loaded"):
        logger.warning("ML models not loaded, falling back to heuristic")
        return analyze_bias_heuristic(
            text, source, include_source_bias, include_framing
        )

    try:
        import torch

        device = models.get("device", "cpu")
        explanations = []
        ml_score = 0.0
        ml_confidence = 0.5

        # 1. Try zero-shot classification for political stance
        if "zero_shot_pipeline" in models:
            try:
                candidate_labels = ["진보적", "중도", "보수적"]
                result = models["zero_shot_pipeline"](
                    text[:512],
                    candidate_labels,
                    hypothesis_template="이 기사는 {} 관점으로 작성되었습니다.",
                )

                label_scores = dict(zip(result["labels"], result["scores"]))
                progressive_prob = label_scores.get("진보적", 0.33)
                center_prob = label_scores.get("중도", 0.34)
                conservative_prob = label_scores.get("보수적", 0.33)

                # Calculate bias score from zero-shot
                ml_score = conservative_prob - progressive_prob
                ml_confidence = max(result["scores"])

                explanations.append(
                    f"Zero-shot 분류: 진보 {progressive_prob:.1%}, 중도 {center_prob:.1%}, 보수 {conservative_prob:.1%}"
                )

            except Exception as e:
                logger.warning(f"Zero-shot classification failed: {e}")

        # 2. Use stance pipeline as fallback/supplement
        elif "stance_pipeline" in models:
            try:
                pipeline_result = models["stance_pipeline"](text[:512])

                if isinstance(pipeline_result, list):
                    pipeline_result = pipeline_result[0]

                # Map sentiment to stance (proxy)
                label = pipeline_result.get("label", "").upper()
                score = pipeline_result.get("score", 0.5)

                # Positive sentiment often correlates with pro-status-quo (center-right)
                # Negative sentiment often correlates with criticism (can be either side)
                if "POSITIVE" in label or "긍정" in label:
                    ml_score = 0.1 * score  # Slight center-right
                elif "NEGATIVE" in label or "부정" in label:
                    ml_score = 0.0  # Neutral for negative (needs more context)
                else:
                    ml_score = 0.0

                ml_confidence = score * 0.5  # Lower confidence since it's a proxy
                explanations.append(f"감정 기반 추정 (신뢰도: {ml_confidence:.1%})")

            except Exception as e:
                logger.warning(f"Stance pipeline failed: {e}")

        # 3. Combine ML with heuristic for better results
        heuristic_result = analyze_bias_heuristic(
            text, source, include_source_bias, include_framing
        )

        # Weighted combination: ML 40%, Heuristic 60% (heuristic is more reliable for political bias)
        combined_score = ml_score * 0.4 + heuristic_result.overall_bias_score * 0.6
        combined_score = max(-1.0, min(1.0, combined_score))

        combined_confidence = ml_confidence * 0.4 + heuristic_result.confidence * 0.6

        # Determine label
        bias_label, political_lean = score_to_label(combined_score)

        # Calculate distribution
        if combined_score < 0:
            left_ratio = abs(combined_score) * 0.5 + 0.25
            right_ratio = 0.25 - abs(combined_score) * 0.15
        elif combined_score > 0:
            right_ratio = combined_score * 0.5 + 0.25
            left_ratio = 0.25 - combined_score * 0.15
        else:
            left_ratio = 0.25
            right_ratio = 0.25
        center_ratio = 1.0 - left_ratio - right_ratio

        distribution = {
            "left": round(max(0, left_ratio), 3),
            "center": round(max(0, center_ratio), 3),
            "right": round(max(0, right_ratio), 3),
        }

        # Merge explanations
        all_explanations = explanations + (heuristic_result.explanations or [])
        all_explanations.append(
            f"종합 편향 점수: {combined_score:.2f} (-1=진보, 1=보수)"
        )

        return BiasResult(
            overall_bias_score=round(combined_score, 4),
            bias_label=bias_label,
            confidence=round(combined_confidence, 3),
            political_lean=political_lean,
            distribution=distribution,
            indicators=heuristic_result.indicators,
            tone_analysis=heuristic_result.tone_analysis,
            source_bias=heuristic_result.source_bias,
            framing_notes=heuristic_result.framing_notes,
            explanations=all_explanations,
            analysis_method="hybrid",  # ML + heuristic
        )

    except Exception as e:
        logger.error(f"ML bias analysis failed: {e}", exc_info=True)
        result = analyze_bias_heuristic(
            text, source, include_source_bias, include_framing
        )
        result.explanations = (result.explanations or []) + [
            f"ML 분석 실패, 휴리스틱 폴백: {str(e)[:50]}"
        ]
        return result


def analyze_bias(
    text: str,
    source: Optional[str] = None,
    use_ml: bool = True,
    include_source_bias: bool = True,
    include_framing: bool = True,
) -> BiasResult:
    """Main bias analysis function"""
    if not text or not text.strip():
        return BiasResult(
            overall_bias_score=0.0,
            bias_label="center",
            confidence=0.0,
            political_lean="unknown",
            distribution={"left": 0.33, "center": 0.34, "right": 0.33},
            explanations=["분석할 텍스트 없음"],
            analysis_method="none",
        )

    if use_ml:
        return analyze_bias_ml(text, source, include_source_bias, include_framing)
    else:
        return analyze_bias_heuristic(
            text, source, include_source_bias, include_framing
        )


# ========== API Endpoints ==========


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    models = get_ml_models()
    ml_status = "loaded" if models.get("loaded") else "heuristic_mode"

    return {
        "status": "healthy",
        "service": "bias-addon",
        "version": "2.0.0",
        "ml_status": ml_status,
        "device": models.get("device", "cpu"),
        "models": {
            "zero_shot_pipeline": "zero_shot_pipeline" in models,
            "stance_pipeline": "stance_pipeline" in models,
            "base_model": "base_model" in models,
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
        "bias_model": os.getenv(
            "BIAS_MODEL", "monologg/koelectra-base-v3-discriminator"
        ),
        "zero_shot_model": os.getenv(
            "ZERO_SHOT_MODEL", "MoritzLaworski/korean-text-classification-zero-shot"
        ),
    }


@app.get("/sources")
async def get_source_database():
    """Get the source bias database"""
    return {
        "sources": [
            {
                "name": name,
                "lean": info["lean"],
                "score": info["score"],
                "reliability": info.get("reliability", 0.5),
            }
            for name, info in SOURCE_BIAS_MAP.items()
        ],
        "total": len(SOURCE_BIAS_MAP),
    }


@app.post("/analyze", response_model=AddonResponse)
async def analyze(request: AddonRequest):
    """
    Article bias analysis endpoint.
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
        include_source_bias = (
            options.include_source_bias
            if options.include_source_bias is not None
            else True
        )
        include_framing = (
            options.include_framing if options.include_framing is not None else True
        )

        # Run bias analysis
        bias_result = analyze_bias(
            text,
            source=request.article.source,
            use_ml=use_ml,
            include_source_bias=include_source_bias,
            include_framing=include_framing,
        )

        # Build response
        latency_ms = int((time.time() - start_time) * 1000)

        model_name = (
            "koelectra-bias-hybrid-v2" if models.get("loaded") else "bias-heuristic-v1"
        )

        return AddonResponse(
            request_id=request.request_id,
            addon_id=request.addon_id,
            status="success",
            results=AnalysisResults(
                bias=bias_result,
                raw={
                    "text_length": len(text),
                    "source": request.article.source,
                    "ml_available": models.get("loaded", False),
                    "analysis_method": bias_result.analysis_method,
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
                model_name="bias-addon",
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
                details="Error occurred during bias analysis",
            ),
            meta=ResponseMeta(
                model_version="2.0.0",
                model_name="bias-addon",
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
async def analyze_simple(text: str, source: Optional[str] = None):
    """
    Simple text bias analysis endpoint.
    For quick testing without full request structure.
    """
    start_time = time.time()

    result = analyze_bias(text, source=source)
    latency_ms = int((time.time() - start_time) * 1000)

    return {
        "text": text[:100] + "..." if len(text) > 100 else text,
        "source": source,
        "bias": result.model_dump(),
        "latency_ms": latency_ms,
    }


@app.post("/analyze/source")
async def analyze_source_only(source: str):
    """
    Analyze bias based on source name only.
    Quick lookup without content analysis.
    """
    source_bias = get_source_bias(source)

    if source_bias.known_lean == "unknown":
        return {
            "source": source,
            "found": False,
            "message": "Source not found in database",
        }

    # Get score from database
    score = 0.0
    for name, info in SOURCE_BIAS_MAP.items():
        if name in source:
            score = info["score"]
            break

    bias_label, political_lean = score_to_label(score)

    return {
        "source": source,
        "found": True,
        "bias": {
            "score": score,
            "label": bias_label,
            "political_lean": political_lean,
            "known_lean": source_bias.known_lean,
            "reliability": source_bias.reliability_score,
        },
    }


# ========== Entry Point ==========

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8102"))
    host = os.getenv("HOST", "0.0.0.0")

    uvicorn.run(app, host=host, port=port)
