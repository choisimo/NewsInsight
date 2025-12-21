/**
 * useContinueWork - 마지막 작업 상태를 추적하고 이어하기 기능 제공
 * 
 * 이제 백엔드 API를 사용하여 서버에서 관리되는 continue work 항목을 가져옵니다.
 * 
 * 추적 대상:
 * - 진행 중인 Deep Search 작업
 * - 미완료 팩트체크
 * - 실패한 검색 (재시도 가능)
 * - 미확인 완료 검색
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getContinueWorkItems,
  markSearchAsViewed,
  markSearchAsViewedByExternalId,
  updateSearchCompletionStatus,
  getFailedSearches,
  type ContinueWorkItem as APIContinueWorkItem,
  type CompletionStatus,
  type SearchHistoryType,
} from '@/lib/api';

export type WorkType = 'deep_search' | 'fact_check' | 'unified_search' | 'browser_agent' | 'url_analysis';
export type WorkStatus = 'in_progress' | 'paused' | 'waiting' | 'ready' | 'failed' | 'draft';

export interface ContinueWorkItem {
  id: string;
  type: WorkType;
  title: string;
  description?: string;
  progress?: number;
  status: WorkStatus;
  continueUrl: string;
  lastUpdated: string;
  viewed?: boolean;
  metadata?: {
    jobId?: string;
    query?: string;
    claimsCount?: number;
    evidenceCount?: number;
    errorMessage?: string;
    failurePhase?: string;
    dbId?: number; // Database ID for API calls
  };
}

interface ContinueWorkStats {
  total: number;
  inProgress: number;
  failed: number;
  draft: number;
  partial: number;
  unviewedCompleted: number;
}

interface UseContinueWorkReturn {
  lastWork: ContinueWorkItem | null;
  recentWorks: ContinueWorkItem[];
  stats: ContinueWorkStats;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  dismissWork: (id: string) => Promise<void>;
  markAsViewed: (id: string) => Promise<void>;
  retryWork: (id: string) => void;
  clearAllWorks: () => void;
}

const MAX_RECENT_WORKS = 10;

// 작업 타입별 라벨
const WORK_TYPE_LABELS: Record<WorkType, string> = {
  deep_search: '심층 분석',
  fact_check: '팩트체크',
  unified_search: '통합 검색',
  browser_agent: 'AI 에이전트',
  url_analysis: 'URL 분석',
};

// Search history type to work type mapping
const SEARCH_TYPE_TO_WORK_TYPE: Record<SearchHistoryType, WorkType> = {
  UNIFIED: 'unified_search',
  DEEP_SEARCH: 'deep_search',
  FACT_CHECK: 'fact_check',
  BROWSER_AGENT: 'browser_agent',
  NEWS_SEARCH: 'unified_search',
  URL_ANALYSIS: 'url_analysis',
};

// Completion status to work status mapping
const COMPLETION_TO_WORK_STATUS: Record<CompletionStatus, WorkStatus> = {
  DRAFT: 'draft',
  IN_PROGRESS: 'in_progress',
  PARTIAL: 'paused',
  COMPLETED: 'ready',
  FAILED: 'failed',
  CANCELLED: 'ready',
};

// Convert API item to internal format
function convertApiItemToWorkItem(item: APIContinueWorkItem): ContinueWorkItem {
  const searchType = item.searchType as SearchHistoryType;
  const type = SEARCH_TYPE_TO_WORK_TYPE[searchType] || 'unified_search';
  const completionStatus = item.completionStatus || 'COMPLETED';
  const status = COMPLETION_TO_WORK_STATUS[completionStatus] || 'ready';
  
  // Build continue URL based on search type
  const modeParam = 
    type === 'deep_search' ? 'deep' :
    type === 'fact_check' ? 'factcheck' :
    type === 'browser_agent' ? 'agent' :
    'unified';
  
  let continueUrl = `/search?mode=${modeParam}&q=${encodeURIComponent(item.query)}`;
  
  // Add job ID for in-progress deep search
  if (item.externalId && status === 'in_progress') {
    continueUrl += `&jobId=${item.externalId}`;
  }
  
  // For failed searches, add retry flag
  if (status === 'failed') {
    continueUrl += '&retry=true';
  }

  return {
    id: item.externalId || `db_${item.id}`,
    type,
    title: item.query,
    description: buildDescription(type, item, status),
    progress: item.progress,
    status,
    continueUrl,
    lastUpdated: item.updatedAt || item.createdAt,
    viewed: item.viewed,
    metadata: {
      jobId: item.externalId,
      query: item.query,
      evidenceCount: item.resultCount,
      errorMessage: item.errorMessage,
      failurePhase: item.failurePhase,
      dbId: item.id,
    },
  };
}

// Build description based on status and type
function buildDescription(type: WorkType, item: APIContinueWorkItem, status: WorkStatus): string {
  const typeLabel = WORK_TYPE_LABELS[type];
  
  if (status === 'in_progress') {
    const phase = item.currentPhase || '진행 중';
    const progress = item.progress ? ` (${item.progress}%)` : '';
    return `${typeLabel} ${phase}${progress}`;
  }
  
  if (status === 'failed') {
    return `${typeLabel} 실패 - ${item.failurePhase || item.errorMessage || '오류 발생'}`;
  }
  
  if (status === 'draft') {
    return `${typeLabel} 초안`;
  }
  
  if (status === 'paused') {
    return `${typeLabel} 일시 중단`;
  }
  
  const resultText = item.resultCount ? `${item.resultCount}개 결과` : '';
  return `${typeLabel}${resultText ? ` - ${resultText}` : ''}`;
}

/**
 * 마지막 작업 상태를 추적하고 이어하기 기능을 제공하는 Hook
 * 이제 백엔드 API를 통해 서버에서 관리되는 데이터를 사용합니다.
 */
