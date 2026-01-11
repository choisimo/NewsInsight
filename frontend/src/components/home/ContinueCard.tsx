/**
 * ContinueCard - 이어서 하기 카드
 * 
 * 마지막으로 진행하던 작업을 보여주고 빠르게 재개할 수 있게 함
 * - 진행 중인 Deep Search
 * - 미완료 팩트체크
 * - 최근 검색
 */

import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Layers,
  Shield,
  Search,
  Workflow,
  Link as LinkIcon,
  X,
  Loader2,
  Clock,
  Play,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useContinueWork, type ContinueWorkItem, type WorkType } from '@/hooks/useContinueWork';
import { cn } from '@/lib/utils';

// 작업 타입별 설정
const WORK_TYPE_CONFIG: Record<WorkType, {
  icon: typeof Search;
  color: string;
  bgColor: string;
  label: string;
}> = {
  deep_search: {
    icon: Layers,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50 dark:bg-purple-900/20',
    label: '심층 분석',
  },
  fact_check: {
    icon: Shield,
    color: 'text-green-600',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
    label: '팩트체크',
  },
  unified_search: {
    icon: Search,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    label: '검색',
  },
  browser_agent: {
    icon: Workflow,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50 dark:bg-orange-900/20',
    label: '브라우저 에이전트',
  },
  url_analysis: {
    icon: LinkIcon,
    color: 'text-cyan-600',
    bgColor: 'bg-cyan-50 dark:bg-cyan-900/20',
    label: 'URL 분석',
  },
};

interface ContinueCardProps {
  className?: string;
  showRecent?: boolean;
  maxItems?: number;
}

export function ContinueCard({
  className,
  showRecent = true,
  maxItems = 3,
}: ContinueCardProps) {
  const {
    lastWork,
    recentWorks,
    isLoading,
    error,
    dismissWork,
    clearAllWorks,
  } = useContinueWork();

  // 로딩 상태
  if (isLoading) {
    return (
      <Card className={cn('border-dashed', className)}>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  // 작업 없음
  if (!lastWork && recentWorks.length === 0) {
    return null;
  }

  // 에러 상태
  if (error) {
    return (
      <Card className={cn('border-destructive/50', className)}>
        <CardContent className="py-4">
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const displayWorks = showRecent
    ? recentWorks.slice(0, maxItems)
    : lastWork
      ? [lastWork]
      : [];

  return (
    <Card className={cn('border-primary/30 bg-primary/5', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            이어서 하기
          </CardTitle>
          {recentWorks.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAllWorks}
              className="text-xs text-muted-foreground h-7"
            >
              전체 지우기
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {displayWorks.map(work => (
          <WorkItem
            key={work.id}
            work={work}
            onDismiss={() => dismissWork(work.id)}
            isPrimary={work.id === lastWork?.id}
          />
        ))}
      </CardContent>
    </Card>
  );
}

// 개별 작업 아이템
interface WorkItemProps {
  work: ContinueWorkItem;
  onDismiss: () => void;
  isPrimary?: boolean;
}

function WorkItem({ work, onDismiss, isPrimary }: WorkItemProps) {
  const config = WORK_TYPE_CONFIG[work.type];
  const Icon = config.icon;

  const statusLabel = {
    in_progress: '진행 중',
    paused: '일시 정지',
    waiting: '대기 중',
    ready: '준비됨',
  }[work.status];

  return (
    <div
      className={cn(
        'relative rounded-lg p-4 transition-all',
        config.bgColor,
        isPrimary && 'ring-2 ring-primary/30'
      )}
    >
      <div className="flex items-start gap-3">
        {/* 아이콘 */}
        <div className={cn('p-2 rounded-lg bg-background/50', config.color)}>
          {work.status === 'in_progress' ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Icon className="h-5 w-5" />
          )}
        </div>

        {/* 내용 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className={cn('text-xs', config.color)}>
              {config.label}
            </Badge>
            <Badge
              variant="secondary"
              className={cn(
                'text-xs',
                work.status === 'in_progress' && 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
              )}
            >
              {statusLabel}
            </Badge>
          </div>

          <h4 className="font-medium text-sm line-clamp-1 mb-1">
            {work.title}
          </h4>

          {work.description && (
            <p className="text-xs text-muted-foreground line-clamp-1">
              {work.description}
            </p>
          )}

          {/* 진행률 표시 */}
          {work.progress !== undefined && work.status === 'in_progress' && (
            <div className="mt-2">
              <Progress value={work.progress} className="h-1.5" />
              <span className="text-xs text-muted-foreground mt-1">
                {work.progress}% 완료
              </span>
            </div>
          )}
        </div>

        {/* 액션 버튼 */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onDismiss}
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </Button>

          <Button
            asChild
            size="sm"
            variant={isPrimary ? 'default' : 'outline'}
            className="h-8 gap-1"
          >
            <Link to={work.continueUrl}>
              <Play className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">계속하기</span>
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ContinueCard;
