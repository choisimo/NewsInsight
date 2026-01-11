import { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Home,
  Workflow,
  FolderOpen,
  History,
  Moon,
  Sun,
  FileJson,
  Command,
  Cpu,
  Layers,
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
      icon: Layers,
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
      icon: Workflow,
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
