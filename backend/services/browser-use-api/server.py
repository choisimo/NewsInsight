"""
Browser-Use API Server with Human-in-the-Loop Support
FastAPI server that exposes browser-use functionality via HTTP API with real-time
human intervention capabilities.
"""

import asyncio
import base64
import os
import time
import uuid
import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Optional, Any, Callable
from datetime import datetime
from enum import Enum

import httpx
from collections import defaultdict
from fastapi import FastAPI, HTTPException, BackgroundTasks, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Browser-use imports
from browser_use import Agent, Controller
from browser_use.browser import BrowserSession, BrowserProfile, ProxySettings

# Local modules for AIDove integration and intent analysis
from aidove_chat import ChatAIDove
from intent_analyzer import IntentAnalyzer, SearchGuarantee, ResultFusion, IntentType, APIProvider, PROVIDER_URLS
from api_key_provisioner import ApiKeyProvisioner, ProvisioningRequest, ProvisioningResponse, create_provisioning_task

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ============================================
# Rate Limiting for API Key Provisioning
# ============================================


class RateLimiter:
	"""
	Simple in-memory rate limiter for API key provisioning.

	Uses a sliding window approach to limit requests per IP address.
	"""

	def __init__(self, requests_per_minute: int = 5, window_seconds: int = 60):
		self.requests_per_minute = requests_per_minute
		self.window_seconds = window_seconds
		self._requests: dict[str, list[float]] = defaultdict(list)
		self._lock = asyncio.Lock()

	async def is_allowed(self, client_ip: str) -> tuple[bool, dict]:
		"""
		Check if a request from client_ip is allowed.

		Returns:
			tuple: (is_allowed, rate_limit_info)
		"""
		async with self._lock:
			now = time.time()
			window_start = now - self.window_seconds

			# Clean old requests outside the window
			self._requests[client_ip] = [ts for ts in self._requests[client_ip] if ts > window_start]

			current_count = len(self._requests[client_ip])
			remaining = max(0, self.requests_per_minute - current_count)

			# Calculate retry-after if rate limited
			if current_count >= self.requests_per_minute:
				oldest_request = min(self._requests[client_ip])
				retry_after = int(oldest_request + self.window_seconds - now) + 1
				return False, {
					'limit': self.requests_per_minute,
					'remaining': 0,
					'reset': int(oldest_request + self.window_seconds),
					'retry_after': retry_after,
				}

			# Record this request
			self._requests[client_ip].append(now)

			return True, {
				'limit': self.requests_per_minute,
				'remaining': remaining - 1,  # After this request
				'reset': int(now + self.window_seconds),
			}

	async def get_stats(self) -> dict:
		"""Get current rate limiter statistics."""
		async with self._lock:
			now = time.time()
			window_start = now - self.window_seconds

			# Clean and count
			active_ips = 0
			total_requests = 0

			for ip, timestamps in list(self._requests.items()):
				valid = [ts for ts in timestamps if ts > window_start]
				if valid:
					self._requests[ip] = valid
					active_ips += 1
					total_requests += len(valid)
				else:
					del self._requests[ip]

			return {
				'active_ips': active_ips,
				'total_requests_in_window': total_requests,
				'window_seconds': self.window_seconds,
				'max_requests_per_ip': self.requests_per_minute,
			}


# Rate limiter configuration from environment
API_KEY_PROVISION_RATE_LIMIT = int(os.environ.get('API_KEY_PROVISION_RATE_LIMIT', '5'))
api_key_rate_limiter = RateLimiter(requests_per_minute=API_KEY_PROVISION_RATE_LIMIT)


def get_client_ip(request: Request) -> str:
	"""Extract client IP from request, considering proxy headers."""
	# Check for forwarded headers (behind reverse proxy)
	forwarded = request.headers.get('X-Forwarded-For')
	if forwarded:
		# Take the first IP in the chain (original client)
		return forwarded.split(',')[0].strip()

	real_ip = request.headers.get('X-Real-IP')
	if real_ip:
		return real_ip.strip()

	# Fall back to direct connection IP
	if request.client:
		return request.client.host

	return 'unknown'


# ============================================
# Audit Logging for API Key Provisioning
# ============================================


class ProvisioningAuditLogger:
	"""
	Audit logger for API key provisioning events.

	Logs to:
	1. Local structured log file (JSONL format)
	2. Optionally sends to admin-dashboard audit service via HTTP
	"""

	def __init__(
		self,
		log_file: str = '/var/log/newsinsight/api-key-provisioning.jsonl',
		admin_dashboard_url: Optional[str] = None,
	):
		self.log_file = log_file
		self.admin_dashboard_url = admin_dashboard_url
		self._ensure_log_file()
		self._client: Optional[httpx.AsyncClient] = None

	def _ensure_log_file(self) -> None:
		"""Ensure log directory and file exist."""
		try:
			import os

			log_dir = os.path.dirname(self.log_file)
			if log_dir:
				os.makedirs(log_dir, exist_ok=True)
			if not os.path.exists(self.log_file):
				with open(self.log_file, 'w') as f:
					pass  # Create empty file
		except Exception as e:
			logger.warning(f'Could not create audit log file {self.log_file}: {e}')

	async def log_event(
		self,
		event_type: str,
		provider: str,
		client_ip: str,
		job_id: str,
		success: bool,
		user_agent: Optional[str] = None,
		details: Optional[dict] = None,
		error_message: Optional[str] = None,
	) -> None:
		"""
		Log an API key provisioning event.

		Event types:
		- provision_started: Provisioning job started
		- provision_completed: API key successfully generated
		- provision_failed: Provisioning failed
		- rate_limited: Request was rate limited
		- login_required: Human login intervention requested
		- login_completed: Human completed login
		- twofa_required: 2FA intervention requested
		- twofa_completed: 2FA completed
		"""
		import json

		log_entry = {
			'id': f'audit-{uuid.uuid4().hex[:12]}',
			'timestamp': datetime.utcnow().isoformat() + 'Z',
			'event_type': event_type,
			'resource_type': 'api_key_provisioning',
			'provider': provider,
			'job_id': job_id,
			'client_ip': client_ip,
			'user_agent': user_agent,
			'success': success,
			'error_message': error_message,
			'details': details or {},
		}

		# Log locally
		try:
			with open(self.log_file, 'a') as f:
				f.write(json.dumps(log_entry) + '\n')
		except Exception as e:
			logger.warning(f'Failed to write audit log: {e}')

		# Log to console in structured format
		log_msg = f'AUDIT: {event_type} | provider={provider} | job_id={job_id} | ip={client_ip} | success={success}'
		if error_message:
			log_msg += f' | error={error_message}'

		if success:
			logger.info(log_msg)
		else:
			logger.warning(log_msg)

		# Optionally send to admin dashboard
		if self.admin_dashboard_url:
			try:
				if self._client is None:
					self._client = httpx.AsyncClient(timeout=5.0)

				await self._client.post(
					f'{self.admin_dashboard_url}/api/audit',
					json=log_entry,
				)
			except Exception as e:
				logger.debug(f'Failed to send audit log to admin dashboard: {e}')

	async def close(self) -> None:
		"""Clean up HTTP client."""
		if self._client:
			await self._client.aclose()
			self._client = None


# Audit logger configuration
PROVISIONING_AUDIT_LOG_FILE = os.environ.get('PROVISIONING_AUDIT_LOG_FILE', '/var/log/newsinsight/api-key-provisioning.jsonl')
ADMIN_DASHBOARD_URL = os.environ.get('ADMIN_DASHBOARD_URL')  # Optional

provisioning_audit_logger = ProvisioningAuditLogger(
	log_file=PROVISIONING_AUDIT_LOG_FILE,
	admin_dashboard_url=ADMIN_DASHBOARD_URL,
)


@dataclass
class ProxyInfo:
	id: str
	address: str
	protocol: str = 'http'
	username: Optional[str] = None
	password: Optional[str] = None
	country: Optional[str] = None
	health_status: Optional[str] = None


