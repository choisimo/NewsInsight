import React, { useRef, useCallback, useEffect } from "react";

/**
 * 포커스 가능한 요소 셀렉터
 */
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

/**
 * 포커스 트랩 훅 - 모달/다이얼로그 내에서 포커스를 가둠
 * 
 * @example
 * ```tsx
 * const { containerRef, trapFocus, releaseFocus } = useFocusTrap();
 * 
 * <div ref={containerRef} onKeyDown={trapFocus}>
 *   <button>First</button>
 *   <button>Second</button>
 * </div>
 * ```
 */
export function useFocusTrap<T extends HTMLElement = HTMLElement>() {
  const containerRef = useRef<T>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // 포커스 가능한 요소들 가져오기
  const getFocusableElements = useCallback(() => {
    if (!containerRef.current) return [];
    return Array.from(
      containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    ).filter((el) => el.offsetParent !== null); // 보이는 요소만
  }, []);

  // 포커스 트랩 활성화
  const trapFocus = useCallback((event: React.KeyboardEvent | KeyboardEvent) => {
    if (event.key !== 'Tab') return;

    const focusableElements = getFocusableElements();
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement as HTMLElement;

    if (event.shiftKey) {
      // Shift + Tab: 역순 이동
      if (activeElement === firstElement || !focusableElements.includes(activeElement)) {
        event.preventDefault();
        lastElement.focus();
      }
    } else {
      // Tab: 정순 이동
      if (activeElement === lastElement || !focusableElements.includes(activeElement)) {
        event.preventDefault();
        firstElement.focus();
      }
    }
  }, [getFocusableElements]);

  // 포커스 트랩 시작 (이전 포커스 저장)
  const enableTrap = useCallback(() => {
    previousActiveElement.current = document.activeElement as HTMLElement;
    const focusableElements = getFocusableElements();
    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    }
  }, [getFocusableElements]);

  // 포커스 트랩 해제 (이전 포커스 복원)
  const releaseFocus = useCallback(() => {
    if (previousActiveElement.current) {
      previousActiveElement.current.focus();
      previousActiveElement.current = null;
    }
  }, []);

  return {
    containerRef,
    trapFocus,
    enableTrap,
    releaseFocus,
    getFocusableElements,
  };
}

/**
 * 스킵 링크 훅 - 키보드 사용자를 위한 콘텐츠 건너뛰기
 * 
 * @example
 * ```tsx
 * const { SkipLink } = useSkipLinks();
 * 
 * return (
 *   <>
 *     <SkipLink />
 *     <header>...</header>
 *     <main id="main-content">...</main>
 *   </>
 * );
 * ```
 */
export function useSkipLinks() {
  const SkipLink = useCallback(
    ({ targetId = 'main-content', text = '본문으로 건너뛰기' }: { targetId?: string; text?: string }) => (
      <a
        href={`#${targetId}`}
        className="sr-only focus:not-sr-only focus:absolute focus:z-[9999] focus:top-4 focus:left-4 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:shadow-lg"
      >
        {text}
      </a>
    ),
    []
  );

  return { SkipLink };
}

/**
 * 라이브 리전 훅 - 스크린 리더에 동적 콘텐츠 알림
 * 
 * @example
 * ```tsx
 * const { announce, LiveRegion } = useLiveRegion();
 * 
 * const handleSave = () => {
 *   // ... save logic
 *   announce('저장되었습니다', 'polite');
 * };
 * 
 * return (
 *   <>
 *     <LiveRegion />
 *     <button onClick={handleSave}>저장</button>
 *   </>
 * );
 * ```
 */
export function useLiveRegion() {
  const politeRef = useRef<HTMLDivElement>(null);
  const assertiveRef = useRef<HTMLDivElement>(null);

  const announce = useCallback((
    message: string,
    priority: 'polite' | 'assertive' = 'polite'
  ) => {
    const ref = priority === 'assertive' ? assertiveRef : politeRef;
    if (ref.current) {
      // 메시지 초기화 후 설정 (스크린 리더가 변경 감지)
      ref.current.textContent = '';
      requestAnimationFrame(() => {
        if (ref.current) {
          ref.current.textContent = message;
        }
      });
    }
  }, []);

  const LiveRegion = useCallback(() => (
    <>
      <div
        ref={politeRef}
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />
      <div
        ref={assertiveRef}
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      />
    </>
  ), []);

  return { announce, LiveRegion };
}

