-- Initial schema for NewsInsight collector service

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- Data sources table
CREATE TABLE IF NOT EXISTS data_sources (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    source_type VARCHAR(50) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_collected TIMESTAMP,
    collection_frequency INTEGER NOT NULL DEFAULT 3600,
    metadata_json JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_source_type ON data_sources (source_type);
CREATE INDEX IF NOT EXISTS idx_is_active ON data_sources (is_active);

-- Collection jobs table
CREATE TABLE IF NOT EXISTS collection_jobs (
    id BIGSERIAL PRIMARY KEY,
    source_id BIGINT NOT NULL REFERENCES data_sources (id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    items_collected INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_collection_jobs_source_id ON collection_jobs (source_id);
CREATE INDEX IF NOT EXISTS idx_collection_jobs_status ON collection_jobs (status);
CREATE INDEX IF NOT EXISTS idx_collection_jobs_created_at ON collection_jobs (created_at);

-- Collected data table
CREATE TABLE IF NOT EXISTS collected_data (
    id BIGSERIAL PRIMARY KEY,
    source_id BIGINT NOT NULL REFERENCES data_sources (id) ON DELETE CASCADE,
    title TEXT,
    content TEXT,
    url TEXT,
    published_date TIMESTAMP,
    collected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    content_hash VARCHAR(64),
    metadata_json JSONB,
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    http_ok BOOLEAN,
    has_content BOOLEAN,
    duplicate BOOLEAN,
    normalized BOOLEAN,
    quality_score DOUBLE PRECISION,
    semantic_consistency DOUBLE PRECISION,
    outlier_score DOUBLE PRECISION,
    trust_score DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS idx_collected_data_source_id ON collected_data (source_id);
CREATE INDEX IF NOT EXISTS idx_collected_data_content_hash ON collected_data (content_hash);
CREATE INDEX IF NOT EXISTS idx_collected_data_processed ON collected_data (processed);
CREATE INDEX IF NOT EXISTS idx_collected_data_collected_at ON collected_data (collected_at);

-- Seed data sources (optional example records)
INSERT INTO data_sources (name, url, source_type, is_active, collection_frequency)
VALUES
    ('Example RSS Feed', 'https://example.com/rss', 'RSS', TRUE, 3600)
ON CONFLICT DO NOTHING;

-- Ensure status value is uppercase
ALTER TABLE collection_jobs
    ADD CONSTRAINT collection_jobs_status_check
    CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'));

-- ============================================
-- Deep AI Search Tables (n8n Crawl Agent)
-- ============================================

-- Crawl jobs table for deep AI search
CREATE TABLE IF NOT EXISTS crawl_jobs (
    id VARCHAR(64) PRIMARY KEY,
    topic VARCHAR(512) NOT NULL,
    base_url VARCHAR(2048),
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    evidence_count INTEGER DEFAULT 0,
    error_message VARCHAR(1024),
    callback_received BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_crawl_jobs_status ON crawl_jobs (status);
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_topic ON crawl_jobs (topic);
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_created_at ON crawl_jobs (created_at);

-- Ensure crawl job status values
ALTER TABLE crawl_jobs
    ADD CONSTRAINT crawl_jobs_status_check
    CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT'));

-- Crawl evidence table for storing search results
CREATE TABLE IF NOT EXISTS crawl_evidence (
    id BIGSERIAL PRIMARY KEY,
    job_id VARCHAR(64) NOT NULL REFERENCES crawl_jobs (id) ON DELETE CASCADE,
    url VARCHAR(2048),
    title VARCHAR(512),
    stance VARCHAR(16),
    snippet TEXT,
    source VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_crawl_evidence_job_id ON crawl_evidence (job_id);
CREATE INDEX IF NOT EXISTS idx_crawl_evidence_stance ON crawl_evidence (stance);

-- Ensure evidence stance values
ALTER TABLE crawl_evidence
    ADD CONSTRAINT crawl_evidence_stance_check
    CHECK (stance IS NULL OR stance IN ('PRO', 'CON', 'NEUTRAL'));
