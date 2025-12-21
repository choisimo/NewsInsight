import { useEffect, useState } from 'react';
import {
  Bot,
  CheckCircle,
  XCircle,
  Loader2,
  Zap,
  Save,
  Eye,
  EyeOff,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Settings,
} from 'lucide-react';
import {
  llmProvidersApi,
  type LlmProviderType,
  type LlmProviderTypeInfo,
  type LlmProviderSettings,
  type LlmProviderSettingsRequest,
  type LlmTestResult,
} from '../api/endpoints';
import { useAuth } from '../contexts/AuthContext';
import clsx from 'clsx';

// Default models per provider
const DEFAULT_MODELS: Record<LlmProviderType, string[]> = {
  OPENAI: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini'],
  ANTHROPIC: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
  GOOGLE: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash-exp'],
  OPENROUTER: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-pro-1.5', 'meta-llama/llama-3.1-70b-instruct'],
  OLLAMA: ['llama3.1', 'mistral', 'mixtral', 'codellama', 'qwen2.5'],
  AZURE_OPENAI: ['gpt-4o', 'gpt-4-turbo', 'gpt-35-turbo'],
  CUSTOM: ['default'],
};

export default function LlmSettings() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // State
  const [providerTypes, setProviderTypes] = useState<LlmProviderTypeInfo[]>([]);
  const [globalSettings, setGlobalSettings] = useState<LlmProviderSettings[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, LlmTestResult>>({});
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [types, settings] = await Promise.all([
        llmProvidersApi.getTypes(),
        llmProvidersApi.listGlobal(),
      ]);
      setProviderTypes(types);
      setGlobalSettings(settings);
    } catch (err) {
      console.error('Failed to load LLM settings:', err);
      setError('LLM 설정을 불러오는데 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Get setting for provider
  const getSetting = (providerType: LlmProviderType): LlmProviderSettings | undefined => {
    return globalSettings.find((s) => s.providerType === providerType);
  };

  // Open edit dialog
  const openEditDialog = (providerType: LlmProviderType) => {
    const existing = getSetting(providerType);

    setEditingProvider(providerType);
    setEditForm({
      providerType,
      apiKey: '', // Always empty for security
      defaultModel: existing?.defaultModel || DEFAULT_MODELS[providerType][0],
      baseUrl: existing?.baseUrl || '',
      enabled: existing?.enabled ?? true,
      priority: existing?.priority ?? 100,
      maxTokens: existing?.maxTokens ?? 4096,
      temperature: existing?.temperature ?? 0.7,
      timeoutMs: existing?.timeoutMs ?? 60000,
      azureDeploymentName: existing?.azureDeploymentName || '',
      azureApiVersion: existing?.azureApiVersion || '2024-02-01',
    });
    setEditDialogOpen(true);
  };

  // Save setting
  const handleSave = async () => {
    if (!editingProvider) return;

    setIsSaving(true);
    try {
      await llmProvidersApi.saveGlobal(editingProvider, editForm);
      setEditDialogOpen(false);
      await loadData();
    } catch (err) {
      console.error('Failed to save LLM setting:', err);
      setError('설정 저장에 실패했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  // Delete setting
  const handleDelete = async (providerType: LlmProviderType) => {
    if (!confirm(`${providerType} 전역 설정을 삭제하시겠습니까?`)) return;

    try {
      await llmProvidersApi.deleteGlobal(providerType);
      await loadData();
    } catch (err) {
      console.error('Failed to delete LLM setting:', err);
      setError('설정 삭제에 실패했습니다.');
    }
  };

  // Test connection
  const handleTestConnection = async (providerType: LlmProviderType) => {
    setTestingProvider(providerType);
    try {
      const setting = getSetting(providerType);
      const result = await llmProvidersApi.testConnection(
        providerType,
        setting?.defaultModel
      );
      setTestResults((prev) => ({ ...prev, [providerType]: result }));
    } catch (err) {
      console.error('Connection test failed:', err);
      setTestResults((prev) => ({
        ...prev,
        [providerType]: {
          providerType,
          success: false,
          message: '연결 테스트 실패',
          testedAt: new Date().toISOString(),
        },
      }));
    } finally {
      setTestingProvider(null);
    }
  };

  // Toggle API key visibility
  const toggleKeyVisibility = (provider: string) => {
    setShowApiKeys((prev) => ({ ...prev, [provider]: !prev[provider] }));
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center text-gray-400">
          <AlertTriangle className="w-12 h-12 mx-auto mb-4" />
          <p>관리자 권한이 필요합니다.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Bot className="w-7 h-7" />
            LLM Provider 설정
          </h1>
          <p className="text-gray-400 mt-1">
            전역 LLM Provider 설정을 관리합니다. 사용자별 설정이 없으면 이 설정이 적용됩니다.
          </p>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          새로고침
        </button>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400" />
          <p className="text-red-400">{error}</p>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-300"
          >
            닫기
          </button>
        </div>
      )}

      {/* Provider List */}
      <div className="grid gap-4">
        {providerTypes.map((type) => {
          const setting = getSetting(type.value);
          const testResult = testResults[type.value];
          const hasSetting = !!setting;

          return (
            <div
              key={type.value}
              className={clsx(
                'bg-gray-800 rounded-xl border p-6 transition-colors',
                hasSetting ? 'border-gray-700' : 'border-gray-800'
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div
                    className={clsx(
                      'w-12 h-12 rounded-lg flex items-center justify-center',
                      hasSetting && setting.enabled
                        ? 'bg-blue-500/20'
                        : 'bg-gray-700'
                    )}
                  >
                    <Bot
                      className={clsx(
                        'w-6 h-6',
                        hasSetting && setting.enabled
                          ? 'text-blue-400'
                          : 'text-gray-500'
                      )}
                    />
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-white">
                        {type.displayName}
                      </h3>
                      {hasSetting && (
                        <span
                          className={clsx(
                            'px-2 py-0.5 rounded text-xs',
                            setting.enabled
                              ? 'bg-green-500/10 text-green-400'
                              : 'bg-gray-700 text-gray-400'
                          )}
                        >
                          {setting.enabled ? '활성화' : '비활성화'}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-400">{type.description}</p>
                    {hasSetting && (
                      <p className="text-xs text-gray-500 mt-1">
                        모델: {setting.defaultModel}
                        {setting.hasApiKey && ' | API 키 설정됨'}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* Test Result Badge */}
                  {testResult && (
                    <span
                      className={clsx(
                        'flex items-center gap-1 px-2 py-1 rounded text-xs',
                        testResult.success
                          ? 'bg-green-500/10 text-green-400'
                          : 'bg-red-500/10 text-red-400'
                      )}
                    >
                      {testResult.success ? (
                        <CheckCircle className="w-3 h-3" />
                      ) : (
                        <XCircle className="w-3 h-3" />
                      )}
                      {testResult.success ? '연결됨' : '실패'}
                      {testResult.latencyMs && (
                        <span className="ml-1">({testResult.latencyMs}ms)</span>
                      )}
                    </span>
                  )}

                  {/* Actions */}
                  <button
                    onClick={() => handleTestConnection(type.value)}
                    disabled={!hasSetting || !setting.hasApiKey || testingProvider === type.value}
                    className="p-2 text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="연결 테스트"
                  >
                    {testingProvider === type.value ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Zap className="w-5 h-5" />
                    )}
                  </button>

                  <button
                    onClick={() => openEditDialog(type.value)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    {hasSetting ? '수정' : '설정'}
                  </button>

                  {hasSetting && (
                    <button
                      onClick={() => handleDelete(type.value)}
                      className="p-2 text-gray-400 hover:text-red-400 transition-colors"
                      title="삭제"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit Dialog */}
      {editDialogOpen && editingProvider && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-white mb-4">
              {editingProvider} 전역 설정
            </h2>
            <p className="text-sm text-gray-400 mb-6">
              모든 사용자에게 적용되는 기본 설정입니다.
            </p>

            <div className="space-y-4">
              {/* API Key */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  API 키
                </label>
                <div className="flex gap-2">
                  <input
                    type={showApiKeys['edit'] ? 'text' : 'password'}
                    value={editForm.apiKey || ''}
                    onChange={(e) =>
                      setEditForm((prev) => ({ ...prev, apiKey: e.target.value }))
                    }
                    placeholder="새 API 키 입력 (비우면 기존 값 유지)"
                    className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => toggleKeyVisibility('edit')}
                    className="p-2 text-gray-400 hover:text-white"
                  >
                    {showApiKeys['edit'] ? (
                      <EyeOff className="w-5 h-5" />
                    ) : (
                      <Eye className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Model */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  기본 모델
                </label>
                <select
                  value={editForm.defaultModel}
                  onChange={(e) =>
                    setEditForm((prev) => ({ ...prev, defaultModel: e.target.value }))
                  }
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
                >
                  {DEFAULT_MODELS[editingProvider]?.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </div>

              {/* Base URL (for Ollama/Custom) */}
              {(editingProvider === 'OLLAMA' || editingProvider === 'CUSTOM') && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Base URL
                  </label>
                  <input
                    type="text"
                    value={editForm.baseUrl || ''}
                    onChange={(e) =>
                      setEditForm((prev) => ({ ...prev, baseUrl: e.target.value }))
                    }
                    placeholder={
                      editingProvider === 'OLLAMA'
                        ? 'http://localhost:11434'
                        : 'https://api.example.com'
                    }
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}

              {/* Azure specific fields */}
              {editingProvider === 'AZURE_OPENAI' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Azure Endpoint
                    </label>
                    <input
                      type="text"
                      value={editForm.baseUrl || ''}
                      onChange={(e) =>
                        setEditForm((prev) => ({ ...prev, baseUrl: e.target.value }))
                      }
                      placeholder="https://your-resource.openai.azure.com"
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Deployment Name
                    </label>
                    <input
                      type="text"
                      value={editForm.azureDeploymentName || ''}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          azureDeploymentName: e.target.value,
                        }))
                      }
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      API Version
                    </label>
                    <input
                      type="text"
                      value={editForm.azureApiVersion || ''}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          azureApiVersion: e.target.value,
                        }))
                      }
                      placeholder="2024-02-01"
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </>
              )}

              {/* Advanced Settings */}
              <div className="border-t border-gray-700 pt-4 mt-4">
                <h4 className="text-sm font-medium text-gray-300 mb-3">고급 설정</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      우선순위
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={editForm.priority}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          priority: parseInt(e.target.value) || 100,
                        }))
                      }
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      최대 토큰
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={128000}
                      value={editForm.maxTokens}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          maxTokens: parseInt(e.target.value) || 4096,
                        }))
                      }
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Temperature
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      value={editForm.temperature}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          temperature: parseFloat(e.target.value) || 0.7,
                        }))
                      }
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      타임아웃 (ms)
                    </label>
                    <input
                      type="number"
                      min={1000}
                      max={300000}
                      value={editForm.timeoutMs}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          timeoutMs: parseInt(e.target.value) || 60000,
                        }))
                      }
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Enabled Toggle */}
              <div className="flex items-center justify-between pt-2">
                <span className="text-sm text-gray-300">활성화</span>
                <button
                  type="button"
                  onClick={() =>
                    setEditForm((prev) => ({ ...prev, enabled: !prev.enabled }))
                  }
                  className={clsx(
                    'relative w-11 h-6 rounded-full transition-colors',
                    editForm.enabled ? 'bg-blue-600' : 'bg-gray-600'
                  )}
                >
                  <span
                    className={clsx(
                      'absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform',
                      editForm.enabled && 'translate-x-5'
                    )}
                  />
                </button>
              </div>
            </div>

            {/* Dialog Actions */}
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-700">
              <button
                onClick={() => setEditDialogOpen(false)}
                className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg transition-colors"
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
