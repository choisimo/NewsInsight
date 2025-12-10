/**
 * Collection Controller API
 * Backend: /api/v1/collections
 * 
 * 데이터 수집 작업 관리 API
 */

import { getApiClient } from '../api';

// ============================================
// Types
// ============================================

export type CollectionJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface CollectionRequest {
  /** 수집할 소스 ID 배열 (빈 배열이면 모든 활성 소스) */
  sourceIds: number[];
  /** 강제 재수집 여부 */
  force?: boolean;
}

export interface CollectionJobDTO {
  id: number;
  sourceId: number;
  status: CollectionJobStatus;
  startedAt: string | null;
  completedAt: string | null;
  itemsCollected: number;
  errorMessage: string | null;
  createdAt: string;
}

export interface CollectionResponse {
  message: string;
  jobs: CollectionJobDTO[];
  totalJobsStarted: number;
  timestamp: string;
}

export interface CollectionStatsDTO {
  totalSources: number;
  activeSources: number;
  totalItemsCollected: number;
  itemsCollectedToday: number;
  lastCollection: string | null;
}

export interface PageResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
  hasNext: boolean;
  hasPrevious: boolean;
}

// ============================================
// API Functions
// ============================================

/**
 * 데이터 수집 시작
 * POST /api/v1/collections/start
 */
export const startCollection = async (
  request: CollectionRequest = { sourceIds: [] }
): Promise<CollectionResponse> => {
  const client = await getApiClient();
  const response = await client.post<CollectionResponse>('/api/v1/collections/start', request);
  return response.data;
};

/**
 * 특정 소스에서 수집 시작
 */
export const startCollectionForSource = async (sourceId: number): Promise<CollectionResponse> => {
  return startCollection({ sourceIds: [sourceId] });
};

/**
 * 모든 활성 소스에서 수집 시작
 */
export const startCollectionForAllSources = async (): Promise<CollectionResponse> => {
  return startCollection({ sourceIds: [], force: false });
};

/**
 * 수집 작업 목록 조회
 * GET /api/v1/collections/jobs
 */
export const listCollectionJobs = async (
  page: number = 0,
  size: number = 20,
  status?: CollectionJobStatus
): Promise<PageResponse<CollectionJobDTO>> => {
  const client = await getApiClient();
  const params: Record<string, string | number> = { page, size };
  if (status) params.status = status;
  
  const response = await client.get<PageResponse<CollectionJobDTO>>('/api/v1/collections/jobs', { params });
  return response.data;
};

/**
 * 특정 수집 작업 조회
 * GET /api/v1/collections/jobs/{id}
 */
export const getCollectionJob = async (id: number): Promise<CollectionJobDTO> => {
  const client = await getApiClient();
  const response = await client.get<CollectionJobDTO>(`/api/v1/collections/jobs/${id}`);
  return response.data;
};

/**
 * 수집 작업 취소
 * POST /api/v1/collections/jobs/{id}/cancel
 */
export const cancelCollectionJob = async (id: number): Promise<void> => {
  const client = await getApiClient();
  await client.post(`/api/v1/collections/jobs/${id}/cancel`);
};

/**
 * 수집 통계 조회
 * GET /api/v1/collections/stats
 */
export const getCollectionStats = async (): Promise<CollectionStatsDTO> => {
  const client = await getApiClient();
  const response = await client.get<CollectionStatsDTO>('/api/v1/collections/stats');
  return response.data;
};

/**
 * 오래된 작업 정리
 * DELETE /api/v1/collections/jobs/cleanup
 */
export const cleanupOldJobs = async (daysOld: number = 30): Promise<string> => {
  const client = await getApiClient();
  const response = await client.delete<string>('/api/v1/collections/jobs/cleanup', {
    params: { daysOld },
  });
  return response.data;
};

// ============================================
// Utility Functions
// ============================================

/**
 * 작업 상태에 따른 색상 반환
 */
export const getJobStatusColor = (status: CollectionJobStatus): string => {
  const colors: Record<CollectionJobStatus, string> = {
    PENDING: 'yellow',
    RUNNING: 'blue',
    COMPLETED: 'green',
    FAILED: 'red',
    CANCELLED: 'gray',
  };
  return colors[status];
};

/**
 * 작업 상태 한글화
 */
export const getJobStatusLabel = (status: CollectionJobStatus): string => {
  const labels: Record<CollectionJobStatus, string> = {
    PENDING: '대기 중',
    RUNNING: '수집 중',
    COMPLETED: '완료',
    FAILED: '실패',
    CANCELLED: '취소됨',
  };
  return labels[status];
};

/**
 * 실행 중인 작업 개수 조회
 */
export const getRunningJobsCount = async (): Promise<number> => {
  const jobs = await listCollectionJobs(0, 100, 'RUNNING');
  return jobs.totalElements;
};
