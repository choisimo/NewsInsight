/**
 * Register - 회원가입 페이지
 * 
 * 일반 사용자를 위한 회원가입 페이지
 * - 사용자명, 이메일, 비밀번호 입력
 * - 실시간 유효성 검사
 * - 가입 성공 시 자동 로그인 및 홈으로 이동
 */

import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Eye, EyeOff, User, Mail, Lock, CheckCircle, XCircle, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { publicAuthApi } from '@/lib/publicAuthApi';
import { useAuth } from '@/contexts/AuthContext';

interface RegisterFormData {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export default function Register() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isAuthenticated, login } = useAuth();
  
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // 중복 확인 상태
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [emailStatus, setEmailStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    setError,
  } = useForm<RegisterFormData>({
    mode: 'onChange',
  });
  
  const watchUsername = watch('username');
  const watchEmail = watch('email');
  const watchPassword = watch('password');
  
  // 이미 로그인된 경우 홈으로 리다이렉트
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);
  
  // 사용자명 중복 확인 (debounced)
  useEffect(() => {
    if (!watchUsername || watchUsername.length < 3) {
      setUsernameStatus('idle');
      return;
    }
    
    const timer = setTimeout(async () => {
      setUsernameStatus('checking');
      try {
        const result = await publicAuthApi.checkUsername(watchUsername);
        setUsernameStatus(result.available ? 'available' : 'taken');
      } catch {
        setUsernameStatus('idle');
      }
    }, 500);
    
    return () => clearTimeout(timer);
  }, [watchUsername]);
  
  // 이메일 중복 확인 (debounced)
  useEffect(() => {
    if (!watchEmail || !watchEmail.includes('@')) {
      setEmailStatus('idle');
      return;
    }
    
    const timer = setTimeout(async () => {
      setEmailStatus('checking');
      try {
        const result = await publicAuthApi.checkEmail(watchEmail);
        setEmailStatus(result.available ? 'available' : 'taken');
      } catch {
        setEmailStatus('idle');
      }
    }, 500);
    
    return () => clearTimeout(timer);
  }, [watchEmail]);
  
  const onSubmit = async (data: RegisterFormData) => {
    // 추가 유효성 검사
    if (usernameStatus === 'taken') {
      setError('username', { message: '이미 사용 중인 사용자명입니다' });
      return;
    }
    if (emailStatus === 'taken') {
      setError('email', { message: '이미 사용 중인 이메일입니다' });
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      // 회원가입 API 호출 (성공 시 토큰 반환)
      const token = await publicAuthApi.register({
        username: data.username,
        email: data.email,
        password: data.password,
      });
      
      // 토큰 저장 및 로그인 처리
      localStorage.setItem('access_token', token.access_token);
      document.cookie = `access_token=${token.access_token}; path=/; SameSite=Lax`;
      
      toast({
        title: '회원가입 완료',
        description: `환영합니다, ${data.username}님!`,
      });
      
      // 홈으로 이동 (새로고침하여 AuthContext 초기화)
      window.location.href = '/';
      
    } catch (error: any) {
      const message = error.response?.data?.detail || '회원가입에 실패했습니다. 다시 시도해주세요.';
      toast({
        variant: 'destructive',
        title: '회원가입 실패',
        description: message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const renderStatusIcon = (status: 'idle' | 'checking' | 'available' | 'taken') => {
    switch (status) {
      case 'checking':
        return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
      case 'available':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'taken':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return null;
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
          <CardTitle className="text-2xl font-bold">회원가입</CardTitle>
          <CardDescription>
            NewsInsight 계정을 만들어 검색 기록과 분석 결과를 저장하세요
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
                  placeholder="사용자명 (3자 이상)"
                  className="pl-10 pr-10"
                  {...register('username', {
                    required: '사용자명을 입력해주세요',
                    minLength: { value: 3, message: '사용자명은 3자 이상이어야 합니다' },
                    maxLength: { value: 50, message: '사용자명은 50자 이하여야 합니다' },
                    pattern: {
                      value: /^[a-zA-Z0-9_-]+$/,
                      message: '영문, 숫자, 밑줄, 하이픈만 사용 가능합니다',
                    },
                  })}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {renderStatusIcon(usernameStatus)}
                </div>
              </div>
              {errors.username && (
                <p className="text-sm text-red-500">{errors.username.message}</p>
              )}
              {usernameStatus === 'taken' && !errors.username && (
                <p className="text-sm text-red-500">이미 사용 중인 사용자명입니다</p>
              )}
              {usernameStatus === 'available' && (
                <p className="text-sm text-green-500">사용 가능한 사용자명입니다</p>
              )}
            </div>
            
            {/* 이메일 */}
            <div className="space-y-2">
              <Label htmlFor="email">이메일</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="example@email.com"
                  className="pl-10 pr-10"
                  {...register('email', {
                    required: '이메일을 입력해주세요',
                    pattern: {
                      value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                      message: '유효한 이메일 주소를 입력해주세요',
                    },
                  })}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {renderStatusIcon(emailStatus)}
                </div>
              </div>
              {errors.email && (
                <p className="text-sm text-red-500">{errors.email.message}</p>
              )}
              {emailStatus === 'taken' && !errors.email && (
                <p className="text-sm text-red-500">이미 사용 중인 이메일입니다</p>
              )}
              {emailStatus === 'available' && (
                <p className="text-sm text-green-500">사용 가능한 이메일입니다</p>
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
                  placeholder="비밀번호 (8자 이상)"
                  className="pl-10 pr-10"
                  {...register('password', {
                    required: '비밀번호를 입력해주세요',
                    minLength: { value: 8, message: '비밀번호는 8자 이상이어야 합니다' },
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
            
            {/* 비밀번호 확인 */}
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">비밀번호 확인</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="비밀번호 재입력"
                  className="pl-10 pr-10"
                  {...register('confirmPassword', {
                    required: '비밀번호를 다시 입력해주세요',
                    validate: (value) =>
                      value === watchPassword || '비밀번호가 일치하지 않습니다',
                  })}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="text-sm text-red-500">{errors.confirmPassword.message}</p>
              )}
            </div>
          </CardContent>
          
          <CardFooter className="flex flex-col gap-4">
            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting || usernameStatus === 'taken' || emailStatus === 'taken'}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  가입 중...
                </>
              ) : (
                '가입하기'
              )}
            </Button>
            
            <div className="text-center text-sm text-muted-foreground">
              이미 계정이 있으신가요?{' '}
              <Link to="/login" className="text-primary hover:underline font-medium">
                로그인
              </Link>
            </div>
            
            <div className="text-center text-xs text-muted-foreground">
              가입 없이{' '}
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
