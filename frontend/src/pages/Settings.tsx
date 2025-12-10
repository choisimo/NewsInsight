import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Settings as SettingsIcon,
  Brain,
  Activity,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Server,
  Cpu,
  Shield,
  BarChart3,
  MessageSquare,
  Scale,
  Zap,
  ExternalLink,
  Globe,
  Play,
  Square,
  Clock,
  Users,
  Eye,
  Trash2,
  Monitor,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import {
  checkMLAddonHealth,
  checkAllMLAddonsHealth,
  ML_ADDON_CONFIGS,
  type MLAddonType,
  type MLAddonHealth,
  type MLAddonConfig,
  // Browser-Use APIs
  checkBrowserUseHealth,
  getBrowserUseStats,
  getActiveBrowserJobs,
  cancelBrowserJob,
  cancelAllBrowserJobs,
  type BrowserHealthResponse,
  type BrowserUseStats,
  type BrowserJobSummary,
  // API Gateway
  checkApiGatewayHealth,
} from '@/lib/api';

// ============================================
// ML Add-on Card Component
// ============================================

interface MLAddonCardProps {
  config: MLAddonConfig;
  health: MLAddonHealth | null;
  isLoading: boolean;
  enabled: boolean;
  onToggle: (id: MLAddonType, enabled: boolean) => void;
  onRefresh: (id: MLAddonType) => void;
}

