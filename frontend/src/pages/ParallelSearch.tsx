import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
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
  Save,
  BookmarkPlus,
  Maximize2,
  FileText,
} from "lucide-react";
import { ExportButton } from "@/components/ExportButton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { AnalysisBadges, type AnalysisData } from "@/components/AnalysisBadges";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { useUrlCollection } from "@/hooks/useUrlCollection";
import { useAutoSaveSearch } from "@/hooks/useSearchHistory";
import { SearchInputWithSuggestions } from "@/components/SearchInputWithSuggestions";
import { AdvancedFilters, defaultFilters, type SearchFilters } from "@/components/AdvancedFilters";
import {
  openUnifiedSearchStream,
  checkUnifiedSearchHealth,
  startUnifiedSearchJob,
  openUnifiedSearchJobStream,
  getUnifiedSearchJobStatus,
  type UnifiedSearchResult,
  type UnifiedSearchEvent,
  type UnifiedSearchJob,
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
  status: "idle" | "connecting" | "searching" | "complete" | "error";
  message?: string;
  count: number;
}

interface SearchResultCardProps {
  result: UnifiedSearchResult;
  onSaveUrl?: (result: UnifiedSearchResult) => void;
  isUrlSaved?: boolean;
}

const SearchResultCard = ({ result, onSaveUrl, isUrlSaved = false }: SearchResultCardProps) => {
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
          <div className="flex flex-col gap-2">
            {result.url && (
              <>
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 p-2 rounded-md hover:bg-muted transition-colors"
                  title="원문 보기"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
                {onSaveUrl && (
                  <button
                    onClick={() => onSaveUrl(result)}
                    disabled={isUrlSaved}
                    className={`shrink-0 p-2 rounded-md transition-colors ${
                      isUrlSaved 
                        ? "text-green-600 cursor-default" 
                        : "hover:bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                    title={isUrlSaved ? "컬렉션에 저장됨" : "컬렉션에 저장"}
                  >
                    {isUrlSaved ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <BookmarkPlus className="h-4 w-4" />
                    )}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

interface AIStreamCardProps {
  content: string;
  isComplete: boolean;
  onSave?: () => void;
  isSaved?: boolean;
  evidence?: UnifiedSearchResult[];
}

const AIStreamCard = ({ content, isComplete, onSave, isSaved = false, evidence = [] }: AIStreamCardProps) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isFullViewOpen, setIsFullViewOpen] = useState(false);

  if (!content) return null;

  // Filter evidence to only include non-AI results with URLs
  const validEvidence = evidence.filter(r => r.source !== 'ai' && r.url);

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
            <div className="flex items-center gap-2">
              {/* Full View Button */}
              {isComplete && (
                <Dialog open={isFullViewOpen} onOpenChange={setIsFullViewOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1">
                      <Maximize2 className="h-4 w-4" />
                      전체보기
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <Brain className="h-5 w-5 text-purple-600" />
                        AI 분석 전체보기
                      </DialogTitle>
                      <DialogDescription>
                        AI 분석 결과와 참조된 모든 소스를 확인할 수 있습니다.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto space-y-6 pr-2">
                      {/* AI Analysis Content */}
                      <div>
                        <h3 className="font-semibold mb-3 flex items-center gap-2 text-purple-700 dark:text-purple-300">
                          <FileText className="h-4 w-4" />
                          분석 내용
                        </h3>
                        <div className="bg-white/70 dark:bg-black/30 p-4 rounded-lg border">
                          <MarkdownRenderer content={content} isStreaming={false} />
                        </div>
                      </div>
                      
                      {/* Evidence / Source URLs */}
                      {validEvidence.length > 0 && (
                        <div>
                          <h3 className="font-semibold mb-3 flex items-center gap-2 text-blue-700 dark:text-blue-300">
                            <Globe className="h-4 w-4" />
                            참조 소스 ({validEvidence.length}개)
                          </h3>
                          <ScrollArea className="h-[300px]">
                            <div className="space-y-3 pr-4">
                              {validEvidence.map((item, index) => {
                                const sourceConfig = SOURCE_CONFIG[item.source];
                                const SourceIcon = sourceConfig?.icon || Globe;
                                return (
                                  <div
                                    key={item.id || index}
                                    className={`p-3 rounded-lg border-l-4 ${sourceConfig?.borderColor || 'border-l-gray-400'} ${sourceConfig?.bgColor || 'bg-gray-100 dark:bg-gray-800'}`}
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                          <Badge variant="outline" className={`${sourceConfig?.color || 'text-gray-600'} text-xs`}>
                                            <SourceIcon className="h-3 w-3 mr-1" />
                                            {item.sourceLabel || sourceConfig?.label || item.source}
                                          </Badge>
                                          {item.publishedAt && (
                                            <span className="text-xs text-muted-foreground">
                                              {new Date(item.publishedAt).toLocaleDateString('ko-KR')}
                                            </span>
                                          )}
                                        </div>
                                        {item.title && (
                                          <h4 className="font-medium text-sm line-clamp-2 mb-1">{item.title}</h4>
                                        )}
                                        {item.snippet && (
                                          <p className="text-xs text-muted-foreground line-clamp-2">{item.snippet}</p>
                                        )}
                                      </div>
                                      {item.url && (
                                        <a
                                          href={item.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="shrink-0 p-2 rounded-md hover:bg-muted transition-colors"
                                          title="원문 보기"
                                        >
                                          <ExternalLink className="h-4 w-4" />
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </ScrollArea>
                        </div>
                      )}
                      
                      {validEvidence.length === 0 && (
                        <div className="text-center py-6 text-muted-foreground">
                          <Globe className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p>참조된 소스가 없습니다.</p>
                        </div>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              )}
              {isComplete && onSave && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onSave}
                  disabled={isSaved}
                  className={isSaved ? "text-green-600 border-green-600" : ""}
                >
                  {isSaved ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      저장됨
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-1" />
                      분석 저장
                    </>
                  )}
                </Button>
              )}
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm">
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent>
            <div className="bg-white/50 dark:bg-black/20 p-4 rounded-lg">
              <MarkdownRenderer content={content} isStreaming={!isComplete} />
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
          {status.status === "connecting" && (
            <Loader2 className="h-3 w-3 animate-spin text-yellow-600" />
          )}
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
          {status.status === "connecting" && "연결 중..."}
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
    <Link to="/ai-agent">
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
  const { addUrl, addFolder, collection, urlExists } = useUrlCollection();
  const { saveUnifiedSearch, saveFailedSearch } = useAutoSaveSearch();
  
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilters>(defaultFilters);
  const [isSearching, setIsSearching] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | SourceType>("all");
  
  // Job-based search state
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string>("idle");
  
  // Track search start time for duration calculation
  const [searchStartTime, setSearchStartTime] = useState<number | null>(null);
  
  // Priority URLs from URL Collections page
  const [priorityUrls, setPriorityUrls] = useState<PriorityUrl[]>([]);
  
  // Connection status state for initial SSE feedback
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  
  // Results state
  const [results, setResults] = useState<UnifiedSearchResult[]>([]);
  const [aiContent, setAiContent] = useState("");
  const [aiComplete, setAiComplete] = useState(false);
  
  // Saved analysis state
  const [isAnalysisSaved, setIsAnalysisSaved] = useState(false);
  
  // Track URLs already added to collection during this session
  const addedUrlsRef = useRef<Set<string>>(new Set());
  
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

  // Load query from location state (e.g., from Search History page)
  useEffect(() => {
    const locationState = location.state as { 
      query?: string; 
      fromHistory?: boolean; 
      historyId?: number;
      parentSearchId?: number;
      deriveFrom?: number;
      depthLevel?: number;
    } | null;
    
    if (locationState?.query && !isSearching && !currentJobId) {
      // Set the query
      setQuery(locationState.query);
      
      if (locationState.fromHistory) {
        toast({
          title: "검색 기록에서 연결됨",
          description: `"${locationState.query}" 검색어로 통합 검색을 시작할 수 있습니다.`,
        });
        // Clear the location state to prevent showing toast again
        window.history.replaceState({}, document.title);
      }
      
      if (locationState.deriveFrom) {
        toast({
          title: "파생 검색",
          description: "이전 검색에서 파생된 통합 검색을 시작합니다.",
        });
        // Clear the location state
        window.history.replaceState({}, document.title);
      }
    }
  }, [location.state, isSearching, currentJobId, toast]);
  
  // Restore jobId from URL query params or sessionStorage on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const jobIdFromUrl = urlParams.get("jobId");
    const storedJobId = sessionStorage.getItem("parallelSearch_currentJobId");
    const storedQuery = sessionStorage.getItem("parallelSearch_query");
    
    const jobIdToRestore = jobIdFromUrl || storedJobId;
    
    if (jobIdToRestore) {
      // Restore job state
      setCurrentJobId(jobIdToRestore);
      if (storedQuery) {
        setQuery(storedQuery);
      }
      
      // Check job status and reconnect if still active
      getUnifiedSearchJobStatus(jobIdToRestore)
        .then((job) => {
          setQuery(job.query);
          setFilters(prev => ({ ...prev, timeWindow: job.window || prev.timeWindow }));
          setJobStatus(job.status);
          
          if (job.status === "PENDING" || job.status === "IN_PROGRESS") {
            // Reconnect to SSE stream
            reconnectToJob(jobIdToRestore);
          } else if (job.status === "COMPLETED") {
            toast({
              title: "검색 완료됨",
              description: "이전 검색이 이미 완료되었습니다. 새 검색을 시작하세요.",
            });
          } else if (job.status === "FAILED") {
            toast({
              title: "검색 실패",
              description: "이전 검색이 실패했습니다. 새 검색을 시작하세요.",
              variant: "destructive",
            });
          }
        })
        .catch(() => {
          // Job not found, clear stored state
          sessionStorage.removeItem("parallelSearch_currentJobId");
          sessionStorage.removeItem("parallelSearch_query");
          setCurrentJobId(null);
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  // Function to reconnect to an existing job
  const reconnectToJob = useCallback(async (jobId: string) => {
    setIsSearching(true);
    setConnectionStatus("connecting");
    
    // Set all sources to "searching" state
    setSourceStatus({
      database: { status: "searching", message: "재연결 중...", count: 0 },
      web: { status: "searching", message: "재연결 중...", count: 0 },
      ai: { status: "searching", message: "재연결 중...", count: 0 },
    });
    
    try {
      const es = await openUnifiedSearchJobStream(jobId);
      eventSourceRef.current = es;
      
      setupEventHandlers(es, jobId);
      
      toast({
        title: "재연결됨",
        description: "검색 스트림에 다시 연결되었습니다.",
      });
    } catch (error) {
      console.error("Failed to reconnect to job:", error);
      setIsSearching(false);
      setConnectionStatus("error");
      toast({
        title: "재연결 실패",
        description: "검색 스트림에 다시 연결할 수 없습니다.",
        variant: "destructive",
      });
    }
  }, [toast]);
  
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

  // Auto-save unified search results when job completes
  useEffect(() => {
    if (jobStatus === "COMPLETED" && results.length > 0 && query.trim()) {
      const durationMs = searchStartTime ? Date.now() - searchStartTime : undefined;
      
      // Build AI summary object if available
      const aiSummary = aiContent ? { content: aiContent, complete: aiComplete } : undefined;
      
      saveUnifiedSearch(
        query.trim(),
        results.map((r) => ({
          id: r.id,
          source: r.source,
          title: r.title,
          snippet: r.snippet,
          url: r.url,
          publishedAt: r.publishedAt,
          reliabilityScore: r.reliabilityScore,
          sentimentLabel: r.sentimentLabel,
        })),
        aiSummary,
        durationMs,
        filters.timeWindow,
      );
    }
  }, [jobStatus, results, query, aiContent, aiComplete, filters.timeWindow, searchStartTime, saveUnifiedSearch]);

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
    setConnectionStatus("idle");
    setCurrentJobId(null);
    setJobStatus("idle");
    setIsAnalysisSaved(false);
    addedUrlsRef.current.clear();
    setSourceStatus({
      database: { status: "idle", count: 0 },
      web: { status: "idle", count: 0 },
      ai: { status: "idle", count: 0 },
    });
    // Clear stored job info
    sessionStorage.removeItem("parallelSearch_currentJobId");
    sessionStorage.removeItem("parallelSearch_query");
    // Update URL to remove jobId
    const url = new URL(window.location.href);
    url.searchParams.delete("jobId");
    window.history.replaceState({}, document.title, url.pathname);
  }, []);

  // Auto-save new URLs to collection
  const autoSaveUrl = useCallback((result: UnifiedSearchResult) => {
    if (!result.url || addedUrlsRef.current.has(result.url)) {
      return; // Skip if no URL or already added in this session
    }
    
    // Check if URL already exists in collection
    if (urlExists(result.url)) {
      return; // Skip if already exists
    }
    
    // Find or create "Auto-saved" folder
    let autoSavedFolderId = 'root';
    const autoSavedFolder = collection.root.children.find(
      (item) => item.type === 'folder' && item.name === '자동 저장됨'
    );
    
    if (!autoSavedFolder) {
      autoSavedFolderId = addFolder('root', '자동 저장됨', '검색 결과에서 자동으로 저장된 URL');
    } else {
      autoSavedFolderId = autoSavedFolder.id;
    }
    
    // Add URL to collection
    addUrl(
      autoSavedFolderId,
      result.url,
      result.title || undefined,
      result.snippet || undefined,
      result.topics || undefined
    );
    
    // Mark as added in this session
    addedUrlsRef.current.add(result.url);
    
    // Show toast notification
    toast({
      title: "URL 저장됨",
      description: `"${result.title || result.url}"이(가) 컬렉션에 추가되었습니다.`,
    });
  }, [addUrl, addFolder, urlExists, collection.root.children, toast]);

  // Save AI analysis result
  const handleSaveAnalysis = useCallback(() => {
    if (!aiContent || !query) return;
    
    const analysisKey = `newsinsight-analysis-${Date.now()}`;
    const analysisData = {
      id: analysisKey,
      query,
      content: aiContent,
      timestamp: new Date().toISOString(),
      jobId: currentJobId,
      resultCount: results.length,
    };
    
    try {
      // Get existing analyses
      const existingStr = localStorage.getItem('newsinsight-saved-analyses');
      const existing = existingStr ? JSON.parse(existingStr) : [];
      
      // Add new analysis
      existing.unshift(analysisData);
      
      // Keep only the last 50 analyses
      const trimmed = existing.slice(0, 50);
      
      localStorage.setItem('newsinsight-saved-analyses', JSON.stringify(trimmed));
      
      setIsAnalysisSaved(true);
      toast({
        title: "분석 저장됨",
        description: `"${query}" 분석 결과가 저장되었습니다.`,
      });
    } catch (e) {
      console.error('Failed to save analysis:', e);
      toast({
        title: "저장 실패",
        description: "분석 결과를 저장하는 데 실패했습니다.",
        variant: "destructive",
      });
    }
  }, [aiContent, query, currentJobId, results.length, toast]);

  // Manual URL save handler for individual results
  const handleManualSaveUrl = useCallback((result: UnifiedSearchResult) => {
    if (!result.url) return;
    
    // Check if already saved
    if (urlExists(result.url) || addedUrlsRef.current.has(result.url)) {
      toast({
        title: "이미 저장됨",
        description: "이 URL은 이미 컬렉션에 저장되어 있습니다.",
      });
      return;
    }
    
    // Find or create "수동 저장" folder
    let manualFolderId = 'root';
    const manualFolder = collection.root.children.find(
      (item) => item.type === 'folder' && item.name === '수동 저장됨'
    );
    
    if (!manualFolder) {
      manualFolderId = addFolder('root', '수동 저장됨', '검색 결과에서 수동으로 저장한 URL');
    } else {
      manualFolderId = manualFolder.id;
    }
    
    // Add URL to collection
    addUrl(
      manualFolderId,
      result.url,
      result.title || undefined,
      result.snippet || undefined,
      result.topics || undefined
    );
    
    // Mark as added
    addedUrlsRef.current.add(result.url);
    
    toast({
      title: "URL 저장됨",
      description: `"${result.title || result.url}"이(가) 컬렉션에 추가되었습니다.`,
    });
  }, [addUrl, addFolder, urlExists, collection.root.children, toast]);

  // Check if a URL is saved in this session or collection
  const isUrlSaved = useCallback((url: string): boolean => {
    return urlExists(url) || addedUrlsRef.current.has(url);
  }, [urlExists]);

  // Setup event handlers for SSE stream
  const setupEventHandlers = useCallback((es: EventSource, jobId: string) => {
    // Handle job_status event (initial status on connection)
    es.addEventListener("job_status", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        setConnectionStatus("connected");
        setJobStatus(data.status);
        if (data.query) setQuery(data.query);
        if (data.window) setFilters(prev => ({ ...prev, timeWindow: data.window }));
        
        // Set all sources to "searching" state if job is active
        if (data.status === "PENDING" || data.status === "IN_PROGRESS") {
          setSourceStatus({
            database: { status: "searching", message: "검색 중...", count: 0 },
            web: { status: "searching", message: "검색 중...", count: 0 },
            ai: { status: "searching", message: "분석 중...", count: 0 },
          });
        }
      } catch (e) {
        console.error("Failed to parse job_status event:", e);
      }
    });

    // Handle status event (source status updates)
    es.addEventListener("status", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        const source = data.source as SourceType;
        setSourceStatus((prev) => ({
          ...prev,
          [source]: {
            status: "searching",
            message: data.message,
            count: prev[source].count,
          },
        }));
      } catch (e) {
        console.error("Failed to parse status event:", e);
      }
    });

    // Handle result event
    es.addEventListener("result", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        if (data.result) {
          const newResult = data.result as UnifiedSearchResult;
          setResults((prev) => [...prev, newResult]);
          const source = data.source as SourceType;
          setSourceStatus((prev) => ({
            ...prev,
            [source]: {
              ...prev[source],
              count: prev[source].count + 1,
            },
          }));
          
          // Auto-save new URLs from web and database sources
                          if (source !== 'ai' && newResult.url) {
                            autoSaveUrl(newResult);
                          }
        }
      } catch (e) {
        console.error("Failed to parse result event:", e);
      }
    });

    // Handle ai_chunk event
    es.addEventListener("ai_chunk", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        if (data.message) {
          setAiContent((prev) => prev + data.message);
        }
      } catch (e) {
        console.error("Failed to parse ai_chunk event:", e);
      }
    });

    // Handle source_complete event
    es.addEventListener("source_complete", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        const source = data.source as SourceType;
        setSourceStatus((prev) => ({
          ...prev,
          [source]: {
            status: "complete",
            message: data.message,
            count: data.totalCount ?? prev[source].count,
          },
        }));
        if (source === "ai") {
          setAiComplete(true);
        }
      } catch (e) {
        console.error("Failed to parse source_complete event:", e);
      }
    });

    // Handle source_error event
    es.addEventListener("source_error", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        const source = data.source as SourceType;
        setSourceStatus((prev) => ({
          ...prev,
          [source]: {
            status: "error",
            message: data.message,
            count: prev[source].count,
          },
        }));
      } catch (e) {
        console.error("Failed to parse source_error event:", e);
      }
    });

    // Handle done event (all sources completed)
    es.addEventListener("done", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        setIsSearching(false);
        setJobStatus("COMPLETED");
        es.close();
        eventSourceRef.current = null;
        
        // Clear stored job since it's complete
        sessionStorage.removeItem("parallelSearch_currentJobId");
        
        toast({
          title: "검색 완료",
          description: `${data.totalResults || results.length}개의 결과를 찾았습니다.`,
        });
      } catch (e) {
        console.error("Failed to parse done event:", e);
        setIsSearching(false);
      }
    });

    // Handle job_error event
    es.addEventListener("job_error", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        setIsSearching(false);
        setJobStatus("FAILED");
        setConnectionStatus("error");
        es.close();
        eventSourceRef.current = null;
        
        sessionStorage.removeItem("parallelSearch_currentJobId");
        
        toast({
          title: "검색 오류",
          description: data.error || "검색 중 오류가 발생했습니다.",
          variant: "destructive",
        });
      } catch (e) {
        console.error("Failed to parse job_error event:", e);
      }
    });

    // Handle error event
    es.addEventListener("error", () => {
      setIsSearching(false);
      setConnectionStatus("error");
      es.close();
      eventSourceRef.current = null;
      toast({
        title: "연결 오류",
        description: "검색 스트림 연결이 끊어졌습니다.",
        variant: "destructive",
      });
    });

    // Handle heartbeat (keep connection status as connected)
    es.addEventListener("heartbeat", () => {
      setConnectionStatus("connected");
    });

    // Handle generic onerror
    es.onerror = () => {
      // Only handle if not already handled by specific error events
      if (eventSourceRef.current === es) {
        setIsSearching(false);
        setConnectionStatus("error");
        es.close();
        eventSourceRef.current = null;
      }
    };
  }, [toast, results.length, autoSaveUrl]);

  const handleSearch = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isSearching) return;

    // Cleanup previous search
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    
    resetState();
    setIsSearching(true);
    setConnectionStatus("connecting");
    setSearchStartTime(Date.now()); // Track start time for duration

    try {
      // Step 1: Create a new search job
      const job = await startUnifiedSearchJob(query.trim(), filters.timeWindow);
      
      setCurrentJobId(job.jobId);
      setJobStatus(job.status);
      
      // Store job info for reconnection after page refresh
      sessionStorage.setItem("parallelSearch_currentJobId", job.jobId);
      sessionStorage.setItem("parallelSearch_query", query.trim());
      
      // Update URL with jobId for sharing/bookmarking
      const url = new URL(window.location.href);
      url.searchParams.set("jobId", job.jobId);
      window.history.replaceState({}, document.title, url.toString());
      
      // Step 2: Connect to SSE stream for this job
      const es = await openUnifiedSearchJobStream(job.jobId);
      eventSourceRef.current = es;
      
      // Set all sources to "searching" state immediately
      setSourceStatus({
        database: { status: "searching", message: "검색 시작...", count: 0 },
        web: { status: "searching", message: "검색 시작...", count: 0 },
        ai: { status: "searching", message: "분석 시작...", count: 0 },
      });
      
      setConnectionStatus("connected");
      toast({
        title: "검색 시작",
        description: `검색 Job이 생성되었습니다. (${job.jobId.substring(0, 8)}...)`,
      });
      
      // Setup event handlers
      setupEventHandlers(es, job.jobId);

    } catch (error) {
      console.error("Failed to start search:", error);
      setIsSearching(false);
      setConnectionStatus("error");
      
      // Auto-save failed search
      const durationMs = searchStartTime ? Date.now() - searchStartTime : undefined;
      saveFailedSearch('UNIFIED', query, error instanceof Error ? error.message : 'Unknown error', durationMs);
      
      toast({
        title: "오류",
        description: "검색을 시작할 수 없습니다.",
        variant: "destructive",
      });
    }
  }, [query, filters.timeWindow, isSearching, resetState, toast, setupEventHandlers, searchStartTime, saveFailedSearch]);

  const handleCancel = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsSearching(false);
    setConnectionStatus("idle");
    setJobStatus("idle");
    // Clear stored job info
    sessionStorage.removeItem("parallelSearch_currentJobId");
    toast({
      title: "취소됨",
      description: "검색이 취소되었습니다.",
    });
  }, [toast]);

  // Retry search on error
  const handleRetry = useCallback(() => {
    const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
    handleSearch(fakeEvent);
  }, [handleSearch]);

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
              <div className="flex flex-col gap-4">
                {/* 검색 입력 with 제안/자동완성 */}
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex-1">
                    <SearchInputWithSuggestions
                      value={query}
                      onChange={setQuery}
                      onSearch={(q) => {
                        setQuery(q);
                        const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
                        handleSearch(fakeEvent);
                      }}
                      placeholder="뉴스 키워드를 입력하세요... (예: AI 기술, 경제 전망, 정치 이슈)"
                      isLoading={isSearching}
                      disabled={isHealthy === false}
                      size="lg"
                      trendingKeywords={["AI", "반도체", "기후변화", "경제", "선거"]}
                    />
                  </div>
                  {isSearching && (
                    <Button type="button" variant="outline" onClick={handleCancel} className="h-12">
                      취소
                    </Button>
                  )}
                </div>
                
                {/* 고급 필터 - 컴팩트 모드 */}
                <AdvancedFilters
                  filters={filters}
                  onFiltersChange={setFilters}
                  disabled={isSearching}
                  compact
                />
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
                {connectionStatus === "connecting" ? "서버에 연결 중..." : "병렬 검색 진행 중..."}
              </CardTitle>
              <CardDescription>
                {connectionStatus === "connecting" 
                  ? "검색 서버와 실시간 연결을 설정하고 있습니다..."
                  : connectionStatus === "connected"
                    ? <>3개의 소스에서 동시에 검색하고 있습니다. {currentJobId && <span className="text-xs opacity-60">(Job: {currentJobId.substring(0, 8)}...)</span>}</>
                    : "연결 대기 중..."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Connection Status Indicator */}
              {connectionStatus === "connecting" && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>SSE 스트림 연결 대기 중... 첫 이벤트를 기다리고 있습니다.</span>
                </div>
              )}
              {connectionStatus === "connected" && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 text-sm">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>서버에 연결됨 - 실시간 결과가 도착하는 대로 표시됩니다.</span>
                </div>
              )}
              
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
              <AIStreamCard 
                content={aiContent} 
                isComplete={aiComplete}
                onSave={handleSaveAnalysis}
                isSaved={isAnalysisSaved}
                evidence={results}
              />
            )}

            {/* Results List */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>검색 결과</CardTitle>
                    <CardDescription>
                      '{query}'에 대한 검색 결과입니다.
                    </CardDescription>
                  </div>
                  <ExportButton
                    data={results.map(r => ({
                      id: r.id,
                      title: r.title,
                      snippet: r.snippet,
                      url: r.url,
                      source: r.source,
                      publishedAt: r.publishedAt,
                      reliabilityScore: r.reliabilityScore,
                      sentimentLabel: r.sentimentLabel,
                    }))}
                    options={{
                      filename: `newsinsight-search-${query.replace(/\s+/g, '-')}`,
                      title: `"${query}" 검색 결과`,
                      metadata: {
                        검색어: query,
                        총결과: results.length,
                        DB결과: sourceStatus.database.count,
                        웹결과: sourceStatus.web.count,
                      },
                    }}
                    disabled={results.length === 0}
                  />
                </div>
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
                            <SearchResultCard 
                              key={result.id} 
                              result={result}
                              onSaveUrl={handleManualSaveUrl}
                              isUrlSaved={result.url ? isUrlSaved(result.url) : false}
                            />
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

        {/* Connection Error State with Retry */}
        {connectionStatus === "error" && !isSearching && results.length === 0 && (
          <Card className="mb-8 border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10">
            <CardContent className="pt-6">
              <div className="flex flex-col items-center text-center gap-4">
                <div className="p-4 rounded-full bg-red-100 dark:bg-red-900/30">
                  <AlertCircle className="h-8 w-8 text-red-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg mb-1">연결 오류</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    검색 서버와의 연결에 실패했습니다. 네트워크 연결을 확인하거나 잠시 후 다시 시도해주세요.
                  </p>
                  <div className="flex gap-2 justify-center">
                    <Button onClick={handleRetry} variant="default" className="gap-2">
                      <RefreshCw className="h-4 w-4" />
                      다시 시도
                    </Button>
                    <Button onClick={resetState} variant="outline">
                      초기화
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
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
