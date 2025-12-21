/**
 * ML 분석 결과 페이지
 * 
 * - 특정 기사의 ML 분석 결과 확인
 * - 전체 ML 실행 이력 조회
 * - 분석 결과 상세 보기 (시각화)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Brain,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Filter,
  Search,
  Activity,
  Inbox,
  ThumbsUp,
  ThumbsDown,
  Minus,
  MessageSquare,
  Shield,
  Scale,
  Tag,
  Users,
  MapPin,
  Building,
  FileText,
  AlertTriangle,
  Info,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useMlExecutions, useArticleAnalysis } from '@/hooks/useMlAddons';
import { getCollectedData, type CollectedDataDTO } from '@/lib/api/data';
import { getCategoryLabel, getExecutionStatusLabel, getExecutionStatusColor } from '@/lib/api/ml';
import type { MlAddonExecution, ExecutionStatus, MlAnalysisResults } from '@/types/api';

// ============================================
// Status Badge Component
// ============================================

const StatusBadge: React.FC<{ status: ExecutionStatus }> = ({ status }) => {
  const label = getExecutionStatusLabel(status);
  const colorKey = getExecutionStatusColor(status);
  
  const colorClasses: Record<string, string> = {
    yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    green: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    red: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    gray: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
    slate: 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-200',
  };

  const StatusIcon = () => {
    switch (status) {
      case 'SUCCESS':
        return <CheckCircle2 className="h-3 w-3" />;
      case 'FAILED':
        return <XCircle className="h-3 w-3" />;
      case 'RUNNING':
        return <Loader2 className="h-3 w-3 animate-spin" />;
      case 'PENDING':
        return <Clock className="h-3 w-3" />;
      default:
        return <AlertCircle className="h-3 w-3" />;
    }
  };

  return (
    <Badge className={`${colorClasses[colorKey] || colorClasses.gray} flex items-center gap-1`}>
      <StatusIcon />
      {label}
    </Badge>
  );
};

// ============================================
// Analysis Result Renderers
// ============================================

// 감정 분석 결과
const SentimentResult: React.FC<{ data: MlAnalysisResults['sentiment'] }> = ({ data }) => {
  if (!data) return null;
  
  const getSentimentIcon = () => {
    switch (data.label) {
      case 'positive': return <ThumbsUp className="h-5 w-5 text-green-500" />;
      case 'negative': return <ThumbsDown className="h-5 w-5 text-red-500" />;
      default: return <Minus className="h-5 w-5 text-gray-500" />;
    }
  };
  
  const getSentimentColor = () => {
    switch (data.label) {
      case 'positive': return 'text-green-600';
      case 'negative': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };
  
  const getSentimentLabel = () => {
    switch (data.label) {
      case 'positive': return '긍정적';
      case 'negative': return '부정적';
      default: return '중립';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {getSentimentIcon()}
        <div>
          <p className={`text-lg font-semibold ${getSentimentColor()}`}>
            {getSentimentLabel()}
          </p>
          <p className="text-sm text-muted-foreground">
            신뢰도: {(data.score * 100).toFixed(1)}%
          </p>
        </div>
      </div>
      
      {data.distribution && (
        <div className="space-y-2">
          <p className="text-sm font-medium">감정 분포</p>
          {Object.entries(data.distribution).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-xs w-16 capitalize">{key}</span>
              <Progress value={value * 100} className="flex-1 h-2" />
              <span className="text-xs w-12 text-right">{(value * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      )}
      
      {data.emotions && Object.keys(data.emotions).length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">세부 감정</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.emotions).map(([emotion, score]) => (
              <Badge key={emotion} variant="outline" className="text-xs">
                {emotion}: {(score * 100).toFixed(0)}%
              </Badge>
            ))}
          </div>
        </div>
      )}
      
      {data.explanations && data.explanations.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium">분석 근거</p>
          <ul className="text-sm text-muted-foreground space-y-1">
            {data.explanations.map((exp, i) => (
              <li key={i} className="flex items-start gap-2">
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                {exp}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

// 편향성 분석 결과
const BiasResult: React.FC<{ data: MlAnalysisResults['bias'] }> = ({ data }) => {
  if (!data) return null;
  
  const getBiasColor = () => {
    if (data.score > 0.7) return 'text-red-600';
    if (data.score > 0.4) return 'text-yellow-600';
    return 'text-green-600';
  };
  
  const getBiasLevel = () => {
    if (data.score > 0.7) return '높음';
    if (data.score > 0.4) return '중간';
    return '낮음';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Scale className="h-5 w-5 text-purple-500" />
        <div>
          <p className={`text-lg font-semibold ${getBiasColor()}`}>
            편향성: {getBiasLevel()}
          </p>
          <p className="text-sm text-muted-foreground">
            {data.label} (점수: {(data.score * 100).toFixed(1)}%)
          </p>
        </div>
      </div>
      
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs">낮음</span>
          <Progress value={data.score * 100} className="flex-1 h-3" />
          <span className="text-xs">높음</span>
        </div>
      </div>
      
      {data.details && Object.keys(data.details).length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">편향 유형별 점수</p>
          {Object.entries(data.details).map(([type, score]) => (
            <div key={type} className="flex items-center gap-2">
              <span className="text-xs w-24">{type}</span>
              <Progress value={score * 100} className="flex-1 h-2" />
              <span className="text-xs w-12 text-right">{(score * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      )}
      
      {data.explanations && data.explanations.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium">분석 근거</p>
          <ul className="text-sm text-muted-foreground space-y-1">
            {data.explanations.map((exp, i) => (
              <li key={i} className="flex items-start gap-2">
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                {exp}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

// 팩트체크 결과
const FactcheckResult: React.FC<{ data: MlAnalysisResults['factcheck'] }> = ({ data }) => {
  if (!data) return null;
  
  const getStatusColor = () => {
    switch (data.status) {
      case 'verified': return 'text-green-600';
      case 'suspicious': return 'text-yellow-600';
      case 'conflicting': return 'text-orange-600';
      default: return 'text-gray-600';
    }
  };
  
  const getStatusLabel = () => {
    switch (data.status) {
      case 'verified': return '검증됨';
      case 'suspicious': return '의심';
      case 'conflicting': return '상충';
      default: return '미검증';
    }
  };
  
  const getStatusIcon = () => {
    switch (data.status) {
      case 'verified': return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'suspicious': return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'conflicting': return <AlertCircle className="h-5 w-5 text-orange-500" />;
      default: return <Info className="h-5 w-5 text-gray-500" />;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {getStatusIcon()}
        <div>
          <p className={`text-lg font-semibold ${getStatusColor()}`}>
            {getStatusLabel()}
          </p>
          <p className="text-sm text-muted-foreground">
            신뢰도: {(data.confidence * 100).toFixed(1)}%
          </p>
        </div>
      </div>
      
      {data.claims && data.claims.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">주요 주장 검증</p>
          {data.claims.map((claim, i) => (
            <Card key={i} className="p-3">
              <p className="text-sm font-medium mb-2">"{claim.claim}"</p>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant={claim.verdict === 'true' ? 'default' : claim.verdict === 'false' ? 'destructive' : 'secondary'}>
                  {claim.verdict === 'true' ? '사실' : claim.verdict === 'false' ? '거짓' : '불확실'}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  신뢰도: {(claim.confidence * 100).toFixed(0)}%
                </span>
              </div>
              {claim.sources && claim.sources.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {claim.sources.map((src, j) => (
                    <Badge key={j} variant="outline" className="text-xs">
                      {src}
                    </Badge>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      
      {data.sources && data.sources.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">참조 출처</p>
          <div className="flex flex-wrap gap-2">
            {data.sources.map((source, i) => (
              <Badge key={i} variant="outline" className="text-xs">
                {source}
              </Badge>
            ))}
          </div>
        </div>
      )}
      
      {data.notes && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-sm">{data.notes}</AlertDescription>
        </Alert>
      )}
    </div>
  );
};

// 개체명 인식 결과
const EntitiesResult: React.FC<{ data: MlAnalysisResults['entities'] }> = ({ data }) => {
  if (!data) return null;
  
  const sections = [
    { key: 'persons', label: '인물', icon: <Users className="h-4 w-4" />, data: data.persons },
    { key: 'organizations', label: '조직', icon: <Building className="h-4 w-4" />, data: data.organizations },
    { key: 'locations', label: '장소', icon: <MapPin className="h-4 w-4" />, data: data.locations },
    { key: 'misc', label: '기타', icon: <Tag className="h-4 w-4" />, data: data.misc },
  ].filter(s => s.data && s.data.length > 0);

  if (sections.length === 0) return <p className="text-sm text-muted-foreground">추출된 개체가 없습니다.</p>;

  return (
    <div className="space-y-4">
      {sections.map(section => (
        <div key={section.key} className="space-y-2">
          <div className="flex items-center gap-2">
            {section.icon}
            <p className="text-sm font-medium">{section.label}</p>
            <Badge variant="secondary" className="text-xs">{section.data!.length}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {section.data!.map((entity, i) => (
              <Tooltip key={i}>
                <TooltipTrigger>
                  <Badge variant="outline" className="text-xs">
                    {entity.name}
                    {entity.count > 1 && <span className="ml-1 text-muted-foreground">×{entity.count}</span>}
                  </Badge>
                </TooltipTrigger>
                {entity.context && (
                  <TooltipContent>
                    <p className="max-w-xs text-xs">{entity.context}</p>
                  </TooltipContent>
                )}
              </Tooltip>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

// 요약 결과
const SummaryResult: React.FC<{ data: MlAnalysisResults['summary'] }> = ({ data }) => {
  if (!data) return null;

  return (
    <div className="space-y-4">
      {data.abstractiveSummary && (
        <div className="space-y-2">
          <p className="text-sm font-medium flex items-center gap-2">
            <FileText className="h-4 w-4" />
            요약
          </p>
          <Card className="p-3 bg-muted/50">
            <p className="text-sm">{data.abstractiveSummary}</p>
          </Card>
        </div>
      )}
      
      {data.keyPoints && data.keyPoints.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">핵심 포인트</p>
          <ul className="space-y-1">
            {data.keyPoints.map((point, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="text-primary font-bold">{i + 1}.</span>
                {point}
              </li>
            ))}
          </ul>
        </div>
      )}
      
      {data.extractiveSentences && data.extractiveSentences.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">주요 문장</p>
          <ul className="space-y-2">
            {data.extractiveSentences.map((sentence, i) => (
              <li key={i} className="text-sm text-muted-foreground italic border-l-2 border-primary/30 pl-3">
                "{sentence}"
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

// 주제 분류 결과
const TopicsResult: React.FC<{ data: MlAnalysisResults['topics'] }> = ({ data }) => {
  if (!data) return null;

  return (
    <div className="space-y-4">
      {data.primaryTopic && (
        <div className="flex items-center gap-2">
          <Tag className="h-5 w-5 text-primary" />
          <span className="text-lg font-semibold">{data.primaryTopic}</span>
        </div>
      )}
      
      {data.labels && data.labels.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">관련 주제</p>
          <div className="flex flex-wrap gap-2">
            {data.labels.map((label, i) => (
              <Badge 
                key={i} 
                variant={label === data.primaryTopic ? 'default' : 'outline'}
                className="text-sm"
              >
                {label}
                {data.scores && data.scores[label] && (
                  <span className="ml-1 text-xs opacity-70">
                    {(data.scores[label] * 100).toFixed(0)}%
                  </span>
                )}
              </Badge>
            ))}
          </div>
        </div>
      )}
      
      {data.scores && Object.keys(data.scores).length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">주제별 점수</p>
          {Object.entries(data.scores)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .map(([topic, score]) => (
              <div key={topic} className="flex items-center gap-2">
                <span className="text-xs w-24 truncate">{topic}</span>
                <Progress value={score * 100} className="flex-1 h-2" />
                <span className="text-xs w-12 text-right">{(score * 100).toFixed(0)}%</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

// 신뢰도 분석 결과
const ReliabilityResult: React.FC<{ data: MlAnalysisResults['reliability'] }> = ({ data }) => {
  if (!data) return null;
  
  const getGradeColor = () => {
    switch (data.grade) {
      case 'high': return 'text-green-600';
      case 'medium': return 'text-yellow-600';
      default: return 'text-red-600';
    }
  };
  
  const getGradeLabel = () => {
    switch (data.grade) {
      case 'high': return '높음';
      case 'medium': return '중간';
      default: return '낮음';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Shield className="h-5 w-5 text-blue-500" />
        <div>
          <p className={`text-lg font-semibold ${getGradeColor()}`}>
            신뢰도: {getGradeLabel()}
          </p>
          <p className="text-sm text-muted-foreground">
            점수: {(data.score * 100).toFixed(1)}%
          </p>
        </div>
      </div>
      
      {data.factors && Object.keys(data.factors).length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">평가 요소</p>
          {Object.entries(data.factors).map(([factor, score]) => (
            <div key={factor} className="flex items-center gap-2">
              <span className="text-xs w-24">{factor}</span>
              <Progress value={score * 100} className="flex-1 h-2" />
              <span className="text-xs w-12 text-right">{(score * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      )}
      
      {data.warnings && data.warnings.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <ul className="text-sm space-y-1">
              {data.warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};

// ============================================
// Analysis Result Display Component
// ============================================

interface AnalysisResultDisplayProps {
  responsePayload?: Record<string, unknown>;
  category?: string;
}

const AnalysisResultDisplay: React.FC<AnalysisResultDisplayProps> = ({ responsePayload, category }) => {
  if (!responsePayload || Object.keys(responsePayload).length === 0) {
    return (
      <div className="text-center py-4 text-muted-foreground">
        <Info className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">분석 결과 데이터가 없습니다.</p>
      </div>
    );
  }

  // responsePayload에서 results 추출 (또는 직접 사용)
  const results = (responsePayload.results as MlAnalysisResults) || responsePayload as MlAnalysisResults;
  
  // 결과 타입별 렌더링
  const hasSpecificResult = results.sentiment || results.bias || results.factcheck || 
    results.entities || results.summary || results.topics || results.reliability ||
    results.toxicity || results.misinformation || results.discussion;

  if (!hasSpecificResult) {
    // 구조화된 결과가 없으면 JSON 표시
    return (
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">원시 데이터:</p>
        <ScrollArea className="h-48 rounded-md border p-3 bg-muted/30">
          <pre className="text-xs whitespace-pre-wrap font-mono">
            {JSON.stringify(responsePayload, null, 2)}
          </pre>
        </ScrollArea>
      </div>
    );
  }

  return (
    <Tabs defaultValue={getDefaultTab(results)} className="w-full">
      <TabsList className="w-full justify-start flex-wrap h-auto gap-1 bg-transparent p-0 mb-4">
        {results.sentiment && <TabsTrigger value="sentiment" className="text-xs">감정 분석</TabsTrigger>}
        {results.bias && <TabsTrigger value="bias" className="text-xs">편향성</TabsTrigger>}
        {results.factcheck && <TabsTrigger value="factcheck" className="text-xs">팩트체크</TabsTrigger>}
        {results.reliability && <TabsTrigger value="reliability" className="text-xs">신뢰도</TabsTrigger>}
        {results.entities && <TabsTrigger value="entities" className="text-xs">개체명</TabsTrigger>}
        {results.summary && <TabsTrigger value="summary" className="text-xs">요약</TabsTrigger>}
        {results.topics && <TabsTrigger value="topics" className="text-xs">주제</TabsTrigger>}
        {results.toxicity && <TabsTrigger value="toxicity" className="text-xs">독성</TabsTrigger>}
        <TabsTrigger value="raw" className="text-xs">원시 데이터</TabsTrigger>
      </TabsList>
      
      {results.sentiment && (
        <TabsContent value="sentiment">
          <SentimentResult data={results.sentiment} />
        </TabsContent>
      )}
      {results.bias && (
        <TabsContent value="bias">
          <BiasResult data={results.bias} />
        </TabsContent>
      )}
      {results.factcheck && (
        <TabsContent value="factcheck">
          <FactcheckResult data={results.factcheck} />
        </TabsContent>
      )}
      {results.reliability && (
        <TabsContent value="reliability">
          <ReliabilityResult data={results.reliability} />
        </TabsContent>
      )}
      {results.entities && (
        <TabsContent value="entities">
          <EntitiesResult data={results.entities} />
        </TabsContent>
      )}
      {results.summary && (
        <TabsContent value="summary">
          <SummaryResult data={results.summary} />
        </TabsContent>
      )}
      {results.topics && (
        <TabsContent value="topics">
          <TopicsResult data={results.topics} />
        </TabsContent>
      )}
      {results.toxicity && (
        <TabsContent value="toxicity">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              <span className="font-semibold">독성 점수: {((results.toxicity.score || 0) * 100).toFixed(1)}%</span>
            </div>
            {results.toxicity.categories && (
              <div className="space-y-2">
                {Object.entries(results.toxicity.categories).map(([cat, score]) => (
                  <div key={cat} className="flex items-center gap-2">
                    <span className="text-xs w-24">{cat}</span>
                    <Progress value={score * 100} className="flex-1 h-2" />
                    <span className="text-xs w-12 text-right">{(score * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      )}
      <TabsContent value="raw">
        <ScrollArea className="h-48 rounded-md border p-3 bg-muted/30">
          <pre className="text-xs whitespace-pre-wrap font-mono">
            {JSON.stringify(responsePayload, null, 2)}
          </pre>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
};

function getDefaultTab(results: MlAnalysisResults): string {
  if (results.sentiment) return 'sentiment';
  if (results.bias) return 'bias';
  if (results.factcheck) return 'factcheck';
  if (results.reliability) return 'reliability';
  if (results.entities) return 'entities';
  if (results.summary) return 'summary';
  if (results.topics) return 'topics';
  return 'raw';
}

// ============================================
// Execution Card Component
// ============================================

interface ExecutionCardProps {
  execution: MlAddonExecution;
}

const ExecutionCard: React.FC<ExecutionCardProps> = ({ execution }) => {
  const [isOpen, setIsOpen] = useState(execution.status === 'SUCCESS');
  
  const hasResult = execution.responsePayload && Object.keys(execution.responsePayload).length > 0;
  const addonName = execution.addon?.name || execution.addon?.addonKey || '알 수 없음';
  const category = execution.addon?.category;
  
  return (
    <Card className="overflow-hidden">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${execution.status === 'SUCCESS' ? 'bg-green-100 dark:bg-green-900/30' : execution.status === 'FAILED' ? 'bg-red-100 dark:bg-red-900/30' : 'bg-primary/10'}`}>
                  <Brain className={`h-4 w-4 ${execution.status === 'SUCCESS' ? 'text-green-600' : execution.status === 'FAILED' ? 'text-red-600' : 'text-primary'}`} />
                </div>
                <div>
                  <CardTitle className="text-sm font-medium">
                    {addonName}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {category ? getCategoryLabel(category) : '분석'} 
                    {execution.articleId && ` - 기사 #${execution.articleId}`}
                    {execution.latencyMs && ` - ${execution.latencyMs}ms`}
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={execution.status} />
                {(hasResult || execution.errorMessage) && (
                  isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                )}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
            <Separator />
            
            {/* 메타 정보 */}
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div>
                <span className="font-medium">요청 ID:</span>{' '}
                <code className="bg-muted px-1 rounded">{execution.requestId.slice(0, 12)}...</code>
              </div>
              {execution.batchId && (
                <div>
                  <span className="font-medium">배치 ID:</span>{' '}
                  <code className="bg-muted px-1 rounded">{execution.batchId.slice(0, 12)}...</code>
                </div>
              )}
              <div>
                <span className="font-medium">생성:</span>{' '}
                {new Date(execution.createdAt).toLocaleString('ko-KR')}
              </div>
              {execution.completedAt && (
                <div>
                  <span className="font-medium">완료:</span>{' '}
                  {new Date(execution.completedAt).toLocaleString('ko-KR')}
                </div>
              )}
            </div>
            
            {/* 에러 메시지 */}
            {execution.errorMessage && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  {execution.errorCode && <span className="font-mono mr-2">[{execution.errorCode}]</span>}
                  {execution.errorMessage}
                </AlertDescription>
              </Alert>
            )}
            
            {/* 분석 결과 */}
            {hasResult && (
              <div className="space-y-2">
                <p className="text-sm font-medium">분석 결과</p>
                <AnalysisResultDisplay 
                  responsePayload={execution.responsePayload} 
                  category={category}
                />
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

// ============================================
// Article Info Card
// ============================================

interface ArticleInfoCardProps {
  article: CollectedDataDTO;
}

const ArticleInfoCard: React.FC<ArticleInfoCardProps> = ({ article }) => {
  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <CardTitle className="text-lg line-clamp-2">
              {article.title || '제목 없음'}
            </CardTitle>
            <CardDescription className="mt-1">
              기사 #{article.id} - {new Date(article.collectedAt).toLocaleString('ko-KR')}
            </CardDescription>
          </div>
          {article.url && (
            <Button variant="outline" size="sm" asChild>
              <a href={article.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-1" />
                원본
              </a>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground line-clamp-3">
          {article.content?.slice(0, 300) || '내용 없음'}
          {article.content && article.content.length > 300 && '...'}
        </p>
      </CardContent>
    </Card>
  );
};

// ============================================
// Main Page Component
// ============================================

const MLResults: React.FC = () => {
  const [searchParams] = useSearchParams();
  const articleIdParam = searchParams.get('articleId');
  const articleId = articleIdParam ? parseInt(articleIdParam, 10) : null;
  
  const [statusFilter, setStatusFilter] = useState<ExecutionStatus | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [article, setArticle] = useState<CollectedDataDTO | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);
  
  // 기사별 분석 결과
  const {
    executions: articleExecutions,
    loading: articleExecLoading,
    error: articleExecError,
    refresh: refreshArticleExec,
    isAnalyzing,
  } = useArticleAnalysis(articleId);
  
  // 전체 실행 이력
  const {
    executions: allExecutions,
    loading: allExecLoading,
    error: allExecError,
    refresh: refreshAllExec,
    total: totalExecutions,
    totalPages,
    currentPage,
    setPage,
  } = useMlExecutions({ size: 20 });
  
  // 기사 정보 로드
  useEffect(() => {
    if (articleId) {
      setArticleLoading(true);
      getCollectedData(articleId)
        .then(setArticle)
        .catch(() => setArticle(null))
        .finally(() => setArticleLoading(false));
    }
  }, [articleId]);
  
  const handleRefresh = useCallback(async () => {
    if (articleId) {
      await refreshArticleExec();
    } else {
      await refreshAllExec();
    }
  }, [articleId, refreshArticleExec, refreshAllExec]);
  
  // 현재 표시할 실행 목록
  const executions = articleId ? articleExecutions : allExecutions;
  const loading = articleId ? articleExecLoading : allExecLoading;
  const error = articleId ? articleExecError : allExecError;
  
  // 필터링
  const filteredExecutions = executions.filter(exec => {
    if (statusFilter !== 'ALL' && exec.status !== statusFilter) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const addonKey = exec.addon?.addonKey || '';
      return (
        addonKey.toLowerCase().includes(query) ||
        exec.requestId.toLowerCase().includes(query) ||
        (exec.batchId && exec.batchId.toLowerCase().includes(query))
      );
    }
    return true;
  });
  
  // 통계
  const stats = {
    total: executions.length,
    success: executions.filter(e => e.status === 'SUCCESS').length,
    failed: executions.filter(e => e.status === 'FAILED').length,
    running: executions.filter(e => e.status === 'RUNNING' || e.status === 'PENDING').length,
  };

  return (
    <div className="min-h-screen py-8">
      <div className="container mx-auto px-4 max-w-4xl">
        {/* Header */}
        <header className="mb-6">
          <Link
            to={articleId ? '/collected-data' : '/'}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            {articleId ? '수집 데이터로 돌아가기' : '홈으로 돌아가기'}
          </Link>
          
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Brain className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">
                  {articleId ? `기사 #${articleId} 분석 결과` : 'ML 분석 결과'}
                </h1>
                <p className="text-muted-foreground text-sm">
                  {articleId 
                    ? '이 기사에 대한 ML 분석 결과를 확인합니다.'
                    : '전체 ML 분석 실행 이력을 확인합니다.'
                  }
                </p>
              </div>
            </div>
            
            <Button
              variant="outline"
              onClick={handleRefresh}
              disabled={loading || isAnalyzing}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              새로고침
            </Button>
          </div>
        </header>
        
        {/* 기사 정보 (기사 ID가 있을 때) */}
        {articleId && articleLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {articleId && article && !articleLoading && (
          <ArticleInfoCard article={article} />
        )}
        
        {/* 통계 */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">전체</p>
                <p className="text-lg font-bold">{articleId ? stats.total : totalExecutions}</p>
              </div>
            </div>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <div>
                <p className="text-xs text-muted-foreground">성공</p>
                <p className="text-lg font-bold text-green-600">{stats.success}</p>
              </div>
            </div>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              <div>
                <p className="text-xs text-muted-foreground">실패</p>
                <p className="text-lg font-bold text-red-600">{stats.failed}</p>
              </div>
            </div>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 text-blue-500" />
              <div>
                <p className="text-xs text-muted-foreground">진행중</p>
                <p className="text-lg font-bold text-blue-600">{stats.running}</p>
              </div>
            </div>
          </Card>
        </div>
        
        {/* 필터 */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Add-on 키, 요청 ID로 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as ExecutionStatus | 'ALL')}
          >
            <SelectTrigger className="w-32">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">전체</SelectItem>
              <SelectItem value="SUCCESS">성공</SelectItem>
              <SelectItem value="FAILED">실패</SelectItem>
              <SelectItem value="RUNNING">실행 중</SelectItem>
              <SelectItem value="PENDING">대기 중</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        {/* 에러 */}
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
        
        {/* 로딩 */}
        {loading && executions.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}
        
        {/* 결과 없음 */}
        {!loading && filteredExecutions.length === 0 && (
          <Card className="p-8 text-center">
            <Inbox className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">
              {searchQuery || statusFilter !== 'ALL'
                ? '검색 조건에 맞는 결과가 없습니다.'
                : articleId
                  ? '이 기사에 대한 분석 결과가 없습니다.'
                  : 'ML 분석 이력이 없습니다.'
              }
            </p>
            {articleId && (
              <Button asChild className="mt-4">
                <Link to="/collected-data">수집 데이터에서 분석 시작</Link>
              </Button>
            )}
          </Card>
        )}
        
        {/* 결과 목록 */}
        {filteredExecutions.length > 0 && (
          <div className="space-y-3">
            {filteredExecutions.map((execution) => (
              <ExecutionCard key={execution.requestId} execution={execution} />
            ))}
          </div>
        )}
        
        {/* 페이지네이션 (전체 목록일 때만) */}
        {!articleId && totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-6">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage === 0}
            >
              이전
            </Button>
            <span className="text-sm text-muted-foreground">
              {currentPage + 1} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage >= totalPages - 1}
            >
              다음
            </Button>
          </div>
        )}
        
        {/* 도움말 */}
        <Alert className="mt-6">
          <Brain className="h-4 w-4" />
          <AlertDescription>
            <strong>분석 결과 확인:</strong> 각 카드를 클릭하면 감정, 편향성, 팩트체크 등 상세 분석 결과를 시각적으로 확인할 수 있습니다.
            탭을 전환하여 다양한 분석 유형의 결과를 살펴보세요.
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
};

export default MLResults;
