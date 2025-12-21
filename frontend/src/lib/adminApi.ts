import { getApiClient } from './api';
import type {
  Environment,
  EnvironmentStatus,
  Script,
  TaskExecution,
  Document,
  AuditLog,
  User,
  Token,
  SetupStatus,
} from '@/types/admin';

// Auth
export const authApi = {
  login: async (username: string, password: string): Promise<Token> => {
    const client = await getApiClient();
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);
    
    const response = await client.post('/api/v1/admin/auth/token', formData, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return response.data;
  },
  
  refresh: async (): Promise<Token> => {
    const client = await getApiClient();
    // Browser automatically sends HTTP-Only refresh_token cookie
    const response = await client.post<Token>('/api/v1/admin/auth/refresh', {}, {
      withCredentials: true, // Ensure cookies are sent
    });
    return response.data;
  },
  
  logout: async (): Promise<void> => {
    const client = await getApiClient();
    await client.post('/api/v1/admin/auth/logout');
  },
  
  me: async () => {
    const client = await getApiClient();
    const response = await client.get<User>('/api/v1/admin/auth/me');
    return response.data;
  },
  
  changePassword: async (oldPassword: string, newPassword: string) => {
    const client = await getApiClient();
    const response = await client.post('/api/v1/admin/auth/change-password', { old_password: oldPassword, new_password: newPassword });
    return response.data;
  },
  
  getSetupStatus: async (): Promise<SetupStatus> => {
    const client = await getApiClient();
    const response = await client.get<SetupStatus>('/api/v1/admin/auth/setup-status');
    return response.data;
  },
};

// Environments
export const environmentsApi = {
  list: async (activeOnly = false) => {
    const client = await getApiClient();
    const response = await client.get<Environment[]>(`/api/v1/admin/environments?active_only=${activeOnly}`);
    return response.data;
  },
  
  get: async (id: string) => {
    const client = await getApiClient();
    const response = await client.get<Environment>(`/api/v1/admin/environments/${id}`);
    return response.data;
  },
  
  getStatus: async (id: string) => {
    const client = await getApiClient();
    const response = await client.get<EnvironmentStatus>(`/api/v1/admin/environments/${id}/status`);
    return response.data;
  },
  
  create: async (data: Partial<Environment>) => {
    const client = await getApiClient();
    const response = await client.post<Environment>('/api/v1/admin/environments', data);
    return response.data;
  },
  
  update: async (id: string, data: Partial<Environment>) => {
    const client = await getApiClient();
    const response = await client.patch<Environment>(`/api/v1/admin/environments/${id}`, data);
    return response.data;
  },
  
  delete: async (id: string) => {
    const client = await getApiClient();
    await client.delete(`/api/v1/admin/environments/${id}`);
  },
  
  up: async (id: string, build = true) => {
    const client = await getApiClient();
    await client.post(`/api/v1/admin/environments/${id}/up?build=${build}`);
  },
  
  down: async (id: string, volumes = false) => {
    const client = await getApiClient();
    await client.post(`/api/v1/admin/environments/${id}/down?volumes=${volumes}`);
  },
  
  restart: async (id: string, service?: string) => {
    const client = await getApiClient();
    await client.post(`/api/v1/admin/environments/${id}/restart${service ? `?service=${service}` : ''}`);
  },
  
  logs: async (id: string, service: string, tail = 100) => {
    const client = await getApiClient();
    const response = await client.get<{ service: string; logs: string }>(
      `/api/v1/admin/environments/${id}/logs/${service}?tail=${tail}`
    );
    return response.data;
  },
};

