"""
Roboflow MCP Server - Computer Vision 이미지 분석

뉴스 기사 이미지의 객체 탐지, 분류, 텍스트 추출(OCR) 등을 수행하는 MCP 서버입니다.
Roboflow API와 연동하여 다양한 CV 모델을 활용합니다.

Version: 1.0.0
Port: 5010
"""

import os
import json
import uuid
import asyncio
import base64
import hashlib
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any, Union
from pathlib import Path
from urllib.parse import urlparse
import io

import aiohttp
import aiofiles
from mcp.server import FastMCP
from starlette.responses import JSONResponse
from starlette.requests import Request

# ─────────────────────────────────────────────
# 1. MCP 서버 기본 설정
# ─────────────────────────────────────────────

# 포트 설정 (환경변수에서 읽음)
PORT = int(os.environ.get("PORT", "5010"))

server = FastMCP(
    "roboflow-cv-mcp",
    host="0.0.0.0",
    port=PORT,
)


# Health check endpoint
@server.custom_route("/health", methods=["GET"])
async def health_endpoint(request: Request) -> JSONResponse:
    return JSONResponse(
        {
            "status": "healthy",
            "server": "roboflow-cv-mcp",
            "version": "1.0.0",
        }
    )


# Roboflow API 설정
ROBOFLOW_API_KEY = os.environ.get("ROBOFLOW_API_KEY", "")
ROBOFLOW_API_URL = "https://detect.roboflow.com"
ROBOFLOW_INFER_URL = "https://infer.roboflow.com"
ROBOFLOW_UPLOAD_URL = "https://api.roboflow.com"

# 공유 데이터 디렉토리
DATA_DIR = Path(os.environ.get("DATA_DIR", "/app/data"))
CACHE_DIR = DATA_DIR / "cache"
RESULTS_DIR = DATA_DIR / "results"

# Job Queue 설정
JOB_TIMEOUT = int(os.environ.get("JOB_TIMEOUT", "300"))  # 5분
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "2"))

# ─────────────────────────────────────────────
# 2. Job Queue 관리 (In-Memory)
# ─────────────────────────────────────────────


class JobStatus:
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


# Job 저장소 (실제 운영에서는 Redis 등 사용)
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


def cleanup_old_jobs(max_age_hours: int = 24):
    """오래된 Job을 정리합니다."""
    cutoff = datetime.utcnow() - timedelta(hours=max_age_hours)
    to_delete = []
    for job_id, job in _jobs.items():
        created = datetime.fromisoformat(job["created_at"])
        if created < cutoff:
            to_delete.append(job_id)
    for job_id in to_delete:
        del _jobs[job_id]


# ─────────────────────────────────────────────
# 3. 이미지 처리 유틸리티
# ─────────────────────────────────────────────


async def download_image(url: str) -> bytes:
    """URL에서 이미지를 다운로드합니다."""
    async with aiohttp.ClientSession() as session:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
            if resp.status != 200:
                raise Exception(f"이미지 다운로드 실패: HTTP {resp.status}")
            return await resp.read()


def encode_image_base64(image_bytes: bytes) -> str:
    """이미지를 base64로 인코딩합니다."""
    return base64.b64encode(image_bytes).decode("utf-8")


def get_image_hash(image_bytes: bytes) -> str:
    """이미지 해시를 계산합니다 (캐싱용)."""
    return hashlib.md5(image_bytes).hexdigest()


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
# 4. Roboflow API 클라이언트
# ─────────────────────────────────────────────


