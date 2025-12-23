"""
Intent Analyzer for Browser-Use API

Provides intent analysis, keyword extraction, and search guarantees
for browser automation tasks.
"""

import asyncio
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Optional
from enum import Enum

logger = logging.getLogger(__name__)


class IntentType(str, Enum):
	"""Types of user intents for browser tasks."""

	SEARCH = 'search'
	NAVIGATE = 'navigate'
	EXTRACT = 'extract'
	INTERACT = 'interact'
	MONITOR = 'monitor'
	API_KEY_PROVISION = 'api_key_provision'  # API 키 자동 발급
	UNKNOWN = 'unknown'


class APIProvider(str, Enum):
	"""Supported API providers for auto-provisioning."""

	OPENAI = 'openai'
	ANTHROPIC = 'anthropic'
	GOOGLE = 'google'
	OPENROUTER = 'openrouter'
	TOGETHER_AI = 'together_ai'
	PERPLEXITY = 'perplexity'
	BRAVE_SEARCH = 'brave_search'
	TAVILY = 'tavily'
	UNKNOWN = 'unknown'


# Provider detection keywords mapping
PROVIDER_KEYWORDS = {
	APIProvider.OPENAI: ['openai', 'gpt', 'chatgpt', 'gpt-4', 'gpt-3', 'dall-e', 'whisper'],
	APIProvider.ANTHROPIC: ['anthropic', 'claude', 'sonnet', 'opus', 'haiku'],
	APIProvider.GOOGLE: ['google', 'gemini', 'palm', 'bard', 'vertex'],
	APIProvider.OPENROUTER: ['openrouter', 'open router'],
	APIProvider.TOGETHER_AI: ['together', 'together ai', 'togetherai'],
	APIProvider.PERPLEXITY: ['perplexity', 'pplx'],
	APIProvider.BRAVE_SEARCH: ['brave', 'brave search'],
	APIProvider.TAVILY: ['tavily'],
}

# Provider URLs for API key pages
PROVIDER_URLS = {
	APIProvider.OPENAI: 'https://platform.openai.com/api-keys',
	APIProvider.ANTHROPIC: 'https://console.anthropic.com/settings/keys',
	APIProvider.GOOGLE: 'https://aistudio.google.com/app/apikey',
	APIProvider.OPENROUTER: 'https://openrouter.ai/keys',
	APIProvider.TOGETHER_AI: 'https://api.together.xyz/settings/api-keys',
	APIProvider.PERPLEXITY: 'https://www.perplexity.ai/settings/api',
	APIProvider.BRAVE_SEARCH: 'https://api.search.brave.com/app/keys',
	APIProvider.TAVILY: 'https://app.tavily.com/home',
}


@dataclass
class FallbackStrategy:
	"""A fallback search strategy."""

	description: str
	keywords: list[str]
	search_engine: str = 'google'
	priority: int = 0


@dataclass
class AnalyzedIntent:
	"""Result of intent analysis."""

	original_task: str
	intent_type: IntentType
	keywords: list[str]
	primary_keyword: str
	fallback_strategies: list[FallbackStrategy] = field(default_factory=list)
	confidence: float = 0.0
	entities: dict[str, list[str]] = field(default_factory=dict)


