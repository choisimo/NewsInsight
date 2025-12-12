"""
AI Agent MCP Server - Multi-Provider LLM 관리 및 라우팅

여러 LLM Provider를 등록/관리하고, 가용성 기반 자동 선택,
로드밸런싱, 헬스체크, 사용량 추적 기능을 제공하는 MCP 서버입니다.

Version: 1.0.0
Port: 5010
"""

import os
import json
import asyncio
import hashlib
import random
import time
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any, Tuple
from urllib.parse import urlparse
from contextlib import contextmanager
from base64 import b64encode, b64decode

import httpx
import requests
from mcp.server import Server

# ─────────────────────────────────────────────
# 1. MCP 서버 기본 설정
# ─────────────────────────────────────────────

server = Server("ai-agent-mcp", version="1.0.0")

# DB 백엔드
DB_BACKEND = os.environ.get("DB_BACKEND", "postgres")
POSTGRES_DSN = os.environ.get("DATABASE_URL")
MONGODB_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/newsinsight")

# 암호화 키 (API key 암호화용)
ENCRYPTION_KEY = os.environ.get("ENCRYPTION_KEY", "newsinsight-default-key-change-me")

# 기본 타임아웃 (초)
DEFAULT_TIMEOUT = int(os.environ.get("DEFAULT_TIMEOUT", "60"))

# 헬스체크 간격 (초)
HEALTH_CHECK_INTERVAL = int(os.environ.get("HEALTH_CHECK_INTERVAL", "60"))


# ─────────────────────────────────────────────
# 2. 간단한 암호화/복호화 (API Key 보호용)
# ─────────────────────────────────────────────


def _get_cipher_key() -> bytes:
    """암호화 키를 32바이트로 패딩/해싱"""
    return hashlib.sha256(ENCRYPTION_KEY.encode()).digest()


def encrypt_api_key(plain_key: str) -> str:
    """API key를 간단히 암호화 (XOR + base64)"""
    if not plain_key:
        return ""
    key = _get_cipher_key()
    encrypted = bytes([ord(c) ^ key[i % len(key)] for i, c in enumerate(plain_key)])
    return b64encode(encrypted).decode()


def decrypt_api_key(encrypted_key: str) -> str:
    """암호화된 API key 복호화"""
    if not encrypted_key:
        return ""
    try:
        key = _get_cipher_key()
        encrypted = b64decode(encrypted_key)
        decrypted = bytes([b ^ key[i % len(key)] for i, b in enumerate(encrypted)])
        return decrypted.decode()
    except Exception:
        return ""


# ─────────────────────────────────────────────
# 3. DB 연결 헬퍼
# ─────────────────────────────────────────────

_pg_conn = None


def get_postgres_conn():
    """PostgreSQL 연결을 반환합니다."""
    global _pg_conn
    import psycopg2

    if _pg_conn is None or _pg_conn.closed != 0:
        if not POSTGRES_DSN:
            raise RuntimeError("DATABASE_URL이 설정되어 있지 않습니다.")
        _pg_conn = psycopg2.connect(POSTGRES_DSN)
        _pg_conn.autocommit = True
    return _pg_conn


# ─────────────────────────────────────────────
# 4. Provider 데이터 모델
# ─────────────────────────────────────────────


