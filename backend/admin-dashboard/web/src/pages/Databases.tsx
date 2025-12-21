import { useState, useEffect, useCallback } from 'react';
import {
  Database,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  HardDrive,
  Table,
  FileStack,
  Users,
  Clock,
  Zap,
  BarChart3,
} from 'lucide-react';
import { databaseApi } from '../api/endpoints';
import type {
  DatabaseInfo,
  PostgresDatabaseStats,
  MongoDatabaseStats,
  RedisStats,
  ServiceHealthStatus,
  DatabaseType,
} from '../types';
import clsx from 'clsx';

const statusConfig: Record<ServiceHealthStatus, { color: string; bgColor: string; icon: typeof CheckCircle; label: string }> = {
  healthy: { color: 'text-green-400', bgColor: 'bg-green-500/20 border-green-500', icon: CheckCircle, label: 'Healthy' },
  unhealthy: { color: 'text-red-400', bgColor: 'bg-red-500/20 border-red-500', icon: XCircle, label: 'Unhealthy' },
  degraded: { color: 'text-yellow-400', bgColor: 'bg-yellow-500/20 border-yellow-500', icon: AlertCircle, label: 'Degraded' },
  unreachable: { color: 'text-gray-400', bgColor: 'bg-gray-500/20 border-gray-500', icon: XCircle, label: 'Unreachable' },
  unknown: { color: 'text-gray-500', bgColor: 'bg-gray-500/20 border-gray-500', icon: AlertCircle, label: 'Unknown' },
};

