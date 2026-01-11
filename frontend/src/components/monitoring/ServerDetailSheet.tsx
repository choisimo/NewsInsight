import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Server,
  Cpu,
  HardDrive,
  MemoryStick,
  Activity,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Network,
  Layers,
} from 'lucide-react';
import type { ServerDetail, ServerStatus, ServiceStatus, ServerAlert } from '@/types/monitoring';
import { cn } from '@/lib/utils';

interface ServerDetailSheetProps {
  server: ServerDetail | null;
  isOpen: boolean;
  onClose: () => void;
  isLoading?: boolean;
}

function formatUptime(seconds: number): string {
  if (seconds === 0) return '-';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}일`);
  if (hours > 0) parts.push(`${hours}시간`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}분`);
  
  return parts.join(' ') || '1분 미만';
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatBytesPerSec(bytesPerSec: number): string {
  return formatBytes(bytesPerSec) + '/s';
}

function getStatusColor(status: ServerStatus): string {
  switch (status) {
    case 'UP': return 'bg-green-500';
    case 'DOWN': return 'bg-red-500';
    case 'DEGRADED': return 'bg-yellow-500';
    default: return 'bg-gray-500';
  }
}

function getStatusBadgeVariant(status: ServerStatus): 'default' | 'destructive' | 'secondary' | 'outline' {
  switch (status) {
    case 'UP': return 'default';
    case 'DOWN': return 'destructive';
    case 'DEGRADED': return 'secondary';
    default: return 'outline';
  }
}

function getServiceStatusIcon(status: ServiceStatus['status']) {
  switch (status) {
    case 'running': return <CheckCircle className="h-4 w-4 text-green-500" />;
    case 'stopped': return <XCircle className="h-4 w-4 text-gray-400" />;
    case 'error': return <AlertTriangle className="h-4 w-4 text-red-500" />;
  }
}

function getAlertSeverityColor(severity: ServerAlert['severity']): string {
  switch (severity) {
    case 'critical': return 'bg-red-100 border-red-300 text-red-800';
    case 'error': return 'bg-red-50 border-red-200 text-red-700';
    case 'warning': return 'bg-yellow-50 border-yellow-200 text-yellow-700';
    case 'info': return 'bg-blue-50 border-blue-200 text-blue-700';
  }
}