class ProviderInfo:
    """Provider 정보 데이터 클래스"""

    def __init__(self, row: tuple):
        (
            self.id,
            self.provider_key,
            self.name,
            self.description,
            self.provider_type,
            self.base_url,
            self.api_version,
            self.auth_type,
            self.api_key_encrypted,
            self.auth_header_name,
            self.auth_header_prefix,
            self.custom_headers,
            self.supported_models,
            self.default_model,
            self.max_requests_per_minute,
            self.max_tokens_per_minute,
            self.max_concurrent_requests,
            self.input_price_per_1k,
            self.output_price_per_1k,
            self.priority,
            self.weight,
            self.is_fallback,
            self.enabled,
            self.health_status,
            self.last_health_check,
            self.total_requests,
            self.successful_requests,
            self.failed_requests,
            self.avg_latency_ms,
            self.config,
        ) = row

        # JSON 파싱
        self.supported_models = self._parse_json(self.supported_models, [])
        self.custom_headers = self._parse_json(self.custom_headers, {})
        self.config = self._parse_json(self.config, {})

    def _parse_json(self, val, default):
        if val is None:
            return default
        if isinstance(val, (dict, list)):
            return val
        if isinstance(val, str):
            try:
                return json.loads(val)
            except:
                return default
        return default

    def to_dict(self, include_api_key: bool = False) -> Dict:
        result = {
            "id": self.id,
            "provider_key": self.provider_key,
            "name": self.name,
            "description": self.description,
            "provider_type": self.provider_type,
            "base_url": self.base_url,
            "api_version": self.api_version,
            "auth_type": self.auth_type,
            "auth_header_name": self.auth_header_name,
            "supported_models": self.supported_models,
            "default_model": self.default_model,
            "max_requests_per_minute": self.max_requests_per_minute,
            "priority": self.priority,
            "weight": self.weight,
            "is_fallback": self.is_fallback,
            "enabled": self.enabled,
            "health_status": self.health_status,
            "last_health_check": self.last_health_check.isoformat()
            if self.last_health_check
            else None,
            "stats": {
                "total_requests": self.total_requests or 0,
                "successful_requests": self.successful_requests or 0,
                "failed_requests": self.failed_requests or 0,
                "success_rate": round(
                    (self.successful_requests or 0)
                    / max(self.total_requests or 1, 1)
                    * 100,
                    1,
                ),
                "avg_latency_ms": round(self.avg_latency_ms, 1)
                if self.avg_latency_ms
                else None,
            },
        }
        if include_api_key and self.api_key_encrypted:
            result["has_api_key"] = True
        return result


# ─────────────────────────────────────────────
# 5. Provider CRUD 함수
# ─────────────────────────────────────────────


def list_providers(enabled_only: bool = False) -> List[ProviderInfo]:
    """등록된 모든 Provider 목록 조회"""
    conn = get_postgres_conn()
    with conn.cursor() as cur:
        query = """
            SELECT 
                id, provider_key, name, description, provider_type,
                base_url, api_version, auth_type, api_key_encrypted,
                auth_header_name, auth_header_prefix, custom_headers,
                supported_models, default_model,
                max_requests_per_minute, max_tokens_per_minute, max_concurrent_requests,
                input_price_per_1k, output_price_per_1k,
                priority, weight, is_fallback, enabled, health_status, last_health_check,
                total_requests, successful_requests, failed_requests, avg_latency_ms,
                config
            FROM ai_providers
        """
        if enabled_only:
            query += " WHERE enabled = TRUE"
        query += " ORDER BY priority DESC, weight DESC"
        cur.execute(query)
        rows = cur.fetchall()

    return [ProviderInfo(row) for row in rows]


def get_provider(provider_key: str) -> Optional[ProviderInfo]:
    """특정 Provider 조회"""
    conn = get_postgres_conn()
    with conn.cursor() as cur:
        query = """
            SELECT 
                id, provider_key, name, description, provider_type,
                base_url, api_version, auth_type, api_key_encrypted,
                auth_header_name, auth_header_prefix, custom_headers,
                supported_models, default_model,
                max_requests_per_minute, max_tokens_per_minute, max_concurrent_requests,
                input_price_per_1k, output_price_per_1k,
                priority, weight, is_fallback, enabled, health_status, last_health_check,
                total_requests, successful_requests, failed_requests, avg_latency_ms,
                config
            FROM ai_providers
            WHERE provider_key = %s
        """
        cur.execute(query, (provider_key,))
        row = cur.fetchone()

    return ProviderInfo(row) if row else None


