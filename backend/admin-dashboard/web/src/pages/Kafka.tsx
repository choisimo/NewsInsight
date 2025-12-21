import { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  Radio,
  Users,
  MessageSquare,
  Server,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Layers,
  Clock,
  ArrowDownToLine,
} from 'lucide-react';
import { kafkaApi } from '../api/endpoints';
import type {
  KafkaClusterInfo,
  KafkaTopicInfo,
  KafkaConsumerGroupInfo,
} from '../types';
import clsx from 'clsx';

const stateColors: Record<string, string> = {
  Stable: 'text-green-400',
  Empty: 'text-gray-400',
  Dead: 'text-red-400',
  PreparingRebalance: 'text-yellow-400',
  CompletingRebalance: 'text-yellow-400',
  Unknown: 'text-gray-500',
};

function TopicCard({ topic }: { topic: KafkaTopicInfo }) {
  const formatBytes = (bytes?: number) => {
    if (!bytes) return 'N/A';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) {
      size /= 1024;
      i++;
    }
    return `${size.toFixed(1)} ${units[i]}`;
  };

  const formatRetention = (ms?: number) => {
    if (!ms) return 'Default';
    const hours = ms / (1000 * 60 * 60);
    if (hours < 24) return `${hours}h`;
    const days = hours / 24;
    return `${days}d`;
  };

  return (
    <div className={clsx(
      'bg-gray-800 rounded-lg p-4 border border-gray-700',
      topic.is_internal && 'opacity-60'
    )}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-blue-400" />
          <div>
            <h3 className="font-medium text-white">{topic.name}</h3>
            {topic.is_internal && (
              <span className="text-xs text-gray-500">Internal</span>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between text-gray-400">
          <span className="flex items-center gap-1">
            <Layers className="w-3 h-3" />
            Partitions
          </span>
          <span className="text-white">{topic.partition_count}</span>
        </div>
        <div className="flex items-center justify-between text-gray-400">
          <span>Replication</span>
          <span className="text-white">{topic.replication_factor}x</span>
        </div>
        {topic.message_count !== undefined && (
          <div className="flex items-center justify-between text-gray-400">
            <span>Messages</span>
            <span className="text-white">{topic.message_count.toLocaleString()}</span>
          </div>
        )}
        {topic.size_bytes !== undefined && (
          <div className="flex items-center justify-between text-gray-400">
            <span>Size</span>
            <span className="text-white">{formatBytes(topic.size_bytes)}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-gray-400">
          <span>Retention</span>
          <span className="text-white">{formatRetention(topic.retention_ms)}</span>
        </div>
      </div>
    </div>
  );
}

function ConsumerGroupCard({ group }: { group: KafkaConsumerGroupInfo }) {
  const stateColor = stateColors[group.state] || stateColors.Unknown;

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-purple-400" />
          <h3 className="font-medium text-white">{group.group_id}</h3>
        </div>
        <span className={clsx('text-sm font-medium', stateColor)}>
          {group.state}
        </span>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between text-gray-400">
          <span>Members</span>
          <span className="text-white">{group.members_count}</span>
        </div>
        <div className="flex items-center justify-between text-gray-400">
          <span>Topics</span>
          <span className="text-white">{group.topics.length}</span>
        </div>
        <div className="flex items-center justify-between text-gray-400">
          <span className="flex items-center gap-1">
            <ArrowDownToLine className="w-3 h-3" />
            Total Lag
          </span>
          <span className={clsx(
            'font-medium',
            group.total_lag > 1000 ? 'text-red-400' :
            group.total_lag > 100 ? 'text-yellow-400' : 'text-green-400'
          )}>
            {group.total_lag.toLocaleString()}
          </span>
        </div>
      </div>

      {group.topics.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-700">
          <p className="text-xs text-gray-500 mb-2">Subscribed Topics:</p>
          <div className="flex flex-wrap gap-1">
            {group.topics.map((topic) => (
              <span
                key={topic}
                className="px-2 py-0.5 text-xs bg-gray-700 text-gray-300 rounded"
              >
                {topic}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ClusterOverview({ cluster }: { cluster: KafkaClusterInfo }) {
  return (
    <div className="bg-gradient-to-r from-blue-900/30 to-purple-900/30 rounded-xl p-6 border border-blue-500/30">
      <div className="flex items-center gap-4 mb-6">
        <div className="p-3 bg-blue-500/20 rounded-lg">
          <Radio className="w-8 h-8 text-blue-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Kafka/Redpanda Cluster</h2>
          <p className="text-gray-400 text-sm">
            Last checked: {new Date(cluster.checked_at).toLocaleTimeString()}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gray-800/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-gray-400 mb-1">
            <Server className="w-4 h-4" />
            <span className="text-sm">Brokers</span>
          </div>
          <p className="text-2xl font-bold text-white">{cluster.broker_count}</p>
          {cluster.controller_id !== undefined && (
            <p className="text-xs text-gray-500">Controller: {cluster.controller_id}</p>
          )}
        </div>

        <div className="bg-gray-800/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-gray-400 mb-1">
            <MessageSquare className="w-4 h-4" />
            <span className="text-sm">Topics</span>
          </div>
          <p className="text-2xl font-bold text-white">{cluster.total_topics}</p>
          <p className="text-xs text-gray-500">
            {cluster.topics.filter(t => !t.is_internal).length} user topics
          </p>
        </div>

        <div className="bg-gray-800/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-gray-400 mb-1">
            <Layers className="w-4 h-4" />
            <span className="text-sm">Partitions</span>
          </div>
          <p className="text-2xl font-bold text-white">{cluster.total_partitions}</p>
        </div>

        <div className="bg-gray-800/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-gray-400 mb-1">
            <Users className="w-4 h-4" />
            <span className="text-sm">Consumer Groups</span>
          </div>
          <p className="text-2xl font-bold text-white">{cluster.consumer_groups.length}</p>
          <p className="text-xs text-gray-500">
            {cluster.consumer_groups.filter(g => g.state === 'Stable').length} stable
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Kafka() {
  const [cluster, setCluster] = useState<KafkaClusterInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'topics' | 'consumers'>('topics');
  const [showInternal, setShowInternal] = useState(false);

  const fetchCluster = useCallback(async (showLoading = false) => {
    if (showLoading) setIsLoading(true);
    setIsRefreshing(true);
    try {
      const data = await kafkaApi.getClusterInfo();
      setCluster(data);
    } catch (error) {
      console.error('Failed to fetch Kafka cluster info:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchCluster(true);
  }, [fetchCluster]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  const filteredTopics = cluster?.topics.filter(t => showInternal || !t.is_internal) || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Kafka / Redpanda</h1>
          <p className="text-gray-400 mt-1">
            Monitor message queues, topics, and consumer groups
          </p>
        </div>
        <button
          onClick={() => fetchCluster(false)}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={clsx('w-4 h-4', isRefreshing && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Cluster Overview */}
      {cluster && <ClusterOverview cluster={cluster} />}

      {/* Tabs */}
      <div className="border-b border-gray-700">
        <nav className="flex gap-4">
          <button
            onClick={() => setActiveTab('topics')}
            className={clsx(
              'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
              activeTab === 'topics'
                ? 'text-blue-400 border-blue-400'
                : 'text-gray-400 border-transparent hover:text-white hover:border-gray-600'
            )}
          >
            <MessageSquare className="w-4 h-4" />
            Topics ({filteredTopics.length})
          </button>
          <button
            onClick={() => setActiveTab('consumers')}
            className={clsx(
              'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
              activeTab === 'consumers'
                ? 'text-purple-400 border-purple-400'
                : 'text-gray-400 border-transparent hover:text-white hover:border-gray-600'
            )}
          >
            <Users className="w-4 h-4" />
            Consumer Groups ({cluster?.consumer_groups.length || 0})
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'topics' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Topics</h2>
            <label className="flex items-center gap-2 text-sm text-gray-400">
              <input
                type="checkbox"
                checked={showInternal}
                onChange={(e) => setShowInternal(e.target.checked)}
                className="rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
              />
              Show internal topics
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredTopics.map((topic) => (
              <TopicCard key={topic.name} topic={topic} />
            ))}
          </div>
          {filteredTopics.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No topics found</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'consumers' && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-4">Consumer Groups</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {cluster?.consumer_groups.map((group) => (
              <ConsumerGroupCard key={group.group_id} group={group} />
            ))}
          </div>
          {(!cluster?.consumer_groups || cluster.consumer_groups.length === 0) && (
            <div className="text-center py-12 text-gray-500">
              <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No consumer groups found</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
