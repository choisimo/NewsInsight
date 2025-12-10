import { useCallback, useState, useMemo } from 'react';
import { useEventSource } from './useEventSource';

// ============================================
// Dashboard Event Types
// ============================================

export type DashboardEventType =
  | 'HEARTBEAT'
  | 'NEW_DATA'
  | 'SOURCE_UPDATED'
  | 'STATS_UPDATED'
  | 'COLLECTION_STARTED'
  | 'COLLECTION_COMPLETED'
  | 'ERROR';

export interface DashboardEvent {
  eventType: DashboardEventType;
  timestamp: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface DashboardStats {
  total: number;
  unprocessed: number;
  processed: number;
  todayCount?: number;
  errorCount?: number;
}

export interface ActivityLogEntry {
  id: string;
  eventType: DashboardEventType;
  message: string;
  timestamp: Date;
  data?: Record<string, unknown>;
}

// ============================================
// Dashboard Events Stream Hook
// ============================================

export interface UseDashboardEventsOptions {
  /** 활동 로그 최대 보관 개수 */
  maxActivityLogs?: number;
  /** 연결 활성화 여부 */
  enabled?: boolean;
  /** 이벤트 수신 콜백 */
  onEvent?: (event: DashboardEvent) => void;
}

export interface UseDashboardEventsReturn {
  /** 최근 활동 로그 */
  activityLogs: ActivityLogEntry[];
  /** 연결 상태 */
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  /** 재연결 시도 횟수 */
  retryCount: number;
  /** 수동 재연결 */
  reconnect: () => void;
  /** 활동 로그 초기화 */
  clearLogs: () => void;
}

/**
 * 대시보드 이벤트 스트림을 구독하는 훅
 * GET /api/v1/events/stream
 */
export function useDashboardEvents(
  options: UseDashboardEventsOptions = {}
): UseDashboardEventsReturn {
  const {
    maxActivityLogs = 50,
    enabled = true,
    onEvent,
  } = options;

  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);

  const handleMessage = useCallback((data: string) => {
    try {
      const event: DashboardEvent = JSON.parse(data);
      
      // HEARTBEAT는 로그에 추가하지 않음
      if (event.eventType !== 'HEARTBEAT') {
        const logEntry: ActivityLogEntry = {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          eventType: event.eventType,
          message: event.message,
          timestamp: new Date(event.timestamp),
          data: event.data,
        };

        setActivityLogs((prev) => {
          const newLogs = [logEntry, ...prev];
          return newLogs.slice(0, maxActivityLogs);
        });
      }

      onEvent?.(event);
    } catch (e) {
      console.error('Failed to parse dashboard event:', e);
    }
  }, [maxActivityLogs, onEvent]);

  const { status, retryCount, reconnect } = useEventSource(
    enabled ? '/api/v1/events/stream' : null,
    {
      onMessage: handleMessage,
      reconnectInterval: 5000,
      maxRetries: 10,
      enabled,
    }
  );

  const clearLogs = useCallback(() => {
    setActivityLogs([]);
  }, []);

  return {
    activityLogs,
    status,
    retryCount,
    reconnect,
    clearLogs,
  };
}

// ============================================
// Dashboard Stats Stream Hook
// ============================================

export interface UseDashboardStatsOptions {
  /** 연결 활성화 여부 */
  enabled?: boolean;
  /** 통계 업데이트 콜백 */
  onStatsUpdate?: (stats: DashboardStats) => void;
}

export interface UseDashboardStatsReturn {
  /** 현재 통계 */
  stats: DashboardStats | null;
  /** 이전 통계 (변화량 계산용) */
  previousStats: DashboardStats | null;
  /** 연결 상태 */
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  /** 마지막 업데이트 시간 */
  lastUpdated: Date | null;
  /** 수동 재연결 */
  reconnect: () => void;
}

/**
 * 대시보드 통계 스트림을 구독하는 훅
 * GET /api/v1/events/stats/stream
 */
export function useDashboardStats(
  options: UseDashboardStatsOptions = {}
): UseDashboardStatsReturn {
  const { enabled = true, onStatsUpdate } = options;

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [previousStats, setPreviousStats] = useState<DashboardStats | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const handleMessage = useCallback((data: string) => {
    try {
      const event: DashboardEvent = JSON.parse(data);
      
      if (event.eventType === 'STATS_UPDATED' && event.data) {
        const newStats: DashboardStats = {
          total: (event.data.total as number) ?? 0,
          unprocessed: (event.data.unprocessed as number) ?? 0,
          processed: (event.data.processed as number) ?? 0,
          todayCount: event.data.todayCount as number | undefined,
          errorCount: event.data.errorCount as number | undefined,
        };

        setPreviousStats(stats);
        setStats(newStats);
        setLastUpdated(new Date());
        onStatsUpdate?.(newStats);
      }
    } catch (e) {
      console.error('Failed to parse stats event:', e);
    }
  }, [stats, onStatsUpdate]);

  const { status, reconnect } = useEventSource(
    enabled ? '/api/v1/events/stats/stream' : null,
    {
      onMessage: handleMessage,
      reconnectInterval: 5000,
      maxRetries: 10,
      enabled,
    }
  );

  return {
    stats,
    previousStats,
    status,
    lastUpdated,
    reconnect,
  };
}

// ============================================
// Combined Dashboard Hook
// ============================================

export interface UseLiveDashboardOptions {
  /** 활동 로그 최대 보관 개수 */
  maxActivityLogs?: number;
  /** 연결 활성화 여부 */
  enabled?: boolean;
}

export interface UseLiveDashboardReturn {
  /** 현재 통계 */
  stats: DashboardStats | null;
  /** 이전 통계 */
  previousStats: DashboardStats | null;
  /** 최근 활동 로그 */
  activityLogs: ActivityLogEntry[];
  /** 이벤트 스트림 연결 상태 */
  eventsStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  /** 통계 스트림 연결 상태 */
  statsStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  /** 전체 연결 상태 (하나라도 연결되면 connected) */
  isConnected: boolean;
  /** 마지막 통계 업데이트 시간 */
  lastStatsUpdate: Date | null;
  /** 이벤트 스트림 재연결 */
  reconnectEvents: () => void;
  /** 통계 스트림 재연결 */
  reconnectStats: () => void;
  /** 활동 로그 초기화 */
  clearLogs: () => void;
}

/**
 * 대시보드 이벤트 + 통계 스트림을 모두 구독하는 통합 훅
 */
export function useLiveDashboard(
  options: UseLiveDashboardOptions = {}
): UseLiveDashboardReturn {
  const { maxActivityLogs = 50, enabled = true } = options;

  const {
    activityLogs,
    status: eventsStatus,
    reconnect: reconnectEvents,
    clearLogs,
  } = useDashboardEvents({ maxActivityLogs, enabled });

  const {
    stats,
    previousStats,
    status: statsStatus,
    lastUpdated: lastStatsUpdate,
    reconnect: reconnectStats,
  } = useDashboardStats({ enabled });

  const isConnected = useMemo(
    () => eventsStatus === 'connected' || statsStatus === 'connected',
    [eventsStatus, statsStatus]
  );

  return {
    stats,
    previousStats,
    activityLogs,
    eventsStatus,
    statsStatus,
    isConnected,
    lastStatsUpdate,
    reconnectEvents,
    reconnectStats,
    clearLogs,
  };
}

export default useLiveDashboard;
