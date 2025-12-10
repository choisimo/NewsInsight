/**
 * Data Controller API
 * Backend: /api/v1/data
 * 
 * 수집된 데이터 관리 API
 */

import { getApiClient } from '../api';

// ============================================
// Types
// ============================================

export interface CollectedDataDTO {
  id: number;
  sourceId: number;
  title: string;
  content: string;
  url: string;
  publishedDate: string | null;
  collectedAt: string;
  contentHash: string;
  metadata: Record<string, unknown>;
  processed: boolean;
}

export interface DataStatsResponse {
  total: number;
  unprocessed: number;
  processed: number;
}

export interface PageResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
}

// ============================================
// API Functions
// ============================================

/**
 * 수집된 데이터 목록 조회
 * GET /api/v1/data
 */
export const listCollectedData = async (
  page: number = 0,
  size: number = 20,
  sourceId?: number,
  processed?: boolean
): Promise<PageResponse<CollectedDataDTO>> => {
  const client = await getApiClient();
  const params: Record<string, string | number | boolean> = { page, size };
  if (sourceId !== undefined) params.sourceId = sourceId;
  if (processed !== undefined) params.processed = processed;
  
  const response = await client.get<PageResponse<CollectedDataDTO>>('/api/v1/data', { params });
  return response.data;
};

/**
 * 미처리 데이터 목록 조회
 * GET /api/v1/data/unprocessed
 */
export const listUnprocessedData = async (
  page: number = 0,
  size: number = 20
): Promise<PageResponse<CollectedDataDTO>> => {
  const client = await getApiClient();
  const response = await client.get<PageResponse<CollectedDataDTO>>('/api/v1/data/unprocessed', {
    params: { page, size },
  });
  return response.data;
};

/**
 * 특정 데이터 조회
 * GET /api/v1/data/{id}
 */
export const getCollectedData = async (id: number): Promise<CollectedDataDTO> => {
  const client = await getApiClient();
  const response = await client.get<CollectedDataDTO>(`/api/v1/data/${id}`);
  return response.data;
};

/**
 * 데이터를 처리됨으로 표시
 * POST /api/v1/data/{id}/processed
 */
export const markDataAsProcessed = async (id: number): Promise<void> => {
  const client = await getApiClient();
  await client.post(`/api/v1/data/${id}/processed`);
};

/**
 * 데이터 통계 조회
 * GET /api/v1/data/stats
 */
export const getDataStats = async (): Promise<DataStatsResponse> => {
  const client = await getApiClient();
  const response = await client.get<DataStatsResponse>('/api/v1/data/stats');
  return response.data;
};

// ============================================
// Utility Functions
// ============================================

/**
 * 데이터 소스 타입에 따른 아이콘 반환
 */
export const getSourceIcon = (sourceId: number): string => {
  // 실제 구현에서는 소스 정보를 조회하여 적절한 아이콘 반환
  return 'newspaper';
};

/**
 * 데이터 요약 생성
 */
export const summarizeData = (data: CollectedDataDTO, maxLength: number = 100): string => {
  if (!data.content) return '';
  return data.content.length > maxLength
    ? `${data.content.substring(0, maxLength)}...`
    : data.content;
};
