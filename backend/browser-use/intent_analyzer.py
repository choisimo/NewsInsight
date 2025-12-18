"""
Intent Analyzer for Browser AI Agent
Implements keyword extraction, context analysis, query expansion, and RRF
to guarantee search results even for complex mixed-keyword queries.
"""

import asyncio
import logging
import re
from dataclasses import dataclass, field
from typing import Optional, Any
from enum import Enum

logger = logging.getLogger(__name__)


class SearchStrategy(str, Enum):
	"""Different search strategies for fallback"""

	FULL_QUERY = 'full_query'  # Original full query
	KEYWORDS_AND = 'keywords_and'  # All keywords with AND logic
	KEYWORDS_OR = 'keywords_or'  # Keywords with OR logic
	PRIMARY_KEYWORD = 'primary_keyword'  # Most important keyword only
	SEMANTIC_VARIANT = 'semantic_variant'  # Semantically similar query
	RELATED_TOPIC = 'related_topic'  # Related topic search
	PARTIAL_MATCH = 'partial_match'  # Partial keyword matching


@dataclass
class AnalyzedIntent:
	"""Result of intent analysis"""

	original_query: str
	keywords: list[str]
	primary_keyword: str
	context: str
	intent_type: str  # search, navigate, extract, compare, etc.
	expanded_queries: list[str]
	fallback_strategies: list[dict[str, Any]]
	semantic_variants: list[str]
	related_topics: list[str]
	language: str  # ko, en, etc.
	confidence: float


@dataclass
class SearchResult:
	"""Individual search result"""

	content: str
	source: str
	relevance_score: float
	strategy_used: SearchStrategy
	rank: int


@dataclass
class FusedResults:
	"""Results after RRF fusion"""

	results: list[SearchResult]
	total_found: int
	strategies_used: list[SearchStrategy]
	best_strategy: SearchStrategy
	has_results: bool


