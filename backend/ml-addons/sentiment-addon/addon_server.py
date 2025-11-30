"""
ML Add-on Server: Korean Sentiment Analysis

NewsInsight ML Add-on 시스템의 레퍼런스 구현.
이 템플릿을 복사하여 다른 분석 Add-on을 만들 수 있습니다.
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, List, Any
import time
import uuid

app = FastAPI(
    title="Sentiment Analysis Add-on",
    description="Korean news article sentiment analysis for NewsInsight",
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

class SentimentResult(BaseModel):
    score: float  # -1 to 1
    label: str  # positive, negative, neutral
    distribution: Dict[str, float]
    emotions: Optional[Dict[str, float]] = None
    explanations: Optional[List[str]] = None

class AnalysisResults(BaseModel):
    sentiment: Optional[SentimentResult] = None
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

# ========== Sentiment Analysis Logic ==========

# 간단한 키워드 기반 감정 분석 (실제로는 ML 모델 사용)
POSITIVE_KEYWORDS = [
    "성공", "발전", "향상", "긍정", "좋은", "훌륭", "최고", "행복", 
    "성장", "협력", "지원", "개선", "희망", "기대", "축하"
]

NEGATIVE_KEYWORDS = [
    "실패", "문제", "위기", "부정", "나쁜", "최악", "우려", "불안",
    "감소", "하락", "갈등", "비판", "논란", "피해", "사고", "범죄"
]

def analyze_sentiment(text: str) -> SentimentResult:
    """
    텍스트의 감정을 분석합니다.
    
    실제 프로덕션에서는 이 부분을:
    - KoBERT, KoELECTRA 등 한국어 사전학습 모델
    - HuggingFace Transformers
    - 또는 외부 AI API (OpenAI, Claude 등)
    로 대체하세요.
    """
    if not text:
        return SentimentResult(
            score=0.0,
            label="neutral",
            distribution={"positive": 0.33, "negative": 0.33, "neutral": 0.34},
            explanations=["텍스트 없음"]
        )
    
    text_lower = text.lower()
    
    # 키워드 카운트
    positive_count = sum(1 for kw in POSITIVE_KEYWORDS if kw in text_lower)
    negative_count = sum(1 for kw in NEGATIVE_KEYWORDS if kw in text_lower)
    total_keywords = positive_count + negative_count + 1  # +1 to avoid division by zero
    
    # 점수 계산 (-1 ~ 1)
    score = (positive_count - negative_count) / total_keywords
    score = max(-1.0, min(1.0, score))  # Clamp
    
    # 분포 계산
    positive_ratio = positive_count / total_keywords
    negative_ratio = negative_count / total_keywords
    neutral_ratio = 1.0 - positive_ratio - negative_ratio
    
    # 레이블 결정
    if score > 0.1:
        label = "positive"
    elif score < -0.1:
        label = "negative"
    else:
        label = "neutral"
    
    # 설명 생성
    explanations = []
    if positive_count > 0:
        explanations.append(f"긍정 키워드 {positive_count}개 발견")
    if negative_count > 0:
        explanations.append(f"부정 키워드 {negative_count}개 발견")
    if not explanations:
        explanations.append("특별한 감정 신호 없음")
    
    return SentimentResult(
        score=round(score, 3),
        label=label,
        distribution={
            "positive": round(positive_ratio, 3),
            "negative": round(negative_ratio, 3),
            "neutral": round(neutral_ratio, 3)
        },
        emotions={
            "joy": round(positive_ratio * 0.5, 3),
            "anger": round(negative_ratio * 0.4, 3),
            "sadness": round(negative_ratio * 0.3, 3),
            "fear": round(negative_ratio * 0.2, 3),
            "surprise": 0.1
        },
        explanations=explanations
    )

# ========== API Endpoints ==========

@app.get("/health")
async def health_check():
    """헬스체크 엔드포인트"""
    return {"status": "healthy", "service": "sentiment-addon"}

@app.post("/analyze", response_model=AddonResponse)
async def analyze(request: AddonRequest):
    """
    기사 감정 분석 엔드포인트.
    
    NewsInsight Orchestrator가 호출하는 메인 엔드포인트입니다.
    """
    start_time = time.time()
    
    try:
        # 입력 검증
        if not request.article:
            raise ValueError("article is required")
        
        # 분석할 텍스트 준비
        text = ""
        if request.article.title:
            text += request.article.title + " "
        if request.article.content:
            text += request.article.content
        
        # 감정 분석 실행
        sentiment_result = analyze_sentiment(text)
        
        # 응답 생성
        latency_ms = int((time.time() - start_time) * 1000)
        
        return AddonResponse(
            request_id=request.request_id,
            addon_id=request.addon_id,
            status="success",
            results=AnalysisResults(
                sentiment=sentiment_result
            ),
            meta=ResponseMeta(
                model_version="sentiment-ko-keywords-v1",
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
                code="ANALYSIS_ERROR",
                message=str(e)
            ),
            meta=ResponseMeta(
                model_version="sentiment-ko-keywords-v1",
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
    uvicorn.run(app, host="0.0.0.0", port=8100)
