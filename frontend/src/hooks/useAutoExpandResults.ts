import { useState, useRef, useEffect, useCallback } from 'react';

interface UseAutoExpandResultsOptions<T> {
  /** Initial items to display */
  items: T[];
  /** Number of items to show initially */
  initialCount?: number;
  /** Number of items to load on each expansion */
  incrementCount?: number;
  /** Threshold for intersection observer (0-1) */
  threshold?: number;
  /** Root margin for intersection observer */
  rootMargin?: string;
  /** Whether auto-expand is enabled */
  enabled?: boolean;
}

interface UseAutoExpandResultsReturn<T> {
  /** Currently visible items */
  visibleItems: T[];
  /** Whether there are more items to show */
  hasMore: boolean;
  /** Manually load more items */
  loadMore: () => void;
  /** Reset to initial count */
  reset: () => void;
  /** Ref to attach to sentinel element */
  sentinelRef: React.RefObject<HTMLDivElement>;
  /** Total items count */
  totalCount: number;
  /** Currently visible count */
  visibleCount: number;
  /** Loading state (for animation) */
  isLoading: boolean;
  /** Expand all items */
  expandAll: () => void;
  /** Collapse to initial count */
  collapseAll: () => void;
}

/**
 * Hook for auto-expanding search results on scroll.
 * Uses IntersectionObserver to detect when the user scrolls near the bottom.
 */
export function useAutoExpandResults<T>(
  options: UseAutoExpandResultsOptions<T>
): UseAutoExpandResultsReturn<T> {
  const {
    items,
    initialCount = 10,
    incrementCount = 10,
    threshold = 0.1,
    rootMargin = '100px',
    enabled = true,
  } = options;

  const [visibleCount, setVisibleCount] = useState(initialCount);
  const [isLoading, setIsLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const totalCount = items.length;
  const hasMore = visibleCount < totalCount;
  const visibleItems = items.slice(0, visibleCount);

  // Load more items
  const loadMore = useCallback(() => {
    if (!hasMore || isLoading) return;
    
    setIsLoading(true);
    // Small delay for smooth animation
    requestAnimationFrame(() => {
      setVisibleCount(prev => Math.min(prev + incrementCount, totalCount));
      setIsLoading(false);
    });
  }, [hasMore, isLoading, incrementCount, totalCount]);

  // Reset to initial count
  const reset = useCallback(() => {
    setVisibleCount(initialCount);
  }, [initialCount]);

  // Expand all
  const expandAll = useCallback(() => {
    setVisibleCount(totalCount);
  }, [totalCount]);

  // Collapse all
  const collapseAll = useCallback(() => {
    setVisibleCount(initialCount);
  }, [initialCount]);

  // Setup IntersectionObserver
  useEffect(() => {
    if (!enabled) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    // Cleanup previous observer
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting && hasMore && !isLoading) {
          loadMore();
        }
      },
      {
        threshold,
        rootMargin,
      }
    );

    observerRef.current.observe(sentinel);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [enabled, hasMore, isLoading, loadMore, threshold, rootMargin]);

  // Reset visible count when items change significantly
  useEffect(() => {
    if (totalCount < visibleCount) {
      setVisibleCount(Math.min(initialCount, totalCount));
    }
  }, [totalCount, visibleCount, initialCount]);

  return {
    visibleItems,
    hasMore,
    loadMore,
    reset,
    sentinelRef,
    totalCount,
    visibleCount,
    isLoading,
    expandAll,
    collapseAll,
  };
}

/**
 * Hook for individual item auto-expansion on scroll into view.
 * Each item expands when it becomes visible.
 */
export function useAutoExpandOnView(options: {
  enabled?: boolean;
  threshold?: number;
  delay?: number;
} = {}) {
  const { enabled = true, threshold = 0.3, delay = 100 } = options;
  
  const [isExpanded, setIsExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hasTriggered = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting && !hasTriggered.current) {
          hasTriggered.current = true;
          if (delay > 0) {
            setTimeout(() => setIsExpanded(true), delay);
          } else {
            setIsExpanded(true);
          }
          observer.disconnect();
        }
      },
      { threshold }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [enabled, threshold, delay]);

  // Reset function
  const reset = useCallback(() => {
    setIsExpanded(false);
    hasTriggered.current = false;
  }, []);

  return { ref, isExpanded, reset };
}

export default useAutoExpandResults;
