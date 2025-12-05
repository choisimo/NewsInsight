import { useCallback } from "react";
import { useToast } from "@/hooks/use-toast";

/**
 * 내보내기 포맷
 */
export type ExportFormat = "json" | "csv" | "markdown" | "txt";

/**
 * 검색 결과 데이터 형식
 */
export interface ExportableSearchResult {
  id?: string;
  title?: string;
  snippet?: string;
  url?: string;
  source?: string;
  publishedAt?: string;
  stance?: string;
  reliabilityScore?: number;
  sentimentLabel?: string;
  [key: string]: unknown;
}

/**
 * 내보내기 옵션
 */
export interface ExportOptions {
  /** 파일 이름 (확장자 제외) */
  filename?: string;
  /** 제목/헤더 */
  title?: string;
  /** 추가 메타데이터 */
  metadata?: Record<string, unknown>;
  /** CSV 구분자 */
  csvDelimiter?: string;
  /** BOM 추가 (한글 엑셀 호환) */
  addBom?: boolean;
}

/**
 * JSON 내보내기
 */
const exportToJson = (
  data: unknown,
  options: ExportOptions = {}
): string => {
  const { title, metadata } = options;
  
  const exportData = {
    ...(title && { title }),
    exportedAt: new Date().toISOString(),
    ...metadata,
    data,
  };
  
  return JSON.stringify(exportData, null, 2);
};

/**
 * CSV 내보내기
 */
const exportToCsv = (
  data: ExportableSearchResult[],
  options: ExportOptions = {}
): string => {
  const { csvDelimiter = ",", addBom = true } = options;
  
  if (data.length === 0) return "";
  
  // 헤더 추출 (모든 객체의 키 합집합)
  const headers = new Set<string>();
  data.forEach((item) => {
    Object.keys(item).forEach((key) => headers.add(key));
  });
  const headerArray = Array.from(headers);
  
  // CSV 값 이스케이프
  const escapeValue = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    const str = String(value);
    if (str.includes(csvDelimiter) || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  
  // 헤더 행
  const headerRow = headerArray.map(escapeValue).join(csvDelimiter);
  
  // 데이터 행
  const dataRows = data.map((item) =>
    headerArray.map((header) => escapeValue(item[header])).join(csvDelimiter)
  );
  
  const csvContent = [headerRow, ...dataRows].join("\n");
  
  // BOM 추가 (한글 엑셀 호환)
  return addBom ? "\uFEFF" + csvContent : csvContent;
};

/**
 * Markdown 내보내기
 */
const exportToMarkdown = (
  data: ExportableSearchResult[],
  options: ExportOptions = {}
): string => {
  const { title, metadata } = options;
  
  let md = "";
  
  // 제목
  if (title) {
    md += `# ${title}\n\n`;
  }
  
  // 메타데이터
  if (metadata) {
    md += `> 내보내기: ${new Date().toLocaleString("ko-KR")}\n`;
    Object.entries(metadata).forEach(([key, value]) => {
      md += `> ${key}: ${value}\n`;
    });
    md += "\n";
  }
  
  // 결과 수
  md += `총 ${data.length}개의 결과\n\n---\n\n`;
  
  // 데이터
  data.forEach((item, index) => {
    md += `## ${index + 1}. ${item.title || "제목 없음"}\n\n`;
    
    if (item.source) md += `**출처:** ${item.source}\n\n`;
    if (item.publishedAt) md += `**날짜:** ${new Date(item.publishedAt).toLocaleDateString("ko-KR")}\n\n`;
    if (item.stance) md += `**입장:** ${item.stance}\n\n`;
    if (item.reliabilityScore !== undefined) md += `**신뢰도:** ${item.reliabilityScore}%\n\n`;
    if (item.sentimentLabel) md += `**감성:** ${item.sentimentLabel}\n\n`;
    
    if (item.snippet) {
      md += `### 내용\n\n${item.snippet}\n\n`;
    }
    
    if (item.url) {
      md += `[원문 보기](${item.url})\n\n`;
    }
    
    md += "---\n\n";
  });
  
  return md;
};

/**
 * 텍스트 내보내기
 */
const exportToText = (
  data: ExportableSearchResult[],
  options: ExportOptions = {}
): string => {
  const { title, metadata } = options;
  
  let txt = "";
  
  if (title) {
    txt += `${title}\n${"=".repeat(title.length)}\n\n`;
  }
  
  if (metadata) {
    txt += `내보내기: ${new Date().toLocaleString("ko-KR")}\n`;
    Object.entries(metadata).forEach(([key, value]) => {
      txt += `${key}: ${value}\n`;
    });
    txt += "\n" + "-".repeat(40) + "\n\n";
  }
  
  data.forEach((item, index) => {
    txt += `[${index + 1}] ${item.title || "제목 없음"}\n`;
    if (item.source) txt += `출처: ${item.source}\n`;
    if (item.publishedAt) txt += `날짜: ${new Date(item.publishedAt).toLocaleDateString("ko-KR")}\n`;
    if (item.snippet) txt += `\n${item.snippet}\n`;
    if (item.url) txt += `\nURL: ${item.url}\n`;
    txt += "\n" + "-".repeat(40) + "\n\n";
  });
  
  return txt;
};

/**
 * 파일 다운로드 트리거
 */
const downloadFile = (content: string, filename: string, mimeType: string): void => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
};

