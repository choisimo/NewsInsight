import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
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
  BookmarkIcon,
  ExternalLink,
  Eye,
  RefreshCw,
  Activity,
  ChevronRight,
  Bookmark,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  useProjects,
  PROJECT_STATUS_LABELS,
  PROJECT_CATEGORY_LABELS,
  ITEM_TYPE_LABELS,
  MEMBER_ROLE_LABELS,
  type Project,
  type ProjectItem,
  type ProjectItemType,
  type ProjectActivityLog,
  type ProjectMember,
} from '@/hooks/useProjects';

// Item type icons
const ITEM_TYPE_ICONS: Record<ProjectItemType, React.ReactNode> = {
  ARTICLE: <FileText className="h-4 w-4" />,
  SEARCH_RESULT: <Search className="h-4 w-4" />,
  NOTE: <FileText className="h-4 w-4" />,
  DOCUMENT: <FileText className="h-4 w-4" />,
  URL: <ExternalLink className="h-4 w-4" />,
  EVIDENCE: <Eye className="h-4 w-4" />,
};

// Activity type labels
const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  CREATED: '생성됨',
  UPDATED: '수정됨',
  ITEM_ADDED: '항목 추가',
  ITEM_REMOVED: '항목 삭제',
  MEMBER_ADDED: '멤버 추가',
  MEMBER_REMOVED: '멤버 삭제',
  STATUS_CHANGED: '상태 변경',
};

// Item Card Component
interface ItemCardProps {
  item: ProjectItem;
  onRead: () => void;
  onBookmark: () => void;
  onDelete: () => void;
}

