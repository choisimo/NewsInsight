/**
 * ToolsHub - 도구 허브 페이지
 * 
 * 모든 분석 도구를 한눈에 보여주고 빠르게 접근할 수 있게 합니다.
 * - 스마트 검색
 * - ML Add-ons (편향성, 감정 분석)
 * - 브라우저 에이전트
 * - AI Jobs
 */

import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Search,
  Cpu,
  Bot,
  Brain,
  ArrowRight,
  Zap,
  Shield,
  BarChart3,
  Globe,
  Sparkles,
} from 'lucide-react';

interface ToolCardProps {
  to: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  features: string[];
  badge?: string;
  badgeVariant?: 'default' | 'secondary' | 'outline';
}

function ToolCard({ to, icon, title, description, features, badge, badgeVariant = 'secondary' }: ToolCardProps) {
  return (
    <Link to={to} className="block group">
      <Card className="h-full transition-all hover:shadow-lg hover:border-primary/50 group-hover:bg-accent/30">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="p-3 rounded-lg bg-primary/10 text-primary">
              {icon}
            </div>
            {badge && (
              <Badge variant={badgeVariant}>{badge}</Badge>
            )}
          </div>
          <CardTitle className="text-lg mt-4 flex items-center gap-2">
            {title}
            <ArrowRight className="h-4 w-4 opacity-0 -translate-x-2 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {features.map((feature, idx) => (
              <li key={idx} className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                {feature}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </Link>
  );
}

const tools: ToolCardProps[] = [
  {
    to: '/search',
    icon: <Search className="h-6 w-6" />,
    title: '스마트 검색',
    description: '통합 뉴스 검색 및 분석 허브',
    features: [
      '빠른 검색 / 심층 분석 / 팩트체크 모드',
      '멀티소스 뉴스 통합 검색',
      'AI 기반 요약 및 분석',
    ],
    badge: '핵심 기능',
    badgeVariant: 'default',
  },
  {
    to: '/ml-addons',
    icon: <Cpu className="h-6 w-6" />,
    title: 'ML Add-ons',
    description: '고급 ML 분석 도구',
    features: [
      '뉴스 편향성 분석',
      '감정/논조 분석',
      '주제 클러스터링',
    ],
    badge: 'AI',
  },
  {
    to: '/ai-agent',
    icon: <Bot className="h-6 w-6" />,
    title: '브라우저 에이전트',
    description: 'AI 웹 자동화 도구',
    features: [
      '자연어로 웹 탐색 명령',
      '자동 데이터 수집',
      '스크린샷 기반 분석',
    ],
    badge: 'Beta',
  },
  {
    to: '/ai-jobs',
    icon: <Brain className="h-6 w-6" />,
    title: 'AI Jobs',
    description: 'AI 작업 관리 및 모니터링',
    features: [
      '배치 분석 작업 관리',
      '작업 스케줄링',
      '결과 히스토리 조회',
    ],
  },
];

export function ToolsHub() {
  return (
    <div className="container py-8 px-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">도구</h1>
        <p className="text-muted-foreground text-lg">
          AI 기반 뉴스 분석을 위한 다양한 도구를 활용하세요
        </p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Link to="/search?mode=deep">
          <Button variant="outline" className="w-full h-auto py-4 flex flex-col gap-2">
            <Zap className="h-5 w-5 text-amber-500" />
            <span className="text-sm font-medium">심층 분석</span>
          </Button>
        </Link>
        <Link to="/search?mode=factcheck">
          <Button variant="outline" className="w-full h-auto py-4 flex flex-col gap-2">
            <Shield className="h-5 w-5 text-green-500" />
            <span className="text-sm font-medium">팩트체크</span>
          </Button>
        </Link>
        <Link to="/ml-addons">
          <Button variant="outline" className="w-full h-auto py-4 flex flex-col gap-2">
            <BarChart3 className="h-5 w-5 text-blue-500" />
            <span className="text-sm font-medium">편향성 분석</span>
          </Button>
        </Link>
        <Link to="/ai-agent">
          <Button variant="outline" className="w-full h-auto py-4 flex flex-col gap-2">
            <Globe className="h-5 w-5 text-purple-500" />
            <span className="text-sm font-medium">URL 분석</span>
          </Button>
        </Link>
      </div>

      {/* Tool Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {tools.map((tool) => (
          <ToolCard key={tool.to} {...tool} />
        ))}
      </div>

      {/* Tip Section */}
      <Card className="mt-8 bg-primary/5 border-primary/20">
        <CardContent className="py-6">
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-lg bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold mb-1">Pro Tip</h3>
              <p className="text-sm text-muted-foreground">
                <kbd className="px-1.5 py-0.5 rounded bg-background text-xs mr-1">Ctrl+K</kbd>를 눌러
                어디서든 빠르게 검색하고 도구에 접근할 수 있습니다.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default ToolsHub;
