"""
ML Training Router - ML 모델 학습 관리 API 엔드포인트
"""

import os
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from ..models.schemas import (
    AuditAction,
    UserRole,
)
from ..dependencies import (
    get_audit_service,
    get_current_user,
    require_role,
)

router = APIRouter(prefix="/ml-training", tags=["ML Training"])


# ============================================================================
# Configuration
# ============================================================================

ML_TRAINER_URL = os.environ.get("ML_TRAINER_URL", "http://ml-trainer:8103")


# ============================================================================
# Schemas
# ============================================================================


class TrainingJobStatus(str, Enum):
    """학습 작업 상태"""

    PENDING = "pending"
    PREPARING = "preparing"
    TRAINING = "training"
    EVALUATING = "evaluating"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ModelType(str, Enum):
    """모델 타입"""

    SENTIMENT = "sentiment"
    FACTCHECK = "factcheck"
    BIAS = "bias"
    CUSTOM = "custom"


class DatasetSource(str, Enum):
    """데이터셋 소스"""

    HUGGINGFACE = "huggingface"
    LOCAL = "local"
    URL = "url"
    DATABASE = "database"


class TrainingJobCreate(BaseModel):
    """학습 작업 생성 요청"""

    name: str = Field(..., description="작업 이름")
    description: Optional[str] = Field(None, description="설명")
    model_type: ModelType = Field(..., description="모델 타입")
    base_model: str = Field(
        ..., description="베이스 모델 (예: monologg/koelectra-base-v3-discriminator)"
    )

    # Dataset configuration
    dataset_source: DatasetSource = Field(
        DatasetSource.HUGGINGFACE, description="데이터셋 소스"
    )
    dataset_name: Optional[str] = Field(
        None, description="데이터셋 이름 (HuggingFace 또는 로컬 경로)"
    )
    dataset_split: str = Field("train", description="데이터셋 분할")
    text_column: str = Field("text", description="텍스트 컬럼명")
    label_column: str = Field("label", description="라벨 컬럼명")

    # Training hyperparameters
    num_epochs: int = Field(3, ge=1, le=100, description="에포크 수")
    batch_size: int = Field(16, ge=1, le=256, description="배치 크기")
    learning_rate: float = Field(2e-5, ge=1e-7, le=1e-2, description="학습률")
    warmup_ratio: float = Field(0.1, ge=0, le=1, description="웜업 비율")
    weight_decay: float = Field(0.01, ge=0, le=1, description="가중치 감쇠")
    max_seq_length: int = Field(512, ge=32, le=2048, description="최대 시퀀스 길이")

    # Output configuration
    output_dir: Optional[str] = Field(None, description="출력 디렉토리")
    save_steps: int = Field(500, description="저장 스텝 간격")
    eval_steps: int = Field(500, description="평가 스텝 간격")

    # Additional options
    fp16: bool = Field(False, description="FP16 학습 사용")
    gradient_accumulation_steps: int = Field(
        1, ge=1, le=64, description="그래디언트 누적 스텝"
    )


class TrainingJob(BaseModel):
    """학습 작업"""

    id: str
    name: str
    description: Optional[str] = None
    model_type: ModelType
    base_model: str
    status: TrainingJobStatus

    # Progress
    progress: float = Field(0.0, description="진행률 (0-100)")
    current_epoch: int = 0
    total_epochs: int = 0
    current_step: int = 0
    total_steps: int = 0

    # Metrics
    train_loss: Optional[float] = None
    eval_loss: Optional[float] = None
    eval_accuracy: Optional[float] = None
    eval_f1: Optional[float] = None

    # Timing
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    elapsed_seconds: int = 0
    estimated_remaining_seconds: Optional[int] = None

    # Output
    output_path: Optional[str] = None
    model_size_mb: Optional[float] = None

    # Error handling
    error_message: Optional[str] = None

    created_at: datetime
    updated_at: datetime


class TrainingJobList(BaseModel):
    """학습 작업 목록"""

    jobs: List[TrainingJob]
    total: int
    pending: int
    running: int
    completed: int
    failed: int


