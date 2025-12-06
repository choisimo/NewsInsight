import * as React from "react";
import { AlertCircle, RefreshCw, XCircle, WifiOff, ServerCrash, FileWarning } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * 통합 에러 상태 컴포넌트
 * 
 * 다양한 에러 유형 지원:
 * - generic: 일반 에러
 * - network: 네트워크 에러
 * - server: 서버 에러
 * - notFound: 리소스 없음
 * - permission: 권한 에러
 */

export type ErrorType = "generic" | "network" | "server" | "notFound" | "permission";
export type ErrorVariant = "inline" | "card" | "fullPage";

interface ErrorStateProps {
  /** 에러 유형 */
  type?: ErrorType;
  /** 표시 스타일 */
  variant?: ErrorVariant;
  /** 에러 제목 */
  title?: string;
  /** 에러 상세 메시지 */
  message?: string;
  /** 재시도 콜백 */
  onRetry?: () => void;
  /** 재시도 버튼 텍스트 */
  retryText?: string;
  /** 재시도 중 상태 */
  isRetrying?: boolean;
  /** 취소/닫기 콜백 */
  onDismiss?: () => void;
  /** 추가 CSS 클래스 */
  className?: string;
  /** 자식 요소 (추가 액션 등) */
  children?: React.ReactNode;
}

const errorConfig: Record<ErrorType, { icon: typeof AlertCircle; defaultTitle: string; defaultMessage: string }> = {
  generic: {
    icon: AlertCircle,
    defaultTitle: "오류가 발생했습니다",
    defaultMessage: "요청을 처리하는 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.",
  },
  network: {
    icon: WifiOff,
    defaultTitle: "네트워크 연결 오류",
    defaultMessage: "인터넷 연결을 확인하고 다시 시도해주세요.",
  },
  server: {
    icon: ServerCrash,
    defaultTitle: "서버 오류",
    defaultMessage: "서버에서 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
  },
  notFound: {
    icon: FileWarning,
    defaultTitle: "찾을 수 없음",
    defaultMessage: "요청하신 리소스를 찾을 수 없습니다.",
  },
  permission: {
    icon: XCircle,
    defaultTitle: "접근 권한 없음",
    defaultMessage: "이 작업을 수행할 권한이 없습니다.",
  },
};

/** 인라인 에러 (Alert 형태) */
const InlineError = ({
  type = "generic",
  title,
  message,
  onRetry,
  retryText = "다시 시도",
  isRetrying,
  onDismiss,
  className,
  children,
}: ErrorStateProps) => {
  const config = errorConfig[type];
  const Icon = config.icon;

  return (
    <Alert variant="destructive" className={cn("relative", className)}>
      <Icon className="h-4 w-4" />
      <AlertTitle>{title || config.defaultTitle}</AlertTitle>
      <AlertDescription className="mt-2">
        <p>{message || config.defaultMessage}</p>
        {(onRetry || onDismiss || children) && (
          <div className="flex items-center gap-2 mt-3">
            {onRetry && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRetry}
                disabled={isRetrying}
                className="gap-1"
              >
                <RefreshCw className={cn("h-3 w-3", isRetrying && "animate-spin")} />
                {retryText}
              </Button>
            )}
            {onDismiss && (
              <Button variant="ghost" size="sm" onClick={onDismiss}>
                닫기
              </Button>
            )}
            {children}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
};

/** 카드 형태 에러 */
const CardError = ({
  type = "generic",
  title,
  message,
  onRetry,
  retryText = "다시 시도",
  isRetrying,
  onDismiss,
  className,
  children,
}: ErrorStateProps) => {
  const config = errorConfig[type];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-8 text-center rounded-lg border border-destructive/20 bg-destructive/5",
        className
      )}
    >
      <div className="p-3 rounded-full bg-destructive/10 mb-4">
        <Icon className="h-8 w-8 text-destructive" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">{title || config.defaultTitle}</h3>
      <p className="text-sm text-muted-foreground max-w-md mb-4">{message || config.defaultMessage}</p>
      {(onRetry || onDismiss || children) && (
        <div className="flex items-center gap-3">
          {onRetry && (
            <Button onClick={onRetry} disabled={isRetrying} className="gap-2">
              <RefreshCw className={cn("h-4 w-4", isRetrying && "animate-spin")} />
              {retryText}
            </Button>
          )}
          {onDismiss && (
            <Button variant="outline" onClick={onDismiss}>
              닫기
            </Button>
          )}
          {children}
        </div>
      )}
    </div>
  );
};

/** 전체 페이지 에러 */
const FullPageError = ({
  type = "generic",
  title,
  message,
  onRetry,
  retryText = "다시 시도",
  isRetrying,
  className,
  children,
}: ErrorStateProps) => {
  const config = errorConfig[type];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "min-h-[400px] flex flex-col items-center justify-center p-8 text-center",
        className
      )}
    >
      <div className="p-4 rounded-full bg-destructive/10 mb-6">
        <Icon className="h-12 w-12 text-destructive" />
      </div>
      <h2 className="text-2xl font-bold text-foreground mb-3">{title || config.defaultTitle}</h2>
      <p className="text-muted-foreground max-w-lg mb-6">{message || config.defaultMessage}</p>
      {(onRetry || children) && (
        <div className="flex items-center gap-3">
          {onRetry && (
            <Button size="lg" onClick={onRetry} disabled={isRetrying} className="gap-2">
              <RefreshCw className={cn("h-5 w-5", isRetrying && "animate-spin")} />
              {retryText}
            </Button>
          )}
          {children}
        </div>
      )}
    </div>
  );
};

/** 메인 ErrorState 컴포넌트 */
export const ErrorState = ({ variant = "card", ...props }: ErrorStateProps) => {
  switch (variant) {
    case "inline":
      return <InlineError {...props} />;
    case "fullPage":
      return <FullPageError {...props} />;
    case "card":
    default:
      return <CardError {...props} />;
  }
};

/** 에러 바운더리 폴백 컴포넌트 */
export const ErrorBoundaryFallback = ({
  error,
  resetErrorBoundary,
}: {
  error: Error;
  resetErrorBoundary?: () => void;
}) => (
  <ErrorState
    type="generic"
    variant="fullPage"
    title="예기치 않은 오류"
    message={error.message || "애플리케이션에서 오류가 발생했습니다."}
    onRetry={resetErrorBoundary}
    retryText="새로고침"
  />
);

/** 빈 상태 컴포넌트 */
interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState = ({ icon, title, description, action, className }: EmptyStateProps) => (
  <div className={cn("flex flex-col items-center justify-center p-8 text-center", className)}>
    {icon && <div className="mb-4 text-muted-foreground">{icon}</div>}
    <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
    {description && <p className="text-sm text-muted-foreground max-w-md mb-4">{description}</p>}
    {action}
  </div>
);

export default ErrorState;
