import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  XCircle,
} from 'lucide-react';
import type { CollectionJobStatus } from '@/lib/api/collection';

interface JobStatusBadgeProps {
  status: CollectionJobStatus;
  /** 추가 텍스트 */
  label?: string;
  /** 사이즈 */
  size?: 'sm' | 'default';
  /** 클래스명 */
  className?: string;
}

const statusConfig: Record<CollectionJobStatus, {
  icon: React.ReactNode;
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  className: string;
}> = {
  PENDING: {
    icon: <Clock className="h-3 w-3" />,
    label: '대기 중',
    variant: 'secondary',
    className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300 border-yellow-200',
  },
  RUNNING: {
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    label: '수집 중',
    variant: 'default',
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 border-blue-200',
  },
  COMPLETED: {
    icon: <CheckCircle2 className="h-3 w-3" />,
    label: '완료',
    variant: 'secondary',
    className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 border-green-200',
  },
  FAILED: {
    icon: <AlertCircle className="h-3 w-3" />,
    label: '실패',
    variant: 'destructive',
    className: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 border-red-200',
  },
  CANCELLED: {
    icon: <XCircle className="h-3 w-3" />,
    label: '취소됨',
    variant: 'outline',
    className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-gray-200',
  },
};

/**
 * 수집 작업 상태 배지 컴포넌트
 */
export function JobStatusBadge({
  status,
  label,
  size = 'default',
  className,
}: JobStatusBadgeProps) {
  const config = statusConfig[status];
  
  return (
    <Badge
      variant={config.variant}
      className={cn(
        'flex items-center gap-1',
        config.className,
        size === 'sm' && 'text-xs px-1.5 py-0',
        className
      )}
    >
      {config.icon}
      {label || config.label}
    </Badge>
  );
}

export default JobStatusBadge;
