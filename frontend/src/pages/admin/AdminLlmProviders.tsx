import React, { useState, useEffect, useCallback } from 'react';
import {
  Workflow,
  CheckCircle2,
  XCircle,
  Loader2,
  Zap,
  Save,
  Eye,
  EyeOff,
  Trash2,
  RefreshCw,
  Shield,
  Plus,
  ShieldAlert,
  Power,
  PowerOff,
  Wand2,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  getGlobalLlmSettings,
  saveGlobalLlmSetting,
  deleteGlobalLlmSetting,
  testGlobalLlmConnection,
  toggleGlobalLlmSetting,
  getLlmProviderTypes,
  testNewLlmConnection,
} from '@/lib/api';
import type {
  LlmProviderType,
  LlmProviderSettings,
  LlmProviderSettingsRequest,
  LlmProviderTypeInfo,
  LlmTestResult,
} from '@/types/api';
import { APIKeyWizard } from '@/components/APIKeyWizard';

const DEFAULT_MODELS: Record<LlmProviderType, string[]> = {
  // OpenAI - 2025년 12월 최신 (GPT-5 시리즈 출시)
  OPENAI: [
    'gpt-5', 'gpt-5-mini', 'gpt-5-nano',           // Frontier 모델
    'gpt-4.1', 'gpt-4.1-mini',                      // 고급 모델
    'o3', 'o3-mini', 'o3-pro', 'o4-mini',          // 추론 모델
    'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo',        // 기존 모델
  ],
  // Anthropic Claude - 2025년 12월 최신 (Claude 4 시리즈)
  ANTHROPIC: [
    'claude-sonnet-4-20250514',                    // 추천, 성능-가격 최적
    'claude-opus-4-20250514',                      // 가장 강력
    'claude-haiku-4-20250514',                     // 경량, 빠른 응답
    'claude-3-5-sonnet-20241022',                  // 이전 버전 호환
    'claude-3-5-haiku-20241022',
  ],
  // Google Gemini - 2025년 12월 최신 (Gemini 3 시리즈)
  GOOGLE: [
    'gemini-3-pro-preview',                        // 최고 지능, 멀티모달
    'gemini-3-flash-preview',                      // Pro 수준, Flash 속도
    'gemini-2.5-pro',                              // 씽킹 모델, 복잡 추론
    'gemini-2.5-flash',                            // 최고 가격-성능비
    'gemini-2.5-flash-lite',                       // 비용 최적화
    'gemini-2.0-flash',                            // 워크홀스
  ],
  // OpenRouter - 다양한 공급자 모델 통합 (무료 모델 포함)
  OPENROUTER: [
    // 무료 모델 (Free)
    'google/gemini-2.0-flash-exp:free',
    'google/gemini-exp-1206:free',
    'meta-llama/llama-3.2-3b-instruct:free',
    'meta-llama/llama-3.1-8b-instruct:free',
    'microsoft/phi-3-mini-128k-instruct:free',
    'mistralai/mistral-7b-instruct:free',
    'openchat/openchat-7b:free',
    'huggingfaceh4/zephyr-7b-beta:free',
    'qwen/qwen-2-7b-instruct:free',
    'nousresearch/hermes-3-llama-3.1-405b:free',
    // 유료 모델
    'openai/gpt-5', 'openai/gpt-4o',
    'anthropic/claude-sonnet-4', 'anthropic/claude-3.5-haiku',
    'google/gemini-2.5-pro', 'google/gemini-3-pro',
    'meta-llama/llama-3.1-405b-instruct',
    'mistralai/mistral-large-2411',
    'qwen/qwen-max',
    'deepseek/deepseek-r1',
  ],
  // Ollama - 로컬 실행 모델
  OLLAMA: [
    'llama3.2',                                    // Meta Llama 3.2
    'mistral',                                     // Mistral AI
    'neural-chat',                                 // Intel
    'deepseek-r1',                                 // DeepSeek R1
    'smollm2',                                     // 경량 모델
    'mixtral', 'codellama',
  ],
  // Azure OpenAI - 배포된 모델만 사용 가능
  AZURE_OPENAI: [
    'gpt-5', 'gpt-4o', 'gpt-4-turbo', 'gpt-35-turbo',
  ],
  // Together AI - DeepSeek 및 오픈소스 모델
  TOGETHER_AI: [
    'deepseek-ai/DeepSeek-R1-Distill-Llama-70B',  // 추론 능력 70B
    'deepseek-ai/DeepSeek-V3',                    // DeepSeek V3
    'meta-llama/Llama-3.1-405B-Instruct-Turbo',
    'mistralai/Mixtral-8x22B-Instruct-v0.1',
  ],
  CUSTOM: ['default'],
};

