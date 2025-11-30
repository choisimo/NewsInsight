"""
ML Add-on Server: Bias Analysis

NewsInsight ML Add-on 시스템의 편향도 분석 구현.
뉴스 기사의 정치적/이념적 편향성을 분석합니다.
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, List, Any
import time
import re

app = FastAPI(
    title="Bias Analysis Add-on",
    description="Korean news article political/ideological bias analysis for NewsInsight",
    version="1.0.0"
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

class ToneAnalysis(BaseModel):
    objectivity_score: float  # 0-1, 1 = 매우 객관적
    emotional_language: float  # 0-1, 1 = 감정적 표현 많음
    loaded_words_count: int
    examples: Optional[List[str]] = None

class SourceBias(BaseModel):
    source_name: Optional[str] = None
    known_lean: Optional[str] = None  # left, center-left, center, center-right, right
    ownership_info: Optional[str] = None

class BiasResult(BaseModel):
    overall_bias_score: float  # -1 (진보) ~ 1 (보수)
    bias_label: str  # far_left, left, center_left, center, center_right, right, far_right
    confidence: float  # 0-1
    political_lean: str  # progressive, moderate, conservative
    indicators: Optional[List[BiasIndicator]] = None
    tone_analysis: Optional[ToneAnalysis] = None
    source_bias: Optional[SourceBias] = None
    framing_notes: Optional[List[str]] = None
    explanations: Optional[List[str]] = None

class AnalysisResults(BaseModel):
    bias: Optional[BiasResult] = None
    raw: Optional[Dict[str, Any]] = None

class ResponseMeta(BaseModel):
    model_version: str
    latency_ms: int
    processed_at: str

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

# ========== Bias Analysis Logic ==========

# 언론사 정치 성향 (일반적 인식 기준, 실제로는 더 세밀한 분석 필요)
SOURCE_BIAS_MAP = {
    # 진보 성향
    "한겨레": {"lean": "left", "score": -0.6},
    "경향신문": {"lean": "center-left", "score": -0.4},
    "오마이뉴스": {"lean": "left", "score": -0.7},
    "프레시안": {"lean": "left", "score": -0.7},
    
    # 중도
    "연합뉴스": {"lean": "center", "score": 0.0},
    "KBS": {"lean": "center", "score": 0.0},
    "MBC": {"lean": "center-left", "score": -0.2},
    "SBS": {"lean": "center", "score": 0.0},
    "JTBC": {"lean": "center-left", "score": -0.2},
    "YTN": {"lean": "center", "score": 0.0},
    
    # 보수 성향
    "조선일보": {"lean": "right", "score": 0.6},
    "동아일보": {"lean": "center-right", "score": 0.4},
    "중앙일보": {"lean": "center-right", "score": 0.3},
    "매일경제": {"lean": "center-right", "score": 0.3},
    "한국경제": {"lean": "right", "score": 0.5},
    "TV조선": {"lean": "right", "score": 0.7},
    "채널A": {"lean": "right", "score": 0.6},
    "MBN": {"lean": "center-right", "score": 0.4},
}

# 진보 성향 키워드/표현
PROGRESSIVE_KEYWORDS = [
    ("복지", 0.3), ("노동자 권리", 0.5), ("환경", 0.2), ("평등", 0.4),
    ("인권", 0.3), ("진보", 0.6), ("민주화", 0.4), ("시민단체", 0.3),
    ("재벌 개혁", 0.5), ("사회 정의", 0.4), ("최저임금", 0.3),
    ("공공성", 0.3), ("노동조합", 0.4), ("비정규직", 0.3),
    ("부유세", 0.5), ("공정경제", 0.3), ("대북 화해", 0.4)
]

# 보수 성향 키워드/표현
CONSERVATIVE_KEYWORDS = [
    ("안보", 0.3), ("자유시장", 0.4), ("규제 완화", 0.4), ("전통", 0.3),
    ("보수", 0.6), ("국가 안보", 0.4), ("한미동맹", 0.3), ("기업 친화", 0.4),
    ("성장", 0.2), ("법질서", 0.3), ("애국", 0.4), ("반공", 0.6),
    ("자유민주주의", 0.3), ("대북 강경", 0.4), ("북핵", 0.3),
    ("기업규제 완화", 0.4), ("시장경제", 0.3)
]

# 편향된 프레이밍 표현
FRAMING_PATTERNS = {
    "left": [
        (r"민중", "진보적 프레이밍"),
        (r"사회적\s*약자", "진보적 관점"),
        (r"불평등\s*심화", "불평등 강조"),
        (r"재벌\s*특혜", "대기업 비판적"),
        (r"노동\s*착취", "노동자 권익 강조"),
    ],
    "right": [
        (r"종북", "보수적 프레이밍"),
        (r"안보\s*위협", "안보 강조"),
        (r"경제\s*성장", "성장 중심"),
        (r"시장\s*원리", "시장주의적 관점"),
        (r"규제\s*폐해", "규제 비판적"),
    ]
}

# 감정적/편향적 수식어
LOADED_WORDS = {
    "left": ["착취", "불의", "특권층", "기득권", "차별", "탄압"],
    "right": ["종북", "좌파", "선동", "매국", "폭력", "과격"],
    "emotional": ["충격적", "경악", "황당", "기막힌", "어처구니", "분노"]
}


def get_source_bias(source: Optional[str]) -> SourceBias:
    """언론사 기반 편향 정보 반환"""
    if not source:
        return SourceBias()
    
    for name, info in SOURCE_BIAS_MAP.items():
        if name in source:
            return SourceBias(
                source_name=name,
                known_lean=info["lean"]
            )
    
    return SourceBias(source_name=source, known_lean="unknown")


def analyze_keyword_bias(text: str) -> tuple[float, List[BiasIndicator]]:
    """키워드 기반 편향 분석"""
    if not text:
        return 0.0, []
    
    indicators = []
    progressive_score = 0.0
    conservative_score = 0.0
    
    text_lower = text.lower()
    
    # 진보 키워드 분석
    for keyword, weight in PROGRESSIVE_KEYWORDS:
        if keyword in text_lower:
            progressive_score += weight
            indicators.append(BiasIndicator(
                phrase=keyword,
                bias_type="political",
                direction="left",
                weight=weight
            ))
    
    # 보수 키워드 분석
    for keyword, weight in CONSERVATIVE_KEYWORDS:
        if keyword in text_lower:
            conservative_score += weight
            indicators.append(BiasIndicator(
                phrase=keyword,
                bias_type="political",
                direction="right",
                weight=weight
            ))
    
    # 점수 정규화 (-1 ~ 1)
    total = progressive_score + conservative_score
    if total == 0:
        return 0.0, indicators
    
    bias_score = (conservative_score - progressive_score) / max(total, 1)
    return bias_score, indicators


def analyze_framing(text: str) -> tuple[float, List[str]]:
    """프레이밍 분석"""
    if not text:
        return 0.0, []
    
    notes = []
    left_count = 0
    right_count = 0
    
    for pattern, note in FRAMING_PATTERNS["left"]:
        if re.search(pattern, text):
            left_count += 1
            notes.append(f"[진보] {note}")
    
    for pattern, note in FRAMING_PATTERNS["right"]:
        if re.search(pattern, text):
            right_count += 1
            notes.append(f"[보수] {note}")
    
    total = left_count + right_count
    if total == 0:
        return 0.0, notes
    
    framing_bias = (right_count - left_count) / total
    return framing_bias, notes


def analyze_tone(text: str) -> ToneAnalysis:
    """톤/어조 분석"""
    if not text:
        return ToneAnalysis(
            objectivity_score=0.5,
            emotional_language=0.0,
            loaded_words_count=0
        )
    
    loaded_count = 0
    examples = []
    
    # 편향적 단어 카운트
    for direction, words in LOADED_WORDS.items():
        for word in words:
            count = text.count(word)
            if count > 0:
                loaded_count += count
                examples.append(word)
    
    # 감정적 표현 비율 추정
    emotional_score = min(loaded_count / 10, 1.0)
    objectivity_score = 1.0 - emotional_score
    
    return ToneAnalysis(
        objectivity_score=round(objectivity_score, 2),
        emotional_language=round(emotional_score, 2),
        loaded_words_count=loaded_count,
        examples=examples[:5] if examples else None
    )


def score_to_label(score: float) -> tuple[str, str]:
    """
    편향 점수를 레이블로 변환
    Returns: (bias_label, political_lean)
    """
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


def perform_bias_analysis(article: ArticleInput) -> BiasResult:
    """기사 편향도 분석 수행"""
    text = ""
    if article.title:
        text += article.title + " "
    if article.content:
        text += article.content
    
    if not text.strip():
        return BiasResult(
            overall_bias_score=0.0,
            bias_label="center",
            confidence=0.0,
            political_lean="unknown",
            explanations=["분석할 콘텐츠 없음"]
        )
    
    # 1. 언론사 편향 분석
    source_bias = get_source_bias(article.source)
    source_score = 0.0
    if source_bias.known_lean and article.source:
        for name, info in SOURCE_BIAS_MAP.items():
            if name in article.source:
                source_score = info["score"]
                break
    
    # 2. 키워드 기반 편향 분석
    keyword_score, indicators = analyze_keyword_bias(text)
    
    # 3. 프레이밍 분석
    framing_score, framing_notes = analyze_framing(text)
    
    # 4. 톤 분석
    tone_analysis = analyze_tone(text)
    
    # 5. 종합 점수 계산 (가중 평균)
    # 출처 30%, 키워드 40%, 프레이밍 30%
    overall_score = (
        source_score * 0.3 +
        keyword_score * 0.4 +
        framing_score * 0.3
    )
    overall_score = max(-1.0, min(1.0, overall_score))
    
    # 6. 레이블 결정
    bias_label, political_lean = score_to_label(overall_score)
    
    # 7. 신뢰도 계산 (분석 근거가 많을수록 높음)
    confidence = min(0.3 + len(indicators) * 0.1 + len(framing_notes) * 0.15, 0.95)
    
    # 8. 설명 생성
    explanations = []
    if source_bias.known_lean and source_bias.known_lean != "unknown":
        explanations.append(f"언론사 성향: {source_bias.source_name} ({source_bias.known_lean})")
    explanations.append(f"종합 편향 점수: {overall_score:.2f} (-1=진보, 1=보수)")
    if indicators:
        explanations.append(f"편향 지표 {len(indicators)}개 발견")
    if tone_analysis.loaded_words_count > 0:
        explanations.append(f"편향적 표현 {tone_analysis.loaded_words_count}개 발견")
    
    return BiasResult(
        overall_bias_score=round(overall_score, 3),
        bias_label=bias_label,
        confidence=round(confidence, 2),
        political_lean=political_lean,
        indicators=indicators if indicators else None,
        tone_analysis=tone_analysis,
        source_bias=source_bias,
        framing_notes=framing_notes if framing_notes else None,
        explanations=explanations
    )


# ========== API Endpoints ==========

@app.get("/health")
async def health_check():
    """헬스체크 엔드포인트"""
    return {"status": "healthy", "service": "bias-addon"}


@app.post("/analyze", response_model=AddonResponse)
async def analyze(request: AddonRequest):
    """
    기사 편향도 분석 엔드포인트.
    
    NewsInsight Orchestrator가 호출하는 메인 엔드포인트입니다.
    """
    start_time = time.time()
    
    try:
        # 입력 검증
        if not request.article:
            raise ValueError("article is required")
        
        # 편향도 분석 실행
        bias_result = perform_bias_analysis(request.article)
        
        # 응답 생성
        latency_ms = int((time.time() - start_time) * 1000)
        
        return AddonResponse(
            request_id=request.request_id,
            addon_id=request.addon_id,
            status="success",
            results=AnalysisResults(
                bias=bias_result
            ),
            meta=ResponseMeta(
                model_version="bias-ko-heuristic-v1",
                latency_ms=latency_ms,
                processed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            )
        )
        
    except Exception as e:
        latency_ms = int((time.time() - start_time) * 1000)
        return AddonResponse(
            request_id=request.request_id,
            addon_id=request.addon_id,
            status="error",
            error=ErrorInfo(
                code="BIAS_ANALYSIS_ERROR",
                message=str(e)
            ),
            meta=ResponseMeta(
                model_version="bias-ko-heuristic-v1",
                latency_ms=latency_ms,
                processed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            )
        )


@app.post("/batch")
async def analyze_batch(requests: List[AddonRequest]):
    """여러 기사 일괄 분석"""
    results = []
    for req in requests:
        result = await analyze(req)
        results.append(result)
    return results


# ========== Entry Point ==========

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8102)
