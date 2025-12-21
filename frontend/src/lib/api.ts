import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type {
  AnalysisResponse,
  ArticlesResponse,
  DataSource,
  PageResponse,
  SourceType,
} from '@/types/api';
import { getSessionId, getDeviceId } from './anonymous-session';

// Storage keys for tokens (shared with AuthContext)
const ACCESS_TOKEN_KEY = 'access_token';
// Note: Refresh token is now stored in HTTP-Only cookie, not localStorage

// Token refresh state management
let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

const subscribeTokenRefresh = (callback: (token: string) => void) => {
  refreshSubscribers.push(callback);
};

const onTokenRefreshed = (token: string) => {
  refreshSubscribers.forEach((callback) => callback(token));
  refreshSubscribers = [];
};

const onRefreshError = () => {
  refreshSubscribers = [];
};

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

/**
 * Export API_BASE_URL for direct fetch usage (SSE, etc.)
 */
export const API_BASE_URL = resolveInitialBaseUrl();

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

/**
 * Save access token to localStorage and cookie
 * Note: Refresh token is handled via HTTP-Only cookie by the server
 */
const saveTokens = (accessToken: string): void => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    // Also set access token as cookie for SSE/EventSource requests
    document.cookie = `access_token=${accessToken}; path=/; SameSite=Lax`;
  }
};

/**
 * Clear all auth tokens from storage
 * Note: HTTP-Only refresh token cookie is cleared by the logout endpoint
 */
const clearTokens = (): void => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem('token_type');
    localStorage.removeItem('admin_user');
    document.cookie = 'access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  }
};

/**
 * Refresh access token using HTTP-Only cookie
 * The refresh token is stored in an HTTP-Only cookie and sent automatically
 * Returns new access token or null if refresh fails
 */
const refreshAccessToken = async (): Promise<string | null> => {
  try {
    // Use fetch directly to avoid interceptor loops
    // Browser will automatically send the HTTP-Only refresh_token cookie
    const baseURL = resolveInitialBaseUrl();
    const response = await fetch(`${baseURL}/api/v1/admin/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include', // Important: include cookies in the request
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    // Server sets new refresh token as HTTP-Only cookie automatically
    return data.access_token;
  } catch (error) {
    console.error('Token refresh failed:', error);
    return null;
  }
};

/**
 * Append authentication token to URL for SSE connections.
 * EventSource doesn't support custom headers, so we use query parameter.
 */
export const appendTokenToUrl = (url: string): string => {
  const token = getAccessToken();
  if (!token) return url;
  
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${encodeURIComponent(token)}`;
};

/**
 * Create an authenticated EventSource for SSE connections.
 * Appends the JWT token as a query parameter since EventSource doesn't support headers.
 */
export const createAuthenticatedEventSource = (url: string): EventSource => {
  return new EventSource(appendTokenToUrl(url));
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

  // Request interceptor to add Authorization and Session headers
  apiInstance.interceptors.request.use(
    (config) => {
      const token = getAccessToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      
      // Always add session headers for anonymous user tracking
      config.headers['X-Session-Id'] = getSessionId();
      config.headers['X-Device-Id'] = getDeviceId();
      
      return config;
    },
    (error) => {
      return Promise.reject(error);
    }
  );

  // Response interceptor to handle 401 errors with automatic token refresh
  apiInstance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
      
      // Check if error is 401 and we haven't already tried to refresh
      if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
        // Skip token refresh for auth endpoints to avoid infinite loops
        const isAuthEndpoint = originalRequest.url?.includes('/auth/refresh') || 
                               originalRequest.url?.includes('/auth/token') ||
                               originalRequest.url?.includes('/auth/login');
        
        // Skip token refresh for public endpoints that should work without auth
        // These endpoints may return 401 if an invalid token is sent, but they don't require auth
        const isPublicEndpoint = originalRequest.url?.includes('/api/v1/reports/') ||
                                 originalRequest.url?.includes('/api/v1/search/') ||
                                 originalRequest.url?.includes('/api/v1/analysis/') ||
                                 originalRequest.url?.includes('/api/v1/factcheck-chat/');
        
        if (isAuthEndpoint || isPublicEndpoint) {
          return Promise.reject(error);
        }

        // If already refreshing, wait for the refresh to complete
        if (isRefreshing) {
          return new Promise((resolve, reject) => {
            subscribeTokenRefresh((newToken: string) => {
              originalRequest.headers.Authorization = `Bearer ${newToken}`;
              resolve(apiInstance!.request(originalRequest));
            });
            // Add timeout to avoid hanging indefinitely
            setTimeout(() => reject(error), 10000);
          });
        }

        // Start refreshing
        originalRequest._retry = true;
        isRefreshing = true;

        try {
          // refreshAccessToken uses HTTP-Only cookie automatically
          const newAccessToken = await refreshAccessToken();
          
          if (newAccessToken) {
            // Save new access token (refresh token is in HTTP-Only cookie)
            saveTokens(newAccessToken);
            
            // Update the failed request with new token
            originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
            
            // Notify all subscribers
            onTokenRefreshed(newAccessToken);
            
            // Dispatch event for AuthContext to update its state
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('auth:tokenRefreshed', {
                detail: {
                  accessToken: newAccessToken,
                }
              }));
            }
            
            isRefreshing = false;
            
            // Retry the original request
            return apiInstance!.request(originalRequest);
          } else {
            // Refresh failed, clear tokens and notify
            onRefreshError();
            clearTokens();
            isRefreshing = false;
            
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('auth:unauthorized'));
            }
            return Promise.reject(error);
          }
        } catch (refreshError) {
          // Refresh threw an error
          onRefreshError();
          clearTokens();
          isRefreshing = false;
          
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('auth:unauthorized'));
          }
          return Promise.reject(error);
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
  return createAuthenticatedEventSource(url.toString());
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
  searchUrlTemplate?: string;
  searchPriority?: number;
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
  searchUrlTemplate?: string;
  searchPriority?: number;
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

export type SourceCategory = 'news' | 'community' | 'blog' | 'official' | 'academic';

