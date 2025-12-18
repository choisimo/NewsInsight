import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle, Clock, Search, Trash2, X, ExternalLink } from 'lucide-react';
import { useBackgroundTasks, type BackgroundTask } from '@/contexts/BackgroundTaskContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { cancelDeepSearch } from '@/lib/api';

// ============================================
// Task Item Component
// ============================================

interface TaskItemProps {
  task: BackgroundTask;
  onNavigate: (url: string) => void;
  onRemove: (id: string) => void;
}

const TaskItem = ({ task, onNavigate, onRemove, onCancel }: TaskItemProps & { onCancel?: (task: BackgroundTask) => void }) => {
  const getStatusIcon = () => {
    switch (task.status) {
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'running':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'failed':
      case 'cancelled':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusLabel = () => {
    switch (task.status) {
      case 'pending':
        return '대기 중';
      case 'running':
        return '진행 중';
      case 'completed':
        return '완료';
      case 'failed':
        return '실패';
      case 'cancelled':
        return '취소됨';
      default:
        return task.status;
    }
  };

  const getTypeIcon = () => {
    switch (task.type) {
      case 'deep-search':
        return <Search className="h-3 w-3" />;
      default:
        return null;
    }
  };

  const getTypeLabel = () => {
    switch (task.type) {
      case 'deep-search':
        return 'Deep Search';
      case 'browser-agent':
        return 'Browser Agent';
      case 'fact-check':
        return 'Fact Check';
      default:
        return task.type;
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return '방금 전';
    if (diffMins < 60) return `${diffMins}분 전`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}시간 전`;
    return date.toLocaleDateString('ko-KR');
  };

  const isActive = task.status === 'pending' || task.status === 'running';
  const isCompleted = task.status === 'completed';

  return (
    <div className={cn(
      "p-3 rounded-lg border transition-colors",
      isActive && "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800",
      isCompleted && "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800",
      !isActive && !isCompleted && "bg-muted/50"
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="flex items-center gap-2 mb-1">
            <span className="shrink-0">{getStatusIcon()}</span>
            <span className="font-medium text-sm truncate" title={task.title}>{task.title}</span>
          </div>
          
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="outline" className="h-5 gap-1 shrink-0">
              {getTypeIcon()}
              {getTypeLabel()}
            </Badge>
            <span className="shrink-0">{getStatusLabel()}</span>
            {task.evidenceCount !== undefined && task.evidenceCount > 0 && (
              <span className="shrink-0">| {task.evidenceCount}개 증거</span>
            )}
          </div>
          
          {/* Progress bar for running tasks */}
          {isActive && task.progress !== undefined && (
            <div className="mt-2 space-y-1">
              <Progress value={task.progress} className="h-1.5" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="truncate mr-2">{task.progressMessage || '처리 중...'}</span>
                <span className="shrink-0">{task.progress}%</span>
              </div>
            </div>
          )}
          
          {/* Error message */}
          {task.error && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400 line-clamp-2" title={task.error}>
              {task.error}
            </p>
          )}
          
          {/* Time info */}
          <div className="mt-1 text-xs text-muted-foreground">
            {task.completedAt 
              ? `완료: ${formatTime(task.completedAt)}`
              : `시작: ${formatTime(task.createdAt)}`
            }
          </div>
        </div>
        
        <div className="flex items-center gap-1 shrink-0">
          {task.resultUrl && (isCompleted || isActive) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onNavigate(task.resultUrl!)}
              title="결과 보기"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          )}
          {isActive && onCancel && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-red-500"
              onClick={() => onCancel(task)}
              title="작업 취소"
            >
              <XCircle className="h-3.5 w-3.5" />
            </Button>
          )}
          {!isActive && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => onRemove(task.id)}
              title="삭제"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================
// Background Task Indicator
// ============================================

export function BackgroundTaskIndicator() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { 
    activeTasks, 
    completedTasks, 
    hasActiveTasks, 
    activeTaskCount,
    removeTask,
    clearCompletedTasks,
    updateTask,
  } = useBackgroundTasks();

  const handleNavigate = (url: string) => {
    setOpen(false);
    navigate(url);
  };

  const handleCancelTask = async (task: BackgroundTask) => {
    if (task.status !== 'pending' && task.status !== 'running') {
      return;
    }

    try {
      if (task.type === 'deep-search') {
        await cancelDeepSearch(task.id);
      }
    } catch (error) {
      console.error('Failed to cancel background task:', error);
    } finally {
      updateTask(task.id, {
        status: 'cancelled',
        completedAt: new Date().toISOString(),
      });
    }
  };

  const allTasks = [...activeTasks, ...completedTasks];

  // Don't show if no tasks at all
  if (allTasks.length === 0) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "relative h-9 px-3 gap-2",
            hasActiveTasks && "text-blue-600 dark:text-blue-400"
          )}
        >
          {hasActiveTasks ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          )}
          
          <span className="text-sm font-medium">
            {hasActiveTasks ? activeTaskCount : completedTasks.length}
          </span>
          
          {/* Pulse animation for active tasks */}
          {hasActiveTasks && (
            <span className="absolute top-1 right-1 h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      
      <PopoverContent 
        className="w-96 p-0" 
        align="end"
        sideOffset={8}
      >
        {/* Header - fixed */}
        <div className="flex items-center justify-between p-3 border-b bg-background sticky top-0 z-10">
          <h3 className="font-semibold">백그라운드 작업</h3>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        
        {/* Scrollable content area with explicit height */}
        <ScrollArea className="max-h-[60vh] overflow-auto">
          <div className="p-3 space-y-4">
            {/* Active Tasks */}
            {activeTasks.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                  진행 중 ({activeTasks.length})
                </h4>
                <div className="space-y-2">
                  {activeTasks.map(task => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      onNavigate={handleNavigate}
                      onRemove={removeTask}
                      onCancel={handleCancelTask}
                    />
                  ))}
                </div>
              </div>
            )}
            
            {/* Completed Tasks */}
            {completedTasks.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                  완료됨 ({completedTasks.length})
                </h4>
                <div className="space-y-2">
                  {completedTasks.map(task => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      onNavigate={handleNavigate}
                      onRemove={removeTask}
                      onCancel={handleCancelTask}
                    />
                  ))}
                </div>
              </div>
            )}
            
            {/* Empty state */}
            {allTasks.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">진행 중인 작업이 없습니다</p>
              </div>
            )}
          </div>
        </ScrollArea>
        
        {/* Footer with clear button - fixed */}
        {completedTasks.length > 0 && (
          <div className="p-3 border-t bg-background sticky bottom-0">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={clearCompletedTasks}
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              완료된 작업 모두 지우기
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default BackgroundTaskIndicator;
