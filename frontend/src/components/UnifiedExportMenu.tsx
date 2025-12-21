/**
 * UnifiedExportMenu - 통합 내보내기 메뉴
 * 
 * PDF 보고서, AI 분석 내보내기, 데이터 내보내기를 하나의 드롭다운으로 통합
 */

import { useState, useCallback } from 'react';
import {
  Download,
  FileText,
  FileJson,
  FileSpreadsheet,
  FileCode,
  FileType2,
  Copy,
  Check,
  ChevronDown,
  Loader2,
  Settings2,
  Clock,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  exportUnifiedSearchReport,
  exportDeepSearchReport,
  requestUnifiedSearchReport,
  getReportStatus,
  downloadReport,
  triggerPdfDownload,
  type ReportRequest,
  type ReportSection,
  type ReportType,
  type ReportMetadata,
  DEFAULT_REPORT_SECTIONS,
} from '@/lib/api';
import { useExport, type ExportFormat, type ExportableSearchResult, type ExportOptions } from '@/hooks/useExport';
import type { ChartExportHandle } from '@/components/charts';

// ============================================
// Types
// ============================================

interface UnifiedExportMenuProps {
  /** Job ID for PDF report generation */
  jobId?: string;
  /** Search query */
  query: string;
  /** Report type */
  reportType?: ReportType;
  /** Time window */
  timeWindow?: string;
  /** AI analysis content (markdown) for analysis export */
  aiContent?: string;
  /** Structured data for JSON/CSV export */
  data?: ExportableSearchResult[];
  /** Chart refs for capturing chart images */
  chartRefs?: Record<string, React.RefObject<ChartExportHandle>>;
  /** Export options */
  exportOptions?: ExportOptions;
  /** Button variant */
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  /** Button size */
  size?: 'default' | 'sm' | 'lg' | 'icon';
  /** Additional CSS classes */
  className?: string;
  /** Disable the button */
  disabled?: boolean;
  /** Show icon only */
  iconOnly?: boolean;
}

interface SectionOption {
  id: ReportSection;
  label: string;
  description: string;
}

// ============================================
// Constants
// ============================================

const ALL_SECTIONS: SectionOption[] = [
  { id: 'COVER', label: '표지', description: '보고서 표지 및 기본 정보' },
  { id: 'EXECUTIVE_SUMMARY', label: '요약', description: 'AI 분석 요약 및 핵심 인사이트' },
  { id: 'DATA_SOURCE', label: '데이터 소스', description: '검색 소스별 결과 분포' },
  { id: 'TREND_ANALYSIS', label: '트렌드 분석', description: '시간대별 기사 추이' },
  { id: 'KEYWORD_ANALYSIS', label: '키워드 분석', description: '주요 키워드 및 빈도' },
  { id: 'SENTIMENT_ANALYSIS', label: '감정 분석', description: '긍정/부정/중립 분포' },
  { id: 'RELIABILITY', label: '신뢰도 분석', description: '출처별 신뢰도 평가' },
  { id: 'BIAS_ANALYSIS', label: '편향성 분석', description: '정치적/이념적 편향 분석' },
  { id: 'FACTCHECK', label: '팩트체크', description: '주요 주장 검증 결과' },
  { id: 'EVIDENCE_LIST', label: '증거 목록', description: '수집된 증거 및 출처' },
  { id: 'DETAILED_RESULTS', label: '상세 결과', description: '개별 기사 상세 정보' },
];

// ============================================
// Utility Functions
// ============================================

/**
 * Generate HTML report from markdown content
 */
