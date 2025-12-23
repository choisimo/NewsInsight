"""
Bot Detection Service - AI/봇 텍스트 탐지 및 사용자 포렌식 서비스

기능:
1. AI 생성 텍스트 탐지 (GPT, Claude 등)
2. 봇 행동 패턴 분석 (시간, 반복, 활동량)
3. 사용자 프로필 업데이트
"""

import os
import sys
import re
import math
import hashlib
import time
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
from collections import Counter

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
        track_request_time,
        track_operation,
        track_error,
        track_item_processed,
        ServiceMetrics,
    )

    METRICS_AVAILABLE = True
except ImportError:
    METRICS_AVAILABLE = False

# Lazy imports for ML models
log = structlog.get_logger()

# ============================================
# Configuration
# ============================================


class Settings(BaseSettings):
    """Application settings"""

    database_url: str = Field(default="postgresql://osint:osint@postgres:5432/osint")
    model_name: str = Field(default="roberta-base-openai-detector")
    cache_ttl: int = Field(default=3600)
    min_text_length: int = Field(default=50)
    bot_threshold: float = Field(default=0.7)

    # Pattern detection thresholds
    max_posts_per_minute: int = Field(default=3)
    max_posts_per_hour: int = Field(default=30)
    repetition_threshold: float = Field(default=0.8)

    class Config:
        env_prefix = "BOT_DETECTOR_"


settings = Settings()

# ============================================
# Request/Response Models
# ============================================


class BotDetectionRequest(BaseModel):
    """봇 탐지 요청"""

    content_id: Optional[str] = None
    text: str
    author: Optional[str] = None
    source_id: Optional[str] = None
    timestamp: Optional[datetime] = None
    user_hash: Optional[str] = None


class BotDetectionResponse(BaseModel):
    """봇 탐지 결과"""

    is_bot: bool
    confidence: float
    detection_model: str
    detection_reasons: List[str]
    pattern_flags: Dict[str, Any]
    perplexity: Optional[float] = None
    burstiness: Optional[float] = None
    repetition_rate: Optional[float] = None


class BatchDetectionRequest(BaseModel):
    """배치 봇 탐지 요청"""

    items: List[BotDetectionRequest]


class BatchDetectionResponse(BaseModel):
    """배치 봇 탐지 결과"""

    results: List[BotDetectionResponse]
    total: int
    bot_count: int


class UserProfileUpdateRequest(BaseModel):
    """사용자 프로필 업데이트 요청"""

    user_hash: str
    source_id: Optional[str] = None
    display_name: Optional[str] = None
    activity_timestamps: List[datetime] = []
    contents: List[str] = []


class UserProfileResponse(BaseModel):
    """사용자 프로필 응답"""

    user_hash: str
    bot_probability: float
    troll_score: float
    credibility_score: float
    activity_pattern: Dict[str, Any]
    writing_style: Dict[str, Any]


class AddonArticleInput(BaseModel):
    id: Optional[int] = None
    title: Optional[str] = None
    content: Optional[str] = None
    url: Optional[str] = None
    source: Optional[str] = None
    published_at: Optional[str] = None


class AddonCommentItem(BaseModel):
    id: Optional[str] = None
    content: Optional[str] = None
    created_at: Optional[str] = None
    likes: Optional[int] = None
    replies: Optional[int] = None
    author_id: Optional[str] = None


class AddonCommentsInput(BaseModel):
    article_id: Optional[int] = None
    items: Optional[List[AddonCommentItem]] = None
    platform: Optional[str] = None


class AddonRequest(BaseModel):
    request_id: str
    addon_id: str
    task: str = "article_analysis"
    input_schema_version: str = "1.0"
    article: Optional[AddonArticleInput] = None
    comments: Optional[AddonCommentsInput] = None
    context: Optional[Dict[str, Any]] = None
    options: Optional[Dict[str, Any]] = None


