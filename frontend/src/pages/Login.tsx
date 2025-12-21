/**
 * Login - 로그인 페이지
 * 
 * 일반 사용자와 관리자 모두 사용 가능한 통합 로그인 페이지
 */

import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Eye, EyeOff, User, Lock, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { publicAuthApi } from '@/lib/publicAuthApi';
import { useAuth } from '@/contexts/AuthContext';

interface LoginFormData {
  username: string;
  password: string;
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { isAuthenticated, user, passwordChangeRequired } = useAuth();
  
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>();
  
  // 리다이렉트 대상 URL (로그인 전 방문하려던 페이지)
  const from = (location.state as any)?.from?.pathname || '/';
  
  // 이미 로그인된 경우 처리
  useEffect(() => {
    if (isAuthenticated && user) {
      // 비밀번호 변경이 필요한 경우 (기본 관리자 등)
      if (passwordChangeRequired) {
        navigate('/admin/setup');
      } else if (user.role === 'admin' || user.role === 'operator' || user.role === 'viewer') {
        // 관리자 권한이면 관리자 페이지로
        navigate('/admin/environments');
      } else {
        // 일반 사용자면 원래 목적지 또는 홈으로
        navigate(from, { replace: true });
      }
    }
  }, [isAuthenticated, user, passwordChangeRequired, navigate, from]);
  
  const onSubmit = async (data: LoginFormData) => {
    setIsSubmitting(true);
    
    try {
      // 로그인 API 호출
      const token = await publicAuthApi.login(data.username, data.password);
      
      // 토큰 저장
      localStorage.setItem('access_token', token.access_token);
      document.cookie = `access_token=${token.access_token}; path=/; SameSite=Lax`;
      
      toast({
        title: '로그인 성공',
        description: `환영합니다!`,
      });
      
      // 새로고침하여 AuthContext 초기화
      window.location.href = from;
      
    } catch (error: any) {
      const message = error.response?.data?.detail || '로그인에 실패했습니다. 아이디와 비밀번호를 확인해주세요.';
      toast({
        variant: 'destructive',
        title: '로그인 실패',
        description: message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/20 px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <img 
              src="/initial_logo-v0.1.png" 
              alt="NewsInsight" 
              className="h-12 w-12"
            />
          </div>
          <CardTitle className="text-2xl font-bold">로그인</CardTitle>
          <CardDescription>
            계정에 로그인하여 검색 기록과 분석 결과를 확인하세요
          </CardDescription>
        </CardHeader>
        
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            {/* 사용자명 */}
            <div className="space-y-2">
              <Label htmlFor="username">사용자명</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="username"
                  placeholder="사용자명 입력"
                  className="pl-10"
                  autoComplete="username"
                  {...register('username', {
                    required: '사용자명을 입력해주세요',
                  })}
                />
              </div>
              {errors.username && (
                <p className="text-sm text-red-500">{errors.username.message}</p>
              )}
            </div>
            
            {/* 비밀번호 */}
            <div className="space-y-2">
              <Label htmlFor="password">비밀번호</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="비밀번호 입력"
                  className="pl-10 pr-10"
                  autoComplete="current-password"
                  {...register('password', {
                    required: '비밀번호를 입력해주세요',
                  })}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="text-sm text-red-500">{errors.password.message}</p>
              )}
            </div>
          </CardContent>
          
          <CardFooter className="flex flex-col gap-4">
            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  로그인 중...
                </>
              ) : (
                '로그인'
              )}
            </Button>
            
            <div className="text-center text-sm text-muted-foreground">
              계정이 없으신가요?{' '}
              <Link to="/register" className="text-primary hover:underline font-medium">
                회원가입
              </Link>
            </div>
            
            <div className="text-center text-xs text-muted-foreground">
              로그인 없이{' '}
              <Link to="/" className="text-primary hover:underline">
                익명으로 사용하기
              </Link>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
