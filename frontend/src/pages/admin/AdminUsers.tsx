import { useEffect, useState } from 'react';
import {
  User as UserIcon,
  Plus,
  Pencil,
  Trash2,
  RotateCcw,
  Shield,
  Key,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { usersApi } from '@/lib/adminApi';
import type { User, UserRole } from '@/types/admin';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

const ROLE_LABELS: Record<UserRole, string> = {
  user: '일반 사용자',
  viewer: '뷰어',
  operator: '운영자',
  admin: '관리자',
};

const ROLE_COLORS: Record<UserRole, string> = {
  user: 'bg-gray-100 text-gray-800',
  viewer: 'bg-blue-100 text-blue-800',
  operator: 'bg-yellow-100 text-yellow-800',
  admin: 'bg-red-100 text-red-800',
};

export default function AdminUsers() {
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Create/Edit dialog states
  const [showDialog, setShowDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userForm, setUserForm] = useState({
    username: '',
    email: '',
    password: '',
    role: 'user' as UserRole,
    is_active: true,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Password reset dialog
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [passwordResetUser, setPasswordResetUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  
  // Delete dialog
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setIsLoading(true);
    try {
      const data = await usersApi.list();
      setUsers(data);
    } catch (error) {
      console.error('Failed to load users:', error);
      toast({
        title: "로드 실패",
        description: "사용자 목록을 불러오는데 실패했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const openCreateDialog = () => {
    setEditingUser(null);
    setUserForm({
      username: '',
      email: '',
      password: '',
      role: 'user',
      is_active: true,
    });
    setShowDialog(true);
  };

  const openEditDialog = (user: User) => {
    setEditingUser(user);
    setUserForm({
      username: user.username,
      email: user.email || '',
      password: '',
      role: user.role,
      is_active: user.is_active,
    });
    setShowDialog(true);
  };

  const handleSaveUser = async () => {
    if (!userForm.username) {
      toast({
        title: "입력 오류",
        description: "사용자명은 필수입니다.",
        variant: "destructive",
      });
      return;
    }

    if (!editingUser && !userForm.password) {
      toast({
        title: "입력 오류",
        description: "새 사용자의 비밀번호는 필수입니다.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingUser) {
        await usersApi.update(editingUser.id, {
          email: userForm.email || undefined,
          role: userForm.role,
          is_active: userForm.is_active,
        });
        toast({
          title: "사용자 수정 완료",
          description: `'${userForm.username}' 사용자가 수정되었습니다.`,
        });
      } else {
        await usersApi.create({
          username: userForm.username,
          password: userForm.password,
          email: userForm.email || undefined,
          role: userForm.role,
        });
        toast({
          title: "사용자 등록 완료",
          description: `'${userForm.username}' 사용자가 등록되었습니다.`,
        });
      }
      
      setShowDialog(false);
      loadUsers();
    } catch (error) {
      console.error('Failed to save user:', error);
      toast({
        title: editingUser ? "수정 실패" : "등록 실패",
        description: error instanceof Error ? error.message : '사용자 저장에 실패했습니다.',
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!passwordResetUser || !newPassword) return;

    try {
      await usersApi.resetPassword(passwordResetUser.id, newPassword);
      toast({
        title: "비밀번호 재설정 완료",
        description: `'${passwordResetUser.username}' 사용자의 비밀번호가 재설정되었습니다.`,
      });
      setShowPasswordDialog(false);
      setNewPassword('');
      setPasswordResetUser(null);
    } catch (error) {
      console.error('Failed to reset password:', error);
      toast({
        title: "비밀번호 재설정 실패",
        description: error instanceof Error ? error.message : '비밀번호 재설정에 실패했습니다.',
        variant: "destructive",
      });
    }
  };

  const handleDeleteUser = async () => {
    if (!deletingUser) return;

    try {
      await usersApi.delete(deletingUser.id);
      toast({
        title: "사용자 삭제 완료",
        description: `'${deletingUser.username}' 사용자가 삭제되었습니다.`,
      });
      setShowDeleteDialog(false);
      setDeletingUser(null);
      loadUsers();
    } catch (error) {
      console.error('Failed to delete user:', error);
      toast({
        title: "삭제 실패",
        description: error instanceof Error ? error.message : '사용자 삭제에 실패했습니다.',
        variant: "destructive",
      });
    }
  };

  const handleToggleActive = async (user: User) => {
    try {
      await usersApi.update(user.id, { is_active: !user.is_active });
      toast({
        title: user.is_active ? "사용자 비활성화" : "사용자 활성화",
        description: `'${user.username}' 사용자가 ${user.is_active ? '비활성화' : '활성화'}되었습니다.`,
      });
      loadUsers();
    } catch (error) {
      console.error('Failed to toggle user status:', error);
      toast({
        title: "상태 변경 실패",
        description: error instanceof Error ? error.message : '사용자 상태 변경에 실패했습니다.',
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 container mx-auto p-4">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">사용자 관리</h1>
        <div className="flex items-center gap-2">
          <Button onClick={openCreateDialog}>
            <Plus className="w-4 h-4 mr-2" />
            사용자 등록
          </Button>
          <Button variant="outline" onClick={loadUsers}>
            <RotateCcw className="w-4 h-4 mr-2" />
            새로고침
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserIcon className="w-5 h-5" />
            사용자 목록 ({users.length}명)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>사용자명</TableHead>
                  <TableHead>이메일</TableHead>
                  <TableHead>역할</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>가입일</TableHead>
                  <TableHead>최근 로그인</TableHead>
                  <TableHead className="text-right">관리</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center h-24 text-muted-foreground">
                      등록된 사용자가 없습니다.
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.username}</TableCell>
                      <TableCell>{user.email || '-'}</TableCell>
                      <TableCell>
                        <Badge className={ROLE_COLORS[user.role]}>
                          {ROLE_LABELS[user.role]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {user.is_active ? (
                            <CheckCircle className="w-4 h-4 text-green-500" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-500" />
                          )}
                          <span className={user.is_active ? 'text-green-600' : 'text-red-600'}>
                            {user.is_active ? '활성' : '비활성'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(user.created_at), 'yyyy-MM-dd')}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {user.last_login ? format(new Date(user.last_login), 'yyyy-MM-dd HH:mm') : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              관리
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditDialog(user)}>
                              <Pencil className="w-4 h-4 mr-2" />
                              편집
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => {
                              setPasswordResetUser(user);
                              setShowPasswordDialog(true);
                            }}>
                              <Key className="w-4 h-4 mr-2" />
                              비밀번호 재설정
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleToggleActive(user)}>
                              <Shield className="w-4 h-4 mr-2" />
                              {user.is_active ? '비활성화' : '활성화'}
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={() => {
                                setDeletingUser(user);
                                setShowDeleteDialog(true);
                              }}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              삭제
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Create/Edit User Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingUser ? '사용자 수정' : '새 사용자 등록'}</DialogTitle>
            <DialogDescription>
              {editingUser ? '사용자 정보를 수정합니다.' : '새로운 사용자를 등록합니다.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="username">사용자명 *</Label>
              <Input
                id="username"
                value={userForm.username}
                onChange={(e) => setUserForm(prev => ({ ...prev, username: e.target.value }))}
                placeholder="사용자명"
                disabled={isSubmitting || !!editingUser}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">이메일</Label>
              <Input
                id="email"
                type="email"
                value={userForm.email}
                onChange={(e) => setUserForm(prev => ({ ...prev, email: e.target.value }))}
                placeholder="user@example.com"
                disabled={isSubmitting}
              />
            </div>

            {!editingUser && (
              <div className="space-y-2">
                <Label htmlFor="password">비밀번호 *</Label>
                <Input
                  id="password"
                  type="password"
                  value={userForm.password}
                  onChange={(e) => setUserForm(prev => ({ ...prev, password: e.target.value }))}
                  placeholder="비밀번호"
                  disabled={isSubmitting}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>역할</Label>
              <Select
                value={userForm.role}
                onValueChange={(value: UserRole) => setUserForm(prev => ({ ...prev, role: value }))}
                disabled={isSubmitting}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">일반 사용자</SelectItem>
                  <SelectItem value="viewer">뷰어</SelectItem>
                  <SelectItem value="operator">운영자</SelectItem>
                  <SelectItem value="admin">관리자</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {editingUser && (
              <div className="flex items-center justify-between">
                <Label htmlFor="is_active">활성 상태</Label>
                <Switch
                  id="is_active"
                  checked={userForm.is_active}
                  onCheckedChange={(checked) => setUserForm(prev => ({ ...prev, is_active: checked }))}
                  disabled={isSubmitting}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={isSubmitting}>
              취소
            </Button>
            <Button onClick={handleSaveUser} disabled={isSubmitting}>
              {isSubmitting ? '저장 중...' : (editingUser ? '수정' : '등록')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password Reset Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>비밀번호 재설정</DialogTitle>
            <DialogDescription>
              '{passwordResetUser?.username}' 사용자의 새 비밀번호를 입력하세요.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">새 비밀번호</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="새 비밀번호"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowPasswordDialog(false);
              setNewPassword('');
            }}>
              취소
            </Button>
            <Button onClick={handleResetPassword} disabled={!newPassword}>
              재설정
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>사용자 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              정말로 '{deletingUser?.username}' 사용자를 삭제하시겠습니까?
              <br />
              이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
