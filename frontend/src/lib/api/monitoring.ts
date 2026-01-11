import { getApiClient, createAuthenticatedEventSource, API_BASE_URL } from '../api';
import type { PageResponse } from '@/types/api';
import type {
  ServerRow,
  ServerDetail,
  ServerQuery,
  ServerSummary,
} from '@/types/monitoring';

export async function fetchServers(
  query: ServerQuery,
  page = 0,
  size = 20,
): Promise<PageResponse<ServerRow>> {
  const client = await getApiClient();
  const params: Record<string, string | number> = { page, size };
  
  if (query.status) params.status = query.status;
  if (query.env) params.env = query.env;
  if (query.keyword) params.q = query.keyword;
  if (query.rangeFrom) params.from = query.rangeFrom;
  if (query.rangeTo) params.to = query.rangeTo;
  if (query.tags?.length) params.tags = query.tags.join(',');

  const response = await client.get<PageResponse<ServerRow>>('/api/v1/monitoring/servers', { params });
  return response.data;
}

export async function fetchServerById(serverId: string): Promise<ServerDetail> {
  const client = await getApiClient();
  const response = await client.get<ServerDetail>(`/api/v1/monitoring/servers/${serverId}`);
  return response.data;
}

export async function fetchServerSummary(query?: ServerQuery): Promise<ServerSummary> {
  const client = await getApiClient();
  const params: Record<string, string> = {};
  
  if (query?.status) params.status = query.status;
  if (query?.env) params.env = query.env;
  if (query?.rangeFrom) params.from = query.rangeFrom;
  if (query?.rangeTo) params.to = query.rangeTo;

  const response = await client.get<ServerSummary>('/api/v1/monitoring/servers/summary', { params });
  return response.data;
}

export async function checkMonitoringHealth(): Promise<{
  status: string;
  features: {
    realtime: boolean;
    alerts: boolean;
    metrics: boolean;
  };
}> {
  const client = await getApiClient();
  const response = await client.get('/api/v1/monitoring/health');
  return response.data;
}

export function openMonitoringStream(): EventSource {
  const url = `${API_BASE_URL}/api/v1/monitoring/stream`;
  return createAuthenticatedEventSource(url);
}

export function openServerMetricsStream(serverId: string): EventSource {
  const url = `${API_BASE_URL}/api/v1/monitoring/servers/${serverId}/stream`;
  return createAuthenticatedEventSource(url);
}

const MOCK_SERVERS: ServerRow[] = [
  {
    id: 'srv-001',
    name: 'api-gateway-prod-1',
    hostname: 'api-gw-prod-1.newsinsight.io',
    env: 'prod',
    status: 'UP',
    cpuPct: 45,
    memPct: 62,
    diskPct: 34,
    networkInBytesPerSec: 1024000,
    networkOutBytesPerSec: 2048000,
    uptimeSeconds: 864000,
    lastCheckAt: new Date().toISOString(),
    tags: ['api', 'gateway', 'critical'],
  },
  {
    id: 'srv-002',
    name: 'data-collection-prod-1',
    hostname: 'dc-prod-1.newsinsight.io',
    env: 'prod',
    status: 'UP',
    cpuPct: 78,
    memPct: 85,
    diskPct: 45,
    networkInBytesPerSec: 5120000,
    networkOutBytesPerSec: 1024000,
    uptimeSeconds: 432000,
    lastCheckAt: new Date().toISOString(),
    tags: ['crawler', 'data', 'critical'],
  },
  {
    id: 'srv-003',
    name: 'ml-addon-prod-1',
    hostname: 'ml-prod-1.newsinsight.io',
    env: 'prod',
    status: 'DEGRADED',
    cpuPct: 92,
    memPct: 88,
    diskPct: 67,
    networkInBytesPerSec: 512000,
    networkOutBytesPerSec: 256000,
    uptimeSeconds: 172800,
    lastCheckAt: new Date().toISOString(),
    tags: ['ml', 'gpu', 'high-memory'],
  },
  {
    id: 'srv-004',
    name: 'postgres-prod-primary',
    hostname: 'db-prod-1.newsinsight.io',
    env: 'prod',
    status: 'UP',
    cpuPct: 35,
    memPct: 72,
    diskPct: 58,
    networkInBytesPerSec: 2048000,
    networkOutBytesPerSec: 4096000,
    uptimeSeconds: 2592000,
    lastCheckAt: new Date().toISOString(),
    tags: ['database', 'postgres', 'critical'],
  },
  {
    id: 'srv-005',
    name: 'redis-prod-1',
    hostname: 'redis-prod-1.newsinsight.io',
    env: 'prod',
    status: 'UP',
    cpuPct: 12,
    memPct: 45,
    diskPct: 15,
    networkInBytesPerSec: 1536000,
    networkOutBytesPerSec: 1536000,
    uptimeSeconds: 1296000,
    lastCheckAt: new Date().toISOString(),
    tags: ['cache', 'redis'],
  },
  {
    id: 'srv-006',
    name: 'kafka-prod-1',
    hostname: 'kafka-prod-1.newsinsight.io',
    env: 'prod',
    status: 'UP',
    cpuPct: 28,
    memPct: 55,
    diskPct: 42,
    networkInBytesPerSec: 8192000,
    networkOutBytesPerSec: 8192000,
    uptimeSeconds: 604800,
    lastCheckAt: new Date().toISOString(),
    tags: ['messaging', 'kafka', 'critical'],
  },
  {
    id: 'srv-007',
    name: 'api-gateway-stg-1',
    hostname: 'api-gw-stg-1.newsinsight.io',
    env: 'stg',
    status: 'UP',
    cpuPct: 15,
    memPct: 32,
    diskPct: 22,
    networkInBytesPerSec: 256000,
    networkOutBytesPerSec: 512000,
    uptimeSeconds: 259200,
    lastCheckAt: new Date().toISOString(),
    tags: ['api', 'gateway'],
  },
  {
    id: 'srv-008',
    name: 'data-collection-stg-1',
    hostname: 'dc-stg-1.newsinsight.io',
    env: 'stg',
    status: 'DOWN',
    cpuPct: 0,
    memPct: 0,
    diskPct: 45,
    networkInBytesPerSec: 0,
    networkOutBytesPerSec: 0,
    uptimeSeconds: 0,
    lastCheckAt: new Date(Date.now() - 3600000).toISOString(),
    tags: ['crawler', 'data'],
  },
];

