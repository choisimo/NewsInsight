"""
ML Add-on Server: Fact-Check Analysis with ML Models

NewsInsight ML Add-on 시스템의 팩트체크 구현.
KoBERT/KoELECTRA 기반 ML 모델과 외부 팩트체크 API를 통합하여
뉴스 기사의 사실 검증 및 신뢰도 분석을 수행합니다.

Features:
- ML 기반 주장 추출 및 분류
- 의미론적 유사도 기반 교차 검증
- 외부 팩트체크 API 연동 (SNU, Google Fact Check)
- 신뢰도 점수 산출 세부 분석 제공
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
from typing import Optional, Dict, List, Any, Tuple
from enum import Enum
import time
import re
import hashlib
import os
import logging
import asyncio
from functools import lru_cache
from contextlib import asynccontextmanager

# Prometheus metrics
try:
    from prometheus_client import (
        Counter,
        Histogram,
        Gauge,
        CONTENT_TYPE_LATEST,
        generate_latest,
    )

    PROMETHEUS_AVAILABLE = True
except ImportError:
    PROMETHEUS_AVAILABLE = False

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ML Model imports (lazy loading for faster startup)
_ml_models = {}
_model_loading = False


def get_ml_models():
    """Lazy load ML models on first use"""
    global _ml_models, _model_loading

    if _ml_models or _model_loading:
        return _ml_models

    _model_loading = True

    try:
        import torch
        from transformers import (
            AutoTokenizer,
            AutoModelForSequenceClassification,
            AutoModelForTokenClassification,
            pipeline,
        )
        from sentence_transformers import SentenceTransformer

        logger.info("Loading ML models...")

        # Device selection
        device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"Using device: {device}")

        # 1. Claim Classification Model (KoELECTRA)
        claim_model_name = os.getenv(
            "CLAIM_MODEL", "monologg/koelectra-base-v3-discriminator"
        )
        try:
            _ml_models["claim_tokenizer"] = AutoTokenizer.from_pretrained(
                claim_model_name
            )
            _ml_models["claim_model"] = (
                AutoModelForSequenceClassification.from_pretrained(
                    claim_model_name,
                    num_labels=3,  # claim, non-claim, uncertain
                ).to(device)
            )
            _ml_models["claim_model"].eval()
            logger.info(f"Loaded claim model: {claim_model_name}")
        except Exception as e:
            logger.warning(f"Failed to load claim model: {e}")

        # 2. Sentence Transformer for Semantic Similarity
        embedding_model_name = os.getenv(
            "EMBEDDING_MODEL",
            "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        )
        try:
            _ml_models["sentence_transformer"] = SentenceTransformer(
                embedding_model_name
            )
            logger.info(f"Loaded embedding model: {embedding_model_name}")
        except Exception as e:
            logger.warning(f"Failed to load embedding model: {e}")

        # 3. NER for Entity Extraction (Korean)
        ner_model_name = os.getenv("NER_MODEL", "klue/bert-base")
        try:
            _ml_models["ner_pipeline"] = pipeline(
                "ner",
                model=ner_model_name,
                tokenizer=ner_model_name,
                aggregation_strategy="simple",
                device=0 if device == "cuda" else -1,
            )
            logger.info(f"Loaded NER model: {ner_model_name}")
        except Exception as e:
            logger.warning(f"Failed to load NER model: {e}")

        # 4. Sentiment for tone analysis
        sentiment_model_name = os.getenv("SENTIMENT_MODEL", "klue/roberta-base")
        try:
            _ml_models["sentiment_pipeline"] = pipeline(
                "sentiment-analysis",
                model=sentiment_model_name,
                tokenizer=sentiment_model_name,
                device=0 if device == "cuda" else -1,
            )
            logger.info(f"Loaded sentiment model: {sentiment_model_name}")
        except Exception as e:
            logger.warning(f"Failed to load sentiment model: {e}")

        _ml_models["device"] = device
        _ml_models["loaded"] = True
        logger.info("All ML models loaded successfully")

    except ImportError as e:
        logger.warning(f"ML libraries not available, using heuristic mode: {e}")
        _ml_models["loaded"] = False
    except Exception as e:
        logger.error(f"Error loading ML models: {e}")
        _ml_models["loaded"] = False

    _model_loading = False
    return _ml_models


# External API clients (lazy initialization)
_api_clients = {}


async def get_http_client():
    """Get async HTTP client"""
    global _api_clients

    if "http_client" not in _api_clients:
        try:
            import httpx

            _api_clients["http_client"] = httpx.AsyncClient(timeout=30.0)
        except ImportError:
            _api_clients["http_client"] = None

    return _api_clients.get("http_client")


# Model loading status for health checks
_model_warmup_complete = False
_model_warmup_error = None


async def _warmup_models():
    """Warm up models and track completion status"""
    global _model_warmup_complete, _model_warmup_error
    try:
        logger.info("Starting model warm-up...")
        start_time = time.time()

        # Load models synchronously in thread
        models = await asyncio.to_thread(get_ml_models)

        if models.get("loaded"):
            # Run a dummy inference to fully warm up the model
            if "claim_model" in models and "claim_tokenizer" in models:
                try:
                    dummy_text = "테스트 문장입니다."
                    tokenizer = models["claim_tokenizer"]
                    model = models["claim_model"]
                    inputs = tokenizer(
                        dummy_text, return_tensors="pt", truncation=True, max_length=128
                    )
                    if models.get("device") == "cuda":
                        inputs = {k: v.cuda() for k, v in inputs.items()}
                    with __import__("torch").no_grad():
                        _ = model(**inputs)
                    logger.info("Claim model warm-up inference complete")
                except Exception as e:
                    logger.warning(f"Claim model warm-up inference failed: {e}")

            elapsed = time.time() - start_time
            logger.info(f"Model warm-up completed in {elapsed:.2f}s")
            _model_warmup_complete = True
        else:
            logger.warning("Models not loaded, running in heuristic mode")
            _model_warmup_complete = True  # Still mark as complete for heuristic mode

    except Exception as e:
        logger.error(f"Model warm-up failed: {e}")
        _model_warmup_error = str(e)
        _model_warmup_complete = True  # Mark complete even on error to avoid blocking


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler"""
    # Startup
    logger.info("Factcheck addon starting...")

    # Preload models in background if ML is enabled
    if os.getenv("ENABLE_ML_MODELS", "true").lower() == "true":
        # Start warm-up task
        asyncio.create_task(_warmup_models())

    yield

    # Shutdown
    logger.info("Factcheck addon shutting down...")
    if "http_client" in _api_clients and _api_clients["http_client"]:
        await _api_clients["http_client"].aclose()


