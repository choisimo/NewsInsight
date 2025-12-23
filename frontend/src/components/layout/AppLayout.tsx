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
