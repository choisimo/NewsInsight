"""
ML Addon Integration for autonomous-crawler-service.

크롤링 완료 후 자동으로 ML 애드온 분석을 트리거하는 모듈.
"""

from .orchestrator import (
    MLOrchestrator,
    MLAddonType,
    MLAddonConfig,
    MLAnalysisResult,
    BatchAnalysisResult,
    get_ml_orchestrator,
    init_ml_orchestrator,
)

__all__ = [
    "MLOrchestrator",
    "MLAddonType",
    "MLAddonConfig",
    "MLAnalysisResult",
    "BatchAnalysisResult",
    "get_ml_orchestrator",
    "init_ml_orchestrator",
]