class ProxyRotationClient:
	def __init__(
		self,
		base_url: str,
		timeout: float = 5.0,
		enabled: bool = True,
	) -> None:
		self._base_url = base_url.rstrip('/')
		self._timeout = timeout
		self._enabled = enabled
		self._client: Optional[httpx.AsyncClient] = None
		self._lock = asyncio.Lock()

	async def _get_client(self) -> httpx.AsyncClient:
		async with self._lock:
			if self._client is None:
				self._client = httpx.AsyncClient(timeout=self._timeout)
			return self._client

	async def close(self) -> None:
		async with self._lock:
			if self._client is not None:
				await self._client.aclose()
				self._client = None

	async def health_check(self) -> bool:
		if not self._enabled:
			return False
		client = await self._get_client()
		try:
			resp = await client.get(f'{self._base_url}/health')
			return resp.status_code == 200
		except Exception:
			return False

	async def get_next_proxy(self) -> Optional[ProxyInfo]:
		if not self._enabled:
			return None
		client = await self._get_client()
		try:
			resp = await client.get(f'{self._base_url}/proxy/next')
			if resp.status_code != 200:
				return None

			data: Any = resp.json()
			if not isinstance(data, dict):
				return None

			proxy_id = data.get('proxyId') or data.get('proxy_id') or data.get('id')
			address = data.get('address')
			if not proxy_id or not address:
				return None

			return ProxyInfo(
				id=str(proxy_id),
				address=str(address),
				protocol=str(data.get('protocol') or 'http'),
				username=data.get('username'),
				password=data.get('password'),
				country=data.get('country'),
				health_status=data.get('healthStatus') or data.get('health_status'),
			)
		except Exception:
			return None

	async def record_success(self, proxy_id: str, latency_ms: int = 0) -> bool:
		return await self._record(proxy_id=proxy_id, success=True, latency_ms=latency_ms)

	async def record_failure(self, proxy_id: str, reason: str = '') -> bool:
		return await self._record(proxy_id=proxy_id, success=False, reason=reason)

	async def record_captcha(self, proxy_id: str, captcha_type: str = '') -> bool:
		if not self._enabled:
			return False
		client = await self._get_client()
		payload = {
			'proxyId': proxy_id,
			'type': captcha_type,
		}
		try:
			resp = await client.post(f'{self._base_url}/proxy/captcha', json=payload)
			return resp.status_code == 200
		except Exception:
			return False

	async def _record(
		self,
		proxy_id: str,
		success: bool,
		latency_ms: int = 0,
		reason: str = '',
	) -> bool:
		if not self._enabled:
			return False
		client = await self._get_client()
		payload = {
			'proxyId': proxy_id,
			'success': bool(success),
			'latencyMs': int(latency_ms),
			'reason': reason,
		}
		try:
			resp = await client.post(f'{self._base_url}/proxy/record', json=payload)
			return resp.status_code == 200
		except Exception:
			return False


def _env_bool(raw: str) -> bool:
	return raw.strip().lower() in {'1', 'true', 'yes', 'y', 'on'}


PROXY_ROTATION_ENABLED = _env_bool(os.environ.get('USE_PROXY_ROTATION', 'false'))
PROXY_ROTATION_URL = os.environ.get('PROXY_ROTATION_URL', 'http://ip-rotation:8050').rstrip('/')
PROXY_ROTATION_TIMEOUT_SECONDS = float(os.environ.get('PROXY_ROTATION_TIMEOUT_SECONDS', '5.0'))

proxy_rotation_client: Optional[ProxyRotationClient] = None


# ============================================
# Enums and Constants
# ============================================


class JobStatus(str, Enum):
	PENDING = 'pending'
	RUNNING = 'running'
	WAITING_HUMAN = 'waiting_human'  # Waiting for human intervention
	COMPLETED = 'completed'
	FAILED = 'failed'
	CANCELLED = 'cancelled'


class InterventionType(str, Enum):
	CAPTCHA = 'captcha'
	LOGIN = 'login'
	NAVIGATION = 'navigation'
	EXTRACTION = 'extraction'
	CONFIRMATION = 'confirmation'
	CUSTOM = 'custom'


# ============================================
# Request/Response Models
# ============================================


class BrowseRequest(BaseModel):
	"""Request to perform a browser automation task."""

	task: str = Field(..., description='The task for the AI agent to perform')
	url: Optional[str] = Field(None, description='Optional starting URL')
	session_id: Optional[str] = Field(None, description='Session ID for context continuity')
	max_steps: int = Field(25, description='Maximum number of steps', ge=1, le=100)
	timeout_seconds: int = Field(300, description='Timeout in seconds', ge=30, le=600)
	headless: bool = Field(False, description='Run browser in headless mode (False for human intervention)')
	enable_human_intervention: bool = Field(True, description='Allow human intervention when needed')
	auto_request_intervention: bool = Field(True, description='Automatically request intervention on issues')
	use_proxy_rotation: bool = Field(PROXY_ROTATION_ENABLED, description='Use proxy rotation via ip-rotation service')


class BrowseResponse(BaseModel):
	"""Response from a browser automation task."""

	job_id: str
	status: str
	message: str
	result: Optional[str] = None
	steps_taken: int = 0
	urls_visited: list[str] = []
	screenshots: list[str] = []
	error: Optional[str] = None
	started_at: Optional[str] = None
	completed_at: Optional[str] = None
	intervention_requested: bool = False
	intervention_type: Optional[str] = None


class InterventionRequest(BaseModel):
	"""Human intervention request details."""

	job_id: str
	intervention_type: InterventionType
	reason: str
	screenshot: Optional[str] = None  # Base64 encoded
	current_url: Optional[str] = None
	suggested_actions: list[str] = []
	timeout_seconds: int = Field(300, description='Timeout for human response')


class HumanAction(BaseModel):
	"""Human's response to an intervention request."""

	action_type: str = Field(..., description='Type of action: click, type, navigate, scroll, custom, skip, abort')
	selector: Optional[str] = Field(None, description='CSS selector for element interaction')
	value: Optional[str] = Field(None, description='Value for input/navigation')
	x: Optional[int] = Field(None, description='X coordinate for click')
	y: Optional[int] = Field(None, description='Y coordinate for click')
	custom_script: Optional[str] = Field(None, description='Custom JavaScript to execute')
	message: Optional[str] = Field(None, description='Message/feedback for the AI')


class JobStatusResponse(BaseModel):
	"""Status of a running job."""

	job_id: str
	status: str
	progress: float = 0.0
	current_step: int = 0
	max_steps: int = 25
	result: Optional[str] = None
	error: Optional[str] = None
	urls_visited: list[str] = []
	started_at: Optional[str] = None
	completed_at: Optional[str] = None
	# Human intervention fields
	intervention_requested: bool = False
	intervention_type: Optional[str] = None
	intervention_reason: Optional[str] = None
	intervention_screenshot: Optional[str] = None
	current_url: Optional[str] = None


class HealthResponse(BaseModel):
	"""Health check response."""

	status: str
	version: str
	uptime_seconds: float
	active_jobs: int
	waiting_intervention: int


# ============================================
# Job Management
# ============================================


@dataclass
class InterventionState:
	"""State for human intervention."""

	requested: bool = False
	type: Optional[InterventionType] = None
	reason: Optional[str] = None
	screenshot: Optional[str] = None
	current_url: Optional[str] = None
	suggested_actions: list[str] = field(default_factory=list)
	response: Optional[HumanAction] = None
	response_event: asyncio.Event = field(default_factory=asyncio.Event)
	timeout_seconds: int = 300


@dataclass
class Job:
	"""Represents a browser automation job."""

	id: str
	task: str
	url: Optional[str]
	session_id: Optional[str]
	max_steps: int
	timeout_seconds: int
	headless: bool
	enable_human_intervention: bool
	auto_request_intervention: bool
	use_proxy_rotation: bool
	proxy_id: Optional[str] = None
	proxy_address: Optional[str] = None
	status: JobStatus = JobStatus.PENDING
	progress: float = 0.0
	current_step: int = 0
	result: Optional[str] = None
	error: Optional[str] = None
	urls_visited: list = None
	screenshots: list = None
	started_at: Optional[datetime] = None
	completed_at: Optional[datetime] = None
	# Human intervention state
	intervention: InterventionState = None
	# Browser session reference
	browser_session: Optional[BrowserSession] = None
	# WebSocket connections for this job
	websocket_clients: list = None

	def __post_init__(self):
		if self.urls_visited is None:
			self.urls_visited = []
		if self.screenshots is None:
			self.screenshots = []
		if self.intervention is None:
			self.intervention = InterventionState()
		if self.websocket_clients is None:
			self.websocket_clients = []


# In-memory job storage (use Redis in production)
jobs: dict[str, Job] = {}
start_time = datetime.now()


# WebSocket connection manager
class ConnectionManager:
	def __init__(self):
		self.active_connections: dict[str, list[WebSocket]] = {}

	async def connect(self, websocket: WebSocket, job_id: str):
		await websocket.accept()
		if job_id not in self.active_connections:
			self.active_connections[job_id] = []
		self.active_connections[job_id].append(websocket)
		logger.info(f'WebSocket connected for job {job_id}')

	def disconnect(self, websocket: WebSocket, job_id: str):
		if job_id in self.active_connections:
			if websocket in self.active_connections[job_id]:
				self.active_connections[job_id].remove(websocket)
			if not self.active_connections[job_id]:
				del self.active_connections[job_id]
		logger.info(f'WebSocket disconnected for job {job_id}')

	async def broadcast(self, job_id: str, message: dict):
		if job_id in self.active_connections:
			disconnected = []
			for connection in self.active_connections[job_id]:
				try:
					await connection.send_json(message)
				except Exception:
					disconnected.append(connection)
			for conn in disconnected:
				self.disconnect(conn, job_id)


