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

-- ============================================
-- Full-Text Search Support for collected_data
-- Uses 'simple' configuration for better Korean text handling
-- ============================================

-- Add tsvector column for full-text search
ALTER TABLE collected_data ADD COLUMN IF NOT EXISTS search_vector TSVECTOR;

-- GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_collected_data_fts ON collected_data USING GIN(search_vector);

-- Composite index for date-filtered FTS queries
CREATE INDEX IF NOT EXISTS idx_collected_data_fts_date ON collected_data (published_date, collected_at) 
    WHERE search_vector IS NOT NULL;

-- Trigger function to update search_vector on INSERT/UPDATE
CREATE OR REPLACE FUNCTION update_collected_data_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    -- Use 'simple' config for Korean (no stemming, just tokenization)
    -- Weight 'A' for title (more important), 'B' for content
    NEW.search_vector := 
        setweight(to_tsvector('simple', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(LEFT(NEW.content, 10000), '')), 'B');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for auto-updating search_vector
DROP TRIGGER IF EXISTS trg_collected_data_search_vector ON collected_data;
CREATE TRIGGER trg_collected_data_search_vector
    BEFORE INSERT OR UPDATE OF title, content ON collected_data
    FOR EACH ROW EXECUTE FUNCTION update_collected_data_search_vector();

