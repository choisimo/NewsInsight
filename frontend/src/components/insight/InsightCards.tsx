import * as React from "react";
import {
  Scale,
  Lightbulb,
  TrendingUp,
  TrendingDown,
  Minus,
  ExternalLink,
  Share2,
  Download,
  BookOpen,
  BarChart3,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Evidence, StanceDistribution } from "@/lib/api";

// ============================================
// Base Card Wrapper with Glassmorphism
// ============================================

interface InsightCardWrapperProps {
  children: React.ReactNode;
  className?: string;
  variant?: "default" | "teal" | "coral" | "navy" | "conclusion";
}

export const InsightCardWrapper = ({
  children,
  className,
  variant = "default",
}: InsightCardWrapperProps) => {
  const variantStyles = {
    default: "bg-card/80 backdrop-blur-md border-border/50",
    teal: "bg-teal-50/80 dark:bg-teal-950/40 backdrop-blur-md border-teal-200/50 dark:border-teal-800/50",
    coral: "bg-coral-50/80 dark:bg-coral-950/40 backdrop-blur-md border-coral-200/50 dark:border-coral-800/50",
    navy: "bg-slate-50/80 dark:bg-slate-900/40 backdrop-blur-md border-slate-200/50 dark:border-slate-700/50",
    conclusion: "bg-gradient-to-br from-primary/10 to-accent/10 backdrop-blur-md border-primary/30",
  };

  return (
    <div
      className={cn(
        "rounded-2xl border shadow-lg p-6 md:p-8 h-full flex flex-col",
        "transition-all duration-300",
        variantStyles[variant],
        className
      )}
    >
      {children}
    </div>
  );
};

// ============================================
// A. Intro Card - Fact Check & Summary
// ============================================

interface IntroCardProps {
  topic: string;
  summaryPoints: string[];
  evidenceCount: number;
  backgroundImage?: string;
}

