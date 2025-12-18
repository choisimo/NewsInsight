"""
ML Training Service - Production Version

FastAPI-based ML training service that supports multiple model types:
- Sentiment Analysis (BERT-based)
- ABSA (Aspect-Based Sentiment Analysis)
- NER (Named Entity Recognition)
- Text Classification
- Embedding Models

This service performs REAL training using HuggingFace Transformers.
"""

import os
import uuid
import json
import asyncio
import hashlib
import threading
import secrets
import shutil
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Optional, AsyncGenerator
from enum import Enum
from dataclasses import dataclass, field, asdict
from contextlib import asynccontextmanager
from collections import deque

import structlog
from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

# Configure structlog
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

log = structlog.get_logger()

# Environment configuration
MODEL_DIR = Path(os.getenv("MODEL_DIR", "/app/models"))
DATASET_DIR = Path(os.getenv("DATASET_DIR", "/app/datasets"))
LOG_DIR = Path(os.getenv("LOG_DIR", "/app/logs"))
USE_GPU = os.getenv("USE_GPU", "true").lower() == "true"
MAX_CONCURRENT_JOBS = int(os.getenv("MAX_CONCURRENT_JOBS", "2"))

# Ensure directories exist
MODEL_DIR.mkdir(parents=True, exist_ok=True)
DATASET_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)


# =============================================================================
# Enums and Data Classes
# =============================================================================


class JobState(str, Enum):
    PENDING = "PENDING"
    INITIALIZING = "INITIALIZING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class ModelType(str, Enum):
    SENTIMENT = "sentiment"
    ABSA = "absa"
    NER = "ner"
    CLASSIFICATION = "classification"
    EMBEDDING = "embedding"
    TRANSFORMER = "transformer"


@dataclass
class TrainingMetrics:
    epoch: int = 0
    total_epochs: int = 0
    step: int = 0
    total_steps: int = 0
    loss: float = 0.0
    accuracy: float = 0.0
    validation_loss: float = 0.0
    validation_accuracy: float = 0.0
    learning_rate: float = 0.0
    samples_processed: int = 0
    total_samples: int = 0
    f1_score: float = 0.0
    precision: float = 0.0
    recall: float = 0.0


@dataclass
class TrainingJob:
    job_id: str
    model_name: str
    model_type: ModelType
    dataset_path: str
    dataset_format: str
    base_model: Optional[str]
    max_epochs: int
    validation_split: float
    hyperparameters: dict = field(default_factory=dict)
    callbacks: dict = field(default_factory=dict)
    metadata: dict = field(default_factory=dict)
    state: JobState = JobState.PENDING
    progress: float = 0.0
    metrics: TrainingMetrics = field(default_factory=TrainingMetrics)
    error_message: Optional[str] = None
    model_path: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    # For SSE streaming
    event_queue: deque = field(default_factory=lambda: deque(maxlen=100))
    # External training support (Colab/Jupyter)
    is_external: bool = False
    upload_token: Optional[str] = None
    external_worker_info: dict = field(default_factory=dict)


# In-memory job storage (backed by Redis via state_store)
# This dict is a cache, actual persistence is handled by StateStore
jobs: dict[str, TrainingJob] = {}
# Lock for thread-safe operations
jobs_lock = threading.Lock()

# State store instance (initialized in lifespan)
state_store = None


# =============================================================================
# Pydantic Models for API
# =============================================================================


class TrainingRequest(BaseModel):
    model_name: str = Field(..., description="Name of the model to train")
    model_type: str = Field(
        ..., description="Type of model (sentiment, absa, ner, etc.)"
    )
    dataset_path: str = Field(..., description="Path to training dataset")
    dataset_format: str = Field(
        default="csv", description="Format of dataset (csv, jsonl, parquet)"
    )
    base_model: Optional[str] = Field(
        default=None, description="Base model for fine-tuning"
    )
    max_epochs: int = Field(
        default=3, ge=1, le=100, description="Maximum training epochs"
    )
    validation_split: float = Field(
        default=0.1, ge=0.0, le=0.5, description="Validation data split ratio"
    )
    hyperparameters: dict = Field(
        default_factory=dict, description="Training hyperparameters"
    )
    callbacks: dict = Field(default_factory=dict, description="Callback configurations")
    metadata: dict = Field(default_factory=dict, description="Additional metadata")


class TrainingResponse(BaseModel):
    job_id: str
    model_name: str
    model_type: str
    state: str
    progress: float
    created_at: str
    message: str


class JobStatusResponse(BaseModel):
    job_id: str
    model_name: str
    model_type: str
    state: str
    progress: float
    metrics: dict
    error_message: Optional[str]
    model_path: Optional[str]
    created_at: str
    started_at: Optional[str]
    completed_at: Optional[str]
    current_epoch: int = 0
    total_epochs: int = 0


class ModelArtifactResponse(BaseModel):
    model_path: str
    model_name: str
    model_type: str
    framework: str
    version: str
    size_bytes: int
    checksum: str
    metrics: dict
    model_filename: str


class HealthResponse(BaseModel):
    status: str
    version: str
    gpu_available: bool
    active_jobs: int
    supported_model_types: list[str]
    max_concurrent_jobs: int
    redis_connected: bool = False
    persisted_jobs: int = 0


# =============================================================================
# External Training (Colab/Jupyter) Request/Response Models
# =============================================================================


class ExternalTrainingStartRequest(BaseModel):
    """Request to start an external training session from Colab/Jupyter."""

    model_name: str = Field(..., description="Name for the trained model")
    model_type: str = Field(
        default="sentiment", description="Type of model being trained"
    )
    base_model: Optional[str] = Field(
        default=None, description="Base model being fine-tuned (optional)"
    )
    max_epochs: int = Field(default=10, ge=1, le=1000, description="Expected epochs")
    metadata: dict = Field(
        default_factory=dict,
        description="Additional metadata (e.g., Colab notebook URL)",
    )


class ExternalTrainingStartResponse(BaseModel):
    """Response with job_id and upload_token for external training."""

    job_id: str
    upload_token: str
    model_name: str
    model_type: str
    state: str
    created_at: str
    message: str
    api_endpoints: dict = Field(
        default_factory=dict, description="API endpoints for progress/upload/complete"
    )