-- Backfill existing data (runs on schema init)
-- This updates rows where search_vector is NULL
UPDATE collected_data SET search_vector = 
    setweight(to_tsvector('simple', COALESCE(title, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(LEFT(content, 10000), '')), 'B')
WHERE search_vector IS NULL;

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
-- Deep Search Tables (IntegratedCrawlerService)
-- ============================================
-- DeepSearch uses IntegratedCrawlerService with multiple crawling strategies:
-- - Crawl4AI for JS-rendered pages
-- - Browser-Use API for complex interactions  
-- - Direct HTTP for simple pages
-- - Search Engines (Google, Naver, Daum) for topic-based searches
-- Results are analyzed by AIDove for evidence extraction and stance analysis.

-- Crawl jobs table for deep AI search
CREATE TABLE IF NOT EXISTS crawl_jobs (
    id VARCHAR(64) PRIMARY KEY,
    topic VARCHAR(512) NOT NULL,
    base_url VARCHAR(2048),
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    evidence_count INTEGER DEFAULT 0,
    error_message VARCHAR(1024),
    failure_reason VARCHAR(64),
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
    CHECK (category IN ('SENTIMENT', 'FACTCHECK', 'BIAS', 'SUMMARIZATION', 'NER', 'TOPIC', 'TOXICITY', 'DISCUSSION', 'BOT_DETECTION', 'SOURCE_QUALITY', 'TOPIC_CLASSIFICATION', 'CUSTOM'));

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

    ('bot-detector-v1',
     'Bot Detector',
     'AI/봇 텍스트 탐지 및 패턴 기반 조작 탐지.',
     'BOT_DETECTION',
     'HTTP_SYNC',
     'http://bot-detector:8040/analyze',
     'http://bot-detector:8040/health',
     TRUE, 25,
     '{"threshold": 0.7}',
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

-- ============================================
-- Search History Tables (for persistence of search results)
-- ============================================

-- Enable pg_trgm extension for similarity search (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Search history table
CREATE TABLE IF NOT EXISTS search_history (
    id BIGSERIAL PRIMARY KEY,
    external_id VARCHAR(64) UNIQUE,
    search_type VARCHAR(32) NOT NULL,
    query VARCHAR(1024) NOT NULL,
    time_window VARCHAR(16),
    user_id VARCHAR(64),
    session_id VARCHAR(64),
    parent_search_id BIGINT REFERENCES search_history(id) ON DELETE SET NULL,
    depth_level INTEGER DEFAULT 0,
    result_count INTEGER DEFAULT 0,
    results JSONB,
    ai_summary JSONB,
    discovered_urls JSONB,
    fact_check_results JSONB,
    credibility_score DOUBLE PRECISION,
    stance_distribution JSONB,
    metadata JSONB,
    bookmarked BOOLEAN DEFAULT FALSE,
    tags JSONB,
    notes TEXT,
    duration_ms BIGINT,
    error_message VARCHAR(2048),
    success BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP
);

-- Indexes for search history
CREATE INDEX IF NOT EXISTS idx_search_history_type ON search_history (search_type);
CREATE INDEX IF NOT EXISTS idx_search_history_query ON search_history (query);
CREATE INDEX IF NOT EXISTS idx_search_history_query_trgm ON search_history USING gin (query gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_search_history_created_at ON search_history (created_at);
CREATE INDEX IF NOT EXISTS idx_search_history_user_id ON search_history (user_id);
CREATE INDEX IF NOT EXISTS idx_search_history_parent_id ON search_history (parent_search_id);
CREATE INDEX IF NOT EXISTS idx_search_history_session_id ON search_history (session_id);
CREATE INDEX IF NOT EXISTS idx_search_history_bookmarked ON search_history (bookmarked) WHERE bookmarked = TRUE;
CREATE INDEX IF NOT EXISTS idx_search_history_external_id ON search_history (external_id);

-- Ensure search type values
ALTER TABLE search_history
    ADD CONSTRAINT search_history_type_check
    CHECK (search_type IN ('UNIFIED', 'DEEP_SEARCH', 'FACT_CHECK', 'BROWSER_AGENT'));

-- ============================================
-- Search Template Tables (SmartSearch saved templates)
-- ============================================

-- Search templates table
CREATE TABLE IF NOT EXISTS search_template (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(256) NOT NULL,
    query VARCHAR(1024) NOT NULL,
    mode VARCHAR(32) NOT NULL,
    user_id VARCHAR(64),
    items JSONB,
    description TEXT,
    favorite BOOLEAN DEFAULT FALSE,
    tags JSONB,
    metadata JSONB,
    source_search_id BIGINT REFERENCES search_history(id) ON DELETE SET NULL,
    use_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP
);

-- Indexes for search templates
CREATE INDEX IF NOT EXISTS idx_search_template_user_id ON search_template (user_id);
CREATE INDEX IF NOT EXISTS idx_search_template_mode ON search_template (mode);
CREATE INDEX IF NOT EXISTS idx_search_template_created_at ON search_template (created_at);
CREATE INDEX IF NOT EXISTS idx_search_template_favorite ON search_template (favorite) WHERE favorite = TRUE;

-- ============================================
-- AI Provider Management Tables
-- Multi-provider LLM 지원을 위한 Provider 등록/관리 시스템
-- ============================================

-- AI Providers table (LLM Provider 등록)
CREATE TABLE IF NOT EXISTS ai_providers (
    id BIGSERIAL PRIMARY KEY,
    provider_key VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    provider_type VARCHAR(50) NOT NULL,
    -- Connection settings
    base_url VARCHAR(500) NOT NULL,
    api_version VARCHAR(20),
    -- Authentication
    auth_type VARCHAR(30) NOT NULL DEFAULT 'BEARER_TOKEN',
    api_key_encrypted TEXT,
    auth_header_name VARCHAR(100) DEFAULT 'Authorization',
    auth_header_prefix VARCHAR(50) DEFAULT 'Bearer',
    custom_headers JSONB,
    -- Models
    supported_models JSONB NOT NULL DEFAULT '[]',
    default_model VARCHAR(100),
    -- Rate limiting
    max_requests_per_minute INTEGER DEFAULT 60,
    max_tokens_per_minute INTEGER DEFAULT 100000,
    max_concurrent_requests INTEGER DEFAULT 10,
    -- Pricing (per 1K tokens, USD)
    input_price_per_1k DECIMAL(10, 6) DEFAULT 0.0,
    output_price_per_1k DECIMAL(10, 6) DEFAULT 0.0,
    -- Priority & Load balancing
    priority INTEGER DEFAULT 100,
    weight INTEGER DEFAULT 1,
    is_fallback BOOLEAN DEFAULT FALSE,
    -- Status
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    health_status VARCHAR(20) DEFAULT 'UNKNOWN',
    last_health_check TIMESTAMP,
    health_check_url VARCHAR(500),
    -- Statistics
    total_requests BIGINT DEFAULT 0,
    successful_requests BIGINT DEFAULT 0,
    failed_requests BIGINT DEFAULT 0,
    total_tokens_used BIGINT DEFAULT 0,
    total_cost DECIMAL(12, 4) DEFAULT 0.0,
    avg_latency_ms DOUBLE PRECISION,
    p95_latency_ms DOUBLE PRECISION,
    stats_updated_at TIMESTAMP,
    -- Metadata
    config JSONB,
    tags JSONB,
    owner VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_providers_type ON ai_providers (provider_type);
CREATE INDEX IF NOT EXISTS idx_ai_providers_enabled ON ai_providers (enabled);
CREATE INDEX IF NOT EXISTS idx_ai_providers_priority ON ai_providers (priority);
CREATE INDEX IF NOT EXISTS idx_ai_providers_health ON ai_providers (health_status);

-- Ensure provider type values
ALTER TABLE ai_providers
    ADD CONSTRAINT ai_providers_type_check
    CHECK (provider_type IN ('OPENAI', 'ANTHROPIC', 'GOOGLE', 'AZURE', 'AWS_BEDROCK', 'GROQ', 'DEEPSEEK', 'OLLAMA', 'AIDOVE', 'CUSTOM'));

-- Ensure auth type values
ALTER TABLE ai_providers
    ADD CONSTRAINT ai_providers_auth_type_check
    CHECK (auth_type IN ('NONE', 'API_KEY', 'BEARER_TOKEN', 'BASIC', 'OAUTH2', 'AWS_SIGV4', 'CUSTOM'));

-- Ensure health status values
ALTER TABLE ai_providers
    ADD CONSTRAINT ai_providers_health_status_check
    CHECK (health_status IN ('HEALTHY', 'DEGRADED', 'UNHEALTHY', 'UNKNOWN', 'DISABLED'));

-- AI Provider Models table (지원 모델 상세 정보)
CREATE TABLE IF NOT EXISTS ai_provider_models (
    id BIGSERIAL PRIMARY KEY,
    provider_id BIGINT NOT NULL REFERENCES ai_providers (id) ON DELETE CASCADE,
    model_id VARCHAR(100) NOT NULL,
    model_name VARCHAR(200) NOT NULL,
    description TEXT,
    -- Capabilities
    max_input_tokens INTEGER DEFAULT 4096,
    max_output_tokens INTEGER DEFAULT 4096,
    supports_vision BOOLEAN DEFAULT FALSE,
    supports_function_calling BOOLEAN DEFAULT FALSE,
    supports_streaming BOOLEAN DEFAULT TRUE,
    -- Pricing (per 1K tokens, USD)
    input_price_per_1k DECIMAL(10, 6) DEFAULT 0.0,
    output_price_per_1k DECIMAL(10, 6) DEFAULT 0.0,
    -- Status
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    deprecated BOOLEAN DEFAULT FALSE,
    deprecated_at TIMESTAMP,
    -- Metadata
    config JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE (provider_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_models_provider ON ai_provider_models (provider_id);
CREATE INDEX IF NOT EXISTS idx_ai_provider_models_enabled ON ai_provider_models (enabled);

-- AI Provider Usage Logs table (사용량 기록)
CREATE TABLE IF NOT EXISTS ai_provider_usage_logs (
    id BIGSERIAL PRIMARY KEY,
    provider_id BIGINT NOT NULL REFERENCES ai_providers (id) ON DELETE CASCADE,
    model_id VARCHAR(100),
    request_id VARCHAR(64) NOT NULL,
    -- Request info
    user_id VARCHAR(64),
    session_id VARCHAR(64),
    request_type VARCHAR(50),
    -- Tokens & Cost
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    estimated_cost DECIMAL(10, 6) DEFAULT 0.0,
    -- Timing
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    latency_ms BIGINT,
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    error_code VARCHAR(50),
    error_message TEXT,
    -- Metadata
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_usage_logs_provider ON ai_provider_usage_logs (provider_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_request_id ON ai_provider_usage_logs (request_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON ai_provider_usage_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_status ON ai_provider_usage_logs (status);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON ai_provider_usage_logs (created_at);

-- Ensure usage log status values
ALTER TABLE ai_provider_usage_logs
    ADD CONSTRAINT ai_provider_usage_logs_status_check
    CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'TIMEOUT', 'RATE_LIMITED', 'CANCELLED'));

-- AI Provider Health History table (헬스체크 이력)
CREATE TABLE IF NOT EXISTS ai_provider_health_history (
    id BIGSERIAL PRIMARY KEY,
    provider_id BIGINT NOT NULL REFERENCES ai_providers (id) ON DELETE CASCADE,
    check_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) NOT NULL,
    latency_ms BIGINT,
    error_message TEXT,
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_health_history_provider ON ai_provider_health_history (provider_id);
CREATE INDEX IF NOT EXISTS idx_health_history_time ON ai_provider_health_history (check_time);

-- AI Provider Rate Limit State table (Rate limit 상태 추적)
CREATE TABLE IF NOT EXISTS ai_provider_rate_limits (
    id BIGSERIAL PRIMARY KEY,
    provider_id BIGINT NOT NULL REFERENCES ai_providers (id) ON DELETE CASCADE,
    window_start TIMESTAMP NOT NULL,
    window_type VARCHAR(20) NOT NULL DEFAULT 'MINUTE',
    request_count INTEGER DEFAULT 0,
    token_count INTEGER DEFAULT 0,
    is_limited BOOLEAN DEFAULT FALSE,
    reset_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE (provider_id, window_start, window_type)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_provider ON ai_provider_rate_limits (provider_id);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON ai_provider_rate_limits (window_start);

-- ============================================
-- Seed default AI Providers
-- ============================================

INSERT INTO ai_providers (
    provider_key, name, description, provider_type, base_url, api_version,
    auth_type, supported_models, default_model, priority, enabled, config
)
VALUES 
    -- OpenAI
    ('openai-default',
     'OpenAI',
     'OpenAI GPT 모델 (GPT-4, GPT-4o, GPT-3.5-turbo)',
     'OPENAI',
     'https://api.openai.com/v1',
     'v1',
     'BEARER_TOKEN',
     '["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo"]',
     'gpt-4o',
     100,
     FALSE,
     '{"note": "API key 설정 필요"}'),
    
    -- Anthropic
    ('anthropic-default',
     'Anthropic Claude',
     'Anthropic Claude 모델 (Claude 3.5 Sonnet, Claude 3 Opus)',
     'ANTHROPIC',
     'https://api.anthropic.com',
     '2024-01-01',
     'API_KEY',
     '["claude-3-5-sonnet-20241022", "claude-3-opus-20240229", "claude-3-haiku-20240307"]',
     'claude-3-5-sonnet-20241022',
     90,
     FALSE,
     '{"auth_header_name": "x-api-key", "note": "API key 설정 필요"}'),
    
    -- AiDove (NewsInsight 자체 AI)
    ('aidove-default',
     'AiDove',
     'NewsInsight 전용 AI 어시스턴트 (workflow.nodove.com)',
     'AIDOVE',
     'https://workflow.nodove.com/webhook/aidove',
     'v1',
     'NONE',
     '["aidove"]',
     'aidove',
     50,
     TRUE,
     '{"timeout": 120, "is_internal": true}'),
    
    -- Groq (Fast inference)
    ('groq-default',
     'Groq',
     'Groq 고속 추론 (Llama, Mixtral)',
     'GROQ',
     'https://api.groq.com/openai/v1',
     'v1',
     'BEARER_TOKEN',
     '["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"]',
     'llama-3.3-70b-versatile',
     80,
     FALSE,
     '{"note": "API key 설정 필요, 빠른 추론 속도"}'),
    
    -- DeepSeek
    ('deepseek-default',
     'DeepSeek',
     'DeepSeek AI (저비용 고성능)',
     'DEEPSEEK',
     'https://api.deepseek.com',
     'v1',
     'BEARER_TOKEN',
     '["deepseek-chat", "deepseek-coder"]',
     'deepseek-chat',
     70,
     FALSE,
     '{"note": "API key 설정 필요, 저렴한 가격"}'),
    
    -- Ollama (Local)
    ('ollama-local',
     'Ollama (Local)',
     'Ollama 로컬 모델 서버',
     'OLLAMA',
     'http://localhost:11434',
     'v1',
     'NONE',
     '["llama3.2", "mistral", "codellama", "phi3"]',
     'llama3.2',
     30,
     FALSE,
     '{"is_local": true, "note": "로컬 Ollama 서버 필요"}')
ON CONFLICT (provider_key) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    base_url = EXCLUDED.base_url,
    supported_models = EXCLUDED.supported_models,
    default_model = EXCLUDED.default_model,
    config = EXCLUDED.config,
    updated_at = CURRENT_TIMESTAMP;

-- ============================================
-- Vector Search (pgvector) for Hybrid Search
-- ============================================
-- Enables semantic/vector search using embeddings.
-- Uses intfloat/multilingual-e5-large model (1024 dimensions).
-- Requires PostgreSQL 15+ with pgvector extension.

-- Install pgvector extension (if available)
-- Note: This requires the pgvector extension to be installed in PostgreSQL
-- Installation: CREATE EXTENSION vector;
-- In Docker, use: ankane/pgvector or timescale/timescaledb-ha image
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
        CREATE EXTENSION IF NOT EXISTS vector;
        RAISE NOTICE 'pgvector extension created successfully';
    ELSE
        RAISE NOTICE 'pgvector extension not available - vector search will be disabled';
    END IF;
END $$;

-- Add embedding column to collected_data table
-- Only if vector extension is available
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        -- Add embedding column (1024 dimensions for e5-large model)
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'collected_data' AND column_name = 'embedding'
        ) THEN
            ALTER TABLE collected_data ADD COLUMN embedding vector(1024);
            RAISE NOTICE 'Added embedding column to collected_data table';
        END IF;
        
        -- Create IVFFlat index for approximate nearest neighbor search
        -- lists = 100 is good for ~100K-1M documents
        -- For smaller datasets, use exact search without index
        IF NOT EXISTS (
            SELECT 1 FROM pg_indexes WHERE indexname = 'idx_collected_data_embedding'
        ) THEN
            -- Use IVFFlat index for larger datasets (>10K documents)
            -- Alternative: HNSW index for better recall but more memory
            CREATE INDEX IF NOT EXISTS idx_collected_data_embedding 
                ON collected_data 
                USING ivfflat (embedding vector_cosine_ops) 
                WITH (lists = 100);
            RAISE NOTICE 'Created IVFFlat index on embedding column';
        END IF;
    END IF;
END $$;

-- Create embedding batch job table for async embedding generation
CREATE TABLE IF NOT EXISTS embedding_jobs (
    id BIGSERIAL PRIMARY KEY,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    total_documents INTEGER DEFAULT 0,
    processed_documents INTEGER DEFAULT 0,
    failed_documents INTEGER DEFAULT 0,
    last_processed_id BIGINT,
    error_message TEXT,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_embedding_jobs_status ON embedding_jobs (status);
CREATE INDEX IF NOT EXISTS idx_embedding_jobs_created ON embedding_jobs (created_at);

-- Ensure embedding job status values
ALTER TABLE embedding_jobs
    ADD CONSTRAINT embedding_jobs_status_check
    CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'));

