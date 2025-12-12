/**
 * QuickActionCards - 빠른 액션 카드
 * 
 * 홈 화면에서 주요 기능에 1탭으로 접근할 수 있는 카드
 * - 심층 분석
 * - 팩트체크
 * - URL 분석
 */

import { Link } from 'react-router-dom';
import {
  Brain,
  Shield,
  Link as LinkIcon,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: typeof Brain;
  color: string;
  bgColor: string;
  hoverColor: string;
  href: string;
  badge?: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'deep',
    label: '심층 분석',
    description: 'AI가 심층 증거를 수집하고 입장을 분석합니다',
    icon: Brain,
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-50 dark:bg-purple-900/20',
    hoverColor: 'hover:bg-purple-100 dark:hover:bg-purple-900/30',
    href: '/?mode=deep',
    badge: 'AI',
  },
  {
    id: 'factcheck',
    label: '팩트체크',
    description: '주장의 진위를 신뢰할 수 있는 출처로 검증합니다',
    icon: Shield,
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
    hoverColor: 'hover:bg-green-100 dark:hover:bg-green-900/30',
    href: '/?mode=factcheck',
  },
  {
    id: 'url',
    label: 'URL 분석',
    description: '뉴스 기사에서 검증 가능한 주장을 추출합니다',
    icon: LinkIcon,
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-50 dark:bg-orange-900/20',
    hoverColor: 'hover:bg-orange-100 dark:hover:bg-orange-900/30',
    href: '/?mode=urlanalysis',
  },
];

interface QuickActionCardsProps {
  className?: string;
  layout?: 'horizontal' | 'grid';
}

export function QuickActionCards({
  className,
  layout = 'horizontal',
}: QuickActionCardsProps) {
  return (
    <div
      className={cn(
        layout === 'horizontal'
          ? 'flex flex-col sm:flex-row gap-3'
          : 'grid grid-cols-1 sm:grid-cols-3 gap-3',
        className
      )}
    >
      {QUICK_ACTIONS.map(action => (
        <QuickActionCard key={action.id} action={action} />
      ))}
    </div>
  );
}

interface QuickActionCardProps {
  action: QuickAction;
}

function QuickActionCard({ action }: QuickActionCardProps) {
  const Icon = action.icon;

  return (
    <Link to={action.href} className="flex-1">
      <Card
        className={cn(
          'group relative overflow-hidden transition-all duration-200',
          'border-2 border-transparent',
          action.bgColor,
          action.hoverColor,
          'hover:border-primary/30 hover:shadow-md'
        )}
      >
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start gap-3">
            {/* 아이콘 */}
            <div
              className={cn(
                'p-2.5 rounded-xl bg-background/60 shadow-sm',
                'group-hover:scale-110 transition-transform duration-200',
                action.color
              )}
            >
              <Icon className="h-6 w-6" />
            </div>

            {/* 내용 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-base">{action.label}</h3>
                {action.badge && (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium',
                      'bg-primary/10 text-primary'
                    )}
                  >
                    <Sparkles className="h-3 w-3" />
                    {action.badge}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2">
                {action.description}
              </p>
            </div>

            {/* 화살표 */}
            <ArrowRight
              className={cn(
                'h-5 w-5 text-muted-foreground/50',
                'group-hover:text-primary group-hover:translate-x-1',
                'transition-all duration-200'
              )}
            />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default QuickActionCards;
