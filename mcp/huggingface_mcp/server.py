"""
Hugging Face MCP Server - NLP/ML Inference 및 Hub 연동

뉴스 기사 텍스트 분석(감성, 분류, 요약, NER 등)을 위한 MCP 서버입니다.
Hugging Face Inference API와 Hub를 활용합니다.

Version: 1.0.0
Port: 5011
"""

import os
import json
import uuid
import asyncio
import hashlib
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any, Union
from pathlib import Path

import aiohttp
import aiofiles
from mcp.server import FastMCP
from starlette.responses import JSONResponse
from starlette.requests import Request

# ─────────────────────────────────────────────
# 1. MCP 서버 기본 설정
# ─────────────────────────────────────────────

# 포트 설정 (환경변수에서 읽음)
PORT = int(os.environ.get("PORT", "5011"))

server = FastMCP(
    "huggingface-nlp-mcp",
    host="0.0.0.0",
    port=PORT,
)


# Health check endpoint
@server.custom_route("/health", methods=["GET"])
async def health_endpoint(request: Request) -> JSONResponse:
    return JSONResponse(
        {
            "status": "healthy",
            "server": "huggingface-nlp-mcp",
            "version": "1.0.0",
        }
    )


# Hugging Face API 설정
HF_TOKEN = os.environ.get("HF_TOKEN", "")
HF_INFERENCE_URL = "https://api-inference.huggingface.co/models"
HF_API_URL = "https://huggingface.co/api"

# 공유 데이터 디렉토리
DATA_DIR = Path(os.environ.get("DATA_DIR", "/app/data"))
CACHE_DIR = DATA_DIR / "cache"
RESULTS_DIR = DATA_DIR / "results"

# Job Queue 설정
JOB_TIMEOUT = int(os.environ.get("JOB_TIMEOUT", "600"))  # 10분

# ─────────────────────────────────────────────
# 2. Job Queue 관리 (In-Memory)
# ─────────────────────────────────────────────


class JobStatus:
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


_jobs: Dict[str, Dict[str, Any]] = {}


def create_job(job_type: str, params: Dict[str, Any]) -> str:
    """새 Job을 생성하고 Job ID를 반환합니다."""
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {
        "id": job_id,
        "type": job_type,
        "status": JobStatus.PENDING,
        "params": params,
        "result": None,
        "error": None,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
        "progress": 0,
    }
    return job_id


def update_job(job_id: str, **kwargs):
    """Job 상태를 업데이트합니다."""
    if job_id in _jobs:
        _jobs[job_id].update(kwargs)
        _jobs[job_id]["updated_at"] = datetime.utcnow().isoformat()


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    """Job 정보를 조회합니다."""
    return _jobs.get(job_id)


# ─────────────────────────────────────────────
# 3. 캐싱 유틸리티
# ─────────────────────────────────────────────


def get_cache_key(text: str, model: str, task: str) -> str:
    """캐시 키를 생성합니다."""
    content = f"{text}:{model}:{task}"
    return hashlib.md5(content.encode()).hexdigest()


