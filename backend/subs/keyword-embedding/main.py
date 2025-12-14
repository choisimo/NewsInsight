"""
Keyword Embedding Service

This service provides semantic search capabilities for Korean keywords using ChromaDB.
It replaces PostgreSQL's full-text search with embedding-based semantic search.

Features:
- Embeds keywords using HuggingFace text-embeddings-inference server
- Stores embeddings in ChromaDB for fast similarity search
- Syncs keywords from PostgreSQL to ChromaDB
- Provides semantic search API for finding similar keywords
"""

import os
import sys
import json
import logging
import uuid
from typing import Optional
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, BackgroundTasks
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
EMBEDDING_SERVER_URL = os.getenv("EMBEDDING_SERVER_URL", "http://embedding-server:80")
CHROMADB_URL = os.getenv("CHROMADB_URL", "http://chromadb:8000")
CHROMADB_HOST = os.getenv("CHROMADB_HOST", "chromadb")
CHROMADB_PORT = int(os.getenv("CHROMADB_PORT", "8000"))
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "postgres")
POSTGRES_PORT = int(os.getenv("POSTGRES_PORT", "5432"))
POSTGRES_DB = os.getenv("POSTGRES_DB", "osint_db")
POSTGRES_USER = os.getenv("POSTGRES_USER", "osint_user")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "osint_password")

# Collection name for keywords
KEYWORDS_COLLECTION = "osint_keywords"
TENANT = "default_tenant"
DATABASE = "default_database"

# Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# Pydantic models
class KeywordCreate(BaseModel):
    id: str
    keyword: str
    keyword_type: str = "seed"
    domain: Optional[str] = None
    language: str = "ko"
    metadata: Optional[dict] = None


class KeywordBatch(BaseModel):
    keywords: list[KeywordCreate]


class SearchRequest(BaseModel):
    query: str
    limit: int = 10
    domain: Optional[str] = None
    keyword_type: Optional[str] = None


class SearchResult(BaseModel):
    id: str
    keyword: str
    score: float
    metadata: dict


class SearchResponse(BaseModel):
    results: list[SearchResult]
    query: str


class SyncRequest(BaseModel):
    full_sync: bool = False


# ChromaDB HTTP Client Helper
class ChromaDBClient:
    """Simple HTTP client for ChromaDB API v2."""

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.api_base = f"{self.base_url}/api/v2/tenants/{TENANT}/databases/{DATABASE}"

    async def heartbeat(self) -> bool:
        """Check if ChromaDB is alive."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{self.base_url}/api/v2")
            return response.status_code == 200

    async def get_or_create_collection(self, name: str, metadata: dict = None) -> dict:
        """Get or create a collection."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Try to get existing collection
            response = await client.get(f"{self.api_base}/collections/{name}")
            if response.status_code == 200:
                return response.json()

            # Create new collection
            payload = {"name": name, "metadata": metadata or {}, "get_or_create": True}
            response = await client.post(f"{self.api_base}/collections", json=payload)
            response.raise_for_status()
            return response.json()

    async def upsert(
        self,
        collection_id: str,
        ids: list[str],
        embeddings: list[list[float]],
        documents: list[str],
        metadatas: list[dict],
    ) -> dict:
        """Upsert documents into a collection."""
        async with httpx.AsyncClient(timeout=60.0) as client:
            payload = {
                "ids": ids,
                "embeddings": embeddings,
                "documents": documents,
                "metadatas": metadatas,
            }
            response = await client.post(
                f"{self.api_base}/collections/{collection_id}/upsert", json=payload
            )
            response.raise_for_status()
            return response.json()

    async def query(
        self,
        collection_id: str,
        query_embeddings: list[list[float]],
        n_results: int = 10,
        where: dict = None,
    ) -> dict:
        """Query a collection for similar documents."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            payload = {
                "query_embeddings": query_embeddings,
                "n_results": n_results,
                "include": ["documents", "metadatas", "distances"],
            }
            if where:
                payload["where"] = where

            response = await client.post(
                f"{self.api_base}/collections/{collection_id}/query", json=payload
            )
            response.raise_for_status()
            return response.json()

    async def delete(self, collection_id: str, ids: list[str]) -> dict:
        """Delete documents from a collection."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            payload = {"ids": ids}
            response = await client.post(
                f"{self.api_base}/collections/{collection_id}/delete", json=payload
            )
            response.raise_for_status()
            return response.json()

    async def count(self, collection_id: str) -> int:
        """Get count of documents in a collection."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{self.api_base}/collections/{collection_id}/count"
            )
            response.raise_for_status()
            return response.json()


# Global clients
chroma_client: Optional[ChromaDBClient] = None
collection_info: Optional[dict] = None


def get_chroma_client() -> ChromaDBClient:
    global chroma_client
    if chroma_client is None:
        chroma_client = ChromaDBClient(f"http://{CHROMADB_HOST}:{CHROMADB_PORT}")
    return chroma_client


async def get_embedding(text: str) -> list[float]:
    """Get embedding vector from the embedding server."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{EMBEDDING_SERVER_URL}/embed", json={"inputs": text}
        )
        response.raise_for_status()
        embeddings = response.json()
        if isinstance(embeddings, list) and len(embeddings) > 0:
            return embeddings[0]
        raise ValueError("Invalid embedding response")


