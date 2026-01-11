import { useCallback, useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEventSource } from './useEventSource';
import type { PageResponse } from '@/types/api';
import type {
  ServerRow,
  ServerDetail,
  ServerQuery,
  ServerSummary,
  MonitoringEvent,
  ConnectionStatus,
} from '@/types/monitoring';
import {
  fetchServersMock,
  fetchServerSummaryMock,
  fetchServerByIdMock,
  // Real API functions (uncomment when backend is ready)
  // fetchServers,
  // fetchServerSummary,
  // fetchServerById,
  // openMonitoringStream,
} from '@/lib/api/monitoring';

// ============================================
// Query Keys
// ============================================

export const MONITORING_QUERY_KEYS = {
  all: ['monitoring'] as const,
  servers: (query: ServerQuery, page: number, size: number) => 
    [...MONITORING_QUERY_KEYS.all, 'servers', query, page, size] as const,
  serverDetail: (serverId: string) => 
    [...MONITORING_QUERY_KEYS.all, 'server', serverId] as const,
  summary: (query?: ServerQuery) => 
    [...MONITORING_QUERY_KEYS.all, 'summary', query] as const,
};

// ============================================
// Server List Hook
// ============================================

export interface UseServerListOptions {
  /** 필터 쿼리 */
  query: ServerQuery;
  /** 페이지 번호 (0-based) */
  page?: number;
  /** 페이지 크기 */
  size?: number;
  /** 활성화 여부 */
  enabled?: boolean;
}

export interface UseServerListReturn {
  /** 서버 목록 */
  servers: ServerRow[];
  /** 전체 서버 수 */
  totalElements: number;
  /** 전체 페이지 수 */
  totalPages: number;
  /** 현재 페이지 */
  currentPage: number;
  /** 로딩 중 */
  isLoading: boolean;
  /** 에러 */
  error: Error | null;
  /** 수동 새로고침 */
  refetch: () => void;
  /** 새로고침 중 */
  isRefetching: boolean;
}

/**
 * 서버 목록 조회 훅
 * 명시적 조회 버튼을 눌렀을 때만 데이터를 가져옴 (Deterministic)
 */
