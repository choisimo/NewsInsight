/**
 * useContinueWork - 마지막 작업 상태를 추적하고 이어하기 기능 제공
 * 
 * 추적 대상:
 * - 진행 중인 Deep Search 작업
 * - 미완료 팩트체크
 * - 마지막으로 본 검색 결과
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchHistory } from './useSearchHistory';
import { getDeepSearchStatus, type DeepSearchJob } from '@/lib/api';

export type WorkType = 'deep_search' | 'fact_check' | 'unified_search' | 'browser_agent' | 'url_analysis';

export interface ContinueWorkItem {
  id: string;
  type: WorkType;
  title: string;
  description?: string;
  progress?: number;
  status: 'in_progress' | 'paused' | 'waiting' | 'ready';
  continueUrl: string;
  lastUpdated: string;
  metadata?: {
    jobId?: string;
    query?: string;
    claimsCount?: number;
    evidenceCount?: number;
  };
}

interface UseContinueWorkReturn {
  lastWork: ContinueWorkItem | null;
  recentWorks: ContinueWorkItem[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  dismissWork: (id: string) => void;
  clearAllWorks: () => void;
}

const STORAGE_KEY = 'newsinsight_continue_work';
const MAX_RECENT_WORKS = 5;

// 작업 타입별 라벨
const WORK_TYPE_LABELS: Record<WorkType, string> = {
  deep_search: '심층 분석',
  fact_check: '팩트체크',
  unified_search: '통합 검색',
  browser_agent: 'AI 에이전트',
  url_analysis: 'URL 분석',
};

/**
 * 마지막 작업 상태를 추적하고 이어하기 기능을 제공하는 Hook
 */
