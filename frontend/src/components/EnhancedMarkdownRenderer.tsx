/**
 * EnhancedMarkdownRenderer - 고급 마크다운 렌더러
 * 
 * AI 분석 결과를 위한 고급 마크다운 렌더링 컴포넌트
 * - 섹션별 스타일링 (요약, 검증, 데이터 등)
 * - 테이블 고급 스타일링
 * - 코드 하이라이팅
 * - 인터랙티브 요소
 */

import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { 
  ExternalLink, 
  CheckCircle2, 
  AlertTriangle, 
  Info, 
  FileText, 
  BarChart3,
  MessageSquare,
  AlertCircle,
  Lightbulb,
  BookOpen,
  Shield,
  TrendingUp,
  List,
  Quote
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface EnhancedMarkdownRendererProps {
  content: string;
  className?: string;
  isStreaming?: boolean;
  variant?: 'default' | 'compact' | 'report';
}

// 섹션 헤더 아이콘 매핑
const SECTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  '요약': FileText,
  '핵심 요약': FileText,
  '검증': CheckCircle2,
  '검증된 사실': CheckCircle2,
  '사실': CheckCircle2,
  '데이터': BarChart3,
  '주요 수치': BarChart3,
  '수치': TrendingUp,
  '관점': MessageSquare,
  '다양한 관점': MessageSquare,
  '주의': AlertTriangle,
  '주의사항': AlertTriangle,
  '한계': AlertCircle,
  '결론': Lightbulb,
  '배경': BookOpen,
  '배경 지식': BookOpen,
  '신뢰도': Shield,
  '목록': List,
  '인용': Quote,
};

