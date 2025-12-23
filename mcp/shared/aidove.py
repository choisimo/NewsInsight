"""
NewsInsight MCP Shared - AiDove Integration Module

AiDove API 호출을 위한 공유 모듈입니다.
"""

import os
from typing import Optional

import requests

# AiDove Webhook URL
AIDOVE_WEBHOOK_URL = os.environ.get(
    "AIDOVE_WEBHOOK_URL", "https://workflow.nodove.com/webhook/aidove"
)

# 기본 타임아웃 (초)
AIDOVE_TIMEOUT = int(os.environ.get("AIDOVE_TIMEOUT", "60"))


def call_aidove(
    prompt: str,
    session_id: Optional[str] = None,
    timeout: int = AIDOVE_TIMEOUT,
) -> str:
    """
    AiDove API를 호출하여 자연어 리포트를 생성합니다.
    
    Args:
        prompt: LLM에 전달할 프롬프트
        session_id: 세션 ID (대화 컨텍스트 유지용)
        timeout: 요청 타임아웃 (초)
        
    Returns:
        str: AiDove 응답 텍스트
    """
    payload = {"chatInput": prompt}
    if session_id:
        payload["sessionId"] = session_id

    try:
        resp = requests.post(AIDOVE_WEBHOOK_URL, json=payload, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()
        return data.get("reply", data.get("output", "리포트 생성에 실패했습니다."))
    except requests.Timeout:
        return f"AiDove 호출 타임아웃 ({timeout}초)"
    except requests.RequestException as e:
        return f"AiDove 호출 실패: {str(e)}"


async def call_aidove_async(
    prompt: str,
    session_id: Optional[str] = None,
    timeout: int = AIDOVE_TIMEOUT,
) -> str:
    """
    AiDove API를 비동기로 호출합니다.
    
    Args:
        prompt: LLM에 전달할 프롬프트
        session_id: 세션 ID (대화 컨텍스트 유지용)
        timeout: 요청 타임아웃 (초)
        
    Returns:
        str: AiDove 응답 텍스트
    """
    import httpx
    
    payload = {"chatInput": prompt}
    if session_id:
        payload["sessionId"] = session_id

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(AIDOVE_WEBHOOK_URL, json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data.get("reply", data.get("output", "리포트 생성에 실패했습니다."))
    except httpx.TimeoutException:
        return f"AiDove 호출 타임아웃 ({timeout}초)"
    except httpx.HTTPError as e:
        return f"AiDove 호출 실패: {str(e)}"
