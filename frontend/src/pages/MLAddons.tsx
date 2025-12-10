import React, { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
// ML Add-ons Page Component
// ============================================

const MLAddons = () => {
  const { toast } = useToast();
  
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
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-6">
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
