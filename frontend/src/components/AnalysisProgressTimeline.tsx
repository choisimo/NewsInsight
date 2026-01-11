import { useMemo } from "react";
import {
  Search,
  Globe,
  FileText,
  Layers,
  CheckCircle2,
  Loader2,
  Circle,
  AlertCircle,
  Clock,
  Zap,
  Database,
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

/** 분석 단계 정의 */
export type AnalysisStep =
  | "queued"
  | "initializing"
  | "searching"
  | "collecting"
  | "analyzing"
  | "classifying"
  | "summarizing"
  | "completed"
  | "failed";

export interface AnalysisStepInfo {
  id: AnalysisStep;
  label: string;
  description: string;
  icon: typeof Search;
  estimatedDuration?: number; // seconds
}

/** 기본 분석 단계 설정 */
export const DEFAULT_ANALYSIS_STEPS: AnalysisStepInfo[] = [
  {
    id: "queued",
    label: "대기 중",
    description: "분석 요청이 대기열에 추가되었습니다",
    icon: Clock,
    estimatedDuration: 2,
  },
  {
    id: "initializing",
    label: "초기화",
    description: "분석 환경을 준비하고 있습니다",
    icon: Zap,
    estimatedDuration: 3,
  },
  {
    id: "searching",
    label: "검색 중",
    description: "웹에서 관련 정보를 검색하고 있습니다",
    icon: Globe,
    estimatedDuration: 15,
  },
  {
    id: "collecting",
    label: "수집 중",
    description: "검색된 페이지에서 정보를 수집하고 있습니다",
    icon: Database,
    estimatedDuration: 20,
  },
  {
    id: "analyzing",
    label: "분석 중",
    description: "AI가 수집된 정보를 분석하고 있습니다",
    icon: Layers,
    estimatedDuration: 30,
  },
  {
    id: "classifying",
    label: "분류 중",
    description: "증거를 입장별로 분류하고 있습니다",
    icon: Filter,
    estimatedDuration: 10,
  },
  {
    id: "summarizing",
    label: "요약 중",
    description: "분석 결과를 정리하고 있습니다",
    icon: FileText,
    estimatedDuration: 5,
  },
  {
    id: "completed",
    label: "완료",
    description: "분석이 완료되었습니다",
    icon: CheckCircle2,
  },
];

export interface StepProgress {
  step: AnalysisStep;
  status: "pending" | "active" | "completed" | "error";
  message?: string;
  startedAt?: string;
  completedAt?: string;
  itemsProcessed?: number;
  totalItems?: number;
}

interface AnalysisProgressTimelineProps {
  /** 현재 단계 */
  currentStep: AnalysisStep;
  /** 각 단계별 상세 진행 상황 */
  stepProgress?: StepProgress[];
  /** 전체 진행률 (0-100) */
  overallProgress?: number;
  /** 현재 진행 메시지 */
  message?: string;
  /** 수집된 항목 수 */
  collectedCount?: number;
  /** 실패 여부 */
  failed?: boolean;
  /** 에러 메시지 */
  errorMessage?: string;
  /** 분석 주제 */
  topic?: string;
  /** 단계 설정 (커스텀) */
  steps?: AnalysisStepInfo[];
  /** 컴팩트 모드 */
  compact?: boolean;
  /** 추가 CSS 클래스 */
  className?: string;
}

/** 단계 인덱스 계산 */
const getStepIndex = (step: AnalysisStep, steps: AnalysisStepInfo[]): number => {
  return steps.findIndex((s) => s.id === step);
};

/** 단계 상태 결정 */
const getStepStatus = (
  stepInfo: AnalysisStepInfo,
  currentStep: AnalysisStep,
  steps: AnalysisStepInfo[],
  failed: boolean
): "pending" | "active" | "completed" | "error" => {
  const currentIndex = getStepIndex(currentStep, steps);
  const stepIndex = getStepIndex(stepInfo.id, steps);

  if (failed && stepIndex === currentIndex) return "error";
  if (stepIndex < currentIndex) return "completed";
  if (stepIndex === currentIndex) return "active";
  return "pending";
};

export function AnalysisProgressTimeline({
  currentStep,
  stepProgress,
  overallProgress,
  message,
  collectedCount,
  failed = false,
  errorMessage,
  topic,
  steps = DEFAULT_ANALYSIS_STEPS,
  compact = false,
  className,
}: AnalysisProgressTimelineProps) {
  // 진행 중인 단계들만 표시 (completed 제외, 실패가 아닐 때)
  const visibleSteps = useMemo(() => {
    if (failed) return steps;
    const completedIndex = steps.findIndex((s) => s.id === "completed");
    if (currentStep === "completed") return steps;
    return steps.slice(0, completedIndex);
  }, [steps, currentStep, failed]);

  // 전체 진행률 계산
  const calculatedProgress = useMemo(() => {
    if (overallProgress !== undefined) return overallProgress;
    const currentIndex = getStepIndex(currentStep, steps);
    const totalSteps = steps.length - 1; // completed 제외
    if (currentStep === "completed") return 100;
    if (currentStep === "failed") return 0;
    return Math.round((currentIndex / totalSteps) * 100);
  }, [currentStep, steps, overallProgress]);

  // 컴팩트 모드
  if (compact) {
    return (
      <div className={cn("space-y-3", className)}>
        {/* 진행 바 */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {message || steps.find((s) => s.id === currentStep)?.description}
            </span>
            <span className="font-medium">{calculatedProgress}%</span>
          </div>
          <Progress value={calculatedProgress} className="h-2" />
        </div>

        {/* 현재 단계 표시 */}
        <div className="flex items-center gap-2">
          {(() => {
            const stepInfo = steps.find((s) => s.id === currentStep);
            if (!stepInfo) return null;
            const Icon = stepInfo.icon;
            const status = getStepStatus(stepInfo, currentStep, steps, failed);

            return (
              <>
                {status === "active" ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : status === "completed" ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : status === "error" ? (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                ) : (
                  <Icon className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="font-medium">{stepInfo.label}</span>
                {collectedCount !== undefined && collectedCount > 0 && (
                  <Badge variant="secondary" className="ml-auto">
                    {collectedCount}개 수집
                  </Badge>
                )}
              </>
            );
          })()}
        </div>
      </div>
    );
  }

  // 전체 타임라인 모드
  return (
    <div className={cn("space-y-6", className)}>
      {/* 헤더 */}
      {topic && (
        <div className="text-center">
          <h3 className="font-semibold text-lg">'{topic}' 분석 중</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {message || "AI가 웹에서 정보를 수집하고 분석하고 있습니다."}
          </p>
        </div>
      )}

      {/* 전체 진행률 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">전체 진행률</span>
          <span className="font-medium">{calculatedProgress}%</span>
        </div>
        <Progress value={calculatedProgress} className="h-3" />
        {collectedCount !== undefined && collectedCount > 0 && (
          <p className="text-sm text-center text-muted-foreground">
            현재까지 <span className="font-medium text-foreground">{collectedCount}개</span>의
            증거를 수집했습니다
          </p>
        )}
      </div>

      {/* 단계별 타임라인 */}
      <div className="relative">
        {/* 연결선 */}
        <div className="absolute left-[15px] top-0 bottom-0 w-0.5 bg-border" />

        <div className="space-y-1">
          {visibleSteps.map((stepInfo, index) => {
            const status = getStepStatus(stepInfo, currentStep, steps, failed);
            const Icon = stepInfo.icon;
            const progressInfo = stepProgress?.find((p) => p.step === stepInfo.id);

            return (
              <div
                key={stepInfo.id}
                className={cn(
                  "relative flex items-start gap-4 p-3 rounded-lg transition-all",
                  status === "active" && "bg-primary/5",
                  status === "error" && "bg-destructive/5"
                )}
              >
                {/* 아이콘 */}
                <div
                  className={cn(
                    "relative z-10 flex items-center justify-center w-8 h-8 rounded-full border-2 transition-all",
                    status === "completed" && "bg-green-500 border-green-500 text-white",
                    status === "active" && "bg-primary border-primary text-primary-foreground",
                    status === "error" && "bg-destructive border-destructive text-destructive-foreground",
                    status === "pending" && "bg-background border-muted-foreground/30 text-muted-foreground"
                  )}
                >
                  {status === "active" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : status === "completed" ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : status === "error" ? (
                    <AlertCircle className="h-4 w-4" />
                  ) : (
                    <Circle className="h-3 w-3" />
                  )}
                </div>

                {/* 내용 */}
                <div className="flex-1 min-w-0 pt-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "font-medium",
                        status === "active" && "text-primary",
                        status === "completed" && "text-green-600",
                        status === "error" && "text-destructive",
                        status === "pending" && "text-muted-foreground"
                      )}
                    >
                      {stepInfo.label}
                    </span>
                    {status === "active" && progressInfo?.itemsProcessed !== undefined && (
                      <Badge variant="secondary" className="text-xs">
                        {progressInfo.itemsProcessed}
                        {progressInfo.totalItems ? `/${progressInfo.totalItems}` : ""}
                      </Badge>
                    )}
                  </div>
                  <p
                    className={cn(
                      "text-sm",
                      status === "active" ? "text-muted-foreground" : "text-muted-foreground/70"
                    )}
                  >
                    {progressInfo?.message || stepInfo.description}
                  </p>
                  {status === "error" && errorMessage && (
                    <p className="text-sm text-destructive mt-1">{errorMessage}</p>
                  )}
                </div>

                {/* 시간 표시 */}
                {progressInfo?.completedAt && status === "completed" && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(progressInfo.completedAt).toLocaleTimeString("ko-KR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 안내 메시지 */}
      <p className="text-xs text-center text-muted-foreground">
        다른 페이지로 이동해도 분석은 백그라운드에서 계속됩니다
      </p>
    </div>
  );
}

/** 간단한 인라인 진행률 표시 */
export function InlineAnalysisProgress({
  currentStep,
  progress,
  message,
  collectedCount,
  className,
}: {
  currentStep: AnalysisStep;
  progress?: number;
  message?: string;
  collectedCount?: number;
  className?: string;
}) {
  const stepInfo = DEFAULT_ANALYSIS_STEPS.find((s) => s.id === currentStep);
  const Icon = stepInfo?.icon || Search;

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex items-center gap-2 text-sm">
        {currentStep === "completed" ? (
          <CheckCircle2 className="h-4 w-4 text-green-600" />
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        )}
        <span className="font-medium">{stepInfo?.label || currentStep}</span>
      </div>
      {progress !== undefined && (
        <Progress value={progress} className="flex-1 h-2 max-w-[200px]" />
      )}
      {collectedCount !== undefined && collectedCount > 0 && (
        <Badge variant="outline" className="text-xs">
          {collectedCount}개 수집
        </Badge>
      )}
      {message && (
        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
          {message}
        </span>
      )}
    </div>
  );
}

export default AnalysisProgressTimeline;