function MetricCard({ 
  icon: Icon, 
  label, 
  value, 
  percent, 
  description 
}: { 
  icon: React.ElementType; 
  label: string; 
  value: string; 
  percent?: number; 
  description?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {percent !== undefined && (
          <Progress value={percent} className="mt-2 h-2" />
        )}
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

function MetricsTab({ server }: { server: ServerDetail }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <MetricCard
          icon={Cpu}
          label="CPU"
          value={`${server.cpuPct}%`}
          percent={server.cpuPct}
          description={server.cpuCores ? `${server.cpuCores} cores` : undefined}
        />
        <MetricCard
          icon={MemoryStick}
          label="Memory"
          value={`${server.memPct}%`}
          percent={server.memPct}
          description={server.totalMemoryBytes ? formatBytes(server.totalMemoryBytes) : undefined}
        />
        <MetricCard
          icon={HardDrive}
          label="Disk"
          value={`${server.diskPct}%`}
          percent={server.diskPct}
          description={server.totalDiskBytes ? formatBytes(server.totalDiskBytes) : undefined}
        />
        <MetricCard
          icon={Clock}
          label="Uptime"
          value={formatUptime(server.uptimeSeconds)}
        />
      </div>

      {server.loadAvg1m !== undefined && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Load Average</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">1m:</span>{' '}
                <span className="font-medium">{server.loadAvg1m?.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">5m:</span>{' '}
                <span className="font-medium">{server.loadAvg5m?.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">15m:</span>{' '}
                <span className="font-medium">{server.loadAvg15m?.toFixed(2)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Network className="h-4 w-4" />
            Network
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between text-sm">
            <div>
              <span className="text-muted-foreground">In:</span>{' '}
              <span className="font-medium">{formatBytesPerSec(server.networkInBytesPerSec)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Out:</span>{' '}
              <span className="font-medium">{formatBytesPerSec(server.networkOutBytesPerSec)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ServicesTab({ server }: { server: ServerDetail }) {
  if (!server.services || server.services.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        서비스 정보 없음
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {server.services.map((service, index) => (
        <Card key={index}>
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {getServiceStatusIcon(service.status)}
                <div>
                  <div className="font-medium">{service.name}</div>
                  {service.port && (
                    <div className="text-xs text-muted-foreground">
                      Port: {service.port}
                      {service.pid && ` · PID: ${service.pid}`}
                    </div>
                  )}
                </div>
              </div>
              <Badge variant={service.status === 'running' ? 'default' : 'secondary'}>
                {service.status}
              </Badge>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AlertsTab({ server }: { server: ServerDetail }) {
  if (!server.recentAlerts || server.recentAlerts.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
        최근 알림 없음
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {server.recentAlerts.map((alert) => (
        <Alert key={alert.id} className={cn('border', getAlertSeverityColor(alert.severity))}>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="flex justify-between items-start">
              <div>
                <div className="font-medium">{alert.message}</div>
                <div className="text-xs mt-1">
                  {new Date(alert.timestamp).toLocaleString('ko-KR')}
                </div>
              </div>
              <Badge variant="outline" className="text-xs">
                {alert.severity}
              </Badge>
            </div>
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}

function SheetSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    </div>
  );
}

export function ServerDetailSheet({ server, isOpen, onClose, isLoading }: ServerDetailSheetProps) {
  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-hidden flex flex-col">
        {isLoading ? (
          <SheetSkeleton />
        ) : server ? (
          <>
            <SheetHeader>
              <div className="flex items-center gap-3">
                <div className={cn('w-3 h-3 rounded-full', getStatusColor(server.status))} />
                <SheetTitle className="flex items-center gap-2">
                  <Server className="h-5 w-5" />
                  {server.name}
                </SheetTitle>
              </div>
              <SheetDescription className="text-left">
                <div className="space-y-1 mt-2">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Hostname:</span>
                    <span className="font-mono text-xs">{server.hostname}</span>
                  </div>
                  {server.ipAddress && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">IP:</span>
                      <span className="font-mono text-xs">{server.ipAddress}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Badge variant={getStatusBadgeVariant(server.status)}>
                      {server.status}
                    </Badge>
                    <Badge variant="outline">{server.env.toUpperCase()}</Badge>
                  </div>
                  {server.osInfo && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {server.osInfo}
                    </div>
                  )}
                </div>
              </SheetDescription>
            </SheetHeader>

            <Tabs defaultValue="metrics" className="flex-1 flex flex-col mt-4">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="metrics" className="text-xs">
                  <Activity className="h-3 w-3 mr-1" />
                  Metrics
                </TabsTrigger>
                <TabsTrigger value="services" className="text-xs">
                  <Layers className="h-3 w-3 mr-1" />
                  Services
                </TabsTrigger>
                <TabsTrigger value="alerts" className="text-xs">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Alerts
                  {server.recentAlerts && server.recentAlerts.length > 0 && (
                    <Badge variant="destructive" className="ml-1 h-4 px-1 text-[10px]">
                      {server.recentAlerts.length}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>
              
              <ScrollArea className="flex-1 mt-4">
                <TabsContent value="metrics" className="m-0">
                  <MetricsTab server={server} />
                </TabsContent>
                <TabsContent value="services" className="m-0">
                  <ServicesTab server={server} />
                </TabsContent>
                <TabsContent value="alerts" className="m-0">
                  <AlertsTab server={server} />
                </TabsContent>
              </ScrollArea>
            </Tabs>

            <div className="text-xs text-muted-foreground text-center pt-4 border-t mt-4">
              마지막 체크: {new Date(server.lastCheckAt).toLocaleString('ko-KR')}
            </div>
          </>
        ) : (
          <div className="text-center text-muted-foreground py-8">
            서버 정보를 불러올 수 없습니다.
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default ServerDetailSheet;
