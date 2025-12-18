/**
 * useTrendingTopics - 트렌드 이슈 및 개인화 추천 주제 제공
 * 
 * 기능:
 * - 사용자 검색 기록 기반 개인화 토픽 추천
 * - 백엔드 트렌딩 API 연동 준비 (현재 미구현)
 * 
 * 참고: 트렌딩 토픽 API가 구현되면 fetchTrendingTopics() 함수를 활성화하세요
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
  hasTrendingApi: boolean; // 트렌딩 API 사용 가능 여부
  refresh: () => Promise<void>;
}

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
    searchUrl: `/search?q=${encodeURIComponent(query)}`,
  }));
};

/**
 * 트렌딩 토픽 및 개인화 추천 Hook
 * 
 * 현재 상태:
 * - 트렌딩 API가 아직 구현되지 않아 topics는 빈 배열 반환
 * - personalizedTopics는 사용자 검색 기록 기반으로 생성
 * 
 * 향후 개선:
 * - 백엔드에 트렌딩 API 구현 후 fetchTrendingTopics() 연동
 * - 예: GET /api/v1/trending/topics
 */
export function useTrendingTopics(): UseTrendingTopicsReturn {
  const [topics, setTopics] = useState<TrendingTopic[]>([]);
  const [personalizedTopics, setPersonalizedTopics] = useState<TrendingTopic[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasTrendingApi] = useState(false); // 트렌딩 API 구현 시 true로 변경

  // 데이터 새로고침
  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // 검색 히스토리에서 개인화 토픽 추출
      const historyResponse = await listSearchHistory(0, 50, 'createdAt', 'DESC');
      const personalTopics = extractPersonalizedTopics(historyResponse.content);
      setPersonalizedTopics(personalTopics);
      
      // TODO: 백엔드 트렌딩 API 구현 시 활성화
      // 예시:
      // try {
      //   const trendingResponse = await fetchTrendingTopics();
      //   setTopics(trendingResponse);
      //   setHasTrendingApi(true);
      // } catch {
      //   // 트렌딩 API 실패 시 빈 배열 유지
      //   setTopics([]);
      // }
      
      // 현재는 트렌딩 API가 없으므로 빈 배열
      setTopics([]);
      
    } catch (e) {
      setError(e instanceof Error ? e.message : '데이터를 불러오는데 실패했습니다.');
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
    hasTrendingApi,
    refresh,
  };
}

export default useTrendingTopics;
