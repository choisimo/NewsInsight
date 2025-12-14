"""
BERTopic Topic Modeling Service

This service provides topic modeling capabilities using BERTopic with Korean language support.
It integrates with the Java Analysis Service via REST API.

Features:
- Topic extraction from Korean documents using BERTopic
- Semantic topic similarity search
- Topic trend analysis over time
- Document classification using trained model
- Model persistence and management

API Endpoints:
- POST /api/v1/topics/extract - Extract topics from documents
- GET  /api/v1/topics/{topicId} - Get topic representation
- POST /api/v1/topics/search - Find similar topics
- POST /api/v1/topics/trends - Get topic trends
- POST /api/v1/topics/transform - Transform documents to topic assignments
- GET  /api/v1/model/info - Get model statistics
"""

import os
import sys
import re
import logging
import pickle
from datetime import datetime
from pathlib import Path
from typing import Optional, Tuple
from contextlib import asynccontextmanager
from collections import defaultdict

import asyncpg
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Add shared module to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
try:
    from shared.prometheus_metrics import (
        setup_metrics,
        track_request_time,
        track_operation,
        track_error,
        track_item_processed,
        ServiceMetrics,
    )

    METRICS_AVAILABLE = True
except ImportError:
    METRICS_AVAILABLE = False

# Configuration
MODEL_PATH = os.getenv("BERTOPIC_MODEL_PATH", "/app/models/bertopic_model")
EMBEDDING_MODEL = os.getenv(
    "EMBEDDING_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
)
MIN_TOPIC_SIZE = int(os.getenv("MIN_TOPIC_SIZE", "10"))
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

# Database configuration
DB_HOST = os.getenv("DB_HOST", "postgres")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_NAME = os.getenv("DB_NAME", "osint")
DB_USER = os.getenv("DB_USER", "osint")
DB_PASSWORD = os.getenv("DB_PASSWORD", "osint123")

# Logging
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Global model instance
topic_model: Optional["BERTopic"] = None
embedding_model = None
model_info: dict = {
    "model_name": "bertopic",
    "num_topics": 0,
    "num_documents": 0,
    "last_trained": "",
    "available": False,
}

# Database connection pool
db_pool: Optional[asyncpg.Pool] = None


async def init_db_pool():
    """Initialize the database connection pool."""
    global db_pool
    try:
        db_pool = await asyncpg.create_pool(
            host=DB_HOST,
            port=DB_PORT,
            database=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
            min_size=2,
            max_size=10,
        )
        logger.info(
            f"Database connection pool initialized: {DB_HOST}:{DB_PORT}/{DB_NAME}"
        )
    except Exception as e:
        logger.error(f"Failed to initialize database pool: {e}")
        db_pool = None


async def close_db_pool():
    """Close the database connection pool."""
    global db_pool
    if db_pool:
        await db_pool.close()
        logger.info("Database connection pool closed")


# ==================== Pydantic Models ====================


class TopicExtractRequest(BaseModel):
    documents: list[str]
    num_topics: int = -1  # -1 for automatic
    min_topic_size: int = 10
    preprocess: bool = True  # Enable document preprocessing
    min_doc_length: int = 10  # Minimum document length after preprocessing


class TopicRepresentation(BaseModel):
    id: int
    keywords: list[str]
    weights: list[float]
    label: str
    document_count: int


class TopicExtractionResponse(BaseModel):
    topics: list[TopicRepresentation]
    topic_assignments: list[int]
    num_topics: int


class TopicSearchRequest(BaseModel):
    query: str
    top_k: int = 5


class SimilarTopic(BaseModel):
    topic_id: int
    label: str
    similarity: float
    keywords: list[str]


class TopicSearchResponse(BaseModel):
    similar_topics: list[SimilarTopic]


class TopicTrendsRequest(BaseModel):
    topic_ids: list[int]
    granularity: str = "day"  # hour, day, week


class TrendPoint(BaseModel):
    timestamp: str
    count: int
    sentiment: float = 0.0


class TopicTrendsResponse(BaseModel):
    trends: dict[str, list[TrendPoint]]


class TransformRequest(BaseModel):
    documents: list[str]
    preprocess: bool = True  # Enable document preprocessing
    min_doc_length: int = 10  # Minimum document length after preprocessing


class TransformResponse(BaseModel):
    topic_assignments: list[int]


class ModelInfoResponse(BaseModel):
    model_name: str
    num_topics: int
    num_documents: int
    last_trained: str
    available: bool


