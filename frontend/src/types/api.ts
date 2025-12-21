export interface SentimentData {
  pos: number;
  neg: number;
  neu: number;
}

export interface KeywordData {
  word: string;
  score: number;
}

export interface AnalysisResponse {
  query: string;
  window: string;
  article_count: number;
  sentiments: SentimentData;
  top_keywords: KeywordData[];
  analyzed_at: string;
}

export interface Article {
  id: string;
  title: string;
  source: string;
  published_at: string;
  url: string;
  snippet?: string;
}

export interface ArticlesResponse {
  query: string;
  articles: Article[];
  total: number;
}

export type SourceType = "RSS" | "WEB" | "WEB_SEARCH" | "API" | "WEBHOOK" | "BROWSER_AGENT";

export interface DataSource {
  id: number;
  name: string;
  url: string;
  sourceType: SourceType;
  isActive: boolean;
  lastCollected: string | null;
  collectionFrequency: number;
  metadata: Record<string, unknown>;
  searchUrlTemplate?: string;
  searchPriority?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PageResponse<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
  first?: boolean;
  last?: boolean;
  hasNext?: boolean;
  hasPrevious?: boolean;
}

// ============================================
// ML Add-on Types (Backend: /api/v1/ml)
// ============================================

export type AddonCategory =
  | 'SENTIMENT'
  | 'CONTEXT'
  | 'FACTCHECK'
  | 'COMMUNITY'
  | 'SOURCE_QUALITY'
  | 'ENTITY_EXTRACTION'
  | 'SUMMARIZATION'
  | 'TOPIC_CLASSIFICATION'
  | 'TOXICITY'
  | 'MISINFORMATION'
  | 'CUSTOM';

export type AddonInvokeType = 'HTTP_SYNC' | 'HTTP_ASYNC' | 'QUEUE' | 'FILE_POLL';
export type AddonAuthType = 'NONE' | 'API_KEY' | 'BEARER_TOKEN' | 'BASIC' | 'OAUTH2';
export type AddonHealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNKNOWN';
export type ExecutionStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'CANCELLED' | 'SKIPPED';

/** ML Add-on Registry Entity */
export interface MlAddon {
  id: number;
  addonKey: string;
  name: string;
  description?: string;
  category: AddonCategory;
  invokeType: AddonInvokeType;
  endpointUrl?: string;
  queueTopic?: string;
  storagePath?: string;
  authType: AddonAuthType;
  authCredentials?: string;
  timeoutMs: number;
  maxQps: number;
  maxRetries: number;
  dependsOn?: string[];
  enabled: boolean;
  priority: number;
  config?: Record<string, unknown>;
  healthCheckUrl?: string;
  healthStatus: AddonHealthStatus;
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  avgLatencyMs: number;
  createdAt: string;
  updatedAt: string;
}

/** ML Add-on Execution History */
export interface MlAddonExecution {
  id: number;
  requestId: string;
  batchId?: string;
  addon: MlAddon;
  articleId?: number;
  targetUrl?: string;
  status: ExecutionStatus;
  requestPayload?: Record<string, unknown>;
  responsePayload?: Record<string, unknown>;
  errorMessage?: string;
  errorCode?: string;
  retryCount: number;
  latencyMs: number;
  importance?: string;
  createdAt: string;
  completedAt?: string;
}

/** ML Add-on Analysis Request */
export interface MlAddonRequest {
  requestId: string;
  addonId: string;
  task?: string;
  inputSchemaVersion?: string;
  article: {
    id?: number;
    title?: string;
    content?: string;
    url?: string;
    source?: string;
    publishedAt?: string;
    metadata?: Record<string, unknown>;
  };
  comments?: {
    articleId?: string;
    items?: Array<{
      id: string;
      content: string;
      createdAt?: string;
      likes?: number;
      replies?: number;
      authorId?: string;
    }>;
    platform?: string;
  };
  context?: {
    language?: string;
    country?: string;
    previousResults?: Record<string, unknown>;
    relatedArticleIds?: string[];
  };
  options?: {
    importance?: string;
    debug?: boolean;
    timeoutMs?: number;
    params?: Record<string, unknown>;
  };
}

/** ML Add-on Analysis Response */
export interface MlAddonResponse {
  requestId: string;
  addonId: string;
  status: 'success' | 'error' | 'partial';
  outputSchemaVersion?: string;
  results?: MlAnalysisResults;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    retryable?: boolean;
  };
  meta?: {
    processingTimeMs: number;
    modelVersion?: string;
    tokensUsed?: number;
    cacheHit?: boolean;
  };
}

