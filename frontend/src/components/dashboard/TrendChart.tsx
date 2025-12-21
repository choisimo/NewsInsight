import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, TrendingUp, Loader2, AlertCircle } from "lucide-react";
import { getSearchStatistics, listSearchHistory } from "@/lib/api";

interface KeywordTrend {
  keyword: string;
  count: number;
  percentage: number;
  color: string;
}

// 키워드별 색상 팔레트
const COLORS = [
  "bg-blue-500",
  "bg-green-500", 
  "bg-purple-500",
  "bg-orange-500",
  "bg-pink-500",
  "bg-cyan-500",
  "bg-yellow-500",
  "bg-red-500",
];

export function TrendChart() {
  const [trends, setTrends] = useState<KeywordTrend[]>([]);
  const [totalSearches, setTotalSearches] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTrends = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // 검색 통계와 최근 검색 기록을 병렬로 가져오기
        const [statsResponse, historyResponse] = await Promise.all([
          getSearchStatistics(7),
          listSearchHistory(0, 100, 'createdAt', 'DESC'),
        ]);

        setTotalSearches(statsResponse.totalSearches);

        // 검색 기록에서 키워드 빈도 추출
        const keywordCount = new Map<string, number>();
        historyResponse.content.forEach(record => {
          const query = record.query.toLowerCase().trim();
          if (query.length >= 2) {
            keywordCount.set(query, (keywordCount.get(query) || 0) + 1);
          }
        });

        // 빈도순 정렬 후 상위 8개 추출
        const sortedKeywords = Array.from(keywordCount.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8);

        const totalCount = sortedKeywords.reduce((sum, [, count]) => sum + count, 0);

        const trendData: KeywordTrend[] = sortedKeywords.map(([keyword, count], index) => ({
          keyword: keyword.length > 10 ? keyword.slice(0, 10) + '...' : keyword,
          count,
          percentage: totalCount > 0 ? Math.round((count / totalCount) * 100) : 0,
          color: COLORS[index % COLORS.length],
        }));

        setTrends(trendData);
      } catch (err) {
        console.error('Failed to fetch trend data:', err);
        setError('트렌드 데이터를 불러오는데 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchTrends();
    
    // 5분마다 자동 새로고침
    const interval = setInterval(fetchTrends, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-lg font-bold flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-blue-500" />
          주요 키워드 트렌드
        </CardTitle>
        <CardDescription>
          지난 7일간 검색된 키워드 {totalSearches > 0 && `(총 ${totalSearches}회 검색)`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-[300px] w-full flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="h-[300px] w-full flex flex-col items-center justify-center text-muted-foreground">
            <AlertCircle className="h-10 w-10 mb-2" />
            <p className="text-sm">{error}</p>
          </div>
        ) : trends.length === 0 ? (
          <div className="h-[300px] w-full bg-slate-50 dark:bg-slate-900/50 rounded-lg flex items-center justify-center border border-dashed">
            <div className="text-center text-muted-foreground">
              <TrendingUp className="h-10 w-10 mx-auto mb-2 opacity-20" />
              <p>아직 검색 기록이 없습니다</p>
              <p className="text-xs mt-1">검색을 시작하면 트렌드가 표시됩니다</p>
            </div>
          </div>
        ) : (
          <div className="h-[300px] w-full">
            {/* 막대 차트 */}
            <div className="space-y-3">
              {trends.map((trend, index) => (
                <div key={index} className="space-y-1">
                  <div className="flex justify-between items-center text-sm">
                    <span className="font-medium truncate max-w-[150px]" title={trend.keyword}>
                      {trend.keyword}
                    </span>
                    <span className="text-muted-foreground">
                      {trend.count}회 ({trend.percentage}%)
                    </span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${trend.color} rounded-full transition-all duration-500`}
                      style={{ width: `${trend.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* 범례 */}
            <div className="mt-6 grid grid-cols-2 gap-2 text-sm">
              {trends.slice(0, 4).map((trend, index) => (
                <div key={index} className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${trend.color}`} />
                  <span className="truncate" title={trend.keyword}>{trend.keyword}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
