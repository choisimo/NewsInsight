import { useState, useEffect, useCallback } from 'react';
import {
  Rss,
  Globe,
  Database as DatabaseIcon,
  Share2,
  Plus,
  Pencil,
  Trash2,
  TestTube,
  Play,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  ToggleLeft,
  ToggleRight,
  X,
  Loader2,
} from 'lucide-react';
import { dataSourcesApi } from '../api/endpoints';
import type { DataSource, DataSourceType, DataSourceStatus, DataSourceTestResult } from '../types';
import clsx from 'clsx';

const typeConfig: Record<DataSourceType, { icon: typeof Rss; label: string; color: string }> = {
  rss: { icon: Rss, label: 'RSS', color: 'text-orange-400' },
  web: { icon: Globe, label: 'Web', color: 'text-blue-400' },
  api: { icon: DatabaseIcon, label: 'API', color: 'text-green-400' },
  social: { icon: Share2, label: 'Social', color: 'text-purple-400' },
};

const statusConfig: Record<DataSourceStatus, { color: string; bgColor: string; label: string }> = {
  active: { color: 'text-green-400', bgColor: 'bg-green-400/10', label: 'Active' },
  inactive: { color: 'text-gray-400', bgColor: 'bg-gray-400/10', label: 'Inactive' },
  error: { color: 'text-red-400', bgColor: 'bg-red-400/10', label: 'Error' },
  testing: { color: 'text-yellow-400', bgColor: 'bg-yellow-400/10', label: 'Testing' },
};

interface DataSourceFormData {
  name: string;
  source_type: DataSourceType;
  url: string;
  description: string;
  category: string;
  language: string;
  crawl_interval_minutes: number;
  priority: number;
  is_active: boolean;
}

const defaultFormData: DataSourceFormData = {
  name: '',
  source_type: 'rss',
  url: '',
  description: '',
  category: '',
  language: 'ko',
  crawl_interval_minutes: 60,
  priority: 0,
  is_active: true,
};

