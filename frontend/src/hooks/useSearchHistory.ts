import { useState, useCallback, useEffect, useRef } from 'react';
import {
  saveSearchHistory,
  listSearchHistory,
  getSearchHistoryById,
  getDerivedSearches,
  toggleSearchBookmark,
  deleteSearchHistory,
  getBookmarkedSearches,
  searchHistoryByQuery,
  type SearchHistoryRecord,
  type SaveSearchHistoryRequest,
  type SearchHistoryType,
  type PageResponse,
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
      // Don't throw - search history save failure shouldn't block the UI
    }
  }, [sessionId, userId, extractUrlsFromResults]);

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

export default useSearchHistory;