manager = ConnectionManager()


# ============================================
# Browser Agent Runner with Human Intervention
# ============================================


async def capture_screenshot(browser_session: Optional[BrowserSession]) -> Optional[str]:
	"""Capture a screenshot from the browser and return as base64."""
	try:
		if browser_session:
			# Use BrowserSession's take_screenshot method which returns bytes
			screenshot_bytes = await browser_session.take_screenshot()
			return base64.b64encode(screenshot_bytes).decode('utf-8')
	except Exception as e:
		logger.warning(f'Failed to capture screenshot: {e}')
	return None


async def get_current_url(browser_session: Optional[BrowserSession]) -> Optional[str]:
	"""Get the current page URL."""
	try:
		if browser_session:
			url = await browser_session.get_current_page_url()
			return url if url else None
	except Exception as e:
		logger.warning(f'Failed to get current URL: {e}')
	return None


async def _detect_captcha_on_page(browser_session: Optional[BrowserSession]) -> Optional[str]:
	"""
	Detect CAPTCHA on the current page by checking for common CAPTCHA indicators.

	Returns the type of CAPTCHA detected, or None if no CAPTCHA found.
	"""
	if not browser_session:
		return None

	try:
		context = getattr(browser_session, '_context', None)
		if not context:
			return None

		pages = context.pages
		if not pages:
			return None

		page = pages[0]

		# JavaScript to detect various CAPTCHA types
		detection_script = """
        () => {
            const indicators = [];
            
            // Check for reCAPTCHA
            if (document.querySelector('.g-recaptcha') || 
                document.querySelector('[data-sitekey]') ||
                document.querySelector('iframe[src*="recaptcha"]') ||
                document.querySelector('#recaptcha') ||
                document.querySelector('.recaptcha-checkbox')) {
                indicators.push('reCAPTCHA');
            }
            
            // Check for hCaptcha
            if (document.querySelector('.h-captcha') ||
                document.querySelector('[data-hcaptcha-widget-id]') ||
                document.querySelector('iframe[src*="hcaptcha"]')) {
                indicators.push('hCaptcha');
            }
            
            // Check for Cloudflare Turnstile
            if (document.querySelector('.cf-turnstile') ||
                document.querySelector('[data-turnstile-widget-id]') ||
                document.querySelector('iframe[src*="turnstile"]') ||
                document.querySelector('iframe[src*="challenges.cloudflare"]')) {
                indicators.push('Cloudflare Turnstile');
            }
            
            // Check for Cloudflare challenge page
            if (document.querySelector('#challenge-running') ||
                document.querySelector('#challenge-form') ||
                document.querySelector('.cf-browser-verification') ||
                document.title.includes('Just a moment') ||
                document.body.textContent.includes('Checking your browser') ||
                document.body.textContent.includes('Please wait while we verify')) {
                indicators.push('Cloudflare Challenge');
            }
            
            // Check for generic CAPTCHA indicators
            const bodyText = document.body.textContent.toLowerCase();
            if (bodyText.includes('verify you are human') ||
                bodyText.includes('prove you are human') ||
                bodyText.includes('robot verification') ||
                bodyText.includes('are you a robot') ||
                bodyText.includes('security check')) {
                indicators.push('Generic CAPTCHA');
            }
            
            // Check for FunCaptcha / Arkose Labs
            if (document.querySelector('#fc-iframe-wrap') ||
                document.querySelector('[data-fc-payload]') ||
                document.querySelector('iframe[src*="funcaptcha"]') ||
                document.querySelector('iframe[src*="arkoselabs"]')) {
                indicators.push('FunCaptcha');
            }
            
            // Check for access denied / blocked pages
            if (document.body.textContent.includes('Access Denied') ||
                document.body.textContent.includes('403 Forbidden') ||
                document.body.textContent.includes('Your access to this site has been limited')) {
                indicators.push('Access Blocked');
            }
            
            return indicators.length > 0 ? indicators.join(', ') : null;
        }
        """

		result = await page.evaluate(detection_script)
		return result

	except Exception as e:
		logger.warning(f'CAPTCHA detection failed: {e}')
		return None


async def request_human_intervention(
	job: Job, intervention_type: InterventionType, reason: str, suggested_actions: Optional[list[str]] = None
) -> Optional[HumanAction]:
	"""
	Request human intervention and wait for response.

	Returns the human's action or None if timeout/skip.
	"""
	if not job.enable_human_intervention:
		return None

	job.status = JobStatus.WAITING_HUMAN
	job.intervention.requested = True
	job.intervention.type = intervention_type
	job.intervention.reason = reason
	job.intervention.suggested_actions = suggested_actions or []
	job.intervention.response_event.clear()

	# Capture screenshot
	if job.browser_session:
		job.intervention.screenshot = await capture_screenshot(job.browser_session)
		job.intervention.current_url = await get_current_url(job.browser_session)

	# Notify via WebSocket
	await manager.broadcast(
		job.id,
		{
			'type': 'intervention_requested',
			'job_id': job.id,
			'intervention_type': intervention_type.value,
			'reason': reason,
			'screenshot': job.intervention.screenshot,
			'current_url': job.intervention.current_url,
			'suggested_actions': job.intervention.suggested_actions,
		},
	)

	logger.info(f'Job {job.id}: Requesting human intervention - {intervention_type.value}: {reason}')

	# Wait for human response with timeout
	try:
		await asyncio.wait_for(job.intervention.response_event.wait(), timeout=job.intervention.timeout_seconds)
		return job.intervention.response
	except asyncio.TimeoutError:
		logger.warning(f'Job {job.id}: Human intervention timed out')
		job.intervention.requested = False
		job.status = JobStatus.RUNNING
		return None


async def execute_human_action(job: Job, action: HumanAction) -> bool:
	"""Execute a human-specified action on the browser."""
	try:
		if not job.browser_session:
			return False

		context = getattr(job.browser_session, '_context', None)
		if not context:
			return False

		pages = context.pages
		if not pages:
			return False

		page = pages[0]

		if action.action_type == 'click':
			if action.selector:
				await page.click(action.selector)
			elif action.x is not None and action.y is not None:
				await page.mouse.click(action.x, action.y)
			else:
				return False

		elif action.action_type == 'type':
			if action.selector and action.value:
				await page.fill(action.selector, action.value)
			else:
				return False

		elif action.action_type == 'navigate':
			if action.value:
				await page.goto(action.value)
			else:
				return False

		elif action.action_type == 'scroll':
			if action.y:
				await page.evaluate(f'window.scrollBy(0, {action.y})')
			else:
				await page.evaluate('window.scrollBy(0, 500)')

		elif action.action_type == 'custom':
			if action.custom_script:
				await page.evaluate(action.custom_script)
			else:
				return False

		elif action.action_type == 'skip':
			# Just continue without action
			pass

		elif action.action_type == 'abort':
			return False  # Signal to abort

		else:
			logger.warning(f'Unknown action type: {action.action_type}')
			return False

		logger.info(f'Job {job.id}: Executed human action - {action.action_type}')
		return True

	except Exception as e:
		logger.error(f'Job {job.id}: Failed to execute human action: {e}')
		return False


def _is_action_log(text: str) -> bool:
	"""Check if a text is just an action log rather than actual content."""
	if not text or not text.strip():
		return True
	text_lower = text.strip().lower()
	# Common action log prefixes that are NOT actual content
	action_prefixes = [
		'navigate to',
		'navigating to',
		'clicked on',
		'clicking on',
		'typing',
		'scrolling',
		'waiting',
		'loading',
		'extracting',
		'searching for',
		'opening',
		'closing',
		'going to',
		'visited',
		'completed action',
		'performed action',
		'executed',
		'action:',
	]
	for prefix in action_prefixes:
		if text_lower.startswith(prefix):
			# Only consider it an action log if it's short (< 200 chars)
			# Longer text with these prefixes might contain actual content
			if len(text) < 200:
				return True
	return False


