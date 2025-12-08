import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SearchHistoryPanel } from '@/components/SearchHistoryPanel';
import { DeriveSearchDialog } from '@/components/DeriveSearchDialog';
import type { SearchHistoryRecord, SearchHistoryType } from '@/lib/api';

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

  // Navigate to the appropriate page based on search type
  const getSearchPagePath = (searchType: SearchHistoryType): string => {
    switch (searchType) {
      case 'UNIFIED':
        return '/';
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
