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
  Key,
  Save,
  Sparkles,
  Bot,
  Search,
  EyeOff,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  // AI Provider Models
  fetchProviderModels,
  getStaticModels,
  type LLMProviderType as ApiLLMProviderType,
  type ProviderModel,
} from '@/lib/api';

// ============================================
// AI/LLM Settings Types
// ============================================

type LLMProviderType = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'ollama' | 'azure' | 'custom';

interface AISettings {
  llmProvider: LLMProviderType;
  // OpenAI
  openaiApiKey: string;
  openaiModel: string;
  // Anthropic
  anthropicApiKey: string;
  anthropicModel: string;
  // Google (Gemini)
  googleApiKey: string;
  googleModel: string;
  // OpenRouter
  openrouterApiKey: string;
  openrouterModel: string;
  // Ollama (로컬)
  ollamaBaseUrl: string;
  ollamaModel: string;
  // Azure OpenAI
  azureApiKey: string;
  azureEndpoint: string;
  azureDeploymentName: string;
  azureApiVersion: string;
  // Custom REST API
  customBaseUrl: string;
  customApiKey: string;
  customModel: string;
  customHeaders: string; // JSON 문자열
  // Search APIs
  braveApiKey: string;
  tavilyApiKey: string;
  perplexityApiKey: string;
}

const defaultAISettings: AISettings = {
  llmProvider: 'openai',
  // OpenAI
  openaiApiKey: '',
  openaiModel: 'gpt-4o',
  // Anthropic
  anthropicApiKey: '',
  anthropicModel: 'claude-3-5-sonnet-20241022',
  // Google
  googleApiKey: '',
  googleModel: 'gemini-1.5-pro',
  // OpenRouter
  openrouterApiKey: '',
  openrouterModel: 'openai/gpt-4o',
  // Ollama
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.1',
  // Azure
  azureApiKey: '',
  azureEndpoint: '',
  azureDeploymentName: '',
  azureApiVersion: '2024-02-15-preview',
  // Custom
  customBaseUrl: '',
  customApiKey: '',
  customModel: '',
  customHeaders: '{}',
  // Search
  braveApiKey: '',
  tavilyApiKey: '',
  perplexityApiKey: '',
};

// Provider 메타데이터
const LLM_PROVIDERS: { value: LLMProviderType; label: string; description: string; color: string }[] = [
  { value: 'openai', label: 'OpenAI', description: 'GPT-4, GPT-3.5', color: 'bg-green-500' },
  { value: 'anthropic', label: 'Anthropic', description: 'Claude 3.5', color: 'bg-orange-500' },
  { value: 'google', label: 'Google AI', description: 'Gemini 1.5', color: 'bg-blue-500' },
  { value: 'openrouter', label: 'OpenRouter', description: '다양한 모델', color: 'bg-purple-500' },
  { value: 'ollama', label: 'Ollama', description: '로컬 LLM', color: 'bg-gray-500' },
  { value: 'azure', label: 'Azure OpenAI', description: 'Azure 호스팅', color: 'bg-cyan-500' },
  { value: 'custom', label: 'Custom API', description: '커스텀 엔드포인트', color: 'bg-pink-500' },
];