class ModelInfo(BaseModel):
    """학습된 모델 정보"""

    id: str
    name: str
    model_type: ModelType
    base_model: str
    training_job_id: str

    # Performance metrics
    accuracy: Optional[float] = None
    f1_score: Optional[float] = None
    precision: Optional[float] = None
    recall: Optional[float] = None

    # Model details
    model_path: str
    size_mb: float
    num_labels: int
    label_mapping: Optional[Dict[str, int]] = None

    # Deployment
    is_deployed: bool = False
    deployed_at: Optional[datetime] = None
    addon_key: Optional[str] = None

    created_at: datetime


class ModelList(BaseModel):
    """학습된 모델 목록"""

    models: List[ModelInfo]
    total: int


class DeployRequest(BaseModel):
    """모델 배포 요청"""

    addon_key: str = Field(..., description="배포할 애드온 키 (예: sentiment-addon)")
    replace_current: bool = Field(True, description="현재 모델 교체 여부")


class TrainingMetrics(BaseModel):
    """학습 메트릭"""

    job_id: str
    step: int
    epoch: float
    train_loss: Optional[float] = None
    eval_loss: Optional[float] = None
    eval_accuracy: Optional[float] = None
    eval_f1: Optional[float] = None
    learning_rate: Optional[float] = None
    timestamp: datetime


# ============================================================================
# Helper functions
# ============================================================================


async def call_trainer_service(
    method: str,
    path: str,
    params: Optional[dict] = None,
    json_data: Optional[dict] = None,
    timeout: float = 30.0,
) -> dict:
    """Call the ml-trainer service API"""
    url = f"{ML_TRAINER_URL}{path}"

    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.request(
                method=method,
                url=url,
                params=params,
                json=json_data,
            )

            if response.status_code >= 400:
                detail = (
                    response.json().get("detail", response.text)
                    if response.text
                    else "Unknown error"
                )
                raise HTTPException(
                    status_code=response.status_code,
                    detail=detail,
                )

            if response.status_code == 204:
                return {}

            return response.json()
        except httpx.RequestError as e:
            raise HTTPException(
                status_code=503,
                detail=f"ML Trainer service unavailable: {str(e)}",
            )


# ============================================================================
# Endpoints - Health & Status
# ============================================================================


@router.get("/health")
async def trainer_health_check(
    current_user=Depends(get_current_user),
):
    """
    ML Trainer 서비스 헬스체크.
    """
    try:
        result = await call_trainer_service("GET", "/health")
        return result
    except HTTPException as e:
        if e.status_code == 503:
            return {
                "status": "unhealthy",
                "message": "ML Trainer service is unavailable",
            }
        raise


@router.get("/status")
async def trainer_status(
    current_user=Depends(get_current_user),
):
    """
    ML Trainer 시스템 상태 조회.

    현재 학습 작업 상태 및 리소스 사용량을 반환합니다.
    """
    result = await call_trainer_service("GET", "/status")
    return result


# ============================================================================
# Endpoints - Training Jobs
# ============================================================================


@router.get("/jobs", response_model=TrainingJobList)
async def list_training_jobs(
    status: Optional[TrainingJobStatus] = Query(None, description="상태 필터"),
    model_type: Optional[ModelType] = Query(None, description="모델 타입 필터"),
    limit: int = Query(20, ge=1, le=100, description="최대 개수"),
    offset: int = Query(0, ge=0, description="오프셋"),
    current_user=Depends(get_current_user),
):
    """
    학습 작업 목록 조회.
    """
    params = {"limit": limit, "offset": offset}
    if status:
        params["status"] = status.value
    if model_type:
        params["model_type"] = model_type.value

    result = await call_trainer_service("GET", "/jobs", params=params)
    return result


@router.get("/jobs/{job_id}", response_model=TrainingJob)
async def get_training_job(
    job_id: str,
    current_user=Depends(get_current_user),
):
    """
    특정 학습 작업 조회.
    """
    result = await call_trainer_service("GET", f"/jobs/{job_id}")
    return result


@router.post("/jobs", response_model=TrainingJob, status_code=status.HTTP_201_CREATED)
async def create_training_job(
    request: TrainingJobCreate,
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """
    새 학습 작업 생성. (Admin 권한 필요)

    학습 작업을 생성하고 큐에 추가합니다.
    """
    result = await call_trainer_service(
        "POST",
        "/jobs",
        json_data=request.model_dump(exclude_none=True),
    )

    # Audit log
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.CREATE,
        resource_type="training_job",
        resource_id=result.get("id", "unknown"),
        resource_name=request.name,
        details={
            "model_type": request.model_type.value,
            "base_model": request.base_model,
            "epochs": request.num_epochs,
        },
    )

    return result


