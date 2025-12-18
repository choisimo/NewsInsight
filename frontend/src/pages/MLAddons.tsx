import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Cpu,
  Activity,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  MessageSquare,
  Shield,
  Scale,
  Zap,
  Settings,
  TrendingUp,
  Clock,
  BarChart3,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { useMlAddons, useMlAddonStatus, useMlExecutions } from '@/hooks/useMlAddons';
import { getCategoryLabel, getExecutionStatusLabel, getExecutionStatusColor } from '@/lib/api/ml';
import type { MlAddon, AddonCategory, MlAddonExecution } from '@/types/api';

// ============================================
// Category Icon Helper
// ============================================

const getCategoryIcon = (category: AddonCategory) => {
  switch (category) {
    case 'SENTIMENT':
      return <MessageSquare className="h-5 w-5" />;
    case 'FACTCHECK':
      return <Shield className="h-5 w-5" />;
    case 'CONTEXT':
      return <Scale className="h-5 w-5" />;
    case 'TOXICITY':
    case 'MISINFORMATION':
      return <AlertCircle className="h-5 w-5" />;
    case 'SUMMARIZATION':
      return <BarChart3 className="h-5 w-5" />;
    default:
      return <Cpu className="h-5 w-5" />;
  }
};

const getCategoryColor = (category: AddonCategory) => {
  switch (category) {
    case 'SENTIMENT':
      return 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300';
    case 'FACTCHECK':
      return 'bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300';
    case 'CONTEXT':
      return 'bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300';
    case 'TOXICITY':
    case 'MISINFORMATION':
      return 'bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300';
    case 'SUMMARIZATION':
      return 'bg-amber-100 text-amber-600 dark:bg-amber-900 dark:text-amber-300';
    default:
      return 'bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-300';
  }
};

// ============================================
// ML Add-on Card Component
// ============================================

interface MLAddonCardProps {
  addon: MlAddon;
  isToggling: boolean;
  onToggle: (addonKey: string) => void;
}

