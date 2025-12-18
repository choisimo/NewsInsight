import { useState } from "react";
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  Eye,
  FileText,
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Scale,
  TrendingUp,
  Info,
  Percent,
  Hash,
  Clock,
  Layers,
  Target,
  Lightbulb,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Types for analytics data
export interface SourceCredibilityAnalysis {
  sourceName: string;
  isTrusted: boolean;
  trustScore: number; // 0-1
  trustLevel: "trusted" | "unknown" | "untrusted";
  reason: string;
  matchedTrustedSource?: string;
}

export interface ClickbaitAnalysis {
  isClickbait: boolean;
  score: number; // 0-1
  detectedPatterns: Array<{
    pattern: string;
    matchedText: string;
    severity: "low" | "medium" | "high";
  }>;
  totalPatternsChecked: number;
}

export interface MisinformationAnalysis {
  riskScore: number; // 0-1
  riskLevel: "low" | "medium" | "high";
  detectedPatterns: Array<{
    type: "misinformation" | "unverifiable";
    pattern: string;
    matchedText: string;
    severity: "low" | "medium" | "high";
  }>;
  unverifiableClaimCount: number;
}

export interface ClaimAnalysis {
  claimId: string;
  claimText: string;
  verdict: "verified" | "false" | "unverified" | "misleading" | "partially_true";
  confidence: number; // 0-1
  claimIndicator: string;
  analysisMethod: string;
  supportingFactors: string[];
  contradictingFactors: string[];
}

export interface ScoreBreakdown {
  sourceWeight: number; // 30%
  clickbaitWeight: number; // 20%
  misinfoWeight: number; // 20%
  verificationWeight: number; // 30%
  
  sourceContribution: number;
  clickbaitContribution: number;
  misinfoContribution: number;
  verificationContribution: number;
  
  totalScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
}

export interface FactCheckAnalytics {
  // Source analysis
  sourceAnalysis: SourceCredibilityAnalysis;
  
  // Clickbait detection
  clickbaitAnalysis: ClickbaitAnalysis;
  
  // Misinformation risk
  misinfoAnalysis: MisinformationAnalysis;
  
  // Claims breakdown
  claimAnalyses: ClaimAnalysis[];
  
  // Final score breakdown
  scoreBreakdown: ScoreBreakdown;
  
  // Metadata
  analysisVersion: string;
  processingTimeMs: number;
  analyzedAt: string;
  
  // ML-specific metadata (optional, only when backend ML is used)
  mlModelsUsed?: string[];
  externalApisUsed?: string[];
}

interface FactCheckAnalyticsPanelProps {
  analytics: FactCheckAnalytics | null;
  isLoading?: boolean;
}

// Helper components
const ScoreBar = ({ 
  label, 
  score, 
  weight, 
  contribution,
  colorClass = "bg-blue-500"
}: { 
  label: string; 
  score: number; 
  weight: number;
  contribution: number;
  colorClass?: string;
}) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs">
          가중치 {weight}%
        </Badge>
        <span className="font-medium">{Math.round(score * 100)}%</span>
      </div>
    </div>
    <Progress value={score * 100} className={`h-2 ${colorClass}`} />
    <div className="text-xs text-muted-foreground text-right">
      점수 기여: +{contribution.toFixed(1)}점
    </div>
  </div>
);

const PatternBadge = ({ 
  pattern, 
  severity 
}: { 
  pattern: string; 
  severity: "low" | "medium" | "high";
}) => {
  const severityColors = {
    low: "bg-yellow-100 text-yellow-800 border-yellow-200",
    medium: "bg-orange-100 text-orange-800 border-orange-200",
    high: "bg-red-100 text-red-800 border-red-200",
  };
  
  return (
    <Badge className={`${severityColors[severity]} border`}>
      {pattern}
    </Badge>
  );
};

const VerdictIcon = ({ verdict }: { verdict: ClaimAnalysis["verdict"] }) => {
  const icons = {
    verified: <CheckCircle2 className="h-4 w-4 text-green-500" />,
    false: <XCircle className="h-4 w-4 text-red-500" />,
    unverified: <HelpCircle className="h-4 w-4 text-gray-500" />,
    misleading: <AlertTriangle className="h-4 w-4 text-orange-500" />,
    partially_true: <Scale className="h-4 w-4 text-yellow-500" />,
  };
  return icons[verdict];
};

