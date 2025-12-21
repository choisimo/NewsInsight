/**
 * AnalysisExportMenu - AI 분석 결과 내보내기 메뉴
 * 
 * PDF, Markdown, HTML, 텍스트 형식으로 내보내기 지원
 */

import { useState, useCallback } from 'react';
import { 
  Download, 
  FileText, 
  FileCode, 
  FileType2, 
  Copy, 
  Check,
  Loader2,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import {
  exportUnifiedSearchReport,
  triggerPdfDownload,
  type ReportRequest,
} from '@/lib/api';

interface AnalysisExportMenuProps {
  /** AI 분석 내용 (마크다운) */
  content: string;
  /** 검색 쿼리 */
  query: string;
  /** Job ID (PDF 생성용) */
  jobId?: string;
  /** 버튼 크기 */
  size?: 'default' | 'sm' | 'lg' | 'icon';
  /** 버튼 변형 */
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  /** 비활성화 */
  disabled?: boolean;
}

/**
 * HTML 템플릿 생성
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
      --section-summary: #eff6ff;
      --section-verify: #f0fdf4;
      --section-data: #faf5ff;
      --section-view: #fff7ed;
      --section-warn: #fffbeb;
      --section-conclusion: #eef2ff;
    }
    
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #111827;
        --text: #f9fafb;
        --text-muted: #9ca3af;
        --border: #374151;
        --section-summary: #1e3a5f;
        --section-verify: #14532d;
        --section-data: #3b0764;
        --section-view: #431407;
        --section-warn: #422006;
        --section-conclusion: #1e1b4b;
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
    
    h2 {
      font-size: 1.25rem;
      padding: 0.75rem 1rem;
      margin: 1.5rem 0 1rem;
      border-left: 4px solid var(--primary);
      border-radius: 0 0.5rem 0.5rem 0;
    }
    
    h2:has(+ *):nth-of-type(1), h2:contains("요약") { background: var(--section-summary); }
    h2:contains("검증") { background: var(--section-verify); }
    h2:contains("데이터"), h2:contains("수치") { background: var(--section-data); }
    h2:contains("관점") { background: var(--section-view); }
    h2:contains("주의") { background: var(--section-warn); }
    h2:contains("결론") { background: var(--section-conclusion); }
    
    h3 {
      font-size: 1rem;
      margin: 1.25rem 0 0.75rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--border);
    }
    
    p { margin: 0.75rem 0; }
    
    ul, ol { padding-left: 1.5rem; margin: 0.75rem 0; }
    li { margin: 0.5rem 0; }
    
    strong { font-weight: 600; color: var(--text); }
    
    a { color: var(--primary); text-decoration: none; }
    a:hover { text-decoration: underline; }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1rem 0;
      font-size: 0.9rem;
      border-radius: 0.5rem;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    
    th, td {
      padding: 0.75rem 1rem;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    
    th {
      background: var(--border);
      font-weight: 600;
    }
    
    tr:hover { background: rgba(124, 58, 237, 0.05); }
    
    .badge {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.75rem;
      font-weight: 500;
    }
    
    .badge-high { background: #dcfce7; color: #166534; }
    .badge-medium { background: #fef9c3; color: #854d0e; }
    .badge-low { background: #fee2e2; color: #991b1b; }
    
    blockquote {
      margin: 1rem 0;
      padding: 0.75rem 1rem;
      border-left: 4px solid var(--primary-light);
      background: rgba(124, 58, 237, 0.05);
      border-radius: 0 0.5rem 0.5rem 0;
      font-style: italic;
      color: var(--text-muted);
    }
    
    code {
      background: var(--border);
      padding: 0.125rem 0.375rem;
      border-radius: 0.25rem;
      font-family: 'Fira Code', monospace;
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
 * 간단한 마크다운 -> HTML 변환
 */
const markdownToHtml = (md: string): string => {
  let html = md
    // 헤더
    .replace(/^### \[([^\]]+)\] (.+)$/gm, '<h3>$1: $2</h3>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## \[([^\]]+)\] (.+)$/gm, '<h2>$1: $2</h2>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    // 테이블
    .replace(/\|(.+)\|/g, (match) => {
      const cells = match.split('|').filter(c => c.trim());
      if (cells.every(c => c.trim().match(/^-+$/))) {
        return ''; // 구분선 제거
      }
      const isHeader = cells.some(c => c.includes('사실') || c.includes('출처') || c.includes('검증'));
      const tag = isHeader ? 'th' : 'td';
      const row = cells.map(c => {
        let content = c.trim();
        // 검증 수준 배지
        if (content.match(/^(높음|중간|낮음)$/)) {
          const badgeClass = content === '높음' ? 'badge-high' : content === '중간' ? 'badge-medium' : 'badge-low';
          content = `<span class="badge ${badgeClass}">${content}</span>`;
        }
        return `<${tag}>${content}</${tag}>`;
      }).join('');
      return `<tr>${row}</tr>`;
    })
    // 테이블 래퍼
    .replace(/(<tr>.*<\/tr>\n?)+/gs, '<table>$&</table>')
    // 굵게
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // 기울임
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // 링크
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    // 리스트
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/gs, '<ul>$&</ul>')
    // 인용
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // 코드
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // 구분선
    .replace(/^---$/gm, '<hr>')
    // 단락
    .replace(/^(?!<[a-z])(.*[^\n])$/gm, '<p>$1</p>')
    // 빈 p 태그 제거
    .replace(/<p>\s*<\/p>/g, '');
  
  return html;
};

/**
 * 파일 다운로드 트리거
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

/**
 * AI 분석 결과 내보내기 메뉴 컴포넌트
 */
export function AnalysisExportMenu({
  content,
  query,
  jobId,
  size = 'sm',
  variant = 'outline',
  disabled = false,
}: AnalysisExportMenuProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const safeQuery = query.replace(/[^가-힣a-zA-Z0-9]/g, '_').slice(0, 30);
  const baseFilename = `NewsInsight_AI분석_${safeQuery}_${timestamp}`;

  // PDF 내보내기
  const handleExportPdf = useCallback(async () => {
    if (!jobId) {
      toast.error('PDF 내보내기는 검색 작업 ID가 필요합니다.');
      return;
    }
    
    setIsExporting(true);
    try {
      const request: ReportRequest = {
        reportType: 'UNIFIED_SEARCH',
        targetId: jobId,
        query,
        timeWindow: '7d',
        includeSections: ['COVER', 'EXECUTIVE_SUMMARY'],
        chartImages: {},
        language: 'ko',
      };
      
      const blob = await exportUnifiedSearchReport(jobId, request);
      triggerPdfDownload(blob, `${baseFilename}.pdf`);
      toast.success('PDF 보고서가 다운로드되었습니다.');
    } catch (error) {
      console.error('PDF export failed:', error);
      toast.error('PDF 생성에 실패했습니다.');
    } finally {
      setIsExporting(false);
    }
  }, [jobId, query, baseFilename]);

  // Markdown 내보내기
  const handleExportMarkdown = useCallback(() => {
    const mdContent = `# NewsInsight AI 분석 보고서

**검색어**: ${query}  
**생성 시간**: ${new Date().toLocaleString('ko-KR')}

---

${content}

---

*이 보고서는 NewsInsight AI에 의해 자동 생성되었습니다.*
`;
    downloadFile(mdContent, `${baseFilename}.md`, 'text/markdown;charset=utf-8');
    toast.success('Markdown 파일이 다운로드되었습니다.');
  }, [content, query, baseFilename]);

  // HTML 내보내기
  const handleExportHtml = useCallback(() => {
    const htmlContent = generateHtmlReport(content, query);
    downloadFile(htmlContent, `${baseFilename}.html`, 'text/html;charset=utf-8');
    toast.success('HTML 파일이 다운로드되었습니다.');
  }, [content, query, baseFilename]);

  // 텍스트 내보내기
  const handleExportText = useCallback(() => {
    // 마크다운 문법 제거
    const plainText = content
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
    downloadFile(textContent, `${baseFilename}.txt`, 'text/plain;charset=utf-8');
    toast.success('텍스트 파일이 다운로드되었습니다.');
  }, [content, query, baseFilename]);

  // 클립보드 복사
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success('클립보드에 복사되었습니다.');
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.error('복사에 실패했습니다.');
    }
  }, [content]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} disabled={disabled || isExporting}>
          {isExporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          <span className="ml-1.5">내보내기</span>
          <ChevronDown className="h-3 w-3 ml-1 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>내보내기 형식</DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        {jobId && (
          <DropdownMenuItem onClick={handleExportPdf} disabled={isExporting}>
            <FileText className="h-4 w-4 mr-2 text-red-600" />
            PDF 보고서
          </DropdownMenuItem>
        )}
        
        <DropdownMenuItem onClick={handleExportMarkdown}>
          <FileCode className="h-4 w-4 mr-2 text-blue-600" />
          Markdown (.md)
        </DropdownMenuItem>
        
        <DropdownMenuItem onClick={handleExportHtml}>
          <FileType2 className="h-4 w-4 mr-2 text-orange-600" />
          HTML 웹페이지
        </DropdownMenuItem>
        
        <DropdownMenuItem onClick={handleExportText}>
          <FileText className="h-4 w-4 mr-2 text-gray-600" />
          텍스트 (.txt)
        </DropdownMenuItem>
        
        <DropdownMenuSeparator />
        
        <DropdownMenuItem onClick={handleCopy}>
          {copied ? (
            <Check className="h-4 w-4 mr-2 text-green-600" />
          ) : (
            <Copy className="h-4 w-4 mr-2" />
          )}
          클립보드 복사
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default AnalysisExportMenu;