async def save_to_cache(key: str, data: Any):
    """결과를 캐시에 저장합니다."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE_DIR / f"{key}.json"
    async with aiofiles.open(cache_file, "w") as f:
        await f.write(json.dumps(data, ensure_ascii=False, default=str))


async def load_from_cache(key: str) -> Optional[Any]:
    """캐시에서 결과를 로드합니다."""
    cache_file = CACHE_DIR / f"{key}.json"
    if cache_file.exists():
        async with aiofiles.open(cache_file, "r") as f:
            content = await f.read()
            return json.loads(content)
    return None


# ─────────────────────────────────────────────
# 4. Hugging Face Inference API 클라이언트
# ─────────────────────────────────────────────


class HuggingFaceClient:
    """Hugging Face Inference API 클라이언트"""

    def __init__(self, token: str):
        self.token = token
        self.headers = {"Authorization": f"Bearer {token}"} if token else {}

    async def _call_inference(
        self,
        model_id: str,
        inputs: Any,
        parameters: Optional[Dict[str, Any]] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """Inference API를 호출합니다."""
        url = f"{HF_INFERENCE_URL}/{model_id}"

        payload = {"inputs": inputs}
        if parameters:
            payload["parameters"] = parameters
        if options:
            payload["options"] = options

        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                headers=self.headers,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=120),
            ) as resp:
                if resp.status == 503:
                    # 모델 로딩 중
                    data = await resp.json()
                    estimated_time = data.get("estimated_time", 60)
                    return {
                        "loading": True,
                        "estimated_time": estimated_time,
                        "message": "모델이 로딩 중입니다. 잠시 후 다시 시도해주세요.",
                    }
                elif resp.status != 200:
                    text = await resp.text()
                    raise Exception(f"HuggingFace API 오류: {resp.status} - {text}")
                return await resp.json()

    # ─── 텍스트 분류 ───

    async def classify_text(
        self,
        text: str,
        model_id: str = "facebook/bart-large-mnli",
        candidate_labels: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        텍스트 분류 (Zero-shot 또는 일반 분류).

        Args:
            text: 분류할 텍스트
            model_id: 분류 모델 ID
            candidate_labels: Zero-shot 분류 시 후보 레이블
        """
        if candidate_labels:
            # Zero-shot classification
            return await self._call_inference(
                model_id,
                {"text": text, "candidate_labels": candidate_labels},
            )
        else:
            return await self._call_inference(model_id, text)

    # ─── 감성 분석 ───

    async def analyze_sentiment(
        self,
        text: str,
        model_id: str = "cardiffnlp/twitter-roberta-base-sentiment-latest",
    ) -> Dict[str, Any]:
        """
        텍스트 감성 분석 (긍정/부정/중립).

        Args:
            text: 분석할 텍스트
            model_id: 감성 분석 모델 ID
        """
        result = await self._call_inference(model_id, text)

        # 결과 정규화
        if isinstance(result, list) and len(result) > 0:
            if isinstance(result[0], list):
                result = result[0]

            # 레이블 한글화
            label_map = {
                "positive": "긍정",
                "negative": "부정",
                "neutral": "중립",
                "POSITIVE": "긍정",
                "NEGATIVE": "부정",
                "NEUTRAL": "중립",
                "LABEL_0": "부정",
                "LABEL_1": "중립",
                "LABEL_2": "긍정",
            }

            for item in result:
                if "label" in item:
                    item["label_kr"] = label_map.get(item["label"], item["label"])

        return {"results": result}

    # ─── 텍스트 요약 ───

    async def summarize_text(
        self,
        text: str,
        model_id: str = "facebook/bart-large-cnn",
        max_length: int = 150,
        min_length: int = 30,
    ) -> Dict[str, Any]:
        """
        텍스트 요약.

        Args:
            text: 요약할 텍스트
            model_id: 요약 모델 ID
            max_length: 최대 요약 길이
            min_length: 최소 요약 길이
        """
        result = await self._call_inference(
            model_id,
            text,
            parameters={
                "max_length": max_length,
                "min_length": min_length,
            },
        )
        return result

    # ─── 개체명 인식 (NER) ───

    async def extract_entities(
        self,
        text: str,
        model_id: str = "dslim/bert-base-NER",
    ) -> Dict[str, Any]:
        """
        개체명 인식 (Named Entity Recognition).

        Args:
            text: 분석할 텍스트
            model_id: NER 모델 ID
        """
        result = await self._call_inference(model_id, text)

        # 엔티티 그룹화
        entities = {}
        if isinstance(result, list):
            for ent in result:
                entity_type = ent.get("entity_group", ent.get("entity", "MISC"))
                word = ent.get("word", "")

                if entity_type not in entities:
                    entities[entity_type] = []

                # 중복 제거
                if word and word not in entities[entity_type]:
                    entities[entity_type].append(word)

        return {
            "raw": result,
            "grouped": entities,
            "total_count": len(result) if isinstance(result, list) else 0,
        }

    # ─── 키워드 추출 ───

    async def extract_keywords(
        self,
        text: str,
        model_id: str = "ml6team/keyphrase-extraction-kbir-inspec",
    ) -> Dict[str, Any]:
        """
        키워드/키프레이즈 추출.

        Args:
            text: 분석할 텍스트
            model_id: 키워드 추출 모델 ID
        """
        result = await self._call_inference(model_id, text)

        # 키워드 추출 및 정리
        keywords = []
        if isinstance(result, list):
            for item in result:
                word = item.get("word", "").strip()
                if word and word not in keywords:
                    keywords.append(word)

        return {
            "keywords": keywords,
            "raw": result,
        }

    # ─── 텍스트 생성 ───

    async def generate_text(
        self,
        prompt: str,
        model_id: str = "gpt2",
        max_new_tokens: int = 100,
        temperature: float = 0.7,
    ) -> Dict[str, Any]:
        """
        텍스트 생성.

        Args:
            prompt: 입력 프롬프트
            model_id: 생성 모델 ID
            max_new_tokens: 최대 생성 토큰 수
            temperature: 샘플링 온도
        """
        result = await self._call_inference(
            model_id,
            prompt,
            parameters={
                "max_new_tokens": max_new_tokens,
                "temperature": temperature,
                "return_full_text": False,
            },
        )
        return result

    # ─── 질의응답 ───

    async def question_answering(
        self,
        question: str,
        context: str,
        model_id: str = "deepset/roberta-base-squad2",
    ) -> Dict[str, Any]:
        """
        문서 기반 질의응답.

        Args:
            question: 질문
            context: 답변을 찾을 문서/컨텍스트
            model_id: QA 모델 ID
        """
        result = await self._call_inference(
            model_id,
            {"question": question, "context": context},
        )
        return result

    # ─── 임베딩 ───

    async def get_embeddings(
        self,
        texts: List[str],
        model_id: str = "sentence-transformers/all-MiniLM-L6-v2",
    ) -> Dict[str, Any]:
        """
        텍스트 임베딩 생성.

        Args:
            texts: 임베딩할 텍스트 목록
            model_id: 임베딩 모델 ID
        """
        result = await self._call_inference(
            model_id,
            {"inputs": texts, "options": {"wait_for_model": True}},
        )
        return {
            "embeddings": result,
            "dimension": len(result[0]) if result and len(result) > 0 else 0,
            "count": len(texts),
        }

    # ─── Hub API ───

    async def search_models(
        self,
        query: str,
        task: Optional[str] = None,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        """
        Hugging Face Hub에서 모델을 검색합니다.

        Args:
            query: 검색어
            task: 태스크 필터 (text-classification, summarization 등)
            limit: 최대 결과 수
        """
        params = {"search": query, "limit": limit}
        if task:
            params["pipeline_tag"] = task

        url = f"{HF_API_URL}/models"

        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params, headers=self.headers) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    raise Exception(f"HuggingFace Hub API 오류: {resp.status} - {text}")
                return await resp.json()

    async def get_model_info(self, model_id: str) -> Dict[str, Any]:
        """
        모델 상세 정보를 조회합니다.

        Args:
            model_id: 모델 ID (예: "facebook/bart-large-cnn")
        """
        url = f"{HF_API_URL}/models/{model_id}"

        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=self.headers) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    raise Exception(f"HuggingFace Hub API 오류: {resp.status} - {text}")
                return await resp.json()