/** ML Analysis Results (all possible analysis types) */
export interface MlAnalysisResults {
  sentiment?: {
    score: number;
    label: 'positive' | 'negative' | 'neutral';
    distribution?: Record<string, number>;
    emotions?: Record<string, number>;
    explanations?: string[];
  };
  reliability?: {
    score: number;
    grade: 'high' | 'medium' | 'low';
    factors?: Record<string, number>;
    warnings?: string[];
    explanations?: string[];
  };
  bias?: {
    label: string;
    score: number;
    details?: Record<string, number>;
    explanations?: string[];
  };
  factcheck?: {
    status: 'verified' | 'suspicious' | 'conflicting' | 'unverified';
    confidence: number;
    claims?: Array<{
      claim: string;
      verdict: string;
      confidence: number;
      sources?: string[];
    }>;
    sources?: string[];
    notes?: string;
  };
  entities?: {
    persons?: Array<{ name: string; count: number; context?: string }>;
    organizations?: Array<{ name: string; count: number; context?: string }>;
    locations?: Array<{ name: string; count: number; context?: string }>;
    misc?: Array<{ name: string; count: number; context?: string }>;
  };
  summary?: {
    abstractiveSummary?: string;
    extractiveSentences?: string[];
    keyPoints?: string[];
  };
  topics?: {
    labels: string[];
    scores?: Record<string, number>;
    primaryTopic?: string;
  };
  discussion?: {
    overallSentiment?: string;
    sentimentDistribution?: Record<string, number>;
    stanceDistribution?: Record<string, number>;
    toxicityScore?: number;
    topKeywords?: Array<{ word: string; count: number }>;
    timeSeries?: Array<{ timestamp: string; count: number }>;
    botLikelihood?: number;
  };
  toxicity?: {
    score: number;
    categories?: Record<string, number>;
    flaggedPhrases?: string[];
  };
  misinformation?: {
    riskLevel: 'low' | 'mid' | 'high';
    score: number;
    indicators?: string[];
    explanations?: string[];
  };
  raw?: Record<string, unknown>;
}

// ============================================
// Dashboard Event Types (Backend: /api/v1/events)
// ============================================

export type DashboardEventType =
  | 'HEARTBEAT'
  | 'NEW_DATA'
  | 'SOURCE_UPDATED'
  | 'STATS_UPDATED'
  | 'COLLECTION_STARTED'
  | 'COLLECTION_COMPLETED'
  | 'ERROR';

/** Dashboard SSE Event */
export interface DashboardEvent {
  eventType: DashboardEventType;
  timestamp: string;
  message?: string;
  data?: Record<string, unknown>;
}

/** Dashboard Statistics */
export interface DashboardStats {
  totalCollected: number;
  todayCollected: number;
  activeSourceCount: number;
  timestamp: number;
}

// ============================================
// Data Source Extended Types
// ============================================

/** Browser Agent Configuration for Data Source */
export interface BrowserAgentConfig {
  enabled: boolean;
  selectors?: {
    title?: string;
    content?: string;
    date?: string;
    author?: string;
  };
  waitForSelector?: string;
  scrollToLoad?: boolean;
  maxScrolls?: number;
  javascript?: boolean;
}

/** Extended Data Source with Browser Agent */
export interface DataSourceExtended extends DataSource {
  browserAgentConfig?: BrowserAgentConfig;
}

// ============================================
// Source Update/Create Request Types
// ============================================

export interface DataSourceCreateRequest {
  name: string;
  url: string;
  sourceType: SourceType;
  collectionFrequency?: number;
  metadata?: Record<string, unknown>;
  browserAgentConfig?: BrowserAgentConfig;
}

export interface DataSourceUpdateRequest {
  name?: string;
  url?: string;
  sourceType?: SourceType;
  collectionFrequency?: number;
  metadata?: Record<string, unknown>;
  browserAgentConfig?: BrowserAgentConfig;
}

// ============================================
// Factcheck Detailed Analytics Types (Backend: /api/ml-addons/factcheck)
// ============================================

/** Analysis mode for factcheck */
export type FactcheckAnalysisMode = 
  | 'heuristic'
  | 'ml_basic'
  | 'ml_full'
  | 'external_api'
  | 'hybrid';

