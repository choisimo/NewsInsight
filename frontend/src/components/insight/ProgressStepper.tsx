import * as React from "react";
import { cn } from "@/lib/utils";
import { Check, Lightbulb, Scale, BarChart3, Target, List } from "lucide-react";

// ============================================
// Step Configuration
// ============================================

export interface StepConfig {
  id: string;
  label: string;
  icon: React.ElementType;
  shortLabel?: string;
}

export const DEFAULT_INSIGHT_STEPS: StepConfig[] = [
  { id: "intro", label: "핵심 요약", shortLabel: "요약", icon: Lightbulb },
  { id: "viewpoint", label: "관점 비교", shortLabel: "비교", icon: Scale },
  { id: "data", label: "데이터 분석", shortLabel: "분석", icon: BarChart3 },
  { id: "evidence", label: "상세 증거", shortLabel: "증거", icon: List },
  { id: "conclusion", label: "최종 결론", shortLabel: "결론", icon: Target },
];

// ============================================
// Progress Stepper Component
// ============================================

interface ProgressStepperProps {
  steps: StepConfig[];
  currentStep: number;
  onStepClick?: (stepIndex: number) => void;
  className?: string;
  variant?: "dots" | "bar" | "steps";
}

export const ProgressStepper = ({
  steps,
  currentStep,
  onStepClick,
  className,
  variant = "dots",
}: ProgressStepperProps) => {
  if (variant === "dots") {
    return (
      <DotsProgress
        steps={steps}
        currentStep={currentStep}
        onStepClick={onStepClick}
        className={className}
      />
    );
  }

  if (variant === "bar") {
    return (
      <BarProgress
        steps={steps}
        currentStep={currentStep}
        className={className}
      />
    );
  }

  return (
    <StepsProgress
      steps={steps}
      currentStep={currentStep}
      onStepClick={onStepClick}
      className={className}
    />
  );
};

// ============================================
// Dots Variant (Default)
// ============================================

