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
