"""
ML 모델 관리 API 라우터

기계학습 모델의 업로드, 학습, 관리를 담당하는 API 엔드포인트입니다.
모델 버전 관리, A/B 테스트, 학습 모니터링 기능을 제공합니다.
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List, Optional
from app.db import get_db
from app.schemas import (
    MLModelRequest, 
    MLModelResponse, 
    ModelTrainingRequest, 
    ModelTrainingResponse
)
from app.services.ml_service import MLModelService

# API 라우터 인스턴스 생성
router = APIRouter()


@router.post("/upload", response_model=MLModelResponse)
async def upload_model(
    request: MLModelRequest,
    db: Session = Depends(get_db)
):
    """
    ML 모델 업로드
    
    학습된 ML 모델을 서비스에 등록합니다.
    모델 파일과 메타데이터를 저장하고 버전을 관리합니다.
    
    Args:
        request: 모델 등록 요청 데이터 (이름, 타입, 경로, 메트릭)
        db: 데이터베이스 세션
    
    Returns:
        MLModelResponse: 등록된 모델 정보
    """
    # ML 서비스 인스턴스 생성
    service = MLModelService(db)
    # 모델 업로드 및 결과 반환
    result = await service.upload_model(request)
    return result


@router.get("/", response_model=List[MLModelResponse])
async def list_models(
    model_type: Optional[str] = None,
    active_only: bool = False,
    db: Session = Depends(get_db)
):
    """
    모델 목록 조회
    
    등록된 모든 ML 모델의 목록을 조회합니다.
    타입별 필터링과 활성 모델만 조회하는 옵션을 제공합니다.
    
    Args:
        model_type: 모델 타입 필터 (sentiment/classification)
        active_only: 활성 모델만 조회 여부 (기본: False)
        db: 데이터베이스 세션
    
    Returns:
        List[MLModelResponse]: 모델 목록
    """
    # ML 서비스 인스턴스 생성
    service = MLModelService(db)
    # 모델 목록 조회
    models = await service.list_models(model_type, active_only)
    return models


@router.get("/{model_id}", response_model=MLModelResponse)
async def get_model(
    model_id: int,
    db: Session = Depends(get_db)
):
    """
    특정 모델 조회
    
    ID를 통해 특정 ML 모델의 상세 정보를 조회합니다.
    
    Args:
        model_id: 모델 ID
        db: 데이터베이스 세션
    
    Returns:
        MLModelResponse: 모델 상세 정보
    
    Raises:
        HTTPException: 모델을 찾을 수 없는 경우 404 에러
    """
    # ML 서비스 인스턴스 생성
    service = MLModelService(db)
    # 모델 조회
    model = await service.get_model(model_id)
    # 모델이 없으면 404 에러 반환
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    return model


@router.put("/{model_id}/activate")
async def activate_model(
    model_id: int,
    db: Session = Depends(get_db)
):
    """
    모델 활성화
    
    특정 모델을 활성화하여 실제 서비스에서 사용하도록 설정합니다.
    기존 활성 모델은 자동으로 비활성화됩니다.
    
    Args:
        model_id: 활성화할 모델 ID
        db: 데이터베이스 세션
    
    Returns:
        Dict: 활성화 성공 메시지
    
    Raises:
        HTTPException: 모델을 찾을 수 없는 경우 404 에러
    """
    # ML 서비스 인스턴스 생성
    service = MLModelService(db)
    # 모델 활성화 수행
    success = await service.activate_model(model_id)
    # 활성화 실패시 404 에러 반환
    if not success:
        raise HTTPException(status_code=404, detail="Model not found")
    return {"message": "Model activated successfully"}


@router.post("/train", response_model=ModelTrainingResponse)
async def train_model(
    request: ModelTrainingRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    모델 학습
    
    새로운 ML 모델을 학습시킵니다.
    학습 작업은 백그라운드에서 비동기로 수행됩니다.
    
    Args:
        request: 모델 학습 요청 데이터 (모델명, 데이터 경로, 하이퍼파라미터)
        background_tasks: FastAPI 백그라운드 작업 큐
        db: 데이터베이스 세션
    
    Returns:
        ModelTrainingResponse: 학습 작업 정보
    """
    # ML 서비스 인스턴스 생성
    service = MLModelService(db)
    # 모델 학습 시작 및 결과 반환
    result = await service.train_model(request, background_tasks)
    return result


@router.get("/training/{job_id}")
async def get_training_status(
    job_id: str,
    db: Session = Depends(get_db)
):
    """
    학습 상태 확인
    
    진행 중인 모델 학습 작업의 상태를 확인합니다.
    
    Args:
        job_id: 학습 작업 ID
        db: 데이터베이스 세션
    
    Returns:
        Dict: 학습 상태 정보 (status, progress, metrics)
    """
    # ML 서비스 인스턴스 생성
    service = MLModelService(db)
    # 학습 상태 조회
    status = await service.get_training_status(job_id)
    return status


@router.delete("/{model_id}")
async def delete_model(
    model_id: int,
    db: Session = Depends(get_db)
):
    """
    모델 삭제
    
    지정된 ML 모델을 삭제합니다.
    활성 상태의 모델은 삭제할 수 없습니다.
    
    Args:
        model_id: 삭제할 모델 ID
        db: 데이터베이스 세션
    
    Returns:
        Dict: 삭제 성공 메시지
    
    Raises:
        HTTPException: 모델을 찾을 수 없는 경우 404 에러
    """
    # ML 서비스 인스턴스 생성
    service = MLModelService(db)
    # 모델 삭제 수행
    success = await service.delete_model(model_id)
    # 삭제 실패시 404 에러 반환
    if not success:
        raise HTTPException(status_code=404, detail="Model not found")
    return {"message": "Model deleted successfully"}