class RoboflowClient:
    """Roboflow API 클라이언트"""

    def __init__(self, api_key: str):
        self.api_key = api_key

    async def detect_objects(
        self,
        image_source: Union[str, bytes],
        model_id: str = "yolov8n-640",
        confidence: float = 0.4,
        overlap: float = 0.3,
    ) -> Dict[str, Any]:
        """
        객체 탐지를 수행합니다.

        Args:
            image_source: 이미지 URL 또는 bytes
            model_id: Roboflow 모델 ID (예: "coco/3")
            confidence: 신뢰도 임계값
            overlap: IoU 임계값
        """
        # 이미지 준비
        if isinstance(image_source, str) and image_source.startswith(
            ("http://", "https://")
        ):
            image_bytes = await download_image(image_source)
        elif isinstance(image_source, str):
            # base64 문자열
            image_bytes = base64.b64decode(image_source)
        else:
            image_bytes = image_source

        image_b64 = encode_image_base64(image_bytes)

        # API 호출
        url = f"{ROBOFLOW_INFER_URL}/{model_id}"
        params = {
            "api_key": self.api_key,
            "confidence": confidence,
            "overlap": overlap,
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                params=params,
                data=image_b64,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=aiohttp.ClientTimeout(total=60),
            ) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    raise Exception(f"Roboflow API 오류: {resp.status} - {text}")
                return await resp.json()

    async def classify_image(
        self,
        image_source: Union[str, bytes],
        model_id: str,
    ) -> Dict[str, Any]:
        """
        이미지 분류를 수행합니다.

        Args:
            image_source: 이미지 URL 또는 bytes
            model_id: Roboflow 분류 모델 ID
        """
        if isinstance(image_source, str) and image_source.startswith(
            ("http://", "https://")
        ):
            image_bytes = await download_image(image_source)
        elif isinstance(image_source, str):
            image_bytes = base64.b64decode(image_source)
        else:
            image_bytes = image_source

        image_b64 = encode_image_base64(image_bytes)

        url = f"{ROBOFLOW_INFER_URL}/{model_id}"
        params = {"api_key": self.api_key}

        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                params=params,
                data=image_b64,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=aiohttp.ClientTimeout(total=60),
            ) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    raise Exception(f"Roboflow API 오류: {resp.status} - {text}")
                return await resp.json()

    async def ocr_image(
        self,
        image_source: Union[str, bytes],
    ) -> Dict[str, Any]:
        """
        이미지에서 텍스트를 추출합니다 (OCR).
        Roboflow의 DocTR 모델을 사용합니다.

        Args:
            image_source: 이미지 URL 또는 bytes
        """
        if isinstance(image_source, str) and image_source.startswith(
            ("http://", "https://")
        ):
            image_bytes = await download_image(image_source)
        elif isinstance(image_source, str):
            image_bytes = base64.b64decode(image_source)
        else:
            image_bytes = image_source

        image_b64 = encode_image_base64(image_bytes)

        # DocTR OCR 모델
        url = f"{ROBOFLOW_INFER_URL}/doctr/ocr"
        params = {"api_key": self.api_key}

        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                params=params,
                data=image_b64,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=aiohttp.ClientTimeout(total=60),
            ) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    raise Exception(f"Roboflow OCR API 오류: {resp.status} - {text}")
                return await resp.json()

    async def list_workspaces(self) -> Dict[str, Any]:
        """사용 가능한 워크스페이스 목록을 조회합니다."""
        url = f"{ROBOFLOW_UPLOAD_URL}/"
        params = {"api_key": self.api_key}

        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    raise Exception(f"Roboflow API 오류: {resp.status} - {text}")
                return await resp.json()

    async def list_projects(self, workspace: str) -> Dict[str, Any]:
        """워크스페이스의 프로젝트 목록을 조회합니다."""
        url = f"{ROBOFLOW_UPLOAD_URL}/{workspace}"
        params = {"api_key": self.api_key}

        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    raise Exception(f"Roboflow API 오류: {resp.status} - {text}")
                return await resp.json()

    async def get_model_info(
        self, workspace: str, project: str, version: int
    ) -> Dict[str, Any]:
        """모델 버전 정보를 조회합니다."""
        url = f"{ROBOFLOW_UPLOAD_URL}/{workspace}/{project}/{version}"
        params = {"api_key": self.api_key}

        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    raise Exception(f"Roboflow API 오류: {resp.status} - {text}")
                return await resp.json()