class ExternalProgressRequest(BaseModel):
    """Request to report training progress from external worker."""

    upload_token: str = Field(
        ..., description="Token received from /train/external/start"
    )
    progress: float = Field(
        default=0.0, ge=0.0, le=100.0, description="Progress percentage (0-100)"
    )
    epoch: int = Field(default=0, ge=0, description="Current epoch")
    total_epochs: int = Field(default=0, ge=0, description="Total epochs")
    step: int = Field(default=0, ge=0, description="Current step")
    total_steps: int = Field(default=0, ge=0, description="Total steps")
    loss: float = Field(default=0.0, description="Current loss value")
    accuracy: float = Field(default=0.0, ge=0.0, le=1.0, description="Current accuracy")
    validation_loss: float = Field(default=0.0, description="Validation loss")
    validation_accuracy: float = Field(
        default=0.0, ge=0.0, le=1.0, description="Validation accuracy"
    )
    f1_score: float = Field(default=0.0, ge=0.0, le=1.0, description="F1 score")
    learning_rate: float = Field(default=0.0, description="Current learning rate")
    message: Optional[str] = Field(default=None, description="Optional status message")


class ExternalCompleteRequest(BaseModel):
    """Request to mark external training as complete."""

    upload_token: str = Field(
        ..., description="Token received from /train/external/start"
    )
    final_metrics: dict = Field(
        default_factory=dict, description="Final training metrics"
    )
    model_path: Optional[str] = Field(
        default=None, description="Path to model if already uploaded"
    )


# =============================================================================
# Training Progress Callback (Real HuggingFace Integration)
# =============================================================================


class TrainingProgressCallback:
    """Custom callback to track training progress for HuggingFace Trainer."""

    def __init__(self, job: TrainingJob):
        self.job = job

    def on_train_begin(self, args, state, control, **kwargs):
        self.job.metrics.total_steps = state.max_steps if state.max_steps else 0
        self.job.metrics.total_epochs = args.num_train_epochs
        self._emit_event(
            "training_started", {"total_steps": self.job.metrics.total_steps}
        )

    def on_step_end(self, args, state, control, **kwargs):
        self.job.metrics.step = state.global_step
        if state.max_steps:
            self.job.progress = (state.global_step / state.max_steps) * 100

        if state.log_history:
            latest = state.log_history[-1]
            self.job.metrics.loss = latest.get("loss", self.job.metrics.loss)
            self.job.metrics.learning_rate = latest.get(
                "learning_rate", self.job.metrics.learning_rate
            )

        self._emit_event(
            "step_completed",
            {
                "step": state.global_step,
                "progress": self.job.progress,
                "loss": self.job.metrics.loss,
            },
        )

    def on_epoch_end(self, args, state, control, **kwargs):
        self.job.metrics.epoch = int(state.epoch) if state.epoch else 0
        self._emit_event(
            "epoch_completed",
            {"epoch": self.job.metrics.epoch, "progress": self.job.progress},
        )

    def on_evaluate(self, args, state, control, metrics=None, **kwargs):
        if metrics:
            self.job.metrics.validation_loss = metrics.get("eval_loss", 0.0)
            self.job.metrics.validation_accuracy = metrics.get("eval_accuracy", 0.0)
            self.job.metrics.f1_score = metrics.get("eval_f1", 0.0)
            self._emit_event(
                "evaluation_completed",
                {
                    "eval_loss": self.job.metrics.validation_loss,
                    "eval_accuracy": self.job.metrics.validation_accuracy,
                },
            )

    def on_train_end(self, args, state, control, **kwargs):
        self._emit_event("training_ended", {"final_step": state.global_step})

    def _emit_event(self, event_type: str, data: dict):
        """Emit event to job's event queue for SSE streaming."""
        event = {
            "type": event_type,
            "timestamp": datetime.utcnow().isoformat(),
            "job_id": self.job.job_id,
            "progress": self.job.progress,
            "state": self.job.state.value,
            "metrics": asdict(self.job.metrics),
            **data,
        }
        self.job.event_queue.append(event)


# =============================================================================
# Real Training Logic
# =============================================================================


def get_default_base_model(model_type: ModelType) -> str:
    """Returns the default base model for each model type."""
    defaults = {
        ModelType.SENTIMENT: "klue/bert-base",
        ModelType.ABSA: "monologg/koelectra-base-v3-discriminator",
        ModelType.NER: "klue/bert-base",
        ModelType.CLASSIFICATION: "klue/roberta-base",
        ModelType.EMBEDDING: "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        ModelType.TRANSFORMER: "klue/bert-base",
    }
    return defaults.get(model_type, "klue/bert-base")


def load_dataset_from_path(
    dataset_path: str, dataset_format: str, validation_split: float
):
    """Load dataset from file path with proper format handling."""
    from datasets import load_dataset, Dataset, DatasetDict
    import pandas as pd

    path = Path(dataset_path)
    if not path.exists():
        # Check in DATASET_DIR
        path = DATASET_DIR / dataset_path
        if not path.exists():
            raise FileNotFoundError(f"Dataset not found: {dataset_path}")

    log.info("Loading dataset", path=str(path), format=dataset_format)

    if dataset_format == "csv":
        df = pd.read_csv(path)
    elif dataset_format == "jsonl":
        df = pd.read_json(path, lines=True)
    elif dataset_format == "json":
        df = pd.read_json(path)
    elif dataset_format == "parquet":
        df = pd.read_parquet(path)
    else:
        raise ValueError(f"Unsupported dataset format: {dataset_format}")

    # Convert to HuggingFace dataset
    dataset = Dataset.from_pandas(df)

    # Split into train/validation
    if validation_split > 0:
        split = dataset.train_test_split(test_size=validation_split, seed=42)
        return DatasetDict({"train": split["train"], "validation": split["test"]})
    else:
        return DatasetDict({"train": dataset})


def compute_metrics(eval_pred):
    """Compute evaluation metrics."""
    import numpy as np
    from sklearn.metrics import accuracy_score, precision_recall_fscore_support

    predictions, labels = eval_pred
    if isinstance(predictions, tuple):
        predictions = predictions[0]
    predictions = np.argmax(predictions, axis=-1)

    accuracy = accuracy_score(labels, predictions)
    precision, recall, f1, _ = precision_recall_fscore_support(
        labels, predictions, average="weighted", zero_division=0
    )

    return {"accuracy": accuracy, "precision": precision, "recall": recall, "f1": f1}


