import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Brain,
  RefreshCw,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  PlayCircle,
  StopCircle,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Zap,
  Server,
  Activity,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { useAiJobs, useAiProviders, useAiHealth } from '@/hooks/useAiJobs';
import {
  getAiJobStatusColor,
  getAiJobStatusLabel,
  calculateAiJobProgress,
  type AiJobDTO,
  type AiJobStatus,
  type AiSubTaskDTO,
} from '@/lib/api/ai';

// ============================================
// Status Badge Component
// ============================================

const JobStatusBadge: React.FC<{ status: AiJobStatus }> = ({ status }) => {
  const getVariant = () => {
    switch (status) {
      case 'COMPLETED':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100';
      case 'RUNNING':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100';
      case 'PENDING':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100';
      case 'FAILED':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100';
      case 'CANCELLED':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-100';
      default:
        return '';
    }
  };

  const getIcon = () => {
    switch (status) {
      case 'COMPLETED':
        return <CheckCircle2 className="h-3 w-3" />;
      case 'RUNNING':
        return <Loader2 className="h-3 w-3 animate-spin" />;
      case 'PENDING':
        return <Clock className="h-3 w-3" />;
      case 'FAILED':
        return <XCircle className="h-3 w-3" />;
      case 'CANCELLED':
        return <StopCircle className="h-3 w-3" />;
      default:
        return null;
    }
  };

  return (
    <Badge className={`${getVariant()} flex items-center gap-1`}>
      {getIcon()}
      {getAiJobStatusLabel(status)}
    </Badge>
  );
};

// ============================================
// Sub Task Item
// ============================================

const SubTaskItem: React.FC<{ task: AiSubTaskDTO }> = ({ task }) => {
  return (
    <div className="flex items-center justify-between p-2 rounded border bg-muted/30">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs">
          {task.providerId}
        </Badge>
        <span className="text-sm">{task.taskType}</span>
      </div>
      <div className="flex items-center gap-2">
        {task.retryCount > 0 && (
          <Badge variant="secondary" className="text-xs">
            재시도: {task.retryCount}
          </Badge>
        )}
        <JobStatusBadge status={task.status as AiJobStatus} />
      </div>
    </div>
  );
};

// ============================================
// Job Card Component
// ============================================

interface JobCardProps {
  job: AiJobDTO;
  onCancel: (jobId: string) => Promise<void>;
  onRetry: (jobId: string) => Promise<void>;
}

