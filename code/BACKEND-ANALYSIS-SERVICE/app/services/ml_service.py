from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any
from datetime import datetime
import json
import uuid
import os
from fastapi import BackgroundTasks
from app.db import MLModel
from app.schemas import MLModelRequest, MLModelResponse, ModelTrainingRequest, ModelTrainingResponse


class MLModelService:
    """
    ML 모델 메타데이터 관리 및 학습 작업을 처리하는 서비스 클래스.

    모델 업로드/목록/조회/활성화/삭제와 간단한 학습 잡 시뮬레이션을 제공합니다.
    """

    def __init__(self, db: Session):
        """
        서비스 인스턴스 초기화.

        Args:
            db: SQLAlchemy 세션
        """
        self.db = db
    
    async def upload_model(self, request: MLModelRequest) -> MLModelResponse:
        """
        학습 완료된 모델 메타데이터를 등록합니다. 동일 이름 모델이 존재하면 비활성화합니다.

        Args:
            request: 모델 등록 정보(이름, 타입, 파일경로, 메트릭)

        Returns:
            등록된 모델의 응답 스키마
        """
        existing_model = self.db.query(MLModel).filter(MLModel.name == request.name).first()
        if existing_model:
            existing_model.is_active = False
            self.db.commit()
        
        version = f"v{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        model = MLModel(
            name=request.name,
            version=version,
            model_type=request.model_type,
            file_path=request.file_path,
            metrics=json.dumps(request.metrics),
            is_active=False
        )
        
        self.db.add(model)
        self.db.commit()
        self.db.refresh(model)
        
        return MLModelResponse(
            model_id=model.id,
            name=model.name,
            version=model.version,
            model_type=model.model_type,
            is_active=model.is_active,
            metrics=request.metrics,
            created_at=model.created_at
        )
    
    async def list_models(self, model_type: Optional[str] = None, active_only: bool = False) -> List[MLModelResponse]:
        """
        모델 목록을 조회합니다. 타입/활성 여부로 필터링 가능합니다.

        Args:
            model_type: 모델 타입 필터
            active_only: 활성 모델만 조회 여부

        Returns:
            모델 응답 스키마 리스트
        """
        query = self.db.query(MLModel)
        
        if model_type:
            query = query.filter(MLModel.model_type == model_type)
        if active_only:
            query = query.filter(MLModel.is_active == True)
        
        models = query.order_by(MLModel.created_at.desc()).all()
        
        return [
            MLModelResponse(
                model_id=model.id,
                name=model.name,
                version=model.version,
                model_type=model.model_type,
                is_active=model.is_active,
                metrics=json.loads(model.metrics) if model.metrics else {},
                created_at=model.created_at
            )
            for model in models
        ]
    
    async def get_model(self, model_id: int) -> Optional[MLModelResponse]:
        """
        단일 모델 상세 정보를 조회합니다.

        Args:
            model_id: 모델 ID

        Returns:
            모델 응답 스키마 또는 None
        """
        model = self.db.query(MLModel).filter(MLModel.id == model_id).first()
        
        if not model:
            return None
        
        return MLModelResponse(
            model_id=model.id,
            name=model.name,
            version=model.version,
            model_type=model.model_type,
            is_active=model.is_active,
            metrics=json.loads(model.metrics) if model.metrics else {},
            created_at=model.created_at
        )
    
    async def activate_model(self, model_id: int) -> bool:
        """
        특정 모델을 활성화하고 같은 타입의 다른 활성 모델은 비활성화합니다.

        Args:
            model_id: 활성화할 모델 ID

        Returns:
            성공 여부
        """
        model = self.db.query(MLModel).filter(MLModel.id == model_id).first()
        
        if not model:
            return False
        
        self.db.query(MLModel).filter(
            MLModel.model_type == model.model_type,
            MLModel.is_active == True
        ).update({"is_active": False})
        
        model.is_active = True
        self.db.commit()
        return True
    
    async def train_model(self, request: ModelTrainingRequest, background_tasks: BackgroundTasks) -> ModelTrainingResponse:
        """
        새 학습 작업을 생성하여 백그라운드로 실행합니다.

        Args:
            request: 학습 요청(데이터 경로, 하이퍼파라미터 등)
            background_tasks: FastAPI 백그라운드 태스크 큐

        Returns:
            학습 작업 정보(잡 ID 등)
        """
        job_id = str(uuid.uuid4())
        
        background_tasks.add_task(self._train_model_background, request, job_id)
        
        return ModelTrainingResponse(
            job_id=job_id,
            status="started",
            estimated_completion=datetime.now()
        )
    
    async def get_training_status(self, job_id: str) -> Dict[str, Any]:
        """
        학습 작업 진행 상태를 조회합니다. (데모용 고정 값)

        Args:
            job_id: 학습 작업 ID

        Returns:
            상태/진행률/간단 메트릭을 담은 사전
        """
        return {
            "job_id": job_id,
            "status": "completed",
            "progress": 100,
            "metrics": {
                "accuracy": 0.85,
                "f1_score": 0.82
            }
        }
    
    async def delete_model(self, model_id: int) -> bool:
        """
        모델 메타데이터를 삭제하고, 파일 경로에 모델 파일이 있으면 제거합니다.

        Args:
            model_id: 삭제할 모델 ID

        Returns:
            성공 여부
        """
        model = self.db.query(MLModel).filter(MLModel.id == model_id).first()
        
        if not model:
            return False
        
        if os.path.exists(model.file_path):
            os.remove(model.file_path)
        
        self.db.delete(model)
        self.db.commit()
        return True
    
    async def _train_model_background(self, request: ModelTrainingRequest, job_id: str):
        """
        학습 작업을 백그라운드에서 수행하는 모의 함수.

        실제 학습 대신 고정된 메트릭을 기록한 모델 엔티티를 생성합니다.

        Args:
            request: 학습 요청
            job_id: 작업 ID
        """
        print(f"Training model {request.model_name} with job ID {job_id}")
        
        version = f"v{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        file_path = f"/app/models/{request.model_name}_{version}.pkl"
        
        model = MLModel(
            name=request.model_name,
            version=version,
            model_type="sentiment",
            file_path=file_path,
            metrics=json.dumps({
                "accuracy": 0.85,
                "f1_score": 0.82,
                "training_job_id": job_id
            }),
            is_active=False
        )
        
        self.db.add(model)
        self.db.commit()
        
        print(f"Model training completed for job {job_id}")