const MLAddonCard: React.FC<MLAddonCardProps> = ({
  addon,
  isToggling,
  onToggle,
}) => {
  const getHealthStatusIcon = () => {
    switch (addon.healthStatus) {
      case 'HEALTHY':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'UNHEALTHY':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'DEGRADED':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getHealthStatusBadge = () => {
    switch (addon.healthStatus) {
      case 'HEALTHY':
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">정상</Badge>;
      case 'UNHEALTHY':
        return <Badge variant="destructive">오프라인</Badge>;
      case 'DEGRADED':
        return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100">저하</Badge>;
      default:
        return <Badge variant="outline">미확인</Badge>;
    }
  };

  return (
    <Card className={!addon.enabled ? 'opacity-60' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${getCategoryColor(addon.category)}`}>
              {getCategoryIcon(addon.category)}
            </div>
            <div>
              <CardTitle className="text-base">{addon.name}</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {getCategoryLabel(addon.category)}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {getHealthStatusIcon()}
            {getHealthStatusBadge()}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {addon.description || '설명 없음'}
        </p>
        
        {/* Metrics */}
        {addon.successRate != null && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span>성공률</span>
              <span>{(addon.successRate * 100).toFixed(1)}%</span>
            </div>
            <Progress value={addon.successRate * 100} className="h-1" />
          </div>
        )}

        {addon.avgLatencyMs != null && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>평균 응답: {addon.avgLatencyMs.toFixed(0)}ms</span>
          </div>
        )}
        
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Switch
              id={`addon-${addon.addonKey}`}
              checked={addon.enabled}
              onCheckedChange={() => onToggle(addon.addonKey)}
              disabled={isToggling}
            />
            <Label htmlFor={`addon-${addon.addonKey}`} className="text-sm">
              {addon.enabled ? '활성화됨' : '비활성화됨'}
            </Label>
          </div>
          
          {addon.priority != null && (
            <Badge variant="outline" className="text-xs">
              우선순위: {addon.priority}
            </Badge>
          )}
        </div>

        {addon.healthStatus === 'UNHEALTHY' && (
          <Alert variant="destructive" className="py-2">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              서비스에 연결할 수 없습니다. Docker 컨테이너가 실행 중인지 확인하세요.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};

// ============================================
// Execution History Item
// ============================================

interface ExecutionItemProps {
  execution: MlAddonExecution;
}

const ExecutionItem: React.FC<ExecutionItemProps> = ({ execution }) => {
  const statusColor = getExecutionStatusColor(execution.status);
  
  return (
    <div className="flex items-center justify-between p-2 rounded border bg-card">
      <div className="flex items-center gap-2">
        <Badge 
          variant="outline" 
          className={`bg-${statusColor}-100 text-${statusColor}-800 dark:bg-${statusColor}-900 dark:text-${statusColor}-100 text-xs`}
        >
          {getExecutionStatusLabel(execution.status)}
        </Badge>
        <span className="text-sm font-medium">{execution.addonKey}</span>
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {execution.executionTimeMs && (
          <span>{execution.executionTimeMs}ms</span>
        )}
        <span>{new Date(execution.createdAt).toLocaleTimeString('ko-KR')}</span>
      </div>
    </div>
  );
};

// ============================================
// ML Add-ons Page Component
// ============================================

const MLAddons = () => {
  const { toast } = useToast();
  
  // ML Add-ons hooks
  const {
    addons,
    loading: addonsLoading,
    error: addonsError,
    refresh: refreshAddons,
    toggle,
    groupedByCategory,
  } = useMlAddons({ autoRefresh: true, refreshInterval: 30000 });

  const {
    status,
    loading: statusLoading,
    refresh: refreshStatus,
    runHealthCheck,
  } = useMlAddonStatus();

  const {
    executions,
    loading: executionsLoading,
    refresh: refreshExecutions,
  } = useMlExecutions({ size: 10, autoRefresh: true, refreshInterval: 10000 });

  const [isToggling, setIsToggling] = React.useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [isHealthChecking, setIsHealthChecking] = React.useState(false);

  const handleToggle = async (addonKey: string) => {
    setIsToggling(addonKey);
    try {
      await toggle(addonKey);
      const addon = addons.find(a => a.addonKey === addonKey);
      toast({
        title: addon?.enabled ? 'Add-on 비활성화됨' : 'Add-on 활성화됨',
        description: `${addon?.name} Add-on이 ${addon?.enabled ? '비활성화' : '활성화'}되었습니다.`,
      });
    } catch (e) {
      toast({
        title: '상태 변경 실패',
        description: e instanceof Error ? e.message : '알 수 없는 오류',
        variant: 'destructive',
      });
    } finally {
      setIsToggling(null);
    }
  };

  const handleRefreshAll = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([refreshAddons(), refreshStatus(), refreshExecutions()]);
      toast({ title: '새로고침 완료' });
    } catch (e) {
      toast({
        title: '새로고침 실패',
        variant: 'destructive',
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleHealthCheck = async () => {
    setIsHealthChecking(true);
    try {
      await runHealthCheck();
      toast({ title: '헬스체크 완료', description: '모든 Add-on 상태가 업데이트되었습니다.' });
    } catch (e) {
      toast({
        title: '헬스체크 실패',
        variant: 'destructive',
      });
    } finally {
      setIsHealthChecking(false);
    }
  };

  // Calculate stats
  const healthyCount = addons.filter(a => a.healthStatus === 'HEALTHY').length;
  const enabledCount = addons.filter(a => a.enabled).length;
  const totalCount = addons.length;

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
            검색으로 돌아가기
          </Link>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Cpu className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-3xl font-bold">ML Add-ons</h1>
                <p className="text-muted-foreground">
                  뉴스 분석을 위한 머신러닝 서비스를 관리합니다.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleHealthCheck}
                disabled={isHealthChecking}
              >
                {isHealthChecking ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Activity className="h-4 w-4 mr-2" />
                )}
                헬스체크
              </Button>
              <Link to="/settings">
                <Button variant="outline" size="sm">
                  <Settings className="h-4 w-4 mr-2" />
                  전체 설정
                </Button>
              </Link>
            </div>
          </div>
        </header>

        {/* Overview Card */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  ML Add-on 상태
                </CardTitle>
                <CardDescription>
                  뉴스 분석에 사용되는 ML Add-on 서비스 상태를 확인하고 관리합니다.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                onClick={handleRefreshAll}
                disabled={isRefreshing}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                전체 새로고침
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="flex items-center gap-2">
                <div className={`h-3 w-3 rounded-full ${
                  healthyCount === totalCount ? 'bg-green-500' :
                  healthyCount > 0 ? 'bg-yellow-500' : 'bg-red-500'
                }`} />
                <span className="text-sm font-medium">
                  {healthyCount}/{totalCount} 서비스 정상
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Zap className="h-4 w-4" />
                활성화된 Add-on: {enabledCount}개
              </div>
              {status && (
                <>
                  {status.totalExecutionsToday != null && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <TrendingUp className="h-4 w-4" />
                      오늘 실행: {status.totalExecutionsToday.toLocaleString()}회
                    </div>
                  )}
                  {status.successRate != null && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <BarChart3 className="h-4 w-4" />
                      성공률: {status.successRate.toFixed(1)}%
                    </div>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Error Alert */}
        {addonsError && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Add-on 목록을 불러오는데 실패했습니다: {addonsError.message}
            </AlertDescription>
          </Alert>
        )}

        {/* Loading State */}
        {addonsLoading && addons.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Add-on Cards - 2 columns */}
            <div className="lg:col-span-2">
              <h2 className="text-lg font-semibold mb-4">등록된 Add-on</h2>
              {addons.length === 0 ? (
                <Card className="p-8 text-center text-muted-foreground">
                  등록된 ML Add-on이 없습니다.
                </Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {addons.map((addon) => (
                    <MLAddonCard
                      key={addon.addonKey}
                      addon={addon}
                      isToggling={isToggling === addon.addonKey}
                      onToggle={handleToggle}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Recent Executions - 1 column */}
            <div className="lg:col-span-1">
              <h2 className="text-lg font-semibold mb-4">최근 실행 내역</h2>
              <Card>
                <CardContent className="p-4">
                  <ScrollArea className="h-[400px]">
                    {executionsLoading && executions.length === 0 ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : executions.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        실행 내역이 없습니다.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {executions.map((execution) => (
                          <ExecutionItem key={execution.id} execution={execution} />
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Help */}
        <Alert className="mt-6">
          <Zap className="h-4 w-4" />
          <AlertDescription>
            <strong>ML Add-on 실행 방법:</strong> <code className="px-1 py-0.5 bg-muted rounded text-xs">cd backend/ml-addons && docker-compose up -d</code>
            <br />
            <span className="text-muted-foreground">
              ML Add-on은 Docker 컨테이너로 실행됩니다. API Gateway를 통해 자동으로 라우팅됩니다.
            </span>
          </AlertDescription>
        </Alert>

        {/* Feature Description */}
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-blue-500" />
                감성 분석
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                뉴스 기사의 감성(긍정/부정/중립)을 분석하여 기사의 톤을 파악합니다.
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4 text-green-500" />
                팩트체크
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                기사 내 주장의 사실 여부를 검증하고 신뢰도 점수를 제공합니다.
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Scale className="h-4 w-4 text-purple-500" />
                편향성 분석
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                기사의 정치적 편향성을 분석하여 객관적인 정보 판단을 돕습니다.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default MLAddons;
