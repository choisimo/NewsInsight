import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { 
  Terminal, 
  RefreshCw, 
  AlertCircle, 
  CheckCircle2, 
  Clock,
  Zap,
  Bug,
  Globe,
  Filter,
  Pause,
  Play,
  Trash2,
  ChevronDown,
  ChevronUp,
  Activity,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCrawlerLogs, type CrawlerLogEntry, type CrawlerEventType, type LogLevel } from '@/hooks/useCrawlerLogs';

interface CrawlerLogsViewerProps {
  /** 최대 표시 개수 */
  maxVisible?: number;
  /** 클래스명 */
  className?: string;
  /** 초기 활성화 여부 */
  defaultEnabled?: boolean;
}

const eventTypeConfig: Record<CrawlerEventType, {
  icon: React.ReactNode;
  color: string;
  label: string;
}> = {
  connected: {
    icon: <Activity className="h-3 w-3" />,
    color: 'text-green-500',
    label: '연결됨',
  },
  agent_start: {
    icon: <Zap className="h-3 w-3" />,
    color: 'text-yellow-500',
    label: '에이전트 시작',
  },
  agent_step: {
    icon: <Activity className="h-3 w-3" />,
    color: 'text-blue-500',
    label: '스텝',
  },
  agent_complete: {
    icon: <CheckCircle2 className="h-3 w-3" />,
    color: 'text-green-500',
    label: '완료',
  },
  agent_error: {
    icon: <AlertCircle className="h-3 w-3" />,
    color: 'text-red-500',
    label: '에러',
  },
  url_discovered: {
    icon: <Globe className="h-3 w-3" />,
    color: 'text-purple-500',
    label: 'URL 발견',
  },
  health_update: {
    icon: <Activity className="h-3 w-3" />,
    color: 'text-gray-500',
    label: '상태 업데이트',
  },
  captcha_detected: {
    icon: <Bug className="h-3 w-3" />,
    color: 'text-orange-500',
    label: '캡챠 감지',
  },
  captcha_solved: {
    icon: <CheckCircle2 className="h-3 w-3" />,
    color: 'text-green-500',
    label: '캡챠 해결',
  },
  collection_start: {
    icon: <Zap className="h-3 w-3" />,
    color: 'text-yellow-500',
    label: '수집 시작',
  },
  collection_progress: {
    icon: <RefreshCw className="h-3 w-3 animate-spin" />,
    color: 'text-blue-500',
    label: '수집 중',
  },
  collection_complete: {
    icon: <CheckCircle2 className="h-3 w-3" />,
    color: 'text-green-500',
    label: '수집 완료',
  },
  collection_error: {
    icon: <AlertCircle className="h-3 w-3" />,
    color: 'text-red-500',
    label: '수집 에러',
  },
  collection_log: {
    icon: <Terminal className="h-3 w-3" />,
    color: 'text-gray-500',
    label: '로그',
  },
};

