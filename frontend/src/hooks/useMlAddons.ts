/**
 * ML Add-on 관련 React 훅
 * Backend: /api/v1/ml
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  MlAddon,
  MlAddonExecution,
  MlAddonResponse,
  AddonCategory,
  ExecutionStatus,
  PageResponse,
} from '@/types/api';
import {
  listMlAddons,
  getMlAddon,
  toggleMlAddon,
  getMlAddonStatus,
  listMlExecutions,
  getArticleExecutions,
  analyzeArticle,
  analyzeByCategory,
  runMlHealthCheck,
  type MlAddonStatusSummary,
} from '@/lib/api/ml';

// ============================================
// ML Add-ons List Hook
// ============================================

export interface UseMlAddonsOptions {
  /** 자동 새로고침 활성화 */
  autoRefresh?: boolean;
  /** 새로고침 간격 (ms) */
  refreshInterval?: number;
  /** 활성화된 것만 필터링 */
  enabledOnly?: boolean;
}

export interface UseMlAddonsReturn {
  /** Add-on 목록 */
  addons: MlAddon[];
  /** 로딩 상태 */
  loading: boolean;
  /** 에러 */
  error: Error | null;
  /** 새로고침 */
  refresh: () => Promise<void>;
  /** Add-on 토글 */
  toggle: (addonKey: string) => Promise<void>;
  /** 카테고리별 그룹 */
  groupedByCategory: Record<AddonCategory, MlAddon[]>;
}

export function useMlAddons(options: UseMlAddonsOptions = {}): UseMlAddonsReturn {
  const { autoRefresh = false, refreshInterval = 30000, enabledOnly = false } = options;

  const [addons, setAddons] = useState<MlAddon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await listMlAddons();
      setAddons(enabledOnly ? data.filter((a) => a.enabled) : data);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to load addons'));
    } finally {
      setLoading(false);
    }
  }, [enabledOnly]);

  const toggle = useCallback(async (addonKey: string) => {
    try {
      await toggleMlAddon(addonKey);
      // 상태 업데이트
      setAddons((prev) =>
        prev.map((addon) =>
          addon.addonKey === addonKey ? { ...addon, enabled: !addon.enabled } : addon
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to toggle addon'));
      throw e;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, refresh]);

  const groupedByCategory = useMemo(() => {
    return addons.reduce(
      (groups, addon) => {
        const category = addon.category;
        if (!groups[category]) {
          groups[category] = [];
        }
        groups[category].push(addon);
        return groups;
      },
      {} as Record<AddonCategory, MlAddon[]>
    );
  }, [addons]);

  return {
    addons,
    loading,
    error,
    refresh,
    toggle,
    groupedByCategory,
  };
}

// ============================================
// Single ML Add-on Hook
// ============================================

export interface UseMlAddonReturn {
  addon: MlAddon | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useMlAddon(addonKey: string | null): UseMlAddonReturn {
  const [addon, setAddon] = useState<MlAddon | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!addonKey) return;
    try {
      setLoading(true);
      setError(null);
      const data = await getMlAddon(addonKey);
      setAddon(data);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to load addon'));
    } finally {
      setLoading(false);
    }
  }, [addonKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { addon, loading, error, refresh };
}

// ============================================
// ML Add-on Status Hook
// ============================================

export interface UseMlAddonStatusReturn {
  status: MlAddonStatusSummary | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  runHealthCheck: () => Promise<void>;
}

export function useMlAddonStatus(): UseMlAddonStatusReturn {
  const [status, setStatus] = useState<MlAddonStatusSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getMlAddonStatus();
      setStatus(data);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to load status'));
    } finally {
      setLoading(false);
    }
  }, []);

  const runHealthCheckAction = useCallback(async () => {
    try {
      await runMlHealthCheck();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Health check failed'));
    }
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    status,
    loading,
    error,
    refresh,
    runHealthCheck: runHealthCheckAction,
  };
}

// ============================================
// ML Executions Hook
// ============================================

export interface UseMlExecutionsOptions {
  page?: number;
  size?: number;
  status?: ExecutionStatus;
  addonKey?: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export interface UseMlExecutionsReturn {
  executions: MlAddonExecution[];
  total: number;
  totalPages: number;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  setPage: (page: number) => void;
  currentPage: number;
}

export function useMlExecutions(options: UseMlExecutionsOptions = {}): UseMlExecutionsReturn {
  const {
    page: initialPage = 0,
    size = 20,
    status,
    addonKey,
    autoRefresh = false,
    refreshInterval = 10000,
  } = options;

  const [executions, setExecutions] = useState<MlAddonExecution[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await listMlExecutions(currentPage, size, status, addonKey);
      setExecutions(data.content);
      setTotal(data.totalElements);
      setTotalPages(data.totalPages);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to load executions'));
    } finally {
      setLoading(false);
    }
  }, [currentPage, size, status, addonKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, refresh]);

  return {
    executions,
    total,
    totalPages,
    loading,
    error,
    refresh,
    setPage: setCurrentPage,
    currentPage,
  };
}

// ============================================
// Article Analysis Hook
// ============================================

export interface UseArticleAnalysisReturn {
  executions: MlAddonExecution[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  analyze: (importance?: 'realtime' | 'batch') => Promise<void>;
  analyzeCategory: (category: AddonCategory) => Promise<MlAddonResponse>;
  isAnalyzing: boolean;
}

export function useArticleAnalysis(articleId: number | null): UseArticleAnalysisReturn {
  const [executions, setExecutions] = useState<MlAddonExecution[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const refresh = useCallback(async () => {
    if (!articleId) return;
    try {
      setLoading(true);
      setError(null);
      const data = await getArticleExecutions(articleId);
      setExecutions(data);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to load executions'));
    } finally {
      setLoading(false);
    }
  }, [articleId]);

  const analyze = useCallback(
    async (importance: 'realtime' | 'batch' = 'batch') => {
      if (!articleId) return;
      try {
        setIsAnalyzing(true);
        setError(null);
        await analyzeArticle(articleId, importance);
        // 분석 시작 후 잠시 대기하고 새로고침
        setTimeout(refresh, 1000);
      } catch (e) {
        setError(e instanceof Error ? e : new Error('Failed to start analysis'));
        throw e;
      } finally {
        setIsAnalyzing(false);
      }
    },
    [articleId, refresh]
  );

  const analyzeCategoryAction = useCallback(
    async (category: AddonCategory): Promise<MlAddonResponse> => {
      if (!articleId) throw new Error('No article ID');
      try {
        setIsAnalyzing(true);
        setError(null);
        const result = await analyzeByCategory(articleId, category);
        refresh();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e : new Error('Failed to analyze'));
        throw e;
      } finally {
        setIsAnalyzing(false);
      }
    },
    [articleId, refresh]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    executions,
    loading,
    error,
    refresh,
    analyze,
    analyzeCategory: analyzeCategoryAction,
    isAnalyzing,
  };
}

export default useMlAddons;
