import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Database,
  RefreshCw,
  Loader2,
  Clock,
  CheckCircle2,
  FileText,
  ExternalLink,
  Filter,
  Inbox,
  AlertCircle,
  Activity,
  Brain,
  Sparkles,
  MoreHorizontal,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import {
  useCollectedData,
  useUnprocessedData,
  useDataStats,
} from '@/hooks/useCollectedData';
import { type CollectedDataDTO, summarizeData } from '@/lib/api/data';
import { analyzeArticle, analyzeArticlesBatch, analyzeByCategory } from '@/lib/api/ml';
import type { AddonCategory } from '@/types/api';

// ============================================
// Data Item Card Component
// ============================================

interface DataItemCardProps {
  item: CollectedDataDTO;
  onMarkProcessed: (id: number) => Promise<void>;
  onAnalyze: (id: number, importance?: 'realtime' | 'batch') => Promise<void>;
  onAnalyzeCategory: (id: number, category: AddonCategory) => Promise<void>;
  showProcessedBadge?: boolean;
}

const DataItemCard: React.FC<DataItemCardProps> = ({
  item,
  onMarkProcessed,
  onAnalyze,
  onAnalyzeCategory,
  showProcessedBadge = true,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleMarkProcessed = async () => {
    setIsProcessing(true);
    try {
      await onMarkProcessed(item.id);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAnalyze = async (importance: 'realtime' | 'batch' = 'batch') => {
    setIsAnalyzing(true);
    try {
      await onAnalyze(item.id, importance);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAnalyzeCategory = async (category: AddonCategory) => {
    setIsAnalyzing(true);
    try {
      await onAnalyzeCategory(item.id, category);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm line-clamp-2">
              {item.title || '제목 없음'}
            </CardTitle>
            <CardDescription className="text-xs mt-1 flex items-center gap-2">
              <Clock className="h-3 w-3" />
              {new Date(item.collectedAt).toLocaleString('ko-KR')}
              {item.publishedDate && (
                <span className="text-muted-foreground">
                  (발행: {new Date(item.publishedDate).toLocaleDateString('ko-KR')})
                </span>
              )}
            </CardDescription>
          </div>
          {showProcessedBadge && (
            <Badge variant={item.processed ? 'default' : 'outline'}>
              {item.processed ? '처리됨' : '대기'}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Content Preview */}
        <p className="text-sm text-muted-foreground line-clamp-3">
          {summarizeData(item, 200) || '내용 없음'}
        </p>

        {/* Metadata */}
        {item.metadata && Object.keys(item.metadata).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {Object.entries(item.metadata)
              .slice(0, 3)
              .map(([key, value]) => (
                <Badge key={key} variant="secondary" className="text-xs">
                  {key}: {String(value).slice(0, 20)}
                </Badge>
              ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-500 hover:underline flex items-center gap-1"
              >
                <ExternalLink className="h-3 w-3" />
                원본 보기
              </a>
            )}
            <Badge variant="outline" className="text-xs">
              소스 #{item.sourceId}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            {/* ML 분석 드롭다운 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isAnalyzing}
                  className="gap-1"
                >
                  {isAnalyzing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Brain className="h-4 w-4" />
                  )}
                  <span className="text-xs">분석</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleAnalyze('realtime')}>
                  <Sparkles className="mr-2 h-4 w-4 text-yellow-500" />
                  실시간 분석
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAnalyze('batch')}>
                  <Brain className="mr-2 h-4 w-4" />
                  배치 분석
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleAnalyzeCategory('SENTIMENT')}>
                  감정 분석
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAnalyzeCategory('FACTCHECK')}>
                  팩트체크
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAnalyzeCategory('CONTEXT')}>
                  문맥/의도 분석
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAnalyzeCategory('ENTITY_EXTRACTION')}>
                  개체명 추출
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAnalyzeCategory('SUMMARIZATION')}>
                  요약 생성
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 처리됨 표시 버튼 */}
            {!item.processed && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleMarkProcessed}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                <span className="ml-1 text-xs">처리됨</span>
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// ============================================
// Stats Card Component
// ============================================

interface StatsCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  description?: string;
  className?: string;
}

const StatsCard: React.FC<StatsCardProps> = ({
  title,
  value,
  icon,
  description,
  className,
}) => {
  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold">{value.toLocaleString()}</p>
            {description && (
              <p className="text-xs text-muted-foreground mt-1">{description}</p>
            )}
          </div>
          <div className="p-2 bg-primary/10 rounded-lg">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
};

// ============================================
// Collected Data Page Component
// ============================================

const CollectedDataPage: React.FC = () => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'all' | 'unprocessed'>('all');
  const [processedFilter, setProcessedFilter] = useState<'all' | 'processed' | 'unprocessed'>(
    'all'
  );

  // Stats Hook
  const { stats, loading: statsLoading, refresh: refreshStats } = useDataStats();

  // All Data Hook
  const {
    data: allData,
    total: allTotal,
    totalPages: allTotalPages,
    currentPage: allCurrentPage,
    loading: allLoading,
    error: allError,
    refresh: refreshAllData,
    setPage: setAllPage,
    markAsProcessed: markAllAsProcessed,
  } = useCollectedData({
    size: 12,
    processed: processedFilter === 'all' ? undefined : processedFilter === 'processed',
    autoRefresh: true,
    refreshInterval: 30000,
  });

  // Unprocessed Data Hook
  const {
    data: unprocessedData,
    total: unprocessedTotal,
    totalPages: unprocessedTotalPages,
    currentPage: unprocessedCurrentPage,
    loading: unprocessedLoading,
    error: unprocessedError,
    refresh: refreshUnprocessedData,
    setPage: setUnprocessedPage,
    markAsProcessed: markUnprocessedAsProcessed,
  } = useUnprocessedData({
    size: 12,
    autoRefresh: true,
    refreshInterval: 10000,
  });

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefreshAll = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([refreshStats(), refreshAllData(), refreshUnprocessedData()]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleMarkProcessed = async (id: number) => {
    try {
      if (activeTab === 'all') {
        await markAllAsProcessed(id);
      } else {
        await markUnprocessedAsProcessed(id);
      }
      toast({ title: '처리됨으로 표시되었습니다.' });
      refreshStats();
    } catch (e) {
      toast({
        title: '처리 실패',
        description: e instanceof Error ? e.message : '알 수 없는 오류',
        variant: 'destructive',
      });
    }
  };

  const handleAnalyze = async (id: number, importance: 'realtime' | 'batch' = 'batch') => {
    try {
      const result = await analyzeArticle(id, importance);
      toast({
        title: 'ML 분석 시작',
        description: `${result.executionIds.length}개 Add-on 분석이 시작되었습니다. (배치: ${result.batchId.slice(0, 8)}...)`,
      });
    } catch (e) {
      toast({
        title: '분석 실패',
        description: e instanceof Error ? e.message : 'ML 분석을 시작할 수 없습니다.',
        variant: 'destructive',
      });
    }
  };

  const handleAnalyzeCategory = async (id: number, category: AddonCategory) => {
    try {
      await analyzeByCategory(id, category);
      toast({
        title: '분석 시작',
        description: `${category} 분석이 시작되었습니다.`,
      });
    } catch (e) {
      toast({
        title: '분석 실패',
        description: e instanceof Error ? e.message : '분석을 시작할 수 없습니다.',
        variant: 'destructive',
      });
    }
  };

  const handleBatchAnalyze = async () => {
    const unprocessedIds = unprocessedData.map(d => d.id);
    if (unprocessedIds.length === 0) {
      toast({ title: '분석할 데이터가 없습니다.', variant: 'destructive' });
      return;
    }
    
    try {
      const result = await analyzeArticlesBatch(unprocessedIds.slice(0, 50)); // 최대 50개
      toast({
        title: '일괄 분석 시작',
        description: `${result.articleCount}개 기사의 분석이 시작되었습니다.`,
      });
    } catch (e) {
      toast({
        title: '일괄 분석 실패',
        description: e instanceof Error ? e.message : '일괄 분석을 시작할 수 없습니다.',
        variant: 'destructive',
      });
    }
  };

  // Current data based on active tab
  const currentData = activeTab === 'all' ? allData : unprocessedData;
  const currentTotal = activeTab === 'all' ? allTotal : unprocessedTotal;
  const currentTotalPages = activeTab === 'all' ? allTotalPages : unprocessedTotalPages;
  const currentPage = activeTab === 'all' ? allCurrentPage : unprocessedCurrentPage;
  const currentLoading = activeTab === 'all' ? allLoading : unprocessedLoading;
  const currentError = activeTab === 'all' ? allError : unprocessedError;
  const setCurrentPage = activeTab === 'all' ? setAllPage : setUnprocessedPage;

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
                <Database className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-3xl font-bold">수집 데이터</h1>
                <p className="text-muted-foreground">
                  수집된 뉴스 데이터를 확인하고 처리 상태를 관리합니다.
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
            {unprocessedData.length > 0 && (
              <Button
                onClick={handleBatchAnalyze}
                className="gap-2"
              >
                <Brain className="h-4 w-4" />
                일괄 분석 ({Math.min(unprocessedData.length, 50)}건)
              </Button>
            )}
          </div>
        </header>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <StatsCard
            title="전체 데이터"
            value={stats?.total ?? 0}
            icon={<Database className="h-5 w-5 text-primary" />}
            description="수집된 전체 문서"
          />
          <StatsCard
            title="대기 중"
            value={stats?.unprocessed ?? 0}
            icon={<Inbox className="h-5 w-5 text-yellow-500" />}
            description="처리 대기 중인 문서"
          />
          <StatsCard
            title="처리 완료"
            value={stats?.processed ?? 0}
            icon={<CheckCircle2 className="h-5 w-5 text-green-500" />}
            description="분석 완료된 문서"
          />
        </div>

        {/* Error Alert */}
        {currentError && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              데이터를 불러오는데 실패했습니다: {currentError.message}
            </AlertDescription>
          </Alert>
        )}

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as 'all' | 'unprocessed')}
        >
          <div className="flex items-center justify-between mb-4">
            <TabsList>
              <TabsTrigger value="all" className="flex items-center gap-1">
                <FileText className="h-4 w-4" />
                전체 데이터
                <Badge variant="secondary" className="ml-1">
                  {allTotal}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="unprocessed" className="flex items-center gap-1">
                <Inbox className="h-4 w-4" />
                미처리
                {unprocessedTotal > 0 && (
                  <Badge className="ml-1 bg-yellow-500">
                    {unprocessedTotal}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {activeTab === 'all' && (
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <Select
                  value={processedFilter}
                  onValueChange={(v) =>
                    setProcessedFilter(v as 'all' | 'processed' | 'unprocessed')
                  }
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">전체</SelectItem>
                    <SelectItem value="processed">처리됨</SelectItem>
                    <SelectItem value="unprocessed">미처리</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <TabsContent value="all">
            <DataList
              data={allData}
              loading={allLoading}
              onMarkProcessed={handleMarkProcessed}
              onAnalyze={handleAnalyze}
              onAnalyzeCategory={handleAnalyzeCategory}
            />
          </TabsContent>

          <TabsContent value="unprocessed">
            <DataList
              data={unprocessedData}
              loading={unprocessedLoading}
              onMarkProcessed={handleMarkProcessed}
              onAnalyze={handleAnalyze}
              onAnalyzeCategory={handleAnalyzeCategory}
              showProcessedBadge={false}
            />
          </TabsContent>
        </Tabs>

        {/* Pagination */}
        {currentTotalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-6">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(currentPage - 1)}
              disabled={currentPage === 0}
            >
              이전
            </Button>
            <span className="text-sm text-muted-foreground">
              {currentPage + 1} / {currentTotalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(currentPage + 1)}
              disabled={currentPage >= currentTotalPages - 1}
            >
              다음
            </Button>
          </div>
        )}

        {/* Help Section */}
        <Alert className="mt-6">
          <Activity className="h-4 w-4" />
          <AlertDescription>
            <strong>데이터 처리 워크플로우:</strong> 수집된 데이터는 자동으로 ML Add-on을 통해 분석됩니다.
            수동으로 처리됨 표시를 하면 해당 데이터는 분석 대기열에서 제외됩니다.
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
};

// ============================================
// Data List Component
// ============================================

interface DataListProps {
  data: CollectedDataDTO[];
  loading: boolean;
  onMarkProcessed: (id: number) => Promise<void>;
  onAnalyze: (id: number, importance?: 'realtime' | 'batch') => Promise<void>;
  onAnalyzeCategory: (id: number, category: AddonCategory) => Promise<void>;
  showProcessedBadge?: boolean;
}

const DataList: React.FC<DataListProps> = ({
  data,
  loading,
  onMarkProcessed,
  onAnalyze,
  onAnalyzeCategory,
  showProcessedBadge = true,
}) => {
  if (loading && data.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <Card className="p-8 text-center">
        <Inbox className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-muted-foreground">표시할 데이터가 없습니다.</p>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {data.map((item) => (
        <DataItemCard
          key={item.id}
          item={item}
          onMarkProcessed={onMarkProcessed}
          onAnalyze={onAnalyze}
          onAnalyzeCategory={onAnalyzeCategory}
          showProcessedBadge={showProcessedBadge}
        />
      ))}
    </div>
  );
};

export default CollectedDataPage;
