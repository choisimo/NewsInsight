/**
 * NewHome - 새로운 홈 페이지
 * 
 * 구조:
 * - HeroSearchBar: 중앙 대형 검색창
 * - ContinueCard: 이어하기 카드
 * - QuickActionCards: 빠른 액션 (심층분석, 팩트체크, URL분석)
 * - 사이드: TrendingTopics, RecentSearches, UsageStreak
 * - 하단: DailyInsightCard, RecommendedTemplates
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  HeroSearchBar,
  ContinueCard,
  QuickActionCards,
  TrendingTopics,
  TrendingTopicsCompact,
  RecentSearches,
  RecentSearchesCompact,
  RecommendedTemplates,
  DailyInsightCard,
  UsageStreakCard,
} from '@/components/home';
import { useContinueWork } from '@/hooks/useContinueWork';
import { useUsageStreak } from '@/hooks/useUsageStreak';
import { useTrendingTopics } from '@/hooks/useTrendingTopics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles, TrendingUp } from 'lucide-react';

export function NewHome() {
  const navigate = useNavigate();
  const { lastWork, recentWorks } = useContinueWork();
  const { streak, weeklyStats, recordVisit } = useUsageStreak();
  const { trending, recommended, isLoading: trendingLoading } = useTrendingTopics();

  // 검색 실행
  const handleSearch = (query: string, mode: 'quick' | 'deep' | 'factcheck') => {
    const modeParam = mode === 'quick' ? '' : `?mode=${mode}`;
    navigate(`/search${modeParam}`, { state: { query } });
  };

  // 검색 기록 (localStorage에서)
  const [recentSearches] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('newsinsight_recent_searches');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // 최근 검색 클릭
  const handleRecentSearchClick = (query: string) => {
    navigate('/search', { state: { query } });
  };

  // 트렌드 클릭
  const handleTrendingClick = (keyword: string) => {
    navigate('/search', { state: { query: keyword } });
  };

  // 이어하기 클릭
  const handleContinueWork = () => {
    if (lastWork) {
      navigate(lastWork.path);
    }
  };

  // 빠른 액션 클릭
  const handleQuickAction = (action: string) => {
    switch (action) {
      case 'deep':
        navigate('/search?mode=deep');
        break;
      case 'factcheck':
        navigate('/search?mode=factcheck');
        break;
      case 'url':
        navigate('/ai-agent');
        break;
      case 'bias':
        navigate('/ml-addons');
        break;
    }
  };

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
              AI 기반 뉴스 분석 플랫폼
            </p>
          </div>

          {/* 메인 검색창 */}
          <HeroSearchBar
            onSearch={handleSearch}
            placeholder="뉴스 키워드, URL, 또는 분석하고 싶은 주제를 입력하세요..."
            className="max-w-2xl mx-auto"
          />

          {/* 연속 사용 뱃지 */}
          {streak > 0 && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary/10 rounded-full text-sm">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="font-medium">{streak}일 연속 사용 중!</span>
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
              {lastWork && (
                <ContinueCard
                  work={lastWork}
                  onContinue={handleContinueWork}
                />
              )}

              {/* 빠른 액션 카드들 */}
              <QuickActionCards onAction={handleQuickAction} />

              {/* 오늘의 논쟁 이슈 */}
              <DailyInsightCard />

              {/* 추천 템플릿 */}
              <RecommendedTemplates />
            </div>

            {/* Right Column - 사이드바 */}
            <div className="space-y-6">
              {/* 사용 현황 */}
              <UsageStreakCard
                streak={streak}
                weeklyStats={weeklyStats}
              />

              {/* 오늘의 트렌드 */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    오늘의 트렌드
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {trendingLoading ? (
                    <div className="space-y-2">
                      {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-8 bg-muted animate-pulse rounded" />
                      ))}
                    </div>
                  ) : (
                    <TrendingTopicsCompact
                      topics={trending}
                      onTopicClick={handleTrendingClick}
                    />
                  )}
                </CardContent>
              </Card>

              {/* 최근 검색 */}
              {recentSearches.length > 0 && (
                <RecentSearchesCompact
                  searches={recentSearches}
                  onSearchClick={handleRecentSearchClick}
                  maxItems={5}
                />
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default NewHome;
