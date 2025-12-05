import { useState, useCallback, useEffect, useMemo } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  ThumbsUp,
  ThumbsDown,
  Minus,
  ArrowLeft,
  RefreshCw,
  Trash2,
  LayoutGrid,
  List,
  Wifi,
  WifiOff,
  Layers,
  ArrowDownRight,
  History,
  ChevronRight,
} from "lucide-react";
import { ExportButton } from "@/components/ExportButton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { InsightFlow } from "@/components/insight";
import { useDeepSearchSSE } from "@/hooks/useDeepSearchSSE";
import { useBackgroundTasks } from "@/contexts/BackgroundTaskContext";
import { useAutoSaveSearch } from "@/hooks/useSearchHistory";
import { AnalysisProgressTimeline, type AnalysisStep } from "@/components/AnalysisProgressTimeline";
import {
  startDeepSearch,
  startDrilldownSearch,
  getDeepSearchStatus,
  getDeepSearchResult,
  cancelDeepSearch,
  checkDeepSearchHealth,
  type DeepSearchJob,
  type DeepSearchResult,
  type Evidence,
  type DrilldownRequest,
} from "@/lib/api";

const STATUS_CONFIG = {
  PENDING: { label: "대기 중", icon: Clock, color: "bg-yellow-500" },
  IN_PROGRESS: { label: "분석 중", icon: Loader2, color: "bg-blue-500" },
  COMPLETED: { label: "완료", icon: CheckCircle2, color: "bg-green-500" },
  FAILED: { label: "실패", icon: XCircle, color: "bg-red-500" },
  CANCELLED: { label: "취소됨", icon: XCircle, color: "bg-gray-500" },
  TIMEOUT: { label: "시간 초과", icon: AlertCircle, color: "bg-orange-500" },
} as const;

const STANCE_CONFIG = {
  pro: { label: "찬성", icon: ThumbsUp, color: "text-teal-600", bgColor: "bg-teal-100 dark:bg-teal-900/30" },
  con: { label: "반대", icon: ThumbsDown, color: "text-coral-600", bgColor: "bg-coral-100 dark:bg-coral-900/30" },
  neutral: { label: "중립", icon: Minus, color: "text-gray-600", bgColor: "bg-gray-100 dark:bg-gray-800" },
} as const;

interface EvidenceCardProps {
  evidence: Evidence;
  onDrilldown?: (evidence: Evidence) => void;
  drilldownEnabled?: boolean;
}

