import { Moon, Sun, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  /** 버튼 변형 */
  variant?: "icon" | "dropdown" | "switch";
  /** 크기 */
  size?: "sm" | "default" | "lg";
  /** 추가 CSS 클래스 */
  className?: string;
}

/** 아이콘만 있는 간단한 토글 버튼 */
const IconToggle = ({ size = "default", className }: Pick<ThemeToggleProps, "size" | "className">) => {
  const { resolvedTheme, toggleTheme, theme } = useTheme();

  const iconSize = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-6 w-6" : "h-5 w-5";
  const buttonSize = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-12 w-12" : "h-10 w-10";

  const getTooltipText = () => {
    if (theme === "light") return "다크 모드로 전환";
    if (theme === "dark") return "시스템 설정 사용";
    return "라이트 모드로 전환";
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className={cn(buttonSize, "relative", className)}
          aria-label="테마 전환"
        >
          {theme === "system" ? (
            <Monitor className={cn(iconSize, "text-muted-foreground")} />
          ) : resolvedTheme === "dark" ? (
            <Moon className={cn(iconSize, "text-blue-400")} />
          ) : (
            <Sun className={cn(iconSize, "text-yellow-500")} />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{getTooltipText()}</p>
      </TooltipContent>
    </Tooltip>
  );
};

/** 드롭다운 메뉴 형태의 테마 선택 */
const DropdownToggle = ({ size = "default", className }: Pick<ThemeToggleProps, "size" | "className">) => {
  const { theme, setTheme, resolvedTheme } = useTheme();

  const iconSize = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-6 w-6" : "h-5 w-5";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={className}>
          {theme === "system" ? (
            <Monitor className={cn(iconSize, "text-muted-foreground")} />
          ) : resolvedTheme === "dark" ? (
            <Moon className={cn(iconSize, "text-blue-400")} />
          ) : (
            <Sun className={cn(iconSize, "text-yellow-500")} />
          )}
          <span className="sr-only">테마 선택</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => setTheme("light")}
          className={cn(theme === "light" && "bg-accent")}
        >
          <Sun className="h-4 w-4 mr-2 text-yellow-500" />
          라이트
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setTheme("dark")}
          className={cn(theme === "dark" && "bg-accent")}
        >
          <Moon className="h-4 w-4 mr-2 text-blue-400" />
          다크
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setTheme("system")}
          className={cn(theme === "system" && "bg-accent")}
        >
          <Monitor className="h-4 w-4 mr-2" />
          시스템
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** 스위치 형태의 토글 (라이트/다크만) */
const SwitchToggle = ({ className }: Pick<ThemeToggleProps, "className">) => {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const handleToggle = () => {
    setTheme(isDark ? "light" : "dark");
  };

  return (
    <button
      role="switch"
      aria-checked={isDark}
      onClick={handleToggle}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        isDark ? "bg-blue-600" : "bg-yellow-400",
        className
      )}
    >
      <span className="sr-only">다크 모드 {isDark ? "끄기" : "켜기"}</span>
      <span
        className={cn(
          "pointer-events-none inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white shadow-lg ring-0 transition-transform",
          isDark ? "translate-x-5" : "translate-x-0.5"
        )}
      >
        {isDark ? (
          <Moon className="h-3 w-3 text-blue-600" />
        ) : (
          <Sun className="h-3 w-3 text-yellow-500" />
        )}
      </span>
    </button>
  );
};

/** 메인 ThemeToggle 컴포넌트 */
export const ThemeToggle = ({ variant = "icon", size = "default", className }: ThemeToggleProps) => {
  switch (variant) {
    case "dropdown":
      return <DropdownToggle size={size} className={className} />;
    case "switch":
      return <SwitchToggle className={className} />;
    case "icon":
    default:
      return <IconToggle size={size} className={className} />;
  }
};

export default ThemeToggle;
