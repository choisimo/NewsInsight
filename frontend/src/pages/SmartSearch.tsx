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

import { useState, useCallback, useRef, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
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
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { useToast } from "@/hooks/use-toast";
import {
  startUnifiedSearchJob,
  openUnifiedSearchJobStream,
  startDeepSearch,
  getDeepSearchStatus,
  getDeepSearchResult,
  openDeepAnalysisStream,
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
  type UnifiedSearchResult,
  type Evidence,
  type DeepSearchResult,
  type DeepSearchJob,
  type SearchTemplate as ApiSearchTemplate,
} from "@/lib/api";
import { useDeepSearchSSE } from "@/hooks/useDeepSearchSSE";
import { PriorityUrlEditor, type PriorityUrl } from "@/components/PriorityUrlEditor";

// ============================================
// Types
// ============================================

type SearchMode = "unified" | "deep" | "factcheck" | "urlanalysis";

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
    label: "Deep Search",
    description: "AI 기반 심층 증거 수집",
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
  pro: { label: "찬성", icon: ThumbsUp, color: "text-teal-600", bgColor: "bg-teal-100 dark:bg-teal-900/30" },
  con: { label: "반대", icon: ThumbsDown, color: "text-red-600", bgColor: "bg-red-100 dark:bg-red-900/30" },
  neutral: { label: "중립", icon: Minus, color: "text-gray-600", bgColor: "bg-gray-100 dark:bg-gray-800" },
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
}

const UnifiedResultCard = ({ result, isSelected, onSelect }: UnifiedResultCardProps) => {
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
            {result.snippet && (
              <p className="text-sm text-muted-foreground line-clamp-2">{result.snippet}</p>
            )}
          </div>
          <div className="flex flex-col gap-1">
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
}

