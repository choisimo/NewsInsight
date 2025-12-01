import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef } from 'react';

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
    dispatch({ type: 'UPDATE_TASK', id, updates });
  }, []);

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
