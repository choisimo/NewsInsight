"""
NewsInsight MCP Shared - Utility Functions

공통 유틸리티 함수를 제공하는 모듈입니다.
"""

import json
from typing import Any, TypeVar, Union

T = TypeVar('T')


def parse_json(val: Any, default: T = None) -> Union[T, Any]:
    """
    JSON 문자열 또는 값을 파싱합니다.
    
    DB에서 조회한 JSONB 필드를 안전하게 파싱합니다.
    이미 파싱된 dict/list는 그대로 반환합니다.
    
    Args:
        val: 파싱할 값 (str, dict, list, None)
        default: 파싱 실패 시 반환할 기본값
        
    Returns:
        파싱된 값 또는 기본값
        
    Examples:
        >>> parse_json('{"key": "value"}', {})
        {'key': 'value'}
        >>> parse_json(None, [])
        []
        >>> parse_json({'already': 'parsed'}, {})
        {'already': 'parsed'}
    """
    if val is None:
        return default
    if isinstance(val, (dict, list)):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except (json.JSONDecodeError, ValueError):
            return default
    return default


def parse_json_list(val: Any) -> list:
    """JSON을 리스트로 파싱합니다."""
    return parse_json(val, [])


def parse_json_dict(val: Any) -> dict:
    """JSON을 딕셔너리로 파싱합니다."""
    return parse_json(val, {})


def truncate_text(text: str, max_length: int = 500, suffix: str = "...") -> str:
    """
    텍스트를 지정된 길이로 자릅니다.
    
    Args:
        text: 자를 텍스트
        max_length: 최대 길이
        suffix: 잘린 경우 추가할 접미사
        
    Returns:
        잘린 텍스트
    """
    if not text or len(text) <= max_length:
        return text or ""
    return text[:max_length - len(suffix)] + suffix


def safe_float(val: Any, default: float = 0.0) -> float:
    """
    값을 안전하게 float로 변환합니다.
    
    Args:
        val: 변환할 값
        default: 변환 실패 시 기본값
        
    Returns:
        float 값
    """
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def safe_int(val: Any, default: int = 0) -> int:
    """
    값을 안전하게 int로 변환합니다.
    
    Args:
        val: 변환할 값
        default: 변환 실패 시 기본값
        
    Returns:
        int 값
    """
    if val is None:
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        return default
