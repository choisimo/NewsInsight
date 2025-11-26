import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Search,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  ThumbsUp,
  ThumbsDown,
  Minus,
  ArrowLeft,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  startDeepSearch,
  getDeepSearchStatus,
  getDeepSearchResult,
  cancelDeepSearch,
  checkDeepSearchHealth,
  type DeepSearchJob,
  type DeepSearchResult,
  type Evidence,
} from "@/lib/api";

const STATUS_CONFIG = {
  PENDING: { label: "대기 중", icon: Clock, color: "bg-yellow-500" },
  IN_PROGRESS: { label: "분석 중", icon: Loader2, color: "bg-blue-500" },
  COMPLETED: { label: "완료", icon: CheckCircle2, color: "bg-green-500" },
  FAILED: { label: "실패", icon: XCircle, color: "bg-red-500" },
  CANCELLED: { label: "취소됨", icon: XCircle, color: "bg-gray-500" },
  TIMEOUT: { label: "시간 초과", icon: AlertCircle, color: "bg-orange-500" },
} as const;

const STANCE_CONFIG = {
  pro: { label: "찬성", icon: ThumbsUp, color: "text-green-600", bgColor: "bg-green-100 dark:bg-green-900/30" },
  con: { label: "반대", icon: ThumbsDown, color: "text-red-600", bgColor: "bg-red-100 dark:bg-red-900/30" },
  neutral: { label: "중립", icon: Minus, color: "text-gray-600", bgColor: "bg-gray-100 dark:bg-gray-800" },
} as const;

interface EvidenceCardProps {
  evidence: Evidence;
}

