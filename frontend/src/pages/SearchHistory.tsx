import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SearchHistoryPanel } from '@/components/SearchHistoryPanel';
import { DeriveSearchDialog } from '@/components/DeriveSearchDialog';
import type { SearchHistoryRecord, SearchHistoryType } from '@/lib/api';
import { getDiscoveredUrls } from '@/lib/api';

/**
 * Search History Page
 * 
 * A dedicated page for viewing and managing search history.
 * Users can filter by search type, bookmark important searches,
 * and navigate back to re-run or derive new searches.
 */
export default function SearchHistory() {
  const navigate = useNavigate();
  
  // Dialog state
  const [deriveDialogOpen, setDeriveDialogOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<SearchHistoryRecord | null>(null);
  
  // Discovered URLs state
  const [discoveredUrls, setDiscoveredUrls] = useState<string[]>([]);
  const [urlsLoading, setUrlsLoading] = useState(false);
  const [urlsError, setUrlsError] = useState<string | null>(null);
  const [showDiscoveredUrls, setShowDiscoveredUrls] = useState(false);
  const [urlsDays, setUrlsDays] = useState(7);

  // Load discovered URLs
  useEffect(() => {
    if (showDiscoveredUrls) {
      setUrlsLoading(true);
      setUrlsError(null);
      getDiscoveredUrls(urlsDays, 100)
        .then(setDiscoveredUrls)
        .catch((err) => {
          console.error('Failed to load discovered URLs:', err);
          setDiscoveredUrls([]);
          setUrlsError('URL 목록을 불러오는데 실패했습니다.');
        })
        .finally(() => setUrlsLoading(false));
    }
  }, [showDiscoveredUrls, urlsDays]);

  // Navigate to the appropriate page based on search type
  const getSearchPagePath = (searchType: SearchHistoryType): string => {
    switch (searchType) {
      case 'UNIFIED':
        return '/search';
      case 'DEEP_SEARCH':
        return '/deep-search';
      case 'FACT_CHECK':
        return '/fact-check';
      case 'BROWSER_AGENT':
        return '/ai-agent';
      default:
        return '/';
    }
  };

  // Handle selecting a search to view/re-run
  const handleSelectSearch = (search: SearchHistoryRecord) => {
    const path = getSearchPagePath(search.searchType);
    // Navigate to the search page with the query as state
    navigate(path, { 
      state: { 
        query: search.query,
        fromHistory: true,
        historyId: search.id 
      } 
    });
  };

  // Handle deriving a new search from an existing one - opens dialog
  const handleDeriveSearch = (search: SearchHistoryRecord) => {
    setSelectedRecord(search);
    setDeriveDialogOpen(true);
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          검색 기록
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          이전 검색 기록을 확인하고 재검색하거나 파생 검색을 수행할 수 있습니다.
        </p>
      </div>

      {/* Discovered URLs Section */}
      <div className="mb-4">
        <button
          onClick={() => setShowDiscoveredUrls(!showDiscoveredUrls)}
          className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          <svg
            className={`w-4 h-4 transition-transform ${showDiscoveredUrls ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          발견된 URL 목록 보기
        </button>
        
        {showDiscoveredUrls && (
          <div className="mt-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-gray-900 dark:text-gray-100">
                최근 발견된 URL ({discoveredUrls.length}건)
              </h3>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">기간:</label>
                <select
                  value={urlsDays}
                  onChange={(e) => setUrlsDays(Number(e.target.value))}
                  className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                >
                  <option value={1}>1일</option>
                  <option value={7}>7일</option>
                  <option value={14}>14일</option>
                  <option value={30}>30일</option>
                </select>
              </div>
            </div>
            
            {urlsLoading ? (
              <div className="flex items-center justify-center py-4">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
              </div>
            ) : urlsError ? (
              <div className="flex items-center gap-2 py-4 px-3 bg-red-50 dark:bg-red-900/20 rounded text-sm text-red-600 dark:text-red-400">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{urlsError}</span>
                <button
                  onClick={() => {
                    setUrlsError(null);
                    setUrlsLoading(true);
                    getDiscoveredUrls(urlsDays, 100)
                      .then(setDiscoveredUrls)
                      .catch((err) => {
                        console.error('Failed to load discovered URLs:', err);
                        setDiscoveredUrls([]);
                        setUrlsError('URL 목록을 불러오는데 실패했습니다.');
                      })
                      .finally(() => setUrlsLoading(false));
                  }}
                  className="ml-auto text-blue-600 dark:text-blue-400 hover:underline text-xs"
                >
                  다시 시도
                </button>
              </div>
            ) : discoveredUrls.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                해당 기간에 발견된 URL이 없습니다.
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-1">
                {discoveredUrls.map((url, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 py-1 px-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded text-sm"
                  >
                    <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline truncate flex-1"
                      title={url}
                    >
                      {url}
                    </a>
                    <button
                      onClick={() => navigator.clipboard.writeText(url)}
                      className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      title="URL 복사"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm p-4 min-h-[600px]">
        <SearchHistoryPanel
          onSelectSearch={handleSelectSearch}
          onDeriveSearch={handleDeriveSearch}
          className="h-full"
        />
      </div>
      
      {/* Derive Search Dialog */}
      {selectedRecord && (
        <DeriveSearchDialog
          open={deriveDialogOpen}
          onOpenChange={setDeriveDialogOpen}
          searchRecord={selectedRecord}
        />
      )}
    </div>
  );
}