@router.post("/jobs/{job_id}/start")
async def start_training_job(
    job_id: str,
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """
    학습 작업 시작. (Admin 권한 필요)
    """
    result = await call_trainer_service("POST", f"/jobs/{job_id}/start", timeout=60.0)

    # Audit log
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.UPDATE,
        resource_type="training_job",
        resource_id=job_id,
        resource_name=f"Training Job {job_id}",
        details={"action": "start"},
    )

    return result


@router.post("/jobs/{job_id}/cancel")
async def cancel_training_job(
    job_id: str,
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """
    학습 작업 취소. (Admin 권한 필요)
    """
    result = await call_trainer_service("POST", f"/jobs/{job_id}/cancel")

    # Audit log
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.UPDATE,
        resource_type="training_job",
        resource_id=job_id,
        resource_name=f"Training Job {job_id}",
        details={"action": "cancel"},
    )

    return result


@router.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_training_job(
    job_id: str,
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """
    학습 작업 삭제. (Admin 권한 필요)

    완료되거나 실패한 작업만 삭제 가능합니다.
    """
    await call_trainer_service("DELETE", f"/jobs/{job_id}")

    # Audit log
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.DELETE,
        resource_type="training_job",
        resource_id=job_id,
        resource_name=f"Training Job {job_id}",
    )


@router.get("/jobs/{job_id}/metrics", response_model=List[TrainingMetrics])
async def get_training_metrics(
    job_id: str,
    limit: int = Query(100, ge=1, le=1000, description="최대 개수"),
    current_user=Depends(get_current_user),
):
    """
    학습 작업의 메트릭 조회.

    학습 진행 중 기록된 loss, accuracy 등의 메트릭을 반환합니다.
    """
    result = await call_trainer_service(
        "GET", f"/jobs/{job_id}/metrics", params={"limit": limit}
    )
    return result


@router.get("/jobs/{job_id}/logs")
async def get_training_logs(
    job_id: str,
    lines: int = Query(100, ge=1, le=1000, description="로그 라인 수"),
    current_user=Depends(get_current_user),
):
    """
    학습 작업의 로그 조회.
    """
    result = await call_trainer_service(
        "GET", f"/jobs/{job_id}/logs", params={"lines": lines}
    )
    return result


# ============================================================================
# Endpoints - Models
# ============================================================================


@router.get("/models", response_model=ModelList)
async def list_models(
    model_type: Optional[ModelType] = Query(None, description="모델 타입 필터"),
    deployed_only: bool = Query(False, description="배포된 모델만"),
    limit: int = Query(20, ge=1, le=100, description="최대 개수"),
    offset: int = Query(0, ge=0, description="오프셋"),
    current_user=Depends(get_current_user),
):
    """
    학습된 모델 목록 조회.
    """
    params = {"limit": limit, "offset": offset, "deployed_only": deployed_only}
    if model_type:
        params["model_type"] = model_type.value

    result = await call_trainer_service("GET", "/models", params=params)
    return result


@router.get("/models/{model_id}", response_model=ModelInfo)
async def get_model(
    model_id: str,
    current_user=Depends(get_current_user),
):
    """
    특정 모델 조회.
    """
    result = await call_trainer_service("GET", f"/models/{model_id}")
    return result


@router.post("/models/{model_id}/deploy")
async def deploy_model(
    model_id: str,
    request: DeployRequest,
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """
    모델을 ML Addon에 배포. (Admin 권한 필요)

    학습된 모델을 지정된 ML Addon 서비스에 배포합니다.
    """
    result = await call_trainer_service(
        "POST",
        f"/models/{model_id}/deploy",
        json_data=request.model_dump(),
        timeout=120.0,
    )

    # Audit log
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.UPDATE,
        resource_type="ml_model",
        resource_id=model_id,
        resource_name=f"Model {model_id}",
        details={
            "action": "deploy",
            "addon_key": request.addon_key,
            "replace_current": request.replace_current,
        },
    )

    return result


