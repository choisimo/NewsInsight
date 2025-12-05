import { useState, useCallback, useRef, useEffect } from "react";
import { X, Loader2, CheckCircle2, AlertCircle, XCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ProgressToastStatus = "loading" | "success" | "error" | "cancelled";

interface ProgressToast {
  id: string;
  title: string;
  description?: string;
  progress: number;
  status: ProgressToastStatus;
  cancellable?: boolean;
  onCancel?: () => void;
  duration?: number;
}

interface ProgressToastItemProps {
  toast: ProgressToast;
  onDismiss: (id: string) => void;
}

const statusIcons = {
  loading: <Loader2 className="h-5 w-5 animate-spin text-primary" />,
  success: <CheckCircle2 className="h-5 w-5 text-green-600" />,
  error: <AlertCircle className="h-5 w-5 text-red-600" />,
  cancelled: <XCircle className="h-5 w-5 text-gray-500" />,
};

const statusColors = {
  loading: "border-l-primary",
  success: "border-l-green-500",
  error: "border-l-red-500",
  cancelled: "border-l-gray-400",
};

function ProgressToastItem({ toast, onDismiss }: ProgressToastItemProps) {
  const [isVisible, setIsVisible] = useState(true);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Auto-dismiss completed toasts
    if (toast.status !== "loading" && toast.duration) {
      timeoutRef.current = setTimeout(() => {
        setIsVisible(false);
        setTimeout(() => onDismiss(toast.id), 300);
      }, toast.duration);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [toast.status, toast.duration, toast.id, onDismiss]);

  const handleCancel = useCallback(() => {
    if (toast.onCancel) {
      toast.onCancel();
    }
  }, [toast]);

  const handleDismiss = useCallback(() => {
    setIsVisible(false);
    setTimeout(() => onDismiss(toast.id), 300);
  }, [toast.id, onDismiss]);

  return (
    <div
      className={cn(
        "relative flex items-start gap-3 p-4 rounded-lg border border-l-4 bg-background shadow-lg transition-all duration-300",
        statusColors[toast.status],
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      )}
      role="alert"
      aria-live="polite"
    >
      <div className="shrink-0 mt-0.5">{statusIcons[toast.status]}</div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h4 className="font-medium text-sm">{toast.title}</h4>
            {toast.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{toast.description}</p>
            )}
          </div>
          
          <div className="flex items-center gap-1 shrink-0">
            {toast.status === "loading" && toast.cancellable && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                onClick={handleCancel}
                aria-label="취소"
              >
                <X className="h-3 w-3" />
              </Button>
            )}
            {toast.status !== "loading" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={handleDismiss}
                aria-label="닫기"
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
        
        {toast.status === "loading" && (
          <div className="mt-2 space-y-1">
            <Progress value={toast.progress} className="h-1.5" />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{toast.progress}%</span>
              {toast.cancellable && (
                <button
                  onClick={handleCancel}
                  className="text-destructive hover:underline"
                >
                  취소
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface UseProgressToastOptions {
  maxToasts?: number;
  defaultDuration?: number;
}

/**
 * 진행 상태를 표시하는 토스트 훅
 * 
 * @example
 * ```tsx
 * const { toasts, addToast, updateToast, dismissToast, ToastContainer } = useProgressToast();
 * 
 * // 토스트 추가
 * const id = addToast({
 *   title: "파일 업로드 중...",
 *   progress: 0,
 *   cancellable: true,
 *   onCancel: () => abortController.abort(),
 * });
 * 
 * // 진행률 업데이트
 * updateToast(id, { progress: 50, description: "50% 완료" });
 * 
 * // 완료 처리
 * updateToast(id, { status: "success", title: "업로드 완료!" });
 * ```
 */
export function useProgressToast(options: UseProgressToastOptions = {}) {
  const { maxToasts = 5, defaultDuration = 3000 } = options;
  const [toasts, setToasts] = useState<ProgressToast[]>([]);
  const toastIdCounter = useRef(0);

  const addToast = useCallback((
    toast: Omit<ProgressToast, "id" | "status"> & { status?: ProgressToastStatus }
  ): string => {
    const id = `progress-toast-${++toastIdCounter.current}`;
    const newToast: ProgressToast = {
      id,
      status: "loading",
      duration: defaultDuration,
      ...toast,
    };

    setToasts((prev) => {
      const updated = [newToast, ...prev];
      return updated.slice(0, maxToasts);
    });

    return id;
  }, [maxToasts, defaultDuration]);

  const updateToast = useCallback((id: string, updates: Partial<ProgressToast>) => {
    setToasts((prev) =>
      prev.map((toast) =>
        toast.id === id ? { ...toast, ...updates } : toast
      )
    );
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  const ToastContainer = useCallback(() => (
    <div
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]"
      role="region"
      aria-label="알림"
    >
      {toasts.map((toast) => (
        <ProgressToastItem
          key={toast.id}
          toast={toast}
          onDismiss={dismissToast}
        />
      ))}
    </div>
  ), [toasts, dismissToast]);

  return {
    toasts,
    addToast,
    updateToast,
    dismissToast,
    dismissAll,
    ToastContainer,
  };
}

export default useProgressToast;
