"""
ML Addon Orchestrator for autonomous-crawler-service.

크롤링 완료 후 자동으로 ML 애드온 분석을 트리거하는 오케스트레이터.
Sentiment, Factcheck, Bias 분석을 병렬로 수행하고 결과를 DB에 저장합니다.

Features:
- 비동기 HTTP 클라이언트를 사용한 ML 애드온 호출
- 병렬 분석 실행 (asyncio.gather)
- 결과 DB 저장 (article_analysis 테이블)
- 헬스체크 및 연결 상태 모니터링
- 실패 시 재시도 및 폴백 처리
"""

import os
import asyncio
import uuid
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime
from enum import Enum

import structlog
import httpx
from pydantic import BaseModel, Field

logger = structlog.get_logger(__name__)


# ─────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────


class MLAddonConfig:
    """ML Addon 서버 연결 설정"""

    SENTIMENT_ADDON_URL = os.environ.get("SENTIMENT_ADDON_URL", "http://sentiment-addon:8100")
    FACTCHECK_ADDON_URL = os.environ.get("FACTCHECK_ADDON_URL", "http://factcheck-addon:8101")
    BIAS_ADDON_URL = os.environ.get("BIAS_ADDON_URL", "http://bias-addon:8102")

    # HTTP client settings
    TIMEOUT_SECONDS = int(os.environ.get("ML_ADDON_TIMEOUT", "60"))
    MAX_RETRIES = int(os.environ.get("ML_ADDON_MAX_RETRIES", "2"))
    RETRY_DELAY_SECONDS = float(os.environ.get("ML_ADDON_RETRY_DELAY", "1.0"))

    # Feature flags
    AUTO_ANALYSIS_ENABLED = os.environ.get("ML_AUTO_ANALYSIS_ENABLED", "true").lower() == "true"
    PARALLEL_ANALYSIS = os.environ.get("ML_PARALLEL_ANALYSIS", "true").lower() == "true"


# ─────────────────────────────────────────────
# Enums and Models
# ─────────────────────────────────────────────


class MLAddonType(str, Enum):
    """ML Addon 타입"""

    SENTIMENT = "sentiment"
    FACTCHECK = "factcheck"
    BIAS = "bias"


class AddonHealthStatus(str, Enum):
    """Addon 상태"""

    HEALTHY = "healthy"
    UNHEALTHY = "unhealthy"
    UNKNOWN = "unknown"
    WARMING_UP = "warming_up"


class ArticleInput(BaseModel):
    """분석할 기사 입력"""

    id: Optional[int] = None
    title: Optional[str] = None
    content: Optional[str] = None
    url: Optional[str] = None
    source: Optional[str] = None
    published_at: Optional[str] = None


class MLAddonRequest(BaseModel):
    """ML Addon 분석 요청"""

    request_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    addon_id: str
    task: str = "article_analysis"
    input_schema_version: str = "1.0"
    article: ArticleInput
    context: Optional[Dict[str, Any]] = None
    options: Optional[Dict[str, Any]] = None


class MLAnalysisResult(BaseModel):
    """ML 분석 결과"""

    addon_type: MLAddonType
    success: bool
    request_id: str
    results: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    latency_ms: int = 0
    analyzed_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class BatchAnalysisResult(BaseModel):
    """배치 분석 결과"""

    article_id: int
    sentiment: Optional[MLAnalysisResult] = None
    factcheck: Optional[MLAnalysisResult] = None
    bias: Optional[MLAnalysisResult] = None
    total_latency_ms: int = 0
    success_count: int = 0
    failure_count: int = 0


# ─────────────────────────────────────────────
# ML Addon Client
# ─────────────────────────────────────────────


