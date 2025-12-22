import { useState, useEffect, useRef, useCallback } from 'react';
import { getApiClient } from '@/lib/api';

interface ChatEvent {
  type: string;
  role: string;
  content: string;
  phase?: string;
  timestamp?: number;
  evidence?: any[];
  verificationResult?: any;
  credibility?: any;
}

interface UseFactCheckChatOptions {
  onMessage?: (event: ChatEvent) => void;
  onError?: (error: string) => void;
  onComplete?: () => void;
}

interface UseFactCheckChatReturn {
  sendMessage: (message: string, claims?: string[]) => Promise<void>;
  isConnected: boolean;
  isStreaming: boolean;
  sessionId: string | null;
  disconnect: () => void;
  reconnect: () => void;
}

/**
 * Resolve the base URL for API calls
 * In development, uses empty string (Vite proxy)
 * In production, uses environment variable or current origin
 */
const resolveBaseUrl = (): string => {
  if (import.meta.env.DEV) {
    return '';
  }
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL as string;
  }
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return '';
};

export const useFactCheckChat = (options: UseFactCheckChatOptions): UseFactCheckChatReturn => {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const optionsRef = useRef(options);
  const mountedRef = useRef(true);
  const sessionIdRef = useRef<string | null>(null);

  // 옵션 업데이트
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // 세션 생성 함수
  const createSession = useCallback(async () => {
    try {
      const client = await getApiClient();
      const response = await client.post('/api/v1/factcheck-chat/session', { message: 'init' });

      if (mountedRef.current) {
        const newSessionId = response.data.sessionId;
        setSessionId(newSessionId);
        sessionIdRef.current = newSessionId;
        setIsConnected(true);
        console.log('[FactCheckChat] Session created:', newSessionId);
      }
    } catch (error) {
      console.error('Failed to create fact-check chat session:', error);
      if (mountedRef.current) {
        optionsRef.current.onError?.('세션 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
    }
  }, []);

  // 세션 재연결
  const reconnect = useCallback(() => {
    setIsConnected(false);
    setSessionId(null);
    sessionIdRef.current = null;
    createSession();
  }, [createSession]);

  // 초기 세션 생성
  useEffect(() => {
    mountedRef.current = true;
    createSession();

    // 컴포넌트 언마운트 시 세션 종료
    return () => {
      mountedRef.current = false;
      const currentSessionId = sessionIdRef.current;
      if (currentSessionId) {
        const baseUrl = resolveBaseUrl();
        fetch(`${baseUrl}/api/v1/factcheck-chat/session/${currentSessionId}`, {
          method: 'DELETE',
        }).catch(console.error);
      }
    };
  }, [createSession]);

  // SSE 연결 해제
  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  // 메시지 전송
  const sendMessage = useCallback(async (message: string, claims?: string[]) => {
    if (!sessionId) {
      optionsRef.current.onError?.('세션이 준비되지 않았습니다.');
      return;
    }

    if (isStreaming) {
      optionsRef.current.onError?.('이전 메시지를 처리 중입니다.');
      return;
    }

    setIsStreaming(true);

    try {
      // 기존 연결 종료
      disconnect();

      // SSE 연결 생성
      const baseUrl = resolveBaseUrl();
      const url = `${baseUrl}/api/v1/factcheck-chat/session/${sessionId}/message`;
      
      // POST 요청으로 메시지 전송 및 SSE 스트림 수신
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          message,
          claims: claims || [],
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // SSE 스트림 읽기
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('Response body is null');
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          setIsStreaming(false);
          optionsRef.current.onComplete?.();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        
        // SSE 이벤트 파싱
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          // Handle both 'data: ' and 'data:' formats (with or without space)
          if (line.startsWith('data:')) {
            const data = line.startsWith('data: ') ? line.slice(6) : line.slice(5);
            
            if (data === '[DONE]') {
              setIsStreaming(false);
              optionsRef.current.onComplete?.();
              continue;
            }

            try {
              const event = JSON.parse(data);
              
              if (event.type === 'done') {
                setIsStreaming(false);
                optionsRef.current.onComplete?.();
              } else if (event.type === 'error') {
                optionsRef.current.onError?.(event.error || 'Unknown error');
              } else {
                optionsRef.current.onMessage?.(event);
              }
            } catch (e) {
              console.error('Failed to parse SSE event:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      optionsRef.current.onError?.('메시지 전송에 실패했습니다.');
      setIsStreaming(false);
    }
  }, [sessionId, isStreaming, disconnect]);

  return {
    sendMessage,
    isConnected,
    isStreaming,
    sessionId,
    disconnect,
    reconnect,
  };
};