const dbTypeConfig: Record<DatabaseType, { icon: typeof Database; color: string; label: string }> = {
  postgresql: { icon: Database, color: 'text-blue-400', label: 'PostgreSQL' },
  mongodb: { icon: FileStack, color: 'text-green-400', label: 'MongoDB' },
  redis: { icon: Zap, color: 'text-red-400', label: 'Redis' },
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

function DatabaseCard({ db, onRefresh }: { db: DatabaseInfo; onRefresh: () => void }) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const config = dbTypeConfig[db.db_type] || dbTypeConfig.postgresql;
  const statusCfg = statusConfig[db.status] || statusConfig.unknown;
  const Icon = config.icon;
  
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const dbType = db.db_type === 'postgresql' ? 'postgres' : db.db_type === 'mongodb' ? 'mongo' : 'redis';
      await databaseApi.checkDatabase(dbType);
      onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };
  
  return (
    <div className={clsx('rounded-xl p-5 border-2', statusCfg.bgColor)}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={clsx('p-2 rounded-lg bg-gray-800', config.color)}>
            <Icon className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-semibold text-white text-lg">{config.label}</h3>
            <p className="text-gray-400 text-sm">{db.name}</p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
        >
          <RefreshCw className={clsx('w-4 h-4', isRefreshing && 'animate-spin')} />
        </button>
      </div>
      
      <div className="mb-4">
        <StatusBadge status={db.status} />
      </div>
      
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between text-gray-400">
          <span>Host</span>
          <span className="text-white">{db.host}:{db.port}</span>
        </div>
        {db.version && (
          <div className="flex items-center justify-between text-gray-400">
            <span>Version</span>
            <span className="text-white">{db.version}</span>
          </div>
        )}
        {db.size_human && (
          <div className="flex items-center justify-between text-gray-400">
            <span>Size</span>
            <span className="text-white">{db.size_human}</span>
          </div>
        )}
        {db.connection_count !== undefined && (
          <div className="flex items-center justify-between text-gray-400">
            <span>Connections</span>
            <span className="text-white">{db.connection_count}/{db.max_connections || '?'}</span>
          </div>
        )}
      </div>
      
      <div className="mt-4 pt-3 border-t border-gray-700">
        <p className="text-xs text-gray-500">
          Checked: {new Date(db.checked_at).toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
}

function PostgresStatsCard({ stats }: { stats: PostgresDatabaseStats | null }) {
  if (!stats) return null;
  
  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
      <div className="flex items-center gap-2 mb-4">
        <Database className="w-5 h-5 text-blue-400" />
        <h3 className="font-semibold text-white">PostgreSQL Details</h3>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-700/50 rounded-lg p-3">
          <p className="text-gray-400 text-xs">Database</p>
          <p className="text-white font-medium">{stats.database_name}</p>
        </div>
        <div className="bg-gray-700/50 rounded-lg p-3">
          <p className="text-gray-400 text-xs">Size</p>
          <p className="text-white font-medium">{stats.size_human}</p>
        </div>
        <div className="bg-gray-700/50 rounded-lg p-3">
          <p className="text-gray-400 text-xs">Tables</p>
          <p className="text-white font-medium">{stats.total_tables}</p>
        </div>
        <div className="bg-gray-700/50 rounded-lg p-3">
          <p className="text-gray-400 text-xs">Total Rows</p>
          <p className="text-white font-medium">{stats.total_rows.toLocaleString()}</p>
        </div>
      </div>
      
      {stats.tables.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
            <Table className="w-4 h-4" />
            Tables
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="pb-2">Table</th>
                  <th className="pb-2 text-right">Rows</th>
                  <th className="pb-2 text-right">Size</th>
                </tr>
              </thead>
              <tbody className="text-gray-300">
                {stats.tables.map((table) => (
                  <tr key={`${table.schema_name}.${table.table_name}`} className="border-b border-gray-700/50">
                    <td className="py-2">
                      <span className="text-gray-500">{table.schema_name}.</span>
                      {table.table_name}
                    </td>
                    <td className="py-2 text-right">{table.row_count.toLocaleString()}</td>
                    <td className="py-2 text-right">{table.size_human}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function MongoStatsCard({ stats }: { stats: MongoDatabaseStats | null }) {
  if (!stats) return null;
  
  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
      <div className="flex items-center gap-2 mb-4">
        <FileStack className="w-5 h-5 text-green-400" />
        <h3 className="font-semibold text-white">MongoDB Details</h3>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-700/50 rounded-lg p-3">
          <p className="text-gray-400 text-xs">Database</p>
          <p className="text-white font-medium">{stats.database_name}</p>
        </div>
        <div className="bg-gray-700/50 rounded-lg p-3">
          <p className="text-gray-400 text-xs">Size</p>
          <p className="text-white font-medium">{stats.size_human}</p>
        </div>
        <div className="bg-gray-700/50 rounded-lg p-3">
          <p className="text-gray-400 text-xs">Collections</p>
          <p className="text-white font-medium">{stats.total_collections}</p>
        </div>
        <div className="bg-gray-700/50 rounded-lg p-3">
          <p className="text-gray-400 text-xs">Documents</p>
          <p className="text-white font-medium">{stats.total_documents.toLocaleString()}</p>
        </div>
      </div>
      
      {stats.collections.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
            <FileStack className="w-4 h-4" />
            Collections
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="pb-2">Collection</th>
                  <th className="pb-2 text-right">Documents</th>
                  <th className="pb-2 text-right">Size</th>
                  <th className="pb-2 text-right">Indexes</th>
                </tr>
              </thead>
              <tbody className="text-gray-300">
                {stats.collections.map((col) => (
                  <tr key={col.collection_name} className="border-b border-gray-700/50">
                    <td className="py-2">{col.collection_name}</td>
                    <td className="py-2 text-right">{col.document_count.toLocaleString()}</td>
                    <td className="py-2 text-right">{col.size_human}</td>
                    <td className="py-2 text-right">{col.index_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function RedisStatsCard({ stats }: { stats: RedisStats | null }) {
  if (!stats) return null;
  
  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };
  
  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="w-5 h-5 text-red-400" />
        <h3 className="font-semibold text-white">Redis Details</h3>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-700/50 rounded-lg p-3">
          <p className="text-gray-400 text-xs">Memory Used</p>
          <p className="text-white font-medium">{stats.used_memory_human}</p>
        </div>
        <div className="bg-gray-700/50 rounded-lg p-3">
          <p className="text-gray-400 text-xs">Total Keys</p>
          <p className="text-white font-medium">{stats.total_keys.toLocaleString()}</p>
        </div>
        <div className="bg-gray-700/50 rounded-lg p-3">
          <p className="text-gray-400 text-xs">Clients</p>
          <p className="text-white font-medium">{stats.connected_clients}</p>
        </div>
        <div className="bg-gray-700/50 rounded-lg p-3">
          <p className="text-gray-400 text-xs">Uptime</p>
          <p className="text-white font-medium">{formatUptime(stats.uptime_seconds)}</p>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Hit Rate */}
        <div className="bg-gray-700/30 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-400 text-sm">Cache Hit Rate</span>
            <span className={clsx(
              'font-medium',
              stats.hit_rate >= 90 ? 'text-green-400' :
              stats.hit_rate >= 70 ? 'text-yellow-400' : 'text-red-400'
            )}>
              {stats.hit_rate.toFixed(1)}%
            </span>
          </div>
          <div className="w-full bg-gray-600 rounded-full h-2">
            <div
              className={clsx(
                'h-2 rounded-full',
                stats.hit_rate >= 90 ? 'bg-green-400' :
                stats.hit_rate >= 70 ? 'bg-yellow-400' : 'bg-red-400'
              )}
              style={{ width: `${Math.min(100, stats.hit_rate)}%` }}
            />
          </div>
          <div className="flex justify-between mt-2 text-xs text-gray-500">
            <span>Hits: {stats.keyspace_hits.toLocaleString()}</span>
            <span>Misses: {stats.keyspace_misses.toLocaleString()}</span>
          </div>
        </div>
        
        {/* Key Stats */}
        <div className="bg-gray-700/30 rounded-lg p-4">
          <h4 className="text-gray-400 text-sm mb-3">Key Statistics</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Active Keys</span>
              <span className="text-white">{stats.total_keys.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Expired Keys</span>
              <span className="text-white">{stats.expired_keys.toLocaleString()}</span>
            </div>
            {stats.max_memory_bytes && (
              <div className="flex justify-between">
                <span className="text-gray-400">Memory Limit</span>
                <span className="text-white">
                  {(stats.max_memory_bytes / 1024 / 1024 / 1024).toFixed(1)} GB
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Databases() {
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [postgresStats, setPostgresStats] = useState<PostgresDatabaseStats | null>(null);
  const [mongoStats, setMongoStats] = useState<MongoDatabaseStats | null>(null);
  const [redisStats, setRedisStats] = useState<RedisStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'postgres' | 'mongo' | 'redis'>('overview');

  const fetchDatabases = useCallback(async (showLoading = false) => {
    if (showLoading) setIsLoading(true);
    setIsRefreshing(true);
    try {
      const [dbList, pgStats, mgStats, rdStats] = await Promise.all([
        databaseApi.listDatabases(),
        databaseApi.getPostgresStats().catch(() => null),
        databaseApi.getMongoStats().catch(() => null),
        databaseApi.getRedisStats().catch(() => null),
      ]);
      setDatabases(dbList);
      setPostgresStats(pgStats);
      setMongoStats(mgStats);
      setRedisStats(rdStats);
    } catch (error) {
      console.error('Failed to fetch databases:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDatabases(true);
  }, [fetchDatabases]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  const healthyCount = databases.filter(db => db.status === 'healthy').length;
  const totalCount = databases.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Database Management</h1>
          <p className="text-gray-400 mt-1">
            Monitor and manage PostgreSQL, MongoDB, and Redis databases
          </p>
        </div>
        <button
          onClick={() => fetchDatabases(false)}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={clsx('w-4 h-4', isRefreshing && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Summary */}
      <div className={clsx(
        'rounded-xl p-6 border-2',
        healthyCount === totalCount
          ? 'bg-green-500/20 border-green-500'
          : healthyCount > 0
          ? 'bg-yellow-500/20 border-yellow-500'
          : 'bg-red-500/20 border-red-500'
      )}>
        <div className="flex items-center gap-4">
          <div className="p-3 bg-gray-800 rounded-lg">
            <HardDrive className="w-8 h-8 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Database Status</h2>
            <p className="text-gray-300">
              {healthyCount} of {totalCount} databases healthy
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-700">
        <nav className="flex gap-4">
          {[
            { id: 'overview', label: 'Overview', icon: BarChart3 },
            { id: 'postgres', label: 'PostgreSQL', icon: Database },
            { id: 'mongo', label: 'MongoDB', icon: FileStack },
            { id: 'redis', label: 'Redis', icon: Zap },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as typeof activeTab)}
              className={clsx(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === id
                  ? 'text-blue-400 border-blue-400'
                  : 'text-gray-400 border-transparent hover:text-white hover:border-gray-600'
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {databases.map((db) => (
            <DatabaseCard
              key={db.db_type}
              db={db}
              onRefresh={() => fetchDatabases(false)}
            />
          ))}
        </div>
      )}

      {activeTab === 'postgres' && (
        <PostgresStatsCard stats={postgresStats} />
      )}

      {activeTab === 'mongo' && (
        <MongoStatsCard stats={mongoStats} />
      )}

      {activeTab === 'redis' && (
        <RedisStatsCard stats={redisStats} />
      )}
    </div>
  );
}
