import { useEffect } from 'react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import {
  Server,
  Search,
  RefreshCcw,
  Wifi,
  WifiOff,
  ArrowUpCircle,
  ArrowDownCircle,
  AlertTriangle,
  Cpu,
  MemoryStick,
  HardDrive,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { useServerMonitoring } from '@/hooks/useServerMonitoring';
import { ServerDetailSheet } from '@/components/monitoring/ServerDetailSheet';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import type { ServerStatus, ServerEnvironment, ServerRow } from '@/types/monitoring';
import { cn } from '@/lib/utils';

function formatUptime(seconds: number): string {
  if (seconds === 0) return '-';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function getStatusColor(status: ServerStatus): string {
  switch (status) {
    case 'UP': return 'bg-green-500';
    case 'DOWN': return 'bg-red-500';
    case 'DEGRADED': return 'bg-yellow-500';
    default: return 'bg-gray-400';
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

function getEnvBadgeColor(env: ServerEnvironment): string {
  switch (env) {
    case 'prod': return 'bg-red-100 text-red-800 border-red-200';
    case 'stg': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'dev': return 'bg-blue-100 text-blue-800 border-blue-200';
    default: return 'bg-gray-100 text-gray-800 border-gray-200';
  }
}

function SummaryCard({
  title,
  value,
  icon: Icon,
  iconColor,
  subtitle,
  loading,
}: {
  title: string;
  value: number | string;
  icon: React.ElementType;
  iconColor: string;
  subtitle?: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className={cn('h-4 w-4', iconColor)} />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <>
            <div className="text-2xl font-bold">{value}</div>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ServerTableRow({ 
  server, 
  onClick 
}: { 
  server: ServerRow; 
  onClick: () => void;
}) {
  return (
    <TableRow 
      className="cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={onClick}
    >
      <TableCell>
        <div className="flex items-center gap-2">
          <div className={cn('w-2 h-2 rounded-full', getStatusColor(server.status))} />
          <Badge variant={getStatusBadgeVariant(server.status)} className="text-xs">
            {server.status}
          </Badge>
        </div>
      </TableCell>
      <TableCell>
        <div>
          <div className="font-medium">{server.name}</div>
          <div className="text-xs text-muted-foreground font-mono">{server.hostname}</div>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={cn('text-xs', getEnvBadgeColor(server.env))}>
          {server.env.toUpperCase()}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Progress value={server.cpuPct} className="w-16 h-2" />
          <span className="text-xs w-10">{server.cpuPct}%</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Progress value={server.memPct} className="w-16 h-2" />
          <span className="text-xs w-10">{server.memPct}%</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Progress value={server.diskPct} className="w-16 h-2" />
          <span className="text-xs w-10">{server.diskPct}%</span>
        </div>
      </TableCell>
      <TableCell className="text-xs">{formatUptime(server.uptimeSeconds)}</TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {new Date(server.lastCheckAt).toLocaleTimeString('ko-KR')}
      </TableCell>
    </TableRow>
  );
}

function TableSkeleton() {
  return (
    <>
      {[1, 2, 3, 4, 5].map((i) => (
        <TableRow key={i}>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

export default function ServerMonitoring() {
  const {
    query,
    setQuery,
    page,
    setPage,
    pageSize,
    servers,
    totalElements,
    totalPages,
    isLoadingServers,
    summary,
    isLoadingSummary,
    selectedServerId,
    setSelectedServerId,
    selectedServer,
    isLoadingDetail,
    connectionStatus,
    lastUpdated,
    autoRefreshEnabled,
    setAutoRefreshEnabled,
    search,
    refresh,
    error,
  } = useServerMonitoring({
    pageSize: 20,
    autoRefreshInterval: 30000,
    useStream: false,
  });

  useEffect(() => {
    search();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStatusChange = (value: string) => {
    setQuery({ ...query, status: value === 'all' ? undefined : value as ServerStatus });
  };

  const handleEnvChange = (value: string) => {
    setQuery({ ...query, env: value === 'all' ? undefined : value as ServerEnvironment });
  };

  const handleKeywordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery({ ...query, keyword: e.target.value || undefined });
  };

  const handleDateRangeChange = (range: DateRange | undefined) => {
    setQuery({
      ...query,
      rangeFrom: range?.from ? format(range.from, 'yyyy-MM-dd') : undefined,
      rangeTo: range?.to ? format(range.to, 'yyyy-MM-dd') : undefined,
    });
  };

  const handleSearch = () => {
    search();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleRowClick = (server: ServerRow) => {
    setSelectedServerId(server.id);
  };

  const handleCloseDetail = () => {
    setSelectedServerId(null);
  };

  const dateRange: DateRange | undefined = query.rangeFrom || query.rangeTo
    ? {
        from: query.rangeFrom ? new Date(query.rangeFrom) : undefined,
        to: query.rangeTo ? new Date(query.rangeTo) : undefined,
      }
    : undefined;

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Server className="h-6 w-6 text-primary" />
            서버 모니터링
          </h1>
          <div className="text-muted-foreground text-sm flex items-center gap-2 mt-1">
            {lastUpdated && (
              <span>
                마지막 업데이트: {lastUpdated.toLocaleTimeString('ko-KR')}
              </span>
            )}
            <Badge
              variant="outline"
              className={cn(
                'ml-2',
                connectionStatus === 'connected'
                  ? 'bg-green-50 text-green-600 border-green-200'
                  : 'bg-gray-50 text-gray-600 border-gray-200'
              )}
            >
              {connectionStatus === 'connected' ? (
                <>
                  <Wifi className="h-3 w-3 mr-1" />
                  자동 갱신
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3 mr-1" />
                  수동 모드
                </>
              )}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="auto-refresh"
              checked={autoRefreshEnabled}
              onCheckedChange={setAutoRefreshEnabled}
            />
            <Label htmlFor="auto-refresh" className="text-sm">
              자동 갱신
            </Label>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={isLoadingServers}>
            {isLoadingServers ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="h-4 w-4" />
            )}
            <span className="ml-2">새로고침</span>
          </Button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            데이터를 불러오는 중 오류가 발생했습니다: {error.message}
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <SummaryCard
          title="전체 서버"
          value={summary?.total ?? 0}
          icon={Server}
          iconColor="text-blue-500"
          loading={isLoadingSummary}
        />
        <SummaryCard
          title="정상 (UP)"
          value={summary?.up ?? 0}
          icon={ArrowUpCircle}
          iconColor="text-green-500"
          loading={isLoadingSummary}
        />
        <SummaryCard
          title="장애 (DOWN)"
          value={summary?.down ?? 0}
          icon={ArrowDownCircle}
          iconColor="text-red-500"
          loading={isLoadingSummary}
        />
        <SummaryCard
          title="경고 (DEGRADED)"
          value={summary?.degraded ?? 0}
          icon={AlertTriangle}
          iconColor="text-yellow-500"
          loading={isLoadingSummary}
        />
        <SummaryCard
          title="평균 리소스"
          value={`${summary?.avgCpu ?? 0}%`}
          icon={Cpu}
          iconColor="text-purple-500"
          subtitle={`MEM ${summary?.avgMem ?? 0}% · DISK ${summary?.avgDisk ?? 0}%`}
          loading={isLoadingSummary}
        />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-4 md:grid-cols-5">
            <div className="space-y-2">
              <Label htmlFor="status">상태</Label>
              <Select value={query.status ?? 'all'} onValueChange={handleStatusChange}>
                <SelectTrigger id="status">
                  <SelectValue placeholder="전체" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체</SelectItem>
                  <SelectItem value="UP">UP</SelectItem>
                  <SelectItem value="DOWN">DOWN</SelectItem>
                  <SelectItem value="DEGRADED">DEGRADED</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="env">환경</Label>
              <Select value={query.env ?? 'all'} onValueChange={handleEnvChange}>
                <SelectTrigger id="env">
                  <SelectValue placeholder="전체" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체</SelectItem>
                  <SelectItem value="prod">Production</SelectItem>
                  <SelectItem value="stg">Staging</SelectItem>
                  <SelectItem value="dev">Development</SelectItem>
                  <SelectItem value="local">Local</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="keyword">검색어</Label>
              <Input
                id="keyword"
                placeholder="서버명, 호스트명..."
                value={query.keyword ?? ''}
                onChange={handleKeywordChange}
                onKeyPress={handleKeyPress}
              />
            </div>
            <div className="space-y-2">
              <Label>기간</Label>
              <DateRangePicker
                value={dateRange}
                onChange={handleDateRangeChange}
                placeholder="기간 선택"
              />
            </div>
            <div className="flex items-end">
              <Button onClick={handleSearch} className="w-full" disabled={isLoadingServers}>
                {isLoadingServers ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Search className="h-4 w-4 mr-2" />
                )}
                조회
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Server Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">서버 목록</CardTitle>
            <span className="text-sm text-muted-foreground">
              총 {totalElements}개
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">상태</TableHead>
                  <TableHead>서버</TableHead>
                  <TableHead className="w-24">환경</TableHead>
                  <TableHead className="w-28">
                    <div className="flex items-center gap-1">
                      <Cpu className="h-3 w-3" /> CPU
                    </div>
                  </TableHead>
                  <TableHead className="w-28">
                    <div className="flex items-center gap-1">
                      <MemoryStick className="h-3 w-3" /> MEM
                    </div>
                  </TableHead>
                  <TableHead className="w-28">
                    <div className="flex items-center gap-1">
                      <HardDrive className="h-3 w-3" /> DISK
                    </div>
                  </TableHead>
                  <TableHead className="w-24">Uptime</TableHead>
                  <TableHead className="w-24">Last Check</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingServers ? (
                  <TableSkeleton />
                ) : servers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                      검색 결과가 없습니다.
                    </TableCell>
                  </TableRow>
                ) : (
                  servers.map((server) => (
                    <ServerTableRow
                      key={server.id}
                      server={server}
                      onClick={() => handleRowClick(server)}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-muted-foreground">
                {page * pageSize + 1} - {Math.min((page + 1) * pageSize, totalElements)} / {totalElements}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page - 1)}
                  disabled={page === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm">
                  {page + 1} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page + 1)}
                  disabled={page >= totalPages - 1}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Server Detail Sheet */}
      <ServerDetailSheet
        server={selectedServer}
        isOpen={!!selectedServerId}
        onClose={handleCloseDetail}
        isLoading={isLoadingDetail}
      />
    </div>
  );
}
