import { useEffect, useRef, useCallback, useState } from 'react';

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
}

export interface UseEventSourceReturn {
  /** 현재 연결 상태 */
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  /** 재연결 시도 횟수 */
  retryCount: number;
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
  } = options;

  const [status, setStatus] = useState<UseEventSourceReturn['status']>('disconnected');
  const [retryCount, setRetryCount] = useState(0);

  const sourceRef = useRef<EventSource | null>(null);
  const retriesRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // 콜백 refs로 최신 값 유지
  const onMessageRef = useRef(onMessage);
  const onErrorRef = useRef(onError);
  const onOpenRef = useRef(onOpen);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onErrorRef.current = onError;
    onOpenRef.current = onOpen;
  }, [onMessage, onError, onOpen]);

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

    const eventSource = new EventSource(url);
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
    disconnect,
    reconnect,
  };
}

export default useEventSource;
