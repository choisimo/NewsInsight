import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, CheckCircle2, Search, Brain, Shield, Loader2, AlertCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { listSearchHistory, type SearchHistoryRecord } from "@/lib/api";

interface ActivityItem {
  id: string;
  type: string;
  message: string;
  time: string;
  icon: typeof Search;
  color: string;
  bg: string;
}

// 검색 타입에 따른 아이콘 및 스타일 매핑
const getActivityStyle = (searchType: string) => {
  switch (searchType) {
    case 'UNIFIED':
      return {
        icon: Search,
        color: "text-blue-500",
        bg: "bg-blue-100 dark:bg-blue-900/30",
        label: "통합 검색"
      };
    case 'DEEP_SEARCH':
      return {
        icon: Brain,
        color: "text-purple-500",
        bg: "bg-purple-100 dark:bg-purple-900/30",
        label: "Deep Search 분석"
      };
    case 'FACT_CHECK':
      return {
        icon: Shield,
        color: "text-green-500",
        bg: "bg-green-100 dark:bg-green-900/30",
        label: "팩트체크"
      };
    case 'BROWSER_AGENT':
      return {
        icon: CheckCircle2,
        color: "text-orange-500",
        bg: "bg-orange-100 dark:bg-orange-900/30",
        label: "브라우저 에이전트"
      };
    default:
      return {
        icon: Activity,
        color: "text-gray-500",
        bg: "bg-gray-100 dark:bg-gray-800",
        label: "활동"
      };
  }
};

// 시간 포맷팅
const formatTimeAgo = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "방금 전";
  if (diffMins < 60) return `${diffMins}분 전`;
  if (diffHours < 24) return `${diffHours}시간 전`;
  if (diffDays < 7) return `${diffDays}일 전`;
  return date.toLocaleDateString('ko-KR');
};

// 검색 기록을 활동 항목으로 변환
const convertToActivity = (record: SearchHistoryRecord): ActivityItem => {
  const style = getActivityStyle(record.searchType);
  const resultInfo = record.resultCount > 0 ? ` (${record.resultCount}건)` : '';
  
  return {
    id: record.id.toString(),
    type: record.searchType.toLowerCase(),
    message: `'${record.query}' ${style.label} 수행${resultInfo}`,
    time: formatTimeAgo(record.createdAt),
    icon: style.icon,
    color: style.color,
    bg: style.bg,
  };
};

export function RecentActivity() {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchActivities = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // 최근 검색 기록 10개 조회
        const response = await listSearchHistory(0, 10, 'createdAt', 'DESC');
        const activityItems = response.content.map(convertToActivity);
        setActivities(activityItems);
      } catch (err) {
        console.error('Failed to fetch recent activities:', err);
        setError('활동 기록을 불러오는데 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchActivities();
    
    // 1분마다 자동 새로고침
    const interval = setInterval(fetchActivities, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-lg font-bold flex items-center gap-2">
          <Activity className="h-5 w-5 text-orange-500" />
          최근 활동
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[300px]">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <AlertCircle className="h-8 w-8 mb-2" />
              <p className="text-sm">{error}</p>
            </div>
          ) : activities.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Activity className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">아직 활동 기록이 없습니다</p>
              <p className="text-xs mt-1">검색을 시작해보세요!</p>
            </div>
          ) : (
            <div className="relative border-l ml-3 my-2 space-y-6">
              {activities.map((item) => (
                <div key={item.id} className="ml-6 relative">
                  <span className={`absolute -left-[35px] flex h-8 w-8 items-center justify-center rounded-full ${item.bg} ring-4 ring-background`}>
                    <item.icon className={`h-4 w-4 ${item.color}`} />
                  </span>
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium leading-none">{item.message}</p>
                    <span className="text-xs text-muted-foreground">{item.time}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