async def run_training(job: TrainingJob):
    """
    Runs actual training using HuggingFace Transformers.
    This is the production implementation.
    """
    try:
        # Import ML libraries
        import torch
        from transformers import (
            AutoTokenizer,
            AutoModelForSequenceClassification,
            Trainer,
            TrainingArguments,
            TrainerCallback,
            EarlyStoppingCallback,
        )

        job.state = JobState.INITIALIZING
        job.started_at = datetime.utcnow().isoformat()
        log.info(
            "Initializing training", job_id=job.job_id, model_type=job.model_type.value
        )

        # Determine device
        device = "cuda" if torch.cuda.is_available() and USE_GPU else "cpu"
        log.info(
            "Using device", device=device, cuda_available=torch.cuda.is_available()
        )

        # Determine base model
        base_model = job.base_model or get_default_base_model(job.model_type)
        log.info("Loading base model", base_model=base_model)

        # Load tokenizer and model
        tokenizer = AutoTokenizer.from_pretrained(base_model)

        # Load dataset
        dataset = load_dataset_from_path(
            job.dataset_path, job.dataset_format, job.validation_split
        )

        # Determine number of labels from dataset
        train_dataset = dataset["train"]
        if "label" in train_dataset.column_names:
            num_labels = len(set(train_dataset["label"]))
        elif "labels" in train_dataset.column_names:
            num_labels = len(set(train_dataset["labels"]))
        else:
            num_labels = 2  # Default binary classification

        log.info(
            "Dataset loaded", train_samples=len(train_dataset), num_labels=num_labels
        )

        job.metrics.total_samples = len(train_dataset)

        # Load model
        model = AutoModelForSequenceClassification.from_pretrained(
            base_model, num_labels=num_labels
        )
        model.to(device)

        # Tokenize dataset
        def tokenize_function(examples):
            # Try different text column names
            text_column = None
            for col in ["text", "content", "sentence", "review", "document"]:
                if col in examples:
                    text_column = col
                    break

            if text_column is None:
                raise ValueError(
                    f"No text column found. Available: {list(examples.keys())}"
                )

            return tokenizer(
                examples[text_column],
                padding="max_length",
                truncation=True,
                max_length=job.hyperparameters.get("max_length", 512),
            )

        tokenized_dataset = dataset.map(tokenize_function, batched=True)

        # Prepare output directory
        output_dir = MODEL_DIR / job.job_id
        output_dir.mkdir(parents=True, exist_ok=True)

        # Extract hyperparameters
        batch_size = job.hyperparameters.get("batch_size", 16)
        learning_rate = job.hyperparameters.get("learning_rate", 2e-5)
        warmup_steps = job.hyperparameters.get("warmup_steps", 500)
        weight_decay = job.hyperparameters.get("weight_decay", 0.01)

        # Training arguments
        training_args = TrainingArguments(
            output_dir=str(output_dir),
            num_train_epochs=job.max_epochs,
            per_device_train_batch_size=batch_size,
            per_device_eval_batch_size=batch_size,
            warmup_steps=warmup_steps,
            weight_decay=weight_decay,
            learning_rate=learning_rate,
            logging_dir=str(LOG_DIR / job.job_id),
            logging_steps=10,
            eval_strategy="epoch" if "validation" in tokenized_dataset else "no",
            save_strategy="epoch",
            load_best_model_at_end=True if "validation" in tokenized_dataset else False,
            save_total_limit=2,
            report_to=[],  # Disable wandb, etc.
            disable_tqdm=True,  # We use our own progress tracking
            fp16=torch.cuda.is_available()
            and USE_GPU,  # Use mixed precision if available
        )

        # Create custom callback for progress tracking
        class ProgressCallback(TrainerCallback):
            def __init__(self, training_job: TrainingJob):
                self.job = training_job

            def on_train_begin(self, args, state, control, **kwargs):
                self.job.state = JobState.RUNNING
                self.job.metrics.total_steps = state.max_steps or 0
                self.job.metrics.total_epochs = int(args.num_train_epochs)
                self._emit("training_started")

            def on_step_end(self, args, state, control, **kwargs):
                self.job.metrics.step = state.global_step
                if state.max_steps:
                    self.job.progress = (state.global_step / state.max_steps) * 100

                if state.log_history:
                    latest = state.log_history[-1]
                    self.job.metrics.loss = latest.get("loss", self.job.metrics.loss)
                    self.job.metrics.learning_rate = latest.get("learning_rate", 0.0)

                # Emit every 10 steps
                if state.global_step % 10 == 0:
                    self._emit("step_update")

            def on_epoch_end(self, args, state, control, **kwargs):
                self.job.metrics.epoch = int(state.epoch) if state.epoch else 0
                self._emit("epoch_completed")

            def on_evaluate(self, args, state, control, metrics=None, **kwargs):
                if metrics:
                    self.job.metrics.validation_loss = metrics.get("eval_loss", 0.0)
                    self.job.metrics.validation_accuracy = metrics.get(
                        "eval_accuracy", 0.0
                    )
                    self.job.metrics.f1_score = metrics.get("eval_f1", 0.0)
                    self.job.metrics.precision = metrics.get("eval_precision", 0.0)
                    self.job.metrics.recall = metrics.get("eval_recall", 0.0)
                self._emit("evaluation_completed")

            def _emit(self, event_type: str):
                event = {
                    "type": event_type,
                    "timestamp": datetime.utcnow().isoformat(),
                    "job_id": self.job.job_id,
                    "progress": round(self.job.progress, 2),
                    "state": self.job.state.value,
                    "metrics": {
                        "epoch": self.job.metrics.epoch,
                        "step": self.job.metrics.step,
                        "loss": round(self.job.metrics.loss, 4)
                        if self.job.metrics.loss
                        else 0,
                        "accuracy": round(self.job.metrics.accuracy, 4)
                        if self.job.metrics.accuracy
                        else 0,
                        "validation_loss": round(self.job.metrics.validation_loss, 4)
                        if self.job.metrics.validation_loss
                        else 0,
                        "validation_accuracy": round(
                            self.job.metrics.validation_accuracy, 4
                        )
                        if self.job.metrics.validation_accuracy
                        else 0,
                        "f1_score": round(self.job.metrics.f1_score, 4)
                        if self.job.metrics.f1_score
                        else 0,
                        "learning_rate": self.job.metrics.learning_rate,
                    },
                }
                self.job.event_queue.append(event)

        # Create Trainer
        trainer = Trainer(
            model=model,
            args=training_args,
            train_dataset=tokenized_dataset["train"],
            eval_dataset=tokenized_dataset.get("validation"),
            tokenizer=tokenizer,
            compute_metrics=compute_metrics
            if "validation" in tokenized_dataset
            else None,
            callbacks=[
                ProgressCallback(job),
                EarlyStoppingCallback(early_stopping_patience=3)
                if "validation" in tokenized_dataset
                else None,
            ],
        )

        # Filter None callbacks
        trainer.callback_handler.callbacks = [
            cb for cb in trainer.callback_handler.callbacks if cb is not None
        ]

        log.info("Starting training", job_id=job.job_id)

        # Train
        trainer.train()

        # Save final model
        final_model_path = output_dir / "final"
        trainer.save_model(str(final_model_path))
        tokenizer.save_pretrained(str(final_model_path))

        # Save training info
        training_info = {
            "job_id": job.job_id,
            "model_name": job.model_name,
            "model_type": job.model_type.value,
            "base_model": base_model,
            "final_metrics": asdict(job.metrics),
            "hyperparameters": job.hyperparameters,
            "completed_at": datetime.utcnow().isoformat(),
        }

        with open(final_model_path / "training_info.json", "w") as f:
            json.dump(training_info, f, indent=2)

        job.model_path = str(final_model_path)
        job.state = JobState.COMPLETED
        job.completed_at = datetime.utcnow().isoformat()
        job.progress = 100.0

        # Final metrics from evaluation
        if "validation" in tokenized_dataset:
            final_metrics = trainer.evaluate()
            job.metrics.accuracy = final_metrics.get("eval_accuracy", 0.0)
            job.metrics.f1_score = final_metrics.get("eval_f1", 0.0)

        log.info(
            "Training completed",
            job_id=job.job_id,
            model_path=job.model_path,
            final_accuracy=job.metrics.accuracy,
        )

        # Emit completion event
        job.event_queue.append(
            {
                "type": "training_completed",
                "timestamp": datetime.utcnow().isoformat(),
                "job_id": job.job_id,
                "progress": 100.0,
                "state": JobState.COMPLETED.value,
                "model_path": job.model_path,
                "metrics": asdict(job.metrics),
            }
        )

    except Exception as e:
        job.state = JobState.FAILED
        job.error_message = str(e)
        job.completed_at = datetime.utcnow().isoformat()
        log.error("Training failed", job_id=job.job_id, error=str(e), exc_info=True)

        # Emit failure event
        job.event_queue.append(
            {
                "type": "training_failed",
                "timestamp": datetime.utcnow().isoformat(),
                "job_id": job.job_id,
                "state": JobState.FAILED.value,
                "error": str(e),
            }
        )


