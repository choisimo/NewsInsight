/**
 * SmartSearch - 통합 검색 페이지
 * 
 * 4가지 검색 모드를 탭으로 통합:
 * 1. 통합 검색 (Parallel Search) - 빠른 뉴스 검색
 * 2. Deep Search - AI 심층 분석
 * 3. 팩트체크 - 주장 검증
 * 4. URL 분석 - URL에서 주장 추출 및 검증
 * 
 * 각 탭에서 결과를 카드로 표시하고, 선택한 결과들을 "검색 템플릿"으로 저장 가능
 */

import { useState, useCallback, useRef, useEffect, useMemo, createElement } from "react";
import { useLocation, useSearchParams, useNavigate } from "react-router-dom";
import {
  Search,
  Brain,
  Shield,
  Loader2,
  Pin,
  Bookmark,
  ChevronRight,
  ChevronDown,
  Sparkles,
  ExternalLink,
  CheckCircle2,
  Clock,
  X,
  FolderOpen,
  FolderPlus,
  Zap,
  Database,
  Globe,
  ThumbsUp,
  ThumbsDown,
  Minus,
  AlertCircle,
  HelpCircle,
  AlertTriangle,
  Scale,
  XCircle,
  Plus,
  Play,
  Trash2,
  Star,
  Link as LinkIcon,
  FileText,
  Eye,
  ChevronsUpDown,
  Check,
  Newspaper,
  Users,
  GraduationCap,
  History,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { FactCheckChatbot, type FactCheckChatbotRef } from "@/components/FactCheckChatbot";
import { UnifiedExportMenu } from "@/components/UnifiedExportMenu";
import { useProjects, type Project, type ProjectItemType, ITEM_TYPE_LABELS } from "@/hooks/useProjects";
import { useToast } from "@/hooks/use-toast";
import { AdvancedFilters, defaultFilters, type SearchFilters } from "@/components/AdvancedFilters";
import {
  startUnifiedSearchJob,
  openUnifiedSearchJobStream,
  startDeepSearch,
  getDeepSearchStatus,
  getDeepSearchResult,
  listDeepSearchJobs,
  createSearchTemplate,
  getAllTemplatesByUser,
  deleteSearchTemplate,
  recordTemplateUsage,
  toggleTemplateFavorite,
  getFavoriteTemplates,
  getMostUsedTemplates,
  getRecentlyUsedTemplates,
  searchTemplatesByName,
  extractClaimsFromUrl,
  getSearchHistoryByExternalId,
  type UnifiedSearchResult,
  type Evidence,
  type DeepSearchResult,
  type DeepSearchJob,
  type SearchTemplate as ApiSearchTemplate,
} from "@/lib/api";
import { useDeepSearchSSE } from "@/hooks/useDeepSearchSSE";
import { useBackgroundTasks } from "@/contexts/BackgroundTaskContext";
import { PriorityUrlEditor, type PriorityUrl } from "@/components/PriorityUrlEditor";

// ============================================
// Types
// ============================================

type SearchMode = "unified" | "deep" | "factcheck" | "urlanalysis";

type TemplateMode = "unified" | "deep" | "factcheck";
type TemplateItemType = "unified" | "evidence" | "factcheck";

const toTemplateMode = (mode: SearchMode): TemplateMode => {
  return mode === "urlanalysis" ? "factcheck" : mode;
};

const isTemplateItem = (item: SelectedItem): item is SelectedItem & { type: TemplateItemType } => {
  return item.type !== "urlclaim";
};

interface SelectedItem {
  id: string;
  type: "unified" | "evidence" | "factcheck" | "urlclaim";
  title: string;
  url?: string;
  snippet?: string;
  source?: string;
  stance?: string;
  verificationStatus?: string;
  addedAt: string;
}

interface SearchTemplate {
  id: number;
  name: string;
  query: string;
  mode: SearchMode;
  items: SelectedItem[];
  favorite?: boolean;
  useCount?: number;
  createdAt: string;
}

interface VerificationResult {
  claimId: string;
  originalClaim: string;
  status: "VERIFIED" | "PARTIALLY_VERIFIED" | "UNVERIFIED" | "DISPUTED" | "FALSE";
  confidenceScore: number;
  supportingEvidence: Array<{ sourceName: string; url: string; excerpt: string }>;
  contradictingEvidence: Array<{ sourceName: string; url: string; excerpt: string }>;
  verificationSummary: string;
}

// ============================================
// Constants
// ============================================

const MODE_CONFIG = {
  unified: {
    label: "통합 검색",
    description: "DB + 웹 + AI를 동시에 검색",
    icon: Search,
    color: "text-blue-600",
    bgColor: "bg-blue-50 dark:bg-blue-900/20",
    borderColor: "border-blue-500",
  },
  deep: {
    label: "심층 보고서",
    description: "AI 기반 심층 분석 보고서 생성",
    icon: Brain,
    color: "text-purple-600",
    bgColor: "bg-purple-50 dark:bg-purple-900/20",
    borderColor: "border-purple-500",
  },
  factcheck: {
    label: "팩트체크",
    description: "주장의 진위 검증",
    icon: Shield,
    color: "text-green-600",
    bgColor: "bg-green-50 dark:bg-green-900/20",
    borderColor: "border-green-500",
  },
  urlanalysis: {
    label: "URL 분석",
    description: "URL에서 주장 추출 및 검증",
    icon: LinkIcon,
    color: "text-orange-600",
    bgColor: "bg-orange-50 dark:bg-orange-900/20",
    borderColor: "border-orange-500",
  },
} as const;

const SOURCE_CONFIG = {
  database: { label: "DB", icon: Database, color: "text-blue-600", bgColor: "bg-blue-100 dark:bg-blue-900/30" },
  web: { label: "웹", icon: Globe, color: "text-green-600", bgColor: "bg-green-100 dark:bg-green-900/30" },
  ai: { label: "AI", icon: Brain, color: "text-purple-600", bgColor: "bg-purple-100 dark:bg-purple-900/30" },
} as const;

const STANCE_CONFIG = {
  pro: { label: "긍정", icon: ThumbsUp, color: "text-teal-600", bgColor: "bg-teal-100 dark:bg-teal-900/30" },
  con: { label: "부정", icon: ThumbsDown, color: "text-red-600", bgColor: "bg-red-100 dark:bg-red-900/30" },
  neutral: { label: "중립", icon: Minus, color: "text-gray-600", bgColor: "bg-gray-100 dark:bg-gray-800" },
} as const;

const SOURCE_CATEGORY_CONFIG = {
  news: { label: "뉴스", icon: Newspaper, color: "text-blue-600", bgColor: "bg-blue-100 dark:bg-blue-900/30" },
  community: { label: "커뮤니티", icon: Users, color: "text-orange-600", bgColor: "bg-orange-100 dark:bg-orange-900/30" },
  blog: { label: "블로그", icon: FileText, color: "text-purple-600", bgColor: "bg-purple-100 dark:bg-purple-900/30" },
  official: { label: "공식", icon: Shield, color: "text-green-600", bgColor: "bg-green-100 dark:bg-green-900/30" },
  academic: { label: "학술", icon: GraduationCap, color: "text-indigo-600", bgColor: "bg-indigo-100 dark:bg-indigo-900/30" },
} as const;

const VERIFICATION_CONFIG = {
  VERIFIED: { label: "검증됨", icon: CheckCircle2, color: "text-green-600", bgColor: "bg-green-100 dark:bg-green-900/30" },
  PARTIALLY_VERIFIED: { label: "부분 검증", icon: AlertTriangle, color: "text-yellow-600", bgColor: "bg-yellow-100 dark:bg-yellow-900/30" },
  UNVERIFIED: { label: "검증 불가", icon: HelpCircle, color: "text-gray-600", bgColor: "bg-gray-100 dark:bg-gray-800" },
  DISPUTED: { label: "논쟁 중", icon: Scale, color: "text-orange-600", bgColor: "bg-orange-100 dark:bg-orange-900/30" },
  FALSE: { label: "거짓", icon: XCircle, color: "text-red-600", bgColor: "bg-red-100 dark:bg-red-900/30" },
} as const;

// Default user ID for templates (can be replaced with actual auth)
const DEFAULT_USER_ID = "default-user";

// ============================================
// Result Card Components
// ============================================

interface UnifiedResultCardProps {
  result: UnifiedSearchResult;
  isSelected: boolean;
  onSelect: () => void;
  onViewDetail: () => void;
  onAddToProject?: () => void;
  hasProject?: boolean;
}

const UnifiedResultCard = ({ result, isSelected, onSelect, onViewDetail, onAddToProject, hasProject }: UnifiedResultCardProps) => {
  const sourceConfig = SOURCE_CONFIG[result.source] || SOURCE_CONFIG.web;
  const SourceIcon = sourceConfig.icon;

  return (
    <Card className={`${sourceConfig.bgColor} border-l-4 ${isSelected ? "border-l-primary ring-2 ring-primary/30" : "border-l-transparent"} transition-all hover:shadow-md`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className={`${sourceConfig.color} flex items-center gap-1`}>
                <SourceIcon className="h-3 w-3" />
                {result.sourceLabel || sourceConfig.label}
              </Badge>
              {result.publishedAt && (
                <span className="text-xs text-muted-foreground">
                  {new Date(result.publishedAt).toLocaleDateString("ko-KR")}
                </span>
              )}
            </div>
            <h4 className="font-semibold text-sm mb-1 line-clamp-2">{result.title}</h4>
            {result.snippet && result.source === 'ai' ? (
              <div className="text-sm text-muted-foreground">
                <MarkdownRenderer content={result.snippet} isStreaming={false} />
              </div>
            ) : result.snippet ? (
              <p className="text-sm text-muted-foreground line-clamp-2">{result.snippet}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onViewDetail}
                    className="p-2 rounded-md hover:bg-muted text-muted-foreground transition-colors"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>세부 내용 보기</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onSelect}
                    className={`p-2 rounded-md transition-colors ${
                      isSelected
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    <Pin className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {isSelected ? "선택 해제" : "템플릿에 추가"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {hasProject && onAddToProject && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={onAddToProject}
                      className="p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-green-600 transition-colors"
                    >
                      <FolderPlus className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>프로젝트에 추가</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {result.url && (
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-md hover:bg-muted transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

interface EvidenceCardProps {
  evidence: Evidence;
  isSelected: boolean;
  onSelect: () => void;
  onViewDetail: () => void;
  onAddToProject?: () => void;
  hasProject?: boolean;
}

const EvidenceCard = ({ evidence, isSelected, onSelect, onViewDetail, onAddToProject, hasProject }: EvidenceCardProps) => {
  const stanceConfig = STANCE_CONFIG[evidence.stance] || STANCE_CONFIG.neutral;
  const StanceIcon = stanceConfig.icon;

  return (
    <Card className={`${stanceConfig.bgColor} border-l-4 ${isSelected ? "border-l-primary ring-2 ring-primary/30" : evidence.stance === "pro" ? "border-l-teal-500" : evidence.stance === "con" ? "border-l-red-500" : "border-l-gray-400"} transition-all hover:shadow-md`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className={`${stanceConfig.color} flex items-center gap-1`}>
                <StanceIcon className="h-3 w-3" />
                {stanceConfig.label}
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
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onViewDetail}
                    className="p-2 rounded-md hover:bg-muted text-muted-foreground transition-colors"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>세부 내용 보기</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onSelect}
                    className={`p-2 rounded-md transition-colors ${
                      isSelected
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    <Pin className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {isSelected ? "선택 해제" : "템플릿에 추가"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {hasProject && onAddToProject && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={onAddToProject}
                      className="p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-green-600 transition-colors"
                    >
                      <FolderPlus className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>프로젝트에 추가</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {evidence.url && (
              <a
                href={evidence.url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-md hover:bg-muted transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// VerificationCard component removed - now using embedded FactCheckChatbot

// ============================================
// Selection Panel
// ============================================

interface SelectionPanelProps {
  selectedItems: SelectedItem[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onSaveTemplate: (name: string) => void;
}

const SelectionPanel = ({ selectedItems, onRemove, onClear, onSaveTemplate }: SelectionPanelProps) => {
  const [templateName, setTemplateName] = useState("");
  const [isExpanded, setIsExpanded] = useState(true);

  const handleSave = () => {
    if (templateName.trim()) {
      onSaveTemplate(templateName.trim());
      setTemplateName("");
    }
  };

  if (selectedItems.length === 0) return null;

  const typeColors = {
    unified: "border-l-blue-500 bg-blue-50 dark:bg-blue-900/20",
    evidence: "border-l-purple-500 bg-purple-50 dark:bg-purple-900/20",
    factcheck: "border-l-green-500 bg-green-50 dark:bg-green-900/20",
  };

  return (
    <Card className="border-dashed border-2 border-primary/30 bg-primary/5">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Pin className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">선택한 항목 ({selectedItems.length})</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={onClear}>
                전체 해제
              </Button>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm">
                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            <ScrollArea className="max-h-[200px]">
              <div className="space-y-2 pr-4">
                {selectedItems.map((item) => (
                  <div key={item.id} className={`border-l-4 p-3 rounded-r-lg ${typeColors[item.type]}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs">
                            {item.type === "unified" ? "검색결과" : item.type === "evidence" ? "증거" : "검증"}
                          </Badge>
                          {item.stance && <Badge variant="secondary" className="text-xs">{item.stance}</Badge>}
                        </div>
                        <p className="text-sm font-medium line-clamp-1">{item.title}</p>
                      </div>
                      <button
                        onClick={() => onRemove(item.id)}
                        className="p-1 rounded hover:bg-destructive/10 text-destructive transition-colors"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <div className="flex gap-2 pt-2 border-t">
              <Input
                placeholder="템플릿 이름"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                className="flex-1"
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
              <Button onClick={handleSave} disabled={!templateName.trim()}>
                <Bookmark className="h-4 w-4 mr-1" />
                저장
              </Button>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

// ============================================
// Main Component
// ============================================

export default function SmartSearch() {
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Get initial mode from URL params (for backward compatibility redirects)
  const getInitialMode = (): SearchMode => {
    const modeParam = searchParams.get("mode");
    if (modeParam === "deep" || modeParam === "factcheck" || modeParam === "unified" || modeParam === "urlanalysis") {
      return modeParam;
    }
    return "unified";
  };

  // Project state
  const [projectSelectorOpen, setProjectSelectorOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const { 
    projects, 
    loading: projectsLoading, 
    loadProjects,
    addItem: addProjectItem,
    selectProject,
    currentProject,
  } = useProjects({ userId: DEFAULT_USER_ID, autoLoad: true });

  // Background tasks for loading completed Deep Search results
  const { getTask } = useBackgroundTasks();

  // State (moved before effects that use them)
  const [activeTab, setActiveTab] = useState<SearchMode>(getInitialMode);
  const [query, setQuery] = useState(searchParams.get("q") || "");

  // Deep Search State (moved before the loading effect)
  const [deepJobId, setDeepJobId] = useState<string | null>(null);
  const [deepResults, setDeepResults] = useState<DeepSearchResult | null>(null);
  const [deepLoading, setDeepLoading] = useState(false);
  const [deepError, setDeepError] = useState<string | null>(null);
  const [deepProgress, setDeepProgress] = useState(0);
  const [showDeepHistory, setShowDeepHistory] = useState(false);
  const [deepHistoryLoading, setDeepHistoryLoading] = useState(false);
  const [deepHistoryJobs, setDeepHistoryJobs] = useState<DeepSearchJob[]>([]);

  // Get selected project object
  const selectedProject = useMemo(() => {
    if (!selectedProjectId) return null;
    return projects.find(p => p.id === selectedProjectId) || currentProject;
  }, [selectedProjectId, projects, currentProject]);

  // Read projectId from URL params on mount
  useEffect(() => {
    const projectIdParam = searchParams.get("projectId");
    if (projectIdParam) {
      const projectId = parseInt(projectIdParam, 10);
      if (!isNaN(projectId)) {
        setSelectedProjectId(projectId);
        // Load the project details
        selectProject(projectId).catch(console.error);
      }
    }
  }, [searchParams, selectProject]);

  // Load Deep Search result from URL jobId parameter or background task
  useEffect(() => {
    const jobIdParam = searchParams.get("jobId");
    if (!jobIdParam) return;

    console.log('[SmartSearch] Loading Deep Search from jobId param:', jobIdParam);
    setDeepJobId(jobIdParam);
    setActiveTab("deep");
    
    // Try to load result from background task first
    const task = getTask(jobIdParam);
    if (task && task.result) {
      console.log('[SmartSearch] Found cached result in background task:', task.result);
      setDeepResults(task.result as DeepSearchResult);
      setDeepProgress(100);
      setDeepLoading(false);
      if (task.title) {
        setQuery(task.title);
      }
      return;
    }

    // Fallback: fetch from API
    const loadFromApi = async () => {
      try {
        console.log('[SmartSearch] Fetching Deep Search result from API...');
        setDeepLoading(true);
        const result = await getDeepSearchResult(jobIdParam);
        console.log('[SmartSearch] API result:', result);
        setDeepResults(result);
        setDeepProgress(100);
        if (result.topic) {
          setQuery(result.topic);
        }
      } catch (e) {
        console.error('[SmartSearch] Failed to load Deep Search result:', e);
        setDeepError(e instanceof Error ? e.message : 'Deep Search 결과를 불러오는데 실패했습니다.');
      } finally {
        setDeepLoading(false);
      }
    };

    loadFromApi();
  }, [searchParams, getTask]); // Removed deepResults from deps to prevent re-fetching

  // Additional State
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [templates, setTemplates] = useState<SearchTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateFilter, setTemplateFilter] = useState<"all" | "favorites" | "recent" | "mostUsed">("all");
  const [templateSearchQuery, setTemplateSearchQuery] = useState("");

  // Search filters state (time window, sources, etc.)
  const [filters, setFilters] = useState<SearchFilters>(defaultFilters);

  // Unified Search State
  const [unifiedResults, setUnifiedResults] = useState<UnifiedSearchResult[]>([]);
  const [unifiedLoading, setUnifiedLoading] = useState(false);
  const [unifiedError, setUnifiedError] = useState<string | null>(null);
  const unifiedEventSourceRef = useRef<EventSource | null>(null);
  const [unifiedJobId, setUnifiedJobId] = useState<string | null>(null);

  const [aiReportLoading, setAiReportLoading] = useState(false);
  const [aiReportError, setAiReportError] = useState<string | null>(null);
  const [aiReportSummary, setAiReportSummary] = useState<string | null>(null);
  const [aiReportContent, setAiReportContent] = useState<string | null>(null);

  // FactCheck State - Moved to embedded FactCheckChatbot component
  // Old states removed: claims, factCheckResults, factCheckLoading, factCheckError

  // URL Analysis State
  const [analysisUrl, setAnalysisUrl] = useState("");
  const [urlClaims, setUrlClaims] = useState<Array<{
    id: string;
    text: string;
    confidence: number;
    context?: string;
    selected: boolean;
  }>>([]);
  const [urlAnalysisLoading, setUrlAnalysisLoading] = useState(false);
  const [urlAnalysisError, setUrlAnalysisError] = useState<string | null>(null);
  const [urlPageTitle, setUrlPageTitle] = useState<string | null>(null);
  const [priorityUrls, setPriorityUrls] = useState<PriorityUrl[]>([]);

  // Detail View Dialog State
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<{
    type: "unified" | "evidence" | "verification";
    data: UnifiedSearchResult | Evidence | VerificationResult;
  } | null>(null);

  // Track if we should auto-search on initial load
  const initialSearchRef = useRef(false);
  
  // Ref for the embedded FactCheckChatbot
  const factCheckChatbotRef = useRef<FactCheckChatbotRef>(null);
  
  // State for claims to be sent to the chatbot (from URL analysis transfer)
  const [pendingFactCheckClaims, setPendingFactCheckClaims] = useState<string[]>([]);

  // Accept navigation state from other pages (SearchHistory, UrlCollections, ParallelSearch, etc.)
  useEffect(() => {
    const state = location.state as {
      query?: string;
      priorityUrls?: PriorityUrl[];
      fromHistory?: boolean;
      autoSearch?: boolean;
    } | null;

    if (!state) return;

    if (typeof state.query === 'string' && state.query.trim()) {
      setQuery(state.query);
    }

    if (Array.isArray(state.priorityUrls) && state.priorityUrls.length > 0) {
      setPriorityUrls(state.priorityUrls);
    }
  }, [location.state]);

  // Deep Search SSE Hook
  const {
    status: deepSSEStatus,
    currentStatus: deepJobStatus,
    progress: sseProgress,
    result: sseResult,
    error: sseError,
  } = useDeepSearchSSE({
    jobId: deepJobId,
    topic: query,
    enabled: !!deepJobId,
    onComplete: (result) => {
      console.log('[SmartSearch] Deep Search completed with result:', result);
      setDeepResults(result);
      setDeepLoading(false);
      setDeepProgress(100);
    },
    onError: (error) => {
      console.error('[SmartSearch] Deep Search error:', error);
      setDeepError(error);
      setDeepLoading(false);
    },
    onProgress: (progress) => {
      setDeepProgress(progress);
    },
  });

  // Sync SSE result to deepResults state - always sync when sseResult changes
  useEffect(() => {
    if (sseResult) {
      console.log('[SmartSearch] Syncing sseResult to deepResults:', sseResult);
      setDeepResults(sseResult);
      // Mark as done only when job status is COMPLETED
      if (sseResult.status === 'COMPLETED') {
        setDeepLoading(false);
        setDeepProgress(100);
      }
    }
  }, [sseResult]);

  // Sync SSE error to deepError state
  useEffect(() => {
    if (sseError && !deepError) {
      console.log('[SmartSearch] Syncing sseError to deepError:', sseError);
      setDeepError(sseError);
      setDeepLoading(false);
    }
  }, [sseError, deepError]);

  // Sync SSE progress to deepProgress state
  useEffect(() => {
    if (sseProgress > 0 && sseProgress > deepProgress) {
      setDeepProgress(sseProgress);
    }
  }, [sseProgress, deepProgress]);

  // Sync SSE job status to loading state
  useEffect(() => {
    if (deepJobStatus === 'COMPLETED' || deepJobStatus === 'FAILED' || deepJobStatus === 'CANCELLED' || deepJobStatus === 'TIMEOUT') {
      setDeepLoading(false);
    } else if (deepJobStatus === 'IN_PROGRESS') {
      setDeepLoading(true);
    }
  }, [deepJobStatus]);

  // Load templates from server based on filter and search query
  useEffect(() => {
    const loadTemplates = async () => {
      setTemplatesLoading(true);
      try {
        let serverTemplates: ApiSearchTemplate[];
        
        // If there's a search query, use search API regardless of filter
        if (templateSearchQuery.trim()) {
          const searchResult = await searchTemplatesByName(templateSearchQuery.trim(), DEFAULT_USER_ID);
          serverTemplates = searchResult.content;
        } else {
          switch (templateFilter) {
            case "favorites":
              serverTemplates = await getFavoriteTemplates(DEFAULT_USER_ID);
              break;
            case "recent":
              serverTemplates = await getRecentlyUsedTemplates(DEFAULT_USER_ID, 20);
              break;
            case "mostUsed":
              serverTemplates = await getMostUsedTemplates(DEFAULT_USER_ID, 20);
              break;
            default:
              serverTemplates = await getAllTemplatesByUser(DEFAULT_USER_ID);
          }
        }
        
        // Transform API response to local format
        const transformedTemplates: SearchTemplate[] = serverTemplates.map((t) => ({
          id: t.id,
          name: t.name,
          query: t.query,
          mode: t.mode as SearchMode,
          items: t.items.map((item) => ({
            ...item,
            addedAt: item.addedAt || new Date().toISOString(),
          })) as SelectedItem[],
          favorite: t.favorite,
          useCount: t.useCount,
          createdAt: t.createdAt,
        }));
        setTemplates(transformedTemplates);
      } catch (e) {
        console.error("Failed to load templates from server:", e);
        // Fallback: try localStorage for migration (only for 'all' filter without search)
        if (templateFilter === "all" && !templateSearchQuery.trim()) {
          try {
            const saved = localStorage.getItem("smartSearch_templates");
            if (saved) {
              const localTemplates = JSON.parse(saved);
              // Migrate old localStorage templates to server
              for (const t of localTemplates) {
                try {
                  const sanitizedMode = toTemplateMode(t.mode as SearchMode);
                  const sanitizedItems = Array.isArray(t.items)
                    ? (t.items as SelectedItem[]).filter(isTemplateItem)
                    : [];

                  await createSearchTemplate({
                    name: t.name,
                    query: t.query,
                    mode: sanitizedMode,
                    items: sanitizedItems,
                    userId: DEFAULT_USER_ID,
                  });
                } catch (migrationError) {
                  console.error("Failed to migrate template:", migrationError);
                }
              }
              // Clear localStorage after migration
              localStorage.removeItem("smartSearch_templates");
              // Reload from server
              const migrated = await getAllTemplatesByUser(DEFAULT_USER_ID);
              setTemplates(migrated.map((t) => ({
                id: t.id,
                name: t.name,
                query: t.query,
                mode: t.mode as SearchMode,
                items: t.items as SelectedItem[],
                favorite: t.favorite,
                useCount: t.useCount,
                createdAt: t.createdAt,
              })));
            }
          } catch (localError) {
            console.error("Failed to migrate local templates:", localError);
          }
        }
      } finally {
        setTemplatesLoading(false);
      }
    };
    loadTemplates();
  }, [templateFilter, templateSearchQuery]);

  // Save template to server
  const saveAsTemplate = useCallback(async (name: string) => {
    try {
      const templateMode = toTemplateMode(activeTab);
      const templateItems = selectedItems
        .filter(isTemplateItem)
        .map((item) => ({
          id: item.id,
          type: item.type,
          title: item.title,
          url: item.url,
          snippet: item.snippet,
          source: item.source,
          stance: item.stance,
          verificationStatus: item.verificationStatus,
          addedAt: item.addedAt,
        }));

      const created = await createSearchTemplate({
        name,
        query,
        mode: templateMode,
        items: templateItems,
        userId: DEFAULT_USER_ID,
      });
      
      // Add to local state
      const newTemplate: SearchTemplate = {
        id: created.id,
        name: created.name,
        query: created.query,
        mode: created.mode as SearchMode,
        items: created.items as SelectedItem[],
        favorite: created.favorite,
        useCount: created.useCount,
        createdAt: created.createdAt,
      };
      setTemplates((prev) => [...prev, newTemplate]);
      toast({ title: "템플릿 저장됨", description: `"${name}" 템플릿이 서버에 저장되었습니다.` });
    } catch (e) {
      console.error("Failed to save template:", e);
      toast({ 
        title: "저장 실패", 
        description: "템플릿 저장에 실패했습니다.",
        variant: "destructive",
      });
    }
  }, [query, activeTab, selectedItems, toast]);

  // Selection handlers
  const toggleSelection = useCallback((item: Omit<SelectedItem, "addedAt">) => {
    setSelectedItems((prev) => {
      const exists = prev.find((i) => i.id === item.id);
      if (exists) {
        return prev.filter((i) => i.id !== item.id);
      }
      return [...prev, { ...item, addedAt: new Date().toISOString() }];
    });
  }, []);

  const isSelected = useCallback((id: string) => {
    return selectedItems.some((i) => i.id === id);
  }, [selectedItems]);

  const clearSelection = useCallback(() => setSelectedItems([]), []);

  const loadTemplate = useCallback(async (template: SearchTemplate) => {
    // Record usage on server
    try {
      await recordTemplateUsage(template.id);
    } catch (e) {
      console.error("Failed to record template usage:", e);
    }
    
    setQuery(template.query);
    setActiveTab(template.mode);
    setSelectedItems(template.items);
    setShowTemplates(false);
    toast({ title: "템플릿 로드됨", description: `"${template.name}" 템플릿이 적용되었습니다.` });
  }, [toast]);

  const deleteTemplate = useCallback(async (id: number) => {
    try {
      await deleteSearchTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      toast({ title: "삭제됨", description: "템플릿이 삭제되었습니다." });
    } catch (e) {
      console.error("Failed to delete template:", e);
      toast({ 
        title: "삭제 실패", 
        description: "템플릿 삭제에 실패했습니다.",
        variant: "destructive",
      });
    }
  }, [toast]);

  const toggleFavorite = useCallback(async (id: number) => {
    try {
      const updated = await toggleTemplateFavorite(id);
      setTemplates((prev) => prev.map((t) => 
        t.id === id ? { ...t, favorite: updated.favorite } : t
      ));
    } catch (e) {
      console.error("Failed to toggle favorite:", e);
    }
  }, []);

  // ============================================
  // Project Functions
  // ============================================

  // Add item to selected project
  const handleAddToProject = useCallback(async (
    itemType: ProjectItemType,
    title: string,
    content?: string,
    sourceUrl?: string,
    metadata?: Record<string, unknown>
  ) => {
    if (!selectedProjectId) {
      toast({
        title: "프로젝트를 선택해주세요",
        description: "항목을 추가할 프로젝트를 먼저 선택해주세요.",
        variant: "destructive",
      });
      return;
    }

    try {
      await addProjectItem(selectedProjectId, {
        itemType,
        title,
        content,
        sourceUrl,
        metadata,
        isRead: false,
        isBookmarked: false,
      });
      toast({
        title: "프로젝트에 추가됨",
        description: `"${title.slice(0, 30)}${title.length > 30 ? '...' : ''}"이(가) 프로젝트에 추가되었습니다.`,
      });
    } catch (e) {
      console.error("Failed to add item to project:", e);
      toast({
        title: "추가 실패",
        description: e instanceof Error ? e.message : "프로젝트에 항목을 추가하는데 실패했습니다.",
        variant: "destructive",
      });
    }
  }, [selectedProjectId, addProjectItem, toast]);

  // Add unified result to project
  const handleAddUnifiedToProject = useCallback((result: UnifiedSearchResult) => {
    const itemType: ProjectItemType = result.source === 'database' ? 'ARTICLE' : 
                                      result.source === 'ai' ? 'DOCUMENT' : 'SEARCH_RESULT';
    handleAddToProject(
      itemType,
      result.title,
      result.snippet || result.content,
      result.url,
      {
        source: result.source,
        sourceLabel: result.sourceLabel,
        publishedAt: result.publishedAt,
        searchQuery: query,
      }
    );
  }, [handleAddToProject, query]);

  // Add evidence to project
  const handleAddEvidenceToProject = useCallback((evidence: Evidence) => {
    handleAddToProject(
      'EVIDENCE',
      evidence.title || evidence.snippet.slice(0, 50),
      evidence.snippet,
      evidence.url,
      {
        stance: evidence.stance,
        source: evidence.source,
        searchQuery: query,
      }
    );
  }, [handleAddToProject, query]);

  // Add verification result to project
  // handleAddVerificationToProject removed - now using embedded FactCheckChatbot

  // Handle project selection change
  const handleProjectSelect = useCallback((projectId: number | null) => {
    setSelectedProjectId(projectId);
    setProjectSelectorOpen(false);
    
    // Update URL params
    const newParams = new URLSearchParams(searchParams);
    if (projectId) {
      newParams.set("projectId", String(projectId));
    } else {
      newParams.delete("projectId");
    }
    setSearchParams(newParams, { replace: true });
  }, [searchParams, setSearchParams]);

  // ============================================
  // Search Functions
  // ============================================

  // Unified Search
  const runUnifiedSearch = useCallback(async () => {
    if (!query.trim()) return;

    setUnifiedLoading(true);
    setUnifiedError(null);
    setUnifiedResults([]);

    // Close previous connection
    if (unifiedEventSourceRef.current) {
      unifiedEventSourceRef.current.close();
    }

    try {
      // Build date parameters based on filters
      let startDate: string | undefined;
      let endDate: string | undefined;
      
      if (filters.timeWindow === "custom") {
        if (filters.customStartDate) {
          startDate = filters.customStartDate.toISOString();
        }
        if (filters.customEndDate) {
          // Set end date to end of day
          const end = new Date(filters.customEndDate);
          end.setHours(23, 59, 59, 999);
          endDate = end.toISOString();
        }
      }

      // Get priority URLs if any
      const priorityUrlStrings = priorityUrls.length > 0 
        ? priorityUrls.map(u => u.url) 
        : undefined;

      const job = await startUnifiedSearchJob(
        query, 
        filters.timeWindow,
        priorityUrlStrings,
        startDate,
        endDate
      );
      setUnifiedJobId(job.jobId);
      const es = await openUnifiedSearchJobStream(job.jobId);
      unifiedEventSourceRef.current = es;

      es.addEventListener("result", (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.result) {
            setUnifiedResults((prev) => [...prev, data.result]);
          }
        } catch (e) {
          console.error("Failed to parse result:", e);
        }
      });

      es.addEventListener("done", () => {
        setUnifiedLoading(false);
        es.close();
      });

      es.addEventListener("job_error", (event) => {
        try {
          const data = JSON.parse(event.data);
          setUnifiedError(data.error || "검색 중 오류가 발생했습니다.");
        } catch {
          setUnifiedError("검색 중 오류가 발생했습니다.");
        }
        setUnifiedLoading(false);
        es.close();
      });

      es.onerror = () => {
        setUnifiedError("연결이 끊어졌습니다.");
        setUnifiedLoading(false);
        es.close();
      };
    } catch (e) {
      setUnifiedError(e instanceof Error ? e.message : "검색 시작 실패");
      setUnifiedLoading(false);
    }
  }, [query, filters, priorityUrls]);

  // Helper: Extract summary section from markdown content
  const extractSummaryFromContent = useCallback((markdown: string | null | undefined): string | null => {
    if (!markdown) return null;
    
    // Look for "### [요약]" or "## [요약]" section
    let start = markdown.indexOf("### [요약]");
    if (start < 0) start = markdown.indexOf("## [요약]");
    if (start < 0) start = markdown.indexOf("### 요약");
    if (start < 0) start = markdown.indexOf("## 요약");
    if (start < 0) return null;

    // Find next section header
    let end = markdown.indexOf("\n### ", start + 1);
    if (end < 0) end = markdown.indexOf("\n## ", start + 1);
    if (end < 0) end = markdown.length;

    const section = markdown.substring(start, end).trim();
    return section || null;
  }, []);

  useEffect(() => {
    const loadAiReport = async () => {
      const current = detailItem?.type === "unified" ? (detailItem.data as UnifiedSearchResult) : null;
      if (!detailDialogOpen || !current || current.source !== "ai") {
        setAiReportLoading(false);
        setAiReportError(null);
        setAiReportSummary(null);
        setAiReportContent(null);
        return;
      }

      // Priority 1: Use SSE content if available (immediate, no network call)
      // SSE result should have full content in 'content' field
      const sseContent = current.content || null;
      const sseSnippet = current.snippet || null;
      
      // Debug: Log what we have from SSE
      console.debug("[AI Report] SSE data:", {
        hasContent: !!sseContent,
        contentLength: sseContent?.length,
        hasSnippet: !!sseSnippet,
        snippetLength: sseSnippet?.length,
        contentPreview: sseContent?.substring(0, 100),
      });
      
      // If SSE content is available, use it immediately (best case - no network needed)
      if (sseContent && sseContent.length > 500) {
        // SSE has full content (longer than typical snippet)
        setAiReportLoading(false);
        setAiReportError(null);
        setAiReportContent(sseContent);
        setAiReportSummary(extractSummaryFromContent(sseContent));
        console.debug("[AI Report] Using SSE full content");
        return;
      }
      
      // If no jobId, use whatever SSE data we have
      if (!unifiedJobId) {
        setAiReportLoading(false);
        setAiReportError(null);
        const content = sseContent || sseSnippet;
        setAiReportContent(content);
        setAiReportSummary(extractSummaryFromContent(content));
        return;
      }

      // Set initial content from SSE while loading DB data
      const initialContent = sseContent || sseSnippet;
      setAiReportContent(initialContent);
      setAiReportSummary(extractSummaryFromContent(initialContent));
      
      // Try to fetch from DB for full content
      setAiReportLoading(true);
      setAiReportError(null);
      
      // Helper to fetch from DB
      const fetchFromDb = async (): Promise<{ content: string | null; summary: string | null }> => {
        const record = await getSearchHistoryByExternalId(unifiedJobId);
        const aiSummary = record.aiSummary || {};
        const dbSummary = typeof (aiSummary as Record<string, unknown>).summary === "string" 
          ? (aiSummary as Record<string, unknown>).summary as string 
          : null;
        const dbContent = typeof (aiSummary as Record<string, unknown>).content === "string" 
          ? (aiSummary as Record<string, unknown>).content as string 
          : null;
        return { content: dbContent, summary: dbSummary };
      };
      
      try {
        let { content: dbContent, summary: dbSummary } = await fetchFromDb();
        
        // Debug: Log DB result
        console.debug("[AI Report] DB fetch result:", {
          hasDbContent: !!dbContent,
          dbContentLength: dbContent?.length,
          hasDbSummary: !!dbSummary,
        });
        
        // If DB doesn't have content yet, wait and retry once
        // (AI report might still be saving to DB)
        if (!dbContent && unifiedJobId) {
          console.debug("[AI Report] DB content not found, retrying after delay...");
          await new Promise(resolve => setTimeout(resolve, 1500));
          const retry = await fetchFromDb();
          dbContent = retry.content;
          dbSummary = retry.summary;
          console.debug("[AI Report] Retry result:", {
            hasDbContent: !!dbContent,
            dbContentLength: dbContent?.length,
          });
        }

        // Use DB content if available (most reliable), otherwise keep SSE content
        const finalContent = dbContent || sseContent || sseSnippet;
        const finalSummary = dbSummary || extractSummaryFromContent(finalContent);
        
        setAiReportContent(finalContent);
        setAiReportSummary(finalSummary);
        
        console.debug("[AI Report] Final content source:", dbContent ? "DB" : sseContent ? "SSE content" : "SSE snippet");
      } catch (e) {
        // DB fetch failed - keep using SSE content (already set above)
        console.warn("[AI Report] Failed to load from DB, using SSE content:", e);
        // Don't show error to user if we have SSE content
        if (!sseContent && !sseSnippet) {
          setAiReportError(e instanceof Error ? e.message : "AI 보고서를 불러오는데 실패했습니다");
        }
      } finally {
        setAiReportLoading(false);
      }
    };

    void loadAiReport();
  }, [detailDialogOpen, detailItem, unifiedJobId, extractSummaryFromContent]);

  // Deep Search
  const runDeepSearch = useCallback(async () => {
    if (!query.trim()) return;

    setDeepLoading(true);
    setDeepError(null);
    setDeepResults(null);
    setDeepProgress(0);

    try {
      const job = await startDeepSearch({ topic: query });
      setDeepJobId(job.jobId);
    } catch (e) {
      setDeepError(e instanceof Error ? e.message : "Deep Search 시작 실패");
      setDeepLoading(false);
    }
  }, [query]);

  // Load Deep Search History
  const loadDeepSearchHistory = useCallback(async () => {
    setDeepHistoryLoading(true);
    try {
      const response = await listDeepSearchJobs(0, 20);
      setDeepHistoryJobs(response.content || []);
    } catch (e) {
      console.error('Failed to load deep search history:', e);
      toast({
        title: "기록 로드 실패",
        description: e instanceof Error ? e.message : "Deep Search 기록을 불러오는데 실패했습니다.",
        variant: "destructive",
      });
    } finally {
      setDeepHistoryLoading(false);
    }
  }, [toast]);

  // Load history when panel is opened
  useEffect(() => {
    if (showDeepHistory) {
      loadDeepSearchHistory();
    }
  }, [showDeepHistory, loadDeepSearchHistory]);

  // Load a previous deep search result
  const loadDeepSearchFromHistory = useCallback(async (job: DeepSearchJob) => {
    if (job.status !== 'COMPLETED') {
      toast({
        title: "불러올 수 없음",
        description: "완료되지 않은 검색입니다.",
        variant: "destructive",
      });
      return;
    }

    setDeepLoading(true);
    setDeepError(null);
    setDeepJobId(job.jobId);
    setQuery(job.topic);
    setShowDeepHistory(false);

    try {
      const result = await getDeepSearchResult(job.jobId);
      setDeepResults(result);
      setDeepProgress(100);
    } catch (e) {
      setDeepError(e instanceof Error ? e.message : "결과를 불러오는데 실패했습니다.");
    } finally {
      setDeepLoading(false);
    }
  }, [toast]);

  // Fact Check - Now handled by embedded FactCheckChatbot component
  // Old functions removed: runFactCheck, addClaim, removeClaim, updateClaim

  // URL Analysis - Extract claims from URL
  const runUrlAnalysis = useCallback(async () => {
    if (!analysisUrl.trim()) {
      setUrlAnalysisError("URL을 입력해주세요.");
      return;
    }

    // Validate URL
    try {
      const parsed = new URL(analysisUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Invalid protocol");
      }
    } catch {
      setUrlAnalysisError("올바른 URL 형식을 입력해주세요.");
      return;
    }

    setUrlAnalysisLoading(true);
    setUrlAnalysisError(null);
    setUrlClaims([]);
    setUrlPageTitle(null);

    try {
      const response = await extractClaimsFromUrl({
        url: analysisUrl.trim(),
        maxClaims: 10,
        minConfidence: 0.5,
      });

      if (response.message && response.claims.length === 0) {
        setUrlAnalysisError(response.message);
        return;
      }

      if (response.pageTitle) {
        setUrlPageTitle(response.pageTitle);
      }

      if (response.claims && Array.isArray(response.claims)) {
        setUrlClaims(
          response.claims.map((claim) => ({
            id: claim.id,
            text: claim.text,
            confidence: claim.confidence || 0.7,
            context: claim.context,
            selected: true,
          }))
        );
      }
    } catch (e) {
      setUrlAnalysisError(e instanceof Error ? e.message : "URL 분석 실패");
    } finally {
      setUrlAnalysisLoading(false);
    }
  }, [analysisUrl]);

  // Toggle URL claim selection
  const toggleUrlClaimSelection = useCallback((claimId: string) => {
    setUrlClaims((prev) =>
      prev.map((claim) =>
        claim.id === claimId ? { ...claim, selected: !claim.selected } : claim
      )
    );
  }, []);

  // Select/deselect all URL claims
  const selectAllUrlClaims = useCallback((selected: boolean) => {
    setUrlClaims((prev) => prev.map((claim) => ({ ...claim, selected })));
  }, []);

  // Transfer selected URL claims to fact check chatbot
  const transferToFactCheck = useCallback(() => {
    const selectedClaims = urlClaims.filter((c) => c.selected).map((c) => c.text);
    if (selectedClaims.length === 0) {
      toast({
        title: "선택된 주장이 없습니다",
        description: "팩트체크로 전송할 주장을 선택해주세요.",
        variant: "destructive",
      });
      return;
    }
    
    // Switch to factcheck tab first
    setActiveTab("factcheck");
    
    // Use ref to send claims directly if chatbot is ready, otherwise store as pending
    if (factCheckChatbotRef.current) {
      factCheckChatbotRef.current.sendClaims(selectedClaims);
    } else {
      setPendingFactCheckClaims(selectedClaims);
    }
    
    toast({
      title: "주장이 전송되었습니다",
      description: `${selectedClaims.length}개의 주장이 팩트체크 챗봇으로 전송되었습니다.`,
    });
  }, [urlClaims, toast]);

  // Handle search based on active tab
  // Note: factcheck tab now uses embedded chatbot, so no explicit search function needed
  const handleSearch = () => {
    if (activeTab === "unified") runUnifiedSearch();
    else if (activeTab === "deep") runDeepSearch();
    else if (activeTab === "factcheck") {
      // For factcheck, send the query to the chatbot
      if (query.trim() && factCheckChatbotRef.current) {
        factCheckChatbotRef.current.sendQuery(query);
      }
    }
    else if (activeTab === "urlanalysis") runUrlAnalysis();
  };

  // Auto-search on initial load if query param exists (from home page navigation)
  useEffect(() => {
    const queryParam = searchParams.get("q");
    if (queryParam && queryParam.trim() && !initialSearchRef.current) {
      initialSearchRef.current = true;
      // Delay to ensure state is set
      const timer = setTimeout(() => {
        if (activeTab === "unified") {
          runUnifiedSearch();
        } else if (activeTab === "deep") {
          runDeepSearch();
        } else if (activeTab === "factcheck") {
          // Send query to factcheck chatbot
          if (factCheckChatbotRef.current) {
            factCheckChatbotRef.current.sendQuery(queryParam);
          }
        } else if (activeTab === "urlanalysis") {
          // Set URL and run analysis
          setAnalysisUrl(queryParam);
          // Need another delay for state to update
          setTimeout(() => {
            runUrlAnalysis();
          }, 50);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [searchParams, activeTab, runUnifiedSearch, runDeepSearch, runUrlAnalysis]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (unifiedEventSourceRef.current) {
        unifiedEventSourceRef.current.close();
      }
    };
  }, []);

  return (
    <div className="container py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            검색
          </h1>
          <p className="text-muted-foreground text-sm">
            통합 검색, Deep Search, 팩트체크, URL 분석을 한 곳에서
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Project Selector */}
          <Popover open={projectSelectorOpen} onOpenChange={setProjectSelectorOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                role="combobox"
                aria-expanded={projectSelectorOpen}
                className="min-w-[180px] justify-between"
              >
                {selectedProject ? (
                  <span className="flex items-center gap-2 truncate">
                    <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                    <span className="truncate">{selectedProject.name}</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <FolderOpen className="h-4 w-4 shrink-0" />
                    프로젝트 선택
                  </span>
                )}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[250px] p-0" align="end">
              <Command>
                <CommandInput placeholder="프로젝트 검색..." />
                <CommandList>
                  <CommandEmpty>프로젝트를 찾을 수 없습니다.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="none"
                      onSelect={() => handleProjectSelect(null)}
                    >
                      <span className="text-muted-foreground">프로젝트 없음</span>
                      {!selectedProjectId && (
                        <Check className="ml-auto h-4 w-4" />
                      )}
                    </CommandItem>
                    {projects.map((project) => (
                      <CommandItem
                        key={project.id}
                        value={project.name}
                        onSelect={() => handleProjectSelect(project.id)}
                      >
                        <FolderOpen className="mr-2 h-4 w-4" />
                        <span className="truncate">{project.name}</span>
                        {selectedProjectId === project.id && (
                          <Check className="ml-auto h-4 w-4" />
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <Sheet open={showTemplates} onOpenChange={setShowTemplates}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm">
                <FolderOpen className="h-4 w-4 mr-1" />
              템플릿 ({templates.length})
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>저장된 검색 템플릿</SheetTitle>
              <SheetDescription>자주 사용하는 검색 조합을 저장하고 불러올 수 있습니다.</SheetDescription>
            </SheetHeader>
            
            {/* Template Search Input */}
            <div className="mt-4 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="템플릿 검색..."
                value={templateSearchQuery}
                onChange={(e) => setTemplateSearchQuery(e.target.value)}
                className="pl-9 pr-8"
              />
              {templateSearchQuery && (
                <button
                  onClick={() => setTemplateSearchQuery("")}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            
            {/* Template Filter Tabs */}
            <div className={`flex gap-1 mt-3 mb-3 p-1 bg-muted rounded-lg ${templateSearchQuery ? "opacity-50" : ""}`}>
              <Button
                variant={templateFilter === "all" ? "secondary" : "ghost"}
                size="sm"
                className="flex-1 text-xs"
                onClick={() => setTemplateFilter("all")}
                disabled={!!templateSearchQuery}
              >
                전체
              </Button>
              <Button
                variant={templateFilter === "favorites" ? "secondary" : "ghost"}
                size="sm"
                className="flex-1 text-xs"
                onClick={() => setTemplateFilter("favorites")}
                disabled={!!templateSearchQuery}
              >
                <Star className="h-3 w-3 mr-1" />
                즐겨찾기
              </Button>
              <Button
                variant={templateFilter === "recent" ? "secondary" : "ghost"}
                size="sm"
                className="flex-1 text-xs"
                onClick={() => setTemplateFilter("recent")}
                disabled={!!templateSearchQuery}
              >
                <Clock className="h-3 w-3 mr-1" />
                최근
              </Button>
              <Button
                variant={templateFilter === "mostUsed" ? "secondary" : "ghost"}
                size="sm"
                className="flex-1 text-xs"
                onClick={() => setTemplateFilter("mostUsed")}
                disabled={!!templateSearchQuery}
              >
                <Zap className="h-3 w-3 mr-1" />
                자주 사용
              </Button>
            </div>
            
            {/* Search result indicator */}
            {templateSearchQuery && (
              <div className="text-xs text-muted-foreground mb-2">
                "{templateSearchQuery}" 검색 결과: {templates.length}건
              </div>
            )}
            
            <ScrollArea className="h-[calc(100vh-280px)]">
              <div className="space-y-2 pr-4">
                {templatesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : templates.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {templateSearchQuery 
                      ? `"${templateSearchQuery}"에 대한 검색 결과가 없습니다.`
                      : "저장된 템플릿이 없습니다."
                    }
                  </p>
                ) : (
                  templates.map((template) => (
                    <Card key={template.id} className={`p-3 ${template.favorite ? "border-yellow-400 bg-yellow-50/50 dark:bg-yellow-900/10" : ""}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <p className="font-medium text-sm">{template.name}</p>
                            {template.favorite && (
                              <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {template.query} ({template.items.length}개 항목)
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-xs">
                              {MODE_CONFIG[template.mode].label}
                            </Badge>
                            {template.useCount != null && template.useCount > 0 && (
                              <span className="text-xs text-muted-foreground">
                                {template.useCount}회 사용
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button 
                                  variant="ghost" 
                                  size="sm"
                                  onClick={() => toggleFavorite(template.id)}
                                  className={template.favorite ? "text-yellow-500" : "text-muted-foreground"}
                                >
                                  <Star className={`h-4 w-4 ${template.favorite ? "fill-current" : ""}`} />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {template.favorite ? "즐겨찾기 해제" : "즐겨찾기"}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <Button variant="ghost" size="sm" onClick={() => loadTemplate(template)}>
                            불러오기
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteTemplate(template.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))
                )}
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>
        </div>
      </div>

      {/* Selection Panel */}
      <SelectionPanel
        selectedItems={selectedItems}
        onRemove={(id) => setSelectedItems((prev) => prev.filter((i) => i.id !== id))}
        onClear={clearSelection}
        onSaveTemplate={saveAsTemplate}
      />

      {/* Search Input - Conditional based on mode */}
      {activeTab === "urlanalysis" ? (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <LinkIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="분석할 URL을 입력하세요... (예: https://example.com/article)"
              value={analysisUrl}
              onChange={(e) => setAnalysisUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="pl-10"
            />
          </div>
          <Button onClick={handleSearch} disabled={urlAnalysisLoading}>
            {urlAnalysisLoading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Play className="h-4 w-4 mr-1" />
            )}
            분석
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="검색어를 입력하세요..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="flex-1"
            />
            <Button onClick={handleSearch} disabled={unifiedLoading || deepLoading}>
              {(unifiedLoading || deepLoading) ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Play className="h-4 w-4 mr-1" />
              )}
              검색
            </Button>
          </div>
          
          {/* Date range and filters - shown for unified/deep search */}
          {(activeTab === "unified" || activeTab === "deep") && (
            <AdvancedFilters
              filters={filters}
              onFiltersChange={setFilters}
              disabled={unifiedLoading || deepLoading}
              compact={true}
            />
          )}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as SearchMode)}>
        <TabsList className="grid w-full grid-cols-4">
          {(Object.keys(MODE_CONFIG) as SearchMode[]).map((mode) => {
            const config = MODE_CONFIG[mode];
            const Icon = config.icon;
            const count = mode === "unified" 
              ? unifiedResults.length 
              : mode === "deep" 
                ? (deepResults?.evidence?.length || 0) 
                : mode === "urlanalysis"
                  ? urlClaims.length
                  : 0; // factcheck tab uses embedded chatbot, no count needed
            return (
              <TabsTrigger key={mode} value={mode} className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{config.label}</span>
                {count > 0 && <Badge variant="secondary" className="ml-1">{count}</Badge>}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* Unified Search Tab */}
        <TabsContent value="unified" className="space-y-4">
          <Card className={`${MODE_CONFIG.unified.bgColor} border-none`}>
            <CardContent className="py-3">
              <div className="flex items-center gap-2 text-sm">
                <Search className={`h-4 w-4 ${MODE_CONFIG.unified.color}`} />
                <span className="text-muted-foreground">데이터베이스, 웹, AI를 동시에 검색합니다.</span>
                {unifiedLoading && <Loader2 className="h-4 w-4 animate-spin ml-auto" />}
                
                {/* Export buttons */}
                {unifiedResults.length > 0 && !unifiedLoading && (
                  <div className="ml-auto flex items-center gap-2">
                    <UnifiedExportMenu
                      jobId={unifiedJobId || undefined}
                      query={query}
                      reportType="UNIFIED_SEARCH"
                      aiContent={unifiedResults.find(r => r.source === 'ai')?.content || unifiedResults.find(r => r.source === 'ai')?.snippet || undefined}
                      data={unifiedResults.map(r => ({
                        id: r.id,
                        title: r.title,
                        url: r.url,
                        snippet: r.snippet,
                        content: r.content,
                        source: r.source,
                        sourceLabel: r.sourceLabel,
                        publishedAt: r.publishedAt,
                        reliabilityScore: r.reliabilityScore,
                        sentimentLabel: r.sentimentLabel,
                        biasLabel: r.biasLabel,
                        factcheckStatus: r.factcheckStatus,
                      }))}
                      exportOptions={{ filename: `NewsInsight_통합검색_${query}`, title: query }}
                      size="sm"
                      variant="outline"
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {unifiedError && (
            <div className="p-4 rounded-lg bg-destructive/10 text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {unifiedError}
            </div>
          )}

          <ScrollArea className="h-[500px]">
            <div className="space-y-3 pr-4">
              {unifiedResults.map((result) => (
                <UnifiedResultCard
                  key={result.id}
                  result={result}
                  isSelected={isSelected(result.id)}
                  onSelect={() =>
                    toggleSelection({
                      id: result.id,
                      type: "unified",
                      title: result.title,
                      url: result.url,
                      snippet: result.snippet,
                      source: result.source,
                    })
                  }
                  onViewDetail={() => {
                    setDetailItem({ type: "unified", data: result });
                    setDetailDialogOpen(true);
                  }}
                  hasProject={!!selectedProjectId}
                  onAddToProject={() => handleAddUnifiedToProject(result)}
                />
              ))}
              {!unifiedLoading && unifiedResults.length === 0 && !unifiedError && (
                <div className="text-center py-12 text-muted-foreground">
                  <Search className="h-12 w-12 mx-auto mb-4 opacity-30" />
                  <p>검색어를 입력하고 검색 버튼을 눌러주세요.</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Deep Search Tab - 심층 보고서 */}
        <TabsContent value="deep" className="space-y-4">
          {/* History toggle and info bar */}
          <Card className={`${MODE_CONFIG.deep.bgColor} border-none`}>
            <CardContent className="py-3">
              <div className="flex items-center gap-2 text-sm">
                <Brain className={`h-4 w-4 ${MODE_CONFIG.deep.color}`} />
                <span className="text-muted-foreground">AI가 주제에 대한 심층 분석 보고서를 생성합니다.</span>
                
                {/* History toggle button */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDeepHistory(!showDeepHistory)}
                  className="ml-auto gap-1"
                >
                  <History className="h-4 w-4" />
                  기록
                </Button>
                
                {deepLoading && (
                  <div className="flex items-center gap-2">
                    <Progress value={deepProgress} className="w-24 h-2" />
                    <span className="text-xs">{deepProgress}%</span>
                  </div>
                )}
                
                {/* Export buttons for Deep Search */}
                {deepResults && !deepLoading && deepJobId && (
                  <div className="flex items-center gap-2">
                    <UnifiedExportMenu
                      jobId={deepJobId}
                      query={query || deepResults.topic}
                      reportType="DEEP_SEARCH"
                      data={(deepResults.evidence || []).map(e => ({
                        id: String(e.id),
                        title: e.title || e.snippet.slice(0, 50),
                        url: e.url,
                        snippet: e.snippet,
                        content: e.snippet,
                        source: e.source || 'web',
                        stance: e.stance,
                      }))}
                      exportOptions={{ filename: `NewsInsight_심층보고서_${query || deepResults.topic}`, title: query || deepResults.topic }}
                      size="sm"
                      variant="outline"
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Deep Search History Panel */}
          {showDeepHistory && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <History className="h-4 w-4" />
                    Deep Search 기록
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={loadDeepSearchHistory}
                      disabled={deepHistoryLoading}
                    >
                      <RefreshCw className={`h-4 w-4 ${deepHistoryLoading ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowDeepHistory(false)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {deepHistoryLoading && deepHistoryJobs.length === 0 ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : deepHistoryJobs.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    아직 Deep Search 기록이 없습니다.
                  </div>
                ) : (
                  <ScrollArea className="max-h-[300px]">
                    <div className="space-y-2">
                      {deepHistoryJobs.map((job) => {
                        const statusConfig: Record<string, { label: string; color: string }> = {
                          COMPLETED: { label: "완료", color: "bg-green-500" },
                          IN_PROGRESS: { label: "진행 중", color: "bg-blue-500" },
                          PENDING: { label: "대기", color: "bg-yellow-500" },
                          FAILED: { label: "실패", color: "bg-red-500" },
                          CANCELLED: { label: "취소", color: "bg-gray-500" },
                          TIMEOUT: { label: "시간 초과", color: "bg-orange-500" },
                        };
                        const status = statusConfig[job.status] || { label: job.status, color: "bg-gray-500" };
                        
                        return (
                          <div
                            key={job.jobId}
                            className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                              job.status === 'COMPLETED' ? 'hover:bg-muted/50 cursor-pointer' : 'opacity-60'
                            }`}
                            onClick={() => job.status === 'COMPLETED' && loadDeepSearchFromHistory(job)}
                          >
                            <div className="flex-1 min-w-0 mr-4">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge className={`${status.color} text-white text-xs`}>
                                  {status.label}
                                </Badge>
                                {job.evidenceCount !== undefined && job.evidenceCount > 0 && (
                                  <Badge variant="outline" className="text-xs">
                                    {job.evidenceCount}개 증거
                                  </Badge>
                                )}
                              </div>
                              <h4 className="font-medium text-sm truncate">{job.topic}</h4>
                              <p className="text-xs text-muted-foreground">
                                {new Date(job.createdAt).toLocaleString('ko-KR')}
                                {job.completedAt && ` · 완료: ${new Date(job.completedAt).toLocaleTimeString('ko-KR')}`}
                              </p>
                              {job.errorMessage && (
                                <p className="text-xs text-destructive mt-1 truncate">
                                  {job.errorMessage}
                                </p>
                              )}
                            </div>
                            {job.status === 'COMPLETED' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  loadDeepSearchFromHistory(job);
                                }}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          )}

          {deepError && (
            <div className="p-4 rounded-lg bg-destructive/10 text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {deepError}
            </div>
          )}

          {/* 심층 보고서 결과 */}
          {deepResults && (
            <ScrollArea className="h-[500px]">
              <div className="space-y-4 pr-4">
                {/* 핵심 요약 */}
                <Card className="border-l-4 border-l-purple-500">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-purple-600" />
                      <CardTitle className="text-lg">핵심 요약</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      <strong>'{deepResults.topic}'</strong>에 대해 {deepResults.evidence?.length || 0}개의 출처를 분석했습니다.
                      {deepResults.evidence && deepResults.evidence.length > 0 && (
                        <> 다양한 관점의 자료를 수집하여 주제에 대한 종합적인 이해를 제공합니다.</>
                      )}
                    </p>
                  </CardContent>
                </Card>

                {/* 분석 개요 */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Database className="h-4 w-4" />
                      분석 개요
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div className="p-3 rounded-lg bg-muted/50">
                        <p className="text-2xl font-bold text-primary">{deepResults.evidence?.length || 0}</p>
                        <p className="text-xs text-muted-foreground">총 수집 자료</p>
                      </div>
                      <div className="p-3 rounded-lg bg-muted/50">
                        <p className="text-2xl font-bold text-green-600">
                          {new Set(deepResults.evidence?.map(e => e.source).filter(Boolean)).size || 0}
                        </p>
                        <p className="text-xs text-muted-foreground">참조 출처</p>
                      </div>
                      <div className="p-3 rounded-lg bg-muted/50">
                        <p className="text-2xl font-bold text-blue-600">
                          {deepResults.evidence?.filter(e => e.title).length || 0}
                        </p>
                        <p className="text-xs text-muted-foreground">기사/문서</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* 주요 발견사항 */}
                {deepResults.evidence && deepResults.evidence.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        주요 발견사항
                      </CardTitle>
                      <CardDescription>수집된 자료에서 추출한 핵심 정보</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {deepResults.evidence.slice(0, 5).map((evidence, index) => (
                        <div 
                          key={evidence.id} 
                          className="p-3 rounded-lg bg-muted/30 border-l-2 border-l-purple-400 hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="text-xs font-medium text-purple-600">#{index + 1}</span>
                                {evidence.sourceCategory && SOURCE_CATEGORY_CONFIG[evidence.sourceCategory] && (
                                  <Badge variant="secondary" className={`text-xs ${SOURCE_CATEGORY_CONFIG[evidence.sourceCategory].color}`}>
                                    {createElement(SOURCE_CATEGORY_CONFIG[evidence.sourceCategory].icon, { className: "h-3 w-3 mr-1" })}
                                    {SOURCE_CATEGORY_CONFIG[evidence.sourceCategory].label}
                                  </Badge>
                                )}
                                {evidence.source && (
                                  <Badge variant="outline" className="text-xs">
                                    {evidence.source}
                                  </Badge>
                                )}
                              </div>
                              {evidence.title && (
                                <h4 className="font-medium text-sm mb-1 line-clamp-1">{evidence.title}</h4>
                              )}
                              <p className="text-sm text-muted-foreground line-clamp-2">{evidence.snippet}</p>
                            </div>
                            <div className="flex gap-1">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      onClick={() => {
                                        setDetailItem({ type: "evidence", data: evidence });
                                        setDetailDialogOpen(true);
                                      }}
                                      className="p-1.5 rounded hover:bg-muted"
                                    >
                                      <Eye className="h-4 w-4 text-muted-foreground" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>상세 보기</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                              {evidence.url && (
                                <a
                                  href={evidence.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="p-1.5 rounded hover:bg-muted"
                                >
                                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                      {deepResults.evidence.length > 5 && (
                        <p className="text-xs text-muted-foreground text-center pt-2">
                          외 {deepResults.evidence.length - 5}개의 자료가 더 있습니다. PDF 보고서로 내보내기하여 전체 내용을 확인하세요.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* 출처 목록 */}
                {deepResults.evidence && deepResults.evidence.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Globe className="h-4 w-4" />
                        참조 출처
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {Array.from(new Set(deepResults.evidence.map(e => e.source).filter(Boolean))).slice(0, 8).map((source, index) => (
                          <div key={index} className="flex items-center gap-2 text-sm">
                            <CheckCircle2 className="h-3 w-3 text-green-500" />
                            <span className="text-muted-foreground">{source}</span>
                            <Badge variant="secondary" className="text-xs ml-auto">
                              {deepResults.evidence?.filter(e => e.source === source).length}건
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* 결론 */}
                <Card className="border-l-4 border-l-green-500">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      결론
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      '{deepResults.topic}'에 대한 심층 분석 결과, {deepResults.evidence?.length || 0}개의 관련 자료를 수집했습니다.
                      {deepResults.evidence && deepResults.evidence.length > 0 ? (
                        <> 수집된 자료들은 다양한 출처에서 제공되었으며, 주제에 대한 폭넓은 관점을 제공합니다. 
                        보다 자세한 내용은 PDF 보고서로 내보내기하여 확인하실 수 있습니다.</>
                      ) : (
                        <> 추가적인 검색어나 다른 관점에서의 분석을 시도해보시기 바랍니다.</>
                      )}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>
          )}

          {/* 초기 상태 */}
          {!deepLoading && !deepJobId && !deepResults && !deepError && (
            <div className="text-center py-12 text-muted-foreground">
              <Brain className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>검색어를 입력하고 심층 보고서를 생성해보세요.</p>
              <p className="text-xs mt-1">AI가 주제에 대한 심층 분석을 수행하며 2-5분 정도 소요됩니다.</p>
            </div>
          )}
          {!deepLoading && deepResults && deepResults.evidence?.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Brain className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>분석 결과가 없습니다.</p>
              <p className="text-xs mt-1">다른 검색어로 다시 시도해보세요.</p>
            </div>
          )}
        </TabsContent>

        {/* Fact Check Tab - Using Embedded Chatbot */}
        <TabsContent value="factcheck" className="space-y-4">
          <Card className={`${MODE_CONFIG.factcheck.bgColor} border-none`}>
            <CardContent className="py-3">
              <div className="flex items-center gap-2 text-sm">
                <Shield className={`h-4 w-4 ${MODE_CONFIG.factcheck.color}`} />
                <span className="text-muted-foreground">
                  AI 챗봇과 대화하며 주장이나 뉴스의 사실 여부를 검증합니다.
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Embedded FactCheck Chatbot */}
          <FactCheckChatbot
            ref={factCheckChatbotRef}
            compact={true}
            hideHeader={false}
            heightClass="h-[500px]"
            initialClaims={pendingFactCheckClaims.length > 0 ? pendingFactCheckClaims : undefined}
          />
        </TabsContent>

        {/* URL Analysis Tab */}
        <TabsContent value="urlanalysis" className="space-y-4">
          <Card className={`${MODE_CONFIG.urlanalysis.bgColor} border-none`}>
            <CardContent className="py-3">
              <div className="flex items-center gap-2 text-sm">
                <LinkIcon className={`h-4 w-4 ${MODE_CONFIG.urlanalysis.color}`} />
                <span className="text-muted-foreground">
                  뉴스 기사나 웹 페이지의 URL을 입력하면 AI가 검증 가능한 주장을 추출합니다.
                </span>
              </div>
            </CardContent>
          </Card>

          {urlAnalysisError && (
            <div className="p-4 rounded-lg bg-destructive/10 text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {urlAnalysisError}
            </div>
          )}

          {/* URL Analysis Results */}
          {urlPageTitle && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">{urlPageTitle}</CardTitle>
                </div>
                <CardDescription className="truncate">{analysisUrl}</CardDescription>
              </CardHeader>
            </Card>
          )}

          {urlClaims.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">추출된 주장 ({urlClaims.length})</CardTitle>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => selectAllUrlClaims(true)}
                    >
                      전체 선택
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => selectAllUrlClaims(false)}
                    >
                      전체 해제
                    </Button>
                    <Button
                      size="sm"
                      onClick={transferToFactCheck}
                      disabled={!urlClaims.some((c) => c.selected)}
                    >
                      <Shield className="h-4 w-4 mr-1" />
                      팩트체크로 전송
                    </Button>
                  </div>
                </div>
                <CardDescription>
                  팩트체크할 주장을 선택하세요. 선택한 주장은 팩트체크 탭으로 전송됩니다.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  <div className="space-y-3 pr-4">
                    {urlClaims.map((claim) => (
                      <Card
                        key={claim.id}
                        className={`cursor-pointer transition-all hover:shadow-md ${
                          claim.selected
                            ? "border-primary ring-2 ring-primary/30"
                            : "border-transparent"
                        }`}
                        onClick={() => toggleUrlClaimSelection(claim.id)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            <Checkbox
                              checked={claim.selected}
                              onCheckedChange={() => toggleUrlClaimSelection(claim.id)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge
                                  variant="outline"
                                  className={
                                    claim.confidence >= 0.8
                                      ? "text-green-600 border-green-300"
                                      : claim.confidence >= 0.5
                                        ? "text-yellow-600 border-yellow-300"
                                        : "text-orange-600 border-orange-300"
                                  }
                                >
                                  신뢰도 {Math.round(claim.confidence * 100)}%
                                </Badge>
                              </div>
                              <p className="text-sm font-medium">{claim.text}</p>
                              {claim.context && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                  {claim.context}
                                </p>
                              )}
                            </div>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleSelection({
                                        id: `urlclaim_${claim.id}`,
                                        type: "urlclaim",
                                        title: claim.text.slice(0, 50) + (claim.text.length > 50 ? "..." : ""),
                                        snippet: claim.text,
                                        url: analysisUrl,
                                      });
                                    }}
                                    className={`p-2 rounded-md transition-colors ${
                                      isSelected(`urlclaim_${claim.id}`)
                                        ? "bg-primary text-primary-foreground"
                                        : "hover:bg-muted text-muted-foreground"
                                    }`}
                                  >
                                    <Pin className="h-4 w-4" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {isSelected(`urlclaim_${claim.id}`) ? "선택 해제" : "템플릿에 추가"}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {!urlAnalysisLoading && urlClaims.length === 0 && !urlAnalysisError && (
            <div className="text-center py-12 text-muted-foreground">
              <LinkIcon className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>분석할 URL을 입력하고 분석 버튼을 눌러주세요.</p>
              <p className="text-xs mt-1">
                AI가 웹 페이지를 분석하여 검증 가능한 주장을 추출합니다.
              </p>
            </div>
          )}

          {urlAnalysisLoading && (
            <div className="text-center py-12">
              <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-muted-foreground" />
              <p className="text-muted-foreground">URL을 분석하고 있습니다...</p>
              <p className="text-xs text-muted-foreground mt-1">
                페이지 크기에 따라 시간이 소요될 수 있습니다.
              </p>
            </div>
          )}

          {/* Priority URLs for reference */}
          <PriorityUrlEditor
            storageKey="smartsearch-priority-urls"
            urls={priorityUrls}
            onUrlsChange={setPriorityUrls}
            disabled={urlAnalysisLoading}
            title="참고 URL"
            description="팩트체크 시 우선적으로 참고할 신뢰 URL을 추가하세요."
            defaultCollapsed={true}
          />
        </TabsContent>
      </Tabs>

      {/* Tip Banner */}
      <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 text-sm">
        <Zap className="h-4 w-4 text-yellow-500 shrink-0" />
        <span className="text-muted-foreground">
          <strong>Tip:</strong> 각 결과 카드의 <Pin className="h-3 w-3 inline mx-1" /> 버튼을 눌러 항목을 선택하고, 
          상단의 "선택한 항목" 패널에서 템플릿으로 저장할 수 있습니다.
        </span>
      </div>

      {/* Detail View Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {detailItem?.type === "unified" && (() => {
            const result = detailItem.data as UnifiedSearchResult;
            const sourceConfig = SOURCE_CONFIG[result.source] || SOURCE_CONFIG.web;
            const SourceIcon = sourceConfig.icon;
            return (
              <>
                <DialogHeader>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className={`${sourceConfig.color} flex items-center gap-1`}>
                      <SourceIcon className="h-3 w-3" />
                      {result.sourceLabel || sourceConfig.label}
                    </Badge>
                    {result.publishedAt && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(result.publishedAt).toLocaleDateString("ko-KR")}
                      </span>
                    )}
                  </div>
                  <DialogTitle className="text-lg">{result.title}</DialogTitle>
                  {result.url && (
                    <DialogDescription className="break-all">
                      <a href={result.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-1">
                        {result.url}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </DialogDescription>
                  )}
                </DialogHeader>
                <div className="mt-4 space-y-4">
                  {result.source === "ai" ? (
                    <div>
                      {/* Summary Section */}
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="font-medium text-sm">요약</h4>
                        {aiReportLoading && (
                          <span className="text-xs text-muted-foreground animate-pulse">
                            (DB에서 불러오는 중...)
                          </span>
                        )}
                      </div>
                      <div className="bg-muted/30 rounded-lg p-3">
                        {aiReportSummary ? (
                          <MarkdownRenderer content={aiReportSummary} isStreaming={false} />
                        ) : aiReportLoading ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <div className="h-4 w-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
                            불러오는 중...
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">요약 섹션이 없습니다.</p>
                        )}
                      </div>

                      {/* Full Content Section */}
                      <h4 className="font-medium text-sm mt-4 mb-2">전체 내용</h4>
                      <div className="bg-white/70 dark:bg-black/30 rounded-lg border p-4 max-h-[50vh] overflow-y-auto">
                        {aiReportError && (
                          <p className="text-sm text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-1">
                            <span className="shrink-0">!</span> 
                            DB 조회 실패 - SSE 데이터를 표시합니다
                          </p>
                        )}
                        {aiReportContent ? (
                          <MarkdownRenderer content={aiReportContent} isStreaming={false} />
                        ) : aiReportLoading ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <div className="h-4 w-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
                            불러오는 중...
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">내용이 없습니다.</p>
                        )}
                      </div>
                    </div>
                  ) : result.content ? (
                    <div>
                      <h4 className="font-medium text-sm mb-2">전체 내용</h4>
                      <div className="bg-white/70 dark:bg-black/30 rounded-lg border p-4 max-h-[50vh] overflow-y-auto">
                        <MarkdownRenderer content={result.content} isStreaming={false} />
                      </div>
                    </div>
                  ) : result.snippet ? (
                    <div>
                      <h4 className="font-medium text-sm mb-2">내용</h4>
                      <div className="bg-muted/30 rounded-lg p-3">
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{result.snippet}</p>
                      </div>
                    </div>
                  ) : null}
                  {(() => {
                    const author = (result as unknown as { author?: unknown })?.author;
                    if (typeof author !== "string" || !author) return null;
                    return (
                      <div>
                        <h4 className="font-medium text-sm mb-1">작성자</h4>
                        <p className="text-sm text-muted-foreground">{author}</p>
                      </div>
                    );
                  })()}
                </div>
              </>
            );
          })()}
          
          {detailItem?.type === "evidence" && (() => {
            const evidence = detailItem.data as Evidence;
            const stanceConfig = STANCE_CONFIG[evidence.stance] || STANCE_CONFIG.neutral;
            const StanceIcon = stanceConfig.icon;
            return (
              <>
                <DialogHeader>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className={`${stanceConfig.color} flex items-center gap-1`}>
                      <StanceIcon className="h-3 w-3" />
                      {stanceConfig.label}
                    </Badge>
                    {evidence.source && (
                      <span className="text-xs text-muted-foreground">{evidence.source}</span>
                    )}
                  </div>
                  <DialogTitle className="text-lg">{evidence.title || "증거 자료"}</DialogTitle>
                  {evidence.url && (
                    <DialogDescription className="break-all">
                      <a href={evidence.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-1">
                        {evidence.url}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </DialogDescription>
                  )}
                </DialogHeader>
                <div className="mt-4 space-y-4">
                  <div>
                    <h4 className="font-medium text-sm mb-2">전체 내용</h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{evidence.snippet}</p>
                  </div>
                  {(() => {
                    const relevance = (evidence as unknown as { relevance?: unknown })?.relevance;
                    if (typeof relevance !== "number") return null;
                    return (
                      <div>
                        <h4 className="font-medium text-sm mb-1">관련도</h4>
                        <Progress value={relevance * 100} className="h-2" />
                        <span className="text-xs text-muted-foreground">{Math.round(relevance * 100)}%</span>
                      </div>
                    );
                  })()}
                </div>
              </>
            );
          })()}
          
          {detailItem?.type === "verification" && (() => {
            const result = detailItem.data as VerificationResult;
            const config = VERIFICATION_CONFIG[result.status] || VERIFICATION_CONFIG.UNVERIFIED;
            const StatusIcon = config.icon;
            return (
              <>
                <DialogHeader>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className={`${config.bgColor} ${config.color} border-none`}>
                      <StatusIcon className="h-3 w-3 mr-1" />
                      {config.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      신뢰도: {Math.round(result.confidenceScore * 100)}%
                    </span>
                  </div>
                  <DialogTitle className="text-lg">팩트체크 결과</DialogTitle>
                </DialogHeader>
                <div className="mt-4 space-y-4">
                  <div>
                    <h4 className="font-medium text-sm mb-2">원본 주장</h4>
                    <p className="text-sm p-3 bg-muted rounded-lg">{result.originalClaim}</p>
                  </div>
                  <div>
                    <h4 className="font-medium text-sm mb-2">검증 요약</h4>
                    <p className="text-sm text-muted-foreground">{result.verificationSummary}</p>
                  </div>
                  {result.supportingEvidence.length > 0 && (
                    <div>
                      <h4 className="font-medium text-sm mb-2 text-green-600">지지 근거 ({result.supportingEvidence.length})</h4>
                      <div className="space-y-2">
                        {result.supportingEvidence.map((e, i) => (
                          <div key={i} className="text-sm p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border-l-2 border-green-400">
                            <p className="font-medium text-xs text-green-700 mb-1">{e.sourceName}</p>
                            <p className="text-muted-foreground">{e.excerpt}</p>
                            {e.url && (
                              <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline mt-1 inline-flex items-center gap-1">
                                출처 보기 <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {result.contradictingEvidence.length > 0 && (
                    <div>
                      <h4 className="font-medium text-sm mb-2 text-red-600">반박 근거 ({result.contradictingEvidence.length})</h4>
                      <div className="space-y-2">
                        {result.contradictingEvidence.map((e, i) => (
                          <div key={i} className="text-sm p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border-l-2 border-red-400">
                            <p className="font-medium text-xs text-red-700 mb-1">{e.sourceName}</p>
                            <p className="text-muted-foreground">{e.excerpt}</p>
                            {e.url && (
                              <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline mt-1 inline-flex items-center gap-1">
                                출처 보기 <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
