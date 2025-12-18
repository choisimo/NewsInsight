/**
 * MCP Health Status Widget
 *
 * MCP 서버들의 상태를 모니터링하는 위젯
 */

import { useState, useEffect } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  XCircle,
  RefreshCw,
  Server,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { checkMcpHealth, type MCPHealthResponse } from '@/lib/api/mcp';

interface MCPHealthStatusProps {
  className?: string;
  refreshInterval?: number; // in milliseconds, 0 to disable auto-refresh
  compact?: boolean;
}

export function MCPHealthStatus({
  className,
  refreshInterval = 60000, // 1분
  compact = false,
}: MCPHealthStatusProps) {
  const [health, setHealth] = useState<MCPHealthResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchHealth = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await checkMcpHealth();
      setHealth(result);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MCP 상태 확인 실패');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();

    if (refreshInterval > 0) {
      const interval = setInterval(fetchHealth, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [refreshInterval]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'degraded':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case 'unhealthy':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      healthy: 'default',
      degraded: 'secondary',
      unhealthy: 'destructive',
    };
    const labels: Record<string, string> = {
      healthy: '정상',
      degraded: '성능 저하',
      unhealthy: '오류',
    };
    return (
      <Badge variant={variants[status] || 'outline'}>
        {labels[status] || status}
      </Badge>
    );
  };

  // 로딩 상태
  if (isLoading && !health) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // 에러 상태
  if (error && !health) {
    return (
      <Card className={cn('border-destructive/50', className)}>
        <CardContent className="py-4">
          <div className="flex items-center gap-2 text-destructive">
            <XCircle className="h-4 w-4" />
            <span className="text-sm">{error}</span>
          </div>
          <Button variant="outline" size="sm" onClick={fetchHealth} className="mt-2">
            <RefreshCw className="h-4 w-4 mr-2" />
            다시 시도
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Compact 버전
  if (compact && health) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-full cursor-default',
                health.status === 'healthy' && 'bg-green-100 dark:bg-green-900/30',
                health.status === 'degraded' && 'bg-yellow-100 dark:bg-yellow-900/30',
                health.status === 'unhealthy' && 'bg-red-100 dark:bg-red-900/30',
                className
              )}
            >
              {getStatusIcon(health.status)}
              <span className="text-sm font-medium">
                MCP {health.healthy}/{health.total}
              </span>
              {isLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <div className="space-y-1">
              {Object.entries(health.servers).map(([name, server]) => (
                <div key={name} className="flex items-center gap-2 text-xs">
                  {getStatusIcon(server.status)}
                  <span>{name}</span>
                  {server.latency_ms && (
                    <span className="text-muted-foreground">{server.latency_ms}ms</span>
                  )}
                </div>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Full 버전
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="h-4 w-4" />
            MCP 서버 상태
          </CardTitle>
          <div className="flex items-center gap-2">
            {getStatusBadge(health?.status || 'unknown')}
            <Button
              variant="ghost"
              size="icon"
              onClick={fetchHealth}
              disabled={isLoading}
              className="h-8 w-8"
            >
              <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
            </Button>
          </div>
        </div>
        {lastUpdated && (
          <p className="text-xs text-muted-foreground">
            마지막 업데이트: {lastUpdated.toLocaleTimeString()}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {health && (
          <div className="space-y-2">
            {Object.entries(health.servers).map(([name, server]) => (
              <div
                key={name}
                className={cn(
                  'flex items-center justify-between p-2 rounded-lg',
                  server.status === 'healthy' && 'bg-green-50 dark:bg-green-900/10',
                  server.status === 'degraded' && 'bg-yellow-50 dark:bg-yellow-900/10',
                  server.status === 'unhealthy' && 'bg-red-50 dark:bg-red-900/10'
                )}
              >
                <div className="flex items-center gap-2">
                  {getStatusIcon(server.status)}
                  <span className="text-sm font-medium">{name}</span>
                </div>
                <div className="flex items-center gap-2">
                  {server.latency_ms && (
                    <span className="text-xs text-muted-foreground">
                      {server.latency_ms}ms
                    </span>
                  )}
                  {server.error && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger>
                          <AlertCircle className="h-4 w-4 text-destructive" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs max-w-xs">{server.error}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 요약 통계 */}
        {health && (
          <div className="mt-4 pt-4 border-t flex items-center justify-center gap-4 text-sm">
            <div className="flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span>{health.healthy} 정상</span>
            </div>
            <div className="flex items-center gap-1">
              <XCircle className="h-4 w-4 text-red-500" />
              <span>{health.total - health.healthy} 오류</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default MCPHealthStatus;