const EvidenceCard = ({ evidence }: EvidenceCardProps) => {
  const stanceInfo = STANCE_CONFIG[evidence.stance];
  const StanceIcon = stanceInfo.icon;

  return (
    <Card className={`${stanceInfo.bgColor} border-l-4 ${evidence.stance === 'pro' ? 'border-l-green-500' : evidence.stance === 'con' ? 'border-l-red-500' : 'border-l-gray-400'}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className={`${stanceInfo.color} flex items-center gap-1`}>
                <StanceIcon className="h-3 w-3" />
                {stanceInfo.label}
              </Badge>
              {evidence.source && (
                <span className="text-xs text-muted-foreground truncate">{evidence.source}</span>
              )}
            </div>
            {evidence.title && (
              <h4 className="font-semibold text-sm mb-1 line-clamp-2">{evidence.title}</h4>
            )}
            <p className="text-sm text-muted-foreground line-clamp-3">{evidence.snippet}</p>
          </div>
          <a
            href={evidence.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 p-2 rounded-md hover:bg-muted transition-colors"
            title="원문 보기"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </CardContent>
    </Card>
  );
};

interface StanceChartProps {
  distribution: DeepSearchResult["stanceDistribution"];
}

const StanceChart = ({ distribution }: StanceChartProps) => {
  const total = distribution.pro + distribution.con + distribution.neutral;
  if (total === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">입장 분포</CardTitle>
        <CardDescription>수집된 증거의 입장 분석 결과</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-1 h-8 rounded-lg overflow-hidden">
          {distribution.proRatio > 0 && (
            <div
              className="bg-green-500 flex items-center justify-center text-white text-xs font-medium transition-all"
              style={{ width: `${distribution.proRatio}%` }}
            >
              {distribution.proRatio >= 10 && `${distribution.proRatio.toFixed(0)}%`}
            </div>
          )}
          {distribution.neutralRatio > 0 && (
            <div
              className="bg-gray-400 flex items-center justify-center text-white text-xs font-medium transition-all"
              style={{ width: `${distribution.neutralRatio}%` }}
            >
              {distribution.neutralRatio >= 10 && `${distribution.neutralRatio.toFixed(0)}%`}
            </div>
          )}
          {distribution.conRatio > 0 && (
            <div
              className="bg-red-500 flex items-center justify-center text-white text-xs font-medium transition-all"
              style={{ width: `${distribution.conRatio}%` }}
            >
              {distribution.conRatio >= 10 && `${distribution.conRatio.toFixed(0)}%`}
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="flex items-center justify-center gap-1 text-green-600 mb-1">
              <ThumbsUp className="h-4 w-4" />
              <span className="font-bold">{distribution.pro}</span>
            </div>
            <span className="text-xs text-muted-foreground">찬성</span>
          </div>
          <div>
            <div className="flex items-center justify-center gap-1 text-gray-600 mb-1">
              <Minus className="h-4 w-4" />
              <span className="font-bold">{distribution.neutral}</span>
            </div>
            <span className="text-xs text-muted-foreground">중립</span>
          </div>
          <div>
            <div className="flex items-center justify-center gap-1 text-red-600 mb-1">
              <ThumbsDown className="h-4 w-4" />
              <span className="font-bold">{distribution.con}</span>
            </div>
            <span className="text-xs text-muted-foreground">반대</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const DeepSearch = () => {
  const { toast } = useToast();
  const [topic, setTopic] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [currentJob, setCurrentJob] = useState<DeepSearchJob | null>(null);
  const [result, setResult] = useState<DeepSearchResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isHealthy, setIsHealthy] = useState<boolean | null>(null);
  const [activeStance, setActiveStance] = useState<"all" | "pro" | "con" | "neutral">("all");

  // Check health on mount
  useEffect(() => {
    checkDeepSearchHealth()
      .then((health) => setIsHealthy(health.enabled))
      .catch(() => setIsHealthy(false));
  }, []);

  // Poll for status when job is in progress
  useEffect(() => {
    if (!currentJob) return;
    if (currentJob.status === "COMPLETED" || currentJob.status === "FAILED" || 
        currentJob.status === "CANCELLED" || currentJob.status === "TIMEOUT") {
      return;
    }

    const pollInterval = setInterval(async () => {
      try {
        const status = await getDeepSearchStatus(currentJob.jobId);
        setCurrentJob(status);

        if (status.status === "COMPLETED") {
          const fullResult = await getDeepSearchResult(status.jobId);
          setResult(fullResult);
          toast({
            title: "분석 완료",
            description: `${fullResult.evidence.length}개의 증거를 수집했습니다.`,
          });
        } else if (status.status === "FAILED" || status.status === "TIMEOUT") {
          toast({
            title: "분석 실패",
            description: status.errorMessage || "알 수 없는 오류가 발생했습니다.",
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error("Polling error:", error);
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [currentJob, toast]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setResult(null);
    setCurrentJob(null);

    try {
      const job = await startDeepSearch({
        topic: topic.trim(),
        baseUrl: baseUrl.trim() || undefined,
      });
      setCurrentJob(job);
      toast({
        title: "분석 시작",
        description: "Deep AI Search를 시작했습니다. 잠시 기다려주세요.",
      });
    } catch (error: any) {
      toast({
        title: "오류",
        description: error.response?.data?.message || error.message || "분석 시작에 실패했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [topic, baseUrl, isSubmitting, toast]);

  const handleCancel = useCallback(async () => {
    if (!currentJob) return;
    try {
      const cancelled = await cancelDeepSearch(currentJob.jobId);
      setCurrentJob(cancelled);
      toast({
        title: "취소됨",
        description: "분석이 취소되었습니다.",
      });
    } catch (error: any) {
      toast({
        title: "오류",
        description: "취소에 실패했습니다.",
        variant: "destructive",
      });
    }
  }, [currentJob, toast]);

  const handleReset = useCallback(() => {
    setCurrentJob(null);
    setResult(null);
    setTopic("");
    setBaseUrl("");
    setActiveStance("all");
  }, []);

  const filteredEvidence = result?.evidence.filter(
    (e) => activeStance === "all" || e.stance === activeStance
  ) ?? [];

  const isProcessing = currentJob && 
    (currentJob.status === "PENDING" || currentJob.status === "IN_PROGRESS");

  return (
    <div className="min-h-screen py-8">
      <div className="container mx-auto px-4 max-w-5xl">
        {/* Header */}
        <header className="mb-8">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            메인으로 돌아가기
          </Link>
          <h1 className="text-3xl md:text-4xl font-bold mb-2 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Deep AI Search
          </h1>
          <p className="text-muted-foreground">
            AI 기반 심층 분석으로 주제에 대한 다양한 입장과 증거를 수집합니다.
          </p>
          {isHealthy === false && (
            <div className="mt-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Deep Search 서비스가 현재 사용 불가능합니다.
            </div>
          )}
        </header>

        {/* Search Form */}
        <Card className="mb-8">
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="topic" className="block text-sm font-medium mb-2">
                  분석 주제 *
                </label>
                <Input
                  id="topic"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="예: 원자력 발전의 장단점"
                  disabled={isProcessing || isHealthy === false}
                  className="text-lg"
                />
              </div>
              <div>
                <label htmlFor="baseUrl" className="block text-sm font-medium mb-2">
                  검색 시작 URL (선택)
                </label>
                <Input
                  id="baseUrl"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://example.com"
                  disabled={isProcessing || isHealthy === false}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  특정 사이트에서 시작하여 검색하려면 URL을 입력하세요.
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  type="submit"
                  disabled={!topic.trim() || isProcessing || isHealthy === false}
                  className="flex-1"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      시작 중...
                    </>
                  ) : (
                    <>
                      <Search className="h-4 w-4 mr-2" />
                      분석 시작
                    </>
                  )}
                </Button>
                {(currentJob || result) && (
                  <Button type="button" variant="outline" onClick={handleReset}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    초기화
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Processing Status */}
        {isProcessing && currentJob && (
          <Card className="mb-8">
            <CardContent className="py-8">
              <div className="text-center space-y-4">
                <Loader2 className="h-12 w-12 mx-auto animate-spin text-primary" />
                <div>
                  <h3 className="font-semibold text-lg">
                    {currentJob.status === "PENDING" ? "대기 중..." : "분석 중..."}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    '{currentJob.topic}'에 대해 다양한 출처를 분석하고 있습니다.
                  </p>
                </div>
                <Progress value={currentJob.status === "PENDING" ? 10 : 50} className="max-w-md mx-auto" />
                <Button variant="outline" size="sm" onClick={handleCancel}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  분석 취소
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error/Cancelled State */}
        {currentJob && (currentJob.status === "FAILED" || currentJob.status === "CANCELLED" || currentJob.status === "TIMEOUT") && !result && (
          <Card className="mb-8">
            <CardContent className="py-8">
              <div className="text-center space-y-4">
                {currentJob.status === "FAILED" ? (
                  <XCircle className="h-12 w-12 mx-auto text-destructive" />
                ) : currentJob.status === "TIMEOUT" ? (
                  <AlertCircle className="h-12 w-12 mx-auto text-orange-500" />
                ) : (
                  <XCircle className="h-12 w-12 mx-auto text-muted-foreground" />
                )}
                <div>
                  <h3 className="font-semibold text-lg">
                    {STATUS_CONFIG[currentJob.status].label}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {currentJob.errorMessage || "분석이 완료되지 않았습니다."}
                  </p>
                </div>
                <Button variant="outline" onClick={handleReset}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  다시 시도
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-6">
            {/* Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center">
                    <p className="text-3xl font-bold">{result.evidence.length}</p>
                    <p className="text-sm text-muted-foreground">수집된 증거</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center">
                    <p className="text-3xl font-bold text-green-600">
                      {result.stanceDistribution.proRatio.toFixed(0)}%
                    </p>
                    <p className="text-sm text-muted-foreground">찬성 비율</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center">
                    <p className="text-3xl font-bold text-red-600">
                      {result.stanceDistribution.conRatio.toFixed(0)}%
                    </p>
                    <p className="text-sm text-muted-foreground">반대 비율</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Stance Distribution */}
            <StanceChart distribution={result.stanceDistribution} />

            {/* Evidence List */}
            <Card>
              <CardHeader>
                <CardTitle>수집된 증거</CardTitle>
                <CardDescription>
                  '{result.topic}'에 대해 수집된 다양한 입장의 증거입니다.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs value={activeStance} onValueChange={(v) => setActiveStance(v as typeof activeStance)}>
                  <TabsList className="mb-4">
                    <TabsTrigger value="all">
                      전체 ({result.evidence.length})
                    </TabsTrigger>
                    <TabsTrigger value="pro" className="text-green-600">
                      찬성 ({result.stanceDistribution.pro})
                    </TabsTrigger>
                    <TabsTrigger value="neutral">
                      중립 ({result.stanceDistribution.neutral})
                    </TabsTrigger>
                    <TabsTrigger value="con" className="text-red-600">
                      반대 ({result.stanceDistribution.con})
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value={activeStance} className="space-y-4">
                    {filteredEvidence.length > 0 ? (
                      filteredEvidence.map((evidence) => (
                        <EvidenceCard key={evidence.id} evidence={evidence} />
                      ))
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        해당 입장의 증거가 없습니다.
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            {/* Meta Info */}
            <div className="text-center text-xs text-muted-foreground">
              분석 완료: {result.completedAt ? new Date(result.completedAt).toLocaleString("ko-KR") : "-"}
              {" | "}
              Job ID: {result.jobId}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!currentJob && !result && (
          <div className="text-center py-16">
            <div className="inline-block p-4 rounded-full bg-accent/10 mb-4">
              <Search className="h-12 w-12 text-accent" />
            </div>
            <h2 className="text-xl font-semibold mb-2">주제를 입력하세요</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              분석하고 싶은 주제를 입력하면 AI가 웹에서 다양한 입장의 증거를 수집하고 분류합니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DeepSearch;
