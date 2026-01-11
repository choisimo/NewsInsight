import { useState, useCallback, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Menu,
  X,
  Search,
  Workflow,
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
  Layers,
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
      { href: "/ai-agent", label: "브라우저 에이전트", icon: Workflow },
      { href: "/ai-jobs", label: "자동화 작업", icon: Layers },
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
