import { useState, useCallback, useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  saveSearchHistory,
  listSearchHistory,
  getSearchHistoryById,
  getDerivedSearches,
  toggleSearchBookmark,
  deleteSearchHistory,
  getBookmarkedSearches,
  searchHistoryByQuery,
  openSearchHistoryStream,
  type SearchHistoryRecord,
  type SaveSearchHistoryRequest,
  type SearchHistoryType,
  type PageResponse,
  type SearchHistorySSEEvent,
} from '@/lib/api';

// Generate session ID for grouping searches
const generateSessionId = (): string => {
  const stored = sessionStorage.getItem('search-session-id');
  if (stored) return stored;
  const newId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  sessionStorage.setItem('search-session-id', newId);
  return newId;
};

interface UseSearchHistoryOptions {
  autoSave?: boolean;
  pageSize?: number;
  userId?: string;
}

interface UseSearchHistoryReturn {
  // State
  history: SearchHistoryRecord[];
  loading: boolean;
  error: string | null;
  currentPage: number;
  totalPages: number;
  totalElements: number;
  
  // Actions
  saveSearch: (data: Omit<SaveSearchHistoryRequest, 'sessionId'>) => Promise<void>;
  loadHistory: (page?: number, type?: SearchHistoryType) => Promise<void>;
  loadBookmarked: (page?: number) => Promise<void>;
  searchHistory: (query: string, page?: number) => Promise<void>;
  toggleBookmark: (id: number) => Promise<void>;
  deleteSearch: (id: number) => Promise<void>;
  loadDerivedSearches: (parentId: number) => Promise<SearchHistoryRecord[]>;
  getSearchById: (id: number) => Promise<SearchHistoryRecord | null>;
  
  // Utilities
  sessionId: string;
  extractUrlsFromResults: (results: Array<Record<string, unknown>>) => string[];
}

/**
 * Hook for managing search history with database persistence.
 * Automatically saves search results to the backend via Kafka.
 */