class MLAddonClient:
    """ML Addon HTTP 클라이언트"""

    def __init__(
        self,
        addon_type: MLAddonType,
        base_url: str,
        timeout: float = MLAddonConfig.TIMEOUT_SECONDS,
    ):
        self.addon_type = addon_type
        self.base_url = base_url
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None
        self._health_status = AddonHealthStatus.UNKNOWN

    async def _get_client(self) -> httpx.AsyncClient:
        """HTTP 클라이언트 인스턴스 반환 (lazy initialization)"""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=httpx.Timeout(self.timeout),
                limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
            )
        return self._client

    async def close(self):
        """클라이언트 연결 종료"""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def health_check(self) -> Dict[str, Any]:
        """헬스체크 수행"""
        try:
            client = await self._get_client()
            response = await client.get("/health")

            if response.status_code == 200:
                data = response.json()
                status = data.get("status", "unknown")

                if status == "healthy":
                    self._health_status = AddonHealthStatus.HEALTHY
                elif data.get("warmup_complete") is False:
                    self._health_status = AddonHealthStatus.WARMING_UP
                else:
                    self._health_status = AddonHealthStatus.HEALTHY

                return {
                    "addon_type": self.addon_type.value,
                    "status": self._health_status.value,
                    "details": data,
                }
            else:
                self._health_status = AddonHealthStatus.UNHEALTHY
                return {
                    "addon_type": self.addon_type.value,
                    "status": AddonHealthStatus.UNHEALTHY.value,
                    "error": f"HTTP {response.status_code}",
                }

        except Exception as e:
            self._health_status = AddonHealthStatus.UNHEALTHY
            logger.warning(
                f"Health check failed for {self.addon_type.value}",
                error=str(e),
                url=self.base_url,
            )
            return {
                "addon_type": self.addon_type.value,
                "status": AddonHealthStatus.UNHEALTHY.value,
                "error": str(e),
            }

    async def analyze(
        self,
        article: ArticleInput,
        options: Optional[Dict[str, Any]] = None,
        retries: int = MLAddonConfig.MAX_RETRIES,
    ) -> MLAnalysisResult:
        """기사 분석 수행"""
        start_time = datetime.utcnow()
        request_id = str(uuid.uuid4())

        request_data = MLAddonRequest(
            request_id=request_id,
            addon_id=f"{self.addon_type.value}-addon",
            article=article,
            options=options or {},
        )

        for attempt in range(retries + 1):
            try:
                client = await self._get_client()
                response = await client.post(
                    "/analyze",
                    json=request_data.model_dump(),
                )

                latency_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)

                if response.status_code == 200:
                    data = response.json()
                    return MLAnalysisResult(
                        addon_type=self.addon_type,
                        success=data.get("status") == "success",
                        request_id=request_id,
                        results=data.get("results"),
                        error=data.get("error", {}).get("message") if data.get("error") else None,
                        latency_ms=latency_ms,
                    )
                else:
                    error_msg = f"HTTP {response.status_code}: {response.text[:200]}"
                    if attempt < retries:
                        logger.warning(
                            f"Retry {attempt + 1}/{retries} for {self.addon_type.value}",
                            error=error_msg,
                        )
                        await asyncio.sleep(MLAddonConfig.RETRY_DELAY_SECONDS)
                        continue

                    return MLAnalysisResult(
                        addon_type=self.addon_type,
                        success=False,
                        request_id=request_id,
                        error=error_msg,
                        latency_ms=latency_ms,
                    )

            except httpx.TimeoutException as e:
                latency_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)
                if attempt < retries:
                    logger.warning(
                        f"Timeout retry {attempt + 1}/{retries} for {self.addon_type.value}",
                        error=str(e),
                    )
                    await asyncio.sleep(MLAddonConfig.RETRY_DELAY_SECONDS)
                    continue

                return MLAnalysisResult(
                    addon_type=self.addon_type,
                    success=False,
                    request_id=request_id,
                    error=f"Timeout after {self.timeout}s",
                    latency_ms=latency_ms,
                )

            except Exception as e:
                latency_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)
                logger.error(
                    f"Analysis failed for {self.addon_type.value}",
                    error=str(e),
                    attempt=attempt + 1,
                )

                if attempt < retries:
                    await asyncio.sleep(MLAddonConfig.RETRY_DELAY_SECONDS)
                    continue

                return MLAnalysisResult(
                    addon_type=self.addon_type,
                    success=False,
                    request_id=request_id,
                    error=str(e),
                    latency_ms=latency_ms,
                )

        # Should not reach here
        return MLAnalysisResult(
            addon_type=self.addon_type,
            success=False,
            request_id=request_id,
            error="Max retries exceeded",
            latency_ms=0,
        )

    @property
    def is_healthy(self) -> bool:
        """Addon이 정상 상태인지 확인"""
        return self._health_status in [
            AddonHealthStatus.HEALTHY,
            AddonHealthStatus.WARMING_UP,
        ]


