import axios from 'axios';
import type {
  AnalysisResponse,
  ArticlesResponse,
  DataSource,
  PageResponse,
  SourceType,
} from '@/types/api';

// Storage key for access token (shared with AuthContext)
const ACCESS_TOKEN_KEY = 'access_token';

let apiInstance: ReturnType<typeof axios.create> | null = null;

/**
 * 개발 환경에서는 Vite proxy를 통해 상대 경로 사용
 * 프로덕션에서는 환경변수 또는 동적 config 사용
 */
const resolveInitialBaseUrl = (): string => {
  // 개발 환경: Vite proxy 사용 (상대 경로)
  if (import.meta.env.DEV) {
    return '';
  }

  // 프로덕션: 환경변수 우선
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL as string;
  }

  // 프로덕션 fallback: 현재 호스트 사용
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  return '';
};

const fetchConfiguredBaseUrl = async (initialBaseUrl: string): Promise<string> => {
  // 개발 환경에서는 proxy 사용하므로 config fetch 불필요
  if (import.meta.env.DEV) {
    return '';
  }

  try {
    const configUrl = initialBaseUrl 
      ? `${initialBaseUrl}/api/v1/config/frontend`
      : '/api/v1/config/frontend';
    const response = await fetch(configUrl);
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

/**
 * Get access token from localStorage
 */
const getAccessToken = (): string | null => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  }
  return null;
};

export const getApiClient = async () => {
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
    withCredentials: true, // Include cookies in requests
  });

  // Request interceptor to add Authorization header
  apiInstance.interceptors.request.use(
    (config) => {
      const token = getAccessToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error) => {
      return Promise.reject(error);
    }
  );

  // Response interceptor to handle 401 errors
  apiInstance.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response?.status === 401) {
        // Token might be expired, clear storage
        // The AuthContext will handle re-authentication
        console.warn('Received 401 Unauthorized, token might be expired');
        
        // Optionally trigger a custom event for auth context to handle
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('auth:unauthorized'));
        }
      }
      return Promise.reject(error);
    }
  );

  return apiInstance;
};

/**
 * Reset API client (useful after logout to clear any cached state)
 */
