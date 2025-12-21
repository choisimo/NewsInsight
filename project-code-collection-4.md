# Project Code Snapshot

Generated at 2025-12-21T18:10:03.191Z

---

## frontend/src/components/ActiveJobsIndicator.tsx

```tsx
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

```

---

## frontend/src/components/AdvancedFilters.tsx

```tsx
import { useState, useCallback } from "react";
import {
  ChevronDown,
  ChevronUp,
  Filter,
  Calendar as CalendarIcon,
  Globe,
  Database,
  Brain,
  X,
  RotateCcw,
} from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface SearchFilters {
  /** 시간 범위 (preset) */
  timeWindow: string;
  /** 커스텀 시작 날짜 (timeWindow가 "custom"일 때 사용) */
  customStartDate?: Date;
  /** 커스텀 종료 날짜 (timeWindow가 "custom"일 때 사용) */
  customEndDate?: Date;
  /** 활성화된 소스 */
  sources: {
    database: boolean;
    web: boolean;
    ai: boolean;
  };
  /** 정렬 기준 */
  sortBy: "relevance" | "date" | "reliability";
  /** 정렬 순서 */
  sortOrder: "asc" | "desc";
  /** 언어 필터 */
  language: "all" | "ko" | "en";
  /** 신뢰도 최소값 */
  minReliability?: number;
}

export const defaultFilters: SearchFilters = {
  timeWindow: "7d",
  customStartDate: undefined,
  customEndDate: undefined,
  sources: {
    database: true,
    web: true,
    ai: true,
  },
  sortBy: "relevance",
  sortOrder: "desc",
  language: "all",
  minReliability: undefined,
};

interface AdvancedFiltersProps {
  /** 현재 필터 값 */
  filters: SearchFilters;
  /** 필터 변경 핸들러 */
  onFiltersChange: (filters: SearchFilters) => void;
  /** 비활성화 여부 */
  disabled?: boolean;
  /** 추가 CSS 클래스 */
  className?: string;
  /** 컴팩트 모드 (인라인 표시) */
  compact?: boolean;
}

const sourceConfig = {
  database: { icon: Database, label: "저장된 뉴스", color: "text-blue-600" },
  web: { icon: Globe, label: "웹 검색", color: "text-green-600" },
  ai: { icon: Brain, label: "AI 분석", color: "text-purple-600" },
};

const timeOptions = [
  { value: "1h", label: "최근 1시간" },
  { value: "24h", label: "최근 24시간" },
  { value: "3d", label: "최근 3일" },
  { value: "7d", label: "최근 7일" },
  { value: "14d", label: "최근 2주" },
  { value: "30d", label: "최근 30일" },
  { value: "90d", label: "최근 3개월" },
  { value: "180d", label: "최근 6개월" },
  { value: "365d", label: "최근 1년" },
  { value: "all", label: "전체 기간" },
  { value: "custom", label: "직접 선택" },
];

const sortOptions = [
  { value: "relevance", label: "관련도순" },
  { value: "date", label: "최신순" },
  { value: "reliability", label: "신뢰도순" },
];

const languageOptions = [
  { value: "all", label: "전체 언어" },
  { value: "ko", label: "한국어" },
  { value: "en", label: "English" },
];

/** 활성 필터 수 계산 */
const getActiveFilterCount = (filters: SearchFilters): number => {
  let count = 0;
  if (filters.timeWindow !== defaultFilters.timeWindow) count++;
  if (filters.timeWindow === "custom" && (filters.customStartDate || filters.customEndDate)) count++;
  if (filters.sortBy !== defaultFilters.sortBy) count++;
  if (filters.language !== defaultFilters.language) count++;
  if (filters.minReliability !== undefined) count++;
  const sourcesChanged =
    filters.sources.database !== defaultFilters.sources.database ||
    filters.sources.web !== defaultFilters.sources.web ||
    filters.sources.ai !== defaultFilters.sources.ai;
  if (sourcesChanged) count++;
  return count;
};

/** 날짜 범위 라벨 생성 */
const getDateRangeLabel = (filters: SearchFilters): string => {
  if (filters.timeWindow === "custom") {
    if (filters.customStartDate && filters.customEndDate) {
      return `${format(filters.customStartDate, "yy.MM.dd")} - ${format(filters.customEndDate, "yy.MM.dd")}`;
    } else if (filters.customStartDate) {
      return `${format(filters.customStartDate, "yy.MM.dd")} ~`;
    } else if (filters.customEndDate) {
      return `~ ${format(filters.customEndDate, "yy.MM.dd")}`;
    }
    return "직접 선택";
  }
  const opt = timeOptions.find((o) => o.value === filters.timeWindow);
  return opt?.label || filters.timeWindow;
};

export function AdvancedFilters({
  filters,
  onFiltersChange,
  disabled = false,
  className,
  compact = false,
}: AdvancedFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const activeCount = getActiveFilterCount(filters);

  const updateFilter = useCallback(
    <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
      onFiltersChange({ ...filters, [key]: value });
    },
    [filters, onFiltersChange]
  );

  const updateSource = useCallback(
    (source: keyof SearchFilters["sources"], checked: boolean) => {
      // 최소 하나의 소스는 활성화되어야 함
      const newSources = { ...filters.sources, [source]: checked };
      if (!newSources.database && !newSources.web && !newSources.ai) {
        return; // 모두 비활성화 방지
      }
      onFiltersChange({ ...filters, sources: newSources });
    },
    [filters, onFiltersChange]
  );

  const updateCustomDateRange = useCallback(
    (startDate: Date | undefined, endDate: Date | undefined) => {
      onFiltersChange({
        ...filters,
        timeWindow: "custom",
        customStartDate: startDate,
        customEndDate: endDate,
      });
    },
    [filters, onFiltersChange]
  );

  const resetFilters = useCallback(() => {
    onFiltersChange(defaultFilters);
  }, [onFiltersChange]);

  // 컴팩트 모드: 인라인 칩으로 표시
  if (compact) {
    return (
      <div className={cn("flex flex-wrap items-center gap-2", className)}>
        {/* 시간 범위 - with custom date picker */}
        <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-8 text-sm justify-start",
                filters.timeWindow === "custom" ? "w-auto min-w-[160px]" : "w-[130px]"
              )}
              disabled={disabled}
            >
              <CalendarIcon className="h-3 w-3 mr-1" />
              <span className="truncate">{getDateRangeLabel(filters)}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <div className="p-2 border-b">
              <div className="grid grid-cols-3 gap-1">
                {timeOptions.filter(opt => opt.value !== "custom").map((opt) => (
                  <Button
                    key={opt.value}
                    variant={filters.timeWindow === opt.value ? "secondary" : "ghost"}
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => {
                      onFiltersChange({
                        ...filters,
                        timeWindow: opt.value,
                        customStartDate: undefined,
                        customEndDate: undefined,
                      });
                      setDatePickerOpen(false);
                    }}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>
            <Separator />
            <div className="p-2">
              <Label className="text-xs text-muted-foreground mb-2 block">직접 선택</Label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label className="text-xs mb-1 block">시작일</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                          "w-full justify-start text-left text-xs",
                          !filters.customStartDate && "text-muted-foreground"
                        )}
                      >
                        {filters.customStartDate ? (
                          format(filters.customStartDate, "yyyy.MM.dd", { locale: ko })
                        ) : (
                          "선택"
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={filters.customStartDate}
                        onSelect={(date) => {
                          updateCustomDateRange(date, filters.customEndDate);
                        }}
                        disabled={(date) =>
                          date > new Date() || (filters.customEndDate ? date > filters.customEndDate : false)
                        }
                        locale={ko}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="flex-1">
                  <Label className="text-xs mb-1 block">종료일</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                          "w-full justify-start text-left text-xs",
                          !filters.customEndDate && "text-muted-foreground"
                        )}
                      >
                        {filters.customEndDate ? (
                          format(filters.customEndDate, "yyyy.MM.dd", { locale: ko })
                        ) : (
                          "선택"
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={filters.customEndDate}
                        onSelect={(date) => {
                          updateCustomDateRange(filters.customStartDate, date);
                        }}
                        disabled={(date) =>
                          date > new Date() || (filters.customStartDate ? date < filters.customStartDate : false)
                        }
                        locale={ko}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              {(filters.customStartDate || filters.customEndDate) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-2 text-xs"
                  onClick={() => {
                    updateCustomDateRange(undefined, undefined);
                  }}
                >
                  날짜 초기화
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* 정렬 */}
        <Select
          value={filters.sortBy}
          onValueChange={(v) => updateFilter("sortBy", v as SearchFilters["sortBy"])}
          disabled={disabled}
        >
          <SelectTrigger className="w-[110px] h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sortOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* 소스 토글 버튼 */}
        {(Object.entries(sourceConfig) as [keyof typeof sourceConfig, typeof sourceConfig.database][]).map(
          ([key, config]) => {
            const Icon = config.icon;
            const isActive = filters.sources[key];
            return (
              <Button
                key={key}
                variant={isActive ? "secondary" : "outline"}
                size="sm"
                className={cn(
                  "h-8 gap-1",
                  isActive && config.color,
                  !isActive && "opacity-50"
                )}
                onClick={() => updateSource(key, !isActive)}
                disabled={disabled}
              >
                <Icon className="h-3 w-3" />
                <span className="hidden sm:inline">{config.label}</span>
              </Button>
            );
          }
        )}

        {/* 리셋 버튼 */}
        {activeCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={resetFilters}
            disabled={disabled}
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            초기화
          </Button>
        )}
      </div>
    );
  }

  // 펼침 모드: Collapsible 패널
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className={className}>
      <CollapsibleTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between"
          disabled={disabled}
        >
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4" />
            <span>고급 필터</span>
            {activeCount > 0 && (
              <Badge variant="secondary" className="ml-1">
                {activeCount}
              </Badge>
            )}
          </div>
          {isOpen ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-4 space-y-4 p-4 border rounded-lg bg-muted/30">
        {/* 시간 범위 & 정렬 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">기간</Label>
            <Select
              value={filters.timeWindow}
              onValueChange={(v) => {
                if (v === "custom") {
                  onFiltersChange({ ...filters, timeWindow: "custom" });
                } else {
                  onFiltersChange({
                    ...filters,
                    timeWindow: v,
                    customStartDate: undefined,
                    customEndDate: undefined,
                  });
                }
              }}
              disabled={disabled}
            >
              <SelectTrigger>
                <SelectValue>{getDateRangeLabel(filters)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {timeOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Custom date range pickers */}
          {filters.timeWindow === "custom" && (
            <>
              <div className="space-y-2">
                <Label className="text-sm font-medium">시작일</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !filters.customStartDate && "text-muted-foreground"
                      )}
                      disabled={disabled}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {filters.customStartDate ? (
                        format(filters.customStartDate, "yyyy년 MM월 dd일", { locale: ko })
                      ) : (
                        "시작일 선택"
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={filters.customStartDate}
                      onSelect={(date) => updateCustomDateRange(date, filters.customEndDate)}
                      disabled={(date) =>
                        date > new Date() || (filters.customEndDate ? date > filters.customEndDate : false)
                      }
                      locale={ko}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">종료일</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !filters.customEndDate && "text-muted-foreground"
                      )}
                      disabled={disabled}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {filters.customEndDate ? (
                        format(filters.customEndDate, "yyyy년 MM월 dd일", { locale: ko })
                      ) : (
                        "종료일 선택"
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={filters.customEndDate}
                      onSelect={(date) => updateCustomDateRange(filters.customStartDate, date)}
                      disabled={(date) =>
                        date > new Date() || (filters.customStartDate ? date < filters.customStartDate : false)
                      }
                      locale={ko}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </>
          )}

          {filters.timeWindow !== "custom" && (
            <>
              <div className="space-y-2">
                <Label className="text-sm font-medium">정렬</Label>
                <Select
                  value={filters.sortBy}
                  onValueChange={(v) => updateFilter("sortBy", v as SearchFilters["sortBy"])}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sortOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">언어</Label>
                <Select
                  value={filters.language}
                  onValueChange={(v) => updateFilter("language", v as SearchFilters["language"])}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {languageOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>

        {/* 정렬 & 언어 row when custom date is selected */}
        {filters.timeWindow === "custom" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">정렬</Label>
              <Select
                value={filters.sortBy}
                onValueChange={(v) => updateFilter("sortBy", v as SearchFilters["sortBy"])}
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sortOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">언어</Label>
              <Select
                value={filters.language}
                onValueChange={(v) => updateFilter("language", v as SearchFilters["language"])}
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {languageOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <Separator />

        {/* 소스 선택 */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">검색 소스</Label>
          <div className="flex flex-wrap gap-4">
            {(Object.entries(sourceConfig) as [keyof typeof sourceConfig, typeof sourceConfig.database][]).map(
              ([key, config]) => {
                const Icon = config.icon;
                return (
                  <div key={key} className="flex items-center space-x-2">
                    <Checkbox
                      id={`source-${key}`}
                      checked={filters.sources[key]}
                      onCheckedChange={(checked) => updateSource(key, checked === true)}
                      disabled={disabled}
                    />
                    <Label
                      htmlFor={`source-${key}`}
                      className={cn(
                        "flex items-center gap-1.5 cursor-pointer",
                        config.color
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {config.label}
                    </Label>
                  </div>
                );
              }
            )}
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="flex justify-end gap-2 pt-2">
          {activeCount > 0 && (
            <Button variant="ghost" size="sm" onClick={resetFilters} disabled={disabled}>
              <RotateCcw className="h-4 w-4 mr-1" />
              초기화
            </Button>
          )}
          <Button size="sm" onClick={() => setIsOpen(false)}>
            적용
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** 활성 필터 표시 배지 */
export function ActiveFilterBadges({
  filters,
  onRemove,
  className,
}: {
  filters: SearchFilters;
  onRemove: (key: keyof SearchFilters, resetValue: unknown) => void;
  className?: string;
}) {
  const badges: { key: keyof SearchFilters; label: string; resetValue: unknown }[] = [];

  if (filters.timeWindow !== defaultFilters.timeWindow) {
    const label = getDateRangeLabel(filters);
    badges.push({ key: "timeWindow", label, resetValue: defaultFilters.timeWindow });
  }

  if (filters.sortBy !== defaultFilters.sortBy) {
    const opt = sortOptions.find((o) => o.value === filters.sortBy);
    badges.push({ key: "sortBy", label: opt?.label || filters.sortBy, resetValue: defaultFilters.sortBy });
  }

  if (filters.language !== defaultFilters.language) {
    const opt = languageOptions.find((o) => o.value === filters.language);
    badges.push({ key: "language", label: opt?.label || filters.language, resetValue: defaultFilters.language });
  }

  if (badges.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {badges.map((badge) => (
        <Badge key={badge.key} variant="secondary" className="gap-1 pr-1">
          {badge.label}
          <button
            onClick={() => onRemove(badge.key, badge.resetValue)}
            className="ml-1 rounded-full p-0.5 hover:bg-muted"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
    </div>
  );
}

export default AdvancedFilters;

```

---

## frontend/src/components/AnalysisBadges.tsx

```tsx
import React from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  TrendingUp,
  TrendingDown,
  Minus,
  MessageSquare,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ========== Types ==========

export interface AnalysisData {
  analyzed?: boolean;
  analysisStatus?: "pending" | "partial" | "complete";
  reliabilityScore?: number;
  reliabilityGrade?: "high" | "medium" | "low";
  reliabilityColor?: "green" | "yellow" | "red";
  sentimentLabel?: "positive" | "negative" | "neutral";
  sentimentScore?: number;
  biasLabel?: string;
  biasScore?: number;
  factcheckStatus?: "verified" | "suspicious" | "conflicting" | "unverified";
  misinfoRisk?: "low" | "mid" | "high";
  riskTags?: string[];
  topics?: string[];
  hasDiscussion?: boolean;
  totalCommentCount?: number;
  discussionSentiment?: string;
}

// ========== Reliability Badge ==========

interface ReliabilityBadgeProps {
  score?: number;
  grade?: string;
  color?: string;
  loading?: boolean;
  size?: "sm" | "md" | "lg";
}

export const ReliabilityBadge: React.FC<ReliabilityBadgeProps> = ({
  score,
  grade,
  color,
  loading = false,
  size = "md",
}) => {
  if (loading) {
    return <Skeleton className={cn("h-6", size === "sm" ? "w-12" : "w-16")} />;
  }

  if (score === undefined || score === null) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="gap-1 text-muted-foreground">
              <HelpCircle className="h-3 w-3" />
              {size !== "sm" && "분석 중"}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>신뢰도 분석 대기 중</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const colorClasses = {
    green: "bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-400",
    yellow: "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400",
    red: "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-400",
  };

  const iconColor = {
    green: "text-green-600",
    yellow: "text-yellow-600",
    red: "text-red-600",
  };

  const badgeColor = colorClasses[color as keyof typeof colorClasses] || colorClasses.yellow;
  const Icon = color === "green" ? Shield : color === "red" ? AlertTriangle : AlertCircle;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn("gap-1", badgeColor)}>
            <Icon className={cn("h-3 w-3", iconColor[color as keyof typeof iconColor])} />
            {size !== "sm" && `신뢰도 ${Math.round(score)}%`}
            {size === "sm" && `${Math.round(score)}%`}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-sm">
            <p className="font-semibold">신뢰도: {Math.round(score)}점</p>
            <p className="text-muted-foreground">
              {grade === "high" && "높은 신뢰도 - 검증된 출처"}
              {grade === "medium" && "보통 신뢰도 - 추가 검증 권장"}
              {grade === "low" && "낮은 신뢰도 - 주의 필요"}
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

// ========== Sentiment Badge ==========

interface SentimentBadgeProps {
  label?: string;
  score?: number;
  loading?: boolean;
  size?: "sm" | "md" | "lg";
}

export const SentimentBadge: React.FC<SentimentBadgeProps> = ({
  label,
  score,
  loading = false,
  size = "md",
}) => {
  if (loading) {
    return <Skeleton className={cn("h-6", size === "sm" ? "w-12" : "w-14")} />;
  }

  if (!label) {
    return null;
  }

  const config = {
    positive: {
      icon: TrendingUp,
      label: "긍정",
      classes: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400",
    },
    negative: {
      icon: TrendingDown,
      label: "부정",
      classes: "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-900/30 dark:text-rose-400",
    },
    neutral: {
      icon: Minus,
      label: "중립",
      classes: "bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800/50 dark:text-slate-400",
    },
  };

  const { icon: Icon, label: displayLabel, classes } = config[label as keyof typeof config] || config.neutral;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn("gap-1", classes)}>
            <Icon className="h-3 w-3" />
            {size !== "sm" && displayLabel}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>감정 분석: {displayLabel}</p>
          {score !== undefined && <p className="text-muted-foreground">점수: {score.toFixed(2)}</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

// ========== Factcheck Badge ==========

interface FactcheckBadgeProps {
  status?: string;
  misinfoRisk?: string;
  loading?: boolean;
  size?: "sm" | "md" | "lg";
}

export const FactcheckBadge: React.FC<FactcheckBadgeProps> = ({
  status,
  misinfoRisk,
  loading = false,
  size = "md",
}) => {
  if (loading) {
    return <Skeleton className={cn("h-6", size === "sm" ? "w-12" : "w-16")} />;
  }

  if (!status && !misinfoRisk) {
    return null;
  }

  const config = {
    verified: {
      icon: CheckCircle,
      label: "검증됨",
      classes: "bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-400",
    },
    suspicious: {
      icon: AlertTriangle,
      label: "의심",
      classes: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400",
    },
    conflicting: {
      icon: AlertCircle,
      label: "상충",
      classes: "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400",
    },
    unverified: {
      icon: HelpCircle,
      label: "미검증",
      classes: "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800/50 dark:text-slate-400",
    },
  };

  const { icon: Icon, label, classes } = config[status as keyof typeof config] || config.unverified;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn("gap-1", classes)}>
            <Icon className="h-3 w-3" />
            {size !== "sm" && label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-sm">
            <p className="font-semibold">팩트체크: {label}</p>
            {misinfoRisk && (
              <p className="text-muted-foreground">
                허위정보 위험도: {misinfoRisk === "high" ? "높음" : misinfoRisk === "mid" ? "중간" : "낮음"}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

// ========== Bias Badge ==========

interface BiasBadgeProps {
  label?: string;
  score?: number;
  loading?: boolean;
  size?: "sm" | "md" | "lg";
}

export const BiasBadge: React.FC<BiasBadgeProps> = ({
  label,
  score,
  loading = false,
  size = "md",
}) => {
  if (loading) {
    return <Skeleton className={cn("h-6", size === "sm" ? "w-12" : "w-14")} />;
  }

  if (!label) {
    return null;
  }

  const config: Record<string, { label: string; classes: string }> = {
    left: {
      label: "진보",
      classes: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400",
    },
    right: {
      label: "보수",
      classes: "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-400",
    },
    center: {
      label: "중도",
      classes: "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/30 dark:text-purple-400",
    },
  };

  const { label: displayLabel, classes } = config[label] || { label, classes: "bg-slate-100 text-slate-700" };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn("gap-1", classes)}>
            {size !== "sm" && `편향: ${displayLabel}`}
            {size === "sm" && displayLabel}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>편향도 분석: {displayLabel}</p>
          {score !== undefined && <p className="text-muted-foreground">점수: {score.toFixed(2)}</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

// ========== Discussion Badge ==========

interface DiscussionBadgeProps {
  hasDiscussion?: boolean;
  totalCommentCount?: number;
  sentiment?: string;
  loading?: boolean;
  size?: "sm" | "md" | "lg";
}

export const DiscussionBadge: React.FC<DiscussionBadgeProps> = ({
  hasDiscussion,
  totalCommentCount,
  sentiment,
  loading = false,
  size = "md",
}) => {
  if (loading) {
    return <Skeleton className={cn("h-6", size === "sm" ? "w-12" : "w-16")} />;
  }

  if (!hasDiscussion || !totalCommentCount) {
    return null;
  }

  const sentimentConfig: Record<string, string> = {
    positive: "text-emerald-600",
    negative: "text-rose-600",
    neutral: "text-slate-600",
    mixed: "text-amber-600",
  };

  const formatCount = (count: number) => {
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
    return count.toString();
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="gap-1 bg-slate-50 dark:bg-slate-800/50">
            <MessageSquare className={cn("h-3 w-3", sentimentConfig[sentiment || "neutral"])} />
            {formatCount(totalCommentCount)}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-sm">
            <p className="font-semibold">댓글/여론: {totalCommentCount}건</p>
            {sentiment && (
              <p className="text-muted-foreground">
                전반적 분위기:{" "}
                {sentiment === "positive"
                  ? "긍정적"
                  : sentiment === "negative"
                  ? "부정적"
                  : sentiment === "mixed"
                  ? "혼재"
                  : "중립적"}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

// ========== Risk Tags ==========

interface RiskTagsProps {
  tags?: string[];
  loading?: boolean;
  maxShow?: number;
}

export const RiskTags: React.FC<RiskTagsProps> = ({
  tags,
  loading = false,
  maxShow = 2,
}) => {
  if (loading) {
    return <Skeleton className="h-5 w-20" />;
  }

  if (!tags || tags.length === 0) {
    return null;
  }

  const tagLabels: Record<string, string> = {
    clickbait: "낚시성",
    sensational: "선정적",
    unverified_source: "미검증 출처",
    opinion_piece: "의견 기사",
    sponsored: "협찬/광고",
    outdated: "오래된 정보",
  };

  const visibleTags = tags.slice(0, maxShow);
  const hiddenCount = tags.length - maxShow;

  return (
    <div className="flex flex-wrap gap-1">
      {visibleTags.map((tag) => (
        <Badge
          key={tag}
          variant="outline"
          className="text-xs bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400"
        >
          {tagLabels[tag] || tag}
        </Badge>
      ))}
      {hiddenCount > 0 && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="text-xs">
                +{hiddenCount}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-sm">
                {tags.slice(maxShow).map((tag) => (
                  <p key={tag}>{tagLabels[tag] || tag}</p>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
};

// ========== Combined Analysis Badges ==========

interface AnalysisBadgesProps {
  data: AnalysisData;
  loading?: boolean;
  size?: "sm" | "md" | "lg";
  showAll?: boolean;
}

export const AnalysisBadges: React.FC<AnalysisBadgesProps> = ({
  data,
  loading = false,
  size = "md",
  showAll = false,
}) => {
  const isLoading = loading || data.analysisStatus === "pending";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <ReliabilityBadge
        score={data.reliabilityScore}
        grade={data.reliabilityGrade}
        color={data.reliabilityColor}
        loading={isLoading}
        size={size}
      />
      <SentimentBadge
        label={data.sentimentLabel}
        score={data.sentimentScore}
        loading={isLoading}
        size={size}
      />
      {(showAll || data.factcheckStatus) && (
        <FactcheckBadge
          status={data.factcheckStatus}
          misinfoRisk={data.misinfoRisk}
          loading={isLoading}
          size={size}
        />
      )}
      {(showAll || data.biasLabel) && (
        <BiasBadge
          label={data.biasLabel}
          score={data.biasScore}
          loading={isLoading}
          size={size}
        />
      )}
      <DiscussionBadge
        hasDiscussion={data.hasDiscussion}
        totalCommentCount={data.totalCommentCount}
        sentiment={data.discussionSentiment}
        loading={isLoading}
        size={size}
      />
      {data.riskTags && data.riskTags.length > 0 && (
        <RiskTags tags={data.riskTags} loading={isLoading} />
      )}
    </div>
  );
};

export default AnalysisBadges;

```

---

## frontend/src/components/AnalysisExportMenu.tsx

```tsx
/**
 * AnalysisExportMenu - AI 분석 결과 내보내기 메뉴
 * 
 * PDF, Markdown, HTML, 텍스트 형식으로 내보내기 지원
 */

import { useState, useCallback } from 'react';
import { 
  Download, 
  FileText, 
  FileCode, 
  FileType2, 
  Copy, 
  Check,
  Loader2,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import {
  exportUnifiedSearchReport,
  triggerPdfDownload,
  type ReportRequest,
} from '@/lib/api';

interface AnalysisExportMenuProps {
  /** AI 분석 내용 (마크다운) */
  content: string;
  /** 검색 쿼리 */
  query: string;
  /** Job ID (PDF 생성용) */
  jobId?: string;
  /** 버튼 크기 */
  size?: 'default' | 'sm' | 'lg' | 'icon';
  /** 버튼 변형 */
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  /** 비활성화 */
  disabled?: boolean;
}

/**
 * HTML 템플릿 생성
 */
const generateHtmlReport = (content: string, query: string): string => {
  const timestamp = new Date().toLocaleString('ko-KR');
  
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NewsInsight AI 분석 - ${query}</title>
  <style>
    :root {
      --primary: #7c3aed;
      --primary-light: #a78bfa;
      --bg: #ffffff;
      --text: #1f2937;
      --text-muted: #6b7280;
      --border: #e5e7eb;
      --section-summary: #eff6ff;
      --section-verify: #f0fdf4;
      --section-data: #faf5ff;
      --section-view: #fff7ed;
      --section-warn: #fffbeb;
      --section-conclusion: #eef2ff;
    }
    
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #111827;
        --text: #f9fafb;
        --text-muted: #9ca3af;
        --border: #374151;
        --section-summary: #1e3a5f;
        --section-verify: #14532d;
        --section-data: #3b0764;
        --section-view: #431407;
        --section-warn: #422006;
        --section-conclusion: #1e1b4b;
      }
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans KR', sans-serif;
      line-height: 1.7;
      color: var(--text);
      background: var(--bg);
      max-width: 900px;
      margin: 0 auto;
      padding: 2rem;
    }
    
    header {
      text-align: center;
      padding-bottom: 2rem;
      margin-bottom: 2rem;
      border-bottom: 2px solid var(--primary);
    }
    
    header h1 {
      color: var(--primary);
      font-size: 1.5rem;
      margin-bottom: 0.5rem;
    }
    
    header .query {
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
    
    header .meta {
      color: var(--text-muted);
      font-size: 0.875rem;
    }
    
    h2 {
      font-size: 1.25rem;
      padding: 0.75rem 1rem;
      margin: 1.5rem 0 1rem;
      border-left: 4px solid var(--primary);
      border-radius: 0 0.5rem 0.5rem 0;
    }
    
    h2:has(+ *):nth-of-type(1), h2:contains("요약") { background: var(--section-summary); }
    h2:contains("검증") { background: var(--section-verify); }
    h2:contains("데이터"), h2:contains("수치") { background: var(--section-data); }
    h2:contains("관점") { background: var(--section-view); }
    h2:contains("주의") { background: var(--section-warn); }
    h2:contains("결론") { background: var(--section-conclusion); }
    
    h3 {
      font-size: 1rem;
      margin: 1.25rem 0 0.75rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--border);
    }
    
    p { margin: 0.75rem 0; }
    
    ul, ol { padding-left: 1.5rem; margin: 0.75rem 0; }
    li { margin: 0.5rem 0; }
    
    strong { font-weight: 600; color: var(--text); }
    
    a { color: var(--primary); text-decoration: none; }
    a:hover { text-decoration: underline; }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1rem 0;
      font-size: 0.9rem;
      border-radius: 0.5rem;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    
    th, td {
      padding: 0.75rem 1rem;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    
    th {
      background: var(--border);
      font-weight: 600;
    }
    
    tr:hover { background: rgba(124, 58, 237, 0.05); }
    
    .badge {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.75rem;
      font-weight: 500;
    }
    
    .badge-high { background: #dcfce7; color: #166534; }
    .badge-medium { background: #fef9c3; color: #854d0e; }
    .badge-low { background: #fee2e2; color: #991b1b; }
    
    blockquote {
      margin: 1rem 0;
      padding: 0.75rem 1rem;
      border-left: 4px solid var(--primary-light);
      background: rgba(124, 58, 237, 0.05);
      border-radius: 0 0.5rem 0.5rem 0;
      font-style: italic;
      color: var(--text-muted);
    }
    
    code {
      background: var(--border);
      padding: 0.125rem 0.375rem;
      border-radius: 0.25rem;
      font-family: 'Fira Code', monospace;
      font-size: 0.875em;
    }
    
    hr {
      border: none;
      border-top: 2px dashed var(--border);
      margin: 2rem 0;
    }
    
    footer {
      margin-top: 3rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--border);
      text-align: center;
      color: var(--text-muted);
      font-size: 0.875rem;
    }
    
    @media print {
      body { padding: 1rem; }
      h2 { break-after: avoid; }
      table { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <header>
    <h1>NewsInsight AI 분석 보고서</h1>
    <div class="query">"${query}"</div>
    <div class="meta">생성 시간: ${timestamp}</div>
  </header>
  
  <main>
    ${markdownToHtml(content)}
  </main>
  
  <footer>
    <p>이 보고서는 NewsInsight AI에 의해 자동 생성되었습니다.</p>
    <p>모든 정보는 참고용이며, 최종 판단은 사용자의 몫입니다.</p>
  </footer>
</body>
</html>`;
};

/**
 * 간단한 마크다운 -> HTML 변환
 */
const markdownToHtml = (md: string): string => {
  let html = md
    // 헤더
    .replace(/^### \[([^\]]+)\] (.+)$/gm, '<h3>$1: $2</h3>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## \[([^\]]+)\] (.+)$/gm, '<h2>$1: $2</h2>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    // 테이블
    .replace(/\|(.+)\|/g, (match) => {
      const cells = match.split('|').filter(c => c.trim());
      if (cells.every(c => c.trim().match(/^-+$/))) {
        return ''; // 구분선 제거
      }
      const isHeader = cells.some(c => c.includes('사실') || c.includes('출처') || c.includes('검증'));
      const tag = isHeader ? 'th' : 'td';
      const row = cells.map(c => {
        let content = c.trim();
        // 검증 수준 배지
        if (content.match(/^(높음|중간|낮음)$/)) {
          const badgeClass = content === '높음' ? 'badge-high' : content === '중간' ? 'badge-medium' : 'badge-low';
          content = `<span class="badge ${badgeClass}">${content}</span>`;
        }
        return `<${tag}>${content}</${tag}>`;
      }).join('');
      return `<tr>${row}</tr>`;
    })
    // 테이블 래퍼
    .replace(/(<tr>.*<\/tr>\n?)+/gs, '<table>$&</table>')
    // 굵게
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // 기울임
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // 링크
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    // 리스트
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/gs, '<ul>$&</ul>')
    // 인용
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // 코드
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // 구분선
    .replace(/^---$/gm, '<hr>')
    // 단락
    .replace(/^(?!<[a-z])(.*[^\n])$/gm, '<p>$1</p>')
    // 빈 p 태그 제거
    .replace(/<p>\s*<\/p>/g, '');
  
  return html;
};

/**
 * 파일 다운로드 트리거
 */
const downloadFile = (content: string, filename: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * AI 분석 결과 내보내기 메뉴 컴포넌트
 */
export function AnalysisExportMenu({
  content,
  query,
  jobId,
  size = 'sm',
  variant = 'outline',
  disabled = false,
}: AnalysisExportMenuProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const safeQuery = query.replace(/[^가-힣a-zA-Z0-9]/g, '_').slice(0, 30);
  const baseFilename = `NewsInsight_AI분석_${safeQuery}_${timestamp}`;

  // PDF 내보내기
  const handleExportPdf = useCallback(async () => {
    if (!jobId) {
      toast.error('PDF 내보내기는 검색 작업 ID가 필요합니다.');
      return;
    }
    
    setIsExporting(true);
    try {
      const request: ReportRequest = {
        reportType: 'UNIFIED_SEARCH',
        targetId: jobId,
        query,
        timeWindow: '7d',
        includeSections: ['COVER', 'EXECUTIVE_SUMMARY'],
        chartImages: {},
        language: 'ko',
      };
      
      const blob = await exportUnifiedSearchReport(jobId, request);
      triggerPdfDownload(blob, `${baseFilename}.pdf`);
      toast.success('PDF 보고서가 다운로드되었습니다.');
    } catch (error) {
      console.error('PDF export failed:', error);
      toast.error('PDF 생성에 실패했습니다.');
    } finally {
      setIsExporting(false);
    }
  }, [jobId, query, baseFilename]);

  // Markdown 내보내기
  const handleExportMarkdown = useCallback(() => {
    const mdContent = `# NewsInsight AI 분석 보고서

**검색어**: ${query}  
**생성 시간**: ${new Date().toLocaleString('ko-KR')}

---

${content}

---

*이 보고서는 NewsInsight AI에 의해 자동 생성되었습니다.*
`;
    downloadFile(mdContent, `${baseFilename}.md`, 'text/markdown;charset=utf-8');
    toast.success('Markdown 파일이 다운로드되었습니다.');
  }, [content, query, baseFilename]);

  // HTML 내보내기
  const handleExportHtml = useCallback(() => {
    const htmlContent = generateHtmlReport(content, query);
    downloadFile(htmlContent, `${baseFilename}.html`, 'text/html;charset=utf-8');
    toast.success('HTML 파일이 다운로드되었습니다.');
  }, [content, query, baseFilename]);

  // 텍스트 내보내기
  const handleExportText = useCallback(() => {
    // 마크다운 문법 제거
    const plainText = content
      .replace(/#{1,6}\s/g, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\|/g, ' | ');
    
    const textContent = `NewsInsight AI 분석 보고서
========================================

검색어: ${query}
생성 시간: ${new Date().toLocaleString('ko-KR')}

========================================

${plainText}

========================================

이 보고서는 NewsInsight AI에 의해 자동 생성되었습니다.
`;
    downloadFile(textContent, `${baseFilename}.txt`, 'text/plain;charset=utf-8');
    toast.success('텍스트 파일이 다운로드되었습니다.');
  }, [content, query, baseFilename]);

  // 클립보드 복사
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success('클립보드에 복사되었습니다.');
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.error('복사에 실패했습니다.');
    }
  }, [content]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} disabled={disabled || isExporting}>
          {isExporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          <span className="ml-1.5">내보내기</span>
          <ChevronDown className="h-3 w-3 ml-1 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>내보내기 형식</DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        {jobId && (
          <DropdownMenuItem onClick={handleExportPdf} disabled={isExporting}>
            <FileText className="h-4 w-4 mr-2 text-red-600" />
            PDF 보고서
          </DropdownMenuItem>
        )}
        
        <DropdownMenuItem onClick={handleExportMarkdown}>
          <FileCode className="h-4 w-4 mr-2 text-blue-600" />
          Markdown (.md)
        </DropdownMenuItem>
        
        <DropdownMenuItem onClick={handleExportHtml}>
          <FileType2 className="h-4 w-4 mr-2 text-orange-600" />
          HTML 웹페이지
        </DropdownMenuItem>
        
        <DropdownMenuItem onClick={handleExportText}>
          <FileText className="h-4 w-4 mr-2 text-gray-600" />
          텍스트 (.txt)
        </DropdownMenuItem>
        
        <DropdownMenuSeparator />
        
        <DropdownMenuItem onClick={handleCopy}>
          {copied ? (
            <Check className="h-4 w-4 mr-2 text-green-600" />
          ) : (
            <Copy className="h-4 w-4 mr-2" />
          )}
          클립보드 복사
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default AnalysisExportMenu;

```

---

## frontend/src/components/AnalysisProgressTimeline.tsx

```tsx
import { useMemo } from "react";
import {
  Search,
  Globe,
  FileText,
  Brain,
  CheckCircle2,
  Loader2,
  Circle,
  AlertCircle,
  Clock,
  Sparkles,
  Database,
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

/** 분석 단계 정의 */
export type AnalysisStep =
  | "queued"
  | "initializing"
  | "searching"
  | "collecting"
  | "analyzing"
  | "classifying"
  | "summarizing"
  | "completed"
  | "failed";

export interface AnalysisStepInfo {
  id: AnalysisStep;
  label: string;
  description: string;
  icon: typeof Search;
  estimatedDuration?: number; // seconds
}

/** 기본 분석 단계 설정 */
export const DEFAULT_ANALYSIS_STEPS: AnalysisStepInfo[] = [
  {
    id: "queued",
    label: "대기 중",
    description: "분석 요청이 대기열에 추가되었습니다",
    icon: Clock,
    estimatedDuration: 2,
  },
  {
    id: "initializing",
    label: "초기화",
    description: "분석 환경을 준비하고 있습니다",
    icon: Sparkles,
    estimatedDuration: 3,
  },
  {
    id: "searching",
    label: "검색 중",
    description: "웹에서 관련 정보를 검색하고 있습니다",
    icon: Globe,
    estimatedDuration: 15,
  },
  {
    id: "collecting",
    label: "수집 중",
    description: "검색된 페이지에서 정보를 수집하고 있습니다",
    icon: Database,
    estimatedDuration: 20,
  },
  {
    id: "analyzing",
    label: "분석 중",
    description: "AI가 수집된 정보를 분석하고 있습니다",
    icon: Brain,
    estimatedDuration: 30,
  },
  {
    id: "classifying",
    label: "분류 중",
    description: "증거를 입장별로 분류하고 있습니다",
    icon: Filter,
    estimatedDuration: 10,
  },
  {
    id: "summarizing",
    label: "요약 중",
    description: "분석 결과를 정리하고 있습니다",
    icon: FileText,
    estimatedDuration: 5,
  },
  {
    id: "completed",
    label: "완료",
    description: "분석이 완료되었습니다",
    icon: CheckCircle2,
  },
];

export interface StepProgress {
  step: AnalysisStep;
  status: "pending" | "active" | "completed" | "error";
  message?: string;
  startedAt?: string;
  completedAt?: string;
  itemsProcessed?: number;
  totalItems?: number;
}

interface AnalysisProgressTimelineProps {
  /** 현재 단계 */
  currentStep: AnalysisStep;
  /** 각 단계별 상세 진행 상황 */
  stepProgress?: StepProgress[];
  /** 전체 진행률 (0-100) */
  overallProgress?: number;
  /** 현재 진행 메시지 */
  message?: string;
  /** 수집된 항목 수 */
  collectedCount?: number;
  /** 실패 여부 */
  failed?: boolean;
  /** 에러 메시지 */
  errorMessage?: string;
  /** 분석 주제 */
  topic?: string;
  /** 단계 설정 (커스텀) */
  steps?: AnalysisStepInfo[];
  /** 컴팩트 모드 */
  compact?: boolean;
  /** 추가 CSS 클래스 */
  className?: string;
}

/** 단계 인덱스 계산 */
const getStepIndex = (step: AnalysisStep, steps: AnalysisStepInfo[]): number => {
  return steps.findIndex((s) => s.id === step);
};

/** 단계 상태 결정 */
const getStepStatus = (
  stepInfo: AnalysisStepInfo,
  currentStep: AnalysisStep,
  steps: AnalysisStepInfo[],
  failed: boolean
): "pending" | "active" | "completed" | "error" => {
  const currentIndex = getStepIndex(currentStep, steps);
  const stepIndex = getStepIndex(stepInfo.id, steps);

  if (failed && stepIndex === currentIndex) return "error";
  if (stepIndex < currentIndex) return "completed";
  if (stepIndex === currentIndex) return "active";
  return "pending";
};

export function AnalysisProgressTimeline({
  currentStep,
  stepProgress,
  overallProgress,
  message,
  collectedCount,
  failed = false,
  errorMessage,
  topic,
  steps = DEFAULT_ANALYSIS_STEPS,
  compact = false,
  className,
}: AnalysisProgressTimelineProps) {
  // 진행 중인 단계들만 표시 (completed 제외, 실패가 아닐 때)
  const visibleSteps = useMemo(() => {
    if (failed) return steps;
    const completedIndex = steps.findIndex((s) => s.id === "completed");
    if (currentStep === "completed") return steps;
    return steps.slice(0, completedIndex);
  }, [steps, currentStep, failed]);

  // 전체 진행률 계산
  const calculatedProgress = useMemo(() => {
    if (overallProgress !== undefined) return overallProgress;
    const currentIndex = getStepIndex(currentStep, steps);
    const totalSteps = steps.length - 1; // completed 제외
    if (currentStep === "completed") return 100;
    if (currentStep === "failed") return 0;
    return Math.round((currentIndex / totalSteps) * 100);
  }, [currentStep, steps, overallProgress]);

  // 컴팩트 모드
  if (compact) {
    return (
      <div className={cn("space-y-3", className)}>
        {/* 진행 바 */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {message || steps.find((s) => s.id === currentStep)?.description}
            </span>
            <span className="font-medium">{calculatedProgress}%</span>
          </div>
          <Progress value={calculatedProgress} className="h-2" />
        </div>

        {/* 현재 단계 표시 */}
        <div className="flex items-center gap-2">
          {(() => {
            const stepInfo = steps.find((s) => s.id === currentStep);
            if (!stepInfo) return null;
            const Icon = stepInfo.icon;
            const status = getStepStatus(stepInfo, currentStep, steps, failed);

            return (
              <>
                {status === "active" ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : status === "completed" ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : status === "error" ? (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                ) : (
                  <Icon className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="font-medium">{stepInfo.label}</span>
                {collectedCount !== undefined && collectedCount > 0 && (
                  <Badge variant="secondary" className="ml-auto">
                    {collectedCount}개 수집
                  </Badge>
                )}
              </>
            );
          })()}
        </div>
      </div>
    );
  }

  // 전체 타임라인 모드
  return (
    <div className={cn("space-y-6", className)}>
      {/* 헤더 */}
      {topic && (
        <div className="text-center">
          <h3 className="font-semibold text-lg">'{topic}' 분석 중</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {message || "AI가 웹에서 정보를 수집하고 분석하고 있습니다."}
          </p>
        </div>
      )}

      {/* 전체 진행률 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">전체 진행률</span>
          <span className="font-medium">{calculatedProgress}%</span>
        </div>
        <Progress value={calculatedProgress} className="h-3" />
        {collectedCount !== undefined && collectedCount > 0 && (
          <p className="text-sm text-center text-muted-foreground">
            현재까지 <span className="font-medium text-foreground">{collectedCount}개</span>의
            증거를 수집했습니다
          </p>
        )}
      </div>

      {/* 단계별 타임라인 */}
      <div className="relative">
        {/* 연결선 */}
        <div className="absolute left-[15px] top-0 bottom-0 w-0.5 bg-border" />

        <div className="space-y-1">
          {visibleSteps.map((stepInfo, index) => {
            const status = getStepStatus(stepInfo, currentStep, steps, failed);
            const Icon = stepInfo.icon;
            const progressInfo = stepProgress?.find((p) => p.step === stepInfo.id);

            return (
              <div
                key={stepInfo.id}
                className={cn(
                  "relative flex items-start gap-4 p-3 rounded-lg transition-all",
                  status === "active" && "bg-primary/5",
                  status === "error" && "bg-destructive/5"
                )}
              >
                {/* 아이콘 */}
                <div
                  className={cn(
                    "relative z-10 flex items-center justify-center w-8 h-8 rounded-full border-2 transition-all",
                    status === "completed" && "bg-green-500 border-green-500 text-white",
                    status === "active" && "bg-primary border-primary text-primary-foreground",
                    status === "error" && "bg-destructive border-destructive text-destructive-foreground",
                    status === "pending" && "bg-background border-muted-foreground/30 text-muted-foreground"
                  )}
                >
                  {status === "active" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : status === "completed" ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : status === "error" ? (
                    <AlertCircle className="h-4 w-4" />
                  ) : (
                    <Circle className="h-3 w-3" />
                  )}
                </div>

                {/* 내용 */}
                <div className="flex-1 min-w-0 pt-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "font-medium",
                        status === "active" && "text-primary",
                        status === "completed" && "text-green-600",
                        status === "error" && "text-destructive",
                        status === "pending" && "text-muted-foreground"
                      )}
                    >
                      {stepInfo.label}
                    </span>
                    {status === "active" && progressInfo?.itemsProcessed !== undefined && (
                      <Badge variant="secondary" className="text-xs">
                        {progressInfo.itemsProcessed}
                        {progressInfo.totalItems ? `/${progressInfo.totalItems}` : ""}
                      </Badge>
                    )}
                  </div>
                  <p
                    className={cn(
                      "text-sm",
                      status === "active" ? "text-muted-foreground" : "text-muted-foreground/70"
                    )}
                  >
                    {progressInfo?.message || stepInfo.description}
                  </p>
                  {status === "error" && errorMessage && (
                    <p className="text-sm text-destructive mt-1">{errorMessage}</p>
                  )}
                </div>

                {/* 시간 표시 */}
                {progressInfo?.completedAt && status === "completed" && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(progressInfo.completedAt).toLocaleTimeString("ko-KR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 안내 메시지 */}
      <p className="text-xs text-center text-muted-foreground">
        다른 페이지로 이동해도 분석은 백그라운드에서 계속됩니다
      </p>
    </div>
  );
}

/** 간단한 인라인 진행률 표시 */
export function InlineAnalysisProgress({
  currentStep,
  progress,
  message,
  collectedCount,
  className,
}: {
  currentStep: AnalysisStep;
  progress?: number;
  message?: string;
  collectedCount?: number;
  className?: string;
}) {
  const stepInfo = DEFAULT_ANALYSIS_STEPS.find((s) => s.id === currentStep);
  const Icon = stepInfo?.icon || Search;

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex items-center gap-2 text-sm">
        {currentStep === "completed" ? (
          <CheckCircle2 className="h-4 w-4 text-green-600" />
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        )}
        <span className="font-medium">{stepInfo?.label || currentStep}</span>
      </div>
      {progress !== undefined && (
        <Progress value={progress} className="flex-1 h-2 max-w-[200px]" />
      )}
      {collectedCount !== undefined && collectedCount > 0 && (
        <Badge variant="outline" className="text-xs">
          {collectedCount}개 수집
        </Badge>
      )}
      {message && (
        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
          {message}
        </span>
      )}
    </div>
  );
}

export default AnalysisProgressTimeline;

```

---

## frontend/src/components/BackgroundTaskIndicator.tsx

```tsx
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

```

---

## frontend/src/components/CommandPalette.tsx

```tsx
import { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Home,
  Bot,
  FolderOpen,
  History,
  Moon,
  Sun,
  FileJson,
  Command,
  Cpu,
  Brain,
  Shield,
  Database,
  Link as LinkIcon,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useTheme } from "@/contexts/ThemeContext";

interface CommandItem {
  id: string;
  label: string;
  icon: typeof Search;
  shortcut?: string;
  action: () => void;
  keywords?: string[];
  category: "navigation" | "search" | "settings" | "recent";
}

interface CommandPaletteProps {
  /** 외부에서 제어할 열림 상태 */
  open?: boolean;
  /** 열림 상태 변경 콜백 */
  onOpenChange?: (open: boolean) => void;
  /** 최근 검색어 목록 */
  recentSearches?: string[];
  /** 검색 실행 콜백 */
  onSearch?: (query: string) => void;
}

export function CommandPalette({
  open: externalOpen,
  onOpenChange,
  recentSearches = [],
  onSearch,
}: CommandPaletteProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  const isOpen = externalOpen ?? internalOpen;
  const setIsOpen = onOpenChange ?? setInternalOpen;

  // 단축키 등록
  useKeyboardShortcuts([
    {
      key: "ctrl+k",
      handler: () => setIsOpen(true),
      description: "검색 열기",
    },
    {
      key: "meta+k", // macOS Command+K
      handler: () => setIsOpen(true),
      description: "검색 열기",
    },
    {
      key: "escape",
      handler: () => setIsOpen(false),
      description: "닫기",
      enableInInput: true,
    },
  ]);

  // 명령어 목록 (Consolidated navigation)
  const commands = useMemo<CommandItem[]>(() => [
    // 네비게이션 - 통합 검색
    {
      id: "search",
      label: "검색 (통합/Deep/팩트체크/URL분석)",
      icon: Search,
      shortcut: "⌘H",
      action: () => { navigate("/"); setIsOpen(false); },
      keywords: ["home", "main", "홈", "메인", "검색", "search"],
      category: "navigation",
    },
    {
      id: "search-unified",
      label: "통합 검색 모드",
      icon: Search,
      action: () => { navigate("/?mode=unified"); setIsOpen(false); },
      keywords: ["unified", "통합", "검색"],
      category: "search",
    },
    {
      id: "search-deep",
      label: "Deep Search 모드",
      icon: Brain,
      shortcut: "⌘D",
      action: () => { navigate("/?mode=deep"); setIsOpen(false); },
      keywords: ["deep", "search", "ai", "분석", "심층"],
      category: "search",
    },
    {
      id: "search-factcheck",
      label: "팩트체크 모드",
      icon: Shield,
      shortcut: "⌘F",
      action: () => { navigate("/?mode=factcheck"); setIsOpen(false); },
      keywords: ["fact", "check", "verify", "팩트", "검증"],
      category: "search",
    },
    {
      id: "search-urlanalysis",
      label: "URL 분석 모드",
      icon: LinkIcon,
      shortcut: "⌘U",
      action: () => { navigate("/?mode=urlanalysis"); setIsOpen(false); },
      keywords: ["url", "analysis", "extract", "claim", "분석", "추출", "주장"],
      category: "search",
    },
    {
      id: "ml-addons",
      label: "ML Add-ons",
      icon: Cpu,
      action: () => { navigate("/ml-addons"); setIsOpen(false); },
      keywords: ["ml", "machine", "learning", "addon", "sentiment", "bias"],
      category: "navigation",
    },
    {
      id: "browser-agent",
      label: "브라우저 에이전트",
      icon: Bot,
      shortcut: "⌘B",
      action: () => { navigate("/ai-agent"); setIsOpen(false); },
      keywords: ["browser", "agent", "automation", "에이전트", "자동화"],
      category: "navigation",
    },
    {
      id: "url-collections",
      label: "URL 원천 관리",
      icon: Database,
      action: () => { navigate("/url-collections"); setIsOpen(false); },
      keywords: ["url", "source", "원천", "소스", "관리"],
      category: "navigation",
    },
    {
      id: "projects",
      label: "프로젝트",
      icon: FolderOpen,
      action: () => { navigate("/projects"); setIsOpen(false); },
      keywords: ["project", "프로젝트", "폴더", "collection"],
      category: "navigation",
    },
    {
      id: "search-history",
      label: "검색 기록",
      icon: History,
      action: () => { navigate("/history"); setIsOpen(false); },
      keywords: ["history", "기록", "이전"],
      category: "navigation",
    },
    {
      id: "admin-sources",
      label: "데이터 소스 관리 (Admin)",
      icon: FileJson,
      action: () => { navigate("/admin/sources"); setIsOpen(false); },
      keywords: ["admin", "source", "관리", "소스", "rss"],
      category: "navigation",
    },
    // 설정
    {
      id: "toggle-theme",
      label: theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환",
      icon: theme === "dark" ? Sun : Moon,
      shortcut: "⌘⇧T",
      action: () => {
        setTheme(theme === "dark" ? "light" : "dark");
        setIsOpen(false);
      },
      keywords: ["theme", "dark", "light", "테마", "다크", "라이트"],
      category: "settings",
    },
  ], [navigate, setIsOpen, theme, setTheme]);

  // 최근 검색어 명령어 추가
  const recentCommands = useMemo<CommandItem[]>(() => {
    return recentSearches.slice(0, 5).map((query, index) => ({
      id: `recent-${index}`,
      label: query,
      icon: Search,
      action: () => {
        if (onSearch) {
          onSearch(query);
        } else {
          navigate(`/?q=${encodeURIComponent(query)}`);
        }
        setIsOpen(false);
      },
      keywords: [query.toLowerCase()],
      category: "recent" as const,
    }));
  }, [recentSearches, navigate, setIsOpen, onSearch]);

  // 검색 실행
  const handleSearch = useCallback(() => {
    if (search.trim()) {
      if (onSearch) {
        onSearch(search.trim());
      } else {
        navigate(`/?q=${encodeURIComponent(search.trim())}`);
      }
      setIsOpen(false);
      setSearch("");
    }
  }, [search, onSearch, navigate, setIsOpen]);

  // Enter 키로 검색
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && search.trim()) {
      // 선택된 항목이 없을 때만 검색 실행
      const selectedItem = document.querySelector('[data-selected="true"]');
      if (!selectedItem) {
        handleSearch();
      }
    }
  }, [search, handleSearch]);

  // 네비게이션 단축키
  useKeyboardShortcuts([
    {
      key: "ctrl+h",
      handler: () => { navigate("/"); },
      description: "검색으로",
    },
    {
      key: "ctrl+d",
      handler: () => { navigate("/?mode=deep"); },
      description: "Deep Search 모드",
    },
    {
      key: "ctrl+shift+t",
      handler: () => { setTheme(theme === "dark" ? "light" : "dark"); },
      description: "테마 전환",
    },
  ], { enabled: !isOpen });

  return (
    <CommandDialog open={isOpen} onOpenChange={setIsOpen}>
      <CommandInput
        placeholder="검색어를 입력하거나 명령을 선택하세요..."
        value={search}
        onValueChange={setSearch}
        onKeyDown={handleKeyDown}
      />
      <CommandList>
        <CommandEmpty>
          {search.trim() ? (
            <div className="p-4 text-center">
              <p className="text-sm text-muted-foreground mb-2">
                "{search}"에 대한 결과가 없습니다
              </p>
              <button
                onClick={handleSearch}
                className="text-sm text-primary hover:underline"
              >
                이 검색어로 통합 검색하기
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">명령어가 없습니다</p>
          )}
        </CommandEmpty>

        {/* 최근 검색 */}
        {recentCommands.length > 0 && (
          <CommandGroup heading="최근 검색">
            {recentCommands.map((cmd) => (
              <CommandItem
                key={cmd.id}
                onSelect={cmd.action}
                className="gap-2"
              >
                <cmd.icon className="h-4 w-4" />
                <span>{cmd.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {recentCommands.length > 0 && <CommandSeparator />}

        {/* 검색 모드 */}
        <CommandGroup heading="검색 모드">
          {commands
            .filter((cmd) => cmd.category === "search")
            .map((cmd) => (
              <CommandItem
                key={cmd.id}
                onSelect={cmd.action}
                className="gap-2"
              >
                <cmd.icon className="h-4 w-4" />
                <span>{cmd.label}</span>
                {cmd.shortcut && (
                  <CommandShortcut>{cmd.shortcut}</CommandShortcut>
                )}
              </CommandItem>
            ))}
        </CommandGroup>

        <CommandSeparator />

        {/* 페이지 이동 */}
        <CommandGroup heading="페이지 이동">
          {commands
            .filter((cmd) => cmd.category === "navigation")
            .map((cmd) => (
              <CommandItem
                key={cmd.id}
                onSelect={cmd.action}
                className="gap-2"
              >
                <cmd.icon className="h-4 w-4" />
                <span>{cmd.label}</span>
                {cmd.shortcut && (
                  <CommandShortcut>{cmd.shortcut}</CommandShortcut>
                )}
              </CommandItem>
            ))}
        </CommandGroup>

        <CommandSeparator />

        {/* 설정 */}
        <CommandGroup heading="설정">
          {commands
            .filter((cmd) => cmd.category === "settings")
            .map((cmd) => (
              <CommandItem
                key={cmd.id}
                onSelect={cmd.action}
                className="gap-2"
              >
                <cmd.icon className="h-4 w-4" />
                <span>{cmd.label}</span>
                {cmd.shortcut && (
                  <CommandShortcut>{cmd.shortcut}</CommandShortcut>
                )}
              </CommandItem>
            ))}
        </CommandGroup>
      </CommandList>
      
      {/* 단축키 힌트 */}
      <div className="border-t px-3 py-2 flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px]">↑↓</kbd>
            탐색
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px]">↵</kbd>
            선택
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px]">esc</kbd>
            닫기
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Command className="h-3 w-3" />
          <span>+K로 열기</span>
        </div>
      </div>
    </CommandDialog>
  );
}

export default CommandPalette;

```

---

## frontend/src/components/DeriveSearchDialog.tsx

```tsx
import { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Search,
  Microscope,
  Shield,
  Link as LinkIcon,
  ExternalLink,
  Filter,
  CheckCircle2,
  Globe,
} from "lucide-react";
import type { SearchHistoryRecord, SearchHistoryType } from "@/lib/api";
import { useSearchRecord, type PriorityUrl } from "@/hooks/useSearchRecord";

interface DeriveSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchRecord: SearchHistoryRecord;
}

type ReuseOption = "query_only" | "query_and_all_urls" | "query_and_selected_urls";
type TargetPage = "unified" | "deep_search" | "fact_check";

const TARGET_PAGE_CONFIG: Record<TargetPage, { label: string; icon: typeof Search; path: string; color: string }> = {
  unified: {
    label: "통합 검색",
    icon: Search,
    path: "/search",
    color: "text-blue-600",
  },
  deep_search: {
    label: "Deep Search",
    icon: Microscope,
    path: "/deep-search",
    color: "text-purple-600",
  },
  fact_check: {
    label: "팩트체크",
    icon: Shield,
    path: "/fact-check",
    color: "text-green-600",
  },
};

// Suggest target page based on source search type
function suggestTargetPage(searchType: SearchHistoryType): TargetPage {
  switch (searchType) {
    case "UNIFIED":
      return "deep_search"; // Suggest deeper analysis
    case "DEEP_SEARCH":
      return "fact_check"; // Suggest verification
    case "FACT_CHECK":
      return "deep_search"; // Suggest more research
    default:
      return "unified";
  }
}

export function DeriveSearchDialog({
  open,
  onOpenChange,
  searchRecord,
}: DeriveSearchDialogProps) {
  const navigate = useNavigate();
  
  // Load URLs from the search record
  const { priorityUrls, loading } = useSearchRecord({
    searchId: searchRecord.id,
    autoLoad: open,
  });

  // State
  const [reuseOption, setReuseOption] = useState<ReuseOption>("query_and_all_urls");
  const [targetPage, setTargetPage] = useState<TargetPage>(() => suggestTargetPage(searchRecord.searchType));
  const [selectedUrlIds, setSelectedUrlIds] = useState<Set<string>>(new Set());
  const [urlFilter, setUrlFilter] = useState("");

  // Filter URLs based on search
  const filteredUrls = useMemo(() => {
    if (!urlFilter.trim()) return priorityUrls;
    const lowerFilter = urlFilter.toLowerCase();
    return priorityUrls.filter(
      (u) =>
        u.url.toLowerCase().includes(lowerFilter) ||
        u.name.toLowerCase().includes(lowerFilter)
    );
  }, [priorityUrls, urlFilter]);

  // Toggle URL selection
  const toggleUrl = useCallback((id: string) => {
    setSelectedUrlIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Select all visible URLs
  const selectAllVisible = useCallback(() => {
    setSelectedUrlIds((prev) => {
      const next = new Set(prev);
      filteredUrls.forEach((u) => next.add(u.id));
      return next;
    });
  }, [filteredUrls]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedUrlIds(new Set());
  }, []);

  // Get URLs to pass based on reuse option
  const getUrlsToPass = useCallback((): PriorityUrl[] => {
    switch (reuseOption) {
      case "query_only":
        return [];
      case "query_and_all_urls":
        return priorityUrls;
      case "query_and_selected_urls":
        return priorityUrls.filter((u) => selectedUrlIds.has(u.id));
      default:
        return [];
    }
  }, [reuseOption, priorityUrls, selectedUrlIds]);

  // Handle derive action
  const handleDerive = useCallback(() => {
    const config = TARGET_PAGE_CONFIG[targetPage];
    const urlsToPass = getUrlsToPass();

    const navigationState = {
      query: searchRecord.query,
      parentSearchId: searchRecord.id,
      deriveFrom: searchRecord.id,
      depthLevel: (searchRecord.depthLevel || 0) + 1,
      priorityUrls: urlsToPass,
      fromDeriveDialog: true,
    };

    navigate(config.path, { state: navigationState });
    onOpenChange(false);
  }, [targetPage, getUrlsToPass, searchRecord, navigate, onOpenChange]);

  const selectedCount = selectedUrlIds.size;
  const totalCount = priorityUrls.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            파생 검색 설정
          </DialogTitle>
          <DialogDescription>
            "{searchRecord.query}" 검색 결과를 기반으로 새로운 검색을 시작합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden space-y-6 py-4">
          {/* Target Page Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">대상 페이지</Label>
            <RadioGroup
              value={targetPage}
              onValueChange={(v) => setTargetPage(v as TargetPage)}
              className="grid grid-cols-3 gap-2"
            >
              {(Object.entries(TARGET_PAGE_CONFIG) as [TargetPage, typeof TARGET_PAGE_CONFIG[TargetPage]][]).map(
                ([key, config]) => {
                  const Icon = config.icon;
                  return (
                    <div key={key}>
                      <RadioGroupItem value={key} id={`target-${key}`} className="peer sr-only" />
                      <Label
                        htmlFor={`target-${key}`}
                        className={`
                          flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 cursor-pointer
                          peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5
                          hover:bg-muted/50 transition-colors
                        `}
                      >
                        <Icon className={`h-5 w-5 ${config.color}`} />
                        <span className="text-xs font-medium">{config.label}</span>
                      </Label>
                    </div>
                  );
                }
              )}
            </RadioGroup>
          </div>

          {/* Reuse Option Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">재사용 옵션</Label>
            <RadioGroup
              value={reuseOption}
              onValueChange={(v) => setReuseOption(v as ReuseOption)}
              className="space-y-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="query_only" id="reuse-query" />
                <Label htmlFor="reuse-query" className="text-sm cursor-pointer">
                  검색어만 재사용
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="query_and_all_urls" id="reuse-all" />
                <Label htmlFor="reuse-all" className="text-sm cursor-pointer flex items-center gap-2">
                  검색어 + 모든 URL ({totalCount}개)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="query_and_selected_urls" id="reuse-selected" />
                <Label htmlFor="reuse-selected" className="text-sm cursor-pointer flex items-center gap-2">
                  검색어 + 선택한 URL
                  {reuseOption === "query_and_selected_urls" && selectedCount > 0 && (
                    <Badge variant="secondary" className="ml-1">
                      {selectedCount}개 선택
                    </Badge>
                  )}
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* URL Selection (only when selecting specific URLs) */}
          {reuseOption === "query_and_selected_urls" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <LinkIcon className="h-4 w-4" />
                  URL 선택
                </Label>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={selectAllVisible} className="h-7 text-xs">
                    전체 선택
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clearSelection} className="h-7 text-xs">
                    선택 해제
                  </Button>
                </div>
              </div>

              {/* URL Filter */}
              <div className="relative">
                <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={urlFilter}
                  onChange={(e) => setUrlFilter(e.target.value)}
                  placeholder="URL 필터링..."
                  className="pl-8 h-8 text-sm"
                />
              </div>

              {/* URL List */}
              {loading ? (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  URL 목록을 불러오는 중...
                </div>
              ) : filteredUrls.length === 0 ? (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  {urlFilter ? "필터와 일치하는 URL이 없습니다." : "재사용 가능한 URL이 없습니다."}
                </div>
              ) : (
                <ScrollArea className="h-[200px] border rounded-lg">
                  <div className="p-2 space-y-1">
                    {filteredUrls.map((url) => {
                      const isSelected = selectedUrlIds.has(url.id);
                      return (
                        <div
                          key={url.id}
                          className={`
                            flex items-center gap-2 p-2 rounded-md cursor-pointer
                            hover:bg-muted/50 transition-colors
                            ${isSelected ? "bg-primary/5" : ""}
                          `}
                          onClick={() => toggleUrl(url.id)}
                        >
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleUrl(url.id)}
                            className="pointer-events-none"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{url.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{url.url}</p>
                          </div>
                          {url.reliability && (
                            <Badge
                              variant="outline"
                              className={`text-xs shrink-0 ${
                                url.reliability === "high"
                                  ? "border-green-500 text-green-600"
                                  : url.reliability === "medium"
                                  ? "border-yellow-500 text-yellow-600"
                                  : "border-red-500 text-red-600"
                              }`}
                            >
                              {url.reliability === "high" ? "높음" : url.reliability === "medium" ? "보통" : "낮음"}
                            </Badge>
                          )}
                          <a
                            href={url.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 rounded hover:bg-muted"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                          </a>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}

          {/* Summary */}
          <div className="p-3 rounded-lg bg-muted/50 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>
                <strong>{TARGET_PAGE_CONFIG[targetPage].label}</strong>로{" "}
                {reuseOption === "query_only"
                  ? "검색어만"
                  : reuseOption === "query_and_all_urls"
                  ? `검색어와 ${totalCount}개 URL`
                  : `검색어와 ${selectedCount}개 URL`}{" "}
                전달됩니다.
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            onClick={handleDerive}
            disabled={reuseOption === "query_and_selected_urls" && selectedCount === 0}
          >
            파생 검색 시작
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DeriveSearchDialog;

```

---

## frontend/src/components/EnhancedMarkdownRenderer.tsx

```tsx
/**
 * EnhancedMarkdownRenderer - 고급 마크다운 렌더러
 * 
 * AI 분석 결과를 위한 고급 마크다운 렌더링 컴포넌트
 * - 섹션별 스타일링 (요약, 검증, 데이터 등)
 * - 테이블 고급 스타일링
 * - 코드 하이라이팅
 * - 인터랙티브 요소
 */

import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { 
  ExternalLink, 
  CheckCircle2, 
  AlertTriangle, 
  Info, 
  FileText, 
  BarChart3,
  MessageSquare,
  AlertCircle,
  Lightbulb,
  BookOpen,
  Shield,
  TrendingUp,
  List,
  Quote
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface EnhancedMarkdownRendererProps {
  content: string;
  className?: string;
  isStreaming?: boolean;
  variant?: 'default' | 'compact' | 'report';
}

// 섹션 헤더 아이콘 매핑
const SECTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  '요약': FileText,
  '핵심 요약': FileText,
  '검증': CheckCircle2,
  '검증된 사실': CheckCircle2,
  '사실': CheckCircle2,
  '데이터': BarChart3,
  '주요 수치': BarChart3,
  '수치': TrendingUp,
  '관점': MessageSquare,
  '다양한 관점': MessageSquare,
  '주의': AlertTriangle,
  '주의사항': AlertTriangle,
  '한계': AlertCircle,
  '결론': Lightbulb,
  '배경': BookOpen,
  '배경 지식': BookOpen,
  '신뢰도': Shield,
  '목록': List,
  '인용': Quote,
};

// 섹션 스타일 매핑
const SECTION_STYLES: Record<string, { bg: string; border: string; icon: string }> = {
  '요약': { bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-l-blue-500', icon: 'text-blue-600' },
  '핵심 요약': { bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-l-blue-500', icon: 'text-blue-600' },
  '검증': { bg: 'bg-green-50 dark:bg-green-950/30', border: 'border-l-green-500', icon: 'text-green-600' },
  '검증된 사실': { bg: 'bg-green-50 dark:bg-green-950/30', border: 'border-l-green-500', icon: 'text-green-600' },
  '사실': { bg: 'bg-green-50 dark:bg-green-950/30', border: 'border-l-green-500', icon: 'text-green-600' },
  '데이터': { bg: 'bg-purple-50 dark:bg-purple-950/30', border: 'border-l-purple-500', icon: 'text-purple-600' },
  '주요 수치': { bg: 'bg-purple-50 dark:bg-purple-950/30', border: 'border-l-purple-500', icon: 'text-purple-600' },
  '관점': { bg: 'bg-orange-50 dark:bg-orange-950/30', border: 'border-l-orange-500', icon: 'text-orange-600' },
  '다양한 관점': { bg: 'bg-orange-50 dark:bg-orange-950/30', border: 'border-l-orange-500', icon: 'text-orange-600' },
  '주의': { bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-l-amber-500', icon: 'text-amber-600' },
  '주의사항': { bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-l-amber-500', icon: 'text-amber-600' },
  '결론': { bg: 'bg-indigo-50 dark:bg-indigo-950/30', border: 'border-l-indigo-500', icon: 'text-indigo-600' },
  '배경': { bg: 'bg-slate-50 dark:bg-slate-950/30', border: 'border-l-slate-500', icon: 'text-slate-600' },
};

// 검증 수준 배지 컴포넌트
const VerificationBadge = ({ level }: { level: string }) => {
  const normalized = level.toLowerCase();
  if (normalized.includes('높음') || normalized.includes('high')) {
    return <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 text-xs">높음</Badge>;
  }
  if (normalized.includes('중간') || normalized.includes('medium')) {
    return <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300 text-xs">중간</Badge>;
  }
  if (normalized.includes('낮음') || normalized.includes('low')) {
    return <Badge className="bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 text-xs">낮음</Badge>;
  }
  return <Badge variant="outline" className="text-xs">{level}</Badge>;
};

/**
 * 고급 마크다운 렌더러
 */
export const EnhancedMarkdownRenderer = memo(function EnhancedMarkdownRenderer({
  content,
  className,
  isStreaming = false,
  variant = 'default',
}: EnhancedMarkdownRendererProps) {
  
  // 섹션 헤더 텍스트에서 아이콘과 스타일 추출
  const getSectionInfo = (text: string) => {
    // [요약], [검증] 등의 패턴 감지
    const match = text.match(/\[([^\]]+)\]/);
    if (match) {
      const sectionName = match[1];
      return {
        name: sectionName,
        icon: SECTION_ICONS[sectionName],
        style: SECTION_STYLES[sectionName],
      };
    }
    
    // 패턴 없이 키워드로 감지
    for (const [keyword, icon] of Object.entries(SECTION_ICONS)) {
      if (text.includes(keyword)) {
        return {
          name: keyword,
          icon,
          style: SECTION_STYLES[keyword],
        };
      }
    }
    
    return null;
  };

  const variantStyles = useMemo(() => {
    switch (variant) {
      case 'compact':
        return 'text-sm';
      case 'report':
        return 'text-base leading-relaxed';
      default:
        return '';
    }
  }, [variant]);

  return (
    <div
      className={cn(
        // Base prose styles
        "prose prose-sm dark:prose-invert max-w-none",
        // Headings
        "prose-headings:font-semibold prose-headings:text-foreground",
        "prose-h1:text-xl prose-h1:mt-6 prose-h1:mb-3",
        "prose-h2:text-lg prose-h2:mt-5 prose-h2:mb-3",
        "prose-h3:text-base prose-h3:mt-4 prose-h3:mb-2",
        // Paragraphs
        "prose-p:my-2.5 prose-p:leading-relaxed prose-p:text-foreground/90",
        // Lists
        "prose-ul:my-3 prose-ul:pl-5",
        "prose-ol:my-3 prose-ol:pl-5",
        "prose-li:my-1 prose-li:marker:text-primary/70",
        // Strong/Bold
        "prose-strong:font-semibold prose-strong:text-foreground",
        // Links
        "prose-a:text-primary prose-a:no-underline prose-a:font-medium hover:prose-a:underline",
        // Blockquotes
        "prose-blockquote:border-l-4 prose-blockquote:border-primary/40",
        "prose-blockquote:pl-4 prose-blockquote:py-1 prose-blockquote:italic",
        "prose-blockquote:text-muted-foreground prose-blockquote:bg-muted/30 prose-blockquote:rounded-r-lg",
        // Code
        "prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md",
        "prose-code:font-mono prose-code:text-sm prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:bg-slate-900 dark:prose-pre:bg-slate-950 prose-pre:rounded-xl prose-pre:p-4 prose-pre:shadow-lg",
        // Horizontal rule
        "prose-hr:border-border prose-hr:my-6",
        variantStyles,
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 외부 링크 스타일링
          a: ({ href, children, ...props }) => {
            const isExternal = href?.startsWith("http");
            return (
              <a
                href={href}
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noopener noreferrer" : undefined}
                className="inline-flex items-center gap-1 text-primary hover:text-primary/80 transition-colors"
                {...props}
              >
                {children}
                {isExternal && <ExternalLink className="h-3 w-3 inline-block opacity-70" />}
              </a>
            );
          },
          
          // H2 - 주요 섹션 헤더 (색상 + 아이콘)
          h2: ({ children, ...props }) => {
            const text = String(children);
            const sectionInfo = getSectionInfo(text);
            const Icon = sectionInfo?.icon;
            const style = sectionInfo?.style;
            
            // 표시할 텍스트 ([] 패턴 제거)
            const displayText = text.replace(/\[([^\]]+)\]\s*/, '');
            
            return (
              <h2 
                className={cn(
                  "flex items-center gap-2 py-2 px-3 -mx-3 rounded-lg mt-6 mb-4",
                  style?.bg || "bg-muted/50",
                  "border-l-4",
                  style?.border || "border-l-primary"
                )} 
                {...props}
              >
                {Icon && <Icon className={cn("h-5 w-5", style?.icon || "text-primary")} />}
                <span className="font-semibold">{displayText}</span>
              </h2>
            );
          },
          
          // H3 - 서브 섹션 헤더
          h3: ({ children, ...props }) => {
            const text = String(children);
            const sectionInfo = getSectionInfo(text);
            const Icon = sectionInfo?.icon;
            const style = sectionInfo?.style;
            
            const displayText = text.replace(/\[([^\]]+)\]\s*/, '');
            
            return (
              <h3 
                className={cn(
                  "flex items-center gap-2 py-1.5 mt-4 mb-2",
                  "border-b border-border/50 pb-1"
                )} 
                {...props}
              >
                {Icon && <Icon className={cn("h-4 w-4", style?.icon || "text-muted-foreground")} />}
                <span className="font-medium">{displayText}</span>
              </h3>
            );
          },
          
          // 테이블 고급 스타일링
          table: ({ children, ...props }) => (
            <div className="my-4 overflow-x-auto rounded-lg border border-border shadow-sm">
              <table className="w-full border-collapse" {...props}>
                {children}
              </table>
            </div>
          ),
          
          thead: ({ children, ...props }) => (
            <thead className="bg-muted/70 dark:bg-muted/50" {...props}>
              {children}
            </thead>
          ),
          
          th: ({ children, ...props }) => (
            <th 
              className="px-4 py-3 text-left text-sm font-semibold text-foreground border-b border-border" 
              {...props}
            >
              {children}
            </th>
          ),
          
          td: ({ children, ...props }) => {
            const text = String(children);
            
            // 검증 수준 셀 감지 및 배지로 변환
            if (text.match(/^(높음|중간|낮음|high|medium|low)$/i)) {
              return (
                <td className="px-4 py-3 border-b border-border/50" {...props}>
                  <VerificationBadge level={text} />
                </td>
              );
            }
            
            return (
              <td 
                className="px-4 py-3 text-sm border-b border-border/50 text-foreground/90" 
                {...props}
              >
                {children}
              </td>
            );
          },
          
          tr: ({ children, ...props }) => (
            <tr 
              className="hover:bg-muted/30 transition-colors" 
              {...props}
            >
              {children}
            </tr>
          ),
          
          // 리스트 아이템 스타일링
          li: ({ children, ...props }) => (
            <li 
              className="my-1.5 pl-1 marker:text-primary/60" 
              {...props}
            >
              {children}
            </li>
          ),
          
          // 인용구 스타일링
          blockquote: ({ children, ...props }) => (
            <blockquote 
              className="my-4 border-l-4 border-primary/40 pl-4 py-2 bg-muted/20 rounded-r-lg italic text-muted-foreground"
              {...props}
            >
              {children}
            </blockquote>
          ),
          
          // 강조 텍스트
          strong: ({ children, ...props }) => (
            <strong className="font-semibold text-foreground" {...props}>
              {children}
            </strong>
          ),
          
          // 구분선
          hr: ({ ...props }) => (
            <hr className="my-6 border-t-2 border-dashed border-border/50" {...props} />
          ),
          
          // 코드 블록
          code: ({ className: codeClassName, children, ...props }) => {
            const isInline = !codeClassName;
            
            if (isInline) {
              return (
                <code 
                  className="bg-muted px-1.5 py-0.5 rounded-md text-sm font-mono text-primary"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            
            return (
              <code className={cn(codeClassName, "block")} {...props}>
                {children}
              </code>
            );
          },
          
          // 이미지 스타일링
          img: ({ src, alt, ...props }) => (
            <figure className="my-4">
              <img 
                src={src} 
                alt={alt} 
                className="rounded-lg shadow-md max-w-full h-auto"
                {...props}
              />
              {alt && (
                <figcaption className="text-center text-sm text-muted-foreground mt-2">
                  {alt}
                </figcaption>
              )}
            </figure>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
      
      {/* 스트리밍 커서 */}
      {isStreaming && (
        <span className="inline-block w-2 h-5 bg-primary animate-pulse ml-0.5 align-text-bottom rounded-sm" />
      )}
    </div>
  );
});

export default EnhancedMarkdownRenderer;

```

---

## frontend/src/components/ErrorState.tsx

```tsx
import * as React from "react";
import { AlertCircle, RefreshCw, XCircle, WifiOff, ServerCrash, FileWarning } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * 통합 에러 상태 컴포넌트
 * 
 * 다양한 에러 유형 지원:
 * - generic: 일반 에러
 * - network: 네트워크 에러
 * - server: 서버 에러
 * - notFound: 리소스 없음
 * - permission: 권한 에러
 */

export type ErrorType = "generic" | "network" | "server" | "notFound" | "permission";
export type ErrorVariant = "inline" | "card" | "fullPage";

interface ErrorStateProps {
  /** 에러 유형 */
  type?: ErrorType;
  /** 표시 스타일 */
  variant?: ErrorVariant;
  /** 에러 제목 */
  title?: string;
  /** 에러 상세 메시지 */
  message?: string;
  /** 재시도 콜백 */
  onRetry?: () => void;
  /** 재시도 버튼 텍스트 */
  retryText?: string;
  /** 재시도 중 상태 */
  isRetrying?: boolean;
  /** 취소/닫기 콜백 */
  onDismiss?: () => void;
  /** 추가 CSS 클래스 */
  className?: string;
  /** 자식 요소 (추가 액션 등) */
  children?: React.ReactNode;
}

const errorConfig: Record<ErrorType, { icon: typeof AlertCircle; defaultTitle: string; defaultMessage: string }> = {
  generic: {
    icon: AlertCircle,
    defaultTitle: "오류가 발생했습니다",
    defaultMessage: "요청을 처리하는 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.",
  },
  network: {
    icon: WifiOff,
    defaultTitle: "네트워크 연결 오류",
    defaultMessage: "인터넷 연결을 확인하고 다시 시도해주세요.",
  },
  server: {
    icon: ServerCrash,
    defaultTitle: "서버 오류",
    defaultMessage: "서버에서 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
  },
  notFound: {
    icon: FileWarning,
    defaultTitle: "찾을 수 없음",
    defaultMessage: "요청하신 리소스를 찾을 수 없습니다.",
  },
  permission: {
    icon: XCircle,
    defaultTitle: "접근 권한 없음",
    defaultMessage: "이 작업을 수행할 권한이 없습니다.",
  },
};

/** 인라인 에러 (Alert 형태) */
const InlineError = ({
  type = "generic",
  title,
  message,
  onRetry,
  retryText = "다시 시도",
  isRetrying,
  onDismiss,
  className,
  children,
}: ErrorStateProps) => {
  const config = errorConfig[type];
  const Icon = config.icon;

  return (
    <Alert variant="destructive" className={cn("relative", className)}>
      <Icon className="h-4 w-4" />
      <AlertTitle>{title || config.defaultTitle}</AlertTitle>
      <AlertDescription className="mt-2">
        <p>{message || config.defaultMessage}</p>
        {(onRetry || onDismiss || children) && (
          <div className="flex items-center gap-2 mt-3">
            {onRetry && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRetry}
                disabled={isRetrying}
                className="gap-1"
              >
                <RefreshCw className={cn("h-3 w-3", isRetrying && "animate-spin")} />
                {retryText}
              </Button>
            )}
            {onDismiss && (
              <Button variant="ghost" size="sm" onClick={onDismiss}>
                닫기
              </Button>
            )}
            {children}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
};

/** 카드 형태 에러 */
const CardError = ({
  type = "generic",
  title,
  message,
  onRetry,
  retryText = "다시 시도",
  isRetrying,
  onDismiss,
  className,
  children,
}: ErrorStateProps) => {
  const config = errorConfig[type];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-8 text-center rounded-lg border border-destructive/20 bg-destructive/5",
        className
      )}
    >
      <div className="p-3 rounded-full bg-destructive/10 mb-4">
        <Icon className="h-8 w-8 text-destructive" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">{title || config.defaultTitle}</h3>
      <p className="text-sm text-muted-foreground max-w-md mb-4">{message || config.defaultMessage}</p>
      {(onRetry || onDismiss || children) && (
        <div className="flex items-center gap-3">
          {onRetry && (
            <Button onClick={onRetry} disabled={isRetrying} className="gap-2">
              <RefreshCw className={cn("h-4 w-4", isRetrying && "animate-spin")} />
              {retryText}
            </Button>
          )}
          {onDismiss && (
            <Button variant="outline" onClick={onDismiss}>
              닫기
            </Button>
          )}
          {children}
        </div>
      )}
    </div>
  );
};

/** 전체 페이지 에러 */
const FullPageError = ({
  type = "generic",
  title,
  message,
  onRetry,
  retryText = "다시 시도",
  isRetrying,
  className,
  children,
}: ErrorStateProps) => {
  const config = errorConfig[type];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "min-h-[400px] flex flex-col items-center justify-center p-8 text-center",
        className
      )}
    >
      <div className="p-4 rounded-full bg-destructive/10 mb-6">
        <Icon className="h-12 w-12 text-destructive" />
      </div>
      <h2 className="text-2xl font-bold text-foreground mb-3">{title || config.defaultTitle}</h2>
      <p className="text-muted-foreground max-w-lg mb-6">{message || config.defaultMessage}</p>
      {(onRetry || children) && (
        <div className="flex items-center gap-3">
          {onRetry && (
            <Button size="lg" onClick={onRetry} disabled={isRetrying} className="gap-2">
              <RefreshCw className={cn("h-5 w-5", isRetrying && "animate-spin")} />
              {retryText}
            </Button>
          )}
          {children}
        </div>
      )}
    </div>
  );
};

/** 메인 ErrorState 컴포넌트 */
export const ErrorState = ({ variant = "card", ...props }: ErrorStateProps) => {
  switch (variant) {
    case "inline":
      return <InlineError {...props} />;
    case "fullPage":
      return <FullPageError {...props} />;
    case "card":
    default:
      return <CardError {...props} />;
  }
};

/** 에러 바운더리 폴백 컴포넌트 */
export const ErrorBoundaryFallback = ({
  error,
  resetErrorBoundary,
}: {
  error: Error;
  resetErrorBoundary?: () => void;
}) => (
  <ErrorState
    type="generic"
    variant="fullPage"
    title="예기치 않은 오류"
    message={error.message || "애플리케이션에서 오류가 발생했습니다."}
    onRetry={resetErrorBoundary}
    retryText="새로고침"
  />
);

/** 빈 상태 컴포넌트 */
interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState = ({ icon, title, description, action, className }: EmptyStateProps) => (
  <div className={cn("flex flex-col items-center justify-center p-8 text-center", className)}>
    {icon && <div className="mb-4 text-muted-foreground">{icon}</div>}
    <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
    {description && <p className="text-sm text-muted-foreground max-w-md mb-4">{description}</p>}
    {action}
  </div>
);

export default ErrorState;

```

---

## frontend/src/components/ExportButton.tsx

```tsx
import { useState } from "react";
import {
  Download,
  FileJson,
  FileText,
  FileSpreadsheet,
  Copy,
  Check,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useExport, type ExportFormat, type ExportableSearchResult, type ExportOptions } from "@/hooks/useExport";

interface ExportButtonProps {
  /** 내보낼 데이터 */
  data: ExportableSearchResult[];
  /** 내보내기 옵션 */
  options?: ExportOptions;
  /** 버튼 비활성화 */
  disabled?: boolean;
  /** 버튼 크기 */
  size?: "default" | "sm" | "lg" | "icon";
  /** 버튼 변형 */
  variant?: "default" | "outline" | "ghost" | "secondary";
  /** 아이콘만 표시 */
  iconOnly?: boolean;
  /** 추가 CSS 클래스 */
  className?: string;
}

/**
 * 검색 결과 내보내기 버튼 컴포넌트
 * 
 * @example
 * ``\`tsx
 * <ExportButton
 *   data={searchResults}
 *   options={{ filename: "search-results", title: "검색 결과" }}
 * />
 * ``\`
 */
export function ExportButton({
  data,
  options = {},
  disabled = false,
  size = "default",
  variant = "outline",
  iconOnly = false,
  className = "",
}: ExportButtonProps) {
  const { exportData, copyToClipboard } = useExport();
  const [copied, setCopied] = useState(false);

  const handleExport = (format: ExportFormat) => {
    exportData(data, format, options);
  };

  const handleCopy = async () => {
    const success = await copyToClipboard(data, "json");
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isDisabled = disabled || !data || data.length === 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size={size}
          disabled={isDisabled}
          className={className}
          aria-label="내보내기"
        >
          <Download className="h-4 w-4" />
          {!iconOnly && (
            <>
              <span className="ml-2">내보내기</span>
              <ChevronDown className="ml-1 h-3 w-3" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => handleExport("json")} className="gap-2">
          <FileJson className="h-4 w-4 text-yellow-600" />
          <span>JSON으로 내보내기</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("csv")} className="gap-2">
          <FileSpreadsheet className="h-4 w-4 text-green-600" />
          <span>CSV로 내보내기</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("markdown")} className="gap-2">
          <FileText className="h-4 w-4 text-blue-600" />
          <span>Markdown으로 내보내기</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("txt")} className="gap-2">
          <FileText className="h-4 w-4 text-gray-600" />
          <span>텍스트로 내보내기</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleCopy} className="gap-2">
          {copied ? (
            <>
              <Check className="h-4 w-4 text-green-600" />
              <span className="text-green-600">복사됨!</span>
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              <span>클립보드에 복사</span>
            </>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ExportButton;

```

---

## frontend/src/components/FactCheckAnalyticsPanel.tsx

```tsx
import { useState } from "react";
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  Eye,
  FileText,
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Scale,
  TrendingUp,
  Info,
  Percent,
  Hash,
  Clock,
  Layers,
  Target,
  Lightbulb,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Types for analytics data
export interface SourceCredibilityAnalysis {
  sourceName: string;
  isTrusted: boolean;
  trustScore: number; // 0-1
  trustLevel: "trusted" | "unknown" | "untrusted";
  reason: string;
  matchedTrustedSource?: string;
}

export interface ClickbaitAnalysis {
  isClickbait: boolean;
  score: number; // 0-1
  detectedPatterns: Array<{
    pattern: string;
    matchedText: string;
    severity: "low" | "medium" | "high";
  }>;
  totalPatternsChecked: number;
}

export interface MisinformationAnalysis {
  riskScore: number; // 0-1
  riskLevel: "low" | "medium" | "high";
  detectedPatterns: Array<{
    type: "misinformation" | "unverifiable";
    pattern: string;
    matchedText: string;
    severity: "low" | "medium" | "high";
  }>;
  unverifiableClaimCount: number;
}

export interface ClaimAnalysis {
  claimId: string;
  claimText: string;
  verdict: "verified" | "false" | "unverified" | "misleading" | "partially_true";
  confidence: number; // 0-1
  claimIndicator: string;
  analysisMethod: string;
  supportingFactors: string[];
  contradictingFactors: string[];
}

export interface ScoreBreakdown {
  sourceWeight: number; // 30%
  clickbaitWeight: number; // 20%
  misinfoWeight: number; // 20%
  verificationWeight: number; // 30%
  
  sourceContribution: number;
  clickbaitContribution: number;
  misinfoContribution: number;
  verificationContribution: number;
  
  totalScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
}

export interface FactCheckAnalytics {
  // Source analysis
  sourceAnalysis: SourceCredibilityAnalysis;
  
  // Clickbait detection
  clickbaitAnalysis: ClickbaitAnalysis;
  
  // Misinformation risk
  misinfoAnalysis: MisinformationAnalysis;
  
  // Claims breakdown
  claimAnalyses: ClaimAnalysis[];
  
  // Final score breakdown
  scoreBreakdown: ScoreBreakdown;
  
  // Metadata
  analysisVersion: string;
  processingTimeMs: number;
  analyzedAt: string;
  
  // ML-specific metadata (optional, only when backend ML is used)
  mlModelsUsed?: string[];
  externalApisUsed?: string[];
}

interface FactCheckAnalyticsPanelProps {
  analytics: FactCheckAnalytics | null;
  isLoading?: boolean;
}

// Helper components
const ScoreBar = ({ 
  label, 
  score, 
  weight, 
  contribution,
  colorClass = "bg-blue-500"
}: { 
  label: string; 
  score: number; 
  weight: number;
  contribution: number;
  colorClass?: string;
}) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs">
          가중치 {weight}%
        </Badge>
        <span className="font-medium">{Math.round(score * 100)}%</span>
      </div>
    </div>
    <Progress value={score * 100} className={`h-2 ${colorClass}`} />
    <div className="text-xs text-muted-foreground text-right">
      점수 기여: +{contribution.toFixed(1)}점
    </div>
  </div>
);

const PatternBadge = ({ 
  pattern, 
  severity 
}: { 
  pattern: string; 
  severity: "low" | "medium" | "high";
}) => {
  const severityColors = {
    low: "bg-yellow-100 text-yellow-800 border-yellow-200",
    medium: "bg-orange-100 text-orange-800 border-orange-200",
    high: "bg-red-100 text-red-800 border-red-200",
  };
  
  return (
    <Badge className={`${severityColors[severity]} border`}>
      {pattern}
    </Badge>
  );
};

const VerdictIcon = ({ verdict }: { verdict: ClaimAnalysis["verdict"] }) => {
  const icons = {
    verified: <CheckCircle2 className="h-4 w-4 text-green-500" />,
    false: <XCircle className="h-4 w-4 text-red-500" />,
    unverified: <HelpCircle className="h-4 w-4 text-gray-500" />,
    misleading: <AlertTriangle className="h-4 w-4 text-orange-500" />,
    partially_true: <Scale className="h-4 w-4 text-yellow-500" />,
  };
  return icons[verdict];
};

const GradeDisplay = ({ grade }: { grade: ScoreBreakdown["grade"] }) => {
  const gradeConfig = {
    A: { color: "bg-green-500", text: "text-green-600", label: "매우 신뢰" },
    B: { color: "bg-blue-500", text: "text-blue-600", label: "신뢰" },
    C: { color: "bg-yellow-500", text: "text-yellow-600", label: "주의 필요" },
    D: { color: "bg-orange-500", text: "text-orange-600", label: "신뢰 어려움" },
    F: { color: "bg-red-500", text: "text-red-600", label: "신뢰 불가" },
  };
  
  const config = gradeConfig[grade];
  
  return (
    <div className="flex items-center gap-2">
      <div className={`w-10 h-10 rounded-lg ${config.color} flex items-center justify-center`}>
        <span className="text-white font-bold text-lg">{grade}</span>
      </div>
      <span className={`text-sm font-medium ${config.text}`}>{config.label}</span>
    </div>
  );
};

export const FactCheckAnalyticsPanel = ({ 
  analytics, 
  isLoading = false 
}: FactCheckAnalyticsPanelProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 animate-pulse" />
            분석 통계 로딩 중...
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="h-4 bg-muted rounded animate-pulse" />
            <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
            <div className="h-4 bg-muted rounded animate-pulse w-1/2" />
          </div>
        </CardContent>
      </Card>
    );
  }
  
  if (!analytics) {
    return null;
  }
  
  const { 
    sourceAnalysis, 
    clickbaitAnalysis, 
    misinfoAnalysis, 
    claimAnalyses, 
    scoreBreakdown 
  } = analytics;
  
  return (
    <Card className="border-2 border-dashed border-purple-200 dark:border-purple-800">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                <BarChart3 className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <CardTitle className="text-lg">분석 과정 세부 통계</CardTitle>
                <CardDescription>
                  신뢰도 {scoreBreakdown.totalScore}점 산출 과정을 확인합니다
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <GradeDisplay grade={scoreBreakdown.grade} />
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm">
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>
        </CardHeader>
        
        <CollapsibleContent>
          <CardContent className="pt-4">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-5 mb-4">
                <TabsTrigger value="overview" className="text-xs">
                  <TrendingUp className="h-3 w-3 mr-1" />
                  종합
                </TabsTrigger>
                <TabsTrigger value="source" className="text-xs">
                  <Shield className="h-3 w-3 mr-1" />
                  출처
                </TabsTrigger>
                <TabsTrigger value="clickbait" className="text-xs">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  낚시성
                </TabsTrigger>
                <TabsTrigger value="misinfo" className="text-xs">
                  <XCircle className="h-3 w-3 mr-1" />
                  허위정보
                </TabsTrigger>
                <TabsTrigger value="claims" className="text-xs">
                  <FileText className="h-3 w-3 mr-1" />
                  주장
                </TabsTrigger>
              </TabsList>
              
              {/* Overview Tab */}
              <TabsContent value="overview" className="space-y-6">
                {/* Score Formula Explanation */}
                <div className="p-4 rounded-lg bg-muted/50">
                  <div className="flex items-start gap-2 mb-3">
                    <Lightbulb className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-sm">신뢰도 점수 산출 공식</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        총점 = (출처 신뢰도 × 30%) + (낚시성 미탐지 × 20%) + (허위정보 미탐지 × 20%) + (주장 검증률 × 30%)
                      </p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                    <div className="text-center p-2 rounded bg-background">
                      <div className="text-2xl font-bold text-blue-600">
                        {Math.round(sourceAnalysis.trustScore * 100)}%
                      </div>
                      <div className="text-xs text-muted-foreground">출처 신뢰도</div>
                    </div>
                    <div className="text-center p-2 rounded bg-background">
                      <div className="text-2xl font-bold text-green-600">
                        {clickbaitAnalysis.isClickbait ? "탐지" : "정상"}
                      </div>
                      <div className="text-xs text-muted-foreground">낚시성 여부</div>
                    </div>
                    <div className="text-center p-2 rounded bg-background">
                      <div className="text-2xl font-bold text-orange-600">
                        {misinfoAnalysis.riskLevel === "low" ? "낮음" : 
                         misinfoAnalysis.riskLevel === "medium" ? "중간" : "높음"}
                      </div>
                      <div className="text-xs text-muted-foreground">허위정보 위험</div>
                    </div>
                    <div className="text-center p-2 rounded bg-background">
                      <div className="text-2xl font-bold text-purple-600">
                        {claimAnalyses.filter(c => c.verdict === "verified").length}/{claimAnalyses.length}
                      </div>
                      <div className="text-xs text-muted-foreground">검증된 주장</div>
                    </div>
                  </div>
                </div>
                
                {/* Score Breakdown */}
                <div className="space-y-4">
                  <h4 className="font-medium flex items-center gap-2">
                    <Layers className="h-4 w-4" />
                    점수 구성 요소
                  </h4>
                  
                  <ScoreBar 
                    label="출처 신뢰도" 
                    score={sourceAnalysis.trustScore}
                    weight={scoreBreakdown.sourceWeight}
                    contribution={scoreBreakdown.sourceContribution}
                    colorClass="bg-blue-500"
                  />
                  
                  <ScoreBar 
                    label="낚시성 미탐지" 
                    score={clickbaitAnalysis.isClickbait ? 0.7 : 1}
                    weight={scoreBreakdown.clickbaitWeight}
                    contribution={scoreBreakdown.clickbaitContribution}
                    colorClass="bg-green-500"
                  />
                  
                  <ScoreBar 
                    label="허위정보 미탐지" 
                    score={1 - misinfoAnalysis.riskScore}
                    weight={scoreBreakdown.misinfoWeight}
                    contribution={scoreBreakdown.misinfoContribution}
                    colorClass="bg-orange-500"
                  />
                  
                  <ScoreBar 
                    label="주장 검증률" 
                    score={claimAnalyses.length > 0 
                      ? claimAnalyses.filter(c => c.verdict === "verified").length / claimAnalyses.length 
                      : 0}
                    weight={scoreBreakdown.verificationWeight}
                    contribution={scoreBreakdown.verificationContribution}
                    colorClass="bg-purple-500"
                  />
                  
                  <div className="pt-4 border-t">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">최종 신뢰도 점수</span>
                      <div className="flex items-center gap-2">
                        <span className="text-2xl font-bold">{scoreBreakdown.totalScore}</span>
                        <span className="text-muted-foreground">/ 100</span>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Metadata */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground pt-4 border-t">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    처리시간: {analytics.processingTimeMs}ms
                  </div>
                  <div className="flex items-center gap-1">
                    <Info className="h-3 w-3" />
                    분석 버전: {analytics.analysisVersion}
                  </div>
                </div>
              </TabsContent>
              
              {/* Source Analysis Tab */}
              <TabsContent value="source" className="space-y-4">
                <div className={`p-4 rounded-lg border-2 ${
                  sourceAnalysis.isTrusted 
                    ? "border-green-200 bg-green-50 dark:bg-green-900/20" 
                    : "border-yellow-200 bg-yellow-50 dark:bg-yellow-900/20"
                }`}>
                  <div className="flex items-start gap-3">
                    <Shield className={`h-6 w-6 ${
                      sourceAnalysis.isTrusted ? "text-green-600" : "text-yellow-600"
                    }`} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium">{sourceAnalysis.sourceName || "알 수 없는 출처"}</h4>
                        <Badge variant={sourceAnalysis.isTrusted ? "default" : "secondary"}>
                          {sourceAnalysis.trustLevel === "trusted" ? "신뢰 매체" : 
                           sourceAnalysis.trustLevel === "unknown" ? "미확인" : "비신뢰"}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{sourceAnalysis.reason}</p>
                      
                      <div className="mt-3 p-2 rounded bg-background/50">
                        <div className="flex items-center justify-between text-sm">
                          <span>출처 신뢰도 점수</span>
                          <span className="font-bold">{Math.round(sourceAnalysis.trustScore * 100)}%</span>
                        </div>
                        <Progress 
                          value={sourceAnalysis.trustScore * 100} 
                          className="h-2 mt-1" 
                        />
                      </div>
                      
                      {sourceAnalysis.matchedTrustedSource && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          매칭된 신뢰 매체: <span className="font-medium">{sourceAnalysis.matchedTrustedSource}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="p-4 rounded-lg bg-muted/50">
                  <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    출처 신뢰도 판별 기준
                  </h4>
                  <ul className="text-xs text-muted-foreground space-y-1">
                    <li>• 신뢰 매체 (90%): 연합뉴스, KBS, MBC, SBS, YTN, JTBC 등 17개</li>
                    <li>• 주요 신문 (80%): 조선일보, 중앙일보, 동아일보, 한겨레, 경향신문</li>
                    <li>• 인터넷 매체 (75%): 뉴시스, 뉴스1, 머니투데이, 이데일리</li>
                    <li>• 미확인 매체 (50%): 목록에 없는 출처</li>
                    <li>• 출처 없음 (30%): 출처 정보 미제공</li>
                  </ul>
                </div>
              </TabsContent>
              
              {/* Clickbait Analysis Tab */}
              <TabsContent value="clickbait" className="space-y-4">
                <div className={`p-4 rounded-lg border-2 ${
                  clickbaitAnalysis.isClickbait 
                    ? "border-red-200 bg-red-50 dark:bg-red-900/20" 
                    : "border-green-200 bg-green-50 dark:bg-green-900/20"
                }`}>
                  <div className="flex items-center gap-3 mb-3">
                    {clickbaitAnalysis.isClickbait ? (
                      <AlertTriangle className="h-6 w-6 text-red-600" />
                    ) : (
                      <CheckCircle2 className="h-6 w-6 text-green-600" />
                    )}
                    <div>
                      <h4 className="font-medium">
                        {clickbaitAnalysis.isClickbait ? "낚시성 콘텐츠 탐지됨" : "낚시성 콘텐츠 없음"}
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        {clickbaitAnalysis.totalPatternsChecked}개 패턴 중 {clickbaitAnalysis.detectedPatterns.length}개 탐지
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span>낚시성 점수</span>
                    <span className="font-bold">{Math.round(clickbaitAnalysis.score * 100)}%</span>
                  </div>
                  <Progress value={clickbaitAnalysis.score * 100} className="h-2" />
                </div>
                
                {clickbaitAnalysis.detectedPatterns.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-medium text-sm">탐지된 패턴</h4>
                    <div className="space-y-2">
                      {clickbaitAnalysis.detectedPatterns.map((pattern, idx) => (
                        <div key={idx} className="p-3 rounded-lg bg-muted/50 flex items-start gap-2">
                          <PatternBadge pattern={pattern.pattern} severity={pattern.severity} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate">"{pattern.matchedText}"</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="p-4 rounded-lg bg-muted/50">
                  <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    낚시성 탐지 패턴 목록
                  </h4>
                  <div className="flex flex-wrap gap-1 text-xs">
                    {["충격!", "경악!", "대박!", "헉!", "알고보니", "결국...", "드디어!", 
                      "...", "???", "!!!", "속보:", "단독:", "긴급:"].map(p => (
                      <Badge key={p} variant="outline" className="text-xs">{p}</Badge>
                    ))}
                  </div>
                </div>
              </TabsContent>
              
              {/* Misinformation Analysis Tab */}
              <TabsContent value="misinfo" className="space-y-4">
                <div className={`p-4 rounded-lg border-2 ${
                  misinfoAnalysis.riskLevel === "low" 
                    ? "border-green-200 bg-green-50 dark:bg-green-900/20" 
                    : misinfoAnalysis.riskLevel === "medium"
                    ? "border-yellow-200 bg-yellow-50 dark:bg-yellow-900/20"
                    : "border-red-200 bg-red-50 dark:bg-red-900/20"
                }`}>
                  <div className="flex items-center gap-3 mb-3">
                    {misinfoAnalysis.riskLevel === "low" ? (
                      <CheckCircle2 className="h-6 w-6 text-green-600" />
                    ) : misinfoAnalysis.riskLevel === "medium" ? (
                      <AlertTriangle className="h-6 w-6 text-yellow-600" />
                    ) : (
                      <XCircle className="h-6 w-6 text-red-600" />
                    )}
                    <div>
                      <h4 className="font-medium">
                        허위정보 위험도: {
                          misinfoAnalysis.riskLevel === "low" ? "낮음" :
                          misinfoAnalysis.riskLevel === "medium" ? "중간" : "높음"
                        }
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        검증 불가 주장 {misinfoAnalysis.unverifiableClaimCount}개 발견
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span>위험도 점수</span>
                    <span className="font-bold">{Math.round(misinfoAnalysis.riskScore * 100)}%</span>
                  </div>
                  <Progress value={misinfoAnalysis.riskScore * 100} className="h-2" />
                </div>
                
                {misinfoAnalysis.detectedPatterns.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-medium text-sm">탐지된 위험 패턴</h4>
                    <div className="space-y-2">
                      {misinfoAnalysis.detectedPatterns.map((pattern, idx) => (
                        <div key={idx} className="p-3 rounded-lg bg-muted/50">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant={pattern.type === "misinformation" ? "destructive" : "secondary"}>
                              {pattern.type === "misinformation" ? "허위정보 패턴" : "검증 불가 표현"}
                            </Badge>
                            <PatternBadge pattern={pattern.pattern} severity={pattern.severity} />
                          </div>
                          <p className="text-sm text-muted-foreground">"{pattern.matchedText}"</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg bg-muted/50">
                    <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                      허위정보 패턴
                    </h4>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p>• "정부가 숨기"</p>
                      <p>• "언론이 보도하지 않는"</p>
                      <p>• "비밀리에"</p>
                      <p>• "충격 진실"</p>
                      <p>• "알려지지 않은 진실"</p>
                    </div>
                  </div>
                  
                  <div className="p-4 rounded-lg bg-muted/50">
                    <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                      <HelpCircle className="h-4 w-4 text-yellow-500" />
                      검증 불가 표현
                    </h4>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p>• "최초", "유일", "최고"</p>
                      <p>• "100%", "모든 사람"</p>
                      <p>• "아무도", "절대"</p>
                      <p>• "반드시"</p>
                    </div>
                  </div>
                </div>
              </TabsContent>
              
              {/* Claims Analysis Tab */}
              <TabsContent value="claims" className="space-y-4">
                <div className="grid grid-cols-5 gap-2 mb-4">
                  {[
                    { verdict: "verified", label: "검증됨", color: "bg-green-500" },
                    { verdict: "partially_true", label: "일부 사실", color: "bg-yellow-500" },
                    { verdict: "unverified", label: "미검증", color: "bg-gray-500" },
                    { verdict: "misleading", label: "오해 소지", color: "bg-orange-500" },
                    { verdict: "false", label: "거짓", color: "bg-red-500" },
                  ].map(({ verdict, label, color }) => (
                    <div key={verdict} className="text-center p-2 rounded bg-muted/50">
                      <div className={`w-4 h-4 rounded-full ${color} mx-auto mb-1`} />
                      <div className="text-lg font-bold">
                        {claimAnalyses.filter(c => c.verdict === verdict).length}
                      </div>
                      <div className="text-xs text-muted-foreground">{label}</div>
                    </div>
                  ))}
                </div>
                
                <div className="space-y-3">
                  {claimAnalyses.map((claim, idx) => (
                    <Collapsible key={claim.claimId}>
                      <div className="p-3 rounded-lg border bg-card">
                        <CollapsibleTrigger className="w-full">
                          <div className="flex items-start gap-3">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">#{idx + 1}</span>
                              <VerdictIcon verdict={claim.verdict} />
                            </div>
                            <div className="flex-1 text-left">
                              <p className="text-sm line-clamp-2">{claim.claimText}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge variant="outline" className="text-xs">
                                  {claim.claimIndicator}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  신뢰도 {Math.round(claim.confidence * 100)}%
                                </span>
                              </div>
                            </div>
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </CollapsibleTrigger>
                        
                        <CollapsibleContent className="mt-3 pt-3 border-t">
                          <div className="space-y-3">
                            <div>
                              <span className="text-xs font-medium">분석 방법</span>
                              <p className="text-xs text-muted-foreground">{claim.analysisMethod}</p>
                            </div>
                            
                            {claim.supportingFactors.length > 0 && (
                              <div>
                                <span className="text-xs font-medium text-green-600 flex items-center gap-1">
                                  <CheckCircle2 className="h-3 w-3" />
                                  지지 요소
                                </span>
                                <ul className="text-xs text-muted-foreground mt-1 space-y-1">
                                  {claim.supportingFactors.map((f, i) => (
                                    <li key={i}>• {f}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            
                            {claim.contradictingFactors.length > 0 && (
                              <div>
                                <span className="text-xs font-medium text-red-600 flex items-center gap-1">
                                  <XCircle className="h-3 w-3" />
                                  반박 요소
                                </span>
                                <ul className="text-xs text-muted-foreground mt-1 space-y-1">
                                  {claim.contradictingFactors.map((f, i) => (
                                    <li key={i}>• {f}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  ))}
                </div>
                
                <div className="p-4 rounded-lg bg-muted/50">
                  <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                    <Hash className="h-4 w-4" />
                    주장 추출 기준 (Claim Indicators)
                  </h4>
                  <div className="flex flex-wrap gap-1 text-xs">
                    {["~라고 밝혔다", "~라고 주장했다", "~라고 전했다", 
                      "~에 따르면", "~것으로 알려졌다", "~것으로 확인됐다",
                      "관계자는", "전문가는", "소식통에 따르면"].map(indicator => (
                      <Badge key={indicator} variant="outline" className="text-xs">{indicator}</Badge>
                    ))}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

export default FactCheckAnalyticsPanel;

```

---

## frontend/src/components/FactCheckChatbot.tsx

```tsx
import { useState, useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import { Send, Loader2, Bot, User, AlertCircle, CheckCircle2, XCircle, Scale, Shield, Download, Copy, Check, FileText, FileCode, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { useFactCheckChat } from '@/hooks/useFactCheckChat';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  type?: string;
  phase?: string;
  evidence?: any[];
  verificationResult?: any;
  credibility?: any;
}

interface FactCheckChatbotProps {
  /** Initial query to send when component mounts */
  initialQuery?: string;
  /** Initial claims to verify (will be combined into a query) */
  initialClaims?: string[];
  /** Compact mode for embedding in tabs */
  compact?: boolean;
  /** Custom height class (default: h-[calc(100vh-12rem)] or h-[500px] in compact mode) */
  heightClass?: string;
  /** Hide header in compact mode */
  hideHeader?: boolean;
}

export interface FactCheckChatbotRef {
  sendQuery: (query: string) => void;
  sendClaims: (claims: string[]) => void;
  clearMessages: () => void;
}

export const FactCheckChatbot = forwardRef<FactCheckChatbotRef, FactCheckChatbotProps>(({
  initialQuery,
  initialClaims,
  compact = false,
  heightClass,
  hideHeader = false,
}, ref) => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const initialSentRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { sendMessage, isConnected, isStreaming, sessionId, reconnect } = useFactCheckChat({
    onMessage: (event) => {
      setMessages((prev) => [...prev, {
        id: `${Date.now()}-${Math.random()}`,
        role: event.role as 'user' | 'assistant' | 'system',
        content: event.content || '',
        timestamp: event.timestamp || Date.now(),
        type: event.type,
        phase: event.phase,
        evidence: event.evidence,
        verificationResult: event.verificationResult,
        credibility: event.credibility,
      }]);
    },
    onError: (error) => {
      setMessages((prev) => [...prev, {
        id: `error-${Date.now()}`,
        role: 'system',
        content: `오류: ${error}`,
        timestamp: Date.now(),
        type: 'error',
      }]);
    },
  });

  // 세션 재연결 핸들러
  const handleReconnect = useCallback(() => {
    setMessages([]);
    reconnect();
  }, [reconnect]);

  // 자동 스크롤
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Helper function to send a query
  const sendQueryInternal = async (query: string) => {
    if (!query.trim() || isStreaming) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: query,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    await sendMessage(query);
  };

  // Helper function to send claims
  const sendClaimsInternal = async (claims: string[]) => {
    const validClaims = claims.filter(c => c.trim());
    if (validClaims.length === 0) return;

    const query = validClaims.length === 1
      ? `다음 주장을 팩트체크해주세요: "${validClaims[0]}"`
      : `다음 주장들을 팩트체크해주세요:\n${validClaims.map((c, i) => `${i + 1}. ${c}`).join('\n')}`;

    await sendQueryInternal(query);
  };

  // Expose methods via ref for parent components
  useImperativeHandle(ref, () => ({
    sendQuery: (query: string) => {
      sendQueryInternal(query);
    },
    sendClaims: (claims: string[]) => {
      sendClaimsInternal(claims);
    },
    clearMessages: () => {
      setMessages([]);
    },
  }), [isStreaming, sendMessage]);

  // Handle initial query or claims on mount
  useEffect(() => {
    if (initialSentRef.current || !isConnected) return;

    if (initialClaims && initialClaims.length > 0) {
      initialSentRef.current = true;
      sendClaimsInternal(initialClaims);
    } else if (initialQuery) {
      initialSentRef.current = true;
      sendQueryInternal(initialQuery);
    }
  }, [isConnected, initialQuery, initialClaims]);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;
    const query = input;
    setInput('');
    await sendQueryInternal(query);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Export functionality
  const [copied, setCopied] = useState(false);

  const exportToMarkdown = useCallback(() => {
    if (messages.length === 0) return;
    
    const timestamp = new Date().toLocaleString('ko-KR');
    let md = `# 팩트체크 결과 보고서\n\n`;
    md += `**생성 시간**: ${timestamp}\n`;
    md += `**세션 ID**: ${sessionId || 'N/A'}\n\n`;
    md += `---\n\n`;

    messages.forEach((msg) => {
      if (msg.role === 'user') {
        md += `## 사용자 질문\n\n${msg.content}\n\n`;
      } else if (msg.role === 'assistant') {
        md += `## AI 응답\n\n${msg.content}\n\n`;
        
        if (msg.verificationResult) {
          const result = msg.verificationResult;
          md += `### 검증 결과\n\n`;
          md += `- **주장**: ${result.originalClaim}\n`;
          md += `- **판정**: ${getVerificationLabel(result.status)}\n`;
          md += `- **신뢰도**: ${Math.round((result.confidenceScore || 0) * 100)}%\n`;
          md += `- **요약**: ${result.verificationSummary}\n\n`;
        }
        
        if (msg.evidence && msg.evidence.length > 0) {
          md += `### 증거 자료\n\n`;
          msg.evidence.forEach((ev: any, idx: number) => {
            md += `${idx + 1}. **${ev.sourceName}**\n`;
            md += `   - ${ev.excerpt}\n`;
            if (ev.url) md += `   - URL: ${ev.url}\n`;
            md += `\n`;
          });
        }
      }
    });

    md += `---\n\n*이 보고서는 NewsInsight 팩트체크 챗봇에 의해 자동 생성되었습니다.*\n`;

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `팩트체크_결과_${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Markdown 파일이 다운로드되었습니다.');
  }, [messages, sessionId]);

  const exportToText = useCallback(() => {
    if (messages.length === 0) return;
    
    const timestamp = new Date().toLocaleString('ko-KR');
    let text = `팩트체크 결과 보고서\n`;
    text += `========================================\n\n`;
    text += `생성 시간: ${timestamp}\n`;
    text += `세션 ID: ${sessionId || 'N/A'}\n\n`;
    text += `========================================\n\n`;

    messages.forEach((msg) => {
      if (msg.role === 'user') {
        text += `[사용자 질문]\n${msg.content}\n\n`;
      } else if (msg.role === 'assistant') {
        text += `[AI 응답]\n${msg.content}\n\n`;
        
        if (msg.verificationResult) {
          const result = msg.verificationResult;
          text += `[검증 결과]\n`;
          text += `- 주장: ${result.originalClaim}\n`;
          text += `- 판정: ${getVerificationLabel(result.status)}\n`;
          text += `- 신뢰도: ${Math.round((result.confidenceScore || 0) * 100)}%\n`;
          text += `- 요약: ${result.verificationSummary}\n\n`;
        }
      }
    });

    text += `========================================\n`;
    text += `이 보고서는 NewsInsight 팩트체크 챗봇에 의해 자동 생성되었습니다.\n`;

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `팩트체크_결과_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('텍스트 파일이 다운로드되었습니다.');
  }, [messages, sessionId]);

  const exportToJson = useCallback(() => {
    if (messages.length === 0) return;
    
    const exportData = {
      exportedAt: new Date().toISOString(),
      sessionId: sessionId || null,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        type: msg.type,
        verificationResult: msg.verificationResult,
        evidence: msg.evidence,
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `팩트체크_결과_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('JSON 파일이 다운로드되었습니다.');
  }, [messages, sessionId]);

  const copyToClipboard = useCallback(async () => {
    if (messages.length === 0) return;
    
    const text = messages
      .filter(m => m.role !== 'system' || m.type !== 'status')
      .map(m => {
        if (m.role === 'user') return `사용자: ${m.content}`;
        if (m.role === 'assistant') return `AI: ${m.content}`;
        return m.content;
      })
      .join('\n\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('클립보드에 복사되었습니다.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('복사에 실패했습니다.');
    }
  }, [messages]);

  // Determine height class
  const containerHeightClass = heightClass || (compact ? 'h-[500px]' : 'h-[calc(100vh-12rem)]');

  return (
    <div className={`flex flex-col ${containerHeightClass} ${compact ? '' : 'max-w-5xl mx-auto'}`}>
      <Card className="flex-1 flex flex-col">
        {!hideHeader && (
          <CardHeader className={`border-b ${compact ? 'py-3' : ''}`}>
            <div className="flex items-center gap-3">
              <div className={`${compact ? 'p-1.5' : 'p-2'} bg-primary/10 rounded-lg`}>
                <Shield className={`${compact ? 'h-5 w-5' : 'h-6 w-6'} text-primary`} />
              </div>
              <div>
                <CardTitle className={compact ? 'text-base' : ''}>팩트체크 챗봇</CardTitle>
                {!compact && (
                  <p className="text-sm text-muted-foreground mt-1">
                    궁금한 주장이나 뉴스를 입력하면 실시간으로 팩트체크 결과를 제공합니다
                  </p>
                )}
              </div>
              <div className="ml-auto flex items-center gap-2">
                {/* Export Menu */}
                {messages.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size={compact ? 'sm' : 'default'}>
                        <Download className="h-4 w-4 mr-1" />
                        내보내기
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>내보내기 형식</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={exportToMarkdown}>
                        <FileCode className="h-4 w-4 mr-2 text-blue-600" />
                        Markdown (.md)
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={exportToText}>
                        <FileText className="h-4 w-4 mr-2 text-gray-600" />
                        텍스트 (.txt)
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={exportToJson}>
                        <FileText className="h-4 w-4 mr-2 text-yellow-600" />
                        JSON (.json)
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={copyToClipboard}>
                        {copied ? (
                          <Check className="h-4 w-4 mr-2 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4 mr-2" />
                        )}
                        클립보드 복사
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {isConnected && (
                  <Badge variant="outline">
                    <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse" />
                    연결됨
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
        )}

        <CardContent className="flex-1 flex flex-col p-0 min-h-0">
          {/* 메시지 영역 */}
          <ScrollArea ref={scrollRef} className="flex-1 p-4">
            {/* 연결 오류 상태 */}
            {!isConnected && messages.length === 0 ? (
              <div className={`flex flex-col items-center justify-center h-full text-center ${compact ? 'p-4' : 'p-8'}`}>
                <AlertCircle className={`${compact ? 'h-12 w-12' : 'h-16 w-16'} text-destructive mb-4`} />
                <h3 className={`${compact ? 'text-base' : 'text-lg'} font-semibold mb-2`}>
                  세션 연결 중...
                </h3>
                <p className={`text-muted-foreground ${compact ? 'text-sm' : ''} max-w-md mb-4`}>
                  팩트체크 서버에 연결하고 있습니다. 잠시만 기다려주세요.
                </p>
                <Button onClick={handleReconnect} variant="outline" size="sm">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  다시 연결
                </Button>
              </div>
            ) : messages.length === 0 ? (
              <div className={`flex flex-col items-center justify-center h-full text-center ${compact ? 'p-4' : 'p-8'}`}>
                <Bot className={`${compact ? 'h-12 w-12' : 'h-16 w-16'} text-muted-foreground mb-4`} />
                <h3 className={`${compact ? 'text-base' : 'text-lg'} font-semibold mb-2`}>
                  {compact ? '팩트체크를 시작하세요' : '팩트체크 챗봇에 오신 것을 환영합니다!'}
                </h3>
                <p className={`text-muted-foreground ${compact ? 'text-sm' : ''} max-w-md`}>
                  검증하고 싶은 주장이나 뉴스를 입력해주세요. 
                  {!compact && '신뢰할 수 있는 출처를 기반으로 실시간 팩트체크를 수행합니다.'}
                </p>
                <div className={`${compact ? 'mt-4' : 'mt-6'} grid grid-cols-1 gap-2 w-full max-w-md`}>
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={() => setInput('메모리 반도체 가격이 상승하고 있다는 뉴스가 사실인가요?')}
                  >
                    💡 메모리 반도체 가격 상승 뉴스 검증
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={() => setInput('최근 발표된 경제 성장률 통계가 정확한가요?')}
                  >
                    📊 경제 통계 검증
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={() => setInput('이 정치인의 발언이 사실에 부합하나요?')}
                  >
                    🎤 정치인 발언 검증
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
                {isStreaming && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">분석 중...</span>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>

          {/* 입력 영역 */}
          <div className="border-t p-4">
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="팩트체크할 내용을 입력하세요..."
                disabled={isStreaming}
                className="flex-1"
              />
              <Button
                onClick={handleSend}
                disabled={!input.trim() || isStreaming}
                size="icon"
              >
                {isStreaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Enter로 전송 • Shift+Enter로 줄바꿈
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
});

// 메시지 버블 컴포넌트
const MessageBubble = ({ message }: { message: Message }) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  // 시스템 메시지 (상태 업데이트)
  if (isSystem && message.type === 'status') {
    return (
      <div className="flex justify-center">
        <Badge variant="secondary" className="text-xs">
          {message.content}
        </Badge>
      </div>
    );
  }

  // 증거 메시지
  if (message.type === 'evidence' && message.evidence) {
    return (
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
            <Shield className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
        </div>
        <div className="flex-1">
          <Alert>
            <AlertDescription>
              <p className="font-medium mb-2">{message.content}</p>
              <div className="space-y-2 mt-3">
                {message.evidence.slice(0, 3).map((ev: any, idx: number) => (
                  <div key={idx} className="text-sm border-l-2 border-primary pl-3">
                    <p className="font-medium">{ev.sourceName}</p>
                    <p className="text-muted-foreground text-xs mt-1">{ev.excerpt}</p>
                  </div>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  // 검증 결과 메시지
  if (message.type === 'verification' && message.verificationResult) {
    const result = message.verificationResult;
    const statusIcon = getVerificationIcon(result.status);
    
    return (
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center">
            {statusIcon}
          </div>
        </div>
        <div className="flex-1">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between mb-2">
                <p className="font-medium">{result.originalClaim}</p>
                <Badge variant={getVerificationVariant(result.status)}>
                  {getVerificationLabel(result.status)}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{result.verificationSummary}</p>
              {result.confidenceScore && (
                <div className="mt-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>신뢰도</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${result.confidenceScore * 100}%` }}
                      />
                    </div>
                    <span>{Math.round(result.confidenceScore * 100)}%</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // AI 합성 메시지 (스트리밍)
  if (message.type === 'ai_synthesis') {
    return (
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <Bot className="h-4 w-4 text-white" />
          </div>
        </div>
        <div className="flex-1 bg-muted/50 rounded-lg p-4">
          <MarkdownRenderer content={message.content} isStreaming={true} />
        </div>
      </div>
    );
  }

  // 완료 메시지
  if (message.type === 'complete') {
    return (
      <div className="flex justify-center">
        <Alert className="max-w-md">
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>{message.content}</AlertDescription>
        </Alert>
      </div>
    );
  }

  // 에러 메시지
  if (message.type === 'error') {
    return (
      <div className="flex justify-center">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{message.content}</AlertDescription>
        </Alert>
      </div>
    );
  }

  // 일반 사용자/어시스턴트 메시지
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className="flex-shrink-0">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
          isUser 
            ? 'bg-primary text-primary-foreground' 
            : 'bg-muted'
        }`}>
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </div>
      </div>
      <div className={`flex-1 max-w-[80%] ${isUser ? 'text-right' : ''}`}>
        <div className={`inline-block rounded-lg p-3 ${
          isUser 
            ? 'bg-primary text-primary-foreground' 
            : 'bg-muted'
        }`}>
          {message.content.includes('\n') || message.content.length > 100 ? (
            <MarkdownRenderer content={message.content} isStreaming={false} />
          ) : (
            <p className="text-sm">{message.content}</p>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {new Date(message.timestamp).toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </div>
    </div>
  );
};

// 헬퍼 함수들
const getVerificationIcon = (status: string) => {
  switch (status) {
    case 'VERIFIED':
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    case 'FALSE':
      return <XCircle className="h-4 w-4 text-red-600" />;
    case 'DISPUTED':
      return <Scale className="h-4 w-4 text-orange-600" />;
    default:
      return <AlertCircle className="h-4 w-4 text-gray-600" />;
  }
};

const getVerificationVariant = (status: string): 'default' | 'destructive' | 'outline' | 'secondary' => {
  switch (status) {
    case 'VERIFIED':
      return 'default';
    case 'FALSE':
      return 'destructive';
    case 'DISPUTED':
      return 'secondary';
    default:
      return 'outline';
  }
};

const getVerificationLabel = (status: string) => {
  switch (status) {
    case 'VERIFIED':
      return '검증됨';
    case 'FALSE':
      return '거짓';
    case 'DISPUTED':
      return '논쟁 중';
    case 'UNVERIFIED':
      return '검증 불가';
    default:
      return status;
  }
};

// Set displayName for forwardRef
FactCheckChatbot.displayName = 'FactCheckChatbot';

```

---

## frontend/src/components/KeywordCloud.tsx

```tsx
import { Card } from "@/components/ui/card";
import type { KeywordData } from "@/types/api";

interface KeywordCloudProps {
  keywords: KeywordData[];
}

export function KeywordCloud({ keywords }: KeywordCloudProps) {
  const maxScore = Math.max(...keywords.map((k) => k.score), 1);
  
  const getFontSize = (score: number) => {
    const normalized = (score / maxScore) * 100;
    return Math.max(12, Math.min(48, normalized / 2));
  };

  const getColor = (index: number) => {
    const colors = [
      "hsl(217, 91%, 60%)",
      "hsl(217, 91%, 45%)",
      "hsl(217, 91%, 75%)",
      "hsl(142, 71%, 45%)",
      "hsl(217, 91%, 35%)",
    ];
    return colors[index % colors.length];
  };

  return (
    <Card className="p-6 shadow-elegant card-hover">
      <h2 className="text-xl font-bold mb-6">핵심 키워드</h2>
      <div className="min-h-[300px] flex flex-wrap items-center justify-center gap-4 p-6">
        {keywords.length > 0 ? (
          keywords.map((keyword, index) => (
            <span
              key={`${keyword.word}-${index}`}
              className="font-semibold transition-transform hover:scale-110 cursor-default"
              style={{
                fontSize: `${getFontSize(keyword.score)}px`,
                color: getColor(index),
                lineHeight: 1.5,
              }}
              title={`중요도: ${keyword.score.toFixed(2)}`}
            >
              {keyword.word}
            </span>
          ))
        ) : (
          <div className="text-center text-muted-foreground py-12">
            키워드 데이터가 없습니다.
          </div>
        )}
      </div>
    </Card>
  );
}

```

---

## frontend/src/components/LoadingState.tsx

```tsx
import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";

/**
 * 통합 로딩 상태 컴포넌트
 * 
 * 다양한 로딩 패턴을 지원:
 * - spinner: 기본 스피너
 * - skeleton: 콘텐츠 형태 스켈레톤
 * - progress: 진행률 바
 * - dots: 점 애니메이션
 */

export type LoadingVariant = "spinner" | "skeleton" | "progress" | "dots";
export type LoadingSize = "sm" | "md" | "lg" | "xl";

interface LoadingStateProps {
  /** 로딩 변형 */
  variant?: LoadingVariant;
  /** 크기 */
  size?: LoadingSize;
  /** 표시할 텍스트 */
  text?: string;
  /** 진행률 (progress 변형에서 사용) */
  progress?: number;
  /** 전체 화면 오버레이로 표시 */
  fullScreen?: boolean;
  /** 추가 CSS 클래스 */
  className?: string;
  /** 스켈레톤 변형에서의 줄 수 */
  skeletonLines?: number;
}

const sizeConfig: Record<LoadingSize, { spinner: string; text: string; container: string }> = {
  sm: { spinner: "h-4 w-4", text: "text-xs", container: "gap-2" },
  md: { spinner: "h-6 w-6", text: "text-sm", container: "gap-3" },
  lg: { spinner: "h-8 w-8", text: "text-base", container: "gap-4" },
  xl: { spinner: "h-12 w-12", text: "text-lg", container: "gap-5" },
};

/** 스피너 로딩 */
const SpinnerLoading = ({ size = "md", text, className }: Pick<LoadingStateProps, "size" | "text" | "className">) => {
  const config = sizeConfig[size];
  return (
    <div className={cn("flex flex-col items-center justify-center", config.container, className)}>
      <Loader2 className={cn("animate-spin text-primary", config.spinner)} />
      {text && <span className={cn("text-muted-foreground", config.text)}>{text}</span>}
    </div>
  );
};

/** 점 애니메이션 로딩 */
const DotsLoading = ({ size = "md", text, className }: Pick<LoadingStateProps, "size" | "text" | "className">) => {
  const config = sizeConfig[size];
  const dotSize = size === "sm" ? "h-1.5 w-1.5" : size === "md" ? "h-2 w-2" : size === "lg" ? "h-2.5 w-2.5" : "h-3 w-3";
  
  return (
    <div className={cn("flex flex-col items-center justify-center", config.container, className)}>
      <div className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={cn(
              "rounded-full bg-primary animate-bounce",
              dotSize
            )}
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
      {text && <span className={cn("text-muted-foreground", config.text)}>{text}</span>}
    </div>
  );
};

/** 프로그레스 바 로딩 */
const ProgressLoading = ({
  size = "md",
  text,
  progress = 0,
  className,
}: Pick<LoadingStateProps, "size" | "text" | "progress" | "className">) => {
  const config = sizeConfig[size];
  const progressHeight = size === "sm" ? "h-1" : size === "md" ? "h-2" : size === "lg" ? "h-3" : "h-4";

  return (
    <div className={cn("flex flex-col w-full max-w-xs", config.container, className)}>
      <Progress value={progress} className={progressHeight} />
      <div className="flex justify-between items-center">
        {text && <span className={cn("text-muted-foreground", config.text)}>{text}</span>}
        <span className={cn("text-muted-foreground font-medium", config.text)}>{Math.round(progress)}%</span>
      </div>
    </div>
  );
};

/** 스켈레톤 로딩 */
const SkeletonLoading = ({
  size = "md",
  skeletonLines = 3,
  className,
}: Pick<LoadingStateProps, "size" | "skeletonLines" | "className">) => {
  const lineHeight = size === "sm" ? "h-3" : size === "md" ? "h-4" : size === "lg" ? "h-5" : "h-6";
  const gap = size === "sm" ? "gap-2" : size === "md" ? "gap-3" : "gap-4";

  return (
    <div className={cn("flex flex-col w-full", gap, className)}>
      {Array.from({ length: skeletonLines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(lineHeight, i === skeletonLines - 1 ? "w-3/4" : "w-full")}
        />
      ))}
    </div>
  );
};

/** 카드 스켈레톤 */
export const CardSkeleton = ({ className }: { className?: string }) => (
  <div className={cn("rounded-lg border bg-card p-4 space-y-3", className)}>
    <Skeleton className="h-4 w-1/3" />
    <Skeleton className="h-3 w-full" />
    <Skeleton className="h-3 w-full" />
    <Skeleton className="h-3 w-2/3" />
    <div className="flex gap-2 pt-2">
      <Skeleton className="h-6 w-16 rounded-full" />
      <Skeleton className="h-6 w-16 rounded-full" />
    </div>
  </div>
);

/** 검색 결과 스켈레톤 */
export const SearchResultSkeleton = ({ count = 3, className }: { count?: number; className?: string }) => (
  <div className={cn("space-y-4", className)}>
    {Array.from({ length: count }).map((_, i) => (
      <CardSkeleton key={i} />
    ))}
  </div>
);

/** 테이블 스켈레톤 */
export const TableSkeleton = ({ rows = 5, cols = 4, className }: { rows?: number; cols?: number; className?: string }) => (
  <div className={cn("space-y-2", className)}>
    {/* Header */}
    <div className="flex gap-4 pb-2 border-b">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} className="h-4 flex-1" />
      ))}
    </div>
    {/* Rows */}
    {Array.from({ length: rows }).map((_, rowIndex) => (
      <div key={rowIndex} className="flex gap-4 py-2">
        {Array.from({ length: cols }).map((_, colIndex) => (
          <Skeleton key={colIndex} className="h-4 flex-1" />
        ))}
      </div>
    ))}
  </div>
);

/** 인라인 로딩 (버튼, 텍스트 옆 등) */
export const InlineLoading = ({ text, className }: { text?: string; className?: string }) => (
  <span className={cn("inline-flex items-center gap-2", className)}>
    <Loader2 className="h-4 w-4 animate-spin" />
    {text && <span>{text}</span>}
  </span>
);

/** 메인 LoadingState 컴포넌트 */
export const LoadingState = ({
  variant = "spinner",
  size = "md",
  text,
  progress,
  fullScreen = false,
  className,
  skeletonLines,
}: LoadingStateProps) => {
  const content = React.useMemo(() => {
    switch (variant) {
      case "spinner":
        return <SpinnerLoading size={size} text={text} />;
      case "dots":
        return <DotsLoading size={size} text={text} />;
      case "progress":
        return <ProgressLoading size={size} text={text} progress={progress} />;
      case "skeleton":
        return <SkeletonLoading size={size} skeletonLines={skeletonLines} />;
      default:
        return <SpinnerLoading size={size} text={text} />;
    }
  }, [variant, size, text, progress, skeletonLines]);

  if (fullScreen) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        {content}
      </div>
    );
  }

  return <div className={cn("flex items-center justify-center p-4", className)}>{content}</div>;
};

export default LoadingState;

```

---

## frontend/src/components/MarkdownRenderer.tsx

```tsx
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  isStreaming?: boolean;
}

/**
 * Markdown renderer component with GitHub Flavored Markdown support.
 * Used for rendering AI analysis results and other markdown content.
 */
export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className,
  isStreaming = false,
}: MarkdownRendererProps) {
  return (
    <div
      className={cn(
        // Base prose styles
        "prose prose-sm dark:prose-invert max-w-none",
        // Headings
        "prose-headings:font-semibold prose-headings:text-foreground",
        "prose-h1:text-xl prose-h1:mt-4 prose-h1:mb-2",
        "prose-h2:text-lg prose-h2:mt-4 prose-h2:mb-2",
        "prose-h3:text-base prose-h3:mt-3 prose-h3:mb-1",
        // Paragraphs
        "prose-p:my-2 prose-p:leading-relaxed",
        // Lists
        "prose-ul:my-2 prose-ul:pl-4",
        "prose-ol:my-2 prose-ol:pl-4",
        "prose-li:my-0.5 prose-li:marker:text-muted-foreground",
        // Strong/Bold
        "prose-strong:font-semibold prose-strong:text-foreground",
        // Links
        "prose-a:text-primary prose-a:underline prose-a:underline-offset-2 hover:prose-a:text-primary/80",
        // Blockquotes
        "prose-blockquote:border-l-4 prose-blockquote:border-primary/30",
        "prose-blockquote:pl-4 prose-blockquote:italic",
        "prose-blockquote:text-muted-foreground",
        // Code
        "prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded",
        "prose-code:font-mono prose-code:text-sm",
        "prose-pre:bg-muted prose-pre:rounded-lg prose-pre:p-4",
        // Horizontal rule
        "prose-hr:border-border prose-hr:my-4",
        // Tables
        "prose-table:border prose-table:border-border",
        "prose-th:bg-muted prose-th:px-3 prose-th:py-2 prose-th:text-left",
        "prose-td:px-3 prose-td:py-2 prose-td:border-t prose-td:border-border",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Custom link component with external link icon
          a: ({ href, children, ...props }) => {
            const isExternal = href?.startsWith("http");
            return (
              <a
                href={href}
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noopener noreferrer" : undefined}
                className="inline-flex items-center gap-1"
                {...props}
              >
                {children}
                {isExternal && <ExternalLink className="h-3 w-3 inline-block" />}
              </a>
            );
          },
          // Custom heading with anchor support
          h2: ({ children, ...props }) => (
            <h2 className="flex items-center gap-2 border-b border-border pb-1 mb-3" {...props}>
              {children}
            </h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 className="flex items-center gap-1" {...props}>
              {children}
            </h3>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
      {/* Streaming cursor */}
      {isStreaming && (
        <span className="inline-block w-2 h-4 bg-primary/60 animate-pulse ml-0.5 align-text-bottom" />
      )}
    </div>
  );
});

export default MarkdownRenderer;

```

---

## frontend/src/components/MobileNavDrawer.tsx

```tsx
import { useState, useCallback, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Menu,
  X,
  Search,
  Bot,
  FolderOpen,
  History,
  Settings,
  Moon,
  Sun,
  Command,
  Database,
  Cpu,
  Home,
  LayoutDashboard,
  Wrench,
  FolderKanban,
  Activity,
  Gauge,
  Brain,
  Globe,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

interface NavSubItem {
  href: string;
  label: string;
  icon: typeof Search;
}

interface NavItem {
  id: string;
  href?: string;
  label: string;
  icon: typeof Search;
  color?: string;
  subItems?: NavSubItem[];
}

// 새로운 5탭 네비게이션 구조
const navItems: NavItem[] = [
  { 
    id: 'home',
    href: "/", 
    label: "홈", 
    icon: Home 
  },
  { 
    id: 'dashboard',
    label: "대시보드", 
    icon: LayoutDashboard,
    subItems: [
      { href: "/dashboard", label: "라이브 대시보드", icon: Activity },
      { href: "/operations", label: "운영 현황", icon: Gauge },
      { href: "/collected-data", label: "수집 데이터", icon: Database },
    ]
  },
  { 
    id: 'tools',
    href: "/tools",
    label: "도구", 
    icon: Wrench,
    color: "text-blue-600",
    subItems: [
      { href: "/search", label: "스마트 검색", icon: Search },
      { href: "/ml-addons", label: "ML Add-ons", icon: Cpu },
      { href: "/ai-agent", label: "브라우저 에이전트", icon: Bot },
      { href: "/ai-jobs", label: "AI Jobs", icon: Brain },
    ]
  },
  { 
    id: 'workspace',
    href: "/workspace",
    label: "내 작업", 
    icon: FolderKanban,
    color: "text-green-600",
    subItems: [
      { href: "/projects", label: "프로젝트", icon: FolderOpen },
      { href: "/history", label: "검색 기록", icon: History },
      { href: "/url-collections", label: "URL 컬렉션", icon: Globe },
    ]
  },
  { 
    id: 'settings',
    href: "/settings", 
    label: "설정", 
    icon: Settings 
  },
];

interface MobileNavDrawerProps {
  className?: string;
}

/**
 * 모바일 네비게이션 드로어 컴포넌트
 */
export function MobileNavDrawer({ className }: MobileNavDrawerProps) {
  const [open, setOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<string[]>([]);
  const location = useLocation();
  const { theme, setTheme } = useTheme();

  // Auto-expand section if current path matches
  useEffect(() => {
    navItems.forEach(item => {
      if (item.subItems?.some(sub => location.pathname === sub.href)) {
        setExpandedSections(prev => 
          prev.includes(item.id) ? prev : [...prev, item.id]
        );
      }
    });
  }, [location.pathname]);

  // Close drawer on route change
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  const toggleSection = (id: string) => {
    setExpandedSections(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const isActive = (href: string) => location.pathname === href;
  const isSectionActive = (item: NavItem) => {
    if (item.href && location.pathname === item.href) return true;
    return item.subItems?.some(sub => location.pathname === sub.href) ?? false;
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("md:hidden", className)}
          aria-label="메뉴 열기"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0">
        <SheetTitle className="sr-only">네비게이션 메뉴</SheetTitle>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b">
            <h2 className="font-bold text-lg bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              NewsInsight
            </h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setOpen(false)}
              aria-label="메뉴 닫기"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Navigation Links */}
          <nav className="flex-1 p-4 overflow-y-auto">
            <ul className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = isSectionActive(item);
                const isExpanded = expandedSections.includes(item.id);
                
                // Simple link (no submenu)
                if (!item.subItems) {
                  return (
                    <li key={item.id}>
                      <Link
                        to={item.href!}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                          active
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                        onClick={() => setOpen(false)}
                      >
                        <Icon className={cn("h-5 w-5", item.color)} />
                        <span>{item.label}</span>
                      </Link>
                    </li>
                  );
                }

                // Collapsible section with submenu
                return (
                  <li key={item.id}>
                    <Collapsible open={isExpanded} onOpenChange={() => toggleSection(item.id)}>
                      <CollapsibleTrigger asChild>
                        <button
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                            active
                              ? "bg-primary/10 text-primary"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          )}
                        >
                          <Icon className={cn("h-5 w-5", item.color)} />
                          <span className="flex-1 text-left">{item.label}</span>
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <ul className="ml-4 mt-1 space-y-1 border-l-2 border-muted pl-3">
                          {item.subItems.map((subItem) => {
                            const SubIcon = subItem.icon;
                            return (
                              <li key={subItem.href}>
                                <Link
                                  to={subItem.href}
                                  className={cn(
                                    "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                                    isActive(subItem.href)
                                      ? "bg-primary/10 text-primary font-medium"
                                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                  )}
                                  onClick={() => setOpen(false)}
                                >
                                  <SubIcon className="h-4 w-4" />
                                  <span>{subItem.label}</span>
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      </CollapsibleContent>
                    </Collapsible>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Footer Actions */}
          <div className="p-4 border-t space-y-2">
            {/* Command Palette Hint */}
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <Command className="h-4 w-4" />
                <span>빠른 검색</span>
              </div>
              <kbd className="px-1.5 py-0.5 rounded bg-background text-xs">Ctrl+K</kbd>
            </div>

            {/* Theme Toggle */}
            <Button
              variant="outline"
              className="w-full justify-start gap-3"
              onClick={toggleTheme}
            >
              {theme === "dark" ? (
                <>
                  <Sun className="h-4 w-4" />
                  <span>라이트 모드</span>
                </>
              ) : (
                <>
                  <Moon className="h-4 w-4" />
                  <span>다크 모드</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default MobileNavDrawer;

```

---

## frontend/src/components/NavLink.tsx

```tsx
import { NavLink as RouterNavLink, NavLinkProps } from "react-router-dom";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

interface NavLinkCompatProps extends Omit<NavLinkProps, "className"> {
  className?: string;
  activeClassName?: string;
  pendingClassName?: string;
}

const NavLink = forwardRef<HTMLAnchorElement, NavLinkCompatProps>(
  ({ className, activeClassName, pendingClassName, to, ...props }, ref) => {
    return (
      <RouterNavLink
        ref={ref}
        to={to}
        className={({ isActive, isPending }) =>
          cn(className, isActive && activeClassName, isPending && pendingClassName)
        }
        {...props}
      />
    );
  },
);

NavLink.displayName = "NavLink";

export { NavLink };

```

---

## frontend/src/components/PriorityUrlEditor.tsx

```tsx
import { useState, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  X,
  Link as LinkIcon,
  FolderOpen,
  Shield,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  GripVertical,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";

// Types
export interface PriorityUrl {
  id: string;
  url: string;
  name: string;
  reliability?: "high" | "medium" | "low" | "unknown";
}

interface PriorityUrlEditorProps {
  /** Storage key for sessionStorage */
  storageKey: string;
  /** Current priority URLs */
  urls: PriorityUrl[];
  /** Callback when URLs change */
  onUrlsChange: (urls: PriorityUrl[]) => void;
  /** Whether the editor is disabled */
  disabled?: boolean;
  /** Maximum number of URLs allowed */
  maxUrls?: number;
  /** Title for the card */
  title?: string;
  /** Description for the card */
  description?: string;
  /** Whether to show in collapsed mode initially */
  defaultCollapsed?: boolean;
  /** Custom class name */
  className?: string;
}

// Known reliable domains
const HIGH_RELIABILITY_DOMAINS = [
  "wikipedia.org",
  "namu.wiki",
  "britannica.com",
  "scholar.google.com",
  "pubmed.ncbi.nlm.nih.gov",
  "nature.com",
  "science.org",
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "bbc.co.uk",
  "nytimes.com",
  "washingtonpost.com",
  "theguardian.com",
  "gov.kr",
  "korea.kr",
  "bok.or.kr",
  "kosis.kr",
  "kostat.go.kr",
];

const MEDIUM_RELIABILITY_DOMAINS = [
  "yonhapnews.co.kr",
  "chosun.com",
  "donga.com",
  "joongang.co.kr",
  "hani.co.kr",
  "khan.co.kr",
  "kmib.co.kr",
  "mk.co.kr",
  "mt.co.kr",
  "hankyung.com",
  "yna.co.kr",
  "kbs.co.kr",
  "mbc.co.kr",
  "sbs.co.kr",
  "jtbc.co.kr",
  "cnn.com",
  "forbes.com",
  "bloomberg.com",
];

function getReliabilityFromUrl(url: string): PriorityUrl["reliability"] {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    
    // Check high reliability
    if (HIGH_RELIABILITY_DOMAINS.some((d) => hostname.includes(d))) {
      return "high";
    }
    
    // Check medium reliability
    if (MEDIUM_RELIABILITY_DOMAINS.some((d) => hostname.includes(d))) {
      return "medium";
    }
    
    // Government or educational domains
    if (hostname.endsWith(".gov") || hostname.endsWith(".edu") || hostname.endsWith(".ac.kr") || hostname.endsWith(".go.kr")) {
      return "high";
    }
    
    return "unknown";
  } catch {
    return "unknown";
  }
}

function generateUrlId(): string {
  return `url_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

const ReliabilityBadge = ({ reliability }: { reliability: PriorityUrl["reliability"] }) => {
  switch (reliability) {
    case "high":
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800">
                <Shield className="h-3 w-3 mr-1" />
                신뢰
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>높은 신뢰도: 공식 기관, 학술 사이트</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    case "medium":
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800">
                <Shield className="h-3 w-3 mr-1" />
                보통
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>일반 신뢰도: 주요 언론사</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    case "low":
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800">
                <AlertTriangle className="h-3 w-3 mr-1" />
                주의
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>낮은 신뢰도: 검증 필요</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    default:
      return null;
  }
};

export const PriorityUrlEditor = ({
  storageKey,
  urls,
  onUrlsChange,
  disabled = false,
  maxUrls = 10,
  title = "참고 URL",
  description = "분석 시 우선적으로 참고할 URL을 추가하세요.",
  defaultCollapsed = false,
  className = "",
}: PriorityUrlEditorProps) => {
  const { toast } = useToast();
  const [newUrl, setNewUrl] = useState("");
  const [isExpanded, setIsExpanded] = useState(!defaultCollapsed);
  const [isAdding, setIsAdding] = useState(false);

  // Persist to sessionStorage when URLs change
  useEffect(() => {
    if (urls.length > 0) {
      sessionStorage.setItem(storageKey, JSON.stringify(urls));
    } else {
      sessionStorage.removeItem(storageKey);
    }
  }, [urls, storageKey]);

  // Validate URL
  const isValidUrl = useCallback((url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }, []);

  // Add new URL
  const handleAddUrl = useCallback(() => {
    const trimmedUrl = newUrl.trim();
    
    if (!trimmedUrl) {
      toast({
        title: "URL을 입력하세요",
        variant: "destructive",
      });
      return;
    }

    // Add https:// if missing protocol
    let urlToAdd = trimmedUrl;
    if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")) {
      urlToAdd = `https://${trimmedUrl}`;
    }

    if (!isValidUrl(urlToAdd)) {
      toast({
        title: "유효하지 않은 URL입니다",
        description: "올바른 URL 형식을 입력하세요.",
        variant: "destructive",
      });
      return;
    }

    // Check for duplicates
    if (urls.some((u) => u.url === urlToAdd)) {
      toast({
        title: "이미 추가된 URL입니다",
        variant: "destructive",
      });
      return;
    }

    // Check max limit
    if (urls.length >= maxUrls) {
      toast({
        title: `최대 ${maxUrls}개까지 추가할 수 있습니다`,
        variant: "destructive",
      });
      return;
    }

    const hostname = getHostname(urlToAdd);
    const newPriorityUrl: PriorityUrl = {
      id: generateUrlId(),
      url: urlToAdd,
      name: hostname,
      reliability: getReliabilityFromUrl(urlToAdd),
    };

    onUrlsChange([...urls, newPriorityUrl]);
    setNewUrl("");
    setIsAdding(false);

    toast({
      title: "URL이 추가되었습니다",
      description: hostname,
    });
  }, [newUrl, urls, maxUrls, isValidUrl, onUrlsChange, toast]);

  // Remove URL
  const handleRemoveUrl = useCallback((id: string) => {
    onUrlsChange(urls.filter((u) => u.id !== id));
  }, [urls, onUrlsChange]);

  // Clear all URLs
  const handleClearAll = useCallback(() => {
    onUrlsChange([]);
    toast({
      title: "모든 URL이 제거되었습니다",
    });
  }, [onUrlsChange, toast]);

  // Handle Enter key
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddUrl();
    }
    if (e.key === "Escape") {
      setIsAdding(false);
      setNewUrl("");
    }
  }, [handleAddUrl]);

  // Empty state - show add button only
  if (urls.length === 0 && !isAdding) {
    return (
      <Card className={`border-dashed border-2 border-muted-foreground/20 ${className}`}>
        <CardContent className="py-6">
          <div className="text-center">
            <FolderOpen className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground mb-4">{description}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsAdding(true)}
              disabled={disabled}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              URL 추가
            </Button>
          </div>
          
          {isAdding && (
            <div className="mt-4 flex gap-2">
              <Input
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="https://example.com"
                autoFocus
                disabled={disabled}
                className="flex-1"
              />
              <Button
                size="sm"
                onClick={handleAddUrl}
                disabled={disabled || !newUrl.trim()}
              >
                추가
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIsAdding(false);
                  setNewUrl("");
                }}
              >
                취소
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10 ${className}`}>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5 text-blue-600" />
              <CardTitle className="text-lg">{title}</CardTitle>
              <Badge variant="secondary">{urls.length}개</Badge>
            </div>
            <div className="flex items-center gap-1">
              {urls.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearAll}
                  disabled={disabled}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4 mr-1" />
                  모두 제거
                </Button>
              )}
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm">
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="pt-0">
            {/* URL List */}
            <div className="space-y-2 mb-4">
              {urls.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground/50 cursor-grab" />
                  <LinkIcon className="h-4 w-4 text-blue-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate" title={item.url}>
                        {item.name || getHostname(item.url)}
                      </span>
                      {item.reliability && <ReliabilityBadge reliability={item.reliability} />}
                    </div>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted-foreground hover:text-blue-600 truncate block"
                    >
                      {item.url}
                    </a>
                  </div>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded hover:bg-muted transition-colors"
                    title="새 탭에서 열기"
                  >
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  </a>
                  <button
                    onClick={() => handleRemoveUrl(item.id)}
                    disabled={disabled}
                    className="p-1 rounded hover:bg-destructive/10 transition-colors"
                    title="제거"
                  >
                    <X className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add URL Input */}
            {urls.length < maxUrls && (
              <div className="flex gap-2">
                <Input
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="URL을 입력하세요..."
                  disabled={disabled}
                  className="flex-1 bg-white dark:bg-gray-800"
                />
                <Button
                  size="sm"
                  onClick={handleAddUrl}
                  disabled={disabled || !newUrl.trim()}
                  className="gap-1"
                >
                  <Plus className="h-4 w-4" />
                  추가
                </Button>
              </div>
            )}

            {/* Helper text */}
            <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
              <span>
                {urls.length}/{maxUrls}개 URL
              </span>
              <Link to="/url-collections" className="text-blue-600 hover:underline">
                URL 컬렉션에서 가져오기
              </Link>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

export default PriorityUrlEditor;

```

---

## frontend/src/components/ProtectedRoute.tsx

```tsx
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: 'viewer' | 'operator' | 'admin';
  allowSetup?: boolean; // Allow access even when password change is required (for setup page)
}

export function ProtectedRoute({ children, requiredRole, allowSetup = false }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, user, passwordChangeRequired } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    // Redirect to login page, preserving the intended destination
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }

  // Check if password change is required (initial setup)
  if (passwordChangeRequired && !allowSetup) {
    // Redirect to setup page
    return <Navigate to="/admin/setup" replace />;
  }

  // Check role if required
  if (requiredRole && user) {
    const roleHierarchy = ['viewer', 'operator', 'admin'];
    const userRoleIndex = roleHierarchy.indexOf(user.role);
    const requiredRoleIndex = roleHierarchy.indexOf(requiredRole);

    if (userRoleIndex < requiredRoleIndex) {
      // User doesn't have sufficient permissions
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-2">접근 권한이 없습니다</h1>
            <p className="text-muted-foreground">
              이 페이지에 접근하려면 {requiredRole} 이상의 권한이 필요합니다.
            </p>
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
}

```

---

## frontend/src/components/QuickAccessPanel.tsx

```tsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  X,
  History,
  Bookmark,
  Search,
  Loader2,
  ChevronRight,
  Clock,
  TrendingUp,
  Zap,
  Brain,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSearchHistory } from '@/hooks/useSearchHistory';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { SearchHistoryRecord } from '@/lib/api';

interface QuickAccessPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSearch?: (search: SearchHistoryRecord) => void;
}

export const QuickAccessPanel = ({ isOpen, onClose, onSelectSearch }: QuickAccessPanelProps) => {
  const [quickSearchQuery, setQuickSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'recent' | 'bookmarks' | 'ml'>('recent');
  
  const {
    history,
    loading,
    loadHistory,
    loadBookmarked,
  } = useSearchHistory({ pageSize: 5 });

  useEffect(() => {
    if (isOpen) {
      if (activeTab === 'recent') {
        loadHistory(0);
      } else if (activeTab === 'bookmarks') {
        loadBookmarked(0);
      }
    }
  }, [isOpen, activeTab, loadHistory, loadBookmarked]);

  if (!isOpen) return null;

  const handleQuickSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (quickSearchQuery.trim()) {
      window.location.href = `/search?q=${encodeURIComponent(quickSearchQuery)}`;
    }
  };

  const renderSearchItem = (item: SearchHistoryRecord) => (
    <div
      key={item.id}
      className="p-3 rounded-lg border border-border hover:bg-accent/50 cursor-pointer transition-colors group"
      onClick={() => {
        onSelectSearch?.(item);
        onClose();
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{item.query}</p>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>{formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: ko })}</span>
            {item.resultCount !== undefined && (
              <>
                <span>•</span>
                <span>{item.resultCount}건</span>
              </>
            )}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[100]"
        onClick={onClose}
      />
      
      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full sm:w-96 bg-background border-l border-border shadow-2xl z-[101] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">빠른 접근</h2>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Quick Search */}
          <form onSubmit={handleQuickSearch}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={quickSearchQuery}
                onChange={(e) => setQuickSearchQuery(e.target.value)}
                placeholder="빠른 검색..."
                className="pl-9"
              />
            </div>
          </form>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-2 border-b border-border">
          <Button
            variant={activeTab === 'recent' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('recent')}
            className="flex-1"
          >
            <History className="h-4 w-4 mr-2" />
            최근 검색
          </Button>
          <Button
            variant={activeTab === 'bookmarks' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('bookmarks')}
            className="flex-1"
          >
            <Bookmark className="h-4 w-4 mr-2" />
            북마크
          </Button>
          <Button
            variant={activeTab === 'ml' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('ml')}
            className="flex-1"
          >
            <Brain className="h-4 w-4 mr-2" />
            ML
          </Button>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1 p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : activeTab === 'recent' || activeTab === 'bookmarks' ? (
            <div className="space-y-2">
              {history.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p className="text-sm">
                    {activeTab === 'recent' ? '검색 기록이 없습니다' : '북마크가 없습니다'}
                  </p>
                </div>
              ) : (
                history.map(renderSearchItem)
              )}
              
              {history.length > 0 && (
                <Link
                  to="/history"
                  className="block text-center py-2 text-sm text-primary hover:underline"
                  onClick={onClose}
                >
                  전체 보기
                </Link>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {/* ML Training Quick Access */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Brain className="h-4 w-4" />
                    ML 학습
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Link to="/ml-training" onClick={onClose}>
                    <Button variant="outline" size="sm" className="w-full justify-start">
                      <Zap className="h-4 w-4 mr-2" />
                      학습 대시보드
                    </Button>
                  </Link>
                  <Link to="/ml-results" onClick={onClose}>
                    <Button variant="outline" size="sm" className="w-full justify-start">
                      <TrendingUp className="h-4 w-4 mr-2" />
                      분석 결과
                    </Button>
                  </Link>
                </CardContent>
              </Card>

              {/* ML Addons */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">ML Add-ons</CardTitle>
                </CardHeader>
                <CardContent>
                  <Link to="/ml-addons" onClick={onClose}>
                    <Button variant="outline" size="sm" className="w-full justify-start">
                      Add-on 관리
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </div>
          )}
        </ScrollArea>

        {/* Footer - Quick Links */}
        <div className="p-4 border-t border-border space-y-2">
          <div className="text-xs text-muted-foreground mb-2">빠른 링크</div>
          <div className="grid grid-cols-2 gap-2">
            <Link to="/search" onClick={onClose}>
              <Button variant="outline" size="sm" className="w-full">
                <Search className="h-3 w-3 mr-1" />
                검색
              </Button>
            </Link>
            <Link to="/history" onClick={onClose}>
              <Button variant="outline" size="sm" className="w-full">
                <History className="h-3 w-3 mr-1" />
                기록
              </Button>
            </Link>
            <Link to="/projects" onClick={onClose}>
              <Button variant="outline" size="sm" className="w-full">
                프로젝트
              </Button>
            </Link>
            <Link to="/settings" onClick={onClose}>
              <Button variant="outline" size="sm" className="w-full">
                설정
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </>
  );
};

export default QuickAccessPanel;

```

---

## frontend/src/components/ReportExportButton.tsx

```tsx
import { useState, useCallback } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  exportUnifiedSearchReport,
  exportDeepSearchReport,
  triggerPdfDownload,
  type ReportRequest,
  type ReportSection,
  type ReportType,
  DEFAULT_REPORT_SECTIONS,
} from '@/lib/api';
import type { ChartExportHandle } from '@/components/charts';

interface ReportExportButtonProps {
  /** Job ID for the search */
  jobId: string;
  /** Search query */
  query: string;
  /** Time window (1d, 7d, 30d) */
  timeWindow?: string;
  /** Report type */
  reportType?: ReportType;
  /** Chart refs for capturing chart images */
  chartRefs?: Record<string, React.RefObject<ChartExportHandle>>;
  /** Button variant */
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  /** Button size */
  size?: 'default' | 'sm' | 'lg' | 'icon';
  /** Additional CSS classes */
  className?: string;
  /** Disable the button */
  disabled?: boolean;
}

interface SectionOption {
  id: ReportSection;
  label: string;
  description: string;
}

const ALL_SECTIONS: SectionOption[] = [
  { id: 'COVER', label: '표지', description: '보고서 표지 및 기본 정보' },
  { id: 'EXECUTIVE_SUMMARY', label: '요약', description: 'AI 분석 요약 및 핵심 인사이트' },
  { id: 'DATA_SOURCE', label: '데이터 소스', description: '검색 소스별 결과 분포' },
  { id: 'TREND_ANALYSIS', label: '트렌드 분석', description: '시간대별 기사 추이' },
  { id: 'KEYWORD_ANALYSIS', label: '키워드 분석', description: '주요 키워드 및 빈도' },
  { id: 'SENTIMENT_ANALYSIS', label: '감정 분석', description: '긍정/부정/중립 분포' },
  { id: 'RELIABILITY', label: '신뢰도 분석', description: '출처별 신뢰도 평가' },
  { id: 'BIAS_ANALYSIS', label: '편향성 분석', description: '정치적/이념적 편향 분석' },
  { id: 'FACTCHECK', label: '팩트체크', description: '주요 주장 검증 결과' },
  { id: 'EVIDENCE_LIST', label: '증거 목록', description: '수집된 증거 및 출처' },
  { id: 'DETAILED_RESULTS', label: '상세 결과', description: '개별 기사 상세 정보' },
];

/**
 * PDF 보고서 내보내기 버튼 컴포넌트
 * 
 * 차트 이미지를 캡처하고 PDF 보고서를 생성합니다.
 */
export function ReportExportButton({
  jobId,
  query,
  timeWindow = '7d',
  reportType = 'UNIFIED_SEARCH',
  chartRefs,
  variant = 'default',
  size = 'default',
  className,
  disabled = false,
}: ReportExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedSections, setSelectedSections] = useState<ReportSection[]>(
    DEFAULT_REPORT_SECTIONS[reportType]
  );

  const captureChartImages = useCallback((): Record<string, string> => {
    const images: Record<string, string> = {};
    
    if (chartRefs) {
      for (const [key, ref] of Object.entries(chartRefs)) {
        if (ref.current) {
          const base64 = ref.current.toBase64();
          if (base64) {
            images[key] = base64;
          }
        }
      }
    }
    
    return images;
  }, [chartRefs]);

  const handleExport = async () => {
    setIsExporting(true);
    
    try {
      // Capture chart images
      const chartImages = captureChartImages();
      
      const request: ReportRequest = {
        reportType,
        targetId: jobId,
        query,
        timeWindow,
        includeSections: selectedSections,
        chartImages,
        language: 'ko',
      };

      let blob: Blob;
      
      if (reportType === 'DEEP_SEARCH') {
        blob = await exportDeepSearchReport(jobId, request);
      } else {
        blob = await exportUnifiedSearchReport(jobId, request);
      }

      // Generate filename
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const safeQuery = query.replace(/[^가-힣a-zA-Z0-9]/g, '_').slice(0, 30);
      const typeLabel = reportType === 'DEEP_SEARCH' ? 'DeepSearch' : '통합검색';
      const filename = `NewsInsight_${typeLabel}_${safeQuery}_${timestamp}.pdf`;

      // Trigger download
      triggerPdfDownload(blob, filename);
      
      toast.success('PDF 보고서가 다운로드되었습니다.');
      setIsOpen(false);
    } catch (error) {
      console.error('Report export failed:', error);
      toast.error('보고서 생성에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setIsExporting(false);
    }
  };

  const toggleSection = (sectionId: ReportSection) => {
    setSelectedSections((prev) =>
      prev.includes(sectionId)
        ? prev.filter((s) => s !== sectionId)
        : [...prev, sectionId]
    );
  };

  const selectAll = () => {
    setSelectedSections(ALL_SECTIONS.map((s) => s.id));
  };

  const selectDefault = () => {
    setSelectedSections(DEFAULT_REPORT_SECTIONS[reportType]);
  };

  const availableSections = ALL_SECTIONS.filter((section) => {
    // Filter sections based on report type
    if (reportType === 'UNIFIED_SEARCH') {
      return section.id !== 'EVIDENCE_LIST';
    }
    if (reportType === 'DEEP_SEARCH') {
      return section.id !== 'TREND_ANALYSIS' && section.id !== 'KEYWORD_ANALYSIS';
    }
    return true;
  });

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant={variant}
          size={size}
          className={className}
          disabled={disabled || !jobId}
        >
          <FileText className="h-4 w-4 mr-2" />
          PDF 보고서
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>PDF 보고서 내보내기</DialogTitle>
          <DialogDescription>
            보고서에 포함할 섹션을 선택하세요.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {/* Quick actions */}
          <div className="flex gap-2 mb-4">
            <Button variant="outline" size="sm" onClick={selectAll}>
              전체 선택
            </Button>
            <Button variant="outline" size="sm" onClick={selectDefault}>
              기본값
            </Button>
          </div>

          {/* Section selection */}
          <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
            {availableSections.map((section) => (
              <div
                key={section.id}
                className="flex items-start space-x-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <Checkbox
                  id={section.id}
                  checked={selectedSections.includes(section.id)}
                  onCheckedChange={() => toggleSection(section.id)}
                />
                <div className="flex-1">
                  <Label
                    htmlFor={section.id}
                    className="text-sm font-medium cursor-pointer"
                  >
                    {section.label}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {section.description}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="mt-4 pt-4 border-t text-sm text-muted-foreground">
            {selectedSections.length}개 섹션 선택됨
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            취소
          </Button>
          <Button
            onClick={handleExport}
            disabled={isExporting || selectedSections.length === 0}
          >
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                생성 중...
              </>
            ) : (
              <>
                <FileText className="h-4 w-4 mr-2" />
                내보내기
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ReportExportButton;

```

---

## frontend/src/components/SearchBar.tsx

```tsx
import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";

interface SearchBarProps {
  onSearch: (query: string, window: string) => void;
  isLoading?: boolean;
}

export function SearchBar({ onSearch, isLoading = false }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [window, setWindow] = useState("7d");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch(query.trim(), window);
    }
  };

  return (
    <Card className="p-6 shadow-elegant card-hover">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <Input
              type="text"
              placeholder="분석하고 싶은 키워드를 입력하세요..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={isLoading}
              className="h-12 text-base"
            />
          </div>
          <div className="w-full sm:w-40">
            <Select value={window} onValueChange={setWindow} disabled={isLoading}>
              <SelectTrigger className="h-12">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card z-50">
                <SelectItem value="1d">최근 1일</SelectItem>
                <SelectItem value="7d">최근 7일</SelectItem>
                <SelectItem value="30d">최근 30일</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            type="submit"
            disabled={isLoading || !query.trim()}
            variant="gradient"
            size="lg"
            className="w-full sm:w-auto"
          >
            {isLoading ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                분석 중...
              </>
            ) : (
              <>
                <Search className="h-5 w-5" />
                분석하기
              </>
            )}
          </Button>
        </div>
      </form>
    </Card>
  );
}

```

---

## frontend/src/components/SearchHistoryPanel.tsx

```tsx
import { useState, useEffect, useCallback } from 'react';
import { useSearchHistory, useSearchHistorySSE } from '@/hooks/useSearchHistory';
import type { SearchHistoryRecord, SearchHistoryType } from '@/lib/api';
import { updateSearchNotes, getSearchHistoryById } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import { toast } from 'sonner';

interface SearchHistoryPanelProps {
  onSelectSearch?: (search: SearchHistoryRecord) => void;
  onDeriveSearch?: (search: SearchHistoryRecord) => void;
  className?: string;
  enableRealtime?: boolean;
}

const searchTypeLabels: Record<SearchHistoryType, string> = {
  UNIFIED: '통합검색',
  DEEP_SEARCH: '딥서치',
  FACT_CHECK: '팩트체크',
  BROWSER_AGENT: '브라우저 에이전트',
};

const searchTypeColors: Record<SearchHistoryType, string> = {
  UNIFIED: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  DEEP_SEARCH: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  FACT_CHECK: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  BROWSER_AGENT: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
};

export function SearchHistoryPanel({
  onSelectSearch,
  onDeriveSearch,
  className = '',
  enableRealtime = true,
}: SearchHistoryPanelProps) {
  const {
    history,
    loading,
    error,
    currentPage,
    totalPages,
    totalElements,
    loadHistory,
    loadBookmarked,
    searchHistory,
    toggleBookmark,
    deleteSearch,
    loadDerivedSearches,
  } = useSearchHistory({ pageSize: 10 });

  const [filter, setFilter] = useState<SearchHistoryType | 'all' | 'bookmarked'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [derivedSearches, setDerivedSearches] = useState<Record<number, SearchHistoryRecord[]>>({});
  const [localHistory, setLocalHistory] = useState<SearchHistoryRecord[]>([]);
  const [newItemIds, setNewItemIds] = useState<Set<number>>(new Set());
  
  // Notes editing state
  const [editingNotesId, setEditingNotesId] = useState<number | null>(null);
  const [notesValue, setNotesValue] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  // Sync local history with server history
  useEffect(() => {
    setLocalHistory(history);
  }, [history]);

  // SSE real-time updates
  const { connected: sseConnected } = useSearchHistorySSE({
    enabled: enableRealtime,
    onNewSearch: useCallback((newSearch: SearchHistoryRecord) => {
      // Only add if we're on page 0 and filter matches
      if (currentPage === 0) {
        const matchesFilter = 
          filter === 'all' || 
          (filter === 'bookmarked' && newSearch.bookmarked) ||
          filter === newSearch.searchType;
        
        if (matchesFilter && !newSearch.parentSearchId) {
          setLocalHistory(prev => {
            // Prevent duplicates
            if (prev.some(item => item.id === newSearch.id)) {
              return prev;
            }
            // Add to the beginning
            return [newSearch, ...prev];
          });
          // Mark as new for highlight animation
          setNewItemIds(prev => new Set([...prev, newSearch.id]));
          // Remove highlight after animation
          setTimeout(() => {
            setNewItemIds(prev => {
              const next = new Set(prev);
              next.delete(newSearch.id);
              return next;
            });
          }, 3000);
        }
      }
    }, [currentPage, filter]),
    onUpdatedSearch: useCallback((updatedSearch: SearchHistoryRecord) => {
      setLocalHistory(prev => prev.map(item => 
        item.id === updatedSearch.id ? updatedSearch : item
      ));
    }, []),
    onDeletedSearch: useCallback((id: number) => {
      setLocalHistory(prev => prev.filter(item => item.id !== id));
    }, []),
  });

  // Load initial data
  useEffect(() => {
    loadHistory(0);
  }, [loadHistory]);

  // Handle filter change
  const handleFilterChange = useCallback((newFilter: SearchHistoryType | 'all' | 'bookmarked') => {
    setFilter(newFilter);
    setSearchQuery('');
    if (newFilter === 'bookmarked') {
      loadBookmarked(0);
    } else if (newFilter === 'all') {
      loadHistory(0);
    } else {
      loadHistory(0, newFilter);
    }
  }, [loadHistory, loadBookmarked]);

  // Handle search
  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      searchHistory(searchQuery.trim(), 0);
    } else {
      loadHistory(0);
    }
  }, [searchQuery, searchHistory, loadHistory]);

  // Handle page change
  const handlePageChange = useCallback((page: number) => {
    if (searchQuery.trim()) {
      searchHistory(searchQuery.trim(), page);
    } else if (filter === 'bookmarked') {
      loadBookmarked(page);
    } else if (filter === 'all') {
      loadHistory(page);
    } else {
      loadHistory(page, filter);
    }
  }, [searchQuery, filter, searchHistory, loadBookmarked, loadHistory]);

  // Handle expand to show derived searches
  const handleExpand = useCallback(async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!derivedSearches[id]) {
      const derived = await loadDerivedSearches(id);
      setDerivedSearches(prev => ({ ...prev, [id]: derived }));
    }
  }, [expandedId, derivedSearches, loadDerivedSearches]);

  // Handle bookmark toggle
  const handleToggleBookmark = useCallback(async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await toggleBookmark(id);
  }, [toggleBookmark]);

  // Handle delete
  const handleDelete = useCallback(async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('이 검색 기록을 삭제하시겠습니까?')) {
      await deleteSearch(id);
    }
  }, [deleteSearch]);

  // Handle notes editing
  const handleStartEditNotes = useCallback((item: SearchHistoryRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingNotesId(item.id);
    setNotesValue(item.notes || '');
  }, []);

  const handleSaveNotes = useCallback(async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSavingNotes(true);
    try {
      const updated = await updateSearchNotes(id, notesValue);
      setLocalHistory(prev => prev.map(item => 
        item.id === id ? { ...item, notes: updated.notes } : item
      ));
      setEditingNotesId(null);
      setNotesValue('');
    } catch (err) {
      console.error('Failed to save notes:', err);
      alert('노트 저장에 실패했습니다.');
    } finally {
      setSavingNotes(false);
    }
  }, [notesValue]);

  const handleCancelEditNotes = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingNotesId(null);
    setNotesValue('');
  }, []);

  // Export AI report from search history
  const handleExportAiReport = useCallback(async (item: SearchHistoryRecord, format: 'markdown' | 'html' | 'text', e: React.MouseEvent) => {
    e.stopPropagation();
    
    try {
      // Fetch full record with aiSummary if not already loaded
      let aiContent: string | undefined;
      
      if (item.aiSummary && typeof item.aiSummary === 'object') {
        const summary = item.aiSummary as Record<string, unknown>;
        aiContent = summary.content as string || summary.summary as string;
      }
      
      // If no content in the current item, fetch from server
      if (!aiContent && item.id) {
        const fullRecord = await getSearchHistoryById(item.id);
        if (fullRecord.aiSummary && typeof fullRecord.aiSummary === 'object') {
          const summary = fullRecord.aiSummary as Record<string, unknown>;
          aiContent = summary.content as string || summary.summary as string;
        }
      }
      
      if (!aiContent) {
        toast.error('내보낼 AI 분석 내용이 없습니다.');
        return;
      }
      
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const safeQuery = item.query.replace(/[^가-힣a-zA-Z0-9]/g, '_').slice(0, 30);
      const baseFilename = `NewsInsight_${searchTypeLabels[item.searchType]}_${safeQuery}_${timestamp}`;
      
      let content: string;
      let mimeType: string;
      let extension: string;
      
      if (format === 'markdown') {
        content = `# NewsInsight AI 분석 보고서

**검색어**: ${item.query}  
**검색 유형**: ${searchTypeLabels[item.searchType]}  
**생성 시간**: ${new Date(item.createdAt).toLocaleString('ko-KR')}

---

${aiContent}

---

*이 보고서는 NewsInsight AI에 의해 자동 생성되었습니다.*
`;
        mimeType = 'text/markdown;charset=utf-8';
        extension = 'md';
      } else if (format === 'html') {
        content = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NewsInsight AI 분석 - ${item.query}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; line-height: 1.6; }
    h1 { color: #7c3aed; border-bottom: 2px solid #7c3aed; padding-bottom: 0.5rem; }
    h2, h3 { color: #374151; margin-top: 1.5rem; }
    .meta { color: #6b7280; font-size: 0.9rem; margin-bottom: 1.5rem; }
    pre { background: #f3f4f6; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>NewsInsight AI 분석 보고서</h1>
  <div class="meta">
    <p><strong>검색어:</strong> ${item.query}</p>
    <p><strong>검색 유형:</strong> ${searchTypeLabels[item.searchType]}</p>
    <p><strong>생성 시간:</strong> ${new Date(item.createdAt).toLocaleString('ko-KR')}</p>
  </div>
  <hr>
  <div class="content">
    ${aiContent.replace(/\n/g, '<br>')}
  </div>
  <hr>
  <footer style="color: #9ca3af; font-size: 0.8rem; text-align: center; margin-top: 2rem;">
    이 보고서는 NewsInsight AI에 의해 자동 생성되었습니다.
  </footer>
</body>
</html>`;
        mimeType = 'text/html;charset=utf-8';
        extension = 'html';
      } else {
        // Plain text
        content = `NewsInsight AI 분석 보고서
========================================

검색어: ${item.query}
검색 유형: ${searchTypeLabels[item.searchType]}
생성 시간: ${new Date(item.createdAt).toLocaleString('ko-KR')}

========================================

${aiContent.replace(/[#*`]/g, '')}

========================================

이 보고서는 NewsInsight AI에 의해 자동 생성되었습니다.
`;
        mimeType = 'text/plain;charset=utf-8';
        extension = 'txt';
      }
      
      // Download file
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseFilename}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.success(`${format === 'markdown' ? 'Markdown' : format === 'html' ? 'HTML' : '텍스트'} 파일이 다운로드되었습니다.`);
    } catch (err) {
      console.error('Failed to export AI report:', err);
      toast.error('AI 보고서 내보내기에 실패했습니다.');
    }
  }, []);

  // Check if item has AI content
  const hasAiContent = useCallback((item: SearchHistoryRecord): boolean => {
    if (!item.aiSummary || typeof item.aiSummary !== 'object') return false;
    const summary = item.aiSummary as Record<string, unknown>;
    return !!(summary.content || summary.summary);
  }, []);

  // Render a single history item
  const renderHistoryItem = (item: SearchHistoryRecord, isChild = false) => {
    const isNew = newItemIds.has(item.id);
    
    return (
      <div
        key={item.id}
        className={`
          border rounded-lg p-3 cursor-pointer transition-all
          hover:border-blue-300 hover:shadow-sm
          ${isChild ? 'ml-6 border-l-4 border-l-purple-400' : ''}
          ${expandedId === item.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-950' : 'border-gray-200 dark:border-gray-700'}
          ${isNew ? 'animate-pulse border-green-400 bg-green-50 dark:bg-green-950' : ''}
        `}
        onClick={() => onSelectSearch?.(item)}
      >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Type badge and query */}
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs px-2 py-0.5 rounded ${searchTypeColors[item.searchType]}`}>
              {searchTypeLabels[item.searchType]}
            </span>
            {item.depthLevel && item.depthLevel > 0 && (
              <span className="text-xs text-purple-600 dark:text-purple-400">
                드릴다운 Lv.{item.depthLevel}
              </span>
            )}
            {!item.success && (
              <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                실패
              </span>
            )}
          </div>
          
          {/* Query */}
          <p className="font-medium text-gray-900 dark:text-gray-100 truncate" title={item.query}>
            {item.query}
          </p>
          
          {/* Stats */}
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
            <span>결과: {item.resultCount ?? 0}건</span>
            {item.credibilityScore !== undefined && (
              <span>신뢰도: {Math.round(item.credibilityScore)}%</span>
            )}
            {item.durationMs !== undefined && (
              <span>{(item.durationMs / 1000).toFixed(1)}초</span>
            )}
            <span>
              {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: ko })}
            </span>
          </div>
        </div>
        
        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => handleToggleBookmark(item.id, e)}
            className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 ${
              item.bookmarked ? 'text-yellow-500' : 'text-gray-400'
            }`}
            title={item.bookmarked ? '북마크 해제' : '북마크'}
          >
            <svg className="w-4 h-4" fill={item.bookmarked ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
          </button>
          
          {/* Notes button */}
          <button
            onClick={(e) => handleStartEditNotes(item, e)}
            className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 ${
              item.notes ? 'text-amber-500' : 'text-gray-400'
            }`}
            title={item.notes ? '노트 편집' : '노트 추가'}
          >
            <svg className="w-4 h-4" fill={item.notes ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          
          {/* Export AI Report dropdown */}
          {hasAiContent(item) && (
            <div className="relative group">
              <button
                onClick={(e) => e.stopPropagation()}
                className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-green-500 hover:text-green-600"
                title="AI 보고서 내보내기"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
              {/* Dropdown menu */}
              <div className="absolute right-0 top-full mt-1 w-40 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                <button
                  onClick={(e) => handleExportAiReport(item, 'markdown', e)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded-t-lg flex items-center gap-2"
                >
                  <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Markdown
                </button>
                <button
                  onClick={(e) => handleExportAiReport(item, 'html', e)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                >
                  <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                  HTML
                </button>
                <button
                  onClick={(e) => handleExportAiReport(item, 'text', e)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded-b-lg flex items-center gap-2"
                >
                  <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  텍스트
                </button>
              </div>
            </div>
          )}
          
          {onDeriveSearch && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeriveSearch(item);
              }}
              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-blue-500"
              title="파생 검색"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
          )}
          
          <button
            onClick={(e) => handleExpand(item.id)}
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"
            title="드릴다운 기록 보기"
          >
            <svg className={`w-4 h-4 transition-transform ${expandedId === item.id ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          <button
            onClick={(e) => handleDelete(item.id, e)}
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-red-500"
            title="삭제"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
      
      {/* Notes display/edit section */}
      {(item.notes || editingNotesId === item.id) && (
        <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700" onClick={(e) => e.stopPropagation()}>
          {editingNotesId === item.id ? (
            <div className="space-y-2">
              <textarea
                value={notesValue}
                onChange={(e) => setNotesValue(e.target.value)}
                placeholder="검색에 대한 메모를 입력하세요..."
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-none"
                rows={3}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={handleCancelEditNotes}
                  className="px-2 py-1 text-xs rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  취소
                </button>
                <button
                  onClick={(e) => handleSaveNotes(item.id, e)}
                  disabled={savingNotes}
                  className="px-2 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
                >
                  {savingNotes ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          ) : (
            <div 
              className="text-xs text-gray-600 dark:text-gray-400 bg-amber-50 dark:bg-amber-900/20 p-2 rounded cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/30"
              onClick={(e) => handleStartEditNotes(item, e)}
              title="클릭하여 편집"
            >
              <div className="flex items-start gap-1">
                <svg className="w-3 h-3 mt-0.5 flex-shrink-0 text-amber-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                <span className="whitespace-pre-wrap">{item.notes}</span>
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Expanded: Show derived searches */}
      {expandedId === item.id && derivedSearches[item.id] && derivedSearches[item.id].length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">파생 검색 ({derivedSearches[item.id].length}건)</p>
          {derivedSearches[item.id].map(derived => renderHistoryItem(derived, true))}
        </div>
      )}
    </div>
  )};

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 pb-3 mb-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            검색 기록
          </h3>
          {/* SSE connection status */}
          {enableRealtime && (
            <div className="flex items-center gap-1.5">
              <span 
                className={`w-2 h-2 rounded-full ${sseConnected ? 'bg-green-500' : 'bg-red-500'}`}
                title={sseConnected ? '실시간 연결됨' : '연결 끊김'}
              />
              <span className="text-xs text-gray-400">
                {sseConnected ? '실시간' : '오프라인'}
              </span>
            </div>
          )}
        </div>
        
        {/* Search input */}
        <form onSubmit={handleSearch} className="mb-3">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="검색 기록 검색..."
              className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
            <button
              type="submit"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          </div>
        </form>
        
        {/* Filter buttons */}
        <div className="flex flex-wrap gap-1.5">
          {(['all', 'bookmarked', 'UNIFIED', 'DEEP_SEARCH', 'FACT_CHECK', 'BROWSER_AGENT'] as const).map((f) => (
            <button
              key={f}
              onClick={() => handleFilterChange(f)}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                filter === f
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {f === 'all' ? '전체' : f === 'bookmarked' ? '북마크' : searchTypeLabels[f]}
            </button>
          ))}
        </div>
      </div>
      
      {/* Stats */}
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        총 {totalElements}건 {localHistory.length > history.length && `(+${localHistory.length - history.length} 새 항목)`}
      </div>
      
      {/* History list */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
          </div>
        ) : error ? (
          <div className="text-center py-8 text-red-500">
            <p>{error}</p>
            <button
              onClick={() => loadHistory(0)}
              className="mt-2 text-sm text-blue-500 hover:underline"
            >
              다시 시도
            </button>
          </div>
        ) : localHistory.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <p>검색 기록이 없습니다</p>
          </div>
        ) : (
          localHistory.filter(item => !item.parentSearchId).map(item => renderHistoryItem(item))
        )}
      </div>
      
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-3 border-t border-gray-200 dark:border-gray-700 mt-3">
          <button
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 0}
            className="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            이전
          </button>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {currentPage + 1} / {totalPages}
          </span>
          <button
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage >= totalPages - 1}
            className="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}

export default SearchHistoryPanel;

```

---

## frontend/src/components/SearchInputWithSuggestions.tsx

```tsx
import { useState, useRef, useEffect, useCallback, forwardRef } from "react";
import {
  Search,
  Clock,
  TrendingUp,
  X,
  Sparkles,
  Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useSearchSuggestions, SearchSuggestion } from "@/hooks/useSearchSuggestions";

interface SearchInputWithSuggestionsProps {
  /** 현재 검색어 */
  value: string;
  /** 검색어 변경 핸들러 */
  onChange: (value: string) => void;
  /** 검색 실행 핸들러 */
  onSearch: (query: string) => void;
  /** 플레이스홀더 */
  placeholder?: string;
  /** 로딩 중 여부 */
  isLoading?: boolean;
  /** 비활성화 여부 */
  disabled?: boolean;
  /** 기본 제안 키워드 */
  defaultSuggestions?: string[];
  /** 트렌딩 키워드 */
  trendingKeywords?: string[];
  /** 추가 CSS 클래스 */
  className?: string;
  /** 입력 필드 크기 */
  size?: "sm" | "default" | "lg";
}

const typeConfig: Record<SearchSuggestion["type"], { icon: typeof Clock; label: string; color: string }> = {
  history: { icon: Clock, label: "최근", color: "text-muted-foreground" },
  trending: { icon: TrendingUp, label: "트렌딩", color: "text-orange-500" },
  suggestion: { icon: Sparkles, label: "추천", color: "text-blue-500" },
};

export const SearchInputWithSuggestions = forwardRef<HTMLInputElement, SearchInputWithSuggestionsProps>(
  (
    {
      value,
      onChange,
      onSearch,
      placeholder = "검색어를 입력하세요...",
      isLoading = false,
      disabled = false,
      defaultSuggestions = [
        "AI 기술 동향",
        "기후변화",
        "경제 전망",
        "의료 혁신",
        "우주 탐사",
        "사이버 보안",
        "전기차",
        "반도체",
      ],
      trendingKeywords = [],
      className,
      size = "default",
    },
    ref
  ) => {
    const [open, setOpen] = useState(false);
    const [inputFocused, setInputFocused] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const {
      recentSearches,
      addToHistory,
      removeFromHistory,
      clearHistory,
      getSuggestions,
    } = useSearchSuggestions({
      defaultSuggestions,
      trendingKeywords,
    });

    const suggestions = getSuggestions(value);

    // 검색 실행
    const handleSearch = useCallback(
      (query: string) => {
        if (!query.trim()) return;
        addToHistory(query);
        onSearch(query);
        setOpen(false);
      },
      [addToHistory, onSearch]
    );

    // 엔터 키 핸들러
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && value.trim()) {
          e.preventDefault();
          handleSearch(value);
        }
        if (e.key === "Escape") {
          setOpen(false);
          inputRef.current?.blur();
        }
        // 아래 화살표로 제안 목록 포커스
        if (e.key === "ArrowDown" && suggestions.length > 0) {
          e.preventDefault();
          setOpen(true);
        }
      },
      [value, handleSearch, suggestions.length]
    );

    // 제안 선택
    const handleSelect = useCallback(
      (suggestion: SearchSuggestion) => {
        onChange(suggestion.text);
        handleSearch(suggestion.text);
      },
      [onChange, handleSearch]
    );

    // 클릭 외부 감지
    useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          setOpen(false);
        }
      };
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // 입력 포커스 시 열기
    useEffect(() => {
      if (inputFocused && (suggestions.length > 0 || recentSearches.length > 0)) {
        setOpen(true);
      }
    }, [inputFocused, suggestions.length, recentSearches.length]);

    const inputSizeClass = size === "sm" ? "h-9 text-sm" : size === "lg" ? "h-12 text-lg" : "h-10";
    const iconSizeClass = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-6 w-6" : "h-5 w-5";

    return (
      <div ref={containerRef} className={cn("relative", className)}>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <div className="relative">
              {/* 검색 아이콘 */}
              <Search
                className={cn(
                  "absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground",
                  iconSizeClass
                )}
              />

              {/* 입력 필드 */}
              <Input
                ref={ref || inputRef}
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                disabled={disabled || isLoading}
                className={cn(
                  "pl-10 pr-20",
                  inputSizeClass,
                  open && "ring-2 ring-primary/20"
                )}
              />

              {/* 오른쪽 액션 버튼들 */}
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {/* 클리어 버튼 */}
                {value && !isLoading && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => onChange("")}
                    tabIndex={-1}
                  >
                    <X className="h-4 w-4" />
                    <span className="sr-only">검색어 지우기</span>
                  </Button>
                )}

                {/* 검색 버튼 */}
                <Button
                  type="button"
                  size="sm"
                  disabled={!value.trim() || isLoading}
                  onClick={() => handleSearch(value)}
                  className="h-7"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "검색"
                  )}
                </Button>
              </div>
            </div>
          </PopoverTrigger>

          <PopoverContent
            className="w-[var(--radix-popover-trigger-width)] p-0"
            align="start"
            sideOffset={4}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <Command>
              <CommandList>
                {/* 검색 결과 없음 */}
                {suggestions.length === 0 && recentSearches.length === 0 && (
                  <CommandEmpty>검색어를 입력하세요</CommandEmpty>
                )}

                {/* 제안 목록 */}
                {suggestions.length > 0 && (
                  <CommandGroup heading="검색 제안">
                    {suggestions.map((suggestion, index) => {
                      const config = typeConfig[suggestion.type];
                      const Icon = config.icon;
                      return (
                        <CommandItem
                          key={`${suggestion.type}-${suggestion.text}-${index}`}
                          value={suggestion.text}
                          onSelect={() => handleSelect(suggestion)}
                          className="flex items-center justify-between cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <Icon className={cn("h-4 w-4", config.color)} />
                            <span>{suggestion.text}</span>
                          </div>
                          {suggestion.type === "history" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 opacity-0 group-hover:opacity-100"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeFromHistory(suggestion.text);
                              }}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                          {suggestion.type === "trending" && (
                            <Badge variant="secondary" className="text-xs">
                              트렌딩
                            </Badge>
                          )}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                )}

                {/* 최근 검색어 (입력이 없을 때만) */}
                {!value && recentSearches.length > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup
                      heading={
                        <div className="flex items-center justify-between">
                          <span>최근 검색어</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto py-0 px-1 text-xs text-muted-foreground"
                            onClick={(e) => {
                              e.preventDefault();
                              clearHistory();
                            }}
                          >
                            전체 삭제
                          </Button>
                        </div>
                      }
                    >
                      {recentSearches.map((item, index) => (
                        <CommandItem
                          key={`recent-${item.text}-${index}`}
                          value={item.text}
                          onSelect={() => handleSelect(item)}
                          className="flex items-center justify-between cursor-pointer group"
                        >
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            <span>{item.text}</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 opacity-0 group-hover:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeFromHistory(item.text);
                            }}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}

                {/* 키보드 힌트 */}
                <div className="px-2 py-1.5 text-xs text-muted-foreground border-t flex items-center gap-4">
                  <span>
                    <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">Enter</kbd>{" "}
                    검색
                  </span>
                  <span>
                    <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">Esc</kbd>{" "}
                    닫기
                  </span>
                </div>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    );
  }
);

SearchInputWithSuggestions.displayName = "SearchInputWithSuggestions";

export default SearchInputWithSuggestions;

```

---

## frontend/src/components/SentimentChart.tsx

```tsx
import { Card } from "@/components/ui/card";
import type { SentimentData } from "@/types/api";

interface SentimentChartProps {
  data: SentimentData;
}

export function SentimentChart({ data }: SentimentChartProps) {
  const total = data.pos + data.neg + data.neu;
  const posPercent = total > 0 ? ((data.pos / total) * 100).toFixed(1) : "0";
  const negPercent = total > 0 ? ((data.neg / total) * 100).toFixed(1) : "0";
  const neuPercent = total > 0 ? ((data.neu / total) * 100).toFixed(1) : "0";

  return (
    <Card className="p-6 shadow-elegant card-hover">
      <h2 className="text-xl font-bold mb-6">감성 분석</h2>
      
      {/* Bar Chart */}
      <div className="space-y-6 mb-8">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">긍정</span>
            <span className="text-muted-foreground">{data.pos}건 ({posPercent}%)</span>
          </div>
          <div className="h-8 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-success transition-all duration-500"
              style={{ width: `${posPercent}%` }}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">부정</span>
            <span className="text-muted-foreground">{data.neg}건 ({negPercent}%)</span>
          </div>
          <div className="h-8 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-destructive transition-all duration-500"
              style={{ width: `${negPercent}%` }}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">중립</span>
            <span className="text-muted-foreground">{data.neu}건 ({neuPercent}%)</span>
          </div>
          <div className="h-8 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-muted-foreground transition-all duration-500"
              style={{ width: `${neuPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 pt-6 border-t">
        <div className="text-center">
          <div className="text-2xl font-bold text-success">{data.pos}</div>
          <div className="text-xs text-muted-foreground mt-1">긍정 ({posPercent}%)</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-destructive">{data.neg}</div>
          <div className="text-xs text-muted-foreground mt-1">부정 ({negPercent}%)</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-muted-foreground">{data.neu}</div>
          <div className="text-xs text-muted-foreground mt-1">중립 ({neuPercent}%)</div>
        </div>
      </div>
    </Card>
  );
}

```

---

## frontend/src/components/TaskTemplates.tsx

```tsx
import { useState, useCallback, useMemo } from "react";
import {
  Bookmark,
  BookmarkPlus,
  Trash2,
  Play,
  Edit,
  X,
  Search,
  Globe,
  FileText,
  Database,
  ShoppingCart,
  Newspaper,
  BarChart3,
  Loader2,
  ChevronDown,
  ChevronUp,
  Star,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  task: string;
  url?: string;
  maxSteps?: number;
  category: TaskCategory;
  icon?: string;
  isBuiltIn?: boolean;
  createdAt: string;
  usageCount?: number;
}

export type TaskCategory = 
  | "news"
  | "research"
  | "ecommerce"
  | "data"
  | "social"
  | "custom";

const CATEGORY_CONFIG: Record<TaskCategory, { label: string; icon: typeof Newspaper; color: string }> = {
  news: { label: "뉴스", icon: Newspaper, color: "text-blue-600" },
  research: { label: "연구", icon: Search, color: "text-purple-600" },
  ecommerce: { label: "쇼핑", icon: ShoppingCart, color: "text-green-600" },
  data: { label: "데이터", icon: BarChart3, color: "text-orange-600" },
  social: { label: "소셜", icon: Globe, color: "text-pink-600" },
  custom: { label: "사용자 정의", icon: FileText, color: "text-gray-600" },
};

/** 기본 제공 템플릿 */
const BUILT_IN_TEMPLATES: TaskTemplate[] = [
  {
    id: "builtin-1",
    name: "뉴스 헤드라인 수집",
    description: "뉴스 사이트에서 최신 헤드라인을 수집합니다",
    task: "Go to the news website and extract the top 10 headlines with their titles, summaries, and URLs. Format the output as a numbered list.",
    url: "",
    maxSteps: 15,
    category: "news",
    isBuiltIn: true,
    createdAt: "2024-01-01",
    usageCount: 0,
  },
  {
    id: "builtin-2",
    name: "Hacker News 인기글",
    description: "Hacker News 프론트페이지 인기글 추출",
    task: "Go to news.ycombinator.com and extract the top 10 stories with their titles, points, comment counts, and URLs.",
    url: "https://news.ycombinator.com",
    maxSteps: 10,
    category: "news",
    isBuiltIn: true,
    createdAt: "2024-01-01",
    usageCount: 0,
  },
  {
    id: "builtin-3",
    name: "Wikipedia 정보 추출",
    description: "Wikipedia에서 특정 주제 정보 수집",
    task: "Search Wikipedia for the given topic and extract the main summary, key facts, and related topics.",
    url: "https://wikipedia.org",
    maxSteps: 15,
    category: "research",
    isBuiltIn: true,
    createdAt: "2024-01-01",
    usageCount: 0,
  },
  {
    id: "builtin-4",
    name: "상품 정보 수집",
    description: "이커머스 사이트에서 상품 정보 추출",
    task: "Find product information including name, price, ratings, and reviews from the given product page or search results.",
    url: "",
    maxSteps: 20,
    category: "ecommerce",
    isBuiltIn: true,
    createdAt: "2024-01-01",
    usageCount: 0,
  },
  {
    id: "builtin-5",
    name: "트렌드 데이터 수집",
    description: "트렌드/통계 데이터 추출",
    task: "Extract trending topics, statistics, or data points from the given page. Format as structured data with dates and values.",
    url: "",
    maxSteps: 20,
    category: "data",
    isBuiltIn: true,
    createdAt: "2024-01-01",
    usageCount: 0,
  },
];

const STORAGE_KEY = "newsinsight-task-templates";

interface TaskTemplatesProps {
  /** 템플릿 선택 시 콜백 */
  onSelectTemplate: (template: TaskTemplate) => void;
  /** 현재 작업이 실행 중인지 */
  disabled?: boolean;
  /** 추가 CSS 클래스 */
  className?: string;
}

/** 로컬 스토리지에서 템플릿 로드 */
const loadTemplates = (): TaskTemplate[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const userTemplates = JSON.parse(stored) as TaskTemplate[];
      return [...BUILT_IN_TEMPLATES, ...userTemplates];
    }
  } catch (e) {
    console.error("Failed to load templates:", e);
  }
  return BUILT_IN_TEMPLATES;
};

/** 사용자 템플릿만 저장 */
const saveTemplates = (templates: TaskTemplate[]) => {
  const userTemplates = templates.filter((t) => !t.isBuiltIn);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(userTemplates));
};

export function TaskTemplates({
  onSelectTemplate,
  disabled = false,
  className,
}: TaskTemplatesProps) {
  const [templates, setTemplates] = useState<TaskTemplate[]>(loadTemplates);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<TaskCategory | "all">("all");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TaskTemplate | null>(null);

  // 새 템플릿 기본값
  const [newTemplate, setNewTemplate] = useState<Partial<TaskTemplate>>({
    name: "",
    description: "",
    task: "",
    url: "",
    maxSteps: 25,
    category: "custom",
  });

  // 필터링된 템플릿
  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => {
      const matchesSearch =
        !searchQuery ||
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.task.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesCategory =
        selectedCategory === "all" || t.category === selectedCategory;
      
      return matchesSearch && matchesCategory;
    });
  }, [templates, searchQuery, selectedCategory]);

  // 카테고리별 그룹화
  const groupedTemplates = useMemo(() => {
    const groups: Record<string, TaskTemplate[]> = {};
    filteredTemplates.forEach((t) => {
      const key = t.isBuiltIn ? "기본 제공" : "내 템플릿";
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });
    return groups;
  }, [filteredTemplates]);

  // 템플릿 선택
  const handleSelect = useCallback((template: TaskTemplate) => {
    // 사용 횟수 증가
    setTemplates((prev) => {
      const updated = prev.map((t) =>
        t.id === template.id
          ? { ...t, usageCount: (t.usageCount || 0) + 1 }
          : t
      );
      saveTemplates(updated);
      return updated;
    });
    
    onSelectTemplate(template);
    setIsOpen(false);
  }, [onSelectTemplate]);

  // 템플릿 저장
  const handleSave = useCallback(() => {
    if (!newTemplate.name?.trim() || !newTemplate.task?.trim()) return;

    const template: TaskTemplate = {
      id: editingTemplate?.id || `user-${Date.now()}`,
      name: newTemplate.name.trim(),
      description: newTemplate.description?.trim() || "",
      task: newTemplate.task.trim(),
      url: newTemplate.url?.trim() || undefined,
      maxSteps: newTemplate.maxSteps || 25,
      category: newTemplate.category as TaskCategory || "custom",
      isBuiltIn: false,
      createdAt: editingTemplate?.createdAt || new Date().toISOString(),
      usageCount: editingTemplate?.usageCount || 0,
    };

    setTemplates((prev) => {
      let updated: TaskTemplate[];
      if (editingTemplate) {
        updated = prev.map((t) => (t.id === template.id ? template : t));
      } else {
        updated = [...prev, template];
      }
      saveTemplates(updated);
      return updated;
    });

    setEditDialogOpen(false);
    setEditingTemplate(null);
    setNewTemplate({
      name: "",
      description: "",
      task: "",
      url: "",
      maxSteps: 25,
      category: "custom",
    });
  }, [newTemplate, editingTemplate]);

  // 템플릿 삭제
  const handleDelete = useCallback((id: string) => {
    setTemplates((prev) => {
      const updated = prev.filter((t) => t.id !== id);
      saveTemplates(updated);
      return updated;
    });
  }, []);

  // 편집 모드 시작
  const startEdit = useCallback((template: TaskTemplate) => {
    setEditingTemplate(template);
    setNewTemplate({
      name: template.name,
      description: template.description,
      task: template.task,
      url: template.url,
      maxSteps: template.maxSteps,
      category: template.category,
    });
    setEditDialogOpen(true);
  }, []);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className={className}>
      <CollapsibleTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between"
          disabled={disabled}
        >
          <div className="flex items-center gap-2">
            <Bookmark className="h-4 w-4" />
            <span>작업 템플릿</span>
            <Badge variant="secondary" className="ml-1">
              {templates.length}
            </Badge>
          </div>
          {isOpen ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-3 space-y-3">
        {/* 검색 및 필터 */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="템플릿 검색..."
              className="pl-9"
            />
          </div>
          <Select
            value={selectedCategory}
            onValueChange={(v) => setSelectedCategory(v as TaskCategory | "all")}
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              {Object.entries(CATEGORY_CONFIG).map(([key, config]) => (
                <SelectItem key={key} value={key}>
                  {config.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          {/* 새 템플릿 추가 */}
          <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  setEditingTemplate(null);
                  setNewTemplate({
                    name: "",
                    description: "",
                    task: "",
                    url: "",
                    maxSteps: 25,
                    category: "custom",
                  });
                }}
              >
                <BookmarkPlus className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>
                  {editingTemplate ? "템플릿 수정" : "새 템플릿 만들기"}
                </DialogTitle>
                <DialogDescription>
                  자주 사용하는 작업을 템플릿으로 저장하여 빠르게 재사용하세요.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">템플릿 이름 *</Label>
                  <Input
                    id="name"
                    value={newTemplate.name}
                    onChange={(e) =>
                      setNewTemplate((p) => ({ ...p, name: e.target.value }))
                    }
                    placeholder="예: 뉴스 헤드라인 수집"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">설명</Label>
                  <Input
                    id="description"
                    value={newTemplate.description}
                    onChange={(e) =>
                      setNewTemplate((p) => ({ ...p, description: e.target.value }))
                    }
                    placeholder="템플릿에 대한 간단한 설명"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="task">작업 내용 *</Label>
                  <Textarea
                    id="task"
                    value={newTemplate.task}
                    onChange={(e) =>
                      setNewTemplate((p) => ({ ...p, task: e.target.value }))
                    }
                    placeholder="AI 에이전트가 수행할 작업을 자세히 설명하세요"
                    rows={4}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="url">시작 URL</Label>
                    <Input
                      id="url"
                      value={newTemplate.url}
                      onChange={(e) =>
                        setNewTemplate((p) => ({ ...p, url: e.target.value }))
                      }
                      placeholder="https://..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maxSteps">최대 단계</Label>
                    <Input
                      id="maxSteps"
                      type="number"
                      value={newTemplate.maxSteps}
                      onChange={(e) =>
                        setNewTemplate((p) => ({
                          ...p,
                          maxSteps: parseInt(e.target.value) || 25,
                        }))
                      }
                      min={1}
                      max={100}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>카테고리</Label>
                  <Select
                    value={newTemplate.category}
                    onValueChange={(v) =>
                      setNewTemplate((p) => ({ ...p, category: v as TaskCategory }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CATEGORY_CONFIG).map(([key, config]) => {
                        const Icon = config.icon;
                        return (
                          <SelectItem key={key} value={key}>
                            <div className="flex items-center gap-2">
                              <Icon className={cn("h-4 w-4", config.color)} />
                              {config.label}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                  취소
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={!newTemplate.name?.trim() || !newTemplate.task?.trim()}
                >
                  {editingTemplate ? "수정" : "저장"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* 템플릿 목록 */}
        <ScrollArea className="h-[300px] pr-2">
          {filteredTemplates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Bookmark className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>검색 결과가 없습니다</p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedTemplates).map(([group, items]) => (
                <div key={group}>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">
                    {group}
                  </h4>
                  <div className="space-y-2">
                    {items.map((template) => {
                      const categoryConfig = CATEGORY_CONFIG[template.category];
                      const Icon = categoryConfig.icon;
                      
                      return (
                        <div
                          key={template.id}
                          className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                        >
                          <div className={cn("p-2 rounded-lg bg-muted", categoryConfig.color)}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h5 className="font-medium text-sm truncate">
                                {template.name}
                              </h5>
                              {template.isBuiltIn && (
                                <Badge variant="secondary" className="text-xs shrink-0">
                                  기본
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                              {template.description || template.task}
                            </p>
                            {template.url && (
                              <p className="text-xs text-blue-600 truncate mt-0.5">
                                {template.url}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {/* 사용하기 */}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleSelect(template)}
                              title="이 템플릿 사용"
                            >
                              <Play className="h-4 w-4" />
                            </Button>
                            
                            {/* 편집 (사용자 템플릿만) */}
                            {!template.isBuiltIn && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => startEdit(template)}
                                title="수정"
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                            )}
                            
                            {/* 삭제 (사용자 템플릿만) */}
                            {!template.isBuiltIn && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => handleDelete(template.id)}
                                title="삭제"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default TaskTemplates;

```

---

## frontend/src/components/ThemeToggle.tsx

```tsx
import { Moon, Sun, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  /** 버튼 변형 */
  variant?: "icon" | "dropdown" | "switch";
  /** 크기 */
  size?: "sm" | "default" | "lg";
  /** 추가 CSS 클래스 */
  className?: string;
}

/** 아이콘만 있는 간단한 토글 버튼 */
const IconToggle = ({ size = "default", className }: Pick<ThemeToggleProps, "size" | "className">) => {
  const { resolvedTheme, toggleTheme, theme } = useTheme();

  const iconSize = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-6 w-6" : "h-5 w-5";
  const buttonSize = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-12 w-12" : "h-10 w-10";

  const getTooltipText = () => {
    if (theme === "light") return "다크 모드로 전환";
    if (theme === "dark") return "시스템 설정 사용";
    return "라이트 모드로 전환";
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className={cn(buttonSize, "relative", className)}
          aria-label="테마 전환"
        >
          {theme === "system" ? (
            <Monitor className={cn(iconSize, "text-muted-foreground")} />
          ) : resolvedTheme === "dark" ? (
            <Moon className={cn(iconSize, "text-blue-400")} />
          ) : (
            <Sun className={cn(iconSize, "text-yellow-500")} />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{getTooltipText()}</p>
      </TooltipContent>
    </Tooltip>
  );
};

/** 드롭다운 메뉴 형태의 테마 선택 */
const DropdownToggle = ({ size = "default", className }: Pick<ThemeToggleProps, "size" | "className">) => {
  const { theme, setTheme, resolvedTheme } = useTheme();

  const iconSize = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-6 w-6" : "h-5 w-5";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={className}>
          {theme === "system" ? (
            <Monitor className={cn(iconSize, "text-muted-foreground")} />
          ) : resolvedTheme === "dark" ? (
            <Moon className={cn(iconSize, "text-blue-400")} />
          ) : (
            <Sun className={cn(iconSize, "text-yellow-500")} />
          )}
          <span className="sr-only">테마 선택</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => setTheme("light")}
          className={cn(theme === "light" && "bg-accent")}
        >
          <Sun className="h-4 w-4 mr-2 text-yellow-500" />
          라이트
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setTheme("dark")}
          className={cn(theme === "dark" && "bg-accent")}
        >
          <Moon className="h-4 w-4 mr-2 text-blue-400" />
          다크
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setTheme("system")}
          className={cn(theme === "system" && "bg-accent")}
        >
          <Monitor className="h-4 w-4 mr-2" />
          시스템
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** 스위치 형태의 토글 (라이트/다크만) */
const SwitchToggle = ({ className }: Pick<ThemeToggleProps, "className">) => {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const handleToggle = () => {
    setTheme(isDark ? "light" : "dark");
  };

  return (
    <button
      role="switch"
      aria-checked={isDark}
      onClick={handleToggle}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        isDark ? "bg-blue-600" : "bg-yellow-400",
        className
      )}
    >
      <span className="sr-only">다크 모드 {isDark ? "끄기" : "켜기"}</span>
      <span
        className={cn(
          "pointer-events-none inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white shadow-lg ring-0 transition-transform",
          isDark ? "translate-x-5" : "translate-x-0.5"
        )}
      >
        {isDark ? (
          <Moon className="h-3 w-3 text-blue-600" />
        ) : (
          <Sun className="h-3 w-3 text-yellow-500" />
        )}
      </span>
    </button>
  );
};

/** 메인 ThemeToggle 컴포넌트 */
export const ThemeToggle = ({ variant = "icon", size = "default", className }: ThemeToggleProps) => {
  switch (variant) {
    case "dropdown":
      return <DropdownToggle size={size} className={className} />;
    case "switch":
      return <SwitchToggle className={className} />;
    case "icon":
    default:
      return <IconToggle size={size} className={className} />;
  }
};

export default ThemeToggle;

```

---

## frontend/src/components/UnifiedExportMenu.tsx

```tsx
/**
 * UnifiedExportMenu - 통합 내보내기 메뉴
 * 
 * PDF 보고서, AI 분석 내보내기, 데이터 내보내기를 하나의 드롭다운으로 통합
 */

import { useState, useCallback } from 'react';
import {
  Download,
  FileText,
  FileJson,
  FileSpreadsheet,
  FileCode,
  FileType2,
  Copy,
  Check,
  ChevronDown,
  Loader2,
  Settings2,
  Clock,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  exportUnifiedSearchReport,
  exportDeepSearchReport,
  requestUnifiedSearchReport,
  getReportStatus,
  downloadReport,
  triggerPdfDownload,
  type ReportRequest,
  type ReportSection,
  type ReportType,
  type ReportMetadata,
  DEFAULT_REPORT_SECTIONS,
} from '@/lib/api';
import { useExport, type ExportFormat, type ExportableSearchResult, type ExportOptions } from '@/hooks/useExport';
import type { ChartExportHandle } from '@/components/charts';

// ============================================
// Types
// ============================================

interface UnifiedExportMenuProps {
  /** Job ID for PDF report generation */
  jobId?: string;
  /** Search query */
  query: string;
  /** Report type */
  reportType?: ReportType;
  /** Time window */
  timeWindow?: string;
  /** AI analysis content (markdown) for analysis export */
  aiContent?: string;
  /** Structured data for JSON/CSV export */
  data?: ExportableSearchResult[];
  /** Chart refs for capturing chart images */
  chartRefs?: Record<string, React.RefObject<ChartExportHandle>>;
  /** Export options */
  exportOptions?: ExportOptions;
  /** Button variant */
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  /** Button size */
  size?: 'default' | 'sm' | 'lg' | 'icon';
  /** Additional CSS classes */
  className?: string;
  /** Disable the button */
  disabled?: boolean;
  /** Show icon only */
  iconOnly?: boolean;
}

interface SectionOption {
  id: ReportSection;
  label: string;
  description: string;
}

// ============================================
// Constants
// ============================================

const ALL_SECTIONS: SectionOption[] = [
  { id: 'COVER', label: '표지', description: '보고서 표지 및 기본 정보' },
  { id: 'EXECUTIVE_SUMMARY', label: '요약', description: 'AI 분석 요약 및 핵심 인사이트' },
  { id: 'DATA_SOURCE', label: '데이터 소스', description: '검색 소스별 결과 분포' },
  { id: 'TREND_ANALYSIS', label: '트렌드 분석', description: '시간대별 기사 추이' },
  { id: 'KEYWORD_ANALYSIS', label: '키워드 분석', description: '주요 키워드 및 빈도' },
  { id: 'SENTIMENT_ANALYSIS', label: '감정 분석', description: '긍정/부정/중립 분포' },
  { id: 'RELIABILITY', label: '신뢰도 분석', description: '출처별 신뢰도 평가' },
  { id: 'BIAS_ANALYSIS', label: '편향성 분석', description: '정치적/이념적 편향 분석' },
  { id: 'FACTCHECK', label: '팩트체크', description: '주요 주장 검증 결과' },
  { id: 'EVIDENCE_LIST', label: '증거 목록', description: '수집된 증거 및 출처' },
  { id: 'DETAILED_RESULTS', label: '상세 결과', description: '개별 기사 상세 정보' },
];

// ============================================
// Utility Functions
// ============================================

/**
 * Generate HTML report from markdown content
 */
const generateHtmlReport = (content: string, query: string): string => {
  const timestamp = new Date().toLocaleString('ko-KR');
  
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NewsInsight AI 분석 - ${query}</title>
  <style>
    :root {
      --primary: #7c3aed;
      --primary-light: #a78bfa;
      --bg: #ffffff;
      --text: #1f2937;
      --text-muted: #6b7280;
      --border: #e5e7eb;
    }
    
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #111827;
        --text: #f9fafb;
        --text-muted: #9ca3af;
        --border: #374151;
      }
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans KR', sans-serif;
      line-height: 1.7;
      color: var(--text);
      background: var(--bg);
      max-width: 900px;
      margin: 0 auto;
      padding: 2rem;
    }
    
    header {
      text-align: center;
      padding-bottom: 2rem;
      margin-bottom: 2rem;
      border-bottom: 2px solid var(--primary);
    }
    
    header h1 {
      color: var(--primary);
      font-size: 1.5rem;
      margin-bottom: 0.5rem;
    }
    
    header .query {
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
    
    header .meta {
      color: var(--text-muted);
      font-size: 0.875rem;
    }
    
    h2, h3 {
      margin: 1.5rem 0 1rem;
      border-left: 4px solid var(--primary);
      padding-left: 1rem;
    }
    
    h2 { font-size: 1.25rem; }
    h3 { font-size: 1rem; }
    
    p { margin: 0.75rem 0; }
    
    ul, ol { padding-left: 1.5rem; margin: 0.75rem 0; }
    li { margin: 0.5rem 0; }
    
    strong { font-weight: 600; }
    
    a { color: var(--primary); text-decoration: none; }
    a:hover { text-decoration: underline; }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1rem 0;
      font-size: 0.9rem;
    }
    
    th, td {
      padding: 0.75rem 1rem;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    
    th { background: var(--border); font-weight: 600; }
    
    blockquote {
      margin: 1rem 0;
      padding: 0.75rem 1rem;
      border-left: 4px solid var(--primary-light);
      background: rgba(124, 58, 237, 0.05);
      font-style: italic;
    }
    
    code {
      background: var(--border);
      padding: 0.125rem 0.375rem;
      border-radius: 0.25rem;
      font-size: 0.875em;
    }
    
    hr {
      border: none;
      border-top: 2px dashed var(--border);
      margin: 2rem 0;
    }
    
    footer {
      margin-top: 3rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--border);
      text-align: center;
      color: var(--text-muted);
      font-size: 0.875rem;
    }
    
    @media print {
      body { padding: 1rem; }
      h2 { break-after: avoid; }
      table { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <header>
    <h1>NewsInsight AI 분석 보고서</h1>
    <div class="query">"${query}"</div>
    <div class="meta">생성 시간: ${timestamp}</div>
  </header>
  
  <main>
    ${markdownToHtml(content)}
  </main>
  
  <footer>
    <p>이 보고서는 NewsInsight AI에 의해 자동 생성되었습니다.</p>
    <p>모든 정보는 참고용이며, 최종 판단은 사용자의 몫입니다.</p>
  </footer>
</body>
</html>`;
};

/**
 * Simple markdown to HTML conversion
 */
const markdownToHtml = (md: string): string => {
  return md
    .replace(/^### \[([^\]]+)\] (.+)$/gm, '<h3>$1: $2</h3>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## \[([^\]]+)\] (.+)$/gm, '<h2>$1: $2</h2>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/gs, '<ul>$&</ul>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^---$/gm, '<hr>')
    .replace(/^(?!<[a-z])(.*[^\n])$/gm, '<p>$1</p>')
    .replace(/<p>\s*<\/p>/g, '');
};

/**
 * Download file utility
 */
const downloadFile = (content: string, filename: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// ============================================
// Component
// ============================================

/**
 * Unified Export Menu Component
 * 
 * Combines PDF report, AI analysis export, and data export into a single dropdown.
 */
export function UnifiedExportMenu({
  jobId,
  query,
  reportType = 'UNIFIED_SEARCH',
  timeWindow = '7d',
  aiContent,
  data,
  chartRefs,
  exportOptions = {},
  variant = 'outline',
  size = 'default',
  className,
  disabled = false,
  iconOnly = false,
}: UnifiedExportMenuProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [selectedSections, setSelectedSections] = useState<ReportSection[]>(
    DEFAULT_REPORT_SECTIONS[reportType]
  );
  
  // Async export state
  const [asyncExportMode, setAsyncExportMode] = useState(false);
  const [asyncReportStatus, setAsyncReportStatus] = useState<ReportMetadata | null>(null);
  const [asyncProgressDialogOpen, setAsyncProgressDialogOpen] = useState(false);
  
  const { exportData, copyToClipboard } = useExport();
  
  // Generate base filename
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const safeQuery = query.replace(/[^가-힣a-zA-Z0-9]/g, '_').slice(0, 30);
  const typeLabel = reportType === 'DEEP_SEARCH' ? 'DeepSearch' : '통합검색';
  const baseFilename = `NewsInsight_${typeLabel}_${safeQuery}_${timestamp}`;

  // Capture chart images for PDF
  const captureChartImages = useCallback((): Record<string, string> => {
    const images: Record<string, string> = {};
    if (chartRefs) {
      for (const [key, ref] of Object.entries(chartRefs)) {
        if (ref.current) {
          const base64 = ref.current.toBase64();
          if (base64) {
            images[key] = base64;
          }
        }
      }
    }
    return images;
  }, [chartRefs]);

  // PDF Export with dialog
  const handlePdfExport = async () => {
    if (!jobId) {
      toast.error('PDF 내보내기는 검색 작업 ID가 필요합니다.');
      return;
    }
    
    setIsExporting(true);
    try {
      const chartImages = captureChartImages();
      
      const request: ReportRequest = {
        reportType,
        targetId: jobId,
        query,
        timeWindow,
        includeSections: selectedSections,
        chartImages,
        language: 'ko',
      };

      let blob: Blob;
      if (reportType === 'DEEP_SEARCH') {
        blob = await exportDeepSearchReport(jobId, request);
      } else {
        blob = await exportUnifiedSearchReport(jobId, request);
      }

      triggerPdfDownload(blob, `${baseFilename}.pdf`);
      toast.success('PDF 보고서가 다운로드되었습니다.');
      setPdfDialogOpen(false);
    } catch (error) {
      console.error('PDF export failed:', error);
      toast.error('PDF 보고서 생성에 실패했습니다.');
    } finally {
      setIsExporting(false);
    }
  };

  // Async PDF Export with polling (for large reports)
  const handleAsyncPdfExport = async () => {
    if (!jobId) {
      toast.error('PDF 내보내기는 검색 작업 ID가 필요합니다.');
      return;
    }
    
    setIsExporting(true);
    setAsyncProgressDialogOpen(true);
    setPdfDialogOpen(false);
    
    try {
      const chartImages = captureChartImages();
      
      const request: ReportRequest = {
        reportType,
        targetId: jobId,
        query,
        timeWindow,
        includeSections: selectedSections,
        chartImages,
        language: 'ko',
      };

      // Request async report generation
      const initialStatus = await requestUnifiedSearchReport(jobId, request);
      setAsyncReportStatus(initialStatus);
      
      if (initialStatus.status === 'COMPLETED' && initialStatus.reportId) {
        // Report was cached or generated immediately
        const blob = await downloadReport(initialStatus.reportId);
        triggerPdfDownload(blob, `${baseFilename}.pdf`);
        toast.success('PDF 보고서가 다운로드되었습니다.');
        setAsyncProgressDialogOpen(false);
        setAsyncReportStatus(null);
        return;
      }
      
      // Poll for completion
      const reportId = initialStatus.reportId;
      const maxWaitMs = 120000; // 2 minutes
      const pollIntervalMs = 2000; // 2 seconds
      const startTime = Date.now();
      
      while (Date.now() - startTime < maxWaitMs) {
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        
        const status = await getReportStatus(reportId);
        setAsyncReportStatus(status);
        
        if (status.status === 'COMPLETED') {
          const blob = await downloadReport(reportId);
          triggerPdfDownload(blob, `${baseFilename}.pdf`);
          toast.success('PDF 보고서가 다운로드되었습니다.');
          setAsyncProgressDialogOpen(false);
          setAsyncReportStatus(null);
          return;
        }
        
        if (status.status === 'FAILED' || status.status === 'EXPIRED') {
          throw new Error(status.errorMessage || '보고서 생성에 실패했습니다.');
        }
      }
      
      throw new Error('보고서 생성 시간이 초과되었습니다.');
    } catch (error) {
      console.error('Async PDF export failed:', error);
      toast.error(error instanceof Error ? error.message : 'PDF 보고서 생성에 실패했습니다.');
      setAsyncReportStatus(null);
    } finally {
      setIsExporting(false);
    }
  };

  // Cancel/close async progress dialog
  const handleCancelAsyncExport = () => {
    setAsyncProgressDialogOpen(false);
    setAsyncReportStatus(null);
    setIsExporting(false);
  };

  // AI Content exports
  const handleMarkdownExport = useCallback(() => {
    if (!aiContent) {
      toast.error('내보낼 AI 분석 내용이 없습니다.');
      return;
    }
    
    const mdContent = `# NewsInsight AI 분석 보고서

**검색어**: ${query}  
**생성 시간**: ${new Date().toLocaleString('ko-KR')}

---

${aiContent}

---

*이 보고서는 NewsInsight AI에 의해 자동 생성되었습니다.*
`;
    downloadFile(mdContent, `${baseFilename}_AI분석.md`, 'text/markdown;charset=utf-8');
    toast.success('Markdown 파일이 다운로드되었습니다.');
  }, [aiContent, query, baseFilename]);

  const handleHtmlExport = useCallback(() => {
    if (!aiContent) {
      toast.error('내보낼 AI 분석 내용이 없습니다.');
      return;
    }
    
    const htmlContent = generateHtmlReport(aiContent, query);
    downloadFile(htmlContent, `${baseFilename}_AI분석.html`, 'text/html;charset=utf-8');
    toast.success('HTML 파일이 다운로드되었습니다.');
  }, [aiContent, query, baseFilename]);

  const handleTextExport = useCallback(() => {
    if (!aiContent) {
      toast.error('내보낼 AI 분석 내용이 없습니다.');
      return;
    }
    
    const plainText = aiContent
      .replace(/#{1,6}\s/g, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\|/g, ' | ');
    
    const textContent = `NewsInsight AI 분석 보고서
========================================

검색어: ${query}
생성 시간: ${new Date().toLocaleString('ko-KR')}

========================================

${plainText}

========================================

이 보고서는 NewsInsight AI에 의해 자동 생성되었습니다.
`;
    downloadFile(textContent, `${baseFilename}_AI분석.txt`, 'text/plain;charset=utf-8');
    toast.success('텍스트 파일이 다운로드되었습니다.');
  }, [aiContent, query, baseFilename]);

  // Data exports (JSON/CSV)
  const handleDataExport = (format: ExportFormat) => {
    if (!data || data.length === 0) {
      toast.error('내보낼 데이터가 없습니다.');
      return;
    }
    exportData(data, format, { ...exportOptions, filename: baseFilename });
  };

  // Clipboard
  const handleCopy = async (type: 'ai' | 'data') => {
    try {
      if (type === 'ai' && aiContent) {
        await navigator.clipboard.writeText(aiContent);
      } else if (type === 'data' && data) {
        await copyToClipboard(data, 'json');
      } else {
        toast.error('복사할 내용이 없습니다.');
        return;
      }
      setCopied(true);
      toast.success('클립보드에 복사되었습니다.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('복사에 실패했습니다.');
    }
  };

  // Section selection for PDF
  const toggleSection = (sectionId: ReportSection) => {
    setSelectedSections((prev) =>
      prev.includes(sectionId)
        ? prev.filter((s) => s !== sectionId)
        : [...prev, sectionId]
    );
  };

  const selectAllSections = () => {
    setSelectedSections(ALL_SECTIONS.map((s) => s.id));
  };

  const selectDefaultSections = () => {
    setSelectedSections(DEFAULT_REPORT_SECTIONS[reportType]);
  };

  const availableSections = ALL_SECTIONS.filter((section) => {
    if (reportType === 'UNIFIED_SEARCH') {
      return section.id !== 'EVIDENCE_LIST';
    }
    if (reportType === 'DEEP_SEARCH') {
      return section.id !== 'TREND_ANALYSIS' && section.id !== 'KEYWORD_ANALYSIS';
    }
    return true;
  });

  const hasAnyContent = jobId || aiContent || (data && data.length > 0);
  const isDisabled = disabled || !hasAnyContent;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={size}
            disabled={isDisabled || isExporting}
            className={className}
            aria-label="내보내기"
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {!iconOnly && (
              <>
                <span className="ml-2">내보내기</span>
                <ChevronDown className="ml-1 h-3 w-3" />
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {/* PDF Report Section */}
          {jobId && (
            <>
              <DropdownMenuLabel className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-red-600" />
                PDF 보고서
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setPdfDialogOpen(true)}>
                <Settings2 className="h-4 w-4 mr-2" />
                PDF 보고서 생성...
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          {/* AI Analysis Export Section */}
          {aiContent && (
            <>
              <DropdownMenuLabel className="flex items-center gap-2">
                <FileCode className="h-4 w-4 text-purple-600" />
                AI 분석 내보내기
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={handleMarkdownExport}>
                <FileCode className="h-4 w-4 mr-2 text-blue-600" />
                Markdown (.md)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleHtmlExport}>
                <FileType2 className="h-4 w-4 mr-2 text-orange-600" />
                HTML 웹페이지
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleTextExport}>
                <FileText className="h-4 w-4 mr-2 text-gray-600" />
                텍스트 (.txt)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleCopy('ai')}>
                {copied ? (
                  <Check className="h-4 w-4 mr-2 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4 mr-2" />
                )}
                AI 분석 복사
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          {/* Data Export Section */}
          {data && data.length > 0 && (
            <>
              <DropdownMenuLabel className="flex items-center gap-2">
                <FileJson className="h-4 w-4 text-yellow-600" />
                데이터 내보내기
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => handleDataExport('json')}>
                <FileJson className="h-4 w-4 mr-2 text-yellow-600" />
                JSON으로 내보내기
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDataExport('csv')}>
                <FileSpreadsheet className="h-4 w-4 mr-2 text-green-600" />
                CSV로 내보내기
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDataExport('markdown')}>
                <FileCode className="h-4 w-4 mr-2 text-blue-600" />
                Markdown 테이블
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleCopy('data')}>
                {copied ? (
                  <Check className="h-4 w-4 mr-2 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4 mr-2" />
                )}
                데이터 복사 (JSON)
              </DropdownMenuItem>
            </>
          )}

          {/* Fallback if nothing is available */}
          {!hasAnyContent && (
            <DropdownMenuItem disabled>
              내보낼 내용이 없습니다
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* PDF Section Selection Dialog */}
      <Dialog open={pdfDialogOpen} onOpenChange={setPdfDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>PDF 보고서 내보내기</DialogTitle>
            <DialogDescription>
              보고서에 포함할 섹션을 선택하세요.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {/* Quick actions */}
            <div className="flex gap-2 mb-4">
              <Button variant="outline" size="sm" onClick={selectAllSections}>
                전체 선택
              </Button>
              <Button variant="outline" size="sm" onClick={selectDefaultSections}>
                기본값
              </Button>
            </div>

            {/* Section selection */}
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
              {availableSections.map((section) => (
                <div
                  key={section.id}
                  className="flex items-start space-x-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <Checkbox
                    id={section.id}
                    checked={selectedSections.includes(section.id)}
                    onCheckedChange={() => toggleSection(section.id)}
                  />
                  <div className="flex-1">
                    <Label
                      htmlFor={section.id}
                      className="text-sm font-medium cursor-pointer"
                    >
                      {section.label}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {section.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Summary */}
            <div className="mt-4 pt-4 border-t text-sm text-muted-foreground">
              {selectedSections.length}개 섹션 선택됨
            </div>

            {/* Async mode toggle */}
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-start space-x-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                <Checkbox
                  id="async-mode"
                  checked={asyncExportMode}
                  onCheckedChange={(checked) => setAsyncExportMode(!!checked)}
                />
                <div className="flex-1">
                  <Label htmlFor="async-mode" className="text-sm font-medium cursor-pointer flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    백그라운드 생성
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    대용량 보고서의 경우 백그라운드에서 생성하고 완료 시 다운로드합니다.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPdfDialogOpen(false)}>
              취소
            </Button>
            <Button
              onClick={asyncExportMode ? handleAsyncPdfExport : handlePdfExport}
              disabled={isExporting || selectedSections.length === 0}
            >
              {isExporting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  생성 중...
                </>
              ) : asyncExportMode ? (
                <>
                  <Clock className="h-4 w-4 mr-2" />
                  백그라운드 생성
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4 mr-2" />
                  내보내기
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Async Export Progress Dialog */}
      <Dialog open={asyncProgressDialogOpen} onOpenChange={(open) => !open && handleCancelAsyncExport()}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {asyncReportStatus?.status === 'COMPLETED' ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : asyncReportStatus?.status === 'FAILED' ? (
                <XCircle className="h-5 w-5 text-red-500" />
              ) : (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              )}
              PDF 보고서 생성 중
            </DialogTitle>
            <DialogDescription>
              보고서를 생성하고 있습니다. 완료되면 자동으로 다운로드됩니다.
            </DialogDescription>
          </DialogHeader>

          <div className="py-6">
            {/* Status display */}
            <div className="flex flex-col items-center gap-4">
              {asyncReportStatus?.status === 'GENERATING' && (
                <>
                  <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                    <div 
                      className="h-full bg-primary rounded-full animate-pulse"
                      style={{ width: '60%' }}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">보고서 생성 중...</p>
                </>
              )}
              
              {asyncReportStatus?.status === 'PENDING' && (
                <>
                  <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                    <div 
                      className="h-full bg-primary/50 rounded-full animate-pulse"
                      style={{ width: '30%' }}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">대기 중...</p>
                </>
              )}
              
              {asyncReportStatus?.status === 'COMPLETED' && (
                <p className="text-sm text-green-600">생성 완료! 다운로드 중...</p>
              )}
              
              {asyncReportStatus?.status === 'FAILED' && (
                <p className="text-sm text-red-600">
                  {asyncReportStatus.errorMessage || '보고서 생성에 실패했습니다.'}
                </p>
              )}
              
              {!asyncReportStatus && (
                <>
                  <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                    <div 
                      className="h-full bg-primary/30 rounded-full animate-pulse"
                      style={{ width: '10%' }}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">요청 중...</p>
                </>
              )}
            </div>

            {/* Report info */}
            {asyncReportStatus && (
              <div className="mt-4 pt-4 border-t text-xs text-muted-foreground space-y-1">
                <p>보고서 ID: {asyncReportStatus.reportId}</p>
                {asyncReportStatus.pageCount && (
                  <p>페이지 수: {asyncReportStatus.pageCount}</p>
                )}
                {asyncReportStatus.generationTimeMs && (
                  <p>생성 시간: {(asyncReportStatus.generationTimeMs / 1000).toFixed(1)}초</p>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCancelAsyncExport}>
              {asyncReportStatus?.status === 'FAILED' ? '닫기' : '취소'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default UnifiedExportMenu;

```

---

## frontend/src/components/UrlClaimExtractor.tsx

```tsx
import { useState, useCallback } from "react";
import {
  Link as LinkIcon,
  Loader2,
  AlertCircle,
  X,
  Sparkles,
  FileText,
  Globe,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { extractClaimsFromUrl } from "@/lib/api";

interface ExtractedClaim {
  id: string;
  text: string;
  confidence: number;
  context?: string;
  selected: boolean;
}

interface UrlClaimExtractorProps {
  /** URL 추출 후 선택된 주장들을 전달하는 콜백 */
  onClaimsExtracted: (claims: string[]) => void;
  /** 현재 분석 중인지 여부 */
  disabled?: boolean;
  /** 추가 CSS 클래스 */
  className?: string;
}

/** URL 유효성 검사 */
const isValidUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

/** 신뢰도에 따른 색상 */
const getConfidenceColor = (confidence: number): string => {
  if (confidence >= 0.8) return "text-green-600";
  if (confidence >= 0.5) return "text-yellow-600";
  return "text-orange-600";
};

export function UrlClaimExtractor({
  onClaimsExtracted,
  disabled = false,
  className,
}: UrlClaimExtractorProps) {
  const [url, setUrl] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedClaims, setExtractedClaims] = useState<ExtractedClaim[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pageTitle, setPageTitle] = useState<string | null>(null);

  // URL에서 주장 추출 - 실제 백엔드 API 호출
  const extractClaims = useCallback(async () => {
    if (!url.trim() || !isValidUrl(url)) {
      setError("올바른 URL을 입력해주세요.");
      return;
    }

    setIsExtracting(true);
    setError(null);
    setExtractedClaims([]);
    setPageTitle(null);

    try {
      // 실제 백엔드 API 호출
      const response = await extractClaimsFromUrl({ 
        url: url.trim(),
        maxClaims: 10,
        minConfidence: 0.5
      });
      
      if (response.message && response.claims.length === 0) {
        setError(response.message);
        return;
      }

      if (response.claims && Array.isArray(response.claims)) {
        setExtractedClaims(
          response.claims.map((claim) => ({
            id: claim.id,
            text: claim.text,
            confidence: claim.confidence || 0.7,
            context: claim.context,
            selected: true, // 기본적으로 모두 선택
          }))
        );
        setPageTitle(response.pageTitle || null);
      } else {
        setError("주장을 추출할 수 없습니다.");
      }
    } catch (err) {
      console.error("Claim extraction failed:", err);
      const errorMessage = err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.";
      setError(`주장 추출 실패: ${errorMessage}`);
    } finally {
      setIsExtracting(false);
    }
  }, [url]);

  // 주장 선택 토글
  const toggleClaim = useCallback((id: string) => {
    setExtractedClaims((prev) =>
      prev.map((claim) =>
        claim.id === id ? { ...claim, selected: !claim.selected } : claim
      )
    );
  }, []);

  // 모두 선택/해제
  const toggleAll = useCallback((selected: boolean) => {
    setExtractedClaims((prev) =>
      prev.map((claim) => ({ ...claim, selected }))
    );
  }, []);

  // 선택된 주장 적용
  const applyClaims = useCallback(() => {
    const selectedClaims = extractedClaims
      .filter((c) => c.selected)
      .map((c) => c.text);
    
    if (selectedClaims.length === 0) {
      setError("최소 1개 이상의 주장을 선택해주세요.");
      return;
    }

    onClaimsExtracted(selectedClaims);
    
    // 초기화
    setUrl("");
    setExtractedClaims([]);
    setPageTitle(null);
  }, [extractedClaims, onClaimsExtracted]);

  // 취소/초기화
  const handleReset = useCallback(() => {
    setUrl("");
    setExtractedClaims([]);
    setError(null);
    setPageTitle(null);
  }, []);

  const selectedCount = extractedClaims.filter((c) => c.selected).length;
  const hasResults = extractedClaims.length > 0;

  return (
    <Card className={cn("border-dashed border-2 border-muted-foreground/25", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-blue-600" />
          <CardTitle className="text-lg">URL에서 주장 추출</CardTitle>
          <Badge variant="secondary" className="text-xs">AI 자동 추출</Badge>
        </div>
        <CardDescription>
          뉴스 기사나 웹페이지 URL을 입력하면 AI가 자동으로 검증할 수 있는 주장들을 추출합니다.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* URL 입력 */}
        {!hasResults && (
          <div className="flex gap-2">
            <div className="relative flex-1">
              <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError(null);
                }}
                placeholder="https://news.example.com/article/..."
                disabled={disabled || isExtracting}
                className="pl-10"
              />
            </div>
            <Button
              onClick={extractClaims}
              disabled={disabled || isExtracting || !url.trim()}
            >
              {isExtracting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  추출 중...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  추출
                </>
              )}
            </Button>
          </div>
        )}

        {/* 에러 메시지 */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* 추출 중 상태 */}
        {isExtracting && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <div className="text-center space-y-3">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
              <div>
                <p className="font-medium">URL 분석 중...</p>
                <p className="text-sm">페이지에서 검증 가능한 주장을 찾고 있습니다.</p>
              </div>
            </div>
          </div>
        )}

        {/* 추출 결과 */}
        {hasResults && !isExtracting && (
          <div className="space-y-4">
            {/* 페이지 정보 */}
            {pageTitle && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium truncate">{pageTitle}</span>
                <Badge variant="outline" className="ml-auto shrink-0">
                  {extractedClaims.length}개 주장 발견
                </Badge>
              </div>
            )}

            {/* 선택 컨트롤 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleAll(true)}
                  disabled={selectedCount === extractedClaims.length}
                >
                  모두 선택
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleAll(false)}
                  disabled={selectedCount === 0}
                >
                  모두 해제
                </Button>
              </div>
              <span className="text-sm text-muted-foreground">
                {selectedCount}개 선택됨
              </span>
            </div>

            {/* 주장 목록 */}
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
              {extractedClaims.map((claim) => (
                <div
                  key={claim.id}
                  className={cn(
                    "p-3 rounded-lg border transition-colors cursor-pointer",
                    claim.selected
                      ? "border-primary bg-primary/5"
                      : "border-muted hover:border-muted-foreground/50"
                  )}
                  onClick={() => toggleClaim(claim.id)}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={claim.selected}
                      onCheckedChange={() => toggleClaim(claim.id)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">{claim.text}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={cn("text-xs", getConfidenceColor(claim.confidence))}>
                          신뢰도: {Math.round(claim.confidence * 100)}%
                        </span>
                        {claim.context && (
                          <span className="text-xs text-muted-foreground">
                            • {claim.context}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* 액션 버튼 */}
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={handleReset}
                className="flex-1"
              >
                <X className="h-4 w-4 mr-2" />
                취소
              </Button>
              <Button
                onClick={applyClaims}
                disabled={selectedCount === 0}
                className="flex-1"
              >
                <ArrowRight className="h-4 w-4 mr-2" />
                {selectedCount}개 주장 적용
              </Button>
            </div>
          </div>
        )}

        {/* 빈 상태 안내 */}
        {!hasResults && !isExtracting && !error && (
          <p className="text-xs text-muted-foreground text-center py-2">
            URL을 입력하고 "추출" 버튼을 클릭하세요. AI가 자동으로 사실 확인이 필요한 주장들을 찾아냅니다.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default UrlClaimExtractor;

```

---

## frontend/src/components/UrlTree.tsx

```tsx
import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  Folder,
  FolderOpen,
  File,
  Link,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  Trash2,
  Edit,
  FolderPlus,
  Plus,
  Check,
  X,
  GripVertical,
  ExternalLink,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { TreeItem, FolderItem, UrlItem, SelectedItems } from '@/hooks/useUrlCollection';

// ============================================
// Drag & Drop Context
// ============================================

interface DragState {
  draggedItemId: string | null;
  draggedItemType: 'folder' | 'url' | null;
  dropTargetId: string | null;
  dropPosition: 'before' | 'inside' | 'after' | null;
}

// ============================================
// Tree Item Component
// ============================================

interface TreeNodeProps {
  item: TreeItem;
  depth: number;
  selectedItems: SelectedItems;
  onToggleFolder: (id: string) => void;
  onToggleSelection: (id: string, type: 'folder' | 'url') => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<UrlItem | FolderItem>) => void;
  onAddFolder: (parentId: string) => void;
  onAddUrl: (parentId: string) => void;
  onSelectAll: (folderId: string) => void;
  onMoveItem?: (itemId: string, targetFolderId: string) => void;
  dragState: DragState;
  onDragStart: (id: string, type: 'folder' | 'url') => void;
  onDragEnd: () => void;
  onDragOver: (id: string, position: 'before' | 'inside' | 'after') => void;
  onDrop: (targetId: string) => void;
}

const TreeNode: React.FC<TreeNodeProps> = ({
  item,
  depth,
  selectedItems,
  onToggleFolder,
  onToggleSelection,
  onDelete,
  onUpdate,
  onAddFolder,
  onAddUrl,
  onSelectAll,
  onMoveItem,
  dragState,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(item.name);
  const nodeRef = useRef<HTMLDivElement>(null);

  const isSelected = item.type === 'folder' 
    ? selectedItems.folders.has(item.id)
    : selectedItems.urls.has(item.id);

  const isDragging = dragState.draggedItemId === item.id;
  const isDropTarget = dragState.dropTargetId === item.id;
  const dropPosition = isDropTarget ? dragState.dropPosition : null;

  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
    onDragStart(item.id, item.type);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    e.preventDefault();
    onDragEnd();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (dragState.draggedItemId === item.id) return;
    
    // Don't allow dropping a folder into itself or its children
    if (dragState.draggedItemType === 'folder' && item.type === 'folder') {
      // This is a simplified check - a full check would verify ancestry
    }

    const rect = nodeRef.current?.getBoundingClientRect();
    if (!rect) return;

    const y = e.clientY - rect.top;
    const height = rect.height;

    // For folders, allow dropping inside
    if (item.type === 'folder') {
      if (y < height * 0.25) {
        onDragOver(item.id, 'before');
      } else if (y > height * 0.75) {
        onDragOver(item.id, 'after');
      } else {
        onDragOver(item.id, 'inside');
      }
    } else {
      // For URLs, only allow before/after
      if (y < height * 0.5) {
        onDragOver(item.id, 'before');
      } else {
        onDragOver(item.id, 'after');
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDrop(item.id);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleSaveEdit = () => {
    if (editName.trim()) {
      onUpdate(item.id, { name: editName.trim() });
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditName(item.name);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  if (item.type === 'folder') {
    const folder = item as FolderItem;
    return (
      <div>
        <div
          ref={nodeRef}
          draggable={!isEditing}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragLeave={handleDragLeave}
          className={cn(
            'group flex items-center gap-1 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors',
            isSelected && 'bg-primary/10 hover:bg-primary/20',
            isDragging && 'opacity-50 bg-muted',
            isDropTarget && dropPosition === 'inside' && 'ring-2 ring-primary ring-inset bg-primary/5',
            isDropTarget && dropPosition === 'before' && 'border-t-2 border-primary',
            isDropTarget && dropPosition === 'after' && 'border-b-2 border-primary'
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {/* Drag Handle */}
          <GripVertical className="h-4 w-4 text-muted-foreground/50 shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity" />

          {/* Expand/Collapse */}
          <button
            onClick={() => onToggleFolder(folder.id)}
            className="p-0.5 hover:bg-muted rounded"
          >
            {folder.isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>

          {/* Checkbox */}
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelection(folder.id, 'folder')}
            className="mr-1"
          />

          {/* Icon */}
          {folder.isExpanded ? (
            <FolderOpen className="h-4 w-4 text-yellow-600 shrink-0" />
          ) : (
            <Folder className="h-4 w-4 text-yellow-600 shrink-0" />
          )}

          {/* Name */}
          {isEditing ? (
            <div className="flex items-center gap-1 flex-1">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-6 text-sm py-0"
                autoFocus
              />
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleSaveEdit}>
                <Check className="h-3 w-3" />
              </Button>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleCancelEdit}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <span
              className="flex-1 text-sm font-medium truncate"
              onDoubleClick={() => setIsEditing(true)}
            >
              {folder.name}
            </span>
          )}

          {/* Item count */}
          <Badge variant="secondary" className="text-xs h-5 px-1.5">
            {folder.children.length}
          </Badge>

          {/* Actions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onAddFolder(folder.id)}>
                <FolderPlus className="h-4 w-4 mr-2" />
                하위 폴더 추가
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAddUrl(folder.id)}>
                <Plus className="h-4 w-4 mr-2" />
                URL 추가
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSelectAll(folder.id)}>
                <Check className="h-4 w-4 mr-2" />
                전체 선택
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setIsEditing(true)}>
                <Edit className="h-4 w-4 mr-2" />
                이름 변경
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDelete(folder.id)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Children */}
        {folder.isExpanded && (
          <div>
            {folder.children.map((child) => (
              <TreeNode
                key={child.id}
                item={child}
                depth={depth + 1}
                selectedItems={selectedItems}
                onToggleFolder={onToggleFolder}
                onToggleSelection={onToggleSelection}
                onDelete={onDelete}
                onUpdate={onUpdate}
                onAddFolder={onAddFolder}
                onAddUrl={onAddUrl}
                onSelectAll={onSelectAll}
                onMoveItem={onMoveItem}
                dragState={dragState}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragOver={onDragOver}
                onDrop={onDrop}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // URL item
  const url = item as UrlItem;
  return (
    <div
      ref={nodeRef}
      draggable={!isEditing}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragLeave={handleDragLeave}
      className={cn(
        'group flex items-center gap-1 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors',
        isSelected && 'bg-primary/10 hover:bg-primary/20',
        isDragging && 'opacity-50 bg-muted',
        isDropTarget && dropPosition === 'before' && 'border-t-2 border-primary',
        isDropTarget && dropPosition === 'after' && 'border-b-2 border-primary'
      )}
      style={{ paddingLeft: `${depth * 16 + 28}px` }}
    >
      {/* Drag Handle */}
      <GripVertical className="h-4 w-4 text-muted-foreground/50 shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity" />

      {/* Checkbox */}
      <Checkbox
        checked={isSelected}
        onCheckedChange={() => onToggleSelection(url.id, 'url')}
        className="mr-1"
      />

      {/* Icon */}
      <Link className="h-4 w-4 text-blue-600 shrink-0" />

      {/* Name & URL */}
      {isEditing ? (
        <div className="flex items-center gap-1 flex-1">
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-6 text-sm py-0"
            autoFocus
          />
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleSaveEdit}>
            <Check className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleCancelEdit}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="flex-1 text-sm truncate"
              onDoubleClick={() => setIsEditing(true)}
            >
              {url.name}
            </span>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-xs">
            <p className="text-xs break-all">{url.url}</p>
            {url.description && (
              <p className="text-xs text-muted-foreground mt-1">{url.description}</p>
            )}
          </TooltipContent>
        </Tooltip>
      )}

      {/* Tags */}
      {url.tags && url.tags.length > 0 && (
        <div className="hidden sm:flex gap-1">
          {url.tags.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs h-5 px-1">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Last analyzed indicator */}
      {url.lastAnalyzedAt && (
        <Tooltip>
          <TooltipTrigger>
            <Clock className="h-3 w-3 text-green-600" />
          </TooltipTrigger>
          <TooltipContent>
            마지막 분석: {new Date(url.lastAnalyzedAt).toLocaleString('ko-KR')}
          </TooltipContent>
        </Tooltip>
      )}

      {/* External link */}
      <a
        href={url.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
      </a>

      {/* Actions */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setIsEditing(true)}>
            <Edit className="h-4 w-4 mr-2" />
            이름 변경
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              navigator.clipboard.writeText(url.url);
            }}
          >
            <Link className="h-4 w-4 mr-2" />
            URL 복사
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => onDelete(url.id)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            삭제
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

// ============================================
// URL Tree Component
// ============================================

interface UrlTreeProps {
  root: FolderItem;
  selectedItems: SelectedItems;
  onToggleFolder: (id: string) => void;
  onToggleSelection: (id: string, type: 'folder' | 'url') => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<UrlItem | FolderItem>) => void;
  onAddFolder: (parentId: string) => void;
  onAddUrl: (parentId: string) => void;
  onSelectAll: (folderId: string) => void;
  onMoveItem?: (itemId: string, targetFolderId: string) => void;
}

export const UrlTree: React.FC<UrlTreeProps> = ({
  root,
  selectedItems,
  onToggleFolder,
  onToggleSelection,
  onDelete,
  onUpdate,
  onAddFolder,
  onAddUrl,
  onSelectAll,
  onMoveItem,
}) => {
  // Drag & Drop state management
  const [dragState, setDragState] = useState<DragState>({
    draggedItemId: null,
    draggedItemType: null,
    dropTargetId: null,
    dropPosition: null,
  });

  const handleDragStart = useCallback((id: string, type: 'folder' | 'url') => {
    setDragState({
      draggedItemId: id,
      draggedItemType: type,
      dropTargetId: null,
      dropPosition: null,
    });
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragState({
      draggedItemId: null,
      draggedItemType: null,
      dropTargetId: null,
      dropPosition: null,
    });
  }, []);

  const handleDragOver = useCallback((id: string, position: 'before' | 'inside' | 'after') => {
    setDragState(prev => ({
      ...prev,
      dropTargetId: id,
      dropPosition: position,
    }));
  }, []);

  // Find parent folder of an item
  const findParentFolder = useCallback((itemId: string, items: (UrlItem | FolderItem)[], parentId: string = 'root'): string | null => {
    for (const item of items) {
      if (item.id === itemId) {
        return parentId;
      }
      if (item.type === 'folder') {
        const found = findParentFolder(itemId, item.children, item.id);
        if (found) return found;
      }
    }
    return null;
  }, []);

  const handleDrop = useCallback((targetId: string) => {
    if (!dragState.draggedItemId || !onMoveItem) {
      handleDragEnd();
      return;
    }

    const { draggedItemId, dropPosition } = dragState;

    // Prevent dropping an item onto itself
    if (draggedItemId === targetId) {
      handleDragEnd();
      return;
    }

    // Find the target item to determine its parent
    const findItem = (items: (UrlItem | FolderItem)[]): (UrlItem | FolderItem) | null => {
      for (const item of items) {
        if (item.id === targetId) return item;
        if (item.type === 'folder') {
          const found = findItem(item.children);
          if (found) return found;
        }
      }
      return null;
    };

    const targetItem = findItem(root.children);

    if (targetItem) {
      if (dropPosition === 'inside' && targetItem.type === 'folder') {
        // Drop inside folder
        onMoveItem(draggedItemId, targetId);
      } else {
        // Drop before/after - move to parent folder
        const parentId = findParentFolder(targetId, root.children);
        if (parentId) {
          onMoveItem(draggedItemId, parentId);
        }
      }
    }

    handleDragEnd();
  }, [dragState, onMoveItem, handleDragEnd, root.children, findParentFolder]);

  if (root.children.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Folder className="h-12 w-12 mx-auto mb-3 opacity-50" />
        <p className="text-sm">URL이 없습니다</p>
        <p className="text-xs mt-1">폴더나 URL을 추가하세요</p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {root.children.map((item) => (
        <TreeNode
          key={item.id}
          item={item}
          depth={0}
          selectedItems={selectedItems}
          onToggleFolder={onToggleFolder}
          onToggleSelection={onToggleSelection}
          onDelete={onDelete}
          onUpdate={onUpdate}
          onAddFolder={onAddFolder}
          onAddUrl={onAddUrl}
          onSelectAll={onSelectAll}
          onMoveItem={onMoveItem}
          dragState={dragState}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        />
      ))}
    </div>
  );
};

export default UrlTree;

```

---

## frontend/src/components/VirtualList.tsx

```tsx
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";

interface VirtualListProps<T> {
  /** 렌더링할 아이템 배열 */
  items: T[];
  /** 각 아이템의 예상 높이 (픽셀) */
  itemHeight: number;
  /** 컨테이너 높이 (픽셀 또는 CSS 값) */
  containerHeight: number | string;
  /** 오버스캔 - 화면 밖에 추가로 렌더링할 아이템 수 */
  overscan?: number;
  /** 아이템 렌더 함수 */
  renderItem: (item: T, index: number, style: React.CSSProperties) => React.ReactNode;
  /** 아이템 키 추출 함수 */
  getItemKey: (item: T, index: number) => string | number;
  /** 추가 CSS 클래스 */
  className?: string;
  /** 빈 상태 렌더링 */
  emptyState?: React.ReactNode;
  /** 로딩 상태 */
  loading?: boolean;
  /** 로딩 상태 렌더링 */
  loadingState?: React.ReactNode;
}

/**
 * 가상화된 리스트 컴포넌트
 * 대량의 데이터를 효율적으로 렌더링
 * 
 * @example
 * ``\`tsx
 * <VirtualList
 *   items={searchResults}
 *   itemHeight={80}
 *   containerHeight={600}
 *   getItemKey={(item) => item.id}
 *   renderItem={(item, index, style) => (
 *     <div style={style}>
 *       <SearchResultCard result={item} />
 *     </div>
 *   )}
 * />
 * ``\`
 */
export function VirtualList<T>({
  items,
  itemHeight,
  containerHeight,
  overscan = 3,
  renderItem,
  getItemKey,
  className,
  emptyState,
  loading,
  loadingState,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  // 컨테이너 높이를 픽셀로 계산
  const [containerHeightPx, setContainerHeightPx] = useState(
    typeof containerHeight === "number" ? containerHeight : 400
  );

  // 컨테이너 크기 관찰
  useEffect(() => {
    if (typeof containerHeight === "number") {
      setContainerHeightPx(containerHeight);
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeightPx(entry.contentRect.height);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [containerHeight]);

  // 스크롤 핸들러
  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  // 가상화 계산
  const virtualData = useMemo(() => {
    const totalHeight = items.length * itemHeight;
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
      items.length - 1,
      Math.floor((scrollTop + containerHeightPx) / itemHeight) + overscan
    );

    const visibleItems = items.slice(startIndex, endIndex + 1).map((item, i) => ({
      item,
      index: startIndex + i,
      style: {
        position: "absolute" as const,
        top: (startIndex + i) * itemHeight,
        left: 0,
        right: 0,
        height: itemHeight,
      },
    }));

    return {
      totalHeight,
      startIndex,
      endIndex,
      visibleItems,
    };
  }, [items, itemHeight, containerHeightPx, scrollTop, overscan]);

  // 빈 상태 또는 로딩 상태
  if (loading) {
    return (
      <div
        className={cn("flex items-center justify-center", className)}
        style={{ height: containerHeight }}
      >
        {loadingState || <div className="text-muted-foreground">로딩 중...</div>}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        className={cn("flex items-center justify-center", className)}
        style={{ height: containerHeight }}
      >
        {emptyState || <div className="text-muted-foreground">데이터가 없습니다</div>}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn("overflow-auto relative", className)}
      style={{ height: containerHeight }}
      onScroll={handleScroll}
    >
      <div
        style={{
          height: virtualData.totalHeight,
          position: "relative",
        }}
      >
        {virtualData.visibleItems.map(({ item, index, style }) => (
          <div key={getItemKey(item, index)} style={style}>
            {renderItem(item, index, style)}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 무한 스크롤 훅
 * 
 * @example
 * ``\`tsx
 * const { loadMoreRef, isLoading } = useInfiniteScroll({
 *   hasMore: data?.hasNextPage,
 *   onLoadMore: () => fetchNextPage(),
 * });
 * 
 * return (
 *   <div>
 *     {items.map(item => <Item key={item.id} />)}
 *     <div ref={loadMoreRef}>
 *       {isLoading && <Spinner />}
 *     </div>
 *   </div>
 * );
 * ``\`
 */
export function useInfiniteScroll(options: {
  hasMore: boolean;
  onLoadMore: () => void;
  threshold?: number;
  rootMargin?: string;
}) {
  const { hasMore, onLoadMore, threshold = 0.1, rootMargin = "100px" } = options;
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const element = loadMoreRef.current;
    if (!element || !hasMore) return;

    const observer = new IntersectionObserver(
      async (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting && hasMore && !isLoading) {
          setIsLoading(true);
          try {
            await onLoadMore();
          } finally {
            setIsLoading(false);
          }
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, threshold, rootMargin, isLoading]);

  return { loadMoreRef, isLoading };
}

/**
 * 지연 로딩 이미지 컴포넌트
 * 
 * @example
 * ``\`tsx
 * <LazyImage
 *   src="/image.jpg"
 *   alt="Description"
 *   className="w-full h-48 object-cover"
 * />
 * ``\`
 */
interface LazyImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** 로딩 중 표시할 플레이스홀더 */
  placeholder?: React.ReactNode;
  /** 에러 시 표시할 콘텐츠 */
  fallback?: React.ReactNode;
}

export function LazyImage({
  src,
  alt,
  className,
  placeholder,
  fallback,
  ...props
}: LazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          // 실제 src 설정
          img.src = src || "";
          observer.disconnect();
        }
      },
      { rootMargin: "100px" }
    );

    observer.observe(img);
    return () => observer.disconnect();
  }, [src]);

  if (hasError && fallback) {
    return <>{fallback}</>;
  }

  return (
    <div className={cn("relative", className)}>
      {!isLoaded && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted animate-pulse">
          {placeholder || <div className="w-8 h-8 rounded-full bg-muted-foreground/20" />}
        </div>
      )}
      <img
        ref={imgRef}
        alt={alt}
        className={cn(
          "transition-opacity duration-300",
          isLoaded ? "opacity-100" : "opacity-0",
          className
        )}
        onLoad={() => setIsLoaded(true)}
        onError={() => setHasError(true)}
        {...props}
      />
    </div>
  );
}

/**
 * 디바운스 훅
 * 
 * @example
 * ``\`tsx
 * const debouncedSearch = useDebouncedCallback((query: string) => {
 *   search(query);
 * }, 300);
 * ``\`
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const debouncedCallback = useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callback(...args);
      }, delay);
    },
    [callback, delay]
  ) as T;

  // 클린업
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debouncedCallback;
}

/**
 * 쓰로틀 훅
 * 
 * @example
 * ``\`tsx
 * const throttledScroll = useThrottledCallback((event) => {
 *   handleScroll(event);
 * }, 100);
 * ``\`
 */
export function useThrottledCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const lastCall = useRef(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const throttledCallback = useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();
      const timeSinceLastCall = now - lastCall.current;

      if (timeSinceLastCall >= delay) {
        lastCall.current = now;
        callback(...args);
      } else {
        // 마지막 호출 예약
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
          lastCall.current = Date.now();
          callback(...args);
        }, delay - timeSinceLastCall);
      }
    },
    [callback, delay]
  ) as T;

  // 클린업
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return throttledCallback;
}

export default VirtualList;

```

---

## frontend/src/components/admin/CrawlerLogsViewer.tsx

```tsx
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

```

---

## frontend/src/components/admin/JobStatusBadge.tsx

```tsx
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  XCircle,
} from 'lucide-react';
import type { CollectionJobStatus } from '@/lib/api/collection';

interface JobStatusBadgeProps {
  status: CollectionJobStatus;
  /** 추가 텍스트 */
  label?: string;
  /** 사이즈 */
  size?: 'sm' | 'default';
  /** 클래스명 */
  className?: string;
}

const statusConfig: Record<CollectionJobStatus, {
  icon: React.ReactNode;
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  className: string;
}> = {
  PENDING: {
    icon: <Clock className="h-3 w-3" />,
    label: '대기 중',
    variant: 'secondary',
    className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300 border-yellow-200',
  },
  RUNNING: {
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    label: '수집 중',
    variant: 'default',
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 border-blue-200',
  },
  COMPLETED: {
    icon: <CheckCircle2 className="h-3 w-3" />,
    label: '완료',
    variant: 'secondary',
    className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 border-green-200',
  },
  FAILED: {
    icon: <AlertCircle className="h-3 w-3" />,
    label: '실패',
    variant: 'destructive',
    className: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 border-red-200',
  },
  CANCELLED: {
    icon: <XCircle className="h-3 w-3" />,
    label: '취소됨',
    variant: 'outline',
    className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-gray-200',
  },
};

/**
 * 수집 작업 상태 배지 컴포넌트
 */
export function JobStatusBadge({
  status,
  label,
  size = 'default',
  className,
}: JobStatusBadgeProps) {
  const config = statusConfig[status];
  
  return (
    <Badge
      variant={config.variant}
      className={cn(
        'flex items-center gap-1',
        config.className,
        size === 'sm' && 'text-xs px-1.5 py-0',
        className
      )}
    >
      {config.icon}
      {label || config.label}
    </Badge>
  );
}

export default JobStatusBadge;

```

---

## frontend/src/components/admin/LiveCounter.tsx

```tsx
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface LiveCounterProps {
  /** 현재 값 */
  value: number;
  /** 이전 값 (변화량 계산용) */
  previousValue?: number;
  /** 라벨 */
  label: string;
  /** 아이콘 */
  icon?: React.ReactNode;
  /** 서브 텍스트 */
  subtitle?: string;
  /** 변화량 표시 여부 */
  showChange?: boolean;
  /** 로딩 상태 */
  isLoading?: boolean;
  /** 숫자 포맷 함수 */
  formatValue?: (value: number) => string;
  /** 클래스명 */
  className?: string;
}

/**
 * 실시간 카운터 컴포넌트
 * 값이 변경될 때 롤링 애니메이션 효과 적용
 */
export function LiveCounter({
  value,
  previousValue,
  label,
  icon,
  subtitle,
  showChange = true,
  isLoading = false,
  formatValue = (v) => v.toLocaleString(),
  className,
}: LiveCounterProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevValueRef = useRef(value);

  // 값 변경 시 롤링 애니메이션
  useEffect(() => {
    if (value === prevValueRef.current) return;

    setIsAnimating(true);
    const startValue = prevValueRef.current;
    const endValue = value;
    const duration = 500; // ms
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // easeOutQuad
      const eased = 1 - (1 - progress) * (1 - progress);
      const current = Math.round(startValue + (endValue - startValue) * eased);
      
      setDisplayValue(current);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setIsAnimating(false);
        prevValueRef.current = value;
      }
    };

    requestAnimationFrame(animate);
  }, [value]);

  const change = previousValue !== undefined ? value - previousValue : 0;
  const changePercent = previousValue && previousValue !== 0
    ? ((value - previousValue) / previousValue * 100).toFixed(1)
    : null;

  return (
    <div className={cn(
      'rounded-xl border bg-card p-6 shadow-sm transition-all duration-300',
      isAnimating && 'ring-2 ring-primary/20',
      className
    )}>
      <div className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="tracking-tight text-sm font-medium text-muted-foreground">
          {label}
        </div>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </div>
      
      <div className="flex items-baseline gap-2">
        {isLoading ? (
          <div className="h-8 w-24 animate-pulse rounded bg-muted" />
        ) : (
          <div className={cn(
            'text-2xl font-bold transition-colors duration-300',
            isAnimating && 'text-primary'
          )}>
            {formatValue(displayValue)}
          </div>
        )}
        
        {showChange && change !== 0 && !isLoading && (
          <div className={cn(
            'flex items-center text-xs font-medium',
            change > 0 ? 'text-green-600' : 'text-red-600'
          )}>
            {change > 0 ? (
              <TrendingUp className="h-3 w-3 mr-0.5" />
            ) : (
              <TrendingDown className="h-3 w-3 mr-0.5" />
            )}
            {change > 0 ? '+' : ''}{change.toLocaleString()}
            {changePercent && ` (${changePercent}%)`}
          </div>
        )}
        
        {showChange && change === 0 && previousValue !== undefined && !isLoading && (
          <div className="flex items-center text-xs font-medium text-muted-foreground">
            <Minus className="h-3 w-3 mr-0.5" />
            변화 없음
          </div>
        )}
      </div>
      
      {subtitle && (
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      )}
    </div>
  );
}

export default LiveCounter;

```

---

## frontend/src/components/admin/LiveStream.tsx

```tsx
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

```

---

## frontend/src/components/admin/SourceCard.tsx

```tsx
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

```

---

## frontend/src/components/charts/KeywordBarChart.tsx

```tsx
import { useRef, forwardRef, useImperativeHandle } from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from 'chart.js';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

export interface KeywordBarChartProps {
  keywords: Array<{ keyword: string; count: number }>;
  title?: string;
  maxItems?: number;
  horizontal?: boolean;
  className?: string;
}

export interface ChartExportHandle {
  toBase64: () => string | null;
}

export const KeywordBarChart = forwardRef<ChartExportHandle, KeywordBarChartProps>(
  ({ keywords, title = '주요 키워드', maxItems = 10, horizontal = true, className }, ref) => {
    const chartRef = useRef<ChartJS<'bar'>>(null);

    useImperativeHandle(ref, () => ({
      toBase64: () => {
        if (chartRef.current) {
          return chartRef.current.toBase64Image();
        }
        return null;
      },
    }));

    // Sort and limit keywords
    const sortedKeywords = [...keywords]
      .sort((a, b) => b.count - a.count)
      .slice(0, maxItems);

    const data = {
      labels: sortedKeywords.map((k) => k.keyword),
      datasets: [
        {
          label: '언급 횟수',
          data: sortedKeywords.map((k) => k.count),
          backgroundColor: 'rgba(59, 130, 246, 0.7)',
          borderColor: 'rgba(59, 130, 246, 1)',
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    };

    const options: ChartOptions<'bar'> = {
      responsive: true,
      maintainAspectRatio: true,
      indexAxis: horizontal ? 'y' : 'x',
      plugins: {
        legend: {
          display: false,
        },
        title: {
          display: !!title,
          text: title,
          font: {
            size: 16,
            weight: 'bold',
          },
          padding: {
            bottom: 20,
          },
        },
        tooltip: {
          callbacks: {
            label: (context) => `${context.parsed.x || context.parsed.y}건`,
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: {
            display: !horizontal,
          },
          ticks: {
            precision: 0,
          },
        },
        y: {
          grid: {
            display: horizontal,
          },
          ticks: {
            font: {
              size: 11,
            },
          },
        },
      },
    };

    return (
      <div className={className}>
        <Bar ref={chartRef} data={data} options={options} />
      </div>
    );
  }
);

KeywordBarChart.displayName = 'KeywordBarChart';

```

---

## frontend/src/components/charts/ReliabilityGauge.tsx

```tsx
import { useRef, forwardRef, useImperativeHandle } from 'react';
import { Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from 'chart.js';

// Register Chart.js components
ChartJS.register(ArcElement, Tooltip, Legend);

export interface ReliabilityGaugeProps {
  score: number;  // 0-100
  title?: string;
  showLabel?: boolean;
  className?: string;
}

export interface ChartExportHandle {
  toBase64: () => string | null;
}

const getGradeInfo = (score: number) => {
  if (score >= 80) return { label: '높음', color: 'rgba(34, 197, 94, 0.8)', borderColor: 'rgba(34, 197, 94, 1)' };
  if (score >= 50) return { label: '중간', color: 'rgba(234, 179, 8, 0.8)', borderColor: 'rgba(234, 179, 8, 1)' };
  return { label: '낮음', color: 'rgba(239, 68, 68, 0.8)', borderColor: 'rgba(239, 68, 68, 1)' };
};

export const ReliabilityGauge = forwardRef<ChartExportHandle, ReliabilityGaugeProps>(
  ({ score, title = '신뢰도', showLabel = true, className }, ref) => {
    const chartRef = useRef<ChartJS<'doughnut'>>(null);

    useImperativeHandle(ref, () => ({
      toBase64: () => {
        if (chartRef.current) {
          return chartRef.current.toBase64Image();
        }
        return null;
      },
    }));

    const gradeInfo = getGradeInfo(score);
    const remaining = 100 - score;

    const data = {
      labels: ['신뢰도', ''],
      datasets: [
        {
          data: [score, remaining],
          backgroundColor: [gradeInfo.color, 'rgba(229, 231, 235, 0.5)'],
          borderColor: [gradeInfo.borderColor, 'rgba(229, 231, 235, 0.8)'],
          borderWidth: 2,
          circumference: 270,
          rotation: 225,
        },
      ],
    };

    const options: ChartOptions<'doughnut'> = {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '70%',
      plugins: {
        legend: {
          display: false,
        },
        title: {
          display: !!title,
          text: title,
          font: {
            size: 16,
            weight: 'bold',
          },
          padding: {
            bottom: 10,
          },
        },
        tooltip: {
          enabled: false,
        },
      },
    };

    return (
      <div className={`relative ${className}`}>
        <Doughnut ref={chartRef} data={data} options={options} />
        {showLabel && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="text-3xl font-bold" style={{ color: gradeInfo.borderColor }}>
              {score}
            </div>
            <div className="text-sm text-muted-foreground">{gradeInfo.label}</div>
          </div>
        )}
      </div>
    );
  }
);

ReliabilityGauge.displayName = 'ReliabilityGauge';

```

---

## frontend/src/components/charts/SentimentPieChart.tsx

```tsx
import { useRef, forwardRef, useImperativeHandle } from 'react';
import { Pie } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from 'chart.js';

// Register Chart.js components
ChartJS.register(ArcElement, Tooltip, Legend);

export interface SentimentPieChartProps {
  positive: number;
  negative: number;
  neutral: number;
  title?: string;
  showLegend?: boolean;
  className?: string;
}

export interface ChartExportHandle {
  toBase64: () => string | null;
}

export const SentimentPieChart = forwardRef<ChartExportHandle, SentimentPieChartProps>(
  ({ positive, negative, neutral, title = '감성 분포', showLegend = true, className }, ref) => {
    const chartRef = useRef<ChartJS<'pie'>>(null);

    useImperativeHandle(ref, () => ({
      toBase64: () => {
        if (chartRef.current) {
          return chartRef.current.toBase64Image();
        }
        return null;
      },
    }));

    const data = {
      labels: ['긍정', '부정', '중립'],
      datasets: [
        {
          data: [positive, negative, neutral],
          backgroundColor: [
            'rgba(34, 197, 94, 0.8)',   // Green
            'rgba(239, 68, 68, 0.8)',    // Red
            'rgba(156, 163, 175, 0.8)',  // Gray
          ],
          borderColor: [
            'rgba(34, 197, 94, 1)',
            'rgba(239, 68, 68, 1)',
            'rgba(156, 163, 175, 1)',
          ],
          borderWidth: 2,
        },
      ],
    };

    const options: ChartOptions<'pie'> = {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: showLegend,
          position: 'bottom',
          labels: {
            padding: 20,
            usePointStyle: true,
            font: {
              size: 12,
            },
          },
        },
        title: {
          display: !!title,
          text: title,
          font: {
            size: 16,
            weight: 'bold',
          },
          padding: {
            bottom: 20,
          },
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const total = positive + negative + neutral;
              const value = context.parsed;
              const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
              return `${context.label}: ${value}건 (${percentage}%)`;
            },
          },
        },
      },
    };

    return (
      <div className={className}>
        <Pie ref={chartRef} data={data} options={options} />
      </div>
    );
  }
);

SentimentPieChart.displayName = 'SentimentPieChart';

```

---

## frontend/src/components/charts/SourceDistributionChart.tsx

```tsx
import { useRef, forwardRef, useImperativeHandle } from 'react';
import { Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from 'chart.js';

// Register Chart.js components
ChartJS.register(ArcElement, Tooltip, Legend);

export interface SourceDistributionChartProps {
  sources: Array<{ source: string; count: number }>;
  title?: string;
  maxItems?: number;
  className?: string;
}

export interface ChartExportHandle {
  toBase64: () => string | null;
}

const COLORS = [
  'rgba(59, 130, 246, 0.8)',   // Blue
  'rgba(34, 197, 94, 0.8)',    // Green
  'rgba(234, 179, 8, 0.8)',    // Yellow
  'rgba(239, 68, 68, 0.8)',    // Red
  'rgba(168, 85, 247, 0.8)',   // Purple
  'rgba(20, 184, 166, 0.8)',   // Teal
  'rgba(249, 115, 22, 0.8)',   // Orange
  'rgba(236, 72, 153, 0.8)',   // Pink
  'rgba(107, 114, 128, 0.8)',  // Gray
  'rgba(139, 92, 246, 0.8)',   // Violet
];

const BORDER_COLORS = [
  'rgba(59, 130, 246, 1)',
  'rgba(34, 197, 94, 1)',
  'rgba(234, 179, 8, 1)',
  'rgba(239, 68, 68, 1)',
  'rgba(168, 85, 247, 1)',
  'rgba(20, 184, 166, 1)',
  'rgba(249, 115, 22, 1)',
  'rgba(236, 72, 153, 1)',
  'rgba(107, 114, 128, 1)',
  'rgba(139, 92, 246, 1)',
];

export const SourceDistributionChart = forwardRef<ChartExportHandle, SourceDistributionChartProps>(
  ({ sources, title = '출처별 분포', maxItems = 8, className }, ref) => {
    const chartRef = useRef<ChartJS<'doughnut'>>(null);

    useImperativeHandle(ref, () => ({
      toBase64: () => {
        if (chartRef.current) {
          return chartRef.current.toBase64Image();
        }
        return null;
      },
    }));

    // Sort and limit sources
    const sortedSources = [...sources]
      .sort((a, b) => b.count - a.count)
      .slice(0, maxItems);

    // Group remaining sources as "기타"
    if (sources.length > maxItems) {
      const otherCount = sources
        .sort((a, b) => b.count - a.count)
        .slice(maxItems)
        .reduce((sum, s) => sum + s.count, 0);
      if (otherCount > 0) {
        sortedSources.push({ source: '기타', count: otherCount });
      }
    }

    const data = {
      labels: sortedSources.map((s) => s.source),
      datasets: [
        {
          data: sortedSources.map((s) => s.count),
          backgroundColor: sortedSources.map((_, i) => COLORS[i % COLORS.length]),
          borderColor: sortedSources.map((_, i) => BORDER_COLORS[i % BORDER_COLORS.length]),
          borderWidth: 2,
        },
      ],
    };

    const options: ChartOptions<'doughnut'> = {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '50%',
      plugins: {
        legend: {
          display: true,
          position: 'right',
          labels: {
            padding: 15,
            usePointStyle: true,
            font: {
              size: 11,
            },
          },
        },
        title: {
          display: !!title,
          text: title,
          font: {
            size: 16,
            weight: 'bold',
          },
          padding: {
            bottom: 20,
          },
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const total = sortedSources.reduce((sum, s) => sum + s.count, 0);
              const percentage = total > 0 ? ((context.parsed / total) * 100).toFixed(1) : '0';
              return `${context.label}: ${context.parsed}건 (${percentage}%)`;
            },
          },
        },
      },
    };

    return (
      <div className={className}>
        <Doughnut ref={chartRef} data={data} options={options} />
      </div>
    );
  }
);

SourceDistributionChart.displayName = 'SourceDistributionChart';

```

---

## frontend/src/components/charts/TrendLineChart.tsx

```tsx
import { useRef, forwardRef, useImperativeHandle } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
} from 'chart.js';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler
);

export interface TrendDataPoint {
  date: string;
  count: number;
}

export interface TrendLineChartProps {
  data: TrendDataPoint[];
  title?: string;
  showArea?: boolean;
  color?: string;
  className?: string;
}

export interface ChartExportHandle {
  toBase64: () => string | null;
}

export const TrendLineChart = forwardRef<ChartExportHandle, TrendLineChartProps>(
  ({ data, title = '시간대별 트렌드', showArea = true, color = 'rgb(59, 130, 246)', className }, ref) => {
    const chartRef = useRef<ChartJS<'line'>>(null);

    useImperativeHandle(ref, () => ({
      toBase64: () => {
        if (chartRef.current) {
          return chartRef.current.toBase64Image();
        }
        return null;
      },
    }));

    const chartData = {
      labels: data.map((d) => d.date),
      datasets: [
        {
          label: '기사 수',
          data: data.map((d) => d.count),
          borderColor: color,
          backgroundColor: showArea ? `${color}33` : 'transparent',
          fill: showArea,
          tension: 0.4,
          pointBackgroundColor: color,
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
        },
      ],
    };

    const options: ChartOptions<'line'> = {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: false,
        },
        title: {
          display: !!title,
          text: title,
          font: {
            size: 16,
            weight: 'bold',
          },
          padding: {
            bottom: 20,
          },
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: (context) => `${context.parsed.y}건`,
          },
        },
      },
      scales: {
        x: {
          grid: {
            display: false,
          },
          ticks: {
            maxRotation: 45,
            minRotation: 0,
          },
        },
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(0, 0, 0, 0.1)',
          },
          ticks: {
            precision: 0,
          },
        },
      },
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false,
      },
    };

    return (
      <div className={className}>
        <Line ref={chartRef} data={chartData} options={options} />
      </div>
    );
  }
);

TrendLineChart.displayName = 'TrendLineChart';

```

---

## frontend/src/components/charts/index.ts

```ts
/**
 * Chart components for PDF report generation
 * These components use Chart.js and provide a toBase64() method
 * for exporting chart images to be included in PDF reports.
 */

export { SentimentPieChart, type SentimentPieChartProps } from './SentimentPieChart';
export { KeywordBarChart, type KeywordBarChartProps } from './KeywordBarChart';
export { TrendLineChart, type TrendLineChartProps, type TrendDataPoint } from './TrendLineChart';
export { ReliabilityGauge, type ReliabilityGaugeProps } from './ReliabilityGauge';
export { SourceDistributionChart, type SourceDistributionChartProps } from './SourceDistributionChart';

// Common export handle interface
export type { ChartExportHandle } from './SentimentPieChart';

```

---

## frontend/src/components/dashboard/LiveNewsTicker.tsx

```tsx
import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, TrendingUp, Clock, RefreshCw, AlertCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { listCollectedData, type CollectedDataDTO } from "@/lib/api/data";

interface NewsItem {
  id: string;
  title: string;
  source: string;
  time: string;
  url: string;
  category: string;
  originalData?: CollectedDataDTO;
}

/**
 * 수집된 데이터를 뉴스 아이템으로 변환
 */
const transformToNewsItem = (data: CollectedDataDTO): NewsItem => {
  // metadata에서 source 이름 추출 (API returns snake_case: source_name)
  const sourceName = (data.metadata?.source_name as string) || 
                     (data.metadata?.sourceName as string) || 
                     (data.metadata?.source as string) || 
                     `Source #${data.sourceId}`;
  
  // metadata에서 카테고리 추출 (tags 배열 또는 category)
  const tags = data.metadata?.tags as string[] | undefined;
  const category = (tags && tags.length > 0 ? tags[0] : null) ||
                   (data.metadata?.category as string) || 
                   (data.metadata?.section as string) || 
                   '일반';
  
  // 시간 포맷팅
  const time = data.publishedDate 
    ? new Date(data.publishedDate).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : new Date(data.collectedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

  return {
    id: data.id.toString(),
    title: data.title || '제목 없음',
    source: sourceName,
    time,
    url: data.url || '#',
    category,
    originalData: data,
  };
};

export function LiveNewsTicker() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchTime, setLastFetchTime] = useState<Date | null>(null);

  // 데이터 로드 함수
  const fetchNews = useCallback(async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
    setError(null);
    
    try {
      // 최근 수집된 데이터 20개 조회
      const result = await listCollectedData(0, 20);
      const newsItems = result.content.map(transformToNewsItem);
      setNews(newsItems);
      setLastFetchTime(new Date());
    } catch (e) {
      console.error('Failed to fetch news:', e);
      setError('뉴스를 불러오는데 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 초기 로드
  useEffect(() => {
    fetchNews();
  }, [fetchNews]);

  // 30초마다 자동 새로고침
  useEffect(() => {
    const interval = setInterval(() => {
      fetchNews(false); // 로딩 표시 없이 백그라운드 업데이트
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchNews]);

  // 뉴스 클릭 핸들러
  const handleNewsClick = (item: NewsItem, e: React.MouseEvent) => {
    if (!item.url || item.url === '#') {
      e.preventDefault();
      // URL이 없으면 상세 페이지로 이동하거나 모달 표시
      // 추후 상세 보기 기능 추가 가능
      return;
    }
    // 외부 URL은 새 탭에서 열기
  };

  // 로딩 상태
  if (isLoading && news.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-bold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-red-500" />
            실시간 뉴스 브리핑
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="p-3 rounded-lg border">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-5 w-full" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // 에러 상태
  if (error && news.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-bold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-red-500" />
            실시간 뉴스 브리핑
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center h-[300px] gap-4">
          <AlertCircle className="h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={() => fetchNews()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            다시 시도
          </Button>
        </CardContent>
      </Card>
    );
  }

  // 데이터 없음 상태
  if (news.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-bold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-red-500" />
            실시간 뉴스 브리핑
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center h-[300px] gap-4">
          <p className="text-muted-foreground">수집된 뉴스가 없습니다.</p>
          <Button variant="outline" size="sm" onClick={() => fetchNews()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            새로고침
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-bold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-red-500" />
            실시간 뉴스 브리핑
          </CardTitle>
          <div className="flex items-center gap-2">
            {lastFetchTime && (
              <span className="text-xs text-muted-foreground">
                {lastFetchTime.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 업데이트
              </span>
            )}
            <Badge variant="outline" className="animate-pulse text-red-500 border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800">
              LIVE
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[380px] pr-4">
          <div className="space-y-3">
            {news.map((item, index) => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => handleNewsClick(item, e)}
                className={`
                  block p-3 rounded-lg border bg-card transition-all cursor-pointer
                  hover:bg-accent/50 hover:border-primary/30 hover:shadow-sm
                  ${index === 0 ? 'border-l-4 border-l-red-500 shadow-sm' : ''}
                `}
              >
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px] h-5">
                      {item.category}
                    </Badge>
                    <span className="font-medium text-primary/80">{item.source}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {item.time}
                  </div>
                </div>
                <div className="font-medium flex items-start gap-1 text-sm leading-snug">
                  <span className="flex-1 line-clamp-2">{item.title}</span>
                  {item.url && item.url !== '#' && (
                    <ExternalLink className="h-3 w-3 mt-0.5 opacity-50 flex-shrink-0" />
                  )}
                </div>
              </a>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

```

---

## frontend/src/components/dashboard/MCPAnalysisPanel.tsx

```tsx
/**
 * MCP Analysis Panel
 *
 * 종합적인 MCP 분석 결과를 표시하는 대시보드 패널
 * - 편향도 게이지
 * - 신뢰도 점수
 * - 감성 분포
 * - 주요 토픽
 */

import { useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  analyzeComprehensive,
  getBiasLabel,
  getBiasColor,
  getReliabilityLabel,
  getReliabilityColor,
  getSentimentLabel,
  getSentimentColor,
  type ComprehensiveAnalysisResult,
  type BiasAnalysisData,
  type FactcheckAnalysisData,
  type SentimentAnalysisData,
  type TopicAnalysisData,
} from '@/lib/api/mcp';

interface MCPAnalysisPanelProps {
  keyword: string;
  days?: number;
  className?: string;
  onAnalysisComplete?: (result: ComprehensiveAnalysisResult) => void;
}

export function MCPAnalysisPanel({
  keyword,
  days = 7,
  className,
  onAnalysisComplete,
}: MCPAnalysisPanelProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ComprehensiveAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const analysisResult = await analyzeComprehensive({ keyword, days });
      setResult(analysisResult);
      onAnalysisComplete?.(analysisResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : '분석 중 오류가 발생했습니다');
    } finally {
      setIsLoading(false);
    }
  };

  // 로딩 상태
  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            분석 중...
          </CardTitle>
          <CardDescription>"{keyword}"에 대한 종합 분석을 수행하고 있습니다</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  // 에러 상태
  if (error) {
    return (
      <Card className={cn('border-destructive/50', className)}>
        <CardContent className="py-6">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button variant="outline" size="sm" onClick={runAnalysis} className="mt-4">
            <RefreshCw className="h-4 w-4 mr-2" />
            다시 시도
          </Button>
        </CardContent>
      </Card>
    );
  }

  // 초기 상태 또는 결과 없음
  if (!result) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>MCP 종합 분석</CardTitle>
          <CardDescription>
            "{keyword}"에 대한 편향도, 신뢰도, 감성, 토픽을 분석합니다
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={runAnalysis} className="w-full">
            <TrendingUp className="h-4 w-4 mr-2" />
            분석 시작
          </Button>
        </CardContent>
      </Card>
    );
  }

  // 결과 렌더링
  const { results } = result;
  const biasData = 'data' in results.bias ? (results.bias.data as BiasAnalysisData) : null;
  const factcheckData =
    'data' in results.factcheck ? (results.factcheck.data as FactcheckAnalysisData) : null;
  const sentimentData =
    'data' in results.sentiment ? (results.sentiment.data as SentimentAnalysisData) : null;
  const topicData = 'data' in results.topic ? (results.topic.data as TopicAnalysisData) : null;

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>MCP 종합 분석 결과</CardTitle>
            <CardDescription>
              "{keyword}" · 최근 {days}일
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={result.success ? 'default' : 'secondary'}>
              {Math.round(result.success_rate * 100)}% 성공
            </Badge>
            <Button variant="ghost" size="icon" onClick={runAnalysis}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="bias" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="bias">편향도</TabsTrigger>
            <TabsTrigger value="factcheck">신뢰도</TabsTrigger>
            <TabsTrigger value="sentiment">감성</TabsTrigger>
            <TabsTrigger value="topic">토픽</TabsTrigger>
          </TabsList>

          {/* 편향도 탭 */}
          <TabsContent value="bias" className="mt-4">
            {biasData ? (
              <BiasAnalysisCard data={biasData} />
            ) : (
              <ErrorMessage message={'error' in results.bias ? results.bias.error : '데이터 없음'} />
            )}
          </TabsContent>

          {/* 신뢰도 탭 */}
          <TabsContent value="factcheck" className="mt-4">
            {factcheckData ? (
              <FactcheckAnalysisCard data={factcheckData} />
            ) : (
              <ErrorMessage
                message={'error' in results.factcheck ? results.factcheck.error : '데이터 없음'}
              />
            )}
          </TabsContent>

          {/* 감성 탭 */}
          <TabsContent value="sentiment" className="mt-4">
            {sentimentData ? (
              <SentimentAnalysisCard data={sentimentData} />
            ) : (
              <ErrorMessage
                message={'error' in results.sentiment ? results.sentiment.error : '데이터 없음'}
              />
            )}
          </TabsContent>

          {/* 토픽 탭 */}
          <TabsContent value="topic" className="mt-4">
            {topicData ? (
              <TopicAnalysisCard data={topicData} />
            ) : (
              <ErrorMessage
                message={'error' in results.topic ? results.topic.error : '데이터 없음'}
              />
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────
// Sub Components
// ─────────────────────────────────────────────

function ErrorMessage({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function BiasAnalysisCard({ data }: { data: BiasAnalysisData }) {
  const biasPercent = ((data.overall_bias + 1) / 2) * 100; // -1~1 → 0~100

  return (
    <div className="space-y-4">
      {/* 편향도 게이지 */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-blue-600">진보</span>
          <span className="font-medium">{getBiasLabel(data.overall_bias)}</span>
          <span className="text-red-600">보수</span>
        </div>
        <div className="relative h-3 bg-gradient-to-r from-blue-500 via-gray-300 to-red-500 rounded-full">
          <div
            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white border-2 border-gray-800 rounded-full shadow"
            style={{ left: `calc(${biasPercent}% - 8px)` }}
          />
        </div>
      </div>

      {/* 통계 */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 rounded-lg bg-muted">
          <div className="text-xs text-muted-foreground">객관성 점수</div>
          <div className="text-lg font-semibold">{(data.objectivity_score * 100).toFixed(0)}%</div>
        </div>
        <div className="p-3 rounded-lg bg-muted">
          <div className="text-xs text-muted-foreground">신뢰도</div>
          <div className="text-lg font-semibold">{(data.confidence * 100).toFixed(0)}%</div>
        </div>
      </div>

      {/* 언론사 분포 */}
      {data.source_distribution && Object.keys(data.source_distribution).length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2">언론사별 분포</h4>
          <div className="space-y-1">
            {Object.entries(data.source_distribution)
              .slice(0, 5)
              .map(([source, count]) => (
                <div key={source} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{source}</span>
                  <Badge variant="secondary">{count}건</Badge>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FactcheckAnalysisCard({ data }: { data: FactcheckAnalysisData }) {
  const reliabilityPercent = data.reliability_score * 100;

  return (
    <div className="space-y-4">
      {/* 신뢰도 점수 */}
      <div className="text-center p-4 rounded-lg bg-muted">
        <div className="text-3xl font-bold" style={{ color: `var(--${getReliabilityColor(data.reliability_score)})` }}>
          {reliabilityPercent.toFixed(0)}%
        </div>
        <div className="text-sm text-muted-foreground">
          {getReliabilityLabel(data.reliability_score)}
        </div>
      </div>

      {/* 검증 현황 */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <span className="text-xs text-muted-foreground">검증된 주장</span>
          </div>
          <div className="text-lg font-semibold text-green-600">{data.verified_claims}</div>
        </div>
        <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-yellow-600" />
            <span className="text-xs text-muted-foreground">미검증 주장</span>
          </div>
          <div className="text-lg font-semibold text-yellow-600">{data.unverified_claims}</div>
        </div>
      </div>

      {/* 인용 품질 */}
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span>인용 품질</span>
          <span>{(data.citation_quality * 100).toFixed(0)}%</span>
        </div>
        <Progress value={data.citation_quality * 100} />
      </div>
    </div>
  );
}

function SentimentAnalysisCard({ data }: { data: SentimentAnalysisData }) {
  const total = data.distribution.positive + data.distribution.negative + data.distribution.neutral;
  const posPercent = total > 0 ? (data.distribution.positive / total) * 100 : 0;
  const negPercent = total > 0 ? (data.distribution.negative / total) * 100 : 0;
  const neuPercent = total > 0 ? (data.distribution.neutral / total) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* 전체 감성 */}
      <div className="text-center p-4 rounded-lg bg-muted">
        <Badge
          variant="outline"
          className={cn(
            'text-lg px-4 py-1',
            data.overall_sentiment === 'positive' && 'border-green-500 text-green-600',
            data.overall_sentiment === 'negative' && 'border-red-500 text-red-600',
            data.overall_sentiment === 'neutral' && 'border-gray-500 text-gray-600'
          )}
        >
          {getSentimentLabel(data.overall_sentiment)}
        </Badge>
        <div className="text-sm text-muted-foreground mt-2">
          점수: {(data.sentiment_score * 100).toFixed(0)} · 신뢰도: {(data.confidence * 100).toFixed(0)}%
        </div>
      </div>

      {/* 분포 차트 */}
      <div className="space-y-3">
        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-green-600">긍정</span>
            <span>{posPercent.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-green-500" style={{ width: `${posPercent}%` }} />
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">중립</span>
            <span>{neuPercent.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-gray-400" style={{ width: `${neuPercent}%` }} />
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-red-600">부정</span>
            <span>{negPercent.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-red-500" style={{ width: `${negPercent}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TopicAnalysisCard({ data }: { data: TopicAnalysisData }) {
  return (
    <div className="space-y-4">
      {/* 주요 토픽 */}
      <div>
        <h4 className="text-sm font-medium mb-2">주요 토픽</h4>
        <div className="flex flex-wrap gap-2">
          {data.main_topics.slice(0, 8).map((topic, idx) => (
            <Badge key={idx} variant={idx < 3 ? 'default' : 'secondary'}>
              {topic.topic}
              <span className="ml-1 opacity-70">{(topic.relevance * 100).toFixed(0)}%</span>
            </Badge>
          ))}
        </div>
      </div>

      {/* 관련 엔티티 */}
      {data.related_entities && data.related_entities.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2">관련 인물/기관</h4>
          <div className="flex flex-wrap gap-1">
            {data.related_entities.slice(0, 10).map((entity, idx) => (
              <Badge key={idx} variant="outline" className="text-xs">
                {entity}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* 카테고리 분포 */}
      {data.category_distribution && Object.keys(data.category_distribution).length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2">카테고리 분포</h4>
          <div className="space-y-2">
            {Object.entries(data.category_distribution)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 5)
              .map(([category, count]) => (
                <div key={category} className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground w-20 truncate">{category}</span>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary"
                      style={{
                        width: `${(count / Math.max(...Object.values(data.category_distribution))) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground w-8 text-right">{count}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default MCPAnalysisPanel;

```

---

## frontend/src/components/dashboard/MCPHealthStatus.tsx

```tsx
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

```

---

## frontend/src/components/dashboard/MCPTrendingTopics.tsx

```tsx
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

```

---

## frontend/src/components/dashboard/RecentActivity.tsx

```tsx
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, CheckCircle2, Search, Brain, Shield, Loader2, AlertCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { listSearchHistory, type SearchHistoryRecord } from "@/lib/api";

interface ActivityItem {
  id: string;
  type: string;
  message: string;
  time: string;
  icon: typeof Search;
  color: string;
  bg: string;
}

// 검색 타입에 따른 아이콘 및 스타일 매핑
const getActivityStyle = (searchType: string) => {
  switch (searchType) {
    case 'UNIFIED':
      return {
        icon: Search,
        color: "text-blue-500",
        bg: "bg-blue-100 dark:bg-blue-900/30",
        label: "통합 검색"
      };
    case 'DEEP_SEARCH':
      return {
        icon: Brain,
        color: "text-purple-500",
        bg: "bg-purple-100 dark:bg-purple-900/30",
        label: "Deep Search 분석"
      };
    case 'FACT_CHECK':
      return {
        icon: Shield,
        color: "text-green-500",
        bg: "bg-green-100 dark:bg-green-900/30",
        label: "팩트체크"
      };
    case 'BROWSER_AGENT':
      return {
        icon: CheckCircle2,
        color: "text-orange-500",
        bg: "bg-orange-100 dark:bg-orange-900/30",
        label: "브라우저 에이전트"
      };
    default:
      return {
        icon: Activity,
        color: "text-gray-500",
        bg: "bg-gray-100 dark:bg-gray-800",
        label: "활동"
      };
  }
};

// 시간 포맷팅
const formatTimeAgo = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "방금 전";
  if (diffMins < 60) return `${diffMins}분 전`;
  if (diffHours < 24) return `${diffHours}시간 전`;
  if (diffDays < 7) return `${diffDays}일 전`;
  return date.toLocaleDateString('ko-KR');
};

// 검색 기록을 활동 항목으로 변환
const convertToActivity = (record: SearchHistoryRecord): ActivityItem => {
  const style = getActivityStyle(record.searchType);
  const resultInfo = record.resultCount > 0 ? ` (${record.resultCount}건)` : '';
  
  return {
    id: record.id.toString(),
    type: record.searchType.toLowerCase(),
    message: `'${record.query}' ${style.label} 수행${resultInfo}`,
    time: formatTimeAgo(record.createdAt),
    icon: style.icon,
    color: style.color,
    bg: style.bg,
  };
};

export function RecentActivity() {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchActivities = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // 최근 검색 기록 10개 조회
        const response = await listSearchHistory(0, 10, 'createdAt', 'DESC');
        const activityItems = response.content.map(convertToActivity);
        setActivities(activityItems);
      } catch (err) {
        console.error('Failed to fetch recent activities:', err);
        setError('활동 기록을 불러오는데 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchActivities();
    
    // 1분마다 자동 새로고침
    const interval = setInterval(fetchActivities, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-lg font-bold flex items-center gap-2">
          <Activity className="h-5 w-5 text-orange-500" />
          최근 활동
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[300px]">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <AlertCircle className="h-8 w-8 mb-2" />
              <p className="text-sm">{error}</p>
            </div>
          ) : activities.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Activity className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">아직 활동 기록이 없습니다</p>
              <p className="text-xs mt-1">검색을 시작해보세요!</p>
            </div>
          ) : (
            <div className="relative border-l ml-3 my-2 space-y-6">
              {activities.map((item) => (
                <div key={item.id} className="ml-6 relative">
                  <span className={`absolute -left-[35px] flex h-8 w-8 items-center justify-center rounded-full ${item.bg} ring-4 ring-background`}>
                    <item.icon className={`h-4 w-4 ${item.color}`} />
                  </span>
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium leading-none">{item.message}</p>
                    <span className="text-xs text-muted-foreground">{item.time}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

```

---

## frontend/src/components/dashboard/TrendChart.tsx

```tsx
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, TrendingUp, Loader2, AlertCircle } from "lucide-react";
import { getSearchStatistics, listSearchHistory } from "@/lib/api";

interface KeywordTrend {
  keyword: string;
  count: number;
  percentage: number;
  color: string;
}

// 키워드별 색상 팔레트
const COLORS = [
  "bg-blue-500",
  "bg-green-500", 
  "bg-purple-500",
  "bg-orange-500",
  "bg-pink-500",
  "bg-cyan-500",
  "bg-yellow-500",
  "bg-red-500",
];

export function TrendChart() {
  const [trends, setTrends] = useState<KeywordTrend[]>([]);
  const [totalSearches, setTotalSearches] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTrends = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // 검색 통계와 최근 검색 기록을 병렬로 가져오기
        const [statsResponse, historyResponse] = await Promise.all([
          getSearchStatistics(7),
          listSearchHistory(0, 100, 'createdAt', 'DESC'),
        ]);

        setTotalSearches(statsResponse.totalSearches);

        // 검색 기록에서 키워드 빈도 추출
        const keywordCount = new Map<string, number>();
        historyResponse.content.forEach(record => {
          const query = record.query.toLowerCase().trim();
          if (query.length >= 2) {
            keywordCount.set(query, (keywordCount.get(query) || 0) + 1);
          }
        });

        // 빈도순 정렬 후 상위 8개 추출
        const sortedKeywords = Array.from(keywordCount.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8);

        const totalCount = sortedKeywords.reduce((sum, [, count]) => sum + count, 0);

        const trendData: KeywordTrend[] = sortedKeywords.map(([keyword, count], index) => ({
          keyword: keyword.length > 10 ? keyword.slice(0, 10) + '...' : keyword,
          count,
          percentage: totalCount > 0 ? Math.round((count / totalCount) * 100) : 0,
          color: COLORS[index % COLORS.length],
        }));

        setTrends(trendData);
      } catch (err) {
        console.error('Failed to fetch trend data:', err);
        setError('트렌드 데이터를 불러오는데 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchTrends();
    
    // 5분마다 자동 새로고침
    const interval = setInterval(fetchTrends, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-lg font-bold flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-blue-500" />
          주요 키워드 트렌드
        </CardTitle>
        <CardDescription>
          지난 7일간 검색된 키워드 {totalSearches > 0 && `(총 ${totalSearches}회 검색)`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-[300px] w-full flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="h-[300px] w-full flex flex-col items-center justify-center text-muted-foreground">
            <AlertCircle className="h-10 w-10 mb-2" />
            <p className="text-sm">{error}</p>
          </div>
        ) : trends.length === 0 ? (
          <div className="h-[300px] w-full bg-slate-50 dark:bg-slate-900/50 rounded-lg flex items-center justify-center border border-dashed">
            <div className="text-center text-muted-foreground">
              <TrendingUp className="h-10 w-10 mx-auto mb-2 opacity-20" />
              <p>아직 검색 기록이 없습니다</p>
              <p className="text-xs mt-1">검색을 시작하면 트렌드가 표시됩니다</p>
            </div>
          </div>
        ) : (
          <div className="h-[300px] w-full">
            {/* 막대 차트 */}
            <div className="space-y-3">
              {trends.map((trend, index) => (
                <div key={index} className="space-y-1">
                  <div className="flex justify-between items-center text-sm">
                    <span className="font-medium truncate max-w-[150px]" title={trend.keyword}>
                      {trend.keyword}
                    </span>
                    <span className="text-muted-foreground">
                      {trend.count}회 ({trend.percentage}%)
                    </span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${trend.color} rounded-full transition-all duration-500`}
                      style={{ width: `${trend.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* 범례 */}
            <div className="mt-6 grid grid-cols-2 gap-2 text-sm">
              {trends.slice(0, 4).map((trend, index) => (
                <div key={index} className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${trend.color}`} />
                  <span className="truncate" title={trend.keyword}>{trend.keyword}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

```

---

## frontend/src/components/home/ContinueCard.tsx

```tsx
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
  Brain,
  Shield,
  Search,
  Bot,
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
    icon: Brain,
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
    icon: Bot,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50 dark:bg-orange-900/20',
    label: 'AI 에이전트',
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

```

---

## frontend/src/components/home/DailyInsightCard.tsx

```tsx
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
  Sparkles,
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
              <Sparkles className="h-4 w-4" />
              심층 분석 시작
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default DailyInsightCard;

```

---

## frontend/src/components/home/HeroSearchBar.tsx

```tsx
/**
 * HeroSearchBar - 대형 검색창 컴포넌트
 * 
 * 홈 화면 상단에 배치되는 주요 검색 진입점
 * - 크고 눈에 띄는 디자인
 * - 플레이스홀더로 용도 안내
 * - 검색 모드 전환 지원
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Sparkles,
  Brain,
  Shield,
  Link as LinkIcon,
  ArrowRight,
  Loader2,
  X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export type SearchMode = 'unified' | 'deep' | 'factcheck' | 'urlanalysis';

interface SearchModeConfig {
  id: SearchMode;
  label: string;
  description: string;
  icon: typeof Search;
  color: string;
  placeholder: string;
}

const SEARCH_MODES: SearchModeConfig[] = [
  {
    id: 'unified',
    label: '통합 검색',
    description: 'DB + 웹 + AI 동시 검색',
    icon: Search,
    color: 'text-blue-600',
    placeholder: '무엇이든 검색하세요...',
  },
  {
    id: 'deep',
    label: '심층 분석',
    description: 'AI 기반 심층 증거 수집',
    icon: Brain,
    color: 'text-purple-600',
    placeholder: '분석할 주제를 입력하세요...',
  },
  {
    id: 'factcheck',
    label: '팩트체크',
    description: '주장의 진위 검증',
    icon: Shield,
    color: 'text-green-600',
    placeholder: '검증할 주장을 붙여넣으세요...',
  },
  {
    id: 'urlanalysis',
    label: 'URL 분석',
    description: 'URL에서 주장 추출',
    icon: LinkIcon,
    color: 'text-orange-600',
    placeholder: '분석할 URL을 입력하세요...',
  },
];

interface HeroSearchBarProps {
  defaultMode?: SearchMode;
  onSearch?: (query: string, mode: SearchMode) => void;
  className?: string;
  autoFocus?: boolean;
}

export function HeroSearchBar({
  defaultMode = 'unified',
  onSearch,
  className,
  autoFocus = false,
}: HeroSearchBarProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>(defaultMode);
  const [isLoading, setIsLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const currentMode = SEARCH_MODES.find(m => m.id === mode) || SEARCH_MODES[0];
  const ModeIcon = currentMode.icon;

  // 검색 실행
  const handleSearch = useCallback(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    setIsLoading(true);

    if (onSearch) {
      onSearch(trimmedQuery, mode);
    } else {
      // 기본 동작: 검색 페이지로 이동
      const modeParam = mode === 'unified' ? '' : `mode=${mode}`;
      const queryParam = `q=${encodeURIComponent(trimmedQuery)}`;
      const params = [modeParam, queryParam].filter(Boolean).join('&');
      navigate(`/search?${params}`);
    }

    setIsLoading(false);
  }, [query, mode, onSearch, navigate]);

  // Enter 키 처리
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  }, [handleSearch]);

  // 모드 변경
  const handleModeChange = useCallback((newMode: SearchMode) => {
    setMode(newMode);
    inputRef.current?.focus();
  }, []);

  // 쿼리 초기화
  const clearQuery = useCallback(() => {
    setQuery('');
    inputRef.current?.focus();
  }, []);

  // autoFocus 처리
  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  return (
    <div className={cn('w-full', className)}>
      {/* 검색창 컨테이너 */}
      <div
        className={cn(
          'relative rounded-2xl border-2 bg-background shadow-lg transition-all duration-200',
          isFocused
            ? 'border-primary ring-4 ring-primary/20 shadow-xl'
            : 'border-border hover:border-primary/50'
        )}
      >
        {/* 모드 선택 드롭다운 */}
        <div className="absolute left-4 top-1/2 -translate-y-1/2 z-10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-9 gap-2 px-3 rounded-lg',
                  currentMode.color
                )}
              >
                <ModeIcon className="h-4 w-4" />
                <span className="hidden sm:inline font-medium">{currentMode.label}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {SEARCH_MODES.map(searchMode => {
                const Icon = searchMode.icon;
                return (
                  <DropdownMenuItem
                    key={searchMode.id}
                    onClick={() => handleModeChange(searchMode.id)}
                    className="flex items-start gap-3 p-3"
                  >
                    <Icon className={cn('h-5 w-5 mt-0.5', searchMode.color)} />
                    <div>
                      <div className="font-medium">{searchMode.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {searchMode.description}
                      </div>
                    </div>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* 검색 입력 */}
        <Input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={currentMode.placeholder}
          className={cn(
            'h-16 text-lg border-0 bg-transparent',
            'pl-36 sm:pl-44 pr-32',
            'focus-visible:ring-0 focus-visible:ring-offset-0',
            'placeholder:text-muted-foreground/60'
          )}
        />

        {/* 우측 버튼 영역 */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
          {/* 초기화 버튼 */}
          {query && (
            <Button
              variant="ghost"
              size="icon"
              onClick={clearQuery}
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
          )}

          {/* 검색 버튼 */}
          <Button
            onClick={handleSearch}
            disabled={!query.trim() || isLoading}
            size="lg"
            className="h-11 px-6 rounded-xl gap-2"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <Search className="h-5 w-5" />
                <span className="hidden sm:inline">검색</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* 하단 힌트 */}
      <div className="flex items-center justify-center gap-4 mt-3 text-sm text-muted-foreground">
        <span className="flex items-center gap-1">
          <Sparkles className="h-3.5 w-3.5 text-yellow-500" />
          AI 분석 지원
        </span>
        <span className="hidden sm:inline">•</span>
        <span className="hidden sm:flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded bg-muted text-xs">Ctrl+K</kbd>
          로 빠른 검색
        </span>
      </div>
    </div>
  );
}

export default HeroSearchBar;

```

---

## frontend/src/components/home/QuickActionCards.tsx

```tsx
/**
 * QuickActionCards - 빠른 액션 카드
 * 
 * 홈 화면에서 주요 기능에 1탭으로 접근할 수 있는 카드
 * - 심층 분석
 * - 팩트체크
 * - URL 분석
 */

import { Link } from 'react-router-dom';
import {
  Brain,
  Shield,
  Link as LinkIcon,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: typeof Brain;
  color: string;
  bgColor: string;
  hoverColor: string;
  href: string;
  badge?: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'deep',
    label: '심층 분석',
    description: 'AI가 심층 증거를 수집하고 입장을 분석합니다',
    icon: Brain,
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-50 dark:bg-purple-900/20',
    hoverColor: 'hover:bg-purple-100 dark:hover:bg-purple-900/30',
    href: '/search?mode=deep',
    badge: 'AI',
  },
  {
    id: 'factcheck',
    label: '팩트체크',
    description: '주장의 진위를 신뢰할 수 있는 출처로 검증합니다',
    icon: Shield,
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
    hoverColor: 'hover:bg-green-100 dark:hover:bg-green-900/30',
    href: '/search?mode=factcheck',
  },
  {
    id: 'url',
    label: 'URL 분석',
    description: '뉴스 기사에서 검증 가능한 주장을 추출합니다',
    icon: LinkIcon,
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-50 dark:bg-orange-900/20',
    hoverColor: 'hover:bg-orange-100 dark:hover:bg-orange-900/30',
    href: '/search?mode=urlanalysis',
  },
];

interface QuickActionCardsProps {
  className?: string;
  layout?: 'horizontal' | 'grid';
}

export function QuickActionCards({
  className,
  layout = 'horizontal',
}: QuickActionCardsProps) {
  return (
    <div
      className={cn(
        layout === 'horizontal'
          ? 'flex flex-col sm:flex-row gap-3'
          : 'grid grid-cols-1 sm:grid-cols-3 gap-3',
        className
      )}
    >
      {QUICK_ACTIONS.map(action => (
        <QuickActionCard key={action.id} action={action} />
      ))}
    </div>
  );
}

interface QuickActionCardProps {
  action: QuickAction;
}

function QuickActionCard({ action }: QuickActionCardProps) {
  const Icon = action.icon;

  return (
    <Link to={action.href} className="flex-1">
      <Card
        className={cn(
          'group relative overflow-hidden transition-all duration-200',
          'border-2 border-transparent',
          action.bgColor,
          action.hoverColor,
          'hover:border-primary/30 hover:shadow-md'
        )}
      >
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start gap-3">
            {/* 아이콘 */}
            <div
              className={cn(
                'p-2.5 rounded-xl bg-background/60 shadow-sm',
                'group-hover:scale-110 transition-transform duration-200',
                action.color
              )}
            >
              <Icon className="h-6 w-6" />
            </div>

            {/* 내용 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-base">{action.label}</h3>
                {action.badge && (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium',
                      'bg-primary/10 text-primary'
                    )}
                  >
                    <Sparkles className="h-3 w-3" />
                    {action.badge}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2">
                {action.description}
              </p>
            </div>

            {/* 화살표 */}
            <ArrowRight
              className={cn(
                'h-5 w-5 text-muted-foreground/50',
                'group-hover:text-primary group-hover:translate-x-1',
                'transition-all duration-200'
              )}
            />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default QuickActionCards;

```

---

## frontend/src/components/home/RecentActivities.tsx

```tsx
/**
 * RecentActivities - 최근 활동 내역
 * 
 * 백엔드에서 직접 통합 검색, Deep Search, 팩트체크, URL 분석 등의
 * 작업 내역을 가져와서 페이지네이션과 함께 표시합니다.
 */

import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  History,
  Search,
  Brain,
  Shield,
  Bot,
  Link as LinkIcon,
  ArrowRight,
  Clock,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Filter,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ExternalLink,
  MoreHorizontal,
  Bookmark,
  BookmarkCheck,
  Eye,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  listSearchHistory,
  toggleSearchBookmark,
  type SearchHistoryRecord,
  type SearchHistoryType,
  type PageResponse,
} from '@/lib/api';
import { cn } from '@/lib/utils';

// 검색 타입별 설정
const SEARCH_TYPE_CONFIG: Record<SearchHistoryType, {
  icon: typeof Search;
  color: string;
  bgColor: string;
  label: string;
  labelKo: string;
}> = {
  UNIFIED: {
    icon: Search,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    label: 'UNIFIED',
    labelKo: '통합 검색',
  },
  DEEP_SEARCH: {
    icon: Brain,
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-100 dark:bg-purple-900/30',
    label: 'DEEP',
    labelKo: '심층 분석',
  },
  FACT_CHECK: {
    icon: Shield,
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    label: 'FACT',
    labelKo: '팩트체크',
  },
  BROWSER_AGENT: {
    icon: Bot,
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-100 dark:bg-orange-900/30',
    label: 'AGENT',
    labelKo: 'URL 분석',
  },
};

// 상대적 시간 표시
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return '방금 전';
  if (diffMinutes < 60) return `${diffMinutes}분 전`;
  if (diffHours < 24) return `${diffHours}시간 전`;
  if (diffDays < 7) return `${diffDays}일 전`;
  return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

// 날짜 포맷
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface RecentActivitiesProps {
  className?: string;
  pageSize?: number;
  showFilters?: boolean;
  showHeader?: boolean;
  compact?: boolean;
}

export function RecentActivities({
  className,
  pageSize = 5,
  showFilters = true,
  showHeader = true,
  compact = false,
}: RecentActivitiesProps) {
  const navigate = useNavigate();
  
  // State
  const [activities, setActivities] = useState<SearchHistoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [totalElements, setTotalElements] = useState(0);
  
  // Filter state
  const [selectedType, setSelectedType] = useState<SearchHistoryType | 'ALL'>('ALL');

  // Fetch activities from backend
  const fetchActivities = useCallback(async (page: number = 0, refresh: boolean = false) => {
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const typeFilter = selectedType === 'ALL' ? undefined : selectedType;
      const response: PageResponse<SearchHistoryRecord> = await listSearchHistory(
        page,
        pageSize,
        'createdAt',
        'DESC',
        typeFilter
      );

      setActivities(response.content);
      setTotalPages(response.totalPages);
      setTotalElements(response.totalElements);
      setCurrentPage(page);
    } catch (err) {
      console.error('Failed to fetch activities:', err);
      setError('활동 내역을 불러오는데 실패했습니다.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [pageSize, selectedType]);

  // Initial load and refetch when filter changes
  useEffect(() => {
    fetchActivities(0);
  }, [fetchActivities]);

  // Handle bookmark toggle
  const handleToggleBookmark = async (id: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await toggleSearchBookmark(id);
      // Update local state
      setActivities(prev => prev.map(a => 
        a.id === id ? { ...a, bookmarked: !a.bookmarked } : a
      ));
    } catch (err) {
      console.error('Failed to toggle bookmark:', err);
    }
  };

  // Navigate to detail page based on search type
  const handleItemClick = (activity: SearchHistoryRecord) => {
    const routeMap: Record<SearchHistoryType, string> = {
      UNIFIED: `/search?q=${encodeURIComponent(activity.query)}`,
      DEEP_SEARCH: `/deep-search?q=${encodeURIComponent(activity.query)}`,
      FACT_CHECK: `/fact-check?q=${encodeURIComponent(activity.query)}`,
      BROWSER_AGENT: `/browser-agent?historyId=${activity.id}`,
    };
    navigate(routeMap[activity.searchType] || `/search?q=${encodeURIComponent(activity.query)}`);
  };

  // Pagination handlers
  const goToPage = (page: number) => {
    if (page >= 0 && page < totalPages) {
      fetchActivities(page);
    }
  };

  // Loading skeleton
  if (isLoading && !isRefreshing) {
    return (
      <Card className={className}>
        {showHeader && (
          <CardHeader className="pb-3">
            <Skeleton className="h-6 w-32" />
          </CardHeader>
        )}
        <CardContent className="space-y-3">
          {Array.from({ length: pageSize }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      {/* Header */}
      {showHeader && (
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4" />
              최근 활동 내역
              {totalElements > 0 && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  {totalElements}건
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => fetchActivities(currentPage, true)}
                      disabled={isRefreshing}
                    >
                      <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>새로고침</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button variant="ghost" size="sm" asChild className="text-xs h-8">
                <Link to="/history">
                  전체 보기
                  <ArrowRight className="h-3 w-3 ml-1" />
                </Link>
              </Button>
            </div>
          </div>
        </CardHeader>
      )}

      <CardContent className="space-y-4">
        {/* Filters */}
        {showFilters && (
          <Tabs
            value={selectedType}
            onValueChange={(v) => setSelectedType(v as SearchHistoryType | 'ALL')}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-5 h-9">
              <TabsTrigger value="ALL" className="text-xs px-2">전체</TabsTrigger>
              <TabsTrigger value="UNIFIED" className="text-xs px-2">검색</TabsTrigger>
              <TabsTrigger value="DEEP_SEARCH" className="text-xs px-2">심층분석</TabsTrigger>
              <TabsTrigger value="FACT_CHECK" className="text-xs px-2">팩트체크</TabsTrigger>
              <TabsTrigger value="BROWSER_AGENT" className="text-xs px-2">URL분석</TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {/* Error state */}
        {error && (
          <div className="flex items-center justify-center py-6 text-destructive">
            <AlertCircle className="h-4 w-4 mr-2" />
            <span className="text-sm">{error}</span>
            <Button
              variant="link"
              size="sm"
              onClick={() => fetchActivities(0)}
              className="ml-2"
            >
              다시 시도
            </Button>
          </div>
        )}

        {/* Empty state */}
        {!error && activities.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <History className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">아직 활동 내역이 없습니다</p>
            <p className="text-xs mt-1">검색, 심층분석, 팩트체크 등을 시작해보세요</p>
          </div>
        )}

        {/* Activity list */}
        {!error && activities.length > 0 && (
          <div className="space-y-2">
            {activities.map((activity) => (
              <ActivityItem
                key={activity.id}
                activity={activity}
                compact={compact}
                onClick={() => handleItemClick(activity)}
                onBookmarkToggle={handleToggleBookmark}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {!error && totalPages > 1 && (
          <div className="flex items-center justify-between pt-2 border-t">
            <span className="text-xs text-muted-foreground">
              {currentPage * pageSize + 1}-{Math.min((currentPage + 1) * pageSize, totalElements)} / {totalElements}건
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 0}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              
              {/* Page numbers */}
              <div className="flex items-center gap-1 mx-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) {
                    pageNum = i;
                  } else if (currentPage < 3) {
                    pageNum = i;
                  } else if (currentPage > totalPages - 4) {
                    pageNum = totalPages - 5 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }
                  return (
                    <Button
                      key={pageNum}
                      variant={currentPage === pageNum ? "default" : "ghost"}
                      size="icon"
                      className="h-8 w-8 text-xs"
                      onClick={() => goToPage(pageNum)}
                    >
                      {pageNum + 1}
                    </Button>
                  );
                })}
              </div>
              
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage >= totalPages - 1}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Activity item component
interface ActivityItemProps {
  activity: SearchHistoryRecord;
  compact?: boolean;
  onClick: () => void;
  onBookmarkToggle: (id: number, e: React.MouseEvent) => void;
}

function ActivityItem({ activity, compact, onClick, onBookmarkToggle }: ActivityItemProps) {
  const config = SEARCH_TYPE_CONFIG[activity.searchType] || SEARCH_TYPE_CONFIG.UNIFIED;
  const Icon = config.icon;

  // Status indicator
  const getStatusInfo = () => {
    if (activity.success === false || activity.errorMessage) {
      return { icon: XCircle, color: 'text-destructive', label: '실패' };
    }
    if (activity.resultCount !== undefined && activity.resultCount > 0) {
      return { icon: CheckCircle2, color: 'text-green-600', label: '완료' };
    }
    return null;
  };

  const statusInfo = getStatusInfo();

  return (
    <div
      onClick={onClick}
      className={cn(
        'flex items-start gap-3 p-3 rounded-lg transition-all cursor-pointer',
        'bg-card hover:bg-muted/50 border border-transparent hover:border-border',
        'group'
      )}
    >
      {/* Type icon */}
      <div className={cn(
        'flex-shrink-0 h-10 w-10 rounded-lg flex items-center justify-center',
        config.bgColor
      )}>
        <Icon className={cn('h-5 w-5', config.color)} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {/* Query */}
            <p className="text-sm font-medium line-clamp-1 group-hover:text-primary transition-colors">
              {activity.query}
            </p>
            
            {/* Meta info */}
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
              {/* Type badge */}
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">
                {config.labelKo}
              </Badge>
              
              {/* Result count */}
              {activity.resultCount !== undefined && activity.resultCount > 0 && (
                <span className="flex items-center gap-1">
                  <Eye className="h-3 w-3" />
                  {activity.resultCount}건
                </span>
              )}
              
              {/* Credibility score */}
              {activity.credibilityScore !== undefined && (
                <span className={cn(
                  'flex items-center gap-1 font-medium',
                  activity.credibilityScore >= 70 ? 'text-green-600' :
                  activity.credibilityScore >= 40 ? 'text-yellow-600' : 'text-red-600'
                )}>
                  신뢰도 {activity.credibilityScore.toFixed(0)}%
                </span>
              )}
              
              {/* Status */}
              {statusInfo && (
                <span className={cn('flex items-center gap-1', statusInfo.color)}>
                  <statusInfo.icon className="h-3 w-3" />
                  {statusInfo.label}
                </span>
              )}
              
              {/* Time */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatRelativeTime(activity.createdAt)}
                  </TooltipTrigger>
                  <TooltipContent>
                    {formatDate(activity.createdAt)}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={(e) => onBookmarkToggle(activity.id, e)}
                  >
                    {activity.bookmarked ? (
                      <BookmarkCheck className="h-4 w-4 text-primary" />
                    ) : (
                      <Bookmark className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {activity.bookmarked ? '북마크 해제' : '북마크'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onClick(); }}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  상세 보기
                </DropdownMenuItem>
                <DropdownMenuItem onClick={(e) => { 
                  e.stopPropagation(); 
                  navigator.clipboard.writeText(activity.query);
                }}>
                  복사
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  onClick={(e) => onBookmarkToggle(activity.id, e)}
                >
                  {activity.bookmarked ? (
                    <>
                      <BookmarkCheck className="h-4 w-4 mr-2" />
                      북마크 해제
                    </>
                  ) : (
                    <>
                      <Bookmark className="h-4 w-4 mr-2" />
                      북마크
                    </>
                  )}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Tags */}
        {activity.tags && activity.tags.length > 0 && !compact && (
          <div className="flex items-center gap-1 mt-2 flex-wrap">
            {activity.tags.slice(0, 3).map((tag, idx) => (
              <Badge key={idx} variant="secondary" className="text-[10px] px-1.5 py-0">
                {tag}
              </Badge>
            ))}
            {activity.tags.length > 3 && (
              <span className="text-[10px] text-muted-foreground">
                +{activity.tags.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default RecentActivities;

```

---

## frontend/src/components/home/RecentSearches.tsx

```tsx
/**
 * RecentSearches - 최근 검색
 * 
 * 사용자의 최근 검색 기록을 표시
 * - 빠른 재검색
 * - 검색 타입별 구분
 */

import { Link } from 'react-router-dom';
import {
  History,
  Search,
  Brain,
  Shield,
  Bot,
  Link as LinkIcon,
  ArrowRight,
  Clock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useSearchHistory, type SearchHistoryType } from '@/lib/api';
import { cn } from '@/lib/utils';

// 검색 타입별 설정
const SEARCH_TYPE_CONFIG: Record<SearchHistoryType, {
  icon: typeof Search;
  color: string;
  label: string;
}> = {
  UNIFIED: {
    icon: Search,
    color: 'text-blue-600',
    label: '검색',
  },
  DEEP_SEARCH: {
    icon: Brain,
    color: 'text-purple-600',
    label: '심층분석',
  },
  FACT_CHECK: {
    icon: Shield,
    color: 'text-green-600',
    label: '팩트체크',
  },
  BROWSER_AGENT: {
    icon: Bot,
    color: 'text-orange-600',
    label: '에이전트',
  },
};

// 상대적 시간 표시
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return '방금 전';
  if (diffMinutes < 60) return `${diffMinutes}분 전`;
  if (diffHours < 24) return `${diffHours}시간 전`;
  if (diffDays < 7) return `${diffDays}일 전`;
  return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

interface RecentSearchItem {
  id: number;
  query: string;
  searchType: SearchHistoryType;
  resultCount?: number;
  createdAt: string;
}

interface RecentSearchesProps {
  className?: string;
  maxItems?: number;
  searches?: RecentSearchItem[];
  isLoading?: boolean;
}

export function RecentSearches({
  className,
  maxItems = 5,
  searches = [],
  isLoading = false,
}: RecentSearchesProps) {
  // 로딩 상태
  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent className="space-y-2">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  // 검색 기록 없음
  if (searches.length === 0) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" />
            최근 검색
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            아직 검색 기록이 없습니다
          </p>
        </CardContent>
      </Card>
    );
  }

  const displaySearches = searches.slice(0, maxItems);

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" />
            최근 검색
          </CardTitle>
          <Button variant="ghost" size="sm" asChild className="text-xs h-7">
            <Link to="/workspace/history">
              전체 보기
              <ArrowRight className="h-3 w-3 ml-1" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {displaySearches.map(search => (
          <RecentSearchItem key={search.id} search={search} />
        ))}
      </CardContent>
    </Card>
  );
}

interface RecentSearchItemProps {
  search: RecentSearchItem;
}

function RecentSearchItem({ search }: RecentSearchItemProps) {
  const config = SEARCH_TYPE_CONFIG[search.searchType] || SEARCH_TYPE_CONFIG.UNIFIED;
  const Icon = config.icon;

  // 검색 타입에 따른 URL 생성
  const getSearchUrl = () => {
    const modeMap: Record<SearchHistoryType, string> = {
      UNIFIED: '',
      DEEP_SEARCH: 'mode=deep',
      FACT_CHECK: 'mode=factcheck',
      BROWSER_AGENT: '',
    };
    const mode = modeMap[search.searchType];
    const query = `q=${encodeURIComponent(search.query)}`;
    return mode ? `/?${mode}&${query}` : `/?${query}`;
  };

  return (
    <Link
      to={getSearchUrl()}
      className={cn(
        'flex items-center gap-3 p-2 rounded-lg transition-colors',
        'hover:bg-muted group'
      )}
    >
      {/* 아이콘 */}
      <Icon className={cn('h-4 w-4 flex-shrink-0', config.color)} />

      {/* 쿼리 */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium line-clamp-1 group-hover:text-primary transition-colors">
          {search.query}
        </p>
      </div>

      {/* 메타 정보 */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-shrink-0">
        {search.resultCount !== undefined && (
          <span>{search.resultCount}건</span>
        )}
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatRelativeTime(search.createdAt)}
        </span>
      </div>
    </Link>
  );
}

// 축약 버전 (홈 사이드바용)
interface RecentSearchesCompactProps {
  className?: string;
  searches?: RecentSearchItem[];
  maxItems?: number;
}

export function RecentSearchesCompact({
  className,
  searches = [],
  maxItems = 5,
}: RecentSearchesCompactProps) {
  if (searches.length === 0) {
    return (
      <p className={cn('text-sm text-muted-foreground text-center py-2', className)}>
        최근 검색 없음
      </p>
    );
  }

  return (
    <div className={cn('space-y-1', className)}>
      {searches.slice(0, maxItems).map(search => {
        const config = SEARCH_TYPE_CONFIG[search.searchType] || SEARCH_TYPE_CONFIG.UNIFIED;
        const Icon = config.icon;

        return (
          <Link
            key={search.id}
            to={`/?q=${encodeURIComponent(search.query)}`}
            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted transition-colors"
          >
            <Icon className={cn('h-3.5 w-3.5', config.color)} />
            <span className="text-sm line-clamp-1 flex-1">{search.query}</span>
          </Link>
        );
      })}
    </div>
  );
}

export default RecentSearches;

```

---

## frontend/src/components/home/RecommendedTemplates.tsx

```tsx
/**
 * RecommendedTemplates - 추천 템플릿
 * 
 * 자주 사용하는 검색 패턴을 템플릿으로 제공
 * - 즐겨찾기 템플릿
 * - 최근 사용 템플릿
 * - 기본 추천 템플릿
 */

import { Link } from 'react-router-dom';
import {
  FileText,
  Star,
  Sparkles,
  ArrowRight,
  Search,
  Brain,
  Shield,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface SearchTemplate {
  id: number;
  name: string;
  query: string;
  mode: 'unified' | 'deep' | 'factcheck';
  description?: string;
  favorite?: boolean;
  useCount?: number;
}

// 기본 추천 템플릿
const DEFAULT_TEMPLATES: SearchTemplate[] = [
  {
    id: -1,
    name: '찬반 입장 비교 분석',
    query: '',
    mode: 'deep',
    description: '특정 이슈에 대한 찬성/반대 입장 수집',
    useCount: 0,
  },
  {
    id: -2,
    name: '팩트체크 리포트',
    query: '',
    mode: 'factcheck',
    description: '주장의 사실 여부를 다각도로 검증',
    useCount: 0,
  },
  {
    id: -3,
    name: '출처 신뢰도 분석',
    query: '',
    mode: 'unified',
    description: '정보 출처의 신뢰성 평가',
    useCount: 0,
  },
];

const MODE_CONFIG = {
  unified: {
    icon: Search,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
  },
  deep: {
    icon: Brain,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50 dark:bg-purple-900/20',
  },
  factcheck: {
    icon: Shield,
    color: 'text-green-600',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
  },
};

interface RecommendedTemplatesProps {
  className?: string;
  templates?: SearchTemplate[];
  isLoading?: boolean;
  onSelectTemplate?: (template: SearchTemplate) => void;
  showDefaults?: boolean;
}

export function RecommendedTemplates({
  className,
  templates = [],
  isLoading = false,
  onSelectTemplate,
  showDefaults = true,
}: RecommendedTemplatesProps) {
  // 로딩 상태
  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-28" />
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-24 w-48 flex-shrink-0" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // 즐겨찾기와 사용자 템플릿 결합
  const favoriteTemplates = templates.filter(t => t.favorite);
  const recentTemplates = templates
    .filter(t => !t.favorite && t.useCount && t.useCount > 0)
    .sort((a, b) => (b.useCount || 0) - (a.useCount || 0))
    .slice(0, 3);

  const prioritizedTemplates = [...favoriteTemplates, ...recentTemplates];
  const usedModes = new Set(prioritizedTemplates.map(t => t.mode));
  const defaultsToAdd = showDefaults
    ? DEFAULT_TEMPLATES.filter(t => !usedModes.has(t.mode))
    : [];

  const combined = [...prioritizedTemplates, ...defaultsToAdd];
  const uniqueById = Array.from(
    combined.reduce((map, t) => {
      if (!map.has(t.id)) map.set(t.id, t);
      return map;
    }, new Map<number, SearchTemplate>())
  ).map(([, t]) => t);

  const displayTemplates = uniqueById.slice(0, 6);

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-yellow-500" />
            추천 템플릿
          </CardTitle>
          <Button variant="ghost" size="sm" asChild className="text-xs h-7">
            <Link to="/workspace">
              전체 보기
              <ArrowRight className="h-3 w-3 ml-1" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {displayTemplates.length === 0 ? (
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm text-muted-foreground">
              아직 추천할 템플릿이 없습니다
            </div>
            <Button variant="outline" size="sm" asChild className="text-xs h-8">
              <Link to="/workspace">템플릿 만들기</Link>
            </Button>
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
            {displayTemplates.map(template => (
              <TemplateCard
                key={template.id}
                template={template}
                onClick={() => onSelectTemplate?.(template)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface TemplateCardProps {
  template: SearchTemplate;
  onClick?: () => void;
}

function TemplateCard({ template, onClick }: TemplateCardProps) {
  const config = MODE_CONFIG[template.mode];
  const Icon = config.icon;

  // 기본 템플릿인지 확인 (ID가 음수면 기본 템플릿)
  const isDefault = template.id < 0;

  const getTemplateUrl = () => {
    if (isDefault) {
      // 기본 템플릿은 모드만 설정
      return `/search?mode=${template.mode}`;
    }
    // 사용자 템플릿은 쿼리 포함
    const mode = template.mode === 'unified' ? '' : `mode=${template.mode}`;
    const query = template.query ? `q=${encodeURIComponent(template.query)}` : '';
    const params = [mode, query].filter(Boolean).join('&');
    return params ? `/search?${params}` : '/search';
  };

  return (
    <Link
      to={getTemplateUrl()}
      onClick={onClick}
      className={cn(
        'flex-shrink-0 w-48 p-3 rounded-lg border transition-all',
        'hover:border-primary/50 hover:shadow-sm',
        config.bgColor
      )}
    >
      <div className="flex items-start gap-2 mb-2">
        <div className={cn('p-1.5 rounded-lg bg-background/60', config.color)}>
          <Icon className="h-4 w-4" />
        </div>
        {template.favorite && (
          <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
        )}
      </div>

      <h4 className="font-medium text-sm line-clamp-1 mb-1">
        {template.name}
      </h4>

      {template.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">
          {template.description}
        </p>
      )}

      {!isDefault && template.useCount !== undefined && template.useCount > 0 && (
        <Badge variant="outline" className="mt-2 text-xs">
          {template.useCount}회 사용
        </Badge>
      )}
    </Link>
  );
}

export default RecommendedTemplates;

```

---

## frontend/src/components/home/TrendingTopics.tsx

```tsx
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
  const { topics, personalizedTopics, isLoading, error, refresh, hasTrendingApi } = useTrendingTopics();

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

  // 트렌딩 API가 없을 때 개인화 토픽 또는 빈 상태 표시
  const displayTopics = topics.length > 0 ? topics.slice(0, maxItems) : personalizedTopics.slice(0, maxItems);
  const isPersonalized = topics.length === 0 && personalizedTopics.length > 0;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-orange-500" />
            {isPersonalized ? '내 관심 주제' : '오늘의 트렌드'}
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
        {displayTopics.length > 0 ? (
          displayTopics.map((topic, index) => (
            <TrendingTopicItem
              key={topic.id}
              topic={topic}
              rank={index + 1}
            />
          ))
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            <TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">아직 검색 기록이 없습니다</p>
            <p className="text-xs mt-1">검색을 시작하면 관심 주제가 표시됩니다</p>
          </div>
        )}
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
  topics?: TrendingTopic[];
  onTopicClick?: (keyword: string) => void;
}

export function TrendingTopicsCompact({
  className,
  maxItems = 5,
  topics: externalTopics,
  onTopicClick,
}: TrendingTopicsCompactProps) {
  const { topics: internalTopics, personalizedTopics, isLoading } = useTrendingTopics();
  
  // 외부에서 제공된 topics가 있으면 사용, 없으면 내부 hook 사용
  // 트렌딩 토픽이 없으면 개인화 토픽으로 대체
  const topics = externalTopics 
    || (internalTopics.length > 0 ? internalTopics : personalizedTopics);

  if (!externalTopics && isLoading) {
    return (
      <div className={cn('space-y-2', className)}>
        {[1, 2, 3].map(i => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  const handleClick = (topic: TrendingTopic, e: React.MouseEvent) => {
    if (onTopicClick) {
      e.preventDefault();
      onTopicClick(topic.title);
    }
  };

  // 토픽이 없을 때 빈 상태 표시
  if (topics.length === 0) {
    return (
      <div className={cn('text-center py-4 text-muted-foreground', className)}>
        <p className="text-sm">아직 트렌드 데이터가 없습니다</p>
        <p className="text-xs mt-1">검색을 시작해 보세요</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-1', className)}>
      {topics.slice(0, maxItems).map((topic, index) => (
        <Link
          key={topic.id}
          to={topic.searchUrl}
          onClick={(e) => handleClick(topic, e)}
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

```

---

## frontend/src/components/home/UsageStreakCard.tsx

```tsx
/**
 * UsageStreakCard - 연속 사용 현황 카드
 * 
 * 사용자의 활동 통계와 연속 사용 일수를 표시
 * - 연속 사용 스트릭
 * - 주간 활동 히트맵
 * - 누적 분석 건수
 */

import {
  Flame,
  Calendar,
  TrendingUp,
  Search,
  Brain,
  Shield,
  Award,
  Target,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useUsageStreak, getDayName } from '@/hooks/useUsageStreak';
import { cn } from '@/lib/utils';

interface UsageStreakCardProps {
  className?: string;
  variant?: 'full' | 'compact';
}

export function UsageStreakCard({
  className,
  variant = 'full',
}: UsageStreakCardProps) {
  const { stats, isLoading } = useUsageStreak();

  // 로딩 상태
  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-28" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (variant === 'compact') {
    return <UsageStreakCompact stats={stats} className={className} />;
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Award className="h-4 w-4 text-yellow-500" />
          분석 활동
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 연속 사용 스트릭 */}
        <div className="flex items-center gap-4 p-3 rounded-lg bg-gradient-to-r from-orange-50 to-yellow-50 dark:from-orange-900/20 dark:to-yellow-900/20">
          <div className="p-2 rounded-full bg-orange-100 dark:bg-orange-900/30">
            <Flame className="h-6 w-6 text-orange-500" />
          </div>
          <div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-orange-600 dark:text-orange-400">
                {stats.currentStreak}
              </span>
              <span className="text-sm text-muted-foreground">일 연속</span>
            </div>
            <p className="text-xs text-muted-foreground">
              최고 기록: {stats.longestStreak}일
            </p>
          </div>
        </div>

        {/* 주간 활동 히트맵 */}
        <div>
          <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
            <Calendar className="h-4 w-4" />
            이번 주
          </h4>
          <div className="flex justify-between gap-1">
            {stats.weeklyActivity.map((day) => (
              <div key={day.date} className="flex-1 text-center">
                <div
                  className={cn(
                    'h-8 rounded-md flex items-center justify-center text-xs font-medium transition-colors',
                    day.hasActivity
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {day.hasActivity ? '✓' : '○'}
                </div>
                <span className="text-xs text-muted-foreground mt-1 block">
                  {getDayName(day.date)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 통계 요약 */}
        <div className="grid grid-cols-3 gap-3">
          <StatItem
            icon={Search}
            label="검색"
            value={stats.weeklySearchCount}
            color="text-blue-600"
          />
          <StatItem
            icon={Brain}
            label="심층분석"
            value={stats.weeklyDeepSearchCount}
            color="text-purple-600"
          />
          <StatItem
            icon={Shield}
            label="팩트체크"
            value={stats.weeklyFactCheckCount}
            color="text-green-600"
          />
        </div>

        {/* 주간 목표 진행률 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1">
              <Target className="h-4 w-4" />
              주간 목표
            </span>
            <span className="text-muted-foreground">
              {stats.weeklyTotal} / 20건
            </span>
          </div>
          <Progress
            value={Math.min((stats.weeklyTotal / 20) * 100, 100)}
            className="h-2"
          />
          {stats.weeklyTotal >= 20 && (
            <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
              <Award className="h-3 w-3" />
              목표 달성! 훌륭합니다!
            </p>
          )}
        </div>

        {/* 누적 통계 */}
        <div className="pt-3 border-t">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">총 분석 건수</span>
            <span className="font-medium">{stats.totalSearches}건</span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-muted-foreground">일 평균</span>
            <span className="font-medium">{stats.averageSearchesPerDay}건</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// 통계 아이템
interface StatItemProps {
  icon: typeof Search;
  label: string;
  value: number;
  color: string;
}

function StatItem({ icon: Icon, label, value, color }: StatItemProps) {
  return (
    <div className="text-center p-2 rounded-lg bg-muted/50">
      <Icon className={cn('h-4 w-4 mx-auto mb-1', color)} />
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

// 축약 버전
interface UsageStreakCompactProps {
  stats: ReturnType<typeof useUsageStreak>['stats'];
  className?: string;
}

function UsageStreakCompact({ stats, className }: UsageStreakCompactProps) {
  return (
    <div className={cn('flex items-center gap-4 p-3 rounded-lg bg-muted/50', className)}>
      <div className="flex items-center gap-2">
        <Flame className="h-5 w-5 text-orange-500" />
        <span className="font-bold text-lg">{stats.currentStreak}</span>
        <span className="text-sm text-muted-foreground">일 연속</span>
      </div>
      <div className="h-6 w-px bg-border" />
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm">이번 주 {stats.weeklyTotal}건</span>
      </div>
    </div>
  );
}

export default UsageStreakCard;

```

---

## frontend/src/components/home/index.ts

```ts
/**
 * Home 컴포넌트 인덱스
 * 
 * 모든 홈 관련 컴포넌트를 export
 */

export { HeroSearchBar } from './HeroSearchBar';
export { ContinueCard } from './ContinueCard';
export { QuickActionCards } from './QuickActionCards';
export { TrendingTopics, TrendingTopicsCompact } from './TrendingTopics';
export { RecentSearches, RecentSearchesCompact } from './RecentSearches';
export { RecentActivities } from './RecentActivities';
export { RecommendedTemplates } from './RecommendedTemplates';
export { DailyInsightCard } from './DailyInsightCard';
export { UsageStreakCard } from './UsageStreakCard';

```

---

## frontend/src/components/insight/InsightCards.tsx

```tsx
import * as React from "react";
import {
  Scale,
  Lightbulb,
  TrendingUp,
  TrendingDown,
  Minus,
  ExternalLink,
  Share2,
  Download,
  BookOpen,
  BarChart3,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Evidence, StanceDistribution } from "@/lib/api";

// ============================================
// Base Card Wrapper with Glassmorphism
// ============================================

interface InsightCardWrapperProps {
  children: React.ReactNode;
  className?: string;
  variant?: "default" | "teal" | "coral" | "navy" | "conclusion";
}

export const InsightCardWrapper = ({
  children,
  className,
  variant = "default",
}: InsightCardWrapperProps) => {
  const variantStyles = {
    default: "bg-card/80 backdrop-blur-md border-border/50",
    teal: "bg-teal-50/80 dark:bg-teal-950/40 backdrop-blur-md border-teal-200/50 dark:border-teal-800/50",
    coral: "bg-coral-50/80 dark:bg-coral-950/40 backdrop-blur-md border-coral-200/50 dark:border-coral-800/50",
    navy: "bg-slate-50/80 dark:bg-slate-900/40 backdrop-blur-md border-slate-200/50 dark:border-slate-700/50",
    conclusion: "bg-gradient-to-br from-primary/10 to-accent/10 backdrop-blur-md border-primary/30",
  };

  return (
    <div
      className={cn(
        "rounded-2xl border shadow-lg p-6 md:p-8 h-full flex flex-col",
        "transition-all duration-300",
        variantStyles[variant],
        className
      )}
    >
      {children}
    </div>
  );
};

// ============================================
// A. Intro Card - Fact Check & Summary
// ============================================

interface IntroCardProps {
  topic: string;
  summaryPoints: string[];
  evidenceCount: number;
  backgroundImage?: string;
}

export const IntroCard = ({
  topic,
  summaryPoints,
  evidenceCount,
}: IntroCardProps) => {
  return (
    <InsightCardWrapper className="relative overflow-hidden">
      {/* Background decorative element */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-primary/10 to-transparent rounded-full -translate-y-1/2 translate-x-1/2" />
      
      <div className="relative z-10 flex flex-col h-full">
        {/* Icon and Badge */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 rounded-xl bg-primary/10 text-primary">
            <Lightbulb className="h-6 w-6" />
          </div>
          <Badge variant="secondary" className="text-xs">
            Fact Check Summary
          </Badge>
        </div>

        {/* Topic Title */}
        <h2 className="text-2xl md:text-3xl font-bold mb-2 text-foreground">
          {topic}
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          {evidenceCount}개의 출처에서 수집된 핵심 정보
        </p>

        {/* Summary Points */}
        <div className="flex-1 space-y-3">
          {summaryPoints.slice(0, 3).map((point, idx) => (
            <div
              key={idx}
              className="flex items-start gap-3 p-3 rounded-lg bg-background/50"
            >
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-sm font-medium flex items-center justify-center">
                {idx + 1}
              </span>
              <p className="text-sm text-foreground leading-relaxed">{point}</p>
            </div>
          ))}
        </div>

        {/* Swipe hint */}
        <div className="mt-6 text-center text-xs text-muted-foreground animate-pulse">
          스와이프하여 상세 분석 보기 →
        </div>
      </div>
    </InsightCardWrapper>
  );
};

// ============================================
// B. Viewpoint Comparison Card (VS Layout)
// ============================================

interface ViewpointVSCardProps {
  topic: string;
  proPoints: Evidence[];
  conPoints: Evidence[];
  distribution: StanceDistribution;
}

export const ViewpointVSCard = ({
  topic,
  proPoints,
  conPoints,
  distribution,
}: ViewpointVSCardProps) => {
  return (
    <InsightCardWrapper>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="p-3 rounded-xl bg-muted text-foreground">
            <Scale className="h-6 w-6" />
          </div>
          <h3 className="text-xl font-bold">관점 비교</h3>
        </div>

        {/* Distribution Bar */}
        <div className="flex gap-1 h-3 rounded-full overflow-hidden mb-6">
          <div
            className="bg-teal-500 transition-all duration-500"
            style={{ width: `${distribution.proRatio}%` }}
          />
          <div
            className="bg-gray-400 transition-all duration-500"
            style={{ width: `${distribution.neutralRatio}%` }}
          />
          <div
            className="bg-coral-500 transition-all duration-500"
            style={{ width: `${distribution.conRatio}%` }}
          />
        </div>

        {/* VS Layout */}
        <div className="flex-1 grid grid-cols-2 gap-4">
          {/* Pro Side (Teal) */}
          <div className="flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4 text-teal-600" />
              <span className="text-sm font-semibold text-teal-700 dark:text-teal-400">
                찬성 ({distribution.proRatio.toFixed(0)}%)
              </span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto max-h-64">
              {proPoints.slice(0, 3).map((evidence) => (
                <div
                  key={evidence.id}
                  className="p-3 rounded-lg bg-teal-100/50 dark:bg-teal-900/30 border border-teal-200/50 dark:border-teal-800/50"
                >
                  <p className="text-xs text-foreground line-clamp-3">
                    {evidence.snippet}
                  </p>
                  {evidence.source && (
                    <span className="text-xs text-muted-foreground mt-1 block">
                      — {evidence.source}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Con Side (Coral) */}
          <div className="flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <TrendingDown className="h-4 w-4 text-coral-600" />
              <span className="text-sm font-semibold text-coral-700 dark:text-coral-400">
                반대 ({distribution.conRatio.toFixed(0)}%)
              </span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto max-h-64">
              {conPoints.slice(0, 3).map((evidence) => (
                <div
                  key={evidence.id}
                  className="p-3 rounded-lg bg-coral-100/50 dark:bg-coral-900/30 border border-coral-200/50 dark:border-coral-800/50"
                >
                  <p className="text-xs text-foreground line-clamp-3">
                    {evidence.snippet}
                  </p>
                  {evidence.source && (
                    <span className="text-xs text-muted-foreground mt-1 block">
                      — {evidence.source}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </InsightCardWrapper>
  );
};

// ============================================
// B-2. Topic Cluster Card (Multi-topic view)
// ============================================

interface TopicCluster {
  tag: string;
  evidence: Evidence[];
  color: string;
}

interface TopicClusterCardProps {
  clusters: TopicCluster[];
}

export const TopicClusterCard = ({ clusters }: TopicClusterCardProps) => {
  return (
    <InsightCardWrapper>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 rounded-xl bg-muted text-foreground">
            <BookOpen className="h-6 w-6" />
          </div>
          <h3 className="text-xl font-bold">주제별 분석</h3>
        </div>

        {/* Topic Chips */}
        <div className="flex flex-wrap gap-2 mb-4">
          {clusters.map((cluster, idx) => (
            <Badge
              key={idx}
              variant="outline"
              className="px-3 py-1"
              style={{
                borderColor: cluster.color,
                color: cluster.color,
              }}
            >
              #{cluster.tag}
            </Badge>
          ))}
        </div>

        {/* Horizontal Scroll Cards */}
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-4 pb-4">
            {clusters.map((cluster, idx) => (
              <div
                key={idx}
                className="flex-shrink-0 w-64 p-4 rounded-xl bg-background/50 border"
                style={{ borderColor: `${cluster.color}40` }}
              >
                <div
                  className="text-sm font-semibold mb-3"
                  style={{ color: cluster.color }}
                >
                  #{cluster.tag}
                </div>
                <div className="space-y-2">
                  {cluster.evidence.slice(0, 2).map((e) => (
                    <p key={e.id} className="text-xs text-muted-foreground line-clamp-2">
                      {e.snippet}
                    </p>
                  ))}
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  {cluster.evidence.length}개 증거
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </InsightCardWrapper>
  );
};

// ============================================
// C. Data Visualization Card
// ============================================

interface DataVisualizationCardProps {
  distribution: StanceDistribution;
  topic: string;
  evidenceCount: number;
}

export const DataVisualizationCard = ({
  distribution,
  topic,
  evidenceCount,
}: DataVisualizationCardProps) => {
  const total = distribution.pro + distribution.con + distribution.neutral;

  return (
    <InsightCardWrapper variant="navy">
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 rounded-xl bg-slate-200/50 dark:bg-slate-700/50 text-foreground">
            <BarChart3 className="h-6 w-6" />
          </div>
          <h3 className="text-xl font-bold">데이터 분석</h3>
        </div>

        {/* Visual Chart */}
        <div className="flex-1 flex flex-col items-center justify-center">
          {/* Circular representation */}
          <div className="relative w-48 h-48 mb-6">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              {/* Background circle */}
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                className="text-muted/30"
              />
              {/* Pro arc */}
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                strokeDasharray={`${distribution.proRatio * 2.51} 251`}
                strokeDashoffset="0"
                className="text-teal-500"
              />
              {/* Neutral arc */}
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                strokeDasharray={`${distribution.neutralRatio * 2.51} 251`}
                strokeDashoffset={`${-distribution.proRatio * 2.51}`}
                className="text-gray-400"
              />
              {/* Con arc */}
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                strokeDasharray={`${distribution.conRatio * 2.51} 251`}
                strokeDashoffset={`${-(distribution.proRatio + distribution.neutralRatio) * 2.51}`}
                className="text-coral-500"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold">{total}</span>
              <span className="text-xs text-muted-foreground">증거 수집</span>
            </div>
          </div>

          {/* Legend */}
          <div className="grid grid-cols-3 gap-6 w-full">
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-full bg-teal-500" />
                <span className="text-lg font-bold">{distribution.pro}</span>
              </div>
              <span className="text-xs text-muted-foreground">찬성</span>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-full bg-gray-400" />
                <span className="text-lg font-bold">{distribution.neutral}</span>
              </div>
              <span className="text-xs text-muted-foreground">중립</span>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-full bg-coral-500" />
                <span className="text-lg font-bold">{distribution.con}</span>
              </div>
              <span className="text-xs text-muted-foreground">반대</span>
            </div>
          </div>
        </div>

        {/* Interpretation */}
        <div className="mt-6 p-4 rounded-xl bg-background/50 text-center">
          <p className="text-sm text-muted-foreground">
            "{topic}"에 대해 {distribution.proRatio > distribution.conRatio ? "긍정적" : distribution.proRatio < distribution.conRatio ? "부정적" : "균형잡힌"} 시각이{" "}
            {Math.abs(distribution.proRatio - distribution.conRatio).toFixed(0)}% 더 우세합니다.
          </p>
        </div>
      </div>
    </InsightCardWrapper>
  );
};

// ============================================
// D. Conclusion Card - The Verdict
// ============================================

interface ConclusionCardProps {
  topic: string;
  conclusion: string;
  keyInsight: string;
  distribution: StanceDistribution;
  onShare?: () => void;
  onDownload?: () => void;
}

export const ConclusionCard = ({
  topic,
  conclusion,
  keyInsight,
  distribution,
  onShare,
  onDownload,
}: ConclusionCardProps) => {
  return (
    <InsightCardWrapper variant="conclusion">
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="p-3 rounded-xl bg-primary/20 text-primary">
            <Target className="h-6 w-6" />
          </div>
          <h3 className="text-xl font-bold text-primary">최종 인사이트</h3>
        </div>

        {/* Main Conclusion */}
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
          <blockquote className="text-xl md:text-2xl font-bold leading-relaxed mb-6 text-foreground">
            "{conclusion}"
          </blockquote>

          <div className="w-16 h-1 bg-primary/30 rounded-full mb-6" />

          <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
            {keyInsight}
          </p>
        </div>

        {/* Balance Indicator */}
        <div className="my-6 flex items-center justify-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-2 rounded-full bg-teal-500" />
            <span className="text-xs text-muted-foreground">
              {distribution.proRatio.toFixed(0)}%
            </span>
          </div>
          <Scale className="h-5 w-5 text-muted-foreground" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {distribution.conRatio.toFixed(0)}%
            </span>
            <div className="w-8 h-2 rounded-full bg-coral-500" />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-center gap-3">
          {onShare && (
            <Button variant="outline" size="sm" onClick={onShare}>
              <Share2 className="h-4 w-4 mr-2" />
              공유하기
            </Button>
          )}
          {onDownload && (
            <Button variant="outline" size="sm" onClick={onDownload}>
              <Download className="h-4 w-4 mr-2" />
              저장하기
            </Button>
          )}
        </div>
      </div>
    </InsightCardWrapper>
  );
};

// ============================================
// Evidence Detail Card (for detailed view)
// ============================================

interface EvidenceDetailCardProps {
  evidence: Evidence[];
  stance: "pro" | "con" | "neutral" | "all";
}

export const EvidenceDetailCard = ({
  evidence,
  stance,
}: EvidenceDetailCardProps) => {
  const filteredEvidence =
    stance === "all" ? evidence : evidence.filter((e) => e.stance === stance);

  const stanceConfig = {
    pro: { color: "teal", icon: TrendingUp, label: "찬성 의견" },
    con: { color: "coral", icon: TrendingDown, label: "반대 의견" },
    neutral: { color: "gray", icon: Minus, label: "중립 의견" },
    all: { color: "primary", icon: BookOpen, label: "전체 증거" },
  };

  const config = stanceConfig[stance];
  const Icon = config.icon;

  return (
    <InsightCardWrapper>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <Icon className={`h-5 w-5 text-${config.color}-600`} />
          <h3 className="text-lg font-semibold">{config.label}</h3>
          <Badge variant="secondary">{filteredEvidence.length}개</Badge>
        </div>

        {/* Evidence List */}
        <div className="flex-1 space-y-3 overflow-y-auto max-h-80">
          {filteredEvidence.map((e) => (
            <div
              key={e.id}
              className="p-4 rounded-xl bg-background/50 border border-border/50 hover:border-border transition-colors"
            >
              {e.title && (
                <h4 className="font-medium text-sm mb-2 line-clamp-1">{e.title}</h4>
              )}
              <p className="text-sm text-muted-foreground line-clamp-3 mb-2">
                {e.snippet}
              </p>
              <div className="flex items-center justify-between">
                {e.source && (
                  <span className="text-xs text-muted-foreground">{e.source}</span>
                )}
                <a
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  원문 보기 <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </InsightCardWrapper>
  );
};

```

---

## frontend/src/components/insight/InsightFlow.tsx

```tsx
import * as React from "react";
import { useState, useCallback, useEffect } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  IntroCard,
  ViewpointVSCard,
  DataVisualizationCard,
  ConclusionCard,
  EvidenceDetailCard,
} from "./InsightCards";
import {
  ProgressStepper,
  DEFAULT_INSIGHT_STEPS,
  NavigationControls,
} from "./ProgressStepper";
import type { DeepSearchResult, Evidence } from "@/lib/api";

// ============================================
// Types
// ============================================

interface InsightFlowProps {
  result: DeepSearchResult;
  onShare?: () => void;
  onDownload?: () => void;
  className?: string;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Generate summary points from evidence
 */
const generateSummaryPoints = (evidence: Evidence[]): string[] => {
  const points: string[] = [];

  // Get unique snippets, prioritizing diverse stances
  const stances = ["pro", "neutral", "con"] as const;
  for (const stance of stances) {
    const stanceEvidence = evidence.filter((e) => e.stance === stance);
    if (stanceEvidence.length > 0) {
      // Use title if available, otherwise use snippet
      const text = stanceEvidence[0].title || stanceEvidence[0].snippet;
      if (text && !points.includes(text)) {
        points.push(text.length > 100 ? text.substring(0, 100) + "..." : text);
      }
    }
    if (points.length >= 3) break;
  }

  // Fill remaining with any evidence
  for (const e of evidence) {
    if (points.length >= 3) break;
    const text = e.title || e.snippet;
    if (text && !points.includes(text)) {
      points.push(text.length > 100 ? text.substring(0, 100) + "..." : text);
    }
  }

  return points;
};

/**
 * Generate conclusion from distribution
 */
const generateConclusion = (result: DeepSearchResult): string => {
  const total = result.evidence.length;
  const uniqueSources = new Set(result.evidence.map(e => e.source).filter(Boolean)).size;
  
  return `'${result.topic}'에 대해 ${total}개의 관련 자료를 ${uniqueSources}개 출처에서 수집했습니다. 다양한 관점의 자료를 바탕으로 주제에 대한 종합적인 이해를 제공합니다.`;
};

/**
 * Generate key insight
 */
const generateKeyInsight = (result: DeepSearchResult): string => {
  const total = result.evidence.length;
  const articlesWithTitle = result.evidence.filter(e => e.title).length;
  const uniqueSources = new Set(result.evidence.map(e => e.source).filter(Boolean)).size;

  return `총 ${total}개의 자료를 분석한 결과, ${articlesWithTitle}개의 기사/문서와 ${uniqueSources}개의 출처를 참조했습니다. 보다 자세한 내용은 PDF 보고서로 내보내기하여 확인하실 수 있습니다.`;
};

// ============================================
// InsightFlow Component
// ============================================

export const InsightFlow = ({
  result,
  onShare,
  onDownload,
  className,
}: InsightFlowProps) => {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: false,
    dragFree: false,
    containScroll: "trimSnaps",
  });

  const [currentIndex, setCurrentIndex] = useState(0);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  // Separate evidence by stance
  const proEvidence = result.evidence.filter((e) => e.stance === "pro");
  const conEvidence = result.evidence.filter((e) => e.stance === "con");
  const neutralEvidence = result.evidence.filter((e) => e.stance === "neutral");

  // Generate content
  const summaryPoints = generateSummaryPoints(result.evidence);
  const conclusion = generateConclusion(result);
  const keyInsight = generateKeyInsight(result);

  // Steps configuration
  const steps = DEFAULT_INSIGHT_STEPS;

  // Update scroll state
  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setCurrentIndex(emblaApi.selectedScrollSnap());
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
      emblaApi.off("reInit", onSelect);
    };
  }, [emblaApi, onSelect]);

  // Navigation handlers
  const scrollPrev = useCallback(() => {
    emblaApi?.scrollPrev();
  }, [emblaApi]);

  const scrollNext = useCallback(() => {
    emblaApi?.scrollNext();
  }, [emblaApi]);

  const scrollTo = useCallback(
    (index: number) => {
      emblaApi?.scrollTo(index);
    },
    [emblaApi]
  );

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        scrollPrev();
      } else if (e.key === "ArrowRight") {
        scrollNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [scrollPrev, scrollNext]);

  return (
    <div className={cn("w-full", className)}>
      {/* Progress Stepper */}
      <div className="mb-6">
        <ProgressStepper
          steps={steps}
          currentStep={currentIndex}
          onStepClick={scrollTo}
          variant="steps"
          className="px-4"
        />
      </div>

      {/* Carousel Container */}
      <div className="relative">
        {/* Navigation Arrows (Desktop) */}
        <Button
          variant="outline"
          size="icon"
          onClick={scrollPrev}
          disabled={!canScrollPrev}
          className={cn(
            "absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 z-10",
            "hidden md:flex",
            "h-12 w-12 rounded-full shadow-lg",
            "bg-background/80 backdrop-blur-sm",
            !canScrollPrev && "opacity-0 pointer-events-none"
          )}
        >
          <ChevronLeft className="h-6 w-6" />
        </Button>

        <Button
          variant="outline"
          size="icon"
          onClick={scrollNext}
          disabled={!canScrollNext}
          className={cn(
            "absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 z-10",
            "hidden md:flex",
            "h-12 w-12 rounded-full shadow-lg",
            "bg-background/80 backdrop-blur-sm",
            !canScrollNext && "opacity-0 pointer-events-none"
          )}
        >
          <ChevronRight className="h-6 w-6" />
        </Button>

        {/* Embla Carousel */}
        <div ref={emblaRef} className="overflow-hidden">
          <div className="flex touch-pan-y">
            {/* Slide 1: Intro Card */}
            <div className="flex-none w-full min-w-0 px-4">
              <div className="h-[500px] md:h-[550px]">
                <IntroCard
                  topic={result.topic}
                  summaryPoints={summaryPoints}
                  evidenceCount={result.evidence.length}
                />
              </div>
            </div>

            {/* Slide 2: Viewpoint VS Card */}
            <div className="flex-none w-full min-w-0 px-4">
              <div className="h-[500px] md:h-[550px]">
                <ViewpointVSCard
                  topic={result.topic}
                  proPoints={proEvidence}
                  conPoints={conEvidence}
                  distribution={result.stanceDistribution}
                />
              </div>
            </div>

            {/* Slide 3: Data Visualization Card */}
            <div className="flex-none w-full min-w-0 px-4">
              <div className="h-[500px] md:h-[550px]">
                <DataVisualizationCard
                  distribution={result.stanceDistribution}
                  topic={result.topic}
                  evidenceCount={result.evidence.length}
                />
              </div>
            </div>

            {/* Slide 4: Evidence Detail Card */}
            <div className="flex-none w-full min-w-0 px-4">
              <div className="h-[500px] md:h-[550px]">
                <EvidenceDetailCard evidence={result.evidence} stance="all" />
              </div>
            </div>

            {/* Slide 5: Conclusion Card */}
            <div className="flex-none w-full min-w-0 px-4">
              <div className="h-[500px] md:h-[550px]">
                <ConclusionCard
                  topic={result.topic}
                  conclusion={conclusion}
                  keyInsight={keyInsight}
                  distribution={result.stanceDistribution}
                  onShare={onShare}
                  onDownload={onDownload}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Navigation Controls */}
      <div className="mt-6 md:hidden px-4">
        <NavigationControls
          currentStep={currentIndex}
          totalSteps={steps.length}
          onPrevious={scrollPrev}
          onNext={scrollNext}
          canGoPrevious={canScrollPrev}
          canGoNext={canScrollNext}
        />
      </div>

      {/* Dots indicator (alternative compact view) */}
      <div className="mt-6 hidden md:block">
        <ProgressStepper
          steps={steps}
          currentStep={currentIndex}
          onStepClick={scrollTo}
          variant="dots"
        />
      </div>

      {/* Keyboard hint */}
      <div className="mt-4 text-center text-xs text-muted-foreground hidden md:block">
        ← → 키보드 방향키로 탐색하세요
      </div>
    </div>
  );
};

// ============================================
// Compact InsightFlow (for smaller views)
// ============================================

interface CompactInsightFlowProps {
  result: DeepSearchResult;
  className?: string;
}

export const CompactInsightFlow = ({
  result,
  className,
}: CompactInsightFlowProps) => {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: false,
    align: "start",
    containScroll: "trimSnaps",
    dragFree: true,
  });

  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!emblaApi) return;

    const onSelect = () => {
      setCurrentIndex(emblaApi.selectedScrollSnap());
    };

    emblaApi.on("select", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi]);

  const uniqueSources = new Set(result.evidence.map(e => e.source).filter(Boolean)).size;
  
  const cards = [
    { id: "summary", title: "핵심 요약", color: "bg-primary/10" },
    { id: "findings", title: `주요 발견 (${result.evidence.length})`, color: "bg-purple-100 dark:bg-purple-900/30" },
    { id: "sources", title: `참조 출처 (${uniqueSources})`, color: "bg-blue-100 dark:bg-blue-900/30" },
    { id: "conclusion", title: "결론", color: "bg-green-100 dark:bg-green-900/30" },
  ];

  return (
    <div className={cn("w-full", className)}>
      {/* Progress dots */}
      <div className="flex justify-center gap-1.5 mb-4">
        {cards.map((_, idx) => (
          <div
            key={idx}
            className={cn(
              "w-2 h-2 rounded-full transition-all",
              idx === currentIndex ? "w-6 bg-primary" : "bg-muted-foreground/30"
            )}
          />
        ))}
      </div>

      {/* Horizontal scroll cards */}
      <div ref={emblaRef} className="overflow-hidden -mx-4 px-4">
        <div className="flex gap-4">
          {cards.map((card) => (
            <div
              key={card.id}
              className={cn(
                "flex-none w-72 h-48 rounded-xl p-4",
                "border border-border/50",
                card.color
              )}
            >
              <h4 className="font-semibold mb-2">{card.title}</h4>
              <p className="text-sm text-muted-foreground line-clamp-5">
                {card.id === "summary" &&
                  `'${result.topic}'에 대해 ${result.evidence.length}개의 관련 자료를 수집하여 분석했습니다.`}
                {card.id === "findings" && result.evidence[0]?.snippet}
                {card.id === "sources" && `${uniqueSources}개의 다양한 출처에서 자료를 수집했습니다.`}
                {card.id === "conclusion" && generateConclusion(result)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default InsightFlow;

```

---

## frontend/src/components/insight/ProgressStepper.tsx

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";
import { Check, Lightbulb, Scale, BarChart3, Target, List } from "lucide-react";

// ============================================
// Step Configuration
// ============================================

export interface StepConfig {
  id: string;
  label: string;
  icon: React.ElementType;
  shortLabel?: string;
}

export const DEFAULT_INSIGHT_STEPS: StepConfig[] = [
  { id: "intro", label: "핵심 요약", shortLabel: "요약", icon: Lightbulb },
  { id: "viewpoint", label: "관점 비교", shortLabel: "비교", icon: Scale },
  { id: "data", label: "데이터 분석", shortLabel: "분석", icon: BarChart3 },
  { id: "evidence", label: "상세 증거", shortLabel: "증거", icon: List },
  { id: "conclusion", label: "최종 결론", shortLabel: "결론", icon: Target },
];

// ============================================
// Progress Stepper Component
// ============================================

interface ProgressStepperProps {
  steps: StepConfig[];
  currentStep: number;
  onStepClick?: (stepIndex: number) => void;
  className?: string;
  variant?: "dots" | "bar" | "steps";
}

export const ProgressStepper = ({
  steps,
  currentStep,
  onStepClick,
  className,
  variant = "dots",
}: ProgressStepperProps) => {
  if (variant === "dots") {
    return (
      <DotsProgress
        steps={steps}
        currentStep={currentStep}
        onStepClick={onStepClick}
        className={className}
      />
    );
  }

  if (variant === "bar") {
    return (
      <BarProgress
        steps={steps}
        currentStep={currentStep}
        className={className}
      />
    );
  }

  return (
    <StepsProgress
      steps={steps}
      currentStep={currentStep}
      onStepClick={onStepClick}
      className={className}
    />
  );
};

// ============================================
// Dots Variant (Default)
// ============================================

const DotsProgress = ({
  steps,
  currentStep,
  onStepClick,
  className,
}: ProgressStepperProps) => {
  return (
    <div className={cn("flex items-center justify-center gap-2", className)}>
      {steps.map((step, idx) => {
        const isActive = idx === currentStep;
        const isCompleted = idx < currentStep;

        return (
          <React.Fragment key={step.id}>
            <button
              onClick={() => onStepClick?.(idx)}
              disabled={!onStepClick}
              className={cn(
                "relative group transition-all duration-300",
                onStepClick && "cursor-pointer",
                !onStepClick && "cursor-default"
              )}
              aria-label={step.label}
            >
              <div
                className={cn(
                  "w-3 h-3 rounded-full transition-all duration-300",
                  isActive && "w-8 bg-primary scale-110",
                  isCompleted && "bg-primary",
                  !isActive && !isCompleted && "bg-muted-foreground/30"
                )}
              />
              {/* Tooltip */}
              <div
                className={cn(
                  "absolute -bottom-8 left-1/2 -translate-x-1/2",
                  "px-2 py-1 rounded text-xs whitespace-nowrap",
                  "bg-popover border shadow-md",
                  "opacity-0 group-hover:opacity-100 transition-opacity",
                  "pointer-events-none z-10"
                )}
              >
                {step.label}
              </div>
            </button>

            {/* Connector line */}
            {idx < steps.length - 1 && (
              <div
                className={cn(
                  "w-6 md:w-8 h-0.5 transition-colors duration-300",
                  idx < currentStep ? "bg-primary" : "bg-muted-foreground/30"
                )}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

// ============================================
// Bar Variant
// ============================================

const BarProgress = ({
  steps,
  currentStep,
  className,
}: Omit<ProgressStepperProps, "onStepClick" | "variant">) => {
  const progress = ((currentStep + 1) / steps.length) * 100;

  return (
    <div className={cn("w-full", className)}>
      {/* Labels */}
      <div className="flex justify-between mb-2 px-1">
        <span className="text-xs text-muted-foreground">
          {currentStep + 1} / {steps.length}
        </span>
        <span className="text-xs font-medium text-foreground">
          {steps[currentStep]?.label}
        </span>
      </div>

      {/* Progress Bar */}
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-500 ease-out rounded-full"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};

// ============================================
// Steps Variant (Full labels)
// ============================================

const StepsProgress = ({
  steps,
  currentStep,
  onStepClick,
  className,
}: ProgressStepperProps) => {
  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center justify-between">
        {steps.map((step, idx) => {
          const isActive = idx === currentStep;
          const isCompleted = idx < currentStep;
          const Icon = step.icon;

          return (
            <React.Fragment key={step.id}>
              <button
                onClick={() => onStepClick?.(idx)}
                disabled={!onStepClick}
                className={cn(
                  "flex flex-col items-center gap-2 group",
                  onStepClick && "cursor-pointer",
                  !onStepClick && "cursor-default"
                )}
              >
                {/* Circle */}
                <div
                  className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center",
                    "border-2 transition-all duration-300",
                    isActive &&
                      "border-primary bg-primary text-primary-foreground scale-110",
                    isCompleted &&
                      "border-primary bg-primary/10 text-primary",
                    !isActive &&
                      !isCompleted &&
                      "border-muted-foreground/30 text-muted-foreground/50"
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    <Icon className="h-5 w-5" />
                  )}
                </div>

                {/* Label */}
                <span
                  className={cn(
                    "text-xs transition-colors duration-300 hidden md:block",
                    isActive && "text-foreground font-medium",
                    isCompleted && "text-primary",
                    !isActive && !isCompleted && "text-muted-foreground"
                  )}
                >
                  {step.label}
                </span>
                <span
                  className={cn(
                    "text-xs transition-colors duration-300 md:hidden",
                    isActive && "text-foreground font-medium",
                    isCompleted && "text-primary",
                    !isActive && !isCompleted && "text-muted-foreground"
                  )}
                >
                  {step.shortLabel || step.label}
                </span>
              </button>

              {/* Connector */}
              {idx < steps.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-2 transition-colors duration-300",
                    idx < currentStep ? "bg-primary" : "bg-muted-foreground/30"
                  )}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

// ============================================
// Slide Counter (Simple version)
// ============================================

interface SlideCounterProps {
  current: number;
  total: number;
  className?: string;
}

export const SlideCounter = ({ current, total, className }: SlideCounterProps) => {
  return (
    <div className={cn("flex items-center gap-2 text-sm", className)}>
      <span className="font-bold text-foreground">{current}</span>
      <span className="text-muted-foreground">/</span>
      <span className="text-muted-foreground">{total}</span>
    </div>
  );
};

// ============================================
// Navigation Controls
// ============================================

interface NavigationControlsProps {
  currentStep: number;
  totalSteps: number;
  onPrevious: () => void;
  onNext: () => void;
  canGoPrevious: boolean;
  canGoNext: boolean;
  className?: string;
}

export const NavigationControls = ({
  currentStep,
  totalSteps,
  onPrevious,
  onNext,
  canGoPrevious,
  canGoNext,
  className,
}: NavigationControlsProps) => {
  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      <button
        onClick={onPrevious}
        disabled={!canGoPrevious}
        className={cn(
          "px-4 py-2 rounded-lg text-sm font-medium transition-all",
          "border border-border",
          canGoPrevious
            ? "hover:bg-accent hover:text-accent-foreground"
            : "opacity-50 cursor-not-allowed"
        )}
      >
        ← 이전
      </button>

      <SlideCounter current={currentStep + 1} total={totalSteps} />

      <button
        onClick={onNext}
        disabled={!canGoNext}
        className={cn(
          "px-4 py-2 rounded-lg text-sm font-medium transition-all",
          "bg-primary text-primary-foreground",
          canGoNext
            ? "hover:bg-primary/90"
            : "opacity-50 cursor-not-allowed"
        )}
      >
        다음 →
      </button>
    </div>
  );
};

export default ProgressStepper;

```

---

## frontend/src/components/insight/index.ts

```ts
// Insight Card Components
export {
  InsightCardWrapper,
  IntroCard,
  ViewpointVSCard,
  TopicClusterCard,
  DataVisualizationCard,
  ConclusionCard,
  EvidenceDetailCard,
} from "./InsightCards";

// Progress Stepper Components
export {
  ProgressStepper,
  SlideCounter,
  NavigationControls,
  DEFAULT_INSIGHT_STEPS,
  type StepConfig,
} from "./ProgressStepper";

// InsightFlow (Main component)
export { InsightFlow, CompactInsightFlow } from "./InsightFlow";

```

---

## frontend/src/components/layout/AppLayout.tsx

```tsx
import { Link, useLocation } from 'react-router-dom';
import { Command, User, LogIn, LogOut } from 'lucide-react';
import { BackgroundTaskIndicator } from '@/components/BackgroundTaskIndicator';
import { ThemeToggle } from '@/components/ThemeToggle';
import { MobileNavDrawer } from '@/components/MobileNavDrawer';
import { NotificationBell } from '@/contexts/NotificationContext';
import { NewNavigation, MobileBottomNav } from './NewNavigation';
import { SetupBanner } from './SetupBanner';
import { QuickAccessButton } from './QuickAccessButton';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useAutoNotifications, useProjectNotifications } from '@/hooks/useNotificationBridge';
import { useAuth } from '@/contexts/AuthContext';
import { useSkipLinks } from '@/hooks/useAccessibility';

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const { isAuthenticated, user, logout, isLoading } = useAuth();
  const { SkipLink } = useSkipLinks();

  // SSE 이벤트를 NotificationContext에 자동 연결
  useAutoNotifications({
    enabled: true,
    // ERROR와 COLLECTION_COMPLETED 이벤트만 알림으로 표시 (너무 많은 알림 방지)
    enabledEventTypes: ['ERROR', 'COLLECTION_COMPLETED', 'COLLECTION_STARTED'],
    persistent: false, // 브라우저 새로고침 시 알림 삭제
    dedupeInterval: 10000, // 10초 내 동일 타입 알림 중복 방지
  });

  // 프로젝트 알림을 백엔드에서 가져와서 연결
  useProjectNotifications({
    userId: user?.id?.toString(),
    enabled: isAuthenticated && !!user,
    pollInterval: 60000, // 1분마다 새 알림 확인
  });

  const handleLogout = async () => {
    await logout();
    window.location.href = '/';
  };

  return (
    <div className="min-h-screen flex flex-col pb-16 md:pb-0">
      {/* Skip Links for Accessibility - visible only on keyboard focus */}
      <SkipLink targetId="main-content" text="본문으로 건너뛰기" />
      <SkipLink targetId="search-input" text="검색으로 건너뛰기" />
      
      {/* Setup Banner - Shows when admin setup is required */}
      <SetupBanner />

      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between px-4">
          {/* Mobile Nav & Logo */}
          <div className="flex items-center gap-2">
            {/* Mobile Navigation Drawer */}
            <MobileNavDrawer className="md:hidden" />
            
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2">
              <img 
                src="/initial_logo-v0.1.png" 
                alt="NewsInsight" 
                className="h-8 w-8"
                onError={(e) => {
                  // Fallback if logo doesn't exist
                  e.currentTarget.style.display = 'none';
                }}
              />
              <span className="font-bold text-lg hidden sm:inline bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                NewsInsight
              </span>
            </Link>
          </div>

          {/* New Navigation - Desktop */}
          <div className="hidden md:flex items-center flex-1 justify-center ml-6">
            <NewNavigation />
          </div>

          {/* Right side actions */}
          <div className="flex items-center gap-2">
            {/* Command Palette Hint - Desktop only */}
            <button
              className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-md border bg-muted/50 text-sm text-muted-foreground hover:bg-muted transition-colors"
              onClick={() => {
                // Trigger Command Palette (Ctrl+K)
                const event = new KeyboardEvent('keydown', {
                  key: 'k',
                  ctrlKey: true,
                  bubbles: true,
                });
                window.dispatchEvent(event);
              }}
              aria-label="검색 명령 팔레트 열기"
            >
              <Command className="h-3.5 w-3.5" />
              <span>검색...</span>
              <kbd className="ml-2 px-1.5 py-0.5 rounded bg-background text-[10px]">Ctrl+K</kbd>
            </button>
            
            {/* Quick Access Button */}
            <QuickAccessButton />
            
            {/* Notification Bell */}
            <NotificationBell />
            {/* Theme Toggle */}
            <ThemeToggle variant="dropdown" size="sm" />
            {/* Background Task Indicator */}
            <BackgroundTaskIndicator />
            
            {/* User Menu / Login Button */}
            {!isLoading && (
              isAuthenticated && user ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-2">
                      <User className="h-4 w-4" />
                      <span className="hidden sm:inline max-w-24 truncate">{user.username}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <div className="px-2 py-1.5 text-sm">
                      <div className="font-medium">{user.username}</div>
                      {user.email && (
                        <div className="text-xs text-muted-foreground truncate">{user.email}</div>
                      )}
                      <div className="text-xs text-muted-foreground capitalize mt-1">
                        {user.role === 'user' ? '일반 회원' : user.role}
                      </div>
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link to="/settings" className="cursor-pointer">
                        설정
                      </Link>
                    </DropdownMenuItem>
                    {(user.role === 'admin' || user.role === 'operator' || user.role === 'viewer') && (
                      <DropdownMenuItem asChild>
                        <Link to="/admin/environments" className="cursor-pointer">
                          관리자 페이지
                        </Link>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout} className="text-red-600 cursor-pointer">
                      <LogOut className="h-4 w-4 mr-2" />
                      로그아웃
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button variant="outline" size="sm" asChild className="gap-2">
                  <Link to="/login">
                    <LogIn className="h-4 w-4" />
                    <span className="hidden sm:inline">로그인</span>
                  </Link>
                </Button>
              )
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main id="main-content" className="flex-1" role="main" tabIndex={-1}>
        {children}
      </main>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav />

      {/* Footer - Hidden on mobile due to bottom nav */}
      <footer className="border-t py-4 mt-auto hidden md:block" role="contentinfo">
        <div className="container px-4 text-center text-sm text-muted-foreground">
          <p>NewsInsight - AI 기반 뉴스 분석 플랫폼</p>
          <p className="text-xs mt-1">
            <kbd className="px-1.5 py-0.5 rounded bg-muted mx-1">Ctrl+K</kbd>로 빠른 검색
          </p>
        </div>
      </footer>
    </div>
  );
}

export default AppLayout;

```

---

## frontend/src/components/layout/NewNavigation.tsx

```tsx
/**
 * NewNavigation - 새로운 5탭 네비게이션 컴포넌트
 * 
 * 구조:
 * 1. 홈 - 새 대시보드
 * 2. 대시보드 - 라이브 대시보드, 운영현황
 * 3. 도구 - 검색, ML Add-ons, 브라우저 에이전트
 * 4. 내 작업 - 프로젝트, 기록, URL 컬렉션
 * 5. 설정 - 환경설정, Admin
 */

import { Link, useLocation } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  Home,
  LayoutDashboard,
  Wrench,
  FolderKanban,
  Settings,
  Search,
  Bot,
  Cpu,
  Activity,
  Gauge,
  Database,
  History,
  FolderOpen,
  Globe,
  Brain,
  ChevronDown,
  Shield,
  Server,
  Terminal,
  FileText,
  Newspaper,
  Sparkles,
  Zap,
} from 'lucide-react';

interface SubMenuItem {
  to: string;
  icon: React.ReactNode;
  label: string;
  description?: string;
}

interface NavItem {
  id: string;
  icon: React.ReactNode;
  label: string;
  to?: string;
  subItems?: SubMenuItem[];
}

const navConfig: NavItem[] = [
  {
    id: 'home',
    icon: <Home className="h-4 w-4" />,
    label: '홈',
    to: '/',
  },
  {
    id: 'dashboard',
    icon: <LayoutDashboard className="h-4 w-4" />,
    label: '대시보드',
    subItems: [
      {
        to: '/dashboard',
        icon: <Activity className="h-4 w-4" />,
        label: '라이브 대시보드',
        description: '실시간 뉴스 현황'
      },
      {
        to: '/operations',
        icon: <Gauge className="h-4 w-4" />,
        label: '운영 현황',
        description: '시스템 모니터링'
      },
      {
        to: '/collected-data',
        icon: <Database className="h-4 w-4" />,
        label: '수집 데이터',
        description: '수집된 뉴스 데이터'
      },
    ],
  },
  {
    id: 'tools',
    icon: <Wrench className="h-4 w-4" />,
    label: '도구',
    to: '/tools', // 허브 페이지로 직접 이동 가능
    subItems: [
      {
        to: '/tools',
        icon: <Wrench className="h-4 w-4" />,
        label: '도구 허브',
        description: '모든 도구 보기'
      },
      {
        to: '/search',
        icon: <Search className="h-4 w-4" />,
        label: '스마트 검색',
        description: '통합 뉴스 검색'
      },
      {
        to: '/ml-addons',
        icon: <Cpu className="h-4 w-4" />,
        label: 'ML Add-ons',
        description: '편향성, 감정 분석'
      },
      {
        to: '/ml-results',
        icon: <Sparkles className="h-4 w-4" />,
        label: 'ML 분석 결과',
        description: '분석 결과 확인'
      },
      {
        to: '/ai-agent',
        icon: <Bot className="h-4 w-4" />,
        label: '브라우저 에이전트',
        description: 'AI 웹 자동화'
      },
      {
        to: '/ai-jobs',
        icon: <Brain className="h-4 w-4" />,
        label: 'AI Jobs',
        description: 'AI 작업 관리'
      },
    ],
  },
  {
    id: 'workspace',
    icon: <FolderKanban className="h-4 w-4" />,
    label: '내 작업',
    to: '/workspace', // 허브 페이지로 직접 이동 가능
    subItems: [
      {
        to: '/workspace',
        icon: <FolderKanban className="h-4 w-4" />,
        label: '작업 허브',
        description: '모든 작업 보기'
      },
      {
        to: '/projects',
        icon: <FolderOpen className="h-4 w-4" />,
        label: '프로젝트',
        description: '저장된 분석 프로젝트'
      },
      {
        to: '/history',
        icon: <History className="h-4 w-4" />,
        label: '검색 기록',
        description: '최근 검색 내역'
      },
      {
        to: '/url-collections',
        icon: <Globe className="h-4 w-4" />,
        label: 'URL 컬렉션',
        description: 'URL 원천 관리'
      },
    ],
  },
  {
    id: 'settings',
    icon: <Settings className="h-4 w-4" />,
    label: '설정',
    subItems: [
      {
        to: '/settings',
        icon: <Settings className="h-4 w-4" />,
        label: '환경 설정',
        description: '앱 설정'
      },
      {
        to: '/admin/sources',
        icon: <Newspaper className="h-4 w-4" />,
        label: '소스 관리',
        description: '뉴스 소스 관리'
      },
      {
        to: '/admin/environments',
        icon: <Server className="h-4 w-4" />,
        label: '환경 변수',
        description: '서버 환경 설정'
      },
      {
        to: '/admin/scripts',
        icon: <Terminal className="h-4 w-4" />,
        label: '스크립트',
        description: '자동화 스크립트'
      },
      {
        to: '/admin/audit-logs',
        icon: <FileText className="h-4 w-4" />,
        label: '감사 로그',
        description: '시스템 로그'
      },
      {
        to: '/admin/llm-providers',
        icon: <Zap className="h-4 w-4" />,
        label: 'LLM Providers',
        description: 'AI 제공자 설정'
      },
    ],
  },
];

interface DropdownMenuProps {
  items: SubMenuItem[];
  isOpen: boolean;
  onClose: () => void;
}

function DropdownMenu({ items, isOpen, onClose }: DropdownMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className="absolute top-full left-0 mt-1 w-64 bg-popover border rounded-lg shadow-lg py-2 z-50"
    >
      {items.map((item) => {
        const isActive = location.pathname === item.to;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onClose}
            className={cn(
              // Minimum 44px touch target height for accessibility
              "flex items-start gap-3 px-4 py-3 min-h-[44px] hover:bg-accent transition-colors",
              isActive && "bg-accent"
            )}
          >
            <span className={cn(
              "mt-0.5",
              isActive ? "text-primary" : "text-muted-foreground"
            )}>
              {item.icon}
            </span>
            <div className="flex-1 min-w-0">
              <div className={cn(
                "text-sm font-medium",
                isActive && "text-primary"
              )}>
                {item.label}
              </div>
              {item.description && (
                <div className="text-xs text-muted-foreground truncate">
                  {item.description}
                </div>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

interface NavButtonProps {
  item: NavItem;
  isActive: boolean;
}

function NavButton({ item, isActive }: NavButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Direct link (no submenu)
  if (item.to && !item.subItems) {
    return (
      <Link
        to={item.to}
        className={cn(
          // Minimum 44px touch target for accessibility
          "flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium transition-all",
          isActive
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground hover:bg-accent"
        )}
      >
        {item.icon}
        <span className="hidden lg:inline">{item.label}</span>
      </Link>
    );
  }

  // Dropdown menu
  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          // Minimum 44px touch target for accessibility
          "flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium transition-all",
          isActive
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground hover:bg-accent"
        )}
      >
        {item.icon}
        <span className="hidden lg:inline">{item.label}</span>
        <ChevronDown className={cn(
          "h-3 w-3 transition-transform hidden lg:block",
          isOpen && "rotate-180"
        )} />
      </button>
      {item.subItems && (
        <DropdownMenu
          items={item.subItems}
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}

export function NewNavigation() {
  const location = useLocation();

  const isNavActive = (item: NavItem): boolean => {
    if (item.to) {
      return location.pathname === item.to;
    }
    if (item.subItems) {
      return item.subItems.some(sub => location.pathname === sub.to);
    }
    return false;
  };

  return (
    <nav className="flex items-center gap-1" role="navigation" aria-label="주요 내비게이션">
      {navConfig.map((item) => (
        <NavButton
          key={item.id}
          item={item}
          isActive={isNavActive(item)}
        />
      ))}
    </nav>
  );
}

// Mobile Navigation - 하단 탭바 스타일
export function MobileBottomNav() {
  const location = useLocation();

  const mobileItems = navConfig.slice(0, 5); // 5탭만

  const isNavActive = (item: NavItem): boolean => {
    if (item.to) {
      return location.pathname === item.to;
    }
    if (item.subItems) {
      return item.subItems.some(sub => location.pathname === sub.to);
    }
    return false;
  };

  return (
    <nav 
      className="fixed bottom-0 left-0 right-0 bg-background border-t md:hidden z-50 safe-area-inset-bottom"
      role="navigation"
      aria-label="모바일 내비게이션"
    >
      <div className="flex items-center justify-around py-1 pb-safe">
        {mobileItems.map((item) => {
          const isActive = isNavActive(item);
          const to = item.to || item.subItems?.[0]?.to || '/';
          
          return (
            <Link
              key={item.id}
              to={to}
              className={cn(
                // Minimum 44x44px touch target for WCAG 2.1 AA compliance
                "flex flex-col items-center justify-center gap-1 min-w-[48px] min-h-[48px] px-3 py-2 rounded-lg transition-colors",
                // Active indicator with visual feedback
                isActive
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground active:bg-accent"
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <span className={cn(
                "flex items-center justify-center w-6 h-6",
                isActive && "scale-110 transition-transform"
              )}>
                {item.icon}
              </span>
              <span className="text-[10px] font-medium leading-tight">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default NewNavigation;

```

---

## frontend/src/components/layout/QuickAccessButton.tsx

```tsx
import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useQuickAccess } from '@/contexts/QuickAccessContext';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export const QuickAccessButton = () => {
  const { toggle } = useQuickAccess();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          className="relative"
        >
          <Zap className="h-5 w-5" />
          <span className="sr-only">빠른 접근</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>빠른 접근 (Ctrl+Shift+K)</p>
      </TooltipContent>
    </Tooltip>
  );
};

```

---

## frontend/src/components/layout/SetupBanner.tsx

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Settings, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { authApi } from '@/lib/adminApi';
import type { SetupStatus } from '@/types/admin';
import { cn } from '@/lib/utils';

const DISMISSED_KEY = 'newsinsight_setup_banner_dismissed';

export function SetupBanner() {
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if user has dismissed the banner for this session
    const dismissed = sessionStorage.getItem(DISMISSED_KEY);
    if (dismissed === 'true') {
      setIsDismissed(true);
      setIsLoading(false);
      return;
    }

    // Fetch setup status
    const checkSetup = async () => {
      try {
        const status = await authApi.getSetupStatus();
        setSetupStatus(status);
      } catch (error) {
        // API might not be available yet or setup endpoint doesn't exist
        console.debug('Setup status check failed:', error);
        setSetupStatus(null);
      } finally {
        setIsLoading(false);
      }
    };

    checkSetup();
  }, []);

  const handleDismiss = () => {
    setIsDismissed(true);
    sessionStorage.setItem(DISMISSED_KEY, 'true');
  };

  // Don't show banner if:
  // - Still loading
  // - Already dismissed
  // - No setup status available
  // - Setup is not required (admin already changed password)
  if (isLoading || isDismissed || !setupStatus || !setupStatus.setup_required) {
    return null;
  }

  // Only show if default admin is being used
  if (!setupStatus.is_default_admin) {
    return null;
  }

  return (
    <div
      className={cn(
        'relative bg-amber-500/10 border-b border-amber-500/30',
        'px-4 py-3'
      )}
      role="alert"
    >
      <div className="container flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
            <span className="font-medium text-amber-700 dark:text-amber-400">
              초기 설정이 필요합니다
            </span>
            <span className="text-sm text-muted-foreground">
              기본 관리자 계정(admin/admin123)을 사용 중입니다. 보안을 위해 비밀번호를 변경해주세요.
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            asChild
            size="sm"
            className="bg-amber-500 hover:bg-amber-600 text-white gap-2"
          >
            <Link to="/admin/login">
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">설정하기</span>
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={handleDismiss}
            aria-label="배너 닫기"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default SetupBanner;

```

---

## frontend/src/components/layout/Sidebar.tsx

```tsx
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Search,
  Globe,
  Settings,
  History,
  Newspaper,
  BookOpen,
  Bot,
  Layers,
  Shield,
  Server,
  Terminal,
  FileText,
  Activity,
  ChevronDown,
  Brain,
  Database,
  Gauge,
  CheckCircle,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";

type SidebarProps = React.HTMLAttributes<HTMLDivElement>;

export function Sidebar({ className }: SidebarProps) {
  const location = useLocation();
  const [isAdminOpen, setIsAdminOpen] = useState(location.pathname.startsWith('/admin'));

  const navItems = [
    {
      title: "Smart Search",
      href: "/",
      icon: Search,
      variant: "default",
    },
    {
      title: "Live Dashboard",
      href: "/dashboard",
      icon: Activity,
      variant: "ghost",
    },
    {
      title: "Operations",
      href: "/operations",
      icon: Gauge,
      variant: "ghost",
    },
    {
      title: "Projects",
      href: "/projects",
      icon: BookOpen,
      variant: "ghost",
    },
    {
      title: "History",
      href: "/history",
      icon: History,
      variant: "ghost",
    },
    {
      title: "URL Collections",
      href: "/url-collections",
      icon: Globe,
      variant: "ghost",
    },
    {
      title: "Browser Agent",
      href: "/ai-agent",
      icon: Bot,
      variant: "ghost",
    },
    {
      title: "ML Add-ons",
      href: "/ml-addons",
      icon: Layers,
      variant: "ghost",
    },
    {
      title: "Fact Check",
      href: "/factcheck",
      icon: CheckCircle,
      variant: "ghost",
    },
    {
      title: "AI Jobs",
      href: "/ai-jobs",
      icon: Brain,
      variant: "ghost",
    },
    {
      title: "Collected Data",
      href: "/collected-data",
      icon: Database,
      variant: "ghost",
    },
  ];

  const adminItems = [
    {
      title: "Sources",
      href: "/admin/sources",
      icon: Newspaper,
    },
    {
      title: "Environments",
      href: "/admin/environments",
      icon: Server,
    },
    {
      title: "Scripts",
      href: "/admin/scripts",
      icon: Terminal,
    },
    {
      title: "Audit Logs",
      href: "/admin/audit-logs",
      icon: FileText,
    },
    {
      title: "LLM Providers",
      href: "/admin/llm-providers",
      icon: Zap,
    },
  ];

  return (
    <div className={cn("pb-12 w-64 border-r bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60", className)}>
      <div className="space-y-4 py-4">
        <div className="px-3 py-2">
          <div className="flex items-center gap-2 px-4 mb-6">
            <LayoutDashboard className="h-6 w-6 text-primary" />
            <h2 className="text-lg font-bold tracking-tight">NewsInsight</h2>
          </div>
          <div className="space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "flex items-center rounded-md px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors",
                  location.pathname === item.href ? "bg-accent text-accent-foreground" : "transparent"
                )}
              >
                <item.icon className="mr-2 h-4 w-4" />
                {item.title}
              </Link>
            ))}
          </div>
        </div>
        
        <div className="px-3 py-2">
          <Collapsible open={isAdminOpen} onOpenChange={setIsAdminOpen} className="space-y-1">
            <div className="flex items-center justify-between px-4 py-2">
              <h2 className="text-sm font-semibold tracking-tight text-muted-foreground flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Admin
              </h2>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-6 h-6 p-0">
                  <ChevronDown className={cn("h-4 w-4 transition-transform", isAdminOpen ? "rotate-180" : "")} />
                  <span className="sr-only">Toggle Admin</span>
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="space-y-1">
              {adminItems.map((item) => (
                <Link
                  key={item.href}
                  to={item.href}
                  className={cn(
                    "flex items-center rounded-md px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors pl-8",
                    location.pathname === item.href ? "bg-accent text-accent-foreground" : "transparent"
                  )}
                >
                  <item.icon className="mr-2 h-4 w-4" />
                  {item.title}
                </Link>
              ))}
            </CollapsibleContent>
          </Collapsible>
        </div>

        <div className="px-3 py-2 mt-auto">
          <Link
            to="/settings"
            className={cn(
              "flex items-center rounded-md px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors",
              location.pathname === "/settings" ? "bg-accent text-accent-foreground" : "transparent"
            )}
          >
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Link>
        </div>
      </div>
    </div>
  );
}

```

---

## frontend/src/components/settings/UserLlmSettings.tsx

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  Bot,
  CheckCircle2,
  XCircle,
  Loader2,
  Zap,
  Save,
  Eye,
  EyeOff,
  Trash2,
  RefreshCw,
  Shield,
  User,
  AlertCircle,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import {
  getEffectiveLlmSettings,
  getUserLlmSettings,
  saveUserLlmSetting,
  deleteUserLlmSetting,
  deleteAllUserLlmSettings,
  testUserLlmConnection,
  getLlmProviderTypes,
} from '@/lib/api';
import type {
  LlmProviderType,
  LlmProviderSettings,
  LlmProviderSettingsRequest,
  LlmProviderTypeInfo,
  LlmTestResult,
} from '@/types/api';

interface UserLlmSettingsProps {
  userId: string;
}

const DEFAULT_MODELS: Record<LlmProviderType, string[]> = {
  // OpenAI - 2025년 12월 최신 (GPT-5 시리즈 출시)
  OPENAI: [
    'gpt-5', 'gpt-5-mini', 'gpt-5-nano',           // Frontier 모델
    'gpt-4.1', 'gpt-4.1-mini',                      // 고급 모델
    'o3', 'o3-mini', 'o3-pro', 'o4-mini',          // 추론 모델
    'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo',        // 기존 모델
  ],
  // Anthropic Claude - 2025년 12월 최신 (Claude 4 시리즈)
  ANTHROPIC: [
    'claude-sonnet-4-20250514',                    // 추천, 성능-가격 최적
    'claude-opus-4-20250514',                      // 가장 강력
    'claude-haiku-4-20250514',                     // 경량, 빠른 응답
    'claude-3-5-sonnet-20241022',                  // 이전 버전 호환
    'claude-3-5-haiku-20241022',
  ],
  // Google Gemini - 2025년 12월 최신 (Gemini 3 시리즈)
  GOOGLE: [
    'gemini-3-pro-preview',                        // 최고 지능, 멀티모달
    'gemini-3-flash-preview',                      // Pro 수준, Flash 속도
    'gemini-2.5-pro',                              // 씽킹 모델, 복잡 추론
    'gemini-2.5-flash',                            // 최고 가격-성능비
    'gemini-2.5-flash-lite',                       // 비용 최적화
    'gemini-2.0-flash',                            // 워크홀스
  ],
  // OpenRouter - 다양한 공급자 모델 통합 (무료 모델 포함)
  OPENROUTER: [
    // 무료 모델 (Free)
    'google/gemini-2.0-flash-exp:free',
    'google/gemini-exp-1206:free',
    'meta-llama/llama-3.2-3b-instruct:free',
    'meta-llama/llama-3.1-8b-instruct:free',
    'microsoft/phi-3-mini-128k-instruct:free',
    'mistralai/mistral-7b-instruct:free',
    'openchat/openchat-7b:free',
    'huggingfaceh4/zephyr-7b-beta:free',
    'qwen/qwen-2-7b-instruct:free',
    'nousresearch/hermes-3-llama-3.1-405b:free',
    // 유료 모델
    'openai/gpt-5', 'openai/gpt-4o',
    'anthropic/claude-sonnet-4', 'anthropic/claude-3.5-haiku',
    'google/gemini-2.5-pro', 'google/gemini-3-pro',
    'meta-llama/llama-3.1-405b-instruct',
    'mistralai/mistral-large-2411',
    'qwen/qwen-max',
    'deepseek/deepseek-r1',
  ],
  // Ollama - 로컬 실행 모델
  OLLAMA: [
    'llama3.2',                                    // Meta Llama 3.2
    'mistral',                                     // Mistral AI
    'neural-chat',                                 // Intel
    'deepseek-r1',                                 // DeepSeek R1
    'smollm2',                                     // 경량 모델
    'mixtral', 'codellama',
  ],
  // Azure OpenAI - 배포된 모델만 사용 가능
  AZURE_OPENAI: [
    'gpt-5', 'gpt-4o', 'gpt-4-turbo', 'gpt-35-turbo',
  ],
  // Together AI - DeepSeek 및 오픈소스 모델
  TOGETHER_AI: [
    'deepseek-ai/DeepSeek-R1-Distill-Llama-70B',  // 추론 능력 70B
    'deepseek-ai/DeepSeek-V3',                    // DeepSeek V3
    'meta-llama/Llama-3.1-405B-Instruct-Turbo',
    'mistralai/Mixtral-8x22B-Instruct-v0.1',
  ],
  CUSTOM: ['default'],
};

/**
 * 사용자 LLM Provider 설정 컴포넌트
 * 
 * - 사용자 개인 설정이 있으면 해당 설정 표시
 * - 없으면 관리자 전역 설정 표시 (읽기 전용)
 * - 사용자는 자신만의 설정을 추가/수정/삭제 가능
 */
export const UserLlmSettings: React.FC<UserLlmSettingsProps> = ({ userId }) => {
  const { toast } = useToast();

  // State
  const [providerTypes, setProviderTypes] = useState<LlmProviderTypeInfo[]>([]);
  const [effectiveSettings, setEffectiveSettings] = useState<LlmProviderSettings[]>([]);
  const [userSettings, setUserSettings] = useState<LlmProviderSettings[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, LlmTestResult>>({});
  const [testingProvider, setTestingProvider] = useState<string | null>(null);

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<LlmProviderType | null>(null);
  const [editForm, setEditForm] = useState<LlmProviderSettingsRequest>({
    providerType: 'OPENAI',
    apiKey: '',
    defaultModel: '',
    baseUrl: '',
    enabled: true,
    priority: 100,
    maxTokens: 4096,
    temperature: 0.7,
    timeoutMs: 60000,
  });

  // Load data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [types, effective, user] = await Promise.all([
        getLlmProviderTypes(),
        getEffectiveLlmSettings(userId),
        getUserLlmSettings(userId),
      ]);
      setProviderTypes(types);
      setEffectiveSettings(effective);
      setUserSettings(user);
    } catch (error) {
      console.error('Failed to load LLM settings:', error);
      toast({
        title: '로드 실패',
        description: 'LLM 설정을 불러오는데 실패했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [userId, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Check if provider has user override
  const hasUserOverride = (providerType: LlmProviderType): boolean => {
    return userSettings.some(s => s.providerType === providerType);
  };

  // Get effective setting for provider
  const getEffectiveSetting = (providerType: LlmProviderType): LlmProviderSettings | undefined => {
    return effectiveSettings.find(s => s.providerType === providerType);
  };

  // Open edit dialog
  const openEditDialog = (providerType: LlmProviderType) => {
    const existing = userSettings.find(s => s.providerType === providerType);
    const effective = getEffectiveSetting(providerType);
    
    setEditingProvider(providerType);
    setEditForm({
      providerType,
      apiKey: '', // Always empty for security
      defaultModel: existing?.defaultModel || effective?.defaultModel || DEFAULT_MODELS[providerType][0],
      baseUrl: existing?.baseUrl || effective?.baseUrl || '',
      enabled: existing?.enabled ?? effective?.enabled ?? true,
      priority: existing?.priority ?? effective?.priority ?? 100,
      maxTokens: existing?.maxTokens ?? effective?.maxTokens ?? 4096,
      temperature: existing?.temperature ?? effective?.temperature ?? 0.7,
      timeoutMs: existing?.timeoutMs ?? effective?.timeoutMs ?? 60000,
      azureDeploymentName: existing?.azureDeploymentName || effective?.azureDeploymentName || '',
      azureApiVersion: existing?.azureApiVersion || effective?.azureApiVersion || '2024-02-01',
    });
    setEditDialogOpen(true);
  };

  // Save user setting
  const handleSave = async () => {
    if (!editingProvider) return;

    setIsSaving(true);
    try {
      await saveUserLlmSetting(userId, editForm);
      toast({
        title: '저장 완료',
        description: `${editingProvider} 설정이 저장되었습니다.`,
      });
      setEditDialogOpen(false);
      loadData();
    } catch (error) {
      console.error('Failed to save LLM setting:', error);
      toast({
        title: '저장 실패',
        description: '설정 저장에 실패했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Delete user setting (fallback to global)
  const handleDelete = async (providerType: LlmProviderType) => {
    try {
      await deleteUserLlmSetting(userId, providerType);
      toast({
        title: '삭제 완료',
        description: '개인 설정이 삭제되었습니다. 전역 설정으로 돌아갑니다.',
      });
      loadData();
    } catch (error) {
      console.error('Failed to delete LLM setting:', error);
      toast({
        title: '삭제 실패',
        description: '설정 삭제에 실패했습니다.',
        variant: 'destructive',
      });
    }
  };

  // Delete all user settings
  const handleDeleteAll = async () => {
    try {
      await deleteAllUserLlmSettings(userId);
      toast({
        title: '전체 삭제 완료',
        description: '모든 개인 설정이 삭제되었습니다.',
      });
      loadData();
    } catch (error) {
      console.error('Failed to delete all LLM settings:', error);
      toast({
        title: '삭제 실패',
        description: '설정 삭제에 실패했습니다.',
        variant: 'destructive',
      });
    }
  };

  // Test connection
  const handleTestConnection = async (providerType: LlmProviderType) => {
    setTestingProvider(providerType);
    try {
      const setting = getEffectiveSetting(providerType);
      if (!setting) {
        throw new Error('No settings found for this provider');
      }

      // Use the correct test endpoint based on whether this is a saved setting
      // testUserLlmConnection uses the stored API key from the database
      const result = await testUserLlmConnection(setting.id);

      setTestResults(prev => ({ ...prev, [providerType]: result }));

      toast({
        title: result.success ? '연결 성공' : '연결 실패',
        description: result.message,
        variant: result.success ? 'default' : 'destructive',
      });
    } catch (error) {
      console.error('Connection test failed:', error);
      toast({
        title: '테스트 실패',
        description: '연결 테스트 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setTestingProvider(null);
    }
  };

  // Toggle API key visibility
  const toggleKeyVisibility = (provider: string) => {
    setShowApiKeys(prev => ({ ...prev, [provider]: !prev[provider] }));
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                LLM 제공자 설정
              </CardTitle>
              <CardDescription>
                AI 분석에 사용할 LLM 제공자를 설정합니다. 개인 설정이 없으면 관리자 전역 설정이 적용됩니다.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={loadData}>
                <RefreshCw className="h-4 w-4 mr-2" />
                새로고침
              </Button>
              {userSettings.length > 0 && (
                <Button variant="destructive" size="sm" onClick={handleDeleteAll}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  전체 초기화
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Info Alert */}
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <Shield className="h-4 w-4 inline mr-1" /> 아이콘은 관리자 전역 설정, 
          <User className="h-4 w-4 inline mx-1" /> 아이콘은 개인 설정을 나타냅니다.
          개인 설정이 없는 경우 전역 설정이 자동으로 적용됩니다.
        </AlertDescription>
      </Alert>

      {/* Provider List */}
      <div className="grid gap-4">
        {providerTypes.map((type) => {
          const setting = getEffectiveSetting(type.value);
          const isUserSetting = hasUserOverride(type.value);
          const testResult = testResults[type.value];

          return (
            <Card key={type.value} className={!setting?.enabled ? 'opacity-60' : ''}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* Provider Icon/Badge */}
                    <div className="flex items-center gap-2">
                      {isUserSetting ? (
                        <Badge variant="default" className="gap-1">
                          <User className="h-3 w-3" />
                          개인
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1">
                          <Shield className="h-3 w-3" />
                          전역
                        </Badge>
                      )}
                    </div>

                    {/* Provider Info */}
                    <div>
                      <h3 className="font-semibold">{type.displayName}</h3>
                      <p className="text-sm text-muted-foreground">
                        모델: {setting?.defaultModel || '미설정'}
                      </p>
                    </div>
                  </div>

                  {/* Status & Actions */}
                  <div className="flex items-center gap-3">
                    {/* API Key Status */}
                    {setting && (
                      <div className="flex items-center gap-2 text-sm">
                        {setting.hasApiKey ? (
                          <Badge variant="outline" className="text-green-600">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            API 키 설정됨
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-yellow-600">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            API 키 없음
                          </Badge>
                        )}
                      </div>
                    )}

                    {/* Test Result */}
                    {testResult && (
                      <Badge variant={testResult.success ? 'default' : 'destructive'}>
                        {testResult.success ? (
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                        ) : (
                          <XCircle className="h-3 w-3 mr-1" />
                        )}
                        {testResult.success ? '연결됨' : '실패'}
                      </Badge>
                    )}

                    {/* Enabled Status */}
                    <Badge variant={setting?.enabled ? 'default' : 'secondary'}>
                      {setting?.enabled ? '활성화' : '비활성화'}
                    </Badge>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTestConnection(type.value)}
                        disabled={testingProvider === type.value || !setting?.hasApiKey}
                      >
                        {testingProvider === type.value ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Zap className="h-4 w-4" />
                        )}
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditDialog(type.value)}
                      >
                        설정
                      </Button>

                      {isUserSetting && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(type.value)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingProvider} 설정
            </DialogTitle>
            <DialogDescription>
              개인 LLM 설정을 입력하세요. 빈 값은 전역 설정을 사용합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* API Key */}
            <div className="space-y-2">
              <Label htmlFor="apiKey">API 키</Label>
              <div className="flex gap-2">
                <Input
                  id="apiKey"
                  type={showApiKeys['edit'] ? 'text' : 'password'}
                  value={editForm.apiKey || ''}
                  onChange={(e) => setEditForm(prev => ({ ...prev, apiKey: e.target.value }))}
                  placeholder="새 API 키 입력 (비우면 기존 값 유지)"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => toggleKeyVisibility('edit')}
                >
                  {showApiKeys['edit'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* Model */}
            <div className="space-y-2">
              <Label htmlFor="model">모델</Label>
              <Select
                value={editForm.defaultModel}
                onValueChange={(value) => setEditForm(prev => ({ ...prev, defaultModel: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="모델 선택" />
                </SelectTrigger>
                <SelectContent>
                  {editingProvider && DEFAULT_MODELS[editingProvider]?.map((model) => (
                    <SelectItem key={model} value={model}>{model}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Base URL (for Ollama/Custom) */}
            {(editingProvider === 'OLLAMA' || editingProvider === 'CUSTOM') && (
              <div className="space-y-2">
                <Label htmlFor="baseUrl">Base URL</Label>
                <Input
                  id="baseUrl"
                  value={editForm.baseUrl || ''}
                  onChange={(e) => setEditForm(prev => ({ ...prev, baseUrl: e.target.value }))}
                  placeholder={editingProvider === 'OLLAMA' ? 'http://localhost:11434' : 'https://api.example.com'}
                />
              </div>
            )}

            {/* Azure specific fields */}
            {editingProvider === 'AZURE_OPENAI' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="azureEndpoint">Azure Endpoint</Label>
                  <Input
                    id="azureEndpoint"
                    value={editForm.baseUrl || ''}
                    onChange={(e) => setEditForm(prev => ({ ...prev, baseUrl: e.target.value }))}
                    placeholder="https://your-resource.openai.azure.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="azureDeploymentName">Deployment Name</Label>
                  <Input
                    id="azureDeploymentName"
                    value={editForm.azureDeploymentName || ''}
                    onChange={(e) => setEditForm(prev => ({ ...prev, azureDeploymentName: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="azureApiVersion">API Version</Label>
                  <Input
                    id="azureApiVersion"
                    value={editForm.azureApiVersion || ''}
                    onChange={(e) => setEditForm(prev => ({ ...prev, azureApiVersion: e.target.value }))}
                    placeholder="2024-02-01"
                  />
                </div>
              </>
            )}

            <Separator />

            {/* Advanced Settings */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="priority">우선순위</Label>
                <Input
                  id="priority"
                  type="number"
                  min={1}
                  max={999}
                  value={editForm.priority}
                  onChange={(e) => setEditForm(prev => ({ ...prev, priority: parseInt(e.target.value) }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxTokens">최대 토큰</Label>
                <Input
                  id="maxTokens"
                  type="number"
                  min={1}
                  max={128000}
                  value={editForm.maxTokens}
                  onChange={(e) => setEditForm(prev => ({ ...prev, maxTokens: parseInt(e.target.value) }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="temperature">Temperature</Label>
                <Input
                  id="temperature"
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={editForm.temperature}
                  onChange={(e) => setEditForm(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="timeoutMs">타임아웃 (ms)</Label>
                <Input
                  id="timeoutMs"
                  type="number"
                  min={1000}
                  max={300000}
                  value={editForm.timeoutMs}
                  onChange={(e) => setEditForm(prev => ({ ...prev, timeoutMs: parseInt(e.target.value) }))}
                />
              </div>
            </div>

            {/* Enabled Toggle */}
            <div className="flex items-center justify-between">
              <Label htmlFor="enabled">활성화</Label>
              <Switch
                id="enabled"
                checked={editForm.enabled}
                onCheckedChange={(checked) => setEditForm(prev => ({ ...prev, enabled: checked }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              취소
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserLlmSettings;

```

---

## frontend/src/components/ui/accordion.tsx

```tsx
import * as React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

const Accordion = AccordionPrimitive.Root;

const AccordionItem = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>
>(({ className, ...props }, ref) => (
  <AccordionPrimitive.Item ref={ref} className={cn("border-b", className)} {...props} />
));
AccordionItem.displayName = "AccordionItem";

const AccordionTrigger = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Header className="flex">
    <AccordionPrimitive.Trigger
      ref={ref}
      className={cn(
        "flex flex-1 items-center justify-between py-4 font-medium transition-all hover:underline [&[data-state=open]>svg]:rotate-180",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200" />
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
));
AccordionTrigger.displayName = AccordionPrimitive.Trigger.displayName;

const AccordionContent = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Content
    ref={ref}
    className="overflow-hidden text-sm transition-all data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
    {...props}
  >
    <div className={cn("pb-4 pt-0", className)}>{children}</div>
  </AccordionPrimitive.Content>
));

AccordionContent.displayName = AccordionPrimitive.Content.displayName;

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };

```

---

## frontend/src/components/ui/alert-dialog.tsx

```tsx
import * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

const AlertDialog = AlertDialogPrimitive.Root;

const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

const AlertDialogPortal = AlertDialogPrimitive.Portal;

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
    ref={ref}
  />
));
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, ...props }, ref) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className,
      )}
      {...props}
    />
  </AlertDialogPortal>
));
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />
);
AlertDialogHeader.displayName = "AlertDialogHeader";

const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
AlertDialogFooter.displayName = "AlertDialogFooter";

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold", className)} {...props} />
));
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName;

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action ref={ref} className={cn(buttonVariants(), className)} {...props} />
));
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName;

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(buttonVariants({ variant: "outline" }), "mt-2 sm:mt-0", className)}
    {...props}
  />
));
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};

```

---

## frontend/src/components/ui/alert.tsx

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative w-full rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        destructive: "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5 ref={ref} className={cn("mb-1 font-medium leading-none tracking-tight", className)} {...props} />
  ),
);
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("text-sm [&_p]:leading-relaxed", className)} {...props} />
  ),
);
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };

```

---

## frontend/src/components/ui/aspect-ratio.tsx

```tsx
import * as AspectRatioPrimitive from "@radix-ui/react-aspect-ratio";

const AspectRatio = AspectRatioPrimitive.Root;

export { AspectRatio };

```

---

## frontend/src/components/ui/avatar.tsx

```tsx
import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";

import { cn } from "@/lib/utils";

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn("relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full", className)}
    {...props}
  />
));
Avatar.displayName = AvatarPrimitive.Root.displayName;

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image ref={ref} className={cn("aspect-square h-full w-full", className)} {...props} />
));
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn("flex h-full w-full items-center justify-center rounded-full bg-muted", className)}
    {...props}
  />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

export { Avatar, AvatarImage, AvatarFallback };

```

---

## frontend/src/components/ui/badge.tsx

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

```

---

## frontend/src/components/ui/breadcrumb.tsx

```tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { ChevronRight, MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";

const Breadcrumb = React.forwardRef<
  HTMLElement,
  React.ComponentPropsWithoutRef<"nav"> & {
    separator?: React.ReactNode;
  }
>(({ ...props }, ref) => <nav ref={ref} aria-label="breadcrumb" {...props} />);
Breadcrumb.displayName = "Breadcrumb";

const BreadcrumbList = React.forwardRef<HTMLOListElement, React.ComponentPropsWithoutRef<"ol">>(
  ({ className, ...props }, ref) => (
    <ol
      ref={ref}
      className={cn(
        "flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2.5",
        className,
      )}
      {...props}
    />
  ),
);
BreadcrumbList.displayName = "BreadcrumbList";

const BreadcrumbItem = React.forwardRef<HTMLLIElement, React.ComponentPropsWithoutRef<"li">>(
  ({ className, ...props }, ref) => (
    <li ref={ref} className={cn("inline-flex items-center gap-1.5", className)} {...props} />
  ),
);
BreadcrumbItem.displayName = "BreadcrumbItem";

const BreadcrumbLink = React.forwardRef<
  HTMLAnchorElement,
  React.ComponentPropsWithoutRef<"a"> & {
    asChild?: boolean;
  }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "a";

  return <Comp ref={ref} className={cn("transition-colors hover:text-foreground", className)} {...props} />;
});
BreadcrumbLink.displayName = "BreadcrumbLink";

const BreadcrumbPage = React.forwardRef<HTMLSpanElement, React.ComponentPropsWithoutRef<"span">>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      role="link"
      aria-disabled="true"
      aria-current="page"
      className={cn("font-normal text-foreground", className)}
      {...props}
    />
  ),
);
BreadcrumbPage.displayName = "BreadcrumbPage";

const BreadcrumbSeparator = ({ children, className, ...props }: React.ComponentProps<"li">) => (
  <li role="presentation" aria-hidden="true" className={cn("[&>svg]:size-3.5", className)} {...props}>
    {children ?? <ChevronRight />}
  </li>
);
BreadcrumbSeparator.displayName = "BreadcrumbSeparator";

const BreadcrumbEllipsis = ({ className, ...props }: React.ComponentProps<"span">) => (
  <span
    role="presentation"
    aria-hidden="true"
    className={cn("flex h-9 w-9 items-center justify-center", className)}
    {...props}
  >
    <MoreHorizontal className="h-4 w-4" />
    <span className="sr-only">More</span>
  </span>
);
BreadcrumbEllipsis.displayName = "BreadcrumbElipssis";

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
};

```

---

## frontend/src/components/ui/button.tsx

```tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        gradient: "gradient-primary text-primary-foreground hover:opacity-90 shadow-md",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

```

---

## frontend/src/components/ui/calendar.tsx

```tsx
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-medium",
        nav: "space-x-1 flex items-center",
        nav_button: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100",
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse space-y-1",
        head_row: "flex",
        head_cell: "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
        row: "flex w-full mt-2",
        cell: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
        day: cn(buttonVariants({ variant: "ghost" }), "h-9 w-9 p-0 font-normal aria-selected:opacity-100"),
        day_range_end: "day-range-end",
        day_selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        day_today: "bg-accent text-accent-foreground",
        day_outside:
          "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
        day_disabled: "text-muted-foreground opacity-50",
        day_range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: ({ ..._props }) => <ChevronLeft className="h-4 w-4" />,
        IconRight: ({ ..._props }) => <ChevronRight className="h-4 w-4" />,
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };

```

---

## frontend/src/components/ui/card.tsx

```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)} {...props} />
));
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-2xl font-semibold leading-none tracking-tight", className)} {...props} />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />,
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };

```

---

## frontend/src/components/ui/carousel.tsx

```tsx
import * as React from "react";
import useEmblaCarousel, { type UseEmblaCarouselType } from "embla-carousel-react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type CarouselApi = UseEmblaCarouselType[1];
type UseCarouselParameters = Parameters<typeof useEmblaCarousel>;
type CarouselOptions = UseCarouselParameters[0];
type CarouselPlugin = UseCarouselParameters[1];

type CarouselProps = {
  opts?: CarouselOptions;
  plugins?: CarouselPlugin;
  orientation?: "horizontal" | "vertical";
  setApi?: (api: CarouselApi) => void;
};

type CarouselContextProps = {
  carouselRef: ReturnType<typeof useEmblaCarousel>[0];
  api: ReturnType<typeof useEmblaCarousel>[1];
  scrollPrev: () => void;
  scrollNext: () => void;
  canScrollPrev: boolean;
  canScrollNext: boolean;
} & CarouselProps;

const CarouselContext = React.createContext<CarouselContextProps | null>(null);

function useCarousel() {
  const context = React.useContext(CarouselContext);

  if (!context) {
    throw new Error("useCarousel must be used within a <Carousel />");
  }

  return context;
}

const Carousel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & CarouselProps>(
  ({ orientation = "horizontal", opts, setApi, plugins, className, children, ...props }, ref) => {
    const [carouselRef, api] = useEmblaCarousel(
      {
        ...opts,
        axis: orientation === "horizontal" ? "x" : "y",
      },
      plugins,
    );
    const [canScrollPrev, setCanScrollPrev] = React.useState(false);
    const [canScrollNext, setCanScrollNext] = React.useState(false);

    const onSelect = React.useCallback((api: CarouselApi) => {
      if (!api) {
        return;
      }

      setCanScrollPrev(api.canScrollPrev());
      setCanScrollNext(api.canScrollNext());
    }, []);

    const scrollPrev = React.useCallback(() => {
      api?.scrollPrev();
    }, [api]);

    const scrollNext = React.useCallback(() => {
      api?.scrollNext();
    }, [api]);

    const handleKeyDown = React.useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          scrollPrev();
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          scrollNext();
        }
      },
      [scrollPrev, scrollNext],
    );

    React.useEffect(() => {
      if (!api || !setApi) {
        return;
      }

      setApi(api);
    }, [api, setApi]);

    React.useEffect(() => {
      if (!api) {
        return;
      }

      onSelect(api);
      api.on("reInit", onSelect);
      api.on("select", onSelect);

      return () => {
        api?.off("select", onSelect);
      };
    }, [api, onSelect]);

    return (
      <CarouselContext.Provider
        value={{
          carouselRef,
          api: api,
          opts,
          orientation: orientation || (opts?.axis === "y" ? "vertical" : "horizontal"),
          scrollPrev,
          scrollNext,
          canScrollPrev,
          canScrollNext,
        }}
      >
        <div
          ref={ref}
          onKeyDownCapture={handleKeyDown}
          className={cn("relative", className)}
          role="region"
          aria-roledescription="carousel"
          {...props}
        >
          {children}
        </div>
      </CarouselContext.Provider>
    );
  },
);
Carousel.displayName = "Carousel";

const CarouselContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const { carouselRef, orientation } = useCarousel();

    return (
      <div ref={carouselRef} className="overflow-hidden">
        <div
          ref={ref}
          className={cn("flex", orientation === "horizontal" ? "-ml-4" : "-mt-4 flex-col", className)}
          {...props}
        />
      </div>
    );
  },
);
CarouselContent.displayName = "CarouselContent";

const CarouselItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const { orientation } = useCarousel();

    return (
      <div
        ref={ref}
        role="group"
        aria-roledescription="slide"
        className={cn("min-w-0 shrink-0 grow-0 basis-full", orientation === "horizontal" ? "pl-4" : "pt-4", className)}
        {...props}
      />
    );
  },
);
CarouselItem.displayName = "CarouselItem";

const CarouselPrevious = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof Button>>(
  ({ className, variant = "outline", size = "icon", ...props }, ref) => {
    const { orientation, scrollPrev, canScrollPrev } = useCarousel();

    return (
      <Button
        ref={ref}
        variant={variant}
        size={size}
        className={cn(
          "absolute h-8 w-8 rounded-full",
          orientation === "horizontal"
            ? "-left-12 top-1/2 -translate-y-1/2"
            : "-top-12 left-1/2 -translate-x-1/2 rotate-90",
          className,
        )}
        disabled={!canScrollPrev}
        onClick={scrollPrev}
        {...props}
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="sr-only">Previous slide</span>
      </Button>
    );
  },
);
CarouselPrevious.displayName = "CarouselPrevious";

const CarouselNext = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof Button>>(
  ({ className, variant = "outline", size = "icon", ...props }, ref) => {
    const { orientation, scrollNext, canScrollNext } = useCarousel();

    return (
      <Button
        ref={ref}
        variant={variant}
        size={size}
        className={cn(
          "absolute h-8 w-8 rounded-full",
          orientation === "horizontal"
            ? "-right-12 top-1/2 -translate-y-1/2"
            : "-bottom-12 left-1/2 -translate-x-1/2 rotate-90",
          className,
        )}
        disabled={!canScrollNext}
        onClick={scrollNext}
        {...props}
      >
        <ArrowRight className="h-4 w-4" />
        <span className="sr-only">Next slide</span>
      </Button>
    );
  },
);
CarouselNext.displayName = "CarouselNext";

export { type CarouselApi, Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext };

```

---

## frontend/src/components/ui/chart.tsx

```tsx
import * as React from "react";
import * as RechartsPrimitive from "recharts";

import { cn } from "@/lib/utils";

// Format: { THEME_NAME: CSS_SELECTOR }
const THEMES = { light: "", dark: ".dark" } as const;

export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode;
    icon?: React.ComponentType;
  } & ({ color?: string; theme?: never } | { color?: never; theme: Record<keyof typeof THEMES, string> });
};

type ChartContextProps = {
  config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);

  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />");
  }

  return context;
}

const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    config: ChartConfig;
    children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
  }
>(({ id, className, children, config, ...props }, ref) => {
  const uniqueId = React.useId();
  const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart={chartId}
        ref={ref}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-none [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-sector]:outline-none [&_.recharts-surface]:outline-none",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
});
ChartContainer.displayName = "Chart";

const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  const colorConfig = Object.entries(config).filter(([_, config]) => config.theme || config.color);

  if (!colorConfig.length) {
    return null;
  }

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(
            ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
  .map(([key, itemConfig]) => {
    const color = itemConfig.theme?.[theme as keyof typeof itemConfig.theme] || itemConfig.color;
    return color ? `  --color-${key}: ${color};` : null;
  })
  .join("\n")}
}
`,
          )
          .join("\n"),
      }}
    />
  );
};

const ChartTooltip = RechartsPrimitive.Tooltip;

const ChartTooltipContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof RechartsPrimitive.Tooltip> &
    React.ComponentProps<"div"> & {
      hideLabel?: boolean;
      hideIndicator?: boolean;
      indicator?: "line" | "dot" | "dashed";
      nameKey?: string;
      labelKey?: string;
    }
>(
  (
    {
      active,
      payload,
      className,
      indicator = "dot",
      hideLabel = false,
      hideIndicator = false,
      label,
      labelFormatter,
      labelClassName,
      formatter,
      color,
      nameKey,
      labelKey,
    },
    ref,
  ) => {
    const { config } = useChart();

    const tooltipLabel = React.useMemo(() => {
      if (hideLabel || !payload?.length) {
        return null;
      }

      const [item] = payload;
      const key = `${labelKey || item.dataKey || item.name || "value"}`;
      const itemConfig = getPayloadConfigFromPayload(config, item, key);
      const value =
        !labelKey && typeof label === "string"
          ? config[label as keyof typeof config]?.label || label
          : itemConfig?.label;

      if (labelFormatter) {
        return <div className={cn("font-medium", labelClassName)}>{labelFormatter(value, payload)}</div>;
      }

      if (!value) {
        return null;
      }

      return <div className={cn("font-medium", labelClassName)}>{value}</div>;
    }, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey]);

    if (!active || !payload?.length) {
      return null;
    }

    const nestLabel = payload.length === 1 && indicator !== "dot";

    return (
      <div
        ref={ref}
        className={cn(
          "grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl",
          className,
        )}
      >
        {!nestLabel ? tooltipLabel : null}
        <div className="grid gap-1.5">
          {payload.map((item, index) => {
            const key = `${nameKey || item.name || item.dataKey || "value"}`;
            const itemConfig = getPayloadConfigFromPayload(config, item, key);
            const indicatorColor = color || item.payload.fill || item.color;

            return (
              <div
                key={item.dataKey}
                className={cn(
                  "flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground",
                  indicator === "dot" && "items-center",
                )}
              >
                {formatter && item?.value !== undefined && item.name ? (
                  formatter(item.value, item.name, item, index, item.payload)
                ) : (
                  <>
                    {itemConfig?.icon ? (
                      <itemConfig.icon />
                    ) : (
                      !hideIndicator && (
                        <div
                          className={cn("shrink-0 rounded-[2px] border-[--color-border] bg-[--color-bg]", {
                            "h-2.5 w-2.5": indicator === "dot",
                            "w-1": indicator === "line",
                            "w-0 border-[1.5px] border-dashed bg-transparent": indicator === "dashed",
                            "my-0.5": nestLabel && indicator === "dashed",
                          })}
                          style={
                            {
                              "--color-bg": indicatorColor,
                              "--color-border": indicatorColor,
                            } as React.CSSProperties
                          }
                        />
                      )
                    )}
                    <div
                      className={cn(
                        "flex flex-1 justify-between leading-none",
                        nestLabel ? "items-end" : "items-center",
                      )}
                    >
                      <div className="grid gap-1.5">
                        {nestLabel ? tooltipLabel : null}
                        <span className="text-muted-foreground">{itemConfig?.label || item.name}</span>
                      </div>
                      {item.value && (
                        <span className="font-mono font-medium tabular-nums text-foreground">
                          {item.value.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  },
);
ChartTooltipContent.displayName = "ChartTooltip";

const ChartLegend = RechartsPrimitive.Legend;

const ChartLegendContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> &
    Pick<RechartsPrimitive.LegendProps, "payload" | "verticalAlign"> & {
      hideIcon?: boolean;
      nameKey?: string;
    }
>(({ className, hideIcon = false, payload, verticalAlign = "bottom", nameKey }, ref) => {
  const { config } = useChart();

  if (!payload?.length) {
    return null;
  }

  return (
    <div
      ref={ref}
      className={cn("flex items-center justify-center gap-4", verticalAlign === "top" ? "pb-3" : "pt-3", className)}
    >
      {payload.map((item) => {
        const key = `${nameKey || item.dataKey || "value"}`;
        const itemConfig = getPayloadConfigFromPayload(config, item, key);

        return (
          <div
            key={item.value}
            className={cn("flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-muted-foreground")}
          >
            {itemConfig?.icon && !hideIcon ? (
              <itemConfig.icon />
            ) : (
              <div
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{
                  backgroundColor: item.color,
                }}
              />
            )}
            {itemConfig?.label}
          </div>
        );
      })}
    </div>
  );
});
ChartLegendContent.displayName = "ChartLegend";

// Helper to extract item config from a payload.
function getPayloadConfigFromPayload(config: ChartConfig, payload: unknown, key: string) {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }

  const payloadPayload =
    "payload" in payload && typeof payload.payload === "object" && payload.payload !== null
      ? payload.payload
      : undefined;

  let configLabelKey: string = key;

  if (key in payload && typeof payload[key as keyof typeof payload] === "string") {
    configLabelKey = payload[key as keyof typeof payload] as string;
  } else if (
    payloadPayload &&
    key in payloadPayload &&
    typeof payloadPayload[key as keyof typeof payloadPayload] === "string"
  ) {
    configLabelKey = payloadPayload[key as keyof typeof payloadPayload] as string;
  }

  return configLabelKey in config ? config[configLabelKey] : config[key as keyof typeof config];
}

export { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, ChartStyle };

```

---

## frontend/src/components/ui/checkbox.tsx

```tsx
import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className={cn("flex items-center justify-center text-current")}>
      <Check className="h-4 w-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };

```

---

## frontend/src/components/ui/collapsible.tsx

```tsx
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";

const Collapsible = CollapsiblePrimitive.Root;

const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger;

const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent;

export { Collapsible, CollapsibleTrigger, CollapsibleContent };

```

---

## frontend/src/components/ui/command.tsx

```tsx
import * as React from "react";
import { type DialogProps } from "@radix-ui/react-dialog";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
      className,
    )}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

interface CommandDialogProps extends DialogProps {}

const CommandDialog = ({ children, ...props }: CommandDialogProps) => {
  return (
    <Dialog {...props}>
      <DialogContent className="overflow-hidden p-0 shadow-lg">
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
};

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div className="flex items-center border-b px-3" cmdk-input-wrapper="">
    <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        "flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  </div>
));

CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn("max-h-[300px] overflow-y-auto overflow-x-hidden", className)}
    {...props}
  />
));

CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => <CommandPrimitive.Empty ref={ref} className="py-6 text-center text-sm" {...props} />);

CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
      className,
    )}
    {...props}
  />
));

CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator ref={ref} className={cn("-mx-1 h-px bg-border", className)} {...props} />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected='true']:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50",
      className,
    )}
    {...props}
  />
));

CommandItem.displayName = CommandPrimitive.Item.displayName;

const CommandShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return <span className={cn("ml-auto text-xs tracking-widest text-muted-foreground", className)} {...props} />;
};
CommandShortcut.displayName = "CommandShortcut";

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};

```

---

## frontend/src/components/ui/context-menu.tsx

```tsx
import * as React from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { Check, ChevronRight, Circle } from "lucide-react";

import { cn } from "@/lib/utils";

const ContextMenu = ContextMenuPrimitive.Root;

const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

const ContextMenuGroup = ContextMenuPrimitive.Group;

const ContextMenuPortal = ContextMenuPrimitive.Portal;

const ContextMenuSub = ContextMenuPrimitive.Sub;

const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

const ContextMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger> & {
    inset?: boolean;
  }
>(({ className, inset, children, ...props }, ref) => (
  <ContextMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[state=open]:bg-accent data-[state=open]:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
      inset && "pl-8",
      className,
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-4 w-4" />
  </ContextMenuPrimitive.SubTrigger>
));
ContextMenuSubTrigger.displayName = ContextMenuPrimitive.SubTrigger.displayName;

const ContextMenuSubContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.SubContent
    ref={ref}
    className={cn(
      "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className,
    )}
    {...props}
  />
));
ContextMenuSubContent.displayName = ContextMenuPrimitive.SubContent.displayName;

const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      className={cn(
        "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
));
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName;

const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground",
      inset && "pl-8",
      className,
    )}
    {...props}
  />
));
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName;

const ContextMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <ContextMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground",
      className,
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.CheckboxItem>
));
ContextMenuCheckboxItem.displayName = ContextMenuPrimitive.CheckboxItem.displayName;

const ContextMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <Circle className="h-2 w-2 fill-current" />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.RadioItem>
));
ContextMenuRadioItem.displayName = ContextMenuPrimitive.RadioItem.displayName;

const ContextMenuLabel = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <ContextMenuPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-sm font-semibold text-foreground", inset && "pl-8", className)}
    {...props}
  />
));
ContextMenuLabel.displayName = ContextMenuPrimitive.Label.displayName;

const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
));
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName;

const ContextMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return <span className={cn("ml-auto text-xs tracking-widest text-muted-foreground", className)} {...props} />;
};
ContextMenuShortcut.displayName = "ContextMenuShortcut";

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
};

```

---

## frontend/src/components/ui/dialog.tsx

```tsx
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity data-[state=open]:bg-accent data-[state=open]:text-muted-foreground hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};

```

---

## frontend/src/components/ui/drawer.tsx

```tsx
import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";

import { cn } from "@/lib/utils";

const Drawer = ({ shouldScaleBackground = true, ...props }: React.ComponentProps<typeof DrawerPrimitive.Root>) => (
  <DrawerPrimitive.Root shouldScaleBackground={shouldScaleBackground} {...props} />
);
Drawer.displayName = "Drawer";

const DrawerTrigger = DrawerPrimitive.Trigger;

const DrawerPortal = DrawerPrimitive.Portal;

const DrawerClose = DrawerPrimitive.Close;

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Overlay ref={ref} className={cn("fixed inset-0 z-50 bg-black/80", className)} {...props} />
));
DrawerOverlay.displayName = DrawerPrimitive.Overlay.displayName;

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DrawerPortal>
    <DrawerOverlay />
    <DrawerPrimitive.Content
      ref={ref}
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto flex-col rounded-t-[10px] border bg-background",
        className,
      )}
      {...props}
    >
      <div className="mx-auto mt-4 h-2 w-[100px] rounded-full bg-muted" />
      {children}
    </DrawerPrimitive.Content>
  </DrawerPortal>
));
DrawerContent.displayName = "DrawerContent";

const DrawerHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("grid gap-1.5 p-4 text-center sm:text-left", className)} {...props} />
);
DrawerHeader.displayName = "DrawerHeader";

const DrawerFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("mt-auto flex flex-col gap-2 p-4", className)} {...props} />
);
DrawerFooter.displayName = "DrawerFooter";

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DrawerTitle.displayName = DrawerPrimitive.Title.displayName;

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DrawerDescription.displayName = DrawerPrimitive.Description.displayName;

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};

```

---

## frontend/src/components/ui/dropdown-menu.tsx

```tsx
import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight, Circle } from "lucide-react";

import { cn } from "@/lib/utils";

const DropdownMenu = DropdownMenuPrimitive.Root;

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

const DropdownMenuGroup = DropdownMenuPrimitive.Group;

const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

const DropdownMenuSub = DropdownMenuPrimitive.Sub;

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean;
  }
>(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[state=open]:bg-accent focus:bg-accent",
      inset && "pl-8",
      className,
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-4 w-4" />
  </DropdownMenuPrimitive.SubTrigger>
));
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName;

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    className={cn(
      "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className,
    )}
    {...props}
  />
));
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName;

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground",
      inset && "pl-8",
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground",
      className,
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName;

const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className="h-2 w-2 fill-current" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;

const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-sm font-semibold", inset && "pl-8", className)}
    {...props}
  />
));
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-muted", className)} {...props} />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

const DropdownMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return <span className={cn("ml-auto text-xs tracking-widest opacity-60", className)} {...props} />;
};
DropdownMenuShortcut.displayName = "DropdownMenuShortcut";

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
};

```

---

## frontend/src/components/ui/form.tsx

```tsx
import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { Slot } from "@radix-ui/react-slot";
import { Controller, ControllerProps, FieldPath, FieldValues, FormProvider, useFormContext } from "react-hook-form";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

const Form = FormProvider;

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName;
};

const FormFieldContext = React.createContext<FormFieldContextValue>({} as FormFieldContextValue);

const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  ...props
}: ControllerProps<TFieldValues, TName>) => {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
};

const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState, formState } = useFormContext();

  const fieldState = getFieldState(fieldContext.name, formState);

  if (!fieldContext) {
    throw new Error("useFormField should be used within <FormField>");
  }

  const { id } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
};

type FormItemContextValue = {
  id: string;
};

const FormItemContext = React.createContext<FormItemContextValue>({} as FormItemContextValue);

const FormItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const id = React.useId();

    return (
      <FormItemContext.Provider value={{ id }}>
        <div ref={ref} className={cn("space-y-2", className)} {...props} />
      </FormItemContext.Provider>
    );
  },
);
FormItem.displayName = "FormItem";

const FormLabel = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => {
  const { error, formItemId } = useFormField();

  return <Label ref={ref} className={cn(error && "text-destructive", className)} htmlFor={formItemId} {...props} />;
});
FormLabel.displayName = "FormLabel";

const FormControl = React.forwardRef<React.ElementRef<typeof Slot>, React.ComponentPropsWithoutRef<typeof Slot>>(
  ({ ...props }, ref) => {
    const { error, formItemId, formDescriptionId, formMessageId } = useFormField();

    return (
      <Slot
        ref={ref}
        id={formItemId}
        aria-describedby={!error ? `${formDescriptionId}` : `${formDescriptionId} ${formMessageId}`}
        aria-invalid={!!error}
        {...props}
      />
    );
  },
);
FormControl.displayName = "FormControl";

const FormDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => {
    const { formDescriptionId } = useFormField();

    return <p ref={ref} id={formDescriptionId} className={cn("text-sm text-muted-foreground", className)} {...props} />;
  },
);
FormDescription.displayName = "FormDescription";

const FormMessage = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, children, ...props }, ref) => {
    const { error, formMessageId } = useFormField();
    const body = error ? String(error?.message) : children;

    if (!body) {
      return null;
    }

    return (
      <p ref={ref} id={formMessageId} className={cn("text-sm font-medium text-destructive", className)} {...props}>
        {body}
      </p>
    );
  },
);
FormMessage.displayName = "FormMessage";

export { useFormField, Form, FormItem, FormLabel, FormControl, FormDescription, FormMessage, FormField };

```

---

## frontend/src/components/ui/hover-card.tsx

```tsx
import * as React from "react";
import * as HoverCardPrimitive from "@radix-ui/react-hover-card";

import { cn } from "@/lib/utils";

const HoverCard = HoverCardPrimitive.Root;

const HoverCardTrigger = HoverCardPrimitive.Trigger;

const HoverCardContent = React.forwardRef<
  React.ElementRef<typeof HoverCardPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <HoverCardPrimitive.Content
    ref={ref}
    align={align}
    sideOffset={sideOffset}
    className={cn(
      "z-50 w-64 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className,
    )}
    {...props}
  />
));
HoverCardContent.displayName = HoverCardPrimitive.Content.displayName;

export { HoverCard, HoverCardTrigger, HoverCardContent };

```

---

## frontend/src/components/ui/input-otp.tsx

```tsx
import * as React from "react";
import { OTPInput, OTPInputContext } from "input-otp";
import { Dot } from "lucide-react";

import { cn } from "@/lib/utils";

const InputOTP = React.forwardRef<React.ElementRef<typeof OTPInput>, React.ComponentPropsWithoutRef<typeof OTPInput>>(
  ({ className, containerClassName, ...props }, ref) => (
    <OTPInput
      ref={ref}
      containerClassName={cn("flex items-center gap-2 has-[:disabled]:opacity-50", containerClassName)}
      className={cn("disabled:cursor-not-allowed", className)}
      {...props}
    />
  ),
);
InputOTP.displayName = "InputOTP";

const InputOTPGroup = React.forwardRef<React.ElementRef<"div">, React.ComponentPropsWithoutRef<"div">>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("flex items-center", className)} {...props} />,
);
InputOTPGroup.displayName = "InputOTPGroup";

const InputOTPSlot = React.forwardRef<
  React.ElementRef<"div">,
  React.ComponentPropsWithoutRef<"div"> & { index: number }
>(({ index, className, ...props }, ref) => {
  const inputOTPContext = React.useContext(OTPInputContext);
  const { char, hasFakeCaret, isActive } = inputOTPContext.slots[index];

  return (
    <div
      ref={ref}
      className={cn(
        "relative flex h-10 w-10 items-center justify-center border-y border-r border-input text-sm transition-all first:rounded-l-md first:border-l last:rounded-r-md",
        isActive && "z-10 ring-2 ring-ring ring-offset-background",
        className,
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="animate-caret-blink h-4 w-px bg-foreground duration-1000" />
        </div>
      )}
    </div>
  );
});
InputOTPSlot.displayName = "InputOTPSlot";

const InputOTPSeparator = React.forwardRef<React.ElementRef<"div">, React.ComponentPropsWithoutRef<"div">>(
  ({ ...props }, ref) => (
    <div ref={ref} role="separator" {...props}>
      <Dot />
    </div>
  ),
);
InputOTPSeparator.displayName = "InputOTPSeparator";

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator };

```

---

## frontend/src/components/ui/input.tsx

```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };

```

---

## frontend/src/components/ui/label.tsx

```tsx
import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const labelVariants = cva("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70");

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn(labelVariants(), className)} {...props} />
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };

```

---

## frontend/src/components/ui/menubar.tsx

```tsx
import * as React from "react";
import * as MenubarPrimitive from "@radix-ui/react-menubar";
import { Check, ChevronRight, Circle } from "lucide-react";

import { cn } from "@/lib/utils";

const MenubarMenu = MenubarPrimitive.Menu;

const MenubarGroup = MenubarPrimitive.Group;

const MenubarPortal = MenubarPrimitive.Portal;

const MenubarSub = MenubarPrimitive.Sub;

const MenubarRadioGroup = MenubarPrimitive.RadioGroup;

const Menubar = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.Root
    ref={ref}
    className={cn("flex h-10 items-center space-x-1 rounded-md border bg-background p-1", className)}
    {...props}
  />
));
Menubar.displayName = MenubarPrimitive.Root.displayName;

const MenubarTrigger = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-sm px-3 py-1.5 text-sm font-medium outline-none data-[state=open]:bg-accent data-[state=open]:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
      className,
    )}
    {...props}
  />
));
MenubarTrigger.displayName = MenubarPrimitive.Trigger.displayName;

const MenubarSubTrigger = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.SubTrigger> & {
    inset?: boolean;
  }
>(({ className, inset, children, ...props }, ref) => (
  <MenubarPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[state=open]:bg-accent data-[state=open]:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
      inset && "pl-8",
      className,
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-4 w-4" />
  </MenubarPrimitive.SubTrigger>
));
MenubarSubTrigger.displayName = MenubarPrimitive.SubTrigger.displayName;

const MenubarSubContent = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.SubContent
    ref={ref}
    className={cn(
      "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className,
    )}
    {...props}
  />
));
MenubarSubContent.displayName = MenubarPrimitive.SubContent.displayName;

const MenubarContent = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Content>
>(({ className, align = "start", alignOffset = -4, sideOffset = 8, ...props }, ref) => (
  <MenubarPrimitive.Portal>
    <MenubarPrimitive.Content
      ref={ref}
      align={align}
      alignOffset={alignOffset}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-[12rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    />
  </MenubarPrimitive.Portal>
));
MenubarContent.displayName = MenubarPrimitive.Content.displayName;

const MenubarItem = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Item> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <MenubarPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground",
      inset && "pl-8",
      className,
    )}
    {...props}
  />
));
MenubarItem.displayName = MenubarPrimitive.Item.displayName;

const MenubarCheckboxItem = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <MenubarPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground",
      className,
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <MenubarPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </MenubarPrimitive.ItemIndicator>
    </span>
    {children}
  </MenubarPrimitive.CheckboxItem>
));
MenubarCheckboxItem.displayName = MenubarPrimitive.CheckboxItem.displayName;

const MenubarRadioItem = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <MenubarPrimitive.RadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <MenubarPrimitive.ItemIndicator>
        <Circle className="h-2 w-2 fill-current" />
      </MenubarPrimitive.ItemIndicator>
    </span>
    {children}
  </MenubarPrimitive.RadioItem>
));
MenubarRadioItem.displayName = MenubarPrimitive.RadioItem.displayName;

const MenubarLabel = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Label> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <MenubarPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-sm font-semibold", inset && "pl-8", className)}
    {...props}
  />
));
MenubarLabel.displayName = MenubarPrimitive.Label.displayName;

const MenubarSeparator = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-muted", className)} {...props} />
));
MenubarSeparator.displayName = MenubarPrimitive.Separator.displayName;

const MenubarShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return <span className={cn("ml-auto text-xs tracking-widest text-muted-foreground", className)} {...props} />;
};
MenubarShortcut.displayname = "MenubarShortcut";

export {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator,
  MenubarLabel,
  MenubarCheckboxItem,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarPortal,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarGroup,
  MenubarSub,
  MenubarShortcut,
};

```

---

## frontend/src/components/ui/navigation-menu.tsx

```tsx
import * as React from "react";
import * as NavigationMenuPrimitive from "@radix-ui/react-navigation-menu";
import { cva } from "class-variance-authority";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

const NavigationMenu = React.forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <NavigationMenuPrimitive.Root
    ref={ref}
    className={cn("relative z-10 flex max-w-max flex-1 items-center justify-center", className)}
    {...props}
  >
    {children}
    <NavigationMenuViewport />
  </NavigationMenuPrimitive.Root>
));
NavigationMenu.displayName = NavigationMenuPrimitive.Root.displayName;

const NavigationMenuList = React.forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.List>
>(({ className, ...props }, ref) => (
  <NavigationMenuPrimitive.List
    ref={ref}
    className={cn("group flex flex-1 list-none items-center justify-center space-x-1", className)}
    {...props}
  />
));
NavigationMenuList.displayName = NavigationMenuPrimitive.List.displayName;

const NavigationMenuItem = NavigationMenuPrimitive.Item;

const navigationMenuTriggerStyle = cva(
  "group inline-flex h-10 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50 data-[active]:bg-accent/50 data-[state=open]:bg-accent/50",
);

const NavigationMenuTrigger = React.forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <NavigationMenuPrimitive.Trigger
    ref={ref}
    className={cn(navigationMenuTriggerStyle(), "group", className)}
    {...props}
  >
    {children}{" "}
    <ChevronDown
      className="relative top-[1px] ml-1 h-3 w-3 transition duration-200 group-data-[state=open]:rotate-180"
      aria-hidden="true"
    />
  </NavigationMenuPrimitive.Trigger>
));
NavigationMenuTrigger.displayName = NavigationMenuPrimitive.Trigger.displayName;

const NavigationMenuContent = React.forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <NavigationMenuPrimitive.Content
    ref={ref}
    className={cn(
      "left-0 top-0 w-full data-[motion^=from-]:animate-in data-[motion^=to-]:animate-out data-[motion^=from-]:fade-in data-[motion^=to-]:fade-out data-[motion=from-end]:slide-in-from-right-52 data-[motion=from-start]:slide-in-from-left-52 data-[motion=to-end]:slide-out-to-right-52 data-[motion=to-start]:slide-out-to-left-52 md:absolute md:w-auto",
      className,
    )}
    {...props}
  />
));
NavigationMenuContent.displayName = NavigationMenuPrimitive.Content.displayName;

const NavigationMenuLink = NavigationMenuPrimitive.Link;

const NavigationMenuViewport = React.forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <div className={cn("absolute left-0 top-full flex justify-center")}>
    <NavigationMenuPrimitive.Viewport
      className={cn(
        "origin-top-center relative mt-1.5 h-[var(--radix-navigation-menu-viewport-height)] w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-90 md:w-[var(--radix-navigation-menu-viewport-width)]",
        className,
      )}
      ref={ref}
      {...props}
    />
  </div>
));
NavigationMenuViewport.displayName = NavigationMenuPrimitive.Viewport.displayName;

const NavigationMenuIndicator = React.forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.Indicator>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Indicator>
>(({ className, ...props }, ref) => (
  <NavigationMenuPrimitive.Indicator
    ref={ref}
    className={cn(
      "top-full z-[1] flex h-1.5 items-end justify-center overflow-hidden data-[state=visible]:animate-in data-[state=hidden]:animate-out data-[state=hidden]:fade-out data-[state=visible]:fade-in",
      className,
    )}
    {...props}
  >
    <div className="relative top-[60%] h-2 w-2 rotate-45 rounded-tl-sm bg-border shadow-md" />
  </NavigationMenuPrimitive.Indicator>
));
NavigationMenuIndicator.displayName = NavigationMenuPrimitive.Indicator.displayName;

export {
  navigationMenuTriggerStyle,
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuContent,
  NavigationMenuTrigger,
  NavigationMenuLink,
  NavigationMenuIndicator,
  NavigationMenuViewport,
};

```

---

## frontend/src/components/ui/pagination.tsx

```tsx
import * as React from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import { ButtonProps, buttonVariants } from "@/components/ui/button";

const Pagination = ({ className, ...props }: React.ComponentProps<"nav">) => (
  <nav
    role="navigation"
    aria-label="pagination"
    className={cn("mx-auto flex w-full justify-center", className)}
    {...props}
  />
);
Pagination.displayName = "Pagination";

const PaginationContent = React.forwardRef<HTMLUListElement, React.ComponentProps<"ul">>(
  ({ className, ...props }, ref) => (
    <ul ref={ref} className={cn("flex flex-row items-center gap-1", className)} {...props} />
  ),
);
PaginationContent.displayName = "PaginationContent";

const PaginationItem = React.forwardRef<HTMLLIElement, React.ComponentProps<"li">>(({ className, ...props }, ref) => (
  <li ref={ref} className={cn("", className)} {...props} />
));
PaginationItem.displayName = "PaginationItem";

type PaginationLinkProps = {
  isActive?: boolean;
} & Pick<ButtonProps, "size"> &
  React.ComponentProps<"a">;

const PaginationLink = ({ className, isActive, size = "icon", ...props }: PaginationLinkProps) => (
  <a
    aria-current={isActive ? "page" : undefined}
    className={cn(
      buttonVariants({
        variant: isActive ? "outline" : "ghost",
        size,
      }),
      className,
    )}
    {...props}
  />
);
PaginationLink.displayName = "PaginationLink";

const PaginationPrevious = ({ className, ...props }: React.ComponentProps<typeof PaginationLink>) => (
  <PaginationLink aria-label="Go to previous page" size="default" className={cn("gap-1 pl-2.5", className)} {...props}>
    <ChevronLeft className="h-4 w-4" />
    <span>Previous</span>
  </PaginationLink>
);
PaginationPrevious.displayName = "PaginationPrevious";

const PaginationNext = ({ className, ...props }: React.ComponentProps<typeof PaginationLink>) => (
  <PaginationLink aria-label="Go to next page" size="default" className={cn("gap-1 pr-2.5", className)} {...props}>
    <span>Next</span>
    <ChevronRight className="h-4 w-4" />
  </PaginationLink>
);
PaginationNext.displayName = "PaginationNext";

const PaginationEllipsis = ({ className, ...props }: React.ComponentProps<"span">) => (
  <span aria-hidden className={cn("flex h-9 w-9 items-center justify-center", className)} {...props}>
    <MoreHorizontal className="h-4 w-4" />
    <span className="sr-only">More pages</span>
  </span>
);
PaginationEllipsis.displayName = "PaginationEllipsis";

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
};

```

---

## frontend/src/components/ui/popover.tsx

```tsx
import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent };

```

---

## frontend/src/components/ui/progress.tsx

```tsx
import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn("relative h-4 w-full overflow-hidden rounded-full bg-secondary", className)}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className="h-full w-full flex-1 bg-primary transition-all"
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };

```

---

## frontend/src/components/ui/radio-group.tsx

```tsx
import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { Circle } from "lucide-react";

import { cn } from "@/lib/utils";

const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => {
  return <RadioGroupPrimitive.Root className={cn("grid gap-2", className)} {...props} ref={ref} />;
});
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName;

const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        "aspect-square h-4 w-4 rounded-full border border-primary text-primary ring-offset-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
        <Circle className="h-2.5 w-2.5 fill-current text-current" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
});
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName;

export { RadioGroup, RadioGroupItem };

```

---

## frontend/src/components/ui/resizable.tsx

```tsx
import { GripVertical } from "lucide-react";
import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "@/lib/utils";

const ResizablePanelGroup = ({ className, ...props }: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) => (
  <ResizablePrimitive.PanelGroup
    className={cn("flex h-full w-full data-[panel-group-direction=vertical]:flex-col", className)}
    {...props}
  />
);

const ResizablePanel = ResizablePrimitive.Panel;

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean;
}) => (
  <ResizablePrimitive.PanelResizeHandle
    className={cn(
      "relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 [&[data-panel-group-direction=vertical]>div]:rotate-90",
      className,
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
  </ResizablePrimitive.PanelResizeHandle>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };

```

---

## frontend/src/components/ui/scroll-area.tsx

```tsx
import * as React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";

import { cn } from "@/lib/utils";

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root ref={ref} className={cn("relative overflow-hidden", className)} {...props}>
    <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">{children}</ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
));
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none transition-colors",
      orientation === "vertical" && "h-full w-2.5 border-l border-l-transparent p-[1px]",
      orientation === "horizontal" && "h-2.5 flex-col border-t border-t-transparent p-[1px]",
      className,
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
));
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;

export { ScrollArea, ScrollBar };

```

---

## frontend/src/components/ui/select.tsx

```tsx
import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";

const Select = SelectPrimitive.Root;

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        position === "popper" &&
          "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className,
      )}
      position={position}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          "p-1",
          position === "popper" &&
            "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]",
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label ref={ref} className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)} {...props} />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>

    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-muted", className)} {...props} />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};

```

---

## frontend/src/components/ui/separator.tsx

```tsx
import * as React from "react";
import * as SeparatorPrimitive from "@radix-ui/react-separator";

import { cn } from "@/lib/utils";

const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = "horizontal", decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn("shrink-0 bg-border", orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]", className)}
    {...props}
  />
));
Separator.displayName = SeparatorPrimitive.Root.displayName;

export { Separator };

```

---

## frontend/src/components/ui/sheet.tsx

```tsx
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const Sheet = SheetPrimitive.Root;

const SheetTrigger = SheetPrimitive.Trigger;

const SheetClose = SheetPrimitive.Close;

const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4  border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(
  ({ side = "right", className, children, ...props }, ref) => (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content ref={ref} className={cn(sheetVariants({ side }), className)} {...props}>
        {children}
        <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity data-[state=open]:bg-secondary hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  ),
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title ref={ref} className={cn("text-lg font-semibold text-foreground", className)} {...props} />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};

```

---

## frontend/src/components/ui/sidebar.tsx

```tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { VariantProps, cva } from "class-variance-authority";
import { PanelLeft } from "lucide-react";

import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const SIDEBAR_COOKIE_NAME = "sidebar:state";
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_MOBILE = "18rem";
const SIDEBAR_WIDTH_ICON = "3rem";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

type SidebarContext = {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContext | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}

const SidebarProvider = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    defaultOpen?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }
>(({ defaultOpen = true, open: openProp, onOpenChange: setOpenProp, className, style, children, ...props }, ref) => {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = React.useState(false);

  // This is the internal state of the sidebar.
  // We use openProp and setOpenProp for control from outside the component.
  const [_open, _setOpen] = React.useState(defaultOpen);
  const open = openProp ?? _open;
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value;
      if (setOpenProp) {
        setOpenProp(openState);
      } else {
        _setOpen(openState);
      }

      // This sets the cookie to keep the sidebar state.
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
    },
    [setOpenProp, open],
  );

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open);
  }, [isMobile, setOpen, setOpenMobile]);

  // Adds a keyboard shortcut to toggle the sidebar.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);

  // We add a state so that we can do data-state="expanded" or "collapsed".
  // This makes it easier to style the sidebar with Tailwind classes.
  const state = open ? "expanded" : "collapsed";

  const contextValue = React.useMemo<SidebarContext>(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
    }),
    [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar],
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <TooltipProvider delayDuration={0}>
        <div
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH,
              "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
              ...style,
            } as React.CSSProperties
          }
          className={cn("group/sidebar-wrapper flex min-h-svh w-full has-[[data-variant=inset]]:bg-sidebar", className)}
          ref={ref}
          {...props}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  );
});
SidebarProvider.displayName = "SidebarProvider";

const Sidebar = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    side?: "left" | "right";
    variant?: "sidebar" | "floating" | "inset";
    collapsible?: "offcanvas" | "icon" | "none";
  }
>(({ side = "left", variant = "sidebar", collapsible = "offcanvas", className, children, ...props }, ref) => {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar();

  if (collapsible === "none") {
    return (
      <div
        className={cn("flex h-full w-[--sidebar-width] flex-col bg-sidebar text-sidebar-foreground", className)}
        ref={ref}
        {...props}
      >
        {children}
      </div>
    );
  }

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
        <SheetContent
          data-sidebar="sidebar"
          data-mobile="true"
          className="w-[--sidebar-width] bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
            } as React.CSSProperties
          }
          side={side}
        >
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <div
      ref={ref}
      className="group peer hidden text-sidebar-foreground md:block"
      data-state={state}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-variant={variant}
      data-side={side}
    >
      {/* This is what handles the sidebar gap on desktop */}
      <div
        className={cn(
          "relative h-svh w-[--sidebar-width] bg-transparent transition-[width] duration-200 ease-linear",
          "group-data-[collapsible=offcanvas]:w-0",
          "group-data-[side=right]:rotate-180",
          variant === "floating" || variant === "inset"
            ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4))]"
            : "group-data-[collapsible=icon]:w-[--sidebar-width-icon]",
        )}
      />
      <div
        className={cn(
          "fixed inset-y-0 z-10 hidden h-svh w-[--sidebar-width] transition-[left,right,width] duration-200 ease-linear md:flex",
          side === "left"
            ? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]"
            : "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]",
          // Adjust the padding for floating and inset variants.
          variant === "floating" || variant === "inset"
            ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4)_+2px)]"
            : "group-data-[collapsible=icon]:w-[--sidebar-width-icon] group-data-[side=left]:border-r group-data-[side=right]:border-l",
          className,
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          className="flex h-full w-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow"
        >
          {children}
        </div>
      </div>
    </div>
  );
});
Sidebar.displayName = "Sidebar";

const SidebarTrigger = React.forwardRef<React.ElementRef<typeof Button>, React.ComponentProps<typeof Button>>(
  ({ className, onClick, ...props }, ref) => {
    const { toggleSidebar } = useSidebar();

    return (
      <Button
        ref={ref}
        data-sidebar="trigger"
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7", className)}
        onClick={(event) => {
          onClick?.(event);
          toggleSidebar();
        }}
        {...props}
      >
        <PanelLeft />
        <span className="sr-only">Toggle Sidebar</span>
      </Button>
    );
  },
);
SidebarTrigger.displayName = "SidebarTrigger";

const SidebarRail = React.forwardRef<HTMLButtonElement, React.ComponentProps<"button">>(
  ({ className, ...props }, ref) => {
    const { toggleSidebar } = useSidebar();

    return (
      <button
        ref={ref}
        data-sidebar="rail"
        aria-label="Toggle Sidebar"
        tabIndex={-1}
        onClick={toggleSidebar}
        title="Toggle Sidebar"
        className={cn(
          "absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] group-data-[side=left]:-right-4 group-data-[side=right]:left-0 hover:after:bg-sidebar-border sm:flex",
          "[[data-side=left]_&]:cursor-w-resize [[data-side=right]_&]:cursor-e-resize",
          "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
          "group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full group-data-[collapsible=offcanvas]:hover:bg-sidebar",
          "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
          "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
          className,
        )}
        {...props}
      />
    );
  },
);
SidebarRail.displayName = "SidebarRail";

const SidebarInset = React.forwardRef<HTMLDivElement, React.ComponentProps<"main">>(({ className, ...props }, ref) => {
  return (
    <main
      ref={ref}
      className={cn(
        "relative flex min-h-svh flex-1 flex-col bg-background",
        "peer-data-[variant=inset]:min-h-[calc(100svh-theme(spacing.4))] md:peer-data-[variant=inset]:m-2 md:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow",
        className,
      )}
      {...props}
    />
  );
});
SidebarInset.displayName = "SidebarInset";

const SidebarInput = React.forwardRef<React.ElementRef<typeof Input>, React.ComponentProps<typeof Input>>(
  ({ className, ...props }, ref) => {
    return (
      <Input
        ref={ref}
        data-sidebar="input"
        className={cn(
          "h-8 w-full bg-background shadow-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          className,
        )}
        {...props}
      />
    );
  },
);
SidebarInput.displayName = "SidebarInput";

const SidebarHeader = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(({ className, ...props }, ref) => {
  return <div ref={ref} data-sidebar="header" className={cn("flex flex-col gap-2 p-2", className)} {...props} />;
});
SidebarHeader.displayName = "SidebarHeader";

const SidebarFooter = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(({ className, ...props }, ref) => {
  return <div ref={ref} data-sidebar="footer" className={cn("flex flex-col gap-2 p-2", className)} {...props} />;
});
SidebarFooter.displayName = "SidebarFooter";

const SidebarSeparator = React.forwardRef<React.ElementRef<typeof Separator>, React.ComponentProps<typeof Separator>>(
  ({ className, ...props }, ref) => {
    return (
      <Separator
        ref={ref}
        data-sidebar="separator"
        className={cn("mx-2 w-auto bg-sidebar-border", className)}
        {...props}
      />
    );
  },
);
SidebarSeparator.displayName = "SidebarSeparator";

const SidebarContent = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      data-sidebar="content"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden",
        className,
      )}
      {...props}
    />
  );
});
SidebarContent.displayName = "SidebarContent";

const SidebarGroup = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      data-sidebar="group"
      className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
      {...props}
    />
  );
});
SidebarGroup.displayName = "SidebarGroup";

const SidebarGroupLabel = React.forwardRef<HTMLDivElement, React.ComponentProps<"div"> & { asChild?: boolean }>(
  ({ className, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "div";

    return (
      <Comp
        ref={ref}
        data-sidebar="group-label"
        className={cn(
          "flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 outline-none ring-sidebar-ring transition-[margin,opa] duration-200 ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
          "group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0",
          className,
        )}
        {...props}
      />
    );
  },
);
SidebarGroupLabel.displayName = "SidebarGroupLabel";

const SidebarGroupAction = React.forwardRef<HTMLButtonElement, React.ComponentProps<"button"> & { asChild?: boolean }>(
  ({ className, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        ref={ref}
        data-sidebar="group-action"
        className={cn(
          "absolute right-3 top-3.5 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground outline-none ring-sidebar-ring transition-transform hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
          // Increases the hit area of the button on mobile.
          "after:absolute after:-inset-2 after:md:hidden",
          "group-data-[collapsible=icon]:hidden",
          className,
        )}
        {...props}
      />
    );
  },
);
SidebarGroupAction.displayName = "SidebarGroupAction";

const SidebarGroupContent = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  ({ className, ...props }, ref) => (
    <div ref={ref} data-sidebar="group-content" className={cn("w-full text-sm", className)} {...props} />
  ),
);
SidebarGroupContent.displayName = "SidebarGroupContent";

const SidebarMenu = React.forwardRef<HTMLUListElement, React.ComponentProps<"ul">>(({ className, ...props }, ref) => (
  <ul ref={ref} data-sidebar="menu" className={cn("flex w-full min-w-0 flex-col gap-1", className)} {...props} />
));
SidebarMenu.displayName = "SidebarMenu";

const SidebarMenuItem = React.forwardRef<HTMLLIElement, React.ComponentProps<"li">>(({ className, ...props }, ref) => (
  <li ref={ref} data-sidebar="menu-item" className={cn("group/menu-item relative", className)} {...props} />
));
SidebarMenuItem.displayName = "SidebarMenuItem";

const sidebarMenuButtonVariants = cva(
  "peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 group-has-[[data-sidebar=menu-action]]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        outline:
          "bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]",
      },
      size: {
        default: "h-8 text-sm",
        sm: "h-7 text-xs",
        lg: "h-12 text-sm group-data-[collapsible=icon]:!p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const SidebarMenuButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & {
    asChild?: boolean;
    isActive?: boolean;
    tooltip?: string | React.ComponentProps<typeof TooltipContent>;
  } & VariantProps<typeof sidebarMenuButtonVariants>
>(({ asChild = false, isActive = false, variant = "default", size = "default", tooltip, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  const { isMobile, state } = useSidebar();

  const button = (
    <Comp
      ref={ref}
      data-sidebar="menu-button"
      data-size={size}
      data-active={isActive}
      className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
      {...props}
    />
  );

  if (!tooltip) {
    return button;
  }

  if (typeof tooltip === "string") {
    tooltip = {
      children: tooltip,
    };
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right" align="center" hidden={state !== "collapsed" || isMobile} {...tooltip} />
    </Tooltip>
  );
});
SidebarMenuButton.displayName = "SidebarMenuButton";

const SidebarMenuAction = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & {
    asChild?: boolean;
    showOnHover?: boolean;
  }
>(({ className, asChild = false, showOnHover = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      ref={ref}
      data-sidebar="menu-action"
      className={cn(
        "absolute right-1 top-1.5 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground outline-none ring-sidebar-ring transition-transform peer-hover/menu-button:text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        // Increases the hit area of the button on mobile.
        "after:absolute after:-inset-2 after:md:hidden",
        "peer-data-[size=sm]/menu-button:top-1",
        "peer-data-[size=default]/menu-button:top-1.5",
        "peer-data-[size=lg]/menu-button:top-2.5",
        "group-data-[collapsible=icon]:hidden",
        showOnHover &&
          "group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-[state=open]:opacity-100 peer-data-[active=true]/menu-button:text-sidebar-accent-foreground md:opacity-0",
        className,
      )}
      {...props}
    />
  );
});
SidebarMenuAction.displayName = "SidebarMenuAction";

const SidebarMenuBadge = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-sidebar="menu-badge"
      className={cn(
        "pointer-events-none absolute right-1 flex h-5 min-w-5 select-none items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums text-sidebar-foreground",
        "peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[active=true]/menu-button:text-sidebar-accent-foreground",
        "peer-data-[size=sm]/menu-button:top-1",
        "peer-data-[size=default]/menu-button:top-1.5",
        "peer-data-[size=lg]/menu-button:top-2.5",
        "group-data-[collapsible=icon]:hidden",
        className,
      )}
      {...props}
    />
  ),
);
SidebarMenuBadge.displayName = "SidebarMenuBadge";

const SidebarMenuSkeleton = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    showIcon?: boolean;
  }
>(({ className, showIcon = false, ...props }, ref) => {
  // Random width between 50 to 90%.
  const width = React.useMemo(() => {
    return `${Math.floor(Math.random() * 40) + 50}%`;
  }, []);

  return (
    <div
      ref={ref}
      data-sidebar="menu-skeleton"
      className={cn("flex h-8 items-center gap-2 rounded-md px-2", className)}
      {...props}
    >
      {showIcon && <Skeleton className="size-4 rounded-md" data-sidebar="menu-skeleton-icon" />}
      <Skeleton
        className="h-4 max-w-[--skeleton-width] flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          {
            "--skeleton-width": width,
          } as React.CSSProperties
        }
      />
    </div>
  );
});
SidebarMenuSkeleton.displayName = "SidebarMenuSkeleton";

const SidebarMenuSub = React.forwardRef<HTMLUListElement, React.ComponentProps<"ul">>(
  ({ className, ...props }, ref) => (
    <ul
      ref={ref}
      data-sidebar="menu-sub"
      className={cn(
        "mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5",
        "group-data-[collapsible=icon]:hidden",
        className,
      )}
      {...props}
    />
  ),
);
SidebarMenuSub.displayName = "SidebarMenuSub";

const SidebarMenuSubItem = React.forwardRef<HTMLLIElement, React.ComponentProps<"li">>(({ ...props }, ref) => (
  <li ref={ref} {...props} />
));
SidebarMenuSubItem.displayName = "SidebarMenuSubItem";

const SidebarMenuSubButton = React.forwardRef<
  HTMLAnchorElement,
  React.ComponentProps<"a"> & {
    asChild?: boolean;
    size?: "sm" | "md";
    isActive?: boolean;
  }
>(({ asChild = false, size = "md", isActive, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "a";

  return (
    <Comp
      ref={ref}
      data-sidebar="menu-sub-button"
      data-size={size}
      data-active={isActive}
      className={cn(
        "flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sidebar-foreground outline-none ring-sidebar-ring aria-disabled:pointer-events-none aria-disabled:opacity-50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground",
        "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
        size === "sm" && "text-xs",
        size === "md" && "text-sm",
        "group-data-[collapsible=icon]:hidden",
        className,
      )}
      {...props}
    />
  );
});
SidebarMenuSubButton.displayName = "SidebarMenuSubButton";

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
};

```

---

## frontend/src/components/ui/skeleton.tsx

```tsx
import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

export { Skeleton };

```

---

## frontend/src/components/ui/slider.tsx

```tsx
import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/utils";

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn("relative flex w-full touch-none select-none items-center", className)}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary">
      <SliderPrimitive.Range className="absolute h-full bg-primary" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50" />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };

```

---

## frontend/src/components/ui/sonner.tsx

```tsx
import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };

```

---

## frontend/src/components/ui/switch.tsx

```tsx
import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };

```

---

## frontend/src/components/ui/table.tsx

```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto">
      <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  ),
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />,
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  ),
);
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot ref={ref} className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)} {...props} />
  ),
);
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn("border-b transition-colors data-[state=selected]:bg-muted hover:bg-muted/50", className)}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        "h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={cn("p-4 align-middle [&:has([role=checkbox])]:pr-0", className)} {...props} />
  ),
);
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
  ),
);
TableCaption.displayName = "TableCaption";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };

```

---

## frontend/src/components/ui/tabs.tsx

```tsx
import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };

```

---

## frontend/src/components/ui/textarea.tsx

```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };

```

---

## frontend/src/components/ui/toast.tsx

```tsx
import * as React from "react";
import * as ToastPrimitives from "@radix-ui/react-toast";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const ToastProvider = ToastPrimitives.Provider;

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      "fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]",
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitives.Viewport.displayName;

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full",
  {
    variants: {
      variant: {
        default: "border bg-background text-foreground",
        destructive: "destructive group border-destructive bg-destructive text-destructive-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> & VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => {
  return <ToastPrimitives.Root ref={ref} className={cn(toastVariants({ variant }), className)} {...props} />;
});
Toast.displayName = ToastPrimitives.Root.displayName;

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      "inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium ring-offset-background transition-colors group-[.destructive]:border-muted/40 hover:bg-secondary group-[.destructive]:hover:border-destructive/30 group-[.destructive]:hover:bg-destructive group-[.destructive]:hover:text-destructive-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 group-[.destructive]:focus:ring-destructive disabled:pointer-events-none disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
ToastAction.displayName = ToastPrimitives.Action.displayName;

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      "absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity group-hover:opacity-100 group-[.destructive]:text-red-300 hover:text-foreground group-[.destructive]:hover:text-red-50 focus:opacity-100 focus:outline-none focus:ring-2 group-[.destructive]:focus:ring-red-400 group-[.destructive]:focus:ring-offset-red-600",
      className,
    )}
    toast-close=""
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitives.Close>
));
ToastClose.displayName = ToastPrimitives.Close.displayName;

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title ref={ref} className={cn("text-sm font-semibold", className)} {...props} />
));
ToastTitle.displayName = ToastPrimitives.Title.displayName;

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description ref={ref} className={cn("text-sm opacity-90", className)} {...props} />
));
ToastDescription.displayName = ToastPrimitives.Description.displayName;

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>;

type ToastActionElement = React.ReactElement<typeof ToastAction>;

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
};

```

---

## frontend/src/components/ui/toaster.tsx

```tsx
import { useToast } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}

```

---

## frontend/src/components/ui/toggle-group.tsx

```tsx
import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { toggleVariants } from "@/components/ui/toggle";

const ToggleGroupContext = React.createContext<VariantProps<typeof toggleVariants>>({
  size: "default",
  variant: "default",
});

const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> & VariantProps<typeof toggleVariants>
>(({ className, variant, size, children, ...props }, ref) => (
  <ToggleGroupPrimitive.Root ref={ref} className={cn("flex items-center justify-center gap-1", className)} {...props}>
    <ToggleGroupContext.Provider value={{ variant, size }}>{children}</ToggleGroupContext.Provider>
  </ToggleGroupPrimitive.Root>
));

ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName;

const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> & VariantProps<typeof toggleVariants>
>(({ className, children, variant, size, ...props }, ref) => {
  const context = React.useContext(ToggleGroupContext);

  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        className,
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
});

ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName;

export { ToggleGroup, ToggleGroupItem };

```

---

## frontend/src/components/ui/toggle.tsx

```tsx
import * as React from "react";
import * as TogglePrimitive from "@radix-ui/react-toggle";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const toggleVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-input bg-transparent hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-10 px-3",
        sm: "h-9 px-2.5",
        lg: "h-11 px-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const Toggle = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>
>(({ className, variant, size, ...props }, ref) => (
  <TogglePrimitive.Root ref={ref} className={cn(toggleVariants({ variant, size, className }))} {...props} />
));

Toggle.displayName = TogglePrimitive.Root.displayName;

export { Toggle, toggleVariants };

```

---

## frontend/src/components/ui/tooltip.tsx

```tsx
import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className,
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };

```

---

## frontend/src/components/ui/use-toast.ts

```ts
import { useToast, toast } from "@/hooks/use-toast";

export { useToast, toast };

```
