"""Query analyzer for semantic search enhancement using LLM."""

import asyncio
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Optional

import structlog
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

logger = structlog.get_logger(__name__)


class SearchStrategy(Enum):
    """Search strategy types for fallback mechanisms."""

    FULL_QUERY = "full_query"
    KEYWORDS_AND = "keywords_and"
    KEYWORDS_OR = "keywords_or"
    PRIMARY_KEYWORD = "primary_keyword"
    SEMANTIC_VARIANT = "semantic_variant"
    RELATED_TOPIC = "related_topic"
    PARTIAL_MATCH = "partial_match"


@dataclass
class FallbackStrategy:
    """Represents a fallback search strategy."""

    strategy_type: SearchStrategy
    query: str
    priority: int
    description: str
    weight: float = 1.0


@dataclass
class QueryAnalysis:
    """Result of query analysis."""

    original_query: str
    intent: str  # search_intent: news, research, factcheck, general
    language: str  # detected language
    keywords: list[str]  # extracted keywords
    primary_keyword: str  # most important keyword
    entities: list[str]  # named entities (people, places, organizations)
    expanded_queries: list[str]  # semantically expanded queries
    synonyms: dict[str, list[str]]  # word -> synonyms mapping
    search_terms: list[str]  # optimized search terms for different strategies
    fallback_strategies: list[FallbackStrategy]  # ordered fallback strategies
    confidence: float  # analysis confidence score
    metadata: dict[str, Any] = field(default_factory=dict)

    def get_all_search_queries(self) -> list[str]:
        """Get all search queries for multi-strategy search."""
        queries = [self.original_query]
        queries.extend(self.expanded_queries)
        queries.extend(self.search_terms)
        # Deduplicate while preserving order
        seen = set()
        unique = []
        for q in queries:
            if q.lower() not in seen:
                seen.add(q.lower())
                unique.append(q)
        return unique

    def get_fallback_query(self, attempt_index: int) -> Optional[str]:
        """Get fallback query by attempt index."""
        if attempt_index < len(self.fallback_strategies):
            return self.fallback_strategies[attempt_index].query
        return None


