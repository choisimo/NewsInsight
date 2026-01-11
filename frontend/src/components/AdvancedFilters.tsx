import { useState, useCallback } from "react";
import {
  ChevronDown,
  ChevronUp,
  Filter,
  Calendar as CalendarIcon,
  Globe,
  Database,
  Layers,
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
  ai: { icon: Layers, label: "심층 분석", color: "text-purple-600" },
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
