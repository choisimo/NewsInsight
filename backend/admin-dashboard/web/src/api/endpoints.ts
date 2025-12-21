// API Endpoints
import apiClient from './client';
import type {
  Environment,
  EnvironmentStatus,
  Script,
  TaskExecution,
  Document,
  AuditLog,
  User,
  Token,
  HealthCheck,
  ServiceInfo,
  ServiceHealth,
  InfrastructureHealth,
  OverallSystemHealth,
  DataSource,
  DataSourceTestResult,
  DatabaseInfo,
  PostgresDatabaseStats,
  MongoDatabaseStats,
  RedisStats,
  KafkaClusterInfo,
} from '../types';

// Auth
export const authApi = {
  login: async (username: string, password: string): Promise<Token> => {
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);
    
    const response = await fetch('/api/v1/admin/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData,
    });
    
    if (!response.ok) {
      throw new Error('Invalid credentials');
    }
    
    const token = await response.json();
    apiClient.setToken(token.access_token);
    return token;
  },
  
  logout: async (): Promise<void> => {
    await apiClient.post('/auth/logout');
    apiClient.setToken(null);
  },
  
  me: () => apiClient.get<User>('/auth/me'),
  
  changePassword: (oldPassword: string, newPassword: string) =>
    apiClient.post('/auth/change-password', { old_password: oldPassword, new_password: newPassword }),
};

// Environments
export const environmentsApi = {
  list: (activeOnly = false) =>
    apiClient.get<Environment[]>(`/environments?active_only=${activeOnly}`),
  
  get: (id: string) =>
    apiClient.get<Environment>(`/environments/${id}`),
  
  getStatus: (id: string) =>
    apiClient.get<EnvironmentStatus>(`/environments/${id}/status`),
  
  create: (data: Partial<Environment>) =>
    apiClient.post<Environment>('/environments', data),
  
  update: (id: string, data: Partial<Environment>) =>
    apiClient.patch<Environment>(`/environments/${id}`, data),
  
  delete: (id: string) =>
    apiClient.delete(`/environments/${id}`),
  
  up: (id: string, build = true) =>
    apiClient.post(`/environments/${id}/up?build=${build}`),
  
  down: (id: string, volumes = false) =>
    apiClient.post(`/environments/${id}/down?volumes=${volumes}`),
  
  restart: (id: string, service?: string) =>
    apiClient.post(`/environments/${id}/restart${service ? `?service=${service}` : ''}`),
  
  logs: (id: string, service: string, tail = 100) =>
    apiClient.get<{ service: string; logs: string }>(`/environments/${id}/logs/${service}?tail=${tail}`),
};

// Scripts
export const scriptsApi = {
  list: (environment?: string, tag?: string) => {
    const params = new URLSearchParams();
    if (environment) params.append('environment', environment);
    if (tag) params.append('tag', tag);
    return apiClient.get<Script[]>(`/scripts?${params}`);
  },
  
  get: (id: string) =>
    apiClient.get<Script>(`/scripts/${id}`),
  
  create: (data: Partial<Script>) =>
    apiClient.post<Script>('/scripts', data),
  
  update: (id: string, data: Partial<Script>) =>
    apiClient.patch<Script>(`/scripts/${id}`, data),
  
  delete: (id: string) =>
    apiClient.delete(`/scripts/${id}`),
  
  execute: (scriptId: string, environmentId: string, parameters: Record<string, unknown> = {}) =>
    apiClient.post<TaskExecution>('/scripts/execute', {
      script_id: scriptId,
      environment_id: environmentId,
      parameters,
    }),
  
  executeStream: (
    scriptId: string,
    environmentId: string,
    parameters: Record<string, unknown>,
    onData: (chunk: string) => void
  ) =>
    apiClient.stream('/scripts/execute/stream', {
      script_id: scriptId,
      environment_id: environmentId,
      parameters,
    }, onData),
  
  listExecutions: (scriptId?: string, environmentId?: string, limit = 50) => {
    const params = new URLSearchParams();
    if (scriptId) params.append('script_id', scriptId);
    if (environmentId) params.append('environment_id', environmentId);
    params.append('limit', limit.toString());
    return apiClient.get<TaskExecution[]>(`/scripts/executions?${params}`);
  },
  
  getExecution: (id: string) =>
    apiClient.get<TaskExecution>(`/scripts/executions/${id}`),
  
  cancelExecution: (id: string) =>
    apiClient.post(`/scripts/executions/${id}/cancel`),
};

// Documents
export const documentsApi = {
  list: (category?: string, tag?: string, environment?: string, search?: string) => {
    const params = new URLSearchParams();
    if (category) params.append('category', category);
    if (tag) params.append('tag', tag);
    if (environment) params.append('environment', environment);
    if (search) params.append('search', search);
    return apiClient.get<Document[]>(`/documents?${params}`);
  },
  
  get: (id: string) =>
    apiClient.get<Document>(`/documents/${id}`),
  
  getCategories: () =>
    apiClient.get<Record<string, number>>('/documents/categories'),
  
  getTags: () =>
    apiClient.get<Record<string, number>>('/documents/tags'),
  
  getRelated: (environment?: string, scriptId?: string) => {
    const params = new URLSearchParams();
    if (environment) params.append('environment', environment);
    if (scriptId) params.append('script_id', scriptId);
    return apiClient.get<Document[]>(`/documents/related?${params}`);
  },
  
  refresh: () =>
    apiClient.post('/documents/refresh'),
};