def _extract_agent_result_text(result: Any) -> str:
	"""
	Extract meaningful result text from browser-use agent result.

	The browser-use library returns AgentHistoryList which contains:
	- final_result(): method that returns the final answer
	- history: list of AgentHistory items, each containing:
	  - model_output: ModelOutput with current_state, action descriptions
	  - result: list of ActionResult with extracted_content, error, etc.

	We need to extract:
	1. final_result() if available and meaningful
	2. All extracted_content from history that isn't just action logs
	3. Any text content from model_output that represents actual results
	"""
	if result is None:
		return ''
	if isinstance(result, str):
		return result

	collected_content: list[str] = []
	seen_content: set[str] = set()

	def add_content(text: str) -> None:
		"""Add content if it's not an action log and not seen before."""
		if not text or not isinstance(text, str):
			return
		text = text.strip()
		if not text or _is_action_log(text):
			return
		# Normalize for deduplication
		normalized = text.lower()[:100]
		if normalized not in seen_content:
			seen_content.add(normalized)
			collected_content.append(text)

	# 1. Try final_result() method first - this is the primary result
	if hasattr(result, 'final_result'):
		final_result = getattr(result, 'final_result')
		try:
			text = final_result() if callable(final_result) else final_result
			if isinstance(text, str) and text.strip() and not _is_action_log(text):
				# If final_result is meaningful, use it as primary
				add_content(text)
		except Exception as e:
			logger.debug(f'Error getting final_result: {e}')

	# 2. Try extracted_content attribute directly
	if hasattr(result, 'extracted_content'):
		extracted_content = getattr(result, 'extracted_content')
		try:
			content = extracted_content() if callable(extracted_content) else extracted_content
			if isinstance(content, str):
				add_content(content)
			elif isinstance(content, list):
				for item in content:
					if isinstance(item, str):
						add_content(item)
		except Exception as e:
			logger.debug(f'Error getting extracted_content: {e}')

	# 3. Iterate through history to find all extracted content
	history = getattr(result, 'history', None)
	if isinstance(history, list):
		for history_item in history:
			# Check model_output for any content
			model_output = getattr(history_item, 'model_output', None)
			if model_output:
				# Check current_state which might contain extracted info
				current_state = getattr(model_output, 'current_state', None)
				if current_state:
					# current_state might have 'memory' or 'summary' fields
					memory = getattr(current_state, 'memory', None)
					if isinstance(memory, str):
						add_content(memory)
					summary = getattr(current_state, 'summary', None)
					if isinstance(summary, str):
						add_content(summary)
					# Also check 'evaluation_previous_goal' which might have useful info
					eval_goal = getattr(current_state, 'evaluation_previous_goal', None)
					if isinstance(eval_goal, str) and len(eval_goal) > 50:
						add_content(eval_goal)

			# Check result list for extracted_content
			item_results = getattr(history_item, 'result', None)
			if isinstance(item_results, list):
				for action_result in item_results:
					# extracted_content is the main content field
					extracted = getattr(action_result, 'extracted_content', None)
					if isinstance(extracted, str):
						add_content(extracted)
					# Also check 'include_in_memory' content
					include_mem = getattr(action_result, 'include_in_memory', None)
					if isinstance(include_mem, str):
						add_content(include_mem)

	# 4. Try to get any 'all_results' or similar aggregate
	if hasattr(result, 'all_results'):
		all_results = getattr(result, 'all_results')
		try:
			results_list = all_results() if callable(all_results) else all_results
			if isinstance(results_list, list):
				for r in results_list:
					if isinstance(r, str):
						add_content(r)
		except Exception as e:
			logger.debug(f'Error getting all_results: {e}')

	# 5. Last resort: try to get string representation if nothing else worked
	if not collected_content:
		try:
			str_repr = str(result)
			# Only use if it's not the default object repr and is substantial
			if str_repr and not str_repr.startswith('<') and len(str_repr) > 100:
				# Try to find meaningful content in the string representation
				if 'extracted_content' in str_repr or 'result' in str_repr.lower():
					add_content(str_repr[:2000])  # Limit length
		except Exception:
			pass

	# Combine collected content
	if collected_content:
		# If we have a clear final result (first item), prioritize it
		if len(collected_content) == 1:
			return collected_content[0]

		# Otherwise, combine unique content pieces
		# Put longer/more substantial content first
		collected_content.sort(key=lambda x: len(x), reverse=True)

		# Remove very short items if we have longer ones
		if len(collected_content) > 1 and len(collected_content[0]) > 200:
			collected_content = [c for c in collected_content if len(c) > 50 or c == collected_content[0]]

		return '\n\n---\n\n'.join(collected_content[:5])  # Limit to top 5 pieces

	return ''


