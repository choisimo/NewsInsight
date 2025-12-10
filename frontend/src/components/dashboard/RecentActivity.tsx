import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, CheckCircle2, Search, Brain, Shield } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

const activities = [
  {
    id: 1,
    type: "search",
    message: "'탄소 중립 정책' 검색 수행",
    time: "방금 전",
    icon: Search,
    color: "text-blue-500",
    bg: "bg-blue-100 dark:bg-blue-900/30"
  },
  {
    id: 2,
    type: "factcheck",
    message: "선거 관련 가짜뉴스 팩트체크 완료",
    time: "5분 전",
    icon: Shield,
    color: "text-green-500",
    bg: "bg-green-100 dark:bg-green-900/30"
  },
  {
    id: 3,
    type: "ai",
    message: "Deep Search 분석 리포트 생성됨",
    time: "12분 전",
    icon: Brain,
    color: "text-purple-500",
    bg: "bg-purple-100 dark:bg-purple-900/30"
  },
  {
    id: 4,
    type: "system",
    message: "시스템 데이터베이스 업데이트",
    time: "1시간 전",
    icon: CheckCircle2,
    color: "text-gray-500",
    bg: "bg-gray-100 dark:bg-gray-800"
  },
  {
    id: 5,
    type: "search",
    message: "'반도체 수출 현황' 검색 수행",
    time: "2시간 전",
    icon: Search,
    color: "text-blue-500",
    bg: "bg-blue-100 dark:bg-blue-900/30"
  },
];

export function RecentActivity() {
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
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
