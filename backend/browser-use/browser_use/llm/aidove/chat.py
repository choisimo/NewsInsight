"""
AI Dove LLM provider for browser-use.
Connects to the AI Dove webhook API at workflow.nodove.com.
"""

from dataclasses import dataclass, field
from typing import Any, TypeVar, overload
import json
import aiohttp

from pydantic import BaseModel

from browser_use.llm.base import BaseChatModel
from browser_use.llm.exceptions import ModelProviderError, ModelRateLimitError
from browser_use.llm.messages import BaseMessage
from browser_use.llm.views import ChatInvokeCompletion, ChatInvokeUsage
from browser_use.llm.schema import SchemaOptimizer


T = TypeVar('T', bound=BaseModel)


@dataclass
class ChatAIDove(BaseChatModel):
    """
    AI Dove LLM provider that connects to the workflow.nodove.com webhook API.
    
    This implements a custom chat model that uses the AI Dove Self-Healing
    AI service with automatic failover between LLM providers.
    
    API Endpoint: POST https://workflow.nodove.com/webhook/aidove
    
    Request Body:
        - chatInput: string (required) - The message/prompt
        - sessionId: string (optional) - Session ID for context continuity
    
    Response:
        - reply: string - AI response
        - tokens_used: integer - Tokens consumed
        - model: string - Model used for generation
    """
    
    # Model configuration
    model: str = "aidove"
    
    # API configuration
    base_url: str = "https://workflow.nodove.com/webhook/aidove"
    session_id: str | None = None
    timeout: float = 120.0
    max_retries: int = 3
    
    # Temperature is not used by AI Dove but kept for interface compatibility
    temperature: float | None = None
    
    @property
    def provider(self) -> str:
        return 'aidove'
    
    @property
    def name(self) -> str:
        return self.model
    
    def _build_prompt_from_messages(self, messages: list[BaseMessage]) -> str:
        """
        Convert list of BaseMessage to a single prompt string for AI Dove.
        AI Dove uses a simple chatInput format, so we need to concatenate messages.
        """
        prompt_parts = []
        
        for msg in messages:
            # Handle Pydantic BaseMessage objects (UserMessage, SystemMessage, AssistantMessage)
            if hasattr(msg, 'role'):
                role = msg.role
                # Use the .text property if available (from BaseMessage subclasses)
                if hasattr(msg, 'text'):
                    content = msg.text
                elif hasattr(msg, 'content'):
                    content = msg.content
                    # Handle content that might be a list (multimodal)
                    if isinstance(content, list):
                        text_parts = []
                        for part in content:
                            if hasattr(part, 'type'):
                                if part.type == 'text' and hasattr(part, 'text'):
                                    text_parts.append(part.text)
                                elif part.type == 'image_url':
                                    text_parts.append('[Image]')
                            elif isinstance(part, str):
                                text_parts.append(part)
                        content = ' '.join(text_parts)
                else:
                    content = str(msg)
            # Handle dict-like messages (fallback)
            elif isinstance(msg, dict):
                role = msg.get('role', 'user')
                content = msg.get('content', '')
                if isinstance(content, list):
                    text_parts = []
                    for part in content:
                        if isinstance(part, dict):
                            if part.get('type') == 'text':
                                text_parts.append(part.get('text', ''))
                            elif part.get('type') == 'image_url':
                                text_parts.append('[Image]')
                        elif isinstance(part, str):
                            text_parts.append(part)
                    content = ' '.join(text_parts)
            else:
                role = 'user'
                content = str(msg)
            
            if role == 'system':
                prompt_parts.append(f"[System Instructions]\n{content}")
            elif role == 'assistant':
                prompt_parts.append(f"[Previous Assistant Response]\n{content}")
            else:  # user
                prompt_parts.append(f"[User]\n{content}")
        
        return '\n\n'.join(prompt_parts)
    
    async def _call_api(self, prompt: str) -> dict[str, Any]:
        """Make an API call to AI Dove webhook."""
        payload = {
            "chatInput": prompt
        }
        
        if self.session_id:
            payload["sessionId"] = self.session_id
        
        async with aiohttp.ClientSession() as session:
            for attempt in range(self.max_retries):
                try:
                    async with session.post(
                        self.base_url,
                        json=payload,
                        timeout=aiohttp.ClientTimeout(total=self.timeout),
                        headers={"Content-Type": "application/json"}
                    ) as response:
                        if response.status == 429:
                            raise ModelRateLimitError(
                                message="Rate limit exceeded",
                                model=self.name
                            )
                        
                        if response.status != 200:
                            error_text = await response.text()
                            raise ModelProviderError(
                                message=f"API error: {error_text}",
                                status_code=response.status,
                                model=self.name
                            )
                        
                        return await response.json()
                        
                except aiohttp.ClientError as e:
                    if attempt == self.max_retries - 1:
                        raise ModelProviderError(
                            message=f"Connection error after {self.max_retries} retries: {str(e)}",
                            model=self.name
                        ) from e
                    continue
        
        raise ModelProviderError(message="Unexpected error", model=self.name)
    
    @overload
    async def ainvoke(self, messages: list[BaseMessage], output_format: None = None) -> ChatInvokeCompletion[str]: ...
    
    @overload
    async def ainvoke(self, messages: list[BaseMessage], output_format: type[T]) -> ChatInvokeCompletion[T]: ...
    
    async def ainvoke(
        self, messages: list[BaseMessage], output_format: type[T] | None = None
    ) -> ChatInvokeCompletion[T] | ChatInvokeCompletion[str]:
        """
        Invoke the AI Dove model with the given messages.
        
        Args:
            messages: List of chat messages
            output_format: Optional Pydantic model class for structured output
            
        Returns:
            Either a string response or an instance of output_format
        """
        try:
            # Build prompt from messages
            prompt = self._build_prompt_from_messages(messages)
            
            # Add JSON schema instruction if structured output is requested
            if output_format is not None:
                schema = SchemaOptimizer.create_optimized_json_schema(output_format)
                prompt += f"\n\n[Output Format]\nYou MUST respond with valid JSON that matches this schema:\n```json\n{json.dumps(schema, indent=2)}\n```\n\nRespond ONLY with the JSON object, no other text."
            
            # Call AI Dove API
            response = await self._call_api(prompt)
            
            # Extract response data
            reply = response.get('reply', '')
            tokens_used = response.get('tokens_used', 0)
            model_used = response.get('model', 'unknown')
            
            # Update model name with actual model used
            self.model = f"aidove-{model_used}"
            
            # Build usage info
            usage = ChatInvokeUsage(
                prompt_tokens=0,  # AI Dove doesn't provide this breakdown
                completion_tokens=tokens_used,
                total_tokens=tokens_used,
                prompt_cached_tokens=None,
                prompt_cache_creation_tokens=None,
                prompt_image_tokens=None,
            )
            
            if output_format is None:
                return ChatInvokeCompletion(
                    completion=reply,
                    usage=usage,
                    stop_reason='stop',
                )
            else:
                # Parse structured output
                try:
                    # Try to extract JSON from the reply
                    json_str = reply
                    
                    # Handle case where response might be wrapped in markdown code blocks
                    if '```json' in json_str:
                        json_str = json_str.split('```json')[1].split('```')[0].strip()
                    elif '```' in json_str:
                        json_str = json_str.split('```')[1].split('```')[0].strip()
                    
                    parsed = output_format.model_validate_json(json_str)
                    
                    return ChatInvokeCompletion(
                        completion=parsed,
                        usage=usage,
                        stop_reason='stop',
                    )
                except Exception as parse_error:
                    raise ModelProviderError(
                        message=f"Failed to parse structured output: {str(parse_error)}. Raw response: {reply[:500]}",
                        model=self.name
                    ) from parse_error
                    
        except ModelRateLimitError:
            raise
        except ModelProviderError:
            raise
        except Exception as e:
            raise ModelProviderError(
                message=f"Unexpected error: {str(e)}",
                model=self.name
            ) from e
