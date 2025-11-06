"""
리포트 생성 API 라우터

분석 결과를 기반으로 자동 리포트를 생성하는 API 엔드포인트입니다.
감성, 트렌드, 요약 리포트 생성 및 관리 기능을 제공합니다.
"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List, Optional
from app.db import get_db
from app.schemas import ReportRequest, ReportResponse
from app.services.report_service import ReportService

# API 라우터 인스턴스 생성
router = APIRouter()


@router.post("/generate", response_model=ReportResponse)
async def generate_report(
    request: ReportRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    리포트 생성
    
    지정된 타입과 파라미터에 따라 분석 리포트를 자동 생성합니다.
    대용량 리포트는 백그라운드에서 비동기로 처리됩니다.
    
    Args:
        request: 리포트 생성 요청 데이터 (타입, 제목, 파라미터)
        background_tasks: FastAPI 백그라운드 작업 큐
        db: 데이터베이스 세션
    
    Returns:
        ReportResponse: 생성된 리포트 정보
    """
    # 리포트 서비스 인스턴스 생성
    service = ReportService(db)
    # 리포트 생성 및 결과 반환
    result = await service.generate_report(request, background_tasks)
    return result


@router.get("/", response_model=List[ReportResponse])
async def list_reports(
    report_type: Optional[str] = None,
    limit: Optional[int] = 10,
    offset: Optional[int] = 0,
    db: Session = Depends(get_db)
):
    """
    리포트 목록 조회
    
    생성된 리포트 목록을 페이지네이션과 함께 조회합니다.
    타입별 필터링을 지원합니다.
    
    Args:
        report_type: 리포트 타입 필터 (sentiment/trend/summary)
        limit: 조회할 최대 개수 (기본: 10)
        offset: 시작 위치 (기본: 0)
        db: 데이터베이스 세션
    
    Returns:
        List[ReportResponse]: 리포트 목록
    """
    # 리포트 서비스 인스턴스 생성
    service = ReportService(db)
    # 리포트 목록 조회
    reports = await service.list_reports(report_type, limit, offset)
    return reports


@router.get("/{report_id}", response_model=ReportResponse)
async def get_report(
    report_id: int,
    db: Session = Depends(get_db)
):
    """
    특정 리포트 조회
    
    ID를 통해 특정 리포트의 상세 내용을 조회합니다.
    
    Args:
        report_id: 리포트 ID
        db: 데이터베이스 세션
    
    Returns:
        ReportResponse: 리포트 상세 정보
    
    Raises:
        HTTPException: 리포트를 찾을 수 없는 경우 404 에러
    """
    # 리포트 서비스 인스턴스 생성
    service = ReportService(db)
    # 리포트 조회
    report = await service.get_report(report_id)
    # 리포트가 없으면 404 에러 반환
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


@router.delete("/{report_id}")
async def delete_report(
    report_id: int,
    db: Session = Depends(get_db)
):
    """
    리포트 삭제
    
    지정된 리포트를 삭제합니다.
    실제 삭제 대신 비활성화하여 데이터를 보존할 수 있습니다.
    
    Args:
        report_id: 삭제할 리포트 ID
        db: 데이터베이스 세션
    
    Returns:
        Dict: 삭제 성공 메시지
    
    Raises:
        HTTPException: 리포트를 찾을 수 없는 경우 404 에러
    """
    # 리포트 서비스 인스턴스 생성
    service = ReportService(db)
    # 리포트 삭제 수행
    success = await service.delete_report(report_id)
    # 삭제 실패시 404 에러 반환
    if not success:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"message": "Report deleted successfully"}


@router.get("/{report_id}/download")
async def download_report(
    report_id: int,
    format: str = "json",
    db: Session = Depends(get_db)
):
    """
    리포트 다운로드
    
    리포트를 지정된 형식으로 다운로드합니다.
    JSON, PDF, Excel 형식을 지원합니다.
    
    Args:
        report_id: 다운로드할 리포트 ID
        format: 파일 형식 (json/pdf/excel, 기본: json)
        db: 데이터베이스 세션
    
    Returns:
        FileResponse: 다운로드 파일 응답
    """
    # 리포트 서비스 인스턴스 생성
    service = ReportService(db)
    # 리포트 다운로드 처리
    file_response = await service.download_report(report_id, format)
    return file_response