class AddonDiscussionResult(BaseModel):
    overall_sentiment: Optional[str] = None
    sentiment_distribution: Optional[Dict[str, float]] = None
    stance_distribution: Optional[Dict[str, float]] = None
    toxicity_score: Optional[float] = None
    top_keywords: Optional[List[Dict[str, Any]]] = None
    time_series: Optional[List[Dict[str, Any]]] = None
    bot_likelihood: Optional[float] = None


class AddonAnalysisResults(BaseModel):
    discussion: Optional[AddonDiscussionResult] = None
    raw: Optional[Dict[str, Any]] = None


class AddonResponse(BaseModel):
    request_id: str
    addon_id: str
    status: str
    output_schema_version: str = "1.0"
    results: Optional[AddonAnalysisResults] = None
    error: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None


# ============================================
# Bot Detection Service
# ============================================


class BotDetectionService:
    """AI 봇 탐지 서비스"""

    def __init__(self):
        self._model = None
        self._tokenizer = None
        self._model_loaded = False
        self._cache = TTLCache(maxsize=10000, ttl=settings.cache_ttl)

    def _load_model(self):
        """모델 lazy loading"""
        if self._model_loaded:
            return

        try:
            from transformers import AutoModelForSequenceClassification, AutoTokenizer
            import torch

            log.info("Loading bot detection model", model=settings.model_name)

            self._tokenizer = AutoTokenizer.from_pretrained(settings.model_name)
            self._model = AutoModelForSequenceClassification.from_pretrained(
                settings.model_name
            )

            # GPU 사용 가능하면 사용
            if torch.cuda.is_available():
                self._model = self._model.cuda()

            self._model.eval()
            self._model_loaded = True
            log.info("Bot detection model loaded successfully")

        except Exception as e:
            log.error("Failed to load bot detection model", error=str(e))
            self._model_loaded = False

    def _compute_text_hash(self, text: str) -> str:
        """텍스트 해시 생성"""
        return hashlib.sha256(text.encode()).hexdigest()[:16]

    def detect_bot(self, request: BotDetectionRequest) -> BotDetectionResponse:
        """봇 탐지 메인 함수"""
        text = request.text.strip()
        reasons = []
        pattern_flags = {}

        # 캐시 확인
        text_hash = self._compute_text_hash(text)
        if text_hash in self._cache:
            return self._cache[text_hash]

        # 1. 텍스트 길이 확인
        if len(text) < settings.min_text_length:
            return BotDetectionResponse(
                is_bot=False,
                confidence=0.0,
                detection_model="rule_based",
                detection_reasons=["text_too_short"],
                pattern_flags={"text_length": len(text)},
            )

        # 2. 패턴 기반 탐지
        pattern_score, pattern_reasons, pattern_details = self._pattern_based_detection(
            text
        )
        reasons.extend(pattern_reasons)
        pattern_flags.update(pattern_details)

        # 3. ML 모델 기반 탐지
        ml_score = 0.0
        perplexity = None
        burstiness = None

        try:
            self._load_model()
            if self._model_loaded:
                ml_score = self._ml_based_detection(text)
                perplexity = self._calculate_perplexity(text)
                burstiness = self._calculate_burstiness(text)

                if ml_score > 0.7:
                    reasons.append("ml_model_high_confidence")
                if perplexity and perplexity < 20:
                    reasons.append("low_perplexity_suspicious")
                if burstiness and burstiness < 0.3:
                    reasons.append("low_burstiness_suspicious")
        except Exception as e:
            log.warning("ML detection failed", error=str(e))

        # 4. 최종 점수 계산 (가중 평균)
        if self._model_loaded:
            final_score = (pattern_score * 0.4) + (ml_score * 0.6)
        else:
            final_score = pattern_score

        # 5. 반복률 계산
        repetition_rate = self._calculate_repetition_rate(text)
        if repetition_rate > settings.repetition_threshold:
            reasons.append("high_repetition_rate")
            pattern_flags["repetition_rate"] = repetition_rate
            final_score = max(final_score, 0.6)

        result = BotDetectionResponse(
            is_bot=final_score >= settings.bot_threshold,
            confidence=round(final_score, 4),
            detection_model="hybrid" if self._model_loaded else "rule_based",
            detection_reasons=reasons,
            pattern_flags=pattern_flags,
            perplexity=perplexity,
            burstiness=burstiness,
            repetition_rate=repetition_rate,
        )

        # 캐시 저장
        self._cache[text_hash] = result
        return result

    def _pattern_based_detection(self, text: str) -> tuple:
        """패턴 기반 봇 탐지"""
        score = 0.0
        reasons = []
        details = {}

        # 1. 이모지 과다 사용
        emoji_pattern = re.compile(
            r"[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF\U0001F700-\U0001F77F\U0001F780-\U0001F7FF\U0001F800-\U0001F8FF\U0001F900-\U0001F9FF\U0001FA00-\U0001FA6F\U0001FA70-\U0001FAFF\U00002702-\U000027B0\U000024C2-\U0001F251]"
        )
        emoji_count = len(emoji_pattern.findall(text))
        emoji_ratio = emoji_count / max(len(text.split()), 1)
        if emoji_ratio > 0.3:
            score += 0.2
            reasons.append("excessive_emoji_usage")
            details["emoji_ratio"] = emoji_ratio

        # 2. URL 스팸
        url_pattern = re.compile(r"https?://\S+")
        url_count = len(url_pattern.findall(text))
        if url_count > 3:
            score += 0.3
            reasons.append("multiple_urls")
            details["url_count"] = url_count

        # 3. 반복적인 구문
        words = text.lower().split()
        if len(words) > 5:
            word_freq = Counter(words)
            max_repeat = max(word_freq.values())
            if max_repeat / len(words) > 0.3:
                score += 0.2
                reasons.append("repetitive_words")
                details["max_word_repeat_ratio"] = max_repeat / len(words)

        # 4. 너무 완벽한 문장 (AI 특성)
        # 마침표, 쉼표 등이 규칙적으로 배치된 경우
        sentences = re.split(r"[.!?]", text)
        if len(sentences) > 3:
            sentence_lengths = [len(s.split()) for s in sentences if s.strip()]
            if sentence_lengths:
                avg_len = sum(sentence_lengths) / len(sentence_lengths)
                variance = sum((l - avg_len) ** 2 for l in sentence_lengths) / len(
                    sentence_lengths
                )
                std_dev = math.sqrt(variance) if variance > 0 else 0
                # 너무 일관된 문장 길이는 AI 의심
                if std_dev < 2 and len(sentence_lengths) > 3:
                    score += 0.15
                    reasons.append("uniform_sentence_length")
                    details["sentence_length_std"] = std_dev

        # 5. 특정 봇 키워드 패턴
        bot_keywords = [
            r"ai\s+assistant",
            r"as\s+an\s+ai",
            r"i\'m\s+here\s+to\s+help",
            r"대화형\s+인공지능",
            r"AI\s+언어\s+모델",
        ]
        for pattern in bot_keywords:
            if re.search(pattern, text, re.IGNORECASE):
                score += 0.4
                reasons.append("bot_keyword_detected")
                details["bot_keyword_pattern"] = pattern
                break

        return min(score, 1.0), reasons, details

    def _ml_based_detection(self, text: str) -> float:
        """ML 모델 기반 AI 텍스트 탐지"""
        if not self._model_loaded:
            return 0.0

        try:
            import torch

            # 토큰화
            inputs = self._tokenizer(
                text, return_tensors="pt", truncation=True, max_length=512
            )

            # GPU로 이동
            if torch.cuda.is_available():
                inputs = {k: v.cuda() for k, v in inputs.items()}

            # 추론
            with torch.no_grad():
                outputs = self._model(**inputs)
                probs = torch.softmax(outputs.logits, dim=-1)

            # AI 생성 확률 (모델에 따라 인덱스가 다를 수 있음)
            # roberta-base-openai-detector: label 1 = AI generated
            ai_prob = probs[0][1].item()
            return ai_prob

        except Exception as e:
            log.error("ML detection error", error=str(e))
            return 0.0

    def _calculate_perplexity(self, text: str) -> Optional[float]:
        """텍스트 Perplexity 계산 (간단한 근사)"""
        try:
            # 단어 빈도 기반 간단한 perplexity 근사
            words = text.lower().split()
            if len(words) < 5:
                return None

            word_freq = Counter(words)
            total = len(words)

            # 엔트로피 계산
            entropy = 0
            for count in word_freq.values():
                prob = count / total
                if prob > 0:
                    entropy -= prob * math.log2(prob)

            # Perplexity = 2^entropy
            perplexity = 2**entropy
            return round(perplexity, 2)

        except Exception:
            return None

    def _calculate_burstiness(self, text: str) -> Optional[float]:
        """텍스트 Burstiness 계산"""
        try:
            # 문장 길이의 변동성으로 burstiness 근사
            sentences = re.split(r"[.!?]", text)
            sentence_lengths = [len(s.split()) for s in sentences if s.strip()]

            if len(sentence_lengths) < 3:
                return None

            mean_len = sum(sentence_lengths) / len(sentence_lengths)
            if mean_len == 0:
                return None

            variance = sum((l - mean_len) ** 2 for l in sentence_lengths) / len(
                sentence_lengths
            )
            std_dev = math.sqrt(variance)

            # 정규화된 burstiness (0~1, 높을수록 변동성 높음)
            burstiness = (
                std_dev / (std_dev + mean_len) if (std_dev + mean_len) > 0 else 0
            )
            return round(burstiness, 4)

        except Exception:
            return None

    def _calculate_repetition_rate(self, text: str) -> float:
        """텍스트 내 반복률 계산"""
        try:
            words = text.lower().split()
            if len(words) < 5:
                return 0.0

            unique_words = set(words)
            repetition_rate = 1 - (len(unique_words) / len(words))
            return round(repetition_rate, 4)

        except Exception:
            return 0.0