class IntentAnalyzer:
	"""
	Analyzes user intent from mixed keyword sentences and generates
	multiple search strategies to guarantee results.
	"""

	# Common Korean stopwords
	KOREAN_STOPWORDS = {
		'은',
		'는',
		'이',
		'가',
		'을',
		'를',
		'의',
		'에',
		'에서',
		'로',
		'으로',
		'와',
		'과',
		'도',
		'만',
		'부터',
		'까지',
		'에게',
		'한테',
		'께',
		'이다',
		'하다',
		'있다',
		'없다',
		'되다',
		'않다',
		'그',
		'저',
		'이것',
		'그것',
		'저것',
		'여기',
		'거기',
		'저기',
		'뭐',
		'어디',
		'언제',
		'어떻게',
		'왜',
		'누구',
		'아주',
		'매우',
		'정말',
		'너무',
		'조금',
		'약간',
		'그리고',
		'그러나',
		'하지만',
		'그래서',
		'때문에',
		'것',
		'수',
		'등',
		'들',
		'및',
		'더',
		'덜',
	}

	# Common English stopwords
	ENGLISH_STOPWORDS = {
		'the',
		'a',
		'an',
		'and',
		'or',
		'but',
		'in',
		'on',
		'at',
		'to',
		'for',
		'of',
		'with',
		'by',
		'from',
		'is',
		'are',
		'was',
		'were',
		'be',
		'been',
		'being',
		'have',
		'has',
		'had',
		'do',
		'does',
		'did',
		'will',
		'would',
		'could',
		'should',
		'may',
		'might',
		'must',
		'shall',
		'can',
		'this',
		'that',
		'these',
		'those',
		'it',
		'its',
		'i',
		'you',
		'he',
		'she',
		'we',
		'they',
		'me',
		'him',
		'her',
		'us',
		'them',
		'what',
		'which',
		'who',
		'whom',
		'where',
		'when',
		'why',
		'how',
		'all',
		'each',
		'every',
		'both',
		'few',
		'more',
		'most',
		'other',
		'some',
		'such',
		'no',
		'nor',
		'not',
		'only',
		'own',
		'same',
		'so',
		'than',
		'too',
		'very',
		'just',
		'also',
		'now',
		'here',
		'there',
		'then',
	}

	# Intent type patterns
	INTENT_PATTERNS = {
		'search': ['찾', '검색', '알려', '뭐', '어디', 'find', 'search', 'look for', 'what', 'where'],
		'compare': ['비교', '차이', '어떤 것이', 'compare', 'difference', 'versus', 'vs'],
		'extract': ['추출', '가져', '수집', 'extract', 'get', 'collect', 'scrape'],
		'navigate': ['이동', '가', '열', 'go to', 'navigate', 'open', 'visit'],
		'analyze': ['분석', '평가', '리뷰', 'analyze', 'review', 'evaluate'],
		'summarize': ['요약', '정리', 'summarize', 'summary', 'overview'],
	}

	def __init__(self, llm: Optional[Any] = None):
		"""
		Initialize the Intent Analyzer.

		Args:
		    llm: Optional LLM instance for semantic analysis
		"""
		self.llm = llm
		self._cache: dict[str, AnalyzedIntent] = {}

	def detect_language(self, text: str) -> str:
		"""Detect the primary language of the text."""
		# Count Korean characters
		korean_chars = len(re.findall(r'[가-힣]', text))
		# Count ASCII letters
		english_chars = len(re.findall(r'[a-zA-Z]', text))

		total = korean_chars + english_chars
		if total == 0:
			return 'unknown'

		if korean_chars / total > 0.3:
			return 'ko'
		return 'en'

	def extract_keywords(self, text: str, language: str = 'auto') -> list[str]:
		"""
		Extract meaningful keywords from the text.

		Args:
		    text: Input text to extract keywords from
		    language: Language code ('ko', 'en', 'auto')

		Returns:
		    List of extracted keywords
		"""
		if language == 'auto':
			language = self.detect_language(text)

		keywords = []

		# Split by common delimiters
		tokens = re.split(r'[\s,;.!?()[\]{}"\']', text)
		tokens = [t.strip() for t in tokens if t.strip()]

		stopwords = self.KOREAN_STOPWORDS if language == 'ko' else self.ENGLISH_STOPWORDS

		for token in tokens:
			# Skip stopwords
			if token.lower() in stopwords:
				continue

			# Skip very short tokens (unless Korean)
			if language != 'ko' and len(token) < 2:
				continue

			# Skip pure numbers
			if token.isdigit():
				continue

			keywords.append(token)

		# Also extract quoted phrases as keywords
		quoted_phrases = re.findall(r'"([^"]+)"|\'([^\']+)\'', text)
		for match in quoted_phrases:
			phrase = match[0] or match[1]
			if phrase and phrase not in keywords:
				keywords.append(phrase)

		# Extract potential compound terms (noun phrases)
		if language == 'ko':
			# Korean compound nouns often end with specific suffixes
			compounds = re.findall(r'[가-힣]+(?:기업|회사|뉴스|정보|서비스|시스템|데이터|분석|결과)', text)
			for compound in compounds:
				if compound not in keywords:
					keywords.append(compound)

		return keywords

	def identify_primary_keyword(self, keywords: list[str], original_query: str) -> str:
		"""Identify the most important keyword from the list."""
		if not keywords:
			return original_query.split()[0] if original_query.split() else original_query

		# Score keywords by various factors
		scores: dict[str, float] = {}

		for keyword in keywords:
			score = 0.0

			# Longer keywords tend to be more specific
			score += min(len(keyword) / 10, 1.0) * 0.3

			# Keywords at the beginning of the query are often more important
			pos = original_query.find(keyword)
			if pos >= 0:
				score += (1.0 - pos / len(original_query)) * 0.3

			# Capitalized words (in English) or proper nouns
			if keyword[0].isupper():
				score += 0.2

			# Keywords with numbers might be specific identifiers
			if any(c.isdigit() for c in keyword):
				score += 0.1

			# Korean noun endings
			if re.search(r'[가-힣]+(기업|회사|뉴스|서비스|시스템)$', keyword):
				score += 0.3

			scores[keyword] = score

		# Return the keyword with the highest score
		return max(scores.keys(), key=lambda k: scores[k])

	def detect_intent_type(self, text: str) -> str:
		"""Detect the type of intent from the query."""
		text_lower = text.lower()

		for intent_type, patterns in self.INTENT_PATTERNS.items():
			for pattern in patterns:
				if pattern in text_lower:
					return intent_type

		return 'search'  # Default to search

	def generate_query_variants(self, keywords: list[str], primary_keyword: str, original_query: str, language: str) -> list[str]:
		"""Generate multiple query variants for better search coverage."""
		variants = []

		# 1. Original query
		variants.append(original_query)

		# 2. Keywords joined with spaces
		if len(keywords) > 1:
			variants.append(' '.join(keywords))

		# 3. Primary keyword only
		variants.append(primary_keyword)

		# 4. Top 2-3 keywords
		if len(keywords) >= 2:
			variants.append(' '.join(keywords[:2]))
		if len(keywords) >= 3:
			variants.append(' '.join(keywords[:3]))

		# 5. Keyword combinations (for AND-like searches)
		if len(keywords) >= 2:
			# Try different combinations
			for i in range(len(keywords)):
				for j in range(i + 1, min(i + 3, len(keywords))):
					combo = f'{keywords[i]} {keywords[j]}'
					if combo not in variants:
						variants.append(combo)

		# 6. Add language-specific variants
		if language == 'ko':
			# Add common Korean search suffixes
			for keyword in keywords[:3]:
				variants.append(f'{keyword} 정보')
				variants.append(f'{keyword} 뉴스')
				variants.append(f'{keyword} 관련')
		else:
			# Add common English search patterns
			for keyword in keywords[:3]:
				variants.append(f'{keyword} information')
				variants.append(f'{keyword} news')
				variants.append(f'about {keyword}')

		# Remove duplicates while preserving order
		seen = set()
		unique_variants = []
		for v in variants:
			v_lower = v.lower().strip()
			if v_lower and v_lower not in seen:
				seen.add(v_lower)
				unique_variants.append(v)

		return unique_variants

	def generate_fallback_strategies(self, analyzed: 'AnalyzedIntent') -> list[dict[str, Any]]:
		"""Generate a prioritized list of fallback search strategies."""
		strategies = []

		# Strategy 1: Full original query
		strategies.append(
			{
				'strategy': SearchStrategy.FULL_QUERY,
				'query': analyzed.original_query,
				'priority': 1,
				'description': 'Search with the complete original query',
			}
		)

		# Strategy 2: All keywords (AND logic)
		if len(analyzed.keywords) > 1:
			strategies.append(
				{
					'strategy': SearchStrategy.KEYWORDS_AND,
					'query': ' '.join(analyzed.keywords),
					'priority': 2,
					'description': 'Search with all extracted keywords',
				}
			)

		# Strategy 3: Primary keyword only
		strategies.append(
			{
				'strategy': SearchStrategy.PRIMARY_KEYWORD,
				'query': analyzed.primary_keyword,
				'priority': 3,
				'description': 'Search with the most important keyword only',
			}
		)

		# Strategy 4: Semantic variants
		for i, variant in enumerate(analyzed.semantic_variants[:3]):
			strategies.append(
				{
					'strategy': SearchStrategy.SEMANTIC_VARIANT,
					'query': variant,
					'priority': 4 + i,
					'description': f'Search with semantic variant: {variant}',
				}
			)

		# Strategy 5: Related topics
		for i, topic in enumerate(analyzed.related_topics[:2]):
			strategies.append(
				{
					'strategy': SearchStrategy.RELATED_TOPIC,
					'query': topic,
					'priority': 7 + i,
					'description': f'Search for related topic: {topic}',
				}
			)

		# Strategy 6: Keywords OR logic (broader search)
		if len(analyzed.keywords) > 1:
			strategies.append(
				{
					'strategy': SearchStrategy.KEYWORDS_OR,
					'query': ' OR '.join(analyzed.keywords[:5]),
					'priority': 9,
					'description': 'Broader search with keywords in OR logic',
				}
			)

		# Strategy 7: Partial matching (first 2 keywords)
		if len(analyzed.keywords) >= 2:
			strategies.append(
				{
					'strategy': SearchStrategy.PARTIAL_MATCH,
					'query': ' '.join(analyzed.keywords[:2]),
					'priority': 10,
					'description': 'Partial match with top keywords',
				}
			)

		return sorted(strategies, key=lambda x: x['priority'])

	async def analyze_with_llm(self, query: str, language: str) -> dict[str, Any]:
		"""Use LLM to perform deeper semantic analysis."""
		if not self.llm:
			return {'semantic_variants': [], 'related_topics': [], 'context': '', 'confidence': 0.5}

		try:
			# Build prompt for LLM analysis
			if language == 'ko':
				prompt = f"""다음 검색 쿼리를 분석하세요:
쿼리: "{query}"

다음을 JSON 형식으로 제공하세요:
1. semantic_variants: 의미가 유사한 다른 검색어 3개 (리스트)
2. related_topics: 관련 주제 2개 (리스트)
3. context: 사용자가 찾고자 하는 것에 대한 간단한 설명
4. confidence: 분석 신뢰도 (0.0-1.0)

JSON만 출력하세요."""
			else:
				prompt = f"""Analyze this search query:
Query: "{query}"

Provide the following in JSON format:
1. semantic_variants: 3 similar search queries (list)
2. related_topics: 2 related topics (list)  
3. context: Brief description of what the user is looking for
4. confidence: Analysis confidence (0.0-1.0)

Output only JSON."""

			# Call LLM (assuming it has an async method)
			# This is a simplified version - actual implementation depends on your LLM interface
			response = await self._call_llm(prompt)

			# Parse JSON response
			import json

			try:
				result = json.loads(response)
				return result
			except json.JSONDecodeError:
				# Try to extract JSON from response
				json_match = re.search(r'\{[^{}]*\}', response, re.DOTALL)
				if json_match:
					return json.loads(json_match.group())
				return {
					'semantic_variants': [],
					'related_topics': [],
					'context': response[:200] if response else '',
					'confidence': 0.3,
				}

		except Exception as e:
			logger.warning(f'LLM analysis failed: {e}')
			return {'semantic_variants': [], 'related_topics': [], 'context': '', 'confidence': 0.3}

	async def _call_llm(self, prompt: str) -> str:
		"""Call the LLM with the given prompt."""
		if not self.llm:
			return ''

		try:
			# Try different LLM interfaces
			if hasattr(self.llm, 'ainvoke'):
				from browser_use.llm.messages import UserMessage

				response = await self.llm.ainvoke([UserMessage(content=prompt)])
				if hasattr(response, 'completion'):
					return str(response.completion)
				return str(response)
			elif hasattr(self.llm, 'generate'):
				response = await self.llm.generate(prompt)
				return str(response)
			elif hasattr(self.llm, '__call__'):
				response = await self.llm(prompt)
				return str(response)
		except Exception as e:
			logger.warning(f'LLM call failed: {e}')

		return ''

	async def analyze(self, query: str, use_llm: bool = True) -> AnalyzedIntent:
		"""
		Perform full intent analysis on the query.

		Args:
		    query: The user's search query
		    use_llm: Whether to use LLM for deeper analysis

		Returns:
		    AnalyzedIntent with all analysis results
		"""
		# Check cache
		cache_key = f'{query}_{use_llm}'
		if cache_key in self._cache:
			return self._cache[cache_key]

		# Detect language
		language = self.detect_language(query)

		# Extract keywords
		keywords = self.extract_keywords(query, language)

		# Identify primary keyword
		primary_keyword = self.identify_primary_keyword(keywords, query)

		# Detect intent type
		intent_type = self.detect_intent_type(query)

		# Generate basic query variants
		expanded_queries = self.generate_query_variants(keywords, primary_keyword, query, language)

		# LLM-based semantic analysis
		llm_analysis = {'semantic_variants': [], 'related_topics': [], 'context': '', 'confidence': 0.5}
		if use_llm and self.llm:
			llm_analysis = await self.analyze_with_llm(query, language)

		# Create the analyzed intent
		analyzed = AnalyzedIntent(
			original_query=query,
			keywords=keywords,
			primary_keyword=primary_keyword,
			context=llm_analysis.get('context', ''),
			intent_type=intent_type,
			expanded_queries=expanded_queries,
			fallback_strategies=[],  # Will be filled below
			semantic_variants=llm_analysis.get('semantic_variants', []),
			related_topics=llm_analysis.get('related_topics', []),
			language=language,
			confidence=llm_analysis.get('confidence', 0.5),
		)

		# Generate fallback strategies
		analyzed.fallback_strategies = self.generate_fallback_strategies(analyzed)

		# Cache the result
		self._cache[cache_key] = analyzed

		logger.info(
			f'Intent analysis complete: {len(keywords)} keywords, '
			f'{len(expanded_queries)} variants, '
			f'{len(analyzed.fallback_strategies)} strategies'
		)

		return analyzed


