from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app.db import get_db, DataSource as DataSourceModel
from app.schemas import DataSource, DataSourceCreate, DataSourceUpdate
from app.services.source_service import SourceService

router = APIRouter()

@router.post("/", response_model=DataSource, status_code=status.HTTP_201_CREATED)
async def create_data_source(
    source: DataSourceCreate,
    db: Session = Depends(get_db)
):
    service = SourceService(db)
    return service.create_source(source)

@router.get("/", response_model=List[DataSource])
async def get_data_sources(
    skip: int = 0,
    limit: int = 100,
    active_only: bool = None,
    db: Session = Depends(get_db)
):
    service = SourceService(db)
    return service.get_sources(skip=skip, limit=limit, active_only=active_only)

@router.get("/{source_id}", response_model=DataSource)
async def get_data_source(
    source_id: int,
    db: Session = Depends(get_db)
):
    service = SourceService(db)
    source = service.get_source(source_id)
    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Data source not found"
        )
    return source

@router.put("/{source_id}", response_model=DataSource)
async def update_data_source(
    source_id: int,
    source_update: DataSourceUpdate,
    db: Session = Depends(get_db)
):
    service = SourceService(db)
    source = service.update_source(source_id, source_update)
    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Data source not found"
        )
    return source

@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_data_source(
    source_id: int,
    db: Session = Depends(get_db)
):
    service = SourceService(db)
    success = service.delete_source(source_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Data source not found"
        )

@router.post("/{source_id}/test")
async def test_data_source(
    source_id: int,
    db: Session = Depends(get_db)
):
    service = SourceService(db)
    result = await service.test_source(source_id)
    return result