# ============================================
# User Forensics Service
# ============================================


class UserForensicsService:
    """사용자 포렌식 서비스"""

    def __init__(self, bot_detector: BotDetectionService):
        self.bot_detector = bot_detector

    def analyze_user_activity(
        self, request: UserProfileUpdateRequest
    ) -> UserProfileResponse:
        """사용자 활동 분석 및 프로필 업데이트"""

        # 1. 활동 패턴 분석
        activity_pattern = self._analyze_activity_pattern(request.activity_timestamps)

        # 2. 작문 스타일 분석
        writing_style = self._analyze_writing_style(request.contents)

        # 3. 봇 확률 계산
        bot_probability = self._calculate_bot_probability(
            activity_pattern, writing_style, request.contents
        )

        # 4. 트롤 점수 계산
        troll_score = self._calculate_troll_score(writing_style)

        # 5. 신뢰도 점수 계산
        credibility_score = 1.0 - (bot_probability * 0.6 + troll_score * 0.4)

        return UserProfileResponse(
            user_hash=request.user_hash,
            bot_probability=round(bot_probability, 4),
            troll_score=round(troll_score, 4),
            credibility_score=round(max(0, credibility_score), 4),
            activity_pattern=activity_pattern,
            writing_style=writing_style,
        )

    def _analyze_activity_pattern(self, timestamps: List[datetime]) -> Dict[str, Any]:
        """활동 패턴 분석"""
        if not timestamps:
            return {}

        pattern = {
            "total_activities": len(timestamps),
            "hour_distribution": {},
            "is_24h_active": False,
            "avg_interval_seconds": 0,
            "suspicious_burst": False,
        }

        # 시간대별 분포
        hours = [ts.hour for ts in timestamps]
        hour_dist = Counter(hours)
        pattern["hour_distribution"] = dict(hour_dist)

        # 24시간 활동 여부 (봇 의심)
        active_hours = len(hour_dist)
        pattern["is_24h_active"] = active_hours >= 20

        # 활동 간격 분석
        if len(timestamps) > 1:
            sorted_ts = sorted(timestamps)
            intervals = [
                (sorted_ts[i + 1] - sorted_ts[i]).total_seconds()
                for i in range(len(sorted_ts) - 1)
            ]
            avg_interval = sum(intervals) / len(intervals)
            pattern["avg_interval_seconds"] = round(avg_interval, 2)

            # 1분 이내 연속 활동이 많으면 봇 의심
            burst_count = sum(1 for i in intervals if i < 60)
            pattern["suspicious_burst"] = burst_count > len(intervals) * 0.3

        return pattern

    def _analyze_writing_style(self, contents: List[str]) -> Dict[str, Any]:
        """작문 스타일 분석"""
        if not contents:
            return {}

        style = {
            "avg_length": 0,
            "vocabulary_diversity": 0,
            "sentiment_variance": 0,
            "formality_score": 0,
            "aggression_score": 0,
        }

        # 평균 길이
        lengths = [len(c) for c in contents]
        style["avg_length"] = round(sum(lengths) / len(lengths), 2)

        # 어휘 다양성
        all_words = []
        for content in contents:
            all_words.extend(content.lower().split())
        if all_words:
            unique_ratio = len(set(all_words)) / len(all_words)
            style["vocabulary_diversity"] = round(unique_ratio, 4)

        # 공격성 점수 (간단한 키워드 기반)
        aggressive_keywords = [
            "바보",
            "멍청",
            "꺼져",
            "죽어",
            "쓰레기",
            "놈",
            "년",
            "병신",
            "새끼",
        ]
        all_text = " ".join(contents).lower()
        aggression_count = sum(1 for kw in aggressive_keywords if kw in all_text)
        style["aggression_score"] = min(aggression_count / max(len(contents), 1), 1.0)

        return style

    def _calculate_bot_probability(
        self,
        activity_pattern: Dict[str, Any],
        writing_style: Dict[str, Any],
        contents: List[str],
    ) -> float:
        """봇 확률 종합 계산"""
        score = 0.0

        # 활동 패턴 기반
        if activity_pattern.get("is_24h_active"):
            score += 0.3
        if activity_pattern.get("suspicious_burst"):
            score += 0.25
        avg_interval = activity_pattern.get("avg_interval_seconds", 1000)
        if avg_interval < 30:  # 30초 미만 평균 간격
            score += 0.2

        # 작문 스타일 기반
        vocab_div = writing_style.get("vocabulary_diversity", 0.5)
        if vocab_div < 0.3:  # 낮은 어휘 다양성
            score += 0.15

        # 콘텐츠 ML 분석
        if contents:
            sample_contents = contents[:10]  # 최대 10개만 분석
            ml_scores = []
            for content in sample_contents:
                if len(content) >= settings.min_text_length:
                    result = self.bot_detector.detect_bot(
                        BotDetectionRequest(text=content)
                    )
                    ml_scores.append(result.confidence)
            if ml_scores:
                avg_ml_score = sum(ml_scores) / len(ml_scores)
                score += avg_ml_score * 0.3

        return min(score, 1.0)

    def _calculate_troll_score(self, writing_style: Dict[str, Any]) -> float:
        """트롤 점수 계산"""
        score = 0.0

        # 공격성 기반
        aggression = writing_style.get("aggression_score", 0)
        score += aggression * 0.7

        # 짧은 글 위주 (트롤 특성)
        avg_length = writing_style.get("avg_length", 100)
        if avg_length < 50:
            score += 0.2

        return min(score, 1.0)


