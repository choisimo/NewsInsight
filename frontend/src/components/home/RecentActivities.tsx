/**
 * RecentActivities - 최근 활동 내역
 * 
 * 백엔드에서 직접 통합 검색, Deep Search, 팩트체크, URL 분석 등의
 * 작업 내역을 가져와서 페이지네이션과 함께 표시합니다.
 */

import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  History,
  Search,
  Brain,
  Shield,
  Bot,
  Link as LinkIcon,
  ArrowRight,
  Clock,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Filter,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ExternalLink,
  MoreHorizontal,
  Bookmark,
  BookmarkCheck,
  Eye,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  listSearchHistory,
  toggleSearchBookmark,
  type SearchHistoryRecord,
  type SearchHistoryType,
  type PageResponse,
} from '@/lib/api';
import { cn } from '@/lib/utils';

// 검색 타입별 설정
const SEARCH_TYPE_CONFIG: Record<SearchHistoryType, {
  icon: typeof Search;
  color: string;
  bgColor: string;
  label: string;
  labelKo: string;
}> = {
  UNIFIED: {
    icon: Search,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    label: 'UNIFIED',
    labelKo: '통합 검색',
  },
  DEEP_SEARCH: {
    icon: Brain,
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-100 dark:bg-purple-900/30',
    label: 'DEEP',
    labelKo: '심층 분석',
  },
  FACT_CHECK: {
    icon: Shield,
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    label: 'FACT',
    labelKo: '팩트체크',
  },
  BROWSER_AGENT: {
    icon: Bot,
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-100 dark:bg-orange-900/30',
    label: 'AGENT',
    labelKo: 'URL 분석',
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

// 날짜 포맷
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface RecentActivitiesProps {
  className?: string;
  pageSize?: number;
  showFilters?: boolean;
  showHeader?: boolean;
  compact?: boolean;
}

export function RecentActivities({
  className,
  pageSize = 5,
  showFilters = true,
  showHeader = true,
  compact = false,
}: RecentActivitiesProps) {
  const navigate = useNavigate();
  
  // State
  const [activities, setActivities] = useState<SearchHistoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [totalElements, setTotalElements] = useState(0);
  
  // Filter state
  const [selectedType, setSelectedType] = useState<SearchHistoryType | 'ALL'>('ALL');

  // Fetch activities from backend
  const fetchActivities = useCallback(async (page: number = 0, refresh: boolean = false) => {
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const typeFilter = selectedType === 'ALL' ? undefined : selectedType;
      const response: PageResponse<SearchHistoryRecord> = await listSearchHistory(
        page,
        pageSize,
        'createdAt',
        'DESC',
        typeFilter
      );

      setActivities(response.content);
      setTotalPages(response.totalPages);
      setTotalElements(response.totalElements);
      setCurrentPage(page);
    } catch (err) {
      console.error('Failed to fetch activities:', err);
      setError('활동 내역을 불러오는데 실패했습니다.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [pageSize, selectedType]);

  // Initial load and refetch when filter changes
  useEffect(() => {
    fetchActivities(0);
  }, [fetchActivities]);

  // Handle bookmark toggle
  const handleToggleBookmark = async (id: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await toggleSearchBookmark(id);
      // Update local state
      setActivities(prev => prev.map(a => 
        a.id === id ? { ...a, bookmarked: !a.bookmarked } : a
      ));
    } catch (err) {
      console.error('Failed to toggle bookmark:', err);
    }
  };

  // Navigate to detail page based on search type
  const handleItemClick = (activity: SearchHistoryRecord) => {
    const routeMap: Record<SearchHistoryType, string> = {
      UNIFIED: `/search?q=${encodeURIComponent(activity.query)}`,
      DEEP_SEARCH: `/deep-search?q=${encodeURIComponent(activity.query)}`,
      FACT_CHECK: `/fact-check?q=${encodeURIComponent(activity.query)}`,
      BROWSER_AGENT: `/browser-agent?historyId=${activity.id}`,
    };
    navigate(routeMap[activity.searchType] || `/search?q=${encodeURIComponent(activity.query)}`);
  };

  // Pagination handlers
  const goToPage = (page: number) => {
    if (page >= 0 && page < totalPages) {
      fetchActivities(page);
    }
  };

  // Loading skeleton
  if (isLoading && !isRefreshing) {
    return (
      <Card className={className}>
        {showHeader && (
          <CardHeader className="pb-3">
            <Skeleton className="h-6 w-32" />
          </CardHeader>
        )}
        <CardContent className="space-y-3">
          {Array.from({ length: pageSize }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      {/* Header */}
      {showHeader && (
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4" />
              최근 활동 내역
              {totalElements > 0 && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  {totalElements}건
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => fetchActivities(currentPage, true)}
                      disabled={isRefreshing}
                    >
                      <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>새로고침</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button variant="ghost" size="sm" asChild className="text-xs h-8">
                <Link to="/history">
                  전체 보기
                  <ArrowRight className="h-3 w-3 ml-1" />
                </Link>
              </Button>
            </div>
          </div>
        </CardHeader>
      )}

      <CardContent className="space-y-4">
        {/* Filters */}
        {showFilters && (
          <Tabs
            value={selectedType}
            onValueChange={(v) => setSelectedType(v as SearchHistoryType | 'ALL')}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-5 h-9">
              <TabsTrigger value="ALL" className="text-xs px-2">전체</TabsTrigger>
              <TabsTrigger value="UNIFIED" className="text-xs px-2">검색</TabsTrigger>
              <TabsTrigger value="DEEP_SEARCH" className="text-xs px-2">심층분석</TabsTrigger>
              <TabsTrigger value="FACT_CHECK" className="text-xs px-2">팩트체크</TabsTrigger>
              <TabsTrigger value="BROWSER_AGENT" className="text-xs px-2">URL분석</TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {/* Error state */}
        {error && (
          <div className="flex items-center justify-center py-6 text-destructive">
            <AlertCircle className="h-4 w-4 mr-2" />
            <span className="text-sm">{error}</span>
            <Button
              variant="link"
              size="sm"
              onClick={() => fetchActivities(0)}
              className="ml-2"
            >
              다시 시도
            </Button>
          </div>
        )}

        {/* Empty state */}
        {!error && activities.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <History className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">아직 활동 내역이 없습니다</p>
            <p className="text-xs mt-1">검색, 심층분석, 팩트체크 등을 시작해보세요</p>
          </div>
        )}

        {/* Activity list */}
        {!error && activities.length > 0 && (
          <div className="space-y-2">
            {activities.map((activity) => (
              <ActivityItem
                key={activity.id}
                activity={activity}
                compact={compact}
                onClick={() => handleItemClick(activity)}
                onBookmarkToggle={handleToggleBookmark}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {!error && totalPages > 1 && (
          <div className="flex items-center justify-between pt-2 border-t">
            <span className="text-xs text-muted-foreground">
              {currentPage * pageSize + 1}-{Math.min((currentPage + 1) * pageSize, totalElements)} / {totalElements}건
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 0}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              
              {/* Page numbers */}
              <div className="flex items-center gap-1 mx-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) {
                    pageNum = i;
                  } else if (currentPage < 3) {
                    pageNum = i;
                  } else if (currentPage > totalPages - 4) {
                    pageNum = totalPages - 5 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }
                  return (
                    <Button
                      key={pageNum}
                      variant={currentPage === pageNum ? "default" : "ghost"}
                      size="icon"
                      className="h-8 w-8 text-xs"
                      onClick={() => goToPage(pageNum)}
                    >
                      {pageNum + 1}
                    </Button>
                  );
                })}
              </div>
              
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage >= totalPages - 1}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Activity item component
interface ActivityItemProps {
  activity: SearchHistoryRecord;
  compact?: boolean;
  onClick: () => void;
  onBookmarkToggle: (id: number, e: React.MouseEvent) => void;
}

function ActivityItem({ activity, compact, onClick, onBookmarkToggle }: ActivityItemProps) {
  const config = SEARCH_TYPE_CONFIG[activity.searchType] || SEARCH_TYPE_CONFIG.UNIFIED;
  const Icon = config.icon;

  // Status indicator
  const getStatusInfo = () => {
    if (activity.success === false || activity.errorMessage) {
      return { icon: XCircle, color: 'text-destructive', label: '실패' };
    }
    if (activity.resultCount !== undefined && activity.resultCount > 0) {
      return { icon: CheckCircle2, color: 'text-green-600', label: '완료' };
    }
    return null;
  };

  const statusInfo = getStatusInfo();

  return (
    <div
      onClick={onClick}
      className={cn(
        'flex items-start gap-3 p-3 rounded-lg transition-all cursor-pointer',
        'bg-card hover:bg-muted/50 border border-transparent hover:border-border',
        'group'
      )}
    >
      {/* Type icon */}
      <div className={cn(
        'flex-shrink-0 h-10 w-10 rounded-lg flex items-center justify-center',
        config.bgColor
      )}>
        <Icon className={cn('h-5 w-5', config.color)} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {/* Query */}
            <p className="text-sm font-medium line-clamp-1 group-hover:text-primary transition-colors">
              {activity.query}
            </p>
            
            {/* Meta info */}
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
              {/* Type badge */}
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">
                {config.labelKo}
              </Badge>
              
              {/* Result count */}
              {activity.resultCount !== undefined && activity.resultCount > 0 && (
                <span className="flex items-center gap-1">
                  <Eye className="h-3 w-3" />
                  {activity.resultCount}건
                </span>
              )}
              
              {/* Credibility score */}
              {activity.credibilityScore !== undefined && (
                <span className={cn(
                  'flex items-center gap-1 font-medium',
                  activity.credibilityScore >= 70 ? 'text-green-600' :
                  activity.credibilityScore >= 40 ? 'text-yellow-600' : 'text-red-600'
                )}>
                  신뢰도 {activity.credibilityScore.toFixed(0)}%
                </span>
              )}
              
              {/* Status */}
              {statusInfo && (
                <span className={cn('flex items-center gap-1', statusInfo.color)}>
                  <statusInfo.icon className="h-3 w-3" />
                  {statusInfo.label}
                </span>
              )}
              
              {/* Time */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatRelativeTime(activity.createdAt)}
                  </TooltipTrigger>
                  <TooltipContent>
                    {formatDate(activity.createdAt)}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={(e) => onBookmarkToggle(activity.id, e)}
                  >
                    {activity.bookmarked ? (
                      <BookmarkCheck className="h-4 w-4 text-primary" />
                    ) : (
                      <Bookmark className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {activity.bookmarked ? '북마크 해제' : '북마크'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onClick(); }}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  상세 보기
                </DropdownMenuItem>
                <DropdownMenuItem onClick={(e) => { 
                  e.stopPropagation(); 
                  navigator.clipboard.writeText(activity.query);
                }}>
                  복사
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  onClick={(e) => onBookmarkToggle(activity.id, e)}
                >
                  {activity.bookmarked ? (
                    <>
                      <BookmarkCheck className="h-4 w-4 mr-2" />
                      북마크 해제
                    </>
                  ) : (
                    <>
                      <Bookmark className="h-4 w-4 mr-2" />
                      북마크
                    </>
                  )}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Tags */}
        {activity.tags && activity.tags.length > 0 && !compact && (
          <div className="flex items-center gap-1 mt-2 flex-wrap">
            {activity.tags.slice(0, 3).map((tag, idx) => (
              <Badge key={idx} variant="secondary" className="text-[10px] px-1.5 py-0">
                {tag}
              </Badge>
            ))}
            {activity.tags.length > 3 && (
              <span className="text-[10px] text-muted-foreground">
                +{activity.tags.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default RecentActivities;
