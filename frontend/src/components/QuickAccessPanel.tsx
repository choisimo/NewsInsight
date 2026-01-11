import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  X,
  History,
  Bookmark,
  Search,
  Loader2,
  ChevronRight,
  Clock,
  TrendingUp,
  Zap,
  Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSearchHistory } from '@/hooks/useSearchHistory';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { SearchHistoryRecord } from '@/lib/api';

interface QuickAccessPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSearch?: (search: SearchHistoryRecord) => void;
}

export const QuickAccessPanel = ({ isOpen, onClose, onSelectSearch }: QuickAccessPanelProps) => {
  const [quickSearchQuery, setQuickSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'recent' | 'bookmarks' | 'ml'>('recent');
  
  const {
    history,
    loading,
    loadHistory,
    loadBookmarked,
  } = useSearchHistory({ pageSize: 5 });

  useEffect(() => {
    if (isOpen) {
      if (activeTab === 'recent') {
        loadHistory(0);
      } else if (activeTab === 'bookmarks') {
        loadBookmarked(0);
      }
    }
  }, [isOpen, activeTab, loadHistory, loadBookmarked]);

  if (!isOpen) return null;

  const handleQuickSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (quickSearchQuery.trim()) {
      window.location.href = `/search?q=${encodeURIComponent(quickSearchQuery)}`;
    }
  };

  const renderSearchItem = (item: SearchHistoryRecord) => (
    <div
      key={item.id}
      className="p-3 rounded-lg border border-border hover:bg-accent/50 cursor-pointer transition-colors group"
      onClick={() => {
        onSelectSearch?.(item);
        onClose();
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{item.query}</p>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>{formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: ko })}</span>
            {item.resultCount !== undefined && (
              <>
                <span>•</span>
                <span>{item.resultCount}건</span>
              </>
            )}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[100]"
        onClick={onClose}
      />
      
      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full sm:w-96 bg-background border-l border-border shadow-2xl z-[101] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">빠른 접근</h2>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Quick Search */}
          <form onSubmit={handleQuickSearch}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={quickSearchQuery}
                onChange={(e) => setQuickSearchQuery(e.target.value)}
                placeholder="빠른 검색..."
                className="pl-9"
              />
            </div>
          </form>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-2 border-b border-border">
          <Button
            variant={activeTab === 'recent' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('recent')}
            className="flex-1"
          >
            <History className="h-4 w-4 mr-2" />
            최근 검색
          </Button>
          <Button
            variant={activeTab === 'bookmarks' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('bookmarks')}
            className="flex-1"
          >
            <Bookmark className="h-4 w-4 mr-2" />
            북마크
          </Button>
          <Button
            variant={activeTab === 'ml' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('ml')}
            className="flex-1"
          >
            <Layers className="h-4 w-4 mr-2" />
            ML
          </Button>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1 p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : activeTab === 'recent' || activeTab === 'bookmarks' ? (
            <div className="space-y-2">
              {history.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p className="text-sm">
                    {activeTab === 'recent' ? '검색 기록이 없습니다' : '북마크가 없습니다'}
                  </p>
                </div>
              ) : (
                history.map(renderSearchItem)
              )}
              
              {history.length > 0 && (
                <Link
                  to="/history"
                  className="block text-center py-2 text-sm text-primary hover:underline"
                  onClick={onClose}
                >
                  전체 보기
                </Link>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {/* ML Training Quick Access */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Layers className="h-4 w-4" />
                    ML 학습
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Link to="/ml-training" onClick={onClose}>
                    <Button variant="outline" size="sm" className="w-full justify-start">
                      <Zap className="h-4 w-4 mr-2" />
                      학습 대시보드
                    </Button>
                  </Link>
                  <Link to="/ml-results" onClick={onClose}>
                    <Button variant="outline" size="sm" className="w-full justify-start">
                      <TrendingUp className="h-4 w-4 mr-2" />
                      분석 결과
                    </Button>
                  </Link>
                </CardContent>
              </Card>

              {/* ML Addons */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">ML Add-ons</CardTitle>
                </CardHeader>
                <CardContent>
                  <Link to="/ml-addons" onClick={onClose}>
                    <Button variant="outline" size="sm" className="w-full justify-start">
                      Add-on 관리
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </div>
          )}
        </ScrollArea>

        {/* Footer - Quick Links */}
        <div className="p-4 border-t border-border space-y-2">
          <div className="text-xs text-muted-foreground mb-2">빠른 링크</div>
          <div className="grid grid-cols-2 gap-2">
            <Link to="/search" onClick={onClose}>
              <Button variant="outline" size="sm" className="w-full">
                <Search className="h-3 w-3 mr-1" />
                검색
              </Button>
            </Link>
            <Link to="/history" onClick={onClose}>
              <Button variant="outline" size="sm" className="w-full">
                <History className="h-3 w-3 mr-1" />
                기록
              </Button>
            </Link>
            <Link to="/projects" onClick={onClose}>
              <Button variant="outline" size="sm" className="w-full">
                프로젝트
              </Button>
            </Link>
            <Link to="/settings" onClick={onClose}>
              <Button variant="outline" size="sm" className="w-full">
                설정
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </>
  );
};

export default QuickAccessPanel;
