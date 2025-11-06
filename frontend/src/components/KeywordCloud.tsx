import { Card } from "@/components/ui/card";
import type { KeywordData } from "@/types/api";

interface KeywordCloudProps {
  keywords: KeywordData[];
}

export function KeywordCloud({ keywords }: KeywordCloudProps) {
  const maxScore = Math.max(...keywords.map((k) => k.score), 1);
  
  const getFontSize = (score: number) => {
    const normalized = (score / maxScore) * 100;
    return Math.max(12, Math.min(48, normalized / 2));
  };

  const getColor = (index: number) => {
    const colors = [
      "hsl(217, 91%, 60%)",
      "hsl(217, 91%, 45%)",
      "hsl(217, 91%, 75%)",
      "hsl(142, 71%, 45%)",
      "hsl(217, 91%, 35%)",
    ];
    return colors[index % colors.length];
  };

  return (
    <Card className="p-6 shadow-elegant card-hover">
      <h2 className="text-xl font-bold mb-6">핵심 키워드</h2>
      <div className="min-h-[300px] flex flex-wrap items-center justify-center gap-4 p-6">
        {keywords.length > 0 ? (
          keywords.map((keyword, index) => (
            <span
              key={`${keyword.word}-${index}`}
              className="font-semibold transition-transform hover:scale-110 cursor-default"
              style={{
                fontSize: `${getFontSize(keyword.score)}px`,
                color: getColor(index),
                lineHeight: 1.5,
              }}
              title={`중요도: ${keyword.score.toFixed(2)}`}
            >
              {keyword.word}
            </span>
          ))
        ) : (
          <div className="text-center text-muted-foreground py-12">
            키워드 데이터가 없습니다.
          </div>
        )}
      </div>
    </Card>
  );
}
