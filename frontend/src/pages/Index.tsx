import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { FileText, TrendingUp, Clock, AlertCircle, FileQuestion, Sparkles, RefreshCw, Bot, Info, Search, Shield, FolderOpen } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SearchBar } from "@/components/SearchBar";
import { SentimentChart } from "@/components/SentimentChart";
import { KeywordCloud } from "@/components/KeywordCloud";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { getAnalysis, getArticles, checkLiveAnalysisHealth } from "@/lib/api";
import { useEventSource } from "@/hooks/useEventSource";
import type { AnalysisResponse, Article } from "@/types/api";

const Index = () => {
  const queryClient = useQueryClient();
  
  // 검색 상태
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [timeWindow, setTimeWindow] = useState<string>("7d");
  const [searchTrigger, setSearchTrigger] = useState<number>(0);
  
  // SSE 라이브 분석 상태
  const [liveResult, setLiveResult] = useState<string | null>(null);
  const [liveStreamUrl, setLiveStreamUrl] = useState<string | null>(null);

  // React Query: 라이브 분석 헬스 체크
  const { data: liveAnalysisHealth } = useQuery({
    queryKey: ['liveAnalysis', 'health'],
    queryFn: checkLiveAnalysisHealth,
    staleTime: 60_000, // 1분간 캐시
    retry: 1,
  });

  const isLiveAnalysisEnabled = liveAnalysisHealth?.enabled ?? false;
  const liveAnalysisProvider = liveAnalysisHealth?.provider ?? 'none';

  // React Query: 분석 데이터 조회
  const {
    data: analysisData,
    isLoading: analysisLoading,
    error: analysisError,
    isFetching: analysisFetching,
  } = useQuery({
    queryKey: ['analysis', searchQuery, timeWindow, searchTrigger],
    queryFn: () => getAnalysis(searchQuery, timeWindow),
    enabled: !!searchQuery && searchTrigger > 0,
    staleTime: 30_000, // 30초간 fresh
    gcTime: 5 * 60_000, // 5분간 캐시 유지
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });

  // React Query: 기사 목록 조회 (분석 데이터가 있고 기사 수가 0보다 클 때)
  const {
    data: articlesData,
  } = useQuery({
    queryKey: ['articles', searchQuery],
    queryFn: () => getArticles(searchQuery),
    enabled: !!searchQuery && !!analysisData && analysisData.article_count > 0,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  // SSE 연결: 로컬 데이터가 없을 때 라이브 분석
  const { status: sseStatus } = useEventSource(liveStreamUrl, {
    onMessage: (data) => {
      setLiveResult((prev) => (prev ?? "") + data);
    },
    onError: () => {
      setLiveStreamUrl(null);
    },
    enabled: !!liveStreamUrl,
    maxRetries: 2,
  });

  // 검색 핸들러
  const handleSearch = useCallback(async (query: string, window: string) => {
    // 이전 라이브 스트림 정리
    setLiveStreamUrl(null);
    setLiveResult(null);
    
    setSearchQuery(query);
    setTimeWindow(window);
    setSearchTrigger((prev) => prev + 1);
  }, []);

  // 분석 데이터가 없을 때 라이브 스트림 시작
  const startLiveStream = useCallback(async () => {
    if (!searchQuery) return;
    
    try {
      const es = await openLiveAnalysisStream(searchQuery, timeWindow);
      setLiveStreamUrl(es.url);
      es.close(); // openLiveAnalysisStream이 EventSource를 반환하므로 URL만 추출
    } catch (error) {
      console.error("Failed to start live stream:", error);
    }
  }, [searchQuery, timeWindow]);

  // 분석 결과가 0개이고 라이브 분석이 활성화되어 있으면 자동으로 라이브 스트림 시작
  const shouldStartLiveStream = analysisData?.article_count === 0 && !liveStreamUrl && !liveResult && isLiveAnalysisEnabled;
  
  if (shouldStartLiveStream && searchQuery) {
    // URL 직접 구성 (openLiveAnalysisStream이 async라서 직접 구성)
    const baseUrl = import.meta.env.VITE_API_BASE_URL || 
      (typeof window !== 'undefined' 
        ? `${window.location.protocol}//${window.location.hostname}:8080`
        : 'http://localhost:8080');
    const streamUrl = `${baseUrl}/api/v1/analysis/live?query=${encodeURIComponent(searchQuery)}&window=${encodeURIComponent(timeWindow)}`;
    setLiveStreamUrl(streamUrl);
  }

  // 수동 새로고침
  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['analysis', searchQuery, timeWindow] });
    queryClient.invalidateQueries({ queryKey: ['articles', searchQuery] });
  }, [queryClient, searchQuery, timeWindow]);

  const handleRetry = useCallback(() => {
    setSearchTrigger((prev) => prev + 1);
  }, []);

  const loading = analysisLoading;
  const error = analysisError ? (analysisError as Error).message : null;
  const articles: Article[] = articlesData?.articles ?? [];

  return (
    <div className="min-h-screen py-8">
      <div className="container mx-auto px-4 max-w-7xl">
        <header className="mb-8 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-3 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            NewInsight
          </h1>
          <p className="text-lg text-muted-foreground mb-4">
            키워드 기반 뉴스 분석 및 인사이트 제공
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link
              to="/url-collections"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-orange-600/10 text-orange-600 hover:bg-orange-600/20 transition-colors"
            >
              <FolderOpen className="h-4 w-4" />
              URL 컬렉션
            </Link>
            <Link
              to="/search"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600/10 text-blue-600 hover:bg-blue-600/20 transition-colors"
            >
              <Search className="h-4 w-4" />
              통합 검색
            </Link>
            <Link
              to="/fact-check"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-green-600/10 text-green-600 hover:bg-green-600/20 transition-colors"
            >
              <Shield className="h-4 w-4" />
              팩트체크
            </Link>
            <Link
              to="/deep-search"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
            >
              <Sparkles className="h-4 w-4" />
              Deep AI Search
            </Link>
            <Link
              to="/browser-agent"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              <Bot className="h-4 w-4" />
              Browser AI Agent
            </Link>
          </div>
        </header>

        <div className="mb-8">
          <SearchBar onSearch={handleSearch} isLoading={loading} />
        </div>

        {/* 실시간 상태 표시 */}
        {searchQuery && (
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {analysisFetching && !loading && (
                <Badge variant="secondary" className="animate-pulse">
                  <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                  백그라운드 갱신 중
                </Badge>
              )}
              {liveStreamUrl && sseStatus === 'connected' && (
                <Badge variant="outline" className="border-green-500 text-green-600">
                  <span className="h-2 w-2 rounded-full bg-green-500 mr-2 animate-pulse" />
                  실시간 연결됨
                </Badge>
              )}
            </div>
            {analysisData && (
              <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={analysisFetching}>
                <RefreshCw className={`h-4 w-4 mr-1 ${analysisFetching ? 'animate-spin' : ''}`} />
                새로고침
              </Button>
            )}
          </div>
        )}

        {loading ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="p-6">
                  <Skeleton className="h-4 w-24 mb-4" />
                  <Skeleton className="h-8 w-16" />
                </Card>
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-6">
                <Skeleton className="h-6 w-32 mb-6" />
                <Skeleton className="h-[300px] rounded-full mx-auto w-[300px]" />
              </Card>
              <Card className="p-6">
                <Skeleton className="h-6 w-32 mb-6" />
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              </Card>
            </div>
          </div>
        ) : error ? (
          <Card className="p-12 text-center shadow-elegant">
            <AlertCircle className="h-16 w-16 mx-auto mb-4 text-destructive" />
            <h3 className="text-xl font-semibold mb-2">오류가 발생했습니다</h3>
            <p className="text-muted-foreground max-w-md mx-auto mb-6">{error}</p>
            <Button onClick={handleRetry} variant="default">
              다시 시도
            </Button>
          </Card>
        ) : analysisData ? (
          analysisData.article_count === 0 ? (
            <Card className="p-12 text-center shadow-elegant">
              <FileQuestion className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-xl font-semibold mb-2">로컬 데이터가 없습니다</h3>
              <p className="text-muted-foreground max-w-md mx-auto mb-6">
                '<span className="font-semibold">{analysisData.query}</span>'에 대한 수집된 뉴스 데이터가 없습니다.
              </p>
              
              {isLiveAnalysisEnabled ? (
                <>
                  <p className="text-sm text-muted-foreground mb-4">
                    {liveAnalysisProvider === 'perplexity' 
                      ? 'Perplexity API를 통해 실시간 웹 분석을 수행하고 있습니다.'
                      : 'Crawl4AI + AI Dove를 통해 실시간 웹 분석을 수행하고 있습니다.'}
                  </p>
                  {liveAnalysisProvider === 'crawl+aidove' && (
                    <Badge variant="outline" className="mb-4 border-blue-500 text-blue-600">
                      <Info className="h-3 w-3 mr-1" />
                      크롤링 기반 분석 (Perplexity 대체)
                    </Badge>
                  )}
                  <div className="text-left max-w-2xl mx-auto bg-muted rounded-md p-4 max-h-64 overflow-auto whitespace-pre-wrap text-sm">
                    {liveResult ?? "실시간 분석 결과를 불러오는 중입니다..."}
                  </div>
                  {sseStatus === 'connected' && (
                    <p className="text-xs text-muted-foreground mt-3">스트림 수신 중...</p>
                  )}
                  {sseStatus === 'error' && (
                    <p className="text-xs text-destructive mt-3">스트림 연결 실패</p>
                  )}
                </>
              ) : (
                <>
                  <div className="max-w-md mx-auto mb-6 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                    <div className="flex items-start gap-3">
                      <Info className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                      <div className="text-left">
                        <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                          실시간 분석 기능이 비활성화되어 있습니다
                        </p>
                        <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                          AI 제공자가 설정되지 않았습니다 (Perplexity API 또는 AI Dove).
                        </p>
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    다른 방법으로 분석을 시도해 보세요:
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <Link
                      to="/deep-search"
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-accent text-accent-foreground hover:bg-accent/90 transition-colors"
                    >
                      <Sparkles className="h-4 w-4" />
                      Deep AI Search
                    </Link>
                    <Link
                      to="/browser-agent"
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      <Bot className="h-4 w-4" />
                      Browser AI Agent
                    </Link>
                  </div>
                </>
              )}
            </Card>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="p-6 shadow-elegant card-hover">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-2">분석 기사 수</p>
                      <p className="text-3xl font-bold">{analysisData.article_count}</p>
                      <p className="text-xs text-muted-foreground mt-2">전체 분석된 기사</p>
                    </div>
                    <div className="p-3 rounded-lg bg-accent/10">
                      <FileText className="h-6 w-6 text-accent" />
                    </div>
                  </div>
                </Card>
                <Card className="p-6 shadow-elegant card-hover">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-2">전체 감성</p>
                      <p className="text-3xl font-bold">
                        {((analysisData.sentiments.pos / (analysisData.sentiments.pos + analysisData.sentiments.neg + analysisData.sentiments.neu)) * 100).toFixed(0)}% 긍정
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">긍정적 반응 비율</p>
                    </div>
                    <div className="p-3 rounded-lg bg-accent/10">
                      <TrendingUp className="h-6 w-6 text-accent" />
                    </div>
                  </div>
                </Card>
                <Card className="p-6 shadow-elegant card-hover">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-2">분석 기간</p>
                      <p className="text-3xl font-bold">
                        {analysisData.window === "1d" ? "1일" : analysisData.window === "7d" ? "7일" : "30일"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                        {new Date(analysisData.analyzed_at).toLocaleDateString("ko-KR")}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-accent/10">
                      <Clock className="h-6 w-6 text-accent" />
                    </div>
                  </div>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <SentimentChart data={analysisData.sentiments} />
                <KeywordCloud keywords={analysisData.top_keywords} />
              </div>
            </div>
          )
        ) : (
          <div className="text-center py-20">
            <div className="max-w-2xl mx-auto">
              <div className="mb-6">
                <div className="inline-block p-4 rounded-full bg-accent/10 mb-4">
                  <TrendingUp className="h-12 w-12 text-accent" />
                </div>
              </div>
              <h2 className="text-2xl font-bold mb-3">키워드를 입력하세요</h2>
              <p className="text-muted-foreground">
                관심있는 키워드를 검색하여 NewInsight과 핵심 인사이트를 확인하세요.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
