import { useEffect, useState } from "react";
import { LiveNewsTicker } from "@/components/dashboard/LiveNewsTicker";
import { TrendChart } from "@/components/dashboard/TrendChart";
import { Button } from "@/components/ui/button";
import { RefreshCcw, Calendar, LayoutDashboard, Database, Brain, AlertTriangle, Activity, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LiveCounter } from "@/components/admin/LiveCounter";
import { LiveStream } from "@/components/admin/LiveStream";
import { useLiveDashboard } from "@/hooks/useDashboardEvents";
import { getCollectionStats, type CollectionStatsDTO } from "@/lib/api/collection";
import { cn } from "@/lib/utils";

export default function LiveDashboard() {
  const today = new Date().toLocaleDateString('ko-KR', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric', 
    weekday: 'long' 
  });

  // 실시간 대시보드 훅
  const {
    stats,
    previousStats,
    activityLogs,
    eventsStatus,
    statsStatus,
    isConnected,
    reconnectEvents,
    reconnectStats,
    clearLogs,
  } = useLiveDashboard({ maxActivityLogs: 50 });

  // 초기 데이터 로드용 (SSE 연결 전 또는 실패 시 폴백)
  const [fallbackStats, setFallbackStats] = useState<CollectionStatsDTO | null>(null);
  const [isLoadingFallback, setIsLoadingFallback] = useState(false);

  // SSE 연결 실패 시 폴백 데이터 로드
  useEffect(() => {
    if (statsStatus === 'error' || statsStatus === 'disconnected') {
      const loadFallback = async () => {
        setIsLoadingFallback(true);
        try {
          const data = await getCollectionStats();
          setFallbackStats(data);
        } catch (e) {
          console.error('Failed to load fallback stats:', e);
        } finally {
          setIsLoadingFallback(false);
        }
      };
      loadFallback();
    }
  }, [statsStatus]);

  // 표시할 통계 (SSE 우선, 없으면 폴백)
  const displayStats = stats || (fallbackStats ? {
    total: fallbackStats.totalItemsCollected,
    unprocessed: 0,
    processed: fallbackStats.totalItemsCollected,
    todayCount: fallbackStats.itemsCollectedToday,
  } : null);

  const handleReconnect = () => {
    reconnectEvents();
    reconnectStats();
  };

  return (
    <div className="container py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <LayoutDashboard className="h-6 w-6 text-primary" />
            Live Dashboard
          </h1>
          <p className="text-muted-foreground text-sm flex items-center gap-2 mt-1">
            <Calendar className="h-3 w-3" />
            {today}
            <Badge 
              variant="outline" 
              className={cn(
                "ml-2",
                isConnected 
                  ? "bg-green-50 text-green-600 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800"
                  : "bg-yellow-50 text-yellow-600 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-400 dark:border-yellow-800"
              )}
            >
              {isConnected ? (
                <>
                  <Wifi className="h-3 w-3 mr-1" />
                  실시간 연결됨
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3 mr-1" />
                  오프라인
                </>
              )}
            </Badge>
          </p>
        </div>
        <div className="flex gap-2">
          {!isConnected && (
            <Button variant="outline" size="sm" onClick={handleReconnect}>
              <RefreshCcw className="h-4 w-4 mr-2" />
              재연결
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            <RefreshCcw className="h-4 w-4 mr-2" />
            새로고침
          </Button>
        </div>
      </div>

      {/* Live KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <LiveCounter
          value={displayStats?.total ?? 0}
          previousValue={previousStats?.total}
          label="총 수집 문서"
          icon={<Database className="h-4 w-4" />}
          subtitle={displayStats?.todayCount ? `오늘 +${displayStats.todayCount}` : undefined}
          isLoading={!displayStats && isLoadingFallback}
        />
        <LiveCounter
          value={displayStats?.processed ?? 0}
          previousValue={previousStats?.processed}
          label="처리 완료"
          icon={<Brain className="h-4 w-4" />}
          subtitle="AI 분석 완료"
          isLoading={!displayStats && isLoadingFallback}
        />
        <LiveCounter
          value={displayStats?.unprocessed ?? 0}
          previousValue={previousStats?.unprocessed}
          label="대기 중"
          icon={<Activity className="h-4 w-4" />}
          subtitle="분석 대기열"
          isLoading={!displayStats && isLoadingFallback}
        />
        <LiveCounter
          value={displayStats?.errorCount ?? 0}
          previousValue={previousStats?.errorCount}
          label="오류"
          icon={<AlertTriangle className="h-4 w-4" />}
          subtitle="처리 실패"
          showChange={true}
          isLoading={!displayStats && isLoadingFallback}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-6 lg:grid-cols-7">
        {/* Left Col (News) - span 3 */}
        <div className="lg:col-span-3 h-[500px]">
          <LiveNewsTicker />
        </div>
        
        {/* Middle Col (Trends) - span 2 */}
        <div className="lg:col-span-2 h-[500px]">
          <TrendChart />
        </div>

        {/* Right Col (Live Activity Stream) - span 2 */}
        <div className="lg:col-span-2 h-[500px]">
          <LiveStream
            logs={activityLogs}
            status={eventsStatus}
            maxVisible={15}
            title="실시간 활동"
            onClear={clearLogs}
            className="h-full"
          />
        </div>
      </div>
    </div>
  );
}