// Scripts
export const scriptsApi = {
  list: async (environment?: string, tag?: string) => {
    const client = await getApiClient();
    const params = new URLSearchParams();
    if (environment) params.append('environment', environment);
    if (tag) params.append('tag', tag);
    const response = await client.get<Script[]>(`/api/v1/admin/scripts?${params}`);
    return response.data;
  },
  
  get: async (id: string) => {
    const client = await getApiClient();
    const response = await client.get<Script>(`/api/v1/admin/scripts/${id}`);
    return response.data;
  },
  
  create: async (data: Partial<Script>) => {
    const client = await getApiClient();
    const response = await client.post<Script>('/api/v1/admin/scripts', data);
    return response.data;
  },
  
  update: async (id: string, data: Partial<Script>) => {
    const client = await getApiClient();
    const response = await client.patch<Script>(`/api/v1/admin/scripts/${id}`, data);
    return response.data;
  },
  
  delete: async (id: string) => {
    const client = await getApiClient();
    await client.delete(`/api/v1/admin/scripts/${id}`);
  },
  
  execute: async (scriptId: string, environmentId: string, parameters: Record<string, unknown> = {}) => {
    const client = await getApiClient();
    const response = await client.post<TaskExecution>('/api/v1/admin/scripts/execute', {
      script_id: scriptId,
      environment_id: environmentId,
      parameters,
    });
    return response.data;
  },
  
  executeStream: async (
    scriptId: string,
    environmentId: string,
    parameters: Record<string, unknown>,
    _onData: (chunk: string) => void
  ) => {
     // Fallback to regular execute for now as axios doesn't support streaming easily
     console.warn("Stream execution falling back to regular execution");
     return scriptsApi.execute(scriptId, environmentId, parameters);
  },
  
  listExecutions: async (scriptId?: string, environmentId?: string, limit = 50) => {
    const client = await getApiClient();
    const params = new URLSearchParams();
    if (scriptId) params.append('script_id', scriptId);
    if (environmentId) params.append('environment_id', environmentId);
    params.append('limit', limit.toString());
    const response = await client.get<TaskExecution[]>(`/api/v1/admin/scripts/executions?${params}`);
    return response.data;
  },
  
  getExecution: async (id: string) => {
    const client = await getApiClient();
    const response = await client.get<TaskExecution>(`/api/v1/admin/scripts/executions/${id}`);
    return response.data;
  },
  
  cancelExecution: async (id: string) => {
    const client = await getApiClient();
    await client.post(`/api/v1/admin/scripts/executions/${id}/cancel`);
  },
};

// Documents
export const documentsApi = {
  list: async (category?: string, tag?: string, environment?: string, search?: string) => {
    const client = await getApiClient();
    const params = new URLSearchParams();
    if (category) params.append('category', category);
    if (tag) params.append('tag', tag);
    if (environment) params.append('environment', environment);
    if (search) params.append('search', search);
    const response = await client.get<Document[]>(`/api/v1/admin/documents?${params}`);
    return response.data;
  },
  
  get: async (id: string) => {
    const client = await getApiClient();
    const response = await client.get<Document>(`/api/v1/admin/documents/${id}`);
    return response.data;
  },
  
  getCategories: async () => {
    const client = await getApiClient();
    const response = await client.get<Record<string, number>>('/api/v1/admin/documents/categories');
    return response.data;
  },
  
  getTags: async () => {
    const client = await getApiClient();
    const response = await client.get<Record<string, number>>('/api/v1/admin/documents/tags');
    return response.data;
  },
  
  getRelated: async (environment?: string, scriptId?: string) => {
    const client = await getApiClient();
    const params = new URLSearchParams();
    if (environment) params.append('environment', environment);
    if (scriptId) params.append('script_id', scriptId);
    const response = await client.get<Document[]>(`/api/v1/admin/documents/related?${params}`);
    return response.data;
  },
  
  refresh: async () => {
    const client = await getApiClient();
    await client.post('/api/v1/admin/documents/refresh');
  },
};

// Audit
export const auditApi = {
  list: async (filters: {
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
    const client = await getApiClient();
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
    
    const response = await client.get<AuditLog[]>(`/api/v1/admin/audit/logs?${params}`);
    return response.data;
  },
  
  get: async (id: string) => {
    const client = await getApiClient();
    const response = await client.get<AuditLog>(`/api/v1/admin/audit/logs/${id}`);
    return response.data;
  },
  
  statistics: async (startDate?: string, endDate?: string) => {
    const client = await getApiClient();
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    const response = await client.get<Record<string, unknown>>(`/api/v1/admin/audit/statistics?${params}`);
    return response.data;
  },
};

// Users (Admin)
export const usersApi = {
  list: async (activeOnly = false) => {
    const client = await getApiClient();
    const response = await client.get<User[]>(`/api/v1/admin/auth/users?active_only=${activeOnly}`);
    return response.data;
  },
  
  get: async (id: string) => {
    const client = await getApiClient();
    const response = await client.get<User>(`/api/v1/admin/auth/users/${id}`);
    return response.data;
  },
  
  create: async (data: { username: string; password: string; email?: string; role: string }) => {
    const client = await getApiClient();
    const response = await client.post<User>('/api/v1/admin/auth/users', data);
    return response.data;
  },
  
  update: async (id: string, data: { email?: string; role?: string; is_active?: boolean }) => {
    const client = await getApiClient();
    const response = await client.patch<User>(`/api/v1/admin/auth/users/${id}`, data);
    return response.data;
  },
  
  resetPassword: async (id: string, newPassword: string) => {
    const client = await getApiClient();
    await client.post(`/api/v1/admin/auth/users/${id}/reset-password`, { new_password: newPassword });
  },
  
  delete: async (id: string) => {
    const client = await getApiClient();
    await client.delete(`/api/v1/admin/auth/users/${id}`);
  },
};
