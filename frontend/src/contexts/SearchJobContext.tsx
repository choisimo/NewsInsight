import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef } from 'react';
import { toast } from '@/hooks/use-toast';
import {
  startSearchJob,
  startSearchJobsBatch,
  getSearchJobStatus,
  getActiveSearchJobs,
  getAllSearchJobs,
  cancelSearchJob,
  openAllJobsStream,
  type SearchJob,
  type SearchJobEvent,
  type SearchJobType,
  type SearchJobStatus,
  type StartSearchJobRequest,
} from '@/lib/api';
import { 
  persistState, 
  loadPersistedState, 
  PERSISTENCE_KEYS, 
  EXPIRY_TIMES 
} from '@/lib/persistence';

// ============================================
// Types
// ============================================

interface SearchJobState {
  jobs: SearchJob[];
  isLoaded: boolean;
  isConnected: boolean;
  connectionError: string | null;
}

type SearchJobAction =
  | { type: 'LOAD_JOBS'; jobs: SearchJob[] }
  | { type: 'ADD_JOB'; job: SearchJob }
  | { type: 'UPDATE_JOB'; jobId: string; updates: Partial<SearchJob> }
  | { type: 'REMOVE_JOB'; jobId: string }
  | { type: 'SET_CONNECTED'; connected: boolean; error?: string }
  | { type: 'CLEAR_COMPLETED' };

// ============================================
// Constants
// ============================================

const MAX_JOBS_TO_KEEP = 50;
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;
const PERSISTENCE_VERSION = 1;

// Persistence options for search jobs
const persistenceOptions = {
  key: PERSISTENCE_KEYS.SEARCH_JOBS,
  storage: 'local' as const,
  expiry: EXPIRY_TIMES.ONE_DAY,
  version: PERSISTENCE_VERSION,
  validate: (jobs: SearchJob[]) => Array.isArray(jobs),
};

// Job type labels (Korean)
export const JOB_TYPE_LABELS: Record<SearchJobType, string> = {
  UNIFIED: '통합 검색',
  DEEP_SEARCH: '심층 분석',
  FACT_CHECK: '팩트체크',
  BROWSER_AGENT: 'AI 에이전트',
};

// Job status labels (Korean)
export const JOB_STATUS_LABELS: Record<SearchJobStatus, string> = {
  PENDING: '대기 중',
  RUNNING: '진행 중',
  COMPLETED: '완료',
  FAILED: '실패',
  CANCELLED: '취소됨',
};

// ============================================
// Reducer
// ============================================

function jobReducer(state: SearchJobState, action: SearchJobAction): SearchJobState {
  switch (action.type) {
    case 'LOAD_JOBS':
      return { ...state, jobs: action.jobs, isLoaded: true };

    case 'ADD_JOB': {
      // Prevent duplicates
      if (state.jobs.some(j => j.jobId === action.job.jobId)) {
        return state;
      }
      // Add new job at the beginning, limit total jobs
      const newJobs = [action.job, ...state.jobs].slice(0, MAX_JOBS_TO_KEEP);
      return { ...state, jobs: newJobs };
    }

    case 'UPDATE_JOB':
      return {
        ...state,
        jobs: state.jobs.map(j =>
          j.jobId === action.jobId ? { ...j, ...action.updates } : j
        ),
      };

    case 'REMOVE_JOB':
      return {
        ...state,
        jobs: state.jobs.filter(j => j.jobId !== action.jobId),
      };

    case 'SET_CONNECTED':
      return {
        ...state,
        isConnected: action.connected,
        connectionError: action.error || null,
      };

    case 'CLEAR_COMPLETED':
      return {
        ...state,
        jobs: state.jobs.filter(j => 
          j.status !== 'COMPLETED' && j.status !== 'FAILED' && j.status !== 'CANCELLED'
        ),
      };

    default:
      return state;
  }
}

// ============================================
// Context
// ============================================

interface SearchJobContextValue {
  // State
  jobs: SearchJob[];
  activeJobs: SearchJob[];
  completedJobs: SearchJob[];
  isLoaded: boolean;
  isConnected: boolean;
  connectionError: string | null;
  
  // Computed
  hasActiveJobs: boolean;
  activeJobCount: number;
  
  // Actions
  startJob: (request: StartSearchJobRequest) => Promise<string | null>;
  startJobsBatch: (requests: StartSearchJobRequest[]) => Promise<string[]>;
  cancelJob: (jobId: string) => Promise<boolean>;
  refreshJobs: () => Promise<void>;
  getJob: (jobId: string) => SearchJob | undefined;
  clearCompletedJobs: () => void;
}

