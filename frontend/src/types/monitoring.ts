export type ServerStatus = 'UP' | 'DOWN' | 'DEGRADED' | 'UNKNOWN';

export type ServerEnvironment = 'prod' | 'stg' | 'dev' | 'local';

export interface ServerRow {
  id: string;
  name: string;
  hostname: string;
  env: ServerEnvironment;
  status: ServerStatus;
  cpuPct: number;
  memPct: number;
  diskPct: number;
  networkInBytesPerSec: number;
  networkOutBytesPerSec: number;
  uptimeSeconds: number;
  lastCheckAt: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ServerDetail extends ServerRow {
  ipAddress?: string;
  osInfo?: string;
  cpuCores?: number;
  totalMemoryBytes?: number;
  usedMemoryBytes?: number;
  totalDiskBytes?: number;
  usedDiskBytes?: number;
  processes?: number;
  loadAvg1m?: number;
  loadAvg5m?: number;
  loadAvg15m?: number;
  services?: ServiceStatus[];
  recentAlerts?: ServerAlert[];
  metrics?: MetricHistory;
}

export interface ServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'error';
  port?: number;
  pid?: number;
  uptime?: number;
  memoryUsage?: number;
  cpuUsage?: number;
}

export interface ServerAlert {
  id: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  timestamp: string;
  acknowledged?: boolean;
}

export interface MetricHistory {
  timestamps: string[];
  cpu: number[];
  memory: number[];
  disk: number[];
  networkIn: number[];
  networkOut: number[];
}

export interface ServerQuery {
  status?: ServerStatus;
  env?: ServerEnvironment;
  keyword?: string;
  tags?: string[];
  rangeFrom?: string;
  rangeTo?: string;
}

export interface ServerSummary {
  total: number;
  up: number;
  down: number;
  degraded: number;
  avgCpu: number;
  avgMem: number;
  avgDisk: number;
  alertCount: number;
}

export type MonitoringEventType = 
  | 'server_status'
  | 'metric_update'
  | 'alert'
  | 'heartbeat'
  | 'connection_status';

export interface MonitoringEvent {
  eventType: MonitoringEventType;
  timestamp: string;
  serverId?: string;
  data?: ServerRow | ServerAlert | ServerSummary;
  message?: string;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
