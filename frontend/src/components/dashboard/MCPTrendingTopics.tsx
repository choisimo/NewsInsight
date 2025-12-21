/**
 * MCP Trending Topics Widget
 *
 * MCP Topic Server에서 가져온 트렌딩 토픽을 표시
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Flame,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { getTrendingTopics, type MCPAddonResponse } from '@/lib/api/mcp';

interface Topic {
  topic: string;
  count: number;
  trend: 'up' | 'down' | 'stable';
  category?: string;
  change?: number;
}

interface MCPTrendingTopicsProps {
  className?: string;
  maxItems?: number;
  days?: number;
  onTopicClick?: (topic: string) => void;
  showRefresh?: boolean;
}

export function MCPTrendingTopics({
  className,
  maxItems = 10,
  days = 1,
  onTopicClick,
  showRefresh = true,
}: MCPTrendingTopicsProps) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTopics = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await getTrendingTopics(days, maxItems);
      if (result.success && result.data) {
        const topicsData = result.data as { topics?: Topic[] };
        setTopics(topicsData.topics || []);
      } else {
        setError(result.error || '토픽을 불러올 수 없습니다');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '트렌딩 토픽 로드 실패');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTopics();
  }, [days, maxItems]);

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'up':
        return <TrendingUp className="h-3 w-3 text-green-500" />;
      case 'down':
        return <TrendingDown className="h-3 w-3 text-red-500" />;
      default:
        return <Minus className="h-3 w-3 text-gray-400" />;
    }
  };

  const handleTopicClick = (topic: string, e: React.MouseEvent) => {
    if (onTopicClick) {
      e.preventDefault();
      onTopicClick(topic);
    }
  };

  // 로딩 상태
  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <Skeleton className="h-5 w-32" />
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  // 에러 상태
  if (error) {
    return (
      <Card className={cn('border-yellow-500/50', className)}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-orange-500" />
            트렌딩 토픽
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-2">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchTopics}>
            <RefreshCw className="h-4 w-4 mr-2" />
            다시 시도
          </Button>
        </CardContent>
      </Card>
    );
  }

  // 빈 상태
  if (topics.length === 0) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-orange-500" />
            트렌딩 토픽
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6 text-muted-foreground">
            <TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">트렌딩 토픽이 없습니다</p>
            <p className="text-xs mt-1">분석할 데이터가 충분히 쌓이면 표시됩니다</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-orange-500" />
            트렌딩 토픽
            <Badge variant="secondary" className="text-xs">
              최근 {days}일
            </Badge>
          </CardTitle>
          {showRefresh && (
            <Button
              variant="ghost"
              size="icon"
              onClick={fetchTopics}
              className="h-8 w-8"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {topics.slice(0, maxItems).map((topic, index) => (
          <Link
            key={topic.topic}
            to={`/search?q=${encodeURIComponent(topic.topic)}`}
            onClick={(e) => handleTopicClick(topic.topic, e)}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
              'hover:bg-muted group'
            )}
          >
            {/* 순위 */}
            <div
              className={cn(
                'flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
                index < 3
                  ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              {index + 1}
            </div>

            {/* 토픽 정보 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                  {topic.topic}
                </span>
                {index < 3 && topic.trend === 'up' && (
                  <Flame className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                )}
              </div>
              {topic.category && (
                <span className="text-xs text-muted-foreground">{topic.category}</span>
              )}
            </div>

            {/* 트렌드 & 카운트 */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {getTrendIcon(topic.trend)}
              <span className="text-xs text-muted-foreground">{topic.count}건</span>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

// Compact 버전
interface MCPTrendingTopicsCompactProps {
  className?: string;
  maxItems?: number;
  onTopicClick?: (topic: string) => void;
}

export function MCPTrendingTopicsCompact({
  className,
  maxItems = 5,
  onTopicClick,
}: MCPTrendingTopicsCompactProps) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchTopics = async () => {
      try {
        const result = await getTrendingTopics(1, maxItems);
        if (result.success && result.data) {
          const topicsData = result.data as { topics?: Topic[] };
          setTopics(topicsData.topics || []);
        }
      } catch {
        // Silent fail for compact version
      } finally {
        setIsLoading(false);
      }
    };
    fetchTopics();
  }, [maxItems]);

  if (isLoading) {
    return (
      <div className={cn('space-y-2', className)}>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  if (topics.length === 0) {
    return null;
  }

  return (
    <div className={cn('space-y-1', className)}>
      {topics.slice(0, maxItems).map((topic, index) => (
        <button
          key={topic.topic}
          onClick={() => onTopicClick?.(topic.topic)}
          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted transition-colors w-full text-left"
        >
          <span
            className={cn(
              'text-xs font-medium w-4',
              index < 3 ? 'text-orange-500' : 'text-muted-foreground'
            )}
          >
            {index + 1}
          </span>
          <span className="text-sm line-clamp-1 flex-1">{topic.topic}</span>
          {index < 3 && topic.trend === 'up' && (
            <Flame className="h-3 w-3 text-red-500" />
          )}
        </button>
      ))}
    </div>
  );
}

export default MCPTrendingTopics;
