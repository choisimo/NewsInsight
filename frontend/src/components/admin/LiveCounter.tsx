import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface LiveCounterProps {
  /** 현재 값 */
  value: number;
  /** 이전 값 (변화량 계산용) */
  previousValue?: number;
  /** 라벨 */
  label: string;
  /** 아이콘 */
  icon?: React.ReactNode;
  /** 서브 텍스트 */
  subtitle?: string;
  /** 변화량 표시 여부 */
  showChange?: boolean;
  /** 로딩 상태 */
  isLoading?: boolean;
  /** 숫자 포맷 함수 */
  formatValue?: (value: number) => string;
  /** 클래스명 */
  className?: string;
}

/**
 * 실시간 카운터 컴포넌트
 * 값이 변경될 때 롤링 애니메이션 효과 적용
 */
export function LiveCounter({
  value,
  previousValue,
  label,
  icon,
  subtitle,
  showChange = true,
  isLoading = false,
  formatValue = (v) => v.toLocaleString(),
  className,
}: LiveCounterProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevValueRef = useRef(value);

  // 값 변경 시 롤링 애니메이션
  useEffect(() => {
    if (value === prevValueRef.current) return;

    setIsAnimating(true);
    const startValue = prevValueRef.current;
    const endValue = value;
    const duration = 500; // ms
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // easeOutQuad
      const eased = 1 - (1 - progress) * (1 - progress);
      const current = Math.round(startValue + (endValue - startValue) * eased);
      
      setDisplayValue(current);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setIsAnimating(false);
        prevValueRef.current = value;
      }
    };

    requestAnimationFrame(animate);
  }, [value]);

  const change = previousValue !== undefined ? value - previousValue : 0;
  const changePercent = previousValue && previousValue !== 0
    ? ((value - previousValue) / previousValue * 100).toFixed(1)
    : null;

  return (
    <div className={cn(
      'rounded-xl border bg-card p-6 shadow-sm transition-all duration-300',
      isAnimating && 'ring-2 ring-primary/20',
      className
    )}>
      <div className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="tracking-tight text-sm font-medium text-muted-foreground">
          {label}
        </div>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </div>
      
      <div className="flex items-baseline gap-2">
        {isLoading ? (
          <div className="h-8 w-24 animate-pulse rounded bg-muted" />
        ) : (
          <div className={cn(
            'text-2xl font-bold transition-colors duration-300',
            isAnimating && 'text-primary'
          )}>
            {formatValue(displayValue)}
          </div>
        )}
        
        {showChange && change !== 0 && !isLoading && (
          <div className={cn(
            'flex items-center text-xs font-medium',
            change > 0 ? 'text-green-600' : 'text-red-600'
          )}>
            {change > 0 ? (
              <TrendingUp className="h-3 w-3 mr-0.5" />
            ) : (
              <TrendingDown className="h-3 w-3 mr-0.5" />
            )}
            {change > 0 ? '+' : ''}{change.toLocaleString()}
            {changePercent && ` (${changePercent}%)`}
          </div>
        )}
        
        {showChange && change === 0 && previousValue !== undefined && !isLoading && (
          <div className="flex items-center text-xs font-medium text-muted-foreground">
            <Minus className="h-3 w-3 mr-0.5" />
            변화 없음
          </div>
        )}
      </div>
      
      {subtitle && (
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      )}
    </div>
  );
}

export default LiveCounter;
