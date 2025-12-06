import { useState, useCallback, useMemo } from "react";
import {
  Bookmark,
  BookmarkPlus,
  Trash2,
  Play,
  Edit,
  X,
  Search,
  Globe,
  FileText,
  Database,
  ShoppingCart,
  Newspaper,
  BarChart3,
  Loader2,
  ChevronDown,
  ChevronUp,
  Star,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  task: string;
  url?: string;
  maxSteps?: number;
  category: TaskCategory;
  icon?: string;
  isBuiltIn?: boolean;
  createdAt: string;
  usageCount?: number;
}

export type TaskCategory = 
  | "news"
  | "research"
  | "ecommerce"
  | "data"
  | "social"
  | "custom";

const CATEGORY_CONFIG: Record<TaskCategory, { label: string; icon: typeof Newspaper; color: string }> = {
  news: { label: "뉴스", icon: Newspaper, color: "text-blue-600" },
  research: { label: "연구", icon: Search, color: "text-purple-600" },
  ecommerce: { label: "쇼핑", icon: ShoppingCart, color: "text-green-600" },
  data: { label: "데이터", icon: BarChart3, color: "text-orange-600" },
  social: { label: "소셜", icon: Globe, color: "text-pink-600" },
  custom: { label: "사용자 정의", icon: FileText, color: "text-gray-600" },
};

/** 기본 제공 템플릿 */
const BUILT_IN_TEMPLATES: TaskTemplate[] = [
  {
    id: "builtin-1",
    name: "뉴스 헤드라인 수집",
    description: "뉴스 사이트에서 최신 헤드라인을 수집합니다",
    task: "Go to the news website and extract the top 10 headlines with their titles, summaries, and URLs. Format the output as a numbered list.",
    url: "",
    maxSteps: 15,
    category: "news",
    isBuiltIn: true,
    createdAt: "2024-01-01",
    usageCount: 0,
  },
  {
    id: "builtin-2",
    name: "Hacker News 인기글",
    description: "Hacker News 프론트페이지 인기글 추출",
    task: "Go to news.ycombinator.com and extract the top 10 stories with their titles, points, comment counts, and URLs.",
    url: "https://news.ycombinator.com",
    maxSteps: 10,
    category: "news",
    isBuiltIn: true,
    createdAt: "2024-01-01",
    usageCount: 0,
  },
  {
    id: "builtin-3",
    name: "Wikipedia 정보 추출",
    description: "Wikipedia에서 특정 주제 정보 수집",
    task: "Search Wikipedia for the given topic and extract the main summary, key facts, and related topics.",
    url: "https://wikipedia.org",
    maxSteps: 15,
    category: "research",
    isBuiltIn: true,
    createdAt: "2024-01-01",
    usageCount: 0,
  },
  {
    id: "builtin-4",
    name: "상품 정보 수집",
    description: "이커머스 사이트에서 상품 정보 추출",
    task: "Find product information including name, price, ratings, and reviews from the given product page or search results.",
    url: "",
    maxSteps: 20,
    category: "ecommerce",
    isBuiltIn: true,
    createdAt: "2024-01-01",
    usageCount: 0,
  },
  {
    id: "builtin-5",
    name: "트렌드 데이터 수집",
    description: "트렌드/통계 데이터 추출",
    task: "Extract trending topics, statistics, or data points from the given page. Format as structured data with dates and values.",
    url: "",
    maxSteps: 20,
    category: "data",
    isBuiltIn: true,
    createdAt: "2024-01-01",
    usageCount: 0,
  },
];

const STORAGE_KEY = "newsinsight-task-templates";

interface TaskTemplatesProps {
  /** 템플릿 선택 시 콜백 */
  onSelectTemplate: (template: TaskTemplate) => void;
  /** 현재 작업이 실행 중인지 */
  disabled?: boolean;
  /** 추가 CSS 클래스 */
  className?: string;
}

/** 로컬 스토리지에서 템플릿 로드 */
const loadTemplates = (): TaskTemplate[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const userTemplates = JSON.parse(stored) as TaskTemplate[];
      return [...BUILT_IN_TEMPLATES, ...userTemplates];
    }
  } catch (e) {
    console.error("Failed to load templates:", e);
  }
  return BUILT_IN_TEMPLATES;
};