export function useContinueWork(): UseContinueWorkReturn {
  const [lastWork, setLastWork] = useState<ContinueWorkItem | null>(null);
  const [recentWorks, setRecentWorks] = useState<ContinueWorkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const { history, loadHistory } = useSearchHistory({ pageSize: 10 });

  // localStorage에서 저장된 작업 불러오기
  const loadStoredWorks = useCallback((): ContinueWorkItem[] => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as ContinueWorkItem[];
        // 24시간 이상 된 작업 제거
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        return parsed.filter(work => new Date(work.lastUpdated).getTime() > oneDayAgo);
      }
    } catch (e) {
      console.error('Failed to load stored works:', e);
    }
    return [];
  }, []);

  // 작업 저장
  const saveWorks = useCallback((works: ContinueWorkItem[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(works.slice(0, MAX_RECENT_WORKS)));
    } catch (e) {
      console.error('Failed to save works:', e);
    }
  }, []);

  // Deep Search 작업 상태 확인
  const checkDeepSearchJobs = useCallback(async (): Promise<ContinueWorkItem[]> => {
    const items: ContinueWorkItem[] = [];
    
    // sessionStorage에서 진행 중인 deep search job ID 확인
    const activeJobId = sessionStorage.getItem('active_deep_search_job');
    
    if (activeJobId) {
      try {
        const jobStatus = await getDeepSearchStatus(activeJobId);
        
        if (jobStatus.status === 'IN_PROGRESS' || jobStatus.status === 'PENDING') {
          items.push({
            id: `deep_${activeJobId}`,
            type: 'deep_search',
            title: jobStatus.topic,
            description: `${WORK_TYPE_LABELS.deep_search} 진행 중`,
            progress: jobStatus.status === 'PENDING' ? 0 : 50,
            status: 'in_progress',
            continueUrl: `/search?mode=deep&q=${encodeURIComponent(jobStatus.topic)}&jobId=${activeJobId}`,
            lastUpdated: jobStatus.createdAt,
            metadata: {
              jobId: activeJobId,
              query: jobStatus.topic,
              evidenceCount: jobStatus.evidenceCount,
            },
          });
        }
      } catch (e) {
        console.error('Failed to check deep search job:', e);
      }
    }
    
    return items;
  }, []);

  // 검색 히스토리에서 최근 작업 변환
  const convertHistoryToWorks = useCallback((historyItems: typeof history): ContinueWorkItem[] => {
    return historyItems.slice(0, 5).map(item => {
      const type: WorkType = 
        item.searchType === 'DEEP_SEARCH' ? 'deep_search' :
        item.searchType === 'FACT_CHECK' ? 'fact_check' :
        item.searchType === 'BROWSER_AGENT' ? 'browser_agent' :
        'unified_search';
      
      const modeParam = 
        type === 'deep_search' ? 'deep' :
        type === 'fact_check' ? 'factcheck' :
        'unified';
      
      return {
        id: `history_${item.id}`,
        type,
        title: item.query,
        description: `${WORK_TYPE_LABELS[type]} - ${item.resultCount || 0}개 결과`,
        status: 'ready' as const,
        continueUrl: `/search?mode=${modeParam}&q=${encodeURIComponent(item.query)}`,
        lastUpdated: item.createdAt,
        metadata: {
          query: item.query,
        },
      };
    });
  }, []);

  // 데이터 새로고침
  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // 병렬로 데이터 로드
      const [deepSearchWorks, _] = await Promise.all([
        checkDeepSearchJobs(),
        loadHistory(0),
      ]);
      
      const storedWorks = loadStoredWorks();
      const historyWorks = convertHistoryToWorks(history);
      
      // 진행 중인 작업이 가장 우선순위
      const allWorks = [
        ...deepSearchWorks,
        ...storedWorks.filter(w => w.status === 'in_progress' || w.status === 'paused'),
        ...historyWorks,
      ];
      
      // 중복 제거 (ID 기준)
      const uniqueWorks = allWorks.reduce((acc, work) => {
        if (!acc.find(w => w.id === work.id)) {
          acc.push(work);
        }
        return acc;
      }, [] as ContinueWorkItem[]);
      
      // 가장 최근 작업을 lastWork로 설정
      const inProgressWork = uniqueWorks.find(w => w.status === 'in_progress');
      setLastWork(inProgressWork || uniqueWorks[0] || null);
      setRecentWorks(uniqueWorks.slice(0, MAX_RECENT_WORKS));
      
    } catch (e) {
      setError(e instanceof Error ? e.message : '작업 목록을 불러오는데 실패했습니다.');
      console.error('Failed to refresh continue work:', e);
    } finally {
      setIsLoading(false);
    }
  }, [checkDeepSearchJobs, loadHistory, loadStoredWorks, convertHistoryToWorks, history]);

  // 작업 해제
  const dismissWork = useCallback((id: string) => {
    setRecentWorks(prev => {
      const updated = prev.filter(w => w.id !== id);
      saveWorks(updated);
      return updated;
    });
    
    if (lastWork?.id === id) {
      setLastWork(null);
    }
  }, [lastWork, saveWorks]);

  // 모든 작업 해제
  const clearAllWorks = useCallback(() => {
    setRecentWorks([]);
    setLastWork(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  // 초기 로드
  useEffect(() => {
    refresh();
  }, []);

  // history 변경 시 업데이트
  useEffect(() => {
    if (history.length > 0) {
      const historyWorks = convertHistoryToWorks(history);
      setRecentWorks(prev => {
        const inProgressWorks = prev.filter(w => w.status === 'in_progress' || w.status === 'paused');
        return [...inProgressWorks, ...historyWorks].slice(0, MAX_RECENT_WORKS);
      });
    }
  }, [history, convertHistoryToWorks]);

  return {
    lastWork,
    recentWorks,
    isLoading,
    error,
    refresh,
    dismissWork,
    clearAllWorks,
  };
}

/**
 * 현재 작업을 저장하는 유틸리티 함수
 * 검색이나 분석 시작 시 호출
 */
export function saveCurrentWork(work: Omit<ContinueWorkItem, 'lastUpdated'>) {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const works: ContinueWorkItem[] = stored ? JSON.parse(stored) : [];
    
    // 기존 동일 ID 제거
    const filtered = works.filter(w => w.id !== work.id);
    
    // 새 작업 추가
    const newWork: ContinueWorkItem = {
      ...work,
      lastUpdated: new Date().toISOString(),
    };
    
    const updated = [newWork, ...filtered].slice(0, MAX_RECENT_WORKS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save current work:', e);
  }
}

/**
 * Deep Search 작업 시작 시 호출
 */
export function trackDeepSearchJob(jobId: string, topic: string) {
  sessionStorage.setItem('active_deep_search_job', jobId);
  saveCurrentWork({
    id: `deep_${jobId}`,
    type: 'deep_search',
    title: topic,
    description: '심층 분석 진행 중...',
    progress: 0,
    status: 'in_progress',
    continueUrl: `/search?mode=deep&q=${encodeURIComponent(topic)}&jobId=${jobId}`,
    metadata: { jobId, query: topic },
  });
}

/**
 * Deep Search 완료 시 호출
 */
export function completeDeepSearchJob(jobId: string) {
  sessionStorage.removeItem('active_deep_search_job');
  // 완료된 작업은 ready 상태로 변경됨 (히스토리에서 표시)
}

export default useContinueWork;
