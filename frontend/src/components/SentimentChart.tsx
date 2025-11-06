import { Card } from "@/components/ui/card";
import type { SentimentData } from "@/types/api";

interface SentimentChartProps {
  data: SentimentData;
}

export function SentimentChart({ data }: SentimentChartProps) {
  const total = data.pos + data.neg + data.neu;
  const posPercent = total > 0 ? ((data.pos / total) * 100).toFixed(1) : "0";
  const negPercent = total > 0 ? ((data.neg / total) * 100).toFixed(1) : "0";
  const neuPercent = total > 0 ? ((data.neu / total) * 100).toFixed(1) : "0";

  return (
    <Card className="p-6 shadow-elegant card-hover">
      <h2 className="text-xl font-bold mb-6">감성 분석</h2>
      
      {/* Bar Chart */}
      <div className="space-y-6 mb-8">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">긍정</span>
            <span className="text-muted-foreground">{data.pos}건 ({posPercent}%)</span>
          </div>
          <div className="h-8 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-success transition-all duration-500"
              style={{ width: `${posPercent}%` }}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">부정</span>
            <span className="text-muted-foreground">{data.neg}건 ({negPercent}%)</span>
          </div>
          <div className="h-8 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-destructive transition-all duration-500"
              style={{ width: `${negPercent}%` }}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">중립</span>
            <span className="text-muted-foreground">{data.neu}건 ({neuPercent}%)</span>
          </div>
          <div className="h-8 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-muted-foreground transition-all duration-500"
              style={{ width: `${neuPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 pt-6 border-t">
        <div className="text-center">
          <div className="text-2xl font-bold text-success">{data.pos}</div>
          <div className="text-xs text-muted-foreground mt-1">긍정 ({posPercent}%)</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-destructive">{data.neg}</div>
          <div className="text-xs text-muted-foreground mt-1">부정 ({negPercent}%)</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-muted-foreground">{data.neu}</div>
          <div className="text-xs text-muted-foreground mt-1">중립 ({neuPercent}%)</div>
        </div>
      </div>
    </Card>
  );
}
