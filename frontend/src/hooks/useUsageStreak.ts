/**
 * useUsageStreak - 연속 사용 일수 및 활동 통계 추적
 * 
 * 기능:
 * - 연속 사용 일수 (streak) 계산
 * - 주간/월간 검색 횟수
 * - 누적 분석 건수
 * - 사용 패턴 분석
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { getSearchStatistics } from '@/lib/api';

export interface DayActivity {
  date: string;  // YYYY-MM-DD
  count: number;
  hasActivity: boolean;
}

export interface UsageStats {
  // 연속 사용
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string | null;
  
  // 주간 통계
  weeklySearchCount: number;
  weeklyFactCheckCount: number;
  weeklyDeepSearchCount: number;
  weeklyTotal: number;
  
  // 월간/전체 통계
  monthlyTotal: number;
  totalSearches: number;
  totalAnalyses: number;
  
  // 일별 활동 (최근 7일)
  weeklyActivity: DayActivity[];
  
  // 평균
  averageSearchesPerDay: number;
  averageResultsPerSearch: number;
}

interface UseUsageStreakReturn {
  stats: UsageStats;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  recordActivity: () => void;
}

const STORAGE_KEY = 'newsinsight_usage_streak';
const ACTIVITY_STORAGE_KEY = 'newsinsight_daily_activity';

interface StoredStreakData {
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string | null;
  activityDates: string[];  // YYYY-MM-DD 형식 배열
}

// 날짜를 YYYY-MM-DD 형식으로 변환
const formatDate = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

// 오늘 날짜 (로컬 시간 기준)
const getToday = (): string => {
  const now = new Date();
  return formatDate(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
};

// 어제 날짜
const getYesterday = (): string => {
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return formatDate(yesterday);
};

// 최근 N일 날짜 배열 생성
const getRecentDates = (days: number): string[] => {
  const dates: string[] = [];
  const now = new Date();
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    dates.push(formatDate(date));
  }
  
  return dates;
};

// 요일 이름 (한국어)
export const getDayName = (dateStr: string): string => {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const date = new Date(dateStr);
  return days[date.getDay()];
};

/**
 * 연속 사용 및 활동 통계 Hook
 */