// Audit
export const auditApi = {
  list: (filters: {
    userId?: string;
    action?: string;
    resourceType?: string;
    environmentId?: string;
    startDate?: string;
    endDate?: string;
    success?: boolean;
    page?: number;
    pageSize?: number;
  } = {}) => {
    const params = new URLSearchParams();
    if (filters.userId) params.append('user_id', filters.userId);
    if (filters.action) params.append('action', filters.action);
    if (filters.resourceType) params.append('resource_type', filters.resourceType);
    if (filters.environmentId) params.append('environment_id', filters.environmentId);
    if (filters.startDate) params.append('start_date', filters.startDate);
    if (filters.endDate) params.append('end_date', filters.endDate);
    if (filters.success !== undefined) params.append('success', filters.success.toString());
    params.append('page', (filters.page || 1).toString());
    params.append('page_size', (filters.pageSize || 50).toString());
    return apiClient.get<AuditLog[]>(`/audit/logs?${params}`);
  },
  
  get: (id: string) =>
    apiClient.get<AuditLog>(`/audit/logs/${id}`),
  
  statistics: (startDate?: string, endDate?: string) => {
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    return apiClient.get<Record<string, unknown>>(`/audit/statistics?${params}`);
  },
};

// Health
export const healthApi = {
  check: () => apiClient.get<HealthCheck>('/health'),
};

// Users (Admin)
export const usersApi = {
  list: (activeOnly = false) =>
    apiClient.get<User[]>(`/auth/users?active_only=${activeOnly}`),
  
  get: (id: string) =>
    apiClient.get<User>(`/auth/users/${id}`),
  
  create: (data: { username: string; password: string; email?: string; role: string }) =>
    apiClient.post<User>('/auth/users', data),
  
  update: (id: string, data: { email?: string; role?: string; is_active?: boolean }) =>
    apiClient.patch<User>(`/auth/users/${id}`, data),
  
  resetPassword: (id: string, newPassword: string) =>
    apiClient.post(`/auth/users/${id}/reset-password`, { new_password: newPassword }),
  
  delete: (id: string) =>
    apiClient.delete(`/auth/users/${id}`),
};

// LLM Provider Settings Types
export type LlmProviderType = 
  | 'OPENAI' 
  | 'ANTHROPIC' 
  | 'GOOGLE' 
  | 'OPENROUTER' 
  | 'OLLAMA' 
  | 'AZURE_OPENAI' 
  | 'CUSTOM';

export interface LlmProviderTypeInfo {
  value: LlmProviderType;
  displayName: string;
  description: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
}