const LLM_MODELS: Record<LLMProviderType, { value: string; label: string }[]> = {
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o (추천)' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini (빠름)' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (저렴)' },
    { value: 'o1-preview', label: 'o1-preview (추론)' },
    { value: 'o1-mini', label: 'o1-mini (추론, 빠름)' },
  ],
  anthropic: [
    { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (추천)' },
    { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku (빠름)' },
    { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus (강력)' },
  ],
  google: [
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro (추천)' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (빠름)' },
    { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash (실험)' },
  ],
  openrouter: [
    { value: 'openai/gpt-4o', label: 'GPT-4o (OpenAI)' },
    { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
    { value: 'google/gemini-pro-1.5', label: 'Gemini 1.5 Pro' },
    { value: 'meta-llama/llama-3.1-405b-instruct', label: 'Llama 3.1 405B' },
    { value: 'meta-llama/llama-3.1-70b-instruct', label: 'Llama 3.1 70B' },
    { value: 'mistralai/mixtral-8x22b-instruct', label: 'Mixtral 8x22B' },
    { value: 'deepseek/deepseek-chat', label: 'DeepSeek Chat' },
    { value: 'qwen/qwen-2.5-72b-instruct', label: 'Qwen 2.5 72B' },
  ],
  ollama: [
    { value: 'llama3.1', label: 'Llama 3.1 (추천)' },
    { value: 'llama3.1:70b', label: 'Llama 3.1 70B' },
    { value: 'mistral', label: 'Mistral' },
    { value: 'mixtral', label: 'Mixtral' },
    { value: 'codellama', label: 'Code Llama' },
    { value: 'qwen2.5', label: 'Qwen 2.5' },
    { value: 'gemma2', label: 'Gemma 2' },
  ],
  azure: [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { value: 'gpt-35-turbo', label: 'GPT-3.5 Turbo' },
  ],
  custom: [
    { value: 'default', label: '기본 모델' },
  ],
};

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
  const [activeTab, setActiveTab] = useState('ai-settings');
  
  // AI Settings state
  const [aiSettings, setAISettings] = useState<AISettings>(() => {
    const saved = localStorage.getItem('newsinsight-ai-settings');
    if (saved) {
      try {
        return { ...defaultAISettings, ...JSON.parse(saved) };
      } catch {
        // ignore
      }
    }
    return defaultAISettings;
  });
  const [isSavingAI, setIsSavingAI] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});
  const [aiSettingsChanged, setAISettingsChanged] = useState(false);
  const [isTestingProvider, setIsTestingProvider] = useState(false);
  const [providerTestResult, setProviderTestResult] = useState<{
    status: 'success' | 'failed';
    message: string;
    latency_ms?: number;
  } | null>(null);
  
  // Dynamic model lists per provider
  const [dynamicModels, setDynamicModels] = useState<Record<LLMProviderType, ProviderModel[]>>({
    openai: [],
    anthropic: [],
    google: [],
    openrouter: [],
    ollama: [],
    azure: [],
    custom: [],
  });
  const [isLoadingModels, setIsLoadingModels] = useState<Record<LLMProviderType, boolean>>({
    openai: false,
    anthropic: false,
    google: false,
    openrouter: false,
    ollama: false,
    azure: false,
    custom: false,
  });
  const [modelSource, setModelSource] = useState<Record<LLMProviderType, 'api' | 'static'>>({
    openai: 'static',
    anthropic: 'static',
    google: 'static',
    openrouter: 'static',
    ollama: 'static',
    azure: 'static',
    custom: 'static',
  });

  // Fetch models for a provider
  const loadModelsForProvider = useCallback(async (provider: LLMProviderType) => {
    setIsLoadingModels(prev => ({ ...prev, [provider]: true }));
    try {
      // Get API key and base URL from current settings
      let apiKey: string | undefined;
      let baseUrl: string | undefined;
      
      switch (provider) {
        case 'openai':
          apiKey = aiSettings.openaiApiKey || undefined;
          break;
        case 'openrouter':
          apiKey = aiSettings.openrouterApiKey || undefined;
          break;
        case 'ollama':
          baseUrl = aiSettings.ollamaBaseUrl || undefined;
          break;
        case 'custom':
          baseUrl = aiSettings.customBaseUrl || undefined;
          apiKey = aiSettings.customApiKey || undefined;
          break;
      }
      
      const response = await fetchProviderModels(provider as ApiLLMProviderType, apiKey, baseUrl);
      
      // Ensure models is an array before setting
      const models = Array.isArray(response?.models) ? response.models : [];
      if (models.length > 0) {
        setDynamicModels(prev => ({ ...prev, [provider]: models }));
        setModelSource(prev => ({ ...prev, [provider]: response.source || 'api' }));
      } else {
        // Fallback to static
        setDynamicModels(prev => ({ ...prev, [provider]: getStaticModels(provider as ApiLLMProviderType) }));
        setModelSource(prev => ({ ...prev, [provider]: 'static' }));
      }
    } catch (e) {
      console.error(`Failed to load models for ${provider}:`, e);
      // Fallback to static models
      setDynamicModels(prev => ({ ...prev, [provider]: getStaticModels(provider as ApiLLMProviderType) }));
      setModelSource(prev => ({ ...prev, [provider]: 'static' }));
    } finally {
      setIsLoadingModels(prev => ({ ...prev, [provider]: false }));
    }
  }, [aiSettings.openaiApiKey, aiSettings.openrouterApiKey, aiSettings.ollamaBaseUrl, aiSettings.customBaseUrl, aiSettings.customApiKey]);

  // Load models when provider changes or on mount
  useEffect(() => {
    if (activeTab === 'ai-settings') {
      // Load models for current provider
      loadModelsForProvider(aiSettings.llmProvider);
    }
  }, [activeTab, aiSettings.llmProvider, loadModelsForProvider]);

  // Get models for display (dynamic if available, otherwise static fallback from LLM_MODELS)
  const getModelsForProvider = (provider: LLMProviderType): { value: string; label: string }[] => {
    const dynamic = dynamicModels[provider];
    if (dynamic && Array.isArray(dynamic) && dynamic.length > 0) {
      return dynamic.map(m => ({
        value: m?.id || '',
        label: m?.name || m?.id || 'Unknown',
      })).filter(m => m.value); // Filter out empty values
    }
    // Fallback to static LLM_MODELS
    const staticModels = LLM_MODELS[provider];
    return Array.isArray(staticModels) ? staticModels : [];
  };

  // Update AI setting
  const updateAISetting = <K extends keyof AISettings>(key: K, value: AISettings[K]) => {
    setAISettings(prev => ({ ...prev, [key]: value }));
    setAISettingsChanged(true);
  };

  // Save AI settings
  const saveAISettings = async () => {
    setIsSavingAI(true);
    try {
      // Save to localStorage
      localStorage.setItem('newsinsight-ai-settings', JSON.stringify(aiSettings));
      
      // Build settings payload for backend
      // Keys are mapped to environment variable format for autonomous-crawler
      const settingsPayload: Record<string, string> = {
        'LLM_PROVIDER': aiSettings.llmProvider,
        // OpenAI
        'LLM_OPENAI_API_KEY': aiSettings.openaiApiKey,
        'LLM_OPENAI_MODEL': aiSettings.openaiModel,
        // Anthropic
        'LLM_ANTHROPIC_API_KEY': aiSettings.anthropicApiKey,
        'LLM_ANTHROPIC_MODEL': aiSettings.anthropicModel,
        // Google
        'LLM_GOOGLE_API_KEY': aiSettings.googleApiKey,
        'LLM_GOOGLE_MODEL': aiSettings.googleModel,
        // OpenRouter
        'LLM_OPENROUTER_API_KEY': aiSettings.openrouterApiKey,
        'LLM_OPENROUTER_MODEL': aiSettings.openrouterModel,
        // Ollama
        'LLM_OLLAMA_BASE_URL': aiSettings.ollamaBaseUrl,
        'LLM_OLLAMA_MODEL': aiSettings.ollamaModel,
        // Azure
        'LLM_AZURE_API_KEY': aiSettings.azureApiKey,
        'LLM_AZURE_ENDPOINT': aiSettings.azureEndpoint,
        'LLM_AZURE_DEPLOYMENT_NAME': aiSettings.azureDeploymentName,
        'LLM_AZURE_API_VERSION': aiSettings.azureApiVersion,
        // Custom
        'LLM_CUSTOM_BASE_URL': aiSettings.customBaseUrl,
        'LLM_CUSTOM_API_KEY': aiSettings.customApiKey,
        'LLM_CUSTOM_MODEL': aiSettings.customModel,
        'LLM_CUSTOM_HEADERS': aiSettings.customHeaders,
        // Search
        'SEARCH_BRAVE_API_KEY': aiSettings.braveApiKey,
        'SEARCH_TAVILY_API_KEY': aiSettings.tavilyApiKey,
        'SEARCH_PERPLEXITY_API_KEY': aiSettings.perplexityApiKey,
      };
      
      // Save to backend (Consul) via API
      const response = await fetch('/api/v1/config/ai-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsPayload),
      });
      
      if (!response.ok) {
        throw new Error('Failed to save settings to server');
      }
      
      setAISettingsChanged(false);
      toast({
        title: '설정 저장됨',
        description: 'AI/LLM 설정이 저장되었습니다. 크롤러 서비스를 재시작하면 새 설정이 적용됩니다.',
      });
    } catch (e) {
      console.error('Failed to save AI settings:', e);
      // Still save to localStorage even if API fails
      localStorage.setItem('newsinsight-ai-settings', JSON.stringify(aiSettings));
      toast({
        title: '로컬 저장 완료',
        description: '서버 저장에 실패했지만 로컬에 저장되었습니다.',
        variant: 'default',
      });
      setAISettingsChanged(false);
    } finally {
      setIsSavingAI(false);
    }
  };

  // Test LLM Provider connection
  const testProviderConnection = async () => {
    setIsTestingProvider(true);
    setProviderTestResult(null);

    try {
      // Get current model based on selected provider
      let model = '';
      switch (aiSettings.llmProvider) {
        case 'openai':
          model = aiSettings.openaiModel;
          break;
        case 'anthropic':
          model = aiSettings.anthropicModel;
          break;
        case 'google':
          model = aiSettings.googleModel;
          break;
        case 'openrouter':
          model = aiSettings.openrouterModel;
          break;
        case 'ollama':
          model = aiSettings.ollamaModel;
          break;
        case 'azure':
          model = aiSettings.azureDeploymentName;
          break;
        case 'custom':
          model = aiSettings.customModel;
          break;
      }

      const response = await fetch(
        `/api/v1/crawler/providers/test?provider=${aiSettings.llmProvider}&model=${encodeURIComponent(model)}`,
        { method: 'POST' }
      );

      const result = await response.json();

      setProviderTestResult({
        status: result.status === 'success' ? 'success' : 'failed',
        message: result.message || (result.status === 'success' ? '연결 성공' : '연결 실패'),
        latency_ms: result.latency_ms,
      });

      toast({
        title: result.status === 'success' ? '연결 성공' : '연결 실패',
        description: result.message,
        variant: result.status === 'success' ? 'default' : 'destructive',
      });
    } catch (e) {
      console.error('Provider test failed:', e);
      setProviderTestResult({
        status: 'failed',
        message: e instanceof Error ? e.message : '연결 테스트 실패',
      });
      toast({
        title: '테스트 실패',
        description: '연결 테스트 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsTestingProvider(false);
    }
  };

  // Toggle API key visibility
  const toggleKeyVisibility = (key: string) => {
    setShowApiKeys(prev => ({ ...prev, [key]: !prev[key] }));
  };

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
          <TabsList className="grid w-full grid-cols-4 lg:w-[800px]">
            <TabsTrigger value="ai-settings" className="gap-2">
              <Sparkles className="h-4 w-4" />
              AI/LLM
            </TabsTrigger>
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

          {/* AI/LLM Settings Tab */}
          <TabsContent value="ai-settings" className="space-y-6">
            {/* LLM Provider Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Bot className="h-5 w-5" />
                      LLM 제공자 설정
                    </CardTitle>
                    <CardDescription>
                      자동 확장 크롤링 및 AI 분석에 사용할 LLM 제공자를 설정합니다.
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={testProviderConnection}
                      disabled={isTestingProvider}
                    >
                      {isTestingProvider ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Zap className="h-4 w-4 mr-2" />
                      )}
                      연결 테스트
                    </Button>
                    <Button
                      onClick={saveAISettings}
                      disabled={isSavingAI || !aiSettingsChanged}
                    >
                      {isSavingAI ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      저장
                    </Button>
                  </div>
                </div>
                {/* Test Result */}
                {providerTestResult && (
                  <Alert
                    variant={providerTestResult.status === 'success' ? 'default' : 'destructive'}
                    className="mt-4"
                  >
                    {providerTestResult.status === 'success' ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <XCircle className="h-4 w-4" />
                    )}
                    <AlertDescription className="flex items-center justify-between">
                      <span>{providerTestResult.message}</span>
                      {providerTestResult.latency_ms && (
                        <Badge variant="secondary" className="ml-2">
                          {providerTestResult.latency_ms}ms
                        </Badge>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Provider Selection */}
                <div className="space-y-2">
                  <Label>LLM 제공자</Label>
                  <Select
                    value={aiSettings.llmProvider}
                    onValueChange={(value: LLMProviderType) => updateAISetting('llmProvider', value)}
                  >
                    <SelectTrigger className="w-full md:w-[400px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LLM_PROVIDERS.map((provider) => (
                        <SelectItem key={provider.value} value={provider.value}>
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${provider.color}`} />
                            <span className="font-medium">{provider.label}</span>
                            <span className="text-xs text-muted-foreground">{provider.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                {/* OpenAI Settings */}
                <div className={`space-y-4 ${aiSettings.llmProvider !== 'openai' ? 'opacity-50' : ''}`}>
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-green-500" />
                    OpenAI 설정
                    {aiSettings.llmProvider === 'openai' && (
                      <Badge variant="secondary" className="text-xs">현재 사용중</Badge>
                    )}
                  </h4>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="openai-key">API 키</Label>
                      <div className="flex gap-2">
                        <Input
                          id="openai-key"
                          type={showApiKeys['openai'] ? 'text' : 'password'}
                          value={aiSettings.openaiApiKey}
                          onChange={(e) => updateAISetting('openaiApiKey', e.target.value)}
                          placeholder="sk-..."
                          className="font-mono text-sm"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => toggleKeyVisibility('openai')}
                        >
                          {showApiKeys['openai'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="openai-model" className="flex items-center gap-2">
                        모델
                        {modelSource.openai === 'api' && (
                          <Badge variant="outline" className="text-xs">API</Badge>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={() => loadModelsForProvider('openai')}
                          disabled={isLoadingModels.openai}
                        >
                          <RefreshCw className={`h-3 w-3 ${isLoadingModels.openai ? 'animate-spin' : ''}`} />
                        </Button>
                      </Label>
                      <Select
                        value={aiSettings.openaiModel}
                        onValueChange={(value) => updateAISetting('openaiModel', value)}
                      >
                        <SelectTrigger id="openai-model">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {getModelsForProvider('openai').map((model) => (
                            <SelectItem key={model.value} value={model.value}>
                              {model.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* Anthropic Settings */}
                <div className={`space-y-4 ${aiSettings.llmProvider !== 'anthropic' ? 'opacity-50' : ''}`}>
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-orange-500" />
                    Anthropic 설정
                    {aiSettings.llmProvider === 'anthropic' && (
                      <Badge variant="secondary" className="text-xs">현재 사용중</Badge>
                    )}
                  </h4>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="anthropic-key">API 키</Label>
                      <div className="flex gap-2">
                        <Input
                          id="anthropic-key"
                          type={showApiKeys['anthropic'] ? 'text' : 'password'}
                          value={aiSettings.anthropicApiKey}
                          onChange={(e) => updateAISetting('anthropicApiKey', e.target.value)}
                          placeholder="sk-ant-..."
                          className="font-mono text-sm"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => toggleKeyVisibility('anthropic')}
                        >
                          {showApiKeys['anthropic'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="anthropic-model" className="flex items-center gap-2">
                        모델
                        {modelSource.anthropic === 'api' && (
                          <Badge variant="outline" className="text-xs">API</Badge>
                        )}
                      </Label>
                      <Select
                        value={aiSettings.anthropicModel}
                        onValueChange={(value) => updateAISetting('anthropicModel', value)}
                      >
                        <SelectTrigger id="anthropic-model">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {getModelsForProvider('anthropic').map((model) => (
                            <SelectItem key={model.value} value={model.value}>
                              {model.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* Google AI Settings */}
                <div className={`space-y-4 ${aiSettings.llmProvider !== 'google' ? 'opacity-50' : ''}`}>
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-blue-500" />
                    Google AI 설정
                    {aiSettings.llmProvider === 'google' && (
                      <Badge variant="secondary" className="text-xs">현재 사용중</Badge>
                    )}
                  </h4>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="google-key">API 키</Label>
                      <div className="flex gap-2">
                        <Input
                          id="google-key"
                          type={showApiKeys['google'] ? 'text' : 'password'}
                          value={aiSettings.googleApiKey}
                          onChange={(e) => updateAISetting('googleApiKey', e.target.value)}
                          placeholder="AIza..."
                          className="font-mono text-sm"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => toggleKeyVisibility('google')}
                        >
                          {showApiKeys['google'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="google-model" className="flex items-center gap-2">
                        모델
                        {modelSource.google === 'api' && (
                          <Badge variant="outline" className="text-xs">API</Badge>
                        )}
                      </Label>
                      <Select
                        value={aiSettings.googleModel}
                        onValueChange={(value) => updateAISetting('googleModel', value)}
                      >
                        <SelectTrigger id="google-model">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {getModelsForProvider('google').map((model) => (
                            <SelectItem key={model.value} value={model.value}>
                              {model.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* OpenRouter Settings */}
                <div className={`space-y-4 ${aiSettings.llmProvider !== 'openrouter' ? 'opacity-50' : ''}`}>
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-purple-500" />
                    OpenRouter 설정
                    {aiSettings.llmProvider === 'openrouter' && (
                      <Badge variant="secondary" className="text-xs">현재 사용중</Badge>
                    )}
                    <a href="https://openrouter.ai/" target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                      <ExternalLink className="h-3 w-3 inline" /> 사이트
                    </a>
                  </h4>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="openrouter-key">API 키</Label>
                      <div className="flex gap-2">
                        <Input
                          id="openrouter-key"
                          type={showApiKeys['openrouter'] ? 'text' : 'password'}
                          value={aiSettings.openrouterApiKey}
                          onChange={(e) => updateAISetting('openrouterApiKey', e.target.value)}
                          placeholder="sk-or-..."
                          className="font-mono text-sm"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => toggleKeyVisibility('openrouter')}
                        >
                          {showApiKeys['openrouter'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="openrouter-model" className="flex items-center gap-2">
                        모델
                        {modelSource.openrouter === 'api' && (
                          <Badge variant="outline" className="text-xs">API</Badge>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={() => loadModelsForProvider('openrouter')}
                          disabled={isLoadingModels.openrouter}
                        >
                          <RefreshCw className={`h-3 w-3 ${isLoadingModels.openrouter ? 'animate-spin' : ''}`} />
                        </Button>
                      </Label>
                      <Select
                        value={aiSettings.openrouterModel}
                        onValueChange={(value) => updateAISetting('openrouterModel', value)}
                      >
                        <SelectTrigger id="openrouter-model">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {getModelsForProvider('openrouter').map((model) => (
                            <SelectItem key={model.value} value={model.value}>
                              {model.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* Ollama Settings */}
                <div className={`space-y-4 ${aiSettings.llmProvider !== 'ollama' ? 'opacity-50' : ''}`}>
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-gray-500" />
                    Ollama 설정 (로컬 LLM)
                    {aiSettings.llmProvider === 'ollama' && (
                      <Badge variant="secondary" className="text-xs">현재 사용중</Badge>
                    )}
                  </h4>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="ollama-url">Ollama URL</Label>
                      <Input
                        id="ollama-url"
                        value={aiSettings.ollamaBaseUrl}
                        onChange={(e) => updateAISetting('ollamaBaseUrl', e.target.value)}
                        placeholder="http://localhost:11434"
                        className="font-mono text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ollama-model" className="flex items-center gap-2">
                        모델
                        {modelSource.ollama === 'api' && (
                          <Badge variant="outline" className="text-xs">API</Badge>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={() => loadModelsForProvider('ollama')}
                          disabled={isLoadingModels.ollama}
                        >
                          <RefreshCw className={`h-3 w-3 ${isLoadingModels.ollama ? 'animate-spin' : ''}`} />
                        </Button>
                      </Label>
                      <Select
                        value={aiSettings.ollamaModel}
                        onValueChange={(value) => updateAISetting('ollamaModel', value)}
                      >
                        <SelectTrigger id="ollama-model">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {getModelsForProvider('ollama').map((model) => (
                            <SelectItem key={model.value} value={model.value}>
                              {model.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* Azure OpenAI Settings */}
                <div className={`space-y-4 ${aiSettings.llmProvider !== 'azure' ? 'opacity-50' : ''}`}>
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-cyan-500" />
                    Azure OpenAI 설정
                    {aiSettings.llmProvider === 'azure' && (
                      <Badge variant="secondary" className="text-xs">현재 사용중</Badge>
                    )}
                  </h4>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="azure-key">API 키</Label>
                      <div className="flex gap-2">
                        <Input
                          id="azure-key"
                          type={showApiKeys['azure'] ? 'text' : 'password'}
                          value={aiSettings.azureApiKey}
                          onChange={(e) => updateAISetting('azureApiKey', e.target.value)}
                          placeholder="Azure API Key"
                          className="font-mono text-sm"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => toggleKeyVisibility('azure')}
                        >
                          {showApiKeys['azure'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="azure-endpoint">엔드포인트</Label>
                      <Input
                        id="azure-endpoint"
                        value={aiSettings.azureEndpoint}
                        onChange={(e) => updateAISetting('azureEndpoint', e.target.value)}
                        placeholder="https://your-resource.openai.azure.com/"
                        className="font-mono text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="azure-deployment">배포 이름</Label>
                      <Input
                        id="azure-deployment"
                        value={aiSettings.azureDeploymentName}
                        onChange={(e) => updateAISetting('azureDeploymentName', e.target.value)}
                        placeholder="gpt-4o-deployment"
                        className="font-mono text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="azure-version">API 버전</Label>
                      <Input
                        id="azure-version"
                        value={aiSettings.azureApiVersion}
                        onChange={(e) => updateAISetting('azureApiVersion', e.target.value)}
                        placeholder="2024-02-15-preview"
                        className="font-mono text-sm"
                      />
                    </div>
                  </div>
                </div>

                {/* Custom REST API Settings */}
                <div className={`space-y-4 ${aiSettings.llmProvider !== 'custom' ? 'opacity-50' : ''}`}>
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-pink-500" />
                    커스텀 REST API 설정
                    {aiSettings.llmProvider === 'custom' && (
                      <Badge variant="secondary" className="text-xs">현재 사용중</Badge>
                    )}
                  </h4>
                  <Alert className="mb-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      OpenAI 호환 API 형식을 지원합니다. (예: LiteLLM, vLLM, LocalAI 등)
                    </AlertDescription>
                  </Alert>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="custom-url">Base URL</Label>
                      <Input
                        id="custom-url"
                        value={aiSettings.customBaseUrl}
                        onChange={(e) => updateAISetting('customBaseUrl', e.target.value)}
                        placeholder="https://your-api.example.com/v1"
                        className="font-mono text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="custom-key">API 키 (선택)</Label>
                      <div className="flex gap-2">
                        <Input
                          id="custom-key"
                          type={showApiKeys['custom'] ? 'text' : 'password'}
                          value={aiSettings.customApiKey}
                          onChange={(e) => updateAISetting('customApiKey', e.target.value)}
                          placeholder="your-api-key"
                          className="font-mono text-sm"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => toggleKeyVisibility('custom')}
                        >
                          {showApiKeys['custom'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="custom-model">모델 이름</Label>
                      <Input
                        id="custom-model"
                        value={aiSettings.customModel}
                        onChange={(e) => updateAISetting('customModel', e.target.value)}
                        placeholder="your-model-name"
                        className="font-mono text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="custom-headers">추가 헤더 (JSON)</Label>
                      <Input
                        id="custom-headers"
                        value={aiSettings.customHeaders}
                        onChange={(e) => updateAISetting('customHeaders', e.target.value)}
                        placeholder='{"X-Custom-Header": "value"}'
                        className="font-mono text-sm"
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Search API Settings Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="h-5 w-5" />
                  검색 API 설정
                </CardTitle>
                <CardDescription>
                  웹 검색에 사용할 API 키를 설정합니다. 여러 제공자를 설정하면 병렬 검색이 가능합니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Brave Search */}
                <div className="space-y-2">
                  <Label htmlFor="brave-key" className="flex items-center gap-2">
                    Brave Search API
                    <a href="https://brave.com/search/api/" target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                      <ExternalLink className="h-3 w-3 inline" /> API 키 발급
                    </a>
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="brave-key"
                      type={showApiKeys['brave'] ? 'text' : 'password'}
                      value={aiSettings.braveApiKey}
                      onChange={(e) => updateAISetting('braveApiKey', e.target.value)}
                      placeholder="BSA..."
                      className="font-mono text-sm"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleKeyVisibility('brave')}
                    >
                      {showApiKeys['brave'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                {/* Tavily Search */}
                <div className="space-y-2">
                  <Label htmlFor="tavily-key" className="flex items-center gap-2">
                    Tavily Search API
                    <a href="https://tavily.com/" target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                      <ExternalLink className="h-3 w-3 inline" /> API 키 발급
                    </a>
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="tavily-key"
                      type={showApiKeys['tavily'] ? 'text' : 'password'}
                      value={aiSettings.tavilyApiKey}
                      onChange={(e) => updateAISetting('tavilyApiKey', e.target.value)}
                      placeholder="tvly-..."
                      className="font-mono text-sm"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleKeyVisibility('tavily')}
                    >
                      {showApiKeys['tavily'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                {/* Perplexity */}
                <div className="space-y-2">
                  <Label htmlFor="perplexity-key" className="flex items-center gap-2">
                    Perplexity API
                    <a href="https://docs.perplexity.ai/" target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                      <ExternalLink className="h-3 w-3 inline" /> API 키 발급
                    </a>
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="perplexity-key"
                      type={showApiKeys['perplexity'] ? 'text' : 'password'}
                      value={aiSettings.perplexityApiKey}
                      onChange={(e) => updateAISetting('perplexityApiKey', e.target.value)}
                      placeholder="pplx-..."
                      className="font-mono text-sm"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleKeyVisibility('perplexity')}
                    >
                      {showApiKeys['perplexity'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* API Key Info */}
            <Alert>
              <Key className="h-4 w-4" />
              <AlertDescription>
                <strong>API 키 보안:</strong> API 키는 로컬 저장소와 서버(Consul)에 저장됩니다.
                <br />
                <span className="text-muted-foreground">
                  자동 확장 크롤링 기능을 사용하려면 최소 하나의 LLM API 키가 필요합니다.
                </span>
              </AlertDescription>
            </Alert>
          </TabsContent>

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
