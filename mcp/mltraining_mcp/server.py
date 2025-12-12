"""
ML Training Orchestrator MCP Server - 통합 ML 워크플로우 관리

여러 ML MCP 서버(Roboflow, HuggingFace, Kaggle)를 오케스트레이션하여
뉴스 분석을 위한 종합적인 ML 워크플로우를 제공합니다.

Version: 1.0.0
Port: 5020
"""

import os
import json
import uuid
import asyncio
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any, Callable
from pathlib import Path
from enum import Enum

import aiohttp
import aiofiles
import yaml
from mcp.server import Server

# ─────────────────────────────────────────────
# 1. MCP 서버 기본 설정
# ─────────────────────────────────────────────

server = Server("ml-training-orchestrator", version="1.0.0")

# 하위 MCP 서버 URL
ROBOFLOW_MCP_URL = os.environ.get("ROBOFLOW_MCP_URL", "http://roboflow-mcp:5010")
HUGGINGFACE_MCP_URL = os.environ.get(
    "HUGGINGFACE_MCP_URL", "http://huggingface-mcp:5011"
)
KAGGLE_MCP_URL = os.environ.get("KAGGLE_MCP_URL", "http://kaggle-mcp:5012")

# 공유 데이터 디렉토리
DATA_DIR = Path(os.environ.get("DATA_DIR", "/app/data"))
WORKFLOWS_DIR = DATA_DIR / "workflows"
PIPELINES_DIR = DATA_DIR / "pipelines"

# ─────────────────────────────────────────────
# 2. 워크플로우 상태 관리
# ─────────────────────────────────────────────


class WorkflowStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class StepStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


# 워크플로우 저장소
_workflows: Dict[str, Dict[str, Any]] = {}


def create_workflow(name: str, description: str, steps: List[Dict]) -> str:
    """새 워크플로우를 생성합니다."""
    workflow_id = str(uuid.uuid4())
    _workflows[workflow_id] = {
        "id": workflow_id,
        "name": name,
        "description": description,
        "status": WorkflowStatus.PENDING,
        "steps": [
            {
                **step,
                "status": StepStatus.PENDING,
                "result": None,
                "error": None,
                "started_at": None,
                "completed_at": None,
            }
            for step in steps
        ],
        "current_step": 0,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
        "completed_at": None,
    }
    return workflow_id


def update_workflow(workflow_id: str, **kwargs):
    """워크플로우 상태를 업데이트합니다."""
    if workflow_id in _workflows:
        _workflows[workflow_id].update(kwargs)
        _workflows[workflow_id]["updated_at"] = datetime.utcnow().isoformat()


def get_workflow(workflow_id: str) -> Optional[Dict[str, Any]]:
    """워크플로우 정보를 조회합니다."""
    return _workflows.get(workflow_id)


# ─────────────────────────────────────────────
# 3. MCP 클라이언트 (하위 서버 호출)
# ─────────────────────────────────────────────