# 전역 클라이언트 인스턴스
_hf_client: Optional[HuggingFaceClient] = None


def get_hf_client() -> HuggingFaceClient:
    """HuggingFace 클라이언트를 반환합니다."""
    global _hf_client
    if _hf_client is None:
        _hf_client = HuggingFaceClient(HF_TOKEN)
    return _hf_client


# ─────────────────────────────────────────────
# 5. 뉴스 기사 종합 분석
# ─────────────────────────────────────────────


async def analyze_news_article(
    title: str,
    content: str,
    include_sentiment: bool = True,
    include_entities: bool = True,
    include_summary: bool = True,
    include_keywords: bool = True,
    include_classification: bool = True,
) -> Dict[str, Any]:
    """
    뉴스 기사를 종합적으로 분석합니다.
    """
    client = get_hf_client()
    full_text = f"{title}\n\n{content}"

    result = {
        "analyzed_at": datetime.utcnow().isoformat(),
        "title": title,
        "content_length": len(content),
    }

    tasks = []
    task_names = []

    # 감성 분석
    if include_sentiment:
        tasks.append(client.analyze_sentiment(full_text[:512]))
        task_names.append("sentiment")

    # 개체명 인식
    if include_entities:
        tasks.append(client.extract_entities(full_text[:512]))
        task_names.append("entities")

    # 요약
    if include_summary and len(content) > 200:
        tasks.append(client.summarize_text(content[:1024]))
        task_names.append("summary")

    # 키워드 추출
    if include_keywords:
        tasks.append(client.extract_keywords(full_text[:512]))
        task_names.append("keywords")

    # 분류 (Zero-shot)
    if include_classification:
        categories = ["정치", "경제", "사회", "문화", "스포츠", "IT/과학", "국제"]
        tasks.append(
            client.classify_text(
                title,
                model_id="facebook/bart-large-mnli",
                candidate_labels=categories,
            )
        )
        task_names.append("classification")

    # 병렬 실행
    if tasks:
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for name, res in zip(task_names, results):
            if isinstance(res, Exception):
                result[name] = {"error": str(res)}
            else:
                result[name] = res

    return result