# ─────────────────────────────────────────────
# ML Orchestrator
# ─────────────────────────────────────────────


class MLOrchestrator:
    """
    ML Addon 오케스트레이터.

    크롤링된 기사에 대해 자동으로 ML 분석을 수행하고
    결과를 DB에 저장합니다.
    """

    def __init__(self, db_pool=None):
        """
        Args:
            db_pool: PostgreSQL 연결 풀 (asyncpg)
        """
        self.db_pool = db_pool

        # Initialize addon clients
        self.sentiment_client = MLAddonClient(
            MLAddonType.SENTIMENT, MLAddonConfig.SENTIMENT_ADDON_URL
        )
        self.factcheck_client = MLAddonClient(
            MLAddonType.FACTCHECK, MLAddonConfig.FACTCHECK_ADDON_URL
        )
        self.bias_client = MLAddonClient(MLAddonType.BIAS, MLAddonConfig.BIAS_ADDON_URL)

        self._clients = {
            MLAddonType.SENTIMENT: self.sentiment_client,
            MLAddonType.FACTCHECK: self.factcheck_client,
            MLAddonType.BIAS: self.bias_client,
        }

        self._initialized = False

    async def initialize(self):
        """오케스트레이터 초기화 및 헬스체크"""
        if self._initialized:
            return

        logger.info("Initializing ML Orchestrator...")

        # Perform health checks
        health_results = await self.check_all_health()

        healthy_count = sum(
            1 for r in health_results.values() if r.get("status") in ["healthy", "warming_up"]
        )

        logger.info(
            f"ML Orchestrator initialized",
            healthy_addons=healthy_count,
            total_addons=len(self._clients),
            auto_analysis_enabled=MLAddonConfig.AUTO_ANALYSIS_ENABLED,
        )

        self._initialized = True

    async def close(self):
        """모든 클라이언트 연결 종료"""
        for client in self._clients.values():
            await client.close()

    async def check_all_health(self) -> Dict[str, Dict[str, Any]]:
        """모든 ML Addon 헬스체크"""
        results = {}

        if MLAddonConfig.PARALLEL_ANALYSIS:
            health_tasks = [
                (addon_type, client.health_check()) for addon_type, client in self._clients.items()
            ]
            health_results = await asyncio.gather(
                *[task[1] for task in health_tasks], return_exceptions=True
            )

            for i, (addon_type, _) in enumerate(health_tasks):
                result = health_results[i]
                if isinstance(result, Exception):
                    results[addon_type.value] = {
                        "status": "error",
                        "error": str(result),
                    }
                else:
                    results[addon_type.value] = result
        else:
            for addon_type, client in self._clients.items():
                try:
                    results[addon_type.value] = await client.health_check()
                except Exception as e:
                    results[addon_type.value] = {
                        "status": "error",
                        "error": str(e),
                    }

        return results

    async def analyze_article(
        self,
        article_id: int,
        title: str,
        content: str,
        source: Optional[str] = None,
        url: Optional[str] = None,
        published_at: Optional[str] = None,
        addon_types: Optional[List[MLAddonType]] = None,
        save_to_db: bool = True,
    ) -> BatchAnalysisResult:
        """
        기사에 대해 ML 분석 수행.

        Args:
            article_id: 기사 ID
            title: 기사 제목
            content: 기사 본문
            source: 언론사
            url: 기사 URL
            published_at: 발행일
            addon_types: 실행할 애드온 타입 목록 (None이면 모두 실행)
            save_to_db: 결과를 DB에 저장할지 여부

        Returns:
            BatchAnalysisResult: 분석 결과
        """
        if not MLAddonConfig.AUTO_ANALYSIS_ENABLED:
            logger.debug("ML auto-analysis is disabled")
            return BatchAnalysisResult(
                article_id=article_id,
                success_count=0,
                failure_count=0,
            )

        start_time = datetime.utcnow()

        # Prepare article input
        article = ArticleInput(
            id=article_id,
            title=title,
            content=content,
            source=source,
            url=url,
            published_at=published_at,
        )

        # Determine which addons to run
        if addon_types is None:
            addon_types = list(MLAddonType)

        # Filter to only healthy addons
        active_clients = {
            addon_type: self._clients[addon_type]
            for addon_type in addon_types
            if addon_type in self._clients
        }

        if not active_clients:
            logger.warning("No ML addons available for analysis")
            return BatchAnalysisResult(
                article_id=article_id,
                success_count=0,
                failure_count=len(addon_types),
            )

        # Execute analysis
        results: Dict[MLAddonType, MLAnalysisResult] = {}

        if MLAddonConfig.PARALLEL_ANALYSIS:
            # Parallel execution
            analysis_tasks = [
                (addon_type, client.analyze(article))
                for addon_type, client in active_clients.items()
            ]
            analysis_results = await asyncio.gather(
                *[task[1] for task in analysis_tasks], return_exceptions=True
            )

            for i, (addon_type, _) in enumerate(analysis_tasks):
                result = analysis_results[i]
                if isinstance(result, Exception):
                    results[addon_type] = MLAnalysisResult(
                        addon_type=addon_type,
                        success=False,
                        request_id="",
                        error=str(result),
                    )
                elif isinstance(result, MLAnalysisResult):
                    results[addon_type] = result
        else:
            # Sequential execution
            for addon_type, client in active_clients.items():
                try:
                    results[addon_type] = await client.analyze(article)
                except Exception as e:
                    results[addon_type] = MLAnalysisResult(
                        addon_type=addon_type,
                        success=False,
                        request_id="",
                        error=str(e),
                    )

        # Calculate totals
        total_latency = int((datetime.utcnow() - start_time).total_seconds() * 1000)
        success_count = sum(1 for r in results.values() if r.success)
        failure_count = len(results) - success_count

        batch_result = BatchAnalysisResult(
            article_id=article_id,
            sentiment=results.get(MLAddonType.SENTIMENT),
            factcheck=results.get(MLAddonType.FACTCHECK),
            bias=results.get(MLAddonType.BIAS),
            total_latency_ms=total_latency,
            success_count=success_count,
            failure_count=failure_count,
        )

        # Save to database
        if save_to_db and self.db_pool:
            await self._save_results_to_db(article_id, results)

        logger.info(
            f"ML analysis completed for article {article_id}",
            success=success_count,
            failure=failure_count,
            latency_ms=total_latency,
        )

        return batch_result

    async def analyze_batch(
        self,
        articles: List[Dict[str, Any]],
        addon_types: Optional[List[MLAddonType]] = None,
        save_to_db: bool = True,
        max_concurrent: int = 5,
    ) -> List[BatchAnalysisResult]:
        """
        여러 기사에 대해 배치 분석 수행.

        Args:
            articles: 기사 목록 (dict with id, title, content, source, url)
            addon_types: 실행할 애드온 타입
            save_to_db: DB 저장 여부
            max_concurrent: 동시 처리 기사 수

        Returns:
            List[BatchAnalysisResult]: 분석 결과 목록
        """
        if not articles:
            return []

        semaphore = asyncio.Semaphore(max_concurrent)

        async def analyze_with_semaphore(article: Dict[str, Any]) -> BatchAnalysisResult:
            async with semaphore:
                return await self.analyze_article(
                    article_id=article.get("id", 0),
                    title=article.get("title", ""),
                    content=article.get("content", ""),
                    source=article.get("source"),
                    url=article.get("url"),
                    published_at=article.get("published_at"),
                    addon_types=addon_types,
                    save_to_db=save_to_db,
                )

        results = await asyncio.gather(
            *[analyze_with_semaphore(a) for a in articles], return_exceptions=True
        )

        # Filter out exceptions
        valid_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(
                    f"Batch analysis failed for article",
                    article_id=articles[i].get("id"),
                    error=str(result),
                )
                valid_results.append(
                    BatchAnalysisResult(
                        article_id=articles[i].get("id", 0),
                        success_count=0,
                        failure_count=3,
                    )
                )
            else:
                valid_results.append(result)

        return valid_results

    async def _save_results_to_db(
        self,
        article_id: int,
        results: Dict[MLAddonType, MLAnalysisResult],
    ):
        """분석 결과를 DB에 저장"""
        if not self.db_pool:
            logger.warning("No database pool configured, skipping DB save")
            return

        try:
            async with self.db_pool.acquire() as conn:
                for addon_type, result in results.items():
                    if not result.success:
                        continue

                    # Extract result data based on addon type
                    result_data = result.results or {}

                    if addon_type == MLAddonType.SENTIMENT:
                        sentiment_data = result_data.get("sentiment", {})
                        await conn.execute(
                            """
                            INSERT INTO article_analysis 
                                (article_id, addon_key, analysis_type, result_json, 
                                 score, confidence, created_at)
                            VALUES ($1, $2, $3, $4, $5, $6, NOW())
                            ON CONFLICT (article_id, addon_key) 
                            DO UPDATE SET 
                                result_json = EXCLUDED.result_json,
                                score = EXCLUDED.score,
                                confidence = EXCLUDED.confidence,
                                updated_at = NOW()
                            """,
                            article_id,
                            "sentiment-addon",
                            "sentiment",
                            result_data,
                            sentiment_data.get("score", 0),
                            sentiment_data.get("confidence", 0),
                        )

                    elif addon_type == MLAddonType.FACTCHECK:
                        factcheck_data = result_data.get("factcheck", {})
                        await conn.execute(
                            """
                            INSERT INTO article_analysis 
                                (article_id, addon_key, analysis_type, result_json, 
                                 score, confidence, created_at)
                            VALUES ($1, $2, $3, $4, $5, $6, NOW())
                            ON CONFLICT (article_id, addon_key) 
                            DO UPDATE SET 
                                result_json = EXCLUDED.result_json,
                                score = EXCLUDED.score,
                                confidence = EXCLUDED.confidence,
                                updated_at = NOW()
                            """,
                            article_id,
                            "factcheck-addon",
                            "factcheck",
                            result_data,
                            factcheck_data.get("overall_credibility", 0) / 100,
                            0.7,  # Default confidence for factcheck
                        )

                    elif addon_type == MLAddonType.BIAS:
                        bias_data = result_data.get("bias", {})
                        await conn.execute(
                            """
                            INSERT INTO article_analysis 
                                (article_id, addon_key, analysis_type, result_json, 
                                 score, confidence, created_at)
                            VALUES ($1, $2, $3, $4, $5, $6, NOW())
                            ON CONFLICT (article_id, addon_key) 
                            DO UPDATE SET 
                                result_json = EXCLUDED.result_json,
                                score = EXCLUDED.score,
                                confidence = EXCLUDED.confidence,
                                updated_at = NOW()
                            """,
                            article_id,
                            "bias-addon",
                            "bias",
                            result_data,
                            bias_data.get("overall_bias_score", 0),
                            bias_data.get("confidence", 0),
                        )

                logger.debug(f"Saved ML analysis results to DB for article {article_id}")

        except Exception as e:
            logger.error(
                f"Failed to save ML results to DB",
                article_id=article_id,
                error=str(e),
            )

    def get_addon_status(self) -> Dict[str, Any]:
        """현재 Addon 상태 반환"""
        return {
            "auto_analysis_enabled": MLAddonConfig.AUTO_ANALYSIS_ENABLED,
            "parallel_analysis": MLAddonConfig.PARALLEL_ANALYSIS,
            "addons": {
                addon_type.value: {
                    "url": client.base_url,
                    "healthy": client.is_healthy,
                    "status": client._health_status.value,
                }
                for addon_type, client in self._clients.items()
            },
        }


# ─────────────────────────────────────────────
# Singleton Instance
# ─────────────────────────────────────────────

_ml_orchestrator: Optional[MLOrchestrator] = None


def get_ml_orchestrator(db_pool=None) -> MLOrchestrator:
    """ML 오케스트레이터 싱글톤 인스턴스 반환"""
    global _ml_orchestrator
    if _ml_orchestrator is None:
        _ml_orchestrator = MLOrchestrator(db_pool=db_pool)
    elif db_pool is not None and _ml_orchestrator.db_pool is None:
        _ml_orchestrator.db_pool = db_pool
    return _ml_orchestrator


async def init_ml_orchestrator(db_pool=None) -> MLOrchestrator:
    """ML 오케스트레이터 초기화 및 반환"""
    orchestrator = get_ml_orchestrator(db_pool)
    await orchestrator.initialize()
    return orchestrator