def create_provider(data: Dict[str, Any]) -> Dict[str, Any]:
    """새 Provider 등록"""
    conn = get_postgres_conn()

    # API key 암호화
    api_key = data.get("api_key", "")
    api_key_encrypted = encrypt_api_key(api_key) if api_key else None

    # supported_models JSON 변환
    supported_models = data.get("supported_models", [])
    if isinstance(supported_models, list):
        supported_models = json.dumps(supported_models)

    custom_headers = data.get("custom_headers", {})
    if isinstance(custom_headers, dict):
        custom_headers = json.dumps(custom_headers)

    config = data.get("config", {})
    if isinstance(config, dict):
        config = json.dumps(config)

    with conn.cursor() as cur:
        query = """
            INSERT INTO ai_providers (
                provider_key, name, description, provider_type,
                base_url, api_version, auth_type, api_key_encrypted,
                auth_header_name, auth_header_prefix, custom_headers,
                supported_models, default_model,
                max_requests_per_minute, max_tokens_per_minute, max_concurrent_requests,
                input_price_per_1k, output_price_per_1k,
                priority, weight, is_fallback, enabled, config
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
            RETURNING id, provider_key
        """
        cur.execute(
            query,
            (
                data["provider_key"],
                data["name"],
                data.get("description"),
                data["provider_type"],
                data["base_url"],
                data.get("api_version"),
                data.get("auth_type", "BEARER_TOKEN"),
                api_key_encrypted,
                data.get("auth_header_name", "Authorization"),
                data.get("auth_header_prefix", "Bearer"),
                custom_headers,
                supported_models,
                data.get("default_model"),
                data.get("max_requests_per_minute", 60),
                data.get("max_tokens_per_minute", 100000),
                data.get("max_concurrent_requests", 10),
                data.get("input_price_per_1k", 0.0),
                data.get("output_price_per_1k", 0.0),
                data.get("priority", 100),
                data.get("weight", 1),
                data.get("is_fallback", False),
                data.get("enabled", True),
                config,
            ),
        )
        result = cur.fetchone()

    return {"id": result[0], "provider_key": result[1], "status": "created"}


def update_provider(provider_key: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """Provider 정보 업데이트"""
    conn = get_postgres_conn()

    # 업데이트할 필드 준비
    updates = []
    params = []

    field_mapping = {
        "name": "name",
        "description": "description",
        "base_url": "base_url",
        "api_version": "api_version",
        "auth_type": "auth_type",
        "auth_header_name": "auth_header_name",
        "auth_header_prefix": "auth_header_prefix",
        "default_model": "default_model",
        "max_requests_per_minute": "max_requests_per_minute",
        "max_tokens_per_minute": "max_tokens_per_minute",
        "max_concurrent_requests": "max_concurrent_requests",
        "input_price_per_1k": "input_price_per_1k",
        "output_price_per_1k": "output_price_per_1k",
        "priority": "priority",
        "weight": "weight",
        "is_fallback": "is_fallback",
        "enabled": "enabled",
    }

    for key, col in field_mapping.items():
        if key in data:
            updates.append(f"{col} = %s")
            params.append(data[key])

    # API key 업데이트
    if "api_key" in data:
        updates.append("api_key_encrypted = %s")
        params.append(encrypt_api_key(data["api_key"]) if data["api_key"] else None)

    # supported_models 업데이트
    if "supported_models" in data:
        updates.append("supported_models = %s")
        models = data["supported_models"]
        params.append(json.dumps(models) if isinstance(models, list) else models)

    # custom_headers 업데이트
    if "custom_headers" in data:
        updates.append("custom_headers = %s")
        headers = data["custom_headers"]
        params.append(json.dumps(headers) if isinstance(headers, dict) else headers)

    # config 업데이트
    if "config" in data:
        updates.append("config = %s")
        config = data["config"]
        params.append(json.dumps(config) if isinstance(config, dict) else config)

    if not updates:
        return {"status": "no_changes"}

    updates.append("updated_at = CURRENT_TIMESTAMP")
    params.append(provider_key)

    with conn.cursor() as cur:
        query = f"""
            UPDATE ai_providers 
            SET {", ".join(updates)}
            WHERE provider_key = %s
            RETURNING id
        """
        cur.execute(query, params)
        result = cur.fetchone()

    if result:
        return {"id": result[0], "provider_key": provider_key, "status": "updated"}
    return {"status": "not_found"}


def delete_provider(provider_key: str) -> Dict[str, Any]:
    """Provider 삭제"""
    conn = get_postgres_conn()
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM ai_providers WHERE provider_key = %s RETURNING id",
            (provider_key,),
        )
        result = cur.fetchone()

    if result:
        return {"id": result[0], "provider_key": provider_key, "status": "deleted"}
    return {"status": "not_found"}


