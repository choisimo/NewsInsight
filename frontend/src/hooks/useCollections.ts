/**
 * Data Collection 관련 React 훅
 * Backend: /api/v1/collections
 */

import { useState, useEffect, useCallback } from 'react';
import {
  startCollection,
  startCollectionForSource,
  startCollectionForAllSources,
  listCollectionJobs,
  getCollectionJob,
  cancelCollectionJob,
  getCollectionStats,
  type CollectionJobDTO,
  type CollectionJobStatus,
  type CollectionResponse,
  type CollectionStatsDTO,
  type PageResponse,
} from '@/lib/api/collection';

// ============================================
// Collection Jobs Hook
// ============================================

export interface UseCollectionJobsOptions {
  /** 초기 페이지 */
  page?: number;
  /** 페이지 크기 */
  size?: number;
  /** 상태 필터 */
  status?: CollectionJobStatus;
  /** 자동 새로고침 활성화 */
  autoRefresh?: boolean;
  /** 새로고침 간격 (ms) */
  refreshInterval?: number;
}

export interface UseCollectionJobsReturn {
  /** 작업 목록 */
  jobs: CollectionJobDTO[];
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
  cancel: (jobId: number) => Promise<void>;
}

export function useCollectionJobs(
  options: UseCollectionJobsOptions = {}
): UseCollectionJobsReturn {
  const {
    page: initialPage = 0,
    size = 20,
    status,
    autoRefresh = false,
    refreshInterval = 5000,
  } = options;

  const [jobs, setJobs] = useState<CollectionJobDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await listCollectionJobs(currentPage, size, status);
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
    async (jobId: number) => {
      try {
        await cancelCollectionJob(jobId);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e : new Error('Failed to cancel job'));
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
  };
}

// ============================================
// Single Collection Job Hook
// ============================================

export interface UseCollectionJobReturn {
  job: CollectionJobDTO | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  cancel: () => Promise<void>;
}

export function useCollectionJob(jobId: number | null): UseCollectionJobReturn {
  const [job, setJob] = useState<CollectionJobDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!jobId) return;
    try {
      setLoading(true);
      setError(null);
      const data = await getCollectionJob(jobId);
      setJob(data);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to load job'));
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  const cancel = useCallback(async () => {
    if (!jobId) return;
    try {
      await cancelCollectionJob(jobId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to cancel job'));
      throw e;
    }
  }, [jobId, refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { job, loading, error, refresh, cancel };
}

// ============================================
// Collection Stats Hook
// ============================================

export interface UseCollectionStatsReturn {
  stats: CollectionStatsDTO | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useCollectionStats(): UseCollectionStatsReturn {
  const [stats, setStats] = useState<CollectionStatsDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getCollectionStats();
      setStats(data);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to load stats'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { stats, loading, error, refresh };
}

// ============================================
// Collection Actions Hook
// ============================================

export interface UseCollectionActionsReturn {
  /** 수집 시작 (특정 소스들) */
  startForSources: (sourceIds: number[]) => Promise<CollectionResponse>;
  /** 단일 소스 수집 시작 */
  startForSource: (sourceId: number) => Promise<CollectionResponse>;
  /** 모든 활성 소스 수집 시작 */
  startForAll: () => Promise<CollectionResponse>;
  /** 수집 진행 중 여부 */
  isStarting: boolean;
  /** 마지막 결과 */
  lastResult: CollectionResponse | null;
  /** 에러 */
  error: Error | null;
  /** 에러 초기화 */
  clearError: () => void;
}

export function useCollectionActions(): UseCollectionActionsReturn {
  const [isStarting, setIsStarting] = useState(false);
  const [lastResult, setLastResult] = useState<CollectionResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const startForSources = useCallback(async (sourceIds: number[]) => {
    try {
      setIsStarting(true);
      setError(null);
      const result = await startCollection({ sourceIds });
      setLastResult(result);
      return result;
    } catch (e) {
      const err = e instanceof Error ? e : new Error('Failed to start collection');
      setError(err);
      throw err;
    } finally {
      setIsStarting(false);
    }
  }, []);

  const startForSource = useCallback(async (sourceId: number) => {
    try {
      setIsStarting(true);
      setError(null);
      const result = await startCollectionForSource(sourceId);
      setLastResult(result);
      return result;
    } catch (e) {
      const err = e instanceof Error ? e : new Error('Failed to start collection');
      setError(err);
      throw err;
    } finally {
      setIsStarting(false);
    }
  }, []);

  const startForAll = useCallback(async () => {
    try {
      setIsStarting(true);
      setError(null);
      const result = await startCollectionForAllSources();
      setLastResult(result);
      return result;
    } catch (e) {
      const err = e instanceof Error ? e : new Error('Failed to start collection');
      setError(err);
      throw err;
    } finally {
      setIsStarting(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    startForSources,
    startForSource,
    startForAll,
    isStarting,
    lastResult,
    error,
    clearError,
  };
}

// ============================================
// Combined Collection Hook
// ============================================

export interface UseDataCollectionOptions {
  /** 작업 목록 자동 새로고침 */
  autoRefreshJobs?: boolean;
  /** 작업 목록 새로고침 간격 */
  jobsRefreshInterval?: number;
}

export interface UseDataCollectionReturn extends UseCollectionActionsReturn {
  /** 작업 목록 */
  jobs: CollectionJobDTO[];
  /** 작업 목록 로딩 */
  jobsLoading: boolean;
  /** 통계 */
  stats: CollectionStatsDTO | null;
  /** 통계 로딩 */
  statsLoading: boolean;
  /** 작업 목록 새로고침 */
  refreshJobs: () => Promise<void>;
  /** 통계 새로고침 */
  refreshStats: () => Promise<void>;
  /** 작업 취소 */
  cancelJob: (jobId: number) => Promise<void>;
}

export function useDataCollection(
  options: UseDataCollectionOptions = {}
): UseDataCollectionReturn {
  const { autoRefreshJobs = true, jobsRefreshInterval = 5000 } = options;

  const {
    jobs,
    loading: jobsLoading,
    refresh: refreshJobs,
    cancel: cancelJob,
  } = useCollectionJobs({
    autoRefresh: autoRefreshJobs,
    refreshInterval: jobsRefreshInterval,
    size: 10, // 최근 10개만
  });

  const { stats, loading: statsLoading, refresh: refreshStats } = useCollectionStats();

  const {
    startForSources,
    startForSource,
    startForAll,
    isStarting,
    lastResult,
    error,
    clearError,
  } = useCollectionActions();

  return {
    jobs,
    jobsLoading,
    stats,
    statsLoading,
    refreshJobs,
    refreshStats,
    cancelJob,
    startForSources,
    startForSource,
    startForAll,
    isStarting,
    lastResult,
    error,
    clearError,
  };
}

export default useDataCollection;
