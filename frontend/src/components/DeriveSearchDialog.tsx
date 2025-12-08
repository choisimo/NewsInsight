import { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Search,
  Microscope,
  Shield,
  Link as LinkIcon,
  ExternalLink,
  Filter,
  CheckCircle2,
  Globe,
} from "lucide-react";
import type { SearchHistoryRecord, SearchHistoryType } from "@/lib/api";
import { useSearchRecord, type PriorityUrl } from "@/hooks/useSearchRecord";

interface DeriveSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchRecord: SearchHistoryRecord;
}

type ReuseOption = "query_only" | "query_and_all_urls" | "query_and_selected_urls";
type TargetPage = "unified" | "deep_search" | "fact_check";

const TARGET_PAGE_CONFIG: Record<TargetPage, { label: string; icon: typeof Search; path: string; color: string }> = {
  unified: {
    label: "통합 검색",
    icon: Search,
    path: "/search",
    color: "text-blue-600",
  },
  deep_search: {
    label: "Deep Search",
    icon: Microscope,
    path: "/deep-search",
    color: "text-purple-600",
  },
  fact_check: {
    label: "팩트체크",
    icon: Shield,
    path: "/fact-check",
    color: "text-green-600",
  },
};

// Suggest target page based on source search type
function suggestTargetPage(searchType: SearchHistoryType): TargetPage {
  switch (searchType) {
    case "UNIFIED":
      return "deep_search"; // Suggest deeper analysis
    case "DEEP_SEARCH":
      return "fact_check"; // Suggest verification
    case "FACT_CHECK":
      return "deep_search"; // Suggest more research
    default:
      return "unified";
  }
}

