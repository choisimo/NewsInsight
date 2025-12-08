import { useState, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  X,
  Link as LinkIcon,
  FolderOpen,
  Shield,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  GripVertical,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";

// Types
export interface PriorityUrl {
  id: string;
  url: string;
  name: string;
  reliability?: "high" | "medium" | "low" | "unknown";
}

interface PriorityUrlEditorProps {
  /** Storage key for sessionStorage */
  storageKey: string;
  /** Current priority URLs */
  urls: PriorityUrl[];
  /** Callback when URLs change */
  onUrlsChange: (urls: PriorityUrl[]) => void;
  /** Whether the editor is disabled */
  disabled?: boolean;
  /** Maximum number of URLs allowed */
  maxUrls?: number;
  /** Title for the card */
  title?: string;
  /** Description for the card */
  description?: string;
  /** Whether to show in collapsed mode initially */
  defaultCollapsed?: boolean;
  /** Custom class name */
  className?: string;
}

// Known reliable domains
const HIGH_RELIABILITY_DOMAINS = [
  "wikipedia.org",
  "namu.wiki",
  "britannica.com",
  "scholar.google.com",
  "pubmed.ncbi.nlm.nih.gov",
  "nature.com",
  "science.org",
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "bbc.co.uk",
  "nytimes.com",
  "washingtonpost.com",
  "theguardian.com",
  "gov.kr",
  "korea.kr",
  "bok.or.kr",
  "kosis.kr",
  "kostat.go.kr",
];

const MEDIUM_RELIABILITY_DOMAINS = [
  "yonhapnews.co.kr",
  "chosun.com",
  "donga.com",
  "joongang.co.kr",
  "hani.co.kr",
  "khan.co.kr",
  "kmib.co.kr",
  "mk.co.kr",
  "mt.co.kr",
  "hankyung.com",
  "yna.co.kr",
  "kbs.co.kr",
  "mbc.co.kr",
  "sbs.co.kr",
  "jtbc.co.kr",
  "cnn.com",
  "forbes.com",
  "bloomberg.com",
];

function getReliabilityFromUrl(url: string): PriorityUrl["reliability"] {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    
    // Check high reliability
    if (HIGH_RELIABILITY_DOMAINS.some((d) => hostname.includes(d))) {
      return "high";
    }
    
    // Check medium reliability
    if (MEDIUM_RELIABILITY_DOMAINS.some((d) => hostname.includes(d))) {
      return "medium";
    }
    
    // Government or educational domains
    if (hostname.endsWith(".gov") || hostname.endsWith(".edu") || hostname.endsWith(".ac.kr") || hostname.endsWith(".go.kr")) {
      return "high";
    }
    
    return "unknown";
  } catch {
    return "unknown";
  }
}

