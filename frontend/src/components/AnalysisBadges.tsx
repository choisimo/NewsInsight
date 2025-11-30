import React from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  TrendingUp,
  TrendingDown,
  Minus,
  MessageSquare,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ========== Types ==========

export interface AnalysisData {
  analyzed?: boolean;
  analysisStatus?: "pending" | "partial" | "complete";
  reliabilityScore?: number;
  reliabilityGrade?: "high" | "medium" | "low";
  reliabilityColor?: "green" | "yellow" | "red";
  sentimentLabel?: "positive" | "negative" | "neutral";
  sentimentScore?: number;
  biasLabel?: string;
  biasScore?: number;
  factcheckStatus?: "verified" | "suspicious" | "conflicting" | "unverified";
  misinfoRisk?: "low" | "mid" | "high";
  riskTags?: string[];
  topics?: string[];
  hasDiscussion?: boolean;
  totalCommentCount?: number;
  discussionSentiment?: string;
}

// ========== Reliability Badge ==========

interface ReliabilityBadgeProps {
  score?: number;
  grade?: string;
  color?: string;
  loading?: boolean;
  size?: "sm" | "md" | "lg";
}

export const ReliabilityBadge: React.FC<ReliabilityBadgeProps> = ({
  score,
  grade,
  color,
  loading = false,
  size = "md",
}) => {
  if (loading) {
    return <Skeleton className={cn("h-6", size === "sm" ? "w-12" : "w-16")} />;
  }

  if (score === undefined || score === null) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="gap-1 text-muted-foreground">
              <HelpCircle className="h-3 w-3" />
              {size !== "sm" && "분석 중"}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>신뢰도 분석 대기 중</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const colorClasses = {
    green: "bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-400",
    yellow: "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400",
    red: "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-400",
  };

  const iconColor = {
    green: "text-green-600",
    yellow: "text-yellow-600",
    red: "text-red-600",
  };

  const badgeColor = colorClasses[color as keyof typeof colorClasses] || colorClasses.yellow;
  const Icon = color === "green" ? Shield : color === "red" ? AlertTriangle : AlertCircle;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn("gap-1", badgeColor)}>
            <Icon className={cn("h-3 w-3", iconColor[color as keyof typeof iconColor])} />
            {size !== "sm" && `신뢰도 ${Math.round(score)}%`}
            {size === "sm" && `${Math.round(score)}%`}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-sm">
            <p className="font-semibold">신뢰도: {Math.round(score)}점</p>
            <p className="text-muted-foreground">
              {grade === "high" && "높은 신뢰도 - 검증된 출처"}
              {grade === "medium" && "보통 신뢰도 - 추가 검증 권장"}
              {grade === "low" && "낮은 신뢰도 - 주의 필요"}
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

// ========== Sentiment Badge ==========

interface SentimentBadgeProps {
  label?: string;
  score?: number;
  loading?: boolean;
  size?: "sm" | "md" | "lg";
}