async def run_browser_task(job: Job):
	"""Execute a browser automation task using browser-use with AI Dove and human intervention support."""
	job.status = JobStatus.RUNNING
	job.started_at = datetime.now()
	job_start_perf = time.perf_counter()
	proxy_info: Optional[ProxyInfo] = None
	screenshot_task_running = False
	broadcaster_task: Optional[asyncio.Task] = None

	try:
		# Initialize AI Dove LLM
		llm = ChatAIDove(session_id=job.session_id or f'browser-{job.id}', timeout=120.0, max_retries=3)

		# Configure browser profile - force headless in Docker environment
		# For human intervention with visible browser, need to run locally or use VNC
		import os

		is_docker = os.path.exists('/.dockerenv') or os.environ.get('DOCKER_CONTAINER', False)

		proxy_settings: Optional[ProxySettings] = None
		if job.use_proxy_rotation and proxy_rotation_client is not None:
			for attempt in range(3):
				proxy_info = await proxy_rotation_client.get_next_proxy()
				if proxy_info is not None:
					break
				await asyncio.sleep(0.2 * (attempt + 1))

			if proxy_info is not None:
				job.proxy_id = proxy_info.id
				job.proxy_address = proxy_info.address
				proxy_settings = ProxySettings(
					server=proxy_info.address,
					username=proxy_info.username,
					password=proxy_info.password,
				)
				logger.info(f'Job {job.id}: Using rotating proxy id={proxy_info.id} addr={proxy_info.address}')
			else:
				logger.warning(f'Job {job.id}: Proxy rotation enabled but no proxy available')

		profile_kwargs: dict[str, Any] = {
			'headless': True if is_docker else job.headless,
			'disable_security': True,
		}
		if proxy_settings is not None:
			profile_kwargs['proxy'] = proxy_settings

		profile = BrowserProfile(**profile_kwargs)

		# Create browser session
		job.browser_session = BrowserSession(browser_profile=profile)

		# Create controller
		controller = Controller()

		# ============================================
		# Intent Analysis for Guaranteed Search Results
		# ============================================
		# Analyze the task to extract keywords, generate fallback strategies,
		# and ensure search results are always returned
		intent_analyzer = IntentAnalyzer(llm=llm)
		search_guarantee = SearchGuarantee(intent_analyzer)

		# Analyze the task
		analyzed_intent = None
		try:
			analyzed_intent = await intent_analyzer.analyze(job.task, use_llm=True)
			logger.info(
				f'Job {job.id}: Intent analysis complete - '
				f'keywords={analyzed_intent.keywords}, '
				f"primary='{analyzed_intent.primary_keyword}', "
				f"intent_type='{analyzed_intent.intent_type}', "
				f'strategies={len(analyzed_intent.fallback_strategies)}'
			)

			# Build enhanced task with fallback strategies
			full_task = search_guarantee.build_enhanced_task(analyzed_intent, job.task)
		except Exception as e:
			logger.warning(f'Job {job.id}: Intent analysis failed, using original task: {e}')
			full_task = job.task

		# Add URL prefix if provided
		if job.url:
			full_task = f'First navigate to {job.url}, then: {full_task}'

		# Enhanced task prompt for human intervention awareness
		if job.enable_human_intervention:
			full_task += """

IMPORTANT: If you encounter any of these situations, clearly state the issue:
- CAPTCHA or verification challenges (reCAPTCHA, hCaptcha, Cloudflare Turnstile)
- Login required
- Page not loading correctly  
- Cannot find expected content
- Need user confirmation before proceeding
- Any blocking issue

State the problem clearly so a human operator can assist."""

		# CAPTCHA detection patterns for automatic intervention
		captcha_patterns = [
			'recaptcha',
			'hcaptcha',
			'captcha',
			'turnstile',
			'challenge',
			'verification',
			'verify you are human',
			'cloudflare',
			'checking your browser',
			'access denied',
		]

		# Create agent
		agent = Agent(
			task=full_task,
			llm=llm,
			controller=controller,
			browser_session=job.browser_session,
			max_actions_per_step=10,
		)

		# Background task to periodically capture and broadcast screenshots
		screenshot_task_running = True

		async def screenshot_broadcaster():
			"""Periodically capture and broadcast screenshots while job is running."""
			step_count = 0
			captcha_check_count = 0
			while screenshot_task_running and job.status == JobStatus.RUNNING:
				try:
					# Capture current state
					current_url = await get_current_url(job.browser_session)
					if current_url and current_url not in job.urls_visited:
						job.urls_visited.append(current_url)

					screenshot = await capture_screenshot(job.browser_session)
					if screenshot:
						step_count += 1
						job.current_step = step_count
						job.progress = min(step_count / job.max_steps, 0.95)  # Cap at 95% until done

						await manager.broadcast(
							job.id,
							{
								'type': 'step_update',
								'job_id': job.id,
								'step': step_count,
								'progress': job.progress,
								'current_url': current_url,
								'screenshot': screenshot,
							},
						)
						logger.info(f'Job {job.id}: Broadcast screenshot (step {step_count})')

					# Auto-detect CAPTCHA and request human intervention
					if job.enable_human_intervention and job.auto_request_intervention:
						captcha_detected = await _detect_captcha_on_page(job.browser_session)
						if captcha_detected:
							captcha_check_count += 1
							# Only request intervention if CAPTCHA persists (avoid false positives)
							if captcha_check_count >= 2:
								if proxy_info is not None and proxy_rotation_client is not None:
									try:
										await proxy_rotation_client.record_captcha(proxy_info.id, captcha_detected)
									except Exception:
										pass
								logger.info(f'Job {job.id}: CAPTCHA detected, requesting human intervention')
								await request_human_intervention(
									job,
									InterventionType.CAPTCHA,
									f'CAPTCHA detected: {captcha_detected}. Please solve the verification challenge.',
									['Click on CAPTCHA', 'Solve verification', 'Skip if possible'],
								)
								captcha_check_count = 0  # Reset after requesting
						else:
							captcha_check_count = 0  # Reset if no CAPTCHA

				except Exception as e:
					logger.warning(f'Screenshot broadcast error: {e}')

				await asyncio.sleep(2)  # Capture every 2 seconds

		# Start screenshot broadcaster as background task
		broadcaster_task = asyncio.create_task(screenshot_broadcaster())

		# Run with timeout
		try:
			result = await asyncio.wait_for(agent.run(max_steps=job.max_steps), timeout=job.timeout_seconds)

			# Stop screenshot broadcaster
			screenshot_task_running = False
			broadcaster_task.cancel()
			try:
				await broadcaster_task
			except asyncio.CancelledError:
				pass

			# ============================================
			# Result Guarantee Logic - Never return "not found"
			# ============================================
			# Debug: Log result structure for troubleshooting
			logger.info(f'Job {job.id}: Raw result type: {type(result).__name__}')
			if hasattr(result, '__dict__'):
				logger.info(f'Job {job.id}: Result attributes: {list(result.__dict__.keys())[:10]}')
			if hasattr(result, 'final_result'):
				try:
					fr = result.final_result
					fr_val = fr() if callable(fr) else fr
					logger.info(f'Job {job.id}: final_result() returned: {str(fr_val)[:200] if fr_val else "None"}')
				except Exception as e:
					logger.info(f'Job {job.id}: final_result() error: {e}')
			if hasattr(result, 'history') and isinstance(result.history, list):
				logger.info(f'Job {job.id}: History has {len(result.history)} items')
				for i, hist in enumerate(result.history[-3:]):  # Last 3 items
					logger.info(f'Job {job.id}: History[{i}] result: {getattr(hist, "result", None)}')

			result_str = _extract_agent_result_text(result)
			logger.info(
				f'Job {job.id}: Extracted result length: {len(result_str)}, preview: {result_str[:300] if result_str else "EMPTY"}'
			)

			# Check for "not found" patterns in multiple languages
			not_found_patterns = [
				'not found',
				'no results',
				'cannot find',
				'could not find',
				'nothing found',
				'no matches',
				'no information',
				'찾을 수 없',
				'결과가 없',
				'검색 결과 없',
				'찾지 못',
				'정보를 찾을 수 없',
				'결과를 찾을 수 없',
			]

			result_lower = result_str.lower()
			is_not_found = (not result_str.strip()) or any(pattern in result_lower for pattern in not_found_patterns)

			if is_not_found and analyzed_intent:
				logger.info(f"Job {job.id}: Initial result indicates 'not found', attempting fallback strategies...")

				# Try fallback strategies
				fallback_attempted = False
				for strategy_info in analyzed_intent.fallback_strategies[1:4]:  # Skip first (already tried), try next 3
					fallback_query = strategy_info['query']
					strategy_name = strategy_info['strategy'].value

					logger.info(f"Job {job.id}: Trying fallback strategy '{strategy_name}' with query: '{fallback_query}'")

					# Build a new task with the fallback query
					fallback_task = f"""
이전 검색에서 결과를 찾지 못했습니다. 다른 방법으로 검색해주세요.

새로운 검색어: "{fallback_query}"

중요 지침:
1. 위의 새로운 검색어로 검색하세요
2. 완전히 일치하지 않더라도 관련된 정보를 찾아서 제공하세요
3. 절대로 "찾을 수 없다" 또는 "결과가 없다"고 말하지 마세요
4. 대신 찾은 가장 관련성 있는 정보를 제공하세요

Previous search found no results. Please try a different approach.

New search query: "{fallback_query}"

Important instructions:
1. Search with the new query above
2. Even if not an exact match, find and provide related information
3. NEVER say "not found" or "no results"
4. Instead, provide the most relevant information you can find
"""

					try:
						# Create a new agent for fallback
						fallback_agent = Agent(
							task=fallback_task,
							llm=llm,
							controller=controller,
							browser_session=job.browser_session,
							max_actions_per_step=10,
						)

						# Run with reduced steps for fallback
						fallback_result = await asyncio.wait_for(
							fallback_agent.run(max_steps=min(10, job.max_steps // 2)), timeout=job.timeout_seconds // 3
						)

						fallback_str = _extract_agent_result_text(fallback_result)

						# Check if fallback found something
						fallback_is_not_found = (not fallback_str.strip()) or any(
							pattern in fallback_str.lower() for pattern in not_found_patterns
						)

						if not fallback_is_not_found and fallback_str:
							logger.info(f"Job {job.id}: Fallback strategy '{strategy_name}' found results!")
							result_str = f"""검색 결과 (대체 검색어: "{fallback_query}" 사용):
Search Results (using alternative query: "{fallback_query}"):

{fallback_str}

참고: 원래 검색어로는 결과를 찾지 못해 관련 검색어로 검색한 결과입니다.
Note: Original query returned no results, so alternative search was performed."""
							fallback_attempted = True
							break

					except asyncio.TimeoutError:
						logger.warning(f"Job {job.id}: Fallback strategy '{strategy_name}' timed out")
					except Exception as e:
						logger.warning(f"Job {job.id}: Fallback strategy '{strategy_name}' failed: {e}")

				# If all fallbacks failed, provide a helpful message instead of "not found"
				if not fallback_attempted:
					logger.info(f'Job {job.id}: All fallback strategies exhausted, providing helpful response')
					result_str = f"""검색 결과를 찾기 어려웠습니다. 다음을 시도해 보세요:
Search was challenging. Here are some suggestions:

시도한 검색어 / Queries attempted:
- {analyzed_intent.original_query}
- {analyzed_intent.primary_keyword}
{chr(10).join('- ' + s['query'] for s in analyzed_intent.fallback_strategies[1:4])}

추천 검색 방법 / Recommended approaches:
1. 검색어를 더 구체적으로 변경해 보세요 / Try more specific keywords
2. 다른 검색 엔진이나 사이트를 이용해 보세요 / Try different search engines or sites
3. 관련 키워드: {', '.join(analyzed_intent.keywords[:5])} / Related keywords

분석된 의도 / Analyzed intent:
- 주요 키워드 / Primary keyword: {analyzed_intent.primary_keyword}
- 검색 유형 / Search type: {analyzed_intent.intent_type}
- 언어 / Language: {analyzed_intent.language}"""

			job.result = result_str if result_str else 'Task completed successfully'
			job.status = JobStatus.COMPLETED
			job.progress = 1.0

			# Capture final screenshot
			final_screenshot = await capture_screenshot(job.browser_session)

			# Broadcast completion
			await manager.broadcast(
				job.id,
				{
					'type': 'completed',
					'job_id': job.id,
					'result': job.result,
					'urls_visited': job.urls_visited,
					'screenshot': final_screenshot,
				},
			)

		except asyncio.TimeoutError:
			if job.status != JobStatus.CANCELLED:
				screenshot_task_running = False
				if broadcaster_task is not None and not broadcaster_task.done():
					broadcaster_task.cancel()
					try:
						await broadcaster_task
					except asyncio.CancelledError:
						pass

				job.error = f'Task timed out after {job.timeout_seconds} seconds'
				job.status = JobStatus.FAILED

				await manager.broadcast(
					job.id,
					{
						'type': 'failed',
						'job_id': job.id,
						'error': job.error,
					},
				)

	except Exception as e:
		if job.status != JobStatus.CANCELLED:
			logger.exception(f'Job {job.id} failed: {e}')
			job.error = str(e)
			job.status = JobStatus.FAILED

			await manager.broadcast(
				job.id,
				{
					'type': 'failed',
					'job_id': job.id,
					'error': job.error,
				},
			)
		else:
			logger.info(f'Job {job.id} cancelled')

	finally:
		screenshot_task_running = False
		if broadcaster_task is not None and not broadcaster_task.done():
			broadcaster_task.cancel()
			try:
				await broadcaster_task
			except asyncio.CancelledError:
				pass

		if proxy_info is not None and proxy_rotation_client is not None and job.status in [JobStatus.COMPLETED, JobStatus.FAILED]:
			elapsed_ms = int((time.perf_counter() - job_start_perf) * 1000)
			if job.status == JobStatus.COMPLETED:
				await proxy_rotation_client.record_success(proxy_info.id, latency_ms=elapsed_ms)
			else:
				await proxy_rotation_client.record_failure(proxy_info.id, reason=(job.error or '')[:500])

		job.completed_at = datetime.now()

		# Clean up browser session
		if job.browser_session:
			try:
				await job.browser_session.stop()
			except Exception as e:
				logger.warning(f'Error closing browser session: {e}')
			job.browser_session = None


# ============================================
# FastAPI Application
# ============================================


@asynccontextmanager
async def lifespan(app: FastAPI):
	"""Application lifespan handler."""
	logger.info('Browser-Use API Server with Human-in-the-Loop starting up...')
	global proxy_rotation_client
	if PROXY_ROTATION_ENABLED:
		proxy_rotation_client = ProxyRotationClient(
			base_url=PROXY_ROTATION_URL,
			timeout=PROXY_ROTATION_TIMEOUT_SECONDS,
			enabled=True,
		)
		healthy = await proxy_rotation_client.health_check()
		logger.info(f'Proxy rotation enabled: url={PROXY_ROTATION_URL} healthy={healthy}')

	yield
	logger.info('Browser-Use API Server shutting down...')

	if proxy_rotation_client is not None:
		await proxy_rotation_client.close()
		proxy_rotation_client = None

	# Cancel all running jobs
	for job in jobs.values():
		if job.status in [JobStatus.RUNNING, JobStatus.WAITING_HUMAN]:
			job.status = JobStatus.CANCELLED
			job.error = 'Server shutdown'

			if job.browser_session:
				try:
					await job.browser_session.stop()
				except:
					pass


app = FastAPI(
	title='Browser-Use API with Human-in-the-Loop',
	description='AI-powered browser automation API with real-time human intervention support',
	version='2.0.0',
	lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
	CORSMiddleware,
	allow_origins=['*'],
	allow_credentials=True,
	allow_methods=['*'],
	allow_headers=['*'],
)


# ============================================
# WebSocket Endpoints
# ============================================


@app.websocket('/ws/{job_id}')
async def websocket_endpoint(websocket: WebSocket, job_id: str):
	"""
	WebSocket endpoint for real-time job updates and human intervention.

	Message types received from client:
	- {"type": "intervention_response", "action": HumanAction}
	- {"type": "request_screenshot"}
	- {"type": "manual_intervention", "intervention_type": str, "reason": str}

	Message types sent to client:
	- {"type": "step_update", ...}
	- {"type": "intervention_requested", ...}
	- {"type": "completed", ...}
	- {"type": "failed", ...}
	- {"type": "screenshot", "data": base64_string}
	"""
	await manager.connect(websocket, job_id)

	try:
		while True:
			data = await websocket.receive_json()

			if job_id not in jobs:
				await websocket.send_json({'type': 'error', 'message': 'Job not found'})
				continue

			job = jobs[job_id]

			if data.get('type') == 'intervention_response':
				# Human provided a response to intervention request
				action_data = data.get('action', {})
				job.intervention.response = HumanAction(**action_data)
				job.intervention.response_event.set()
				job.intervention.requested = False
				job.status = JobStatus.RUNNING

				await websocket.send_json({'type': 'intervention_accepted', 'message': 'Action received and will be executed'})

			elif data.get('type') == 'request_screenshot':
				# Client requesting current screenshot
				if job.browser_session:
					screenshot = await capture_screenshot(job.browser_session)
					current_url = await get_current_url(job.browser_session)
					await websocket.send_json({'type': 'screenshot', 'data': screenshot, 'current_url': current_url})

			elif data.get('type') == 'manual_intervention':
				# Client manually requesting intervention mode
				intervention_type = InterventionType(data.get('intervention_type', 'custom'))
				reason = data.get('reason', 'Manual intervention requested')

				# Pause the agent and wait for human action
				action = await request_human_intervention(job, intervention_type, reason, data.get('suggested_actions', []))

				if action:
					success = await execute_human_action(job, action)
					await websocket.send_json({'type': 'intervention_result', 'success': success})

	except WebSocketDisconnect:
		manager.disconnect(websocket, job_id)
	except Exception as e:
		logger.error(f'WebSocket error for job {job_id}: {e}')
		manager.disconnect(websocket, job_id)


# ============================================
# REST API Endpoints
# ============================================


@app.get('/health', response_model=HealthResponse)
async def health_check():
	"""Health check endpoint."""
	uptime = (datetime.now() - start_time).total_seconds()
	active = sum(1 for j in jobs.values() if j.status in [JobStatus.RUNNING, JobStatus.PENDING])
	waiting = sum(1 for j in jobs.values() if j.status == JobStatus.WAITING_HUMAN)

	return HealthResponse(
		status='healthy', version='2.0.0', uptime_seconds=uptime, active_jobs=active, waiting_intervention=waiting
	)


@app.post('/browse', response_model=BrowseResponse)
async def browse(request: BrowseRequest, background_tasks: BackgroundTasks):
	"""
	Start a browser automation task with optional human intervention support.

	Connect to WebSocket at /ws/{job_id} to receive real-time updates and
	provide human intervention when requested.
	"""
	job_id = str(uuid.uuid4())[:8]

	job = Job(
		id=job_id,
		task=request.task,
		url=request.url,
		session_id=request.session_id,
		max_steps=request.max_steps,
		timeout_seconds=request.timeout_seconds,
		headless=request.headless,
		enable_human_intervention=request.enable_human_intervention,
		auto_request_intervention=request.auto_request_intervention,
		use_proxy_rotation=request.use_proxy_rotation,
	)

	jobs[job_id] = job

	# Start task in background
	background_tasks.add_task(run_browser_task, job)

	logger.info(f'Created job {job_id}: {request.task[:50]}... (intervention: {request.enable_human_intervention})')

	return BrowseResponse(
		job_id=job_id,
		status='pending',
		message='Task started. Connect to /ws/{job_id} for real-time updates and human intervention.',
		started_at=datetime.now().isoformat(),
	)


@app.get('/jobs/{job_id}', response_model=JobStatusResponse)
async def get_job_status(job_id: str):
	"""Get the status of a browser automation job including intervention state."""
	if job_id not in jobs:
		raise HTTPException(status_code=404, detail=f'Job {job_id} not found')

	job = jobs[job_id]

	return JobStatusResponse(
		job_id=job.id,
		status=job.status.value,
		progress=job.progress,
		current_step=job.current_step,
		max_steps=job.max_steps,
		result=job.result,
		error=job.error,
		urls_visited=job.urls_visited,
		started_at=job.started_at.isoformat() if job.started_at else None,
		completed_at=job.completed_at.isoformat() if job.completed_at else None,
		intervention_requested=job.intervention.requested,
		intervention_type=job.intervention.type.value if job.intervention.type else None,
		intervention_reason=job.intervention.reason,
		intervention_screenshot=job.intervention.screenshot,
		current_url=job.intervention.current_url,
	)


@app.post('/jobs/{job_id}/intervene')
async def submit_intervention(job_id: str, action: HumanAction):
	"""Submit a human intervention action for a job waiting for intervention."""
	if job_id not in jobs:
		raise HTTPException(status_code=404, detail=f'Job {job_id} not found')

	job = jobs[job_id]

	if job.status != JobStatus.WAITING_HUMAN:
		raise HTTPException(status_code=400, detail=f'Job is not waiting for intervention. Current status: {job.status.value}')

	job.intervention.response = action
	job.intervention.response_event.set()
	job.intervention.requested = False

	return {'message': 'Intervention action submitted', 'action_type': action.action_type}


@app.post('/jobs/{job_id}/request-intervention')
async def manual_intervention_request(
	job_id: str, intervention_type: InterventionType = InterventionType.CUSTOM, reason: str = 'Manual intervention requested'
):
	"""Manually request human intervention for a running job."""
	if job_id not in jobs:
		raise HTTPException(status_code=404, detail=f'Job {job_id} not found')

	job = jobs[job_id]

	if job.status != JobStatus.RUNNING:
		raise HTTPException(
			status_code=400, detail=f'Can only request intervention for running jobs. Current status: {job.status.value}'
		)

	# Set intervention state
	job.status = JobStatus.WAITING_HUMAN
	job.intervention.requested = True
	job.intervention.type = intervention_type
	job.intervention.reason = reason
	job.intervention.response_event.clear()

	# Capture current state
	if job.browser_session:
		job.intervention.screenshot = await capture_screenshot(job.browser_session)
		job.intervention.current_url = await get_current_url(job.browser_session)

	# Notify via WebSocket
	await manager.broadcast(
		job.id,
		{
			'type': 'intervention_requested',
			'job_id': job.id,
			'intervention_type': intervention_type.value,
			'reason': reason,
			'screenshot': job.intervention.screenshot,
			'current_url': job.intervention.current_url,
		},
	)

	return {
		'message': 'Intervention requested',
		'job_id': job_id,
		'intervention_type': intervention_type.value,
		'screenshot': job.intervention.screenshot,
		'current_url': job.intervention.current_url,
	}


@app.get('/jobs/{job_id}/screenshot')
async def get_screenshot(job_id: str):
	"""Get current screenshot from the browser session."""
	if job_id not in jobs:
		raise HTTPException(status_code=404, detail=f'Job {job_id} not found')

	job = jobs[job_id]

	if not job.browser_session:
		raise HTTPException(status_code=400, detail='No active browser session')

	screenshot = await capture_screenshot(job.browser_session)
	current_url = await get_current_url(job.browser_session)

	return {'screenshot': screenshot, 'current_url': current_url}


@app.delete('/jobs/{job_id}')
async def cancel_job(job_id: str):
	"""Cancel a running job."""
	if job_id not in jobs:
		raise HTTPException(status_code=404, detail=f'Job {job_id} not found')

	job = jobs[job_id]

	if job.status in [JobStatus.RUNNING, JobStatus.WAITING_HUMAN, JobStatus.PENDING]:
		job.status = JobStatus.CANCELLED
		job.error = 'Cancelled by user'
		job.completed_at = datetime.now()

		# Close browser session
		if job.browser_session:
			try:
				await job.browser_session.stop()
			except:
				pass
			job.browser_session = None

		# Notify via WebSocket
		await manager.broadcast(
			job.id,
			{
				'type': 'cancelled',
				'job_id': job.id,
			},
		)

		return {'message': f'Job {job_id} cancelled'}
	else:
		return {'message': f'Job {job_id} already finished with status: {job.status.value}'}


@app.get('/jobs')
async def list_jobs(status: Optional[str] = None, limit: int = 20):
	"""List all jobs, optionally filtered by status."""
	filtered_jobs = list(jobs.values())

	if status:
		filtered_jobs = [j for j in filtered_jobs if j.status.value == status]

	# Sort by started_at (most recent first)
	filtered_jobs.sort(key=lambda j: j.started_at or datetime.min, reverse=True)

	return [
		{
			'job_id': j.id,
			'task': j.task[:100],
			'status': j.status.value,
			'progress': j.progress,
			'intervention_requested': j.intervention.requested,
			'intervention_type': j.intervention.type.value if j.intervention.type else None,
			'started_at': j.started_at.isoformat() if j.started_at else None,
			'completed_at': j.completed_at.isoformat() if j.completed_at else None,
		}
		for j in filtered_jobs[:limit]
	]


@app.post('/browse/sync', response_model=BrowseResponse)
async def browse_sync(request: BrowseRequest):
	"""
	Execute a browser automation task synchronously.

	Note: Human intervention is not available in sync mode. For human intervention,
	use the async /browse endpoint with WebSocket connection.
	"""
	job_id = str(uuid.uuid4())[:8]

	# Disable human intervention for sync mode
	job = Job(
		id=job_id,
		task=request.task,
		url=request.url,
		session_id=request.session_id,
		max_steps=request.max_steps,
		timeout_seconds=request.timeout_seconds,
		headless=True,  # Force headless for sync mode
		enable_human_intervention=False,
		auto_request_intervention=False,
		use_proxy_rotation=request.use_proxy_rotation,
	)

	jobs[job_id] = job

	# Run synchronously
	await run_browser_task(job)

	return BrowseResponse(
		job_id=job_id,
		status=job.status.value,
		message=job.result or job.error or 'Task completed',
		result=job.result,
		steps_taken=job.current_step,
		urls_visited=job.urls_visited,
		screenshots=job.screenshots,
		error=job.error,
		started_at=job.started_at.isoformat() if job.started_at else None,
		completed_at=job.completed_at.isoformat() if job.completed_at else None,
	)


# ============================================
# API Key Provisioning Endpoints
# ============================================


class APIKeyProvisionRequest(BaseModel):
	"""Request to provision an API key from a provider."""

	provider: str = Field(
		..., description='Provider name: openai, anthropic, google, openrouter, together_ai, perplexity, brave_search, tavily'
	)
	key_name: Optional[str] = Field('NewsInsight-AutoGenerated', description='Name for the generated API key')
	auto_save: bool = Field(True, description='Automatically save the key to system settings')
	timeout_seconds: int = Field(300, description='Timeout for provisioning process', ge=60, le=600)
	headless: bool = Field(False, description='Run browser in headless mode (False recommended for login)')


class APIKeyProvisionResponse(BaseModel):
	"""Response from API key provisioning."""

	job_id: str
	status: str
	provider: str
	message: str
	api_key_masked: Optional[str] = None
	saved_to_settings: bool = False
	error: Optional[str] = None
	requires_intervention: bool = False
	intervention_type: Optional[str] = None


@app.get('/api-key/providers')
async def list_supported_providers():
	"""
	List all supported API providers for auto-provisioning.

	Returns provider names and their API key page URLs.
	"""
	providers = []
	for provider in APIProvider:
		if provider != APIProvider.UNKNOWN:
			providers.append(
				{
					'name': provider.value,
					'display_name': provider.value.replace('_', ' ').title(),
					'api_keys_url': PROVIDER_URLS.get(provider, ''),
				}
			)
	return {'providers': providers}


@app.get('/api-key/rate-limit')
async def get_api_key_rate_limit_info(http_request: Request):
	"""
	Get rate limit information for API key provisioning.

	Returns current rate limit settings and remaining quota for the client.
	"""
	client_ip = get_client_ip(http_request)

	# Peek at current status without consuming a request
	stats = await api_key_rate_limiter.get_stats()

	# Get remaining for this IP
	now = time.time()
	window_start = now - api_key_rate_limiter.window_seconds

	async with api_key_rate_limiter._lock:
		ip_requests = [ts for ts in api_key_rate_limiter._requests.get(client_ip, []) if ts > window_start]
		remaining = max(0, api_key_rate_limiter.requests_per_minute - len(ip_requests))

	return {
		'limit': api_key_rate_limiter.requests_per_minute,
		'remaining': remaining,
		'window_seconds': api_key_rate_limiter.window_seconds,
		'client_ip': client_ip,
		'stats': stats,
	}


@app.post('/api-key/provision', response_model=APIKeyProvisionResponse)
async def provision_api_key(
	request: APIKeyProvisionRequest,
	background_tasks: BackgroundTasks,
	http_request: Request,
):
	"""
	Start an API key provisioning task.

	This will:
	1. Launch a browser to the provider's API key page
	2. Handle login with human intervention if needed
	3. Generate a new API key
	4. Extract and optionally save the key to system settings

	Connect to WebSocket at /ws/{job_id} for real-time updates and
	to provide human intervention (login, 2FA) when requested.

	Rate Limited: {API_KEY_PROVISION_RATE_LIMIT} requests per minute per IP.
	"""
	# Check rate limit
	client_ip = get_client_ip(http_request)
	is_allowed, rate_info = await api_key_rate_limiter.is_allowed(client_ip)

	if not is_allowed:
		logger.warning(f'Rate limit exceeded for IP {client_ip} on API key provisioning')

		# Audit log rate limit event
		await provisioning_audit_logger.log_event(
			event_type='rate_limited',
			provider=request.provider,
			client_ip=client_ip,
			job_id='N/A',
			success=False,
			user_agent=http_request.headers.get('User-Agent'),
			error_message=f'Rate limit exceeded: {rate_info["limit"]} requests per minute',
		)

		raise HTTPException(
			status_code=429,
			detail={
				'error': 'Too Many Requests',
				'message': f'Rate limit exceeded. Maximum {rate_info["limit"]} requests per minute.',
				'retry_after': rate_info.get('retry_after', 60),
			},
			headers={
				'Retry-After': str(rate_info.get('retry_after', 60)),
				'X-RateLimit-Limit': str(rate_info['limit']),
				'X-RateLimit-Remaining': '0',
				'X-RateLimit-Reset': str(rate_info.get('reset', 0)),
			},
		)

	logger.info(f'API key provisioning request from {client_ip} (remaining: {rate_info["remaining"]})')

	# Validate provider
	try:
		provider = APIProvider(request.provider.lower())
		if provider == APIProvider.UNKNOWN:
			raise ValueError('Unknown provider')
	except ValueError:
		supported = [p.value for p in APIProvider if p != APIProvider.UNKNOWN]
		raise HTTPException(
			status_code=400,
			detail=f'Unknown provider: {request.provider}. Supported providers: {supported}',
		)

	job_id = str(uuid.uuid4())[:8]

	# Create job for tracking
	job = Job(
		id=job_id,
		task=f'API Key Provisioning for {provider.value}',
		url=PROVIDER_URLS.get(provider, ''),
		session_id=f'provision-{job_id}',
		max_steps=50,
		timeout_seconds=request.timeout_seconds,
		headless=request.headless,
		enable_human_intervention=True,
		auto_request_intervention=True,
		use_proxy_rotation=False,  # Don't use proxy for provider sites
	)

	jobs[job_id] = job

	# Get user agent for audit logging
	user_agent = http_request.headers.get('User-Agent')

	# Start provisioning in background
	async def run_provisioning():
		job.status = JobStatus.RUNNING
		job.started_at = datetime.now()

		# Audit log: provisioning started
		await provisioning_audit_logger.log_event(
			event_type='provision_started',
			provider=provider.value,
			client_ip=client_ip,
			job_id=job_id,
			success=True,
			user_agent=user_agent,
			details={
				'key_name': request.key_name or 'NewsInsight-AutoGenerated',
				'auto_save': request.auto_save,
				'headless': request.headless,
			},
		)

		try:
			# Initialize browser session
			import os

			is_docker = os.path.exists('/.dockerenv') or os.environ.get('DOCKER_CONTAINER', False)

			profile = BrowserProfile(
				headless=True if is_docker else request.headless,
				disable_security=True,
			)
			job.browser_session = BrowserSession(browser_profile=profile)

			# Initialize LLM
			llm = ChatAIDove(session_id=f'provision-{job_id}', timeout=120.0, max_retries=3)

			# Create provisioner with WebSocket broadcast
			async def broadcast_to_job(message: dict):
				message['job_id'] = job_id
				await manager.broadcast(job_id, message)

			provisioner = ApiKeyProvisioner(
				browser_session=job.browser_session,
				llm=llm,
				websocket_broadcast=broadcast_to_job,
			)

			# Run provisioning
			result = await provisioner.provision(
				provider=provider,
				key_name=request.key_name or 'NewsInsight-AutoGenerated',
				auto_save=request.auto_save,
				timeout_seconds=request.timeout_seconds,
			)

			# Update job based on result
			if result.get('status') == 'completed':
				job.status = JobStatus.COMPLETED
				job.result = result.get('message', 'API key provisioned successfully')

				# Audit log: provisioning completed
				await provisioning_audit_logger.log_event(
					event_type='provision_completed',
					provider=provider.value,
					client_ip=client_ip,
					job_id=job_id,
					success=True,
					user_agent=user_agent,
					details={
						'saved_to_settings': result.get('saved_to_settings', False),
						'key_masked': result.get('api_key_masked'),
					},
				)

			elif result.get('requires_intervention'):
				job.status = JobStatus.WAITING_HUMAN
				job.intervention.requested = True
				job.intervention.type = InterventionType.LOGIN
				job.intervention.reason = result.get('message', 'Human intervention required')

				# Audit log: login required
				await provisioning_audit_logger.log_event(
					event_type='login_required',
					provider=provider.value,
					client_ip=client_ip,
					job_id=job_id,
					success=True,
					user_agent=user_agent,
					details={'reason': result.get('message')},
				)

			else:
				job.status = JobStatus.FAILED
				job.error = result.get('error', 'Unknown error')

				# Audit log: provisioning failed
				await provisioning_audit_logger.log_event(
					event_type='provision_failed',
					provider=provider.value,
					client_ip=client_ip,
					job_id=job_id,
					success=False,
					user_agent=user_agent,
					error_message=result.get('error', 'Unknown error'),
				)

			# Broadcast final status
			await manager.broadcast(
				job_id,
				{
					'type': 'provisioning_complete' if result.get('status') == 'completed' else 'provisioning_update',
					'job_id': job_id,
					'status': result.get('status'),
					'provider': provider.value,
					'api_key_masked': result.get('api_key_masked'),
					'saved_to_settings': result.get('saved_to_settings', False),
					'error': result.get('error'),
					'message': result.get('message'),
				},
			)

		except Exception as e:
			logger.exception(f'Provisioning job {job_id} failed: {e}')
			job.status = JobStatus.FAILED
			job.error = str(e)

			# Audit log: exception during provisioning
			await provisioning_audit_logger.log_event(
				event_type='provision_failed',
				provider=provider.value,
				client_ip=client_ip,
				job_id=job_id,
				success=False,
				user_agent=user_agent,
				error_message=str(e),
				details={'exception_type': type(e).__name__},
			)

			await manager.broadcast(
				job_id,
				{
					'type': 'provisioning_failed',
					'job_id': job_id,
					'error': str(e),
				},
			)

		finally:
			job.completed_at = datetime.now()
			if job.browser_session:
				try:
					await job.browser_session.stop()
				except Exception as e:
					logger.warning(f'Error closing browser session: {e}')
				job.browser_session = None

	background_tasks.add_task(run_provisioning)

	logger.info(f'Started API key provisioning job {job_id} for {provider.value}')

	return APIKeyProvisionResponse(
		job_id=job_id,
		status='pending',
		provider=provider.value,
		message=f'API key provisioning started for {provider.value}. Connect to /ws/{job_id} for real-time updates.',
		requires_intervention=False,
	)


@app.post('/api-key/provision/{job_id}/login-complete')
async def notify_login_complete(job_id: str, http_request: Request):
	"""
	Notify that login has been completed for a provisioning job.

	Call this after completing login in the browser to continue
	the API key generation process.
	"""
	if job_id not in jobs:
		raise HTTPException(status_code=404, detail=f'Job {job_id} not found')

	job = jobs[job_id]

	if job.status != JobStatus.WAITING_HUMAN:
		raise HTTPException(status_code=400, detail=f'Job is not waiting for login. Current status: {job.status.value}')

	# Signal that login is complete
	job.intervention.response = HumanAction(
		action_type='login_complete',
		message='Login completed by user',
	)
	job.intervention.response_event.set()
	job.intervention.requested = False
	job.status = JobStatus.RUNNING

	# Audit log: login completed
	client_ip = get_client_ip(http_request)
	provider = job.task.replace('API Key Provisioning for ', '') if job.task else 'unknown'
	await provisioning_audit_logger.log_event(
		event_type='login_completed',
		provider=provider,
		client_ip=client_ip,
		job_id=job_id,
		success=True,
		user_agent=http_request.headers.get('User-Agent'),
	)

	await manager.broadcast(
		job_id,
		{
			'type': 'login_complete',
			'job_id': job_id,
			'message': 'Login completed, continuing with API key generation...',
		},
	)

	return {'message': 'Login completion acknowledged', 'job_id': job_id}


@app.post('/api-key/provision/{job_id}/submit-2fa')
async def submit_2fa_code(job_id: str, code: str, http_request: Request):
	"""
	Submit a 2FA code for a provisioning job.

	Provide the verification code received via SMS or authenticator app.
	"""
	if job_id not in jobs:
		raise HTTPException(status_code=404, detail=f'Job {job_id} not found')

	job = jobs[job_id]

	if job.status != JobStatus.WAITING_HUMAN:
		raise HTTPException(status_code=400, detail=f'Job is not waiting for 2FA. Current status: {job.status.value}')

	# Provide 2FA code
	job.intervention.response = HumanAction(
		action_type='type',
		value=code,
		message='2FA code provided by user',
	)
	job.intervention.response_event.set()
	job.intervention.requested = False
	job.status = JobStatus.RUNNING

	# Audit log: 2FA completed
	client_ip = get_client_ip(http_request)
	provider = job.task.replace('API Key Provisioning for ', '') if job.task else 'unknown'
	await provisioning_audit_logger.log_event(
		event_type='twofa_completed',
		provider=provider,
		client_ip=client_ip,
		job_id=job_id,
		success=True,
		user_agent=http_request.headers.get('User-Agent'),
	)

	await manager.broadcast(
		job_id,
		{
			'type': '2fa_submitted',
			'job_id': job_id,
			'message': '2FA code submitted, continuing...',
		},
	)

	return {'message': '2FA code submitted', 'job_id': job_id}


if __name__ == '__main__':
	import uvicorn

	uvicorn.run(app, host='0.0.0.0', port=8500)
