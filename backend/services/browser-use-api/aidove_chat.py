"""
AIDove Chat Model for Browser-Use

Implements the BaseChatModel protocol to integrate AIDove with browser-use Agent.
"""

import asyncio
import json
import logging
import os
from typing import Any, TypeVar, overload

import httpx
from pydantic import BaseModel

logger = logging.getLogger(__name__)

T = TypeVar('T', bound=BaseModel)

# AiDove Webhook URL
AIDOVE_WEBHOOK_URL = os.environ.get(
    "AIDOVE_WEBHOOK_URL", "https://workflow.nodove.com/webhook/aidove"
)


class ChatInvokeUsage(BaseModel):
    """Usage information for a chat model invocation."""
    prompt_tokens: int = 0
    prompt_cached_tokens: int | None = None
    prompt_cache_creation_tokens: int | None = None
    prompt_image_tokens: int | None = None
    completion_tokens: int = 0
    total_tokens: int = 0


class ChatInvokeCompletion(BaseModel):
    """Response from a chat model invocation."""
    completion: Any
    thinking: str | None = None
    redacted_thinking: str | None = None
    usage: ChatInvokeUsage | None = None
    stop_reason: str | None = None


class ChatAIDove:
    """
    AIDove LLM wrapper compatible with browser-use's BaseChatModel protocol.
    
    This integrates the AIDove webhook API with browser-use's agent system.
    """
    
    _verified_api_keys: bool = True
    model: str = "aidove"
    
    def __init__(
        self,
        session_id: str | None = None,
        timeout: float = 120.0,
        max_retries: int = 3,
        webhook_url: str | None = None,
    ):
        self.session_id = session_id
        self.timeout = timeout
        self.max_retries = max_retries
        self.webhook_url = webhook_url or AIDOVE_WEBHOOK_URL
        self._client: httpx.AsyncClient | None = None
    
    @property
    def provider(self) -> str:
        return "aidove"
    
    @property
    def name(self) -> str:
        return "aidove"
    
    @property
    def model_name(self) -> str:
        return self.model
    
    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client
    
    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
    
    def _format_messages(self, messages: list[Any]) -> str:
        """Convert browser-use messages to a single prompt string for AIDove."""
        parts = []
        for msg in messages:
            if hasattr(msg, 'role') and hasattr(msg, 'content'):
                role = msg.role
                content = msg.content
                
                # Handle content that might be a list of parts
                if isinstance(content, list):
                    text_parts = []
                    for part in content:
                        if hasattr(part, 'text'):
                            text_parts.append(part.text)
                        elif isinstance(part, dict) and 'text' in part:
                            text_parts.append(part['text'])
                        elif isinstance(part, str):
                            text_parts.append(part)
                    content = '\n'.join(text_parts)
                
                if role == 'system':
                    parts.append(f"[System]\n{content}")
                elif role == 'user':
                    parts.append(f"[User]\n{content}")
                elif role == 'assistant':
                    parts.append(f"[Assistant]\n{content}")
                else:
                    parts.append(content)
            elif isinstance(msg, str):
                parts.append(msg)
        
        return '\n\n'.join(parts)
    
    def _parse_structured_response(self, response_text: str, output_format: type[T] | None) -> T | str:
        """Parse response into structured format if requested."""
        if output_format is None:
            return response_text
        
        try:
            # Try to extract JSON from the response
            # Look for JSON block markers
            if '```json' in response_text:
                start = response_text.find('```json') + 7
                end = response_text.find('```', start)
                if end > start:
                    json_str = response_text[start:end].strip()
                    data = json.loads(json_str)
                    return output_format.model_validate(data)
            
            # Try to parse the whole response as JSON
            if response_text.strip().startswith('{'):
                data = json.loads(response_text)
                return output_format.model_validate(data)
            
            # If all else fails, return as string
            return response_text
        except (json.JSONDecodeError, Exception) as e:
            logger.warning(f"Failed to parse structured response: {e}")
            return response_text
    
    @overload
    async def ainvoke(
        self, messages: list[Any], output_format: None = None, **kwargs: Any
    ) -> ChatInvokeCompletion: ...
    
    @overload
    async def ainvoke(
        self, messages: list[Any], output_format: type[T], **kwargs: Any
    ) -> ChatInvokeCompletion: ...
    
    async def ainvoke(
        self, messages: list[Any], output_format: type[T] | None = None, **kwargs: Any
    ) -> ChatInvokeCompletion:
        """
        Invoke the AIDove model with the given messages.
        
        Args:
            messages: List of messages in browser-use format
            output_format: Optional Pydantic model for structured output
            **kwargs: Additional arguments (ignored)
            
        Returns:
            ChatInvokeCompletion with the response
        """
        prompt = self._format_messages(messages)
        
        # Add structured output instructions if format is requested
        if output_format is not None:
            schema = output_format.model_json_schema()
            prompt += f"\n\n[Important: Respond with valid JSON matching this schema]\n{json.dumps(schema, indent=2)}"
        
        payload = {"chatInput": prompt}
        if self.session_id:
            payload["sessionId"] = self.session_id
        
        client = await self._get_client()
        last_error = None
        
        for attempt in range(self.max_retries):
            try:
                resp = await client.post(self.webhook_url, json=payload)
                resp.raise_for_status()
                data = resp.json()
                
                response_text = data.get("reply", data.get("output", ""))
                
                if not response_text:
                    logger.warning(f"Empty response from AIDove (attempt {attempt + 1})")
                    if attempt < self.max_retries - 1:
                        await asyncio.sleep(1.0 * (attempt + 1))
                        continue
                
                # Parse response
                completion = self._parse_structured_response(response_text, output_format)
                
                # Estimate token usage (rough approximation)
                prompt_tokens = len(prompt) // 4
                completion_tokens = len(response_text) // 4 if response_text else 0
                
                return ChatInvokeCompletion(
                    completion=completion,
                    thinking=None,
                    usage=ChatInvokeUsage(
                        prompt_tokens=prompt_tokens,
                        completion_tokens=completion_tokens,
                        total_tokens=prompt_tokens + completion_tokens,
                    ),
                    stop_reason="end_turn",
                )
                
            except httpx.TimeoutException as e:
                last_error = e
                logger.warning(f"AIDove timeout (attempt {attempt + 1}/{self.max_retries})")
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(2.0 * (attempt + 1))
                    
            except httpx.HTTPError as e:
                last_error = e
                logger.warning(f"AIDove HTTP error (attempt {attempt + 1}/{self.max_retries}): {e}")
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(1.0 * (attempt + 1))
        
        # All retries failed
        error_msg = f"AIDove invocation failed after {self.max_retries} attempts: {last_error}"
        logger.error(error_msg)
        
        return ChatInvokeCompletion(
            completion=error_msg if output_format is None else output_format.model_validate({}),
            thinking=None,
            usage=ChatInvokeUsage(prompt_tokens=0, completion_tokens=0, total_tokens=0),
            stop_reason="error",
        )
