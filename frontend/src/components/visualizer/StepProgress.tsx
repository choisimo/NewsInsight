import { cn } from '@/lib/utils';
import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  ChevronRight,
} from 'lucide-react';

export interface Step {
  id: string;
  name: string;
  description?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
  provider?: string;
}

interface StepProgressProps {
  steps: Step[];
  /** 현재 활성 단계 인덱스 */
  currentStepIndex?: number;
  /** 방향 */
  orientation?: 'horizontal' | 'vertical';
  /** 클래스명 */
  className?: string;
}

const statusConfig: Record<Step['status'], {
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  pending: {
    icon: <Circle className="h-5 w-5" />,
    color: 'text-gray-400',
    bgColor: 'bg-gray-100 dark:bg-gray-800',
    borderColor: 'border-gray-300 dark:border-gray-600',
  },
  running: {
    icon: <Loader2 className="h-5 w-5 animate-spin" />,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 dark:bg-blue-950',
    borderColor: 'border-blue-400',
  },
  completed: {
    icon: <CheckCircle2 className="h-5 w-5" />,
    color: 'text-green-600',
    bgColor: 'bg-green-50 dark:bg-green-950',
    borderColor: 'border-green-400',
  },
  failed: {
    icon: <AlertCircle className="h-5 w-5" />,
    color: 'text-red-600',
    bgColor: 'bg-red-50 dark:bg-red-950',
    borderColor: 'border-red-400',
  },
};

function StepItem({
  step,
  isLast,
  orientation,
}: {
  step: Step;
  isLast: boolean;
  orientation: 'horizontal' | 'vertical';
}) {
  const config = statusConfig[step.status];
  const isHorizontal = orientation === 'horizontal';

  return (
    <div
      className={cn(
        'flex',
        isHorizontal ? 'flex-col items-center' : 'items-start gap-4'
      )}
    >
      {/* Icon & Connector */}
      <div
        className={cn(
          'flex',
          isHorizontal ? 'flex-row items-center' : 'flex-col items-center'
        )}
      >
        {/* Step Icon */}
        <div
          className={cn(
            'flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all',
            config.color,
            config.bgColor,
            config.borderColor,
            step.status === 'running' && 'ring-4 ring-blue-200 dark:ring-blue-800'
          )}
        >
          {config.icon}
        </div>

        {/* Connector Line */}
        {!isLast && (
          <div
            className={cn(
              isHorizontal
                ? 'w-12 h-0.5 mx-2'
                : 'w-0.5 h-8 my-2',
              step.status === 'completed'
                ? 'bg-green-400'
                : 'bg-gray-200 dark:bg-gray-700'
            )}
          />
        )}
      </div>

      {/* Content */}
      <div
        className={cn(
          isHorizontal ? 'text-center mt-2 max-w-[120px]' : 'flex-1 pb-4'
        )}
      >
        <h4
          className={cn(
            'text-sm font-medium',
            step.status === 'running' && 'text-blue-600',
            step.status === 'completed' && 'text-green-600',
            step.status === 'failed' && 'text-red-600'
          )}
        >
          {step.name}
        </h4>
        {step.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {step.description}
          </p>
        )}
        {step.provider && (
          <span className="text-xs text-muted-foreground">
            via {step.provider}
          </span>
        )}
        {step.error && (
          <p className="text-xs text-red-600 mt-1 line-clamp-2">{step.error}</p>
        )}
      </div>
    </div>
  );
}

/**
 * AI 분석 진행 단계 시각화 컴포넌트
 */
export function StepProgress({
  steps,
  currentStepIndex,
  orientation = 'vertical',
  className,
}: StepProgressProps) {
  // 진행률 계산
  const completedCount = steps.filter((s) => s.status === 'completed').length;
  const progress = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Progress Summary */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          진행률: {completedCount}/{steps.length}
        </span>
        <span className="text-sm font-medium">{progress}%</span>
      </div>

      {/* Progress Bar */}
      <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Steps */}
      <div
        className={cn(
          'pt-4',
          orientation === 'horizontal'
            ? 'flex items-start justify-between'
            : 'space-y-0'
        )}
      >
        {steps.map((step, index) => (
          <StepItem
            key={step.id}
            step={step}
            isLast={index === steps.length - 1}
            orientation={orientation}
          />
        ))}
      </div>
    </div>
  );
}

export default StepProgress;