const levelConfig: Record<LogLevel, {
  icon: React.ReactNode;
  color: string;
  bgColor: string;
}> = {
  DEBUG: {
    icon: <Bug className="h-3 w-3" />,
    color: 'text-gray-500',
    bgColor: 'bg-gray-50 dark:bg-gray-900',
  },
  INFO: {
    icon: <Info className="h-3 w-3" />,
    color: 'text-blue-500',
    bgColor: 'bg-blue-50 dark:bg-blue-950',
  },
  WARNING: {
    icon: <AlertTriangle className="h-3 w-3" />,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50 dark:bg-yellow-950',
  },
  ERROR: {
    icon: <AlertCircle className="h-3 w-3" />,
    color: 'text-red-500',
    bgColor: 'bg-red-50 dark:bg-red-950',
  },
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function LogEntry({ log, expanded, onToggle }: { 
  log: CrawlerLogEntry; 
  expanded: boolean;
  onToggle: () => void;
}) {
  const eventConfig = eventTypeConfig[log.eventType] || eventTypeConfig.collection_log;
  const levelCfg = levelConfig[log.level] || levelConfig.INFO;
  
  return (
    <div className={cn(
      'font-mono text-xs border-b border-border/50 transition-all duration-200',
      'hover:bg-muted/50',
      levelCfg.bgColor
    )}>
      <div 
        className="flex items-start gap-2 p-2 cursor-pointer"
        onClick={onToggle}
      >
        {/* Timestamp */}
        <span className="text-muted-foreground whitespace-nowrap flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatTime(log.timestamp)}
        </span>
        
        {/* Level Badge */}
        <Badge 
          variant="outline" 
          className={cn('text-[10px] px-1 py-0', levelCfg.color)}
        >
          {log.level}
        </Badge>
        
        {/* Source */}
        <Badge variant="secondary" className="text-[10px] px-1 py-0 max-w-[100px] truncate">
          {log.source}
        </Badge>
        
        {/* Event Type Icon */}
        <span className={cn('flex-shrink-0', eventConfig.color)}>
          {eventConfig.icon}
        </span>
        
        {/* Message */}
        <span className="flex-1 text-foreground truncate">
          {log.message}
        </span>
        
        {/* Expand Toggle */}
        {log.data && Object.keys(log.data).length > 2 && (
          <button className="text-muted-foreground hover:text-foreground">
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}
      </div>
      
      {/* Expanded Details */}
      {expanded && log.data && (
        <div className="px-2 pb-2 pl-24">
          <pre className="text-[10px] text-muted-foreground bg-muted/50 p-2 rounded overflow-x-auto">
            {JSON.stringify(log.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function ConnectionStatus({ status }: { status: 'connecting' | 'connected' | 'disconnected' | 'error' }) {
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
 * 실시간 크롤러 로그 뷰어 컴포넌트
 * 터미널 스타일의 실시간 수집 로그 피드
 */
export function CrawlerLogsViewer({
  maxVisible = 100,
  className,
  defaultEnabled = true,
}: CrawlerLogsViewerProps) {
  const [enabled, setEnabled] = useState(defaultEnabled);
  const [filterLevels, setFilterLevels] = useState<LogLevel[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const {
    logs,
    status,
    reconnect,
    clearLogs,
    activeSources,
    sourceStatus,
  } = useCrawlerLogs({
    enabled,
    maxLogs: 500,
    filterLevels: filterLevels.length > 0 ? filterLevels : undefined,
  });

  // 자동 스크롤
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [logs.length, autoScroll]);

  const visibleLogs = logs.slice(0, maxVisible);

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleLevel = (level: LogLevel) => {
    setFilterLevels(prev => {
      if (prev.includes(level)) {
        return prev.filter(l => l !== level);
      }
      return [...prev, level];
    });
  };

  // 소스별 통계
  const runningCount = Object.values(sourceStatus).filter(s => s === 'running').length;
  const errorCount = Object.values(sourceStatus).filter(s => s === 'error').length;

  return (
    <div className={cn(
      'rounded-xl border bg-card shadow-sm flex flex-col h-full',
      className
    )}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm">실시간 수집 로그</h3>
          {logs.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {logs.length}
            </Badge>
          )}
          {runningCount > 0 && (
            <Badge variant="default" className="text-xs bg-yellow-500">
              {runningCount} 수집 중
            </Badge>
          )}
          {errorCount > 0 && (
            <Badge variant="destructive" className="text-xs">
              {errorCount} 에러
            </Badge>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <ConnectionStatus status={status} />
          
          {/* Level Filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2">
                <Filter className="h-3 w-3 mr-1" />
                필터
                {filterLevels.length > 0 && (
                  <Badge variant="secondary" className="ml-1 text-[10px] px-1">
                    {filterLevels.length}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>로그 레벨</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(['DEBUG', 'INFO', 'WARNING', 'ERROR'] as LogLevel[]).map(level => (
                <DropdownMenuCheckboxItem
                  key={level}
                  checked={filterLevels.includes(level)}
                  onCheckedChange={() => toggleLevel(level)}
                >
                  <span className={levelConfig[level].color}>{level}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          
          {/* Controls */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => setEnabled(!enabled)}
          >
            {enabled ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={clearLogs}
            disabled={logs.length === 0}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
          
          {status !== 'connected' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={reconnect}
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Active Sources Bar */}
      {activeSources.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/20 overflow-x-auto">
          <span className="text-xs text-muted-foreground whitespace-nowrap">활성 소스:</span>
          {activeSources.map(source => {
            const status = sourceStatus[source] || 'idle';
            const statusColors = {
              idle: 'bg-gray-500',
              running: 'bg-yellow-500 animate-pulse',
              complete: 'bg-green-500',
              error: 'bg-red-500',
            };
            return (
              <Badge 
                key={source} 
                variant="outline" 
                className="text-[10px] flex items-center gap-1"
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', statusColors[status])} />
                {source}
              </Badge>
            );
          })}
        </div>
      )}
      
      {/* Log Stream */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="divide-y divide-border/30">
          {visibleLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              {status === 'connected' ? (
                <>
                  <Terminal className="h-8 w-8 mb-2 animate-pulse" />
                  <p className="text-sm">수집 로그 대기 중...</p>
                  <p className="text-xs mt-1">Browser Agent가 작업을 시작하면 로그가 표시됩니다</p>
                </>
              ) : status === 'connecting' ? (
                <>
                  <RefreshCw className="h-8 w-8 mb-2 animate-spin" />
                  <p className="text-sm">크롤러 서비스에 연결 중...</p>
                </>
              ) : (
                <>
                  <AlertCircle className="h-8 w-8 mb-2" />
                  <p className="text-sm">연결 대기 중...</p>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="mt-2"
                    onClick={reconnect}
                  >
                    재연결
                  </Button>
                </>
              )}
            </div>
          ) : (
            visibleLogs.map((log) => (
              <LogEntry 
                key={log.id} 
                log={log} 
                expanded={expandedIds.has(log.id)}
                onToggle={() => toggleExpanded(log.id)}
              />
            ))
          )}
        </div>
      </ScrollArea>
      
      {/* Footer */}
      {logs.length > maxVisible && (
        <div className="p-2 border-t text-center bg-muted/20">
          <span className="text-xs text-muted-foreground">
            + {logs.length - maxVisible}개 더 있음
          </span>
        </div>
      )}
    </div>
  );
}

export default CrawlerLogsViewer;
