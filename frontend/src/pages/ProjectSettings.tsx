import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  FolderOpen,
  Settings,
  Trash2,
  Users,
  UserPlus,
  Shield,
  Bell,
  Archive,
  Save,
  Clock,
  Play,
  Pause,
  CheckCircle,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  useProjects,
  PROJECT_STATUS_LABELS,
  PROJECT_CATEGORY_LABELS,
  PROJECT_VISIBILITY_LABELS,
  MEMBER_ROLE_LABELS,
  type Project,
  type ProjectStatus,
  type ProjectCategory,
  type ProjectVisibility,
  type ProjectMember,
  type MemberRole,
} from '@/hooks/useProjects';

// Status icons
const STATUS_ICONS: Record<ProjectStatus, React.ReactNode> = {
  ACTIVE: <Play className="h-4 w-4 text-green-500" />,
  PAUSED: <Pause className="h-4 w-4 text-yellow-500" />,
  COMPLETED: <CheckCircle className="h-4 w-4 text-blue-500" />,
  ARCHIVED: <Archive className="h-4 w-4 text-gray-500" />,
};

// Invite Member Dialog
interface InviteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (userId: string, role: MemberRole) => Promise<void>;
}

function InviteMemberDialog({ open, onOpenChange, onSubmit }: InviteMemberDialogProps) {
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<MemberRole>('VIEWER');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId.trim()) return;

    setIsSubmitting(true);
    try {
      await onSubmit(userId.trim(), role);
      setUserId('');
      setRole('VIEWER');
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>멤버 초대</DialogTitle>
          <DialogDescription>
            프로젝트에 새 멤버를 초대합니다.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="userId">사용자 ID</Label>
              <Input
                id="userId"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="초대할 사용자 ID 입력"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="role">역할</Label>
              <Select value={role} onValueChange={(v) => setRole(v as MemberRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">관리자</SelectItem>
                  <SelectItem value="EDITOR">편집자</SelectItem>
                  <SelectItem value="VIEWER">뷰어</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {role === 'ADMIN' && '모든 권한을 가집니다.'}
                {role === 'EDITOR' && '항목을 추가/수정할 수 있습니다.'}
                {role === 'VIEWER' && '항목을 조회만 할 수 있습니다.'}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" disabled={!userId.trim() || isSubmitting}>
              {isSubmitting ? '초대 중...' : '초대하기'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Member Row Component
interface MemberRowProps {
  member: ProjectMember;
  isOwner: boolean;
  canManage: boolean;
  onUpdateRole: (role: MemberRole) => void;
  onRemove: () => void;
}

function MemberRow({ member, isOwner, canManage, onUpdateRole, onRemove }: MemberRowProps) {
  return (
    <div className="flex items-center justify-between py-3 px-4 bg-muted/30 rounded-lg">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
          <span className="text-lg font-medium">
            {member.userId.charAt(0).toUpperCase()}
          </span>
        </div>
        <div>
          <p className="font-medium">{member.userId}</p>
          <p className="text-sm text-muted-foreground">
            {new Date(member.joinedAt).toLocaleDateString('ko-KR')} 참여
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {isOwner ? (
          <Badge>소유자</Badge>
        ) : canManage ? (
          <>
            <Select
              value={member.role}
              onValueChange={(v) => onUpdateRole(v as MemberRole)}
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN">관리자</SelectItem>
                <SelectItem value="EDITOR">편집자</SelectItem>
                <SelectItem value="VIEWER">뷰어</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" onClick={onRemove}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </>
        ) : (
          <Badge variant="outline">{MEMBER_ROLE_LABELS[member.role]}</Badge>
        )}
      </div>
    </div>
  );
}

// Main ProjectSettings Page
const ProjectSettings = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const projectId = id ? parseInt(id, 10) : null;

  // Get initial tab from URL hash
  const initialTab = location.hash.replace('#', '') || 'general';

  const {
    currentProject,
    loading,
    error,
    selectProject,
    updateProjectAction,
    deleteProjectAction,
    // Members
    members,
    loadMembers,
    inviteMember,
    removeMember,
    updateMemberRole,
  } = useProjects({ autoLoad: false });

  const [activeTab, setActiveTab] = useState(initialTab);
  const [isSaving, setIsSaving] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [removeMemberTarget, setRemoveMemberTarget] = useState<ProjectMember | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'RESEARCH' as ProjectCategory,
    visibility: 'PRIVATE' as ProjectVisibility,
    status: 'ACTIVE' as ProjectStatus,
  });

  // Load project data
  useEffect(() => {
    if (projectId) {
      selectProject(projectId);
      loadMembers(projectId);
    }
  }, [projectId, selectProject, loadMembers]);

  // Initialize form when project loads
  useEffect(() => {
    if (currentProject) {
      setFormData({
        name: currentProject.name,
        description: currentProject.description || '',
        category: currentProject.category,
        visibility: currentProject.visibility,
        status: currentProject.status,
      });
    }
  }, [currentProject]);

  // Handle tab change
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    window.history.replaceState(null, '', `#${tab}`);
  };

  // Handle save
  const handleSave = async () => {
    if (!projectId) return;

    setIsSaving(true);
    try {
      await updateProjectAction(projectId, {
        name: formData.name,
        description: formData.description || undefined,
        category: formData.category,
        visibility: formData.visibility,
        status: formData.status,
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Handle delete
  const handleDelete = async () => {
    if (!projectId) return;

    const success = await deleteProjectAction(projectId);
    if (success) {
      navigate('/projects');
    }
  };

  // Handle invite member
  const handleInviteMember = async (userId: string, role: MemberRole) => {
    if (!projectId) return;
    await inviteMember(projectId, userId, role);
  };

  // Handle update member role
  const handleUpdateMemberRole = async (memberUserId: string, role: MemberRole) => {
    if (!projectId) return;
    await updateMemberRole(projectId, memberUserId, role);
  };

  // Handle remove member
  const handleRemoveMember = async () => {
    if (!projectId || !removeMemberTarget) return;
    await removeMember(projectId, removeMemberTarget.userId);
    setRemoveMemberTarget(null);
  };

  // Check if current user is owner (simplified - in real app, check against actual user)
  const isOwner = currentProject?.ownerId === 'anonymous'; // Simplified check
  const canManageMembers = isOwner || members.some(m => m.userId === 'anonymous' && m.role === 'ADMIN');

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
        <div className="container mx-auto px-4 max-w-4xl">
          <Skeleton className="h-8 w-32 mb-4" />
          <Skeleton className="h-12 w-64 mb-8" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  if (error || !currentProject) {
    return (
      <div className="min-h-screen py-8">
        <div className="container mx-auto px-4 max-w-4xl">
          <Card className="border-destructive">
            <CardContent className="py-8 text-center">
              <p className="text-destructive mb-4">{error || '프로젝트를 찾을 수 없습니다.'}</p>
              <Button onClick={() => navigate('/projects')}>
                프로젝트 목록으로
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-8">
      <div className="container mx-auto px-4 max-w-4xl">
        {/* Header */}
        <header className="mb-8">
          <Link
            to={`/projects/${projectId}`}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            프로젝트로 돌아가기
          </Link>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Settings className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">프로젝트 설정</h1>
              <p className="text-muted-foreground">{currentProject.name}</p>
            </div>
          </div>
        </header>

        {/* Settings Tabs */}
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="mb-6">
            <TabsTrigger value="general">
              <FolderOpen className="h-4 w-4 mr-2" />
              일반
            </TabsTrigger>
            <TabsTrigger value="members">
              <Users className="h-4 w-4 mr-2" />
              멤버
            </TabsTrigger>
            <TabsTrigger value="danger">
              <Shield className="h-4 w-4 mr-2" />
              위험 구역
            </TabsTrigger>
          </TabsList>

          {/* General Settings */}
          <TabsContent value="general">
            <Card>
              <CardHeader>
                <CardTitle>기본 정보</CardTitle>
                <CardDescription>
                  프로젝트의 기본 정보를 수정합니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-2">
                  <Label htmlFor="name">프로젝트 이름</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="description">설명</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={3}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>카테고리</Label>
                    <Select
                      value={formData.category}
                      onValueChange={(v) => setFormData({ ...formData, category: v as ProjectCategory })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(PROJECT_CATEGORY_LABELS) as ProjectCategory[]).map((cat) => (
                          <SelectItem key={cat} value={cat}>
                            {PROJECT_CATEGORY_LABELS[cat]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-2">
                    <Label>공개 범위</Label>
                    <Select
                      value={formData.visibility}
                      onValueChange={(v) => setFormData({ ...formData, visibility: v as ProjectVisibility })}
                    >
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

                <div className="grid gap-2">
                  <Label>상태</Label>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((status) => (
                      <Button
                        key={status}
                        type="button"
                        variant={formData.status === status ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setFormData({ ...formData, status })}
                        className="gap-2"
                      >
                        {STATUS_ICONS[status]}
                        {PROJECT_STATUS_LABELS[status]}
                      </Button>
                    ))}
                  </div>
                </div>

                <Separator />

                <div className="flex justify-end">
                  <Button onClick={handleSave} disabled={isSaving}>
                    <Save className="h-4 w-4 mr-2" />
                    {isSaving ? '저장 중...' : '변경사항 저장'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Members Settings */}
          <TabsContent value="members">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>프로젝트 멤버</CardTitle>
                    <CardDescription>
                      프로젝트에 참여하는 멤버를 관리합니다.
                    </CardDescription>
                  </div>
                  {canManageMembers && (
                    <Button onClick={() => setInviteDialogOpen(true)}>
                      <UserPlus className="h-4 w-4 mr-2" />
                      멤버 초대
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {members.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      아직 멤버가 없습니다.
                    </p>
                  ) : (
                    members.map((member) => (
                      <MemberRow
                        key={member.id}
                        member={member}
                        isOwner={member.role === 'OWNER' || member.userId === currentProject.ownerId}
                        canManage={canManageMembers && member.userId !== currentProject.ownerId}
                        onUpdateRole={(role) => handleUpdateMemberRole(member.userId, role)}
                        onRemove={() => setRemoveMemberTarget(member)}
                      />
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Danger Zone */}
          <TabsContent value="danger">
            <Card className="border-destructive">
              <CardHeader>
                <CardTitle className="text-destructive">위험 구역</CardTitle>
                <CardDescription>
                  아래 작업은 되돌릴 수 없습니다. 신중하게 진행해주세요.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between p-4 border border-destructive/50 rounded-lg">
                  <div>
                    <h4 className="font-medium">프로젝트 보관</h4>
                    <p className="text-sm text-muted-foreground">
                      프로젝트를 보관 상태로 변경합니다. 나중에 복원할 수 있습니다.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setFormData({ ...formData, status: 'ARCHIVED' });
                      handleSave();
                    }}
                    disabled={formData.status === 'ARCHIVED'}
                  >
                    <Archive className="h-4 w-4 mr-2" />
                    보관하기
                  </Button>
                </div>

                <div className="flex items-center justify-between p-4 border border-destructive rounded-lg bg-destructive/5">
                  <div>
                    <h4 className="font-medium text-destructive">프로젝트 삭제</h4>
                    <p className="text-sm text-muted-foreground">
                      프로젝트와 모든 항목이 영구적으로 삭제됩니다.
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    삭제하기
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Invite Member Dialog */}
        <InviteMemberDialog
          open={inviteDialogOpen}
          onOpenChange={setInviteDialogOpen}
          onSubmit={handleInviteMember}
        />

        {/* Remove Member Confirmation */}
        <AlertDialog open={!!removeMemberTarget} onOpenChange={() => setRemoveMemberTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>멤버 제거</AlertDialogTitle>
              <AlertDialogDescription>
                "{removeMemberTarget?.userId}" 멤버를 프로젝트에서 제거하시겠습니까?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction onClick={handleRemoveMember}>
                제거
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete Project Confirmation */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>프로젝트 삭제</AlertDialogTitle>
              <AlertDialogDescription>
                "{currentProject.name}" 프로젝트를 삭제하시겠습니까?
                이 작업은 되돌릴 수 없으며, 프로젝트의 모든 항목이 함께 삭제됩니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
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

export default ProjectSettings;
