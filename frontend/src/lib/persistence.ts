/**
 * State Persistence Utilities
 * 
 * 새로고침 시 상태를 유지하기 위한 유틸리티 함수들
 * localStorage/sessionStorage를 활용하여 React 상태를 영속화
 */

export type StorageType = 'local' | 'session';

interface PersistenceOptions<T> {
  /** 스토리지 키 */
  key: string;
  /** 스토리지 타입 (기본: local) */
  storage?: StorageType;
  /** 데이터 만료 시간 (ms), undefined면 만료 없음 */
  expiry?: number;
  /** 저장 전 데이터 변환 */
  serialize?: (value: T) => string;
  /** 로드 후 데이터 변환 */
  deserialize?: (value: string) => T;
  /** 로드된 데이터 검증 */
  validate?: (value: T) => boolean;
  /** 버전 관리 (스키마 변경 시 무효화) */
  version?: number;
}

interface PersistedData<T> {
  data: T;
  timestamp: number;
  version?: number;
}

function getStorage(type: StorageType): Storage {
  return type === 'session' ? sessionStorage : localStorage;
}

/**
 * 데이터를 스토리지에 저장
 */
export function persistState<T>(
  value: T,
  options: PersistenceOptions<T>
): void {
  const {
    key,
    storage = 'local',
    serialize = JSON.stringify,
    version,
  } = options;

  try {
    const persistedData: PersistedData<T> = {
      data: value,
      timestamp: Date.now(),
      version,
    };
    getStorage(storage).setItem(key, serialize(persistedData as unknown as T));
  } catch (error) {
    console.warn(`[Persistence] Failed to save state for key "${key}":`, error);
  }
}

/**
 * 스토리지에서 데이터 로드
 */
export function loadPersistedState<T>(
  options: PersistenceOptions<T>
): T | null {
  const {
    key,
    storage = 'local',
    expiry,
    deserialize = JSON.parse,
    validate,
    version,
  } = options;

  try {
    const stored = getStorage(storage).getItem(key);
    if (!stored) return null;

    const parsed = deserialize(stored) as PersistedData<T>;
    
    // 버전 체크
    if (version !== undefined && parsed.version !== version) {
      console.log(`[Persistence] Version mismatch for "${key}", clearing stored data`);
      clearPersistedState(options);
      return null;
    }

    // 만료 체크
    if (expiry !== undefined) {
      const age = Date.now() - parsed.timestamp;
      if (age > expiry) {
        console.log(`[Persistence] Data expired for "${key}", clearing stored data`);
        clearPersistedState(options);
        return null;
      }
    }

    // 데이터 검증
    if (validate && !validate(parsed.data)) {
      console.log(`[Persistence] Validation failed for "${key}", clearing stored data`);
      clearPersistedState(options);
      return null;
    }

    return parsed.data;
  } catch (error) {
    console.warn(`[Persistence] Failed to load state for key "${key}":`, error);
    return null;
  }
}

/**
 * 스토리지에서 데이터 삭제
 */
export function clearPersistedState<T>(
  options: Pick<PersistenceOptions<T>, 'key' | 'storage'>
): void {
  const { key, storage = 'local' } = options;
  try {
    getStorage(storage).removeItem(key);
  } catch (error) {
    console.warn(`[Persistence] Failed to clear state for key "${key}":`, error);
  }
}

/**
 * React useState와 함께 사용할 수 있는 영속화 훅을 위한 초기값 로더
 */
export function getPersistedInitialState<T>(
  defaultValue: T,
  options: PersistenceOptions<T>
): T {
  const persisted = loadPersistedState(options);
  return persisted !== null ? persisted : defaultValue;
}

/**
 * 상태 변경 시 자동으로 저장하는 디바운스된 저장 함수 생성
 */
export function createDebouncedPersister<T>(
  options: PersistenceOptions<T>,
  delay: number = 500
): (value: T) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (value: T) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      persistState(value, options);
    }, delay);
  };
}

/**
 * 상태 영속화를 위한 스토리지 키 상수
 */
export const PERSISTENCE_KEYS = {
  SEARCH_JOBS: 'newsinsight_search_jobs',
  BACKGROUND_TASKS: 'newsinsight_background_tasks',
  THEME: 'newsinsight-theme',
  SIDEBAR_STATE: 'newsinsight_sidebar_state',
  USER_PREFERENCES: 'newsinsight_user_preferences',
  RECENT_SEARCHES: 'newsinsight_recent_searches',
  SSE_LAST_EVENT_ID: 'newsinsight_sse_last_event_id',
} as const;

/**
 * 데이터 만료 시간 상수
 */
export const EXPIRY_TIMES = {
  ONE_HOUR: 60 * 60 * 1000,
  ONE_DAY: 24 * 60 * 60 * 1000,
  ONE_WEEK: 7 * 24 * 60 * 60 * 1000,
  NEVER: undefined,
} as const;
