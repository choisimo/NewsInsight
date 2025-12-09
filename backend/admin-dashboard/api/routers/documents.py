"""
Document Router - 문서 관리 API 엔드포인트
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from ..models.schemas import Document, DocumentCategory, UserRole
from ..dependencies import get_current_user, get_document_service, require_role

router = APIRouter(prefix="/documents", tags=["Documents"])


@router.get("", response_model=list[Document])
async def list_documents(
    category: Optional[DocumentCategory] = Query(None, description="카테고리 필터"),
    tag: Optional[str] = Query(None, description="태그 필터"),
    environment: Optional[str] = Query(None, description="환경 필터"),
    search: Optional[str] = Query(None, description="검색어"),
    doc_service=Depends(get_document_service),
    current_user=Depends(get_current_user),
):
    """문서 목록 조회"""
    docs = doc_service.list_documents(
        category=category,
        tag=tag,
        environment=environment,
        search=search,
    )
    # 목록에서는 content 제외
    for doc in docs:
        doc.content = None
    return docs


@router.get("/categories")
async def get_categories_summary(
    doc_service=Depends(get_document_service),
    current_user=Depends(get_current_user),
):
    """카테고리별 문서 수 요약"""
    return doc_service.get_categories_summary()


@router.get("/tags")
async def get_tags_summary(
    doc_service=Depends(get_document_service),
    current_user=Depends(get_current_user),
):
    """태그별 문서 수 요약"""
    return doc_service.get_tags_summary()


@router.get("/related")
async def get_related_documents(
    environment: Optional[str] = Query(None, description="환경 이름"),
    script_id: Optional[str] = Query(None, description="스크립트 ID"),
    doc_service=Depends(get_document_service),
    current_user=Depends(get_current_user),
):
    """관련 문서 조회"""
    if not environment and not script_id:
        raise HTTPException(
            status_code=400,
            detail="At least one of environment or script_id is required",
        )

    docs = doc_service.get_related_documents(
        environment=environment,
        script_id=script_id,
    )
    # 목록에서는 content 제외
    for doc in docs:
        doc.content = None
    return docs


@router.get("/{doc_id}", response_model=Document)
async def get_document(
    doc_id: str,
    doc_service=Depends(get_document_service),
    current_user=Depends(get_current_user),
):
    """문서 상세 조회 (내용 포함)"""
    doc = doc_service.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.patch("/{doc_id}", response_model=Document)
async def update_document_metadata(
    doc_id: str,
    title: Optional[str] = None,
    category: Optional[DocumentCategory] = None,
    tags: Optional[list[str]] = Query(None),
    related_environments: Optional[list[str]] = Query(None),
    related_scripts: Optional[list[str]] = Query(None),
    doc_service=Depends(get_document_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """문서 메타데이터 수정 (Admin 권한 필요)"""
    doc = doc_service.update_document_metadata(
        doc_id=doc_id,
        title=title,
        category=category,
        tags=tags,
        related_environments=related_environments,
        related_scripts=related_scripts,
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.post("/refresh")
async def refresh_documents(
    doc_service=Depends(get_document_service),
    current_user=Depends(require_role(UserRole.ADMIN)),
):
    """문서 목록 새로고침 (Admin 권한 필요)"""
    diff = doc_service.refresh_documents()
    return {
        "success": True,
        "message": f"Documents refreshed. {diff:+d} documents changed.",
        "total": len(doc_service.documents),
    }