const MLAddonCard: React.FC<MLAddonCardProps> = ({
  config,
  health,
  isLoading,
  enabled,
  onToggle,
  onRefresh,
}) => {
  const getIcon = () => {
    switch (config.id) {
      case 'sentiment':
        return <MessageSquare className="h-5 w-5" />;
      case 'factcheck':
        return <Shield className="h-5 w-5" />;
      case 'bias':
        return <Scale className="h-5 w-5" />;
      default:
        return <Cpu className="h-5 w-5" />;
    }
  };

  const getStatusIcon = () => {
    if (isLoading) {
      return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    }
    if (!health) {
      return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
    }
    switch (health.status) {
      case 'healthy':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'unhealthy':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
    }
  };

  const getStatusBadge = () => {
    if (isLoading) {
      return <Badge variant="secondary">확인 중...</Badge>;
    }
    if (!health) {
      return <Badge variant="outline">미확인</Badge>;
    }
    switch (health.status) {
      case 'healthy':
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">정상</Badge>;
      case 'unhealthy':
        return <Badge variant="destructive">오프라인</Badge>;
      default:
        return <Badge variant="outline">알 수 없음</Badge>;
    }
  };

  return (
    <Card className={!enabled ? 'opacity-60' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${
              config.id === 'sentiment' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300' :
              config.id === 'factcheck' ? 'bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300' :
              'bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300'
            }`}>
              {getIcon()}
            </div>
            <div>
              <CardTitle className="text-base">{config.name}</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Port: {config.port}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            {getStatusBadge()}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {config.description}
        </p>
        
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Switch
              id={`addon-${config.id}`}
              checked={enabled}
              onCheckedChange={(checked) => onToggle(config.id, checked)}
            />
            <Label htmlFor={`addon-${config.id}`} className="text-sm">
              {enabled ? '활성화됨' : '비활성화됨'}
            </Label>
          </div>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRefresh(config.id)}
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>상태 새로고침</TooltipContent>
          </Tooltip>
        </div>

        {health?.status === 'unhealthy' && (
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
// Settings Page Component
// ============================================

const Settings = () => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('ml-addons');
  
  // ML Add-ons state
  const [addonHealth, setAddonHealth] = useState<Record<MLAddonType, MLAddonHealth | null>>({
    sentiment: null,
    factcheck: null,
    bias: null,
  });
  const [addonEnabled, setAddonEnabled] = useState<Record<MLAddonType, boolean>>(() => {
    // Load from localStorage
    const saved = localStorage.getItem('newsinsight-ml-addons-enabled');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // ignore
      }
    }
    return {
      sentiment: true,
      factcheck: true,
      bias: true,
    };
  });
  const [loadingAddons, setLoadingAddons] = useState<Set<MLAddonType>>(new Set());
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);

  // Save addon enabled state to localStorage
  useEffect(() => {
    localStorage.setItem('newsinsight-ml-addons-enabled', JSON.stringify(addonEnabled));
  }, [addonEnabled]);

  // Check all addon health on mount
  useEffect(() => {
    refreshAllAddons();
  }, []);

  const refreshAllAddons = useCallback(async () => {
    setIsRefreshingAll(true);
    setLoadingAddons(new Set(['sentiment', 'factcheck', 'bias']));
    
    try {
      const results = await checkAllMLAddonsHealth();
      setAddonHealth(results);
    } catch (e) {
      console.error('Failed to check addon health:', e);
      toast({
        title: '상태 확인 실패',
        description: 'ML Add-on 상태를 확인할 수 없습니다.',
        variant: 'destructive',
      });
    } finally {
      setLoadingAddons(new Set());
      setIsRefreshingAll(false);
    }
  }, [toast]);

  const refreshAddon = useCallback(async (id: MLAddonType) => {
    setLoadingAddons(prev => new Set(prev).add(id));
    
    try {
      const health = await checkMLAddonHealth(id);
      setAddonHealth(prev => ({ ...prev, [id]: health }));
    } catch (e) {
      console.error(`Failed to check ${id} addon health:`, e);
    } finally {
      setLoadingAddons(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const toggleAddon = useCallback((id: MLAddonType, enabled: boolean) => {
    setAddonEnabled(prev => ({ ...prev, [id]: enabled }));
    toast({
      title: enabled ? 'Add-on 활성화됨' : 'Add-on 비활성화됨',
      description: `${ML_ADDON_CONFIGS.find(c => c.id === id)?.name} Add-on이 ${enabled ? '활성화' : '비활성화'}되었습니다.`,
    });
  }, [toast]);

  const healthyCount = Object.values(addonHealth).filter(h => h?.status === 'healthy').length;
  const totalCount = ML_ADDON_CONFIGS.length;

  // Browser-Use state
  const [browserHealth, setBrowserHealth] = useState<BrowserHealthResponse | null>(null);
  const [browserStats, setBrowserStats] = useState<BrowserUseStats | null>(null);
  const [browserJobs, setBrowserJobs] = useState<BrowserJobSummary[]>([]);
  const [isLoadingBrowser, setIsLoadingBrowser] = useState(false);
  const [isCancellingAll, setIsCancellingAll] = useState(false);

  const refreshBrowserUse = useCallback(async () => {
    setIsLoadingBrowser(true);
    try {
      const [health, stats, jobs] = await Promise.all([
        checkBrowserUseHealth().catch(() => null),
        getBrowserUseStats().catch(() => null),
        getActiveBrowserJobs().catch(() => []),
      ]);
      setBrowserHealth(health);
      setBrowserStats(stats);
      setBrowserJobs(jobs);
    } catch (e) {
      console.error('Failed to fetch Browser-Use status:', e);
      toast({
        title: '상태 확인 실패',
        description: 'Browser-Use 서비스 상태를 확인할 수 없습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingBrowser(false);
    }
  }, [toast]);

  const handleCancelJob = useCallback(async (jobId: string) => {
    try {
      await cancelBrowserJob(jobId);
      toast({ title: '작업 취소됨', description: `작업 ${jobId}가 취소되었습니다.` });
      refreshBrowserUse();
    } catch (e) {
      toast({
        title: '취소 실패',
        description: e instanceof Error ? e.message : '알 수 없는 오류',
        variant: 'destructive',
      });
    }
  }, [toast, refreshBrowserUse]);

  const handleCancelAllJobs = useCallback(async () => {
    if (!confirm('모든 활성 브라우저 작업을 취소하시겠습니까?')) return;
    
    setIsCancellingAll(true);
    try {
      const result = await cancelAllBrowserJobs();
      toast({
        title: '전체 취소 완료',
        description: `${result.cancelled}개의 작업이 취소되었습니다.${result.errors.length > 0 ? ` (${result.errors.length}개 실패)` : ''}`,
      });
      refreshBrowserUse();
    } catch (e) {
      toast({
        title: '취소 실패',
        description: e instanceof Error ? e.message : '알 수 없는 오류',
        variant: 'destructive',
      });
    } finally {
      setIsCancellingAll(false);
    }
  }, [toast, refreshBrowserUse]);

  // Load Browser-Use status when tab changes
  useEffect(() => {
    if (activeTab === 'browser-use') {
      refreshBrowserUse();
    }
  }, [activeTab, refreshBrowserUse]);

  // API Gateway state
  const [gatewayHealth, setGatewayHealth] = useState<{
    status: string;
    services?: Record<string, { status: string; instances?: number }>;
  } | null>(null);
  const [isLoadingGateway, setIsLoadingGateway] = useState(false);

  const refreshGatewayHealth = useCallback(async () => {
    setIsLoadingGateway(true);
    try {
      const health = await checkApiGatewayHealth();
      setGatewayHealth(health);
    } catch (e) {
      console.error('Failed to check API Gateway health:', e);
      setGatewayHealth({ status: 'unhealthy' });
    } finally {
      setIsLoadingGateway(false);
    }
  }, []);

  // Load gateway health when system tab is active
  useEffect(() => {
    if (activeTab === 'system') {
      refreshGatewayHealth();
    }
  }, [activeTab, refreshGatewayHealth]);

  const getJobStatusBadge = (status: string) => {
    switch (status) {
      case 'running':
        return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100">실행 중</Badge>;
      case 'waiting_human':
        return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100">대기 중</Badge>;
      case 'pending':
        return <Badge variant="secondary">대기</Badge>;
      case 'completed':
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">완료</Badge>;
      case 'failed':
        return <Badge variant="destructive">실패</Badge>;
      case 'cancelled':
        return <Badge variant="outline">취소됨</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatTime = (isoString?: string) => {
    if (!isoString) return '-';
    try {
      const date = new Date(isoString);
      return date.toLocaleString('ko-KR', { 
        month: 'short', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="min-h-screen py-8">
      <div className="container mx-auto px-4 max-w-5xl">
        {/* Header */}
        <header className="mb-8">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            메인으로 돌아가기
          </Link>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <SettingsIcon className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-3xl font-bold">설정</h1>
                <p className="text-muted-foreground">
                  NewsInsight 시스템 설정을 관리합니다.
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 lg:w-[600px]">
            <TabsTrigger value="ml-addons" className="gap-2">
              <Brain className="h-4 w-4" />
              ML Add-ons
            </TabsTrigger>
            <TabsTrigger value="browser-use" className="gap-2">
              <Globe className="h-4 w-4" />
              Browser-Use
            </TabsTrigger>
            <TabsTrigger value="system" className="gap-2">
              <Server className="h-4 w-4" />
              시스템
            </TabsTrigger>
          </TabsList>

          {/* ML Add-ons Tab */}
          <TabsContent value="ml-addons" className="space-y-6">
            {/* Overview Card */}
            <Card>
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
                    onClick={refreshAllAddons}
                    disabled={isRefreshingAll}
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshingAll ? 'animate-spin' : ''}`} />
                    전체 새로고침
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className={`h-3 w-3 rounded-full ${
                      healthyCount === totalCount ? 'bg-green-500' :
                      healthyCount > 0 ? 'bg-yellow-500' : 'bg-red-500'
                    }`} />
                    <span className="text-sm font-medium">
                      {healthyCount}/{totalCount} 서비스 정상
                    </span>
                  </div>
                  <Separator orientation="vertical" className="h-4" />
                  <span className="text-sm text-muted-foreground">
                    활성화된 Add-on: {Object.values(addonEnabled).filter(Boolean).length}개
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Add-on Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {ML_ADDON_CONFIGS.map((config) => (
                <MLAddonCard
                  key={config.id}
                  config={config}
                  health={addonHealth[config.id]}
                  isLoading={loadingAddons.has(config.id)}
                  enabled={addonEnabled[config.id]}
                  onToggle={toggleAddon}
                  onRefresh={refreshAddon}
                />
              ))}
            </div>

            {/* Help */}
            <Alert>
              <Zap className="h-4 w-4" />
              <AlertDescription>
                <strong>ML Add-on 실행 방법:</strong> <code className="px-1 py-0.5 bg-muted rounded text-xs">cd backend/ml-addons && docker-compose up -d</code>
                <br />
                <span className="text-muted-foreground">
                  ML Add-on은 Docker 컨테이너로 실행됩니다. API Gateway를 통해 자동으로 라우팅됩니다.
                </span>
              </AlertDescription>
            </Alert>
          </TabsContent>

          {/* Browser-Use Tab */}
          <TabsContent value="browser-use" className="space-y-6">
            {/* Service Status Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Monitor className="h-5 w-5" />
                      Browser-Use 서비스 상태
                    </CardTitle>
                    <CardDescription>
                      AI 기반 브라우저 자동화 서비스 상태 및 활성 작업을 관리합니다.
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    onClick={refreshBrowserUse}
                    disabled={isLoadingBrowser}
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${isLoadingBrowser ? 'animate-spin' : ''}`} />
                    새로고침
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingBrowser && !browserHealth ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>상태 확인 중...</span>
                  </div>
                ) : browserHealth ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className="flex items-center gap-2">
                        <div className={`h-3 w-3 rounded-full ${
                          browserHealth.status === 'healthy' ? 'bg-green-500' : 'bg-red-500'
                        }`} />
                        <span className="text-sm font-medium">
                          {browserHealth.status === 'healthy' ? '정상 작동' : '오프라인'}
                        </span>
                      </div>
                      <Separator orientation="vertical" className="h-4" />
                      <span className="text-sm text-muted-foreground">
                        버전: {browserHealth.version}
                      </span>
                      <Separator orientation="vertical" className="h-4" />
                      <span className="text-sm text-muted-foreground">
                        업타임: {Math.floor(browserHealth.uptime_seconds / 60)}분
                      </span>
                    </div>
                    
                    {/* Stats Grid */}
                    <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                      <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                        <Play className="h-4 w-4 text-blue-500" />
                        <div>
                          <p className="text-xs text-muted-foreground">활성 작업</p>
                          <p className="text-lg font-semibold">{browserHealth.active_jobs}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                        <Users className="h-4 w-4 text-yellow-500" />
                        <div>
                          <p className="text-xs text-muted-foreground">개입 대기</p>
                          <p className="text-lg font-semibold">{browserHealth.waiting_intervention}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        <div>
                          <p className="text-xs text-muted-foreground">완료</p>
                          <p className="text-lg font-semibold">{browserStats?.completedJobs ?? '-'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                        <XCircle className="h-4 w-4 text-red-500" />
                        <div>
                          <p className="text-xs text-muted-foreground">실패/취소</p>
                          <p className="text-lg font-semibold">{browserStats?.failedJobs ?? '-'}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Browser-Use 서비스에 연결할 수 없습니다. 서비스가 실행 중인지 확인하세요.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/* Active Jobs */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Activity className="h-5 w-5" />
                      활성 브라우저 작업
                    </CardTitle>
                    <CardDescription>
                      현재 실행 중이거나 대기 중인 브라우저 자동화 작업입니다.
                    </CardDescription>
                  </div>
                  {browserJobs.length > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleCancelAllJobs}
                      disabled={isCancellingAll}
                    >
                      {isCancellingAll ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Square className="h-4 w-4 mr-2" />
                      )}
                      전체 취소
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {browserJobs.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Monitor className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>활성 작업이 없습니다.</p>
                    <p className="text-xs mt-1">ParallelSearch에서 브라우저 기반 검색을 실행하면 여기에 표시됩니다.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {browserJobs.map((job) => (
                      <div
                        key={job.job_id}
                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                              {job.job_id}
                            </code>
                            {getJobStatusBadge(job.status)}
                            {job.intervention_requested && (
                              <Badge variant="outline" className="text-yellow-600 border-yellow-500">
                                <Eye className="h-3 w-3 mr-1" />
                                개입 필요
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm mt-1 truncate text-muted-foreground">
                            {job.task}
                          </p>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatTime(job.started_at)}
                            </span>
                            {job.progress > 0 && (
                              <span>진행: {Math.round(job.progress * 100)}%</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          {job.status === 'waiting_human' && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => window.open(`/parallel-search?intervention=${job.job_id}`, '_blank')}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>개입 화면 열기</TooltipContent>
                            </Tooltip>
                          )}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleCancelJob(job.job_id)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>작업 취소</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Browser-Use Help */}
            <Alert>
              <Globe className="h-4 w-4" />
              <AlertDescription>
                <strong>Browser-Use 서비스 실행 방법:</strong> <code className="px-1 py-0.5 bg-muted rounded text-xs">cd backend/browser-use && docker-compose up -d</code>
                <br />
                <span className="text-muted-foreground">
                  Browser-Use는 AI가 웹 브라우저를 제어하여 자동으로 정보를 수집합니다. 
                  Human-in-the-Loop 기능으로 CAPTCHA나 로그인이 필요한 경우 사용자 개입을 요청합니다.
                </span>
              </AlertDescription>
            </Alert>
          </TabsContent>

          {/* System Tab */}
          <TabsContent value="system" className="space-y-6">
            {/* API Gateway Health */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Server className="h-5 w-5" />
                      API Gateway 상태
                    </CardTitle>
                    <CardDescription>
                      백엔드 서비스 연결 상태를 확인합니다.
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={refreshGatewayHealth}
                    disabled={isLoadingGateway}
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${isLoadingGateway ? 'animate-spin' : ''}`} />
                    새로고침
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingGateway && !gatewayHealth ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>상태 확인 중...</span>
                  </div>
                ) : gatewayHealth ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className={`h-3 w-3 rounded-full ${
                        gatewayHealth.status === 'UP' || gatewayHealth.status === 'healthy' ? 'bg-green-500' : 'bg-red-500'
                      }`} />
                      <span className="text-sm font-medium">
                        {gatewayHealth.status === 'UP' || gatewayHealth.status === 'healthy' ? '정상 작동' : '오프라인'}
                      </span>
                    </div>
                    {gatewayHealth.services && Object.keys(gatewayHealth.services).length > 0 && (
                      <div className="grid gap-2 mt-3">
                        {Object.entries(gatewayHealth.services).map(([name, info]) => (
                          <div key={name} className="flex items-center justify-between p-2 bg-muted/30 rounded">
                            <span className="text-sm">{name}</span>
                            <Badge variant={info.status === 'UP' ? 'default' : 'destructive'}>
                              {info.status}
                              {info.instances !== undefined && ` (${info.instances})`}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      API Gateway에 연결할 수 없습니다.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/* System Info */}
            <Card>
              <CardHeader>
                <CardTitle>시스템 정보</CardTitle>
                <CardDescription>
                  NewsInsight 시스템 구성 정보입니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-muted-foreground">프론트엔드 버전</Label>
                    <p className="font-mono text-sm">1.0.0</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-muted-foreground">API Gateway</Label>
                    <p className="font-mono text-sm">localhost:8000</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-muted-foreground">Collector Service</Label>
                    <p className="font-mono text-sm">lb://collector-service</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-muted-foreground">Browser-Use API</Label>
                    <p className="font-mono text-sm">lb://browser-use-api</p>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label className="text-muted-foreground">외부 링크</Label>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <a href="https://github.com/your-repo/newsinsight" target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4 mr-2" />
                        GitHub
                      </a>
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                      <a href="/admin/sources" target="_blank" rel="noopener noreferrer">
                        <BarChart3 className="h-4 w-4 mr-2" />
                        데이터 소스 관리
                      </a>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Storage */}
            <Card>
              <CardHeader>
                <CardTitle>로컬 저장소</CardTitle>
                <CardDescription>
                  브라우저에 저장된 데이터를 관리합니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">URL 컬렉션</p>
                      <p className="text-xs text-muted-foreground">저장된 URL 및 폴더 구조</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (confirm('URL 컬렉션 데이터를 삭제하시겠습니까?')) {
                          localStorage.removeItem('newsinsight-url-collection');
                          toast({ title: '삭제됨', description: 'URL 컬렉션이 초기화되었습니다.' });
                        }
                      }}
                    >
                      초기화
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">검색 템플릿</p>
                      <p className="text-xs text-muted-foreground">저장된 SmartSearch 템플릿</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (confirm('검색 템플릿 데이터를 삭제하시겠습니까?')) {
                          localStorage.removeItem('smartSearch_templates');
                          toast({ title: '삭제됨', description: '검색 템플릿이 초기화되었습니다.' });
                        }
                      }}
                    >
                      초기화
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">ML Add-on 설정</p>
                      <p className="text-xs text-muted-foreground">Add-on 활성화 상태</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (confirm('ML Add-on 설정을 초기화하시겠습니까?')) {
                          localStorage.removeItem('newsinsight-ml-addons-enabled');
                          setAddonEnabled({ sentiment: true, factcheck: true, bias: true });
                          toast({ title: '초기화됨', description: 'ML Add-on 설정이 초기화되었습니다.' });
                        }
                      }}
                    >
                      초기화
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Settings;