/** Claim verdict */
export type ClaimVerdict = 
  | 'verified'
  | 'false'
  | 'unverified'
  | 'misleading'
  | 'partially_true';

/** Credibility grade */
export type CredibilityGrade = 'A' | 'B' | 'C' | 'D' | 'F';

/** Source credibility analysis from backend */
export interface SourceAnalytics {
  source_name?: string;
  is_trusted: boolean;
  trust_score: number;
  trust_level: 'trusted' | 'unknown' | 'untrusted';
  matched_trusted_source?: string;
  reason: string;
}

/** Clickbait detection analysis from backend */
export interface ClickbaitAnalytics {
  is_clickbait: boolean;
  score: number;
  detected_patterns: Array<{
    pattern: string;
    matched_text: string;
    severity: 'low' | 'medium' | 'high';
  }>;
  total_patterns_checked: number;
}

/** Misinformation risk analysis from backend */
export interface MisinfoAnalytics {
  risk_score: number;
  risk_level: 'low' | 'medium' | 'high';
  detected_patterns: Array<{
    pattern: string;
    matched_text: string;
    type: 'misinformation' | 'unverifiable';
    category?: string;
    severity: 'low' | 'medium' | 'high';
  }>;
  unverifiable_claim_count: number;
}

/** Individual claim analysis from backend */
export interface ClaimAnalytics {
  claim_id: string;
  claim_text: string;
  verdict: ClaimVerdict;
  confidence: number;
  ml_confidence?: number;
  claim_indicator?: string;
  analysis_method: string;
  entities?: Array<{
    entity: string;
    word: string;
    score: number;
  }>;
  semantic_similarity_scores?: Array<{
    reference_index: number;
    similarity: number;
  }>;
  supporting_factors: string[];
  contradicting_factors: string[];
  external_verification?: Record<string, unknown>;
}

/** Score breakdown from backend */
export interface ScoreBreakdown {
  source_weight: number;
  clickbait_weight: number;
  misinfo_weight: number;
  verification_weight: number;
  source_contribution: number;
  clickbait_contribution: number;
  misinfo_contribution: number;
  verification_contribution: number;
  total_score: number;
  grade: CredibilityGrade;
}

/** Detailed analytics returned from factcheck backend */
export interface DetailedAnalytics {
  source_analysis: SourceAnalytics;
  clickbait_analysis: ClickbaitAnalytics;
  misinfo_analysis: MisinfoAnalytics;
  claim_analyses: ClaimAnalytics[];
  score_breakdown: ScoreBreakdown;
  analysis_mode: FactcheckAnalysisMode;
  ml_models_used: string[];
  external_apis_used: string[];
  processing_time_ms: number;
  analyzed_at: string;
}

/** Claim result in factcheck response */
export interface FactcheckClaimResult {
  claim: string;
  verdict: ClaimVerdict;
  confidence: number;
  evidence?: string;
  source_url?: string;
  ml_analysis?: {
    ml_confidence?: number;
    entities?: Array<{ entity: string; word: string; score: number }>;
    supporting: string[];
    contradicting: string[];
  };
}

/** Factcheck result from backend */
export interface FactcheckResult {
  overall_credibility: number;
  credibility_grade: CredibilityGrade;
  verdict: 'verified' | 'suspicious' | 'unverified';
  claims_analyzed: number;
  verified_claims: number;
  false_claims: number;
  unverified_claims: number;
  claims?: FactcheckClaimResult[];
  risk_flags?: string[];
  explanations?: string[];
  detailed_analytics?: DetailedAnalytics;
}

/** Factcheck addon request */
export interface FactcheckAddonRequest {
  request_id: string;
  addon_id: string;
  task?: string;
  input_schema_version?: string;
  article?: {
    id?: number;
    title?: string;
    content?: string;
    url?: string;
    source?: string;
    published_at?: string;
  };
  context?: {
    language?: string;
    country?: string;
  };
  options?: {
    importance?: string;
    debug?: boolean;
    timeout_ms?: number;
    analysis_mode?: FactcheckAnalysisMode;
    include_detailed_analytics?: boolean;
  };
}

