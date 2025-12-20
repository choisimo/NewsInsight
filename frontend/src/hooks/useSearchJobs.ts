/**
 * useSearchJobs - Hook for managing search jobs with the context
 * 
 * This hook provides additional functionality beyond the basic context:
 * - Job polling for specific jobs
 * - Job result retrieval
 * - Integration with search history
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchJobs as useSearchJobsContext, JOB_TYPE_LABELS, JOB_STATUS_LABELS } from '@/contexts/SearchJobContext';
import {
  getSearchJobStatus,
  openSearchJobStream,
  type SearchJob,
  type SearchJobEvent,
  type SearchJobType,
  type SearchJobStatus,
  type StartSearchJobRequest,
} from '@/lib/api';

// Re-export labels for convenience
export { JOB_TYPE_LABELS, JOB_STATUS_LABELS };

interface UseSearchJobsOptions {
  /**
   * Auto-poll interval in ms for active jobs (0 to disable)
   */
  pollInterval?: number;
  /**
   * Callback when a job completes
   */
  onJobCompleted?: (job: SearchJob) => void;
  /**
   * Callback when a job fails
   */
  onJobFailed?: (job: SearchJob) => void;
}

interface UseSearchJobsReturn {
  // From context
  jobs: SearchJob[];
  activeJobs: SearchJob[];
  completedJobs: SearchJob[];
  isLoaded: boolean;
  isConnected: boolean;
  connectionError: string | null;
  hasActiveJobs: boolean;
  activeJobCount: number;
  
  // Context actions
  startJob: (request: StartSearchJobRequest) => Promise<string | null>;
  startJobsBatch: (requests: StartSearchJobRequest[]) => Promise<string[]>;
  cancelJob: (jobId: string) => Promise<boolean>;
  refreshJobs: () => Promise<void>;
  getJob: (jobId: string) => SearchJob | undefined;
  clearCompletedJobs: () => void;
  
  // Extended functionality
  watchJob: (jobId: string, onUpdate: (job: SearchJob) => void) => () => void;
  getJobsByType: (type: SearchJobType) => SearchJob[];
  getJobsByStatus: (status: SearchJobStatus) => SearchJob[];
  getLatestJobByType: (type: SearchJobType) => SearchJob | undefined;
  
  // Utilities
  formatJobType: (type: SearchJobType) => string;
  formatJobStatus: (status: SearchJobStatus) => string;
  getJobProgress: (job: SearchJob) => { percent: number; label: string };
}

/**
 * Extended hook for managing search jobs
 */
