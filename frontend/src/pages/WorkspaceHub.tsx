/**
 * WorkspaceHub - 내 작업 허브 페이지
 * 
 * 사용자의 모든 작업을 한눈에 보여줍니다.
 * - 검색 기록 (백엔드 API 연동)
 * - URL 컬렉션
 * - 최근 분석 결과
 */

import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  FolderOpen,
  History,
  Globe,
  Clock,
  ArrowRight,
  FileText,
  Star,
  TrendingUp,
  Calendar,
  AlertCircle,
} from 'lucide-react';
import { useContinueWork } from '@/hooks/useContinueWork';
import { useUsageStreak } from '@/hooks/useUsageStreak';
import { useEffect, useState } from 'react';
import { getSearchStatistics, listSearchHistory, getBookmarkedSearches } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

interface QuickAccessCardProps {
  to: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  count?: number;
  lastUpdated?: Date;
  isLoading?: boolean;
}

function QuickAccessCard({ to, icon, title, description, count, lastUpdated, isLoading }: QuickAccessCardProps) {
  return (
    <Link to={to} className="block group">
      <Card className="h-full transition-all hover:shadow-md hover:border-primary/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="p-2 rounded-lg bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
              {icon}
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 -translate-x-2 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
          </div>
        </CardHeader>
        <CardContent>
          <h3 className="font-semibold mb-1">{title}</h3>
          <p className="text-sm text-muted-foreground mb-3">{description}</p>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            {isLoading ? (
              <Skeleton className="h-4 w-16" />
            ) : (
              count !== undefined && <span>{count}개 항목</span>
            )}
            {lastUpdated && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDistanceToNow(lastUpdated, { addSuffix: true, locale: ko })}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

interface WorkspaceStats {
  searchHistoryCount: number;
  bookmarkedCount: number;
  recentSearchDate?: Date;
  isLoading: boolean;
  error: string | null;
}

export function WorkspaceHub() {
  const { recentWorks } = useContinueWork();
  const { streak, weeklyStats, totalSearches } = useUsageStreak();
  
  const [stats, setStats] = useState<WorkspaceStats>({
    searchHistoryCount: 0,
    bookmarkedCount: 0,
    isLoading: true,
    error: null,
  });

  // 백엔드에서 실제 통계 로드
  useEffect(() => {
    const loadStats = async () => {
      try {
        const [historyResponse, bookmarkedResponse] = await Promise.all([
          listSearchHistory(0, 1), // 총 개수만 확인
          getBookmarkedSearches(0, 1),
        ]);
        
        // 가장 최근 검색 날짜
        let recentDate: Date | undefined;
        if (historyResponse.content.length > 0) {
          recentDate = new Date(historyResponse.content[0].createdAt);
        }
        
        setStats({
          searchHistoryCount: historyResponse.totalElements || 0,
          bookmarkedCount: bookmarkedResponse.totalElements || 0,
          recentSearchDate: recentDate,
          isLoading: false,
          error: null,
        });
      } catch (error) {
        console.error('Failed to load workspace stats:', error);
        setStats(prev => ({
          ...prev,
          isLoading: false,
          error: '통계를 불러오는데 실패했습니다',
        }));
      }
    };
    
    loadStats();
  }, []);

  return (
    <div className="container py-8 px-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">내 작업</h1>
          <p className="text-muted-foreground">
            검색 기록, 저장된 분석을 관리하세요
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/search">
            <Button>
              새 검색 시작
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Overview - 백엔드 데이터 기반 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <History className="h-5 w-5 text-green-500" />
              </div>
              <div>
                {stats.isLoading ? (
                  <Skeleton className="h-8 w-12" />
                ) : (
                  <p className="text-2xl font-bold">{stats.searchHistoryCount}</p>
                )}
                <p className="text-xs text-muted-foreground">검색 기록</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/10">
                <Star className="h-5 w-5 text-yellow-500" />
              </div>
              <div>
                {stats.isLoading ? (
                  <Skeleton className="h-8 w-12" />
                ) : (
                  <p className="text-2xl font-bold">{stats.bookmarkedCount}</p>
                )}
                <p className="text-xs text-muted-foreground">북마크</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <Globe className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalSearches}</p>
                <p className="text-xs text-muted-foreground">이번 주 검색</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <TrendingUp className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{streak}일</p>
                <p className="text-xs text-muted-foreground">연속 사용</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Error Message */}
      {stats.error && (
        <Card className="mb-6 border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{stats.error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Quick Access */}
          <div>
            <h2 className="text-lg font-semibold mb-4">빠른 접근</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <QuickAccessCard
                to="/history"
                icon={<History className="h-5 w-5" />}
                title="검색 기록"
                description="최근 검색 내역"
                count={stats.searchHistoryCount}
                lastUpdated={stats.recentSearchDate}
                isLoading={stats.isLoading}
              />
              <QuickAccessCard
                to="/url-collections"
                icon={<Globe className="h-5 w-5" />}
                title="URL 컬렉션"
                description="저장된 URL 원천"
              />
              <QuickAccessCard
                to="/ai-jobs"
                icon={<FileText className="h-5 w-5" />}
                title="AI 분석 작업"
                description="AI 분석 작업 히스토리"
              />
              <QuickAccessCard
                to="/projects"
                icon={<FolderOpen className="h-5 w-5" />}
                title="프로젝트"
                description="분석 프로젝트 (준비 중)"
              />
            </div>
          </div>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">최근 활동</CardTitle>
              <CardDescription>최근에 작업한 내역</CardDescription>
            </CardHeader>
            <CardContent>
              {recentWorks.length > 0 ? (
                <div className="space-y-3">
                  {recentWorks.slice(0, 5).map((work, idx) => (
                    <Link
                      key={idx}
                      to={work.path}
                      className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent transition-colors"
                    >
                      <div className="p-2 rounded bg-muted">
                        {work.type === 'search' && <History className="h-4 w-4" />}
                        {work.type === 'project' && <FolderOpen className="h-4 w-4" />}
                        {work.type === 'analysis' && <FileText className="h-4 w-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{work.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(work.timestamp, { addSuffix: true, locale: ko })}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {work.type === 'search' && '검색'}
                        {work.type === 'project' && '프로젝트'}
                        {work.type === 'analysis' && '분석'}
                      </Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>아직 활동 내역이 없습니다</p>
                  <Link to="/search">
                    <Button variant="link" className="mt-2">
                      첫 검색 시작하기
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Usage Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                사용 현황
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>연속 사용</span>
                  <span className="font-medium">{streak}일</span>
                </div>
                <Progress value={Math.min(streak * 10, 100)} className="h-2" />
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>이번 주 검색</span>
                  <span className="font-medium">{totalSearches}회</span>
                </div>
              </div>
              
              {/* Weekly Activity */}
              <div>
                <p className="text-sm text-muted-foreground mb-2">주간 활동</p>
                <div className="flex gap-1">
                  {['월', '화', '수', '목', '금', '토', '일'].map((day, idx) => {
                    const stat = weeklyStats[idx];
                    const intensity = stat?.count ? Math.min(stat.count / 5, 1) : 0;
                    return (
                      <div
                        key={day}
                        className="flex-1 flex flex-col items-center gap-1"
                      >
                        <div
                          className="w-full h-6 rounded"
                          style={{
                            backgroundColor: intensity > 0
                              ? `rgba(34, 197, 94, ${0.2 + intensity * 0.8})`
                              : 'rgb(229, 231, 235)',
                          }}
                        />
                        <span className="text-[10px] text-muted-foreground">{day}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Bookmarks */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Star className="h-4 w-4" />
                북마크
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stats.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : stats.bookmarkedCount > 0 ? (
                <div className="text-center py-2">
                  <p className="text-sm text-muted-foreground mb-2">
                    {stats.bookmarkedCount}개의 북마크
                  </p>
                  <Link to="/history?bookmarked=true">
                    <Button variant="outline" size="sm">
                      북마크 보기
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="text-center py-4 text-muted-foreground">
                  <Star className="h-6 w-6 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">북마크한 검색이 없습니다</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                빠른 작업
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link to="/search" className="block">
                <Button variant="outline" className="w-full justify-start">
                  <History className="h-4 w-4 mr-2" />
                  새 검색 시작
                </Button>
              </Link>
              <Link to="/smart-search" className="block">
                <Button variant="outline" className="w-full justify-start">
                  <FileText className="h-4 w-4 mr-2" />
                  스마트 검색
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default WorkspaceHub;
