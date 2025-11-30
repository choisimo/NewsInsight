"""
ML Add-on Server: Fact-Check Analysis

NewsInsight ML Add-on 시스템의 팩트체크 구현.
뉴스 기사의 사실 검증 및 신뢰도 분석을 수행합니다.
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, List, Any
import time
import re
import hashlib

app = FastAPI(
    title="Fact-Check Analysis Add-on",
    description="Korean news article fact-checking and credibility analysis for NewsInsight",
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

class ClaimResult(BaseModel):
    claim: str
    verdict: str  # verified, false, unverified, misleading, partially_true
    confidence: float  # 0-1
    evidence: Optional[str] = None
    source_url: Optional[str] = None

class FactCheckResult(BaseModel):
    overall_credibility: float  # 0-100
    credibility_grade: str  # A, B, C, D, F
    verdict: str  # verified, suspicious, unverified
    claims_analyzed: int
    verified_claims: int
    false_claims: int
    unverified_claims: int
    claims: Optional[List[ClaimResult]] = None
    risk_flags: Optional[List[str]] = None
    explanations: Optional[List[str]] = None

class AnalysisResults(BaseModel):
    factcheck: Optional[FactCheckResult] = None
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

# ========== Fact-Check Analysis Logic ==========

# 신뢰할 수 있는 언론사 목록 (실제로는 DB나 설정에서 관리)
TRUSTED_SOURCES = [
    "연합뉴스", "한국일보", "경향신문", "한겨레", "동아일보", 
    "조선일보", "중앙일보", "매일경제", "한국경제", "KBS",
    "MBC", "SBS", "YTN", "JTBC", "채널A", "MBN", "TV조선"
]

# 낚시성 제목 패턴
CLICKBAIT_PATTERNS = [
    r"충격[!]*", r"경악[!]*", r"대박[!]*", r"헉[!]*", 
    r"알고\s*보니", r"결국[.]*$", r"드디어[!]*",
    r"\.\.\.$", r"\?\?\?", r"!!!", r"속보[!:]*",
    r"단독[!:]*", r"긴급[!:]*"
]

# 검증 필요 표현 (주장성 문장)
CLAIM_INDICATORS = [
    "~라고 밝혔다", "~라고 주장했다", "~라고 전했다",
    "~에 따르면", "~것으로 알려졌다", "~것으로 확인됐다",
    "~할 것으로 보인다", "~할 전망이다", "~할 예정이다",
    "관계자는", "전문가는", "소식통에 따르면"
]

# 팩트체크 필요 키워드 (검증이 어려운 주장)
UNVERIFIABLE_PATTERNS = [
    r"최초", r"유일", r"최고", r"최대", r"100%", 
    r"모든\s*사람", r"아무도", r"절대", r"반드시"
]

# 허위정보 위험 패턴
MISINFORMATION_PATTERNS = [
    r"정부가\s*숨기", r"언론이\s*보도하지\s*않는",
    r"비밀리에", r"충격\s*진실", r"알려지지\s*않은\s*진실"
]


def extract_claims(text: str) -> List[str]:
    """텍스트에서 주장/인용 문장 추출"""
    claims = []
    sentences = re.split(r'[.!?]\s+', text)
    
    for sentence in sentences:
        for indicator in CLAIM_INDICATORS:
            pattern = indicator.replace("~", ".*")
            if re.search(pattern, sentence):
                claims.append(sentence.strip())
                break
    
    return claims[:10]  # 최대 10개


def check_source_credibility(source: Optional[str]) -> float:
    """출처 신뢰도 점수 (0-1)"""
    if not source:
        return 0.3  # 출처 없음 = 낮은 신뢰도
    
    for trusted in TRUSTED_SOURCES:
        if trusted in source:
            return 0.9
    
    # 알 수 없는 출처
    return 0.5


def detect_clickbait(title: str) -> tuple[bool, List[str]]:
    """낚시성 제목 탐지"""
    if not title:
        return False, []
    
    found_patterns = []
    for pattern in CLICKBAIT_PATTERNS:
        if re.search(pattern, title):
            found_patterns.append(pattern)
    
    return len(found_patterns) > 0, found_patterns


def detect_misinformation_risk(text: str) -> tuple[float, List[str]]:
    """허위정보 위험도 탐지"""
    if not text:
        return 0.0, []
    
    risk_flags = []
    risk_score = 0.0
    
    # 허위정보 패턴 체크
    for pattern in MISINFORMATION_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            risk_flags.append(f"위험 패턴 발견: {pattern}")
            risk_score += 0.2
    
    # 검증 불가능한 주장 체크
    for pattern in UNVERIFIABLE_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            risk_flags.append(f"검증 어려운 표현: {pattern}")
            risk_score += 0.1
    
    return min(risk_score, 1.0), risk_flags


def analyze_claims(claims: List[str]) -> tuple[List[ClaimResult], int, int, int]:
    """
    주장 문장들을 분석하여 검증 결과 반환
    
    실제 프로덕션에서는:
    - 외부 팩트체크 DB 연동 (SNU 팩트체크, 뉴스톱 등)
    - LLM 기반 사실 검증
    - 검색 엔진 API로 교차 검증
    으로 대체하세요.
    """
    results = []
    verified = 0
    false = 0
    unverified = 0
    
    for claim in claims:
        # 간단한 휴리스틱 기반 판정 (실제로는 ML 모델 사용)
        claim_hash = int(hashlib.md5(claim.encode()).hexdigest(), 16)
        
        # 해시 기반 의사 랜덤 결과 (데모용)
        verdict_idx = claim_hash % 5
        verdicts = ["verified", "verified", "unverified", "unverified", "misleading"]
        verdict = verdicts[verdict_idx]
        
        confidence = 0.5 + (claim_hash % 50) / 100  # 0.5-1.0
        
        if verdict == "verified":
            verified += 1
        elif verdict in ["false", "misleading"]:
            false += 1
        else:
            unverified += 1
        
        results.append(ClaimResult(
            claim=claim[:100] + "..." if len(claim) > 100 else claim,
            verdict=verdict,
            confidence=round(confidence, 2),
            evidence="자동 분석 결과 (실제 검증 필요)"
        ))
    
    return results, verified, false, unverified


def calculate_credibility_score(
    source_score: float,
    is_clickbait: bool,
    misinformation_risk: float,
    verified_ratio: float
) -> tuple[float, str]:
    """종합 신뢰도 점수 계산"""
    
    # 가중치 적용
    score = (
        source_score * 30 +  # 출처 신뢰도 30%
        (1 - int(is_clickbait) * 0.3) * 20 +  # 낚시성 여부 20%
        (1 - misinformation_risk) * 20 +  # 허위정보 위험도 20%
        verified_ratio * 30  # 검증된 주장 비율 30%
    )
    
    # 등급 산정
    if score >= 80:
        grade = "A"
    elif score >= 60:
        grade = "B"
    elif score >= 40:
        grade = "C"
    elif score >= 20:
        grade = "D"
    else:
        grade = "F"
    
    return round(score, 1), grade


def perform_factcheck(article: ArticleInput) -> FactCheckResult:
    """
    기사 팩트체크 수행
    """
    text = ""
    if article.title:
        text += article.title + " "
    if article.content:
        text += article.content
    
    if not text.strip():
        return FactCheckResult(
            overall_credibility=0.0,
            credibility_grade="F",
            verdict="unverified",
            claims_analyzed=0,
            verified_claims=0,
            false_claims=0,
            unverified_claims=0,
            explanations=["분석할 콘텐츠 없음"]
        )
    
    # 1. 출처 신뢰도 체크
    source_score = check_source_credibility(article.source)
    
    # 2. 낚시성 제목 탐지
    is_clickbait, clickbait_patterns = detect_clickbait(article.title or "")
    
    # 3. 허위정보 위험도 탐지
    misinformation_risk, risk_flags = detect_misinformation_risk(text)
    
    # 4. 주장 추출 및 분석
    claims = extract_claims(text)
    claim_results, verified, false, unverified = analyze_claims(claims)
    
    # 검증 비율 계산
    total_claims = len(claims) if claims else 1
    verified_ratio = verified / total_claims
    
    # 5. 종합 점수 계산
    credibility, grade = calculate_credibility_score(
        source_score, is_clickbait, misinformation_risk, verified_ratio
    )
    
    # 6. 최종 판정
    if credibility >= 70:
        verdict = "verified"
    elif credibility >= 40:
        verdict = "suspicious"
    else:
        verdict = "unverified"
    
    # 7. 위험 플래그 취합
    all_risk_flags = risk_flags.copy()
    if is_clickbait:
        all_risk_flags.append("낚시성 제목 의심")
    if source_score < 0.5:
        all_risk_flags.append("출처 신뢰도 낮음")
    
    # 8. 설명 생성
    explanations = []
    explanations.append(f"출처 신뢰도: {source_score * 100:.0f}%")
    explanations.append(f"분석된 주장: {len(claims)}개")
    if verified > 0:
        explanations.append(f"검증된 주장: {verified}개")
    if false > 0:
        explanations.append(f"의심스러운 주장: {false}개")
    if is_clickbait:
        explanations.append(f"낚시성 패턴 발견: {', '.join(clickbait_patterns)}")
    
    return FactCheckResult(
        overall_credibility=credibility,
        credibility_grade=grade,
        verdict=verdict,
        claims_analyzed=len(claims),
        verified_claims=verified,
        false_claims=false,
        unverified_claims=unverified,
        claims=claim_results if claim_results else None,
        risk_flags=all_risk_flags if all_risk_flags else None,
        explanations=explanations
    )


# ========== API Endpoints ==========

@app.get("/health")
async def health_check():
    """헬스체크 엔드포인트"""
    return {"status": "healthy", "service": "factcheck-addon"}


@app.post("/analyze", response_model=AddonResponse)
async def analyze(request: AddonRequest):
    """
    기사 팩트체크 분석 엔드포인트.
    
    NewsInsight Orchestrator가 호출하는 메인 엔드포인트입니다.
    """
    start_time = time.time()
    
    try:
        # 입력 검증
        if not request.article:
            raise ValueError("article is required")
        
        # 팩트체크 실행
        factcheck_result = perform_factcheck(request.article)
        
        # 응답 생성
        latency_ms = int((time.time() - start_time) * 1000)
        
        return AddonResponse(
            request_id=request.request_id,
            addon_id=request.addon_id,
            status="success",
            results=AnalysisResults(
                factcheck=factcheck_result
            ),
            meta=ResponseMeta(
                model_version="factcheck-ko-heuristic-v1",
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
                code="FACTCHECK_ERROR",
                message=str(e)
            ),
            meta=ResponseMeta(
                model_version="factcheck-ko-heuristic-v1",
                latency_ms=latency_ms,
                processed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            )
        )


@app.post("/batch")
async def analyze_batch(requests: List[AddonRequest]):
    """여러 기사 일괄 팩트체크"""
    results = []
    for req in requests:
        result = await analyze(req)
        results.append(result)
    return results


# ========== Entry Point ==========

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8101)