async def get_embeddings_batch(texts: list[str]) -> list[list[float]]:
    """Get embedding vectors for multiple texts."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{EMBEDDING_SERVER_URL}/embed", json={"inputs": texts}
        )
        response.raise_for_status()
        return response.json()


async def ensure_collection() -> dict:
    """Ensure the keywords collection exists and return its info."""
    global collection_info
    if collection_info is None:
        client = get_chroma_client()
        collection_info = await client.get_or_create_collection(
            name=KEYWORDS_COLLECTION,
            metadata={
                "description": "OSINT keywords with semantic embeddings",
                "hnsw:space": "cosine",
            },
        )
    return collection_info


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize ChromaDB collection on startup."""
    logger.info("Initializing keyword embedding service...")
    try:
        client = get_chroma_client()
        if await client.heartbeat():
            logger.info("ChromaDB connection established")
            await ensure_collection()
            logger.info(f"ChromaDB collection '{KEYWORDS_COLLECTION}' ready")
        else:
            logger.error("Failed to connect to ChromaDB")
    except Exception as e:
        logger.error(f"Failed to initialize ChromaDB: {e}")
    yield
    logger.info("Shutting down keyword embedding service...")


app = FastAPI(
    title="Keyword Embedding Service",
    description="Semantic search for OSINT keywords using ChromaDB",
    version="0.1.0",
    lifespan=lifespan,
)

# Setup Prometheus metrics
SERVICE_NAME = "keyword-embedding"
if METRICS_AVAILABLE:
    setup_metrics(app, SERVICE_NAME, version="0.1.0")
    service_metrics = ServiceMetrics(SERVICE_NAME)
    # Create service-specific metrics
    embeddings_generated = service_metrics.create_counter(
        "embeddings_generated_total", "Total embeddings generated", ["operation"]
    )
    search_requests = service_metrics.create_counter(
        "search_requests_total", "Total semantic search requests", ["status"]
    )
    chromadb_operations = service_metrics.create_histogram(
        "chromadb_operation_seconds", "ChromaDB operation latency", ["operation"]
    )
    logger.info("Prometheus metrics enabled for keyword-embedding service")
else:
    service_metrics = None
    logger.warning("Prometheus metrics not available - shared module not found")


@app.get("/health")
@app.head("/health")
async def health():
    """Health check endpoint."""
    try:
        client = get_chroma_client()
        if await client.heartbeat():
            return {
                "status": "healthy",
                "chromadb": "connected",
                "collection": KEYWORDS_COLLECTION,
            }
        raise Exception("ChromaDB not responding")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")


@app.post("/keywords", status_code=201)
async def add_keyword(keyword: KeywordCreate):
    """Add a single keyword with its embedding to ChromaDB."""
    try:
        coll = await ensure_collection()
        client = get_chroma_client()
        embedding = await get_embedding(keyword.keyword)

        metadata = {
            "keyword_type": keyword.keyword_type,
            "language": keyword.language,
        }
        if keyword.domain:
            metadata["domain"] = keyword.domain
        if keyword.metadata:
            metadata.update(keyword.metadata)

        await client.upsert(
            collection_id=coll["id"],
            ids=[keyword.id],
            embeddings=[embedding],
            documents=[keyword.keyword],
            metadatas=[metadata],
        )

        return {"status": "created", "id": keyword.id}
    except Exception as e:
        logger.error(f"Failed to add keyword: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/keywords/batch", status_code=201)
async def add_keywords_batch(batch: KeywordBatch):
    """Add multiple keywords with embeddings to ChromaDB."""
    if not batch.keywords:
        raise HTTPException(status_code=400, detail="No keywords provided")

    try:
        coll = await ensure_collection()
        client = get_chroma_client()

        # Get embeddings for all keywords
        texts = [k.keyword for k in batch.keywords]
        embeddings = await get_embeddings_batch(texts)

        # Prepare data for upsert
        ids = [k.id for k in batch.keywords]
        metadatas = []
        for k in batch.keywords:
            metadata = {
                "keyword_type": k.keyword_type,
                "language": k.language,
            }
            if k.domain:
                metadata["domain"] = k.domain
            if k.metadata:
                metadata.update(k.metadata)
            metadatas.append(metadata)

        await client.upsert(
            collection_id=coll["id"],
            ids=ids,
            embeddings=embeddings,
            documents=texts,
            metadatas=metadatas,
        )

        return {"status": "created", "count": len(ids)}
    except Exception as e:
        logger.error(f"Failed to add keywords batch: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/keywords/{keyword_id}")
