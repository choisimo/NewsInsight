/**
 * AI Orchestration 관련 React 훅
 * Backend: /api/v1/ai
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  startAiJob,
  getAiJob,
  listAiJobs,
  cancelAiJob,
  retryAiJob,
  getAiProviders,
  checkAiHealth,
  pollAiJobCompletion,
  type AiJobDTO,
  type AiJobStatus,
  type AiProviderInfo,
  type DeepSearchRequest,
  type PageResponse,
} from '@/lib/api/ai';

// ============================================
// AI Jobs List Hook
// ============================================

export interface UseAiJobsOptions {
  /** 초기 페이지 */
  page?: number;
  /** 페이지 크기 */
  size?: number;
  /** 상태 필터 */
  status?: AiJobStatus;
  /** 자동 새로고침 활성화 */
  autoRefresh?: boolean;
  /** 새로고침 간격 (ms) */
  refreshInterval?: number;
}

export interface UseAiJobsReturn {
  /** 작업 목록 */
  jobs: AiJobDTO[];
  /** 총 개수 */
  total: number;
  /** 총 페이지 */
  totalPages: number;
  /** 현재 페이지 */
  currentPage: number;
  /** 로딩 상태 */
  loading: boolean;
  /** 에러 */
  error: Error | null;
  /** 새로고침 */
  refresh: () => Promise<void>;
  /** 페이지 변경 */
  setPage: (page: number) => void;
  /** 작업 취소 */
  cancel: (jobId: string) => Promise<void>;
  /** 작업 재시도 */
  retry: (jobId: string) => Promise<void>;
}

export function useAiJobs(options: UseAiJobsOptions = {}): UseAiJobsReturn {
  const {
    page: initialPage = 0,
    size = 20,
    status,
    autoRefresh = false,
    refreshInterval = 5000,
  } = options;

  const [jobs, setJobs] = useState<AiJobDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await listAiJobs(currentPage, size, status);
      setJobs(data.content);
      setTotal(data.totalElements);
      setTotalPages(data.totalPages);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to load jobs'));
    } finally {
      setLoading(false);
    }
  }, [currentPage, size, status]);

  const cancel = useCallback(
    async (jobId: string) => {
      try {
        await cancelAiJob(jobId);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e : new Error('Failed to cancel job'));
        throw e;
      }
    },
    [refresh]
  );

  const retry = useCallback(
    async (jobId: string) => {
      try {
        await retryAiJob(jobId);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e : new Error('Failed to retry job'));
        throw e;
      }
    },
    [refresh]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, refresh]);

  return {
    jobs,
    total,
    totalPages,
    currentPage,
    loading,
    error,
    refresh,
    setPage: setCurrentPage,
    cancel,
    retry,
  };
}

// ============================================
// Single AI Job Hook (with polling)
// ============================================

export interface UseAiJobOptions {
  /** 자동 폴링 활성화 (진행 중인 작업) */
  autoPolling?: boolean;
  /** 폴링 간격 (ms) */
  pollingInterval?: number;
  /** 상태 변경 콜백 */
  onStatusChange?: (status: AiJobStatus) => void;
  /** 완료 콜백 */
  onComplete?: (job: AiJobDTO) => void;
  /** 실패 콜백 */
  onFailed?: (job: AiJobDTO) => void;
}

export interface UseAiJobReturn {
  job: AiJobDTO | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  cancel: () => Promise<void>;
  retry: () => Promise<void>;
  /** 진행률 (0-100) */
  progress: number;
  /** 진행 중 여부 */
  isRunning: boolean;
}

