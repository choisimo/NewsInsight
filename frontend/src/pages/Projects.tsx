import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  FolderOpen,
  Plus,
  Search,
  MoreVertical,
  Settings,
  Trash2,
  Users,
  FileText,
  Clock,
  Filter,
  Grid3X3,
  List,
  RefreshCw,
  FolderPlus,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  useProjects,
  PROJECT_STATUS_LABELS,
  PROJECT_CATEGORY_LABELS,
  PROJECT_VISIBILITY_LABELS,
  type Project,
  type ProjectStatus,
  type ProjectCategory,
  type ProjectVisibility,
} from '@/hooks/useProjects';

// Status badge color mapping
const STATUS_COLORS: Record<ProjectStatus, string> = {
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  PAUSED: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  COMPLETED: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  ARCHIVED: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
};

// Category icons
const CATEGORY_ICONS: Record<ProjectCategory, React.ReactNode> = {
  RESEARCH: <FileText className="h-4 w-4" />,
  MONITORING: <Clock className="h-4 w-4" />,
  FACT_CHECK: <Search className="h-4 w-4" />,
  TREND_ANALYSIS: <Grid3X3 className="h-4 w-4" />,
  CUSTOM: <FolderOpen className="h-4 w-4" />,
};

// Create Project Dialog
interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    name: string;
    description?: string;
    category: ProjectCategory;
    visibility: ProjectVisibility;
  }) => Promise<void>;
}