class IntentAnalyzer:
	"""
	Analyzes browser automation tasks to extract intent, keywords,
	and generate fallback strategies.
	"""

	def __init__(self, llm: Optional[Any] = None):
		self.llm = llm
		self._keyword_patterns = [
			r'"([^"]+)"',  # Quoted strings
			r"'([^']+)'",  # Single-quoted strings
			r'\b(?:search|find|look for|get|fetch)\s+(?:for\s+)?(.+?)(?:\s+on|\s+from|\s+in|$)',
		]

	def _extract_keywords_basic(self, text: str) -> list[str]:
		"""Extract keywords using basic pattern matching."""
		keywords = []

		# Extract quoted strings first
		for pattern in self._keyword_patterns[:2]:
			matches = re.findall(pattern, text, re.IGNORECASE)
			keywords.extend(matches)

		# Extract search terms
		for pattern in self._keyword_patterns[2:]:
			matches = re.findall(pattern, text, re.IGNORECASE)
			keywords.extend(matches)

		# Clean and dedupe
		cleaned = []
		seen = set()
		for kw in keywords:
			kw = kw.strip().lower()
			if kw and kw not in seen and len(kw) > 2:
				seen.add(kw)
				cleaned.append(kw)

		return cleaned

	def _detect_intent_type(self, text: str) -> IntentType:
		"""Detect the type of intent from the task description."""
		text_lower = text.lower()

		# API Key provisioning detection (highest priority)
		api_key_keywords = [
			'api key',
			'api 키',
			'apikey',
			'api-key',
			'키 발급',
			'키발급',
			'key 발급',
			'발급해',
			'발급 해',
			'register api',
			'create api',
			'generate key',
			'get key',
			'등록해',
			'설정해',
			'setup api',
			'configure api',
		]
		if any(w in text_lower for w in api_key_keywords):
			return IntentType.API_KEY_PROVISION

		if any(w in text_lower for w in ['search', 'find', 'look for', 'query']):
			return IntentType.SEARCH
		elif any(w in text_lower for w in ['navigate', 'go to', 'open', 'visit']):
			return IntentType.NAVIGATE
		elif any(w in text_lower for w in ['extract', 'scrape', 'get data', 'collect']):
			return IntentType.EXTRACT
		elif any(w in text_lower for w in ['click', 'fill', 'submit', 'login', 'interact']):
			return IntentType.INTERACT
		elif any(w in text_lower for w in ['monitor', 'watch', 'track', 'wait for']):
			return IntentType.MONITOR

		return IntentType.UNKNOWN

	def detect_api_provider(self, text: str) -> APIProvider:
		"""Detect which API provider the user is referring to."""
		text_lower = text.lower()

		for provider, keywords in PROVIDER_KEYWORDS.items():
			if any(kw in text_lower for kw in keywords):
				return provider

		return APIProvider.UNKNOWN

	def get_provider_url(self, provider: APIProvider) -> str:
		"""Get the API key management URL for a provider."""
		return PROVIDER_URLS.get(provider, '')

	def _generate_fallback_strategies(self, keywords: list[str], intent_type: IntentType) -> list[FallbackStrategy]:
		"""Generate fallback search strategies."""
		strategies = []

		if not keywords:
			return strategies

		primary = keywords[0] if keywords else ''

		# Strategy 1: Direct search
		strategies.append(
			FallbackStrategy(
				description=f"Direct search for '{primary}'",
				keywords=[primary],
				search_engine='google',
				priority=1,
			)
		)

		# Strategy 2: All keywords combined
		if len(keywords) > 1:
			strategies.append(
				FallbackStrategy(
					description=f'Combined search: {" ".join(keywords[:3])}',
					keywords=keywords[:3],
					search_engine='google',
					priority=2,
				)
			)

		# Strategy 3: News-specific search
		if intent_type == IntentType.SEARCH:
			strategies.append(
				FallbackStrategy(
					description=f"News search for '{primary}'",
					keywords=[f'{primary} news', f'{primary} latest'],
					search_engine='google_news',
					priority=3,
				)
			)

		return strategies

	async def analyze(self, task: str, use_llm: bool = True) -> AnalyzedIntent:
		"""
		Analyze a task to extract intent and keywords.

		Args:
		    task: The browser automation task description
		    use_llm: Whether to use LLM for enhanced analysis

		Returns:
		    AnalyzedIntent with extracted information
		"""
		# Basic extraction
		keywords = self._extract_keywords_basic(task)
		intent_type = self._detect_intent_type(task)

		# If we have LLM and use_llm is True, try enhanced analysis
		if use_llm and self.llm is not None:
			try:
				enhanced = await self._analyze_with_llm(task)
				if enhanced:
					# Merge LLM keywords with basic extraction
					all_keywords = list(set(keywords + enhanced.get('keywords', [])))
					keywords = all_keywords[:10]  # Limit to top 10

					if enhanced.get('intent_type'):
						try:
							intent_type = IntentType(enhanced['intent_type'])
						except ValueError:
							pass
			except Exception as e:
				logger.warning(f'LLM analysis failed, using basic extraction: {e}')

		# Determine primary keyword
		primary_keyword = keywords[0] if keywords else task.split()[0] if task.split() else ''

		# Generate fallback strategies
		strategies = self._generate_fallback_strategies(keywords, intent_type)

		return AnalyzedIntent(
			original_task=task,
			intent_type=intent_type,
			keywords=keywords,
			primary_keyword=primary_keyword,
			fallback_strategies=strategies,
			confidence=0.8 if keywords else 0.5,
		)

	async def _analyze_with_llm(self, task: str) -> dict[str, Any]:
		"""Use LLM for enhanced intent analysis."""
		if self.llm is None:
			return {}

		prompt = f"""Analyze this browser automation task and extract:
1. Main keywords (for search)
2. Intent type (search, navigate, extract, interact, monitor)
3. Target entities (websites, products, etc.)

Task: {task}

Respond with JSON:
{{"keywords": ["keyword1", "keyword2"], "intent_type": "search", "entities": {{"websites": [], "products": []}}}}"""

		try:
			from aidove_chat import ChatInvokeCompletion

			# Create a simple message structure
			class SimpleMessage:
				def __init__(self, role: str, content: str):
					self.role = role
					self.content = content

			messages = [SimpleMessage('user', prompt)]
			result = await self.llm.ainvoke(messages)

			if hasattr(result, 'completion') and isinstance(result.completion, str):
				import json

				# Try to extract JSON from response
				text = result.completion
				if '{' in text:
					start = text.find('{')
					end = text.rfind('}') + 1
					if end > start:
						return json.loads(text[start:end])

		except Exception as e:
			logger.debug(f'LLM analysis parsing failed: {e}')

		return {}


