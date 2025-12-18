/**
 * MCP Analysis Panel
 *
 * 종합적인 MCP 분석 결과를 표시하는 대시보드 패널
 * - 편향도 게이지
 * - 신뢰도 점수
 * - 감성 분포
 * - 주요 토픽
 */

import { useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  analyzeComprehensive,
  getBiasLabel,
  getBiasColor,
  getReliabilityLabel,
  getReliabilityColor,
  getSentimentLabel,
  getSentimentColor,
  type ComprehensiveAnalysisResult,
  type BiasAnalysisData,
  type FactcheckAnalysisData,
  type SentimentAnalysisData,
  type TopicAnalysisData,
} from '@/lib/api/mcp';

interface MCPAnalysisPanelProps {
  keyword: string;
  days?: number;
  className?: string;
  onAnalysisComplete?: (result: ComprehensiveAnalysisResult) => void;
}

export function MCPAnalysisPanel({
  keyword,
  days = 7,
  className,
  onAnalysisComplete,
}: MCPAnalysisPanelProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ComprehensiveAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const analysisResult = await analyzeComprehensive({ keyword, days });
      setResult(analysisResult);
      onAnalysisComplete?.(analysisResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : '분석 중 오류가 발생했습니다');
    } finally {
      setIsLoading(false);
    }
  };

  // 로딩 상태
  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            분석 중...
          </CardTitle>
          <CardDescription>"{keyword}"에 대한 종합 분석을 수행하고 있습니다</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  // 에러 상태
  if (error) {
    return (
      <Card className={cn('border-destructive/50', className)}>
        <CardContent className="py-6">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button variant="outline" size="sm" onClick={runAnalysis} className="mt-4">
            <RefreshCw className="h-4 w-4 mr-2" />
            다시 시도
          </Button>
        </CardContent>
      </Card>
    );
  }

  // 초기 상태 또는 결과 없음
  if (!result) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>MCP 종합 분석</CardTitle>
          <CardDescription>
            "{keyword}"에 대한 편향도, 신뢰도, 감성, 토픽을 분석합니다
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={runAnalysis} className="w-full">
            <TrendingUp className="h-4 w-4 mr-2" />
            분석 시작
          </Button>
        </CardContent>
      </Card>
    );
  }

  // 결과 렌더링
  const { results } = result;
  const biasData = 'data' in results.bias ? (results.bias.data as BiasAnalysisData) : null;
  const factcheckData =
    'data' in results.factcheck ? (results.factcheck.data as FactcheckAnalysisData) : null;
  const sentimentData =
    'data' in results.sentiment ? (results.sentiment.data as SentimentAnalysisData) : null;
  const topicData = 'data' in results.topic ? (results.topic.data as TopicAnalysisData) : null;

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>MCP 종합 분석 결과</CardTitle>
            <CardDescription>
              "{keyword}" · 최근 {days}일
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={result.success ? 'default' : 'secondary'}>
              {Math.round(result.success_rate * 100)}% 성공
            </Badge>
            <Button variant="ghost" size="icon" onClick={runAnalysis}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="bias" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="bias">편향도</TabsTrigger>
            <TabsTrigger value="factcheck">신뢰도</TabsTrigger>
            <TabsTrigger value="sentiment">감성</TabsTrigger>
            <TabsTrigger value="topic">토픽</TabsTrigger>
          </TabsList>

          {/* 편향도 탭 */}
          <TabsContent value="bias" className="mt-4">
            {biasData ? (
              <BiasAnalysisCard data={biasData} />
            ) : (
              <ErrorMessage message={'error' in results.bias ? results.bias.error : '데이터 없음'} />
            )}
          </TabsContent>

          {/* 신뢰도 탭 */}
          <TabsContent value="factcheck" className="mt-4">
            {factcheckData ? (
              <FactcheckAnalysisCard data={factcheckData} />
            ) : (
              <ErrorMessage
                message={'error' in results.factcheck ? results.factcheck.error : '데이터 없음'}
              />
            )}
          </TabsContent>

          {/* 감성 탭 */}
          <TabsContent value="sentiment" className="mt-4">
            {sentimentData ? (
              <SentimentAnalysisCard data={sentimentData} />
            ) : (
              <ErrorMessage
                message={'error' in results.sentiment ? results.sentiment.error : '데이터 없음'}
              />
            )}
          </TabsContent>

          {/* 토픽 탭 */}
          <TabsContent value="topic" className="mt-4">
            {topicData ? (
              <TopicAnalysisCard data={topicData} />
            ) : (
              <ErrorMessage
                message={'error' in results.topic ? results.topic.error : '데이터 없음'}
              />
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────
// Sub Components
// ─────────────────────────────────────────────

function ErrorMessage({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function BiasAnalysisCard({ data }: { data: BiasAnalysisData }) {
  const biasPercent = ((data.overall_bias + 1) / 2) * 100; // -1~1 → 0~100

  return (
    <div className="space-y-4">
      {/* 편향도 게이지 */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-blue-600">진보</span>
          <span className="font-medium">{getBiasLabel(data.overall_bias)}</span>
          <span className="text-red-600">보수</span>
        </div>
        <div className="relative h-3 bg-gradient-to-r from-blue-500 via-gray-300 to-red-500 rounded-full">
          <div
            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white border-2 border-gray-800 rounded-full shadow"
            style={{ left: `calc(${biasPercent}% - 8px)` }}
          />
        </div>
      </div>

      {/* 통계 */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 rounded-lg bg-muted">
          <div className="text-xs text-muted-foreground">객관성 점수</div>
          <div className="text-lg font-semibold">{(data.objectivity_score * 100).toFixed(0)}%</div>
        </div>
        <div className="p-3 rounded-lg bg-muted">
          <div className="text-xs text-muted-foreground">신뢰도</div>
          <div className="text-lg font-semibold">{(data.confidence * 100).toFixed(0)}%</div>
        </div>
      </div>

      {/* 언론사 분포 */}
      {data.source_distribution && Object.keys(data.source_distribution).length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2">언론사별 분포</h4>
          <div className="space-y-1">
            {Object.entries(data.source_distribution)
              .slice(0, 5)
              .map(([source, count]) => (
                <div key={source} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{source}</span>
                  <Badge variant="secondary">{count}건</Badge>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FactcheckAnalysisCard({ data }: { data: FactcheckAnalysisData }) {
  const reliabilityPercent = data.reliability_score * 100;

  return (
    <div className="space-y-4">
      {/* 신뢰도 점수 */}
      <div className="text-center p-4 rounded-lg bg-muted">
        <div className="text-3xl font-bold" style={{ color: `var(--${getReliabilityColor(data.reliability_score)})` }}>
          {reliabilityPercent.toFixed(0)}%
        </div>
        <div className="text-sm text-muted-foreground">
          {getReliabilityLabel(data.reliability_score)}
        </div>
      </div>

      {/* 검증 현황 */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <span className="text-xs text-muted-foreground">검증된 주장</span>
          </div>
          <div className="text-lg font-semibold text-green-600">{data.verified_claims}</div>
        </div>
        <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-yellow-600" />
            <span className="text-xs text-muted-foreground">미검증 주장</span>
          </div>
          <div className="text-lg font-semibold text-yellow-600">{data.unverified_claims}</div>
        </div>
      </div>

      {/* 인용 품질 */}
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span>인용 품질</span>
          <span>{(data.citation_quality * 100).toFixed(0)}%</span>
        </div>
        <Progress value={data.citation_quality * 100} />
      </div>
    </div>
  );
}

function SentimentAnalysisCard({ data }: { data: SentimentAnalysisData }) {
  const total = data.distribution.positive + data.distribution.negative + data.distribution.neutral;
  const posPercent = total > 0 ? (data.distribution.positive / total) * 100 : 0;
  const negPercent = total > 0 ? (data.distribution.negative / total) * 100 : 0;
  const neuPercent = total > 0 ? (data.distribution.neutral / total) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* 전체 감성 */}
      <div className="text-center p-4 rounded-lg bg-muted">
        <Badge
          variant="outline"
          className={cn(
            'text-lg px-4 py-1',
            data.overall_sentiment === 'positive' && 'border-green-500 text-green-600',
            data.overall_sentiment === 'negative' && 'border-red-500 text-red-600',
            data.overall_sentiment === 'neutral' && 'border-gray-500 text-gray-600'
          )}
        >
          {getSentimentLabel(data.overall_sentiment)}
        </Badge>
        <div className="text-sm text-muted-foreground mt-2">
          점수: {(data.sentiment_score * 100).toFixed(0)} · 신뢰도: {(data.confidence * 100).toFixed(0)}%
        </div>
      </div>

      {/* 분포 차트 */}
      <div className="space-y-3">
        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-green-600">긍정</span>
            <span>{posPercent.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-green-500" style={{ width: `${posPercent}%` }} />
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">중립</span>
            <span>{neuPercent.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-gray-400" style={{ width: `${neuPercent}%` }} />
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-red-600">부정</span>
            <span>{negPercent.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-red-500" style={{ width: `${negPercent}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TopicAnalysisCard({ data }: { data: TopicAnalysisData }) {
  return (
    <div className="space-y-4">
      {/* 주요 토픽 */}
      <div>
        <h4 className="text-sm font-medium mb-2">주요 토픽</h4>
        <div className="flex flex-wrap gap-2">
          {data.main_topics.slice(0, 8).map((topic, idx) => (
            <Badge key={idx} variant={idx < 3 ? 'default' : 'secondary'}>
              {topic.topic}
              <span className="ml-1 opacity-70">{(topic.relevance * 100).toFixed(0)}%</span>
            </Badge>
          ))}
        </div>
      </div>

      {/* 관련 엔티티 */}
      {data.related_entities && data.related_entities.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2">관련 인물/기관</h4>
          <div className="flex flex-wrap gap-1">
            {data.related_entities.slice(0, 10).map((entity, idx) => (
              <Badge key={idx} variant="outline" className="text-xs">
                {entity}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* 카테고리 분포 */}
      {data.category_distribution && Object.keys(data.category_distribution).length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2">카테고리 분포</h4>
          <div className="space-y-2">
            {Object.entries(data.category_distribution)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 5)
              .map(([category, count]) => (
                <div key={category} className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground w-20 truncate">{category}</span>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary"
                      style={{
                        width: `${(count / Math.max(...Object.values(data.category_distribution))) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground w-8 text-right">{count}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default MCPAnalysisPanel;
