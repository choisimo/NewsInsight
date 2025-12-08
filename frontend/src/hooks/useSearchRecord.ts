import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  getSearchHistoryById,
  getDerivedSearches,
  type SearchHistoryRecord,
  type SearchHistoryType,
} from '@/lib/api';

/**
 * Extracted URL data from search results
 */
export interface ExtractedUrl {
  url: string;
  title?: string;
  snippet?: string;
  source?: string;
  reliability?: 'high' | 'medium' | 'low';
}

/**
 * Priority URL format compatible with ParallelSearch/DeepSearch/FactCheck
 */
export interface PriorityUrl {
  id: string;
  url: string;
  name: string;
  description?: string;
  reliability?: 'high' | 'medium' | 'low';
}

interface UseSearchRecordOptions {
  /** Search history ID to load */
  searchId?: number;
  /** Auto-load on mount */
  autoLoad?: boolean;
}

interface UseSearchRecordReturn {
  // State
  record: SearchHistoryRecord | null;
  derivedSearches: SearchHistoryRecord[];
  loading: boolean;
  error: string | null;
  
  // Extracted data
  extractedUrls: ExtractedUrl[];
  priorityUrls: PriorityUrl[];
  aiSummary: string | null;
  query: string | null;
  searchType: SearchHistoryType | null;
  
  // Actions
  loadRecord: (id: number) => Promise<SearchHistoryRecord | null>;
  loadDerived: (parentId: number) => Promise<SearchHistoryRecord[]>;
  
  // Utilities for passing to other search components
  getNavigationState: () => {
    priorityUrls: PriorityUrl[];
    parentSearchId: number | undefined;
    deriveFrom: number | undefined;
    depthLevel: number;
    query: string;
  } | null;
}

/**
 * Extract URLs from search results array
 */
function extractUrlsFromResults(results: Array<Record<string, unknown>>): ExtractedUrl[] {
  const urls: ExtractedUrl[] = [];
  const seenUrls = new Set<string>();
  
  for (const result of results) {
    const url = result.url as string | undefined;
    if (url && !seenUrls.has(url)) {
      seenUrls.add(url);
      urls.push({
        url,
        title: result.title as string | undefined,
        snippet: result.snippet as string | undefined,
        source: result.source as string | undefined,
        reliability: parseReliability(result.reliabilityScore as number | undefined),
      });
    }
    
    // Also check for nested evidence URLs
    if (Array.isArray(result.evidence)) {
      for (const evidence of result.evidence) {
        const evUrl = (evidence as Record<string, unknown>)?.url as string | undefined;
        if (evUrl && !seenUrls.has(evUrl)) {
          seenUrls.add(evUrl);
          urls.push({
            url: evUrl,
            title: (evidence as Record<string, unknown>)?.title as string | undefined,
            snippet: (evidence as Record<string, unknown>)?.snippet as string | undefined,
            source: (evidence as Record<string, unknown>)?.source as string | undefined,
          });
        }
      }
    }
  }
  
  return urls;
}

/**
 * Convert reliability score to label
 */