async def run_training_with_persistence(job: TrainingJob):
    """
    Wrapper around run_training that persists state changes to Redis.
    """
    try:
        # Save initial state
        if state_store:
            await state_store.save_job(job.job_id, job)

        # Run the actual training
        await run_training(job)

    finally:
        # Always save final state (success or failure)
        if state_store:
            await state_store.save_job(job.job_id, job)
            log.info("Job state persisted", job_id=job.job_id, state=job.state.value)


# =============================================================================
# FastAPI Application
# =============================================================================


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    global state_store

    log.info(
        "ML Training Service starting",
        model_dir=str(MODEL_DIR),
        dataset_dir=str(DATASET_DIR),
        max_concurrent_jobs=MAX_CONCURRENT_JOBS,
    )

    # Initialize state store
    from state_store import get_state_store

    state_store = await get_state_store()

    # Load existing jobs from Redis into memory
    if state_store.is_redis_connected:
        log.info("Redis connected, loading persisted jobs")
        memory_store = state_store.get_memory_store()
        with jobs_lock:
            for job_id, job_data in memory_store.items():
                # Reconstruct TrainingJob from stored data
                try:
                    job = TrainingJob(
                        job_id=job_data.get("job_id", job_id),
                        model_name=job_data.get("model_name", "unknown"),
                        model_type=ModelType(job_data.get("model_type", "sentiment")),
                        dataset_path=job_data.get("dataset_path", ""),
                        dataset_format=job_data.get("dataset_format", "csv"),
                        base_model=job_data.get("base_model"),
                        max_epochs=job_data.get("max_epochs", 3),
                        validation_split=job_data.get("validation_split", 0.1),
                        hyperparameters=job_data.get("hyperparameters", {}),
                        callbacks=job_data.get("callbacks", {}),
                        metadata=job_data.get("metadata", {}),
                        state=JobState(job_data.get("state", "PENDING")),
                        progress=job_data.get("progress", 0.0),
                        error_message=job_data.get("error_message"),
                        model_path=job_data.get("model_path"),
                        created_at=job_data.get(
                            "created_at", datetime.utcnow().isoformat()
                        ),
                        started_at=job_data.get("started_at"),
                        completed_at=job_data.get("completed_at"),
                        # External training fields
                        is_external=job_data.get("is_external", False),
                        upload_token=job_data.get("upload_token"),
                        external_worker_info=job_data.get("external_worker_info", {}),
                    )
                    # Restore metrics
                    if "metrics" in job_data:
                        m = job_data["metrics"]
                        job.metrics = TrainingMetrics(
                            epoch=m.get("epoch", 0),
                            total_epochs=m.get("total_epochs", 0),
                            step=m.get("step", 0),
                            total_steps=m.get("total_steps", 0),
                            loss=m.get("loss", 0.0),
                            accuracy=m.get("accuracy", 0.0),
                            validation_loss=m.get("validation_loss", 0.0),
                            validation_accuracy=m.get("validation_accuracy", 0.0),
                            learning_rate=m.get("learning_rate", 0.0),
                            samples_processed=m.get("samples_processed", 0),
                            total_samples=m.get("total_samples", 0),
                            f1_score=m.get("f1_score", 0.0),
                            precision=m.get("precision", 0.0),
                            recall=m.get("recall", 0.0),
                        )
                    jobs[job_id] = job
                    log.info(
                        "Loaded persisted job", job_id=job_id, state=job.state.value
                    )
                except Exception as e:
                    log.warning("Failed to restore job", job_id=job_id, error=str(e))
    else:
        log.warning(
            "Redis not available, using in-memory storage only (data will be lost on restart)"
        )

    yield

    # Cleanup: save all jobs before shutdown
    if state_store:
        log.info("Saving jobs before shutdown")
        with jobs_lock:
            for job_id, job in jobs.items():
                await state_store.save_job(job_id, job)
        await state_store.disconnect()

    log.info("ML Training Service shutting down")