/** Factcheck addon response */
export interface FactcheckAddonResponse {
  request_id: string;
  addon_id: string;
  status: 'success' | 'error' | 'partial';
  output_schema_version?: string;
  results?: {
    factcheck?: FactcheckResult;
    raw?: Record<string, unknown>;
  };
  error?: {
    code: string;
    message: string;
    details?: string;
  };
  meta?: {
    model_version: string;
    latency_ms: number;
    processed_at: string;
    ml_enabled?: boolean;
    models_loaded?: string[];
  };
}

// ============================================
// LLM Provider Settings Types (Backend: /api/v1/llm-providers)
// ============================================

/**
 * LLM Provider 타입
 */
export type LlmProviderType = 
  | 'OPENAI'
  | 'ANTHROPIC'
  | 'GOOGLE'
  | 'OPENROUTER'
  | 'OLLAMA'
  | 'AZURE_OPENAI'
  | 'TOGETHER_AI'
  | 'CUSTOM';

/**
 * LLM Provider 타입 정보
 */
export interface LlmProviderTypeInfo {
  value: LlmProviderType;
  displayName: string;
  description: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
}

/**
 * LLM Provider 설정 DTO
 */
export interface LlmProviderSettings {
  id: number;
  providerType: LlmProviderType;
  providerDisplayName: string;
  userId?: string;
  isGlobal: boolean;
  apiKeyMasked: string;
  hasApiKey: boolean;
  defaultModel?: string;
  baseUrl?: string;
  enabled: boolean;
  priority: number;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  maxRequestsPerMinute: number;
  azureDeploymentName?: string;
  azureApiVersion?: string;
  lastTestedAt?: string;
  lastTestSuccess?: boolean;
  createdAt: string;
  updatedAt?: string;
}

/**
 * LLM Provider 설정 요청
 */
export interface LlmProviderSettingsRequest {
  providerType: LlmProviderType;
  apiKey?: string;
  defaultModel?: string;
  baseUrl?: string;
  enabled?: boolean;
  priority?: number;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  maxRequestsPerMinute?: number;
  azureDeploymentName?: string;
  azureApiVersion?: string;
}

/**
 * LLM Provider 연결 테스트 결과
 */
export interface LlmTestResult {
  success: boolean;
  providerType: LlmProviderType;
  message: string;
  error?: string;
  responseTime?: number;
  availableModels?: string[];
}

// ============================================
// Config Export/Import Types (Backend: /api/v1/admin/config-export)
// ============================================

/**
 * LLM Provider Export 형식
 */
export interface LlmProviderExport {
  providerType: LlmProviderType;
  defaultModel: string;
  baseUrl?: string;
  enabled: boolean;
  priority: number;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  azureDeploymentName?: string;
  azureApiVersion?: string;
  apiKeyMasked?: string;
}

/**
 * ML Addon Export 형식
 */
export interface MlAddonExport {
  addon_key: string;
  name: string;
  description?: string;
  endpoint_url: string;
  version?: string;
  status: string;
  config?: Record<string, unknown>;
}

/**
 * 전체 시스템 설정 Export 형식
 */
export interface SystemConfigExport {
  version: string;
  exportedAt: string;
  exportedBy?: string;
  llmProviders: LlmProviderExport[];
  mlAddons: MlAddonExport[];
  metadata?: Record<string, unknown>;
}

/**
 * LLM Provider Import 형식
 */
export interface LlmProviderImport {
  providerType: LlmProviderType;
  apiKey?: string;
  defaultModel: string;
  baseUrl?: string;
  enabled?: boolean;
  priority?: number;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  azureDeploymentName?: string;
  azureApiVersion?: string;
}

/**
 * ML Addon Import 형식
 */
export interface MlAddonImport {
  addon_key: string;
  name: string;
  description?: string;
  endpoint_url: string;
  version?: string;
  config?: Record<string, unknown>;
}

/**
 * 전체 시스템 설정 Import 형식
 */
export interface SystemConfigImport {
  version: string;
  llmProviders: LlmProviderImport[];
  mlAddons: MlAddonImport[];
  metadata?: Record<string, unknown>;
}

/**
 * Import 결과
 */
export interface ConfigImportResult {
  success: boolean;
  message: string;
  llmProvidersImported: number;
  llmProvidersFailed: number;
  mlAddonsImported: number;
  mlAddonsFailed: number;
  errors: string[];
  warnings: string[];
}

/**
 * Import 옵션
 */
export interface ConfigImportOptions {
  overwriteExisting?: boolean;
  skipLlmProviders?: boolean;
  skipMlAddons?: boolean;
  validateOnly?: boolean;
}
