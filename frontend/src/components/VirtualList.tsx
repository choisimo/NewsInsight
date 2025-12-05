import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";

interface VirtualListProps<T> {
  /** 렌더링할 아이템 배열 */
  items: T[];
  /** 각 아이템의 예상 높이 (픽셀) */
  itemHeight: number;
  /** 컨테이너 높이 (픽셀 또는 CSS 값) */
  containerHeight: number | string;
  /** 오버스캔 - 화면 밖에 추가로 렌더링할 아이템 수 */
  overscan?: number;
  /** 아이템 렌더 함수 */
  renderItem: (item: T, index: number, style: React.CSSProperties) => React.ReactNode;
  /** 아이템 키 추출 함수 */
  getItemKey: (item: T, index: number) => string | number;
  /** 추가 CSS 클래스 */
  className?: string;
  /** 빈 상태 렌더링 */
  emptyState?: React.ReactNode;
  /** 로딩 상태 */
  loading?: boolean;
  /** 로딩 상태 렌더링 */
  loadingState?: React.ReactNode;
}

/**
 * 가상화된 리스트 컴포넌트
 * 대량의 데이터를 효율적으로 렌더링
 * 
 * @example
 * ```tsx
 * <VirtualList
 *   items={searchResults}
 *   itemHeight={80}
 *   containerHeight={600}
 *   getItemKey={(item) => item.id}
 *   renderItem={(item, index, style) => (
 *     <div style={style}>
 *       <SearchResultCard result={item} />
 *     </div>
 *   )}
 * />
 * ```
 */
export function VirtualList<T>({
  items,
  itemHeight,
  containerHeight,
  overscan = 3,
  renderItem,
  getItemKey,
  className,
  emptyState,
  loading,
  loadingState,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  // 컨테이너 높이를 픽셀로 계산
  const [containerHeightPx, setContainerHeightPx] = useState(
    typeof containerHeight === "number" ? containerHeight : 400
  );

  // 컨테이너 크기 관찰
  useEffect(() => {
    if (typeof containerHeight === "number") {
      setContainerHeightPx(containerHeight);
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeightPx(entry.contentRect.height);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [containerHeight]);

  // 스크롤 핸들러
  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  // 가상화 계산
  const virtualData = useMemo(() => {
    const totalHeight = items.length * itemHeight;
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
      items.length - 1,
      Math.floor((scrollTop + containerHeightPx) / itemHeight) + overscan
    );

    const visibleItems = items.slice(startIndex, endIndex + 1).map((item, i) => ({
      item,
      index: startIndex + i,
      style: {
        position: "absolute" as const,
        top: (startIndex + i) * itemHeight,
        left: 0,
        right: 0,
        height: itemHeight,
      },
    }));

    return {
      totalHeight,
      startIndex,
      endIndex,
      visibleItems,
    };
  }, [items, itemHeight, containerHeightPx, scrollTop, overscan]);

  // 빈 상태 또는 로딩 상태
  if (loading) {
    return (
      <div
        className={cn("flex items-center justify-center", className)}
        style={{ height: containerHeight }}
      >
        {loadingState || <div className="text-muted-foreground">로딩 중...</div>}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        className={cn("flex items-center justify-center", className)}
        style={{ height: containerHeight }}
      >
        {emptyState || <div className="text-muted-foreground">데이터가 없습니다</div>}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn("overflow-auto relative", className)}
      style={{ height: containerHeight }}
      onScroll={handleScroll}
    >
      <div
        style={{
          height: virtualData.totalHeight,
          position: "relative",
        }}
      >
        {virtualData.visibleItems.map(({ item, index, style }) => (
          <div key={getItemKey(item, index)} style={style}>
            {renderItem(item, index, style)}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 무한 스크롤 훅
 * 
 * @example
 * ```tsx
 * const { loadMoreRef, isLoading } = useInfiniteScroll({
 *   hasMore: data?.hasNextPage,
 *   onLoadMore: () => fetchNextPage(),
 * });
 * 
 * return (
 *   <div>
 *     {items.map(item => <Item key={item.id} />)}
 *     <div ref={loadMoreRef}>
 *       {isLoading && <Spinner />}
 *     </div>
 *   </div>
 * );
 * ```
 */
export function useInfiniteScroll(options: {
  hasMore: boolean;
  onLoadMore: () => void;
  threshold?: number;
  rootMargin?: string;
}) {
  const { hasMore, onLoadMore, threshold = 0.1, rootMargin = "100px" } = options;
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const element = loadMoreRef.current;
    if (!element || !hasMore) return;

    const observer = new IntersectionObserver(
      async (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting && hasMore && !isLoading) {
          setIsLoading(true);
          try {
            await onLoadMore();
          } finally {
            setIsLoading(false);
          }
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, threshold, rootMargin, isLoading]);

  return { loadMoreRef, isLoading };
}

/**
 * 지연 로딩 이미지 컴포넌트
 * 
 * @example
 * ```tsx
 * <LazyImage
 *   src="/image.jpg"
 *   alt="Description"
 *   className="w-full h-48 object-cover"
 * />
 * ```
 */
interface LazyImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** 로딩 중 표시할 플레이스홀더 */
  placeholder?: React.ReactNode;
  /** 에러 시 표시할 콘텐츠 */
  fallback?: React.ReactNode;
}

export function LazyImage({
  src,
  alt,
  className,
  placeholder,
  fallback,
  ...props
}: LazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          // 실제 src 설정
          img.src = src || "";
          observer.disconnect();
        }
      },
      { rootMargin: "100px" }
    );

    observer.observe(img);
    return () => observer.disconnect();
  }, [src]);

  if (hasError && fallback) {
    return <>{fallback}</>;
  }

  return (
    <div className={cn("relative", className)}>
      {!isLoaded && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted animate-pulse">
          {placeholder || <div className="w-8 h-8 rounded-full bg-muted-foreground/20" />}
        </div>
      )}
      <img
        ref={imgRef}
        alt={alt}
        className={cn(
          "transition-opacity duration-300",
          isLoaded ? "opacity-100" : "opacity-0",
          className
        )}
        onLoad={() => setIsLoaded(true)}
        onError={() => setHasError(true)}
        {...props}
      />
    </div>
  );
}

/**
 * 디바운스 훅
 * 
 * @example
 * ```tsx
 * const debouncedSearch = useDebouncedCallback((query: string) => {
 *   search(query);
 * }, 300);
 * ```
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const debouncedCallback = useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callback(...args);
      }, delay);
    },
    [callback, delay]
  ) as T;

  // 클린업
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debouncedCallback;
}

/**
 * 쓰로틀 훅
 * 
 * @example
 * ```tsx
 * const throttledScroll = useThrottledCallback((event) => {
 *   handleScroll(event);
 * }, 100);
 * ```
 */
export function useThrottledCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const lastCall = useRef(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const throttledCallback = useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();
      const timeSinceLastCall = now - lastCall.current;

      if (timeSinceLastCall >= delay) {
        lastCall.current = now;
        callback(...args);
      } else {
        // 마지막 호출 예약
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
          lastCall.current = Date.now();
          callback(...args);
        }, delay - timeSinceLastCall);
      }
    },
    [callback, delay]
  ) as T;

  // 클린업
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return throttledCallback;
}

export default VirtualList;
