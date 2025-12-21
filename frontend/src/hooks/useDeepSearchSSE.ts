import { useEffect, useRef, useCallback, useState } from 'react';
import { useBackgroundTasks } from '@/contexts/BackgroundTaskContext';
import type { DeepSearchJob, DeepSearchResult, Evidence } from '@/lib/api';

// ============================================
// Types
// ============================================

export interface DeepSearchSSEEvent {
  eventType: 'status' | 'progress' | 'evidence' | 'complete' | 'error' | 'heartbeat';
  jobId: string;
  status?: DeepSearchJob['status'];
  progress?: number;
  progressMessage?: string;
  evidence?: Evidence;
  evidenceCount?: number;
  result?: DeepSearchResult;
  error?: string;
}

export interface UseDeepSearchSSEOptions {
  jobId: string | null;
  topic?: string;
  onStatusUpdate?: (status: DeepSearchJob['status']) => void;
  onProgress?: (progress: number, message?: string) => void;
  onEvidence?: (evidence: Evidence, count: number) => void;
  onComplete?: (result: DeepSearchResult) => void;
  onError?: (error: string) => void;
  autoAddToBackground?: boolean;
  enabled?: boolean;
}

export interface UseDeepSearchSSEReturn {
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  currentStatus?: DeepSearchJob['status'];
  progress: number;
  progressMessage?: string;
  evidenceCount: number;
  result?: DeepSearchResult;
  error?: string;
  disconnect: () => void;
  reconnect: () => void;
}

// ============================================
// Constants
// ============================================

const RECONNECT_INTERVAL = 3000;
const MAX_RETRIES = 5;
const HEARTBEAT_TIMEOUT = 35000; // 35 seconds (server sends every 30s)

// ============================================
// Helper Functions
// ============================================

const resolveBaseUrl = (): string => {
  // 개발 환경: Vite proxy 사용 (상대 경로)
  if (import.meta.env.DEV) {
    return '';
  }

  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL as string;
  }

  // 프로덕션: 현재 호스트 사용
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  return '';
};

// ============================================
// Hook
// ============================================