class SearchGuarantee:
	"""
	Ensures search tasks always return results by implementing
	fallback strategies and result validation.
	"""

	def __init__(self, intent_analyzer: IntentAnalyzer):
		self.intent_analyzer = intent_analyzer

	def build_enhanced_task(self, analyzed_intent: AnalyzedIntent, original_task: str) -> str:
		"""
		Build an enhanced task with fallback instructions.

		Args:
		    analyzed_intent: The analyzed intent from IntentAnalyzer
		    original_task: The original task description

		Returns:
		    Enhanced task string with fallback strategies
		"""
		if not analyzed_intent.fallback_strategies:
			return original_task

		# Build fallback instructions
		fallback_text = '\n\nFALLBACK STRATEGIES if primary search fails:\n'
		for i, strategy in enumerate(analyzed_intent.fallback_strategies[:3], 1):
			fallback_text += f'{i}. {strategy.description} - Keywords: {", ".join(strategy.keywords)}\n'

		fallback_text += """
If the main search returns no results:
1. Try alternative keywords from the fallback strategies above
2. Try a different search engine (Google, Bing, DuckDuckGo)
3. Look for related content that might contain the information
4. Report what was found even if not exact match"""

		return original_task + fallback_text

	async def validate_results(self, results: list[Any], analyzed_intent: AnalyzedIntent) -> bool:
		"""
		Validate if search results match the intent.

		Args:
		    results: List of search results
		    analyzed_intent: The analyzed intent

		Returns:
		    True if results are valid
		"""
		if not results:
			return False

		# Check if any result contains keywords
		keywords = set(k.lower() for k in analyzed_intent.keywords)
		for result in results:
			result_text = str(result).lower()
			if any(kw in result_text for kw in keywords):
				return True

		return len(results) > 0


class ResultFusion:
	"""
	Combines results from multiple search strategies
	to provide comprehensive search results.
	"""

	def __init__(self):
		self.results: list[dict[str, Any]] = []

	def add_results(self, results: list[Any], strategy: FallbackStrategy, score: float = 1.0):
		"""Add results from a strategy."""
		for result in results:
			self.results.append(
				{
					'result': result,
					'strategy': strategy.description,
					'score': score,
				}
			)

	def get_fused_results(self, top_k: int = 10) -> list[Any]:
		"""Get top-k fused results."""
		# Sort by score
		sorted_results = sorted(self.results, key=lambda x: x['score'], reverse=True)

		# Deduplicate
		seen = set()
		unique_results = []
		for item in sorted_results:
			result_str = str(item['result'])
			if result_str not in seen:
				seen.add(result_str)
				unique_results.append(item['result'])
				if len(unique_results) >= top_k:
					break

		return unique_results

	def clear(self):
		"""Clear all results."""
		self.results = []