export interface LlmProviderSettings {
  id: number;
  providerType: LlmProviderType;
  userId?: string;
  hasApiKey: boolean;
  maskedApiKey?: string;
  defaultModel: string;
  baseUrl?: string;
  enabled: boolean;
  priority: number;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  azureDeploymentName?: string;
  azureApiVersion?: string;
  lastTestedAt?: string;
  lastTestSuccess?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LlmProviderSettingsRequest {
  providerType: LlmProviderType;
  apiKey?: string;
  defaultModel: string;
  baseUrl?: string;
  enabled?: boolean;
  priority?: number;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  azureDeploymentName?: string;
  azureApiVersion?: string;
}

export interface LlmTestResult {
  providerType: LlmProviderType;
  success: boolean;
  message: string;
  latencyMs?: number;
  testedAt: string;
}

// LLM Providers (Admin)
export const llmProvidersApi = {
  // Get provider type metadata
  getTypes: () =>
    apiClient.get<LlmProviderTypeInfo[]>('/llm-providers/types'),
  
  // Get all global settings
  listGlobal: () =>
    apiClient.get<LlmProviderSettings[]>('/llm-providers/global'),
  
  // Get global setting for specific provider
  getGlobal: (providerType: LlmProviderType) =>
    apiClient.get<LlmProviderSettings>(`/llm-providers/global/${providerType}`),
  
  // Save/update global setting
  saveGlobal: (providerType: LlmProviderType, data: LlmProviderSettingsRequest) =>
    apiClient.put<LlmProviderSettings>(`/llm-providers/global/${providerType}`, data),
  
  // Delete global setting
  deleteGlobal: (providerType: LlmProviderType) =>
    apiClient.delete(`/llm-providers/global/${providerType}`),
  
  // Test connection
  testConnection: (providerType: LlmProviderType, model?: string) => {
    const params = new URLSearchParams({ providerType });
    if (model) params.append('model', model);
    return apiClient.post<LlmTestResult>(`/llm-providers/test?${params}`);
  },
  
  // Get effective settings (global + user overrides)
  getEffective: (userId?: string) => {
    const params = userId ? `?userId=${userId}` : '';
    return apiClient.get<LlmProviderSettings[]>(`/llm-providers/effective${params}`);
  },
  
  // Get enabled providers
  getEnabled: (userId?: string) => {
    const params = userId ? `?userId=${userId}` : '';
    return apiClient.get<LlmProviderSettings[]>(`/llm-providers/enabled${params}`);
  },
};

// Health Monitor API
export const healthMonitorApi = {
  // Get all registered services
  listServices: () =>
    apiClient.get<ServiceInfo[]>('/health-monitor/services'),
  
  // Get infrastructure services
  listInfrastructure: () =>
    apiClient.get<Record<string, unknown>[]>('/health-monitor/infrastructure'),
  
  // Check specific service health
  checkService: (serviceId: string) =>
    apiClient.get<ServiceHealth>(`/health-monitor/check/${serviceId}`),
  
  // Check all services health
  checkAllServices: () =>
    apiClient.get<ServiceHealth[]>('/health-monitor/check-all'),
  
  // Check infrastructure health
  checkInfrastructure: () =>
    apiClient.get<InfrastructureHealth[]>('/health-monitor/check-infrastructure'),
  
  // Get overall system health
  getOverallHealth: () =>
    apiClient.get<OverallSystemHealth>('/health-monitor/overall'),
  
  // Get last check result (cached)
  getLastCheck: (serviceId: string) =>
    apiClient.get<ServiceHealth>(`/health-monitor/last-check/${serviceId}`),
  
  // SSE stream URL builder
  getStreamUrl: (interval = 10) => {
    const token = apiClient.getToken();
    const baseUrl = '/api/v1/admin';
    return `${baseUrl}/health-monitor/stream?interval=${interval}&token=${token}`;
  },
};

// Data Sources API
export const dataSourcesApi = {
  // List all data sources
  list: (filters?: { type?: string; status?: string; category?: string }) => {
    const params = new URLSearchParams();
    if (filters?.type) params.append('type', filters.type);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.category) params.append('category', filters.category);
    return apiClient.get<DataSource[]>(`/data-sources?${params}`);
  },
  
  // Get single data source
  get: (id: string) =>
    apiClient.get<DataSource>(`/data-sources/${id}`),
  
  // Create new data source
  create: (data: Partial<DataSource>) =>
    apiClient.post<DataSource>('/data-sources', data),
  
  // Update data source
  update: (id: string, data: Partial<DataSource>) =>
    apiClient.patch<DataSource>(`/data-sources/${id}`, data),
  
  // Delete data source
  delete: (id: string) =>
    apiClient.delete(`/data-sources/${id}`),
  
  // Test data source connection
  test: (id: string) =>
    apiClient.post<DataSourceTestResult>(`/data-sources/${id}/test`),
  
  // Trigger crawl for data source
  triggerCrawl: (id: string) =>
    apiClient.post(`/data-sources/${id}/crawl`),
  
  // Toggle active status
  toggleActive: (id: string, isActive: boolean) =>
    apiClient.patch<DataSource>(`/data-sources/${id}`, { is_active: isActive }),
  
  // Get categories
  getCategories: () =>
    apiClient.get<string[]>('/data-sources/categories'),
  
  // Get statistics
  getStats: () =>
    apiClient.get<Record<string, unknown>>('/data-sources/stats'),
};

// Database Management API
export const databaseApi = {
  // Get all database info
  listDatabases: () =>
    apiClient.get<DatabaseInfo[]>('/databases'),
  
  // Get PostgreSQL stats
  getPostgresStats: () =>
    apiClient.get<PostgresDatabaseStats>('/databases/postgres/stats'),
  
  // Get MongoDB stats
  getMongoStats: () =>
    apiClient.get<MongoDatabaseStats>('/databases/mongo/stats'),
  
  // Get Redis stats
  getRedisStats: () =>
    apiClient.get<RedisStats>('/databases/redis/stats'),
  
  // Health check specific database
  checkDatabase: (dbType: 'postgres' | 'mongo' | 'redis') =>
    apiClient.get<DatabaseInfo>(`/databases/${dbType}/health`),
};

// Kafka/Redpanda API
export const kafkaApi = {
  // Get cluster info
  getClusterInfo: () =>
    apiClient.get<KafkaClusterInfo>('/kafka/cluster'),
  
  // List topics
  listTopics: () =>
    apiClient.get<KafkaClusterInfo['topics']>('/kafka/topics'),
  
  // Get topic details
  getTopic: (topicName: string) =>
    apiClient.get<KafkaClusterInfo['topics'][0]>(`/kafka/topics/${topicName}`),
  
  // List consumer groups
  listConsumerGroups: () =>
    apiClient.get<KafkaClusterInfo['consumer_groups']>('/kafka/consumer-groups'),
  
  // Get consumer group details
  getConsumerGroup: (groupId: string) =>
    apiClient.get<KafkaClusterInfo['consumer_groups'][0]>(`/kafka/consumer-groups/${groupId}`),
};