export function useUsageStreak(): UseUsageStreakReturn {
  const [stats, setStats] = useState<UsageStats>({
    currentStreak: 0,
    longestStreak: 0,
    lastActiveDate: null,
    weeklySearchCount: 0,
    weeklyFactCheckCount: 0,
    weeklyDeepSearchCount: 0,
    weeklyTotal: 0,
    monthlyTotal: 0,
    totalSearches: 0,
    totalAnalyses: 0,
    weeklyActivity: [],
    averageSearchesPerDay: 0,
    averageResultsPerSearch: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 저장된 streak 데이터 불러오기
  const loadStoredData = useCallback((): StoredStreakData => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.error('Failed to load streak data:', e);
    }
    return {
      currentStreak: 0,
      longestStreak: 0,
      lastActiveDate: null,
      activityDates: [],
    };
  }, []);

  // streak 데이터 저장
  const saveStoredData = useCallback((data: StoredStreakData) => {
    try {
      // 최근 90일 활동만 유지
      const recentDates = data.activityDates.slice(-90);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...data,
        activityDates: recentDates,
      }));
    } catch (e) {
      console.error('Failed to save streak data:', e);
    }
  }, []);

  // streak 계산
  const calculateStreak = useCallback((activityDates: string[], today: string): { current: number; longest: number } => {
    if (activityDates.length === 0) {
      return { current: 0, longest: 0 };
    }

    // 날짜 정렬 (오름차순)
    const sortedDates = [...new Set(activityDates)].sort();
    
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 1;
    
    // 오늘 또는 어제 활동이 있어야 현재 streak 유지
    const yesterday = getYesterday();
    const hasRecentActivity = sortedDates.includes(today) || sortedDates.includes(yesterday);
    
    // 연속일 계산
    for (let i = 1; i < sortedDates.length; i++) {
      const prevDate = new Date(sortedDates[i - 1]);
      const currDate = new Date(sortedDates[i]);
      const diffDays = Math.floor((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diffDays === 1) {
        tempStreak++;
      } else {
        longestStreak = Math.max(longestStreak, tempStreak);
        tempStreak = 1;
      }
    }
    
    longestStreak = Math.max(longestStreak, tempStreak);
    
    // 현재 streak 계산 (가장 최근 연속 활동)
    if (hasRecentActivity) {
      currentStreak = 1;
      const startDate = sortedDates.includes(today) ? today : yesterday;
      let checkDate = new Date(startDate);
      
      for (let i = sortedDates.length - 1; i >= 0; i--) {
        const activityDate = sortedDates[i];
        if (activityDate === formatDate(checkDate)) {
          currentStreak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else if (activityDate < formatDate(checkDate)) {
          break;
        }
      }
      currentStreak--; // 시작점 중복 제거
    }
    
    return { current: Math.max(0, currentStreak), longest: longestStreak };
  }, []);

  // 서버에서 통계 가져오기 및 로컬 데이터 통합
  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const today = getToday();
      const storedData = loadStoredData();
      
      // 서버 통계 가져오기
      let serverStats = null;
      try {
        serverStats = await getSearchStatistics(30);
      } catch (e) {
        console.warn('Failed to fetch server statistics:', e);
      }
      
      // streak 계산
      const { current, longest } = calculateStreak(storedData.activityDates, today);
      
      // 주간 활동 데이터 생성
      const recentDates = getRecentDates(7);
      const weeklyActivity: DayActivity[] = recentDates.map(date => ({
        date,
        count: storedData.activityDates.filter(d => d === date).length || 
               (serverStats ? 1 : 0),  // 서버 데이터 기반 추정
        hasActivity: storedData.activityDates.includes(date),
      }));
      
      // 통계 계산
      const weeklyTotal = serverStats?.totalSearches || storedData.activityDates.filter(d => 
        recentDates.includes(d)
      ).length;
      
      const byType = serverStats?.byType || [];
      const unifiedCount = byType.find(t => t.searchType === 'UNIFIED')?.count || 0;
      const deepCount = byType.find(t => t.searchType === 'DEEP_SEARCH')?.count || 0;
      const factCheckCount = byType.find(t => t.searchType === 'FACT_CHECK')?.count || 0;
      
      // 평균 계산
      const activeDays = storedData.activityDates.length;
      const avgPerDay = activeDays > 0 ? weeklyTotal / Math.min(activeDays, 7) : 0;
      const avgResults = byType.reduce((sum, t) => sum + (t.avgResults || 0), 0) / Math.max(byType.length, 1);
      
      setStats({
        currentStreak: current,
        longestStreak: Math.max(longest, storedData.longestStreak),
        lastActiveDate: storedData.lastActiveDate,
        weeklySearchCount: unifiedCount,
        weeklyFactCheckCount: factCheckCount,
        weeklyDeepSearchCount: deepCount,
        weeklyTotal,
        monthlyTotal: serverStats?.totalSearches || weeklyTotal * 4,
        totalSearches: serverStats?.totalSearches || 0,
        totalAnalyses: deepCount + factCheckCount,
        weeklyActivity,
        averageSearchesPerDay: Math.round(avgPerDay * 10) / 10,
        averageResultsPerSearch: Math.round(avgResults * 10) / 10,
      });
      
      // longest streak 업데이트
      if (longest > storedData.longestStreak) {
        saveStoredData({
          ...storedData,
          longestStreak: longest,
        });
      }
      
    } catch (e) {
      setError(e instanceof Error ? e.message : '통계를 불러오는데 실패했습니다.');
      console.error('Failed to load usage stats:', e);
    } finally {
      setIsLoading(false);
    }
  }, [loadStoredData, saveStoredData, calculateStreak]);

  // 오늘 활동 기록
  const recordActivity = useCallback(() => {
    const today = getToday();
    const storedData = loadStoredData();
    
    // 이미 오늘 기록이 있으면 스킵
    if (storedData.lastActiveDate === today) {
      return;
    }
    
    const newActivityDates = [...storedData.activityDates, today];
    const { current, longest } = calculateStreak(newActivityDates, today);
    
    const newData: StoredStreakData = {
      currentStreak: current,
      longestStreak: Math.max(longest, storedData.longestStreak),
      lastActiveDate: today,
      activityDates: newActivityDates,
    };
    
    saveStoredData(newData);
    
    // 상태 업데이트
    setStats(prev => ({
      ...prev,
      currentStreak: current,
      longestStreak: newData.longestStreak,
      lastActiveDate: today,
    }));
  }, [loadStoredData, saveStoredData, calculateStreak]);

  // 초기 로드
  useEffect(() => {
    refresh();
  }, []);

  // 페이지 방문 시 활동 기록
  useEffect(() => {
    recordActivity();
  }, [recordActivity]);

  return {
    stats,
    isLoading,
    error,
    refresh,
    recordActivity,
  };
}

export default useUsageStreak;
