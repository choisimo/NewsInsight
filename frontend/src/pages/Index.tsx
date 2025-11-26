import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, TrendingUp, Clock, AlertCircle, FileQuestion, Sparkles } from "lucide-react";
import { SearchBar } from "@/components/SearchBar";
import { SentimentChart } from "@/components/SentimentChart";
import { KeywordCloud } from "@/components/KeywordCloud";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getAnalysis, getArticles, openLiveAnalysisStream } from "@/lib/api";
import type { AnalysisResponse, Article } from "@/types/api";

const Index = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisData, setAnalysisData] = useState<AnalysisResponse | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [liveResult, setLiveResult] = useState<string | null>(null);
  const [liveStreaming, setLiveStreaming] = useState(false);
  const [liveSource, setLiveSource] = useState<EventSource | null>(null);

  useEffect(() => {
    return () => {
      if (liveSource) {
        liveSource.close();
      }
    };
  }, [liveSource]);

  const handleSearch = async (query: string, window: string) => {
    setLoading(true);
    setError(null);
    setAnalysisData(null);
    setArticles([]);
    if (liveSource) {
      liveSource.close();
      setLiveSource(null);
    }
    setLiveResult(null);
    setLiveStreaming(false);

    try {
      const analysis = await getAnalysis(query, window);
      setAnalysisData(analysis);

      if (analysis.article_count === 0) {
        try {
          setLiveStreaming(true);
          const es = await openLiveAnalysisStream(query, window);
          setLiveSource(es);

          es.onmessage = (event) => {
            setLiveResult((prev) => (prev ?? "") + event.data);
          };

          es.onerror = () => {
            es.close();
            setLiveStreaming(false);
          };
        } catch (streamError) {
          console.error("Live analysis stream error:", streamError);
          setLiveStreaming(false);
        }
        return;
      }

      try {
        const articlesData = await getArticles(query);
        setArticles(articlesData.articles);
      } catch (articleError) {
        console.error("Failed to fetch articles:", articleError);
      }
    } catch (err: any) {
      console.error("Analysis error:", err);
      setError(err.response?.data?.message || err.message || "분석에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = () => {
    if (analysisData) {
      handleSearch(analysisData.query, analysisData.window);
    }
  };

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
          <Link
            to="/deep-search"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
          >
            <Sparkles className="h-4 w-4" />
            Deep AI Search로 심층 분석하기
          </Link>
        </header>

        <div className="mb-8">
          <SearchBar onSearch={handleSearch} isLoading={loading} />
        </div>

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
            {analysisData && (
              <Button onClick={handleRetry} variant="gradient">
                다시 시도
              </Button>
            )}
          </Card>
        ) : analysisData ? (
          analysisData.article_count === 0 ? (
            <Card className="p-12 text-center shadow-elegant">
              <FileQuestion className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-xl font-semibold mb-2">로컬 데이터가 없습니다</h3>
              <p className="text-muted-foreground max-w-md mx-auto mb-6">
                '<span className="font-semibold">{analysisData.query}</span>'에 대한 수집된 뉴스 데이터가 없어
                Agent API를 통해 실시간 웹 분석을 수행하고 있습니다.
              </p>
              <div className="text-left max-w-2xl mx-auto bg-muted rounded-md p-4 max-h-64 overflow-auto whitespace-pre-wrap text-sm">
                {liveResult ?? "실시간 분석 결과를 불러오는 중입니다..."}
              </div>
              {liveStreaming && (
                <p className="text-xs text-muted-foreground mt-3">스트림 수신 중...</p>
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
