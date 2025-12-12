"""
Kaggle MCP Server - 데이터셋 및 Kernels 연동

Kaggle 데이터셋 검색/다운로드 및 Kernel 실행을 위한 MCP 서버입니다.
원격 GPU를 활용한 ML 학습이 가능합니다.

Version: 1.0.0
Port: 5012
"""

import os
import json
import uuid
import asyncio
import subprocess
import shutil
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any
from pathlib import Path

import aiohttp
import aiofiles
from mcp.server import Server

# ─────────────────────────────────────────────
# 1. MCP 서버 기본 설정
# ─────────────────────────────────────────────

server = Server("kaggle-ml-mcp", version="1.0.0")

# Kaggle API 설정
KAGGLE_USERNAME = os.environ.get("KAGGLE_USERNAME", "")
KAGGLE_KEY = os.environ.get("KAGGLE_KEY", "")

# 공유 데이터 디렉토리
DATA_DIR = Path(os.environ.get("DATA_DIR", "/app/data"))
DATASETS_DIR = DATA_DIR / "datasets"
KERNELS_DIR = DATA_DIR / "kernels"
RESULTS_DIR = DATA_DIR / "results"

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
# 3. Kaggle API 초기화
# ─────────────────────────────────────────────


def setup_kaggle_credentials():
    """Kaggle 자격 증명을 설정합니다."""
    kaggle_dir = Path.home() / ".kaggle"
    kaggle_dir.mkdir(exist_ok=True)

    kaggle_json = kaggle_dir / "kaggle.json"

    if KAGGLE_USERNAME and KAGGLE_KEY:
        credentials = {"username": KAGGLE_USERNAME, "key": KAGGLE_KEY}
        with open(kaggle_json, "w") as f:
            json.dump(credentials, f)
        kaggle_json.chmod(0o600)
        return True

    return kaggle_json.exists()


def run_kaggle_command(args: List[str], cwd: Optional[Path] = None) -> Dict[str, Any]:
    """Kaggle CLI 명령을 실행합니다."""
    try:
        result = subprocess.run(
            ["kaggle"] + args, capture_output=True, text=True, timeout=300, cwd=cwd
        )
        return {
            "success": result.returncode == 0,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "error": "명령 실행 시간 초과 (5분)",
            "returncode": -1,
        }
    except Exception as e:
        return {"success": False, "error": str(e), "returncode": -1}


# ─────────────────────────────────────────────
# 4. 데이터셋 관련 함수
# ─────────────────────────────────────────────


async def search_datasets(
    query: str,
    sort_by: str = "hottest",
    file_type: Optional[str] = None,
    license_name: Optional[str] = None,
    max_size: Optional[int] = None,
    page: int = 1,
    page_size: int = 20,
) -> Dict[str, Any]:
    """
    Kaggle 데이터셋을 검색합니다.

    Args:
        query: 검색어
        sort_by: 정렬 기준 (hottest, votes, updated, relevance)
        file_type: 파일 타입 필터 (csv, json, sqlite 등)
        license_name: 라이센스 필터
        max_size: 최대 크기 (bytes)
        page: 페이지 번호
        page_size: 페이지 크기
    """
    args = ["datasets", "list", "-s", query, "--sort-by", sort_by]

    if file_type:
        args.extend(["--file-type", file_type])
    if license_name:
        args.extend(["--license-name", license_name])
    if max_size:
        args.extend(["--max-size", str(max_size)])

    args.extend(["-p", str(page)])
    args.extend(["--page-size", str(page_size)])
    args.extend(["--csv"])

    result = run_kaggle_command(args)

    if not result["success"]:
        return {"error": result.get("stderr") or result.get("error")}

    # CSV 파싱
    lines = result["stdout"].strip().split("\n")
    if len(lines) < 2:
        return {"datasets": [], "count": 0}

    headers = lines[0].split(",")
    datasets = []

    for line in lines[1:]:
        values = line.split(",")
        if len(values) >= len(headers):
            dataset = dict(zip(headers, values))
            datasets.append(dataset)

    return {
        "query": query,
        "sort_by": sort_by,
        "page": page,
        "datasets": datasets,
        "count": len(datasets),
    }