# ─────────────────────────────────────────────
# 6. Provider 선택 로직 (로드밸런싱)
# ─────────────────────────────────────────────


def select_provider(
    model: Optional[str] = None,
    provider_type: Optional[str] = None,
    strategy: str = "priority",
) -> Optional[ProviderInfo]:
    """
    가용한 Provider를 선택합니다.

    Args:
        model: 특정 모델 요청 시 해당 모델을 지원하는 Provider 선택
        provider_type: 특정 Provider 타입 지정 (OPENAI, ANTHROPIC 등)
        strategy: 선택 전략
            - "priority": 우선순위 기반 (기본)
            - "round_robin": 라운드로빈
            - "weighted_random": 가중치 기반 랜덤
            - "least_latency": 최소 지연시간
            - "least_errors": 최소 에러율

    Returns:
        선택된 Provider 또는 None
    """
    providers = list_providers(enabled_only=True)

    if not providers:
        return None

    # 필터링: health_status가 HEALTHY 또는 UNKNOWN인 것만
    healthy_providers = [
        p for p in providers if p.health_status in ("HEALTHY", "UNKNOWN", None)
    ]

    # 건강한 Provider가 없으면 fallback Provider 사용
    if not healthy_providers:
        healthy_providers = [p for p in providers if p.is_fallback]

    if not healthy_providers:
        healthy_providers = providers  # 마지막 수단

    # 모델 필터링
    if model:
        model_providers = [p for p in healthy_providers if model in p.supported_models]
        if model_providers:
            healthy_providers = model_providers

    # Provider 타입 필터링
    if provider_type:
        type_providers = [
            p for p in healthy_providers if p.provider_type == provider_type
        ]
        if type_providers:
            healthy_providers = type_providers

    if not healthy_providers:
        return None

    # 선택 전략 적용
    if strategy == "priority":
        # 우선순위 순 (이미 정렬되어 있음)
        return healthy_providers[0]

    elif strategy == "round_robin":
        # 간단한 라운드로빈 (요청 수 기반)
        sorted_by_requests = sorted(
            healthy_providers, key=lambda p: p.total_requests or 0
        )
        return sorted_by_requests[0]

    elif strategy == "weighted_random":
        # 가중치 기반 랜덤
        total_weight = sum(p.weight or 1 for p in healthy_providers)
        rand = random.uniform(0, total_weight)
        cumulative = 0
        for p in healthy_providers:
            cumulative += p.weight or 1
            if rand <= cumulative:
                return p
        return healthy_providers[0]

    elif strategy == "least_latency":
        # 최소 지연시간
        with_latency = [p for p in healthy_providers if p.avg_latency_ms]
        if with_latency:
            return min(with_latency, key=lambda p: p.avg_latency_ms)
        return healthy_providers[0]

    elif strategy == "least_errors":
        # 최소 에러율
        def error_rate(p):
            total = p.total_requests or 0
            failed = p.failed_requests or 0
            return failed / max(total, 1)

        return min(healthy_providers, key=error_rate)

    else:
        return healthy_providers[0]


# ─────────────────────────────────────────────
# 7. LLM API 호출
# ─────────────────────────────────────────────