function CreateProjectDialog({ open, onOpenChange, onSubmit }: CreateProjectDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ProjectCategory>('RESEARCH');
  const [visibility, setVisibility] = useState<ProjectVisibility>('PRIVATE');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim() || undefined,
        category,
        visibility,
      });
      // Reset form
      setName('');
      setDescription('');
      setCategory('RESEARCH');
      setVisibility('PRIVATE');
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>새 프로젝트 만들기</DialogTitle>
          <DialogDescription>
            검색 결과와 분석 자료를 체계적으로 관리할 프로젝트를 만듭니다.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">프로젝트 이름 *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 2024년 대선 관련 팩트체크"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">설명</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="프로젝트에 대한 간단한 설명을 입력하세요."
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="category">카테고리</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as ProjectCategory)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PROJECT_CATEGORY_LABELS) as ProjectCategory[]).map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        <span className="flex items-center gap-2">
                          {CATEGORY_ICONS[cat]}
                          {PROJECT_CATEGORY_LABELS[cat]}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="visibility">공개 범위</Label>
                <Select value={visibility} onValueChange={(v) => setVisibility(v as ProjectVisibility)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PROJECT_VISIBILITY_LABELS) as ProjectVisibility[]).map((vis) => (
                      <SelectItem key={vis} value={vis}>
                        {PROJECT_VISIBILITY_LABELS[vis]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" disabled={!name.trim() || isSubmitting}>
              {isSubmitting ? '생성 중...' : '프로젝트 만들기'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Project Card Component
interface ProjectCardProps {
  project: Project;
  viewMode: 'grid' | 'list';
  onSelect: (project: Project) => void;
  onEdit: (project: Project) => void;
  onDelete: (project: Project) => void;
}

function ProjectCard({ project, viewMode, onSelect, onEdit, onDelete }: ProjectCardProps) {
  const isGrid = viewMode === 'grid';

  return (
    <Card
      className={cn(
        'cursor-pointer transition-all hover:shadow-md hover:border-primary/50',
        isGrid ? '' : 'flex items-center'
      )}
      onClick={() => onSelect(project)}
    >
      <CardHeader className={cn(isGrid ? '' : 'flex-1 py-4')}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-primary/10 rounded">
              {CATEGORY_ICONS[project.category]}
            </div>
            <div>
              <CardTitle className="text-base">{project.name}</CardTitle>
              {project.description && (
                <CardDescription className="line-clamp-1 mt-1">
                  {project.description}
                </CardDescription>
              )}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(project); }}>
                <Settings className="h-4 w-4 mr-2" />
                설정
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={(e) => { e.stopPropagation(); onDelete(project); }}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      {isGrid && (
        <CardContent className="pt-0">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-3 text-muted-foreground">
              <span className="flex items-center gap-1">
                <FileText className="h-3.5 w-3.5" />
                {project.itemCount || 0}
              </span>
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {project.memberCount || 1}
              </span>
            </div>
            <Badge className={cn('text-xs', STATUS_COLORS[project.status])}>
              {PROJECT_STATUS_LABELS[project.status]}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {new Date(project.updatedAt || project.createdAt).toLocaleDateString('ko-KR')} 업데이트
          </p>
        </CardContent>
      )}
      {!isGrid && (
        <div className="flex items-center gap-4 px-6 py-4">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <FileText className="h-3.5 w-3.5" />
              {project.itemCount || 0}
            </span>
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {project.memberCount || 1}
            </span>
          </div>
          <Badge className={cn('text-xs', STATUS_COLORS[project.status])}>
            {PROJECT_STATUS_LABELS[project.status]}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {new Date(project.updatedAt || project.createdAt).toLocaleDateString('ko-KR')}
          </span>
        </div>
      )}
    </Card>
  );
}

// Loading Skeleton
function ProjectCardSkeleton({ viewMode }: { viewMode: 'grid' | 'list' }) {
  if (viewMode === 'list') {
    return (
      <Card className="flex items-center">
        <CardHeader className="flex-1 py-4">
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded" />
            <div>
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-60 mt-1" />
            </div>
          </div>
        </CardHeader>
        <div className="flex items-center gap-4 px-6 py-4">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-5 w-12 rounded-full" />
          <Skeleton className="h-3 w-20" />
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded" />
          <div className="flex-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48 mt-1" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-5 w-12 rounded-full" />
        </div>
        <Skeleton className="h-3 w-24 mt-2" />
      </CardContent>
    </Card>
  );
}

// Main Projects Page
const Projects = () => {
  const navigate = useNavigate();
  const {
    projects,
    loading,
    error,
    totalElements,
    currentPage,
    totalPages,
    loadProjects,
    searchProjectsAction,
    createProjectAction,
    deleteProjectAction,
    refresh,
  } = useProjects({ autoLoad: true });

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'ALL'>('ALL');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  // Handle search
  useEffect(() => {
    const debounce = setTimeout(() => {
      if (searchQuery.trim()) {
        searchProjectsAction(searchQuery);
      } else {
        loadProjects(0, statusFilter === 'ALL' ? undefined : statusFilter);
      }
    }, 300);
    return () => clearTimeout(debounce);
  }, [searchQuery, statusFilter, searchProjectsAction, loadProjects]);

  // Handle status filter change
  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value as ProjectStatus | 'ALL');
    setSearchQuery('');
  };

  // Handle create project
  const handleCreateProject = async (data: {
    name: string;
    description?: string;
    category: ProjectCategory;
    visibility: ProjectVisibility;
  }) => {
    await createProjectAction({
      ...data,
      ownerId: 'anonymous', // Will be set by hook
    });
  };

  // Handle select project
  const handleSelectProject = (project: Project) => {
    navigate(`/projects/${project.id}`);
  };

  // Handle edit project
  const handleEditProject = (project: Project) => {
    navigate(`/projects/${project.id}/settings`);
  };

  // Handle delete project
  const handleDeleteProject = async () => {
    if (deleteTarget) {
      await deleteProjectAction(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  // Handle page change
  const handlePageChange = (page: number) => {
    if (searchQuery.trim()) {
      searchProjectsAction(searchQuery, page);
    } else {
      loadProjects(page, statusFilter === 'ALL' ? undefined : statusFilter);
    }
  };

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
            홈으로 돌아가기
          </Link>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <FolderOpen className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-3xl font-bold">프로젝트</h1>
                <p className="text-muted-foreground">
                  {totalElements}개의 프로젝트
                </p>
              </div>
            </div>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              새 프로젝트
            </Button>
          </div>
        </header>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="프로젝트 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
              <SelectTrigger className="w-[140px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="상태" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">모든 상태</SelectItem>
                {(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((status) => (
                  <SelectItem key={status} value={status}>
                    {PROJECT_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center border rounded-md">
              <Button
                variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-9 w-9 rounded-r-none"
                onClick={() => setViewMode('grid')}
              >
                <Grid3X3 className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-9 w-9 rounded-l-none"
                onClick={() => setViewMode('list')}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="outline" size="icon" onClick={refresh}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <Card className="mb-6 border-destructive">
            <CardContent className="py-4">
              <p className="text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={refresh} className="mt-2">
                다시 시도
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Projects Grid/List */}
        {loading && projects.length === 0 ? (
          <div className={cn(
            viewMode === 'grid' 
              ? 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3' 
              : 'space-y-3'
          )}>
            {Array.from({ length: 6 }).map((_, i) => (
              <ProjectCardSkeleton key={i} viewMode={viewMode} />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center">
              <div className="flex justify-center mb-6">
                <div className="p-4 bg-muted rounded-full">
                  <FolderPlus className="h-12 w-12 text-muted-foreground" />
                </div>
              </div>
              <h2 className="text-xl font-semibold mb-2">
                {searchQuery ? '검색 결과가 없습니다' : '프로젝트가 없습니다'}
              </h2>
              <p className="text-muted-foreground mb-6">
                {searchQuery
                  ? '다른 검색어로 다시 시도해보세요.'
                  : '첫 번째 프로젝트를 만들어 검색 결과와 분석 자료를 체계적으로 관리해보세요.'}
              </p>
              {!searchQuery && (
                <Button onClick={() => setCreateDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  첫 프로젝트 만들기
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className={cn(
            viewMode === 'grid'
              ? 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3'
              : 'space-y-3'
          )}>
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                viewMode={viewMode}
                onSelect={handleSelectProject}
                onEdit={handleEditProject}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-8">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 0}
              onClick={() => handlePageChange(currentPage - 1)}
            >
              이전
            </Button>
            <span className="flex items-center px-4 text-sm text-muted-foreground">
              {currentPage + 1} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages - 1}
              onClick={() => handlePageChange(currentPage + 1)}
            >
              다음
            </Button>
          </div>
        )}

        {/* Quick Actions */}
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">검색 기록</CardTitle>
              <CardDescription>
                지금까지 수행한 검색 내역을 확인하고 프로젝트에 추가할 수 있습니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link to="/history">
                <Button variant="outline" className="w-full">
                  검색 기록 보기
                </Button>
              </Link>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">URL 컬렉션</CardTitle>
              <CardDescription>
                수집한 URL을 프로젝트별로 정리하고 관리할 수 있습니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link to="/url-collections">
                <Button variant="outline" className="w-full">
                  URL 컬렉션 보기
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        {/* Create Project Dialog */}
        <CreateProjectDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          onSubmit={handleCreateProject}
        />

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>프로젝트 삭제</AlertDialogTitle>
              <AlertDialogDescription>
                "{deleteTarget?.name}" 프로젝트를 삭제하시겠습니까?
                이 작업은 되돌릴 수 없으며, 프로젝트의 모든 항목이 함께 삭제됩니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteProject}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                삭제
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};

export default Projects;