export function useSearchHistory(options: UseSearchHistoryOptions = {}): UseSearchHistoryReturn {
  const { pageSize = 20, userId } = options;
  const { toast } = useToast();
  
  const [history, setHistory] = useState<SearchHistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [totalElements, setTotalElements] = useState(0);
  
  const sessionId = useRef(generateSessionId()).current;

  /**
   * Extract URLs from search results for auto-collection
   */
  const extractUrlsFromResults = useCallback((results: Array<Record<string, unknown>>): string[] => {
    const urls: string[] = [];
    for (const result of results) {
      if (typeof result.url === 'string' && result.url) {
        urls.push(result.url);
      }
      // Also check for nested URLs (e.g., in evidence)
      if (Array.isArray(result.evidence)) {
        for (const evidence of result.evidence) {
          if (typeof evidence === 'object' && evidence && typeof (evidence as Record<string, unknown>).url === 'string') {
            urls.push((evidence as Record<string, unknown>).url as string);
          }
        }
      }
    }
    // Deduplicate
    return [...new Set(urls)];
  }, []);

  /**
   * Save a search to history
   */
  const saveSearch = useCallback(async (data: Omit<SaveSearchHistoryRequest, 'sessionId'>) => {
    try {
      // Auto-extract URLs if not provided
      let discoveredUrls = data.discoveredUrls;
      if (!discoveredUrls && data.results) {
        discoveredUrls = extractUrlsFromResults(data.results);
      }

      await saveSearchHistory({
        ...data,
        sessionId,
        userId,
        discoveredUrls,
      });
    } catch (err) {
      console.error('Failed to save search history:', err);
      // 사용자에게 저장 실패 알림
      toast({
        title: '검색 기록 저장 실패',
        description: err instanceof Error ? err.message : '잠시 후 다시 시도해주세요.',
        variant: 'destructive',
      });
    }
  }, [sessionId, userId, extractUrlsFromResults, toast]);

  /**
   * Load search history with pagination
   */
  const loadHistory = useCallback(async (page: number = 0, type?: SearchHistoryType) => {
    setLoading(true);
    setError(null);
    try {
      const response: PageResponse<SearchHistoryRecord> = await listSearchHistory(
        page,
        pageSize,
        'createdAt',
        'DESC',
        type,
        userId,
      );
      setHistory(response.content);
      setCurrentPage(response.page);
      setTotalPages(response.totalPages);
      setTotalElements(response.totalElements);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load search history');
      console.error('Failed to load search history:', err);
    } finally {
      setLoading(false);
    }
  }, [pageSize, userId]);

  /**
   * Load bookmarked searches
   */
  const loadBookmarked = useCallback(async (page: number = 0) => {
    setLoading(true);
    setError(null);
    try {
      const response = await getBookmarkedSearches(page, pageSize);
      setHistory(response.content);
      setCurrentPage(response.page);
      setTotalPages(response.totalPages);
      setTotalElements(response.totalElements);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bookmarked searches');
      console.error('Failed to load bookmarked searches:', err);
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  /**
   * Search history by query text
   */
  const searchHistoryLocal = useCallback(async (query: string, page: number = 0) => {
    setLoading(true);
    setError(null);
    try {
      const response = await searchHistoryByQuery(query, page, pageSize);
      setHistory(response.content);
      setCurrentPage(response.page);
      setTotalPages(response.totalPages);
      setTotalElements(response.totalElements);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search history');
      console.error('Failed to search history:', err);
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  /**
   * Toggle bookmark for a search
   */
  const toggleBookmarkLocal = useCallback(async (id: number) => {
    try {
      const updated = await toggleSearchBookmark(id);
      setHistory(prev => prev.map(item => 
        item.id === id ? updated : item
      ));
    } catch (err) {
      console.error('Failed to toggle bookmark:', err);
      throw err;
    }
  }, []);

  /**
   * Delete a search from history
   */
  const deleteSearchLocal = useCallback(async (id: number) => {
    try {
      await deleteSearchHistory(id);
      setHistory(prev => prev.filter(item => item.id !== id));
      setTotalElements(prev => prev - 1);
    } catch (err) {
      console.error('Failed to delete search:', err);
      throw err;
    }
  }, []);

  /**
   * Load derived (drill-down) searches
   */
  const loadDerivedSearches = useCallback(async (parentId: number): Promise<SearchHistoryRecord[]> => {
    try {
      return await getDerivedSearches(parentId);
    } catch (err) {
      console.error('Failed to load derived searches:', err);
      return [];
    }
  }, []);

  /**
   * Get a single search by ID
   */
  const getSearchById = useCallback(async (id: number): Promise<SearchHistoryRecord | null> => {
    try {
      return await getSearchHistoryById(id);
    } catch (err) {
      console.error('Failed to get search:', err);
      return null;
    }
  }, []);

  return {
    history,
    loading,
    error,
    currentPage,
    totalPages,
    totalElements,
    saveSearch,
    loadHistory,
    loadBookmarked,
    searchHistory: searchHistoryLocal,
    toggleBookmark: toggleBookmarkLocal,
    deleteSearch: deleteSearchLocal,
    loadDerivedSearches,
    getSearchById,
    sessionId,
    extractUrlsFromResults,
  };
}

/**
 * Hook for auto-saving search results.
 * Use this in search components to automatically save completed searches.
 */
export function useAutoSaveSearch() {
  const { saveSearch, sessionId, extractUrlsFromResults } = useSearchHistory();

  /**
   * Save unified search results
   */
  const saveUnifiedSearch = useCallback(async (
    query: string,
    results: Array<Record<string, unknown>>,
    aiSummary?: Record<string, unknown>,
    durationMs?: number,
    timeWindow?: string,
  ) => {
    await saveSearch({
      searchType: 'UNIFIED',
      query,
      timeWindow,
      results,
      aiSummary,
      resultCount: results.length,
      durationMs,
      success: true,
      discoveredUrls: extractUrlsFromResults(results),
    });
  }, [saveSearch, extractUrlsFromResults]);

  /**
   * Save deep search results
   */
  const saveDeepSearch = useCallback(async (
    jobId: string,
    topic: string,
    results: Array<Record<string, unknown>>,
    stanceDistribution?: Record<string, unknown>,
    durationMs?: number,
    parentSearchId?: number,
  ) => {
    await saveSearch({
      externalId: jobId,
      searchType: 'DEEP_SEARCH',
      query: topic,
      results,
      stanceDistribution,
      resultCount: results.length,
      durationMs,
      parentSearchId,
      success: true,
      discoveredUrls: extractUrlsFromResults(results),
    });
  }, [saveSearch, extractUrlsFromResults]);

  /**
   * Save fact check results
   */
  const saveFactCheck = useCallback(async (
    topic: string,
    factCheckResults: Array<Record<string, unknown>>,
    credibilityScore?: number,
    durationMs?: number,
    parentSearchId?: number,
  ) => {
    await saveSearch({
      searchType: 'FACT_CHECK',
      query: topic,
      factCheckResults,
      credibilityScore,
      resultCount: factCheckResults.length,
      durationMs,
      parentSearchId,
      success: true,
    });
  }, [saveSearch]);

  /**
   * Save browser agent results
   */
  const saveBrowserAgent = useCallback(async (
    task: string,
    results: Array<Record<string, unknown>>,
    urlsVisited: string[],
    durationMs?: number,
  ) => {
    await saveSearch({
      searchType: 'BROWSER_AGENT',
      query: task,
      results,
      discoveredUrls: urlsVisited,
      resultCount: results.length,
      durationMs,
      success: true,
    });
  }, [saveSearch]);

  /**
   * Save failed search
   */
  const saveFailedSearch = useCallback(async (
    searchType: SearchHistoryType,
    query: string,
    errorMessage: string,
    durationMs?: number,
  ) => {
    await saveSearch({
      searchType,
      query,
      errorMessage,
      durationMs,
      success: false,
    });
  }, [saveSearch]);

  return {
    saveUnifiedSearch,
    saveDeepSearch,
    saveFactCheck,
    saveBrowserAgent,
    saveFailedSearch,
    sessionId,
  };
}

/**
 * Hook for real-time search history updates via SSE.
 * Use this in components that need to display live updates.
 */
export function useSearchHistorySSE(options: {
  enabled?: boolean;
  onNewSearch?: (search: SearchHistoryRecord) => void;
  onUpdatedSearch?: (search: SearchHistoryRecord) => void;
  onDeletedSearch?: (id: number) => void;
} = {}) {
  const { enabled = true, onNewSearch, onUpdatedSearch, onDeletedSearch } = options;
  
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<SearchHistorySSEEvent | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  const connect = useCallback(async () => {
    if (!enabled) return;
    
    try {
      // Close existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      
      const eventSource = await openSearchHistoryStream();
      eventSourceRef.current = eventSource;
      
      eventSource.onopen = () => {
        console.log('[SearchHistory SSE] Connected');
        setConnected(true);
        setError(null);
        reconnectAttempts.current = 0;
      };
      
      // Listen for specific event types
      eventSource.addEventListener('new_search', (event) => {
        try {
          const data = JSON.parse(event.data) as SearchHistorySSEEvent;
          console.log('[SearchHistory SSE] New search:', data);
          setLastEvent(data);
          if (onNewSearch && data.data && 'id' in data.data && 'searchType' in data.data) {
            onNewSearch(data.data as SearchHistoryRecord);
          }
        } catch (err) {
          console.error('[SearchHistory SSE] Failed to parse new_search event:', err);
        }
      });
      
      eventSource.addEventListener('updated_search', (event) => {
        try {
          const data = JSON.parse(event.data) as SearchHistorySSEEvent;
          console.log('[SearchHistory SSE] Updated search:', data);
          setLastEvent(data);
          if (onUpdatedSearch && data.data && 'id' in data.data && 'searchType' in data.data) {
            onUpdatedSearch(data.data as SearchHistoryRecord);
          }
        } catch (err) {
          console.error('[SearchHistory SSE] Failed to parse updated_search event:', err);
        }
      });
      
      eventSource.addEventListener('deleted_search', (event) => {
        try {
          const data = JSON.parse(event.data) as SearchHistorySSEEvent;
          console.log('[SearchHistory SSE] Deleted search:', data);
          setLastEvent(data);
          if (onDeletedSearch && data.data && 'id' in data.data) {
            onDeletedSearch((data.data as { id: number }).id);
          }
        } catch (err) {
          console.error('[SearchHistory SSE] Failed to parse deleted_search event:', err);
        }
      });
      
      eventSource.addEventListener('heartbeat', (event) => {
        try {
          const data = JSON.parse(event.data) as SearchHistorySSEEvent;
          console.debug('[SearchHistory SSE] Heartbeat:', data);
        } catch {
          // Heartbeat parsing errors are not critical
        }
      });
      
      eventSource.onerror = (err) => {
        console.error('[SearchHistory SSE] Error:', err);
        setConnected(false);
        
        // Attempt reconnection with exponential backoff
        if (reconnectAttempts.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          console.log(`[SearchHistory SSE] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current + 1})`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttempts.current++;
            connect();
          }, delay);
        } else {
          setError('Failed to connect to search history stream after multiple attempts');
        }
      };
      
    } catch (err) {
      console.error('[SearchHistory SSE] Failed to connect:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setConnected(false);
    }
  }, [enabled, onNewSearch, onUpdatedSearch, onDeletedSearch]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    
    setConnected(false);
  }, []);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    if (enabled) {
      connect();
    }
    
    return () => {
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  return {
    connected,
    error,
    lastEvent,
    reconnect: connect,
    disconnect,
  };
}

export default useSearchHistory;
