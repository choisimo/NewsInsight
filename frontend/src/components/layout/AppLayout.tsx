import { Link, useLocation } from 'react-router-dom';
import { Command } from 'lucide-react';
import { BackgroundTaskIndicator } from '@/components/BackgroundTaskIndicator';
import { ThemeToggle } from '@/components/ThemeToggle';
import { MobileNavDrawer } from '@/components/MobileNavDrawer';
import { NotificationBell } from '@/contexts/NotificationContext';
import { NewNavigation, MobileBottomNav } from './NewNavigation';
import { cn } from '@/lib/utils';
import { useAutoNotifications } from '@/hooks/useNotificationBridge';

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();

  // SSE 이벤트를 NotificationContext에 자동 연결
  useAutoNotifications({
    enabled: true,
    // ERROR와 COLLECTION_COMPLETED 이벤트만 알림으로 표시 (너무 많은 알림 방지)
    enabledEventTypes: ['ERROR', 'COLLECTION_COMPLETED', 'COLLECTION_STARTED'],
    persistent: false, // 브라우저 새로고침 시 알림 삭제
    dedupeInterval: 10000, // 10초 내 동일 타입 알림 중복 방지
  });

  return (
    <div className="min-h-screen flex flex-col pb-16 md:pb-0">
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
