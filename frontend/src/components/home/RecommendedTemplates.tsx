/**
 * RecommendedTemplates - 추천 템플릿
 * 
 * 자주 사용하는 검색 패턴을 템플릿으로 제공
 * - 즐겨찾기 템플릿
 * - 최근 사용 템플릿
 * - 기본 추천 템플릿
 */

import { Link } from 'react-router-dom';
import {
  FileText,
  Star,
  Zap,
  ArrowRight,
  Search,
  Layers,
  Shield,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface SearchTemplate {
  id: number;
  name: string;
  query: string;
  mode: 'unified' | 'deep' | 'factcheck';
  description?: string;
  favorite?: boolean;
  useCount?: number;
}

// 기본 추천 템플릿
const DEFAULT_TEMPLATES: SearchTemplate[] = [
  {
    id: -1,
    name: '찬반 입장 비교 분석',
    query: '',
    mode: 'deep',
    description: '특정 이슈에 대한 찬성/반대 입장 수집',
    useCount: 0,
  },
  {
    id: -2,
    name: '팩트체크 리포트',
    query: '',
    mode: 'factcheck',
    description: '주장의 사실 여부를 다각도로 검증',
    useCount: 0,
  },
  {
    id: -3,
    name: '출처 신뢰도 분석',
    query: '',
    mode: 'unified',
    description: '정보 출처의 신뢰성 평가',
    useCount: 0,
  },
];

const MODE_CONFIG = {
  unified: {
    icon: Search,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
  },
  deep: {
    icon: Layers,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50 dark:bg-purple-900/20',
  },
  factcheck: {
    icon: Shield,
    color: 'text-green-600',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
  },
};

interface RecommendedTemplatesProps {
  className?: string;
  templates?: SearchTemplate[];
  isLoading?: boolean;
  onSelectTemplate?: (template: SearchTemplate) => void;
  showDefaults?: boolean;
}

export function RecommendedTemplates({
  className,
  templates = [],
  isLoading = false,
  onSelectTemplate,
  showDefaults = true,
}: RecommendedTemplatesProps) {
  // 로딩 상태
  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-28" />
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-24 w-48 flex-shrink-0" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // 즐겨찾기와 사용자 템플릿 결합
  const favoriteTemplates = templates.filter(t => t.favorite);
  const recentTemplates = templates
    .filter(t => !t.favorite && t.useCount && t.useCount > 0)
    .sort((a, b) => (b.useCount || 0) - (a.useCount || 0))
    .slice(0, 3);

  const prioritizedTemplates = [...favoriteTemplates, ...recentTemplates];
  const usedModes = new Set(prioritizedTemplates.map(t => t.mode));
  const defaultsToAdd = showDefaults
    ? DEFAULT_TEMPLATES.filter(t => !usedModes.has(t.mode))
    : [];

  const combined = [...prioritizedTemplates, ...defaultsToAdd];
  const uniqueById = Array.from(
    combined.reduce((map, t) => {
      if (!map.has(t.id)) map.set(t.id, t);
      return map;
    }, new Map<number, SearchTemplate>())
  ).map(([, t]) => t);

  const displayTemplates = uniqueById.slice(0, 6);

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-500" />
            추천 템플릿
          </CardTitle>
          <Button variant="ghost" size="sm" asChild className="text-xs h-7">
            <Link to="/workspace">
              전체 보기
              <ArrowRight className="h-3 w-3 ml-1" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {displayTemplates.length === 0 ? (
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm text-muted-foreground">
              아직 추천할 템플릿이 없습니다
            </div>
            <Button variant="outline" size="sm" asChild className="text-xs h-8">
              <Link to="/workspace">템플릿 만들기</Link>
            </Button>
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
            {displayTemplates.map(template => (
              <TemplateCard
                key={template.id}
                template={template}
                onClick={() => onSelectTemplate?.(template)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface TemplateCardProps {
  template: SearchTemplate;
  onClick?: () => void;
}

function TemplateCard({ template, onClick }: TemplateCardProps) {
  const config = MODE_CONFIG[template.mode];
  const Icon = config.icon;

  // 기본 템플릿인지 확인 (ID가 음수면 기본 템플릿)
  const isDefault = template.id < 0;

  const getTemplateUrl = () => {
    if (isDefault) {
      // 기본 템플릿은 모드만 설정
      return `/search?mode=${template.mode}`;
    }
    // 사용자 템플릿은 쿼리 포함
    const mode = template.mode === 'unified' ? '' : `mode=${template.mode}`;
    const query = template.query ? `q=${encodeURIComponent(template.query)}` : '';
    const params = [mode, query].filter(Boolean).join('&');
    return params ? `/search?${params}` : '/search';
  };

  return (
    <Link
      to={getTemplateUrl()}
      onClick={onClick}
      className={cn(
        'flex-shrink-0 w-48 p-3 rounded-lg border transition-all',
        'hover:border-primary/50 hover:shadow-sm',
        config.bgColor
      )}
    >
      <div className="flex items-start gap-2 mb-2">
        <div className={cn('p-1.5 rounded-lg bg-background/60', config.color)}>
          <Icon className="h-4 w-4" />
        </div>
        {template.favorite && (
          <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
        )}
      </div>

      <h4 className="font-medium text-sm line-clamp-1 mb-1">
        {template.name}
      </h4>

      {template.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">
          {template.description}
        </p>
      )}

      {!isDefault && template.useCount !== undefined && template.useCount > 0 && (
        <Badge variant="outline" className="mt-2 text-xs">
          {template.useCount}회 사용
        </Badge>
      )}
    </Link>
  );
}

export default RecommendedTemplates;
