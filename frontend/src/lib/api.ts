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
