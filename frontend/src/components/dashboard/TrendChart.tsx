import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, TrendingUp } from "lucide-react";

export function TrendChart() {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-lg font-bold flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-blue-500" />
          주요 키워드 트렌드
        </CardTitle>
        <CardDescription>지난 24시간 동안 가장 많이 언급된 키워드</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Placeholder for a chart library like Recharts */}
        <div className="h-[300px] w-full bg-slate-50 dark:bg-slate-900/50 rounded-lg flex items-center justify-center border border-dashed">
          <div className="text-center text-muted-foreground">
            <TrendingUp className="h-10 w-10 mx-auto mb-2 opacity-20" />
            <p>차트 영역</p>
            <p className="text-xs">(Recharts 등의 라이브러리 연동 필요)</p>
            
            <div className="mt-8 grid grid-cols-2 gap-4 text-left max-w-xs mx-auto text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                <span>인공지능 (34%)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
                <span>경제성장 (21%)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                <span>기후변화 (18%)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                <span>선거 (12%)</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
