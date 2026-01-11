import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Server,
  Users,
  FileText,
  Settings,
  Layers,
  Activity,
  Database,
  Shield,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { MCPHealthStatus } from '@/components/dashboard/MCPHealthStatus';
import { getMlAddonStatus, type MlAddonStatusSummary } from '@/lib/api/ml';
import { environmentsApi } from '@/lib/adminApi';
import type { Environment } from '@/types/admin';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [mlStatus, setMlStatus] = useState<MlAddonStatusSummary | null>(null);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setIsLoading(true);
    try {
      const [mlData, envData] = await Promise.all([
        getMlAddonStatus().catch(() => null),
        environmentsApi.list(true).catch(() => []),
      ]);
      setMlStatus(mlData);
      setEnvironments(envData);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const quickLinks = [
    {
      title: 'ML 학습 관리',
      description: 'Kaggle 데이터셋 학습 및 모델 훈련',
      icon: Layers,
      path: '/ml-training',
      color: 'text-purple-500',
      bgColor: 'bg-purple-50',
      available: true,
    },
    {
      title: 'ML Add-ons',
      description: '배포된 ML 모델 관리 및 모니터링',
      icon: Activity,
      path: '/ml-addons',
      color: 'text-blue-500',
      bgColor: 'bg-blue-50',
      available: true,
    },
    {
      title: '환경 관리',
      description: 'Docker 컨테이너 및 서비스 제어',
      icon: Server,
      path: '/admin/environments',
      color: 'text-green-500',
      bgColor: 'bg-green-50',
      available: user?.role === 'operator' || user?.role === 'admin',
    },
    {
      title: '스크립트 실행',
      description: '운영 스크립트 및 작업 관리',
      icon: FileText,
      path: '/admin/scripts',
      color: 'text-orange-500',
      bgColor: 'bg-orange-50',
      available: user?.role === 'operator' || user?.role === 'admin',
    },
    {
      title: '사용자 관리',
      description: '관리자 계정 및 권한 관리',
      icon: Users,
      path: '/admin/users',
      color: 'text-red-500',
      bgColor: 'bg-red-50',
      available: user?.role === 'admin',
    },
    {
      title: 'LLM 프로바이더',
      description: 'AI 모델 제공자 설정',
      icon: Settings,
      path: '/admin/llm-providers',
      color: 'text-indigo-500',
      bgColor: 'bg-indigo-50',
      available: user?.role === 'admin',
    },
    {
      title: '감사 로그',
      description: '시스템 활동 및 변경 이력',
      icon: Shield,
      path: '/admin/audit-logs',
      color: 'text-gray-500',
      bgColor: 'bg-gray-50',
      available: user?.role === 'admin',
    },
    {
      title: '데이터 소스',
      description: '크롤링 소스 및 URL 관리',
      icon: Database,
      path: '/admin/sources',
      color: 'text-teal-500',
      bgColor: 'bg-teal-50',
      available: true,
    },
  ];

  const availableLinks = quickLinks.filter((link) => link.available);

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <LayoutDashboard className="h-8 w-8" />
            관리자 대시보드
          </h1>
          <p className="text-muted-foreground mt-1">
            시스템 상태 모니터링 및 관리 기능
          </p>
        </div>
        <Badge variant="outline" className="text-sm">
          {user?.role === 'admin' ? '최고 관리자' : user?.role === 'operator' ? '운영자' : '뷰어'}
        </Badge>
      </div>

      {/* Status Overview */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* ML Add-ons Status */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">ML Add-ons</CardTitle>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-2xl font-bold">...</div>
            ) : mlStatus ? (
              <>
                <div className="text-2xl font-bold">
                  {mlStatus.enabledAddons} / {mlStatus.totalAddons}
                </div>
                <p className="text-xs text-muted-foreground">
                  활성화됨 · 성공률 {(mlStatus.successRate * 100).toFixed(1)}%
                </p>
                <div className="flex gap-2 mt-2">
                  <Badge variant="outline" className="text-xs">
                    <CheckCircle2 className="h-3 w-3 mr-1 text-green-500" />
                    {mlStatus.healthyAddons}
                  </Badge>
                  {mlStatus.unhealthyAddons > 0 && (
                    <Badge variant="outline" className="text-xs">
                      <XCircle className="h-3 w-3 mr-1 text-red-500" />
                      {mlStatus.unhealthyAddons}
                    </Badge>
                  )}
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">데이터 없음</div>
            )}
          </CardContent>
        </Card>

        {/* Environments Status */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">활성 환경</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{environments.length}</div>
            <p className="text-xs text-muted-foreground">
              Docker 환경 실행 중
            </p>
          </CardContent>
        </Card>

        {/* Today's Executions */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">오늘 실행</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-2xl font-bold">...</div>
            ) : mlStatus ? (
              <>
                <div className="text-2xl font-bold">
                  {mlStatus.totalExecutionsToday.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground">
                  평균 {mlStatus.avgLatencyMs.toFixed(0)}ms
                </p>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">데이터 없음</div>
            )}
          </CardContent>
        </Card>

        {/* System Health */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">시스템 상태</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-6 w-6 text-green-500" />
              <span className="text-2xl font-bold">정상</span>
            </div>
            <p className="text-xs text-muted-foreground">
              모든 서비스 운영 중
            </p>
          </CardContent>
        </Card>
      </div>

      {/* MCP Health Status */}
      <MCPHealthStatus className="w-full" />

      {/* Quick Access Links */}
      <div>
        <h2 className="text-xl font-semibold mb-4">빠른 접근</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {availableLinks.map((link) => (
            <Card
              key={link.path}
              className="cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => navigate(link.path)}
            >
              <CardHeader>
                <div className={`w-12 h-12 rounded-lg ${link.bgColor} flex items-center justify-center mb-2`}>
                  <link.icon className={`h-6 w-6 ${link.color}`} />
                </div>
                <CardTitle className="text-base">{link.title}</CardTitle>
                <CardDescription className="text-sm">
                  {link.description}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>

      {/* Recent Activity / Alerts */}
      {mlStatus && mlStatus.unhealthyAddons > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-700">
              <AlertTriangle className="h-5 w-5" />
              주의 필요
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-orange-700">
              {mlStatus.unhealthyAddons}개의 ML Add-on이 비정상 상태입니다. 
              <Button
                variant="link"
                className="p-0 h-auto text-orange-700 underline ml-1"
                onClick={() => navigate('/ml-addons')}
              >
                확인하기
              </Button>
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
