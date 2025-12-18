import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef } from 'react';
import { toast } from '@/hooks/use-toast';

// ============================================
// Types
// ============================================

export type TaskType = 'deep-search' | 'browser-agent' | 'fact-check';
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface BackgroundTask {
  id: string;
  type: TaskType;
  title: string;
  status: TaskStatus;
  progress?: number;
  progressMessage?: string;
  createdAt: string;
  completedAt?: string;
  result?: unknown;
  error?: string;
  // Deep Search specific
  evidenceCount?: number;
  // For navigation
  resultUrl?: string;
}

interface BackgroundTaskState {
  tasks: BackgroundTask[];
  isLoaded: boolean;
}

type BackgroundTaskAction =
  | { type: 'LOAD_TASKS'; tasks: BackgroundTask[] }
  | { type: 'ADD_TASK'; task: BackgroundTask }
  | { type: 'UPDATE_TASK'; id: string; updates: Partial<BackgroundTask> }
  | { type: 'REMOVE_TASK'; id: string }
  | { type: 'CLEAR_COMPLETED' };

// ============================================
// Constants
// ============================================

const STORAGE_KEY = 'newsinsight_background_tasks';
const TASK_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// ============================================
// Reducer
// ============================================

function taskReducer(state: BackgroundTaskState, action: BackgroundTaskAction): BackgroundTaskState {
  switch (action.type) {
    case 'LOAD_TASKS':
      return { ...state, tasks: action.tasks, isLoaded: true };

    case 'ADD_TASK': {
      // Prevent duplicates
      if (state.tasks.some(t => t.id === action.task.id)) {
        return state;
      }
      return { ...state, tasks: [action.task, ...state.tasks] };
    }

    case 'UPDATE_TASK':
      return {
        ...state,
        tasks: state.tasks.map(t =>
          t.id === action.id ? { ...t, ...action.updates } : t
        ),
      };

    case 'REMOVE_TASK':
      return {
        ...state,
        tasks: state.tasks.filter(t => t.id !== action.id),
      };

    case 'CLEAR_COMPLETED':
      return {
        ...state,
        tasks: state.tasks.filter(t => t.status !== 'completed' && t.status !== 'failed' && t.status !== 'cancelled'),
      };

    default:
      return state;
  }
}

// ============================================
// Context
// ============================================

interface BackgroundTaskContextValue {
  tasks: BackgroundTask[];
  activeTasks: BackgroundTask[];
  completedTasks: BackgroundTask[];
  isLoaded: boolean;
  addTask: (task: Omit<BackgroundTask, 'createdAt'>) => void;
  updateTask: (id: string, updates: Partial<BackgroundTask>) => void;
  removeTask: (id: string) => void;
  getTask: (id: string) => BackgroundTask | undefined;
  clearCompletedTasks: () => void;
  hasActiveTasks: boolean;
  activeTaskCount: number;
}

const BackgroundTaskContext = createContext<BackgroundTaskContextValue | null>(null);

// ============================================
// Provider Component
// ============================================

export function BackgroundTaskProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(taskReducer, { tasks: [], isLoaded: false });
  const initialized = useRef(false);

  // Load tasks from localStorage on mount
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as BackgroundTask[];
        const now = Date.now();
        
        // Filter out expired tasks (older than 24 hours and completed/failed)
        const validTasks = parsed.filter(task => {
          const createdAt = new Date(task.createdAt).getTime();
          const isExpired = now - createdAt > TASK_EXPIRY_MS;
          const isTerminal = ['completed', 'failed', 'cancelled'].includes(task.status);
          return !(isExpired && isTerminal);
        });

        dispatch({ type: 'LOAD_TASKS', tasks: validTasks });
      } else {
        dispatch({ type: 'LOAD_TASKS', tasks: [] });
      }
    } catch (e) {
      console.error('Failed to load background tasks:', e);
      dispatch({ type: 'LOAD_TASKS', tasks: [] });
    }
  }, []);

  // Persist tasks to localStorage whenever they change
  useEffect(() => {
    if (!state.isLoaded) return;
    
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
    } catch (e) {
      console.error('Failed to save background tasks:', e);
    }
  }, [state.tasks, state.isLoaded]);

  // Derived state
  const activeTasks = state.tasks.filter(
    t => t.status === 'pending' || t.status === 'running'
  );

  const completedTasks = state.tasks.filter(
    t => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled'
  );

  // Actions
  const addTask = useCallback((task: Omit<BackgroundTask, 'createdAt'>) => {
    dispatch({
      type: 'ADD_TASK',
      task: {
        ...task,
        createdAt: new Date().toISOString(),
      },
    });
  }, []);

  const updateTask = useCallback((id: string, updates: Partial<BackgroundTask>) => {
    // Get current task to check if status changed to a terminal state
    const currentTask = state.tasks.find(t => t.id === id);
    
    // Check if we're transitioning to a terminal status (completed/failed)
    const isNewlyCompleted = 
      updates.status && 
      (updates.status === 'completed' || updates.status === 'failed' || updates.status === 'cancelled') &&
      currentTask && 
      currentTask.status !== 'completed' && 
      currentTask.status !== 'failed' && 
      currentTask.status !== 'cancelled';

    dispatch({ type: 'UPDATE_TASK', id, updates });

    // Show toast notification for completed/failed tasks
    // This allows users to know when a background task finishes even if they're on a different page
    if (isNewlyCompleted && currentTask) {
      const taskTitle = currentTask.title || 'Background Task';
      const taskType = currentTask.type === 'deep-search' ? 'Deep Search' 
        : currentTask.type === 'browser-agent' ? 'Browser Agent'
        : currentTask.type === 'fact-check' ? 'Fact Check'
        : currentTask.type;

      if (updates.status === 'completed') {
        toast({
          title: `✅ ${taskType} 완료`,
          description: `"${taskTitle}" 작업이 완료되었습니다. 결과를 확인하세요.`,
          duration: 8000,
        });
      } else if (updates.status === 'failed') {
        toast({
          title: `❌ ${taskType} 실패`,
          description: updates.error || `"${taskTitle}" 작업 중 오류가 발생했습니다.`,
          variant: 'destructive',
          duration: 10000,
        });
      } else if (updates.status === 'cancelled') {
        toast({
          title: `⚠️ ${taskType} 취소됨`,
          description: `"${taskTitle}" 작업이 취소되었습니다.`,
          duration: 5000,
        });
      }
    }
  }, [state.tasks]);

  const removeTask = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_TASK', id });
  }, []);

  const getTask = useCallback(
    (id: string) => state.tasks.find(t => t.id === id),
    [state.tasks]
  );

  const clearCompletedTasks = useCallback(() => {
    dispatch({ type: 'CLEAR_COMPLETED' });
  }, []);

  const value: BackgroundTaskContextValue = {
    tasks: state.tasks,
    activeTasks,
    completedTasks,
    isLoaded: state.isLoaded,
    addTask,
    updateTask,
    removeTask,
    getTask,
    clearCompletedTasks,
    hasActiveTasks: activeTasks.length > 0,
    activeTaskCount: activeTasks.length,
  };

  return (
    <BackgroundTaskContext.Provider value={value}>
      {children}
    </BackgroundTaskContext.Provider>
  );
}

// ============================================
// Hook
// ============================================

export function useBackgroundTasks(): BackgroundTaskContextValue {
  const context = useContext(BackgroundTaskContext);
  if (!context) {
    throw new Error('useBackgroundTasks must be used within a BackgroundTaskProvider');
  }
  return context;
}

export default BackgroundTaskContext;