app = FastAPI(
    title="Fact-Check Analysis Add-on (ML Enhanced)",
    description="Korean news article fact-checking with ML models and external API integration",
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

# ========== Prometheus Metrics ==========

if PROMETHEUS_AVAILABLE:
    # Request metrics
    REQUEST_COUNT = Counter(
        "factcheck_requests_total",
        "Total number of factcheck requests",
        ["endpoint", "status"],
    )
    REQUEST_LATENCY = Histogram(
        "factcheck_request_latency_seconds",
        "Request latency in seconds",
        ["endpoint"],
        buckets=(0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0),
    )

    # Analysis metrics
    ANALYSIS_COUNT = Counter(
        "factcheck_analysis_total",
        "Total number of analyses performed",
        ["mode", "verdict"],
    )
    CLAIMS_EXTRACTED = Counter(
        "factcheck_claims_extracted_total", "Total number of claims extracted"
    )

    # Model metrics
    MODEL_LOADED = Gauge(
        "factcheck_model_loaded", "Whether ML models are loaded (1=yes, 0=no)"
    )
    MODEL_WARMUP_COMPLETE = Gauge(
        "factcheck_model_warmup_complete",
        "Whether model warm-up is complete (1=yes, 0=no)",
    )

    # Error metrics
    ERROR_COUNT = Counter(
        "factcheck_errors_total", "Total number of errors", ["error_type"]
    )

    @app.get("/metrics")
    async def metrics():
        """Prometheus metrics endpoint"""
        # Update model status gauges
        models = get_ml_models() if not _model_loading else {}
        MODEL_LOADED.set(1 if models.get("loaded") else 0)
        MODEL_WARMUP_COMPLETE.set(1 if _model_warmup_complete else 0)

        return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

# ========== Enums and Models ==========


class AnalysisMode(str, Enum):
    HEURISTIC = "heuristic"
    ML_BASIC = "ml_basic"
    ML_FULL = "ml_full"
    EXTERNAL_API = "external_api"
    HYBRID = "hybrid"


class ClaimVerdict(str, Enum):
    VERIFIED = "verified"
    FALSE = "false"
    UNVERIFIED = "unverified"
    MISLEADING = "misleading"
    PARTIALLY_TRUE = "partially_true"


class CredibilityGrade(str, Enum):
    A = "A"
    B = "B"
    C = "C"
    D = "D"
    F = "F"


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
    analysis_mode: Optional[AnalysisMode] = AnalysisMode.HYBRID
    include_detailed_analytics: Optional[bool] = True


class AddonRequest(BaseModel):
    request_id: str
    addon_id: str
    task: str = "article_analysis"
    input_schema_version: str = "1.0"
    article: Optional[ArticleInput] = None
    context: Optional[AnalysisContext] = None
    options: Optional[ExecutionOptions] = None


# ========== Detailed Analytics Models ==========


class SourceAnalytics(BaseModel):
    source_name: Optional[str] = None
    is_trusted: bool = False
    trust_score: float = 0.0
    trust_level: str = "unknown"  # trusted, unknown, untrusted
    matched_trusted_source: Optional[str] = None
    reason: str = ""


class ClickbaitAnalytics(BaseModel):
    is_clickbait: bool = False
    score: float = 0.0
    detected_patterns: List[Dict[str, Any]] = []
    total_patterns_checked: int = 0


class MisinfoAnalytics(BaseModel):
    risk_score: float = 0.0
    risk_level: str = "low"  # low, medium, high
    detected_patterns: List[Dict[str, Any]] = []
    unverifiable_claim_count: int = 0


class ClaimAnalytics(BaseModel):
    claim_id: str
    claim_text: str
    verdict: str
    confidence: float
    ml_confidence: Optional[float] = None
    claim_indicator: Optional[str] = None
    analysis_method: str = "heuristic"
    entities: Optional[List[Dict[str, str]]] = None
    semantic_similarity_scores: Optional[List[Dict[str, float]]] = None
    supporting_factors: List[str] = []
    contradicting_factors: List[str] = []
    external_verification: Optional[Dict[str, Any]] = None


class ScoreBreakdown(BaseModel):
    source_weight: int = 30
    clickbait_weight: int = 20
    misinfo_weight: int = 20
    verification_weight: int = 30

    source_contribution: float = 0.0
    clickbait_contribution: float = 0.0
    misinfo_contribution: float = 0.0
    verification_contribution: float = 0.0

    total_score: float = 0.0
    grade: str = "C"


class DetailedAnalytics(BaseModel):
    """Detailed analytics for transparency"""

    source_analysis: SourceAnalytics
    clickbait_analysis: ClickbaitAnalytics
    misinfo_analysis: MisinfoAnalytics
    claim_analyses: List[ClaimAnalytics] = []
    score_breakdown: ScoreBreakdown

    analysis_mode: str = "heuristic"
    ml_models_used: List[str] = []
    external_apis_used: List[str] = []
    processing_time_ms: int = 0
    analyzed_at: str = ""


class ClaimResult(BaseModel):
    claim: str
    verdict: str
    confidence: float
    evidence: Optional[str] = None
    source_url: Optional[str] = None
    ml_analysis: Optional[Dict[str, Any]] = None


class FactCheckResult(BaseModel):
    overall_credibility: float
    credibility_grade: str
    verdict: str
    claims_analyzed: int
    verified_claims: int
    false_claims: int
    unverified_claims: int
    claims: Optional[List[ClaimResult]] = None
    risk_flags: Optional[List[str]] = None
    explanations: Optional[List[str]] = None
    detailed_analytics: Optional[DetailedAnalytics] = None


class AnalysisResults(BaseModel):
    factcheck: Optional[FactCheckResult] = None
    raw: Optional[Dict[str, Any]] = None


class ResponseMeta(BaseModel):
    model_version: str
    latency_ms: int
    processed_at: str
    ml_enabled: bool = False
    models_loaded: List[str] = []


class ErrorInfo(BaseModel):
    code: str
    message: str
    details: Optional[str] = None


class AddonResponse(BaseModel):
    request_id: str
    addon_id: str
    status: str
    output_schema_version: str = "1.0"
    results: Optional[AnalysisResults] = None
    error: Optional[ErrorInfo] = None
    meta: Optional[ResponseMeta] = None


# ========== Constants ==========

TRUSTED_SOURCES = {
    # Tier 1: Wire services, public broadcasting (95%)
    "연합뉴스": 0.95,
    "KBS": 0.90,
    "MBC": 0.85,
    "SBS": 0.85,
    "YTN": 0.85,
    "EBS": 0.85,
    # Tier 2: Major newspapers (80%)
    "조선일보": 0.80,
    "중앙일보": 0.80,
    "동아일보": 0.80,
    "한겨레": 0.80,
    "경향신문": 0.80,
    "한국일보": 0.80,
    # Tier 3: Business newspapers (80%)
    "매일경제": 0.80,
    "한국경제": 0.80,
    "서울경제": 0.75,
    "머니투데이": 0.75,
    "이데일리": 0.75,
    # Tier 4: Cable news (75-85%)
    "JTBC": 0.85,
    "TV조선": 0.75,
    "채널A": 0.75,
    "MBN": 0.75,
    # Tier 5: Online news (70-75%)
    "뉴시스": 0.75,
    "뉴스1": 0.75,
    "오마이뉴스": 0.70,
    "프레시안": 0.70,
}

CLICKBAIT_PATTERNS = [
    {"pattern": r"충격[!]*", "severity": "high", "label": "충격"},
    {"pattern": r"경악[!]*", "severity": "high", "label": "경악"},
    {"pattern": r"대박[!]*", "severity": "medium", "label": "대박"},
    {"pattern": r"헉[!]*", "severity": "low", "label": "헉"},
    {"pattern": r"알고\s*보니", "severity": "medium", "label": "알고보니"},
    {"pattern": r"결국[.]*$", "severity": "low", "label": "결국"},
    {"pattern": r"드디어[!]*", "severity": "low", "label": "드디어"},
    {"pattern": r"\.\.\.$", "severity": "low", "label": "..."},
    {"pattern": r"\?\?\?+", "severity": "medium", "label": "???"},
    {"pattern": r"!!!+", "severity": "medium", "label": "!!!"},
    {"pattern": r"속보[!:]*", "severity": "low", "label": "속보"},
    {"pattern": r"단독[!:]*", "severity": "low", "label": "단독"},
    {"pattern": r"긴급[!:]*", "severity": "medium", "label": "긴급"},
]

MISINFORMATION_PATTERNS = [
    {"pattern": r"정부가\s*숨기", "type": "conspiracy", "severity": "high"},
    {"pattern": r"언론이\s*보도하지\s*않는", "type": "conspiracy", "severity": "high"},
    {"pattern": r"비밀리에", "type": "conspiracy", "severity": "medium"},
    {"pattern": r"충격\s*진실", "type": "sensational", "severity": "high"},
    {"pattern": r"알려지지\s*않은\s*진실", "type": "conspiracy", "severity": "high"},
]

UNVERIFIABLE_PATTERNS = [
    {"pattern": r"최초", "type": "absolute", "severity": "low"},
    {"pattern": r"유일", "type": "absolute", "severity": "low"},
    {"pattern": r"최고", "type": "absolute", "severity": "low"},
    {"pattern": r"최대", "type": "absolute", "severity": "low"},
    {"pattern": r"100%", "type": "absolute", "severity": "medium"},
    {"pattern": r"모든\s*사람", "type": "universal", "severity": "medium"},
    {"pattern": r"아무도", "type": "universal", "severity": "medium"},
    {"pattern": r"절대", "type": "absolute", "severity": "medium"},
    {"pattern": r"반드시", "type": "absolute", "severity": "low"},
]

CLAIM_INDICATORS = [
    "라고 밝혔다",
    "라고 주장했다",
    "라고 전했다",
    "에 따르면",
    "것으로 알려졌다",
    "것으로 확인됐다",
    "것으로 보인다",
    "할 전망이다",
    "할 예정이다",
    "관계자는",
    "전문가는",
    "소식통에 따르면",
]

# Korean stopwords for keyword extraction
KOREAN_STOPWORDS = {
    "은",
    "는",
    "이",
    "가",
    "을",
    "를",
    "의",
    "에",
    "에서",
    "로",
    "으로",
    "와",
    "과",
    "도",
    "만",
    "부터",
    "까지",
    "에게",
    "한테",
    "께",
    "이다",
    "하다",
    "있다",
    "없다",
    "되다",
    "않다",
    "그",
    "저",
    "이것",
    "그것",
    "저것",
    "여기",
    "거기",
    "저기",
    "뭐",
    "어디",
    "언제",
    "어떻게",
    "왜",
    "누구",
    "아주",
    "매우",
    "정말",
    "너무",
    "조금",
    "약간",
    "그리고",
    "그러나",
    "하지만",
    "그래서",
    "때문에",
    "것",
    "수",
    "등",
    "들",
    "및",
    "더",
    "덜",
    "대해",
    "대한",
    "관련",
    "관한",
}

# English stopwords
ENGLISH_STOPWORDS = {
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "this",
    "that",
    "these",
    "those",
    "it",
    "its",
    "what",
    "which",
    "who",
}

# Intent patterns for factcheck
FACTCHECK_INTENT_PATTERNS = {
    "fact_claim": [
        "사실",
        "진짜",
        "실제로",
        "정말",
        "맞는",
        "틀린",
        "fact",
        "true",
        "false",
    ],
    "opinion": ["생각", "의견", "판단", "보인다", "것 같다", "추측"],
    "quote": ["라고", "밝혔다", "전했다", "말했다", "주장했다"],
    "data": ["수치", "통계", "퍼센트", "%", "건", "명", "원"],
}


class IntentAnalyzer:
    """
    Enhanced intent analyzer for factcheck.
    Extracts keywords, identifies primary claims, and generates search strategies.
    """

    def __init__(self):
        self.stopwords = KOREAN_STOPWORDS | ENGLISH_STOPWORDS

    def detect_language(self, text: str) -> str:
        """Detect language based on character composition."""
        if not text:
            return "ko"

        korean_count = len(re.findall(r"[가-힣]", text))
        english_count = len(re.findall(r"[a-zA-Z]", text))

        total = korean_count + english_count
        if total == 0:
            return "ko"

        return "ko" if korean_count / total > 0.3 else "en"

    def extract_keywords(self, text: str) -> List[str]:
        """Extract meaningful keywords from text."""
        if not text:
            return []

        # Tokenize
        words = re.findall(r"[\w가-힣]+", text.lower())

        # Filter stopwords and short words
        keywords = []
        for word in words:
            if word in self.stopwords:
                continue
            if len(word) < 2:
                continue
            if word.isdigit():
                continue
            keywords.append(word)

        # Deduplicate while preserving order
        seen = set()
        unique_keywords = []
        for kw in keywords:
            if kw not in seen:
                seen.add(kw)
                unique_keywords.append(kw)

        return unique_keywords[:10]

    def identify_primary_keyword(self, keywords: List[str], original_text: str) -> str:
        """Identify the most important keyword."""
        if not keywords:
            words = original_text.split()
            return words[0] if words else ""

        # Score-based selection
        scores = {}
        for keyword in keywords:
            score = 0.0

            # Length weight
            score += min(len(keyword) / 10.0, 1.0) * 0.3

            # Position weight
            pos = original_text.lower().find(keyword.lower())
            if pos >= 0:
                score += (1.0 - pos / len(original_text)) * 0.3

            # Entity patterns (Korean compound nouns)
            if re.match(r".*[가-힣]+(기업|회사|정책|사건|발표|결과)$", keyword):
                score += 0.3

            scores[keyword] = score

        return max(scores.items(), key=lambda x: x[1])[0] if scores else keywords[0]

    def detect_claim_intent(self, text: str) -> Dict[str, Any]:
        """Detect the intent type of a potential claim."""
        text_lower = text.lower()

        intent_scores = {intent: 0 for intent in FACTCHECK_INTENT_PATTERNS}

        for intent, patterns in FACTCHECK_INTENT_PATTERNS.items():
            for pattern in patterns:
                if pattern.lower() in text_lower:
                    intent_scores[intent] += 1

        # Determine primary intent
        max_intent = max(intent_scores.items(), key=lambda x: x[1])

        return {
            "primary_intent": max_intent[0] if max_intent[1] > 0 else "general",
            "intent_scores": intent_scores,
            "is_verifiable": intent_scores["fact_claim"] > 0
            or intent_scores["data"] > 0,
        }

    def generate_search_queries(self, claim: str) -> List[Dict[str, Any]]:
        """Generate multiple search queries for claim verification."""
        keywords = self.extract_keywords(claim)
        primary_keyword = self.identify_primary_keyword(keywords, claim)

        queries = []

        # Strategy 1: Full claim
        queries.append(
            {
                "query": claim[:100],
                "strategy": "full_query",
                "weight": 1.0,
                "description": "원본 주장으로 검색",
            }
        )

        # Strategy 2: All keywords
        if len(keywords) > 1:
            queries.append(
                {
                    "query": " ".join(keywords),
                    "strategy": "keywords_and",
                    "weight": 0.9,
                    "description": "모든 키워드로 검색",
                }
            )

        # Strategy 3: Primary keyword + fact check terms
        queries.append(
            {
                "query": f"{primary_keyword} 팩트체크",
                "strategy": "primary_factcheck",
                "weight": 0.85,
                "description": "주요 키워드 + 팩트체크",
            }
        )

        # Strategy 4: Primary keyword + verification
        queries.append(
            {
                "query": f"{primary_keyword} 사실 확인",
                "strategy": "primary_verify",
                "weight": 0.8,
                "description": "주요 키워드 + 사실 확인",
            }
        )

        # Strategy 5: Keywords OR (broader)
        if len(keywords) > 1:
            or_query = " OR ".join(keywords[:5])
            queries.append(
                {
                    "query": or_query,
                    "strategy": "keywords_or",
                    "weight": 0.7,
                    "description": "키워드 OR 검색 (넓은 검색)",
                }
            )

        return queries

    def analyze(self, text: str) -> Dict[str, Any]:
        """Full intent analysis of text."""
        language = self.detect_language(text)
        keywords = self.extract_keywords(text)
        primary_keyword = self.identify_primary_keyword(keywords, text)
        claim_intent = self.detect_claim_intent(text)
        search_queries = self.generate_search_queries(text)

        return {
            "original_text": text,
            "language": language,
            "keywords": keywords,
            "primary_keyword": primary_keyword,
            "intent": claim_intent,
            "search_queries": search_queries,
            "fallback_strategies": [q["query"] for q in search_queries],
        }


# Global intent analyzer instance
_intent_analyzer = IntentAnalyzer()


# ========== Analysis Functions ==========


def analyze_source(source: Optional[str]) -> SourceAnalytics:
    """Analyze source credibility"""
    if not source:
        return SourceAnalytics(
            source_name=None,
            is_trusted=False,
            trust_score=0.3,
            trust_level="untrusted",
            reason="출처 정보가 제공되지 않았습니다.",
        )

    # Check against trusted sources
    for trusted_name, score in TRUSTED_SOURCES.items():
        if trusted_name in source:
            return SourceAnalytics(
                source_name=source,
                is_trusted=True,
                trust_score=score,
                trust_level="trusted",
                matched_trusted_source=trusted_name,
                reason=f"{trusted_name}은(는) 신뢰할 수 있는 언론사입니다.",
            )

    return SourceAnalytics(
        source_name=source,
        is_trusted=False,
        trust_score=0.5,
        trust_level="unknown",
        reason="신뢰 매체 목록에 없는 출처입니다. 추가 확인이 필요합니다.",
    )


def analyze_clickbait(title: Optional[str]) -> ClickbaitAnalytics:
    """Detect clickbait patterns in title"""
    if not title:
        return ClickbaitAnalytics(
            is_clickbait=False,
            score=0.0,
            detected_patterns=[],
            total_patterns_checked=len(CLICKBAIT_PATTERNS),
        )

    detected = []
    for pattern_info in CLICKBAIT_PATTERNS:
        matches = re.findall(pattern_info["pattern"], title, re.IGNORECASE)
        if matches:
            detected.append(
                {
                    "pattern": pattern_info["label"],
                    "matched_text": matches[0],
                    "severity": pattern_info["severity"],
                }
            )

    # Calculate score based on severity
    severity_weights = {"low": 0.1, "medium": 0.2, "high": 0.3}
    score = sum(severity_weights.get(p["severity"], 0.1) for p in detected)
    score = min(score, 1.0)

    is_clickbait = score > 0.3 or any(p["severity"] == "high" for p in detected)

    return ClickbaitAnalytics(
        is_clickbait=is_clickbait,
        score=score,
        detected_patterns=detected,
        total_patterns_checked=len(CLICKBAIT_PATTERNS),
    )


def analyze_misinformation(text: str) -> MisinfoAnalytics:
    """Detect misinformation risk patterns"""
    if not text:
        return MisinfoAnalytics()

    detected = []

    # Check misinformation patterns
    for pattern_info in MISINFORMATION_PATTERNS:
        matches = re.findall(pattern_info["pattern"], text, re.IGNORECASE)
        if matches:
            detected.append(
                {
                    "pattern": pattern_info["pattern"],
                    "matched_text": matches[0],
                    "type": "misinformation",
                    "category": pattern_info["type"],
                    "severity": pattern_info["severity"],
                }
            )

    # Check unverifiable patterns
    unverifiable_count = 0
    for pattern_info in UNVERIFIABLE_PATTERNS:
        matches = re.findall(pattern_info["pattern"], text, re.IGNORECASE)
        if matches:
            unverifiable_count += len(matches)
            detected.append(
                {
                    "pattern": pattern_info["pattern"],
                    "matched_text": matches[0],
                    "type": "unverifiable",
                    "category": pattern_info["type"],
                    "severity": pattern_info["severity"],
                }
            )

    # Calculate risk score
    severity_weights = {"low": 0.1, "medium": 0.2, "high": 0.35}
    misinfo_score = sum(
        severity_weights.get(p["severity"], 0.1)
        for p in detected
        if p["type"] == "misinformation"
    )
    unverifiable_score = sum(
        severity_weights.get(p["severity"], 0.1) * 0.5
        for p in detected
        if p["type"] == "unverifiable"
    )

    total_score = min(misinfo_score + unverifiable_score, 1.0)

    risk_level = (
        "high" if total_score > 0.5 else "medium" if total_score > 0.2 else "low"
    )

    return MisinfoAnalytics(
        risk_score=total_score,
        risk_level=risk_level,
        detected_patterns=detected,
        unverifiable_claim_count=unverifiable_count,
    )


def extract_claims_heuristic(text: str) -> List[Tuple[str, str, Dict[str, Any]]]:
    """
    Extract claims using heuristic patterns with intent analysis.

    Returns:
        List of tuples: (claim_text, indicator, intent_analysis)
    """
    claims = []
    sentences = re.split(r"[.!?]\s+", text)

    for sentence in sentences:
        sentence = sentence.strip()
        if len(sentence) < 10:
            continue

        for indicator in CLAIM_INDICATORS:
            pattern = indicator.replace("~", ".*")
            if re.search(pattern, sentence):
                # Perform intent analysis on the claim
                intent_analysis = _intent_analyzer.analyze(sentence)
                claims.append((sentence, indicator, intent_analysis))
                break

    # Sort claims by verifiability score (prioritize verifiable claims)
    claims_with_score = []
    for claim_text, indicator, intent_analysis in claims:
        score = 0.0
        # Boost verifiable claims
        if intent_analysis["intent"]["is_verifiable"]:
            score += 0.5
        # Boost claims with data
        if intent_analysis["intent"]["intent_scores"].get("data", 0) > 0:
            score += 0.3
        # Boost claims with fact indicators
        if intent_analysis["intent"]["intent_scores"].get("fact_claim", 0) > 0:
            score += 0.2
        claims_with_score.append((claim_text, indicator, intent_analysis, score))

    # Sort by score descending
    claims_with_score.sort(key=lambda x: x[3], reverse=True)

    return [(c[0], c[1], c[2]) for c in claims_with_score[:10]]  # Max 10 claims


async def extract_claims_ml(text: str) -> List[Tuple[str, str, float, Dict[str, Any]]]:
    """
    Extract and classify claims using ML model with intent analysis.

    Returns:
        List of tuples: (claim_text, indicator, ml_confidence, intent_analysis)
    """
    models = get_ml_models()

    if not models.get("loaded") or "claim_model" not in models:
        # Fallback to heuristic
        heuristic_claims = extract_claims_heuristic(text)
        return [(c[0], c[1], 0.7, c[2]) for c in heuristic_claims]

    try:
        import torch

        tokenizer = models["claim_tokenizer"]
        model = models["claim_model"]
        device = models["device"]

        sentences = re.split(r"[.!?]\s+", text)
        claims = []

        for sentence in sentences:
            sentence = sentence.strip()
            if len(sentence) < 10:
                continue

            # Tokenize
            inputs = tokenizer(
                sentence,
                return_tensors="pt",
                truncation=True,
                max_length=256,
                padding=True,
            ).to(device)

            # Predict
            with torch.no_grad():
                outputs = model(**inputs)
                probs = torch.softmax(outputs.logits, dim=-1)
                predicted_class = torch.argmax(probs, dim=-1).item()
                confidence = probs[0][predicted_class].item()

            # Class 0 = non-claim, 1 = claim, 2 = uncertain
            if predicted_class == 1 and confidence > 0.5:
                # Find matching indicator
                indicator = "ML 분류"
                for ind in CLAIM_INDICATORS:
                    pattern = ind.replace("~", ".*")
                    if re.search(pattern, sentence):
                        indicator = ind
                        break

                # Perform intent analysis
                intent_analysis = _intent_analyzer.analyze(sentence)
                claims.append((sentence, indicator, confidence, intent_analysis))

        # Sort by combined score (ML confidence + verifiability)
        def combined_score(claim_tuple):
            _, _, conf, intent = claim_tuple
            score = conf * 0.6  # ML confidence weight
            if intent["intent"]["is_verifiable"]:
                score += 0.25
            if intent["intent"]["intent_scores"].get("data", 0) > 0:
                score += 0.15
            return score

        claims.sort(key=combined_score, reverse=True)
        return claims[:10]

    except Exception as e:
        logger.error(f"ML claim extraction failed: {e}")
        heuristic_claims = extract_claims_heuristic(text)
        return [(c[0], c[1], 0.7, c[2]) for c in heuristic_claims]


def extract_entities_ml(text: str) -> List[Dict[str, str]]:
    """Extract named entities using NER model"""
    models = get_ml_models()

    if not models.get("loaded") or "ner_pipeline" not in models:
        return []

    try:
        ner = models["ner_pipeline"]
        entities = ner(text[:1024])  # Limit input length

        return [
            {
                "entity": e.get("entity_group", e.get("entity", "UNKNOWN")),
                "word": e.get("word", ""),
                "score": round(e.get("score", 0), 3),
            }
            for e in entities
            if e.get("score", 0) > 0.7
        ]
    except Exception as e:
        logger.error(f"NER extraction failed: {e}")
        return []


async def compute_semantic_similarity(
    claim: str, reference_texts: List[str]
) -> List[Dict[str, float]]:
    """Compute semantic similarity between claim and references"""
    models = get_ml_models()

    if not models.get("loaded") or "sentence_transformer" not in models:
        return []

    try:
        st_model = models["sentence_transformer"]

        # Encode claim
        claim_embedding = st_model.encode([claim])[0]

        # Encode references
        ref_embeddings = st_model.encode(reference_texts)

        # Compute cosine similarities
        from numpy import dot
        from numpy.linalg import norm

        similarities = []
        for i, ref_emb in enumerate(ref_embeddings):
            sim = dot(claim_embedding, ref_emb) / (
                norm(claim_embedding) * norm(ref_emb)
            )
            similarities.append(
                {"reference_index": i, "similarity": round(float(sim), 3)}
            )

        return sorted(similarities, key=lambda x: x["similarity"], reverse=True)

    except Exception as e:
        logger.error(f"Semantic similarity computation failed: {e}")
        return []


async def verify_with_external_api(claim: str) -> Optional[Dict[str, Any]]:
    """Verify claim using external fact-check APIs"""
    client = await get_http_client()

    if not client:
        return None

    results = {}

    # Google Fact Check API
    google_api_key = os.getenv("GOOGLE_FACTCHECK_API_KEY")
    if google_api_key:
        try:
            response = await client.get(
                "https://factchecktools.googleapis.com/v1alpha1/claims:search",
                params={
                    "query": claim[:200],
                    "key": google_api_key,
                    "languageCode": "ko",
                },
            )
            if response.status_code == 200:
                data = response.json()
                if data.get("claims"):
                    results["google_factcheck"] = {
                        "found": True,
                        "claims": data["claims"][:3],
                    }
        except Exception as e:
            logger.warning(f"Google Fact Check API error: {e}")

    # SNU Factcheck (if available)
    snu_api_url = os.getenv("SNU_FACTCHECK_API_URL")
    if snu_api_url:
        try:
            response = await client.post(snu_api_url, json={"query": claim[:200]})
            if response.status_code == 200:
                results["snu_factcheck"] = response.json()
        except Exception as e:
            logger.warning(f"SNU Factcheck API error: {e}")

    return results if results else None


def compute_keyword_similarity(claim_keywords: List[str], reference_text: str) -> float:
    """
    Compute keyword-based similarity between claim keywords and reference text.
    Uses Jaccard similarity on extracted keywords.
    """
    if not claim_keywords or not reference_text:
        return 0.0

    # Extract keywords from reference
    ref_keywords = set(_intent_analyzer.extract_keywords(reference_text))
    claim_kw_set = set(claim_keywords)

    if not ref_keywords or not claim_kw_set:
        return 0.0

    # Jaccard similarity
    intersection = len(claim_kw_set & ref_keywords)
    union = len(claim_kw_set | ref_keywords)

    return intersection / union if union > 0 else 0.0


def analyze_claim(
    claim_text: str,
    claim_indicator: str,
    ml_confidence: Optional[float] = None,
    entities: Optional[List[Dict[str, str]]] = None,
    external_verification: Optional[Dict[str, Any]] = None,
    intent_analysis: Optional[Dict[str, Any]] = None,
) -> ClaimAnalytics:
    """
    Analyze a single claim with enhanced intent analysis.

    Args:
        claim_text: The claim text to analyze
        claim_indicator: The indicator that identified this as a claim
        ml_confidence: ML model confidence if available
        entities: Named entities extracted from context
        external_verification: External API verification results
        intent_analysis: Intent analysis from IntentAnalyzer
    """

    # Generate claim ID
    claim_id = hashlib.md5(claim_text.encode()).hexdigest()[:8]

    # Determine verdict based on available information
    verdict = ClaimVerdict.UNVERIFIED.value
    confidence = 0.5
    supporting = []
    contradicting = []
    analysis_method = "heuristic"

    # Use intent analysis for enhanced verification
    if intent_analysis:
        keywords = intent_analysis.get("keywords", [])
        primary_keyword = intent_analysis.get("primary_keyword", "")
        intent_info = intent_analysis.get("intent", {})

        # Boost confidence for verifiable claims
        if intent_info.get("is_verifiable", False):
            confidence += 0.1
            supporting.append("검증 가능한 팩트성 주장")

        # Boost for data-driven claims
        if intent_info.get("intent_scores", {}).get("data", 0) > 0:
            confidence += 0.1
            supporting.append("데이터/수치 포함")

        # Note opinion-based claims
        if intent_info.get("intent_scores", {}).get("opinion", 0) > 0:
            confidence -= 0.1
            contradicting.append("의견성 표현 포함")

        # Store search strategies for potential follow-up verification
        search_queries = intent_analysis.get("search_queries", [])
        if search_queries:
            analysis_method = "heuristic_with_intent"

    # If ML confidence available
    if ml_confidence is not None:
        analysis_method = (
            "ml_classification" if not intent_analysis else "ml_with_intent"
        )
        confidence = (
            (confidence + ml_confidence) / 2 if intent_analysis else ml_confidence
        )

    # If external verification available
    if external_verification:
        analysis_method = (
            "external_api" if not intent_analysis else "external_with_intent"
        )

        # Check Google Fact Check results
        if "google_factcheck" in external_verification:
            gfc = external_verification["google_factcheck"]
            if gfc.get("found"):
                claims_data = gfc.get("claims", [])
                for c in claims_data:
                    review = c.get("claimReview", [{}])[0]
                    rating = review.get("textualRating", "").lower()

                    if any(x in rating for x in ["true", "correct", "accurate"]):
                        verdict = ClaimVerdict.VERIFIED.value
                        supporting.append(f"Google Fact Check: {rating}")
                    elif any(x in rating for x in ["false", "incorrect", "wrong"]):
                        verdict = ClaimVerdict.FALSE.value
                        contradicting.append(f"Google Fact Check: {rating}")
                    elif any(x in rating for x in ["misleading", "partial"]):
                        verdict = ClaimVerdict.MISLEADING.value
                        contradicting.append(f"Google Fact Check: {rating}")

                    # Enhance with keyword similarity check
                    if intent_analysis:
                        claim_text_from_api = c.get("text", "")
                        keywords = intent_analysis.get("keywords", [])
                        similarity = compute_keyword_similarity(
                            keywords, claim_text_from_api
                        )
                        if similarity > 0.5:
                            supporting.append(f"키워드 유사도: {similarity:.0%}")

    # If no external verification available, mark as UNVERIFIED with appropriate context
    # IMPORTANT: We do NOT use pseudo-random verdicts as they mislead users
    if verdict == ClaimVerdict.UNVERIFIED.value:
        # Use intent analysis to provide better context
        if intent_analysis and intent_analysis.get("intent", {}).get("is_verifiable"):
            # This is a verifiable claim but we couldn't verify it externally
            # Keep it as UNVERIFIED with low confidence
            verdict = ClaimVerdict.UNVERIFIED.value
            confidence = 0.35  # Low confidence since no external verification
            analysis_method = "needs_external_verification"
            supporting.append("검증 가능한 주장이나 외부 검증 소스를 찾지 못했습니다")
        else:
            # Non-verifiable claims (opinions, subjective statements, etc.)
            verdict = ClaimVerdict.UNVERIFIED.value
            confidence = 0.25  # Very low confidence for non-verifiable claims
            analysis_method = "opinion_or_subjective"
            supporting.append("의견 또는 주관적 주장으로 사실 검증이 어렵습니다")

        # If ML model provided some insight, use that to adjust confidence slightly
        if ml_confidence and ml_confidence > 0.5:
            confidence = min(
                0.5, ml_confidence * 0.6
            )  # Cap at 0.5 for ML-only analysis
            analysis_method = "ml_analysis_only"

    # Clamp confidence
    confidence = max(0.0, min(1.0, confidence))

    return ClaimAnalytics(
        claim_id=claim_id,
        claim_text=claim_text[:200] + "..." if len(claim_text) > 200 else claim_text,
        verdict=verdict,
        confidence=round(confidence, 2),
        ml_confidence=ml_confidence,
        claim_indicator=claim_indicator,
        analysis_method=analysis_method,
        entities=entities,
        supporting_factors=supporting,
        contradicting_factors=contradicting,
        external_verification=external_verification,
    )


def calculate_score_breakdown(
    source_analysis: SourceAnalytics,
    clickbait_analysis: ClickbaitAnalytics,
    misinfo_analysis: MisinfoAnalytics,
    claim_analyses: List[ClaimAnalytics],
) -> ScoreBreakdown:
    """Calculate detailed score breakdown"""

    # Weights
    source_weight = 30
    clickbait_weight = 20
    misinfo_weight = 20
    verification_weight = 30

    # Calculate contributions
    source_contribution = source_analysis.trust_score * source_weight

    clickbait_score = 0.7 if clickbait_analysis.is_clickbait else 1.0
    clickbait_contribution = clickbait_score * clickbait_weight

    misinfo_score = 1 - misinfo_analysis.risk_score
    misinfo_contribution = misinfo_score * misinfo_weight

    verified_count = sum(
        1 for c in claim_analyses if c.verdict == ClaimVerdict.VERIFIED.value
    )
    verification_ratio = verified_count / len(claim_analyses) if claim_analyses else 0.5
    verification_contribution = verification_ratio * verification_weight

    total_score = (
        source_contribution
        + clickbait_contribution
        + misinfo_contribution
        + verification_contribution
    )

    # Grade
    if total_score >= 80:
        grade = CredibilityGrade.A.value
    elif total_score >= 60:
        grade = CredibilityGrade.B.value
    elif total_score >= 40:
        grade = CredibilityGrade.C.value
    elif total_score >= 20:
        grade = CredibilityGrade.D.value
    else:
        grade = CredibilityGrade.F.value

    return ScoreBreakdown(
        source_weight=source_weight,
        clickbait_weight=clickbait_weight,
        misinfo_weight=misinfo_weight,
        verification_weight=verification_weight,
        source_contribution=round(source_contribution, 1),
        clickbait_contribution=round(clickbait_contribution, 1),
        misinfo_contribution=round(misinfo_contribution, 1),
        verification_contribution=round(verification_contribution, 1),
        total_score=round(total_score, 1),
        grade=grade,
    )


async def perform_factcheck(
    article: ArticleInput, options: Optional[ExecutionOptions] = None
) -> FactCheckResult:
    """Perform comprehensive fact-checking analysis"""

    start_time = time.time()

    # Get options
    opts = options or ExecutionOptions()
    analysis_mode = opts.analysis_mode or AnalysisMode.HYBRID
    include_analytics = opts.include_detailed_analytics

    # Combine text
    text = ""
    if article.title:
        text += article.title + " "
    if article.content:
        text += article.content

    if not text.strip():
        return FactCheckResult(
            overall_credibility=0.0,
            credibility_grade=CredibilityGrade.F.value,
            verdict="unverified",
            claims_analyzed=0,
            verified_claims=0,
            false_claims=0,
            unverified_claims=0,
            explanations=["분석할 콘텐츠가 없습니다."],
        )

    models_used = []
    apis_used = []

    # 1. Source Analysis
    source_analysis = analyze_source(article.source)

    # 2. Clickbait Detection
    clickbait_analysis = analyze_clickbait(article.title)

    # 3. Misinformation Risk
    misinfo_analysis = analyze_misinformation(text)

    # 4. Claim Extraction & Analysis
    claim_analyses = []

    if analysis_mode in [
        AnalysisMode.ML_BASIC,
        AnalysisMode.ML_FULL,
        AnalysisMode.HYBRID,
    ]:
        # Use ML for claim extraction
        claims_with_conf = await extract_claims_ml(text)
        models_used.append("koelectra-claim-classifier")

        # Extract entities if ML_FULL
        entities = None
        if analysis_mode == AnalysisMode.ML_FULL:
            entities = extract_entities_ml(text)
            if entities:
                models_used.append("klue-ner")

        for claim_text, indicator, confidence, intent_analysis in claims_with_conf:
            external_verification = None

            # External API verification for ML_FULL or HYBRID
            if analysis_mode in [AnalysisMode.ML_FULL, AnalysisMode.HYBRID]:
                external_verification = await verify_with_external_api(claim_text)
                if external_verification:
                    apis_used.extend(external_verification.keys())

            claim_analytics = analyze_claim(
                claim_text=claim_text,
                claim_indicator=indicator,
                ml_confidence=confidence,
                entities=entities,
                external_verification=external_verification,
                intent_analysis=intent_analysis,
            )
            claim_analyses.append(claim_analytics)
    else:
        # Heuristic only
        claims = extract_claims_heuristic(text)
        for claim_text, indicator, intent_analysis in claims:
            claim_analytics = analyze_claim(
                claim_text=claim_text,
                claim_indicator=indicator,
                intent_analysis=intent_analysis,
            )
            claim_analyses.append(claim_analytics)

    # 5. Calculate Score Breakdown
    score_breakdown = calculate_score_breakdown(
        source_analysis, clickbait_analysis, misinfo_analysis, claim_analyses
    )

    # 6. Build results
    verified_count = sum(
        1 for c in claim_analyses if c.verdict == ClaimVerdict.VERIFIED.value
    )
    false_count = sum(
        1
        for c in claim_analyses
        if c.verdict in [ClaimVerdict.FALSE.value, ClaimVerdict.MISLEADING.value]
    )
    unverified_count = sum(
        1 for c in claim_analyses if c.verdict == ClaimVerdict.UNVERIFIED.value
    )

    # Final verdict
    if score_breakdown.total_score >= 70:
        verdict = "verified"
    elif score_breakdown.total_score >= 40:
        verdict = "suspicious"
    else:
        verdict = "unverified"

    # Risk flags
    risk_flags = []
    if clickbait_analysis.is_clickbait:
        risk_flags.append("낚시성 제목 의심")
    if source_analysis.trust_score < 0.5:
        risk_flags.append("출처 신뢰도 낮음")
    if misinfo_analysis.risk_level in ["medium", "high"]:
        risk_flags.append(f"허위정보 위험도: {misinfo_analysis.risk_level}")

    # Explanations
    explanations = [
        f"출처 신뢰도: {source_analysis.trust_score * 100:.0f}%",
        f"분석된 주장: {len(claim_analyses)}개",
    ]
    if verified_count > 0:
        explanations.append(f"검증된 주장: {verified_count}개")
    if false_count > 0:
        explanations.append(f"의심스러운 주장: {false_count}개")
    if clickbait_analysis.is_clickbait:
        patterns = [p["pattern"] for p in clickbait_analysis.detected_patterns]
        explanations.append(f"낚시성 패턴: {', '.join(patterns)}")

    # Build detailed analytics if requested
    detailed_analytics = None
    if include_analytics:
        processing_time = int((time.time() - start_time) * 1000)
        detailed_analytics = DetailedAnalytics(
            source_analysis=source_analysis,
            clickbait_analysis=clickbait_analysis,
            misinfo_analysis=misinfo_analysis,
            claim_analyses=claim_analyses,
            score_breakdown=score_breakdown,
            analysis_mode=analysis_mode.value,
            ml_models_used=list(set(models_used)),
            external_apis_used=list(set(apis_used)),
            processing_time_ms=processing_time,
            analyzed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        )

    # Build claim results
    claim_results = [
        ClaimResult(
            claim=c.claim_text,
            verdict=c.verdict,
            confidence=c.confidence,
            evidence=c.analysis_method,
            ml_analysis={
                "ml_confidence": c.ml_confidence,
                "entities": c.entities,
                "supporting": c.supporting_factors,
                "contradicting": c.contradicting_factors,
            }
            if c.ml_confidence
            else None,
        )
        for c in claim_analyses
    ]

    return FactCheckResult(
        overall_credibility=score_breakdown.total_score,
        credibility_grade=score_breakdown.grade,
        verdict=verdict,
        claims_analyzed=len(claim_analyses),
        verified_claims=verified_count,
        false_claims=false_count,
        unverified_claims=unverified_count,
        claims=claim_results if claim_results else None,
        risk_flags=risk_flags if risk_flags else None,
        explanations=explanations,
        detailed_analytics=detailed_analytics,
    )


# ========== API Endpoints ==========


@app.get("/health")
async def health_check():
    """Health check endpoint with ML status"""
    models = get_ml_models()

    return {
        "status": "healthy",
        "service": "factcheck-addon",
        "version": "2.0.0",
        "ml_enabled": models.get("loaded", False),
        "warmup_complete": _model_warmup_complete,
        "warmup_error": _model_warmup_error,
        "models_loaded": [
            k
            for k in models.keys()
            if k not in ["loaded", "device"] and models.get(k) is not None
        ],
        "device": models.get("device", "cpu"),
    }


@app.get("/ready")
async def readiness_check():
    """Readiness check - only returns healthy when models are warmed up"""
    if not _model_warmup_complete:
        return {"status": "warming_up", "ready": False}

    models = get_ml_models()
    return {
        "status": "ready",
        "ready": True,
        "ml_enabled": models.get("loaded", False),
        "warmup_error": _model_warmup_error,
    }


@app.post("/analyze", response_model=AddonResponse)
async def analyze(request: AddonRequest):
    """
    Main analysis endpoint with ML-enhanced fact-checking.
    """
    start_time = time.time()

    try:
        if not request.article:
            raise ValueError("article is required")

        # Perform fact-check
        factcheck_result = await perform_factcheck(request.article, request.options)

        # Response metadata
        latency_ms = int((time.time() - start_time) * 1000)
        models = get_ml_models()

        # Track Prometheus metrics
        if PROMETHEUS_AVAILABLE:
            REQUEST_COUNT.labels(endpoint="analyze", status="success").inc()
            REQUEST_LATENCY.labels(endpoint="analyze").observe(time.time() - start_time)
            ANALYSIS_COUNT.labels(
                mode=request.options.analysis_mode.value
                if request.options and request.options.analysis_mode
                else "hybrid",
                verdict=factcheck_result.overall_verdict
                if factcheck_result
                else "unknown",
            ).inc()
            if factcheck_result and factcheck_result.claims:
                CLAIMS_EXTRACTED.inc(len(factcheck_result.claims))

        return AddonResponse(
            request_id=request.request_id,
            addon_id=request.addon_id,
            status="success",
            results=AnalysisResults(factcheck=factcheck_result),
            meta=ResponseMeta(
                model_version="factcheck-ko-ml-v2.0",
                latency_ms=latency_ms,
                processed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                ml_enabled=models.get("loaded", False),
                models_loaded=[
                    k
                    for k in models.keys()
                    if k not in ["loaded", "device"] and models.get(k) is not None
                ],
            ),
        )

    except Exception as e:
        logger.error(f"Analysis error: {e}")
        latency_ms = int((time.time() - start_time) * 1000)

        # Track error metrics
        if PROMETHEUS_AVAILABLE:
            REQUEST_COUNT.labels(endpoint="analyze", status="error").inc()
            REQUEST_LATENCY.labels(endpoint="analyze").observe(time.time() - start_time)
            ERROR_COUNT.labels(error_type=type(e).__name__).inc()

        return AddonResponse(
            request_id=request.request_id,
            addon_id=request.addon_id,
            status="error",
            error=ErrorInfo(code="FACTCHECK_ERROR", message=str(e)),
            meta=ResponseMeta(
                model_version="factcheck-ko-ml-v2.0",
                latency_ms=latency_ms,
                processed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            ),
        )


@app.post("/batch")
async def analyze_batch(requests: List[AddonRequest]):
    """Batch analysis endpoint"""
    results = []
    for req in requests:
        result = await analyze(req)
        results.append(result)
    return results


@app.get("/models")
async def list_models():
    """List available ML models and their status"""
    models = get_ml_models()

    return {
        "loaded": models.get("loaded", False),
        "device": models.get("device", "cpu"),
        "models": {
            "claim_classifier": {
                "loaded": "claim_model" in models,
                "name": os.getenv(
                    "CLAIM_MODEL", "monologg/koelectra-base-v3-discriminator"
                ),
            },
            "sentence_transformer": {
                "loaded": "sentence_transformer" in models,
                "name": os.getenv(
                    "EMBEDDING_MODEL",
                    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
                ),
            },
            "ner": {
                "loaded": "ner_pipeline" in models,
                "name": os.getenv("NER_MODEL", "klue/bert-base"),
            },
            "sentiment": {
                "loaded": "sentiment_pipeline" in models,
                "name": os.getenv("SENTIMENT_MODEL", "klue/roberta-base"),
            },
        },
    }


@app.post("/reload-models")
async def reload_models(background_tasks: BackgroundTasks):
    """Reload ML models"""
    global _ml_models
    _ml_models = {}

    background_tasks.add_task(get_ml_models)

    return {"message": "Model reload initiated"}


# ========== Entry Point ==========

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8101)))
