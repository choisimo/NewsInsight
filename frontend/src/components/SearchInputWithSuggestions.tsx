import { useState, useRef, useEffect, useCallback, forwardRef } from "react";
import {
  Search,
  Clock,
  TrendingUp,
  X,
  Zap,
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
  suggestion: { icon: Zap, label: "추천", color: "text-blue-500" },
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
