import { Link, useLocation } from 'react-router-dom';
import { Search, Shield, Brain, FolderOpen, Bot, History, Command } from 'lucide-react';
import { BackgroundTaskIndicator } from '@/components/BackgroundTaskIndicator';
import { ThemeToggle } from '@/components/ThemeToggle';
import { MobileNavDrawer } from '@/components/MobileNavDrawer';
import { NotificationBell } from '@/contexts/NotificationContext';
import { cn } from '@/lib/utils';

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
}

const NavItem = ({ to, icon, label, isActive }: NavItemProps) => (
  <Link
    to={to}
    className={cn(
      "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
      isActive
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:text-foreground hover:bg-muted"
    )}
    aria-current={isActive ? "page" : undefined}
  >
    {icon}
    <span className="hidden lg:inline">{label}</span>
  </Link>
);

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const pathname = location.pathname;

  const navItems = [
    { to: '/', icon: <Search className="h-4 w-4" />, label: '통합 검색' },
    { to: '/deep-search', icon: <Brain className="h-4 w-4" />, label: 'Deep Search' },
    { to: '/fact-check', icon: <Shield className="h-4 w-4" />, label: '팩트체크' },
    { to: '/ai-agent', icon: <Bot className="h-4 w-4" />, label: '브라우저 에이전트' },
    { to: '/url-collections', icon: <FolderOpen className="h-4 w-4" />, label: 'URL 컬렉션' },
    { to: '/history', icon: <History className="h-4 w-4" />, label: '검색 기록' },
  ];

  return (
    <div className="min-h-screen flex flex-col">
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

          {/* Navigation - Hidden on mobile */}
          <nav className="hidden md:flex items-center gap-1 flex-1 overflow-x-auto ml-6" role="navigation" aria-label="주요 내비게이션">
            {navItems.map((item) => (
              <NavItem
                key={item.to}
                to={item.to}
                icon={item.icon}
                label={item.label}
                isActive={
                  item.to === '/'
                    ? pathname === '/'
                    : pathname.startsWith(item.to)
                }
              />
            ))}
          </nav>

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
            
            {/* Notification Bell */}
            <NotificationBell />
            {/* Theme Toggle */}
            <ThemeToggle variant="dropdown" size="sm" />
            {/* Background Task Indicator */}
            <BackgroundTaskIndicator />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1" role="main">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t py-4 mt-auto" role="contentinfo">
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