function parseReliability(score: number | undefined): 'high' | 'medium' | 'low' | undefined {
  if (score === undefined || score === null) return undefined;
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

/**
 * Convert ExtractedUrl to PriorityUrl format
 */
function toPriorityUrl(extracted: ExtractedUrl, index: number): PriorityUrl {
  let hostname = extracted.url;
  try {
    hostname = new URL(extracted.url).hostname;
  } catch {
    // Keep original URL if parsing fails
  }
  
  return {
    id: `extracted-${index}-${Date.now()}`,
    url: extracted.url,
    name: extracted.title || hostname,
    description: extracted.snippet,
    reliability: extracted.reliability,
  };
}

/**
 * Extract AI summary text from aiSummary object
 */
function extractAiSummaryText(aiSummary: Record<string, unknown> | undefined): string | null {
  if (!aiSummary) return null;
  
  // Try common fields where AI content might be stored
  if (typeof aiSummary.content === 'string') return aiSummary.content;
  if (typeof aiSummary.summary === 'string') return aiSummary.summary;
  if (typeof aiSummary.text === 'string') return aiSummary.text;
  if (typeof aiSummary.analysis === 'string') return aiSummary.analysis;
  
  return null;
}

/**
 * Hook for loading and utilizing a search history record.
 * Useful for reusing search results in derived searches (e.g., passing URLs to FactCheck).
 * 
 * @example
 * ```tsx
 * // In a component that receives parentSearchId from navigation state
 * const { record, priorityUrls, getNavigationState } = useSearchRecord({
 *   searchId: parentSearchId,
 *   autoLoad: true,
 * });
 * 
 * // Navigate to FactCheck with extracted URLs
 * const navState = getNavigationState();
 * if (navState) {
 *   navigate('/fact-check', { state: navState });
 * }
 * ```
 */
export function useSearchRecord(options: UseSearchRecordOptions = {}): UseSearchRecordReturn {
  const { searchId, autoLoad = true } = options;
  
  const [record, setRecord] = useState<SearchHistoryRecord | null>(null);
  const [derivedSearches, setDerivedSearches] = useState<SearchHistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  /**
   * Load a search record by ID
   */
  const loadRecord = useCallback(async (id: number): Promise<SearchHistoryRecord | null> => {
    setLoading(true);
    setError(null);
    
    try {
      const data = await getSearchHistoryById(id);
      setRecord(data);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load search record';
      setError(message);
      console.error('Failed to load search record:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);
  
  /**
   * Load derived searches (children) for a parent search
   */
  const loadDerived = useCallback(async (parentId: number): Promise<SearchHistoryRecord[]> => {
    try {
      const data = await getDerivedSearches(parentId);
      setDerivedSearches(data);
      return data;
    } catch (err) {
      console.error('Failed to load derived searches:', err);
      return [];
    }
  }, []);
  
  // Auto-load on mount if searchId is provided
  useEffect(() => {
    if (autoLoad && searchId) {
      loadRecord(searchId);
    }
  }, [autoLoad, searchId, loadRecord]);
  
  /**
   * Extract URLs from loaded record
   */
  const extractedUrls = useMemo((): ExtractedUrl[] => {
    if (!record) return [];
    
    // Use discoveredUrls if available
    if (record.discoveredUrls && record.discoveredUrls.length > 0) {
      return record.discoveredUrls.map((url) => ({ url }));
    }
    
    // Otherwise extract from results
    if (record.results && Array.isArray(record.results)) {
      return extractUrlsFromResults(record.results);
    }
    
    return [];
  }, [record]);
  
  /**
   * Convert to PriorityUrl format for search components
   */
  const priorityUrls = useMemo((): PriorityUrl[] => {
    return extractedUrls.map((url, index) => toPriorityUrl(url, index));
  }, [extractedUrls]);
  
  /**
   * Extract AI summary text
   */
  const aiSummary = useMemo((): string | null => {
    if (!record?.aiSummary) return null;
    return extractAiSummaryText(record.aiSummary);
  }, [record]);
  
  /**
   * Get navigation state for passing to other search pages
   */
  const getNavigationState = useCallback(() => {
    if (!record) return null;
    
    return {
      priorityUrls,
      parentSearchId: record.id,
      deriveFrom: record.id,
      depthLevel: (record.depthLevel || 0) + 1,
      query: record.query,
    };
  }, [record, priorityUrls]);
  
  return {
    record,
    derivedSearches,
    loading,
    error,
    extractedUrls,
    priorityUrls,
    aiSummary,
    query: record?.query || null,
    searchType: record?.searchType || null,
    loadRecord,
    loadDerived,
    getNavigationState,
  };
}

/**
 * Hook for using search record data from navigation state.
 * Automatically loads the parent search if parentSearchId is in location state.
 * 
 * @example
 * ```tsx
 * // In FactCheck or DeepSearch page
 * const location = useLocation();
 * const { priorityUrls, parentQuery, isFromHistory } = useSearchRecordFromState(location.state);
 * ```
 */
export function useSearchRecordFromState(locationState: unknown) {
  const state = locationState as {
    parentSearchId?: number;
    deriveFrom?: number;
    priorityUrls?: PriorityUrl[];
    query?: string;
    depthLevel?: number;
  } | null;
  
  const searchId = state?.parentSearchId || state?.deriveFrom;
  const { record, loading, priorityUrls: loadedUrls, query } = useSearchRecord({
    searchId,
    autoLoad: !!searchId,
  });
  
  // Prefer URLs from state if provided (more up-to-date), fall back to loaded
  const priorityUrls = state?.priorityUrls?.length ? state.priorityUrls : loadedUrls;
  const parentQuery = state?.query || query;
  const depthLevel = state?.depthLevel || (record?.depthLevel ? record.depthLevel + 1 : 1);
  
  return {
    priorityUrls,
    parentQuery,
    parentSearchId: searchId,
    depthLevel,
    isFromHistory: !!searchId,
    loading,
    record,
  };
}

export default useSearchRecord;
