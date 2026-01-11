/**
 * NewHome - 새로운 홈 페이지
 * 
 * 구조:
 * - HeroSearchBar: 중앙 대형 검색창
 * - ContinueCard: 이어하기 카드
 * - QuickActionCards: 빠른 액션 (심층분석, 팩트체크, URL분석)
 * - RecentActivities: 최근 활동 내역 (페이지네이션)
 * - 사이드: TrendingTopics, UsageStreak
 * - 하단: RecommendedTemplates
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  HeroSearchBar,
  ContinueCard,
  QuickActionCards,
  TrendingTopicsCompact,
  RecentActivities,
  RecommendedTemplates,
  UsageStreakCard,
} from '@/components/home';
import { useUsageStreak } from '@/hooks/useUsageStreak';
import { useTrendingTopics } from '@/hooks/useTrendingTopics';
import { getFavoriteTemplates, getMostUsedTemplates, type SearchTemplate } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Flame, TrendingUp } from 'lucide-react';

const DEFAULT_USER_ID = 'default-user';

export function NewHome() {
  const navigate = useNavigate();
  const { stats: usageStats, isLoading: usageLoading } = useUsageStreak();
  const { topics: trending, personalizedTopics: recommended, isLoading: trendingLoading } = useTrendingTopics();

  const [templates, setTemplates] = useState<SearchTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  
  // 트렌딩 토픽이 없으면 개인화 토픽 사용
  const displayTopics = trending.length > 0 ? trending : recommended;

  // 트렌드 클릭
  const handleTrendingClick = (keyword: string) => {
    navigate('/search', { state: { query: keyword } });
  };


  useEffect(() => {
    let cancelled = false;
    const loadTemplates = async () => {
      setTemplatesLoading(true);
      try {
        const [favorites, mostUsed] = await Promise.all([
          getFavoriteTemplates(DEFAULT_USER_ID).catch(() => []),
          getMostUsedTemplates(DEFAULT_USER_ID, 10).catch(() => []),
        ]);

        if (cancelled) return;

        const merged = new Map<number, any>();
        [...favorites, ...mostUsed].forEach((t: any) => merged.set(t.id, t));
        setTemplates(Array.from(merged.values()));
      } finally {
        if (!cancelled) setTemplatesLoading(false);
      }
    };
    loadTemplates();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-[calc(100vh-8rem)] bg-gradient-to-b from-background to-muted/20">
      {/* Hero Section - 검색창 */}
      <section className="pt-12 pb-8 px-4">
        <div className="max-w-4xl mx-auto text-center space-y-6">
          {/* 환영 메시지 */}
          <div className="space-y-2">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              오늘의 뉴스, 더 깊게 분석하세요
            </h1>
            <p className="text-muted-foreground text-lg">
              뉴스 인텔리전스 플랫폼
            </p>
          </div>

          {/* 메인 검색창 */}
          <HeroSearchBar className="max-w-2xl mx-auto" />

          {/* 연속 사용 뱃지 */}
          {!usageLoading && usageStats.currentStreak > 0 && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary/10 rounded-full text-sm">
              <Flame className="h-4 w-4 text-primary" />
              <span className="font-medium">{usageStats.currentStreak}일 연속 사용 중!</span>
            </div>
          )}
        </div>
      </section>

      {/* Main Content */}
      <section className="pb-12 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - 메인 콘텐츠 */}
            <div className="lg:col-span-2 space-y-6">
              {/* 이어하기 카드 */}
              <ContinueCard />

              {/* 빠른 액션 카드들 */}
              <QuickActionCards />

              {/* 최근 활동 내역 - 백엔드 API에서 가져옴 */}
              <RecentActivities 
                pageSize={5}
                showFilters={true}
                showHeader={true}
              />

              {/* 추천 템플릿 */}
              <RecommendedTemplates
                templates={templates}
                isLoading={templatesLoading}
                showDefaults={false}
              />
            </div>

            {/* Right Column - 사이드바 */}
            <div className="space-y-6">
              {/* 사용 현황 */}
              <UsageStreakCard />

              {/* 오늘의 트렌드 */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    {trending.length > 0 ? '오늘의 트렌드' : '내 관심 주제'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {trendingLoading ? (
                    <div className="space-y-2">
                      {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-8 bg-muted animate-pulse rounded" />
                      ))}
                    </div>
                  ) : displayTopics.length > 0 ? (
                    <TrendingTopicsCompact
                      topics={displayTopics}
                      onTopicClick={handleTrendingClick}
                    />
                  ) : (
                    <div className="text-center py-4 text-muted-foreground">
                      <p className="text-sm">아직 트렌드 데이터가 없습니다</p>
                      <p className="text-xs mt-1">검색을 시작해 보세요</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default NewHome;
