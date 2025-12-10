import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Play,
  Pause,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  MoreVertical,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { startCollectionForSource } from '@/lib/api/collection';
import { toast } from 'sonner';

export interface SourceInfo {
  id: number;
  name: string;
  url: string;
  sourceType: 'RSS' | 'WEB' | 'API' | 'WEBHOOK';
  active: boolean;
  lastCollectedAt?: string;
  lastError?: string;
  itemsCollectedToday?: number;
  totalItemsCollected?: number;
}

interface SourceCardProps {
  source: SourceInfo;
  /** 수집 실행 중 여부 */
  isCollecting?: boolean;
  /** 상태 변경 콜백 */
  onToggleActive?: (id: number, active: boolean) => Promise<void>;
  /** 수집 완료 콜백 */
  onCollectionComplete?: () => void;
  /** 클래스명 */
  className?: string;
}

function formatRelativeTime(dateString: string | undefined): string {
  if (!dateString) return '없음';
  
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  if (diff < 60000) return '방금 전';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
  return `${Math.floor(diff / 86400000)}일 전`;
}

function getSourceTypeColor(type: SourceInfo['sourceType']): string {
  const colors: Record<SourceInfo['sourceType'], string> = {
    RSS: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
    WEB: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    API: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
    WEBHOOK: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  };
  return colors[type];
}

/**
 * 뉴스 소스 제어 카드
 * 소스 상태 표시 및 수집 트리거 버튼 제공
 */
export function SourceCard({
  source,
  isCollecting = false,
  onToggleActive,
  onCollectionComplete,
  className,
}: SourceCardProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  const handleRunNow = async () => {
    if (isRunning || isCollecting) return;
    
    setIsRunning(true);
    try {
      await startCollectionForSource(source.id);
      toast.success(`${source.name} 수집이 시작되었습니다`);
      onCollectionComplete?.();
    } catch (e) {
      const message = e instanceof Error ? e.message : '수집 시작 실패';
      toast.error(message);
    } finally {
      setIsRunning(false);
    }
  };

  const handleToggleActive = async () => {
    if (!onToggleActive || isToggling) return;
    
    setIsToggling(true);
    try {
      await onToggleActive(source.id, !source.active);
      toast.success(source.active ? `${source.name} 비활성화됨` : `${source.name} 활성화됨`);
    } catch (e) {
      const message = e instanceof Error ? e.message : '상태 변경 실패';
      toast.error(message);
    } finally {
      setIsToggling(false);
    }
  };

  const hasError = !!source.lastError;
  const isHealthy = source.active && !hasError;

  return (
    <div className={cn(
      'rounded-lg border bg-card p-4 shadow-sm transition-all hover:shadow-md',
      !source.active && 'opacity-60',
      hasError && 'border-red-200 dark:border-red-800',
      className
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-sm truncate">{source.name}</h4>
            <Badge variant="secondary" className={cn('text-xs', getSourceTypeColor(source.sourceType))}>
              {source.sourceType}
            </Badge>
          </div>
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 mt-1 truncate"
          >
            {new URL(source.url).hostname}
            <ExternalLink className="h-3 w-3 flex-shrink-0" />
          </a>
        </div>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleToggleActive} disabled={isToggling}>
              {source.active ? (
                <>
                  <Pause className="h-4 w-4 mr-2" />
                  비활성화
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  활성화
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                사이트 열기
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Status */}
      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            마지막 수집
          </span>
          <span className={cn(
            'font-medium',
            source.lastCollectedAt ? 'text-foreground' : 'text-muted-foreground'
          )}>
            {formatRelativeTime(source.lastCollectedAt)}
          </span>
        </div>
        
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">상태</span>
          <div className="flex items-center gap-1">
            {isHealthy ? (
              <>
                <CheckCircle2 className="h-3 w-3 text-green-600" />
                <span className="text-green-600 font-medium">정상</span>
              </>
            ) : hasError ? (
              <>
                <AlertCircle className="h-3 w-3 text-red-600" />
                <span className="text-red-600 font-medium" title={source.lastError}>
                  오류
                </span>
              </>
            ) : (
              <>
                <Pause className="h-3 w-3 text-gray-500" />
                <span className="text-gray-500 font-medium">비활성</span>
              </>
            )}
          </div>
        </div>

        {source.itemsCollectedToday !== undefined && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">오늘 수집</span>
            <span className="font-medium">{source.itemsCollectedToday.toLocaleString()}건</span>
          </div>
        )}
      </div>

      {/* Error Message */}
      {hasError && (
        <div className="mt-2 p-2 rounded bg-red-50 dark:bg-red-950 text-xs text-red-600 dark:text-red-400 line-clamp-2">
          {source.lastError}
        </div>
      )}

      {/* Action Button */}
      <div className="mt-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={handleRunNow}
          disabled={!source.active || isRunning || isCollecting}
        >
          {isRunning || isCollecting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              수집 중...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              지금 수집
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

export default SourceCard;
