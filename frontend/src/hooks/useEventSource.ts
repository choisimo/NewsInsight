import { useEffect, useRef, useCallback, useState } from 'react';
import { PERSISTENCE_KEYS } from '@/lib/persistence';

// Storage key for access token (matches AuthContext)
const ACCESS_TOKEN_KEY = 'access_token';

/**
 * Append authentication token to URL for SSE connections.
 * EventSource doesn't support custom headers, so we use query parameter.
 */
function appendTokenToUrl(url: string, lastEventId?: string): string {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  const params = new URLSearchParams();
  
  if (token) {
    params.set('token', token);
  }
  
  // SSE Last-Event-ID를 쿼리 파라미터로 전달 (재연결 시 놓친 이벤트 복구)
  if (lastEventId) {
    params.set('lastEventId', lastEventId);
  }
  
  const queryString = params.toString();
  if (!queryString) return url;
  
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${queryString}`;
}

export interface UseEventSourceOptions {
  /** SSE 메시지 수신 시 콜백 */
  onMessage: (data: string, event?: MessageEvent) => void;
  /** 에러 발생 시 콜백 */
  onError?: (error: Event) => void;
  /** 연결 성공 시 콜백 */
  onOpen?: () => void;
  /** 재연결 간격 (ms), 기본값: 3000 */
  reconnectInterval?: number;
  /** 최대 재연결 시도 횟수, 기본값: 5 */
  maxRetries?: number;
  /** 연결 활성화 여부, 기본값: true */
  enabled?: boolean;
  /** 재연결 시 Last-Event-ID 사용 여부, 기본값: true */
  persistLastEventId?: boolean;
  /** 스토리지 키 접두사 (여러 SSE 스트림 구분용) */
  storageKeyPrefix?: string;
}

export interface UseEventSourceReturn {
  /** 현재 연결 상태 */
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  /** 재연결 시도 횟수 */
  retryCount: number;
  /** 마지막 수신한 이벤트 ID */
  lastEventId: string | null;
  /** 수동 연결 해제 */
  disconnect: () => void;
  /** 수동 재연결 */
  reconnect: () => void;
}

/**
 * SSE(Server-Sent Events) 연결을 관리하는 커스텀 훅
 * 
 * @param url SSE 엔드포인트 URL (null이면 비활성화)
 * @param options 옵션
 * @returns 연결 상태 및 제어 함수
 * 
 * @example
 * ```tsx
 * const { status } = useEventSource('/api/v1/events/stream', {
 *   onMessage: (data) => {
 *     const event = JSON.parse(data);
 *     console.log('Received:', event);
 *   },
 *   onError: () => toast.error('연결 끊김'),
 * });
 * ```
 */
export function useEventSource(
  url: string | null,
  options: UseEventSourceOptions
): UseEventSourceReturn {
  const {
    onMessage,
    onError,
    onOpen,
    reconnectInterval = 3000,
    maxRetries = 5,
    enabled = true,
    persistLastEventId = true,
    storageKeyPrefix = 'default',
  } = options;

  const [status, setStatus] = useState<UseEventSourceReturn['status']>('disconnected');
  const [retryCount, setRetryCount] = useState(0);
  const [lastEventId, setLastEventId] = useState<string | null>(() => {
    if (!persistLastEventId) return null;
    try {
      return sessionStorage.getItem(`${PERSISTENCE_KEYS.SSE_LAST_EVENT_ID}_${storageKeyPrefix}`);
    } catch {
      return null;
    }
  });

  const sourceRef = useRef<EventSource | null>(null);
  const retriesRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const lastEventIdRef = useRef(lastEventId);

  // 콜백 refs로 최신 값 유지
  const onMessageRef = useRef(onMessage);
  const onErrorRef = useRef(onError);
  const onOpenRef = useRef(onOpen);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onErrorRef.current = onError;
    onOpenRef.current = onOpen;
  }, [onMessage, onError, onOpen]);

  // lastEventId 변경 시 저장
  useEffect(() => {
    lastEventIdRef.current = lastEventId;
    if (persistLastEventId && lastEventId) {
      try {
        sessionStorage.setItem(`${PERSISTENCE_KEYS.SSE_LAST_EVENT_ID}_${storageKeyPrefix}`, lastEventId);
      } catch {
        // sessionStorage 사용 불가
      }
    }
  }, [lastEventId, persistLastEventId, storageKeyPrefix]);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    clearReconnectTimeout();
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
    if (mountedRef.current) {
      setStatus('disconnected');
    }
  }, [clearReconnectTimeout]);

  const connect = useCallback(() => {
    if (!url || !enabled) {
      disconnect();
      return;
    }

    // 기존 연결 정리
    if (sourceRef.current) {
      sourceRef.current.close();
    }
    clearReconnectTimeout();

    if (mountedRef.current) {
      setStatus('connecting');
    }

    // Append auth token and lastEventId to URL for SSE authentication and reconnection
    const authenticatedUrl = appendTokenToUrl(url, lastEventIdRef.current || undefined);
    const eventSource = new EventSource(authenticatedUrl);
    sourceRef.current = eventSource;

    eventSource.onopen = () => {
      if (mountedRef.current) {
        setStatus('connected');
        setRetryCount(0);
        retriesRef.current = 0;
      }
      onOpenRef.current?.();
    };

    eventSource.onmessage = (event) => {
      // SSE 이벤트 ID 저장 (재연결 시 복구용)
      if (event.lastEventId) {
        setLastEventId(event.lastEventId);
      }
      onMessageRef.current(event.data, event);
    };

    eventSource.onerror = (error) => {
      eventSource.close();
      sourceRef.current = null;

      if (mountedRef.current) {
        setStatus('error');
      }
      onErrorRef.current?.(error);

      // 자동 재연결
      if (retriesRef.current < maxRetries && mountedRef.current) {
        retriesRef.current++;
        if (mountedRef.current) {
          setRetryCount(retriesRef.current);
        }

        reconnectTimeoutRef.current = setTimeout(() => {
          if (mountedRef.current) {
            connect();
          }
        }, reconnectInterval);
      }
    };
  }, [url, enabled, maxRetries, reconnectInterval, disconnect, clearReconnectTimeout]);

  const reconnect = useCallback(() => {
    retriesRef.current = 0;
    setRetryCount(0);
    connect();
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    status,
    retryCount,
    lastEventId,
    disconnect,
    reconnect,
  };
}

export default useEventSource;
