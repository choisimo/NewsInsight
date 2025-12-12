/**
 * TrendingTopics - 오늘의 트렌드
 * 
 * 실시간 트렌딩 이슈와 논쟁 주제를 표시
 * - 트렌드 스코어
 * - 입장 분포 시각화
 * - 빠른 검색 링크
 */

import { Link } from 'react-router-dom';
import {
  TrendingUp,
  Flame,
  ArrowUpRight,
  ThumbsUp,
  ThumbsDown,
  Minus,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useTrendingTopics, type TrendingTopic } from '@/hooks/useTrendingTopics';
import { cn } from '@/lib/utils';

interface TrendingTopicsProps {
  className?: string;
  maxItems?: number;
  showRefresh?: boolean;
}

export function TrendingTopics({
  className,
  maxItems = 5,
  showRefresh = true,
}: TrendingTopicsProps) {
  const { topics, isLoading, error, refresh } = useTrendingTopics();

  // 로딩 상태
  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  // 에러 상태
  if (error) {
    return (
      <Card className={cn('border-destructive/50', className)}>
        <CardContent className="py-4">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={refresh} className="mt-2">
            다시 시도
          </Button>
        </CardContent>
      </Card>
    );
  }

  const displayTopics = topics.slice(0, maxItems);

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-orange-500" />
            오늘의 트렌드
          </CardTitle>
          {showRefresh && (
            <Button
              variant="ghost"
              size="icon"
              onClick={refresh}
              className="h-8 w-8"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {displayTopics.map((topic, index) => (
          <TrendingTopicItem
            key={topic.id}
            topic={topic}
            rank={index + 1}
          />
        ))}
      </CardContent>
    </Card>
  );
}

interface TrendingTopicItemProps {
  topic: TrendingTopic;
  rank: number;
}

function TrendingTopicItem({ topic, rank }: TrendingTopicItemProps) {
  return (
    <Link
      to={topic.searchUrl}
      className={cn(
        'block p-3 rounded-lg transition-all',
        'hover:bg-muted/50 group'
      )}
    >
      <div className="flex items-start gap-3">
        {/* 순위 */}
        <div
          className={cn(
            'flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
            rank <= 3
              ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400'
              : 'bg-muted text-muted-foreground'
          )}
        >
          {rank}
        </div>

        {/* 내용 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-medium text-sm line-clamp-1 group-hover:text-primary transition-colors">
              {topic.title}
            </h4>
            {topic.isHot && (
              <Flame className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
            )}
            {topic.isRising && !topic.isHot && (
              <ArrowUpRight className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
            )}
          </div>

          {/* 입장 분포 바 */}
          {topic.stanceDistribution && (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-muted flex">
                {topic.stanceDistribution.proRatio > 0 && (
                  <div
                    className="h-full bg-teal-500"
                    style={{ width: `${topic.stanceDistribution.proRatio}%` }}
                  />
                )}
                {topic.stanceDistribution.neutralRatio > 0 && (
                  <div
                    className="h-full bg-gray-400"
                    style={{ width: `${topic.stanceDistribution.neutralRatio}%` }}
                  />
                )}
                {topic.stanceDistribution.conRatio > 0 && (
                  <div
                    className="h-full bg-red-500"
                    style={{ width: `${topic.stanceDistribution.conRatio}%` }}
                  />
                )}
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {topic.newsCount ? `${topic.newsCount}건` : ''}
              </span>
            </div>
          )}

          {/* 카테고리 */}
          {topic.category && (
            <Badge variant="outline" className="mt-1.5 text-xs">
              {topic.category}
            </Badge>
          )}
        </div>

        {/* 링크 아이콘 */}
        <ExternalLink
          className={cn(
            'h-4 w-4 text-muted-foreground/0',
            'group-hover:text-muted-foreground transition-colors'
          )}
        />
      </div>
    </Link>
  );
}

// 축약 버전 (홈 사이드바용)
interface TrendingTopicsCompactProps {
  className?: string;
  maxItems?: number;
}

export function TrendingTopicsCompact({
  className,
  maxItems = 5,
}: TrendingTopicsCompactProps) {
  const { topics, isLoading } = useTrendingTopics();

  if (isLoading) {
    return (
      <div className={cn('space-y-2', className)}>
        {[1, 2, 3].map(i => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className={cn('space-y-1', className)}>
      {topics.slice(0, maxItems).map((topic, index) => (
        <Link
          key={topic.id}
          to={topic.searchUrl}
          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted transition-colors"
        >
          <span
            className={cn(
              'text-xs font-medium w-4',
              index < 3 ? 'text-orange-500' : 'text-muted-foreground'
            )}
          >
            {index + 1}
          </span>
          <span className="text-sm line-clamp-1 flex-1">{topic.title}</span>
          {topic.isHot && <Flame className="h-3 w-3 text-red-500" />}
        </Link>
      ))}
    </div>
  );
}

export default TrendingTopics;