async def download_dataset(
    dataset_ref: str,
    job_id: str,
    unzip: bool = True,
) -> Dict[str, Any]:
    """
    데이터셋을 다운로드합니다.

    Args:
        dataset_ref: 데이터셋 참조 (예: "username/dataset-name")
        job_id: Job ID
        unzip: 압축 해제 여부
    """
    update_job(job_id, status=JobStatus.PROCESSING, progress=10)

    # 다운로드 디렉토리 생성
    dataset_dir = DATASETS_DIR / dataset_ref.replace("/", "_")
    dataset_dir.mkdir(parents=True, exist_ok=True)

    args = ["datasets", "download", "-d", dataset_ref, "-p", str(dataset_dir)]
    if unzip:
        args.append("--unzip")

    update_job(job_id, progress=30)

    result = run_kaggle_command(args)

    if not result["success"]:
        update_job(
            job_id,
            status=JobStatus.FAILED,
            error=result.get("stderr") or result.get("error"),
        )
        return {"error": result.get("stderr") or result.get("error")}

    update_job(job_id, progress=80)

    # 다운로드된 파일 목록
    files = []
    for f in dataset_dir.rglob("*"):
        if f.is_file():
            files.append(
                {
                    "name": f.name,
                    "path": str(f.relative_to(DATA_DIR)),
                    "size": f.stat().st_size,
                }
            )

    final_result = {
        "dataset_ref": dataset_ref,
        "download_path": str(dataset_dir),
        "files": files,
        "file_count": len(files),
        "total_size": sum(f["size"] for f in files),
    }

    update_job(job_id, status=JobStatus.COMPLETED, result=final_result, progress=100)
    return final_result


async def get_dataset_metadata(dataset_ref: str) -> Dict[str, Any]:
    """
    데이터셋 메타데이터를 조회합니다.
    """
    args = ["datasets", "metadata", "-d", dataset_ref]
    result = run_kaggle_command(args)

    if not result["success"]:
        return {"error": result.get("stderr") or result.get("error")}

    try:
        metadata = json.loads(result["stdout"])
        return metadata
    except json.JSONDecodeError:
        return {"raw_output": result["stdout"]}


# ─────────────────────────────────────────────
# 5. Kernel 관련 함수
# ─────────────────────────────────────────────


async def search_kernels(
    query: str,
    kernel_type: Optional[str] = None,
    output_type: Optional[str] = None,
    sort_by: str = "hotness",
    page: int = 1,
    page_size: int = 20,
) -> Dict[str, Any]:
    """
    Kaggle Kernels(Notebooks)를 검색합니다.

    Args:
        query: 검색어
        kernel_type: script, notebook
        output_type: all, visualization, data
        sort_by: hotness, commentCount, dateCreated, dateRun, relevance, voteCount
        page: 페이지 번호
        page_size: 페이지 크기
    """
    args = ["kernels", "list", "-s", query, "--sort-by", sort_by]

    if kernel_type:
        args.extend(["--kernel-type", kernel_type])
    if output_type:
        args.extend(["--output-type", output_type])

    args.extend(["-p", str(page)])
    args.extend(["--page-size", str(page_size)])
    args.extend(["--csv"])

    result = run_kaggle_command(args)

    if not result["success"]:
        return {"error": result.get("stderr") or result.get("error")}

    # CSV 파싱
    lines = result["stdout"].strip().split("\n")
    if len(lines) < 2:
        return {"kernels": [], "count": 0}

    headers = lines[0].split(",")
    kernels = []

    for line in lines[1:]:
        values = line.split(",")
        if len(values) >= len(headers):
            kernel = dict(zip(headers, values))
            kernels.append(kernel)

    return {
        "query": query,
        "sort_by": sort_by,
        "page": page,
        "kernels": kernels,
        "count": len(kernels),
    }


async def get_kernel_output(kernel_ref: str) -> Dict[str, Any]:
    """
    Kernel 실행 결과를 다운로드합니다.
    """
    output_dir = RESULTS_DIR / kernel_ref.replace("/", "_")
    output_dir.mkdir(parents=True, exist_ok=True)

    args = ["kernels", "output", kernel_ref, "-p", str(output_dir)]
    result = run_kaggle_command(args)

    if not result["success"]:
        return {"error": result.get("stderr") or result.get("error")}

    # 다운로드된 파일 목록
    files = []
    for f in output_dir.rglob("*"):
        if f.is_file():
            files.append(
                {
                    "name": f.name,
                    "path": str(f.relative_to(DATA_DIR)),
                    "size": f.stat().st_size,
                }
            )

    return {
        "kernel_ref": kernel_ref,
        "output_path": str(output_dir),
        "files": files,
        "file_count": len(files),
    }


