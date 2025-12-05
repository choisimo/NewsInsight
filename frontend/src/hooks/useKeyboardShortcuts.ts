import { useEffect, useCallback, useRef } from "react";

/**
 * 키보드 단축키 정의
 */
export interface KeyboardShortcut {
  /** 키 조합 (예: "ctrl+k", "escape", "ctrl+shift+s") */
  key: string;
  /** 실행할 콜백 */
  handler: (event: KeyboardEvent) => void;
  /** 설명 (도움말 표시용) */
  description?: string;
  /** input/textarea에서도 활성화할지 여부 */
  enableInInput?: boolean;
  /** 특정 조건에서만 활성화 */
  enabled?: boolean;
}

interface UseKeyboardShortcutsOptions {
  /** 전역 이벤트 리스너 사용 여부 */
  global?: boolean;
  /** 활성화 여부 */
  enabled?: boolean;
}

/**
 * 키 조합 파싱
 */
const parseKeyCombo = (combo: string): { key: string; ctrl: boolean; shift: boolean; alt: boolean; meta: boolean } => {
  const parts = combo.toLowerCase().split("+");
  return {
    key: parts.filter(p => !["ctrl", "shift", "alt", "meta", "cmd"].includes(p))[0] || "",
    ctrl: parts.includes("ctrl"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
    meta: parts.includes("meta") || parts.includes("cmd"),
  };
};

/**
 * 이벤트와 키 조합 매칭
 */
const matchesKeyCombo = (event: KeyboardEvent, combo: string): boolean => {
  const parsed = parseKeyCombo(combo);
  const key = event.key.toLowerCase();
  
  // 특수 키 매핑
  const keyMap: Record<string, string> = {
    escape: "escape",
    esc: "escape",
    enter: "enter",
    return: "enter",
    space: " ",
    arrowup: "arrowup",
    arrowdown: "arrowdown",
    arrowleft: "arrowleft",
    arrowright: "arrowright",
  };
  
  const normalizedKey = keyMap[parsed.key] || parsed.key;
  const normalizedEventKey = keyMap[key] || key;
  
  return (
    normalizedEventKey === normalizedKey &&
    event.ctrlKey === parsed.ctrl &&
    event.shiftKey === parsed.shift &&
    event.altKey === parsed.alt &&
    event.metaKey === parsed.meta
  );
};

/**
 * 키보드 단축키 훅
 * 
 * @example
 * ```tsx
 * useKeyboardShortcuts([
 *   { key: "ctrl+k", handler: () => setSearchOpen(true), description: "검색 열기" },
 *   { key: "escape", handler: () => setSearchOpen(false), description: "닫기" },
 * ]);
 * ```
 */
export function useKeyboardShortcuts(
  shortcuts: KeyboardShortcut[],
  options: UseKeyboardShortcutsOptions = {}
) {
  const { global = true, enabled = true } = options;
  const shortcutsRef = useRef(shortcuts);
  
  // 최신 shortcuts 참조 유지
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;

    // input/textarea에서 입력 중인지 확인
    const target = event.target as HTMLElement;
    const isInputFocused = 
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable;

    for (const shortcut of shortcutsRef.current) {
      // 단축키별 활성화 조건 확인
      if (shortcut.enabled === false) continue;
      
      // input에서 비활성화된 단축키 스킵
      if (isInputFocused && !shortcut.enableInInput) continue;

      if (matchesKeyCombo(event, shortcut.key)) {
        event.preventDefault();
        event.stopPropagation();
        shortcut.handler(event);
        return;
      }
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const target = global ? window : document;
    target.addEventListener("keydown", handleKeyDown as EventListener);
    
    return () => {
      target.removeEventListener("keydown", handleKeyDown as EventListener);
    };
  }, [global, enabled, handleKeyDown]);
}

/**
 * 전역 단축키 컨텍스트 (앱 전체에서 사용)
 */
export interface GlobalShortcuts {
  openSearch: () => void;
  closeAll: () => void;
  goToHome: () => void;
  goToDeepSearch: () => void;
  goToFactCheck: () => void;
  goToAgent: () => void;
  toggleTheme: () => void;
}

/**
 * 단축키 도움말 데이터
 */
export const SHORTCUT_HELP: Array<{ key: string; description: string; category: string }> = [
  // 네비게이션
  { key: "Ctrl+K", description: "검색 열기", category: "네비게이션" },
  { key: "Escape", description: "닫기 / 취소", category: "네비게이션" },
  { key: "Ctrl+H", description: "홈으로 이동", category: "네비게이션" },
  { key: "Ctrl+D", description: "Deep Search", category: "네비게이션" },
  { key: "Ctrl+F", description: "FactCheck", category: "네비게이션" },
  { key: "Ctrl+B", description: "Browser Agent", category: "네비게이션" },
  
  // 테마
  { key: "Ctrl+Shift+T", description: "테마 전환", category: "설정" },
  
  // 검색
  { key: "Enter", description: "검색 실행", category: "검색" },
  { key: "↑/↓", description: "제안 항목 이동", category: "검색" },
];

export default useKeyboardShortcuts;
