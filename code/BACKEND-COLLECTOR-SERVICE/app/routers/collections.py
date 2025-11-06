from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List
from app.db import get_db
from app.schemas import CollectionRequest, CollectionJob, CollectionStats, CollectedData
from app.services.collection_service import CollectionService

router = APIRouter()

@router.post("/start", response_model=List[CollectionJob])
async def start_collection(
    request: CollectionRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    service = CollectionService(db)
    jobs = await service.start_collection(request, background_tasks)
    return jobs

@router.get("/stats", response_model=CollectionStats)
async def get_collection_stats(db: Session = Depends(get_db)):
    service = CollectionService(db)
    return service.get_stats()

@router.get("/jobs", response_model=List[CollectionJob])
async def get_collection_jobs(
    skip: int = 0,
    limit: int = 100,
    status_filter: str = None,
    db: Session = Depends(get_db)
):
    service = CollectionService(db)
    return service.get_jobs(skip=skip, limit=limit, status_filter=status_filter)

@router.get("/jobs/{job_id}", response_model=CollectionJob)
async def get_collection_job(
    job_id: int,
    db: Session = Depends(get_db)
):
    service = CollectionService(db)
    job = service.get_job(job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collection job not found"
        )
    return job

@router.get("/data", response_model=List[CollectedData])
async def get_collected_data(
    skip: int = 0,
    limit: int = 100,
    source_id: int = None,
    processed: bool = None,
    db: Session = Depends(get_db)
):
    service = CollectionService(db)
    return service.get_collected_data(
        skip=skip, 
        limit=limit, 
        source_id=source_id, 
        processed=processed
    )

@router.post("/data/{data_id}/process")
async def mark_data_processed(
    data_id: int,
    db: Session = Depends(get_db)
):
    service = CollectionService(db)
    success = service.mark_processed(data_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collected data not found"
        )
    return {"message": "Data marked as processed"}