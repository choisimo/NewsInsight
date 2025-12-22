import { useState, useEffect, useCallback, useRef } from 'react';
import {
  persistState,
  loadPersistedState,
  type StorageType,
} from '@/lib/persistence';

interface UsePersistedStateOptions<T> {
  /** 스토리지 키 */
  key: string;
  /** 스토리지 타입 */
  storage?: StorageType;
  /** 만료 시간 (ms) */
  expiry?: number;
  /** 저장 디바운스 시간 (ms) */
  debounce?: number;
  /** 데이터 검증 함수 */
  validate?: (value: T) => boolean;
  /** 버전 (스키마 변경 시 증가) */
  version?: number;
}

/**
 * 상태를 localStorage/sessionStorage에 자동으로 영속화하는 훅
 * 
 * @example
 * ```tsx
 * const [jobs, setJobs] = usePersistedState<SearchJob[]>([], {
 *   key: 'search_jobs',
 *   expiry: 24 * 60 * 60 * 1000, // 24시간
 * });
 * ```
 */
export function usePersistedState<T>(
  defaultValue: T,
  options: UsePersistedStateOptions<T>
): [T, React.Dispatch<React.SetStateAction<T>>, { isLoaded: boolean; clear: () => void }] {
  const {
    key,
    storage = 'local',
    expiry,
    debounce = 500,
    validate,
    version,
  } = options;

  const [isLoaded, setIsLoaded] = useState(false);
  const [value, setValue] = useState<T>(defaultValue);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstMount = useRef(true);

  // 마운트 시 저장된 상태 로드
  useEffect(() => {
    if (!isFirstMount.current) return;
    isFirstMount.current = false;

    const persisted = loadPersistedState<T>({
      key,
      storage,
      expiry,
      validate,
      version,
    });

    if (persisted !== null) {
      setValue(persisted);
    }
    setIsLoaded(true);
  }, [key, storage, expiry, validate, version]);

  // 상태 변경 시 저장 (디바운스)
  useEffect(() => {
    if (!isLoaded) return;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      persistState(value, { key, storage, version });
    }, debounce);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value, isLoaded, key, storage, version, debounce]);

  const clear = useCallback(() => {
    try {
      (storage === 'session' ? sessionStorage : localStorage).removeItem(key);
      setValue(defaultValue);
    } catch (e) {
      console.warn(`[usePersistedState] Failed to clear "${key}":`, e);
    }
  }, [key, storage, defaultValue]);

  return [value, setValue, { isLoaded, clear }];
}

/**
 * useReducer와 함께 사용할 수 있는 영속화 훅
 * reducer 상태를 자동으로 저장하고 복원
 */
export function usePersistedReducer<S, A>(
  reducer: React.Reducer<S, A>,
  initialState: S,
  options: UsePersistedStateOptions<S>
): [S, React.Dispatch<A>, { isLoaded: boolean }] {
  const {
    key,
    storage = 'local',
    expiry,
    validate,
    version,
    debounce = 500,
  } = options;

  const [isLoaded, setIsLoaded] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 초기 상태 로드
  const getInitialState = useCallback((): S => {
    const persisted = loadPersistedState<S>({
      key,
      storage,
      expiry,
      validate,
      version,
    });
    return persisted !== null ? persisted : initialState;
  }, [key, storage, expiry, validate, version, initialState]);

  const [state, baseDispatch] = useState<S>(getInitialState);

  // 마운트 후 로드 완료 표시
  useEffect(() => {
    setIsLoaded(true);
  }, []);

  // 상태 변경 시 저장
  useEffect(() => {
    if (!isLoaded) return;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      persistState(state, { key, storage, version });
    }, debounce);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [state, isLoaded, key, storage, version, debounce]);

  // dispatch 래퍼
  const dispatch = useCallback((action: A) => {
    baseDispatch((prevState) => reducer(prevState, action));
  }, [reducer]);

  return [state, dispatch, { isLoaded }];
}

export default usePersistedState;
