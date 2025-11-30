import axios from 'axios';
import type {
  AnalysisResponse,
  ArticlesResponse,
  DataSource,
  PageResponse,
  SourceType,
} from '@/types/api';

let apiInstance: ReturnType<typeof axios.create> | null = null;

const resolveInitialBaseUrl = (): string => {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL as string;
  }

  if (typeof window !== 'undefined') {
    try {
      const url = new URL(window.location.href);
      url.port = '8080';
      return url.origin;
    } catch {
      // ignore
    }
  }

  return 'http://localhost:8080';
};

const fetchConfiguredBaseUrl = async (initialBaseUrl: string): Promise<string> => {
  try {
    const response = await fetch(`${initialBaseUrl}/api/v1/config/frontend`);
    if (!response.ok) {
      return initialBaseUrl;
    }

    const data = await response.json().catch(() => null) as { apiBaseUrl?: string } | null;
    if (data && typeof data.apiBaseUrl === 'string' && data.apiBaseUrl.length > 0) {
      return data.apiBaseUrl;
    }

    return initialBaseUrl;
  } catch {
    return initialBaseUrl;
  }
};

const getApiClient = async () => {
  if (apiInstance) {
    return apiInstance;
  }

  const initialBase = resolveInitialBaseUrl();
  const baseURL = await fetchConfiguredBaseUrl(initialBase);

  apiInstance = axios.create({
    baseURL,
    timeout: 15000,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  return apiInstance;
};

export const getAnalysis = async (query: string, window: string = '7d'): Promise<AnalysisResponse> => {
  const client = await getApiClient();
  const response = await client.get('/api/v1/analysis', {
    params: { query, window },
  });
  return response.data;
};

/**
 * Check if live analysis is available.
 * Returns provider info (perplexity or crawl+aidove fallback).
 */
export const checkLiveAnalysisHealth = async (): Promise<{
  enabled: boolean;
  provider: string;
  perplexityEnabled?: boolean;
  crawlEnabled?: boolean;
  message: string;
}> => {
  const client = await getApiClient();
  const response = await client.get('/api/v1/analysis/live/health');
  return response.data;
};

export const openLiveAnalysisStream = async (
  query: string,
  window: string = '7d',
): Promise<EventSource> => {
  const initialBase = resolveInitialBaseUrl();
  const baseURL = await fetchConfiguredBaseUrl(initialBase);
  const url = new URL('/api/v1/analysis/live', baseURL);
  url.searchParams.set('query', query);
  url.searchParams.set('window', window);
  return new EventSource(url.toString());
};

export const getArticles = async (query: string, limit: number = 50): Promise<ArticlesResponse> => {
  const client = await getApiClient();
  const response = await client.get('/api/v1/articles', {
    params: { query, limit },
  });
  return response.data;
};

export interface CreateDataSourcePayload {
  name: string;
  url: string;
  sourceType: SourceType;
  collectionFrequency?: number;
  metadata?: Record<string, unknown>;
}

export const listSources = async (
  page: number = 0,
  size: number = 20,
  sortBy: string = 'id',
  sortDirection: 'ASC' | 'DESC' = 'DESC',
): Promise<PageResponse<DataSource>> => {
  const client = await getApiClient();
  const response = await client.get<PageResponse<DataSource>>('/api/v1/sources', {
    params: { page, size, sortBy, sortDirection },
  });
  return response.data;
};

export const createSource = async (payload: CreateDataSourcePayload): Promise<DataSource> => {
  const client = await getApiClient();
  const response = await client.post<DataSource>('/api/v1/sources', payload);
  return response.data;
};

export const setSourceActive = async (id: number, active: boolean): Promise<DataSource> => {
  const client = await getApiClient();
  const path = active ? `/api/v1/sources/${id}/activate` : `/api/v1/sources/${id}/deactivate`;
  const response = await client.post<DataSource>(path);
  return response.data;
};

// ============================================
// Deep AI Search API (n8n Crawl Agent)
// ============================================

export interface DeepSearchJob {
  jobId: string;
  topic: string;
  baseUrl?: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMEOUT';
  evidenceCount?: number;
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
}

export interface Evidence {
  id: number;
  url: string;
  title?: string;
  stance: 'pro' | 'con' | 'neutral';
  snippet: string;
  source?: string;
}

export interface StanceDistribution {
  pro: number;
  con: number;
  neutral: number;
  proRatio: number;
  conRatio: number;
  neutralRatio: number;
}

export interface DeepSearchResult extends DeepSearchJob {
  evidence: Evidence[];
  stanceDistribution: StanceDistribution;
}

export interface DeepSearchRequest {
  topic: string;
  baseUrl?: string;
}

/**
 * Start a new deep AI search job.
 * Returns immediately with job details; results are delivered asynchronously.
 */
export const startDeepSearch = async (request: DeepSearchRequest): Promise<DeepSearchJob> => {
  const client = await getApiClient();
  const response = await client.post<DeepSearchJob>('/api/v1/analysis/deep', request);
  return response.data;
};

/**
 * Get the status of a deep search job.
 */
export const getDeepSearchStatus = async (jobId: string): Promise<DeepSearchJob> => {
  const client = await getApiClient();
  const response = await client.get<DeepSearchJob>(`/api/v1/analysis/deep/${jobId}`);
  return response.data;
};

/**
 * Get the full results of a completed deep search, including evidence.
 */
export const getDeepSearchResult = async (jobId: string): Promise<DeepSearchResult> => {
  const client = await getApiClient();
  const response = await client.get<DeepSearchResult>(`/api/v1/analysis/deep/${jobId}/result`);
  return response.data;
};

/**
 * List all deep search jobs with optional filtering.
 */
export const listDeepSearchJobs = async (
  page: number = 0,
  size: number = 20,
  status?: string,
): Promise<PageResponse<DeepSearchJob>> => {
  const client = await getApiClient();
  const response = await client.get<PageResponse<DeepSearchJob>>('/api/v1/analysis/deep', {
    params: { page, size, ...(status && { status }) },
  });
  return response.data;
};

/**
 * Cancel a pending or in-progress deep search job.
 */
export const cancelDeepSearch = async (jobId: string): Promise<DeepSearchJob> => {
  const client = await getApiClient();
  const response = await client.post<DeepSearchJob>(`/api/v1/analysis/deep/${jobId}/cancel`);
  return response.data;
};

/**
 * Poll for deep search completion.
 * Returns when the job is completed, failed, or times out.
 */
export const pollDeepSearchResult = async (
  jobId: string,
  pollIntervalMs: number = 3000,
  maxWaitMs: number = 120000,
): Promise<DeepSearchResult> => {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    const status = await getDeepSearchStatus(jobId);
    
    if (status.status === 'COMPLETED') {
      return getDeepSearchResult(jobId);
    }
    
    if (status.status === 'FAILED' || status.status === 'CANCELLED' || status.status === 'TIMEOUT') {
      throw new Error(`Deep search ${status.status.toLowerCase()}: ${status.errorMessage || 'Unknown error'}`);
    }
    
    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
  
  throw new Error('Deep search polling timed out');
};

/**
 * Check if deep search service is available.
 */
export const checkDeepSearchHealth = async (): Promise<{
  enabled: boolean;
  webhookUrl: string;
  callbackBaseUrl: string;
}> => {
  const client = await getApiClient();
  const response = await client.get('/api/v1/analysis/deep/health');
  return response.data;
};

/**
 * Get the SSE stream URL for a deep search job.
 * This URL can be used with EventSource for real-time updates.
 */
export const getDeepSearchStreamUrl = async (jobId: string): Promise<string> => {
  const initialBase = resolveInitialBaseUrl();
  const baseURL = await fetchConfiguredBaseUrl(initialBase);
  return `${baseURL}/api/v1/analysis/deep/${jobId}/stream`;
};

/**
 * Open SSE stream for deep search job status updates.
 * Returns an EventSource that emits real-time updates about the job.
 * 
 * Event types:
 * - status: Job status changed (PENDING, IN_PROGRESS, COMPLETED, FAILED, etc.)
 * - progress: Progress update with percentage and message
 * - evidence: New evidence collected
 * - complete: Job completed with full result
 * - error: Error occurred
 * - heartbeat: Keep-alive signal
 */
export const openDeepSearchStream = async (jobId: string): Promise<EventSource> => {
  const url = await getDeepSearchStreamUrl(jobId);
  return new EventSource(url);
};


// ============================================
// Browser-Use API with Human-in-the-Loop
// ============================================

const BROWSER_USE_BASE_URL = import.meta.env.VITE_BROWSER_USE_URL || 'http://localhost:8500';

export type BrowserJobStatus = 'pending' | 'running' | 'waiting_human' | 'completed' | 'failed' | 'cancelled';
export type InterventionType = 'captcha' | 'login' | 'navigation' | 'extraction' | 'confirmation' | 'custom';

export interface BrowseRequest {
  task: string;
  url?: string;
  session_id?: string;
  max_steps?: number;
  timeout_seconds?: number;
  headless?: boolean;
  enable_human_intervention?: boolean;
  auto_request_intervention?: boolean;
}

export interface BrowseResponse {
  job_id: string;
  status: BrowserJobStatus;
  message: string;
  result?: string;
  steps_taken: number;
  urls_visited: string[];
  screenshots: string[];
  error?: string;
  started_at?: string;
  completed_at?: string;
  intervention_requested?: boolean;
  intervention_type?: InterventionType;
}

export interface BrowserJobStatusResponse {
  job_id: string;
  status: BrowserJobStatus;
  progress: number;
  current_step: number;
  max_steps: number;
  result?: string;
  error?: string;
  urls_visited: string[];
  started_at?: string;
  completed_at?: string;
  intervention_requested: boolean;
  intervention_type?: InterventionType;
  intervention_reason?: string;
  intervention_screenshot?: string;
  current_url?: string;
}

export interface HumanAction {
  action_type: 'click' | 'type' | 'navigate' | 'scroll' | 'custom' | 'skip' | 'abort';
  selector?: string;
  value?: string;
  x?: number;
  y?: number;
  custom_script?: string;
  message?: string;
}

export interface BrowserHealthResponse {
  status: string;
  version: string;
  uptime_seconds: number;
  active_jobs: number;
  waiting_intervention: number;
}

// WebSocket message types
export interface BrowserWSMessage {
  type: 'step_update' | 'intervention_requested' | 'completed' | 'failed' | 'cancelled' | 'screenshot' | 'intervention_accepted' | 'intervention_result' | 'error';
  job_id?: string;
  step?: number;
  progress?: number;
  current_url?: string;
  screenshot?: string;
  intervention_type?: InterventionType;
  reason?: string;
  suggested_actions?: string[];
  result?: string;
  error?: string;
  message?: string;
  success?: boolean;
  data?: string;
}

/**
 * Check browser-use service health
 */
export const checkBrowserUseHealth = async (): Promise<BrowserHealthResponse> => {
  const response = await fetch(`${BROWSER_USE_BASE_URL}/health`);
  if (!response.ok) {
    throw new Error('Browser-use service unavailable');
  }
  return response.json();
};

/**
 * Start a browser automation task
 */
export const startBrowserTask = async (request: BrowseRequest): Promise<BrowseResponse> => {
  const response = await fetch(`${BROWSER_USE_BASE_URL}/browse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || 'Failed to start browser task');
  }
  return response.json();
};

/**
 * Get browser job status
 */
export const getBrowserJobStatus = async (jobId: string): Promise<BrowserJobStatusResponse> => {
  const response = await fetch(`${BROWSER_USE_BASE_URL}/jobs/${jobId}`);
  if (!response.ok) {
    throw new Error('Failed to get job status');
  }
  return response.json();
};

/**
 * Submit human intervention action
 */
export const submitIntervention = async (jobId: string, action: HumanAction): Promise<{ message: string }> => {
  const response = await fetch(`${BROWSER_USE_BASE_URL}/jobs/${jobId}/intervene`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || 'Failed to submit intervention');
  }
  return response.json();
};

/**
 * Request manual intervention for a running job
 */
export const requestManualIntervention = async (
  jobId: string,
  interventionType: InterventionType = 'custom',
  reason: string = 'Manual intervention requested'
): Promise<{ message: string; screenshot?: string; current_url?: string }> => {
  const response = await fetch(
    `${BROWSER_USE_BASE_URL}/jobs/${jobId}/request-intervention?intervention_type=${interventionType}&reason=${encodeURIComponent(reason)}`,
    { method: 'POST' }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || 'Failed to request intervention');
  }
  return response.json();
};

/**
 * Get current screenshot from browser session
 */
export const getBrowserScreenshot = async (jobId: string): Promise<{ screenshot?: string; current_url?: string }> => {
  const response = await fetch(`${BROWSER_USE_BASE_URL}/jobs/${jobId}/screenshot`);
  if (!response.ok) {
    throw new Error('Failed to get screenshot');
  }
  return response.json();
};

/**
 * Cancel a browser job
 */
export const cancelBrowserJob = async (jobId: string): Promise<{ message: string }> => {
  const response = await fetch(`${BROWSER_USE_BASE_URL}/jobs/${jobId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to cancel job');
  }
  return response.json();
};

/**
 * List browser jobs
 */
export const listBrowserJobs = async (
  status?: BrowserJobStatus,
  limit: number = 20
): Promise<Array<{
  job_id: string;
  task: string;
  status: BrowserJobStatus;
  progress: number;
  intervention_requested: boolean;
  intervention_type?: InterventionType;
  started_at?: string;
  completed_at?: string;
}>> => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (status) params.append('status', status);
  
  const response = await fetch(`${BROWSER_USE_BASE_URL}/jobs?${params}`);
  if (!response.ok) {
    throw new Error('Failed to list jobs');
  }
  return response.json();
};

/**
 * Get WebSocket URL for browser job
 */
export const getBrowserWSUrl = (jobId: string): string => {
  const wsBase = BROWSER_USE_BASE_URL.replace(/^http/, 'ws');
  return `${wsBase}/ws/${jobId}`;
};


// ============================================
// Unified Search API (Parallel Search + Deep Analysis)
// ============================================

/**
 * Search result from any source (database, web, AI)
 */
export interface UnifiedSearchResult {
  id: string;
  source: 'database' | 'web' | 'ai';
  sourceLabel: string;
  title: string;
  snippet?: string;
  url?: string;
  publishedAt?: string;
  relevanceScore?: number;
  category?: string;
  
  // Analysis fields (only for database source)
  analyzed?: boolean;
  analysisStatus?: 'pending' | 'partial' | 'complete';
  
  // Reliability
  reliabilityScore?: number;
  reliabilityGrade?: 'high' | 'medium' | 'low';
  reliabilityColor?: 'green' | 'yellow' | 'red';
  
  // Sentiment
  sentimentLabel?: 'positive' | 'negative' | 'neutral';
  sentimentScore?: number;
  
  // Bias
  biasLabel?: string;
  biasScore?: number;
  
  // Factcheck
  factcheckStatus?: 'verified' | 'suspicious' | 'conflicting' | 'unverified';
  misinfoRisk?: 'low' | 'mid' | 'high';
  
  // Tags & topics
  riskTags?: string[];
  topics?: string[];
  
  // Discussion
  hasDiscussion?: boolean;
  totalCommentCount?: number;
  discussionSentiment?: string;
}

/**
 * Search event from SSE stream
 */
export interface UnifiedSearchEvent {
  eventType: 'status' | 'result' | 'ai_chunk' | 'complete' | 'error';
  source: 'database' | 'web' | 'ai';
  message?: string;
  result?: UnifiedSearchResult;
  totalCount?: number;
}

/**
 * Fact verification status
 */
export type VerificationStatus = 
  | 'VERIFIED'
  | 'PARTIALLY_VERIFIED'
  | 'UNVERIFIED'
  | 'DISPUTED'
  | 'FALSE'
  | 'NEEDS_CONTEXT';

/**
 * Claim verification result
 */
export interface ClaimVerification {
  claim: string;
  status: VerificationStatus;
  credibilityScore: number;
  summary: string;
  sources: TrustedSource[];
  verifiedAt: string;
}

/**
 * Trusted source for fact verification
 */
export interface TrustedSource {
  name: string;
  url: string;
  excerpt: string;
  retrievedAt: string;
}

/**
 * Deep analysis event from SSE stream
 */
export interface DeepAnalysisEvent {
  eventType: 'status' | 'verification_result' | 'analysis_chunk' | 'complete' | 'error';
  message?: string;
  verification?: ClaimVerification;
  overallCredibility?: number;
}

/**
 * Open SSE stream for parallel search
 * @param query - Search query string
 * @param window - Time window (1d, 7d, 30d)
 * @param priorityUrls - Optional array of URLs to prioritize in the search
 */
export const openUnifiedSearchStream = async (
  query: string,
  window: string = '7d',
  priorityUrls?: string[],
): Promise<EventSource> => {
  const initialBase = resolveInitialBaseUrl();
  const baseURL = await fetchConfiguredBaseUrl(initialBase);
  const url = new URL('/api/v1/search/stream', baseURL);
  url.searchParams.set('query', query);
  url.searchParams.set('window', window);
  if (priorityUrls && priorityUrls.length > 0) {
    url.searchParams.set('priorityUrls', priorityUrls.join(','));
  }
  return new EventSource(url.toString());
};

/**
 * Open SSE stream for deep analysis with fact verification
 * @param topic - Topic to analyze
 * @param claims - Claims to verify
 * @param referenceUrls - Optional array of URLs to use as additional sources
 */
export const openDeepAnalysisStream = async (
  topic: string,
  claims: string[],
  referenceUrls?: string[],
): Promise<Response> => {
  const initialBase = resolveInitialBaseUrl();
  const baseURL = await fetchConfiguredBaseUrl(initialBase);
  
  // For POST with body, we need to use fetch with ReadableStream
  const response = await fetch(`${baseURL}/api/v1/search/deep/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify({ 
      topic, 
      claims, 
      ...(referenceUrls && referenceUrls.length > 0 && { referenceUrls })
    }),
  });
  
  if (!response.ok) {
    throw new Error('Failed to start deep analysis');
  }
  
  return response;
};

/**
 * Check unified search service health
 */
export const checkUnifiedSearchHealth = async (): Promise<{
  status: string;
  features: {
    parallelSearch: boolean;
    deepAnalysis: boolean;
    factVerification: boolean;
  };
  description: string;
}> => {
  const client = await getApiClient();
  const response = await client.get('/api/v1/search/health');
  return response.data;
};