export function useContinueWork(userId: string = 'anonymous'): UseContinueWorkReturn {
  const [lastWork, setLastWork] = useState<ContinueWorkItem | null>(null);
  const [recentWorks, setRecentWorks] = useState<ContinueWorkItem[]>([]);
  const [stats, setStats] = useState<ContinueWorkStats>({
    total: 0,
    inProgress: 0,
    failed: 0,
    draft: 0,
    partial: 0,
    unviewedCompleted: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const sessionIdRef = useRef<string | null>(null);

  // Get session ID from sessionStorage
  useEffect(() => {
    sessionIdRef.current = sessionStorage.getItem('search-session-id');
  }, []);

  // 데이터 새로고침
  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await getContinueWorkItems(
        userId,
        sessionIdRef.current || undefined,
        MAX_RECENT_WORKS
      );
      
      // Convert API items to internal format
      const works = response.items.map(convertApiItemToWorkItem);
      
      // Set stats
      setStats(response.stats);
      
      // Find the most important work item
      // Priority: in_progress > failed > draft > partial > ready (unviewed)
      const priorityOrder: WorkStatus[] = ['in_progress', 'failed', 'draft', 'paused', 'ready'];
      
      let primaryWork: ContinueWorkItem | null = null;
      for (const status of priorityOrder) {
        const workWithStatus = works.find(w => w.status === status);
        if (workWithStatus) {
          // For 'ready' status, prioritize unviewed items
          if (status === 'ready') {
            const unviewedWork = works.find(w => w.status === 'ready' && !w.viewed);
            primaryWork = unviewedWork || workWithStatus;
          } else {
            primaryWork = workWithStatus;
          }
          break;
        }
      }
      
      setLastWork(primaryWork);
      setRecentWorks(works);
      
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : '작업 목록을 불러오는데 실패했습니다.';
      setError(errorMessage);
      console.error('Failed to refresh continue work:', e);
      
      // Fallback: keep existing data
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  // Mark work as viewed (dismiss from primary position)
  const markAsViewedAction = useCallback(async (id: string) => {
    try {
      // Find the work item to get the database ID
      const work = recentWorks.find(w => w.id === id);
      
      if (work?.metadata?.dbId) {
        await markSearchAsViewed(work.metadata.dbId);
      } else if (id.startsWith('db_')) {
        const dbId = parseInt(id.replace('db_', ''), 10);
        if (!isNaN(dbId)) {
          await markSearchAsViewed(dbId);
        }
      } else {
        // Try using external ID
        await markSearchAsViewedByExternalId(id);
      }
      
      // Update local state
      setRecentWorks(prev => 
        prev.map(w => w.id === id ? { ...w, viewed: true } : w)
      );
      
      // If this was the last work, find next one
      if (lastWork?.id === id) {
        const nextWork = recentWorks.find(w => w.id !== id && (w.status === 'in_progress' || !w.viewed));
        setLastWork(nextWork || null);
      }
    } catch (e) {
      console.error('Failed to mark work as viewed:', e);
    }
  }, [recentWorks, lastWork]);

  // Dismiss work (mark as viewed and remove from list)
  const dismissWork = useCallback(async (id: string) => {
    await markAsViewedAction(id);
    
    // Remove from local list
    setRecentWorks(prev => prev.filter(w => w.id !== id));
    
    if (lastWork?.id === id) {
      setLastWork(recentWorks.find(w => w.id !== id) || null);
    }
  }, [markAsViewedAction, lastWork, recentWorks]);

  // Retry failed work
  const retryWork = useCallback((id: string) => {
    const work = recentWorks.find(w => w.id === id);
    if (work?.continueUrl) {
      window.location.href = work.continueUrl;
    }
  }, [recentWorks]);

  // Clear all works (mark all as viewed)
  const clearAllWorks = useCallback(async () => {
    try {
      // Mark all as viewed
      await Promise.all(
        recentWorks
          .filter(w => !w.viewed && w.metadata?.dbId)
          .map(w => markSearchAsViewed(w.metadata!.dbId!))
      );
    } catch (e) {
      console.error('Failed to clear all works:', e);
    }
    
    setRecentWorks([]);
    setLastWork(null);
    setStats({
      total: 0,
      inProgress: 0,
      failed: 0,
      draft: 0,
      partial: 0,
      unviewedCompleted: 0,
    });
  }, [recentWorks]);

  // 초기 로드
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Periodic refresh for in-progress items
  useEffect(() => {
    if (stats.inProgress === 0) return;
    
    const intervalId = setInterval(() => {
      refresh();
    }, 10000); // Refresh every 10 seconds when there are in-progress items
    
    return () => clearInterval(intervalId);
  }, [stats.inProgress, refresh]);

  return {
    lastWork,
    recentWorks,
    stats,
    isLoading,
    error,
    refresh,
    dismissWork,
    markAsViewed: markAsViewedAction,
    retryWork,
    clearAllWorks,
  };
}

/**
 * 현재 작업을 저장하는 유틸리티 함수
 * 검색이나 분석 시작 시 호출
 * 
 * @deprecated 이제 백엔드에서 자동으로 관리됩니다. 검색 API가 자동으로 기록합니다.
 */
export function saveCurrentWork(work: Omit<ContinueWorkItem, 'lastUpdated'>) {
  console.warn('saveCurrentWork is deprecated. Search history is now managed by the backend automatically.');
  // No-op - backend handles this now
}

/**
 * Deep Search 작업 시작 시 호출
 * 
 * @deprecated 이제 백엔드에서 자동으로 관리됩니다.
 */
export function trackDeepSearchJob(jobId: string, topic: string) {
  console.warn('trackDeepSearchJob is deprecated. Use SearchJobContext instead.');
  // Keep session storage for backward compatibility
  sessionStorage.setItem('active_deep_search_job', jobId);
}

/**
 * Deep Search 완료 시 호출
 * 
 * @deprecated 이제 백엔드에서 자동으로 관리됩니다.
 */
export function completeDeepSearchJob(jobId: string) {
  console.warn('completeDeepSearchJob is deprecated. Use SearchJobContext instead.');
  sessionStorage.removeItem('active_deep_search_job');
}

export default useContinueWork;
