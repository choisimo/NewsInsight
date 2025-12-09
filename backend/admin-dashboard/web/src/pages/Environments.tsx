import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Server,
  Play,
  Square,
  RotateCcw,
  Trash2,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Terminal,
} from 'lucide-react';
import { environmentsApi } from '../api/endpoints';
import type { Environment, EnvironmentStatus, ContainerInfo } from '../types';
import { useAuth } from '../contexts/AuthContext';
import clsx from 'clsx';

export default function Environments() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selectedEnv, setSelectedEnv] = useState<Environment | null>(null);
  const [status, setStatus] = useState<EnvironmentStatus | null>(null);
  const [logs, setLogs] = useState<string>('');
  const [selectedService, setSelectedService] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [actionOutput, setActionOutput] = useState<string>('');
  const { user } = useAuth();

  const isOperator = user?.role === 'operator' || user?.role === 'admin';
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    loadEnvironments();
  }, []);

  useEffect(() => {
    const selectedId = searchParams.get('selected');
    if (selectedId && environments.length > 0) {
      const env = environments.find((e) => e.id === selectedId);
      if (env) {
        setSelectedEnv(env);
        loadStatus(env.id);
      }
    }
  }, [searchParams, environments]);

  const loadEnvironments = async () => {
    try {
      const envs = await environmentsApi.list();
      setEnvironments(envs);
      
      if (envs.length > 0 && !searchParams.get('selected')) {
        setSelectedEnv(envs[0]);
        loadStatus(envs[0].id);
      }
    } catch (error) {
      console.error('Failed to load environments:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadStatus = async (envId: string) => {
    try {
      const statusData = await environmentsApi.getStatus(envId);
      setStatus(statusData);
    } catch (error) {
      console.error('Failed to load status:', error);
      setStatus(null);
    }
  };

  const selectEnvironment = (env: Environment) => {
    setSelectedEnv(env);
    setSearchParams({ selected: env.id });
    setLogs('');
    setActionOutput('');
    loadStatus(env.id);
  };

  const handleAction = async (
    action: 'up' | 'down' | 'restart' | 'cleanup',
    service?: string
  ) => {
    if (!selectedEnv) return;

    // Confirm dangerous actions
    if (action === 'cleanup') {
      if (!confirm('⚠️ 전체 정리를 진행하면 데이터베이스 볼륨도 삭제됩니다. 계속하시겠습니까?')) {
        return;
      }
    }

    setIsActionLoading(true);
    setActionOutput('');

    try {
      let result: { output?: string; message?: string; success?: boolean };
      switch (action) {
        case 'up':
          result = await environmentsApi.up(selectedEnv.id, true) as { output?: string; message?: string };
          break;
        case 'down':
          result = await environmentsApi.down(selectedEnv.id, false) as { output?: string; message?: string };
          break;
        case 'restart':
          result = await environmentsApi.restart(selectedEnv.id, service) as { output?: string; message?: string };
          break;
        case 'cleanup':
          result = await environmentsApi.down(selectedEnv.id, true) as { output?: string; message?: string };
          break;
        default:
          result = { message: 'Unknown action' };
      }
      setActionOutput(result.output || result.message || 'Success');
      await loadStatus(selectedEnv.id);
    } catch (error) {
      setActionOutput(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const loadServiceLogs = async (service: string) => {
    if (!selectedEnv) return;
    setSelectedService(service);
    
    try {
      const result = await environmentsApi.logs(selectedEnv.id, service, 200);
      setLogs(result.logs);
    } catch (error) {
      setLogs(`Error loading logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const getStatusIcon = (container: ContainerInfo) => {
    if (container.status === 'up') {
      return <CheckCircle className="w-4 h-4 text-green-400" />;
    } else if (container.status === 'down') {
      return <XCircle className="w-4 h-4 text-red-400" />;
    }
    return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
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
      <h1 className="text-2xl font-bold text-white">환경 관리</h1>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Environment List */}
        <div className="lg:col-span-1 space-y-2">
          {environments.map((env) => (
            <button
              key={env.id}
              onClick={() => selectEnvironment(env)}
              className={clsx(
                'w-full flex items-center gap-3 p-4 rounded-lg border transition-colors text-left',
                selectedEnv?.id === env.id
                  ? 'bg-blue-600/20 border-blue-500 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
              )}
            >
              <Server className="w-5 h-5" />
              <div>
                <p className="font-medium capitalize">{env.name}</p>
                <p className="text-xs text-gray-400">{env.env_type}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Environment Details */}
        <div className="lg:col-span-3 space-y-6">
          {selectedEnv ? (
            <>
              {/* Actions */}
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
                <h2 className="text-lg font-semibold text-white mb-4">
                  {selectedEnv.name} 환경
                </h2>
                <p className="text-gray-400 text-sm mb-4">
                  {selectedEnv.description || selectedEnv.compose_file}
                </p>

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => handleAction('up')}
                    disabled={!isOperator || isActionLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded-lg transition-colors"
                  >
                    <Play className="w-4 h-4" />
                    시작
                  </button>
                  <button
                    onClick={() => handleAction('down')}
                    disabled={!isOperator || isActionLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 text-white rounded-lg transition-colors"
                  >
                    <Square className="w-4 h-4" />
                    중지
                  </button>
                  <button
                    onClick={() => handleAction('restart')}
                    disabled={!isOperator || isActionLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-lg transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                    재시작
                  </button>
                  <button
                    onClick={() => handleAction('cleanup')}
                    disabled={!isAdmin || isActionLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    전체 정리
                  </button>
                  <button
                    onClick={() => loadStatus(selectedEnv.id)}
                    disabled={isActionLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-700 text-white rounded-lg transition-colors"
                  >
                    <RefreshCw className={clsx('w-4 h-4', isActionLoading && 'animate-spin')} />
                    새로고침
                  </button>
                </div>

                {actionOutput && (
                  <pre className="mt-4 p-4 bg-gray-900 rounded-lg text-sm text-gray-300 overflow-x-auto max-h-48">
                    {actionOutput}
                  </pre>
                )}
              </div>

              {/* Container Status */}
              <div className="bg-gray-800 rounded-xl border border-gray-700">
                <div className="p-4 border-b border-gray-700">
                  <h3 className="font-semibold text-white">
                    컨테이너 상태
                    {status && (
                      <span className="ml-2 text-sm font-normal text-gray-400">
                        ({status.running_containers}/{status.total_containers} 실행 중)
                      </span>
                    )}
                  </h3>
                </div>
                <div className="divide-y divide-gray-700">
                  {status?.containers && status.containers.length > 0 ? (
                    status.containers.map((container) => (
                      <div
                        key={container.name}
                        className="flex items-center justify-between p-4 hover:bg-gray-700/50"
                      >
                        <div className="flex items-center gap-3">
                          {getStatusIcon(container)}
                          <div>
                            <p className="text-sm font-medium text-white">
                              {container.name}
                            </p>
                            <p className="text-xs text-gray-400">{container.image}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={clsx(
                            'px-2 py-1 rounded text-xs capitalize',
                            container.status === 'up'
                              ? 'bg-green-500/10 text-green-400'
                              : 'bg-red-500/10 text-red-400'
                          )}>
                            {container.status}
                          </span>
                          <button
                            onClick={() => loadServiceLogs(container.name.replace('newsinsight-', ''))}
                            className="p-1 text-gray-400 hover:text-white"
                            title="로그 보기"
                          >
                            <Terminal className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-8 text-center text-gray-500">
                      컨테이너 정보가 없습니다
                    </div>
                  )}
                </div>
              </div>

              {/* Logs */}
              {logs && (
                <div className="bg-gray-800 rounded-xl border border-gray-700">
                  <div className="flex items-center justify-between p-4 border-b border-gray-700">
                    <h3 className="font-semibold text-white">
                      로그: {selectedService}
                    </h3>
                    <button
                      onClick={() => setLogs('')}
                      className="text-gray-400 hover:text-white"
                    >
                      닫기
                    </button>
                  </div>
                  <pre className="p-4 text-sm text-gray-300 overflow-x-auto max-h-96 font-mono">
                    {logs}
                  </pre>
                </div>
              )}
            </>
          ) : (
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 text-center text-gray-500">
              환경을 선택해주세요
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
