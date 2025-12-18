import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, TrendingUp, Clock, RefreshCw, AlertCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { listCollectedData, type CollectedDataDTO } from "@/lib/api/data";

interface NewsItem {
  id: string;
  title: string;
  source: string;
  time: string;
  url: string;
  category: string;
  originalData?: CollectedDataDTO;
}

/**
 * 수집된 데이터를 뉴스 아이템으로 변환
 */
const transformToNewsItem = (data: CollectedDataDTO): NewsItem => {
  // metadata에서 source 이름 추출 (API returns snake_case: source_name)
  const sourceName = (data.metadata?.source_name as string) || 
                     (data.metadata?.sourceName as string) || 
                     (data.metadata?.source as string) || 
                     `Source #${data.sourceId}`;
  
  // metadata에서 카테고리 추출 (tags 배열 또는 category)
  const tags = data.metadata?.tags as string[] | undefined;
  const category = (tags && tags.length > 0 ? tags[0] : null) ||
                   (data.metadata?.category as string) || 
                   (data.metadata?.section as string) || 
                   '일반';
  
  // 시간 포맷팅
  const time = data.publishedDate 
    ? new Date(data.publishedDate).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : new Date(data.collectedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

  return {
    id: data.id.toString(),
    title: data.title || '제목 없음',
    source: sourceName,
    time,
    url: data.url || '#',
    category,
    originalData: data,
  };
};

export function LiveNewsTicker() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchTime, setLastFetchTime] = useState<Date | null>(null);

  // 데이터 로드 함수
  const fetchNews = useCallback(async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
    setError(null);
    
    try {
      // 최근 수집된 데이터 20개 조회
      const result = await listCollectedData(0, 20);
      const newsItems = result.content.map(transformToNewsItem);
      setNews(newsItems);
      setLastFetchTime(new Date());
    } catch (e) {
      console.error('Failed to fetch news:', e);
      setError('뉴스를 불러오는데 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 초기 로드
  useEffect(() => {
    fetchNews();
  }, [fetchNews]);

  // 30초마다 자동 새로고침
  useEffect(() => {
    const interval = setInterval(() => {
      fetchNews(false); // 로딩 표시 없이 백그라운드 업데이트
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchNews]);

  // 뉴스 클릭 핸들러
  const handleNewsClick = (item: NewsItem, e: React.MouseEvent) => {
    if (!item.url || item.url === '#') {
      e.preventDefault();
      // URL이 없으면 상세 페이지로 이동하거나 모달 표시
      // 추후 상세 보기 기능 추가 가능
      return;
    }
    // 외부 URL은 새 탭에서 열기
  };

  // 로딩 상태
  if (isLoading && news.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-bold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-red-500" />
            실시간 뉴스 브리핑
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="p-3 rounded-lg border">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-5 w-full" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // 에러 상태
  if (error && news.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-bold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-red-500" />
            실시간 뉴스 브리핑
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center h-[300px] gap-4">
          <AlertCircle className="h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={() => fetchNews()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            다시 시도
          </Button>
        </CardContent>
      </Card>
    );
  }

  // 데이터 없음 상태
  if (news.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-bold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-red-500" />
            실시간 뉴스 브리핑
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center h-[300px] gap-4">
          <p className="text-muted-foreground">수집된 뉴스가 없습니다.</p>
          <Button variant="outline" size="sm" onClick={() => fetchNews()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            새로고침
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-bold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-red-500" />
            실시간 뉴스 브리핑
          </CardTitle>
          <div className="flex items-center gap-2">
            {lastFetchTime && (
              <span className="text-xs text-muted-foreground">
                {lastFetchTime.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 업데이트
              </span>
            )}
            <Badge variant="outline" className="animate-pulse text-red-500 border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800">
              LIVE
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[380px] pr-4">
          <div className="space-y-3">
            {news.map((item, index) => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => handleNewsClick(item, e)}
                className={`
                  block p-3 rounded-lg border bg-card transition-all cursor-pointer
                  hover:bg-accent/50 hover:border-primary/30 hover:shadow-sm
                  ${index === 0 ? 'border-l-4 border-l-red-500 shadow-sm' : ''}
                `}
              >
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px] h-5">
                      {item.category}
                    </Badge>
                    <span className="font-medium text-primary/80">{item.source}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {item.time}
                  </div>
                </div>
                <div className="font-medium flex items-start gap-1 text-sm leading-snug">
                  <span className="flex-1 line-clamp-2">{item.title}</span>
                  {item.url && item.url !== '#' && (
                    <ExternalLink className="h-3 w-3 mt-0.5 opacity-50 flex-shrink-0" />
                  )}
                </div>
              </a>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
