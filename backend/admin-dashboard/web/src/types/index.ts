// Admin Dashboard Types

export type EnvironmentType = 'zerotrust' | 'local' | 'gcp' | 'aws' | 'production' | 'staging';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type TaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
export type UserRole = 'viewer' | 'operator' | 'admin';
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

// Service Health Monitoring Types
export type ServiceHealthStatus = 'healthy' | 'unhealthy' | 'degraded' | 'unreachable' | 'unknown';

export interface ServiceHealth {
  service_id: string;
  name: string;
  status: ServiceHealthStatus;
  message?: string;
  response_time_ms?: number;
  url?: string;
  checked_at: string;
  details?: Record<string, unknown>;
}

export interface InfrastructureHealth {
  service_id: string;
  name: string;
  status: ServiceHealthStatus;
  message?: string;
  port?: number;
  checked_at: string;
  details?: Record<string, unknown>;
}

export interface OverallSystemHealth {
  status: ServiceHealthStatus;
  total_services: number;
  healthy_services: number;
  unhealthy_services: number;
  degraded_services: number;
  total_infrastructure: number;
  healthy_infrastructure: number;
  average_response_time_ms?: number;
  services: ServiceHealth[];
  infrastructure: InfrastructureHealth[];
  checked_at: string;
}

export interface ServiceInfo {
  id: string;
  name: string;
  description?: string;
  port?: number;
  healthcheck: string;
  hostname: string;
  type: string;
  tags: string[];
}

// Data Source Types
export type DataSourceType = 'rss' | 'web' | 'api' | 'social';
export type DataSourceStatus = 'active' | 'inactive' | 'error' | 'testing';

export interface DataSource {
  id: string;
  name: string;
  source_type: DataSourceType;
  url: string;
  description?: string;
  category?: string;
  language: string;
  is_active: boolean;
  crawl_interval_minutes: number;
  priority: number;
  config: Record<string, unknown>;
  status: DataSourceStatus;
  last_crawled_at?: string;
  total_articles: number;
  success_rate: number;
  created_at: string;
  updated_at: string;
}

export interface DataSourceTestResult {
  source_id: string;
  success: boolean;
  message: string;
  response_time_ms?: number;
  sample_data?: Record<string, unknown>;
  tested_at: string;
}

// Database Types
export type DatabaseType = 'postgresql' | 'mongodb' | 'redis';

export interface DatabaseInfo {
  db_type: DatabaseType;
  name: string;
  host: string;
  port: number;
  status: ServiceHealthStatus;
  version?: string;
  size_bytes?: number;
  size_human?: string;
  connection_count?: number;
  max_connections?: number;
  uptime_seconds?: number;
  checked_at: string;
}

export interface PostgresTableInfo {
  schema_name: string;
  table_name: string;
  row_count: number;
  size_bytes: number;
  size_human: string;
  index_size_bytes?: number;
  last_vacuum?: string;
  last_analyze?: string;
}

export interface PostgresDatabaseStats {
  database_name: string;
  size_bytes: number;
  size_human: string;
  tables: PostgresTableInfo[];
  total_tables: number;
  total_rows: number;
  connection_count: number;
  max_connections: number;
  checked_at: string;
}

export interface MongoCollectionInfo {
  collection_name: string;
  document_count: number;
  size_bytes: number;
  size_human: string;
  avg_document_size_bytes?: number;
  index_count: number;
  total_index_size_bytes?: number;
}

export interface MongoDatabaseStats {
  database_name: string;
  size_bytes: number;
  size_human: string;
  collections: MongoCollectionInfo[];
  total_collections: number;
  total_documents: number;
  checked_at: string;
}

export interface RedisStats {
  used_memory_bytes: number;
  used_memory_human: string;
  max_memory_bytes?: number;
  connected_clients: number;
  total_keys: number;
  expired_keys: number;
  keyspace_hits: number;
  keyspace_misses: number;
  hit_rate: number;
  uptime_seconds: number;
  checked_at: string;
}

// Kafka Types
export interface KafkaTopicInfo {
  name: string;
  partition_count: number;
  replication_factor: number;
  message_count?: number;
  size_bytes?: number;
  retention_ms?: number;
  is_internal: boolean;
}

export interface KafkaConsumerGroupInfo {
  group_id: string;
  state: string;
  members_count: number;
  topics: string[];
  total_lag: number;
  lag_per_partition: Record<string, number>;
}

export interface KafkaClusterInfo {
  broker_count: number;
  controller_id?: number;
  cluster_id?: string;
  topics: KafkaTopicInfo[];
  consumer_groups: KafkaConsumerGroupInfo[];
  total_topics: number;
  total_partitions: number;
  total_messages?: number;
  checked_at: string;
}