/**
 * MIME 타입 매핑
 */
const MIME_TYPES: Record<ExportFormat, string> = {
  json: "application/json;charset=utf-8",
  csv: "text/csv;charset=utf-8",
  markdown: "text/markdown;charset=utf-8",
  txt: "text/plain;charset=utf-8",
};

/**
 * 파일 확장자 매핑
 */
const FILE_EXTENSIONS: Record<ExportFormat, string> = {
  json: ".json",
  csv: ".csv",
  markdown: ".md",
  txt: ".txt",
};

/**
 * 내보내기 훅
 * 
 * @example
 * ```tsx
 * const { exportData, isExporting } = useExport();
 * 
 * // JSON 내보내기
 * exportData(results, "json", { filename: "search-results" });
 * 
 * // CSV 내보내기
 * exportData(results, "csv", { title: "검색 결과" });
 * ```
 */
export function useExport() {
  const { toast } = useToast();

  const exportData = useCallback(
    (
      data: ExportableSearchResult[],
      format: ExportFormat,
      options: ExportOptions = {}
    ): boolean => {
      try {
        if (!data || data.length === 0) {
          toast({
            title: "내보내기 실패",
            description: "내보낼 데이터가 없습니다.",
            variant: "destructive",
          });
          return false;
        }

        let content: string;
        
        switch (format) {
          case "json":
            content = exportToJson(data, options);
            break;
          case "csv":
            content = exportToCsv(data, options);
            break;
          case "markdown":
            content = exportToMarkdown(data, options);
            break;
          case "txt":
            content = exportToText(data, options);
            break;
          default:
            throw new Error(`지원하지 않는 형식: ${format}`);
        }

        const timestamp = new Date().toISOString().slice(0, 10);
        const filename = `${options.filename || "newsinsight-export"}-${timestamp}${FILE_EXTENSIONS[format]}`;
        
        downloadFile(content, filename, MIME_TYPES[format]);

        toast({
          title: "내보내기 완료",
          description: `${filename} 파일이 다운로드되었습니다.`,
        });

        return true;
      } catch (error) {
        console.error("Export error:", error);
        toast({
          title: "내보내기 실패",
          description: error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.",
          variant: "destructive",
        });
        return false;
      }
    },
    [toast]
  );

  /**
   * 클립보드에 복사
   */
  const copyToClipboard = useCallback(
    async (data: ExportableSearchResult[], format: ExportFormat = "json"): Promise<boolean> => {
      try {
        let content: string;
        
        switch (format) {
          case "json":
            content = exportToJson(data);
            break;
          case "csv":
            content = exportToCsv(data, { addBom: false });
            break;
          case "markdown":
            content = exportToMarkdown(data);
            break;
          case "txt":
            content = exportToText(data);
            break;
          default:
            content = JSON.stringify(data, null, 2);
        }

        await navigator.clipboard.writeText(content);

        toast({
          title: "복사 완료",
          description: "클립보드에 복사되었습니다.",
        });

        return true;
      } catch (error) {
        console.error("Copy error:", error);
        toast({
          title: "복사 실패",
          description: "클립보드에 복사할 수 없습니다.",
          variant: "destructive",
        });
        return false;
      }
    },
    [toast]
  );

  return {
    exportData,
    copyToClipboard,
  };
}

export default useExport;