async def call_llm_provider(
    provider: ProviderInfo,
    messages: List[Dict[str, str]],
    model: Optional[str] = None,
    temperature: float = 0.7,
    max_tokens: int = 4096,
    timeout: int = DEFAULT_TIMEOUT,
) -> Dict[str, Any]:
    """
    선택된 Provider의 LLM API를 호출합니다.
    """
    model = model or provider.default_model

    # API key 복호화
    api_key = (
        decrypt_api_key(provider.api_key_encrypted)
        if provider.api_key_encrypted
        else ""
    )

    # 헤더 구성
    headers = {"Content-Type": "application/json"}

    if provider.auth_type == "BEARER_TOKEN" and api_key:
        prefix = provider.auth_header_prefix or "Bearer"
        header_name = provider.auth_header_name or "Authorization"
        headers[header_name] = f"{prefix} {api_key}"
    elif provider.auth_type == "API_KEY" and api_key:
        header_name = provider.auth_header_name or "x-api-key"
        headers[header_name] = api_key

    # custom_headers 추가
    if provider.custom_headers:
        headers.update(provider.custom_headers)

    # Provider 타입별 요청 구성
    start_time = time.time()

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            if provider.provider_type == "AIDOVE":
                # AiDove는 특별한 형식
                last_message = messages[-1]["content"] if messages else ""
                payload = {"chatInput": last_message}
                response = await client.post(
                    provider.base_url, json=payload, headers=headers
                )

            elif provider.provider_type == "ANTHROPIC":
                # Anthropic Claude API
                url = f"{provider.base_url}/v1/messages"
                headers["anthropic-version"] = provider.api_version or "2024-01-01"

                # system 메시지 분리
                system_msg = ""
                chat_messages = []
                for msg in messages:
                    if msg["role"] == "system":
                        system_msg = msg["content"]
                    else:
                        chat_messages.append(msg)

                payload = {
                    "model": model,
                    "messages": chat_messages,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                }
                if system_msg:
                    payload["system"] = system_msg

                response = await client.post(url, json=payload, headers=headers)

            elif provider.provider_type == "OLLAMA":
                # Ollama API
                url = f"{provider.base_url}/api/chat"
                payload = {
                    "model": model,
                    "messages": messages,
                    "stream": False,
                    "options": {
                        "temperature": temperature,
                        "num_predict": max_tokens,
                    },
                }
                response = await client.post(url, json=payload, headers=headers)

            else:
                # OpenAI 호환 API (OpenAI, Groq, DeepSeek, Azure 등)
                url = f"{provider.base_url}/chat/completions"
                payload = {
                    "model": model,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                }
                response = await client.post(url, json=payload, headers=headers)

        latency_ms = int((time.time() - start_time) * 1000)

        # 응답 처리
        if response.status_code != 200:
            error_text = response.text
            update_provider_stats(
                provider.provider_key, success=False, latency_ms=latency_ms
            )
            return {
                "success": False,
                "error": f"API error: {response.status_code}",
                "details": error_text[:500],
                "latency_ms": latency_ms,
            }

        data = response.json()

        # Provider 타입별 응답 파싱
        if provider.provider_type == "AIDOVE":
            text = data.get("reply") or data.get("output") or ""
            input_tokens = 0
            output_tokens = 0
        elif provider.provider_type == "ANTHROPIC":
            content = data.get("content", [])
            text = content[0].get("text", "") if content else ""
            usage = data.get("usage", {})
            input_tokens = usage.get("input_tokens", 0)
            output_tokens = usage.get("output_tokens", 0)
        elif provider.provider_type == "OLLAMA":
            text = data.get("message", {}).get("content", "")
            input_tokens = data.get("prompt_eval_count", 0)
            output_tokens = data.get("eval_count", 0)
        else:
            # OpenAI 호환
            choices = data.get("choices", [])
            text = choices[0].get("message", {}).get("content", "") if choices else ""
            usage = data.get("usage", {})
            input_tokens = usage.get("prompt_tokens", 0)
            output_tokens = usage.get("completion_tokens", 0)

        # 통계 업데이트
        update_provider_stats(
            provider.provider_key,
            success=True,
            latency_ms=latency_ms,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )

        return {
            "success": True,
            "text": text,
            "model": model,
            "provider": provider.provider_key,
            "provider_type": provider.provider_type,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
            },
            "latency_ms": latency_ms,
        }

    except httpx.TimeoutException:
        latency_ms = int((time.time() - start_time) * 1000)
        update_provider_stats(
            provider.provider_key, success=False, latency_ms=latency_ms
        )
        return {
            "success": False,
            "error": "Timeout",
            "latency_ms": latency_ms,
        }
    except Exception as e:
        latency_ms = int((time.time() - start_time) * 1000)
        update_provider_stats(
            provider.provider_key, success=False, latency_ms=latency_ms
        )
        return {
            "success": False,
            "error": str(e),
            "latency_ms": latency_ms,
        }


