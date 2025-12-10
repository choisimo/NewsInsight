import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, TrendingUp, Clock } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface NewsItem {
  id: string;
  title: string;
  source: string;
  time: string;
  url: string;
  category: string;
}

// Mock data generator
const generateMockNews = (): NewsItem => {
  const sources = ["연합뉴스", "KBS", "MBC", "SBS", "YTN", "매일경제", "한국경제"];
  const categories = ["정치", "경제", "사회", "국제", "IT/과학"];
  const titles = [
    "인공지능 기술의 발전과 미래 전망",
    "글로벌 경제 위기와 대응 방안",
    "기후 변화에 따른 새로운 환경 정책 발표",
    "국내 스타트업 투자 유치 성공 사례",
    "차세대 반도체 기술 개발 경쟁 심화",
    "우주 산업의 새로운 도약과 과제",
    "디지털 금융 혁신과 소비자 보호",
    "스마트시티 구축을 위한 민관 협력 강화"
  ];

  return {
    id: Math.random().toString(36).substr(2, 9),
    title: titles[Math.floor(Math.random() * titles.length)],
    source: sources[Math.floor(Math.random() * sources.length)],
    time: new Date().toLocaleTimeString(),
    url: "#",
    category: categories[Math.floor(Math.random() * categories.length)],
  };
};

export function LiveNewsTicker() {
  const [news, setNews] = useState<NewsItem[]>([]);

  useEffect(() => {
    // Initial data
    const initialNews = Array.from({ length: 5 }, generateMockNews);
    setNews(initialNews);

    // Add new item every 3 seconds
    const interval = setInterval(() => {
      setNews(prev => [generateMockNews(), ...prev].slice(0, 20));
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-bold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-red-500" />
            실시간 뉴스 브리핑
          </CardTitle>
          <Badge variant="outline" className="animate-pulse text-red-500 border-red-200 bg-red-50">
            LIVE
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[300px] pr-4">
          <div className="space-y-4">
            {news.map((item, index) => (
              <div 
                key={item.id} 
                className={`flex flex-col gap-1 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-all ${index === 0 ? 'border-l-4 border-l-red-500 shadow-sm' : ''}`}
              >
                <div className="flex items-center justify-between text-xs text-muted-foreground">
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
                <a 
                  href={item.url} 
                  className="font-medium hover:underline hover:text-primary flex items-start gap-1 mt-1"
                >
                  {item.title}
                  <ExternalLink className="h-3 w-3 mt-1 opacity-50" />
                </a>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
