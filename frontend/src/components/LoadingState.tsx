import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";

/**
 * 통합 로딩 상태 컴포넌트
 * 
 * 다양한 로딩 패턴을 지원:
 * - spinner: 기본 스피너
 * - skeleton: 콘텐츠 형태 스켈레톤
 * - progress: 진행률 바
 * - dots: 점 애니메이션
 */

export type LoadingVariant = "spinner" | "skeleton" | "progress" | "dots";
export type LoadingSize = "sm" | "md" | "lg" | "xl";

interface LoadingStateProps {
  /** 로딩 변형 */
  variant?: LoadingVariant;
  /** 크기 */
  size?: LoadingSize;
  /** 표시할 텍스트 */
  text?: string;
  /** 진행률 (progress 변형에서 사용) */
  progress?: number;
  /** 전체 화면 오버레이로 표시 */
  fullScreen?: boolean;
  /** 추가 CSS 클래스 */
  className?: string;
  /** 스켈레톤 변형에서의 줄 수 */
  skeletonLines?: number;
}

const sizeConfig: Record<LoadingSize, { spinner: string; text: string; container: string }> = {
  sm: { spinner: "h-4 w-4", text: "text-xs", container: "gap-2" },
  md: { spinner: "h-6 w-6", text: "text-sm", container: "gap-3" },
  lg: { spinner: "h-8 w-8", text: "text-base", container: "gap-4" },
  xl: { spinner: "h-12 w-12", text: "text-lg", container: "gap-5" },
};

/** 스피너 로딩 */
const SpinnerLoading = ({ size = "md", text, className }: Pick<LoadingStateProps, "size" | "text" | "className">) => {
  const config = sizeConfig[size];
  return (
    <div className={cn("flex flex-col items-center justify-center", config.container, className)}>
      <Loader2 className={cn("animate-spin text-primary", config.spinner)} />
      {text && <span className={cn("text-muted-foreground", config.text)}>{text}</span>}
    </div>
  );
};

/** 점 애니메이션 로딩 */
const DotsLoading = ({ size = "md", text, className }: Pick<LoadingStateProps, "size" | "text" | "className">) => {
  const config = sizeConfig[size];
  const dotSize = size === "sm" ? "h-1.5 w-1.5" : size === "md" ? "h-2 w-2" : size === "lg" ? "h-2.5 w-2.5" : "h-3 w-3";
  
  return (
    <div className={cn("flex flex-col items-center justify-center", config.container, className)}>
      <div className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={cn(
              "rounded-full bg-primary animate-bounce",
              dotSize
            )}
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
      {text && <span className={cn("text-muted-foreground", config.text)}>{text}</span>}
    </div>
  );
};

/** 프로그레스 바 로딩 */
const ProgressLoading = ({
  size = "md",
  text,
  progress = 0,
  className,
}: Pick<LoadingStateProps, "size" | "text" | "progress" | "className">) => {
  const config = sizeConfig[size];
  const progressHeight = size === "sm" ? "h-1" : size === "md" ? "h-2" : size === "lg" ? "h-3" : "h-4";

  return (
    <div className={cn("flex flex-col w-full max-w-xs", config.container, className)}>
      <Progress value={progress} className={progressHeight} />
      <div className="flex justify-between items-center">
        {text && <span className={cn("text-muted-foreground", config.text)}>{text}</span>}
        <span className={cn("text-muted-foreground font-medium", config.text)}>{Math.round(progress)}%</span>
      </div>
    </div>
  );
};

/** 스켈레톤 로딩 */
const SkeletonLoading = ({
  size = "md",
  skeletonLines = 3,
  className,
}: Pick<LoadingStateProps, "size" | "skeletonLines" | "className">) => {
  const lineHeight = size === "sm" ? "h-3" : size === "md" ? "h-4" : size === "lg" ? "h-5" : "h-6";
  const gap = size === "sm" ? "gap-2" : size === "md" ? "gap-3" : "gap-4";

  return (
    <div className={cn("flex flex-col w-full", gap, className)}>
      {Array.from({ length: skeletonLines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(lineHeight, i === skeletonLines - 1 ? "w-3/4" : "w-full")}
        />
      ))}
    </div>
  );
};

/** 카드 스켈레톤 */
export const CardSkeleton = ({ className }: { className?: string }) => (
  <div className={cn("rounded-lg border bg-card p-4 space-y-3", className)}>
    <Skeleton className="h-4 w-1/3" />
    <Skeleton className="h-3 w-full" />
    <Skeleton className="h-3 w-full" />
    <Skeleton className="h-3 w-2/3" />
    <div className="flex gap-2 pt-2">
      <Skeleton className="h-6 w-16 rounded-full" />
      <Skeleton className="h-6 w-16 rounded-full" />
    </div>
  </div>
);

/** 검색 결과 스켈레톤 */
export const SearchResultSkeleton = ({ count = 3, className }: { count?: number; className?: string }) => (
  <div className={cn("space-y-4", className)}>
    {Array.from({ length: count }).map((_, i) => (
      <CardSkeleton key={i} />
    ))}
  </div>
);

/** 테이블 스켈레톤 */
export const TableSkeleton = ({ rows = 5, cols = 4, className }: { rows?: number; cols?: number; className?: string }) => (
  <div className={cn("space-y-2", className)}>
    {/* Header */}
    <div className="flex gap-4 pb-2 border-b">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} className="h-4 flex-1" />
      ))}
    </div>
    {/* Rows */}
    {Array.from({ length: rows }).map((_, rowIndex) => (
      <div key={rowIndex} className="flex gap-4 py-2">
        {Array.from({ length: cols }).map((_, colIndex) => (
          <Skeleton key={colIndex} className="h-4 flex-1" />
        ))}
      </div>
    ))}
  </div>
);

/** 인라인 로딩 (버튼, 텍스트 옆 등) */
export const InlineLoading = ({ text, className }: { text?: string; className?: string }) => (
  <span className={cn("inline-flex items-center gap-2", className)}>
    <Loader2 className="h-4 w-4 animate-spin" />
    {text && <span>{text}</span>}
  </span>
);

/** 메인 LoadingState 컴포넌트 */
export const LoadingState = ({
  variant = "spinner",
  size = "md",
  text,
  progress,
  fullScreen = false,
  className,
  skeletonLines,
}: LoadingStateProps) => {
  const content = React.useMemo(() => {
    switch (variant) {
      case "spinner":
        return <SpinnerLoading size={size} text={text} />;
      case "dots":
        return <DotsLoading size={size} text={text} />;
      case "progress":
        return <ProgressLoading size={size} text={text} progress={progress} />;
      case "skeleton":
        return <SkeletonLoading size={size} skeletonLines={skeletonLines} />;
      default:
        return <SpinnerLoading size={size} text={text} />;
    }
  }, [variant, size, text, progress, skeletonLines]);

  if (fullScreen) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        {content}
      </div>
    );
  }

  return <div className={cn("flex items-center justify-center p-4", className)}>{content}</div>;
};

export default LoadingState;