class QueryAnalyzer:
    """
    Analyzes and expands search queries using LLM for better search accuracy.

    Features:
    - Intent detection (news, research, factcheck, general)
    - Keyword extraction
    - Named entity recognition
    - Query expansion with synonyms and related terms
    - Multi-language support
    - Search term optimization
    """

    ANALYSIS_PROMPT = """You are a search query analyzer. Analyze the given query and provide structured information to improve search accuracy.

For the query: "{query}"

Respond in the following JSON format ONLY (no additional text):
{{
    "intent": "<news|research|factcheck|opinion|general>",
    "language": "<detected language code, e.g., ko, en, ja>",
    "keywords": ["<key term 1>", "<key term 2>", ...],
    "entities": ["<named entity 1>", "<named entity 2>", ...],
    "expanded_queries": [
        "<semantically related query 1>",
        "<semantically related query 2>",
        "<semantically related query 3>"
    ],
    "synonyms": {{
        "<original term>": ["<synonym 1>", "<synonym 2>"]
    }},
    "search_terms": [
        "<optimized search term for web search>",
        "<optimized search term for news search>",
        "<english translation if non-english>"
    ],
    "confidence": <0.0 to 1.0>
}}

Guidelines:
1. For ambiguous or metaphorical queries (like "두더지의 공격력" which could be about moles' attack power, a game, or slang), generate multiple interpretations
2. Extract the core semantic meaning, not just literal keywords
3. For non-English queries, include English translations in search_terms
4. Identify if the query is about specific domains (politics, sports, tech, entertainment, etc.)
5. Generate expanded_queries that capture different aspects or interpretations of the query
6. Keep search_terms concise and optimized for search engines"""

    QUICK_KEYWORDS_PROMPT = """Extract key search terms from this query. Return ONLY a JSON array of strings, no explanation.
Query: "{query}"
Example output: ["term1", "term2", "term3"]"""

    def __init__(
        self,
        llm: BaseChatModel,
        enable_expansion: bool = True,
        max_expanded_queries: int = 5,
        cache_results: bool = True,
    ):
        """
        Initialize the query analyzer.

        Args:
            llm: Language model for query analysis
            enable_expansion: Whether to enable query expansion
            max_expanded_queries: Maximum number of expanded queries
            cache_results: Whether to cache analysis results
        """
        self.llm = llm
        self.enable_expansion = enable_expansion
        self.max_expanded_queries = max_expanded_queries
        self._cache: Optional[dict[str, QueryAnalysis]] = {} if cache_results else None

    async def analyze(
        self,
        query: str,
        context: Optional[str] = None,
        force_refresh: bool = False,
    ) -> QueryAnalysis:
        """
        Analyze a search query and generate expanded search terms.

        Args:
            query: The original search query
            context: Optional context about the search domain
            force_refresh: Force re-analysis even if cached

        Returns:
            QueryAnalysis with expanded queries and keywords
        """
        # Check cache
        cache_key = f"{query}:{context or ''}"
        if self._cache is not None and not force_refresh:
            if cache_key in self._cache:
                logger.debug("Using cached query analysis", query=query)
                return self._cache[cache_key]

        try:
            analysis = await self._analyze_with_llm(query, context)

            # Cache result
            if self._cache is not None:
                self._cache[cache_key] = analysis

            logger.info(
                "Query analyzed",
                query=query,
                intent=analysis.intent,
                keywords=analysis.keywords,
                expanded_count=len(analysis.expanded_queries),
            )

            return analysis

        except Exception as e:
            logger.error("Query analysis failed, using fallback", query=query, error=str(e))
            return self._fallback_analysis(query)

    async def _analyze_with_llm(
        self,
        query: str,
        context: Optional[str] = None,
    ) -> QueryAnalysis:
        """Perform LLM-based query analysis."""
        prompt = self.ANALYSIS_PROMPT.format(query=query)

        if context:
            prompt += f"\n\nAdditional context: {context}"

        messages = [
            SystemMessage(content="You are a search query analyzer. Respond only with valid JSON."),
            HumanMessage(content=prompt),
        ]

        response = await self.llm.ainvoke(messages)
        content = response.content.strip()

        # Parse JSON response
        import json

        # Try to extract JSON from the response
        json_match = re.search(r"\{[\s\S]*\}", content)
        if json_match:
            content = json_match.group()

        try:
            data = json.loads(content)
        except json.JSONDecodeError:
            logger.warning("Failed to parse LLM response as JSON", response=content[:200])
            return self._fallback_analysis(query)

        # Validate and extract fields with defaults
        keywords = data.get("keywords", [])[:10]
        primary_keyword = self._identify_primary_keyword(keywords, query)

        analysis = QueryAnalysis(
            original_query=query,
            intent=data.get("intent", "general"),
            language=data.get("language", "unknown"),
            keywords=keywords,
            primary_keyword=primary_keyword,
            entities=data.get("entities", [])[:5],
            expanded_queries=data.get("expanded_queries", [])[: self.max_expanded_queries],
            synonyms=data.get("synonyms", {}),
            search_terms=data.get("search_terms", [])[:5],
            fallback_strategies=[],  # Will be generated below
            confidence=min(max(data.get("confidence", 0.5), 0.0), 1.0),
            metadata={"context": context} if context else {},
        )

        # Generate fallback strategies
        analysis.fallback_strategies = self._generate_fallback_strategies(analysis)

        return analysis

    async def extract_keywords_quick(self, query: str) -> list[str]:
        """
        Quick keyword extraction without full analysis.

        Useful for simple queries or when speed is critical.
        """
        try:
            prompt = self.QUICK_KEYWORDS_PROMPT.format(query=query)
            messages = [HumanMessage(content=prompt)]

            response = await self.llm.ainvoke(messages)
            content = response.content.strip()

            # Parse JSON array
            import json

            # Try to extract JSON array
            array_match = re.search(r"\[[\s\S]*\]", content)
            if array_match:
                keywords = json.loads(array_match.group())
                if isinstance(keywords, list):
                    return [str(k) for k in keywords[:10]]

            return self._extract_keywords_rule_based(query)

        except Exception as e:
            logger.debug("Quick keyword extraction failed", error=str(e))
            return self._extract_keywords_rule_based(query)

    def _fallback_analysis(self, query: str) -> QueryAnalysis:
        """Fallback analysis when LLM fails."""
        keywords = self._extract_keywords_rule_based(query)
        primary_keyword = self._identify_primary_keyword(keywords, query)
        language = self._detect_language(query)

        analysis = QueryAnalysis(
            original_query=query,
            intent="general",
            language=language,
            keywords=keywords,
            primary_keyword=primary_keyword,
            entities=[],
            expanded_queries=[],
            synonyms={},
            search_terms=keywords[:3],
            fallback_strategies=[],  # Will be generated below
            confidence=0.3,
            metadata={"fallback": True},
        )

        # Generate fallback strategies
        analysis.fallback_strategies = self._generate_fallback_strategies(analysis)

        return analysis

    def _extract_keywords_rule_based(self, query: str) -> list[str]:
        """Rule-based keyword extraction as fallback."""
        # Remove common stop words (basic implementation)
        stop_words = {
            # English
            "the",
            "a",
            "an",
            "is",
            "are",
            "was",
            "were",
            "be",
            "been",
            "being",
            "have",
            "has",
            "had",
            "do",
            "does",
            "did",
            "will",
            "would",
            "could",
            "should",
            "may",
            "might",
            "must",
            "shall",
            "can",
            "need",
            "dare",
            "ought",
            "used",
            "to",
            "of",
            "in",
            "for",
            "on",
            "with",
            "at",
            "by",
            "from",
            "as",
            "into",
            "through",
            "during",
            "before",
            "after",
            "above",
            "below",
            "between",
            "under",
            "again",
            "further",
            "then",
            "once",
            "here",
            "there",
            "when",
            "where",
            "why",
            "how",
            "all",
            "each",
            "few",
            "more",
            "most",
            "other",
            "some",
            "such",
            "no",
            "nor",
            "not",
            "only",
            "own",
            "same",
            "so",
            "than",
            "too",
            "very",
            "just",
            "and",
            "but",
            "if",
            "or",
            "because",
            "until",
            "while",
            "although",
            # Korean particles and common words
            "의",
            "가",
            "이",
            "은",
            "는",
            "을",
            "를",
            "에",
            "에서",
            "로",
            "으로",
            "와",
            "과",
            "도",
            "만",
            "까지",
            "부터",
            "에게",
            "한테",
            "께",
            "이다",
            "있다",
            "하다",
            "되다",
            "없다",
            "아니다",
            "그",
            "이",
            "저",
            "것",
            "수",
            "등",
            "들",
            "및",
            "더",
            "또",
        }

        # Tokenize
        words = re.findall(r"[\w가-힣]+", query.lower())

        # Filter stop words and short words
        keywords = [w for w in words if w not in stop_words and len(w) > 1]

        return keywords[:10]

    def _detect_language(self, text: str) -> str:
        """Simple language detection based on character ranges."""
        # Count character types
        korean_count = len(re.findall(r"[가-힣]", text))
        japanese_count = len(re.findall(r"[ぁ-んァ-ン]", text))
        chinese_count = len(re.findall(r"[\u4e00-\u9fff]", text))
        latin_count = len(re.findall(r"[a-zA-Z]", text))

        total = korean_count + japanese_count + chinese_count + latin_count
        if total == 0:
            return "unknown"

        if korean_count / total > 0.3:
            return "ko"
        elif japanese_count / total > 0.3:
            return "ja"
        elif chinese_count / total > 0.3:
            return "zh"
        else:
            return "en"

    def _identify_primary_keyword(self, keywords: list[str], original_query: str) -> str:
        """Identify the most important keyword from the list."""
        if not keywords:
            words = original_query.split()
            return words[0] if words else original_query

        # Score-based primary keyword selection
        scores = {}
        for keyword in keywords:
            score = 0.0

            # Length weight (longer keywords are more specific)
            score += min(len(keyword) / 10.0, 1.0) * 0.3

            # Position weight (earlier keywords are often more important)
            pos = original_query.lower().find(keyword.lower())
            if pos >= 0:
                score += (1.0 - pos / len(original_query)) * 0.3

            # Uppercase start (potential proper noun)
            if keyword[0].isupper():
                score += 0.2

            # Contains numbers (specific identifier)
            if any(c.isdigit() for c in keyword):
                score += 0.1

            scores[keyword] = score

        return max(scores.items(), key=lambda x: x[1])[0] if scores else keywords[0]

    def _generate_fallback_strategies(self, analysis: QueryAnalysis) -> list[FallbackStrategy]:
        """Generate ordered fallback search strategies."""
        strategies = []
        priority = 1

        # Strategy 1: Full query
        strategies.append(
            FallbackStrategy(
                strategy_type=SearchStrategy.FULL_QUERY,
                query=analysis.original_query,
                priority=priority,
                description="원본 쿼리로 검색"
                if analysis.language == "ko"
                else "Search with original query",
                weight=1.0,
            )
        )
        priority += 1

        # Strategy 2: Keywords AND
        if len(analysis.keywords) > 1:
            strategies.append(
                FallbackStrategy(
                    strategy_type=SearchStrategy.KEYWORDS_AND,
                    query=" ".join(analysis.keywords),
                    priority=priority,
                    description="모든 키워드로 검색"
                    if analysis.language == "ko"
                    else "Search with all keywords",
                    weight=0.9,
                )
            )
            priority += 1

        # Strategy 3: Primary keyword
        if analysis.primary_keyword:
            strategies.append(
                FallbackStrategy(
                    strategy_type=SearchStrategy.PRIMARY_KEYWORD,
                    query=analysis.primary_keyword,
                    priority=priority,
                    description="주요 키워드만으로 검색"
                    if analysis.language == "ko"
                    else "Search with primary keyword only",
                    weight=0.85,
                )
            )
            priority += 1

        # Strategy 4: Semantic variants (expanded queries)
        for i, expanded in enumerate(analysis.expanded_queries[:3]):
            if expanded.lower() != analysis.original_query.lower():
                strategies.append(
                    FallbackStrategy(
                        strategy_type=SearchStrategy.SEMANTIC_VARIANT,
                        query=expanded,
                        priority=priority,
                        description=f"변형 쿼리 {i + 1}: {expanded}"
                        if analysis.language == "ko"
                        else f"Variant query {i + 1}: {expanded}",
                        weight=0.8 - (i * 0.1),
                    )
                )
                priority += 1

        # Strategy 5: Keywords OR (broader search)
        if len(analysis.keywords) > 1:
            or_query = " OR ".join(analysis.keywords[:5])
            strategies.append(
                FallbackStrategy(
                    strategy_type=SearchStrategy.KEYWORDS_OR,
                    query=or_query,
                    priority=priority,
                    description="키워드 OR 검색 (넓은 검색)"
                    if analysis.language == "ko"
                    else "Keywords OR search (broader)",
                    weight=0.7,
                )
            )
            priority += 1

        # Strategy 6: Partial match (top 2 keywords)
        if len(analysis.keywords) >= 2:
            partial_query = f"{analysis.keywords[0]} {analysis.keywords[1]}"
            strategies.append(
                FallbackStrategy(
                    strategy_type=SearchStrategy.PARTIAL_MATCH,
                    query=partial_query,
                    priority=priority,
                    description="상위 키워드 부분 매칭"
                    if analysis.language == "ko"
                    else "Top keywords partial match",
                    weight=0.65,
                )
            )
            priority += 1

        # Sort by priority
        strategies.sort(key=lambda s: s.priority)
        return strategies

    def build_no_result_message(self, analysis: QueryAnalysis) -> str:
        """Build a helpful message when no results are found."""
        if analysis.language == "ko":
            message = "검색 결과를 찾기 어려웠습니다. 다음을 시도해 보세요:\n\n"
            message += "시도한 검색어:\n"
            message += f"- {analysis.original_query}\n"
            message += f"- {analysis.primary_keyword}\n"

            message += "\n추천 검색 방법:\n"
            message += "1. 검색어를 더 구체적으로 변경해 보세요\n"
            message += f"2. 다른 키워드를 사용해 보세요: {', '.join(analysis.keywords[:3])}\n"
            message += "3. 시간 범위를 조정해 보세요\n"

            intent_desc = {
                "news": "최신 뉴스",
                "research": "심층 분석",
                "factcheck": "팩트체크",
                "opinion": "여론 검색",
                "general": "일반 검색",
            }
            message += f"\n분석된 의도: {intent_desc.get(analysis.intent, '일반 검색')}"
        else:
            message = "Search results were difficult to find. Try the following:\n\n"
            message += "Queries attempted:\n"
            message += f"- {analysis.original_query}\n"
            message += f"- {analysis.primary_keyword}\n"

            message += "\nRecommended approaches:\n"
            message += "1. Try more specific keywords\n"
            message += f"2. Use alternative keywords: {', '.join(analysis.keywords[:3])}\n"
            message += "3. Adjust the time range\n"

            message += f"\nDetected intent: {analysis.intent}"

        return message

    def build_enhanced_task(self, analysis: QueryAnalysis, original_task: str) -> str:
        """Build an enhanced task with fallback instructions."""
        task = original_task + "\n\n"

        if analysis.language == "ko":
            task += "검색 전략 (결과가 없으면 순서대로 시도하세요):\n"
            for i, strategy in enumerate(analysis.fallback_strategies[:5], 1):
                task += f'{i}. {strategy.description}: "{strategy.query}"\n'
            task += "\n중요: 검색 결과가 없다고 말하지 마세요. 위의 전략을 모두 시도하고,\n"
            task += "관련된 정보라도 찾아서 제공하세요. 완전히 일치하지 않더라도\n"
            task += "가장 관련성 있는 정보를 제공하는 것이 중요합니다."
        else:
            task += "Search strategies (try in order if no results):\n"
            for i, strategy in enumerate(analysis.fallback_strategies[:5], 1):
                task += f'{i}. {strategy.description}: "{strategy.query}"\n'
            task += (
                '\nIMPORTANT: Never say "not found" or "no results". Try ALL strategies above,\n'
            )
            task += "and provide whatever relevant information you can find. Even if not an exact match,\n"
            task += "providing the most relevant information is important."

        return task

    def clear_cache(self) -> None:
        """Clear the analysis cache."""
        if self._cache is not None:
            self._cache.clear()