function ItemCard({ item, onRead, onBookmark, onDelete }: ItemCardProps) {
  return (
    <Card className={cn(
      'transition-all hover:shadow-sm',
      !item.isRead && 'border-l-4 border-l-primary'
    )}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="p-1.5 bg-muted rounded flex-shrink-0 mt-0.5">
              {ITEM_TYPE_ICONS[item.itemType]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="text-xs">
                  {ITEM_TYPE_LABELS[item.itemType]}
                </Badge>
                {item.category && (
                  <Badge variant="secondary" className="text-xs">
                    {item.category}
                  </Badge>
                )}
              </div>
              <h4 className="font-medium text-sm truncate">{item.title}</h4>
              {item.summary && (
                <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                  {item.summary}
                </p>
              )}
              {item.sourceUrl && (
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline mt-1 inline-flex items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-3 w-3" />
                  원본 보기
                </a>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                {new Date(item.createdAt).toLocaleDateString('ko-KR')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onBookmark}
            >
              <Bookmark className={cn(
                'h-4 w-4',
                item.isBookmarked && 'fill-current text-yellow-500'
              )} />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!item.isRead && (
                  <DropdownMenuItem onClick={onRead}>
                    <Eye className="h-4 w-4 mr-2" />
                    읽음으로 표시
                  </DropdownMenuItem>
                )}
                {item.sourceUrl && (
                  <DropdownMenuItem asChild>
                    <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      원본 열기
                    </a>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  삭제
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Activity Item Component
function ActivityItem({ activity }: { activity: ProjectActivityLog }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="p-1.5 bg-muted rounded-full">
        <Activity className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          <span className="font-medium">{activity.userId}</span>
          {' '}
          <span className="text-muted-foreground">
            {ACTIVITY_TYPE_LABELS[activity.action] || activity.action}
          </span>
        </p>
        {activity.details && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {activity.details}
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          {new Date(activity.createdAt).toLocaleString('ko-KR')}
        </p>
      </div>
    </div>
  );
}

// Member Item Component
function MemberItem({ member }: { member: ProjectMember }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
          <span className="text-sm font-medium">
            {member.userId.charAt(0).toUpperCase()}
          </span>
        </div>
        <div>
          <p className="text-sm font-medium">{member.userId}</p>
          <p className="text-xs text-muted-foreground">
            {new Date(member.joinedAt).toLocaleDateString('ko-KR')} 참여
          </p>
        </div>
      </div>
      <Badge variant="outline" className="text-xs">
        {MEMBER_ROLE_LABELS[member.role]}
      </Badge>
    </div>
  );
}

// Loading Skeleton
function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Skeleton className="h-12 w-12 rounded-lg" />
        <div>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32 mt-1" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

// Main ProjectDashboard Page
const ProjectDashboard = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const projectId = id ? parseInt(id, 10) : null;

  const {
    currentProject,
    loading,
    error,
    selectProject,
    getProjectStatsAction,
    // Items
    items,
    itemsLoading,
    itemsPage,
    itemsTotalPages,
    loadItems,
    searchItems,
    markItemRead,
    toggleItemBookmark,
    deleteItem,
    // Members
    members,
    loadMembers,
    // Activities
    activities,
    loadRecentActivities,
  } = useProjects({ autoLoad: false });

  const [activeTab, setActiveTab] = useState('items');
  const [itemTypeFilter, setItemTypeFilter] = useState<ProjectItemType | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [stats, setStats] = useState<{
    itemCount: number;
    unreadCount: number;
    memberCount: number;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectItem | null>(null);

  // Load project data
  useEffect(() => {
    if (projectId) {
      selectProject(projectId);
      loadItems(projectId);
      loadMembers(projectId);
      loadRecentActivities(projectId);
      getProjectStatsAction(projectId).then(setStats);
    }
  }, [projectId, selectProject, loadItems, loadMembers, loadRecentActivities, getProjectStatsAction]);

  // Handle item filter/search
  useEffect(() => {
    if (!projectId) return;
    
    const debounce = setTimeout(() => {
      if (searchQuery.trim()) {
        searchItems(projectId, searchQuery);
      } else {
        loadItems(projectId, itemTypeFilter === 'ALL' ? undefined : itemTypeFilter);
      }
    }, 300);
    return () => clearTimeout(debounce);
  }, [searchQuery, itemTypeFilter, projectId, searchItems, loadItems]);

  // Handle item actions
  const handleMarkRead = async (itemId: number) => {
    if (projectId) {
      await markItemRead(projectId, itemId);
    }
  };

  const handleToggleBookmark = async (itemId: number) => {
    if (projectId) {
      await toggleItemBookmark(projectId, itemId);
    }
  };

  const handleDeleteItem = async () => {
    if (projectId && deleteTarget) {
      await deleteItem(projectId, deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  // Handle page change
  const handlePageChange = (page: number) => {
    if (!projectId) return;
    if (searchQuery.trim()) {
      searchItems(projectId, searchQuery, page);
    } else {
      loadItems(projectId, itemTypeFilter === 'ALL' ? undefined : itemTypeFilter, page);
    }
  };

  if (!projectId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">잘못된 프로젝트 ID입니다.</p>
      </div>
    );
  }

  if (loading && !currentProject) {
    return (
      <div className="min-h-screen py-8">
        <div className="container mx-auto px-4 max-w-6xl">
          <DashboardSkeleton />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen py-8">
        <div className="container mx-auto px-4 max-w-6xl">
          <Card className="border-destructive">
            <CardContent className="py-8 text-center">
              <p className="text-destructive mb-4">{error}</p>
              <Button onClick={() => navigate('/projects')}>
                프로젝트 목록으로
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!currentProject) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">프로젝트를 찾을 수 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-8">
      <div className="container mx-auto px-4 max-w-6xl">
        {/* Header */}
        <header className="mb-8">
          <Link
            to="/projects"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            프로젝트 목록
          </Link>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <FolderOpen className="h-6 w-6 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold">{currentProject.name}</h1>
                  <Badge variant="outline">
                    {PROJECT_CATEGORY_LABELS[currentProject.category]}
                  </Badge>
                  <Badge>
                    {PROJECT_STATUS_LABELS[currentProject.status]}
                  </Badge>
                </div>
                {currentProject.description && (
                  <p className="text-muted-foreground mt-1">
                    {currentProject.description}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" asChild>
                <Link to={`/projects/${projectId}/settings`}>
                  <Settings className="h-4 w-4 mr-2" />
                  설정
                </Link>
              </Button>
              <Button asChild>
                <Link to={`/search?projectId=${projectId}`}>
                  <Plus className="h-4 w-4 mr-2" />
                  검색 추가
                </Link>
              </Button>
            </div>
          </div>
        </header>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-3 mb-8">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.itemCount || 0}</p>
                <p className="text-sm text-muted-foreground">전체 항목</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                <Eye className="h-5 w-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.unreadCount || 0}</p>
                <p className="text-sm text-muted-foreground">읽지 않음</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                <Users className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.memberCount || 1}</p>
                <p className="text-sm text-muted-foreground">멤버</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Items List (2 columns) */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">수집된 항목</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => loadItems(projectId)}>
                    <RefreshCw className={cn('h-4 w-4', itemsLoading && 'animate-spin')} />
                  </Button>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 mt-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="항목 검색..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Select
                    value={itemTypeFilter}
                    onValueChange={(v) => setItemTypeFilter(v as ProjectItemType | 'ALL')}
                  >
                    <SelectTrigger className="w-[140px]">
                      <Filter className="h-4 w-4 mr-2" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">모든 유형</SelectItem>
                      {(Object.keys(ITEM_TYPE_LABELS) as ProjectItemType[]).map((type) => (
                        <SelectItem key={type} value={type}>
                          {ITEM_TYPE_LABELS[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                {itemsLoading && items.length === 0 ? (
                  <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-24" />
                    ))}
                  </div>
                ) : items.length === 0 ? (
                  <div className="py-12 text-center">
                    <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">
                      {searchQuery ? '검색 결과가 없습니다.' : '아직 수집된 항목이 없습니다.'}
                    </p>
                    {!searchQuery && (
                      <Button asChild className="mt-4">
                        <Link to={`/search?projectId=${projectId}`}>
                          <Plus className="h-4 w-4 mr-2" />
                          검색으로 항목 추가
                        </Link>
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {items.map((item) => (
                      <ItemCard
                        key={item.id}
                        item={item}
                        onRead={() => handleMarkRead(item.id)}
                        onBookmark={() => handleToggleBookmark(item.id)}
                        onDelete={() => setDeleteTarget(item)}
                      />
                    ))}
                  </div>
                )}

                {/* Pagination */}
                {itemsTotalPages > 1 && (
                  <div className="flex justify-center gap-2 mt-6">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={itemsPage === 0}
                      onClick={() => handlePageChange(itemsPage - 1)}
                    >
                      이전
                    </Button>
                    <span className="flex items-center px-4 text-sm text-muted-foreground">
                      {itemsPage + 1} / {itemsTotalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={itemsPage >= itemsTotalPages - 1}
                      onClick={() => handlePageChange(itemsPage + 1)}
                    >
                      다음
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar (1 column) */}
          <div className="space-y-6">
            {/* Members */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">멤버</CardTitle>
                  <Button variant="ghost" size="sm" asChild>
                    <Link to={`/projects/${projectId}/settings#members`}>
                      <Settings className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {members.slice(0, 5).map((member) => (
                    <MemberItem key={member.id} member={member} />
                  ))}
                  {members.length > 5 && (
                    <Button variant="link" className="w-full mt-2" asChild>
                      <Link to={`/projects/${projectId}/settings#members`}>
                        모든 멤버 보기 ({members.length})
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Link>
                    </Button>
                  )}
                  {members.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      멤버가 없습니다
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Recent Activity */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">최근 활동</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-64">
                  <div className="divide-y">
                    {activities.slice(0, 10).map((activity) => (
                      <ActivityItem key={activity.id} activity={activity} />
                    ))}
                    {activities.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        아직 활동이 없습니다
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>항목 삭제</AlertDialogTitle>
              <AlertDialogDescription>
                "{deleteTarget?.title}" 항목을 삭제하시겠습니까?
                이 작업은 되돌릴 수 없습니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteItem}
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

export default ProjectDashboard;
