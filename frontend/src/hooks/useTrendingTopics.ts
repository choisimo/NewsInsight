/**
 * useTrendingTopics - 실시간 트렌드 이슈 및 논쟁 주제 제공
 * 
 * 기능:
 * - 오늘의 핫 이슈 목록
 * - 입장 분포 (찬/반/중립)
 * - 관련 뉴스 수
 * - 개인화된 추천 주제
 */

import { useState, useEffect, useCallback } from 'react';
import { listSearchHistory, type SearchHistoryRecord } from '@/lib/api';

export interface TrendingTopic {
  id: string;
  title: string;
  description?: string;
  category?: string;
  
  // 입장 분포
  stanceDistribution?: {
    pro: number;
    con: number;
    neutral: number;
    proRatio: number;
    conRatio: number;
    neutralRatio: number;
  };
  
  // 메타데이터
  newsCount?: number;
  searchCount?: number;
  lastUpdated: string;
  
  // 트렌드 지표
  trendScore?: number;  // 0-100
  isHot?: boolean;
  isRising?: boolean;
  
  // 액션
  searchUrl: string;
}

interface UseTrendingTopicsReturn {
  topics: TrendingTopic[];
  personalizedTopics: TrendingTopic[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// 기본 트렌딩 토픽 (실제 서비스에서는 API로 대체)
const DEFAULT_TRENDING_TOPICS: TrendingTopic[] = [
  {
    id: 'trend_1',
    title: 'AI 규제 법안 논의',
    description: '인공지능 기술 규제에 대한 찬반 입장이 첨예',
    category: '기술/정책',
    stanceDistribution: {
      pro: 45,
      con: 35,
      neutral: 20,
      proRatio: 45,
      conRatio: 35,
      neutralRatio: 20,
    },
    newsCount: 127,
    searchCount: 89,
    lastUpdated: new Date().toISOString(),
    trendScore: 85,
    isHot: true,
    isRising: true,
    searchUrl: '/?mode=deep&q=AI+규제+법안',
  },
  {
    id: 'trend_2',
    title: '금리 동결 전망',
    description: '한국은행 기준금리 결정에 대한 전문가 의견',
    category: '경제',
    stanceDistribution: {
      pro: 40,
      con: 30,
      neutral: 30,
      proRatio: 40,
      conRatio: 30,
      neutralRatio: 30,
    },
    newsCount: 98,
    searchCount: 67,
    lastUpdated: new Date().toISOString(),
    trendScore: 78,
    isHot: true,
    isRising: false,
    searchUrl: '/?mode=deep&q=기준금리+동결',
  },
  {
    id: 'trend_3',
    title: '기후변화 대응 정책',
    description: '탄소중립 목표와 산업계 영향에 대한 분석',
    category: '환경',
    stanceDistribution: {
      pro: 55,
      con: 25,
      neutral: 20,
      proRatio: 55,
      conRatio: 25,
      neutralRatio: 20,
    },
    newsCount: 156,
    searchCount: 112,
    lastUpdated: new Date().toISOString(),
    trendScore: 72,
    isHot: false,
    isRising: true,
    searchUrl: '/?mode=deep&q=기후변화+탄소중립',
  },
  {
    id: 'trend_4',
    title: '반도체 수출 규제',
    description: '미중 기술 갈등과 한국 반도체 산업 영향',
    category: '산업/무역',
    stanceDistribution: {
      pro: 30,
      con: 45,
      neutral: 25,
      proRatio: 30,
      conRatio: 45,
      neutralRatio: 25,
    },
    newsCount: 203,
    searchCount: 145,
    lastUpdated: new Date().toISOString(),
    trendScore: 91,
    isHot: true,
    isRising: true,
    searchUrl: '/?mode=deep&q=반도체+수출+규제',
  },
  {
    id: 'trend_5',
    title: '부동산 정책 효과',
    description: '최근 부동산 정책의 시장 영향 분석',
    category: '부동산',
    stanceDistribution: {
      pro: 35,
      con: 50,
      neutral: 15,
      proRatio: 35,
      conRatio: 50,
      neutralRatio: 15,
    },
    newsCount: 178,
    searchCount: 134,
    lastUpdated: new Date().toISOString(),
    trendScore: 68,
    isHot: false,
    isRising: false,
    searchUrl: '/?mode=deep&q=부동산+정책',
  },
];

// 검색 히스토리에서 개인화 토픽 추출
const extractPersonalizedTopics = (history: SearchHistoryRecord[]): TrendingTopic[] => {
  const queryCount = new Map<string, { count: number; lastSearched: string; results: number }>();
  
  // 쿼리별 빈도 계산
  history.forEach(item => {
    const query = item.query.toLowerCase().trim();
    if (query.length < 2) return;
    
    const existing = queryCount.get(query);
    if (existing) {
      existing.count++;
      existing.results += item.resultCount || 0;
      if (new Date(item.createdAt) > new Date(existing.lastSearched)) {
        existing.lastSearched = item.createdAt;
      }
    } else {
      queryCount.set(query, {
        count: 1,
        lastSearched: item.createdAt,
        results: item.resultCount || 0,
      });
    }
  });
  
  // 빈도순 정렬 후 상위 5개 추출
  const sortedQueries = Array.from(queryCount.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);
  
  return sortedQueries.map(([query, data], index) => ({
    id: `personal_${index}`,
    title: query.charAt(0).toUpperCase() + query.slice(1),
    description: `${data.count}회 검색, ${data.results}개 결과`,
    searchCount: data.count,
    lastUpdated: data.lastSearched,
    trendScore: Math.min(100, data.count * 20),
    searchUrl: `/?q=${encodeURIComponent(query)}`,
  }));
};

/**
 * 트렌딩 토픽 및 개인화 추천 Hook
 */
export function useTrendingTopics(): UseTrendingTopicsReturn {
  const [topics, setTopics] = useState<TrendingTopic[]>(DEFAULT_TRENDING_TOPICS);
  const [personalizedTopics, setPersonalizedTopics] = useState<TrendingTopic[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 데이터 새로고침
  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // 검색 히스토리에서 개인화 토픽 추출
      const historyResponse = await listSearchHistory(0, 50, 'createdAt', 'DESC');
      const personalTopics = extractPersonalizedTopics(historyResponse.content);
      setPersonalizedTopics(personalTopics);
      
      // TODO: 실제 트렌딩 API 연동 시 여기서 호출
      // const trendingResponse = await fetchTrendingTopics();
      // setTopics(trendingResponse);
      
      // 현재는 기본 데이터 + 시간 기반 랜덤화
      const shuffled = [...DEFAULT_TRENDING_TOPICS]
        .sort(() => Math.random() - 0.5)
        .map(topic => ({
          ...topic,
          lastUpdated: new Date().toISOString(),
          trendScore: Math.floor(topic.trendScore! + (Math.random() * 10 - 5)),
        }));
      
      setTopics(shuffled);
      
    } catch (e) {
      setError(e instanceof Error ? e.message : '트렌드를 불러오는데 실패했습니다.');
      console.error('Failed to load trending topics:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 초기 로드
  useEffect(() => {
    refresh();
  }, []);

  // 5분마다 자동 새로고침
  useEffect(() => {
    const interval = setInterval(refresh, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refresh]);

  return {
    topics,
    personalizedTopics,
    isLoading,
    error,
    refresh,
  };
}

export default useTrendingTopics;