export function DeriveSearchDialog({
  open,
  onOpenChange,
  searchRecord,
}: DeriveSearchDialogProps) {
  const navigate = useNavigate();
  
  // Load URLs from the search record
  const { priorityUrls, loading } = useSearchRecord({
    searchId: searchRecord.id,
    autoLoad: open,
  });

  // State
  const [reuseOption, setReuseOption] = useState<ReuseOption>("query_and_all_urls");
  const [targetPage, setTargetPage] = useState<TargetPage>(() => suggestTargetPage(searchRecord.searchType));
  const [selectedUrlIds, setSelectedUrlIds] = useState<Set<string>>(new Set());
  const [urlFilter, setUrlFilter] = useState("");

  // Filter URLs based on search
  const filteredUrls = useMemo(() => {
    if (!urlFilter.trim()) return priorityUrls;
    const lowerFilter = urlFilter.toLowerCase();
    return priorityUrls.filter(
      (u) =>
        u.url.toLowerCase().includes(lowerFilter) ||
        u.name.toLowerCase().includes(lowerFilter)
    );
  }, [priorityUrls, urlFilter]);

  // Toggle URL selection
  const toggleUrl = useCallback((id: string) => {
    setSelectedUrlIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Select all visible URLs
  const selectAllVisible = useCallback(() => {
    setSelectedUrlIds((prev) => {
      const next = new Set(prev);
      filteredUrls.forEach((u) => next.add(u.id));
      return next;
    });
  }, [filteredUrls]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedUrlIds(new Set());
  }, []);

  // Get URLs to pass based on reuse option
  const getUrlsToPass = useCallback((): PriorityUrl[] => {
    switch (reuseOption) {
      case "query_only":
        return [];
      case "query_and_all_urls":
        return priorityUrls;
      case "query_and_selected_urls":
        return priorityUrls.filter((u) => selectedUrlIds.has(u.id));
      default:
        return [];
    }
  }, [reuseOption, priorityUrls, selectedUrlIds]);

  // Handle derive action
  const handleDerive = useCallback(() => {
    const config = TARGET_PAGE_CONFIG[targetPage];
    const urlsToPass = getUrlsToPass();

    const navigationState = {
      query: searchRecord.query,
      parentSearchId: searchRecord.id,
      deriveFrom: searchRecord.id,
      depthLevel: (searchRecord.depthLevel || 0) + 1,
      priorityUrls: urlsToPass,
      fromDeriveDialog: true,
    };

    navigate(config.path, { state: navigationState });
    onOpenChange(false);
  }, [targetPage, getUrlsToPass, searchRecord, navigate, onOpenChange]);

  const selectedCount = selectedUrlIds.size;
  const totalCount = priorityUrls.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            파생 검색 설정
          </DialogTitle>
          <DialogDescription>
            "{searchRecord.query}" 검색 결과를 기반으로 새로운 검색을 시작합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden space-y-6 py-4">
          {/* Target Page Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">대상 페이지</Label>
            <RadioGroup
              value={targetPage}
              onValueChange={(v) => setTargetPage(v as TargetPage)}
              className="grid grid-cols-3 gap-2"
            >
              {(Object.entries(TARGET_PAGE_CONFIG) as [TargetPage, typeof TARGET_PAGE_CONFIG[TargetPage]][]).map(
                ([key, config]) => {
                  const Icon = config.icon;
                  return (
                    <div key={key}>
                      <RadioGroupItem value={key} id={`target-${key}`} className="peer sr-only" />
                      <Label
                        htmlFor={`target-${key}`}
                        className={`
                          flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 cursor-pointer
                          peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5
                          hover:bg-muted/50 transition-colors
                        `}
                      >
                        <Icon className={`h-5 w-5 ${config.color}`} />
                        <span className="text-xs font-medium">{config.label}</span>
                      </Label>
                    </div>
                  );
                }
              )}
            </RadioGroup>
          </div>

          {/* Reuse Option Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">재사용 옵션</Label>
            <RadioGroup
              value={reuseOption}
              onValueChange={(v) => setReuseOption(v as ReuseOption)}
              className="space-y-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="query_only" id="reuse-query" />
                <Label htmlFor="reuse-query" className="text-sm cursor-pointer">
                  검색어만 재사용
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="query_and_all_urls" id="reuse-all" />
                <Label htmlFor="reuse-all" className="text-sm cursor-pointer flex items-center gap-2">
                  검색어 + 모든 URL ({totalCount}개)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="query_and_selected_urls" id="reuse-selected" />
                <Label htmlFor="reuse-selected" className="text-sm cursor-pointer flex items-center gap-2">
                  검색어 + 선택한 URL
                  {reuseOption === "query_and_selected_urls" && selectedCount > 0 && (
                    <Badge variant="secondary" className="ml-1">
                      {selectedCount}개 선택
                    </Badge>
                  )}
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* URL Selection (only when selecting specific URLs) */}
          {reuseOption === "query_and_selected_urls" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <LinkIcon className="h-4 w-4" />
                  URL 선택
                </Label>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={selectAllVisible} className="h-7 text-xs">
                    전체 선택
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clearSelection} className="h-7 text-xs">
                    선택 해제
                  </Button>
                </div>
              </div>

              {/* URL Filter */}
              <div className="relative">
                <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={urlFilter}
                  onChange={(e) => setUrlFilter(e.target.value)}
                  placeholder="URL 필터링..."
                  className="pl-8 h-8 text-sm"
                />
              </div>

              {/* URL List */}
              {loading ? (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  URL 목록을 불러오는 중...
                </div>
              ) : filteredUrls.length === 0 ? (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  {urlFilter ? "필터와 일치하는 URL이 없습니다." : "재사용 가능한 URL이 없습니다."}
                </div>
              ) : (
                <ScrollArea className="h-[200px] border rounded-lg">
                  <div className="p-2 space-y-1">
                    {filteredUrls.map((url) => {
                      const isSelected = selectedUrlIds.has(url.id);
                      return (
                        <div
                          key={url.id}
                          className={`
                            flex items-center gap-2 p-2 rounded-md cursor-pointer
                            hover:bg-muted/50 transition-colors
                            ${isSelected ? "bg-primary/5" : ""}
                          `}
                          onClick={() => toggleUrl(url.id)}
                        >
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleUrl(url.id)}
                            className="pointer-events-none"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{url.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{url.url}</p>
                          </div>
                          {url.reliability && (
                            <Badge
                              variant="outline"
                              className={`text-xs shrink-0 ${
                                url.reliability === "high"
                                  ? "border-green-500 text-green-600"
                                  : url.reliability === "medium"
                                  ? "border-yellow-500 text-yellow-600"
                                  : "border-red-500 text-red-600"
                              }`}
                            >
                              {url.reliability === "high" ? "높음" : url.reliability === "medium" ? "보통" : "낮음"}
                            </Badge>
                          )}
                          <a
                            href={url.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 rounded hover:bg-muted"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                          </a>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}

          {/* Summary */}
          <div className="p-3 rounded-lg bg-muted/50 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>
                <strong>{TARGET_PAGE_CONFIG[targetPage].label}</strong>로{" "}
                {reuseOption === "query_only"
                  ? "검색어만"
                  : reuseOption === "query_and_all_urls"
                  ? `검색어와 ${totalCount}개 URL`
                  : `검색어와 ${selectedCount}개 URL`}{" "}
                전달됩니다.
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            onClick={handleDerive}
            disabled={reuseOption === "query_and_selected_urls" && selectedCount === 0}
          >
            파생 검색 시작
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DeriveSearchDialog;
