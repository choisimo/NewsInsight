# Project Code Snapshot

Generated at 2025-12-21T10:30:23.526Z

---

## backend/browser-use/browser_use/integrations/gmail/actions.py

```py
"""
Gmail Actions for Browser Use
Defines agent actions for Gmail integration including 2FA code retrieval,
email reading, and authentication management.
"""

import logging

from pydantic import BaseModel, Field

from browser_use.agent.views import ActionResult
from browser_use.tools.service import Tools

from .service import GmailService

logger = logging.getLogger(__name__)

# Global Gmail service instance - initialized when actions are registered
_gmail_service: GmailService | None = None


class GetRecentEmailsParams(BaseModel):
	"""Parameters for getting recent emails"""

	keyword: str = Field(default='', description='A single keyword for search, e.g. github, airbnb, etc.')
	max_results: int = Field(default=3, ge=1, le=50, description='Maximum number of emails to retrieve (1-50, default: 3)')


def register_gmail_actions(tools: Tools, gmail_service: GmailService | None = None, access_token: str | None = None) -> Tools:
	"""
	Register Gmail actions with the provided tools
	Args:
	    tools: The browser-use tools to register actions with
	    gmail_service: Optional pre-configured Gmail service instance
	    access_token: Optional direct access token (alternative to file-based auth)
	"""
	global _gmail_service

	# Use provided service or create a new one with access token if provided
	if gmail_service:
		_gmail_service = gmail_service
	elif access_token:
		_gmail_service = GmailService(access_token=access_token)
	else:
		_gmail_service = GmailService()

	@tools.registry.action(
		description='Get recent emails from the mailbox with a keyword to retrieve verification codes, OTP, 2FA tokens, magic links, or any recent email content. Keep your query a single keyword.',
		param_model=GetRecentEmailsParams,
	)
	async def get_recent_emails(params: GetRecentEmailsParams) -> ActionResult:
		"""Get recent emails from the last 5 minutes with full content"""
		try:
			if _gmail_service is None:
				raise RuntimeError('Gmail service not initialized')

			# Ensure authentication
			if not _gmail_service.is_authenticated():
				logger.info('📧 Gmail not authenticated, attempting authentication...')
				authenticated = await _gmail_service.authenticate()
				if not authenticated:
					return ActionResult(
						extracted_content='Failed to authenticate with Gmail. Please ensure Gmail credentials are set up properly.',
						long_term_memory='Gmail authentication failed',
					)

			# Use specified max_results (1-50, default 10), last 5 minutes
			max_results = params.max_results
			time_filter = '5m'

			# Build query with time filter and optional user query
			query_parts = [f'newer_than:{time_filter}']
			if params.keyword.strip():
				query_parts.append(params.keyword.strip())

			query = ' '.join(query_parts)
			logger.info(f'🔍 Gmail search query: {query}')

			# Get emails
			emails = await _gmail_service.get_recent_emails(max_results=max_results, query=query, time_filter=time_filter)

			if not emails:
				query_info = f" matching '{params.keyword}'" if params.keyword.strip() else ''
				memory = f'No recent emails found from last {time_filter}{query_info}'
				return ActionResult(
					extracted_content=memory,
					long_term_memory=memory,
				)

			# Format with full email content for large display
			content = f'Found {len(emails)} recent email{"s" if len(emails) > 1 else ""} from the last {time_filter}:\n\n'

			for i, email in enumerate(emails, 1):
				content += f'Email {i}:\n'
				content += f'From: {email["from"]}\n'
				content += f'Subject: {email["subject"]}\n'
				content += f'Date: {email["date"]}\n'
				content += f'Content:\n{email["body"]}\n'
				content += '-' * 50 + '\n\n'

			logger.info(f'📧 Retrieved {len(emails)} recent emails')
			return ActionResult(
				extracted_content=content,
				include_extracted_content_only_once=True,
				long_term_memory=f'Retrieved {len(emails)} recent emails from last {time_filter} for query {query}.',
			)

		except Exception as e:
			logger.error(f'Error getting recent emails: {e}')
			return ActionResult(
				error=f'Error getting recent emails: {str(e)}',
				long_term_memory='Failed to get recent emails due to error',
			)

	return tools

```

---

## backend/browser-use/browser_use/integrations/gmail/service.py

```py
"""
Gmail API Service for Browser Use
Handles Gmail API authentication, email reading, and 2FA code extraction.
This service provides a clean interface for agents to interact with Gmail.
"""

import base64
import logging
import os
from pathlib import Path
from typing import Any

import anyio
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from browser_use.config import CONFIG

logger = logging.getLogger(__name__)


class GmailService:
	"""
	Gmail API service for email reading.
	Provides functionality to:
	- Authenticate with Gmail API using OAuth2
	- Read recent emails with filtering
	- Return full email content for agent analysis
	"""

	# Gmail API scopes
	SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

	def __init__(
		self,
		credentials_file: str | None = None,
		token_file: str | None = None,
		config_dir: str | None = None,
		access_token: str | None = None,
	):
		"""
		Initialize Gmail Service
		Args:
		    credentials_file: Path to OAuth credentials JSON from Google Cloud Console
		    token_file: Path to store/load access tokens
		    config_dir: Directory to store config files (defaults to browser-use config directory)
		    access_token: Direct access token (skips file-based auth if provided)
		"""
		# Set up configuration directory using browser-use's config system
		if config_dir is None:
			self.config_dir = CONFIG.BROWSER_USE_CONFIG_DIR
		else:
			self.config_dir = Path(config_dir).expanduser().resolve()

		# Ensure config directory exists (only if not using direct token)
		if access_token is None:
			self.config_dir.mkdir(parents=True, exist_ok=True)

		# Set up credential paths
		self.credentials_file = credentials_file or self.config_dir / 'gmail_credentials.json'
		self.token_file = token_file or self.config_dir / 'gmail_token.json'

		# Direct access token support
		self.access_token = access_token

		self.service = None
		self.creds = None
		self._authenticated = False

	def is_authenticated(self) -> bool:
		"""Check if Gmail service is authenticated"""
		return self._authenticated and self.service is not None

	async def authenticate(self) -> bool:
		"""
		Handle OAuth authentication and token management
		Returns:
		    bool: True if authentication successful, False otherwise
		"""
		try:
			logger.info('🔐 Authenticating with Gmail API...')

			# Check if using direct access token
			if self.access_token:
				logger.info('🔑 Using provided access token')
				# Create credentials from access token
				self.creds = Credentials(token=self.access_token, scopes=self.SCOPES)
				# Test token validity by building service
				self.service = build('gmail', 'v1', credentials=self.creds)
				self._authenticated = True
				logger.info('✅ Gmail API ready with access token!')
				return True

			# Original file-based authentication flow
			# Try to load existing tokens
			if os.path.exists(self.token_file):
				self.creds = Credentials.from_authorized_user_file(str(self.token_file), self.SCOPES)
				logger.debug('📁 Loaded existing tokens')

			# If no valid credentials, run OAuth flow
			if not self.creds or not self.creds.valid:
				if self.creds and self.creds.expired and self.creds.refresh_token:
					logger.info('🔄 Refreshing expired tokens...')
					self.creds.refresh(Request())
				else:
					logger.info('🌐 Starting OAuth flow...')
					if not os.path.exists(self.credentials_file):
						logger.error(
							f'❌ Gmail credentials file not found: {self.credentials_file}\n'
							'Please download it from Google Cloud Console:\n'
							'1. Go to https://console.cloud.google.com/\n'
							'2. APIs & Services > Credentials\n'
							'3. Download OAuth 2.0 Client JSON\n'
							f"4. Save as 'gmail_credentials.json' in {self.config_dir}/"
						)
						return False

					flow = InstalledAppFlow.from_client_secrets_file(str(self.credentials_file), self.SCOPES)
					# Use specific redirect URI to match OAuth credentials
					self.creds = flow.run_local_server(port=8080, open_browser=True)

				# Save tokens for next time
				await anyio.Path(self.token_file).write_text(self.creds.to_json())
				logger.info(f'💾 Tokens saved to {self.token_file}')

			# Build Gmail service
			self.service = build('gmail', 'v1', credentials=self.creds)
			self._authenticated = True
			logger.info('✅ Gmail API ready!')
			return True

		except Exception as e:
			logger.error(f'❌ Gmail authentication failed: {e}')
			return False

	async def get_recent_emails(self, max_results: int = 10, query: str = '', time_filter: str = '1h') -> list[dict[str, Any]]:
		"""
		Get recent emails with optional query filter
		Args:
		    max_results: Maximum number of emails to fetch
		    query: Gmail search query (e.g., 'from:noreply@example.com')
		    time_filter: Time filter (e.g., '5m', '1h', '1d')
		Returns:
		    List of email dictionaries with parsed content
		"""
		if not self.is_authenticated():
			logger.error('❌ Gmail service not authenticated. Call authenticate() first.')
			return []

		try:
			# Add time filter to query if provided
			if time_filter and 'newer_than:' not in query:
				query = f'newer_than:{time_filter} {query}'.strip()

			logger.info(f'📧 Fetching {max_results} recent emails...')
			if query:
				logger.debug(f'🔍 Query: {query}')

			# Get message list
			assert self.service is not None
			results = self.service.users().messages().list(userId='me', maxResults=max_results, q=query).execute()

			messages = results.get('messages', [])
			if not messages:
				logger.info('📭 No messages found')
				return []

			logger.info(f'📨 Found {len(messages)} messages, fetching details...')

			# Get full message details
			emails = []
			for i, message in enumerate(messages, 1):
				logger.debug(f'📖 Reading email {i}/{len(messages)}...')

				full_message = self.service.users().messages().get(userId='me', id=message['id'], format='full').execute()

				email_data = self._parse_email(full_message)
				emails.append(email_data)

			return emails

		except HttpError as error:
			logger.error(f'❌ Gmail API error: {error}')
			return []
		except Exception as e:
			logger.error(f'❌ Unexpected error fetching emails: {e}')
			return []

	def _parse_email(self, message: dict[str, Any]) -> dict[str, Any]:
		"""Parse Gmail message into readable format"""
		headers = {h['name']: h['value'] for h in message['payload']['headers']}

		return {
			'id': message['id'],
			'thread_id': message['threadId'],
			'subject': headers.get('Subject', ''),
			'from': headers.get('From', ''),
			'to': headers.get('To', ''),
			'date': headers.get('Date', ''),
			'timestamp': int(message['internalDate']),
			'body': self._extract_body(message['payload']),
			'raw_message': message,
		}

	def _extract_body(self, payload: dict[str, Any]) -> str:
		"""Extract email body from payload"""
		body = ''

		if payload.get('body', {}).get('data'):
			# Simple email body
			body = base64.urlsafe_b64decode(payload['body']['data']).decode('utf-8')
		elif payload.get('parts'):
			# Multi-part email
			for part in payload['parts']:
				if part['mimeType'] == 'text/plain' and part.get('body', {}).get('data'):
					part_body = base64.urlsafe_b64decode(part['body']['data']).decode('utf-8')
					body += part_body
				elif part['mimeType'] == 'text/html' and not body and part.get('body', {}).get('data'):
					# Fallback to HTML if no plain text
					body = base64.urlsafe_b64decode(part['body']['data']).decode('utf-8')

		return body

```

---

## backend/browser-use/browser_use/llm/__init__.py

```py
"""
We have switched all of our code from langchain to openai.types.chat.chat_completion_message_param.

For easier transition we have
"""

from typing import TYPE_CHECKING

# Lightweight imports that are commonly used
from browser_use.llm.base import BaseChatModel
from browser_use.llm.messages import (
	AssistantMessage,
	BaseMessage,
	SystemMessage,
	UserMessage,
)
from browser_use.llm.messages import (
	ContentPartImageParam as ContentImage,
)
from browser_use.llm.messages import (
	ContentPartRefusalParam as ContentRefusal,
)
from browser_use.llm.messages import (
	ContentPartTextParam as ContentText,
)

# Type stubs for lazy imports
if TYPE_CHECKING:
	from browser_use.llm.anthropic.chat import ChatAnthropic
	from browser_use.llm.aws.chat_anthropic import ChatAnthropicBedrock
	from browser_use.llm.aws.chat_bedrock import ChatAWSBedrock
	from browser_use.llm.azure.chat import ChatAzureOpenAI
	from browser_use.llm.browser_use.chat import ChatBrowserUse
	from browser_use.llm.cerebras.chat import ChatCerebras
	from browser_use.llm.deepseek.chat import ChatDeepSeek
	from browser_use.llm.google.chat import ChatGoogle
	from browser_use.llm.groq.chat import ChatGroq
	from browser_use.llm.oci_raw.chat import ChatOCIRaw
	from browser_use.llm.ollama.chat import ChatOllama
	from browser_use.llm.openai.chat import ChatOpenAI
	from browser_use.llm.openrouter.chat import ChatOpenRouter
	from browser_use.llm.vercel.chat import ChatVercel

	# Type stubs for model instances - enables IDE autocomplete
	openai_gpt_4o: ChatOpenAI
	openai_gpt_4o_mini: ChatOpenAI
	openai_gpt_4_1_mini: ChatOpenAI
	openai_o1: ChatOpenAI
	openai_o1_mini: ChatOpenAI
	openai_o1_pro: ChatOpenAI
	openai_o3: ChatOpenAI
	openai_o3_mini: ChatOpenAI
	openai_o3_pro: ChatOpenAI
	openai_o4_mini: ChatOpenAI
	openai_gpt_5: ChatOpenAI
	openai_gpt_5_mini: ChatOpenAI
	openai_gpt_5_nano: ChatOpenAI

	azure_gpt_4o: ChatAzureOpenAI
	azure_gpt_4o_mini: ChatAzureOpenAI
	azure_gpt_4_1_mini: ChatAzureOpenAI
	azure_o1: ChatAzureOpenAI
	azure_o1_mini: ChatAzureOpenAI
	azure_o1_pro: ChatAzureOpenAI
	azure_o3: ChatAzureOpenAI
	azure_o3_mini: ChatAzureOpenAI
	azure_o3_pro: ChatAzureOpenAI
	azure_gpt_5: ChatAzureOpenAI
	azure_gpt_5_mini: ChatAzureOpenAI

	google_gemini_2_0_flash: ChatGoogle
	google_gemini_2_0_pro: ChatGoogle
	google_gemini_2_5_pro: ChatGoogle
	google_gemini_2_5_flash: ChatGoogle
	google_gemini_2_5_flash_lite: ChatGoogle

# Models are imported on-demand via __getattr__

# Lazy imports mapping for heavy chat models
_LAZY_IMPORTS = {
	'ChatAnthropic': ('browser_use.llm.anthropic.chat', 'ChatAnthropic'),
	'ChatAnthropicBedrock': ('browser_use.llm.aws.chat_anthropic', 'ChatAnthropicBedrock'),
	'ChatAWSBedrock': ('browser_use.llm.aws.chat_bedrock', 'ChatAWSBedrock'),
	'ChatAzureOpenAI': ('browser_use.llm.azure.chat', 'ChatAzureOpenAI'),
	'ChatBrowserUse': ('browser_use.llm.browser_use.chat', 'ChatBrowserUse'),
	'ChatCerebras': ('browser_use.llm.cerebras.chat', 'ChatCerebras'),
	'ChatDeepSeek': ('browser_use.llm.deepseek.chat', 'ChatDeepSeek'),
	'ChatGoogle': ('browser_use.llm.google.chat', 'ChatGoogle'),
	'ChatGroq': ('browser_use.llm.groq.chat', 'ChatGroq'),
	'ChatOCIRaw': ('browser_use.llm.oci_raw.chat', 'ChatOCIRaw'),
	'ChatOllama': ('browser_use.llm.ollama.chat', 'ChatOllama'),
	'ChatOpenAI': ('browser_use.llm.openai.chat', 'ChatOpenAI'),
	'ChatOpenRouter': ('browser_use.llm.openrouter.chat', 'ChatOpenRouter'),
	'ChatVercel': ('browser_use.llm.vercel.chat', 'ChatVercel'),
}

# Cache for model instances - only created when accessed
_model_cache: dict[str, 'BaseChatModel'] = {}


def __getattr__(name: str):
	"""Lazy import mechanism for heavy chat model imports and model instances."""
	if name in _LAZY_IMPORTS:
		module_path, attr_name = _LAZY_IMPORTS[name]
		try:
			from importlib import import_module

			module = import_module(module_path)
			attr = getattr(module, attr_name)
			return attr
		except ImportError as e:
			raise ImportError(f'Failed to import {name} from {module_path}: {e}') from e

	# Check cache first for model instances
	if name in _model_cache:
		return _model_cache[name]

	# Try to get model instances from models module on-demand
	try:
		from browser_use.llm.models import __getattr__ as models_getattr

		attr = models_getattr(name)
		# Cache in our clean cache dict
		_model_cache[name] = attr
		return attr
	except (AttributeError, ImportError):
		pass

	raise AttributeError(f"module '{__name__}' has no attribute '{name}'")


__all__ = [
	# Message types -> for easier transition from langchain
	'BaseMessage',
	'UserMessage',
	'SystemMessage',
	'AssistantMessage',
	# Content parts with better names
	'ContentText',
	'ContentRefusal',
	'ContentImage',
	# Chat models
	'BaseChatModel',
	'ChatOpenAI',
	'ChatBrowserUse',
	'ChatDeepSeek',
	'ChatGoogle',
	'ChatAnthropic',
	'ChatAnthropicBedrock',
	'ChatAWSBedrock',
	'ChatGroq',
	'ChatAzureOpenAI',
	'ChatOCIRaw',
	'ChatOllama',
	'ChatOpenRouter',
	'ChatVercel',
	'ChatCerebras',
]

```

---

## backend/browser-use/browser_use/llm/aidove/__init__.py

```py
"""AI Dove LLM provider for browser-use."""

from browser_use.llm.aidove.chat import ChatAIDove

__all__ = ['ChatAIDove']

```

---

## backend/browser-use/browser_use/llm/aidove/chat.py

```py
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
                prompt += f"\n\n[Output Format]\nYou MUST respond with valid JSON that matches this schema:\n``\`json\n{json.dumps(schema, indent=2)}\n``\`\n\nRespond ONLY with the JSON object, no other text."
            
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
                    if '``\`json' in json_str:
                        json_str = json_str.split('``\`json')[1].split('``\`')[0].strip()
                    elif '``\`' in json_str:
                        json_str = json_str.split('``\`')[1].split('``\`')[0].strip()
                    
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

```

---

## backend/browser-use/browser_use/llm/anthropic/chat.py

```py
import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, TypeVar, overload

import httpx
from anthropic import (
	APIConnectionError,
	APIStatusError,
	AsyncAnthropic,
	NotGiven,
	RateLimitError,
	omit,
)
from anthropic.types import CacheControlEphemeralParam, Message, ToolParam
from anthropic.types.model_param import ModelParam
from anthropic.types.text_block import TextBlock
from anthropic.types.tool_choice_tool_param import ToolChoiceToolParam
from httpx import Timeout
from pydantic import BaseModel

from browser_use.llm.anthropic.serializer import AnthropicMessageSerializer
from browser_use.llm.base import BaseChatModel
from browser_use.llm.exceptions import ModelProviderError, ModelRateLimitError
from browser_use.llm.messages import BaseMessage
from browser_use.llm.schema import SchemaOptimizer
from browser_use.llm.views import ChatInvokeCompletion, ChatInvokeUsage

T = TypeVar('T', bound=BaseModel)


@dataclass
class ChatAnthropic(BaseChatModel):
	"""
	A wrapper around Anthropic's chat model.
	"""

	# Model configuration
	model: str | ModelParam
	max_tokens: int = 8192
	temperature: float | None = None
	top_p: float | None = None
	seed: int | None = None

	# Client initialization parameters
	api_key: str | None = None
	auth_token: str | None = None
	base_url: str | httpx.URL | None = None
	timeout: float | Timeout | None | NotGiven = NotGiven()
	max_retries: int = 10
	default_headers: Mapping[str, str] | None = None
	default_query: Mapping[str, object] | None = None
	http_client: httpx.AsyncClient | None = None

	# Static
	@property
	def provider(self) -> str:
		return 'anthropic'

	def _get_client_params(self) -> dict[str, Any]:
		"""Prepare client parameters dictionary."""
		# Define base client params
		base_params = {
			'api_key': self.api_key,
			'auth_token': self.auth_token,
			'base_url': self.base_url,
			'timeout': self.timeout,
			'max_retries': self.max_retries,
			'default_headers': self.default_headers,
			'default_query': self.default_query,
			'http_client': self.http_client,
		}

		# Create client_params dict with non-None values and non-NotGiven values
		client_params = {}
		for k, v in base_params.items():
			if v is not None and v is not NotGiven():
				client_params[k] = v

		return client_params

	def _get_client_params_for_invoke(self):
		"""Prepare client parameters dictionary for invoke."""

		client_params = {}

		if self.temperature is not None:
			client_params['temperature'] = self.temperature

		if self.max_tokens is not None:
			client_params['max_tokens'] = self.max_tokens

		if self.top_p is not None:
			client_params['top_p'] = self.top_p

		if self.seed is not None:
			client_params['seed'] = self.seed

		return client_params

	def get_client(self) -> AsyncAnthropic:
		"""
		Returns an AsyncAnthropic client.

		Returns:
			AsyncAnthropic: An instance of the AsyncAnthropic client.
		"""
		client_params = self._get_client_params()
		return AsyncAnthropic(**client_params)

	@property
	def name(self) -> str:
		return str(self.model)

	def _get_usage(self, response: Message) -> ChatInvokeUsage | None:
		usage = ChatInvokeUsage(
			prompt_tokens=response.usage.input_tokens
			+ (
				response.usage.cache_read_input_tokens or 0
			),  # Total tokens in Anthropic are a bit fucked, you have to add cached tokens to the prompt tokens
			completion_tokens=response.usage.output_tokens,
			total_tokens=response.usage.input_tokens + response.usage.output_tokens,
			prompt_cached_tokens=response.usage.cache_read_input_tokens,
			prompt_cache_creation_tokens=response.usage.cache_creation_input_tokens,
			prompt_image_tokens=None,
		)
		return usage

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: None = None) -> ChatInvokeCompletion[str]: ...

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: type[T]) -> ChatInvokeCompletion[T]: ...

	async def ainvoke(
		self, messages: list[BaseMessage], output_format: type[T] | None = None
	) -> ChatInvokeCompletion[T] | ChatInvokeCompletion[str]:
		anthropic_messages, system_prompt = AnthropicMessageSerializer.serialize_messages(messages)

		try:
			if output_format is None:
				# Normal completion without structured output
				response = await self.get_client().messages.create(
					model=self.model,
					messages=anthropic_messages,
					system=system_prompt or omit,
					**self._get_client_params_for_invoke(),
				)

				# Ensure we have a valid Message object before accessing attributes
				if not isinstance(response, Message):
					raise ModelProviderError(
						message=f'Unexpected response type from Anthropic API: {type(response).__name__}. Response: {str(response)[:200]}',
						status_code=502,
						model=self.name,
					)

				usage = self._get_usage(response)

				# Extract text from the first content block
				first_content = response.content[0]
				if isinstance(first_content, TextBlock):
					response_text = first_content.text
				else:
					# If it's not a text block, convert to string
					response_text = str(first_content)

				return ChatInvokeCompletion(
					completion=response_text,
					usage=usage,
					stop_reason=response.stop_reason,
				)

			else:
				# Use tool calling for structured output
				# Create a tool that represents the output format
				tool_name = output_format.__name__
				schema = SchemaOptimizer.create_optimized_json_schema(output_format)

				# Remove title from schema if present (Anthropic doesn't like it in parameters)
				if 'title' in schema:
					del schema['title']

				tool = ToolParam(
					name=tool_name,
					description=f'Extract information in the format of {tool_name}',
					input_schema=schema,
					cache_control=CacheControlEphemeralParam(type='ephemeral'),
				)

				# Force the model to use this tool
				tool_choice = ToolChoiceToolParam(type='tool', name=tool_name)

				response = await self.get_client().messages.create(
					model=self.model,
					messages=anthropic_messages,
					tools=[tool],
					system=system_prompt or omit,
					tool_choice=tool_choice,
					**self._get_client_params_for_invoke(),
				)

				# Ensure we have a valid Message object before accessing attributes
				if not isinstance(response, Message):
					raise ModelProviderError(
						message=f'Unexpected response type from Anthropic API: {type(response).__name__}. Response: {str(response)[:200]}',
						status_code=502,
						model=self.name,
					)

				usage = self._get_usage(response)

				# Extract the tool use block
				for content_block in response.content:
					if hasattr(content_block, 'type') and content_block.type == 'tool_use':
						# Parse the tool input as the structured output
						try:
							return ChatInvokeCompletion(
								completion=output_format.model_validate(content_block.input),
								usage=usage,
								stop_reason=response.stop_reason,
							)
						except Exception as e:
							# If validation fails, try to parse it as JSON first
							if isinstance(content_block.input, str):
								data = json.loads(content_block.input)
								return ChatInvokeCompletion(
									completion=output_format.model_validate(data),
									usage=usage,
									stop_reason=response.stop_reason,
								)
							raise e

				# If no tool use block found, raise an error
				raise ValueError('Expected tool use in response but none found')

		except APIConnectionError as e:
			raise ModelProviderError(message=e.message, model=self.name) from e
		except RateLimitError as e:
			raise ModelRateLimitError(message=e.message, model=self.name) from e
		except APIStatusError as e:
			raise ModelProviderError(message=e.message, status_code=e.status_code, model=self.name) from e
		except Exception as e:
			raise ModelProviderError(message=str(e), model=self.name) from e

```

---

## backend/browser-use/browser_use/llm/anthropic/serializer.py

```py
import json
from typing import overload

from anthropic.types import (
	Base64ImageSourceParam,
	CacheControlEphemeralParam,
	ImageBlockParam,
	MessageParam,
	TextBlockParam,
	ToolUseBlockParam,
	URLImageSourceParam,
)

from browser_use.llm.messages import (
	AssistantMessage,
	BaseMessage,
	ContentPartImageParam,
	ContentPartTextParam,
	SupportedImageMediaType,
	SystemMessage,
	UserMessage,
)

NonSystemMessage = UserMessage | AssistantMessage


class AnthropicMessageSerializer:
	"""Serializer for converting between custom message types and Anthropic message param types."""

	@staticmethod
	def _is_base64_image(url: str) -> bool:
		"""Check if the URL is a base64 encoded image."""
		return url.startswith('data:image/')

	@staticmethod
	def _parse_base64_url(url: str) -> tuple[SupportedImageMediaType, str]:
		"""Parse a base64 data URL to extract media type and data."""
		# Format: data:image/jpeg;base64,<data>
		if not url.startswith('data:'):
			raise ValueError(f'Invalid base64 URL: {url}')

		header, data = url.split(',', 1)
		media_type = header.split(';')[0].replace('data:', '')

		# Ensure it's a supported media type
		supported_types = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
		if media_type not in supported_types:
			# Default to jpeg if not recognized
			media_type = 'image/jpeg'

		return media_type, data  # type: ignore

	@staticmethod
	def _serialize_cache_control(use_cache: bool) -> CacheControlEphemeralParam | None:
		"""Serialize cache control."""
		if use_cache:
			return CacheControlEphemeralParam(type='ephemeral')
		return None

	@staticmethod
	def _serialize_content_part_text(part: ContentPartTextParam, use_cache: bool) -> TextBlockParam:
		"""Convert a text content part to Anthropic's TextBlockParam."""
		return TextBlockParam(
			text=part.text, type='text', cache_control=AnthropicMessageSerializer._serialize_cache_control(use_cache)
		)

	@staticmethod
	def _serialize_content_part_image(part: ContentPartImageParam) -> ImageBlockParam:
		"""Convert an image content part to Anthropic's ImageBlockParam."""
		url = part.image_url.url

		if AnthropicMessageSerializer._is_base64_image(url):
			# Handle base64 encoded images
			media_type, data = AnthropicMessageSerializer._parse_base64_url(url)
			return ImageBlockParam(
				source=Base64ImageSourceParam(
					data=data,
					media_type=media_type,
					type='base64',
				),
				type='image',
			)
		else:
			# Handle URL images
			return ImageBlockParam(source=URLImageSourceParam(url=url, type='url'), type='image')

	@staticmethod
	def _serialize_content_to_str(
		content: str | list[ContentPartTextParam], use_cache: bool = False
	) -> list[TextBlockParam] | str:
		"""Serialize content to a string."""
		cache_control = AnthropicMessageSerializer._serialize_cache_control(use_cache)

		if isinstance(content, str):
			if cache_control:
				return [TextBlockParam(text=content, type='text', cache_control=cache_control)]
			else:
				return content

		serialized_blocks: list[TextBlockParam] = []
		for i, part in enumerate(content):
			is_last = i == len(content) - 1
			if part.type == 'text':
				serialized_blocks.append(
					AnthropicMessageSerializer._serialize_content_part_text(part, use_cache=use_cache and is_last)
				)

		return serialized_blocks

	@staticmethod
	def _serialize_content(
		content: str | list[ContentPartTextParam | ContentPartImageParam],
		use_cache: bool = False,
	) -> str | list[TextBlockParam | ImageBlockParam]:
		"""Serialize content to Anthropic format."""
		if isinstance(content, str):
			if use_cache:
				return [TextBlockParam(text=content, type='text', cache_control=CacheControlEphemeralParam(type='ephemeral'))]
			else:
				return content

		serialized_blocks: list[TextBlockParam | ImageBlockParam] = []
		for i, part in enumerate(content):
			is_last = i == len(content) - 1
			if part.type == 'text':
				serialized_blocks.append(
					AnthropicMessageSerializer._serialize_content_part_text(part, use_cache=use_cache and is_last)
				)
			elif part.type == 'image_url':
				serialized_blocks.append(AnthropicMessageSerializer._serialize_content_part_image(part))

		return serialized_blocks

	@staticmethod
	def _serialize_tool_calls_to_content(tool_calls, use_cache: bool = False) -> list[ToolUseBlockParam]:
		"""Convert tool calls to Anthropic's ToolUseBlockParam format."""
		blocks: list[ToolUseBlockParam] = []
		for i, tool_call in enumerate(tool_calls):
			# Parse the arguments JSON string to object

			try:
				input_obj = json.loads(tool_call.function.arguments)
			except json.JSONDecodeError:
				# If arguments aren't valid JSON, use as string
				input_obj = {'arguments': tool_call.function.arguments}

			is_last = i == len(tool_calls) - 1
			blocks.append(
				ToolUseBlockParam(
					id=tool_call.id,
					input=input_obj,
					name=tool_call.function.name,
					type='tool_use',
					cache_control=AnthropicMessageSerializer._serialize_cache_control(use_cache and is_last),
				)
			)
		return blocks

	# region - Serialize overloads
	@overload
	@staticmethod
	def serialize(message: UserMessage) -> MessageParam: ...

	@overload
	@staticmethod
	def serialize(message: SystemMessage) -> SystemMessage: ...

	@overload
	@staticmethod
	def serialize(message: AssistantMessage) -> MessageParam: ...

	@staticmethod
	def serialize(message: BaseMessage) -> MessageParam | SystemMessage:
		"""Serialize a custom message to an Anthropic MessageParam.

		Note: Anthropic doesn't have a 'system' role. System messages should be
		handled separately as the system parameter in the API call, not as a message.
		If a SystemMessage is passed here, it will be converted to a user message.
		"""
		if isinstance(message, UserMessage):
			content = AnthropicMessageSerializer._serialize_content(message.content, use_cache=message.cache)
			return MessageParam(role='user', content=content)

		elif isinstance(message, SystemMessage):
			# Anthropic doesn't have system messages in the messages array
			# System prompts are passed separately. Convert to user message.
			return message

		elif isinstance(message, AssistantMessage):
			# Handle content and tool calls
			blocks: list[TextBlockParam | ToolUseBlockParam] = []

			# Add content blocks if present
			if message.content is not None:
				if isinstance(message.content, str):
					# String content: only cache if it's the only/last block (no tool calls)
					blocks.append(
						TextBlockParam(
							text=message.content,
							type='text',
							cache_control=AnthropicMessageSerializer._serialize_cache_control(
								message.cache and not message.tool_calls
							),
						)
					)
				else:
					# Process content parts (text and refusal)
					for i, part in enumerate(message.content):
						# Only last content block gets cache if there are no tool calls
						is_last_content = (i == len(message.content) - 1) and not message.tool_calls
						if part.type == 'text':
							blocks.append(
								AnthropicMessageSerializer._serialize_content_part_text(
									part, use_cache=message.cache and is_last_content
								)
							)
							# # Note: Anthropic doesn't have a specific refusal block type,
							# # so we convert refusals to text blocks
							# elif part.type == 'refusal':
							# 	blocks.append(TextBlockParam(text=f'[Refusal] {part.refusal}', type='text'))

			# Add tool use blocks if present
			if message.tool_calls:
				tool_blocks = AnthropicMessageSerializer._serialize_tool_calls_to_content(
					message.tool_calls, use_cache=message.cache
				)
				blocks.extend(tool_blocks)

			# If no content or tool calls, add empty text block
			# (Anthropic requires at least one content block)
			if not blocks:
				blocks.append(
					TextBlockParam(
						text='', type='text', cache_control=AnthropicMessageSerializer._serialize_cache_control(message.cache)
					)
				)

			# If caching is enabled or we have multiple blocks, return blocks as-is
			# Otherwise, simplify single text blocks to plain string
			if message.cache or len(blocks) > 1:
				content = blocks
			else:
				# Only simplify when no caching and single block
				single_block = blocks[0]
				if single_block['type'] == 'text' and not single_block.get('cache_control'):
					content = single_block['text']
				else:
					content = blocks

			return MessageParam(
				role='assistant',
				content=content,
			)

		else:
			raise ValueError(f'Unknown message type: {type(message)}')

	@staticmethod
	def _clean_cache_messages(messages: list[NonSystemMessage]) -> list[NonSystemMessage]:
		"""Clean cache settings so only the last cache=True message remains cached.

		Because of how Claude caching works, only the last cache message matters.
		This method automatically removes cache=True from all messages except the last one.

		Args:
			messages: List of non-system messages to clean

		Returns:
			List of messages with cleaned cache settings
		"""
		if not messages:
			return messages

		# Create a copy to avoid modifying the original
		cleaned_messages = [msg.model_copy(deep=True) for msg in messages]

		# Find the last message with cache=True
		last_cache_index = -1
		for i in range(len(cleaned_messages) - 1, -1, -1):
			if cleaned_messages[i].cache:
				last_cache_index = i
				break

		# If we found a cached message, disable cache for all others
		if last_cache_index != -1:
			for i, msg in enumerate(cleaned_messages):
				if i != last_cache_index and msg.cache:
					# Set cache to False for all messages except the last cached one
					msg.cache = False

		return cleaned_messages

	@staticmethod
	def serialize_messages(messages: list[BaseMessage]) -> tuple[list[MessageParam], list[TextBlockParam] | str | None]:
		"""Serialize a list of messages, extracting any system message.

		Returns:
		    A tuple of (messages, system_message) where system_message is extracted
		    from any SystemMessage in the list.
		"""
		messages = [m.model_copy(deep=True) for m in messages]

		# Separate system messages from normal messages
		normal_messages: list[NonSystemMessage] = []
		system_message: SystemMessage | None = None

		for message in messages:
			if isinstance(message, SystemMessage):
				system_message = message
			else:
				normal_messages.append(message)

		# Clean cache messages so only the last cache=True message remains cached
		normal_messages = AnthropicMessageSerializer._clean_cache_messages(normal_messages)

		# Serialize normal messages
		serialized_messages: list[MessageParam] = []
		for message in normal_messages:
			serialized_messages.append(AnthropicMessageSerializer.serialize(message))

		# Serialize system message
		serialized_system_message: list[TextBlockParam] | str | None = None
		if system_message:
			serialized_system_message = AnthropicMessageSerializer._serialize_content_to_str(
				system_message.content, use_cache=system_message.cache
			)

		return serialized_messages, serialized_system_message

```

---

## backend/browser-use/browser_use/llm/aws/__init__.py

```py
from typing import TYPE_CHECKING

# Type stubs for lazy imports
if TYPE_CHECKING:
	from browser_use.llm.aws.chat_anthropic import ChatAnthropicBedrock
	from browser_use.llm.aws.chat_bedrock import ChatAWSBedrock

# Lazy imports mapping for AWS chat models
_LAZY_IMPORTS = {
	'ChatAnthropicBedrock': ('browser_use.llm.aws.chat_anthropic', 'ChatAnthropicBedrock'),
	'ChatAWSBedrock': ('browser_use.llm.aws.chat_bedrock', 'ChatAWSBedrock'),
}


def __getattr__(name: str):
	"""Lazy import mechanism for AWS chat models."""
	if name in _LAZY_IMPORTS:
		module_path, attr_name = _LAZY_IMPORTS[name]
		try:
			from importlib import import_module

			module = import_module(module_path)
			attr = getattr(module, attr_name)
			# Cache the imported attribute in the module's globals
			globals()[name] = attr
			return attr
		except ImportError as e:
			raise ImportError(f'Failed to import {name} from {module_path}: {e}') from e

	raise AttributeError(f"module '{__name__}' has no attribute '{name}'")


__all__ = [
	'ChatAWSBedrock',
	'ChatAnthropicBedrock',
]

```

---

## backend/browser-use/browser_use/llm/aws/chat_anthropic.py

```py
import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, TypeVar, overload

from anthropic import (
	APIConnectionError,
	APIStatusError,
	AsyncAnthropicBedrock,
	RateLimitError,
	omit,
)
from anthropic.types import CacheControlEphemeralParam, Message, ToolParam
from anthropic.types.text_block import TextBlock
from anthropic.types.tool_choice_tool_param import ToolChoiceToolParam
from pydantic import BaseModel

from browser_use.llm.anthropic.serializer import AnthropicMessageSerializer
from browser_use.llm.aws.chat_bedrock import ChatAWSBedrock
from browser_use.llm.exceptions import ModelProviderError, ModelRateLimitError
from browser_use.llm.messages import BaseMessage
from browser_use.llm.views import ChatInvokeCompletion, ChatInvokeUsage

if TYPE_CHECKING:
	from boto3.session import Session  # pyright: ignore


T = TypeVar('T', bound=BaseModel)


@dataclass
class ChatAnthropicBedrock(ChatAWSBedrock):
	"""
	AWS Bedrock Anthropic Claude chat model.

	This is a convenience class that provides Claude-specific defaults
	for the AWS Bedrock service. It inherits all functionality from
	ChatAWSBedrock but sets Anthropic Claude as the default model.
	"""

	# Anthropic Claude specific defaults
	model: str = 'anthropic.claude-3-5-sonnet-20240620-v1:0'
	max_tokens: int = 8192
	temperature: float | None = None
	top_p: float | None = None
	top_k: int | None = None
	stop_sequences: list[str] | None = None
	seed: int | None = None

	# AWS credentials and configuration
	aws_access_key: str | None = None
	aws_secret_key: str | None = None
	aws_session_token: str | None = None
	aws_region: str | None = None
	session: 'Session | None' = None

	# Client initialization parameters
	max_retries: int = 10
	default_headers: Mapping[str, str] | None = None
	default_query: Mapping[str, object] | None = None

	@property
	def provider(self) -> str:
		return 'anthropic_bedrock'

	def _get_client_params(self) -> dict[str, Any]:
		"""Prepare client parameters dictionary for Bedrock."""
		client_params: dict[str, Any] = {}

		if self.session:
			credentials = self.session.get_credentials()
			client_params.update(
				{
					'aws_access_key': credentials.access_key,
					'aws_secret_key': credentials.secret_key,
					'aws_session_token': credentials.token,
					'aws_region': self.session.region_name,
				}
			)
		else:
			# Use individual credentials
			if self.aws_access_key:
				client_params['aws_access_key'] = self.aws_access_key
			if self.aws_secret_key:
				client_params['aws_secret_key'] = self.aws_secret_key
			if self.aws_region:
				client_params['aws_region'] = self.aws_region
			if self.aws_session_token:
				client_params['aws_session_token'] = self.aws_session_token

		# Add optional parameters
		if self.max_retries:
			client_params['max_retries'] = self.max_retries
		if self.default_headers:
			client_params['default_headers'] = self.default_headers
		if self.default_query:
			client_params['default_query'] = self.default_query

		return client_params

	def _get_client_params_for_invoke(self) -> dict[str, Any]:
		"""Prepare client parameters dictionary for invoke."""
		client_params = {}

		if self.temperature is not None:
			client_params['temperature'] = self.temperature
		if self.max_tokens is not None:
			client_params['max_tokens'] = self.max_tokens
		if self.top_p is not None:
			client_params['top_p'] = self.top_p
		if self.top_k is not None:
			client_params['top_k'] = self.top_k
		if self.seed is not None:
			client_params['seed'] = self.seed
		if self.stop_sequences is not None:
			client_params['stop_sequences'] = self.stop_sequences

		return client_params

	def get_client(self) -> AsyncAnthropicBedrock:
		"""
		Returns an AsyncAnthropicBedrock client.

		Returns:
			AsyncAnthropicBedrock: An instance of the AsyncAnthropicBedrock client.
		"""
		client_params = self._get_client_params()
		return AsyncAnthropicBedrock(**client_params)

	@property
	def name(self) -> str:
		return str(self.model)

	def _get_usage(self, response: Message) -> ChatInvokeUsage | None:
		"""Extract usage information from the response."""
		usage = ChatInvokeUsage(
			prompt_tokens=response.usage.input_tokens
			+ (
				response.usage.cache_read_input_tokens or 0
			),  # Total tokens in Anthropic are a bit fucked, you have to add cached tokens to the prompt tokens
			completion_tokens=response.usage.output_tokens,
			total_tokens=response.usage.input_tokens + response.usage.output_tokens,
			prompt_cached_tokens=response.usage.cache_read_input_tokens,
			prompt_cache_creation_tokens=response.usage.cache_creation_input_tokens,
			prompt_image_tokens=None,
		)
		return usage

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: None = None) -> ChatInvokeCompletion[str]: ...

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: type[T]) -> ChatInvokeCompletion[T]: ...

	async def ainvoke(
		self, messages: list[BaseMessage], output_format: type[T] | None = None
	) -> ChatInvokeCompletion[T] | ChatInvokeCompletion[str]:
		anthropic_messages, system_prompt = AnthropicMessageSerializer.serialize_messages(messages)

		try:
			if output_format is None:
				# Normal completion without structured output
				response = await self.get_client().messages.create(
					model=self.model,
					messages=anthropic_messages,
					system=system_prompt or omit,
					**self._get_client_params_for_invoke(),
				)

				usage = self._get_usage(response)

				# Extract text from the first content block
				first_content = response.content[0]
				if isinstance(first_content, TextBlock):
					response_text = first_content.text
				else:
					# If it's not a text block, convert to string
					response_text = str(first_content)

				return ChatInvokeCompletion(
					completion=response_text,
					usage=usage,
				)

			else:
				# Use tool calling for structured output
				# Create a tool that represents the output format
				tool_name = output_format.__name__
				schema = output_format.model_json_schema()

				# Remove title from schema if present (Anthropic doesn't like it in parameters)
				if 'title' in schema:
					del schema['title']

				tool = ToolParam(
					name=tool_name,
					description=f'Extract information in the format of {tool_name}',
					input_schema=schema,
					cache_control=CacheControlEphemeralParam(type='ephemeral'),
				)

				# Force the model to use this tool
				tool_choice = ToolChoiceToolParam(type='tool', name=tool_name)

				response = await self.get_client().messages.create(
					model=self.model,
					messages=anthropic_messages,
					tools=[tool],
					system=system_prompt or omit,
					tool_choice=tool_choice,
					**self._get_client_params_for_invoke(),
				)

				usage = self._get_usage(response)

				# Extract the tool use block
				for content_block in response.content:
					if hasattr(content_block, 'type') and content_block.type == 'tool_use':
						# Parse the tool input as the structured output
						try:
							return ChatInvokeCompletion(completion=output_format.model_validate(content_block.input), usage=usage)
						except Exception as e:
							# If validation fails, try to parse it as JSON first
							if isinstance(content_block.input, str):
								data = json.loads(content_block.input)
								return ChatInvokeCompletion(
									completion=output_format.model_validate(data),
									usage=usage,
								)
							raise e

				# If no tool use block found, raise an error
				raise ValueError('Expected tool use in response but none found')

		except APIConnectionError as e:
			raise ModelProviderError(message=e.message, model=self.name) from e
		except RateLimitError as e:
			raise ModelRateLimitError(message=e.message, model=self.name) from e
		except APIStatusError as e:
			raise ModelProviderError(message=e.message, status_code=e.status_code, model=self.name) from e
		except Exception as e:
			raise ModelProviderError(message=str(e), model=self.name) from e

```

---

## backend/browser-use/browser_use/llm/aws/chat_bedrock.py

```py
import json
from dataclasses import dataclass
from os import getenv
from typing import TYPE_CHECKING, Any, TypeVar, overload

from pydantic import BaseModel

from browser_use.llm.aws.serializer import AWSBedrockMessageSerializer
from browser_use.llm.base import BaseChatModel
from browser_use.llm.exceptions import ModelProviderError, ModelRateLimitError
from browser_use.llm.messages import BaseMessage
from browser_use.llm.views import ChatInvokeCompletion, ChatInvokeUsage

if TYPE_CHECKING:
	from boto3 import client as AwsClient  # type: ignore
	from boto3.session import Session  # type: ignore

T = TypeVar('T', bound=BaseModel)


@dataclass
class ChatAWSBedrock(BaseChatModel):
	"""
	AWS Bedrock chat model supporting multiple providers (Anthropic, Meta, etc.).

	This class provides access to various models via AWS Bedrock,
	supporting both text generation and structured output via tool calling.

	To use this model, you need to either:
	1. Set the following environment variables:
	   - AWS_ACCESS_KEY_ID
	   - AWS_SECRET_ACCESS_KEY
	   - AWS_SESSION_TOKEN (only required when using temporary credentials)
	   - AWS_REGION
	2. Or provide a boto3 Session object
	3. Or use AWS SSO authentication
	"""

	# Model configuration
	model: str = 'anthropic.claude-3-5-sonnet-20240620-v1:0'
	max_tokens: int | None = 4096
	temperature: float | None = None
	top_p: float | None = None
	seed: int | None = None
	stop_sequences: list[str] | None = None

	# AWS credentials and configuration
	aws_access_key_id: str | None = None
	aws_secret_access_key: str | None = None
	aws_session_token: str | None = None
	aws_region: str | None = None
	aws_sso_auth: bool = False
	session: 'Session | None' = None

	# Request parameters
	request_params: dict[str, Any] | None = None

	# Static
	@property
	def provider(self) -> str:
		return 'aws_bedrock'

	def _get_client(self) -> 'AwsClient':  # type: ignore
		"""Get the AWS Bedrock client."""
		try:
			from boto3 import client as AwsClient  # type: ignore
		except ImportError:
			raise ImportError(
				'`boto3` not installed. Please install using `pip install browser-use[aws] or pip install browser-use[all]`'
			)

		if self.session:
			return self.session.client('bedrock-runtime')

		# Get credentials from environment or instance parameters
		access_key = self.aws_access_key_id or getenv('AWS_ACCESS_KEY_ID')
		secret_key = self.aws_secret_access_key or getenv('AWS_SECRET_ACCESS_KEY')
		session_token = self.aws_session_token or getenv('AWS_SESSION_TOKEN')
		region = self.aws_region or getenv('AWS_REGION') or getenv('AWS_DEFAULT_REGION')

		if self.aws_sso_auth:
			return AwsClient(service_name='bedrock-runtime', region_name=region)
		else:
			if not access_key or not secret_key:
				raise ModelProviderError(
					message='AWS credentials not found. Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables (and AWS_SESSION_TOKEN if using temporary credentials) or provide a boto3 session.',
					model=self.name,
				)

			return AwsClient(
				service_name='bedrock-runtime',
				region_name=region,
				aws_access_key_id=access_key,
				aws_secret_access_key=secret_key,
				aws_session_token=session_token,
			)

	@property
	def name(self) -> str:
		return str(self.model)

	def _get_inference_config(self) -> dict[str, Any]:
		"""Get the inference configuration for the request."""
		config = {}
		if self.max_tokens is not None:
			config['maxTokens'] = self.max_tokens
		if self.temperature is not None:
			config['temperature'] = self.temperature
		if self.top_p is not None:
			config['topP'] = self.top_p
		if self.stop_sequences is not None:
			config['stopSequences'] = self.stop_sequences
		if self.seed is not None:
			config['seed'] = self.seed
		return config

	def _format_tools_for_request(self, output_format: type[BaseModel]) -> list[dict[str, Any]]:
		"""Format a Pydantic model as a tool for structured output."""
		schema = output_format.model_json_schema()

		# Convert Pydantic schema to Bedrock tool format
		properties = {}
		required = []

		for prop_name, prop_info in schema.get('properties', {}).items():
			properties[prop_name] = {
				'type': prop_info.get('type', 'string'),
				'description': prop_info.get('description', ''),
			}

		# Add required fields
		required = schema.get('required', [])

		return [
			{
				'toolSpec': {
					'name': f'extract_{output_format.__name__.lower()}',
					'description': f'Extract information in the format of {output_format.__name__}',
					'inputSchema': {'json': {'type': 'object', 'properties': properties, 'required': required}},
				}
			}
		]

	def _get_usage(self, response: dict[str, Any]) -> ChatInvokeUsage | None:
		"""Extract usage information from the response."""
		if 'usage' not in response:
			return None

		usage_data = response['usage']
		return ChatInvokeUsage(
			prompt_tokens=usage_data.get('inputTokens', 0),
			completion_tokens=usage_data.get('outputTokens', 0),
			total_tokens=usage_data.get('totalTokens', 0),
			prompt_cached_tokens=None,  # Bedrock doesn't provide this
			prompt_cache_creation_tokens=None,
			prompt_image_tokens=None,
		)

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: None = None) -> ChatInvokeCompletion[str]: ...

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: type[T]) -> ChatInvokeCompletion[T]: ...

	async def ainvoke(
		self, messages: list[BaseMessage], output_format: type[T] | None = None
	) -> ChatInvokeCompletion[T] | ChatInvokeCompletion[str]:
		"""
		Invoke the AWS Bedrock model with the given messages.

		Args:
			messages: List of chat messages
			output_format: Optional Pydantic model class for structured output

		Returns:
			Either a string response or an instance of output_format
		"""
		try:
			from botocore.exceptions import ClientError  # type: ignore
		except ImportError:
			raise ImportError(
				'`boto3` not installed. Please install using `pip install browser-use[aws] or pip install browser-use[all]`'
			)

		bedrock_messages, system_message = AWSBedrockMessageSerializer.serialize_messages(messages)

		try:
			# Prepare the request body
			body: dict[str, Any] = {}

			if system_message:
				body['system'] = system_message

			inference_config = self._get_inference_config()
			if inference_config:
				body['inferenceConfig'] = inference_config

			# Handle structured output via tool calling
			if output_format is not None:
				tools = self._format_tools_for_request(output_format)
				body['toolConfig'] = {'tools': tools}

			# Add any additional request parameters
			if self.request_params:
				body.update(self.request_params)

			# Filter out None values
			body = {k: v for k, v in body.items() if v is not None}

			# Make the API call
			client = self._get_client()
			response = client.converse(modelId=self.model, messages=bedrock_messages, **body)

			usage = self._get_usage(response)

			# Extract the response content
			if 'output' in response and 'message' in response['output']:
				message = response['output']['message']
				content = message.get('content', [])

				if output_format is None:
					# Return text response
					text_content = []
					for item in content:
						if 'text' in item:
							text_content.append(item['text'])

					response_text = '\n'.join(text_content) if text_content else ''
					return ChatInvokeCompletion(
						completion=response_text,
						usage=usage,
					)
				else:
					# Handle structured output from tool calls
					for item in content:
						if 'toolUse' in item:
							tool_use = item['toolUse']
							tool_input = tool_use.get('input', {})

							try:
								# Validate and return the structured output
								return ChatInvokeCompletion(
									completion=output_format.model_validate(tool_input),
									usage=usage,
								)
							except Exception as e:
								# If validation fails, try to parse as JSON first
								if isinstance(tool_input, str):
									try:
										data = json.loads(tool_input)
										return ChatInvokeCompletion(
											completion=output_format.model_validate(data),
											usage=usage,
										)
									except json.JSONDecodeError:
										pass
								raise ModelProviderError(
									message=f'Failed to validate structured output: {str(e)}',
									model=self.name,
								) from e

					# If no tool use found but output_format was requested
					raise ModelProviderError(
						message='Expected structured output but no tool use found in response',
						model=self.name,
					)

			# If no valid content found
			if output_format is None:
				return ChatInvokeCompletion(
					completion='',
					usage=usage,
				)
			else:
				raise ModelProviderError(
					message='No valid content found in response',
					model=self.name,
				)

		except ClientError as e:
			error_code = e.response.get('Error', {}).get('Code', 'Unknown')
			error_message = e.response.get('Error', {}).get('Message', str(e))

			if error_code in ['ThrottlingException', 'TooManyRequestsException']:
				raise ModelRateLimitError(message=error_message, model=self.name) from e
			else:
				raise ModelProviderError(message=error_message, model=self.name) from e
		except Exception as e:
			raise ModelProviderError(message=str(e), model=self.name) from e

```

---

## backend/browser-use/browser_use/llm/aws/serializer.py

```py
import base64
import json
import re
from typing import Any, overload

from browser_use.llm.messages import (
	AssistantMessage,
	BaseMessage,
	ContentPartImageParam,
	ContentPartRefusalParam,
	ContentPartTextParam,
	SystemMessage,
	ToolCall,
	UserMessage,
)


class AWSBedrockMessageSerializer:
	"""Serializer for converting between custom message types and AWS Bedrock message format."""

	@staticmethod
	def _is_base64_image(url: str) -> bool:
		"""Check if the URL is a base64 encoded image."""
		return url.startswith('data:image/')

	@staticmethod
	def _is_url_image(url: str) -> bool:
		"""Check if the URL is a regular HTTP/HTTPS image URL."""
		return url.startswith(('http://', 'https://')) and any(
			url.lower().endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
		)

	@staticmethod
	def _parse_base64_url(url: str) -> tuple[str, bytes]:
		"""Parse a base64 data URL to extract format and raw bytes."""
		# Format: data:image/jpeg;base64,<data>
		if not url.startswith('data:'):
			raise ValueError(f'Invalid base64 URL: {url}')

		header, data = url.split(',', 1)

		# Extract format from mime type
		mime_match = re.search(r'image/(\w+)', header)
		if mime_match:
			format_name = mime_match.group(1).lower()
			# Map common formats
			format_mapping = {'jpg': 'jpeg', 'jpeg': 'jpeg', 'png': 'png', 'gif': 'gif', 'webp': 'webp'}
			image_format = format_mapping.get(format_name, 'jpeg')
		else:
			image_format = 'jpeg'  # Default format

		# Decode base64 data
		try:
			image_bytes = base64.b64decode(data)
		except Exception as e:
			raise ValueError(f'Failed to decode base64 image data: {e}')

		return image_format, image_bytes

	@staticmethod
	def _download_and_convert_image(url: str) -> tuple[str, bytes]:
		"""Download an image from URL and convert to base64 bytes."""
		try:
			import httpx
		except ImportError:
			raise ImportError('httpx not available. Please install it to use URL images with AWS Bedrock.')

		try:
			response = httpx.get(url, timeout=30)
			response.raise_for_status()

			# Detect format from content type or URL
			content_type = response.headers.get('content-type', '').lower()
			if 'jpeg' in content_type or url.lower().endswith(('.jpg', '.jpeg')):
				image_format = 'jpeg'
			elif 'png' in content_type or url.lower().endswith('.png'):
				image_format = 'png'
			elif 'gif' in content_type or url.lower().endswith('.gif'):
				image_format = 'gif'
			elif 'webp' in content_type or url.lower().endswith('.webp'):
				image_format = 'webp'
			else:
				image_format = 'jpeg'  # Default format

			return image_format, response.content

		except Exception as e:
			raise ValueError(f'Failed to download image from {url}: {e}')

	@staticmethod
	def _serialize_content_part_text(part: ContentPartTextParam) -> dict[str, Any]:
		"""Convert a text content part to AWS Bedrock format."""
		return {'text': part.text}

	@staticmethod
	def _serialize_content_part_image(part: ContentPartImageParam) -> dict[str, Any]:
		"""Convert an image content part to AWS Bedrock format."""
		url = part.image_url.url

		if AWSBedrockMessageSerializer._is_base64_image(url):
			# Handle base64 encoded images
			image_format, image_bytes = AWSBedrockMessageSerializer._parse_base64_url(url)
		elif AWSBedrockMessageSerializer._is_url_image(url):
			# Download and convert URL images
			image_format, image_bytes = AWSBedrockMessageSerializer._download_and_convert_image(url)
		else:
			raise ValueError(f'Unsupported image URL format: {url}')

		return {
			'image': {
				'format': image_format,
				'source': {
					'bytes': image_bytes,
				},
			}
		}

	@staticmethod
	def _serialize_user_content(
		content: str | list[ContentPartTextParam | ContentPartImageParam],
	) -> list[dict[str, Any]]:
		"""Serialize content for user messages."""
		if isinstance(content, str):
			return [{'text': content}]

		content_blocks: list[dict[str, Any]] = []
		for part in content:
			if part.type == 'text':
				content_blocks.append(AWSBedrockMessageSerializer._serialize_content_part_text(part))
			elif part.type == 'image_url':
				content_blocks.append(AWSBedrockMessageSerializer._serialize_content_part_image(part))

		return content_blocks

	@staticmethod
	def _serialize_system_content(
		content: str | list[ContentPartTextParam],
	) -> list[dict[str, Any]]:
		"""Serialize content for system messages."""
		if isinstance(content, str):
			return [{'text': content}]

		content_blocks: list[dict[str, Any]] = []
		for part in content:
			if part.type == 'text':
				content_blocks.append(AWSBedrockMessageSerializer._serialize_content_part_text(part))

		return content_blocks

	@staticmethod
	def _serialize_assistant_content(
		content: str | list[ContentPartTextParam | ContentPartRefusalParam] | None,
	) -> list[dict[str, Any]]:
		"""Serialize content for assistant messages."""
		if content is None:
			return []
		if isinstance(content, str):
			return [{'text': content}]

		content_blocks: list[dict[str, Any]] = []
		for part in content:
			if part.type == 'text':
				content_blocks.append(AWSBedrockMessageSerializer._serialize_content_part_text(part))
			# Skip refusal content parts - AWS Bedrock doesn't need them

		return content_blocks

	@staticmethod
	def _serialize_tool_call(tool_call: ToolCall) -> dict[str, Any]:
		"""Convert a tool call to AWS Bedrock format."""
		try:
			arguments = json.loads(tool_call.function.arguments)
		except json.JSONDecodeError:
			# If arguments aren't valid JSON, wrap them
			arguments = {'arguments': tool_call.function.arguments}

		return {
			'toolUse': {
				'toolUseId': tool_call.id,
				'name': tool_call.function.name,
				'input': arguments,
			}
		}

	# region - Serialize overloads
	@overload
	@staticmethod
	def serialize(message: UserMessage) -> dict[str, Any]: ...

	@overload
	@staticmethod
	def serialize(message: SystemMessage) -> SystemMessage: ...

	@overload
	@staticmethod
	def serialize(message: AssistantMessage) -> dict[str, Any]: ...

	@staticmethod
	def serialize(message: BaseMessage) -> dict[str, Any] | SystemMessage:
		"""Serialize a custom message to AWS Bedrock format."""

		if isinstance(message, UserMessage):
			return {
				'role': 'user',
				'content': AWSBedrockMessageSerializer._serialize_user_content(message.content),
			}

		elif isinstance(message, SystemMessage):
			# System messages are handled separately in AWS Bedrock
			return message

		elif isinstance(message, AssistantMessage):
			content_blocks: list[dict[str, Any]] = []

			# Add content blocks if present
			if message.content is not None:
				content_blocks.extend(AWSBedrockMessageSerializer._serialize_assistant_content(message.content))

			# Add tool use blocks if present
			if message.tool_calls:
				for tool_call in message.tool_calls:
					content_blocks.append(AWSBedrockMessageSerializer._serialize_tool_call(tool_call))

			# AWS Bedrock requires at least one content block
			if not content_blocks:
				content_blocks = [{'text': ''}]

			return {
				'role': 'assistant',
				'content': content_blocks,
			}

		else:
			raise ValueError(f'Unknown message type: {type(message)}')

	@staticmethod
	def serialize_messages(messages: list[BaseMessage]) -> tuple[list[dict[str, Any]], list[dict[str, Any]] | None]:
		"""
		Serialize a list of messages, extracting any system message.

		Returns:
			Tuple of (bedrock_messages, system_message) where system_message is extracted
			from any SystemMessage in the list.
		"""
		bedrock_messages: list[dict[str, Any]] = []
		system_message: list[dict[str, Any]] | None = None

		for message in messages:
			if isinstance(message, SystemMessage):
				# Extract system message content
				system_message = AWSBedrockMessageSerializer._serialize_system_content(message.content)
			else:
				# Serialize and add to regular messages
				serialized = AWSBedrockMessageSerializer.serialize(message)
				bedrock_messages.append(serialized)

		return bedrock_messages, system_message

```

---

## backend/browser-use/browser_use/llm/azure/chat.py

```py
import os
from dataclasses import dataclass
from typing import Any

import httpx
from openai import AsyncAzureOpenAI as AsyncAzureOpenAIClient
from openai.types.shared import ChatModel

from browser_use.llm.openai.like import ChatOpenAILike


@dataclass
class ChatAzureOpenAI(ChatOpenAILike):
	"""
	A class for to interact with any provider using the OpenAI API schema.

	Args:
	    model (str): The name of the OpenAI model to use. Defaults to "not-provided".
	    api_key (Optional[str]): The API key to use. Defaults to "not-provided".
	"""

	# Model configuration
	model: str | ChatModel

	# Client initialization parameters
	api_key: str | None = None
	api_version: str | None = '2024-12-01-preview'
	azure_endpoint: str | None = None
	azure_deployment: str | None = None
	base_url: str | None = None
	azure_ad_token: str | None = None
	azure_ad_token_provider: Any | None = None

	default_headers: dict[str, str] | None = None
	default_query: dict[str, Any] | None = None

	client: AsyncAzureOpenAIClient | None = None

	@property
	def provider(self) -> str:
		return 'azure'

	def _get_client_params(self) -> dict[str, Any]:
		_client_params: dict[str, Any] = {}

		self.api_key = self.api_key or os.getenv('AZURE_OPENAI_KEY') or os.getenv('AZURE_OPENAI_API_KEY')
		self.azure_endpoint = self.azure_endpoint or os.getenv('AZURE_OPENAI_ENDPOINT')
		self.azure_deployment = self.azure_deployment or os.getenv('AZURE_OPENAI_DEPLOYMENT')
		params_mapping = {
			'api_key': self.api_key,
			'api_version': self.api_version,
			'organization': self.organization,
			'azure_endpoint': self.azure_endpoint,
			'azure_deployment': self.azure_deployment,
			'base_url': self.base_url,
			'azure_ad_token': self.azure_ad_token,
			'azure_ad_token_provider': self.azure_ad_token_provider,
			'http_client': self.http_client,
		}
		if self.default_headers is not None:
			_client_params['default_headers'] = self.default_headers
		if self.default_query is not None:
			_client_params['default_query'] = self.default_query

		_client_params.update({k: v for k, v in params_mapping.items() if v is not None})

		return _client_params

	def get_client(self) -> AsyncAzureOpenAIClient:
		"""
		Returns an asynchronous OpenAI client.

		Returns:
			AsyncAzureOpenAIClient: An instance of the asynchronous OpenAI client.
		"""
		if self.client:
			return self.client

		_client_params: dict[str, Any] = self._get_client_params()

		if self.http_client:
			_client_params['http_client'] = self.http_client
		else:
			# Create a new async HTTP client with custom limits
			_client_params['http_client'] = httpx.AsyncClient(
				limits=httpx.Limits(max_connections=20, max_keepalive_connections=6)
			)

		self.client = AsyncAzureOpenAIClient(**_client_params)

		return self.client

```

---

## backend/browser-use/browser_use/llm/base.py

```py
"""
We have switched all of our code from langchain to openai.types.chat.chat_completion_message_param.

For easier transition we have
"""

from typing import Any, Protocol, TypeVar, overload, runtime_checkable

from pydantic import BaseModel

from browser_use.llm.messages import BaseMessage
from browser_use.llm.views import ChatInvokeCompletion

T = TypeVar('T', bound=BaseModel)


@runtime_checkable
class BaseChatModel(Protocol):
	_verified_api_keys: bool = False

	model: str

	@property
	def provider(self) -> str: ...

	@property
	def name(self) -> str: ...

	@property
	def model_name(self) -> str:
		# for legacy support
		return self.model

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: None = None) -> ChatInvokeCompletion[str]: ...

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: type[T]) -> ChatInvokeCompletion[T]: ...

	async def ainvoke(
		self, messages: list[BaseMessage], output_format: type[T] | None = None
	) -> ChatInvokeCompletion[T] | ChatInvokeCompletion[str]: ...

	@classmethod
	def __get_pydantic_core_schema__(
		cls,
		source_type: type,
		handler: Any,
	) -> Any:
		"""
		Allow this Protocol to be used in Pydantic models -> very useful to typesafe the agent settings for example.
		Returns a schema that allows any object (since this is a Protocol).
		"""
		from pydantic_core import core_schema

		# Return a schema that accepts any object for Protocol types
		return core_schema.any_schema()

```

---

## backend/browser-use/browser_use/llm/browser_use/__init__.py

```py
from browser_use.llm.browser_use.chat import ChatBrowserUse

__all__ = ['ChatBrowserUse']

```

---

## backend/browser-use/browser_use/llm/browser_use/chat.py

```py
"""
ChatBrowserUse - Client for browser-use cloud API

This wraps the BaseChatModel protocol and sends requests to the browser-use cloud API
for optimized browser automation LLM inference.
"""

import asyncio
import logging
import os
import random
from typing import TypeVar, overload

import httpx
from pydantic import BaseModel

from browser_use.llm.base import BaseChatModel
from browser_use.llm.messages import BaseMessage
from browser_use.llm.views import ChatInvokeCompletion
from browser_use.observability import observe

T = TypeVar('T', bound=BaseModel)

logger = logging.getLogger(__name__)

# HTTP status codes that should trigger a retry
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


class ChatBrowserUse(BaseChatModel):
	"""
	Client for browser-use cloud API.

	This sends requests to the browser-use cloud API which uses optimized models
	and prompts for browser automation tasks.

	Usage:
		agent = Agent(
			task="Find the number of stars of the browser-use repo",
			llm=ChatBrowserUse(model='bu-latest'),
		)
	"""

	def __init__(
		self,
		model: str = 'bu-latest',
		api_key: str | None = None,
		base_url: str | None = None,
		timeout: float = 120.0,
		max_retries: int = 5,
		retry_base_delay: float = 1.0,
		retry_max_delay: float = 60.0,
		**kwargs,
	):
		"""
		Initialize ChatBrowserUse client.

		Args:
			model: Model name to use. Options: 'bu-latest', 'bu-1-0'. Defaults to 'bu-latest'.
			api_key: API key for browser-use cloud. Defaults to BROWSER_USE_API_KEY env var.
			base_url: Base URL for the API. Defaults to BROWSER_USE_LLM_URL env var or production URL.
			timeout: Request timeout in seconds.
			max_retries: Maximum number of retries for transient errors (default: 5).
			retry_base_delay: Base delay in seconds for exponential backoff (default: 1.0).
			retry_max_delay: Maximum delay in seconds between retries (default: 60.0).
		"""
		# Validate model name
		valid_models = ['bu-latest', 'bu-1-0']
		if model not in valid_models:
			raise ValueError(f"Invalid model: '{model}'. Must be one of {valid_models}")

		self.model = 'bu-1-0' if model == 'bu-latest' else model  # must update on new model releases
		self.fast = False
		self.api_key = api_key or os.getenv('BROWSER_USE_API_KEY')
		self.base_url = base_url or os.getenv('BROWSER_USE_LLM_URL', 'https://llm.api.browser-use.com')
		self.timeout = timeout
		self.max_retries = max_retries
		self.retry_base_delay = retry_base_delay
		self.retry_max_delay = retry_max_delay

		if not self.api_key:
			raise ValueError(
				'You need to set the BROWSER_USE_API_KEY environment variable. '
				'Get your key at https://cloud.browser-use.com/new-api-key'
			)

	@property
	def provider(self) -> str:
		return 'browser-use'

	@property
	def name(self) -> str:
		return self.model

	@overload
	async def ainvoke(
		self, messages: list[BaseMessage], output_format: None = None, request_type: str = 'browser_agent'
	) -> ChatInvokeCompletion[str]: ...

	@overload
	async def ainvoke(
		self, messages: list[BaseMessage], output_format: type[T], request_type: str = 'browser_agent'
	) -> ChatInvokeCompletion[T]: ...

	@observe(name='chat_browser_use_ainvoke')
	async def ainvoke(
		self, messages: list[BaseMessage], output_format: type[T] | None = None, request_type: str = 'browser_agent'
	) -> ChatInvokeCompletion[T] | ChatInvokeCompletion[str]:
		"""
		Send request to browser-use cloud API.

		Args:
			messages: List of messages to send
			output_format: Expected output format (Pydantic model)
			request_type: Type of request - 'browser_agent' or 'judge'

		Returns:
			ChatInvokeCompletion with structured response and usage info
		"""
		# Get ANONYMIZED_TELEMETRY setting from config
		from browser_use.config import CONFIG

		anonymized_telemetry = CONFIG.ANONYMIZED_TELEMETRY

		# Prepare request payload
		payload = {
			'messages': [self._serialize_message(msg) for msg in messages],
			'fast': self.fast,
			'request_type': request_type,
			'anonymized_telemetry': anonymized_telemetry,
		}

		# Add output format schema if provided
		if output_format is not None:
			payload['output_format'] = output_format.model_json_schema()

		last_error: Exception | None = None

		# Retry loop with exponential backoff
		for attempt in range(self.max_retries):
			try:
				result = await self._make_request(payload)
				break
			except httpx.HTTPStatusError as e:
				last_error = e
				status_code = e.response.status_code

				# Check if this is a retryable error
				if status_code in RETRYABLE_STATUS_CODES and attempt < self.max_retries - 1:
					delay = min(self.retry_base_delay * (2**attempt), self.retry_max_delay)
					jitter = random.uniform(0, delay * 0.1)
					total_delay = delay + jitter
					logger.warning(
						f'⚠️ Got {status_code} error, retrying in {total_delay:.1f}s... (attempt {attempt + 1}/{self.max_retries})'
					)
					await asyncio.sleep(total_delay)
					continue

				# Non-retryable HTTP error or exhausted retries
				self._raise_http_error(e)

			except (httpx.TimeoutException, httpx.ConnectError) as e:
				last_error = e
				# Network errors are retryable
				if attempt < self.max_retries - 1:
					delay = min(self.retry_base_delay * (2**attempt), self.retry_max_delay)
					jitter = random.uniform(0, delay * 0.1)
					total_delay = delay + jitter
					error_type = 'timeout' if isinstance(e, httpx.TimeoutException) else 'connection error'
					logger.warning(
						f'⚠️ Got {error_type}, retrying in {total_delay:.1f}s... (attempt {attempt + 1}/{self.max_retries})'
					)
					await asyncio.sleep(total_delay)
					continue

				# Exhausted retries
				if isinstance(e, httpx.TimeoutException):
					raise ValueError(f'Request timed out after {self.timeout}s (retried {self.max_retries} times)')
				raise ValueError(f'Failed to connect to browser-use API after {self.max_retries} attempts: {e}')

			except Exception as e:
				raise ValueError(f'Failed to connect to browser-use API: {e}')
		else:
			# Loop completed without break (all retries exhausted)
			if last_error is not None:
				if isinstance(last_error, httpx.HTTPStatusError):
					self._raise_http_error(last_error)
				raise ValueError(f'Request failed after {self.max_retries} attempts: {last_error}')
			raise RuntimeError('Retry loop completed without return or exception')

		# Parse response - server returns structured data as dict
		if output_format is not None:
			# Server returns structured data as a dict, validate it
			completion_data = result['completion']
			logger.debug(
				f'📥 Got structured data from service: {list(completion_data.keys()) if isinstance(completion_data, dict) else type(completion_data)}'
			)

			# Convert action dicts to ActionModel instances if needed
			# llm-use returns dicts to avoid validation with empty ActionModel
			if isinstance(completion_data, dict) and 'action' in completion_data:
				actions = completion_data['action']
				if actions and isinstance(actions[0], dict):
					from typing import get_args

					# Get ActionModel type from output_format
					action_model_type = get_args(output_format.model_fields['action'].annotation)[0]

					# Convert dicts to ActionModel instances
					completion_data['action'] = [action_model_type.model_validate(action_dict) for action_dict in actions]

			completion = output_format.model_validate(completion_data)
		else:
			completion = result['completion']

		# Parse usage info
		usage = None
		if 'usage' in result and result['usage'] is not None:
			from browser_use.llm.views import ChatInvokeUsage

			usage = ChatInvokeUsage(**result['usage'])

		return ChatInvokeCompletion(
			completion=completion,
			usage=usage,
		)

	async def _make_request(self, payload: dict) -> dict:
		"""Make a single API request."""
		async with httpx.AsyncClient(timeout=self.timeout) as client:
			response = await client.post(
				f'{self.base_url}/v1/chat/completions',
				json=payload,
				headers={
					'Authorization': f'Bearer {self.api_key}',
					'Content-Type': 'application/json',
				},
			)
			response.raise_for_status()
			return response.json()

	def _raise_http_error(self, e: httpx.HTTPStatusError) -> None:
		"""Raise a ValueError with appropriate error message for HTTP errors."""
		error_detail = ''
		try:
			error_data = e.response.json()
			error_detail = error_data.get('detail', str(e))
		except Exception:
			error_detail = str(e)

		if e.response.status_code == 401:
			raise ValueError(f'Invalid API key. {error_detail}')
		elif e.response.status_code == 402:
			raise ValueError(f'Insufficient credits. {error_detail}')
		else:
			raise ValueError(f'API request failed: {error_detail}')

	def _serialize_message(self, message: BaseMessage) -> dict:
		"""Serialize a message to JSON format."""
		# Handle Union types by checking the actual message type
		msg_dict = message.model_dump()
		return {
			'role': msg_dict['role'],
			'content': msg_dict['content'],
		}

```

---

## backend/browser-use/browser_use/llm/cerebras/chat.py

```py
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, TypeVar, overload

import httpx
from openai import (
	APIConnectionError,
	APIError,
	APIStatusError,
	APITimeoutError,
	AsyncOpenAI,
	RateLimitError,
)
from openai.types.chat import ChatCompletion
from pydantic import BaseModel

from browser_use.llm.base import BaseChatModel
from browser_use.llm.cerebras.serializer import CerebrasMessageSerializer
from browser_use.llm.exceptions import ModelProviderError, ModelRateLimitError
from browser_use.llm.messages import BaseMessage
from browser_use.llm.views import ChatInvokeCompletion, ChatInvokeUsage

T = TypeVar('T', bound=BaseModel)


@dataclass
class ChatCerebras(BaseChatModel):
	"""Cerebras inference wrapper (OpenAI-compatible)."""

	model: str = 'llama3.1-8b'

	# Generation parameters
	max_tokens: int | None = 4096
	temperature: float | None = 0.2
	top_p: float | None = None
	seed: int | None = None

	# Connection parameters
	api_key: str | None = None
	base_url: str | httpx.URL | None = 'https://api.cerebras.ai/v1'
	timeout: float | httpx.Timeout | None = None
	client_params: dict[str, Any] | None = None

	@property
	def provider(self) -> str:
		return 'cerebras'

	def _client(self) -> AsyncOpenAI:
		return AsyncOpenAI(
			api_key=self.api_key,
			base_url=self.base_url,
			timeout=self.timeout,
			**(self.client_params or {}),
		)

	@property
	def name(self) -> str:
		return self.model

	def _get_usage(self, response: ChatCompletion) -> ChatInvokeUsage | None:
		if response.usage is not None:
			usage = ChatInvokeUsage(
				prompt_tokens=response.usage.prompt_tokens,
				prompt_cached_tokens=None,
				prompt_cache_creation_tokens=None,
				prompt_image_tokens=None,
				completion_tokens=response.usage.completion_tokens,
				total_tokens=response.usage.total_tokens,
			)
		else:
			usage = None
		return usage

	@overload
	async def ainvoke(
		self,
		messages: list[BaseMessage],
		output_format: None = None,
	) -> ChatInvokeCompletion[str]: ...

	@overload
	async def ainvoke(
		self,
		messages: list[BaseMessage],
		output_format: type[T],
	) -> ChatInvokeCompletion[T]: ...

	async def ainvoke(
		self,
		messages: list[BaseMessage],
		output_format: type[T] | None = None,
	) -> ChatInvokeCompletion[T] | ChatInvokeCompletion[str]:
		"""
		Cerebras ainvoke supports:
		1. Regular text/multi-turn conversation
		2. JSON Output (response_format)
		"""
		client = self._client()
		cerebras_messages = CerebrasMessageSerializer.serialize_messages(messages)
		common: dict[str, Any] = {}

		if self.temperature is not None:
			common['temperature'] = self.temperature
		if self.max_tokens is not None:
			common['max_tokens'] = self.max_tokens
		if self.top_p is not None:
			common['top_p'] = self.top_p
		if self.seed is not None:
			common['seed'] = self.seed

		# ① Regular multi-turn conversation/text output
		if output_format is None:
			try:
				resp = await client.chat.completions.create(  # type: ignore
					model=self.model,
					messages=cerebras_messages,  # type: ignore
					**common,
				)
				usage = self._get_usage(resp)
				return ChatInvokeCompletion(
					completion=resp.choices[0].message.content or '',
					usage=usage,
				)
			except RateLimitError as e:
				raise ModelRateLimitError(str(e), model=self.name) from e
			except (APIError, APIConnectionError, APITimeoutError, APIStatusError) as e:
				raise ModelProviderError(str(e), model=self.name) from e
			except Exception as e:
				raise ModelProviderError(str(e), model=self.name) from e

		# ② JSON Output path (response_format)
		if output_format is not None and hasattr(output_format, 'model_json_schema'):
			try:
				# For Cerebras, we'll use a simpler approach without response_format
				# Instead, we'll ask the model to return JSON and parse it
				import json

				# Get the schema to guide the model
				schema = output_format.model_json_schema()
				schema_str = json.dumps(schema, indent=2)

				# Create a prompt that asks for the specific JSON structure
				json_prompt = f"""
Please respond with a JSON object that follows this exact schema:
{schema_str}

Your response must be valid JSON only, no other text.
"""

				# Add or modify the last user message to include the JSON prompt
				if cerebras_messages and cerebras_messages[-1]['role'] == 'user':
					if isinstance(cerebras_messages[-1]['content'], str):
						cerebras_messages[-1]['content'] += json_prompt
					elif isinstance(cerebras_messages[-1]['content'], list):
						cerebras_messages[-1]['content'].append({'type': 'text', 'text': json_prompt})
				else:
					# Add as a new user message
					cerebras_messages.append({'role': 'user', 'content': json_prompt})

				resp = await client.chat.completions.create(  # type: ignore
					model=self.model,
					messages=cerebras_messages,  # type: ignore
					**common,
				)
				content = resp.choices[0].message.content
				if not content:
					raise ModelProviderError('Empty JSON content in Cerebras response', model=self.name)

				usage = self._get_usage(resp)

				# Try to extract JSON from the response
				import re

				json_match = re.search(r'\{.*\}', content, re.DOTALL)
				if json_match:
					json_str = json_match.group(0)
				else:
					json_str = content

				parsed = output_format.model_validate_json(json_str)
				return ChatInvokeCompletion(
					completion=parsed,
					usage=usage,
				)
			except RateLimitError as e:
				raise ModelRateLimitError(str(e), model=self.name) from e
			except (APIError, APIConnectionError, APITimeoutError, APIStatusError) as e:
				raise ModelProviderError(str(e), model=self.name) from e
			except Exception as e:
				raise ModelProviderError(str(e), model=self.name) from e

		raise ModelProviderError('No valid ainvoke execution path for Cerebras LLM', model=self.name)

```

---

## backend/browser-use/browser_use/llm/cerebras/serializer.py

```py
from __future__ import annotations

import json
from typing import Any, overload

from browser_use.llm.messages import (
	AssistantMessage,
	BaseMessage,
	ContentPartImageParam,
	ContentPartTextParam,
	SystemMessage,
	ToolCall,
	UserMessage,
)

MessageDict = dict[str, Any]


class CerebrasMessageSerializer:
	"""Serializer for converting browser-use messages to Cerebras messages."""

	# -------- content 处理 --------------------------------------------------
	@staticmethod
	def _serialize_text_part(part: ContentPartTextParam) -> str:
		return part.text

	@staticmethod
	def _serialize_image_part(part: ContentPartImageParam) -> dict[str, Any]:
		url = part.image_url.url
		if url.startswith('data:'):
			return {'type': 'image_url', 'image_url': {'url': url}}
		return {'type': 'image_url', 'image_url': {'url': url}}

	@staticmethod
	def _serialize_content(content: Any) -> str | list[dict[str, Any]]:
		if content is None:
			return ''
		if isinstance(content, str):
			return content
		serialized: list[dict[str, Any]] = []
		for part in content:
			if part.type == 'text':
				serialized.append({'type': 'text', 'text': CerebrasMessageSerializer._serialize_text_part(part)})
			elif part.type == 'image_url':
				serialized.append(CerebrasMessageSerializer._serialize_image_part(part))
			elif part.type == 'refusal':
				serialized.append({'type': 'text', 'text': f'[Refusal] {part.refusal}'})
		return serialized

	# -------- Tool-call 处理 -------------------------------------------------
	@staticmethod
	def _serialize_tool_calls(tool_calls: list[ToolCall]) -> list[dict[str, Any]]:
		cerebras_tool_calls: list[dict[str, Any]] = []
		for tc in tool_calls:
			try:
				arguments = json.loads(tc.function.arguments)
			except json.JSONDecodeError:
				arguments = {'arguments': tc.function.arguments}
			cerebras_tool_calls.append(
				{
					'id': tc.id,
					'type': 'function',
					'function': {
						'name': tc.function.name,
						'arguments': arguments,
					},
				}
			)
		return cerebras_tool_calls

	# -------- 单条消息序列化 -------------------------------------------------
	@overload
	@staticmethod
	def serialize(message: UserMessage) -> MessageDict: ...

	@overload
	@staticmethod
	def serialize(message: SystemMessage) -> MessageDict: ...

	@overload
	@staticmethod
	def serialize(message: AssistantMessage) -> MessageDict: ...

	@staticmethod
	def serialize(message: BaseMessage) -> MessageDict:
		if isinstance(message, UserMessage):
			return {
				'role': 'user',
				'content': CerebrasMessageSerializer._serialize_content(message.content),
			}
		if isinstance(message, SystemMessage):
			return {
				'role': 'system',
				'content': CerebrasMessageSerializer._serialize_content(message.content),
			}
		if isinstance(message, AssistantMessage):
			msg: MessageDict = {
				'role': 'assistant',
				'content': CerebrasMessageSerializer._serialize_content(message.content),
			}
			if message.tool_calls:
				msg['tool_calls'] = CerebrasMessageSerializer._serialize_tool_calls(message.tool_calls)
			return msg
		raise ValueError(f'Unknown message type: {type(message)}')

	# -------- 列表序列化 -----------------------------------------------------
	@staticmethod
	def serialize_messages(messages: list[BaseMessage]) -> list[MessageDict]:
		return [CerebrasMessageSerializer.serialize(m) for m in messages]

```

---

## backend/browser-use/browser_use/llm/deepseek/chat.py

```py
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, TypeVar, overload

import httpx
from openai import (
	APIConnectionError,
	APIError,
	APIStatusError,
	APITimeoutError,
	AsyncOpenAI,
	RateLimitError,
)
from pydantic import BaseModel

from browser_use.llm.base import BaseChatModel
from browser_use.llm.deepseek.serializer import DeepSeekMessageSerializer
from browser_use.llm.exceptions import ModelProviderError, ModelRateLimitError
from browser_use.llm.messages import BaseMessage
from browser_use.llm.schema import SchemaOptimizer
from browser_use.llm.views import ChatInvokeCompletion

T = TypeVar('T', bound=BaseModel)


@dataclass
class ChatDeepSeek(BaseChatModel):
	"""DeepSeek /chat/completions wrapper (OpenAI-compatible)."""

	model: str = 'deepseek-chat'

	# Generation parameters
	max_tokens: int | None = None
	temperature: float | None = None
	top_p: float | None = None
	seed: int | None = None

	# Connection parameters
	api_key: str | None = None
	base_url: str | httpx.URL | None = 'https://api.deepseek.com/v1'
	timeout: float | httpx.Timeout | None = None
	client_params: dict[str, Any] | None = None

	@property
	def provider(self) -> str:
		return 'deepseek'

	def _client(self) -> AsyncOpenAI:
		return AsyncOpenAI(
			api_key=self.api_key,
			base_url=self.base_url,
			timeout=self.timeout,
			**(self.client_params or {}),
		)

	@property
	def name(self) -> str:
		return self.model

	@overload
	async def ainvoke(
		self,
		messages: list[BaseMessage],
		output_format: None = None,
		tools: list[dict[str, Any]] | None = None,
		stop: list[str] | None = None,
	) -> ChatInvokeCompletion[str]: ...

	@overload
	async def ainvoke(
		self,
		messages: list[BaseMessage],
		output_format: type[T],
		tools: list[dict[str, Any]] | None = None,
		stop: list[str] | None = None,
	) -> ChatInvokeCompletion[T]: ...

	async def ainvoke(
		self,
		messages: list[BaseMessage],
		output_format: type[T] | None = None,
		tools: list[dict[str, Any]] | None = None,
		stop: list[str] | None = None,
	) -> ChatInvokeCompletion[T] | ChatInvokeCompletion[str]:
		"""
		DeepSeek ainvoke supports:
		1. Regular text/multi-turn conversation
		2. Function Calling
		3. JSON Output (response_format)
		4. Conversation prefix continuation (beta, prefix, stop)
		"""
		client = self._client()
		ds_messages = DeepSeekMessageSerializer.serialize_messages(messages)
		common: dict[str, Any] = {}

		if self.temperature is not None:
			common['temperature'] = self.temperature
		if self.max_tokens is not None:
			common['max_tokens'] = self.max_tokens
		if self.top_p is not None:
			common['top_p'] = self.top_p
		if self.seed is not None:
			common['seed'] = self.seed

		# Beta conversation prefix continuation (see official documentation)
		if self.base_url and str(self.base_url).endswith('/beta'):
			# The last assistant message must have prefix
			if ds_messages and isinstance(ds_messages[-1], dict) and ds_messages[-1].get('role') == 'assistant':
				ds_messages[-1]['prefix'] = True
			if stop:
				common['stop'] = stop

		# ① Regular multi-turn conversation/text output
		if output_format is None and not tools:
			try:
				resp = await client.chat.completions.create(  # type: ignore
					model=self.model,
					messages=ds_messages,  # type: ignore
					**common,
				)
				return ChatInvokeCompletion(
					completion=resp.choices[0].message.content or '',
					usage=None,
				)
			except RateLimitError as e:
				raise ModelRateLimitError(str(e), model=self.name) from e
			except (APIError, APIConnectionError, APITimeoutError, APIStatusError) as e:
				raise ModelProviderError(str(e), model=self.name) from e
			except Exception as e:
				raise ModelProviderError(str(e), model=self.name) from e

		# ② Function Calling path (with tools or output_format)
		if tools or (output_format is not None and hasattr(output_format, 'model_json_schema')):
			try:
				call_tools = tools
				tool_choice = None
				if output_format is not None and hasattr(output_format, 'model_json_schema'):
					tool_name = output_format.__name__
					schema = SchemaOptimizer.create_optimized_json_schema(output_format)
					schema.pop('title', None)
					call_tools = [
						{
							'type': 'function',
							'function': {
								'name': tool_name,
								'description': f'Return a JSON object of type {tool_name}',
								'parameters': schema,
							},
						}
					]
					tool_choice = {'type': 'function', 'function': {'name': tool_name}}
				resp = await client.chat.completions.create(  # type: ignore
					model=self.model,
					messages=ds_messages,  # type: ignore
					tools=call_tools,  # type: ignore
					tool_choice=tool_choice,  # type: ignore
					**common,
				)
				msg = resp.choices[0].message
				if not msg.tool_calls:
					raise ValueError('Expected tool_calls in response but got none')
				raw_args = msg.tool_calls[0].function.arguments
				if isinstance(raw_args, str):
					parsed = json.loads(raw_args)
				else:
					parsed = raw_args
				# --------- Fix: only use model_validate when output_format is not None ----------
				if output_format is not None:
					return ChatInvokeCompletion(
						completion=output_format.model_validate(parsed),
						usage=None,
					)
				else:
					# If no output_format, return dict directly
					return ChatInvokeCompletion(
						completion=parsed,
						usage=None,
					)
			except RateLimitError as e:
				raise ModelRateLimitError(str(e), model=self.name) from e
			except (APIError, APIConnectionError, APITimeoutError, APIStatusError) as e:
				raise ModelProviderError(str(e), model=self.name) from e
			except Exception as e:
				raise ModelProviderError(str(e), model=self.name) from e

		# ③ JSON Output path (official response_format)
		if output_format is not None and hasattr(output_format, 'model_json_schema'):
			try:
				resp = await client.chat.completions.create(  # type: ignore
					model=self.model,
					messages=ds_messages,  # type: ignore
					response_format={'type': 'json_object'},
					**common,
				)
				content = resp.choices[0].message.content
				if not content:
					raise ModelProviderError('Empty JSON content in DeepSeek response', model=self.name)
				parsed = output_format.model_validate_json(content)
				return ChatInvokeCompletion(
					completion=parsed,
					usage=None,
				)
			except RateLimitError as e:
				raise ModelRateLimitError(str(e), model=self.name) from e
			except (APIError, APIConnectionError, APITimeoutError, APIStatusError) as e:
				raise ModelProviderError(str(e), model=self.name) from e
			except Exception as e:
				raise ModelProviderError(str(e), model=self.name) from e

		raise ModelProviderError('No valid ainvoke execution path for DeepSeek LLM', model=self.name)

```

---

## backend/browser-use/browser_use/llm/deepseek/serializer.py

```py
from __future__ import annotations

import json
from typing import Any, overload

from browser_use.llm.messages import (
	AssistantMessage,
	BaseMessage,
	ContentPartImageParam,
	ContentPartTextParam,
	SystemMessage,
	ToolCall,
	UserMessage,
)

MessageDict = dict[str, Any]


class DeepSeekMessageSerializer:
	"""Serializer for converting browser-use messages to DeepSeek messages."""

	# -------- content 处理 --------------------------------------------------
	@staticmethod
	def _serialize_text_part(part: ContentPartTextParam) -> str:
		return part.text

	@staticmethod
	def _serialize_image_part(part: ContentPartImageParam) -> dict[str, Any]:
		url = part.image_url.url
		if url.startswith('data:'):
			return {'type': 'image_url', 'image_url': {'url': url}}
		return {'type': 'image_url', 'image_url': {'url': url}}

	@staticmethod
	def _serialize_content(content: Any) -> str | list[dict[str, Any]]:
		if content is None:
			return ''
		if isinstance(content, str):
			return content
		serialized: list[dict[str, Any]] = []
		for part in content:
			if part.type == 'text':
				serialized.append({'type': 'text', 'text': DeepSeekMessageSerializer._serialize_text_part(part)})
			elif part.type == 'image_url':
				serialized.append(DeepSeekMessageSerializer._serialize_image_part(part))
			elif part.type == 'refusal':
				serialized.append({'type': 'text', 'text': f'[Refusal] {part.refusal}'})
		return serialized

	# -------- Tool-call 处理 -------------------------------------------------
	@staticmethod
	def _serialize_tool_calls(tool_calls: list[ToolCall]) -> list[dict[str, Any]]:
		deepseek_tool_calls: list[dict[str, Any]] = []
		for tc in tool_calls:
			try:
				arguments = json.loads(tc.function.arguments)
			except json.JSONDecodeError:
				arguments = {'arguments': tc.function.arguments}
			deepseek_tool_calls.append(
				{
					'id': tc.id,
					'type': 'function',
					'function': {
						'name': tc.function.name,
						'arguments': arguments,
					},
				}
			)
		return deepseek_tool_calls

	# -------- 单条消息序列化 -------------------------------------------------
	@overload
	@staticmethod
	def serialize(message: UserMessage) -> MessageDict: ...

	@overload
	@staticmethod
	def serialize(message: SystemMessage) -> MessageDict: ...

	@overload
	@staticmethod
	def serialize(message: AssistantMessage) -> MessageDict: ...

	@staticmethod
	def serialize(message: BaseMessage) -> MessageDict:
		if isinstance(message, UserMessage):
			return {
				'role': 'user',
				'content': DeepSeekMessageSerializer._serialize_content(message.content),
			}
		if isinstance(message, SystemMessage):
			return {
				'role': 'system',
				'content': DeepSeekMessageSerializer._serialize_content(message.content),
			}
		if isinstance(message, AssistantMessage):
			msg: MessageDict = {
				'role': 'assistant',
				'content': DeepSeekMessageSerializer._serialize_content(message.content),
			}
			if message.tool_calls:
				msg['tool_calls'] = DeepSeekMessageSerializer._serialize_tool_calls(message.tool_calls)
			return msg
		raise ValueError(f'Unknown message type: {type(message)}')

	# -------- 列表序列化 -----------------------------------------------------
	@staticmethod
	def serialize_messages(messages: list[BaseMessage]) -> list[MessageDict]:
		return [DeepSeekMessageSerializer.serialize(m) for m in messages]

```

---

## backend/browser-use/browser_use/llm/exceptions.py

```py
class ModelError(Exception):
	pass


class ModelProviderError(ModelError):
	"""Exception raised when a model provider returns an error."""

	def __init__(
		self,
		message: str,
		status_code: int = 502,
		model: str | None = None,
	):
		super().__init__(message)
		self.message = message
		self.status_code = status_code
		self.model = model


class ModelRateLimitError(ModelProviderError):
	"""Exception raised when a model provider returns a rate limit error."""

	def __init__(
		self,
		message: str,
		status_code: int = 429,
		model: str | None = None,
	):
		super().__init__(message, status_code, model)

```

---

## backend/browser-use/browser_use/llm/google/__init__.py

```py
from browser_use.llm.google.chat import ChatGoogle

__all__ = ['ChatGoogle']

```

---

## backend/browser-use/browser_use/llm/google/chat.py

```py
import asyncio
import json
import logging
import random
import time
from dataclasses import dataclass, field
from typing import Any, Literal, TypeVar, overload

from google import genai
from google.auth.credentials import Credentials
from google.genai import types
from google.genai.types import MediaModality
from pydantic import BaseModel

from browser_use.llm.base import BaseChatModel
from browser_use.llm.exceptions import ModelProviderError
from browser_use.llm.google.serializer import GoogleMessageSerializer
from browser_use.llm.messages import BaseMessage
from browser_use.llm.schema import SchemaOptimizer
from browser_use.llm.views import ChatInvokeCompletion, ChatInvokeUsage

T = TypeVar('T', bound=BaseModel)


VerifiedGeminiModels = Literal[
	'gemini-2.0-flash',
	'gemini-2.0-flash-exp',
	'gemini-2.0-flash-lite-preview-02-05',
	'Gemini-2.0-exp',
	'gemini-2.5-flash',
	'gemini-2.5-flash-lite',
	'gemini-flash-latest',
	'gemini-flash-lite-latest',
	'gemini-2.5-pro',
	'gemma-3-27b-it',
	'gemma-3-4b',
	'gemma-3-12b',
	'gemma-3n-e2b',
	'gemma-3n-e4b',
]


@dataclass
class ChatGoogle(BaseChatModel):
	"""
	A wrapper around Google's Gemini chat model using the genai client.

	This class accepts all genai.Client parameters while adding model,
	temperature, and config parameters for the LLM interface.

	Args:
		model: The Gemini model to use
		temperature: Temperature for response generation
		config: Additional configuration parameters to pass to generate_content
			(e.g., tools, safety_settings, etc.).
		api_key: Google API key
		vertexai: Whether to use Vertex AI
		credentials: Google credentials object
		project: Google Cloud project ID
		location: Google Cloud location
		http_options: HTTP options for the client
		include_system_in_user: If True, system messages are included in the first user message
		supports_structured_output: If True, uses native JSON mode; if False, uses prompt-based fallback
		max_retries: Number of retries for retryable errors (default: 5)
		retryable_status_codes: List of HTTP status codes to retry on (default: [429, 500, 502, 503, 504])
		retry_base_delay: Base delay in seconds for exponential backoff (default: 1.0)
		retry_max_delay: Maximum delay in seconds between retries (default: 60.0)

	Example:
		from google.genai import types

		llm = ChatGoogle(
			model='gemini-2.0-flash-exp',
			config={
				'tools': [types.Tool(code_execution=types.ToolCodeExecution())]
			},
			max_retries=5,
			retryable_status_codes=[429, 500, 502, 503, 504],
			retry_base_delay=1.0,
			retry_max_delay=60.0,
		)
	"""

	# Model configuration
	model: VerifiedGeminiModels | str
	temperature: float | None = 0.5
	top_p: float | None = None
	seed: int | None = None
	thinking_budget: int | None = None  # for gemini-2.5 flash and flash-lite models, default will be set to 0
	max_output_tokens: int | None = 8096
	config: types.GenerateContentConfigDict | None = None
	include_system_in_user: bool = False
	supports_structured_output: bool = True  # New flag
	max_retries: int = 5  # Number of retries for retryable errors
	retryable_status_codes: list[int] = field(default_factory=lambda: [429, 500, 502, 503, 504])  # Status codes to retry on
	retry_base_delay: float = 1.0  # Base delay in seconds for exponential backoff
	retry_max_delay: float = 60.0  # Maximum delay in seconds between retries

	# Client initialization parameters
	api_key: str | None = None
	vertexai: bool | None = None
	credentials: Credentials | None = None
	project: str | None = None
	location: str | None = None
	http_options: types.HttpOptions | types.HttpOptionsDict | None = None

	# Internal client cache to prevent connection issues
	_client: genai.Client | None = None

	# Static
	@property
	def provider(self) -> str:
		return 'google'

	@property
	def logger(self) -> logging.Logger:
		"""Get logger for this chat instance"""
		return logging.getLogger(f'browser_use.llm.google.{self.model}')

	def _get_client_params(self) -> dict[str, Any]:
		"""Prepare client parameters dictionary."""
		# Define base client params
		base_params = {
			'api_key': self.api_key,
			'vertexai': self.vertexai,
			'credentials': self.credentials,
			'project': self.project,
			'location': self.location,
			'http_options': self.http_options,
		}

		# Create client_params dict with non-None values
		client_params = {k: v for k, v in base_params.items() if v is not None}

		return client_params

	def get_client(self) -> genai.Client:
		"""
		Returns a genai.Client instance.

		Returns:
			genai.Client: An instance of the Google genai client.
		"""
		if self._client is not None:
			return self._client

		client_params = self._get_client_params()
		self._client = genai.Client(**client_params)
		return self._client

	@property
	def name(self) -> str:
		return str(self.model)

	def _get_stop_reason(self, response: types.GenerateContentResponse) -> str | None:
		"""Extract stop_reason from Google response."""
		if hasattr(response, 'candidates') and response.candidates:
			return str(response.candidates[0].finish_reason) if hasattr(response.candidates[0], 'finish_reason') else None
		return None

	def _get_usage(self, response: types.GenerateContentResponse) -> ChatInvokeUsage | None:
		usage: ChatInvokeUsage | None = None

		if response.usage_metadata is not None:
			image_tokens = 0
			if response.usage_metadata.prompt_tokens_details is not None:
				image_tokens = sum(
					detail.token_count or 0
					for detail in response.usage_metadata.prompt_tokens_details
					if detail.modality == MediaModality.IMAGE
				)

			usage = ChatInvokeUsage(
				prompt_tokens=response.usage_metadata.prompt_token_count or 0,
				completion_tokens=(response.usage_metadata.candidates_token_count or 0)
				+ (response.usage_metadata.thoughts_token_count or 0),
				total_tokens=response.usage_metadata.total_token_count or 0,
				prompt_cached_tokens=response.usage_metadata.cached_content_token_count,
				prompt_cache_creation_tokens=None,
				prompt_image_tokens=image_tokens,
			)

		return usage

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: None = None) -> ChatInvokeCompletion[str]: ...

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: type[T]) -> ChatInvokeCompletion[T]: ...

	async def ainvoke(
		self, messages: list[BaseMessage], output_format: type[T] | None = None
	) -> ChatInvokeCompletion[T] | ChatInvokeCompletion[str]:
		"""
		Invoke the model with the given messages.

		Args:
			messages: List of chat messages
			output_format: Optional Pydantic model class for structured output

		Returns:
			Either a string response or an instance of output_format
		"""

		# Serialize messages to Google format with the include_system_in_user flag
		contents, system_instruction = GoogleMessageSerializer.serialize_messages(
			messages, include_system_in_user=self.include_system_in_user
		)

		# Build config dictionary starting with user-provided config
		config: types.GenerateContentConfigDict = {}
		if self.config:
			config = self.config.copy()

		# Apply model-specific configuration (these can override config)
		if self.temperature is not None:
			config['temperature'] = self.temperature

		# Add system instruction if present
		if system_instruction:
			config['system_instruction'] = system_instruction

		if self.top_p is not None:
			config['top_p'] = self.top_p

		if self.seed is not None:
			config['seed'] = self.seed

		# set default for flash, flash-lite, gemini-flash-lite-latest, and gemini-flash-latest models
		if self.thinking_budget is None and ('gemini-2.5-flash' in self.model or 'gemini-flash' in self.model):
			self.thinking_budget = 0

		if self.thinking_budget is not None:
			thinking_config_dict: types.ThinkingConfigDict = {'thinking_budget': self.thinking_budget}
			config['thinking_config'] = thinking_config_dict

		if self.max_output_tokens is not None:
			config['max_output_tokens'] = self.max_output_tokens

		async def _make_api_call():
			start_time = time.time()
			self.logger.debug(f'🚀 Starting API call to {self.model}')

			try:
				if output_format is None:
					# Return string response
					self.logger.debug('📄 Requesting text response')

					response = await self.get_client().aio.models.generate_content(
						model=self.model,
						contents=contents,  # type: ignore
						config=config,
					)

					elapsed = time.time() - start_time
					self.logger.debug(f'✅ Got text response in {elapsed:.2f}s')

					# Handle case where response.text might be None
					text = response.text or ''
					if not text:
						self.logger.warning('⚠️ Empty text response received')

					usage = self._get_usage(response)

					return ChatInvokeCompletion(
						completion=text,
						usage=usage,
						stop_reason=self._get_stop_reason(response),
					)

				else:
					# Handle structured output
					if self.supports_structured_output:
						# Use native JSON mode
						self.logger.debug(f'🔧 Requesting structured output for {output_format.__name__}')
						config['response_mime_type'] = 'application/json'
						# Convert Pydantic model to Gemini-compatible schema
						optimized_schema = SchemaOptimizer.create_gemini_optimized_schema(output_format)

						gemini_schema = self._fix_gemini_schema(optimized_schema)
						config['response_schema'] = gemini_schema

						response = await self.get_client().aio.models.generate_content(
							model=self.model,
							contents=contents,
							config=config,
						)

						elapsed = time.time() - start_time
						self.logger.debug(f'✅ Got structured response in {elapsed:.2f}s')

						usage = self._get_usage(response)

						# Handle case where response.parsed might be None
						if response.parsed is None:
							self.logger.debug('📝 Parsing JSON from text response')
							# When using response_schema, Gemini returns JSON as text
							if response.text:
								try:
									# Handle JSON wrapped in markdown code blocks (common Gemini behavior)
									text = response.text.strip()
									if text.startswith('``\`json') and text.endswith('``\`'):
										text = text[7:-3].strip()
										self.logger.debug('🔧 Stripped ``\`json``\` wrapper from response')
									elif text.startswith('``\`') and text.endswith('``\`'):
										text = text[3:-3].strip()
										self.logger.debug('🔧 Stripped ``\` wrapper from response')

									# Parse the JSON text and validate with the Pydantic model
									parsed_data = json.loads(text)
									return ChatInvokeCompletion(
										completion=output_format.model_validate(parsed_data),
										usage=usage,
										stop_reason=self._get_stop_reason(response),
									)
								except (json.JSONDecodeError, ValueError) as e:
									self.logger.error(f'❌ Failed to parse JSON response: {str(e)}')
									self.logger.debug(f'Raw response text: {response.text[:200]}...')
									raise ModelProviderError(
										message=f'Failed to parse or validate response {response}: {str(e)}',
										status_code=500,
										model=self.model,
									) from e
							else:
								self.logger.error('❌ No response text received')
								raise ModelProviderError(
									message=f'No response from model {response}',
									status_code=500,
									model=self.model,
								)

						# Ensure we return the correct type
						if isinstance(response.parsed, output_format):
							return ChatInvokeCompletion(
								completion=response.parsed,
								usage=usage,
								stop_reason=self._get_stop_reason(response),
							)
						else:
							# If it's not the expected type, try to validate it
							return ChatInvokeCompletion(
								completion=output_format.model_validate(response.parsed),
								usage=usage,
								stop_reason=self._get_stop_reason(response),
							)
					else:
						# Fallback: Request JSON in the prompt for models without native JSON mode
						self.logger.debug(f'🔄 Using fallback JSON mode for {output_format.__name__}')
						# Create a copy of messages to modify
						modified_messages = [m.model_copy(deep=True) for m in messages]

						# Add JSON instruction to the last message
						if modified_messages and isinstance(modified_messages[-1].content, str):
							json_instruction = f'\n\nPlease respond with a valid JSON object that matches this schema: {SchemaOptimizer.create_optimized_json_schema(output_format)}'
							modified_messages[-1].content += json_instruction

						# Re-serialize with modified messages
						fallback_contents, fallback_system = GoogleMessageSerializer.serialize_messages(
							modified_messages, include_system_in_user=self.include_system_in_user
						)

						# Update config with fallback system instruction if present
						fallback_config = config.copy()
						if fallback_system:
							fallback_config['system_instruction'] = fallback_system

						response = await self.get_client().aio.models.generate_content(
							model=self.model,
							contents=fallback_contents,  # type: ignore
							config=fallback_config,
						)

						elapsed = time.time() - start_time
						self.logger.debug(f'✅ Got fallback response in {elapsed:.2f}s')

						usage = self._get_usage(response)

						# Try to extract JSON from the text response
						if response.text:
							try:
								# Try to find JSON in the response
								text = response.text.strip()

								# Common patterns: JSON wrapped in markdown code blocks
								if text.startswith('``\`json') and text.endswith('``\`'):
									text = text[7:-3].strip()
								elif text.startswith('``\`') and text.endswith('``\`'):
									text = text[3:-3].strip()

								# Parse and validate
								parsed_data = json.loads(text)
								return ChatInvokeCompletion(
									completion=output_format.model_validate(parsed_data),
									usage=usage,
									stop_reason=self._get_stop_reason(response),
								)
							except (json.JSONDecodeError, ValueError) as e:
								self.logger.error(f'❌ Failed to parse fallback JSON: {str(e)}')
								self.logger.debug(f'Raw response text: {response.text[:200]}...')
								raise ModelProviderError(
									message=f'Model does not support JSON mode and failed to parse JSON from text response: {str(e)}',
									status_code=500,
									model=self.model,
								) from e
						else:
							self.logger.error('❌ No response text in fallback mode')
							raise ModelProviderError(
								message='No response from model',
								status_code=500,
								model=self.model,
							)
			except Exception as e:
				elapsed = time.time() - start_time
				self.logger.error(f'💥 API call failed after {elapsed:.2f}s: {type(e).__name__}: {e}')
				# Re-raise the exception
				raise

		# Retry logic for certain errors with exponential backoff
		assert self.max_retries >= 1, 'max_retries must be at least 1'

		for attempt in range(self.max_retries):
			try:
				return await _make_api_call()
			except ModelProviderError as e:
				# Retry if status code is in retryable list and we have attempts left
				if e.status_code in self.retryable_status_codes and attempt < self.max_retries - 1:
					# Exponential backoff with jitter: base_delay * 2^attempt + random jitter
					delay = min(self.retry_base_delay * (2**attempt), self.retry_max_delay)
					jitter = random.uniform(0, delay * 0.1)  # 10% jitter
					total_delay = delay + jitter
					self.logger.warning(
						f'⚠️ Got {e.status_code} error, retrying in {total_delay:.1f}s... (attempt {attempt + 1}/{self.max_retries})'
					)
					await asyncio.sleep(total_delay)
					continue
				# Otherwise raise
				raise
			except Exception as e:
				# For non-ModelProviderError, wrap and raise
				error_message = str(e)
				status_code: int | None = None

				# Try to extract status code if available
				if hasattr(e, 'response'):
					response_obj = getattr(e, 'response', None)
					if response_obj and hasattr(response_obj, 'status_code'):
						status_code = getattr(response_obj, 'status_code', None)

				# Enhanced timeout error handling
				if 'timeout' in error_message.lower() or 'cancelled' in error_message.lower():
					if isinstance(e, asyncio.CancelledError) or 'CancelledError' in str(type(e)):
						error_message = 'Gemini API request was cancelled (likely timeout). Consider: 1) Reducing input size, 2) Using a different model, 3) Checking network connectivity.'
						status_code = 504
					else:
						status_code = 408
				elif any(indicator in error_message.lower() for indicator in ['forbidden', '403']):
					status_code = 403
				elif any(
					indicator in error_message.lower()
					for indicator in ['rate limit', 'resource exhausted', 'quota exceeded', 'too many requests', '429']
				):
					status_code = 429
				elif any(
					indicator in error_message.lower()
					for indicator in ['service unavailable', 'internal server error', 'bad gateway', '503', '502', '500']
				):
					status_code = 503

				raise ModelProviderError(
					message=error_message,
					status_code=status_code or 502,
					model=self.name,
				) from e

		raise RuntimeError('Retry loop completed without return or exception')

	def _fix_gemini_schema(self, schema: dict[str, Any]) -> dict[str, Any]:
		"""
		Convert a Pydantic model to a Gemini-compatible schema.

		This function removes unsupported properties like 'additionalProperties' and resolves
		$ref references that Gemini doesn't support.
		"""

		# Handle $defs and $ref resolution
		if '$defs' in schema:
			defs = schema.pop('$defs')

			def resolve_refs(obj: Any) -> Any:
				if isinstance(obj, dict):
					if '$ref' in obj:
						ref = obj.pop('$ref')
						ref_name = ref.split('/')[-1]
						if ref_name in defs:
							# Replace the reference with the actual definition
							resolved = defs[ref_name].copy()
							# Merge any additional properties from the reference
							for key, value in obj.items():
								if key != '$ref':
									resolved[key] = value
							return resolve_refs(resolved)
						return obj
					else:
						# Recursively process all dictionary values
						return {k: resolve_refs(v) for k, v in obj.items()}
				elif isinstance(obj, list):
					return [resolve_refs(item) for item in obj]
				return obj

			schema = resolve_refs(schema)

		# Remove unsupported properties
		def clean_schema(obj: Any, parent_key: str | None = None) -> Any:
			if isinstance(obj, dict):
				# Remove unsupported properties
				cleaned = {}
				for key, value in obj.items():
					# Only strip 'title' when it's a JSON Schema metadata field (not inside 'properties')
					# 'title' as a metadata field appears at schema level, not as a property name
					is_metadata_title = key == 'title' and parent_key != 'properties'
					if key not in ['additionalProperties', 'default'] and not is_metadata_title:
						cleaned_value = clean_schema(value, parent_key=key)
						# Handle empty object properties - Gemini doesn't allow empty OBJECT types
						if (
							key == 'properties'
							and isinstance(cleaned_value, dict)
							and len(cleaned_value) == 0
							and isinstance(obj.get('type', ''), str)
							and obj.get('type', '').upper() == 'OBJECT'
						):
							# Convert empty object to have at least one property
							cleaned['properties'] = {'_placeholder': {'type': 'string'}}
						else:
							cleaned[key] = cleaned_value

				# If this is an object type with empty properties, add a placeholder
				if (
					isinstance(cleaned.get('type', ''), str)
					and cleaned.get('type', '').upper() == 'OBJECT'
					and 'properties' in cleaned
					and isinstance(cleaned['properties'], dict)
					and len(cleaned['properties']) == 0
				):
					cleaned['properties'] = {'_placeholder': {'type': 'string'}}

				return cleaned
			elif isinstance(obj, list):
				return [clean_schema(item, parent_key=parent_key) for item in obj]
			return obj

		return clean_schema(schema)

```

---

## backend/browser-use/browser_use/llm/google/serializer.py

```py
import base64

from google.genai.types import Content, ContentListUnion, Part

from browser_use.llm.messages import (
	AssistantMessage,
	BaseMessage,
	SystemMessage,
	UserMessage,
)


class GoogleMessageSerializer:
	"""Serializer for converting messages to Google Gemini format."""

	@staticmethod
	def serialize_messages(
		messages: list[BaseMessage], include_system_in_user: bool = False
	) -> tuple[ContentListUnion, str | None]:
		"""
		Convert a list of BaseMessages to Google format, extracting system message.

		Google handles system instructions separately from the conversation, so we need to:
		1. Extract any system messages and return them separately as a string (or include in first user message if flag is set)
		2. Convert the remaining messages to Content objects

		Args:
		    messages: List of messages to convert
		    include_system_in_user: If True, system/developer messages are prepended to the first user message

		Returns:
		    A tuple of (formatted_messages, system_message) where:
		    - formatted_messages: List of Content objects for the conversation
		    - system_message: System instruction string or None
		"""

		messages = [m.model_copy(deep=True) for m in messages]

		formatted_messages: ContentListUnion = []
		system_message: str | None = None
		system_parts: list[str] = []

		for i, message in enumerate(messages):
			role = message.role if hasattr(message, 'role') else None

			# Handle system/developer messages
			if isinstance(message, SystemMessage) or role in ['system', 'developer']:
				# Extract system message content as string
				if isinstance(message.content, str):
					if include_system_in_user:
						system_parts.append(message.content)
					else:
						system_message = message.content
				elif message.content is not None:
					# Handle Iterable of content parts
					parts = []
					for part in message.content:
						if part.type == 'text':
							parts.append(part.text)
					combined_text = '\n'.join(parts)
					if include_system_in_user:
						system_parts.append(combined_text)
					else:
						system_message = combined_text
				continue

			# Determine the role for non-system messages
			if isinstance(message, UserMessage):
				role = 'user'
			elif isinstance(message, AssistantMessage):
				role = 'model'
			else:
				# Default to user for any unknown message types
				role = 'user'

			# Initialize message parts
			message_parts: list[Part] = []

			# If this is the first user message and we have system parts, prepend them
			if include_system_in_user and system_parts and role == 'user' and not formatted_messages:
				system_text = '\n\n'.join(system_parts)
				if isinstance(message.content, str):
					message_parts.append(Part.from_text(text=f'{system_text}\n\n{message.content}'))
				else:
					# Add system text as the first part
					message_parts.append(Part.from_text(text=system_text))
				system_parts = []  # Clear after using
			else:
				# Extract content and create parts normally
				if isinstance(message.content, str):
					# Regular text content
					message_parts = [Part.from_text(text=message.content)]
				elif message.content is not None:
					# Handle Iterable of content parts
					for part in message.content:
						if part.type == 'text':
							message_parts.append(Part.from_text(text=part.text))
						elif part.type == 'refusal':
							message_parts.append(Part.from_text(text=f'[Refusal] {part.refusal}'))
						elif part.type == 'image_url':
							# Handle images
							url = part.image_url.url

							# Format: data:image/jpeg;base64,<data>
							header, data = url.split(',', 1)
							# Decode base64 to bytes
							image_bytes = base64.b64decode(data)

							# Add image part
							image_part = Part.from_bytes(data=image_bytes, mime_type='image/jpeg')

							message_parts.append(image_part)

			# Create the Content object
			if message_parts:
				final_message = Content(role=role, parts=message_parts)
				# for some reason, the type checker is not able to infer the type of formatted_messages
				formatted_messages.append(final_message)  # type: ignore

		return formatted_messages, system_message

```

---

## backend/browser-use/browser_use/llm/groq/chat.py

```py
import logging
from dataclasses import dataclass
from typing import Literal, TypeVar, overload

from groq import (
	APIError,
	APIResponseValidationError,
	APIStatusError,
	AsyncGroq,
	NotGiven,
	RateLimitError,
	Timeout,
)
from groq.types.chat import ChatCompletion, ChatCompletionToolChoiceOptionParam, ChatCompletionToolParam
from groq.types.chat.completion_create_params import (
	ResponseFormatResponseFormatJsonSchema,
	ResponseFormatResponseFormatJsonSchemaJsonSchema,
)
from httpx import URL
from pydantic import BaseModel

from browser_use.llm.base import BaseChatModel, ChatInvokeCompletion
from browser_use.llm.exceptions import ModelProviderError, ModelRateLimitError
from browser_use.llm.groq.parser import try_parse_groq_failed_generation
from browser_use.llm.groq.serializer import GroqMessageSerializer
from browser_use.llm.messages import BaseMessage
from browser_use.llm.schema import SchemaOptimizer
from browser_use.llm.views import ChatInvokeUsage

GroqVerifiedModels = Literal[
	'meta-llama/llama-4-maverick-17b-128e-instruct',
	'meta-llama/llama-4-scout-17b-16e-instruct',
	'qwen/qwen3-32b',
	'moonshotai/kimi-k2-instruct',
	'openai/gpt-oss-20b',
	'openai/gpt-oss-120b',
]

JsonSchemaModels = [
	'meta-llama/llama-4-maverick-17b-128e-instruct',
	'meta-llama/llama-4-scout-17b-16e-instruct',
	'openai/gpt-oss-20b',
	'openai/gpt-oss-120b',
]

ToolCallingModels = [
	'moonshotai/kimi-k2-instruct',
]

T = TypeVar('T', bound=BaseModel)

logger = logging.getLogger(__name__)


@dataclass
class ChatGroq(BaseChatModel):
	"""
	A wrapper around AsyncGroq that implements the BaseLLM protocol.
	"""

	# Model configuration
	model: GroqVerifiedModels | str

	# Model params
	temperature: float | None = None
	service_tier: Literal['auto', 'on_demand', 'flex'] | None = None
	top_p: float | None = None
	seed: int | None = None

	# Client initialization parameters
	api_key: str | None = None
	base_url: str | URL | None = None
	timeout: float | Timeout | NotGiven | None = None
	max_retries: int = 10  # Increase default retries for automation reliability

	def get_client(self) -> AsyncGroq:
		return AsyncGroq(api_key=self.api_key, base_url=self.base_url, timeout=self.timeout, max_retries=self.max_retries)

	@property
	def provider(self) -> str:
		return 'groq'

	@property
	def name(self) -> str:
		return str(self.model)

	def _get_usage(self, response: ChatCompletion) -> ChatInvokeUsage | None:
		usage = (
			ChatInvokeUsage(
				prompt_tokens=response.usage.prompt_tokens,
				completion_tokens=response.usage.completion_tokens,
				total_tokens=response.usage.total_tokens,
				prompt_cached_tokens=None,  # Groq doesn't support cached tokens
				prompt_cache_creation_tokens=None,
				prompt_image_tokens=None,
			)
			if response.usage is not None
			else None
		)
		return usage

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: None = None) -> ChatInvokeCompletion[str]: ...

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: type[T]) -> ChatInvokeCompletion[T]: ...

	async def ainvoke(
		self, messages: list[BaseMessage], output_format: type[T] | None = None
	) -> ChatInvokeCompletion[T] | ChatInvokeCompletion[str]:
		groq_messages = GroqMessageSerializer.serialize_messages(messages)

		try:
			if output_format is None:
				return await self._invoke_regular_completion(groq_messages)
			else:
				return await self._invoke_structured_output(groq_messages, output_format)

		except RateLimitError as e:
			raise ModelRateLimitError(message=e.response.text, status_code=e.response.status_code, model=self.name) from e

		except APIResponseValidationError as e:
			raise ModelProviderError(message=e.response.text, status_code=e.response.status_code, model=self.name) from e

		except APIStatusError as e:
			if output_format is None:
				raise ModelProviderError(message=e.response.text, status_code=e.response.status_code, model=self.name) from e
			else:
				try:
					logger.debug(f'Groq failed generation: {e.response.text}; fallback to manual parsing')

					parsed_response = try_parse_groq_failed_generation(e, output_format)

					logger.debug('Manual error parsing successful ✅')

					return ChatInvokeCompletion(
						completion=parsed_response,
						usage=None,  # because this is a hacky way to get the outputs
						# TODO: @groq needs to fix their parsers and validators
					)
				except Exception as _:
					raise ModelProviderError(message=str(e), status_code=e.response.status_code, model=self.name) from e

		except APIError as e:
			raise ModelProviderError(message=e.message, model=self.name) from e
		except Exception as e:
			raise ModelProviderError(message=str(e), model=self.name) from e

	async def _invoke_regular_completion(self, groq_messages) -> ChatInvokeCompletion[str]:
		"""Handle regular completion without structured output."""
		chat_completion = await self.get_client().chat.completions.create(
			messages=groq_messages,
			model=self.model,
			service_tier=self.service_tier,
			temperature=self.temperature,
			top_p=self.top_p,
			seed=self.seed,
		)
		usage = self._get_usage(chat_completion)
		return ChatInvokeCompletion(
			completion=chat_completion.choices[0].message.content or '',
			usage=usage,
		)

	async def _invoke_structured_output(self, groq_messages, output_format: type[T]) -> ChatInvokeCompletion[T]:
		"""Handle structured output using either tool calling or JSON schema."""
		schema = SchemaOptimizer.create_optimized_json_schema(output_format)

		if self.model in ToolCallingModels:
			response = await self._invoke_with_tool_calling(groq_messages, output_format, schema)
		else:
			response = await self._invoke_with_json_schema(groq_messages, output_format, schema)

		if not response.choices[0].message.content:
			raise ModelProviderError(
				message='No content in response',
				status_code=500,
				model=self.name,
			)

		parsed_response = output_format.model_validate_json(response.choices[0].message.content)
		usage = self._get_usage(response)

		return ChatInvokeCompletion(
			completion=parsed_response,
			usage=usage,
		)

	async def _invoke_with_tool_calling(self, groq_messages, output_format: type[T], schema) -> ChatCompletion:
		"""Handle structured output using tool calling."""
		tool = ChatCompletionToolParam(
			function={
				'name': output_format.__name__,
				'description': f'Extract information in the format of {output_format.__name__}',
				'parameters': schema,
			},
			type='function',
		)
		tool_choice: ChatCompletionToolChoiceOptionParam = 'required'

		return await self.get_client().chat.completions.create(
			model=self.model,
			messages=groq_messages,
			temperature=self.temperature,
			top_p=self.top_p,
			seed=self.seed,
			tools=[tool],
			tool_choice=tool_choice,
			service_tier=self.service_tier,
		)

	async def _invoke_with_json_schema(self, groq_messages, output_format: type[T], schema) -> ChatCompletion:
		"""Handle structured output using JSON schema."""
		return await self.get_client().chat.completions.create(
			model=self.model,
			messages=groq_messages,
			temperature=self.temperature,
			top_p=self.top_p,
			seed=self.seed,
			response_format=ResponseFormatResponseFormatJsonSchema(
				json_schema=ResponseFormatResponseFormatJsonSchemaJsonSchema(
					name=output_format.__name__,
					description='Model output schema',
					schema=schema,
				),
				type='json_schema',
			),
			service_tier=self.service_tier,
		)

```

---

## backend/browser-use/browser_use/llm/groq/parser.py

```py
import json
import logging
import re
from typing import TypeVar

from groq import APIStatusError
from pydantic import BaseModel

logger = logging.getLogger(__name__)

T = TypeVar('T', bound=BaseModel)


class ParseFailedGenerationError(Exception):
	pass


def try_parse_groq_failed_generation(
	error: APIStatusError,
	output_format: type[T],
) -> T:
	"""Extract JSON from model output, handling both plain JSON and code-block-wrapped JSON."""
	try:
		content = error.body['error']['failed_generation']  # type: ignore

		# If content is wrapped in code blocks, extract just the JSON part
		if '``\`' in content:
			# Find the JSON content between code blocks
			content = content.split('``\`')[1]
			# Remove language identifier if present (e.g., 'json\n')
			if '\n' in content:
				content = content.split('\n', 1)[1]

		# remove html-like tags before the first { and after the last }
		# This handles cases like <|header_start|>assistant<|header_end|> and <function=AgentOutput>
		# Only remove content before { if content doesn't already start with {
		if not content.strip().startswith('{'):
			content = re.sub(r'^.*?(?=\{)', '', content, flags=re.DOTALL)

		# Remove common HTML-like tags and patterns at the end, but be more conservative
		# Look for patterns like </function>, <|header_start|>, etc. after the JSON
		content = re.sub(r'\}(\s*<[^>]*>.*?$)', '}', content, flags=re.DOTALL)
		content = re.sub(r'\}(\s*<\|[^|]*\|>.*?$)', '}', content, flags=re.DOTALL)

		# Handle extra characters after the JSON, including stray braces
		# Find the position of the last } that would close the main JSON object
		content = content.strip()

		if content.endswith('}'):
			# Try to parse and see if we get valid JSON
			try:
				json.loads(content)
			except json.JSONDecodeError:
				# If parsing fails, try to find the correct end of the JSON
				# by counting braces and removing anything after the balanced JSON
				brace_count = 0
				last_valid_pos = -1
				for i, char in enumerate(content):
					if char == '{':
						brace_count += 1
					elif char == '}':
						brace_count -= 1
						if brace_count == 0:
							last_valid_pos = i + 1
							break

				if last_valid_pos > 0:
					content = content[:last_valid_pos]

		# Fix control characters in JSON strings before parsing
		# This handles cases where literal control characters appear in JSON values
		content = _fix_control_characters_in_json(content)

		# Parse the cleaned content
		result_dict = json.loads(content)

		# some models occasionally respond with a list containing one dict: https://github.com/browser-use/browser-use/issues/1458
		if isinstance(result_dict, list) and len(result_dict) == 1 and isinstance(result_dict[0], dict):
			result_dict = result_dict[0]

		logger.debug(f'Successfully parsed model output: {result_dict}')
		return output_format.model_validate(result_dict)

	except KeyError as e:
		raise ParseFailedGenerationError(e) from e

	except json.JSONDecodeError as e:
		logger.warning(f'Failed to parse model output: {content} {str(e)}')
		raise ValueError(f'Could not parse response. {str(e)}')

	except Exception as e:
		raise ParseFailedGenerationError(error.response.text) from e


def _fix_control_characters_in_json(content: str) -> str:
	"""Fix control characters in JSON string values to make them valid JSON."""
	try:
		# First try to parse as-is to see if it's already valid
		json.loads(content)
		return content
	except json.JSONDecodeError:
		pass

	# More sophisticated approach: only escape control characters inside string values
	# while preserving JSON structure formatting

	result = []
	i = 0
	in_string = False
	escaped = False

	while i < len(content):
		char = content[i]

		if not in_string:
			# Outside of string - check if we're entering a string
			if char == '"':
				in_string = True
			result.append(char)
		else:
			# Inside string - handle escaping and control characters
			if escaped:
				# Previous character was backslash, so this character is escaped
				result.append(char)
				escaped = False
			elif char == '\\':
				# This is an escape character
				result.append(char)
				escaped = True
			elif char == '"':
				# End of string
				result.append(char)
				in_string = False
			elif char == '\n':
				# Literal newline inside string - escape it
				result.append('\\n')
			elif char == '\r':
				# Literal carriage return inside string - escape it
				result.append('\\r')
			elif char == '\t':
				# Literal tab inside string - escape it
				result.append('\\t')
			elif char == '\b':
				# Literal backspace inside string - escape it
				result.append('\\b')
			elif char == '\f':
				# Literal form feed inside string - escape it
				result.append('\\f')
			elif ord(char) < 32:
				# Other control characters inside string - convert to unicode escape
				result.append(f'\\u{ord(char):04x}')
			else:
				# Normal character inside string
				result.append(char)

		i += 1

	return ''.join(result)

```

---

## backend/browser-use/browser_use/llm/groq/serializer.py

```py
from typing import overload

from groq.types.chat import (
	ChatCompletionAssistantMessageParam,
	ChatCompletionContentPartImageParam,
	ChatCompletionContentPartTextParam,
	ChatCompletionMessageParam,
	ChatCompletionMessageToolCallParam,
	ChatCompletionSystemMessageParam,
	ChatCompletionUserMessageParam,
)
from groq.types.chat.chat_completion_content_part_image_param import ImageURL
from groq.types.chat.chat_completion_message_tool_call_param import Function

from browser_use.llm.messages import (
	AssistantMessage,
	BaseMessage,
	ContentPartImageParam,
	ContentPartRefusalParam,
	ContentPartTextParam,
	SystemMessage,
	ToolCall,
	UserMessage,
)


class GroqMessageSerializer:
	"""Serializer for converting between custom message types and OpenAI message param types."""

	@staticmethod
	def _serialize_content_part_text(part: ContentPartTextParam) -> ChatCompletionContentPartTextParam:
		return ChatCompletionContentPartTextParam(text=part.text, type='text')

	@staticmethod
	def _serialize_content_part_image(part: ContentPartImageParam) -> ChatCompletionContentPartImageParam:
		return ChatCompletionContentPartImageParam(
			image_url=ImageURL(url=part.image_url.url, detail=part.image_url.detail),
			type='image_url',
		)

	@staticmethod
	def _serialize_user_content(
		content: str | list[ContentPartTextParam | ContentPartImageParam],
	) -> str | list[ChatCompletionContentPartTextParam | ChatCompletionContentPartImageParam]:
		"""Serialize content for user messages (text and images allowed)."""
		if isinstance(content, str):
			return content

		serialized_parts: list[ChatCompletionContentPartTextParam | ChatCompletionContentPartImageParam] = []
		for part in content:
			if part.type == 'text':
				serialized_parts.append(GroqMessageSerializer._serialize_content_part_text(part))
			elif part.type == 'image_url':
				serialized_parts.append(GroqMessageSerializer._serialize_content_part_image(part))
		return serialized_parts

	@staticmethod
	def _serialize_system_content(
		content: str | list[ContentPartTextParam],
	) -> str:
		"""Serialize content for system messages (text only)."""
		if isinstance(content, str):
			return content

		serialized_parts: list[str] = []
		for part in content:
			if part.type == 'text':
				serialized_parts.append(GroqMessageSerializer._serialize_content_part_text(part)['text'])

		return '\n'.join(serialized_parts)

	@staticmethod
	def _serialize_assistant_content(
		content: str | list[ContentPartTextParam | ContentPartRefusalParam] | None,
	) -> str | None:
		"""Serialize content for assistant messages (text and refusal allowed)."""
		if content is None:
			return None
		if isinstance(content, str):
			return content

		serialized_parts: list[str] = []
		for part in content:
			if part.type == 'text':
				serialized_parts.append(GroqMessageSerializer._serialize_content_part_text(part)['text'])

		return '\n'.join(serialized_parts)

	@staticmethod
	def _serialize_tool_call(tool_call: ToolCall) -> ChatCompletionMessageToolCallParam:
		return ChatCompletionMessageToolCallParam(
			id=tool_call.id,
			function=Function(name=tool_call.function.name, arguments=tool_call.function.arguments),
			type='function',
		)

	# endregion

	# region - Serialize overloads
	@overload
	@staticmethod
	def serialize(message: UserMessage) -> ChatCompletionUserMessageParam: ...

	@overload
	@staticmethod
	def serialize(message: SystemMessage) -> ChatCompletionSystemMessageParam: ...

	@overload
	@staticmethod
	def serialize(message: AssistantMessage) -> ChatCompletionAssistantMessageParam: ...

	@staticmethod
	def serialize(message: BaseMessage) -> ChatCompletionMessageParam:
		"""Serialize a custom message to an OpenAI message param."""

		if isinstance(message, UserMessage):
			user_result: ChatCompletionUserMessageParam = {
				'role': 'user',
				'content': GroqMessageSerializer._serialize_user_content(message.content),
			}
			if message.name is not None:
				user_result['name'] = message.name
			return user_result

		elif isinstance(message, SystemMessage):
			system_result: ChatCompletionSystemMessageParam = {
				'role': 'system',
				'content': GroqMessageSerializer._serialize_system_content(message.content),
			}
			if message.name is not None:
				system_result['name'] = message.name
			return system_result

		elif isinstance(message, AssistantMessage):
			# Handle content serialization
			content = None
			if message.content is not None:
				content = GroqMessageSerializer._serialize_assistant_content(message.content)

			assistant_result: ChatCompletionAssistantMessageParam = {'role': 'assistant'}

			# Only add content if it's not None
			if content is not None:
				assistant_result['content'] = content

			if message.name is not None:
				assistant_result['name'] = message.name

			if message.tool_calls:
				assistant_result['tool_calls'] = [GroqMessageSerializer._serialize_tool_call(tc) for tc in message.tool_calls]

			return assistant_result

		else:
			raise ValueError(f'Unknown message type: {type(message)}')

	@staticmethod
	def serialize_messages(messages: list[BaseMessage]) -> list[ChatCompletionMessageParam]:
		return [GroqMessageSerializer.serialize(m) for m in messages]

```

---

## backend/browser-use/browser_use/llm/messages.py

```py
"""
This implementation is based on the OpenAI types, while removing all the parts that are not needed for Browser Use.
"""

# region - Content parts
from typing import Literal, Union

from openai import BaseModel


def _truncate(text: str, max_length: int = 50) -> str:
	"""Truncate text to max_length characters, adding ellipsis if truncated."""
	if len(text) <= max_length:
		return text
	return text[: max_length - 3] + '...'


def _format_image_url(url: str, max_length: int = 50) -> str:
	"""Format image URL for display, truncating if necessary."""
	if url.startswith('data:'):
		# Base64 image
		media_type = url.split(';')[0].split(':')[1] if ';' in url else 'image'
		return f'<base64 {media_type}>'
	else:
		# Regular URL
		return _truncate(url, max_length)


class ContentPartTextParam(BaseModel):
	text: str
	type: Literal['text'] = 'text'

	def __str__(self) -> str:
		return f'Text: {_truncate(self.text)}'

	def __repr__(self) -> str:
		return f'ContentPartTextParam(text={_truncate(self.text)})'


class ContentPartRefusalParam(BaseModel):
	refusal: str
	type: Literal['refusal'] = 'refusal'

	def __str__(self) -> str:
		return f'Refusal: {_truncate(self.refusal)}'

	def __repr__(self) -> str:
		return f'ContentPartRefusalParam(refusal={_truncate(repr(self.refusal), 50)})'


SupportedImageMediaType = Literal['image/jpeg', 'image/png', 'image/gif', 'image/webp']


class ImageURL(BaseModel):
	url: str
	"""Either a URL of the image or the base64 encoded image data."""
	detail: Literal['auto', 'low', 'high'] = 'auto'
	"""Specifies the detail level of the image.

    Learn more in the
    [Vision guide](https://platform.openai.com/docs/guides/vision#low-or-high-fidelity-image-understanding).
    """
	# needed for Anthropic
	media_type: SupportedImageMediaType = 'image/png'

	def __str__(self) -> str:
		url_display = _format_image_url(self.url)
		return f'🖼️  Image[{self.media_type}, detail={self.detail}]: {url_display}'

	def __repr__(self) -> str:
		url_repr = _format_image_url(self.url, 30)
		return f'ImageURL(url={repr(url_repr)}, detail={repr(self.detail)}, media_type={repr(self.media_type)})'


class ContentPartImageParam(BaseModel):
	image_url: ImageURL
	type: Literal['image_url'] = 'image_url'

	def __str__(self) -> str:
		return str(self.image_url)

	def __repr__(self) -> str:
		return f'ContentPartImageParam(image_url={repr(self.image_url)})'


class Function(BaseModel):
	arguments: str
	"""
    The arguments to call the function with, as generated by the model in JSON
    format. Note that the model does not always generate valid JSON, and may
    hallucinate parameters not defined by your function schema. Validate the
    arguments in your code before calling your function.
    """
	name: str
	"""The name of the function to call."""

	def __str__(self) -> str:
		args_preview = _truncate(self.arguments, 80)
		return f'{self.name}({args_preview})'

	def __repr__(self) -> str:
		args_repr = _truncate(repr(self.arguments), 50)
		return f'Function(name={repr(self.name)}, arguments={args_repr})'


class ToolCall(BaseModel):
	id: str
	"""The ID of the tool call."""
	function: Function
	"""The function that the model called."""
	type: Literal['function'] = 'function'
	"""The type of the tool. Currently, only `function` is supported."""

	def __str__(self) -> str:
		return f'ToolCall[{self.id}]: {self.function}'

	def __repr__(self) -> str:
		return f'ToolCall(id={repr(self.id)}, function={repr(self.function)})'


# endregion


# region - Message types
class _MessageBase(BaseModel):
	"""Base class for all message types"""

	role: Literal['user', 'system', 'assistant']

	cache: bool = False
	"""Whether to cache this message. This is only applicable when using Anthropic models.
	"""


class UserMessage(_MessageBase):
	role: Literal['user'] = 'user'
	"""The role of the messages author, in this case `user`."""

	content: str | list[ContentPartTextParam | ContentPartImageParam]
	"""The contents of the user message."""

	name: str | None = None
	"""An optional name for the participant.

    Provides the model information to differentiate between participants of the same
    role.
    """

	@property
	def text(self) -> str:
		"""
		Automatically parse the text inside content, whether it's a string or a list of content parts.
		"""
		if isinstance(self.content, str):
			return self.content
		elif isinstance(self.content, list):
			return '\n'.join([part.text for part in self.content if part.type == 'text'])
		else:
			return ''

	def __str__(self) -> str:
		return f'UserMessage(content={self.text})'

	def __repr__(self) -> str:
		return f'UserMessage(content={repr(self.text)})'


class SystemMessage(_MessageBase):
	role: Literal['system'] = 'system'
	"""The role of the messages author, in this case `system`."""

	content: str | list[ContentPartTextParam]
	"""The contents of the system message."""

	name: str | None = None

	@property
	def text(self) -> str:
		"""
		Automatically parse the text inside content, whether it's a string or a list of content parts.
		"""
		if isinstance(self.content, str):
			return self.content
		elif isinstance(self.content, list):
			return '\n'.join([part.text for part in self.content if part.type == 'text'])
		else:
			return ''

	def __str__(self) -> str:
		return f'SystemMessage(content={self.text})'

	def __repr__(self) -> str:
		return f'SystemMessage(content={repr(self.text)})'


class AssistantMessage(_MessageBase):
	role: Literal['assistant'] = 'assistant'
	"""The role of the messages author, in this case `assistant`."""

	content: str | list[ContentPartTextParam | ContentPartRefusalParam] | None
	"""The contents of the assistant message."""

	name: str | None = None

	refusal: str | None = None
	"""The refusal message by the assistant."""

	tool_calls: list[ToolCall] = []
	"""The tool calls generated by the model, such as function calls."""

	@property
	def text(self) -> str:
		"""
		Automatically parse the text inside content, whether it's a string or a list of content parts.
		"""
		if isinstance(self.content, str):
			return self.content
		elif isinstance(self.content, list):
			text = ''
			for part in self.content:
				if part.type == 'text':
					text += part.text
				elif part.type == 'refusal':
					text += f'[Refusal] {part.refusal}'
			return text
		else:
			return ''

	def __str__(self) -> str:
		return f'AssistantMessage(content={self.text})'

	def __repr__(self) -> str:
		return f'AssistantMessage(content={repr(self.text)})'


BaseMessage = Union[UserMessage, SystemMessage, AssistantMessage]

# endregion

```

---

## backend/browser-use/browser_use/llm/models.py

```py
"""
Convenient access to LLM models.

Usage:
    from browser_use import llm

    # Simple model access
    model = llm.azure_gpt_4_1_mini
    model = llm.openai_gpt_4o
    model = llm.google_gemini_2_5_pro
    model = llm.bu_latest
"""

import os
from typing import TYPE_CHECKING

from browser_use.llm.azure.chat import ChatAzureOpenAI
from browser_use.llm.browser_use.chat import ChatBrowserUse
from browser_use.llm.cerebras.chat import ChatCerebras
from browser_use.llm.google.chat import ChatGoogle
from browser_use.llm.openai.chat import ChatOpenAI

# Optional OCI import
try:
	from browser_use.llm.oci_raw.chat import ChatOCIRaw

	OCI_AVAILABLE = True
except ImportError:
	ChatOCIRaw = None
	OCI_AVAILABLE = False

if TYPE_CHECKING:
	from browser_use.llm.base import BaseChatModel

# Type stubs for IDE autocomplete
openai_gpt_4o: 'BaseChatModel'
openai_gpt_4o_mini: 'BaseChatModel'
openai_gpt_4_1_mini: 'BaseChatModel'
openai_o1: 'BaseChatModel'
openai_o1_mini: 'BaseChatModel'
openai_o1_pro: 'BaseChatModel'
openai_o3: 'BaseChatModel'
openai_o3_mini: 'BaseChatModel'
openai_o3_pro: 'BaseChatModel'
openai_o4_mini: 'BaseChatModel'
openai_gpt_5: 'BaseChatModel'
openai_gpt_5_mini: 'BaseChatModel'
openai_gpt_5_nano: 'BaseChatModel'

azure_gpt_4o: 'BaseChatModel'
azure_gpt_4o_mini: 'BaseChatModel'
azure_gpt_4_1_mini: 'BaseChatModel'
azure_o1: 'BaseChatModel'
azure_o1_mini: 'BaseChatModel'
azure_o1_pro: 'BaseChatModel'
azure_o3: 'BaseChatModel'
azure_o3_mini: 'BaseChatModel'
azure_o3_pro: 'BaseChatModel'
azure_gpt_5: 'BaseChatModel'
azure_gpt_5_mini: 'BaseChatModel'

google_gemini_2_0_flash: 'BaseChatModel'
google_gemini_2_0_pro: 'BaseChatModel'
google_gemini_2_5_pro: 'BaseChatModel'
google_gemini_2_5_flash: 'BaseChatModel'
google_gemini_2_5_flash_lite: 'BaseChatModel'

cerebras_llama3_1_8b: 'BaseChatModel'
cerebras_llama3_3_70b: 'BaseChatModel'
cerebras_gpt_oss_120b: 'BaseChatModel'
cerebras_llama_4_scout_17b_16e_instruct: 'BaseChatModel'
cerebras_llama_4_maverick_17b_128e_instruct: 'BaseChatModel'
cerebras_qwen_3_32b: 'BaseChatModel'
cerebras_qwen_3_235b_a22b_instruct_2507: 'BaseChatModel'
cerebras_qwen_3_235b_a22b_thinking_2507: 'BaseChatModel'
cerebras_qwen_3_coder_480b: 'BaseChatModel'

bu_latest: 'BaseChatModel'
bu_1_0: 'BaseChatModel'


def get_llm_by_name(model_name: str):
	"""
	Factory function to create LLM instances from string names with API keys from environment.

	Args:
	    model_name: String name like 'azure_gpt_4_1_mini', 'openai_gpt_4o', etc.

	Returns:
	    LLM instance with API keys from environment variables

	Raises:
	    ValueError: If model_name is not recognized
	"""
	if not model_name:
		raise ValueError('Model name cannot be empty')

	# Parse model name
	parts = model_name.split('_', 1)
	if len(parts) < 2:
		raise ValueError(f"Invalid model name format: '{model_name}'. Expected format: 'provider_model_name'")

	provider = parts[0]
	model_part = parts[1]

	# Convert underscores back to dots/dashes for actual model names
	if 'gpt_4_1_mini' in model_part:
		model = model_part.replace('gpt_4_1_mini', 'gpt-4.1-mini')
	elif 'gpt_4o_mini' in model_part:
		model = model_part.replace('gpt_4o_mini', 'gpt-4o-mini')
	elif 'gpt_4o' in model_part:
		model = model_part.replace('gpt_4o', 'gpt-4o')
	elif 'gemini_2_0' in model_part:
		model = model_part.replace('gemini_2_0', 'gemini-2.0').replace('_', '-')
	elif 'gemini_2_5' in model_part:
		model = model_part.replace('gemini_2_5', 'gemini-2.5').replace('_', '-')
	elif 'llama3_1' in model_part:
		model = model_part.replace('llama3_1', 'llama3.1').replace('_', '-')
	elif 'llama3_3' in model_part:
		model = model_part.replace('llama3_3', 'llama-3.3').replace('_', '-')
	elif 'llama_4_scout' in model_part:
		model = model_part.replace('llama_4_scout', 'llama-4-scout').replace('_', '-')
	elif 'llama_4_maverick' in model_part:
		model = model_part.replace('llama_4_maverick', 'llama-4-maverick').replace('_', '-')
	elif 'gpt_oss_120b' in model_part:
		model = model_part.replace('gpt_oss_120b', 'gpt-oss-120b')
	elif 'qwen_3_32b' in model_part:
		model = model_part.replace('qwen_3_32b', 'qwen-3-32b')
	elif 'qwen_3_235b_a22b_instruct' in model_part:
		if model_part.endswith('_2507'):
			model = model_part.replace('qwen_3_235b_a22b_instruct_2507', 'qwen-3-235b-a22b-instruct-2507')
		else:
			model = model_part.replace('qwen_3_235b_a22b_instruct', 'qwen-3-235b-a22b-instruct-2507')
	elif 'qwen_3_235b_a22b_thinking' in model_part:
		if model_part.endswith('_2507'):
			model = model_part.replace('qwen_3_235b_a22b_thinking_2507', 'qwen-3-235b-a22b-thinking-2507')
		else:
			model = model_part.replace('qwen_3_235b_a22b_thinking', 'qwen-3-235b-a22b-thinking-2507')
	elif 'qwen_3_coder_480b' in model_part:
		model = model_part.replace('qwen_3_coder_480b', 'qwen-3-coder-480b')
	else:
		model = model_part.replace('_', '-')

	# OpenAI Models
	if provider == 'openai':
		api_key = os.getenv('OPENAI_API_KEY')
		return ChatOpenAI(model=model, api_key=api_key)

	# Azure OpenAI Models
	elif provider == 'azure':
		api_key = os.getenv('AZURE_OPENAI_KEY') or os.getenv('AZURE_OPENAI_API_KEY')
		azure_endpoint = os.getenv('AZURE_OPENAI_ENDPOINT')
		return ChatAzureOpenAI(model=model, api_key=api_key, azure_endpoint=azure_endpoint)

	# Google Models
	elif provider == 'google':
		api_key = os.getenv('GOOGLE_API_KEY')
		return ChatGoogle(model=model, api_key=api_key)

	# OCI Models
	elif provider == 'oci':
		# OCI requires more complex configuration that can't be easily inferred from env vars
		# Users should use ChatOCIRaw directly with proper configuration
		raise ValueError('OCI models require manual configuration. Use ChatOCIRaw directly with your OCI credentials.')

	# Cerebras Models
	elif provider == 'cerebras':
		api_key = os.getenv('CEREBRAS_API_KEY')
		return ChatCerebras(model=model, api_key=api_key)

	# Browser Use Models
	elif provider == 'bu':
		# Handle bu_latest -> bu-latest conversion (need to prepend 'bu-' back)
		model = f'bu-{model_part.replace("_", "-")}'
		api_key = os.getenv('BROWSER_USE_API_KEY')
		return ChatBrowserUse(model=model, api_key=api_key)

	else:
		available_providers = ['openai', 'azure', 'google', 'oci', 'cerebras', 'bu']
		raise ValueError(f"Unknown provider: '{provider}'. Available providers: {', '.join(available_providers)}")


# Pre-configured model instances (lazy loaded via __getattr__)
def __getattr__(name: str) -> 'BaseChatModel':
	"""Create model instances on demand with API keys from environment."""
	# Handle chat classes first
	if name == 'ChatOpenAI':
		return ChatOpenAI  # type: ignore
	elif name == 'ChatAzureOpenAI':
		return ChatAzureOpenAI  # type: ignore
	elif name == 'ChatGoogle':
		return ChatGoogle  # type: ignore
	elif name == 'ChatOCIRaw':
		if not OCI_AVAILABLE:
			raise ImportError('OCI integration not available. Install with: pip install "browser-use[oci]"')
		return ChatOCIRaw  # type: ignore
	elif name == 'ChatCerebras':
		return ChatCerebras  # type: ignore
	elif name == 'ChatBrowserUse':
		return ChatBrowserUse  # type: ignore

	# Handle model instances - these are the main use case
	try:
		return get_llm_by_name(name)
	except ValueError:
		raise AttributeError(f"module '{__name__}' has no attribute '{name}'")


# Export all classes and preconfigured instances, conditionally including ChatOCIRaw
__all__ = [
	'ChatOpenAI',
	'ChatAzureOpenAI',
	'ChatGoogle',
	'ChatCerebras',
	'ChatBrowserUse',
]

if OCI_AVAILABLE:
	__all__.append('ChatOCIRaw')

__all__ += [
	'get_llm_by_name',
	# OpenAI instances - created on demand
	'openai_gpt_4o',
	'openai_gpt_4o_mini',
	'openai_gpt_4_1_mini',
	'openai_o1',
	'openai_o1_mini',
	'openai_o1_pro',
	'openai_o3',
	'openai_o3_mini',
	'openai_o3_pro',
	'openai_o4_mini',
	'openai_gpt_5',
	'openai_gpt_5_mini',
	'openai_gpt_5_nano',
	# Azure instances - created on demand
	'azure_gpt_4o',
	'azure_gpt_4o_mini',
	'azure_gpt_4_1_mini',
	'azure_o1',
	'azure_o1_mini',
	'azure_o1_pro',
	'azure_o3',
	'azure_o3_mini',
	'azure_o3_pro',
	'azure_gpt_5',
	'azure_gpt_5_mini',
	# Google instances - created on demand
	'google_gemini_2_0_flash',
	'google_gemini_2_0_pro',
	'google_gemini_2_5_pro',
	'google_gemini_2_5_flash',
	'google_gemini_2_5_flash_lite',
	# Cerebras instances - created on demand
	'cerebras_llama3_1_8b',
	'cerebras_llama3_3_70b',
	'cerebras_gpt_oss_120b',
	'cerebras_llama_4_scout_17b_16e_instruct',
	'cerebras_llama_4_maverick_17b_128e_instruct',
	'cerebras_qwen_3_32b',
	'cerebras_qwen_3_235b_a22b_instruct_2507',
	'cerebras_qwen_3_235b_a22b_thinking_2507',
	'cerebras_qwen_3_coder_480b',
	# Browser Use instances - created on demand
	'bu_latest',
	'bu_1_0',
]

# NOTE: OCI backend is optional. The try/except ImportError and conditional __all__ are required
# so this module can be imported without browser-use[oci] installed.

```

---

## backend/browser-use/browser_use/llm/oci_raw/__init__.py

```py
"""
OCI Raw API integration for browser-use.

This module provides direct integration with Oracle Cloud Infrastructure's
Generative AI service using the raw API endpoints, without Langchain dependencies.
"""

from .chat import ChatOCIRaw

__all__ = ['ChatOCIRaw']

```

---

## backend/browser-use/browser_use/llm/oci_raw/chat.py

```py
"""
OCI Raw API chat model integration for browser-use.

This module provides direct integration with Oracle Cloud Infrastructure's
Generative AI service using raw API calls without Langchain dependencies.
"""

import asyncio
import json
from dataclasses import dataclass
from typing import TypeVar, overload

import oci
from oci.generative_ai_inference import GenerativeAiInferenceClient
from oci.generative_ai_inference.models import (
	BaseChatRequest,
	ChatDetails,
	CohereChatRequest,
	GenericChatRequest,
	OnDemandServingMode,
)
from pydantic import BaseModel

from browser_use.llm.base import BaseChatModel
from browser_use.llm.exceptions import ModelProviderError, ModelRateLimitError
from browser_use.llm.messages import BaseMessage
from browser_use.llm.schema import SchemaOptimizer
from browser_use.llm.views import ChatInvokeCompletion, ChatInvokeUsage

from .serializer import OCIRawMessageSerializer

T = TypeVar('T', bound=BaseModel)


@dataclass
class ChatOCIRaw(BaseChatModel):
	"""
	A direct OCI Raw API integration for browser-use that bypasses Langchain.

	This class provides a browser-use compatible interface for OCI GenAI models
	using direct API calls to Oracle Cloud Infrastructure.

	Args:
	    model_id: The OCI GenAI model OCID
	    service_endpoint: The OCI service endpoint URL
	    compartment_id: The OCI compartment OCID
	    provider: The model provider (e.g., "meta", "cohere", "xai")
	    temperature: Temperature for response generation (0.0-2.0) - supported by all providers
	    max_tokens: Maximum tokens in response - supported by all providers
	    frequency_penalty: Frequency penalty for response generation - supported by Meta and Cohere only
	    presence_penalty: Presence penalty for response generation - supported by Meta only
	    top_p: Top-p sampling parameter - supported by all providers
	    top_k: Top-k sampling parameter - supported by Cohere and xAI only
	    auth_type: Authentication type (e.g., "API_KEY")
	    auth_profile: Authentication profile name
	    timeout: Request timeout in seconds
	"""

	# Model configuration
	model_id: str
	service_endpoint: str
	compartment_id: str
	provider: str = 'meta'

	# Model parameters
	temperature: float | None = 1.0
	max_tokens: int | None = 600
	frequency_penalty: float | None = 0.0
	presence_penalty: float | None = 0.0
	top_p: float | None = 0.75
	top_k: int | None = 0  # Used by Cohere models

	# Authentication
	auth_type: str = 'API_KEY'
	auth_profile: str = 'DEFAULT'

	# Client configuration
	timeout: float = 60.0

	# Static properties
	@property
	def provider_name(self) -> str:
		return 'oci-raw'

	@property
	def name(self) -> str:
		# Return a shorter name for telemetry (max 100 chars)
		if len(self.model_id) > 90:
			# Extract the model name from the OCID
			parts = self.model_id.split('.')
			if len(parts) >= 4:
				return f'oci-{self.provider}-{parts[3]}'  # e.g., "oci-meta-us-chicago-1"
			else:
				return f'oci-{self.provider}-model'
		return self.model_id

	@property
	def model(self) -> str:
		return self.model_id

	@property
	def model_name(self) -> str:
		# Override for telemetry - return shorter name (max 100 chars)
		if len(self.model_id) > 90:
			# Extract the model name from the OCID
			parts = self.model_id.split('.')
			if len(parts) >= 4:
				return f'oci-{self.provider}-{parts[3]}'  # e.g., "oci-meta-us-chicago-1"
			else:
				return f'oci-{self.provider}-model'
		return self.model_id

	def _uses_cohere_format(self) -> bool:
		"""Check if the provider uses Cohere chat request format."""
		return self.provider.lower() == 'cohere'

	def _get_supported_parameters(self) -> dict[str, bool]:
		"""Get which parameters are supported by the current provider."""
		provider = self.provider.lower()
		if provider == 'meta':
			return {
				'temperature': True,
				'max_tokens': True,
				'frequency_penalty': True,
				'presence_penalty': True,
				'top_p': True,
				'top_k': False,
			}
		elif provider == 'cohere':
			return {
				'temperature': True,
				'max_tokens': True,
				'frequency_penalty': True,
				'presence_penalty': False,
				'top_p': True,
				'top_k': True,
			}
		elif provider == 'xai':
			return {
				'temperature': True,
				'max_tokens': True,
				'frequency_penalty': False,
				'presence_penalty': False,
				'top_p': True,
				'top_k': True,
			}
		else:
			# Default: assume all parameters are supported
			return {
				'temperature': True,
				'max_tokens': True,
				'frequency_penalty': True,
				'presence_penalty': True,
				'top_p': True,
				'top_k': True,
			}

	def _get_oci_client(self) -> GenerativeAiInferenceClient:
		"""Get the OCI GenerativeAiInferenceClient following your working example."""
		if not hasattr(self, '_client'):
			# Configure OCI client based on auth_type (following your working example)
			if self.auth_type == 'API_KEY':
				config = oci.config.from_file('~/.oci/config', self.auth_profile)
				self._client = GenerativeAiInferenceClient(
					config=config,
					service_endpoint=self.service_endpoint,
					retry_strategy=oci.retry.NoneRetryStrategy(),
					timeout=(10, 240),  # Following your working example
				)
			elif self.auth_type == 'INSTANCE_PRINCIPAL':
				config = {}
				signer = oci.auth.signers.InstancePrincipalsSecurityTokenSigner()
				self._client = GenerativeAiInferenceClient(
					config=config,
					signer=signer,
					service_endpoint=self.service_endpoint,
					retry_strategy=oci.retry.NoneRetryStrategy(),
					timeout=(10, 240),
				)
			elif self.auth_type == 'RESOURCE_PRINCIPAL':
				config = {}
				signer = oci.auth.signers.get_resource_principals_signer()
				self._client = GenerativeAiInferenceClient(
					config=config,
					signer=signer,
					service_endpoint=self.service_endpoint,
					retry_strategy=oci.retry.NoneRetryStrategy(),
					timeout=(10, 240),
				)
			else:
				# Fallback to API_KEY
				config = oci.config.from_file('~/.oci/config', self.auth_profile)
				self._client = GenerativeAiInferenceClient(
					config=config,
					service_endpoint=self.service_endpoint,
					retry_strategy=oci.retry.NoneRetryStrategy(),
					timeout=(10, 240),
				)

		return self._client

	def _extract_usage(self, response) -> ChatInvokeUsage | None:
		"""Extract usage information from OCI response."""
		try:
			# The response is the direct OCI response object, not a dict
			if hasattr(response, 'data') and hasattr(response.data, 'chat_response'):
				chat_response = response.data.chat_response
				if hasattr(chat_response, 'usage'):
					usage = chat_response.usage
					return ChatInvokeUsage(
						prompt_tokens=getattr(usage, 'prompt_tokens', 0),
						prompt_cached_tokens=None,
						prompt_cache_creation_tokens=None,
						prompt_image_tokens=None,
						completion_tokens=getattr(usage, 'completion_tokens', 0),
						total_tokens=getattr(usage, 'total_tokens', 0),
					)
			return None
		except Exception:
			return None

	def _extract_content(self, response) -> str:
		"""Extract text content from OCI response."""
		try:
			# The response is the direct OCI response object, not a dict
			if not hasattr(response, 'data'):
				raise ModelProviderError(message='Invalid response format: no data attribute', status_code=500, model=self.name)

			chat_response = response.data.chat_response

			# Handle different response types based on provider
			if hasattr(chat_response, 'text'):
				# Cohere response format - has direct text attribute
				return chat_response.text or ''
			elif hasattr(chat_response, 'choices') and chat_response.choices:
				# Generic response format - has choices array (Meta, xAI)
				choice = chat_response.choices[0]
				message = choice.message
				content_parts = message.content

				# Extract text from content parts
				text_parts = []
				for part in content_parts:
					if hasattr(part, 'text'):
						text_parts.append(part.text)

				return '\n'.join(text_parts) if text_parts else ''
			else:
				raise ModelProviderError(
					message=f'Unsupported response format: {type(chat_response).__name__}', status_code=500, model=self.name
				)

		except Exception as e:
			raise ModelProviderError(
				message=f'Failed to extract content from response: {str(e)}', status_code=500, model=self.name
			) from e

	async def _make_request(self, messages: list[BaseMessage]):
		"""Make async request to OCI API using proper OCI SDK models."""

		# Create chat request based on provider type
		if self._uses_cohere_format():
			# Cohere models use CohereChatRequest with single message string
			message_text = OCIRawMessageSerializer.serialize_messages_for_cohere(messages)

			chat_request = CohereChatRequest()
			chat_request.message = message_text
			chat_request.max_tokens = self.max_tokens
			chat_request.temperature = self.temperature
			chat_request.frequency_penalty = self.frequency_penalty
			chat_request.top_p = self.top_p
			chat_request.top_k = self.top_k
		else:
			# Meta, xAI and other models use GenericChatRequest with messages array
			oci_messages = OCIRawMessageSerializer.serialize_messages(messages)

			chat_request = GenericChatRequest()
			chat_request.api_format = BaseChatRequest.API_FORMAT_GENERIC
			chat_request.messages = oci_messages
			chat_request.max_tokens = self.max_tokens
			chat_request.temperature = self.temperature
			chat_request.top_p = self.top_p

			# Provider-specific parameters
			if self.provider.lower() == 'meta':
				# Meta models support frequency_penalty and presence_penalty
				chat_request.frequency_penalty = self.frequency_penalty
				chat_request.presence_penalty = self.presence_penalty
			elif self.provider.lower() == 'xai':
				# xAI models support top_k but not frequency_penalty or presence_penalty
				chat_request.top_k = self.top_k
			else:
				# Default: include all parameters for unknown providers
				chat_request.frequency_penalty = self.frequency_penalty
				chat_request.presence_penalty = self.presence_penalty

		# Create serving mode
		serving_mode = OnDemandServingMode(model_id=self.model_id)

		# Create chat details
		chat_details = ChatDetails()
		chat_details.serving_mode = serving_mode
		chat_details.chat_request = chat_request
		chat_details.compartment_id = self.compartment_id

		# Make the request in a thread to avoid blocking
		def _sync_request():
			try:
				client = self._get_oci_client()
				response = client.chat(chat_details)
				return response  # Return the raw response object
			except Exception as e:
				# Handle OCI-specific exceptions
				status_code = getattr(e, 'status', 500)
				if status_code == 429:
					raise ModelRateLimitError(message=f'Rate limit exceeded: {str(e)}', model=self.name) from e
				else:
					raise ModelProviderError(message=str(e), status_code=status_code, model=self.name) from e

		# Run in thread pool to make it async
		loop = asyncio.get_event_loop()
		return await loop.run_in_executor(None, _sync_request)

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: None = None) -> ChatInvokeCompletion[str]: ...

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: type[T]) -> ChatInvokeCompletion[T]: ...

	async def ainvoke(
		self, messages: list[BaseMessage], output_format: type[T] | None = None
	) -> ChatInvokeCompletion[T] | ChatInvokeCompletion[str]:
		"""
		Invoke the OCI GenAI model with the given messages using raw API.

		Args:
		    messages: List of chat messages
		    output_format: Optional Pydantic model class for structured output

		Returns:
		    Either a string response or an instance of output_format
		"""
		try:
			if output_format is None:
				# Return string response
				response = await self._make_request(messages)
				content = self._extract_content(response)
				usage = self._extract_usage(response)

				return ChatInvokeCompletion(
					completion=content,
					usage=usage,
				)
			else:
				# For structured output, add JSON schema instructions
				optimized_schema = SchemaOptimizer.create_optimized_json_schema(output_format)

				# Add JSON schema instruction to messages
				system_instruction = f"""
You must respond with ONLY a valid JSON object that matches this exact schema:
{json.dumps(optimized_schema, indent=2)}

IMPORTANT: 
- Your response must be ONLY the JSON object, no additional text
- The JSON must be valid and parseable
- All required fields must be present
- No extra fields are allowed
- Use proper JSON syntax with double quotes
"""

				# Clone messages and add system instruction
				modified_messages = messages.copy()

				# Add or modify system message
				from browser_use.llm.messages import SystemMessage

				if modified_messages and hasattr(modified_messages[0], 'role') and modified_messages[0].role == 'system':
					# Modify existing system message
					existing_content = modified_messages[0].content
					if isinstance(existing_content, str):
						modified_messages[0].content = existing_content + '\n\n' + system_instruction
					else:
						# Handle list content
						modified_messages[0].content = str(existing_content) + '\n\n' + system_instruction
				else:
					# Insert new system message at the beginning
					modified_messages.insert(0, SystemMessage(content=system_instruction))

				response = await self._make_request(modified_messages)
				response_text = self._extract_content(response)

				# Clean and parse the JSON response
				try:
					# Clean the response text
					cleaned_text = response_text.strip()

					# Remove markdown code blocks if present
					if cleaned_text.startswith('``\`json'):
						cleaned_text = cleaned_text[7:]
					if cleaned_text.startswith('``\`'):
						cleaned_text = cleaned_text[3:]
					if cleaned_text.endswith('``\`'):
						cleaned_text = cleaned_text[:-3]

					cleaned_text = cleaned_text.strip()

					# Try to find JSON object in the response
					if not cleaned_text.startswith('{'):
						start_idx = cleaned_text.find('{')
						end_idx = cleaned_text.rfind('}')
						if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
							cleaned_text = cleaned_text[start_idx : end_idx + 1]

					# Parse the JSON
					parsed_data = json.loads(cleaned_text)
					parsed = output_format.model_validate(parsed_data)

					usage = self._extract_usage(response)
					return ChatInvokeCompletion(
						completion=parsed,
						usage=usage,
					)

				except (json.JSONDecodeError, ValueError) as e:
					raise ModelProviderError(
						message=f'Failed to parse structured output: {str(e)}. Response was: {response_text[:200]}...',
						status_code=500,
						model=self.name,
					) from e

		except ModelRateLimitError:
			# Re-raise rate limit errors as-is
			raise
		except ModelProviderError:
			# Re-raise provider errors as-is
			raise
		except Exception as e:
			# Handle any other exceptions
			raise ModelProviderError(
				message=f'Unexpected error: {str(e)}',
				status_code=500,
				model=self.name,
			) from e

```

---

## backend/browser-use/browser_use/llm/oci_raw/serializer.py

```py
"""
Message serializer for OCI Raw API integration.

This module handles the conversion between browser-use message formats
and the OCI Raw API message format using proper OCI SDK models.
"""

from oci.generative_ai_inference.models import ImageContent, ImageUrl, Message, TextContent

from browser_use.llm.messages import (
	AssistantMessage,
	BaseMessage,
	ContentPartImageParam,
	SystemMessage,
	UserMessage,
)


class OCIRawMessageSerializer:
	"""
	Serializer for converting between browser-use message types and OCI Raw API message formats.
	Uses proper OCI SDK model objects as shown in the working example.

	Supports both:
	- GenericChatRequest (Meta, xAI models) - uses messages array
	- CohereChatRequest (Cohere models) - uses single message string
	"""

	@staticmethod
	def _is_base64_image(url: str) -> bool:
		"""Check if the URL is a base64 encoded image."""
		return url.startswith('data:image/')

	@staticmethod
	def _parse_base64_url(url: str) -> str:
		"""Parse base64 URL and return the base64 data."""
		if not OCIRawMessageSerializer._is_base64_image(url):
			raise ValueError(f'Not a base64 image URL: {url}')

		# Extract the base64 data from data:image/png;base64,<data>
		try:
			header, data = url.split(',', 1)
			return data
		except ValueError:
			raise ValueError(f'Invalid base64 image URL format: {url}')

	@staticmethod
	def _create_image_content(part: ContentPartImageParam) -> ImageContent:
		"""Convert ContentPartImageParam to OCI ImageContent."""
		url = part.image_url.url

		if OCIRawMessageSerializer._is_base64_image(url):
			# Handle base64 encoded images - OCI expects data URLs as-is
			image_url = ImageUrl(url=url)
		else:
			# Handle regular URLs
			image_url = ImageUrl(url=url)

		return ImageContent(image_url=image_url)

	@staticmethod
	def serialize_messages(messages: list[BaseMessage]) -> list[Message]:
		"""
		Serialize a list of browser-use messages to OCI Raw API Message objects.

		Args:
		    messages: List of browser-use messages

		Returns:
		    List of OCI Message objects
		"""
		oci_messages = []

		for message in messages:
			oci_message = Message()

			if isinstance(message, UserMessage):
				oci_message.role = 'USER'
				content = message.content
				if isinstance(content, str):
					text_content = TextContent()
					text_content.text = content
					oci_message.content = [text_content]
				elif isinstance(content, list):
					# Handle content parts - text and images
					contents = []
					for part in content:
						if part.type == 'text':
							text_content = TextContent()
							text_content.text = part.text
							contents.append(text_content)
						elif part.type == 'image_url':
							image_content = OCIRawMessageSerializer._create_image_content(part)
							contents.append(image_content)
					if contents:
						oci_message.content = contents

			elif isinstance(message, SystemMessage):
				oci_message.role = 'SYSTEM'
				content = message.content
				if isinstance(content, str):
					text_content = TextContent()
					text_content.text = content
					oci_message.content = [text_content]
				elif isinstance(content, list):
					# Handle content parts - typically just text for system messages
					contents = []
					for part in content:
						if part.type == 'text':
							text_content = TextContent()
							text_content.text = part.text
							contents.append(text_content)
						elif part.type == 'image_url':
							# System messages can theoretically have images too
							image_content = OCIRawMessageSerializer._create_image_content(part)
							contents.append(image_content)
					if contents:
						oci_message.content = contents

			elif isinstance(message, AssistantMessage):
				oci_message.role = 'ASSISTANT'
				content = message.content
				if isinstance(content, str):
					text_content = TextContent()
					text_content.text = content
					oci_message.content = [text_content]
				elif isinstance(content, list):
					# Handle content parts - text, images, and refusals
					contents = []
					for part in content:
						if part.type == 'text':
							text_content = TextContent()
							text_content.text = part.text
							contents.append(text_content)
						elif part.type == 'image_url':
							# Assistant messages can have images in responses
							# Note: This is currently unreachable in browser-use but kept for completeness
							image_content = OCIRawMessageSerializer._create_image_content(part)
							contents.append(image_content)
						elif part.type == 'refusal':
							text_content = TextContent()
							text_content.text = f'[Refusal] {part.refusal}'
							contents.append(text_content)
					if contents:
						oci_message.content = contents
			else:
				# Fallback for any message format issues
				oci_message.role = 'USER'
				text_content = TextContent()
				text_content.text = str(message)
				oci_message.content = [text_content]

			# Only append messages that have content
			if hasattr(oci_message, 'content') and oci_message.content:
				oci_messages.append(oci_message)

		return oci_messages

	@staticmethod
	def serialize_messages_for_cohere(messages: list[BaseMessage]) -> str:
		"""
		Serialize messages for Cohere models which expect a single message string.

		Cohere models use CohereChatRequest.message (string) instead of messages array.
		We combine all messages into a single conversation string.

		Args:
		    messages: List of browser-use messages

		Returns:
		    Single string containing the conversation
		"""
		conversation_parts = []

		for message in messages:
			content = ''

			if isinstance(message, UserMessage):
				if isinstance(message.content, str):
					content = message.content
				elif isinstance(message.content, list):
					# Extract text from content parts
					text_parts = []
					for part in message.content:
						if part.type == 'text':
							text_parts.append(part.text)
						elif part.type == 'image_url':
							# Cohere may not support images in all models, use a short placeholder
							# to avoid massive token usage from base64 data URIs
							if part.image_url.url.startswith('data:image/'):
								text_parts.append('[Image: base64_data]')
							else:
								text_parts.append('[Image: external_url]')
					content = ' '.join(text_parts)

				conversation_parts.append(f'User: {content}')

			elif isinstance(message, SystemMessage):
				if isinstance(message.content, str):
					content = message.content
				elif isinstance(message.content, list):
					# Extract text from content parts
					text_parts = []
					for part in message.content:
						if part.type == 'text':
							text_parts.append(part.text)
					content = ' '.join(text_parts)

				conversation_parts.append(f'System: {content}')

			elif isinstance(message, AssistantMessage):
				if isinstance(message.content, str):
					content = message.content
				elif isinstance(message.content, list):
					# Extract text from content parts
					text_parts = []
					for part in message.content:
						if part.type == 'text':
							text_parts.append(part.text)
						elif part.type == 'refusal':
							text_parts.append(f'[Refusal] {part.refusal}')
					content = ' '.join(text_parts)

				conversation_parts.append(f'Assistant: {content}')
			else:
				# Fallback
				conversation_parts.append(f'User: {str(message)}')

		return '\n\n'.join(conversation_parts)

```

---

## backend/browser-use/browser_use/llm/ollama/chat.py

```py
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, TypeVar, overload

import httpx
from ollama import AsyncClient as OllamaAsyncClient
from ollama import Options
from pydantic import BaseModel

from browser_use.llm.base import BaseChatModel
from browser_use.llm.exceptions import ModelProviderError
from browser_use.llm.messages import BaseMessage
from browser_use.llm.ollama.serializer import OllamaMessageSerializer
from browser_use.llm.views import ChatInvokeCompletion

T = TypeVar('T', bound=BaseModel)


@dataclass
class ChatOllama(BaseChatModel):
	"""
	A wrapper around Ollama's chat model.
	"""

	model: str

	# # Model params
	# TODO (matic): Why is this commented out?
	# temperature: float | None = None

	# Client initialization parameters
	host: str | None = None
	timeout: float | httpx.Timeout | None = None
	client_params: dict[str, Any] | None = None
	ollama_options: Mapping[str, Any] | Options | None = None

	# Static
	@property
	def provider(self) -> str:
		return 'ollama'

	def _get_client_params(self) -> dict[str, Any]:
		"""Prepare client parameters dictionary."""
		return {
			'host': self.host,
			'timeout': self.timeout,
			'client_params': self.client_params,
		}

	def get_client(self) -> OllamaAsyncClient:
		"""
		Returns an OllamaAsyncClient client.
		"""
		return OllamaAsyncClient(host=self.host, timeout=self.timeout, **self.client_params or {})

	@property
	def name(self) -> str:
		return self.model

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: None = None) -> ChatInvokeCompletion[str]: ...

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: type[T]) -> ChatInvokeCompletion[T]: ...

	async def ainvoke(
		self, messages: list[BaseMessage], output_format: type[T] | None = None
	) -> ChatInvokeCompletion[T] | ChatInvokeCompletion[str]:
		ollama_messages = OllamaMessageSerializer.serialize_messages(messages)

		try:
			if output_format is None:
				response = await self.get_client().chat(
					model=self.model,
					messages=ollama_messages,
					options=self.ollama_options,
				)

				return ChatInvokeCompletion(completion=response.message.content or '', usage=None)
			else:
				schema = output_format.model_json_schema()

				response = await self.get_client().chat(
					model=self.model,
					messages=ollama_messages,
					format=schema,
					options=self.ollama_options,
				)

				completion = response.message.content or ''
				if output_format is not None:
					completion = output_format.model_validate_json(completion)

				return ChatInvokeCompletion(completion=completion, usage=None)

		except Exception as e:
			raise ModelProviderError(message=str(e), model=self.name) from e

```

---

## backend/browser-use/browser_use/llm/ollama/serializer.py

```py
import base64
import json
from typing import Any, overload

from ollama._types import Image, Message

from browser_use.llm.messages import (
	AssistantMessage,
	BaseMessage,
	SystemMessage,
	ToolCall,
	UserMessage,
)


class OllamaMessageSerializer:
	"""Serializer for converting between custom message types and Ollama message types."""

	@staticmethod
	def _extract_text_content(content: Any) -> str:
		"""Extract text content from message content, ignoring images."""
		if content is None:
			return ''
		if isinstance(content, str):
			return content

		text_parts: list[str] = []
		for part in content:
			if hasattr(part, 'type'):
				if part.type == 'text':
					text_parts.append(part.text)
				elif part.type == 'refusal':
					text_parts.append(f'[Refusal] {part.refusal}')
			# Skip image parts as they're handled separately

		return '\n'.join(text_parts)

	@staticmethod
	def _extract_images(content: Any) -> list[Image]:
		"""Extract images from message content."""
		if content is None or isinstance(content, str):
			return []

		images: list[Image] = []
		for part in content:
			if hasattr(part, 'type') and part.type == 'image_url':
				url = part.image_url.url
				if url.startswith('data:'):
					# Handle base64 encoded images
					# Format: data:image/jpeg;base64,<data>
					_, data = url.split(',', 1)
					# Decode base64 to bytes
					image_bytes = base64.b64decode(data)
					images.append(Image(value=image_bytes))
				else:
					# Handle URL images (Ollama will download them)
					images.append(Image(value=url))

		return images

	@staticmethod
	def _serialize_tool_calls(tool_calls: list[ToolCall]) -> list[Message.ToolCall]:
		"""Convert browser-use ToolCalls to Ollama ToolCalls."""
		ollama_tool_calls: list[Message.ToolCall] = []

		for tool_call in tool_calls:
			# Parse arguments from JSON string to dict for Ollama
			try:
				arguments_dict = json.loads(tool_call.function.arguments)
			except json.JSONDecodeError:
				# If parsing fails, wrap in a dict
				arguments_dict = {'arguments': tool_call.function.arguments}

			ollama_tool_call = Message.ToolCall(
				function=Message.ToolCall.Function(name=tool_call.function.name, arguments=arguments_dict)
			)
			ollama_tool_calls.append(ollama_tool_call)

		return ollama_tool_calls

	# region - Serialize overloads
	@overload
	@staticmethod
	def serialize(message: UserMessage) -> Message: ...

	@overload
	@staticmethod
	def serialize(message: SystemMessage) -> Message: ...

	@overload
	@staticmethod
	def serialize(message: AssistantMessage) -> Message: ...

	@staticmethod
	def serialize(message: BaseMessage) -> Message:
		"""Serialize a custom message to an Ollama Message."""

		if isinstance(message, UserMessage):
			text_content = OllamaMessageSerializer._extract_text_content(message.content)
			images = OllamaMessageSerializer._extract_images(message.content)

			ollama_message = Message(
				role='user',
				content=text_content if text_content else None,
			)

			if images:
				ollama_message.images = images

			return ollama_message

		elif isinstance(message, SystemMessage):
			text_content = OllamaMessageSerializer._extract_text_content(message.content)

			return Message(
				role='system',
				content=text_content if text_content else None,
			)

		elif isinstance(message, AssistantMessage):
			# Handle content
			text_content = None
			if message.content is not None:
				text_content = OllamaMessageSerializer._extract_text_content(message.content)

			ollama_message = Message(
				role='assistant',
				content=text_content if text_content else None,
			)

			# Handle tool calls
			if message.tool_calls:
				ollama_message.tool_calls = OllamaMessageSerializer._serialize_tool_calls(message.tool_calls)

			return ollama_message

		else:
			raise ValueError(f'Unknown message type: {type(message)}')

	@staticmethod
	def serialize_messages(messages: list[BaseMessage]) -> list[Message]:
		"""Serialize a list of browser_use messages to Ollama Messages."""
		return [OllamaMessageSerializer.serialize(m) for m in messages]

```

---

## backend/browser-use/browser_use/llm/openai/chat.py

```py
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal, TypeVar, overload

import httpx
from openai import APIConnectionError, APIStatusError, AsyncOpenAI, RateLimitError
from openai.types.chat import ChatCompletionContentPartTextParam
from openai.types.chat.chat_completion import ChatCompletion
from openai.types.shared.chat_model import ChatModel
from openai.types.shared_params.reasoning_effort import ReasoningEffort
from openai.types.shared_params.response_format_json_schema import JSONSchema, ResponseFormatJSONSchema
from pydantic import BaseModel

from browser_use.llm.base import BaseChatModel
from browser_use.llm.exceptions import ModelProviderError, ModelRateLimitError
from browser_use.llm.messages import BaseMessage
from browser_use.llm.openai.serializer import OpenAIMessageSerializer
from browser_use.llm.schema import SchemaOptimizer
from browser_use.llm.views import ChatInvokeCompletion, ChatInvokeUsage

T = TypeVar('T', bound=BaseModel)


@dataclass
class ChatOpenAI(BaseChatModel):
	"""
	A wrapper around AsyncOpenAI that implements the BaseLLM protocol.

	This class accepts all AsyncOpenAI parameters while adding model
	and temperature parameters for the LLM interface (if temperature it not `None`).
	"""

	# Model configuration
	model: ChatModel | str

	# Model params
	temperature: float | None = 0.2
	frequency_penalty: float | None = 0.3  # this avoids infinite generation of \t for models like 4.1-mini
	reasoning_effort: ReasoningEffort = 'low'
	seed: int | None = None
	service_tier: Literal['auto', 'default', 'flex', 'priority', 'scale'] | None = None
	top_p: float | None = None
	add_schema_to_system_prompt: bool = False  # Add JSON schema to system prompt instead of using response_format
	dont_force_structured_output: bool = False  # If True, the model will not be forced to output a structured output
	remove_min_items_from_schema: bool = (
		False  # If True, remove minItems from JSON schema (for compatibility with some providers)
	)
	remove_defaults_from_schema: bool = (
		False  # If True, remove default values from JSON schema (for compatibility with some providers)
	)

	# Client initialization parameters
	api_key: str | None = None
	organization: str | None = None
	project: str | None = None
	base_url: str | httpx.URL | None = None
	websocket_base_url: str | httpx.URL | None = None
	timeout: float | httpx.Timeout | None = None
	max_retries: int = 5  # Increase default retries for automation reliability
	default_headers: Mapping[str, str] | None = None
	default_query: Mapping[str, object] | None = None
	http_client: httpx.AsyncClient | None = None
	_strict_response_validation: bool = False
	max_completion_tokens: int | None = 4096
	reasoning_models: list[ChatModel | str] | None = field(
		default_factory=lambda: [
			'o4-mini',
			'o3',
			'o3-mini',
			'o1',
			'o1-pro',
			'o3-pro',
			'gpt-5',
			'gpt-5-mini',
			'gpt-5-nano',
		]
	)

	# Static
	@property
	def provider(self) -> str:
		return 'openai'

	def _get_client_params(self) -> dict[str, Any]:
		"""Prepare client parameters dictionary."""
		# Define base client params
		base_params = {
			'api_key': self.api_key,
			'organization': self.organization,
			'project': self.project,
			'base_url': self.base_url,
			'websocket_base_url': self.websocket_base_url,
			'timeout': self.timeout,
			'max_retries': self.max_retries,
			'default_headers': self.default_headers,
			'default_query': self.default_query,
			'_strict_response_validation': self._strict_response_validation,
		}

		# Create client_params dict with non-None values
		client_params = {k: v for k, v in base_params.items() if v is not None}

		# Add http_client if provided
		if self.http_client is not None:
			client_params['http_client'] = self.http_client

		return client_params

	def get_client(self) -> AsyncOpenAI:
		"""
		Returns an AsyncOpenAI client.

		Returns:
			AsyncOpenAI: An instance of the AsyncOpenAI client.
		"""
		client_params = self._get_client_params()
		return AsyncOpenAI(**client_params)

	@property
	def name(self) -> str:
		return str(self.model)

	def _get_usage(self, response: ChatCompletion) -> ChatInvokeUsage | None:
		if response.usage is not None:
			completion_tokens = response.usage.completion_tokens
			completion_token_details = response.usage.completion_tokens_details
			if completion_token_details is not None:
				reasoning_tokens = completion_token_details.reasoning_tokens
				if reasoning_tokens is not None:
					completion_tokens += reasoning_tokens

			usage = ChatInvokeUsage(
				prompt_tokens=response.usage.prompt_tokens,
				prompt_cached_tokens=response.usage.prompt_tokens_details.cached_tokens
				if response.usage.prompt_tokens_details is not None
				else None,
				prompt_cache_creation_tokens=None,
				prompt_image_tokens=None,
				# Completion
				completion_tokens=completion_tokens,
				total_tokens=response.usage.total_tokens,
			)
		else:
			usage = None

		return usage

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: None = None) -> ChatInvokeCompletion[str]: ...

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: type[T]) -> ChatInvokeCompletion[T]: ...

	async def ainvoke(
		self, messages: list[BaseMessage], output_format: type[T] | None = None
	) -> ChatInvokeCompletion[T] | ChatInvokeCompletion[str]:
		"""
		Invoke the model with the given messages.

		Args:
			messages: List of chat messages
			output_format: Optional Pydantic model class for structured output

		Returns:
			Either a string response or an instance of output_format
		"""

		openai_messages = OpenAIMessageSerializer.serialize_messages(messages)

		try:
			model_params: dict[str, Any] = {}

			if self.temperature is not None:
				model_params['temperature'] = self.temperature

			if self.frequency_penalty is not None:
				model_params['frequency_penalty'] = self.frequency_penalty

			if self.max_completion_tokens is not None:
				model_params['max_completion_tokens'] = self.max_completion_tokens

			if self.top_p is not None:
				model_params['top_p'] = self.top_p

			if self.seed is not None:
				model_params['seed'] = self.seed

			if self.service_tier is not None:
				model_params['service_tier'] = self.service_tier

			if self.reasoning_models and any(str(m).lower() in str(self.model).lower() for m in self.reasoning_models):
				model_params['reasoning_effort'] = self.reasoning_effort
				model_params.pop('temperature', None)
				model_params.pop('frequency_penalty', None)

			if output_format is None:
				# Return string response
				response = await self.get_client().chat.completions.create(
					model=self.model,
					messages=openai_messages,
					**model_params,
				)

				usage = self._get_usage(response)
				return ChatInvokeCompletion(
					completion=response.choices[0].message.content or '',
					usage=usage,
					stop_reason=response.choices[0].finish_reason if response.choices else None,
				)

			else:
				response_format: JSONSchema = {
					'name': 'agent_output',
					'strict': True,
					'schema': SchemaOptimizer.create_optimized_json_schema(
						output_format,
						remove_min_items=self.remove_min_items_from_schema,
						remove_defaults=self.remove_defaults_from_schema,
					),
				}

				# Add JSON schema to system prompt if requested
				if self.add_schema_to_system_prompt and openai_messages and openai_messages[0]['role'] == 'system':
					schema_text = f'\n<json_schema>\n{response_format}\n</json_schema>'
					if isinstance(openai_messages[0]['content'], str):
						openai_messages[0]['content'] += schema_text
					elif isinstance(openai_messages[0]['content'], Iterable):
						openai_messages[0]['content'] = list(openai_messages[0]['content']) + [
							ChatCompletionContentPartTextParam(text=schema_text, type='text')
						]

				if self.dont_force_structured_output:
					response = await self.get_client().chat.completions.create(
						model=self.model,
						messages=openai_messages,
						**model_params,
					)
				else:
					# Return structured response
					response = await self.get_client().chat.completions.create(
						model=self.model,
						messages=openai_messages,
						response_format=ResponseFormatJSONSchema(json_schema=response_format, type='json_schema'),
						**model_params,
					)

				if response.choices[0].message.content is None:
					raise ModelProviderError(
						message='Failed to parse structured output from model response',
						status_code=500,
						model=self.name,
					)

				usage = self._get_usage(response)

				parsed = output_format.model_validate_json(response.choices[0].message.content)

				return ChatInvokeCompletion(
					completion=parsed,
					usage=usage,
					stop_reason=response.choices[0].finish_reason if response.choices else None,
				)

		except RateLimitError as e:
			raise ModelRateLimitError(message=e.message, model=self.name) from e

		except APIConnectionError as e:
			raise ModelProviderError(message=str(e), model=self.name) from e

		except APIStatusError as e:
			raise ModelProviderError(message=e.message, status_code=e.status_code, model=self.name) from e

		except Exception as e:
			raise ModelProviderError(message=str(e), model=self.name) from e

```

---

## backend/browser-use/browser_use/llm/openai/like.py

```py
from dataclasses import dataclass

from browser_use.llm.openai.chat import ChatOpenAI


@dataclass
class ChatOpenAILike(ChatOpenAI):
	"""
	A class for to interact with any provider using the OpenAI API schema.

	Args:
	    model (str): The name of the OpenAI model to use.
	"""

	model: str

```

---

## backend/browser-use/browser_use/llm/openai/serializer.py

```py
from typing import overload

from openai.types.chat import (
	ChatCompletionAssistantMessageParam,
	ChatCompletionContentPartImageParam,
	ChatCompletionContentPartRefusalParam,
	ChatCompletionContentPartTextParam,
	ChatCompletionMessageFunctionToolCallParam,
	ChatCompletionMessageParam,
	ChatCompletionSystemMessageParam,
	ChatCompletionUserMessageParam,
)
from openai.types.chat.chat_completion_content_part_image_param import ImageURL
from openai.types.chat.chat_completion_message_function_tool_call_param import Function

from browser_use.llm.messages import (
	AssistantMessage,
	BaseMessage,
	ContentPartImageParam,
	ContentPartRefusalParam,
	ContentPartTextParam,
	SystemMessage,
	ToolCall,
	UserMessage,
)


class OpenAIMessageSerializer:
	"""Serializer for converting between custom message types and OpenAI message param types."""

	@staticmethod
	def _serialize_content_part_text(part: ContentPartTextParam) -> ChatCompletionContentPartTextParam:
		return ChatCompletionContentPartTextParam(text=part.text, type='text')

	@staticmethod
	def _serialize_content_part_image(part: ContentPartImageParam) -> ChatCompletionContentPartImageParam:
		return ChatCompletionContentPartImageParam(
			image_url=ImageURL(url=part.image_url.url, detail=part.image_url.detail),
			type='image_url',
		)

	@staticmethod
	def _serialize_content_part_refusal(part: ContentPartRefusalParam) -> ChatCompletionContentPartRefusalParam:
		return ChatCompletionContentPartRefusalParam(refusal=part.refusal, type='refusal')

	@staticmethod
	def _serialize_user_content(
		content: str | list[ContentPartTextParam | ContentPartImageParam],
	) -> str | list[ChatCompletionContentPartTextParam | ChatCompletionContentPartImageParam]:
		"""Serialize content for user messages (text and images allowed)."""
		if isinstance(content, str):
			return content

		serialized_parts: list[ChatCompletionContentPartTextParam | ChatCompletionContentPartImageParam] = []
		for part in content:
			if part.type == 'text':
				serialized_parts.append(OpenAIMessageSerializer._serialize_content_part_text(part))
			elif part.type == 'image_url':
				serialized_parts.append(OpenAIMessageSerializer._serialize_content_part_image(part))
		return serialized_parts

	@staticmethod
	def _serialize_system_content(
		content: str | list[ContentPartTextParam],
	) -> str | list[ChatCompletionContentPartTextParam]:
		"""Serialize content for system messages (text only)."""
		if isinstance(content, str):
			return content

		serialized_parts: list[ChatCompletionContentPartTextParam] = []
		for part in content:
			if part.type == 'text':
				serialized_parts.append(OpenAIMessageSerializer._serialize_content_part_text(part))
		return serialized_parts

	@staticmethod
	def _serialize_assistant_content(
		content: str | list[ContentPartTextParam | ContentPartRefusalParam] | None,
	) -> str | list[ChatCompletionContentPartTextParam | ChatCompletionContentPartRefusalParam] | None:
		"""Serialize content for assistant messages (text and refusal allowed)."""
		if content is None:
			return None
		if isinstance(content, str):
			return content

		serialized_parts: list[ChatCompletionContentPartTextParam | ChatCompletionContentPartRefusalParam] = []
		for part in content:
			if part.type == 'text':
				serialized_parts.append(OpenAIMessageSerializer._serialize_content_part_text(part))
			elif part.type == 'refusal':
				serialized_parts.append(OpenAIMessageSerializer._serialize_content_part_refusal(part))
		return serialized_parts

	@staticmethod
	def _serialize_tool_call(tool_call: ToolCall) -> ChatCompletionMessageFunctionToolCallParam:
		return ChatCompletionMessageFunctionToolCallParam(
			id=tool_call.id,
			function=Function(name=tool_call.function.name, arguments=tool_call.function.arguments),
			type='function',
		)

	# endregion

	# region - Serialize overloads
	@overload
	@staticmethod
	def serialize(message: UserMessage) -> ChatCompletionUserMessageParam: ...

	@overload
	@staticmethod
	def serialize(message: SystemMessage) -> ChatCompletionSystemMessageParam: ...

	@overload
	@staticmethod
	def serialize(message: AssistantMessage) -> ChatCompletionAssistantMessageParam: ...

	@staticmethod
	def serialize(message: BaseMessage) -> ChatCompletionMessageParam:
		"""Serialize a custom message to an OpenAI message param."""

		if isinstance(message, UserMessage):
			user_result: ChatCompletionUserMessageParam = {
				'role': 'user',
				'content': OpenAIMessageSerializer._serialize_user_content(message.content),
			}
			if message.name is not None:
				user_result['name'] = message.name
			return user_result

		elif isinstance(message, SystemMessage):
			system_result: ChatCompletionSystemMessageParam = {
				'role': 'system',
				'content': OpenAIMessageSerializer._serialize_system_content(message.content),
			}
			if message.name is not None:
				system_result['name'] = message.name
			return system_result

		elif isinstance(message, AssistantMessage):
			# Handle content serialization
			content = None
			if message.content is not None:
				content = OpenAIMessageSerializer._serialize_assistant_content(message.content)

			assistant_result: ChatCompletionAssistantMessageParam = {'role': 'assistant'}

			# Only add content if it's not None
			if content is not None:
				assistant_result['content'] = content

			if message.name is not None:
				assistant_result['name'] = message.name
			if message.refusal is not None:
				assistant_result['refusal'] = message.refusal
			if message.tool_calls:
				assistant_result['tool_calls'] = [OpenAIMessageSerializer._serialize_tool_call(tc) for tc in message.tool_calls]

			return assistant_result

		else:
			raise ValueError(f'Unknown message type: {type(message)}')

	@staticmethod
	def serialize_messages(messages: list[BaseMessage]) -> list[ChatCompletionMessageParam]:
		return [OpenAIMessageSerializer.serialize(m) for m in messages]

```

---

## backend/browser-use/browser_use/llm/openrouter/chat.py

```py
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, TypeVar, overload

import httpx
from openai import APIConnectionError, APIStatusError, AsyncOpenAI, RateLimitError
from openai.types.chat.chat_completion import ChatCompletion
from openai.types.shared_params.response_format_json_schema import (
	JSONSchema,
	ResponseFormatJSONSchema,
)
from pydantic import BaseModel

from browser_use.llm.base import BaseChatModel
from browser_use.llm.exceptions import ModelProviderError, ModelRateLimitError
from browser_use.llm.messages import BaseMessage
from browser_use.llm.openrouter.serializer import OpenRouterMessageSerializer
from browser_use.llm.schema import SchemaOptimizer
from browser_use.llm.views import ChatInvokeCompletion, ChatInvokeUsage

T = TypeVar('T', bound=BaseModel)


@dataclass
class ChatOpenRouter(BaseChatModel):
	"""
	A wrapper around OpenRouter's chat API, which provides access to various LLM models
	through a unified OpenAI-compatible interface.

	This class implements the BaseChatModel protocol for OpenRouter's API.
	"""

	# Model configuration
	model: str

	# Model params
	temperature: float | None = None
	top_p: float | None = None
	seed: int | None = None

	# Client initialization parameters
	api_key: str | None = None
	http_referer: str | None = None  # OpenRouter specific parameter for tracking
	base_url: str | httpx.URL = 'https://openrouter.ai/api/v1'
	timeout: float | httpx.Timeout | None = None
	max_retries: int = 10
	default_headers: Mapping[str, str] | None = None
	default_query: Mapping[str, object] | None = None
	http_client: httpx.AsyncClient | None = None
	_strict_response_validation: bool = False
	extra_body: dict[str, Any] | None = None

	# Static
	@property
	def provider(self) -> str:
		return 'openrouter'

	def _get_client_params(self) -> dict[str, Any]:
		"""Prepare client parameters dictionary."""
		# Define base client params
		base_params = {
			'api_key': self.api_key,
			'base_url': self.base_url,
			'timeout': self.timeout,
			'max_retries': self.max_retries,
			'default_headers': self.default_headers,
			'default_query': self.default_query,
			'_strict_response_validation': self._strict_response_validation,
			'top_p': self.top_p,
			'seed': self.seed,
		}

		# Create client_params dict with non-None values
		client_params = {k: v for k, v in base_params.items() if v is not None}

		# Add http_client if provided
		if self.http_client is not None:
			client_params['http_client'] = self.http_client

		return client_params

	def get_client(self) -> AsyncOpenAI:
		"""
		Returns an AsyncOpenAI client configured for OpenRouter.

		Returns:
		    AsyncOpenAI: An instance of the AsyncOpenAI client with OpenRouter base URL.
		"""
		if not hasattr(self, '_client'):
			client_params = self._get_client_params()
			self._client = AsyncOpenAI(**client_params)
		return self._client

	@property
	def name(self) -> str:
		return str(self.model)

	def _get_usage(self, response: ChatCompletion) -> ChatInvokeUsage | None:
		"""Extract usage information from the OpenRouter response."""
		if response.usage is None:
			return None

		prompt_details = getattr(response.usage, 'prompt_tokens_details', None)
		cached_tokens = prompt_details.cached_tokens if prompt_details else None

		return ChatInvokeUsage(
			prompt_tokens=response.usage.prompt_tokens,
			prompt_cached_tokens=cached_tokens,
			prompt_cache_creation_tokens=None,
			prompt_image_tokens=None,
			# Completion
			completion_tokens=response.usage.completion_tokens,
			total_tokens=response.usage.total_tokens,
		)

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: None = None) -> ChatInvokeCompletion[str]: ...

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: type[T]) -> ChatInvokeCompletion[T]: ...

	async def ainvoke(
		self, messages: list[BaseMessage], output_format: type[T] | None = None
	) -> ChatInvokeCompletion[T] | ChatInvokeCompletion[str]:
		"""
		Invoke the model with the given messages through OpenRouter.

		Args:
		    messages: List of chat messages
		    output_format: Optional Pydantic model class for structured output

		Returns:
		    Either a string response or an instance of output_format
		"""
		openrouter_messages = OpenRouterMessageSerializer.serialize_messages(messages)

		# Set up extra headers for OpenRouter
		extra_headers = {}
		if self.http_referer:
			extra_headers['HTTP-Referer'] = self.http_referer

		try:
			if output_format is None:
				# Return string response
				response = await self.get_client().chat.completions.create(
					model=self.model,
					messages=openrouter_messages,
					temperature=self.temperature,
					top_p=self.top_p,
					seed=self.seed,
					extra_headers=extra_headers,
					**(self.extra_body or {}),
				)

				usage = self._get_usage(response)
				return ChatInvokeCompletion(
					completion=response.choices[0].message.content or '',
					usage=usage,
				)

			else:
				# Create a JSON schema for structured output
				schema = SchemaOptimizer.create_optimized_json_schema(output_format)

				response_format_schema: JSONSchema = {
					'name': 'agent_output',
					'strict': True,
					'schema': schema,
				}

				# Return structured response
				response = await self.get_client().chat.completions.create(
					model=self.model,
					messages=openrouter_messages,
					temperature=self.temperature,
					top_p=self.top_p,
					seed=self.seed,
					response_format=ResponseFormatJSONSchema(
						json_schema=response_format_schema,
						type='json_schema',
					),
					extra_headers=extra_headers,
					**(self.extra_body or {}),
				)

			if response.choices[0].message.content is None:
				raise ModelProviderError(
					message='Failed to parse structured output from model response',
					status_code=500,
					model=self.name,
				)
			usage = self._get_usage(response)

			# Strip markdown code blocks if present (some models wrap JSON in ``\`json ... ``\`)
			content = response.choices[0].message.content.strip()
			if content.startswith('``\`'):
				# Remove opening fence (``\`json or ``\`)
				first_newline = content.find('\n')
				if first_newline != -1:
					content = content[first_newline + 1 :]
				# Remove closing fence
				if content.endswith('``\`'):
					content = content[:-3].rstrip()

			parsed = output_format.model_validate_json(content)

			return ChatInvokeCompletion(
				completion=parsed,
				usage=usage,
			)

		except RateLimitError as e:
			raise ModelRateLimitError(message=e.message, model=self.name) from e

		except APIConnectionError as e:
			raise ModelProviderError(message=str(e), model=self.name) from e

		except APIStatusError as e:
			raise ModelProviderError(message=e.message, status_code=e.status_code, model=self.name) from e

		except Exception as e:
			raise ModelProviderError(message=str(e), model=self.name) from e

```

---

## backend/browser-use/browser_use/llm/openrouter/serializer.py

```py
from openai.types.chat import ChatCompletionMessageParam

from browser_use.llm.messages import BaseMessage
from browser_use.llm.openai.serializer import OpenAIMessageSerializer


class OpenRouterMessageSerializer:
	"""
	Serializer for converting between custom message types and OpenRouter message formats.

	OpenRouter uses the OpenAI-compatible API, so we can reuse the OpenAI serializer.
	"""

	@staticmethod
	def serialize_messages(messages: list[BaseMessage]) -> list[ChatCompletionMessageParam]:
		"""
		Serialize a list of browser_use messages to OpenRouter-compatible messages.

		Args:
		    messages: List of browser_use messages

		Returns:
		    List of OpenRouter-compatible messages (identical to OpenAI format)
		"""
		# OpenRouter uses the same message format as OpenAI
		return OpenAIMessageSerializer.serialize_messages(messages)

```

---

## backend/browser-use/browser_use/llm/schema.py

```py
"""
Utilities for creating optimized Pydantic schemas for LLM usage.
"""

from typing import Any

from pydantic import BaseModel


class SchemaOptimizer:
	@staticmethod
	def create_optimized_json_schema(
		model: type[BaseModel],
		*,
		remove_min_items: bool = False,
		remove_defaults: bool = False,
	) -> dict[str, Any]:
		"""
		Create the most optimized schema by flattening all $ref/$defs while preserving
		FULL descriptions and ALL action definitions. Also ensures OpenAI strict mode compatibility.

		Args:
			model: The Pydantic model to optimize
			remove_min_items: If True, remove minItems from the schema
			remove_defaults: If True, remove default values from the schema

		Returns:
			Optimized schema with all $refs resolved and strict mode compatibility
		"""
		# Generate original schema
		original_schema = model.model_json_schema()

		# Extract $defs for reference resolution, then flatten everything
		defs_lookup = original_schema.get('$defs', {})

		# Create optimized schema with flattening
		# Pass flags to optimize_schema via closure
		def optimize_schema(obj: Any, defs_lookup: dict[str, Any] | None = None, *, in_properties: bool = False) -> Any:
			"""Apply all optimization techniques including flattening all $ref/$defs"""
			if isinstance(obj, dict):
				optimized: dict[str, Any] = {}
				flattened_ref: dict[str, Any] | None = None

				# Skip unnecessary fields AND $defs (we'll inline everything)
				skip_fields = ['additionalProperties', '$defs']

				for key, value in obj.items():
					if key in skip_fields:
						continue

					# Skip metadata "title" unless we're iterating inside an actual `properties` map
					if key == 'title' and not in_properties:
						continue

					# Preserve FULL descriptions without truncation, skip empty ones
					elif key == 'description':
						if value:  # Only include non-empty descriptions
							optimized[key] = value

					# Handle type field - must recursively process in case value contains $ref
					elif key == 'type':
						optimized[key] = value if not isinstance(value, (dict, list)) else optimize_schema(value, defs_lookup)

					# FLATTEN: Resolve $ref by inlining the actual definition
					elif key == '$ref' and defs_lookup:
						ref_path = value.split('/')[-1]  # Get the definition name from "#/$defs/SomeName"
						if ref_path in defs_lookup:
							# Get the referenced definition and flatten it
							referenced_def = defs_lookup[ref_path]
							flattened_ref = optimize_schema(referenced_def, defs_lookup)

					# Skip minItems/min_items and default if requested (check BEFORE processing)
					elif key in ('minItems', 'min_items') and remove_min_items:
						continue  # Skip minItems/min_items
					elif key == 'default' and remove_defaults:
						continue  # Skip default values

					# Keep all anyOf structures (action unions) and resolve any $refs within
					elif key == 'anyOf' and isinstance(value, list):
						optimized[key] = [optimize_schema(item, defs_lookup) for item in value]

					# Recursively optimize nested structures
					elif key in ['properties', 'items']:
						optimized[key] = optimize_schema(
							value,
							defs_lookup,
							in_properties=(key == 'properties'),
						)

					# Keep essential validation fields
					elif key in [
						'type',
						'required',
						'minimum',
						'maximum',
						'minItems',
						'min_items',
						'maxItems',
						'pattern',
						'default',
					]:
						optimized[key] = value if not isinstance(value, (dict, list)) else optimize_schema(value, defs_lookup)

					# Recursively process all other fields
					else:
						optimized[key] = optimize_schema(value, defs_lookup) if isinstance(value, (dict, list)) else value

				# If we have a flattened reference, merge it with the optimized properties
				if flattened_ref is not None and isinstance(flattened_ref, dict):
					# Start with the flattened reference as the base
					result = flattened_ref.copy()

					# Merge in any sibling properties that were processed
					for key, value in optimized.items():
						# Preserve descriptions from the original object if they exist
						if key == 'description' and 'description' not in result:
							result[key] = value
						elif key != 'description':  # Don't overwrite description from flattened ref
							result[key] = value

					return result
				else:
					# No $ref, just return the optimized object
					# CRITICAL: Add additionalProperties: false to ALL objects for OpenAI strict mode
					if optimized.get('type') == 'object':
						optimized['additionalProperties'] = False

					return optimized

			elif isinstance(obj, list):
				return [optimize_schema(item, defs_lookup, in_properties=in_properties) for item in obj]
			return obj

		optimized_result = optimize_schema(original_schema, defs_lookup)

		# Ensure we have a dictionary (should always be the case for schema root)
		if not isinstance(optimized_result, dict):
			raise ValueError('Optimized schema result is not a dictionary')

		optimized_schema: dict[str, Any] = optimized_result

		# Additional pass to ensure ALL objects have additionalProperties: false
		def ensure_additional_properties_false(obj: Any) -> None:
			"""Ensure all objects have additionalProperties: false"""
			if isinstance(obj, dict):
				# If it's an object type, ensure additionalProperties is false
				if obj.get('type') == 'object':
					obj['additionalProperties'] = False

				# Recursively apply to all values
				for value in obj.values():
					if isinstance(value, (dict, list)):
						ensure_additional_properties_false(value)
			elif isinstance(obj, list):
				for item in obj:
					if isinstance(item, (dict, list)):
						ensure_additional_properties_false(item)

		ensure_additional_properties_false(optimized_schema)
		SchemaOptimizer._make_strict_compatible(optimized_schema)

		# Final pass to remove minItems/min_items and default values if requested
		if remove_min_items or remove_defaults:

			def remove_forbidden_fields(obj: Any) -> None:
				"""Recursively remove minItems/min_items and default values"""
				if isinstance(obj, dict):
					# Remove forbidden keys
					if remove_min_items:
						obj.pop('minItems', None)
						obj.pop('min_items', None)
					if remove_defaults:
						obj.pop('default', None)
					# Recursively process all values
					for value in obj.values():
						if isinstance(value, (dict, list)):
							remove_forbidden_fields(value)
				elif isinstance(obj, list):
					for item in obj:
						if isinstance(item, (dict, list)):
							remove_forbidden_fields(item)

			remove_forbidden_fields(optimized_schema)

		return optimized_schema

	@staticmethod
	def _make_strict_compatible(schema: dict[str, Any] | list[Any]) -> None:
		"""Ensure all properties are required for OpenAI strict mode"""
		if isinstance(schema, dict):
			# First recursively apply to nested objects
			for key, value in schema.items():
				if isinstance(value, (dict, list)) and key != 'required':
					SchemaOptimizer._make_strict_compatible(value)

			# Then update required for this level
			if 'properties' in schema and 'type' in schema and schema['type'] == 'object':
				# Add all properties to required array
				all_props = list(schema['properties'].keys())
				schema['required'] = all_props  # Set all properties as required

		elif isinstance(schema, list):
			for item in schema:
				SchemaOptimizer._make_strict_compatible(item)

	@staticmethod
	def create_gemini_optimized_schema(model: type[BaseModel]) -> dict[str, Any]:
		"""
		Create Gemini-optimized schema, preserving explicit `required` arrays so Gemini
		respects mandatory fields defined by the caller.

		Args:
			model: The Pydantic model to optimize

		Returns:
			Optimized schema suitable for Gemini structured output
		"""
		return SchemaOptimizer.create_optimized_json_schema(model)

```

---

## backend/browser-use/browser_use/llm/tests/test_anthropic_cache.py

```py
import logging
from typing import cast

from browser_use.agent.service import Agent
from browser_use.llm.anthropic.chat import ChatAnthropic
from browser_use.llm.anthropic.serializer import AnthropicMessageSerializer, NonSystemMessage
from browser_use.llm.messages import (
	AssistantMessage,
	BaseMessage,
	ContentPartImageParam,
	ContentPartTextParam,
	Function,
	ImageURL,
	SystemMessage,
	ToolCall,
	UserMessage,
)

logger = logging.getLogger(__name__)


class TestAnthropicCache:
	"""Comprehensive test for Anthropic cache serialization."""

	def test_cache_basic_functionality(self):
		"""Test basic cache functionality for all message types."""
		# Test cache with different message types
		messages: list[BaseMessage] = [
			SystemMessage(content='System message!', cache=True),
			UserMessage(content='User message!', cache=True),
			AssistantMessage(content='Assistant message!', cache=False),
		]

		anthropic_messages, system_message = AnthropicMessageSerializer.serialize_messages(messages)

		assert len(anthropic_messages) == 2
		assert isinstance(system_message, list)
		assert isinstance(anthropic_messages[0]['content'], list)
		assert isinstance(anthropic_messages[1]['content'], str)

		# Test cache with assistant message
		agent_messages: list[BaseMessage] = [
			SystemMessage(content='System message!'),
			UserMessage(content='User message!'),
			AssistantMessage(content='Assistant message!', cache=True),
		]

		anthropic_messages, system_message = AnthropicMessageSerializer.serialize_messages(agent_messages)

		assert isinstance(system_message, str)
		assert isinstance(anthropic_messages[0]['content'], str)
		assert isinstance(anthropic_messages[1]['content'], list)

	def test_cache_with_tool_calls(self):
		"""Test cache functionality with tool calls."""
		tool_call = ToolCall(id='test_id', function=Function(name='test_function', arguments='{"arg": "value"}'))

		# Assistant with tool calls and cache
		assistant_with_tools = AssistantMessage(content='Assistant with tools', tool_calls=[tool_call], cache=True)
		messages, _ = AnthropicMessageSerializer.serialize_messages([assistant_with_tools])

		assert len(messages) == 1
		assert isinstance(messages[0]['content'], list)
		# Should have both text and tool_use blocks
		assert len(messages[0]['content']) >= 2

	def test_cache_with_images(self):
		"""Test cache functionality with image content."""
		user_with_image = UserMessage(
			content=[
				ContentPartTextParam(text='Here is an image:', type='text'),
				ContentPartImageParam(image_url=ImageURL(url='https://example.com/image.jpg'), type='image_url'),
			],
			cache=True,
		)

		messages, _ = AnthropicMessageSerializer.serialize_messages([user_with_image])

		assert len(messages) == 1
		assert isinstance(messages[0]['content'], list)
		assert len(messages[0]['content']) == 2

	def test_cache_with_base64_images(self):
		"""Test cache functionality with base64 images."""
		base64_url = 'data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

		user_with_base64 = UserMessage(
			content=[
				ContentPartTextParam(text='Base64 image:', type='text'),
				ContentPartImageParam(image_url=ImageURL(url=base64_url), type='image_url'),
			],
			cache=True,
		)

		messages, _ = AnthropicMessageSerializer.serialize_messages([user_with_base64])

		assert len(messages) == 1
		assert isinstance(messages[0]['content'], list)

	def test_cache_content_types(self):
		"""Test different content types with cache."""
		# String content with cache should become list
		user_string_cached = UserMessage(content='String message', cache=True)
		messages, _ = AnthropicMessageSerializer.serialize_messages([user_string_cached])
		assert isinstance(messages[0]['content'], list)

		# String content without cache should remain string
		user_string_no_cache = UserMessage(content='String message', cache=False)
		messages, _ = AnthropicMessageSerializer.serialize_messages([user_string_no_cache])
		assert isinstance(messages[0]['content'], str)

		# List content maintains list format regardless of cache
		user_list_cached = UserMessage(content=[ContentPartTextParam(text='List message', type='text')], cache=True)
		messages, _ = AnthropicMessageSerializer.serialize_messages([user_list_cached])
		assert isinstance(messages[0]['content'], list)

		user_list_no_cache = UserMessage(content=[ContentPartTextParam(text='List message', type='text')], cache=False)
		messages, _ = AnthropicMessageSerializer.serialize_messages([user_list_no_cache])
		assert isinstance(messages[0]['content'], list)

	def test_assistant_cache_empty_content(self):
		"""Test AssistantMessage with empty content and cache."""
		# With cache
		assistant_empty_cached = AssistantMessage(content=None, cache=True)
		messages, _ = AnthropicMessageSerializer.serialize_messages([assistant_empty_cached])

		assert len(messages) == 1
		assert isinstance(messages[0]['content'], list)

		# Without cache
		assistant_empty_no_cache = AssistantMessage(content=None, cache=False)
		messages, _ = AnthropicMessageSerializer.serialize_messages([assistant_empty_no_cache])

		assert len(messages) == 1
		assert isinstance(messages[0]['content'], str)

	def test_mixed_cache_scenarios(self):
		"""Test various combinations of cached and non-cached messages."""
		messages_list: list[BaseMessage] = [
			SystemMessage(content='System with cache', cache=True),
			UserMessage(content='User with cache', cache=True),
			AssistantMessage(content='Assistant without cache', cache=False),
			UserMessage(content='User without cache', cache=False),
			AssistantMessage(content='Assistant with cache', cache=True),
		]

		serialized_messages, system_message = AnthropicMessageSerializer.serialize_messages(messages_list)

		# Check system message is cached (becomes list)
		assert isinstance(system_message, list)

		# Check serialized messages
		assert len(serialized_messages) == 4

		# User with cache should be string (cache was cleaned to False by _clean_cache_messages)
		# Only the last message with cache=True remains cached
		assert isinstance(serialized_messages[0]['content'], str)

		# Assistant without cache should be string
		assert isinstance(serialized_messages[1]['content'], str)

		# User without cache should be string
		assert isinstance(serialized_messages[2]['content'], str)

		# Assistant with cache should be list (this is the last cached message)
		assert isinstance(serialized_messages[3]['content'], list)

	def test_system_message_cache_behavior(self):
		"""Test SystemMessage specific cache behavior."""
		# With cache
		system_cached = SystemMessage(content='System message with cache', cache=True)
		result = AnthropicMessageSerializer.serialize(system_cached)
		assert isinstance(result, SystemMessage)

		# Test serialization to string format
		serialized_content = AnthropicMessageSerializer._serialize_content_to_str(result.content, use_cache=True)
		assert isinstance(serialized_content, list)

		# Without cache
		system_no_cache = SystemMessage(content='System message without cache', cache=False)
		result = AnthropicMessageSerializer.serialize(system_no_cache)
		assert isinstance(result, SystemMessage)

		serialized_content = AnthropicMessageSerializer._serialize_content_to_str(result.content, use_cache=False)
		assert isinstance(serialized_content, str)

	def test_agent_messages_integration(self):
		"""Test integration with actual agent messages."""
		agent = Agent(task='Hello, world!', llm=ChatAnthropic(''))

		messages = agent.message_manager.get_messages()
		anthropic_messages, system_message = AnthropicMessageSerializer.serialize_messages(messages)

		# System message should be properly handled
		assert system_message is not None

	def test_cache_cleaning_last_message_only(self):
		"""Test that only the last cache=True message remains cached."""
		# Create multiple messages with cache=True
		messages_list: list[BaseMessage] = [
			UserMessage(content='First user message', cache=True),
			AssistantMessage(content='First assistant message', cache=True),
			UserMessage(content='Second user message', cache=True),
			AssistantMessage(content='Second assistant message', cache=False),
			UserMessage(content='Third user message', cache=True),  # This should be the only one cached
		]

		# Test the cleaning method directly (only accepts non-system messages)
		normal_messages = cast(list[NonSystemMessage], [msg for msg in messages_list if not isinstance(msg, SystemMessage)])
		cleaned_messages = AnthropicMessageSerializer._clean_cache_messages(normal_messages)

		# Verify only the last cache=True message remains cached
		assert not cleaned_messages[0].cache  # First user message should be uncached
		assert not cleaned_messages[1].cache  # First assistant message should be uncached
		assert not cleaned_messages[2].cache  # Second user message should be uncached
		assert not cleaned_messages[3].cache  # Second assistant message was already uncached
		assert cleaned_messages[4].cache  # Third user message should remain cached

		# Test through serialize_messages
		serialized_messages, system_message = AnthropicMessageSerializer.serialize_messages(messages_list)

		# Count how many messages have list content (indicating caching)
		cached_content_count = sum(1 for msg in serialized_messages if isinstance(msg['content'], list))

		# Only one message should have cached content
		assert cached_content_count == 1

		# The last message should be the cached one
		assert isinstance(serialized_messages[-1]['content'], list)

	def test_cache_cleaning_with_system_message(self):
		"""Test that system messages are not affected by cache cleaning logic."""
		messages_list: list[BaseMessage] = [
			SystemMessage(content='System message', cache=True),  # System messages are handled separately
			UserMessage(content='First user message', cache=True),
			AssistantMessage(content='Assistant message', cache=True),  # This should be the only normal message cached
		]

		# Test through serialize_messages to see the full integration
		serialized_messages, system_message = AnthropicMessageSerializer.serialize_messages(messages_list)

		# System message should be cached
		assert isinstance(system_message, list)

		# Only one normal message should have cached content (the last one)
		cached_content_count = sum(1 for msg in serialized_messages if isinstance(msg['content'], list))
		assert cached_content_count == 1

		# The last message should be the cached one
		assert isinstance(serialized_messages[-1]['content'], list)

	def test_cache_cleaning_no_cached_messages(self):
		"""Test that messages without cache=True are not affected."""
		normal_messages_list = [
			UserMessage(content='User message 1', cache=False),
			AssistantMessage(content='Assistant message 1', cache=False),
			UserMessage(content='User message 2', cache=False),
		]

		cleaned_messages = AnthropicMessageSerializer._clean_cache_messages(normal_messages_list)

		# All messages should remain uncached
		for msg in cleaned_messages:
			assert not msg.cache

	def test_max_4_cache_blocks(self):
		"""Test that the max number of cache blocks is 4."""
		agent = Agent(task='Hello, world!', llm=ChatAnthropic(''))
		messages = agent.message_manager.get_messages()
		anthropic_messages, system_message = AnthropicMessageSerializer.serialize_messages(messages)

		logger.info(anthropic_messages)
		logger.info(system_message)

	def test_cache_only_last_block_in_message(self):
		"""Test that only the LAST block in a message gets cache_control when cache=True."""
		# Test UserMessage with multiple text parts
		user_msg = UserMessage(
			content=[
				ContentPartTextParam(text='Part 1', type='text'),
				ContentPartTextParam(text='Part 2', type='text'),
				ContentPartTextParam(text='Part 3', type='text'),
			],
			cache=True,
		)
		serialized = AnthropicMessageSerializer.serialize(user_msg)
		assert isinstance(serialized['content'], list)
		content_blocks = serialized['content']

		# Count blocks with cache_control
		# Note: content_blocks are dicts at runtime despite type annotations
		cache_count = sum(1 for block in content_blocks if block.get('cache_control') is not None)  # type: ignore[attr-defined]
		assert cache_count == 1, f'Expected 1 cache_control block, got {cache_count}'

		# Verify it's the last block
		assert content_blocks[-1].get('cache_control') is not None  # type: ignore[attr-defined]
		assert content_blocks[0].get('cache_control') is None  # type: ignore[attr-defined]
		assert content_blocks[1].get('cache_control') is None  # type: ignore[attr-defined]

	def test_cache_only_last_tool_call(self):
		"""Test that only the LAST tool_use block gets cache_control."""
		tool_calls = [
			ToolCall(id='id1', function=Function(name='func1', arguments='{"arg": "1"}')),
			ToolCall(id='id2', function=Function(name='func2', arguments='{"arg": "2"}')),
			ToolCall(id='id3', function=Function(name='func3', arguments='{"arg": "3"}')),
		]

		assistant_msg = AssistantMessage(content=None, tool_calls=tool_calls, cache=True)
		serialized = AnthropicMessageSerializer.serialize(assistant_msg)
		assert isinstance(serialized['content'], list)
		content_blocks = serialized['content']

		# Count tool_use blocks with cache_control
		# Note: content_blocks are dicts at runtime despite type annotations
		cache_count = sum(1 for block in content_blocks if block.get('cache_control') is not None)  # type: ignore[attr-defined]
		assert cache_count == 1, f'Expected 1 cache_control block, got {cache_count}'

		# Verify it's the last tool_use block
		assert content_blocks[-1].get('cache_control') is not None  # type: ignore[attr-defined]
		assert content_blocks[0].get('cache_control') is None  # type: ignore[attr-defined]
		assert content_blocks[1].get('cache_control') is None  # type: ignore[attr-defined]

	def test_cache_assistant_with_content_and_tools(self):
		"""Test AssistantMessage with both content and tool calls - only last tool gets cache."""
		tool_call = ToolCall(id='test_id', function=Function(name='test_function', arguments='{"arg": "value"}'))

		assistant_msg = AssistantMessage(
			content=[
				ContentPartTextParam(text='Text part 1', type='text'),
				ContentPartTextParam(text='Text part 2', type='text'),
			],
			tool_calls=[tool_call],
			cache=True,
		)
		serialized = AnthropicMessageSerializer.serialize(assistant_msg)
		assert isinstance(serialized['content'], list)
		content_blocks = serialized['content']

		# Should have 2 text blocks + 1 tool_use block = 3 blocks total
		assert len(content_blocks) == 3

		# Only the last block (tool_use) should have cache_control
		# Note: content_blocks are dicts at runtime despite type annotations
		cache_count = sum(1 for block in content_blocks if block.get('cache_control') is not None)  # type: ignore[attr-defined]
		assert cache_count == 1, f'Expected 1 cache_control block, got {cache_count}'
		assert content_blocks[-1].get('cache_control') is not None  # type: ignore[attr-defined]  # Last tool_use block
		assert content_blocks[0].get('cache_control') is None  # type: ignore[attr-defined]  # First text block
		assert content_blocks[1].get('cache_control') is None  # type: ignore[attr-defined]  # Second text block


if __name__ == '__main__':
	test_instance = TestAnthropicCache()
	test_instance.test_cache_basic_functionality()
	test_instance.test_cache_with_tool_calls()
	test_instance.test_cache_with_images()
	test_instance.test_cache_with_base64_images()
	test_instance.test_cache_content_types()
	test_instance.test_assistant_cache_empty_content()
	test_instance.test_mixed_cache_scenarios()
	test_instance.test_system_message_cache_behavior()
	test_instance.test_agent_messages_integration()
	test_instance.test_cache_cleaning_last_message_only()
	test_instance.test_cache_cleaning_with_system_message()
	test_instance.test_cache_cleaning_no_cached_messages()
	test_instance.test_max_4_cache_blocks()
	test_instance.test_cache_only_last_block_in_message()
	test_instance.test_cache_only_last_tool_call()
	test_instance.test_cache_assistant_with_content_and_tools()
	print('All cache tests passed!')

```

---

## backend/browser-use/browser_use/llm/tests/test_chat_models.py

```py
import os

import pytest
from pydantic import BaseModel

from browser_use.llm import ChatAnthropic, ChatGoogle, ChatGroq, ChatOpenAI, ChatOpenRouter
from browser_use.llm.messages import ContentPartTextParam

# Optional OCI import
try:
	from examples.models.oci_models import xai_llm

	OCI_MODELS_AVAILABLE = True
except ImportError:
	xai_llm = None
	OCI_MODELS_AVAILABLE = False


class CapitalResponse(BaseModel):
	"""Structured response for capital question"""

	country: str
	capital: str


class TestChatModels:
	from browser_use.llm.messages import (
		AssistantMessage,
		BaseMessage,
		SystemMessage,
		UserMessage,
	)

	"""Test suite for all chat model implementations"""

	# Test Constants
	SYSTEM_MESSAGE = SystemMessage(content=[ContentPartTextParam(text='You are a helpful assistant.', type='text')])
	FRANCE_QUESTION = UserMessage(content='What is the capital of France? Answer in one word.')
	FRANCE_ANSWER = AssistantMessage(content='Paris')
	GERMANY_QUESTION = UserMessage(content='What is the capital of Germany? Answer in one word.')

	# Expected values
	EXPECTED_GERMANY_CAPITAL = 'berlin'
	EXPECTED_FRANCE_COUNTRY = 'france'
	EXPECTED_FRANCE_CAPITAL = 'paris'

	# Test messages for conversation
	CONVERSATION_MESSAGES: list[BaseMessage] = [
		SYSTEM_MESSAGE,
		FRANCE_QUESTION,
		FRANCE_ANSWER,
		GERMANY_QUESTION,
	]

	# Test messages for structured output
	STRUCTURED_MESSAGES: list[BaseMessage] = [UserMessage(content='What is the capital of France?')]

	# OpenAI Tests
	@pytest.fixture
	def openrouter_chat(self):
		"""Provides an initialized ChatOpenRouter client for tests."""
		if not os.getenv('OPENROUTER_API_KEY'):
			pytest.skip('OPENROUTER_API_KEY not set')
		return ChatOpenRouter(model='openai/gpt-4o-mini', api_key=os.getenv('OPENROUTER_API_KEY'), temperature=0)

	@pytest.mark.asyncio
	async def test_openai_ainvoke_normal(self):
		"""Test normal text response from OpenAI"""
		# Skip if no API key
		if not os.getenv('OPENAI_API_KEY'):
			pytest.skip('OPENAI_API_KEY not set')

		chat = ChatOpenAI(model='gpt-4o-mini', temperature=0)
		response = await chat.ainvoke(self.CONVERSATION_MESSAGES)

		completion = response.completion

		assert isinstance(completion, str)
		assert self.EXPECTED_GERMANY_CAPITAL in completion.lower()

	@pytest.mark.asyncio
	async def test_openai_ainvoke_structured(self):
		"""Test structured output from OpenAI"""
		# Skip if no API key
		if not os.getenv('OPENAI_API_KEY'):
			pytest.skip('OPENAI_API_KEY not set')

		chat = ChatOpenAI(model='gpt-4o-mini', temperature=0)
		response = await chat.ainvoke(self.STRUCTURED_MESSAGES, output_format=CapitalResponse)
		completion = response.completion

		assert isinstance(completion, CapitalResponse)
		assert completion.country.lower() == self.EXPECTED_FRANCE_COUNTRY
		assert completion.capital.lower() == self.EXPECTED_FRANCE_CAPITAL

	# Anthropic Tests
	@pytest.mark.asyncio
	async def test_anthropic_ainvoke_normal(self):
		"""Test normal text response from Anthropic"""
		# Skip if no API key
		if not os.getenv('ANTHROPIC_API_KEY'):
			pytest.skip('ANTHROPIC_API_KEY not set')

		chat = ChatAnthropic(model='claude-3-5-haiku-latest', max_tokens=100, temperature=0)
		response = await chat.ainvoke(self.CONVERSATION_MESSAGES)
		completion = response.completion

		assert isinstance(completion, str)
		assert self.EXPECTED_GERMANY_CAPITAL in completion.lower()

	@pytest.mark.asyncio
	async def test_anthropic_ainvoke_structured(self):
		"""Test structured output from Anthropic"""
		# Skip if no API key
		if not os.getenv('ANTHROPIC_API_KEY'):
			pytest.skip('ANTHROPIC_API_KEY not set')

		chat = ChatAnthropic(model='claude-3-5-haiku-latest', max_tokens=100, temperature=0)
		response = await chat.ainvoke(self.STRUCTURED_MESSAGES, output_format=CapitalResponse)
		completion = response.completion

		assert isinstance(completion, CapitalResponse)
		assert completion.country.lower() == self.EXPECTED_FRANCE_COUNTRY
		assert completion.capital.lower() == self.EXPECTED_FRANCE_CAPITAL

	# Google Gemini Tests
	@pytest.mark.asyncio
	async def test_google_ainvoke_normal(self):
		"""Test normal text response from Google Gemini"""
		# Skip if no API key
		if not os.getenv('GOOGLE_API_KEY'):
			pytest.skip('GOOGLE_API_KEY not set')

		chat = ChatGoogle(model='gemini-2.0-flash', api_key=os.getenv('GOOGLE_API_KEY'), temperature=0)
		response = await chat.ainvoke(self.CONVERSATION_MESSAGES)
		completion = response.completion

		assert isinstance(completion, str)
		assert self.EXPECTED_GERMANY_CAPITAL in completion.lower()

	@pytest.mark.asyncio
	async def test_google_ainvoke_structured(self):
		"""Test structured output from Google Gemini"""
		# Skip if no API key
		if not os.getenv('GOOGLE_API_KEY'):
			pytest.skip('GOOGLE_API_KEY not set')

		chat = ChatGoogle(model='gemini-2.0-flash', api_key=os.getenv('GOOGLE_API_KEY'), temperature=0)
		response = await chat.ainvoke(self.STRUCTURED_MESSAGES, output_format=CapitalResponse)
		completion = response.completion

		assert isinstance(completion, CapitalResponse)
		assert completion.country.lower() == self.EXPECTED_FRANCE_COUNTRY
		assert completion.capital.lower() == self.EXPECTED_FRANCE_CAPITAL

	# Google Gemini with Vertex AI Tests
	@pytest.mark.asyncio
	async def test_google_vertex_ainvoke_normal(self):
		"""Test normal text response from Google Gemini via Vertex AI"""
		# Skip if no project ID
		if not os.getenv('GOOGLE_CLOUD_PROJECT'):
			pytest.skip('GOOGLE_CLOUD_PROJECT not set')

		chat = ChatGoogle(
			model='gemini-2.0-flash',
			vertexai=True,
			project=os.getenv('GOOGLE_CLOUD_PROJECT'),
			location='us-central1',
			temperature=0,
		)
		response = await chat.ainvoke(self.CONVERSATION_MESSAGES)
		completion = response.completion

		assert isinstance(completion, str)
		assert self.EXPECTED_GERMANY_CAPITAL in completion.lower()

	@pytest.mark.asyncio
	async def test_google_vertex_ainvoke_structured(self):
		"""Test structured output from Google Gemini via Vertex AI"""
		# Skip if no project ID
		if not os.getenv('GOOGLE_CLOUD_PROJECT'):
			pytest.skip('GOOGLE_CLOUD_PROJECT not set')

		chat = ChatGoogle(
			model='gemini-2.0-flash',
			vertexai=True,
			project=os.getenv('GOOGLE_CLOUD_PROJECT'),
			location='us-central1',
			temperature=0,
		)
		response = await chat.ainvoke(self.STRUCTURED_MESSAGES, output_format=CapitalResponse)
		completion = response.completion

		assert isinstance(completion, CapitalResponse)
		assert completion.country.lower() == self.EXPECTED_FRANCE_COUNTRY
		assert completion.capital.lower() == self.EXPECTED_FRANCE_CAPITAL

	# Groq Tests
	@pytest.mark.asyncio
	async def test_groq_ainvoke_normal(self):
		"""Test normal text response from Groq"""
		# Skip if no API key
		if not os.getenv('GROQ_API_KEY'):
			pytest.skip('GROQ_API_KEY not set')

		chat = ChatGroq(model='meta-llama/llama-4-maverick-17b-128e-instruct', temperature=0)
		response = await chat.ainvoke(self.CONVERSATION_MESSAGES)
		completion = response.completion

		assert isinstance(completion, str)
		assert self.EXPECTED_GERMANY_CAPITAL in completion.lower()

	@pytest.mark.asyncio
	async def test_groq_ainvoke_structured(self):
		"""Test structured output from Groq"""
		# Skip if no API key
		if not os.getenv('GROQ_API_KEY'):
			pytest.skip('GROQ_API_KEY not set')

		chat = ChatGroq(model='meta-llama/llama-4-maverick-17b-128e-instruct', temperature=0)
		response = await chat.ainvoke(self.STRUCTURED_MESSAGES, output_format=CapitalResponse)

		completion = response.completion

		assert isinstance(completion, CapitalResponse)
		assert completion.country.lower() == self.EXPECTED_FRANCE_COUNTRY
		assert completion.capital.lower() == self.EXPECTED_FRANCE_CAPITAL

	# OpenRouter Tests
	@pytest.mark.asyncio
	async def test_openrouter_ainvoke_normal(self):
		"""Test normal text response from OpenRouter"""
		# Skip if no API key
		if not os.getenv('OPENROUTER_API_KEY'):
			pytest.skip('OPENROUTER_API_KEY not set')

		chat = ChatOpenRouter(model='openai/gpt-4o-mini', api_key=os.getenv('OPENROUTER_API_KEY'), temperature=0)
		response = await chat.ainvoke(self.CONVERSATION_MESSAGES)
		completion = response.completion

		assert isinstance(completion, str)
		assert self.EXPECTED_GERMANY_CAPITAL in completion.lower()

	@pytest.mark.asyncio
	async def test_openrouter_ainvoke_structured(self):
		"""Test structured output from OpenRouter"""
		# Skip if no API key
		if not os.getenv('OPENROUTER_API_KEY'):
			pytest.skip('OPENROUTER_API_KEY not set')

		chat = ChatOpenRouter(model='openai/gpt-4o-mini', api_key=os.getenv('OPENROUTER_API_KEY'), temperature=0)
		response = await chat.ainvoke(self.STRUCTURED_MESSAGES, output_format=CapitalResponse)
		completion = response.completion

		assert isinstance(completion, CapitalResponse)
		assert completion.country.lower() == self.EXPECTED_FRANCE_COUNTRY
		assert completion.capital.lower() == self.EXPECTED_FRANCE_CAPITAL

	# OCI Raw Tests
	@pytest.fixture
	def oci_raw_chat(self):
		"""Provides an initialized ChatOCIRaw client for tests."""
		# Skip if OCI models not available
		if not OCI_MODELS_AVAILABLE:
			pytest.skip('OCI models not available - install with pip install "browser-use[oci]"')

		# Skip if OCI credentials not available - check for config file existence
		try:
			import oci

			oci.config.from_file('~/.oci/config', 'DEFAULT')
		except Exception:
			pytest.skip('OCI credentials not available')

		# Skip if using placeholder config
		if xai_llm and hasattr(xai_llm, 'compartment_id') and 'example' in xai_llm.compartment_id.lower():
			pytest.skip('OCI model using placeholder configuration - set real credentials')

		return xai_llm  # xai or cohere

	@pytest.mark.asyncio
	async def test_oci_raw_ainvoke_normal(self, oci_raw_chat):
		"""Test normal text response from OCI Raw"""
		response = await oci_raw_chat.ainvoke(self.CONVERSATION_MESSAGES)

		completion = response.completion

		assert isinstance(completion, str)
		assert self.EXPECTED_GERMANY_CAPITAL in completion.lower()

	@pytest.mark.asyncio
	async def test_oci_raw_ainvoke_structured(self, oci_raw_chat):
		"""Test structured output from OCI Raw"""
		response = await oci_raw_chat.ainvoke(self.STRUCTURED_MESSAGES, output_format=CapitalResponse)
		completion = response.completion

		assert isinstance(completion, CapitalResponse)
		assert completion.country.lower() == self.EXPECTED_FRANCE_COUNTRY
		assert completion.capital.lower() == self.EXPECTED_FRANCE_CAPITAL

```

---

## backend/browser-use/browser_use/llm/tests/test_gemini_image.py

```py
import asyncio
import base64
import io
import random

from PIL import Image, ImageDraw, ImageFont

from browser_use.llm.google.chat import ChatGoogle
from browser_use.llm.google.serializer import GoogleMessageSerializer
from browser_use.llm.messages import (
	BaseMessage,
	ContentPartImageParam,
	ContentPartTextParam,
	ImageURL,
	SystemMessage,
	UserMessage,
)


def create_random_text_image(text: str = 'hello world', width: int = 4000, height: int = 4000) -> str:
	# Create image with random background color
	bg_color = (random.randint(0, 255), random.randint(0, 255), random.randint(0, 255))
	image = Image.new('RGB', (width, height), bg_color)
	draw = ImageDraw.Draw(image)

	# Try to use a default font, fallback to default if not available
	try:
		font = ImageFont.truetype('arial.ttf', 24)
	except Exception:
		font = ImageFont.load_default()

	# Calculate text position to center it
	bbox = draw.textbbox((0, 0), text, font=font)
	text_width = bbox[2] - bbox[0]
	text_height = bbox[3] - bbox[1]
	x = (width - text_width) // 2
	y = (height - text_height) // 2

	# Draw text with contrasting color
	text_color = (255 - bg_color[0], 255 - bg_color[1], 255 - bg_color[2])
	draw.text((x, y), text, fill=text_color, font=font)

	# Convert to base64
	buffer = io.BytesIO()
	image.save(buffer, format='JPEG')
	img_data = base64.b64encode(buffer.getvalue()).decode()

	return f'data:image/jpeg;base64,{img_data}'


async def test_gemini_image_vision():
	"""Test Gemini's ability to see and describe images."""

	# Create the LLM
	llm = ChatGoogle(model='gemini-2.0-flash-exp')

	# Create a random image with text
	image_data_url = create_random_text_image('Hello Gemini! Can you see this text?')

	# Create messages with image
	messages: list[BaseMessage] = [
		SystemMessage(content='You are a helpful assistant that can see and describe images.'),
		UserMessage(
			content=[
				ContentPartTextParam(text='What do you see in this image? Please describe the text and any visual elements.'),
				ContentPartImageParam(image_url=ImageURL(url=image_data_url)),
			]
		),
	]

	# Serialize messages for Google format
	serializer = GoogleMessageSerializer()
	formatted_messages, system_message = serializer.serialize_messages(messages)

	print('Testing Gemini image vision...')
	print(f'System message: {system_message}')

	# Make the API call
	try:
		response = await llm.ainvoke(messages)
		print('\n=== Gemini Response ===')
		print(response.completion)
		print(response.usage)
		print('=======================')
	except Exception as e:
		print(f'Error calling Gemini: {e}')
		print(f'Error type: {type(e)}')


if __name__ == '__main__':
	asyncio.run(test_gemini_image_vision())

```

---

## backend/browser-use/browser_use/llm/tests/test_groq_loop.py

```py
import asyncio

from browser_use.llm import ContentText
from browser_use.llm.groq.chat import ChatGroq
from browser_use.llm.messages import SystemMessage, UserMessage

llm = ChatGroq(
	model='meta-llama/llama-4-maverick-17b-128e-instruct',
	temperature=0.5,
)
# llm = ChatOpenAI(model='gpt-4.1-mini')


async def main():
	from pydantic import BaseModel

	from browser_use.tokens.service import TokenCost

	tk = TokenCost().register_llm(llm)

	class Output(BaseModel):
		reasoning: str
		answer: str

	message = [
		SystemMessage(content='You are a helpful assistant that can answer questions and help with tasks.'),
		UserMessage(
			content=[
				ContentText(
					text=r"Why is the sky blue? write exactly this into reasoning make sure to output ' with  exactly like in the input : "
				),
				ContentText(
					text="""
	The user's request is to find the lowest priced women's plus size one piece swimsuit in color black with a customer rating of at least 5 on Kohls.com. I am currently on the homepage of Kohls. The page has a search bar and various category links. To begin, I need to navigate to the women's section and search for swimsuits. I will start by clicking on the 'Women' category link."""
				),
			]
		),
	]

	for i in range(10):
		print('-' * 50)
		print(f'start loop {i}')
		response = await llm.ainvoke(message, output_format=Output)
		completion = response.completion
		print(f'start reasoning: {completion.reasoning}')
		print(f'answer: {completion.answer}')
		print('-' * 50)


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/browser_use/llm/tests/test_single_step.py

```py
import logging
import os
import tempfile

import pytest

from browser_use.agent.prompts import AgentMessagePrompt
from browser_use.agent.service import Agent
from browser_use.browser.views import BrowserStateSummary, TabInfo
from browser_use.dom.views import DOMSelectorMap, EnhancedDOMTreeNode, NodeType, SerializedDOMState, SimplifiedNode
from browser_use.filesystem.file_system import FileSystem
from browser_use.llm.anthropic.chat import ChatAnthropic
from browser_use.llm.azure.chat import ChatAzureOpenAI
from browser_use.llm.base import BaseChatModel
from browser_use.llm.google.chat import ChatGoogle
from browser_use.llm.groq.chat import ChatGroq

# Optional OCI import
try:
	from browser_use.llm.oci_raw.chat import ChatOCIRaw

	OCI_AVAILABLE = True
except ImportError:
	ChatOCIRaw = None
	OCI_AVAILABLE = False
from browser_use.llm.openai.chat import ChatOpenAI

# Set logging level to INFO for this module
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def _check_oci_credentials() -> bool:
	"""Check if OCI credentials are available."""
	if not OCI_AVAILABLE:
		return False
	try:
		import oci

		oci.config.from_file('~/.oci/config', 'DEFAULT')
		return True
	except Exception:
		return False


def create_mock_state_message(temp_dir: str):
	"""Create a mock state message with a single clickable element."""

	# Create a mock DOM element with a single clickable button
	mock_button = EnhancedDOMTreeNode(
		node_id=1,
		backend_node_id=1,
		node_type=NodeType.ELEMENT_NODE,
		node_name='button',
		node_value='Click Me',
		attributes={'id': 'test-button'},
		is_scrollable=False,
		is_visible=True,
		absolute_position=None,
		session_id=None,
		target_id='ABCD1234ABCD1234ABCD1234ABCD1234ABCD1234',
		frame_id=None,
		content_document=None,
		shadow_root_type=None,
		shadow_roots=None,
		parent_node=None,
		children_nodes=None,
		ax_node=None,
		snapshot_node=None,
	)

	# Create selector map (keyed by backend_node_id)
	selector_map: DOMSelectorMap = {mock_button.backend_node_id: mock_button}

	# Create mock tab info with proper target_id
	mock_tab = TabInfo(
		target_id='ABCD1234ABCD1234ABCD1234ABCD1234ABCD1234',
		url='https://example.com',
		title='Test Page',
	)

	dom_state = SerializedDOMState(
		_root=SimplifiedNode(
			original_node=mock_button,
			children=[],
			should_display=True,
			is_interactive=True,
		),
		selector_map=selector_map,
	)

	# Create mock browser state with required selector_map
	mock_browser_state = BrowserStateSummary(
		dom_state=dom_state,  # Using the actual DOM element
		url='https://example.com',
		title='Test Page',
		tabs=[mock_tab],
		screenshot='',  # Empty screenshot
		pixels_above=0,
		pixels_below=0,
	)

	# Create file system using the provided temp directory
	mock_file_system = FileSystem(temp_dir)

	# Create the agent message prompt
	agent_prompt = AgentMessagePrompt(
		browser_state_summary=mock_browser_state,
		file_system=mock_file_system,  # Now using actual FileSystem instance
		agent_history_description='',  # Empty history
		read_state_description='',  # Empty read state
		task='Click the button on the page',
		include_attributes=['id'],
		step_info=None,
		page_filtered_actions=None,
		max_clickable_elements_length=40000,
		sensitive_data=None,
	)

	# Override the clickable_elements_to_string method to return our simple element
	dom_state.llm_representation = lambda include_attributes=None: '[1]<button id="test-button">Click Me</button>'

	# Get the formatted message
	message = agent_prompt.get_user_message(use_vision=False)

	return message


# Pytest parameterized version
@pytest.mark.parametrize(
	'llm_class,model_name',
	[
		(ChatGroq, 'meta-llama/llama-4-maverick-17b-128e-instruct'),
		(ChatGoogle, 'gemini-2.0-flash-exp'),
		(ChatOpenAI, 'gpt-4.1-mini'),
		(ChatAnthropic, 'claude-3-5-sonnet-latest'),
		(ChatAzureOpenAI, 'gpt-4.1-mini'),
		pytest.param(
			ChatOCIRaw,
			{
				'model_id': os.getenv('OCI_MODEL_ID', 'placeholder'),
				'service_endpoint': os.getenv(
					'OCI_SERVICE_ENDPOINT', 'https://inference.generativeai.us-chicago-1.oci.oraclecloud.com'
				),
				'compartment_id': os.getenv('OCI_COMPARTMENT_ID', 'placeholder'),
				'provider': 'meta',
				'temperature': 0.7,
				'max_tokens': 800,
				'frequency_penalty': 0.0,
				'presence_penalty': 0.0,
				'top_p': 0.9,
				'auth_type': 'API_KEY',
				'auth_profile': 'DEFAULT',
			},
			marks=pytest.mark.skipif(
				not _check_oci_credentials() or not os.getenv('OCI_MODEL_ID') or not os.getenv('OCI_COMPARTMENT_ID'),
				reason='OCI credentials or environment variables not available',
			),
		),
	],
)
async def test_single_step_parametrized(llm_class, model_name):
	"""Test single step with different LLM providers using pytest parametrize."""
	if isinstance(model_name, dict):
		# Handle ChatOCIRaw which requires keyword arguments
		llm = llm_class(**model_name)
	else:
		llm = llm_class(model=model_name)

	agent = Agent(task='Click the button on the page', llm=llm)

	# Create temporary directory that will stay alive during the test
	with tempfile.TemporaryDirectory() as temp_dir:
		# Create mock state message
		mock_message = create_mock_state_message(temp_dir)

		agent.message_manager._set_message_with_type(mock_message, 'state')

		messages = agent.message_manager.get_messages()

		# Test with simple question
		response = await llm.ainvoke(messages, agent.AgentOutput)

		# Additional validation for OCI Raw
		if ChatOCIRaw is not None and isinstance(llm, ChatOCIRaw):
			# Verify OCI Raw generates proper Agent actions
			assert response.completion.action is not None
			assert len(response.completion.action) > 0

		# Basic assertions to ensure response is valid
		assert response.completion is not None
		assert response.usage is not None
		assert response.usage.total_tokens > 0


async def test_single_step():
	"""Original test function that tests all models in a loop."""
	# Create a list of models to test
	models: list[BaseChatModel] = [
		ChatGroq(model='meta-llama/llama-4-maverick-17b-128e-instruct'),
		ChatGoogle(model='gemini-2.0-flash-exp'),
		ChatOpenAI(model='gpt-4.1'),
		ChatAnthropic(model='claude-3-5-sonnet-latest'),  # Using haiku for cost efficiency
		ChatAzureOpenAI(model='gpt-4o-mini'),
	]

	for llm in models:
		print(f'\n{"=" * 60}')
		print(f'Testing with model: {llm.provider} - {llm.model}')
		print(f'{"=" * 60}\n')

		agent = Agent(task='Click the button on the page', llm=llm)

		# Create temporary directory that will stay alive during the test
		with tempfile.TemporaryDirectory() as temp_dir:
			# Create mock state message
			mock_message = create_mock_state_message(temp_dir)

			# Print the mock message content to see what it looks like
			print('Mock state message:')
			print(mock_message.content)
			print('\n' + '=' * 50 + '\n')

			agent.message_manager._set_message_with_type(mock_message, 'state')

			messages = agent.message_manager.get_messages()

			# Test with simple question
			try:
				response = await llm.ainvoke(messages, agent.AgentOutput)
				logger.info(f'Response from {llm.provider}: {response.completion}')
				logger.info(f'Actions: {str(response.completion.action)}')

			except Exception as e:
				logger.error(f'Error with {llm.provider}: {type(e).__name__}: {str(e)}')

		print(f'\n{"=" * 60}\n')


if __name__ == '__main__':
	import asyncio

	asyncio.run(test_single_step())

```

---

## backend/browser-use/browser_use/llm/vercel/__init__.py

```py
from browser_use.llm.vercel.chat import ChatVercel

__all__ = ['ChatVercel']

```

---

## backend/browser-use/browser_use/llm/vercel/chat.py

```py
import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal, TypeAlias, TypeVar, overload

import httpx
from openai import APIConnectionError, APIStatusError, AsyncOpenAI, RateLimitError
from openai.types.chat.chat_completion import ChatCompletion
from openai.types.shared_params.response_format_json_schema import (
	JSONSchema,
	ResponseFormatJSONSchema,
)
from pydantic import BaseModel

from browser_use.llm.base import BaseChatModel
from browser_use.llm.exceptions import ModelProviderError, ModelRateLimitError
from browser_use.llm.messages import BaseMessage, ContentPartTextParam, SystemMessage
from browser_use.llm.schema import SchemaOptimizer
from browser_use.llm.vercel.serializer import VercelMessageSerializer
from browser_use.llm.views import ChatInvokeCompletion, ChatInvokeUsage

T = TypeVar('T', bound=BaseModel)

ChatVercelModel: TypeAlias = Literal[
	'alibaba/qwen-3-14b',
	'alibaba/qwen-3-235b',
	'alibaba/qwen-3-30b',
	'alibaba/qwen-3-32b',
	'alibaba/qwen3-coder',
	'alibaba/qwen3-coder-30b-a3b',
	'alibaba/qwen3-coder-plus',
	'alibaba/qwen3-max',
	'alibaba/qwen3-max-preview',
	'alibaba/qwen3-next-80b-a3b-instruct',
	'alibaba/qwen3-next-80b-a3b-thinking',
	'alibaba/qwen3-vl-instruct',
	'alibaba/qwen3-vl-thinking',
	'amazon/nova-lite',
	'amazon/nova-micro',
	'amazon/nova-pro',
	'amazon/titan-embed-text-v2',
	'anthropic/claude-3-haiku',
	'anthropic/claude-3-opus',
	'anthropic/claude-3.5-haiku',
	'anthropic/claude-3.5-sonnet',
	'anthropic/claude-3.5-sonnet-20240620',
	'anthropic/claude-3.7-sonnet',
	'anthropic/claude-haiku-4.5',
	'anthropic/claude-opus-4',
	'anthropic/claude-opus-4.1',
	'anthropic/claude-sonnet-4',
	'anthropic/claude-sonnet-4.5',
	'cohere/command-a',
	'cohere/command-r',
	'cohere/command-r-plus',
	'cohere/embed-v4.0',
	'deepseek/deepseek-r1',
	'deepseek/deepseek-r1-distill-llama-70b',
	'deepseek/deepseek-v3',
	'deepseek/deepseek-v3.1',
	'deepseek/deepseek-v3.1-base',
	'deepseek/deepseek-v3.1-terminus',
	'deepseek/deepseek-v3.2-exp',
	'deepseek/deepseek-v3.2-exp-thinking',
	'google/gemini-2.0-flash',
	'google/gemini-2.0-flash-lite',
	'google/gemini-2.5-flash',
	'google/gemini-2.5-flash-image',
	'google/gemini-2.5-flash-image-preview',
	'google/gemini-2.5-flash-lite',
	'google/gemini-2.5-flash-lite-preview-09-2025',
	'google/gemini-2.5-flash-preview-09-2025',
	'google/gemini-2.5-pro',
	'google/gemini-embedding-001',
	'google/gemma-2-9b',
	'google/text-embedding-005',
	'google/text-multilingual-embedding-002',
	'inception/mercury-coder-small',
	'meituan/longcat-flash-chat',
	'meituan/longcat-flash-thinking',
	'meta/llama-3-70b',
	'meta/llama-3-8b',
	'meta/llama-3.1-70b',
	'meta/llama-3.1-8b',
	'meta/llama-3.2-11b',
	'meta/llama-3.2-1b',
	'meta/llama-3.2-3b',
	'meta/llama-3.2-90b',
	'meta/llama-3.3-70b',
	'meta/llama-4-maverick',
	'meta/llama-4-scout',
	'mistral/codestral',
	'mistral/codestral-embed',
	'mistral/devstral-small',
	'mistral/magistral-medium',
	'mistral/magistral-medium-2506',
	'mistral/magistral-small',
	'mistral/magistral-small-2506',
	'mistral/ministral-3b',
	'mistral/ministral-8b',
	'mistral/mistral-embed',
	'mistral/mistral-large',
	'mistral/mistral-medium',
	'mistral/mistral-small',
	'mistral/mixtral-8x22b-instruct',
	'mistral/pixtral-12b',
	'mistral/pixtral-large',
	'moonshotai/kimi-k2',
	'moonshotai/kimi-k2-0905',
	'moonshotai/kimi-k2-turbo',
	'morph/morph-v3-fast',
	'morph/morph-v3-large',
	'openai/gpt-3.5-turbo',
	'openai/gpt-3.5-turbo-instruct',
	'openai/gpt-4-turbo',
	'openai/gpt-4.1',
	'openai/gpt-4.1-mini',
	'openai/gpt-4.1-nano',
	'openai/gpt-4o',
	'openai/gpt-4o-mini',
	'openai/gpt-5',
	'openai/gpt-5-codex',
	'openai/gpt-5-mini',
	'openai/gpt-5-nano',
	'openai/gpt-5-pro',
	'openai/gpt-oss-120b',
	'openai/gpt-oss-20b',
	'openai/o1',
	'openai/o3',
	'openai/o3-mini',
	'openai/o4-mini',
	'openai/text-embedding-3-large',
	'openai/text-embedding-3-small',
	'openai/text-embedding-ada-002',
	'perplexity/sonar',
	'perplexity/sonar-pro',
	'perplexity/sonar-reasoning',
	'perplexity/sonar-reasoning-pro',
	'stealth/sonoma-dusk-alpha',
	'stealth/sonoma-sky-alpha',
	'vercel/v0-1.0-md',
	'vercel/v0-1.5-md',
	'voyage/voyage-3-large',
	'voyage/voyage-3.5',
	'voyage/voyage-3.5-lite',
	'voyage/voyage-code-2',
	'voyage/voyage-code-3',
	'voyage/voyage-finance-2',
	'voyage/voyage-law-2',
	'xai/grok-2',
	'xai/grok-2-vision',
	'xai/grok-3',
	'xai/grok-3-fast',
	'xai/grok-3-mini',
	'xai/grok-3-mini-fast',
	'xai/grok-4',
	'xai/grok-4-fast-non-reasoning',
	'xai/grok-4-fast-reasoning',
	'xai/grok-code-fast-1',
	'zai/glm-4.5',
	'zai/glm-4.5-air',
	'zai/glm-4.5v',
	'zai/glm-4.6',
]


@dataclass
class ChatVercel(BaseChatModel):
	"""
	A wrapper around Vercel AI Gateway's API, which provides OpenAI-compatible access
	to various LLM models with features like rate limiting, caching, and monitoring.

	Examples:
		``\`python
	        from browser_use import Agent, ChatVercel

	        llm = ChatVercel(model='openai/gpt-4o', api_key='your_vercel_api_key')

	        agent = Agent(task='Your task here', llm=llm)
		``\`

	Args:
	    model: The model identifier
	    api_key: Your Vercel API key
	    base_url: The Vercel AI Gateway endpoint (defaults to https://ai-gateway.vercel.sh/v1)
	    temperature: Sampling temperature (0-2)
	    max_tokens: Maximum tokens to generate
	    reasoning_models: List of reasoning model patterns (e.g., 'o1', 'gpt-oss') that need
	        prompt-based JSON extraction. Auto-detects common reasoning models by default.
	    timeout: Request timeout in seconds
	    max_retries: Maximum number of retries for failed requests
	"""

	# Model configuration
	model: ChatVercelModel | str

	# Model params
	temperature: float | None = None
	max_tokens: int | None = None
	top_p: float | None = None
	reasoning_models: list[str] | None = field(
		default_factory=lambda: [
			'o1',
			'o3',
			'o4',
			'gpt-oss',
			'deepseek-r1',
			'qwen3-next-80b-a3b-thinking',
		]
	)

	# Client initialization parameters
	api_key: str | None = None
	base_url: str | httpx.URL = 'https://ai-gateway.vercel.sh/v1'
	timeout: float | httpx.Timeout | None = None
	max_retries: int = 5
	default_headers: Mapping[str, str] | None = None
	default_query: Mapping[str, object] | None = None
	http_client: httpx.AsyncClient | None = None
	_strict_response_validation: bool = False

	# Static
	@property
	def provider(self) -> str:
		return 'vercel'

	def _get_client_params(self) -> dict[str, Any]:
		"""Prepare client parameters dictionary."""
		base_params = {
			'api_key': self.api_key,
			'base_url': self.base_url,
			'timeout': self.timeout,
			'max_retries': self.max_retries,
			'default_headers': self.default_headers,
			'default_query': self.default_query,
			'_strict_response_validation': self._strict_response_validation,
		}

		client_params = {k: v for k, v in base_params.items() if v is not None}

		if self.http_client is not None:
			client_params['http_client'] = self.http_client

		return client_params

	def get_client(self) -> AsyncOpenAI:
		"""
		Returns an AsyncOpenAI client configured for Vercel AI Gateway.

		Returns:
		    AsyncOpenAI: An instance of the AsyncOpenAI client with Vercel base URL.
		"""
		if not hasattr(self, '_client'):
			client_params = self._get_client_params()
			self._client = AsyncOpenAI(**client_params)
		return self._client

	@property
	def name(self) -> str:
		return str(self.model)

	def _get_usage(self, response: ChatCompletion) -> ChatInvokeUsage | None:
		"""Extract usage information from the Vercel response."""
		if response.usage is None:
			return None

		prompt_details = getattr(response.usage, 'prompt_tokens_details', None)
		cached_tokens = prompt_details.cached_tokens if prompt_details else None

		return ChatInvokeUsage(
			prompt_tokens=response.usage.prompt_tokens,
			prompt_cached_tokens=cached_tokens,
			prompt_cache_creation_tokens=None,
			prompt_image_tokens=None,
			completion_tokens=response.usage.completion_tokens,
			total_tokens=response.usage.total_tokens,
		)

	def _fix_gemini_schema(self, schema: dict[str, Any]) -> dict[str, Any]:
		"""
		Convert a Pydantic model to a Gemini-compatible schema.

		This function removes unsupported properties like 'additionalProperties' and resolves
		$ref references that Gemini doesn't support.
		"""

		# Handle $defs and $ref resolution
		if '$defs' in schema:
			defs = schema.pop('$defs')

			def resolve_refs(obj: Any) -> Any:
				if isinstance(obj, dict):
					if '$ref' in obj:
						ref = obj.pop('$ref')
						ref_name = ref.split('/')[-1]
						if ref_name in defs:
							# Replace the reference with the actual definition
							resolved = defs[ref_name].copy()
							# Merge any additional properties from the reference
							for key, value in obj.items():
								if key != '$ref':
									resolved[key] = value
							return resolve_refs(resolved)
						return obj
					else:
						# Recursively process all dictionary values
						return {k: resolve_refs(v) for k, v in obj.items()}
				elif isinstance(obj, list):
					return [resolve_refs(item) for item in obj]
				return obj

			schema = resolve_refs(schema)

		# Remove unsupported properties
		def clean_schema(obj: Any) -> Any:
			if isinstance(obj, dict):
				# Remove unsupported properties
				cleaned = {}
				for key, value in obj.items():
					if key not in ['additionalProperties', 'title', 'default']:
						cleaned_value = clean_schema(value)
						# Handle empty object properties - Gemini doesn't allow empty OBJECT types
						if (
							key == 'properties'
							and isinstance(cleaned_value, dict)
							and len(cleaned_value) == 0
							and isinstance(obj.get('type', ''), str)
							and obj.get('type', '').upper() == 'OBJECT'
						):
							# Convert empty object to have at least one property
							cleaned['properties'] = {'_placeholder': {'type': 'string'}}
						else:
							cleaned[key] = cleaned_value

				# If this is an object type with empty properties, add a placeholder
				if (
					isinstance(cleaned.get('type', ''), str)
					and cleaned.get('type', '').upper() == 'OBJECT'
					and 'properties' in cleaned
					and isinstance(cleaned['properties'], dict)
					and len(cleaned['properties']) == 0
				):
					cleaned['properties'] = {'_placeholder': {'type': 'string'}}

				# Also remove 'title' from the required list if it exists
				if 'required' in cleaned and isinstance(cleaned.get('required'), list):
					cleaned['required'] = [p for p in cleaned['required'] if p != 'title']

				return cleaned
			elif isinstance(obj, list):
				return [clean_schema(item) for item in obj]
			return obj

		return clean_schema(schema)

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: None = None) -> ChatInvokeCompletion[str]: ...

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: type[T]) -> ChatInvokeCompletion[T]: ...

	async def ainvoke(
		self, messages: list[BaseMessage], output_format: type[T] | None = None
	) -> ChatInvokeCompletion[T] | ChatInvokeCompletion[str]:
		"""
		Invoke the model with the given messages through Vercel AI Gateway.

		Args:
		    messages: List of chat messages
		    output_format: Optional Pydantic model class for structured output

		Returns:
		    Either a string response or an instance of output_format
		"""
		vercel_messages = VercelMessageSerializer.serialize_messages(messages)

		try:
			model_params: dict[str, Any] = {}
			if self.temperature is not None:
				model_params['temperature'] = self.temperature
			if self.max_tokens is not None:
				model_params['max_tokens'] = self.max_tokens
			if self.top_p is not None:
				model_params['top_p'] = self.top_p

			if output_format is None:
				# Return string response
				response = await self.get_client().chat.completions.create(
					model=self.model,
					messages=vercel_messages,
					**model_params,
				)

				usage = self._get_usage(response)
				return ChatInvokeCompletion(
					completion=response.choices[0].message.content or '',
					usage=usage,
					stop_reason=response.choices[0].finish_reason if response.choices else None,
				)

			else:
				is_google_model = self.model.startswith('google/')
				is_reasoning_model = self.reasoning_models and any(
					str(pattern).lower() in str(self.model).lower() for pattern in self.reasoning_models
				)

				if is_google_model or is_reasoning_model:
					modified_messages = [m.model_copy(deep=True) for m in messages]

					schema = SchemaOptimizer.create_gemini_optimized_schema(output_format)
					json_instruction = f'\n\nIMPORTANT: You must respond with ONLY a valid JSON object (no markdown, no code blocks, no explanations) that exactly matches this schema:\n{json.dumps(schema, indent=2)}'

					instruction_added = False
					if modified_messages and modified_messages[0].role == 'system':
						if isinstance(modified_messages[0].content, str):
							modified_messages[0].content += json_instruction
							instruction_added = True
						elif isinstance(modified_messages[0].content, list):
							modified_messages[0].content.append(ContentPartTextParam(text=json_instruction))
							instruction_added = True
					elif modified_messages and modified_messages[-1].role == 'user':
						if isinstance(modified_messages[-1].content, str):
							modified_messages[-1].content += json_instruction
							instruction_added = True
						elif isinstance(modified_messages[-1].content, list):
							modified_messages[-1].content.append(ContentPartTextParam(text=json_instruction))
							instruction_added = True

					if not instruction_added:
						modified_messages.insert(0, SystemMessage(content=json_instruction))

					vercel_messages = VercelMessageSerializer.serialize_messages(modified_messages)

					response = await self.get_client().chat.completions.create(
						model=self.model,
						messages=vercel_messages,
						**model_params,
					)

					content = response.choices[0].message.content if response.choices else None

					if not content:
						raise ModelProviderError(
							message='No response from model',
							status_code=500,
							model=self.name,
						)

					try:
						text = content.strip()
						if text.startswith('``\`json') and text.endswith('``\`'):
							text = text[7:-3].strip()
						elif text.startswith('``\`') and text.endswith('``\`'):
							text = text[3:-3].strip()

						parsed_data = json.loads(text)
						parsed = output_format.model_validate(parsed_data)

						usage = self._get_usage(response)
						return ChatInvokeCompletion(
							completion=parsed,
							usage=usage,
							stop_reason=response.choices[0].finish_reason if response.choices else None,
						)

					except (json.JSONDecodeError, ValueError) as e:
						raise ModelProviderError(
							message=f'Failed to parse JSON response: {str(e)}. Raw response: {content[:200]}',
							status_code=500,
							model=self.name,
						) from e

				else:
					schema = SchemaOptimizer.create_optimized_json_schema(output_format)

					response_format_schema: JSONSchema = {
						'name': 'agent_output',
						'strict': True,
						'schema': schema,
					}

					response = await self.get_client().chat.completions.create(
						model=self.model,
						messages=vercel_messages,
						response_format=ResponseFormatJSONSchema(
							json_schema=response_format_schema,
							type='json_schema',
						),
						**model_params,
					)

					content = response.choices[0].message.content if response.choices else None

					if not content:
						raise ModelProviderError(
							message='Failed to parse structured output from model response - empty or null content',
							status_code=500,
							model=self.name,
						)

					usage = self._get_usage(response)
					parsed = output_format.model_validate_json(content)

					return ChatInvokeCompletion(
						completion=parsed,
						usage=usage,
						stop_reason=response.choices[0].finish_reason if response.choices else None,
					)

		except RateLimitError as e:
			raise ModelRateLimitError(message=e.message, model=self.name) from e

		except APIConnectionError as e:
			raise ModelProviderError(message=str(e), model=self.name) from e

		except APIStatusError as e:
			raise ModelProviderError(message=e.message, status_code=e.status_code, model=self.name) from e

		except Exception as e:
			raise ModelProviderError(message=str(e), model=self.name) from e

```

---

## backend/browser-use/browser_use/llm/vercel/serializer.py

```py
from openai.types.chat import ChatCompletionMessageParam

from browser_use.llm.messages import BaseMessage
from browser_use.llm.openai.serializer import OpenAIMessageSerializer


class VercelMessageSerializer:
	"""
	Serializer for converting between custom message types and Vercel AI Gateway message formats.

	Vercel AI Gateway uses the OpenAI-compatible API, so we can reuse the OpenAI serializer.
	"""

	@staticmethod
	def serialize_messages(messages: list[BaseMessage]) -> list[ChatCompletionMessageParam]:
		"""
		Serialize a list of browser_use messages to Vercel AI Gateway-compatible messages.

		Args:
		    messages: List of browser_use messages

		Returns:
		    List of Vercel AI Gateway-compatible messages (identical to OpenAI format)
		"""
		# Vercel AI Gateway uses the same message format as OpenAI
		return OpenAIMessageSerializer.serialize_messages(messages)

```

---

## backend/browser-use/browser_use/llm/views.py

```py
from typing import Generic, TypeVar, Union

from pydantic import BaseModel

T = TypeVar('T', bound=Union[BaseModel, str])


class ChatInvokeUsage(BaseModel):
	"""
	Usage information for a chat model invocation.
	"""

	prompt_tokens: int
	"""The number of tokens in the prompt (this includes the cached tokens as well. When calculating the cost, subtract the cached tokens from the prompt tokens)"""

	prompt_cached_tokens: int | None
	"""The number of cached tokens."""

	prompt_cache_creation_tokens: int | None
	"""Anthropic only: The number of tokens used to create the cache."""

	prompt_image_tokens: int | None
	"""Google only: The number of tokens in the image (prompt tokens is the text tokens + image tokens in that case)"""

	completion_tokens: int
	"""The number of tokens in the completion."""

	total_tokens: int
	"""The total number of tokens in the response."""


class ChatInvokeCompletion(BaseModel, Generic[T]):
	"""
	Response from a chat model invocation.
	"""

	completion: T
	"""The completion of the response."""

	# Thinking stuff
	thinking: str | None = None
	redacted_thinking: str | None = None

	usage: ChatInvokeUsage | None
	"""The usage of the response."""

	stop_reason: str | None = None
	"""The reason the model stopped generating. Common values: 'end_turn', 'max_tokens', 'stop_sequence'."""

```

---

## backend/browser-use/browser_use/logging_config.py

```py
import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from browser_use.config import CONFIG


def addLoggingLevel(levelName, levelNum, methodName=None):
	"""
	Comprehensively adds a new logging level to the `logging` module and the
	currently configured logging class.

	`levelName` becomes an attribute of the `logging` module with the value
	`levelNum`. `methodName` becomes a convenience method for both `logging`
	itself and the class returned by `logging.getLoggerClass()` (usually just
	`logging.Logger`). If `methodName` is not specified, `levelName.lower()` is
	used.

	To avoid accidental clobberings of existing attributes, this method will
	raise an `AttributeError` if the level name is already an attribute of the
	`logging` module or if the method name is already present

	Example
	-------
	>>> addLoggingLevel('TRACE', logging.DEBUG - 5)
	>>> logging.getLogger(__name__).setLevel('TRACE')
	>>> logging.getLogger(__name__).trace('that worked')
	>>> logging.trace('so did this')
	>>> logging.TRACE
	5

	"""
	if not methodName:
		methodName = levelName.lower()

	if hasattr(logging, levelName):
		raise AttributeError(f'{levelName} already defined in logging module')
	if hasattr(logging, methodName):
		raise AttributeError(f'{methodName} already defined in logging module')
	if hasattr(logging.getLoggerClass(), methodName):
		raise AttributeError(f'{methodName} already defined in logger class')

	# This method was inspired by the answers to Stack Overflow post
	# http://stackoverflow.com/q/2183233/2988730, especially
	# http://stackoverflow.com/a/13638084/2988730
	def logForLevel(self, message, *args, **kwargs):
		if self.isEnabledFor(levelNum):
			self._log(levelNum, message, args, **kwargs)

	def logToRoot(message, *args, **kwargs):
		logging.log(levelNum, message, *args, **kwargs)

	logging.addLevelName(levelNum, levelName)
	setattr(logging, levelName, levelNum)
	setattr(logging.getLoggerClass(), methodName, logForLevel)
	setattr(logging, methodName, logToRoot)


def setup_logging(stream=None, log_level=None, force_setup=False, debug_log_file=None, info_log_file=None):
	"""Setup logging configuration for browser-use.

	Args:
		stream: Output stream for logs (default: sys.stdout). Can be sys.stderr for MCP mode.
		log_level: Override log level (default: uses CONFIG.BROWSER_USE_LOGGING_LEVEL)
		force_setup: Force reconfiguration even if handlers already exist
		debug_log_file: Path to log file for debug level logs only
		info_log_file: Path to log file for info level logs only
	"""
	# Try to add RESULT level, but ignore if it already exists
	try:
		addLoggingLevel('RESULT', 35)  # This allows ERROR, FATAL and CRITICAL
	except AttributeError:
		pass  # Level already exists, which is fine

	log_type = log_level or CONFIG.BROWSER_USE_LOGGING_LEVEL

	# Check if handlers are already set up
	if logging.getLogger().hasHandlers() and not force_setup:
		return logging.getLogger('browser_use')

	# Clear existing handlers
	root = logging.getLogger()
	root.handlers = []

	class BrowserUseFormatter(logging.Formatter):
		def __init__(self, fmt, log_level):
			super().__init__(fmt)
			self.log_level = log_level

		def format(self, record):
			# Only clean up names in INFO mode, keep everything in DEBUG mode
			if self.log_level > logging.DEBUG and isinstance(record.name, str) and record.name.startswith('browser_use.'):
				# Extract clean component names from logger names
				if 'Agent' in record.name:
					record.name = 'Agent'
				elif 'BrowserSession' in record.name:
					record.name = 'BrowserSession'
				elif 'tools' in record.name:
					record.name = 'tools'
				elif 'dom' in record.name:
					record.name = 'dom'
				elif record.name.startswith('browser_use.'):
					# For other browser_use modules, use the last part
					parts = record.name.split('.')
					if len(parts) >= 2:
						record.name = parts[-1]
			return super().format(record)

	# Setup single handler for all loggers
	console = logging.StreamHandler(stream or sys.stdout)

	# Determine the log level to use first
	if log_type == 'result':
		log_level = 35  # RESULT level value
	elif log_type == 'debug':
		log_level = logging.DEBUG
	else:
		log_level = logging.INFO

	# adittional setLevel here to filter logs
	if log_type == 'result':
		console.setLevel('RESULT')
		console.setFormatter(BrowserUseFormatter('%(message)s', log_level))
	else:
		console.setLevel(log_level)  # Keep console at original log level (e.g., INFO)
		console.setFormatter(BrowserUseFormatter('%(levelname)-8s [%(name)s] %(message)s', log_level))

	# Configure root logger only
	root.addHandler(console)

	# Add file handlers if specified
	file_handlers = []

	# Create debug log file handler
	if debug_log_file:
		debug_handler = logging.FileHandler(debug_log_file, encoding='utf-8')
		debug_handler.setLevel(logging.DEBUG)
		debug_handler.setFormatter(BrowserUseFormatter('%(asctime)s - %(levelname)-8s [%(name)s] %(message)s', logging.DEBUG))
		file_handlers.append(debug_handler)
		root.addHandler(debug_handler)

	# Create info log file handler
	if info_log_file:
		info_handler = logging.FileHandler(info_log_file, encoding='utf-8')
		info_handler.setLevel(logging.INFO)
		info_handler.setFormatter(BrowserUseFormatter('%(asctime)s - %(levelname)-8s [%(name)s] %(message)s', logging.INFO))
		file_handlers.append(info_handler)
		root.addHandler(info_handler)

	# Configure root logger - use DEBUG if debug file logging is enabled
	effective_log_level = logging.DEBUG if debug_log_file else log_level
	root.setLevel(effective_log_level)

	# Configure browser_use logger
	browser_use_logger = logging.getLogger('browser_use')
	browser_use_logger.propagate = False  # Don't propagate to root logger
	browser_use_logger.addHandler(console)
	for handler in file_handlers:
		browser_use_logger.addHandler(handler)
	browser_use_logger.setLevel(effective_log_level)

	# Configure bubus logger to allow INFO level logs
	bubus_logger = logging.getLogger('bubus')
	bubus_logger.propagate = False  # Don't propagate to root logger
	bubus_logger.addHandler(console)
	for handler in file_handlers:
		bubus_logger.addHandler(handler)
	bubus_logger.setLevel(logging.INFO if log_type == 'result' else effective_log_level)

	# Configure CDP logging using cdp_use's setup function
	# This enables the formatted CDP output using CDP_LOGGING_LEVEL environment variable
	# Convert CDP_LOGGING_LEVEL string to logging level
	cdp_level_str = CONFIG.CDP_LOGGING_LEVEL.upper()
	cdp_level = getattr(logging, cdp_level_str, logging.WARNING)

	try:
		from cdp_use.logging import setup_cdp_logging  # type: ignore

		# Use the CDP-specific logging level
		setup_cdp_logging(
			level=cdp_level,
			stream=stream or sys.stdout,
			format_string='%(levelname)-8s [%(name)s] %(message)s' if log_type != 'result' else '%(message)s',
		)
	except ImportError:
		# If cdp_use doesn't have the new logging module, fall back to manual config
		cdp_loggers = [
			'websockets.client',
			'cdp_use',
			'cdp_use.client',
			'cdp_use.cdp',
			'cdp_use.cdp.registry',
		]
		for logger_name in cdp_loggers:
			cdp_logger = logging.getLogger(logger_name)
			cdp_logger.setLevel(cdp_level)
			cdp_logger.addHandler(console)
			cdp_logger.propagate = False

	logger = logging.getLogger('browser_use')
	# logger.debug('BrowserUse logging setup complete with level %s', log_type)

	# Silence third-party loggers (but not CDP ones which we configured above)
	third_party_loggers = [
		'WDM',
		'httpx',
		'selenium',
		'playwright',
		'urllib3',
		'asyncio',
		'langsmith',
		'langsmith.client',
		'openai',
		'httpcore',
		'charset_normalizer',
		'anthropic._base_client',
		'PIL.PngImagePlugin',
		'trafilatura.htmlprocessing',
		'trafilatura',
		'groq',
		'portalocker',
		'google_genai',
		'portalocker.utils',
		'websockets',  # General websockets (but not websockets.client which we need)
	]
	for logger_name in third_party_loggers:
		third_party = logging.getLogger(logger_name)
		third_party.setLevel(logging.ERROR)
		third_party.propagate = False

	return logger


class FIFOHandler(logging.Handler):
	"""Non-blocking handler that writes to a named pipe."""

	def __init__(self, fifo_path: str):
		super().__init__()
		self.fifo_path = fifo_path
		Path(fifo_path).parent.mkdir(parents=True, exist_ok=True)

		# Create FIFO if it doesn't exist
		if not os.path.exists(fifo_path):
			os.mkfifo(fifo_path)

		# Don't open the FIFO yet - will open on first write
		self.fd = None

	def emit(self, record):
		try:
			# Open FIFO on first write if not already open
			if self.fd is None:
				try:
					self.fd = os.open(self.fifo_path, os.O_WRONLY | os.O_NONBLOCK)
				except OSError:
					# No reader connected yet, skip this message
					return

			msg = f'{self.format(record)}\n'.encode()
			os.write(self.fd, msg)
		except (OSError, BrokenPipeError):
			# Reader disconnected, close and reset
			if self.fd is not None:
				try:
					os.close(self.fd)
				except Exception:
					pass
				self.fd = None

	def close(self):
		if hasattr(self, 'fd') and self.fd is not None:
			try:
				os.close(self.fd)
			except Exception:
				pass
		super().close()


def setup_log_pipes(session_id: str, base_dir: str | None = None):
	"""Setup named pipes for log streaming.

	Usage:
		# In browser-use:
		setup_log_pipes(session_id="abc123")

		# In consumer process:
		tail -f {temp_dir}/buagent.c123/agent.pipe
	"""
	import tempfile

	if base_dir is None:
		base_dir = tempfile.gettempdir()

	suffix = session_id[-4:]
	pipe_dir = Path(base_dir) / f'buagent.{suffix}'

	# Agent logs
	agent_handler = FIFOHandler(str(pipe_dir / 'agent.pipe'))
	agent_handler.setLevel(logging.DEBUG)
	agent_handler.setFormatter(logging.Formatter('%(levelname)-8s [%(name)s] %(message)s'))
	for name in ['browser_use.agent', 'browser_use.tools']:
		logger = logging.getLogger(name)
		logger.addHandler(agent_handler)
		logger.setLevel(logging.DEBUG)
		logger.propagate = True

	# CDP logs
	cdp_handler = FIFOHandler(str(pipe_dir / 'cdp.pipe'))
	cdp_handler.setLevel(logging.DEBUG)
	cdp_handler.setFormatter(logging.Formatter('%(levelname)-8s [%(name)s] %(message)s'))
	for name in ['websockets.client', 'cdp_use.client']:
		logger = logging.getLogger(name)
		logger.addHandler(cdp_handler)
		logger.setLevel(logging.DEBUG)
		logger.propagate = True

	# Event logs
	event_handler = FIFOHandler(str(pipe_dir / 'events.pipe'))
	event_handler.setLevel(logging.INFO)
	event_handler.setFormatter(logging.Formatter('%(levelname)-8s [%(name)s] %(message)s'))
	for name in ['bubus', 'browser_use.browser.session']:
		logger = logging.getLogger(name)
		logger.addHandler(event_handler)
		logger.setLevel(logging.INFO)  # Enable INFO for event bus
		logger.propagate = True

```

---

## backend/browser-use/browser_use/mcp/__init__.py

```py
"""MCP (Model Context Protocol) support for browser-use.

This module provides integration with MCP servers and clients for browser automation.
"""

from browser_use.mcp.client import MCPClient
from browser_use.mcp.controller import MCPToolWrapper

__all__ = ['MCPClient', 'MCPToolWrapper', 'BrowserUseServer']  # type: ignore


def __getattr__(name):
	"""Lazy import to avoid importing server module when only client is needed."""
	if name == 'BrowserUseServer':
		from browser_use.mcp.server import BrowserUseServer

		return BrowserUseServer
	raise AttributeError(f"module '{__name__}' has no attribute '{name}'")

```

---

## backend/browser-use/browser_use/mcp/__main__.py

```py
"""Entry point for running MCP server as a module.

Usage:
    python -m browser_use.mcp
"""

import asyncio

from browser_use.mcp.server import main

if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/browser_use/mcp/client.py

```py
"""MCP (Model Context Protocol) client integration for browser-use.

This module provides integration between external MCP servers and browser-use's action registry.
MCP tools are dynamically discovered and registered as browser-use actions.

Example usage:
    from browser_use import Tools
    from browser_use.mcp.client import MCPClient

    tools = Tools()

    # Connect to an MCP server
    mcp_client = MCPClient(
        server_name="my-server",
        command="npx",
        args=["@mycompany/mcp-server@latest"]
    )

    # Register all MCP tools as browser-use actions
    await mcp_client.register_to_tools(tools)

    # Now use with Agent as normal - MCP tools are available as actions
"""

import asyncio
import logging
import time
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, create_model

from browser_use.agent.views import ActionResult
from browser_use.telemetry import MCPClientTelemetryEvent, ProductTelemetry
from browser_use.tools.registry.service import Registry
from browser_use.tools.service import Tools
from browser_use.utils import create_task_with_error_handling, get_browser_use_version

logger = logging.getLogger(__name__)

# Import MCP SDK
from mcp import ClientSession, StdioServerParameters, types
from mcp.client.stdio import stdio_client

MCP_AVAILABLE = True


class MCPClient:
	"""Client for connecting to MCP servers and exposing their tools as browser-use actions."""

	def __init__(
		self,
		server_name: str,
		command: str,
		args: list[str] | None = None,
		env: dict[str, str] | None = None,
	):
		"""Initialize MCP client.

		Args:
			server_name: Name of the MCP server (for logging and identification)
			command: Command to start the MCP server (e.g., "npx", "python")
			args: Arguments for the command (e.g., ["@playwright/mcp@latest"])
			env: Environment variables for the server process
		"""
		self.server_name = server_name
		self.command = command
		self.args = args or []
		self.env = env

		self.session: ClientSession | None = None
		self._stdio_task = None
		self._read_stream = None
		self._write_stream = None
		self._tools: dict[str, types.Tool] = {}
		self._registered_actions: set[str] = set()
		self._connected = False
		self._disconnect_event = asyncio.Event()
		self._telemetry = ProductTelemetry()

	async def connect(self) -> None:
		"""Connect to the MCP server and discover available tools."""
		if self._connected:
			logger.debug(f'Already connected to {self.server_name}')
			return

		start_time = time.time()
		error_msg = None

		try:
			logger.info(f"🔌 Connecting to MCP server '{self.server_name}': {self.command} {' '.join(self.args)}")

			# Create server parameters
			server_params = StdioServerParameters(command=self.command, args=self.args, env=self.env)

			# Start stdio client in background task
			self._stdio_task = create_task_with_error_handling(
				self._run_stdio_client(server_params), name='mcp_stdio_client', suppress_exceptions=True
			)

			# Wait for connection to be established
			retries = 0
			max_retries = 100  # 10 second timeout (increased for parallel test execution)
			while not self._connected and retries < max_retries:
				await asyncio.sleep(0.1)
				retries += 1

			if not self._connected:
				error_msg = f"Failed to connect to MCP server '{self.server_name}' after {max_retries * 0.1} seconds"
				raise RuntimeError(error_msg)

			logger.info(f"📦 Discovered {len(self._tools)} tools from '{self.server_name}': {list(self._tools.keys())}")

		except Exception as e:
			error_msg = str(e)
			raise
		finally:
			# Capture telemetry for connect action
			duration = time.time() - start_time
			self._telemetry.capture(
				MCPClientTelemetryEvent(
					server_name=self.server_name,
					command=self.command,
					tools_discovered=len(self._tools),
					version=get_browser_use_version(),
					action='connect',
					duration_seconds=duration,
					error_message=error_msg,
				)
			)

	async def _run_stdio_client(self, server_params: StdioServerParameters):
		"""Run the stdio client connection in a background task."""
		try:
			async with stdio_client(server_params) as (read_stream, write_stream):
				self._read_stream = read_stream
				self._write_stream = write_stream

				# Create and initialize session
				async with ClientSession(read_stream, write_stream) as session:
					self.session = session

					# Initialize the connection
					await session.initialize()

					# Discover available tools
					tools_response = await session.list_tools()
					self._tools = {tool.name: tool for tool in tools_response.tools}

					# Mark as connected
					self._connected = True

					# Keep the connection alive until disconnect is called
					await self._disconnect_event.wait()

		except Exception as e:
			logger.error(f'MCP server connection error: {e}')
			self._connected = False
			raise
		finally:
			self._connected = False
			self.session = None

	async def disconnect(self) -> None:
		"""Disconnect from the MCP server."""
		if not self._connected:
			return

		start_time = time.time()
		error_msg = None

		try:
			logger.info(f"🔌 Disconnecting from MCP server '{self.server_name}'")

			# Signal disconnect
			self._connected = False
			self._disconnect_event.set()

			# Wait for stdio task to finish
			if self._stdio_task:
				try:
					await asyncio.wait_for(self._stdio_task, timeout=2.0)
				except TimeoutError:
					logger.warning(f"Timeout waiting for MCP server '{self.server_name}' to disconnect")
					self._stdio_task.cancel()
					try:
						await self._stdio_task
					except asyncio.CancelledError:
						pass

			self._tools.clear()
			self._registered_actions.clear()

		except Exception as e:
			error_msg = str(e)
			logger.error(f'Error disconnecting from MCP server: {e}')
		finally:
			# Capture telemetry for disconnect action
			duration = time.time() - start_time
			self._telemetry.capture(
				MCPClientTelemetryEvent(
					server_name=self.server_name,
					command=self.command,
					tools_discovered=0,  # Tools cleared on disconnect
					version=get_browser_use_version(),
					action='disconnect',
					duration_seconds=duration,
					error_message=error_msg,
				)
			)
			self._telemetry.flush()

	async def register_to_tools(
		self,
		tools: Tools,
		tool_filter: list[str] | None = None,
		prefix: str | None = None,
	) -> None:
		"""Register MCP tools as actions in the browser-use tools.

		Args:
			tools: Browser-use tools to register actions to
			tool_filter: Optional list of tool names to register (None = all tools)
			prefix: Optional prefix to add to action names (e.g., "playwright_")
		"""
		if not self._connected:
			await self.connect()

		registry = tools.registry

		for tool_name, tool in self._tools.items():
			# Skip if not in filter
			if tool_filter and tool_name not in tool_filter:
				continue

			# Apply prefix if specified
			action_name = f'{prefix}{tool_name}' if prefix else tool_name

			# Skip if already registered
			if action_name in self._registered_actions:
				continue

			# Register the tool as an action
			self._register_tool_as_action(registry, action_name, tool)
			self._registered_actions.add(action_name)

		logger.info(f"✅ Registered {len(self._registered_actions)} MCP tools from '{self.server_name}' as browser-use actions")

	def _register_tool_as_action(self, registry: Registry, action_name: str, tool: Any) -> None:
		"""Register a single MCP tool as a browser-use action.

		Args:
			registry: Browser-use registry to register action to
			action_name: Name for the registered action
			tool: MCP Tool object with schema information
		"""
		# Parse tool parameters to create Pydantic model
		param_fields = {}

		if tool.inputSchema:
			# MCP tools use JSON Schema for parameters
			properties = tool.inputSchema.get('properties', {})
			required = set(tool.inputSchema.get('required', []))

			for param_name, param_schema in properties.items():
				# Convert JSON Schema type to Python type
				param_type = self._json_schema_to_python_type(param_schema, f'{action_name}_{param_name}')

				# Determine if field is required and handle defaults
				if param_name in required:
					default = ...  # Required field
				else:
					# Optional field - make type optional and handle default
					param_type = param_type | None
					if 'default' in param_schema:
						default = param_schema['default']
					else:
						default = None

				# Add field with description if available
				field_kwargs = {}
				if 'description' in param_schema:
					field_kwargs['description'] = param_schema['description']

				param_fields[param_name] = (param_type, Field(default, **field_kwargs))

		# Create Pydantic model for the tool parameters
		if param_fields:
			# Create a BaseModel class with proper configuration
			class ConfiguredBaseModel(BaseModel):
				model_config = ConfigDict(extra='forbid', validate_by_name=True, validate_by_alias=True)

			param_model = create_model(f'{action_name}_Params', __base__=ConfiguredBaseModel, **param_fields)
		else:
			# No parameters - create empty model
			param_model = None

		# Determine if this is a browser-specific tool
		is_browser_tool = tool.name.startswith('browser_') or 'page' in tool.name.lower()

		# Set up action filters
		domains = None
		# Note: page_filter has been removed since we no longer use Page objects
		# Browser tools filtering would need to be done via domain filters instead

		# Create async wrapper function for the MCP tool
		# Need to define function with explicit parameters to satisfy registry validation
		if param_model:
			# Type 1: Function takes param model as first parameter
			async def mcp_action_wrapper(params: param_model) -> ActionResult:  # type: ignore[no-redef]
				"""Wrapper function that calls the MCP tool."""
				if not self.session or not self._connected:
					return ActionResult(error=f"MCP server '{self.server_name}' not connected", success=False)

				# Convert pydantic model to dict for MCP call
				tool_params = params.model_dump(exclude_none=True)

				logger.debug(f"🔧 Calling MCP tool '{tool.name}' with params: {tool_params}")

				start_time = time.time()
				error_msg = None

				try:
					# Call the MCP tool
					result = await self.session.call_tool(tool.name, tool_params)

					# Convert MCP result to ActionResult
					extracted_content = self._format_mcp_result(result)

					return ActionResult(
						extracted_content=extracted_content,
						long_term_memory=f"Used MCP tool '{tool.name}' from {self.server_name}",
					)

				except Exception as e:
					error_msg = f"MCP tool '{tool.name}' failed: {str(e)}"
					logger.error(error_msg)
					return ActionResult(error=error_msg, success=False)
				finally:
					# Capture telemetry for tool call
					duration = time.time() - start_time
					self._telemetry.capture(
						MCPClientTelemetryEvent(
							server_name=self.server_name,
							command=self.command,
							tools_discovered=len(self._tools),
							version=get_browser_use_version(),
							action='tool_call',
							tool_name=tool.name,
							duration_seconds=duration,
							error_message=error_msg,
						)
					)
		else:
			# No parameters - empty function signature
			async def mcp_action_wrapper() -> ActionResult:  # type: ignore[no-redef]
				"""Wrapper function that calls the MCP tool."""
				if not self.session or not self._connected:
					return ActionResult(error=f"MCP server '{self.server_name}' not connected", success=False)

				logger.debug(f"🔧 Calling MCP tool '{tool.name}' with no params")

				start_time = time.time()
				error_msg = None

				try:
					# Call the MCP tool with empty params
					result = await self.session.call_tool(tool.name, {})

					# Convert MCP result to ActionResult
					extracted_content = self._format_mcp_result(result)

					return ActionResult(
						extracted_content=extracted_content,
						long_term_memory=f"Used MCP tool '{tool.name}' from {self.server_name}",
					)

				except Exception as e:
					error_msg = f"MCP tool '{tool.name}' failed: {str(e)}"
					logger.error(error_msg)
					return ActionResult(error=error_msg, success=False)
				finally:
					# Capture telemetry for tool call
					duration = time.time() - start_time
					self._telemetry.capture(
						MCPClientTelemetryEvent(
							server_name=self.server_name,
							command=self.command,
							tools_discovered=len(self._tools),
							version=get_browser_use_version(),
							action='tool_call',
							tool_name=tool.name,
							duration_seconds=duration,
							error_message=error_msg,
						)
					)

		# Set function metadata for better debugging
		mcp_action_wrapper.__name__ = action_name
		mcp_action_wrapper.__qualname__ = f'mcp.{self.server_name}.{action_name}'

		# Register the action with browser-use
		description = tool.description or f'MCP tool from {self.server_name}: {tool.name}'

		# Use the registry's action decorator
		registry.action(description=description, param_model=param_model, domains=domains)(mcp_action_wrapper)

		logger.debug(f"✅ Registered MCP tool '{tool.name}' as action '{action_name}'")

	def _format_mcp_result(self, result: Any) -> str:
		"""Format MCP tool result into a string for ActionResult.

		Args:
			result: Raw result from MCP tool call

		Returns:
			Formatted string representation of the result
		"""
		# Handle different MCP result formats
		if hasattr(result, 'content'):
			# Structured content response
			if isinstance(result.content, list):
				# Multiple content items
				parts = []
				for item in result.content:
					if hasattr(item, 'text'):
						parts.append(item.text)
					elif hasattr(item, 'type') and item.type == 'text':
						parts.append(str(item))
					else:
						parts.append(str(item))
				return '\n'.join(parts)
			else:
				return str(result.content)
		elif isinstance(result, list):
			# List of content items
			parts = []
			for item in result:
				if hasattr(item, 'text'):
					parts.append(item.text)
				else:
					parts.append(str(item))
			return '\n'.join(parts)
		else:
			# Direct result or unknown format
			return str(result)

	def _json_schema_to_python_type(self, schema: dict, model_name: str = 'NestedModel') -> Any:
		"""Convert JSON Schema type to Python type.

		Args:
			schema: JSON Schema definition
			model_name: Name for nested models

		Returns:
			Python type corresponding to the schema
		"""
		json_type = schema.get('type', 'string')

		# Basic type mapping
		type_mapping = {
			'string': str,
			'number': float,
			'integer': int,
			'boolean': bool,
			'array': list,
			'null': type(None),
		}

		# Handle enums (they're still strings)
		if 'enum' in schema:
			return str

		# Handle objects with nested properties
		if json_type == 'object':
			properties = schema.get('properties', {})
			if properties:
				# Create nested pydantic model for objects with properties
				nested_fields = {}
				required_fields = set(schema.get('required', []))

				for prop_name, prop_schema in properties.items():
					# Recursively process nested properties
					prop_type = self._json_schema_to_python_type(prop_schema, f'{model_name}_{prop_name}')

					# Determine if field is required and handle defaults
					if prop_name in required_fields:
						default = ...  # Required field
					else:
						# Optional field - make type optional and handle default
						prop_type = prop_type | None
						if 'default' in prop_schema:
							default = prop_schema['default']
						else:
							default = None

					# Add field with description if available
					field_kwargs = {}
					if 'description' in prop_schema:
						field_kwargs['description'] = prop_schema['description']

					nested_fields[prop_name] = (prop_type, Field(default, **field_kwargs))

				# Create a BaseModel class with proper configuration
				class ConfiguredBaseModel(BaseModel):
					model_config = ConfigDict(extra='forbid', validate_by_name=True, validate_by_alias=True)

				try:
					# Create and return nested pydantic model
					return create_model(model_name, __base__=ConfiguredBaseModel, **nested_fields)
				except Exception as e:
					logger.error(f'Failed to create nested model {model_name}: {e}')
					logger.debug(f'Fields: {nested_fields}')
					# Fallback to basic dict if model creation fails
					return dict
			else:
				# Object without properties - just return dict
				return dict

		# Handle arrays with specific item types
		if json_type == 'array':
			if 'items' in schema:
				# Get the item type recursively
				item_type = self._json_schema_to_python_type(schema['items'], f'{model_name}_item')
				# Return properly typed list
				return list[item_type]
			else:
				# Array without item type specification
				return list

		# Get base type for non-object types
		base_type = type_mapping.get(json_type, str)

		# Handle nullable/optional types
		if schema.get('nullable', False) or json_type == 'null':
			return base_type | None

		return base_type

	async def __aenter__(self):
		"""Async context manager entry."""
		await self.connect()
		return self

	async def __aexit__(self, exc_type, exc_val, exc_tb):
		"""Async context manager exit."""
		await self.disconnect()

```

---

## backend/browser-use/browser_use/mcp/controller.py

```py
"""MCP (Model Context Protocol) tool wrapper for browser-use.

This module provides integration between MCP tools and browser-use's action registry system.
MCP tools are dynamically discovered and registered as browser-use actions.
"""

import asyncio
import logging
from typing import Any

from pydantic import Field, create_model

from browser_use.agent.views import ActionResult
from browser_use.tools.registry.service import Registry

logger = logging.getLogger(__name__)

try:
	from mcp import ClientSession, StdioServerParameters
	from mcp.client.stdio import stdio_client
	from mcp.types import TextContent, Tool

	MCP_AVAILABLE = True
except ImportError:
	MCP_AVAILABLE = False
	logger.warning('MCP SDK not installed. Install with: pip install mcp')


class MCPToolWrapper:
	"""Wrapper to integrate MCP tools as browser-use actions."""

	def __init__(self, registry: Registry, mcp_command: str, mcp_args: list[str] | None = None):
		"""Initialize MCP tool wrapper.

		Args:
			registry: Browser-use action registry to register MCP tools
			mcp_command: Command to start MCP server (e.g., "npx")
			mcp_args: Arguments for MCP command (e.g., ["@playwright/mcp@latest"])
		"""
		if not MCP_AVAILABLE:
			raise ImportError('MCP SDK not installed. Install with: pip install mcp')

		self.registry = registry
		self.mcp_command = mcp_command
		self.mcp_args = mcp_args or []
		self.session: ClientSession | None = None
		self._tools: dict[str, Tool] = {}
		self._registered_actions: set[str] = set()
		self._shutdown_event = asyncio.Event()

	async def connect(self):
		"""Connect to MCP server and discover available tools."""
		if self.session:
			return  # Already connected

		logger.info(f'🔌 Connecting to MCP server: {self.mcp_command} {" ".join(self.mcp_args)}')

		# Create server parameters
		server_params = StdioServerParameters(command=self.mcp_command, args=self.mcp_args, env=None)

		# Connect to the MCP server
		async with stdio_client(server_params) as (read, write):
			async with ClientSession(read, write) as session:
				self.session = session

				# Initialize the connection
				await session.initialize()

				# Discover available tools
				tools_response = await session.list_tools()
				self._tools = {tool.name: tool for tool in tools_response.tools}

				logger.info(f'📦 Discovered {len(self._tools)} MCP tools: {list(self._tools.keys())}')

				# Register all discovered tools as actions
				for tool_name, tool in self._tools.items():
					self._register_tool_as_action(tool_name, tool)

				# Keep session alive while tools are being used
				await self._keep_session_alive()

	async def _keep_session_alive(self):
		"""Keep the MCP session alive."""
		# This will block until the session is closed
		# In practice, you'd want to manage this lifecycle better
		try:
			await self._shutdown_event.wait()
		except asyncio.CancelledError:
			pass

	def _register_tool_as_action(self, tool_name: str, tool: Tool):
		"""Register an MCP tool as a browser-use action.

		Args:
			tool_name: Name of the MCP tool
			tool: MCP Tool object with schema information
		"""
		if tool_name in self._registered_actions:
			return  # Already registered

		# Parse tool parameters to create Pydantic model
		param_fields = {}

		if tool.inputSchema:
			# MCP tools use JSON Schema for parameters
			properties = tool.inputSchema.get('properties', {})
			required = set(tool.inputSchema.get('required', []))

			for param_name, param_schema in properties.items():
				# Convert JSON Schema type to Python type
				param_type = self._json_schema_to_python_type(param_schema)

				# Determine if field is required
				if param_name in required:
					default = ...  # Required field
				else:
					default = param_schema.get('default', None)

				# Add field description if available
				field_kwargs = {}
				if 'description' in param_schema:
					field_kwargs['description'] = param_schema['description']

				param_fields[param_name] = (param_type, Field(default, **field_kwargs))

		# Create Pydantic model for the tool parameters
		param_model = create_model(f'{tool_name}_Params', **param_fields) if param_fields else None

		# Determine if this is a browser-specific tool
		is_browser_tool = tool_name.startswith('browser_')
		domains = None
		# Note: page_filter has been removed since we no longer use Page objects

		# Create wrapper function for the MCP tool
		async def mcp_action_wrapper(**kwargs):
			"""Wrapper function that calls the MCP tool."""
			if not self.session:
				raise RuntimeError(f'MCP session not connected for tool {tool_name}')

			# Extract parameters (excluding special injected params)
			special_params = {
				'page',
				'browser_session',
				'context',
				'page_extraction_llm',
				'file_system',
				'available_file_paths',
				'has_sensitive_data',
				'browser',
				'browser_context',
			}

			tool_params = {k: v for k, v in kwargs.items() if k not in special_params}

			logger.debug(f'🔧 Calling MCP tool {tool_name} with params: {tool_params}')

			try:
				# Call the MCP tool
				result = await self.session.call_tool(tool_name, tool_params)

				# Convert MCP result to ActionResult
				# MCP tools return results in various formats
				if hasattr(result, 'content'):
					# Handle structured content responses
					if isinstance(result.content, list):
						# Multiple content items
						content_parts = []
						for item in result.content:
							if isinstance(item, TextContent):
								content_parts.append(item.text)  # type: ignore[reportAttributeAccessIssue]
							else:
								content_parts.append(str(item))
						extracted_content = '\n'.join(content_parts)
					else:
						extracted_content = str(result.content)
				else:
					# Direct result
					extracted_content = str(result)

				return ActionResult(extracted_content=extracted_content)

			except Exception as e:
				logger.error(f'❌ MCP tool {tool_name} failed: {e}')
				return ActionResult(extracted_content=f'MCP tool {tool_name} failed: {str(e)}', error=str(e))

		# Set function name for better debugging
		mcp_action_wrapper.__name__ = tool_name
		mcp_action_wrapper.__qualname__ = f'mcp.{tool_name}'

		# Register the action with browser-use
		description = tool.description or f'MCP tool: {tool_name}'

		# Use the decorator to register the action
		decorated_wrapper = self.registry.action(description=description, param_model=param_model, domains=domains)(
			mcp_action_wrapper
		)

		self._registered_actions.add(tool_name)
		logger.info(f'✅ Registered MCP tool as action: {tool_name}')

	async def disconnect(self):
		"""Disconnect from the MCP server and clean up resources."""
		self._shutdown_event.set()
		if self.session:
			# Session cleanup will be handled by the context manager
			self.session = None

	def _json_schema_to_python_type(self, schema: dict) -> Any:
		"""Convert JSON Schema type to Python type.

		Args:
			schema: JSON Schema definition

		Returns:
			Python type corresponding to the schema
		"""
		json_type = schema.get('type', 'string')

		type_mapping = {
			'string': str,
			'number': float,
			'integer': int,
			'boolean': bool,
			'array': list,
			'object': dict,
		}

		base_type = type_mapping.get(json_type, str)

		# Handle nullable types
		if schema.get('nullable', False):
			return base_type | None

		return base_type


# Convenience function for easy integration
async def register_mcp_tools(registry: Registry, mcp_command: str, mcp_args: list[str] | None = None) -> MCPToolWrapper:
	"""Register MCP tools with a browser-use registry.

	Args:
		registry: Browser-use action registry
		mcp_command: Command to start MCP server
		mcp_args: Arguments for MCP command

	Returns:
		MCPToolWrapper instance (connected)

	Example:
		``\`python
	        from browser_use import Tools
	        from browser_use.mcp.tools import register_mcp_tools

	        tools = Tools()

	        # Register Playwright MCP tools
	        mcp = await register_mcp_tools(tools.registry, 'npx', ['@playwright/mcp@latest', '--headless'])

	        # Now all MCP tools are available as browser-use actions
		``\`
	"""
	wrapper = MCPToolWrapper(registry, mcp_command, mcp_args)
	await wrapper.connect()
	return wrapper

```

---

## backend/browser-use/browser_use/mcp/server.py

```py
"""MCP Server for browser-use - exposes browser automation capabilities via Model Context Protocol.

This server provides tools for:
- Running autonomous browser tasks with an AI agent
- Direct browser control (navigation, clicking, typing, etc.)
- Content extraction from web pages
- File system operations

Usage:
    uvx browser-use --mcp

Or as an MCP server in Claude Desktop or other MCP clients:
    {
        "mcpServers": {
            "browser-use": {
                "command": "uvx",
                "args": ["browser-use[cli]", "--mcp"],
                "env": {
                    "OPENAI_API_KEY": "sk-proj-1234567890",
                }
            }
        }
    }
"""

import os
import sys

from browser_use.llm import ChatAWSBedrock

# Set environment variables BEFORE any browser_use imports to prevent early logging
os.environ['BROWSER_USE_LOGGING_LEVEL'] = 'critical'
os.environ['BROWSER_USE_SETUP_LOGGING'] = 'false'

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Any

# Configure logging for MCP mode - redirect to stderr but preserve critical diagnostics
logging.basicConfig(
	stream=sys.stderr, level=logging.WARNING, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s', force=True
)

try:
	import psutil

	PSUTIL_AVAILABLE = True
except ImportError:
	PSUTIL_AVAILABLE = False

# Add browser-use to path if running from source
sys.path.insert(0, str(Path(__file__).parent.parent))

# Import and configure logging to use stderr before other imports
from browser_use.logging_config import setup_logging


def _configure_mcp_server_logging():
	"""Configure logging for MCP server mode - redirect all logs to stderr to prevent JSON RPC interference."""
	# Set environment to suppress browser-use logging during server mode
	os.environ['BROWSER_USE_LOGGING_LEVEL'] = 'warning'
	os.environ['BROWSER_USE_SETUP_LOGGING'] = 'false'  # Prevent automatic logging setup

	# Configure logging to stderr for MCP mode - preserve warnings and above for troubleshooting
	setup_logging(stream=sys.stderr, log_level='warning', force_setup=True)

	# Also configure the root logger and all existing loggers to use stderr
	logging.root.handlers = []
	stderr_handler = logging.StreamHandler(sys.stderr)
	stderr_handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
	logging.root.addHandler(stderr_handler)
	logging.root.setLevel(logging.CRITICAL)

	# Configure all existing loggers to use stderr and CRITICAL level
	for name in list(logging.root.manager.loggerDict.keys()):
		logger_obj = logging.getLogger(name)
		logger_obj.handlers = []
		logger_obj.setLevel(logging.CRITICAL)
		logger_obj.addHandler(stderr_handler)
		logger_obj.propagate = False


# Configure MCP server logging before any browser_use imports to capture early log lines
_configure_mcp_server_logging()

# Additional suppression - disable all logging completely for MCP mode
logging.disable(logging.CRITICAL)

# Import browser_use modules
from browser_use import ActionModel, Agent
from browser_use.browser import BrowserProfile, BrowserSession
from browser_use.config import get_default_llm, get_default_profile, load_browser_use_config
from browser_use.filesystem.file_system import FileSystem
from browser_use.llm.openai.chat import ChatOpenAI
from browser_use.tools.service import Tools

logger = logging.getLogger(__name__)


def _ensure_all_loggers_use_stderr():
	"""Ensure ALL loggers only output to stderr, not stdout."""
	# Get the stderr handler
	stderr_handler = None
	for handler in logging.root.handlers:
		if hasattr(handler, 'stream') and handler.stream == sys.stderr:  # type: ignore
			stderr_handler = handler
			break

	if not stderr_handler:
		stderr_handler = logging.StreamHandler(sys.stderr)
		stderr_handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))

	# Configure root logger
	logging.root.handlers = [stderr_handler]
	logging.root.setLevel(logging.CRITICAL)

	# Configure all existing loggers
	for name in list(logging.root.manager.loggerDict.keys()):
		logger_obj = logging.getLogger(name)
		logger_obj.handlers = [stderr_handler]
		logger_obj.setLevel(logging.CRITICAL)
		logger_obj.propagate = False


# Ensure stderr logging after all imports
_ensure_all_loggers_use_stderr()


# Try to import MCP SDK
try:
	import mcp.server.stdio
	import mcp.types as types
	from mcp.server import NotificationOptions, Server
	from mcp.server.models import InitializationOptions

	MCP_AVAILABLE = True

	# Configure MCP SDK logging to stderr as well
	mcp_logger = logging.getLogger('mcp')
	mcp_logger.handlers = []
	mcp_logger.addHandler(logging.root.handlers[0] if logging.root.handlers else logging.StreamHandler(sys.stderr))
	mcp_logger.setLevel(logging.ERROR)
	mcp_logger.propagate = False
except ImportError:
	MCP_AVAILABLE = False
	logger.error('MCP SDK not installed. Install with: pip install mcp')
	sys.exit(1)

from browser_use.telemetry import MCPServerTelemetryEvent, ProductTelemetry
from browser_use.utils import create_task_with_error_handling, get_browser_use_version


def get_parent_process_cmdline() -> str | None:
	"""Get the command line of all parent processes up the chain."""
	if not PSUTIL_AVAILABLE:
		return None

	try:
		cmdlines = []
		current_process = psutil.Process()
		parent = current_process.parent()

		while parent:
			try:
				cmdline = parent.cmdline()
				if cmdline:
					cmdlines.append(' '.join(cmdline))
			except (psutil.AccessDenied, psutil.NoSuchProcess):
				# Skip processes we can't access (like system processes)
				pass

			try:
				parent = parent.parent()
			except (psutil.AccessDenied, psutil.NoSuchProcess):
				# Can't go further up the chain
				break

		return ';'.join(cmdlines) if cmdlines else None
	except Exception:
		# If we can't get parent process info, just return None
		return None


class BrowserUseServer:
	"""MCP Server for browser-use capabilities."""

	def __init__(self, session_timeout_minutes: int = 10):
		# Ensure all logging goes to stderr (in case new loggers were created)
		_ensure_all_loggers_use_stderr()

		self.server = Server('browser-use')
		self.config = load_browser_use_config()
		self.agent: Agent | None = None
		self.browser_session: BrowserSession | None = None
		self.tools: Tools | None = None
		self.llm: ChatOpenAI | None = None
		self.file_system: FileSystem | None = None
		self._telemetry = ProductTelemetry()
		self._start_time = time.time()

		# Session management
		self.active_sessions: dict[str, dict[str, Any]] = {}  # session_id -> session info
		self.session_timeout_minutes = session_timeout_minutes
		self._cleanup_task: Any = None

		# Setup handlers
		self._setup_handlers()

	def _setup_handlers(self):
		"""Setup MCP server handlers."""

		@self.server.list_tools()
		async def handle_list_tools() -> list[types.Tool]:
			"""List all available browser-use tools."""
			return [
				# Agent tools
				# Direct browser control tools
				types.Tool(
					name='browser_navigate',
					description='Navigate to a URL in the browser',
					inputSchema={
						'type': 'object',
						'properties': {
							'url': {'type': 'string', 'description': 'The URL to navigate to'},
							'new_tab': {'type': 'boolean', 'description': 'Whether to open in a new tab', 'default': False},
						},
						'required': ['url'],
					},
				),
				types.Tool(
					name='browser_click',
					description='Click an element on the page by its index',
					inputSchema={
						'type': 'object',
						'properties': {
							'index': {
								'type': 'integer',
								'description': 'The index of the link or element to click (from browser_get_state)',
							},
							'new_tab': {
								'type': 'boolean',
								'description': 'Whether to open any resulting navigation in a new tab',
								'default': False,
							},
						},
						'required': ['index'],
					},
				),
				types.Tool(
					name='browser_type',
					description='Type text into an input field',
					inputSchema={
						'type': 'object',
						'properties': {
							'index': {
								'type': 'integer',
								'description': 'The index of the input element (from browser_get_state)',
							},
							'text': {'type': 'string', 'description': 'The text to type'},
						},
						'required': ['index', 'text'],
					},
				),
				types.Tool(
					name='browser_get_state',
					description='Get the current state of the page including all interactive elements',
					inputSchema={
						'type': 'object',
						'properties': {
							'include_screenshot': {
								'type': 'boolean',
								'description': 'Whether to include a screenshot of the current page',
								'default': False,
							}
						},
					},
				),
				types.Tool(
					name='browser_extract_content',
					description='Extract structured content from the current page based on a query',
					inputSchema={
						'type': 'object',
						'properties': {
							'query': {'type': 'string', 'description': 'What information to extract from the page'},
							'extract_links': {
								'type': 'boolean',
								'description': 'Whether to include links in the extraction',
								'default': False,
							},
						},
						'required': ['query'],
					},
				),
				types.Tool(
					name='browser_scroll',
					description='Scroll the page',
					inputSchema={
						'type': 'object',
						'properties': {
							'direction': {
								'type': 'string',
								'enum': ['up', 'down'],
								'description': 'Direction to scroll',
								'default': 'down',
							}
						},
					},
				),
				types.Tool(
					name='browser_go_back',
					description='Go back to the previous page',
					inputSchema={'type': 'object', 'properties': {}},
				),
				# Tab management
				types.Tool(
					name='browser_list_tabs', description='List all open tabs', inputSchema={'type': 'object', 'properties': {}}
				),
				types.Tool(
					name='browser_switch_tab',
					description='Switch to a different tab',
					inputSchema={
						'type': 'object',
						'properties': {'tab_id': {'type': 'string', 'description': '4 Character Tab ID of the tab to switch to'}},
						'required': ['tab_id'],
					},
				),
				types.Tool(
					name='browser_close_tab',
					description='Close a tab',
					inputSchema={
						'type': 'object',
						'properties': {'tab_id': {'type': 'string', 'description': '4 Character Tab ID of the tab to close'}},
						'required': ['tab_id'],
					},
				),
				# types.Tool(
				# 	name="browser_close",
				# 	description="Close the browser session",
				# 	inputSchema={
				# 		"type": "object",
				# 		"properties": {}
				# 	}
				# ),
				types.Tool(
					name='retry_with_browser_use_agent',
					description='Retry a task using the browser-use agent. Only use this as a last resort if you fail to interact with a page multiple times.',
					inputSchema={
						'type': 'object',
						'properties': {
							'task': {
								'type': 'string',
								'description': 'The high-level goal and detailed step-by-step description of the task the AI browser agent needs to attempt, along with any relevant data needed to complete the task and info about previous attempts.',
							},
							'max_steps': {
								'type': 'integer',
								'description': 'Maximum number of steps an agent can take.',
								'default': 100,
							},
							'model': {
								'type': 'string',
								'description': 'LLM model to use (e.g., gpt-4o, claude-3-opus-20240229)',
								'default': 'gpt-4o',
							},
							'allowed_domains': {
								'type': 'array',
								'items': {'type': 'string'},
								'description': 'List of domains the agent is allowed to visit (security feature)',
								'default': [],
							},
							'use_vision': {
								'type': 'boolean',
								'description': 'Whether to use vision capabilities (screenshots) for the agent',
								'default': True,
							},
						},
						'required': ['task'],
					},
				),
				# Browser session management tools
				types.Tool(
					name='browser_list_sessions',
					description='List all active browser sessions with their details and last activity time',
					inputSchema={'type': 'object', 'properties': {}},
				),
				types.Tool(
					name='browser_close_session',
					description='Close a specific browser session by its ID',
					inputSchema={
						'type': 'object',
						'properties': {
							'session_id': {
								'type': 'string',
								'description': 'The browser session ID to close (get from browser_list_sessions)',
							}
						},
						'required': ['session_id'],
					},
				),
				types.Tool(
					name='browser_close_all',
					description='Close all active browser sessions and clean up resources',
					inputSchema={'type': 'object', 'properties': {}},
				),
			]

		@self.server.list_resources()
		async def handle_list_resources() -> list[types.Resource]:
			"""List available resources (none for browser-use)."""
			return []

		@self.server.list_prompts()
		async def handle_list_prompts() -> list[types.Prompt]:
			"""List available prompts (none for browser-use)."""
			return []

		@self.server.call_tool()
		async def handle_call_tool(name: str, arguments: dict[str, Any] | None) -> list[types.TextContent]:
			"""Handle tool execution."""
			start_time = time.time()
			error_msg = None
			try:
				result = await self._execute_tool(name, arguments or {})
				return [types.TextContent(type='text', text=result)]
			except Exception as e:
				error_msg = str(e)
				logger.error(f'Tool execution failed: {e}', exc_info=True)
				return [types.TextContent(type='text', text=f'Error: {str(e)}')]
			finally:
				# Capture telemetry for tool calls
				duration = time.time() - start_time
				self._telemetry.capture(
					MCPServerTelemetryEvent(
						version=get_browser_use_version(),
						action='tool_call',
						tool_name=name,
						duration_seconds=duration,
						error_message=error_msg,
					)
				)

	async def _execute_tool(self, tool_name: str, arguments: dict[str, Any]) -> str:
		"""Execute a browser-use tool."""

		# Agent-based tools
		if tool_name == 'retry_with_browser_use_agent':
			return await self._retry_with_browser_use_agent(
				task=arguments['task'],
				max_steps=arguments.get('max_steps', 100),
				model=arguments.get('model', 'gpt-4o'),
				allowed_domains=arguments.get('allowed_domains', []),
				use_vision=arguments.get('use_vision', True),
			)

		# Browser session management tools (don't require active session)
		if tool_name == 'browser_list_sessions':
			return await self._list_sessions()

		elif tool_name == 'browser_close_session':
			return await self._close_session(arguments['session_id'])

		elif tool_name == 'browser_close_all':
			return await self._close_all_sessions()

		# Direct browser control tools (require active session)
		elif tool_name.startswith('browser_'):
			# Ensure browser session exists
			if not self.browser_session:
				await self._init_browser_session()

			if tool_name == 'browser_navigate':
				return await self._navigate(arguments['url'], arguments.get('new_tab', False))

			elif tool_name == 'browser_click':
				return await self._click(arguments['index'], arguments.get('new_tab', False))

			elif tool_name == 'browser_type':
				return await self._type_text(arguments['index'], arguments['text'])

			elif tool_name == 'browser_get_state':
				return await self._get_browser_state(arguments.get('include_screenshot', False))

			elif tool_name == 'browser_extract_content':
				return await self._extract_content(arguments['query'], arguments.get('extract_links', False))

			elif tool_name == 'browser_scroll':
				return await self._scroll(arguments.get('direction', 'down'))

			elif tool_name == 'browser_go_back':
				return await self._go_back()

			elif tool_name == 'browser_close':
				return await self._close_browser()

			elif tool_name == 'browser_list_tabs':
				return await self._list_tabs()

			elif tool_name == 'browser_switch_tab':
				return await self._switch_tab(arguments['tab_id'])

			elif tool_name == 'browser_close_tab':
				return await self._close_tab(arguments['tab_id'])

		return f'Unknown tool: {tool_name}'

	async def _init_browser_session(self, allowed_domains: list[str] | None = None, **kwargs):
		"""Initialize browser session using config"""
		if self.browser_session:
			return

		# Ensure all logging goes to stderr before browser initialization
		_ensure_all_loggers_use_stderr()

		logger.debug('Initializing browser session...')

		# Get profile config
		profile_config = get_default_profile(self.config)

		# Merge profile config with defaults and overrides
		profile_data = {
			'downloads_path': str(Path.home() / 'Downloads' / 'browser-use-mcp'),
			'wait_between_actions': 0.5,
			'keep_alive': True,
			'user_data_dir': '~/.config/browseruse/profiles/default',
			'device_scale_factor': 1.0,
			'disable_security': False,
			'headless': False,
			**profile_config,  # Config values override defaults
		}

		# Tool parameter overrides (highest priority)
		if allowed_domains is not None:
			profile_data['allowed_domains'] = allowed_domains

		# Merge any additional kwargs that are valid BrowserProfile fields
		for key, value in kwargs.items():
			profile_data[key] = value

		# Create browser profile
		profile = BrowserProfile(**profile_data)

		# Create browser session
		self.browser_session = BrowserSession(browser_profile=profile)
		await self.browser_session.start()

		# Track the session for management
		self._track_session(self.browser_session)

		# Create tools for direct actions
		self.tools = Tools()

		# Initialize LLM from config
		llm_config = get_default_llm(self.config)
		base_url = llm_config.get('base_url', None)
		kwargs = {}
		if base_url:
			kwargs['base_url'] = base_url
		if api_key := llm_config.get('api_key'):
			self.llm = ChatOpenAI(
				model=llm_config.get('model', 'gpt-o4-mini'),
				api_key=api_key,
				temperature=llm_config.get('temperature', 0.7),
				**kwargs,
			)

		# Initialize FileSystem for extraction actions
		file_system_path = profile_config.get('file_system_path', '~/.browser-use-mcp')
		self.file_system = FileSystem(base_dir=Path(file_system_path).expanduser())

		logger.debug('Browser session initialized')

	async def _retry_with_browser_use_agent(
		self,
		task: str,
		max_steps: int = 100,
		model: str = 'gpt-4o',
		allowed_domains: list[str] | None = None,
		use_vision: bool = True,
	) -> str:
		"""Run an autonomous agent task."""
		logger.debug(f'Running agent task: {task}')

		# Get LLM config
		llm_config = get_default_llm(self.config)

		# Get LLM provider
		model_provider = llm_config.get('model_provider') or os.getenv('MODEL_PROVIDER')

		# 如果model_provider不等于空，且等Bedrock
		if model_provider and model_provider.lower() == 'bedrock':
			llm_model = llm_config.get('model') or os.getenv('MODEL') or 'us.anthropic.claude-sonnet-4-20250514-v1:0'
			aws_region = llm_config.get('region') or os.getenv('REGION')
			if not aws_region:
				aws_region = 'us-east-1'
			llm = ChatAWSBedrock(
				model=llm_model,  # or any Bedrock model
				aws_region=aws_region,
				aws_sso_auth=True,
			)
		else:
			api_key = llm_config.get('api_key') or os.getenv('OPENAI_API_KEY')
			if not api_key:
				return 'Error: OPENAI_API_KEY not set in config or environment'

			# Override model if provided in tool call
			if model != llm_config.get('model', 'gpt-4o'):
				llm_model = model
			else:
				llm_model = llm_config.get('model', 'gpt-4o')

			base_url = llm_config.get('base_url', None)
			kwargs = {}
			if base_url:
				kwargs['base_url'] = base_url
			llm = ChatOpenAI(
				model=llm_model,
				api_key=api_key,
				temperature=llm_config.get('temperature', 0.7),
				**kwargs,
			)

		# Get profile config and merge with tool parameters
		profile_config = get_default_profile(self.config)

		# Override allowed_domains if provided in tool call
		if allowed_domains is not None:
			profile_config['allowed_domains'] = allowed_domains

		# Create browser profile using config
		profile = BrowserProfile(**profile_config)

		# Create and run agent
		agent = Agent(
			task=task,
			llm=llm,
			browser_profile=profile,
			use_vision=use_vision,
		)

		try:
			history = await agent.run(max_steps=max_steps)

			# Format results
			results = []
			results.append(f'Task completed in {len(history.history)} steps')
			results.append(f'Success: {history.is_successful()}')

			# Get final result if available
			final_result = history.final_result()
			if final_result:
				results.append(f'\nFinal result:\n{final_result}')

			# Include any errors
			errors = history.errors()
			if errors:
				results.append(f'\nErrors encountered:\n{json.dumps(errors, indent=2)}')

			# Include URLs visited
			urls = history.urls()
			if urls:
				# Filter out None values and convert to strings
				valid_urls = [str(url) for url in urls if url is not None]
				if valid_urls:
					results.append(f'\nURLs visited: {", ".join(valid_urls)}')

			return '\n'.join(results)

		except Exception as e:
			logger.error(f'Agent task failed: {e}', exc_info=True)
			return f'Agent task failed: {str(e)}'
		finally:
			# Clean up
			await agent.close()

	async def _navigate(self, url: str, new_tab: bool = False) -> str:
		"""Navigate to a URL."""
		if not self.browser_session:
			return 'Error: No browser session active'

		# Update session activity
		self._update_session_activity(self.browser_session.id)

		from browser_use.browser.events import NavigateToUrlEvent

		if new_tab:
			event = self.browser_session.event_bus.dispatch(NavigateToUrlEvent(url=url, new_tab=True))
			await event
			return f'Opened new tab with URL: {url}'
		else:
			event = self.browser_session.event_bus.dispatch(NavigateToUrlEvent(url=url))
			await event
			return f'Navigated to: {url}'

	async def _click(self, index: int, new_tab: bool = False) -> str:
		"""Click an element by index."""
		if not self.browser_session:
			return 'Error: No browser session active'

		# Update session activity
		self._update_session_activity(self.browser_session.id)

		# Get the element
		element = await self.browser_session.get_dom_element_by_index(index)
		if not element:
			return f'Element with index {index} not found'

		if new_tab:
			# For links, extract href and open in new tab
			href = element.attributes.get('href')
			if href:
				# Convert relative href to absolute URL
				state = await self.browser_session.get_browser_state_summary()
				current_url = state.url
				if href.startswith('/'):
					# Relative URL - construct full URL
					from urllib.parse import urlparse

					parsed = urlparse(current_url)
					full_url = f'{parsed.scheme}://{parsed.netloc}{href}'
				else:
					full_url = href

				# Open link in new tab
				from browser_use.browser.events import NavigateToUrlEvent

				event = self.browser_session.event_bus.dispatch(NavigateToUrlEvent(url=full_url, new_tab=True))
				await event
				return f'Clicked element {index} and opened in new tab {full_url[:20]}...'
			else:
				# For non-link elements, just do a normal click
				# Opening in new tab without href is not reliably supported
				from browser_use.browser.events import ClickElementEvent

				event = self.browser_session.event_bus.dispatch(ClickElementEvent(node=element))
				await event
				return f'Clicked element {index} (new tab not supported for non-link elements)'
		else:
			# Normal click
			from browser_use.browser.events import ClickElementEvent

			event = self.browser_session.event_bus.dispatch(ClickElementEvent(node=element))
			await event
			return f'Clicked element {index}'

	async def _type_text(self, index: int, text: str) -> str:
		"""Type text into an element."""
		if not self.browser_session:
			return 'Error: No browser session active'

		element = await self.browser_session.get_dom_element_by_index(index)
		if not element:
			return f'Element with index {index} not found'

		from browser_use.browser.events import TypeTextEvent

		# Conservative heuristic to detect potentially sensitive data
		# Only flag very obvious patterns to minimize false positives
		is_potentially_sensitive = len(text) >= 6 and (
			# Email pattern: contains @ and a domain-like suffix
			('@' in text and '.' in text.split('@')[-1] if '@' in text else False)
			# Mixed alphanumeric with reasonable complexity (likely API keys/tokens)
			or (
				len(text) >= 16
				and any(char.isdigit() for char in text)
				and any(char.isalpha() for char in text)
				and any(char in '.-_' for char in text)
			)
		)

		# Use generic key names to avoid information leakage about detection patterns
		sensitive_key_name = None
		if is_potentially_sensitive:
			if '@' in text and '.' in text.split('@')[-1]:
				sensitive_key_name = 'email'
			else:
				sensitive_key_name = 'credential'

		event = self.browser_session.event_bus.dispatch(
			TypeTextEvent(node=element, text=text, is_sensitive=is_potentially_sensitive, sensitive_key_name=sensitive_key_name)
		)
		await event

		if is_potentially_sensitive:
			if sensitive_key_name:
				return f'Typed <{sensitive_key_name}> into element {index}'
			else:
				return f'Typed <sensitive> into element {index}'
		else:
			return f"Typed '{text}' into element {index}"

	async def _get_browser_state(self, include_screenshot: bool = False) -> str:
		"""Get current browser state."""
		if not self.browser_session:
			return 'Error: No browser session active'

		state = await self.browser_session.get_browser_state_summary()

		result = {
			'url': state.url,
			'title': state.title,
			'tabs': [{'url': tab.url, 'title': tab.title} for tab in state.tabs],
			'interactive_elements': [],
		}

		# Add interactive elements with their indices
		for index, element in state.dom_state.selector_map.items():
			elem_info = {
				'index': index,
				'tag': element.tag_name,
				'text': element.get_all_children_text(max_depth=2)[:100],
			}
			if element.attributes.get('placeholder'):
				elem_info['placeholder'] = element.attributes['placeholder']
			if element.attributes.get('href'):
				elem_info['href'] = element.attributes['href']
			result['interactive_elements'].append(elem_info)

		if include_screenshot and state.screenshot:
			result['screenshot'] = state.screenshot

		return json.dumps(result, indent=2)

	async def _extract_content(self, query: str, extract_links: bool = False) -> str:
		"""Extract content from current page."""
		if not self.llm:
			return 'Error: LLM not initialized (set OPENAI_API_KEY)'

		if not self.file_system:
			return 'Error: FileSystem not initialized'

		if not self.browser_session:
			return 'Error: No browser session active'

		if not self.tools:
			return 'Error: Tools not initialized'

		state = await self.browser_session.get_browser_state_summary()

		# Use the extract action
		# Create a dynamic action model that matches the tools's expectations
		from pydantic import create_model

		# Create action model dynamically
		ExtractAction = create_model(
			'ExtractAction',
			__base__=ActionModel,
			extract=dict[str, Any],
		)

		# Use model_validate because Pyright does not understand the dynamic model
		action = ExtractAction.model_validate(
			{
				'extract': {'query': query, 'extract_links': extract_links},
			}
		)
		action_result = await self.tools.act(
			action=action,
			browser_session=self.browser_session,
			page_extraction_llm=self.llm,
			file_system=self.file_system,
		)

		return action_result.extracted_content or 'No content extracted'

	async def _scroll(self, direction: str = 'down') -> str:
		"""Scroll the page."""
		if not self.browser_session:
			return 'Error: No browser session active'

		from browser_use.browser.events import ScrollEvent

		# Scroll by a standard amount (500 pixels)
		event = self.browser_session.event_bus.dispatch(
			ScrollEvent(
				direction=direction,  # type: ignore
				amount=500,
			)
		)
		await event
		return f'Scrolled {direction}'

	async def _go_back(self) -> str:
		"""Go back in browser history."""
		if not self.browser_session:
			return 'Error: No browser session active'

		from browser_use.browser.events import GoBackEvent

		event = self.browser_session.event_bus.dispatch(GoBackEvent())
		await event
		return 'Navigated back'

	async def _close_browser(self) -> str:
		"""Close the browser session."""
		if self.browser_session:
			from browser_use.browser.events import BrowserStopEvent

			event = self.browser_session.event_bus.dispatch(BrowserStopEvent())
			await event
			self.browser_session = None
			self.tools = None
			return 'Browser closed'
		return 'No browser session to close'

	async def _list_tabs(self) -> str:
		"""List all open tabs."""
		if not self.browser_session:
			return 'Error: No browser session active'

		tabs_info = await self.browser_session.get_tabs()
		tabs = []
		for i, tab in enumerate(tabs_info):
			tabs.append({'tab_id': tab.target_id[-4:], 'url': tab.url, 'title': tab.title or ''})
		return json.dumps(tabs, indent=2)

	async def _switch_tab(self, tab_id: str) -> str:
		"""Switch to a different tab."""
		if not self.browser_session:
			return 'Error: No browser session active'

		from browser_use.browser.events import SwitchTabEvent

		target_id = await self.browser_session.get_target_id_from_tab_id(tab_id)
		event = self.browser_session.event_bus.dispatch(SwitchTabEvent(target_id=target_id))
		await event
		state = await self.browser_session.get_browser_state_summary()
		return f'Switched to tab {tab_id}: {state.url}'

	async def _close_tab(self, tab_id: str) -> str:
		"""Close a specific tab."""
		if not self.browser_session:
			return 'Error: No browser session active'

		from browser_use.browser.events import CloseTabEvent

		target_id = await self.browser_session.get_target_id_from_tab_id(tab_id)
		event = self.browser_session.event_bus.dispatch(CloseTabEvent(target_id=target_id))
		await event
		current_url = await self.browser_session.get_current_page_url()
		return f'Closed tab # {tab_id}, now on {current_url}'

	def _track_session(self, session: BrowserSession) -> None:
		"""Track a browser session for management."""
		self.active_sessions[session.id] = {
			'session': session,
			'created_at': time.time(),
			'last_activity': time.time(),
			'url': getattr(session, 'current_url', None),
		}

	def _update_session_activity(self, session_id: str) -> None:
		"""Update the last activity time for a session."""
		if session_id in self.active_sessions:
			self.active_sessions[session_id]['last_activity'] = time.time()

	async def _list_sessions(self) -> str:
		"""List all active browser sessions."""
		if not self.active_sessions:
			return 'No active browser sessions'

		sessions_info = []
		for session_id, session_data in self.active_sessions.items():
			session = session_data['session']
			created_at = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(session_data['created_at']))
			last_activity = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(session_data['last_activity']))

			# Check if session is still active
			is_active = hasattr(session, 'cdp_client') and session.cdp_client is not None

			sessions_info.append(
				{
					'session_id': session_id,
					'created_at': created_at,
					'last_activity': last_activity,
					'active': is_active,
					'current_url': session_data.get('url', 'Unknown'),
					'age_minutes': (time.time() - session_data['created_at']) / 60,
				}
			)

		return json.dumps(sessions_info, indent=2)

	async def _close_session(self, session_id: str) -> str:
		"""Close a specific browser session."""
		if session_id not in self.active_sessions:
			return f'Session {session_id} not found'

		session_data = self.active_sessions[session_id]
		session = session_data['session']

		try:
			# Close the session
			if hasattr(session, 'kill'):
				await session.kill()
			elif hasattr(session, 'close'):
				await session.close()

			# Remove from tracking
			del self.active_sessions[session_id]

			# If this was the current session, clear it
			if self.browser_session and self.browser_session.id == session_id:
				self.browser_session = None
				self.tools = None

			return f'Successfully closed session {session_id}'
		except Exception as e:
			return f'Error closing session {session_id}: {str(e)}'

	async def _close_all_sessions(self) -> str:
		"""Close all active browser sessions."""
		if not self.active_sessions:
			return 'No active sessions to close'

		closed_count = 0
		errors = []

		for session_id in list(self.active_sessions.keys()):
			try:
				result = await self._close_session(session_id)
				if 'Successfully closed' in result:
					closed_count += 1
				else:
					errors.append(f'{session_id}: {result}')
			except Exception as e:
				errors.append(f'{session_id}: {str(e)}')

		# Clear current session references
		self.browser_session = None
		self.tools = None

		result = f'Closed {closed_count} sessions'
		if errors:
			result += f'. Errors: {"; ".join(errors)}'

		return result

	async def _cleanup_expired_sessions(self) -> None:
		"""Background task to clean up expired sessions."""
		current_time = time.time()
		timeout_seconds = self.session_timeout_minutes * 60

		expired_sessions = []
		for session_id, session_data in self.active_sessions.items():
			last_activity = session_data['last_activity']
			if current_time - last_activity > timeout_seconds:
				expired_sessions.append(session_id)

		for session_id in expired_sessions:
			try:
				await self._close_session(session_id)
				logger.info(f'Auto-closed expired session {session_id}')
			except Exception as e:
				logger.error(f'Error auto-closing session {session_id}: {e}')

	async def _start_cleanup_task(self) -> None:
		"""Start the background cleanup task."""

		async def cleanup_loop():
			while True:
				try:
					await self._cleanup_expired_sessions()
					# Check every 2 minutes
					await asyncio.sleep(120)
				except Exception as e:
					logger.error(f'Error in cleanup task: {e}')
					await asyncio.sleep(120)

		self._cleanup_task = create_task_with_error_handling(cleanup_loop(), name='mcp_cleanup_loop', suppress_exceptions=True)

	async def run(self):
		"""Run the MCP server."""
		# Start the cleanup task
		await self._start_cleanup_task()

		async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
			await self.server.run(
				read_stream,
				write_stream,
				InitializationOptions(
					server_name='browser-use',
					server_version='0.1.0',
					capabilities=self.server.get_capabilities(
						notification_options=NotificationOptions(),
						experimental_capabilities={},
					),
				),
			)


async def main(session_timeout_minutes: int = 10):
	if not MCP_AVAILABLE:
		print('MCP SDK is required. Install with: pip install mcp', file=sys.stderr)
		sys.exit(1)

	server = BrowserUseServer(session_timeout_minutes=session_timeout_minutes)
	server._telemetry.capture(
		MCPServerTelemetryEvent(
			version=get_browser_use_version(),
			action='start',
			parent_process_cmdline=get_parent_process_cmdline(),
		)
	)

	try:
		await server.run()
	finally:
		duration = time.time() - server._start_time
		server._telemetry.capture(
			MCPServerTelemetryEvent(
				version=get_browser_use_version(),
				action='stop',
				duration_seconds=duration,
				parent_process_cmdline=get_parent_process_cmdline(),
			)
		)
		server._telemetry.flush()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/browser_use/observability.py

```py
# @file purpose: Observability module for browser-use that handles optional lmnr integration with debug mode support
"""
Observability module for browser-use

This module provides observability decorators that optionally integrate with lmnr (Laminar) for tracing.
If lmnr is not installed, it provides no-op wrappers that accept the same parameters.

Features:
- Optional lmnr integration - works with or without lmnr installed
- Debug mode support - observe_debug only traces when in debug mode
- Full parameter compatibility with lmnr observe decorator
- No-op fallbacks when lmnr is unavailable
"""

import logging
import os
from collections.abc import Callable
from functools import wraps
from typing import Any, Literal, TypeVar, cast

logger = logging.getLogger(__name__)
from dotenv import load_dotenv

load_dotenv()

# Type definitions
F = TypeVar('F', bound=Callable[..., Any])


# Check if we're in debug mode
def _is_debug_mode() -> bool:
	"""Check if we're in debug mode based on environment variables or logging level."""

	lmnr_debug_mode = os.getenv('LMNR_LOGGING_LEVEL', '').lower()
	if lmnr_debug_mode == 'debug':
		# logger.info('Debug mode is enabled for observability')
		return True
	# logger.info('Debug mode is disabled for observability')
	return False


# Try to import lmnr observe
_LMNR_AVAILABLE = False
_lmnr_observe = None

try:
	from lmnr import observe as _lmnr_observe  # type: ignore

	if os.environ.get('BROWSER_USE_VERBOSE_OBSERVABILITY', 'false').lower() == 'true':
		logger.debug('Lmnr is available for observability')
	_LMNR_AVAILABLE = True
except ImportError:
	if os.environ.get('BROWSER_USE_VERBOSE_OBSERVABILITY', 'false').lower() == 'true':
		logger.debug('Lmnr is not available for observability')
	_LMNR_AVAILABLE = False


def _create_no_op_decorator(
	name: str | None = None,
	ignore_input: bool = False,
	ignore_output: bool = False,
	metadata: dict[str, Any] | None = None,
	**kwargs: Any,
) -> Callable[[F], F]:
	"""Create a no-op decorator that accepts all lmnr observe parameters but does nothing."""
	import asyncio

	def decorator(func: F) -> F:
		if asyncio.iscoroutinefunction(func):

			@wraps(func)
			async def async_wrapper(*args, **kwargs):
				return await func(*args, **kwargs)

			return cast(F, async_wrapper)
		else:

			@wraps(func)
			def sync_wrapper(*args, **kwargs):
				return func(*args, **kwargs)

			return cast(F, sync_wrapper)

	return decorator


def observe(
	name: str | None = None,
	ignore_input: bool = False,
	ignore_output: bool = False,
	metadata: dict[str, Any] | None = None,
	span_type: Literal['DEFAULT', 'LLM', 'TOOL'] = 'DEFAULT',
	**kwargs: Any,
) -> Callable[[F], F]:
	"""
	Observability decorator that traces function execution when lmnr is available.

	This decorator will use lmnr's observe decorator if lmnr is installed,
	otherwise it will be a no-op that accepts the same parameters.

	Args:
	    name: Name of the span/trace
	    ignore_input: Whether to ignore function input parameters in tracing
	    ignore_output: Whether to ignore function output in tracing
	    metadata: Additional metadata to attach to the span
	    **kwargs: Additional parameters passed to lmnr observe

	Returns:
	    Decorated function that may be traced depending on lmnr availability

	Example:
	    @observe(name="my_function", metadata={"version": "1.0"})
	    def my_function(param1, param2):
	        return param1 + param2
	"""
	kwargs = {
		'name': name,
		'ignore_input': ignore_input,
		'ignore_output': ignore_output,
		'metadata': metadata,
		'span_type': span_type,
		'tags': ['observe', 'observe_debug'],  # important: tags need to be created on laminar first
		**kwargs,
	}

	if _LMNR_AVAILABLE and _lmnr_observe:
		# Use the real lmnr observe decorator
		return cast(Callable[[F], F], _lmnr_observe(**kwargs))
	else:
		# Use no-op decorator
		return _create_no_op_decorator(**kwargs)


def observe_debug(
	name: str | None = None,
	ignore_input: bool = False,
	ignore_output: bool = False,
	metadata: dict[str, Any] | None = None,
	span_type: Literal['DEFAULT', 'LLM', 'TOOL'] = 'DEFAULT',
	**kwargs: Any,
) -> Callable[[F], F]:
	"""
	Debug-only observability decorator that only traces when in debug mode.

	This decorator will use lmnr's observe decorator if both lmnr is installed
	AND we're in debug mode, otherwise it will be a no-op.

	Debug mode is determined by:
	- DEBUG environment variable set to 1/true/yes/on
	- BROWSER_USE_DEBUG environment variable set to 1/true/yes/on
	- Root logging level set to DEBUG or lower

	Args:
	    name: Name of the span/trace
	    ignore_input: Whether to ignore function input parameters in tracing
	    ignore_output: Whether to ignore function output in tracing
	    metadata: Additional metadata to attach to the span
	    **kwargs: Additional parameters passed to lmnr observe

	Returns:
	    Decorated function that may be traced only in debug mode

	Example:
	    @observe_debug(ignore_input=True, ignore_output=True,name="debug_function", metadata={"debug": True})
	    def debug_function(param1, param2):
	        return param1 + param2
	"""
	kwargs = {
		'name': name,
		'ignore_input': ignore_input,
		'ignore_output': ignore_output,
		'metadata': metadata,
		'span_type': span_type,
		'tags': ['observe_debug'],  # important: tags need to be created on laminar first
		**kwargs,
	}

	if _LMNR_AVAILABLE and _lmnr_observe and _is_debug_mode():
		# Use the real lmnr observe decorator only in debug mode
		return cast(Callable[[F], F], _lmnr_observe(**kwargs))
	else:
		# Use no-op decorator (either not in debug mode or lmnr not available)
		return _create_no_op_decorator(**kwargs)


# Convenience functions for checking availability and debug status
def is_lmnr_available() -> bool:
	"""Check if lmnr is available for tracing."""
	return _LMNR_AVAILABLE


def is_debug_mode() -> bool:
	"""Check if we're currently in debug mode."""
	return _is_debug_mode()


def get_observability_status() -> dict[str, bool]:
	"""Get the current status of observability features."""
	return {
		'lmnr_available': _LMNR_AVAILABLE,
		'debug_mode': _is_debug_mode(),
		'observe_active': _LMNR_AVAILABLE,
		'observe_debug_active': _LMNR_AVAILABLE and _is_debug_mode(),
	}

```

---

## backend/browser-use/browser_use/sandbox/__init__.py

```py
"""Sandbox execution package for browser-use

This package provides type-safe sandbox code execution with SSE streaming.

Example:
    from browser_use.sandbox import sandbox, SSEEvent, SSEEventType

    @sandbox(log_level="INFO")
    async def my_task(browser: Browser) -> str:
        page = await browser.get_current_page()
        await page.goto("https://example.com")
        return await page.title()

    result = await my_task()
"""

from browser_use.sandbox.sandbox import SandboxError, sandbox
from browser_use.sandbox.views import (
	BrowserCreatedData,
	ErrorData,
	ExecutionResponse,
	LogData,
	ResultData,
	SSEEvent,
	SSEEventType,
)

__all__ = [
	# Main decorator
	'sandbox',
	'SandboxError',
	# Event types
	'SSEEvent',
	'SSEEventType',
	# Event data models
	'BrowserCreatedData',
	'LogData',
	'ResultData',
	'ErrorData',
	'ExecutionResponse',
]

```

---

## backend/browser-use/browser_use/sandbox/sandbox.py

```py
import ast
import asyncio
import base64
import dataclasses
import enum
import inspect
import json
import os
import sys
import textwrap
from collections.abc import Callable, Coroutine
from functools import wraps
from typing import TYPE_CHECKING, Any, Concatenate, ParamSpec, TypeVar, Union, cast, get_args, get_origin

import cloudpickle
import httpx

from browser_use.sandbox.views import (
	BrowserCreatedData,
	ErrorData,
	LogData,
	ResultData,
	SandboxError,
	SSEEvent,
	SSEEventType,
)

if TYPE_CHECKING:
	from browser_use.browser import BrowserSession

T = TypeVar('T')
P = ParamSpec('P')


def get_terminal_width() -> int:
	"""Get terminal width, default to 80 if unable to detect"""
	try:
		return os.get_terminal_size().columns
	except (AttributeError, OSError):
		return 80


async def _call_callback(callback: Callable[..., Any], *args: Any) -> None:
	"""Call a callback that can be either sync or async"""
	result = callback(*args)
	if asyncio.iscoroutine(result):
		await result


def _get_function_source_without_decorator(func: Callable) -> str:
	"""Get function source code with decorator removed"""
	source = inspect.getsource(func)
	source = textwrap.dedent(source)

	# Parse and remove decorator
	tree = ast.parse(source)
	for node in ast.walk(tree):
		if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
			node.decorator_list = []
			break

	return ast.unparse(tree)


def _get_imports_used_in_function(func: Callable) -> str:
	"""Extract only imports that are referenced in the function body or type annotations"""
	# Get all names referenced in the function
	code = func.__code__
	referenced_names = set(code.co_names)

	# Also get names from type annotations (recursively for complex types like Union, Literal, etc.)
	def extract_type_names(annotation):
		"""Recursively extract all type names from annotation"""
		if annotation is None or annotation == inspect.Parameter.empty:
			return

		# Handle simple types with __name__
		if hasattr(annotation, '__name__'):
			referenced_names.add(annotation.__name__)

		# Handle string annotations
		if isinstance(annotation, str):
			referenced_names.add(annotation)

		# Handle generic types like Union[X, Y], Literal['x'], etc.
		origin = get_origin(annotation)
		args = get_args(annotation)

		if origin:
			# Add the origin type name (e.g., 'Union', 'Literal')
			if hasattr(origin, '__name__'):
				referenced_names.add(origin.__name__)

		# Recursively extract from generic args
		if args:
			for arg in args:
				extract_type_names(arg)

	sig = inspect.signature(func)
	for param in sig.parameters.values():
		if param.annotation != inspect.Parameter.empty:
			extract_type_names(param.annotation)

	# Get return annotation (also extract recursively)
	if 'return' in func.__annotations__:
		extract_type_names(func.__annotations__['return'])

	# Get the module where function is defined
	module = inspect.getmodule(func)
	if not module or not hasattr(module, '__file__') or module.__file__ is None:
		return ''

	try:
		with open(module.__file__) as f:
			module_source = f.read()

		tree = ast.parse(module_source)
		needed_imports: list[str] = []

		for node in tree.body:
			if isinstance(node, ast.Import):
				# import X, Y
				for alias in node.names:
					import_name = alias.asname if alias.asname else alias.name
					if import_name in referenced_names:
						needed_imports.append(ast.unparse(node))
						break
			elif isinstance(node, ast.ImportFrom):
				# from X import Y, Z
				imported_names = []
				for alias in node.names:
					import_name = alias.asname if alias.asname else alias.name
					if import_name in referenced_names:
						imported_names.append(alias)

				if imported_names:
					# Create filtered import statement
					filtered_import = ast.ImportFrom(module=node.module, names=imported_names, level=node.level)
					needed_imports.append(ast.unparse(filtered_import))

		return '\n'.join(needed_imports)
	except Exception:
		return ''


def _extract_all_params(func: Callable, args: tuple, kwargs: dict) -> dict[str, Any]:
	"""Extract all parameters including explicit params and closure variables

	Args:
		func: The function being decorated
		args: Positional arguments passed to the function
		kwargs: Keyword arguments passed to the function

	Returns:
		Dictionary of all parameters {name: value}
	"""
	sig = inspect.signature(func)
	bound_args = sig.bind_partial(*args, **kwargs)
	bound_args.apply_defaults()

	all_params: dict[str, Any] = {}

	# 1. Extract explicit parameters (skip 'browser' and 'self')
	for param_name, param_value in bound_args.arguments.items():
		if param_name == 'browser':
			continue
		if param_name == 'self' and hasattr(param_value, '__dict__'):
			# Extract self attributes as individual variables
			for attr_name, attr_value in param_value.__dict__.items():
				all_params[attr_name] = attr_value
		else:
			all_params[param_name] = param_value

	# 2. Extract closure variables
	if func.__closure__:
		closure_vars = func.__code__.co_freevars
		closure_values = [cell.cell_contents for cell in func.__closure__]

		for name, value in zip(closure_vars, closure_values):
			# Skip if already captured from explicit params
			if name in all_params:
				continue
			# Special handling for 'self' in closures
			if name == 'self' and hasattr(value, '__dict__'):
				for attr_name, attr_value in value.__dict__.items():
					if attr_name not in all_params:
						all_params[attr_name] = attr_value
			else:
				all_params[name] = value

	# 3. Extract referenced globals (like logger, module-level vars, etc.)
	#    Let cloudpickle handle serialization instead of special-casing
	for name in func.__code__.co_names:
		if name in all_params:
			continue
		if name in func.__globals__:
			all_params[name] = func.__globals__[name]

	return all_params


def sandbox(
	BROWSER_USE_API_KEY: str | None = None,
	cloud_profile_id: str | None = None,
	cloud_proxy_country_code: str | None = None,
	cloud_timeout: int | None = None,
	server_url: str | None = None,
	log_level: str = 'INFO',
	quiet: bool = False,
	headers: dict[str, str] | None = None,
	on_browser_created: Callable[[BrowserCreatedData], None]
	| Callable[[BrowserCreatedData], Coroutine[Any, Any, None]]
	| None = None,
	on_instance_ready: Callable[[], None] | Callable[[], Coroutine[Any, Any, None]] | None = None,
	on_log: Callable[[LogData], None] | Callable[[LogData], Coroutine[Any, Any, None]] | None = None,
	on_result: Callable[[ResultData], None] | Callable[[ResultData], Coroutine[Any, Any, None]] | None = None,
	on_error: Callable[[ErrorData], None] | Callable[[ErrorData], Coroutine[Any, Any, None]] | None = None,
	**env_vars: str,
) -> Callable[[Callable[Concatenate['BrowserSession', P], Coroutine[Any, Any, T]]], Callable[P, Coroutine[Any, Any, T]]]:
	"""Decorator to execute browser automation code in a sandbox environment.

	The decorated function MUST have 'browser: Browser' as its first parameter.
	The browser parameter will be automatically injected - do NOT pass it when calling the decorated function.
	All other parameters (explicit or from closure) will be captured and sent via cloudpickle.

	Args:
	    BROWSER_USE_API_KEY: API key (defaults to BROWSER_USE_API_KEY env var)
	    cloud_profile_id: The ID of the profile to use for the browser session
	    cloud_proxy_country_code: Country code for proxy location (e.g., 'us', 'uk', 'fr')
	    cloud_timeout: The timeout for the browser session in minutes (max 240 = 4 hours)
	    server_url: Sandbox server URL (defaults to https://sandbox.api.browser-use.com/sandbox-stream)
	    log_level: Logging level (INFO, DEBUG, WARNING, ERROR)
	    quiet: Suppress console output
	    headers: Additional HTTP headers to send with the request
	    on_browser_created: Callback when browser is created
	    on_instance_ready: Callback when instance is ready
	    on_log: Callback for log events
	    on_result: Callback when execution completes
	    on_error: Callback for errors
	    **env_vars: Additional environment variables

	Example:
	    @sandbox()
	    async def task(browser: Browser, url: str, max_steps: int) -> str:
	        agent = Agent(task=url, browser=browser)
	        await agent.run(max_steps=max_steps)
	        return "done"

	    # Call with:
	    result = await task(url="https://example.com", max_steps=10)

	    # With cloud parameters:
	    @sandbox(cloud_proxy_country_code='us', cloud_timeout=60)
	    async def task_with_proxy(browser: Browser) -> str:
	        ...
	"""

	def decorator(
		func: Callable[Concatenate['BrowserSession', P], Coroutine[Any, Any, T]],
	) -> Callable[P, Coroutine[Any, Any, T]]:
		# Validate function has browser parameter
		sig = inspect.signature(func)
		if 'browser' not in sig.parameters:
			raise TypeError(f'{func.__name__}() must have a "browser" parameter')

		browser_param = sig.parameters['browser']
		if browser_param.annotation != inspect.Parameter.empty:
			annotation_str = str(browser_param.annotation)
			if 'Browser' not in annotation_str:
				raise TypeError(f'{func.__name__}() browser parameter must be typed as Browser, got {annotation_str}')

		@wraps(func)
		async def wrapper(*args, **kwargs) -> T:
			# 1. Get API key
			api_key = BROWSER_USE_API_KEY or os.getenv('BROWSER_USE_API_KEY')
			if not api_key:
				raise SandboxError('BROWSER_USE_API_KEY is required')

			# 2. Extract all parameters (explicit + closure)
			all_params = _extract_all_params(func, args, kwargs)

			# 3. Get function source without decorator and only needed imports
			func_source = _get_function_source_without_decorator(func)
			needed_imports = _get_imports_used_in_function(func)

			# Always include Browser import since it's required for the function signature
			if needed_imports:
				needed_imports = 'from browser_use import Browser\n' + needed_imports
			else:
				needed_imports = 'from browser_use import Browser'

			# 4. Pickle parameters using cloudpickle for robust serialization
			pickled_params = base64.b64encode(cloudpickle.dumps(all_params)).decode()

			# 5. Determine which params are in the function signature vs closure/globals
			func_param_names = {p.name for p in sig.parameters.values() if p.name != 'browser'}
			non_explicit_params = {k: v for k, v in all_params.items() if k not in func_param_names}
			explicit_params = {k: v for k, v in all_params.items() if k in func_param_names}

			# Inject closure variables and globals as module-level vars
			var_injections = []
			for var_name in non_explicit_params.keys():
				var_injections.append(f"{var_name} = _params['{var_name}']")

			var_injection_code = '\n'.join(var_injections) if var_injections else '# No closure variables or globals'

			# Build function call
			if explicit_params:
				function_call = (
					f'await {func.__name__}(browser=browser, **{{k: _params[k] for k in {list(explicit_params.keys())!r}}})'
				)
			else:
				function_call = f'await {func.__name__}(browser=browser)'

			# 6. Create wrapper code that unpickles params and calls function
			execution_code = f"""import cloudpickle
import base64

# Imports used in function
{needed_imports}

# Unpickle all parameters (explicit, closure, and globals)
_pickled_params = base64.b64decode({repr(pickled_params)})
_params = cloudpickle.loads(_pickled_params)

# Inject closure variables and globals into module scope
{var_injection_code}

# Original function (decorator removed)
{func_source}

# Wrapper function that passes explicit params
async def run(browser):
	return {function_call}

"""

			# 9. Send to server
			payload: dict[str, Any] = {'code': base64.b64encode(execution_code.encode()).decode()}

			combined_env: dict[str, str] = env_vars.copy() if env_vars else {}
			combined_env['LOG_LEVEL'] = log_level.upper()
			payload['env'] = combined_env

			# Add cloud parameters if provided
			if cloud_profile_id is not None:
				payload['cloud_profile_id'] = cloud_profile_id
			if cloud_proxy_country_code is not None:
				payload['cloud_proxy_country_code'] = cloud_proxy_country_code
			if cloud_timeout is not None:
				payload['cloud_timeout'] = cloud_timeout

			url = server_url or 'https://sandbox.api.browser-use.com/sandbox-stream'

			request_headers = {'X-API-Key': api_key}
			if headers:
				request_headers.update(headers)

			# 10. Handle SSE streaming
			_NO_RESULT = object()
			execution_result = _NO_RESULT
			live_url_shown = False
			execution_started = False
			received_final_event = False

			async with httpx.AsyncClient(timeout=1800.0) as client:
				async with client.stream('POST', url, json=payload, headers=request_headers) as response:
					response.raise_for_status()

					try:
						async for line in response.aiter_lines():
							if not line or not line.startswith('data: '):
								continue

							event_json = line[6:]
							try:
								event = SSEEvent.from_json(event_json)

								if event.type == SSEEventType.BROWSER_CREATED:
									assert isinstance(event.data, BrowserCreatedData)

									if on_browser_created:
										try:
											await _call_callback(on_browser_created, event.data)
										except Exception as e:
											if not quiet:
												print(f'⚠️  Error in on_browser_created callback: {e}')

									if not quiet and event.data.live_url and not live_url_shown:
										width = get_terminal_width()
										print('\n' + '━' * width)
										print('👁️  LIVE BROWSER VIEW (Click to watch)')
										print(f'🔗 {event.data.live_url}')
										print('━' * width)
										live_url_shown = True

								elif event.type == SSEEventType.LOG:
									assert isinstance(event.data, LogData)
									message = event.data.message
									level = event.data.level

									if on_log:
										try:
											await _call_callback(on_log, event.data)
										except Exception as e:
											if not quiet:
												print(f'⚠️  Error in on_log callback: {e}')

									if level == 'stdout':
										if not quiet:
											if not execution_started:
												width = get_terminal_width()
												print('\n' + '─' * width)
												print('⚡ Runtime Output')
												print('─' * width)
												execution_started = True
											print(f'  {message}', end='')
									elif level == 'stderr':
										if not quiet:
											if not execution_started:
												width = get_terminal_width()
												print('\n' + '─' * width)
												print('⚡ Runtime Output')
												print('─' * width)
												execution_started = True
											print(f'⚠️  {message}', end='', file=sys.stderr)
									elif level == 'info':
										if not quiet:
											if 'credit' in message.lower():
												import re

												match = re.search(r'\$[\d,]+\.?\d*', message)
												if match:
													print(f'💰 You have {match.group()} credits')
											else:
												print(f'ℹ️  {message}')
									else:
										if not quiet:
											print(f'  {message}')

								elif event.type == SSEEventType.INSTANCE_READY:
									if on_instance_ready:
										try:
											await _call_callback(on_instance_ready)
										except Exception as e:
											if not quiet:
												print(f'⚠️  Error in on_instance_ready callback: {e}')

									if not quiet:
										print('✅ Browser ready, starting execution...\n')

								elif event.type == SSEEventType.RESULT:
									assert isinstance(event.data, ResultData)
									exec_response = event.data.execution_response
									received_final_event = True

									if on_result:
										try:
											await _call_callback(on_result, event.data)
										except Exception as e:
											if not quiet:
												print(f'⚠️  Error in on_result callback: {e}')

									if exec_response.success:
										execution_result = exec_response.result
										if not quiet and execution_started:
											width = get_terminal_width()
											print('\n' + '─' * width)
											print()
									else:
										error_msg = exec_response.error or 'Unknown error'
										raise SandboxError(f'Execution failed: {error_msg}')

								elif event.type == SSEEventType.ERROR:
									assert isinstance(event.data, ErrorData)
									received_final_event = True

									if on_error:
										try:
											await _call_callback(on_error, event.data)
										except Exception as e:
											if not quiet:
												print(f'⚠️  Error in on_error callback: {e}')

									raise SandboxError(f'Execution failed: {event.data.error}')

							except (json.JSONDecodeError, ValueError):
								continue

					except (httpx.RemoteProtocolError, httpx.ReadError, httpx.StreamClosed) as e:
						# With deterministic handshake, these should never happen
						# If they do, it's a real error
						raise SandboxError(
							f'Stream error: {e.__class__.__name__}: {e or "connection closed unexpectedly"}'
						) from e

			# 11. Parse result with type annotation
			if execution_result is not _NO_RESULT:
				return_annotation = func.__annotations__.get('return')
				if return_annotation:
					parsed_result = _parse_with_type_annotation(execution_result, return_annotation)
					return parsed_result
				return execution_result  # type: ignore[return-value]

			raise SandboxError('No result received from execution')

		# Update wrapper signature to remove browser parameter
		wrapper.__annotations__ = func.__annotations__.copy()
		if 'browser' in wrapper.__annotations__:
			del wrapper.__annotations__['browser']

		params = [p for p in sig.parameters.values() if p.name != 'browser']
		wrapper.__signature__ = sig.replace(parameters=params)  # type: ignore[attr-defined]

		return cast(Callable[P, Coroutine[Any, Any, T]], wrapper)

	return decorator


def _parse_with_type_annotation(data: Any, annotation: Any) -> Any:
	"""Parse data with type annotation without validation, recursively handling nested types

	This function reconstructs Pydantic models, dataclasses, and enums from JSON dicts
	without running validation logic. It recursively parses nested fields to ensure
	complete type fidelity.
	"""
	try:
		if data is None:
			return None

		origin = get_origin(annotation)
		args = get_args(annotation)

		# Handle Union types
		if origin is Union or (hasattr(annotation, '__class__') and annotation.__class__.__name__ == 'UnionType'):
			union_args = args or getattr(annotation, '__args__', [])
			for arg in union_args:
				if arg is type(None) and data is None:
					return None
				if arg is not type(None):
					try:
						return _parse_with_type_annotation(data, arg)
					except Exception:
						continue
			return data

		# Handle List types
		if origin is list:
			if not isinstance(data, list):
				return data
			if args:
				return [_parse_with_type_annotation(item, args[0]) for item in data]
			return data

		# Handle Tuple types (JSON serializes tuples as lists)
		if origin is tuple:
			if not isinstance(data, (list, tuple)):
				return data
			if args:
				# Parse each element according to its type annotation
				parsed_items = []
				for i, item in enumerate(data):
					# Use the corresponding type arg, or the last one if fewer args than items
					type_arg = args[i] if i < len(args) else args[-1] if args else Any
					parsed_items.append(_parse_with_type_annotation(item, type_arg))
				return tuple(parsed_items)
			return tuple(data) if isinstance(data, list) else data

		# Handle Dict types
		if origin is dict:
			if not isinstance(data, dict):
				return data
			if len(args) == 2:
				return {_parse_with_type_annotation(k, args[0]): _parse_with_type_annotation(v, args[1]) for k, v in data.items()}
			return data

		# Handle Enum types
		if inspect.isclass(annotation) and issubclass(annotation, enum.Enum):
			if isinstance(data, str):
				try:
					return annotation[data]  # By name
				except KeyError:
					return annotation(data)  # By value
			return annotation(data)  # By value

		# Handle Pydantic v2 - use model_construct to skip validation and recursively parse nested fields
		if hasattr(annotation, 'model_construct'):
			if not isinstance(data, dict):
				return data
			# Recursively parse each field according to its type annotation
			if hasattr(annotation, 'model_fields'):
				parsed_fields = {}
				for field_name, field_info in annotation.model_fields.items():
					if field_name in data:
						field_annotation = field_info.annotation
						parsed_fields[field_name] = _parse_with_type_annotation(data[field_name], field_annotation)
				return annotation.model_construct(**parsed_fields)
			# Fallback if model_fields not available
			return annotation.model_construct(**data)

		# Handle Pydantic v1 - use construct to skip validation and recursively parse nested fields
		if hasattr(annotation, 'construct'):
			if not isinstance(data, dict):
				return data
			# Recursively parse each field if __fields__ is available
			if hasattr(annotation, '__fields__'):
				parsed_fields = {}
				for field_name, field_obj in annotation.__fields__.items():
					if field_name in data:
						field_annotation = field_obj.outer_type_
						parsed_fields[field_name] = _parse_with_type_annotation(data[field_name], field_annotation)
				return annotation.construct(**parsed_fields)
			# Fallback if __fields__ not available
			return annotation.construct(**data)

		# Handle dataclasses
		if dataclasses.is_dataclass(annotation) and isinstance(data, dict):
			# Get field type annotations
			field_types = {f.name: f.type for f in dataclasses.fields(annotation)}
			# Recursively parse each field
			parsed_fields = {}
			for field_name, field_type in field_types.items():
				if field_name in data:
					parsed_fields[field_name] = _parse_with_type_annotation(data[field_name], field_type)
			return cast(type[Any], annotation)(**parsed_fields)

		# Handle regular classes
		if inspect.isclass(annotation) and isinstance(data, dict):
			try:
				return annotation(**data)
			except Exception:
				pass

		return data

	except Exception:
		return data

```

---

## backend/browser-use/browser_use/sandbox/views.py

```py
"""Type-safe event models for sandbox execution SSE streaming"""

import json
from enum import Enum
from typing import Any

from pydantic import BaseModel


class SandboxError(Exception):
	pass


class SSEEventType(str, Enum):
	"""Event types for Server-Sent Events"""

	BROWSER_CREATED = 'browser_created'
	INSTANCE_CREATED = 'instance_created'
	INSTANCE_READY = 'instance_ready'
	LOG = 'log'
	RESULT = 'result'
	ERROR = 'error'
	STREAM_COMPLETE = 'stream_complete'


class BrowserCreatedData(BaseModel):
	"""Data for browser_created event"""

	session_id: str
	live_url: str
	status: str


class LogData(BaseModel):
	"""Data for log event"""

	message: str
	level: str = 'info'  # stdout, stderr, info, warning, error


class ExecutionResponse(BaseModel):
	"""Execution result from the executor"""

	success: bool
	result: Any = None
	error: str | None = None
	traceback: str | None = None


class ResultData(BaseModel):
	"""Data for result event"""

	execution_response: ExecutionResponse


class ErrorData(BaseModel):
	"""Data for error event"""

	error: str
	traceback: str | None = None
	status_code: int = 500


class SSEEvent(BaseModel):
	"""Type-safe SSE Event

	Usage:
	    # Parse from JSON
	    event = SSEEvent.from_json(event_json_string)

	    # Type-safe access with type guards
	    if event.is_browser_created():
	        assert isinstance(event.data, BrowserCreatedData)
	        print(event.data.live_url)

	    # Or check event type directly
	    if event.type == SSEEventType.LOG:
	        assert isinstance(event.data, LogData)
	        print(event.data.message)
	"""

	type: SSEEventType
	data: BrowserCreatedData | LogData | ResultData | ErrorData | dict[str, Any]
	timestamp: str | None = None

	@classmethod
	def from_json(cls, event_json: str) -> 'SSEEvent':
		"""Parse SSE event from JSON string with proper type discrimination

		Args:
		    event_json: JSON string from SSE stream

		Returns:
		    Typed SSEEvent with appropriate data model

		Raises:
		    json.JSONDecodeError: If JSON is malformed
		    ValueError: If event type is invalid
		"""
		raw_data = json.loads(event_json)
		event_type = SSEEventType(raw_data.get('type'))
		data_dict = raw_data.get('data', {})

		# Parse data based on event type
		if event_type == SSEEventType.BROWSER_CREATED:
			data = BrowserCreatedData(**data_dict)
		elif event_type == SSEEventType.LOG:
			data = LogData(**data_dict)
		elif event_type == SSEEventType.RESULT:
			data = ResultData(**data_dict)
		elif event_type == SSEEventType.ERROR:
			data = ErrorData(**data_dict)
		else:
			data = data_dict

		return cls(type=event_type, data=data, timestamp=raw_data.get('timestamp'))

	def is_browser_created(self) -> bool:
		"""Type guard for BrowserCreatedData"""
		return self.type == SSEEventType.BROWSER_CREATED and isinstance(self.data, BrowserCreatedData)

	def is_log(self) -> bool:
		"""Type guard for LogData"""
		return self.type == SSEEventType.LOG and isinstance(self.data, LogData)

	def is_result(self) -> bool:
		"""Type guard for ResultData"""
		return self.type == SSEEventType.RESULT and isinstance(self.data, ResultData)

	def is_error(self) -> bool:
		"""Type guard for ErrorData"""
		return self.type == SSEEventType.ERROR and isinstance(self.data, ErrorData)

```

---

## backend/browser-use/browser_use/screenshots/__init__.py

```py
# Screenshots package for browser-use

```

---

## backend/browser-use/browser_use/screenshots/service.py

```py
"""
Screenshot storage service for browser-use agents.
"""

import base64
from pathlib import Path

import anyio

from browser_use.observability import observe_debug


class ScreenshotService:
	"""Simple screenshot storage service that saves screenshots to disk"""

	def __init__(self, agent_directory: str | Path):
		"""Initialize with agent directory path"""
		self.agent_directory = Path(agent_directory) if isinstance(agent_directory, str) else agent_directory

		# Create screenshots subdirectory
		self.screenshots_dir = self.agent_directory / 'screenshots'
		self.screenshots_dir.mkdir(parents=True, exist_ok=True)

	@observe_debug(ignore_input=True, ignore_output=True, name='store_screenshot')
	async def store_screenshot(self, screenshot_b64: str, step_number: int) -> str:
		"""Store screenshot to disk and return the full path as string"""
		screenshot_filename = f'step_{step_number}.png'
		screenshot_path = self.screenshots_dir / screenshot_filename

		# Decode base64 and save to disk
		screenshot_data = base64.b64decode(screenshot_b64)

		async with await anyio.open_file(screenshot_path, 'wb') as f:
			await f.write(screenshot_data)

		return str(screenshot_path)

	@observe_debug(ignore_input=True, ignore_output=True, name='get_screenshot_from_disk')
	async def get_screenshot(self, screenshot_path: str) -> str | None:
		"""Load screenshot from disk path and return as base64"""
		if not screenshot_path:
			return None

		path = Path(screenshot_path)
		if not path.exists():
			return None

		# Load from disk and encode to base64
		async with await anyio.open_file(path, 'rb') as f:
			screenshot_data = await f.read()

		return base64.b64encode(screenshot_data).decode('utf-8')

```

---

## backend/browser-use/browser_use/sync/__init__.py

```py
"""Cloud sync module for Browser Use."""

from browser_use.sync.auth import CloudAuthConfig, DeviceAuthClient
from browser_use.sync.service import CloudSync

__all__ = ['CloudAuthConfig', 'DeviceAuthClient', 'CloudSync']

```

---

## backend/browser-use/browser_use/sync/auth.py

```py
"""
OAuth2 Device Authorization Grant flow client for browser-use.
"""

import asyncio
import json
import os
import shutil
import time
from datetime import datetime

import httpx
from pydantic import BaseModel
from uuid_extensions import uuid7str

from browser_use.config import CONFIG

# Temporary user ID for pre-auth events (matches cloud backend)
TEMP_USER_ID = '99999999-9999-9999-9999-999999999999'


def get_or_create_device_id() -> str:
	"""Get or create a persistent device ID for this installation."""
	device_id_path = CONFIG.BROWSER_USE_CONFIG_DIR / 'device_id'

	# Try to read existing device ID
	if device_id_path.exists():
		try:
			device_id = device_id_path.read_text().strip()
			if device_id:  # Make sure it's not empty
				return device_id
		except Exception:
			# If we can't read it, we'll create a new one
			pass

	# Create new device ID
	device_id = uuid7str()

	# Ensure config directory exists
	CONFIG.BROWSER_USE_CONFIG_DIR.mkdir(parents=True, exist_ok=True)

	# Write device ID to file
	device_id_path.write_text(device_id)

	return device_id


class CloudAuthConfig(BaseModel):
	"""Configuration for cloud authentication"""

	api_token: str | None = None
	user_id: str | None = None
	authorized_at: datetime | None = None

	@classmethod
	def load_from_file(cls) -> 'CloudAuthConfig':
		"""Load auth config from local file"""

		config_path = CONFIG.BROWSER_USE_CONFIG_DIR / 'cloud_auth.json'
		if config_path.exists():
			try:
				with open(config_path) as f:
					data = json.load(f)
				return cls.model_validate(data)
			except Exception:
				# Return empty config if file is corrupted
				pass
		return cls()

	def save_to_file(self) -> None:
		"""Save auth config to local file"""

		CONFIG.BROWSER_USE_CONFIG_DIR.mkdir(parents=True, exist_ok=True)

		config_path = CONFIG.BROWSER_USE_CONFIG_DIR / 'cloud_auth.json'
		with open(config_path, 'w') as f:
			json.dump(self.model_dump(mode='json'), f, indent=2, default=str)

		# Set restrictive permissions (owner read/write only) for security
		try:
			os.chmod(config_path, 0o600)
		except Exception:
			# Some systems may not support chmod, continue anyway
			pass


class DeviceAuthClient:
	"""Client for OAuth2 device authorization flow"""

	def __init__(self, base_url: str | None = None, http_client: httpx.AsyncClient | None = None):
		# Backend API URL for OAuth requests - can be passed directly or defaults to env var
		self.base_url = base_url or CONFIG.BROWSER_USE_CLOUD_API_URL
		self.client_id = 'library'
		self.scope = 'read write'

		# If no client provided, we'll create one per request
		self.http_client = http_client

		# Temporary user ID for pre-auth events
		self.temp_user_id = TEMP_USER_ID

		# Get or create persistent device ID
		self.device_id = get_or_create_device_id()

		# Load existing auth if available
		self.auth_config = CloudAuthConfig.load_from_file()

	@property
	def is_authenticated(self) -> bool:
		"""Check if we have valid authentication"""
		return bool(self.auth_config.api_token and self.auth_config.user_id)

	@property
	def api_token(self) -> str | None:
		"""Get the current API token"""
		return self.auth_config.api_token

	@property
	def user_id(self) -> str:
		"""Get the current user ID (temporary or real)"""
		return self.auth_config.user_id or self.temp_user_id

	async def start_device_authorization(
		self,
		agent_session_id: str | None = None,
	) -> dict:
		"""
		Start the device authorization flow.
		Returns device authorization details including user code and verification URL.
		"""
		if self.http_client:
			response = await self.http_client.post(
				f'{self.base_url.rstrip("/")}/api/v1/oauth/device/authorize',
				data={
					'client_id': self.client_id,
					'scope': self.scope,
					'agent_session_id': agent_session_id or '',
					'device_id': self.device_id,
				},
			)
			response.raise_for_status()
			return response.json()
		else:
			async with httpx.AsyncClient() as client:
				response = await client.post(
					f'{self.base_url.rstrip("/")}/api/v1/oauth/device/authorize',
					data={
						'client_id': self.client_id,
						'scope': self.scope,
						'agent_session_id': agent_session_id or '',
						'device_id': self.device_id,
					},
				)
				response.raise_for_status()
				return response.json()

	async def poll_for_token(
		self,
		device_code: str,
		interval: float = 3.0,
		timeout: float = 1800.0,
	) -> dict | None:
		"""
		Poll for the access token.
		Returns token info when authorized, None if timeout.
		"""
		start_time = time.time()

		if self.http_client:
			# Use injected client for all requests
			while time.time() - start_time < timeout:
				try:
					response = await self.http_client.post(
						f'{self.base_url.rstrip("/")}/api/v1/oauth/device/token',
						data={
							'grant_type': 'urn:ietf:params:oauth:grant-type:device_code',
							'device_code': device_code,
							'client_id': self.client_id,
						},
					)

					if response.status_code == 200:
						data = response.json()

						# Check for pending authorization
						if data.get('error') == 'authorization_pending':
							await asyncio.sleep(interval)
							continue

						# Check for slow down
						if data.get('error') == 'slow_down':
							interval = data.get('interval', interval * 2)
							await asyncio.sleep(interval)
							continue

						# Check for other errors
						if 'error' in data:
							print(f'Error: {data.get("error_description", data["error"])}')
							return None

						# Success! We have a token
						if 'access_token' in data:
							return data

					elif response.status_code == 400:
						# Error response
						data = response.json()
						if data.get('error') not in ['authorization_pending', 'slow_down']:
							print(f'Error: {data.get("error_description", "Unknown error")}')
							return None

					else:
						print(f'Unexpected status code: {response.status_code}')
						return None

				except Exception as e:
					print(f'Error polling for token: {e}')

				await asyncio.sleep(interval)
		else:
			# Create a new client for polling
			async with httpx.AsyncClient() as client:
				while time.time() - start_time < timeout:
					try:
						response = await client.post(
							f'{self.base_url.rstrip("/")}/api/v1/oauth/device/token',
							data={
								'grant_type': 'urn:ietf:params:oauth:grant-type:device_code',
								'device_code': device_code,
								'client_id': self.client_id,
							},
						)

						if response.status_code == 200:
							data = response.json()

							# Check for pending authorization
							if data.get('error') == 'authorization_pending':
								await asyncio.sleep(interval)
								continue

							# Check for slow down
							if data.get('error') == 'slow_down':
								interval = data.get('interval', interval * 2)
								await asyncio.sleep(interval)
								continue

							# Check for other errors
							if 'error' in data:
								print(f'Error: {data.get("error_description", data["error"])}')
								return None

							# Success! We have a token
							if 'access_token' in data:
								return data

						elif response.status_code == 400:
							# Error response
							data = response.json()
							if data.get('error') not in ['authorization_pending', 'slow_down']:
								print(f'Error: {data.get("error_description", "Unknown error")}')
								return None

						else:
							print(f'Unexpected status code: {response.status_code}')
							return None

					except Exception as e:
						print(f'Error polling for token: {e}')

					await asyncio.sleep(interval)

		return None

	async def authenticate(
		self,
		agent_session_id: str | None = None,
		show_instructions: bool = True,
	) -> bool:
		"""
		Run the full authentication flow.
		Returns True if authentication successful.
		"""
		import logging

		logger = logging.getLogger(__name__)

		try:
			# Start device authorization
			device_auth = await self.start_device_authorization(agent_session_id)

			# Use frontend URL for user-facing links
			frontend_url = CONFIG.BROWSER_USE_CLOUD_UI_URL or self.base_url.replace('//api.', '//cloud.')

			# Replace backend URL with frontend URL in verification URIs
			verification_uri = device_auth['verification_uri'].replace(self.base_url, frontend_url)
			verification_uri_complete = device_auth['verification_uri_complete'].replace(self.base_url, frontend_url)

			terminal_width, _terminal_height = shutil.get_terminal_size((80, 20))
			if show_instructions and CONFIG.BROWSER_USE_CLOUD_SYNC:
				logger.info('─' * max(terminal_width - 40, 20))
				logger.info('🌐  View the details of this run in Browser Use Cloud:')
				logger.info(f'    👉  {verification_uri_complete}')
				logger.info('─' * max(terminal_width - 40, 20) + '\n')

			# Poll for token
			token_data = await self.poll_for_token(
				device_code=device_auth['device_code'],
				interval=device_auth.get('interval', 5),
			)

			if token_data and token_data.get('access_token'):
				# Save authentication
				self.auth_config.api_token = token_data['access_token']
				self.auth_config.user_id = token_data.get('user_id', self.temp_user_id)
				self.auth_config.authorized_at = datetime.now()
				self.auth_config.save_to_file()

				if show_instructions:
					logger.debug('✅  Authentication successful! Cloud sync is now enabled with your browser-use account.')

				return True

		except httpx.HTTPStatusError as e:
			# HTTP error with response
			if e.response.status_code == 404:
				logger.warning(
					'Cloud sync authentication endpoint not found (404). Check your BROWSER_USE_CLOUD_API_URL setting.'
				)
			else:
				logger.warning(f'Failed to authenticate with cloud service: HTTP {e.response.status_code} - {e.response.text}')
		except httpx.RequestError as e:
			# Connection/network errors
			# logger.warning(f'Failed to connect to cloud service: {type(e).__name__}: {e}')
			pass
		except Exception as e:
			# Other unexpected errors
			logger.warning(f'❌ Unexpected error during cloud sync authentication: {type(e).__name__}: {e}')

		if show_instructions:
			logger.debug(f'❌ Sync authentication failed or timed out with {CONFIG.BROWSER_USE_CLOUD_API_URL}')

		return False

	def get_headers(self) -> dict:
		"""Get headers for API requests"""
		if self.api_token:
			return {'Authorization': f'Bearer {self.api_token}'}
		return {}

	def clear_auth(self) -> None:
		"""Clear stored authentication"""
		self.auth_config = CloudAuthConfig()

		# Remove the config file entirely instead of saving empty values
		config_path = CONFIG.BROWSER_USE_CONFIG_DIR / 'cloud_auth.json'
		config_path.unlink(missing_ok=True)

```

---

## backend/browser-use/browser_use/sync/service.py

```py
"""
Cloud sync service for sending events to the Browser Use cloud.
"""

import logging

import httpx
from bubus import BaseEvent

from browser_use.config import CONFIG
from browser_use.sync.auth import TEMP_USER_ID, DeviceAuthClient

logger = logging.getLogger(__name__)


class CloudSync:
	"""Service for syncing events to the Browser Use cloud"""

	def __init__(self, base_url: str | None = None, allow_session_events_for_auth: bool = False):
		# Backend API URL for all API requests - can be passed directly or defaults to env var
		self.base_url = base_url or CONFIG.BROWSER_USE_CLOUD_API_URL
		self.auth_client = DeviceAuthClient(base_url=self.base_url)
		self.session_id: str | None = None
		self.allow_session_events_for_auth = allow_session_events_for_auth
		self.auth_flow_active = False  # Flag to indicate auth flow is running
		# Check if cloud sync is actually enabled - if not, we should remain silent
		self.enabled = CONFIG.BROWSER_USE_CLOUD_SYNC

	async def handle_event(self, event: BaseEvent) -> None:
		"""Handle an event by sending it to the cloud"""
		try:
			# If cloud sync is disabled, don't handle any events
			if not self.enabled:
				return

			# Extract session ID from CreateAgentSessionEvent
			if event.event_type == 'CreateAgentSessionEvent' and hasattr(event, 'id'):
				self.session_id = str(event.id)  # type: ignore

			# Send events based on authentication status and context
			if self.auth_client.is_authenticated:
				# User is authenticated - send all events
				await self._send_event(event)
			elif self.allow_session_events_for_auth:
				# Special case: allow ALL events during auth flow
				await self._send_event(event)
				# Mark auth flow as active when we see a session event
				if event.event_type == 'CreateAgentSessionEvent':
					self.auth_flow_active = True
			else:
				# User is not authenticated and no auth in progress - don't send anything
				logger.debug(f'Skipping event {event.event_type} - user not authenticated')

		except Exception as e:
			logger.error(f'Failed to handle {event.event_type} event: {type(e).__name__}: {e}', exc_info=True)

	async def _send_event(self, event: BaseEvent) -> None:
		"""Send event to cloud API"""
		try:
			headers = {}

			# Override user_id only if it's not already set to a specific value
			# This allows CLI and other code to explicitly set temp user_id when needed
			if self.auth_client and self.auth_client.is_authenticated:
				# Only override if we're fully authenticated and event doesn't have temp user_id
				current_user_id = getattr(event, 'user_id', None)
				if current_user_id != TEMP_USER_ID:
					setattr(event, 'user_id', str(self.auth_client.user_id))
			else:
				# Set temp user_id if not already set
				if not hasattr(event, 'user_id') or not getattr(event, 'user_id', None):
					setattr(event, 'user_id', TEMP_USER_ID)

			# Add auth headers if available
			if self.auth_client:
				headers.update(self.auth_client.get_headers())

			# Send event (batch format with direct BaseEvent serialization)
			async with httpx.AsyncClient() as client:
				# Serialize event and add device_id to all events
				event_data = event.model_dump(mode='json')
				if self.auth_client and self.auth_client.device_id:
					event_data['device_id'] = self.auth_client.device_id

				response = await client.post(
					f'{self.base_url.rstrip("/")}/api/v1/events',
					json={'events': [event_data]},
					headers=headers,
					timeout=10.0,
				)

				if response.status_code >= 400:
					# Log error but don't raise - we want to fail silently
					logger.debug(
						f'Failed to send sync event: POST {response.request.url} {response.status_code} - {response.text}'
					)
		except httpx.TimeoutException:
			logger.debug(f'Event send timed out after 10 seconds: {event}')
		except httpx.ConnectError as e:
			# logger.warning(f'⚠️ Failed to connect to cloud service at {self.base_url}: {e}')
			pass
		except httpx.HTTPError as e:
			logger.debug(f'HTTP error sending event {event}: {type(e).__name__}: {e}')
		except Exception as e:
			logger.debug(f'Unexpected error sending event {event}: {type(e).__name__}: {e}')

	# async def _update_wal_user_ids(self, session_id: str) -> None:
	# 	"""Update user IDs in WAL file after authentication"""
	# 	try:
	# 		assert self.auth_client, 'Cloud sync must be authenticated to update WAL user ID'

	# 		wal_path = CONFIG.BROWSER_USE_CONFIG_DIR / 'events' / f'{session_id}.jsonl'
	# 		if not await anyio.Path(wal_path).exists():
	# 			raise FileNotFoundError(
	# 				f'CloudSync failed to update saved event user_ids after auth: Agent EventBus WAL file not found: {wal_path}'
	# 			)

	# 		# Read all events
	# 		events = []
	# 		content = await anyio.Path(wal_path).read_text()
	# 		for line in content.splitlines():
	# 			if line.strip():
	# 				events.append(json.loads(line))

	# 		# Update user_id and device_id
	# 		user_id = self.auth_client.user_id
	# 		device_id = self.auth_client.device_id
	# 		for event in events:
	# 			if 'user_id' in event:
	# 				event['user_id'] = user_id
	# 			# Add device_id to all events
	# 			event['device_id'] = device_id

	# 		# Write back
	# 		updated_content = '\n'.join(json.dumps(event) for event in events) + '\n'
	# 		await anyio.Path(wal_path).write_text(updated_content)

	# 	except Exception as e:
	# 		logger.warning(f'Failed to update WAL user IDs: {e}')

	def set_auth_flow_active(self) -> None:
		"""Mark auth flow as active to allow all events"""
		self.auth_flow_active = True

	async def authenticate(self, show_instructions: bool = True) -> bool:
		"""Authenticate with the cloud service"""
		# If cloud sync is disabled, don't authenticate
		if not self.enabled:
			return False

		# Check if already authenticated first
		if self.auth_client.is_authenticated:
			import logging

			logger = logging.getLogger(__name__)
			if show_instructions:
				logger.info('✅ Already authenticated! Skipping OAuth flow.')
			return True

		# Not authenticated - run OAuth flow
		return await self.auth_client.authenticate(agent_session_id=self.session_id, show_instructions=show_instructions)

```

---

## backend/browser-use/browser_use/telemetry/__init__.py

```py
"""
Telemetry for Browser Use.
"""

from typing import TYPE_CHECKING

# Type stubs for lazy imports
if TYPE_CHECKING:
	from browser_use.telemetry.service import ProductTelemetry
	from browser_use.telemetry.views import (
		BaseTelemetryEvent,
		CLITelemetryEvent,
		MCPClientTelemetryEvent,
		MCPServerTelemetryEvent,
	)

# Lazy imports mapping
_LAZY_IMPORTS = {
	'ProductTelemetry': ('browser_use.telemetry.service', 'ProductTelemetry'),
	'BaseTelemetryEvent': ('browser_use.telemetry.views', 'BaseTelemetryEvent'),
	'CLITelemetryEvent': ('browser_use.telemetry.views', 'CLITelemetryEvent'),
	'MCPClientTelemetryEvent': ('browser_use.telemetry.views', 'MCPClientTelemetryEvent'),
	'MCPServerTelemetryEvent': ('browser_use.telemetry.views', 'MCPServerTelemetryEvent'),
}


def __getattr__(name: str):
	"""Lazy import mechanism for telemetry components."""
	if name in _LAZY_IMPORTS:
		module_path, attr_name = _LAZY_IMPORTS[name]
		try:
			from importlib import import_module

			module = import_module(module_path)
			attr = getattr(module, attr_name)
			# Cache the imported attribute in the module's globals
			globals()[name] = attr
			return attr
		except ImportError as e:
			raise ImportError(f'Failed to import {name} from {module_path}: {e}') from e

	raise AttributeError(f"module '{__name__}' has no attribute '{name}'")


__all__ = [
	'BaseTelemetryEvent',
	'ProductTelemetry',
	'CLITelemetryEvent',
	'MCPClientTelemetryEvent',
	'MCPServerTelemetryEvent',
]

```

---

## backend/browser-use/browser_use/telemetry/service.py

```py
import logging
import os

from dotenv import load_dotenv
from posthog import Posthog
from uuid_extensions import uuid7str

from browser_use.telemetry.views import BaseTelemetryEvent
from browser_use.utils import singleton

load_dotenv()

from browser_use.config import CONFIG

logger = logging.getLogger(__name__)


POSTHOG_EVENT_SETTINGS = {
	'process_person_profile': True,
}


@singleton
class ProductTelemetry:
	"""
	Service for capturing anonymized telemetry data.

	If the environment variable `ANONYMIZED_TELEMETRY=False`, anonymized telemetry will be disabled.
	"""

	USER_ID_PATH = str(CONFIG.BROWSER_USE_CONFIG_DIR / 'device_id')
	PROJECT_API_KEY = 'phc_F8JMNjW1i2KbGUTaW1unnDdLSPCoyc52SGRU0JecaUh'
	HOST = 'https://eu.i.posthog.com'
	UNKNOWN_USER_ID = 'UNKNOWN'

	_curr_user_id = None

	def __init__(self) -> None:
		telemetry_disabled = not CONFIG.ANONYMIZED_TELEMETRY
		self.debug_logging = CONFIG.BROWSER_USE_LOGGING_LEVEL == 'debug'

		if telemetry_disabled:
			self._posthog_client = None
		else:
			logger.info('Using anonymized telemetry, see https://docs.browser-use.com/development/telemetry.')
			self._posthog_client = Posthog(
				project_api_key=self.PROJECT_API_KEY,
				host=self.HOST,
				disable_geoip=False,
				enable_exception_autocapture=True,
			)

			# Silence posthog's logging
			if not self.debug_logging:
				posthog_logger = logging.getLogger('posthog')
				posthog_logger.disabled = True

		if self._posthog_client is None:
			logger.debug('Telemetry disabled')

	def capture(self, event: BaseTelemetryEvent) -> None:
		if self._posthog_client is None:
			return

		self._direct_capture(event)

	def _direct_capture(self, event: BaseTelemetryEvent) -> None:
		"""
		Should not be thread blocking because posthog magically handles it
		"""
		if self._posthog_client is None:
			return

		try:
			self._posthog_client.capture(
				distinct_id=self.user_id,
				event=event.name,
				properties={**event.properties, **POSTHOG_EVENT_SETTINGS},
			)
		except Exception as e:
			logger.error(f'Failed to send telemetry event {event.name}: {e}')

	def flush(self) -> None:
		if self._posthog_client:
			try:
				self._posthog_client.flush()
				logger.debug('PostHog client telemetry queue flushed.')
			except Exception as e:
				logger.error(f'Failed to flush PostHog client: {e}')
		else:
			logger.debug('PostHog client not available, skipping flush.')

	@property
	def user_id(self) -> str:
		if self._curr_user_id:
			return self._curr_user_id

		# File access may fail due to permissions or other reasons. We don't want to
		# crash so we catch all exceptions.
		try:
			if not os.path.exists(self.USER_ID_PATH):
				os.makedirs(os.path.dirname(self.USER_ID_PATH), exist_ok=True)
				with open(self.USER_ID_PATH, 'w') as f:
					new_user_id = uuid7str()
					f.write(new_user_id)
				self._curr_user_id = new_user_id
			else:
				with open(self.USER_ID_PATH) as f:
					self._curr_user_id = f.read()
		except Exception:
			self._curr_user_id = 'UNKNOWN_USER_ID'
		return self._curr_user_id

```

---

## backend/browser-use/browser_use/telemetry/views.py

```py
from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from typing import Any, Literal

from browser_use.config import is_running_in_docker


@dataclass
class BaseTelemetryEvent(ABC):
	@property
	@abstractmethod
	def name(self) -> str:
		pass

	@property
	def properties(self) -> dict[str, Any]:
		props = {k: v for k, v in asdict(self).items() if k != 'name'}
		# Add Docker context if running in Docker
		props['is_docker'] = is_running_in_docker()
		return props


@dataclass
class AgentTelemetryEvent(BaseTelemetryEvent):
	# start details
	task: str
	model: str
	model_provider: str
	max_steps: int
	max_actions_per_step: int
	use_vision: bool | Literal['auto']
	version: str
	source: str
	cdp_url: str | None
	agent_type: str | None  # 'code' for CodeAgent, None for regular Agent
	# step details
	action_errors: Sequence[str | None]
	action_history: Sequence[list[dict] | None]
	urls_visited: Sequence[str | None]
	# end details
	steps: int
	total_input_tokens: int
	total_output_tokens: int
	prompt_cached_tokens: int
	total_tokens: int
	total_duration_seconds: float
	success: bool | None
	final_result_response: str | None
	error_message: str | None
	# judge details
	judge_verdict: bool | None = None
	judge_reasoning: str | None = None
	judge_failure_reason: str | None = None
	judge_reached_captcha: bool | None = None
	judge_impossible_task: bool | None = None

	name: str = 'agent_event'


@dataclass
class MCPClientTelemetryEvent(BaseTelemetryEvent):
	"""Telemetry event for MCP client usage"""

	server_name: str
	command: str
	tools_discovered: int
	version: str
	action: str  # 'connect', 'disconnect', 'tool_call'
	tool_name: str | None = None
	duration_seconds: float | None = None
	error_message: str | None = None

	name: str = 'mcp_client_event'


@dataclass
class MCPServerTelemetryEvent(BaseTelemetryEvent):
	"""Telemetry event for MCP server usage"""

	version: str
	action: str  # 'start', 'stop', 'tool_call'
	tool_name: str | None = None
	duration_seconds: float | None = None
	error_message: str | None = None
	parent_process_cmdline: str | None = None

	name: str = 'mcp_server_event'


@dataclass
class CLITelemetryEvent(BaseTelemetryEvent):
	"""Telemetry event for CLI usage"""

	version: str
	action: str  # 'start', 'message_sent', 'task_completed', 'error'
	mode: str  # 'interactive', 'oneshot', 'mcp_server'
	model: str | None = None
	model_provider: str | None = None
	duration_seconds: float | None = None
	error_message: str | None = None

	name: str = 'cli_event'

```

---

## backend/browser-use/browser_use/tokens/__init__.py

```py

```

---

## backend/browser-use/browser_use/tokens/custom_pricing.py

```py
"""
Custom model pricing for models not available in LiteLLM's pricing data.

Prices are per token (not per 1M tokens).
"""

from typing import Any

# Custom model pricing data
# Format matches LiteLLM's model_prices_and_context_window.json structure
CUSTOM_MODEL_PRICING: dict[str, dict[str, Any]] = {
	'bu-1-0': {
		'input_cost_per_token': 0.2 / 1_000_000,  # $0.50 per 1M tokens
		'output_cost_per_token': 2.00 / 1_000_000,  # $3.00 per 1M tokens
		'cache_read_input_token_cost': 0.02 / 1_000_000,  # $0.10 per 1M tokens
		'cache_creation_input_token_cost': None,  # Not specified
		'max_tokens': None,  # Not specified
		'max_input_tokens': None,  # Not specified
		'max_output_tokens': None,  # Not specified
	}
}
CUSTOM_MODEL_PRICING['bu-latest'] = CUSTOM_MODEL_PRICING['bu-1-0']

CUSTOM_MODEL_PRICING['smart'] = CUSTOM_MODEL_PRICING['bu-1-0']

```

---

## backend/browser-use/browser_use/tokens/mappings.py

```py
# Mapping from model_name to LiteLLM model name
MODEL_TO_LITELLM: dict[str, str] = {
	'gemini-flash-latest': 'gemini/gemini-flash-latest',
}

```

---

## backend/browser-use/browser_use/tokens/service.py

```py
"""
Token cost service that tracks LLM token usage and costs.

Fetches pricing data from LiteLLM repository and caches it for 1 day.
Automatically tracks token usage when LLMs are registered and invoked.
"""

import logging
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import anyio
import httpx
from dotenv import load_dotenv

from browser_use.llm.base import BaseChatModel
from browser_use.llm.views import ChatInvokeUsage
from browser_use.tokens.custom_pricing import CUSTOM_MODEL_PRICING
from browser_use.tokens.mappings import MODEL_TO_LITELLM
from browser_use.tokens.views import (
	CachedPricingData,
	ModelPricing,
	ModelUsageStats,
	ModelUsageTokens,
	TokenCostCalculated,
	TokenUsageEntry,
	UsageSummary,
)
from browser_use.utils import create_task_with_error_handling

load_dotenv()

from browser_use.config import CONFIG

logger = logging.getLogger(__name__)
cost_logger = logging.getLogger('cost')


def xdg_cache_home() -> Path:
	default = Path.home() / '.cache'
	if CONFIG.XDG_CACHE_HOME and (path := Path(CONFIG.XDG_CACHE_HOME)).is_absolute():
		return path
	return default


class TokenCost:
	"""Service for tracking token usage and calculating costs"""

	CACHE_DIR_NAME = 'browser_use/token_cost'
	CACHE_DURATION = timedelta(days=1)
	PRICING_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

	def __init__(self, include_cost: bool = False):
		self.include_cost = include_cost or os.getenv('BROWSER_USE_CALCULATE_COST', 'false').lower() == 'true'

		self.usage_history: list[TokenUsageEntry] = []
		self.registered_llms: dict[str, BaseChatModel] = {}
		self._pricing_data: dict[str, Any] | None = None
		self._initialized = False
		self._cache_dir = xdg_cache_home() / self.CACHE_DIR_NAME

	async def initialize(self) -> None:
		"""Initialize the service by loading pricing data"""
		if not self._initialized:
			if self.include_cost:
				await self._load_pricing_data()
			self._initialized = True

	async def _load_pricing_data(self) -> None:
		"""Load pricing data from cache or fetch from GitHub"""
		# Try to find a valid cache file
		cache_file = await self._find_valid_cache()

		if cache_file:
			await self._load_from_cache(cache_file)
		else:
			await self._fetch_and_cache_pricing_data()

	async def _find_valid_cache(self) -> Path | None:
		"""Find the most recent valid cache file"""
		try:
			# Ensure cache directory exists
			self._cache_dir.mkdir(parents=True, exist_ok=True)

			# List all JSON files in the cache directory
			cache_files = list(self._cache_dir.glob('*.json'))

			if not cache_files:
				return None

			# Sort by modification time (most recent first)
			cache_files.sort(key=lambda f: f.stat().st_mtime, reverse=True)

			# Check each file until we find a valid one
			for cache_file in cache_files:
				if await self._is_cache_valid(cache_file):
					return cache_file
				else:
					# Clean up old cache files
					try:
						os.remove(cache_file)
					except Exception:
						pass

			return None
		except Exception:
			return None

	async def _is_cache_valid(self, cache_file: Path) -> bool:
		"""Check if a specific cache file is valid and not expired"""
		try:
			if not cache_file.exists():
				return False

			# Read the cached data
			cached = CachedPricingData.model_validate_json(await anyio.Path(cache_file).read_text())

			# Check if cache is still valid
			return datetime.now() - cached.timestamp < self.CACHE_DURATION
		except Exception:
			return False

	async def _load_from_cache(self, cache_file: Path) -> None:
		"""Load pricing data from a specific cache file"""
		try:
			content = await anyio.Path(cache_file).read_text()
			cached = CachedPricingData.model_validate_json(content)
			self._pricing_data = cached.data
		except Exception as e:
			logger.debug(f'Error loading cached pricing data from {cache_file}: {e}')
			# Fall back to fetching
			await self._fetch_and_cache_pricing_data()

	async def _fetch_and_cache_pricing_data(self) -> None:
		"""Fetch pricing data from LiteLLM GitHub and cache it with timestamp"""
		try:
			async with httpx.AsyncClient() as client:
				response = await client.get(self.PRICING_URL, timeout=30)
				response.raise_for_status()

				self._pricing_data = response.json()

			# Create cache object with timestamp
			cached = CachedPricingData(timestamp=datetime.now(), data=self._pricing_data or {})

			# Ensure cache directory exists
			self._cache_dir.mkdir(parents=True, exist_ok=True)

			# Create cache file with timestamp in filename
			timestamp_str = datetime.now().strftime('%Y%m%d_%H%M%S')
			cache_file = self._cache_dir / f'pricing_{timestamp_str}.json'

			await anyio.Path(cache_file).write_text(cached.model_dump_json(indent=2))
		except Exception as e:
			logger.debug(f'Error fetching pricing data: {e}')
			# Fall back to empty pricing data
			self._pricing_data = {}

	async def get_model_pricing(self, model_name: str) -> ModelPricing | None:
		"""Get pricing information for a specific model"""
		# Ensure we're initialized
		if not self._initialized:
			await self.initialize()

		# Check custom pricing first
		if model_name in CUSTOM_MODEL_PRICING:
			data = CUSTOM_MODEL_PRICING[model_name]
			return ModelPricing(
				model=model_name,
				input_cost_per_token=data.get('input_cost_per_token'),
				output_cost_per_token=data.get('output_cost_per_token'),
				max_tokens=data.get('max_tokens'),
				max_input_tokens=data.get('max_input_tokens'),
				max_output_tokens=data.get('max_output_tokens'),
				cache_read_input_token_cost=data.get('cache_read_input_token_cost'),
				cache_creation_input_token_cost=data.get('cache_creation_input_token_cost'),
			)

		# Map model name to LiteLLM model name if needed
		litellm_model_name = MODEL_TO_LITELLM.get(model_name, model_name)

		if not self._pricing_data or litellm_model_name not in self._pricing_data:
			return None

		data = self._pricing_data[litellm_model_name]
		return ModelPricing(
			model=model_name,
			input_cost_per_token=data.get('input_cost_per_token'),
			output_cost_per_token=data.get('output_cost_per_token'),
			max_tokens=data.get('max_tokens'),
			max_input_tokens=data.get('max_input_tokens'),
			max_output_tokens=data.get('max_output_tokens'),
			cache_read_input_token_cost=data.get('cache_read_input_token_cost'),
			cache_creation_input_token_cost=data.get('cache_creation_input_token_cost'),
		)

	async def calculate_cost(self, model: str, usage: ChatInvokeUsage) -> TokenCostCalculated | None:
		if not self.include_cost:
			return None

		data = await self.get_model_pricing(model)
		if data is None:
			return None

		uncached_prompt_tokens = usage.prompt_tokens - (usage.prompt_cached_tokens or 0)

		return TokenCostCalculated(
			new_prompt_tokens=usage.prompt_tokens,
			new_prompt_cost=uncached_prompt_tokens * (data.input_cost_per_token or 0),
			# Cached tokens
			prompt_read_cached_tokens=usage.prompt_cached_tokens,
			prompt_read_cached_cost=usage.prompt_cached_tokens * data.cache_read_input_token_cost
			if usage.prompt_cached_tokens and data.cache_read_input_token_cost
			else None,
			# Cache creation tokens
			prompt_cached_creation_tokens=usage.prompt_cache_creation_tokens,
			prompt_cache_creation_cost=usage.prompt_cache_creation_tokens * data.cache_creation_input_token_cost
			if data.cache_creation_input_token_cost and usage.prompt_cache_creation_tokens
			else None,
			# Completion tokens
			completion_tokens=usage.completion_tokens,
			completion_cost=usage.completion_tokens * float(data.output_cost_per_token or 0),
		)

	def add_usage(self, model: str, usage: ChatInvokeUsage) -> TokenUsageEntry:
		"""Add token usage entry to history (without calculating cost)"""
		entry = TokenUsageEntry(
			model=model,
			timestamp=datetime.now(),
			usage=usage,
		)

		self.usage_history.append(entry)

		return entry

	# async def _log_non_usage_llm(self, llm: BaseChatModel) -> None:
	# 	"""Log non-usage to the logger"""
	# 	C_CYAN = '\033[96m'
	# 	C_RESET = '\033[0m'

	# 	cost_logger.debug(f'🧠 llm : {C_CYAN}{llm.model}{C_RESET} (no usage found)')

	async def _log_usage(self, model: str, usage: TokenUsageEntry) -> None:
		"""Log usage to the logger"""
		if not self._initialized:
			await self.initialize()

		# ANSI color codes
		C_CYAN = '\033[96m'
		C_YELLOW = '\033[93m'
		C_GREEN = '\033[92m'
		C_BLUE = '\033[94m'
		C_RESET = '\033[0m'

		# Always get cost breakdown for token details (even if not showing costs)
		cost = await self.calculate_cost(model, usage.usage)

		# Build input tokens breakdown
		input_part = self._build_input_tokens_display(usage.usage, cost)

		# Build output tokens display
		completion_tokens_fmt = self._format_tokens(usage.usage.completion_tokens)
		if self.include_cost and cost and cost.completion_cost > 0:
			output_part = f'📤 {C_GREEN}{completion_tokens_fmt} (${cost.completion_cost:.4f}){C_RESET}'
		else:
			output_part = f'📤 {C_GREEN}{completion_tokens_fmt}{C_RESET}'

		cost_logger.debug(f'🧠 {C_CYAN}{model}{C_RESET} | {input_part} | {output_part}')

	def _build_input_tokens_display(self, usage: ChatInvokeUsage, cost: TokenCostCalculated | None) -> str:
		"""Build a clear display of input tokens breakdown with emojis and optional costs"""
		C_YELLOW = '\033[93m'
		C_BLUE = '\033[94m'
		C_RESET = '\033[0m'

		parts = []

		# Always show token breakdown if we have cache information, regardless of cost tracking
		if usage.prompt_cached_tokens or usage.prompt_cache_creation_tokens:
			# Calculate actual new tokens (non-cached)
			new_tokens = usage.prompt_tokens - (usage.prompt_cached_tokens or 0)

			if new_tokens > 0:
				new_tokens_fmt = self._format_tokens(new_tokens)
				if self.include_cost and cost and cost.new_prompt_cost > 0:
					parts.append(f'🆕 {C_YELLOW}{new_tokens_fmt} (${cost.new_prompt_cost:.4f}){C_RESET}')
				else:
					parts.append(f'🆕 {C_YELLOW}{new_tokens_fmt}{C_RESET}')

			if usage.prompt_cached_tokens:
				cached_tokens_fmt = self._format_tokens(usage.prompt_cached_tokens)
				if self.include_cost and cost and cost.prompt_read_cached_cost:
					parts.append(f'💾 {C_BLUE}{cached_tokens_fmt} (${cost.prompt_read_cached_cost:.4f}){C_RESET}')
				else:
					parts.append(f'💾 {C_BLUE}{cached_tokens_fmt}{C_RESET}')

			if usage.prompt_cache_creation_tokens:
				creation_tokens_fmt = self._format_tokens(usage.prompt_cache_creation_tokens)
				if self.include_cost and cost and cost.prompt_cache_creation_cost:
					parts.append(f'🔧 {C_BLUE}{creation_tokens_fmt} (${cost.prompt_cache_creation_cost:.4f}){C_RESET}')
				else:
					parts.append(f'🔧 {C_BLUE}{creation_tokens_fmt}{C_RESET}')

		if not parts:
			# Fallback to simple display when no cache information available
			total_tokens_fmt = self._format_tokens(usage.prompt_tokens)
			if self.include_cost and cost and cost.new_prompt_cost > 0:
				parts.append(f'📥 {C_YELLOW}{total_tokens_fmt} (${cost.new_prompt_cost:.4f}){C_RESET}')
			else:
				parts.append(f'📥 {C_YELLOW}{total_tokens_fmt}{C_RESET}')

		return ' + '.join(parts)

	def register_llm(self, llm: BaseChatModel) -> BaseChatModel:
		"""
		Register an LLM to automatically track its token usage

		@dev Guarantees that the same instance is not registered multiple times
		"""
		# Use instance ID as key to avoid collisions between multiple instances
		instance_id = str(id(llm))

		# Check if this exact instance is already registered
		if instance_id in self.registered_llms:
			logger.debug(f'LLM instance {instance_id} ({llm.provider}_{llm.model}) is already registered')
			return llm

		self.registered_llms[instance_id] = llm

		# Store the original method
		original_ainvoke = llm.ainvoke
		# Store reference to self for use in the closure
		token_cost_service = self

		# Create a wrapped version that tracks usage
		async def tracked_ainvoke(messages, output_format=None, **kwargs):
			# Call the original method, passing through any additional kwargs
			result = await original_ainvoke(messages, output_format, **kwargs)

			# Track usage if available (no await needed since add_usage is now sync)
			# Use llm.model instead of llm.name for consistency with get_usage_tokens_for_model()
			if result.usage:
				usage = token_cost_service.add_usage(llm.model, result.usage)

				logger.debug(f'Token cost service: {usage}')

				create_task_with_error_handling(
					token_cost_service._log_usage(llm.model, usage), name='log_token_usage', suppress_exceptions=True
				)

			# else:
			# 	await token_cost_service._log_non_usage_llm(llm)

			return result

		# Replace the method with our tracked version
		# Using setattr to avoid type checking issues with overloaded methods
		setattr(llm, 'ainvoke', tracked_ainvoke)

		return llm

	def get_usage_tokens_for_model(self, model: str) -> ModelUsageTokens:
		"""Get usage tokens for a specific model"""
		filtered_usage = [u for u in self.usage_history if u.model == model]

		return ModelUsageTokens(
			model=model,
			prompt_tokens=sum(u.usage.prompt_tokens for u in filtered_usage),
			prompt_cached_tokens=sum(u.usage.prompt_cached_tokens or 0 for u in filtered_usage),
			completion_tokens=sum(u.usage.completion_tokens for u in filtered_usage),
			total_tokens=sum(u.usage.prompt_tokens + u.usage.completion_tokens for u in filtered_usage),
		)

	async def get_usage_summary(self, model: str | None = None, since: datetime | None = None) -> UsageSummary:
		"""Get summary of token usage and costs (costs calculated on-the-fly)"""
		filtered_usage = self.usage_history

		if model:
			filtered_usage = [u for u in filtered_usage if u.model == model]

		if since:
			filtered_usage = [u for u in filtered_usage if u.timestamp >= since]

		if not filtered_usage:
			return UsageSummary(
				total_prompt_tokens=0,
				total_prompt_cost=0.0,
				total_prompt_cached_tokens=0,
				total_prompt_cached_cost=0.0,
				total_completion_tokens=0,
				total_completion_cost=0.0,
				total_tokens=0,
				total_cost=0.0,
				entry_count=0,
			)

		# Calculate totals
		total_prompt = sum(u.usage.prompt_tokens for u in filtered_usage)
		total_completion = sum(u.usage.completion_tokens for u in filtered_usage)
		total_tokens = total_prompt + total_completion
		total_prompt_cached = sum(u.usage.prompt_cached_tokens or 0 for u in filtered_usage)
		models = list({u.model for u in filtered_usage})

		# Calculate per-model stats with record-by-record cost calculation
		model_stats: dict[str, ModelUsageStats] = {}
		total_prompt_cost = 0.0
		total_completion_cost = 0.0
		total_prompt_cached_cost = 0.0

		for entry in filtered_usage:
			if entry.model not in model_stats:
				model_stats[entry.model] = ModelUsageStats(model=entry.model)

			stats = model_stats[entry.model]
			stats.prompt_tokens += entry.usage.prompt_tokens
			stats.completion_tokens += entry.usage.completion_tokens
			stats.total_tokens += entry.usage.prompt_tokens + entry.usage.completion_tokens
			stats.invocations += 1

			if self.include_cost:
				# Calculate cost record by record using the updated calculate_cost function
				cost = await self.calculate_cost(entry.model, entry.usage)
				if cost:
					stats.cost += cost.total_cost
					total_prompt_cost += cost.prompt_cost
					total_completion_cost += cost.completion_cost
					total_prompt_cached_cost += cost.prompt_read_cached_cost or 0

		# Calculate averages
		for stats in model_stats.values():
			if stats.invocations > 0:
				stats.average_tokens_per_invocation = stats.total_tokens / stats.invocations

		return UsageSummary(
			total_prompt_tokens=total_prompt,
			total_prompt_cost=total_prompt_cost,
			total_prompt_cached_tokens=total_prompt_cached,
			total_prompt_cached_cost=total_prompt_cached_cost,
			total_completion_tokens=total_completion,
			total_completion_cost=total_completion_cost,
			total_tokens=total_tokens,
			total_cost=total_prompt_cost + total_completion_cost + total_prompt_cached_cost,
			entry_count=len(filtered_usage),
			by_model=model_stats,
		)

	def _format_tokens(self, tokens: int) -> str:
		"""Format token count with k suffix for thousands"""
		if tokens >= 1000000000:
			return f'{tokens / 1000000000:.1f}B'
		if tokens >= 1000000:
			return f'{tokens / 1000000:.1f}M'
		if tokens >= 1000:
			return f'{tokens / 1000:.1f}k'
		return str(tokens)

	async def log_usage_summary(self) -> None:
		"""Log a comprehensive usage summary per model with colors and nice formatting"""
		if not self.usage_history:
			return

		summary = await self.get_usage_summary()

		if summary.entry_count == 0:
			return

		# ANSI color codes
		C_CYAN = '\033[96m'
		C_YELLOW = '\033[93m'
		C_GREEN = '\033[92m'
		C_BLUE = '\033[94m'
		C_MAGENTA = '\033[95m'
		C_RESET = '\033[0m'
		C_BOLD = '\033[1m'

		# Log overall summary
		total_tokens_fmt = self._format_tokens(summary.total_tokens)
		prompt_tokens_fmt = self._format_tokens(summary.total_prompt_tokens)
		completion_tokens_fmt = self._format_tokens(summary.total_completion_tokens)

		# Format cost breakdowns for input and output (only if cost tracking is enabled)
		if self.include_cost and summary.total_cost > 0:
			total_cost_part = f' (${C_MAGENTA}{summary.total_cost:.4f}{C_RESET})'
			prompt_cost_part = f' (${summary.total_prompt_cost:.4f})'
			completion_cost_part = f' (${summary.total_completion_cost:.4f})'
		else:
			total_cost_part = ''
			prompt_cost_part = ''
			completion_cost_part = ''

		if len(summary.by_model) > 1:
			cost_logger.debug(
				f'💲 {C_BOLD}Total Usage Summary{C_RESET}: {C_BLUE}{total_tokens_fmt} tokens{C_RESET}{total_cost_part} | '
				f'⬅️ {C_YELLOW}{prompt_tokens_fmt}{prompt_cost_part}{C_RESET} | ➡️ {C_GREEN}{completion_tokens_fmt}{completion_cost_part}{C_RESET}'
			)

		for model, stats in summary.by_model.items():
			# Format tokens
			model_total_fmt = self._format_tokens(stats.total_tokens)
			model_prompt_fmt = self._format_tokens(stats.prompt_tokens)
			model_completion_fmt = self._format_tokens(stats.completion_tokens)
			avg_tokens_fmt = self._format_tokens(int(stats.average_tokens_per_invocation))

			# Format cost display (only if cost tracking is enabled)
			if self.include_cost:
				# Calculate per-model costs on-the-fly
				total_model_cost = 0.0
				model_prompt_cost = 0.0
				model_completion_cost = 0.0

				# Calculate costs for this model
				for entry in self.usage_history:
					if entry.model == model:
						cost = await self.calculate_cost(entry.model, entry.usage)
						if cost:
							model_prompt_cost += cost.prompt_cost
							model_completion_cost += cost.completion_cost

				total_model_cost = model_prompt_cost + model_completion_cost

				if total_model_cost > 0:
					cost_part = f' (${C_MAGENTA}{total_model_cost:.4f}{C_RESET})'
					prompt_part = f'{C_YELLOW}{model_prompt_fmt} (${model_prompt_cost:.4f}){C_RESET}'
					completion_part = f'{C_GREEN}{model_completion_fmt} (${model_completion_cost:.4f}){C_RESET}'
				else:
					cost_part = ''
					prompt_part = f'{C_YELLOW}{model_prompt_fmt}{C_RESET}'
					completion_part = f'{C_GREEN}{model_completion_fmt}{C_RESET}'
			else:
				cost_part = ''
				prompt_part = f'{C_YELLOW}{model_prompt_fmt}{C_RESET}'
				completion_part = f'{C_GREEN}{model_completion_fmt}{C_RESET}'

			cost_logger.debug(
				f'  🤖 {C_CYAN}{model}{C_RESET}: {C_BLUE}{model_total_fmt} tokens{C_RESET}{cost_part} | '
				f'⬅️ {prompt_part} | ➡️ {completion_part} | '
				f'📞 {stats.invocations} calls | 📈 {avg_tokens_fmt}/call'
			)

	async def get_cost_by_model(self) -> dict[str, ModelUsageStats]:
		"""Get cost breakdown by model"""
		summary = await self.get_usage_summary()
		return summary.by_model

	def clear_history(self) -> None:
		"""Clear usage history"""
		self.usage_history = []

	async def refresh_pricing_data(self) -> None:
		"""Force refresh of pricing data from GitHub"""
		if self.include_cost:
			await self._fetch_and_cache_pricing_data()

	async def clean_old_caches(self, keep_count: int = 3) -> None:
		"""Clean up old cache files, keeping only the most recent ones"""
		try:
			# List all JSON files in the cache directory
			cache_files = list(self._cache_dir.glob('*.json'))

			if len(cache_files) <= keep_count:
				return

			# Sort by modification time (oldest first)
			cache_files.sort(key=lambda f: f.stat().st_mtime)

			# Remove all but the most recent files
			for cache_file in cache_files[:-keep_count]:
				try:
					os.remove(cache_file)
				except Exception:
					pass
		except Exception as e:
			logger.debug(f'Error cleaning old cache files: {e}')

	async def ensure_pricing_loaded(self) -> None:
		"""Ensure pricing data is loaded in the background. Call this after creating the service."""
		if not self._initialized and self.include_cost:
			# This will run in the background and won't block
			await self.initialize()

```

---

## backend/browser-use/browser_use/tokens/tests/test_cost.py

```py
"""
Simple test for token cost tracking with real LLM calls.

Tests ChatOpenAI and ChatGoogle by iteratively generating countries.
"""

import asyncio
import logging

from browser_use.llm import ChatGoogle, ChatOpenAI
from browser_use.llm.messages import AssistantMessage, SystemMessage, UserMessage
from browser_use.tokens.service import TokenCost

# Optional OCI import
try:
	from examples.models.oci_models import meta_llm

	OCI_MODELS_AVAILABLE = True
except ImportError:
	meta_llm = None
	OCI_MODELS_AVAILABLE = False


logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def get_oci_model_if_available():
	"""Create OCI model for testing if credentials are available."""
	if not OCI_MODELS_AVAILABLE:
		return None

	# Try to create OCI model with mock/test configuration
	# These values should be replaced with real ones if testing with actual OCI
	try:
		# get any of the llm xai_llm or cohere_llm
		return meta_llm

	except Exception as e:
		logger.info(f'OCI model not available for testing: {e}')
		return None


async def test_iterative_country_generation():
	"""Test token cost tracking with iterative country generation"""

	# Initialize token cost service
	tc = TokenCost(include_cost=True)

	# System prompt that explains the iterative task
	system_prompt = """You are a country name generator. When asked, you will provide exactly ONE country name and nothing else.
Each time you're asked to continue, provide the next country name that hasn't been mentioned yet.
Keep track of which countries you've already said and don't repeat them.
Only output the country name, no numbers, no punctuation, just the name."""

	# Test with different models
	models = []
	models.append(ChatOpenAI(model='gpt-4.1'))  # Commented out - requires OPENAI_API_KEY
	models.append(ChatGoogle(model='gemini-2.0-flash-exp'))

	# Add OCI model if available
	oci_model = get_oci_model_if_available()
	if oci_model:
		models.append(oci_model)
		print(f'✅ OCI model added to test: {oci_model.name}')
	else:
		print('ℹ️  OCI model not available (install with pip install browser-use[oci] and configure credentials)')

	print('\n🌍 Iterative Country Generation Test')
	print('=' * 80)

	for llm in models:
		print(f'\n📍 Testing {llm.model}')
		print('-' * 60)

		# Register the LLM for automatic tracking
		tc.register_llm(llm)

		# Initialize conversation
		messages = [SystemMessage(content=system_prompt), UserMessage(content='Give me a country name')]

		countries = []

		# Generate 10 countries iteratively
		for i in range(10):
			# Call the LLM
			result = await llm.ainvoke(messages)
			country = result.completion.strip()
			countries.append(country)

			# Add the response to messages
			messages.append(AssistantMessage(content=country))

			# Add the next request (except for the last iteration)
			if i < 9:
				messages.append(UserMessage(content='Next country please'))

			print(f'  Country {i + 1}: {country}')

		print(f'\n  Generated countries: {", ".join(countries)}')

	# Display cost summary
	print('\n💰 Cost Summary')
	print('=' * 80)

	summary = await tc.get_usage_summary()
	print(f'Total calls: {summary.entry_count}')
	print(f'Total tokens: {summary.total_tokens:,}')
	print(f'Total cost: ${summary.total_cost:.6f}')

	expected_cost = 0
	expected_invocations = 0

	print('\n📊 Cost breakdown by model:')
	for model, stats in summary.by_model.items():
		expected_cost += stats.cost
		expected_invocations += stats.invocations

		print(f'\n{model}:')
		print(f'  Calls: {stats.invocations}')
		print(f'  Prompt tokens: {stats.prompt_tokens:,}')
		print(f'  Completion tokens: {stats.completion_tokens:,}')
		print(f'  Total tokens: {stats.total_tokens:,}')
		print(f'  Cost: ${stats.cost:.6f}')
		print(f'  Average tokens per call: {stats.average_tokens_per_invocation:.1f}')

	assert summary.entry_count == expected_invocations, f'Expected {expected_invocations} invocations, got {summary.entry_count}'
	assert abs(summary.total_cost - expected_cost) < 1e-6, (
		f'Expected total cost ${expected_cost:.6f}, got ${summary.total_cost:.6f}'
	)


if __name__ == '__main__':
	# Run the test
	asyncio.run(test_iterative_country_generation())

```

---

## backend/browser-use/browser_use/tokens/views.py

```py
from datetime import datetime
from typing import Any, TypeVar

from pydantic import BaseModel, Field

from browser_use.llm.views import ChatInvokeUsage

T = TypeVar('T', bound=BaseModel)


class TokenUsageEntry(BaseModel):
	"""Single token usage entry"""

	model: str
	timestamp: datetime
	usage: ChatInvokeUsage


class TokenCostCalculated(BaseModel):
	"""Token cost"""

	new_prompt_tokens: int
	new_prompt_cost: float

	prompt_read_cached_tokens: int | None
	prompt_read_cached_cost: float | None

	prompt_cached_creation_tokens: int | None
	prompt_cache_creation_cost: float | None
	"""Anthropic only: The cost of creating the cache."""

	completion_tokens: int
	completion_cost: float

	@property
	def prompt_cost(self) -> float:
		return self.new_prompt_cost + (self.prompt_read_cached_cost or 0) + (self.prompt_cache_creation_cost or 0)

	@property
	def total_cost(self) -> float:
		return (
			self.new_prompt_cost
			+ (self.prompt_read_cached_cost or 0)
			+ (self.prompt_cache_creation_cost or 0)
			+ self.completion_cost
		)


class ModelPricing(BaseModel):
	"""Pricing information for a model"""

	model: str
	input_cost_per_token: float | None
	output_cost_per_token: float | None

	cache_read_input_token_cost: float | None
	cache_creation_input_token_cost: float | None

	max_tokens: int | None
	max_input_tokens: int | None
	max_output_tokens: int | None


class CachedPricingData(BaseModel):
	"""Cached pricing data with timestamp"""

	timestamp: datetime
	data: dict[str, Any]


class ModelUsageStats(BaseModel):
	"""Usage statistics for a single model"""

	model: str
	prompt_tokens: int = 0
	completion_tokens: int = 0
	total_tokens: int = 0
	cost: float = 0.0
	invocations: int = 0
	average_tokens_per_invocation: float = 0.0


class ModelUsageTokens(BaseModel):
	"""Usage tokens for a single model"""

	model: str
	prompt_tokens: int
	prompt_cached_tokens: int
	completion_tokens: int
	total_tokens: int


class UsageSummary(BaseModel):
	"""Summary of token usage and costs"""

	total_prompt_tokens: int
	total_prompt_cost: float

	total_prompt_cached_tokens: int
	total_prompt_cached_cost: float

	total_completion_tokens: int
	total_completion_cost: float
	total_tokens: int
	total_cost: float
	entry_count: int

	by_model: dict[str, ModelUsageStats] = Field(default_factory=dict)

```

---

## backend/browser-use/browser_use/tools/registry/service.py

```py
import asyncio
import functools
import inspect
import logging
import re
from collections.abc import Callable
from inspect import Parameter, iscoroutinefunction, signature
from types import UnionType
from typing import Any, Generic, Optional, TypeVar, Union, get_args, get_origin

import pyotp
from pydantic import BaseModel, Field, RootModel, create_model

from browser_use.browser import BrowserSession
from browser_use.filesystem.file_system import FileSystem
from browser_use.llm.base import BaseChatModel
from browser_use.observability import observe_debug
from browser_use.telemetry.service import ProductTelemetry
from browser_use.tools.registry.views import (
	ActionModel,
	ActionRegistry,
	RegisteredAction,
	SpecialActionParameters,
)
from browser_use.utils import is_new_tab_page, match_url_with_domain_pattern, time_execution_async

Context = TypeVar('Context')

logger = logging.getLogger(__name__)


class Registry(Generic[Context]):
	"""Service for registering and managing actions"""

	def __init__(self, exclude_actions: list[str] | None = None):
		self.registry = ActionRegistry()
		self.telemetry = ProductTelemetry()
		# Create a new list to avoid mutable default argument issues
		self.exclude_actions = list(exclude_actions) if exclude_actions is not None else []

	def exclude_action(self, action_name: str) -> None:
		"""Exclude an action from the registry after initialization.

		If the action is already registered, it will be removed from the registry.
		The action is also added to the exclude_actions list to prevent re-registration.
		"""
		# Add to exclude list to prevent future registration
		if action_name not in self.exclude_actions:
			self.exclude_actions.append(action_name)

		# Remove from registry if already registered
		if action_name in self.registry.actions:
			del self.registry.actions[action_name]
			logger.debug(f'Excluded action "{action_name}" from registry')

	def _get_special_param_types(self) -> dict[str, type | UnionType | None]:
		"""Get the expected types for special parameters from SpecialActionParameters"""
		# Manually define the expected types to avoid issues with Optional handling.
		# we should try to reduce this list to 0 if possible, give as few standardized objects to all the actions
		# but each driver should decide what is relevant to expose the action methods,
		# e.g. CDP client, 2fa code getters, sensitive_data wrappers, other context, etc.
		return {
			'context': None,  # Context is a TypeVar, so we can't validate type
			'browser_session': BrowserSession,
			'page_url': str,
			'cdp_client': None,  # CDPClient type from cdp_use, but we don't import it here
			'page_extraction_llm': BaseChatModel,
			'available_file_paths': list,
			'has_sensitive_data': bool,
			'file_system': FileSystem,
		}

	def _normalize_action_function_signature(
		self,
		func: Callable,
		description: str,
		param_model: type[BaseModel] | None = None,
	) -> tuple[Callable, type[BaseModel]]:
		"""
		Normalize action function to accept only kwargs.

		Returns:
			- Normalized function that accepts (*_, params: ParamModel, **special_params)
			- The param model to use for registration
		"""
		sig = signature(func)
		parameters = list(sig.parameters.values())
		special_param_types = self._get_special_param_types()
		special_param_names = set(special_param_types.keys())

		# Step 1: Validate no **kwargs in original function signature
		# if it needs default values it must use a dedicated param_model: BaseModel instead
		for param in parameters:
			if param.kind == Parameter.VAR_KEYWORD:
				raise ValueError(
					f"Action '{func.__name__}' has **{param.name} which is not allowed. "
					f'Actions must have explicit positional parameters only.'
				)

		# Step 2: Separate special and action parameters
		action_params = []
		special_params = []
		param_model_provided = param_model is not None

		for i, param in enumerate(parameters):
			# Check if this is a Type 1 pattern (first param is BaseModel)
			if i == 0 and param_model_provided and param.name not in special_param_names:
				# This is Type 1 pattern - skip the params argument
				continue

			if param.name in special_param_names:
				# Validate special parameter type
				expected_type = special_param_types.get(param.name)
				if param.annotation != Parameter.empty and expected_type is not None:
					# Handle Optional types - normalize both sides
					param_type = param.annotation
					origin = get_origin(param_type)
					if origin is Union:
						args = get_args(param_type)
						# Find non-None type
						param_type = next((arg for arg in args if arg is not type(None)), param_type)

					# Check if types are compatible (exact match, subclass, or generic list)
					types_compatible = (
						param_type == expected_type
						or (
							inspect.isclass(param_type)
							and inspect.isclass(expected_type)
							and issubclass(param_type, expected_type)
						)
						or
						# Handle list[T] vs list comparison
						(expected_type is list and (param_type is list or get_origin(param_type) is list))
					)

					if not types_compatible:
						expected_type_name = getattr(expected_type, '__name__', str(expected_type))
						param_type_name = getattr(param_type, '__name__', str(param_type))
						raise ValueError(
							f"Action '{func.__name__}' parameter '{param.name}: {param_type_name}' "
							f"conflicts with special argument injected by tools: '{param.name}: {expected_type_name}'"
						)
				special_params.append(param)
			else:
				action_params.append(param)

		# Step 3: Create or validate param model
		if not param_model_provided:
			# Type 2: Generate param model from action params
			if action_params:
				params_dict = {}
				for param in action_params:
					annotation = param.annotation if param.annotation != Parameter.empty else str
					default = ... if param.default == Parameter.empty else param.default
					params_dict[param.name] = (annotation, default)

				param_model = create_model(f'{func.__name__}_Params', __base__=ActionModel, **params_dict)
			else:
				# No action params, create empty model
				param_model = create_model(
					f'{func.__name__}_Params',
					__base__=ActionModel,
				)
		assert param_model is not None, f'param_model is None for {func.__name__}'

		# Step 4: Create normalized wrapper function
		@functools.wraps(func)
		async def normalized_wrapper(*args, params: BaseModel | None = None, **kwargs):
			"""Normalized action that only accepts kwargs"""
			# Validate no positional args
			if args:
				raise TypeError(f'{func.__name__}() does not accept positional arguments, only keyword arguments are allowed')

			# Prepare arguments for original function
			call_args = []
			call_kwargs = {}

			# Handle Type 1 pattern (first arg is the param model)
			if param_model_provided and parameters and parameters[0].name not in special_param_names:
				if params is None:
					raise ValueError(f"{func.__name__}() missing required 'params' argument")
				# For Type 1, we'll use the params object as first argument
				pass
			else:
				# Type 2 pattern - need to unpack params
				# If params is None, try to create it from kwargs
				if params is None and action_params:
					# Extract action params from kwargs
					action_kwargs = {}
					for param in action_params:
						if param.name in kwargs:
							action_kwargs[param.name] = kwargs[param.name]
					if action_kwargs:
						# Use the param_model which has the correct types defined
						params = param_model(**action_kwargs)

			# Build call_args by iterating through original function parameters in order
			params_dict = params.model_dump() if params is not None else {}

			for i, param in enumerate(parameters):
				# Skip first param for Type 1 pattern (it's the model itself)
				if param_model_provided and i == 0 and param.name not in special_param_names:
					call_args.append(params)
				elif param.name in special_param_names:
					# This is a special parameter
					if param.name in kwargs:
						value = kwargs[param.name]
						# Check if required special param is None
						if value is None and param.default == Parameter.empty:
							if param.name == 'browser_session':
								raise ValueError(f'Action {func.__name__} requires browser_session but none provided.')
							elif param.name == 'page_extraction_llm':
								raise ValueError(f'Action {func.__name__} requires page_extraction_llm but none provided.')
							elif param.name == 'file_system':
								raise ValueError(f'Action {func.__name__} requires file_system but none provided.')
							elif param.name == 'page':
								raise ValueError(f'Action {func.__name__} requires page but none provided.')
							elif param.name == 'available_file_paths':
								raise ValueError(f'Action {func.__name__} requires available_file_paths but none provided.')
							elif param.name == 'file_system':
								raise ValueError(f'Action {func.__name__} requires file_system but none provided.')
							else:
								raise ValueError(f"{func.__name__}() missing required special parameter '{param.name}'")
						call_args.append(value)
					elif param.default != Parameter.empty:
						call_args.append(param.default)
					else:
						# Special param is required but not provided
						if param.name == 'browser_session':
							raise ValueError(f'Action {func.__name__} requires browser_session but none provided.')
						elif param.name == 'page_extraction_llm':
							raise ValueError(f'Action {func.__name__} requires page_extraction_llm but none provided.')
						elif param.name == 'file_system':
							raise ValueError(f'Action {func.__name__} requires file_system but none provided.')
						elif param.name == 'page':
							raise ValueError(f'Action {func.__name__} requires page but none provided.')
						elif param.name == 'available_file_paths':
							raise ValueError(f'Action {func.__name__} requires available_file_paths but none provided.')
						elif param.name == 'file_system':
							raise ValueError(f'Action {func.__name__} requires file_system but none provided.')
						else:
							raise ValueError(f"{func.__name__}() missing required special parameter '{param.name}'")
				else:
					# This is an action parameter
					if param.name in params_dict:
						call_args.append(params_dict[param.name])
					elif param.default != Parameter.empty:
						call_args.append(param.default)
					else:
						raise ValueError(f"{func.__name__}() missing required parameter '{param.name}'")

			# Call original function with positional args
			if iscoroutinefunction(func):
				return await func(*call_args)
			else:
				return await asyncio.to_thread(func, *call_args)

		# Update wrapper signature to be kwargs-only
		new_params = [Parameter('params', Parameter.KEYWORD_ONLY, default=None, annotation=Optional[param_model])]

		# Add special params as keyword-only
		for sp in special_params:
			new_params.append(Parameter(sp.name, Parameter.KEYWORD_ONLY, default=sp.default, annotation=sp.annotation))

		# Add **kwargs to accept and ignore extra params
		new_params.append(Parameter('kwargs', Parameter.VAR_KEYWORD))

		normalized_wrapper.__signature__ = sig.replace(parameters=new_params)  # type: ignore[attr-defined]

		return normalized_wrapper, param_model

	# @time_execution_sync('--create_param_model')
	def _create_param_model(self, function: Callable) -> type[BaseModel]:
		"""Creates a Pydantic model from function signature"""
		sig = signature(function)
		special_param_names = set(SpecialActionParameters.model_fields.keys())
		params = {
			name: (param.annotation, ... if param.default == param.empty else param.default)
			for name, param in sig.parameters.items()
			if name not in special_param_names
		}
		# TODO: make the types here work
		return create_model(
			f'{function.__name__}_parameters',
			__base__=ActionModel,
			**params,  # type: ignore
		)

	def action(
		self,
		description: str,
		param_model: type[BaseModel] | None = None,
		domains: list[str] | None = None,
		allowed_domains: list[str] | None = None,
	):
		"""Decorator for registering actions"""
		# Handle aliases: domains and allowed_domains are the same parameter
		if allowed_domains is not None and domains is not None:
			raise ValueError("Cannot specify both 'domains' and 'allowed_domains' - they are aliases for the same parameter")

		final_domains = allowed_domains if allowed_domains is not None else domains

		def decorator(func: Callable):
			# Skip registration if action is in exclude_actions
			if func.__name__ in self.exclude_actions:
				return func

			# Normalize the function signature
			normalized_func, actual_param_model = self._normalize_action_function_signature(func, description, param_model)

			action = RegisteredAction(
				name=func.__name__,
				description=description,
				function=normalized_func,
				param_model=actual_param_model,
				domains=final_domains,
			)
			self.registry.actions[func.__name__] = action

			# Return the normalized function so it can be called with kwargs
			return normalized_func

		return decorator

	@observe_debug(ignore_input=True, ignore_output=True, name='execute_action')
	@time_execution_async('--execute_action')
	async def execute_action(
		self,
		action_name: str,
		params: dict,
		browser_session: BrowserSession | None = None,
		page_extraction_llm: BaseChatModel | None = None,
		file_system: FileSystem | None = None,
		sensitive_data: dict[str, str | dict[str, str]] | None = None,
		available_file_paths: list[str] | None = None,
	) -> Any:
		"""Execute a registered action with simplified parameter handling"""
		if action_name not in self.registry.actions:
			raise ValueError(f'Action {action_name} not found')

		action = self.registry.actions[action_name]
		try:
			# Create the validated Pydantic model
			try:
				validated_params = action.param_model(**params)
			except Exception as e:
				raise ValueError(f'Invalid parameters {params} for action {action_name}: {type(e)}: {e}') from e

			if sensitive_data:
				# Get current URL if browser_session is provided
				current_url = None
				if browser_session and browser_session.agent_focus_target_id:
					try:
						# Get current page info from session_manager
						target = browser_session.session_manager.get_target(browser_session.agent_focus_target_id)
						if target:
							current_url = target.url
					except Exception:
						pass
				validated_params = self._replace_sensitive_data(validated_params, sensitive_data, current_url)

			# Build special context dict
			special_context = {
				'browser_session': browser_session,
				'page_extraction_llm': page_extraction_llm,
				'available_file_paths': available_file_paths,
				'has_sensitive_data': action_name == 'input' and bool(sensitive_data),
				'file_system': file_system,
			}

			# Only pass sensitive_data to actions that explicitly need it (input)
			if action_name == 'input':
				special_context['sensitive_data'] = sensitive_data

			# Add CDP-related parameters if browser_session is available
			if browser_session:
				# Add page_url
				try:
					special_context['page_url'] = await browser_session.get_current_page_url()
				except Exception:
					special_context['page_url'] = None

				# Add cdp_client
				special_context['cdp_client'] = browser_session.cdp_client

			# All functions are now normalized to accept kwargs only
			# Call with params and unpacked special context
			try:
				return await action.function(params=validated_params, **special_context)
			except Exception as e:
				raise

		except ValueError as e:
			# Preserve ValueError messages from validation
			if 'requires browser_session but none provided' in str(e) or 'requires page_extraction_llm but none provided' in str(
				e
			):
				raise RuntimeError(str(e)) from e
			else:
				raise RuntimeError(f'Error executing action {action_name}: {str(e)}') from e
		except TimeoutError as e:
			raise RuntimeError(f'Error executing action {action_name} due to timeout.') from e
		except Exception as e:
			raise RuntimeError(f'Error executing action {action_name}: {str(e)}') from e

	def _log_sensitive_data_usage(self, placeholders_used: set[str], current_url: str | None) -> None:
		"""Log when sensitive data is being used on a page"""
		if placeholders_used:
			url_info = f' on {current_url}' if current_url and not is_new_tab_page(current_url) else ''
			logger.info(f'🔒 Using sensitive data placeholders: {", ".join(sorted(placeholders_used))}{url_info}')

	def _replace_sensitive_data(
		self, params: BaseModel, sensitive_data: dict[str, Any], current_url: str | None = None
	) -> BaseModel:
		"""
		Replaces sensitive data placeholders in params with actual values.

		Args:
			params: The parameter object containing <secret>placeholder</secret> tags
			sensitive_data: Dictionary of sensitive data, either in old format {key: value}
						   or new format {domain_pattern: {key: value}}
			current_url: Optional current URL for domain matching

		Returns:
			BaseModel: The parameter object with placeholders replaced by actual values
		"""
		secret_pattern = re.compile(r'<secret>(.*?)</secret>')

		# Set to track all missing placeholders across the full object
		all_missing_placeholders = set()
		# Set to track successfully replaced placeholders
		replaced_placeholders = set()

		# Process sensitive data based on format and current URL
		applicable_secrets = {}

		for domain_or_key, content in sensitive_data.items():
			if isinstance(content, dict):
				# New format: {domain_pattern: {key: value}}
				# Only include secrets for domains that match the current URL
				if current_url and not is_new_tab_page(current_url):
					# it's a real url, check it using our custom allowed_domains scheme://*.example.com glob matching
					if match_url_with_domain_pattern(current_url, domain_or_key):
						applicable_secrets.update(content)
			else:
				# Old format: {key: value}, expose to all domains (only allowed for legacy reasons)
				applicable_secrets[domain_or_key] = content

		# Filter out empty values
		applicable_secrets = {k: v for k, v in applicable_secrets.items() if v}

		def recursively_replace_secrets(value: str | dict | list) -> str | dict | list:
			if isinstance(value, str):
				matches = secret_pattern.findall(value)
				# check if the placeholder key, like x_password is in the output parameters of the LLM and replace it with the sensitive data
				for placeholder in matches:
					if placeholder in applicable_secrets:
						# generate a totp code if secret is a 2fa secret
						if 'bu_2fa_code' in placeholder:
							totp = pyotp.TOTP(applicable_secrets[placeholder], digits=6)
							replacement_value = totp.now()
						else:
							replacement_value = applicable_secrets[placeholder]

						value = value.replace(f'<secret>{placeholder}</secret>', replacement_value)
						replaced_placeholders.add(placeholder)
					else:
						# Keep track of missing placeholders
						all_missing_placeholders.add(placeholder)
						# Don't replace the tag, keep it as is

				return value
			elif isinstance(value, dict):
				return {k: recursively_replace_secrets(v) for k, v in value.items()}
			elif isinstance(value, list):
				return [recursively_replace_secrets(v) for v in value]
			return value

		params_dump = params.model_dump()
		processed_params = recursively_replace_secrets(params_dump)

		# Log sensitive data usage
		self._log_sensitive_data_usage(replaced_placeholders, current_url)

		# Log a warning if any placeholders are missing
		if all_missing_placeholders:
			logger.warning(f'Missing or empty keys in sensitive_data dictionary: {", ".join(all_missing_placeholders)}')

		return type(params).model_validate(processed_params)

	# @time_execution_sync('--create_action_model')
	def create_action_model(self, include_actions: list[str] | None = None, page_url: str | None = None) -> type[ActionModel]:
		"""Creates a Union of individual action models from registered actions,
		used by LLM APIs that support tool calling & enforce a schema.

		Each action model contains only the specific action being used,
		rather than all actions with most set to None.
		"""
		from typing import Union

		# Filter actions based on page_url if provided:
		#   if page_url is None, only include actions with no filters
		#   if page_url is provided, only include actions that match the URL

		available_actions: dict[str, RegisteredAction] = {}
		for name, action in self.registry.actions.items():
			if include_actions is not None and name not in include_actions:
				continue

			# If no page_url provided, only include actions with no filters
			if page_url is None:
				if action.domains is None:
					available_actions[name] = action
				continue

			# Check domain filter if present
			domain_is_allowed = self.registry._match_domains(action.domains, page_url)

			# Include action if domain filter matches
			if domain_is_allowed:
				available_actions[name] = action

		# Create individual action models for each action
		individual_action_models: list[type[BaseModel]] = []

		for name, action in available_actions.items():
			# Create an individual model for each action that contains only one field
			individual_model = create_model(
				f'{name.title().replace("_", "")}ActionModel',
				__base__=ActionModel,
				**{
					name: (
						action.param_model,
						Field(description=action.description),
					)  # type: ignore
				},
			)
			individual_action_models.append(individual_model)

		# If no actions available, return empty ActionModel
		if not individual_action_models:
			return create_model('EmptyActionModel', __base__=ActionModel)

		# Create proper Union type that maintains ActionModel interface
		if len(individual_action_models) == 1:
			# If only one action, return it directly (no Union needed)
			result_model = individual_action_models[0]

		# Meaning the length is more than 1
		else:
			# Create a Union type using RootModel that properly delegates ActionModel methods
			union_type = Union[tuple(individual_action_models)]  # type: ignore : Typing doesn't understand that the length is >= 2 (by design)

			class ActionModelUnion(RootModel[union_type]):  # type: ignore
				def get_index(self) -> int | None:
					"""Delegate get_index to the underlying action model"""
					if hasattr(self.root, 'get_index'):
						return self.root.get_index()  # type: ignore
					return None

				def set_index(self, index: int):
					"""Delegate set_index to the underlying action model"""
					if hasattr(self.root, 'set_index'):
						self.root.set_index(index)  # type: ignore

				def model_dump(self, **kwargs):
					"""Delegate model_dump to the underlying action model"""
					if hasattr(self.root, 'model_dump'):
						return self.root.model_dump(**kwargs)  # type: ignore
					return super().model_dump(**kwargs)

			# Set the name for better debugging
			ActionModelUnion.__name__ = 'ActionModel'
			ActionModelUnion.__qualname__ = 'ActionModel'

			result_model = ActionModelUnion

		return result_model  # type:ignore

	def get_prompt_description(self, page_url: str | None = None) -> str:
		"""Get a description of all actions for the prompt

		If page_url is provided, only include actions that are available for that URL
		based on their domain filters
		"""
		return self.registry.get_prompt_description(page_url=page_url)

```

---

## backend/browser-use/browser_use/tools/registry/views.py

```py
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, ConfigDict

from browser_use.browser import BrowserSession
from browser_use.filesystem.file_system import FileSystem
from browser_use.llm.base import BaseChatModel

if TYPE_CHECKING:
	pass


class RegisteredAction(BaseModel):
	"""Model for a registered action"""

	name: str
	description: str
	function: Callable
	param_model: type[BaseModel]

	# filters: provide specific domains to determine whether the action should be available on the given URL or not
	domains: list[str] | None = None  # e.g. ['*.google.com', 'www.bing.com', 'yahoo.*]

	model_config = ConfigDict(arbitrary_types_allowed=True)

	def prompt_description(self) -> str:
		"""Get a description of the action for the prompt in unstructured format"""
		schema = self.param_model.model_json_schema()
		params = []

		if 'properties' in schema:
			for param_name, param_info in schema['properties'].items():
				# Build parameter description
				param_desc = param_name

				# Add type information if available
				if 'type' in param_info:
					param_type = param_info['type']
					param_desc += f'={param_type}'

				# Add description as comment if available
				if 'description' in param_info:
					param_desc += f' ({param_info["description"]})'

				params.append(param_desc)

		# Format: action_name: Description. (param1=type, param2=type, ...)
		if params:
			return f'{self.name}: {self.description}. ({", ".join(params)})'
		else:
			return f'{self.name}: {self.description}'


class ActionModel(BaseModel):
	"""Base model for dynamically created action models"""

	# this will have all the registered actions, e.g.
	# click_element = param_model = ClickElementParams
	# done = param_model = None
	#
	model_config = ConfigDict(arbitrary_types_allowed=True, extra='forbid')

	def get_index(self) -> int | None:
		"""Get the index of the action"""
		# {'clicked_element': {'index':5}}
		params = self.model_dump(exclude_unset=True).values()
		if not params:
			return None
		for param in params:
			if param is not None and 'index' in param:
				return param['index']
		return None

	def set_index(self, index: int):
		"""Overwrite the index of the action"""
		# Get the action name and params
		action_data = self.model_dump(exclude_unset=True)
		action_name = next(iter(action_data.keys()))
		action_params = getattr(self, action_name)

		# Update the index directly on the model
		if hasattr(action_params, 'index'):
			action_params.index = index


class ActionRegistry(BaseModel):
	"""Model representing the action registry"""

	actions: dict[str, RegisteredAction] = {}

	@staticmethod
	def _match_domains(domains: list[str] | None, url: str) -> bool:
		"""
		Match a list of domain glob patterns against a URL.

		Args:
			domains: A list of domain patterns that can include glob patterns (* wildcard)
			url: The URL to match against

		Returns:
			True if the URL's domain matches the pattern, False otherwise
		"""

		if domains is None or not url:
			return True

		# Use the centralized URL matching logic from utils
		from browser_use.utils import match_url_with_domain_pattern

		for domain_pattern in domains:
			if match_url_with_domain_pattern(url, domain_pattern):
				return True
		return False

	def get_prompt_description(self, page_url: str | None = None) -> str:
		"""Get a description of all actions for the prompt

		Args:
			page_url: If provided, filter actions by URL using domain filters.

		Returns:
			A string description of available actions.
			- If page is None: return only actions with no page_filter and no domains (for system prompt)
			- If page is provided: return only filtered actions that match the current page (excluding unfiltered actions)
		"""
		if page_url is None:
			# For system prompt (no URL provided), include only actions with no filters
			return '\n'.join(action.prompt_description() for action in self.actions.values() if action.domains is None)

		# only include filtered actions for the current page URL
		filtered_actions = []
		for action in self.actions.values():
			if not action.domains:
				# skip actions with no filters, they are already included in the system prompt
				continue

			# Check domain filter
			if self._match_domains(action.domains, page_url):
				filtered_actions.append(action)

		return '\n'.join(action.prompt_description() for action in filtered_actions)


class SpecialActionParameters(BaseModel):
	"""Model defining all special parameters that can be injected into actions"""

	model_config = ConfigDict(arbitrary_types_allowed=True)

	# optional user-provided context object passed down from Agent(context=...)
	# e.g. can contain anything, external db connections, file handles, queues, runtime config objects, etc.
	# that you might want to be able to access quickly from within many of your actions
	# browser-use code doesn't use this at all, we just pass it down to your actions for convenience
	context: Any | None = None

	# browser-use session object, can be used to create new tabs, navigate, access CDP
	browser_session: BrowserSession | None = None

	# Current page URL for filtering and context
	page_url: str | None = None

	# CDP client for direct Chrome DevTools Protocol access
	cdp_client: Any | None = None  # CDPClient type from cdp_use

	# extra injected config if the action asks for these arg names
	page_extraction_llm: BaseChatModel | None = None
	file_system: FileSystem | None = None
	available_file_paths: list[str] | None = None
	has_sensitive_data: bool = False

	@classmethod
	def get_browser_requiring_params(cls) -> set[str]:
		"""Get parameter names that require browser_session"""
		return {'browser_session', 'cdp_client', 'page_url'}

```

---

## backend/browser-use/browser_use/tools/service.py

```py
import asyncio
import json
import logging
import os
from typing import Generic, TypeVar

try:
	from lmnr import Laminar  # type: ignore
except ImportError:
	Laminar = None  # type: ignore
from pydantic import BaseModel

from browser_use.agent.views import ActionModel, ActionResult
from browser_use.browser import BrowserSession
from browser_use.browser.events import (
	ClickCoordinateEvent,
	ClickElementEvent,
	CloseTabEvent,
	GetDropdownOptionsEvent,
	GoBackEvent,
	NavigateToUrlEvent,
	ScrollEvent,
	ScrollToTextEvent,
	SendKeysEvent,
	SwitchTabEvent,
	TypeTextEvent,
	UploadFileEvent,
)
from browser_use.browser.views import BrowserError
from browser_use.dom.service import EnhancedDOMTreeNode
from browser_use.filesystem.file_system import FileSystem
from browser_use.llm.base import BaseChatModel
from browser_use.llm.messages import SystemMessage, UserMessage
from browser_use.observability import observe_debug
from browser_use.tools.registry.service import Registry
from browser_use.tools.utils import get_click_description
from browser_use.tools.views import (
	ClickElementAction,
	CloseTabAction,
	DoneAction,
	ExtractAction,
	GetDropdownOptionsAction,
	InputTextAction,
	NavigateAction,
	NoParamsAction,
	ScrollAction,
	SearchAction,
	SelectDropdownOptionAction,
	SendKeysAction,
	StructuredOutputAction,
	SwitchTabAction,
	UploadFileAction,
)
from browser_use.utils import create_task_with_error_handling, sanitize_surrogates, time_execution_sync

logger = logging.getLogger(__name__)

# Import EnhancedDOMTreeNode and rebuild event models that have forward references to it
# This must be done after all imports are complete
ClickElementEvent.model_rebuild()
TypeTextEvent.model_rebuild()
ScrollEvent.model_rebuild()
UploadFileEvent.model_rebuild()

Context = TypeVar('Context')

T = TypeVar('T', bound=BaseModel)


def _detect_sensitive_key_name(text: str, sensitive_data: dict[str, str | dict[str, str]] | None) -> str | None:
	"""Detect which sensitive key name corresponds to the given text value."""
	if not sensitive_data or not text:
		return None

	# Collect all sensitive values and their keys
	for domain_or_key, content in sensitive_data.items():
		if isinstance(content, dict):
			# New format: {domain: {key: value}}
			for key, value in content.items():
				if value and value == text:
					return key
		elif content:  # Old format: {key: value}
			if content == text:
				return domain_or_key

	return None


def handle_browser_error(e: BrowserError) -> ActionResult:
	if e.long_term_memory is not None:
		if e.short_term_memory is not None:
			return ActionResult(
				extracted_content=e.short_term_memory, error=e.long_term_memory, include_extracted_content_only_once=True
			)
		else:
			return ActionResult(error=e.long_term_memory)
	# Fallback to original error handling if long_term_memory is None
	logger.warning(
		'⚠️ A BrowserError was raised without long_term_memory - always set long_term_memory when raising BrowserError to propagate right messages to LLM.'
	)
	raise e


class Tools(Generic[Context]):
	def __init__(
		self,
		exclude_actions: list[str] | None = None,
		output_model: type[T] | None = None,
		display_files_in_done_text: bool = True,
	):
		self.registry = Registry[Context](exclude_actions if exclude_actions is not None else [])
		self.display_files_in_done_text = display_files_in_done_text

		"""Register all default browser actions"""

		self._register_done_action(output_model)

		# Basic Navigation Actions
		@self.registry.action(
			'',
			param_model=SearchAction,
		)
		async def search(params: SearchAction, browser_session: BrowserSession):
			import urllib.parse

			# Encode query for URL safety
			encoded_query = urllib.parse.quote_plus(params.query)

			# Build search URL based on search engine
			search_engines = {
				'duckduckgo': f'https://duckduckgo.com/?q={encoded_query}',
				'google': f'https://www.google.com/search?q={encoded_query}&udm=14',
				'bing': f'https://www.bing.com/search?q={encoded_query}',
			}

			if params.engine.lower() not in search_engines:
				return ActionResult(error=f'Unsupported search engine: {params.engine}. Options: duckduckgo, google, bing')

			search_url = search_engines[params.engine.lower()]

			# Simple tab logic: use current tab by default
			use_new_tab = False

			# Dispatch navigation event
			try:
				event = browser_session.event_bus.dispatch(
					NavigateToUrlEvent(
						url=search_url,
						new_tab=use_new_tab,
					)
				)
				await event
				await event.event_result(raise_if_any=True, raise_if_none=False)
				memory = f"Searched {params.engine.title()} for '{params.query}'"
				msg = f'🔍  {memory}'
				logger.info(msg)
				return ActionResult(extracted_content=memory, long_term_memory=memory)
			except Exception as e:
				logger.error(f'Failed to search {params.engine}: {e}')
				return ActionResult(error=f'Failed to search {params.engine} for "{params.query}": {str(e)}')

		@self.registry.action(
			'',
			param_model=NavigateAction,
		)
		async def navigate(params: NavigateAction, browser_session: BrowserSession):
			try:
				# Dispatch navigation event
				event = browser_session.event_bus.dispatch(NavigateToUrlEvent(url=params.url, new_tab=params.new_tab))
				await event
				await event.event_result(raise_if_any=True, raise_if_none=False)

				if params.new_tab:
					memory = f'Opened new tab with URL {params.url}'
					msg = f'🔗  Opened new tab with url {params.url}'
				else:
					memory = f'Navigated to {params.url}'
					msg = f'🔗 {memory}'

				logger.info(msg)
				return ActionResult(extracted_content=msg, long_term_memory=memory)
			except Exception as e:
				error_msg = str(e)
				# Always log the actual error first for debugging
				browser_session.logger.error(f'❌ Navigation failed: {error_msg}')

				# Check if it's specifically a RuntimeError about CDP client
				if isinstance(e, RuntimeError) and 'CDP client not initialized' in error_msg:
					browser_session.logger.error('❌ Browser connection failed - CDP client not properly initialized')
					return ActionResult(error=f'Browser connection error: {error_msg}')
				# Check for network-related errors
				elif any(
					err in error_msg
					for err in [
						'ERR_NAME_NOT_RESOLVED',
						'ERR_INTERNET_DISCONNECTED',
						'ERR_CONNECTION_REFUSED',
						'ERR_TIMED_OUT',
						'net::',
					]
				):
					site_unavailable_msg = f'Navigation failed - site unavailable: {params.url}'
					browser_session.logger.warning(f'⚠️ {site_unavailable_msg} - {error_msg}')
					return ActionResult(error=site_unavailable_msg)
				else:
					# Return error in ActionResult instead of re-raising
					return ActionResult(error=f'Navigation failed: {str(e)}')

		@self.registry.action('Go back', param_model=NoParamsAction)
		async def go_back(_: NoParamsAction, browser_session: BrowserSession):
			try:
				event = browser_session.event_bus.dispatch(GoBackEvent())
				await event
				memory = 'Navigated back'
				msg = f'🔙  {memory}'
				logger.info(msg)
				return ActionResult(extracted_content=memory)
			except Exception as e:
				logger.error(f'Failed to dispatch GoBackEvent: {type(e).__name__}: {e}')
				error_msg = f'Failed to go back: {str(e)}'
				return ActionResult(error=error_msg)

		@self.registry.action('Wait for x seconds.')
		async def wait(seconds: int = 3):
			# Cap wait time at maximum 30 seconds
			# Reduce the wait time by 3 seconds to account for the llm call which takes at least 3 seconds
			# So if the model decides to wait for 5 seconds, the llm call took at least 3 seconds, so we only need to wait for 2 seconds
			# Note by Mert: the above doesnt make sense because we do the LLM call right after this or this could be followed by another action after which we would like to wait
			# so I revert this.
			actual_seconds = min(max(seconds - 1, 0), 30)
			memory = f'Waited for {seconds} seconds'
			logger.info(f'🕒 waited for {seconds} second{"" if seconds == 1 else "s"}')
			await asyncio.sleep(actual_seconds)
			return ActionResult(extracted_content=memory, long_term_memory=memory)

		# Helper function for coordinate conversion
		def _convert_llm_coordinates_to_viewport(llm_x: int, llm_y: int, browser_session: BrowserSession) -> tuple[int, int]:
			"""Convert coordinates from LLM screenshot size to original viewport size."""
			if browser_session.llm_screenshot_size and browser_session._original_viewport_size:
				original_width, original_height = browser_session._original_viewport_size
				llm_width, llm_height = browser_session.llm_screenshot_size

				# Convert coordinates using fractions
				actual_x = int((llm_x / llm_width) * original_width)
				actual_y = int((llm_y / llm_height) * original_height)

				logger.info(
					f'🔄 Converting coordinates: LLM ({llm_x}, {llm_y}) @ {llm_width}x{llm_height} '
					f'→ Viewport ({actual_x}, {actual_y}) @ {original_width}x{original_height}'
				)
				return actual_x, actual_y
			return llm_x, llm_y

		# Element Interaction Actions
		async def _click_by_coordinate(params: ClickElementAction, browser_session: BrowserSession) -> ActionResult:
			# Ensure coordinates are provided (type safety)
			if params.coordinate_x is None or params.coordinate_y is None:
				return ActionResult(error='Both coordinate_x and coordinate_y must be provided')

			try:
				# Convert coordinates from LLM size to original viewport size if resizing was used
				actual_x, actual_y = _convert_llm_coordinates_to_viewport(
					params.coordinate_x, params.coordinate_y, browser_session
				)

				# Highlight the coordinate being clicked (truly non-blocking)
				asyncio.create_task(browser_session.highlight_coordinate_click(actual_x, actual_y))

				# Dispatch ClickCoordinateEvent - handler will check for safety and click
				# Pass force parameter from params (defaults to False for safety)
				event = browser_session.event_bus.dispatch(
					ClickCoordinateEvent(coordinate_x=actual_x, coordinate_y=actual_y, force=params.force)
				)
				await event
				# Wait for handler to complete and get any exception or metadata
				click_metadata = await event.event_result(raise_if_any=True, raise_if_none=False)

				# Check for validation errors (only happens when force=False)
				if isinstance(click_metadata, dict) and 'validation_error' in click_metadata:
					error_msg = click_metadata['validation_error']
					return ActionResult(error=error_msg)

				memory = f'Clicked on coordinate {params.coordinate_x}, {params.coordinate_y}'
				msg = f'🖱️ {memory}'
				logger.info(msg)

				return ActionResult(
					extracted_content=memory,
					metadata={'click_x': actual_x, 'click_y': actual_y},
				)
			except BrowserError as e:
				return handle_browser_error(e)
			except Exception as e:
				error_msg = f'Failed to click at coordinates ({params.coordinate_x}, {params.coordinate_y}).'
				return ActionResult(error=error_msg)

		async def _click_by_index(params: ClickElementAction, browser_session: BrowserSession) -> ActionResult:
			assert params.index is not None
			try:
				assert params.index != 0, (
					'Cannot click on element with index 0. If there are no interactive elements use wait(), refresh(), etc. to troubleshoot'
				)

				# Look up the node from the selector map
				node = await browser_session.get_element_by_index(params.index)
				if node is None:
					msg = f'Element index {params.index} not available - page may have changed. Try refreshing browser state.'
					logger.warning(f'⚠️ {msg}')
					return ActionResult(extracted_content=msg)

				# Get description of clicked element
				element_desc = get_click_description(node)

				# Highlight the element being clicked (truly non-blocking)
				create_task_with_error_handling(
					browser_session.highlight_interaction_element(node), name='highlight_click_element', suppress_exceptions=True
				)

				event = browser_session.event_bus.dispatch(ClickElementEvent(node=node))
				await event
				# Wait for handler to complete and get any exception or metadata
				click_metadata = await event.event_result(raise_if_any=True, raise_if_none=False)

				# Check if result contains validation error (e.g., trying to click <select> or file input)
				if isinstance(click_metadata, dict) and 'validation_error' in click_metadata:
					error_msg = click_metadata['validation_error']
					# If it's a select element, try to get dropdown options as a helpful shortcut
					if 'Cannot click on <select> elements.' in error_msg:
						try:
							return await dropdown_options(
								params=GetDropdownOptionsAction(index=params.index), browser_session=browser_session
							)
						except Exception as dropdown_error:
							logger.debug(
								f'Failed to get dropdown options as shortcut during click on dropdown: {type(dropdown_error).__name__}: {dropdown_error}'
							)
					return ActionResult(error=error_msg)

				# Build memory with element info
				memory = f'Clicked {element_desc}'
				logger.info(f'🖱️ {memory}')

				# Include click coordinates in metadata if available
				return ActionResult(
					extracted_content=memory,
					metadata=click_metadata if isinstance(click_metadata, dict) else None,
				)
			except BrowserError as e:
				return handle_browser_error(e)
			except Exception as e:
				error_msg = f'Failed to click element {params.index}: {str(e)}'
				return ActionResult(error=error_msg)

		@self.registry.action(
			'Click element by index or coordinates. Prefer index over coordinates when possible. Either provide coordinates or index.',
			param_model=ClickElementAction,
		)
		async def click(params: ClickElementAction, browser_session: BrowserSession):
			# Validate that either index or coordinates are provided
			if params.index is None and (params.coordinate_x is None or params.coordinate_y is None):
				return ActionResult(error='Must provide either index or both coordinate_x and coordinate_y')

			# Try index-based clicking first if index is provided
			if params.index is not None:
				return await _click_by_index(params, browser_session)
			# Coordinate-based clicking when index is not provided
			else:
				return await _click_by_coordinate(params, browser_session)

		@self.registry.action(
			'Input text into element with index.',
			param_model=InputTextAction,
		)
		async def input(
			params: InputTextAction,
			browser_session: BrowserSession,
			has_sensitive_data: bool = False,
			sensitive_data: dict[str, str | dict[str, str]] | None = None,
		):
			# Look up the node from the selector map
			node = await browser_session.get_element_by_index(params.index)
			if node is None:
				msg = f'Element index {params.index} not available - page may have changed. Try refreshing browser state.'
				logger.warning(f'⚠️ {msg}')
				return ActionResult(extracted_content=msg)

			# Highlight the element being typed into (truly non-blocking)
			create_task_with_error_handling(
				browser_session.highlight_interaction_element(node), name='highlight_type_element', suppress_exceptions=True
			)

			# Dispatch type text event with node
			try:
				# Detect which sensitive key is being used
				sensitive_key_name = None
				if has_sensitive_data and sensitive_data:
					sensitive_key_name = _detect_sensitive_key_name(params.text, sensitive_data)

				event = browser_session.event_bus.dispatch(
					TypeTextEvent(
						node=node,
						text=params.text,
						clear=params.clear,
						is_sensitive=has_sensitive_data,
						sensitive_key_name=sensitive_key_name,
					)
				)
				await event
				input_metadata = await event.event_result(raise_if_any=True, raise_if_none=False)

				# Create message with sensitive data handling
				if has_sensitive_data:
					if sensitive_key_name:
						msg = f'Typed {sensitive_key_name}'
						log_msg = f'Typed <{sensitive_key_name}>'
					else:
						msg = 'Typed sensitive data'
						log_msg = 'Typed <sensitive>'
				else:
					msg = f"Typed '{params.text}'"
					log_msg = f"Typed '{params.text}'"

				logger.debug(log_msg)

				# Include input coordinates in metadata if available
				return ActionResult(
					extracted_content=msg,
					long_term_memory=msg,
					metadata=input_metadata if isinstance(input_metadata, dict) else None,
				)
			except BrowserError as e:
				return handle_browser_error(e)
			except Exception as e:
				# Log the full error for debugging
				logger.error(f'Failed to dispatch TypeTextEvent: {type(e).__name__}: {e}')
				error_msg = f'Failed to type text into element {params.index}: {e}'
				return ActionResult(error=error_msg)

		@self.registry.action(
			'',
			param_model=UploadFileAction,
		)
		async def upload_file(
			params: UploadFileAction, browser_session: BrowserSession, available_file_paths: list[str], file_system: FileSystem
		):
			# Check if file is in available_file_paths (user-provided or downloaded files)
			# For remote browsers (is_local=False), we allow absolute remote paths even if not tracked locally
			if params.path not in available_file_paths:
				# Also check if it's a recently downloaded file that might not be in available_file_paths yet
				downloaded_files = browser_session.downloaded_files
				if params.path not in downloaded_files:
					# Finally, check if it's a file in the FileSystem service
					if file_system and file_system.get_dir():
						# Check if the file is actually managed by the FileSystem service
						# The path should be just the filename for FileSystem files
						file_obj = file_system.get_file(params.path)
						if file_obj:
							# File is managed by FileSystem, construct the full path
							file_system_path = str(file_system.get_dir() / params.path)
							params = UploadFileAction(index=params.index, path=file_system_path)
						else:
							# If browser is remote, allow passing a remote-accessible absolute path
							if not browser_session.is_local:
								pass
							else:
								msg = f'File path {params.path} is not available. To fix: The user must add this file path to the available_file_paths parameter when creating the Agent. Example: Agent(task="...", llm=llm, browser=browser, available_file_paths=["{params.path}"])'
								logger.error(f'❌ {msg}')
								return ActionResult(error=msg)
					else:
						# If browser is remote, allow passing a remote-accessible absolute path
						if not browser_session.is_local:
							pass
						else:
							msg = f'File path {params.path} is not available. To fix: The user must add this file path to the available_file_paths parameter when creating the Agent. Example: Agent(task="...", llm=llm, browser=browser, available_file_paths=["{params.path}"])'
							raise BrowserError(message=msg, long_term_memory=msg)

			# For local browsers, ensure the file exists on the local filesystem
			if browser_session.is_local:
				if not os.path.exists(params.path):
					msg = f'File {params.path} does not exist'
					return ActionResult(error=msg)

			# Get the selector map to find the node
			selector_map = await browser_session.get_selector_map()
			if params.index not in selector_map:
				msg = f'Element with index {params.index} does not exist.'
				return ActionResult(error=msg)

			node = selector_map[params.index]

			# Helper function to find file input near the selected element
			def find_file_input_near_element(
				node: EnhancedDOMTreeNode, max_height: int = 3, max_descendant_depth: int = 3
			) -> EnhancedDOMTreeNode | None:
				"""Find the closest file input to the selected element."""

				def find_file_input_in_descendants(n: EnhancedDOMTreeNode, depth: int) -> EnhancedDOMTreeNode | None:
					if depth < 0:
						return None
					if browser_session.is_file_input(n):
						return n
					for child in n.children_nodes or []:
						result = find_file_input_in_descendants(child, depth - 1)
						if result:
							return result
					return None

				current = node
				for _ in range(max_height + 1):
					# Check the current node itself
					if browser_session.is_file_input(current):
						return current
					# Check all descendants of the current node
					result = find_file_input_in_descendants(current, max_descendant_depth)
					if result:
						return result
					# Check all siblings and their descendants
					if current.parent_node:
						for sibling in current.parent_node.children_nodes or []:
							if sibling is current:
								continue
							if browser_session.is_file_input(sibling):
								return sibling
							result = find_file_input_in_descendants(sibling, max_descendant_depth)
							if result:
								return result
					current = current.parent_node
					if not current:
						break
				return None

			# Try to find a file input element near the selected element
			file_input_node = find_file_input_near_element(node)

			# Highlight the file input element if found (truly non-blocking)
			if file_input_node:
				create_task_with_error_handling(
					browser_session.highlight_interaction_element(file_input_node),
					name='highlight_file_input',
					suppress_exceptions=True,
				)

			# If not found near the selected element, fallback to finding the closest file input to current scroll position
			if file_input_node is None:
				logger.info(
					f'No file upload element found near index {params.index}, searching for closest file input to scroll position'
				)

				# Get current scroll position
				cdp_session = await browser_session.get_or_create_cdp_session()
				try:
					scroll_info = await cdp_session.cdp_client.send.Runtime.evaluate(
						params={'expression': 'window.scrollY || window.pageYOffset || 0'}, session_id=cdp_session.session_id
					)
					current_scroll_y = scroll_info.get('result', {}).get('value', 0)
				except Exception:
					current_scroll_y = 0

				# Find all file inputs in the selector map and pick the closest one to scroll position
				closest_file_input = None
				min_distance = float('inf')

				for idx, element in selector_map.items():
					if browser_session.is_file_input(element):
						# Get element's Y position
						if element.absolute_position:
							element_y = element.absolute_position.y
							distance = abs(element_y - current_scroll_y)
							if distance < min_distance:
								min_distance = distance
								closest_file_input = element

				if closest_file_input:
					file_input_node = closest_file_input
					logger.info(f'Found file input closest to scroll position (distance: {min_distance}px)')

					# Highlight the fallback file input element (truly non-blocking)
					create_task_with_error_handling(
						browser_session.highlight_interaction_element(file_input_node),
						name='highlight_file_input_fallback',
						suppress_exceptions=True,
					)
				else:
					msg = 'No file upload element found on the page'
					logger.error(msg)
					raise BrowserError(msg)
					# TODO: figure out why this fails sometimes + add fallback hail mary, just look for any file input on page

			# Dispatch upload file event with the file input node
			try:
				event = browser_session.event_bus.dispatch(UploadFileEvent(node=file_input_node, file_path=params.path))
				await event
				await event.event_result(raise_if_any=True, raise_if_none=False)
				msg = f'Successfully uploaded file to index {params.index}'
				logger.info(f'📁 {msg}')
				return ActionResult(
					extracted_content=msg,
					long_term_memory=f'Uploaded file {params.path} to element {params.index}',
				)
			except Exception as e:
				logger.error(f'Failed to upload file: {e}')
				raise BrowserError(f'Failed to upload file: {e}')

		# Tab Management Actions

		@self.registry.action(
			'Switch to another open tab by tab_id. Tab IDs are shown in browser state tabs list (last 4 chars of target_id). Use when you need to work with content in a different tab.',
			param_model=SwitchTabAction,
		)
		async def switch(params: SwitchTabAction, browser_session: BrowserSession):
			# Simple switch tab logic
			try:
				target_id = await browser_session.get_target_id_from_tab_id(params.tab_id)

				event = browser_session.event_bus.dispatch(SwitchTabEvent(target_id=target_id))
				await event
				new_target_id = await event.event_result(raise_if_any=False, raise_if_none=False)  # Don't raise on errors

				if new_target_id:
					memory = f'Switched to tab #{new_target_id[-4:]}'
				else:
					memory = f'Switched to tab #{params.tab_id}'

				logger.info(f'🔄  {memory}')
				return ActionResult(extracted_content=memory, long_term_memory=memory)
			except Exception as e:
				logger.warning(f'Tab switch may have failed: {e}')
				memory = f'Attempted to switch to tab #{params.tab_id}'
				return ActionResult(extracted_content=memory, long_term_memory=memory)

		@self.registry.action(
			'Close a tab by tab_id. Tab IDs are shown in browser state tabs list (last 4 chars of target_id). Use to clean up tabs you no longer need.',
			param_model=CloseTabAction,
		)
		async def close(params: CloseTabAction, browser_session: BrowserSession):
			# Simple close tab logic
			try:
				target_id = await browser_session.get_target_id_from_tab_id(params.tab_id)

				# Dispatch close tab event - handle stale target IDs gracefully
				event = browser_session.event_bus.dispatch(CloseTabEvent(target_id=target_id))
				await event
				await event.event_result(raise_if_any=False, raise_if_none=False)  # Don't raise on errors

				memory = f'Closed tab #{params.tab_id}'
				logger.info(f'🗑️  {memory}')
				return ActionResult(
					extracted_content=memory,
					long_term_memory=memory,
				)
			except Exception as e:
				# Handle stale target IDs gracefully
				logger.warning(f'Tab {params.tab_id} may already be closed: {e}')
				memory = f'Tab #{params.tab_id} closed (was already closed or invalid)'
				return ActionResult(
					extracted_content=memory,
					long_term_memory=memory,
				)

		@self.registry.action(
			"""LLM extracts structured data from page markdown. Use when: on right page, know what to extract, haven't called before on same page+query. Can't get interactive elements. Set extract_links=True for URLs. Use start_from_char if previous extraction was truncated to extract data further down the page.""",
			param_model=ExtractAction,
		)
		async def extract(
			params: ExtractAction,
			browser_session: BrowserSession,
			page_extraction_llm: BaseChatModel,
			file_system: FileSystem,
		):
			# Constants
			MAX_CHAR_LIMIT = 30000
			query = params['query'] if isinstance(params, dict) else params.query
			extract_links = params['extract_links'] if isinstance(params, dict) else params.extract_links
			start_from_char = params['start_from_char'] if isinstance(params, dict) else params.start_from_char

			# Extract clean markdown using the unified method
			try:
				from browser_use.dom.markdown_extractor import extract_clean_markdown

				content, content_stats = await extract_clean_markdown(
					browser_session=browser_session, extract_links=extract_links
				)
			except Exception as e:
				raise RuntimeError(f'Could not extract clean markdown: {type(e).__name__}')

			# Original content length for processing
			final_filtered_length = content_stats['final_filtered_chars']

			if start_from_char > 0:
				if start_from_char >= len(content):
					return ActionResult(
						error=f'start_from_char ({start_from_char}) exceeds content length {final_filtered_length} characters.'
					)
				content = content[start_from_char:]
				content_stats['started_from_char'] = start_from_char

			# Smart truncation with context preservation
			truncated = False
			if len(content) > MAX_CHAR_LIMIT:
				# Try to truncate at a natural break point (paragraph, sentence)
				truncate_at = MAX_CHAR_LIMIT

				# Look for paragraph break within last 500 chars of limit
				paragraph_break = content.rfind('\n\n', MAX_CHAR_LIMIT - 500, MAX_CHAR_LIMIT)
				if paragraph_break > 0:
					truncate_at = paragraph_break
				else:
					# Look for sentence break within last 200 chars of limit
					sentence_break = content.rfind('.', MAX_CHAR_LIMIT - 200, MAX_CHAR_LIMIT)
					if sentence_break > 0:
						truncate_at = sentence_break + 1

				content = content[:truncate_at]
				truncated = True
				next_start = (start_from_char or 0) + truncate_at
				content_stats['truncated_at_char'] = truncate_at
				content_stats['next_start_char'] = next_start

			# Add content statistics to the result
			original_html_length = content_stats['original_html_chars']
			initial_markdown_length = content_stats['initial_markdown_chars']
			chars_filtered = content_stats['filtered_chars_removed']

			stats_summary = f"""Content processed: {original_html_length:,} HTML chars → {initial_markdown_length:,} initial markdown → {final_filtered_length:,} filtered markdown"""
			if start_from_char > 0:
				stats_summary += f' (started from char {start_from_char:,})'
			if truncated:
				stats_summary += f' → {len(content):,} final chars (truncated, use start_from_char={content_stats["next_start_char"]} to continue)'
			elif chars_filtered > 0:
				stats_summary += f' (filtered {chars_filtered:,} chars of noise)'

			system_prompt = """
You are an expert at extracting data from the markdown of a webpage.

<input>
You will be given a query and the markdown of a webpage that has been filtered to remove noise and advertising content.
</input>

<instructions>
- You are tasked to extract information from the webpage that is relevant to the query.
- You should ONLY use the information available in the webpage to answer the query. Do not make up information or provide guess from your own knowledge.
- If the information relevant to the query is not available in the page, your response should mention that.
- If the query asks for all items, products, etc., make sure to directly list all of them.
- If the content was truncated and you need more information, note that the user can use start_from_char parameter to continue from where truncation occurred.
</instructions>

<output>
- Your output should present ALL the information relevant to the query in a concise way.
- Do not answer in conversational format - directly output the relevant information or that the information is unavailable.
</output>
""".strip()

			# Sanitize surrogates from content to prevent UTF-8 encoding errors
			content = sanitize_surrogates(content)
			query = sanitize_surrogates(query)

			prompt = f'<query>\n{query}\n</query>\n\n<content_stats>\n{stats_summary}\n</content_stats>\n\n<webpage_content>\n{content}\n</webpage_content>'

			try:
				response = await asyncio.wait_for(
					page_extraction_llm.ainvoke([SystemMessage(content=system_prompt), UserMessage(content=prompt)]),
					timeout=120.0,
				)

				current_url = await browser_session.get_current_page_url()
				extracted_content = (
					f'<url>\n{current_url}\n</url>\n<query>\n{query}\n</query>\n<result>\n{response.completion}\n</result>'
				)

				# Simple memory handling
				MAX_MEMORY_LENGTH = 1000
				if len(extracted_content) < MAX_MEMORY_LENGTH:
					memory = extracted_content
					include_extracted_content_only_once = False
				else:
					file_name = await file_system.save_extracted_content(extracted_content)
					memory = f'Query: {query}\nContent in {file_name} and once in <read_state>.'
					include_extracted_content_only_once = True

				logger.info(f'📄 {memory}')
				return ActionResult(
					extracted_content=extracted_content,
					include_extracted_content_only_once=include_extracted_content_only_once,
					long_term_memory=memory,
				)
			except Exception as e:
				logger.debug(f'Error extracting content: {e}')
				raise RuntimeError(str(e))

		@self.registry.action(
			"""Scroll by pages. REQUIRED: down=True/False (True=scroll down, False=scroll up, default=True). Optional: pages=0.5-10.0 (default 1.0). Use index for scroll containers (dropdowns/custom UI). High pages (10) reaches bottom. Multi-page scrolls sequentially. Viewport-based height, fallback 1000px/page.""",
			param_model=ScrollAction,
		)
		async def scroll(params: ScrollAction, browser_session: BrowserSession):
			try:
				# Look up the node from the selector map if index is provided
				# Special case: index 0 means scroll the whole page (root/body element)
				node = None
				if params.index is not None and params.index != 0:
					node = await browser_session.get_element_by_index(params.index)
					if node is None:
						# Element does not exist
						msg = f'Element index {params.index} not found in browser state'
						return ActionResult(error=msg)

				direction = 'down' if params.down else 'up'
				target = f'element {params.index}' if params.index is not None and params.index != 0 else ''

				# Get actual viewport height for more accurate scrolling
				try:
					cdp_session = await browser_session.get_or_create_cdp_session()
					metrics = await cdp_session.cdp_client.send.Page.getLayoutMetrics(session_id=cdp_session.session_id)

					# Use cssVisualViewport for the most accurate representation
					css_viewport = metrics.get('cssVisualViewport', {})
					css_layout_viewport = metrics.get('cssLayoutViewport', {})

					# Get viewport height, prioritizing cssVisualViewport
					viewport_height = int(css_viewport.get('clientHeight') or css_layout_viewport.get('clientHeight', 1000))

					logger.debug(f'Detected viewport height: {viewport_height}px')
				except Exception as e:
					viewport_height = 1000  # Fallback to 1000px
					logger.debug(f'Failed to get viewport height, using fallback 1000px: {e}')

				# For multiple pages (>=1.0), scroll one page at a time to ensure each scroll completes
				if params.pages >= 1.0:
					import asyncio

					num_full_pages = int(params.pages)
					remaining_fraction = params.pages - num_full_pages

					completed_scrolls = 0

					# Scroll one page at a time
					for i in range(num_full_pages):
						try:
							pixels = viewport_height  # Use actual viewport height
							if not params.down:
								pixels = -pixels

							event = browser_session.event_bus.dispatch(
								ScrollEvent(direction=direction, amount=abs(pixels), node=node)
							)
							await event
							await event.event_result(raise_if_any=True, raise_if_none=False)
							completed_scrolls += 1

							# Small delay to ensure scroll completes before next one
							await asyncio.sleep(0.3)

						except Exception as e:
							logger.warning(f'Scroll {i + 1}/{num_full_pages} failed: {e}')
							# Continue with remaining scrolls even if one fails

					# Handle fractional page if present
					if remaining_fraction > 0:
						try:
							pixels = int(remaining_fraction * viewport_height)
							if not params.down:
								pixels = -pixels

							event = browser_session.event_bus.dispatch(
								ScrollEvent(direction=direction, amount=abs(pixels), node=node)
							)
							await event
							await event.event_result(raise_if_any=True, raise_if_none=False)
							completed_scrolls += remaining_fraction

						except Exception as e:
							logger.warning(f'Fractional scroll failed: {e}')

					if params.pages == 1.0:
						long_term_memory = f'Scrolled {direction} {target} {viewport_height}px'.replace('  ', ' ')
					else:
						long_term_memory = f'Scrolled {direction} {target} {completed_scrolls:.1f} pages'.replace('  ', ' ')
				else:
					# For fractional pages <1.0, do single scroll
					pixels = int(params.pages * viewport_height)
					event = browser_session.event_bus.dispatch(
						ScrollEvent(direction='down' if params.down else 'up', amount=pixels, node=node)
					)
					await event
					await event.event_result(raise_if_any=True, raise_if_none=False)
					long_term_memory = f'Scrolled {direction} {target} {params.pages} pages'.replace('  ', ' ')

				msg = f'🔍 {long_term_memory}'
				logger.info(msg)
				return ActionResult(extracted_content=msg, long_term_memory=long_term_memory)
			except Exception as e:
				logger.error(f'Failed to dispatch ScrollEvent: {type(e).__name__}: {e}')
				error_msg = 'Failed to execute scroll action.'
				return ActionResult(error=error_msg)

		@self.registry.action(
			'',
			param_model=SendKeysAction,
		)
		async def send_keys(params: SendKeysAction, browser_session: BrowserSession):
			# Dispatch send keys event
			try:
				event = browser_session.event_bus.dispatch(SendKeysEvent(keys=params.keys))
				await event
				await event.event_result(raise_if_any=True, raise_if_none=False)
				memory = f'Sent keys: {params.keys}'
				msg = f'⌨️  {memory}'
				logger.info(msg)
				return ActionResult(extracted_content=memory, long_term_memory=memory)
			except Exception as e:
				logger.error(f'Failed to dispatch SendKeysEvent: {type(e).__name__}: {e}')
				error_msg = f'Failed to send keys: {str(e)}'
				return ActionResult(error=error_msg)

		@self.registry.action('Scroll to text.')
		async def find_text(text: str, browser_session: BrowserSession):  # type: ignore
			# Dispatch scroll to text event
			event = browser_session.event_bus.dispatch(ScrollToTextEvent(text=text))

			try:
				# The handler returns None on success or raises an exception if text not found
				await event.event_result(raise_if_any=True, raise_if_none=False)
				memory = f'Scrolled to text: {text}'
				msg = f'🔍  {memory}'
				logger.info(msg)
				return ActionResult(extracted_content=memory, long_term_memory=memory)
			except Exception as e:
				# Text not found
				msg = f"Text '{text}' not found or not visible on page"
				logger.info(msg)
				return ActionResult(
					extracted_content=msg,
					long_term_memory=f"Tried scrolling to text '{text}' but it was not found",
				)

		@self.registry.action(
			'Get a screenshot of the current viewport. Use when: visual inspection needed, layout unclear, element positions uncertain, debugging UI issues, or verifying page state. Screenshot is included in the next browser_state No parameters are needed.',
			param_model=NoParamsAction,
		)
		async def screenshot(_: NoParamsAction):
			"""Request that a screenshot be included in the next observation"""
			memory = 'Requested screenshot for next observation'
			msg = f'📸 {memory}'
			logger.info(msg)

			# Return flag in metadata to signal that screenshot should be included
			return ActionResult(
				extracted_content=memory,
				metadata={'include_screenshot': True},
			)

		# Dropdown Actions

		@self.registry.action(
			'',
			param_model=GetDropdownOptionsAction,
		)
		async def dropdown_options(params: GetDropdownOptionsAction, browser_session: BrowserSession):
			"""Get all options from a native dropdown or ARIA menu"""
			# Look up the node from the selector map
			node = await browser_session.get_element_by_index(params.index)
			if node is None:
				msg = f'Element index {params.index} not available - page may have changed. Try refreshing browser state.'
				logger.warning(f'⚠️ {msg}')
				return ActionResult(extracted_content=msg)

			# Dispatch GetDropdownOptionsEvent to the event handler

			event = browser_session.event_bus.dispatch(GetDropdownOptionsEvent(node=node))
			dropdown_data = await event.event_result(timeout=3.0, raise_if_none=True, raise_if_any=True)

			if not dropdown_data:
				raise ValueError('Failed to get dropdown options - no data returned')

			# Use structured memory from the handler
			return ActionResult(
				extracted_content=dropdown_data['short_term_memory'],
				long_term_memory=dropdown_data['long_term_memory'],
				include_extracted_content_only_once=True,
			)

		@self.registry.action(
			'Set the option of a <select> element.',
			param_model=SelectDropdownOptionAction,
		)
		async def select_dropdown(params: SelectDropdownOptionAction, browser_session: BrowserSession):
			"""Select dropdown option by the text of the option you want to select"""
			# Look up the node from the selector map
			node = await browser_session.get_element_by_index(params.index)
			if node is None:
				msg = f'Element index {params.index} not available - page may have changed. Try refreshing browser state.'
				logger.warning(f'⚠️ {msg}')
				return ActionResult(extracted_content=msg)

			# Dispatch SelectDropdownOptionEvent to the event handler
			from browser_use.browser.events import SelectDropdownOptionEvent

			event = browser_session.event_bus.dispatch(SelectDropdownOptionEvent(node=node, text=params.text))
			selection_data = await event.event_result()

			if not selection_data:
				raise ValueError('Failed to select dropdown option - no data returned')

			# Check if the selection was successful
			if selection_data.get('success') == 'true':
				# Extract the message from the returned data
				msg = selection_data.get('message', f'Selected option: {params.text}')
				return ActionResult(
					extracted_content=msg,
					include_in_memory=True,
					long_term_memory=f"Selected dropdown option '{params.text}' at index {params.index}",
				)
			else:
				# Handle structured error response
				# TODO: raise BrowserError instead of returning ActionResult
				if 'short_term_memory' in selection_data and 'long_term_memory' in selection_data:
					return ActionResult(
						extracted_content=selection_data['short_term_memory'],
						long_term_memory=selection_data['long_term_memory'],
						include_extracted_content_only_once=True,
					)
				else:
					# Fallback to regular error
					error_msg = selection_data.get('error', f'Failed to select option: {params.text}')
					return ActionResult(error=error_msg)

		# File System Actions

		@self.registry.action(
			'Write content to a file in the local file system. Use this to create new files or overwrite entire file contents. For targeted edits within existing files, use replace_file instead. Supports alphanumeric filename and file extension formats: .txt, .md, .json, .jsonl, .csv, .pdf. For PDF files, write content in markdown format and it will be automatically converted to a properly formatted PDF document.'
		)
		async def write_file(
			file_name: str,
			content: str,
			file_system: FileSystem,
			append: bool = False,
			trailing_newline: bool = True,
			leading_newline: bool = False,
		):
			if trailing_newline:
				content += '\n'
			if leading_newline:
				content = '\n' + content
			if append:
				result = await file_system.append_file(file_name, content)
			else:
				result = await file_system.write_file(file_name, content)

			# Log the full path where the file is stored
			file_path = file_system.get_dir() / file_name
			logger.info(f'💾 {result} File location: {file_path}')

			return ActionResult(extracted_content=result, long_term_memory=result)

		@self.registry.action(
			'Replace specific text within a file by searching for old_str and replacing with new_str. Use this for targeted edits like updating todo checkboxes or modifying specific lines without rewriting the entire file.'
		)
		async def replace_file(file_name: str, old_str: str, new_str: str, file_system: FileSystem):
			result = await file_system.replace_file_str(file_name, old_str, new_str)
			logger.info(f'💾 {result}')
			return ActionResult(extracted_content=result, long_term_memory=result)

		@self.registry.action(
			'Read the complete content of a file. Use this to view file contents before editing or to retrieve data from files. Supports text files (txt, md, json, csv, jsonl), documents (pdf, docx), and images (jpg, png).'
		)
		async def read_file(file_name: str, available_file_paths: list[str], file_system: FileSystem):
			if available_file_paths and file_name in available_file_paths:
				structured_result = await file_system.read_file_structured(file_name, external_file=True)
			else:
				structured_result = await file_system.read_file_structured(file_name)

			result = structured_result['message']
			images = structured_result.get('images')

			MAX_MEMORY_SIZE = 1000
			# For images, create a shorter memory message
			if images:
				memory = f'Read image file {file_name}'
			elif len(result) > MAX_MEMORY_SIZE:
				lines = result.splitlines()
				display = ''
				lines_count = 0
				for line in lines:
					if len(display) + len(line) < MAX_MEMORY_SIZE:
						display += line + '\n'
						lines_count += 1
					else:
						break
				remaining_lines = len(lines) - lines_count
				memory = f'{display}{remaining_lines} more lines...' if remaining_lines > 0 else display
			else:
				memory = result
			logger.info(f'💾 {memory}')
			return ActionResult(
				extracted_content=result,
				long_term_memory=memory,
				images=images,
				include_extracted_content_only_once=True,
			)

		@self.registry.action(
			"""Execute browser JavaScript. Best practice: wrap in IIFE (function(){...})() with try-catch for safety. Use ONLY browser APIs (document, window, DOM). NO Node.js APIs (fs, require, process). Example: (function(){try{const el=document.querySelector('#id');return el?el.value:'not found'}catch(e){return 'Error: '+e.message}})() Avoid comments. Use for hover, drag, zoom, custom selectors, extract/filter links, shadow DOM, or analysing page structure. Limit output size.""",
		)
		async def evaluate(code: str, browser_session: BrowserSession):
			# Execute JavaScript with proper error handling and promise support

			cdp_session = await browser_session.get_or_create_cdp_session()

			try:
				# Validate and potentially fix JavaScript code before execution
				validated_code = self._validate_and_fix_javascript(code)

				# Always use awaitPromise=True - it's ignored for non-promises
				result = await cdp_session.cdp_client.send.Runtime.evaluate(
					params={'expression': validated_code, 'returnByValue': True, 'awaitPromise': True},
					session_id=cdp_session.session_id,
				)

				# Check for JavaScript execution errors
				if result.get('exceptionDetails'):
					exception = result['exceptionDetails']
					error_msg = f'JavaScript execution error: {exception.get("text", "Unknown error")}'

					# Enhanced error message with debugging info
					enhanced_msg = f"""JavaScript Execution Failed:
{error_msg}

Validated Code (after quote fixing):
{validated_code[:500]}{'...' if len(validated_code) > 500 else ''}
"""

					logger.debug(enhanced_msg)
					return ActionResult(error=enhanced_msg)

				# Get the result data
				result_data = result.get('result', {})

				# Check for wasThrown flag (backup error detection)
				if result_data.get('wasThrown'):
					msg = f'JavaScript code: {code} execution failed (wasThrown=true)'
					logger.debug(msg)
					return ActionResult(error=msg)

				# Get the actual value
				value = result_data.get('value')

				# Handle different value types
				if value is None:
					# Could be legitimate null/undefined result
					result_text = str(value) if 'value' in result_data else 'undefined'
				elif isinstance(value, (dict, list)):
					# Complex objects - should be serialized by returnByValue
					try:
						result_text = json.dumps(value, ensure_ascii=False)
					except (TypeError, ValueError):
						# Fallback for non-serializable objects
						result_text = str(value)
				else:
					# Primitive values (string, number, boolean)
					result_text = str(value)

				import re

				image_pattern = r'(data:image/[^;]+;base64,[A-Za-z0-9+/=]+)'
				found_images = re.findall(image_pattern, result_text)

				metadata = None
				if found_images:
					# Store images in metadata so they can be added as ContentPartImageParam
					metadata = {'images': found_images}

					# Replace image data in result text with shorter placeholder
					modified_text = result_text
					for i, img_data in enumerate(found_images, 1):
						placeholder = '[Image]'
						modified_text = modified_text.replace(img_data, placeholder)
					result_text = modified_text

				# Apply length limit with better truncation (after image extraction)
				if len(result_text) > 20000:
					result_text = result_text[:19950] + '\n... [Truncated after 20000 characters]'

				# Don't log the code - it's already visible in the user's cell
				logger.debug(f'JavaScript executed successfully, result length: {len(result_text)}')

				# Memory handling: keep full result in extracted_content for current step,
				# but use truncated version in long_term_memory if too large
				MAX_MEMORY_LENGTH = 1000
				if len(result_text) < MAX_MEMORY_LENGTH:
					memory = result_text
					include_extracted_content_only_once = False
				else:
					memory = f'JavaScript executed successfully, result length: {len(result_text)} characters.'
					include_extracted_content_only_once = True

				# Return only the result, not the code (code is already in user's cell)
				return ActionResult(
					extracted_content=result_text,
					long_term_memory=memory,
					include_extracted_content_only_once=include_extracted_content_only_once,
					metadata=metadata,
				)

			except Exception as e:
				# CDP communication or other system errors
				error_msg = f'Failed to execute JavaScript: {type(e).__name__}: {e}'
				logger.debug(f'JavaScript code that failed: {code[:200]}...')
				return ActionResult(error=error_msg)

	def _validate_and_fix_javascript(self, code: str) -> str:
		"""Validate and fix common JavaScript issues before execution"""

		import re

		# Pattern 1: Fix double-escaped quotes (\\\" → \")
		fixed_code = re.sub(r'\\"', '"', code)

		# Pattern 2: Fix over-escaped regex patterns (\\\\d → \\d)
		# Common issue: regex gets double-escaped during parsing
		fixed_code = re.sub(r'\\\\([dDsSwWbBnrtfv])', r'\\\1', fixed_code)
		fixed_code = re.sub(r'\\\\([.*+?^${}()|[\]])', r'\\\1', fixed_code)

		# Pattern 3: Fix XPath expressions with mixed quotes
		xpath_pattern = r'document\.evaluate\s*\(\s*"([^"]*)"\s*,'

		def fix_xpath_quotes(match):
			xpath_with_quotes = match.group(1)
			return f'document.evaluate(`{xpath_with_quotes}`,'

		fixed_code = re.sub(xpath_pattern, fix_xpath_quotes, fixed_code)

		# Pattern 4: Fix querySelector/querySelectorAll with mixed quotes
		selector_pattern = r'(querySelector(?:All)?)\s*\(\s*"([^"]*)"\s*\)'

		def fix_selector_quotes(match):
			method_name = match.group(1)
			selector_with_quotes = match.group(2)
			return f'{method_name}(`{selector_with_quotes}`)'

		fixed_code = re.sub(selector_pattern, fix_selector_quotes, fixed_code)

		# Pattern 5: Fix closest() calls with mixed quotes
		closest_pattern = r'\.closest\s*\(\s*"([^"]*)"\s*\)'

		def fix_closest_quotes(match):
			selector_with_quotes = match.group(1)
			return f'.closest(`{selector_with_quotes}`)'

		fixed_code = re.sub(closest_pattern, fix_closest_quotes, fixed_code)

		# Pattern 6: Fix .matches() calls with mixed quotes (similar to closest)
		matches_pattern = r'\.matches\s*\(\s*"([^"]*)"\s*\)'

		def fix_matches_quotes(match):
			selector_with_quotes = match.group(1)
			return f'.matches(`{selector_with_quotes}`)'

		fixed_code = re.sub(matches_pattern, fix_matches_quotes, fixed_code)

		# Note: Removed getAttribute fix - attribute names rarely have mixed quotes
		# getAttribute typically uses simple names like "data-value", not complex selectors

		# Log changes made
		changes_made = []
		if r'\"' in code and r'\"' not in fixed_code:
			changes_made.append('fixed escaped quotes')
		if '`' in fixed_code and '`' not in code:
			changes_made.append('converted mixed quotes to template literals')

		if changes_made:
			logger.debug(f'JavaScript fixes applied: {", ".join(changes_made)}')

		return fixed_code

	def _register_done_action(self, output_model: type[T] | None, display_files_in_done_text: bool = True):
		if output_model is not None:
			self.display_files_in_done_text = display_files_in_done_text

			@self.registry.action(
				'Complete task with structured output.',
				param_model=StructuredOutputAction[output_model],
			)
			async def done(params: StructuredOutputAction):
				# Exclude success from the output JSON since it's an internal parameter
				# Use mode='json' to properly serialize enums at all nesting levels
				output_dict = params.data.model_dump(mode='json')

				return ActionResult(
					is_done=True,
					success=params.success,
					extracted_content=json.dumps(output_dict, ensure_ascii=False),
					long_term_memory=f'Task completed. Success Status: {params.success}',
				)

		else:

			@self.registry.action(
				'Complete task.',
				param_model=DoneAction,
			)
			async def done(params: DoneAction, file_system: FileSystem):
				user_message = params.text

				len_text = len(params.text)
				len_max_memory = 100
				memory = f'Task completed: {params.success} - {params.text[:len_max_memory]}'
				if len_text > len_max_memory:
					memory += f' - {len_text - len_max_memory} more characters'

				attachments = []
				if params.files_to_display:
					if self.display_files_in_done_text:
						file_msg = ''
						for file_name in params.files_to_display:
							file_content = file_system.display_file(file_name)
							if file_content:
								file_msg += f'\n\n{file_name}:\n{file_content}'
								attachments.append(file_name)
						if file_msg:
							user_message += '\n\nAttachments:'
							user_message += file_msg
						else:
							logger.warning('Agent wanted to display files but none were found')
					else:
						for file_name in params.files_to_display:
							file_content = file_system.display_file(file_name)
							if file_content:
								attachments.append(file_name)

				attachments = [str(file_system.get_dir() / file_name) for file_name in attachments]

				return ActionResult(
					is_done=True,
					success=params.success,
					extracted_content=user_message,
					long_term_memory=memory,
					attachments=attachments,
				)

	def use_structured_output_action(self, output_model: type[T]):
		self._register_done_action(output_model)

	# Register ---------------------------------------------------------------

	def action(self, description: str, **kwargs):
		"""Decorator for registering custom actions

		@param description: Describe the LLM what the function does (better description == better function calling)
		"""
		return self.registry.action(description, **kwargs)

	def exclude_action(self, action_name: str) -> None:
		"""Exclude an action from the tools registry.

		This method can be used to remove actions after initialization,
		useful for enforcing constraints like disabling screenshot when use_vision != 'auto'.

		Args:
			action_name: Name of the action to exclude (e.g., 'screenshot')
		"""
		self.registry.exclude_action(action_name)

	# Act --------------------------------------------------------------------
	@observe_debug(ignore_input=True, ignore_output=True, name='act')
	@time_execution_sync('--act')
	async def act(
		self,
		action: ActionModel,
		browser_session: BrowserSession,
		page_extraction_llm: BaseChatModel | None = None,
		sensitive_data: dict[str, str | dict[str, str]] | None = None,
		available_file_paths: list[str] | None = None,
		file_system: FileSystem | None = None,
	) -> ActionResult:
		"""Execute an action"""

		for action_name, params in action.model_dump(exclude_unset=True).items():
			if params is not None:
				# Use Laminar span if available, otherwise use no-op context manager
				if Laminar is not None:
					span_context = Laminar.start_as_current_span(
						name=action_name,
						input={
							'action': action_name,
							'params': params,
						},
						span_type='TOOL',
					)
				else:
					# No-op context manager when lmnr is not available
					from contextlib import nullcontext

					span_context = nullcontext()

				with span_context:
					try:
						result = await self.registry.execute_action(
							action_name=action_name,
							params=params,
							browser_session=browser_session,
							page_extraction_llm=page_extraction_llm,
							file_system=file_system,
							sensitive_data=sensitive_data,
							available_file_paths=available_file_paths,
						)
					except BrowserError as e:
						logger.error(f'❌ Action {action_name} failed with BrowserError: {str(e)}')
						result = handle_browser_error(e)
					except TimeoutError as e:
						logger.error(f'❌ Action {action_name} failed with TimeoutError: {str(e)}')
						result = ActionResult(error=f'{action_name} was not executed due to timeout.')
					except Exception as e:
						# Log the original exception with traceback for observability
						logger.error(f"Action '{action_name}' failed with error: {str(e)}")
						result = ActionResult(error=str(e))

					if Laminar is not None:
						Laminar.set_span_output(result)

				if isinstance(result, str):
					return ActionResult(extracted_content=result)
				elif isinstance(result, ActionResult):
					return result
				elif result is None:
					return ActionResult()
				else:
					raise ValueError(f'Invalid action result type: {type(result)} of {result}')
		return ActionResult()

	def __getattr__(self, name: str):
		"""
		Enable direct action calls like tools.navigate(url=..., browser_session=...).
		This provides a simpler API for tests and direct usage while maintaining backward compatibility.
		"""
		# Check if this is a registered action
		if name in self.registry.registry.actions:
			from typing import Union

			from pydantic import create_model

			action = self.registry.registry.actions[name]

			# Create a wrapper that calls act() to ensure consistent error handling and result normalization
			async def action_wrapper(**kwargs):
				# Extract browser_session (required positional argument for act())
				browser_session = kwargs.get('browser_session')

				# Separate action params from special params (injected dependencies)
				special_param_names = {
					'browser_session',
					'page_extraction_llm',
					'file_system',
					'available_file_paths',
					'sensitive_data',
				}

				# Extract action params (params for the action itself)
				action_params = {k: v for k, v in kwargs.items() if k not in special_param_names}

				# Extract special params (injected dependencies) - exclude browser_session as it's positional
				special_kwargs = {k: v for k, v in kwargs.items() if k in special_param_names and k != 'browser_session'}

				# Create the param instance
				params_instance = action.param_model(**action_params)

				# Dynamically create an ActionModel with this action
				# Use Union for type compatibility with create_model
				DynamicActionModel = create_model(
					'DynamicActionModel',
					__base__=ActionModel,
					**{name: (Union[action.param_model, None], None)},  # type: ignore
				)

				# Create the action model instance
				action_model = DynamicActionModel(**{name: params_instance})

				# Call act() which has all the error handling, result normalization, and observability
				# browser_session is passed as positional argument (required by act())
				return await self.act(action=action_model, browser_session=browser_session, **special_kwargs)  # type: ignore

			return action_wrapper

		# If not an action, raise AttributeError for normal Python behavior
		raise AttributeError(f"'{type(self).__name__}' object has no attribute '{name}'")


# Alias for backwards compatibility
Controller = Tools


class CodeAgentTools(Tools[Context]):
	"""Specialized Tools for CodeAgent agent optimized for Python-based browser automation.

	Includes:
	- All browser interaction tools (click, input, scroll, navigate, etc.)
	- JavaScript evaluation
	- Tab management (switch, close)
	- Navigation actions (go_back)
	- Upload file support
	- Dropdown interactions

	Excludes (optimized for code-use mode):
	- extract: Use Python + evaluate() instead
	- find_text: Use Python string operations
	- screenshot: Not needed in code-use mode
	- search: Use navigate() directly
	- File system actions (write_file, read_file, replace_file): Use Python file operations instead
	"""

	def __init__(
		self,
		exclude_actions: list[str] | None = None,
		output_model: type[T] | None = None,
		display_files_in_done_text: bool = True,
	):
		# Default exclusions for CodeAgent agent
		if exclude_actions is None:
			exclude_actions = [
				# 'scroll',  # Keep for code-use
				'extract',  # Exclude - use Python + evaluate()
				'find_text',  # Exclude - use Python string ops
				# 'select_dropdown',  # Keep for code-use
				# 'dropdown_options',  # Keep for code-use
				'screenshot',  # Exclude - not needed
				'search',  # Exclude - use navigate() directly
				# 'click',  # Keep for code-use
				# 'input',  # Keep for code-use
				# 'switch',  # Keep for code-use
				# 'send_keys',  # Keep for code-use
				# 'close',  # Keep for code-use
				# 'go_back',  # Keep for code-use
				# 'upload_file',  # Keep for code-use
				# Exclude file system actions - CodeAgent should use Python file operations
				'write_file',
				'read_file',
				'replace_file',
			]

		super().__init__(
			exclude_actions=exclude_actions,
			output_model=output_model,
			display_files_in_done_text=display_files_in_done_text,
		)

		# Override done action for CodeAgent with enhanced file handling
		self._register_code_use_done_action(output_model, display_files_in_done_text)

	def _register_code_use_done_action(self, output_model: type[T] | None, display_files_in_done_text: bool = True):
		"""Register enhanced done action for CodeAgent that can read files from disk."""
		if output_model is not None:
			# Structured output done - use parent's implementation
			return

		# Override the done action with enhanced version
		@self.registry.action(
			'Complete task.',
			param_model=DoneAction,
		)
		async def done(params: DoneAction, file_system: FileSystem):
			user_message = params.text

			len_text = len(params.text)
			len_max_memory = 100
			memory = f'Task completed: {params.success} - {params.text[:len_max_memory]}'
			if len_text > len_max_memory:
				memory += f' - {len_text - len_max_memory} more characters'

			attachments = []
			if params.files_to_display:
				if self.display_files_in_done_text:
					file_msg = ''
					for file_name in params.files_to_display:
						file_content = file_system.display_file(file_name)
						if file_content:
							file_msg += f'\n\n{file_name}:\n{file_content}'
							attachments.append(file_name)
						elif os.path.exists(file_name):
							# File exists on disk but not in FileSystem - just add to attachments
							attachments.append(file_name)
					if file_msg:
						user_message += '\n\nAttachments:'
						user_message += file_msg
					else:
						logger.warning('Agent wanted to display files but none were found')
				else:
					for file_name in params.files_to_display:
						file_content = file_system.display_file(file_name)
						if file_content:
							attachments.append(file_name)
						elif os.path.exists(file_name):
							attachments.append(file_name)

			# Convert relative paths to absolute paths - handle both FileSystem-managed and regular files
			resolved_attachments = []
			for file_name in attachments:
				if os.path.isabs(file_name):
					# Already absolute
					resolved_attachments.append(file_name)
				elif file_system.get_file(file_name):
					# Managed by FileSystem
					resolved_attachments.append(str(file_system.get_dir() / file_name))
				elif os.path.exists(file_name):
					# Regular file in current directory
					resolved_attachments.append(os.path.abspath(file_name))
				else:
					# File doesn't exist, but include the path anyway for error visibility
					resolved_attachments.append(str(file_system.get_dir() / file_name))
			attachments = resolved_attachments

			return ActionResult(
				is_done=True,
				success=params.success,
				extracted_content=user_message,
				long_term_memory=memory,
				attachments=attachments,
			)

		# Override upload_file for code agent with relaxed path validation
		@self.registry.action(
			'Upload a file to a file input element. For code-use mode, any file accessible from the current directory can be uploaded.',
			param_model=UploadFileAction,
		)
		async def upload_file(
			params: UploadFileAction,
			browser_session: BrowserSession,
			available_file_paths: list[str],
			file_system: FileSystem,
		):
			# Path validation logic for code-use mode:
			# 1. If available_file_paths provided (security mode), enforce it as a whitelist
			# 2. If no whitelist, for local browsers just check file exists
			# 3. For remote browsers, allow any path (assume it exists remotely)

			# If whitelist provided, validate path is in it
			if available_file_paths:
				if params.path not in available_file_paths:
					# Also check if it's a recently downloaded file
					downloaded_files = browser_session.downloaded_files
					if params.path not in downloaded_files:
						# Finally, check if it's a file in the FileSystem service (if provided)
						if file_system is not None and file_system.get_dir():
							# Check if the file is actually managed by the FileSystem service
							# The path should be just the filename for FileSystem files
							file_obj = file_system.get_file(params.path)
							if file_obj:
								# File is managed by FileSystem, construct the full path
								file_system_path = str(file_system.get_dir() / params.path)
								params = UploadFileAction(index=params.index, path=file_system_path)
							else:
								# If browser is remote, allow passing a remote-accessible absolute path
								if not browser_session.is_local:
									pass
								else:
									msg = f'File path {params.path} is not available. To fix: add this file path to the available_file_paths parameter when creating the Agent. Example: Agent(task="...", llm=llm, browser=browser, available_file_paths=["{params.path}"])'
									logger.error(f'❌ {msg}')
									return ActionResult(error=msg)
						else:
							# If browser is remote, allow passing a remote-accessible absolute path
							if not browser_session.is_local:
								pass
							else:
								msg = f'File path {params.path} is not available. To fix: add this file path to the available_file_paths parameter when creating the Agent. Example: Agent(task="...", llm=llm, browser=browser, available_file_paths=["{params.path}"])'
								logger.error(f'❌ {msg}')
								return ActionResult(error=msg)

			# For local browsers, ensure the file exists on the local filesystem
			if browser_session.is_local:
				if not os.path.exists(params.path):
					msg = f'File {params.path} does not exist'
					return ActionResult(error=msg)

			# Get the selector map to find the node
			selector_map = await browser_session.get_selector_map()
			if params.index not in selector_map:
				msg = f'Element with index {params.index} does not exist.'
				return ActionResult(error=msg)

			node = selector_map[params.index]

			# Helper function to find file input near the selected element
			def find_file_input_near_element(
				node: EnhancedDOMTreeNode, max_height: int = 3, max_descendant_depth: int = 3
			) -> EnhancedDOMTreeNode | None:
				"""Find the closest file input to the selected element."""

				def find_file_input_in_descendants(n: EnhancedDOMTreeNode, depth: int) -> EnhancedDOMTreeNode | None:
					if depth < 0:
						return None
					if browser_session.is_file_input(n):
						return n
					for child in n.children_nodes or []:
						result = find_file_input_in_descendants(child, depth - 1)
						if result:
							return result
					return None

				current = node
				for _ in range(max_height + 1):
					# Check the current node itself
					if browser_session.is_file_input(current):
						return current
					# Check all descendants of the current node
					result = find_file_input_in_descendants(current, max_descendant_depth)
					if result:
						return result
					# Check all siblings and their descendants
					if current.parent_node:
						for sibling in current.parent_node.children_nodes or []:
							if sibling is current:
								continue
							if browser_session.is_file_input(sibling):
								return sibling
							result = find_file_input_in_descendants(sibling, max_descendant_depth)
							if result:
								return result
					current = current.parent_node
					if not current:
						break
				return None

			# Try to find a file input element near the selected element
			file_input_node = find_file_input_near_element(node)

			# Highlight the file input element if found (truly non-blocking)
			if file_input_node:
				create_task_with_error_handling(
					browser_session.highlight_interaction_element(file_input_node),
					name='highlight_file_input',
					suppress_exceptions=True,
				)

			# If not found near the selected element, fallback to finding the closest file input to current scroll position
			if file_input_node is None:
				logger.info(
					f'No file upload element found near index {params.index}, searching for closest file input to scroll position'
				)

				# Get current scroll position
				cdp_session = await browser_session.get_or_create_cdp_session()
				try:
					scroll_info = await cdp_session.cdp_client.send.Runtime.evaluate(
						params={'expression': 'window.scrollY || window.pageYOffset || 0'}, session_id=cdp_session.session_id
					)
					current_scroll_y = scroll_info.get('result', {}).get('value', 0)
				except Exception:
					current_scroll_y = 0

				# Find all file inputs in the selector map and pick the closest one to scroll position
				closest_file_input = None
				min_distance = float('inf')

				for idx, element in selector_map.items():
					if browser_session.is_file_input(element):
						# Get element's Y position
						if element.absolute_position:
							element_y = element.absolute_position.y
							distance = abs(element_y - current_scroll_y)
							if distance < min_distance:
								min_distance = distance
								closest_file_input = element

				if closest_file_input:
					file_input_node = closest_file_input
					logger.info(f'Found file input closest to scroll position (distance: {min_distance}px)')

					# Highlight the fallback file input element (truly non-blocking)
					create_task_with_error_handling(
						browser_session.highlight_interaction_element(file_input_node),
						name='highlight_file_input_fallback',
						suppress_exceptions=True,
					)
				else:
					msg = 'No file upload element found on the page'
					logger.error(msg)
					raise BrowserError(msg)
					# TODO: figure out why this fails sometimes + add fallback hail mary, just look for any file input on page

			# Dispatch upload file event with the file input node
			try:
				event = browser_session.event_bus.dispatch(UploadFileEvent(node=file_input_node, file_path=params.path))
				await event
				await event.event_result(raise_if_any=True, raise_if_none=False)
				msg = f'Successfully uploaded file to index {params.index}'
				logger.info(f'📁 {msg}')
				return ActionResult(
					extracted_content=msg,
					long_term_memory=f'Uploaded file {params.path} to element {params.index}',
				)
			except Exception as e:
				logger.error(f'Failed to upload file: {e}')
				raise BrowserError(f'Failed to upload file: {e}')

```

---

## backend/browser-use/browser_use/tools/utils.py

```py
"""Utility functions for browser tools."""

from browser_use.dom.service import EnhancedDOMTreeNode


def get_click_description(node: EnhancedDOMTreeNode) -> str:
	"""Get a brief description of the clicked element for memory."""
	parts = []

	# Tag name
	parts.append(node.tag_name)

	# Add type for inputs
	if node.tag_name == 'input' and node.attributes.get('type'):
		input_type = node.attributes['type']
		parts.append(f'type={input_type}')

		# For checkboxes, include checked state
		if input_type == 'checkbox':
			is_checked = node.attributes.get('checked', 'false').lower() in ['true', 'checked', '']
			# Also check AX node
			if node.ax_node and node.ax_node.properties:
				for prop in node.ax_node.properties:
					if prop.name == 'checked':
						is_checked = prop.value is True or prop.value == 'true'
						break
			state = 'checked' if is_checked else 'unchecked'
			parts.append(f'checkbox-state={state}')

	# Add role if present
	if node.attributes.get('role'):
		role = node.attributes['role']
		parts.append(f'role={role}')

		# For role=checkbox, include state
		if role == 'checkbox':
			aria_checked = node.attributes.get('aria-checked', 'false').lower()
			is_checked = aria_checked in ['true', 'checked']
			if node.ax_node and node.ax_node.properties:
				for prop in node.ax_node.properties:
					if prop.name == 'checked':
						is_checked = prop.value is True or prop.value == 'true'
						break
			state = 'checked' if is_checked else 'unchecked'
			parts.append(f'checkbox-state={state}')

	# For labels/spans/divs, check if related to a hidden checkbox
	if node.tag_name in ['label', 'span', 'div'] and 'type=' not in ' '.join(parts):
		# Check children for hidden checkbox
		for child in node.children:
			if child.tag_name == 'input' and child.attributes.get('type') == 'checkbox':
				# Check if hidden
				is_hidden = False
				if child.snapshot_node and child.snapshot_node.computed_styles:
					opacity = child.snapshot_node.computed_styles.get('opacity', '1')
					if opacity == '0' or opacity == '0.0':
						is_hidden = True

				if is_hidden or not child.is_visible:
					# Get checkbox state
					is_checked = child.attributes.get('checked', 'false').lower() in ['true', 'checked', '']
					if child.ax_node and child.ax_node.properties:
						for prop in child.ax_node.properties:
							if prop.name == 'checked':
								is_checked = prop.value is True or prop.value == 'true'
								break
					state = 'checked' if is_checked else 'unchecked'
					parts.append(f'checkbox-state={state}')
					break

	# Add short text content if available
	text = node.get_all_children_text().strip()
	if text:
		short_text = text[:30] + ('...' if len(text) > 30 else '')
		parts.append(f'"{short_text}"')

	# Add key attributes like id, name, aria-label
	for attr in ['id', 'name', 'aria-label']:
		if node.attributes.get(attr):
			parts.append(f'{attr}={node.attributes[attr][:20]}')

	return ' '.join(parts)

```

---

## backend/browser-use/browser_use/tools/views.py

```py
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field


# Action Input Models
class ExtractAction(BaseModel):
	query: str
	extract_links: bool = Field(
		default=False, description='Set True to true if the query requires links, else false to safe tokens'
	)
	start_from_char: int = Field(
		default=0, description='Use this for long markdowns to start from a specific character (not index in browser_state)'
	)


class SearchAction(BaseModel):
	query: str
	engine: str = Field(
		default='duckduckgo', description='duckduckgo, google, bing (use duckduckgo by default because less captchas)'
	)


# Backward compatibility alias
SearchAction = SearchAction


class NavigateAction(BaseModel):
	url: str
	new_tab: bool = Field(default=False)


# Backward compatibility alias
GoToUrlAction = NavigateAction


class ClickElementAction(BaseModel):
	index: int | None = Field(default=None, ge=1, description='Element index from browser_state')
	coordinate_x: int | None = Field(default=None, description='Horizontal coordinate relative to viewport left edge')
	coordinate_y: int | None = Field(default=None, description='Vertical coordinate relative to viewport top edge')
	force: bool = Field(default=False, description='If True, skip safety checks (file input, print, select)')
	# expect_download: bool = Field(default=False, description='set True if expecting a download, False otherwise')  # moved to downloads_watchdog.py
	# click_count: int = 1  # TODO


class InputTextAction(BaseModel):
	index: int = Field(ge=0, description='from browser_state')
	text: str
	clear: bool = Field(default=True, description='1=clear, 0=append')


class DoneAction(BaseModel):
	text: str = Field(description='Final user message in the format the user requested')
	success: bool = Field(default=True, description='True if user_request completed successfully')
	files_to_display: list[str] | None = Field(default=[])


T = TypeVar('T', bound=BaseModel)


class StructuredOutputAction(BaseModel, Generic[T]):
	success: bool = Field(default=True, description='True if user_request completed successfully')
	data: T = Field(description='The actual output data matching the requested schema')


class SwitchTabAction(BaseModel):
	tab_id: str = Field(min_length=4, max_length=4, description='4-char id')


class CloseTabAction(BaseModel):
	tab_id: str = Field(min_length=4, max_length=4, description='4-char id')


class ScrollAction(BaseModel):
	down: bool = Field(default=True, description='down=True=scroll down, down=False scroll up')
	pages: float = Field(default=1.0, description='0.5=half page, 1=full page, 10=to bottom/top')
	index: int | None = Field(default=None, description='Optional element index to scroll within specific container')


class SendKeysAction(BaseModel):
	keys: str = Field(description='keys (Escape, Enter, PageDown) or shortcuts (Control+o)')


class UploadFileAction(BaseModel):
	index: int
	path: str


class NoParamsAction(BaseModel):
	model_config = ConfigDict(extra='ignore')


class GetDropdownOptionsAction(BaseModel):
	index: int


class SelectDropdownOptionAction(BaseModel):
	index: int
	text: str = Field(description='exact text/value')

```

---

## backend/browser-use/browser_use/utils.py

```py
import asyncio
import logging
import os
import platform
import re
import signal
import time
from collections.abc import Callable, Coroutine
from fnmatch import fnmatch
from functools import cache, wraps
from pathlib import Path
from sys import stderr
from typing import Any, ParamSpec, TypeVar
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv

load_dotenv()

# Pre-compiled regex for URL detection - used in URL shortening
URL_PATTERN = re.compile(r'https?://[^\s<>"\']+|www\.[^\s<>"\']+|[^\s<>"\']+\.[a-z]{2,}(?:/[^\s<>"\']*)?', re.IGNORECASE)


logger = logging.getLogger(__name__)

# Import error types - these may need to be adjusted based on actual import paths
try:
	from openai import BadRequestError as OpenAIBadRequestError
except ImportError:
	OpenAIBadRequestError = None

try:
	from groq import BadRequestError as GroqBadRequestError  # type: ignore[import-not-found]
except ImportError:
	GroqBadRequestError = None


# Global flag to prevent duplicate exit messages
_exiting = False

# Define generic type variables for return type and parameters
R = TypeVar('R')
T = TypeVar('T')
P = ParamSpec('P')


class SignalHandler:
	"""
	A modular and reusable signal handling system for managing SIGINT (Ctrl+C), SIGTERM,
	and other signals in asyncio applications.

	This class provides:
	- Configurable signal handling for SIGINT and SIGTERM
	- Support for custom pause/resume callbacks
	- Management of event loop state across signals
	- Standardized handling of first and second Ctrl+C presses
	- Cross-platform compatibility (with simplified behavior on Windows)
	"""

	def __init__(
		self,
		loop: asyncio.AbstractEventLoop | None = None,
		pause_callback: Callable[[], None] | None = None,
		resume_callback: Callable[[], None] | None = None,
		custom_exit_callback: Callable[[], None] | None = None,
		exit_on_second_int: bool = True,
		interruptible_task_patterns: list[str] | None = None,
	):
		"""
		Initialize the signal handler.

		Args:
			loop: The asyncio event loop to use. Defaults to current event loop.
			pause_callback: Function to call when system is paused (first Ctrl+C)
			resume_callback: Function to call when system is resumed
			custom_exit_callback: Function to call on exit (second Ctrl+C or SIGTERM)
			exit_on_second_int: Whether to exit on second SIGINT (Ctrl+C)
			interruptible_task_patterns: List of patterns to match task names that should be
										 canceled on first Ctrl+C (default: ['step', 'multi_act', 'get_next_action'])
		"""
		self.loop = loop or asyncio.get_event_loop()
		self.pause_callback = pause_callback
		self.resume_callback = resume_callback
		self.custom_exit_callback = custom_exit_callback
		self.exit_on_second_int = exit_on_second_int
		self.interruptible_task_patterns = interruptible_task_patterns or ['step', 'multi_act', 'get_next_action']
		self.is_windows = platform.system() == 'Windows'

		# Initialize loop state attributes
		self._initialize_loop_state()

		# Store original signal handlers to restore them later if needed
		self.original_sigint_handler = None
		self.original_sigterm_handler = None

	def _initialize_loop_state(self) -> None:
		"""Initialize loop state attributes used for signal handling."""
		setattr(self.loop, 'ctrl_c_pressed', False)
		setattr(self.loop, 'waiting_for_input', False)

	def register(self) -> None:
		"""Register signal handlers for SIGINT and SIGTERM."""
		try:
			if self.is_windows:
				# On Windows, use simple signal handling with immediate exit on Ctrl+C
				def windows_handler(sig, frame):
					print('\n\n🛑 Got Ctrl+C. Exiting immediately on Windows...\n', file=stderr)
					# Run the custom exit callback if provided
					if self.custom_exit_callback:
						self.custom_exit_callback()
					os._exit(0)

				self.original_sigint_handler = signal.signal(signal.SIGINT, windows_handler)
			else:
				# On Unix-like systems, use asyncio's signal handling for smoother experience
				self.original_sigint_handler = self.loop.add_signal_handler(signal.SIGINT, lambda: self.sigint_handler())
				self.original_sigterm_handler = self.loop.add_signal_handler(signal.SIGTERM, lambda: self.sigterm_handler())

		except Exception:
			# there are situations where signal handlers are not supported, e.g.
			# - when running in a thread other than the main thread
			# - some operating systems
			# - inside jupyter notebooks
			pass

	def unregister(self) -> None:
		"""Unregister signal handlers and restore original handlers if possible."""
		try:
			if self.is_windows:
				# On Windows, just restore the original SIGINT handler
				if self.original_sigint_handler:
					signal.signal(signal.SIGINT, self.original_sigint_handler)
			else:
				# On Unix-like systems, use asyncio's signal handler removal
				self.loop.remove_signal_handler(signal.SIGINT)
				self.loop.remove_signal_handler(signal.SIGTERM)

				# Restore original handlers if available
				if self.original_sigint_handler:
					signal.signal(signal.SIGINT, self.original_sigint_handler)
				if self.original_sigterm_handler:
					signal.signal(signal.SIGTERM, self.original_sigterm_handler)
		except Exception as e:
			logger.warning(f'Error while unregistering signal handlers: {e}')

	def _handle_second_ctrl_c(self) -> None:
		"""
		Handle a second Ctrl+C press by performing cleanup and exiting.
		This is shared logic used by both sigint_handler and wait_for_resume.
		"""
		global _exiting

		if not _exiting:
			_exiting = True

			# Call custom exit callback if provided
			if self.custom_exit_callback:
				try:
					self.custom_exit_callback()
				except Exception as e:
					logger.error(f'Error in exit callback: {e}')

		# Force immediate exit - more reliable than sys.exit()
		print('\n\n🛑  Got second Ctrl+C. Exiting immediately...\n', file=stderr)

		# Reset terminal to a clean state by sending multiple escape sequences
		# Order matters for terminal resets - we try different approaches

		# Reset terminal modes for both stdout and stderr
		print('\033[?25h', end='', flush=True, file=stderr)  # Show cursor
		print('\033[?25h', end='', flush=True)  # Show cursor

		# Reset text attributes and terminal modes
		print('\033[0m', end='', flush=True, file=stderr)  # Reset text attributes
		print('\033[0m', end='', flush=True)  # Reset text attributes

		# Disable special input modes that may cause arrow keys to output control chars
		print('\033[?1l', end='', flush=True, file=stderr)  # Reset cursor keys to normal mode
		print('\033[?1l', end='', flush=True)  # Reset cursor keys to normal mode

		# Disable bracketed paste mode
		print('\033[?2004l', end='', flush=True, file=stderr)
		print('\033[?2004l', end='', flush=True)

		# Carriage return helps ensure a clean line
		print('\r', end='', flush=True, file=stderr)
		print('\r', end='', flush=True)

		# these ^^ attempts dont work as far as we can tell
		# we still dont know what causes the broken input, if you know how to fix it, please let us know
		print('(tip: press [Enter] once to fix escape codes appearing after chrome exit)', file=stderr)

		os._exit(0)

	def sigint_handler(self) -> None:
		"""
		SIGINT (Ctrl+C) handler.

		First Ctrl+C: Cancel current step and pause.
		Second Ctrl+C: Exit immediately if exit_on_second_int is True.
		"""
		global _exiting

		if _exiting:
			# Already exiting, force exit immediately
			os._exit(0)

		if getattr(self.loop, 'ctrl_c_pressed', False):
			# If we're in the waiting for input state, let the pause method handle it
			if getattr(self.loop, 'waiting_for_input', False):
				return

			# Second Ctrl+C - exit immediately if configured to do so
			if self.exit_on_second_int:
				self._handle_second_ctrl_c()

		# Mark that Ctrl+C was pressed
		setattr(self.loop, 'ctrl_c_pressed', True)

		# Cancel current tasks that should be interruptible - this is crucial for immediate pausing
		self._cancel_interruptible_tasks()

		# Call pause callback if provided - this sets the paused flag
		if self.pause_callback:
			try:
				self.pause_callback()
			except Exception as e:
				logger.error(f'Error in pause callback: {e}')

		# Log pause message after pause_callback is called (not before)
		print('----------------------------------------------------------------------', file=stderr)

	def sigterm_handler(self) -> None:
		"""
		SIGTERM handler.

		Always exits the program completely.
		"""
		global _exiting
		if not _exiting:
			_exiting = True
			print('\n\n🛑 SIGTERM received. Exiting immediately...\n\n', file=stderr)

			# Call custom exit callback if provided
			if self.custom_exit_callback:
				self.custom_exit_callback()

		os._exit(0)

	def _cancel_interruptible_tasks(self) -> None:
		"""Cancel current tasks that should be interruptible."""
		current_task = asyncio.current_task(self.loop)
		for task in asyncio.all_tasks(self.loop):
			if task != current_task and not task.done():
				task_name = task.get_name() if hasattr(task, 'get_name') else str(task)
				# Cancel tasks that match certain patterns
				if any(pattern in task_name for pattern in self.interruptible_task_patterns):
					logger.debug(f'Cancelling task: {task_name}')
					task.cancel()
					# Add exception handler to silence "Task exception was never retrieved" warnings
					task.add_done_callback(lambda t: t.exception() if t.cancelled() else None)

		# Also cancel the current task if it's interruptible
		if current_task and not current_task.done():
			task_name = current_task.get_name() if hasattr(current_task, 'get_name') else str(current_task)
			if any(pattern in task_name for pattern in self.interruptible_task_patterns):
				logger.debug(f'Cancelling current task: {task_name}')
				current_task.cancel()

	def wait_for_resume(self) -> None:
		"""
		Wait for user input to resume or exit.

		This method should be called after handling the first Ctrl+C.
		It temporarily restores default signal handling to allow catching
		a second Ctrl+C directly.
		"""
		# Set flag to indicate we're waiting for input
		setattr(self.loop, 'waiting_for_input', True)

		# Temporarily restore default signal handling for SIGINT
		# This ensures KeyboardInterrupt will be raised during input()
		original_handler = signal.getsignal(signal.SIGINT)
		try:
			signal.signal(signal.SIGINT, signal.default_int_handler)
		except ValueError:
			# we are running in a thread other than the main thread
			# or signal handlers are not supported for some other reason
			pass

		green = '\x1b[32;1m'
		red = '\x1b[31m'
		blink = '\033[33;5m'
		unblink = '\033[0m'
		reset = '\x1b[0m'

		try:  # escape code is to blink the ...
			print(
				f'➡️  Press {green}[Enter]{reset} to resume or {red}[Ctrl+C]{reset} again to exit{blink}...{unblink} ',
				end='',
				flush=True,
				file=stderr,
			)
			input()  # This will raise KeyboardInterrupt on Ctrl+C

			# Call resume callback if provided
			if self.resume_callback:
				self.resume_callback()
		except KeyboardInterrupt:
			# Use the shared method to handle second Ctrl+C
			self._handle_second_ctrl_c()
		finally:
			try:
				# Restore our signal handler
				signal.signal(signal.SIGINT, original_handler)
				setattr(self.loop, 'waiting_for_input', False)
			except Exception:
				pass

	def reset(self) -> None:
		"""Reset state after resuming."""
		# Clear the flags
		if hasattr(self.loop, 'ctrl_c_pressed'):
			setattr(self.loop, 'ctrl_c_pressed', False)
		if hasattr(self.loop, 'waiting_for_input'):
			setattr(self.loop, 'waiting_for_input', False)


def time_execution_sync(additional_text: str = '') -> Callable[[Callable[P, R]], Callable[P, R]]:
	def decorator(func: Callable[P, R]) -> Callable[P, R]:
		@wraps(func)
		def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
			start_time = time.time()
			result = func(*args, **kwargs)
			execution_time = time.time() - start_time
			# Only log if execution takes more than 0.25 seconds
			if execution_time > 0.25:
				self_has_logger = args and getattr(args[0], 'logger', None)
				if self_has_logger:
					logger = getattr(args[0], 'logger')
				elif 'agent' in kwargs:
					logger = getattr(kwargs['agent'], 'logger')
				elif 'browser_session' in kwargs:
					logger = getattr(kwargs['browser_session'], 'logger')
				else:
					logger = logging.getLogger(__name__)
				logger.debug(f'⏳ {additional_text.strip("-")}() took {execution_time:.2f}s')
			return result

		return wrapper

	return decorator


def time_execution_async(
	additional_text: str = '',
) -> Callable[[Callable[P, Coroutine[Any, Any, R]]], Callable[P, Coroutine[Any, Any, R]]]:
	def decorator(func: Callable[P, Coroutine[Any, Any, R]]) -> Callable[P, Coroutine[Any, Any, R]]:
		@wraps(func)
		async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
			start_time = time.time()
			result = await func(*args, **kwargs)
			execution_time = time.time() - start_time
			# Only log if execution takes more than 0.25 seconds to avoid spamming the logs
			# you can lower this threshold locally when you're doing dev work to performance optimize stuff
			if execution_time > 0.25:
				self_has_logger = args and getattr(args[0], 'logger', None)
				if self_has_logger:
					logger = getattr(args[0], 'logger')
				elif 'agent' in kwargs:
					logger = getattr(kwargs['agent'], 'logger')
				elif 'browser_session' in kwargs:
					logger = getattr(kwargs['browser_session'], 'logger')
				else:
					logger = logging.getLogger(__name__)
				logger.debug(f'⏳ {additional_text.strip("-")}() took {execution_time:.2f}s')
			return result

		return wrapper

	return decorator


def singleton(cls):
	instance = [None]

	def wrapper(*args, **kwargs):
		if instance[0] is None:
			instance[0] = cls(*args, **kwargs)
		return instance[0]

	return wrapper


def check_env_variables(keys: list[str], any_or_all=all) -> bool:
	"""Check if all required environment variables are set"""
	return any_or_all(os.getenv(key, '').strip() for key in keys)


def is_unsafe_pattern(pattern: str) -> bool:
	"""
	Check if a domain pattern has complex wildcards that could match too many domains.

	Args:
		pattern: The domain pattern to check

	Returns:
		bool: True if the pattern has unsafe wildcards, False otherwise
	"""
	# Extract domain part if there's a scheme
	if '://' in pattern:
		_, pattern = pattern.split('://', 1)

	# Remove safe patterns (*.domain and domain.*)
	bare_domain = pattern.replace('.*', '').replace('*.', '')

	# If there are still wildcards, it's potentially unsafe
	return '*' in bare_domain


def is_new_tab_page(url: str) -> bool:
	"""
	Check if a URL is a new tab page (about:blank, chrome://new-tab-page, or chrome://newtab).

	Args:
		url: The URL to check

	Returns:
		bool: True if the URL is a new tab page, False otherwise
	"""
	return url in ('about:blank', 'chrome://new-tab-page/', 'chrome://new-tab-page', 'chrome://newtab/', 'chrome://newtab')


def match_url_with_domain_pattern(url: str, domain_pattern: str, log_warnings: bool = False) -> bool:
	"""
	Check if a URL matches a domain pattern. SECURITY CRITICAL.

	Supports optional glob patterns and schemes:
	- *.example.com will match sub.example.com and example.com
	- *google.com will match google.com, agoogle.com, and www.google.com
	- http*://example.com will match http://example.com, https://example.com
	- chrome-extension://* will match chrome-extension://aaaaaaaaaaaa and chrome-extension://bbbbbbbbbbbbb

	When no scheme is specified, https is used by default for security.
	For example, 'example.com' will match 'https://example.com' but not 'http://example.com'.

	Note: New tab pages (about:blank, chrome://new-tab-page) must be handled at the callsite, not inside this function.

	Args:
		url: The URL to check
		domain_pattern: Domain pattern to match against
		log_warnings: Whether to log warnings about unsafe patterns

	Returns:
		bool: True if the URL matches the pattern, False otherwise
	"""
	try:
		# Note: new tab pages should be handled at the callsite, not here
		if is_new_tab_page(url):
			return False

		parsed_url = urlparse(url)

		# Extract only the hostname and scheme components
		scheme = parsed_url.scheme.lower() if parsed_url.scheme else ''
		domain = parsed_url.hostname.lower() if parsed_url.hostname else ''

		if not scheme or not domain:
			return False

		# Normalize the domain pattern
		domain_pattern = domain_pattern.lower()

		# Handle pattern with scheme
		if '://' in domain_pattern:
			pattern_scheme, pattern_domain = domain_pattern.split('://', 1)
		else:
			pattern_scheme = 'https'  # Default to matching only https for security
			pattern_domain = domain_pattern

		# Handle port in pattern (we strip ports from patterns since we already
		# extracted only the hostname from the URL)
		if ':' in pattern_domain and not pattern_domain.startswith(':'):
			pattern_domain = pattern_domain.split(':', 1)[0]

		# If scheme doesn't match, return False
		if not fnmatch(scheme, pattern_scheme):
			return False

		# Check for exact match
		if pattern_domain == '*' or domain == pattern_domain:
			return True

		# Handle glob patterns
		if '*' in pattern_domain:
			# Check for unsafe glob patterns
			# First, check for patterns like *.*.domain which are unsafe
			if pattern_domain.count('*.') > 1 or pattern_domain.count('.*') > 1:
				if log_warnings:
					logger = logging.getLogger(__name__)
					logger.error(f'⛔️ Multiple wildcards in pattern=[{domain_pattern}] are not supported')
				return False  # Don't match unsafe patterns

			# Check for wildcards in TLD part (example.*)
			if pattern_domain.endswith('.*'):
				if log_warnings:
					logger = logging.getLogger(__name__)
					logger.error(f'⛔️ Wildcard TLDs like in pattern=[{domain_pattern}] are not supported for security')
				return False  # Don't match unsafe patterns

			# Then check for embedded wildcards
			bare_domain = pattern_domain.replace('*.', '')
			if '*' in bare_domain:
				if log_warnings:
					logger = logging.getLogger(__name__)
					logger.error(f'⛔️ Only *.domain style patterns are supported, ignoring pattern=[{domain_pattern}]')
				return False  # Don't match unsafe patterns

			# Special handling so that *.google.com also matches bare google.com
			if pattern_domain.startswith('*.'):
				parent_domain = pattern_domain[2:]
				if domain == parent_domain or fnmatch(domain, parent_domain):
					return True

			# Normal case: match domain against pattern
			if fnmatch(domain, pattern_domain):
				return True

		return False
	except Exception as e:
		logger = logging.getLogger(__name__)
		logger.error(f'⛔️ Error matching URL {url} with pattern {domain_pattern}: {type(e).__name__}: {e}')
		return False


def merge_dicts(a: dict, b: dict, path: tuple[str, ...] = ()):
	for key in b:
		if key in a:
			if isinstance(a[key], dict) and isinstance(b[key], dict):
				merge_dicts(a[key], b[key], path + (str(key),))
			elif isinstance(a[key], list) and isinstance(b[key], list):
				a[key] = a[key] + b[key]
			elif a[key] != b[key]:
				raise Exception('Conflict at ' + '.'.join(path + (str(key),)))
		else:
			a[key] = b[key]
	return a


@cache
def get_browser_use_version() -> str:
	"""Get the browser-use package version using the same logic as Agent._set_browser_use_version_and_source"""
	try:
		package_root = Path(__file__).parent.parent
		pyproject_path = package_root / 'pyproject.toml'

		# Try to read version from pyproject.toml
		if pyproject_path.exists():
			import re

			with open(pyproject_path, encoding='utf-8') as f:
				content = f.read()
				match = re.search(r'version\s*=\s*["\']([^"\']+)["\']', content)
				if match:
					version = f'{match.group(1)}'
					os.environ['LIBRARY_VERSION'] = version  # used by bubus event_schema so all Event schemas include versioning
					return version

		# If pyproject.toml doesn't exist, try getting version from pip
		from importlib.metadata import version as get_version

		version = str(get_version('browser-use'))
		os.environ['LIBRARY_VERSION'] = version
		return version

	except Exception as e:
		logger.debug(f'Error detecting browser-use version: {type(e).__name__}: {e}')
		return 'unknown'


async def check_latest_browser_use_version() -> str | None:
	"""Check the latest version of browser-use from PyPI asynchronously.

	Returns:
		The latest version string if successful, None if failed
	"""
	try:
		async with httpx.AsyncClient(timeout=3.0) as client:
			response = await client.get('https://pypi.org/pypi/browser-use/json')
			if response.status_code == 200:
				data = response.json()
				return data['info']['version']
	except Exception:
		# Silently fail - we don't want to break agent startup due to network issues
		pass
	return None


@cache
def get_git_info() -> dict[str, str] | None:
	"""Get git information if installed from git repository"""
	try:
		import subprocess

		package_root = Path(__file__).parent.parent
		git_dir = package_root / '.git'
		if not git_dir.exists():
			return None

		# Get git commit hash
		commit_hash = (
			subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=package_root, stderr=subprocess.DEVNULL).decode().strip()
		)

		# Get git branch
		branch = (
			subprocess.check_output(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd=package_root, stderr=subprocess.DEVNULL)
			.decode()
			.strip()
		)

		# Get remote URL
		remote_url = (
			subprocess.check_output(['git', 'config', '--get', 'remote.origin.url'], cwd=package_root, stderr=subprocess.DEVNULL)
			.decode()
			.strip()
		)

		# Get commit timestamp
		commit_timestamp = (
			subprocess.check_output(['git', 'show', '-s', '--format=%ci', 'HEAD'], cwd=package_root, stderr=subprocess.DEVNULL)
			.decode()
			.strip()
		)

		return {'commit_hash': commit_hash, 'branch': branch, 'remote_url': remote_url, 'commit_timestamp': commit_timestamp}
	except Exception as e:
		logger.debug(f'Error getting git info: {type(e).__name__}: {e}')
		return None


def _log_pretty_path(path: str | Path | None) -> str:
	"""Pretty-print a path, shorten home dir to ~ and cwd to ."""

	if not path or not str(path).strip():
		return ''  # always falsy in -> falsy out so it can be used in ternaries

	# dont print anything thats not a path
	if not isinstance(path, (str, Path)):
		# no other types are safe to just str(path) and log to terminal unless we know what they are
		# e.g. what if we get storage_date=dict | Path and the dict version could contain real cookies
		return f'<{type(path).__name__}>'

	# replace home dir and cwd with ~ and .
	pretty_path = str(path).replace(str(Path.home()), '~').replace(str(Path.cwd().resolve()), '.')

	# wrap in quotes if it contains spaces
	if pretty_path.strip() and ' ' in pretty_path:
		pretty_path = f'"{pretty_path}"'

	return pretty_path


def _log_pretty_url(s: str, max_len: int | None = 22) -> str:
	"""Truncate/pretty-print a URL with a maximum length, removing the protocol and www. prefix"""
	s = s.replace('https://', '').replace('http://', '').replace('www.', '')
	if max_len is not None and len(s) > max_len:
		return s[:max_len] + '…'
	return s


def create_task_with_error_handling(
	coro: Coroutine[Any, Any, T],
	*,
	name: str | None = None,
	logger_instance: logging.Logger | None = None,
	suppress_exceptions: bool = False,
) -> asyncio.Task[T]:
	"""
	Create an asyncio task with proper exception handling to prevent "Task exception was never retrieved" warnings.

	Args:
		coro: The coroutine to wrap in a task
		name: Optional name for the task (useful for debugging)
		logger_instance: Optional logger instance to use. If None, uses module logger.
		suppress_exceptions: If True, logs exceptions at ERROR level. If False, logs at WARNING level
			and exceptions remain retrievable via task.exception() if the caller awaits the task.
			Default False.

	Returns:
		asyncio.Task: The created task with exception handling callback

	Example:
		# Fire-and-forget with suppressed exceptions
		create_task_with_error_handling(some_async_function(), name="my_task", suppress_exceptions=True)

		# Task with retrievable exceptions (if you plan to await it)
		task = create_task_with_error_handling(critical_function(), name="critical")
		result = await task  # Will raise the exception if one occurred
	"""
	task = asyncio.create_task(coro, name=name)
	log = logger_instance or logger

	def _handle_task_exception(t: asyncio.Task[T]) -> None:
		"""Callback to handle task exceptions"""
		exc_to_raise = None
		try:
			# This will raise if the task had an exception
			exc = t.exception()
			if exc is not None:
				task_name = t.get_name() if hasattr(t, 'get_name') else 'unnamed'
				if suppress_exceptions:
					log.error(f'Exception in background task [{task_name}]: {type(exc).__name__}: {exc}', exc_info=exc)
				else:
					# Log at warning level then mark for re-raising
					log.warning(
						f'Exception in background task [{task_name}]: {type(exc).__name__}: {exc}',
						exc_info=exc,
					)
					exc_to_raise = exc
		except asyncio.CancelledError:
			# Task was cancelled, this is normal behavior
			pass
		except Exception as e:
			# Catch any other exception during exception handling (e.g., t.exception() itself failing)
			task_name = t.get_name() if hasattr(t, 'get_name') else 'unnamed'
			log.error(f'Error handling exception in task [{task_name}]: {type(e).__name__}: {e}')

		# Re-raise outside the try-except block so it propagates to the event loop
		if exc_to_raise is not None:
			raise exc_to_raise

	task.add_done_callback(_handle_task_exception)
	return task


def sanitize_surrogates(text: str) -> str:
	"""Remove surrogate characters that can't be encoded in UTF-8.

	Surrogate pairs (U+D800 to U+DFFF) are invalid in UTF-8 when unpaired.
	These often appear in DOM content from mathematical symbols or emojis.

	Args:
		text: The text to sanitize

	Returns:
		Text with surrogate characters removed
	"""
	return text.encode('utf-8', errors='ignore').decode('utf-8')

```

---

## backend/browser-use/examples/__init__.py

```py

```

---

## backend/browser-use/examples/api/search/search_url.py

```py
"""
Search URL API Example

This example shows how to use the Browser Use API to extract specific
content from a given URL based on your query.

Usage:
    # Copy this function and customize the parameters
    result = await search_url("https://example.com", "what to find", depth=2)
"""

import asyncio
import os

import aiohttp
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


async def search_url(url: str, query: str, depth: int = 2):
	# Validate API key exists
	api_key = os.getenv('BROWSER_USE_API_KEY')
	if not api_key:
		print('❌ Error: BROWSER_USE_API_KEY environment variable is not set.')
		print('Please set your API key: export BROWSER_USE_API_KEY="your_api_key_here"')
		return None

	payload = {'url': url, 'query': query, 'depth': depth}

	headers = {'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}

	print('Testing Search URL API...')
	print(f'URL: {url}')
	print(f'Query: {query}')
	print(f'Depth: {depth}')
	print('-' * 50)

	try:
		async with aiohttp.ClientSession() as session:
			async with session.post(
				'https://api.browser-use.com/api/v1/search-url',
				json=payload,
				headers=headers,
				timeout=aiohttp.ClientTimeout(total=300),
			) as response:
				if response.status == 200:
					result = await response.json()
					print('✅ Success!')
					print(f'URL processed: {result.get("url", "N/A")}')
					content = result.get('content', '')
					print(f'Content: {content}')
					return result
				else:
					error_text = await response.text()
					print(f'❌ Error {response.status}: {error_text}')
					return None
	except Exception as e:
		print(f'❌ Exception: {str(e)}')
		return None


if __name__ == '__main__':
	# Example 1: Extract pricing info
	asyncio.run(search_url('https://browser-use.com/#pricing', 'Find pricing information for Browser Use'))

	# Example 2: News article analysis
	# asyncio.run(search_url("https://techcrunch.com", "latest startup funding news", depth=3))

	# Example 3: Product research
	# asyncio.run(search_url("https://github.com/browser-use/browser-use", "installation instructions", depth=2))

```

---

## backend/browser-use/examples/api/search/simple_search.py

```py
"""
Simple Search API Example

This example shows how to use the Browser Use API to search and extract
content from multiple websites based on a query.

Usage:
    # Copy this function and customize the parameters
    result = await simple_search("your search query", max_websites=5, depth=2)
"""

import asyncio
import os

import aiohttp
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


async def simple_search(query: str, max_websites: int = 5, depth: int = 2):
	# Validate API key exists
	api_key = os.getenv('BROWSER_USE_API_KEY')
	if not api_key:
		print('❌ Error: BROWSER_USE_API_KEY environment variable is not set.')
		print('Please set your API key: export BROWSER_USE_API_KEY="your_api_key_here"')
		return None

	payload = {'query': query, 'max_websites': max_websites, 'depth': depth}

	headers = {'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}

	print('Testing Simple Search API...')
	print(f'Query: {query}')
	print(f'Max websites: {max_websites}')
	print(f'Depth: {depth}')
	print('-' * 50)

	try:
		async with aiohttp.ClientSession() as session:
			async with session.post(
				'https://api.browser-use.com/api/v1/simple-search',
				json=payload,
				headers=headers,
				timeout=aiohttp.ClientTimeout(total=300),
			) as response:
				if response.status == 200:
					result = await response.json()
					print('✅ Success!')
					print(f'Results: {len(result.get("results", []))} websites processed')
					for i, item in enumerate(result.get('results', [])[:2], 1):
						print(f'\n{i}. {item.get("url", "N/A")}')
						content = item.get('content', '')
						print(f'   Content: {content}')
					return result
				else:
					error_text = await response.text()
					print(f'❌ Error {response.status}: {error_text}')
					return None
	except Exception as e:
		print(f'❌ Exception: {str(e)}')
		return None


if __name__ == '__main__':
	# Example 1: Basic search
	asyncio.run(simple_search('latest AI news'))

	# Example 2: Custom parameters
	# asyncio.run(simple_search("python web scraping", max_websites=3, depth=3))

	# Example 3: Research query
	# asyncio.run(simple_search("climate change solutions 2024", max_websites=7, depth=2))

```

---

## backend/browser-use/examples/apps/ad-use/ad_generator.py

```py
import argparse
import asyncio
import logging
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from browser_use.utils import create_task_with_error_handling


def setup_environment(debug: bool):
	if not debug:
		os.environ['BROWSER_USE_SETUP_LOGGING'] = 'false'
		os.environ['BROWSER_USE_LOGGING_LEVEL'] = 'critical'
		logging.getLogger().setLevel(logging.CRITICAL)
	else:
		os.environ['BROWSER_USE_SETUP_LOGGING'] = 'true'
		os.environ['BROWSER_USE_LOGGING_LEVEL'] = 'info'


parser = argparse.ArgumentParser(description='Generate ads from landing pages using browser-use + 🍌')
parser.add_argument('--url', nargs='?', help='Landing page URL to analyze')
parser.add_argument('--debug', action='store_true', default=False, help='Enable debug mode (show browser, verbose logs)')
parser.add_argument('--count', type=int, default=1, help='Number of ads to generate in parallel (default: 1)')
group = parser.add_mutually_exclusive_group()
group.add_argument('--instagram', action='store_true', default=False, help='Generate Instagram image ad (default)')
group.add_argument('--tiktok', action='store_true', default=False, help='Generate TikTok video ad using Veo3')
args = parser.parse_args()
if not args.instagram and not args.tiktok:
	args.instagram = True
setup_environment(args.debug)

from typing import Any, cast

import aiofiles
from google import genai
from PIL import Image

from browser_use import Agent, BrowserSession
from browser_use.llm.google import ChatGoogle

GOOGLE_API_KEY = os.getenv('GOOGLE_API_KEY')


class LandingPageAnalyzer:
	def __init__(self, debug: bool = False):
		self.debug = debug
		self.llm = ChatGoogle(model='gemini-2.0-flash-exp', api_key=GOOGLE_API_KEY)
		self.output_dir = Path('output')
		self.output_dir.mkdir(exist_ok=True)

	async def analyze_landing_page(self, url: str, mode: str = 'instagram') -> dict:
		browser_session = BrowserSession(
			headless=not self.debug,
		)

		agent = Agent(
			task=f"""Go to {url} and quickly extract key brand information for Instagram ad creation.

Steps:
1. Navigate to the website
2. From the initial view, extract ONLY these essentials:
   - Brand/Product name
   - Main tagline or value proposition (one sentence)
   - Primary call-to-action text
   - Any visible pricing or special offer
3. Scroll down half a page, twice (0.5 pages each) to check for any key info
4. Done - keep it simple and focused on the brand

Return ONLY the key brand info, not page structure details.""",
			llm=self.llm,
			browser_session=browser_session,
			max_actions_per_step=2,
			step_timeout=30,
			use_thinking=False,
			vision_detail_level='high',
		)

		screenshot_path = None
		timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

		async def screenshot_callback(agent_instance):
			nonlocal screenshot_path
			await asyncio.sleep(4)
			screenshot_path = self.output_dir / f'landing_page_{timestamp}.png'
			await agent_instance.browser_session.take_screenshot(path=str(screenshot_path), full_page=False)

		screenshot_task = create_task_with_error_handling(
			screenshot_callback(agent), name='screenshot_callback', suppress_exceptions=True
		)
		history = await agent.run()
		try:
			await screenshot_task
		except Exception as e:
			print(f'Screenshot task failed: {e}')

		analysis = history.final_result() or 'No analysis content extracted'
		return {'url': url, 'analysis': analysis, 'screenshot_path': screenshot_path, 'timestamp': timestamp}


class AdGenerator:
	def __init__(self, api_key: str | None = GOOGLE_API_KEY, mode: str = 'instagram'):
		if not api_key:
			raise ValueError('GOOGLE_API_KEY is missing or empty – set the environment variable or pass api_key explicitly')

		self.client = genai.Client(api_key=api_key)
		self.output_dir = Path('output')
		self.output_dir.mkdir(exist_ok=True)
		self.mode = mode

	async def create_video_concept(self, browser_analysis: str, ad_id: int) -> str:
		"""Generate a unique creative concept for each video ad"""
		if self.mode != 'tiktok':
			return ''

		concept_prompt = f"""Based on this brand analysis:
{browser_analysis}

Create a UNIQUE and SPECIFIC TikTok video concept #{ad_id}.

Be creative and different! Consider various approaches like:
- Different visual metaphors and storytelling angles
- Various trending TikTok formats (transitions, reveals, transformations)
- Different emotional appeals (funny, inspiring, surprising, relatable)
- Unique visual styles (neon, retro, minimalist, maximalist, surreal)
- Different perspectives (first-person, aerial, macro, time-lapse)

Return a 2-3 sentence description of a specific, unique video concept that would work for this brand.
Make it visually interesting and different from typical ads. Be specific about visual elements, transitions, and mood."""

		response = self.client.models.generate_content(model='gemini-2.0-flash-exp', contents=concept_prompt)
		return response.text if response and response.text else ''

	def create_ad_prompt(self, browser_analysis: str, video_concept: str = '') -> str:
		if self.mode == 'instagram':
			prompt = f"""Create an Instagram ad for this brand:

{browser_analysis}

Create a vibrant, eye-catching Instagram ad image with:
- Try to use the colors and style of the logo or brand, else:
- Bold, modern gradient background with bright colors
- Large, playful sans-serif text with the product/service name from the analysis
- Trendy design elements: geometric shapes, sparkles, emojis
- Fun bubbles or badges for any pricing or special offers mentioned
- Call-to-action button with text from the analysis
- Emphasizes the key value proposition from the analysis
- Uses visual elements that match the brand personality
- Square format (1:1 ratio)
- Use color psychology to drive action

Style: Modern Instagram advertisement, (1:1), scroll-stopping, professional but playful, conversion-focused"""
		else:  # tiktok
			if video_concept:
				prompt = f"""Create a TikTok video ad based on this specific concept:

{video_concept}

Brand context: {browser_analysis}

Requirements:
- Vertical 9:16 format
- High quality, professional execution
- Bring the concept to life exactly as described
- No text overlays, pure visual storytelling"""
			else:
				prompt = f"""Create a viral TikTok video ad for this brand:

{browser_analysis}

Create a dynamic, engaging vertical video with:
- Quick hook opening that grabs attention immediately
- Minimal text overlays (focus on visual storytelling)
- Fast-paced but not overwhelming editing
- Authentic, relatable energy that appeals to Gen Z
- Vertical 9:16 format optimized for mobile
- High energy but professional execution

Style: Modern TikTok advertisement, viral potential, authentic energy, minimal text, maximum visual impact"""
		return prompt

	async def generate_ad_image(self, prompt: str, screenshot_path: Path | None = None) -> bytes | None:
		"""Generate ad image bytes using Gemini. Returns None on failure."""
		try:
			from typing import Any

			contents: list[Any] = [prompt]

			if screenshot_path and screenshot_path.exists():
				img = Image.open(screenshot_path)
				w, h = img.size
				side = min(w, h)
				img = img.crop(((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2))
				contents = [prompt + '\n\nHere is the actual landing page screenshot to reference for design inspiration:', img]

			response = await self.client.aio.models.generate_content(
				model='gemini-2.5-flash-image-preview',
				contents=contents,
			)

			cand = getattr(response, 'candidates', None)
			if cand:
				for part in getattr(cand[0].content, 'parts', []):
					inline = getattr(part, 'inline_data', None)
					if inline:
						return inline.data
		except Exception as e:
			print(f'❌ Image generation failed: {e}')
		return None

	async def generate_ad_video(self, prompt: str, screenshot_path: Path | None = None, ad_id: int = 1) -> bytes:
		"""Generate ad video using Veo3."""
		sync_client = genai.Client(api_key=GOOGLE_API_KEY)

		# Commented out image input for now - it was using the screenshot as first frame
		# if screenshot_path and screenshot_path.exists():
		# 	import base64
		# 	import io

		# 	img = Image.open(screenshot_path)
		# 	img_buffer = io.BytesIO()
		# 	img.save(img_buffer, format='PNG')
		# 	img_bytes = img_buffer.getvalue()

		# 	operation = sync_client.models.generate_videos(
		# 		model='veo-3.0-generate-001',
		# 		prompt=prompt,
		# 		image=cast(Any, {
		# 			'imageBytes': base64.b64encode(img_bytes).decode('utf-8'),
		# 			'mimeType': 'image/png'
		# 		}),
		# 		config=cast(Any, {'aspectRatio': '9:16', 'resolution': '720p'}),
		# 	)
		# else:
		operation = sync_client.models.generate_videos(
			model='veo-3.0-generate-001',
			prompt=prompt,
			config=cast(Any, {'aspectRatio': '9:16', 'resolution': '720p'}),
		)

		while not operation.done:
			await asyncio.sleep(10)
			operation = sync_client.operations.get(operation)

		if not operation.response or not operation.response.generated_videos:
			raise RuntimeError('No videos generated')
		videos = operation.response.generated_videos
		video = videos[0]
		video_file = getattr(video, 'video', None)
		if not video_file:
			raise RuntimeError('No video file in response')
		sync_client.files.download(file=video_file)
		video_bytes = getattr(video_file, 'video_bytes', None)
		if not video_bytes:
			raise RuntimeError('No video bytes in response')
		return video_bytes

	async def save_results(self, ad_content: bytes, prompt: str, analysis: str, url: str, timestamp: str) -> str:
		if self.mode == 'instagram':
			content_path = self.output_dir / f'ad_{timestamp}.png'
		else:  # tiktok
			content_path = self.output_dir / f'ad_{timestamp}.mp4'

		async with aiofiles.open(content_path, 'wb') as f:
			await f.write(ad_content)

		analysis_path = self.output_dir / f'analysis_{timestamp}.txt'
		async with aiofiles.open(analysis_path, 'w', encoding='utf-8') as f:
			await f.write(f'URL: {url}\n\n')
			await f.write('BROWSER-USE ANALYSIS:\n')
			await f.write(analysis)
			await f.write('\n\nGENERATED PROMPT:\n')
			await f.write(prompt)

		return str(content_path)


def open_file(file_path: str):
	"""Open file with default system viewer"""
	try:
		if sys.platform.startswith('darwin'):
			subprocess.run(['open', file_path], check=True)
		elif sys.platform.startswith('win'):
			subprocess.run(['cmd', '/c', 'start', '', file_path], check=True)
		else:
			subprocess.run(['xdg-open', file_path], check=True)
	except Exception as e:
		print(f'❌ Could not open file: {e}')


async def create_ad_from_landing_page(url: str, debug: bool = False, mode: str = 'instagram', ad_id: int = 1):
	analyzer = LandingPageAnalyzer(debug=debug)

	try:
		if ad_id == 1:
			print(f'🚀 Analyzing {url} for {mode.capitalize()} ad...')
			page_data = await analyzer.analyze_landing_page(url, mode=mode)
		else:
			analyzer_temp = LandingPageAnalyzer(debug=debug)
			page_data = await analyzer_temp.analyze_landing_page(url, mode=mode)

		generator = AdGenerator(mode=mode)

		if mode == 'instagram':
			prompt = generator.create_ad_prompt(page_data['analysis'])
			ad_content = await generator.generate_ad_image(prompt, page_data.get('screenshot_path'))
			if ad_content is None:
				raise RuntimeError(f'Ad image generation failed for ad #{ad_id}')
		else:  # tiktok
			video_concept = await generator.create_video_concept(page_data['analysis'], ad_id)
			prompt = generator.create_ad_prompt(page_data['analysis'], video_concept)
			ad_content = await generator.generate_ad_video(prompt, page_data.get('screenshot_path'), ad_id)

		result_path = await generator.save_results(ad_content, prompt, page_data['analysis'], url, page_data['timestamp'])

		if mode == 'instagram':
			print(f'🎨 Generated image ad #{ad_id}: {result_path}')
		else:
			print(f'🎬 Generated video ad #{ad_id}: {result_path}')

		open_file(result_path)

		return result_path

	except Exception as e:
		print(f'❌ Error for ad #{ad_id}: {e}')
		raise
	finally:
		if ad_id == 1 and page_data.get('screenshot_path'):
			print(f'📸 Page screenshot: {page_data["screenshot_path"]}')


async def generate_single_ad(page_data: dict, mode: str, ad_id: int):
	"""Generate a single ad using pre-analyzed page data"""
	generator = AdGenerator(mode=mode)

	try:
		if mode == 'instagram':
			prompt = generator.create_ad_prompt(page_data['analysis'])
			ad_content = await generator.generate_ad_image(prompt, page_data.get('screenshot_path'))
			if ad_content is None:
				raise RuntimeError(f'Ad image generation failed for ad #{ad_id}')
		else:  # tiktok
			video_concept = await generator.create_video_concept(page_data['analysis'], ad_id)
			prompt = generator.create_ad_prompt(page_data['analysis'], video_concept)
			ad_content = await generator.generate_ad_video(prompt, page_data.get('screenshot_path'), ad_id)

		# Create unique timestamp for each ad
		timestamp = datetime.now().strftime('%Y%m%d_%H%M%S') + f'_{ad_id}'
		result_path = await generator.save_results(ad_content, prompt, page_data['analysis'], page_data['url'], timestamp)

		if mode == 'instagram':
			print(f'🎨 Generated image ad #{ad_id}: {result_path}')
		else:
			print(f'🎬 Generated video ad #{ad_id}: {result_path}')

		return result_path

	except Exception as e:
		print(f'❌ Error for ad #{ad_id}: {e}')
		raise


async def create_multiple_ads(url: str, debug: bool = False, mode: str = 'instagram', count: int = 1):
	"""Generate multiple ads in parallel using asyncio concurrency"""
	if count == 1:
		return await create_ad_from_landing_page(url, debug, mode, 1)

	print(f'🚀 Analyzing {url} for {count} {mode} ads...')

	analyzer = LandingPageAnalyzer(debug=debug)
	page_data = await analyzer.analyze_landing_page(url, mode=mode)

	print(f'🎯 Generating {count} {mode} ads in parallel...')

	tasks = []
	for i in range(count):
		task = create_task_with_error_handling(generate_single_ad(page_data, mode, i + 1), name=f'generate_ad_{i + 1}')
		tasks.append(task)

	results = await asyncio.gather(*tasks, return_exceptions=True)

	successful = []
	failed = []

	for i, result in enumerate(results):
		if isinstance(result, Exception):
			failed.append(i + 1)
		else:
			successful.append(result)

	print(f'\n✅ Successfully generated {len(successful)}/{count} ads')
	if failed:
		print(f'❌ Failed ads: {failed}')

	if page_data.get('screenshot_path'):
		print(f'📸 Page screenshot: {page_data["screenshot_path"]}')

	for ad_path in successful:
		open_file(ad_path)

	return successful


if __name__ == '__main__':
	url = args.url
	if not url:
		url = input('🔗 Enter URL: ').strip() or 'https://www.apple.com/iphone-17-pro/'

	if args.tiktok:
		mode = 'tiktok'
	else:
		mode = 'instagram'

	asyncio.run(create_multiple_ads(url, debug=args.debug, mode=mode, count=args.count))

```

---

## backend/browser-use/examples/apps/msg-use/login.py

```py
import asyncio
import os
from pathlib import Path

from browser_use import Agent, BrowserSession
from browser_use.llm.google import ChatGoogle

GOOGLE_API_KEY = os.getenv('GOOGLE_API_KEY')

# Browser profile directory for persistence (same as main script)
USER_DATA_DIR = Path.home() / '.config' / 'whatsapp_scheduler' / 'browser_profile'
USER_DATA_DIR.mkdir(parents=True, exist_ok=True)

# Storage state file for cookies
STORAGE_STATE_FILE = USER_DATA_DIR / 'storage_state.json'


async def login_to_whatsapp():
	"""Open WhatsApp Web and wait for user to scan QR code"""
	if not GOOGLE_API_KEY:
		print('❌ Error: GOOGLE_API_KEY environment variable is required')
		print("Please set it with: export GOOGLE_API_KEY='your-api-key-here'")
		return

	print('WhatsApp Login Setup')
	print('=' * 50)
	print(f'Browser profile directory: {USER_DATA_DIR}')
	print(f'Storage state file: {STORAGE_STATE_FILE}')
	print('=' * 50)

	try:
		llm = ChatGoogle(model='gemini-2.0-flash-exp', temperature=0.3, api_key=GOOGLE_API_KEY)

		task = """
        You are helping a user log into WhatsApp Web. Follow these steps:
        
        1. Navigate to https://web.whatsapp.com
        2. Wait for the page to load completely
        3. If you see a QR code, tell the user to scan it with their phone
        4. Wait patiently for the login to complete
        5. Once you see the WhatsApp chat interface, confirm successful login
        
        Take your time and be patient with page loads.
        """

		print('\nOpening WhatsApp Web...')
		print('Please scan the QR code when it appears.\n')

		browser_session = BrowserSession(
			headless=False,  # Show browser
			user_data_dir=str(USER_DATA_DIR),  # Use persistent profile directory
			storage_state=str(STORAGE_STATE_FILE) if STORAGE_STATE_FILE.exists() else None,  # Use saved cookies/session
		)

		agent = Agent(task=task, llm=llm, browser_session=browser_session)

		result = await agent.run()

		print('\n✅ Login completed!')
		print("Note: For now, you'll need to scan the QR code each time.")
		print("We'll improve session persistence in a future update.")
		print('\nPress Enter to close the browser...')
		input()

	except Exception as e:
		print(f'\n❌ Error during login: {str(e)}')
		print('Please try again.')


if __name__ == '__main__':
	asyncio.run(login_to_whatsapp())

```

---

## backend/browser-use/examples/apps/msg-use/scheduler.py

```py
#!/usr/bin/env python3
"""
WhatsApp Message Scheduler - Send scheduled messages via WhatsApp Web
"""

import argparse
import asyncio
import json
import logging
import os
import random
import re
from datetime import datetime, timedelta
from pathlib import Path


def setup_environment(debug: bool):
	if not debug:
		os.environ['BROWSER_USE_SETUP_LOGGING'] = 'false'
		os.environ['BROWSER_USE_LOGGING_LEVEL'] = 'critical'
		logging.getLogger().setLevel(logging.CRITICAL)
	else:
		os.environ['BROWSER_USE_SETUP_LOGGING'] = 'true'
		os.environ['BROWSER_USE_LOGGING_LEVEL'] = 'info'


parser = argparse.ArgumentParser(description='WhatsApp Scheduler - Send scheduled messages via WhatsApp Web')
parser.add_argument('--debug', action='store_true', help='Debug mode: show browser and verbose logs')
parser.add_argument('--test', action='store_true', help='Test mode: show what messages would be sent without sending them')
parser.add_argument('--auto', action='store_true', help='Auto mode: respond to unread messages every 30 minutes')
args = parser.parse_args()
setup_environment(args.debug)

from browser_use import Agent, BrowserSession
from browser_use.llm.google import ChatGoogle

GOOGLE_API_KEY = os.getenv('GOOGLE_API_KEY') or os.getenv('GEMINI_API_KEY')

USER_DATA_DIR = Path.home() / '.config' / 'whatsapp_scheduler' / 'browser_profile'
USER_DATA_DIR.mkdir(parents=True, exist_ok=True)
STORAGE_STATE_FILE = USER_DATA_DIR / 'storage_state.json'


async def parse_messages():
	"""Parse messages.txt and extract scheduling info"""
	messages_file = Path('messages.txt')
	if not messages_file.exists():
		print('❌ messages.txt not found!')
		return []

	import aiofiles

	async with aiofiles.open(messages_file) as f:
		content = await f.read()

	llm = ChatGoogle(model='gemini-2.0-flash-exp', temperature=0.1, api_key=GOOGLE_API_KEY)

	now = datetime.now()
	prompt = f"""
	Parse these WhatsApp message instructions and extract:
	1. Contact name (extract just the name, not descriptions)
	2. Message content (what to send)
	3. Date and time (when to send)
	
	Current date/time: {now.strftime('%Y-%m-%d %H:%M')}
	Today is: {now.strftime('%Y-%m-%d')}
	Current time is: {now.strftime('%H:%M')}
	
	Instructions:
	{content}
	
	Return ONLY a JSON array with format:
	[{{"contact": "name", "message": "text", "datetime": "YYYY-MM-DD HH:MM"}}]
	
	CRITICAL: Transform instructions into actual messages:
	
	QUOTED TEXT → Use exactly as-is:
	- Text in "quotes" becomes the exact message
	
	UNQUOTED INSTRUCTIONS → Generate actual content:
	- If it's an instruction to write something → write the actual thing
	- If it's an instruction to tell someone something → write what to tell them
	- If it's an instruction to remind someone → write the actual reminder
	- For multi-line content like poems: use single line with spacing, not line breaks
	
	DO NOT copy the instruction - create the actual message content!
	
	Time Rules:
	- If only time given (like "at 15:30"), use TODAY 
	- If no date specified, assume TODAY
	- If no year given, use current year  
	- Default time is 9:00 if not specified
	- Extract names from parentheses: "hinge date (Camila)" → "Camila"
	- "tomorrow" means {(now + timedelta(days=1)).strftime('%Y-%m-%d')}
	- "next tuesday" or similar means the next occurrence of that day
	"""

	from browser_use.llm.messages import UserMessage

	response = await llm.ainvoke([UserMessage(content=prompt)])
	response_text = response.completion if hasattr(response, 'completion') else str(response)

	# Extract JSON
	json_match = re.search(r'\[.*?\]', response_text, re.DOTALL)
	if json_match:
		try:
			messages = json.loads(json_match.group())
			for msg in messages:
				if 'message' in msg:
					msg['message'] = re.sub(r'\n+', ' • ', msg['message'])
					msg['message'] = re.sub(r'\s+', ' ', msg['message']).strip()
			return messages
		except json.JSONDecodeError:
			pass
	return []


async def send_message(contact, message):
	"""Send a WhatsApp message"""
	print(f'\n📱 Sending to {contact}: {message}')

	llm = ChatGoogle(model='gemini-2.0-flash-exp', temperature=0.3, api_key=GOOGLE_API_KEY)

	task = f"""
	Send WhatsApp message:
	1. Go to https://web.whatsapp.com
	2. Search for contact: {contact}
	3. Click on the contact
	4. Type message: {message}
	5. Press Enter to send
	6. Confirm sent
	"""

	browser = BrowserSession(
		headless=not args.debug,  # headless=False only when debug=True
		user_data_dir=str(USER_DATA_DIR),
		storage_state=str(STORAGE_STATE_FILE) if STORAGE_STATE_FILE.exists() else None,
	)

	agent = Agent(task=task, llm=llm, browser_session=browser)
	await agent.run()
	print(f'✅ Sent to {contact}')


async def auto_respond_to_unread():
	"""Click unread tab and respond to messages"""
	print('\nAuto-responding to unread messages...')

	llm = ChatGoogle(model='gemini-2.0-flash-exp', temperature=0.3, api_key=GOOGLE_API_KEY)

	task = """
	1. Go to https://web.whatsapp.com
	2. Wait for page to load
	3. Click on the "Unread" filter tab
	4. If there are unread messages:
	   - Click on each unread chat
	   - Read the last message
	   - Generate and send a friendly, contextual response
	   - Move to next unread chat
	5. Report how many messages were responded to
	"""

	browser = BrowserSession(
		headless=not args.debug,
		user_data_dir=str(USER_DATA_DIR),
		storage_state=str(STORAGE_STATE_FILE) if STORAGE_STATE_FILE.exists() else None,
	)

	agent = Agent(task=task, llm=llm, browser_session=browser)
	result = await agent.run()
	print('✅ Auto-response complete')
	return result


async def main():
	if not GOOGLE_API_KEY:
		print('❌ Set GOOGLE_API_KEY or GEMINI_API_KEY environment variable')
		return

	print('WhatsApp Scheduler')
	print(f'Profile: {USER_DATA_DIR}')
	print()

	# Auto mode - respond to unread messages periodically
	if args.auto:
		print('AUTO MODE - Responding to unread messages every ~30 minutes')
		print('Press Ctrl+C to stop.\n')

		while True:
			try:
				await auto_respond_to_unread()

				# Wait 30 minutes +/- 5 minutes randomly
				wait_minutes = 30 + random.randint(-5, 5)
				print(f'\n⏰ Next check in {wait_minutes} minutes...')
				await asyncio.sleep(wait_minutes * 60)

			except KeyboardInterrupt:
				print('\n\nAuto mode stopped by user')
				break
			except Exception as e:
				print(f'\n❌ Error in auto mode: {e}')
				print('Waiting 5 minutes before retry...')
				await asyncio.sleep(300)
		return

	# Parse messages
	print('Parsing messages.txt...')
	messages = await parse_messages()

	if not messages:
		print('No messages found')
		return

	print(f'\nFound {len(messages)} messages:')
	for msg in messages:
		print(f'  • {msg["datetime"]}: {msg["message"][:30]}... to {msg["contact"]}')

	now = datetime.now()
	immediate = []
	future = []

	for msg in messages:
		msg_time = datetime.strptime(msg['datetime'], '%Y-%m-%d %H:%M')
		if msg_time <= now:
			immediate.append(msg)
		else:
			future.append(msg)

	if args.test:
		print('\n=== TEST MODE - Preview ===')
		if immediate:
			print(f'\nWould send {len(immediate)} past-due messages NOW:')
			for msg in immediate:
				print(f'  📱 To {msg["contact"]}: {msg["message"]}')
		if future:
			print(f'\nWould monitor {len(future)} future messages:')
			for msg in future:
				print(f'  ⏰ {msg["datetime"]}: To {msg["contact"]}: {msg["message"]}')
		print('\nTest mode complete. No messages sent.')
		return

	if immediate:
		print(f'\nSending {len(immediate)} past-due messages NOW...')
		for msg in immediate:
			await send_message(msg['contact'], msg['message'])

	if future:
		print(f'\n⏰ Monitoring {len(future)} future messages...')
		print('Press Ctrl+C to stop.\n')

		last_status = None

		while future:
			now = datetime.now()
			due = []
			remaining = []

			for msg in future:
				msg_time = datetime.strptime(msg['datetime'], '%Y-%m-%d %H:%M')
				if msg_time <= now:
					due.append(msg)
				else:
					remaining.append(msg)

			for msg in due:
				print(f'\n⏰ Time reached for {msg["contact"]}')
				await send_message(msg['contact'], msg['message'])

			future = remaining

			if future:
				next_msg = min(future, key=lambda x: datetime.strptime(x['datetime'], '%Y-%m-%d %H:%M'))
				current_status = f'Next: {next_msg["datetime"]} to {next_msg["contact"]}'

				if current_status != last_status:
					print(current_status)
					last_status = current_status

				await asyncio.sleep(30)  # Check every 30 seconds

	print('\n✅ All messages processed!')


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/apps/news-use/news_monitor.py

```py
#!/usr/bin/env python3
"""
News monitoring agent with browser-use + Gemini Flash.
Automatically extracts and analyzes the latest articles from any news website.
"""

import argparse
import asyncio
import hashlib
import json
import logging
import os
import time
from datetime import datetime
from typing import Literal

from dateutil import parser as dtparser
from pydantic import BaseModel


def setup_environment(debug: bool):
	if not debug:
		os.environ['BROWSER_USE_SETUP_LOGGING'] = 'false'
		os.environ['BROWSER_USE_LOGGING_LEVEL'] = 'critical'
		logging.getLogger().setLevel(logging.CRITICAL)
	else:
		os.environ['BROWSER_USE_SETUP_LOGGING'] = 'true'
		os.environ['BROWSER_USE_LOGGING_LEVEL'] = 'info'


parser = argparse.ArgumentParser(description='News extractor using Browser-Use + Gemini')
parser.add_argument('--url', default='https://www.techcrunch.com', help='News site root URL')
parser.add_argument('--interval', type=int, default=300, help='Seconds between checks in monitor mode')
parser.add_argument('--once', action='store_true', help='Run a single extraction and exit')
parser.add_argument('--output', default='news_data.json', help='Path to JSON file where articles are stored')
parser.add_argument('--debug', action='store_true', help='Verbose console output and non-headless browser')
args = parser.parse_args()

setup_environment(args.debug)

from browser_use import Agent, BrowserSession, ChatGoogle

GEMINI_API_KEY = os.getenv('GOOGLE_API_KEY') or 'xxxx'

if GEMINI_API_KEY == 'xxxx':
	print('⚠️  WARNING: Please set GOOGLE_API_KEY environment variable')
	print('   You can get an API key at: https://makersuite.google.com/app/apikey')
	print("   Then run: export GEMINI_API_KEY='your-api-key-here'")
	print()


class NewsArticle(BaseModel):
	title: str
	url: str
	posting_time: str
	short_summary: str
	long_summary: str
	sentiment: Literal['positive', 'neutral', 'negative']


# ---------------------------------------------------------
# Core extractor
# ---------------------------------------------------------


async def extract_latest_article(site_url: str, debug: bool = False) -> dict:
	"""Open site_url, navigate to the newest article and return structured JSON."""

	prompt = (
		f'Navigate to {site_url} and find the most recent headline article (usually at the top). '
		f'Click on it to open the full article page. Once loaded, scroll & extract ALL required information: '
		f'1. title: The article headline '
		f'2. url: The full URL of the article page '
		f'3. posting_time: The publication date/time as shown on the page '
		f"4. short_summary: A 10-word overview of the article's content "
		f'5. long_summary: A 100-word detailed summary of the article '
		f"6. sentiment: Classify as 'positive', 'neutral', or 'negative' based on the article tone. "
		f'When done, call the done action with success=True and put ALL extracted data in the text field '
		f'as valid JSON in this exact format: '
		f'{{"title": "...", "url": "...", "posting_time": "...", "short_summary": "...", "long_summary": "...", "sentiment": "positive|neutral|negative"}}'
	)

	llm = ChatGoogle(model='gemini-2.0-flash', temperature=0.1, api_key=GEMINI_API_KEY)
	browser_session = BrowserSession(headless=not debug)

	agent = Agent(task=prompt, llm=llm, browser_session=browser_session, use_vision=False)

	if debug:
		print(f'[DEBUG] Starting extraction from {site_url}')
		start = time.time()

	result = await agent.run(max_steps=25)

	raw = result.final_result() if result else None
	if debug:
		print(f'[DEBUG] Raw result type: {type(raw)}')
		print(f'[DEBUG] Raw result: {raw[:500] if isinstance(raw, str) else raw}')
		print(f'[DEBUG] Extraction time: {time.time() - start:.2f}s')

	if isinstance(raw, dict):
		return {'status': 'success', 'data': raw}

	text = str(raw).strip() if raw else ''

	if '<json>' in text and '</json>' in text:
		text = text.split('<json>', 1)[1].split('</json>', 1)[0].strip()

	if text.lower().startswith('here is'):
		brace = text.find('{')
		if brace != -1:
			text = text[brace:]

	if text.startswith('``\`'):
		text = text.lstrip('`\n ')
		if text.lower().startswith('json'):
			text = text[4:].lstrip()

	def _escape_newlines(src: str) -> str:
		out, in_str, esc = [], False, False
		for ch in src:
			if in_str:
				if esc:
					esc = False
				elif ch == '\\':
					esc = True
				elif ch == '"':
					in_str = False
				elif ch == '\n':
					out.append('\\n')
					continue
				elif ch == '\r':
					continue
			else:
				if ch == '"':
					in_str = True
			out.append(ch)
		return ''.join(out)

	cleaned = _escape_newlines(text)

	def _try_parse(txt: str):
		try:
			return json.loads(txt)
		except Exception:
			return None

	data = _try_parse(cleaned)

	# Fallback: grab first balanced JSON object
	if data is None:
		brace = 0
		start = None
		for i, ch in enumerate(text):
			if ch == '{':
				if brace == 0:
					start = i
				brace += 1
			elif ch == '}':
				brace -= 1
				if brace == 0 and start is not None:
					candidate = _escape_newlines(text[start : i + 1])
					data = _try_parse(candidate)
					if data is not None:
						break

	if isinstance(data, dict):
		return {'status': 'success', 'data': data}
	return {'status': 'error', 'error': f'JSON parse failed. Raw head: {text[:200]}'}


# ---------------------------------------------------------
# Persistence helpers
# ---------------------------------------------------------


def load_seen_hashes(file_path: str = 'news_data.json') -> set:
	"""Load already-saved article URL hashes from disk for dedup across restarts."""
	if not os.path.exists(file_path):
		return set()
	try:
		with open(file_path) as f:
			items = json.load(f)
		return {entry['hash'] for entry in items if 'hash' in entry}
	except Exception:
		return set()


def save_article(article: dict, file_path: str = 'news_data.json'):
	"""Append article to disk with a hash for future dedup."""
	payload = {
		'hash': hashlib.md5(article['url'].encode()).hexdigest(),
		'pulled_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
		'data': article,
	}

	existing = []
	if os.path.exists(file_path):
		try:
			with open(file_path) as f:
				existing = json.load(f)
		except Exception:
			existing = []

	existing.append(payload)
	# Keep last 100
	existing = existing[-100:]

	with open(file_path, 'w') as f:
		json.dump(existing, f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------
# CLI functions
# ---------------------------------------------------------


def _fmt(ts_raw: str) -> str:
	"""Format timestamp string"""
	try:
		return dtparser.parse(ts_raw).strftime('%Y-%m-%d %H:%M:%S')
	except Exception:
		return datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')


async def run_once(url: str, output_path: str, debug: bool):
	"""Run a single extraction and exit"""
	res = await extract_latest_article(url, debug)

	if res['status'] == 'success':
		art = res['data']
		url_val = art.get('url', '')
		hash_ = hashlib.md5(url_val.encode()).hexdigest() if url_val else None
		if url_val:
			save_article(art, output_path)
		ts = _fmt(art.get('posting_time', ''))
		sentiment = art.get('sentiment', 'neutral')
		emoji = {'positive': '🟢', 'negative': '🔴', 'neutral': '🟡'}.get(sentiment, '🟡')
		summary = art.get('short_summary', art.get('summary', art.get('title', '')))
		if debug:
			print(json.dumps(art, ensure_ascii=False, indent=2))
			print()
		print(f'[{ts}] - {emoji} - {summary}')
		if not debug:
			print()  # Only add spacing in non-debug mode
		return hash_
	else:
		print(f'Error: {res["error"]}')
		return None


async def monitor(url: str, interval: int, output_path: str, debug: bool):
	"""Continuous monitoring mode"""
	seen = load_seen_hashes(output_path)
	print(f'Monitoring {url} every {interval}s')
	print()

	while True:
		try:
			res = await extract_latest_article(url, debug)

			if res['status'] == 'success':
				art = res['data']
				url_val = art.get('url', '')
				hash_ = hashlib.md5(url_val.encode()).hexdigest() if url_val else None
				if hash_ and hash_ not in seen:
					seen.add(hash_)
					ts = _fmt(art.get('posting_time', ''))
					sentiment = art.get('sentiment', 'neutral')
					emoji = {'positive': '🟢', 'negative': '🔴', 'neutral': '🟡'}.get(sentiment, '🟡')
					summary = art.get('short_summary', art.get('title', ''))
					save_article(art, output_path)
					if debug:
						print(json.dumps(art, ensure_ascii=False, indent=2))
					print(f'[{ts}] - {emoji} - {summary}')
					if not debug:
						print()  # Add spacing between articles in non-debug mode
			elif debug:
				print(f'Error: {res["error"]}')

		except Exception as e:
			if debug:
				import traceback

				traceback.print_exc()
			else:
				print(f'Unhandled error: {e}')

		await asyncio.sleep(interval)


def main():
	"""Main entry point"""
	if args.once:
		asyncio.run(run_once(args.url, args.output, args.debug))
	else:
		try:
			asyncio.run(monitor(args.url, args.interval, args.output, args.debug))
		except KeyboardInterrupt:
			print('\nStopped by user')


if __name__ == '__main__':
	main()

```

---

## backend/browser-use/examples/browser/cloud_browser.py

```py
"""
Examples of using Browser-Use cloud browser service.

Prerequisites:
1. Set BROWSER_USE_API_KEY environment variable
2. Active subscription at https://cloud.browser-use.com
"""

import asyncio

from dotenv import load_dotenv

from browser_use import Agent, Browser, ChatBrowserUse

load_dotenv()


async def basic():
	"""Simplest usage - just pass cloud params directly."""
	browser = Browser(use_cloud=True)

	agent = Agent(
		task='Go to github.com/browser-use/browser-use and tell me the star count',
		llm=ChatBrowserUse(),
		browser=browser,
	)

	result = await agent.run()
	print(f'Result: {result}')


async def full_config():
	"""Full cloud configuration with specific profile."""
	browser = Browser(
		# cloud_profile_id='21182245-590f-4712-8888-9611651a024c',
		cloud_proxy_country_code='jp',
		cloud_timeout=60,
	)

	agent = Agent(
		task='go and check my ip address and the location',
		llm=ChatBrowserUse(),
		browser=browser,
	)

	result = await agent.run()
	print(f'Result: {result}')


async def main():
	try:
		# await basic()
		await full_config()
	except Exception as e:
		print(f'Error: {e}')


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/browser/parallel_browser.py

```py
import asyncio

from browser_use import Agent, Browser, ChatOpenAI

# NOTE: This is still experimental, and agents might conflict each other.


async def main():
	# Create 3 separate browser instances
	browsers = [
		Browser(
			user_data_dir=f'./temp-profile-{i}',
			headless=False,
		)
		for i in range(3)
	]

	# Create 3 agents with different tasks
	agents = [
		Agent(
			task='Search for "browser automation" on Google',
			browser=browsers[0],
			llm=ChatOpenAI(model='gpt-4.1-mini'),
		),
		Agent(
			task='Search for "AI agents" on DuckDuckGo',
			browser=browsers[1],
			llm=ChatOpenAI(model='gpt-4.1-mini'),
		),
		Agent(
			task='Visit Wikipedia and search for "web scraping"',
			browser=browsers[2],
			llm=ChatOpenAI(model='gpt-4.1-mini'),
		),
	]

	# Run all agents in parallel
	tasks = [agent.run() for agent in agents]
	results = await asyncio.gather(*tasks, return_exceptions=True)

	print('🎉 All agents completed!')


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/browser/playwright_integration.py

```py
"""
Key features:
1. Browser-Use and Playwright sharing the same Chrome instance via CDP
2. Take actions with Playwright and continue with Browser-Use actions
3. Let the agent call Playwright functions like screenshot or click on selectors
"""

import asyncio
import os
import subprocess
import sys
import tempfile

from pydantic import BaseModel, Field

# Check for required dependencies first - before other imports
try:
	import aiohttp  # type: ignore
	from playwright.async_api import Browser, Page, async_playwright  # type: ignore
except ImportError as e:
	print(f'❌ Missing dependencies for this example: {e}')
	print('This example requires: playwright aiohttp')
	print('Install with: uv add playwright aiohttp')
	print('Also run: playwright install chromium')
	sys.exit(1)

from browser_use import Agent, BrowserSession, ChatOpenAI, Tools
from browser_use.agent.views import ActionResult

# Global Playwright browser instance - shared between custom actions
playwright_browser: Browser | None = None
playwright_page: Page | None = None


# Custom action parameter models
class PlaywrightFillFormAction(BaseModel):
	"""Parameters for Playwright form filling action."""

	customer_name: str = Field(..., description='Customer name to fill')
	phone_number: str = Field(..., description='Phone number to fill')
	email: str = Field(..., description='Email address to fill')
	size_option: str = Field(..., description='Size option (small/medium/large)')


class PlaywrightScreenshotAction(BaseModel):
	"""Parameters for Playwright screenshot action."""

	filename: str = Field(default='playwright_screenshot.png', description='Filename for screenshot')
	quality: int | None = Field(default=None, description='JPEG quality (1-100), only for .jpg/.jpeg files')


class PlaywrightGetTextAction(BaseModel):
	"""Parameters for getting text using Playwright selectors."""

	selector: str = Field(..., description='CSS selector to get text from. Use "title" for page title.')


async def start_chrome_with_debug_port(port: int = 9222):
	"""
	Start Chrome with remote debugging enabled.
	Returns the Chrome process.
	"""
	# Create temporary directory for Chrome user data
	user_data_dir = tempfile.mkdtemp(prefix='chrome_cdp_')

	# Chrome launch command
	chrome_paths = [
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',  # macOS
		'/usr/bin/google-chrome',  # Linux
		'/usr/bin/chromium-browser',  # Linux Chromium
		'chrome',  # Windows/PATH
		'chromium',  # Generic
	]

	chrome_exe = None
	for path in chrome_paths:
		if os.path.exists(path) or path in ['chrome', 'chromium']:
			try:
				# Test if executable works
				test_proc = await asyncio.create_subprocess_exec(
					path, '--version', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
				)
				await test_proc.wait()
				chrome_exe = path
				break
			except Exception:
				continue

	if not chrome_exe:
		raise RuntimeError('❌ Chrome not found. Please install Chrome or Chromium.')

	# Chrome command arguments
	cmd = [
		chrome_exe,
		f'--remote-debugging-port={port}',
		f'--user-data-dir={user_data_dir}',
		'--no-first-run',
		'--no-default-browser-check',
		'--disable-extensions',
		'about:blank',  # Start with blank page
	]

	# Start Chrome process
	process = await asyncio.create_subprocess_exec(*cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

	# Wait for Chrome to start and CDP to be ready
	cdp_ready = False
	for _ in range(20):  # 20 second timeout
		try:
			async with aiohttp.ClientSession() as session:
				async with session.get(
					f'http://localhost:{port}/json/version', timeout=aiohttp.ClientTimeout(total=1)
				) as response:
					if response.status == 200:
						cdp_ready = True
						break
		except Exception:
			pass
		await asyncio.sleep(1)

	if not cdp_ready:
		process.terminate()
		raise RuntimeError('❌ Chrome failed to start with CDP')

	return process


async def connect_playwright_to_cdp(cdp_url: str):
	"""
	Connect Playwright to the same Chrome instance Browser-Use is using.
	This enables custom actions to use Playwright functions.
	"""
	global playwright_browser, playwright_page

	playwright = await async_playwright().start()
	playwright_browser = await playwright.chromium.connect_over_cdp(cdp_url)

	# Get or create a page
	if playwright_browser and playwright_browser.contexts and playwright_browser.contexts[0].pages:
		playwright_page = playwright_browser.contexts[0].pages[0]
	elif playwright_browser:
		context = await playwright_browser.new_context()
		playwright_page = await context.new_page()


# Create custom tools that use Playwright functions
tools = Tools()


@tools.registry.action(
	"Fill out a form using Playwright's precise form filling capabilities. This uses Playwright selectors for reliable form interaction.",
	param_model=PlaywrightFillFormAction,
)
async def playwright_fill_form(params: PlaywrightFillFormAction, browser_session: BrowserSession):
	"""
	Custom action that uses Playwright to fill forms with high precision.
	This demonstrates how to create Browser-Use actions that leverage Playwright's capabilities.
	"""
	try:
		if not playwright_page:
			return ActionResult(error='Playwright not connected. Run setup first.')

		# Filling form with Playwright's precise selectors

		# Wait for form to be ready and fill basic fields
		await playwright_page.wait_for_selector('input[name="custname"]', timeout=10000)
		await playwright_page.fill('input[name="custname"]', params.customer_name)
		await playwright_page.fill('input[name="custtel"]', params.phone_number)
		await playwright_page.fill('input[name="custemail"]', params.email)

		# Handle size selection - check if it's a select dropdown or radio buttons
		size_select = playwright_page.locator('select[name="size"]')
		size_radio = playwright_page.locator(f'input[name="size"][value="{params.size_option}"]')

		if await size_select.count() > 0:
			# It's a select dropdown
			await playwright_page.select_option('select[name="size"]', params.size_option)
		elif await size_radio.count() > 0:
			# It's radio buttons
			await playwright_page.check(f'input[name="size"][value="{params.size_option}"]')
		else:
			raise ValueError(f'Could not find size input field for value: {params.size_option}')

		# Get form data to verify it was filled
		form_data = {}
		form_data['name'] = await playwright_page.input_value('input[name="custname"]')
		form_data['phone'] = await playwright_page.input_value('input[name="custtel"]')
		form_data['email'] = await playwright_page.input_value('input[name="custemail"]')

		# Get size value based on input type
		if await size_select.count() > 0:
			form_data['size'] = await playwright_page.input_value('select[name="size"]')
		else:
			# For radio buttons, find the checked one
			checked_radio = playwright_page.locator('input[name="size"]:checked')
			if await checked_radio.count() > 0:
				form_data['size'] = await checked_radio.get_attribute('value')
			else:
				form_data['size'] = 'none selected'

		success_msg = f'✅ Form filled successfully with Playwright: {form_data}'

		return ActionResult(
			extracted_content=success_msg, include_in_memory=True, long_term_memory=f'Filled form with: {form_data}'
		)

	except Exception as e:
		error_msg = f'❌ Playwright form filling failed: {str(e)}'
		return ActionResult(error=error_msg)


@tools.registry.action(
	"Take a screenshot using Playwright's screenshot capabilities with high quality and precision.",
	param_model=PlaywrightScreenshotAction,
)
async def playwright_screenshot(params: PlaywrightScreenshotAction, browser_session: BrowserSession):
	"""
	Custom action that uses Playwright's advanced screenshot features.
	"""
	try:
		if not playwright_page:
			return ActionResult(error='Playwright not connected. Run setup first.')

		# Taking screenshot with Playwright

		# Use Playwright's screenshot with full page capture
		screenshot_kwargs = {'path': params.filename, 'full_page': True}

		# Add quality parameter only for JPEG files
		if params.quality is not None and params.filename.lower().endswith(('.jpg', '.jpeg')):
			screenshot_kwargs['quality'] = params.quality

		await playwright_page.screenshot(**screenshot_kwargs)

		success_msg = f'✅ Screenshot saved as {params.filename} using Playwright'

		return ActionResult(
			extracted_content=success_msg, include_in_memory=True, long_term_memory=f'Screenshot saved: {params.filename}'
		)

	except Exception as e:
		error_msg = f'❌ Playwright screenshot failed: {str(e)}'
		return ActionResult(error=error_msg)


@tools.registry.action(
	"Extract text from elements using Playwright's powerful CSS selectors and XPath support.", param_model=PlaywrightGetTextAction
)
async def playwright_get_text(params: PlaywrightGetTextAction, browser_session: BrowserSession):
	"""
	Custom action that uses Playwright's advanced text extraction with CSS selectors and XPath.
	"""
	try:
		if not playwright_page:
			return ActionResult(error='Playwright not connected. Run setup first.')

		# Extracting text with Playwright selectors

		# Handle special selectors
		if params.selector.lower() == 'title':
			# Use page.title() for title element
			text_content = await playwright_page.title()
			result_data = {
				'selector': 'title',
				'text_content': text_content,
				'inner_text': text_content,
				'tag_name': 'TITLE',
				'is_visible': True,
			}
		else:
			# Use Playwright's robust element selection and text extraction
			element = playwright_page.locator(params.selector).first

			if await element.count() == 0:
				error_msg = f'❌ No element found with selector: {params.selector}'
				return ActionResult(error=error_msg)

			text_content = await element.text_content()
			inner_text = await element.inner_text()

			# Get additional element info
			tag_name = await element.evaluate('el => el.tagName')
			is_visible = await element.is_visible()

			result_data = {
				'selector': params.selector,
				'text_content': text_content,
				'inner_text': inner_text,
				'tag_name': tag_name,
				'is_visible': is_visible,
			}

		success_msg = f'✅ Extracted text using Playwright: {result_data}'

		return ActionResult(
			extracted_content=str(result_data),
			include_in_memory=True,
			long_term_memory=f'Extracted from {params.selector}: {result_data["text_content"]}',
		)

	except Exception as e:
		error_msg = f'❌ Playwright text extraction failed: {str(e)}'
		return ActionResult(error=error_msg)


async def main():
	"""
	Main function demonstrating Browser-Use + Playwright integration with custom actions.
	"""
	print('🚀 Advanced Playwright + Browser-Use Integration with Custom Actions')

	chrome_process = None
	try:
		# Step 1: Start Chrome with CDP debugging
		chrome_process = await start_chrome_with_debug_port()
		cdp_url = 'http://localhost:9222'

		# Step 2: Connect Playwright to the same Chrome instance
		await connect_playwright_to_cdp(cdp_url)

		# Step 3: Create Browser-Use session connected to same Chrome
		browser_session = BrowserSession(cdp_url=cdp_url)

		# Step 4: Create AI agent with our custom Playwright-powered tools
		agent = Agent(
			task="""
			Please help me demonstrate the integration between Browser-Use and Playwright:
			
			1. First, navigate to https://httpbin.org/forms/post
			2. Use the 'playwright_fill_form' action to fill the form with these details:
			   - Customer name: "Alice Johnson"
			   - Phone: "555-9876"
			   - Email: "alice@demo.com"
			   - Size: "large"
			3. Take a screenshot using the 'playwright_screenshot' action and save it as "form_demo.png"
			4. Extract the title of the page using 'playwright_get_text' action with selector "title"
			5. Finally, submit the form and tell me what happened
			
			This demonstrates how Browser-Use AI can orchestrate tasks while using Playwright's precise capabilities for specific operations.
			""",
			llm=ChatOpenAI(model='gpt-4.1-mini'),
			tools=tools,  # Our custom tools with Playwright actions
			browser_session=browser_session,
		)

		print('🎯 Starting AI agent with custom Playwright actions...')

		# Step 5: Run the agent - it will use both Browser-Use actions and our custom Playwright actions
		result = await agent.run()

		# Keep browser open briefly to see results
		print(f'✅ Integration demo completed! Result: {result}')
		await asyncio.sleep(2)  # Brief pause to see results

	except Exception as e:
		print(f'❌ Error: {e}')
		raise

	finally:
		# Clean up resources
		if playwright_browser:
			await playwright_browser.close()

		if chrome_process:
			chrome_process.terminate()
			try:
				await asyncio.wait_for(chrome_process.wait(), 5)
			except TimeoutError:
				chrome_process.kill()

		print('✅ Cleanup complete')


if __name__ == '__main__':
	# Run the advanced integration demo
	asyncio.run(main())

```

---

## backend/browser-use/examples/browser/real_browser.py

```py
import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import Agent, Browser, ChatGoogle

# Connect to your existing Chrome browser
browser = Browser(
	executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	user_data_dir='~/Library/Application Support/Google/Chrome',
	profile_directory='Default',
)


# NOTE: You have to close all Chrome browsers before running this example so that we can launch chrome in debug mode.
async def main():
	# save storage state
	agent = Agent(
		llm=ChatGoogle(model='gemini-flash-latest'),
		# Google blocks this approach, so we use a different search engine
		task='go to amazon.com and search for pens to draw on whiteboards',
		browser=browser,
	)
	await agent.run()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/browser/save_cookies.py

```py
import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import Browser

# Connect to your existing Chrome browser
browser = Browser(
	executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	user_data_dir='~/Library/Application Support/Google/Chrome',
	profile_directory='Default',
)


async def main():
	await browser.start()
	await browser.export_storage_state('storage_state3.json')


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/browser/using_cdp.py

```py
"""
Simple demonstration of the CDP feature.

To test this locally, follow these steps:
1. Find the chrome executable file.
2. On mac by default, the chrome is in `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
3. Add the following argument to the shortcut:
   `--remote-debugging-port=9222`
4. Open a web browser and navigate to `http://localhost:9222/json/version` to verify that the Remote Debugging Protocol (CDP) is running.
5. Launch this example.

Full command Mac:
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222

@dev You need to set the `OPENAI_API_KEY` environment variable before proceeding.
"""

import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import Agent, Tools
from browser_use.browser import BrowserProfile, BrowserSession
from browser_use.llm import ChatOpenAI

browser_session = BrowserSession(browser_profile=BrowserProfile(cdp_url='http://localhost:9222', is_local=True))
tools = Tools()


async def main():
	agent = Agent(
		task='Visit https://duckduckgo.com and search for "browser-use founders"',
		llm=ChatOpenAI(model='gpt-4.1-mini'),
		tools=tools,
		browser_session=browser_session,
	)

	await agent.run()
	await browser_session.kill()

	input('Press Enter to close...')


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/cloud/01_basic_task.py

```py
"""
Cloud Example 1: Your First Browser Use Cloud Task
==================================================

This example demonstrates the most basic Browser Use Cloud functionality:
- Create a simple automation task
- Get the task ID
- Monitor completion
- Retrieve results

Perfect for first-time cloud users to understand the API basics.

Cost: ~$0.04 (1 task + 3 steps with GPT-4.1 mini)
"""

import os
import time
from typing import Any

import requests
from requests.exceptions import RequestException

# Configuration
API_KEY = os.getenv('BROWSER_USE_API_KEY')
if not API_KEY:
	raise ValueError(
		'Please set BROWSER_USE_API_KEY environment variable. You can also create an API key at https://cloud.browser-use.com/new-api-key'
	)

BASE_URL = os.getenv('BROWSER_USE_BASE_URL', 'https://api.browser-use.com/api/v1')
TIMEOUT = int(os.getenv('BROWSER_USE_TIMEOUT', '30'))
HEADERS = {'Authorization': f'Bearer {API_KEY}', 'Content-Type': 'application/json'}


def _request_with_retry(method: str, url: str, **kwargs) -> requests.Response:
	"""Make HTTP request with timeout and retry logic."""
	kwargs.setdefault('timeout', TIMEOUT)

	for attempt in range(3):
		try:
			response = requests.request(method, url, **kwargs)
			response.raise_for_status()
			return response
		except RequestException as e:
			if attempt == 2:  # Last attempt
				raise
			sleep_time = 2**attempt
			print(f'⚠️  Request failed (attempt {attempt + 1}/3), retrying in {sleep_time}s: {e}')
			time.sleep(sleep_time)

	# This line should never be reached, but satisfies type checker
	raise RuntimeError('Unexpected error in retry logic')


def create_task(instructions: str) -> str:
	"""
	Create a new browser automation task.

	Args:
	    instructions: Natural language description of what the agent should do

	Returns:
	    task_id: Unique identifier for the created task
	"""
	print(f'📝 Creating task: {instructions}')

	payload = {
		'task': instructions,
		'llm_model': 'gpt-4.1-mini',  # Cost-effective model
		'max_agent_steps': 10,  # Prevent runaway costs
		'enable_public_share': True,  # Enable shareable execution URLs
	}

	response = _request_with_retry('post', f'{BASE_URL}/run-task', headers=HEADERS, json=payload)

	task_id = response.json()['id']
	print(f'✅ Task created with ID: {task_id}')
	return task_id


def get_task_status(task_id: str) -> dict[str, Any]:
	"""Get the current status of a task."""
	response = _request_with_retry('get', f'{BASE_URL}/task/{task_id}/status', headers=HEADERS)
	return response.json()


def get_task_details(task_id: str) -> dict[str, Any]:
	"""Get full task details including steps and output."""
	response = _request_with_retry('get', f'{BASE_URL}/task/{task_id}', headers=HEADERS)
	return response.json()


def wait_for_completion(task_id: str, poll_interval: int = 3) -> dict[str, Any]:
	"""
	Wait for task completion and show progress.

	Args:
	    task_id: The task to monitor
	    poll_interval: How often to check status (seconds)

	Returns:
	    Complete task details with output
	"""
	print(f'⏳ Monitoring task {task_id}...')

	step_count = 0
	start_time = time.time()

	while True:
		details = get_task_details(task_id)
		status = details['status']
		current_steps = len(details.get('steps', []))
		elapsed = time.time() - start_time

		# Clear line and show current progress
		if current_steps > step_count:
			step_count = current_steps

		# Build status message
		if status == 'running':
			if current_steps > 0:
				status_msg = f'🔄 Step {current_steps} | ⏱️  {elapsed:.0f}s | 🤖 Agent working...'
			else:
				status_msg = f'🤖 Agent starting... | ⏱️  {elapsed:.0f}s'
		else:
			status_msg = f'🔄 Step {current_steps} | ⏱️  {elapsed:.0f}s | Status: {status}'

		# Clear line and print status
		print(f'\r{status_msg:<80}', end='', flush=True)

		# Check if finished
		if status == 'finished':
			print(f'\r✅ Task completed successfully! ({current_steps} steps in {elapsed:.1f}s)' + ' ' * 20)
			return details
		elif status in ['failed', 'stopped']:
			print(f'\r❌ Task {status} after {current_steps} steps' + ' ' * 30)
			return details

		time.sleep(poll_interval)


def main():
	"""Run a basic cloud automation task."""
	print('🚀 Browser Use Cloud - Basic Task Example')
	print('=' * 50)

	# Define a simple search task (using DuckDuckGo to avoid captchas)
	task_description = (
		"Go to DuckDuckGo and search for 'browser automation tools'. Tell me the top 3 results with their titles and URLs."
	)

	try:
		# Step 1: Create the task
		task_id = create_task(task_description)

		# Step 2: Wait for completion
		result = wait_for_completion(task_id)

		# Step 3: Display results
		print('\n📊 Results:')
		print('-' * 30)
		print(f'Status: {result["status"]}')
		print(f'Steps taken: {len(result.get("steps", []))}')

		if result.get('output'):
			print(f'Output: {result["output"]}')
		else:
			print('No output available')

		# Show share URLs for viewing execution
		if result.get('live_url'):
			print(f'\n🔗 Live Preview: {result["live_url"]}')
		if result.get('public_share_url'):
			print(f'🌐 Share URL: {result["public_share_url"]}')
		elif result.get('share_url'):
			print(f'🌐 Share URL: {result["share_url"]}')

		if not result.get('live_url') and not result.get('public_share_url') and not result.get('share_url'):
			print("\n💡 Tip: Add 'enable_public_share': True to task payload to get shareable URLs")

	except requests.exceptions.RequestException as e:
		print(f'❌ API Error: {e}')
	except Exception as e:
		print(f'❌ Error: {e}')


if __name__ == '__main__':
	main()

```

---

## backend/browser-use/examples/cloud/02_fast_mode_gemini.py

```py
"""
Cloud Example 2: Ultra-Fast Mode with Gemini Flash ⚡
====================================================

This example demonstrates the fastest and most cost-effective configuration:
- Gemini 2.5 Flash model ($0.01 per step)
- No proxy (faster execution, but no captcha solving)
- No element highlighting (better performance)
- Optimized viewport size
- Maximum speed configuration

Perfect for: Quick content generation, humor tasks, fast web scraping

Cost: ~$0.03 (1 task + 2-3 steps with Gemini Flash)
Speed: 2-3x faster than default configuration
Fun Factor: 💯 (Creates hilarious tech commentary)
"""

import argparse
import os
import time
from typing import Any

import requests
from requests.exceptions import RequestException

# Configuration
API_KEY = os.getenv('BROWSER_USE_API_KEY')
if not API_KEY:
	raise ValueError(
		'Please set BROWSER_USE_API_KEY environment variable. You can also create an API key at https://cloud.browser-use.com/new-api-key'
	)

BASE_URL = os.getenv('BROWSER_USE_BASE_URL', 'https://api.browser-use.com/api/v1')
TIMEOUT = int(os.getenv('BROWSER_USE_TIMEOUT', '30'))
HEADERS = {'Authorization': f'Bearer {API_KEY}', 'Content-Type': 'application/json'}


def _request_with_retry(method: str, url: str, **kwargs) -> requests.Response:
	"""Make HTTP request with timeout and retry logic."""
	kwargs.setdefault('timeout', TIMEOUT)

	for attempt in range(3):
		try:
			response = requests.request(method, url, **kwargs)
			response.raise_for_status()
			return response
		except RequestException as e:
			if attempt == 2:  # Last attempt
				raise
			sleep_time = 2**attempt
			print(f'⚠️  Request failed (attempt {attempt + 1}/3), retrying in {sleep_time}s: {e}')
			time.sleep(sleep_time)

	raise RuntimeError('Unexpected error in retry logic')


def create_fast_task(instructions: str) -> str:
	"""
	Create a browser automation task optimized for speed and cost.

	Args:
	    instructions: Natural language description of what the agent should do

	Returns:
	    task_id: Unique identifier for the created task
	"""
	print(f'⚡ Creating FAST task: {instructions}')

	# Ultra-fast configuration
	payload = {
		'task': instructions,
		# Model: Fastest and cheapest
		'llm_model': 'gemini-2.5-flash',
		# Performance optimizations
		'use_proxy': False,  # No proxy = faster execution
		'highlight_elements': False,  # No highlighting = better performance
		'use_adblock': True,  # Block ads for faster loading
		# Viewport optimization (smaller = faster)
		'browser_viewport_width': 1024,
		'browser_viewport_height': 768,
		# Cost control
		'max_agent_steps': 25,  # Reasonable limit for fast tasks
		# Enable sharing for viewing execution
		'enable_public_share': True,  # Get shareable URLs
		# Optional: Speed up with domain restrictions
		# "allowed_domains": ["google.com", "*.google.com"]
	}

	response = _request_with_retry('post', f'{BASE_URL}/run-task', headers=HEADERS, json=payload)

	task_id = response.json()['id']
	print(f'✅ Fast task created with ID: {task_id}')
	print('⚡ Configuration: Gemini Flash + No Proxy + No Highlighting')
	return task_id


def monitor_fast_task(task_id: str) -> dict[str, Any]:
	"""
	Monitor task with optimized polling for fast execution.

	Args:
	    task_id: The task to monitor

	Returns:
	    Complete task details with output
	"""
	print(f'🚀 Fast monitoring task {task_id}...')

	start_time = time.time()
	step_count = 0
	last_step_time = start_time

	# Faster polling for quick tasks
	poll_interval = 1  # Check every second for fast tasks

	while True:
		response = _request_with_retry('get', f'{BASE_URL}/task/{task_id}', headers=HEADERS)
		details = response.json()
		status = details['status']

		# Show progress with timing
		current_steps = len(details.get('steps', []))
		elapsed = time.time() - start_time

		# Build status message
		if current_steps > step_count:
			step_time = time.time() - last_step_time
			last_step_time = time.time()
			step_count = current_steps
			step_msg = f'🔥 Step {current_steps} | ⚡ {step_time:.1f}s | Total: {elapsed:.1f}s'
		else:
			if status == 'running':
				step_msg = f'🚀 Step {current_steps} | ⏱️  {elapsed:.1f}s | Fast processing...'
			else:
				step_msg = f'🚀 Step {current_steps} | ⏱️  {elapsed:.1f}s | Status: {status}'

		# Clear line and show progress
		print(f'\r{step_msg:<80}', end='', flush=True)

		# Check completion
		if status == 'finished':
			total_time = time.time() - start_time
			if current_steps > 0:
				avg_msg = f'⚡ Average: {total_time / current_steps:.1f}s per step'
			else:
				avg_msg = '⚡ No steps recorded'
			print(f'\r🏁 Task completed in {total_time:.1f}s! {avg_msg}' + ' ' * 20)
			return details

		elif status in ['failed', 'stopped']:
			print(f'\r❌ Task {status} after {elapsed:.1f}s' + ' ' * 30)
			return details

		time.sleep(poll_interval)


def run_speed_comparison():
	"""Run multiple tasks to compare speed vs accuracy."""
	print('\n🏃‍♂️ Speed Comparison Demo')
	print('=' * 40)

	tasks = [
		'Go to ProductHunt and roast the top product like a sarcastic tech reviewer',
		'Visit Reddit r/ProgrammerHumor and summarize the top post as a dramatic news story',
		"Check GitHub trending and write a conspiracy theory about why everyone's switching to Rust",
	]

	results = []

	for i, task in enumerate(tasks, 1):
		print(f'\n📝 Fast Task {i}/{len(tasks)}')
		print(f'Task: {task}')

		start = time.time()
		task_id = create_fast_task(task)
		result = monitor_fast_task(task_id)
		end = time.time()

		results.append(
			{
				'task': task,
				'duration': end - start,
				'steps': len(result.get('steps', [])),
				'status': result['status'],
				'output': result.get('output', '')[:100] + '...' if result.get('output') else 'No output',
			}
		)

	# Summary
	print('\n📊 Speed Summary')
	print('=' * 50)
	total_time = sum(r['duration'] for r in results)
	total_steps = sum(r['steps'] for r in results)

	for i, result in enumerate(results, 1):
		print(f'Task {i}: {result["duration"]:.1f}s ({result["steps"]} steps) - {result["status"]}')

	print(f'\n⚡ Total time: {total_time:.1f}s')
	print(f'🔥 Average per task: {total_time / len(results):.1f}s')
	if total_steps > 0:
		print(f'💨 Average per step: {total_time / total_steps:.1f}s')
	else:
		print('💨 Average per step: N/A (no steps recorded)')


def main():
	"""Demonstrate ultra-fast cloud automation."""
	print('⚡ Browser Use Cloud - Ultra-Fast Mode with Gemini Flash')
	print('=' * 60)

	print('🎯 Configuration Benefits:')
	print('• Gemini Flash: $0.01 per step (cheapest)')
	print('• No proxy: 30% faster execution')
	print('• No highlighting: Better performance')
	print('• Optimized viewport: Faster rendering')

	try:
		# Single fast task
		print('\n🚀 Single Fast Task Demo')
		print('-' * 30)

		task = """
        Go to Hacker News (news.ycombinator.com) and get the top 3 articles from the front page.

        Then, write a funny tech news segment in the style of Fireship YouTube channel:
        - Be sarcastic and witty about tech trends
        - Use developer humor and memes
        - Make fun of common programming struggles
        - Include phrases like "And yes, it runs on JavaScript" or "Plot twist: it's written in Rust"
        - Keep it under 250 words but make it entertaining
        - Structure it like a news anchor delivering breaking tech news

        Make each story sound dramatic but also hilarious, like you're reporting on the most important events in human history.
        """
		task_id = create_fast_task(task)
		result = monitor_fast_task(task_id)

		print(f'\n📊 Result: {result.get("output", "No output")}')

		# Show execution URLs
		if result.get('live_url'):
			print(f'\n🔗 Live Preview: {result["live_url"]}')
		if result.get('public_share_url'):
			print(f'🌐 Share URL: {result["public_share_url"]}')
		elif result.get('share_url'):
			print(f'🌐 Share URL: {result["share_url"]}')

		# Optional: Run speed comparison with --compare flag
		parser = argparse.ArgumentParser(description='Fast mode demo with Gemini Flash')
		parser.add_argument('--compare', action='store_true', help='Run speed comparison with 3 tasks')
		args = parser.parse_args()

		if args.compare:
			print('\n🏃‍♂️ Running speed comparison...')
			run_speed_comparison()

	except requests.exceptions.RequestException as e:
		print(f'❌ API Error: {e}')
	except Exception as e:
		print(f'❌ Error: {e}')


if __name__ == '__main__':
	main()

```

---

## backend/browser-use/examples/cloud/03_structured_output.py

```py
"""
Cloud Example 3: Structured JSON Output 📋
==========================================

This example demonstrates how to get structured, validated JSON output:
- Define Pydantic schemas for type safety
- Extract structured data from websites
- Validate and parse JSON responses
- Handle different data types and nested structures

Perfect for: Data extraction, API integration, structured analysis

Cost: ~$0.06 (1 task + 5-6 steps with GPT-4.1 mini)
"""

import argparse
import json
import os
import time
from typing import Any

import requests
from pydantic import BaseModel, Field, ValidationError
from requests.exceptions import RequestException

# Configuration
API_KEY = os.getenv('BROWSER_USE_API_KEY')
if not API_KEY:
	raise ValueError(
		'Please set BROWSER_USE_API_KEY environment variable. You can also create an API key at https://cloud.browser-use.com/new-api-key'
	)

BASE_URL = os.getenv('BROWSER_USE_BASE_URL', 'https://api.browser-use.com/api/v1')
TIMEOUT = int(os.getenv('BROWSER_USE_TIMEOUT', '30'))
HEADERS = {'Authorization': f'Bearer {API_KEY}', 'Content-Type': 'application/json'}


def _request_with_retry(method: str, url: str, **kwargs) -> requests.Response:
	"""Make HTTP request with timeout and retry logic."""
	kwargs.setdefault('timeout', TIMEOUT)

	for attempt in range(3):
		try:
			response = requests.request(method, url, **kwargs)
			response.raise_for_status()
			return response
		except RequestException as e:
			if attempt == 2:  # Last attempt
				raise
			sleep_time = 2**attempt
			print(f'⚠️  Request failed (attempt {attempt + 1}/3), retrying in {sleep_time}s: {e}')
			time.sleep(sleep_time)

	raise RuntimeError('Unexpected error in retry logic')


# Define structured output schemas using Pydantic
class NewsArticle(BaseModel):
	"""Schema for a news article."""

	title: str = Field(description='The headline of the article')
	summary: str = Field(description='Brief summary of the article')
	url: str = Field(description='Direct link to the article')
	published_date: str | None = Field(description='Publication date if available')
	category: str | None = Field(description='Article category/section')


class NewsResponse(BaseModel):
	"""Schema for multiple news articles."""

	articles: list[NewsArticle] = Field(description='List of news articles')
	source_website: str = Field(description='The website where articles were found')
	extracted_at: str = Field(description='When the data was extracted')


class ProductInfo(BaseModel):
	"""Schema for product information."""

	name: str = Field(description='Product name')
	price: float = Field(description='Product price in USD')
	rating: float | None = Field(description='Average rating (0-5 scale)')
	availability: str = Field(description='Stock status (in stock, out of stock, etc.)')
	description: str = Field(description='Product description')


class CompanyInfo(BaseModel):
	"""Schema for company information."""

	name: str = Field(description='Company name')
	stock_symbol: str | None = Field(description='Stock ticker symbol')
	market_cap: str | None = Field(description='Market capitalization')
	industry: str = Field(description='Primary industry')
	headquarters: str = Field(description='Headquarters location')
	founded_year: int | None = Field(description='Year founded')


def create_structured_task(instructions: str, schema_model: type[BaseModel], **kwargs) -> str:
	"""
	Create a task that returns structured JSON output.

	Args:
	    instructions: Task description
	    schema_model: Pydantic model defining the expected output structure
	    **kwargs: Additional task parameters

	Returns:
	    task_id: Unique identifier for the created task
	"""
	print(f'📝 Creating structured task: {instructions}')
	print(f'🏗️  Expected schema: {schema_model.__name__}')

	# Generate JSON schema from Pydantic model
	json_schema = schema_model.model_json_schema()

	payload = {
		'task': instructions,
		'structured_output_json': json.dumps(json_schema),
		'llm_model': 'gpt-4.1-mini',
		'max_agent_steps': 15,
		'enable_public_share': True,  # Enable shareable execution URLs
		**kwargs,
	}

	response = _request_with_retry('post', f'{BASE_URL}/run-task', headers=HEADERS, json=payload)

	task_id = response.json()['id']
	print(f'✅ Structured task created: {task_id}')
	return task_id


def wait_for_structured_completion(task_id: str, max_wait_time: int = 300) -> dict[str, Any]:
	"""Wait for task completion and return the result."""
	print(f'⏳ Waiting for structured output (max {max_wait_time}s)...')

	start_time = time.time()

	while True:
		response = _request_with_retry('get', f'{BASE_URL}/task/{task_id}/status', headers=HEADERS)
		status = response.json()
		elapsed = time.time() - start_time

		# Check for timeout
		if elapsed > max_wait_time:
			print(f'\r⏰ Task timeout after {max_wait_time}s - stopping wait' + ' ' * 30)
			# Get final details before timeout
			details_response = _request_with_retry('get', f'{BASE_URL}/task/{task_id}', headers=HEADERS)
			details = details_response.json()
			return details

		# Get step count from full details for better progress tracking
		details_response = _request_with_retry('get', f'{BASE_URL}/task/{task_id}', headers=HEADERS)
		details = details_response.json()
		steps = len(details.get('steps', []))

		# Build status message
		if status == 'running':
			status_msg = f'📋 Structured task | Step {steps} | ⏱️  {elapsed:.0f}s | 🔄 Extracting...'
		else:
			status_msg = f'📋 Structured task | Step {steps} | ⏱️  {elapsed:.0f}s | Status: {status}'

		# Clear line and show status
		print(f'\r{status_msg:<80}', end='', flush=True)

		if status == 'finished':
			print(f'\r✅ Structured data extracted! ({steps} steps in {elapsed:.1f}s)' + ' ' * 20)
			return details

		elif status in ['failed', 'stopped']:
			print(f'\r❌ Task {status} after {steps} steps' + ' ' * 30)
			return details

		time.sleep(3)


def validate_and_display_output(output: str, schema_model: type[BaseModel]):
	"""
	Validate the JSON output against the schema and display results.

	Args:
	    output: Raw JSON string from the task
	    schema_model: Pydantic model for validation
	"""
	print('\n📊 Structured Output Analysis')
	print('=' * 40)

	try:
		# Parse and validate the JSON
		parsed_data = schema_model.model_validate_json(output)
		print('✅ JSON validation successful!')

		# Pretty print the structured data
		print('\n📋 Parsed Data:')
		print('-' * 20)
		print(parsed_data.model_dump_json(indent=2))

		# Display specific fields based on model type
		if isinstance(parsed_data, NewsResponse):
			print(f'\n📰 Found {len(parsed_data.articles)} articles from {parsed_data.source_website}')
			for i, article in enumerate(parsed_data.articles[:3], 1):
				print(f'\n{i}. {article.title}')
				print(f'   Summary: {article.summary[:100]}...')
				print(f'   URL: {article.url}')

		elif isinstance(parsed_data, ProductInfo):
			print(f'\n🛍️  Product: {parsed_data.name}')
			print(f'   Price: ${parsed_data.price}')
			print(f'   Rating: {parsed_data.rating}/5' if parsed_data.rating else '   Rating: N/A')
			print(f'   Status: {parsed_data.availability}')

		elif isinstance(parsed_data, CompanyInfo):
			print(f'\n🏢 Company: {parsed_data.name}')
			print(f'   Industry: {parsed_data.industry}')
			print(f'   Headquarters: {parsed_data.headquarters}')
			if parsed_data.founded_year:
				print(f'   Founded: {parsed_data.founded_year}')

		return parsed_data

	except ValidationError as e:
		print('❌ JSON validation failed!')
		print(f'Errors: {e}')
		print(f'\nRaw output: {output[:500]}...')
		return None

	except json.JSONDecodeError as e:
		print('❌ Invalid JSON format!')
		print(f'Error: {e}')
		print(f'\nRaw output: {output[:500]}...')
		return None


def demo_news_extraction():
	"""Demo: Extract structured news data."""
	print('\n📰 Demo 1: News Article Extraction')
	print('-' * 40)

	task = """
    Go to a major news website (like BBC, CNN, or Reuters) and extract information
    about the top 3 news articles. For each article, get the title, summary, URL,
    and any other available metadata.
    """

	task_id = create_structured_task(task, NewsResponse)
	result = wait_for_structured_completion(task_id)

	if result.get('output'):
		parsed_result = validate_and_display_output(result['output'], NewsResponse)

		# Show execution URLs
		if result.get('live_url'):
			print(f'\n🔗 Live Preview: {result["live_url"]}')
		if result.get('public_share_url'):
			print(f'🌐 Share URL: {result["public_share_url"]}')
		elif result.get('share_url'):
			print(f'🌐 Share URL: {result["share_url"]}')

		return parsed_result
	else:
		print('❌ No structured output received')
		return None


def demo_product_extraction():
	"""Demo: Extract structured product data."""
	print('\n🛍️  Demo 2: Product Information Extraction')
	print('-' * 40)

	task = """
    Go to Amazon and search for 'wireless headphones'. Find the first product result
    and extract detailed information including name, price, rating, availability,
    and description.
    """

	task_id = create_structured_task(task, ProductInfo)
	result = wait_for_structured_completion(task_id)

	if result.get('output'):
		parsed_result = validate_and_display_output(result['output'], ProductInfo)

		# Show execution URLs
		if result.get('live_url'):
			print(f'\n🔗 Live Preview: {result["live_url"]}')
		if result.get('public_share_url'):
			print(f'🌐 Share URL: {result["public_share_url"]}')
		elif result.get('share_url'):
			print(f'🌐 Share URL: {result["share_url"]}')

		return parsed_result
	else:
		print('❌ No structured output received')
		return None


def demo_company_extraction():
	"""Demo: Extract structured company data."""
	print('\n🏢 Demo 3: Company Information Extraction')
	print('-' * 40)

	task = """
    Go to a financial website and look up information about Apple Inc.
    Extract company details including name, stock symbol, market cap,
    industry, headquarters, and founding year.
    """

	task_id = create_structured_task(task, CompanyInfo)
	result = wait_for_structured_completion(task_id)

	if result.get('output'):
		parsed_result = validate_and_display_output(result['output'], CompanyInfo)

		# Show execution URLs
		if result.get('live_url'):
			print(f'\n🔗 Live Preview: {result["live_url"]}')
		if result.get('public_share_url'):
			print(f'🌐 Share URL: {result["public_share_url"]}')
		elif result.get('share_url'):
			print(f'🌐 Share URL: {result["share_url"]}')

		return parsed_result
	else:
		print('❌ No structured output received')
		return None


def main():
	"""Demonstrate structured output extraction."""
	print('📋 Browser Use Cloud - Structured JSON Output')
	print('=' * 50)

	print('🎯 Features:')
	print('• Type-safe Pydantic schemas')
	print('• Automatic JSON validation')
	print('• Structured data extraction')
	print('• Multiple output formats')

	try:
		# Parse command line arguments
		parser = argparse.ArgumentParser(description='Structured output extraction demo')
		parser.add_argument('--demo', choices=['news', 'product', 'company', 'all'], default='news', help='Which demo to run')
		args = parser.parse_args()

		print(f'\n🔍 Running {args.demo} demo(s)...')

		if args.demo == 'news':
			demo_news_extraction()
		elif args.demo == 'product':
			demo_product_extraction()
		elif args.demo == 'company':
			demo_company_extraction()
		elif args.demo == 'all':
			demo_news_extraction()
			demo_product_extraction()
			demo_company_extraction()

	except requests.exceptions.RequestException as e:
		print(f'❌ API Error: {e}')
	except Exception as e:
		print(f'❌ Error: {e}')


if __name__ == '__main__':
	main()

```

---

## backend/browser-use/examples/cloud/04_proxy_usage.py

```py
"""
Cloud Example 4: Proxy Usage 🌍
===============================

This example demonstrates reliable proxy usage scenarios:
- Different country proxies for geo-restrictions
- IP address and location verification
- Region-specific content access (streaming, news)
- Search result localization by country
- Mobile/residential proxy benefits

Perfect for: Geo-restricted content, location testing, regional analysis

Cost: ~$0.08 (1 task + 6-8 steps with proxy enabled)
"""

import argparse
import os
import time
from typing import Any

import requests
from requests.exceptions import RequestException

# Configuration
API_KEY = os.getenv('BROWSER_USE_API_KEY')
if not API_KEY:
	raise ValueError(
		'Please set BROWSER_USE_API_KEY environment variable. You can also create an API key at https://cloud.browser-use.com/new-api-key'
	)

BASE_URL = os.getenv('BROWSER_USE_BASE_URL', 'https://api.browser-use.com/api/v1')
TIMEOUT = int(os.getenv('BROWSER_USE_TIMEOUT', '30'))
HEADERS = {'Authorization': f'Bearer {API_KEY}', 'Content-Type': 'application/json'}


def _request_with_retry(method: str, url: str, **kwargs) -> requests.Response:
	"""Make HTTP request with timeout and retry logic."""
	kwargs.setdefault('timeout', TIMEOUT)

	for attempt in range(3):
		try:
			response = requests.request(method, url, **kwargs)
			response.raise_for_status()
			return response
		except RequestException as e:
			if attempt == 2:  # Last attempt
				raise
			sleep_time = 2**attempt
			print(f'⚠️  Request failed (attempt {attempt + 1}/3), retrying in {sleep_time}s: {e}')
			time.sleep(sleep_time)

	raise RuntimeError('Unexpected error in retry logic')


def create_task_with_proxy(instructions: str, country_code: str = 'us') -> str:
	"""
	Create a task with proxy enabled from a specific country.

	Args:
	    instructions: Task description
	    country_code: Proxy country ('us', 'fr', 'it', 'jp', 'au', 'de', 'fi', 'ca')

	Returns:
	    task_id: Unique identifier for the created task
	"""
	print(f'🌍 Creating task with {country_code.upper()} proxy')
	print(f'📝 Task: {instructions}')

	payload = {
		'task': instructions,
		'llm_model': 'gpt-4.1-mini',
		# Proxy configuration
		'use_proxy': True,  # Required for captcha solving
		'proxy_country_code': country_code,  # Choose proxy location
		# Standard settings
		'use_adblock': True,  # Block ads for faster loading
		'highlight_elements': True,  # Keep highlighting for visibility
		'max_agent_steps': 15,
		# Enable sharing for viewing execution
		'enable_public_share': True,  # Get shareable URLs
	}

	response = _request_with_retry('post', f'{BASE_URL}/run-task', headers=HEADERS, json=payload)

	task_id = response.json()['id']
	print(f'✅ Task created with {country_code.upper()} proxy: {task_id}')
	return task_id


def test_ip_location(country_code: str) -> dict[str, Any]:
	"""Test IP address and location detection with proxy."""
	task = """
    Go to whatismyipaddress.com and tell me:
    1. The detected IP address
    2. The detected country/location
    3. The ISP/organization
    4. Any other location details shown

    Please be specific about what you see on the page.
    """

	task_id = create_task_with_proxy(task, country_code)
	return wait_for_completion(task_id)


def test_geo_restricted_content(country_code: str) -> dict[str, Any]:
	"""Test access to geo-restricted content."""
	task = """
    Go to a major news website (like BBC, CNN, or local news) and check:
    1. What content is available
    2. Any geo-restriction messages
    3. Local/regional content differences
    4. Language or currency preferences shown

    Note any differences from what you might expect.
    """

	task_id = create_task_with_proxy(task, country_code)
	return wait_for_completion(task_id)


def test_streaming_service_access(country_code: str) -> dict[str, Any]:
	"""Test access to region-specific streaming content."""
	task = """
    Go to a major streaming service website (like Netflix, YouTube, or BBC iPlayer)
    and check what content or messaging appears.

    Report:
    1. What homepage content is shown
    2. Any geo-restriction messages or content differences
    3. Available content regions or language options
    4. Any pricing or availability differences

    Note: Don't try to log in, just observe the publicly available content.
    """

	task_id = create_task_with_proxy(task, country_code)
	return wait_for_completion(task_id)


def test_search_results_by_location(country_code: str) -> dict[str, Any]:
	"""Test how search results vary by location."""
	task = """
    Go to Google and search for "best restaurants near me" or "local news".

    Report:
    1. What local results appear
    2. The detected location in search results
    3. Any location-specific content or ads
    4. Language preferences

    This will show how search results change based on proxy location.
    """

	task_id = create_task_with_proxy(task, country_code)
	return wait_for_completion(task_id)


def wait_for_completion(task_id: str) -> dict[str, Any]:
	"""Wait for task completion and return results."""
	print(f'⏳ Waiting for task {task_id} to complete...')

	start_time = time.time()

	while True:
		response = _request_with_retry('get', f'{BASE_URL}/task/{task_id}', headers=HEADERS)
		details = response.json()

		status = details['status']
		steps = len(details.get('steps', []))
		elapsed = time.time() - start_time

		# Build status message
		if status == 'running':
			status_msg = f'🌍 Proxy task | Step {steps} | ⏱️  {elapsed:.0f}s | 🤖 Processing...'
		else:
			status_msg = f'🌍 Proxy task | Step {steps} | ⏱️  {elapsed:.0f}s | Status: {status}'

		# Clear line and show status
		print(f'\r{status_msg:<80}', end='', flush=True)

		if status == 'finished':
			print(f'\r✅ Task completed in {steps} steps! ({elapsed:.1f}s total)' + ' ' * 20)
			return details

		elif status in ['failed', 'stopped']:
			print(f'\r❌ Task {status} after {steps} steps' + ' ' * 30)
			return details

		time.sleep(3)


def demo_proxy_countries():
	"""Demonstrate proxy usage across different countries."""
	print('\n🌍 Demo 1: Proxy Countries Comparison')
	print('-' * 45)

	countries = [('us', 'United States'), ('de', 'Germany'), ('jp', 'Japan'), ('au', 'Australia')]

	results = {}

	for code, name in countries:
		print(f'\n🌍 Testing {name} ({code.upper()}) proxy:')
		print('=' * 40)

		result = test_ip_location(code)
		results[code] = result

		if result.get('output'):
			print(f'📍 Location Result: {result["output"][:200]}...')

		# Show execution URLs
		if result.get('live_url'):
			print(f'🔗 Live Preview: {result["live_url"]}')
		if result.get('public_share_url'):
			print(f'🌐 Share URL: {result["public_share_url"]}')
		elif result.get('share_url'):
			print(f'🌐 Share URL: {result["share_url"]}')

		print('-' * 40)
		time.sleep(2)  # Brief pause between tests

	# Summary comparison
	print('\n📊 Proxy Location Summary:')
	print('=' * 30)
	for code, result in results.items():
		status = result.get('status', 'unknown')
		print(f'{code.upper()}: {status}')


def demo_geo_restrictions():
	"""Demonstrate geo-restriction bypass."""
	print('\n🚫 Demo 2: Geo-Restriction Testing')
	print('-' * 40)

	# Test from different locations
	locations = [('us', 'US content'), ('de', 'European content')]

	for code, description in locations:
		print(f'\n🌍 Testing {description} with {code.upper()} proxy:')
		result = test_geo_restricted_content(code)

		if result.get('output'):
			print(f'📰 Content Access: {result["output"][:200]}...')

		time.sleep(2)


def demo_streaming_access():
	"""Demonstrate streaming service access with different proxies."""
	print('\n📺 Demo 3: Streaming Service Access')
	print('-' * 40)

	locations = [('us', 'US'), ('de', 'Germany')]

	for code, name in locations:
		print(f'\n🌍 Testing streaming access from {name}:')
		result = test_streaming_service_access(code)

		if result.get('output'):
			print(f'📺 Access Result: {result["output"][:200]}...')

		time.sleep(2)


def demo_search_localization():
	"""Demonstrate search result localization."""
	print('\n🔍 Demo 4: Search Localization')
	print('-' * 35)

	locations = [('us', 'US'), ('de', 'Germany')]

	for code, name in locations:
		print(f'\n🌍 Testing search results from {name}:')
		result = test_search_results_by_location(code)

		if result.get('output'):
			print(f'🔍 Search Results: {result["output"][:200]}...')

		time.sleep(2)


def main():
	"""Demonstrate comprehensive proxy usage."""
	print('🌍 Browser Use Cloud - Proxy Usage Examples')
	print('=' * 50)

	print('🎯 Proxy Benefits:')
	print('• Bypass geo-restrictions')
	print('• Test location-specific content')
	print('• Access region-locked websites')
	print('• Mobile/residential IP addresses')
	print('• Verify IP geolocation')

	print('\n🌐 Available Countries:')
	countries = ['🇺🇸 US', '🇫🇷 France', '🇮🇹 Italy', '🇯🇵 Japan', '🇦🇺 Australia', '🇩🇪 Germany', '🇫🇮 Finland', '🇨🇦 Canada']
	print(' • '.join(countries))

	try:
		# Parse command line arguments
		parser = argparse.ArgumentParser(description='Proxy usage examples')
		parser.add_argument(
			'--demo', choices=['countries', 'geo', 'streaming', 'search', 'all'], default='countries', help='Which demo to run'
		)
		args = parser.parse_args()

		print(f'\n🔍 Running {args.demo} demo(s)...')

		if args.demo == 'countries':
			demo_proxy_countries()
		elif args.demo == 'geo':
			demo_geo_restrictions()
		elif args.demo == 'streaming':
			demo_streaming_access()
		elif args.demo == 'search':
			demo_search_localization()
		elif args.demo == 'all':
			demo_proxy_countries()
			demo_geo_restrictions()
			demo_streaming_access()
			demo_search_localization()

	except requests.exceptions.RequestException as e:
		print(f'❌ API Error: {e}')
	except Exception as e:
		print(f'❌ Error: {e}')


if __name__ == '__main__':
	main()

```

---

## backend/browser-use/examples/cloud/05_search_api.py

```py
"""
Cloud Example 5: Search API (Beta) 🔍
=====================================

This example demonstrates the Browser Use Search API (BETA):
- Simple search: Search Google and extract from multiple results
- URL search: Extract specific content from a target URL
- Deep navigation through websites (depth parameter)
- Real-time content extraction vs cached results

Perfect for: Content extraction, research, competitive analysis
"""

import argparse
import asyncio
import json
import os
import time
from typing import Any

import aiohttp

# Configuration
API_KEY = os.getenv('BROWSER_USE_API_KEY')
if not API_KEY:
	raise ValueError(
		'Please set BROWSER_USE_API_KEY environment variable. You can also create an API key at https://cloud.browser-use.com/new-api-key'
	)

BASE_URL = os.getenv('BROWSER_USE_BASE_URL', 'https://api.browser-use.com/api/v1')
TIMEOUT = int(os.getenv('BROWSER_USE_TIMEOUT', '30'))
HEADERS = {'Authorization': f'Bearer {API_KEY}', 'Content-Type': 'application/json'}


async def simple_search(query: str, max_websites: int = 5, depth: int = 2) -> dict[str, Any]:
	"""
	Search Google and extract content from multiple top results.

	Args:
	    query: Search query to process
	    max_websites: Number of websites to process (1-10)
	    depth: How deep to navigate (2-5)

	Returns:
	    Dictionary with results from multiple websites
	"""
	# Validate input parameters
	max_websites = max(1, min(max_websites, 10))  # Clamp to 1-10
	depth = max(2, min(depth, 5))  # Clamp to 2-5

	start_time = time.time()

	print(f"🔍 Simple Search: '{query}'")
	print(f'📊 Processing {max_websites} websites at depth {depth}')
	print(f'💰 Estimated cost: {depth * max_websites}¢')

	payload = {'query': query, 'max_websites': max_websites, 'depth': depth}

	timeout = aiohttp.ClientTimeout(total=TIMEOUT)
	connector = aiohttp.TCPConnector(limit=10)  # Limit concurrent connections

	async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
		async with session.post(f'{BASE_URL}/simple-search', json=payload, headers=HEADERS) as response:
			elapsed = time.time() - start_time
			if response.status == 200:
				try:
					result = await response.json()
					print(f'✅ Found results from {len(result.get("results", []))} websites in {elapsed:.1f}s')
					return result
				except (aiohttp.ContentTypeError, json.JSONDecodeError) as e:
					error_text = await response.text()
					print(f'❌ Invalid JSON response: {e} (after {elapsed:.1f}s)')
					return {'error': 'Invalid JSON', 'details': error_text}
			else:
				error_text = await response.text()
				print(f'❌ Search failed: {response.status} - {error_text} (after {elapsed:.1f}s)')
				return {'error': f'HTTP {response.status}', 'details': error_text}


async def search_url(url: str, query: str, depth: int = 2) -> dict[str, Any]:
	"""
	Extract specific content from a target URL.

	Args:
	    url: Target URL to extract from
	    query: What specific content to look for
	    depth: How deep to navigate (2-5)

	Returns:
	    Dictionary with extracted content
	"""
	# Validate input parameters
	depth = max(2, min(depth, 5))  # Clamp to 2-5

	start_time = time.time()

	print(f'🎯 URL Search: {url}')
	print(f"🔍 Looking for: '{query}'")
	print(f'📊 Navigation depth: {depth}')
	print(f'💰 Estimated cost: {depth}¢')

	payload = {'url': url, 'query': query, 'depth': depth}

	timeout = aiohttp.ClientTimeout(total=TIMEOUT)
	connector = aiohttp.TCPConnector(limit=10)  # Limit concurrent connections

	async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
		async with session.post(f'{BASE_URL}/search-url', json=payload, headers=HEADERS) as response:
			elapsed = time.time() - start_time
			if response.status == 200:
				try:
					result = await response.json()
					print(f'✅ Extracted content from {result.get("url", "website")} in {elapsed:.1f}s')
					return result
				except (aiohttp.ContentTypeError, json.JSONDecodeError) as e:
					error_text = await response.text()
					print(f'❌ Invalid JSON response: {e} (after {elapsed:.1f}s)')
					return {'error': 'Invalid JSON', 'details': error_text}
			else:
				error_text = await response.text()
				print(f'❌ URL search failed: {response.status} - {error_text} (after {elapsed:.1f}s)')
				return {'error': f'HTTP {response.status}', 'details': error_text}


def display_simple_search_results(results: dict[str, Any]):
	"""Display simple search results in a readable format."""
	if 'error' in results:
		print(f'❌ Error: {results["error"]}')
		return

	websites = results.get('results', [])

	print(f'\n📋 Search Results ({len(websites)} websites)')
	print('=' * 50)

	for i, site in enumerate(websites, 1):
		url = site.get('url', 'Unknown URL')
		content = site.get('content', 'No content')

		print(f'\n{i}. 🌐 {url}')
		print('-' * 40)

		# Show first 300 chars of content
		if len(content) > 300:
			print(f'{content[:300]}...')
			print(f'[Content truncated - {len(content)} total characters]')
		else:
			print(content)

	# Show execution URLs if available
	if results.get('live_url'):
		print(f'\n🔗 Live Preview: {results["live_url"]}')
	if results.get('public_share_url'):
		print(f'🌐 Share URL: {results["public_share_url"]}')
	elif results.get('share_url'):
		print(f'🌐 Share URL: {results["share_url"]}')


def display_url_search_results(results: dict[str, Any]):
	"""Display URL search results in a readable format."""
	if 'error' in results:
		print(f'❌ Error: {results["error"]}')
		return

	url = results.get('url', 'Unknown URL')
	content = results.get('content', 'No content')

	print(f'\n📄 Extracted Content from: {url}')
	print('=' * 60)
	print(content)

	# Show execution URLs if available
	if results.get('live_url'):
		print(f'\n🔗 Live Preview: {results["live_url"]}')
	if results.get('public_share_url'):
		print(f'🌐 Share URL: {results["public_share_url"]}')
	elif results.get('share_url'):
		print(f'🌐 Share URL: {results["share_url"]}')


async def demo_news_search():
	"""Demo: Search for latest news across multiple sources."""
	print('\n📰 Demo 1: Latest News Search')
	print('-' * 35)

	demo_start = time.time()
	query = 'latest developments in artificial intelligence 2024'
	results = await simple_search(query, max_websites=4, depth=2)
	demo_elapsed = time.time() - demo_start

	display_simple_search_results(results)
	print(f'\n⏱️  Total demo time: {demo_elapsed:.1f}s')

	return results


async def demo_competitive_analysis():
	"""Demo: Analyze competitor websites."""
	print('\n🏢 Demo 2: Competitive Analysis')
	print('-' * 35)

	query = 'browser automation tools comparison features pricing'
	results = await simple_search(query, max_websites=3, depth=3)
	display_simple_search_results(results)

	return results


async def demo_deep_website_analysis():
	"""Demo: Deep analysis of a specific website."""
	print('\n🎯 Demo 3: Deep Website Analysis')
	print('-' * 35)

	demo_start = time.time()
	url = 'https://docs.browser-use.com'
	query = 'Browser Use features, pricing, and API capabilities'
	results = await search_url(url, query, depth=3)
	demo_elapsed = time.time() - demo_start

	display_url_search_results(results)
	print(f'\n⏱️  Total demo time: {demo_elapsed:.1f}s')

	return results


async def demo_product_research():
	"""Demo: Product research and comparison."""
	print('\n🛍️  Demo 4: Product Research')
	print('-' * 30)

	query = 'best wireless headphones 2024 reviews comparison'
	results = await simple_search(query, max_websites=5, depth=2)
	display_simple_search_results(results)

	return results


async def demo_real_time_vs_cached():
	"""Demo: Show difference between real-time and cached results."""
	print('\n⚡ Demo 5: Real-time vs Cached Data')
	print('-' * 40)

	print('🔄 Browser Use Search API benefits:')
	print('• Actually browses websites like a human')
	print('• Gets live, current data (not cached)')
	print('• Navigates deep into sites via clicks')
	print('• Handles JavaScript and dynamic content')
	print('• Accesses pages requiring navigation')

	# Example with live data
	query = 'current Bitcoin price USD live'
	results = await simple_search(query, max_websites=3, depth=2)

	print('\n💰 Live Bitcoin Price Search Results:')
	display_simple_search_results(results)

	return results


async def demo_search_depth_comparison():
	"""Demo: Compare different search depths."""
	print('\n📊 Demo 6: Search Depth Comparison')
	print('-' * 40)

	url = 'https://news.ycombinator.com'
	query = 'trending technology discussions'

	depths = [2, 3, 4]
	results = {}

	for depth in depths:
		print(f'\n🔍 Testing depth {depth}:')
		result = await search_url(url, query, depth)
		results[depth] = result

		if 'content' in result:
			content_length = len(result['content'])
			print(f'📏 Content length: {content_length} characters')

		# Brief pause between requests
		await asyncio.sleep(1)

	# Summary
	print('\n📊 Depth Comparison Summary:')
	print('-' * 30)
	for depth, result in results.items():
		if 'content' in result:
			length = len(result['content'])
			print(f'Depth {depth}: {length} characters')
		else:
			print(f'Depth {depth}: Error or no content')

	return results


async def main():
	"""Demonstrate comprehensive Search API usage."""
	print('🔍 Browser Use Cloud - Search API (BETA)')
	print('=' * 45)

	print('⚠️  Note: This API is in BETA and may change')
	print()
	print('🎯 Search API Features:')
	print('• Real-time website browsing (not cached)')
	print('• Deep navigation through multiple pages')
	print('• Dynamic content and JavaScript handling')
	print('• Multiple result aggregation')
	print('• Cost-effective content extraction')

	print('\n💰 Pricing:')
	print('• Simple Search: 1¢ × depth × websites')
	print('• URL Search: 1¢ × depth')
	print('• Example: depth=2, 5 websites = 10¢')

	try:
		# Parse command line arguments
		parser = argparse.ArgumentParser(description='Search API (BETA) examples')
		parser.add_argument(
			'--demo',
			choices=['news', 'competitive', 'deep', 'product', 'realtime', 'depth', 'all'],
			default='news',
			help='Which demo to run',
		)
		args = parser.parse_args()

		print(f'\n🔍 Running {args.demo} demo(s)...')

		if args.demo == 'news':
			await demo_news_search()
		elif args.demo == 'competitive':
			await demo_competitive_analysis()
		elif args.demo == 'deep':
			await demo_deep_website_analysis()
		elif args.demo == 'product':
			await demo_product_research()
		elif args.demo == 'realtime':
			await demo_real_time_vs_cached()
		elif args.demo == 'depth':
			await demo_search_depth_comparison()
		elif args.demo == 'all':
			await demo_news_search()
			await demo_competitive_analysis()
			await demo_deep_website_analysis()
			await demo_product_research()
			await demo_real_time_vs_cached()
			await demo_search_depth_comparison()

	except aiohttp.ClientError as e:
		print(f'❌ Network Error: {e}')
	except Exception as e:
		print(f'❌ Error: {e}')


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/code_agent/extract_products.py

```py
"""
Example: Using code-use mode to extract products from multiple pages.

This example demonstrates the new code-use mode, which works like a Jupyter notebook
where the LLM writes Python code that gets executed in a persistent namespace.

The agent can:
- Navigate to pages
- Extract data using JavaScript
- Combine results from multiple pages
- Save data to files
- Export the session as a Jupyter notebook

This solves the problem from the brainstorm where extraction of multiple items
was difficult with the extract tool alone.
"""

import asyncio

from lmnr import Laminar

from browser_use.code_use import CodeAgent

Laminar.initialize()


async def main():
	task = """

Go to https://www.flipkart.com. Continue collecting products from Flipkart in the following categories. I need approximately 50 products from:\n\n1. Books & Media (books, stationery) - 15 products\n2. Sports & Fitness (equipment, clothing, accessories) - 15 products  \n3. Beauty & Personal Care (cosmetics, skincare, grooming) - 10 products\nAnd 2 other categories you find interesting.\nNavigate to these categories and collect products with:\n- Product URL (working link)\n- Product name/description\n- Actual price (MRP)\n- Deal price (current selling price)  \n- Discount percentage\n\nFocus on products with good discounts and clear pricing. Target around 40 products total from these three categories.

	"""
	# Create code-use agent (uses ChatBrowserUse automatically)
	agent = CodeAgent(
		task=task,
		max_steps=30,
	)

	try:
		# Run the agent
		print('Running code-use agent...')
		session = await agent.run()

	finally:
		await agent.close()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/code_agent/filter_webvoyager_dataset.py

```py
import asyncio

from browser_use.code_use import CodeAgent


async def main():
	task = """
Find the WebVoyager dataset, download it and create a new version where you remove all tasks which have older dates than today.
"""

	# Create code-use agent
	agent = CodeAgent(
		task=task,
		max_steps=25,
	)

	try:
		# Run the agent
		print('Running code-use agent to filter WebVoyager dataset...')
		session = await agent.run()

	finally:
		await agent.close()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/custom-functions/2fa.py

```py
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()


from browser_use import Agent

secret_key = os.environ.get('OTP_SECRET_KEY')
if not secret_key:
	# For this example copy the code from the website https://authenticationtest.com/totpChallenge/
	# For real 2fa just copy the secret key when you setup 2fa, you can get this e.g. in 1Password
	secret_key = 'JBSWY3DPEHPK3PXP'


sensitive_data = {'bu_2fa_code': secret_key}


task = """
1. Go to https://authenticationtest.com/totpChallenge/ and try to log in.
2. If prompted for 2FA code:
Input the the secret bu_2fa_code.

When you input bu_2fa_code, the 6 digit code will be generated automatically.
"""


Agent(task=task, sensitive_data=sensitive_data).run_sync()  # type: ignore

```

---

## backend/browser-use/examples/custom-functions/action_filters.py

```py
"""
Action filters (domains) let you limit actions available to the Agent on a step-by-step/page-by-page basis.

@registry.action(..., domains=['*'])
async def some_action(browser_session: BrowserSession):
    ...

This helps prevent the LLM from deciding to use an action that is not compatible with the current page.
It helps limit decision fatigue by scoping actions only to pages where they make sense.
It also helps prevent mis-triggering stateful actions or actions that could break other programs or leak secrets.

For example:
    - only run on certain domains @registry.action(..., domains=['example.com', '*.example.com', 'example.co.*']) (supports globs, but no regex)
    - only fill in a password on a specific login page url
    - only run if this action has not run before on this page (e.g. by looking up the url in a file on disk)

During each step, the agent recalculates the actions available specifically for that page, and informs the LLM.
"""

import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import ChatOpenAI
from browser_use.agent.service import Agent, Tools
from browser_use.browser import BrowserSession

# Initialize tools and registry
tools = Tools()
registry = tools.registry


# Action will only be available to Agent on Google domains because of the domain filter
@registry.action(description='Trigger disco mode', domains=['google.com', '*.google.com'])
async def disco_mode(browser_session: BrowserSession):
	# Execute JavaScript using CDP
	cdp_session = await browser_session.get_or_create_cdp_session()
	await cdp_session.cdp_client.send.Runtime.evaluate(
		params={
			'expression': """(() => { 
				// define the wiggle animation
				document.styleSheets[0].insertRule('@keyframes wiggle { 0% { transform: rotate(0deg); } 50% { transform: rotate(10deg); } 100% { transform: rotate(0deg); } }');
				
				document.querySelectorAll("*").forEach(element => {
					element.style.animation = "wiggle 0.5s infinite";
				});
			})()"""
		},
		session_id=cdp_session.session_id,
	)


# Custom filter function that checks URL
async def is_login_page(browser_session: BrowserSession) -> bool:
	"""Check if current page is a login page."""
	try:
		# Get current URL using CDP
		cdp_session = await browser_session.get_or_create_cdp_session()
		result = await cdp_session.cdp_client.send.Runtime.evaluate(
			params={'expression': 'window.location.href', 'returnByValue': True}, session_id=cdp_session.session_id
		)
		url = result.get('result', {}).get('value', '')
		return 'login' in url.lower() or 'signin' in url.lower()
	except Exception:
		return False


# Note: page_filter is not directly supported anymore, so we'll just use domains
# and check the condition inside the function
@registry.action(description='Use the force, luke', domains=['*'])
async def use_the_force(browser_session: BrowserSession):
	# Check if it's a login page
	if not await is_login_page(browser_session):
		return  # Skip if not a login page

	# Execute JavaScript using CDP
	cdp_session = await browser_session.get_or_create_cdp_session()
	await cdp_session.cdp_client.send.Runtime.evaluate(
		params={
			'expression': """(() => { 
				document.querySelector('body').innerHTML = 'These are not the droids you are looking for';
			})()"""
		},
		session_id=cdp_session.session_id,
	)


async def main():
	"""Main function to run the example"""
	browser_session = BrowserSession()
	await browser_session.start()
	llm = ChatOpenAI(model='gpt-4.1-mini')

	# Create the agent
	agent = Agent(  # disco mode will not be triggered on apple.com because the LLM won't be able to see that action available, it should work on Google.com though.
		task="""
            Go to apple.com and trigger disco mode (if dont know how to do that, then just move on).
            Then go to google.com and trigger disco mode.
            After that, go to the Google login page and Use the force, luke.
        """,
		llm=llm,
		browser_session=browser_session,
		tools=tools,
	)

	# Run the agent
	await agent.run(max_steps=10)

	# Cleanup
	await browser_session.kill()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/custom-functions/actor_use.py

```py
import asyncio
import os
import sys

from browser_use.browser.session import BrowserSession

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import ActionResult, Agent, ChatOpenAI, Tools

tools = Tools()

llm = ChatOpenAI(model='gpt-4.1-mini')


@tools.registry.action('Click on submit button')
async def click_submit_button(browser_session: BrowserSession):
	page = await browser_session.must_get_current_page()

	submit_button = await page.must_get_element_by_prompt('submit button', llm)
	await submit_button.click()

	return ActionResult(is_done=True, extracted_content='Submit button clicked!')


async def main():
	task = 'go to brower-use.com and then click on the submit button'
	agent = Agent(task=task, llm=llm, tools=tools)

	await agent.run()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/custom-functions/advanced_search.py

```py
import asyncio
import http.client
import json
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

import logging

from pydantic import BaseModel

from browser_use import ActionResult, Agent, ChatOpenAI, Tools
from browser_use.browser.profile import BrowserProfile

logger = logging.getLogger(__name__)


class Person(BaseModel):
	name: str
	email: str | None = None


class PersonList(BaseModel):
	people: list[Person]


SERP_API_KEY = os.getenv('SERPER_API_KEY')
if not SERP_API_KEY:
	raise ValueError('SERPER_API_KEY is not set')

tools = Tools(exclude_actions=['search'], output_model=PersonList)


@tools.registry.action('Search the web for a specific query. Returns a short description and links of the results.')
async def search_web(query: str):
	# do a serp search for the query
	conn = http.client.HTTPSConnection('google.serper.dev')
	payload = json.dumps({'q': query})
	headers = {'X-API-KEY': SERP_API_KEY, 'Content-Type': 'application/json'}
	conn.request('POST', '/search', payload, headers)
	res = conn.getresponse()
	data = res.read()
	serp_data = json.loads(data.decode('utf-8'))

	# exclude searchParameters and credits
	serp_data = {k: v for k, v in serp_data.items() if k not in ['searchParameters', 'credits']}

	# keep the value of the key "organic"

	organic = serp_data.get('organic', [])
	# remove the key "position"
	organic = [{k: v for k, v in d.items() if k != 'position'} for d in organic]

	# print the original data
	logger.debug(json.dumps(organic, indent=2))

	# to string
	organic_str = json.dumps(organic)

	return ActionResult(extracted_content=organic_str, include_in_memory=False, include_extracted_content_only_once=True)


names = [
	'Ruedi Aebersold',
	'Bernd Bodenmiller',
	'Eugene Demler',
	'Erich Fischer',
	'Pietro Gambardella',
	'Matthias Huss',
	'Reto Knutti',
	'Maksym Kovalenko',
	'Antonio Lanzavecchia',
	'Maria Lukatskaya',
	'Jochen Markard',
	'Javier Pérez-Ramírez',
	'Federica Sallusto',
	'Gisbert Schneider',
	'Sonia I. Seneviratne',
	'Michael Siegrist',
	'Johan Six',
	'Tanja Stadler',
	'Shinichi Sunagawa',
	'Michael Bruce Zimmermann',
]


async def main():
	task = 'use search_web with "find email address of the following ETH professor:" for each of the following persons in a list of actions. Finally return the list with name and email if provided - do always 5 at once'
	task += '\n' + '\n'.join(names)
	model = ChatOpenAI(model='gpt-4.1-mini')
	browser_profile = BrowserProfile()
	agent = Agent(task=task, llm=model, tools=tools, browser_profile=browser_profile)

	history = await agent.run()

	result = history.final_result()
	if result:
		parsed: PersonList = PersonList.model_validate_json(result)

		for person in parsed.people:
			print(f'{person.name} - {person.email}')
	else:
		print('No result')


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/custom-functions/cua.py

```py
"""
OpenAI Computer Use Assistant (CUA) Integration

This example demonstrates how to integrate OpenAI's Computer Use Assistant as a fallback
action when standard browser actions are insufficient to achieve the desired goal.
The CUA can perform complex computer interactions that might be difficult to achieve
through regular browser-use actions.
"""

import asyncio
import base64
import os
import sys
from io import BytesIO

from PIL import Image

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from browser_use import Agent, ChatOpenAI, Tools
from browser_use.agent.views import ActionResult
from browser_use.browser import BrowserSession


class OpenAICUAAction(BaseModel):
	"""Parameters for OpenAI Computer Use Assistant action."""

	description: str = Field(..., description='Description of your next goal')


async def handle_model_action(browser_session: BrowserSession, action) -> ActionResult:
	"""
	Given a computer action (e.g., click, double_click, scroll, etc.),
	execute the corresponding operation using CDP.
	"""
	action_type = action.type
	ERROR_MSG: str = 'Could not execute the CUA action.'

	if not browser_session.agent_focus_target_id:
		return ActionResult(error='No active browser session')

	# Get CDP session for the focused target using the public API
	try:
		cdp_session = await browser_session.get_or_create_cdp_session(browser_session.agent_focus_target_id, focus=False)
	except Exception as e:
		return ActionResult(error=f'Failed to get CDP session: {e}')

	try:
		match action_type:
			case 'click':
				x, y = action.x, action.y
				button = action.button
				print(f"Action: click at ({x}, {y}) with button '{button}'")
				# Not handling things like middle click, etc.
				if button != 'left' and button != 'right':
					button = 'left'

				# Use CDP to click
				await browser_session.cdp_client.send.Input.dispatchMouseEvent(
					params={
						'type': 'mousePressed',
						'x': x,
						'y': y,
						'button': button,
						'clickCount': 1,
					},
					session_id=cdp_session.session_id,
				)
				await browser_session.cdp_client.send.Input.dispatchMouseEvent(
					params={
						'type': 'mouseReleased',
						'x': x,
						'y': y,
						'button': button,
					},
					session_id=cdp_session.session_id,
				)
				msg = f'Clicked at ({x}, {y}) with button {button}'
				return ActionResult(extracted_content=msg, include_in_memory=True, long_term_memory=msg)

			case 'scroll':
				x, y = action.x, action.y
				scroll_x, scroll_y = action.scroll_x, action.scroll_y
				print(f'Action: scroll at ({x}, {y}) with offsets (scroll_x={scroll_x}, scroll_y={scroll_y})')

				# Move mouse to position first
				await browser_session.cdp_client.send.Input.dispatchMouseEvent(
					params={
						'type': 'mouseMoved',
						'x': x,
						'y': y,
					},
					session_id=cdp_session.session_id,
				)

				# Execute scroll using JavaScript
				await browser_session.cdp_client.send.Runtime.evaluate(
					params={
						'expression': f'window.scrollBy({scroll_x}, {scroll_y})',
					},
					session_id=cdp_session.session_id,
				)
				msg = f'Scrolled at ({x}, {y}) with offsets (scroll_x={scroll_x}, scroll_y={scroll_y})'
				return ActionResult(extracted_content=msg, include_in_memory=True, long_term_memory=msg)

			case 'keypress':
				keys = action.keys
				for k in keys:
					print(f"Action: keypress '{k}'")
					# A simple mapping for common keys; expand as needed.
					key_code = k
					if k.lower() == 'enter':
						key_code = 'Enter'
					elif k.lower() == 'space':
						key_code = 'Space'

					# Use CDP to send key
					await browser_session.cdp_client.send.Input.dispatchKeyEvent(
						params={
							'type': 'keyDown',
							'key': key_code,
						},
						session_id=cdp_session.session_id,
					)
					await browser_session.cdp_client.send.Input.dispatchKeyEvent(
						params={
							'type': 'keyUp',
							'key': key_code,
						},
						session_id=cdp_session.session_id,
					)
				msg = f'Pressed keys: {keys}'
				return ActionResult(extracted_content=msg, include_in_memory=True, long_term_memory=msg)

			case 'type':
				text = action.text
				print(f'Action: type text: {text}')

				# Type text character by character
				for char in text:
					await browser_session.cdp_client.send.Input.dispatchKeyEvent(
						params={
							'type': 'char',
							'text': char,
						},
						session_id=cdp_session.session_id,
					)
				msg = f'Typed text: {text}'
				return ActionResult(extracted_content=msg, include_in_memory=True, long_term_memory=msg)

			case 'wait':
				print('Action: wait')
				await asyncio.sleep(2)
				msg = 'Waited for 2 seconds'
				return ActionResult(extracted_content=msg, include_in_memory=True, long_term_memory=msg)

			case 'screenshot':
				# Nothing to do as screenshot is taken at each turn
				print('Action: screenshot')
				return ActionResult(error=ERROR_MSG)
			# Handle other actions here

			case _:
				print(f'Unrecognized action: {action}')
				return ActionResult(error=ERROR_MSG)

	except Exception as e:
		print(f'Error handling action {action}: {e}')
		return ActionResult(error=ERROR_MSG)


tools = Tools()


@tools.registry.action(
	'Use OpenAI Computer Use Assistant (CUA) as a fallback when standard browser actions cannot achieve the desired goal. This action sends a screenshot and description to OpenAI CUA and executes the returned computer use actions.',
	param_model=OpenAICUAAction,
)
async def openai_cua_fallback(params: OpenAICUAAction, browser_session: BrowserSession):
	"""
	Fallback action that uses OpenAI's Computer Use Assistant to perform complex
	computer interactions when standard browser actions are insufficient.
	"""
	print(f'🎯 CUA Action Starting - Goal: {params.description}')

	try:
		# Get browser state summary
		state = await browser_session.get_browser_state_summary()
		page_info = state.page_info
		if not page_info:
			raise Exception('Page info not found - cannot execute CUA action')

		print(f'📐 Viewport size: {page_info.viewport_width}x{page_info.viewport_height}')

		screenshot_b64 = state.screenshot
		if not screenshot_b64:
			raise Exception('Screenshot not found - cannot execute CUA action')

		print(f'📸 Screenshot captured (base64 length: {len(screenshot_b64)} chars)')

		# Debug: Check screenshot dimensions
		image = Image.open(BytesIO(base64.b64decode(screenshot_b64)))
		print(f'📏 Screenshot actual dimensions: {image.size[0]}x{image.size[1]}')

		# rescale the screenshot to the viewport size
		image = image.resize((page_info.viewport_width, page_info.viewport_height))
		# Save as PNG to bytes buffer
		buffer = BytesIO()
		image.save(buffer, format='PNG')
		buffer.seek(0)
		# Convert to base64
		screenshot_b64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
		print(f'📸 Rescaled screenshot to viewport size: {page_info.viewport_width}x{page_info.viewport_height}')

		client = AsyncOpenAI(api_key=os.getenv('OPENAI_API_KEY'))
		print('🔄 Sending request to OpenAI CUA...')

		prompt = f"""
        You will be given an action to execute and screenshot of the current screen. 
        Output one computer_call object that will achieve this goal.
        Goal: {params.description}
        """
		response = await client.responses.create(
			model='computer-use-preview',
			tools=[
				{
					'type': 'computer_use_preview',
					'display_width': page_info.viewport_width,
					'display_height': page_info.viewport_height,
					'environment': 'browser',
				}
			],
			input=[
				{
					'role': 'user',
					'content': [
						{'type': 'input_text', 'text': prompt},
						{
							'type': 'input_image',
							'detail': 'auto',
							'image_url': f'data:image/png;base64,{screenshot_b64}',
						},
					],
				}
			],
			truncation='auto',
			temperature=0.1,
		)

		print(f'📥 CUA response received: {response}')
		computer_calls = [item for item in response.output if item.type == 'computer_call']
		computer_call = computer_calls[0] if computer_calls else None
		if not computer_call:
			raise Exception('No computer calls found in CUA response')

		action = computer_call.action
		print(f'🎬 Executing CUA action: {action.type} - {action}')

		action_result = await handle_model_action(browser_session, action)
		await asyncio.sleep(0.1)

		print('✅ CUA action completed successfully')
		return action_result

	except Exception as e:
		msg = f'Error executing CUA action: {e}'
		print(f'❌ {msg}')
		return ActionResult(error=msg)


async def main():
	# Initialize the language model
	llm = ChatOpenAI(
		model='o4-mini',
		temperature=1.0,
	)

	# Create browser session
	browser_session = BrowserSession()

	# Example task that might require CUA fallback
	# This could be a complex interaction that's difficult with standard actions
	task = """
    Go to https://csreis.github.io/tests/cross-site-iframe.html
    Click on "Go cross-site, complex page" using index
    Use the OpenAI CUA fallback to click on "Tree is open..." link.
    """

	# Create agent with our custom tools that includes CUA fallback
	agent = Agent(
		task=task,
		llm=llm,
		tools=tools,
		browser_session=browser_session,
	)

	print('🚀 Starting agent with CUA fallback support...')
	print(f'Task: {task}')
	print('-' * 50)

	try:
		# Run the agent
		result = await agent.run()
		print(f'\n✅ Task completed! Result: {result}')

	except Exception as e:
		print(f'\n❌ Error running agent: {e}')

	finally:
		# Clean up browser session
		await browser_session.kill()
		print('\n🧹 Browser session closed')


if __name__ == '__main__':
	# Example of different scenarios where CUA might be useful

	print('🔧 OpenAI Computer Use Assistant (CUA) Integration Example')
	print('=' * 60)
	print()
	print("This example shows how to integrate OpenAI's CUA as a fallback action")
	print('when standard browser-use actions cannot achieve the desired goal.')
	print()
	print('CUA is particularly useful for:')
	print('• Complex mouse interactions (drag & drop, precise clicking)')
	print('• Keyboard shortcuts and key combinations')
	print('• Actions that require pixel-perfect precision')
	print("• Custom UI elements that don't respond to standard actions")
	print()
	print('Make sure you have OPENAI_API_KEY set in your environment!')
	print()

	# Check if OpenAI API key is available
	if not os.getenv('OPENAI_API_KEY'):
		print('❌ Error: OPENAI_API_KEY environment variable not set')
		print('Please set your OpenAI API key to use CUA integration')
		sys.exit(1)

	# Run the example
	asyncio.run(main())

```

---

## backend/browser-use/examples/custom-functions/file_upload.py

```py
"""
Example of implementing file upload functionality.

This shows how to upload files to file input elements on web pages.
"""

import asyncio
import logging
import os
import sys

import anyio

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import ChatOpenAI
from browser_use.agent.service import Agent, Tools
from browser_use.agent.views import ActionResult
from browser_use.browser import BrowserSession
from browser_use.browser.events import UploadFileEvent

logger = logging.getLogger(__name__)

# Initialize tools
tools = Tools()


@tools.action('Upload file to interactive element with file path')
async def upload_file(index: int, path: str, browser_session: BrowserSession, available_file_paths: list[str]):
	if path not in available_file_paths:
		return ActionResult(error=f'File path {path} is not available')

	if not os.path.exists(path):
		return ActionResult(error=f'File {path} does not exist')

	try:
		# Get the DOM element by index
		dom_element = await browser_session.get_dom_element_by_index(index)

		if dom_element is None:
			msg = f'No element found at index {index}'
			logger.info(msg)
			return ActionResult(error=msg)

		# Check if it's a file input element
		if dom_element.tag_name.lower() != 'input' or dom_element.attributes.get('type') != 'file':
			msg = f'Element at index {index} is not a file input element'
			logger.info(msg)
			return ActionResult(error=msg)

		# Dispatch the upload file event
		event = browser_session.event_bus.dispatch(UploadFileEvent(node=dom_element, file_path=path))
		await event

		msg = f'Successfully uploaded file to index {index}'
		logger.info(msg)
		return ActionResult(extracted_content=msg, include_in_memory=True)

	except Exception as e:
		msg = f'Failed to upload file to index {index}: {str(e)}'
		logger.info(msg)
		return ActionResult(error=msg)


async def main():
	"""Main function to run the example"""
	browser_session = BrowserSession()
	await browser_session.start()
	llm = ChatOpenAI(model='gpt-4.1-mini')

	# List of file paths the agent is allowed to upload
	# In a real scenario, you'd want to be very careful about what files
	# the agent can access and upload
	available_file_paths = [
		'/tmp/test_document.pdf',
		'/tmp/test_image.jpg',
	]

	# Create test files if they don't exist
	for file_path in available_file_paths:
		if not os.path.exists(file_path):
			await anyio.Path(file_path).write_text('Test file content for upload example')

	# Create the agent with file upload capability
	agent = Agent(
		task="""
            Go to https://www.w3schools.com/howto/howto_html_file_upload_button.asp and try to upload one of the available test files.
        """,
		llm=llm,
		browser_session=browser_session,
		tools=tools,
		# Pass the available file paths to the tools context
		custom_context={'available_file_paths': available_file_paths},
	)

	# Run the agent
	await agent.run(max_steps=10)

	# Cleanup
	await browser_session.kill()

	# Clean up test files
	for file_path in available_file_paths:
		if os.path.exists(file_path):
			os.remove(file_path)


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/custom-functions/notification.py

```py
import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import ActionResult, Agent, ChatOpenAI, Tools

tools = Tools()


@tools.registry.action('Done with task')
async def done(text: str):
	import yagmail  # type: ignore

	# To send emails use
	# STEP 1: go to https://support.google.com/accounts/answer/185833
	# STEP 2: Create an app password (you can't use here your normal gmail password)
	# STEP 3: Use the app password in the code below for the password
	yag = yagmail.SMTP('your_email@gmail.com', 'your_app_password')
	yag.send(
		to='recipient@example.com',
		subject='Test Email',
		contents=f'result\n: {text}',
	)

	return ActionResult(is_done=True, extracted_content='Email sent!')


async def main():
	task = 'go to brower-use.com and then done'
	model = ChatOpenAI(model='gpt-4.1-mini')
	agent = Agent(task=task, llm=model, tools=tools)

	await agent.run()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/custom-functions/onepassword_2fa.py

```py
import asyncio
import logging
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from onepassword.client import Client  # type: ignore  # pip install onepassword-sdk

from browser_use import ActionResult, Agent, ChatOpenAI, Tools

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

OP_SERVICE_ACCOUNT_TOKEN = os.getenv('OP_SERVICE_ACCOUNT_TOKEN')
OP_ITEM_ID = os.getenv('OP_ITEM_ID')  # Go to 1Password, right click on the item, click "Copy Secret Reference"


tools = Tools()


@tools.registry.action('Get 2FA code from 1Password for Google Account', domains=['*.google.com', 'google.com'])
async def get_1password_2fa() -> ActionResult:
	"""
	Custom action to retrieve 2FA/MFA code from 1Password using onepassword.client SDK.
	"""
	client = await Client.authenticate(
		# setup instructions: https://github.com/1Password/onepassword-sdk-python/#-get-started
		auth=OP_SERVICE_ACCOUNT_TOKEN,
		integration_name='Browser-Use',
		integration_version='v1.0.0',
	)

	mfa_code = await client.secrets.resolve(f'op://Private/{OP_ITEM_ID}/One-time passcode')

	return ActionResult(extracted_content=mfa_code)


async def main():
	# Example task using the 1Password 2FA action
	task = 'Go to account.google.com, enter username and password, then if prompted for 2FA code, get 2FA code from 1Password for and enter it'

	model = ChatOpenAI(model='gpt-4.1-mini')
	agent = Agent(task=task, llm=model, tools=tools)

	result = await agent.run()
	print(f'Task completed with result: {result}')


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/custom-functions/parallel_agents.py

```py
"""
Simple parallel multi-agent example.

This launches multiple agents in parallel to work on different tasks simultaneously.
No complex orchestrator - just direct parallel execution.

@file purpose: Demonstrates parallel multi-agent execution using asyncio
"""

import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import Agent
from browser_use.llm.google import ChatGoogle

# ============================================================================
# 🔧 SIMPLE CONFIGURATION - CHANGE THIS TO YOUR DESIRED TASK
# ============================================================================

MAIN_TASK = 'find age of ronaldo and messi'

# Simple test - let's start with just one person to see what happens
# MAIN_TASK = "find age of elon musk"

# ============================================================================


async def create_subtasks(main_task: str, llm) -> list[str]:
	"""
	Use LLM to break down main task into logical subtasks

	Real examples of how this works:

	Input: "what is the revenue of nvidia, microsoft, tesla"
	Output: [
	    "Find Nvidia's current revenue and financial data",
	    "Find Microsoft's current revenue and financial data",
	    "Find Tesla's current revenue and financial data"
	]

	Input: "what are ages of musk, altman, bezos, gates"
	Output: [
	    "Find Elon Musk's age and birth date",
	    "Find Sam Altman's age and birth date",
	    "Find Jeff Bezos's age and birth date",
	    "Find Bill Gates's age and birth date"
	]

	Input: "what is the population of tokyo, new york, london, paris"
	Output: [
	    "Find Tokyo's current population",
	    "Find New York's current population",
	    "Find London's current population",
	    "Find Paris's current population"
	]

	Input: "name top 10 yc companies by revenue"
	Output: [
	    "Research Y Combinator's top companies by revenue",
	    "Find revenue data for top YC companies",
	    "Compile list of top 10 YC companies by revenue"
	]
	"""

	prompt = f"""
    Break down this main task into individual, separate subtasks where each subtask focuses on ONLY ONE specific person, company, or item:
    
    Main task: {main_task}
    
    RULES:
    - Each subtask must focus on ONLY ONE person/company/item
    - Do NOT combine multiple people/companies/items in one subtask
    - Each subtask should be completely independent
    - If the main task mentions multiple items, create one subtask per item
    
    Return only the subtasks, one per line, without numbering or bullets.
    Each line should focus on exactly ONE person/company/item.
    """

	try:
		# Use the correct method for ChatGoogle
		response = await llm.ainvoke(prompt)

		# Debug: Print the response type and content
		print(f'DEBUG: Response type: {type(response)}')
		print(f'DEBUG: Response content: {response}')

		# Handle different response types - ChatGoogle returns string content
		if hasattr(response, 'content'):
			content = response.content
		elif isinstance(response, str):
			content = response
		elif hasattr(response, 'text'):
			content = response.text
		else:
			# Convert to string if it's some other type
			content = str(response)

		# Split by newlines and clean up
		subtasks = [task.strip() for task in content.strip().split('\n') if task.strip()]

		# Remove any numbering or bullets that the LLM might add
		cleaned_subtasks = []
		for task in subtasks:
			# Remove common prefixes like "1. ", "- ", "* ", etc.
			cleaned = task.lstrip('0123456789.-* ')
			if cleaned:
				cleaned_subtasks.append(cleaned)

		return cleaned_subtasks if cleaned_subtasks else simple_split_task(main_task)
	except Exception as e:
		print(f'Error creating subtasks: {e}')
		# Fallback to simple split
		return simple_split_task(main_task)


def simple_split_task(main_task: str) -> list[str]:
	"""Simple fallback: split task by common separators"""
	task_lower = main_task.lower()

	# Try to split by common separators
	if ' and ' in task_lower:
		parts = main_task.split(' and ')
		return [part.strip() for part in parts if part.strip()]
	elif ', ' in main_task:
		parts = main_task.split(', ')
		return [part.strip() for part in parts if part.strip()]
	elif ',' in main_task:
		parts = main_task.split(',')
		return [part.strip() for part in parts if part.strip()]

	# If no separators found, return the original task
	return [main_task]


async def run_single_agent(task: str, llm, agent_id: int) -> tuple[int, str]:
	"""Run a single agent and return its result"""
	print(f'🚀 Agent {agent_id} starting: {task}')
	print(f'   📝 This agent will focus ONLY on: {task}')
	print(f'   🌐 Creating isolated browser instance for agent {agent_id}')

	try:
		# Create agent with its own browser session (separate browser instance)
		import tempfile

		from browser_use.browser import BrowserSession
		from browser_use.browser.profile import BrowserProfile

		# Create a unique temp directory for this agent's browser data
		temp_dir = tempfile.mkdtemp(prefix=f'browser_agent_{agent_id}_')

		# Create browser profile with custom user data directory and single tab focus
		profile = BrowserProfile()
		profile.user_data_dir = temp_dir
		profile.headless = False  # Set to True if you want headless mode
		profile.keep_alive = False  # Don't keep browser alive after task

		# Add custom args to prevent new tabs and popups
		profile.args = [
			'--disable-popup-blocking',
			'--disable-extensions',
			'--disable-plugins',
			'--disable-images',  # Faster loading
			'--no-first-run',
			'--disable-default-apps',
			'--disable-background-timer-throttling',
			'--disable-backgrounding-occluded-windows',
			'--disable-renderer-backgrounding',
		]

		# Create a new browser session for each agent with the custom profile
		browser_session = BrowserSession(browser_profile=profile)

		# Debug: Check initial tab count
		try:
			await browser_session.start()
			initial_tabs = await browser_session._cdp_get_all_pages()
			print(f'   📊 Agent {agent_id} initial tab count: {len(initial_tabs)}')
		except Exception as e:
			print(f'   ⚠️ Could not check initial tabs for agent {agent_id}: {e}')

		# Create agent with the dedicated browser session and disable auto URL detection
		agent = Agent(task=task, llm=llm, browser_session=browser_session, preload=False)

		# Run the agent with timeout to prevent hanging
		try:
			result = await asyncio.wait_for(agent.run(), timeout=300)  # 5 minute timeout
		except TimeoutError:
			print(f'⏰ Agent {agent_id} timed out after 5 minutes')
			result = 'Task timed out'

		# Debug: Check final tab count
		try:
			final_tabs = await browser_session._cdp_get_all_pages()
			print(f'   📊 Agent {agent_id} final tab count: {len(final_tabs)}')
			for i, tab in enumerate(final_tabs):
				print(f'      Tab {i + 1}: {tab.get("url", "unknown")[:50]}...')
		except Exception as e:
			print(f'   ⚠️ Could not check final tabs for agent {agent_id}: {e}')

		# Extract clean result from the agent history
		clean_result = extract_clean_result(result)

		# Close the browser session for this agent
		try:
			await browser_session.kill()
		except Exception as e:
			print(f'⚠️ Warning: Error closing browser for agent {agent_id}: {e}')

		print(f'✅ Agent {agent_id} completed and browser closed: {task}')

		return agent_id, clean_result

	except Exception as e:
		error_msg = f'Agent {agent_id} failed: {str(e)}'
		print(f'❌ {error_msg}')
		return agent_id, error_msg


def extract_clean_result(agent_result) -> str:
	"""Extract clean result from agent history"""
	try:
		# Get the last result from the agent history
		if hasattr(agent_result, 'all_results') and agent_result.all_results:
			last_result = agent_result.all_results[-1]
			if hasattr(last_result, 'extracted_content') and last_result.extracted_content:
				return last_result.extracted_content

		# Fallback to string representation
		return str(agent_result)
	except Exception:
		return 'Result extraction failed'


async def run_parallel_agents():
	"""Run multiple agents in parallel on different tasks"""

	# Use Gemini 1.5 Flash
	llm = ChatGoogle(model='gemini-1.5-flash')

	# Main task to break down - use the simple configuration
	main_task = MAIN_TASK

	print(f'🎯 Main task: {main_task}')
	print('🧠 Creating subtasks using LLM...')

	# Create subtasks using LLM
	subtasks = await create_subtasks(main_task, llm)

	print(f'📋 Created {len(subtasks)} subtasks:')
	for i, task in enumerate(subtasks, 1):
		print(f'  {i}. {task}')

	print(f'\n🔥 Starting {len(subtasks)} agents in parallel...')
	print('🔍 Each agent will get its own browser instance with exactly ONE tab')
	print(f'📊 Expected: {len(subtasks)} browser instances, {len(subtasks)} tabs total')

	# Create tasks for parallel execution
	agent_tasks = [run_single_agent(task, llm, i + 1) for i, task in enumerate(subtasks)]

	# Run all agents in parallel using asyncio.gather
	results = await asyncio.gather(*agent_tasks)

	# Print results
	print('\n' + '=' * 60)
	print('📊 PARALLEL EXECUTION RESULTS')
	print('=' * 60)

	for agent_id, result in results:
		print(f'\n🤖 Agent {agent_id} result:')
		print(f'Task: {subtasks[agent_id - 1]}')
		print(f'Result: {result}')
		print('-' * 50)

	print(f'\n🎉 All {len(subtasks)} parallel agents completed!')


def main():
	"""Main function to run parallel agents"""
	# Check if Google API key is available
	api_key = os.getenv('GOOGLE_API_KEY')
	if not api_key:
		print('❌ Error: GOOGLE_API_KEY environment variable not set')
		print('Please set your Google API key to use parallel agents')
		print('You can set it with: export GOOGLE_API_KEY="your-key-here"')
		sys.exit(1)

	# Check if API key looks valid (Google API keys are typically 39 characters)
	if len(api_key) < 20:
		print(f'⚠️  Warning: GOOGLE_API_KEY seems too short ({len(api_key)} characters)')
		print('Google API keys are typically 39 characters long')
		print('Continuing anyway, but this might cause authentication issues...')

	print('🚀 Starting parallel multi-agent example...')
	print(f'📝 Task: {MAIN_TASK}')
	print('This will dynamically create agents based on task complexity')
	print('-' * 60)

	asyncio.run(run_parallel_agents())


if __name__ == '__main__':
	main()

```

---

## backend/browser-use/examples/custom-functions/save_to_file_hugging_face.py

```py
import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from pydantic import BaseModel

from browser_use import ChatOpenAI
from browser_use.agent.service import Agent
from browser_use.tools.service import Tools

# Initialize tools first
tools = Tools()


class Model(BaseModel):
	title: str
	url: str
	likes: int
	license: str


class Models(BaseModel):
	models: list[Model]


@tools.action('Save models', param_model=Models)
def save_models(params: Models):
	with open('models.txt', 'a') as f:
		for model in params.models:
			f.write(f'{model.title} ({model.url}): {model.likes} likes, {model.license}\n')


# video: https://preview.screen.studio/share/EtOhIk0P
async def main():
	task = 'Look up models with a license of cc-by-sa-4.0 and sort by most likes on Hugging face, save top 5 to file.'

	model = ChatOpenAI(model='gpt-4.1-mini')
	agent = Agent(task=task, llm=model, tools=tools)

	await agent.run()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/demo_mode_example.py

```py
import asyncio

from browser_use import Agent, ChatBrowserUse


async def main() -> None:
	agent = Agent(
		task='Please find the latest commit on browser-use/browser-use repo and tell me the commit message. Please summarize what it is about.',
		llm=ChatBrowserUse(),
		demo_mode=True,
	)
	await agent.run(max_steps=5)


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/features/add_image_context.py

```py
"""
Show how to use sample_images to add image context for your task
"""

import asyncio
import base64
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from browser_use import Agent
from browser_use.llm import ChatOpenAI
from browser_use.llm.messages import ContentPartImageParam, ContentPartTextParam, ImageURL

# Load environment variables
load_dotenv()


def image_to_base64(image_path: str) -> str:
	"""
	Convert image file to base64 string.

	Args:
	    image_path: Path to the image file

	Returns:
	    Base64 encoded string of the image

	Raises:
	    FileNotFoundError: If image file doesn't exist
	    IOError: If image file cannot be read
	"""
	image_file = Path(image_path)
	if not image_file.exists():
		raise FileNotFoundError(f'Image file not found: {image_path}')

	try:
		with open(image_file, 'rb') as f:
			encoded_string = base64.b64encode(f.read())
			return encoded_string.decode('utf-8')
	except OSError as e:
		raise OSError(f'Failed to read image file: {e}')


def create_sample_images() -> list[ContentPartTextParam | ContentPartImageParam]:
	"""
	Create image context for the agent.

	Returns:
	    list of content parts containing text and image data
	"""
	# Image path - replace with your actual image path
	image_path = 'sample_image.png'

	# Image context configuration
	image_context: list[dict[str, Any]] = [
		{
			'type': 'text',
			'value': (
				'The following image explains the google layout. '
				'The image highlights several buttons with red boxes, '
				'and next to them are corresponding labels in red text.\n'
				'Each label corresponds to a button as follows:\n'
				'Label 1 is the "image" button.'
			),
		},
		{'type': 'image', 'value': image_to_base64(image_path)},
	]

	# Convert to content parts
	content_parts = []
	for item in image_context:
		if item['type'] == 'text':
			content_parts.append(ContentPartTextParam(text=item['value']))
		elif item['type'] == 'image':
			content_parts.append(
				ContentPartImageParam(
					image_url=ImageURL(
						url=f'data:image/jpeg;base64,{item["value"]}',
						media_type='image/jpeg',
					),
				)
			)

	return content_parts


async def main() -> None:
	"""
	Main function to run the browser agent with image context.
	"""
	# Task configuration
	task_str = 'goto https://www.google.com/ and click image button'

	# Initialize the language model
	model = ChatOpenAI(model='gpt-4.1')

	# Create sample images for context
	try:
		sample_images = create_sample_images()
	except (FileNotFoundError, OSError) as e:
		print(f'Error loading sample images: {e}')
		print('Continuing without sample images...')
		sample_images = []

	# Initialize and run the agent
	agent = Agent(task=task_str, llm=model, sample_images=sample_images)
	await agent.run()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/features/blocked_domains.py

```py
import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import Agent, ChatOpenAI
from browser_use.browser import BrowserProfile, BrowserSession

llm = ChatOpenAI(model='gpt-4o-mini')

# Example task: Try to navigate to various sites including blocked ones
task = 'Navigate to example.com, then try to go to x.com, then facebook.com, and finally visit google.com. Tell me which sites you were able to access.'

prohibited_domains = [
	'x.com',  # Block X (formerly Twitter) - "locked the f in"
	'twitter.com',  # Block Twitter (redirects to x.com anyway)
	'facebook.com',  # Lock the F in Facebook too
	'*.meta.com',  # Block all Meta properties (wildcard pattern)
	'*.adult-site.com',  # Block all subdomains of adult sites
	'https://explicit-content.org',  # Block specific protocol/domain
	'gambling-site.net',  # Block gambling sites
]

# Note: For lists with 100+ domains, automatic optimization kicks in:
# - Converts list to set for O(1) lookup (blazingly fast!)
# - Pattern matching (*.domain) is disabled for large lists
# - Both www.example.com and example.com variants are checked automatically
# Perfect for ad blockers or large malware domain lists (e.g., 400k+ domains)

browser_session = BrowserSession(
	browser_profile=BrowserProfile(
		prohibited_domains=prohibited_domains,
		headless=False,  # Set to True to run without visible browser
		user_data_dir='~/.config/browseruse/profiles/blocked-demo',
	),
)

agent = Agent(
	task=task,
	llm=llm,
	browser_session=browser_session,
)


async def main():
	print('Demo: Blocked Domains Feature - "Lock the F in" Edition')
	print("We're literally locking the F in Facebook and X!")
	print(f'Prohibited domains: {prohibited_domains}')
	print('The agent will try to visit various sites, but blocked domains will be prevented.')
	print()

	await agent.run(max_steps=10)

	input('Press Enter to close the browser...')
	await browser_session.kill()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/features/custom_output.py

```py
"""
Show how to use custom outputs.

@dev You need to add OPENAI_API_KEY to your environment variables.
"""

import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from pydantic import BaseModel

from browser_use import Agent, ChatOpenAI


class Post(BaseModel):
	post_title: str
	post_url: str
	num_comments: int
	hours_since_post: int


class Posts(BaseModel):
	posts: list[Post]


async def main():
	task = 'Go to hackernews show hn and give me the first  5 posts'
	model = ChatOpenAI(model='gpt-4.1-mini')
	agent = Agent(task=task, llm=model, output_model_schema=Posts)

	history = await agent.run()

	result = history.final_result()
	if result:
		parsed: Posts = Posts.model_validate_json(result)

		for post in parsed.posts:
			print('\n--------------------------------')
			print(f'Title:            {post.post_title}')
			print(f'URL:              {post.post_url}')
			print(f'Comments:         {post.num_comments}')
			print(f'Hours since post: {post.hours_since_post}')
	else:
		print('No result')


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/features/custom_system_prompt.py

```py
import asyncio
import json
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()


from browser_use import Agent, ChatOpenAI

extend_system_message = (
	'REMEMBER the most important RULE: ALWAYS open first a new tab and go first to url wikipedia.com no matter the task!!!'
)

# or use override_system_message to completely override the system prompt


async def main():
	task = 'do google search to find images of Elon Musk'
	model = ChatOpenAI(model='gpt-4.1-mini')
	agent = Agent(task=task, llm=model, extend_system_message=extend_system_message)

	print(
		json.dumps(
			agent.message_manager.system_prompt.model_dump(exclude_unset=True),
			indent=4,
		)
	)

	await agent.run()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/features/download_file.py

```py
import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()


from browser_use import Agent, Browser, ChatGoogle

api_key = os.getenv('GOOGLE_API_KEY')
if not api_key:
	raise ValueError('GOOGLE_API_KEY is not set')

llm = ChatGoogle(model='gemini-2.5-flash', api_key=api_key)


browser = Browser(downloads_path='~/Downloads/tmp')


async def run_download():
	agent = Agent(
		task='Go to "https://file-examples.com/" and download the smallest doc file. then go back and get the next file.',
		llm=llm,
		browser=browser,
	)
	await agent.run(max_steps=25)


if __name__ == '__main__':
	asyncio.run(run_download())

```

---

## backend/browser-use/examples/features/follow_up_task.py

```py
from dotenv import load_dotenv

from browser_use import Agent, Browser

load_dotenv()

import asyncio


async def main():
	browser = Browser(keep_alive=True)

	await browser.start()

	agent = Agent(task='search for browser-use.', browser_session=browser)
	await agent.run(max_steps=2)
	agent.add_new_task('return the title of first result')
	await agent.run()

	await browser.kill()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/features/follow_up_tasks.py

```py
import asyncio
import os
import sys

from browser_use.browser.profile import BrowserProfile

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import Agent

profile = BrowserProfile(keep_alive=True)


task = """Go to reddit.com"""


async def main():
	agent = Agent(task=task, browser_profile=profile)
	await agent.run(max_steps=1)

	while True:
		user_response = input('\n👤 New task or "q" to quit: ')
		agent.add_new_task(f'New task: {user_response}')
		await agent.run()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/features/initial_actions.py

```py
import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import Agent, ChatOpenAI

llm = ChatOpenAI(model='gpt-4.1-mini')

initial_actions = [
	{'navigate': {'url': 'https://www.google.com', 'new_tab': True}},
	{'navigate': {'url': 'https://en.wikipedia.org/wiki/Randomness', 'new_tab': True}},
]
agent = Agent(
	task='What theories are displayed on the page?',
	initial_actions=initial_actions,
	llm=llm,
)


async def main():
	await agent.run(max_steps=10)


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/features/judge_trace.py

```py
"""
Setup:
1. Get your API key from https://cloud.browser-use.com/new-api-key
2. Set environment variable: export BROWSER_USE_API_KEY="your-key"
"""

import asyncio
import os
import sys

# Add the parent directory to the path so we can import browser_use
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import Agent
from browser_use.llm.browser_use.chat import ChatBrowserUse

# task from GAIA
task = """
If Eliud Kipchoge could maintain his record-making marathon pace indefinitely, how many thousand hours would it take him to run the distance between the Earth and the Moon its closest approach? 
Please use the minimum perigee value on the Wikipedia page for the Moon when carrying out your calculation. 
Round your result to the nearest 1000 hours and do not use any comma separators if necessary.
"""


async def main():
	llm = ChatBrowserUse(base_url='http://localhost:8080')
	agent = Agent(
		task=task,
		llm=llm,
		use_judge=True,
		judge_llm=llm,
		ground_truth='16',  # The TRUE answer is 17 but we put 16 to demonstrate judge can detect when the answer is wrong.
	)
	history = await agent.run()

	# Get the judgement result
	if history.is_judged():
		judgement = history.judgement()
		print(f'Agent history judgement: {judgement}')


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/features/large_blocklist.py

```py
"""
Example: Using large blocklists (400k+ domains) with automatic optimization

This example demonstrates:
1. Loading a real-world blocklist (HaGeZi's Pro++ with 439k+ domains)
2. Automatic conversion to set for O(1) lookup performance
3. Testing that blocked domains are actually blocked

Performance: ~0.02ms per domain check (50,000+ checks/second!)
"""

import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import Agent, ChatOpenAI
from browser_use.browser import BrowserProfile, BrowserSession

llm = ChatOpenAI(model='gpt-4.1-mini')


def load_blocklist_from_url(url: str) -> list[str]:
	"""Load and parse a blocklist from a URL.

	Args:
		url: URL to the blocklist file

	Returns:
		List of domain strings (comments and empty lines removed)
	"""
	import urllib.request

	print(f'📥 Downloading blocklist from {url}...')

	domains = []
	with urllib.request.urlopen(url) as response:
		for line in response:
			line = line.decode('utf-8').strip()
			# Skip comments and empty lines
			if line and not line.startswith('#'):
				domains.append(line)

	print(f'✅ Loaded {len(domains):,} domains')
	return domains


async def main():
	# Load HaGeZi's Pro++ blocklist (blocks ads, tracking, malware, etc.)
	# Source: https://github.com/hagezi/dns-blocklists
	blocklist_url = 'https://gitlab.com/hagezi/mirror/-/raw/main/dns-blocklists/domains/pro.plus.txt'

	print('=' * 70)
	print('🚀 Large Blocklist Demo - 439k+ Blocked Domains')
	print('=' * 70)
	print()

	# Load the blocklist
	prohibited_domains = load_blocklist_from_url(blocklist_url)

	# Sample some blocked domains to test
	test_blocked = [prohibited_domains[0], prohibited_domains[1000], prohibited_domains[-1]]
	print(f'\n📋 Sample blocked domains: {", ".join(test_blocked[:3])}')

	print(f'\n🔧 Creating browser with {len(prohibited_domains):,} blocked domains...')
	print('   (Auto-optimizing to set for O(1) lookup performance)')

	# Create browser with the blocklist
	# The list will be automatically optimized to a set for fast lookups
	browser_session = BrowserSession(
		browser_profile=BrowserProfile(
			prohibited_domains=prohibited_domains,
			headless=False,
			user_data_dir='~/.config/browseruse/profiles/blocklist-demo',
		),
	)

	# Task: Try to visit a blocked domain and a safe domain
	blocked_site = test_blocked[0]  # Will be blocked
	safe_site = 'github.com'  # Will be allowed

	task = f"""
	Try to navigate to these websites and report what happens:
	1. First, try to visit https://{blocked_site}
	2. Then, try to visit https://{safe_site}
	
	Tell me which sites you were able to access and which were blocked.
	"""

	agent = Agent(
		task=task,
		llm=llm,
		browser_session=browser_session,
	)

	print(f'\n🤖 Agent task: Try to visit {blocked_site} (blocked) and {safe_site} (allowed)')
	print('\n' + '=' * 70)

	await agent.run(max_steps=5)

	print('\n' + '=' * 70)
	print('✅ Demo complete!')
	print(f'💡 The blocklist with {len(prohibited_domains):,} domains was optimized to a set')
	print('   for instant O(1) domain checking (vs slow O(n) pattern matching)')
	print('=' * 70)

	input('\nPress Enter to close the browser...')
	await browser_session.kill()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/features/multi_tab.py

```py
"""
Simple try of the agent.

@dev You need to add OPENAI_API_KEY to your environment variables.
"""

import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import Agent, ChatOpenAI

# video: https://preview.screen.studio/share/clenCmS6
llm = ChatOpenAI(model='gpt-4.1-mini')
agent = Agent(
	task='open 3 tabs with elon musk, sam altman, and steve jobs, then go back to the first and stop',
	llm=llm,
)


async def main():
	await agent.run()


asyncio.run(main())

```

---

## backend/browser-use/examples/features/parallel_agents.py

```py
import asyncio
import os
import sys
from pathlib import Path

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import ChatOpenAI
from browser_use.agent.service import Agent
from browser_use.browser import BrowserProfile, BrowserSession

browser_session = BrowserSession(
	browser_profile=BrowserProfile(
		keep_alive=True,
		headless=False,
		record_video_dir=Path('./tmp/recordings'),
		user_data_dir='~/.config/browseruse/profiles/default',
	)
)
llm = ChatOpenAI(model='gpt-4.1-mini')


# NOTE: This is experimental - you will have multiple agents running in the same browser session
async def main():
	await browser_session.start()
	agents = [
		Agent(task=task, llm=llm, browser_session=browser_session)
		for task in [
			'Search Google for weather in Tokyo',
			'Check Reddit front page title',
			'Look up Bitcoin price on Coinbase',
			# 'Find NASA image of the day',
			# 'Check top story on CNN',
			# 'Search latest SpaceX launch date',
			# 'Look up population of Paris',
			# 'Find current time in Sydney',
			# 'Check who won last Super Bowl',
			# 'Search trending topics on Twitter',
		]
	]

	print(await asyncio.gather(*[agent.run() for agent in agents]))
	await browser_session.kill()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/features/process_agent_output.py

```py
import asyncio
import os
import sys
from pprint import pprint

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import Agent, ChatOpenAI
from browser_use.agent.views import AgentHistoryList
from browser_use.browser import BrowserProfile, BrowserSession
from browser_use.browser.profile import ViewportSize

llm = ChatOpenAI(model='gpt-4.1-mini')


async def main():
	browser_session = BrowserSession(
		browser_profile=BrowserProfile(
			headless=False,
			traces_dir='./tmp/result_processing',
			window_size=ViewportSize(width=1280, height=1000),
			user_data_dir='~/.config/browseruse/profiles/default',
		)
	)
	await browser_session.start()
	try:
		agent = Agent(
			task="go to google.com and type 'OpenAI' click search and give me the first url",
			llm=llm,
			browser_session=browser_session,
		)
		history: AgentHistoryList = await agent.run(max_steps=3)

		print('Final Result:')
		pprint(history.final_result(), indent=4)

		print('\nErrors:')
		pprint(history.errors(), indent=4)

		# e.g. xPaths the model clicked on
		print('\nModel Outputs:')
		pprint(history.model_actions(), indent=4)

		print('\nThoughts:')
		pprint(history.model_thoughts(), indent=4)
	finally:
		await browser_session.stop()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/features/rerun_history.py

```py
"""
Example: Rerunning saved agent history with variable detection and substitution

This example shows how to:
1. Run an agent and save its history (including initial URL navigation)
2. Detect variables in the saved history (emails, names, dates, etc.)
3. Rerun the history with substituted values (different data)
4. Get AI-generated summary of rerun completion (with screenshot analysis)

Useful for:
- Debugging agent behavior
- Testing changes with consistent scenarios
- Replaying successful workflows with different data
- Understanding what values can be substituted in reruns
- Getting automated verification of rerun success

Note: Initial actions (like opening URLs from tasks) are now automatically
saved to history and will be replayed during rerun, so you don't need to
worry about manually specifying URLs when rerunning.

AI Summary:
The rerun will automatically generate an AI summary at the end that analyzes
the final screenshot and execution statistics.:

	# Option 1: Use agent's LLM (default)
	results = await agent.load_and_rerun(history_file)

	# Option 2: Use a specific LLM for summary generation
	from browser_use.llm import ChatOpenAI
	summary_llm = ChatOpenAI(model='gpt-4.1-mini')
	results = await agent.load_and_rerun(history_file, summary_llm=summary_llm)

The AI summary will be the last item in results and will have:
	- extracted_content: The summary text
	- success: Whether rerun was successful
	- is_done: Always True for summary
"""

import asyncio
from pathlib import Path

from browser_use import Agent
from browser_use.llm import ChatBrowserUse


async def main():
	# Example task to demonstrate history saving and rerunning
	history_file = Path('agent_history.json')
	task = 'Go to https://browser-use.github.io/stress-tests/challenges/reference-number-form.html and fill the form with example data and submit.'
	llm = ChatBrowserUse()

	# Optional: Use a custom LLM for AI summary generation
	# Uncomment to use a custom LLM for summaries:
	# from browser_use.llm import ChatOpenAI
	# summary_llm = ChatOpenAI(model='gpt-4.1-mini')
	summary_llm = None  # Set to None to use agent's LLM (default)

	# Step 1: Run the agent and save history
	print('=== Running Agent ===')
	agent = Agent(task=task, llm=llm, max_actions_per_step=1)
	await agent.run(max_steps=10)
	agent.save_history(history_file)
	print(f'✓ History saved to {history_file}')

	# Step 2: Detect variables in the saved history
	print('\n=== Detecting Variables ===')
	variables = agent.detect_variables()
	if variables:
		print(f'Found {len(variables)} variable(s):')
		for var_name, var_info in variables.items():
			format_info = f' (format: {var_info.format})' if var_info.format else ''
			print(f'  • {var_name}: "{var_info.original_value}"{format_info}')
	else:
		print('No variables detected in history')

	# Step 3: Rerun the history with substituted values
	if variables:
		print('\n=== Rerunning History (Substituted Values) ===')
		# Create new values for the detected variables
		new_values = {}
		for var_name, var_info in variables.items():
			# Map detected variables to new values
			if var_name == 'email':
				new_values[var_name] = 'jane.smith@example.com'
			elif var_name == 'full_name':
				new_values[var_name] = 'Jane Smith'
			elif var_name.startswith('full_name_'):
				new_values[var_name] = 'General Information'
			elif var_name == 'first_name':
				new_values[var_name] = 'Jane'
			elif var_name == 'date':
				new_values[var_name] = '1995-05-15'
			elif var_name == 'country':
				new_values[var_name] = 'Canada'
			# You can add more variable substitutions as needed

		if new_values:
			print(f'Substituting {len(new_values)} variable(s):')
			for var_name, new_value in new_values.items():
				old_value = variables[var_name].original_value
				print(f'  • {var_name}: "{old_value}" → "{new_value}"')

			# Rerun with substituted values and optional custom summary LLM
			substitute_agent = Agent(task='', llm=llm)
			results = await substitute_agent.load_and_rerun(history_file, variables=new_values, summary_llm=summary_llm)

			# Display AI-generated summary (last result)
			if results and results[-1].is_done:
				summary = results[-1]
				print('\n📊 AI Summary:')
				print(f'  Summary: {summary.extracted_content}')
				print(f'  Success: {summary.success}')
			print('✓ History rerun with substituted values complete')
	else:
		print('\n⚠️  No variables detected, skipping substitution rerun')


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/features/restrict_urls.py

```py
import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import Agent, ChatOpenAI
from browser_use.browser import BrowserProfile, BrowserSession

llm = ChatOpenAI(model='gpt-4.1-mini')
task = (
	"go to google.com and search for openai.com and click on the first link then extract content and scroll down - what's there?"
)

allowed_domains = ['google.com']

browser_session = BrowserSession(
	browser_profile=BrowserProfile(
		executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		allowed_domains=allowed_domains,
		user_data_dir='~/.config/browseruse/profiles/default',
	),
)

agent = Agent(
	task=task,
	llm=llm,
	browser_session=browser_session,
)


async def main():
	await agent.run(max_steps=25)

	input('Press Enter to close the browser...')
	await browser_session.kill()


asyncio.run(main())

```

---

## backend/browser-use/examples/features/scrolling_page.py

```py
# Goal: Automates webpage scrolling with various scrolling actions, including element-specific scrolling.

import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import Agent, ChatOpenAI
from browser_use.browser import BrowserProfile, BrowserSession

if not os.getenv('OPENAI_API_KEY'):
	raise ValueError('OPENAI_API_KEY is not set')

"""
Example: Enhanced 'Scroll' action with page amounts and element-specific scrolling.

This script demonstrates the new enhanced scrolling capabilities:

1. PAGE-LEVEL SCROLLING:
   - Scrolling by specific page amounts using 'num_pages' parameter (0.5, 1.0, 2.0, etc.)
   - Scrolling up or down using the 'down' parameter
   - Uses JavaScript window.scrollBy() or smart container detection

2. ELEMENT-SPECIFIC SCROLLING:
   - NEW: Optional 'index' parameter to scroll within specific elements
   - Perfect for dropdowns, sidebars, and custom UI components
   - Uses direct scrollTop manipulation (no mouse events that might close dropdowns)
   - Automatically finds scroll containers in the element hierarchy
   - Falls back to page scrolling if no container found

3. IMPLEMENTATION DETAILS:
   - Does NOT use mouse movement or wheel events
   - Direct DOM manipulation for precision and reliability
   - Container-aware scrolling prevents unwanted side effects
"""

llm = ChatOpenAI(model='gpt-4.1-mini')

browser_profile = BrowserProfile(headless=False)
browser_session = BrowserSession(browser_profile=browser_profile)

# Example 1: Basic page scrolling with custom amounts
agent1 = Agent(
	task="Navigate to 'https://en.wikipedia.org/wiki/Internet' and scroll down by one page - then scroll up by 0.5 pages - then scroll down by 0.25 pages - then scroll down by 2 pages.",
	llm=llm,
	browser_session=browser_session,
)

# Example 2: Element-specific scrolling (dropdowns and containers)
agent2 = Agent(
	task="""Go to https://semantic-ui.com/modules/dropdown.html#/definition and:
	1. Scroll down in the left sidebar by 2 pages
	2. Then scroll down 1 page in the main content area
	3. Click on the State dropdown and scroll down 1 page INSIDE the dropdown to see more states
	4. The dropdown should stay open while scrolling inside it""",
	llm=llm,
	browser_session=browser_session,
)

# Example 3: Text-based scrolling alternative
agent3 = Agent(
	task="Navigate to 'https://en.wikipedia.org/wiki/Internet' and scroll to the text 'The vast majority of computer'",
	llm=llm,
	browser_session=browser_session,
)


async def main():
	print('Choose which scrolling example to run:')
	print('1. Basic page scrolling with custom amounts (Wikipedia)')
	print('2. Element-specific scrolling (Semantic UI dropdowns)')
	print('3. Text-based scrolling (Wikipedia)')

	choice = input('Enter choice (1-3): ').strip()

	if choice == '1':
		print('🚀 Running Example 1: Basic page scrolling...')
		await agent1.run()
	elif choice == '2':
		print('🚀 Running Example 2: Element-specific scrolling...')
		await agent2.run()
	elif choice == '3':
		print('🚀 Running Example 3: Text-based scrolling...')
		await agent3.run()
	else:
		print('❌ Invalid choice. Running Example 1 by default...')
		await agent1.run()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/features/secure.py

```py
"""
Azure OpenAI example with data privacy and high-scale configuration.

Environment Variables Required:
- AZURE_OPENAI_KEY (or AZURE_OPENAI_API_KEY)
- AZURE_OPENAI_ENDPOINT
- AZURE_OPENAI_DEPLOYMENT (optional)

DATA PRIVACY WITH AZURE OPENAI:
✅ Good News: No Training on Your Data by Default

Azure OpenAI Service already protects your data:
✅ NOT used to train OpenAI models
✅ NOT shared with other customers
✅ NOT accessible to OpenAI directly
✅ NOT used to improve Microsoft/third-party products
✅ Hosted entirely within Azure (not OpenAI's servers)

⚠️ Default Data Retention (30 Days)
- Prompts and completions stored for up to 30 days
- Purpose: Abuse monitoring and compliance
- Access: Microsoft authorized personnel (only if abuse detected)

🔒 How to Disable Data Logging Completely
Apply for Microsoft's "Limited Access Program":
1. Contact Microsoft Azure support
2. Submit Limited Access Program request
3. Demonstrate legitimate business need
4. After approval: Zero data logging, immediate deletion, no human review

For high-scale deployments (500+ agents), consider:
- Multiple deployments across regions


How to Verify This Yourself, that there is no data logging:
- Network monitoring: Run with network monitoring tools
- Firewall rules: Block all domains except Azure OpenAI and your target sites

Contact us if you need help with this: support@browser-use.com
"""

import asyncio
import os
import sys

from dotenv import load_dotenv

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

load_dotenv()


os.environ['ANONYMIZED_TELEMETRY'] = 'false'


from browser_use import Agent, BrowserProfile, ChatAzureOpenAI

# Configuration LLM
api_key = os.getenv('AZURE_OPENAI_KEY')
azure_endpoint = os.getenv('AZURE_OPENAI_ENDPOINT')
llm = ChatAzureOpenAI(model='gpt-4.1-mini', api_key=api_key, azure_endpoint=azure_endpoint)

# Configuration Task
task = 'Find the founders of the sensitive company_name'

# Configuration Browser (optional)
browser_profile = BrowserProfile(allowed_domains=['*google.com', 'browser-use.com'], enable_default_extensions=False)

# Sensitive data (optional) - {key: sensitive_information} - we filter out the sensitive_information from any input to the LLM, it will only work with placeholder.
# By default we pass screenshots to the LLM which can contain your information. Set use_vision=False to disable this.
# If you trust your LLM endpoint, you don't need to worry about this.
sensitive_data = {'company_name': 'browser-use'}


# Create Agent
agent = Agent(task=task, llm=llm, browser_profile=browser_profile, sensitive_data=sensitive_data)  # type: ignore


async def main():
	await agent.run(max_steps=10)


asyncio.run(main())

```

---

## backend/browser-use/examples/features/sensitive_data.py

```py
import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import Agent, ChatOpenAI

# Initialize the model
llm = ChatOpenAI(
	model='gpt-4.1',
	temperature=0.0,
)
# Simple case: the model will see x_name and x_password, but never the actual values.
# sensitive_data = {'x_name': 'my_x_name', 'x_password': 'my_x_password'}

# Advanced case: domain-specific credentials with reusable data
# Define a single credential set that can be reused
company_credentials: dict[str, str] = {'telephone': '9123456789', 'email': 'user@example.com', 'name': 'John Doe'}

# Map the same credentials to multiple domains for secure access control
# Type annotation to satisfy pyright
sensitive_data: dict[str, str | dict[str, str]] = {
	# 'https://example.com': company_credentials,
	# 'https://admin.example.com': company_credentials,
	# 'https://*.example-staging.com': company_credentials,
	# 'http*://test.example.com': company_credentials,
	'httpbin.org': company_credentials,
	# # You can also add domain-specific credentials
	# 'https://google.com': {'g_email': 'user@gmail.com', 'g_pass': 'google_password'}
}
# Update task to use one of the credentials above
task = 'Go to https://httpbin.org/forms/post and put the secure information in the relevant fields.'

agent = Agent(task=task, llm=llm, sensitive_data=sensitive_data)


async def main():
	await agent.run()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/features/small_model_for_extraction.py

```py
import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import Agent, ChatOpenAI

# This uses a bigger model for the planning
# And a smaller model for the page content extraction
# THink of it like a subagent which only task is to extract content from the current page
llm = ChatOpenAI(model='gpt-4.1')
small_llm = ChatOpenAI(model='gpt-4.1-mini')
task = 'Find the founders of browser-use in ycombinator, extract all links and open the links one by one'
agent = Agent(task=task, llm=llm, page_extraction_llm=small_llm)


async def main():
	await agent.run()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/features/stop_externally.py

```py
import asyncio
import os
import random
import sys

from browser_use.llm.google.chat import ChatGoogle

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import Agent

llm = ChatGoogle(model='gemini-flash-latest', temperature=1.0)


def check_is_task_stopped():
	async def _internal_check_is_task_stopped() -> bool:
		if random.random() < 0.1:
			print('[TASK STOPPER] Task is stopped')
			return True
		else:
			print('[TASK STOPPER] Task is not stopped')
			return False

	return _internal_check_is_task_stopped


task = """
Go to https://browser-use.github.io/stress-tests/challenges/wufoo-style-form.html and complete the Wufoo-style form by filling in all required fields and submitting.
"""

agent = Agent(task=task, llm=llm, flash_mode=True, register_should_stop_callback=check_is_task_stopped(), max_actions_per_step=1)


async def main():
	await agent.run(max_steps=30)


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/features/video_recording.py

```py
import asyncio
from pathlib import Path

from browser_use import Agent, Browser, ChatOpenAI

# NOTE: To use this example, install imageio[ffmpeg], e.g. with uv pip install "browser-use[video]"


async def main():
	browser_session = Browser(record_video_dir=Path('./tmp/recordings'))

	agent = Agent(
		task='Go to github.com/trending then navigate to the first trending repository and report how many commits it has.',
		llm=ChatOpenAI(model='gpt-4.1-mini'),
		browser_session=browser_session,
	)

	await agent.run(max_steps=5)

	# The video will be saved automatically when the agent finishes and the session closes.
	print('Agent run finished. Check the ./tmp/recordings directory for the video.')


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/file_system/alphabet_earnings.py

```py
import asyncio
import os
import pathlib
import shutil

from dotenv import load_dotenv

from browser_use import Agent, ChatOpenAI

load_dotenv()

SCRIPT_DIR = pathlib.Path(os.path.dirname(os.path.abspath(__file__)))
agent_dir = SCRIPT_DIR / 'alphabet_earnings'
agent_dir.mkdir(exist_ok=True)

task = """
Go to https://abc.xyz/assets/cc/27/3ada14014efbadd7a58472f1f3f4/2025q2-alphabet-earnings-release.pdf.
Read the PDF and save 3 interesting data points in "alphabet_earnings.pdf" and share it with me!
""".strip('\n')

agent = Agent(
	task=task,
	llm=ChatOpenAI(model='o4-mini'),
	file_system_path=str(agent_dir / 'fs'),
	flash_mode=True,
)


async def main():
	await agent.run()
	input(f'Press Enter to clean the file system at {agent_dir}...')
	# clean the file system
	shutil.rmtree(str(agent_dir / 'fs'))


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/file_system/excel_sheet.py

```py
import asyncio
import os
import sys

from browser_use.llm.openai.chat import ChatOpenAI

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import Agent

llm = ChatOpenAI(model='o4-mini')


task = (
	'Find current stock price of companies Meta and Amazon. Then, make me a CSV file with 2 columns: company name, stock price.'
)

agent = Agent(task=task, llm=llm)


async def main():
	import time

	start_time = time.time()
	history = await agent.run()
	# token usage
	print(history.usage)
	end_time = time.time()
	print(f'Time taken: {end_time - start_time} seconds')


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/file_system/file_system.py

```py
import asyncio
import os
import pathlib
import shutil

from dotenv import load_dotenv

from browser_use import Agent, ChatOpenAI

load_dotenv()


SCRIPT_DIR = pathlib.Path(os.path.dirname(os.path.abspath(__file__)))
agent_dir = SCRIPT_DIR / 'file_system'
agent_dir.mkdir(exist_ok=True)
conversation_dir = agent_dir / 'conversations' / 'conversation'
print(f'Agent logs directory: {agent_dir}')


task = """
Go to https://mertunsall.github.io/posts/post1.html
Save the title of the article in "data.md"
Then, use append_file to add the first sentence of the article to "data.md"
Then, read the file to see its content and make sure it's correct.
Finally, share the file with me.

NOTE: DO NOT USE extract action - everything is visible in browser state.
""".strip('\n')

llm = ChatOpenAI(model='gpt-4.1-mini')

agent = Agent(
	task=task,
	llm=llm,
	save_conversation_path=str(conversation_dir),
	file_system_path=str(agent_dir / 'fs'),
)


async def main():
	agent_history = await agent.run()
	print(f'Final result: {agent_history.final_result()}', flush=True)

	input('Press Enter to clean the file system...')
	# clean the file system
	shutil.rmtree(str(agent_dir / 'fs'))


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/getting_started/01_basic_search.py

```py
"""
Setup:
1. Get your API key from https://cloud.browser-use.com/new-api-key
2. Set environment variable: export BROWSER_USE_API_KEY="your-key"
"""

import asyncio
import os
import sys

# Add the parent directory to the path so we can import browser_use
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import Agent, ChatBrowserUse


async def main():
	llm = ChatBrowserUse()
	task = "Search Google for 'what is browser automation' and tell me the top 3 results"
	agent = Agent(task=task, llm=llm)
	await agent.run()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/getting_started/02_form_filling.py

```py
"""
Getting Started Example 2: Form Filling

This example demonstrates how to:
- Navigate to a website with forms
- Fill out input fields
- Submit forms
- Handle basic form interactions

This builds on the basic search example by showing more complex interactions.

Setup:
1. Get your API key from https://cloud.browser-use.com/new-api-key
2. Set environment variable: export BROWSER_USE_API_KEY="your-key"
"""

import asyncio
import os
import sys

# Add the parent directory to the path so we can import browser_use
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import Agent, ChatBrowserUse


async def main():
	# Initialize the model
	llm = ChatBrowserUse()

	# Define a form filling task
	task = """
    Go to https://httpbin.org/forms/post and fill out the contact form with:
    - Customer name: John Doe
    - Telephone: 555-123-4567
    - Email: john.doe@example.com
    - Size: Medium
    - Topping: cheese
    - Delivery time: now
    - Comments: This is a test form submission
    
    Then submit the form and tell me what response you get.
    """

	# Create and run the agent
	agent = Agent(task=task, llm=llm)
	await agent.run()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/getting_started/03_data_extraction.py

```py
"""
Getting Started Example 3: Data Extraction

This example demonstrates how to:
- Navigate to a website with structured data
- Extract specific information from the page
- Process and organize the extracted data
- Return structured results

This builds on previous examples by showing how to get valuable data from websites.

Setup:
1. Get your API key from https://cloud.browser-use.com/new-api-key
2. Set environment variable: export BROWSER_USE_API_KEY="your-key"
"""

import asyncio
import os
import sys

# Add the parent directory to the path so we can import browser_use
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import Agent, ChatBrowserUse


async def main():
	# Initialize the model
	llm = ChatBrowserUse()

	# Define a data extraction task
	task = """
    Go to https://quotes.toscrape.com/ and extract the following information:
    - The first 5 quotes on the page
    - The author of each quote
    - The tags associated with each quote
    
    Present the information in a clear, structured format like:
    Quote 1: "[quote text]" - Author: [author name] - Tags: [tag1, tag2, ...]
    Quote 2: "[quote text]" - Author: [author name] - Tags: [tag1, tag2, ...]
    etc.
    """

	# Create and run the agent
	agent = Agent(task=task, llm=llm)
	await agent.run()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/getting_started/04_multi_step_task.py

```py
"""
Getting Started Example 4: Multi-Step Task

This example demonstrates how to:
- Perform a complex workflow with multiple steps
- Navigate between different pages
- Combine search, form filling, and data extraction
- Handle a realistic end-to-end scenario

This is the most advanced getting started example, combining all previous concepts.

Setup:
1. Get your API key from https://cloud.browser-use.com/new-api-key
2. Set environment variable: export BROWSER_USE_API_KEY="your-key"
"""

import asyncio
import os
import sys

# Add the parent directory to the path so we can import browser_use
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import Agent, ChatBrowserUse


async def main():
	# Initialize the model
	llm = ChatBrowserUse()

	# Define a multi-step task
	task = """
    I want you to research Python web scraping libraries. Here's what I need:
    
    1. First, search Google for "best Python web scraping libraries 2024"
    2. Find a reputable article or blog post about this topic
    3. From that article, extract the top 3 recommended libraries
    4. For each library, visit its official website or GitHub page
    5. Extract key information about each library:
       - Name
       - Brief description
       - Main features or advantages
       - GitHub stars (if available)
    
    Present your findings in a summary format comparing the three libraries.
    """

	# Create and run the agent
	agent = Agent(task=task, llm=llm)
	await agent.run()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/getting_started/05_fast_agent.py

```py
import asyncio
import os
import sys

# Add the parent directory to the path so we can import browser_use
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()


from browser_use import Agent, BrowserProfile

# Speed optimization instructions for the model
SPEED_OPTIMIZATION_PROMPT = """
Speed optimization instructions:
- Be extremely concise and direct in your responses
- Get to the goal as quickly as possible
- Use multi-action sequences whenever possible to reduce steps
"""


async def main():
	# 1. Use fast LLM - Llama 4 on Groq for ultra-fast inference
	from browser_use import ChatGroq

	llm = ChatGroq(
		model='meta-llama/llama-4-maverick-17b-128e-instruct',
		temperature=0.0,
	)
	# from browser_use import ChatGoogle

	# llm = ChatGoogle(model='gemini-flash-lite-latest')

	# 2. Create speed-optimized browser profile
	browser_profile = BrowserProfile(
		minimum_wait_page_load_time=0.1,
		wait_between_actions=0.1,
		headless=False,
	)

	# 3. Define a speed-focused task
	task = """
	1. Go to reddit https://www.reddit.com/search/?q=browser+agent&type=communities 
	2. Click directly on the first 5 communities to open each in new tabs
    3. Find out what the latest post is about, and switch directly to the next tab
	4. Return the latest post summary for each page
	"""

	# 4. Create agent with all speed optimizations
	agent = Agent(
		task=task,
		llm=llm,
		flash_mode=True,  # Disables thinking in the LLM output for maximum speed
		browser_profile=browser_profile,
		extend_system_message=SPEED_OPTIMIZATION_PROMPT,
	)

	await agent.run()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/integrations/agentmail/2fa.py

```py
import asyncio
import os
import sys

from agentmail import AsyncAgentMail  # type: ignore

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from dotenv import load_dotenv

load_dotenv()

from browser_use import Agent, Browser, ChatBrowserUse
from examples.integrations.agentmail.email_tools import EmailTools

TASK = """
Go to reddit.com, create a new account (use the get_email_address), make up password and all other information, confirm the 2fa with get_latest_email, and like latest post on r/elon subreddit.
"""


async def main():
	# Create email inbox
	# Get an API key from https://agentmail.to/
	email_client = AsyncAgentMail()
	inbox = await email_client.inboxes.create()
	print(f'Your email address is: {inbox.inbox_id}\n\n')

	# Initialize the tools for browser-use agent
	tools = EmailTools(email_client=email_client, inbox=inbox)

	# Initialize the LLM for browser-use agent
	llm = ChatBrowserUse()

	# Set your local browser path
	browser = Browser(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')

	agent = Agent(task=TASK, tools=tools, llm=llm, browser=browser)

	await agent.run()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/integrations/agentmail/email_tools.py

```py
"""
Email management to enable 2fa.
"""

import asyncio
import logging

# run `pip install agentmail` to install the library
from agentmail import AsyncAgentMail, Message, MessageReceivedEvent, Subscribe  # type: ignore
from agentmail.inboxes.types.inbox import Inbox  # type: ignore
from agentmail.inboxes.types.inbox_id import InboxId  # type: ignore

from browser_use import Tools

# Configure basic logging if not already configured
if not logging.getLogger().handlers:
	logging.basicConfig(level=logging.INFO, format='%(levelname)s - %(name)s - %(message)s')

logger = logging.getLogger(__name__)


class EmailTools(Tools):
	def __init__(
		self,
		email_client: AsyncAgentMail | None = None,
		email_timeout: int = 30,
		inbox: Inbox | None = None,
	):
		super().__init__()
		self.email_client = email_client or AsyncAgentMail()

		self.email_timeout = email_timeout

		self.register_email_tools()

		self.inbox: Inbox | None = inbox

	def _serialize_message_for_llm(self, message: Message) -> str:
		"""
		Serialize a message for the LLM
		"""
		# Use text if available, otherwise convert HTML to simple text
		body_content = message.text
		if not body_content and message.html:
			body_content = self._html_to_text(message.html)

		msg = f'From: {message.from_}\nTo: {message.to}\nTimestamp: {message.timestamp.isoformat()}\nSubject: {message.subject}\nBody: {body_content}'
		return msg

	def _html_to_text(self, html: str) -> str:
		"""
		Simple HTML to text conversion
		"""
		import re

		# Remove script and style elements - handle spaces in closing tags
		html = re.sub(r'<script\b[^>]*>.*?</script\s*>', '', html, flags=re.DOTALL | re.IGNORECASE)
		html = re.sub(r'<style\b[^>]*>.*?</style\s*>', '', html, flags=re.DOTALL | re.IGNORECASE)

		# Remove HTML tags
		html = re.sub(r'<[^>]+>', '', html)

		# Decode HTML entities
		html = html.replace('&nbsp;', ' ')
		html = html.replace('&amp;', '&')
		html = html.replace('&lt;', '<')
		html = html.replace('&gt;', '>')
		html = html.replace('&quot;', '"')
		html = html.replace('&#39;', "'")

		# Clean up whitespace
		html = re.sub(r'\s+', ' ', html)
		html = html.strip()

		return html

	async def get_or_create_inbox_client(self) -> Inbox:
		"""
		Create a default inbox profile for this API key (assume that agent is on free tier)

		If you are not on free tier it is recommended to create 1 inbox per agent.
		"""
		if self.inbox:
			return self.inbox

		return await self.create_inbox_client()

	async def create_inbox_client(self) -> Inbox:
		"""
		Create a default inbox profile for this API key (assume that agent is on free tier)

		If you are not on free tier it is recommended to create 1 inbox per agent.
		"""
		inbox = await self.email_client.inboxes.create()
		self.inbox = inbox
		return inbox

	async def wait_for_message(self, inbox_id: InboxId) -> Message:
		"""
		Wait for a message to be received in the inbox
		"""
		async with self.email_client.websockets.connect() as ws:
			await ws.send_subscribe(message=Subscribe(inbox_ids=[inbox_id]))

			try:
				while True:
					data = await asyncio.wait_for(ws.recv(), timeout=self.email_timeout)
					if isinstance(data, MessageReceivedEvent):
						await self.email_client.inboxes.messages.update(
							inbox_id=inbox_id, message_id=data.message.message_id, remove_labels=['unread']
						)
						msg = data.message
						logger.info(f'Received new message from: {msg.from_} with subject: {msg.subject}')
						return msg
					# If not MessageReceived, continue waiting for the next event
			except TimeoutError:
				raise TimeoutError(f'No email received in the inbox in {self.email_timeout}s')

	def register_email_tools(self):
		"""Register all email-related controller actions"""

		@self.action('Get email address for login. You can use this email to login to any service with email and password')
		async def get_email_address() -> str:
			"""
			Get the email address of the inbox
			"""
			inbox = await self.get_or_create_inbox_client()
			logger.info(f'Email address: {inbox.inbox_id}')
			return inbox.inbox_id

		@self.action(
			'Get the latest unread email from the inbox from the last max_age_minutes (default 5 minutes). Waits some seconds for new emails if none found. Use for 2FA codes.'
		)
		async def get_latest_email(max_age_minutes: int = 5) -> str:
			"""
			1. Check for unread emails within the last max_age_minutes
			2. If no recent unread email, wait 30 seconds for new email via websocket
			"""
			from datetime import datetime, timedelta, timezone

			inbox = await self.get_or_create_inbox_client()

			# Get unread emails
			emails = await self.email_client.inboxes.messages.list(inbox_id=inbox.inbox_id, labels=['unread'])
			# Filter unread emails by time window - use UTC timezone to match email timestamps
			time_cutoff = datetime.now(timezone.utc) - timedelta(minutes=max_age_minutes)
			logger.debug(f'Time cutoff: {time_cutoff}')
			logger.info(f'Found {len(emails.messages)} unread emails for inbox {inbox.inbox_id}')
			recent_unread_emails = []

			for i, email_summary in enumerate(emails.messages):
				# Get full email details to check timestamp
				full_email = await self.email_client.inboxes.messages.get(
					inbox_id=inbox.inbox_id, message_id=email_summary.message_id
				)
				# Handle timezone comparison properly
				email_timestamp = full_email.timestamp
				if email_timestamp.tzinfo is None:
					# If email timestamp is naive, assume UTC
					email_timestamp = email_timestamp.replace(tzinfo=timezone.utc)

				if email_timestamp >= time_cutoff:
					recent_unread_emails.append(full_email)

			# If we have recent unread emails, return the latest one
			if recent_unread_emails:
				# Sort by timestamp and get the most recent
				recent_unread_emails.sort(key=lambda x: x.timestamp, reverse=True)
				logger.info(f'Found {len(recent_unread_emails)} recent unread emails for inbox {inbox.inbox_id}')

				latest_email = recent_unread_emails[0]

				# Mark as read
				await self.email_client.inboxes.messages.update(
					inbox_id=inbox.inbox_id, message_id=latest_email.message_id, remove_labels=['unread']
				)
				logger.info(f'Latest email from: {latest_email.from_} with subject: {latest_email.subject}')
				return self._serialize_message_for_llm(latest_email)
			else:
				logger.info('No recent unread emails, waiting for a new one')
			# No recent unread emails, wait for new one
			try:
				latest_message = await self.wait_for_message(inbox_id=inbox.inbox_id)
			except TimeoutError:
				return f'No email received in the inbox in {self.email_timeout}s'
			# logger.info(f'Latest message: {latest_message}')
			return self._serialize_message_for_llm(latest_message)

```

---

## backend/browser-use/examples/integrations/discord/discord_api.py

```py
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

from dotenv import load_dotenv

load_dotenv()

import discord  # type: ignore
from discord.ext import commands  # type: ignore

from browser_use.agent.service import Agent
from browser_use.browser import BrowserProfile, BrowserSession
from browser_use.llm import BaseChatModel


class DiscordBot(commands.Bot):
	"""Discord bot implementation for Browser-Use tasks.

	This bot allows users to run browser automation tasks through Discord messages.
	Processes tasks asynchronously and sends the result back to the user in response to the message.
	Messages must start with the configured prefix (default: "$bu") followed by the task description.

	Args:
	    llm (BaseChatModel): Language model instance to use for task processing
	    prefix (str, optional): Command prefix for triggering browser tasks. Defaults to "$bu"
	    ack (bool, optional): Whether to acknowledge task receipt with a message. Defaults to False
	    browser_profile (BrowserProfile, optional): Browser profile settings.
	        Defaults to headless mode

	Usage:
	    ``\`python
	    from browser_use import ChatOpenAI

	    llm = ChatOpenAI()
	    bot = DiscordBot(llm=llm, prefix='$bu', ack=True)
	    bot.run('YOUR_DISCORD_TOKEN')
	    ``\`

	Discord Usage:
	    Send messages starting with the prefix:
	    "$bu search for python tutorials"
	"""

	def __init__(
		self,
		llm: BaseChatModel,
		prefix: str = '$bu',
		ack: bool = False,
		browser_profile: BrowserProfile = BrowserProfile(headless=True),
	):
		self.llm = llm
		self.prefix = prefix.strip()
		self.ack = ack
		self.browser_profile = browser_profile

		# Define intents.
		intents = discord.Intents.default()  # type: ignore
		intents.message_content = True  # Enable message content intent
		intents.members = True  # Enable members intent for user info

		# Initialize the bot with a command prefix and intents.
		super().__init__(command_prefix='!', intents=intents)  # You may not need prefix, just here for flexibility

		# self.tree = app_commands.CommandTree(self) # Initialize command tree for slash commands.

	async def on_ready(self):
		"""Called when the bot is ready."""
		try:
			print(f'We have logged in as {self.user}')
			cmds = await self.tree.sync()  # Sync the command tree with discord

		except Exception as e:
			print(f'Error during bot startup: {e}')

	async def on_message(self, message):
		"""Called when a message is received."""
		try:
			if message.author == self.user:  # Ignore the bot's messages
				return
			if message.content.strip().startswith(f'{self.prefix} '):
				if self.ack:
					try:
						await message.reply(
							'Starting browser use task...',
							mention_author=True,  # Don't ping the user
						)
					except Exception as e:
						print(f'Error sending start message: {e}')

				try:
					agent_message = await self.run_agent(message.content.replace(f'{self.prefix} ', '').strip())
					await message.channel.send(content=f'{agent_message}', reference=message, mention_author=True)
				except Exception as e:
					await message.channel.send(
						content=f'Error during task execution: {str(e)}',
						reference=message,
						mention_author=True,
					)

		except Exception as e:
			print(f'Error in message handling: {e}')

	#    await self.process_commands(message)  # Needed to process bot commands

	async def run_agent(self, task: str) -> str:
		try:
			browser_session = BrowserSession(browser_profile=self.browser_profile)
			agent = Agent(task=(task), llm=self.llm, browser_session=browser_session)
			result = await agent.run()

			agent_message = None
			if result.is_done():
				agent_message = result.history[-1].result[0].extracted_content

			if agent_message is None:
				agent_message = 'Oops! Something went wrong while running Browser-Use.'

			return agent_message

		except Exception as e:
			raise Exception(f'Browser-use task failed: {str(e)}')

```

---

## backend/browser-use/examples/integrations/discord/discord_example.py

```py
"""
This examples requires you to have a Discord bot token and the bot already added to a server.

Five Steps to create and invite a Discord bot:

1. Create a Discord Application:
    *   Go to the Discord Developer Portal: https://discord.com/developers/applications
    *   Log in to the Discord website.
    *   Click on "New Application".
    *   Give the application a name and click "Create".
2. Configure the Bot:
    *   Navigate to the "Bot" tab on the left side of the screen.
    *   Make sure "Public Bot" is ticked if you want others to invite your bot.
	*	Generate your bot token by clicking on "Reset Token", Copy the token and save it securely.
        *   Do not share the bot token. Treat it like a password. If the token is leaked, regenerate it.
3. Enable Privileged Intents:
    *   Scroll down to the "Privileged Gateway Intents" section.
    *   Enable the necessary intents (e.g., "Server Members Intent" and "Message Content Intent").
   -->  Note: Enabling privileged intents for bots in over 100 guilds requires bot verification. You may need to contact Discord support to enable privileged intents for verified bots.
4. Generate Invite URL:
    *   Go to "OAuth2" tab and "OAuth2 URL Generator" section.
    *   Under "scopes", tick the "bot" checkbox.
    *   Tick the permissions required for your bot to function under “Bot Permissions”.
		*	e.g. "Send Messages", "Send Messages in Threads", "Read Message History",  "Mention Everyone".
    *   Copy the generated URL under the "GENERATED URL" section at the bottom.
5. Invite the Bot:
    *   Paste the URL into your browser.
    *   Choose a server to invite the bot to.
    *   Click “Authorize”.
   -->  Note: The person adding the bot needs "Manage Server" permissions.
6. Run the code below to start the bot with your bot token.
7. Write e.g. "/bu what's the weather in Tokyo?" to start a browser-use task and get a response inside the Discord channel.
"""

import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

from dotenv import load_dotenv

load_dotenv()


from browser_use.browser import BrowserProfile
from browser_use.llm import ChatGoogle
from examples.integrations.discord.discord_api import DiscordBot

# load credentials from environment variables
bot_token = os.getenv('DISCORD_BOT_TOKEN')
if not bot_token:
	raise ValueError('Discord bot token not found in .env file.')

api_key = os.getenv('GOOGLE_API_KEY')
if not api_key:
	raise ValueError('GOOGLE_API_KEY is not set')

llm = ChatGoogle(model='gemini-2.0-flash-exp', api_key=api_key)

bot = DiscordBot(
	llm=llm,  # required; instance of BaseChatModel
	prefix='$bu',  # optional; prefix of messages to trigger browser-use, defaults to "$bu"
	ack=True,  # optional; whether to acknowledge task receipt with a message, defaults to False
	browser_profile=BrowserProfile(
		headless=False
	),  # optional; useful for changing headless mode or other browser configs, defaults to headless mode
)

bot.run(
	token=bot_token,  # required; Discord bot token
)

```

---

## backend/browser-use/examples/integrations/gmail_2fa_integration.py

```py
"""
Gmail 2FA Integration Example with Grant Mechanism
This example demonstrates how to use the Gmail integration for handling 2FA codes
during web automation with a robust credential grant and re-authentication system.

Features:
- Automatic credential validation and setup
- Interactive OAuth grant flow when credentials are missing/invalid
- Fallback re-authentication mechanisms
- Clear error handling and user guidance

Setup:
1. Enable Gmail API in Google Cloud Console
2. Create OAuth 2.0 credentials and download JSON
3. Save credentials as ~/.config/browseruse/gmail_credentials.json
4. Run this example - it will guide you through OAuth setup if needed
"""

import asyncio
import json
import os
import sys

from dotenv import load_dotenv

# Add the parent directory to the path so we can import browser_use
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

load_dotenv()

from browser_use import Agent, ChatOpenAI, Tools
from browser_use.config import CONFIG
from browser_use.integrations.gmail import GmailService, register_gmail_actions


class GmailGrantManager:
	"""
	Manages Gmail OAuth credential grants and authentication flows.
	Provides a robust mechanism for setting up and maintaining Gmail API access.
	"""

	def __init__(self):
		self.config_dir = CONFIG.BROWSER_USE_CONFIG_DIR
		self.credentials_file = self.config_dir / 'gmail_credentials.json'
		self.token_file = self.config_dir / 'gmail_token.json'
		print(f'GmailGrantManager initialized with config_dir: {self.config_dir}')
		print(f'GmailGrantManager initialized with credentials_file: {self.credentials_file}')
		print(f'GmailGrantManager initialized with token_file: {self.token_file}')

	def check_credentials_exist(self) -> bool:
		"""Check if OAuth credentials file exists."""
		return self.credentials_file.exists()

	def check_token_exists(self) -> bool:
		"""Check if saved token file exists."""
		return self.token_file.exists()

	def validate_credentials_format(self) -> tuple[bool, str]:
		"""
		Validate that the credentials file has the correct format.
		Returns (is_valid, error_message)
		"""
		if not self.check_credentials_exist():
			return False, 'Credentials file not found'

		try:
			with open(self.credentials_file) as f:
				creds = json.load(f)

			# Accept if either 'web' or 'installed' section exists and is not empty
			if creds.get('web') or creds.get('installed'):
				return True, 'Credentials file is valid'
			return False, "Invalid credentials format - neither 'web' nor 'installed' sections found"

		except json.JSONDecodeError:
			return False, 'Credentials file is not valid JSON'
		except Exception as e:
			return False, f'Error reading credentials file: {e}'

	async def setup_oauth_credentials(self) -> bool:
		"""
		Guide user through OAuth credentials setup process.
		Returns True if setup is successful.
		"""
		print('\n🔐 Gmail OAuth Credentials Setup Required')
		print('=' * 50)

		if not self.check_credentials_exist():
			print('❌ Gmail credentials file not found')
		else:
			is_valid, error = self.validate_credentials_format()
			if not is_valid:
				print(f'❌ Gmail credentials file is invalid: {error}')

		print('\n📋 To set up Gmail API access:')
		print('1. Go to https://console.cloud.google.com/')
		print('2. Create a new project or select an existing one')
		print('3. Enable the Gmail API:')
		print('   - Go to "APIs & Services" > "Library"')
		print('   - Search for "Gmail API" and enable it')
		print('4. Create OAuth 2.0 credentials:')
		print('   - Go to "APIs & Services" > "Credentials"')
		print('   - Click "Create Credentials" > "OAuth client ID"')
		print('   - Choose "Desktop application"')
		print('   - Download the JSON file')
		print(f'5. Save the JSON file as: {self.credentials_file}')
		print(f'6. Ensure the directory exists: {self.config_dir}')

		# Create config directory if it doesn't exist
		self.config_dir.mkdir(parents=True, exist_ok=True)
		print(f'\n✅ Created config directory: {self.config_dir}')

		# Wait for user to set up credentials
		while True:
			user_input = input('\n❓ Have you saved the credentials file? (y/n/skip): ').lower().strip()

			if user_input == 'skip':
				print('⏭️  Skipping credential validation for now')
				return False
			elif user_input == 'y':
				if self.check_credentials_exist():
					is_valid, error = self.validate_credentials_format()
					if is_valid:
						print('✅ Credentials file found and validated!')
						return True
					else:
						print(f'❌ Credentials file is invalid: {error}')
						print('Please check the file format and try again.')
				else:
					print(f'❌ Credentials file still not found at: {self.credentials_file}')
			elif user_input == 'n':
				print('⏳ Please complete the setup steps above and try again.')
			else:
				print('Please enter y, n, or skip')

	async def test_authentication(self, gmail_service: GmailService) -> tuple[bool, str]:
		"""
		Test Gmail authentication and return status.
		Returns (success, message)
		"""
		try:
			print('🔍 Testing Gmail authentication...')
			success = await gmail_service.authenticate()

			if success and gmail_service.is_authenticated():
				print('✅ Gmail authentication successful!')
				return True, 'Authentication successful'
			else:
				return False, 'Authentication failed - invalid credentials or OAuth flow failed'

		except Exception as e:
			return False, f'Authentication error: {e}'

	async def handle_authentication_failure(self, gmail_service: GmailService, error_msg: str) -> bool:
		"""
		Handle authentication failures with fallback mechanisms.
		Returns True if recovery was successful.
		"""
		print(f'\n❌ Gmail authentication failed: {error_msg}')
		print('\n🔧 Attempting recovery...')

		# Option 1: Try removing old token file
		if self.token_file.exists():
			print('🗑️  Removing old token file to force re-authentication...')
			try:
				self.token_file.unlink()
				print('✅ Old token file removed')

				# Try authentication again
				success = await gmail_service.authenticate()
				if success:
					print('✅ Re-authentication successful!')
					return True
			except Exception as e:
				print(f'❌ Failed to remove token file: {e}')

		# Option 2: Validate and potentially re-setup credentials
		is_valid, cred_error = self.validate_credentials_format()
		if not is_valid:
			print(f'\n❌ Credentials file issue: {cred_error}')
			print('🔧 Initiating credential re-setup...')

			return await self.setup_oauth_credentials()

		# Option 3: Provide manual troubleshooting steps
		print('\n🔧 Manual troubleshooting steps:')
		print('1. Check that Gmail API is enabled in Google Cloud Console')
		print('2. Verify OAuth consent screen is configured')
		print('3. Ensure redirect URIs include http://localhost:8080')
		print('4. Check if credentials file is for the correct project')
		print('5. Try regenerating OAuth credentials in Google Cloud Console')

		retry = input('\n❓ Would you like to retry authentication? (y/n): ').lower().strip()
		if retry == 'y':
			success = await gmail_service.authenticate()
			return success

		return False


async def main():
	print('🚀 Gmail 2FA Integration Example with Grant Mechanism')
	print('=' * 60)

	# Initialize grant manager
	grant_manager = GmailGrantManager()

	# Step 1: Check and validate credentials
	print('🔍 Step 1: Validating Gmail credentials...')

	if not grant_manager.check_credentials_exist():
		print('❌ No Gmail credentials found')
		setup_success = await grant_manager.setup_oauth_credentials()
		if not setup_success:
			print('⏹️  Setup cancelled or failed. Exiting...')
			return
	else:
		is_valid, error = grant_manager.validate_credentials_format()
		if not is_valid:
			print(f'❌ Invalid credentials: {error}')
			setup_success = await grant_manager.setup_oauth_credentials()
			if not setup_success:
				print('⏹️  Setup cancelled or failed. Exiting...')
				return
		else:
			print('✅ Gmail credentials file found and validated')

	# Step 2: Initialize Gmail service and test authentication
	print('\n🔍 Step 2: Testing Gmail authentication...')

	gmail_service = GmailService()
	auth_success, auth_message = await grant_manager.test_authentication(gmail_service)

	if not auth_success:
		print(f'❌ Initial authentication failed: {auth_message}')
		recovery_success = await grant_manager.handle_authentication_failure(gmail_service, auth_message)

		if not recovery_success:
			print('❌ Failed to recover Gmail authentication. Please check your setup.')
			return

	# Step 3: Initialize tools with authenticated service
	print('\n🔍 Step 3: Registering Gmail actions...')

	tools = Tools()
	register_gmail_actions(tools, gmail_service=gmail_service)

	print('✅ Gmail actions registered with tools')
	print('Available Gmail actions:')
	print('- get_recent_emails: Get recent emails with filtering')
	print()

	# Initialize LLM
	llm = ChatOpenAI(model='gpt-4.1-mini')

	# Step 4: Test Gmail functionality
	print('🔍 Step 4: Testing Gmail email retrieval...')

	agent = Agent(task='Get recent emails from Gmail to test the integration is working properly', llm=llm, tools=tools)

	try:
		history = await agent.run()
		print('✅ Gmail email retrieval test completed')
	except Exception as e:
		print(f'❌ Gmail email retrieval test failed: {e}')
		# Try one more recovery attempt
		print('🔧 Attempting final recovery...')
		recovery_success = await grant_manager.handle_authentication_failure(gmail_service, str(e))
		if recovery_success:
			print('✅ Recovery successful, re-running test...')
			history = await agent.run()
		else:
			print('❌ Final recovery failed. Please check your Gmail API setup.')
			return

	print('\n' + '=' * 60)

	# Step 5: Demonstrate 2FA code finding
	print('🔍 Step 5: Testing 2FA code detection...')

	agent2 = Agent(
		task='Search for any 2FA verification codes or OTP codes in recent Gmail emails from the last 30 minutes',
		llm=llm,
		tools=tools,
	)

	history2 = await agent2.run()
	print('✅ 2FA code search completed')

	print('\n' + '=' * 60)

	# Step 6: Simulate complete login flow
	print('🔍 Step 6: Demonstrating complete 2FA login flow...')

	agent3 = Agent(
		task="""
		Demonstrate a complete 2FA-enabled login flow:
		1. Check for any existing 2FA codes in recent emails
		2. Explain how the agent would handle a typical login:
		   - Navigate to a login page
		   - Enter credentials
		   - Wait for 2FA prompt
		   - Use get_recent_emails to find the verification code
		   - Extract and enter the 2FA code
		3. Show what types of emails and codes can be detected
		""",
		llm=llm,
		tools=tools,
	)

	history3 = await agent3.run()
	print('✅ Complete 2FA flow demonstration completed')

	print('\n' + '=' * 60)
	print('🎉 Gmail 2FA Integration with Grant Mechanism completed successfully!')
	print('\n💡 Key features demonstrated:')
	print('- ✅ Automatic credential validation and setup')
	print('- ✅ Robust error handling and recovery mechanisms')
	print('- ✅ Interactive OAuth grant flow')
	print('- ✅ Token refresh and re-authentication')
	print('- ✅ 2FA code detection and extraction')
	print('\n🔧 Grant mechanism benefits:')
	print('- Handles missing or invalid credentials gracefully')
	print('- Provides clear setup instructions')
	print('- Automatically recovers from authentication failures')
	print('- Validates credential format before use')
	print('- Offers multiple fallback options')


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/integrations/slack/slack_api.py

```py
import logging
import os
import sys
from typing import Annotated

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from fastapi import Depends, FastAPI, HTTPException, Request
from slack_sdk.errors import SlackApiError  # type: ignore
from slack_sdk.signature import SignatureVerifier  # type: ignore
from slack_sdk.web.async_client import AsyncWebClient  # type: ignore

from browser_use.agent.service import Agent
from browser_use.browser import BrowserProfile, BrowserSession
from browser_use.llm import BaseChatModel
from browser_use.logging_config import setup_logging

setup_logging()
logger = logging.getLogger('slack')

app = FastAPI()


class SlackBot:
	def __init__(
		self,
		llm: BaseChatModel,
		bot_token: str,
		signing_secret: str,
		ack: bool = False,
		browser_profile: BrowserProfile = BrowserProfile(headless=True),
	):
		if not bot_token or not signing_secret:
			raise ValueError('Bot token and signing secret must be provided')

		self.llm = llm
		self.ack = ack
		self.browser_profile = browser_profile
		self.client = AsyncWebClient(token=bot_token)
		self.signature_verifier = SignatureVerifier(signing_secret)
		self.processed_events = set()
		logger.info('SlackBot initialized')

	async def handle_event(self, event, event_id):
		try:
			logger.info(f'Received event id: {event_id}')
			if not event_id:
				logger.warning('Event ID missing in event data')
				return

			if event_id in self.processed_events:
				logger.info(f'Event {event_id} already processed')
				return
			self.processed_events.add(event_id)

			if 'subtype' in event and event['subtype'] == 'bot_message':
				return

			text = event.get('text')
			user_id = event.get('user')
			if text and text.startswith('$bu '):
				task = text[len('$bu ') :].strip()
				if self.ack:
					try:
						await self.send_message(
							event['channel'], f'<@{user_id}> Starting browser use task...', thread_ts=event.get('ts')
						)
					except Exception as e:
						logger.error(f'Error sending start message: {e}')

				try:
					agent_message = await self.run_agent(task)
					await self.send_message(event['channel'], f'<@{user_id}> {agent_message}', thread_ts=event.get('ts'))
				except Exception as e:
					await self.send_message(event['channel'], f'Error during task execution: {str(e)}', thread_ts=event.get('ts'))
		except Exception as e:
			logger.error(f'Error in handle_event: {str(e)}')

	async def run_agent(self, task: str) -> str:
		try:
			browser_session = BrowserSession(browser_profile=self.browser_profile)
			agent = Agent(task=task, llm=self.llm, browser_session=browser_session)
			result = await agent.run()

			agent_message = None
			if result.is_done():
				agent_message = result.history[-1].result[0].extracted_content

			if agent_message is None:
				agent_message = 'Oops! Something went wrong while running Browser-Use.'

			return agent_message

		except Exception as e:
			logger.error(f'Error during task execution: {str(e)}')
			return f'Error during task execution: {str(e)}'

	async def send_message(self, channel, text, thread_ts=None):
		try:
			await self.client.chat_postMessage(channel=channel, text=text, thread_ts=thread_ts)
		except SlackApiError as e:
			logger.error(f'Error sending message: {e.response["error"]}')


@app.post('/slack/events')
async def slack_events(request: Request, slack_bot: Annotated[SlackBot, Depends()]):
	try:
		if not slack_bot.signature_verifier.is_valid_request(await request.body(), dict(request.headers)):
			logger.warning('Request verification failed')
			raise HTTPException(status_code=400, detail='Request verification failed')

		event_data = await request.json()
		logger.info(f'Received event data: {event_data}')
		if 'challenge' in event_data:
			return {'challenge': event_data['challenge']}

		if 'event' in event_data:
			try:
				await slack_bot.handle_event(event_data.get('event'), event_data.get('event_id'))
			except Exception as e:
				logger.error(f'Error handling event: {str(e)}')

		return {}
	except Exception as e:
		logger.error(f'Error in slack_events: {str(e)}')
		raise HTTPException(status_code=500, detail='Internal Server Error')

```

---

## backend/browser-use/examples/integrations/slack/slack_example.py

```py
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()


from browser_use.browser import BrowserProfile
from browser_use.llm import ChatGoogle
from examples.integrations.slack.slack_api import SlackBot, app

# load credentials from environment variables
bot_token = os.getenv('SLACK_BOT_TOKEN')
if not bot_token:
	raise ValueError('Slack bot token not found in .env file.')

signing_secret = os.getenv('SLACK_SIGNING_SECRET')
if not signing_secret:
	raise ValueError('Slack signing secret not found in .env file.')

api_key = os.getenv('GOOGLE_API_KEY')
if not api_key:
	raise ValueError('GOOGLE_API_KEY is not set')

llm = ChatGoogle(model='gemini-2.0-flash-exp', api_key=api_key)

slack_bot = SlackBot(
	llm=llm,  # required; instance of BaseChatModel
	bot_token=bot_token,  # required; Slack bot token
	signing_secret=signing_secret,  # required; Slack signing secret
	ack=True,  # optional; whether to acknowledge task receipt with a message, defaults to False
	browser_profile=BrowserProfile(
		headless=True
	),  # optional; useful for changing headless mode or other browser configs, defaults to headless mode
)

app.dependency_overrides[SlackBot] = lambda: slack_bot

if __name__ == '__main__':
	import uvicorn

	uvicorn.run('integrations.slack.slack_api:app', host='0.0.0.0', port=3000)

```

---

## backend/browser-use/examples/models/aws.py

```py
"""
AWS Bedrock Examples

This file demonstrates how to use AWS Bedrock models with browser-use.
We provide two classes:
1. ChatAnthropicBedrock - Convenience class for Anthropic Claude models
2. ChatAWSBedrock - General AWS Bedrock client supporting all providers

Requirements:
- AWS credentials configured via environment variables
- boto3 installed: pip install boto3
- Access to AWS Bedrock models in your region
"""

import asyncio

from browser_use import Agent
from browser_use.llm import ChatAnthropicBedrock, ChatAWSBedrock


async def example_anthropic_bedrock():
	"""Example using ChatAnthropicBedrock - convenience class for Claude models."""
	print('🔹 ChatAnthropicBedrock Example')

	# Initialize with Anthropic Claude via AWS Bedrock
	llm = ChatAnthropicBedrock(
		model='us.anthropic.claude-sonnet-4-20250514-v1:0',
		aws_region='us-east-1',
		temperature=0.7,
	)

	print(f'Model: {llm.name}')
	print(f'Provider: {llm.provider}')

	# Create agent
	agent = Agent(
		task="Navigate to google.com and search for 'AWS Bedrock pricing'",
		llm=llm,
	)

	print("Task: Navigate to google.com and search for 'AWS Bedrock pricing'")

	# Run the agent
	result = await agent.run(max_steps=2)
	print(f'Result: {result}')


async def example_aws_bedrock():
	"""Example using ChatAWSBedrock - general client for any Bedrock model."""
	print('\n🔹 ChatAWSBedrock Example')

	# Initialize with any AWS Bedrock model (using Meta Llama as example)
	llm = ChatAWSBedrock(
		model='us.meta.llama4-maverick-17b-instruct-v1:0',
		aws_region='us-east-1',
		temperature=0.5,
	)

	print(f'Model: {llm.name}')
	print(f'Provider: {llm.provider}')

	# Create agent
	agent = Agent(
		task='Go to github.com and find the most popular Python repository',
		llm=llm,
	)

	print('Task: Go to github.com and find the most popular Python repository')

	# Run the agent
	result = await agent.run(max_steps=2)
	print(f'Result: {result}')


async def main():
	"""Run AWS Bedrock examples."""
	print('🚀 AWS Bedrock Examples')
	print('=' * 40)

	print('Make sure you have AWS credentials configured:')
	print('export AWS_ACCESS_KEY_ID=your_key')
	print('export AWS_SECRET_ACCESS_KEY=your_secret')
	print('export AWS_DEFAULT_REGION=us-east-1')
	print('=' * 40)

	try:
		# Run both examples
		await example_aws_bedrock()
		await example_anthropic_bedrock()

	except Exception as e:
		print(f'❌ Error: {e}')
		print('Make sure you have:')
		print('- Valid AWS credentials configured')
		print('- Access to AWS Bedrock in your region')
		print('- boto3 installed: pip install boto3')


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/models/azure_openai.py

```py
"""
Simple try of the agent.

@dev You need to add AZURE_OPENAI_KEY and AZURE_OPENAI_ENDPOINT to your environment variables.
"""

import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()


from browser_use import Agent
from browser_use.llm import ChatAzureOpenAI

# Make sure your deployment exists, double check the region and model name
api_key = os.getenv('AZURE_OPENAI_KEY')
azure_endpoint = os.getenv('AZURE_OPENAI_ENDPOINT')
llm = ChatAzureOpenAI(
	model='gpt-4.1-mini',
	api_key=api_key,
	azure_endpoint=azure_endpoint,
)

TASK = """
Go to google.com/travel/flights and find the cheapest flight from New York to Paris on 2025-10-15
"""

agent = Agent(
	task=TASK,
	llm=llm,
)


async def main():
	await agent.run(max_steps=10)


asyncio.run(main())

```

---

## backend/browser-use/examples/models/browser_use_llm.py

```py
"""
Example of the fastest + smartest LLM for browser automation.

Setup:
1. Get your API key from https://cloud.browser-use.com/new-api-key
2. Set environment variable: export BROWSER_USE_API_KEY="your-key"
"""

import asyncio
import os

from dotenv import load_dotenv

from browser_use import Agent, ChatBrowserUse

load_dotenv()

if not os.getenv('BROWSER_USE_API_KEY'):
	raise ValueError('BROWSER_USE_API_KEY is not set')


async def main():
	agent = Agent(
		task='Find the number of stars of the browser-use repo',
		llm=ChatBrowserUse(),
	)

	# Run the agent
	await agent.run()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/models/cerebras_example.py

```py
"""
Example of using Cerebras with browser-use.

To use this example:
1. Set your CEREBRAS_API_KEY environment variable
2. Run this script

Cerebras integration is working great for:
- Direct text generation
- Simple tasks without complex structured output
- Fast inference for web automation

Available Cerebras models (9 total):
Small/Fast models (8B-32B):
- cerebras_llama3_1_8b (8B parameters, fast)
- cerebras_llama_4_scout_17b_16e_instruct (17B, instruction-tuned)
- cerebras_llama_4_maverick_17b_128e_instruct (17B, extended context)
- cerebras_qwen_3_32b (32B parameters)

Large/Capable models (70B-480B):
- cerebras_llama3_3_70b (70B parameters, latest version)
- cerebras_gpt_oss_120b (120B parameters, OpenAI's model)
- cerebras_qwen_3_235b_a22b_instruct_2507 (235B, instruction-tuned)
- cerebras_qwen_3_235b_a22b_thinking_2507 (235B, complex reasoning)
- cerebras_qwen_3_coder_480b (480B, code generation)

Note: Cerebras has some limitations with complex structured output due to JSON schema compatibility.
"""

import asyncio
import os

from browser_use import Agent


async def main():
	# Set your API key (recommended to use environment variable)
	api_key = os.getenv('CEREBRAS_API_KEY')
	if not api_key:
		raise ValueError('Please set CEREBRAS_API_KEY environment variable')

	# Option 1: Use the pre-configured model instance (recommended)
	from browser_use import llm

	# Choose your model:
	# Small/Fast models:
	# model = llm.cerebras_llama3_1_8b      # 8B, fast
	# model = llm.cerebras_llama_4_scout_17b_16e_instruct  # 17B, instruction-tuned
	# model = llm.cerebras_llama_4_maverick_17b_128e_instruct  # 17B, extended context
	# model = llm.cerebras_qwen_3_32b       # 32B

	# Large/Capable models:
	# model = llm.cerebras_llama3_3_70b     # 70B, latest
	# model = llm.cerebras_gpt_oss_120b      # 120B, OpenAI's model
	# model = llm.cerebras_qwen_3_235b_a22b_instruct_2507  # 235B, instruction-tuned
	model = llm.cerebras_qwen_3_235b_a22b_thinking_2507  # 235B, complex reasoning
	# model = llm.cerebras_qwen_3_coder_480b  # 480B, code generation

	# Option 2: Create the model instance directly
	# model = ChatCerebras(
	#     model="qwen-3-coder-480b",  # or any other model ID
	#     api_key=os.getenv("CEREBRAS_API_KEY"),
	#     temperature=0.2,
	#     max_tokens=4096,
	# )

	# Create and run the agent with a simple task
	task = 'Explain the concept of quantum entanglement in simple terms.'
	agent = Agent(task=task, llm=model)

	print(f'Running task with Cerebras {model.name} (ID: {model.model}): {task}')
	history = await agent.run(max_steps=3)
	result = history.final_result()

	print(f'Result: {result}')


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/models/claude-4-sonnet.py

```py
"""
Simple script that runs the task of opening amazon and searching.
@dev Ensure we have a `ANTHROPIC_API_KEY` variable in our `.env` file.
"""

import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import Agent
from browser_use.llm import ChatAnthropic

llm = ChatAnthropic(model='claude-sonnet-4-0', temperature=0.0)

agent = Agent(
	task='Go to amazon.com, search for laptop, sort by best rating, and give me the price of the first result',
	llm=llm,
)


async def main():
	await agent.run(max_steps=10)


asyncio.run(main())

```

---

## backend/browser-use/examples/models/deepseek-chat.py

```py
import asyncio
import os

from browser_use import Agent
from browser_use.llm import ChatDeepSeek

# Add your custom instructions
extend_system_message = """
Remember the most important rules: 
1. When performing a search task, open https://www.google.com/ first for search. 
2. Final output.
"""
deepseek_api_key = os.getenv('DEEPSEEK_API_KEY')
if deepseek_api_key is None:
	print('Make sure you have DEEPSEEK_API_KEY:')
	print('export DEEPSEEK_API_KEY=your_key')
	exit(0)


async def main():
	llm = ChatDeepSeek(
		base_url='https://api.deepseek.com/v1',
		model='deepseek-chat',
		api_key=deepseek_api_key,
	)

	agent = Agent(
		task='What should we pay attention to in the recent new rules on tariffs in China-US trade?',
		llm=llm,
		use_vision=False,
		extend_system_message=extend_system_message,
	)
	await agent.run()


asyncio.run(main())

```

---

## backend/browser-use/examples/models/gemini-3.py

```py
import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

from browser_use import Agent, ChatGoogle

load_dotenv()

api_key = os.getenv('GOOGLE_API_KEY')
if not api_key:
	raise ValueError('GOOGLE_API_KEY is not set')


async def run_search():
	llm = ChatGoogle(model='gemini-3-pro-preview', api_key=api_key)

	agent = Agent(
		llm=llm,
		task='How many stars does the browser-use repo have?',
		flash_mode=True,
	)

	await agent.run()


if __name__ == '__main__':
	asyncio.run(run_search())

```

---

## backend/browser-use/examples/models/gemini.py

```py
import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

from browser_use import Agent, ChatGoogle

load_dotenv()

api_key = os.getenv('GOOGLE_API_KEY')
if not api_key:
	raise ValueError('GOOGLE_API_KEY is not set')


async def run_search():
	llm = ChatGoogle(model='gemini-flash-latest', api_key=api_key)
	agent = Agent(
		llm=llm,
		task='How many stars does the browser-use repo have?',
		flash_mode=True,
	)

	await agent.run()


if __name__ == '__main__':
	asyncio.run(run_search())

```

---

## backend/browser-use/examples/models/gpt-4.1.py

```py
"""
Simple try of the agent.

@dev You need to add OPENAI_API_KEY to your environment variables.
"""

import asyncio

from dotenv import load_dotenv

from browser_use import Agent, ChatOpenAI

load_dotenv()

# All the models are type safe from OpenAI in case you need a list of supported models
llm = ChatOpenAI(model='gpt-4.1-mini')
agent = Agent(
	task='Go to amazon.com, click on the first link, and give me the title of the page',
	llm=llm,
)


async def main():
	await agent.run(max_steps=10)
	input('Press Enter to continue...')


asyncio.run(main())

```

---

## backend/browser-use/examples/models/gpt-5-mini.py

```py
"""
Simple try of the agent.

@dev You need to add OPENAI_API_KEY to your environment variables.
"""

import asyncio

from dotenv import load_dotenv

from browser_use import Agent, ChatOpenAI

load_dotenv()

# All the models are type safe from OpenAI in case you need a list of supported models
llm = ChatOpenAI(model='gpt-5-mini')
agent = Agent(
	llm=llm,
	task='Find out which one is cooler: the monkey park or a dolphin tour in Tenerife?',
)


async def main():
	await agent.run(max_steps=20)
	input('Press Enter to continue...')


asyncio.run(main())

```

---

## backend/browser-use/examples/models/langchain/__init__.py

```py

```

---

## backend/browser-use/examples/models/langchain/chat.py

```py
from dataclasses import dataclass
from typing import TYPE_CHECKING, TypeVar, overload

from pydantic import BaseModel

from browser_use.llm.base import BaseChatModel
from browser_use.llm.exceptions import ModelProviderError
from browser_use.llm.messages import BaseMessage
from browser_use.llm.views import ChatInvokeCompletion, ChatInvokeUsage
from examples.models.langchain.serializer import LangChainMessageSerializer

if TYPE_CHECKING:
	from langchain_core.language_models.chat_models import BaseChatModel as LangChainBaseChatModel  # type: ignore
	from langchain_core.messages import AIMessage as LangChainAIMessage  # type: ignore

T = TypeVar('T', bound=BaseModel)


@dataclass
class ChatLangchain(BaseChatModel):
	"""
	A wrapper around LangChain BaseChatModel that implements the browser-use BaseChatModel protocol.

	This class allows you to use any LangChain-compatible model with browser-use.
	"""

	# The LangChain model to wrap
	chat: 'LangChainBaseChatModel'

	@property
	def model(self) -> str:
		return self.name

	@property
	def provider(self) -> str:
		"""Return the provider name based on the LangChain model class."""
		model_class_name = self.chat.__class__.__name__.lower()
		if 'openai' in model_class_name:
			return 'openai'
		elif 'anthropic' in model_class_name or 'claude' in model_class_name:
			return 'anthropic'
		elif 'google' in model_class_name or 'gemini' in model_class_name:
			return 'google'
		elif 'groq' in model_class_name:
			return 'groq'
		elif 'ollama' in model_class_name:
			return 'ollama'
		elif 'deepseek' in model_class_name:
			return 'deepseek'
		else:
			return 'langchain'

	@property
	def name(self) -> str:
		"""Return the model name."""
		# Try to get model name from the LangChain model using getattr to avoid type errors
		model_name = getattr(self.chat, 'model_name', None)
		if model_name:
			return str(model_name)

		model_attr = getattr(self.chat, 'model', None)
		if model_attr:
			return str(model_attr)

		return self.chat.__class__.__name__

	def _get_usage(self, response: 'LangChainAIMessage') -> ChatInvokeUsage | None:
		usage = response.usage_metadata
		if usage is None:
			return None

		prompt_tokens = usage['input_tokens'] or 0
		completion_tokens = usage['output_tokens'] or 0
		total_tokens = usage['total_tokens'] or 0

		input_token_details = usage.get('input_token_details', None)

		if input_token_details is not None:
			prompt_cached_tokens = input_token_details.get('cache_read', None)
			prompt_cache_creation_tokens = input_token_details.get('cache_creation', None)
		else:
			prompt_cached_tokens = None
			prompt_cache_creation_tokens = None

		return ChatInvokeUsage(
			prompt_tokens=prompt_tokens,
			prompt_cached_tokens=prompt_cached_tokens,
			prompt_cache_creation_tokens=prompt_cache_creation_tokens,
			prompt_image_tokens=None,
			completion_tokens=completion_tokens,
			total_tokens=total_tokens,
		)

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: None = None) -> ChatInvokeCompletion[str]: ...

	@overload
	async def ainvoke(self, messages: list[BaseMessage], output_format: type[T]) -> ChatInvokeCompletion[T]: ...

	async def ainvoke(
		self, messages: list[BaseMessage], output_format: type[T] | None = None
	) -> ChatInvokeCompletion[T] | ChatInvokeCompletion[str]:
		"""
		Invoke the LangChain model with the given messages.

		Args:
			messages: List of browser-use chat messages
			output_format: Optional Pydantic model class for structured output (not supported in basic LangChain integration)

		Returns:
			Either a string response or an instance of output_format
		"""

		# Convert browser-use messages to LangChain messages
		langchain_messages = LangChainMessageSerializer.serialize_messages(messages)

		try:
			if output_format is None:
				# Return string response
				response = await self.chat.ainvoke(langchain_messages)  # type: ignore

				# Import at runtime for isinstance check
				from langchain_core.messages import AIMessage as LangChainAIMessage  # type: ignore

				if not isinstance(response, LangChainAIMessage):
					raise ModelProviderError(
						message=f'Response is not an AIMessage: {type(response)}',
						model=self.name,
					)

				# Extract content from LangChain response
				content = response.content if hasattr(response, 'content') else str(response)

				usage = self._get_usage(response)
				return ChatInvokeCompletion(
					completion=str(content),
					usage=usage,
				)

			else:
				# Use LangChain's structured output capability
				try:
					structured_chat = self.chat.with_structured_output(output_format)
					parsed_object = await structured_chat.ainvoke(langchain_messages)

					# For structured output, usage metadata is typically not available
					# in the parsed object since it's a Pydantic model, not an AIMessage
					usage = None

					# Type cast since LangChain's with_structured_output returns the correct type
					return ChatInvokeCompletion(
						completion=parsed_object,  # type: ignore
						usage=usage,
					)
				except AttributeError:
					# Fall back to manual parsing if with_structured_output is not available
					response = await self.chat.ainvoke(langchain_messages)  # type: ignore

					if not isinstance(response, 'LangChainAIMessage'):
						raise ModelProviderError(
							message=f'Response is not an AIMessage: {type(response)}',
							model=self.name,
						)

					content = response.content if hasattr(response, 'content') else str(response)

					try:
						if isinstance(content, str):
							import json

							parsed_data = json.loads(content)
							if isinstance(parsed_data, dict):
								parsed_object = output_format(**parsed_data)
							else:
								raise ValueError('Parsed JSON is not a dictionary')
						else:
							raise ValueError('Content is not a string and structured output not supported')
					except Exception as e:
						raise ModelProviderError(
							message=f'Failed to parse response as {output_format.__name__}: {e}',
							model=self.name,
						) from e

					usage = self._get_usage(response)
					return ChatInvokeCompletion(
						completion=parsed_object,
						usage=usage,
					)

		except Exception as e:
			# Convert any LangChain errors to browser-use ModelProviderError
			raise ModelProviderError(
				message=f'LangChain model error: {str(e)}',
				model=self.name,
			) from e

```

---

## backend/browser-use/examples/models/langchain/example.py

```py
"""
Example of using LangChain models with browser-use.

This example demonstrates how to:
1. Wrap a LangChain model with ChatLangchain
2. Use it with a browser-use Agent
3. Run a simple web automation task

@file purpose: Example usage of LangChain integration with browser-use
"""

import asyncio

from langchain_openai import ChatOpenAI  # pyright: ignore

from browser_use import Agent
from examples.models.langchain.chat import ChatLangchain


async def main():
	"""Basic example using ChatLangchain with OpenAI through LangChain."""

	# Create a LangChain model (OpenAI)
	langchain_model = ChatOpenAI(
		model='gpt-4.1-mini',
		temperature=0.1,
	)

	# Wrap it with ChatLangchain to make it compatible with browser-use
	llm = ChatLangchain(chat=langchain_model)

	# Create a simple task
	task = "Go to google.com and search for 'browser automation with Python'"

	# Create and run the agent
	agent = Agent(
		task=task,
		llm=llm,
	)

	print(f'🚀 Starting task: {task}')
	print(f'🤖 Using model: {llm.name} (provider: {llm.provider})')

	# Run the agent
	history = await agent.run()

	print(f'✅ Task completed! Steps taken: {len(history.history)}')

	# Print the final result if available
	if history.final_result():
		print(f'📋 Final result: {history.final_result()}')

		return history


if __name__ == '__main__':
	print('🌐 Browser-use LangChain Integration Example')
	print('=' * 45)

	asyncio.run(main())

```

---

## backend/browser-use/examples/models/langchain/serializer.py

```py
import json
from typing import overload

from langchain_core.messages import (  # pyright: ignore
	AIMessage,
	HumanMessage,
	SystemMessage,
)
from langchain_core.messages import (  # pyright: ignore
	ToolCall as LangChainToolCall,
)
from langchain_core.messages.base import BaseMessage as LangChainBaseMessage  # pyright: ignore

from browser_use.llm.messages import (
	AssistantMessage,
	BaseMessage,
	ContentPartImageParam,
	ContentPartRefusalParam,
	ContentPartTextParam,
	ToolCall,
	UserMessage,
)
from browser_use.llm.messages import (
	SystemMessage as BrowserUseSystemMessage,
)


class LangChainMessageSerializer:
	"""Serializer for converting between browser-use message types and LangChain message types."""

	@staticmethod
	def _serialize_user_content(
		content: str | list[ContentPartTextParam | ContentPartImageParam],
	) -> str | list[str | dict]:
		"""Convert user message content for LangChain compatibility."""
		if isinstance(content, str):
			return content

		serialized_parts = []
		for part in content:
			if part.type == 'text':
				serialized_parts.append(
					{
						'type': 'text',
						'text': part.text,
					}
				)
			elif part.type == 'image_url':
				# LangChain format for images
				serialized_parts.append(
					{'type': 'image_url', 'image_url': {'url': part.image_url.url, 'detail': part.image_url.detail}}
				)

		return serialized_parts

	@staticmethod
	def _serialize_system_content(
		content: str | list[ContentPartTextParam],
	) -> str:
		"""Convert system message content to text string for LangChain compatibility."""
		if isinstance(content, str):
			return content

		text_parts = []
		for part in content:
			if part.type == 'text':
				text_parts.append(part.text)

		return '\n'.join(text_parts)

	@staticmethod
	def _serialize_assistant_content(
		content: str | list[ContentPartTextParam | ContentPartRefusalParam] | None,
	) -> str:
		"""Convert assistant message content to text string for LangChain compatibility."""
		if content is None:
			return ''
		if isinstance(content, str):
			return content

		text_parts = []
		for part in content:
			if part.type == 'text':
				text_parts.append(part.text)
			# elif part.type == 'refusal':
			# 	# Include refusal content as text
			# 	text_parts.append(f'[Refusal: {part.refusal}]')

		return '\n'.join(text_parts)

	@staticmethod
	def _serialize_tool_call(tool_call: ToolCall) -> LangChainToolCall:
		"""Convert browser-use ToolCall to LangChain ToolCall."""
		# Parse the arguments string to a dict for LangChain
		try:
			args_dict = json.loads(tool_call.function.arguments)
		except json.JSONDecodeError:
			# If parsing fails, wrap in a dict
			args_dict = {'arguments': tool_call.function.arguments}

		return LangChainToolCall(
			name=tool_call.function.name,
			args=args_dict,
			id=tool_call.id,
		)

	# region - Serialize overloads
	@overload
	@staticmethod
	def serialize(message: UserMessage) -> HumanMessage: ...

	@overload
	@staticmethod
	def serialize(message: BrowserUseSystemMessage) -> SystemMessage: ...

	@overload
	@staticmethod
	def serialize(message: AssistantMessage) -> AIMessage: ...

	@staticmethod
	def serialize(message: BaseMessage) -> LangChainBaseMessage:
		"""Serialize a browser-use message to a LangChain message."""

		if isinstance(message, UserMessage):
			content = LangChainMessageSerializer._serialize_user_content(message.content)
			return HumanMessage(content=content, name=message.name)

		elif isinstance(message, BrowserUseSystemMessage):
			content = LangChainMessageSerializer._serialize_system_content(message.content)
			return SystemMessage(content=content, name=message.name)

		elif isinstance(message, AssistantMessage):
			# Handle content
			content = LangChainMessageSerializer._serialize_assistant_content(message.content)

			# For simplicity, we'll ignore tool calls in LangChain integration
			# as requested by the user
			return AIMessage(
				content=content,
				name=message.name,
			)

		else:
			raise ValueError(f'Unknown message type: {type(message)}')

	@staticmethod
	def serialize_messages(messages: list[BaseMessage]) -> list[LangChainBaseMessage]:
		"""Serialize a list of browser-use messages to LangChain messages."""
		return [LangChainMessageSerializer.serialize(m) for m in messages]

```

---

## backend/browser-use/examples/models/lazy_import.py

```py
from browser_use import Agent, models

# available providers for this import style: openai, azure, google
agent = Agent(task='Find founders of browser-use', llm=models.azure_gpt_4_1_mini)

agent.run_sync()

```

---

## backend/browser-use/examples/models/llama4-groq.py

```py
import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv()


from browser_use import Agent
from browser_use.llm import ChatGroq

groq_api_key = os.environ.get('GROQ_API_KEY')
llm = ChatGroq(
	model='meta-llama/llama-4-maverick-17b-128e-instruct',
	# temperature=0.1,
)

# llm = ChatGroq(
# 	model='meta-llama/llama-4-maverick-17b-128e-instruct',
# 	api_key=os.environ.get('GROQ_API_KEY'),
# 	temperature=0.0,
# )

task = 'Go to amazon.com, search for laptop, sort by best rating, and give me the price of the first result'


async def main():
	agent = Agent(
		task=task,
		llm=llm,
	)
	await agent.run()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/models/modelscope_example.py

```py
"""
Simple try of the agent.

@dev You need to add MODELSCOPE_API_KEY to your environment variables.
"""

import asyncio
import os

from dotenv import load_dotenv

from browser_use import Agent, ChatOpenAI

# dotenv
load_dotenv()

api_key = os.getenv('MODELSCOPE_API_KEY', '')
if not api_key:
	raise ValueError('MODELSCOPE_API_KEY is not set')


async def run_search():
	agent = Agent(
		# task=('go to amazon.com, search for laptop'),
		task=('go to google, search for modelscope'),
		llm=ChatOpenAI(base_url='https://api-inference.modelscope.cn/v1/', model='Qwen/Qwen2.5-VL-72B-Instruct', api_key=api_key),
		use_vision=False,
	)

	await agent.run()


if __name__ == '__main__':
	asyncio.run(run_search())

```

---

## backend/browser-use/examples/models/moonshot.py

```py
import asyncio
import os

from dotenv import load_dotenv

from browser_use import Agent, ChatOpenAI

load_dotenv()

# Get API key from environment variable
api_key = os.getenv('MOONSHOT_API_KEY')
if api_key is None:
	print('Make sure you have MOONSHOT_API_KEY set in your .env file')
	print('Get your API key from https://platform.moonshot.ai/console/api-keys ')
	exit(1)

# Configure Moonshot AI model
llm = ChatOpenAI(
	model='kimi-k2-thinking',
	base_url='https://api.moonshot.ai/v1',
	api_key=api_key,
	add_schema_to_system_prompt=True,
	remove_min_items_from_schema=True,  # Moonshot doesn't support minItems in JSON schema
	remove_defaults_from_schema=True,  # Moonshot doesn't allow default values with anyOf
)


async def main():
	agent = Agent(
		task='Search for the latest news about AI and summarize the top 3 articles',
		llm=llm,
		flash_mode=True,
	)
	await agent.run()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/models/novita.py

```py
"""
Simple try of the agent.

@dev You need to add NOVITA_API_KEY to your environment variables.
"""

import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()


from browser_use import Agent, ChatOpenAI

api_key = os.getenv('NOVITA_API_KEY', '')
if not api_key:
	raise ValueError('NOVITA_API_KEY is not set')


async def run_search():
	agent = Agent(
		task=(
			'1. Go to https://www.reddit.com/r/LocalLLaMA '
			"2. Search for 'browser use' in the search bar"
			'3. Click on first result'
			'4. Return the first comment'
		),
		llm=ChatOpenAI(
			base_url='https://api.novita.ai/v3/openai',
			model='deepseek/deepseek-v3-0324',
			api_key=api_key,
		),
		use_vision=False,
	)

	await agent.run()


if __name__ == '__main__':
	asyncio.run(run_search())

```

---

## backend/browser-use/examples/models/oci_models.py

```py
"""
Oracle Cloud Infrastructure (OCI) Raw API Example

This example demonstrates how to use OCI's Generative AI service with browser-use
using the raw API integration (ChatOCIRaw) without Langchain dependencies.

@dev You need to:
1. Set up OCI configuration file at ~/.oci/config
2. Have access to OCI Generative AI models in your tenancy
3. Install the OCI Python SDK: uv add oci

Requirements:
- OCI account with Generative AI service access
- Proper OCI configuration and authentication
- Model deployment in your OCI compartment
"""

import asyncio
import os
import sys

from pydantic import BaseModel

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from browser_use import Agent
from browser_use.llm import ChatOCIRaw


class SearchSummary(BaseModel):
	query: str
	results_found: int
	top_result_title: str
	summary: str
	relevance_score: float


# Configuration examples for different providers
compartment_id = 'ocid1.tenancy.oc1..aaaaaaaayeiis5uk2nuubznrekd6xsm56k3m4i7tyvkxmr2ftojqfkpx2ura'
endpoint = 'https://inference.generativeai.us-chicago-1.oci.oraclecloud.com'

# Example 1: Meta Llama model (uses GenericChatRequest)
meta_model_id = 'ocid1.generativeaimodel.oc1.us-chicago-1.amaaaaaask7dceyarojgfh6msa452vziycwfymle5gxdvpwwxzara53topmq'


meta_llm = ChatOCIRaw(
	model_id=meta_model_id,
	service_endpoint=endpoint,
	compartment_id=compartment_id,
	provider='meta',  # Meta Llama model
	temperature=0.7,
	max_tokens=800,
	frequency_penalty=0.0,
	presence_penalty=0.0,
	top_p=0.9,
	auth_type='API_KEY',
	auth_profile='DEFAULT',
)
cohere_model_id = 'ocid1.generativeaimodel.oc1.us-chicago-1.amaaaaaask7dceyanrlpnq5ybfu5hnzarg7jomak3q6kyhkzjsl4qj24fyoq'

# Example 2: Cohere model (uses CohereChatRequest)
# cohere_model_id = "ocid1.generativeaimodel.oc1.us-chicago-1.amaaaaaask7dceyapnibwg42qjhwaxrlqfpreueirtwghiwvv2whsnwmnlva"
cohere_llm = ChatOCIRaw(
	model_id=cohere_model_id,
	service_endpoint=endpoint,
	compartment_id=compartment_id,
	provider='cohere',  # Cohere model
	temperature=1.0,
	max_tokens=600,
	frequency_penalty=0.0,
	top_p=0.75,
	top_k=0,  # Cohere-specific parameter
	auth_type='API_KEY',
	auth_profile='DEFAULT',
)

# Example 3: xAI model (uses GenericChatRequest)
xai_model_id = 'ocid1.generativeaimodel.oc1.us-chicago-1.amaaaaaask7dceya3bsfz4ogiuv3yc7gcnlry7gi3zzx6tnikg6jltqszm2q'
xai_llm = ChatOCIRaw(
	model_id=xai_model_id,
	service_endpoint=endpoint,
	compartment_id=compartment_id,
	provider='xai',  # xAI model
	temperature=1.0,
	max_tokens=20000,
	top_p=1.0,
	top_k=0,
	auth_type='API_KEY',
	auth_profile='DEFAULT',
)

# Use Meta model by default for this example
llm = xai_llm


async def basic_example():
	"""Basic example using ChatOCIRaw with a simple task."""
	print('🔹 Basic ChatOCIRaw Example')
	print('=' * 40)

	print(f'Model: {llm.name}')
	print(f'Provider: {llm.provider_name}')

	# Create agent with a simple task
	agent = Agent(
		task="Go to google.com and search for 'Oracle Cloud Infrastructure pricing'",
		llm=llm,
	)

	print("Task: Go to google.com and search for 'Oracle Cloud Infrastructure pricing'")

	# Run the agent
	try:
		result = await agent.run(max_steps=5)
		print('✅ Task completed successfully!')
		print(f'Final result: {result}')
	except Exception as e:
		print(f'❌ Error: {e}')


async def structured_output_example():
	"""Example demonstrating structured output with Pydantic models."""
	print('\n🔹 Structured Output Example')
	print('=' * 40)

	# Create agent that will return structured data
	agent = Agent(
		task="""Go to github.com, search for 'browser automation python', 
                find the most popular repository, and return structured information about it""",
		llm=llm,
		output_format=SearchSummary,  # This will enforce structured output
	)

	print('Task: Search GitHub for browser automation and return structured data')

	try:
		result = await agent.run(max_steps=5)

		if isinstance(result, SearchSummary):
			print('✅ Structured output received!')
			print(f'Query: {result.query}')
			print(f'Results Found: {result.results_found}')
			print(f'Top Result: {result.top_result_title}')
			print(f'Summary: {result.summary}')
			print(f'Relevance Score: {result.relevance_score}')
		else:
			print(f'Result: {result}')

	except Exception as e:
		print(f'❌ Error: {e}')


async def advanced_configuration_example():
	"""Example showing advanced configuration options."""
	print('\n🔹 Advanced Configuration Example')
	print('=' * 40)

	print(f'Model: {llm.name}')
	print(f'Provider: {llm.provider_name}')
	print('Configuration: Cohere model with instance principal auth')

	# Create agent with a more complex task
	agent = Agent(
		task="""Navigate to stackoverflow.com, search for questions about 'python web scraping' and tap search help, 
                analyze the top 3 questions, and provide a detailed summary of common challenges""",
		llm=llm,
	)

	print('Task: Analyze StackOverflow questions about Python web scraping')

	try:
		result = await agent.run(max_steps=8)
		print('✅ Advanced task completed!')
		print(f'Analysis result: {result}')
	except Exception as e:
		print(f'❌ Error: {e}')


async def provider_compatibility_test():
	"""Test different provider formats to verify compatibility."""
	print('\n🔹 Provider Compatibility Test')
	print('=' * 40)

	providers_to_test = [('Meta', meta_llm), ('Cohere', cohere_llm), ('xAI', xai_llm)]

	for provider_name, model in providers_to_test:
		print(f'\nTesting {provider_name} model...')
		print(f'Model ID: {model.model_id}')
		print(f'Provider: {model.provider}')
		print(f'Uses Cohere format: {model._uses_cohere_format()}')

		# Create a simple agent to test the model
		agent = Agent(
			task='Go to google.com and tell me what you see',
			llm=model,
		)

		try:
			result = await agent.run(max_steps=3)
			print(f'✅ {provider_name} model works correctly!')
			print(f'Result: {str(result)[:100]}...')
		except Exception as e:
			print(f'❌ {provider_name} model failed: {e}')


async def main():
	"""Run all OCI Raw examples."""
	print('🚀 Oracle Cloud Infrastructure (OCI) Raw API Examples')
	print('=' * 60)

	print('\n📋 Prerequisites:')
	print('1. OCI account with Generative AI service access')
	print('2. OCI configuration file at ~/.oci/config')
	print('3. Model deployed in your OCI compartment')
	print('4. Proper IAM permissions for Generative AI')
	print('5. OCI Python SDK installed: uv add oci')
	print('=' * 60)

	print('\n⚙️ Configuration Notes:')
	print('• Update model_id, service_endpoint, and compartment_id with your values')
	print('• Supported providers: "meta", "cohere", "xai"')
	print('• Auth types: "API_KEY", "INSTANCE_PRINCIPAL", "RESOURCE_PRINCIPAL"')
	print('• Default OCI config profile: "DEFAULT"')
	print('=' * 60)

	print('\n🔧 Provider-Specific API Formats:')
	print('• Meta/xAI models: Use GenericChatRequest with messages array')
	print('• Cohere models: Use CohereChatRequest with single message string')
	print('• The integration automatically detects and uses the correct format')
	print('=' * 60)

	try:
		# Run all examples
		await basic_example()
		await structured_output_example()
		await advanced_configuration_example()
		# await provider_compatibility_test()

		print('\n🎉 All examples completed successfully!')

	except Exception as e:
		print(f'\n❌ Example failed: {e}')
		print('\n🔧 Troubleshooting:')
		print('• Verify OCI configuration: oci setup config')
		print('• Check model OCID and availability')
		print('• Ensure compartment access and IAM permissions')
		print('• Verify service endpoint URL')
		print('• Check OCI Python SDK installation')
		print("• Ensure you're using the correct provider name in ChatOCIRaw")


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/models/ollama.py

```py
# 1. Install Ollama: https://github.com/ollama/ollama
# 2. Run `ollama serve` to start the server
# 3. In a new terminal, install the model you want to use: `ollama pull llama3.1:8b` (this has 4.9GB)


from browser_use import Agent, ChatOllama

llm = ChatOllama(model='llama3.1:8b')

Agent('find the founders of browser-use', llm=llm).run_sync()

```

---

## backend/browser-use/examples/models/openrouter.py

```py
"""
Simple try of the agent.

@dev You need to add OPENAI_API_KEY to your environment variables.
"""

import asyncio
import os

from dotenv import load_dotenv

from browser_use import Agent, ChatOpenAI

load_dotenv()

# All the models are type safe from OpenAI in case you need a list of supported models
llm = ChatOpenAI(
	# model='x-ai/grok-4',
	model='deepcogito/cogito-v2.1-671b',
	base_url='https://openrouter.ai/api/v1',
	api_key=os.getenv('OPENROUTER_API_KEY'),
)
agent = Agent(
	task='Find the number of stars of the browser-use repo',
	llm=llm,
	use_vision=False,
)


async def main():
	await agent.run(max_steps=10)


asyncio.run(main())

```

---

## backend/browser-use/examples/models/qwen.py

```py
import os

from dotenv import load_dotenv

from browser_use import Agent, ChatOpenAI

load_dotenv()
import asyncio

# get an api key from https://modelstudio.console.alibabacloud.com/?tab=playground#/api-key
api_key = os.getenv('ALIBABA_CLOUD')
base_url = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'

# so far we only had success with qwen-vl-max
# other models, even qwen-max, do not return the right output format. They confuse the action schema.
# E.g. they return actions: [{"navigate": "google.com"}] instead of [{"navigate": {"url": "google.com"}}]
# If you want to use smaller models and you see they mix up the action schema, add concrete examples to your prompt of the right format.
llm = ChatOpenAI(model='qwen-vl-max', api_key=api_key, base_url=base_url)


async def main():
	agent = Agent(task='go find the founders of browser-use', llm=llm, use_vision=True, max_actions_per_step=1)
	await agent.run()


if '__main__' == __name__:
	asyncio.run(main())

```

---

## backend/browser-use/examples/models/vercel_ai_gateway.py

```py
"""
Example using Vercel AI Gateway with browser-use.

Vercel AI Gateway provides an OpenAI-compatible API endpoint that can proxy
requests to various AI providers. This allows you to use Vercel's infrastructure
for rate limiting, caching, and monitoring.

Prerequisites:
1. Set VERCEL_API_KEY in your environment variables

To see all available models, visit: https://ai-gateway.vercel.sh/v1/models
"""

import asyncio
import os

from dotenv import load_dotenv

from browser_use import Agent, ChatVercel

load_dotenv()

api_key = os.getenv('VERCEL_API_KEY')
if not api_key:
	raise ValueError('VERCEL_API_KEY is not set')

llm = ChatVercel(
	model='openai/gpt-4o',
	api_key=api_key,
)

agent = Agent(
	task='Go to example.com and summarize the main content',
	llm=llm,
)


async def main():
	await agent.run(max_steps=10)


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/observability/openLLMetry.py

```py
import asyncio
import os

from dotenv import load_dotenv

# test if traceloop is installed
try:
	from traceloop.sdk import Traceloop  # type: ignore
except ImportError:
	print('Traceloop is not installed')
	exit(1)

from browser_use import Agent

load_dotenv()
api_key = os.getenv('TRACELOOP_API_KEY')
Traceloop.init(api_key=api_key, disable_batch=True)


async def main():
	await Agent('Find the founders of browser-use').run()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/sandbox/example.py

```py
"""Example of using sandbox execution with Browser-Use Agent

This example demonstrates how to use the @sandbox decorator to run
browser automation tasks with the Agent in a sandbox environment.

To run this example:
1. Set your BROWSER_USE_API_KEY environment variable
2. Set your LLM API key (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)
3. Run: python examples/sandbox_execution.py
"""

import asyncio
import os

from browser_use import Browser, ChatBrowserUse, sandbox
from browser_use.agent.service import Agent


# Example with event callbacks to monitor execution
def on_browser_ready(data):
	"""Callback when browser session is created"""
	print('\n🌐 Browser session created!')
	print(f'   Session ID: {data.session_id}')
	print(f'   Live view: {data.live_url}')
	print('   Click the link above to watch the AI agent work!\n')


@sandbox(
	log_level='INFO',
	on_browser_created=on_browser_ready,
	# server_url='http://localhost:8080/sandbox-stream',
	# cloud_profile_id='21182245-590f-4712-8888-9611651a024c',
	# cloud_proxy_country_code='us',
	# cloud_timeout=60,
)
async def pydantic_example(browser: Browser):
	agent = Agent(
		"""go and check my ip address and the location. return the result in json format""",
		browser=browser,
		llm=ChatBrowserUse(),
	)
	res = await agent.run()

	return res.final_result()


async def main():
	"""Run examples"""
	# Check if API keys are set
	if not os.getenv('BROWSER_USE_API_KEY'):
		print('❌ Please set BROWSER_USE_API_KEY environment variable')
		return

	print('\n\n=== Search with AI Agent (with live browser view) ===')

	search_result = await pydantic_example()

	print('\nResults:')
	print(search_result)


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/simple.py

```py
"""
Setup:
1. Get your API key from https://cloud.browser-use.com/new-api-key
2. Set environment variable: export BROWSER_USE_API_KEY="your-key"
"""

from dotenv import load_dotenv

from browser_use import Agent, ChatBrowserUse

load_dotenv()

agent = Agent(
	task='Find the number of stars of the following repos: browser-use, playwright, stagehand, react, nextjs',
	llm=ChatBrowserUse(),
)
agent.run_sync()

```

---

## backend/browser-use/examples/ui/command_line.py

```py
"""
To Use It:

Example 1: Using OpenAI (default), with default task: 'go to reddit and search for posts about browser-use'
python command_line.py

Example 2: Using OpenAI with a Custom Query
python command_line.py --query "go to google and search for browser-use"

Example 3: Using Anthropic's Claude Model with a Custom Query
python command_line.py --query "find latest Python tutorials on Medium" --provider anthropic

"""

import argparse
import asyncio
import os
import sys

# Ensure local repository (browser_use) is accessible
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import Agent
from browser_use.browser import BrowserSession
from browser_use.tools.service import Tools


def get_llm(provider: str):
	if provider == 'anthropic':
		from browser_use.llm import ChatAnthropic

		api_key = os.getenv('ANTHROPIC_API_KEY')
		if not api_key:
			raise ValueError('Error: ANTHROPIC_API_KEY is not set. Please provide a valid API key.')

		return ChatAnthropic(model='claude-3-5-sonnet-20240620', temperature=0.0)
	elif provider == 'openai':
		from browser_use import ChatOpenAI

		api_key = os.getenv('OPENAI_API_KEY')
		if not api_key:
			raise ValueError('Error: OPENAI_API_KEY is not set. Please provide a valid API key.')

		return ChatOpenAI(model='gpt-4.1', temperature=0.0)

	else:
		raise ValueError(f'Unsupported provider: {provider}')


def parse_arguments():
	"""Parse command-line arguments."""
	parser = argparse.ArgumentParser(description='Automate browser tasks using an LLM agent.')
	parser.add_argument(
		'--query', type=str, help='The query to process', default='go to reddit and search for posts about browser-use'
	)
	parser.add_argument(
		'--provider',
		type=str,
		choices=['openai', 'anthropic'],
		default='openai',
		help='The model provider to use (default: openai)',
	)
	return parser.parse_args()


def initialize_agent(query: str, provider: str):
	"""Initialize the browser agent with the given query and provider."""
	llm = get_llm(provider)
	tools = Tools()
	browser_session = BrowserSession()

	return Agent(
		task=query,
		llm=llm,
		tools=tools,
		browser_session=browser_session,
		use_vision=True,
		max_actions_per_step=1,
	), browser_session


async def main():
	"""Main async function to run the agent."""
	args = parse_arguments()
	agent, browser_session = initialize_agent(args.query, args.provider)

	await agent.run(max_steps=25)

	input('Press Enter to close the browser...')
	await browser_session.kill()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/ui/gradio_demo.py

```py
# pyright: reportMissingImports=false
import asyncio
import os
import sys
from dataclasses import dataclass

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

# Third-party imports
import gradio as gr  # type: ignore
from rich.console import Console
from rich.panel import Panel
from rich.text import Text

# Local module imports
from browser_use import Agent, ChatOpenAI


@dataclass
class ActionResult:
	is_done: bool
	extracted_content: str | None
	error: str | None
	include_in_memory: bool


@dataclass
class AgentHistoryList:
	all_results: list[ActionResult]
	all_model_outputs: list[dict]


def parse_agent_history(history_str: str) -> None:
	console = Console()

	# Split the content into sections based on ActionResult entries
	sections = history_str.split('ActionResult(')

	for i, section in enumerate(sections[1:], 1):  # Skip first empty section
		# Extract relevant information
		content = ''
		if 'extracted_content=' in section:
			content = section.split('extracted_content=')[1].split(',')[0].strip("'")

		if content:
			header = Text(f'Step {i}', style='bold blue')
			panel = Panel(content, title=header, border_style='blue')
			console.print(panel)
			console.print()

	return None


async def run_browser_task(
	task: str,
	api_key: str,
	model: str = 'gpt-4.1',
	headless: bool = True,
) -> str:
	if not api_key.strip():
		return 'Please provide an API key'

	os.environ['OPENAI_API_KEY'] = api_key

	try:
		agent = Agent(
			task=task,
			llm=ChatOpenAI(model='gpt-4.1-mini'),
		)
		result = await agent.run()
		#  TODO: The result could be parsed better
		return str(result)
	except Exception as e:
		return f'Error: {str(e)}'


def create_ui():
	with gr.Blocks(title='Browser Use GUI') as interface:
		gr.Markdown('# Browser Use Task Automation')

		with gr.Row():
			with gr.Column():
				api_key = gr.Textbox(label='OpenAI API Key', placeholder='sk-...', type='password')
				task = gr.Textbox(
					label='Task Description',
					placeholder='E.g., Find flights from New York to London for next week',
					lines=3,
				)
				model = gr.Dropdown(choices=['gpt-4.1-mini', 'gpt-5', 'o3', 'gpt-5-mini'], label='Model', value='gpt-4.1-mini')
				headless = gr.Checkbox(label='Run Headless', value=False)
				submit_btn = gr.Button('Run Task')

			with gr.Column():
				output = gr.Textbox(label='Output', lines=10, interactive=False)

		submit_btn.click(
			fn=lambda *args: asyncio.run(run_browser_task(*args)),
			inputs=[task, api_key, model, headless],
			outputs=output,
		)

	return interface


if __name__ == '__main__':
	demo = create_ui()
	demo.launch()

```

---

## backend/browser-use/examples/ui/streamlit_demo.py

```py
"""
To use it, you'll need to install streamlit, and run with:

python -m streamlit run streamlit_demo.py

"""

import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

import streamlit as st  # type: ignore

from browser_use import Agent
from browser_use.browser import BrowserSession
from browser_use.tools.service import Tools

if os.name == 'nt':
	asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())


# Function to get the LLM based on provider
def get_llm(provider: str):
	if provider == 'anthropic':
		from browser_use.llm import ChatAnthropic

		api_key = os.getenv('ANTHROPIC_API_KEY')
		if not api_key:
			st.error('Error: ANTHROPIC_API_KEY is not set. Please provide a valid API key.')
			st.stop()

		return ChatAnthropic(model='claude-3-5-sonnet-20240620', temperature=0.0)
	elif provider == 'openai':
		from browser_use import ChatOpenAI

		api_key = os.getenv('OPENAI_API_KEY')
		if not api_key:
			st.error('Error: OPENAI_API_KEY is not set. Please provide a valid API key.')
			st.stop()

		return ChatOpenAI(model='gpt-4.1', temperature=0.0)
	else:
		st.error(f'Unsupported provider: {provider}')
		st.stop()
		return None  # Never reached, but helps with type checking


# Function to initialize the agent
def initialize_agent(query: str, provider: str):
	llm = get_llm(provider)
	tools = Tools()
	browser_session = BrowserSession()

	return Agent(
		task=query,
		llm=llm,  # type: ignore
		tools=tools,
		browser_session=browser_session,
		use_vision=True,
		max_actions_per_step=1,
	), browser_session


# Streamlit UI
st.title('Automated Browser Agent with LLMs 🤖')

query = st.text_input('Enter your query:', 'go to reddit and search for posts about browser-use')
provider = st.radio('Select LLM Provider:', ['openai', 'anthropic'], index=0)

if st.button('Run Agent'):
	st.write('Initializing agent...')
	agent, browser_session = initialize_agent(query, provider)

	async def run_agent():
		with st.spinner('Running automation...'):
			await agent.run(max_steps=25)
		st.success('Task completed! 🎉')

	asyncio.run(run_agent())

	st.button('Close Browser', on_click=lambda: asyncio.run(browser_session.kill()))

```

---

## backend/browser-use/examples/use-cases/apply_to_job.py

```py
import argparse
import asyncio
import json
import os

from dotenv import load_dotenv

from browser_use import Agent, Browser, ChatOpenAI, Tools
from browser_use.tools.views import UploadFileAction

load_dotenv()


async def apply_to_rochester_regional_health(info: dict, resume_path: str):
	"""
	json format:
	{
	    "first_name": "John",
	    "last_name": "Doe",
	    "email": "john.doe@example.com",
	    "phone": "555-555-5555",
	    "age": "21",
	    "US_citizen": boolean,
	    "sponsorship_needed": boolean,

	    "resume": "Link to resume",
	    "postal_code": "12345",
	    "country": "USA",
	    "city": "Rochester",
	    "address": "123 Main St",

	    "gender": "Male",
	    "race": "Asian",
	    "Veteran_status": "Not a veteran",
	    "disability_status": "No disability"
	}
	"""

	llm = ChatOpenAI(model='o3')

	tools = Tools()

	@tools.action(description='Upload resume file')
	async def upload_resume(browser_session):
		params = UploadFileAction(path=resume_path, index=0)
		return 'Ready to upload resume'

	browser = Browser(cross_origin_iframes=True)

	task = f"""
    - Your goal is to fill out and submit a job application form with the provided information.
    - Navigate to https://apply.appcast.io/jobs/50590620606/applyboard/apply/
    - Scroll through the entire application and use extract_structured_data action to extract all the relevant information needed to fill out the job application form. use this information and return a structured output that can be used to fill out the entire form: {info}. Use the done action to finish the task. Fill out the job application form with the following information.
        - Before completing every step, refer to this information for accuracy. It is structured in a way to help you fill out the form and is the source of truth.
    - Follow these instructions carefully:
        - if anything pops up that blocks the form, close it out and continue filling out the form.
        - Do not skip any fields, even if they are optional. If you do not have the information, make your best guess based on the information provided.
        Fill out the form from top to bottom, never skip a field to come back to it later. When filling out a field, only focus on one field per step. For each of these steps, scroll to the related text. These are the steps:
            1) use input_text action to fill out the following:
                - "First name"
                - "Last name"
                - "Email"
                - "Phone number"
            2) use the upload_file_to_element action to fill out the following:
                - Resume upload field
            3) use input_text action to fill out the following:
                - "Postal code"
                - "Country"
                - "State"
                - "City"
                - "Address"
                - "Age"
            4) use click action to select the following options:
                - "Are you legally authorized to work in the country for which you are applying?"
                - "Will you now or in the future require sponsorship for employment visa status (e.g., H-1B visa status, etc.) to work legally for Rochester Regional Health?"
                - "Do you have, or are you in the process of obtaining, a professional license?"
                    - SELECT NO FOR THIS FIELD
            5) use input_text action to fill out the following:
                - "What drew you to healthcare?"
            6) use click action to select the following options:
                - "How many years of experience do you have in a related role?"
                - "Gender"
                - "Race"
                - "Hispanic/Latino"
                - "Veteran status"
                - "Disability status"
            7) use input_text action to fill out the following:
                - "Today's date"
            8) CLICK THE SUBMIT BUTTON AND CHECK FOR A SUCCESS SCREEN. Once there is a success screen, complete your end task of writing final_result and outputting it.
    - Before you start, create a step-by-step plan to complete the entire task. Make sure to delegate a step for each field to be filled out.
    *** IMPORTANT ***: 
        - You are not done until you have filled out every field of the form.
        - When you have completed the entire form, press the submit button to submit the application and use the done action once you have confirmed that the application is submitted
        - PLACE AN EMPHASIS ON STEP 4, the click action. That section should be filled out.
        - At the end of the task, structure your final_result as 1) a human-readable summary of all detections and actions performed on the page with 2) a list with all questions encountered in the page. Do not say "see above." Include a fully written out, human-readable summary at the very end.
    """

	available_file_paths = [resume_path]

	agent = Agent(
		task=task,
		llm=llm,
		browser=browser,
		tools=tools,
		available_file_paths=available_file_paths,
	)

	history = await agent.run()

	return history.final_result()


async def main(test_data_path: str, resume_path: str):
	# Verify files exist
	if not os.path.exists(test_data_path):
		raise FileNotFoundError(f'Test data file not found at: {test_data_path}')
	if not os.path.exists(resume_path):
		raise FileNotFoundError(f'Resume file not found at: {resume_path}')

	with open(test_data_path) as f:  # noqa: ASYNC230
		mock_info = json.load(f)

	results = await apply_to_rochester_regional_health(mock_info, resume_path=resume_path)
	print('Search Results:', results)


if __name__ == '__main__':
	parser = argparse.ArgumentParser(description='Apply to Rochester Regional Health job')
	parser.add_argument('--test-data', required=True, help='Path to test data JSON file')
	parser.add_argument('--resume', required=True, help='Path to resume PDF file')

	args = parser.parse_args()

	asyncio.run(main(args.test_data, args.resume))

```

---

## backend/browser-use/examples/use-cases/buy_groceries.py

```py
import asyncio

from pydantic import BaseModel, Field

from browser_use import Agent, Browser, ChatBrowserUse


class GroceryItem(BaseModel):
	"""A single grocery item"""

	name: str = Field(..., description='Item name')
	price: float = Field(..., description='Price as number')
	brand: str | None = Field(None, description='Brand name')
	size: str | None = Field(None, description='Size or quantity')
	url: str = Field(..., description='Full URL to item')


class GroceryCart(BaseModel):
	"""Grocery cart results"""

	items: list[GroceryItem] = Field(default_factory=list, description='All grocery items found')


async def add_to_cart(items: list[str] = ['milk', 'eggs', 'bread']):
	browser = Browser(cdp_url='http://localhost:9222')

	llm = ChatBrowserUse()

	# Task prompt
	task = f"""
    Search for "{items}" on Instacart at the nearest store.

    You will buy all of the items at the same store.
    For each item:
    1. Search for the item
    2. Find the best match (closest name, lowest price)
    3. Add the item to the cart

    Site:
    - Instacart: https://www.instacart.com/
    """

	# Create agent with structured output
	agent = Agent(
		browser=browser,
		llm=llm,
		task=task,
		output_model_schema=GroceryCart,
	)

	# Run the agent
	result = await agent.run()
	return result


if __name__ == '__main__':
	# Get user input
	items_input = input('What items would you like to add to cart (comma-separated)? ').strip()
	if not items_input:
		items = ['milk', 'eggs', 'bread']
		print(f'Using default items: {items}')
	else:
		items = [item.strip() for item in items_input.split(',')]

	result = asyncio.run(add_to_cart(items))

	# Access structured output
	if result and result.structured_output:
		cart = result.structured_output

		print(f'\n{"=" * 60}')
		print('Items Added to Cart')
		print(f'{"=" * 60}\n')

		for item in cart.items:
			print(f'Name: {item.name}')
			print(f'Price: ${item.price}')
			if item.brand:
				print(f'Brand: {item.brand}')
			if item.size:
				print(f'Size: {item.size}')
			print(f'URL: {item.url}')
			print(f'{"-" * 60}')

```

---

## backend/browser-use/examples/use-cases/captcha.py

```py
"""
Goal: Automates CAPTCHA solving on a demo website.


Simple try of the agent.
@dev You need to add OPENAI_API_KEY to your environment variables.
NOTE: captchas are hard. For this example it works. But e.g. for iframes it does not.
for this example it helps to zoom in.
"""

import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from browser_use import Agent, ChatOpenAI


async def main():
	llm = ChatOpenAI(model='gpt-4.1-mini')
	agent = Agent(
		task='go to https://captcha.com/demos/features/captcha-demo.aspx and solve the captcha',
		llm=llm,
	)
	await agent.run()
	input('Press Enter to exit')


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/use-cases/check_appointment.py

```py
# Goal: Checks for available visa appointment slots on the Greece MFA website.

import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

from pydantic import BaseModel

from browser_use import ChatOpenAI
from browser_use.agent.service import Agent
from browser_use.tools.service import Tools

if not os.getenv('OPENAI_API_KEY'):
	raise ValueError('OPENAI_API_KEY is not set. Please add it to your environment variables.')

tools = Tools()


class WebpageInfo(BaseModel):
	"""Model for webpage link."""

	link: str = 'https://appointment.mfa.gr/en/reservations/aero/ireland-grcon-dub/'


@tools.action('Go to the webpage', param_model=WebpageInfo)
def go_to_webpage(webpage_info: WebpageInfo):
	"""Returns the webpage link."""
	return webpage_info.link


async def main():
	"""Main function to execute the agent task."""
	task = (
		'Go to the Greece MFA webpage via the link I provided you.'
		'Check the visa appointment dates. If there is no available date in this month, check the next month.'
		'If there is no available date in both months, tell me there is no available date.'
	)

	model = ChatOpenAI(model='gpt-4.1-mini')
	agent = Agent(task, model, tools=tools, use_vision=True)

	await agent.run()


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/use-cases/extract_pdf_content.py

```py
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["browser-use", "mistralai"]
# ///

import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

import asyncio
import logging

from browser_use import Agent, ChatOpenAI

logger = logging.getLogger(__name__)


async def main():
	agent = Agent(
		task="""
        Objective: Navigate to the following UR, what is on page 3?

        URL: https://docs.house.gov/meetings/GO/GO00/20220929/115171/HHRG-117-GO00-20220929-SD010.pdf
        """,
		llm=ChatOpenAI(model='gpt-4.1-mini'),
	)
	result = await agent.run()
	logger.info(result)


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/use-cases/find_influencer_profiles.py

```py
"""
Show how to use custom outputs.

@dev You need to add OPENAI_API_KEY to your environment variables.
"""

import asyncio
import json
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv

load_dotenv()

import httpx
from pydantic import BaseModel

from browser_use import Agent, ChatOpenAI, Tools
from browser_use.agent.views import ActionResult


class Profile(BaseModel):
	platform: str
	profile_url: str


class Profiles(BaseModel):
	profiles: list[Profile]


tools = Tools(exclude_actions=['search'], output_model=Profiles)
BEARER_TOKEN = os.getenv('BEARER_TOKEN')

if not BEARER_TOKEN:
	# use the api key for ask tessa
	# you can also use other apis like exa, xAI, perplexity, etc.
	raise ValueError('BEARER_TOKEN is not set - go to https://www.heytessa.ai/ and create an api key')


@tools.registry.action('Search the web for a specific query')
async def search_web(query: str):
	keys_to_use = ['url', 'title', 'content', 'author', 'score']
	headers = {'Authorization': f'Bearer {BEARER_TOKEN}'}
	async with httpx.AsyncClient() as client:
		response = await client.post(
			'https://asktessa.ai/api/search',
			headers=headers,
			json={'query': query},
		)

	final_results = [
		{key: source[key] for key in keys_to_use if key in source}
		for source in await response.json()['sources']
		if source['score'] >= 0.2
	]
	# print(json.dumps(final_results, indent=4))
	result_text = json.dumps(final_results, indent=4)
	print(result_text)
	return ActionResult(extracted_content=result_text, include_in_memory=True)


async def main():
	task = (
		'Go to this tiktok video url, open it and extract the @username from the resulting url. Then do a websearch for this username to find all his social media profiles. Return me the links to the social media profiles with the platform name.'
		' https://www.tiktokv.com/share/video/7470981717659110678/  '
	)
	model = ChatOpenAI(model='gpt-4.1-mini')
	agent = Agent(task=task, llm=model, tools=tools)

	history = await agent.run()

	result = history.final_result()
	if result:
		parsed: Profiles = Profiles.model_validate_json(result)

		for profile in parsed.profiles:
			print('\n--------------------------------')
			print(f'Platform:         {profile.platform}')
			print(f'Profile URL:      {profile.profile_url}')

	else:
		print('No result')


if __name__ == '__main__':
	asyncio.run(main())

```

---

## backend/browser-use/examples/use-cases/onepassword.py

```py
import os

from onepassword.client import Client

from browser_use import ActionResult, Agent, Browser, ChatOpenAI, Tools
from browser_use.browser.session import BrowserSession

"""
Use Case: Securely log into a website using credentials stored in 1Password vault.
- Use fill_field action to fill in username and password fields with values retrieved from 1Password. The LLM never sees the actual credentials.
- Use blur_page and unblur_page actions to visually obscure sensitive information on the page while filling in credentials for extra security.

**SETUP**
How to setup 1Password with Browser Use
- Get Individual Plan for 1Password
- Go to the Home page and click “New Vault”
    - Add the credentials you need for any websites you want to log into
- Go to “Developer” tab, navigate to “Directory” and create a Service Account
- Give the service account access to the vault
- Copy the Service Account Token and set it as environment variable OP_SERVICE_ACCOUNT_TOKEN
- Install the onepassword package: pip install onepassword-sdk
Note: In this example, we assume that you created a vault named "prod-secrets" and added an item named "X" with fields "username" and "password".
"""


async def main():
	# Gets your service account token from environment variable
	token = os.getenv('OP_SERVICE_ACCOUNT_TOKEN')

	# Authenticate with 1Password
	op_client = await Client.authenticate(auth=token, integration_name='Browser Use Secure Login', integration_version='v1.0.0')

	# Initialize tools
	tools = Tools()

	@tools.registry.action('Apply CSS blur filter to entire page content')
	async def blur_page(browser_session: BrowserSession):
		"""
		Applies CSS blur filter directly to document.body to obscure all page content.
		The blur will remain until unblur_page is called.
		DOM remains accessible for element finding while page is visually blurred.
		"""
		try:
			# Get CDP session
			cdp_session = await browser_session.get_or_create_cdp_session()

			# Apply blur filter to document.body
			result = await cdp_session.cdp_client.send.Runtime.evaluate(
				params={
					'expression': """
                        (function() {
                            // Check if already blurred
                            if (document.body.getAttribute('data-page-blurred') === 'true') {
                                console.log('[BLUR] Page already blurred');
                                return true;
                            }

                            // Apply CSS blur filter to body
                            document.body.style.filter = 'blur(15px)';
                            document.body.style.webkitFilter = 'blur(15px)'; // Safari support
                            document.body.style.transition = 'filter 0.3s ease';
                            document.body.setAttribute('data-page-blurred', 'true');

                            console.log('[BLUR] Applied CSS blur to page');
                            return true;
                        })();
                    """,
					'returnByValue': True,
				},
				session_id=cdp_session.session_id,
			)

			success = result.get('result', {}).get('value', False)
			if success:
				print('[BLUR] Applied CSS blur to page')
				return ActionResult(extracted_content='Successfully applied CSS blur to page', include_in_memory=True)
			else:
				return ActionResult(error='Failed to apply blur', include_in_memory=True)

		except Exception as e:
			print(f'[BLUR ERROR] {e}')
			return ActionResult(error=f'Failed to blur page: {str(e)}', include_in_memory=True)

	@tools.registry.action('Remove CSS blur filter from page')
	async def unblur_page(browser_session: BrowserSession):
		"""
		Removes the CSS blur filter from document.body, restoring normal page visibility.
		"""
		try:
			# Get CDP session
			cdp_session = await browser_session.get_or_create_cdp_session()

			# Remove blur filter from body
			result = await cdp_session.cdp_client.send.Runtime.evaluate(
				params={
					'expression': """
                        (function() {
                            if (document.body.getAttribute('data-page-blurred') !== 'true') {
                                console.log('[BLUR] Page not blurred');
                                return false;
                            }

                            // Remove CSS blur filter
                            document.body.style.filter = 'none';
                            document.body.style.webkitFilter = 'none';
                            document.body.removeAttribute('data-page-blurred');

                            console.log('[BLUR] Removed CSS blur from page');
                            return true;
                        })();
                    """,
					'returnByValue': True,
				},
				session_id=cdp_session.session_id,
			)

			removed = result.get('result', {}).get('value', False)
			if removed:
				print('[BLUR] Removed CSS blur from page')
				return ActionResult(extracted_content='Successfully removed CSS blur from page', include_in_memory=True)
			else:
				print('[BLUR] Page was not blurred')
				return ActionResult(
					extracted_content='Page was not blurred (may have already been removed)', include_in_memory=True
				)

		except Exception as e:
			print(f'[BLUR ERROR] {e}')
			return ActionResult(error=f'Failed to unblur page: {str(e)}', include_in_memory=True)

	# LLM can call this action to use actors to fill in sensitive fields using 1Password values.
	@tools.registry.action('Fill in a specific field for a website using value from 1Password vault')
	async def fill_field(vault_name: str, item_name: str, field_name: str, browser_session: BrowserSession):
		"""
		Fills in a specific field for a website using the value from 1Password.
		Note: Use blur_page before calling this if you want visual security.
		"""
		try:
			# Resolve field value from 1Password
			field_value = await op_client.secrets.resolve(f'op://{vault_name}/{item_name}/{field_name}')

			# Get current page
			page = await browser_session.must_get_current_page()

			# Find and fill the element
			target_field = await page.must_get_element_by_prompt(f'{field_name} input field', llm)
			await target_field.fill(field_value)

			return ActionResult(
				extracted_content=f'Successfully filled {field_name} field for {vault_name}/{item_name}', include_in_memory=True
			)
		except Exception as e:
			return ActionResult(error=f'Failed to fill {field_name} field: {str(e)}', include_in_memory=True)

	browser_session = Browser()

	llm = ChatOpenAI(model='o3')

	agent = Agent(
		task="""
        Navigate to https://x.com/i/flow/login
        Wait for the page to load.
        Use fill_field action with vault_name='prod-secrets' and item_name='X' and field_name='username'.
        Click the Next button.
        Use fill_field action with vault_name='prod-secrets' and item_name='X' and field_name='password'.
        Click the Log in button.
        Give me the latest 5 tweets from the logged in user's timeline.

        **IMPORTANT** Use blur_page action if you anticipate filling sensitive fields.
        Only use unblur_page action after you see the logged in user's X timeline.
        Your priority is to keep the username and password hidden while filling sensitive fields.
        """,
		browser_session=browser_session,
		llm=llm,
		tools=tools,
		file_system_path='./agent_data',
	)

	await agent.run()


if __name__ == '__main__':
	import asyncio

	asyncio.run(main())

```

---

## backend/browser-use/examples/use-cases/pcpartpicker.py

```py
import asyncio

from browser_use import Agent, Browser, ChatBrowserUse, Tools


async def main():
	browser = Browser(cdp_url='http://localhost:9222')

	llm = ChatBrowserUse()

	tools = Tools()

	task = """
    Design me a mid-range water-cooled ITX computer
    Keep the total budget under $2000

    Go to https://pcpartpicker.com/
    Make sure the build is complete and has no incompatibilities.
    Provide the full list of parts with prices and a link to the completed build.
    """

	agent = Agent(
		task=task,
		browser=browser,
		tools=tools,
		llm=llm,
	)

	history = await agent.run(max_steps=100000)
	return history


if __name__ == '__main__':
	history = asyncio.run(main())
	final_result = history.final_result()
	print(final_result)

```
