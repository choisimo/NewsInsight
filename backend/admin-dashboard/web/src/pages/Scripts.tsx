import { useEffect, useState, useRef } from 'react';
import {
  Terminal,
  Play,
  AlertTriangle,
  Clock,
  CheckCircle,
  XCircle,
  ChevronDown,
  X,
} from 'lucide-react';
import { scriptsApi, environmentsApi } from '../api/endpoints';
import type { Script, Environment, TaskExecution } from '../types';
import { useAuth } from '../contexts/AuthContext';
import clsx from 'clsx';

export default function Scripts() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selectedScript, setSelectedScript] = useState<Script | null>(null);
  const [selectedEnvId, setSelectedEnvId] = useState<string>('');
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [isExecuting, setIsExecuting] = useState(false);
  const [output, setOutput] = useState<string>('');
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const outputRef = useRef<HTMLPreElement>(null);
  const { user } = useAuth();

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const loadData = async () => {
    try {
      const [scriptsData, envsData, executionsData] = await Promise.all([
        scriptsApi.list(),
        environmentsApi.list(true),
        scriptsApi.listExecutions(),
      ]);
      setScripts(scriptsData);
      setEnvironments(envsData);
      setExecutions(executionsData);
      
      if (envsData.length > 0) {
        setSelectedEnvId(envsData[0].id);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'critical':
        return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'high':
        return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
      case 'medium':
        return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
      default:
        return 'bg-green-500/10 text-green-400 border-green-500/20';
    }
  };

  const canExecute = (script: Script) => {
    const roleLevel = { viewer: 0, operator: 1, admin: 2 };
    const userLevel = roleLevel[user?.role || 'viewer'];
    const requiredLevel = roleLevel[script.required_role];
    return userLevel >= requiredLevel;
  };

  const handleExecute = async () => {
    if (!selectedScript || !selectedEnvId) return;

    setIsExecuting(true);
    setOutput('');

    try {
      await scriptsApi.executeStream(
        selectedScript.id,
        selectedEnvId,
        parameters,
        (chunk) => {
          setOutput((prev) => prev + chunk);
        }
      );
      
      // Reload executions
      const executionsData = await scriptsApi.listExecutions();
      setExecutions(executionsData);
    } catch (error) {
      setOutput((prev) => prev + `\nError: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsExecuting(false);
    }
  };

  const selectScript = (script: Script) => {
    setSelectedScript(script);
    setOutput('');
    
    // Initialize parameters with defaults
    const defaultParams: Record<string, string> = {};
    script.parameters.forEach((param) => {
      if (param.default !== undefined) {
        defaultParams[param.name] = String(param.default);
      }
    });
    setParameters(defaultParams);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-400" />;
      case 'running':
        return <Clock className="w-4 h-4 text-blue-400 animate-spin" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">스크립트 관리</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Script List */}
        <div className="lg:col-span-1 space-y-2">
          {scripts.map((script) => (
            <button
              key={script.id}
              onClick={() => selectScript(script)}
              className={clsx(
                'w-full p-4 rounded-lg border transition-colors text-left',
                selectedScript?.id === script.id
                  ? 'bg-blue-600/20 border-blue-500'
                  : 'bg-gray-800 border-gray-700 hover:border-gray-600'
              )}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-gray-400" />
                  <span className="font-medium text-white">{script.name}</span>
                </div>
                <span className={clsx(
                  'px-2 py-0.5 rounded text-xs border capitalize',
                  getRiskColor(script.risk_level)
                )}>
                  {script.risk_level}
                </span>
              </div>
              <p className="text-sm text-gray-400 line-clamp-2">
                {script.description}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {script.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-300"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>

        {/* Script Details & Execution */}
        <div className="lg:col-span-2 space-y-6">
          {selectedScript ? (
            <>
              {/* Script Info */}
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-white">
                      {selectedScript.name}
                    </h2>
                    <p className="text-gray-400 text-sm mt-1">
                      {selectedScript.description}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedScript(null)}
                    className="text-gray-400 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
                  <div>
                    <span className="text-gray-500">필요 권한:</span>
                    <span className="ml-2 text-white capitalize">
                      {selectedScript.required_role}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">예상 시간:</span>
                    <span className="ml-2 text-white">
                      {selectedScript.estimated_duration
                        ? `${Math.ceil(selectedScript.estimated_duration / 60)}분`
                        : '-'}
                    </span>
                  </div>
                </div>

                {/* Environment Selection */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    실행 환경
                  </label>
                  <div className="relative">
                    <select
                      value={selectedEnvId}
                      onChange={(e) => setSelectedEnvId(e.target.value)}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {environments.map((env) => (
                        <option key={env.id} value={env.id}>
                          {env.name} ({env.env_type})
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  </div>
                </div>

                {/* Parameters */}
                {selectedScript.parameters.length > 0 && (
                  <div className="mb-4 space-y-3">
                    <label className="block text-sm font-medium text-gray-300">
                      파라미터
                    </label>
                    {selectedScript.parameters.map((param) => (
                      <div key={param.name}>
                        <label className="block text-xs text-gray-400 mb-1">
                          {param.name}
                          {param.required && <span className="text-red-400 ml-1">*</span>}
                          {param.description && (
                            <span className="ml-2 text-gray-500">- {param.description}</span>
                          )}
                        </label>
                        {param.param_type === 'boolean' ? (
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={parameters[param.name] === 'true'}
                              onChange={(e) =>
                                setParameters({
                                  ...parameters,
                                  [param.name]: e.target.checked ? 'true' : 'false',
                                })
                              }
                              className="w-4 h-4 rounded bg-gray-700 border-gray-600"
                            />
                            <span className="text-sm text-gray-300">활성화</span>
                          </label>
                        ) : (
                          <input
                            type={param.param_type === 'number' ? 'number' : 'text'}
                            value={parameters[param.name] || ''}
                            onChange={(e) =>
                              setParameters({
                                ...parameters,
                                [param.name]: e.target.value,
                              })
                            }
                            placeholder={String(param.default || '')}
                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Execute Button */}
                <button
                  onClick={handleExecute}
                  disabled={!canExecute(selectedScript) || isExecuting || !selectedEnvId}
                  className={clsx(
                    'flex items-center justify-center gap-2 w-full py-3 rounded-lg font-medium transition-colors',
                    canExecute(selectedScript)
                      ? 'bg-blue-600 hover:bg-blue-700 text-white'
                      : 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  )}
                >
                  {isExecuting ? (
                    <>
                      <Clock className="w-4 h-4 animate-spin" />
                      실행 중...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      실행
                    </>
                  )}
                </button>

                {!canExecute(selectedScript) && (
                  <p className="mt-2 text-sm text-yellow-400 text-center">
                    이 스크립트를 실행하려면 {selectedScript.required_role} 권한이 필요합니다
                  </p>
                )}
              </div>

              {/* Output */}
              {output && (
                <div className="bg-gray-800 rounded-xl border border-gray-700">
                  <div className="flex items-center justify-between p-4 border-b border-gray-700">
                    <h3 className="font-semibold text-white">실행 출력</h3>
                    <button
                      onClick={() => setOutput('')}
                      className="text-gray-400 hover:text-white"
                    >
                      지우기
                    </button>
                  </div>
                  <pre
                    ref={outputRef}
                    className="p-4 text-sm text-gray-300 overflow-auto max-h-96 font-mono"
                  >
                    {output}
                  </pre>
                </div>
              )}
            </>
          ) : (
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 text-center text-gray-500">
              스크립트를 선택해주세요
            </div>
          )}

          {/* Recent Executions */}
          <div className="bg-gray-800 rounded-xl border border-gray-700">
            <div className="p-4 border-b border-gray-700">
              <h3 className="font-semibold text-white">최근 실행 이력</h3>
            </div>
            <div className="divide-y divide-gray-700 max-h-64 overflow-y-auto">
              {executions.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  실행 이력이 없습니다
                </div>
              ) : (
                executions.slice(0, 10).map((execution) => (
                  <div
                    key={execution.id}
                    className="flex items-center justify-between p-4"
                  >
                    <div className="flex items-center gap-3">
                      {getStatusIcon(execution.status)}
                      <div>
                        <p className="text-sm font-medium text-white">
                          {execution.script_name}
                        </p>
                        <p className="text-xs text-gray-400">
                          {execution.environment_name} • {execution.executed_by}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">
                        {new Date(execution.started_at).toLocaleString('ko-KR')}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
