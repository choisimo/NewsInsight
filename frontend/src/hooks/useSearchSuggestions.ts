import { useState, useEffect, useCallback, useMemo } from "react";

/**
 * 검색 제안 훅
 * - 최근 검색어 저장/불러오기
 * - 검색어 기반 제안 생성
 * - 로컬 스토리지 기반
 */

const STORAGE_KEY = "newsinsight-search-history";
const MAX_HISTORY = 20;
const MAX_SUGGESTIONS = 8;

export interface SearchSuggestion {
  type: "history" | "suggestion" | "trending";
  text: string;
  timestamp?: number;
  count?: number;
}

interface UseSearchSuggestionsOptions {
  /** 기본 제안 키워드 */
  defaultSuggestions?: string[];
  /** 트렌딩 키워드 (API에서 가져올 수 있음) */
  trendingKeywords?: string[];
  /** 최대 제안 수 */
  maxSuggestions?: number;
}

export function useSearchSuggestions(options: UseSearchSuggestionsOptions = {}) {
  const {
    defaultSuggestions = [],
    trendingKeywords = [],
    maxSuggestions = MAX_SUGGESTIONS,
  } = options;

  // 검색 히스토리 상태
  const [searchHistory, setSearchHistory] = useState<SearchSuggestion[]>([]);

  // 초기 로드
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as SearchSuggestion[];
        setSearchHistory(parsed);
      }
    } catch (e) {
      console.error("Failed to load search history:", e);
    }
  }, []);

  // 히스토리 저장
  const saveHistory = useCallback((history: SearchSuggestion[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch (e) {
      console.error("Failed to save search history:", e);
    }
  }, []);

  // 검색어 추가
  const addToHistory = useCallback((query: string) => {
    if (!query.trim()) return;

    const normalizedQuery = query.trim();

    setSearchHistory((prev) => {
      // 기존에 있으면 맨 앞으로 이동
      const filtered = prev.filter(
        (item) => item.text.toLowerCase() !== normalizedQuery.toLowerCase()
      );
      const newItem: SearchSuggestion = {
        type: "history",
        text: normalizedQuery,
        timestamp: Date.now(),
      };
      const updated = [newItem, ...filtered].slice(0, MAX_HISTORY);
      saveHistory(updated);
      return updated;
    });
  }, [saveHistory]);

  // 히스토리에서 제거
  const removeFromHistory = useCallback((query: string) => {
    setSearchHistory((prev) => {
      const updated = prev.filter(
        (item) => item.text.toLowerCase() !== query.toLowerCase()
      );
      saveHistory(updated);
      return updated;
    });
  }, [saveHistory]);

  // 히스토리 전체 삭제
  const clearHistory = useCallback(() => {
    setSearchHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  // 쿼리 기반 제안 생성
  const getSuggestions = useCallback(
    (query: string): SearchSuggestion[] => {
      const normalizedQuery = query.trim().toLowerCase();

      if (!normalizedQuery) {
        // 빈 쿼리일 때는 최근 검색어 + 트렌딩 표시
        const historySuggestions = searchHistory.slice(0, 5);
        const trendingSuggestions: SearchSuggestion[] = trendingKeywords
          .slice(0, 3)
          .map((text) => ({ type: "trending", text }));
        return [...historySuggestions, ...trendingSuggestions].slice(0, maxSuggestions);
      }

      const suggestions: SearchSuggestion[] = [];

      // 히스토리에서 매칭되는 것
      const matchingHistory = searchHistory.filter((item) =>
        item.text.toLowerCase().includes(normalizedQuery)
      );
      suggestions.push(...matchingHistory.slice(0, 4));

      // 트렌딩에서 매칭되는 것
      const matchingTrending = trendingKeywords
        .filter((kw) => kw.toLowerCase().includes(normalizedQuery))
        .map((text): SearchSuggestion => ({ type: "trending", text }));
      suggestions.push(...matchingTrending.slice(0, 2));

      // 기본 제안에서 매칭되는 것
      const matchingDefault = defaultSuggestions
        .filter((kw) => kw.toLowerCase().includes(normalizedQuery))
        .filter((kw) => !suggestions.find((s) => s.text.toLowerCase() === kw.toLowerCase()))
        .map((text): SearchSuggestion => ({ type: "suggestion", text }));
      suggestions.push(...matchingDefault.slice(0, 2));

      // 중복 제거
      const seen = new Set<string>();
      return suggestions
        .filter((s) => {
          const key = s.text.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, maxSuggestions);
    },
    [searchHistory, trendingKeywords, defaultSuggestions, maxSuggestions]
  );

  // 최근 검색어 목록
  const recentSearches = useMemo(
    () => searchHistory.slice(0, 5),
    [searchHistory]
  );

  return {
    searchHistory,
    recentSearches,
    addToHistory,
    removeFromHistory,
    clearHistory,
    getSuggestions,
  };
}

export default useSearchSuggestions;
