import { useEffect, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  RefreshCw,
  Play,
  Database,
  Activity,
  Settings2,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  FileText,
  Trash2,
} from 'lucide-react';
import { SourceCard, type SourceInfo } from '@/components/admin/SourceCard';
import { JobStatusBadge } from '@/components/admin/JobStatusBadge';
import { LiveCounter } from '@/components/admin/LiveCounter';
import { LiveStream } from '@/components/admin/LiveStream';
import { useDashboardEvents } from '@/hooks/useDashboardEvents';
import {
  listCollectionJobs,
  getCollectionStats,
  startCollectionForAllSources,
  cleanupOldJobs,
  type CollectionJobDTO,
  type CollectionStatsDTO,
} from '@/lib/api/collection';
import {
  listUnprocessedData,
  markDataAsProcessed,
  type CollectedDataDTO,
} from '@/lib/api/data';
import { listSources, setSourceActive } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

function formatDateTime(dateString: string | null): string {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleString('ko-KR');
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '-';
  const diff = new Date(end).getTime() - new Date(start).getTime();
  if (diff < 1000) return `${diff}ms`;
  if (diff < 60000) return `${(diff / 1000).toFixed(1)}초`;
  return `${(diff / 60000).toFixed(1)}분`;
}

export default function Operations() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('sources');

  // 실시간 이벤트 스트림
  const { activityLogs, status: streamStatus, clearLogs } = useDashboardEvents({
    maxActivityLogs: 30,
  });

  // 소스 목록 조회
  const { data: sourcesData, isLoading: sourcesLoading } = useQuery({
    queryKey: ['sources'],
    queryFn: () => listSources(0, 100),
    refetchInterval: 30000,
  });

  // 수집 통계 조회
  const { data: collectionStats } = useQuery({
    queryKey: ['collectionStats'],
    queryFn: getCollectionStats,
    refetchInterval: 10000,
  });

  // 작업 목록 조회
  const { data: jobsData, isLoading: jobsLoading } = useQuery({
    queryKey: ['collectionJobs'],
    queryFn: () => listCollectionJobs(0, 50),
    refetchInterval: 5000,
  });

  // 미처리 데이터 조회
  const { data: unprocessedData, isLoading: unprocessedLoading } = useQuery({
    queryKey: ['unprocessedData'],
    queryFn: () => listUnprocessedData(0, 20),
    refetchInterval: 10000,
  });

  // 전체 수집 시작
  const startAllMutation = useMutation({
    mutationFn: startCollectionForAllSources,
    onSuccess: (data) => {
      toast.success(`${data.totalJobsStarted}개 소스 수집 시작`);
      queryClient.invalidateQueries({ queryKey: ['collectionJobs'] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : '수집 시작 실패');
    },
  });

  // 소스 활성화/비활성화
  const toggleSourceMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      setSourceActive(id, active),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
  });

  // 데이터 처리 완료 표시
  const markProcessedMutation = useMutation({
    mutationFn: markDataAsProcessed,
    onSuccess: () => {
      toast.success('처리 완료로 표시됨');
      queryClient.invalidateQueries({ queryKey: ['unprocessedData'] });
    },
  });

  // 오래된 작업 정리
  const cleanupMutation = useMutation({
    mutationFn: () => cleanupOldJobs(30),
    onSuccess: (message) => {
      toast.success(message);
      queryClient.invalidateQueries({ queryKey: ['collectionJobs'] });
    },
  });

  const handleToggleSource = useCallback(async (id: number, active: boolean) => {
    await toggleSourceMutation.mutateAsync({ id, active });
  }, [toggleSourceMutation]);

  // 소스 데이터를 SourceInfo 형식으로 변환
  const sources: SourceInfo[] = (sourcesData?.content || []).map((s) => ({
    id: s.id,
    name: s.name,
    url: s.url,
    sourceType: s.sourceType,
    active: s.active,
    lastCollectedAt: s.lastCollectedAt,
    lastError: s.lastError,
    itemsCollectedToday: s.itemsCollectedToday,
    totalItemsCollected: s.totalItemsCollected,
  }));

  const runningJobs = jobsData?.content.filter((j) => j.status === 'RUNNING') || [];
  const isAnyRunning = runningJobs.length > 0;

  return (
    <div className="container py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Settings2 className="h-6 w-6 text-primary" />
            운영 관리
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            데이터 수집 및 처리 상태를 모니터링하고 제어합니다
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => cleanupMutation.mutate()}
            disabled={cleanupMutation.isPending}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            오래된 작업 정리
          </Button>
          <Button
            size="sm"
            onClick={() => startAllMutation.mutate()}
            disabled={startAllMutation.isPending || isAnyRunning}
          >
            {startAllMutation.isPending || isAnyRunning ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            전체 수집 시작
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <LiveCounter
          value={collectionStats?.totalSources ?? 0}
          label="전체 소스"
          icon={<Database className="h-4 w-4" />}
          subtitle={`${collectionStats?.activeSources ?? 0}개 활성`}
          showChange={false}
        />
        <LiveCounter
          value={collectionStats?.totalItemsCollected ?? 0}
          label="총 수집량"
          icon={<FileText className="h-4 w-4" />}
          showChange={false}
        />
        <LiveCounter
          value={collectionStats?.itemsCollectedToday ?? 0}
          label="오늘 수집"
          icon={<Activity className="h-4 w-4" />}
          showChange={false}
        />
        <LiveCounter
          value={unprocessedData?.totalElements ?? 0}
          label="대기 중"
          icon={<Clock className="h-4 w-4" />}
          subtitle="처리 대기열"
          showChange={false}
        />
      </div>

      {/* Main Content */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Tabs Content */}
        <div className="lg:col-span-2">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="sources">
                소스 관리
                <Badge variant="secondary" className="ml-2">
                  {sources.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="jobs">
                작업 내역
                {isAnyRunning && (
                  <Badge className="ml-2 bg-blue-500">
                    {runningJobs.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="queue">
                대기열
                {(unprocessedData?.totalElements ?? 0) > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {unprocessedData?.totalElements}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {/* Sources Tab */}
            <TabsContent value="sources" className="mt-4">
              {sourcesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : sources.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  등록된 소스가 없습니다
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {sources.map((source) => (
                    <SourceCard
                      key={source.id}
                      source={source}
                      isCollecting={runningJobs.some((j) => j.sourceId === source.id)}
                      onToggleActive={handleToggleSource}
                      onCollectionComplete={() =>
                        queryClient.invalidateQueries({ queryKey: ['collectionJobs'] })
                      }
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Jobs Tab */}
            <TabsContent value="jobs" className="mt-4">
              <ScrollArea className="h-[500px]">
                {jobsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (jobsData?.content.length ?? 0) === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    수집 작업 내역이 없습니다
                  </div>
                ) : (
                  <div className="space-y-2">
                    {jobsData?.content.map((job) => (
                      <JobRow key={job.id} job={job} sources={sources} />
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            {/* Queue Tab */}
            <TabsContent value="queue" className="mt-4">
              <ScrollArea className="h-[500px]">
                {unprocessedLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (unprocessedData?.content.length ?? 0) === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    처리 대기 중인 데이터가 없습니다
                  </div>
                ) : (
                  <div className="space-y-2">
                    {unprocessedData?.content.map((data) => (
                      <QueueItem
                        key={data.id}
                        data={data}
                        onMarkProcessed={() => markProcessedMutation.mutate(data.id)}
                        isProcessing={markProcessedMutation.isPending}
                      />
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right: Live Stream */}
        <div className="lg:col-span-1">
          <LiveStream
            logs={activityLogs}
            status={streamStatus}
            maxVisible={20}
            title="실시간 활동"
            onClear={clearLogs}
            className="h-[600px]"
          />
        </div>
      </div>
    </div>
  );
}

// Job Row Component
function JobRow({ job, sources }: { job: CollectionJobDTO; sources: SourceInfo[] }) {
  const source = sources.find((s) => s.id === job.sourceId);
  
  return (
    <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
      <div className="flex items-center gap-3">
        <JobStatusBadge status={job.status} size="sm" />
        <div>
          <p className="text-sm font-medium">{source?.name ?? `소스 #${job.sourceId}`}</p>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(job.startedAt)}
            {job.completedAt && ` (${formatDuration(job.startedAt, job.completedAt)})`}
          </p>
        </div>
      </div>
      <div className="text-right">
        {job.itemsCollected > 0 && (
          <p className="text-sm font-medium">{job.itemsCollected}건</p>
        )}
        {job.errorMessage && (
          <p className="text-xs text-red-600 max-w-[200px] truncate" title={job.errorMessage}>
            {job.errorMessage}
          </p>
        )}
      </div>
    </div>
  );
}

// Queue Item Component
function QueueItem({
  data,
  onMarkProcessed,
  isProcessing,
}: {
  data: CollectedDataDTO;
  onMarkProcessed: () => void;
  isProcessing: boolean;
}) {
  return (
    <div className="p-3 rounded-lg border bg-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium line-clamp-1">{data.title || '제목 없음'}</h4>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {data.content?.substring(0, 150) || '내용 없음'}
          </p>
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {formatDateTime(data.collectedAt)}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onMarkProcessed}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
