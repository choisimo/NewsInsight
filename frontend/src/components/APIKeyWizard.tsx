/**
 * API Key Auto-Provisioning Wizard Component
 * 
 * This component provides a wizard interface for automatically generating
 * API keys from various providers (OpenAI, Anthropic, Google, etc.) via
 * browser automation.
 * 
 * Features:
 * - Provider selection
 * - Real-time browser view during provisioning
 * - Human intervention support for login/2FA
 * - Automatic key saving to system settings
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Key, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  ExternalLink,
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
  LogIn,
  Shield,
  Sparkles,
  Brain,
  Globe,
  Zap,
  Search,
  Bot,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/components/ui/use-toast';
import { 
  getAPIKeyProviders, 
  startAPIKeyProvisioning, 
  notifyLoginComplete, 
  submitProvision2FA,
  getBrowserWSUrl,
  type APIProvider,
  type ProviderInfo,
  type APIKeyProvisionResponse,
} from '@/lib/api';

// Provider icon components for better visual appeal
const ProviderIcon = ({ provider, className = "h-5 w-5" }: { provider: string; className?: string }) => {
  switch (provider.toLowerCase()) {
    case 'openai':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.8956zm16.0993 3.8558L12.6 8.3829l2.02-1.1638a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/>
        </svg>
      );
    case 'anthropic':
      return <Brain className={className} />;
    case 'google':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
      );
    case 'openrouter':
      return <Globe className={className} />;
    case 'together_ai':
      return <Sparkles className={className} />;
    case 'perplexity':
      return <Zap className={className} />;
    case 'brave_search':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0L2.953 4.5v7.5c0 6.627 4.03 11.249 9.047 12 5.017-.751 9.047-5.373 9.047-12V4.5L12 0zm0 2.25l7.5 3.75v6c0 5.385-3.267 9.166-7.5 9.75-4.233-.584-7.5-4.365-7.5-9.75V6l7.5-3.75z" fill="#FB542B"/>
        </svg>
      );
    case 'tavily':
      return <Search className={className} />;
    default:
      return <Bot className={className} />;
  }
};

// Provider color schemes
const PROVIDER_COLORS: Record<string, string> = {
  openai: 'text-emerald-600',
  anthropic: 'text-orange-500',
  google: 'text-blue-500',
  openrouter: 'text-purple-500',
  together_ai: 'text-pink-500',
  perplexity: 'text-cyan-500',
  brave_search: 'text-orange-600',
  tavily: 'text-indigo-500',
};

// Provider descriptions (updated for 2025)
const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  openai: 'GPT-5, GPT-4.1, o3, DALL-E 3, Whisper',
  anthropic: 'Claude 4 Opus, Sonnet, Haiku',
  google: 'Gemini 3 Pro, Gemini 2.5, PaLM',
  openrouter: '100+ models, unified API',
  together_ai: 'DeepSeek, Llama 3.1, Mixtral',
  perplexity: 'AI-powered real-time search',
  brave_search: 'Privacy-focused web search API',
  tavily: 'AI-optimized research API',
};

// Provider URLs for reference
const PROVIDER_URLS: Record<string, string> = {
  openai: 'platform.openai.com',
  anthropic: 'console.anthropic.com',
  google: 'aistudio.google.com',
  openrouter: 'openrouter.ai',
  together_ai: 'api.together.xyz',
  perplexity: 'perplexity.ai',
  brave_search: 'brave.com/search/api',
  tavily: 'tavily.com',
};

interface ProvisioningState {
  status: 'idle' | 'starting' | 'navigating' | 'waiting_login' | 'waiting_2fa' | 'generating' | 'extracting' | 'saving' | 'completed' | 'failed';
  jobId?: string;
  message?: string;
  error?: string;
  progress: number;
  screenshot?: string;
  currentUrl?: string;
  apiKeyMasked?: string;
  savedToSettings?: boolean;
}

interface APIKeyWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (provider: string, keyMasked: string) => void;
}

export function APIKeyWizard({ open, onOpenChange, onSuccess }: APIKeyWizardProps) {
  const { toast } = useToast();
  const wsRef = useRef<WebSocket | null>(null);
  
  // State
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<APIProvider | ''>('');
  const [keyName, setKeyName] = useState('NewsInsight-AutoGenerated');
  const [autoSave, setAutoSave] = useState(true);
  const [loading, setLoading] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  
  const [provisioningState, setProvisioningState] = useState<ProvisioningState>({
    status: 'idle',
    progress: 0,
  });

  // Fetch providers on mount
  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const data = await getAPIKeyProviders();
        setProviders(data.providers);
      } catch (error) {
        console.error('Failed to fetch providers:', error);
        toast({
          title: '오류',
          description: 'API 제공자 목록을 불러오는데 실패했습니다.',
          variant: 'destructive',
        });
      }
    };
    
    if (open) {
      fetchProviders();
    }
  }, [open, toast]);

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  // Connect to WebSocket for real-time updates
  const connectWebSocket = useCallback((jobId: string) => {
    const wsUrl = getBrowserWSUrl(jobId);
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const fullWsUrl = `${protocol}//${window.location.host}${wsUrl}`;
    
    const ws = new WebSocket(fullWsUrl);
    wsRef.current = ws;
    
    ws.onopen = () => {
      console.log('WebSocket connected for provisioning job:', jobId);
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    ws.onclose = () => {
      console.log('WebSocket closed');
      wsRef.current = null;
    };
  }, []);

  // Handle WebSocket messages
  const handleWebSocketMessage = useCallback((data: Record<string, unknown>) => {
    const type = data.type as string;
    
    switch (type) {
      case 'provisioning_update':
        setProvisioningState(prev => ({
          ...prev,
          status: mapStatus(data.status as string),
          message: data.message as string,
          progress: calculateProgress(data.status as string),
        }));
        break;
        
      case 'step_update':
        setProvisioningState(prev => ({
          ...prev,
          screenshot: data.screenshot as string,
          currentUrl: data.current_url as string,
        }));
        break;
        
      case 'intervention_requested':
        const interventionType = data.intervention_type as string;
        setProvisioningState(prev => ({
          ...prev,
          status: interventionType === '2fa' ? 'waiting_2fa' : 'waiting_login',
          message: data.reason as string,
          screenshot: data.screenshot as string,
          currentUrl: data.current_url as string,
          progress: 40,
        }));
        break;
        
      case 'provisioning_complete':
        setProvisioningState(prev => ({
          ...prev,
          status: 'completed',
          apiKeyMasked: data.api_key_masked as string,
          savedToSettings: data.saved_to_settings as boolean,
          progress: 100,
        }));
        
        if (onSuccess && data.api_key_masked) {
          onSuccess(data.provider as string, data.api_key_masked as string);
        }
        
        toast({
          title: 'API 키 발급 완료!',
          description: `${data.provider} API 키가 성공적으로 발급되었습니다.`,
        });
        break;
        
      case 'provisioning_failed':
        setProvisioningState(prev => ({
          ...prev,
          status: 'failed',
          error: data.error as string,
          progress: 0,
        }));
        
        toast({
          title: 'API 키 발급 실패',
          description: data.error as string,
          variant: 'destructive',
        });
        break;
    }
  }, [onSuccess, toast]);

  // Map status string to state
  const mapStatus = (status: string): ProvisioningState['status'] => {
    const statusMap: Record<string, ProvisioningState['status']> = {
      'pending': 'starting',
      'navigating': 'navigating',
      'waiting_login': 'waiting_login',
      'waiting_2fa': 'waiting_2fa',
      'generating_key': 'generating',
      'extracting_key': 'extracting',
      'saving_key': 'saving',
      'completed': 'completed',
      'failed': 'failed',
    };
    return statusMap[status] || 'starting';
  };

  // Calculate progress percentage
  const calculateProgress = (status: string): number => {
    const progressMap: Record<string, number> = {
      'pending': 5,
      'navigating': 20,
      'waiting_login': 35,
      'waiting_2fa': 45,
      'generating_key': 60,
      'extracting_key': 80,
      'saving_key': 90,
      'completed': 100,
      'failed': 0,
    };
    return progressMap[status] || 0;
  };

  // Start provisioning
  const handleStartProvisioning = async () => {
    if (!selectedProvider) {
      toast({
        title: '제공자를 선택해주세요',
        variant: 'destructive',
      });
      return;
    }
    
    setLoading(true);
    setProvisioningState({
      status: 'starting',
      progress: 5,
      message: '브라우저를 시작하는 중...',
    });
    
    try {
      const response = await startAPIKeyProvisioning({
        provider: selectedProvider,
        key_name: keyName,
        auto_save: autoSave,
        timeout_seconds: 300,
        headless: false,
      });
      
      setProvisioningState(prev => ({
        ...prev,
        jobId: response.job_id,
        status: response.requires_intervention ? 'waiting_login' : 'navigating',
        message: response.message,
        progress: response.requires_intervention ? 35 : 20,
      }));
      
      // Connect WebSocket for real-time updates
      connectWebSocket(response.job_id);
      
    } catch (error) {
      setProvisioningState({
        status: 'failed',
        progress: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      
      toast({
        title: 'API 키 발급 시작 실패',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Handle login completion
  const handleLoginComplete = async () => {
    if (!provisioningState.jobId) return;
    
    try {
      await notifyLoginComplete(provisioningState.jobId);
      setProvisioningState(prev => ({
        ...prev,
        status: 'generating',
        message: 'API 키 생성 중...',
        progress: 60,
      }));
    } catch (error) {
      toast({
        title: '오류',
        description: '로그인 완료 알림에 실패했습니다.',
        variant: 'destructive',
      });
    }
  };

  // Handle 2FA submission
  const handleSubmit2FA = async () => {
    if (!provisioningState.jobId || !twoFactorCode) return;
    
    try {
      await submitProvision2FA(provisioningState.jobId, twoFactorCode);
      setTwoFactorCode('');
      setProvisioningState(prev => ({
        ...prev,
        status: 'generating',
        message: '인증 완료, API 키 생성 중...',
        progress: 60,
      }));
    } catch (error) {
      toast({
        title: '오류',
        description: '2FA 코드 제출에 실패했습니다.',
        variant: 'destructive',
      });
    }
  };

  // Reset wizard
  const handleReset = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setProvisioningState({
      status: 'idle',
      progress: 0,
    });
    setSelectedProvider('');
    setTwoFactorCode('');
  };

  // Get status badge
  const getStatusBadge = () => {
    const statusConfig: Record<ProvisioningState['status'], { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
      idle: { variant: 'secondary', label: '대기중' },
      starting: { variant: 'default', label: '시작중' },
      navigating: { variant: 'default', label: '이동중' },
      waiting_login: { variant: 'outline', label: '로그인 대기' },
      waiting_2fa: { variant: 'outline', label: '2FA 대기' },
      generating: { variant: 'default', label: '생성중' },
      extracting: { variant: 'default', label: '추출중' },
      saving: { variant: 'default', label: '저장중' },
      completed: { variant: 'default', label: '완료' },
      failed: { variant: 'destructive', label: '실패' },
    };
    
    const config = statusConfig[provisioningState.status];
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            API 키 자동 발급
          </DialogTitle>
          <DialogDescription>
            브라우저 자동화를 통해 API 키를 자동으로 발급받습니다.
            로그인이나 2차 인증이 필요한 경우 안내해 드립니다.
          </DialogDescription>
        </DialogHeader>

        {provisioningState.status === 'idle' ? (
          // Provider Selection Form
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>API 제공자 선택</Label>
              <Select value={selectedProvider} onValueChange={(v) => setSelectedProvider(v as APIProvider)}>
                <SelectTrigger>
                  <SelectValue placeholder="제공자를 선택하세요" />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((provider) => (
                    <SelectItem key={provider.name} value={provider.name}>
                      <div className="flex items-center gap-3">
                        <div className={PROVIDER_COLORS[provider.name] || 'text-gray-500'}>
                          <ProviderIcon provider={provider.name} className="h-5 w-5" />
                        </div>
                        <div className="flex flex-col">
                          <span className="font-medium">{provider.display_name}</span>
                          <span className="text-xs text-muted-foreground">
                            {PROVIDER_DESCRIPTIONS[provider.name] || PROVIDER_URLS[provider.name]}
                          </span>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>키 이름 (선택)</Label>
              <Input
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="생성될 API 키의 이름"
              />
            </div>

            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>주의사항</AlertTitle>
              <AlertDescription>
                <ul className="list-disc list-inside text-sm space-y-1">
                  <li>브라우저가 열리면서 해당 서비스에 자동으로 접속합니다</li>
                  <li>로그인이 필요한 경우 브라우저에서 직접 로그인해주세요</li>
                  <li>2차 인증(2FA)이 필요한 경우 코드를 입력해주세요</li>
                  <li>발급된 키는 자동으로 시스템 설정에 저장됩니다</li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>
        ) : (
          // Provisioning Progress View
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg bg-muted ${PROVIDER_COLORS[selectedProvider] || 'text-gray-500'}`}>
                  <ProviderIcon provider={selectedProvider} className="h-6 w-6" />
                </div>
                <div>
                  <span className="font-medium">
                    {providers.find(p => p.name === selectedProvider)?.display_name || selectedProvider}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {PROVIDER_URLS[selectedProvider]}
                  </p>
                </div>
              </div>
              {getStatusBadge()}
            </div>

            <Progress value={provisioningState.progress} className="h-2" />

            <div className="text-sm text-muted-foreground">
              {provisioningState.message}
            </div>

            {/* Screenshot Preview */}
            {provisioningState.screenshot && (
              <Card className="overflow-hidden">
                <CardHeader className="py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground truncate max-w-[300px]">
                      {provisioningState.currentUrl}
                    </span>
                    {provisioningState.currentUrl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => window.open(provisioningState.currentUrl, '_blank')}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <img
                    src={`data:image/png;base64,${provisioningState.screenshot}`}
                    alt="Browser screenshot"
                    className="w-full h-auto"
                  />
                </CardContent>
              </Card>
            )}

            {/* Login Required */}
            {provisioningState.status === 'waiting_login' && (
              <Alert>
                <LogIn className="h-4 w-4" />
                <AlertTitle>로그인 필요</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>브라우저 창에서 로그인을 완료한 후 아래 버튼을 클릭하세요.</p>
                  <Button onClick={handleLoginComplete} className="w-full">
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    로그인 완료
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {/* 2FA Required */}
            {provisioningState.status === 'waiting_2fa' && (
              <Alert>
                <Shield className="h-4 w-4" />
                <AlertTitle>2차 인증 필요</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>SMS 또는 인증 앱에서 받은 코드를 입력하세요.</p>
                  <div className="flex gap-2">
                    <Input
                      value={twoFactorCode}
                      onChange={(e) => setTwoFactorCode(e.target.value)}
                      placeholder="인증 코드 (6자리)"
                      maxLength={6}
                    />
                    <Button onClick={handleSubmit2FA} disabled={twoFactorCode.length < 6}>
                      확인
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Success */}
            {provisioningState.status === 'completed' && (
              <Alert className="border-green-500">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <AlertTitle>발급 완료!</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>API 키가 성공적으로 발급되었습니다.</p>
                  {provisioningState.apiKeyMasked && (
                    <div className="flex items-center gap-2 p-2 bg-muted rounded">
                      <code className="flex-1">{provisioningState.apiKeyMasked}</code>
                    </div>
                  )}
                  {provisioningState.savedToSettings && (
                    <p className="text-xs text-muted-foreground">
                      ✓ 시스템 설정에 자동 저장되었습니다.
                    </p>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {/* Failed */}
            {provisioningState.status === 'failed' && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertTitle>발급 실패</AlertTitle>
                <AlertDescription>
                  {provisioningState.error || '알 수 없는 오류가 발생했습니다.'}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          {provisioningState.status === 'idle' ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                취소
              </Button>
              <Button onClick={handleStartProvisioning} disabled={!selectedProvider || loading}>
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Key className="mr-2 h-4 w-4" />
                )}
                키 발급 시작
              </Button>
            </>
          ) : provisioningState.status === 'completed' || provisioningState.status === 'failed' ? (
            <>
              <Button variant="outline" onClick={handleReset}>
                <RefreshCw className="mr-2 h-4 w-4" />
                다시 시작
              </Button>
              <Button onClick={() => onOpenChange(false)}>
                닫기
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              백그라운드에서 계속
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default APIKeyWizard;