const generateHtmlReport = (content: string, query: string): string => {
  const timestamp = new Date().toLocaleString('ko-KR');
  
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NewsInsight AI 분석 - ${query}</title>
  <style>
    :root {
      --primary: #7c3aed;
      --primary-light: #a78bfa;
      --bg: #ffffff;
      --text: #1f2937;
      --text-muted: #6b7280;
      --border: #e5e7eb;
    }
    
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #111827;
        --text: #f9fafb;
        --text-muted: #9ca3af;
        --border: #374151;
      }
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans KR', sans-serif;
      line-height: 1.7;
      color: var(--text);
      background: var(--bg);
      max-width: 900px;
      margin: 0 auto;
      padding: 2rem;
    }
    
    header {
      text-align: center;
      padding-bottom: 2rem;
      margin-bottom: 2rem;
      border-bottom: 2px solid var(--primary);
    }
    
    header h1 {
      color: var(--primary);
      font-size: 1.5rem;
      margin-bottom: 0.5rem;
    }
    
    header .query {
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
    
    header .meta {
      color: var(--text-muted);
      font-size: 0.875rem;
    }
    
    h2, h3 {
      margin: 1.5rem 0 1rem;
      border-left: 4px solid var(--primary);
      padding-left: 1rem;
    }
    
    h2 { font-size: 1.25rem; }
    h3 { font-size: 1rem; }
    
    p { margin: 0.75rem 0; }
    
    ul, ol { padding-left: 1.5rem; margin: 0.75rem 0; }
    li { margin: 0.5rem 0; }
    
    strong { font-weight: 600; }
    
    a { color: var(--primary); text-decoration: none; }
    a:hover { text-decoration: underline; }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1rem 0;
      font-size: 0.9rem;
    }
    
    th, td {
      padding: 0.75rem 1rem;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    
    th { background: var(--border); font-weight: 600; }
    
    blockquote {
      margin: 1rem 0;
      padding: 0.75rem 1rem;
      border-left: 4px solid var(--primary-light);
      background: rgba(124, 58, 237, 0.05);
      font-style: italic;
    }
    
    code {
      background: var(--border);
      padding: 0.125rem 0.375rem;
      border-radius: 0.25rem;
      font-size: 0.875em;
    }
    
    hr {
      border: none;
      border-top: 2px dashed var(--border);
      margin: 2rem 0;
    }
    
    footer {
      margin-top: 3rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--border);
      text-align: center;
      color: var(--text-muted);
      font-size: 0.875rem;
    }
    
    @media print {
      body { padding: 1rem; }
      h2 { break-after: avoid; }
      table { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <header>
    <h1>NewsInsight AI 분석 보고서</h1>
    <div class="query">"${query}"</div>
    <div class="meta">생성 시간: ${timestamp}</div>
  </header>
  
  <main>
    ${markdownToHtml(content)}
  </main>
  
  <footer>
    <p>이 보고서는 NewsInsight AI에 의해 자동 생성되었습니다.</p>
    <p>모든 정보는 참고용이며, 최종 판단은 사용자의 몫입니다.</p>
  </footer>
</body>
</html>`;
};

/**
 * Simple markdown to HTML conversion
 */
const markdownToHtml = (md: string): string => {
  return md
    .replace(/^### \[([^\]]+)\] (.+)$/gm, '<h3>$1: $2</h3>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## \[([^\]]+)\] (.+)$/gm, '<h2>$1: $2</h2>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/gs, '<ul>$&</ul>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^---$/gm, '<hr>')
    .replace(/^(?!<[a-z])(.*[^\n])$/gm, '<p>$1</p>')
    .replace(/<p>\s*<\/p>/g, '');
};

/**
 * Download file utility
 */
const downloadFile = (content: string, filename: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// ============================================
// Component
// ============================================

/**
 * Unified Export Menu Component
 * 
 * Combines PDF report, AI analysis export, and data export into a single dropdown.
 */
export function UnifiedExportMenu({
  jobId,
  query,
  reportType = 'UNIFIED_SEARCH',
  timeWindow = '7d',
  aiContent,
  data,
  chartRefs,
  exportOptions = {},
  variant = 'outline',
  size = 'default',
  className,
  disabled = false,
  iconOnly = false,
}: UnifiedExportMenuProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [selectedSections, setSelectedSections] = useState<ReportSection[]>(
    DEFAULT_REPORT_SECTIONS[reportType]
  );
  
  // Async export state
  const [asyncExportMode, setAsyncExportMode] = useState(false);
  const [asyncReportStatus, setAsyncReportStatus] = useState<ReportMetadata | null>(null);
  const [asyncProgressDialogOpen, setAsyncProgressDialogOpen] = useState(false);
  
  const { exportData, copyToClipboard } = useExport();
  
  // Generate base filename
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const safeQuery = query.replace(/[^가-힣a-zA-Z0-9]/g, '_').slice(0, 30);
  const typeLabel = reportType === 'DEEP_SEARCH' ? 'DeepSearch' : '통합검색';
  const baseFilename = `NewsInsight_${typeLabel}_${safeQuery}_${timestamp}`;

  // Capture chart images for PDF
  const captureChartImages = useCallback((): Record<string, string> => {
    const images: Record<string, string> = {};
    if (chartRefs) {
      for (const [key, ref] of Object.entries(chartRefs)) {
        if (ref.current) {
          const base64 = ref.current.toBase64();
          if (base64) {
            images[key] = base64;
          }
        }
      }
    }
    return images;
  }, [chartRefs]);

  // PDF Export with dialog
  const handlePdfExport = async () => {
    if (!jobId) {
      toast.error('PDF 내보내기는 검색 작업 ID가 필요합니다.');
      return;
    }
    
    setIsExporting(true);
    try {
      const chartImages = captureChartImages();
      
      const request: ReportRequest = {
        reportType,
        targetId: jobId,
        query,
        timeWindow,
        includeSections: selectedSections,
        chartImages,
        language: 'ko',
      };

      let blob: Blob;
      if (reportType === 'DEEP_SEARCH') {
        blob = await exportDeepSearchReport(jobId, request);
      } else {
        blob = await exportUnifiedSearchReport(jobId, request);
      }

      triggerPdfDownload(blob, `${baseFilename}.pdf`);
      toast.success('PDF 보고서가 다운로드되었습니다.');
      setPdfDialogOpen(false);
    } catch (error) {
      console.error('PDF export failed:', error);
      toast.error('PDF 보고서 생성에 실패했습니다.');
    } finally {
      setIsExporting(false);
    }
  };

  // Async PDF Export with polling (for large reports)
  const handleAsyncPdfExport = async () => {
    if (!jobId) {
      toast.error('PDF 내보내기는 검색 작업 ID가 필요합니다.');
      return;
    }
    
    setIsExporting(true);
    setAsyncProgressDialogOpen(true);
    setPdfDialogOpen(false);
    
    try {
      const chartImages = captureChartImages();
      
      const request: ReportRequest = {
        reportType,
        targetId: jobId,
        query,
        timeWindow,
        includeSections: selectedSections,
        chartImages,
        language: 'ko',
      };

      // Request async report generation
      const initialStatus = await requestUnifiedSearchReport(jobId, request);
      setAsyncReportStatus(initialStatus);
      
      if (initialStatus.status === 'COMPLETED' && initialStatus.reportId) {
        // Report was cached or generated immediately
        const blob = await downloadReport(initialStatus.reportId);
        triggerPdfDownload(blob, `${baseFilename}.pdf`);
        toast.success('PDF 보고서가 다운로드되었습니다.');
        setAsyncProgressDialogOpen(false);
        setAsyncReportStatus(null);
        return;
      }
      
      // Poll for completion
      const reportId = initialStatus.reportId;
      const maxWaitMs = 120000; // 2 minutes
      const pollIntervalMs = 2000; // 2 seconds
      const startTime = Date.now();
      
      while (Date.now() - startTime < maxWaitMs) {
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        
        const status = await getReportStatus(reportId);
        setAsyncReportStatus(status);
        
        if (status.status === 'COMPLETED') {
          const blob = await downloadReport(reportId);
          triggerPdfDownload(blob, `${baseFilename}.pdf`);
          toast.success('PDF 보고서가 다운로드되었습니다.');
          setAsyncProgressDialogOpen(false);
          setAsyncReportStatus(null);
          return;
        }
        
        if (status.status === 'FAILED' || status.status === 'EXPIRED') {
          throw new Error(status.errorMessage || '보고서 생성에 실패했습니다.');
        }
      }
      
      throw new Error('보고서 생성 시간이 초과되었습니다.');
    } catch (error) {
      console.error('Async PDF export failed:', error);
      toast.error(error instanceof Error ? error.message : 'PDF 보고서 생성에 실패했습니다.');
      setAsyncReportStatus(null);
    } finally {
      setIsExporting(false);
    }
  };

  // Cancel/close async progress dialog
  const handleCancelAsyncExport = () => {
    setAsyncProgressDialogOpen(false);
    setAsyncReportStatus(null);
    setIsExporting(false);
  };

  // AI Content exports
  const handleMarkdownExport = useCallback(() => {
    if (!aiContent) {
      toast.error('내보낼 AI 분석 내용이 없습니다.');
      return;
    }
    
    const mdContent = `# NewsInsight AI 분석 보고서

**검색어**: ${query}  
**생성 시간**: ${new Date().toLocaleString('ko-KR')}

---

${aiContent}

---

*이 보고서는 NewsInsight AI에 의해 자동 생성되었습니다.*
`;
    downloadFile(mdContent, `${baseFilename}_AI분석.md`, 'text/markdown;charset=utf-8');
    toast.success('Markdown 파일이 다운로드되었습니다.');
  }, [aiContent, query, baseFilename]);

  const handleHtmlExport = useCallback(() => {
    if (!aiContent) {
      toast.error('내보낼 AI 분석 내용이 없습니다.');
      return;
    }
    
    const htmlContent = generateHtmlReport(aiContent, query);
    downloadFile(htmlContent, `${baseFilename}_AI분석.html`, 'text/html;charset=utf-8');
    toast.success('HTML 파일이 다운로드되었습니다.');
  }, [aiContent, query, baseFilename]);

  const handleTextExport = useCallback(() => {
    if (!aiContent) {
      toast.error('내보낼 AI 분석 내용이 없습니다.');
      return;
    }
    
    const plainText = aiContent
      .replace(/#{1,6}\s/g, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\|/g, ' | ');
    
    const textContent = `NewsInsight AI 분석 보고서
========================================

검색어: ${query}
생성 시간: ${new Date().toLocaleString('ko-KR')}

========================================

${plainText}

========================================

이 보고서는 NewsInsight AI에 의해 자동 생성되었습니다.
`;
    downloadFile(textContent, `${baseFilename}_AI분석.txt`, 'text/plain;charset=utf-8');
    toast.success('텍스트 파일이 다운로드되었습니다.');
  }, [aiContent, query, baseFilename]);

  // Data exports (JSON/CSV)
  const handleDataExport = (format: ExportFormat) => {
    if (!data || data.length === 0) {
      toast.error('내보낼 데이터가 없습니다.');
      return;
    }
    exportData(data, format, { ...exportOptions, filename: baseFilename });
  };

  // Clipboard
  const handleCopy = async (type: 'ai' | 'data') => {
    try {
      if (type === 'ai' && aiContent) {
        await navigator.clipboard.writeText(aiContent);
      } else if (type === 'data' && data) {
        await copyToClipboard(data, 'json');
      } else {
        toast.error('복사할 내용이 없습니다.');
        return;
      }
      setCopied(true);
      toast.success('클립보드에 복사되었습니다.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('복사에 실패했습니다.');
    }
  };

  // Section selection for PDF
  const toggleSection = (sectionId: ReportSection) => {
    setSelectedSections((prev) =>
      prev.includes(sectionId)
        ? prev.filter((s) => s !== sectionId)
        : [...prev, sectionId]
    );
  };

  const selectAllSections = () => {
    setSelectedSections(ALL_SECTIONS.map((s) => s.id));
  };

  const selectDefaultSections = () => {
    setSelectedSections(DEFAULT_REPORT_SECTIONS[reportType]);
  };

  const availableSections = ALL_SECTIONS.filter((section) => {
    if (reportType === 'UNIFIED_SEARCH') {
      return section.id !== 'EVIDENCE_LIST';
    }
    if (reportType === 'DEEP_SEARCH') {
      return section.id !== 'TREND_ANALYSIS' && section.id !== 'KEYWORD_ANALYSIS';
    }
    return true;
  });

  const hasAnyContent = jobId || aiContent || (data && data.length > 0);
  const isDisabled = disabled || !hasAnyContent;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={size}
            disabled={isDisabled || isExporting}
            className={className}
            aria-label="내보내기"
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {!iconOnly && (
              <>
                <span className="ml-2">내보내기</span>
                <ChevronDown className="ml-1 h-3 w-3" />
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {/* PDF Report Section */}
          {jobId && (
            <>
              <DropdownMenuLabel className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-red-600" />
                PDF 보고서
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setPdfDialogOpen(true)}>
                <Settings2 className="h-4 w-4 mr-2" />
                PDF 보고서 생성...
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          {/* AI Analysis Export Section */}
          {aiContent && (
            <>
              <DropdownMenuLabel className="flex items-center gap-2">
                <FileCode className="h-4 w-4 text-purple-600" />
                AI 분석 내보내기
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={handleMarkdownExport}>
                <FileCode className="h-4 w-4 mr-2 text-blue-600" />
                Markdown (.md)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleHtmlExport}>
                <FileType2 className="h-4 w-4 mr-2 text-orange-600" />
                HTML 웹페이지
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleTextExport}>
                <FileText className="h-4 w-4 mr-2 text-gray-600" />
                텍스트 (.txt)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleCopy('ai')}>
                {copied ? (
                  <Check className="h-4 w-4 mr-2 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4 mr-2" />
                )}
                AI 분석 복사
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          {/* Data Export Section */}
          {data && data.length > 0 && (
            <>
              <DropdownMenuLabel className="flex items-center gap-2">
                <FileJson className="h-4 w-4 text-yellow-600" />
                데이터 내보내기
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => handleDataExport('json')}>
                <FileJson className="h-4 w-4 mr-2 text-yellow-600" />
                JSON으로 내보내기
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDataExport('csv')}>
                <FileSpreadsheet className="h-4 w-4 mr-2 text-green-600" />
                CSV로 내보내기
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDataExport('markdown')}>
                <FileCode className="h-4 w-4 mr-2 text-blue-600" />
                Markdown 테이블
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleCopy('data')}>
                {copied ? (
                  <Check className="h-4 w-4 mr-2 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4 mr-2" />
                )}
                데이터 복사 (JSON)
              </DropdownMenuItem>
            </>
          )}

          {/* Fallback if nothing is available */}
          {!hasAnyContent && (
            <DropdownMenuItem disabled>
              내보낼 내용이 없습니다
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* PDF Section Selection Dialog */}
      <Dialog open={pdfDialogOpen} onOpenChange={setPdfDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>PDF 보고서 내보내기</DialogTitle>
            <DialogDescription>
              보고서에 포함할 섹션을 선택하세요.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {/* Quick actions */}
            <div className="flex gap-2 mb-4">
              <Button variant="outline" size="sm" onClick={selectAllSections}>
                전체 선택
              </Button>
              <Button variant="outline" size="sm" onClick={selectDefaultSections}>
                기본값
              </Button>
            </div>

            {/* Section selection */}
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
              {availableSections.map((section) => (
                <div
                  key={section.id}
                  className="flex items-start space-x-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <Checkbox
                    id={section.id}
                    checked={selectedSections.includes(section.id)}
                    onCheckedChange={() => toggleSection(section.id)}
                  />
                  <div className="flex-1">
                    <Label
                      htmlFor={section.id}
                      className="text-sm font-medium cursor-pointer"
                    >
                      {section.label}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {section.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Summary */}
            <div className="mt-4 pt-4 border-t text-sm text-muted-foreground">
              {selectedSections.length}개 섹션 선택됨
            </div>

            {/* Async mode toggle */}
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-start space-x-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                <Checkbox
                  id="async-mode"
                  checked={asyncExportMode}
                  onCheckedChange={(checked) => setAsyncExportMode(!!checked)}
                />
                <div className="flex-1">
                  <Label htmlFor="async-mode" className="text-sm font-medium cursor-pointer flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    백그라운드 생성
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    대용량 보고서의 경우 백그라운드에서 생성하고 완료 시 다운로드합니다.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPdfDialogOpen(false)}>
              취소
            </Button>
            <Button
              onClick={asyncExportMode ? handleAsyncPdfExport : handlePdfExport}
              disabled={isExporting || selectedSections.length === 0}
            >
              {isExporting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  생성 중...
                </>
              ) : asyncExportMode ? (
                <>
                  <Clock className="h-4 w-4 mr-2" />
                  백그라운드 생성
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4 mr-2" />
                  내보내기
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Async Export Progress Dialog */}
      <Dialog open={asyncProgressDialogOpen} onOpenChange={(open) => !open && handleCancelAsyncExport()}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {asyncReportStatus?.status === 'COMPLETED' ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : asyncReportStatus?.status === 'FAILED' ? (
                <XCircle className="h-5 w-5 text-red-500" />
              ) : (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              )}
              PDF 보고서 생성 중
            </DialogTitle>
            <DialogDescription>
              보고서를 생성하고 있습니다. 완료되면 자동으로 다운로드됩니다.
            </DialogDescription>
          </DialogHeader>

          <div className="py-6">
            {/* Status display */}
            <div className="flex flex-col items-center gap-4">
              {asyncReportStatus?.status === 'GENERATING' && (
                <>
                  <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                    <div 
                      className="h-full bg-primary rounded-full animate-pulse"
                      style={{ width: '60%' }}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">보고서 생성 중...</p>
                </>
              )}
              
              {asyncReportStatus?.status === 'PENDING' && (
                <>
                  <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                    <div 
                      className="h-full bg-primary/50 rounded-full animate-pulse"
                      style={{ width: '30%' }}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">대기 중...</p>
                </>
              )}
              
              {asyncReportStatus?.status === 'COMPLETED' && (
                <p className="text-sm text-green-600">생성 완료! 다운로드 중...</p>
              )}
              
              {asyncReportStatus?.status === 'FAILED' && (
                <p className="text-sm text-red-600">
                  {asyncReportStatus.errorMessage || '보고서 생성에 실패했습니다.'}
                </p>
              )}
              
              {!asyncReportStatus && (
                <>
                  <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                    <div 
                      className="h-full bg-primary/30 rounded-full animate-pulse"
                      style={{ width: '10%' }}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">요청 중...</p>
                </>
              )}
            </div>

            {/* Report info */}
            {asyncReportStatus && (
              <div className="mt-4 pt-4 border-t text-xs text-muted-foreground space-y-1">
                <p>보고서 ID: {asyncReportStatus.reportId}</p>
                {asyncReportStatus.pageCount && (
                  <p>페이지 수: {asyncReportStatus.pageCount}</p>
                )}
                {asyncReportStatus.generationTimeMs && (
                  <p>생성 시간: {(asyncReportStatus.generationTimeMs / 1000).toFixed(1)}초</p>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCancelAsyncExport}>
              {asyncReportStatus?.status === 'FAILED' ? '닫기' : '취소'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default UnifiedExportMenu;
