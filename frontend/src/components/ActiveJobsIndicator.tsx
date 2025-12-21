/**
 * ActiveJobsIndicator - Floating indicator showing active search jobs
 * 
 * Displays a compact badge when jobs are running, expanding to a list
 * when clicked. Shows real-time progress updates via SSE.
 */

import React, { useState } from 'react';
import { useSearchJobs, JOB_TYPE_LABELS, JOB_STATUS_LABELS } from '@/contexts/SearchJobContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { SearchJob, SearchJobStatus } from '@/lib/api';

// Icons using simple SVG for consistency
const LoaderIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={cn('animate-spin', className)}
  >
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

const CheckIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const XIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

const ClockIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const TrashIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M3 6h18" />
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
  </svg>
);

const WifiOffIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M12 20h.01" />
    <path d="M8.5 16.429a5 5 0 0 1 7 0" />
    <path d="M5 12.859a10 10 0 0 1 5.17-2.69" />
    <path d="M19 12.859a10 10 0 0 0-2.007-1.523" />
    <path d="M2 8.82a15 15 0 0 1 4.177-2.643" />
    <path d="M22 8.82a15 15 0 0 0-11.288-3.764" />
    <path d="m2 2 20 20" />
  </svg>
);

// Status icon component
function StatusIcon({ status, className }: { status: SearchJobStatus; className?: string }) {
  switch (status) {
    case 'PENDING':
      return <ClockIcon className={cn('text-muted-foreground', className)} />;
    case 'RUNNING':
      return <LoaderIcon className={cn('text-blue-500', className)} />;
    case 'COMPLETED':
      return <CheckIcon className={cn('text-green-500', className)} />;
    case 'FAILED':
      return <XIcon className={cn('text-red-500', className)} />;
    case 'CANCELLED':
      return <XIcon className={cn('text-muted-foreground', className)} />;
    default:
      return <ClockIcon className={cn('text-muted-foreground', className)} />;
  }
}

// Status badge variant
function getStatusVariant(status: SearchJobStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'RUNNING':
      return 'default';
    case 'COMPLETED':
      return 'secondary';
    case 'FAILED':
      return 'destructive';
    default:
      return 'outline';
  }
}