class ResultFusion:
	"""
	Implements Reciprocal Rank Fusion (RRF) to combine results
	from multiple search strategies.
	"""

	def __init__(self, k: int = 60):
		"""
		Initialize RRF with constant k.

		Args:
		    k: RRF constant (typically 60)
		"""
		self.k = k

	def calculate_rrf_score(self, ranks: list[int]) -> float:
		"""
		Calculate RRF score for an item given its ranks across different searches.

		RRF_score = sum(1 / (k + rank_i))

		Args:
		    ranks: List of ranks from different search strategies

		Returns:
		    Combined RRF score
		"""
		return sum(1.0 / (self.k + rank) for rank in ranks if rank > 0)

	def fuse_results(self, results_by_strategy: dict[SearchStrategy, list[SearchResult]]) -> FusedResults:
		"""
		Fuse results from multiple search strategies using RRF.

		Args:
		    results_by_strategy: Dict mapping strategy to list of results

		Returns:
		    FusedResults with combined and ranked results
		"""
		# Track all unique results by content
		content_scores: dict[str, dict[str, Any]] = {}

		for strategy, results in results_by_strategy.items():
			for result in results:
				content_key = result.content.lower().strip()[:200]  # Use first 200 chars as key

				if content_key not in content_scores:
					content_scores[content_key] = {'result': result, 'ranks': [], 'strategies': []}

				content_scores[content_key]['ranks'].append(result.rank)
				content_scores[content_key]['strategies'].append(strategy)

		# Calculate RRF scores
		scored_results = []
		for content_key, data in content_scores.items():
			rrf_score = self.calculate_rrf_score(data['ranks'])
			result = data['result']
			result.relevance_score = rrf_score
			scored_results.append({'result': result, 'score': rrf_score, 'strategies': data['strategies']})

		# Sort by RRF score (descending)
		scored_results.sort(key=lambda x: x['score'], reverse=True)

		# Determine best strategy (the one that contributed most high-ranked results)
		strategy_contributions: dict[SearchStrategy, float] = {}
		for item in scored_results[:10]:  # Top 10 results
			for strategy in item['strategies']:
				strategy_contributions[strategy] = strategy_contributions.get(strategy, 0) + item['score']

		best_strategy = (
			max(strategy_contributions.keys(), key=lambda s: strategy_contributions[s])
			if strategy_contributions
			else SearchStrategy.FULL_QUERY
		)

		# Build final results
		final_results = [item['result'] for item in scored_results]
		strategies_used = list(results_by_strategy.keys())

		return FusedResults(
			results=final_results,
			total_found=len(final_results),
			strategies_used=strategies_used,
			best_strategy=best_strategy,
			has_results=len(final_results) > 0,
		)