async def push_kernel(
    job_id: str,
    kernel_name: str,
    code_file: str,
    language: str = "python",
    kernel_type: str = "script",
    dataset_sources: Optional[List[str]] = None,
    competition_sources: Optional[List[str]] = None,
    enable_gpu: bool = False,
    enable_internet: bool = True,
) -> Dict[str, Any]:
    """
    새로운 Kernel을 Kaggle에 푸시합니다 (원격 실행용).

    Args:
        job_id: Job ID
        kernel_name: 커널 이름
        code_file: 코드 파일 경로 (DATA_DIR 기준)
        language: python, r
        kernel_type: script, notebook
        dataset_sources: 사용할 데이터셋 목록
        competition_sources: 사용할 competition 목록
        enable_gpu: GPU 사용 여부
        enable_internet: 인터넷 사용 여부
    """
    update_job(job_id, status=JobStatus.PROCESSING, progress=10)

    if not KAGGLE_USERNAME:
        update_job(
            job_id,
            status=JobStatus.FAILED,
            error="KAGGLE_USERNAME이 설정되지 않았습니다.",
        )
        return {"error": "KAGGLE_USERNAME이 설정되지 않았습니다."}

    # 커널 디렉토리 생성
    kernel_dir = KERNELS_DIR / kernel_name
    kernel_dir.mkdir(parents=True, exist_ok=True)

    # 코드 파일 복사
    source_file = DATA_DIR / code_file
    if not source_file.exists():
        update_job(
            job_id,
            status=JobStatus.FAILED,
            error=f"코드 파일을 찾을 수 없습니다: {code_file}",
        )
        return {"error": f"코드 파일을 찾을 수 없습니다: {code_file}"}

    target_file = kernel_dir / source_file.name
    shutil.copy(source_file, target_file)

    update_job(job_id, progress=30)

    # kernel-metadata.json 생성
    kernel_slug = f"{KAGGLE_USERNAME}/{kernel_name}"
    metadata = {
        "id": kernel_slug,
        "title": kernel_name,
        "code_file": source_file.name,
        "language": language,
        "kernel_type": kernel_type,
        "is_private": True,
        "enable_gpu": enable_gpu,
        "enable_internet": enable_internet,
    }

    if dataset_sources:
        metadata["dataset_sources"] = dataset_sources
    if competition_sources:
        metadata["competition_sources"] = competition_sources

    metadata_file = kernel_dir / "kernel-metadata.json"
    with open(metadata_file, "w") as f:
        json.dump(metadata, f, indent=2)

    update_job(job_id, progress=50)

    # Kernel 푸시
    args = ["kernels", "push", "-p", str(kernel_dir)]
    result = run_kaggle_command(args)

    if not result["success"]:
        update_job(
            job_id,
            status=JobStatus.FAILED,
            error=result.get("stderr") or result.get("error"),
        )
        return {"error": result.get("stderr") or result.get("error")}

    update_job(job_id, progress=80)

    final_result = {
        "kernel_slug": kernel_slug,
        "kernel_url": f"https://www.kaggle.com/code/{kernel_slug}",
        "status": "pushed",
        "message": result["stdout"],
        "gpu_enabled": enable_gpu,
        "note": "커널이 Kaggle에 제출되었습니다. 실행 완료까지 시간이 걸릴 수 있습니다.",
    }

    update_job(job_id, status=JobStatus.COMPLETED, result=final_result, progress=100)
    return final_result


async def check_kernel_status(kernel_ref: str) -> Dict[str, Any]:
    """
    Kernel 실행 상태를 확인합니다.
    """
    args = ["kernels", "status", kernel_ref]
    result = run_kaggle_command(args)

    if not result["success"]:
        return {"error": result.get("stderr") or result.get("error")}

    # 상태 파싱
    output = result["stdout"].strip()
    status_map = {
        "queued": "대기 중",
        "running": "실행 중",
        "complete": "완료",
        "error": "오류",
        "cancelAcknowledged": "취소됨",
    }

    return {
        "kernel_ref": kernel_ref,
        "raw_status": output,
        "status_kr": status_map.get(output.lower(), output),
        "kernel_url": f"https://www.kaggle.com/code/{kernel_ref}",
    }