/**
 * 포커스 관리 훅 - 컴포넌트 마운트/언마운트 시 포커스 관리
 * 
 * @example
 * ```tsx
 * const buttonRef = useRef<HTMLButtonElement>(null);
 * useFocusOnMount(buttonRef);
 * 
 * return <button ref={buttonRef}>Focus me</button>;
 * ```
 */
export function useFocusOnMount<T extends HTMLElement>(
  ref: React.RefObject<T>,
  options: { enabled?: boolean; restoreOnUnmount?: boolean } = {}
) {
  const { enabled = true, restoreOnUnmount = true } = options;
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!enabled) return;

    previousActiveElement.current = document.activeElement as HTMLElement;

    // 마운트 시 포커스
    if (ref.current) {
      ref.current.focus();
    }

    return () => {
      // 언마운트 시 이전 포커스 복원
      if (restoreOnUnmount && previousActiveElement.current) {
        previousActiveElement.current.focus();
      }
    };
  }, [ref, enabled, restoreOnUnmount]);
}

/**
 * 키보드 네비게이션 훅 - 화살표 키로 요소 간 이동
 * 
 * @example
 * ```tsx
 * const { activeIndex, handleKeyDown, setActiveIndex } = useArrowNavigation({
 *   itemCount: items.length,
 *   orientation: 'vertical',
 * });
 * 
 * return (
 *   <ul onKeyDown={handleKeyDown}>
 *     {items.map((item, index) => (
 *       <li key={item.id} tabIndex={index === activeIndex ? 0 : -1}>
 *         {item.label}
 *       </li>
 *     ))}
 *   </ul>
 * );
 * ```
 */
export function useArrowNavigation(options: {
  itemCount: number;
  orientation?: 'horizontal' | 'vertical' | 'both';
  loop?: boolean;
  onSelect?: (index: number) => void;
}) {
  const { itemCount, orientation = 'vertical', loop = true, onSelect } = options;
  const activeIndexRef = useRef(0);

  const setActiveIndex = useCallback((index: number) => {
    activeIndexRef.current = index;
  }, []);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    const { key } = event;
    let newIndex = activeIndexRef.current;

    const isVertical = orientation === 'vertical' || orientation === 'both';
    const isHorizontal = orientation === 'horizontal' || orientation === 'both';

    if ((key === 'ArrowDown' && isVertical) || (key === 'ArrowRight' && isHorizontal)) {
      event.preventDefault();
      newIndex = loop
        ? (activeIndexRef.current + 1) % itemCount
        : Math.min(activeIndexRef.current + 1, itemCount - 1);
    } else if ((key === 'ArrowUp' && isVertical) || (key === 'ArrowLeft' && isHorizontal)) {
      event.preventDefault();
      newIndex = loop
        ? (activeIndexRef.current - 1 + itemCount) % itemCount
        : Math.max(activeIndexRef.current - 1, 0);
    } else if (key === 'Home') {
      event.preventDefault();
      newIndex = 0;
    } else if (key === 'End') {
      event.preventDefault();
      newIndex = itemCount - 1;
    } else if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      onSelect?.(activeIndexRef.current);
      return;
    }

    if (newIndex !== activeIndexRef.current) {
      activeIndexRef.current = newIndex;
      onSelect?.(newIndex);
    }
  }, [itemCount, orientation, loop, onSelect]);

  return {
    activeIndex: activeIndexRef.current,
    handleKeyDown,
    setActiveIndex,
  };
}

/**
 * 접근성 ID 생성 훅 - 고유한 ID 생성
 */
export function useAccessibleId(prefix: string = 'accessible') {
  const idRef = useRef<string | null>(null);
  
  if (!idRef.current) {
    idRef.current = `${prefix}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  return idRef.current;
}

export default {
  useFocusTrap,
  useSkipLinks,
  useLiveRegion,
  useFocusOnMount,
  useArrowNavigation,
  useAccessibleId,
};