class SearchGuarantee:
	"""
	Ensures that search always returns results by trying multiple strategies.
	"""

	def __init__(self, intent_analyzer: IntentAnalyzer, result_fusion: Optional[ResultFusion] = None):
		"""
		Initialize the search guarantee system.

		Args:
		    intent_analyzer: IntentAnalyzer instance
		    result_fusion: Optional ResultFusion instance
		"""
		self.analyzer = intent_analyzer
		self.fusion = result_fusion or ResultFusion()
		self._search_executor: Optional[Any] = None

	def set_search_executor(self, executor: Any):
		"""Set the function/method that actually executes searches."""
		self._search_executor = executor

	async def guaranteed_search(self, query: str, search_func: Optional[Any] = None, max_strategies: int = 5) -> FusedResults:
		"""
		Perform a guaranteed search that will return results.

		Args:
		    query: User's search query
		    search_func: Async function that performs the actual search
		    max_strategies: Maximum number of strategies to try

		Returns:
		    FusedResults with guaranteed results
		"""
		executor = search_func or self._search_executor
		if not executor:
			raise ValueError('No search executor provided')

		# Analyze the query
		analyzed = await self.analyzer.analyze(query)

		results_by_strategy: dict[SearchStrategy, list[SearchResult]] = {}
		strategies_tried = 0

		# Try strategies in order until we get results or exhaust strategies
		for strategy_info in analyzed.fallback_strategies:
			if strategies_tried >= max_strategies:
				break

			strategy = strategy_info['strategy']
			search_query = strategy_info['query']

			try:
				logger.info(f"Trying strategy {strategy.value}: '{search_query}'")

				# Execute the search
				results = await executor(search_query)

				if results:
					# Convert to SearchResult objects if needed
					search_results = []
					for i, result in enumerate(results):
						if isinstance(result, SearchResult):
							result.strategy_used = strategy
							result.rank = i + 1
							search_results.append(result)
						else:
							search_results.append(
								SearchResult(
									content=str(result), source='search', relevance_score=0.0, strategy_used=strategy, rank=i + 1
								)
							)

					results_by_strategy[strategy] = search_results
					logger.info(f'Strategy {strategy.value} found {len(search_results)} results')
				else:
					logger.info(f'Strategy {strategy.value} found no results')

			except Exception as e:
				logger.warning(f'Strategy {strategy.value} failed: {e}')

			strategies_tried += 1

			# If we have good results from multiple strategies, we can stop early
			total_results = sum(len(r) for r in results_by_strategy.values())
			if total_results >= 10 and len(results_by_strategy) >= 2:
				break

		# Fuse results
		if results_by_strategy:
			return self.fusion.fuse_results(results_by_strategy)

		# If still no results, return empty but valid response
		return FusedResults(
			results=[],
			total_found=0,
			strategies_used=[s['strategy'] for s in analyzed.fallback_strategies[:strategies_tried]],
			best_strategy=SearchStrategy.FULL_QUERY,
			has_results=False,
		)

	def build_enhanced_task(self, analyzed: AnalyzedIntent, original_task: str) -> str:
		"""
		Build an enhanced task description with fallback instructions.

		Args:
		    analyzed: The analyzed intent
		    original_task: The original task description

		Returns:
		    Enhanced task with fallback instructions
		"""
		# Build fallback query list
		fallback_queries = [s['query'] for s in analyzed.fallback_strategies[:5]]

		if analyzed.language == 'ko':
			enhanced = f"""{original_task}

검색 전략 (결과가 없으면 순서대로 시도하세요):
1. 먼저 원래 검색어로 검색: "{analyzed.original_query}"
2. 키워드로 검색: {', '.join(analyzed.keywords[:3])}
3. 주요 키워드만 검색: "{analyzed.primary_keyword}"
"""
			if analyzed.semantic_variants:
				enhanced += f'4. 유사한 검색어 시도: {", ".join(analyzed.semantic_variants[:2])}\n'

			enhanced += """
중요: 검색 결과가 없다고 말하지 마세요. 위의 전략을 모두 시도하고, 
관련된 정보라도 찾아서 제공하세요. 완전히 일치하지 않더라도 
가장 관련성 있는 정보를 제공하는 것이 중요합니다."""
		else:
			enhanced = f"""{original_task}

Search strategies (try in order if no results):
1. First search with original query: "{analyzed.original_query}"
2. Search with keywords: {', '.join(analyzed.keywords[:3])}
3. Search with primary keyword only: "{analyzed.primary_keyword}"
"""
			if analyzed.semantic_variants:
				enhanced += f'4. Try similar searches: {", ".join(analyzed.semantic_variants[:2])}\n'

			enhanced += """
IMPORTANT: Never say "not found" or "no results". Try ALL strategies above,
and provide whatever relevant information you can find. Even if not an exact match,
providing the most relevant information is important."""

		return enhanced
