import { Link, useLocation } from 'react-router-dom';
import { Search, Shield, Brain, FolderOpen, Bot } from 'lucide-react';
import { BackgroundTaskIndicator } from '@/components/BackgroundTaskIndicator';
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
  >
    {icon}
    <span className="hidden md:inline">{label}</span>
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
    { to: '/browser-agent', icon: <Bot className="h-4 w-4" />, label: '브라우저 에이전트' },
    { to: '/url-collections', icon: <FolderOpen className="h-4 w-4" />, label: 'URL 컬렉션' },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between px-4">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 mr-6">
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

          {/* Navigation */}
          <nav className="flex items-center gap-1 flex-1 overflow-x-auto">
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
          <div className="flex items-center gap-2 ml-4">
            {/* Background Task Indicator */}
            <BackgroundTaskIndicator />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t py-4 mt-auto">
        <div className="container px-4 text-center text-sm text-muted-foreground">
          <p>NewsInsight - AI 기반 뉴스 분석 플랫폼</p>
        </div>
      </footer>
    </div>
  );
}

export default AppLayout;
