import { useState, useCallback, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  Loader2,
  AlertCircle,
  Database,
  Globe,
  Brain,
  CheckCircle2,
  Clock,
  ExternalLink,
  RefreshCw,
  Zap,
  Shield,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  Link as LinkIcon,
  X,
  Bot,
  Sparkles,
  TrendingUp,
  FileText,
  BarChart3,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { AnalysisBadges, type AnalysisData } from "@/components/AnalysisBadges";
import {
  openUnifiedSearchStream,
  checkUnifiedSearchHealth,
  type UnifiedSearchResult,
  type UnifiedSearchEvent,
} from "@/lib/api";

// Source configuration with icons and colors
const SOURCE_CONFIG = {
  database: {
    label: "저장된 뉴스",
    icon: Database,
    color: "text-blue-600",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
    borderColor: "border-l-blue-500",
  },
  web: {
    label: "웹 검색",
    icon: Globe,
    color: "text-green-600",
    bgColor: "bg-green-100 dark:bg-green-900/30",
    borderColor: "border-l-green-500",
  },
  ai: {
    label: "AI 분석",
    icon: Brain,
    color: "text-purple-600",
    bgColor: "bg-purple-100 dark:bg-purple-900/30",
    borderColor: "border-l-purple-500",
  },
} as const;

type SourceType = keyof typeof SOURCE_CONFIG;

interface SourceStatus {
  status: "idle" | "searching" | "complete" | "error";
  message?: string;
  count: number;
}

interface SearchResultCardProps {
  result: UnifiedSearchResult;
}

const SearchResultCard = ({ result }: SearchResultCardProps) => {
  const config = SOURCE_CONFIG[result.source];
  const SourceIcon = config.icon;

  // Convert result to AnalysisData format
  const analysisData: AnalysisData = {
    analyzed: result.analyzed,
    analysisStatus: result.analysisStatus as AnalysisData["analysisStatus"],
    reliabilityScore: result.reliabilityScore,
    reliabilityGrade: result.reliabilityGrade as AnalysisData["reliabilityGrade"],
    reliabilityColor: result.reliabilityColor as AnalysisData["reliabilityColor"],
    sentimentLabel: result.sentimentLabel as AnalysisData["sentimentLabel"],
    sentimentScore: result.sentimentScore,
    biasLabel: result.biasLabel,
    biasScore: result.biasScore,
    factcheckStatus: result.factcheckStatus as AnalysisData["factcheckStatus"],
    misinfoRisk: result.misinfoRisk as AnalysisData["misinfoRisk"],
    riskTags: result.riskTags,
    topics: result.topics,
    hasDiscussion: result.hasDiscussion,
    totalCommentCount: result.totalCommentCount,
    discussionSentiment: result.discussionSentiment,
  };

  const hasAnalysis = result.source === "database" && (result.analyzed || result.analysisStatus === "pending");

  return (
    <Card className={`${config.bgColor} border-l-4 ${config.borderColor} transition-all hover:shadow-md`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className={`${config.color} flex items-center gap-1`}>
                <SourceIcon className="h-3 w-3" />
                {result.sourceLabel || config.label}
              </Badge>
              {result.publishedAt && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {new Date(result.publishedAt).toLocaleDateString("ko-KR")}
                </span>
              )}
            </div>
            {result.title && (
              <h4 className="font-semibold text-sm mb-1 line-clamp-2">{result.title}</h4>
            )}
            {result.snippet && (
              <p className="text-sm text-muted-foreground line-clamp-3 mb-2">{result.snippet}</p>
            )}
            {/* Analysis Badges - only for database results */}
            {hasAnalysis && (
              <div className="mt-2 pt-2 border-t border-border/50">
                <AnalysisBadges 
                  data={analysisData} 
                  size="sm" 
                  loading={result.analysisStatus === "pending"}
                />
              </div>
            )}
            {/* Topics */}
            {result.topics && result.topics.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {result.topics.slice(0, 3).map((topic) => (
                  <Badge key={topic} variant="secondary" className="text-xs">
                    {topic}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          {result.url && (
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 p-2 rounded-md hover:bg-muted transition-colors"
              title="원문 보기"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

interface AIStreamCardProps {
  content: string;
  isComplete: boolean;
}

const AIStreamCard = ({ content, isComplete }: AIStreamCardProps) => {
  const [isExpanded, setIsExpanded] = useState(true);

  if (!content) return null;

  return (
    <Card className="bg-purple-100 dark:bg-purple-900/30 border-l-4 border-l-purple-500">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-purple-600" />
              <CardTitle className="text-lg">AI 실시간 분석</CardTitle>
              {!isComplete && (
                <Loader2 className="h-4 w-4 animate-spin text-purple-600" />
              )}
              {isComplete && (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              )}
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm">
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent>
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <pre className="whitespace-pre-wrap font-sans text-sm bg-white/50 dark:bg-black/20 p-4 rounded-lg">
                {content}
                {!isComplete && <span className="animate-pulse">|</span>}
              </pre>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

interface SourceStatusIndicatorProps {
  source: SourceType;
  status: SourceStatus;
}

const SourceStatusIndicator = ({ source, status }: SourceStatusIndicatorProps) => {
  const config = SOURCE_CONFIG[source];
  const SourceIcon = config.icon;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg ${config.bgColor}`}>
      <div className={`p-2 rounded-full bg-white dark:bg-gray-800`}>
        <SourceIcon className={`h-5 w-5 ${config.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{config.label}</span>
          {status.status === "searching" && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
          {status.status === "complete" && (
            <CheckCircle2 className="h-3 w-3 text-green-600" />
          )}
          {status.status === "error" && (
            <AlertCircle className="h-3 w-3 text-red-500" />
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {status.status === "idle" && "대기 중"}
          {status.status === "searching" && (status.message || "검색 중...")}
          {status.status === "complete" && `${status.count}개 결과`}
          {status.status === "error" && (status.message || "오류 발생")}
        </p>
      </div>
      <Badge variant="secondary" className="tabular-nums">
        {status.count}
      </Badge>
    </div>
  );
};

// Interface for priority URLs passed from UrlCollections page
interface PriorityUrl {
  id: string;
  url: string;
  name: string;
}

// Quick action cards for the home page
const QuickActions = () => (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
    <Link to="/deep-search">
      <Card className="p-4 hover:shadow-md transition-all cursor-pointer border-purple-200 dark:border-purple-800 hover:border-purple-400">
        <div className="flex flex-col items-center text-center gap-2">
          <div className="p-3 rounded-full bg-purple-100 dark:bg-purple-900/30">
            <Sparkles className="h-6 w-6 text-purple-600" />
          </div>
          <span className="font-medium text-sm">Deep AI Search</span>
          <span className="text-xs text-muted-foreground">심층 AI 분석</span>
        </div>
      </Card>
    </Link>
    <Link to="/fact-check">
      <Card className="p-4 hover:shadow-md transition-all cursor-pointer border-green-200 dark:border-green-800 hover:border-green-400">
        <div className="flex flex-col items-center text-center gap-2">
          <div className="p-3 rounded-full bg-green-100 dark:bg-green-900/30">
            <Shield className="h-6 w-6 text-green-600" />
          </div>
          <span className="font-medium text-sm">팩트체크</span>
          <span className="text-xs text-muted-foreground">신뢰도 검증</span>
        </div>
      </Card>
    </Link>
    <Link to="/browser-agent">
      <Card className="p-4 hover:shadow-md transition-all cursor-pointer border-blue-200 dark:border-blue-800 hover:border-blue-400">
        <div className="flex flex-col items-center text-center gap-2">
          <div className="p-3 rounded-full bg-blue-100 dark:bg-blue-900/30">
            <Bot className="h-6 w-6 text-blue-600" />
          </div>
          <span className="font-medium text-sm">브라우저 에이전트</span>
          <span className="text-xs text-muted-foreground">자동 수집</span>
        </div>
      </Card>
    </Link>
    <Link to="/url-collections">
      <Card className="p-4 hover:shadow-md transition-all cursor-pointer border-orange-200 dark:border-orange-800 hover:border-orange-400">
        <div className="flex flex-col items-center text-center gap-2">
          <div className="p-3 rounded-full bg-orange-100 dark:bg-orange-900/30">
            <FolderOpen className="h-6 w-6 text-orange-600" />
          </div>
          <span className="font-medium text-sm">URL 컬렉션</span>
          <span className="text-xs text-muted-foreground">소스 관리</span>
        </div>
      </Card>
    </Link>
  </div>
);

const ParallelSearch = () => {
  const { toast } = useToast();
  const location = useLocation();
  
  const [query, setQuery] = useState("");
  const [timeWindow, setTimeWindow] = useState("7d");
  const [isSearching, setIsSearching] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | SourceType>("all");
  
  // Priority URLs from URL Collections page
  const [priorityUrls, setPriorityUrls] = useState<PriorityUrl[]>([]);
  
  // Results state
  const [results, setResults] = useState<UnifiedSearchResult[]>([]);
  const [aiContent, setAiContent] = useState("");
  const [aiComplete, setAiComplete] = useState(false);
  
  // Source status
  const [sourceStatus, setSourceStatus] = useState<Record<SourceType, SourceStatus>>({
    database: { status: "idle", count: 0 },
    web: { status: "idle", count: 0 },
    ai: { status: "idle", count: 0 },
  });
  
  const eventSourceRef = useRef<EventSource | null>(null);
  
  // Load priority URLs from location state or sessionStorage
  useEffect(() => {
    const locationState = location.state as { priorityUrls?: PriorityUrl[] } | null;
    if (locationState?.priorityUrls && locationState.priorityUrls.length > 0) {
      setPriorityUrls(locationState.priorityUrls);
      // Save to sessionStorage for persistence across page refreshes
      sessionStorage.setItem("parallelSearch_priorityUrls", JSON.stringify(locationState.priorityUrls));
      // Clear the location state to prevent re-adding on refresh
      window.history.replaceState({}, document.title);
    } else {
      // Try to load from sessionStorage
      const stored = sessionStorage.getItem("parallelSearch_priorityUrls");
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as PriorityUrl[];
          setPriorityUrls(parsed);
        } catch {
          // Ignore parse errors
        }
      }
    }
  }, [location.state]);
  
  // Remove a priority URL
  const removePriorityUrl = useCallback((id: string) => {
    setPriorityUrls((prev) => {
      const updated = prev.filter((u) => u.id !== id);
      if (updated.length > 0) {
        sessionStorage.setItem("parallelSearch_priorityUrls", JSON.stringify(updated));
      } else {
        sessionStorage.removeItem("parallelSearch_priorityUrls");
      }
      return updated;
    });
  }, []);
  
  // Clear all priority URLs
  const clearPriorityUrls = useCallback(() => {
    setPriorityUrls([]);
    sessionStorage.removeItem("parallelSearch_priorityUrls");
    toast({
      title: "초기화됨",
      description: "우선순위 URL이 모두 제거되었습니다.",
    });
  }, [toast]);

  // Health check
  const { data: healthData } = useQuery({
    queryKey: ["unifiedSearch", "health"],
    queryFn: checkUnifiedSearchHealth,
    staleTime: 60_000,
    retry: 0,
  });

  const isHealthy = healthData?.status === "available";

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const resetState = useCallback(() => {
    setResults([]);
    setAiContent("");
    setAiComplete(false);
    setSourceStatus({
      database: { status: "idle", count: 0 },
      web: { status: "idle", count: 0 },
      ai: { status: "idle", count: 0 },
    });
  }, []);

  const handleSearch = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isSearching) return;

    // Cleanup previous search
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    
    resetState();
    setIsSearching(true);

    try {
      // Extract URLs from priority list
      const priorityUrlList = priorityUrls.map((p) => p.url);
      const es = await openUnifiedSearchStream(query.trim(), timeWindow, priorityUrlList.length > 0 ? priorityUrlList : undefined);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const data: UnifiedSearchEvent = JSON.parse(event.data);
          
          switch (data.eventType) {
            case "status":
              setSourceStatus((prev) => ({
                ...prev,
                [data.source]: {
                  status: "searching",
                  message: data.message,
                  count: prev[data.source].count,
                },
              }));
              break;

            case "result":
              if (data.result) {
                setResults((prev) => [...prev, data.result!]);
                setSourceStatus((prev) => ({
                  ...prev,
                  [data.source]: {
                    ...prev[data.source],
                    count: prev[data.source].count + 1,
                  },
                }));
              }
              break;

            case "ai_chunk":
              if (data.message) {
                setAiContent((prev) => prev + data.message);
              }
              break;

            case "complete":
              setSourceStatus((prev) => ({
                ...prev,
                [data.source]: {
                  status: "complete",
                  message: data.message,
                  count: data.totalCount ?? prev[data.source].count,
                },
              }));
              if (data.source === "ai") {
                setAiComplete(true);
              }
              break;

            case "error":
              setSourceStatus((prev) => ({
                ...prev,
                [data.source]: {
                  status: "error",
                  message: data.message,
                  count: prev[data.source].count,
                },
              }));
              break;
          }
        } catch (parseError) {
          console.error("Failed to parse SSE event:", parseError);
        }
      };

      es.addEventListener("done", () => {
        setIsSearching(false);
        es.close();
        eventSourceRef.current = null;
        toast({
          title: "검색 완료",
          description: `${results.length}개의 결과를 찾았습니다.`,
        });
      });

      es.addEventListener("error", (errorEvent) => {
        console.error("SSE error:", errorEvent);
        setIsSearching(false);
        es.close();
        eventSourceRef.current = null;
      });

      es.onerror = () => {
        setIsSearching(false);
        es.close();
        eventSourceRef.current = null;
        toast({
          title: "검색 오류",
          description: "검색 중 오류가 발생했습니다. 다시 시도해주세요.",
          variant: "destructive",
        });
      };

    } catch (error) {
      console.error("Failed to start search:", error);
      setIsSearching(false);
      toast({
        title: "오류",
        description: "검색을 시작할 수 없습니다.",
        variant: "destructive",
      });
    }
  }, [query, timeWindow, priorityUrls, isSearching, resetState, toast, results.length]);

  const handleCancel = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsSearching(false);
    toast({
      title: "취소됨",
      description: "검색이 취소되었습니다.",
    });
  }, [toast]);

  const filteredResults = activeTab === "all"
    ? results
    : results.filter((r) => r.source === activeTab);

  const totalResults = results.length;
  const searchProgress = Object.values(sourceStatus).filter(
    (s) => s.status === "complete" || s.status === "error"
  ).length / 3 * 100;

  // Check if we should show the home/welcome state
  const showWelcomeState = !isSearching && results.length === 0 && !aiContent;

  return (
    <div className="min-h-screen py-8">
      <div className="container mx-auto px-4 max-w-6xl">
        {/* Header */}
        <header className="mb-8 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-3 bg-gradient-to-r from-blue-600 via-purple-600 to-green-600 bg-clip-text text-transparent">
            NewsInsight
          </h1>
          <p className="text-lg text-muted-foreground mb-2">
            AI 기반 통합 뉴스 분석 플랫폼
          </p>
          <p className="text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Zap className="h-4 w-4" />
            데이터베이스, 웹, AI를 동시에 검색하여 실시간으로 결과를 표시합니다.
          </p>
          {isHealthy && (
            <Badge variant="outline" className="mt-3 text-green-600 border-green-600">
              <Shield className="h-3 w-3 mr-1" />
              서비스 정상
            </Badge>
          )}
          {healthData && !isHealthy && (
            <div className="mt-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center justify-center gap-2">
              <AlertCircle className="h-4 w-4" />
              통합 검색 서비스가 현재 사용 불가능합니다.
            </div>
          )}
        </header>

        {/* Priority URLs from URL Collections */}
        {priorityUrls.length > 0 && (
          <Card className="mb-6 border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-900/10">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-5 w-5 text-orange-600" />
                  <CardTitle className="text-lg">우선순위 URL</CardTitle>
                  <Badge variant="secondary">{priorityUrls.length}개</Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearPriorityUrls}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4 mr-1" />
                  모두 제거
                </Button>
              </div>
              <CardDescription>
                URL 컬렉션에서 선택한 URL입니다. 검색 시 이 URL들이 우선적으로 분석됩니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {priorityUrls.map((item) => {
                  // Safe URL hostname extraction
                  let displayName = item.name;
                  if (!displayName && item.url) {
                    try {
                      displayName = new URL(item.url).hostname;
                    } catch {
                      displayName = item.url;
                    }
                  }
                  if (!displayName) {
                    displayName = '알 수 없는 URL';
                  }

                  return (
                    <Badge
                      key={item.id}
                      variant="outline"
                      className="pl-2 pr-1 py-1 flex items-center gap-1 bg-white dark:bg-gray-800"
                    >
                      <LinkIcon className="h-3 w-3 text-orange-500" />
                      <span className="max-w-[200px] truncate" title={item.url || ''}>
                        {displayName}
                      </span>
                      <button
                        onClick={() => removePriorityUrl(item.id)}
                        className="ml-1 p-0.5 rounded hover:bg-muted transition-colors"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Search Form */}
        <Card className="mb-8">
          <CardContent className="pt-6">
            <form onSubmit={handleSearch} className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="뉴스 키워드를 입력하세요... (예: AI 기술, 경제 전망, 정치 이슈)"
                    disabled={isSearching}
                    className="text-lg h-12"
                  />
                </div>
                <div className="flex gap-2">
                  <select
                    value={timeWindow}
                    onChange={(e) => setTimeWindow(e.target.value)}
                    disabled={isSearching}
                    className="px-3 py-2 rounded-md border bg-background"
                  >
                    <option value="1d">최근 24시간</option>
                    <option value="7d">최근 7일</option>
                    <option value="30d">최근 30일</option>
                  </select>
                  {isSearching ? (
                    <Button type="button" variant="outline" onClick={handleCancel}>
                      취소
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      disabled={!query.trim() || isHealthy === false}
                      size="lg"
                    >
                      <Search className="h-4 w-4 mr-2" />
                      검색
                    </Button>
                  )}
                </div>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Quick Actions - Show on welcome state */}
        {showWelcomeState && <QuickActions />}

        {/* Search Progress */}
        {isSearching && (
          <Card className="mb-8">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                병렬 검색 진행 중...
              </CardTitle>
              <CardDescription>
                3개의 소스에서 동시에 검색하고 있습니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Progress value={searchProgress} className="h-2" />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(Object.keys(SOURCE_CONFIG) as SourceType[]).map((source) => (
                  <SourceStatusIndicator
                    key={source}
                    source={source}
                    status={sourceStatus[source]}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {(results.length > 0 || aiContent) && (
          <div className="space-y-6">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-6 text-center">
                  <p className="text-3xl font-bold">{totalResults}</p>
                  <p className="text-sm text-muted-foreground">전체 결과</p>
                </CardContent>
              </Card>
              {(Object.keys(SOURCE_CONFIG) as SourceType[]).map((source) => {
                const config = SOURCE_CONFIG[source];
                const count = sourceStatus[source].count;
                return (
                  <Card key={source}>
                    <CardContent className="pt-6 text-center">
                      <p className={`text-3xl font-bold ${config.color}`}>{count}</p>
                      <p className="text-sm text-muted-foreground">{config.label}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* AI Analysis (if available) */}
            {aiContent && (
              <AIStreamCard content={aiContent} isComplete={aiComplete} />
            )}

            {/* Results List */}
            <Card>
              <CardHeader>
                <CardTitle>검색 결과</CardTitle>
                <CardDescription>
                  '{query}'에 대한 검색 결과입니다.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
                  <TabsList className="mb-4">
                    <TabsTrigger value="all">
                      전체 ({totalResults})
                    </TabsTrigger>
                    {(Object.keys(SOURCE_CONFIG) as SourceType[]).map((source) => {
                      const config = SOURCE_CONFIG[source];
                      const Icon = config.icon;
                      return (
                        <TabsTrigger key={source} value={source} className={config.color}>
                          <Icon className="h-4 w-4 mr-1" />
                          {sourceStatus[source].count}
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                  <TabsContent value={activeTab}>
                    <ScrollArea className="h-[600px] pr-4">
                      <div className="space-y-4">
                        {filteredResults.length > 0 ? (
                          filteredResults.map((result) => (
                            <SearchResultCard key={result.id} result={result} />
                          ))
                        ) : (
                          <div className="text-center py-8 text-muted-foreground">
                            {activeTab === "all"
                              ? "검색 결과가 없습니다."
                              : `${SOURCE_CONFIG[activeTab].label}에서 결과를 찾을 수 없습니다.`}
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Empty State / Welcome */}
        {showWelcomeState && (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center gap-4 mb-6">
              <div className="p-3 rounded-full bg-blue-100 dark:bg-blue-900/30">
                <Database className="h-8 w-8 text-blue-600" />
              </div>
              <div className="p-3 rounded-full bg-green-100 dark:bg-green-900/30">
                <Globe className="h-8 w-8 text-green-600" />
              </div>
              <div className="p-3 rounded-full bg-purple-100 dark:bg-purple-900/30">
                <Brain className="h-8 w-8 text-purple-600" />
              </div>
            </div>
            <h2 className="text-xl font-semibold mb-2">통합 병렬 검색</h2>
            <p className="text-muted-foreground max-w-md mx-auto mb-6">
              검색어를 입력하면 데이터베이스, 웹, AI가 동시에 검색을 시작합니다.
              결과는 실시간으로 화면에 표시됩니다.
            </p>
            <div className="flex flex-wrap justify-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-blue-600" />
                저장된 뉴스 데이터
              </div>
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-green-600" />
                실시간 웹 크롤링
              </div>
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-purple-600" />
                AI 심층 분석
              </div>
            </div>
          </div>
        )}

        {/* Link to Deep Analysis */}
        {results.length > 0 && (
          <div className="mt-8 text-center">
            <Link to="/deep-search">
              <Button variant="outline" size="lg" className="gap-2">
                <Shield className="h-5 w-5" />
                심층 분석 및 팩트체크로 이동
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};

export default ParallelSearch;
