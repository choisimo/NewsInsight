/**
 * UsageStreakCard - 연속 사용 현황 카드
 * 
 * 사용자의 활동 통계와 연속 사용 일수를 표시
 * - 연속 사용 스트릭
 * - 주간 활동 히트맵
 * - 누적 분석 건수
 */

import {
  Flame,
  Calendar,
  TrendingUp,
  Search,
  Layers,
  Shield,
  Award,
  Target,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useUsageStreak, getDayName } from '@/hooks/useUsageStreak';
import { cn } from '@/lib/utils';

interface UsageStreakCardProps {
  className?: string;
  variant?: 'full' | 'compact';
}

export function UsageStreakCard({
  className,
  variant = 'full',
}: UsageStreakCardProps) {
  const { stats, isLoading } = useUsageStreak();

  // 로딩 상태
  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-28" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (variant === 'compact') {
    return <UsageStreakCompact stats={stats} className={className} />;
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Award className="h-4 w-4 text-yellow-500" />
          분석 활동
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 연속 사용 스트릭 */}
        <div className="flex items-center gap-4 p-3 rounded-lg bg-gradient-to-r from-orange-50 to-yellow-50 dark:from-orange-900/20 dark:to-yellow-900/20">
          <div className="p-2 rounded-full bg-orange-100 dark:bg-orange-900/30">
            <Flame className="h-6 w-6 text-orange-500" />
          </div>
          <div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-orange-600 dark:text-orange-400">
                {stats.currentStreak}
              </span>
              <span className="text-sm text-muted-foreground">일 연속</span>
            </div>
            <p className="text-xs text-muted-foreground">
              최고 기록: {stats.longestStreak}일
            </p>
          </div>
        </div>

        {/* 주간 활동 히트맵 */}
        <div>
          <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
            <Calendar className="h-4 w-4" />
            이번 주
          </h4>
          <div className="flex justify-between gap-1">
            {stats.weeklyActivity.map((day) => (
              <div key={day.date} className="flex-1 text-center">
                <div
                  className={cn(
                    'h-8 rounded-md flex items-center justify-center text-xs font-medium transition-colors',
                    day.hasActivity
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {day.hasActivity ? '✓' : '○'}
                </div>
                <span className="text-xs text-muted-foreground mt-1 block">
                  {getDayName(day.date)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 통계 요약 */}
        <div className="grid grid-cols-3 gap-3">
          <StatItem
            icon={Search}
            label="검색"
            value={stats.weeklySearchCount}
            color="text-blue-600"
          />
          <StatItem
            icon={Layers}
            label="심층분석"
            value={stats.weeklyDeepSearchCount}
            color="text-purple-600"
          />
          <StatItem
            icon={Shield}
            label="팩트체크"
            value={stats.weeklyFactCheckCount}
            color="text-green-600"
          />
        </div>

        {/* 주간 목표 진행률 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1">
              <Target className="h-4 w-4" />
              주간 목표
            </span>
            <span className="text-muted-foreground">
              {stats.weeklyTotal} / 20건
            </span>
          </div>
          <Progress
            value={Math.min((stats.weeklyTotal / 20) * 100, 100)}
            className="h-2"
          />
          {stats.weeklyTotal >= 20 && (
            <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
              <Award className="h-3 w-3" />
              목표 달성! 훌륭합니다!
            </p>
          )}
        </div>

        {/* 누적 통계 */}
        <div className="pt-3 border-t">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">총 분석 건수</span>
            <span className="font-medium">{stats.totalSearches}건</span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-muted-foreground">일 평균</span>
            <span className="font-medium">{stats.averageSearchesPerDay}건</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// 통계 아이템
interface StatItemProps {
  icon: typeof Search;
  label: string;
  value: number;
  color: string;
}

function StatItem({ icon: Icon, label, value, color }: StatItemProps) {
  return (
    <div className="text-center p-2 rounded-lg bg-muted/50">
      <Icon className={cn('h-4 w-4 mx-auto mb-1', color)} />
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

// 축약 버전
interface UsageStreakCompactProps {
  stats: ReturnType<typeof useUsageStreak>['stats'];
  className?: string;
}

function UsageStreakCompact({ stats, className }: UsageStreakCompactProps) {
  return (
    <div className={cn('flex items-center gap-4 p-3 rounded-lg bg-muted/50', className)}>
      <div className="flex items-center gap-2">
        <Flame className="h-5 w-5 text-orange-500" />
        <span className="font-bold text-lg">{stats.currentStreak}</span>
        <span className="text-sm text-muted-foreground">일 연속</span>
      </div>
      <div className="h-6 w-px bg-border" />
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm">이번 주 {stats.weeklyTotal}건</span>
      </div>
    </div>
  );
}

export default UsageStreakCard;
