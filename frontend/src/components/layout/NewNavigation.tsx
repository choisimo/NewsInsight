/**
 * NewNavigation - 새로운 5탭 네비게이션 컴포넌트
 * 
 * 구조:
 * 1. 홈 - 새 대시보드
 * 2. 대시보드 - 라이브 대시보드, 운영현황
 * 3. 도구 - 검색, ML Add-ons, 브라우저 에이전트
 * 4. 내 작업 - 프로젝트, 기록, URL 컬렉션
 * 5. 설정 - 환경설정, Admin
 */

import { Link, useLocation } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  Home,
  LayoutDashboard,
  Wrench,
  FolderKanban,
  Settings,
  Search,
  Bot,
  Cpu,
  Activity,
  Gauge,
  Database,
  History,
  FolderOpen,
  Globe,
  Brain,
  ChevronDown,
  Shield,
  Server,
  Terminal,
  FileText,
  Newspaper,
  Sparkles,
  Zap,
  FileJson,
} from 'lucide-react';

interface SubMenuItem {
  to: string;
  icon: React.ReactNode;
  label: string;
  description?: string;
}

interface NavItem {
  id: string;
  icon: React.ReactNode;
  label: string;
  to?: string;
  subItems?: SubMenuItem[];
}

const navConfig: NavItem[] = [
  {
    id: 'home',
    icon: <Home className="h-4 w-4" />,
    label: '홈',
    to: '/',
  },
  {
    id: 'dashboard',
    icon: <LayoutDashboard className="h-4 w-4" />,
    label: '대시보드',
    subItems: [
      {
        to: '/dashboard',
        icon: <Activity className="h-4 w-4" />,
        label: '라이브 대시보드',
        description: '실시간 뉴스 현황'
      },
      {
        to: '/operations',
        icon: <Gauge className="h-4 w-4" />,
        label: '운영 현황',
        description: '시스템 모니터링'
      },
      {
        to: '/collected-data',
        icon: <Database className="h-4 w-4" />,
        label: '수집 데이터',
        description: '수집된 뉴스 데이터'
      },
    ],
  },
  {
    id: 'tools',
    icon: <Wrench className="h-4 w-4" />,
    label: '도구',
    to: '/tools', // 허브 페이지로 직접 이동 가능
    subItems: [
      {
        to: '/tools',
        icon: <Wrench className="h-4 w-4" />,
        label: '도구 허브',
        description: '모든 도구 보기'
      },
      {
        to: '/search',
        icon: <Search className="h-4 w-4" />,
        label: '스마트 검색',
        description: '통합 뉴스 검색'
      },
      {
        to: '/ml-addons',
        icon: <Cpu className="h-4 w-4" />,
        label: 'ML Add-ons',
        description: '편향성, 감정 분석'
      },
      {
        to: '/ml-results',
        icon: <Sparkles className="h-4 w-4" />,
        label: 'ML 분석 결과',
        description: '분석 결과 확인'
      },
      {
        to: '/ai-agent',
        icon: <Bot className="h-4 w-4" />,
        label: '브라우저 에이전트',
        description: 'AI 웹 자동화'
      },
      {
        to: '/ai-jobs',
        icon: <Brain className="h-4 w-4" />,
        label: 'AI Jobs',
        description: 'AI 작업 관리'
      },
    ],
  },
  {
    id: 'workspace',
    icon: <FolderKanban className="h-4 w-4" />,
    label: '내 작업',
    to: '/workspace', // 허브 페이지로 직접 이동 가능
    subItems: [
      {
        to: '/workspace',
        icon: <FolderKanban className="h-4 w-4" />,
        label: '작업 허브',
        description: '모든 작업 보기'
      },
      {
        to: '/projects',
        icon: <FolderOpen className="h-4 w-4" />,
        label: '프로젝트',
        description: '저장된 분석 프로젝트'
      },
      {
        to: '/history',
        icon: <History className="h-4 w-4" />,
        label: '검색 기록',
        description: '최근 검색 내역'
      },
      {
        to: '/url-collections',
        icon: <Globe className="h-4 w-4" />,
        label: 'URL 컬렉션',
        description: 'URL 원천 관리'
      },
    ],
  },
  {
    id: 'settings',
    icon: <Settings className="h-4 w-4" />,
    label: '설정',
    subItems: [
      {
        to: '/settings',
        icon: <Settings className="h-4 w-4" />,
        label: '환경 설정',
        description: '앱 설정'
      },
      {
        to: '/admin',
        icon: <Shield className="h-4 w-4" />,
        label: '관리자 대시보드',
        description: 'ML 학습 및 시스템 관리'
      },
      {
        to: '/admin/sources',
        icon: <Newspaper className="h-4 w-4" />,
        label: '소스 관리',
        description: '뉴스 소스 관리'
      },
      {
        to: '/admin/environments',
        icon: <Server className="h-4 w-4" />,
        label: '환경 변수',
        description: '서버 환경 설정'
      },
      {
        to: '/admin/scripts',
        icon: <Terminal className="h-4 w-4" />,
        label: '스크립트',
        description: '자동화 스크립트'
      },
      {
        to: '/admin/audit-logs',
        icon: <FileText className="h-4 w-4" />,
        label: '감사 로그',
        description: '시스템 로그'
      },
      {
        to: '/admin/llm-providers',
        icon: <Zap className="h-4 w-4" />,
        label: 'LLM Providers',
        description: 'AI 제공자 설정'
      },
      {
        to: '/admin/config-export',
        icon: <FileJson className="h-4 w-4" />,
        label: '설정 Export/Import',
        description: '설정 백업 및 복원'
      },
    ],
  },
];

