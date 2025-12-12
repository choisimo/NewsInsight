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

export type SourceType = "RSS" | "WEB" | "API" | "WEBHOOK";

export interface DataSource {
  id: number;
  name: string;
  url: string;
  sourceType: SourceType;
  isActive: boolean;
  lastCollected: string | null;
  collectionFrequency: number;
  metadata: Record<string, unknown>;
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
