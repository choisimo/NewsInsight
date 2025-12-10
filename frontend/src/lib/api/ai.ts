/**
 * AI Orchestration Controller API
 * Backend: /api/v1/ai
 * 
 * AI 분석 작업 관리 API
 */

import { getApiClient } from '../api';

// ============================================
// Types
// ============================================

export type AiJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type AiSubTaskStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface AiSubTaskDTO {
  subTaskId: string;
  jobId: string;
  providerId: string;
  taskType: string;
  status: AiSubTaskStatus;
  resultJson: string | null;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface AiJobDTO {
  jobId: string;
  topic: string;
  baseUrl: string | null;
  overallStatus: AiJobStatus;
  subTasks: AiSubTaskDTO[];
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface DeepSearchRequest {
  topic: string;
  baseUrl?: string;
}

export interface AiProviderInfo {
  id: string;
  name: string;
  description?: string;
}

export interface PageResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

// ============================================
// API Functions
// ============================================

/**
 * AI 분석 작업 시작
 * POST /api/v1/ai/jobs
 */
export const startAiJob = async (
  request: DeepSearchRequest,
  providers?: string[]
): Promise<AiJobDTO> => {
  const client = await getApiClient();
  const params: Record<string, string> = {};
  if (providers && providers.length > 0) {
    params.providers = providers.join(',');
  }
  
  const response = await client.post<AiJobDTO>('/api/v1/ai/jobs', request, { params });
  return response.data;
};

/**
 * AI 작업 상태 조회
 * GET /api/v1/ai/jobs/{jobId}
 */
export const getAiJob = async (jobId: string): Promise<AiJobDTO> => {
  const client = await getApiClient();
  const response = await client.get<AiJobDTO>(`/api/v1/ai/jobs/${jobId}`);
  return response.data;
};

/**
 * AI 작업 목록 조회
 * GET /api/v1/ai/jobs
 */
export const listAiJobs = async (
  page: number = 0,
  size: number = 20,
  status?: AiJobStatus
): Promise<PageResponse<AiJobDTO>> => {
  const client = await getApiClient();
  const params: Record<string, string | number> = { page, size };
  if (status) params.status = status;
  
  const response = await client.get<PageResponse<AiJobDTO>>('/api/v1/ai/jobs', { params });
  return response.data;
};

/**
 * AI 작업 취소
 * POST /api/v1/ai/jobs/{jobId}/cancel
 */
export const cancelAiJob = async (jobId: string): Promise<AiJobDTO> => {
  const client = await getApiClient();
  const response = await client.post<AiJobDTO>(`/api/v1/ai/jobs/${jobId}/cancel`);
  return response.data;
};

/**
 * 실패한 서브태스크 재시도
 * POST /api/v1/ai/jobs/{jobId}/retry
 */
export const retryAiJob = async (jobId: string): Promise<AiJobDTO> => {
  const client = await getApiClient();
  const response = await client.post<AiJobDTO>(`/api/v1/ai/jobs/${jobId}/retry`);
  return response.data;
};

/**
 * 사용 가능한 AI 제공자 목록 조회
 * GET /api/v1/ai/providers
 */
export const getAiProviders = async (): Promise<AiProviderInfo[]> => {
  const client = await getApiClient();
  const response = await client.get<AiProviderInfo[]>('/api/v1/ai/providers');
  return response.data;
};

/**
 * AI 서비스 상태 확인
 * GET /api/v1/ai/health
 */
export const checkAiHealth = async (): Promise<{
  status: string;
  providers: Record<string, boolean>;
  timestamp: string;
}> => {
  const client = await getApiClient();
  const response = await client.get('/api/v1/ai/health');
  return response.data;
};

// ============================================
// Job Status Polling Hook Support
// ============================================

/**
 * AI 작업 완료 대기 (폴링)
 */
export const pollAiJobCompletion = async (
  jobId: string,
  pollIntervalMs: number = 2000,
  maxWaitMs: number = 300000,
  onProgress?: (job: AiJobDTO) => void
): Promise<AiJobDTO> => {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    const job = await getAiJob(jobId);
    onProgress?.(job);
    
    if (job.overallStatus === 'COMPLETED') {
      return job;
    }
    
    if (job.overallStatus === 'FAILED' || job.overallStatus === 'CANCELLED') {
      throw new Error(`AI job ${job.overallStatus.toLowerCase()}: ${job.errorMessage || 'Unknown error'}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
  
  throw new Error('AI job polling timed out');
};

// ============================================
// Utility Functions
// ============================================

/**
 * 작업 상태에 따른 색상 반환
 */
export const getAiJobStatusColor = (status: AiJobStatus): string => {
  const colors: Record<AiJobStatus, string> = {
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
export const getAiJobStatusLabel = (status: AiJobStatus): string => {
  const labels: Record<AiJobStatus, string> = {
    PENDING: '대기 중',
    RUNNING: '분석 중',
    COMPLETED: '완료',
    FAILED: '실패',
    CANCELLED: '취소됨',
  };
  return labels[status];
};

/**
 * 진행률 계산
 */
export const calculateAiJobProgress = (job: AiJobDTO): number => {
  if (job.totalTasks === 0) return 0;
  return Math.round((job.completedTasks / job.totalTasks) * 100);
};

/**
 * 진행 단계 추출
 */
export interface AiJobStep {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  provider: string;
  error?: string;
}

export const extractAiJobSteps = (job: AiJobDTO): AiJobStep[] => {
  return job.subTasks.map(task => ({
    id: task.subTaskId,
    name: task.taskType,
    status: task.status.toLowerCase() as AiJobStep['status'],
    provider: task.providerId,
    error: task.errorMessage || undefined,
  }));
};
