import { useState, useEffect, useCallback } from 'react';
import { useSearchHistory, useSearchHistorySSE } from '@/hooks/useSearchHistory';
import type { SearchHistoryRecord, SearchHistoryType } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

interface SearchHistoryPanelProps {
  onSelectSearch?: (search: SearchHistoryRecord) => void;
  onDeriveSearch?: (search: SearchHistoryRecord) => void;
  className?: string;
  enableRealtime?: boolean;
}

const searchTypeLabels: Record<SearchHistoryType, string> = {
  UNIFIED: '통합검색',
  DEEP_SEARCH: '딥서치',
  FACT_CHECK: '팩트체크',
  BROWSER_AGENT: '브라우저 에이전트',
};

const searchTypeColors: Record<SearchHistoryType, string> = {
  UNIFIED: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  DEEP_SEARCH: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  FACT_CHECK: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  BROWSER_AGENT: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
};

export function SearchHistoryPanel({
  onSelectSearch,
  onDeriveSearch,
  className = '',
  enableRealtime = true,
}: SearchHistoryPanelProps) {
  const {
    history,
    loading,
    error,
    currentPage,
    totalPages,
    totalElements,
    loadHistory,
    loadBookmarked,
    searchHistory,
    toggleBookmark,
    deleteSearch,
    loadDerivedSearches,
  } = useSearchHistory({ pageSize: 10 });

  const [filter, setFilter] = useState<SearchHistoryType | 'all' | 'bookmarked'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [derivedSearches, setDerivedSearches] = useState<Record<number, SearchHistoryRecord[]>>({});
  const [localHistory, setLocalHistory] = useState<SearchHistoryRecord[]>([]);
  const [newItemIds, setNewItemIds] = useState<Set<number>>(new Set());

  // Sync local history with server history
  useEffect(() => {
    setLocalHistory(history);
  }, [history]);

  // SSE real-time updates
  const { connected: sseConnected } = useSearchHistorySSE({
    enabled: enableRealtime,
    onNewSearch: useCallback((newSearch: SearchHistoryRecord) => {
      // Only add if we're on page 0 and filter matches
      if (currentPage === 0) {
        const matchesFilter = 
          filter === 'all' || 
          (filter === 'bookmarked' && newSearch.bookmarked) ||
          filter === newSearch.searchType;
        
        if (matchesFilter && !newSearch.parentSearchId) {
          setLocalHistory(prev => {
            // Prevent duplicates
            if (prev.some(item => item.id === newSearch.id)) {
              return prev;
            }
            // Add to the beginning
            return [newSearch, ...prev];
          });
          // Mark as new for highlight animation
          setNewItemIds(prev => new Set([...prev, newSearch.id]));
          // Remove highlight after animation
          setTimeout(() => {
            setNewItemIds(prev => {
              const next = new Set(prev);
              next.delete(newSearch.id);
              return next;
            });
          }, 3000);
        }
      }
    }, [currentPage, filter]),
    onUpdatedSearch: useCallback((updatedSearch: SearchHistoryRecord) => {
      setLocalHistory(prev => prev.map(item => 
        item.id === updatedSearch.id ? updatedSearch : item
      ));
    }, []),
    onDeletedSearch: useCallback((id: number) => {
      setLocalHistory(prev => prev.filter(item => item.id !== id));
    }, []),
  });

  // Load initial data
  useEffect(() => {
    loadHistory(0);
  }, [loadHistory]);

  // Handle filter change
  const handleFilterChange = useCallback((newFilter: SearchHistoryType | 'all' | 'bookmarked') => {
    setFilter(newFilter);
    setSearchQuery('');
    if (newFilter === 'bookmarked') {
      loadBookmarked(0);
    } else if (newFilter === 'all') {
      loadHistory(0);
    } else {
      loadHistory(0, newFilter);
    }
  }, [loadHistory, loadBookmarked]);

  // Handle search
  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      searchHistory(searchQuery.trim(), 0);
    } else {
      loadHistory(0);
    }
  }, [searchQuery, searchHistory, loadHistory]);

  // Handle page change
  const handlePageChange = useCallback((page: number) => {
    if (searchQuery.trim()) {
      searchHistory(searchQuery.trim(), page);
    } else if (filter === 'bookmarked') {
      loadBookmarked(page);
    } else if (filter === 'all') {
      loadHistory(page);
    } else {
      loadHistory(page, filter);
    }
  }, [searchQuery, filter, searchHistory, loadBookmarked, loadHistory]);

  // Handle expand to show derived searches
  const handleExpand = useCallback(async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!derivedSearches[id]) {
      const derived = await loadDerivedSearches(id);
      setDerivedSearches(prev => ({ ...prev, [id]: derived }));
    }
  }, [expandedId, derivedSearches, loadDerivedSearches]);

  // Handle bookmark toggle
  const handleToggleBookmark = useCallback(async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await toggleBookmark(id);
  }, [toggleBookmark]);

  // Handle delete
  const handleDelete = useCallback(async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('이 검색 기록을 삭제하시겠습니까?')) {
      await deleteSearch(id);
    }
  }, [deleteSearch]);

  // Render a single history item
  const renderHistoryItem = (item: SearchHistoryRecord, isChild = false) => {
    const isNew = newItemIds.has(item.id);
    
    return (
      <div
        key={item.id}
        className={`
          border rounded-lg p-3 cursor-pointer transition-all
          hover:border-blue-300 hover:shadow-sm
          ${isChild ? 'ml-6 border-l-4 border-l-purple-400' : ''}
          ${expandedId === item.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-950' : 'border-gray-200 dark:border-gray-700'}
          ${isNew ? 'animate-pulse border-green-400 bg-green-50 dark:bg-green-950' : ''}
        `}
        onClick={() => onSelectSearch?.(item)}
      >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Type badge and query */}
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs px-2 py-0.5 rounded ${searchTypeColors[item.searchType]}`}>
              {searchTypeLabels[item.searchType]}
            </span>
            {item.depthLevel && item.depthLevel > 0 && (
              <span className="text-xs text-purple-600 dark:text-purple-400">
                드릴다운 Lv.{item.depthLevel}
              </span>
            )}
            {!item.success && (
              <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                실패
              </span>
            )}
          </div>
          
          {/* Query */}
          <p className="font-medium text-gray-900 dark:text-gray-100 truncate" title={item.query}>
            {item.query}
          </p>
          
          {/* Stats */}
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
            <span>결과: {item.resultCount ?? 0}건</span>
            {item.credibilityScore !== undefined && (
              <span>신뢰도: {Math.round(item.credibilityScore)}%</span>
            )}
            {item.durationMs !== undefined && (
              <span>{(item.durationMs / 1000).toFixed(1)}초</span>
            )}
            <span>
              {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: ko })}
            </span>
          </div>
        </div>
        
        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => handleToggleBookmark(item.id, e)}
            className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 ${
              item.bookmarked ? 'text-yellow-500' : 'text-gray-400'
            }`}
            title={item.bookmarked ? '북마크 해제' : '북마크'}
          >
            <svg className="w-4 h-4" fill={item.bookmarked ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
          </button>
          
          {onDeriveSearch && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeriveSearch(item);
              }}
              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-blue-500"
              title="파생 검색"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
          )}
          
          <button
            onClick={(e) => handleExpand(item.id)}
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"
            title="드릴다운 기록 보기"
          >
            <svg className={`w-4 h-4 transition-transform ${expandedId === item.id ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          <button
            onClick={(e) => handleDelete(item.id, e)}
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-red-500"
            title="삭제"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
      
      {/* Expanded: Show derived searches */}
      {expandedId === item.id && derivedSearches[item.id] && derivedSearches[item.id].length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">파생 검색 ({derivedSearches[item.id].length}건)</p>
          {derivedSearches[item.id].map(derived => renderHistoryItem(derived, true))}
        </div>
      )}
    </div>
  )};

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 pb-3 mb-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            검색 기록
          </h3>
          {/* SSE connection status */}
          {enableRealtime && (
            <div className="flex items-center gap-1.5">
              <span 
                className={`w-2 h-2 rounded-full ${sseConnected ? 'bg-green-500' : 'bg-red-500'}`}
                title={sseConnected ? '실시간 연결됨' : '연결 끊김'}
              />
              <span className="text-xs text-gray-400">
                {sseConnected ? '실시간' : '오프라인'}
              </span>
            </div>
          )}
        </div>
        
        {/* Search input */}
        <form onSubmit={handleSearch} className="mb-3">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="검색 기록 검색..."
              className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
            <button
              type="submit"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          </div>
        </form>
        
        {/* Filter buttons */}
        <div className="flex flex-wrap gap-1.5">
          {(['all', 'bookmarked', 'UNIFIED', 'DEEP_SEARCH', 'FACT_CHECK', 'BROWSER_AGENT'] as const).map((f) => (
            <button
              key={f}
              onClick={() => handleFilterChange(f)}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                filter === f
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {f === 'all' ? '전체' : f === 'bookmarked' ? '북마크' : searchTypeLabels[f]}
            </button>
          ))}
        </div>
      </div>
      
      {/* Stats */}
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        총 {totalElements}건 {localHistory.length > history.length && `(+${localHistory.length - history.length} 새 항목)`}
      </div>
      
      {/* History list */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
          </div>
        ) : error ? (
          <div className="text-center py-8 text-red-500">
            <p>{error}</p>
            <button
              onClick={() => loadHistory(0)}
              className="mt-2 text-sm text-blue-500 hover:underline"
            >
              다시 시도
            </button>
          </div>
        ) : localHistory.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <p>검색 기록이 없습니다</p>
          </div>
        ) : (
          localHistory.filter(item => !item.parentSearchId).map(item => renderHistoryItem(item))
        )}
      </div>
      
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-3 border-t border-gray-200 dark:border-gray-700 mt-3">
          <button
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 0}
            className="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            이전
          </button>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {currentPage + 1} / {totalPages}
          </span>
          <button
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage >= totalPages - 1}
            className="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}

export default SearchHistoryPanel;
