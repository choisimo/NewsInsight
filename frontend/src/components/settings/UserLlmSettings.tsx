import React, { useState, useEffect, useCallback } from 'react';
import {
  Bot,
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
  User,
  AlertCircle,
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import {
  getEffectiveLlmSettings,
  getUserLlmSettings,
  saveUserLlmSetting,
  deleteUserLlmSetting,
  deleteAllUserLlmSettings,
  testUserLlmConnection,
  getLlmProviderTypes,
} from '@/lib/api';
import type {
  LlmProviderType,
  LlmProviderSettings,
  LlmProviderSettingsRequest,
  LlmProviderTypeInfo,
  LlmTestResult,
} from '@/types/api';

interface UserLlmSettingsProps {
  userId: string;
}

const DEFAULT_MODELS: Record<LlmProviderType, string[]> = {
  OPENAI: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  ANTHROPIC: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
  GOOGLE: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash-exp'],
  OPENROUTER: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-pro-1.5'],
  OLLAMA: ['llama3.1', 'mistral', 'mixtral', 'codellama'],
  AZURE_OPENAI: ['gpt-4o', 'gpt-4-turbo', 'gpt-35-turbo'],
  CUSTOM: ['default'],
};

/**
 * 사용자 LLM Provider 설정 컴포넌트
 * 
 * - 사용자 개인 설정이 있으면 해당 설정 표시
 * - 없으면 관리자 전역 설정 표시 (읽기 전용)
 * - 사용자는 자신만의 설정을 추가/수정/삭제 가능
 */
export const UserLlmSettings: React.FC<UserLlmSettingsProps> = ({ userId }) => {
  const { toast } = useToast();

  // State
  const [providerTypes, setProviderTypes] = useState<LlmProviderTypeInfo[]>([]);
  const [effectiveSettings, setEffectiveSettings] = useState<LlmProviderSettings[]>([]);
  const [userSettings, setUserSettings] = useState<LlmProviderSettings[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, LlmTestResult>>({});
  const [testingProvider, setTestingProvider] = useState<string | null>(null);

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<LlmProviderType | null>(null);
  const [editForm, setEditForm] = useState<LlmProviderSettingsRequest>({
    providerType: 'OPENAI',
    apiKey: '',
    defaultModel: '',
    baseUrl: '',
    enabled: true,
    priority: 100,
    maxTokens: 4096,
    temperature: 0.7,
    timeoutMs: 60000,
  });

  // Load data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [types, effective, user] = await Promise.all([
        getLlmProviderTypes(),
        getEffectiveLlmSettings(userId),
        getUserLlmSettings(userId),
      ]);
      setProviderTypes(types);
      setEffectiveSettings(effective);
      setUserSettings(user);
    } catch (error) {
      console.error('Failed to load LLM settings:', error);
      toast({
        title: '로드 실패',
        description: 'LLM 설정을 불러오는데 실패했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [userId, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Check if provider has user override
  const hasUserOverride = (providerType: LlmProviderType): boolean => {
    return userSettings.some(s => s.providerType === providerType);
  };

  // Get effective setting for provider
  const getEffectiveSetting = (providerType: LlmProviderType): LlmProviderSettings | undefined => {
    return effectiveSettings.find(s => s.providerType === providerType);
  };

  // Open edit dialog
  const openEditDialog = (providerType: LlmProviderType) => {
    const existing = userSettings.find(s => s.providerType === providerType);
    const effective = getEffectiveSetting(providerType);
    
    setEditingProvider(providerType);
    setEditForm({
      providerType,
      apiKey: '', // Always empty for security
      defaultModel: existing?.defaultModel || effective?.defaultModel || DEFAULT_MODELS[providerType][0],
      baseUrl: existing?.baseUrl || effective?.baseUrl || '',
      enabled: existing?.enabled ?? effective?.enabled ?? true,
      priority: existing?.priority ?? effective?.priority ?? 100,
      maxTokens: existing?.maxTokens ?? effective?.maxTokens ?? 4096,
      temperature: existing?.temperature ?? effective?.temperature ?? 0.7,
      timeoutMs: existing?.timeoutMs ?? effective?.timeoutMs ?? 60000,
      azureDeploymentName: existing?.azureDeploymentName || effective?.azureDeploymentName || '',
      azureApiVersion: existing?.azureApiVersion || effective?.azureApiVersion || '2024-02-01',
    });
    setEditDialogOpen(true);
  };

  // Save user setting
  const handleSave = async () => {
    if (!editingProvider) return;

    setIsSaving(true);
    try {
      await saveUserLlmSetting(userId, editForm);
      toast({
        title: '저장 완료',
        description: `${editingProvider} 설정이 저장되었습니다.`,
      });
      setEditDialogOpen(false);
      loadData();
    } catch (error) {
      console.error('Failed to save LLM setting:', error);
      toast({
        title: '저장 실패',
        description: '설정 저장에 실패했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Delete user setting (fallback to global)
  const handleDelete = async (providerType: LlmProviderType) => {
    try {
      await deleteUserLlmSetting(userId, providerType);
      toast({
        title: '삭제 완료',
        description: '개인 설정이 삭제되었습니다. 전역 설정으로 돌아갑니다.',
      });
      loadData();
    } catch (error) {
      console.error('Failed to delete LLM setting:', error);
      toast({
        title: '삭제 실패',
        description: '설정 삭제에 실패했습니다.',
        variant: 'destructive',
      });
    }
  };

  // Delete all user settings
  const handleDeleteAll = async () => {
    try {
      await deleteAllUserLlmSettings(userId);
      toast({
        title: '전체 삭제 완료',
        description: '모든 개인 설정이 삭제되었습니다.',
      });
      loadData();
    } catch (error) {
      console.error('Failed to delete all LLM settings:', error);
      toast({
        title: '삭제 실패',
        description: '설정 삭제에 실패했습니다.',
        variant: 'destructive',
      });
    }
  };

  // Test connection
  const handleTestConnection = async (providerType: LlmProviderType) => {
    setTestingProvider(providerType);
    try {
      const setting = getEffectiveSetting(providerType);
      if (!setting) {
        throw new Error('No settings found for this provider');
      }

      // Use the correct test endpoint based on whether this is a saved setting
      // testUserLlmConnection uses the stored API key from the database
      const result = await testUserLlmConnection(setting.id);

      setTestResults(prev => ({ ...prev, [providerType]: result }));

      toast({
        title: result.success ? '연결 성공' : '연결 실패',
        description: result.message,
        variant: result.success ? 'default' : 'destructive',
      });
    } catch (error) {
      console.error('Connection test failed:', error);
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
  const toggleKeyVisibility = (provider: string) => {
    setShowApiKeys(prev => ({ ...prev, [provider]: !prev[provider] }));
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                LLM 제공자 설정
              </CardTitle>
              <CardDescription>
                AI 분석에 사용할 LLM 제공자를 설정합니다. 개인 설정이 없으면 관리자 전역 설정이 적용됩니다.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={loadData}>
                <RefreshCw className="h-4 w-4 mr-2" />
                새로고침
              </Button>
              {userSettings.length > 0 && (
                <Button variant="destructive" size="sm" onClick={handleDeleteAll}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  전체 초기화
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Info Alert */}
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <Shield className="h-4 w-4 inline mr-1" /> 아이콘은 관리자 전역 설정, 
          <User className="h-4 w-4 inline mx-1" /> 아이콘은 개인 설정을 나타냅니다.
          개인 설정이 없는 경우 전역 설정이 자동으로 적용됩니다.
        </AlertDescription>
      </Alert>

      {/* Provider List */}
      <div className="grid gap-4">
        {providerTypes.map((type) => {
          const setting = getEffectiveSetting(type.value);
          const isUserSetting = hasUserOverride(type.value);
          const testResult = testResults[type.value];

          return (
            <Card key={type.value} className={!setting?.enabled ? 'opacity-60' : ''}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* Provider Icon/Badge */}
                    <div className="flex items-center gap-2">
                      {isUserSetting ? (
                        <Badge variant="default" className="gap-1">
                          <User className="h-3 w-3" />
                          개인
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1">
                          <Shield className="h-3 w-3" />
                          전역
                        </Badge>
                      )}
                    </div>

                    {/* Provider Info */}
                    <div>
                      <h3 className="font-semibold">{type.displayName}</h3>
                      <p className="text-sm text-muted-foreground">
                        모델: {setting?.defaultModel || '미설정'}
                      </p>
                    </div>
                  </div>

                  {/* Status & Actions */}
                  <div className="flex items-center gap-3">
                    {/* API Key Status */}
                    {setting && (
                      <div className="flex items-center gap-2 text-sm">
                        {setting.hasApiKey ? (
                          <Badge variant="outline" className="text-green-600">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            API 키 설정됨
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-yellow-600">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            API 키 없음
                          </Badge>
                        )}
                      </div>
                    )}

                    {/* Test Result */}
                    {testResult && (
                      <Badge variant={testResult.success ? 'default' : 'destructive'}>
                        {testResult.success ? (
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                        ) : (
                          <XCircle className="h-3 w-3 mr-1" />
                        )}
                        {testResult.success ? '연결됨' : '실패'}
                      </Badge>
                    )}

                    {/* Enabled Status */}
                    <Badge variant={setting?.enabled ? 'default' : 'secondary'}>
                      {setting?.enabled ? '활성화' : '비활성화'}
                    </Badge>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTestConnection(type.value)}
                        disabled={testingProvider === type.value || !setting?.hasApiKey}
                      >
                        {testingProvider === type.value ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Zap className="h-4 w-4" />
                        )}
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditDialog(type.value)}
                      >
                        설정
                      </Button>

                      {isUserSetting && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(type.value)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingProvider} 설정
            </DialogTitle>
            <DialogDescription>
              개인 LLM 설정을 입력하세요. 빈 값은 전역 설정을 사용합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* API Key */}
            <div className="space-y-2">
              <Label htmlFor="apiKey">API 키</Label>
              <div className="flex gap-2">
                <Input
                  id="apiKey"
                  type={showApiKeys['edit'] ? 'text' : 'password'}
                  value={editForm.apiKey || ''}
                  onChange={(e) => setEditForm(prev => ({ ...prev, apiKey: e.target.value }))}
                  placeholder="새 API 키 입력 (비우면 기존 값 유지)"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => toggleKeyVisibility('edit')}
                >
                  {showApiKeys['edit'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* Model */}
            <div className="space-y-2">
              <Label htmlFor="model">모델</Label>
              <Select
                value={editForm.defaultModel}
                onValueChange={(value) => setEditForm(prev => ({ ...prev, defaultModel: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="모델 선택" />
                </SelectTrigger>
                <SelectContent>
                  {editingProvider && DEFAULT_MODELS[editingProvider]?.map((model) => (
                    <SelectItem key={model} value={model}>{model}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Base URL (for Ollama/Custom) */}
            {(editingProvider === 'OLLAMA' || editingProvider === 'CUSTOM') && (
              <div className="space-y-2">
                <Label htmlFor="baseUrl">Base URL</Label>
                <Input
                  id="baseUrl"
                  value={editForm.baseUrl || ''}
                  onChange={(e) => setEditForm(prev => ({ ...prev, baseUrl: e.target.value }))}
                  placeholder={editingProvider === 'OLLAMA' ? 'http://localhost:11434' : 'https://api.example.com'}
                />
              </div>
            )}

            {/* Azure specific fields */}
            {editingProvider === 'AZURE_OPENAI' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="azureEndpoint">Azure Endpoint</Label>
                  <Input
                    id="azureEndpoint"
                    value={editForm.baseUrl || ''}
                    onChange={(e) => setEditForm(prev => ({ ...prev, baseUrl: e.target.value }))}
                    placeholder="https://your-resource.openai.azure.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="azureDeploymentName">Deployment Name</Label>
                  <Input
                    id="azureDeploymentName"
                    value={editForm.azureDeploymentName || ''}
                    onChange={(e) => setEditForm(prev => ({ ...prev, azureDeploymentName: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="azureApiVersion">API Version</Label>
                  <Input
                    id="azureApiVersion"
                    value={editForm.azureApiVersion || ''}
                    onChange={(e) => setEditForm(prev => ({ ...prev, azureApiVersion: e.target.value }))}
                    placeholder="2024-02-01"
                  />
                </div>
              </>
            )}

            <Separator />

            {/* Advanced Settings */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="priority">우선순위</Label>
                <Input
                  id="priority"
                  type="number"
                  min={1}
                  max={999}
                  value={editForm.priority}
                  onChange={(e) => setEditForm(prev => ({ ...prev, priority: parseInt(e.target.value) }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxTokens">최대 토큰</Label>
                <Input
                  id="maxTokens"
                  type="number"
                  min={1}
                  max={128000}
                  value={editForm.maxTokens}
                  onChange={(e) => setEditForm(prev => ({ ...prev, maxTokens: parseInt(e.target.value) }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="temperature">Temperature</Label>
                <Input
                  id="temperature"
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={editForm.temperature}
                  onChange={(e) => setEditForm(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="timeoutMs">타임아웃 (ms)</Label>
                <Input
                  id="timeoutMs"
                  type="number"
                  min={1000}
                  max={300000}
                  value={editForm.timeoutMs}
                  onChange={(e) => setEditForm(prev => ({ ...prev, timeoutMs: parseInt(e.target.value) }))}
                />
              </div>
            </div>

            {/* Enabled Toggle */}
            <div className="flex items-center justify-between">
              <Label htmlFor="enabled">활성화</Label>
              <Switch
                id="enabled"
                checked={editForm.enabled}
                onCheckedChange={(checked) => setEditForm(prev => ({ ...prev, enabled: checked }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              취소
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserLlmSettings;
