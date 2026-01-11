/**
 * DailyInsightCard - 오늘의 논쟁 이슈 카드
 * 
 * 매일 갱신되는 핫 이슈를 표시하여 재방문 유도
 * - 입장 분포 시각화
 * - 빠른 분석 시작 버튼
 */

import { Link } from 'react-router-dom';
import {
  Flame,
  TrendingUp,
  ThumbsUp,
  ThumbsDown,
  Minus,
  ArrowRight,
  Zap,
  RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useTrendingTopics, type TrendingTopic } from '@/hooks/useTrendingTopics';
import { cn } from '@/lib/utils';

interface DailyInsightCardProps {
  className?: string;
}

export function DailyInsightCard({ className }: DailyInsightCardProps) {
  const { topics, isLoading, refresh } = useTrendingTopics();

  // 가장 핫한 토픽 선택
  const hotTopic = topics.find(t => t.isHot) || topics[0];

  // 로딩 상태
  if (isLoading) {
    return (
      <Card className={cn('overflow-hidden', className)}>
        <CardContent className="p-0">
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!hotTopic) {
    return null;
  }

  return (
    <Card
      className={cn(
        'overflow-hidden border-2',
        'bg-gradient-to-br from-orange-50 to-red-50',
        'dark:from-orange-900/20 dark:to-red-900/20',
        'border-orange-200 dark:border-orange-800/50',
        className
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Flame className="h-5 w-5 text-orange-500" />
            오늘의 논쟁 이슈
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            className="h-8 w-8"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 주제 */}
        <div>
          <h3 className="font-bold text-lg leading-tight mb-1">
            {hotTopic.title}
          </h3>
          {hotTopic.description && (
            <p className="text-sm text-muted-foreground">
              {hotTopic.description}
            </p>
          )}
        </div>

        {/* 입장 분포 */}
        {hotTopic.stanceDistribution && (
          <div className="space-y-2">
            {/* 분포 바 */}
            <div className="flex h-8 rounded-lg overflow-hidden shadow-inner">
              {hotTopic.stanceDistribution.proRatio > 0 && (
                <div
                  className="flex items-center justify-center bg-teal-500 text-white text-sm font-medium"
                  style={{ width: `${hotTopic.stanceDistribution.proRatio}%` }}
                >
                  {hotTopic.stanceDistribution.proRatio >= 15 && (
                    <span className="flex items-center gap-1">
                      <ThumbsUp className="h-3.5 w-3.5" />
                      {Math.round(hotTopic.stanceDistribution.proRatio)}%
                    </span>
                  )}
                </div>
              )}
              {hotTopic.stanceDistribution.neutralRatio > 0 && (
                <div
                  className="flex items-center justify-center bg-gray-400 text-white text-sm font-medium"
                  style={{ width: `${hotTopic.stanceDistribution.neutralRatio}%` }}
                >
                  {hotTopic.stanceDistribution.neutralRatio >= 15 && (
                    <span className="flex items-center gap-1">
                      <Minus className="h-3.5 w-3.5" />
                      {Math.round(hotTopic.stanceDistribution.neutralRatio)}%
                    </span>
                  )}
                </div>
              )}
              {hotTopic.stanceDistribution.conRatio > 0 && (
                <div
                  className="flex items-center justify-center bg-red-500 text-white text-sm font-medium"
                  style={{ width: `${hotTopic.stanceDistribution.conRatio}%` }}
                >
                  {hotTopic.stanceDistribution.conRatio >= 15 && (
                    <span className="flex items-center gap-1">
                      <ThumbsDown className="h-3.5 w-3.5" />
                      {Math.round(hotTopic.stanceDistribution.conRatio)}%
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* 범례 */}
            <div className="flex justify-between text-xs">
              <span className="flex items-center gap-1 text-teal-600 dark:text-teal-400">
                <ThumbsUp className="h-3 w-3" />
                찬성 {hotTopic.stanceDistribution.pro}건
              </span>
              <span className="flex items-center gap-1 text-gray-500">
                <Minus className="h-3 w-3" />
                중립 {hotTopic.stanceDistribution.neutral}건
              </span>
              <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                <ThumbsDown className="h-3 w-3" />
                반대 {hotTopic.stanceDistribution.con}건
              </span>
            </div>
          </div>
        )}

        {/* 메타 정보 & 액션 */}
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            {hotTopic.category && (
              <Badge variant="outline" className="text-xs">
                {hotTopic.category}
              </Badge>
            )}
            {hotTopic.newsCount && (
              <span className="text-xs text-muted-foreground">
                관련 뉴스 {hotTopic.newsCount}건
              </span>
            )}
          </div>

          <Button asChild size="sm" className="gap-1">
            <Link to={hotTopic.searchUrl}>
              <Zap className="h-4 w-4" />
              심층 분석 시작
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default DailyInsightCard;