@router.delete("/models/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_model(
    model_id: str,
    audit_service=Depends(get_audit_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """
    학습된 모델 삭제. (Admin 권한 필요)

    배포되지 않은 모델만 삭제 가능합니다.
    """
    await call_trainer_service("DELETE", f"/models/{model_id}")

    # Audit log
    audit_service.log(
        user_id=current_user.id,
        username=current_user.username,
        action=AuditAction.DELETE,
        resource_type="ml_model",
        resource_id=model_id,
        resource_name=f"Model {model_id}",
    )


# ============================================================================
# Endpoints - Datasets
# ============================================================================


@router.get("/datasets")
async def list_datasets(
    source: Optional[DatasetSource] = Query(None, description="데이터셋 소스 필터"),
    current_user=Depends(get_current_user),
):
    """
    사용 가능한 데이터셋 목록 조회.
    """
    params = {}
    if source:
        params["source"] = source.value

    result = await call_trainer_service("GET", "/datasets", params=params)
    return result


@router.post("/datasets/search")
async def search_huggingface_datasets(
    query: str = Query(..., description="검색 쿼리"),
    task: Optional[str] = Query(
        None, description="태스크 타입 (text-classification 등)"
    ),
    language: Optional[str] = Query("ko", description="언어"),
    limit: int = Query(10, ge=1, le=50),
    current_user=Depends(get_current_user),
):
    """
    HuggingFace 데이터셋 검색.
    """
    params = {"query": query, "limit": limit}
    if task:
        params["task"] = task
    if language:
        params["language"] = language

    result = await call_trainer_service("POST", "/datasets/search", params=params)
    return result


@router.get("/datasets/{dataset_name}/preview")
async def preview_dataset(
    dataset_name: str,
    split: str = Query("train", description="데이터셋 분할"),
    num_samples: int = Query(5, ge=1, le=20, description="샘플 수"),
    current_user=Depends(get_current_user),
):
    """
    데이터셋 미리보기.

    데이터셋의 샘플 데이터와 스키마를 반환합니다.
    """
    result = await call_trainer_service(
        "GET",
        f"/datasets/{dataset_name}/preview",
        params={"split": split, "num_samples": num_samples},
    )
    return result


# ============================================================================
# Endpoints - Presets
# ============================================================================


@router.get("/presets")
async def list_training_presets(
    current_user=Depends(get_current_user),
):
    """
    학습 프리셋 목록.

    일반적인 학습 설정 프리셋을 반환합니다.
    """
    presets = [
        {
            "id": "korean-sentiment-koelectra",
            "name": "한국어 감성분석 (KoELECTRA)",
            "model_type": "sentiment",
            "base_model": "monologg/koelectra-base-v3-discriminator",
            "recommended_datasets": [
                "nsmc",
                "klue/ner",
            ],
            "default_config": {
                "num_epochs": 3,
                "batch_size": 32,
                "learning_rate": 2e-5,
                "max_seq_length": 128,
            },
        },
        {
            "id": "korean-bias-kcbert",
            "name": "한국어 편향분석 (KcBERT)",
            "model_type": "bias",
            "base_model": "beomi/KcBERT-base",
            "recommended_datasets": [],
            "default_config": {
                "num_epochs": 5,
                "batch_size": 16,
                "learning_rate": 3e-5,
                "max_seq_length": 256,
            },
        },
        {
            "id": "multilingual-factcheck",
            "name": "다국어 팩트체크 (mBERT)",
            "model_type": "factcheck",
            "base_model": "bert-base-multilingual-cased",
            "recommended_datasets": [],
            "default_config": {
                "num_epochs": 5,
                "batch_size": 16,
                "learning_rate": 2e-5,
                "max_seq_length": 512,
            },
        },
    ]
    return {"presets": presets, "total": len(presets)}


@router.post("/presets/{preset_id}/apply", response_model=TrainingJobCreate)
async def apply_preset(
    preset_id: str,
    dataset_name: Optional[str] = Query(
        None, description="데이터셋 이름 (없으면 기본값)"
    ),
    current_user=Depends(get_current_user),
):
    """
    프리셋 적용.

    선택한 프리셋을 기반으로 학습 설정을 생성합니다.
    """
    result = await call_trainer_service(
        "POST",
        f"/presets/{preset_id}/apply",
        params={"dataset_name": dataset_name} if dataset_name else None,
    )
    return result
