import { useState, useCallback, useEffect, useRef } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  ArrowLeft,
  RefreshCw,
  Trash2,
  Play,
  Hand,
  MousePointer,
  Type,
  Navigation,
  Eye,
  Send,
  Pause,
  Camera,
  Globe,
  MonitorPlay,
  Wifi,
  WifiOff,
  FolderPlus,
  BookmarkPlus,
  History,
  Save,
  Download,
  FileJson,
  FileText,
  Search,
  Shield,
  Microscope,
  MoreVertical,
  ChevronDown,
  ChevronUp,
  X,
  Copy,
  BarChart3,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { useUrlCollection } from "@/hooks/useUrlCollection";
import { useAgentResultsStorage, SavedAgentResult } from "@/hooks/useAgentResultsStorage";
import { useAutoSaveSearch } from "@/hooks/useSearchHistory";
import { TaskTemplates, TaskTemplate } from "@/components/TaskTemplates";
import {
  checkBrowserUseHealth,
  startBrowserTask,
  getBrowserJobStatus,
  submitIntervention,
  requestManualIntervention,
  cancelBrowserJob,
  getBrowserWSUrl,
  type BrowserJobStatus,
  type BrowserJobStatusResponse,
  type BrowserWSMessage,
  type HumanAction,
  type InterventionType,
} from "@/lib/api";

const STATUS_CONFIG: Record<BrowserJobStatus, { label: string; icon: typeof Clock; color: string }> = {
  pending: { label: "Pending", icon: Clock, color: "bg-yellow-500" },
  running: { label: "Running", icon: Loader2, color: "bg-blue-500" },
  waiting_human: { label: "Needs Help", icon: Hand, color: "bg-orange-500" },
  completed: { label: "Completed", icon: CheckCircle2, color: "bg-green-500" },
  failed: { label: "Failed", icon: XCircle, color: "bg-red-500" },
  cancelled: { label: "Cancelled", icon: XCircle, color: "bg-gray-500" },
};

const INTERVENTION_CONFIG: Record<InterventionType, { label: string; description: string }> = {
  captcha: { label: "CAPTCHA", description: "Solve verification challenge" },
  login: { label: "Login", description: "Authentication required" },
  navigation: { label: "Navigation", description: "Help navigate the page" },
  extraction: { label: "Extraction", description: "Help extract content" },
  confirmation: { label: "Confirmation", description: "Confirm before proceeding" },
  custom: { label: "Custom", description: "Custom intervention" },
};

interface InterventionPanelProps {
  job: BrowserJobStatusResponse;
  onSubmit: (action: HumanAction) => void;
  isSubmitting: boolean;
}