app = FastAPI(
    title="ML Training Service",
    description="Production ML model training service for sentiment analysis, ABSA, NER, and more",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint for service discovery."""
    try:
        import torch

        gpu_available = torch.cuda.is_available()
    except ImportError:
        gpu_available = False

    with jobs_lock:
        active_jobs = sum(
            1
            for j in jobs.values()
            if j.state in [JobState.RUNNING, JobState.INITIALIZING]
        )

    return HealthResponse(
        status="healthy",
        version="2.0.0",
        gpu_available=gpu_available,
        active_jobs=active_jobs,
        supported_model_types=[t.value for t in ModelType],
        max_concurrent_jobs=MAX_CONCURRENT_JOBS,
        redis_connected=state_store.is_redis_connected if state_store else False,
        persisted_jobs=len(state_store.get_memory_store()) if state_store else 0,
    )


@app.post("/train", response_model=TrainingResponse)
async def submit_training_job(
    request: TrainingRequest, background_tasks: BackgroundTasks
):
    """Submit a new training job."""
    # Check concurrent job limit
    with jobs_lock:
        active_jobs = sum(
            1
            for j in jobs.values()
            if j.state in [JobState.RUNNING, JobState.INITIALIZING, JobState.PENDING]
        )
        if active_jobs >= MAX_CONCURRENT_JOBS:
            raise HTTPException(
                status_code=429,
                detail=f"Maximum concurrent jobs ({MAX_CONCURRENT_JOBS}) reached. Please wait.",
            )

    job_id = str(uuid.uuid4())

    try:
        model_type = ModelType(request.model_type.lower())
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model type: {request.model_type}. "
            f"Supported types: {[t.value for t in ModelType]}",
        )

    job = TrainingJob(
        job_id=job_id,
        model_name=request.model_name,
        model_type=model_type,
        dataset_path=request.dataset_path,
        dataset_format=request.dataset_format,
        base_model=request.base_model,
        max_epochs=request.max_epochs,
        validation_split=request.validation_split,
        hyperparameters=request.hyperparameters,
        callbacks=request.callbacks,
        metadata=request.metadata,
    )

    with jobs_lock:
        jobs[job_id] = job

    # Persist job to Redis
    if state_store:
        await state_store.save_job(job_id, job)

    # Start training in background - ALWAYS use real training
    background_tasks.add_task(run_training_with_persistence, job)

    log.info("Training job submitted", job_id=job_id, model_name=request.model_name)

    return TrainingResponse(
        job_id=job_id,
        model_name=job.model_name,
        model_type=job.model_type.value,
        state=job.state.value,
        progress=job.progress,
        created_at=job.created_at,
        message="Training job submitted successfully",
    )


@app.get("/jobs/{job_id}/status", response_model=JobStatusResponse)
async def get_job_status(job_id: str):
    """Get the status of a training job."""
    with jobs_lock:
        if job_id not in jobs:
            raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
        job = jobs[job_id]

    return JobStatusResponse(
        job_id=job.job_id,
        model_name=job.model_name,
        model_type=job.model_type.value,
        state=job.state.value,
        progress=round(job.progress, 2),
        metrics=asdict(job.metrics),
        error_message=job.error_message,
        model_path=job.model_path,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        current_epoch=job.metrics.epoch,
        total_epochs=job.metrics.total_epochs,
    )


@app.get("/jobs/{job_id}/stream")
async def stream_job_status(job_id: str):
    """
    SSE endpoint for real-time training progress updates.
    """
    with jobs_lock:
        if job_id not in jobs:
            raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")

    async def event_generator() -> AsyncGenerator[str, None]:
        last_sent_index = 0

        while True:
            with jobs_lock:
                if job_id not in jobs:
                    break
                job = jobs[job_id]

                # Send any new events
                events = list(job.event_queue)
                new_events = events[last_sent_index:]
                last_sent_index = len(events)

            for event in new_events:
                yield f"data: {json.dumps(event)}\n\n"

            # Check if job is done
            if job.state in [JobState.COMPLETED, JobState.FAILED, JobState.CANCELLED]:
                # Send final status
                final_event = {
                    "type": "job_finished",
                    "job_id": job_id,
                    "state": job.state.value,
                    "progress": job.progress,
                    "model_path": job.model_path,
                    "error_message": job.error_message,
                }
                yield f"data: {json.dumps(final_event)}\n\n"
                break

            await asyncio.sleep(1)  # Poll interval

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    """Cancel a training job."""
    with jobs_lock:
        if job_id not in jobs:
            raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")

        job = jobs[job_id]

        if job.state not in [JobState.PENDING, JobState.RUNNING, JobState.INITIALIZING]:
            raise HTTPException(
                status_code=400, detail=f"Cannot cancel job in state: {job.state.value}"
            )

        job.state = JobState.CANCELLED
        job.completed_at = datetime.utcnow().isoformat()

    log.info("Training job cancelled", job_id=job_id)

    return {"success": True, "message": "Job cancelled successfully"}


@app.get("/jobs/{job_id}/artifact", response_model=ModelArtifactResponse)
async def get_model_artifact(job_id: str):
    """Get the trained model artifact information."""
    with jobs_lock:
        if job_id not in jobs:
            raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
        job = jobs[job_id]

    if job.state != JobState.COMPLETED:
        raise HTTPException(
            status_code=400, detail=f"Model not available. Job state: {job.state.value}"
        )

    if not job.model_path or not Path(str(job.model_path)).exists():
        raise HTTPException(status_code=404, detail="Model artifact not found")

    # Calculate file size and checksum
    model_path = Path(job.model_path)

    # Get total size of all files in directory
    size_bytes = sum(f.stat().st_size for f in model_path.rglob("*") if f.is_file())

    # Checksum of the config file
    config_file = model_path / "config.json"
    if config_file.exists():
        with open(config_file, "rb") as f:
            checksum = hashlib.sha256(f.read()).hexdigest()
    else:
        checksum = "directory"

    return ModelArtifactResponse(
        model_path=str(job.model_path),
        model_name=job.model_name,
        model_type=job.model_type.value,
        framework="pytorch",
        version="1.0.0",
        size_bytes=size_bytes,
        checksum=checksum,
        metrics={
            "accuracy": job.metrics.accuracy,
            "f1_score": job.metrics.f1_score,
            "precision": job.metrics.precision,
            "recall": job.metrics.recall,
            "final_loss": job.metrics.loss,
        },
        model_filename=f"{job.model_name}_{job.job_id[:8]}",
    )


@app.get("/jobs/{job_id}/model/meta")
async def get_model_metadata(job_id: str):
    """Get model metadata for download."""
    with jobs_lock:
        if job_id not in jobs:
            raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
        job = jobs[job_id]

    if job.state != JobState.COMPLETED:
        raise HTTPException(status_code=400, detail="Model not ready")

    model_path = Path(job.model_path)
    size_bytes = sum(f.stat().st_size for f in model_path.rglob("*") if f.is_file())

    return {
        "model_name": job.model_name,
        "model_type": job.model_type.value,
        "model_filename": f"{job.model_name}_{job.job_id[:8]}",
        "format": "huggingface",
        "size_bytes": size_bytes,
        "metrics": asdict(job.metrics),
        "checksum": "directory",
        "version": "1.0.0",
    }


@app.get("/jobs")
async def list_jobs(
    state: Optional[str] = None, model_type: Optional[str] = None, limit: int = 50
):
    """List training jobs with optional filtering."""
    result = []

    with jobs_lock:
        for job in list(jobs.values())[-limit:]:
            if state and job.state.value.lower() != state.lower():
                continue
            if model_type and job.model_type.value.lower() != model_type.lower():
                continue

            result.append(
                {
                    "job_id": job.job_id,
                    "model_name": job.model_name,
                    "model_type": job.model_type.value,
                    "state": job.state.value,
                    "progress": round(job.progress, 2),
                    "created_at": job.created_at,
                    "completed_at": job.completed_at,
                }
            )

    return {"jobs": result, "total": len(result)}


@app.get("/models")
async def list_models():
    """List available trained models."""
    models = []

    with jobs_lock:
        for job in jobs.values():
            if job.state == JobState.COMPLETED and job.model_path:
                models.append(
                    {
                        "job_id": job.job_id,
                        "model_name": job.model_name,
                        "model_type": job.model_type.value,
                        "model_path": job.model_path,
                        "accuracy": job.metrics.accuracy,
                        "f1_score": job.metrics.f1_score,
                        "completed_at": job.completed_at,
                    }
                )

    return {"models": models, "total": len(models)}


@app.get("/supported-types")
async def get_supported_types():
    """Get list of supported model types with their default configurations."""
    return {
        "types": [
            {
                "type": t.value,
                "default_base_model": get_default_base_model(t),
                "description": get_model_type_description(t),
            }
            for t in ModelType
        ]
    }


def get_model_type_description(model_type: ModelType) -> str:
    """Returns description for each model type."""
    descriptions = {
        ModelType.SENTIMENT: "Binary or multi-class sentiment classification",
        ModelType.ABSA: "Aspect-Based Sentiment Analysis for fine-grained opinion mining",
        ModelType.NER: "Named Entity Recognition for extracting entities from text",
        ModelType.CLASSIFICATION: "General text classification for custom categories",
        ModelType.EMBEDDING: "Text embedding models for semantic similarity",
        ModelType.TRANSFORMER: "Custom transformer models for various NLP tasks",
    }
    return descriptions.get(model_type, "")


# =============================================================================
# External Training API (Colab/Jupyter Integration)
# =============================================================================


def _verify_upload_token(job_id: str, token: str) -> TrainingJob:
    """Verify upload token and return the job if valid."""
    with jobs_lock:
        if job_id not in jobs:
            raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
        job = jobs[job_id]
        if not job.is_external:
            raise HTTPException(
                status_code=400, detail="This job is not an external training job"
            )
        if job.upload_token != token:
            raise HTTPException(status_code=403, detail="Invalid upload token")
        return job


@app.post("/train/external/start", response_model=ExternalTrainingStartResponse)
async def start_external_training(request: ExternalTrainingStartRequest):
    """
    Start an external training session (Colab/Jupyter).

    Returns a job_id and upload_token that the external worker uses to:
    - Report training progress via POST /jobs/{job_id}/progress
    - Upload the trained model via POST /jobs/{job_id}/upload
    - Mark training as complete via POST /jobs/{job_id}/complete
    """
    job_id = str(uuid.uuid4())
    upload_token = secrets.token_urlsafe(32)

    try:
        model_type = ModelType(request.model_type.lower())
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model type: {request.model_type}. "
            f"Supported types: {[t.value for t in ModelType]}",
        )

    job = TrainingJob(
        job_id=job_id,
        model_name=request.model_name,
        model_type=model_type,
        dataset_path="external",  # Not applicable for external training
        dataset_format="external",
        base_model=request.base_model,
        max_epochs=request.max_epochs,
        validation_split=0.0,
        metadata=request.metadata,
        state=JobState.PENDING,
        is_external=True,
        upload_token=upload_token,
        external_worker_info={
            "registered_at": datetime.utcnow().isoformat(),
            "source": request.metadata.get("source", "unknown"),
        },
    )

    with jobs_lock:
        jobs[job_id] = job

    # Persist job to Redis
    if state_store:
        await state_store.save_job(job_id, job)

    log.info(
        "External training session started",
        job_id=job_id,
        model_name=request.model_name,
        model_type=model_type.value,
    )

    return ExternalTrainingStartResponse(
        job_id=job_id,
        upload_token=upload_token,
        model_name=job.model_name,
        model_type=job.model_type.value,
        state=job.state.value,
        created_at=job.created_at,
        message="External training session created. Use the upload_token for progress updates and model upload.",
        api_endpoints={
            "progress": f"/jobs/{job_id}/progress",
            "upload": f"/jobs/{job_id}/upload",
            "complete": f"/jobs/{job_id}/complete",
            "status": f"/jobs/{job_id}/status",
            "stream": f"/jobs/{job_id}/stream",
        },
    )


@app.post("/jobs/{job_id}/progress")
async def report_external_progress(job_id: str, request: ExternalProgressRequest):
    """
    Report training progress from external worker (Colab/Jupyter).

    The external worker should call this endpoint periodically to update
    the dashboard with current training metrics.
    """
    job = _verify_upload_token(job_id, request.upload_token)

    # Update job state if still pending
    if job.state == JobState.PENDING:
        job.state = JobState.RUNNING
        job.started_at = datetime.utcnow().isoformat()

    # Update progress and metrics
    job.progress = request.progress
    job.metrics.epoch = request.epoch
    job.metrics.total_epochs = request.total_epochs
    job.metrics.step = request.step
    job.metrics.total_steps = request.total_steps
    job.metrics.loss = request.loss
    job.metrics.accuracy = request.accuracy
    job.metrics.validation_loss = request.validation_loss
    job.metrics.validation_accuracy = request.validation_accuracy
    job.metrics.f1_score = request.f1_score
    job.metrics.learning_rate = request.learning_rate

    # Emit SSE event
    event = {
        "type": "external_progress",
        "timestamp": datetime.utcnow().isoformat(),
        "job_id": job_id,
        "progress": round(job.progress, 2),
        "state": job.state.value,
        "metrics": {
            "epoch": job.metrics.epoch,
            "total_epochs": job.metrics.total_epochs,
            "step": job.metrics.step,
            "loss": round(job.metrics.loss, 4) if job.metrics.loss else 0,
            "accuracy": round(job.metrics.accuracy, 4) if job.metrics.accuracy else 0,
            "validation_loss": round(job.metrics.validation_loss, 4)
            if job.metrics.validation_loss
            else 0,
            "validation_accuracy": round(job.metrics.validation_accuracy, 4)
            if job.metrics.validation_accuracy
            else 0,
            "f1_score": round(job.metrics.f1_score, 4) if job.metrics.f1_score else 0,
        },
        "message": request.message,
    }
    job.event_queue.append(event)

    # Persist to Redis
    if state_store:
        await state_store.save_job(job_id, job)

    log.debug(
        "External progress reported",
        job_id=job_id,
        progress=job.progress,
        epoch=job.metrics.epoch,
    )

    return {
        "success": True,
        "job_id": job_id,
        "progress": job.progress,
        "state": job.state.value,
    }


@app.post("/jobs/{job_id}/upload")
async def upload_external_model(
    job_id: str,
    upload_token: str = Form(...),
    model_file: UploadFile = File(...),
):
    """
    Upload trained model artifact from external worker (Colab/Jupyter).

    Accepts .pt, .pth, .bin, .safetensors, .h5, .pkl, .joblib, .onnx files,
    or a .zip archive containing the model directory.
    """
    job = _verify_upload_token(job_id, upload_token)

    # Validate file extension
    allowed_extensions = {
        ".pt",
        ".pth",
        ".bin",
        ".safetensors",
        ".h5",
        ".pkl",
        ".joblib",
        ".onnx",
        ".zip",
    }
    file_ext = Path(model_file.filename or "").suffix.lower()
    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file_ext}. Allowed: {allowed_extensions}",
        )

    # Create model directory
    model_dir = MODEL_DIR / job_id / "external"
    model_dir.mkdir(parents=True, exist_ok=True)

    try:
        if file_ext == ".zip":
            # Save and extract zip file
            zip_path = model_dir / "model.zip"
            with open(zip_path, "wb") as f:
                content = await model_file.read()
                f.write(content)

            # Extract zip contents
            with zipfile.ZipFile(zip_path, "r") as zip_ref:
                zip_ref.extractall(model_dir)

            # Remove the zip file after extraction
            zip_path.unlink()
            log.info("Model zip extracted", job_id=job_id, path=str(model_dir))
        else:
            # Save single file
            file_path = model_dir / (model_file.filename or f"model{file_ext}")
            with open(file_path, "wb") as f:
                content = await model_file.read()
                f.write(content)
            log.info("Model file saved", job_id=job_id, path=str(file_path))

        # Update job with model path
        job.model_path = str(model_dir)
        job.external_worker_info["model_uploaded_at"] = datetime.utcnow().isoformat()
        job.external_worker_info["original_filename"] = model_file.filename

        # Persist to Redis
        if state_store:
            await state_store.save_job(job_id, job)

        # Emit SSE event
        event = {
            "type": "model_uploaded",
            "timestamp": datetime.utcnow().isoformat(),
            "job_id": job_id,
            "model_path": job.model_path,
        }
        job.event_queue.append(event)

        return {
            "success": True,
            "job_id": job_id,
            "model_path": job.model_path,
            "message": "Model uploaded successfully",
        }

    except Exception as e:
        log.error("Model upload failed", job_id=job_id, error=str(e))
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@app.post("/jobs/{job_id}/complete")
async def complete_external_training(job_id: str, request: ExternalCompleteRequest):
    """
    Mark external training job as complete.

    Should be called after the model has been uploaded (or if using external storage).
    """
    job = _verify_upload_token(job_id, request.upload_token)

    if job.state == JobState.COMPLETED:
        return {
            "success": True,
            "job_id": job_id,
            "message": "Job already completed",
            "state": job.state.value,
        }

    # Update final metrics if provided
    if request.final_metrics:
        job.metrics.accuracy = request.final_metrics.get(
            "accuracy", job.metrics.accuracy
        )
        job.metrics.f1_score = request.final_metrics.get(
            "f1_score", job.metrics.f1_score
        )
        job.metrics.precision = request.final_metrics.get(
            "precision", job.metrics.precision
        )
        job.metrics.recall = request.final_metrics.get("recall", job.metrics.recall)
        job.metrics.loss = request.final_metrics.get("loss", job.metrics.loss)
        job.metrics.validation_loss = request.final_metrics.get(
            "validation_loss", job.metrics.validation_loss
        )
        job.metrics.validation_accuracy = request.final_metrics.get(
            "validation_accuracy", job.metrics.validation_accuracy
        )

    # Update model path if provided
    if request.model_path:
        job.model_path = request.model_path

    # Mark as complete
    job.state = JobState.COMPLETED
    job.progress = 100.0
    job.completed_at = datetime.utcnow().isoformat()

    # Create training info file
    if job.model_path:
        training_info_path = Path(job.model_path) / "training_info.json"
        if training_info_path.parent.exists():
            training_info = {
                "job_id": job.job_id,
                "model_name": job.model_name,
                "model_type": job.model_type.value,
                "base_model": job.base_model,
                "is_external": True,
                "source": job.external_worker_info.get("source", "external"),
                "final_metrics": asdict(job.metrics),
                "completed_at": job.completed_at,
            }
            try:
                with open(training_info_path, "w") as f:
                    json.dump(training_info, f, indent=2)
            except Exception as e:
                log.warning("Failed to save training info", error=str(e))

    # Persist to Redis
    if state_store:
        await state_store.save_job(job_id, job)

    # Emit SSE event
    event = {
        "type": "training_completed",
        "timestamp": datetime.utcnow().isoformat(),
        "job_id": job_id,
        "progress": 100.0,
        "state": JobState.COMPLETED.value,
        "model_path": job.model_path,
        "metrics": asdict(job.metrics),
    }
    job.event_queue.append(event)

    log.info(
        "External training completed",
        job_id=job_id,
        model_name=job.model_name,
        model_path=job.model_path,
        accuracy=job.metrics.accuracy,
    )

    return {
        "success": True,
        "job_id": job_id,
        "state": job.state.value,
        "model_path": job.model_path,
        "metrics": asdict(job.metrics),
        "message": "External training completed successfully",
    }


# =============================================================================
# Inference API
# =============================================================================


# Global model cache for inference
_model_cache: dict[str, tuple] = {}  # job_id -> (tokenizer, model)
_model_cache_lock = threading.Lock()


class InferenceRequest(BaseModel):
    """Request for model inference."""

    text: str = Field(
        ..., min_length=1, max_length=10000, description="Text to analyze"
    )
    texts: Optional[list[str]] = Field(
        None, description="Batch of texts (alternative to single text)"
    )
    aspects: Optional[list[str]] = Field(
        None, description="Aspects to analyze (for ABSA)"
    )
    max_length: int = Field(512, ge=32, le=2048, description="Maximum token length")
    return_probabilities: bool = Field(True, description="Return class probabilities")


class AspectSentiment(BaseModel):
    """Aspect sentiment result."""

    sentimentScore: float = Field(
        ..., ge=-1.0, le=1.0, description="Sentiment score -1 to 1"
    )
    sentimentLabel: str = Field(..., description="positive/negative/neutral")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence score")


class OverallSentiment(BaseModel):
    """Overall sentiment result."""

    score: float = Field(..., ge=-1.0, le=1.0)
    label: str


class InferenceResponse(BaseModel):
    """Response from model inference."""

    analysisId: str
    contentId: Optional[str] = None
    textPreview: str
    aspectsAnalyzed: list[str]
    aspectSentiments: dict[str, AspectSentiment]
    overallSentiment: OverallSentiment
    confidence: float
    analyzedAt: str
    modelUsed: str
    modelType: str
    responseTimeMs: int


def load_model_for_inference(job_id: str) -> tuple:
    """
    Load a trained model for inference with caching.
    Returns (tokenizer, model) tuple.
    """
    with _model_cache_lock:
        if job_id in _model_cache:
            return _model_cache[job_id]

    # Get job info
    with jobs_lock:
        if job_id not in jobs:
            raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
        job = jobs[job_id]

    if job.state != JobState.COMPLETED:
        raise HTTPException(
            status_code=400, detail=f"Model not available. Job state: {job.state.value}"
        )

    if not job.model_path or not Path(job.model_path).exists():
        raise HTTPException(status_code=404, detail="Model artifact not found")

    try:
        from transformers import AutoTokenizer, AutoModelForSequenceClassification
        import torch

        model_path = job.model_path
        tokenizer = AutoTokenizer.from_pretrained(model_path)
        model = AutoModelForSequenceClassification.from_pretrained(model_path)

        # Move to GPU if available
        device = "cuda" if USE_GPU and torch.cuda.is_available() else "cpu"
        model = model.to(device)
        model.eval()

        with _model_cache_lock:
            _model_cache[job_id] = (tokenizer, model, device)

        log.info("Model loaded for inference", job_id=job_id, device=device)
        return tokenizer, model, device

    except Exception as e:
        log.error("Failed to load model", job_id=job_id, error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to load model: {str(e)}")


def compute_sentiment_label(score: float) -> str:
    """Convert sentiment score to label."""
    if score > 0.1:
        return "positive"
    elif score < -0.1:
        return "negative"
    return "neutral"


@app.post("/inference/{job_id}", response_model=InferenceResponse)
async def run_inference(job_id: str, request: InferenceRequest):
    """
    Run inference using a trained model.

    For ABSA models, analyzes sentiment for each aspect.
    For sentiment/classification models, returns overall sentiment.
    """
    import time
    import torch

    start_time = time.time()

    # Load model
    tokenizer, model, device = load_model_for_inference(job_id)

    # Get job info for model type
    with jobs_lock:
        job = jobs[job_id]

    texts = request.texts or [request.text]
    aspects = request.aspects or []

    # For ABSA: if no aspects provided, analyze full text
    if not aspects:
        aspects = ["전체"]  # Default aspect

    aspect_sentiments: dict[str, AspectSentiment] = {}
    all_scores = []

    try:
        for aspect in aspects:
            # For ABSA, combine aspect with text
            if job.model_type == ModelType.ABSA and aspect != "전체":
                input_text = f"[{aspect}] {texts[0]}"
            else:
                input_text = texts[0]

            # Tokenize
            inputs = tokenizer(
                input_text,
                return_tensors="pt",
                truncation=True,
                max_length=request.max_length,
                padding=True,
            )
            inputs = {k: v.to(device) for k, v in inputs.items()}

            # Inference
            with torch.no_grad():
                outputs = model(**inputs)

            logits = outputs.logits
            probabilities = torch.softmax(logits, dim=-1).cpu().numpy()[0]

            # Determine sentiment (assuming binary or 3-class classification)
            num_classes = len(probabilities)

            if num_classes == 2:
                # Binary: [negative, positive]
                sentiment_score = float(probabilities[1] - probabilities[0])
                confidence = float(max(probabilities))
            elif num_classes == 3:
                # 3-class: [negative, neutral, positive]
                sentiment_score = float(probabilities[2] - probabilities[0])
                confidence = float(max(probabilities))
            else:
                # Multi-class: use argmax
                predicted_class = int(probabilities.argmax())
                sentiment_score = (
                    float(2 * (predicted_class / (num_classes - 1)) - 1)
                    if num_classes > 1
                    else 0.0
                )
                confidence = float(probabilities[predicted_class])

            all_scores.append(sentiment_score)

            aspect_sentiments[aspect] = AspectSentiment(
                sentimentScore=round(sentiment_score, 4),
                sentimentLabel=compute_sentiment_label(sentiment_score),
                confidence=round(confidence, 4),
            )

        # Compute overall sentiment (average of all aspects)
        overall_score = sum(all_scores) / len(all_scores) if all_scores else 0.0
        overall_confidence = (
            sum(a.confidence for a in aspect_sentiments.values())
            / len(aspect_sentiments)
            if aspect_sentiments
            else 0.0
        )

        response_time_ms = int((time.time() - start_time) * 1000)

        return InferenceResponse(
            analysisId=str(uuid.uuid4()),
            contentId=None,
            textPreview=texts[0][:200] + "..." if len(texts[0]) > 200 else texts[0],
            aspectsAnalyzed=list(aspect_sentiments.keys()),
            aspectSentiments=aspect_sentiments,
            overallSentiment=OverallSentiment(
                score=round(overall_score, 4),
                label=compute_sentiment_label(overall_score),
            ),
            confidence=round(overall_confidence, 4),
            analyzedAt=datetime.utcnow().isoformat(),
            modelUsed=job.model_name,
            modelType=job.model_type.value,
            responseTimeMs=response_time_ms,
        )

    except Exception as e:
        log.error("Inference failed", job_id=job_id, error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=f"Inference failed: {str(e)}")


@app.post("/inference/by-name/{model_name}", response_model=InferenceResponse)
async def run_inference_by_name(model_name: str, request: InferenceRequest):
    """
    Run inference using a model by name (uses latest completed model with that name).
    """
    # Find the latest completed job with this model name
    job_id = None
    latest_completed_at = None

    with jobs_lock:
        for job in jobs.values():
            if (
                job.model_name == model_name
                and job.state == JobState.COMPLETED
                and job.model_path
            ):
                if latest_completed_at is None or (
                    job.completed_at and job.completed_at > latest_completed_at
                ):
                    job_id = job.job_id
                    latest_completed_at = job.completed_at

    if not job_id:
        raise HTTPException(
            status_code=404, detail=f"No completed model found with name: {model_name}"
        )

    return await run_inference(job_id, request)


@app.delete("/inference/cache/{job_id}")
async def clear_model_cache(job_id: str):
    """Clear a model from the inference cache to free memory."""
    with _model_cache_lock:
        if job_id in _model_cache:
            del _model_cache[job_id]
            return {"success": True, "message": f"Model {job_id} removed from cache"}
    return {"success": False, "message": "Model not in cache"}


@app.get("/inference/cache/status")
async def get_cache_status():
    """Get inference cache status."""
    with _model_cache_lock:
        cached_models = list(_model_cache.keys())
    return {
        "cached_models": cached_models,
        "total_cached": len(cached_models),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8090)