function DataSourceModal({
  isOpen,
  onClose,
  onSave,
  source,
  categories,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: DataSourceFormData) => void;
  source?: DataSource;
  categories: string[];
}) {
  const [formData, setFormData] = useState<DataSourceFormData>(defaultFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (source) {
      setFormData({
        name: source.name,
        source_type: source.source_type,
        url: source.url,
        description: source.description || '',
        category: source.category || '',
        language: source.language,
        crawl_interval_minutes: source.crawl_interval_minutes,
        priority: source.priority,
        is_active: source.is_active,
      });
    } else {
      setFormData(defaultFormData);
    }
  }, [source, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onSave(formData);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-gray-800 rounded-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white">
            {source ? 'Edit Data Source' : 'New Data Source'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Type *</label>
            <select
              value={formData.source_type}
              onChange={(e) => setFormData({ ...formData, source_type: e.target.value as DataSourceType })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {Object.entries(typeConfig).map(([value, { label }]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">URL *</label>
            <input
              type="url"
              value={formData.url}
              onChange={(e) => setFormData({ ...formData, url: e.target.value })}
              required
              placeholder="https://example.com/feed.xml"
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Category</label>
              <input
                type="text"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                list="categories"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <datalist id="categories">
                {categories.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Language</label>
              <select
                value={formData.language}
                onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="ko">Korean</option>
                <option value="en">English</option>
                <option value="ja">Japanese</option>
                <option value="zh">Chinese</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                Crawl Interval (minutes)
              </label>
              <input
                type="number"
                value={formData.crawl_interval_minutes}
                onChange={(e) => setFormData({ ...formData, crawl_interval_minutes: parseInt(e.target.value) || 60 })}
                min={5}
                max={1440}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Priority</label>
              <input
                type="number"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                min={0}
                max={100}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_active"
              checked={formData.is_active}
              onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
            />
            <label htmlFor="is_active" className="text-sm text-gray-300">Active</label>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {source ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DataSourceCard({
  source,
  onEdit,
  onDelete,
  onTest,
  onToggle,
  onCrawl,
}: {
  source: DataSource;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
  onToggle: () => void;
  onCrawl: () => void;
}) {
  const typeInfo = typeConfig[source.source_type];
  const statusInfo = statusConfig[source.status];
  const TypeIcon = typeInfo.icon;

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <TypeIcon className={clsx('w-5 h-5', typeInfo.color)} />
          <h3 className="font-medium text-white truncate max-w-[200px]" title={source.name}>
            {source.name}
          </h3>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggle}
            className="p-1.5 text-gray-400 hover:text-white transition-colors"
            title={source.is_active ? 'Deactivate' : 'Activate'}
          >
            {source.is_active ? (
              <ToggleRight className="w-5 h-5 text-green-400" />
            ) : (
              <ToggleLeft className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>

      <div className={clsx('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', statusInfo.bgColor, statusInfo.color)}>
        {statusInfo.label}
      </div>

      <p className="text-sm text-gray-400 mt-2 truncate" title={source.url}>
        {source.url}
      </p>

      {source.description && (
        <p className="text-sm text-gray-500 mt-1 line-clamp-2">{source.description}</p>
      )}

      <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
        {source.category && <span className="bg-gray-700 px-2 py-0.5 rounded">{source.category}</span>}
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {source.crawl_interval_minutes}m
        </span>
        <span>{source.total_articles} articles</span>
      </div>

      {source.last_crawled_at && (
        <p className="text-xs text-gray-500 mt-2">
          Last crawled: {new Date(source.last_crawled_at).toLocaleString()}
        </p>
      )}

      <div className="flex items-center justify-end gap-1 mt-4 pt-3 border-t border-gray-700">
        <button
          onClick={onTest}
          className="p-2 text-gray-400 hover:text-blue-400 transition-colors"
          title="Test Connection"
        >
          <TestTube className="w-4 h-4" />
        </button>
        <button
          onClick={onCrawl}
          className="p-2 text-gray-400 hover:text-green-400 transition-colors"
          title="Trigger Crawl"
        >
          <Play className="w-4 h-4" />
        </button>
        <button
          onClick={onEdit}
          className="p-2 text-gray-400 hover:text-yellow-400 transition-colors"
          title="Edit"
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          onClick={onDelete}
          className="p-2 text-gray-400 hover:text-red-400 transition-colors"
          title="Delete"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default function DataSources() {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<DataSource | undefined>();
  const [testResult, setTestResult] = useState<DataSourceTestResult | null>(null);
  
  // Filters
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [sourcesData, categoriesData, statsData] = await Promise.all([
        dataSourcesApi.list({
          type: typeFilter || undefined,
          status: statusFilter || undefined,
          category: categoryFilter || undefined,
        }),
        dataSourcesApi.getCategories(),
        dataSourcesApi.getStats(),
      ]);
      setSources(sourcesData);
      setCategories(categoriesData);
      setStats(statsData);
    } catch (error) {
      console.error('Failed to fetch data sources:', error);
    } finally {
      setIsLoading(false);
    }
  }, [typeFilter, statusFilter, categoryFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSave = async (data: DataSourceFormData) => {
    if (editingSource) {
      await dataSourcesApi.update(editingSource.id, data);
    } else {
      await dataSourcesApi.create(data as unknown as Partial<DataSource>);
    }
    setEditingSource(undefined);
    fetchData();
  };

  const handleDelete = async (source: DataSource) => {
    if (!confirm(`Are you sure you want to delete "${source.name}"?`)) return;
    await dataSourcesApi.delete(source.id);
    fetchData();
  };

  const handleTest = async (source: DataSource) => {
    try {
      const result = await dataSourcesApi.test(source.id);
      setTestResult(result);
      fetchData();
    } catch (error) {
      console.error('Test failed:', error);
    }
  };

  const handleToggle = async (source: DataSource) => {
    await dataSourcesApi.toggleActive(source.id, !source.is_active);
    fetchData();
  };

  const handleCrawl = async (source: DataSource) => {
    try {
      await dataSourcesApi.triggerCrawl(source.id);
      alert('Crawl triggered successfully!');
      fetchData();
    } catch (error) {
      alert('Failed to trigger crawl');
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Data Sources</h1>
          <p className="text-gray-400 mt-1">Manage news data collection sources</p>
        </div>
        <button
          onClick={() => {
            setEditingSource(undefined);
            setIsModalOpen(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Source
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <p className="text-gray-400 text-sm">Total Sources</p>
            <p className="text-2xl font-bold text-white">{stats.total_sources as number}</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <p className="text-gray-400 text-sm">Active</p>
            <p className="text-2xl font-bold text-green-400">{stats.active_sources as number}</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <p className="text-gray-400 text-sm">Inactive</p>
            <p className="text-2xl font-bold text-gray-400">{stats.inactive_sources as number}</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <p className="text-gray-400 text-sm">Total Articles</p>
            <p className="text-2xl font-bold text-blue-400">{stats.total_articles as number}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
        >
          <option value="">All Types</option>
          {Object.entries(typeConfig).map(([value, { label }]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
        >
          <option value="">All Status</option>
          {Object.entries(statusConfig).map(([value, { label }]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
        >
          <option value="">All Categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      {/* Sources Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sources.map((source) => (
          <DataSourceCard
            key={source.id}
            source={source}
            onEdit={() => {
              setEditingSource(source);
              setIsModalOpen(true);
            }}
            onDelete={() => handleDelete(source)}
            onTest={() => handleTest(source)}
            onToggle={() => handleToggle(source)}
            onCrawl={() => handleCrawl(source)}
          />
        ))}
      </div>

      {sources.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <DatabaseIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No data sources found</p>
          <p className="text-sm mt-1">Add a new data source to get started</p>
        </div>
      )}

      {/* Modal */}
      <DataSourceModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingSource(undefined);
        }}
        onSave={handleSave}
        source={editingSource}
        categories={categories}
      />

      {/* Test Result Modal */}
      {testResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-gray-800 rounded-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Test Result</h3>
              <button onClick={() => setTestResult(null)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {testResult.success ? (
                  <CheckCircle className="w-5 h-5 text-green-400" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-400" />
                )}
                <span className={testResult.success ? 'text-green-400' : 'text-red-400'}>
                  {testResult.success ? 'Success' : 'Failed'}
                </span>
              </div>
              <p className="text-gray-300">{testResult.message}</p>
              {testResult.response_time_ms && (
                <p className="text-sm text-gray-400">Response time: {testResult.response_time_ms.toFixed(0)}ms</p>
              )}
            </div>
            <button
              onClick={() => setTestResult(null)}
              className="w-full mt-4 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
