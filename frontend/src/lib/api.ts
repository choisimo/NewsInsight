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
      url.port = '8112';
      return url.origin;
    } catch {
      // ignore
    }
  }

  return 'http://localhost:8112';
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