export function useAiJob(jobId: string | null, options: UseAiJobOptions = {}): UseAiJobReturn {
  const {
    autoPolling = true,
    pollingInterval = 2000,
    onStatusChange,
    onComplete,
    onFailed,
  } = options;

  const [job, setJob] = useState<AiJobDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const previousStatusRef = useRef<AiJobStatus | null>(null);

  const refresh = useCallback(async () => {
    if (!jobId) return;
    try {
      setLoading(true);
      setError(null);
      const data = await getAiJob(jobId);
      setJob(data);

      // 상태 변경 감지
      if (previousStatusRef.current !== data.overallStatus) {
        if (previousStatusRef.current !== null) {
          onStatusChange?.(data.overallStatus);
        }
        previousStatusRef.current = data.overallStatus;

        if (data.overallStatus === 'COMPLETED') {
          onComplete?.(data);
        } else if (data.overallStatus === 'FAILED') {
          onFailed?.(data);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to load job'));
    } finally {
      setLoading(false);
    }
  }, [jobId, onStatusChange, onComplete, onFailed]);

  const cancel = useCallback(async () => {
    if (!jobId) return;
    try {
      await cancelAiJob(jobId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to cancel job'));
      throw e;
    }
  }, [jobId, refresh]);

  const retry = useCallback(async () => {
    if (!jobId) return;
    try {
      await retryAiJob(jobId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to retry job'));
      throw e;
    }
  }, [jobId, refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 자동 폴링 (진행 중인 작업만)
  useEffect(() => {
    if (!autoPolling || !jobId) return;
    if (!job || job.overallStatus === 'COMPLETED' || job.overallStatus === 'FAILED' || job.overallStatus === 'CANCELLED') {
      return;
    }

    const interval = setInterval(refresh, pollingInterval);
    return () => clearInterval(interval);
  }, [autoPolling, jobId, job?.overallStatus, pollingInterval, refresh]);

  const progress = job ? Math.round((job.completedTasks / job.totalTasks) * 100) || 0 : 0;
  const isRunning = job?.overallStatus === 'RUNNING' || job?.overallStatus === 'PENDING';

  return {
    job,
    loading,
    error,
    refresh,
    cancel,
    retry,
    progress,
    isRunning,
  };
}

// ============================================
// AI Providers Hook
// ============================================

export interface UseAiProvidersReturn {
  providers: AiProviderInfo[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useAiProviders(): UseAiProvidersReturn {
  const [providers, setProviders] = useState<AiProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getAiProviders();
      setProviders(data);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to load providers'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { providers, loading, error, refresh };
}

// ============================================
// AI Health Hook
// ============================================

export interface UseAiHealthReturn {
  health: {
    status: string;
    providers: Record<string, boolean>;
    timestamp: string;
  } | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  isHealthy: boolean;
}

export function useAiHealth(): UseAiHealthReturn {
  const [health, setHealth] = useState<{
    status: string;
    providers: Record<string, boolean>;
    timestamp: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await checkAiHealth();
      setHealth(data);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to check health'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isHealthy = health?.status === 'UP' || health?.status === 'healthy';

  return { health, loading, error, refresh, isHealthy };
}

// ============================================
// AI Analysis Action Hook
// ============================================

export interface UseAiAnalysisReturn {
  /** 분석 시작 */
  startAnalysis: (
    request: DeepSearchRequest,
    providers?: string[]
  ) => Promise<AiJobDTO>;
  /** 분석 시작 및 완료 대기 */
  analyzeAndWait: (
    request: DeepSearchRequest,
    onProgress?: (job: AiJobDTO) => void
  ) => Promise<AiJobDTO>;
  /** 현재 작업 */
  currentJob: AiJobDTO | null;
  /** 시작 중 여부 */
  isStarting: boolean;
  /** 대기 중 여부 */
  isWaiting: boolean;
  /** 에러 */
  error: Error | null;
  /** 에러 초기화 */
  clearError: () => void;
}

export function useAiAnalysis(): UseAiAnalysisReturn {
  const [currentJob, setCurrentJob] = useState<AiJobDTO | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const startAnalysis = useCallback(
    async (request: DeepSearchRequest, providers?: string[]) => {
      try {
        setIsStarting(true);
        setError(null);
        const job = await startAiJob(request, providers);
        setCurrentJob(job);
        return job;
      } catch (e) {
        const err = e instanceof Error ? e : new Error('Failed to start analysis');
        setError(err);
        throw err;
      } finally {
        setIsStarting(false);
      }
    },
    []
  );

  const analyzeAndWait = useCallback(
    async (request: DeepSearchRequest, onProgress?: (job: AiJobDTO) => void) => {
      try {
        setIsWaiting(true);
        setError(null);
        const job = await startAiJob(request);
        setCurrentJob(job);

        const result = await pollAiJobCompletion(job.jobId, 2000, 300000, (progressJob) => {
          setCurrentJob(progressJob);
          onProgress?.(progressJob);
        });

        setCurrentJob(result);
        return result;
      } catch (e) {
        const err = e instanceof Error ? e : new Error('Analysis failed');
        setError(err);
        throw err;
      } finally {
        setIsWaiting(false);
      }
    },
    []
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    startAnalysis,
    analyzeAndWait,
    currentJob,
    isStarting,
    isWaiting,
    error,
    clearError,
  };
}

export default useAiJobs;