# 전역 클라이언트 인스턴스
_roboflow_client: Optional[RoboflowClient] = None


def get_roboflow_client() -> RoboflowClient:
    """Roboflow 클라이언트를 반환합니다."""
    global _roboflow_client
    if _roboflow_client is None:
        if not ROBOFLOW_API_KEY:
            raise RuntimeError("ROBOFLOW_API_KEY가 설정되어 있지 않습니다.")
        _roboflow_client = RoboflowClient(ROBOFLOW_API_KEY)
    return _roboflow_client


# ─────────────────────────────────────────────
# 5. 뉴스 이미지 분석 기능
# ─────────────────────────────────────────────


async def analyze_news_image(
    image_source: Union[str, bytes],
    analyze_objects: bool = True,
    analyze_text: bool = True,
    custom_model_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    뉴스 기사 이미지를 종합적으로 분석합니다.

    - 객체 탐지: 사람, 차량, 건물 등 주요 객체 식별
    - OCR: 이미지 내 텍스트 추출 (간판, 현수막, 자막 등)
    """
    client = get_roboflow_client()
    result = {
        "analyzed_at": datetime.utcnow().isoformat(),
        "objects": None,
        "text": None,
        "summary": {},
    }

    # 객체 탐지
    if analyze_objects:
        try:
            model_id = custom_model_id or "coco/3"  # COCO 모델 사용
            objects_result = await client.detect_objects(
                image_source,
                model_id=model_id,
                confidence=0.3,
            )
            result["objects"] = objects_result

            # 탐지된 객체 요약
            if "predictions" in objects_result:
                class_counts = {}
                for pred in objects_result["predictions"]:
                    cls = pred.get("class", "unknown")
                    class_counts[cls] = class_counts.get(cls, 0) + 1
                result["summary"]["detected_objects"] = class_counts
                result["summary"]["object_count"] = len(objects_result["predictions"])
        except Exception as e:
            result["objects"] = {"error": str(e)}

    # OCR
    if analyze_text:
        try:
            ocr_result = await client.ocr_image(image_source)
            result["text"] = ocr_result

            # 추출된 텍스트 요약
            if "result" in ocr_result:
                extracted_text = []
                for page in ocr_result.get("result", {}).get("pages", []):
                    for block in page.get("blocks", []):
                        for line in block.get("lines", []):
                            text = " ".join(
                                w.get("value", "") for w in line.get("words", [])
                            )
                            if text.strip():
                                extracted_text.append(text.strip())
                result["summary"]["extracted_text"] = extracted_text
                result["summary"]["text_line_count"] = len(extracted_text)
        except Exception as e:
            result["text"] = {"error": str(e)}

    return result


# ─────────────────────────────────────────────
# 6. 배치 처리 기능
# ─────────────────────────────────────────────


async def process_batch_images(
    job_id: str,
    image_sources: List[str],
    analyze_objects: bool = True,
    analyze_text: bool = True,
) -> Dict[str, Any]:
    """
    여러 이미지를 배치로 처리합니다.
    Job Queue 패턴으로 진행 상황을 추적합니다.
    """
    update_job(job_id, status=JobStatus.PROCESSING, progress=0)

    results = []
    total = len(image_sources)

    for idx, source in enumerate(image_sources):
        try:
            result = await analyze_news_image(
                source,
                analyze_objects=analyze_objects,
                analyze_text=analyze_text,
            )
            results.append(
                {
                    "source": source[:100] if isinstance(source, str) else "bytes",
                    "success": True,
                    "result": result,
                }
            )
        except Exception as e:
            results.append(
                {
                    "source": source[:100] if isinstance(source, str) else "bytes",
                    "success": False,
                    "error": str(e),
                }
            )

        # 진행 상황 업데이트
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
async def detect_objects(
    image_url: str,
    model_id: str = "coco/3",
    confidence: float = 0.4,
) -> Dict[str, Any]:
    """
    이미지에서 객체를 탐지합니다.

    Args:
        image_url: 분석할 이미지 URL
        model_id: Roboflow 모델 ID (기본: coco/3 - COCO 데이터셋 학습 모델)
        confidence: 신뢰도 임계값 (0.0-1.0)

    Returns:
        탐지된 객체 목록 (위치, 클래스, 신뢰도)
    """
    client = get_roboflow_client()
    result = await client.detect_objects(
        image_url,
        model_id=model_id,
        confidence=confidence,
    )

    # 결과 정리
    predictions = result.get("predictions", [])
    summary = {}
    for pred in predictions:
        cls = pred.get("class", "unknown")
        summary[cls] = summary.get(cls, 0) + 1

    return {
        "model_id": model_id,
        "image_width": result.get("image", {}).get("width"),
        "image_height": result.get("image", {}).get("height"),
        "object_count": len(predictions),
        "class_summary": summary,
        "predictions": predictions,
        "analyzed_at": datetime.utcnow().isoformat(),
    }


@server.tool()
async def extract_text_ocr(
    image_url: str,
) -> Dict[str, Any]:
    """
    이미지에서 텍스트를 추출합니다 (OCR).

    뉴스 이미지의 자막, 간판, 현수막 등의 텍스트를 읽을 수 있습니다.

    Args:
        image_url: 분석할 이미지 URL

    Returns:
        추출된 텍스트 및 위치 정보
    """
    client = get_roboflow_client()
    result = await client.ocr_image(image_url)

    # 텍스트 추출 및 정리
    extracted_lines = []
    full_text = []

    for page in result.get("result", {}).get("pages", []):
        for block in page.get("blocks", []):
            for line in block.get("lines", []):
                words = [w.get("value", "") for w in line.get("words", [])]
                line_text = " ".join(words).strip()
                if line_text:
                    extracted_lines.append(
                        {
                            "text": line_text,
                            "geometry": line.get("geometry"),
                        }
                    )
                    full_text.append(line_text)

    return {
        "full_text": "\n".join(full_text),
        "line_count": len(extracted_lines),
        "lines": extracted_lines,
        "analyzed_at": datetime.utcnow().isoformat(),
    }


@server.tool()
async def analyze_news_image_full(
    image_url: str,
    include_objects: bool = True,
    include_text: bool = True,
) -> Dict[str, Any]:
    """
    뉴스 이미지를 종합적으로 분석합니다.

    객체 탐지와 OCR을 함께 수행하여 이미지의 전체적인 내용을 파악합니다.

    Args:
        image_url: 분석할 이미지 URL
        include_objects: 객체 탐지 포함 여부
        include_text: OCR 텍스트 추출 포함 여부

    Returns:
        종합 분석 결과 (객체, 텍스트, 요약)
    """
    result = await analyze_news_image(
        image_url,
        analyze_objects=include_objects,
        analyze_text=include_text,
    )
    return result


@server.tool()
async def start_batch_analysis(
    image_urls: List[str],
    include_objects: bool = True,
    include_text: bool = True,
) -> Dict[str, Any]:
    """
    여러 이미지를 배치로 분석하는 Job을 시작합니다.

    대량의 뉴스 이미지를 비동기로 처리합니다.
    Job ID를 반환하며, get_job_status로 진행 상황을 확인할 수 있습니다.

    Args:
        image_urls: 분석할 이미지 URL 목록
        include_objects: 객체 탐지 포함 여부
        include_text: OCR 텍스트 추출 포함 여부

    Returns:
        Job ID 및 예상 처리 시간
    """
    if not image_urls:
        return {"error": "이미지 URL이 필요합니다."}

    if len(image_urls) > 100:
        return {"error": "한 번에 최대 100개 이미지만 처리할 수 있습니다."}

    job_id = create_job(
        "batch_analysis",
        {
            "image_count": len(image_urls),
            "include_objects": include_objects,
            "include_text": include_text,
        },
    )

    # 비동기 처리 시작
    asyncio.create_task(
        process_batch_images(
            job_id,
            image_urls,
            analyze_objects=include_objects,
            analyze_text=include_text,
        )
    )

    return {
        "job_id": job_id,
        "status": JobStatus.PENDING,
        "image_count": len(image_urls),
        "estimated_time_seconds": len(image_urls) * 3,  # 이미지당 약 3초
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
        Job 상태 (pending/processing/completed/failed), 진행률, 결과
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
async def list_available_models() -> Dict[str, Any]:
    """
    NewsInsight에서 사용 가능한 Roboflow 모델 목록을 반환합니다.

    Returns:
        사용 가능한 모델 목록 및 설명
    """
    # 기본 제공 모델 + Roboflow Universe 인기 모델
    models = [
        {
            "id": "coco/3",
            "name": "COCO Object Detection",
            "description": "80개 일반 객체 탐지 (사람, 차량, 동물 등)",
            "type": "object_detection",
            "classes": 80,
        },
        {
            "id": "yolov8n-640",
            "name": "YOLOv8 Nano",
            "description": "빠른 일반 객체 탐지",
            "type": "object_detection",
            "classes": 80,
        },
        {
            "id": "doctr/ocr",
            "name": "DocTR OCR",
            "description": "문서 및 이미지 텍스트 인식",
            "type": "ocr",
            "classes": None,
        },
        {
            "id": "face-detection-mik1i/3",
            "name": "Face Detection",
            "description": "얼굴 탐지",
            "type": "object_detection",
            "classes": 1,
        },
    ]

    # Roboflow 워크스페이스의 커스텀 모델 조회 시도
    custom_models = []
    try:
        client = get_roboflow_client()
        workspaces = await client.list_workspaces()
        for ws in workspaces.get("workspaces", []):
            ws_name = ws.get("name", "")
            if ws_name:
                try:
                    projects = await client.list_projects(ws_name)
                    for proj in projects.get("projects", []):
                        if proj.get("versions"):
                            latest = max(proj["versions"])
                            custom_models.append(
                                {
                                    "id": f"{ws_name}/{proj['id']}/{latest}",
                                    "name": proj.get("name", proj["id"]),
                                    "description": f"Custom model: {proj.get('annotation', '')}",
                                    "type": proj.get("type", "object_detection"),
                                    "classes": proj.get("classes", {}).keys()
                                    if proj.get("classes")
                                    else None,
                                }
                            )
                except:
                    pass
    except:
        pass

    return {
        "builtin_models": models,
        "custom_models": custom_models,
        "note": "custom_models는 Roboflow 워크스페이스에 등록된 모델입니다.",
    }


@server.tool()
async def health_check() -> Dict[str, Any]:
    """
    서버 상태 및 Roboflow API 연결 상태를 확인합니다.

    Returns:
        서버 상태 정보
    """
    status = {
        "server": "Roboflow CV MCP",
        "version": "1.0.0",
        "status": "running",
        "timestamp": datetime.utcnow().isoformat(),
        "api_key_configured": bool(ROBOFLOW_API_KEY),
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
    if ROBOFLOW_API_KEY:
        try:
            client = get_roboflow_client()
            await client.list_workspaces()
            status["roboflow_api"] = "connected"
        except Exception as e:
            status["roboflow_api"] = f"error: {str(e)}"
            status["status"] = "degraded"
    else:
        status["roboflow_api"] = "not_configured"
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
                "server": "roboflow-cv-mcp",
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

    print(f"Starting Roboflow CV MCP Server v1.0.0 on port {PORT}")
    print(f"API Key configured: {bool(ROBOFLOW_API_KEY)}")
    print(f"Data directory: {DATA_DIR}")

    server.run(transport="streamable-http")
