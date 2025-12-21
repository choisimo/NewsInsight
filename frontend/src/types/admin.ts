export type EnvironmentType = 'zerotrust' | 'local' | 'gcp' | 'aws' | 'production' | 'staging';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type TaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
export type UserRole = 'user' | 'viewer' | 'operator' | 'admin';
export type ServiceStatus = 'up' | 'down' | 'starting' | 'stopping' | 'unknown';
export type DocumentCategory = 'deployment' | 'troubleshooting' | 'architecture' | 'runbook' | 'general';
export type AuditAction = 'login' | 'logout' | 'view' | 'create' | 'update' | 'delete' | 'execute' | 'deploy' | 'rollback';

export interface Environment {
  id: string;
  name: string;
  env_type: EnvironmentType;
  description?: string;
  compose_file: string;
  env_file?: string;
  is_active: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface ContainerInfo {
  name: string;
  image: string;
  status: ServiceStatus;
  health?: string;
  ports: string[];
  created_at?: string;
  started_at?: string;
}

export interface EnvironmentStatus {
  environment_id: string;
  environment_name: string;
  containers: ContainerInfo[];
  total_containers: number;
  running_containers: number;
  last_deployment?: string;
  deployed_by?: string;
}

export interface ScriptParameter {
  name: string;
  param_type: string;
  required: boolean;
  default?: unknown;
  description?: string;
}

export interface Script {
  id: string;
  name: string;
  description?: string;
  command: string;
  working_dir?: string;
  risk_level: RiskLevel;
  estimated_duration?: number;
  allowed_environments: string[];
  required_role: UserRole;
  parameters: ScriptParameter[];
  pre_hooks: string[];
  post_hooks: string[];
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface TaskExecution {
  id: string;
  script_id: string;
  script_name: string;
  environment_id: string;
  environment_name: string;
  status: TaskStatus;
  parameters: Record<string, unknown>;
  started_at: string;
  finished_at?: string;
  executed_by: string;
  exit_code?: number;
  error_message?: string;
}

export interface Document {
  id: string;
  title: string;
  file_path: string;
  category: DocumentCategory;
  tags: string[];
  related_environments: string[];
  related_scripts: string[];
  content?: string;
  last_modified: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  username: string;
  action: AuditAction;
  resource_type: string;
  resource_id?: string;
  resource_name?: string;
  environment_id?: string;
  environment_name?: string;
  details: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
  timestamp: string;
  success: boolean;
  error_message?: string;
}

export interface User {
  id: string;
  username: string;
  email?: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  last_login?: string;
  password_change_required?: boolean;
}

export interface SetupStatus {
  setup_required: boolean;
  has_users: boolean;
  is_default_admin: boolean;
}

export interface Token {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface HealthCheck {
  status: string;
  version: string;
  timestamp: string;
}
