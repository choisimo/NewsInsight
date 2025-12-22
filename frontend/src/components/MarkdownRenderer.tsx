import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  isStreaming?: boolean;
}

/**
 * Markdown renderer component with GitHub Flavored Markdown support.
 * Used for rendering AI analysis results and other markdown content.
 */
export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className,
  isStreaming = false,
}: MarkdownRendererProps) {
  return (
    <div
      className={cn(
        // Base prose styles
        "prose prose-sm dark:prose-invert max-w-none break-words overflow-hidden",
        // Headings
        "prose-headings:font-semibold prose-headings:text-foreground",
        "prose-h1:text-xl prose-h1:mt-4 prose-h1:mb-2",
        "prose-h2:text-lg prose-h2:mt-4 prose-h2:mb-2",
        "prose-h3:text-base prose-h3:mt-3 prose-h3:mb-1",
        // Paragraphs
        "prose-p:my-2 prose-p:leading-relaxed",
        // Lists
        "prose-ul:my-2 prose-ul:pl-4",
        "prose-ol:my-2 prose-ol:pl-4",
        "prose-li:my-0.5 prose-li:marker:text-muted-foreground",
        // Strong/Bold
        "prose-strong:font-semibold prose-strong:text-foreground",
        // Links
        "prose-a:text-primary prose-a:underline prose-a:underline-offset-2 hover:prose-a:text-primary/80",
        // Blockquotes
        "prose-blockquote:border-l-4 prose-blockquote:border-primary/30",
        "prose-blockquote:pl-4 prose-blockquote:italic",
        "prose-blockquote:text-muted-foreground",
        // Code
        "prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded",
        "prose-code:font-mono prose-code:text-sm",
        "prose-pre:bg-muted prose-pre:rounded-lg prose-pre:p-4",
        // Horizontal rule
        "prose-hr:border-border prose-hr:my-4",
        // Tables
        "prose-table:border prose-table:border-border",
        "prose-th:bg-muted prose-th:px-3 prose-th:py-2 prose-th:text-left",
        "prose-td:px-3 prose-td:py-2 prose-td:border-t prose-td:border-border",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Custom link component with external link icon
          a: ({ href, children, ...props }) => {
            const isExternal = href?.startsWith("http");
            return (
              <a
                href={href}
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noopener noreferrer" : undefined}
                className="inline-flex items-center gap-1"
                {...props}
              >
                {children}
                {isExternal && <ExternalLink className="h-3 w-3 inline-block" />}
              </a>
            );
          },
          // Custom heading with anchor support
          h2: ({ children, ...props }) => (
            <h2 className="flex items-center gap-2 border-b border-border pb-1 mb-3" {...props}>
              {children}
            </h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 className="flex items-center gap-1" {...props}>
              {children}
            </h3>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
      {/* Streaming cursor */}
      {isStreaming && (
        <span className="inline-block w-2 h-4 bg-primary/60 animate-pulse ml-0.5 align-text-bottom" />
      )}
    </div>
  );
});

export default MarkdownRenderer;