# ─────────────────────────────────────────────
# 6. 배치 처리
# ─────────────────────────────────────────────


async def process_batch_articles(
    job_id: str,
    articles: List[Dict[str, str]],
    analysis_options: Dict[str, bool],
) -> Dict[str, Any]:
    """
    여러 기사를 배치로 분석합니다.
    """
    update_job(job_id, status=JobStatus.PROCESSING, progress=0)

    results = []
    total = len(articles)

    for idx, article in enumerate(articles):
        try:
            result = await analyze_news_article(
                title=article.get("title", ""),
                content=article.get("content", ""),
                **analysis_options,
            )
            results.append(
                {
                    "article_id": article.get("id", idx),
                    "success": True,
                    "result": result,
                }
            )
        except Exception as e:
            results.append(
                {
                    "article_id": article.get("id", idx),
                    "success": False,
                    "error": str(e),
                }
            )

        progress = int((idx + 1) / total * 100)
        update_job(job_id, progress=progress)

    # 결과 저장
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    result_file = RESULTS_DIR / f"{job_id}.json"
    async with aiofiles.open(result_file, "w") as f:
        await f.write(json.dumps(results, ensure_ascii=False, default=str, indent=2))

    final_result = {
        "total": total,
        "success_count": sum(1 for r in results if r["success"]),
        "failed_count": sum(1 for r in results if not r["success"]),
        "results": results,
        "result_file": str(result_file),
    }

    update_job(job_id, status=JobStatus.COMPLETED, result=final_result, progress=100)
    return final_result


# ─────────────────────────────────────────────
# 7. MCP Tools
# ─────────────────────────────────────────────


@server.tool()
async def analyze_sentiment(
    text: str,
    model_id: str = "cardiffnlp/twitter-roberta-base-sentiment-latest",
) -> Dict[str, Any]:
    """
    텍스트의 감성을 분석합니다 (긍정/부정/중립).

    뉴스 기사 제목이나 본문의 감성 성향을 파악할 수 있습니다.

    Args:
        text: 분석할 텍스트
        model_id: 감성 분석 모델 ID

    Returns:
        감성 분석 결과 (레이블, 신뢰도)
    """
    client = get_hf_client()
    result = await client.analyze_sentiment(text[:512], model_id)

    return {
        "text_preview": text[:100] + "..." if len(text) > 100 else text,
        "model": model_id,
        "sentiment": result,
        "analyzed_at": datetime.utcnow().isoformat(),
    }