export interface Evidence {
  id: number;
  url: string;
  title?: string;
  stance: 'pro' | 'con' | 'neutral';
  snippet: string;
  source?: string;
  sourceCategory?: SourceCategory;
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
  return createAuthenticatedEventSource(url);
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
  use_proxy_rotation?: boolean;
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
  return createAuthenticatedEventSource(url.toString());
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
 * @param window - Time window (1d, 7d, 30d, or 'custom' for custom date range)
 * @param priorityUrls - Optional array of URLs to prioritize for web crawling
 * @param startDate - Optional start date for custom date range (ISO string)
 * @param endDate - Optional end date for custom date range (ISO string)
 */
export const startUnifiedSearchJob = async (
  query: string,
  window: string = '7d',
  priorityUrls?: string[],
  startDate?: string,
  endDate?: string,
): Promise<UnifiedSearchJob> => {
  const client = await getApiClient();
  const response = await client.post<UnifiedSearchJob>('/api/v1/search/jobs', {
    query,
    window,
    ...(priorityUrls && priorityUrls.length > 0 && { priorityUrls }),
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
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
  return createAuthenticatedEventSource(url);
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
  const response = await client.post<ClaimExtractionResponse>(
    '/api/v1/analysis/extract-claims',
    request,
    { timeout: 120000 },
  );
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
  return createAuthenticatedEventSource(url);
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


// ============================================
// AI Provider Models API
// ============================================

export type LLMProviderType = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'ollama' | 'azure' | 'custom';

export interface ProviderModel {
  id: string;
  name: string;
  owned_by?: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  size?: number;
  modified_at?: string;
}

export interface ProviderModelsResponse {
  provider: LLMProviderType;
  models: ProviderModel[];
  source: 'api' | 'static';
  total?: number;
  message?: string;
  error?: string;
  ollama_url?: string;
  base_url?: string;
}

/**
 * Fetch available models for a specific LLM provider.
 * 
 * For OpenAI, OpenRouter, and Ollama: fetches from their respective APIs.
 * For Anthropic, Google, Azure, Custom: returns static model lists.
 * 
 * @param provider - The LLM provider type
 * @param apiKey - Optional API key (uses environment variables if not provided)
 * @param baseUrl - Optional base URL (for Ollama or Custom providers)
 */
export const fetchProviderModels = async (
  provider: LLMProviderType,
  apiKey?: string,
  baseUrl?: string,
): Promise<ProviderModelsResponse> => {
  const params = new URLSearchParams();
  if (apiKey) params.append('api_key', apiKey);
  if (baseUrl) params.append('base_url', baseUrl);
  
  const queryString = params.toString();
  const url = `/api/v1/crawler/providers/${provider}/models${queryString ? `?${queryString}` : ''}`;
  
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      // Return static fallback on error
      return {
        provider,
        models: getStaticModels(provider),
        source: 'static',
        error: `API error: ${response.status}`,
      };
    }
    
    const data = await response.json();
    // Ensure models is always an array
    return {
      ...data,
      provider: data.provider || provider,
      models: Array.isArray(data.models) ? data.models : getStaticModels(provider),
      source: data.source || 'api',
    };
  } catch (error) {
    // Return static fallback on any error (network, JSON parse, etc.)
    console.error(`Failed to fetch models for ${provider}:`, error);
    return {
      provider,
      models: getStaticModels(provider),
      source: 'static',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

/**
 * Static model lists as fallback when API is unavailable
 */
export const getStaticModels = (provider: LLMProviderType): ProviderModel[] => {
  const staticModels: Record<LLMProviderType, ProviderModel[]> = {
    openai: [
      { id: 'gpt-4o', name: 'GPT-4o (추천)' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini (빠름)' },
      { id: 'gpt-4.1', name: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo (저렴)' },
      { id: 'o1', name: 'o1 (추론)' },
      { id: 'o1-preview', name: 'o1-preview (추론)' },
      { id: 'o1-mini', name: 'o1-mini (추론, 빠름)' },
      { id: 'o3-mini', name: 'o3-mini (최신 추론)' },
    ],
    anthropic: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4 (최신)' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (추천)' },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (빠름)' },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus (강력)' },
    ],
    google: [
      { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash (최신)' },
      { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro (최신)' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
      { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite (빠름)' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
    ],
    openrouter: [
      { id: 'openai/gpt-4o', name: 'GPT-4o (OpenAI)' },
      { id: 'openai/gpt-4.1', name: 'GPT-4.1 (OpenAI)' },
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4 (Anthropic)' },
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
      { id: 'google/gemini-2.5-flash-preview', name: 'Gemini 2.5 Flash (Google)' },
      { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash (Google)' },
      { id: 'google/gemini-pro-1.5', name: 'Gemini 1.5 Pro' },
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
      { id: 'meta-llama/llama-3.1-405b-instruct', name: 'Llama 3.1 405B' },
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1 (추론)' },
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat' },
      { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B' },
    ],
    ollama: [
      { id: 'llama3.3', name: 'Llama 3.3 (최신)' },
      { id: 'llama3.2', name: 'Llama 3.2' },
      { id: 'llama3.1', name: 'Llama 3.1' },
      { id: 'llama3.1:70b', name: 'Llama 3.1 70B' },
      { id: 'mistral', name: 'Mistral' },
      { id: 'mixtral', name: 'Mixtral' },
      { id: 'codellama', name: 'Code Llama' },
      { id: 'qwen2.5', name: 'Qwen 2.5' },
      { id: 'deepseek-r1', name: 'DeepSeek R1' },
      { id: 'gemma2', name: 'Gemma 2' },
    ],
    azure: [
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
      { id: 'gpt-35-turbo', name: 'GPT-3.5 Turbo' },
    ],
    custom: [
      { id: 'default', name: '기본 모델' },
    ],
  };
  
  return staticModels[provider] || [];
};

/**
 * Test LLM provider connection
 */
export const testLLMProviderConnection = async (
  provider: LLMProviderType,
  model?: string,
): Promise<{
  status: 'success' | 'failed';
  provider: LLMProviderType;
  model: string;
  message: string;
  latency_ms?: number;
  error?: string;
}> => {
  const params = new URLSearchParams({ provider });
  if (model) params.append('model', model);
  
  const response = await fetch(`/api/v1/crawler/providers/test?${params}`, {
    method: 'POST',
  });
  
  return response.json();
};

// ============================================
// Analysis Stream APIs (Search Result Analysis)
// Backend: /api/v1/search/analysis
// ============================================

/**
 * Subscribe to analysis updates for specific articles via SSE
 * GET /api/v1/search/analysis/stream
 * 
 * @param articleIds - Comma-separated article IDs to watch
 * @param onEvent - Callback for each SSE event
 * @param onError - Callback for errors
 * @returns Cleanup function to close the connection
 */
export const subscribeToAnalysisUpdates = (
  articleIds: number[],
  onEvent: (event: {
    eventType: string;
    articleId?: number;
    addonKey?: string;
    data?: Record<string, unknown>;
  }) => void,
  onError?: (error: Event) => void
): (() => void) => {
  const baseUrl = resolveInitialBaseUrl();
  const params = articleIds.length > 0 ? `?articleIds=${articleIds.join(',')}` : '';
  const url = `${baseUrl}/api/v1/search/analysis/stream${params}`;
  
  // Use authenticated EventSource for SSE with token in query param
  const eventSource = createAuthenticatedEventSource(url);
  
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onEvent(data);
    } catch (e) {
      console.error('Failed to parse analysis event:', e);
    }
  };
  
  // Named event handlers
  eventSource.addEventListener('analysis_started', (event: MessageEvent) => {
    try {
      onEvent({ eventType: 'analysis_started', ...JSON.parse(event.data) });
    } catch (e) {
      console.error('Failed to parse analysis_started event:', e);
    }
  });
  
  eventSource.addEventListener('partial_result', (event: MessageEvent) => {
    try {
      onEvent({ eventType: 'partial_result', ...JSON.parse(event.data) });
    } catch (e) {
      console.error('Failed to parse partial_result event:', e);
    }
  });
  
  eventSource.addEventListener('analysis_complete', (event: MessageEvent) => {
    try {
      onEvent({ eventType: 'analysis_complete', ...JSON.parse(event.data) });
    } catch (e) {
      console.error('Failed to parse analysis_complete event:', e);
    }
  });
  
  eventSource.addEventListener('analysis_error', (event: MessageEvent) => {
    try {
      onEvent({ eventType: 'analysis_error', ...JSON.parse(event.data) });
    } catch (e) {
      console.error('Failed to parse analysis_error event:', e);
    }
  });
  
  eventSource.onerror = (error) => {
    console.error('Analysis stream error:', error);
    onError?.(error);
  };
  
  return () => {
    eventSource.close();
  };
};

/**
 * Add articles to the analysis watch list
 * POST /api/v1/search/analysis/watch
 * 
 * @param articleIds - Article IDs to watch
 */
export const watchArticlesForAnalysis = async (
  articleIds: number[]
): Promise<{
  message: string;
  watchedCount: number;
}> => {
  const client = await getApiClient();
  const response = await client.post('/api/v1/search/analysis/watch', articleIds);
  return response.data;
};

/**
 * Get analysis stream status
 * GET /api/v1/search/analysis/stream/status
 */
export const getAnalysisStreamStatus = async (): Promise<{
  subscriberCount: number;
  watchedArticleCount: number;
}> => {
  const client = await getApiClient();
  const response = await client.get('/api/v1/search/analysis/stream/status');
  return response.data;
};


// ============================================
// PDF Report API
// ============================================

/**
 * Report type enumeration
 */
export type ReportType = 'UNIFIED_SEARCH' | 'DEEP_SEARCH' | 'ML_ANALYSIS' | 'ARTICLE_DETAIL';

/**
 * Report section enumeration
 */
export type ReportSection = 
  | 'COVER'              // 표지
  | 'EXECUTIVE_SUMMARY'  // 요약
  | 'DATA_SOURCE'        // 데이터 소스 분석
  | 'TREND_ANALYSIS'     // 시간별 트렌드
  | 'KEYWORD_ANALYSIS'   // 키워드 분석
  | 'SENTIMENT_ANALYSIS' // 감정 분석
  | 'RELIABILITY'        // 신뢰도 분석
  | 'BIAS_ANALYSIS'      // 편향성 분석
  | 'FACTCHECK'          // 팩트체크
  | 'EVIDENCE_LIST'      // 증거 목록
  | 'DETAILED_RESULTS';  // 상세 결과

/**
 * Report generation status
 */
export type ReportStatus = 'PENDING' | 'GENERATING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';

/**
 * Report generation request
 */
export interface ReportRequest {
  reportType?: ReportType;
  targetId?: string;
  query?: string;
  timeWindow?: string;
  includeSections?: ReportSection[];
  chartImages?: Record<string, string>;  // Base64 encoded chart images
  customTitle?: string;
  logoImage?: string;  // Base64 or URL
  watermark?: string;
  language?: 'ko' | 'en';
}

/**
 * Report metadata response
 */
export interface ReportMetadata {
  reportId: string;
  title: string;
  reportType: ReportType;
  targetId: string;
  query: string;
  status: ReportStatus;
  fileSize?: number;
  pageCount?: number;
  generationTimeMs?: number;
  createdAt: string;
  expiresAt?: string;
  downloadUrl?: string;
  errorMessage?: string;
}

/**
 * Request unified search report generation (async)
 * POST /api/v1/reports/unified-search/{jobId}
 * 
 * @param jobId - Unified search job ID
 * @param request - Report generation options
 * @returns Report metadata with status
 */
export const requestUnifiedSearchReport = async (
  jobId: string,
  request: ReportRequest = {}
): Promise<ReportMetadata> => {
  const client = await getApiClient();
  const response = await client.post<ReportMetadata>(
    `/api/v1/reports/unified-search/${jobId}`,
    request
  );
  return response.data;
};

/**
 * Export unified search report immediately (sync download)
 * POST /api/v1/reports/unified-search/{jobId}/export
 * 
 * @param jobId - Unified search job ID
 * @param request - Report generation options
 * @returns PDF file as Blob
 */
export const exportUnifiedSearchReport = async (
  jobId: string,
  request: ReportRequest = {}
): Promise<Blob> => {
  const client = await getApiClient();
  const response = await client.post(
    `/api/v1/reports/unified-search/${jobId}/export`,
    request,
    {
      responseType: 'blob',
      timeout: 120000,  // 2 minute timeout for PDF generation
    }
  );
  return response.data;
};

/**
 * Get report status by report ID
 * GET /api/v1/reports/{reportId}
 * 
 * @param reportId - Report ID
 * @returns Report metadata
 */
export const getReportStatus = async (reportId: string): Promise<ReportMetadata> => {
  const client = await getApiClient();
  const response = await client.get<ReportMetadata>(`/api/v1/reports/${reportId}`);
  return response.data;
};

/**
 * Download generated report
 * GET /api/v1/reports/{reportId}/download
 * 
 * @param reportId - Report ID
 * @returns PDF file as Blob
 */
export const downloadReport = async (reportId: string): Promise<Blob> => {
  const client = await getApiClient();
  const response = await client.get(`/api/v1/reports/${reportId}/download`, {
    responseType: 'blob',
  });
  return response.data;
};

/**
 * Export DeepSearch report immediately (sync download)
 * POST /api/v1/reports/deep-search/{jobId}/export
 * 
 * @param jobId - DeepSearch job ID
 * @param request - Report generation options
 * @returns PDF file as Blob
 */
export const exportDeepSearchReport = async (
  jobId: string,
  request: ReportRequest = {}
): Promise<Blob> => {
  const client = await getApiClient();
  const response = await client.post(
    `/api/v1/reports/deep-search/${jobId}/export`,
    {
      ...request,
      reportType: 'DEEP_SEARCH',
    },
    {
      responseType: 'blob',
      timeout: 120000,
    }
  );
  return response.data;
};

/**
 * Export ML analysis report for an article (sync download)
 * POST /api/v1/reports/ml-analysis/{articleId}/export
 * 
 * @param articleId - Article ID
 * @param request - Report generation options
 * @returns PDF file as Blob
 */
export const exportMlAnalysisReport = async (
  articleId: number,
  request: ReportRequest = {}
): Promise<Blob> => {
  const client = await getApiClient();
  const response = await client.post(
    `/api/v1/reports/ml-analysis/${articleId}/export`,
    {
      ...request,
      reportType: 'ML_ANALYSIS',
    },
    {
      responseType: 'blob',
      timeout: 120000,
    }
  );
  return response.data;
};

/**
 * Poll for report completion
 * 
 * @param reportId - Report ID
 * @param pollIntervalMs - Polling interval in milliseconds
 * @param maxWaitMs - Maximum wait time in milliseconds
 * @returns Completed report metadata
 */
export const pollReportCompletion = async (
  reportId: string,
  pollIntervalMs: number = 2000,
  maxWaitMs: number = 120000
): Promise<ReportMetadata> => {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    const metadata = await getReportStatus(reportId);
    
    if (metadata.status === 'COMPLETED') {
      return metadata;
    }
    
    if (metadata.status === 'FAILED' || metadata.status === 'EXPIRED') {
      throw new Error(`Report generation ${metadata.status.toLowerCase()}: ${metadata.errorMessage || 'Unknown error'}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
  
  throw new Error('Report generation timed out');
};

/**
 * Helper function to trigger PDF download in browser
 * 
 * @param blob - PDF blob
 * @param filename - Download filename
 */
export const triggerPdfDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Default report sections for different report types
 */
export const DEFAULT_REPORT_SECTIONS: Record<ReportType, ReportSection[]> = {
  UNIFIED_SEARCH: [
    'COVER',
    'EXECUTIVE_SUMMARY',
    'DATA_SOURCE',
    'KEYWORD_ANALYSIS',
    'SENTIMENT_ANALYSIS',
    'RELIABILITY',
    'DETAILED_RESULTS',
  ],
  DEEP_SEARCH: [
    'COVER',
    'EXECUTIVE_SUMMARY',
    'DATA_SOURCE',
    'EVIDENCE_LIST',
    'SENTIMENT_ANALYSIS',
    'FACTCHECK',
    'DETAILED_RESULTS',
  ],
  ML_ANALYSIS: [
    'COVER',
    'EXECUTIVE_SUMMARY',
    'SENTIMENT_ANALYSIS',
    'BIAS_ANALYSIS',
    'FACTCHECK',
    'RELIABILITY',
  ],
  ARTICLE_DETAIL: [
    'COVER',
    'EXECUTIVE_SUMMARY',
    'SENTIMENT_ANALYSIS',
    'BIAS_ANALYSIS',
    'FACTCHECK',
  ],
};


// =============================================================================
// ML Training Service API (Port 8090)
// =============================================================================

const ML_TRAINER_BASE_URL = import.meta.env.VITE_ML_TRAINER_URL || '/api/ml-trainer';

/**
 * 지원되는 ML 모델 타입
 */
export type MLModelType = 
  | 'sentiment'     // 감정 분석
  | 'absa'          // Aspect-Based Sentiment Analysis
  | 'ner'           // Named Entity Recognition
  | 'classification' // 텍스트 분류
  | 'embedding'     // 임베딩 모델
  | 'transformer';  // 기본 트랜스포머

/**
 * 학습 작업 상태
 */
export type TrainingJobState = 
  | 'PENDING'
  | 'INITIALIZING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

/**
 * 데이터셋 형식
 */
export type DatasetFormat = 'csv' | 'jsonl' | 'json' | 'parquet' | 'huggingface';

/**
 * 학습 메트릭
 */
export interface TrainingMetrics {
  epoch: number;
  total_epochs: number;
  step: number;
  total_steps: number;
  loss: number;
  accuracy: number;
  validation_loss: number;
  validation_accuracy: number;
  learning_rate: number;
  samples_processed: number;
  total_samples: number;
  f1_score: number;
  precision: number;
  recall: number;
}

/**
 * 학습 요청
 */
export interface TrainingRequest {
  model_name: string;
  model_type: MLModelType;
  dataset_path: string;
  dataset_format: DatasetFormat;
  base_model?: string;
  max_epochs?: number;
  validation_split?: number;
  hyperparameters?: {
    learning_rate?: number;
    batch_size?: number;
    warmup_steps?: number;
    weight_decay?: number;
    max_length?: number;
    gradient_accumulation_steps?: number;
  };
  callbacks?: {
    early_stopping?: boolean;
    early_stopping_patience?: number;
    save_best_model?: boolean;
  };
  metadata?: Record<string, unknown>;
}

/**
 * 학습 응답
 */
export interface TrainingResponse {
  job_id: string;
  model_name: string;
  model_type: string;
  state: TrainingJobState;
  progress: number;
  created_at: string;
  message: string;
}

/**
 * 학습 작업 상태
 */
export interface TrainingJobStatus {
  job_id: string;
  model_name: string;
  model_type: string;
  state: TrainingJobState;
  progress: number;
  metrics: TrainingMetrics;
  error_message?: string;
  model_path?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  current_epoch: number;
  total_epochs: number;
}

/**
 * 모델 아티팩트 정보
 */
export interface ModelArtifact {
  model_path: string;
  model_name: string;
  model_type: string;
  framework: string;
  version: string;
  size_bytes: number;
  checksum: string;
  metrics: Record<string, number>;
  model_filename: string;
}

/**
 * ML Trainer 헬스 상태
 */
export interface MLTrainerHealth {
  status: string;
  version: string;
  gpu_available: boolean;
  active_jobs: number;
  supported_model_types: string[];
  max_concurrent_jobs: number;
  redis_connected: boolean;
  persisted_jobs: number;
}

/**
 * 외부 학습 시작 요청 (Colab/Jupyter)
 */
export interface ExternalTrainingRequest {
  model_name: string;
  model_type?: MLModelType;
  base_model?: string;
  max_epochs?: number;
  metadata?: Record<string, unknown>;
}

/**
 * 외부 학습 시작 응답
 */
export interface ExternalTrainingResponse {
  job_id: string;
  upload_token: string;
  model_name: string;
  model_type: string;
  state: string;
  created_at: string;
  message: string;
  api_endpoints: {
    progress: string;
    upload: string;
    complete: string;
    stream: string;
  };
}

/**
 * 외부 학습 진행 상황 업데이트
 */
export interface ExternalProgressUpdate {
  upload_token: string;
  progress: number;
  epoch?: number;
  total_epochs?: number;
  step?: number;
  total_steps?: number;
  loss?: number;
  accuracy?: number;
  validation_loss?: number;
  validation_accuracy?: number;
  f1_score?: number;
  learning_rate?: number;
  message?: string;
}

/**
 * 추론 요청
 */
export interface InferenceRequest {
  text: string;
  return_probabilities?: boolean;
}

/**
 * 추론 응답
 */
export interface InferenceResponse {
  job_id: string;
  model_name: string;
  model_type: string;
  input_text: string;
  predicted_label: string | number;
  predicted_label_name?: string;
  confidence: number;
  probabilities?: Record<string, number>;
  inference_time_ms: number;
}

/**
 * HuggingFace 데이터셋 정보
 */
export interface HuggingFaceDataset {
  id: string;
  name: string;
  description: string;
  size: string;
  downloads: number;
  task: string;
  language: string;
}

/**
 * 사전 정의된 한국어 데이터셋 목록
 */
export const KOREAN_DATASETS: HuggingFaceDataset[] = [
  {
    id: 'e9t/nsmc',
    name: 'Naver Sentiment Movie Corpus',
    description: '네이버 영화 리뷰 감정 분석 데이터셋 (긍정/부정)',
    size: '200K',
    downloads: 500000,
    task: 'sentiment',
    language: 'ko',
  },
  {
    id: 'klue',
    name: 'KLUE NLI',
    description: '한국어 자연어 추론 데이터셋 (config: nli)',
    size: '28K',
    downloads: 100000,
    task: 'classification',
    language: 'ko',
  },
  {
    id: 'klue',
    name: 'KLUE NER',
    description: '한국어 개체명 인식 데이터셋 (config: ner)',
    size: '26K',
    downloads: 80000,
    task: 'ner',
    language: 'ko',
  },
  {
    id: 'klue',
    name: 'KLUE YNAT',
    description: '연합뉴스 주제 분류 데이터셋 (config: ynat)',
    size: '55K',
    downloads: 90000,
    task: 'classification',
    language: 'ko',
  },
  {
    id: 'jeanlee/kmhas_korean_hate_speech',
    name: 'Korean Hate Speech',
    description: '한국어 혐오 발언 데이터셋 (KMHAS)',
    size: '110K',
    downloads: 30000,
    task: 'classification',
    language: 'ko',
  },
  {
    id: 'KorQuAD/squad_kor_v1',
    name: 'KorQuAD',
    description: '한국어 기계독해 데이터셋',
    size: '66K',
    downloads: 120000,
    task: 'qa',
    language: 'ko',
  },
];

/**
 * 기본 베이스 모델 목록
 */
export const DEFAULT_BASE_MODELS: Record<MLModelType, string[]> = {
  sentiment: [
    'klue/bert-base',
    'klue/roberta-base',
    'monologg/koelectra-base-v3-discriminator',
    'beomi/kcbert-base',
  ],
  absa: [
    'monologg/koelectra-base-v3-discriminator',
    'klue/bert-base',
  ],
  ner: [
    'klue/bert-base',
    'klue/roberta-base',
    'monologg/koelectra-base-v3-discriminator',
  ],
  classification: [
    'klue/roberta-base',
    'klue/bert-base',
    'beomi/kcbert-base',
  ],
  embedding: [
    'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
    'jhgan/ko-sroberta-multitask',
    'BM-K/KoSimCSE-roberta',
  ],
  transformer: [
    'klue/bert-base',
    'klue/roberta-base',
    'klue/roberta-large',
  ],
};

// ML Trainer API Functions

/**
 * ML Trainer 헬스 체크
 */
export const checkMLTrainerHealth = async (): Promise<MLTrainerHealth> => {
  const response = await fetch(`${ML_TRAINER_BASE_URL}/health`);
  if (!response.ok) {
    throw new Error('ML Trainer health check failed');
  }
  return response.json();
};

/**
 * 학습 작업 시작
 */
export const startTraining = async (request: TrainingRequest): Promise<TrainingResponse> => {
  const response = await fetch(`${ML_TRAINER_BASE_URL}/train`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Training start failed' }));
    throw new Error(error.detail || 'Training start failed');
  }
  return response.json();
};

/**
 * 학습 작업 상태 조회
 */
export const getTrainingJobStatus = async (jobId: string): Promise<TrainingJobStatus> => {
  const response = await fetch(`${ML_TRAINER_BASE_URL}/jobs/${jobId}/status`);
  if (!response.ok) {
    throw new Error('Failed to get job status');
  }
  return response.json();
};

/**
 * 학습 작업 취소
 */
export const cancelTrainingJob = async (jobId: string): Promise<{ message: string }> => {
  const response = await fetch(`${ML_TRAINER_BASE_URL}/jobs/${jobId}/cancel`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error('Failed to cancel job');
  }
  return response.json();
};

/**
 * 모든 학습 작업 목록 조회
 */
export const listTrainingJobs = async (): Promise<TrainingJobStatus[]> => {
  const response = await fetch(`${ML_TRAINER_BASE_URL}/jobs`);
  if (!response.ok) {
    throw new Error('Failed to list jobs');
  }
  return response.json();
};

/**
 * 학습된 모델 목록 조회
 */
export const listTrainedModels = async (): Promise<ModelArtifact[]> => {
  const response = await fetch(`${ML_TRAINER_BASE_URL}/models`);
  if (!response.ok) {
    throw new Error('Failed to list models');
  }
  return response.json();
};

/**
 * 모델 아티팩트 다운로드
 */
export const downloadModelArtifact = async (jobId: string): Promise<Blob> => {
  const response = await fetch(`${ML_TRAINER_BASE_URL}/jobs/${jobId}/artifact`);
  if (!response.ok) {
    throw new Error('Failed to download model artifact');
  }
  return response.blob();
};

/**
 * 지원되는 모델 타입 조회
 */
export const getSupportedModelTypes = async (): Promise<string[]> => {
  const response = await fetch(`${ML_TRAINER_BASE_URL}/supported-types`);
  if (!response.ok) {
    throw new Error('Failed to get supported types');
  }
  return response.json();
};

/**
 * 외부 학습 시작 (Colab/Jupyter 연동)
 */
export const startExternalTraining = async (
  request: ExternalTrainingRequest
): Promise<ExternalTrainingResponse> => {
  const response = await fetch(`${ML_TRAINER_BASE_URL}/train/external/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'External training start failed' }));
    throw new Error(error.detail || 'External training start failed');
  }
  return response.json();
};

/**
 * 외부 학습 진행 상황 업데이트
 */
export const updateExternalProgress = async (
  jobId: string,
  update: ExternalProgressUpdate
): Promise<{ message: string }> => {
  const response = await fetch(`${ML_TRAINER_BASE_URL}/jobs/${jobId}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
  if (!response.ok) {
    throw new Error('Failed to update progress');
  }
  return response.json();
};

/**
 * 외부 학습 모델 업로드
 */
export const uploadExternalModel = async (
  jobId: string,
  uploadToken: string,
  modelFile: File
): Promise<{ message: string; model_path: string }> => {
  const formData = new FormData();
  formData.append('model_file', modelFile);
  formData.append('upload_token', uploadToken);

  const response = await fetch(`${ML_TRAINER_BASE_URL}/jobs/${jobId}/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    throw new Error('Failed to upload model');
  }
  return response.json();
};

/**
 * 외부 학습 완료 처리
 */
export const completeExternalTraining = async (
  jobId: string,
  uploadToken: string,
  finalMetrics?: Record<string, number>
): Promise<{ message: string }> => {
  const response = await fetch(`${ML_TRAINER_BASE_URL}/jobs/${jobId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      upload_token: uploadToken,
      final_metrics: finalMetrics || {},
    }),
  });
  if (!response.ok) {
    throw new Error('Failed to complete training');
  }
  return response.json();
};

/**
 * 학습된 모델로 추론 실행
 */
export const runInference = async (
  jobId: string,
  request: InferenceRequest
): Promise<InferenceResponse> => {
  const response = await fetch(`${ML_TRAINER_BASE_URL}/inference/${jobId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Inference failed' }));
    throw new Error(error.detail || 'Inference failed');
  }
  return response.json();
};

/**
 * 모델 이름으로 추론 실행
 */
export const runInferenceByName = async (
  modelName: string,
  request: InferenceRequest
): Promise<InferenceResponse> => {
  const response = await fetch(`${ML_TRAINER_BASE_URL}/inference/by-name/${encodeURIComponent(modelName)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Inference failed' }));
    throw new Error(error.detail || 'Inference failed');
  }
  return response.json();
};

/**
 * 학습 진행 상황 SSE 스트림 연결
 */
export const connectTrainingStream = (
  jobId: string,
  onEvent: (event: {
    type: string;
    job_id: string;
    progress: number;
    state: TrainingJobState;
    metrics: TrainingMetrics;
    [key: string]: unknown;
  }) => void,
  onError?: (error: Error) => void
): EventSource => {
  const eventSource = createAuthenticatedEventSource(`${ML_TRAINER_BASE_URL}/jobs/${jobId}/stream`);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onEvent(data);
    } catch (e) {
      console.error('Failed to parse SSE event:', e);
    }
  };

  eventSource.onerror = (event) => {
    console.error('SSE error:', event);
    onError?.(new Error('Training stream connection error'));
  };

  return eventSource;
};

/**
 * HuggingFace 데이터셋으로 학습 시작 (편의 함수)
 */
export const startTrainingWithHuggingFaceDataset = async (
  modelName: string,
  modelType: MLModelType,
  datasetId: string,
  options?: {
    baseModel?: string;
    maxEpochs?: number;
    validationSplit?: number;
    hyperparameters?: TrainingRequest['hyperparameters'];
  }
): Promise<TrainingResponse> => {
  const request: TrainingRequest = {
    model_name: modelName,
    model_type: modelType,
    dataset_path: `huggingface:${datasetId}`,
    dataset_format: 'huggingface',
    base_model: options?.baseModel || DEFAULT_BASE_MODELS[modelType][0],
    max_epochs: options?.maxEpochs || 3,
    validation_split: options?.validationSplit || 0.1,
    hyperparameters: options?.hyperparameters || {
      learning_rate: 2e-5,
      batch_size: 16,
      warmup_steps: 500,
      weight_decay: 0.01,
    },
    callbacks: {
      early_stopping: true,
      early_stopping_patience: 3,
      save_best_model: true,
    },
    metadata: {
      dataset_source: 'huggingface',
      dataset_id: datasetId,
    },
  };
  
  return startTraining(request);
};

/**
 * 분석된 기사 데이터로 학습 시작 (편의 함수)
 */
export const startTrainingWithAnalyzedData = async (
  modelName: string,
  modelType: MLModelType,
  articleIds: number[],
  options?: {
    baseModel?: string;
    maxEpochs?: number;
    labelField?: string;
  }
): Promise<TrainingResponse> => {
  // 분석된 기사 데이터를 데이터셋으로 변환하여 학습
  const request: TrainingRequest = {
    model_name: modelName,
    model_type: modelType,
    dataset_path: `newsinsight:analyzed_articles`,
    dataset_format: 'json',
    base_model: options?.baseModel || DEFAULT_BASE_MODELS[modelType][0],
    max_epochs: options?.maxEpochs || 5,
    validation_split: 0.15,
    hyperparameters: {
      learning_rate: 2e-5,
      batch_size: 8,
      warmup_steps: 100,
      weight_decay: 0.01,
    },
    metadata: {
      dataset_source: 'newsinsight',
      article_ids: articleIds,
      label_field: options?.labelField || 'sentiment_label',
    },
  };
  
  return startTraining(request);
};

// ============================================
// Search Job Queue API (Concurrent Jobs)
// ============================================

/**
 * Search job type
 */
export type SearchJobType = 'UNIFIED' | 'DEEP_SEARCH' | 'FACT_CHECK' | 'BROWSER_AGENT';

/**
 * Search job status
 */
export type SearchJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/**
 * Search job record
 */
export interface SearchJob {
  jobId: string;
  type: SearchJobType;
  query: string;
  timeWindow?: string;
  userId?: string;
  sessionId?: string;
  projectId?: number;
  status: SearchJobStatus;
  progress: number;
  currentPhase?: string;
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
  result?: Record<string, unknown>;
}

/**
 * Search job event from SSE
 */
export interface SearchJobEvent {
  jobId: string;
  eventType: 'started' | 'progress' | 'completed' | 'failed' | 'cancelled' | 'heartbeat';
  status: SearchJobStatus;
  progress: number;
  currentPhase?: string;
  message?: string;
  timestamp: number;
}

/**
 * Request payload for starting a search job
 */
export interface StartSearchJobRequest {
  type: SearchJobType;
  query: string;
  timeWindow?: string;
  userId?: string;
  sessionId?: string;
  projectId?: number;
  options?: Record<string, unknown>;
}

/**
 * Start a new search job
 */
export const startSearchJob = async (request: StartSearchJobRequest): Promise<{
  jobId: string;
  type: string;
  query: string;
  status: string;
  message: string;
}> => {
  const client = await getApiClient();
  const response = await client.post('/api/v1/jobs', request);
  return response.data;
};

/**
 * Start multiple search jobs concurrently (batch)
 */
export const startSearchJobsBatch = async (requests: StartSearchJobRequest[]): Promise<{
  jobs: Array<{ jobId: string; type: string; query: string; status: string }>;
  count: number;
  message: string;
}> => {
  const client = await getApiClient();
  const response = await client.post('/api/v1/jobs/batch', requests);
  return response.data;
};

/**
 * Get job status
 */
export const getSearchJobStatus = async (jobId: string): Promise<SearchJob> => {
  const client = await getApiClient();
  const response = await client.get<SearchJob>(`/api/v1/jobs/${jobId}`);
  return response.data;
};

/**
 * Get active jobs for user
 */
export const getActiveSearchJobs = async (userId: string = 'anonymous'): Promise<SearchJob[]> => {
  const client = await getApiClient();
  const response = await client.get<SearchJob[]>('/api/v1/jobs/active', { params: { userId } });
  return response.data;
};

/**
 * Get all jobs for user
 */
export const getAllSearchJobs = async (userId: string = 'anonymous', limit: number = 20): Promise<SearchJob[]> => {
  const client = await getApiClient();
  const response = await client.get<SearchJob[]>('/api/v1/jobs', { params: { userId, limit } });
  return response.data;
};

/**
 * Cancel a job
 */
export const cancelSearchJob = async (jobId: string): Promise<{
  jobId: string;
  status: string;
  message: string;
}> => {
  const client = await getApiClient();
  const response = await client.post(`/api/v1/jobs/${jobId}/cancel`);
  return response.data;
};

/**
 * Get SSE stream URL for job updates
 */
export const getSearchJobStreamUrl = async (jobId: string): Promise<string> => {
  const initialBase = resolveInitialBaseUrl();
  const baseURL = await fetchConfiguredBaseUrl(initialBase);
  const effectiveBaseURL = baseURL || (typeof globalThis.window !== 'undefined' ? globalThis.window.location.origin : '');
  return `${effectiveBaseURL}/api/v1/jobs/${jobId}/stream`;
};

/**
 * Open SSE stream for job updates
 */
export const openSearchJobStream = async (jobId: string): Promise<EventSource> => {
  const url = await getSearchJobStreamUrl(jobId);
  return createAuthenticatedEventSource(url);
};

/**
 * Get SSE stream URL for all user jobs
 */
export const getAllJobsStreamUrl = async (userId: string = 'anonymous'): Promise<string> => {
  const initialBase = resolveInitialBaseUrl();
  const baseURL = await fetchConfiguredBaseUrl(initialBase);
  const effectiveBaseURL = baseURL || (typeof globalThis.window !== 'undefined' ? globalThis.window.location.origin : '');
  return `${effectiveBaseURL}/api/v1/jobs/stream?userId=${encodeURIComponent(userId)}`;
};

/**
 * Open SSE stream for all user jobs
 */
export const openAllJobsStream = async (userId: string = 'anonymous'): Promise<EventSource> => {
  const url = await getAllJobsStreamUrl(userId);
  return createAuthenticatedEventSource(url);
};

/**
 * Check job service health
 */
export const checkJobServiceHealth = async (): Promise<{
  status: string;
  features: Record<string, boolean>;
  supportedTypes: string[];
}> => {
  const client = await getApiClient();
  const response = await client.get('/api/v1/jobs/health');
  return response.data;
};

// ============================================
// Continue Work API (Improved)
// ============================================

/**
 * Completion status for search history
 */
export type CompletionStatus = 'DRAFT' | 'IN_PROGRESS' | 'PARTIAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/**
 * Continue work item (extended search history)
 */
export interface ContinueWorkItem extends SearchHistoryRecord {
  completionStatus?: CompletionStatus;
  viewed?: boolean;
  viewedAt?: string;
  reportGenerated?: boolean;
  failurePhase?: string;
  failureDetails?: string;
  partialResults?: Record<string, unknown>;
  progress?: number;
  currentPhase?: string;
  projectId?: number;
}

/**
 * Get continue work items (actionable searches)
 */
export const getContinueWorkItems = async (
  userId: string = 'anonymous',
  sessionId?: string,
  limit: number = 10
): Promise<{
  items: ContinueWorkItem[];
  count: number;
  stats: {
    total: number;
    inProgress: number;
    failed: number;
    draft: number;
    partial: number;
    unviewedCompleted: number;
  };
}> => {
  const client = await getApiClient();
  const params: Record<string, string | number> = { userId, limit };
  if (sessionId) params.sessionId = sessionId;
  const response = await client.get('/api/v1/search-history/continue-work', { params });
  return response.data;
};

/**
 * Mark search as viewed
 */
export const markSearchAsViewed = async (id: number): Promise<SearchHistoryRecord> => {
  const client = await getApiClient();
  const response = await client.post<SearchHistoryRecord>(`/api/v1/search-history/${id}/viewed`);
  return response.data;
};

/**
 * Mark search as viewed by external ID
 */
export const markSearchAsViewedByExternalId = async (externalId: string): Promise<SearchHistoryRecord> => {
  const client = await getApiClient();
  const response = await client.post<SearchHistoryRecord>(`/api/v1/search-history/external/${externalId}/viewed`);
  return response.data;
};

/**
 * Update completion status
 */
export const updateSearchCompletionStatus = async (id: number, status: CompletionStatus): Promise<SearchHistoryRecord> => {
  const client = await getApiClient();
  const response = await client.put<SearchHistoryRecord>(`/api/v1/search-history/${id}/status`, { status });
  return response.data;
};

/**
 * Get searches by completion status
 */
export const getSearchesByCompletionStatus = async (
  status: CompletionStatus,
  page: number = 0,
  size: number = 20
): Promise<PageResponse<SearchHistoryRecord>> => {
  const client = await getApiClient();
  const response = await client.get<PageResponse<SearchHistoryRecord>>(
    `/api/v1/search-history/status/${status}`,
    { params: { page, size } }
  );
  return response.data;
};

/**
 * Get searches by project ID
 */
export const getSearchesByProject = async (
  projectId: number,
  page: number = 0,
  size: number = 20
): Promise<PageResponse<SearchHistoryRecord>> => {
  const client = await getApiClient();
  const response = await client.get<PageResponse<SearchHistoryRecord>>(
    `/api/v1/search-history/project/${projectId}`,
    { params: { page, size } }
  );
  return response.data;
};

/**
 * Get failed searches
 */
export const getFailedSearches = async (
  daysBack: number = 7,
  limit: number = 20
): Promise<SearchHistoryRecord[]> => {
  const client = await getApiClient();
  const response = await client.get<SearchHistoryRecord[]>('/api/v1/search-history/failed', {
    params: { daysBack, limit }
  });
  return response.data;
};

// ============================================
// Project API
// ============================================

/**
 * Project category
 */
export type ProjectCategory = 'RESEARCH' | 'MONITORING' | 'FACT_CHECK' | 'TREND_ANALYSIS' | 'CUSTOM';

/**
 * Project status
 */
export type ProjectStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';

/**
 * Project visibility
 */
export type ProjectVisibility = 'PRIVATE' | 'TEAM' | 'PUBLIC';

/**
 * Member role
 */
export type MemberRole = 'ADMIN' | 'EDITOR' | 'VIEWER';

/**
 * Member status
 */
export type MemberStatus = 'ACTIVE' | 'PENDING' | 'LEFT';

/**
 * Project settings
 */
export interface ProjectSettings {
  autoCollect?: boolean;
  collectInterval?: 'hourly' | 'daily' | 'weekly';
  collectSources?: string[];
  timeWindow?: string;
  notifications?: {
    newArticles?: boolean;
    importantUpdates?: boolean;
    weeklyDigest?: boolean;
    emailEnabled?: boolean;
    slackWebhook?: string;
  };
  aiAnalysis?: {
    enabled?: boolean;
    autoSummarize?: boolean;
    sentimentTracking?: boolean;
    trendDetection?: boolean;
    factCheck?: boolean;
  };
}

/**
 * Project record
 */
export interface Project {
  id: number;
  name: string;
  description?: string;
  keywords?: string[];
  category: ProjectCategory;
  status: ProjectStatus;
  visibility: ProjectVisibility;
  ownerId: string;
  color?: string;
  icon?: string;
  isDefault?: boolean;
  settings?: ProjectSettings;
  stats?: Record<string, unknown>;
  tags?: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
  lastActivityAt?: string;
  lastCollectedAt?: string;
}

/**
 * Project member
 */
export interface ProjectMember {
  id: number;
  projectId: number;
  userId: string;
  role: MemberRole;
  status: MemberStatus;
  invitedBy?: string;
  inviteToken?: string;
  inviteExpiresAt?: string;
  permissions?: Record<string, boolean>;
  joinedAt?: string;
  lastActiveAt?: string;
}

/**
 * Project item type
 */
export type ProjectItemType = 'ARTICLE' | 'SEARCH_RESULT' | 'NOTE' | 'DOCUMENT' | 'URL' | 'EVIDENCE';

/**
 * Project item
 */
export interface ProjectItem {
  id: number;
  projectId: number;
  itemType: ProjectItemType;
  title: string;
  summary?: string;
  url?: string;
  imageUrl?: string;
  sourceName?: string;
  sourceId?: string;
  sourceType?: string;
  publishedAt?: string;
  category?: string;
  tags?: string[];
  sentiment?: string;
  importance?: number;
  isRead?: boolean;
  bookmarked?: boolean;
  addedBy?: string;
  addedAt?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Project activity log
 */
export interface ProjectActivityLog {
  id: number;
  projectId: number;
  userId: string;
  activityType: string;
  description: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

/**
 * Project notification
 */
export interface ProjectNotification {
  id: number;
  projectId: number;
  userId: string;
  notificationType: string;
  title: string;
  message?: string;
  actionUrl?: string;
  isRead: boolean;
  readAt?: string;
  createdAt: string;
}

/**
 * Create project request
 */
export interface CreateProjectRequest {
  name: string;
  description?: string;
  keywords?: string[];
  category?: ProjectCategory;
  visibility?: ProjectVisibility;
  ownerId: string;
  color?: string;
  icon?: string;
  isDefault?: boolean;
  settings?: ProjectSettings;
  tags?: string[];
}

/**
 * Update project request
 */
export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  keywords?: string[];
  category?: ProjectCategory;
  visibility?: ProjectVisibility;
  color?: string;
  icon?: string;
  settings?: ProjectSettings;
  tags?: string[];
}

/**
 * Add project item request
 */
export interface AddProjectItemRequest {
  itemType: ProjectItemType;
  title: string;
  summary?: string;
  url?: string;
  imageUrl?: string;
  sourceName?: string;
  sourceId?: string;
  sourceType?: string;
  publishedAt?: string;
  category?: string;
  tags?: string[];
  sentiment?: string;
  importance?: number;
  metadata?: Record<string, unknown>;
}

// ============ Project CRUD ============

/**
 * Create a new project
 */
export const createProject = async (request: CreateProjectRequest): Promise<Project> => {
  const client = await getApiClient();
  const response = await client.post<Project>('/api/v1/projects', request);
  return response.data;
};

/**
 * Get project by ID
 */
export const getProject = async (id: number, userId?: string): Promise<Project> => {
  const client = await getApiClient();
  const params = userId ? { userId } : {};
  const response = await client.get<Project>(`/api/v1/projects/${id}`, { params });
  return response.data;
};

/**
 * Update project
 */
export const updateProject = async (id: number, request: UpdateProjectRequest, userId: string): Promise<Project> => {
  const client = await getApiClient();
  const response = await client.put<Project>(`/api/v1/projects/${id}`, request, { params: { userId } });
  return response.data;
};

/**
 * Update project status
 */
export const updateProjectStatus = async (id: number, status: ProjectStatus, userId: string): Promise<Project> => {
  const client = await getApiClient();
  const response = await client.put<Project>(`/api/v1/projects/${id}/status`, { status }, { params: { userId } });
  return response.data;
};

/**
 * Delete project
 */
export const deleteProject = async (id: number, userId: string): Promise<void> => {
  const client = await getApiClient();
  await client.delete(`/api/v1/projects/${id}`, { params: { userId } });
};

/**
 * Get projects by owner
 */
export const getProjectsByOwner = async (
  ownerId: string,
  status?: ProjectStatus,
  page: number = 0,
  size: number = 20
): Promise<PageResponse<Project>> => {
  const client = await getApiClient();
  const params: Record<string, string | number> = { ownerId, page, size };
  if (status) params.status = status;
  const response = await client.get<PageResponse<Project>>('/api/v1/projects', { params });
  return response.data;
};

/**
 * Search projects
 */
export const searchProjects = async (
  q: string,
  page: number = 0,
  size: number = 20
): Promise<PageResponse<Project>> => {
  const client = await getApiClient();
  const response = await client.get<PageResponse<Project>>('/api/v1/projects/search', { params: { q, page, size } });
  return response.data;
};

/**
 * Get or create default project
 */
export const getDefaultProject = async (userId: string): Promise<Project> => {
  const client = await getApiClient();
  const response = await client.get<Project>('/api/v1/projects/default', { params: { userId } });
  return response.data;
};

/**
 * Get project statistics
 */
export const getProjectStats = async (id: number): Promise<{
  itemCount: number;
  unreadCount: number;
  memberCount: number;
  categories: string[];
}> => {
  const client = await getApiClient();
  const response = await client.get(`/api/v1/projects/${id}/stats`);
  return response.data;
};

// ============ Project Members ============

/**
 * Get project members
 */
export const getProjectMembers = async (projectId: number): Promise<ProjectMember[]> => {
  const client = await getApiClient();
  const response = await client.get<ProjectMember[]>(`/api/v1/projects/${projectId}/members`);
  return response.data;
};

/**
 * Get active members
 */
export const getActiveProjectMembers = async (projectId: number): Promise<ProjectMember[]> => {
  const client = await getApiClient();
  const response = await client.get<ProjectMember[]>(`/api/v1/projects/${projectId}/members/active`);
  return response.data;
};

/**
 * Invite member
 */
export const inviteProjectMember = async (
  projectId: number,
  userId: string,
  role: MemberRole,
  invitedBy: string
): Promise<ProjectMember> => {
  const client = await getApiClient();
  const response = await client.post<ProjectMember>(
    `/api/v1/projects/${projectId}/members/invite`,
    { userId, role },
    { params: { invitedBy } }
  );
  return response.data;
};

/**
 * Accept invitation
 */
export const acceptProjectInvitation = async (token: string, userId: string): Promise<ProjectMember> => {
  const client = await getApiClient();
  const response = await client.post<ProjectMember>(
    `/api/v1/projects/invitations/${token}/accept`,
    null,
    { params: { userId } }
  );
  return response.data;
};

/**
 * Remove member
 */
export const removeProjectMember = async (projectId: number, userId: string, removedBy: string): Promise<void> => {
  const client = await getApiClient();
  await client.delete(`/api/v1/projects/${projectId}/members/${userId}`, { params: { removedBy } });
};

/**
 * Update member role
 */
export const updateProjectMemberRole = async (
  projectId: number,
  userId: string,
  role: MemberRole,
  updatedBy: string
): Promise<ProjectMember> => {
  const client = await getApiClient();
  const response = await client.put<ProjectMember>(
    `/api/v1/projects/${projectId}/members/${userId}/role`,
    { role },
    { params: { updatedBy } }
  );
  return response.data;
};

// ============ Project Items ============

/**
 * Add item to project
 */
export const addProjectItem = async (
  projectId: number,
  request: AddProjectItemRequest,
  userId: string
): Promise<ProjectItem> => {
  const client = await getApiClient();
  const response = await client.post<ProjectItem>(
    `/api/v1/projects/${projectId}/items`,
    request,
    { params: { userId } }
  );
  return response.data;
};

/**
 * Get project items
 */
export const getProjectItems = async (
  projectId: number,
  type?: ProjectItemType,
  page: number = 0,
  size: number = 20
): Promise<PageResponse<ProjectItem>> => {
  const client = await getApiClient();
  const params: Record<string, string | number> = { page, size };
  if (type) params.type = type;
  const response = await client.get<PageResponse<ProjectItem>>(`/api/v1/projects/${projectId}/items`, { params });
  return response.data;
};

/**
 * Search project items
 */
export const searchProjectItems = async (
  projectId: number,
  q: string,
  page: number = 0,
  size: number = 20
): Promise<PageResponse<ProjectItem>> => {
  const client = await getApiClient();
  const response = await client.get<PageResponse<ProjectItem>>(
    `/api/v1/projects/${projectId}/items/search`,
    { params: { q, page, size } }
  );
  return response.data;
};

/**
 * Mark item as read
 */
export const markProjectItemAsRead = async (projectId: number, itemId: number, userId: string): Promise<void> => {
  const client = await getApiClient();
  await client.post(`/api/v1/projects/${projectId}/items/${itemId}/read`, null, { params: { userId } });
};

/**
 * Toggle item bookmark
 */
export const toggleProjectItemBookmark = async (projectId: number, itemId: number, userId: string): Promise<void> => {
  const client = await getApiClient();
  await client.post(`/api/v1/projects/${projectId}/items/${itemId}/bookmark`, null, { params: { userId } });
};

/**
 * Delete item
 */
export const deleteProjectItem = async (projectId: number, itemId: number, userId: string): Promise<void> => {
  const client = await getApiClient();
  await client.delete(`/api/v1/projects/${projectId}/items/${itemId}`, { params: { userId } });
};

// ============ Project Activities ============

/**
 * Get project activity log
 */
export const getProjectActivityLog = async (
  projectId: number,
  page: number = 0,
  size: number = 20
): Promise<PageResponse<ProjectActivityLog>> => {
  const client = await getApiClient();
  const response = await client.get<PageResponse<ProjectActivityLog>>(
    `/api/v1/projects/${projectId}/activities`,
    { params: { page, size } }
  );
  return response.data;
};

/**
 * Get recent activity
 */
export const getRecentProjectActivity = async (projectId: number): Promise<ProjectActivityLog[]> => {
  const client = await getApiClient();
  const response = await client.get<ProjectActivityLog[]>(`/api/v1/projects/${projectId}/activities/recent`);
  return response.data;
};

// ============ Project Notifications ============

/**
 * Get user notifications
 */
export const getProjectNotifications = async (
  userId: string,
  page: number = 0,
  size: number = 20
): Promise<PageResponse<ProjectNotification>> => {
  const client = await getApiClient();
  const response = await client.get<PageResponse<ProjectNotification>>(
    '/api/v1/projects/notifications',
    { params: { userId, page, size } }
  );
  return response.data;
};

/**
 * Get unread notifications
 */
export const getUnreadProjectNotifications = async (userId: string): Promise<ProjectNotification[]> => {
  const client = await getApiClient();
  const response = await client.get<ProjectNotification[]>('/api/v1/projects/notifications/unread', {
    params: { userId }
  });
  return response.data;
};

/**
 * Mark notification as read
 */
export const markProjectNotificationAsRead = async (notificationId: number): Promise<void> => {
  const client = await getApiClient();
  await client.post(`/api/v1/projects/notifications/${notificationId}/read`);
};

/**
 * Mark all notifications as read
 */
export const markAllProjectNotificationsAsRead = async (userId: string): Promise<void> => {
  const client = await getApiClient();
  await client.post('/api/v1/projects/notifications/read-all', null, { params: { userId } });
};

/**
 * Check project service health
 */
export const checkProjectServiceHealth = async (): Promise<{
  status: string;
  features: Record<string, boolean>;
}> => {
  const client = await getApiClient();
  const response = await client.get('/api/v1/projects/health');
  return response.data;
};

// ============================================
// LLM Provider Settings API
// Backend: /api/v1/llm-providers, /api/v1/admin/llm-providers
// ============================================

import type {
  LlmProviderType as LlmProviderTypeEnum,
  LlmProviderTypeInfo,
  LlmProviderSettings,
  LlmProviderSettingsRequest,
  LlmTestResult,
} from '@/types/api';

/**
 * 지원하는 LLM Provider 타입 목록 조회
 */
export const getLlmProviderTypes = async (): Promise<LlmProviderTypeInfo[]> => {
  const client = await getApiClient();
  const response = await client.get<LlmProviderTypeInfo[]>('/api/v1/admin/llm-providers/types');
  return response.data;
};

// ========== 관리자 전역 설정 API ==========

/**
 * 모든 전역(관리자) LLM 설정 조회
 */
export const getGlobalLlmSettings = async (): Promise<LlmProviderSettings[]> => {
  const client = await getApiClient();
  const response = await client.get<LlmProviderSettings[]>('/api/v1/admin/llm-providers/global');
  return response.data;
};

/**
 * 특정 Provider의 전역 설정 조회
 */
export const getGlobalLlmSetting = async (providerType: LlmProviderTypeEnum): Promise<LlmProviderSettings | null> => {
  const client = await getApiClient();
  try {
    const response = await client.get<LlmProviderSettings>(`/api/v1/admin/llm-providers/global/${providerType}`);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return null;
    }
    throw error;
  }
};

/**
 * 전역(관리자) LLM 설정 저장/수정
 */
export const saveGlobalLlmSetting = async (request: LlmProviderSettingsRequest): Promise<LlmProviderSettings> => {
  const client = await getApiClient();
  const response = await client.put<LlmProviderSettings>(`/api/v1/admin/llm-providers/global/${request.providerType}`, request);
  return response.data;
};

/**
 * 전역(관리자) LLM 설정 삭제
 */
export const deleteGlobalLlmSetting = async (providerType: LlmProviderTypeEnum): Promise<void> => {
  const client = await getApiClient();
  await client.delete(`/api/v1/admin/llm-providers/global/${providerType}`);
};

/**
 * 전역 설정 연결 테스트
 */
export const testGlobalLlmConnection = async (providerType: LlmProviderTypeEnum): Promise<LlmTestResult> => {
  const client = await getApiClient();
  const response = await client.post<LlmTestResult>('/api/v1/admin/llm-providers/test', null, {
    params: { providerType }
  });
  return response.data;
};

/**
 * 전역 설정 활성화/비활성화
 * NOTE: Backend 엔드포인트가 없어 saveGlobalLlmSetting을 통해 처리
 */
export const toggleGlobalLlmSetting = async (providerType: LlmProviderTypeEnum, enabled: boolean): Promise<void> => {
  const client = await getApiClient();
  // enabled 상태만 변경하는 최소한의 요청
  await client.put(`/api/v1/admin/llm-providers/global/${providerType}`, { 
    providerType, 
    enabled,
    defaultModel: '' // 기존 값 유지
  });
};

// ========== 사용자별 설정 API ==========

/**
 * 현재 사용자에게 유효한 모든 LLM 설정 조회 (사용자 설정 > 전역 설정)
 */
export const getEffectiveLlmSettings = async (userId?: string): Promise<LlmProviderSettings[]> => {
  const client = await getApiClient();
  const params: Record<string, string> = {};
  if (userId) params.user_id = userId;
  const response = await client.get<LlmProviderSettings[]>('/api/v1/admin/llm-providers/effective', { params });
  return response.data;
};

/**
 * 활성화된 Provider 목록 (Fallback 체인용)
 */
export const getEnabledLlmProviders = async (userId?: string): Promise<LlmProviderSettings[]> => {
  const client = await getApiClient();
  const params: Record<string, string> = {};
  if (userId) params.user_id = userId;
  const response = await client.get<LlmProviderSettings[]>('/api/v1/admin/llm-providers/enabled', { params });
  return response.data;
};

/**
 * 특정 Provider의 유효 설정 조회
 */
export const getEffectiveLlmSetting = async (
  providerType: LlmProviderTypeEnum,
  userId?: string
): Promise<LlmProviderSettings | null> => {
  const client = await getApiClient();
  const headers: Record<string, string> = {};
  if (userId) headers['X-User-Id'] = userId;
  try {
    const response = await client.get<LlmProviderSettings>(
      `/api/v1/llm-providers/config/${providerType}`,
      { headers }
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return null;
    }
    throw error;
  }
};

/**
 * 사용자의 개인 LLM 설정만 조회
 */
export const getUserLlmSettings = async (userId: string): Promise<LlmProviderSettings[]> => {
  const client = await getApiClient();
  const response = await client.get<LlmProviderSettings[]>('/api/v1/llm-providers/user', {
    headers: { 'X-User-Id': userId },
  });
  return response.data;
};

/**
 * 사용자 LLM 설정 저장/수정
 */
export const saveUserLlmSetting = async (
  userId: string,
  request: LlmProviderSettingsRequest
): Promise<LlmProviderSettings> => {
  const client = await getApiClient();
  const response = await client.put<LlmProviderSettings>('/api/v1/llm-providers/user', request, {
    headers: { 'X-User-Id': userId },
  });
  return response.data;
};

/**
 * 사용자 LLM 설정 삭제 (전역 설정으로 폴백)
 */
export const deleteUserLlmSetting = async (userId: string, providerType: LlmProviderTypeEnum): Promise<void> => {
  const client = await getApiClient();
  await client.delete(`/api/v1/llm-providers/user/${providerType}`, {
    headers: { 'X-User-Id': userId },
  });
};

/**
 * 사용자의 모든 개인 설정 삭제
 */
export const deleteAllUserLlmSettings = async (userId: string): Promise<void> => {
  const client = await getApiClient();
  await client.delete('/api/v1/llm-providers/user', {
    headers: { 'X-User-Id': userId },
  });
};

/**
 * 사용자 설정 연결 테스트
 */
export const testUserLlmConnection = async (id: number): Promise<LlmTestResult> => {
  const client = await getApiClient();
  const response = await client.post<LlmTestResult>(`/api/v1/llm-providers/user/${id}/test`);
  return response.data;
};

/**
 * 새 설정으로 연결 테스트 (저장 전)
 */
export const testNewLlmConnection = async (request: LlmProviderSettingsRequest): Promise<LlmTestResult> => {
  const client = await getApiClient();
  const response = await client.post<LlmTestResult>('/api/v1/llm-providers/test', request);
  return response.data;
};

// ============================================
// Config Export/Import API (관리자 설정 일괄 관리)
// ============================================

import type {
  SystemConfigExport,
  SystemConfigImport,
  ConfigImportResult,
  ConfigImportOptions,
} from '@/types/api';

/**
 * 전체 시스템 설정 Export (LLM Provider + ML Addon)
 */
export const exportSystemConfig = async (
  includeLlm: boolean = true,
  includeMl: boolean = true
): Promise<SystemConfigExport> => {
  const client = await getApiClient();
  const response = await client.get<SystemConfigExport>('/api/v1/admin/config-export/export', {
    params: { include_llm: includeLlm, include_ml: includeMl },
  });
  return response.data;
};

/**
 * 설정을 JSON 파일로 다운로드
 */
export const downloadSystemConfig = async (
  includeLlm: boolean = true,
  includeMl: boolean = true
): Promise<Blob> => {
  const client = await getApiClient();
  const response = await client.get('/api/v1/admin/config-export/export/download', {
    params: { include_llm: includeLlm, include_ml: includeMl },
    responseType: 'blob',
  });
  return response.data;
};

/**
 * JSON 설정을 시스템에 Import
 */
export const importSystemConfig = async (
  config: SystemConfigImport,
  options?: ConfigImportOptions
): Promise<ConfigImportResult> => {
  const client = await getApiClient();
  const response = await client.post<ConfigImportResult>('/api/v1/admin/config-export/import', config, {
    params: options,
  });
  return response.data;
};

/**
 * Import 설정 유효성 검증 (실제 import 안함)
 */
export const validateSystemConfig = async (
  config: SystemConfigImport
): Promise<ConfigImportResult> => {
  const client = await getApiClient();
  const response = await client.post<ConfigImportResult>('/api/v1/admin/config-export/import/validate', config);
  return response.data;
};

/**
 * Import용 설정 템플릿 가져오기
 */
export const getConfigTemplate = async (): Promise<SystemConfigImport> => {
  const client = await getApiClient();
  const response = await client.get<SystemConfigImport>('/api/v1/admin/config-export/template');
  return response.data;
};