const JobCard: React.FC<JobCardProps> = ({ job, onCancel, onRetry }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const progress = calculateAiJobProgress(job);
  const isRunning = job.overallStatus === 'RUNNING' || job.overallStatus === 'PENDING';
  const canRetry = job.overallStatus === 'FAILED' && job.failedTasks > 0;

  const handleCancel = async () => {
    setIsCancelling(true);
    try {
      await onCancel(job.jobId);
    } finally {
      setIsCancelling(false);
    }
  };

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await onRetry(job.jobId);
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <Card className={isRunning ? 'border-blue-500/50' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base truncate">{job.topic}</CardTitle>
            <CardDescription className="text-xs mt-1">
              {job.baseUrl && (
                <span className="truncate block">{job.baseUrl}</span>
              )}
              <span className="flex items-center gap-2 mt-1">
                <Clock className="h-3 w-3" />
                {new Date(job.createdAt).toLocaleString('ko-KR')}
              </span>
            </CardDescription>
          </div>
          <JobStatusBadge status={job.overallStatus} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Progress */}
        {isRunning && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>진행률</span>
              <span>{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        {/* Task Stats */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-green-500" />
            완료: {job.completedTasks}
          </span>
          {job.failedTasks > 0 && (
            <span className="flex items-center gap-1">
              <XCircle className="h-3 w-3 text-red-500" />
              실패: {job.failedTasks}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Activity className="h-3 w-3" />
            전체: {job.totalTasks}
          </span>
        </div>

        {/* Error Message */}
        {job.errorMessage && (
          <Alert variant="destructive" className="py-2">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              {job.errorMessage}
            </AlertDescription>
          </Alert>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between">
          <Collapsible open={isOpen} onOpenChange={setIsOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="text-xs">
                {isOpen ? (
                  <ChevronUp className="h-4 w-4 mr-1" />
                ) : (
                  <ChevronDown className="h-4 w-4 mr-1" />
                )}
                세부 작업 ({job.subTasks.length})
              </Button>
            </CollapsibleTrigger>
          </Collapsible>

          <div className="flex gap-1">
            {canRetry && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRetry}
                disabled={isRetrying}
              >
                {isRetrying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
              </Button>
            )}
            {isRunning && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                disabled={isCancelling}
              >
                {isCancelling ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <StopCircle className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        </div>

        {/* SubTasks */}
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleContent className="space-y-2 pt-2">
            {job.subTasks.map((task) => (
              <SubTaskItem key={task.subTaskId} task={task} />
            ))}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
};

// ============================================
// Provider Card
// ============================================

const ProviderCard: React.FC<{
  provider: { id: string; name: string; description?: string };
  isHealthy?: boolean;
}> = ({ provider, isHealthy }) => {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="font-medium text-sm">{provider.name}</p>
            {provider.description && (
              <p className="text-xs text-muted-foreground">{provider.description}</p>
            )}
          </div>
        </div>
        {isHealthy !== undefined && (
          <div
            className={`h-2 w-2 rounded-full ${
              isHealthy ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
        )}
      </div>
    </Card>
  );
};

// ============================================
// AI Jobs Page Component
// ============================================

const AiJobs: React.FC = () => {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<AiJobStatus | 'ALL'>('ALL');

  // Hooks
  const {
    jobs,
    total,
    totalPages,
    currentPage,
    loading: jobsLoading,
    error: jobsError,
    refresh: refreshJobs,
    setPage,
    cancel,
    retry,
  } = useAiJobs({
    size: 10,
    status: statusFilter === 'ALL' ? undefined : statusFilter,
    autoRefresh: true,
    refreshInterval: 5000,
  });

  const {
    providers,
    loading: providersLoading,
    refresh: refreshProviders,
  } = useAiProviders();

  const {
    health,
    loading: healthLoading,
    refresh: refreshHealth,
    isHealthy,
  } = useAiHealth();

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefreshAll = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([refreshJobs(), refreshProviders(), refreshHealth()]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCancel = async (jobId: string) => {
    try {
      await cancel(jobId);
      toast({ title: '작업이 취소되었습니다.' });
    } catch (e) {
      toast({
        title: '취소 실패',
        description: e instanceof Error ? e.message : '알 수 없는 오류',
        variant: 'destructive',
      });
    }
  };

  const handleRetry = async (jobId: string) => {
    try {
      await retry(jobId);
      toast({ title: '재시도가 시작되었습니다.' });
    } catch (e) {
      toast({
        title: '재시도 실패',
        description: e instanceof Error ? e.message : '알 수 없는 오류',
        variant: 'destructive',
      });
    }
  };

  // Stats
  const runningCount = jobs.filter(
    (j) => j.overallStatus === 'RUNNING' || j.overallStatus === 'PENDING'
  ).length;
  const completedCount = jobs.filter((j) => j.overallStatus === 'COMPLETED').length;
  const failedCount = jobs.filter((j) => j.overallStatus === 'FAILED').length;

  return (
    <div className="min-h-screen py-8">
      <div className="container mx-auto px-4 max-w-6xl">
        {/* Header */}
        <header className="mb-8">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            검색으로 돌아가기
          </Link>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Brain className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-3xl font-bold">AI 작업 관리</h1>
                <p className="text-muted-foreground">
                  AI 분석 작업 상태를 모니터링하고 관리합니다.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={handleRefreshAll}
              disabled={isRefreshing}
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`}
              />
              새로고침
            </Button>
          </div>
        </header>

        {/* Overview */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  서비스 상태
                </CardTitle>
                <CardDescription>AI 분석 서비스 및 작업 현황</CardDescription>
              </div>
              <Badge
                className={
                  isHealthy
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
                    : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
                }
              >
                {isHealthy ? '정상' : '점검 필요'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="flex items-center gap-2">
                <PlayCircle className="h-4 w-4 text-blue-500" />
                <span className="text-sm">
                  진행 중: <strong>{runningCount}</strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-sm">
                  완료: <strong>{completedCount}</strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4 text-red-500" />
                <span className="text-sm">
                  실패: <strong>{failedCount}</strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-yellow-500" />
                <span className="text-sm">
                  전체: <strong>{total}</strong>
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Error Alert */}
        {jobsError && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              작업 목록을 불러오는데 실패했습니다: {jobsError.message}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Jobs List */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">작업 목록</h2>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as AiJobStatus | 'ALL')}
              >
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="상태 필터" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">전체</SelectItem>
                  <SelectItem value="PENDING">대기 중</SelectItem>
                  <SelectItem value="RUNNING">진행 중</SelectItem>
                  <SelectItem value="COMPLETED">완료</SelectItem>
                  <SelectItem value="FAILED">실패</SelectItem>
                  <SelectItem value="CANCELLED">취소됨</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <ScrollArea className="h-[600px]">
              {jobsLoading && jobs.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : jobs.length === 0 ? (
                <Card className="p-8 text-center text-muted-foreground">
                  표시할 작업이 없습니다.
                </Card>
              ) : (
                <div className="space-y-4 pr-4">
                  {jobs.map((job) => (
                    <JobCard
                      key={job.jobId}
                      job={job}
                      onCancel={handleCancel}
                      onRetry={handleRetry}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(currentPage - 1)}
                  disabled={currentPage === 0}
                >
                  이전
                </Button>
                <span className="text-sm text-muted-foreground">
                  {currentPage + 1} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(currentPage + 1)}
                  disabled={currentPage >= totalPages - 1}
                >
                  다음
                </Button>
              </div>
            )}
          </div>

          {/* Providers Sidebar */}
          <div className="lg:col-span-1">
            <h2 className="text-lg font-semibold mb-4">AI 제공자</h2>
            <div className="space-y-3">
              {providersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : providers.length === 0 ? (
                <Card className="p-4 text-center text-muted-foreground text-sm">
                  등록된 제공자가 없습니다.
                </Card>
              ) : (
                providers.map((provider) => (
                  <ProviderCard
                    key={provider.id}
                    provider={provider}
                    isHealthy={health?.providers?.[provider.id]}
                  />
                ))
              )}
            </div>

            <Separator className="my-6" />

            <h2 className="text-lg font-semibold mb-4">빠른 링크</h2>
            <div className="space-y-2">
              <Link to="/deep-search">
                <Button variant="outline" className="w-full justify-start">
                  <Brain className="h-4 w-4 mr-2" />
                  Deep Search
                </Button>
              </Link>
              <Link to="/parallel-search">
                <Button variant="outline" className="w-full justify-start">
                  <Activity className="h-4 w-4 mr-2" />
                  Parallel Search
                </Button>
              </Link>
              <Link to="/ml-addons">
                <Button variant="outline" className="w-full justify-start">
                  <Zap className="h-4 w-4 mr-2" />
                  ML Add-ons
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AiJobs;
