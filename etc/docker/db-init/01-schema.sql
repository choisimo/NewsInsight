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
    -- Browser Agent configuration (for BROWSER_AGENT source type)
    agent_max_depth INTEGER,
    agent_max_pages INTEGER,
    agent_budget_seconds INTEGER,
    agent_policy VARCHAR(50),
    agent_focus_keywords TEXT,
    agent_custom_prompt TEXT,
    agent_capture_screenshots BOOLEAN,
    agent_extract_structured BOOLEAN,
    agent_excluded_domains TEXT,
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

-- ============================================
-- AI Orchestration Tables (Multi-provider AI Jobs)
-- ============================================

-- AI jobs table for orchestrating multi-provider tasks
CREATE TABLE IF NOT EXISTS ai_jobs (
    job_id VARCHAR(64) PRIMARY KEY,
    topic VARCHAR(512) NOT NULL,
    base_url VARCHAR(2048),
    overall_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    error_message VARCHAR(1024),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_jobs_overall_status ON ai_jobs (overall_status);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_topic ON ai_jobs (topic);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_created_at ON ai_jobs (created_at);

-- Ensure AI job status values
ALTER TABLE ai_jobs
    ADD CONSTRAINT ai_jobs_status_check
    CHECK (overall_status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT'));

-- AI sub-tasks table for individual provider tasks
CREATE TABLE IF NOT EXISTS ai_sub_tasks (
    sub_task_id VARCHAR(64) PRIMARY KEY,
    job_id VARCHAR(64) NOT NULL REFERENCES ai_jobs (job_id) ON DELETE CASCADE,
    provider_id VARCHAR(32) NOT NULL,
    task_type VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    result_json TEXT,
    error_message VARCHAR(1024),
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_sub_tasks_job_id ON ai_sub_tasks (job_id);
CREATE INDEX IF NOT EXISTS idx_ai_sub_tasks_status ON ai_sub_tasks (status);
CREATE INDEX IF NOT EXISTS idx_ai_sub_tasks_provider_id ON ai_sub_tasks (provider_id);
CREATE INDEX IF NOT EXISTS idx_ai_sub_tasks_created_at ON ai_sub_tasks (created_at);

-- Ensure AI sub-task status values
ALTER TABLE ai_sub_tasks
    ADD CONSTRAINT ai_sub_tasks_status_check
    CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT'));

-- Ensure AI provider values
ALTER TABLE ai_sub_tasks
    ADD CONSTRAINT ai_sub_tasks_provider_check
    CHECK (provider_id IN ('UNIVERSAL_AGENT', 'DEEP_READER', 'SCOUT', 'LOCAL_QUICK'));

-- ============================================
-- ML Add-on Plugin System Tables
-- ============================================

-- ML Add-on Registry table
CREATE TABLE IF NOT EXISTS ml_addon (
    id BIGSERIAL PRIMARY KEY,
    addon_key VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL,
    invoke_type VARCHAR(30) NOT NULL,
    endpoint_url VARCHAR(500),
    queue_topic VARCHAR(200),
    storage_path VARCHAR(500),
    auth_type VARCHAR(30) DEFAULT 'NONE',
    auth_credentials TEXT,
    input_schema_version VARCHAR(20) DEFAULT '1.0',
    output_schema_version VARCHAR(20) DEFAULT '1.0',
    timeout_ms INTEGER DEFAULT 30000,
    max_qps INTEGER DEFAULT 10,
    max_retries INTEGER DEFAULT 3,
    depends_on JSONB,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    priority INTEGER DEFAULT 100,
    config JSONB,
    health_check_url VARCHAR(500),
    health_status VARCHAR(20) DEFAULT 'UNKNOWN',
    last_health_check TIMESTAMP,
    owner VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    -- Statistics
    total_executions BIGINT DEFAULT 0,
    success_count BIGINT DEFAULT 0,
    failure_count BIGINT DEFAULT 0,
    avg_latency_ms DOUBLE PRECISION,
    stats_updated_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_addon_category ON ml_addon (category);
CREATE INDEX IF NOT EXISTS idx_addon_enabled ON ml_addon (enabled);
CREATE INDEX IF NOT EXISTS idx_addon_invoke_type ON ml_addon (invoke_type);

-- Ensure addon category values
ALTER TABLE ml_addon
    ADD CONSTRAINT ml_addon_category_check
    CHECK (category IN ('SENTIMENT', 'FACTCHECK', 'BIAS', 'SUMMARIZATION', 'NER', 'TOPIC', 'TOXICITY', 'DISCUSSION', 'CUSTOM'));

-- Ensure addon invoke type values
ALTER TABLE ml_addon
    ADD CONSTRAINT ml_addon_invoke_type_check
    CHECK (invoke_type IN ('HTTP_SYNC', 'HTTP_ASYNC', 'QUEUE', 'INTERNAL', 'FILE_POLL'));

-- Ensure addon auth type values
ALTER TABLE ml_addon
    ADD CONSTRAINT ml_addon_auth_type_check
    CHECK (auth_type IN ('NONE', 'API_KEY', 'BEARER_TOKEN', 'BASIC', 'OAUTH2', 'CUSTOM'));

-- Ensure addon health status values
ALTER TABLE ml_addon
    ADD CONSTRAINT ml_addon_health_status_check
    CHECK (health_status IN ('HEALTHY', 'DEGRADED', 'UNHEALTHY', 'UNKNOWN'));

-- ML Add-on Execution history table
CREATE TABLE IF NOT EXISTS ml_addon_execution (
    id BIGSERIAL PRIMARY KEY,
    request_id VARCHAR(50) NOT NULL UNIQUE,
    batch_id VARCHAR(50),
    addon_id BIGINT NOT NULL REFERENCES ml_addon (id) ON DELETE CASCADE,
    article_id BIGINT,
    target_url VARCHAR(1000),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    request_payload JSONB,
    response_payload JSONB,
    error_message TEXT,
    error_code VARCHAR(50),
    retry_count INTEGER DEFAULT 0,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    latency_ms BIGINT,
    model_version VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    importance VARCHAR(20) DEFAULT 'batch'
);

CREATE INDEX IF NOT EXISTS idx_exec_addon_id ON ml_addon_execution (addon_id);
CREATE INDEX IF NOT EXISTS idx_exec_article_id ON ml_addon_execution (article_id);
CREATE INDEX IF NOT EXISTS idx_exec_status ON ml_addon_execution (status);
CREATE INDEX IF NOT EXISTS idx_exec_created ON ml_addon_execution (created_at);
CREATE INDEX IF NOT EXISTS idx_exec_batch_id ON ml_addon_execution (batch_id);

-- Ensure execution status values
ALTER TABLE ml_addon_execution
    ADD CONSTRAINT ml_addon_execution_status_check
    CHECK (status IN ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED'));

-- ============================================
-- Article Analysis Result Tables
-- ============================================

-- Article Analysis table (aggregated analysis results)
CREATE TABLE IF NOT EXISTS article_analysis (
    id BIGSERIAL PRIMARY KEY,
    article_id BIGINT NOT NULL UNIQUE,
    -- Summary
    summary TEXT,
    key_sentences JSONB,
    -- Sentiment Analysis
    sentiment_score DOUBLE PRECISION,
    sentiment_label VARCHAR(20),
    sentiment_distribution JSONB,
    tone_analysis JSONB,
    -- Bias Analysis
    bias_label VARCHAR(50),
    bias_score DOUBLE PRECISION,
    bias_details JSONB,
    -- Reliability Analysis
    reliability_score DOUBLE PRECISION,
    reliability_grade VARCHAR(20),
    reliability_factors JSONB,
    -- Misinformation / Fact-check
    misinfo_risk VARCHAR(20),
    misinfo_score DOUBLE PRECISION,
    factcheck_status VARCHAR(30),
    factcheck_notes TEXT,
    verified_claims JSONB,
    -- Topics
    topics JSONB,
    topic_scores JSONB,
    -- Named Entity Recognition (NER)
    entities_person JSONB,
    entities_org JSONB,
    entities_location JSONB,
    entities_misc JSONB,
    -- Risk tags
    risk_tags JSONB,
    toxicity_score DOUBLE PRECISION,
    sensationalism_score DOUBLE PRECISION,
    -- Metadata
    analyzed_by JSONB,
    analysis_status JSONB,
    fully_analyzed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analysis_article_id ON article_analysis (article_id);
CREATE INDEX IF NOT EXISTS idx_analysis_reliability ON article_analysis (reliability_score);
CREATE INDEX IF NOT EXISTS idx_analysis_sentiment ON article_analysis (sentiment_label);
CREATE INDEX IF NOT EXISTS idx_analysis_bias ON article_analysis (bias_label);
CREATE INDEX IF NOT EXISTS idx_analysis_misinfo ON article_analysis (misinfo_risk);
CREATE INDEX IF NOT EXISTS idx_analysis_updated ON article_analysis (updated_at);

-- Article Discussion table (community/comments analysis)
CREATE TABLE IF NOT EXISTS article_discussion (
    id BIGSERIAL PRIMARY KEY,
    article_id BIGINT NOT NULL UNIQUE,
    -- Collection metadata
    total_comment_count INTEGER DEFAULT 0,
    analyzed_count INTEGER DEFAULT 0,
    platforms JSONB,
    platform_counts JSONB,
    -- Overall sentiment
    overall_sentiment VARCHAR(20),
    sentiment_distribution JSONB,
    emotion_distribution JSONB,
    dominant_emotion VARCHAR(30),
    -- Stance analysis
    stance_distribution JSONB,
    overall_stance VARCHAR(30),
    -- Toxicity/Quality
    toxicity_score DOUBLE PRECISION,
    hate_speech_ratio DOUBLE PRECISION,
    profanity_ratio DOUBLE PRECISION,
    discussion_quality_score DOUBLE PRECISION,
    -- Keywords/Topics
    top_keywords JSONB,
    emerging_topics JSONB,
    -- Time series
    time_series JSONB,
    sentiment_shift_at TIMESTAMP,
    peak_activity_at TIMESTAMP,
    -- Bot/Manipulation detection
    suspicious_pattern_detected BOOLEAN DEFAULT FALSE,
    bot_likelihood_score DOUBLE PRECISION,
    suspicious_patterns JSONB,
    -- Sample comments
    sample_positive_comments JSONB,
    sample_negative_comments JSONB,
    top_engaged_comments JSONB,
    -- Platform comparison
    platform_sentiment_comparison JSONB,
    -- Metadata
    analyzed_by JSONB,
    last_crawled_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_discussion_article_id ON article_discussion (article_id);
CREATE INDEX IF NOT EXISTS idx_discussion_sentiment ON article_discussion (overall_sentiment);
CREATE INDEX IF NOT EXISTS idx_discussion_updated ON article_discussion (updated_at);

-- ============================================
-- Seed default ML Add-ons
-- ============================================

INSERT INTO ml_addon (addon_key, name, description, category, invoke_type, endpoint_url, health_check_url, enabled, priority, config, timeout_ms)
VALUES 
    -- Sentiment Analysis Add-on (Port 8100)
    ('sentiment-korean-v1', 
     'Korean Sentiment Analyzer', 
     '한국어 뉴스 기사의 감정 분석 (긍정/부정/중립). 키워드 기반 분석 및 감정 분포 제공.', 
     'SENTIMENT', 
     'HTTP_SYNC', 
     'http://sentiment-addon:8100/analyze', 
     'http://sentiment-addon:8100/health',
     TRUE, 10, 
     '{"model": "sentiment-ko-keywords-v1", "language": "ko", "batch_endpoint": "/batch"}',
     30000),
    
    -- Fact-Check Add-on (Port 8101)
    ('factcheck-v1', 
     'Fact Checker', 
     '기사의 사실 검증 및 신뢰도 분석. 출처 신뢰도, 낚시성 탐지, 허위정보 위험도 평가.', 
     'FACTCHECK', 
     'HTTP_SYNC', 
     'http://factcheck-addon:8101/analyze', 
     'http://factcheck-addon:8101/health',
     TRUE, 20, 
     '{"model": "factcheck-ko-heuristic-v1", "timeout_multiplier": 2, "batch_endpoint": "/batch"}',
     60000),
    
    -- Bias Detection Add-on (Port 8102)
    ('bias-detector-v1', 
     'Bias Detector', 
     '정치적/이념적 편향도 분석. 언론사 성향, 프레이밍, 감정적 표현 분석.', 
     'BIAS', 
     'HTTP_SYNC', 
     'http://bias-addon:8102/analyze', 
     'http://bias-addon:8102/health',
     TRUE, 30, 
     '{"model": "bias-ko-heuristic-v1", "spectrum": "korean_media", "batch_endpoint": "/batch"}',
     30000),
    
    -- NER Add-on (placeholder - 향후 구현)
    ('ner-korean-v1', 
     'Korean NER', 
     '한국어 개체명 인식 (인물, 조직, 장소, 날짜 등)', 
     'NER', 
     'HTTP_SYNC', 
     'http://ner-addon:8103/extract', 
     'http://ner-addon:8103/health',
     FALSE, 5, 
     '{"entities": ["PERSON", "ORG", "LOCATION", "DATE"], "model": "kobert-ner"}',
     30000)
ON CONFLICT (addon_key) DO UPDATE SET
    endpoint_url = EXCLUDED.endpoint_url,
    health_check_url = EXCLUDED.health_check_url,
    description = EXCLUDED.description,
    config = EXCLUDED.config,
    timeout_ms = EXCLUDED.timeout_ms,
    updated_at = CURRENT_TIMESTAMP;