# ============================================
# FastAPI Application
# ============================================

app = FastAPI(
    title="Bot Detection Service",
    description="AI 봇 탐지 및 사용자 포렌식 서비스",
    version="1.0.0",
)

# Setup Prometheus metrics
SERVICE_NAME = "bot-detector"
if METRICS_AVAILABLE:
    setup_metrics(app, SERVICE_NAME, version="1.0.0")
    service_metrics = ServiceMetrics(SERVICE_NAME)
    # Create service-specific metrics
    detections_total = service_metrics.create_counter(
        "detections_total",
        "Total bot detection requests",
        ["result", "detection_model"],
    )
    detection_confidence = service_metrics.create_histogram(
        "detection_confidence",
        "Bot detection confidence distribution",
        ["result"],
        buckets=(0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0),
    )
    user_analyses = service_metrics.create_counter(
        "user_analyses_total", "Total user profile analyses", ["status"]
    )
    log.info("Prometheus metrics enabled for bot-detector service")
else:
    service_metrics = None
    log.warning("Prometheus metrics not available - shared module not found")

# 서비스 인스턴스
bot_detector = BotDetectionService()
user_forensics = UserForensicsService(bot_detector)


@app.get("/health")
async def health_check():
    """헬스 체크"""
    return {
        "status": "healthy",
        "model_loaded": bot_detector._model_loaded,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/detect", response_model=BotDetectionResponse)
async def detect_bot(request: BotDetectionRequest):
    """단일 텍스트 봇 탐지"""
    try:
        return bot_detector.detect_bot(request)
    except Exception as e:
        log.error("Bot detection failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze", response_model=AddonResponse)
async def analyze_addon(request: AddonRequest):
    start_time = time.time()
    try:
        texts: List[str] = []
        if request.comments and request.comments.items:
            for item in request.comments.items:
                if item.content:
                    texts.append(item.content)

        if not texts and request.article:
            parts: List[str] = []
            if request.article.title:
                parts.append(request.article.title)
            if request.article.content:
                parts.append(request.article.content)
            merged = "\n".join(parts).strip()
            if merged:
                texts = [merged]

        results: List[BotDetectionResponse] = []
        confidences: List[float] = []
        reasons_set: set[str] = set()
        merged_flags: Dict[str, Any] = {}

        for text in texts:
            r = bot_detector.detect_bot(BotDetectionRequest(text=text))
            results.append(r)
            confidences.append(float(r.confidence))
            for reason in r.detection_reasons:
                reasons_set.add(reason)
            for k, v in r.pattern_flags.items():
                if k not in merged_flags:
                    merged_flags[k] = v

        avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0
        latency_ms = int((time.time() - start_time) * 1000)

        return AddonResponse(
            request_id=request.request_id,
            addon_id=request.addon_id,
            status="success",
            results=AddonAnalysisResults(
                discussion=AddonDiscussionResult(
                    bot_likelihood=round(avg_confidence, 4),
                ),
                raw={
                    "total": len(results),
                    "avg_confidence": round(avg_confidence, 4),
                    "detection_reasons": sorted(reasons_set),
                    "pattern_flags": merged_flags,
                },
            ),
            meta={
                "model_version": settings.model_name,
                "latency_ms": latency_ms,
                "processed_at": datetime.now(timezone.utc).isoformat(),
            },
        )
    except Exception as e:
        log.error("Addon analyze failed", error=str(e))
        return AddonResponse(
            request_id=request.request_id,
            addon_id=request.addon_id,
            status="error",
            error={"code": "BOT_DETECTOR_ERROR", "message": str(e)},
            meta={
                "model_version": settings.model_name,
                "latency_ms": int((time.time() - start_time) * 1000),
                "processed_at": datetime.now(timezone.utc).isoformat(),
            },
        )


@app.post("/detect/batch", response_model=BatchDetectionResponse)
async def detect_bot_batch(request: BatchDetectionRequest):
    """배치 봇 탐지"""
    try:
        results = []
        bot_count = 0

        for item in request.items:
            result = bot_detector.detect_bot(item)
            results.append(result)
            if result.is_bot:
                bot_count += 1

        return BatchDetectionResponse(
            results=results, total=len(results), bot_count=bot_count
        )
    except Exception as e:
        log.error("Batch detection failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/user/analyze", response_model=UserProfileResponse)
async def analyze_user(request: UserProfileUpdateRequest):
    """사용자 활동 분석"""
    try:
        return user_forensics.analyze_user_activity(request)
    except Exception as e:
        log.error("User analysis failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/preload-model")
async def preload_model():
    """ML 모델 사전 로딩"""
    try:
        bot_detector._load_model()
        return {"status": "success", "model_loaded": bot_detector._model_loaded}
    except Exception as e:
        log.error("Model preload failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# Main
# ============================================

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8040)