export async function fetchServersMock(
  query: ServerQuery,
  page = 0,
  size = 20,
): Promise<PageResponse<ServerRow>> {
  await new Promise(resolve => setTimeout(resolve, 500));

  let filtered = [...MOCK_SERVERS];

  if (query.status) {
    filtered = filtered.filter(s => s.status === query.status);
  }
  if (query.env) {
    filtered = filtered.filter(s => s.env === query.env);
  }
  if (query.keyword) {
    const kw = query.keyword.toLowerCase();
    filtered = filtered.filter(s => 
      s.name.toLowerCase().includes(kw) || 
      s.hostname.toLowerCase().includes(kw) ||
      s.tags?.some(t => t.toLowerCase().includes(kw))
    );
  }

  const start = page * size;
  const content = filtered.slice(start, start + size);

  return {
    content,
    totalElements: filtered.length,
    totalPages: Math.ceil(filtered.length / size),
    size,
    number: page,
    first: page === 0,
    last: start + size >= filtered.length,
  };
}

export async function fetchServerSummaryMock(query?: ServerQuery): Promise<ServerSummary> {
  await new Promise(resolve => setTimeout(resolve, 300));

  let filtered = [...MOCK_SERVERS];
  if (query?.status) filtered = filtered.filter(s => s.status === query.status);
  if (query?.env) filtered = filtered.filter(s => s.env === query.env);

  const up = filtered.filter(s => s.status === 'UP').length;
  const down = filtered.filter(s => s.status === 'DOWN').length;
  const degraded = filtered.filter(s => s.status === 'DEGRADED').length;
  const avgCpu = filtered.length ? Math.round(filtered.reduce((a, b) => a + b.cpuPct, 0) / filtered.length) : 0;
  const avgMem = filtered.length ? Math.round(filtered.reduce((a, b) => a + b.memPct, 0) / filtered.length) : 0;
  const avgDisk = filtered.length ? Math.round(filtered.reduce((a, b) => a + b.diskPct, 0) / filtered.length) : 0;

  return {
    total: filtered.length,
    up,
    down,
    degraded,
    avgCpu,
    avgMem,
    avgDisk,
    alertCount: degraded + down,
  };
}

export async function fetchServerByIdMock(serverId: string): Promise<ServerDetail> {
  await new Promise(resolve => setTimeout(resolve, 400));

  const server = MOCK_SERVERS.find(s => s.id === serverId);
  if (!server) throw new Error(`Server not found: ${serverId}`);

  return {
    ...server,
    ipAddress: '10.0.0.' + Math.floor(Math.random() * 255),
    osInfo: 'Ubuntu 22.04 LTS',
    cpuCores: 8,
    totalMemoryBytes: 34359738368,
    usedMemoryBytes: Math.floor(34359738368 * server.memPct / 100),
    totalDiskBytes: 107374182400,
    usedDiskBytes: Math.floor(107374182400 * server.diskPct / 100),
    processes: Math.floor(Math.random() * 200) + 50,
    loadAvg1m: server.cpuPct / 100 * 4,
    loadAvg5m: server.cpuPct / 100 * 3.5,
    loadAvg15m: server.cpuPct / 100 * 3,
    services: [
      { name: 'nginx', status: 'running', port: 80, pid: 1234, uptime: 86400 },
      { name: 'java', status: 'running', port: 8080, pid: 2345, uptime: 86400 },
      { name: 'node', status: server.status === 'DOWN' ? 'stopped' : 'running', port: 3000, pid: 3456 },
    ],
    recentAlerts: server.status !== 'UP' ? [
      {
        id: 'alert-1',
        severity: server.status === 'DOWN' ? 'critical' : 'warning',
        message: server.status === 'DOWN' ? 'Server is not responding' : 'High resource utilization detected',
        timestamp: new Date().toISOString(),
        acknowledged: false,
      },
    ] : [],
  };
}
