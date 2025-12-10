import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { 
  FileText, 
  RefreshCw, 
  AlertCircle, 
  CheckCircle2, 
  Clock,
  Zap,
  Database,
  Activity
} from 'lucide-react';
import type { ActivityLogEntry, DashboardEventType } from '@/hooks/useDashboardEvents';
import { ScrollArea } from '@/components/ui/scroll-area';

interface LiveStreamProps {
  /** 활동 로그 목록 */
  logs: ActivityLogEntry[];
  /** 연결 상태 */
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  /** 최대 표시 개수 */
  maxVisible?: number;
  /** 제목 */
  title?: string;
  /** 클래스명 */
  className?: string;
  /** 로그 클리어 핸들러 */
  onClear?: () => void;
}

const eventTypeConfig: Record<DashboardEventType, {
  icon: React.ReactNode;
  color: string;
  bgColor: string;
}> = {
  HEARTBEAT: {
    icon: <Activity className="h-3 w-3" />,
    color: 'text-gray-500',
    bgColor: 'bg-gray-50 dark:bg-gray-900',
  },
  NEW_DATA: {
    icon: <FileText className="h-3 w-3" />,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 dark:bg-blue-950',
  },
  SOURCE_UPDATED: {
    icon: <RefreshCw className="h-3 w-3" />,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50 dark:bg-purple-950',
  },
  STATS_UPDATED: {
    icon: <Database className="h-3 w-3" />,
    color: 'text-green-600',
    bgColor: 'bg-green-50 dark:bg-green-950',
  },
  COLLECTION_STARTED: {
    icon: <Zap className="h-3 w-3" />,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50 dark:bg-yellow-950',
  },
  COLLECTION_COMPLETED: {
    icon: <CheckCircle2 className="h-3 w-3" />,
    color: 'text-green-600',
    bgColor: 'bg-green-50 dark:bg-green-950',
  },
  ERROR: {
    icon: <AlertCircle className="h-3 w-3" />,
    color: 'text-red-600',
    bgColor: 'bg-red-50 dark:bg-red-950',
  },
};

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  if (diff < 5000) return '방금';
  if (diff < 60000) return `${Math.floor(diff / 1000)}초 전`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
  return date.toLocaleDateString('ko-KR');
}

function LogEntry({ log }: { log: ActivityLogEntry }) {
  const config = eventTypeConfig[log.eventType] || eventTypeConfig.NEW_DATA;
  
  return (
    <div className={cn(
      'flex items-start gap-3 p-3 rounded-lg transition-all duration-300',
      'animate-in slide-in-from-top-2 fade-in',
      config.bgColor
    )}>
      <div className={cn('mt-0.5', config.color)}>
        {config.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground leading-snug">
          {log.message}
        </p>
        {log.data && Object.keys(log.data).length > 0 && (
          <div className="mt-1 text-xs text-muted-foreground">
            {Object.entries(log.data).slice(0, 3).map(([key, value]) => (
              <span key={key} className="mr-2">
                <span className="font-medium">{key}:</span>{' '}
                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="text-xs text-muted-foreground whitespace-nowrap flex items-center gap-1">
        <Clock className="h-3 w-3" />
        {formatRelativeTime(log.timestamp)}
      </div>
    </div>
  );
}

function ConnectionStatus({ status }: { status: LiveStreamProps['status'] }) {
  const statusConfig = {
    connecting: { color: 'bg-yellow-500', label: '연결 중...', animate: true },
    connected: { color: 'bg-green-500', label: '실시간 연결됨', animate: false },
    disconnected: { color: 'bg-gray-500', label: '연결 끊김', animate: false },
    error: { color: 'bg-red-500', label: '연결 오류', animate: false },
  };
  
  const config = statusConfig[status];
  
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className={cn(
        'h-2 w-2 rounded-full',
        config.color,
        config.animate && 'animate-pulse'
      )} />
      {config.label}
    </div>
  );
}

/**
 * 실시간 활동 스트림 컴포넌트
 * 터미널 로그 스타일의 실시간 활동 피드
 */
export function LiveStream({
  logs,
  status,
  maxVisible = 20,
  title = '실시간 활동',
  className,
  onClear,
}: LiveStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // 새 로그가 추가되면 스크롤을 상단으로
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [logs.length]);

  const visibleLogs = logs.slice(0, maxVisible);

  return (
    <div className={cn(
      'rounded-xl border bg-card shadow-sm flex flex-col',
      className
    )}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">{title}</h3>
          {logs.length > 0 && (
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {logs.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <ConnectionStatus status={status} />
          {onClear && logs.length > 0 && (
            <button
              onClick={onClear}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              지우기
            </button>
          )}
        </div>
      </div>
      
      {/* Log Stream */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="p-3 space-y-2">
          {visibleLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              {status === 'connected' ? (
                <>
                  <Activity className="h-8 w-8 mb-2 animate-pulse" />
                  <p className="text-sm">이벤트 대기 중...</p>
                </>
              ) : (
                <>
                  <AlertCircle className="h-8 w-8 mb-2" />
                  <p className="text-sm">연결 대기 중...</p>
                </>
              )}
            </div>
          ) : (
            visibleLogs.map((log) => (
              <LogEntry key={log.id} log={log} />
            ))
          )}
        </div>
      </ScrollArea>
      
      {/* Footer - 더 보기 */}
      {logs.length > maxVisible && (
        <div className="p-3 border-t text-center">
          <span className="text-xs text-muted-foreground">
            + {logs.length - maxVisible}개 더 있음
          </span>
        </div>
      )}
    </div>
  );
}

export default LiveStream;