const InterventionPanel = ({ job, onSubmit, isSubmitting }: InterventionPanelProps) => {
  const [actionType, setActionType] = useState<HumanAction["action_type"]>("click");
  const [selector, setSelector] = useState("");
  const [value, setValue] = useState("");
  const [clickX, setClickX] = useState<number | undefined>();
  const [clickY, setClickY] = useState<number | undefined>();
  const [customScript, setCustomScript] = useState("");
  const [message, setMessage] = useState("");

  const handleSubmit = () => {
    const action: HumanAction = {
      action_type: actionType,
      selector: selector || undefined,
      value: value || undefined,
      x: clickX,
      y: clickY,
      custom_script: customScript || undefined,
      message: message || undefined,
    };
    onSubmit(action);
  };

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = e.currentTarget.naturalWidth / rect.width;
    const scaleY = e.currentTarget.naturalHeight / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    setClickX(x);
    setClickY(y);
    setActionType("click");
  };

  const interventionInfo = job.intervention_type ? INTERVENTION_CONFIG[job.intervention_type] : null;

  return (
    <Card className="border-orange-500 border-2">
      <CardHeader className="bg-orange-50 dark:bg-orange-900/20">
        <div className="flex items-center gap-2">
          <Hand className="h-5 w-5 text-orange-500" />
          <CardTitle className="text-lg">Human Intervention Required</CardTitle>
        </div>
        {interventionInfo && (
          <CardDescription>
            <Badge variant="outline" className="mr-2">{interventionInfo.label}</Badge>
            {interventionInfo.description}
          </CardDescription>
        )}
        {job.intervention_reason && (
          <p className="text-sm text-muted-foreground mt-2">{job.intervention_reason}</p>
        )}
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {/* Screenshot with click support */}
        {job.intervention_screenshot && (
          <div className="relative">
            <Label className="text-sm font-medium mb-2 block">
              Browser View (Click to select position)
            </Label>
            <div className="border rounded-lg overflow-hidden cursor-crosshair relative">
              <img
                src={`data:image/jpeg;base64,${job.intervention_screenshot}`}
                alt="Browser screenshot"
                className="w-full"
                onClick={handleImageClick}
              />
              {clickX !== undefined && clickY !== undefined && (
                <div
                  className="absolute w-4 h-4 bg-red-500 rounded-full border-2 border-white transform -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ left: `${(clickX / 1920) * 100}%`, top: `${(clickY / 1080) * 100}%` }}
                />
              )}
            </div>
            {job.current_url && (
              <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                <Globe className="h-3 w-3" />
                <span className="truncate">{job.current_url}</span>
              </div>
            )}
          </div>
        )}

        {/* Action Type */}
        <div className="space-y-2">
          <Label>Action Type</Label>
          <Select value={actionType} onValueChange={(v) => setActionType(v as HumanAction["action_type"])}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="click">
                <div className="flex items-center gap-2">
                  <MousePointer className="h-4 w-4" /> Click
                </div>
              </SelectItem>
              <SelectItem value="type">
                <div className="flex items-center gap-2">
                  <Type className="h-4 w-4" /> Type Text
                </div>
              </SelectItem>
              <SelectItem value="navigate">
                <div className="flex items-center gap-2">
                  <Navigation className="h-4 w-4" /> Navigate to URL
                </div>
              </SelectItem>
              <SelectItem value="scroll">
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4" /> Scroll
                </div>
              </SelectItem>
              <SelectItem value="custom">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4" /> Custom Script
                </div>
              </SelectItem>
              <SelectItem value="skip">
                <div className="flex items-center gap-2">
                  <Play className="h-4 w-4" /> Skip (Continue)
                </div>
              </SelectItem>
              <SelectItem value="abort">
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4" /> Abort Task
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Action-specific inputs */}
        {(actionType === "click" || actionType === "type") && (
          <div className="space-y-2">
            <Label>CSS Selector (optional if clicking on screenshot)</Label>
            <Input
              value={selector}
              onChange={(e) => setSelector(e.target.value)}
              placeholder="e.g., #submit-btn, .login-button, input[name='email']"
            />
          </div>
        )}

        {actionType === "click" && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>X Coordinate</Label>
              <Input
                type="number"
                value={clickX ?? ""}
                onChange={(e) => setClickX(e.target.value ? parseInt(e.target.value) : undefined)}
                placeholder="X position"
              />
            </div>
            <div className="space-y-2">
              <Label>Y Coordinate</Label>
              <Input
                type="number"
                value={clickY ?? ""}
                onChange={(e) => setClickY(e.target.value ? parseInt(e.target.value) : undefined)}
                placeholder="Y position"
              />
            </div>
          </div>
        )}

        {actionType === "type" && (
          <div className="space-y-2">
            <Label>Text to Type</Label>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Enter text to type"
            />
          </div>
        )}

        {actionType === "navigate" && (
          <div className="space-y-2">
            <Label>URL</Label>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="https://example.com"
            />
          </div>
        )}

        {actionType === "scroll" && (
          <div className="space-y-2">
            <Label>Scroll Amount (pixels, negative for up)</Label>
            <Input
              type="number"
              value={clickY ?? 500}
              onChange={(e) => setClickY(parseInt(e.target.value) || 500)}
              placeholder="500"
            />
          </div>
        )}

        {actionType === "custom" && (
          <div className="space-y-2">
            <Label>JavaScript Code</Label>
            <Textarea
              value={customScript}
              onChange={(e) => setCustomScript(e.target.value)}
              placeholder="document.querySelector('button').click();"
              rows={4}
            />
          </div>
        )}

        {/* Message to AI */}
        <div className="space-y-2">
          <Label>Message to AI (optional)</Label>
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Additional context for the AI agent"
          />
        </div>

        {/* Submit buttons */}
        <div className="flex gap-2">
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-1"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Submit Action
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => onSubmit({ action_type: "skip" })}
            disabled={isSubmitting}
          >
            Skip
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