/**
 * 관리자 전용 글로벌 LLM Provider 설정 페이지
 */
export default function AdminLlmProviders() {
  const { toast } = useToast();
  const { user } = useAuth();

  // State
  const [providerTypes, setProviderTypes] = useState<LlmProviderTypeInfo[]>([]);
  const [settings, setSettings] = useState<LlmProviderSettings[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, LlmTestResult>>({});
  const [testingProvider, setTestingProvider] = useState<string | null>(null);

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<LlmProviderType | null>(null);
  const [isNewProvider, setIsNewProvider] = useState(false);
  const [editForm, setEditForm] = useState<LlmProviderSettingsRequest>({
    providerType: 'OPENAI',
    apiKey: '',
    defaultModel: '',
    baseUrl: '',
    enabled: true,
  });

  // API Key Wizard state
  const [apiKeyWizardOpen, setApiKeyWizardOpen] = useState(false);

  // Role check
  const isAdmin = user?.role === 'admin';

  // Load data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [types, globalSettings] = await Promise.all([
        getLlmProviderTypes(),
        getGlobalLlmSettings(),
      ]);
      setProviderTypes(types);
      setSettings(globalSettings);
    } catch (error) {
      console.error('Failed to load LLM settings:', error);
      toast({
        title: '데이터 로드 실패',
        description: 'LLM 설정을 불러오는데 실패했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Open edit dialog
  const openEditDialog = (providerType: LlmProviderType | null) => {
    if (providerType) {
      const existing = settings.find(s => s.providerType === providerType);
      if (existing) {
        setEditForm({
          providerType: existing.providerType,
          apiKey: existing.apiKeyMasked || '',
          defaultModel: existing.defaultModel || '',
          baseUrl: existing.baseUrl || '',
          enabled: existing.enabled,
        });
        setIsNewProvider(false);
      }
      setEditingProvider(providerType);
    } else {
      // New provider
      setEditForm({
        providerType: 'OPENAI',
        apiKey: '',
        defaultModel: '',
        baseUrl: '',
        enabled: true,
      });
      setIsNewProvider(true);
      setEditingProvider(null);
    }
    setEditDialogOpen(true);
  };

  // Save provider settings
  const handleSave = async () => {
    if (!editForm.apiKey?.trim()) {
      toast({
        title: 'API 키 필요',
        description: 'API 키를 입력해주세요.',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    try {
      await saveGlobalLlmSetting(editForm);
      toast({
        title: '저장 완료',
        description: `${editForm.providerType} 설정이 저장되었습니다.`,
      });
      setEditDialogOpen(false);
      loadData();
    } catch (error) {
      console.error('Failed to save LLM setting:', error);
      toast({
        title: '저장 실패',
        description: '설정을 저장하는데 실패했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Delete provider
  const handleDelete = async (providerType: LlmProviderType) => {
    if (!confirm(`${providerType} 설정을 삭제하시겠습니까?`)) return;

    try {
      await deleteGlobalLlmSetting(providerType);
      toast({
        title: '삭제 완료',
        description: `${providerType} 설정이 삭제되었습니다.`,
      });
      loadData();
    } catch (error) {
      console.error('Failed to delete LLM setting:', error);
      toast({
        title: '삭제 실패',
        description: '설정을 삭제하는데 실패했습니다.',
        variant: 'destructive',
      });
    }
  };

  // Toggle enabled
  const handleToggle = async (setting: LlmProviderSettings) => {
    try {
      await toggleGlobalLlmSetting(setting.providerType, !setting.enabled);
      toast({
        title: setting.enabled ? '비활성화됨' : '활성화됨',
        description: `${setting.providerType}이(가) ${setting.enabled ? '비활성화' : '활성화'}되었습니다.`,
      });
      loadData();
    } catch (error) {
      console.error('Failed to toggle LLM setting:', error);
      toast({
        title: '변경 실패',
        description: '설정을 변경하는데 실패했습니다.',
        variant: 'destructive',
      });
    }
  };

  // Test connection
  const handleTestConnection = async (setting: LlmProviderSettings) => {
    setTestingProvider(setting.providerType);
    setTestResults(prev => ({ ...prev, [setting.providerType]: undefined as any }));

    try {
      const result = await testGlobalLlmConnection(setting.providerType);
      setTestResults(prev => ({ ...prev, [setting.providerType]: result }));
    } catch (error) {
      console.error('Failed to test connection:', error);
      setTestResults(prev => ({
        ...prev,
        [setting.providerType]: {
          success: false,
          providerType: setting.providerType,
          message: '연결 테스트 실패',
          error: error instanceof Error ? error.message : '알 수 없는 오류',
        },
      }));
    } finally {
      setTestingProvider(null);
    }
  };

  // Test new connection before save
  const handleTestNewConnection = async () => {
    if (!editForm.apiKey?.trim()) {
      toast({
        title: 'API 키 필요',
        description: 'API 키를 입력해주세요.',
        variant: 'destructive',
      });
      return;
    }

    setTestingProvider('new');
    try {
      const result = await testNewLlmConnection(editForm);
      if (result.success) {
        toast({
          title: '연결 성공',
          description: result.message || '연결 테스트에 성공했습니다.',
        });
      } else {
        toast({
          title: '연결 실패',
          description: result.error || result.message || '연결 테스트에 실패했습니다.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Failed to test new connection:', error);
      toast({
        title: '테스트 실패',
        description: '연결 테스트 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setTestingProvider(null);
    }
  };

  // Toggle API key visibility
  const toggleApiKeyVisibility = (providerType: string) => {
    setShowApiKeys(prev => ({ ...prev, [providerType]: !prev[providerType] }));
  };

  // Mask API key
  const maskApiKey = (key: string | undefined): string => {
    if (!key) return '(설정되지 않음)';
    if (key.length <= 8) return '••••••••';
    return key.slice(0, 4) + '••••••••' + key.slice(-4);
  };

  // Handle API Key Wizard success - reload settings after auto-provisioning
  const handleApiKeyWizardSuccess = useCallback((provider: string, keyMasked: string) => {
    toast({
      title: 'API 키 자동 발급 완료',
      description: `${provider} API 키가 성공적으로 발급되고 저장되었습니다: ${keyMasked}`,
    });
    // Reload settings to reflect the new API key
    loadData();
  }, [toast, loadData]);

  // Access denied for non-admins
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <ShieldAlert className="w-16 h-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">접근 권한이 없습니다</h2>
        <p className="text-muted-foreground text-center">
          글로벌 LLM 설정은 관리자만 접근할 수 있습니다.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const configuredProviders = settings.map(s => s.providerType);
  const availableNewProviders = providerTypes.filter(
    t => !configuredProviders.includes(t.value)
  );

  return (
    <div className="space-y-6 container mx-auto p-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">LLM Provider 설정</h1>
          <p className="text-muted-foreground mt-1">
            시스템 전체에서 사용되는 LLM 공급자 설정을 관리합니다.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setApiKeyWizardOpen(true)}>
            <Wand2 className="w-4 h-4 mr-2" />
            API 키 자동 발급
          </Button>
          <Button variant="outline" onClick={loadData}>
            <RefreshCw className="w-4 h-4 mr-2" />
            새로고침
          </Button>
          {availableNewProviders.length > 0 && (
            <Button onClick={() => openEditDialog(null)}>
              <Plus className="w-4 h-4 mr-2" />
              Provider 추가
            </Button>
          )}
        </div>
      </div>

      <Alert>
        <Shield className="w-4 h-4" />
        <AlertDescription>
          여기서 설정한 LLM Provider는 시스템 전체 기본값으로 사용됩니다.
          개별 사용자는 자신의 설정으로 이를 덮어쓸 수 있습니다.
        </AlertDescription>
      </Alert>

      {/* Provider List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Workflow className="w-5 h-5" />
            설정된 Provider
          </CardTitle>
          <CardDescription>
            {settings.length}개의 LLM Provider가 설정되어 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {settings.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Workflow className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>설정된 LLM Provider가 없습니다.</p>
              <p className="text-sm mt-1">위의 "Provider 추가" 버튼을 클릭하여 추가하세요.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>모델</TableHead>
                  <TableHead>API 키</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead className="text-right">작업</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settings.map((setting) => {
                  const typeInfo = providerTypes.find(t => t.value === setting.providerType);
                  const testResult = testResults[setting.providerType];
                  
                  return (
                    <TableRow key={setting.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{typeInfo?.displayName || setting.providerType}</span>
                          {setting.enabled ? (
                            <Badge variant="default" className="bg-green-500">활성</Badge>
                          ) : (
                            <Badge variant="secondary">비활성</Badge>
                          )}
                        </div>
                        {typeInfo?.description && (
                          <p className="text-xs text-muted-foreground mt-1">{typeInfo.description}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <code className="text-sm bg-muted px-1 py-0.5 rounded">
                          {setting.defaultModel || '(기본값)'}
                        </code>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <code className="text-sm">
                            {showApiKeys[setting.providerType]
                              ? setting.apiKeyMasked
                              : maskApiKey(setting.apiKeyMasked)}
                          </code>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => toggleApiKeyVisibility(setting.providerType)}
                          >
                            {showApiKeys[setting.providerType] ? (
                              <EyeOff className="h-3 w-3" />
                            ) : (
                              <Eye className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        {testResult ? (
                          testResult.success ? (
                            <div className="flex items-center gap-1 text-green-600">
                              <CheckCircle2 className="w-4 h-4" />
                              <span className="text-sm">연결됨</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-red-600">
                              <XCircle className="w-4 h-4" />
                              <span className="text-sm" title={testResult.error}>실패</span>
                            </div>
                          )
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleTestConnection(setting)}
                            disabled={testingProvider === setting.providerType}
                          >
                            {testingProvider === setting.providerType ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Zap className="w-4 h-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggle(setting)}
                          >
                            {setting.enabled ? (
                              <PowerOff className="w-4 h-4" />
                            ) : (
                              <Power className="w-4 h-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(setting.providerType)}
                          >
                            <Save className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700"
                            onClick={() => handleDelete(setting.providerType)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {isNewProvider ? 'LLM Provider 추가' : `${editingProvider} 설정 편집`}
            </DialogTitle>
            <DialogDescription>
              API 키와 기본 모델을 설정하세요. 테스트 버튼으로 연결을 확인할 수 있습니다.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Provider Type (only for new) */}
            {isNewProvider && (
              <div className="space-y-2">
                <Label>Provider 타입</Label>
                <Select
                  value={editForm.providerType}
                  onValueChange={(value: LlmProviderType) =>
                    setEditForm(prev => ({
                      ...prev,
                      providerType: value,
                      defaultModel: DEFAULT_MODELS[value]?.[0] || '',
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableNewProviders.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* API Key */}
            <div className="space-y-2">
              <Label>API 키</Label>
              <Input
                type="password"
                value={editForm.apiKey}
                onChange={(e) => setEditForm(prev => ({ ...prev, apiKey: e.target.value }))}
                placeholder="sk-..."
              />
            </div>

            {/* Default Model */}
            <div className="space-y-2">
              <Label>기본 모델</Label>
              <Select
                value={editForm.defaultModel}
                onValueChange={(value) => setEditForm(prev => ({ ...prev, defaultModel: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="모델 선택" />
                </SelectTrigger>
                <SelectContent>
                  {DEFAULT_MODELS[editForm.providerType]?.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Base URL (for OLLAMA, CUSTOM, AZURE) */}
            {['OLLAMA', 'CUSTOM', 'AZURE_OPENAI'].includes(editForm.providerType) && (
              <div className="space-y-2">
                <Label>Base URL</Label>
                <Input
                  value={editForm.baseUrl || ''}
                  onChange={(e) => setEditForm(prev => ({ ...prev, baseUrl: e.target.value }))}
                  placeholder="http://localhost:11434"
                />
              </div>
            )}

            {/* Enabled */}
            <div className="flex items-center justify-between">
              <Label>활성화</Label>
              <Switch
                checked={editForm.enabled}
                onCheckedChange={(checked) => setEditForm(prev => ({ ...prev, enabled: checked }))}
              />
            </div>
          </div>

          <Separator />

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={handleTestNewConnection}
              disabled={testingProvider === 'new'}
            >
              {testingProvider === 'new' ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Zap className="w-4 h-4 mr-2" />
              )}
              연결 테스트
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* API Key Auto-Provisioning Wizard */}
      <APIKeyWizard
        open={apiKeyWizardOpen}
        onOpenChange={setApiKeyWizardOpen}
        onSuccess={handleApiKeyWizardSuccess}
      />
    </div>
  );
}
