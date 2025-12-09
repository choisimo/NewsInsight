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