const GradeDisplay = ({ grade }: { grade: ScoreBreakdown["grade"] }) => {
  const gradeConfig = {
    A: { color: "bg-green-500", text: "text-green-600", label: "매우 신뢰" },
    B: { color: "bg-blue-500", text: "text-blue-600", label: "신뢰" },
    C: { color: "bg-yellow-500", text: "text-yellow-600", label: "주의 필요" },
    D: { color: "bg-orange-500", text: "text-orange-600", label: "신뢰 어려움" },
    F: { color: "bg-red-500", text: "text-red-600", label: "신뢰 불가" },
  };
  
  const config = gradeConfig[grade];
  
  return (
    <div className="flex items-center gap-2">
      <div className={`w-10 h-10 rounded-lg ${config.color} flex items-center justify-center`}>
        <span className="text-white font-bold text-lg">{grade}</span>
      </div>
      <span className={`text-sm font-medium ${config.text}`}>{config.label}</span>
    </div>
  );
};

export const FactCheckAnalyticsPanel = ({ 
  analytics, 
  isLoading = false 
}: FactCheckAnalyticsPanelProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 animate-pulse" />
            분석 통계 로딩 중...
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="h-4 bg-muted rounded animate-pulse" />
            <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
            <div className="h-4 bg-muted rounded animate-pulse w-1/2" />
          </div>
        </CardContent>
      </Card>
    );
  }
  
  if (!analytics) {
    return null;
  }
  
  const { 
    sourceAnalysis, 
    clickbaitAnalysis, 
    misinfoAnalysis, 
    claimAnalyses, 
    scoreBreakdown 
  } = analytics;
  
  return (
    <Card className="border-2 border-dashed border-purple-200 dark:border-purple-800">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                <BarChart3 className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <CardTitle className="text-lg">분석 과정 세부 통계</CardTitle>
                <CardDescription>
                  신뢰도 {scoreBreakdown.totalScore}점 산출 과정을 확인합니다
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <GradeDisplay grade={scoreBreakdown.grade} />
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm">
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>
        </CardHeader>
        
        <CollapsibleContent>
          <CardContent className="pt-4">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-5 mb-4">
                <TabsTrigger value="overview" className="text-xs">
                  <TrendingUp className="h-3 w-3 mr-1" />
                  종합
                </TabsTrigger>
                <TabsTrigger value="source" className="text-xs">
                  <Shield className="h-3 w-3 mr-1" />
                  출처
                </TabsTrigger>
                <TabsTrigger value="clickbait" className="text-xs">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  낚시성
                </TabsTrigger>
                <TabsTrigger value="misinfo" className="text-xs">
                  <XCircle className="h-3 w-3 mr-1" />
                  허위정보
                </TabsTrigger>
                <TabsTrigger value="claims" className="text-xs">
                  <FileText className="h-3 w-3 mr-1" />
                  주장
                </TabsTrigger>
              </TabsList>
              
              {/* Overview Tab */}
              <TabsContent value="overview" className="space-y-6">
                {/* Score Formula Explanation */}
                <div className="p-4 rounded-lg bg-muted/50">
                  <div className="flex items-start gap-2 mb-3">
                    <Lightbulb className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-sm">신뢰도 점수 산출 공식</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        총점 = (출처 신뢰도 × 30%) + (낚시성 미탐지 × 20%) + (허위정보 미탐지 × 20%) + (주장 검증률 × 30%)
                      </p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                    <div className="text-center p-2 rounded bg-background">
                      <div className="text-2xl font-bold text-blue-600">
                        {Math.round(sourceAnalysis.trustScore * 100)}%
                      </div>
                      <div className="text-xs text-muted-foreground">출처 신뢰도</div>
                    </div>
                    <div className="text-center p-2 rounded bg-background">
                      <div className="text-2xl font-bold text-green-600">
                        {clickbaitAnalysis.isClickbait ? "탐지" : "정상"}
                      </div>
                      <div className="text-xs text-muted-foreground">낚시성 여부</div>
                    </div>
                    <div className="text-center p-2 rounded bg-background">
                      <div className="text-2xl font-bold text-orange-600">
                        {misinfoAnalysis.riskLevel === "low" ? "낮음" : 
                         misinfoAnalysis.riskLevel === "medium" ? "중간" : "높음"}
                      </div>
                      <div className="text-xs text-muted-foreground">허위정보 위험</div>
                    </div>
                    <div className="text-center p-2 rounded bg-background">
                      <div className="text-2xl font-bold text-purple-600">
                        {claimAnalyses.filter(c => c.verdict === "verified").length}/{claimAnalyses.length}
                      </div>
                      <div className="text-xs text-muted-foreground">검증된 주장</div>
                    </div>
                  </div>
                </div>
                
                {/* Score Breakdown */}
                <div className="space-y-4">
                  <h4 className="font-medium flex items-center gap-2">
                    <Layers className="h-4 w-4" />
                    점수 구성 요소
                  </h4>
                  
                  <ScoreBar 
                    label="출처 신뢰도" 
                    score={sourceAnalysis.trustScore}
                    weight={scoreBreakdown.sourceWeight}
                    contribution={scoreBreakdown.sourceContribution}
                    colorClass="bg-blue-500"
                  />
                  
                  <ScoreBar 
                    label="낚시성 미탐지" 
                    score={clickbaitAnalysis.isClickbait ? 0.7 : 1}
                    weight={scoreBreakdown.clickbaitWeight}
                    contribution={scoreBreakdown.clickbaitContribution}
                    colorClass="bg-green-500"
                  />
                  
                  <ScoreBar 
                    label="허위정보 미탐지" 
                    score={1 - misinfoAnalysis.riskScore}
                    weight={scoreBreakdown.misinfoWeight}
                    contribution={scoreBreakdown.misinfoContribution}
                    colorClass="bg-orange-500"
                  />
                  
                  <ScoreBar 
                    label="주장 검증률" 
                    score={claimAnalyses.length > 0 
                      ? claimAnalyses.filter(c => c.verdict === "verified").length / claimAnalyses.length 
                      : 0}
                    weight={scoreBreakdown.verificationWeight}
                    contribution={scoreBreakdown.verificationContribution}
                    colorClass="bg-purple-500"
                  />
                  
                  <div className="pt-4 border-t">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">최종 신뢰도 점수</span>
                      <div className="flex items-center gap-2">
                        <span className="text-2xl font-bold">{scoreBreakdown.totalScore}</span>
                        <span className="text-muted-foreground">/ 100</span>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Metadata */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground pt-4 border-t">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    처리시간: {analytics.processingTimeMs}ms
                  </div>
                  <div className="flex items-center gap-1">
                    <Info className="h-3 w-3" />
                    분석 버전: {analytics.analysisVersion}
                  </div>
                </div>
              </TabsContent>
              
              {/* Source Analysis Tab */}
              <TabsContent value="source" className="space-y-4">
                <div className={`p-4 rounded-lg border-2 ${
                  sourceAnalysis.isTrusted 
                    ? "border-green-200 bg-green-50 dark:bg-green-900/20" 
                    : "border-yellow-200 bg-yellow-50 dark:bg-yellow-900/20"
                }`}>
                  <div className="flex items-start gap-3">
                    <Shield className={`h-6 w-6 ${
                      sourceAnalysis.isTrusted ? "text-green-600" : "text-yellow-600"
                    }`} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium">{sourceAnalysis.sourceName || "알 수 없는 출처"}</h4>
                        <Badge variant={sourceAnalysis.isTrusted ? "default" : "secondary"}>
                          {sourceAnalysis.trustLevel === "trusted" ? "신뢰 매체" : 
                           sourceAnalysis.trustLevel === "unknown" ? "미확인" : "비신뢰"}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{sourceAnalysis.reason}</p>
                      
                      <div className="mt-3 p-2 rounded bg-background/50">
                        <div className="flex items-center justify-between text-sm">
                          <span>출처 신뢰도 점수</span>
                          <span className="font-bold">{Math.round(sourceAnalysis.trustScore * 100)}%</span>
                        </div>
                        <Progress 
                          value={sourceAnalysis.trustScore * 100} 
                          className="h-2 mt-1" 
                        />
                      </div>
                      
                      {sourceAnalysis.matchedTrustedSource && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          매칭된 신뢰 매체: <span className="font-medium">{sourceAnalysis.matchedTrustedSource}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="p-4 rounded-lg bg-muted/50">
                  <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    출처 신뢰도 판별 기준
                  </h4>
                  <ul className="text-xs text-muted-foreground space-y-1">
                    <li>• 신뢰 매체 (90%): 연합뉴스, KBS, MBC, SBS, YTN, JTBC 등 17개</li>
                    <li>• 주요 신문 (80%): 조선일보, 중앙일보, 동아일보, 한겨레, 경향신문</li>
                    <li>• 인터넷 매체 (75%): 뉴시스, 뉴스1, 머니투데이, 이데일리</li>
                    <li>• 미확인 매체 (50%): 목록에 없는 출처</li>
                    <li>• 출처 없음 (30%): 출처 정보 미제공</li>
                  </ul>
                </div>
              </TabsContent>
              
              {/* Clickbait Analysis Tab */}
              <TabsContent value="clickbait" className="space-y-4">
                <div className={`p-4 rounded-lg border-2 ${
                  clickbaitAnalysis.isClickbait 
                    ? "border-red-200 bg-red-50 dark:bg-red-900/20" 
                    : "border-green-200 bg-green-50 dark:bg-green-900/20"
                }`}>
                  <div className="flex items-center gap-3 mb-3">
                    {clickbaitAnalysis.isClickbait ? (
                      <AlertTriangle className="h-6 w-6 text-red-600" />
                    ) : (
                      <CheckCircle2 className="h-6 w-6 text-green-600" />
                    )}
                    <div>
                      <h4 className="font-medium">
                        {clickbaitAnalysis.isClickbait ? "낚시성 콘텐츠 탐지됨" : "낚시성 콘텐츠 없음"}
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        {clickbaitAnalysis.totalPatternsChecked}개 패턴 중 {clickbaitAnalysis.detectedPatterns.length}개 탐지
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span>낚시성 점수</span>
                    <span className="font-bold">{Math.round(clickbaitAnalysis.score * 100)}%</span>
                  </div>
                  <Progress value={clickbaitAnalysis.score * 100} className="h-2" />
                </div>
                
                {clickbaitAnalysis.detectedPatterns.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-medium text-sm">탐지된 패턴</h4>
                    <div className="space-y-2">
                      {clickbaitAnalysis.detectedPatterns.map((pattern, idx) => (
                        <div key={idx} className="p-3 rounded-lg bg-muted/50 flex items-start gap-2">
                          <PatternBadge pattern={pattern.pattern} severity={pattern.severity} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate">"{pattern.matchedText}"</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="p-4 rounded-lg bg-muted/50">
                  <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    낚시성 탐지 패턴 목록
                  </h4>
                  <div className="flex flex-wrap gap-1 text-xs">
                    {["충격!", "경악!", "대박!", "헉!", "알고보니", "결국...", "드디어!", 
                      "...", "???", "!!!", "속보:", "단독:", "긴급:"].map(p => (
                      <Badge key={p} variant="outline" className="text-xs">{p}</Badge>
                    ))}
                  </div>
                </div>
              </TabsContent>
              
              {/* Misinformation Analysis Tab */}
              <TabsContent value="misinfo" className="space-y-4">
                <div className={`p-4 rounded-lg border-2 ${
                  misinfoAnalysis.riskLevel === "low" 
                    ? "border-green-200 bg-green-50 dark:bg-green-900/20" 
                    : misinfoAnalysis.riskLevel === "medium"
                    ? "border-yellow-200 bg-yellow-50 dark:bg-yellow-900/20"
                    : "border-red-200 bg-red-50 dark:bg-red-900/20"
                }`}>
                  <div className="flex items-center gap-3 mb-3">
                    {misinfoAnalysis.riskLevel === "low" ? (
                      <CheckCircle2 className="h-6 w-6 text-green-600" />
                    ) : misinfoAnalysis.riskLevel === "medium" ? (
                      <AlertTriangle className="h-6 w-6 text-yellow-600" />
                    ) : (
                      <XCircle className="h-6 w-6 text-red-600" />
                    )}
                    <div>
                      <h4 className="font-medium">
                        허위정보 위험도: {
                          misinfoAnalysis.riskLevel === "low" ? "낮음" :
                          misinfoAnalysis.riskLevel === "medium" ? "중간" : "높음"
                        }
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        검증 불가 주장 {misinfoAnalysis.unverifiableClaimCount}개 발견
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span>위험도 점수</span>
                    <span className="font-bold">{Math.round(misinfoAnalysis.riskScore * 100)}%</span>
                  </div>
                  <Progress value={misinfoAnalysis.riskScore * 100} className="h-2" />
                </div>
                
                {misinfoAnalysis.detectedPatterns.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-medium text-sm">탐지된 위험 패턴</h4>
                    <div className="space-y-2">
                      {misinfoAnalysis.detectedPatterns.map((pattern, idx) => (
                        <div key={idx} className="p-3 rounded-lg bg-muted/50">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant={pattern.type === "misinformation" ? "destructive" : "secondary"}>
                              {pattern.type === "misinformation" ? "허위정보 패턴" : "검증 불가 표현"}
                            </Badge>
                            <PatternBadge pattern={pattern.pattern} severity={pattern.severity} />
                          </div>
                          <p className="text-sm text-muted-foreground">"{pattern.matchedText}"</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg bg-muted/50">
                    <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                      허위정보 패턴
                    </h4>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p>• "정부가 숨기"</p>
                      <p>• "언론이 보도하지 않는"</p>
                      <p>• "비밀리에"</p>
                      <p>• "충격 진실"</p>
                      <p>• "알려지지 않은 진실"</p>
                    </div>
                  </div>
                  
                  <div className="p-4 rounded-lg bg-muted/50">
                    <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                      <HelpCircle className="h-4 w-4 text-yellow-500" />
                      검증 불가 표현
                    </h4>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p>• "최초", "유일", "최고"</p>
                      <p>• "100%", "모든 사람"</p>
                      <p>• "아무도", "절대"</p>
                      <p>• "반드시"</p>
                    </div>
                  </div>
                </div>
              </TabsContent>
              
              {/* Claims Analysis Tab */}
              <TabsContent value="claims" className="space-y-4">
                <div className="grid grid-cols-5 gap-2 mb-4">
                  {[
                    { verdict: "verified", label: "검증됨", color: "bg-green-500" },
                    { verdict: "partially_true", label: "일부 사실", color: "bg-yellow-500" },
                    { verdict: "unverified", label: "미검증", color: "bg-gray-500" },
                    { verdict: "misleading", label: "오해 소지", color: "bg-orange-500" },
                    { verdict: "false", label: "거짓", color: "bg-red-500" },
                  ].map(({ verdict, label, color }) => (
                    <div key={verdict} className="text-center p-2 rounded bg-muted/50">
                      <div className={`w-4 h-4 rounded-full ${color} mx-auto mb-1`} />
                      <div className="text-lg font-bold">
                        {claimAnalyses.filter(c => c.verdict === verdict).length}
                      </div>
                      <div className="text-xs text-muted-foreground">{label}</div>
                    </div>
                  ))}
                </div>
                
                <div className="space-y-3">
                  {claimAnalyses.map((claim, idx) => (
                    <Collapsible key={claim.claimId}>
                      <div className="p-3 rounded-lg border bg-card">
                        <CollapsibleTrigger className="w-full">
                          <div className="flex items-start gap-3">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">#{idx + 1}</span>
                              <VerdictIcon verdict={claim.verdict} />
                            </div>
                            <div className="flex-1 text-left">
                              <p className="text-sm line-clamp-2">{claim.claimText}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge variant="outline" className="text-xs">
                                  {claim.claimIndicator}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  신뢰도 {Math.round(claim.confidence * 100)}%
                                </span>
                              </div>
                            </div>
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </CollapsibleTrigger>
                        
                        <CollapsibleContent className="mt-3 pt-3 border-t">
                          <div className="space-y-3">
                            <div>
                              <span className="text-xs font-medium">분석 방법</span>
                              <p className="text-xs text-muted-foreground">{claim.analysisMethod}</p>
                            </div>
                            
                            {claim.supportingFactors.length > 0 && (
                              <div>
                                <span className="text-xs font-medium text-green-600 flex items-center gap-1">
                                  <CheckCircle2 className="h-3 w-3" />
                                  지지 요소
                                </span>
                                <ul className="text-xs text-muted-foreground mt-1 space-y-1">
                                  {claim.supportingFactors.map((f, i) => (
                                    <li key={i}>• {f}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            
                            {claim.contradictingFactors.length > 0 && (
                              <div>
                                <span className="text-xs font-medium text-red-600 flex items-center gap-1">
                                  <XCircle className="h-3 w-3" />
                                  반박 요소
                                </span>
                                <ul className="text-xs text-muted-foreground mt-1 space-y-1">
                                  {claim.contradictingFactors.map((f, i) => (
                                    <li key={i}>• {f}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  ))}
                </div>
                
                <div className="p-4 rounded-lg bg-muted/50">
                  <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                    <Hash className="h-4 w-4" />
                    주장 추출 기준 (Claim Indicators)
                  </h4>
                  <div className="flex flex-wrap gap-1 text-xs">
                    {["~라고 밝혔다", "~라고 주장했다", "~라고 전했다", 
                      "~에 따르면", "~것으로 알려졌다", "~것으로 확인됐다",
                      "관계자는", "전문가는", "소식통에 따르면"].map(indicator => (
                      <Badge key={indicator} variant="outline" className="text-xs">{indicator}</Badge>
                    ))}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

export default FactCheckAnalyticsPanel;
