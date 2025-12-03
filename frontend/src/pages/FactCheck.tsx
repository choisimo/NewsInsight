import { useState, useCallback, useRef, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  AlertTriangle,
  Scale,
  Shield,
  BookOpen,
  Brain,
  ExternalLink,
  ArrowLeft,
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  Info,
  FolderOpen,
  Link as LinkIcon,
  Save,
  Download,
  FileJson,
  FileText,
  History,
  Trash2,
  Microscope,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useFactCheckStorage, SavedFactCheckResult } from "@/hooks/useFactCheckStorage";
import { useAutoSaveSearch } from "@/hooks/useSearchHistory";
import {
  openDeepAnalysisStream,
  checkUnifiedSearchHealth,
} from "@/lib/api";

// Verification status configuration
const STATUS_CONFIG = {
  VERIFIED: {
    label: "검증됨",
    icon: CheckCircle2,
    color: "text-green-600",
    bgColor: "bg-green-100 dark:bg-green-900/30",
    borderColor: "border-green-500",
  },
  PARTIALLY_VERIFIED: {
    label: "부분 검증",
    icon: AlertTriangle,
    color: "text-yellow-600",
    bgColor: "bg-yellow-100 dark:bg-yellow-900/30",
    borderColor: "border-yellow-500",
  },
  UNVERIFIED: {
    label: "검증 불가",
    icon: HelpCircle,
    color: "text-gray-600",
    bgColor: "bg-gray-100 dark:bg-gray-800",
    borderColor: "border-gray-400",
  },
  DISPUTED: {
    label: "논쟁 중",
    icon: Scale,
    color: "text-orange-600",
    bgColor: "bg-orange-100 dark:bg-orange-900/30",
    borderColor: "border-orange-500",
  },
  FALSE: {
    label: "거짓",
    icon: XCircle,
    color: "text-red-600",
    bgColor: "bg-red-100 dark:bg-red-900/30",
    borderColor: "border-red-500",
  },
} as const;

type VerificationStatus = keyof typeof STATUS_CONFIG;

// Risk level configuration
const RISK_CONFIG = {
  low: { label: "낮음", color: "text-green-600", bgColor: "bg-green-500" },
  medium: { label: "주의", color: "text-yellow-600", bgColor: "bg-yellow-500" },
  high: { label: "높음", color: "text-red-600", bgColor: "bg-red-500" },
} as const;

// Types
interface SourceEvidence {
  sourceType: string;
  sourceName: string;
  url: string;
  excerpt: string;
  relevanceScore?: number;
  stance?: string;
}

interface VerificationResult {
  claimId: string;
  originalClaim: string;
  status: VerificationStatus;
  confidenceScore: number;
  supportingEvidence: SourceEvidence[];
  contradictingEvidence: SourceEvidence[];
  verificationSummary: string;
  relatedConcepts: string[];
}

interface CredibilityAssessment {
  overallScore: number;
  verifiedCount: number;
  totalClaims: number;
  riskLevel: "low" | "medium" | "high";
  warnings: string[];
}

interface DeepAnalysisEvent {
  eventType: "status" | "evidence" | "verification" | "assessment" | "ai_synthesis" | "complete" | "error";
  phase: string;
  message?: string;
  evidence?: SourceEvidence[];
  verificationResult?: VerificationResult;
  credibility?: CredibilityAssessment;
  finalConclusion?: string;
}

// Components
interface EvidenceCardProps {
  evidence: SourceEvidence;
  stance: "support" | "contradict" | "neutral";
}

