from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, Boolean, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.sql import func
from app.config import settings

connection_url = settings.database_url
if connection_url.startswith("postgresql"):
    engine = create_engine(connection_url, pool_pre_ping=True)
else:
    engine = create_engine("sqlite:///./collector.db", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class DataSource(Base):
    __tablename__ = "data_sources"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    url = Column(Text, nullable=False)
    source_type = Column(String(50), nullable=False)  # 'rss', 'web', 'api'
    is_active = Column(Boolean, default=True)
    last_collected = Column(DateTime(timezone=True))
    collection_frequency = Column(Integer, default=3600)  # seconds
    metadata_json = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

class CollectedData(Base):
    __tablename__ = "collected_data"
    
    id = Column(Integer, primary_key=True, index=True)
    source_id = Column(Integer, nullable=False)
    title = Column(Text)
    content = Column(Text)
    url = Column(Text)
    published_date = Column(DateTime(timezone=True))
    collected_at = Column(DateTime(timezone=True), server_default=func.now())
    content_hash = Column(String(64), index=True)  # For deduplication
    metadata_json = Column(JSON)
    processed = Column(Boolean, default=False)

class CollectionJob(Base):
    __tablename__ = "collection_jobs"
    
    id = Column(Integer, primary_key=True, index=True)
    source_id = Column(Integer, nullable=False)
    status = Column(String(50), default='pending')  # 'pending', 'running', 'completed', 'failed'
    started_at = Column(DateTime(timezone=True))
    completed_at = Column(DateTime(timezone=True))
    items_collected = Column(Integer, default=0)
    error_message = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()