# ─────────────────────────────────────────────
# 6. MCP Tools
# ─────────────────────────────────────────────


@server.tool()
async def search_kaggle_datasets(
    query: str,
    sort_by: str = "hottest",
    file_type: Optional[str] = None,
    max_size_mb: Optional[int] = None,
    page: int = 1,
) -> Dict[str, Any]:
    """
    Kaggle에서 데이터셋을 검색합니다.

    뉴스 분석, 텍스트 분류 등에 활용할 수 있는 데이터셋을 찾습니다.

    Args:
        query: 검색어 (예: "news classification", "sentiment analysis")
        sort_by: 정렬 기준 (hottest, votes, updated, relevance)
        file_type: 파일 타입 필터 (csv, json, sqlite 등)
        max_size_mb: 최대 크기 (MB)
        page: 페이지 번호

    Returns:
        검색된 데이터셋 목록
    """
    max_size = max_size_mb * 1024 * 1024 if max_size_mb else None
    result = await search_datasets(
        query=query, sort_by=sort_by, file_type=file_type, max_size=max_size, page=page
    )
    result["searched_at"] = datetime.utcnow().isoformat()
    return result


@server.tool()
async def download_kaggle_dataset(
    dataset_ref: str,
    unzip: bool = True,
) -> Dict[str, Any]:
    """
    Kaggle 데이터셋을 다운로드합니다.

    Args:
        dataset_ref: 데이터셋 참조 (예: "username/dataset-name")
        unzip: 압축 해제 여부

    Returns:
        Job ID - get_job_status로 진행 상황 확인
    """
    job_id = create_job(
        "dataset_download", {"dataset_ref": dataset_ref, "unzip": unzip}
    )

    asyncio.create_task(download_dataset(dataset_ref, job_id, unzip))

    return {
        "job_id": job_id,
        "status": JobStatus.PENDING,
        "dataset_ref": dataset_ref,
        "message": f"다운로드가 시작되었습니다. get_job_status('{job_id}')로 진행 상황을 확인하세요.",
    }


@server.tool()
async def get_dataset_info(
    dataset_ref: str,
) -> Dict[str, Any]:
    """
    데이터셋의 상세 정보를 조회합니다.

    Args:
        dataset_ref: 데이터셋 참조 (예: "username/dataset-name")

    Returns:
        데이터셋 메타데이터 (크기, 파일 목록, 설명 등)
    """
    return await get_dataset_metadata(dataset_ref)


@server.tool()
async def search_kaggle_kernels(
    query: str,
    kernel_type: Optional[str] = None,
    sort_by: str = "hotness",
    page: int = 1,
) -> Dict[str, Any]:
    """
    Kaggle Kernels(Notebooks)를 검색합니다.

    ML 학습 코드, 데이터 분석 코드 등을 찾습니다.

    Args:
        query: 검색어 (예: "news classification bert")
        kernel_type: script, notebook
        sort_by: hotness, commentCount, dateCreated, relevance, voteCount
        page: 페이지 번호

    Returns:
        검색된 커널 목록
    """
    result = await search_kernels(
        query=query, kernel_type=kernel_type, sort_by=sort_by, page=page
    )
    result["searched_at"] = datetime.utcnow().isoformat()
    return result


@server.tool()
async def submit_training_kernel(
    kernel_name: str,
    code_file: str,
    dataset_sources: Optional[List[str]] = None,
    enable_gpu: bool = False,
) -> Dict[str, Any]:
    """
    ML 학습 Kernel을 Kaggle에 제출합니다 (원격 GPU 실행).

    코드 파일을 Kaggle에 업로드하고 원격으로 실행합니다.
    Kaggle의 무료 GPU/TPU를 활용할 수 있습니다.

    Args:
        kernel_name: 커널 이름 (고유해야 함)
        code_file: 코드 파일 경로 (DATA_DIR 기준, 예: "scripts/train.py")
        dataset_sources: 사용할 데이터셋 목록 (예: ["username/dataset-name"])
        enable_gpu: GPU 사용 여부 (P100 GPU)

    Returns:
        Job ID - get_job_status로 진행 상황 확인
    """
    job_id = create_job(
        "kernel_push",
        {"kernel_name": kernel_name, "code_file": code_file, "enable_gpu": enable_gpu},
    )

    asyncio.create_task(
        push_kernel(
            job_id=job_id,
            kernel_name=kernel_name,
            code_file=code_file,
            dataset_sources=dataset_sources,
            enable_gpu=enable_gpu,
        )
    )

    return {
        "job_id": job_id,
        "status": JobStatus.PENDING,
        "kernel_name": kernel_name,
        "gpu_enabled": enable_gpu,
        "message": f"커널 제출이 시작되었습니다. get_job_status('{job_id}')로 진행 상황을 확인하세요.",
    }