const EvidenceCard = ({ evidence, onDrilldown, drilldownEnabled = true }: EvidenceCardProps) => {
  const stanceInfo = STANCE_CONFIG[evidence.stance];
  const StanceIcon = stanceInfo.icon;

  return (
    <Card className={`${stanceInfo.bgColor} border-l-4 ${evidence.stance === 'pro' ? 'border-l-teal-500' : evidence.stance === 'con' ? 'border-l-coral-500' : 'border-l-gray-400'}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className={`${stanceInfo.color} flex items-center gap-1`}>
                <StanceIcon className="h-3 w-3" />
                {stanceInfo.label}
              </Badge>
              {evidence.source && (
                <span className="text-xs text-muted-foreground truncate">{evidence.source}</span>
              )}
            </div>
            {evidence.title && (
              <h4 className="font-semibold text-sm mb-1 line-clamp-2">{evidence.title}</h4>
            )}
            <p className="text-sm text-muted-foreground line-clamp-3">{evidence.snippet}</p>
          </div>
          <div className="flex flex-col gap-1">
            <a
              href={evidence.url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 p-2 rounded-md hover:bg-muted transition-colors"
              title="원문 보기"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
            {drilldownEnabled && onDrilldown && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => onDrilldown(evidence)}
                      className="shrink-0 p-2 rounded-md hover:bg-primary/10 transition-colors text-primary"
                      title="심층 조사"
                    >
                      <ArrowDownRight className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>이 주제로 심층 조사</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

interface StanceChartProps {
  distribution: DeepSearchResult["stanceDistribution"];
}

const StanceChart = ({ distribution }: StanceChartProps) => {
  const total = distribution.pro + distribution.con + distribution.neutral;
  if (total === 0) return null;

  return (
    <Card className="glass">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">입장 분포</CardTitle>
        <CardDescription>수집된 증거의 입장 분석 결과</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-1 h-8 rounded-lg overflow-hidden">
          {distribution.proRatio > 0 && (
            <div
              className="bg-teal-500 flex items-center justify-center text-white text-xs font-medium transition-all"
              style={{ width: `${distribution.proRatio}%` }}
            >
              {distribution.proRatio >= 10 && `${distribution.proRatio.toFixed(0)}%`}
            </div>
          )}
          {distribution.neutralRatio > 0 && (
            <div
              className="bg-gray-400 flex items-center justify-center text-white text-xs font-medium transition-all"
              style={{ width: `${distribution.neutralRatio}%` }}
            >
              {distribution.neutralRatio >= 10 && `${distribution.neutralRatio.toFixed(0)}%`}
            </div>
          )}
          {distribution.conRatio > 0 && (
            <div
              className="bg-coral-500 flex items-center justify-center text-white text-xs font-medium transition-all"
              style={{ width: `${distribution.conRatio}%` }}
            >
              {distribution.conRatio >= 10 && `${distribution.conRatio.toFixed(0)}%`}
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="flex items-center justify-center gap-1 text-teal-600 mb-1">
              <ThumbsUp className="h-4 w-4" />
              <span className="font-bold">{distribution.pro}</span>
            </div>
            <span className="text-xs text-muted-foreground">찬성</span>
          </div>
          <div>
            <div className="flex items-center justify-center gap-1 text-gray-600 mb-1">
              <Minus className="h-4 w-4" />
              <span className="font-bold">{distribution.neutral}</span>
            </div>
            <span className="text-xs text-muted-foreground">중립</span>
          </div>
          <div>
            <div className="flex items-center justify-center gap-1 text-coral-600 mb-1">
              <ThumbsDown className="h-4 w-4" />
              <span className="font-bold">{distribution.con}</span>
            </div>
            <span className="text-xs text-muted-foreground">반대</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const isTerminalStatus = (status: string) => 
  ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT'].includes(status);

// Drilldown history item
interface DrilldownHistoryItem {
  jobId: string;
  topic: string;
  parentJobId?: string;
  depth: number;
  createdAt: string;
}

const DeepSearch = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { getTask } = useBackgroundTasks();
  const { saveDeepSearch, saveFailedSearch } = useAutoSaveSearch();
  
  // Track search start time for duration calculation
  const [searchStartTime, setSearchStartTime] = useState<number | null>(null);
  
  const [topic, setTopic] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [activeStance, setActiveStance] = useState<"all" | "pro" | "con" | "neutral">("all");
  const [viewMode, setViewMode] = useState<"insight" | "list">("insight");
  
  // Drilldown state
  const [drilldownHistory, setDrilldownHistory] = useState<DrilldownHistoryItem[]>([]);
  const [currentDepth, setCurrentDepth] = useState(0);
  const [drilldownDialogOpen, setDrilldownDialogOpen] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState<Evidence | null>(null);
  const [focusAspect, setFocusAspect] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  // Load jobId from URL params or background task
  useEffect(() => {
    const jobIdFromUrl = searchParams.get('jobId');
    if (jobIdFromUrl && jobIdFromUrl !== currentJobId) {
      setCurrentJobId(jobIdFromUrl);
    }
  }, [searchParams, currentJobId]);

  // Load query from location state (e.g., from Search History page)
  useEffect(() => {
    const locationState = location.state as { 
      query?: string; 
      fromHistory?: boolean; 
      historyId?: number;
      parentSearchId?: number;
      deriveFrom?: number;
    } | null;
    
    if (locationState?.query && !currentJobId) {
      setTopic(locationState.query);
      
      if (locationState.fromHistory) {
        toast({
          title: "검색 기록에서 연결됨",
          description: `"${locationState.query}" 주제로 Deep Search를 시작할 수 있습니다.`,
        });
        // Clear the location state to prevent showing toast again
        window.history.replaceState({}, document.title);
      }
      
      if (locationState.deriveFrom) {
        setCurrentDepth(1);
        toast({
          title: "파생 검색",
          description: "이전 검색에서 파생된 심층 검색을 시작합니다.",
        });
        // Clear the location state
        window.history.replaceState({}, document.title);
      }
    }
  }, [location.state, currentJobId, toast]);

  // Load query from URL params (e.g., from FactCheck page)
  useEffect(() => {
    const queryFromUrl = searchParams.get('q');
    const fromFactCheck = searchParams.get('fromFactCheck') === 'true';
    
    if (queryFromUrl && !currentJobId) {
      setTopic(queryFromUrl);
      
      // Show toast if coming from FactCheck
      if (fromFactCheck) {
        toast({
          title: "팩트체크에서 연결됨",
          description: "해당 주제에 대해 Deep Search를 시작할 수 있습니다.",
        });
        // Clear the fromFactCheck param to prevent showing toast again
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('fromFactCheck');
        setSearchParams(newParams, { replace: true });
      }
      
      // Handle fromAgent parameter
      const fromAgent = searchParams.get('fromAgent') === 'true';
      if (fromAgent) {
        toast({
          title: "Browser Agent에서 연결됨",
          description: "추출된 데이터에 대해 Deep Search를 시작할 수 있습니다.",
        });
        // Clear the fromAgent param to prevent showing toast again
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('fromAgent');
        setSearchParams(newParams, { replace: true });
      }
    }
  }, [searchParams, currentJobId, setSearchParams, toast]);

  // React Query: 서비스 헬스 체크
  const { data: healthData } = useQuery({
    queryKey: ['deepSearch', 'health'],
    queryFn: checkDeepSearchHealth,
    staleTime: 60_000,
    retry: 1,
  });

  const isHealthy = healthData?.enabled ?? null;

  // SSE connection for real-time updates
  const sseEnabled = !!currentJobId;

  const {
    status: sseStatus,
    currentStatus,
    progress,
    progressMessage,
    evidenceCount,
    result: sseResult,
    error: sseError,
  } = useDeepSearchSSE({
    jobId: currentJobId,
    topic,
    enabled: sseEnabled,
    autoAddToBackground: true,
    onComplete: (result) => {
      queryClient.setQueryData(['deepSearch', 'result', currentJobId], result);
      toast({
        title: "분석 완료",
        description: `${result.evidence.length}개의 증거를 수집했습니다.`,
      });
      
      // Auto-save search results
      const durationMs = searchStartTime ? Date.now() - searchStartTime : undefined;
      saveDeepSearch(
        result.jobId,
        result.topic,
        result.evidence as Array<Record<string, unknown>>,
        result.stanceDistribution as Record<string, unknown>,
        durationMs,
        drilldownHistory.length > 0 ? undefined : undefined, // Will be set if this is a drilldown
      );
    },
    onError: (error) => {
      toast({
        title: "분석 실패",
        description: error,
        variant: "destructive",
      });
      
      // Auto-save failed search
      const durationMs = searchStartTime ? Date.now() - searchStartTime : undefined;
      saveFailedSearch('DEEP_SEARCH', topic, error, durationMs);
    },
  });

  // Fallback: Fetch result if we have jobId but no SSE result (e.g., page refresh)
  const { data: fetchedResult } = useQuery({
    queryKey: ['deepSearch', 'result', currentJobId],
    queryFn: () => getDeepSearchResult(currentJobId!),
    enabled: !!currentJobId && !sseResult && currentStatus === 'COMPLETED',
    staleTime: Infinity,
  });

  // Fallback: Get job status if we have jobId but no SSE connection yet
  const { data: fetchedJob } = useQuery({
    queryKey: ['deepSearch', 'job', currentJobId],
    queryFn: () => getDeepSearchStatus(currentJobId!),
    enabled: !!currentJobId && sseStatus === 'disconnected',
    staleTime: 5000,
  });

  const result = sseResult || fetchedResult;
  const jobStatus = currentStatus || fetchedJob?.status;

  // React Query: 검색 시작 Mutation
  const startMutation = useMutation({
    mutationFn: startDeepSearch,
    onSuccess: (job) => {
      setCurrentJobId(job.jobId);
      setSearchParams({ jobId: job.jobId });
      setSearchStartTime(Date.now()); // Track start time
      toast({
        title: "분석 시작",
        description: "Deep AI Search를 시작했습니다. 백그라운드에서 계속 실행됩니다.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "오류",
        description: error.response?.data?.message || error.message || "분석 시작에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  // React Query: 취소 Mutation
  const cancelMutation = useMutation({
    mutationFn: () => cancelDeepSearch(currentJobId!),
    onSuccess: () => {
      toast({
        title: "취소됨",
        description: "분석이 취소되었습니다.",
      });
    },
    onError: () => {
      toast({
        title: "오류",
        description: "취소에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  // React Query: 드릴다운 검색 Mutation
  const drilldownMutation = useMutation({
    mutationFn: startDrilldownSearch,
    onSuccess: (job) => {
      // 현재 결과를 히스토리에 저장
      if (result) {
        setDrilldownHistory(prev => [...prev, {
          jobId: currentJobId!,
          topic: result.topic,
          parentJobId: undefined,
          depth: currentDepth,
          createdAt: new Date().toISOString(),
        }]);
      }
      
      setCurrentJobId(job.jobId);
      setCurrentDepth(prev => prev + 1);
      setSearchParams({ jobId: job.jobId });
      setDrilldownDialogOpen(false);
      setSelectedEvidence(null);
      setFocusAspect("");
      
      toast({
        title: "심층 조사 시작",
        description: `'${selectedEvidence?.title || '선택한 증거'}'에 대한 심층 분석을 시작합니다.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "오류",
        description: error.response?.data?.message || error.message || "심층 조사 시작에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || startMutation.isPending) return;

    // 이전 결과 초기화
    setCurrentJobId(null);
    setSearchParams({});
    queryClient.removeQueries({ queryKey: ['deepSearch', 'job'] });
    queryClient.removeQueries({ queryKey: ['deepSearch', 'result'] });

    startMutation.mutate({
      topic: topic.trim(),
      baseUrl: baseUrl.trim() || undefined,
    });
  }, [topic, baseUrl, startMutation, queryClient, setSearchParams]);

  const handleCancel = useCallback(() => {
    if (!currentJobId) return;
    cancelMutation.mutate();
  }, [currentJobId, cancelMutation]);

  const handleReset = useCallback(() => {
    setCurrentJobId(null);
    setTopic("");
    setBaseUrl("");
    setActiveStance("all");
    setSearchParams({});
    setDrilldownHistory([]);
    setCurrentDepth(0);
    queryClient.removeQueries({ queryKey: ['deepSearch', 'job'] });
    queryClient.removeQueries({ queryKey: ['deepSearch', 'result'] });
  }, [queryClient, setSearchParams]);

  // 드릴다운 핸들러
  const handleDrilldown = useCallback((evidence: Evidence) => {
    setSelectedEvidence(evidence);
    setDrilldownDialogOpen(true);
  }, []);

  // 드릴다운 실행
  const executeDrilldown = useCallback(() => {
    if (!selectedEvidence || !result) return;
    
    drilldownMutation.mutate({
      parentTopic: result.topic,
      parentJobId: currentJobId || undefined,
      evidence: {
        url: selectedEvidence.url,
        title: selectedEvidence.title,
        snippet: selectedEvidence.snippet,
        stance: selectedEvidence.stance,
      },
      focusAspect: focusAspect.trim() || undefined,
      depth: currentDepth,
    });
  }, [selectedEvidence, result, currentJobId, focusAspect, currentDepth, drilldownMutation]);

  // 히스토리에서 이전 결과로 이동
  const navigateToHistory = useCallback((item: DrilldownHistoryItem) => {
    setCurrentJobId(item.jobId);
    setCurrentDepth(item.depth);
    setSearchParams({ jobId: item.jobId });
    setTopic(item.topic);
    
    // 현재 항목 이후의 히스토리 제거
    setDrilldownHistory(prev => {
      const index = prev.findIndex(h => h.jobId === item.jobId);
      return prev.slice(0, index);
    });
    
    toast({
      title: "이전 분석으로 이동",
      description: `'${item.topic}' 분석 결과를 불러옵니다.`,
    });
  }, [setSearchParams, toast]);

  const filteredEvidence = result?.evidence.filter(
    (e) => activeStance === "all" || e.stance === activeStance
  ) ?? [];

  const isProcessing = currentJobId && 
    (jobStatus === "PENDING" || jobStatus === "IN_PROGRESS");

  const connectionStatusBadge = () => {
    if (!currentJobId || isTerminalStatus(jobStatus || '')) return null;
    
    switch (sseStatus) {
      case 'connected':
        return (
          <Badge variant="secondary" className="text-green-600">
            <Wifi className="h-3 w-3 mr-1" />
            실시간 연결됨
          </Badge>
        );
      case 'connecting':
        return (
          <Badge variant="secondary" className="animate-pulse">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            연결 중...
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="secondary" className="text-orange-600">
            <WifiOff className="h-3 w-3 mr-1" />
            재연결 시도 중
          </Badge>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen py-8">
      <div className="container mx-auto px-4 max-w-5xl">
        {/* Header */}
        <header className="mb-8">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            메인으로 돌아가기
          </Link>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                  Deep AI Search
                </h1>
                {currentDepth > 0 && (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    <Layers className="h-3 w-3" />
                    깊이 {currentDepth}
                  </Badge>
                )}
              </div>
              <p className="text-muted-foreground">
                AI 기반 심층 분석으로 주제에 대한 다양한 입장과 증거를 수집합니다.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {connectionStatusBadge()}
              {drilldownHistory.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowHistory(!showHistory)}
                  className="gap-1"
                >
                  <History className="h-4 w-4" />
                  분석 기록
                  <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1">
                    {drilldownHistory.length}
                  </Badge>
                </Button>
              )}
            </div>
          </div>
          {isHealthy === false && (
            <div className="mt-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Deep Search 서비스가 현재 사용 불가능합니다.
            </div>
          )}
        </header>

        {/* Drilldown History Breadcrumb */}
        {drilldownHistory.length > 0 && showHistory && (
          <Card className="mb-6 border-primary/20 bg-primary/5">
            <CardContent className="py-4">
              <div className="flex items-center gap-2 text-sm overflow-x-auto">
                <span className="text-muted-foreground shrink-0">분석 경로:</span>
                {drilldownHistory.map((item, index) => (
                  <div key={item.jobId} className="flex items-center shrink-0">
                    <button
                      onClick={() => navigateToHistory(item)}
                      className="px-2 py-1 rounded hover:bg-primary/10 transition-colors text-primary underline-offset-2 hover:underline"
                    >
                      {item.topic.length > 30 ? `${item.topic.substring(0, 30)}...` : item.topic}
                    </button>
                    <ChevronRight className="h-4 w-4 text-muted-foreground mx-1" />
                  </div>
                ))}
                <Badge variant="default" className="shrink-0">
                  현재: {result?.topic || topic || '새 분석'}
                </Badge>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Drilldown Dialog */}
        <Dialog open={drilldownDialogOpen} onOpenChange={setDrilldownDialogOpen}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ArrowDownRight className="h-5 w-5 text-primary" />
                심층 조사
              </DialogTitle>
              <DialogDescription>
                선택한 증거를 기반으로 더 깊이 파고드는 분석을 시작합니다.
              </DialogDescription>
            </DialogHeader>
            {selectedEvidence && (
              <div className="space-y-4 py-4">
                <div className="p-3 rounded-lg bg-muted">
                  <p className="text-sm font-medium mb-1">{selectedEvidence.title || '제목 없음'}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{selectedEvidence.snippet}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">
                    집중 분석할 측면 (선택사항)
                  </label>
                  <Input
                    value={focusAspect}
                    onChange={(e) => setFocusAspect(e.target.value)}
                    placeholder="예: 경제적 영향, 환경적 측면, 사회적 논쟁 등"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    비워두면 증거의 제목/내용을 기반으로 분석합니다.
                  </p>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setDrilldownDialogOpen(false)}>
                취소
              </Button>
              <Button 
                onClick={executeDrilldown}
                disabled={drilldownMutation.isPending}
              >
                {drilldownMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    시작 중...
                  </>
                ) : (
                  <>
                    <ArrowDownRight className="h-4 w-4 mr-2" />
                    심층 조사 시작
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Search Form */}
        <Card className="mb-8">
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="topic" className="block text-sm font-medium mb-2">
                  분석 주제 *
                </label>
                <Input
                  id="topic"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="예: 원자력 발전의 장단점"
                  disabled={isProcessing || isHealthy === false}
                  className="text-lg"
                />
              </div>
              <div>
                <label htmlFor="baseUrl" className="block text-sm font-medium mb-2">
                  검색 시작 URL (선택)
                </label>
                <Input
                  id="baseUrl"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://example.com"
                  disabled={isProcessing || isHealthy === false}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  특정 사이트에서 시작하여 검색하려면 URL을 입력하세요.
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  type="submit"
                  disabled={!topic.trim() || isProcessing || isHealthy === false || startMutation.isPending}
                  className="flex-1"
                >
                  {startMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      시작 중...
                    </>
                  ) : (
                    <>
                      <Search className="h-4 w-4 mr-2" />
                      분석 시작
                    </>
                  )}
                </Button>
                {(currentJobId || result) && (
                  <Button type="button" variant="outline" onClick={handleReset}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    초기화
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Processing Status */}
        {isProcessing && (
          <Card className="mb-8">
            <CardContent className="py-6">
              <AnalysisProgressTimeline
                currentStep={
                  jobStatus === "PENDING" ? "queued" :
                  progress < 20 ? "initializing" :
                  progress < 40 ? "searching" :
                  progress < 60 ? "collecting" :
                  progress < 80 ? "analyzing" :
                  progress < 95 ? "classifying" :
                  "summarizing"
                }
                overallProgress={progress || (jobStatus === "PENDING" ? 5 : 25)}
                message={progressMessage}
                collectedCount={evidenceCount}
                topic={topic}
              />
              <div className="flex justify-center mt-6">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleCancel}
                  disabled={cancelMutation.isPending}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {cancelMutation.isPending ? "취소 중..." : "분석 취소"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error/Cancelled State */}
        {currentJobId && (jobStatus === "FAILED" || jobStatus === "CANCELLED" || jobStatus === "TIMEOUT") && !result && (
          <Card className="mb-8">
            <CardContent className="py-8">
              <div className="text-center space-y-4">
                {jobStatus === "FAILED" ? (
                  <XCircle className="h-12 w-12 mx-auto text-destructive" />
                ) : jobStatus === "TIMEOUT" ? (
                  <AlertCircle className="h-12 w-12 mx-auto text-orange-500" />
                ) : (
                  <XCircle className="h-12 w-12 mx-auto text-muted-foreground" />
                )}
                <div>
                  <h3 className="font-semibold text-lg">
                    {STATUS_CONFIG[jobStatus as keyof typeof STATUS_CONFIG]?.label || jobStatus}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {sseError || "분석이 완료되지 않았습니다."}
                  </p>
                </div>
                <Button variant="outline" onClick={handleReset}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  다시 시도
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-6">
            {/* View Mode Toggle */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-xl font-semibold">분석 결과</h2>
              <div className="flex items-center gap-2">
                <ExportButton
                  data={result.evidence.map(e => ({
                    id: e.id,
                    title: e.title,
                    snippet: e.snippet,
                    url: e.url,
                    source: e.source,
                    stance: e.stance,
                  }))}
                  options={{
                    filename: `newsinsight-deepsearch-${result.topic.replace(/\s+/g, '-')}`,
                    title: `"${result.topic}" Deep Search 결과`,
                    metadata: {
                      주제: result.topic,
                      총증거: result.evidence.length,
                      찬성: result.stanceDistribution.pro,
                      반대: result.stanceDistribution.con,
                      중립: result.stanceDistribution.neutral,
                    },
                  }}
                  size="sm"
                  disabled={result.evidence.length === 0}
                />
                <div className="flex items-center gap-2 p-1 rounded-lg bg-muted">
                  <Button
                    variant={viewMode === "insight" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setViewMode("insight")}
                    className="gap-2"
                  >
                    <LayoutGrid className="h-4 w-4" />
                    <span className="hidden sm:inline">인사이트 뷰</span>
                  </Button>
                  <Button
                    variant={viewMode === "list" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setViewMode("list")}
                    className="gap-2"
                  >
                    <List className="h-4 w-4" />
                    <span className="hidden sm:inline">상세 목록</span>
                  </Button>
                </div>
              </div>
            </div>

            {/* Insight Flow View (Card Carousel) */}
            {viewMode === "insight" && (
              <InsightFlow
                result={result}
                onShare={() => {
                  navigator.clipboard.writeText(window.location.href);
                  toast({
                    title: "링크 복사됨",
                    description: "분석 결과 링크가 클립보드에 복사되었습니다.",
                  });
                }}
                onDownload={() => {
                  toast({
                    title: "준비 중",
                    description: "이미지 다운로드 기능은 곧 제공될 예정입니다.",
                  });
                }}
              />
            )}

            {/* List View (Original) */}
            {viewMode === "list" && (
              <>
                {/* Summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <Card className="glass">
                    <CardContent className="pt-6">
                      <div className="text-center">
                        <p className="text-3xl font-bold">{result.evidence.length}</p>
                        <p className="text-sm text-muted-foreground">수집된 증거</p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="glass">
                    <CardContent className="pt-6">
                      <div className="text-center">
                        <p className="text-3xl font-bold text-teal-600">
                          {result.stanceDistribution.proRatio.toFixed(0)}%
                        </p>
                        <p className="text-sm text-muted-foreground">찬성 비율</p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="glass">
                    <CardContent className="pt-6">
                      <div className="text-center">
                        <p className="text-3xl font-bold text-coral-600">
                          {result.stanceDistribution.conRatio.toFixed(0)}%
                        </p>
                        <p className="text-sm text-muted-foreground">반대 비율</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Stance Distribution */}
                <StanceChart distribution={result.stanceDistribution} />

                {/* Evidence List */}
                <Card>
                  <CardHeader>
                    <CardTitle>수집된 증거</CardTitle>
                    <CardDescription>
                      '{result.topic}'에 대해 수집된 다양한 입장의 증거입니다.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Tabs value={activeStance} onValueChange={(v) => setActiveStance(v as typeof activeStance)}>
                      <TabsList className="mb-4">
                        <TabsTrigger value="all">
                          전체 ({result.evidence.length})
                        </TabsTrigger>
                        <TabsTrigger value="pro" className="text-teal-600">
                          찬성 ({result.stanceDistribution.pro})
                        </TabsTrigger>
                        <TabsTrigger value="neutral">
                          중립 ({result.stanceDistribution.neutral})
                        </TabsTrigger>
                        <TabsTrigger value="con" className="text-coral-600">
                          반대 ({result.stanceDistribution.con})
                        </TabsTrigger>
                      </TabsList>
                      <TabsContent value={activeStance} className="space-y-4">
                        {filteredEvidence.length > 0 ? (
                          filteredEvidence.map((evidence) => (
                            <EvidenceCard 
                              key={evidence.id} 
                              evidence={evidence}
                              onDrilldown={handleDrilldown}
                              drilldownEnabled={!isProcessing}
                            />
                          ))
                        ) : (
                          <div className="text-center py-8 text-muted-foreground">
                            해당 입장의 증거가 없습니다.
                          </div>
                        )}
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>
              </>
            )}

            {/* Meta Info */}
            <div className="text-center text-xs text-muted-foreground">
              분석 완료: {result.completedAt ? new Date(result.completedAt).toLocaleString("ko-KR") : "-"}
              {" | "}
              Job ID: {result.jobId}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!currentJobId && !result && (
          <div className="text-center py-16">
            <div className="inline-block p-4 rounded-full bg-accent/10 mb-4">
              <Search className="h-12 w-12 text-accent" />
            </div>
            <h2 className="text-xl font-semibold mb-2">주제를 입력하세요</h2>
            <p className="text-muted-foreground max-w-md mx-auto mb-4">
              분석하고 싶은 주제를 입력하면 AI가 웹에서 다양한 입장의 증거를 수집하고 분류합니다.
            </p>
            <p className="text-sm text-muted-foreground">
              분석 중에도 다른 페이지를 탐색할 수 있으며, 상단의 작업 인디케이터에서 진행 상황을 확인할 수 있습니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DeepSearch;