def update_provider_stats(
    provider_key: str,
    success: bool,
    latency_ms: int,
    input_tokens: int = 0,
    output_tokens: int = 0,
):
    """Provider 통계 업데이트"""
    try:
        conn = get_postgres_conn()
        with conn.cursor() as cur:
            if success:
                cur.execute(
                    """
                    UPDATE ai_providers SET
                        total_requests = COALESCE(total_requests, 0) + 1,
                        successful_requests = COALESCE(successful_requests, 0) + 1,
                        total_tokens_used = COALESCE(total_tokens_used, 0) + %s,
                        avg_latency_ms = CASE 
                            WHEN avg_latency_ms IS NULL THEN %s
                            ELSE (avg_latency_ms * 0.9 + %s * 0.1)
                        END,
                        stats_updated_at = CURRENT_TIMESTAMP
                    WHERE provider_key = %s
                """,
                    (
                        input_tokens + output_tokens,
                        latency_ms,
                        latency_ms,
                        provider_key,
                    ),
                )
            else:
                cur.execute(
                    """
                    UPDATE ai_providers SET
                        total_requests = COALESCE(total_requests, 0) + 1,
                        failed_requests = COALESCE(failed_requests, 0) + 1,
                        stats_updated_at = CURRENT_TIMESTAMP
                    WHERE provider_key = %s
                """,
                    (provider_key,),
                )
    except Exception as e:
        print(f"Error updating stats: {e}")


# ─────────────────────────────────────────────
# 8. 헬스체크
# ─────────────────────────────────────────────