const BrowserAgent = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const wsRef = useRef<WebSocket | null>(null);
  const jobStartTimeRef = useRef<string | null>(null);
  const { addUrl, addFolder, collection, urlExists } = useUrlCollection();
  const { saveBrowserAgent, saveFailedSearch } = useAutoSaveSearch();
  
  // Agent results storage
  const {
    savedResults,
    isLoaded: storageLoaded,
    saveResult,
    deleteResult,
    updateResult,
    exportToJson,
    exportToMarkdown,
    exportToCsv,
    getStats,
    clearAllResults,
  } = useAgentResultsStorage();

  // Form state
  const [task, setTask] = useState("");
  const [url, setUrl] = useState("");
  const [maxSteps, setMaxSteps] = useState(25);
  const [enableIntervention, setEnableIntervention] = useState(true);
  const [autoIntervention, setAutoIntervention] = useState(true);
  const [autoSaveUrls, setAutoSaveUrls] = useState(true);

  // Job state
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [liveScreenshot, setLiveScreenshot] = useState<string | null>(null);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  
  // Track saved URLs in this session
  const savedUrlsRef = useRef<Set<string>>(new Set());
  const [savedUrlCount, setSavedUrlCount] = useState(0);
  
  // History panel state
  const [showHistory, setShowHistory] = useState(false);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<SavedAgentResult | null>(null);
  const [historyDetailOpen, setHistoryDetailOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<"all" | "completed" | "failed">("all");
  
  // Auto-save URL to collection
  const autoSaveVisitedUrl = useCallback((visitedUrl: string) => {
    if (!autoSaveUrls || !visitedUrl) return;
    
    // Skip if already saved in this session or in collection
    if (savedUrlsRef.current.has(visitedUrl) || urlExists(visitedUrl)) {
      return;
    }
    
    // Skip common non-content URLs
    const skipPatterns = [
      /^about:/,
      /^chrome:/,
      /^data:/,
      /^javascript:/,
      /google\.com\/search/,
      /bing\.com\/search/,
      /duckduckgo\.com\/\?q/,
    ];
    
    if (skipPatterns.some(pattern => pattern.test(visitedUrl))) {
      return;
    }
    
    // Find or create "Browser Agent" folder
    let agentFolderId = 'root';
    const agentFolder = collection.root.children.find(
      (item) => item.type === 'folder' && item.name === '브라우저 에이전트'
    );
    
    if (!agentFolder) {
      agentFolderId = addFolder('root', '브라우저 에이전트', 'AI 브라우저 에이전트가 방문한 URL 자동 저장');
    } else {
      agentFolderId = agentFolder.id;
    }
    
    // Extract title from URL if possible
    let title: string | undefined;
    try {
      const urlObj = new URL(visitedUrl);
      title = urlObj.hostname + urlObj.pathname.slice(0, 50);
    } catch {
      // Ignore URL parse errors
    }
    
    // Add URL to collection
    addUrl(agentFolderId, visitedUrl, title);
    savedUrlsRef.current.add(visitedUrl);
    setSavedUrlCount(prev => prev + 1);
  }, [autoSaveUrls, urlExists, collection.root.children, addFolder, addUrl]);

  // Health check
  const { data: health } = useQuery({
    queryKey: ["browserUse", "health"],
    queryFn: checkBrowserUseHealth,
    staleTime: 30_000,
    retry: 1,
  });

  const isHealthy = health?.status === "healthy";

  // Job status polling
  const { data: currentJob } = useQuery({
    queryKey: ["browserUse", "job", currentJobId],
    queryFn: () => getBrowserJobStatus(currentJobId!),
    enabled: !!currentJobId,
    refetchInterval: (query) => {
      const data = query.state.data as BrowserJobStatusResponse | undefined;
      if (!data) return 2000;
      if (["completed", "failed", "cancelled"].includes(data.status)) return false;
      return 2000;
    },
    staleTime: 1000,
  });

  // Load task from location state (e.g., from Search History page)
  useEffect(() => {
    const locationState = location.state as { 
      query?: string; 
      fromHistory?: boolean; 
      historyId?: number;
      parentSearchId?: number;
      deriveFrom?: number;
      depthLevel?: number;
    } | null;
    
    if (locationState?.query && !currentJobId) {
      // Set the query as task
      setTask(locationState.query);
      
      if (locationState.fromHistory) {
        toast({
          title: "검색 기록에서 연결됨",
          description: `"${locationState.query}" 작업으로 AI 에이전트를 시작할 수 있습니다.`,
        });
        // Clear the location state to prevent showing toast again
        window.history.replaceState({}, document.title);
      }
      
      if (locationState.deriveFrom) {
        toast({
          title: "파생 검색",
          description: "이전 검색에서 파생된 AI 에이전트 작업을 시작합니다.",
        });
        // Clear the location state
        window.history.replaceState({}, document.title);
      }
    }
  }, [location.state, currentJobId, toast]);

  // WebSocket connection
  useEffect(() => {
    if (!currentJobId) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
        setWsConnected(false);
      }
      return;
    }

    const wsUrl = getBrowserWSUrl(currentJobId);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setWsConnected(true);
      toast({ title: "Connected", description: "Real-time updates enabled" });
    };

    ws.onmessage = (event) => {
      try {
        const message: BrowserWSMessage = JSON.parse(event.data);

        switch (message.type) {
          case "step_update":
            if (message.screenshot) setLiveScreenshot(message.screenshot);
            if (message.current_url) {
              setLiveUrl(message.current_url);
              // Auto-save visited URL
              autoSaveVisitedUrl(message.current_url);
            }
            queryClient.invalidateQueries({ queryKey: ["browserUse", "job", currentJobId] });
            break;

          case "intervention_requested":
            toast({
              title: "Intervention Needed",
              description: message.reason || "AI agent needs your help",
              variant: "destructive",
            });
            if (message.screenshot) setLiveScreenshot(message.screenshot);
            queryClient.invalidateQueries({ queryKey: ["browserUse", "job", currentJobId] });
            break;

          case "completed":
            toast({
              title: "Task Completed",
              description: "Browser task finished successfully",
            });
            queryClient.invalidateQueries({ queryKey: ["browserUse", "job", currentJobId] });
            break;

          case "failed":
            toast({
              title: "Task Failed",
              description: message.error || "An error occurred",
              variant: "destructive",
            });
            queryClient.invalidateQueries({ queryKey: ["browserUse", "job", currentJobId] });
            break;

          case "cancelled":
            toast({
              title: "Task Cancelled",
              description: "The task was cancelled",
            });
            queryClient.invalidateQueries({ queryKey: ["browserUse", "job", currentJobId] });
            break;

          case "screenshot":
            if (message.data) setLiveScreenshot(message.data);
            if (message.current_url) {
              setLiveUrl(message.current_url);
              // Auto-save visited URL
              autoSaveVisitedUrl(message.current_url);
            }
            break;
        }
      } catch (e) {
        console.error("Failed to parse WebSocket message:", e);
      }
    };

    ws.onerror = () => {
      toast({
        title: "Connection Error",
        description: "WebSocket connection failed",
        variant: "destructive",
      });
    };

    ws.onclose = () => {
      setWsConnected(false);
    };

    wsRef.current = ws;

    return () => {
      ws.close();
    };
  }, [currentJobId, toast, queryClient]);

  // Start task mutation
  const startMutation = useMutation({
    mutationFn: startBrowserTask,
    onSuccess: (response) => {
      setCurrentJobId(response.job_id);
      setLiveScreenshot(null);
      setLiveUrl(null);
      toast({
        title: "Task Started",
        description: `Job ID: ${response.job_id}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Start",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Submit intervention mutation
  const interventionMutation = useMutation({
    mutationFn: (action: HumanAction) => submitIntervention(currentJobId!, action),
    onSuccess: () => {
      toast({
        title: "Action Submitted",
        description: "The AI agent will continue with your input",
      });
      queryClient.invalidateQueries({ queryKey: ["browserUse", "job", currentJobId] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Submit",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Manual intervention request
  const manualInterventionMutation = useMutation({
    mutationFn: () => requestManualIntervention(currentJobId!, "custom", "Manual takeover requested"),
    onSuccess: (response) => {
      if (response.screenshot) setLiveScreenshot(response.screenshot);
      if (response.current_url) setLiveUrl(response.current_url);
      toast({
        title: "Takeover Mode",
        description: "You can now control the browser",
      });
      queryClient.invalidateQueries({ queryKey: ["browserUse", "job", currentJobId] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Cancel job mutation
  const cancelMutation = useMutation({
    mutationFn: () => cancelBrowserJob(currentJobId!),
    onSuccess: () => {
      toast({ title: "Cancelled", description: "Task has been cancelled" });
      queryClient.invalidateQueries({ queryKey: ["browserUse", "job", currentJobId] });
    },
  });

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!task.trim()) return;

    // 작업 시작 시간 기록
    jobStartTimeRef.current = new Date().toISOString();

    startMutation.mutate({
      task: task.trim(),
      url: url.trim() || undefined,
      max_steps: maxSteps,
      headless: false,
      enable_human_intervention: enableIntervention,
      auto_request_intervention: autoIntervention,
    });
  }, [task, url, maxSteps, enableIntervention, autoIntervention, startMutation]);

  const handleReset = useCallback(() => {
    setCurrentJobId(null);
    setTask("");
    setUrl("");
    setLiveScreenshot(null);
    setLiveUrl(null);
    savedUrlsRef.current.clear();
    setSavedUrlCount(0);
    jobStartTimeRef.current = null;
    queryClient.removeQueries({ queryKey: ["browserUse", "job"] });
  }, [queryClient]);

  // 결과 저장 핸들러
  const handleSaveResult = useCallback(() => {
    if (!currentJob || !currentJobId) {
      toast({
        title: "저장할 결과가 없습니다",
        description: "먼저 작업을 실행해주세요.",
        variant: "destructive",
      });
      return;
    }

    const completedAt = new Date().toISOString();
    const startedAt = jobStartTimeRef.current || completedAt;
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

    const savedId = saveResult({
      task: task || currentJob.task || "Unknown task",
      startUrl: url || undefined,
      jobId: currentJobId,
      status: currentJob.status as "completed" | "failed" | "cancelled",
      result: currentJob.result || undefined,
      error: currentJob.error || undefined,
      executionStats: {
        totalSteps: currentJob.current_step,
        maxSteps: currentJob.max_steps,
        durationMs,
        startedAt,
        completedAt,
      },
      visitedUrls: currentJob.urls_visited || [],
      lastScreenshot: liveScreenshot || undefined,
    });

    toast({
      title: "결과 저장됨",
      description: `작업 결과가 저장되었습니다. (ID: ${savedId.slice(0, 8)}...)`,
    });
  }, [currentJob, currentJobId, task, url, liveScreenshot, saveResult, toast]);

  // Deep Search로 분석 연계
  const handleDeepSearchAnalysis = useCallback((resultText?: string, taskText?: string) => {
    const query = resultText || taskText || task;
    if (!query.trim()) {
      toast({
        title: "분석할 내용이 없습니다",
        description: "작업 결과 또는 주제가 필요합니다.",
        variant: "destructive",
      });
      return;
    }

    // 결과 텍스트에서 주요 내용 추출 (너무 길면 자름)
    const truncatedQuery = query.length > 500 ? query.substring(0, 500) + "..." : query;
    navigate(`/deep-search?q=${encodeURIComponent(truncatedQuery)}&fromAgent=true`);

    toast({
      title: "Deep Search로 이동",
      description: "추출된 내용에 대한 심층 분석을 시작합니다.",
    });
  }, [task, navigate, toast]);

  // FactCheck로 분석 연계
  const handleFactCheckAnalysis = useCallback((resultText?: string, taskText?: string) => {
    const content = resultText || taskText || task;
    if (!content.trim()) {
      toast({
        title: "분석할 내용이 없습니다",
        description: "작업 결과 또는 주제가 필요합니다.",
        variant: "destructive",
      });
      return;
    }

    // 세션 스토리지에 저장하여 FactCheck 페이지에서 사용
    sessionStorage.setItem("factCheck_fromAgent", JSON.stringify({
      topic: taskText || task,
      content: resultText || "",
    }));

    navigate("/fact-check");

    toast({
      title: "FactCheck로 이동",
      description: "추출된 내용에 대한 팩트체크를 시작합니다.",
    });
  }, [task, navigate, toast]);

  // 히스토리 항목에서 작업 복제
  const handleCopyTask = useCallback((savedTask: string, savedUrl?: string) => {
    setTask(savedTask);
    setUrl(savedUrl || "");
    setShowHistory(false);
    toast({
      title: "작업 복사됨",
      description: "이전 작업이 입력란에 복사되었습니다.",
    });
  }, [toast]);

  // 템플릿 선택 핸들러
  const handleSelectTemplate = useCallback((template: TaskTemplate) => {
    setTask(template.task);
    if (template.url) {
      setUrl(template.url);
    }
    if (template.maxSteps) {
      setMaxSteps(template.maxSteps);
    }
    toast({
      title: "템플릿 적용됨",
      description: `"${template.name}" 템플릿이 적용되었습니다.`,
    });
  }, [toast]);

  // 히스토리 내보내기
  const handleExport = useCallback((id: string, format: "json" | "markdown") => {
    let filename: string | null = null;
    if (format === "json") {
      filename = exportToJson(id);
    } else {
      filename = exportToMarkdown(id);
    }
    
    if (filename) {
      toast({
        title: "내보내기 완료",
        description: `${filename} 파일이 다운로드되었습니다.`,
      });
    }
  }, [exportToJson, exportToMarkdown, toast]);

  // 히스토리 삭제
  const handleDeleteHistoryItem = useCallback((id: string) => {
    deleteResult(id);
    toast({
      title: "삭제됨",
      description: "저장된 결과가 삭제되었습니다.",
    });
  }, [deleteResult, toast]);

  // 필터링된 히스토리
  const filteredHistory = savedResults.filter((r) => {
    if (historyFilter === "all") return true;
    return r.status === historyFilter;
  });

  // 통계 정보
  const stats = getStats();

  const isProcessing = currentJob && ["pending", "running"].includes(currentJob.status);
  const needsIntervention = currentJob?.status === "waiting_human";
  const isTerminal = currentJob && ["completed", "failed", "cancelled"].includes(currentJob.status);

  // Auto-save to DB when job completes (in addition to local storage)
  useEffect(() => {
    if (isTerminal && currentJob && currentJobId && task.trim()) {
      const completedAt = new Date().toISOString();
      const startedAt = jobStartTimeRef.current || completedAt;
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
      
      if (currentJob.status === "completed") {
        // Save successful browser agent results to DB
        saveBrowserAgent(
          task.trim(),
          currentJob.result ? [{ result: currentJob.result }] : [],
          currentJob.urls_visited || [],
          durationMs,
        );
      } else if (currentJob.status === "failed") {
        // Save failed search to DB
        saveFailedSearch('BROWSER_AGENT', task.trim(), currentJob.error || 'Unknown error', durationMs);
      }
    }
  }, [isTerminal, currentJob, currentJobId, task, saveBrowserAgent, saveFailedSearch]);

  return (
    <div className="min-h-screen py-8">
      <div className="container mx-auto px-4 max-w-6xl">
        {/* Header */}
        <header className="mb-8">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Main
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold mb-2 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Browser AI Agent
              </h1>
              <p className="text-muted-foreground">
                AI-powered browser automation with human-in-the-loop intervention
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* History Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowHistory(!showHistory)}
                className="gap-1"
              >
                <History className="h-4 w-4" />
                기록
                {savedResults.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1">
                    {savedResults.length}
                  </Badge>
                )}
              </Button>
              {wsConnected ? (
                <Badge variant="secondary" className="flex items-center gap-1">
                  <Wifi className="h-3 w-3 text-green-500" />
                  Live
                </Badge>
              ) : currentJobId ? (
                <Badge variant="outline" className="flex items-center gap-1">
                  <WifiOff className="h-3 w-3 text-red-500" />
                  Disconnected
                </Badge>
              ) : null}
              {health && (
                <Badge variant="outline">
                  {health.active_jobs} active / {health.waiting_intervention} waiting
                </Badge>
              )}
            </div>
          </div>
          {!isHealthy && (
            <div className="mt-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Browser agent service is currently unavailable.
            </div>
          )}
        </header>

        {/* History Panel */}
        {showHistory && storageLoaded && (
          <Card className="mb-6">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <History className="h-5 w-5" />
                    작업 기록
                  </CardTitle>
                  {/* Stats */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                      {stats.completed}
                    </span>
                    <span className="flex items-center gap-1">
                      <XCircle className="h-3 w-3 text-red-500" />
                      {stats.failed}
                    </span>
                    <span>성공률 {stats.successRate.toFixed(0)}%</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Filter */}
                  <Select value={historyFilter} onValueChange={(v) => setHistoryFilter(v as typeof historyFilter)}>
                    <SelectTrigger className="w-[100px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">전체</SelectItem>
                      <SelectItem value="completed">성공</SelectItem>
                      <SelectItem value="failed">실패</SelectItem>
                    </SelectContent>
                  </Select>
                  {/* Export All */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8">
                        <Download className="h-3 w-3 mr-1" />
                        내보내기
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => {
                        const filename = exportToJson();
                        if (filename) toast({ title: "내보내기 완료", description: `${filename}` });
                      }}>
                        <FileJson className="h-4 w-4 mr-2" />
                        전체 JSON
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => {
                        const filename = exportToCsv();
                        if (filename) toast({ title: "내보내기 완료", description: `${filename}` });
                      }}>
                        <BarChart3 className="h-4 w-4 mr-2" />
                        전체 CSV
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => {
                          if (confirm("모든 기록을 삭제하시겠습니까?")) {
                            clearAllResults();
                            toast({ title: "삭제됨", description: "모든 기록이 삭제되었습니다." });
                          }
                        }}
                        className="text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        전체 삭제
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowHistory(false)}
                    className="h-8 w-8 p-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {filteredHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {savedResults.length === 0 
                    ? "저장된 작업 기록이 없습니다. 작업 완료 후 '결과 저장' 버튼을 클릭하세요."
                    : "해당 필터에 맞는 기록이 없습니다."}
                </p>
              ) : (
                <ScrollArea className="max-h-[400px]">
                  <div className="space-y-2">
                    {filteredHistory.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-start justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex-1 min-w-0 mr-4">
                          <div className="flex items-center gap-2 mb-1">
                            {item.status === "completed" ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                            ) : item.status === "failed" ? (
                              <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                            ) : (
                              <XCircle className="h-4 w-4 text-gray-400 shrink-0" />
                            )}
                            <h4 className="font-medium text-sm truncate">{item.task}</h4>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {new Date(item.savedAt).toLocaleString("ko-KR")} · 
                            {item.executionStats.totalSteps}/{item.executionStats.maxSteps} 단계 · 
                            {item.visitedUrls.length}개 URL 방문
                          </p>
                          {item.result && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              결과: {item.result.substring(0, 100)}...
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {/* Copy Task */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopyTask(item.task, item.startUrl)}
                            title="작업 복사"
                            className="h-8 w-8 p-0"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          {/* Deep Search */}
                          {item.result && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeepSearchAnalysis(item.result, item.task)}
                              title="Deep Search 분석"
                              className="h-8 w-8 p-0 text-purple-600 hover:text-purple-700"
                            >
                              <Microscope className="h-4 w-4" />
                            </Button>
                          )}
                          {/* FactCheck */}
                          {item.result && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleFactCheckAnalysis(item.result, item.task)}
                              title="팩트체크"
                              className="h-8 w-8 p-0 text-green-600 hover:text-green-700"
                            >
                              <Shield className="h-4 w-4" />
                            </Button>
                          )}
                          {/* More Actions */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => {
                                setSelectedHistoryItem(item);
                                setHistoryDetailOpen(true);
                              }}>
                                <Eye className="h-4 w-4 mr-2" />
                                상세 보기
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleExport(item.id, "json")}>
                                <FileJson className="h-4 w-4 mr-2" />
                                JSON 내보내기
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleExport(item.id, "markdown")}>
                                <FileText className="h-4 w-4 mr-2" />
                                Markdown 내보내기
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleDeleteHistoryItem(item.id)}
                                className="text-destructive"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                삭제
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        )}

        {/* History Detail Dialog */}
        <Dialog open={historyDetailOpen} onOpenChange={setHistoryDetailOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            {selectedHistoryItem && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    {selectedHistoryItem.status === "completed" ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-500" />
                    )}
                    작업 상세
                  </DialogTitle>
                  <DialogDescription>
                    {new Date(selectedHistoryItem.savedAt).toLocaleString("ko-KR")}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  {/* Task */}
                  <div>
                    <Label className="text-sm font-medium">작업 설명</Label>
                    <p className="mt-1 text-sm bg-muted p-2 rounded">{selectedHistoryItem.task}</p>
                  </div>
                  
                  {/* Start URL */}
                  {selectedHistoryItem.startUrl && (
                    <div>
                      <Label className="text-sm font-medium">시작 URL</Label>
                      <p className="mt-1 text-sm">
                        <a 
                          href={selectedHistoryItem.startUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline flex items-center gap-1"
                        >
                          {selectedHistoryItem.startUrl}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </p>
                    </div>
                  )}
                  
                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-2 bg-muted rounded">
                      <p className="text-2xl font-bold">{selectedHistoryItem.executionStats.totalSteps}</p>
                      <p className="text-xs text-muted-foreground">실행 단계</p>
                    </div>
                    <div className="text-center p-2 bg-muted rounded">
                      <p className="text-2xl font-bold">{selectedHistoryItem.visitedUrls.length}</p>
                      <p className="text-xs text-muted-foreground">방문 URL</p>
                    </div>
                    <div className="text-center p-2 bg-muted rounded">
                      <p className="text-2xl font-bold">
                        {selectedHistoryItem.executionStats.durationMs 
                          ? `${Math.round(selectedHistoryItem.executionStats.durationMs / 1000)}s`
                          : "-"}
                      </p>
                      <p className="text-xs text-muted-foreground">소요 시간</p>
                    </div>
                  </div>
                  
                  {/* Result */}
                  {selectedHistoryItem.result && (
                    <div>
                      <Label className="text-sm font-medium">추출 결과</Label>
                      <ScrollArea className="mt-1 h-[200px] bg-muted p-2 rounded">
                        <pre className="text-xs whitespace-pre-wrap">{selectedHistoryItem.result}</pre>
                      </ScrollArea>
                    </div>
                  )}
                  
                  {/* Error */}
                  {selectedHistoryItem.error && (
                    <div>
                      <Label className="text-sm font-medium text-destructive">오류</Label>
                      <p className="mt-1 text-sm text-destructive bg-destructive/10 p-2 rounded">
                        {selectedHistoryItem.error}
                      </p>
                    </div>
                  )}
                  
                  {/* Visited URLs */}
                  {selectedHistoryItem.visitedUrls.length > 0 && (
                    <Collapsible>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="w-full justify-between">
                          방문한 URL ({selectedHistoryItem.visitedUrls.length}개)
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <ScrollArea className="h-[150px] mt-2">
                          <ul className="text-xs space-y-1">
                            {selectedHistoryItem.visitedUrls.map((visitedUrl, i) => (
                              <li key={i} className="flex items-center gap-1">
                                <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
                                <a 
                                  href={visitedUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline truncate"
                                >
                                  {visitedUrl}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </ScrollArea>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </div>
                <DialogFooter className="mt-4">
                  <div className="flex gap-2 w-full">
                    <Button
                      variant="outline"
                      onClick={() => handleCopyTask(selectedHistoryItem.task, selectedHistoryItem.startUrl)}
                      className="flex-1"
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      작업 복사
                    </Button>
                    {selectedHistoryItem.result && (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => {
                            handleDeepSearchAnalysis(selectedHistoryItem.result, selectedHistoryItem.task);
                            setHistoryDetailOpen(false);
                          }}
                          className="flex-1 text-purple-600 hover:text-purple-700"
                        >
                          <Microscope className="h-4 w-4 mr-2" />
                          Deep Search
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            handleFactCheckAnalysis(selectedHistoryItem.result, selectedHistoryItem.task);
                            setHistoryDetailOpen(false);
                          }}
                          className="flex-1 text-green-600 hover:text-green-700"
                        >
                          <Shield className="h-4 w-4 mr-2" />
                          팩트체크
                        </Button>
                      </>
                    )}
                  </div>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Task Form & Status */}
          <div className="lg:col-span-1 space-y-6">
            {/* Task Form */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5" />
                  New Task
                </CardTitle>
                <CardDescription>
                  Describe what you want the AI to do in the browser
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Task Templates */}
                <TaskTemplates
                  onSelectTemplate={handleSelectTemplate}
                  disabled={isProcessing || needsIntervention}
                  className="mb-4"
                />

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="task">Task Description *</Label>
                    <Textarea
                      id="task"
                      value={task}
                      onChange={(e) => setTask(e.target.value)}
                      placeholder="e.g., Go to news.ycombinator.com and extract the top 5 headlines"
                      disabled={isProcessing || needsIntervention}
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="url">Starting URL (optional)</Label>
                    <Input
                      id="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://example.com"
                      disabled={isProcessing || needsIntervention}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="maxSteps">Max Steps</Label>
                    <Input
                      id="maxSteps"
                      type="number"
                      value={maxSteps}
                      onChange={(e) => setMaxSteps(parseInt(e.target.value) || 25)}
                      min={1}
                      max={100}
                      disabled={isProcessing || needsIntervention}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="enableIntervention">Human Intervention</Label>
                    <Switch
                      id="enableIntervention"
                      checked={enableIntervention}
                      onCheckedChange={setEnableIntervention}
                      disabled={isProcessing || needsIntervention}
                    />
                  </div>

                  {enableIntervention && (
                    <div className="flex items-center justify-between">
                      <Label htmlFor="autoIntervention">Auto-detect Issues</Label>
                      <Switch
                        id="autoIntervention"
                        checked={autoIntervention}
                        onCheckedChange={setAutoIntervention}
                        disabled={isProcessing || needsIntervention}
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="autoSaveUrls">Auto-save URLs</Label>
                      <Badge variant="outline" className="text-xs">
                        <BookmarkPlus className="h-3 w-3 mr-1" />
                        컬렉션에 저장
                      </Badge>
                    </div>
                    <Switch
                      id="autoSaveUrls"
                      checked={autoSaveUrls}
                      onCheckedChange={setAutoSaveUrls}
                      disabled={isProcessing || needsIntervention}
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      disabled={!task.trim() || isProcessing || needsIntervention || !isHealthy}
                      className="flex-1"
                    >
                      {startMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Starting...
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4 mr-2" />
                          Start Task
                        </>
                      )}
                    </Button>
                    {(currentJob || isTerminal) && (
                      <Button type="button" variant="outline" onClick={handleReset}>
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </form>
              </CardContent>
            </Card>

            {/* Job Status */}
            {currentJob && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center justify-between">
                    <span>Job Status</span>
                    <Badge className={STATUS_CONFIG[currentJob.status].color}>
                      {STATUS_CONFIG[currentJob.status].label}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    Job ID: {currentJob.job_id}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Progress</span>
                      <span>{currentJob.current_step} / {currentJob.max_steps} steps</span>
                    </div>
                    <Progress value={currentJob.progress * 100} />
                  </div>

                  {currentJob.urls_visited.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <Label className="text-sm">Visited URLs</Label>
                        {autoSaveUrls && savedUrlCount > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            <FolderPlus className="h-3 w-3 mr-1" />
                            {savedUrlCount}개 저장됨
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 max-h-32 overflow-y-auto space-y-1">
                        {currentJob.urls_visited.map((visitedUrl, i) => (
                          <div key={i} className="text-xs text-muted-foreground flex items-center gap-1">
                            <Globe className="h-3 w-3 shrink-0" />
                            <a
                              href={visitedUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="truncate hover:underline"
                            >
                              {visitedUrl}
                            </a>
                            {savedUrlsRef.current.has(visitedUrl) && (
                              <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {currentJob.result && (
                    <div>
                      <Label className="text-sm">Result</Label>
                      <div className="mt-1 p-2 bg-muted rounded text-xs max-h-40 overflow-y-auto whitespace-pre-wrap">
                        {currentJob.result}
                      </div>
                    </div>
                  )}

                  {currentJob.error && (
                    <div className="p-2 bg-destructive/10 text-destructive rounded text-sm">
                      {currentJob.error}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    {isProcessing && enableIntervention && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => manualInterventionMutation.mutate()}
                        disabled={manualInterventionMutation.isPending}
                      >
                        <Hand className="h-4 w-4 mr-1" />
                        Take Over
                      </Button>
                    )}
                    {(isProcessing || needsIntervention) && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => cancelMutation.mutate()}
                        disabled={cancelMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Column: Browser View & Intervention */}
          <div className="lg:col-span-2 space-y-6">
            {/* Intervention Panel */}
            {needsIntervention && currentJob && (
              <InterventionPanel
                job={currentJob}
                onSubmit={(action) => interventionMutation.mutate(action)}
                isSubmitting={interventionMutation.isPending}
              />
            )}

            {/* Live Browser View */}
            {currentJobId && !needsIntervention && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <MonitorPlay className="h-5 w-5" />
                    Live Browser View
                  </CardTitle>
                  {liveUrl && (
                    <CardDescription className="flex items-center gap-2">
                      <Globe className="h-3 w-3" />
                      <a
                        href={liveUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline truncate"
                      >
                        {liveUrl}
                      </a>
                      <ExternalLink className="h-3 w-3" />
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  {liveScreenshot ? (
                    <div className="border rounded-lg overflow-hidden">
                      <img
                        src={`data:image/jpeg;base64,${liveScreenshot}`}
                        alt="Live browser view"
                        className="w-full"
                      />
                    </div>
                  ) : (
                    <div className="h-64 flex items-center justify-center bg-muted rounded-lg">
                      {isProcessing ? (
                        <div className="text-center text-muted-foreground">
                          <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin" />
                          <p>Waiting for browser updates...</p>
                        </div>
                      ) : (
                        <div className="text-center text-muted-foreground">
                          <Camera className="h-8 w-8 mx-auto mb-2" />
                          <p>No screenshot available</p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Empty State */}
            {!currentJobId && (
              <Card>
                <CardContent className="py-16">
                  <div className="text-center">
                    <div className="inline-block p-4 rounded-full bg-accent/10 mb-4">
                      <Bot className="h-12 w-12 text-accent" />
                    </div>
                    <h2 className="text-xl font-semibold mb-2">Ready to Browse</h2>
                    <p className="text-muted-foreground max-w-md mx-auto">
                      Describe a task and the AI agent will automate browser actions.
                      You can take control at any time if the agent needs help.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Completed State */}
            {isTerminal && currentJob && (
              <Card>
                <CardContent className="py-8">
                  <div className="text-center">
                    {currentJob.status === "completed" ? (
                      <>
                        <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 mb-4" />
                        <h2 className="text-xl font-semibold mb-2">Task Completed</h2>
                        <p className="text-muted-foreground">
                          Visited {currentJob.urls_visited.length} pages in {currentJob.current_step} steps
                        </p>
                      </>
                    ) : currentJob.status === "failed" ? (
                      <>
                        <XCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
                        <h2 className="text-xl font-semibold mb-2">Task Failed</h2>
                        <p className="text-muted-foreground">{currentJob.error}</p>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                        <h2 className="text-xl font-semibold mb-2">Task Cancelled</h2>
                      </>
                    )}
                    
                    {/* Action Buttons */}
                    <div className="flex flex-wrap justify-center gap-2 mt-6">
                      {/* Save Result */}
                      <Button 
                        onClick={handleSaveResult}
                        variant="default"
                      >
                        <Save className="h-4 w-4 mr-2" />
                        결과 저장
                      </Button>
                      
                      {/* Deep Search (only if has result) */}
                      {currentJob.result && (
                        <Button
                          variant="outline"
                          onClick={() => handleDeepSearchAnalysis(currentJob.result, task)}
                          className="text-purple-600 hover:text-purple-700 border-purple-300"
                        >
                          <Microscope className="h-4 w-4 mr-2" />
                          Deep Search 분석
                        </Button>
                      )}
                      
                      {/* FactCheck (only if has result) */}
                      {currentJob.result && (
                        <Button
                          variant="outline"
                          onClick={() => handleFactCheckAnalysis(currentJob.result, task)}
                          className="text-green-600 hover:text-green-700 border-green-300"
                        >
                          <Shield className="h-4 w-4 mr-2" />
                          팩트체크
                        </Button>
                      )}
                      
                      {/* New Task */}
                      <Button onClick={handleReset} variant="outline">
                        <RefreshCw className="h-4 w-4 mr-2" />
                        새 작업 시작
                      </Button>
                    </div>
                    
                    {/* Result Preview (if exists) */}
                    {currentJob.result && (
                      <div className="mt-6 text-left">
                        <Collapsible>
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="sm" className="w-full justify-between mb-2">
                              <span className="flex items-center gap-2">
                                <FileText className="h-4 w-4" />
                                추출된 결과 미리보기
                              </span>
                              <ChevronDown className="h-4 w-4" />
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <ScrollArea className="h-[200px] bg-muted p-3 rounded-lg">
                              <pre className="text-xs whitespace-pre-wrap text-left">
                                {currentJob.result}
                              </pre>
                            </ScrollArea>
                          </CollapsibleContent>
                        </Collapsible>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BrowserAgent;