// 섹션 스타일 매핑
const SECTION_STYLES: Record<string, { bg: string; border: string; icon: string }> = {
  '요약': { bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-l-blue-500', icon: 'text-blue-600' },
  '핵심 요약': { bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-l-blue-500', icon: 'text-blue-600' },
  '검증': { bg: 'bg-green-50 dark:bg-green-950/30', border: 'border-l-green-500', icon: 'text-green-600' },
  '검증된 사실': { bg: 'bg-green-50 dark:bg-green-950/30', border: 'border-l-green-500', icon: 'text-green-600' },
  '사실': { bg: 'bg-green-50 dark:bg-green-950/30', border: 'border-l-green-500', icon: 'text-green-600' },
  '데이터': { bg: 'bg-purple-50 dark:bg-purple-950/30', border: 'border-l-purple-500', icon: 'text-purple-600' },
  '주요 수치': { bg: 'bg-purple-50 dark:bg-purple-950/30', border: 'border-l-purple-500', icon: 'text-purple-600' },
  '관점': { bg: 'bg-orange-50 dark:bg-orange-950/30', border: 'border-l-orange-500', icon: 'text-orange-600' },
  '다양한 관점': { bg: 'bg-orange-50 dark:bg-orange-950/30', border: 'border-l-orange-500', icon: 'text-orange-600' },
  '주의': { bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-l-amber-500', icon: 'text-amber-600' },
  '주의사항': { bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-l-amber-500', icon: 'text-amber-600' },
  '결론': { bg: 'bg-indigo-50 dark:bg-indigo-950/30', border: 'border-l-indigo-500', icon: 'text-indigo-600' },
  '배경': { bg: 'bg-slate-50 dark:bg-slate-950/30', border: 'border-l-slate-500', icon: 'text-slate-600' },
};

// 검증 수준 배지 컴포넌트
const VerificationBadge = ({ level }: { level: string }) => {
  const normalized = level.toLowerCase();
  if (normalized.includes('높음') || normalized.includes('high')) {
    return <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 text-xs">높음</Badge>;
  }
  if (normalized.includes('중간') || normalized.includes('medium')) {
    return <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300 text-xs">중간</Badge>;
  }
  if (normalized.includes('낮음') || normalized.includes('low')) {
    return <Badge className="bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 text-xs">낮음</Badge>;
  }
  return <Badge variant="outline" className="text-xs">{level}</Badge>;
};

/**
 * 고급 마크다운 렌더러
 */
export const EnhancedMarkdownRenderer = memo(function EnhancedMarkdownRenderer({
  content,
  className,
  isStreaming = false,
  variant = 'default',
}: EnhancedMarkdownRendererProps) {
  
  // 섹션 헤더 텍스트에서 아이콘과 스타일 추출
  const getSectionInfo = (text: string) => {
    // [요약], [검증] 등의 패턴 감지
    const match = text.match(/\[([^\]]+)\]/);
    if (match) {
      const sectionName = match[1];
      return {
        name: sectionName,
        icon: SECTION_ICONS[sectionName],
        style: SECTION_STYLES[sectionName],
      };
    }
    
    // 패턴 없이 키워드로 감지
    for (const [keyword, icon] of Object.entries(SECTION_ICONS)) {
      if (text.includes(keyword)) {
        return {
          name: keyword,
          icon,
          style: SECTION_STYLES[keyword],
        };
      }
    }
    
    return null;
  };

  const variantStyles = useMemo(() => {
    switch (variant) {
      case 'compact':
        return 'text-sm';
      case 'report':
        return 'text-base leading-relaxed';
      default:
        return '';
    }
  }, [variant]);

  return (
    <div
      className={cn(
        // Base prose styles
        "prose prose-sm dark:prose-invert max-w-none",
        // Headings
        "prose-headings:font-semibold prose-headings:text-foreground",
        "prose-h1:text-xl prose-h1:mt-6 prose-h1:mb-3",
        "prose-h2:text-lg prose-h2:mt-5 prose-h2:mb-3",
        "prose-h3:text-base prose-h3:mt-4 prose-h3:mb-2",
        // Paragraphs
        "prose-p:my-2.5 prose-p:leading-relaxed prose-p:text-foreground/90",
        // Lists
        "prose-ul:my-3 prose-ul:pl-5",
        "prose-ol:my-3 prose-ol:pl-5",
        "prose-li:my-1 prose-li:marker:text-primary/70",
        // Strong/Bold
        "prose-strong:font-semibold prose-strong:text-foreground",
        // Links
        "prose-a:text-primary prose-a:no-underline prose-a:font-medium hover:prose-a:underline",
        // Blockquotes
        "prose-blockquote:border-l-4 prose-blockquote:border-primary/40",
        "prose-blockquote:pl-4 prose-blockquote:py-1 prose-blockquote:italic",
        "prose-blockquote:text-muted-foreground prose-blockquote:bg-muted/30 prose-blockquote:rounded-r-lg",
        // Code
        "prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md",
        "prose-code:font-mono prose-code:text-sm prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:bg-slate-900 dark:prose-pre:bg-slate-950 prose-pre:rounded-xl prose-pre:p-4 prose-pre:shadow-lg",
        // Horizontal rule
        "prose-hr:border-border prose-hr:my-6",
        variantStyles,
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 외부 링크 스타일링
          a: ({ href, children, ...props }) => {
            const isExternal = href?.startsWith("http");
            return (
              <a
                href={href}
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noopener noreferrer" : undefined}
                className="inline-flex items-center gap-1 text-primary hover:text-primary/80 transition-colors"
                {...props}
              >
                {children}
                {isExternal && <ExternalLink className="h-3 w-3 inline-block opacity-70" />}
              </a>
            );
          },
          
          // H2 - 주요 섹션 헤더 (색상 + 아이콘)
          h2: ({ children, ...props }) => {
            const text = String(children);
            const sectionInfo = getSectionInfo(text);
            const Icon = sectionInfo?.icon;
            const style = sectionInfo?.style;
            
            // 표시할 텍스트 ([] 패턴 제거)
            const displayText = text.replace(/\[([^\]]+)\]\s*/, '');
            
            return (
              <h2 
                className={cn(
                  "flex items-center gap-2 py-2 px-3 -mx-3 rounded-lg mt-6 mb-4",
                  style?.bg || "bg-muted/50",
                  "border-l-4",
                  style?.border || "border-l-primary"
                )} 
                {...props}
              >
                {Icon && <Icon className={cn("h-5 w-5", style?.icon || "text-primary")} />}
                <span className="font-semibold">{displayText}</span>
              </h2>
            );
          },
          
          // H3 - 서브 섹션 헤더
          h3: ({ children, ...props }) => {
            const text = String(children);
            const sectionInfo = getSectionInfo(text);
            const Icon = sectionInfo?.icon;
            const style = sectionInfo?.style;
            
            const displayText = text.replace(/\[([^\]]+)\]\s*/, '');
            
            return (
              <h3 
                className={cn(
                  "flex items-center gap-2 py-1.5 mt-4 mb-2",
                  "border-b border-border/50 pb-1"
                )} 
                {...props}
              >
                {Icon && <Icon className={cn("h-4 w-4", style?.icon || "text-muted-foreground")} />}
                <span className="font-medium">{displayText}</span>
              </h3>
            );
          },
          
          // 테이블 고급 스타일링
          table: ({ children, ...props }) => (
            <div className="my-4 overflow-x-auto rounded-lg border border-border shadow-sm">
              <table className="w-full border-collapse" {...props}>
                {children}
              </table>
            </div>
          ),
          
          thead: ({ children, ...props }) => (
            <thead className="bg-muted/70 dark:bg-muted/50" {...props}>
              {children}
            </thead>
          ),
          
          th: ({ children, ...props }) => (
            <th 
              className="px-4 py-3 text-left text-sm font-semibold text-foreground border-b border-border" 
              {...props}
            >
              {children}
            </th>
          ),
          
          td: ({ children, ...props }) => {
            const text = String(children);
            
            // 검증 수준 셀 감지 및 배지로 변환
            if (text.match(/^(높음|중간|낮음|high|medium|low)$/i)) {
              return (
                <td className="px-4 py-3 border-b border-border/50" {...props}>
                  <VerificationBadge level={text} />
                </td>
              );
            }
            
            return (
              <td 
                className="px-4 py-3 text-sm border-b border-border/50 text-foreground/90" 
                {...props}
              >
                {children}
              </td>
            );
          },
          
          tr: ({ children, ...props }) => (
            <tr 
              className="hover:bg-muted/30 transition-colors" 
              {...props}
            >
              {children}
            </tr>
          ),
          
          // 리스트 아이템 스타일링
          li: ({ children, ...props }) => (
            <li 
              className="my-1.5 pl-1 marker:text-primary/60" 
              {...props}
            >
              {children}
            </li>
          ),
          
          // 인용구 스타일링
          blockquote: ({ children, ...props }) => (
            <blockquote 
              className="my-4 border-l-4 border-primary/40 pl-4 py-2 bg-muted/20 rounded-r-lg italic text-muted-foreground"
              {...props}
            >
              {children}
            </blockquote>
          ),
          
          // 강조 텍스트
          strong: ({ children, ...props }) => (
            <strong className="font-semibold text-foreground" {...props}>
              {children}
            </strong>
          ),
          
          // 구분선
          hr: ({ ...props }) => (
            <hr className="my-6 border-t-2 border-dashed border-border/50" {...props} />
          ),
          
          // 코드 블록
          code: ({ className: codeClassName, children, ...props }) => {
            const isInline = !codeClassName;
            
            if (isInline) {
              return (
                <code 
                  className="bg-muted px-1.5 py-0.5 rounded-md text-sm font-mono text-primary"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            
            return (
              <code className={cn(codeClassName, "block")} {...props}>
                {children}
              </code>
            );
          },
          
          // 이미지 스타일링
          img: ({ src, alt, ...props }) => (
            <figure className="my-4">
              <img 
                src={src} 
                alt={alt} 
                className="rounded-lg shadow-md max-w-full h-auto"
                {...props}
              />
              {alt && (
                <figcaption className="text-center text-sm text-muted-foreground mt-2">
                  {alt}
                </figcaption>
              )}
            </figure>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
      
      {/* 스트리밍 커서 */}
      {isStreaming && (
        <span className="inline-block w-2 h-5 bg-primary animate-pulse ml-0.5 align-text-bottom rounded-sm" />
      )}
    </div>
  );
});

export default EnhancedMarkdownRenderer;