async def check_provider_health(provider: ProviderInfo) -> Dict[str, Any]:
    """Provider 헬스체크 수행"""
    start_time = time.time()

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # Provider 타입별 헬스체크
            if provider.provider_type == "AIDOVE":
                # AiDove는 간단한 ping
                response = await client.post(
                    provider.base_url,
                    json={"chatInput": "ping"},
                    headers={"Content-Type": "application/json"},
                )
                healthy = response.status_code == 200
            elif provider.provider_type == "OLLAMA":
                # Ollama API 확인
                response = await client.get(f"{provider.base_url}/api/tags")
                healthy = response.status_code == 200
            else:
                # OpenAI 호환 API - models 엔드포인트 확인
                api_key = (
                    decrypt_api_key(provider.api_key_encrypted)
                    if provider.api_key_encrypted
                    else ""
                )
                headers = {"Content-Type": "application/json"}

                if api_key:
                    if provider.auth_type == "API_KEY":
                        headers[provider.auth_header_name or "x-api-key"] = api_key
                    else:
                        prefix = provider.auth_header_prefix or "Bearer"
                        headers[provider.auth_header_name or "Authorization"] = (
                            f"{prefix} {api_key}"
                        )

                response = await client.get(
                    f"{provider.base_url}/models",
                    headers=headers,
                )
                healthy = response.status_code == 200

        latency_ms = int((time.time() - start_time) * 1000)
        status = "HEALTHY" if healthy else "UNHEALTHY"

    except Exception as e:
        latency_ms = int((time.time() - start_time) * 1000)
        status = "UNHEALTHY"
        healthy = False

    # DB 업데이트
    try:
        conn = get_postgres_conn()
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE ai_providers SET
                    health_status = %s,
                    last_health_check = CURRENT_TIMESTAMP
                WHERE provider_key = %s
            """,
                (status, provider.provider_key),
            )

            # 헬스 히스토리 기록
            cur.execute(
                """
                INSERT INTO ai_provider_health_history (provider_id, status, latency_ms)
                VALUES (%s, %s, %s)
            """,
                (provider.id, status, latency_ms),
            )
    except Exception as e:
        print(f"Error updating health status: {e}")

    return {
        "provider_key": provider.provider_key,
        "status": status,
        "latency_ms": latency_ms,
        "checked_at": datetime.utcnow().isoformat(),
    }


# ─────────────────────────────────────────────
# 9. MCP Tools
# ─────────────────────────────────────────────


@server.tool()
async def list_ai_providers(enabled_only: bool = False) -> Dict[str, Any]:
    """
    등록된 AI Provider 목록을 반환합니다.

    Args:
        enabled_only: True면 활성화된 Provider만 반환

    Returns:
        Provider 목록
    """
    providers = list_providers(enabled_only)
    return {
        "count": len(providers),
        "providers": [p.to_dict() for p in providers],
    }


@server.tool()
async def get_ai_provider(provider_key: str) -> Dict[str, Any]:
    """
    특정 AI Provider 정보를 반환합니다.

    Args:
        provider_key: Provider 고유 키

    Returns:
        Provider 상세 정보
    """
    provider = get_provider(provider_key)
    if provider:
        return {"found": True, "provider": provider.to_dict()}
    return {"found": False, "error": "Provider not found"}


@server.tool()
async def register_ai_provider(
    provider_key: str,
    name: str,
    provider_type: str,
    base_url: str,
    api_key: Optional[str] = None,
    supported_models: Optional[List[str]] = None,
    default_model: Optional[str] = None,
    auth_type: str = "BEARER_TOKEN",
    priority: int = 100,
    enabled: bool = True,
    description: Optional[str] = None,
) -> Dict[str, Any]:
    """
    새 AI Provider를 등록합니다.

    Args:
        provider_key: Provider 고유 키 (예: openai-main)
        name: Provider 표시 이름
        provider_type: Provider 타입 (OPENAI, ANTHROPIC, GOOGLE, GROQ, DEEPSEEK, OLLAMA, AIDOVE, CUSTOM)
        base_url: API Base URL
        api_key: API 키 (암호화되어 저장)
        supported_models: 지원 모델 목록
        default_model: 기본 모델
        auth_type: 인증 방식 (BEARER_TOKEN, API_KEY, NONE)
        priority: 우선순위 (높을수록 우선)
        enabled: 활성화 여부
        description: 설명

    Returns:
        등록 결과
    """
    data = {
        "provider_key": provider_key,
        "name": name,
        "provider_type": provider_type,
        "base_url": base_url,
        "api_key": api_key,
        "supported_models": supported_models or [],
        "default_model": default_model,
        "auth_type": auth_type,
        "priority": priority,
        "enabled": enabled,
        "description": description,
    }

    try:
        result = create_provider(data)
        return {"success": True, **result}
    except Exception as e:
        return {"success": False, "error": str(e)}


@server.tool()
async def update_ai_provider(
    provider_key: str,
    name: Optional[str] = None,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    supported_models: Optional[List[str]] = None,
    default_model: Optional[str] = None,
    priority: Optional[int] = None,
    enabled: Optional[bool] = None,
    description: Optional[str] = None,
) -> Dict[str, Any]:
    """
    기존 AI Provider 정보를 업데이트합니다.

    Args:
        provider_key: Provider 고유 키
        (이하 업데이트할 필드들)

    Returns:
        업데이트 결과
    """
    data = {}
    if name is not None:
        data["name"] = name
    if base_url is not None:
        data["base_url"] = base_url
    if api_key is not None:
        data["api_key"] = api_key
    if supported_models is not None:
        data["supported_models"] = supported_models
    if default_model is not None:
        data["default_model"] = default_model
    if priority is not None:
        data["priority"] = priority
    if enabled is not None:
        data["enabled"] = enabled
    if description is not None:
        data["description"] = description

    try:
        result = update_provider(provider_key, data)
        return {"success": True, **result}
    except Exception as e:
        return {"success": False, "error": str(e)}


@server.tool()
async def delete_ai_provider(provider_key: str) -> Dict[str, Any]:
    """
    AI Provider를 삭제합니다.

    Args:
        provider_key: Provider 고유 키

    Returns:
        삭제 결과
    """
    try:
        result = delete_provider(provider_key)
        return {"success": True, **result}
    except Exception as e:
        return {"success": False, "error": str(e)}


@server.tool()
async def chat_completion(
    message: str,
    model: Optional[str] = None,
    provider_key: Optional[str] = None,
    provider_type: Optional[str] = None,
    system_prompt: Optional[str] = None,
    temperature: float = 0.7,
    max_tokens: int = 4096,
    strategy: str = "priority",
) -> Dict[str, Any]:
    """
    LLM에 메시지를 전송하고 응답을 받습니다.
    Provider는 자동 선택되거나 지정할 수 있습니다.

    Args:
        message: 사용자 메시지
        model: 사용할 모델 (옵션)
        provider_key: 특정 Provider 지정 (옵션)
        provider_type: Provider 타입 지정 (옵션)
        system_prompt: 시스템 프롬프트 (옵션)
        temperature: 온도 (0-2)
        max_tokens: 최대 토큰 수
        strategy: Provider 선택 전략 (priority, round_robin, weighted_random, least_latency, least_errors)

    Returns:
        LLM 응답
    """
    # Provider 선택
    if provider_key:
        provider = get_provider(provider_key)
        if not provider:
            return {"success": False, "error": f"Provider not found: {provider_key}"}
        if not provider.enabled:
            return {"success": False, "error": f"Provider is disabled: {provider_key}"}
    else:
        provider = select_provider(
            model=model, provider_type=provider_type, strategy=strategy
        )
        if not provider:
            return {"success": False, "error": "No available provider"}

    # 메시지 구성
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": message})

    # LLM 호출
    result = await call_llm_provider(
        provider=provider,
        messages=messages,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
    )

    return result


@server.tool()
async def check_all_providers_health() -> Dict[str, Any]:
    """
    모든 활성화된 Provider의 헬스체크를 수행합니다.

    Returns:
        헬스체크 결과 목록
    """
    providers = list_providers(enabled_only=True)
    results = []

    for provider in providers:
        result = await check_provider_health(provider)
        results.append(result)

    healthy_count = sum(1 for r in results if r["status"] == "HEALTHY")

    return {
        "total": len(results),
        "healthy": healthy_count,
        "unhealthy": len(results) - healthy_count,
        "results": results,
        "checked_at": datetime.utcnow().isoformat(),
    }


@server.tool()
async def get_provider_stats(provider_key: Optional[str] = None) -> Dict[str, Any]:
    """
    Provider 사용 통계를 반환합니다.

    Args:
        provider_key: 특정 Provider (없으면 전체)

    Returns:
        사용 통계
    """
    if provider_key:
        provider = get_provider(provider_key)
        if not provider:
            return {"found": False, "error": "Provider not found"}

        return {
            "provider_key": provider_key,
            "stats": provider.to_dict()["stats"],
        }

    # 전체 통계
    providers = list_providers()
    total_requests = sum(p.total_requests or 0 for p in providers)
    total_successful = sum(p.successful_requests or 0 for p in providers)
    total_failed = sum(p.failed_requests or 0 for p in providers)

    return {
        "total_providers": len(providers),
        "enabled_providers": sum(1 for p in providers if p.enabled),
        "healthy_providers": sum(1 for p in providers if p.health_status == "HEALTHY"),
        "total_requests": total_requests,
        "total_successful": total_successful,
        "total_failed": total_failed,
        "overall_success_rate": round(
            total_successful / max(total_requests, 1) * 100, 1
        ),
        "providers": [
            {
                "provider_key": p.provider_key,
                "name": p.name,
                "enabled": p.enabled,
                "health_status": p.health_status,
                **p.to_dict()["stats"],
            }
            for p in providers
        ],
    }


@server.tool()
async def health_check() -> Dict[str, Any]:
    """
    서버 상태 및 DB 연결 상태를 확인합니다.

    Returns:
        서버 상태 정보
    """
    status = {
        "server": "AI Agent MCP",
        "version": "1.0.0",
        "db_backend": DB_BACKEND,
        "status": "running",
        "timestamp": datetime.utcnow().isoformat(),
    }

    try:
        conn = get_postgres_conn()
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM ai_providers")
            count = cur.fetchone()[0]
        status["postgres"] = "connected"
        status["provider_count"] = count
    except Exception as e:
        status["db_error"] = str(e)
        status["status"] = "degraded"

    return status


# ─────────────────────────────────────────────
# 10. HTTP 헬스체크 핸들러
# ─────────────────────────────────────────────

from http.server import HTTPServer, BaseHTTPRequestHandler
import threading


class HealthCheckHandler(BaseHTTPRequestHandler):
    """간단한 헬스체크 엔드포인트 핸들러"""

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            response = {
                "status": "healthy",
                "server": "ai-agent-mcp",
                "version": "1.0.0",
            }
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5010"))
    print(f"Starting AI Agent MCP Server v1.0.0 on port {port}")
    print(f"DB Backend: {DB_BACKEND}")
    server.run_http(host="0.0.0.0", port=port, path="/mcp")