class MCPClient:
    """하위 MCP 서버 호출 클라이언트"""

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    async def call_tool(self, tool_name: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """MCP 도구를 호출합니다."""
        url = f"{self.base_url}/mcp"

        payload = {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": params},
            "id": str(uuid.uuid4()),
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(
                url, json=payload, timeout=aiohttp.ClientTimeout(total=300)
            ) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    raise Exception(f"MCP 호출 실패: {resp.status} - {text}")

                result = await resp.json()
                if "error" in result:
                    raise Exception(f"MCP 오류: {result['error']}")

                return result.get("result", {})

    async def health_check(self) -> bool:
        """서버 상태를 확인합니다."""
        try:
            url = f"{self.base_url}/health"
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    url, timeout=aiohttp.ClientTimeout(total=10)
                ) as resp:
                    return resp.status == 200
        except:
            return False


# 클라이언트 인스턴스
roboflow_client = MCPClient(ROBOFLOW_MCP_URL)
huggingface_client = MCPClient(HUGGINGFACE_MCP_URL)
kaggle_client = MCPClient(KAGGLE_MCP_URL)


# ─────────────────────────────────────────────
# 4. 워크플로우 실행 엔진
# ─────────────────────────────────────────────


async def execute_step(
    workflow_id: str, step_index: int, step: Dict[str, Any], context: Dict[str, Any]
) -> Dict[str, Any]:
    """단일 스텝을 실행합니다."""
    workflow = get_workflow(workflow_id)
    if not workflow:
        raise Exception(f"워크플로우를 찾을 수 없습니다: {workflow_id}")

    # 스텝 시작
    workflow["steps"][step_index]["status"] = StepStatus.RUNNING
    workflow["steps"][step_index]["started_at"] = datetime.utcnow().isoformat()
    update_workflow(workflow_id, current_step=step_index)

    try:
        # 파라미터 템플릿 처리 (이전 스텝 결과 참조)
        params = resolve_params(step.get("params", {}), context)

        # MCP 서버 선택 및 도구 호출
        service = step.get("service", "").lower()
        tool = step.get("tool", "")

        if service == "roboflow":
            result = await roboflow_client.call_tool(tool, params)
        elif service == "huggingface":
            result = await huggingface_client.call_tool(tool, params)
        elif service == "kaggle":
            result = await kaggle_client.call_tool(tool, params)
        elif service == "internal":
            result = await execute_internal_function(tool, params, context)
        else:
            raise Exception(f"알 수 없는 서비스: {service}")

        # 스텝 완료
        workflow["steps"][step_index]["status"] = StepStatus.COMPLETED
        workflow["steps"][step_index]["result"] = result
        workflow["steps"][step_index]["completed_at"] = datetime.utcnow().isoformat()

        return result

    except Exception as e:
        workflow["steps"][step_index]["status"] = StepStatus.FAILED
        workflow["steps"][step_index]["error"] = str(e)
        workflow["steps"][step_index]["completed_at"] = datetime.utcnow().isoformat()
        raise


def resolve_params(params: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """파라미터 템플릿을 해석합니다."""
    resolved = {}

    for key, value in params.items():
        if isinstance(value, str) and value.startswith("$"):
            # 컨텍스트 참조 (예: $steps.0.result.data)
            path = value[1:].split(".")
            resolved[key] = get_nested_value(context, path)
        elif isinstance(value, dict):
            resolved[key] = resolve_params(value, context)
        elif isinstance(value, list):
            resolved[key] = [
                resolve_params(item, context) if isinstance(item, dict) else item
                for item in value
            ]
        else:
            resolved[key] = value

    return resolved


def get_nested_value(obj: Any, path: List[str]) -> Any:
    """중첩된 값을 가져옵니다."""
    for key in path:
        if isinstance(obj, dict):
            obj = obj.get(key)
        elif isinstance(obj, list) and key.isdigit():
            obj = obj[int(key)]
        else:
            return None
    return obj


async def execute_internal_function(
    function_name: str, params: Dict[str, Any], context: Dict[str, Any]
) -> Dict[str, Any]:
    """내부 함수를 실행합니다."""
    if function_name == "wait":
        seconds = params.get("seconds", 5)
        await asyncio.sleep(seconds)
        return {"waited": seconds}

    elif function_name == "log":
        message = params.get("message", "")
        print(f"[WORKFLOW] {message}")
        return {"logged": message}

    elif function_name == "merge_results":
        keys = params.get("keys", [])
        merged = {}
        for key in keys:
            path = key.split(".")
            value = get_nested_value(context, path)
            if value:
                merged[key] = value
        return {"merged": merged}

    elif function_name == "conditional":
        condition = params.get("condition", "")
        # 간단한 조건 평가 (실제로는 더 안전한 방법 필요)
        result = eval(condition, {"context": context})
        return {"condition_result": result}

    else:
        return {"error": f"알 수 없는 내부 함수: {function_name}"}


async def run_workflow(workflow_id: str):
    """워크플로우를 실행합니다."""
    workflow = get_workflow(workflow_id)
    if not workflow:
        return

    update_workflow(workflow_id, status=WorkflowStatus.RUNNING)

    context = {
        "workflow_id": workflow_id,
        "steps": [],
    }

    try:
        for i, step in enumerate(workflow["steps"]):
            # 조건부 스킵
            if step.get("condition"):
                condition_result = await execute_internal_function(
                    "conditional", {"condition": step["condition"]}, context
                )
                if not condition_result.get("condition_result"):
                    workflow["steps"][i]["status"] = StepStatus.SKIPPED
                    context["steps"].append({"skipped": True})
                    continue

            # 스텝 실행
            result = await execute_step(workflow_id, i, step, context)
            context["steps"].append(result)

            # 실패 시 중단 (continue_on_error가 아니면)
            if workflow["steps"][i]["status"] == StepStatus.FAILED:
                if not step.get("continue_on_error"):
                    raise Exception(f"스텝 {i} 실패: {workflow['steps'][i]['error']}")

        # 워크플로우 완료
        update_workflow(
            workflow_id,
            status=WorkflowStatus.COMPLETED,
            completed_at=datetime.utcnow().isoformat(),
        )

    except Exception as e:
        update_workflow(
            workflow_id,
            status=WorkflowStatus.FAILED,
            completed_at=datetime.utcnow().isoformat(),
        )


# ─────────────────────────────────────────────
# 5. 사전 정의 파이프라인
# ─────────────────────────────────────────────

PREDEFINED_PIPELINES = {
    "news_article_analysis": {
        "name": "뉴스 기사 종합 분석",
        "description": "텍스트 분석 + 이미지 분석을 결합한 뉴스 기사 종합 분석",
        "steps": [
            {
                "name": "텍스트 감성 분석",
                "service": "huggingface",
                "tool": "analyze_sentiment",
                "params": {"text": "$input.text"},
            },
            {
                "name": "개체명 추출",
                "service": "huggingface",
                "tool": "extract_entities",
                "params": {"text": "$input.text"},
            },
            {
                "name": "키워드 추출",
                "service": "huggingface",
                "tool": "extract_keywords",
                "params": {"text": "$input.text"},
            },
            {
                "name": "뉴스 분류",
                "service": "huggingface",
                "tool": "classify_news",
                "params": {"text": "$input.title"},
            },
        ],
    },
    "news_image_analysis": {
        "name": "뉴스 이미지 종합 분석",
        "description": "뉴스 기사 이미지의 객체 탐지 및 텍스트 추출",
        "steps": [
            {
                "name": "객체 탐지",
                "service": "roboflow",
                "tool": "detect_objects",
                "params": {"image_url": "$input.image_url"},
            },
            {
                "name": "OCR 텍스트 추출",
                "service": "roboflow",
                "tool": "extract_text_ocr",
                "params": {"image_url": "$input.image_url"},
            },
        ],
    },
    "ml_training_pipeline": {
        "name": "ML 모델 학습 파이프라인",
        "description": "Kaggle 데이터셋 다운로드 → 학습 코드 제출 → 결과 수집",
        "steps": [
            {
                "name": "데이터셋 검색",
                "service": "kaggle",
                "tool": "search_kaggle_datasets",
                "params": {"query": "$input.dataset_query", "max_size_mb": 500},
            },
            {
                "name": "데이터셋 다운로드",
                "service": "kaggle",
                "tool": "download_kaggle_dataset",
                "params": {"dataset_ref": "$input.dataset_ref"},
            },
            {
                "name": "대기 (다운로드 완료)",
                "service": "internal",
                "tool": "wait",
                "params": {"seconds": 30},
            },
            {
                "name": "학습 Kernel 제출",
                "service": "kaggle",
                "tool": "submit_training_kernel",
                "params": {
                    "kernel_name": "$input.kernel_name",
                    "code_file": "$input.code_file",
                    "dataset_sources": "$input.dataset_sources",
                    "enable_gpu": "$input.enable_gpu",
                },
            },
        ],
    },
    "full_news_pipeline": {
        "name": "뉴스 기사 전체 분석 파이프라인",
        "description": "텍스트 + 이미지 + 요약을 포함한 전체 뉴스 분석",
        "steps": [
            {
                "name": "기사 요약",
                "service": "huggingface",
                "tool": "summarize_article",
                "params": {"text": "$input.content", "max_length": 150},
            },
            {
                "name": "감성 분석",
                "service": "huggingface",
                "tool": "analyze_sentiment",
                "params": {"text": "$input.title"},
            },
            {
                "name": "카테고리 분류",
                "service": "huggingface",
                "tool": "classify_news",
                "params": {"text": "$input.title"},
            },
            {
                "name": "개체명 추출",
                "service": "huggingface",
                "tool": "extract_entities",
                "params": {"text": "$input.content"},
            },
            {
                "name": "이미지 분석 (조건부)",
                "service": "roboflow",
                "tool": "analyze_news_image_full",
                "params": {"image_url": "$input.image_url"},
                "condition": "context.get('input', {}).get('image_url')",
                "continue_on_error": True,
            },
        ],
    },
}


# ─────────────────────────────────────────────
# 6. MCP Tools
# ─────────────────────────────────────────────


@server.tool()
async def list_pipelines() -> Dict[str, Any]:
    """
    사용 가능한 사전 정의 파이프라인 목록을 반환합니다.

    Returns:
        파이프라인 목록 및 설명
    """
    pipelines = []
    for key, pipeline in PREDEFINED_PIPELINES.items():
        pipelines.append(
            {
                "id": key,
                "name": pipeline["name"],
                "description": pipeline["description"],
                "step_count": len(pipeline["steps"]),
                "steps": [s["name"] for s in pipeline["steps"]],
            }
        )

    return {"pipelines": pipelines, "count": len(pipelines)}


@server.tool()
async def run_pipeline(
    pipeline_id: str,
    input_data: Dict[str, Any],
) -> Dict[str, Any]:
    """
    사전 정의된 파이프라인을 실행합니다.

    Args:
        pipeline_id: 파이프라인 ID (list_pipelines로 확인)
        input_data: 파이프라인 입력 데이터

    Returns:
        워크플로우 ID 및 상태
    """
    if pipeline_id not in PREDEFINED_PIPELINES:
        return {"error": f"파이프라인을 찾을 수 없습니다: {pipeline_id}"}

    pipeline = PREDEFINED_PIPELINES[pipeline_id]

    # 입력 데이터를 컨텍스트에 추가
    steps = []
    for step in pipeline["steps"]:
        step_copy = step.copy()
        # $input 참조를 실제 값으로 변환
        if "params" in step_copy:
            step_copy["params"] = resolve_input_params(step_copy["params"], input_data)
        steps.append(step_copy)

    workflow_id = create_workflow(
        name=pipeline["name"], description=pipeline["description"], steps=steps
    )

    # 비동기 실행
    asyncio.create_task(run_workflow(workflow_id))

    return {
        "workflow_id": workflow_id,
        "pipeline_id": pipeline_id,
        "pipeline_name": pipeline["name"],
        "status": WorkflowStatus.PENDING,
        "step_count": len(steps),
        "message": f"파이프라인이 시작되었습니다. get_workflow_status('{workflow_id}')로 진행 상황을 확인하세요.",
    }


def resolve_input_params(
    params: Dict[str, Any], input_data: Dict[str, Any]
) -> Dict[str, Any]:
    """$input 참조를 실제 값으로 변환합니다."""
    resolved = {}

    for key, value in params.items():
        if isinstance(value, str) and value.startswith("$input."):
            input_key = value[7:]  # "$input." 제거
            resolved[key] = input_data.get(input_key)
        elif isinstance(value, dict):
            resolved[key] = resolve_input_params(value, input_data)
        else:
            resolved[key] = value

    return resolved


@server.tool()
async def create_custom_workflow(
    name: str,
    description: str,
    steps: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    커스텀 워크플로우를 생성합니다.

    Args:
        name: 워크플로우 이름
        description: 워크플로우 설명
        steps: 스텝 목록 [{service, tool, params, ...}]

    Returns:
        워크플로우 ID

    Example:
        steps = [
            {"service": "huggingface", "tool": "analyze_sentiment", "params": {"text": "..."}}
        ]
    """
    workflow_id = create_workflow(name, description, steps)

    return {
        "workflow_id": workflow_id,
        "name": name,
        "step_count": len(steps),
        "status": WorkflowStatus.PENDING,
        "message": "워크플로우가 생성되었습니다. start_workflow로 실행하세요.",
    }


@server.tool()
async def start_workflow(
    workflow_id: str,
) -> Dict[str, Any]:
    """
    생성된 워크플로우를 실행합니다.

    Args:
        workflow_id: 워크플로우 ID

    Returns:
        실행 상태
    """
    workflow = get_workflow(workflow_id)
    if not workflow:
        return {"error": f"워크플로우를 찾을 수 없습니다: {workflow_id}"}

    if workflow["status"] != WorkflowStatus.PENDING:
        return {
            "error": f"워크플로우가 이미 실행 중이거나 완료되었습니다: {workflow['status']}"
        }

    asyncio.create_task(run_workflow(workflow_id))

    return {
        "workflow_id": workflow_id,
        "status": WorkflowStatus.RUNNING,
        "message": "워크플로우가 시작되었습니다.",
    }


@server.tool()
async def get_workflow_status(
    workflow_id: str,
) -> Dict[str, Any]:
    """
    워크플로우의 현재 상태를 조회합니다.

    Args:
        workflow_id: 워크플로우 ID

    Returns:
        워크플로우 상태, 각 스텝 진행 상황, 결과
    """
    workflow = get_workflow(workflow_id)
    if not workflow:
        return {"error": f"워크플로우를 찾을 수 없습니다: {workflow_id}"}

    # 스텝 요약
    step_summary = []
    for i, step in enumerate(workflow["steps"]):
        step_summary.append(
            {
                "index": i,
                "name": step.get("name", f"Step {i}"),
                "service": step.get("service"),
                "tool": step.get("tool"),
                "status": step["status"],
                "has_result": step["result"] is not None,
                "error": step.get("error"),
            }
        )

    # 진행률 계산
    completed = sum(
        1
        for s in workflow["steps"]
        if s["status"] in [StepStatus.COMPLETED, StepStatus.SKIPPED]
    )
    progress = int(completed / len(workflow["steps"]) * 100) if workflow["steps"] else 0

    return {
        "workflow_id": workflow_id,
        "name": workflow["name"],
        "status": workflow["status"],
        "progress": progress,
        "current_step": workflow["current_step"],
        "total_steps": len(workflow["steps"]),
        "steps": step_summary,
        "created_at": workflow["created_at"],
        "updated_at": workflow["updated_at"],
        "completed_at": workflow.get("completed_at"),
    }


@server.tool()
async def get_workflow_results(
    workflow_id: str,
) -> Dict[str, Any]:
    """
    완료된 워크플로우의 전체 결과를 조회합니다.

    Args:
        workflow_id: 워크플로우 ID

    Returns:
        각 스텝의 상세 결과
    """
    workflow = get_workflow(workflow_id)
    if not workflow:
        return {"error": f"워크플로우를 찾을 수 없습니다: {workflow_id}"}

    results = []
    for i, step in enumerate(workflow["steps"]):
        results.append(
            {
                "index": i,
                "name": step.get("name", f"Step {i}"),
                "status": step["status"],
                "result": step["result"],
                "error": step.get("error"),
                "started_at": step.get("started_at"),
                "completed_at": step.get("completed_at"),
            }
        )

    return {
        "workflow_id": workflow_id,
        "name": workflow["name"],
        "status": workflow["status"],
        "results": results,
    }


@server.tool()
async def cancel_workflow(
    workflow_id: str,
) -> Dict[str, Any]:
    """
    실행 중인 워크플로우를 취소합니다.

    Args:
        workflow_id: 워크플로우 ID

    Returns:
        취소 결과
    """
    workflow = get_workflow(workflow_id)
    if not workflow:
        return {"error": f"워크플로우를 찾을 수 없습니다: {workflow_id}"}

    if workflow["status"] not in [WorkflowStatus.PENDING, WorkflowStatus.RUNNING]:
        return {"error": f"워크플로우를 취소할 수 없습니다: {workflow['status']}"}

    update_workflow(
        workflow_id,
        status=WorkflowStatus.CANCELLED,
        completed_at=datetime.utcnow().isoformat(),
    )

    return {
        "workflow_id": workflow_id,
        "status": WorkflowStatus.CANCELLED,
        "message": "워크플로우가 취소되었습니다.",
    }


@server.tool()
async def analyze_news_full(
    title: str,
    content: str,
    image_url: Optional[str] = None,
) -> Dict[str, Any]:
    """
    뉴스 기사를 원스톱으로 종합 분석합니다.

    텍스트 분석(감성, 분류, 개체명, 요약)과 이미지 분석(객체탐지, OCR)을
    한 번에 수행합니다.

    Args:
        title: 기사 제목
        content: 기사 본문
        image_url: 기사 이미지 URL (선택)

    Returns:
        워크플로우 ID - get_workflow_status로 결과 확인
    """
    input_data = {
        "title": title,
        "content": content,
    }
    if image_url:
        input_data["image_url"] = image_url

    return await run_pipeline("full_news_pipeline", input_data)


@server.tool()
async def check_services_status() -> Dict[str, Any]:
    """
    모든 하위 MCP 서비스의 상태를 확인합니다.

    Returns:
        각 서비스의 연결 상태
    """
    services = {
        "roboflow": {"url": ROBOFLOW_MCP_URL, "client": roboflow_client},
        "huggingface": {"url": HUGGINGFACE_MCP_URL, "client": huggingface_client},
        "kaggle": {"url": KAGGLE_MCP_URL, "client": kaggle_client},
    }

    results = {}
    for name, info in services.items():
        is_healthy = await info["client"].health_check()
        results[name] = {
            "url": info["url"],
            "status": "connected" if is_healthy else "disconnected",
            "healthy": is_healthy,
        }

    all_healthy = all(r["healthy"] for r in results.values())

    return {
        "overall_status": "healthy" if all_healthy else "degraded",
        "services": results,
        "checked_at": datetime.utcnow().isoformat(),
    }


@server.tool()
async def health_check() -> Dict[str, Any]:
    """
    오케스트레이터 서버 상태를 확인합니다.

    Returns:
        서버 상태 정보
    """
    status = {
        "server": "ML Training Orchestrator",
        "version": "1.0.0",
        "status": "running",
        "timestamp": datetime.utcnow().isoformat(),
        "data_dir": str(DATA_DIR),
        "active_workflows": len(
            [w for w in _workflows.values() if w["status"] == WorkflowStatus.RUNNING]
        ),
        "total_workflows": len(_workflows),
        "available_pipelines": len(PREDEFINED_PIPELINES),
    }

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
                "server": "ml-training-orchestrator",
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
    WORKFLOWS_DIR.mkdir(parents=True, exist_ok=True)
    PIPELINES_DIR.mkdir(parents=True, exist_ok=True)

    port = int(os.environ.get("PORT", "5020"))
    print(f"Starting ML Training Orchestrator v1.0.0 on port {port}")
    print(f"Roboflow MCP: {ROBOFLOW_MCP_URL}")
    print(f"HuggingFace MCP: {HUGGINGFACE_MCP_URL}")
    print(f"Kaggle MCP: {KAGGLE_MCP_URL}")
    print(f"Data directory: {DATA_DIR}")

    server.run_http(host="0.0.0.0", port=port, path="/mcp")