export const IntroCard = ({
  topic,
  summaryPoints,
  evidenceCount,
}: IntroCardProps) => {
  return (
    <InsightCardWrapper className="relative overflow-hidden">
      {/* Background decorative element */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-primary/10 to-transparent rounded-full -translate-y-1/2 translate-x-1/2" />
      
      <div className="relative z-10 flex flex-col h-full">
        {/* Icon and Badge */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 rounded-xl bg-primary/10 text-primary">
            <Lightbulb className="h-6 w-6" />
          </div>
          <Badge variant="secondary" className="text-xs">
            Fact Check Summary
          </Badge>
        </div>

        {/* Topic Title */}
        <h2 className="text-2xl md:text-3xl font-bold mb-2 text-foreground">
          {topic}
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          {evidenceCount}개의 출처에서 수집된 핵심 정보
        </p>

        {/* Summary Points */}
        <div className="flex-1 space-y-3">
          {summaryPoints.slice(0, 3).map((point, idx) => (
            <div
              key={idx}
              className="flex items-start gap-3 p-3 rounded-lg bg-background/50"
            >
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-sm font-medium flex items-center justify-center">
                {idx + 1}
              </span>
              <p className="text-sm text-foreground leading-relaxed">{point}</p>
            </div>
          ))}
        </div>

        {/* Swipe hint */}
        <div className="mt-6 text-center text-xs text-muted-foreground animate-pulse">
          스와이프하여 상세 분석 보기 →
        </div>
      </div>
    </InsightCardWrapper>
  );
};

// ============================================
// B. Viewpoint Comparison Card (VS Layout)
// ============================================

interface ViewpointVSCardProps {
  topic: string;
  proPoints: Evidence[];
  conPoints: Evidence[];
  distribution: StanceDistribution;
}

export const ViewpointVSCard = ({
  topic,
  proPoints,
  conPoints,
  distribution,
}: ViewpointVSCardProps) => {
  return (
    <InsightCardWrapper>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="p-3 rounded-xl bg-muted text-foreground">
            <Scale className="h-6 w-6" />
          </div>
          <h3 className="text-xl font-bold">관점 비교</h3>
        </div>

        {/* Distribution Bar */}
        <div className="flex gap-1 h-3 rounded-full overflow-hidden mb-6">
          <div
            className="bg-teal-500 transition-all duration-500"
            style={{ width: `${distribution.proRatio}%` }}
          />
          <div
            className="bg-gray-400 transition-all duration-500"
            style={{ width: `${distribution.neutralRatio}%` }}
          />
          <div
            className="bg-coral-500 transition-all duration-500"
            style={{ width: `${distribution.conRatio}%` }}
          />
        </div>

        {/* VS Layout */}
        <div className="flex-1 grid grid-cols-2 gap-4">
          {/* Pro Side (Teal) */}
          <div className="flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4 text-teal-600" />
              <span className="text-sm font-semibold text-teal-700 dark:text-teal-400">
                찬성 ({distribution.proRatio.toFixed(0)}%)
              </span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto max-h-64">
              {proPoints.slice(0, 3).map((evidence) => (
                <div
                  key={evidence.id}
                  className="p-3 rounded-lg bg-teal-100/50 dark:bg-teal-900/30 border border-teal-200/50 dark:border-teal-800/50"
                >
                  <p className="text-xs text-foreground line-clamp-3">
                    {evidence.snippet}
                  </p>
                  {evidence.source && (
                    <span className="text-xs text-muted-foreground mt-1 block">
                      — {evidence.source}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Con Side (Coral) */}
          <div className="flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <TrendingDown className="h-4 w-4 text-coral-600" />
              <span className="text-sm font-semibold text-coral-700 dark:text-coral-400">
                반대 ({distribution.conRatio.toFixed(0)}%)
              </span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto max-h-64">
              {conPoints.slice(0, 3).map((evidence) => (
                <div
                  key={evidence.id}
                  className="p-3 rounded-lg bg-coral-100/50 dark:bg-coral-900/30 border border-coral-200/50 dark:border-coral-800/50"
                >
                  <p className="text-xs text-foreground line-clamp-3">
                    {evidence.snippet}
                  </p>
                  {evidence.source && (
                    <span className="text-xs text-muted-foreground mt-1 block">
                      — {evidence.source}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </InsightCardWrapper>
  );
};

// ============================================
// B-2. Topic Cluster Card (Multi-topic view)
// ============================================

interface TopicCluster {
  tag: string;
  evidence: Evidence[];
  color: string;
}

interface TopicClusterCardProps {
  clusters: TopicCluster[];
}

export const TopicClusterCard = ({ clusters }: TopicClusterCardProps) => {
  return (
    <InsightCardWrapper>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 rounded-xl bg-muted text-foreground">
            <BookOpen className="h-6 w-6" />
          </div>
          <h3 className="text-xl font-bold">주제별 분석</h3>
        </div>

        {/* Topic Chips */}
        <div className="flex flex-wrap gap-2 mb-4">
          {clusters.map((cluster, idx) => (
            <Badge
              key={idx}
              variant="outline"
              className="px-3 py-1"
              style={{
                borderColor: cluster.color,
                color: cluster.color,
              }}
            >
              #{cluster.tag}
            </Badge>
          ))}
        </div>

        {/* Horizontal Scroll Cards */}
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-4 pb-4">
            {clusters.map((cluster, idx) => (
              <div
                key={idx}
                className="flex-shrink-0 w-64 p-4 rounded-xl bg-background/50 border"
                style={{ borderColor: `${cluster.color}40` }}
              >
                <div
                  className="text-sm font-semibold mb-3"
                  style={{ color: cluster.color }}
                >
                  #{cluster.tag}
                </div>
                <div className="space-y-2">
                  {cluster.evidence.slice(0, 2).map((e) => (
                    <p key={e.id} className="text-xs text-muted-foreground line-clamp-2">
                      {e.snippet}
                    </p>
                  ))}
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  {cluster.evidence.length}개 증거
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </InsightCardWrapper>
  );
};

// ============================================
// C. Data Visualization Card
// ============================================

interface DataVisualizationCardProps {
  distribution: StanceDistribution;
  topic: string;
  evidenceCount: number;
}

export const DataVisualizationCard = ({
  distribution,
  topic,
  evidenceCount,
}: DataVisualizationCardProps) => {
  const total = distribution.pro + distribution.con + distribution.neutral;

  return (
    <InsightCardWrapper variant="navy">
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 rounded-xl bg-slate-200/50 dark:bg-slate-700/50 text-foreground">
            <BarChart3 className="h-6 w-6" />
          </div>
          <h3 className="text-xl font-bold">데이터 분석</h3>
        </div>

        {/* Visual Chart */}
        <div className="flex-1 flex flex-col items-center justify-center">
          {/* Circular representation */}
          <div className="relative w-48 h-48 mb-6">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              {/* Background circle */}
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                className="text-muted/30"
              />
              {/* Pro arc */}
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                strokeDasharray={`${distribution.proRatio * 2.51} 251`}
                strokeDashoffset="0"
                className="text-teal-500"
              />
              {/* Neutral arc */}
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                strokeDasharray={`${distribution.neutralRatio * 2.51} 251`}
                strokeDashoffset={`${-distribution.proRatio * 2.51}`}
                className="text-gray-400"
              />
              {/* Con arc */}
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                strokeDasharray={`${distribution.conRatio * 2.51} 251`}
                strokeDashoffset={`${-(distribution.proRatio + distribution.neutralRatio) * 2.51}`}
                className="text-coral-500"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold">{total}</span>
              <span className="text-xs text-muted-foreground">증거 수집</span>
            </div>
          </div>

          {/* Legend */}
          <div className="grid grid-cols-3 gap-6 w-full">
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-full bg-teal-500" />
                <span className="text-lg font-bold">{distribution.pro}</span>
              </div>
              <span className="text-xs text-muted-foreground">찬성</span>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-full bg-gray-400" />
                <span className="text-lg font-bold">{distribution.neutral}</span>
              </div>
              <span className="text-xs text-muted-foreground">중립</span>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-full bg-coral-500" />
                <span className="text-lg font-bold">{distribution.con}</span>
              </div>
              <span className="text-xs text-muted-foreground">반대</span>
            </div>
          </div>
        </div>

        {/* Interpretation */}
        <div className="mt-6 p-4 rounded-xl bg-background/50 text-center">
          <p className="text-sm text-muted-foreground">
            "{topic}"에 대해 {distribution.proRatio > distribution.conRatio ? "긍정적" : distribution.proRatio < distribution.conRatio ? "부정적" : "균형잡힌"} 시각이{" "}
            {Math.abs(distribution.proRatio - distribution.conRatio).toFixed(0)}% 더 우세합니다.
          </p>
        </div>
      </div>
    </InsightCardWrapper>
  );
};

// ============================================
// D. Conclusion Card - The Verdict
// ============================================

interface ConclusionCardProps {
  topic: string;
  conclusion: string;
  keyInsight: string;
  distribution: StanceDistribution;
  onShare?: () => void;
  onDownload?: () => void;
}

export const ConclusionCard = ({
  topic,
  conclusion,
  keyInsight,
  distribution,
  onShare,
  onDownload,
}: ConclusionCardProps) => {
  return (
    <InsightCardWrapper variant="conclusion">
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="p-3 rounded-xl bg-primary/20 text-primary">
            <Target className="h-6 w-6" />
          </div>
          <h3 className="text-xl font-bold text-primary">최종 인사이트</h3>
        </div>

        {/* Main Conclusion */}
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
          <blockquote className="text-xl md:text-2xl font-bold leading-relaxed mb-6 text-foreground">
            "{conclusion}"
          </blockquote>

          <div className="w-16 h-1 bg-primary/30 rounded-full mb-6" />

          <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
            {keyInsight}
          </p>
        </div>

        {/* Balance Indicator */}
        <div className="my-6 flex items-center justify-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-2 rounded-full bg-teal-500" />
            <span className="text-xs text-muted-foreground">
              {distribution.proRatio.toFixed(0)}%
            </span>
          </div>
          <Scale className="h-5 w-5 text-muted-foreground" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {distribution.conRatio.toFixed(0)}%
            </span>
            <div className="w-8 h-2 rounded-full bg-coral-500" />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-center gap-3">
          {onShare && (
            <Button variant="outline" size="sm" onClick={onShare}>
              <Share2 className="h-4 w-4 mr-2" />
              공유하기
            </Button>
          )}
          {onDownload && (
            <Button variant="outline" size="sm" onClick={onDownload}>
              <Download className="h-4 w-4 mr-2" />
              저장하기
            </Button>
          )}
        </div>
      </div>
    </InsightCardWrapper>
  );
};

// ============================================
// Evidence Detail Card (for detailed view)
// ============================================

interface EvidenceDetailCardProps {
  evidence: Evidence[];
  stance: "pro" | "con" | "neutral" | "all";
}

export const EvidenceDetailCard = ({
  evidence,
  stance,
}: EvidenceDetailCardProps) => {
  const filteredEvidence =
    stance === "all" ? evidence : evidence.filter((e) => e.stance === stance);

  const stanceConfig = {
    pro: { color: "teal", icon: TrendingUp, label: "찬성 의견" },
    con: { color: "coral", icon: TrendingDown, label: "반대 의견" },
    neutral: { color: "gray", icon: Minus, label: "중립 의견" },
    all: { color: "primary", icon: BookOpen, label: "전체 증거" },
  };

  const config = stanceConfig[stance];
  const Icon = config.icon;

  return (
    <InsightCardWrapper>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <Icon className={`h-5 w-5 text-${config.color}-600`} />
          <h3 className="text-lg font-semibold">{config.label}</h3>
          <Badge variant="secondary">{filteredEvidence.length}개</Badge>
        </div>

        {/* Evidence List */}
        <div className="flex-1 space-y-3 overflow-y-auto max-h-80">
          {filteredEvidence.map((e) => (
            <div
              key={e.id}
              className="p-4 rounded-xl bg-background/50 border border-border/50 hover:border-border transition-colors"
            >
              {e.title && (
                <h4 className="font-medium text-sm mb-2 line-clamp-1">{e.title}</h4>
              )}
              <p className="text-sm text-muted-foreground line-clamp-3 mb-2">
                {e.snippet}
              </p>
              <div className="flex items-center justify-between">
                {e.source && (
                  <span className="text-xs text-muted-foreground">{e.source}</span>
                )}
                <a
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  원문 보기 <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </InsightCardWrapper>
  );
};
