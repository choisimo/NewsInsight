import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { authApi } from '@/lib/adminApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Shield, AlertCircle, CheckCircle2, KeyRound } from 'lucide-react';

export default function AdminSetup() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validatePassword = (password: string): string | null => {
    if (password.length < 8) {
      return '비밀번호는 최소 8자 이상이어야 합니다.';
    }
    if (!/[A-Za-z]/.test(password)) {
      return '비밀번호에 영문자가 포함되어야 합니다.';
    }
    if (!/[0-9]/.test(password)) {
      return '비밀번호에 숫자가 포함되어야 합니다.';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate passwords match
    if (newPassword !== confirmPassword) {
      setError('새 비밀번호가 일치하지 않습니다.');
      return;
    }

    // Validate password strength
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    // Prevent using the same password
    if (currentPassword === newPassword) {
      setError('새 비밀번호는 현재 비밀번호와 달라야 합니다.');
      return;
    }

    setIsSubmitting(true);

    try {
      await authApi.changePassword(currentPassword, newPassword);
      
      // Refresh user to get updated password_change_required status
      await refreshUser();
      
      // Navigate to admin dashboard
      navigate('/admin/environments', { replace: true });
    } catch (err) {
      console.error('Password change failed:', err);
      if (err instanceof Error) {
        if (err.message.includes('400') || err.message.includes('Invalid old password')) {
          setError('현재 비밀번호가 올바르지 않습니다.');
        } else {
          setError(err.message);
        }
      } else {
        setError('비밀번호 변경 중 오류가 발생했습니다.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const passwordStrength = newPassword.length > 0 ? validatePassword(newPassword) === null : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
            <KeyRound className="h-6 w-6 text-amber-500" />
          </div>
          <CardTitle className="text-2xl font-bold">초기 설정</CardTitle>
          <CardDescription>
            보안을 위해 기본 비밀번호를 변경해주세요
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert className="mb-6 border-amber-500/50 bg-amber-500/10">
            <Shield className="h-4 w-4 text-amber-500" />
            <AlertDescription className="text-amber-700 dark:text-amber-300">
              <strong>{user?.username}</strong> 계정의 기본 비밀번호를 변경해야 관리자 대시보드를 사용할 수 있습니다.
            </AlertDescription>
          </Alert>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="currentPassword">현재 비밀번호</Label>
              <Input
                id="currentPassword"
                type="password"
                placeholder="admin123"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={isSubmitting}
                autoComplete="current-password"
                autoFocus
                required
              />
              <p className="text-xs text-muted-foreground">
                기본 비밀번호: <code className="bg-muted px-1 py-0.5 rounded">admin123</code>
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="newPassword">새 비밀번호</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={isSubmitting}
                autoComplete="new-password"
                required
              />
              {newPassword.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  {passwordStrength ? (
                    <>
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                      <span className="text-green-600 dark:text-green-400">안전한 비밀번호입니다</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-3 w-3 text-amber-500" />
                      <span className="text-amber-600 dark:text-amber-400">
                        8자 이상, 영문자와 숫자 포함 필요
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">새 비밀번호 확인</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isSubmitting}
                autoComplete="new-password"
                required
              />
              {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                <div className="flex items-center gap-2 text-xs">
                  <AlertCircle className="h-3 w-3 text-red-500" />
                  <span className="text-red-600 dark:text-red-400">비밀번호가 일치하지 않습니다</span>
                </div>
              )}
              {confirmPassword.length > 0 && newPassword === confirmPassword && (
                <div className="flex items-center gap-2 text-xs">
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                  <span className="text-green-600 dark:text-green-400">비밀번호가 일치합니다</span>
                </div>
              )}
            </div>
            
            <Button 
              type="submit" 
              className="w-full" 
              disabled={isSubmitting || !currentPassword || !newPassword || !confirmPassword || newPassword !== confirmPassword || !passwordStrength}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  변경 중...
                </>
              ) : (
                '비밀번호 변경 및 시작하기'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