const DotsProgress = ({
  steps,
  currentStep,
  onStepClick,
  className,
}: ProgressStepperProps) => {
  return (
    <div className={cn("flex items-center justify-center gap-2", className)}>
      {steps.map((step, idx) => {
        const isActive = idx === currentStep;
        const isCompleted = idx < currentStep;

        return (
          <React.Fragment key={step.id}>
            <button
              onClick={() => onStepClick?.(idx)}
              disabled={!onStepClick}
              className={cn(
                "relative group transition-all duration-300",
                onStepClick && "cursor-pointer",
                !onStepClick && "cursor-default"
              )}
              aria-label={step.label}
            >
              <div
                className={cn(
                  "w-3 h-3 rounded-full transition-all duration-300",
                  isActive && "w-8 bg-primary scale-110",
                  isCompleted && "bg-primary",
                  !isActive && !isCompleted && "bg-muted-foreground/30"
                )}
              />
              {/* Tooltip */}
              <div
                className={cn(
                  "absolute -bottom-8 left-1/2 -translate-x-1/2",
                  "px-2 py-1 rounded text-xs whitespace-nowrap",
                  "bg-popover border shadow-md",
                  "opacity-0 group-hover:opacity-100 transition-opacity",
                  "pointer-events-none z-10"
                )}
              >
                {step.label}
              </div>
            </button>

            {/* Connector line */}
            {idx < steps.length - 1 && (
              <div
                className={cn(
                  "w-6 md:w-8 h-0.5 transition-colors duration-300",
                  idx < currentStep ? "bg-primary" : "bg-muted-foreground/30"
                )}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

// ============================================
// Bar Variant
// ============================================

const BarProgress = ({
  steps,
  currentStep,
  className,
}: Omit<ProgressStepperProps, "onStepClick" | "variant">) => {
  const progress = ((currentStep + 1) / steps.length) * 100;

  return (
    <div className={cn("w-full", className)}>
      {/* Labels */}
      <div className="flex justify-between mb-2 px-1">
        <span className="text-xs text-muted-foreground">
          {currentStep + 1} / {steps.length}
        </span>
        <span className="text-xs font-medium text-foreground">
          {steps[currentStep]?.label}
        </span>
      </div>

      {/* Progress Bar */}
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-500 ease-out rounded-full"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};

// ============================================
// Steps Variant (Full labels)
// ============================================

const StepsProgress = ({
  steps,
  currentStep,
  onStepClick,
  className,
}: ProgressStepperProps) => {
  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center justify-between">
        {steps.map((step, idx) => {
          const isActive = idx === currentStep;
          const isCompleted = idx < currentStep;
          const Icon = step.icon;

          return (
            <React.Fragment key={step.id}>
              <button
                onClick={() => onStepClick?.(idx)}
                disabled={!onStepClick}
                className={cn(
                  "flex flex-col items-center gap-2 group",
                  onStepClick && "cursor-pointer",
                  !onStepClick && "cursor-default"
                )}
              >
                {/* Circle */}
                <div
                  className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center",
                    "border-2 transition-all duration-300",
                    isActive &&
                      "border-primary bg-primary text-primary-foreground scale-110",
                    isCompleted &&
                      "border-primary bg-primary/10 text-primary",
                    !isActive &&
                      !isCompleted &&
                      "border-muted-foreground/30 text-muted-foreground/50"
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    <Icon className="h-5 w-5" />
                  )}
                </div>

                {/* Label */}
                <span
                  className={cn(
                    "text-xs transition-colors duration-300 hidden md:block",
                    isActive && "text-foreground font-medium",
                    isCompleted && "text-primary",
                    !isActive && !isCompleted && "text-muted-foreground"
                  )}
                >
                  {step.label}
                </span>
                <span
                  className={cn(
                    "text-xs transition-colors duration-300 md:hidden",
                    isActive && "text-foreground font-medium",
                    isCompleted && "text-primary",
                    !isActive && !isCompleted && "text-muted-foreground"
                  )}
                >
                  {step.shortLabel || step.label}
                </span>
              </button>

              {/* Connector */}
              {idx < steps.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-2 transition-colors duration-300",
                    idx < currentStep ? "bg-primary" : "bg-muted-foreground/30"
                  )}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

// ============================================
// Slide Counter (Simple version)
// ============================================

interface SlideCounterProps {
  current: number;
  total: number;
  className?: string;
}

export const SlideCounter = ({ current, total, className }: SlideCounterProps) => {
  return (
    <div className={cn("flex items-center gap-2 text-sm", className)}>
      <span className="font-bold text-foreground">{current}</span>
      <span className="text-muted-foreground">/</span>
      <span className="text-muted-foreground">{total}</span>
    </div>
  );
};

// ============================================
// Navigation Controls
// ============================================

interface NavigationControlsProps {
  currentStep: number;
  totalSteps: number;
  onPrevious: () => void;
  onNext: () => void;
  canGoPrevious: boolean;
  canGoNext: boolean;
  className?: string;
}

export const NavigationControls = ({
  currentStep,
  totalSteps,
  onPrevious,
  onNext,
  canGoPrevious,
  canGoNext,
  className,
}: NavigationControlsProps) => {
  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      <button
        onClick={onPrevious}
        disabled={!canGoPrevious}
        className={cn(
          "px-4 py-2 rounded-lg text-sm font-medium transition-all",
          "border border-border",
          canGoPrevious
            ? "hover:bg-accent hover:text-accent-foreground"
            : "opacity-50 cursor-not-allowed"
        )}
      >
        ← 이전
      </button>

      <SlideCounter current={currentStep + 1} total={totalSteps} />

      <button
        onClick={onNext}
        disabled={!canGoNext}
        className={cn(
          "px-4 py-2 rounded-lg text-sm font-medium transition-all",
          "bg-primary text-primary-foreground",
          canGoNext
            ? "hover:bg-primary/90"
            : "opacity-50 cursor-not-allowed"
        )}
      >
        다음 →
      </button>
    </div>
  );
};

export default ProgressStepper;