export function useDeepSearchSSE(options: UseDeepSearchSSEOptions): UseDeepSearchSSEReturn {
  const {
    jobId,
    topic,
    onStatusUpdate,
    onProgress,
    onEvidence,
    onComplete,
    onError,
    autoAddToBackground = true,
    enabled = true,
  } = options;

  const { addTask, updateTask, getTask } = useBackgroundTasks();

  const [connectionStatus, setConnectionStatus] = useState<UseDeepSearchSSEReturn['status']>('disconnected');
  const [currentStatus, setCurrentStatus] = useState<DeepSearchJob['status']>();
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState<string>();
  const [evidenceCount, setEvidenceCount] = useState(0);
  const [result, setResult] = useState<DeepSearchResult>();
  const [error, setError] = useState<string>();

  const eventSourceRef = useRef<EventSource | null>(null);
  const retriesRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Refs for callbacks to avoid reconnection on callback changes
  const onStatusUpdateRef = useRef(onStatusUpdate);
  const onProgressRef = useRef(onProgress);
  const onEvidenceRef = useRef(onEvidence);
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onStatusUpdateRef.current = onStatusUpdate;
    onProgressRef.current = onProgress;
    onEvidenceRef.current = onEvidence;
    onCompleteRef.current = onComplete;
    onErrorRef.current = onError;
  }, [onStatusUpdate, onProgress, onEvidence, onComplete, onError]);

  const clearTimeouts = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = null;
    }
  }, []);

  const resetHeartbeatTimeout = useCallback(() => {
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
    }
    heartbeatTimeoutRef.current = setTimeout(() => {
      // Connection seems dead, try to reconnect
      if (eventSourceRef.current && mountedRef.current) {
        console.warn('[DeepSearchSSE] Heartbeat timeout, reconnecting...');
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        setConnectionStatus('error');
        scheduleReconnect();
      }
    }, HEARTBEAT_TIMEOUT);
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (retriesRef.current < MAX_RETRIES && mountedRef.current) {
      retriesRef.current++;
      reconnectTimeoutRef.current = setTimeout(() => {
        if (mountedRef.current) {
          connect();
        }
      }, RECONNECT_INTERVAL);
    }
  }, []);

  const disconnect = useCallback(() => {
    clearTimeouts();
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (mountedRef.current) {
      setConnectionStatus('disconnected');
    }
  }, [clearTimeouts]);

  const connect = useCallback(() => {
    if (!jobId || !enabled) {
      disconnect();
      return;
    }

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    clearTimeouts();

    if (mountedRef.current) {
      setConnectionStatus('connecting');
    }

    // Add task to background if enabled
    if (autoAddToBackground && topic) {
      const existingTask = getTask(jobId);
      if (!existingTask) {
        addTask({
          id: jobId,
          type: 'deep-search',
          title: topic,
          status: 'pending',
          progress: 0,
          resultUrl: `/search?mode=deep&jobId=${jobId}`,
        });
      }
    }

    const baseUrl = resolveBaseUrl();
    const url = `${baseUrl}/api/v1/analysis/deep/${jobId}/stream`;
    
    console.log('[DeepSearchSSE] Connecting to:', url);
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    // Helper function to handle SSE event data
    const handleEventData = (eventType: string, data: Record<string, unknown>) => {
      if (!mountedRef.current) return;
      
      resetHeartbeatTimeout();
      console.log('[DeepSearchSSE] Event:', eventType, data);

      switch (eventType) {
        case 'heartbeat':
          // Just a keep-alive, no action needed
          break;

        case 'status':
          if (data.status) {
            const status = data.status as DeepSearchJob['status'];
            setCurrentStatus(status);
            onStatusUpdateRef.current?.(status);
            
            // Update background task
            const taskStatus = status === 'PENDING' ? 'pending' 
              : status === 'IN_PROGRESS' ? 'running'
              : status === 'COMPLETED' ? 'completed'
              : status === 'FAILED' || status === 'TIMEOUT' ? 'failed'
              : status === 'CANCELLED' ? 'cancelled'
              : 'pending';
            
            updateTask(jobId, { 
              status: taskStatus,
              ...(status === 'COMPLETED' && { completedAt: new Date().toISOString() }),
            });
          }
          break;

        case 'progress':
          if (data.progress !== undefined) {
            const progressValue = data.progress as number;
            const progressMsg = data.progressMessage as string | undefined;
            setProgress(progressValue);
            setProgressMessage(progressMsg);
            onProgressRef.current?.(progressValue, progressMsg);
            
            updateTask(jobId, { 
              progress: progressValue, 
              progressMessage: progressMsg,
              status: 'running',
            });
          }
          break;

        case 'evidence':
          if (data.evidence && data.evidenceCount !== undefined) {
            const evidence = data.evidence as Evidence;
            const count = data.evidenceCount as number;
            setEvidenceCount(count);
            onEvidenceRef.current?.(evidence, count);
            
            updateTask(jobId, { evidenceCount: count });
          }
          break;

        case 'complete':
          if (data.result) {
            const result = data.result as DeepSearchResult;
            setResult(result);
            setCurrentStatus('COMPLETED');
            setProgress(100);
            onCompleteRef.current?.(result);
            
            updateTask(jobId, { 
              status: 'completed', 
              progress: 100,
              result: result,
              completedAt: new Date().toISOString(),
              evidenceCount: result.evidence?.length,
            });

            // Close connection after completion
            disconnect();
          }
          break;

        case 'error':
          if (data.error) {
            const errorMsg = data.error as string;
            setError(errorMsg);
            setCurrentStatus('FAILED');
            onErrorRef.current?.(errorMsg);
            
            updateTask(jobId, { 
              status: 'failed', 
              error: errorMsg,
              completedAt: new Date().toISOString(),
            });

            // Close connection after error
            disconnect();
          }
          break;
      }
    };

    eventSource.onopen = () => {
      if (mountedRef.current) {
        console.log('[DeepSearchSSE] Connected');
        setConnectionStatus('connected');
        retriesRef.current = 0;
        resetHeartbeatTimeout();
      }
    };

    // Register named event listeners for SSE event types
    // This handles SSE events where the event type is in the `event:` field
    const eventTypes = ['heartbeat', 'status', 'progress', 'evidence', 'complete', 'error'];
    eventTypes.forEach(eventType => {
      eventSource.addEventListener(eventType, (event: MessageEvent) => {
        if (!mountedRef.current) return;
        try {
          const data = JSON.parse(event.data) as Record<string, unknown>;
          handleEventData(eventType, data);
        } catch (e) {
          console.error('[DeepSearchSSE] Failed to parse event:', e, event.data);
        }
      });
    });

    // Fallback: handle generic message events (for backward compatibility)
    // This handles cases where eventType is in the data payload
    eventSource.onmessage = (event) => {
      if (!mountedRef.current) return;
      
      resetHeartbeatTimeout();

      try {
        const data = JSON.parse(event.data) as DeepSearchSSEEvent;
        // Only process if eventType is in data (fallback path)
        if (data.eventType) {
          handleEventData(data.eventType, data as unknown as Record<string, unknown>);
        }
      } catch (e) {
        console.error('[DeepSearchSSE] Failed to parse event:', e, event.data);
      }
    };

    eventSource.onerror = (e) => {
      console.error('[DeepSearchSSE] Connection error:', e);
      eventSource.close();
      eventSourceRef.current = null;

      if (mountedRef.current) {
        // Check if it's a terminal state - don't reconnect if job is done
        const terminalStatuses = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT'];
        if (currentStatus && terminalStatuses.includes(currentStatus)) {
          setConnectionStatus('disconnected');
          return;
        }

        setConnectionStatus('error');
        scheduleReconnect();
      }
    };
  }, [jobId, enabled, topic, autoAddToBackground, getTask, addTask, updateTask, disconnect, clearTimeouts, resetHeartbeatTimeout, scheduleReconnect, currentStatus]);

  const reconnect = useCallback(() => {
    retriesRef.current = 0;
    connect();
  }, [connect]);

  // Connect when jobId changes
  useEffect(() => {
    mountedRef.current = true;
    if (jobId && enabled) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      disconnect();
    };
  }, [jobId, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    status: connectionStatus,
    currentStatus,
    progress,
    progressMessage,
    evidenceCount,
    result,
    error,
    disconnect,
    reconnect,
  };
}

export default useDeepSearchSSE;