# ==================== Document Preprocessing ====================


def preprocess_documents(
    documents: list[str], min_length: int = 10
) -> Tuple[list[str], list[int]]:
    """
    Preprocess documents for BERTopic analysis.

    Performs text cleaning operations:
    - Removes HTML tags
    - Removes URLs
    - Removes email addresses
    - Normalizes whitespace
    - Filters documents shorter than min_length

    Args:
        documents: List of raw document strings
        min_length: Minimum character length to keep a document

    Returns:
        Tuple of (cleaned_documents, original_indices) for mapping back results
    """
    cleaned = []
    indices = []

    for i, doc in enumerate(documents):
        if not doc or not isinstance(doc, str):
            continue

        text = doc

        # 1. Remove HTML tags
        text = re.sub(r"<[^>]+>", " ", text)

        # 2. Remove URLs (http, https, www)
        text = re.sub(r"https?://\S+|www\.\S+", " ", text)

        # 3. Remove email addresses
        text = re.sub(r"\S+@\S+\.\S+", " ", text)

        # 4. Remove common social media artifacts
        text = re.sub(r"@\w+", " ", text)  # mentions
        text = re.sub(r"#\w+", " ", text)  # hashtags

        # 5. Normalize whitespace (multiple spaces, tabs, newlines)
        text = re.sub(r"\s+", " ", text).strip()

        # 6. Filter by minimum length
        if len(text) >= min_length:
            cleaned.append(text)
            indices.append(i)

    return cleaned, indices


def map_topics_to_original(
    topic_assignments: list[int], original_indices: list[int], total_documents: int
) -> list[int]:
    """
    Map topic assignments back to original document indices.
    Documents that were filtered out during preprocessing get -1 (outlier).

    Args:
        topic_assignments: Topic assignments for cleaned documents
        original_indices: Indices mapping cleaned docs to original positions
        total_documents: Total number of original documents

    Returns:
        List of topic assignments for all original documents
    """
    # Initialize all documents as outliers (-1)
    full_assignments = [-1] * total_documents

    # Map cleaned document topics back to original indices
    for cleaned_idx, original_idx in enumerate(original_indices):
        if cleaned_idx < len(topic_assignments):
            full_assignments[original_idx] = topic_assignments[cleaned_idx]

    return full_assignments


# ==================== Model Management ====================


def load_or_create_model():
    """Load existing model or create a new one."""
    global topic_model, embedding_model, model_info

    try:
        from bertopic import BERTopic
        from sentence_transformers import SentenceTransformer

        # Initialize embedding model (supports Korean)
        logger.info(f"Loading embedding model: {EMBEDDING_MODEL}")
        embedding_model = SentenceTransformer(EMBEDDING_MODEL)

        model_path = Path(MODEL_PATH)
        if model_path.exists():
            logger.info(f"Loading existing BERTopic model from {MODEL_PATH}")
            topic_model = BERTopic.load(MODEL_PATH, embedding_model=embedding_model)

            # Update model info
            topics = topic_model.get_topics()
            model_info.update(
                {
                    "num_topics": len([t for t in topics if t != -1]),
                    "num_documents": len(topic_model.get_document_info([]))
                    if hasattr(topic_model, "get_document_info")
                    else 0,
                    "last_trained": datetime.fromtimestamp(
                        model_path.stat().st_mtime
                    ).isoformat(),
                    "available": True,
                }
            )
            logger.info(f"Model loaded with {model_info['num_topics']} topics")
        else:
            logger.info("No existing model found. Creating new BERTopic instance.")
            # Create with Korean-optimized settings
            from hdbscan import HDBSCAN
            from umap import UMAP
            from sklearn.feature_extraction.text import CountVectorizer

            # UMAP for dimension reduction
            umap_model = UMAP(
                n_neighbors=15,
                n_components=5,
                min_dist=0.0,
                metric="cosine",
                random_state=42,
            )

            # HDBSCAN for clustering (min_cluster_size=2 for small datasets)
            hdbscan_model = HDBSCAN(
                min_cluster_size=2,
                metric="euclidean",
                cluster_selection_method="eom",
                prediction_data=True,
            )

            # CountVectorizer for Korean (flexible settings for any corpus size)
            vectorizer = CountVectorizer(ngram_range=(1, 2), min_df=1, max_df=1.0)

            topic_model = BERTopic(
                embedding_model=embedding_model,
                umap_model=umap_model,
                hdbscan_model=hdbscan_model,
                vectorizer_model=vectorizer,
                top_n_words=10,
                verbose=True,
            )

            model_info["available"] = True
            logger.info("New BERTopic model initialized (not yet trained)")

    except ImportError as e:
        logger.error(f"Failed to import BERTopic dependencies: {e}")
        model_info["available"] = False
    except Exception as e:
        logger.error(f"Failed to load/create model: {e}")
        model_info["available"] = False


