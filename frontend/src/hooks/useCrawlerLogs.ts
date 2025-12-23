import { useCallback, useState, useMemo } from 'react';
import { useEventSource } from './useEventSource';

// ============================================
// Crawler Log Types
// ============================================

export type CrawlerEventType =
  | 'connected'
  | 'agent_start'
  | 'agent_step'
  | 'agent_complete'
  | 'agent_error'
  | 'url_discovered'
  | 'health_update'
  | 'captcha_detected'
  | 'captcha_solved'
  | 'collection_start'
  | 'collection_progress'
  | 'collection_complete'
  | 'collection_error'
  | 'collection_log';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

export interface CrawlerEvent {
  type: CrawlerEventType;
  id: string;
  timestamp: string;
  data: {
    source?: string;
    task_id?: string;
    url?: string;
    message: string;
    level?: LogLevel;
    progress?: number;
    total?: number;
    [key: string]: unknown;
  };
}

export interface CrawlerLogEntry {
  id: string;
  eventType: CrawlerEventType;
  source: string;
  message: string;
  level: LogLevel;
  timestamp: Date;
  data?: Record<string, unknown>;
}

// ============================================
// Crawler Logs Stream Hook
// ============================================

export interface UseCrawlerLogsOptions {
  /** 로그 최대 보관 개수 */
  maxLogs?: number;
  /** 연결 활성화 여부 */
  enabled?: boolean;
  /** 필터링할 소스 (비어있으면 전체) */
  filterSources?: string[];
  /** 필터링할 로그 레벨 (비어있으면 전체) */
  filterLevels?: LogLevel[];
  /** 이벤트 수신 콜백 */
  onEvent?: (event: CrawlerEvent) => void;
}

export interface UseCrawlerLogsReturn {
  /** 로그 목록 */
  logs: CrawlerLogEntry[];
  /** 연결 상태 */
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  /** 재연결 시도 횟수 */
  retryCount: number;
  /** 수동 재연결 */
  reconnect: () => void;
  /** 로그 초기화 */
  clearLogs: () => void;
  /** 활성 소스 목록 */
  activeSources: string[];
  /** 소스별 상태 */
  sourceStatus: Record<string, 'idle' | 'running' | 'complete' | 'error'>;
}

/**
 * 크롤러 SSE 스트림을 구독하는 훅
 * autonomous-crawler 서비스의 /events 엔드포인트에 연결
 */
export function useCrawlerLogs(
  options: UseCrawlerLogsOptions = {}
): UseCrawlerLogsReturn {
  const {
    maxLogs = 200,
    enabled = true,
    filterSources = [],
    filterLevels = [],
    onEvent,
  } = options;

  const [logs, setLogs] = useState<CrawlerLogEntry[]>([]);
  const [activeSources, setActiveSources] = useState<string[]>([]);
  const [sourceStatus, setSourceStatus] = useState<Record<string, 'idle' | 'running' | 'complete' | 'error'>>({});

  const handleMessage = useCallback((data: string) => {
    try {
      const event: CrawlerEvent = JSON.parse(data);
      
      // 연결 이벤트는 로그에 추가하지 않음
      if (event.type === 'connected') {
        onEvent?.(event);
        return;
      }

      const source = event.data?.source || event.data?.task_id || 'unknown';
      const level = (event.data?.level as LogLevel) || 'INFO';

      // 필터링 적용
      if (filterSources.length > 0 && !filterSources.includes(source)) {
        return;
      }
      if (filterLevels.length > 0 && !filterLevels.includes(level)) {
        return;
      }

      // 소스 상태 업데이트
      if (event.type === 'collection_start' || event.type === 'agent_start') {
        setActiveSources(prev => {
          if (!prev.includes(source)) return [...prev, source];
          return prev;
        });
        setSourceStatus(prev => ({ ...prev, [source]: 'running' }));
      } else if (event.type === 'collection_complete' || event.type === 'agent_complete') {
        setSourceStatus(prev => ({ ...prev, [source]: 'complete' }));
      } else if (event.type === 'collection_error' || event.type === 'agent_error') {
        setSourceStatus(prev => ({ ...prev, [source]: 'error' }));
      }

      const logEntry: CrawlerLogEntry = {
        id: event.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        eventType: event.type,
        source,
        message: event.data?.message || '',
        level,
        timestamp: new Date(event.timestamp),
        data: event.data,
      };

      setLogs((prev) => {
        const newLogs = [logEntry, ...prev];
        return newLogs.slice(0, maxLogs);
      });

      onEvent?.(event);
    } catch (e) {
      console.error('Failed to parse crawler event:', e);
    }
  }, [maxLogs, filterSources, filterLevels, onEvent]);

  // autonomous-crawler 서비스의 SSE 엔드포인트
  // API Gateway를 통해 라우팅됨
  const { status, retryCount, reconnect } = useEventSource(
    enabled ? '/api/v1/crawler/events' : null,
    {
      onMessage: handleMessage,
      reconnectInterval: 5000,
      maxRetries: 10,
      enabled,
    }
  );

  const clearLogs = useCallback(() => {
    setLogs([]);
    setActiveSources([]);
    setSourceStatus({});
  }, []);

  return {
    logs,
    status,
    retryCount,
    reconnect,
    clearLogs,
    activeSources,
    sourceStatus,
  };
}

export default useCrawlerLogs;