@server.tool()
async def get_kernel_status(
    kernel_ref: str,
) -> Dict[str, Any]:
    """
    제출된 Kernel의 실행 상태를 확인합니다.

    Args:
        kernel_ref: 커널 참조 (예: "username/kernel-name")

    Returns:
        커널 실행 상태 (queued, running, complete, error)
    """
    return await check_kernel_status(kernel_ref)


@server.tool()
async def download_kernel_output(
    kernel_ref: str,
) -> Dict[str, Any]:
    """
    완료된 Kernel의 출력 파일을 다운로드합니다.

    학습된 모델 파일, 결과 CSV 등을 가져옵니다.

    Args:
        kernel_ref: 커널 참조 (예: "username/kernel-name")

    Returns:
        다운로드된 파일 목록
    """
    return await get_kernel_output(kernel_ref)


@server.tool()
async def list_local_datasets() -> Dict[str, Any]:
    """
    로컬에 다운로드된 데이터셋 목록을 조회합니다.

    Returns:
        로컬 데이터셋 목록 및 파일 정보
    """
    DATASETS_DIR.mkdir(parents=True, exist_ok=True)

    datasets = []
    for dataset_dir in DATASETS_DIR.iterdir():
        if dataset_dir.is_dir():
            files = []
            total_size = 0
            for f in dataset_dir.rglob("*"):
                if f.is_file():
                    size = f.stat().st_size
                    files.append(
                        {
                            "name": f.name,
                            "path": str(f.relative_to(DATA_DIR)),
                            "size": size,
                        }
                    )
                    total_size += size

            datasets.append(
                {
                    "name": dataset_dir.name,
                    "path": str(dataset_dir.relative_to(DATA_DIR)),
                    "files": files[:10],  # 처음 10개만
                    "file_count": len(files),
                    "total_size": total_size,
                    "total_size_mb": round(total_size / 1024 / 1024, 2),
                }
            )

    return {"datasets": datasets, "count": len(datasets), "data_dir": str(DATA_DIR)}


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
async def health_check() -> Dict[str, Any]:
    """
    서버 상태 및 Kaggle API 연결 상태를 확인합니다.

    Returns:
        서버 상태 정보
    """
    # 자격 증명 설정
    credentials_ok = setup_kaggle_credentials()

    status = {
        "server": "Kaggle ML MCP",
        "version": "1.0.0",
        "status": "running",
        "timestamp": datetime.utcnow().isoformat(),
        "credentials_configured": bool(KAGGLE_USERNAME and KAGGLE_KEY),
        "credentials_file_exists": credentials_ok,
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
    if credentials_ok:
        test_result = run_kaggle_command(
            ["datasets", "list", "-s", "test", "--page-size", "1"]
        )
        if test_result["success"]:
            status["kaggle_api"] = "connected"
        else:
            status["kaggle_api"] = f"error: {test_result.get('stderr', 'unknown')}"
            status["status"] = "degraded"
    else:
        status["kaggle_api"] = "not_configured"
        status["status"] = "degraded"

    return status


# ─────────────────────────────────────────────
# 7. HTTP 헬스체크 핸들러
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
                "server": "kaggle-ml-mcp",
                "version": "1.0.0",
            }
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


# ─────────────────────────────────────────────
# 8. 서버 시작
# ─────────────────────────────────────────────

if __name__ == "__main__":
    # 디렉토리 생성
    DATASETS_DIR.mkdir(parents=True, exist_ok=True)
    KERNELS_DIR.mkdir(parents=True, exist_ok=True)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    # Kaggle 자격 증명 설정
    setup_kaggle_credentials()

    port = int(os.environ.get("PORT", "5012"))
    print(f"Starting Kaggle ML MCP Server v1.0.0 on port {port}")
    print(f"Kaggle credentials configured: {bool(KAGGLE_USERNAME and KAGGLE_KEY)}")
    print(f"Data directory: {DATA_DIR}")

    server.run_http(host="0.0.0.0", port=port, path="/mcp")
