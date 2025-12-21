import { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  Server,
  Database,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  Wifi,
  WifiOff,
  Clock,
  Zap,
} from 'lucide-react';
import { healthMonitorApi } from '../api/endpoints';
import type {
  ServiceHealth,
  InfrastructureHealth,
  OverallSystemHealth,
  ServiceHealthStatus,
} from '../types';
import clsx from 'clsx';

const statusConfig: Record<ServiceHealthStatus, { color: string; icon: typeof CheckCircle; label: string }> = {
  healthy: { color: 'text-green-400', icon: CheckCircle, label: 'Healthy' },
  unhealthy: { color: 'text-red-400', icon: XCircle, label: 'Unhealthy' },
  degraded: { color: 'text-yellow-400', icon: AlertCircle, label: 'Degraded' },
  unreachable: { color: 'text-gray-400', icon: WifiOff, label: 'Unreachable' },
  unknown: { color: 'text-gray-500', icon: AlertCircle, label: 'Unknown' },
};

function StatusBadge({ status }: { status: ServiceHealthStatus }) {
  const config = statusConfig[status] || statusConfig.unknown;
  const Icon = config.icon;
  
  return (
    <span className={clsx('flex items-center gap-1.5 text-sm font-medium', config.color)}>
      <Icon className="w-4 h-4" />
      {config.label}
    </span>
  );
}

function ServiceCard({ service, onRefresh }: { service: ServiceHealth; onRefresh: () => void }) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await healthMonitorApi.checkService(service.service_id);
      onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };
  
  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-blue-400" />
          <h3 className="font-medium text-white">{service.name}</h3>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="p-1 text-gray-400 hover:text-white transition-colors"
        >
          <RefreshCw className={clsx('w-4 h-4', isRefreshing && 'animate-spin')} />
        </button>
      </div>
      
      <StatusBadge status={service.status} />
      
      <div className="mt-3 space-y-1 text-sm text-gray-400">
        {service.message && <p>{service.message}</p>}
        {service.response_time_ms !== undefined && service.response_time_ms !== null && (
          <p className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {service.response_time_ms.toFixed(0)}ms
          </p>
        )}
        {service.url && (
          <p className="truncate text-xs text-gray-500" title={service.url}>
            {service.url}
          </p>
        )}
      </div>
    </div>
  );
}

function InfraCard({ infra }: { infra: InfrastructureHealth }) {
  const iconMap: Record<string, typeof Database> = {
    postgres: Database,
    mongo: Database,
    redis: Zap,
    consul: Server,
    redpanda: Activity,
  };
  
  const Icon = iconMap[infra.service_id] || Database;
  
  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-5 h-5 text-purple-400" />
        <h3 className="font-medium text-white">{infra.name}</h3>
      </div>
      
      <StatusBadge status={infra.status} />
      
      <div className="mt-3 space-y-1 text-sm text-gray-400">
        {infra.message && <p>{infra.message}</p>}
        {infra.port && <p>Port: {infra.port}</p>}
      </div>
    </div>
  );
}

function OverallHealthCard({ health }: { health: OverallSystemHealth }) {
  const statusColor = {
    healthy: 'bg-green-500/20 border-green-500',
    degraded: 'bg-yellow-500/20 border-yellow-500',
    unhealthy: 'bg-red-500/20 border-red-500',
    unreachable: 'bg-gray-500/20 border-gray-500',
    unknown: 'bg-gray-500/20 border-gray-500',
  }[health.status];
  
  return (
    <div className={clsx('rounded-xl p-6 border-2', statusColor)}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Activity className="w-8 h-8 text-white" />
          <div>
            <h2 className="text-xl font-bold text-white">System Health</h2>
            <p className="text-gray-400 text-sm">
              Last checked: {new Date(health.checked_at).toLocaleTimeString()}
            </p>
          </div>
        </div>
        <StatusBadge status={health.status} />
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gray-800/50 rounded-lg p-3">
          <p className="text-gray-400 text-sm">Services</p>
          <p className="text-2xl font-bold text-white">
            {health.healthy_services}/{health.total_services}
          </p>
          <p className="text-green-400 text-xs">healthy</p>
        </div>
        
        <div className="bg-gray-800/50 rounded-lg p-3">
          <p className="text-gray-400 text-sm">Infrastructure</p>
          <p className="text-2xl font-bold text-white">
            {health.healthy_infrastructure}/{health.total_infrastructure}
          </p>
          <p className="text-purple-400 text-xs">healthy</p>
        </div>
        
        <div className="bg-gray-800/50 rounded-lg p-3">
          <p className="text-gray-400 text-sm">Unhealthy</p>
          <p className="text-2xl font-bold text-red-400">
            {health.unhealthy_services}
          </p>
          <p className="text-gray-500 text-xs">services</p>
        </div>
        
        <div className="bg-gray-800/50 rounded-lg p-3">
          <p className="text-gray-400 text-sm">Avg Response</p>
          <p className="text-2xl font-bold text-white">
            {health.average_response_time_ms 
              ? `${health.average_response_time_ms.toFixed(0)}ms` 
              : 'N/A'}
          </p>
          <p className="text-blue-400 text-xs">latency</p>
        </div>
      </div>
    </div>
  );
}

export default function HealthMonitor() {
  const [health, setHealth] = useState<OverallSystemHealth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchHealth = useCallback(async (showLoading = false) => {
    if (showLoading) setIsLoading(true);
    setIsRefreshing(true);
    try {
      const data = await healthMonitorApi.getOverallHealth();
      setHealth(data);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to fetch health:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth(true);
  }, [fetchHealth]);

  useEffect(() => {
    if (!autoRefresh) return;
    
    const interval = setInterval(() => {
      fetchHealth(false);
    }, 10000); // 10 seconds
    
    return () => clearInterval(interval);
  }, [autoRefresh, fetchHealth]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Health Monitor</h1>
          <p className="text-gray-400 mt-1">
            Real-time service health and infrastructure monitoring
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-400">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
            />
            Auto-refresh (10s)
          </label>
          <button
            onClick={() => fetchHealth(false)}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={clsx('w-4 h-4', isRefreshing && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {/* Overall Health */}
      {health && <OverallHealthCard health={health} />}

      {/* Services */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Server className="w-5 h-5 text-blue-400" />
          Services ({health?.services.length || 0})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {health?.services.map((service) => (
            <ServiceCard
              key={service.service_id}
              service={service}
              onRefresh={() => fetchHealth(false)}
            />
          ))}
        </div>
      </div>

      {/* Infrastructure */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Database className="w-5 h-5 text-purple-400" />
          Infrastructure ({health?.infrastructure.length || 0})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {health?.infrastructure.map((infra) => (
            <InfraCard key={infra.service_id} infra={infra} />
          ))}
        </div>
      </div>

      {/* Connection Status */}
      <div className="flex items-center justify-end gap-2 text-sm text-gray-500">
        {autoRefresh ? (
          <Wifi className="w-4 h-4 text-green-400" />
        ) : (
          <WifiOff className="w-4 h-4" />
        )}
        {lastUpdated && (
          <span>Last updated: {lastUpdated.toLocaleTimeString()}</span>
        )}
      </div>
    </div>
  );
}