const SearchJobContext = createContext<SearchJobContextValue | null>(null);

// ============================================
// Provider Component
// ============================================

interface SearchJobProviderProps {
  children: React.ReactNode;
  userId?: string;
  autoConnect?: boolean;
}

export function SearchJobProvider({ 
  children, 
  userId = 'anonymous',
  autoConnect = true,
}: SearchJobProviderProps) {
  // Load persisted state on initialization
  const getInitialState = (): SearchJobState => {
    const persisted = loadPersistedState<SearchJob[]>(persistenceOptions);
    return {
      jobs: persisted || [],
      isLoaded: persisted !== null, // Mark as loaded if we have persisted data
      isConnected: false,
      connectionError: null,
    };
  };

  const [state, dispatch] = useReducer(jobReducer, undefined, getInitialState);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const userIdRef = useRef(userId);

  // Persist jobs to storage whenever they change
  useEffect(() => {
    if (state.isLoaded && state.jobs.length > 0) {
      persistState(state.jobs, persistenceOptions);
    }
  }, [state.jobs, state.isLoaded]);

  // Keep userId ref updated
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  // Handle SSE events
  const handleJobEvent = useCallback((event: SearchJobEvent) => {
    const { jobId, eventType, status, progress, currentPhase, message } = event;

    switch (eventType) {
      case 'started':
        // Job started - may already be in state from startJob call
        dispatch({
          type: 'UPDATE_JOB',
          jobId,
          updates: { status, progress, currentPhase },
        });
        break;

      case 'progress':
        dispatch({
          type: 'UPDATE_JOB',
          jobId,
          updates: { status, progress, currentPhase },
        });
        break;

      case 'completed': {
        dispatch({
          type: 'UPDATE_JOB',
          jobId,
          updates: {
            status: 'COMPLETED',
            progress: 100,
            completedAt: new Date().toISOString(),
          },
        });
        // Note: Toast notification will be shown by the status change detector
        break;
      }

      case 'failed': {
        dispatch({
          type: 'UPDATE_JOB',
          jobId,
          updates: {
            status: 'FAILED',
            errorMessage: message,
            completedAt: new Date().toISOString(),
          },
        });
        // Note: Toast notification will be shown by the status change detector
        break;
      }

      case 'cancelled': {
        dispatch({
          type: 'UPDATE_JOB',
          jobId,
          updates: {
            status: 'CANCELLED',
            completedAt: new Date().toISOString(),
          },
        });
        // Note: Toast notification will be shown by the status change detector
        break;
      }

      case 'heartbeat':
        // Just keep connection alive
        break;
    }
  }, [state.jobs]);

  // Connect to SSE stream
  const connect = useCallback(async () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      const eventSource = await openAllJobsStream(userIdRef.current);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        console.log('[SearchJob SSE] Connected');
        dispatch({ type: 'SET_CONNECTED', connected: true });
        reconnectAttempts.current = 0;
      };

      // Listen for job events
      eventSource.addEventListener('job_started', (e) => {
        try {
          const data = JSON.parse(e.data) as SearchJobEvent;
          handleJobEvent(data);
        } catch (err) {
          console.error('[SearchJob SSE] Failed to parse job_started:', err);
        }
      });

      eventSource.addEventListener('job_progress', (e) => {
        try {
          const data = JSON.parse(e.data) as SearchJobEvent;
          handleJobEvent(data);
        } catch (err) {
          console.error('[SearchJob SSE] Failed to parse job_progress:', err);
        }
      });

      eventSource.addEventListener('job_completed', (e) => {
        try {
          const data = JSON.parse(e.data) as SearchJobEvent;
          handleJobEvent({ ...data, eventType: 'completed' });
        } catch (err) {
          console.error('[SearchJob SSE] Failed to parse job_completed:', err);
        }
      });

      eventSource.addEventListener('job_failed', (e) => {
        try {
          const data = JSON.parse(e.data) as SearchJobEvent;
          handleJobEvent({ ...data, eventType: 'failed' });
        } catch (err) {
          console.error('[SearchJob SSE] Failed to parse job_failed:', err);
        }
      });

      eventSource.addEventListener('job_cancelled', (e) => {
        try {
          const data = JSON.parse(e.data) as SearchJobEvent;
          handleJobEvent({ ...data, eventType: 'cancelled' });
        } catch (err) {
          console.error('[SearchJob SSE] Failed to parse job_cancelled:', err);
        }
      });

      eventSource.addEventListener('heartbeat', () => {
        // Connection alive
      });

      eventSource.onerror = (err) => {
        console.error('[SearchJob SSE] Error:', err);
        
        // Close the failed connection
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
        
        dispatch({ type: 'SET_CONNECTED', connected: false });

        // Attempt reconnection with exponential backoff
        if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(
            RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts.current),
            30000
          );
          console.log(`[SearchJob SSE] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current + 1})`);

          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttempts.current++;
            connect();
          }, delay);
        } else {
          console.error('[SearchJob SSE] Max reconnection attempts reached. Stopping reconnection.');
          dispatch({
            type: 'SET_CONNECTED',
            connected: false,
            error: '실시간 연결에 실패했습니다. 새로고침해 주세요.',
          });
        }
      };
    } catch (err) {
      console.error('[SearchJob SSE] Failed to connect:', err);
      dispatch({
        type: 'SET_CONNECTED',
        connected: false,
        error: err instanceof Error ? err.message : '연결 실패',
      });
    }
  }, [handleJobEvent]);

  // Disconnect from SSE stream
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    dispatch({ type: 'SET_CONNECTED', connected: false });
  }, []);

  // Load initial jobs
  const loadJobs = useCallback(async () => {
    try {
      const jobs = await getAllSearchJobs(userIdRef.current, MAX_JOBS_TO_KEEP);
      dispatch({ type: 'LOAD_JOBS', jobs });
      return jobs;
    } catch (err) {
      console.error('[SearchJob] Failed to load jobs:', err);
      dispatch({ type: 'LOAD_JOBS', jobs: [] });
      return [];
    }
  }, []);

  // Track previous job states to detect completions when returning to page
  const prevJobStatesRef = useRef<Map<string, SearchJobStatus>>(new Map());

  // Detect newly completed jobs (for background completion notifications)
  useEffect(() => {
    const currentStates = new Map(state.jobs.map(j => [j.jobId, j.status]));
    
    state.jobs.forEach(job => {
      const prevStatus = prevJobStatesRef.current.get(job.jobId);
      const isNewlyCompleted = prevStatus && 
        (prevStatus === 'PENDING' || prevStatus === 'RUNNING') &&
        (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED');
      
      if (isNewlyCompleted) {
        console.log(`[SearchJob] Detected background completion: ${job.jobId} (${prevStatus} -> ${job.status})`);
        
        // Show notification for background completion
        if (job.status === 'COMPLETED') {
          toast({
            title: `✅ ${JOB_TYPE_LABELS[job.type]} 완료`,
            description: `"${job.query}" 작업이 완료되었습니다. 결과를 확인하세요.`,
            duration: 8000,
          });
        } else if (job.status === 'FAILED') {
          toast({
            title: `❌ ${JOB_TYPE_LABELS[job.type]} 실패`,
            description: job.errorMessage || `"${job.query}" 작업 중 오류가 발생했습니다.`,
            variant: 'destructive',
            duration: 10000,
          });
        } else if (job.status === 'CANCELLED') {
          toast({
            title: `⚠️ ${JOB_TYPE_LABELS[job.type]} 취소됨`,
            description: `"${job.query}" 작업이 취소되었습니다.`,
            duration: 5000,
          });
        }
      }
    });
    
    prevJobStatesRef.current = currentStates;
  }, [state.jobs]);

  // Initialize on mount
  useEffect(() => {
    const initializeJobs = async () => {
      const jobs = await loadJobs();
      
      // Store initial job states (don't show notifications for already completed jobs on mount)
      prevJobStatesRef.current = new Map(jobs.map(j => [j.jobId, j.status]));
    };
    
    initializeJobs();

    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect]); // Only run on mount and when autoConnect changes

  // Refresh jobs when page becomes visible (user returns to tab)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[SearchJob] Page visible, refreshing jobs...');
        loadJobs();
        
        // Reconnect SSE if disconnected
        if (autoConnect && !state.isConnected) {
          console.log('[SearchJob] Reconnecting SSE...');
          connect();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect, state.isConnected]);

  // Derived state
  const activeJobs = state.jobs.filter(
    j => j.status === 'PENDING' || j.status === 'RUNNING'
  );

  const completedJobs = state.jobs.filter(
    j => j.status === 'COMPLETED' || j.status === 'FAILED' || j.status === 'CANCELLED'
  );

  // Actions
  const startJob = useCallback(async (request: StartSearchJobRequest): Promise<string | null> => {
    try {
      const response = await startSearchJob({
        ...request,
        userId: userIdRef.current,
      });

      // Optimistically add job to state
      const newJob: SearchJob = {
        jobId: response.jobId,
        type: request.type,
        query: request.query,
        timeWindow: request.timeWindow,
        userId: userIdRef.current,
        sessionId: request.sessionId,
        projectId: request.projectId,
        status: 'PENDING',
        progress: 0,
        startedAt: new Date().toISOString(),
      };

      dispatch({ type: 'ADD_JOB', job: newJob });

      toast({
        title: `${JOB_TYPE_LABELS[request.type]} 시작`,
        description: `"${request.query}" 작업을 시작했습니다.`,
        duration: 3000,
      });

      return response.jobId;
    } catch (err) {
      console.error('[SearchJob] Failed to start job:', err);
      toast({
        title: '작업 시작 실패',
        description: err instanceof Error ? err.message : '작업을 시작할 수 없습니다.',
        variant: 'destructive',
      });
      return null;
    }
  }, []);

  const startJobsBatch = useCallback(async (requests: StartSearchJobRequest[]): Promise<string[]> => {
    try {
      const enrichedRequests = requests.map(req => ({
        ...req,
        userId: userIdRef.current,
      }));

      const response = await startSearchJobsBatch(enrichedRequests);

      // Optimistically add jobs to state
      response.jobs.forEach((job, index) => {
        const request = requests[index];
        const newJob: SearchJob = {
          jobId: job.jobId,
          type: request.type,
          query: request.query,
          timeWindow: request.timeWindow,
          userId: userIdRef.current,
          sessionId: request.sessionId,
          projectId: request.projectId,
          status: 'PENDING',
          progress: 0,
          startedAt: new Date().toISOString(),
        };

        dispatch({ type: 'ADD_JOB', job: newJob });
      });

      toast({
        title: '일괄 작업 시작',
        description: `${response.count}개의 작업을 시작했습니다.`,
        duration: 3000,
      });

      return response.jobs.map(j => j.jobId);
    } catch (err) {
      console.error('[SearchJob] Failed to start batch jobs:', err);
      toast({
        title: '일괄 작업 시작 실패',
        description: err instanceof Error ? err.message : '작업을 시작할 수 없습니다.',
        variant: 'destructive',
      });
      return [];
    }
  }, []);

  const cancelJobAction = useCallback(async (jobId: string): Promise<boolean> => {
    try {
      await cancelSearchJob(jobId);

      dispatch({
        type: 'UPDATE_JOB',
        jobId,
        updates: {
          status: 'CANCELLED',
          completedAt: new Date().toISOString(),
        },
      });

      return true;
    } catch (err) {
      console.error('[SearchJob] Failed to cancel job:', err);
      toast({
        title: '작업 취소 실패',
        description: err instanceof Error ? err.message : '작업을 취소할 수 없습니다.',
        variant: 'destructive',
      });
      return false;
    }
  }, []);

  const refreshJobs = useCallback(async () => {
    await loadJobs();
  }, [loadJobs]);

  const getJob = useCallback(
    (jobId: string) => state.jobs.find(j => j.jobId === jobId),
    [state.jobs]
  );

  const clearCompletedJobs = useCallback(() => {
    dispatch({ type: 'CLEAR_COMPLETED' });
  }, []);

  const value: SearchJobContextValue = {
    jobs: state.jobs,
    activeJobs,
    completedJobs,
    isLoaded: state.isLoaded,
    isConnected: state.isConnected,
    connectionError: state.connectionError,
    hasActiveJobs: activeJobs.length > 0,
    activeJobCount: activeJobs.length,
    startJob,
    startJobsBatch,
    cancelJob: cancelJobAction,
    refreshJobs,
    getJob,
    clearCompletedJobs,
  };

  return (
    <SearchJobContext.Provider value={value}>
      {children}
    </SearchJobContext.Provider>
  );
}

// ============================================
// Hook
// ============================================

export function useSearchJobs(): SearchJobContextValue {
  const context = useContext(SearchJobContext);
  if (!context) {
    throw new Error('useSearchJobs must be used within a SearchJobProvider');
  }
  return context;
}

export default SearchJobContext;