def save_model():
    """Save the current model to disk."""
    global topic_model, model_info

    if topic_model is None:
        return

    try:
        model_path = Path(MODEL_PATH)
        model_path.parent.mkdir(parents=True, exist_ok=True)
        topic_model.save(MODEL_PATH, serialization="safetensors", save_ctfidf=True)
        model_info["last_trained"] = datetime.now().isoformat()
        logger.info(f"Model saved to {MODEL_PATH}")
    except Exception as e:
        logger.error(f"Failed to save model: {e}")


# ==================== FastAPI Application ====================


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize model and database on startup."""
    logger.info("Starting BERTopic service...")
    load_or_create_model()
    await init_db_pool()
    yield
    logger.info("Shutting down BERTopic service...")
    await close_db_pool()


app = FastAPI(
    title="BERTopic Topic Modeling Service",
    description="Topic modeling for Korean text using BERTopic",
    version="1.0.0",
    lifespan=lifespan,
)

# Setup Prometheus metrics
SERVICE_NAME = "bertopic-service"
if METRICS_AVAILABLE:
    setup_metrics(app, SERVICE_NAME, version="1.0.0")
    service_metrics = ServiceMetrics(SERVICE_NAME)
    # Create service-specific metrics
    topics_extracted = service_metrics.create_counter(
        "topics_extracted_total", "Total topic extraction operations", ["status"]
    )
    documents_processed = service_metrics.create_counter(
        "documents_processed_total", "Total documents processed", ["operation"]
    )
    model_training_duration = service_metrics.create_histogram(
        "model_training_seconds",
        "Model training duration",
        ["operation"],
        buckets=(1.0, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0, 600.0),
    )
    logger.info("Prometheus metrics enabled for bertopic-service")
else:
    service_metrics = None
    logger.warning("Prometheus metrics not available - shared module not found")


@app.get("/health")
@app.head("/health")
async def health():
    """Health check endpoint."""
    if model_info.get("available", False):
        return {"status": "healthy", "model_loaded": True}
    return {"status": "degraded", "model_loaded": False}


@app.get("/api/v1/model/info", response_model=ModelInfoResponse)
async def get_model_info():
    """Get model information and statistics."""
    return ModelInfoResponse(**model_info)


@app.post("/api/v1/topics/extract", response_model=TopicExtractionResponse)
async def extract_topics(request: TopicExtractRequest):
    """
    Extract topics from a list of documents.
    If model is not trained, this will train it on the provided documents.

    Preprocessing (enabled by default) cleans documents by:
    - Removing HTML tags, URLs, emails, mentions, hashtags
    - Normalizing whitespace
    - Filtering documents shorter than min_doc_length
    """
    global topic_model, model_info

    if topic_model is None:
        raise HTTPException(status_code=503, detail="BERTopic model not available")

    if not request.documents:
        raise HTTPException(status_code=400, detail="No documents provided")

    try:
        original_count = len(request.documents)
        logger.info(
            f"Extracting topics from {original_count} documents (preprocess={request.preprocess})"
        )

        # Preprocess documents if enabled
        if request.preprocess:
            docs_to_process, original_indices = preprocess_documents(
                request.documents, min_length=request.min_doc_length
            )
            logger.info(
                f"After preprocessing: {len(docs_to_process)} documents (filtered {original_count - len(docs_to_process)})"
            )

            if not docs_to_process:
                raise HTTPException(
                    status_code=400,
                    detail=f"All documents were filtered out during preprocessing (min_length={request.min_doc_length})",
                )
        else:
            docs_to_process = request.documents
            original_indices = list(range(original_count))

        # Check if model is trained by trying to get topics
        try:
            topics = topic_model.get_topics()
            is_trained = topics and len(topics) > 1
        except Exception:
            is_trained = False

        if not is_trained:
            # Model not trained, fit on documents
            logger.info("Training model on provided documents...")
            topics_assigned, probs = topic_model.fit_transform(docs_to_process)
        else:
            # Model trained, transform new documents
            topics_assigned, probs = topic_model.transform(docs_to_process)

        # Map topics back to original document indices if preprocessing was applied
        if request.preprocess:
            full_topic_assignments = map_topics_to_original(
                list(map(int, topics_assigned)), original_indices, original_count
            )
        else:
            full_topic_assignments = list(map(int, topics_assigned))

        # Get topic info
        topic_info = topic_model.get_topic_info()
        topics_dict = topic_model.get_topics()

        # Build response
        topic_representations = []
        for topic_id in topics_dict:
            if topic_id == -1:  # Skip outlier topic
                continue

            keywords_weights = topics_dict[topic_id]
            keywords = [kw for kw, _ in keywords_weights[:10]]
            weights = [float(w) for _, w in keywords_weights[:10]]

            # Get document count for this topic (from full assignments)
            doc_count = sum(1 for t in full_topic_assignments if t == topic_id)

            # Generate label from top keywords
            label = "_".join(keywords[:3]) if keywords else f"Topic_{topic_id}"

            topic_representations.append(
                TopicRepresentation(
                    id=topic_id,
                    keywords=keywords,
                    weights=weights,
                    label=label,
                    document_count=doc_count,
                )
            )

        # Update model info
        model_info["num_topics"] = len(topic_representations)
        model_info["num_documents"] = original_count

        # Save model after training
        save_model()

        return TopicExtractionResponse(
            topics=topic_representations,
            topic_assignments=full_topic_assignments,
            num_topics=len(topic_representations),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Topic extraction failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/topics/{topic_id}", response_model=TopicRepresentation)
async def get_topic(topic_id: int):
    """Get representation for a specific topic."""
    if topic_model is None:
        raise HTTPException(status_code=503, detail="BERTopic model not available")

    try:
        topics_dict = topic_model.get_topics()

        if topic_id not in topics_dict:
            raise HTTPException(status_code=404, detail=f"Topic {topic_id} not found")

        keywords_weights = topics_dict[topic_id]
        keywords = [kw for kw, _ in keywords_weights[:10]]
        weights = [float(w) for _, w in keywords_weights[:10]]

        # Get document count (approximate)
        topic_info = topic_model.get_topic_info()
        doc_count = topic_info[topic_info["Topic"] == topic_id]["Count"].values
        doc_count = int(doc_count[0]) if len(doc_count) > 0 else 0

        label = "_".join(keywords[:3]) if keywords else f"Topic_{topic_id}"

        return TopicRepresentation(
            id=topic_id,
            keywords=keywords,
            weights=weights,
            label=label,
            document_count=doc_count,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get topic {topic_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/topics/search", response_model=TopicSearchResponse)
async def search_topics(request: TopicSearchRequest):
    """Find topics similar to the query text."""
    if topic_model is None:
        raise HTTPException(status_code=503, detail="BERTopic model not available")

    if not request.query:
        raise HTTPException(status_code=400, detail="Query is required")

    try:
        # Find similar topics using the model
        similar_topics, similarities = topic_model.find_topics(
            request.query, top_n=request.top_k
        )

        topics_dict = topic_model.get_topics()
        results = []

        for topic_id, similarity in zip(similar_topics, similarities):
            if topic_id == -1:
                continue

            keywords_weights = topics_dict.get(topic_id, [])
            keywords = [kw for kw, _ in keywords_weights[:5]]
            label = "_".join(keywords[:3]) if keywords else f"Topic_{topic_id}"

            results.append(
                SimilarTopic(
                    topic_id=topic_id,
                    label=label,
                    similarity=float(similarity),
                    keywords=keywords,
                )
            )

        return TopicSearchResponse(similar_topics=results)

    except Exception as e:
        logger.error(f"Topic search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/topics/transform", response_model=TransformResponse)
async def transform_documents(request: TransformRequest):
    """
    Classify documents using the trained model.

    Preprocessing (enabled by default) cleans documents by:
    - Removing HTML tags, URLs, emails, mentions, hashtags
    - Normalizing whitespace
    - Filtering documents shorter than min_doc_length
    """
    if topic_model is None:
        raise HTTPException(status_code=503, detail="BERTopic model not available")

    if not request.documents:
        raise HTTPException(status_code=400, detail="No documents provided")

    try:
        original_count = len(request.documents)
        logger.info(
            f"Transforming {original_count} documents (preprocess={request.preprocess})"
        )

        # Preprocess documents if enabled
        if request.preprocess:
            docs_to_process, original_indices = preprocess_documents(
                request.documents, min_length=request.min_doc_length
            )
            logger.info(f"After preprocessing: {len(docs_to_process)} documents")

            if not docs_to_process:
                # All documents filtered - return all as outliers
                return TransformResponse(topic_assignments=[-1] * original_count)
        else:
            docs_to_process = request.documents
            original_indices = list(range(original_count))

        topics, _ = topic_model.transform(docs_to_process)

        # Map topics back to original document indices if preprocessing was applied
        if request.preprocess:
            full_topic_assignments = map_topics_to_original(
                list(map(int, topics)), original_indices, original_count
            )
        else:
            full_topic_assignments = list(map(int, topics))

        return TransformResponse(topic_assignments=full_topic_assignments)

    except Exception as e:
        logger.error(f"Document transformation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/topics/trends", response_model=TopicTrendsResponse)
async def get_topic_trends(request: TopicTrendsRequest):
    """
    Get topic trends over time by querying sentiment_analysis data from the database.
    Returns aggregated counts and average sentiment per time period for each topic.
    """
    if topic_model is None:
        raise HTTPException(status_code=503, detail="BERTopic model not available")

    try:
        trends: dict[str, list[TrendPoint]] = {}

        # Determine the SQL date_trunc granularity
        granularity_map = {
            "hour": "hour",
            "day": "day",
            "week": "week",
        }
        sql_granularity = granularity_map.get(request.granularity, "day")

        # Query database for real trend data if pool is available
        if db_pool:
            async with db_pool.acquire() as conn:
                for topic_id in request.topic_ids:
                    # Query sentiment_analysis table for trends
                    # Aggregates by time period with count and average sentiment
                    query = """
                        SELECT 
                            date_trunc($1, sa.analyzed_at) as time_bucket,
                            COUNT(*) as doc_count,
                            AVG(sa.sentiment_score) as avg_sentiment
                        FROM analysis.sentiment_analysis sa
                        JOIN public.collected_data cd ON sa.data_id = cd.id
                        WHERE sa.analyzed_at >= NOW() - INTERVAL '7 days'
                        GROUP BY date_trunc($1, sa.analyzed_at)
                        ORDER BY time_bucket DESC
                        LIMIT 30
                    """

                    rows = await conn.fetch(query, sql_granularity)

                    trend_points = []
                    for row in rows:
                        trend_points.append(
                            TrendPoint(
                                timestamp=row["time_bucket"].isoformat()
                                if row["time_bucket"]
                                else datetime.now().isoformat(),
                                count=int(row["doc_count"]),
                                sentiment=float(row["avg_sentiment"])
                                if row["avg_sentiment"]
                                else 0.0,
                            )
                        )

                    # If no data found, provide empty list
                    if not trend_points:
                        logger.info(f"No trend data found for topic {topic_id}")

                    trends[str(topic_id)] = trend_points
        else:
            # Database pool not available - return empty trends with error logging
            logger.error(
                "Database pool not available - cannot retrieve trend data. "
                "Please ensure database connection is properly configured."
            )
            for topic_id in request.topic_ids:
                trends[str(topic_id)] = []

        return TopicTrendsResponse(trends=trends)

    except Exception as e:
        logger.error(f"Failed to get topic trends: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/model/retrain")
async def retrain_model(documents: list[str]):
    """
    Retrain the model with new documents.
    Use this endpoint to update the model with fresh data.
    """
    global topic_model, model_info

    if topic_model is None:
        raise HTTPException(status_code=503, detail="BERTopic model not available")

    if not documents or len(documents) < MIN_TOPIC_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"At least {MIN_TOPIC_SIZE} documents required for training",
        )

    try:
        logger.info(f"Retraining model with {len(documents)} documents")

        topics, probs = topic_model.fit_transform(documents)

        # Update model info
        topics_dict = topic_model.get_topics()
        model_info["num_topics"] = len([t for t in topics_dict if t != -1])
        model_info["num_documents"] = len(documents)
        model_info["last_trained"] = datetime.now().isoformat()

        # Save model
        save_model()

        return {
            "status": "success",
            "num_topics": model_info["num_topics"],
            "num_documents": len(documents),
        }

    except Exception as e:
        logger.error(f"Model retraining failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8020)
