import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Server,
  Activity,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { environmentsApi, scriptsApi, healthApi } from '../api/endpoints';
import type { Environment, EnvironmentStatus, TaskExecution, HealthCheck } from '../types';
import clsx from 'clsx';

export default function Dashboard() {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [statuses, setStatuses] = useState<Record<string, EnvironmentStatus>>({});
  const [recentExecutions, setRecentExecutions] = useState<TaskExecution[]>([]);
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [envs, executions, healthData] = await Promise.all([
        environmentsApi.list(true),
        scriptsApi.listExecutions(undefined, undefined, 10),
        healthApi.check(),
      ]);

      setEnvironments(envs);
      setRecentExecutions(executions);
      setHealth(healthData);

      // Load status for each environment
      const statusPromises = envs.map(async (env) => {
        try {
          const status = await environmentsApi.getStatus(env.id);
          return { id: env.id, status };
        } catch {
          return { id: env.id, status: null };
        }
      });

      const statusResults = await Promise.all(statusPromises);
      const statusMap: Record<string, EnvironmentStatus> = {};
      statusResults.forEach(({ id, status }) => {
        if (status) statusMap[id] = status;
      });
      setStatuses(statusMap);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'text-green-400';
      case 'failed':
        return 'text-red-400';
      case 'running':
        return 'text-blue-400';
      case 'cancelled':
        return 'text-gray-400';
      default:
        return 'text-yellow-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4" />;
      case 'failed':
        return <XCircle className="w-4 h-4" />;
      case 'running':
        return <Clock className="w-4 h-4 animate-spin" />;
      default:
        return <AlertTriangle className="w-4 h-4" />;
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">대시보드</h1>
        {health && (
          <div className="flex items-center gap-2 text-sm">
            <span className={clsx(
              'flex items-center gap-1',
              health.status === 'healthy' ? 'text-green-400' : 'text-red-400'
            )}>
              <Activity className="w-4 h-4" />
              {health.status}
            </span>
            <span className="text-gray-500">v{health.version}</span>
          </div>
        )}
      </div>

      {/* Environment Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {environments.map((env) => {
          const status = statuses[env.id];
          const runningCount = status?.running_containers || 0;
          const totalCount = status?.total_containers || 0;
          const isHealthy = runningCount === totalCount && totalCount > 0;

          return (
            <Link
              key={env.id}
              to={`/environments?selected=${env.id}`}
              className="bg-gray-800 rounded-xl p-6 border border-gray-700 hover:border-blue-500 transition-colors"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={clsx(
                    'p-2 rounded-lg',
                    isHealthy ? 'bg-green-500/10' : 'bg-yellow-500/10'
                  )}>
                    <Server className={clsx(
                      'w-5 h-5',
                      isHealthy ? 'text-green-400' : 'text-yellow-400'
                    )} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white capitalize">{env.name}</h3>
                    <p className="text-sm text-gray-400">{env.env_type}</p>
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 text-gray-500" />
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">컨테이너</span>
                <span className={clsx(
                  'font-medium',
                  isHealthy ? 'text-green-400' : 'text-yellow-400'
                )}>
                  {runningCount} / {totalCount}
                </span>
              </div>

              {status?.containers && status.containers.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {status.containers.slice(0, 5).map((container) => (
                    <span
                      key={container.name}
                      className={clsx(
                        'px-2 py-0.5 rounded text-xs',
                        container.status === 'up'
                          ? 'bg-green-500/10 text-green-400'
                          : 'bg-red-500/10 text-red-400'
                      )}
                    >
                      {container.name.replace('newsinsight-', '')}
                    </span>
                  ))}
                  {status.containers.length > 5 && (
                    <span className="px-2 py-0.5 rounded text-xs bg-gray-700 text-gray-400">
                      +{status.containers.length - 5}
                    </span>
                  )}
                </div>
              )}
            </Link>
          );
        })}
      </div>

      {/* Recent Executions */}
      <div className="bg-gray-800 rounded-xl border border-gray-700">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="font-semibold text-white">최근 실행 이력</h2>
          <Link
            to="/scripts"
            className="text-sm text-blue-400 hover:text-blue-300"
          >
            전체 보기
          </Link>
        </div>
        <div className="divide-y divide-gray-700">
          {recentExecutions.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              실행 이력이 없습니다
            </div>
          ) : (
            recentExecutions.map((execution) => (
              <div
                key={execution.id}
                className="flex items-center justify-between p-4 hover:bg-gray-700/50"
              >
                <div className="flex items-center gap-3">
                  <span className={getStatusColor(execution.status)}>
                    {getStatusIcon(execution.status)}
                  </span>
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
                  <p className={clsx('text-sm capitalize', getStatusColor(execution.status))}>
                    {execution.status}
                  </p>
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
  );
}