interface DropdownMenuProps {
  items: SubMenuItem[];
  isOpen: boolean;
  onClose: () => void;
}

function DropdownMenu({ items, isOpen, onClose }: DropdownMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className="absolute top-full left-0 mt-1 w-64 bg-popover border rounded-lg shadow-lg py-2 z-50"
    >
      {items.map((item) => {
        const isActive = location.pathname === item.to;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onClose}
            className={cn(
              // Minimum 44px touch target height for accessibility
              "flex items-start gap-3 px-4 py-3 min-h-[44px] hover:bg-accent transition-colors",
              isActive && "bg-accent"
            )}
          >
            <span className={cn(
              "mt-0.5",
              isActive ? "text-primary" : "text-muted-foreground"
            )}>
              {item.icon}
            </span>
            <div className="flex-1 min-w-0">
              <div className={cn(
                "text-sm font-medium",
                isActive && "text-primary"
              )}>
                {item.label}
              </div>
              {item.description && (
                <div className="text-xs text-muted-foreground truncate">
                  {item.description}
                </div>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

interface NavButtonProps {
  item: NavItem;
  isActive: boolean;
}

function NavButton({ item, isActive }: NavButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Direct link (no submenu)
  if (item.to && !item.subItems) {
    return (
      <Link
        to={item.to}
        className={cn(
          // Minimum 44px touch target for accessibility
          "flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium transition-all",
          isActive
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground hover:bg-accent"
        )}
      >
        {item.icon}
        <span className="hidden lg:inline">{item.label}</span>
      </Link>
    );
  }

  // Dropdown menu
  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          // Minimum 44px touch target for accessibility
          "flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium transition-all",
          isActive
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground hover:bg-accent"
        )}
      >
        {item.icon}
        <span className="hidden lg:inline">{item.label}</span>
        <ChevronDown className={cn(
          "h-3 w-3 transition-transform hidden lg:block",
          isOpen && "rotate-180"
        )} />
      </button>
      {item.subItems && (
        <DropdownMenu
          items={item.subItems}
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}

export function NewNavigation() {
  const location = useLocation();

  const isNavActive = (item: NavItem): boolean => {
    if (item.to) {
      return location.pathname === item.to;
    }
    if (item.subItems) {
      return item.subItems.some(sub => location.pathname === sub.to);
    }
    return false;
  };

  return (
    <nav className="flex items-center gap-1" role="navigation" aria-label="주요 내비게이션">
      {navConfig.map((item) => (
        <NavButton
          key={item.id}
          item={item}
          isActive={isNavActive(item)}
        />
      ))}
    </nav>
  );
}

// Mobile Navigation - 하단 탭바 스타일
export function MobileBottomNav() {
  const location = useLocation();

  const mobileItems = navConfig.slice(0, 5); // 5탭만

  const isNavActive = (item: NavItem): boolean => {
    if (item.to) {
      return location.pathname === item.to;
    }
    if (item.subItems) {
      return item.subItems.some(sub => location.pathname === sub.to);
    }
    return false;
  };

  return (
    <nav 
      className="fixed bottom-0 left-0 right-0 bg-background border-t md:hidden z-50 safe-area-inset-bottom"
      role="navigation"
      aria-label="모바일 내비게이션"
    >
      <div className="flex items-center justify-around py-1 pb-safe">
        {mobileItems.map((item) => {
          const isActive = isNavActive(item);
          const to = item.to || item.subItems?.[0]?.to || '/';
          
          return (
            <Link
              key={item.id}
              to={to}
              className={cn(
                // Minimum 44x44px touch target for WCAG 2.1 AA compliance
                "flex flex-col items-center justify-center gap-1 min-w-[48px] min-h-[48px] px-3 py-2 rounded-lg transition-colors",
                // Active indicator with visual feedback
                isActive
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground active:bg-accent"
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <span className={cn(
                "flex items-center justify-center w-6 h-6",
                isActive && "scale-110 transition-transform"
              )}>
                {item.icon}
              </span>
              <span className="text-[10px] font-medium leading-tight">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default NewNavigation;
