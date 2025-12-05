import { useState } from "react";
import {
  Download,
  FileJson,
  FileText,
  FileSpreadsheet,
  Copy,
  Check,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useExport, type ExportFormat, type ExportableSearchResult, type ExportOptions } from "@/hooks/useExport";

interface ExportButtonProps {
  /** 내보낼 데이터 */
  data: ExportableSearchResult[];
  /** 내보내기 옵션 */
  options?: ExportOptions;
  /** 버튼 비활성화 */
  disabled?: boolean;
  /** 버튼 크기 */
  size?: "default" | "sm" | "lg" | "icon";
  /** 버튼 변형 */
  variant?: "default" | "outline" | "ghost" | "secondary";
  /** 아이콘만 표시 */
  iconOnly?: boolean;
  /** 추가 CSS 클래스 */
  className?: string;
}

/**
 * 검색 결과 내보내기 버튼 컴포넌트
 * 
 * @example
 * ```tsx
 * <ExportButton
 *   data={searchResults}
 *   options={{ filename: "search-results", title: "검색 결과" }}
 * />
 * ```
 */
export function ExportButton({
  data,
  options = {},
  disabled = false,
  size = "default",
  variant = "outline",
  iconOnly = false,
  className = "",
}: ExportButtonProps) {
  const { exportData, copyToClipboard } = useExport();
  const [copied, setCopied] = useState(false);

  const handleExport = (format: ExportFormat) => {
    exportData(data, format, options);
  };

  const handleCopy = async () => {
    const success = await copyToClipboard(data, "json");
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isDisabled = disabled || !data || data.length === 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size={size}
          disabled={isDisabled}
          className={className}
          aria-label="내보내기"
        >
          <Download className="h-4 w-4" />
          {!iconOnly && (
            <>
              <span className="ml-2">내보내기</span>
              <ChevronDown className="ml-1 h-3 w-3" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => handleExport("json")} className="gap-2">
          <FileJson className="h-4 w-4 text-yellow-600" />
          <span>JSON으로 내보내기</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("csv")} className="gap-2">
          <FileSpreadsheet className="h-4 w-4 text-green-600" />
          <span>CSV로 내보내기</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("markdown")} className="gap-2">
          <FileText className="h-4 w-4 text-blue-600" />
          <span>Markdown으로 내보내기</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("txt")} className="gap-2">
          <FileText className="h-4 w-4 text-gray-600" />
          <span>텍스트로 내보내기</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleCopy} className="gap-2">
          {copied ? (
            <>
              <Check className="h-4 w-4 text-green-600" />
              <span className="text-green-600">복사됨!</span>
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              <span>클립보드에 복사</span>
            </>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ExportButton;