@server.tool()
async def classify_news(
    text: str,
    categories: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    뉴스 기사를 카테고리로 분류합니다 (Zero-shot).

    Args:
        text: 분류할 텍스트 (제목 또는 본문)
        categories: 분류 카테고리 목록 (기본: 정치, 경제, 사회, 문화, 스포츠, IT/과학, 국제)

    Returns:
        카테고리별 확률
    """
    if categories is None:
        categories = ["정치", "경제", "사회", "문화", "스포츠", "IT/과학", "국제"]

    client = get_hf_client()
    result = await client.classify_text(
        text[:512],
        model_id="facebook/bart-large-mnli",
        candidate_labels=categories,
    )

    return {
        "text_preview": text[:100] + "..." if len(text) > 100 else text,
        "categories": categories,
        "classification": result,
        "top_category": result.get("labels", [None])[0]
        if isinstance(result, dict)
        else None,
        "analyzed_at": datetime.utcnow().isoformat(),
    }


@server.tool()
async def summarize_article(
    text: str,
    max_length: int = 150,
    min_length: int = 30,
    model_id: str = "facebook/bart-large-cnn",
) -> Dict[str, Any]:
    """
    뉴스 기사를 요약합니다.

    Args:
        text: 요약할 텍스트
        max_length: 최대 요약 길이 (토큰)
        min_length: 최소 요약 길이 (토큰)
        model_id: 요약 모델 ID

    Returns:
        요약된 텍스트
    """
    client = get_hf_client()
    result = await client.summarize_text(
        text[:1024],
        model_id=model_id,
        max_length=max_length,
        min_length=min_length,
    )

    summary = ""
    if isinstance(result, dict):
        if (
            "results" in result
            and isinstance(result["results"], list)
            and len(result["results"]) > 0
        ):
            first_result = result["results"][0]
            if isinstance(first_result, dict):
                summary = first_result.get("summary_text", "")
        else:
            summary = result.get("summary_text", "")

    return {
        "original_length": len(text),
        "summary": summary,
        "summary_length": len(summary),
        "compression_ratio": round(len(summary) / len(text), 2) if text else 0,
        "model": model_id,
        "analyzed_at": datetime.utcnow().isoformat(),
    }


@server.tool()
async def extract_entities(
    text: str,
    model_id: str = "dslim/bert-base-NER",
) -> Dict[str, Any]:
    """
    텍스트에서 개체명을 추출합니다 (인물, 조직, 장소 등).

    Args:
        text: 분석할 텍스트
        model_id: NER 모델 ID

    Returns:
        추출된 개체명 (유형별 그룹화)
    """
    client = get_hf_client()
    result = await client.extract_entities(text[:512], model_id)

    # 엔티티 유형 한글화
    type_map = {
        "PER": "인물",
        "ORG": "조직",
        "LOC": "장소",
        "MISC": "기타",
        "DATE": "날짜",
        "TIME": "시간",
        "MONEY": "금액",
        "PERCENT": "비율",
    }

    grouped_kr = {}
    for entity_type, entities in result.get("grouped", {}).items():
        kr_type = type_map.get(entity_type, entity_type)
        grouped_kr[kr_type] = entities

    return {
        "text_preview": text[:100] + "..." if len(text) > 100 else text,
        "entities": grouped_kr,
        "total_count": result.get("total_count", 0),
        "model": model_id,
        "analyzed_at": datetime.utcnow().isoformat(),
    }


@server.tool()
async def extract_keywords(
    text: str,
) -> Dict[str, Any]:
    """
    텍스트에서 핵심 키워드를 추출합니다.

    Args:
        text: 분석할 텍스트

    Returns:
        추출된 키워드 목록
    """
    client = get_hf_client()
    result = await client.extract_keywords(text[:512])

    return {
        "text_preview": text[:100] + "..." if len(text) > 100 else text,
        "keywords": result.get("keywords", []),
        "analyzed_at": datetime.utcnow().isoformat(),
    }


@server.tool()
async def answer_question(
    question: str,
    context: str,
    model_id: str = "deepset/roberta-base-squad2",
) -> Dict[str, Any]:
    """
    문서 기반 질의응답을 수행합니다.

    뉴스 기사 본문에서 특정 질문에 대한 답을 찾습니다.

    Args:
        question: 질문
        context: 답변을 찾을 문서 (기사 본문)
        model_id: QA 모델 ID

    Returns:
        답변과 신뢰도
    """
    client = get_hf_client()
    result = await client.question_answering(question, context[:1024], model_id)

    return {
        "question": question,
        "answer": result.get("answer", ""),
        "confidence": result.get("score", 0),
        "start": result.get("start", 0),
        "end": result.get("end", 0),
        "model": model_id,
        "analyzed_at": datetime.utcnow().isoformat(),
    }


@server.tool()
async def analyze_article_full(
    title: str,
    content: str,
    include_sentiment: bool = True,
    include_entities: bool = True,
    include_summary: bool = True,
    include_keywords: bool = True,
    include_classification: bool = True,
) -> Dict[str, Any]:
    """
    뉴스 기사를 종합적으로 분석합니다.

    감성, 개체명, 요약, 키워드, 분류를 한 번에 수행합니다.

    Args:
        title: 기사 제목
        content: 기사 본문
        include_sentiment: 감성 분석 포함
        include_entities: 개체명 추출 포함
        include_summary: 요약 포함
        include_keywords: 키워드 추출 포함
        include_classification: 카테고리 분류 포함

    Returns:
        종합 분석 결과
    """
    result = await analyze_news_article(
        title=title,
        content=content,
        include_sentiment=include_sentiment,
        include_entities=include_entities,
        include_summary=include_summary,
        include_keywords=include_keywords,
        include_classification=include_classification,
    )
    return result


@server.tool()
async def start_batch_analysis(
    articles: List[Dict[str, str]],
    include_sentiment: bool = True,
    include_entities: bool = True,
    include_summary: bool = True,
    include_keywords: bool = True,
    include_classification: bool = True,
) -> Dict[str, Any]:
    """
    여러 기사를 배치로 분석하는 Job을 시작합니다.

    Args:
        articles: 기사 목록 [{"id": "...", "title": "...", "content": "..."}]
        include_sentiment: 감성 분석 포함
        include_entities: 개체명 추출 포함
        include_summary: 요약 포함
        include_keywords: 키워드 추출 포함
        include_classification: 카테고리 분류 포함

    Returns:
        Job ID 및 예상 처리 시간
    """
    if not articles:
        return {"error": "기사 목록이 필요합니다."}

    if len(articles) > 50:
        return {"error": "한 번에 최대 50개 기사만 처리할 수 있습니다."}

    job_id = create_job(
        "batch_analysis",
        {
            "article_count": len(articles),
        },
    )

    analysis_options = {
        "include_sentiment": include_sentiment,
        "include_entities": include_entities,
        "include_summary": include_summary,
        "include_keywords": include_keywords,
        "include_classification": include_classification,
    }

    asyncio.create_task(process_batch_articles(job_id, articles, analysis_options))

    return {
        "job_id": job_id,
        "status": JobStatus.PENDING,
        "article_count": len(articles),
        "estimated_time_seconds": len(articles) * 10,
        "message": f"배치 분석이 시작되었습니다. get_job_status('{job_id}')로 진행 상황을 확인하세요.",
    }


@server.tool()
async def get_job_status(
    job_id: str,
) -> Dict[str, Any]:
    """
    Job의 현재 상태를 조회합니다.

    Args:
        job_id: 조회할 Job ID

    Returns:
        Job 상태, 진행률, 결과
    """
    job = get_job(job_id)
    if not job:
        return {"error": f"Job을 찾을 수 없습니다: {job_id}"}

    response = {
        "job_id": job["id"],
        "type": job["type"],
        "status": job["status"],
        "progress": job["progress"],
        "created_at": job["created_at"],
        "updated_at": job["updated_at"],
    }

    if job["status"] == JobStatus.COMPLETED:
        response["result"] = job["result"]
    elif job["status"] == JobStatus.FAILED:
        response["error"] = job["error"]

    return response


@server.tool()
async def search_models(
    query: str,
    task: Optional[str] = None,
    limit: int = 10,
) -> Dict[str, Any]:
    """
    Hugging Face Hub에서 모델을 검색합니다.

    Args:
        query: 검색어 (예: "korean sentiment", "news classification")
        task: 태스크 필터 (text-classification, summarization, ner 등)
        limit: 최대 결과 수

    Returns:
        검색된 모델 목록
    """
    client = get_hf_client()
    models = await client.search_models(query, task, limit)

    # 결과 정리
    results = []
    for model in models:
        results.append(
            {
                "id": model.get("id", ""),
                "author": model.get("author", ""),
                "downloads": model.get("downloads", 0),
                "likes": model.get("likes", 0),
                "pipeline_tag": model.get("pipeline_tag", ""),
                "tags": model.get("tags", [])[:5],
            }
        )

    return {
        "query": query,
        "task_filter": task,
        "count": len(results),
        "models": results,
    }


@server.tool()
async def list_recommended_models() -> Dict[str, Any]:
    """
    NewsInsight에서 권장하는 NLP 모델 목록을 반환합니다.

    Returns:
        태스크별 권장 모델 목록
    """
    return {
        "sentiment_analysis": [
            {
                "id": "cardiffnlp/twitter-roberta-base-sentiment-latest",
                "description": "Twitter 데이터 학습, 범용 감성 분석",
                "languages": ["en"],
            },
            {
                "id": "nlptown/bert-base-multilingual-uncased-sentiment",
                "description": "다국어 감성 분석 (1-5점)",
                "languages": ["multilingual"],
            },
        ],
        "text_classification": [
            {
                "id": "facebook/bart-large-mnli",
                "description": "Zero-shot 분류 (임의 레이블)",
                "languages": ["en"],
            },
        ],
        "summarization": [
            {
                "id": "facebook/bart-large-cnn",
                "description": "뉴스 요약에 최적화",
                "languages": ["en"],
            },
            {
                "id": "google/pegasus-xsum",
                "description": "극단적 요약 (1문장)",
                "languages": ["en"],
            },
        ],
        "named_entity_recognition": [
            {
                "id": "dslim/bert-base-NER",
                "description": "영어 NER (인물, 조직, 장소)",
                "languages": ["en"],
            },
        ],
        "question_answering": [
            {
                "id": "deepset/roberta-base-squad2",
                "description": "영어 문서 QA",
                "languages": ["en"],
            },
        ],
        "embeddings": [
            {
                "id": "sentence-transformers/all-MiniLM-L6-v2",
                "description": "빠르고 효율적인 문장 임베딩",
                "languages": ["en"],
            },
        ],
        "note": "한국어 모델은 Hub에서 'korean'으로 검색하여 사용하세요.",
    }


@server.tool()
async def health_check() -> Dict[str, Any]:
    """
    서버 상태 및 HuggingFace API 연결 상태를 확인합니다.

    Returns:
        서버 상태 정보
    """
    status = {
        "server": "HuggingFace NLP MCP",
        "version": "1.0.0",
        "status": "running",
        "timestamp": datetime.utcnow().isoformat(),
        "token_configured": bool(HF_TOKEN),
        "data_dir": str(DATA_DIR),
        "active_jobs": len(
            [
                j
                for j in _jobs.values()
                if j["status"] in [JobStatus.PENDING, JobStatus.PROCESSING]
            ]
        ),
    }

    # API 연결 테스트
    try:
        client = get_hf_client()
        models = await client.search_models("test", limit=1)
        status["huggingface_api"] = "connected"
    except Exception as e:
        status["huggingface_api"] = f"error: {str(e)}"
        status["status"] = "degraded"

    return status


# ─────────────────────────────────────────────
# 8. HTTP 헬스체크 핸들러
# ─────────────────────────────────────────────

from http.server import HTTPServer, BaseHTTPRequestHandler
import threading


class HealthCheckHandler(BaseHTTPRequestHandler):
    """간단한 헬스체크 엔드포인트 핸들러"""

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            response = {
                "status": "healthy",
                "server": "huggingface-nlp-mcp",
                "version": "1.0.0",
            }
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


# ─────────────────────────────────────────────
# 9. 서버 시작
# ─────────────────────────────────────────────

if __name__ == "__main__":
    # 디렉토리 생성
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Starting HuggingFace NLP MCP Server v1.0.0 on port {PORT}")
    print(f"HF Token configured: {bool(HF_TOKEN)}")
    print(f"Data directory: {DATA_DIR}")

    server.run(transport="streamable-http")