class MultiStrategyQueryExpander:
    """
    Expands a single query into multiple search strategies.

    Strategies:
    1. Original query (exact match)
    2. Keyword-based query (extracted keywords)
    3. Semantic expansion (related concepts)
    4. Entity-focused query (named entities)
    5. Cross-lingual query (translations)
    """

    def __init__(self, analyzer: QueryAnalyzer):
        self.analyzer = analyzer

    async def expand(
        self,
        query: str,
        max_strategies: int = 5,
        context: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """
        Expand query into multiple search strategies.

        Returns:
            List of dicts with 'query', 'strategy', and 'weight' keys
        """
        analysis = await self.analyzer.analyze(query, context)

        strategies = []

        # Strategy 1: Original query (highest weight)
        strategies.append(
            {
                "query": analysis.original_query,
                "strategy": "original",
                "weight": 1.0,
            }
        )

        # Strategy 2: Keywords joined
        if analysis.keywords:
            keyword_query = " ".join(analysis.keywords[:5])
            if keyword_query.lower() != query.lower():
                strategies.append(
                    {
                        "query": keyword_query,
                        "strategy": "keywords",
                        "weight": 0.9,
                    }
                )

        # Strategy 3: Semantic expansions
        for i, expanded in enumerate(analysis.expanded_queries[:3]):
            strategies.append(
                {
                    "query": expanded,
                    "strategy": f"semantic_{i + 1}",
                    "weight": 0.8 - (i * 0.1),
                }
            )

        # Strategy 4: Entity-focused
        if analysis.entities:
            entity_query = " ".join(analysis.entities[:3])
            if entity_query.lower() != query.lower():
                strategies.append(
                    {
                        "query": entity_query,
                        "strategy": "entities",
                        "weight": 0.7,
                    }
                )

        # Strategy 5: Search terms (often includes translations)
        for i, term in enumerate(analysis.search_terms[:2]):
            if term.lower() != query.lower():
                strategies.append(
                    {
                        "query": term,
                        "strategy": f"search_term_{i + 1}",
                        "weight": 0.75 - (i * 0.1),
                    }
                )

        # Deduplicate and limit
        seen_queries = set()
        unique_strategies = []
        for s in strategies:
            q_lower = s["query"].lower()
            if q_lower not in seen_queries:
                seen_queries.add(q_lower)
                unique_strategies.append(s)

        return unique_strategies[:max_strategies]
