/**
 * RecentSearches - 최근 검색
 * 
 * 사용자의 최근 검색 기록을 표시
 * - 빠른 재검색
 * - 검색 타입별 구분
 */

import { Link } from 'react-router-dom';
import {
  History,
  Search,
  Brain,
  Shield,
  Bot,
  Link as LinkIcon,
  ArrowRight,
  Clock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useSearchHistory, type SearchHistoryType } from '@/lib/api';
import { cn } from '@/lib/utils';

// 검색 타입별 설정
const SEARCH_TYPE_CONFIG: Record<SearchHistoryType, {
  icon: typeof Search;
  color: string;
  label: string;
}> = {
  UNIFIED: {
    icon: Search,
    color: 'text-blue-600',
    label: '검색',
  },
  DEEP_SEARCH: {
    icon: Brain,
    color: 'text-purple-600',
    label: '심층분석',
  },
  FACT_CHECK: {
    icon: Shield,
    color: 'text-green-600',
    label: '팩트체크',
  },
  BROWSER_AGENT: {
    icon: Bot,
    color: 'text-orange-600',
    label: '에이전트',
  },
};

// 상대적 시간 표시
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return '방금 전';
  if (diffMinutes < 60) return `${diffMinutes}분 전`;
  if (diffHours < 24) return `${diffHours}시간 전`;
  if (diffDays < 7) return `${diffDays}일 전`;
  return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

interface RecentSearchItem {
  id: number;
  query: string;
  searchType: SearchHistoryType;
  resultCount?: number;
  createdAt: string;
}

interface RecentSearchesProps {
  className?: string;
  maxItems?: number;
  searches?: RecentSearchItem[];
  isLoading?: boolean;
}

export function RecentSearches({
  className,
  maxItems = 5,
  searches = [],
  isLoading = false,
}: RecentSearchesProps) {
  // 로딩 상태
  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent className="space-y-2">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  // 검색 기록 없음
  if (searches.length === 0) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" />
            최근 검색
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            아직 검색 기록이 없습니다
          </p>
        </CardContent>
      </Card>
    );
  }

  const displaySearches = searches.slice(0, maxItems);

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" />
            최근 검색
          </CardTitle>
          <Button variant="ghost" size="sm" asChild className="text-xs h-7">
            <Link to="/workspace/history">
              전체 보기
              <ArrowRight className="h-3 w-3 ml-1" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {displaySearches.map(search => (
          <RecentSearchItem key={search.id} search={search} />
        ))}
      </CardContent>
    </Card>
  );
}

interface RecentSearchItemProps {
  search: RecentSearchItem;
}

function RecentSearchItem({ search }: RecentSearchItemProps) {
  const config = SEARCH_TYPE_CONFIG[search.searchType] || SEARCH_TYPE_CONFIG.UNIFIED;
  const Icon = config.icon;

  // 검색 타입에 따른 URL 생성
  const getSearchUrl = () => {
    const modeMap: Record<SearchHistoryType, string> = {
      UNIFIED: '',
      DEEP_SEARCH: 'mode=deep',
      FACT_CHECK: 'mode=factcheck',
      BROWSER_AGENT: '',
    };
    const mode = modeMap[search.searchType];
    const query = `q=${encodeURIComponent(search.query)}`;
    return mode ? `/?${mode}&${query}` : `/?${query}`;
  };

  return (
    <Link
      to={getSearchUrl()}
      className={cn(
        'flex items-center gap-3 p-2 rounded-lg transition-colors',
        'hover:bg-muted group'
      )}
    >
      {/* 아이콘 */}
      <Icon className={cn('h-4 w-4 flex-shrink-0', config.color)} />

      {/* 쿼리 */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium line-clamp-1 group-hover:text-primary transition-colors">
          {search.query}
        </p>
      </div>

      {/* 메타 정보 */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-shrink-0">
        {search.resultCount !== undefined && (
          <span>{search.resultCount}건</span>
        )}
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatRelativeTime(search.createdAt)}
        </span>
      </div>
    </Link>
  );
}

// 축약 버전 (홈 사이드바용)
interface RecentSearchesCompactProps {
  className?: string;
  searches?: RecentSearchItem[];
  maxItems?: number;
}

export function RecentSearchesCompact({
  className,
  searches = [],
  maxItems = 5,
}: RecentSearchesCompactProps) {
  if (searches.length === 0) {
    return (
      <p className={cn('text-sm text-muted-foreground text-center py-2', className)}>
        최근 검색 없음
      </p>
    );
  }

  return (
    <div className={cn('space-y-1', className)}>
      {searches.slice(0, maxItems).map(search => {
        const config = SEARCH_TYPE_CONFIG[search.searchType] || SEARCH_TYPE_CONFIG.UNIFIED;
        const Icon = config.icon;

        return (
          <Link
            key={search.id}
            to={`/?q=${encodeURIComponent(search.query)}`}
            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted transition-colors"
          >
            <Icon className={cn('h-3.5 w-3.5', config.color)} />
            <span className="text-sm line-clamp-1 flex-1">{search.query}</span>
          </Link>
        );
      })}
    </div>
  );
}

export default RecentSearches;