function generateUrlId(): string {
  return `url_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

const ReliabilityBadge = ({ reliability }: { reliability: PriorityUrl["reliability"] }) => {
  switch (reliability) {
    case "high":
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800">
                <Shield className="h-3 w-3 mr-1" />
                신뢰
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>높은 신뢰도: 공식 기관, 학술 사이트</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    case "medium":
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800">
                <Shield className="h-3 w-3 mr-1" />
                보통
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>일반 신뢰도: 주요 언론사</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    case "low":
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800">
                <AlertTriangle className="h-3 w-3 mr-1" />
                주의
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>낮은 신뢰도: 검증 필요</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    default:
      return null;
  }
};

export const PriorityUrlEditor = ({
  storageKey,
  urls,
  onUrlsChange,
  disabled = false,
  maxUrls = 10,
  title = "참고 URL",
  description = "분석 시 우선적으로 참고할 URL을 추가하세요.",
  defaultCollapsed = false,
  className = "",
}: PriorityUrlEditorProps) => {
  const { toast } = useToast();
  const [newUrl, setNewUrl] = useState("");
  const [isExpanded, setIsExpanded] = useState(!defaultCollapsed);
  const [isAdding, setIsAdding] = useState(false);

  // Persist to sessionStorage when URLs change
  useEffect(() => {
    if (urls.length > 0) {
      sessionStorage.setItem(storageKey, JSON.stringify(urls));
    } else {
      sessionStorage.removeItem(storageKey);
    }
  }, [urls, storageKey]);

  // Validate URL
  const isValidUrl = useCallback((url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }, []);

  // Add new URL
  const handleAddUrl = useCallback(() => {
    const trimmedUrl = newUrl.trim();
    
    if (!trimmedUrl) {
      toast({
        title: "URL을 입력하세요",
        variant: "destructive",
      });
      return;
    }

    // Add https:// if missing protocol
    let urlToAdd = trimmedUrl;
    if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")) {
      urlToAdd = `https://${trimmedUrl}`;
    }

    if (!isValidUrl(urlToAdd)) {
      toast({
        title: "유효하지 않은 URL입니다",
        description: "올바른 URL 형식을 입력하세요.",
        variant: "destructive",
      });
      return;
    }

    // Check for duplicates
    if (urls.some((u) => u.url === urlToAdd)) {
      toast({
        title: "이미 추가된 URL입니다",
        variant: "destructive",
      });
      return;
    }

    // Check max limit
    if (urls.length >= maxUrls) {
      toast({
        title: `최대 ${maxUrls}개까지 추가할 수 있습니다`,
        variant: "destructive",
      });
      return;
    }

    const hostname = getHostname(urlToAdd);
    const newPriorityUrl: PriorityUrl = {
      id: generateUrlId(),
      url: urlToAdd,
      name: hostname,
      reliability: getReliabilityFromUrl(urlToAdd),
    };

    onUrlsChange([...urls, newPriorityUrl]);
    setNewUrl("");
    setIsAdding(false);

    toast({
      title: "URL이 추가되었습니다",
      description: hostname,
    });
  }, [newUrl, urls, maxUrls, isValidUrl, onUrlsChange, toast]);

  // Remove URL
  const handleRemoveUrl = useCallback((id: string) => {
    onUrlsChange(urls.filter((u) => u.id !== id));
  }, [urls, onUrlsChange]);

  // Clear all URLs
  const handleClearAll = useCallback(() => {
    onUrlsChange([]);
    toast({
      title: "모든 URL이 제거되었습니다",
    });
  }, [onUrlsChange, toast]);

  // Handle Enter key
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddUrl();
    }
    if (e.key === "Escape") {
      setIsAdding(false);
      setNewUrl("");
    }
  }, [handleAddUrl]);

  // Empty state - show add button only
  if (urls.length === 0 && !isAdding) {
    return (
      <Card className={`border-dashed border-2 border-muted-foreground/20 ${className}`}>
        <CardContent className="py-6">
          <div className="text-center">
            <FolderOpen className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground mb-4">{description}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsAdding(true)}
              disabled={disabled}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              URL 추가
            </Button>
          </div>
          
          {isAdding && (
            <div className="mt-4 flex gap-2">
              <Input
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="https://example.com"
                autoFocus
                disabled={disabled}
                className="flex-1"
              />
              <Button
                size="sm"
                onClick={handleAddUrl}
                disabled={disabled || !newUrl.trim()}
              >
                추가
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIsAdding(false);
                  setNewUrl("");
                }}
              >
                취소
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10 ${className}`}>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5 text-blue-600" />
              <CardTitle className="text-lg">{title}</CardTitle>
              <Badge variant="secondary">{urls.length}개</Badge>
            </div>
            <div className="flex items-center gap-1">
              {urls.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearAll}
                  disabled={disabled}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4 mr-1" />
                  모두 제거
                </Button>
              )}
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm">
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="pt-0">
            {/* URL List */}
            <div className="space-y-2 mb-4">
              {urls.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground/50 cursor-grab" />
                  <LinkIcon className="h-4 w-4 text-blue-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate" title={item.url}>
                        {item.name || getHostname(item.url)}
                      </span>
                      {item.reliability && <ReliabilityBadge reliability={item.reliability} />}
                    </div>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted-foreground hover:text-blue-600 truncate block"
                    >
                      {item.url}
                    </a>
                  </div>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded hover:bg-muted transition-colors"
                    title="새 탭에서 열기"
                  >
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  </a>
                  <button
                    onClick={() => handleRemoveUrl(item.id)}
                    disabled={disabled}
                    className="p-1 rounded hover:bg-destructive/10 transition-colors"
                    title="제거"
                  >
                    <X className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add URL Input */}
            {urls.length < maxUrls && (
              <div className="flex gap-2">
                <Input
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="URL을 입력하세요..."
                  disabled={disabled}
                  className="flex-1 bg-white dark:bg-gray-800"
                />
                <Button
                  size="sm"
                  onClick={handleAddUrl}
                  disabled={disabled || !newUrl.trim()}
                  className="gap-1"
                >
                  <Plus className="h-4 w-4" />
                  추가
                </Button>
              </div>
            )}

            {/* Helper text */}
            <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
              <span>
                {urls.length}/{maxUrls}개 URL
              </span>
              <Link to="/url-collections" className="text-blue-600 hover:underline">
                URL 컬렉션에서 가져오기
              </Link>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

export default PriorityUrlEditor;