export function useServerList(options: UseServerListOptions): UseServerListReturn {
  const { query, page = 0, size = 20, enabled = true } = options;

  const {
    data,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useQuery<PageResponse<ServerRow>, Error>({
    queryKey: MONITORING_QUERY_KEYS.servers(query, page, size),
    queryFn: () => fetchServersMock(query, page, size),
    // queryFn: () => fetchServers(query, page, size), // Real API
    enabled,
    staleTime: 30 * 1000, // 30초간 fresh
    refetchOnWindowFocus: false, // 명시적 리프레시만
  });

  return {
    servers: data?.content ?? [],
    totalElements: data?.totalElements ?? 0,
    totalPages: data?.totalPages ?? 0,
    currentPage: data?.number ?? page,
    isLoading,
    error,
    refetch,
    isRefetching,
  };
}

// ============================================
// Server Summary Hook
// ============================================

export interface UseServerSummaryOptions {
  /** 필터 쿼리 */
  query?: ServerQuery;
  /** 활성화 여부 */
  enabled?: boolean;
}

export interface UseServerSummaryReturn {
  /** 요약 데이터 */
  summary: ServerSummary | null;
  /** 로딩 중 */
  isLoading: boolean;
  /** 에러 */
  error: Error | null;
  /** 수동 새로고침 */
  refetch: () => void;
}

/**
 * 서버 요약 통계 조회 훅
 */
export function useServerSummary(options: UseServerSummaryOptions = {}): UseServerSummaryReturn {
  const { query, enabled = true } = options;

  const { data, isLoading, error, refetch } = useQuery<ServerSummary, Error>({
    queryKey: MONITORING_QUERY_KEYS.summary(query),
    queryFn: () => fetchServerSummaryMock(query),
    // queryFn: () => fetchServerSummary(query), // Real API
    enabled,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  return {
    summary: data ?? null,
    isLoading,
    error,
    refetch,
  };
}

// ============================================
// Server Detail Hook
// ============================================

export interface UseServerDetailOptions {
  /** 서버 ID */
  serverId: string | null;
  /** 활성화 여부 */
  enabled?: boolean;
}

export interface UseServerDetailReturn {
  /** 서버 상세 정보 */
  server: ServerDetail | null;
  /** 로딩 중 */
  isLoading: boolean;
  /** 에러 */
  error: Error | null;
  /** 수동 새로고침 */
  refetch: () => void;
}

/**
 * 서버 상세 정보 조회 훅
 */
export function useServerDetail(options: UseServerDetailOptions): UseServerDetailReturn {
  const { serverId, enabled = true } = options;

  const { data, isLoading, error, refetch } = useQuery<ServerDetail, Error>({
    queryKey: MONITORING_QUERY_KEYS.serverDetail(serverId ?? ''),
    queryFn: () => fetchServerByIdMock(serverId!),
    // queryFn: () => fetchServerById(serverId!), // Real API
    enabled: enabled && !!serverId,
    staleTime: 10 * 1000, // 10초간 fresh (상세 정보는 더 자주 갱신)
    refetchOnWindowFocus: false,
  });

  return {
    server: data ?? null,
    isLoading,
    error,
    refetch,
  };
}

// ============================================
// Real-time Monitoring Stream Hook
// ============================================

export interface UseMonitoringStreamOptions {
  /** 스트림 활성화 여부 (자동 갱신 토글) */
  enabled?: boolean;
  /** 이벤트 수신 콜백 */
  onEvent?: (event: MonitoringEvent) => void;
}

export interface UseMonitoringStreamReturn {
  /** 연결 상태 */
  connectionStatus: ConnectionStatus;
  /** 마지막 이벤트 */
  lastEvent: MonitoringEvent | null;
  /** 마지막 업데이트 시간 */
  lastUpdated: Date | null;
  /** 재연결 시도 횟수 */
  retryCount: number;
  /** 수동 재연결 */
  reconnect: () => void;
  /** 연결 해제 */
  disconnect: () => void;
}

/**
 * 실시간 모니터링 스트림 훅 (SSE)
 * 자동 갱신 옵션이 켜져 있을 때만 연결
 */
export function useMonitoringStream(
  options: UseMonitoringStreamOptions = {}
): UseMonitoringStreamReturn {
  const { enabled = false, onEvent } = options;
  
  const queryClient = useQueryClient();
  const [lastEvent, setLastEvent] = useState<MonitoringEvent | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const handleMessage = useCallback((data: string) => {
    try {
      const event: MonitoringEvent = JSON.parse(data);
      setLastEvent(event);
      setLastUpdated(new Date());

      // 이벤트 타입에 따라 캐시 무효화
      if (event.eventType === 'server_status' || event.eventType === 'metric_update') {
        // 서버 목록 캐시 무효화
        queryClient.invalidateQueries({ queryKey: MONITORING_QUERY_KEYS.all });
      }

      onEventRef.current?.(event);
    } catch (e) {
      console.error('Failed to parse monitoring event:', e);
    }
  }, [queryClient]);

  const { status, retryCount, reconnect, disconnect } = useEventSource(
    enabled ? '/api/v1/monitoring/stream' : null,
    {
      onMessage: handleMessage,
      reconnectInterval: 5000,
      maxRetries: 10,
      enabled,
      storageKeyPrefix: 'monitoring',
    }
  );

  // Map useEventSource status to ConnectionStatus
  const connectionStatus: ConnectionStatus = status;

  return {
    connectionStatus,
    lastEvent,
    lastUpdated,
    retryCount,
    reconnect,
    disconnect,
  };
}

// ============================================
// Combined Server Monitoring Hook
// ============================================

export interface UseServerMonitoringOptions {
  /** 초기 필터 쿼리 */
  initialQuery?: ServerQuery;
  /** 페이지 크기 */
  pageSize?: number;
  /** 자동 갱신 간격 (ms), 0이면 비활성화 */
  autoRefreshInterval?: number;
  /** SSE 스트림 사용 여부 */
  useStream?: boolean;
}

export interface UseServerMonitoringReturn {
  // 필터 상태
  query: ServerQuery;
  setQuery: (query: ServerQuery) => void;
  
  // 페이지네이션
  page: number;
  setPage: (page: number) => void;
  pageSize: number;
  
  // 서버 목록
  servers: ServerRow[];
  totalElements: number;
  totalPages: number;
  isLoadingServers: boolean;
  
  // 요약 통계
  summary: ServerSummary | null;
  isLoadingSummary: boolean;
  
  // 상세 보기
  selectedServerId: string | null;
  setSelectedServerId: (id: string | null) => void;
  selectedServer: ServerDetail | null;
  isLoadingDetail: boolean;
  
  // 연결 상태
  connectionStatus: ConnectionStatus;
  lastUpdated: Date | null;
  
  // 자동 갱신
  autoRefreshEnabled: boolean;
  setAutoRefreshEnabled: (enabled: boolean) => void;
  
  // 액션
  search: () => void;
  refresh: () => void;
  reconnect: () => void;
  
  // 에러
  error: Error | null;
}

/**
 * 서버 모니터링 통합 훅
 * 서버 목록, 요약, 상세 정보, 실시간 스트림을 통합 관리
 * 
 * 설계 철학:
 * - Deterministic: 사용자 액션(조회 버튼)에 의해서만 데이터 로드
 * - 자동 갱신은 명시적 opt-in (토글)
 * - 필터 변경 시 자동 fetch 안함 → 조회 버튼 클릭 필요
 */
export function useServerMonitoring(
  options: UseServerMonitoringOptions = {}
): UseServerMonitoringReturn {
  const {
    initialQuery = {},
    pageSize = 20,
    autoRefreshInterval = 0,
    useStream = false,
  } = options;

  // 필터 상태
  const [query, setQuery] = useState<ServerQuery>(initialQuery);
  const [appliedQuery, setAppliedQuery] = useState<ServerQuery>(initialQuery);
  
  // 페이지네이션
  const [page, setPage] = useState(0);
  
  // 선택된 서버
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  
  // 자동 갱신 상태
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  
  // 데이터 로드 트리거 (명시적 조회 시에만 true)
  const [shouldFetch, setShouldFetch] = useState(false);
  
  // 마지막 업데이트 시간
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // 서버 목록 조회
  const {
    servers,
    totalElements,
    totalPages,
    isLoading: isLoadingServers,
    error: serversError,
    refetch: refetchServers,
  } = useServerList({
    query: appliedQuery,
    page,
    size: pageSize,
    enabled: shouldFetch,
  });

  // 요약 통계 조회
  const {
    summary,
    isLoading: isLoadingSummary,
    error: summaryError,
    refetch: refetchSummary,
  } = useServerSummary({
    query: appliedQuery,
    enabled: shouldFetch,
  });

  // 서버 상세 정보
  const {
    server: selectedServer,
    isLoading: isLoadingDetail,
    error: detailError,
  } = useServerDetail({
    serverId: selectedServerId,
    enabled: !!selectedServerId,
  });

  // 실시간 스트림 (자동 갱신이 활성화되고 useStream이 true일 때)
  const {
    connectionStatus,
    lastUpdated: streamLastUpdated,
    reconnect,
  } = useMonitoringStream({
    enabled: autoRefreshEnabled && useStream,
    onEvent: () => {
      // SSE 이벤트 수신 시 마지막 업데이트 시간 갱신
      setLastUpdated(new Date());
    },
  });

  // 자동 갱신 (polling fallback - SSE 사용 안할 때)
  useEffect(() => {
    if (!autoRefreshEnabled || useStream || autoRefreshInterval <= 0) {
      return;
    }

    const interval = setInterval(() => {
      refetchServers();
      refetchSummary();
      setLastUpdated(new Date());
    }, autoRefreshInterval);

    return () => clearInterval(interval);
  }, [autoRefreshEnabled, useStream, autoRefreshInterval, refetchServers, refetchSummary]);

  // 조회 실행
  const search = useCallback(() => {
    setAppliedQuery(query);
    setPage(0);
    setShouldFetch(true);
    setLastUpdated(new Date());
  }, [query]);

  // 새로고침 (현재 필터로 재조회)
  const refresh = useCallback(() => {
    refetchServers();
    refetchSummary();
    setLastUpdated(new Date());
  }, [refetchServers, refetchSummary]);

  // 첫 렌더링 시 자동 로드 (선택적)
  useEffect(() => {
    // 초기 로드를 원한다면 아래 주석 해제
    // search();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 통합 에러
  const error = serversError || summaryError || detailError;

  // 스트림 마지막 업데이트 시간 동기화
  useEffect(() => {
    if (streamLastUpdated) {
      setLastUpdated(streamLastUpdated);
    }
  }, [streamLastUpdated]);

  return {
    // 필터 상태
    query,
    setQuery,
    
    // 페이지네이션
    page,
    setPage,
    pageSize,
    
    // 서버 목록
    servers,
    totalElements,
    totalPages,
    isLoadingServers,
    
    // 요약 통계
    summary,
    isLoadingSummary,
    
    // 상세 보기
    selectedServerId,
    setSelectedServerId,
    selectedServer,
    isLoadingDetail,
    
    // 연결 상태
    connectionStatus: useStream ? connectionStatus : (autoRefreshEnabled ? 'connected' : 'disconnected'),
    lastUpdated,
    
    // 자동 갱신
    autoRefreshEnabled,
    setAutoRefreshEnabled,
    
    // 액션
    search,
    refresh,
    reconnect,
    
    // 에러
    error,
  };
}

export default useServerMonitoring;