export const resetApiClient = () => {
  apiInstance = null;
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

/**
 * Get a single data source by ID
 * GET /api/v1/sources/{id}
 */
export const getSource = async (id: number): Promise<DataSource> => {
  const client = await getApiClient();
  const response = await client.get<DataSource>(`/api/v1/sources/${id}`);
  return response.data;
};

/**
 * Get all active data sources
 * GET /api/v1/sources/active
 */
export const listActiveSources = async (
  page: number = 0,
  size: number = 100,
): Promise<PageResponse<DataSource>> => {
  const client = await getApiClient();
  const response = await client.get<PageResponse<DataSource>>('/api/v1/sources/active', {
    params: { page, size },
  });
  return response.data;
};

/**
 * Update data source request payload
 */
export interface UpdateDataSourcePayload {
  name?: string;
  url?: string;
  sourceType?: SourceType;
  collectionFrequency?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Update a data source
 * PUT /api/v1/sources/{id}
 */
export const updateSource = async (id: number, payload: UpdateDataSourcePayload): Promise<DataSource> => {
  const client = await getApiClient();
  const response = await client.put<DataSource>(`/api/v1/sources/${id}`, payload);
  return response.data;
};

/**
 * Delete a data source
 * DELETE /api/v1/sources/{id}
 */
export const deleteSource = async (id: number): Promise<void> => {
  const client = await getApiClient();
  await client.delete(`/api/v1/sources/${id}`);
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
 * 
 * NOTE: Deep search can take several minutes. The default maxWaitMs is 10 minutes.
 * For real-time updates, consider using SSE via useDeepSearchSSE hook instead.
 */
export const pollDeepSearchResult = async (
  jobId: string,
  pollIntervalMs: number = 3000,
  maxWaitMs: number = 600000,  // 10 minutes (Deep search can take a long time)
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
  
  throw new Error('Deep search polling timed out. The job may still be running in the background.');
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
 * Drill-down request for deeper investigation on a specific evidence.
 */
export interface DrilldownRequest {
  /** Original topic of the parent search */
  parentTopic: string;
  /** Job ID of the parent search (for tracking) */
  parentJobId?: string;
  /** The evidence item to drill down on */
  evidence: {
    url: string;
    title?: string;
    snippet: string;
    stance: 'pro' | 'con' | 'neutral';
  };
  /** Specific aspect to focus on (optional) */
  focusAspect?: string;
  /** Depth level of drilling (default: 1) */
  depth?: number;
}

/**
 * Start a drill-down deep search based on a specific evidence item.
 * This allows users to dig deeper into a particular aspect or claim.
 */
export const startDrilldownSearch = async (request: DrilldownRequest): Promise<DeepSearchJob> => {
  const client = await getApiClient();
  
  // Generate a focused topic based on the evidence
  const focusedTopic = request.focusAspect 
    ? `${request.focusAspect} - ${request.parentTopic}`
    : request.evidence.title || request.evidence.snippet.substring(0, 100);
  
  const response = await client.post<DeepSearchJob>('/api/v1/analysis/deep', {
    topic: focusedTopic,
    baseUrl: request.evidence.url,
    parentJobId: request.parentJobId,
    depth: (request.depth || 0) + 1,
  });
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

/**
 * Browser-Use는 항상 API Gateway를 통해 상대 경로로 호출한다.
 * 외부 경로: /api/browser-use/**
 */
const getBrowserUseBaseUrl = (): string => {
  return '/api/browser-use';
};

const BROWSER_USE_BASE_URL = getBrowserUseBaseUrl();

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
 * 항상 API Gateway의 /api/browser-use/ws 경로를 사용한다.
 */
export const getBrowserWSUrl = (jobId: string): string => {
  return `/api/browser-use/ws/${jobId}`;
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
  /** Full content text (not truncated) - used for export/analysis */
  content?: string;
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
  
  // 개발 환경에서 baseURL이 빈 문자열이면 현재 origin 사용
  const effectiveBaseURL = baseURL || (typeof globalThis.window !== 'undefined' ? globalThis.window.location.origin : '');
  const url = new URL('/api/v1/search/stream', effectiveBaseURL);
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

// ============================================
// Job-based Unified Search API (supports SSE reconnection)
// ============================================

/**
 * Search job response from the API
 */
export interface UnifiedSearchJob {
  jobId: string;
  query: string;
  window: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  createdAt: number;
  completedAt?: number;
  streamUrl: string;
}

/**
 * Start a new unified search job.
 * Returns immediately with job details; results are delivered via SSE.
 * 
 * @param query - Search query string
 * @param window - Time window (1d, 7d, 30d)
 * @param priorityUrls - Optional array of URLs to prioritize for web crawling
 */
export const startUnifiedSearchJob = async (
  query: string,
  window: string = '7d',
  priorityUrls?: string[],
): Promise<UnifiedSearchJob> => {
  const client = await getApiClient();
  const response = await client.post<UnifiedSearchJob>('/api/v1/search/jobs', {
    query,
    window,
    ...(priorityUrls && priorityUrls.length > 0 && { priorityUrls }),
  });
  return response.data;
};

/**
 * Get the status of a unified search job.
 */
export const getUnifiedSearchJobStatus = async (jobId: string): Promise<UnifiedSearchJob> => {
  const client = await getApiClient();
  const response = await client.get<UnifiedSearchJob>(`/api/v1/search/jobs/${jobId}`);
  return response.data;
};

/**
 * Get the SSE stream URL for a unified search job.
 */
export const getUnifiedSearchJobStreamUrl = async (jobId: string): Promise<string> => {
  const initialBase = resolveInitialBaseUrl();
  const baseURL = await fetchConfiguredBaseUrl(initialBase);
  const effectiveBaseURL = baseURL || (typeof globalThis.window !== 'undefined' ? globalThis.window.location.origin : '');
  return `${effectiveBaseURL}/api/v1/search/jobs/${jobId}/stream`;
};

/**
 * Open SSE stream for unified search job results.
 * Supports reconnection - client can reconnect with same jobId.
 * 
 * Event types:
 * - job_status: Initial job status on connection
 * - status: Source status update (database, web, ai)
 * - result: Search result from a source
 * - ai_chunk: AI response chunk for streaming
 * - source_complete: A source finished searching
 * - source_error: A source encountered an error
 * - done: All sources completed
 * - job_error: Job failed
 * - heartbeat: Keep-alive signal
 */
export const openUnifiedSearchJobStream = async (jobId: string): Promise<EventSource> => {
  const url = await getUnifiedSearchJobStreamUrl(jobId);
  return new EventSource(url);
};

// ============================================
// Search History API
// ============================================

/**
 * Search type enumeration
 */
export type SearchHistoryType = 'UNIFIED' | 'DEEP_SEARCH' | 'FACT_CHECK' | 'BROWSER_AGENT';

/**
 * Search history record
 */
export interface SearchHistoryRecord {
  id: number;
  externalId?: string;
  searchType: SearchHistoryType;
  query: string;
  timeWindow?: string;
  userId?: string;
  sessionId?: string;
  parentSearchId?: number;
  depthLevel?: number;
  resultCount?: number;
  results?: Array<Record<string, unknown>>;
  aiSummary?: Record<string, unknown>;
  discoveredUrls?: string[];
  factCheckResults?: Array<Record<string, unknown>>;
  credibilityScore?: number;
  stanceDistribution?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  bookmarked?: boolean;
  tags?: string[];
  notes?: string;
  durationMs?: number;
  errorMessage?: string;
  success?: boolean;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Request payload for saving search history
 */
export interface SaveSearchHistoryRequest {
  externalId?: string;
  searchType: SearchHistoryType;
  query: string;
  timeWindow?: string;
  userId?: string;
  sessionId?: string;
  parentSearchId?: number;
  depthLevel?: number;
  resultCount?: number;
  results?: Array<Record<string, unknown>>;
  aiSummary?: Record<string, unknown>;
  discoveredUrls?: string[];
  factCheckResults?: Array<Record<string, unknown>>;
  credibilityScore?: number;
  stanceDistribution?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  durationMs?: number;
  errorMessage?: string;
  success?: boolean;
}

/**
 * Save search history asynchronously (via Kafka)
 */
export const saveSearchHistory = async (request: SaveSearchHistoryRequest): Promise<{
  message: string;
  externalId: string;
  searchType: string;
  query: string;
}> => {
  const client = await getApiClient();
  const response = await client.post('/api/v1/search-history', request);
  return response.data;
};

/**
 * Save search history synchronously
 */
export const saveSearchHistorySync = async (request: SaveSearchHistoryRequest): Promise<SearchHistoryRecord> => {
  const client = await getApiClient();
  const response = await client.post<SearchHistoryRecord>('/api/v1/search-history/sync', request);
  return response.data;
};

/**
 * Get search history by ID
 */
export const getSearchHistoryById = async (id: number): Promise<SearchHistoryRecord> => {
  const client = await getApiClient();
  const response = await client.get<SearchHistoryRecord>(`/api/v1/search-history/${id}`);
  return response.data;
};

/**
 * Get search history by external ID (e.g., jobId)
 */
export const getSearchHistoryByExternalId = async (externalId: string): Promise<SearchHistoryRecord> => {
  const client = await getApiClient();
  const response = await client.get<SearchHistoryRecord>(`/api/v1/search-history/external/${externalId}`);
  return response.data;
};

/**
 * List search history with pagination and filtering
 */
export const listSearchHistory = async (
  page: number = 0,
  size: number = 20,
  sortBy: string = 'createdAt',
  sortDirection: 'ASC' | 'DESC' = 'DESC',
  type?: SearchHistoryType,
  userId?: string,
): Promise<PageResponse<SearchHistoryRecord>> => {
  const client = await getApiClient();
  const params: Record<string, string | number> = { page, size, sortBy, sortDirection };
  if (type) params.type = type;
  if (userId) params.userId = userId;
  
  const response = await client.get<PageResponse<SearchHistoryRecord>>('/api/v1/search-history', { params });
  return response.data;
};

/**
 * Search history by query text
 */
export const searchHistoryByQuery = async (
  query: string,
  page: number = 0,
  size: number = 20,
): Promise<PageResponse<SearchHistoryRecord>> => {
  const client = await getApiClient();
  const response = await client.get<PageResponse<SearchHistoryRecord>>('/api/v1/search-history/search', {
    params: { q: query, page, size },
  });
  return response.data;
};

/**
 * Get bookmarked searches
 */
export const getBookmarkedSearches = async (
  page: number = 0,
  size: number = 20,
): Promise<PageResponse<SearchHistoryRecord>> => {
  const client = await getApiClient();
  const response = await client.get<PageResponse<SearchHistoryRecord>>('/api/v1/search-history/bookmarked', {
    params: { page, size },
  });
  return response.data;
};

/**
 * Get derived (drill-down) searches from a parent
 */
export const getDerivedSearches = async (parentId: number): Promise<SearchHistoryRecord[]> => {
  const client = await getApiClient();
  const response = await client.get<SearchHistoryRecord[]>(`/api/v1/search-history/${parentId}/derived`);
  return response.data;
};

/**
 * Get searches by session
 */
export const getSearchesBySession = async (sessionId: string): Promise<SearchHistoryRecord[]> => {
  const client = await getApiClient();
  const response = await client.get<SearchHistoryRecord[]>(`/api/v1/search-history/session/${sessionId}`);
  return response.data;
};

/**
 * Toggle bookmark status
 */
export const toggleSearchBookmark = async (id: number): Promise<SearchHistoryRecord> => {
  const client = await getApiClient();
  const response = await client.post<SearchHistoryRecord>(`/api/v1/search-history/${id}/bookmark`);
  return response.data;
};

/**
 * Update tags for a search
 */
export const updateSearchTags = async (id: number, tags: string[]): Promise<SearchHistoryRecord> => {
  const client = await getApiClient();
  const response = await client.put<SearchHistoryRecord>(`/api/v1/search-history/${id}/tags`, tags);
  return response.data;
};

/**
 * Update notes for a search
 */
export const updateSearchNotes = async (id: number, notes: string): Promise<SearchHistoryRecord> => {
  const client = await getApiClient();
  const response = await client.put<SearchHistoryRecord>(`/api/v1/search-history/${id}/notes`, { notes });
  return response.data;
};

/**
 * Delete search history
 */
export const deleteSearchHistory = async (id: number): Promise<void> => {
  const client = await getApiClient();
  await client.delete(`/api/v1/search-history/${id}`);
};

/**
 * Create a derived (drill-down) search
 */
export const createDerivedSearch = async (
  parentId: number,
  request: SaveSearchHistoryRequest,
): Promise<{
  id: number;
  parentSearchId: number;
  depthLevel: number;
  query: string;
  message: string;
}> => {
  const client = await getApiClient();
  const response = await client.post(`/api/v1/search-history/${parentId}/derive`, request);
  return response.data;
};

/**
 * Get search statistics
 */
export const getSearchStatistics = async (days: number = 30): Promise<{
  totalSearches: number;
  byType: Array<{ searchType: string; count: number; avgResults: number }>;
  period: { days: number; since: string };
}> => {
  const client = await getApiClient();
  const response = await client.get('/api/v1/search-history/stats', { params: { days } });
  return response.data;
};

/**
 * Get recently discovered URLs from searches
 */
export const getDiscoveredUrls = async (days: number = 7, limit: number = 100): Promise<string[]> => {
  const client = await getApiClient();
  const response = await client.get<string[]>('/api/v1/search-history/discovered-urls', {
    params: { days, limit },
  });
  return response.data;
};

/**
 * Check search history service health
 */
export const checkSearchHistoryHealth = async (): Promise<{
  status: string;
  features: Record<string, boolean>;
  kafkaTopic: string;
  sseSubscribers?: number;
}> => {
  const client = await getApiClient();
  const response = await client.get('/api/v1/search-history/health');
  return response.data;
};

// ============================================
// Claim Extraction API (for FactCheck)
// ============================================

/**
 * Extracted claim from URL
 */
export interface ExtractedClaim {
  id: string;
  text: string;
  confidence: number;
  context?: string;
  claimType?: 'statistical' | 'event' | 'quote' | 'general';
  verifiable?: boolean;
}

/**
 * Response from claim extraction API
 */
export interface ClaimExtractionResponse {
  url: string;
  pageTitle?: string;
  claims: ExtractedClaim[];
  processingTimeMs?: number;
  extractionSource?: string;
  message?: string;
}

/**
 * Request payload for claim extraction
 */
export interface ClaimExtractionRequest {
  url: string;
  maxClaims?: number;
  minConfidence?: number;
}

/**
 * Extract verifiable claims from a URL.
 * The backend crawls the URL, analyzes content with AI, and returns structured claims.
 */
export const extractClaimsFromUrl = async (request: ClaimExtractionRequest): Promise<ClaimExtractionResponse> => {
  const client = await getApiClient();
  const response = await client.post<ClaimExtractionResponse>('/api/v1/analysis/extract-claims', request);
  return response.data;
};

/**
 * Check claim extraction service health
 */
export const checkClaimExtractionHealth = async (): Promise<{
  service: string;
  status: string;
}> => {
  const client = await getApiClient();
  const response = await client.get('/api/v1/analysis/extract-claims/health');
  return response.data;
};


/**
 * SSE event types for search history stream
 */
export interface SearchHistorySSEEvent {
  eventType: 'new_search' | 'updated_search' | 'deleted_search' | 'heartbeat';
  data: SearchHistoryRecord | { id: number } | { tick: number; subscribers: number };
  timestamp: number;
}

// ============================================
// Search Template API (SmartSearch Templates)
// ============================================

/**
 * Search template record
 */
export interface SearchTemplate {
  id: number;
  name: string;
  query: string;
  mode: 'unified' | 'deep' | 'factcheck';
  userId?: string;
  items: Array<{
    id: string;
    type: 'unified' | 'evidence' | 'factcheck';
    title: string;
    url?: string;
    snippet?: string;
    source?: string;
    stance?: string;
    verificationStatus?: string;
    addedAt?: string;
  }>;
  description?: string;
  favorite?: boolean;
  tags?: string[];
  metadata?: Record<string, unknown>;
  sourceSearchId?: number;
  useCount?: number;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt?: string;
  itemCount?: number;
}

/**
 * Request payload for creating/updating a search template
 */
export interface SearchTemplateRequest {
  name: string;
  query: string;
  mode: 'unified' | 'deep' | 'factcheck';
  userId?: string;
  items: Array<{
    id: string;
    type: 'unified' | 'evidence' | 'factcheck';
    title: string;
    url?: string;
    snippet?: string;
    source?: string;
    stance?: string;
    verificationStatus?: string;
    addedAt?: string;
  }>;
  description?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  sourceSearchId?: number;
}

/**
 * Create a new search template
 */
export const createSearchTemplate = async (request: SearchTemplateRequest): Promise<SearchTemplate> => {
  const client = await getApiClient();
  const response = await client.post<SearchTemplate>('/api/v1/search-templates', request);
  return response.data;
};

/**
 * Get search template by ID
 */
export const getSearchTemplateById = async (id: number): Promise<SearchTemplate> => {
  const client = await getApiClient();
  const response = await client.get<SearchTemplate>(`/api/v1/search-templates/${id}`);
  return response.data;
};

/**
 * List search templates with pagination
 */
export const listSearchTemplates = async (
  page: number = 0,
  size: number = 20,
  sortBy: string = 'createdAt',
  sortDirection: 'ASC' | 'DESC' = 'DESC',
  userId?: string,
  mode?: string,
): Promise<PageResponse<SearchTemplate>> => {
  const client = await getApiClient();
  const params: Record<string, string | number> = { page, size, sortBy, sortDirection };
  if (userId) params.userId = userId;
  if (mode) params.mode = mode;
  
  const response = await client.get<PageResponse<SearchTemplate>>('/api/v1/search-templates', { params });
  return response.data;
};

/**
 * Get all templates for a user (no pagination)
 */
export const getAllTemplatesByUser = async (userId: string): Promise<SearchTemplate[]> => {
  const client = await getApiClient();
  const response = await client.get<SearchTemplate[]>(`/api/v1/search-templates/user/${userId}`);
  return response.data;
};

/**
 * Get favorite templates for a user
 */
export const getFavoriteTemplates = async (userId: string): Promise<SearchTemplate[]> => {
  const client = await getApiClient();
  const response = await client.get<SearchTemplate[]>(`/api/v1/search-templates/user/${userId}/favorites`);
  return response.data;
};

/**
 * Get most used templates for a user
 */
export const getMostUsedTemplates = async (userId: string, limit: number = 10): Promise<SearchTemplate[]> => {
  const client = await getApiClient();
  const response = await client.get<SearchTemplate[]>(`/api/v1/search-templates/user/${userId}/most-used`, {
    params: { limit },
  });
  return response.data;
};

/**
 * Get recently used templates for a user
 */
export const getRecentlyUsedTemplates = async (userId: string, limit: number = 10): Promise<SearchTemplate[]> => {
  const client = await getApiClient();
  const response = await client.get<SearchTemplate[]>(`/api/v1/search-templates/user/${userId}/recent`, {
    params: { limit },
  });
  return response.data;
};

/**
 * Search templates by name
 */
export const searchTemplatesByName = async (
  query: string,
  userId?: string,
  page: number = 0,
  size: number = 20,
): Promise<PageResponse<SearchTemplate>> => {
  const client = await getApiClient();
  const params: Record<string, string | number> = { q: query, page, size };
  if (userId) params.userId = userId;
  
  const response = await client.get<PageResponse<SearchTemplate>>('/api/v1/search-templates/search', { params });
  return response.data;
};

/**
 * Update a search template
 */
export const updateSearchTemplate = async (id: number, request: Partial<SearchTemplateRequest>): Promise<SearchTemplate> => {
  const client = await getApiClient();
  const response = await client.put<SearchTemplate>(`/api/v1/search-templates/${id}`, request);
  return response.data;
};

/**
 * Toggle favorite status for a template
 */
export const toggleTemplateFavorite = async (id: number): Promise<SearchTemplate> => {
  const client = await getApiClient();
  const response = await client.post<SearchTemplate>(`/api/v1/search-templates/${id}/favorite`);
  return response.data;
};

/**
 * Record template usage (when loading a template)
 */
export const recordTemplateUsage = async (id: number): Promise<void> => {
  const client = await getApiClient();
  await client.post(`/api/v1/search-templates/${id}/use`);
};

/**
 * Duplicate a template
 */
export const duplicateTemplate = async (
  id: number,
  newName?: string,
  userId?: string,
): Promise<SearchTemplate> => {
  const client = await getApiClient();
  const params: Record<string, string> = {};
  if (newName) params.newName = newName;
  if (userId) params.userId = userId;
  
  const response = await client.post<SearchTemplate>(`/api/v1/search-templates/${id}/duplicate`, null, { params });
  return response.data;
};

/**
 * Delete a search template
 */
export const deleteSearchTemplate = async (id: number): Promise<void> => {
  const client = await getApiClient();
  await client.delete(`/api/v1/search-templates/${id}`);
};

/**
 * Get template statistics
 */
export const getTemplateStatistics = async (userId?: string): Promise<{
  totalTemplates: number;
  byMode: { unified: number; deep: number; factcheck: number };
  userId: string;
}> => {
  const client = await getApiClient();
  const params: Record<string, string> = {};
  if (userId) params.userId = userId;
  
  const response = await client.get('/api/v1/search-templates/stats', { params });
  return response.data;
};

/**
 * Check template service health
 */
export const checkTemplateServiceHealth = async (): Promise<{
  service: string;
  status: string;
  features: Record<string, boolean>;
}> => {
  const client = await getApiClient();
  const response = await client.get('/api/v1/search-templates/health');
  return response.data;
};

/**
 * Open SSE stream for real-time search history updates.
 * 
 * Event types:
 * - new_search: A new search was saved
 * - updated_search: An existing search was updated
 * - deleted_search: A search was deleted (data contains { id: number })
 * - heartbeat: Keep-alive signal (every 30 seconds)
 */
export const openSearchHistoryStream = async (): Promise<EventSource> => {
  const initialBase = resolveInitialBaseUrl();
  const baseURL = await fetchConfiguredBaseUrl(initialBase);
  const effectiveBaseURL = baseURL || (typeof globalThis.window !== 'undefined' ? globalThis.window.location.origin : '');
  const url = `${effectiveBaseURL}/api/v1/search-history/stream`;
  return new EventSource(url);
};


/**
 * Check API Gateway health
 */
export const checkApiGatewayHealth = async (): Promise<{
  status: string;
  timestamp?: string;
  services?: Record<string, { status: string; instances?: number }>;
}> => {
  const response = await fetch('/api/actuator/health', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  
  if (!response.ok) {
    // Try alternative health endpoint
    const altResponse = await fetch('/api/health', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!altResponse.ok) {
      return { status: 'unhealthy' };
    }
    return altResponse.json();
  }
  
  return response.json();
};


// ============================================
// Browser-Use Session Management API
// ============================================

/**
 * Summary of browser job for display
 */
export interface BrowserJobSummary {
  job_id: string;
  task: string;
  status: BrowserJobStatus;
  progress: number;
  intervention_requested: boolean;
  intervention_type?: InterventionType;
  started_at?: string;
  completed_at?: string;
}

/**
 * Get all active (running or waiting) browser jobs
 */
export const getActiveBrowserJobs = async (): Promise<BrowserJobSummary[]> => {
  const jobs = await listBrowserJobs(undefined, 100);
  return jobs.filter(j => 
    j.status === 'running' || 
    j.status === 'waiting_human' || 
    j.status === 'pending'
  );
};

/**
 * Get jobs waiting for human intervention
 */
export const getJobsWaitingIntervention = async (): Promise<BrowserJobSummary[]> => {
  return listBrowserJobs('waiting_human', 50);
};

/**
 * Get recent completed jobs (for history)
 */
export const getRecentCompletedJobs = async (limit: number = 20): Promise<BrowserJobSummary[]> => {
  return listBrowserJobs('completed', limit);
};

/**
 * Cancel all active browser jobs
 */
export const cancelAllBrowserJobs = async (): Promise<{ cancelled: number; errors: string[] }> => {
  const activeJobs = await getActiveBrowserJobs();
  let cancelled = 0;
  const errors: string[] = [];
  
  for (const job of activeJobs) {
    try {
      await cancelBrowserJob(job.job_id);
      cancelled++;
    } catch (e) {
      errors.push(`Failed to cancel ${job.job_id}: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }
  
  return { cancelled, errors };
};

/**
 * Browser-Use service statistics
 */
export interface BrowserUseStats {
  totalJobs: number;
  activeJobs: number;
  waitingIntervention: number;
  completedJobs: number;
  failedJobs: number;
  recentJobs: BrowserJobSummary[];
}

/**
 * Get Browser-Use service statistics
 */
export const getBrowserUseStats = async (): Promise<BrowserUseStats> => {
  const allJobs = await listBrowserJobs(undefined, 200);
  
  return {
    totalJobs: allJobs.length,
    activeJobs: allJobs.filter(j => j.status === 'running' || j.status === 'pending').length,
    waitingIntervention: allJobs.filter(j => j.status === 'waiting_human').length,
    completedJobs: allJobs.filter(j => j.status === 'completed').length,
    failedJobs: allJobs.filter(j => j.status === 'failed' || j.status === 'cancelled').length,
    recentJobs: allJobs.slice(0, 10),
  };
};


// ============================================
// ML Add-ons API
// ============================================

export type MLAddonType = 'sentiment' | 'factcheck' | 'bias';

export interface MLAddonHealth {
  status: 'healthy' | 'unhealthy' | 'unknown';
  service: string;
}

export interface MLAddonConfig {
  id: MLAddonType;
  name: string;
  description: string;
  port: number;
  enabled: boolean;
  endpoint: string;
}

// Default add-on configurations
export const ML_ADDON_CONFIGS: MLAddonConfig[] = [
  {
    id: 'sentiment',
    name: '감정 분석',
    description: '뉴스 기사의 감정 톤(긍정/부정/중립)을 분석합니다.',
    port: 8100,
    enabled: true,
    endpoint: '/api/ml-addons/sentiment',
  },
  {
    id: 'factcheck',
    name: '팩트체크',
    description: '기사의 주장을 추출하고 신뢰도를 평가합니다.',
    port: 8101,
    enabled: true,
    endpoint: '/api/ml-addons/factcheck',
  },
  {
    id: 'bias',
    name: '편향도 분석',
    description: '기사의 정치적/이념적 편향성을 분석합니다.',
    port: 8102,
    enabled: true,
    endpoint: '/api/ml-addons/bias',
  },
];

/**
 * Check ML Add-on service health
 */
export const checkMLAddonHealth = async (addonType: MLAddonType): Promise<MLAddonHealth> => {
  const config = ML_ADDON_CONFIGS.find(c => c.id === addonType);
  if (!config) {
    return { status: 'unknown', service: addonType };
  }
  
  try {
    const response = await fetch(`${config.endpoint}/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!response.ok) {
      return { status: 'unhealthy', service: addonType };
    }
    
    const data = await response.json();
    return {
      status: data.status === 'healthy' ? 'healthy' : 'unhealthy',
      service: data.service || addonType,
    };
  } catch {
    return { status: 'unhealthy', service: addonType };
  }
};

/**
 * Check health of all ML Add-ons
 */
export const checkAllMLAddonsHealth = async (): Promise<Record<MLAddonType, MLAddonHealth>> => {
  const results = await Promise.all(
    ML_ADDON_CONFIGS.map(async (config) => {
      const health = await checkMLAddonHealth(config.id);
      return [config.id, health] as [MLAddonType, MLAddonHealth];
    })
  );
  
  return Object.fromEntries(results) as Record<MLAddonType, MLAddonHealth>;
};

/**
 * ML Add-on analysis request
 */
export interface MLAddonAnalysisRequest {
  request_id: string;
  addon_id: string;
  task?: string;
  article: {
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
}

/**
 * Analyze article with a specific ML Add-on
 */
export const analyzeWithMLAddon = async (
  addonType: MLAddonType,
  request: MLAddonAnalysisRequest
): Promise<unknown> => {
  const config = ML_ADDON_CONFIGS.find(c => c.id === addonType);
  if (!config) {
    throw new Error(`Unknown addon type: ${addonType}`);
  }
  
  const response = await fetch(`${config.endpoint}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  
  if (!response.ok) {
    throw new Error(`ML Addon analysis failed: ${response.statusText}`);
  }
  
  return response.json();
};


