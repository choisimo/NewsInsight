/**
 * 수집된 데이터 관련 React 훅
 * Backend: /api/v1/data
 */

import { useState, useEffect, useCallback } from 'react';
import {
  listCollectedData,
  listUnprocessedData,
  getCollectedData,
  markDataAsProcessed,
  getDataStats,
  type CollectedDataDTO,
  type DataStatsResponse,
  type PageResponse,
} from '@/lib/api/data';

// ============================================
// Collected Data List Hook
// ============================================

export interface UseCollectedDataOptions {
  /** 초기 페이지 */
  page?: number;
  /** 페이지 크기 */
  size?: number;
  /** 소스 ID 필터 */
  sourceId?: number;
  /** 처리 상태 필터 */
  processed?: boolean;
  /** 검색어 */
  query?: string;
  /** 자동 새로고침 활성화 */
  autoRefresh?: boolean;
  /** 새로고침 간격 (ms) */
  refreshInterval?: number;
}

export interface UseCollectedDataReturn {
  /** 데이터 목록 */
  data: CollectedDataDTO[];
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
  /** 처리됨 표시 */
  markAsProcessed: (id: number) => Promise<void>;
}

export function useCollectedData(options: UseCollectedDataOptions = {}): UseCollectedDataReturn {
  const {
    page: initialPage = 0,
    size = 20,
    sourceId,
    processed,
    query,
    autoRefresh = false,
    refreshInterval = 10000,
  } = options;

  const [data, setData] = useState<CollectedDataDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await listCollectedData(currentPage, size, sourceId, processed, query);
      setData(result.content);
      setTotal(result.totalElements);
      setTotalPages(result.totalPages);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to load data'));
    } finally {
      setLoading(false);
    }
  }, [currentPage, size, sourceId, processed, query]);

  const markAsProcessedAction = useCallback(
    async (id: number) => {
      try {
        await markDataAsProcessed(id);
        // 상태 업데이트
        setData((prev) =>
          prev.map((item) => (item.id === id ? { ...item, processed: true } : item))
        );
      } catch (e) {
        setError(e instanceof Error ? e : new Error('Failed to mark as processed'));
        throw e;
      }
    },
    []
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
    data,
    total,
    totalPages,
    currentPage,
    loading,
    error,
    refresh,
    setPage: setCurrentPage,
    markAsProcessed: markAsProcessedAction,
  };
}

// ============================================
// Unprocessed Data Hook
// ============================================

export interface UseUnprocessedDataOptions {
  page?: number;
  size?: number;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export interface UseUnprocessedDataReturn {
  data: CollectedDataDTO[];
  total: number;
  totalPages: number;
  currentPage: number;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  setPage: (page: number) => void;
  markAsProcessed: (id: number) => Promise<void>;
}

export function useUnprocessedData(
  options: UseUnprocessedDataOptions = {}
): UseUnprocessedDataReturn {
  const {
    page: initialPage = 0,
    size = 20,
    autoRefresh = false,
    refreshInterval = 10000,
  } = options;

  const [data, setData] = useState<CollectedDataDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await listUnprocessedData(currentPage, size);
      setData(result.content);
      setTotal(result.totalElements);
      setTotalPages(result.totalPages);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to load data'));
    } finally {
      setLoading(false);
    }
  }, [currentPage, size]);

  const markAsProcessedAction = useCallback(
    async (id: number) => {
      try {
        await markDataAsProcessed(id);
        // 처리된 항목 제거
        setData((prev) => prev.filter((item) => item.id !== id));
        setTotal((prev) => prev - 1);
      } catch (e) {
        setError(e instanceof Error ? e : new Error('Failed to mark as processed'));
        throw e;
      }
    },
    []
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
    data,
    total,
    totalPages,
    currentPage,
    loading,
    error,
    refresh,
    setPage: setCurrentPage,
    markAsProcessed: markAsProcessedAction,
  };
}

// ============================================
// Single Data Item Hook
// ============================================

export interface UseCollectedDataItemReturn {
  data: CollectedDataDTO | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  markAsProcessed: () => Promise<void>;
}

export function useCollectedDataItem(id: number | null): UseCollectedDataItemReturn {
  const [data, setData] = useState<CollectedDataDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const result = await getCollectedData(id);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to load data'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const markAsProcessedAction = useCallback(async () => {
    if (!id) return;
    try {
      await markDataAsProcessed(id);
      setData((prev) => (prev ? { ...prev, processed: true } : null));
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to mark as processed'));
      throw e;
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    data,
    loading,
    error,
    refresh,
    markAsProcessed: markAsProcessedAction,
  };
}

// ============================================
// Data Stats Hook
// ============================================

export interface UseDataStatsReturn {
  stats: DataStatsResponse | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useDataStats(): UseDataStatsReturn {
  const [stats, setStats] = useState<DataStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await getDataStats();
      setStats(result);
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

export default useCollectedData;
