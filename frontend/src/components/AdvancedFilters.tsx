import { useState, useCallback } from "react";
import {
  ChevronDown,
  ChevronUp,
  Filter,
  Calendar,
  Globe,
  Database,
  Brain,
  X,
  RotateCcw,
} from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface SearchFilters {
  /** 시간 범위 */
  timeWindow: string;
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
  { value: "7d", label: "최근 7일" },
  { value: "30d", label: "최근 30일" },
  { value: "90d", label: "최근 3개월" },
  { value: "all", label: "전체 기간" },
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

export function AdvancedFilters({
  filters,
  onFiltersChange,
  disabled = false,
  className,
  compact = false,
}: AdvancedFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);
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

  const resetFilters = useCallback(() => {
    onFiltersChange(defaultFilters);
  }, [onFiltersChange]);

  // 컴팩트 모드: 인라인 칩으로 표시
  if (compact) {
    return (
      <div className={cn("flex flex-wrap items-center gap-2", className)}>
        {/* 시간 범위 */}
        <Select
          value={filters.timeWindow}
          onValueChange={(v) => updateFilter("timeWindow", v)}
          disabled={disabled}
        >
          <SelectTrigger className="w-[130px] h-8 text-sm">
            <Calendar className="h-3 w-3 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {timeOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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
              onValueChange={(v) => updateFilter("timeWindow", v)}
              disabled={disabled}
            >
              <SelectTrigger>
                <SelectValue />
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
    const opt = timeOptions.find((o) => o.value === filters.timeWindow);
    badges.push({ key: "timeWindow", label: opt?.label || filters.timeWindow, resetValue: defaultFilters.timeWindow });
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