export const SentimentBadge: React.FC<SentimentBadgeProps> = ({
  label,
  score,
  loading = false,
  size = "md",
}) => {
  if (loading) {
    return <Skeleton className={cn("h-6", size === "sm" ? "w-12" : "w-14")} />;
  }

  if (!label) {
    return null;
  }

  const config = {
    positive: {
      icon: TrendingUp,
      label: "긍정",
      classes: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400",
    },
    negative: {
      icon: TrendingDown,
      label: "부정",
      classes: "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-900/30 dark:text-rose-400",
    },
    neutral: {
      icon: Minus,
      label: "중립",
      classes: "bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800/50 dark:text-slate-400",
    },
  };

  const { icon: Icon, label: displayLabel, classes } = config[label as keyof typeof config] || config.neutral;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn("gap-1", classes)}>
            <Icon className="h-3 w-3" />
            {size !== "sm" && displayLabel}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>감정 분석: {displayLabel}</p>
          {score !== undefined && <p className="text-muted-foreground">점수: {score.toFixed(2)}</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

// ========== Factcheck Badge ==========

interface FactcheckBadgeProps {
  status?: string;
  misinfoRisk?: string;
  loading?: boolean;
  size?: "sm" | "md" | "lg";
}

export const FactcheckBadge: React.FC<FactcheckBadgeProps> = ({
  status,
  misinfoRisk,
  loading = false,
  size = "md",
}) => {
  if (loading) {
    return <Skeleton className={cn("h-6", size === "sm" ? "w-12" : "w-16")} />;
  }

  if (!status && !misinfoRisk) {
    return null;
  }

  const config = {
    verified: {
      icon: CheckCircle,
      label: "검증됨",
      classes: "bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-400",
    },
    suspicious: {
      icon: AlertTriangle,
      label: "의심",
      classes: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400",
    },
    conflicting: {
      icon: AlertCircle,
      label: "상충",
      classes: "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400",
    },
    unverified: {
      icon: HelpCircle,
      label: "미검증",
      classes: "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800/50 dark:text-slate-400",
    },
  };

  const { icon: Icon, label, classes } = config[status as keyof typeof config] || config.unverified;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn("gap-1", classes)}>
            <Icon className="h-3 w-3" />
            {size !== "sm" && label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-sm">
            <p className="font-semibold">팩트체크: {label}</p>
            {misinfoRisk && (
              <p className="text-muted-foreground">
                허위정보 위험도: {misinfoRisk === "high" ? "높음" : misinfoRisk === "mid" ? "중간" : "낮음"}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

// ========== Bias Badge ==========

interface BiasBadgeProps {
  label?: string;
  score?: number;
  loading?: boolean;
  size?: "sm" | "md" | "lg";
}

export const BiasBadge: React.FC<BiasBadgeProps> = ({
  label,
  score,
  loading = false,
  size = "md",
}) => {
  if (loading) {
    return <Skeleton className={cn("h-6", size === "sm" ? "w-12" : "w-14")} />;
  }

  if (!label) {
    return null;
  }

  const config: Record<string, { label: string; classes: string }> = {
    left: {
      label: "진보",
      classes: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400",
    },
    right: {
      label: "보수",
      classes: "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-400",
    },
    center: {
      label: "중도",
      classes: "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/30 dark:text-purple-400",
    },
  };

  const { label: displayLabel, classes } = config[label] || { label, classes: "bg-slate-100 text-slate-700" };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn("gap-1", classes)}>
            {size !== "sm" && `편향: ${displayLabel}`}
            {size === "sm" && displayLabel}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>편향도 분석: {displayLabel}</p>
          {score !== undefined && <p className="text-muted-foreground">점수: {score.toFixed(2)}</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

// ========== Discussion Badge ==========

interface DiscussionBadgeProps {
  hasDiscussion?: boolean;
  totalCommentCount?: number;
  sentiment?: string;
  loading?: boolean;
  size?: "sm" | "md" | "lg";
}

export const DiscussionBadge: React.FC<DiscussionBadgeProps> = ({
  hasDiscussion,
  totalCommentCount,
  sentiment,
  loading = false,
  size = "md",
}) => {
  if (loading) {
    return <Skeleton className={cn("h-6", size === "sm" ? "w-12" : "w-16")} />;
  }

  if (!hasDiscussion || !totalCommentCount) {
    return null;
  }

  const sentimentConfig: Record<string, string> = {
    positive: "text-emerald-600",
    negative: "text-rose-600",
    neutral: "text-slate-600",
    mixed: "text-amber-600",
  };

  const formatCount = (count: number) => {
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
    return count.toString();
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="gap-1 bg-slate-50 dark:bg-slate-800/50">
            <MessageSquare className={cn("h-3 w-3", sentimentConfig[sentiment || "neutral"])} />
            {formatCount(totalCommentCount)}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-sm">
            <p className="font-semibold">댓글/여론: {totalCommentCount}건</p>
            {sentiment && (
              <p className="text-muted-foreground">
                전반적 분위기:{" "}
                {sentiment === "positive"
                  ? "긍정적"
                  : sentiment === "negative"
                  ? "부정적"
                  : sentiment === "mixed"
                  ? "혼재"
                  : "중립적"}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

// ========== Risk Tags ==========

interface RiskTagsProps {
  tags?: string[];
  loading?: boolean;
  maxShow?: number;
}

export const RiskTags: React.FC<RiskTagsProps> = ({
  tags,
  loading = false,
  maxShow = 2,
}) => {
  if (loading) {
    return <Skeleton className="h-5 w-20" />;
  }

  if (!tags || tags.length === 0) {
    return null;
  }

  const tagLabels: Record<string, string> = {
    clickbait: "낚시성",
    sensational: "선정적",
    unverified_source: "미검증 출처",
    opinion_piece: "의견 기사",
    sponsored: "협찬/광고",
    outdated: "오래된 정보",
  };

  const visibleTags = tags.slice(0, maxShow);
  const hiddenCount = tags.length - maxShow;

  return (
    <div className="flex flex-wrap gap-1">
      {visibleTags.map((tag) => (
        <Badge
          key={tag}
          variant="outline"
          className="text-xs bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400"
        >
          {tagLabels[tag] || tag}
        </Badge>
      ))}
      {hiddenCount > 0 && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="text-xs">
                +{hiddenCount}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-sm">
                {tags.slice(maxShow).map((tag) => (
                  <p key={tag}>{tagLabels[tag] || tag}</p>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
};

// ========== Combined Analysis Badges ==========

interface AnalysisBadgesProps {
  data: AnalysisData;
  loading?: boolean;
  size?: "sm" | "md" | "lg";
  showAll?: boolean;
}

export const AnalysisBadges: React.FC<AnalysisBadgesProps> = ({
  data,
  loading = false,
  size = "md",
  showAll = false,
}) => {
  const isLoading = loading || data.analysisStatus === "pending";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <ReliabilityBadge
        score={data.reliabilityScore}
        grade={data.reliabilityGrade}
        color={data.reliabilityColor}
        loading={isLoading}
        size={size}
      />
      <SentimentBadge
        label={data.sentimentLabel}
        score={data.sentimentScore}
        loading={isLoading}
        size={size}
      />
      {(showAll || data.factcheckStatus) && (
        <FactcheckBadge
          status={data.factcheckStatus}
          misinfoRisk={data.misinfoRisk}
          loading={isLoading}
          size={size}
        />
      )}
      {(showAll || data.biasLabel) && (
        <BiasBadge
          label={data.biasLabel}
          score={data.biasScore}
          loading={isLoading}
          size={size}
        />
      )}
      <DiscussionBadge
        hasDiscussion={data.hasDiscussion}
        totalCommentCount={data.totalCommentCount}
        sentiment={data.discussionSentiment}
        loading={isLoading}
        size={size}
      />
      {data.riskTags && data.riskTags.length > 0 && (
        <RiskTags tags={data.riskTags} loading={isLoading} />
      )}
    </div>
  );
};

export default AnalysisBadges;