/** 사용자 템플릿만 저장 */
const saveTemplates = (templates: TaskTemplate[]) => {
  const userTemplates = templates.filter((t) => !t.isBuiltIn);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(userTemplates));
};

export function TaskTemplates({
  onSelectTemplate,
  disabled = false,
  className,
}: TaskTemplatesProps) {
  const [templates, setTemplates] = useState<TaskTemplate[]>(loadTemplates);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<TaskCategory | "all">("all");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TaskTemplate | null>(null);

  // 새 템플릿 기본값
  const [newTemplate, setNewTemplate] = useState<Partial<TaskTemplate>>({
    name: "",
    description: "",
    task: "",
    url: "",
    maxSteps: 25,
    category: "custom",
  });

  // 필터링된 템플릿
  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => {
      const matchesSearch =
        !searchQuery ||
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.task.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesCategory =
        selectedCategory === "all" || t.category === selectedCategory;
      
      return matchesSearch && matchesCategory;
    });
  }, [templates, searchQuery, selectedCategory]);

  // 카테고리별 그룹화
  const groupedTemplates = useMemo(() => {
    const groups: Record<string, TaskTemplate[]> = {};
    filteredTemplates.forEach((t) => {
      const key = t.isBuiltIn ? "기본 제공" : "내 템플릿";
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });
    return groups;
  }, [filteredTemplates]);

  // 템플릿 선택
  const handleSelect = useCallback((template: TaskTemplate) => {
    // 사용 횟수 증가
    setTemplates((prev) => {
      const updated = prev.map((t) =>
        t.id === template.id
          ? { ...t, usageCount: (t.usageCount || 0) + 1 }
          : t
      );
      saveTemplates(updated);
      return updated;
    });
    
    onSelectTemplate(template);
    setIsOpen(false);
  }, [onSelectTemplate]);

  // 템플릿 저장
  const handleSave = useCallback(() => {
    if (!newTemplate.name?.trim() || !newTemplate.task?.trim()) return;

    const template: TaskTemplate = {
      id: editingTemplate?.id || `user-${Date.now()}`,
      name: newTemplate.name.trim(),
      description: newTemplate.description?.trim() || "",
      task: newTemplate.task.trim(),
      url: newTemplate.url?.trim() || undefined,
      maxSteps: newTemplate.maxSteps || 25,
      category: newTemplate.category as TaskCategory || "custom",
      isBuiltIn: false,
      createdAt: editingTemplate?.createdAt || new Date().toISOString(),
      usageCount: editingTemplate?.usageCount || 0,
    };

    setTemplates((prev) => {
      let updated: TaskTemplate[];
      if (editingTemplate) {
        updated = prev.map((t) => (t.id === template.id ? template : t));
      } else {
        updated = [...prev, template];
      }
      saveTemplates(updated);
      return updated;
    });

    setEditDialogOpen(false);
    setEditingTemplate(null);
    setNewTemplate({
      name: "",
      description: "",
      task: "",
      url: "",
      maxSteps: 25,
      category: "custom",
    });
  }, [newTemplate, editingTemplate]);

  // 템플릿 삭제
  const handleDelete = useCallback((id: string) => {
    setTemplates((prev) => {
      const updated = prev.filter((t) => t.id !== id);
      saveTemplates(updated);
      return updated;
    });
  }, []);

  // 편집 모드 시작
  const startEdit = useCallback((template: TaskTemplate) => {
    setEditingTemplate(template);
    setNewTemplate({
      name: template.name,
      description: template.description,
      task: template.task,
      url: template.url,
      maxSteps: template.maxSteps,
      category: template.category,
    });
    setEditDialogOpen(true);
  }, []);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className={className}>
      <CollapsibleTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between"
          disabled={disabled}
        >
          <div className="flex items-center gap-2">
            <Bookmark className="h-4 w-4" />
            <span>작업 템플릿</span>
            <Badge variant="secondary" className="ml-1">
              {templates.length}
            </Badge>
          </div>
          {isOpen ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-3 space-y-3">
        {/* 검색 및 필터 */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="템플릿 검색..."
              className="pl-9"
            />
          </div>
          <Select
            value={selectedCategory}
            onValueChange={(v) => setSelectedCategory(v as TaskCategory | "all")}
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              {Object.entries(CATEGORY_CONFIG).map(([key, config]) => (
                <SelectItem key={key} value={key}>
                  {config.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          {/* 새 템플릿 추가 */}
          <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  setEditingTemplate(null);
                  setNewTemplate({
                    name: "",
                    description: "",
                    task: "",
                    url: "",
                    maxSteps: 25,
                    category: "custom",
                  });
                }}
              >
                <BookmarkPlus className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>
                  {editingTemplate ? "템플릿 수정" : "새 템플릿 만들기"}
                </DialogTitle>
                <DialogDescription>
                  자주 사용하는 작업을 템플릿으로 저장하여 빠르게 재사용하세요.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">템플릿 이름 *</Label>
                  <Input
                    id="name"
                    value={newTemplate.name}
                    onChange={(e) =>
                      setNewTemplate((p) => ({ ...p, name: e.target.value }))
                    }
                    placeholder="예: 뉴스 헤드라인 수집"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">설명</Label>
                  <Input
                    id="description"
                    value={newTemplate.description}
                    onChange={(e) =>
                      setNewTemplate((p) => ({ ...p, description: e.target.value }))
                    }
                    placeholder="템플릿에 대한 간단한 설명"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="task">작업 내용 *</Label>
                  <Textarea
                    id="task"
                    value={newTemplate.task}
                    onChange={(e) =>
                      setNewTemplate((p) => ({ ...p, task: e.target.value }))
                    }
                    placeholder="AI 에이전트가 수행할 작업을 자세히 설명하세요"
                    rows={4}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="url">시작 URL</Label>
                    <Input
                      id="url"
                      value={newTemplate.url}
                      onChange={(e) =>
                        setNewTemplate((p) => ({ ...p, url: e.target.value }))
                      }
                      placeholder="https://..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maxSteps">최대 단계</Label>
                    <Input
                      id="maxSteps"
                      type="number"
                      value={newTemplate.maxSteps}
                      onChange={(e) =>
                        setNewTemplate((p) => ({
                          ...p,
                          maxSteps: parseInt(e.target.value) || 25,
                        }))
                      }
                      min={1}
                      max={100}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>카테고리</Label>
                  <Select
                    value={newTemplate.category}
                    onValueChange={(v) =>
                      setNewTemplate((p) => ({ ...p, category: v as TaskCategory }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CATEGORY_CONFIG).map(([key, config]) => {
                        const Icon = config.icon;
                        return (
                          <SelectItem key={key} value={key}>
                            <div className="flex items-center gap-2">
                              <Icon className={cn("h-4 w-4", config.color)} />
                              {config.label}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                  취소
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={!newTemplate.name?.trim() || !newTemplate.task?.trim()}
                >
                  {editingTemplate ? "수정" : "저장"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* 템플릿 목록 */}
        <ScrollArea className="h-[300px] pr-2">
          {filteredTemplates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Bookmark className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>검색 결과가 없습니다</p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedTemplates).map(([group, items]) => (
                <div key={group}>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">
                    {group}
                  </h4>
                  <div className="space-y-2">
                    {items.map((template) => {
                      const categoryConfig = CATEGORY_CONFIG[template.category];
                      const Icon = categoryConfig.icon;
                      
                      return (
                        <div
                          key={template.id}
                          className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                        >
                          <div className={cn("p-2 rounded-lg bg-muted", categoryConfig.color)}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h5 className="font-medium text-sm truncate">
                                {template.name}
                              </h5>
                              {template.isBuiltIn && (
                                <Badge variant="secondary" className="text-xs shrink-0">
                                  기본
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                              {template.description || template.task}
                            </p>
                            {template.url && (
                              <p className="text-xs text-blue-600 truncate mt-0.5">
                                {template.url}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {/* 사용하기 */}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleSelect(template)}
                              title="이 템플릿 사용"
                            >
                              <Play className="h-4 w-4" />
                            </Button>
                            
                            {/* 편집 (사용자 템플릿만) */}
                            {!template.isBuiltIn && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => startEdit(template)}
                                title="수정"
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                            )}
                            
                            {/* 삭제 (사용자 템플릿만) */}
                            {!template.isBuiltIn && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => handleDelete(template.id)}
                                title="삭제"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default TaskTemplates;