async def delete_keyword(keyword_id: str):
    """Delete a keyword from ChromaDB."""
    try:
        coll = await ensure_collection()
        client = get_chroma_client()
        await client.delete(collection_id=coll["id"], ids=[keyword_id])
        return {"status": "deleted", "id": keyword_id}
    except Exception as e:
        logger.error(f"Failed to delete keyword: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/search", response_model=SearchResponse)
async def search_keywords(request: SearchRequest):
    """Search for similar keywords using semantic similarity."""
    try:
        coll = await ensure_collection()
        client = get_chroma_client()

        # Get embedding for the query
        query_embedding = await get_embedding(request.query)

        # Build where filter if specified
        where_filter = None
        conditions = []
        if request.domain:
            conditions.append({"domain": {"$eq": request.domain}})
        if request.keyword_type:
            conditions.append({"keyword_type": {"$eq": request.keyword_type}})

        if len(conditions) == 1:
            where_filter = conditions[0]
        elif len(conditions) > 1:
            where_filter = {"$and": conditions}

        # Query ChromaDB
        results = await client.query(
            collection_id=coll["id"],
            query_embeddings=[query_embedding],
            n_results=request.limit,
            where=where_filter,
        )

        # Format results
        search_results = []
        if results.get("ids") and results["ids"][0]:
            for i, id_ in enumerate(results["ids"][0]):
                # ChromaDB returns distance, convert to similarity score
                distance = results["distances"][0][i] if results.get("distances") else 0
                score = 1 - distance  # For cosine distance

                search_results.append(
                    SearchResult(
                        id=id_,
                        keyword=results["documents"][0][i]
                        if results.get("documents")
                        else "",
                        score=score,
                        metadata=results["metadatas"][0][i]
                        if results.get("metadatas")
                        else {},
                    )
                )

        return SearchResponse(results=search_results, query=request.query)
    except Exception as e:
        logger.error(f"Search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/sync")
async def sync_from_postgres(request: SyncRequest, background_tasks: BackgroundTasks):
    """
    Sync keywords from PostgreSQL to ChromaDB.
    This runs as a background task.
    """
    background_tasks.add_task(run_sync, request.full_sync)
    return {"status": "sync_started", "full_sync": request.full_sync}


async def run_sync(full_sync: bool = False):
    """Background task to sync keywords from PostgreSQL."""
    try:
        import asyncpg

        conn = await asyncpg.connect(
            host=POSTGRES_HOST,
            port=POSTGRES_PORT,
            database=POSTGRES_DB,
            user=POSTGRES_USER,
            password=POSTGRES_PASSWORD,
        )

        try:
            coll = await ensure_collection()
            client = get_chroma_client()

            # Fetch keywords from PostgreSQL
            query = """
                SELECT id::text, keyword, keyword_type, domain, language, metadata
                FROM osint_keywords
                WHERE status != 'archived'
            """
            rows = await conn.fetch(query)

            if not rows:
                logger.info("No keywords to sync")
                return

            # Process in batches
            batch_size = 100
            for i in range(0, len(rows), batch_size):
                batch = rows[i : i + batch_size]

                ids = [str(row["id"]) for row in batch]
                texts = [row["keyword"] for row in batch]

                # Get embeddings
                embeddings = await get_embeddings_batch(texts)

                # Prepare metadata
                metadatas = []
                for row in batch:
                    metadata = {
                        "keyword_type": row["keyword_type"],
                        "language": row["language"] or "ko",
                    }
                    if row["domain"]:
                        metadata["domain"] = row["domain"]
                    if row["metadata"]:
                        extra = (
                            json.loads(row["metadata"])
                            if isinstance(row["metadata"], str)
                            else row["metadata"]
                        )
                        metadata.update(extra)
                    metadatas.append(metadata)

                # Upsert to ChromaDB
                await client.upsert(
                    collection_id=coll["id"],
                    ids=ids,
                    embeddings=embeddings,
                    documents=texts,
                    metadatas=metadatas,
                )

                logger.info(
                    f"Synced {min(i + batch_size, len(rows))}/{len(rows)} keywords"
                )

            logger.info(f"Sync completed: {len(rows)} keywords")
        finally:
            await conn.close()
    except ImportError:
        logger.error("asyncpg not installed. Cannot sync from PostgreSQL.")
    except Exception as e:
        logger.error(f"Sync failed: {e}")


@app.get("/stats")
async def get_stats():
    """Get collection statistics."""
    try:
        coll = await ensure_collection()
        client = get_chroma_client()
        count = await client.count(coll["id"])
        return {
            "collection": KEYWORDS_COLLECTION,
            "count": count,
            "collection_id": coll["id"],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8010)