export function useSearchJobsExtended(options: UseSearchJobsOptions = {}): UseSearchJobsReturn {
  const { pollInterval = 0, onJobCompleted, onJobFailed } = options;
  const context = useSearchJobsContext();
  const prevActiveJobsRef = useRef<string[]>([]);

  // Track job completions/failures
  useEffect(() => {
    const currentActiveIds = context.activeJobs.map(j => j.jobId);
    const prevActiveIds = prevActiveJobsRef.current;

    // Find jobs that are no longer active
    const completedIds = prevActiveIds.filter(id => !currentActiveIds.includes(id));

    for (const jobId of completedIds) {
      const job = context.getJob(jobId);
      if (job) {
        if (job.status === 'COMPLETED' && onJobCompleted) {
          onJobCompleted(job);
        } else if (job.status === 'FAILED' && onJobFailed) {
          onJobFailed(job);
        }
      }
    }

    prevActiveJobsRef.current = currentActiveIds;
  }, [context.activeJobs, context.getJob, onJobCompleted, onJobFailed]);

  // Polling for active jobs (backup when SSE is not available)
  useEffect(() => {
    if (pollInterval <= 0 || context.isConnected) return;

    const intervalId = setInterval(() => {
      context.refreshJobs();
    }, pollInterval);

    return () => clearInterval(intervalId);
  }, [pollInterval, context.isConnected, context.refreshJobs]);

  /**
   * Watch a specific job with SSE
   */
  const watchJob = useCallback((jobId: string, onUpdate: (job: SearchJob) => void): (() => void) => {
    let eventSource: EventSource | null = null;
    let pollIntervalId: ReturnType<typeof setInterval> | null = null;

    const startWatch = async () => {
      try {
        eventSource = await openSearchJobStream(jobId);

        const handleEvent = async (eventType: string) => {
          try {
            const job = await getSearchJobStatus(jobId);
            onUpdate(job);
          } catch (err) {
            console.error(`[watchJob] Failed to get job status after ${eventType}:`, err);
          }
        };

        eventSource.addEventListener('job_started', () => handleEvent('started'));
        eventSource.addEventListener('job_progress', () => handleEvent('progress'));
        eventSource.addEventListener('job_completed', () => handleEvent('completed'));
        eventSource.addEventListener('job_failed', () => handleEvent('failed'));
        eventSource.addEventListener('job_cancelled', () => handleEvent('cancelled'));

        eventSource.onerror = () => {
          console.warn('[watchJob] SSE error, falling back to polling');
          // Fall back to polling
          if (!pollIntervalId) {
            pollIntervalId = setInterval(async () => {
              try {
                const job = await getSearchJobStatus(jobId);
                onUpdate(job);
                // Stop polling if job is complete
                if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) {
                  if (pollIntervalId) {
                    clearInterval(pollIntervalId);
                    pollIntervalId = null;
                  }
                }
              } catch (err) {
                console.error('[watchJob] Polling error:', err);
              }
            }, 3000);
          }
        };
      } catch (err) {
        console.error('[watchJob] Failed to start SSE:', err);
        // Fall back to polling immediately
        pollIntervalId = setInterval(async () => {
          try {
            const job = await getSearchJobStatus(jobId);
            onUpdate(job);
            if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) {
              if (pollIntervalId) {
                clearInterval(pollIntervalId);
                pollIntervalId = null;
              }
            }
          } catch (pollErr) {
            console.error('[watchJob] Polling error:', pollErr);
          }
        }, 3000);
      }
    };

    startWatch();

    // Return cleanup function
    return () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (pollIntervalId) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
      }
    };
  }, []);

  /**
   * Get jobs by type
   */
  const getJobsByType = useCallback((type: SearchJobType): SearchJob[] => {
    return context.jobs.filter(j => j.type === type);
  }, [context.jobs]);

  /**
   * Get jobs by status
   */
  const getJobsByStatus = useCallback((status: SearchJobStatus): SearchJob[] => {
    return context.jobs.filter(j => j.status === status);
  }, [context.jobs]);

  /**
   * Get latest job of a specific type
   */
  const getLatestJobByType = useCallback((type: SearchJobType): SearchJob | undefined => {
    const jobsOfType = context.jobs.filter(j => j.type === type);
    return jobsOfType.length > 0 ? jobsOfType[0] : undefined;
  }, [context.jobs]);

  /**
   * Format job type to Korean label
   */
  const formatJobType = useCallback((type: SearchJobType): string => {
    return JOB_TYPE_LABELS[type] || type;
  }, []);

  /**
   * Format job status to Korean label
   */
  const formatJobStatus = useCallback((status: SearchJobStatus): string => {
    return JOB_STATUS_LABELS[status] || status;
  }, []);

  /**
   * Get job progress info
   */
  const getJobProgress = useCallback((job: SearchJob): { percent: number; label: string } => {
    const percent = job.progress || 0;
    let label = `${percent}%`;

    if (job.currentPhase) {
      label = job.currentPhase;
    } else if (job.status === 'PENDING') {
      label = '대기 중...';
    } else if (job.status === 'RUNNING' && percent === 0) {
      label = '시작 중...';
    } else if (job.status === 'COMPLETED') {
      label = '완료';
    } else if (job.status === 'FAILED') {
      label = job.errorMessage || '실패';
    } else if (job.status === 'CANCELLED') {
      label = '취소됨';
    }

    return { percent, label };
  }, []);

  return {
    // From context
    ...context,
    
    // Extended functionality
    watchJob,
    getJobsByType,
    getJobsByStatus,
    getLatestJobByType,
    
    // Utilities
    formatJobType,
    formatJobStatus,
    getJobProgress,
  };
}

/**
 * Hook for watching a single job
 */
export function useWatchJob(jobId: string | null): {
  job: SearchJob | null;
  isLoading: boolean;
  error: string | null;
} {
  const [job, setJob] = useState<SearchJob | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    let eventSource: EventSource | null = null;
    let pollIntervalId: ReturnType<typeof setInterval> | null = null;
    let isActive = true;

    const fetchJob = async () => {
      try {
        const fetchedJob = await getSearchJobStatus(jobId);
        if (isActive) {
          setJob(fetchedJob);
          setIsLoading(false);
        }
        return fetchedJob;
      } catch (err) {
        if (isActive) {
          setError(err instanceof Error ? err.message : '작업을 불러올 수 없습니다.');
          setIsLoading(false);
        }
        return null;
      }
    };

    const startSSE = async () => {
      try {
        eventSource = await openSearchJobStream(jobId);

        eventSource.addEventListener('job_progress', () => fetchJob());
        eventSource.addEventListener('job_completed', () => fetchJob());
        eventSource.addEventListener('job_failed', () => fetchJob());
        eventSource.addEventListener('job_cancelled', () => fetchJob());

        eventSource.onerror = () => {
          // Fall back to polling
          if (!pollIntervalId) {
            pollIntervalId = setInterval(async () => {
              const updatedJob = await fetchJob();
              if (updatedJob && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(updatedJob.status)) {
                if (pollIntervalId) {
                  clearInterval(pollIntervalId);
                  pollIntervalId = null;
                }
              }
            }, 3000);
          }
        };
      } catch {
        // Fall back to polling
        pollIntervalId = setInterval(async () => {
          const updatedJob = await fetchJob();
          if (updatedJob && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(updatedJob.status)) {
            if (pollIntervalId) {
              clearInterval(pollIntervalId);
              pollIntervalId = null;
            }
          }
        }, 3000);
      }
    };

    // Initial fetch
    fetchJob().then((initialJob) => {
      if (initialJob && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(initialJob.status)) {
        startSSE();
      }
    });

    return () => {
      isActive = false;
      if (eventSource) {
        eventSource.close();
      }
      if (pollIntervalId) {
        clearInterval(pollIntervalId);
      }
    };
  }, [jobId]);

  return { job, isLoading, error };
}

// Default export is the extended hook
export default useSearchJobsExtended;