// Single job item component
function JobItem({ 
  job, 
  onCancel,
  onRemove,
}: { 
  job: SearchJob;
  onCancel?: (jobId: string) => void;
  onRemove?: (jobId: string) => void;
}) {
  const isActive = job.status === 'PENDING' || job.status === 'RUNNING';
  const isTerminal = job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED';

  return (
    <div className="p-3 border-b border-border last:border-b-0 hover:bg-muted/50 transition-colors">
      <div className="flex items-start gap-2">
        <StatusIcon status={job.status} className="mt-1 flex-shrink-0" />
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-muted-foreground">
              {JOB_TYPE_LABELS[job.type]}
            </span>
            <Badge variant={getStatusVariant(job.status)} className="text-xs h-5">
              {JOB_STATUS_LABELS[job.status]}
            </Badge>
          </div>
          
          <p className="text-sm font-medium truncate" title={job.query}>
            {job.query}
          </p>
          
          {isActive && (
            <div className="mt-2">
              <Progress value={job.progress} className="h-1.5" />
              <p className="text-xs text-muted-foreground mt-1">
                {job.currentPhase || `${job.progress}%`}
              </p>
            </div>
          )}
          
          {job.status === 'FAILED' && job.errorMessage && (
            <p className="text-xs text-red-500 mt-1 truncate" title={job.errorMessage}>
              {job.errorMessage}
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex-shrink-0 flex gap-1">
          {isActive && onCancel && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => onCancel(job.jobId)}
                  >
                    <XIcon className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>취소</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          
          {isTerminal && onRemove && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => onRemove(job.jobId)}
                  >
                    <TrashIcon className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>제거</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
    </div>
  );
}

interface ActiveJobsIndicatorProps {
  className?: string;
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  showWhenEmpty?: boolean;
}

export function ActiveJobsIndicator({
  className,
  position = 'bottom-right',
  showWhenEmpty = false,
}: ActiveJobsIndicatorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const {
    jobs,
    activeJobs,
    completedJobs,
    hasActiveJobs,
    activeJobCount,
    isConnected,
    connectionError,
    cancelJob,
    clearCompletedJobs,
    refreshJobs,
  } = useSearchJobs();

  // Position classes
  const positionClasses = {
    'bottom-right': 'fixed bottom-4 right-4',
    'bottom-left': 'fixed bottom-4 left-4',
    'top-right': 'fixed top-4 right-4',
    'top-left': 'fixed top-4 left-4',
  };

  // Don't render if no jobs and showWhenEmpty is false
  if (!showWhenEmpty && jobs.length === 0) {
    return null;
  }

  const handleCancel = async (jobId: string) => {
    await cancelJob(jobId);
  };

  const handleRemove = (jobId: string) => {
    // Just refresh to update the list
    refreshJobs();
  };

  return (
    <div className={cn(positionClasses[position], 'z-50', className)}>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={hasActiveJobs ? 'default' : 'secondary'}
            size="sm"
            className={cn(
              'gap-2 shadow-lg',
              hasActiveJobs && 'animate-pulse'
            )}
          >
            {hasActiveJobs ? (
              <LoaderIcon className="h-4 w-4" />
            ) : (
              <CheckIcon className="h-4 w-4" />
            )}
            
            <span>
              {hasActiveJobs 
                ? `${activeJobCount}개 작업 진행 중` 
                : `${jobs.length}개 작업`
              }
            </span>
            
            {!isConnected && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <WifiOffIcon className="h-3 w-3 text-yellow-500" />
                  </TooltipTrigger>
                  <TooltipContent>
                    {connectionError || '실시간 연결 끊김'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </Button>
        </PopoverTrigger>

        <PopoverContent 
          className="w-80 p-0" 
          align={position.includes('right') ? 'end' : 'start'}
          side={position.includes('bottom') ? 'top' : 'bottom'}
        >
          <div className="p-3 border-b border-border flex items-center justify-between">
            <h4 className="font-medium">검색 작업</h4>
            {completedJobs.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={clearCompletedJobs}
              >
                완료 항목 지우기
              </Button>
            )}
          </div>

          {jobs.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">
              진행 중인 작업이 없습니다
            </div>
          ) : (
            <ScrollArea className="max-h-80">
              {/* Active jobs first */}
              {activeJobs.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 bg-muted/50 text-xs font-medium text-muted-foreground">
                    진행 중 ({activeJobs.length})
                  </div>
                  {activeJobs.map(job => (
                    <JobItem
                      key={job.jobId}
                      job={job}
                      onCancel={handleCancel}
                    />
                  ))}
                </div>
              )}

              {/* Completed jobs */}
              {completedJobs.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 bg-muted/50 text-xs font-medium text-muted-foreground">
                    완료됨 ({completedJobs.length})
                  </div>
                  {completedJobs.slice(0, 10).map(job => (
                    <JobItem
                      key={job.jobId}
                      job={job}
                      onRemove={handleRemove}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          )}

          {/* Connection status footer */}
          <div className="p-2 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span 
                className={cn(
                  'w-2 h-2 rounded-full',
                  isConnected ? 'bg-green-500' : 'bg-yellow-500'
                )} 
              />
              {isConnected ? '실시간 연결됨' : '연결 끊김'}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => refreshJobs()}
            >
              새로고침
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * Compact version for header/navbar integration
 */
export function ActiveJobsBadge({ className }: { className?: string }) {
  const { hasActiveJobs, activeJobCount, isConnected } = useSearchJobs();

  if (!hasActiveJobs) {
    return null;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="default" 
            className={cn('gap-1.5 cursor-pointer', className)}
          >
            <LoaderIcon className="h-3 w-3" />
            {activeJobCount}
            {!isConnected && (
              <WifiOffIcon className="h-3 w-3 text-yellow-300" />
            )}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          {activeJobCount}개 작업 진행 중
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default ActiveJobsIndicator;
