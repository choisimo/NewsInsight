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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Search;
  color?: string;
}

// Consolidated navigation matching AppLayout.tsx
const navItems: NavItem[] = [
  { href: "/", label: "검색", icon: Search },
  { href: "/ml-addons", label: "ML Add-ons", icon: Cpu, color: "text-purple-600" },
  { href: "/ai-agent", label: "브라우저 에이전트", icon: Bot, color: "text-blue-600" },
  { href: "/url-collections", label: "URL 원천 관리", icon: Database, color: "text-orange-600" },
  { href: "/projects", label: "프로젝트", icon: FolderOpen, color: "text-green-600" },
  { href: "/history", label: "검색 기록", icon: History },
  { href: "/settings", label: "설정", icon: Settings },
];

interface MobileNavDrawerProps {
  className?: string;
}

/**
 * 모바일 네비게이션 드로어 컴포넌트
 */
export function MobileNavDrawer({ className }: MobileNavDrawerProps) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { theme, setTheme } = useTheme();

  // Close drawer on route change
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

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
                const isActive = location.pathname === item.href;
                
                return (
                  <li key={item.href}>
                    <Link
                      to={item.href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                        isActive
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