const EvidenceCard = ({ evidence, isSelected, onSelect }: EvidenceCardProps) => {
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

interface VerificationCardProps {
  result: VerificationResult;
  isSelected: boolean;
  onSelect: () => void;
}

const VerificationCard = ({ result, isSelected, onSelect }: VerificationCardProps) => {
  const config = VERIFICATION_CONFIG[result.status] || VERIFICATION_CONFIG.UNVERIFIED;
  const StatusIcon = config.icon;
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className={`${config.bgColor} border-l-4 ${isSelected ? "border-l-primary ring-2 ring-primary/30" : config.color.replace("text-", "border-l-")} transition-all`}>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <Badge className={`${config.bgColor} ${config.color} border-none`}>
                  <StatusIcon className="h-3 w-3 mr-1" />
                  {config.label}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  신뢰도: {Math.round(result.confidenceScore * 100)}%
                </span>
              </div>
              <p className="font-medium text-sm mb-1">{result.originalClaim}</p>
              <p className="text-sm text-muted-foreground">{result.verificationSummary}</p>
            </div>
            <div className="flex flex-col gap-1">
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
              {(result.supportingEvidence.length > 0 || result.contradictingEvidence.length > 0) && (
                <CollapsibleTrigger asChild>
                  <button className="p-2 rounded-md hover:bg-muted transition-colors">
                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                </CollapsibleTrigger>
              )}
            </div>
          </div>
          <CollapsibleContent className="mt-3 pt-3 border-t space-y-2">
            {result.supportingEvidence.length > 0 && (
              <div>
                <p className="text-xs font-medium text-green-600 mb-1">지지 근거 ({result.supportingEvidence.length})</p>
                {result.supportingEvidence.slice(0, 2).map((e, i) => (
                  <div key={i} className="text-xs text-muted-foreground pl-2 border-l-2 border-green-400 mb-1">
                    {e.excerpt.slice(0, 100)}...
                  </div>
                ))}
              </div>
            )}
            {result.contradictingEvidence.length > 0 && (
              <div>
                <p className="text-xs font-medium text-red-600 mb-1">반박 근거 ({result.contradictingEvidence.length})</p>
                {result.contradictingEvidence.slice(0, 2).map((e, i) => (
                  <div key={i} className="text-xs text-muted-foreground pl-2 border-l-2 border-red-400 mb-1">
                    {e.excerpt.slice(0, 100)}...
                  </div>
                ))}
              </div>
            )}
          </CollapsibleContent>
        </CardContent>
      </Collapsible>
    </Card>
  );
};

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
  const [searchParams, setSearchParams] = useSearchParams();

  // Get initial mode from URL params (for backward compatibility redirects)
  const getInitialMode = (): SearchMode => {
    const modeParam = searchParams.get("mode");
    if (modeParam === "deep" || modeParam === "factcheck" || modeParam === "unified" || modeParam === "urlanalysis") {
      return modeParam;
    }
    return "unified";
  };

  // State
  const [activeTab, setActiveTab] = useState<SearchMode>(getInitialMode);
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [templates, setTemplates] = useState<SearchTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateFilter, setTemplateFilter] = useState<"all" | "favorites" | "recent" | "mostUsed">("all");
  const [templateSearchQuery, setTemplateSearchQuery] = useState("");

  // Unified Search State
  const [unifiedResults, setUnifiedResults] = useState<UnifiedSearchResult[]>([]);
  const [unifiedLoading, setUnifiedLoading] = useState(false);
  const [unifiedError, setUnifiedError] = useState<string | null>(null);
  const unifiedEventSourceRef = useRef<EventSource | null>(null);

  // Deep Search State
  const [deepJobId, setDeepJobId] = useState<string | null>(null);
  const [deepResults, setDeepResults] = useState<DeepSearchResult | null>(null);
  const [deepLoading, setDeepLoading] = useState(false);
  const [deepError, setDeepError] = useState<string | null>(null);
  const [deepProgress, setDeepProgress] = useState(0);

  // FactCheck State
  const [claims, setClaims] = useState<string[]>([""]);
  const [factCheckResults, setFactCheckResults] = useState<VerificationResult[]>([]);
  const [factCheckLoading, setFactCheckLoading] = useState(false);
  const [factCheckError, setFactCheckError] = useState<string | null>(null);

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
    enabled: !!deepJobId && deepLoading,
    onComplete: (result) => {
      setDeepResults(result);
      setDeepLoading(false);
      setDeepProgress(100);
    },
    onError: (error) => {
      setDeepError(error);
      setDeepLoading(false);
    },
    onProgress: (progress) => {
      setDeepProgress(progress);
    },
  });

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
                  await createSearchTemplate({
                    name: t.name,
                    query: t.query,
                    mode: t.mode,
                    items: t.items,
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
      const created = await createSearchTemplate({
        name,
        query,
        mode: activeTab,
        items: selectedItems.map((item) => ({
          id: item.id,
          type: item.type,
          title: item.title,
          url: item.url,
          snippet: item.snippet,
          source: item.source,
          stance: item.stance,
          verificationStatus: item.verificationStatus,
          addedAt: item.addedAt,
        })),
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
      const job = await startUnifiedSearchJob(query, "7d");
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
  }, [query]);

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

  // Fact Check
  const runFactCheck = useCallback(async () => {
    const validClaims = claims.filter((c) => c.trim());
    if (validClaims.length === 0) return;

    setFactCheckLoading(true);
    setFactCheckError(null);
    setFactCheckResults([]);

    try {
      const response = await openDeepAnalysisStream(query || "Fact Check", validClaims);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.eventType === "verification" && data.verificationResult) {
                setFactCheckResults((prev) => [...prev, data.verificationResult]);
              } else if (data.eventType === "error") {
                setFactCheckError(data.message || "검증 중 오류 발생");
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }

      setFactCheckLoading(false);
    } catch (e) {
      setFactCheckError(e instanceof Error ? e.message : "팩트체크 실패");
      setFactCheckLoading(false);
    }
  }, [query, claims]);

  // Claim management
  const addClaim = () => setClaims((prev) => [...prev, ""]);
  const removeClaim = (index: number) => setClaims((prev) => prev.filter((_, i) => i !== index));
  const updateClaim = (index: number, value: string) => {
    setClaims((prev) => prev.map((c, i) => (i === index ? value : c)));
  };

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

  // Transfer selected URL claims to fact check
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
    setClaims(selectedClaims);
    setActiveTab("factcheck");
    toast({
      title: "주장이 전송되었습니다",
      description: `${selectedClaims.length}개의 주장이 팩트체크 탭으로 전송되었습니다.`,
    });
  }, [urlClaims, toast]);

  // Handle search based on active tab
  const handleSearch = () => {
    if (activeTab === "unified") runUnifiedSearch();
    else if (activeTab === "deep") runDeepSearch();
    else if (activeTab === "factcheck") runFactCheck();
    else if (activeTab === "urlanalysis") runUrlAnalysis();
  };

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
        <div className="flex gap-2">
          <Input
            placeholder="검색어를 입력하세요..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="flex-1"
          />
          <Button onClick={handleSearch} disabled={unifiedLoading || deepLoading || factCheckLoading}>
            {(unifiedLoading || deepLoading || factCheckLoading) ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Play className="h-4 w-4 mr-1" />
            )}
            검색
          </Button>
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
                : mode === "factcheck"
                  ? factCheckResults.length
                  : urlClaims.length;
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

        {/* Deep Search Tab */}
        <TabsContent value="deep" className="space-y-4">
          <Card className={`${MODE_CONFIG.deep.bgColor} border-none`}>
            <CardContent className="py-3">
              <div className="flex items-center gap-2 text-sm">
                <Brain className={`h-4 w-4 ${MODE_CONFIG.deep.color}`} />
                <span className="text-muted-foreground">AI가 심층적으로 증거를 수집하고 분석합니다.</span>
                {deepLoading && (
                  <div className="ml-auto flex items-center gap-2">
                    <Progress value={deepProgress} className="w-24 h-2" />
                    <span className="text-xs">{deepProgress}%</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {deepError && (
            <div className="p-4 rounded-lg bg-destructive/10 text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {deepError}
            </div>
          )}

          {deepResults?.stanceDistribution && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">입장 분포</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-1 h-6 rounded overflow-hidden mb-2">
                  {deepResults.stanceDistribution.proRatio > 0 && (
                    <div className="bg-teal-500 text-white text-xs flex items-center justify-center" style={{ width: `${deepResults.stanceDistribution.proRatio}%` }}>
                      {deepResults.stanceDistribution.proRatio >= 15 && `${Math.round(deepResults.stanceDistribution.proRatio)}%`}
                    </div>
                  )}
                  {deepResults.stanceDistribution.neutralRatio > 0 && (
                    <div className="bg-gray-400 text-white text-xs flex items-center justify-center" style={{ width: `${deepResults.stanceDistribution.neutralRatio}%` }}>
                      {deepResults.stanceDistribution.neutralRatio >= 15 && `${Math.round(deepResults.stanceDistribution.neutralRatio)}%`}
                    </div>
                  )}
                  {deepResults.stanceDistribution.conRatio > 0 && (
                    <div className="bg-red-500 text-white text-xs flex items-center justify-center" style={{ width: `${deepResults.stanceDistribution.conRatio}%` }}>
                      {deepResults.stanceDistribution.conRatio >= 15 && `${Math.round(deepResults.stanceDistribution.conRatio)}%`}
                    </div>
                  )}
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span className="text-teal-600">찬성 {deepResults.stanceDistribution.pro}</span>
                  <span>중립 {deepResults.stanceDistribution.neutral}</span>
                  <span className="text-red-600">반대 {deepResults.stanceDistribution.con}</span>
                </div>
              </CardContent>
            </Card>
          )}

          <ScrollArea className="h-[400px]">
            <div className="space-y-3 pr-4">
              {deepResults?.evidence?.map((evidence) => (
                <EvidenceCard
                  key={evidence.id}
                  evidence={evidence}
                  isSelected={isSelected(`evidence_${evidence.id}`)}
                  onSelect={() =>
                    toggleSelection({
                      id: `evidence_${evidence.id}`,
                      type: "evidence",
                      title: evidence.title || evidence.snippet.slice(0, 50),
                      url: evidence.url,
                      snippet: evidence.snippet,
                      stance: STANCE_CONFIG[evidence.stance]?.label,
                    })
                  }
                />
              ))}
              {!deepLoading && (!deepResults || deepResults.evidence?.length === 0) && !deepError && (
                <div className="text-center py-12 text-muted-foreground">
                  <Brain className="h-12 w-12 mx-auto mb-4 opacity-30" />
                  <p>검색어를 입력하고 Deep Search를 시작해보세요.</p>
                  <p className="text-xs mt-1">AI가 심층 분석을 수행하며 2-5분 정도 소요됩니다.</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Fact Check Tab */}
        <TabsContent value="factcheck" className="space-y-4">
          <Card className={`${MODE_CONFIG.factcheck.bgColor} border-none`}>
            <CardContent className="py-3">
              <div className="flex items-center gap-2 text-sm">
                <Shield className={`h-4 w-4 ${MODE_CONFIG.factcheck.color}`} />
                <span className="text-muted-foreground">주장을 입력하면 신뢰할 수 있는 출처와 대조하여 검증합니다.</span>
              </div>
            </CardContent>
          </Card>

          {/* Claims Input */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">검증할 주장</CardTitle>
              <CardDescription>확인하고 싶은 주장을 입력하세요.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {claims.map((claim, index) => (
                <div key={index} className="flex gap-2">
                  <Textarea
                    placeholder={`주장 ${index + 1}`}
                    value={claim}
                    onChange={(e) => updateClaim(index, e.target.value)}
                    className="flex-1 min-h-[60px]"
                  />
                  {claims.length > 1 && (
                    <Button variant="ghost" size="icon" onClick={() => removeClaim(index)}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addClaim}>
                <Plus className="h-4 w-4 mr-1" />
                주장 추가
              </Button>
            </CardContent>
          </Card>

          {factCheckError && (
            <div className="p-4 rounded-lg bg-destructive/10 text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {factCheckError}
            </div>
          )}

          <ScrollArea className="h-[350px]">
            <div className="space-y-3 pr-4">
              {factCheckResults.map((result) => (
                <VerificationCard
                  key={result.claimId}
                  result={result}
                  isSelected={isSelected(`factcheck_${result.claimId}`)}
                  onSelect={() =>
                    toggleSelection({
                      id: `factcheck_${result.claimId}`,
                      type: "factcheck",
                      title: result.originalClaim,
                      snippet: result.verificationSummary,
                      verificationStatus: result.status,
                    })
                  }
                />
              ))}
              {!factCheckLoading && factCheckResults.length === 0 && !factCheckError && (
                <div className="text-center py-12 text-muted-foreground">
                  <Shield className="h-12 w-12 mx-auto mb-4 opacity-30" />
                  <p>검증할 주장을 입력하고 검색 버튼을 눌러주세요.</p>
                </div>
              )}
            </div>
          </ScrollArea>
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
    </div>
  );
}