const EvidenceCard = ({ evidence, stance }: EvidenceCardProps) => {
  const stanceStyles = {
    support: "border-l-green-500 bg-green-50 dark:bg-green-900/20",
    contradict: "border-l-red-500 bg-red-50 dark:bg-red-900/20",
    neutral: "border-l-gray-400 bg-gray-50 dark:bg-gray-800/50",
  };

  return (
    <div className={`border-l-4 p-3 rounded-r-lg ${stanceStyles[stance]}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">{evidence.sourceName}</span>
            {evidence.relevanceScore && (
              <Badge variant="secondary" className="text-xs">
                {Math.round(evidence.relevanceScore * 100)}% 관련
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground line-clamp-3">{evidence.excerpt}</p>
        </div>
        {evidence.url && (
          <a
            href={evidence.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 p-1 rounded hover:bg-muted transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>
    </div>
  );
};

interface ClaimVerificationCardProps {
  result: VerificationResult;
  onDeepSearch?: (claim: string) => void;
}

const ClaimVerificationCard = ({ result, onDeepSearch }: ClaimVerificationCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const config = STATUS_CONFIG[result.status];
  const StatusIcon = config.icon;

  const hasEvidence = result.supportingEvidence.length > 0 || result.contradictingEvidence.length > 0;

  return (
    <Card className={`${config.bgColor} border-l-4 ${config.borderColor}`}>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Badge className={`${config.bgColor} ${config.color} border-none`}>
                  <StatusIcon className="h-3 w-3 mr-1" />
                  {config.label}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  신뢰도: {Math.round(result.confidenceScore * 100)}%
                </span>
              </div>
              <p className="font-medium text-sm">{result.originalClaim}</p>
              <p className="text-sm text-muted-foreground mt-1">{result.verificationSummary}</p>
            </div>
            <div className="flex items-center gap-1">
              {onDeepSearch && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDeepSearch(result.originalClaim)}
                  title="Deep Search로 심층 분석"
                  className="text-purple-600 hover:text-purple-700 hover:bg-purple-100 dark:hover:bg-purple-900/30"
                >
                  <Microscope className="h-4 w-4" />
                </Button>
              )}
              {hasEvidence && (
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm">
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </CollapsibleTrigger>
              )}
            </div>
          </div>
        </CardHeader>

        {hasEvidence && (
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-4">
              {result.supportingEvidence.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2 text-green-600 flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" />
                    지지 근거 ({result.supportingEvidence.length})
                  </h4>
                  <div className="space-y-2">
                    {result.supportingEvidence.map((e, i) => (
                      <EvidenceCard key={i} evidence={e} stance="support" />
                    ))}
                  </div>
                </div>
              )}

              {result.contradictingEvidence.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2 text-red-600 flex items-center gap-1">
                    <XCircle className="h-4 w-4" />
                    반박 근거 ({result.contradictingEvidence.length})
                  </h4>
                  <div className="space-y-2">
                    {result.contradictingEvidence.map((e, i) => (
                      <EvidenceCard key={i} evidence={e} stance="contradict" />
                    ))}
                  </div>
                </div>
              )}

              {result.relatedConcepts.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">관련 개념:</span>
                  {result.relatedConcepts.map((concept, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {concept}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        )}
      </Collapsible>
    </Card>
  );
};

interface CredibilityMeterProps {
  assessment: CredibilityAssessment;
}

const CredibilityMeter = ({ assessment }: CredibilityMeterProps) => {
  const riskConfig = RISK_CONFIG[assessment.riskLevel];
  const percentage = Math.round(assessment.overallScore * 100);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          신뢰도 평가
        </CardTitle>
        <CardDescription>
          전체 {assessment.totalClaims}개 주장 중 {assessment.verifiedCount}개 검증됨
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-center">
          <div className="relative inline-flex items-center justify-center">
            <svg className="w-32 h-32 transform -rotate-90">
              <circle
                cx="64"
                cy="64"
                r="56"
                stroke="currentColor"
                strokeWidth="12"
                fill="transparent"
                className="text-muted"
              />
              <circle
                cx="64"
                cy="64"
                r="56"
                stroke="currentColor"
                strokeWidth="12"
                fill="transparent"
                strokeDasharray={`${percentage * 3.52} 352`}
                className={percentage >= 70 ? "text-green-500" : percentage >= 40 ? "text-yellow-500" : "text-red-500"}
              />
            </svg>
            <span className="absolute text-3xl font-bold">{percentage}%</span>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2">
          <span className="text-sm text-muted-foreground">위험 수준:</span>
          <Badge className={`${riskConfig.bgColor} text-white`}>
            {riskConfig.label}
          </Badge>
        </div>

        {assessment.warnings.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>주의사항</AlertTitle>
            <AlertDescription>
              <ul className="list-disc list-inside text-sm mt-1">
                {assessment.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};

// Interface for priority URLs passed from UrlCollections page
interface PriorityUrl {
  id: string;
  url: string;
  name: string;
}

// Main Component
const FactCheck = () => {
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const { saveFactCheck, saveFailedSearch } = useAutoSaveSearch();

  const [topic, setTopic] = useState("");
  const [claims, setClaims] = useState<string[]>([""]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentPhase, setCurrentPhase] = useState("");
  const [phaseMessage, setPhaseMessage] = useState("");
  
  // Track search start time for duration calculation
  const [searchStartTime, setSearchStartTime] = useState<number | null>(null);
  
  // Priority URLs from URL Collections page
  const [priorityUrls, setPriorityUrls] = useState<PriorityUrl[]>([]);
  
  // History panel toggle
  const [showHistory, setShowHistory] = useState(false);

  // Results
  const [collectedEvidence, setCollectedEvidence] = useState<SourceEvidence[]>([]);
  const [verificationResults, setVerificationResults] = useState<VerificationResult[]>([]);
  const [credibility, setCredibility] = useState<CredibilityAssessment | null>(null);
  const [aiConclusion, setAiConclusion] = useState("");
  const [aiComplete, setAiComplete] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  
  // Fact check storage hook
  const {
    savedResults,
    isLoaded: storageLoaded,
    saveResult,
    deleteResult,
    exportToJson,
    exportToMarkdown,
  } = useFactCheckStorage();

  // Health check
  const { data: healthData } = useQuery({
    queryKey: ["unifiedSearch", "health"],
    queryFn: checkUnifiedSearchHealth,
    staleTime: 60_000,
    retry: 1,
  });

  const isHealthy = healthData?.features?.factVerification ?? false;
  
  // Load priority URLs from location state or sessionStorage
  useEffect(() => {
    const locationState = location.state as { priorityUrls?: PriorityUrl[] } | null;
    if (locationState?.priorityUrls && locationState.priorityUrls.length > 0) {
      setPriorityUrls(locationState.priorityUrls);
      // Save to sessionStorage for persistence across page refreshes
      sessionStorage.setItem("factCheck_priorityUrls", JSON.stringify(locationState.priorityUrls));
      // Clear the location state to prevent re-adding on refresh
      window.history.replaceState({}, document.title);
    } else {
      // Try to load from sessionStorage
      const stored = sessionStorage.getItem("factCheck_priorityUrls");
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
        sessionStorage.setItem("factCheck_priorityUrls", JSON.stringify(updated));
      } else {
        sessionStorage.removeItem("factCheck_priorityUrls");
      }
      return updated;
    });
  }, []);
  
  // Clear all priority URLs
  const clearPriorityUrls = useCallback(() => {
    setPriorityUrls([]);
    sessionStorage.removeItem("factCheck_priorityUrls");
    toast({
      title: "초기화됨",
      description: "참고 URL이 모두 제거되었습니다.",
    });
  }, [toast]);

  // Save current result
  const handleSaveResult = useCallback(() => {
    if (!topic.trim() || verificationResults.length === 0) {
      toast({
        title: "저장할 결과가 없습니다",
        description: "먼저 팩트체크를 실행해주세요.",
        variant: "destructive",
      });
      return;
    }

    // Build evidence summary by source type
    const bySource: Record<string, number> = {};
    collectedEvidence.forEach((e) => {
      const key = e.sourceType || "unknown";
      bySource[key] = (bySource[key] || 0) + 1;
    });

    const resultToSave = {
      topic: topic.trim(),
      claims: claims.filter((c) => c.trim()),
      priorityUrls: priorityUrls.map((p) => p.url),
      verificationResults: verificationResults.map((v) => ({
        claimId: v.claimId,
        originalClaim: v.originalClaim,
        status: v.status,
        confidenceScore: v.confidenceScore,
        verificationSummary: v.verificationSummary,
        supportingCount: v.supportingEvidence.length,
        contradictingCount: v.contradictingEvidence.length,
      })),
      evidenceSummary: {
        total: collectedEvidence.length,
        bySource,
      },
      credibility: credibility
        ? {
            overallScore: credibility.overallScore,
            verifiedCount: credibility.verifiedCount,
            totalClaims: credibility.totalClaims,
            riskLevel: credibility.riskLevel,
            warnings: credibility.warnings,
          }
        : undefined,
      aiConclusion: aiComplete ? aiConclusion : undefined,
    };

    const savedId = saveResult(resultToSave);
    toast({
      title: "저장됨",
      description: `팩트체크 결과가 저장되었습니다. (ID: ${savedId.slice(0, 8)}...)`,
    });
  }, [
    topic,
    claims,
    priorityUrls,
    verificationResults,
    collectedEvidence,
    credibility,
    aiConclusion,
    aiComplete,
    saveResult,
    toast,
  ]);

  // Load a saved result
  const loadSavedResult = useCallback((saved: SavedFactCheckResult) => {
    setTopic(saved.topic);
    setClaims(saved.claims.length > 0 ? saved.claims : [""]);
    
    // Reconstruct verification results (simplified)
    const reconstructed: VerificationResult[] = saved.verificationResults.map((v) => ({
      claimId: v.claimId,
      originalClaim: v.originalClaim,
      status: v.status as VerificationStatus,
      confidenceScore: v.confidenceScore,
      verificationSummary: v.verificationSummary,
      supportingEvidence: [], // Cannot reconstruct full evidence
      contradictingEvidence: [],
      relatedConcepts: [],
    }));
    setVerificationResults(reconstructed);
    
    if (saved.credibility) {
      setCredibility(saved.credibility);
    }
    
    if (saved.aiConclusion) {
      setAiConclusion(saved.aiConclusion);
      setAiComplete(true);
    }
    
    setShowHistory(false);
    toast({
      title: "불러오기 완료",
      description: `"${saved.topic}" 결과를 불러왔습니다.`,
    });
  }, [toast]);

  // Handle export
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

  // Handle delete
  const handleDeleteResult = useCallback((id: string) => {
    deleteResult(id);
    toast({
      title: "삭제됨",
      description: "저장된 결과가 삭제되었습니다.",
    });
  }, [deleteResult, toast]);

  // Navigate to Deep Search with topic and claims
  const handleDeepSearchAnalysis = useCallback((searchTopic?: string, searchClaims?: string[]) => {
    const topicToUse = searchTopic || topic;
    const claimsToUse = searchClaims || claims.filter((c) => c.trim());
    
    if (!topicToUse.trim()) {
      toast({
        title: "주제가 필요합니다",
        description: "Deep Search로 분석하려면 주제를 입력해주세요.",
        variant: "destructive",
      });
      return;
    }
    
    // Build the query for Deep Search
    // Combine topic and claims for comprehensive analysis
    let query = topicToUse.trim();
    if (claimsToUse.length > 0) {
      query += `: ${claimsToUse.join("; ")}`;
    }
    
    // Navigate to Deep Search with the query
    navigate(`/deep-search?q=${encodeURIComponent(query)}&fromFactCheck=true`);
    
    toast({
      title: "Deep Search로 이동",
      description: "해당 주제에 대한 심층 분석을 시작합니다.",
    });
  }, [topic, claims, navigate, toast]);

  // Navigate to Deep Search with a specific claim
  const handleDeepSearchForClaim = useCallback((claim: string) => {
    if (!claim.trim()) return;
    
    // Navigate to Deep Search with the specific claim
    navigate(`/deep-search?q=${encodeURIComponent(claim.trim())}&fromFactCheck=true`);
    
    toast({
      title: "Deep Search로 이동",
      description: "해당 주장에 대한 심층 분석을 시작합니다.",
    });
  }, [navigate, toast]);

  // Auto-save fact check results when analysis completes
  useEffect(() => {
    if (aiComplete && verificationResults.length > 0 && topic.trim()) {
      const durationMs = searchStartTime ? Date.now() - searchStartTime : undefined;
      saveFactCheck(
        topic.trim(),
        verificationResults.map((v) => ({
          claimId: v.claimId,
          originalClaim: v.originalClaim,
          status: v.status,
          confidenceScore: v.confidenceScore,
          verificationSummary: v.verificationSummary,
          supportingCount: v.supportingEvidence.length,
          contradictingCount: v.contradictingEvidence.length,
        })),
        credibility?.overallScore,
        durationMs,
      );
    }
  }, [aiComplete, verificationResults, topic, credibility, searchStartTime, saveFactCheck]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const resetResults = useCallback(() => {
    setCollectedEvidence([]);
    setVerificationResults([]);
    setCredibility(null);
    setAiConclusion("");
    setAiComplete(false);
    setCurrentPhase("");
    setPhaseMessage("");
  }, []);

  const addClaim = useCallback(() => {
    setClaims((prev) => [...prev, ""]);
  }, []);

  const removeClaim = useCallback((index: number) => {
    setClaims((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateClaim = useCallback((index: number, value: string) => {
    setClaims((prev) => prev.map((c, i) => (i === index ? value : c)));
  }, []);

  const handleAnalyze = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || isAnalyzing) return;

    const validClaims = claims.filter((c) => c.trim());
    if (validClaims.length === 0) {
      toast({
        title: "주장을 입력하세요",
        description: "검증할 주장을 최소 1개 이상 입력해주세요.",
        variant: "destructive",
      });
      return;
    }

    resetResults();
    setIsAnalyzing(true);
    setSearchStartTime(Date.now()); // Track start time for duration

    try {
      abortControllerRef.current = new AbortController();
      // Extract URLs from priority list for reference sources
      const referenceUrlList = priorityUrls.map((p) => p.url);
      const response = await openDeepAnalysisStream(
        topic.trim(), 
        validClaims,
        referenceUrlList.length > 0 ? referenceUrlList : undefined
      );

      if (!response.body) {
        throw new Error("Response body is null");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data:")) {
            try {
              const jsonStr = line.slice(5).trim();
              if (jsonStr) {
                const event: DeepAnalysisEvent = JSON.parse(jsonStr);
                handleEvent(event);
              }
            } catch (parseErr) {
              console.error("Failed to parse SSE event:", parseErr);
            }
          }
        }
      }

      setIsAnalyzing(false);
      toast({
        title: "분석 완료",
        description: "팩트체크 및 심층 분석이 완료되었습니다.",
      });

    } catch (error) {
      console.error("Analysis failed:", error);
      setIsAnalyzing(false);
      
      // Auto-save failed search
      const durationMs = searchStartTime ? Date.now() - searchStartTime : undefined;
      saveFailedSearch('FACT_CHECK', topic, error instanceof Error ? error.message : 'Unknown error', durationMs);
      
      toast({
        title: "분석 오류",
        description: "분석 중 오류가 발생했습니다. 다시 시도해주세요.",
        variant: "destructive",
      });
    }
  }, [topic, claims, priorityUrls, isAnalyzing, resetResults, toast, searchStartTime, saveFailedSearch]);

  const handleEvent = useCallback((event: DeepAnalysisEvent) => {
    setCurrentPhase(event.phase);

    switch (event.eventType) {
      case "status":
        setPhaseMessage(event.message || "");
        break;

      case "evidence":
        if (event.evidence) {
          setCollectedEvidence((prev) => [...prev, ...event.evidence!]);
        }
        setPhaseMessage(event.message || "");
        break;

      case "verification":
        if (event.verificationResult) {
          setVerificationResults((prev) => [...prev, event.verificationResult!]);
        }
        setPhaseMessage(event.message || "");
        break;

      case "assessment":
        if (event.credibility) {
          setCredibility(event.credibility);
        }
        break;

      case "ai_synthesis":
        if (event.message) {
          setAiConclusion((prev) => prev + event.message);
        }
        break;

      case "complete":
        if (event.finalConclusion) {
          setAiConclusion(event.finalConclusion);
        }
        setAiComplete(true);
        break;

      case "error":
        toast({
          title: "오류",
          description: event.message || "알 수 없는 오류가 발생했습니다.",
          variant: "destructive",
        });
        break;
    }
  }, [toast]);

  const handleCancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsAnalyzing(false);
    toast({
      title: "취소됨",
      description: "분석이 취소되었습니다.",
    });
  }, [toast]);

  const getPhaseProgress = () => {
    const phases = ["init", "concepts", "verification", "assessment", "synthesis", "complete"];
    const index = phases.indexOf(currentPhase);
    return index >= 0 ? ((index + 1) / phases.length) * 100 : 0;
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
              <h1 className="text-3xl md:text-4xl font-bold mb-2 bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent">
                팩트체크 & 심층분석
              </h1>
              <p className="text-muted-foreground flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Wikipedia, 학술DB, Google Fact Check 등 신뢰할 수 있는 출처와 대조하여 주장의 타당성을 검증합니다.
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
              
              {/* Save/Export Button */}
              {verificationResults.length > 0 && aiComplete && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="default" size="sm" className="gap-1">
                      <Save className="h-4 w-4" />
                      저장
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleSaveResult}>
                      <Save className="h-4 w-4 mr-2" />
                      결과 저장
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => {
                      // Save first, then export
                      handleSaveResult();
                      const latest = savedResults[0];
                      if (latest) {
                        setTimeout(() => handleExport(latest.id, "json"), 100);
                      }
                    }}>
                      <FileJson className="h-4 w-4 mr-2" />
                      JSON으로 내보내기
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => {
                      handleSaveResult();
                      const latest = savedResults[0];
                      if (latest) {
                        setTimeout(() => handleExport(latest.id, "markdown"), 100);
                      }
                    }}>
                      <FileText className="h-4 w-4 mr-2" />
                      Markdown으로 내보내기
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              
              {isHealthy && (
                <Badge variant="outline" className="text-green-600 border-green-600">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  서비스 정상
                </Badge>
              )}
            </div>
          </div>
        </header>

        {/* History Panel */}
        {showHistory && storageLoaded && (
          <Card className="mb-8">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <History className="h-5 w-5" />
                  저장된 팩트체크 기록
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowHistory(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {savedResults.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  저장된 팩트체크 결과가 없습니다.
                </p>
              ) : (
                <ScrollArea className="max-h-[300px]">
                  <div className="space-y-2">
                    {savedResults.map((result) => (
                      <div
                        key={result.id}
                        className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex-1 min-w-0 mr-4">
                          <h4 className="font-medium text-sm truncate">{result.topic}</h4>
                          <p className="text-xs text-muted-foreground">
                            {new Date(result.savedAt).toLocaleString("ko-KR")} · 
                            {result.verificationResults.length}개 주장 검증
                            {result.credibility && (
                              <span className={
                                result.credibility.riskLevel === "low" ? " text-green-600" :
                                result.credibility.riskLevel === "medium" ? " text-yellow-600" :
                                " text-red-600"
                              }>
                                {" · "}신뢰도 {Math.round(result.credibility.overallScore * 100)}%
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => loadSavedResult(result)}
                            title="불러오기"
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" title="내보내기">
                                <FileText className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleExport(result.id, "json")}>
                                <FileJson className="h-4 w-4 mr-2" />
                                JSON
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleExport(result.id, "markdown")}>
                                <FileText className="h-4 w-4 mr-2" />
                                Markdown
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteResult(result.id)}
                            className="text-destructive hover:text-destructive"
                            title="삭제"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        )}

        {/* Priority URLs from URL Collections */}
        {priorityUrls.length > 0 && (
          <Card className="mb-8 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-5 w-5 text-blue-600" />
                  <CardTitle className="text-lg">참고 URL</CardTitle>
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
                URL 컬렉션에서 선택한 URL입니다. 팩트체크 시 추가 참고 자료로 활용됩니다.
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
                      <LinkIcon className="h-3 w-3 text-blue-500" />
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
              <p className="text-xs text-muted-foreground mt-3">
                <Link to="/url-collections" className="text-blue-600 hover:underline">
                  URL 컬렉션
                </Link>
                에서 더 많은 URL을 추가할 수 있습니다.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Input Form */}
        <Card className="mb-8">
          <CardContent className="pt-6">
            <form onSubmit={handleAnalyze} className="space-y-6">
              {/* Topic */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  주제 *
                </label>
                <Input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="예: 기후변화, 백신 효과, 경제 정책 등"
                  disabled={isAnalyzing}
                  className="text-lg"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  검증하고자 하는 전체 주제를 입력하세요.
                </p>
              </div>

              {/* Claims */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  검증할 주장 *
                </label>
                <div className="space-y-3">
                  {claims.map((claim, index) => (
                    <div key={index} className="flex gap-2">
                      <Textarea
                        value={claim}
                        onChange={(e) => updateClaim(index, e.target.value)}
                        placeholder={`주장 ${index + 1}: 예) "탄소 배출량이 지난 10년간 20% 증가했다"`}
                        disabled={isAnalyzing}
                        className="min-h-[60px]"
                      />
                      {claims.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeClaim(index)}
                          disabled={isAnalyzing}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addClaim}
                  disabled={isAnalyzing || claims.length >= 5}
                  className="mt-2"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  주장 추가
                </Button>
                <p className="text-xs text-muted-foreground mt-1">
                  사실 여부를 확인하고 싶은 구체적인 주장들을 입력하세요. (최대 5개)
                </p>
              </div>

              {/* Submit */}
              <div className="flex gap-3">
                {isAnalyzing ? (
                  <Button type="button" variant="outline" onClick={handleCancel} className="flex-1">
                    분석 취소
                  </Button>
                ) : (
                  <Button type="submit" disabled={!topic.trim() || !isHealthy} className="flex-1">
                    <Search className="h-4 w-4 mr-2" />
                    팩트체크 시작
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Progress */}
        {isAnalyzing && (
          <Card className="mb-8">
            <CardContent className="py-6 space-y-4">
              <div className="flex items-center gap-4">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <div className="flex-1">
                  <h3 className="font-medium">심층 분석 진행 중...</h3>
                  <p className="text-sm text-muted-foreground">{phaseMessage}</p>
                </div>
              </div>
              <Progress value={getPhaseProgress()} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>초기화</span>
                <span>개념 수집</span>
                <span>주장 검증</span>
                <span>신뢰도 평가</span>
                <span>AI 종합</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {(verificationResults.length > 0 || credibility || aiConclusion) && (
          <div className="space-y-6">
            {/* Credibility Assessment */}
            {credibility && (
              <CredibilityMeter assessment={credibility} />
            )}

            {/* Collected Evidence */}
            {collectedEvidence.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BookOpen className="h-5 w-5" />
                    수집된 참고 자료
                  </CardTitle>
                  <CardDescription>
                    신뢰할 수 있는 출처에서 {collectedEvidence.length}개의 정보를 수집했습니다.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="max-h-[300px]">
                    <div className="space-y-3">
                      {collectedEvidence.map((e, i) => (
                        <EvidenceCard key={i} evidence={e} stance="neutral" />
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {/* Verification Results */}
            {verificationResults.length > 0 && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Shield className="h-5 w-5" />
                        주장별 검증 결과
                      </CardTitle>
                      <CardDescription>
                        각 주장에 대한 팩트체크 결과입니다. 개별 주장을 Deep Search로 심층 분석할 수 있습니다.
                      </CardDescription>
                    </div>
                    {aiComplete && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeepSearchAnalysis()}
                        className="gap-1 text-purple-600 hover:text-purple-700 border-purple-300 hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                      >
                        <Microscope className="h-4 w-4" />
                        전체 Deep Search 분석
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {verificationResults.map((result) => (
                      <ClaimVerificationCard 
                        key={result.claimId} 
                        result={result} 
                        onDeepSearch={handleDeepSearchForClaim}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* AI Conclusion */}
            {aiConclusion && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Brain className="h-5 w-5 text-purple-600" />
                      <CardTitle>AI 종합 분석</CardTitle>
                      {!aiComplete && <Loader2 className="h-4 w-4 animate-spin" />}
                      {aiComplete && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <MarkdownRenderer 
                    content={aiConclusion} 
                    isStreaming={!aiComplete}
                    className="bg-muted/30 p-4 rounded-lg"
                  />
                  
                  {/* Deep Search CTA */}
                  {aiComplete && (
                    <div className="mt-4 p-4 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-900/10">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-medium text-purple-700 dark:text-purple-300">
                            더 깊은 분석이 필요하신가요?
                          </h4>
                          <p className="text-xs text-muted-foreground mt-1">
                            Deep Search를 통해 다양한 관점의 증거를 수집하고 더 심층적인 분석을 받아보세요.
                          </p>
                        </div>
                        <Button
                          onClick={() => handleDeepSearchAnalysis()}
                          className="gap-2 bg-purple-600 hover:bg-purple-700"
                        >
                          <Microscope className="h-4 w-4" />
                          Deep Search 분석
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Empty State */}
        {!isAnalyzing && verificationResults.length === 0 && !aiConclusion && (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center gap-4 mb-6">
              <div className="p-4 rounded-full bg-green-100 dark:bg-green-900/30">
                <Shield className="h-10 w-10 text-green-600" />
              </div>
            </div>
            <h2 className="text-xl font-semibold mb-2">팩트체크 & 심층분석</h2>
            <p className="text-muted-foreground max-w-md mx-auto mb-6">
              주제와 검증하고 싶은 주장을 입력하면 Wikipedia 등 신뢰할 수 있는 출처와 대조하여 
              타당성을 분석하고 종합적인 결론을 제공합니다.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl mx-auto text-sm">
              <div className="p-4 rounded-lg bg-muted/50">
                <BookOpen className="h-6 w-6 mx-auto mb-2 text-blue-600" />
                <p className="font-medium">신뢰할 수 있는 출처</p>
                <p className="text-muted-foreground text-xs mt-1">Wikipedia, 학술DB 등</p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50">
                <Scale className="h-6 w-6 mx-auto mb-2 text-orange-600" />
                <p className="font-medium">객관적 검증</p>
                <p className="text-muted-foreground text-xs mt-1">지지/반박 근거 제시</p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50">
                <Brain className="h-6 w-6 mx-auto mb-2 text-purple-600" />
                <p className="font-medium">AI 종합 분석</p>
                <p className="text-muted-foreground text-xs mt-1">맥락을 고려한 결론</p>
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="mt-8 flex justify-center gap-4">
          <Link to="/search">
            <Button variant="outline" className="gap-2">
              <Search className="h-4 w-4" />
              통합 검색으로 이동
            </Button>
          </Link>
          <Link to="/deep-search">
            <Button variant="outline" className="gap-2">
              <Brain className="h-4 w-4" />
              Deep Search로 이동
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default FactCheck;
